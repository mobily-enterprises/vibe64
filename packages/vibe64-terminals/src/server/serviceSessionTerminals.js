import { closeAgentSessionCommandEnvironment } from "./agentCommandEnvironment.js";
import { removeCodexGitCommandSession } from "./codexGitCommand.js";
import { cleanupSessionSaveCommitMessage } from "./sessionSaveCommitMessage.js";
import { codexTerminalNamespace, outputTargetTerminalNamespace } from "./terminalShared.js";
import {
  closeTerminalSessionsForNamespace,
  freezeTerminalNamespaceAdmission,
  listTerminalSessions,
  terminalNamespaceAdmissionFailure,
  thawTerminalNamespaceAdmission
} from "@local/vibe64-execution/server/terminalSessions";
import {
  assertProjectEffectAdmission,
  currentProjectRequestContext,
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
import { vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { AGENT_WRITE_WAIT_MS } from "./serviceSessionAccess.js";
import {
  closeTerminalControllersForSession,
  renewalPredecessorTerminalCleanupContext,
  renewalSuccessorTerminalCleanupContext
} from "./sessionTerminalCleanup.js";

/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").ServiceAssistantPreparation} ServiceAssistantPreparation */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("./types.js").CodexSessionRegistration} CodexSessionRegistration */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AgentDatabaseCommandService} AgentDatabaseCommandService */
/** @typedef {import("./types.js").AgentEnvCommandService} AgentEnvCommandService */
/** @typedef {import("./types.js").AgentPreviewCommandService} AgentPreviewCommandService */
/** @typedef {import("./types.js").AgentSessionCommandService} AgentSessionCommandService */
/** @typedef {import("./types.js").OutputTargetTerminalController} OutputTargetTerminalController */
/** @typedef {ReturnType<typeof import("./previewDiagnostics.js").createPreviewDiagnosticRecorder>} PreviewDiagnosticRecorder */
/** @typedef {ReturnType<typeof import("./providerUsage.js").createProviderUsage>} ProviderUsage */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */
/** @typedef {import("./types.js").SessionNaming} SessionNaming */
/** @typedef {import("./types.js").SessionPromptHintsService} SessionPromptHintsService */

function terminalNamespaceMatchesProjectScope(namespace = "", projectScope = "") {
  const normalizedNamespace = String(namespace || "").trim();
  const normalizedScope = String(projectScope || "").trim();
  if (!normalizedNamespace || !normalizedScope) {
    return false;
  }
  const marker = `:${normalizedScope}`;
  return normalizedNamespace.endsWith(marker) || normalizedNamespace.includes(`${marker}:`);
}

function projectScopedTerminalNamespaces(projectScope = "") {
  const namespaces = new Set();
  for (const entry of listTerminalSessions({})) {
    const namespace = String(entry?.namespace || "").trim();
    if (terminalNamespaceMatchesProjectScope(namespace, projectScope)) {
      namespaces.add(namespace);
    }
  }
  return [...namespaces].sort();
}

async function closeProjectScopedTerminalNamespaces({
  eventPrefix = "server.terminals.closeProjectRuntime",
  projectScope = currentProjectScopeKey()
} = {}) {
  const namespaces = projectScopedTerminalNamespaces(projectScope);
  let closed = 0;
  for (const namespace of namespaces) {
    const result = await closeTerminalSessionsForNamespace(namespace);
    closed += Number(result?.closed || 0);
    vibe64SessionDebugLog(`${eventPrefix}.namespace.done`, {
      closed: Number(result?.closed || 0),
      namespace,
      ok: result?.ok !== false,
      projectScope
    });
  }
  return {
    closed,
    namespaceCount: namespaces.length,
    namespaces,
    ok: true,
    projectScope
  };
}

function renewalTerminalAdmissionOwner(renewalId = "") {
  const normalizedRenewalId = String(renewalId || "").trim();
  if (!normalizedRenewalId) {
    throw new TypeError("Terminal renewal admission requires a renewal id.");
  }
  return `session-renewal:${normalizedRenewalId}`;
}

function renewalTerminalAdmissionNamespaces(sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    throw new TypeError("Terminal renewal admission requires a session id.");
  }
  return [
    codexTerminalNamespace(normalizedSessionId),
    outputTargetTerminalNamespace(normalizedSessionId)
  ];
}

function assertTerminalAdmissionResult(result = {}) {
  if (result.ok !== false) {
    return result;
  }
  const error = new Error(result.error || "Terminal admission could not be changed.");
  error.code = result.code || "vibe64_session_renewal_terminal_admission_failed";
  throw error;
}

function sessionTerminalAdmissionFailure(sessionId = "", kind = "agent") {
  const namespaces = renewalTerminalAdmissionNamespaces(sessionId);
  return terminalNamespaceAdmissionFailure(
    kind === "output" ? namespaces[1] : namespaces[0]
  );
}

/**
 * A session's terminals: the agent, global Codex and output-target terminals and their admission
 * during renewal, closing them with the session, and the output target's results and test approvals.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {ServiceAssistantPreparation} dependencies.assistantPreparation
 * @param {AgentDatabaseCommandService} dependencies.agentDatabaseCommand
 * @param {AgentEnvCommandService} dependencies.agentEnvCommand
 * @param {AgentPreviewCommandService} dependencies.agentPreviewCommand
 * @param {AgentSessionCommandService} dependencies.agentSessionCommand
 * @param {CodexSessionRegistration} dependencies.codex
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger} dependencies.logger
 * @param {OutputTargetTerminalController} dependencies.outputTarget
 * @param {PreviewDiagnosticRecorder} dependencies.previewDiagnostics
 * @param {ProjectService} dependencies.projectService
 * @param {ProjectServices} dependencies.projectServices
 * @param {ProviderUsage} dependencies.providerUsage
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {SessionConversations} dependencies.sessionConversations
 * @param {SessionNaming} dependencies.sessionNaming
 * @param {SessionPromptHintsService} dependencies.sessionPromptHints
 */
function createServiceSessionTerminals({
  state,
  sessionAccess,
  assistantContext,
  assistantPreparation,
  agentDatabaseCommand,
  agentEnvCommand,
  agentPreviewCommand,
  agentSessionCommand,
  codex,
  env,
  logger,
  outputTarget,
  previewDiagnostics,
  projectService,
  projectServices,
  providerUsage,
  sessionAgent,
  sessionConversations,
  sessionNaming,
  sessionPromptHints
}) {
  async function closeAgentSession(sessionId, options = {}) {
    return sessionAgent.closeSession(sessionId, options);
  }

  async function authorizeGlobalCodexTerminal(options = {}) {
    await sessionAgent.requireAssistantAccessForEngine("codex", options);
  }

  function closeAllSessionTerminals(sessionId, controllerOptions = {}) {
    return closeAgentSessionCommandEnvironment(sessionId, async () => {
      let learningNativeAvailable = false;
      if (controllerOptions.session?.sourceReady === false && controllerOptions.session?.purpose === "learning") {
        const runtime = controllerOptions.runtime || await projectService.createRuntime({ inspectSource: false });
        if (runtime.learningScope) {
          await runtime.getNativeExecutionRoot(sessionId, { allowClosing: true });
          learningNativeAvailable = true;
        }
      }
      // A session whose source was never created never ran its assistant, and
      // its assistant cannot read a conversation context to close.
      const assistantRan = controllerOptions.session?.sourceReady !== false || learningNativeAvailable;
      return closeTerminalControllersForSession(sessionId, [
        {
          controller: { closeAllForSession: async (id, options) => {
            const agentContext = await assistantContext.assistantSessionOptions(id, options);
            await sessionNaming.closeSession(agentContext);
            await cleanupSessionSaveCommitMessage({ agent: sessionAgent, agentContext });
            return { ok: true };
          } },
          label: "Naming helpers"
        },
        {
          controller: { closeAllForSession: (id, options) => sessionPromptHints.cancelSessionPromptHintsForSession(id, options) },
          label: "Prompt suggestions"
        },
        { controller: { closeAllForSession: (id, options) => state.slots.databaseToolsProvider?.closeAssistantsForSession(id, options) },
          label: "Database copilot" },
        { controller: { closeAllForSession: (id) => state.slots.sourceEditorProvider?.closeExplanationsForSession(id) },
          label: "Source explanations" },
        { controller: outputTarget, label: "outputTarget" },
        { controller: { closeAllForSession: (id) => projectServices.closeSession(sessionAccess.projectRuntimeContext(), id) },
          label: "sessionServices" },
        ...(!controllerOptions.renewalCleanup && assistantRan ? [{
          controller: { closeAllForSession: async (id, options) =>
            sessionAgent.interruptTurn(id, {}, await assistantContext.assistantSessionOptions(id, options)) },
          label: "assistantTurn"
        }] : []),
        ...(assistantRan ? [{
          controller: {
            closeAllForSession: (id, options) => closeAgentSession(id, options)
          },
          label: "assistant"
        }] : []),
        ...(controllerOptions.forgetConversationBinding === true ? [{
          controller: { closeAllForSession: (id, options) => sessionConversations.retireTemporaryConversations(id, options) },
          label: "Temporary chats"
        }] : []),
        { controller: agentDatabaseCommand, label: "agentDatabase" },
        { controller: agentEnvCommand, label: "agentEnv" },
        { controller: agentPreviewCommand, label: "agentPreview" },
        { controller: agentSessionCommand, label: "agentSessionCommand" }
      ], {
        controllerOptions,
        logger
      });
    }).finally(() => providerUsage.forget(currentProjectScopeKey(), sessionId));
  }

  async function freezeSessionTerminalAdmissionForRenewal(sessionId = "", options = {}) {
    await sessionPromptHints.cancelSessionPromptHintsForSession(sessionId);
    const namespaces = renewalTerminalAdmissionNamespaces(sessionId);
    const owner = renewalTerminalAdmissionOwner(options.renewalId);
    const frozen = [];
    try {
      for (const namespace of namespaces) {
        assertTerminalAdmissionResult(freezeTerminalNamespaceAdmission(namespace, {
          code: "vibe64_session_renewal_quiesced",
          error: "Session renewal has frozen terminal input.",
          owner
        }));
        frozen.push(namespace);
      }
    } catch (error) {
      for (const namespace of frozen) {
        thawTerminalNamespaceAdmission(namespace, { owner });
      }
      throw error;
    }
    return {
      frozen: true,
      namespaces,
      ok: true,
      renewalId: String(options.renewalId || "").trim(),
      sessionId: String(sessionId || "").trim()
    };
  }

  function thawSessionTerminalAdmissionForRenewal(sessionId = "", options = {}) {
    const namespaces = renewalTerminalAdmissionNamespaces(sessionId);
    const owner = renewalTerminalAdmissionOwner(options.renewalId);
    for (const namespace of namespaces) {
      assertTerminalAdmissionResult(thawTerminalNamespaceAdmission(namespace, { owner }));
    }
    return {
      frozen: false,
      namespaces,
      ok: true,
      renewalId: String(options.renewalId || "").trim(),
      sessionId: String(sessionId || "").trim()
    };
  }

  async function recordPreviewDiagnostic(sessionId, input) {
    // Action admission owns project access; read the exact existing session without preparing it.
    const { session } = await assistantContext.assistantSessionOptions(sessionId);
    return previewDiagnostics(input, { projectSlug: currentProjectRequestContext()?.slug || "",
      sessionId: session.sessionId });
  }

  async function closeSessionTerminals(sessionId, options = {}) {
    return closeAllSessionTerminals(sessionId, options);
  }

  async function closeRenewalPredecessorSessionTerminals(session, options = {}) {
    const context = renewalPredecessorTerminalCleanupContext(session, options);
    return closeAllSessionTerminals(context.sessionId, context);
  }

  async function closeRenewalSuccessorSessionTerminals(session, options = {}) {
    const context = renewalSuccessorTerminalCleanupContext(session, options);
    return closeAllSessionTerminals(context.sessionId, context);
  }

  async function releaseRenewalPredecessorAttachments(session, options = {}) {
    const sessionId = String(session?.sessionId || "").trim();
    return sessionAgent.releaseRenewalPredecessorAttachments(
      sessionId,
      {
        renewalId: String(options.renewalId || "").trim()
      },
      {
        runtime: options.runtime || null,
        session
      }
    );
  }

  async function releaseRenewalPredecessorProcessExitProof(session, options = {}) {
    const sessionId = String(session?.sessionId || "").trim();
    return sessionAgent.releaseRenewalPredecessorProcessExitProof(
      sessionId,
      {
        renewalId: String(options.renewalId || "").trim()
      },
      {
        runtime: options.runtime || null,
        session
      }
    );
  }

  async function releaseRenewalSuccessorProcessExitProof(session, options = {}) {
    const sessionId = String(session?.sessionId || "").trim();
    return sessionAgent.releaseRenewalSuccessorProcessExitProof(
      sessionId,
      {
        authorization: options.authorization || null,
        renewalId: String(options.renewalId || "").trim()
      },
      {
        runtime: options.runtime || null,
        session
      }
    );
  }

  async function closeSessionNonAgentTerminals(sessionId) {
    return closeTerminalControllersForSession(sessionId, [
      { controller: outputTarget, label: "outputTarget" }
    ], {
      eventPrefix: "server.terminals.closeSessionNonAgentTerminals",
      logger
    });
  }

  async function closeAgentTerminal(sessionId, terminalSessionId, options = {}) {
    const result = await sessionAgent.closeTerminal(sessionId, {
      terminalSessionId
    }, options);
    await sessionAccess.publishTerminalSessionChanged("agentTerminalClosed", sessionId, "agent-terminal-closed");
    return result;
  }

  function closeGlobalCodexTerminal(terminalSessionId) {
    return codex.terminals.closeGlobalTerminal(terminalSessionId);
  }

  async function closeOutputTargetTerminal(sessionId, terminalSessionId) {
    const result = await outputTarget.closeTerminal(sessionId, terminalSessionId);
    await sessionAccess.publishTerminalSessionChanged("outputTargetClosed", sessionId, "output-target-closed");
    return result;
  }

  function globalCodexTerminalState() {
    return codex.terminals.globalTerminalState();
  }

  function readGlobalCodexTerminal(terminalSessionId) {
    return codex.terminals.readGlobalTerminal(terminalSessionId);
  }

  function readAgentTerminal(sessionId, terminalSessionId, options = {}) {
    return sessionAgent.readTerminal(sessionId, terminalSessionId, options);
  }

  function readOutputTargetTerminal(sessionId, terminalSessionId) {
    return outputTarget.readTerminal(sessionId, terminalSessionId);
  }

  function testApprovalStatus(sessionId) {
    return agentPreviewCommand.testApprovalStatus(sessionId);
  }

  function resumeTestApproval(identity, authorizeStart) {
    return agentPreviewCommand.resumeTestApproval(identity, authorizeStart);
  }

  function cancelTestApproval(identity) {
    return agentPreviewCommand.cancelTestApproval(identity);
  }

  function openOutputTarget(sessionId) {
    return outputTarget.openOutputTarget(sessionId);
  }

  function readOutputResult(sessionId, resultId) {
    return outputTarget.readResult(sessionId, resultId);
  }

  function removeOutputResultsForSession(sessionId) {
    return outputTarget.removeResultsForSession(sessionId);
  }

  /**
   * Only a session's final close (archive or renewal successor discard) calls this.
   */
  function removeSessionCommandHelpers(sessionId, { runtime = null } = {}) {
    return closeAgentSessionCommandEnvironment(sessionId, () => removeCodexGitCommandSession({
      env,
      sessionId,
      stateRoot: String(runtime?.stateRoot || "").trim()
    }));
  }

  function selectPreviewIdentity(sessionId, { identityName = "", mode, publicHost = "", publicProtocol = "" }) {
    return outputTarget.selectPreviewIdentity(sessionId, { identityName, mode }, { publicHost, publicProtocol });
  }

  function startAgentTerminal(sessionId, input) {
    assertProjectEffectAdmission();
    return sessionAccess.runMainAgentWrite(sessionId, { vibe64User: input.vibe64User || null }, async (context) => {
      await assistantPreparation.prepareAgentSkillsInsideAgentWrite(sessionId, context);
      return sessionAgent.startTerminal(sessionId, input, context);
    }, { operation: "start-agent-terminal" });
  }

  async function startGlobalCodexTerminal(options = {}) {
    await authorizeGlobalCodexTerminal(options);
    return codex.terminals.startGlobalTerminal();
  }

  async function startOutputTargetTerminal(sessionId, input = {}) {
    const result = await outputTarget.startTerminal(sessionId, input);
    await sessionAccess.publishTerminalSessionChanged(
      "outputTarget",
      sessionId,
      "output-target-started",
      { originId: input.originId }
    );
    return result;
  }

  function usageRecordingTargets(sessionId) {
    return outputTarget.usageRecordingTargets(sessionId);
  }

  async function stopOutputTargetTerminal(sessionId, terminalSessionId) {
    const result = await outputTarget.stopTerminal(sessionId, terminalSessionId);
    await sessionAccess.publishTerminalSessionChanged("outputTargetStopped", sessionId, result?.ok === false ? "output-target-stop-failed" : "output-target-stopped");
    return result;
  }

  function subscribeAgentTerminal(sessionId, terminalSessionId, subscriber, options = {}) {
    return sessionAgent.subscribeTerminal(sessionId, terminalSessionId, subscriber, options);
  }

  function subscribeGlobalCodexTerminal(terminalSessionId, subscriber) {
    return codex.terminals.subscribeGlobalTerminal(terminalSessionId, subscriber);
  }

  function subscribeOutputTargetTerminal(sessionId, terminalSessionId, subscriber) {
    return outputTarget.subscribeTerminal(sessionId, terminalSessionId, subscriber);
  }

  function writeAgentTerminal(sessionId, terminalSessionId, data, input = {}, options = {}) {
    assertProjectEffectAdmission();
    // A terminal write targets an already-open, namespace-owned PTY. It is
    // transport authorized against its captured connection by the manager.
    // Putting raw input through
    // runMainAgentWrite() hydrates the complete session and acquires
    // the assistant-operation lock for every WebSocket input chunk—often
    // every keystroke. Long-lived sessions therefore became progressively
    // slower and terminal restarts contended with ordinary typing.
    const admissionFailure = sessionTerminalAdmissionFailure(sessionId, "agent");
    if (admissionFailure) return admissionFailure;
    if (input.attachmentIds?.length) {
      return sessionAccess.runMainAgentWrite(sessionId, options, (context) =>
        sessionAgent.writeTerminal(sessionId, terminalSessionId, data, input, context),
      { operation: "attach-agent-terminal-files", waitMs: AGENT_WRITE_WAIT_MS });
    }
    return sessionAgent.writeTerminal(sessionId, terminalSessionId, data, input, options);
  }

  async function writeGlobalCodexTerminal(terminalSessionId, data, options = {}) {
    await authorizeGlobalCodexTerminal(options);
    return codex.terminals.writeGlobalTerminal(terminalSessionId, data);
  }

  function resizeAgentTerminal(sessionId, terminalSessionId, size, options = {}) {
    return sessionAgent.resizeTerminal(sessionId, terminalSessionId, size, options);
  }

  function resizeGlobalCodexTerminal(terminalSessionId, size) {
    return codex.terminals.resizeGlobalTerminal(terminalSessionId, size);
  }

  function writeOutputTargetTerminal(sessionId, terminalSessionId, data) {
    return sessionTerminalAdmissionFailure(sessionId, "output") ||
      outputTarget.writeTerminal(sessionId, terminalSessionId, data);
  }

  function resizeOutputTargetTerminal(sessionId, terminalSessionId, size) {
    return outputTarget.resizeTerminal(sessionId, terminalSessionId, size);
  }

  return Object.freeze({
    cancelTestApproval,
    closeAgentTerminal,
    closeAllSessionTerminals,
    closeGlobalCodexTerminal,
    closeOutputTargetTerminal,
    closeRenewalPredecessorSessionTerminals,
    closeRenewalSuccessorSessionTerminals,
    closeSessionNonAgentTerminals,
    closeSessionTerminals,
    freezeSessionTerminalAdmissionForRenewal,
    globalCodexTerminalState,
    openOutputTarget,
    readAgentTerminal,
    readGlobalCodexTerminal,
    readOutputResult,
    readOutputTargetTerminal,
    recordPreviewDiagnostic,
    releaseRenewalPredecessorAttachments,
    releaseRenewalPredecessorProcessExitProof,
    releaseRenewalSuccessorProcessExitProof,
    removeOutputResultsForSession,
    removeSessionCommandHelpers,
    resizeAgentTerminal,
    resizeGlobalCodexTerminal,
    resizeOutputTargetTerminal,
    resumeTestApproval,
    selectPreviewIdentity,
    startAgentTerminal,
    startGlobalCodexTerminal,
    startOutputTargetTerminal,
    stopOutputTargetTerminal,
    subscribeAgentTerminal,
    subscribeGlobalCodexTerminal,
    subscribeOutputTargetTerminal,
    testApprovalStatus,
    thawSessionTerminalAdmissionForRenewal,
    usageRecordingTargets,
    writeAgentTerminal,
    writeGlobalCodexTerminal,
    writeOutputTargetTerminal
  });
}

export {
  createServiceSessionTerminals,
  closeProjectScopedTerminalNamespaces,
  sessionTerminalAdmissionFailure
};
