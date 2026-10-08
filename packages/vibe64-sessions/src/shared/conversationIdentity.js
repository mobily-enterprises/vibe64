const MAIN_CONVERSATION_PREFIX = "vibe64-main:";
const TEMPORARY_CONVERSATION_PREFIX = "vibe64-temporary:";

function validLearningAttempt(value) {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
}

function invalidConversation(kind) {
  return Object.assign(new TypeError(`Invalid ${kind} conversation identity.`), {
    code: "conversation_input_invalid", statusCode: 400
  });
}

// A transport selector for the existing project/session pair or an actual
// learning attempt/session, never a stored identity or native thread identifier.
function mainConversationId({ projectSlug, sessionId, learningAttemptId } = {}) {
  if (learningAttemptId !== undefined) {
    if (projectSlug || !validLearningAttempt(learningAttemptId) || typeof sessionId !== "string" || !sessionId.trim()) {
      throw invalidConversation("Main learning");
    }
    return `${MAIN_CONVERSATION_PREFIX}${JSON.stringify({ learningAttemptId, sessionId })}`;
  }
  if (typeof projectSlug !== "string" || !projectSlug.trim() ||
      typeof sessionId !== "string" || !sessionId.trim()) {
    throw new TypeError("A Main conversation requires a project and session.");
  }
  return `${MAIN_CONVERSATION_PREFIX}${JSON.stringify([projectSlug, sessionId])}`;
}

function mainConversationTarget(id) {
  if (typeof id !== "string" || !id.startsWith(MAIN_CONVERSATION_PREFIX)) return null;
  let target;
  try { target = JSON.parse(id.slice(MAIN_CONVERSATION_PREFIX.length)); }
  catch { throw invalidConversation("Main"); }
  if (target && !Array.isArray(target) && Object.keys(target).length === 2 &&
      validLearningAttempt(target.learningAttemptId) && typeof target.sessionId === "string" && target.sessionId.trim()) {
    return { learningAttemptId: target.learningAttemptId, sessionId: target.sessionId };
  }
  if (!Array.isArray(target) || target.length !== 2 ||
      target.some(value => typeof value !== "string" || !value.trim())) {
    throw invalidConversation("Main");
  }
  return { projectSlug: target[0], sessionId: target[1] };
}

function temporaryConversationId({ projectSlug, sessionId, conversationId } = {}) {
  if ([projectSlug, sessionId, conversationId].some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("A temporary conversation requires its project, session and saved logical identity.");
  }
  return `${TEMPORARY_CONVERSATION_PREFIX}${JSON.stringify([projectSlug, sessionId, conversationId])}`;
}

function temporaryConversationTarget(id) {
  if (typeof id !== "string" || !id.startsWith(TEMPORARY_CONVERSATION_PREFIX)) return null;
  let target;
  try { target = JSON.parse(id.slice(TEMPORARY_CONVERSATION_PREFIX.length)); }
  catch { throw invalidConversation("temporary"); }
  if (!Array.isArray(target) || target.length !== 3 || target.some(value => typeof value !== "string" || !value.trim())) {
    throw invalidConversation("temporary");
  }
  return { projectSlug: target[0], sessionId: target[1], conversationId: target[2] };
}

export { mainConversationId, mainConversationTarget, temporaryConversationId, temporaryConversationTarget };
