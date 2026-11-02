import { AppError } from "@jskit-ai/kernel/server/runtime";
import { VIBE64_ASSISTANT_SELECTION_METADATA, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import {
  assistantRoutingGoalFromMetadata,
  assistantWorkflowStateIsSupported,
  assistantWorkflowMessageIds
} from "@local/vibe64-runtime/shared/assistantRouting";

/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

const STATE_KEY = "assistant_routing_request";
// Messages the person cancelled in this chat, newest last and bounded. A send
// never admits one again, and a snapshot never offers one for recovery.
const CANCELLED_KEY = "assistant_cancelled_messages";
const MAX_CANCELLED_MESSAGES = 50;

const activeMessage = state => state.followup || state.input;
const usesWorkPlan = state => state.planInvolved === true;
function failure(message, code) {
  return new AppError(409, message, { code });
}
function parseRequest(value) {
  const request = value ? JSON.parse(value) : null;
  if (request && request.schemaVersion !== 5) {
    throw failure("Saved workflow needs the candidate stopped-service state upgrade.", "vibe64_assistant_workflow_upgrade_required");
  }
  if (request && !assistantWorkflowStateIsSupported(request)) {
    throw failure("Saved workflow has an unsupported state. Inspect it before continuing.", "vibe64_assistant_workflow_invalid");
  }
  return request;
}
/** The saved request whose routed message or automatic follow-up is the given turn. */
function assistantRoutingRequestForMessage(metadata, isMessage) {
  const request = parseRequest(metadata?.[STATE_KEY]);
  return request && assistantWorkflowMessageIds(request).some(isMessage) ? request : null;
}
/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
function read(store, sessionId) {
  return store.readMetadataValue(sessionId, STATE_KEY).then(parseRequest);
}
function parseCancelled(value) {
  try {
    const list = JSON.parse(value || "[]");
    return Array.isArray(list) ? list.filter(entry => typeof entry?.messageId === "string" && entry.messageId) : [];
  } catch {
    return [];
  }
}
/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
const readCancelled = async (store, sessionId) => parseCancelled(await store.readMetadataValue(sessionId, CANCELLED_KEY));
/** The ids of the messages the person cancelled in this chat. */
function assistantCancelledMessageIds(metadata) {
  return parseCancelled(metadata?.[CANCELLED_KEY]).map(entry => entry.messageId);
}

/** Only the host's stopped disposable copy may drop these process handles. */
function prepareCopiedAssistantRouting(metadata = {}) {
  const patch = {};
  if (metadata.assistant_goal_intent) patch.assistant_goal_intent = "null";
  const request = parseRequest(metadata[STATE_KEY]);
  if (request) {
    if (request.status !== "complete") {
      Object.assign(request, {
        stopped: true,
        status: "waiting",
        error: "Copied workflow is stopped. Inspect retained delivery before continuing."
      });
    }
    if (request.helper) request.helper.executionId = "";
    // Keep uncertain delivery and the original message/turn receipt intact.
    patch[STATE_KEY] = JSON.stringify(request);
  }
  const goal = assistantRoutingGoalFromMetadata(metadata);
  if (goal?.status === "active") patch.assistant_routing_goal = JSON.stringify({ ...goal, status: "paused" });
  return patch;
}
/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {number} limit
 */
async function recentVisibleMessages(store, sessionId, limit) {
  const turns = await store.readConversationTail(sessionId, { userLimit: limit });
  return turns.flatMap((turn) => [
    ...(turn.user ? [{
      role: "user",
      text: turn.user.text,
      ...(turn.metadata?.actorId === "app" || turn.metadata?.assistantRouting?.parentMessageId ? { automatic: true } : {})
    }] : []),
    ...(turn.messages || []).filter(({ role }) => role === "assistant").map(({ text }) => ({ role: "assistant", text }))
  ]).slice(-limit);
}
function withSelection(context, selection) {
  return {
    ...context,
    assistantSelection: selection,
    session: {
      ...context.session,
      metadata: {
        ...context.session.metadata,
        [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(selection)
      }
    }
  };
}

export {
  CANCELLED_KEY,
  MAX_CANCELLED_MESSAGES,
  STATE_KEY,
  activeMessage,
  assistantCancelledMessageIds,
  assistantRoutingRequestForMessage,
  failure,
  prepareCopiedAssistantRouting,
  read,
  readCancelled,
  recentVisibleMessages,
  usesWorkPlan,
  withSelection
};
