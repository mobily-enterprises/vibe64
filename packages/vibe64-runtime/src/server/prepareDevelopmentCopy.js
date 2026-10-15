import { isDeepStrictEqual } from "node:util";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prepareConversationRuntimeCopy, prepareCopiedConversationAgentRun } from "@jskit-ai/assistant-core/server/conversation";

/** Explicitly prepare one session in an offline disposable copy. The caller
 * owns destination isolation and pauses native goals before this operation.
 * Nothing here launches, resumes or stops an execution on either machine.
 */
export async function prepareVibe64DevelopmentCopy({ store, sessionId, at = new Date().toISOString() }) {
  // A copied PID can be alive on the parent or collide with an unrelated guest
  // process. It is never a lock owner in this explicitly offline destination.
  await rm(path.join(store.paths(sessionId).sessionsRoot, ".locks", sessionId), { recursive: true, force: true });
  const conversations = await store.listSessionConversations(sessionId);
  for (const scope of [sessionId, ...conversations.map(({ conversationId }) => ({ sessionId, conversationId }))]) {
    await store.conversationStorage.write(scope, transaction => prepareConversationRuntimeCopy(transaction, { at }));
  }
  for (const run of await store.readAgentRuns(sessionId)) {
    const next = prepareCopiedConversationAgentRun(run, { at });
    if (isDeepStrictEqual(next, run)) continue;
    const { events, ...patch } = next;
    await store.writeAgentRunEvent(sessionId, run.id, { event: events.at(-1), patch });
  }
  for (const task of await store.readBackgroundTasks(sessionId)) {
    if (task.status !== "running") continue;
    await store.writeBackgroundTaskEvent(sessionId, task.id, {
      event: { at, kind: "development-copy", message: "Copied into a stopped development environment." },
      patch: { status: "failed", error: "This background task was running in the parent and was not restarted in the copy." }
    });
  }
}
