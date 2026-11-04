import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

const MAIN_CONVERSATION_PREFIX = "vibe64-main:";
const AI_TASK_CONVERSATION_PREFIX = "vibe64-temporary:";

function invalidConversation(kind) {
  return new AppError(400, `Invalid ${kind} conversation identity.`, { code: "vibe64_conversation_identity_invalid", params: { kind } });
}

/**
 * A transport selector for the existing project/session pair, never a stored
 * identity or native thread identifier.
 */
function mainConversationId({ projectSlug, sessionId } = {}) {
  if (typeof projectSlug !== "string" || !projectSlug.trim() ||
      typeof sessionId !== "string" || !sessionId.trim()) {
    throw new TypeError("A Main conversation requires a project and session.");
  }
  return `${MAIN_CONVERSATION_PREFIX}${JSON.stringify([projectSlug, sessionId])}`;
}

function mainConversationTarget(id) {
  if (typeof id !== "string" || !id.startsWith(MAIN_CONVERSATION_PREFIX)) return null;
  let target;
  try {
    target = JSON.parse(id.slice(MAIN_CONVERSATION_PREFIX.length));
  } catch {
    throw invalidConversation("Main");
  }
  if (!Array.isArray(target) || target.length !== 2 ||
      target.some(value => typeof value !== "string" || !value.trim())) {
    throw invalidConversation("Main");
  }
  return { projectSlug: target[0], sessionId: target[1] };
}

function aiTaskConversationId({ projectSlug, sessionId, conversationId } = {}) {
  if ([projectSlug, sessionId, conversationId].some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("An AI task conversation requires its project, session and saved logical identity.");
  }
  return `${AI_TASK_CONVERSATION_PREFIX}${JSON.stringify([projectSlug, sessionId, conversationId])}`;
}

function aiTaskConversationTarget(id) {
  if (typeof id !== "string" || !id.startsWith(AI_TASK_CONVERSATION_PREFIX)) return null;
  let target;
  try {
    target = JSON.parse(id.slice(AI_TASK_CONVERSATION_PREFIX.length));
  } catch {
    throw invalidConversation("temporary");
  }
  if (!Array.isArray(target) || target.length !== 3 || target.some(value => typeof value !== "string" || !value.trim())) {
    throw invalidConversation("temporary");
  }
  return { projectSlug: target[0], sessionId: target[1], conversationId: target[2] };
}

export { mainConversationId, mainConversationTarget, aiTaskConversationId, aiTaskConversationTarget };
