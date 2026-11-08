import assert from "node:assert/strict";
import test from "node:test";
import { createServiceShutdown } from "../../packages/vibe64-terminals/src/server/serviceShutdown.js";

// A service whose AI engines record when they learn that shutdown has begun and
// when their runtimes stop. Routing closes when the test lets it.
function fixture({ begun = { ok: true, failed: [] } } = {}) {
  const calls = [];
  const routing = Promise.withResolvers();
  const state = {
    lifecycle: { closing: false, goalRecovery: null },
    shutdownSignal: new AbortController(),
    shutdownWork: new Set()
  };
  const shutdown = createServiceShutdown({
    state,
    assistantRouting: { async close() { calls.push("routing-close"); await routing.promise; } },
    mainConversations: { async close() {} },
    outputTarget: { async close() {} },
    projectServices: { async closeAll() {} },
    sessionAgent: {
      beginShutdown() { calls.push("begin"); return begun; },
      async invalidateRuntimes(input) { calls.push(`stop:${input.reason}`); return { ok: true }; }
    },
    sessionConversations: { async close() {} },
    sessionNaming: { async close() {} }
  });
  return { calls, routing, shutdown, state };
}

test("beginning the server's shutdown tells the engines at once and stops nothing; the stop that follows does not begin it again", async () => {
  const f = fixture();
  assert.deepEqual(f.shutdown.beginShutdown(), { ok: true, failed: [] });
  assert.deepEqual(f.calls, ["begin"]);
  assert.equal(f.state.lifecycle.closing, false, "only the engines learn of it");
  f.routing.resolve();
  await f.shutdown.close();
  assert.deepEqual(f.calls, ["begin", "routing-close", "stop:server-shutdown"]);
});

test("the server-shutdown stop, and the server's close, tell the engines before they wait for anything", async () => {
  const stopping = fixture();
  const stop = stopping.shutdown.invalidateAgentRuntimes({ reason: "server-shutdown" });
  assert.deepEqual(stopping.calls, ["begin", "routing-close"]);
  stopping.routing.resolve();
  await stop;

  const closing = fixture();
  const followUp = Promise.withResolvers();
  closing.state.shutdownWork.add(followUp.promise);
  const close = closing.shutdown.close();
  assert.deepEqual(closing.calls, ["begin"], "the turns' follow-up work is still running");
  followUp.resolve();
  closing.routing.resolve();
  await close;
  assert.deepEqual(closing.calls, ["begin", "routing-close", "stop:server-shutdown"]);
});

test("an engine that could not begin its shutdown is reported by the stop, which still stops every runtime", async () => {
  const begun = { ok: false, failed: [{ providerId: "claude", ok: false, error: "Claude could not begin." }] };
  const f = fixture({ begun });
  f.routing.resolve();
  await assert.rejects(f.shutdown.invalidateAgentRuntimes({ reason: "server-shutdown" }), (error) =>
    error.errors.length === 1 && error.errors[0].code === "vibe64_agent_runtime_shutdown_begin_failed" &&
    error.errors[0].details === begun);
  assert.deepEqual(f.calls, ["begin", "routing-close", "stop:server-shutdown"]);
});

test("an account change's invalidation does not begin the server's shutdown", async () => {
  const f = fixture();
  await f.shutdown.invalidateAgentRuntimes({ reason: "provider-key-change", provider: "codex" });
  assert.deepEqual(f.calls, ["stop:provider-key-change"]);
});
