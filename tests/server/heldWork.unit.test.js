import assert from "node:assert/strict";
import test from "node:test";
import { createHeldRequests } from "@local/vibe64-core/server/heldRequests";
import { createHeldWork } from "@local/vibe64-core/server/heldWork";

// Held work is what a request starts and answers before it ends, so a slow dependency (a workspace preparation, a
// lock, a build) never keeps the request past a proxy's minute: a host's long routes and the editor's own use it as
// the Main chat send does (heldMessages.js).

function recordingLogger() {
  const logged = [];
  const logger = {
    child() { return logger; },
    debug() {},
    error: fields => logged.push({ level: "error", ...fields }),
    info: fields => logged.push({ level: "info", ...fields }),
    warn: fields => logged.push({ level: "warn", ...fields })
  };
  return { logged, logger };
}

async function eventually(check, message) {
  const until = Date.now() + 2_000;
  while (!(await check())) {
    if (Date.now() > until) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("held work answers a quick result or refusal as it is, and later work as held, joined by every run for its key",
  async () => {
    const { logged, logger } = recordingLogger();
    const work = createHeldWork({ component: "test.work", logger, answerMs: 20, outcomeMs: 60 });
    try {
      assert.deepEqual(await work.run("quick", async () => ({ ok: true, value: 1 })), {
        settled: true,
        result: { ok: true, value: 1 }
      });
      await assert.rejects(work.run("refused", async () => { throw Object.assign(new Error("No."), { code: "no" }); }),
        { code: "no" });

      const finish = Promise.withResolvers();
      let started = 0;
      const slow = ({ stage }) => {
        started += 1;
        stage("waiting-for-lock");
        return finish.promise;
      };
      const first = await work.run("slow", slow);
      assert.equal(first.settled, false);
      assert.equal(first.waitingFor, "waiting-for-lock");
      assert.match(first.operationId, /^[0-9a-f-]{36}$/u);
      const joined = await work.run("slow", slow);
      assert.equal(joined.operationId, first.operationId);
      assert.equal(started, 1);
      const pending = work.inspect("slow");
      assert.equal(pending.operationId, first.operationId);
      assert.equal(pending.settled, false);
      assert.equal(pending.waitingFor, "waiting-for-lock");
      assert.ok(pending.elapsedMs >= 0);

      finish.resolve({ ok: true, built: "release-7" });
      await eventually(() => work.inspect("slow")?.settled, "the held work's outcome was not kept");
      assert.deepEqual(work.inspect("slow").result, { ok: true, built: "release-7" });
      const timing = logged.find(entry => entry.event === "test.work.timing" && entry.held === true);
      assert.equal(timing.level, "warn");
      assert.equal(timing.component, "test.work");
      assert.ok(Number.isFinite(timing.stages["waiting-for-lock"]) && Number.isFinite(timing.stages.finished));
      assert.ok(logged.some(entry => entry.event === "test.work.held" && entry.waitingFor === "waiting-for-lock"));

      // Ended work is started again by the next run for its key, under a new operation; an old outcome is forgotten.
      const again = await work.run("slow", async () => {
        await new Promise(resolve => setTimeout(resolve, 40));
        return { ok: true, built: "release-8" };
      });
      assert.equal(again.settled, false);
      assert.notEqual(again.operationId, first.operationId);
      await eventually(() => work.inspect("slow") === null, "an old outcome was kept");
      assert.equal(work.inspect("never-run"), null);
    } finally {
      await work.close();
    }
  });

test("held work awaits its held hook before the held answer and its settled hook before its outcome is read",
  async () => {
    const calls = [];
    const finish = Promise.withResolvers();
    const work = createHeldWork({
      component: "test.hooks",
      answerMs: 20,
      fields: operation => ({ target: operation.key }),
      async held(operation) {
        calls.push(["held", operation.key, operation.settled]);
      },
      async settled(operation) {
        calls.push(["settled", operation.key, operation.heldAnswer, operation.result?.ok ?? null]);
        throw new Error("A settled hook's failure is not the work's.");
      }
    });
    try {
      const answer = await work.run("hooked", () => finish.promise);
      assert.equal(answer.settled, false);
      assert.deepEqual(calls, [["held", "hooked", false]]);
      finish.resolve({ ok: true });
      await eventually(() => work.inspect("hooked")?.settled, "the work did not settle");
      assert.deepEqual(calls, [["held", "hooked", false], ["settled", "hooked", true, true]]);
      assert.deepEqual(work.inspect("hooked").result, { ok: true });
      // A quick result calls no held hook.
      await work.run("quick", async () => ({ ok: true }));
      assert.equal(calls.some(([name, key]) => name === "held" && key === "quick"), false);
    } finally {
      await work.close();
    }
  });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test("an archive's timing names its session and request, and gives each stage's duration beside its start", async () => {
  const { logged, logger } = recordingLogger();
  const archives = createHeldRequests({
    component: "vibe64.session_archive",
    heldAs: "archiving",
    logger,
    notFollowed: { code: "not_followed", error: "Not followed." },
    scopeNames: ["sessionId"]
  });
  try {
    const result = await archives.run(["session-7"], { requestId: "request-1" }, async (request, { stage }) => {
      stage("stopping");
      await pause(20);
      stage("preparing");
      await pause(80);
      stage("source");
      return { ok: true };
    });
    assert.deepEqual(result, { ok: true });
    const timing = logged.find(entry => entry.event === "vibe64.session_archive.timing");
    assert.equal(timing.sessionId, "session-7");
    assert.equal(timing.requestId, "request-1");
    assert.deepEqual(Object.keys(timing.stageMs), ["received", "stopping", "preparing", "source"]);
    // Each stage lasts until the next starts; the last until the work finished.
    assert.equal(timing.stageMs.stopping, timing.stages.preparing - timing.stages.stopping);
    assert.equal(timing.stageMs.preparing, timing.stages.source - timing.stages.preparing);
    assert.equal(timing.stageMs.source, timing.stages.finished - timing.stages.source);
    assert.ok(timing.stageMs.preparing >= 75, `preparing took ${timing.stageMs.preparing} ms`);
    assert.ok(timing.stageMs.stopping < timing.stageMs.preparing);
  } finally {
    await archives.close();
  }
});

test("a held answer going out inside a stage is no stage of its own in the timing's durations", async () => {
  const { logged, logger } = recordingLogger();
  const work = createHeldWork({ component: "test.answered", logger, answerMs: 20 });
  try {
    const answer = await work.run("slow", async ({ stage }) => {
      stage("stopping");
      await pause(60);
      stage("source");
      return { ok: true };
    }, { sessionId: "session-8" });
    assert.equal(answer.settled, false);
    await eventually(() => work.inspect("slow")?.settled, "the work did not settle");
    const timing = logged.find(entry => entry.event === "test.answered.timing");
    assert.ok(Number.isFinite(timing.stages.answered));
    assert.equal("answered" in timing.stageMs, false);
    assert.equal(timing.stageMs.stopping, timing.stages.source - timing.stages.stopping);
    assert.equal(timing.sessionId, "session-8");
    assert.equal(logged.find(entry => entry.event === "test.answered.held").sessionId, "session-8");
  } finally {
    await work.close();
  }
});

test("closing held work aborts each running work's signal and waits for it to end", async () => {
  const work = createHeldWork({ component: "test.close", answerMs: 20 });
  let aborted = false;
  const answer = await work.run("long", ({ signal }) => new Promise((resolve) => {
    signal.addEventListener("abort", () => {
      aborted = true;
      resolve({ ok: false, code: "stopping" });
    }, { once: true });
  }));
  assert.equal(answer.settled, false);
  await work.close();
  assert.equal(aborted, true);
  assert.deepEqual(work.inspect("long").result, { ok: false, code: "stopping" });
});
