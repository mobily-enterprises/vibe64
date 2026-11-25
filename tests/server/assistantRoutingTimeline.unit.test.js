import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { flushSessionTimeline } from "@local/vibe64-core/server/sessionTimeline";
import { readSessionTimeline } from "@local/vibe64-core/server/sessionTimelineCli";
import { withRoutingTimeline } from "../../packages/vibe64-terminals/src/server/assistantRoutingTimeline.js";

// A routed request whose delivery fails or is refused leaves a line on its session's timeline, with the refusal's
// code, the stage and role it was for and whether it was an automatic next step; the delivery's own error is thrown
// on exactly as it was, and a delivery that works, or only inspects, records nothing.

const SESSION = "2026-11-25_09-00-00";

async function fixture(t) {
  const projectRuntimeRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-routing-timeline-"));
  t.after(() => rm(projectRuntimeRoot, { recursive: true, force: true }));
  const calls = [];
  let outcome = null;
  const delivery = withRoutingTimeline({
    async deliver(...args) {
      calls.push(args);
      if (outcome) throw outcome;
      return { delivered: true };
    },
    other: "kept"
  });
  const context = { runtime: { stateRoot: projectRuntimeRoot }, vibe64User: { username: "ada", email: "ada@example.test" } };
  const state = { messageId: "m-1", mode: "auto", resolvedMode: "senior", stage: "review", delivery: "pending", status: "working" };
  return {
    calls,
    context,
    delivery,
    state,
    fail(error) { outcome = error; },
    async lines() {
      await flushSessionTimeline();
      return readSessionTimeline(projectRuntimeRoot, SESSION, { kinds: new Set(["routing"]) });
    }
  };
}

test("a refused automatic next step is recorded with its code and thrown on unchanged", async (t) => {
  const f = await fixture(t);
  const refusal = Object.assign(new Error("The plan changed since the review was asked for."), { code: "vibe64_followup_plan_changed" });
  f.fail(refusal);
  await assert.rejects(f.delivery.deliver(SESSION, f.context, f.state, true), (error) => error === refusal);
  assert.deepEqual(f.calls, [[SESSION, f.context, f.state, true, false]], "the delivery is called exactly as it was");
  const [line, ...rest] = await f.lines();
  assert.deepEqual(rest, []);
  assert.equal(line.kind, "routing");
  assert.equal(line.event, "followup-refused");
  assert.equal(line.code, "vibe64_followup_plan_changed");
  assert.equal(line.chat, "main");
  assert.equal(line.message, "m-1");
  assert.equal(line.role, "senior");
  assert.equal(line.stage, "review");
  assert.equal(line.by, "ada");
  assert.ok(!JSON.stringify(line).includes("ada@example.test"), "never the person's email");
  assert.ok(!JSON.stringify(line).includes("The plan changed"), "codes, never messages");
});

test("a failed first delivery is recorded as not delivered, in its temporary chat", async (t) => {
  const f = await fixture(t);
  f.fail(Object.assign(new Error("engine gone"), { code: "vibe64_engine_unavailable" }));
  await assert.rejects(f.delivery.deliver(SESSION, { ...f.context, routingConversationId: "side-1" }, f.state), /engine gone/u);
  const [line] = await f.lines();
  assert.equal(line.event, "delivery-failed");
  assert.equal(line.chat, "temporary");
  assert.equal(line.conversation, "side-1");
  assert.equal(line.code, "vibe64_engine_unavailable");
});

test("a delivery that works, or one that only inspects, records nothing; the rest passes through", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.delivery.deliver(SESSION, f.context, f.state, true), { delivered: true });
  f.fail(Object.assign(new Error("inspection refused"), { code: "vibe64_inspection_only" }));
  await assert.rejects(f.delivery.deliver(SESSION, f.context, f.state, false, true), /inspection refused/u);
  assert.deepEqual(await f.lines(), []);
  assert.equal(f.delivery.other, "kept");
});

test("a timeline that cannot be written never fails or changes the delivery's own error", async () => {
  const refusal = Object.assign(new Error("refused"), { code: "vibe64_refused" });
  const delivery = withRoutingTimeline({ async deliver() { throw refusal; } });
  await assert.rejects(delivery.deliver("not a session id!", { runtime: { stateRoot: "\0bad" } }, null, true), (error) => error === refusal);
});
