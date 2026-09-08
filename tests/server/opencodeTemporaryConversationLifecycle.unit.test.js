import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";

import { controllerHarness } from "../fixtures/opencodeController.js";

test("OpenCode temporary Start returns admission while the provider is still working", async (t) => {
  const reading = Promise.withResolvers();
  const releaseRead = Promise.withResolvers();
  const reply = { pending: true, text: "" };
  const harness = await controllerHarness({
    helperResponse: reply,
    async beforeMessages() {
      reading.resolve();
      await releaseRead.promise;
    }
  });
  let start;
  t.after(async () => {
    reply.pending = false;
    reply.text = "Finished after the test released its provider.";
    releaseRead.resolve();
    await start?.catch(() => null);
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const conversation = await harness.controller.createConversation("session-1", { ephemeral: true });
  start = harness.controller.startConversationTurn("session-1", {
    conversationId: conversation.conversationId,
    ephemeral: true,
    message: "Work until stopped.",
    messageId: "temporary-admission"
  });
  await reading.promise;
  const admitted = await Promise.race([
    start,
    new Promise((resolve) => setTimeout(() => resolve(null), 100))
  ]);
  assert.ok(admitted, "Start waited for a final answer, leaving the browser's Stop button disabled");
  assert.equal(admitted.status, "inProgress");
  assert.ok(admitted.runId);
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), true);
});

test("OpenCode temporary Stop rejects an unconfirmed abort and permits retry", async (t) => {
  let attempts = 0;
  const harness = await controllerHarness({ interrupt: async () => ++attempts > 1 });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const { conversationId } = await harness.controller.createConversation("session-1", { ephemeral: true });
  await assert.rejects(harness.controller.stopConversation("session-1", { conversationId }), {
    code: "vibe64_opencode_interrupt_unconfirmed",
    statusCode: 502
  });
  const stopped = await harness.controller.stopConversation("session-1", { conversationId });
  assert.equal(stopped.stopped, true);
  assert.equal(attempts, 2);
  assert.equal(harness.processStops.length, 0, "Stop must not kill the shared provider");
});

test("OpenCode temporary reads remain working and failed Stop preserves the active turn", async (t) => {
  let attempts = 0;
  const harness = await controllerHarness({
    helperResponse: { pending: true, text: "Progress so far" },
    interrupt: async () => ++attempts > 1
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const { conversationId } = await harness.controller.createConversation("session-1", { ephemeral: true });
  const admission = await harness.controller.startConversationTurn("session-1", {
    conversationId, message: "Keep working"
  });
  const working = await harness.controller.readConversation("session-1", { conversationId });
  assert.equal(working.status, "inProgress");
  assert.equal(working.runId, admission.runId);
  assert.equal(working.text, "Progress so far");
  await assert.rejects(harness.controller.startConversationTurn("session-1", {
    conversationId, message: "A duplicate turn"
  }), { statusCode: 409 });
  await assert.rejects(harness.controller.stopConversation("session-1", { conversationId }), {
    code: "vibe64_opencode_interrupt_unconfirmed"
  });
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), true);
  await harness.controller.stopConversation("session-1", { conversationId });
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), false);
  assert.equal((await harness.controller.readConversation("session-1", { conversationId })).status, "interrupted");
  assert.equal(harness.processStops.length, 0);
});

test("OpenCode temporary admission can retry and Stop cancels a held history read", async (t) => {
  const reading = Promise.withResolvers();
  let aborted = false;
  const harness = await controllerHarness({
    helperResponse: { pending: true, text: "" },
    async beforeMessages(_id, { signal } = {}) {
      if (!signal) return;
      reading.resolve();
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const { conversationId } = await harness.controller.createConversation("session-1", { ephemeral: true });
  harness.failPrompt();
  await assert.rejects(harness.controller.startConversationTurn("session-1", {
    conversationId, message: "Rejected admission"
  }), { statusCode: 503 });
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), false);
  await harness.controller.startConversationTurn("session-1", { conversationId, message: "Work" });
  await reading.promise;
  const stopped = await harness.controller.stopConversation("session-1", { conversationId });
  assert.equal(stopped.stopped, true);
  assert.equal(aborted, true);
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), false);
});

test("OpenCode temporary completion and observer failure remain readable", async (t) => {
  let failRead = false;
  const harness = await controllerHarness({
    helperResponse: "Finished",
    beforeMessages(_id, { signal } = {}) {
      if (failRead && signal) throw new Error("Provider history unavailable");
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const { conversationId } = await harness.controller.createConversation("session-1", { ephemeral: true });
  await harness.controller.startConversationTurn("session-1", { conversationId, message: "Work" });
  await harness.controller.waitForConversationTurn("session-1", { conversationId });
  const completed = await harness.controller.readConversation("session-1", { conversationId });
  assert.equal(completed.status, "completed");
  assert.equal(completed.text, "Finished");
  failRead = true;
  await harness.controller.startConversationTurn("session-1", { conversationId, message: "Next" });
  await assert.rejects(harness.controller.waitForConversationTurn("session-1", { conversationId }), /Provider history unavailable/);
  const failed = await harness.controller.readConversation("session-1", { conversationId });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "Provider history unavailable");
  assert.equal(failed.ok, false);
});

test("OpenCode temporary Stop times out and permits a confirmed retry", async (t) => {
  let attempts = 0;
  const harness = await controllerHarness({
    helperResponse: { pending: true, text: "" },
    async interrupt(_id, { signal }) {
      if (++attempts > 1) return true;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const { conversationId } = await harness.controller.createConversation("session-1", { ephemeral: true });
  await harness.controller.startConversationTurn("session-1", { conversationId, message: "Work" });
  await assert.rejects(harness.controller.stopConversation("session-1", { conversationId }), {
    code: "vibe64_opencode_interrupt_timeout", statusCode: 504
  });
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), true);
  await harness.controller.stopConversation("session-1", { conversationId });
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), false);
  assert.equal(harness.processStops.length, 0);
});

test("OpenCode deletion retires only its own observer and shutdown retires the remainder", async (t) => {
  const harness = await controllerHarness({ helperResponse: { pending: true, text: "Still working" } });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const first = await harness.controller.createConversation("session-1", { ephemeral: true });
  const second = await harness.controller.createConversation("session-1", { ephemeral: true });
  await harness.controller.startConversationTurn("session-1", { ...first, message: "First" });
  await harness.controller.startConversationTurn("session-1", { ...second, message: "Second" });
  await harness.controller.deleteConversation("session-1", first);
  assert.equal(harness.upstreamSessions.has(first.conversationId), false);
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), true);
  assert.equal((await harness.controller.readConversation("session-1", second)).status, "inProgress");
  assert.equal(harness.processStops.length, 0);
  await harness.controller.closeAllForProject();
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), false);
});
