import {
  createSessionConversationBinding,
  prepareSessionConversationActivity,
  prepareSessionConversationCreation,
  prepareSessionConversationRenewal,
  prepareSessionConversationRenewalProof,
  prepareSessionConversationReadiness,
  prepareSessionConversationSettings,
  prepareSessionConversationDisposal,
  prepareProjectConversationCleanup,
  prepareConversationRuntimeInvalidation,
  prepareConversationReconciliation,
  prepareConversationSubscriptionReset,
  prepareSessionDetachedConversationCleanup,
  prepareSessionDetachedConversationRun,
  prepareSessionConversationStorage
} from "./mainConversationBinding.js";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";

/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").ServiceGoals} ServiceGoals */
/** @typedef {import("./types.js").ServiceAssistant} ServiceAssistant */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */

function realtimeDebugEnabled(env = {}) {
  return ["1", "true", "yes", "on"].includes(String(env.JSKIT_REALTIME_DEBUG || "").trim().toLowerCase());
}

/**
 * The host side of Main's conversation runtime: authorizing a browser's conversation request, and
 * preparing the native binding for each conversation operation, with goal control for an admitted
 * Claude Main turn.
 * @param {object} dependencies
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {ServiceGoals} dependencies.goals
 * @param {ServiceAssistant} dependencies.assistant
 * @param {ActionCatalogue | null} dependencies.actions
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger | null} dependencies.logger
 * @param {ProjectService} dependencies.projectService
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {SessionConversations} dependencies.sessionConversations
 */
function createServiceMainConversationHost({
  assistantContext,
  goals,
  assistant,
  actions,
  env,
  logger,
  projectService,
  sessionAgent,
  sessionConversations
}) {
  async function authorizeMainConversation({ context, conversationId, operation }) {
    if (context?.sessionId !== conversationId) return false;
    const authority = context.browserAuthority;
    if (!authority) return true; // Existing, already-authorized manager callers.
    if (!actions || authority.sessionId !== conversationId) return false;
    // Delayed publications retain CONTROL identity, never a cached access grant.
    const readGrant = () => actions.execute({
      actionId: "vibe64.sessions.conversation.context.read",
      input: { projectSlug: authority.projectSlug, sessionId: conversationId },
      context: authority.requestContext
    });
    const started = performance.now();
    let allowed = false;
    try {
      const grant = await (context.browserProjectContext
        ? runWithProjectRequestContext(context.browserProjectContext, readGrant) : readGrant());
      allowed = grant.actor.id === authority.actorId;
      return allowed;
    } finally {
      const durationMs = performance.now() - started;
      // Stream publications also reauthorize as "subscribe". Retain slow or
      // denied checks without adding a log write for every healthy token.
      if ((operation !== "subscribe" || !allowed || durationMs >= 100) &&
          realtimeDebugEnabled(env)) {
        logOperationalEvent(logger, "warn", { event: "vibe64.conversation.browser_timing",
          sessionId: conversationId, phase: "authorization", operation, allowed,
          durationMs }, "Browser conversation authorization timing.");
      }
    }
  }

  function prepareMainConversationOperation({ id, context, input, options, operation }) {
    if (operation === "closeProject") {
      return prepareProjectConversationCleanup(
        sessionAgent.conversationProvider(context.providerId), context, input
      );
    }
    if (operation === "invalidateRuntimes") {
      return prepareConversationRuntimeInvalidation(
        sessionAgent.conversationProvider(context.providerId), context, input
      );
    }
    if (operation === "reconcileSessions") {
      return prepareConversationReconciliation(
        sessionAgent.conversationProvider(context.providerId), context, input, options
      );
    }
    if (operation === "releaseRenewalPredecessorProcessExitProof" || operation === "releaseRenewalSuccessorProcessExitProof") {
      return prepareSessionConversationRenewalProof(
        sessionAgent.conversationProvider(context.providerId), id, context, input, operation
      );
    }
    if (operation === "inspectTemporaryActivity") {
      return prepareSessionConversationActivity(sessionAgent.conversationProvider(context.providerId), id, context);
    }
    if (operation === "unsubscribeSessions") {
      return prepareConversationSubscriptionReset(
        sessionAgent.conversationProvider(context.providerId), context, input
      );
    }
    return (async () => {
      if (operation === "listNativeConversationStorage" || operation === "retireConversationHistory") {
        return prepareSessionConversationStorage(
          sessionAgent.conversationProvider(input.engineId), id, context, input
        );
      }
      if (operation === "runDetachedConversation") {
        return prepareSessionDetachedConversationRun(
          sessionAgent.conversationProvider(context.providerId), id, context, input, options
        );
      }
      if (operation === "interruptDetachedConversation" || operation === "deleteDetachedConversation") {
        return prepareSessionDetachedConversationCleanup(
          sessionAgent.conversationProvider(context.providerId), id, context, input,
          operation === "interruptDetachedConversation" ? "interruptDetachedChatTurn" : "deleteDetachedChatThread"
        );
      }
      if (operation !== "create" && operation !== "ensure" && operation !== "updateSettings" && operation !== "dispose" &&
          operation !== "generateRenewalHandover" && operation !== "seedRenewalHandover" && context.temporaryConversationId && !context.scopedConversationId && !context.assistantScope) {
        return sessionConversations.conversationBinding(id, context);
      }
      const engine = context.providerId || context.assistantSelection?.engineId || vibe64AssistantSelectionFromMetadata(context.session?.metadata).engineId;
      const provider = sessionAgent.conversationProvider(engine, "codex");
      if (operation === "generateRenewalHandover" || operation === "seedRenewalHandover") {
        return prepareSessionConversationRenewal(provider, id, context, input);
      }
      if (operation === "create") return prepareSessionConversationCreation(provider, id, context, input);
      if (operation === "ensure") return prepareSessionConversationReadiness(provider, id, assistantContext.applicationToolManifest(context));
      if (operation === "updateSettings") return prepareSessionConversationSettings(provider, id, context);
      if (operation === "dispose") return prepareSessionConversationDisposal(provider, id, context, input);
      // Scoped work already has its own authorized host and native identity;
      // opening its existing handle must not hydrate a project session.
      if (context.assistantScope) return createSessionConversationBinding(provider, id, context);
      const runtime = context.runtime || await projectService.createRuntime({ inspectSource: false });
      const binding = await createSessionConversationBinding(provider, id, {
        ...context, runtime,
        prepareInput: (input, current) => current.prepareInput ? current.prepareInput(input) : input
      });
      if (engine === "claude" && !runtime.learningScope && !binding.native?.scoped && !context.temporaryConversationId && actions) {
        binding.applicationTools = {
          storage: runtime.store.conversationStorage,
          async prepareContext(current, admitted) {
            const authority = current.browserAuthority;
            if (!authority || authority.sessionId !== id || admitted.conversationId !== id ||
                admitted.origin !== "user" || !admitted.nativeThreadId || !admitted.nativeTurnId) {
              throw Object.assign(new Error("Goal control requires the current admitted Main request."), {
                code: "vibe64_main_goal_control_required", statusCode: 403
              });
            }
            const grant = await actions.execute({ actionId: "vibe64.sessions.conversation.context.read",
              input: { projectSlug: authority.projectSlug, sessionId: id }, context: authority.requestContext });
            if (grant.actor.id !== authority.actorId) throw new Error("The Main conversation's acting user changed.");
            await assistant.requireAssistantSelectionAccess(current.assistantSelection, { vibe64User: grant.user });
            admitted.assertCurrent();
            async function retainGoal(action, reason) {
              const options = { runtime, vibe64User: grant.user };
              const observed = await goals.readAgentGoal(id, options);
              if (observed.threadId !== admitted.nativeThreadId || !observed.goal || observed.goal.status !== "active") {
                throw new Error("This admitted Main turn no longer owns an active goal.");
              }
              admitted.assertCurrent();
              const result = await goals.updateAgentGoal(id, { ...options, action, reason,
                threadId: observed.threadId, createdAt: observed.goal.createdAt, objective: observed.goal.objective });
              const status = action === "block" ? "blocked" : "paused";
              if (result?.ok === false || result?.goal?.status !== status) {
                throw new Error(result?.error || `The goal ${action} could not be verified.`);
              }
              return { status };
            }
            return { ...authority.requestContext, runtime, assistantSelection: current.assistantSelection,
              projectSlug: authority.projectSlug,
              mainGoalControl: {
                pause: () => retainGoal("pause"),
                block: ({ reason }) => retainGoal("block", reason)
              }
            };
          }
        };
      }
      return binding;
    })();
  }

  return Object.freeze({
    authorizeMainConversation,
    prepareMainConversationOperation
  });
}

export {
  createServiceMainConversationHost,
  realtimeDebugEnabled
};
