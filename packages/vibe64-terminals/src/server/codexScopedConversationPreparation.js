import path from "node:path";
import { beginTerminalNamespaceOperation } from "@local/vibe64-execution/server/terminalSessions";
import { codexAppServerReadOnlyThreadSettings } from "@jskit-ai/assistant-core/server/codex-configuration";
import {
  assertCodexAppServerHelperOutputWithinLimit,
  codexAppServerThreadSettings,
  codexAppServerTurnSettings,
  codexAppServerHelperThreadResumePreparation,
  codexAppServerHelperThreadStartPreparation,
  prepareCodexAppServerHelperTurn
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import {
  normalizeVibe64AgentTaskResult,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
import { directoryExists, codexTerminalNamespace } from "./terminalShared.js";
import {
  codexAppServerAdmissionError,
  codexAppServerInterruptUnavailableResponse,
  codexAppServerFrozenThreadDeleteResponse,
  codexAppServerFrozenTurnInterruptResponse
} from "./codexSessionProviderHost.js";
import { codexAppServerControlDisabledResult } from "./codexConversationPreparation.js";

const CODEX_APP_SERVER_EPHEMERAL_PROGRESS_LIMIT = 24;

function normalizeText(value) {
  return String(value || "").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function codexAppServerConversationResponse(text = "") {
  const rawText = String(text || "").trim();
  const outcome = normalizeVibe64AgentTaskResult(rawText);
  return {
    message: outcome?.message || rawText,
    outcome,
    rawText
  };
}

function codexAppServerExpiredEphemeralConversation(conversationId = "", input = {}) {
  return {
    conversationExpired: true,
    conversationId: normalizeText(conversationId),
    error: "This Temporary AI task ended when Vibe64 restarted. Send the message again to start a new task.",
    message: "",
    ok: true,
    progressUpdates: [],
    rawText: "",
    runId: normalizeText(input.runId),
    status: "failed"
  };
}

function createCodexScopedConversationPreparation({
  conversationPreparation: codexConversationPreparation,
  helperPreparation,
  runtimeHost,
  sessionRuntimeHost,
  accountPreparation,
  sessionEnvironment,
  actorMetadata: currentConversationActorMetadata,
  enabled: codexAppServerPromptDeliveryEnabled
}) {
  const { codexAppServerRuntimeOptions } = runtimeHost;
  const {
    codexAppServerManagedThreadIdentity,
    codexAppServerHelperRuntimeOptionsForSession,
    codexAppServerRuntimeOptionsForSession
  } = sessionRuntimeHost;
  const { codexToolHomeResult } = accountPreparation;
  const { vibe64SessionContextInput } = sessionEnvironment;
  const {
    restoration: prepareCodexAppServerHelperRestoration,
    ownershipError: codexAppServerHelperOwnershipError
  } = helperPreparation;

  async function codexAppServerEphemeralScopePreparation(sessionId = "", input = {}, scope = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (normalizeText(scope.id) !== normalizedSessionId) {
      throw new TypeError("Codex ephemeral conversation scope does not match its provider binding.");
    }
    const requestedWorkdir = normalizeText(scope.workdir);
    if (!path.isAbsolute(requestedWorkdir)) {
      throw new TypeError("Codex ephemeral conversation workdir must be absolute.");
    }
    const workdir = path.resolve(requestedWorkdir);
    if (!await directoryExists(workdir)) {
      throw new TypeError("Codex ephemeral conversation workdir is unavailable.");
    }
    const toolHome = await codexToolHomeResult({ agentSettings: input.agentSettings });
    if (toolHome.ok === false) {
      return { result: toolHome };
    }
    const providerOptions = { ...codexAppServerRuntimeOptions({
      session: { sessionId: normalizedSessionId },
      executionRoot: workdir,
      terminalEnv: scope.environment || {},
      toolHomeSource: toolHome.toolHomeSource,
      workdir
    }), assistantScope: scope, routingModelProviderId: input.agentSettings?.modelProviderId || "openai" };
    return {
      providerOptions,
      context: { assistantScope: scope, workdir },
      project(provider) {
        return {
          agentSettings: isRecord(input.agentSettings) ? input.agentSettings : {},
          assistantScope: scope,
          actorMetadata: {},
          helperRestore: null,
          executionRoot: workdir,
          ok: true,
          provider,
          providerOptions,
          runtime: null,
          session: null,
          toolHomeSource: toolHome.toolHomeSource,
          workdir
        };
      }
    };
  }

  async function codexAppServerConversationPreparation(sessionId = "", input = {}, {
    assistantScope = null,
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
    if (!codexAppServerPromptDeliveryEnabled) {
      return { result: codexAppServerControlDisabledResult() };
    }
    if (assistantScope) {
      return codexAppServerEphemeralScopePreparation(sessionId, input, assistantScope);
    }
    const context = await codexConversationPreparation.context(sessionId, {
      runtime: resolvedRuntime,
      session: resolvedSession
    });
    if (context.ok === false) {
      return { result: context };
    }
    const {
      runtime,
      session,
      executionRoot,
      toolHomeSource,
      workdir
    } = context;
    if (hasOwn(input, "executionProfile") && !isRecord(input.executionProfile)) {
      throw codexAppServerHelperOwnershipError(
        "The low-cost assistant execution profile is invalid."
      );
    }
    const helperTurn = isRecord(input.executionProfile);
    return {
      context,
      helperTurn,
      get helperRestoration() {
        return prepareCodexAppServerHelperRestoration({ runtime, session });
      },
      get projectRuntimeRoot() {
        return runtime.stateRoot;
      },
      get managedIdentity() {
        return codexAppServerManagedThreadIdentity(session, { executionRoot, workdir });
      },
      get providerOptions() {
        return (helperTurn
          ? codexAppServerHelperRuntimeOptionsForSession
          : codexAppServerRuntimeOptionsForSession)(session, {
          runtime, executionRoot, toolHomeSource, workdir
        });
      },
      async project(provider, providerOptions, helperRestore) {
        const agentSettings = isRecord(input.agentSettings) ? input.agentSettings : {};
        return {
          ...context,
          agentSettings,
          actorMetadata: isRecord(input.executionProfile)
            ? {}
            : await currentConversationActorMetadata(input.vibe64User || null),
          helperRestore,
          provider,
          providerOptions
        };
      }
    };
  }

  function codexAppServerConversationThreadPreparation(context = {}) {
    if (context.assistantScope) {
      return { settings: () => codexAppServerReadOnlyThreadSettings(
        codexAppServerThreadSettings({
          agentSettings: context.agentSettings,
          config: context.isolationConfig,
          cwd: context.workdir,
          systemPrompt: context.assistantScope.stableContext
        })
      ) };
    }
    return {
      workdir: context.workdir,
      projectHooks: true,
      settings: config => codexAppServerThreadSettings({
        agentSettings: context.agentSettings,
        config,
        cwd: context.workdir,
        hostContext: vibe64SessionContextInput("temporary")
      })
    };
  }

  function appendCodexAppServerEphemeralProgress(state = {}, classification = {}) {
    const rawText = normalizeText(classification.text);
    const taskResult = normalizeVibe64AgentTaskResult(rawText);
    const text = taskResult?.kind === "continue" ? taskResult.message : rawText;
    if (!text) {
      return;
    }
    const progressUpdates = Array.isArray(state.progressUpdates) ? state.progressUpdates : [];
    if (progressUpdates.at(-1)?.text === text) {
      return;
    }
    state.nextProgressSequence = Number(state.nextProgressSequence || 0) + 1;
    state.progressUpdates = [
      ...progressUpdates,
      {
        id: `progress:${state.nextProgressSequence}`,
        text
      }
    ].slice(-CODEX_APP_SERVER_EPHEMERAL_PROGRESS_LIMIT);
  }

  function codexAppServerConversationExecution(sessionId, input, options, context, conversationState, operation, identity = {}) {
    if (operation === "create") {
      const executionProfile = context.assistantScope && input.executionProfile
        ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : null;
      if (executionProfile && input.ephemeral !== true) throw new Error("Scoped helpers require an ephemeral conversation.");
      return {
        executionProfile,
        get threadPreparation() {
          return executionProfile
            ? codexAppServerHelperThreadStartPreparation({ executionProfile,
                systemPrompt: context.assistantScope.stableContext, ephemeral: true })
            : codexAppServerConversationThreadPreparation(context);
        }
      };
    }
    const { conversationId, prompt } = identity;
    const executionProfile = context.assistantScope ? conversationState?.executionProfile : null;
    if (executionProfile && (input.steer || input.attachments?.length)) throw new Error("Bounded helpers accept supplied text only.");
    if (context.assistantScope && JSON.stringify(executionProfile || null) !==
        JSON.stringify(input.executionProfile ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : null)) {
      throw new Error("The scoped helper execution profile changed. Start a new helper.");
    }
    return {
      executionProfile,
      get threadPreparation() {
        return executionProfile
          ? codexAppServerHelperThreadResumePreparation({
              executionProfile, systemPrompt: context.assistantScope.stableContext })
          : codexAppServerConversationThreadPreparation(context);
      },
      prepareTurn: () => prepareCodexAppServerHelperTurn({
        executionProfile, outputSchema: input.outputSchema, prompt, provider: context.provider, threadId: conversationId
      }),
      authorized: {
        get turnSettings() { return codexAppServerTurnSettings({ agentSettings: context.agentSettings, cwd: context.workdir }); }
      },
      readOnly: Boolean(context.assistantScope),
      actorMetadata: context.actorMetadata,
      onEvent: input.persistent ? options.onEvent : (classification = {}, current) => {
        if (["live_progress", "thinking"].includes(classification.kind)) {
          appendCodexAppServerEphemeralProgress(current, classification);
        }
        options.onEvent?.({ type: "notification", classification, threadId: conversationId,
          turnId: classification.turnId, scopeId: context.assistantScope?.id || "" });
      },
      projectResult(result) {
        if (executionProfile) {
          assertCodexAppServerHelperOutputWithinLimit({ executionProfile, rawOutput: result.text });
        }
        return codexAppServerConversationResponse(result.text);
      }
    };
  }

  function codexAppServerConversationControl(sessionId, input, operation) {
    if (!codexAppServerPromptDeliveryEnabled) {
      return { result: codexAppServerControlDisabledResult() };
    }
    const threadId = normalizeText(input.threadId || input.codexSessionId);
    const turnId = operation === "interrupt" ? normalizeText(input.turnId || input.codexTurnId) : "";
    const frozen = () => operation === "delete"
      ? codexAppServerFrozenThreadDeleteResponse(threadId)
      : codexAppServerFrozenTurnInterruptResponse({ threadId, turnId });
    if (operation === "delete" ? !threadId : !threadId || !turnId) {
      return { result: operation === "delete"
        ? { ok: true, status: "notFound" }
        : codexAppServerInterruptUnavailableResponse({ active: false, threadId, turnId }) };
    }
    const admission = beginTerminalNamespaceOperation(codexTerminalNamespace(sessionId));
    if (admission.ok === false) return { result: frozen() };
    return {
      admission,
      threadId,
      turnId,
      unavailable: () => codexAppServerAdmissionError(sessionId) ? frozen() : null
    };
  }

  return {
    context: codexAppServerConversationPreparation,
    scope: codexAppServerEphemeralScopePreparation,
    execution: codexAppServerConversationExecution,
    control: codexAppServerConversationControl
  };
}

export {
  createCodexScopedConversationPreparation,
  codexAppServerConversationResponse,
  codexAppServerExpiredEphemeralConversation
};
