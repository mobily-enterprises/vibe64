import path from "node:path";
import { randomUUID } from "node:crypto";
import { codexAppServerTurnState } from "./codexConversationStorage.js";
import { upstreamMessageId } from "./openCodeConversationStorage.js";
import { vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { recordSessionGitCommandActor, sessionGitCommandActorFromMetadata } from "./sessionGitCommandActor.js";
import { clearCodexAppServerContextRefreshPending } from "./codexContextRenewalSignals.js";
import { openCodeModel, openCodeConversationAgent } from "@jskit-ai/assistant-core/server/opencode-process";
import { conversationActorMetadata, conversationReviewActorMetadata } from "./conversationActor.js";
import {
  VIBE64_ASSISTANT_ENGINE_IDS, defineVibe64AssistantSelection,
  vibe64AssistantConversationKey, vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import { sessionClosingReason, sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { terminalNamespaceAdmissionFailure } from "@local/vibe64-execution/server/terminalSessions";
import {
  claudeConversationError, codexTerminalNamespace, codexSessionWorktreeWasRemoved,
  codexSessionWorktreeUnavailableFailure, codexSessionWorkdirAllowed, directoryExists,
  openCodeError, openCodeRuntimeFailure as runtimeFailure, openCodeSessionId, retryableTerminalFailure, terminalSessionSourceRoot, terminalWorktreePath
} from "./terminalShared.js";
import { VIBE64_SESSION_STATUS, conversationMessageIdentity, conversationMessageVersion } from "@local/vibe64-runtime/server/sessionStore";
import {
  codexAppServerThreadIdForSession,
  codexAppServerThreadPreparationForSession,
  codexAppServerToolSchemaIdentityForSession,
  codexAppServerTurnSettings,
  writeCodexAppServerIdentityMetadata
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";

export const MAIN_CONVERSATION_STATE_KEY = "assistant_changeover";
const STATE_KEY = MAIN_CONVERSATION_STATE_KEY;
export const MAIN_CONVERSATION_PRESENTATION = Object.freeze({
  label: "Vibe64 conversation changeover",
  applicationName: "Vibe64",
  contextName: "Vibe64 session",
  sharedContext: "The workspace and visible conversation are shared.",
  replacementUnavailableCode: "vibe64_conversation_replacement_unavailable",
  unconfirmedCode: "vibe64_changeover_delivery_unconfirmed",
  unconfirmedMessage: "The AI may have received this message, but delivery could not be confirmed. Retry this same message to check its receipt without sending it twice. You can still choose another AI."
});

export function requireCompletedNativeConversationReplacement(session, { requireBriefing = false } = {}) {
  const state = JSON.parse(session?.metadata?.[STATE_KEY] || "null");
  if (state?.replacement?.status === "preparing") {
    throw Object.assign(new Error("Native conversation replacement is unfinished. Retry that operation before starting assistant work."),
      { code: "vibe64_conversation_replacement_pending", statusCode: 409 });
  }
  if (requireBriefing && state?.replacement?.status === "ready") {
    throw Object.assign(new Error("Send a chat message to deliver the saved continuity briefing before starting a native terminal or goal."),
      { code: "vibe64_conversation_replacement_briefing_pending", statusCode: 409 });
  }
}

export function requireCompletedConversationRewind(session) {
  requireCompletedNativeConversationReplacement(session);
  const state = JSON.parse(session?.metadata?.[STATE_KEY] || "null");
  if (state?.rewind && !state.rewind.completed) {
    throw Object.assign(new Error("An unfinished conversation Undo from a previous release blocks assistant work. Complete it using the previous release before upgrading."),
      { code: "vibe64_conversation_rewind_pending", statusCode: 409 });
  }
}

export async function requireMainConversationAdmission(runtime, sessionId, current) {
  requireCompletedConversationRewind(current.session || await runtime.getSession(sessionId, { inspectSource: false }));
}

// Only a server-constructed learning runtime can opt into a source-less cwd.
// Its original store reader validates the exact active durable scope each time.
export async function learningSessionExecutionRoot(runtime, sessionId, { allowClosing = false } = {}) {
  if (!runtime?.learningScope) return "";
  if (typeof runtime.getNativeExecutionRoot !== "function") {
    throw new TypeError("Learning sessions require the trusted native execution root reader.");
  }
  const executionRoot = await runtime.getNativeExecutionRoot(sessionId, { allowClosing });
  return runtime.learningScope.noExercise === true ? executionRoot : "";
}

// These are the original application snapshot contracts, not native acquisition.
// Codex takes a full matching snapshot, OpenCode a bounded matching snapshot, and
// Claude retains its captured/pinned snapshot. Native reads never move here.
export async function readSessionConversationContext(engine, projectService, sessionId, options = {}, codexHost) {
  const id = engine === "codex" ? sessionId : engine === "opencode"
    ? openCodeSessionId(sessionId) : String(sessionId ?? "").trim();
  let codex;
  let scope;
  if (engine === "codex") {
    const { allowClosing = false, runtime = null, session = null } = options;
    codex = { allowClosing, runtime, session };
    const admissionFailure = terminalNamespaceAdmissionFailure(codexTerminalNamespace(id));
    if (admissionFailure) return admissionFailure;
  } else if (engine === "opencode") {
    scope = options.assistantScope || null;
    if (scope) return scopedOpenCodeContext(id, scope, options);
  } else {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id)) throw new TypeError("Claude requires a valid session id.");
    scope = options.assistantScope;
    if (scope && scope.id !== id) throw claudeConversationError("Claude conversation scope does not match.");
  }

  const runtime = (codex ? codex.runtime : options.runtime) || (scope
    ? { stateRoot: scope.runtimeRoot }
    : await projectService.createRuntime({ inspectSource: false }));
  let session;
  if (codex) {
    // Full matching snapshot: keep captured inputs before namespace admission.
    session = codex.session?.sessionId === id ? codex.session : await runtime.getSession(id);
  } else if (engine === "opencode") {
    // Bounded matching snapshot: preserve both original options.session reads.
    session = options.session?.sessionId === id ? options.session : await runtime.getSession(id, { inspectSource: false });
  } else {
    // Captured/pinned snapshot: do not replace a supplied Claude goal context.
    session = scope ? null : options.session || await runtime.getSession(id, { inspectSource: false });
  }

  if (codex) return prepareCodexConversationContext(id, runtime, session, codex.allowClosing, codexHost);
  if (engine === "opencode") {
    if (!session) {
      throw openCodeError("vibe64_session_not_found", "Vibe64 session is not available.", { sessionId: id }, 404);
    }
    const workdir = await learningSessionExecutionRoot(runtime, id, { allowClosing: options.allowClosing === true }) || terminalSessionSourceRoot(session);
    if (!workdir || !String(session.sessionRoot ?? "").trim() || !String(runtime.stateRoot ?? "").trim()) {
      throw openCodeError(
        "vibe64_opencode_session_roots_missing",
        "OpenCode cannot start until the session workspace and state roots are ready.",
        { sessionId: id }
      );
    }
    return { key: `${path.resolve(runtime.stateRoot)}\0${id}`, runtime, session, sessionId: id,
      selection: openCodeSelection(session), workdir: path.resolve(workdir) };
  }
  if (!scope && !session) throw claudeConversationError("This session is unavailable.");
  const selection = options.assistantSelection || vibe64AssistantSelectionFromMetadata(session?.metadata);
  if (selection?.engineId !== "claude") throw claudeConversationError("This session does not have a Claude Code selection.");
  const workdir = scope?.workdir || await learningSessionExecutionRoot(runtime, id, { allowClosing: options.allowClosing === true }) || terminalSessionSourceRoot(session);
  if (!path.isAbsolute(workdir || "") || !runtime.stateRoot) throw claudeConversationError("Claude requires a prepared session workspace.");
  return { ...options, runtime, session, assistantSelection: selection, selection, sessionId: id, workdir,
    key: `${path.resolve(runtime.stateRoot)}\0${id}` };
}

function scopedOpenCodeContext(id, assistantScope, options) {
  if (String(assistantScope.id ?? "").trim() !== id) {
    throw openCodeError(
      "vibe64_ephemeral_scope_mismatch",
      "OpenCode ephemeral conversation scope does not match its provider binding."
    );
  }
  const selection = defineVibe64AssistantSelection(options.assistantSelection || {});
  if (selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
    throw openCodeError(
      "vibe64_opencode_selection_required",
      "The ephemeral conversation does not have an OpenCode selection."
    );
  }
  return { assistantScope, key: `ephemeral\0${id}`,
    runtime: { projectContextRoot: assistantScope.workdir, stateRoot: assistantScope.runtimeRoot },
    session: null, sessionId: id, selection, workdir: path.resolve(assistantScope.workdir) };
}

async function prepareCodexConversationContext(sessionId, runtime, session, allowClosing, codexHost) {
  requireCompletedNativeConversationReplacement(session);
  if (sessionIsClosing(session) && !allowClosing) {
    const renewing = String(session.status || "").trim() === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED;
    return {
      code: renewing ? "vibe64_session_renewal_quiesced" : "vibe64_session_closing",
      error: `Session is ${sessionClosingReason(session)} and cannot start Codex.`,
      ok: false
    };
  }
  const learningRoot = await learningSessionExecutionRoot(runtime, sessionId, { allowClosing });
  const executionRoot = learningRoot || terminalSessionSourceRoot(session);
  if (!executionRoot) {
    return retryableTerminalFailure({
      ok: false,
      error: "Vibe64 Codex execution root is not available."
    });
  }
  const workdir = learningRoot || terminalWorktreePath(session);
  if (!learningRoot && codexSessionWorktreeWasRemoved(session)) {
    return codexHost.unavailableWorktree(
      runtime,
      sessionId,
      codexSessionWorktreeUnavailableFailure({
        session,
        workdir
      })
    );
  }
  if (!learningRoot && !codexSessionWorkdirAllowed({
    session,
    executionRoot,
    workdir
  })) {
    return retryableTerminalFailure({
      ok: false,
      error: workdir
        ? "Vibe64 Codex workdir is outside the execution root."
        : "Create the session clone before starting Codex."
    });
  }
  if (!await directoryExists(workdir)) {
    if (learningRoot) {
      throw Object.assign(new Error("The learning native execution directory is unavailable."), {
        code: "vibe64_learning_native_directory_unavailable"
      });
    }
    return codexHost.unavailableWorktree(
      runtime,
      sessionId,
      codexSessionWorktreeUnavailableFailure({
        session,
        workdir
      })
    );
  }
  const toolHome = await codexHost.toolHome(session);
  if (toolHome.ok === false) {
    return toolHome;
  }
  return {
    ok: true,
    runtime,
    session,
    executionRoot,
    toolHomeSource: toolHome.toolHomeSource,
    workdir
  };
}

function openCodeSelection(session = {}) {
  const selection = vibe64AssistantSelectionFromMetadata(session?.metadata, {
    required: false
  });
  if (!selection || selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
    throw openCodeError(
      "vibe64_opencode_selection_required",
      "This session does not have a durable OpenCode selection."
    );
  }
  return selection;
}

// Project cleanup has no conversation identity. This returns configured native
// facilities synchronously; the shared owner retains its original preparation.
export function prepareProjectConversationCleanup(provider, context, input) {
  const host = provider.prepareConversationHost(undefined, context, "projectCleanup");
  if (!host || typeof host.then === "function") {
    throw new TypeError("Project cleanup requires synchronous native host facilities.");
  }
  return { engine: provider.id, native: host.native, context, input };
}

// Account cleanup preserves the native owner's synchronous closing fence.
export function prepareConversationRuntimeInvalidation(provider, context, input) {
  const host = provider.prepareConversationHost(undefined, context, "invalidation");
  if (!host || typeof host.then === "function") {
    throw new TypeError("Runtime invalidation requires synchronous native host facilities.");
  }
  return { engine: provider.id, native: host.native, context, input };
}

// Startup uses the same configured native owner without creating a Main binding.
export function prepareConversationReconciliation(provider, context, sessions, options) {
  const host = provider.prepareConversationHost(undefined, context, "reconciliation");
  if (!host || typeof host.then === "function") {
    throw new TypeError("Reconciliation requires synchronous native host facilities.");
  }
  return { engine: provider.id, native: host.native, context, sessions, options };
}

export function prepareConversationSubscriptionReset(provider, context, sessions) {
  const host = provider.prepareConversationHost(undefined, context, "unsubscription");
  if (!host || typeof host.then === "function") {
    throw new TypeError("Subscription reset requires synchronous native host facilities.");
  }
  return { engine: provider.id, native: host.native, context, sessions };
}

// Explicit readiness prepares the selected host facilities without opening a
// retained binding. Native readiness decisions belong to the common driver.
export async function prepareSessionConversationReadiness(provider, sessionId, context) {
  const request = provider.prepareConversationRequest("ensureSession", context);
  const host = await provider.prepareConversationHost(sessionId, context, "readiness");
  return { sessionId, engine: provider.id, native: host.native, context: request.context };
}

// Creation has no retained native identity. The same admitted application owner
// prepares its input and native facilities without constructing a Main binding.
export async function prepareSessionConversationCreation(provider, sessionId, context, input) {
  const request = provider.prepareConversationRequest("createConversation", context, input);
  const host = await provider.prepareConversationHost(sessionId, context, "create");
  return { sessionId, engine: provider.id, native: host.native, input: request.input, context: request.context };
}

// Activity reads the selected inventory without opening a retained conversation.
export async function prepareSessionConversationActivity(provider, sessionId, context) {
  const host = await provider.prepareConversationHost(sessionId, context, "activity");
  return { sessionId, engine: provider.id, native: host.native,
    context: Object.hasOwn(host, "context") ? host.context : context };
}

// Renewal proof cleanup uses its original trusted lifecycle authority. Facilities
// are synchronous; native owners retain the close/release order and lazy reads.
export function prepareSessionConversationRenewalProof(provider, sessionId, context, input, method) {
  const request = provider.prepareConversationRequest(method, context, input);
  const host = provider.prepareConversationHost(sessionId, context, "renewalProof");
  if (!host || typeof host.then === "function") {
    throw new TypeError("Renewal proof release requires synchronous native host facilities.");
  }
  return { sessionId, engine: provider.id, native: host.native,
    context: Object.hasOwn(request, "context") ? request.context : context,
    input: Object.hasOwn(request, "input") ? request.input : input };
}

// Renewal supplies the original native owner without reading or opening a Main binding.
export async function prepareSessionConversationRenewal(provider, sessionId, context, input) {
  const host = await provider.prepareConversationHost(sessionId, context, "renewal");
  return { sessionId, engine: provider.id, native: host.native, context, input };
}

// Uncached cleanup prepares resource ownership without opening a Main record.
export async function prepareSessionConversationDisposal(provider, sessionId, context, options) {
  const host = await provider.prepareConversationHost(sessionId, context, "dispose");
  return { sessionId, namespace: host.namespace, engine: provider.id, native: host.native, context,
    options: Object.hasOwn(host, "cleanupOptions") ? host.cleanupOptions : options };
}

// Historical source records retain native IDs without the later scoped identity.
// Keep the original provider request codec; no retained binding is constructed.
export async function prepareSessionDetachedConversationCleanup(provider, sessionId, context, input, method) {
  const request = provider.prepareConversationRequest(method, context, input);
  const host = await provider.prepareConversationHost(sessionId, context, "detachedCleanup");
  return { sessionId, engine: provider.id, native: host.native, input: request.input, context: request.context };
}

// Detached execution retains admitted context separately from the original
// provider-specific native options, without opening a Main binding.
export async function prepareSessionDetachedConversationRun(provider, sessionId, context, input, options) {
  const host = await provider.prepareConversationHost(sessionId, context, "detached", input);
  return { sessionId, engine: provider.id, native: host.native, context, input, options };
}

// Storage authority and engine selection come from the saved binding, independently
// of the current assistant. The caller retains preservation and writer exclusion.
export async function prepareSessionConversationStorage(provider, sessionId, context, binding) {
  const host = await provider.prepareConversationHost(sessionId, context, "storage");
  return { sessionId, engine: provider.id, native: host.native, binding, context };
}

// The provider contributes its existing native owner and historical state projection.
// Application binding, admission and transcript ownership are assembled only here.
export async function createSessionConversationBinding(provider, sessionId, options = {}) {
  const { prepareInput, ...openingContext } = options;
  const engine = provider.id;
  const selection = engine === "codex" ? openingContext.selection : undefined;
  if (engine === "codex") delete openingContext.selection;
  const scoped = (openingContext.assistantScope || openingContext.routingConversationId) && openingContext.scopedConversationId;
  const conversationId = scoped ? String(openingContext.scopedConversationId ?? "").trim() : "";
  if (scoped) requireScopedConversationContext(sessionId, openingContext, conversationId,
    engine === "codex" ? "The scoped conversation must retain its original scope and native identity." : undefined);
  const host = await provider.prepareConversationHost(sessionId, openingContext, scoped ? "scoped" : "main");
  if (scoped) return {
    sessionId, namespace: `${host.namespace}\0${conversationId}`, engine,
    native: { ...host.native, scoped: { conversationId, context: openingContext } }
  };
  const { runtime, session } = host.context;
  const original = createMainConversationBinding(runtime.store, sessionId, {
    runtime, session, readSession: () => runtime.getSession(sessionId, { inspectSource: false })
  });
  const conversation = original.conversation({ engine, publish: host.publish, checkpoint: host.checkpoint });
  const teachingAvailable = ["codex", "opencode"].includes(engine) && runtime.learningScope && runtime.learningTeaching;
  let teaching;
  const bindTeaching = () => runtime.learningTeaching.bindConversation({ runtime, sessionId, actions: openingContext.teachingActions,
      terminals: openingContext.teachingTerminals, native: {
        ...(engine === "codex" || typeof host.native.owner.readFinalAssistantResult === "function" ? {
          readFinalAssistantResult({ threadId, turnId }) {
            // Read the existing final owner, scoped to this immutable Main session.
            const result = engine === "codex"
              ? host.native.runOwner.readFinalAssistantResult(sessionId, threadId, turnId)
              : host.native.owner.readFinalAssistantResult(host.context.key, threadId, turnId);
            return result ? structuredClone(result) : null;
          }
        } : {}),
        notifyPresentation: event => host.publish(sessionId, event),
        async readTurn() {
        if (engine === "codex") {
          const current = await host.state.read();
          return { ...codexAppServerTurnState(current.session),
            assistantSelection: vibe64AssistantSelectionFromMetadata(current.session.metadata) };
        }
        const native = await host.native.owner.readSessionState(openingContext, host.native.preparation.state);
        const current = await runtime.getSession(sessionId, { inspectSource: false });
        return { threadId: native.thread.id, turnId: native.turn.id, active: native.turn.active,
          outerTurnId: `opencode:${native.thread.id}:${native.turn.id}`,
          assistantSelection: vibe64AssistantSelectionFromMetadata(current.metadata) };
      } } });
  const binding = {
    ...conversation, namespace: host.namespace, engine,
    prepareInput: engine === "codex" && typeof prepareInput === "function" ? async (input, current) => {
      const prepared = await prepareInput(input, current);
      return { ...prepared, actorContext: prepared.vibe64User || null };
    } : prepareInput,
    ...(engine === "codex" ? { selection } : {}),
    async admission(current) {
      if (engine !== "codex") return requireMainConversationAdmission(runtime, sessionId, current);
      const session = await runtime.getSession(sessionId, { inspectSource: false });
      requireCompletedConversationRewind(session);
      if (vibe64AssistantSelectionFromMetadata(session.metadata).engineId !== "codex") {
        throw new Error("The selected assistant changed. Open its current conversation.");
      }
    },
    async read(current, representation, nativeResult) {
      const value = await host.state.read(current, representation, nativeResult);
      if (!Object.hasOwn(value, "session")) return value;
      const configuration = vibe64AssistantSelectionFromMetadata(value.session.metadata);
      return { threadId: value.threadId, configuration,
        ...(Object.hasOwn(value, "run") ? { run: value.run } : {}),
        ...(Object.hasOwn(value, "turn") ? { turn: value.turn } : {}),
        delivery: await original.state.read(), nativeResult: value.nativeResult };
    },
    ...(host.state.readIdentity ? { identity: { ...conversation.identity, read: host.state.readIdentity,
      ...(host.state.readToolSchemaIdentity ? { readToolSchemaIdentity: host.state.readToolSchemaIdentity } : {}) } } : {}),
    native: engine === "codex" ? {
      ...host.native,
      messagePreparation: createCodexMainMessagePreparation(sessionId, host.messageEnvironment, host.native.messagePreparation)
    } : host.native
  };
  if (teachingAvailable) Object.defineProperty(binding, "applicationTools", {
    enumerable: true,
    get() {
      // Only the descriptor retained by the original runtime initializes this
      // facility. Routine opens may prepare a descriptor then reuse its cached
      // predecessor; they must not retire that predecessor's browser evidence.
      teaching ||= bindTeaching();
      return teaching.applicationTools;
    }
  });
  return binding;
}

// Main message policy runs at the existing native owner's preparation and
// completion phases. Native context/startup and failure health remain host
// facilities; this binding owns actor admission, Genesis rendering and receipts.
function createCodexMainMessagePreparation(sessionId, env, nativePreparation) {
  return {
    readContext: nativePreparation.readContext,
    threadPreparation: nativePreparation.threadPreparation,
    async prepareMessage(input, prepared, { starting, selected }) {
      const { runtime, executionRoot, workdir, messageId, actorContext: vibe64User } = prepared;
      const learningRoot = await learningSessionExecutionRoot(runtime, sessionId);
      if (learningRoot && (executionRoot !== learningRoot || workdir !== learningRoot)) {
        throw new Error("Learning message preparation belongs to a different native execution root.");
      }
      if (!starting) {
        const { turnOwnership } = prepared;
        const { session: currentSession, threadId, turnId } = selected;
        const ownershipMatchesTurn = Boolean(
          turnOwnership &&
          normalizeMessageText(turnOwnership.threadId) === threadId &&
          normalizeMessageText(turnOwnership.turnId) === turnId
        );
        if (ownershipMatchesTurn && turnOwnership.reusable !== true) {
          return { value: {
            code: "vibe64_agent_turn_owner_conflict",
            delivered: false,
            error: "This assistant turn belongs to another user. Your message will be sent when that turn finishes.",
            ok: false,
            operationOutcome: "active_turn_owned_by_another_user",
            refreshRecommended: true,
            retryable: true,
            threadId,
            turnId
          }, session: currentSession };
        }
        if (learningRoot) return null;
        let actorMetadata = ownershipMatchesTurn && turnOwnership.reusable === true
          ? sessionGitCommandActorFromMetadata(currentSession)
          : null;
        if (actorMetadata?.ok !== true) {
          actorMetadata = await recordSessionGitCommandActor({
            env,
            reason: "agent-message",
            runtime,
            session: currentSession,
            sourceRoot: executionRoot,
            threadId,
            vibe64User,
            workdir
          });
        } else {
          vibe64SessionDebugLog("server.codexTerminal.appServerMessage.turnOwnershipReused", {
            messageId,
            sessionId,
            threadId,
            turnId
          });
        }
        if (actorMetadata?.ok === false) {
          return { value: {
            code: actorMetadata.code || "vibe64_codex_turn_steer_failed",
            error: actorMetadata.error || "GitHub identity is not available for the user who authorized this assistant message.",
            ok: false,
            operationOutcome: "steer_git_actor_unavailable",
            refreshRecommended: true,
            threadId,
            turnId
          } };
        }
        return null;
      }
      const { agentSettings, preparedSession, thread, userRequest } = prepared;
      let stageStartedAt = Date.now();
      const actorResult = learningRoot ? null : await recordSessionGitCommandActor({
        env,
        overwrite: true,
        reason: "codex-prompt",
        runtime,
        session: preparedSession,
        sourceRoot: executionRoot,
        threadId: thread.threadId,
        vibe64User,
        workdir
      });
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
        durationMs: Date.now() - stageStartedAt,
        messageId,
        sessionId,
        stage: "git-actor"
      });
      if (actorResult?.ok === false) {
        throw new Error(actorResult.error || "GitHub identity is not available for the user who authorized this Codex prompt.");
      }
      const refreshMetadata = preparedSession.metadata || {};
      const providerContextRefreshPending = codexContextRefreshPending(preparedSession);
      stageStartedAt = Date.now();
      const genesisTask = normalizeMessageText(input.genesisTask);
      const needsOpeningPrompt = !sessionBriefingIsDelivered(preparedSession) &&
        !normalizeMessageText(preparedSession.metadata?.renewal_handover_delivered_at);
      const rendered = genesisTask || needsOpeningPrompt
        ? await runtime.renderPrompt(sessionId, {
            input,
            request: userRequest,
            task: genesisTask || "start"
          })
        : { prompt: userRequest };
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
        durationMs: Date.now() - stageStartedAt,
        messageId,
        sessionId,
        stage: "prompt-render"
      });
      const renderedPrompt = normalizeMessageText(rendered?.prompt);
      if (!renderedPrompt) {
        throw new Error("The assistant prompt is empty.");
      }
      vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.prepared", {
        messageCount: 1,
        messageId,
        sessionId,
        threadId: thread.threadId
      });
      prepared.refreshMetadata = refreshMetadata;
      prepared.providerContextRefreshPending = providerContextRefreshPending;
      return {
        renderedPrompt,
        get turnSettings() { return codexAppServerTurnSettings({ agentSettings, cwd: workdir }); }
      };
    },
    finishMessage(input, prepared, outcome) {
      if (Object.hasOwn(outcome, "error")) {
        return nativePreparation.finishMessage(input, prepared, outcome);
      }
      return recordCodexMainMessageDelivery(sessionId, prepared);
    }
  };
}

async function recordCodexMainMessageDelivery(sessionId, prepared) {
  const { runtime } = prepared;
  const { preparedSession, effectiveSettings, providerContextRefreshPending, refreshMetadata, thread } = prepared;
  const briefingWasDelivered = !sessionBriefingIsDelivered(preparedSession);
  const deliveredAt = new Date().toISOString();
  await runtime.store.mutateSession(sessionId, async () => {
    await Promise.all([
      runtime.store.writeMetadataValue(sessionId, "agent_settings_model", effectiveSettings.model),
      runtime.store.writeMetadataValue(sessionId, "agent_settings_provider", effectiveSettings.providerId),
      runtime.store.writeMetadataValue(sessionId, "agent_settings_thinking", effectiveSettings.thinking),
      ...(briefingWasDelivered ? [
        runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered", "yes"),
        runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered_at", deliveredAt),
        runtime.store.writeMetadataValue(sessionId, "agent_briefing_transport", "codex_app_server")
      ] : [])
    ]);
  });
  if (providerContextRefreshPending) {
    await clearCodexAppServerContextRefreshPending(runtime.store, sessionId, {
      delivery: "prompt",
      reason: refreshMetadata.codex_context_refresh_reason,
      threadId: refreshMetadata.codex_context_refresh_thread_id || thread.threadId,
      turnId: refreshMetadata.codex_context_refresh_turn_id
    });
  }
}

function normalizeMessageText(value) {
  return String(value || "").trim();
}

export function sessionBriefingIsDelivered(session = {}) {
  return normalizeMessageText(session.metadata?.agent_briefing_delivered) === "yes";
}

function codexContextRefreshPending(session = {}) {
  return normalizeMessageText(session.metadata?.codex_context_refresh_pending) === "yes";
}

// The existing Claude owner shares this application policy across its retained entries.
// Main/scoped/renewal predicates remain the original distinct rules.
export function createClaudeConversationMessagePolicy({ env, recordGitActor, publishSessionChanged }) {
  const error = claudeConversationError;
  const ENGINE = "claude";
  const text = value => String(value ?? "").trim();
  async function prepareMessage(entry, input, { context: ctx, message, steering, renewal }) {
    if (entry.profile && message.length > entry.profile.limits.maxInputCharacters) throw error("Claude helper input exceeded its limit.");
    const learningRoot = await learningSessionExecutionRoot(ctx.runtime, ctx.sessionId);
    if (!ctx.assistantScope && !entry.profile && !learningRoot) {
      const actor = await recordGitActor({ env, overwrite: !steering, reason: "agent-message", runtime: ctx.runtime,
        session: ctx.session, sourceRoot: ctx.workdir, threadId: entry.id, vibe64User: ctx.vibe64User, workdir: ctx.workdir });
      if (actor?.ok === false) throw error(actor.error, actor.code);
    }
    let prompt = message;
    if (!renewal && entry.main && !/^\/goal(?:\s|$)/u.test(message) && ((!steering && !entry.sent) || input.genesisTask)) {
      prompt = (await ctx.runtime.renderPrompt(ctx.sessionId, { input, request: message, task: input.genesisTask || "start" }))?.prompt || message;
    }
    // The attachment owner already added validated paths to the prompt.
    if (input.attachments?.length && (entry.profile || ctx.assistantScope)) {
      throw error("These attachments cannot be passed to Claude.");
    }
    return prompt;
  }

  return {
    skipAdmission(entry, event) { return !entry.main || event.renewal; },
    check(entry, ctx) {
      if (entry.turn?.active && ctx.turnOwnership?.reusable === false) throw error("This turn belongs to another user.", "vibe64_agent_turn_owner_conflict");
    },
    prepareMessage,
    async messageMetadata(_entry, event) {
      const { input, context: ctx } = event;
      return { ...input.turnMetadata, ...await conversationActorMetadata({ vibe64User: ctx.vibe64User }),
        ...conversationReviewActorMetadata(input.turnMetadata) };
    },
    async admitMessage(_entry, event) {
      const { input, context: ctx, message, messageId, uuid, actorMetadata } = event;
      const conversationTurn = await ctx.runtime.store.writeConversationUserMessage(ctx.sessionId, {
        messageId, text: text(input.displayMessage) || message, attachments: input.displayAttachments,
        turnMetadata: { ...actorMetadata, assistantSelection: ctx.selection, engineId: ENGINE, upstreamMessageId: uuid }
      });
      await publishSessionChanged(ctx.sessionId, { reason: "claude-stream-message-delivered", payload: {
        conversationLogPatch: { type: "upsert-turn", turn: conversationTurn }
      } });
      return conversationTurn;
    }
  };
}

export function createOpenCodeMainMessagePreparation({ projectService, env, recordGitActor, hostPreparation, events, presentation }) {
  const text = (value = "") => String(value ?? "").trim();
  const { prepareProcess, storedUpstreamSessionId, upstreamSessionOptions } = hostPreparation;
  const { writeRun, messageMonitorProjection } = events;
  const { publishConversationTurn } = presentation;

  async function contextFor(sessionId = "", options = {}) {
    return readSessionConversationContext("opencode", projectService, sessionId, options);
  }

  async function prepareMessageInput(sessionId = "", input = {}, options = {}) {
    const message = text(input.message);
    if (!message) {
      return { value: {
        code: "vibe64_opencode_message_empty",
        delivered: false,
        error: "OpenCode message input is empty.",
        ok: false
      } };
    }
    const context = await contextFor(sessionId, options);
    const messageId = text(input.messageId) || randomUUID();
    return { context, message, messageId };
  }

  async function prepareMessage(sessionId = "", input = {}, options = {}) {
    const prepared = await prepareMessageInput(sessionId, input, options);
    if (Object.hasOwn(prepared, "value")) return prepared;
    const { context, message, messageId } = prepared;
    return { context, message, messageId, get key() { return context.key; }, input: {
      duplicate: undefined,
      get id() { return upstreamMessageId(messageId); },
      get threadId() { return storedUpstreamSessionId(context); },
      get workdir() { return context.workdir; },
      onPromptRejected: () => input.onPromptRejected?.()
    }, application: {
      writeRun: (turn, state, error) => writeRun(context, turn, state, error),
      monitor: messageMonitorProjection(context, options.applicationTools),
      async prepare() {
        const process = await prepareProcess(context, options);
        return { process, get session() { return upstreamSessionOptions(context, options); } };
      },
      commit(conversationTurn) {
        return publishConversationTurn(context, conversationTurn, "opencode-server-message-delivered");
      }
    }, project(result, actorFailure) {
      if (result.ownerConflict) {
        return {
          code: "vibe64_agent_turn_owner_conflict",
          delivered: false,
          error: "This assistant turn belongs to another user. Your message will be sent when that turn finishes.",
          ok: false,
          refreshRecommended: true,
          retryable: true,
          thread: { id: result.threadId },
          turn: result.turn
        };
      }
      if (result.failure) {
        const { error, threadId: currentThreadId, recovery } = result.failure;
        if (recovery) return runtimeFailure(error);
        if (actorFailure) {
          return actorFailure;
        }
        const failureCode = text(error?.code).replace(/^assistant_opencode_/u, "vibe64_opencode_");
        if (failureCode.startsWith("vibe64_opencode_")) {
          return {
            code: failureCode,
            delivered: false,
            error: text(error?.message) || "OpenCode prompt delivery failed.",
            ok: false,
            refreshRecommended: true,
            retryable: error?.retryable === true || ["vibe64_opencode_start_timeout", "vibe64_opencode_events_timeout"].includes(failureCode),
            thread: { id: currentThreadId },
            turn: result.failure.turn
          };
        }
        throw error;
      }
      return result;
    } };
  }

  async function prepareMessageInspection(sessionId = "", input = {}, options = {}) {
    const messageId = text(input.messageId);
    if (!messageId) {
      throw openCodeError("vibe64_opencode_message_id_required", "Admission inspection requires a message ID.");
    }
    const context = await contextFor(sessionId, options);
    const threadId = storedUpstreamSessionId(context);
    if (text(input.threadId) !== threadId) {
      throw openCodeError("vibe64_opencode_thread_mismatch", "Admission inspection requires the original assistant thread.");
    }
    return {
      process: await prepareProcess(context, options), threadId,
      get inputMessageId() { return upstreamMessageId(messageId); },
      project(observation) {
        if (!observation) return { ok: true, admission: "unknown", messageId, threadId };
        const { accepted } = observation;
        return { ok: true, admission: accepted ? "accepted" : "unknown", messageId, threadId,
          turnId: accepted ? upstreamMessageId(messageId) : "" };
      }
    };
  }

  return {
    inspection: prepareMessageInspection,
    contextFor,
    prepareMessageInput,
    async message(sessionId = "", input = {}, options = {}) {
      const prepared = await prepareMessage(sessionId, input, options);
      if (Object.hasOwn(prepared, "value")) return prepared;
      const { context, message, messageId } = prepared;
      const duplicate = typeof context.runtime.store?.conversationMessageIdExists === "function" &&
        await context.runtime.store.conversationMessageIdExists(context.sessionId, messageId);
      let actorFailure = null;
      let actorMetadata = null;
      prepared.input.duplicate = duplicate;
      return { key: prepared.key, input: prepared.input, application: {
        writeRun: prepared.application.writeRun,
        monitor: prepared.application.monitor,
        async prepare({ overwrite, threadId }) {
          const learningRoot = await learningSessionExecutionRoot(context.runtime, context.sessionId);
          const actor = learningRoot ? null : await recordGitActor({
            env,
            overwrite,
            reason: "agent-message",
            runtime: context.runtime,
            session: context.session,
            sourceRoot: terminalSessionSourceRoot(context.session),
            threadId,
            vibe64User: options.vibe64User || null,
            workdir: context.workdir
          });
          if (actor?.ok === false) {
            actorFailure = {
              code: actor.code || "vibe64_opencode_git_actor_unavailable",
              delivered: false,
              error: actor.error || "GitHub identity is not available for this OpenCode message.",
              ok: false,
              refreshRecommended: true,
              retryable: true
            };
            throw new Error(actorFailure.error);
          }
          return prepared.application.prepare();
        },
        async prompt() {
          actorMetadata = { ...input.turnMetadata, ...await conversationActorMetadata({
            vibe64User: options.vibe64User || null
          }), ...conversationReviewActorMetadata(input.turnMetadata) };
          const genesisTask = text(input.genesisTask);
          const conversation = genesisTask
            ? null
            : await context.runtime.store.readConversationLogPage(context.sessionId, { limit: 1 });
          const needsOpeningPrompt = Boolean(
            genesisTask || (
              !conversation?.pagination?.totalTurnCount &&
              text(context.session?.metadata?.agent_briefing_delivered) !== "yes" &&
              !text(context.session?.metadata?.renewal_handover_delivered_at)
            )
          );
          const rendered = needsOpeningPrompt
            ? await context.runtime.renderPrompt(context.sessionId, {
                input,
                request: message,
                task: genesisTask || "start"
              })
            : { prompt: message };
          const renderedPrompt = text(rendered?.prompt) || message;
          return {
            get agent() { return context.runtime.learningScope && context.runtime.learningTeaching && options.applicationTools
              ? openCodeConversationAgent({ tools: true }) : context.selection.agentId; },
            get model() { return openCodeModel(context.selection); },
            get prompt() { return { text: renderedPrompt }; },
            get attachments() { return input.attachments; },
            beforeDispatch: threadId => input.onPromptSending?.({
              threadId, displayAttachments: input.displayAttachments, turnMetadata: actorMetadata
            })
          };
        },
        async commit(admitted) {
          const conversationTurn = await context.runtime.store.writeConversationUserMessage(
            context.sessionId,
            {
              attachments: input.displayAttachments,
              ...(context.runtime.learningScope && context.runtime.learningTeaching && input.data !== undefined
                ? { data: input.data } : {}),
              messageId,
              text: text(input.displayMessage) || message,
              turnMetadata: {
                ...input.turnMetadata,
                assistantSelection: context.selection,
                ...actorMetadata,
                engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
                upstreamMessageId: text(admitted?.id)
              }
            }
          );
          await prepared.application.commit(conversationTurn);
          return conversationTurn;
        }
      }, project(result) {
        return prepared.project(result, actorFailure);
      } };
    }
  };
}

export function requireScopedConversationContext(sessionId, context, conversationId,
  message = "A scoped conversation requires its original scope and native identity.") {
  if (!conversationId || (context.assistantScope
    ? context.assistantScope.id !== sessionId
    : context.session?.sessionId !== sessionId || !context.runtime)) {
    throw new TypeError(message);
  }
}

export async function openMainConversation(conversationRuntime, context, prepareInput, representation = "native") {
  if (!conversationRuntime || context.assistantScope) return null;
  return conversationRuntime.open({ id: context.sessionId, representation,
    context: { ...context, ...(prepareInput ? { prepareInput } : {}) } });
}

export async function publishMainConversationEvent(namespaceForSession, publishApplicationSessionChanged, publishConversation, sessionId, event, applicationEvent = event) {
  await publishApplicationSessionChanged(sessionId, applicationEvent);
  if (publishConversation) await publishConversation({ namespace: namespaceForSession(sessionId), sessionId, event });
}

// The original files remain authoritative. This composition does not open a
// provider, copy a native run, create a runtime record or subscribe to output.
export function createMainConversationBinding(store, sessionId, context) {
  const binding = {
    state: {
      async read() {
        const saved = await store.readMetadataValue(sessionId, STATE_KEY);
        return saved ? JSON.parse(saved) : undefined;
      },
      write: (value) => saveState(store, sessionId, value),
      transaction: (callback) => store.mutateSession(sessionId, () => callback({
        write: (value) => saveState(store, sessionId, value),
        async releaseBinding(replacement) {
          for (const name of replacement.bindingNames) await store.deleteMetadataValue(sessionId, name);
          // A stopped terminal's resume command must not advertise the predecessor.
          await store.deleteMetadataValue(sessionId, "agent_resume_command");
          const current = context.readSession ? await context.readSession() : context.session;
          for (const run of current.agentRuns || []) {
            if (run.providerThreadId === replacement.previous.conversationId || run.threadId === replacement.previous.conversationId) {
              await store.writeAgentRunEvent(sessionId, run.id, {
                event: { kind: "native-context-replaced" },
                patch: { providerThreadId: "", threadId: "", providerTurnId: "", turnId: "", providerGoalThreadId: "" }
              });
            }
          }
        }
      }))
    },
    identity: context && {
      async inspect(expectedId) {
        const current = context.readSession ? await context.readSession() : context.session;
        const selection = vibe64AssistantSelectionFromMetadata(current.metadata);
        const metadata = current.metadata;
        const fail = (message) => { throw Object.assign(new Error(message), {
          code: "vibe64_conversation_replacement_unavailable", statusCode: 409
        }); };
        if (metadata.agent_identity_provider !== selection.engineId || metadata.agent_identity_conversation_id !== expectedId ||
            !metadata.agent_identity_workdir) fail("The native predecessor identity changed or is incomplete.");
        const bindingNames = Object.keys(metadata).filter((name) =>
          (name === "agent_identity_conversation_id" || /^(?:codex(?:_[a-z0-9_-]+)?|claude|opencode)_conversation_id$/u.test(name)) &&
          metadata[name] === expectedId);
        if (bindingNames.length < 2) fail("The native conversation binding is incomplete.");
        if (selection.engineId === "codex" && Object.hasOwn(metadata, "codex_conversation_tool_schema_identity")) {
          bindingNames.push("codex_conversation_tool_schema_identity");
        }
        return { bindingNames, previous: { conversationId: expectedId, assistantSelection: selection,
          modelProviderId: metadata.codex_routing_home_provider || metadata.agent_identity_model_provider || selection.modelProviderId,
          workdir: metadata.agent_identity_workdir } };
      }
    },
    transcript: {
      history: () => readMainConversationHistory(store, sessionId),
      readConversationLog: () => store.readConversationLog(sessionId),
      readConversationLogPage: query => store.readConversationLogPage(sessionId, query),
      hasMessage: (messageId) => store.conversationMessageIdExists(sessionId, messageId),
      async writeUserMessage(message) {
        const current = context.readSession ? await context.readSession() : context.session;
        return store.writeConversationUserMessage(sessionId, {
          ...message,
          turnMetadata: { ...message.turnMetadata,
            assistantSelection: vibe64AssistantSelectionFromMetadata(current.metadata) }
        });
      }
    },
    conversation({ publish, checkpoint, engine = "codex" }) {
      if (!context?.runtime || context.runtime.store !== store || context.session?.sessionId !== sessionId ||
          typeof publish !== "function" || checkpoint !== undefined && typeof checkpoint !== "function") {
        throw new TypeError("A main conversation requires its original runtime, session and publication facilities.");
      }
      const { runtime, session } = context;
      return {
        sessionId,
        runtime,
        state: binding.state,
        identity: binding.identity,
        transcript: binding.transcript,
        readStream: () => runtime.store.readConversationStream(sessionId),
        presentation: MAIN_CONVERSATION_PRESENTATION,
        publish: ({ nativeGoal: _nativeGoal, ...event }) => publish(sessionId, event),
        ...(checkpoint ? { checkpoint: input => checkpoint(sessionId, input) } : {}),
        ...(engine === "codex" ? {
          preparation(input) {
            return codexAppServerThreadPreparationForSession({ ...input, runtime, session });
          },
          identity: {
            ...binding.identity,
            read: workdir => codexAppServerThreadIdForSession(session, workdir),
            async readToolSchemaIdentity(workdir = session.nativeExecutionRoot || terminalWorktreePath(session)) {
              return codexAppServerToolSchemaIdentityForSession({ metadata: await store.readMetadata(sessionId) }, workdir);
            },
            write({ appServerRuntime, threadId, toolSchemaIdentity, workdir }) {
              return writeCodexAppServerIdentityMetadata({ appServerRuntime, runtime, sessionId, threadId, toolSchemaIdentity, workdir });
            }
          }
        } : {})
      };
    }
  };
  return binding;
}

function saveState(store, sessionId, state) {
  return store.writeMetadataValue(sessionId, STATE_KEY, JSON.stringify(state));
}

function turnConversationKey(turn) {
  const selection = turn.metadata?.assistantSelection || turn.metadata;
  return selection?.engineId === "codex" ? "codex" : vibe64AssistantConversationKey(selection);
}

// The transcript remains authoritative. Delivery cursors and pending native
// writes share one record so Send and AI changes use the same boundary.
export async function readMainConversationHistory(store, sessionId) {
  const turns = await store.readConversationLog(sessionId);
  return turns.flatMap((turn) => (turn.messages || []).filter((message) => (
    message.role !== "thinking"
  )).map((message) => {
    const id = conversationMessageIdentity(turn.turnId, message);
    const content = { role: message.role, text: message.text, attachments: message.attachments || [] };
    return {
      id,
      ...content,
      messageId: message.messageId,
      ...(message.receipt === false ? { receipt: false } : {}),
      engineId: turnConversationKey(turn) || "",
      assistantSelection: turn.metadata?.assistantSelection,
      originalVersion: turn.metadata?.nativeMessageVersions?.[id],
      version: conversationMessageVersion(content)
    };
  }));
}
