import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createConversationRuntime, createMemoryConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { controllerHarness } from "../fixtures/opencodeController.js";

async function fixture(t, options = {}) {
  const harness = await controllerHarness(options);
  // The production native server memoizes confirmed stop proof. Model that
  // contract when both conversation observers retire the same dead server.
  const createServer = harness.controllerOptions.createServerProcess;
  harness.controllerOptions.createServerProcess = async options => {
    const server = await createServer(options);
    const stop = server.stop;
    let stopping;
    server.stop = () => {
      if (!stopping) {
        stopping = stop();
        void stopping.then(proof => { if (proof?.exited !== true) stopping = null; }, () => { stopping = null; });
      }
      return stopping;
    };
    return server;
  };
  harness.controller = harness.createController();
  const workdir = path.join(harness.root, "colleague");
  await mkdir(workdir);
  const storage = createMemoryConversationStorage();
  const runtime = createConversationRuntime({ engine: "opencode", storage, authorize: () => true,
    connections: { resolve: async () => ({ providerId: harness.connection.modelProviderId,
      baseURL: harness.connection.canonicalUrl, apiKey: harness.connection.apiKey, model: "deepseek-chat" }) },
    host: { workdir, stateDirectory: path.join(workdir, "native"), opencode: input => harness.controller.conversationHost(input) }
  });
  const colleague = await runtime.open({ id: "colleague", configuration: { systemPrompt: "Current colleague instructions", integrationId: "deepseek" } });
  t.after(async () => {
    try { await runtime.close(); await harness.controller.closeAllForProject(); }
    finally { await rm(harness.root, { force: true, recursive: true }); }
  });
  return { ...harness, common: runtime, colleague,
    binding: () => storage.read("colleague", async tx => (await tx.readMetadata()).runtime.binding),
    registry: async () => JSON.parse(await readFile(harness.processStarts[0].options.sessionEnvironmentRegistry, "utf8"))
  };
}

test("main chat and Colleague acquire one OpenCode owner; project close retains the common conversation", async t => {
  const f = await fixture(t, { helperResponse: "Colleague reply" });
  const main = await f.controller.ensureSession("session-1");
  await f.colleague.send({ messageId: "first", text: "Hello" });
  assert.equal((await f.colleague.wait()).conversationLog[0].assistant.text, "Colleague reply");
  assert.equal(f.processStarts.length, 1);
  assert.equal(f.createdSessions.length, 2);
  const saved = await f.binding();
  assert.notEqual(saved.sessionId, main.thread.id);
  assert.equal(saved.databasePath, f.processStarts[0].options.dbPath);
  assert.deepEqual((await f.registry()).sessions.map(row => row.upstreamSessionId).sort(), [main.thread.id, saved.sessionId].sort());
  await f.controller.closeAllForProject();
  assert.equal(f.processStops.length, 0);
  assert.deepEqual((await f.registry()).sessions.map(row => row.upstreamSessionId), [saved.sessionId]);
  await f.colleague.send({ messageId: "second", text: "Continue" });
  assert.equal((await f.colleague.wait()).conversationLog.length, 2);
  assert.equal((await f.binding()).sessionId, saved.sessionId);
  assert.equal(f.processStarts.length, 1);
  await f.common.close();
  assert.equal(f.processStops.length, 1);
  const reopened = await f.controller.ensureSession("session-1");
  assert.equal(reopened.thread.id, main.thread.id);
  assert.equal(f.createdSessions.length, 2);
});

test("closing Colleague retains main chat's OpenCode server and binding", async t => {
  const f = await fixture(t);
  await f.colleague.send({ messageId: "first", text: "Hello" });
  await f.colleague.wait();
  const main = await f.controller.ensureSession("session-1");
  assert.equal(f.processStarts.length, 1);
  await f.colleague.dispose();
  assert.equal(f.processStops.length, 0);
  assert.deepEqual((await f.registry()).sessions.map(row => row.upstreamSessionId), [main.thread.id]);
  await f.controller.sendMessage("session-1", { messageId: "main", message: "Continue" });
  assert.equal((await f.controller.waitForTurn("session-1")).state, "completed");
  assert.equal(f.processStarts.length, 1);
});

test("project close and shutdown retain and retry an unconfirmed OpenCode startup", async t => {
  const f = await controllerHarness();
  let confirmed = false;
  let starts = 0;
  let cleanupCalls = 0;
  f.controllerOptions.createServerProcess = async () => {
    starts += 1;
    throw Object.assign(new Error("Startup failed"), { cleanupFailed: true,
      retryCleanup: async () => { cleanupCalls += 1; return { exited: confirmed, scopeEmpty: confirmed }; } });
  };
  const controller = f.createController();
  t.after(async () => {
    confirmed = true;
    try { await controller.closeAllForProject(); }
    finally { await rm(f.root, { recursive: true, force: true }); }
  });
  await assert.rejects(controller.ensureSession("session-1"), /Startup failed/);
  assert.equal(cleanupCalls, 0);
  await assert.rejects(controller.closeAllForProject(), /exit could not be verified/);
  assert.equal(cleanupCalls, 1);
  confirmed = true;
  assert.equal((await controller.invalidateRuntimes({ reason: "server-shutdown" })).ok, true);
  assert.equal(cleanupCalls, 2);
  assert.equal(starts, 1);
});

test("cancelling Colleague interrupts only its native thread while main chat remains active", async t => {
  const busy = new Set();
  const interrupted = [];
  const f = await fixture(t, { assistantResponses: [{ text: "", pending: true }], helperResponse: { text: "", pending: true },
    beforePrompt: ({ id }) => { busy.add(id); },
    sessionStatus: async id => ({ type: busy.has(id) ? "busy" : "idle" }),
    interrupt: async id => { interrupted.push(id); busy.delete(id); return true; }
  });
  await f.controller.sendMessage("session-1", { messageId: "main", message: "Work" });
  await f.colleague.send({ messageId: "colleague", text: "Work" });
  const binding = await f.binding();
  assert.equal(busy.size, 2);
  await f.colleague.cancel();
  assert.deepEqual(interrupted, [binding.sessionId]);
  assert.equal(f.processStops.length, 0);
  assert.equal((await f.controller.sessionState("session-1")).turn.active, true);
  assert.equal((await f.colleague.wait()).conversationLog[0].metadata.runtime.status, "cancelled");
});

for (const lostConsumer of ["main", "colleague"]) {
  test(`OpenCode observation loss in ${lostConsumer} coordinates both main and Colleague through the same owner`, async t => {
    const lose = Promise.withResolvers();
    let lostId;
    const f = await fixture(t, { assistantResponses: [{ text: "", pending: true }], helperResponse: { text: "", pending: true },
      interrupt: async () => false,
      // This loss fixture ends without producing events, on the original loss/abort race.
      // eslint-disable-next-line require-yield
      async *events(id, { onReady, signal }) {
        onReady();
        const aborted = new Promise(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", resolve, { once: true });
        });
        await Promise.race([aborted, lose.promise.then(() => id === lostId ? undefined : aborted)]);
      }
    });
    await f.controller.sendMessage("session-1", { messageId: "main", message: "Work" });
    await f.colleague.send({ messageId: "colleague", text: "Work" });
    lostId = lostConsumer === "main" ? f.session.metadata.opencode_conversation_id : (await f.binding()).sessionId;
    lose.resolve();
    const [main, colleague] = await Promise.all([f.controller.waitForTurn("session-1"), f.colleague.wait()]);
    assert.equal(f.processStarts.length, 1);
    assert.equal(f.processStops.length, 1);
    assert.equal(main.active, false);
    assert.equal(colleague.conversationLog[0].metadata.runtime.status, "failed");
    assert.equal((await f.registry()).sessions.some(row => row.conversation), false);
  });
}
