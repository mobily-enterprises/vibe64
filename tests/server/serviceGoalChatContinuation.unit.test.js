import assert from "node:assert/strict";
import { test } from "node:test";
import { createServiceGoalChatContinuation } from "../../packages/vibe64-terminals/src/server/serviceGoalChatContinuation.js";

// Standalone Vibe64 has no signed-in person, so Main Claude's Resume carries no user:
// the goal still continues once the turn ends, with no actor, as its restart continuation does.
test("a Resume asked for in a standalone chat, which has no signed-in person, continues the goal once with no actor", async () => {
  let intent = { version: 1, id: "paused-intent", active: false, actor: null, native: { threadId: "thread" } };
  const writes = [];
  const shutdownWork = [];
  const goal = { status: "paused", createdAt: "2026-11-12T00:00:00.000Z", objective: "Finish every check" };
  const continuation = createServiceGoalChatContinuation({
    state: { lifecycle: { closing: false }, assistantRuntime: { authorizeProjectMessage: async actor => actor },
      trackShutdownWork: work => shutdownWork.push(work) },
    logger: { warn() {}, info() {}, error() {} },
    sessionAccess: { projectRuntimeContext: () => ({ projectSlug: "example-project" }) },
    assistantContext: { assistantSessionOptions: async () => ({ session: { metadata: {} } }) },
    sessionAgent: {},
    goalRuntimeId: "this-server",
    readGoalIntent: () => intent,
    changeGoalIntent: async (_sessionId, _context, change) => { intent = change(intent) ?? intent; },
    readCanonicalAgentGoal: async () => ({ goal: { ...goal, id: "goal" }, target: { segmentId: "segment" } }),
    writeAgentGoal: async (sessionId, input, options) => { writes.push({ sessionId, input, options }); return { ok: true }; }
  });

  await continuation.requestResume("session", { runtime: {}, vibe64User: null, threadId: "thread", goal });
  assert.equal(intent.active, true);
  assert.equal(intent.resumeRequested, true);
  assert.equal(intent.actor, null);
  assert.equal(await continuation.resumeAfterTurn("session"), true);
  await Promise.all(shutdownWork);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].input.action, "resume");
  assert.equal(writes[0].input.vibe64User, null);
  assert.deepEqual(writes[0].options, { canonical: true, continuesIntentId: intent.id });
  assert.equal(intent.error, null);
  assert.equal(await continuation.resumeAfterTurn("session"), false, "the asked-for Resume runs once");
});
