import { isNativeConversationBindingKey } from "./nativeConversationRetirement.js";
import { vibe64AssistantConversationKey, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { conversationMessageIdentity, conversationMessageVersion } from "@local/vibe64-runtime/server/sessionStore";
import {
  codexAppServerThreadIdForSession,
  codexAppServerThreadPreparationForSession,
  codexAppServerToolSchemaIdentityForSession,
  writeCodexAppServerIdentityMetadata
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { requireCompletedNativeConversationReplacement, STATE_KEY } from "./mainConversationContext.js";
import { createCodexMainMessagePreparation } from "./mainConversationMessages.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").OpenCodeHostPreparation} OpenCodeHostPreparation */
/** @typedef {import("./types.js").OpenCodeConversationEvents} OpenCodeConversationEvents */
/** @typedef {import("./types.js").OpenCodeConversationPresentation} OpenCodeConversationPresentation */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {typeof import("./sessionGitCommandActor.js").recordSessionGitCommandActor} RecordSessionGitCommandActor */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

export const MAIN_CONVERSATION_PRESENTATION = Object.freeze({
  label: "Vibe64 conversation changeover",
  applicationName: "Vibe64",
  contextName: "Vibe64 session",
  sharedContext: "The workspace and visible conversation are shared.",
  replacementUnavailableCode: "vibe64_conversation_replacement_unavailable",
  unconfirmedCode: "vibe64_changeover_delivery_unconfirmed",
  unconfirmedMessage: "The AI may have received this message, but delivery could not be confirmed. Retry this same message to check its receipt without sending it twice. You can still choose another AI."
});

export function requireCompletedConversationRewind(session) {
  requireCompletedNativeConversationReplacement(session);
  const state = JSON.parse(session?.metadata?.[STATE_KEY] || "null");
  if (state?.rewind && !state.rewind.completed) {
    throw Object.assign(new Error("An unfinished conversation Undo from a previous release blocks assistant work. Complete it using the previous release before upgrading."),
      { code: "vibe64_conversation_rewind_pending", statusCode: 409 });
  }
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {object} current
 */
export async function requireMainConversationAdmission(runtime, sessionId, current) {
  requireCompletedConversationRewind(current.session || await runtime.getSession(sessionId, { inspectSource: false }));
}

function synchronousConversationHost(provider, sessionId, context, purpose, label) {
  const host = provider.prepareConversationHost(sessionId, context, purpose);
  // readable-check: allow method-probe - data: a conversation host is prepared synchronously, never as a promise
  if (!host || typeof host.then === "function") {
    throw new TypeError(`${label} requires synchronous native host facilities.`);
  }
  return host;
}

// Project cleanup has no conversation identity. This returns configured native
// facilities synchronously; the shared owner retains its original preparation.
export function prepareProjectConversationCleanup(provider, context, input) {
  const host = synchronousConversationHost(provider, undefined, context, "projectCleanup", "Project cleanup");
  return { engine: provider.id, native: host.native, context, input };
}

// Account cleanup preserves the native owner's synchronous closing fence.
export function prepareConversationRuntimeInvalidation(provider, context, input) {
  const host = synchronousConversationHost(provider, undefined, context, "invalidation", "Runtime invalidation");
  return { engine: provider.id, native: host.native, context, input };
}

// Startup uses the same configured native owner without creating a Main binding.
export function prepareConversationReconciliation(provider, context, sessions, options) {
  const host = synchronousConversationHost(provider, undefined, context, "reconciliation", "Reconciliation");
  return { engine: provider.id, native: host.native, context, sessions, options };
}

export function prepareConversationSubscriptionReset(provider, context, sessions) {
  const host = synchronousConversationHost(provider, undefined, context, "unsubscription", "Subscription reset");
  return { engine: provider.id, native: host.native, context, sessions };
}

// Explicit readiness prepares the selected host facilities without opening a
// retained binding. Native readiness decisions belong to the common driver.
export async function prepareSessionConversationReadiness(provider, sessionId, context) {
  const request = provider.prepareConversationRequest("ensureSession", context);
  const host = await provider.prepareConversationHost(sessionId, context, "readiness");
  return { sessionId, engine: provider.id, native: host.native, context: request.context };
}

export async function prepareSessionConversationSettings(provider, sessionId, context) {
  const host = await provider.prepareConversationHost(sessionId, context, "settings");
  return { sessionId, engine: provider.id, native: host.native, context };
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
  const host = synchronousConversationHost(provider, sessionId, context, "renewalProof", "Renewal proof release");
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
  const binding = {
    ...conversation, namespace: host.namespace, engine,
    prepareInput: engine === "codex" && typeof prepareInput === "function" ? async (input, current) => {
      const prepared = await prepareInput(input, current);
      return { ...prepared, actorContext: prepared.vibe64User || null };
    } : prepareInput,
    ...(host.readContextUsage ? {
      async maximumHistoryBytes({ context, signal, input, handover, setPhase }) {
        // Count UTF-8 bytes conservatively instead of assuming English text's
        // usual characters/token ratio. Keep normal model settings unchanged.
        // The window already ends at the native auto-compaction point.
        const room = async () => {
          const { usedTokens, windowTokens } = await host.readContextUsage({ context, signal, input });
          if (!Number.isSafeInteger(usedTokens) || usedTokens < 0 ||
              !Number.isSafeInteger(windowTokens) || windowTokens < 1) {
            throw Object.assign(new Error("The selected assistant's context usage is unavailable. Retry after reconnecting it."),
              { code: "vibe64_assistant_context_unavailable", statusCode: 503 });
          }
          const reserve = Math.max(32_768, Math.ceil(windowTokens * 0.05));
          const requestBytes = Buffer.byteLength(String(input.message || "")) +
            Buffer.byteLength(JSON.stringify(handover || ""));
          return windowTokens - usedTokens - reserve - requestBytes - 4096;
        };
        let bytes = await room();
        // A nearly full native context is summarised in place, exactly as its
        // own automatic compaction would, before the missed history is sized.
        if (bytes < 32_768 && host.compactContext) {
          try {
            await setPhase?.("compacting");
            // A working turn cannot be summarised, but it compacts itself as
            // it works, so the message joins it with the history that fits.
            if (await host.compactContext({ context, signal, input }) === false) return Math.max(bytes, 1024);
          } catch (error) {
            if (signal?.aborted) throw error;
            throw Object.assign(new Error(`The assistant's memory is full and could not be summarised automatically: ${error.message} Your chat is saved; try again.`),
              { code: "vibe64_assistant_context_full", statusCode: 409 });
          } finally {
            await setPhase?.("preparing");
          }
          bytes = await room();
        }
        if (bytes < 1024) {
          throw Object.assign(new Error("The assistant's memory is too full to receive this conversation. Your chat is saved; try again, or switch to another assistant."),
            { code: "vibe64_assistant_context_full", statusCode: 409 });
        }
        return bytes;
      }
    } : {}),
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
  return binding;
}

// Claude message preparation marks these stages on JSKIT's delivery observer.
export const CLAUDE_PREPARATION_DELIVERY_STAGES = Object.freeze(["git-actor", "genesis-rendered"]);

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

/**
 * The original files remain authoritative. This composition does not open a
 * provider, copy a native run, create a runtime record or subscribe to output.
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {object} context
 */
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
          (name === "agent_identity_conversation_id" || isNativeConversationBindingKey(name)) &&
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
      ...(store.findSubmittedConversationTurn ? { findSubmittedTurn: (messageId) => store.findSubmittedConversationTurn(sessionId, messageId) } : {}),
      ...(store.readConversationLogTurn ? { readTurn: (turnId) => store.readConversationLogTurn(sessionId, turnId) } : {}),
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
            async readToolSchemaIdentity(workdir = session.nativeExecutionRoot || sessionSourcePath(session)) {
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

/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {object} state
 */
function saveState(store, sessionId, state) {
  return store.writeMetadataValue(sessionId, STATE_KEY, JSON.stringify(state));
}

function turnConversationKey(turn) {
  // readable-check: allow no-dual-shape - data: a turn names its assistant in metadata.assistantSelection, and a changeover notice only by its metadata's own engineId
  const selection = turn.metadata?.assistantSelection || turn.metadata;
  return selection?.engineId === "codex" ? "codex" : vibe64AssistantConversationKey(selection);
}

/**
 * The transcript remains authoritative. Delivery cursors and pending native
 * writes share one record so Send and AI changes use the same boundary.
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
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

export {
  learningSessionExecutionRoot,
  readClaudeConversationOwnerContext,
  readSessionConversationContext,
  requireCompletedNativeConversationReplacement
} from "./mainConversationContext.js";
export {
  createClaudeConversationMessagePolicy,
  createOpenCodeMainMessagePreparation,
  sessionBriefingIsDelivered
} from "./mainConversationMessages.js";
