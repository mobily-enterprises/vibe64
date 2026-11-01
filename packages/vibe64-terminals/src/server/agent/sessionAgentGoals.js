import { requireCompletedNativeConversationReplacement } from "../assistantChangeover.js";
import { assistantRoutingGoalFromMetadata, goalStatusIsComplete } from "@local/vibe64-runtime/shared/assistantRouting";
import {
  VIBE64_ASSISTANT_SELECTION_METADATA,
  defineVibe64AssistantSelection,
  serializeVibe64AssistantSelection
} from "@local/vibe64-runtime/shared";
import { assistantUser, sessionAssistantSelection } from "./sessionAgentRules.js";

/** @typedef {import("../types.js").SessionAgentBindings} SessionAgentBindings */
/** @typedef {import("../types.js").SessionAgentAccess} SessionAgentAccess */
/** @typedef {import("../types.js").SessionAgentConversationOperations} SessionAgentConversationOperations */

const CANONICAL_GOAL_ENGINE_IDS = new Set(["claude", "codex"]);

function goalOptions(options) {
  const pinned = assistantRoutingGoalFromMetadata(options.session?.metadata);
  if (!pinned?.selection || goalStatusIsComplete(pinned.status)) return options;
  const selection = defineVibe64AssistantSelection(pinned.selection);
  return {
    ...options,
    assistantSelection: selection,
    session: {
      ...options.session,
      metadata: { ...options.session.metadata, [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(selection) }
    }
  };
}

function requireCanonicalGoalSupport(provider, options) {
  if (options.canonicalGoal && !CANONICAL_GOAL_ENGINE_IDS.has(provider.id)) throw Object.assign(new Error(
    "Canonical goal policy is not connected for this assistant."
  ),
    {
    code: "conversation_unsupported"
  });
}

/**
 * Goal reads and controls: a pinned goal keeps its own selection, a stop
 * uses the session's current provider, and canonical goals need an engine
 * that supports them.
 * @param {object} dependencies
 * @param {SessionAgentBindings} dependencies.sessionBindings
 * @param {SessionAgentAccess} dependencies.accessChecks
 * @param {SessionAgentConversationOperations} dependencies.conversationOperations
 */
function createSessionAgentGoals({
  sessionBindings,
  accessChecks,
  conversationOperations
}) {
  async function readGoal(sessionId, options = {}) {
    options = goalOptions(options);
    const provider = sessionBindings.goalProvider(sessionId, options);
    const operation = conversationOperations.providerOperation(provider, "readGoal");
    if (typeof operation !== "function") {
      const result = { status: "unsupported", goal: null };
      if (!options.canonicalGoal) return result;
      // readable-check: allow optional-call - input validation: a canonical goal read's optional result observer
      await options.onGoalResult?.(result, {
        segmentId: null, capabilities: { goals: false, goalBudgets: false, goalCommands: {} }
      });
      return null;
    }
    requireCanonicalGoalSupport(provider, options);
    return operation.call(provider, {
      sessionId,
      runtime: options.runtime,
      session: options.session,
      ...(options.applicationTools ? { applicationTools: options.applicationTools } : {}),
      ...(options.canonicalGoal ? { canonicalGoal: true, onGoalResult: options.onGoalResult } : {}),
      assistantSelection: sessionAssistantSelection(options),
      vibe64User: assistantUser(options)
    });
  }

  async function updateGoal(sessionId, input = {}, options = {}) {
    const stopping = ["pause", "block", "cancel"].includes(input.action);
    if (!stopping) requireCompletedNativeConversationReplacement(options.session, { requireBriefing: true });
    if (stopping) options = goalOptions(options);
    const provider = stopping ? sessionBindings.goalProvider(sessionId, options) : sessionBindings.bindSession(sessionId, options);
    let authorization;
    try {
      authorization = stopping ? null : await accessChecks.requireAccessContext(provider, sessionId, options);
      options.signal?.throwIfAborted();
    } catch (error) {
      // The native goal operation has not been invoked yet.
      error.delivery = "not-sent";
      throw error;
    }
    const operation = conversationOperations.providerOperation(provider, "updateGoal");
    if (typeof operation !== "function") {
      throw new TypeError("This assistant does not support goal controls.");
    }
    requireCanonicalGoalSupport(provider, options);
    return operation.call(provider, {
      sessionId,
      runtime: options.runtime,
      session: options.session,
      signal: options.signal,
      ...(options.browserAuthority ? { browserAuthority: options.browserAuthority } : {}),
      ...(options.applicationTools ? { applicationTools: options.applicationTools } : {}),
      ...(options.canonicalGoal ? { canonicalGoal: true, onGoalResult: options.onGoalResult } : {}),
      assistantSelection: sessionAssistantSelection(options),
      vibe64User: authorization ? authorization.vibe64User : assistantUser(options)
    }, input);
  }

  return Object.freeze({
    readGoal,
    updateGoal
  });
}

export {
  createSessionAgentGoals
};
