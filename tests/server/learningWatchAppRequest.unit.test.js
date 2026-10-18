import assert from "node:assert/strict";
import test from "node:test";
import { createLearningWatchCoordinator, createTrainingLearningWatchSource } from "../../packages/vibe64-training/src/server/learningWatchCoordinator.js";

const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectSlug = "practice-notes";
const sessionId = "learning-session";
const conversationId = "main-conversation";
const browserClientId = "browser-client";
const learningClientId = "learning-client";
const workspace = { projectSlug, sessionId, pane: "preview", ready: true, learningView: "workspace" };

// The original coordinator with a fake Training catalogue: the lesson declares
// POST /api/notes, and every hidden guidance delivery is recorded.
function harness() {
  let clock = 1_000_000;
  const guided = [];
  const actions = { async execute({ actionId, input }) {
    if (actionId === "vibe64.training.polling.read") {
      return { ok: true, task: { attemptId, projectSlug, sessionId, conversationId, criterion: input.criterion,
        pin: { topicHash: "a".repeat(64), lessonHash: "b".repeat(64) },
        appRoutes: [{ method: "POST", path: "/api/notes" }],
        progress: { revision: 3, passedAssessmentIds: [], remainingAssessmentIds: ["add-note"] } } };
    }
    if (actionId === "vibe64.training.polling.guide") {
      assert.equal(input.appRoutes, undefined, "declared routes are task context, not a polling input");
      guided.push(structuredClone(input.evidence));
      return { ok: true, status: "accepted" };
    }
    throw new Error(`Unexpected action ${actionId}`);
  } };
  const coordinator = createLearningWatchCoordinator({ pollMs: 3_600_000, debounceMs: 1, now: () => clock,
    host: { persist: async () => {}, actionContext: () => ({}), closed: () => false } });
  coordinator.registerSource(createTrainingLearningWatchSource(actions));
  const connection = { clientId: browserClientId, browserBinding: { owner: { connected: true } },
    focus: { learningAttemptId: attemptId, projectSlug, sessionId, pane: "preview", learningView: "workspace" },
    learningTask: { attemptId, projectSlug, sessionId, conversationId, learningClientId } };
  const state = { record: { watches: [], observations: [] }, connections: new Map([[browserClientId, connection]]) };
  let eventCount = 0;
  return {
    state, guided, coordinator,
    advance(ms) { clock += ms; },
    async start() {
      const started = await coordinator.start(state, { watchId: "watch-1", criterion: "Add one note" },
        { colleague: { clientId: browserClientId } });
      return started.watch;
    },
    observe(request, extra = {}) {
      eventCount += 1;
      return coordinator.observe(state, { watchId: "watch-1", learningClientId, eventId: `event-${eventCount}`,
        outcome: "failed", control: "app-request", failure: request.status >= 500 ? "http-5xx" : "http-4xx",
        request, workspace, ...extra });
    },
    watch: () => state.record.watches.find(item => item.watchId === "watch-1"),
    async delivered() {
      for (let i = 0; i < 50 && this.watch().pendingGuidance; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(this.watch().pendingGuidance, undefined, "pending guidance was delivered");
    }
  };
}

test("an app-request failure on a declared route reaches Main once as hint-only evidence with its path and status", async t => {
  const h = harness();
  t.after(() => h.coordinator.close());
  const started = await h.start();
  assert.equal(started.lastAppRequestGuidanceAt, undefined);
  await h.observe({ method: "POST", path: "/api/notes", status: 400 });
  const key = JSON.parse(h.watch().pendingGuidance.evidenceKey);
  assert.deepEqual(key.request, { method: "POST", path: "/api/notes", status: 400 });
  await h.delivered();
  assert.deepEqual(h.guided, [{ outcome: "failed", control: "app-request", origin: "learner", failure: "http-4xx",
    request: { method: "POST", path: "/api/notes", status: 400 }, workspace }]);
  h.advance(60_000);
  await h.observe({ method: "POST", path: "/api/notes", status: 400 });
  assert.equal(h.watch().pendingGuidance, undefined, "the same path and status are guided once");
  const published = h.coordinator.publicWatch(h.watch());
  assert.equal(published.lastAppRequestGuidanceAt, undefined, "the cap clock is internal");
});

test("a different app-request failure inside 30 s is recorded but capped; after 30 s it gets its own hint", async t => {
  const h = harness();
  t.after(() => h.coordinator.close());
  await h.start();
  await h.observe({ method: "POST", path: "/api/notes", status: 400 });
  await h.delivered();
  h.advance(10_000);
  await h.observe({ method: "POST", path: "/api/notes", status: 500 });
  assert.equal(h.watch().pendingGuidance, undefined, "one app-request hint per 30 s per watch");
  assert.equal(h.watch().latestObservation.request.status, 500, "the capped observation is still recorded");
  h.advance(21_000);
  await h.observe({ method: "POST", path: "other", status: 500 });
  assert.deepEqual(JSON.parse(h.watch().pendingGuidance.evidenceKey).request, { method: "POST", path: "other", status: 500 });
  await h.delivered();
  assert.equal(h.guided.length, 2);
});

test("app-request evidence is refused unless it is a failure on a declared route or other", async t => {
  const h = harness();
  t.after(() => h.coordinator.close());
  await h.start();
  await assert.rejects(h.observe({ method: "POST", path: "/api/notes/my-secret-title", status: 400 }), /declared/u);
  await assert.rejects(h.observe({ method: "DELETE", path: "/api/notes", status: 400 }), /declared/u);
  await assert.rejects(h.observe({ method: "POST", path: "/api/notes", status: 400 }, { outcome: "confirmed" }), /failed/u);
  await assert.rejects(h.observe({ method: "POST", path: "/api/notes", status: 400 }, { failure: "workspace-settle-failed" }), /failure/u);
  await assert.rejects(h.observe({ method: "POST", path: "/api/notes", status: 400 }, { control: "preview-select" }), /app-request/u);
  assert.equal(h.watch().pendingGuidance, undefined);
  assert.equal(h.guided.length, 0);
});
