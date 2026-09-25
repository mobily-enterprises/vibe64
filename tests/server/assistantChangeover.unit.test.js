import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server";
import { vibe64AssistantConversationKey, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { readConversationRewindState, rememberAssistantBeforeChangeover, replaceNativeConversation, requireCompletedNativeConversationReplacement, rewindLastConversationTurn, sendWithAssistantChangeover } from "../../packages/vibe64-terminals/src/server/assistantChangeover.js";

function selection(engineId, providerId = "") {
  return { engineId, agentId: engineId === "codex" ? "codex" : "build",
    modelProviderId: providerId || (engineId === "codex" ? "openai" : "deepseek"),
    modelId: engineId === "codex" ? "gpt-6-astra" : "deepseek-chat",
    variantId: "", catalogRevision: `sha256:${"a".repeat(64)}` };
}

async function harness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-changeover-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const makeStore = () => createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  let store = makeStore();
  const sessionId = "changeover";
  await store.createSession({ runtimeKind: "genesis", sessionId });
  await store.writeMetadataValue(sessionId, "assistant_selection", serializeVibe64AssistantSelection(selection("codex")));
  const calls = [];
  const receipts = new Set();
  const logs = [];
  let serial = 0;
  const api = {
    get store() { return store; },
    calls, logs, receipts, failure: "", inspectUnknown: false,
    nativeThread: "", closeFailure: false,
    async replace(input) { return replaceNativeConversation(sessionId, input, await api.context(), agent); },
    async bindNative() {
      for (const [name, value] of Object.entries({ codex_conversation_id: "codex-original-thread",
        codex_conversation_workdir: root, agent_identity_provider: "codex",
        agent_identity_conversation_id: "codex-original-thread", agent_identity_workdir: root })) {
        await store.writeMetadataValue(sessionId, name, value);
      }
    },
    async context() { return { runtime: { store }, session: await store.readSession(sessionId) }; },
    async select(engineId, providerId) {
      const context = await api.context();
      const old = vibe64AssistantConversationKey(JSON.parse(context.session.metadata.assistant_selection));
      const next = selection(engineId, providerId);
      if (old !== vibe64AssistantConversationKey(next)) await rememberAssistantBeforeChangeover(context, old);
      await store.writeMetadataValue(sessionId, "assistant_selection", serializeVibe64AssistantSelection(next));
    },
    async send(message, messageId = `message-${++serial}`) {
      return sendWithAssistantChangeover(sessionId, { message, messageId }, await api.context(), agent, (entry) => logs.push(entry));
    },
    async restart() { store = makeStore(); },
    async history() { return store.readConversationLog(sessionId); },
    async rewind(turnId) { return rewindLastConversationTurn(sessionId, { turnId }, await api.context(), agent); },
    async rewindState() { return readConversationRewindState(store, sessionId, vibe64AssistantConversationKey(JSON.parse((await api.context()).session.metadata.assistant_selection))); },
    rewindCalls: [], rewindFailure: false,
    async editAnswer(turnId, text) { await store.upsertConversationAssistantMessage(sessionId, { turnId, text }); }
  };
  const agent = {
    async closeSession(_id, context) {
      assert.equal(context.changeover, true);
      assert.equal(context.forgetConversationBinding, true);
      if (api.closeFailure) throw new Error("Native stop unconfirmed");
      api.nativeThread = "fresh-successor";
      return { ok: true };
    },
    async rewindConversation(_id, input) {
      if (!input.checkpoint) return { ok: true, checkpoint: { messageId: input.messageId } };
      api.rewindCalls.push(input.checkpoint.messageId);
      if (api.rewindFailure) throw new Error("lost rewind response");
      return { ok: true };
    },
    async inspectMessageAdmission(_id, { messageId, threadId }) {
      return { admission: !api.inspectUnknown && receipts.has(`${threadId}/${messageId}`) ? "accepted" : "unknown" };
    },
    async sendMessage(_id, input, context) {
      const selected = JSON.parse(context.session.metadata.assistant_selection);
      const { engineId } = selected;
      const threadId = api.nativeThread || `${vibe64AssistantConversationKey(selected)}-original-thread`;
      if (api.failure === "preflight") return { ok: false, delivered: false };
      await input.onPromptSending?.({ threadId });
      calls.push({ engineId, threadId, messageId: input.messageId, message: input.message });
      if (api.failure === "rejected") {
        await input.onPromptRejected?.();
        return { ok: false, delivered: false };
      }
      receipts.add(`${threadId}/${input.messageId}`);
      if (api.failure === "lost-response") throw new Error("connection lost after native acceptance");
      await store.writeConversationUserMessage(sessionId, {
        messageId: input.messageId, text: input.displayMessage || input.message, turnMetadata: { engineId, assistantSelection: selected }
      });
      await store.writeConversationAssistantMessage(sessionId, {
        messageId: `reply-${input.messageId}`, text: `${engineId} answer to ${input.displayMessage || input.message}`
      });
      if (api.failure === "lost-after-persist") throw new Error("local delivery state was lost");
      return { ok: true, delivered: true, threadId };
    }
  };
  return api;
}

test("changeover accompanies the normal user prompt and keeps the authored bubble clean", async (t) => {
  const h = await harness(t);
  await h.send("Build a clock");
  assert.equal(h.calls[0].message, "Build a clock");
  await h.select("opencode");
  assert.equal(h.calls.length, 1, "selection must not send a prompt");
  await h.send("Make it blue");
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1].message, /Build a clock/);
  assert.ok(h.calls[1].message.endsWith("User's message:\nMake it blue"));
  assert.equal((await h.history()).at(-1).user.text, "Make it blue");
  assert.equal((await h.history()).at(-1).metadata.engineId, "opencode");
  await h.select("codex");
  await h.send("Now add seconds");
  assert.equal(h.calls[2].threadId, h.calls[0].threadId);
  assert.match(h.calls[2].message, /Make it blue/);
  assert.doesNotMatch(h.calls[2].message, /Build a clock/);
  assert.equal(h.logs.filter((entry) => entry.event === "accepted").length, 2);
  assert.ok(h.logs.every((entry) => !Object.hasOwn(entry, "message")));
});

test("changeover preserves the recorded model behind each orchestrator's messages", async (t) => {
  const h = await harness(t);
  await h.send("Plan the green marker");
  await h.select("codex", "deepseek");
  const coder = { ...selection("codex", "deepseek"), modelId: "deepseek-flash", variantId: "high" };
  await h.store.writeMetadataValue("changeover", "assistant_selection", serializeVibe64AssistantSelection(coder));
  await h.send("Create the green marker");
  const recorded = await h.history();
  await h.select("opencode");
  await h.send("What did DeepSeek create?");
  const { messages } = JSON.parse(h.calls.at(-1).message.split("\n").find((line) => line.startsWith('{"messages":')));
  for (const [index, request] of ["Plan the green marker", "Create the green marker"].entries()) {
    const turn = messages.filter((message) => message.text.includes(request));
    assert.deepEqual(turn.map((message) => message.role), ["user", "assistant"]);
    for (const message of turn) {
      assert.deepEqual(message.assistantSelection, recorded[index].metadata.assistantSelection);
    }
  }
  assert.equal((await h.history()).at(-1).user.text, "What did DeepSeek create?");
});

test("switching repeatedly without sending never acknowledges missed history", async (t) => {
  const h = await harness(t);
  await h.send("Start here");
  await h.select("opencode");
  await h.select("codex");
  await h.send("Still here");
  assert.equal(h.calls.at(-1).message, "Still here");
  await h.select("opencode");
  await h.send("Continue there");
  assert.match(h.calls.at(-1).message, /Start here/);
  assert.match(h.calls.at(-1).message, /Still here/);
});

test("old bubble edits survive repeated engine changes and server restarts", async (t) => {
  const h = await harness(t);
  await h.send("Original request");
  const firstTurn = (await h.history())[0].turnId;
  for (let round = 1; round <= 12; round += 1) {
    await h.editAnswer(firstTurn, `Corrected answer ${round}`);
    await h.select(round % 2 ? "opencode" : "codex");
    await h.restart();
    await h.send(`Continue ${round}`);
    assert.match(h.calls.at(-1).message, new RegExp(`Corrected answer ${round}`));
    if (round > 1) assert.match(h.calls.at(-1).message, /"corrected":true/);
    assert.ok(h.calls.at(-1).message.endsWith(`Continue ${round}`));
  }
  assert.equal(h.calls.length, 13);
  assert.equal(new Set(h.calls.map((call) => call.threadId)).size, 2);
});

test("editing a bubble within the same engine sends a correction once", async (t) => {
  const h = await harness(t);
  await h.send("First");
  await h.send("Second");
  await h.editAnswer((await h.history())[0].turnId, "The corrected decision");
  await h.send("Use that decision");
  assert.match(h.calls.at(-1).message, /The corrected decision/);
  await h.send("Next task");
  assert.equal(h.calls.at(-1).message, "Next task");
});

test("an answer edited before the next send or first switch is never mistaken for native history", async (t) => {
  const h = await harness(t);
  await h.send("First answer");
  await h.editAnswer((await h.history())[0].turnId, "Corrected immediately");
  await h.select("opencode");
  await h.send("See that correction");
  await h.select("codex");
  await h.send("Return to the correction");
  assert.match(h.calls.at(-1).message, /Corrected immediately/);
  assert.match(h.calls.at(-1).message, /"corrected":true/);
});

test("an edited legacy answer retains its original version before changeover is initialized", async (t) => {
  const h = await harness(t);
  await h.store.writeConversationUserMessage("changeover", { text: "Legacy request", messageId: "legacy-request" });
  const answer = await h.store.writeConversationAssistantMessage("changeover", { text: "Legacy answer", messageId: "legacy-answer" });
  await h.editAnswer(answer.turnId, "Corrected legacy answer");
  await h.send("Use the correction");
  assert.match(h.calls.at(-1).message, /Corrected legacy answer/);
  assert.match(h.calls.at(-1).message, /"corrected":true/);
});

test("a new engine gets 30 recent bubbles; a returning engine gets all missed bubbles", async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 20; i += 1) await h.send(`Earlier ${i}`);
  await h.select("opencode");
  await h.send("Switch now");
  assert.doesNotMatch(h.calls.at(-1).message, /Earlier 0"/);
  assert.match(h.calls.at(-1).message, /Earlier 19/);
  for (let i = 0; i < 20; i += 1) await h.send(`Missed ${i}`);
  await h.select("codex");
  await h.send("Return now");
  assert.match(h.calls.at(-1).message, /Missed 0/);
  assert.match(h.calls.at(-1).message, /Missed 19/);
});

test("preflight failure can be edited and retried without losing the preamble", async (t) => {
  const h = await harness(t);
  await h.send("Background");
  await h.select("opencode");
  h.failure = "preflight";
  await h.send("First draft", "draft-one");
  h.failure = "";
  await h.send("Edited draft", "draft-two");
  assert.match(h.calls.at(-1).message, /Background/);
  assert.match(h.calls.at(-1).message, /You are joining an existing Vibe64 session/);
  assert.ok(h.calls.at(-1).message.endsWith("Edited draft"));
  assert.doesNotMatch(h.calls.at(-1).message, /First draft/);
});

test("an explicit native rejection retries the same frozen prompt", async (t) => {
  const h = await harness(t);
  await h.send("Background");
  await h.select("opencode");
  h.failure = "rejected";
  await h.send("Continue", "retry-message");
  const rejected = h.calls.at(-1).message;
  h.failure = "";
  await h.send("Continue", "retry-message");
  assert.equal(h.calls.at(-1).message, rejected);
  assert.equal((await h.history()).at(-1).user.text, "Continue");
});

test("lost receipt plus restart checks acceptance and never resends or exposes the preamble", async (t) => {
  const h = await harness(t);
  await h.send("Background");
  await h.select("opencode");
  h.failure = "lost-response";
  await assert.rejects(h.send("Continue", "lost-message"), /connection lost/);
  await h.restart();
  h.failure = "";
  const result = await h.send("Continue", "lost-message");
  assert.equal(result.delivered, true);
  assert.equal(h.calls.length, 2);
  assert.equal((await h.history()).at(-1).user.text, "Continue");
  await h.send("Continue", "lost-message");
  assert.equal(h.calls.length, 2);
});

test("a saved authored bubble confirms acceptance even when native receipt inspection is unavailable", async (t) => {
  const h = await harness(t);
  await h.send("Background");
  await h.select("opencode");
  h.failure = "lost-after-persist";
  await assert.rejects(h.send("Continue", "saved-message"));
  await h.restart();
  h.inspectUnknown = true;
  h.failure = "";
  assert.equal((await h.send("Continue", "saved-message")).delivered, true);
  assert.equal(h.calls.length, 2);
  await h.send("Next request");
  assert.equal(h.calls.length, 3);
});

test("uncertain receipt blocks replay but permits switching to another engine", async (t) => {
  const h = await harness(t);
  await h.send("Background");
  await h.select("opencode");
  h.failure = "lost-response";
  await assert.rejects(h.send("Continue", "lost-message"));
  h.failure = "";
  h.inspectUnknown = true;
  await h.restart();
  assert.equal((await h.send("Continue", "lost-message")).code, "vibe64_changeover_delivery_unconfirmed");
  assert.equal(h.calls.length, 2);
  await h.select("codex");
  assert.equal((await h.send("Use this AI instead")).delivered, true);
  assert.equal(h.calls.length, 3);
});


test("Undo removes one whole exchange durably, keeps IDs reserved, and stops at the AI switch", async (t) => {
  const h = await harness(t);
  await h.send("Codex first");
  await h.send("Codex second");
  await h.select("opencode");
  await h.send("OpenCode first");
  const boundary = (await h.history()).at(-1).turnId;
  assert.equal(await h.rewindState(), null);
  await assert.rejects(h.rewind(boundary), /same AI/);
  await h.send("OpenCode second", "undo-me");
  const last = (await h.history()).at(-1).turnId;
  await h.store.writeConversationCommentaryMessage("changeover", { messageId: "tail-comment", text: "Extra tool output" });
  assert.equal((await h.rewindState()).turnId, last);
  assert.equal((await h.rewind(last)).text, "OpenCode second");
  await h.restart();
  assert.equal((await h.history()).at(-1).turnId, boundary);
  assert.equal(await h.rewindState(), null);
  assert.equal(await h.store.conversationMessageIdExists("changeover", "undo-me"), true);
  assert.equal(await h.store.writeConversationCommentaryMessage("changeover", { messageId: "tail-comment", text: "Late duplicate" }), null);
  await h.rewind(last);
  assert.equal(h.rewindCalls.length, 1, "retry must not undo a second native turn");
  await h.send("Replacement", "replacement");
  assert.ok((await h.history()).at(-1).turnId > last);
  assert.equal(h.calls.at(-1).message, "Replacement", "undone context must not come back as a changeover");
});

test("Undo recovers after a lost response and blocks Send until native and local history agree", async (t) => {
  const h = await harness(t);
  await h.send("First");
  await h.send("Second");
  const last = (await h.history()).at(-1).turnId;
  h.rewindFailure = true;
  await assert.rejects(h.rewind(last), /lost rewind response/);
  await h.restart();
  await assert.rejects(h.send("Must wait"), /Finish undoing/);
  const pending = await h.rewindState();
  assert.equal(pending.turnId, last);
  assert.equal(pending.pending, true);
  h.rewindFailure = false;
  await h.rewind(last);
  await h.send("Continue");
  assert.equal(h.calls.at(-1).message, "Continue");
});

test("Undo rejects stale targets and the currently selected different AI", async (t) => {
  const h = await harness(t);
  await h.send("First");
  const first = (await h.history()).at(-1).turnId;
  await h.send("Second");
  await assert.rejects(h.rewind(first), /latest turn/);
  const second = (await h.history()).at(-1).turnId;
  await h.select("opencode");
  await assert.rejects(h.rewind(second), /same AI/);
  assert.equal(h.rewindCalls.length, 0);
});


test("Codex providers keep separate catch-up positions and resume original threads after restart", async (t) => {
  const h = await harness(t);
  await h.send("GPT background");
  await h.select("codex", "deepseek");
  await h.send("DeepSeek decision");
  assert.match(h.calls.at(-1).message, /GPT background/);
  await h.select("codex", "zai-coding-plan");
  await h.send("GLM decision");
  assert.match(h.calls.at(-1).message, /DeepSeek decision/);
  await h.restart();
  await h.select("codex", "openai");
  await h.send("GPT return");
  assert.equal(h.calls.at(-1).threadId, h.calls[0].threadId);
  assert.match(h.calls.at(-1).message, /DeepSeek decision/);
  assert.match(h.calls.at(-1).message, /GLM decision/);
  assert.doesNotMatch(h.calls.at(-1).message, /GPT background/);
  await h.select("codex", "deepseek");
  await h.send("DeepSeek return");
  assert.equal(h.calls.at(-1).threadId, h.calls[1].threadId);
  assert.match(h.calls.at(-1).message, /GLM decision/);
  assert.match(h.calls.at(-1).message, /GPT return/);
  assert.doesNotMatch(h.calls.at(-1).message, /DeepSeek decision/);
  assert.deepEqual((await h.history()).map((turn) => turn.metadata.assistantSelection.modelProviderId),
    ["openai", "deepseek", "zai-coding-plan", "openai", "deepseek"]);
});

test("an uncertain Codex provider delivery does not block a different Codex provider", async (t) => {
  const h = await harness(t);
  await h.send("Background");
  await h.select("codex", "deepseek");
  h.failure = "lost-response";
  await assert.rejects(h.send("Continue", "uncertain-deepseek"));
  await h.restart();
  h.failure = "";
  h.inspectUnknown = true;
  assert.equal((await h.send("Continue", "uncertain-deepseek")).code, "vibe64_changeover_delivery_unconfirmed");
  await h.select("codex", "zai-coding-plan");
  assert.equal((await h.send("Continue with GLM")).delivered, true);
  await h.select("codex", "deepseek");
  h.inspectUnknown = false;
  assert.equal((await h.send("Continue", "uncertain-deepseek")).delivered, true);
  assert.equal(h.calls.length, 3, "recover receipt without sending a duplicate");
  assert.equal((await h.history()).at(-1).metadata.assistantSelection.modelProviderId, "deepseek");
});

test("Undo stops at a Codex provider change and never targets another provider's native turn", async (t) => {
  const h = await harness(t);
  await h.send("GPT first");
  await h.select("codex", "deepseek");
  await h.send("DeepSeek first");
  const boundary = (await h.history()).at(-1).turnId;
  assert.equal(await h.rewindState(), null);
  await assert.rejects(h.rewind(boundary), /same AI/);
  await h.send("DeepSeek second");
  const second = (await h.history()).at(-1).turnId;
  assert.equal((await h.rewindState()).turnId, second);
  await h.select("codex", "zai-coding-plan");
  assert.equal(await h.rewindState(), null);
  await assert.rejects(h.rewind(second), /same AI/);
  await h.select("codex", "deepseek");
  assert.equal((await h.rewind(second)).text, "DeepSeek second");
  assert.equal(h.rewindCalls.length, 1);
});

const replacementRequest = { operationId: "rotation-1", expectedConversationId: "codex-original-thread", handover: "Keep the blue clock and its seconds display." };

test("native replacement preserves History and delivers the briefing once with the next ordinary Send", async (t) => {
  const h = await harness(t);
  await h.send("Build the clock");
  await h.bindNative();
  const history = await h.history();
  assert.equal((await h.replace(replacementRequest)).replacement.status, "ready");
  assert.deepEqual(await h.history(), history);
  assert.equal(h.calls.length, 1, "replacement performs no inference");
  assert.equal(await h.store.readMetadataValue("changeover", "codex_conversation_id"), "");
  await h.restart();
  assert.equal((await h.replace(replacementRequest)).replacement.status, "ready");
  await h.send("Continue", "successor-first");
  assert.equal(h.calls.at(-1).threadId, "fresh-successor");
  assert.match(h.calls.at(-1).message, /Keep the blue clock/u);
  assert.equal((await h.history()).at(-1).user.text, "Continue");
  const state = JSON.parse(await h.store.readMetadataValue("changeover", "assistant_changeover"));
  assert.equal(state.replacement.status, "accepted");
  assert.equal(state.replacement.handover, undefined);
  assert.equal(state.retiredConversations[0].conversationId, "codex-original-thread");
  assert.equal(state.retiredConversations[0].successorConversationId, "fresh-successor");
  await h.send("Next");
  assert.equal(h.calls.at(-1).message, "Next");
});

test("failed shutdown blocks Send across restart and retries the same replacement", async (t) => {
  const h = await harness(t);
  await h.bindNative();
  h.closeFailure = true;
  await assert.rejects(h.replace(replacementRequest), /stop unconfirmed/u);
  await h.restart();
  assert.doesNotThrow(() => requireCompletedNativeConversationReplacement({}));
  const pending = await h.context();
  assert.throws(() => requireCompletedNativeConversationReplacement(pending.session), { code: "vibe64_conversation_replacement_pending" });
  await assert.rejects(h.send("Do not deliver"), { code: "vibe64_conversation_replacement_pending" });
  assert.equal(await h.store.readMetadataValue("changeover", "codex_conversation_id"), "codex-original-thread");
  h.closeFailure = false;
  assert.equal((await h.replace(replacementRequest)).replacement.status, "ready");
});

test("partial binding writes resume without starting a successor or losing predecessor ownership", async (t) => {
  const h = await harness(t);
  await h.bindNative();
  const remove = h.store.deleteMetadataValue;
  let writes = 0;
  h.store.deleteMetadataValue = async (...args) => {
    if (++writes === 2) throw new Error("simulated process loss");
    return remove(...args);
  };
  await assert.rejects(h.replace(replacementRequest), /simulated process loss/u);
  await h.restart();
  await assert.rejects(h.send("Blocked"), { code: "vibe64_conversation_replacement_pending" });
  assert.equal((await h.replace(replacementRequest)).replacement.previous.conversationId, "codex-original-thread");
  assert.equal(h.calls.length, 0);
});

test("uncertain successor delivery retains predecessor ownership and recovers its receipt without repeating inference", async (t) => {
  const h = await harness(t);
  await h.bindNative();
  await h.replace(replacementRequest);
  h.failure = "lost-response";
  await assert.rejects(h.send("Continue", "first-new"), /connection lost/u);
  await h.restart();
  let state = JSON.parse(await h.store.readMetadataValue("changeover", "assistant_changeover"));
  assert.equal(state.replacement.status, "ready");
  assert.equal(state.retiredConversations, undefined);
  h.failure = "";
  await h.send("Continue", "first-new");
  state = JSON.parse(await h.store.readMetadataValue("changeover", "assistant_changeover"));
  assert.equal(state.replacement.status, "accepted");
  assert.equal(state.retiredConversations.length, 1);
  assert.equal(h.calls.length, 1);
});

test("replacement rejects changed identity, unbounded briefing and unconfirmed delivery", async (t) => {
  const h = await harness(t);
  await h.bindNative();
  await assert.rejects(h.replace({ ...replacementRequest, expectedConversationId: "other" }), /identity changed/u);
  await assert.rejects(h.replace({ ...replacementRequest, handover: "a".repeat(65537) }), /65536/u);
  await h.select("opencode");
  h.failure = "lost-response";
  await assert.rejects(h.send("Pending", "pending"), /connection lost/u);
  await h.select("codex");
  await assert.rejects(h.replace(replacementRequest), /pending delivery/u);
});

test("replacement refuses to deliver its briefing to the predecessor and blocks native bypass before briefing", async (t) => {
  const h = await harness(t);
  await h.bindNative();
  await h.replace(replacementRequest);
  const { session } = await h.context();
  assert.throws(() => requireCompletedNativeConversationReplacement(session, { requireBriefing: true }),
    { code: "vibe64_conversation_replacement_briefing_pending" });
  h.nativeThread = "codex-original-thread";
  await assert.rejects(h.send("Continue"), /fresh successor before sending/u);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.history()).length, 0);
});
