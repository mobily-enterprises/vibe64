import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createConversationTranscript, createMemoryConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { controllerHarness } from "../fixtures/opencodeController.js";

const reasoning = "I am examining the application source to understand how its session state is persisted.";
const summary = "Examines session persistence.";
const part = () => ({ id: "reasoning-1", type: "reasoning", text: reasoning });
const summaries = (harness) => harness.promptCalls.filter(({ input }) => input.agent === "vibe64-economy");
async function until(check) {
  const deadline = Date.now() + 3_000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, "Expected the observed operation to complete");
    await delay(20);
  }
}
async function fixture(t, options = {}) {
  const harness = await controllerHarness(options);
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  return harness;
}

test("reasoning reads a completed helper answer once per block and deletes native helpers across turns", async (t) => {
  const responses = [0, 1].map(() => ({ pending: true, text: "", content: [part()] }));
  const helper = { pending: true, text: "Partial helper answer" };
  let helperReads = 0;
  const harness = await fixture(t, {
    assistantResponses: responses, helperResponse: helper,
    beforeMessages(id) { if (id !== "ses_native_1") helperReads += 1; }
  });
  for (const [index, response] of responses.entries()) {
    helper.pending = true;
    helper.text = "Partial helper answer";
    await harness.controller.sendMessage("session-1", { message: "Review persistence", messageId: `summary-${index}` });
    await until(() => helperReads > index * 2 && summaries(harness).length === index + 1);
    assert.equal(harness.thinkingMessages.length, index, "Partial helper output must not become a headline");
    helper.text = summary;
    helper.pending = false;
    await until(() => harness.thinkingMessages.length === index + 1);
    assert.equal(harness.thinkingMessages[index].text, summary);
    response.pending = false;
    response.text = "Done.";
    await harness.controller.waitForTurn("session-1");
    await until(() => harness.upstreamSessions.size === 1);
    assert.equal(summaries(harness).length, index + 1, "Final projection must not submit the same block again");
    assert.equal(harness.thinkingMessages.length, index + 1);
  }
  assert.ok(helperReads >= 4);
  assert.ok(harness.createdSessionDirectories.filter(({ id }) => id !== "ses_native_1")
    .every(({ directory }) => directory !== harness.session.metadata.source_path));
  await harness.controller.closeAllForProject();
  assert.equal([...harness.upstreamSessions.values()].filter(({ agent }) => agent === "vibe64-economy").length, 0);
});

test("an initial partial word does not suppress later live reasoning", async (t) => {
  const current = { ...part(), text: "I" };
  const response = { pending: true, text: "", content: [current] };
  const harness = await fixture(t, { assistantResponses: [response] });
  harness.connection.economyModelId = "";
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "partial" });
  await delay(300);
  assert.equal(harness.thinkingMessages.length, 0);
  current.text = "I am examining session persistence.";
  await until(() => harness.thinkingMessages.length === 1);
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
  assert.equal(harness.thinkingMessages[0].text, current.text);
  response.pending = false;
  response.text = "Done.";
  await harness.controller.waitForTurn("session-1");
  assert.equal(harness.thinkingMessages.length, 1);
  assert.equal(summaries(harness).length, 0);
});

test("a stalled cosmetic helper cannot keep a completed main turn busy or write into the next turn", async (t) => {
  const response = { pending: true, text: "", content: [part()] };
  let cancelled = false;
  const interrupted = [];
  const harness = await fixture(t, {
    assistantResponses: [response],
    async beforePrompt({ input, signal }) {
      if (input.agent !== "vibe64-economy") return;
      try { await delay(60_000, undefined, { signal }); }
      catch (error) { cancelled = true; throw error; }
    },
    async interrupt(id) { interrupted.push(id); return true; }
  });
  Object.assign(harness.runtime.store, createConversationTranscript({ storage: createMemoryConversationStorage() }));
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "held-summary" });
  await until(() => summaries(harness).length === 1);
  assert.equal(harness.controller.hasActiveTemporaryConversation("session-1"), false,
    "Cosmetic summaries must not advertise separate active work");
  response.text = "Done.";
  response.pending = false;
  const result = await Promise.race([
    harness.controller.waitForTurn("session-1").then(() => "completed"),
    delay(2_000).then(() => "still busy")
  ]);
  assert.equal(result, "completed");
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, false);
  await until(() => harness.upstreamSessions.size === 1);
  assert.equal(cancelled, true);
  assert.ok(interrupted.includes("ses_native_2"));
  await harness.controller.sendMessage("session-1", { message: "Next task", messageId: "next-turn" });
  await harness.controller.waitForTurn("session-1");
  const transcript = await harness.runtime.store.readConversationLog("session-1");
  assert.equal(transcript.length, 2);
  assert.equal(transcript[0].thinking.length, 1);
  assert.equal(transcript[0].assistant.text, "Done.");
  assert.equal(transcript[1].thinking?.length || 0, 0);
});

test("project closure aborts a running summary and deletes its native conversation", async (t) => {
  const response = { pending: true, text: "", content: [part()] };
  const harness = await fixture(t, {
    assistantResponses: [response],
    async beforePrompt({ input, signal }) {
      if (input.agent === "vibe64-economy") await delay(60_000, undefined, { signal });
    }
  });
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "close-active" });
  await until(() => summaries(harness).length === 1);
  await harness.controller.closeAllForProject();
  assert.equal(harness.upstreamSessions.size, 1);
});

test("failed native helper deletion retains ownership and is retried on project closure", async (t) => {
  let failedDeletion = false;
  let deleteCalls = 0;
  const response = { pending: true, text: "", content: [part()] };
  const harness = await fixture(t, {
    assistantResponses: [response], helperResponse: summary,
    beforeDeleteSession(id) {
      if (id === "ses_native_1") return;
      deleteCalls += 1;
      if (!failedDeletion) { failedDeletion = true; throw new Error("Temporary deletion failure"); }
    }
  });
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "retry-delete" });
  await until(() => harness.thinkingMessages.length === 1);
  response.pending = false;
  response.text = "Done.";
  await harness.controller.waitForTurn("session-1");
  await until(() => failedDeletion);
  assert.equal(harness.upstreamSessions.size, 2);
  await harness.controller.closeAllForProject();
  assert.equal(harness.upstreamSessions.size, 1);
  assert.equal(deleteCalls, 2);
});

test("summaries and registered subagents use the selected account's configured Helper model", async (t) => {
  const response = { pending: true, text: "", content: [part()] };
  const harness = await fixture(t, { assistantResponses: [response], helperResponse: summary });
  const accessCalls = [];
  harness.controllerOptions.readAssistantAccess = async (input) => {
    accessCalls.push(input);
    return { available: true, ownerOnly: false, economyModelId: "configured-helper-model" };
  };
  harness.controller = harness.createController();
  await harness.controller.sendMessage("session-1", { message: "Review", messageId: "helper-preference" }, {
    vibe64User: { role: "member", username: "collaborator" }
  });
  await until(() => harness.thinkingMessages.length === 1);
  assert.equal(summaries(harness)[0].input.model.id, "configured-helper-model");
  assert.equal(summaries(harness)[0].input.model.providerID, "deepseek");
  assert.equal(accessCalls[0].modelProviderId, "deepseek");
  const registry = JSON.parse(await readFile(harness.processStarts[0].options.sessionEnvironmentRegistry, "utf8"));
  assert.equal(registry.sessions[0].economyModelId, "configured-helper-model");
  assert.equal(registry.sessions[0].modelProviderId, "deepseek");
  response.pending = false;
  response.text = "Done.";
  await harness.controller.waitForTurn("session-1");
});
