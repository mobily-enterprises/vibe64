import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { controllerHarness } from "../fixtures/opencodeController.js";

test("temporary OpenCode uses the main agent and project commands while keeping edits and history separate on close", async (t) => {
  const harness = await controllerHarness({
    withCommandBoundary: true,
    helperResponse: "Project edited.",
    beforePrompt({ directory, id }) {
      if (id.startsWith("ses_detached_")) {
        execFileSync("sh", ["-c", "printf 'Temporary command edit' > temporary-edit.txt"], { cwd: directory });
      }
    }
  });
  t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { recursive: true, force: true }); });
  const workdir = harness.session.metadata.source_path;
  await writeFile(path.join(workdir, "existing.txt"), "Unrelated local work");
  await harness.controller.sendMessage("session-1", { message: "Main question", messageId: "main-question" });
  await harness.controller.waitForTurn("session-1");
  const mainHistory = structuredClone(harness.userMessages);
  const conversation = await harness.controller.createConversation("session-1", { ephemeral: true });
  await harness.controller.startConversationTurn("session-1", { conversationId: conversation.conversationId, message: "Edit the project." });
  await harness.controller.waitForConversationTurn("session-1", { conversationId: conversation.conversationId });
  assert.equal(harness.promptCalls.at(-1).input.agent, harness.promptCalls[0].input.agent);
  assert.equal(harness.promptDirectories.at(-1).directory, workdir);
  assert.equal(harness.promptDirectories[0].directory, workdir);
  await harness.controller.deleteConversation("session-1", { conversationId: conversation.conversationId });
  assert.equal(await readFile(path.join(workdir, "temporary-edit.txt"), "utf8"), "Temporary command edit");
  assert.equal(await readFile(path.join(workdir, "existing.txt"), "utf8"), "Unrelated local work");
  assert.deepEqual(harness.userMessages, mainHistory);
});

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

test("temporary OpenCode observation loss stops admitted work and waits for an explicit new Send", async (t) => {
  const loss = Promise.withResolvers();
  let interrupts = 0;
  let connections = 0;
  const reply = { pending: true, text: "" };
  const harness = await controllerHarness({
    helperResponse: reply,
    interrupt: async () => { interrupts += 1; return true; },
    async *events(_id, { onReady, signal }) {
      onReady();
      yield { data: { type: "session.status", properties: { sessionID: _id } } };
      connections += 1;
      await Promise.race([
        connections === 1 ? loss.promise : new Promise(() => {}),
        new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
      ]);
    }
  });
  t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
  const { conversationId } = await harness.controller.createConversation("session-1", { ephemeral: true });
  await harness.controller.startConversationTurn("session-1", { conversationId, message: "Work" });
  loss.resolve();
  await assert.rejects(harness.controller.waitForConversationTurn("session-1", { conversationId }), /event connection ended/);
  assert.equal(interrupts, 1);
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), false);
  assert.equal(harness.promptCalls.length, 1);
  assert.deepEqual(harness.userMessages, []);
  reply.pending = false;
  reply.text = "Explicitly continued";
  await harness.controller.startConversationTurn("session-1", { conversationId, message: "Continue" });
  const completed = await harness.controller.waitForConversationTurn("session-1", { conversationId });
  assert.equal(completed.text, reply.text);
});

test("temporary OpenCode retains ownership after an unverified stop and can retry Stop", async (t) => {
  const loss = Promise.withResolvers();
  let exited = false;
  const harness = await controllerHarness({
    helperResponse: { pending: true, text: "" },
    interrupt: async () => false,
    stop: async () => ({ exited }),
    async *events(_id, { onReady, signal }) {
      onReady();
      yield { data: { type: "session.status", properties: { sessionID: _id } } };
      await Promise.race([loss.promise, new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))]);
    }
  });
  t.after(async () => { exited = true; await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
  const { conversationId } = await harness.controller.createConversation("session-1", { ephemeral: true });
  await harness.controller.startConversationTurn("session-1", { conversationId, message: "Work" });
  loss.resolve();
  await assert.rejects(harness.controller.waitForConversationTurn("session-1", { conversationId }), /could not be verified/);
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), true);
  const pending = await harness.controller.readConversation("session-1", { conversationId });
  assert.equal(pending.ok, false);
  assert.equal(pending.status, "inProgress");
  assert.match(pending.error, /could not be verified/);
  exited = true;
  assert.equal((await harness.controller.stopConversation("session-1", { conversationId })).stopped, true);
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), false);
  assert.equal(harness.promptCalls.length, 1);
});

test("shared OpenCode process loss stops temporary-only sessions without writing main History", async (t) => {
  const loss = Promise.withResolvers();
  let firstThread = "";
  const harness = await controllerHarness({
    helperResponse: { pending: true, text: "" },
    interrupt: async () => false,
    async *events(id, { onReady, signal }) {
      firstThread ||= id;
      onReady();
      yield { data: { type: "session.status", properties: { sessionID: id } } };
      const aborted = new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      await (id === firstThread ? Promise.race([loss.promise, aborted]) : aborted);
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const second = structuredClone(harness.session);
  second.sessionId = "session-2";
  second.sessionRoot = path.join(harness.root, "session-state", second.sessionId);
  second.metadata.source_path = path.join(harness.root, "sessions", "active", second.sessionId, "source");
  await mkdir(second.metadata.source_path, { recursive: true });
  const sessions = new Map([["session-1", harness.session], [second.sessionId, second]]);
  harness.runtime.getSession = async (id) => sessions.get(id);
  const conversations = [];
  for (const id of sessions.keys()) {
    const { conversationId } = await harness.controller.createConversation(id, { ephemeral: true });
    conversations.push([id, conversationId]);
    await harness.controller.startConversationTurn(id, { conversationId, message: `Work for ${id}` });
  }
  const completions = conversations.map(([id, conversationId]) => harness.controller.waitForConversationTurn(id, { conversationId }));
  const settled = Promise.allSettled(completions);
  loss.resolve();
  await settled;
  assert.equal(harness.processStops.length, 1);
  for (const [id] of conversations) {
    assert.equal(harness.controller.hasActiveTemporaryConversation(id), false);
  }
  assert.equal(harness.promptCalls.length, 2);
  assert.deepEqual(harness.userMessages, []);
  assert.deepEqual(harness.assistantMessages, []);
});

test("durable OpenCode history survives a controller restart without starting another model turn", async (t) => {
  const harness = await controllerHarness({ helperResponse: "Saved answer" });
  let restarted;
  t.after(async () => {
    await restarted?.closeAllForProject();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const { conversationId } = await harness.controller.createConversation("session-1", { persistent: true });
  await harness.controller.startConversationTurn("session-1", { conversationId, persistent: true, messageId: "input", message: "Question" });
  await harness.controller.waitForConversationTurn("session-1", { conversationId });
  await harness.controller.closeAllForProject();
  restarted = harness.createController();
  const restored = await restarted.readConversation("session-1", { conversationId, persistent: true, messageId: "input" });
  assert.equal(restored.status, "completed");
  assert.equal(restored.admitted, true);
  assert.equal(restored.messages.at(-1).text, "Saved answer");
  assert.equal(harness.promptCalls.length, 1);
  assert.deepEqual(harness.userMessages, []);
  await restarted.stopConversation("session-1", { conversationId, persistent: true });
  await restarted.deleteConversation("session-1", { conversationId, persistent: true });
});

test("durable OpenCode Close never kills main chat when an observed Stop is unconfirmed", async (t) => {
  let attempts = 0;
  const harness = await controllerHarness({ interrupt: async () => ++attempts > 1 });
  t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
  const { conversationId } = await harness.controller.createConversation("session-1", { persistent: true });
  await assert.rejects(harness.controller.stopConversation("session-1", { conversationId, persistent: true }), {
    code: "vibe64_opencode_interrupt_unconfirmed"
  });
  assert.equal(harness.processStops.length, 0);
  assert.equal((await harness.controller.stopConversation("session-1", { conversationId, persistent: true })).stopped, true);
});
