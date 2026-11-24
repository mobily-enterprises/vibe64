import { vibe64Error } from "@local/vibe64-core/server/core";
import { vibe64Result } from "@local/vibe64-core/server/serverResponses";

/**
 * The session service's result envelope: a thrown error becomes { ok: false }.
 */
function sessionResult(operation, fallbackMessage = "Vibe64 session request failed.") {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_session_request_failed",
    fallbackMessage
  });
}

function publicSession(session = {}, extra = {}) {
  return {
    ...session,
    ...extra,
    ok: true
  };
}

/**
 * An AI task that changes the repository runs its own Update, Save or preparation;
 * nothing else may run one meanwhile. The task's own check names itself.
 * @param {{ store: object }} runtime
 * @param {string} sessionId
 * @param {string} [aiTaskId]
 */
async function refuseDuringRepositoryAiTask(runtime, sessionId, aiTaskId = "") {
  const running = await runningRepositoryAiTask(runtime, sessionId, aiTaskId);
  if (running) throw vibe64Error(running.message, "vibe64_ai_task_active");
}

/**
 * The repository AI task that holds the session's Save and Update, with the reason they wait, or null.
 * @param {{ store: object }} runtime
 * @param {string} sessionId
 * @param {string} [aiTaskId] the task asking, which never holds itself
 * @returns {Promise<{ message: string, title: string } | null>}
 */
async function runningRepositoryAiTask(runtime, sessionId, aiTaskId = "") {
  const conversations = await runtime.store.listSessionConversations(sessionId);
  const running = conversations.find(({ conversationId, task }) => task?.active && task.repository && conversationId !== aiTaskId);
  return running ? { message: `${running.task.title} is still running. Wait for it to finish first.`, title: running.task.title } : null;
}

export { publicSession, refuseDuringRepositoryAiTask, runningRepositoryAiTask, sessionResult };
