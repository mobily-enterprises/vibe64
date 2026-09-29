import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as vue from "vue";
import * as mdi from "@mdi/js";
import { compileScript, parse } from "@vue/compiler-sfc";
import { transform } from "esbuild";
import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";

const filename = new URL("../../packages/vibe64-colleague/src/client/Vibe64Colleague.vue", import.meta.url);
const { descriptor } = parse(await readFile(filename, "utf8"), { filename: String(filename) });
const { code } = await transform(compileScript(descriptor, { id: "colleague-client" }).content, { format: "cjs" });

test("Colleague recovers connection status and reports failed commands without clearing the draft", async (t) => {
  let offline = true;
  const response = { messages: [], status: "ready", error: "" };
  const view = mount(t, async () => {
    if (offline) throw new Error("Network request failed.");
    return { ...response };
  });
  await flush();
  assert.equal(view.state.connectionError.value, "Network request failed.");
  assert.equal(view.notices.length, 0, "background polling must not emit repeated command alerts");
  view.state.draft.value = "Keep this request";
  await view.state.submit();
  assert.equal(view.state.draft.value, "Keep this request");
  assert.equal(view.notices.length, 1);
  assert.equal(view.notices[0].intent, "action-feedback");
  offline = false;
  await view.state.refresh();
  assert.equal(view.state.connectionError.value, "");
  response.error = "The model could not answer.";
  await view.state.refresh();
  await flush();
  await view.state.refresh();
  await flush();
  assert.equal(view.notices.length, 2, "unchanged retained failures are reported once, not every poll");
});

test("live voice readiness forwards cancellation without sending a message", async (t) => {
  const requests = [];
  const view = mount(t, async (url, options) => {
    requests.push({ url, options });
    return { ok: true, messages: [], status: "ready" };
  });
  await flush();
  const controller = new AbortController();
  assert.equal((await view.state.checkVoice({ signal: controller.signal })).ok, true);
  const request = requests.find(request => request.url.endsWith("/voice/readiness"));
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.signal, controller.signal);
  assert.equal(request.options.body, undefined);
  assert.equal(requests.some(request => request.url.endsWith("/messages")), false);
});

test("Colleague signals a local message submission before its delayed admission", async (t) => {
  const admission = Promise.withResolvers();
  const view = mount(t, async (url) => url.endsWith("/messages") ? admission.promise : { messages: [], status: "ready" });
  await flush();
  const sending = view.state.sendMessage("Please speak again", { messageId: "invitation" });
  assert.deepEqual(view.events, [["message-submit", "invitation"]]);
  await assert.rejects(view.state.sendMessage("A duplicate", { messageId: "other" }), /Another message/);
  assert.equal(view.events.length, 1, "rejected overlapping sends do not invite speech");
  admission.resolve({ messages: [{ id: "invitation", role: "user", text: "Please speak again" }], status: "working" });
  await sending;
  assert.equal(view.state.state.value.messages[0].id, "invitation");
});

test("Colleague updates one reply bubble while keeping unfinished text out of voice history", async (t) => {
  const response = { messages: [{ id: "user", role: "user", text: "Hi" }], status: "working", streamingReply: null };
  const view = mount(t, async () => structuredClone(response));
  await flush();
  response.streamingReply = { id: "answer", role: "assistant", text: "Hello", status: "inProgress" };
  await view.state.refresh();
  assert.equal(view.state.adapter.value.conversation.turns[0].assistant.text, "Hello");
  assert.equal(view.state.adapter.value.conversation.turns[0].pending, true);
  assert.equal(view.state.state.value.messages.length, 1, "voice receives only saved messages");
  response.streamingReply.text = "Hello world";
  await view.state.refresh();
  assert.equal(view.state.adapter.value.conversation.turns.length, 1);
  assert.equal(view.state.adapter.value.conversation.turns[0].assistant.text, "Hello world");
  response.messages.push({ id: "answer", role: "assistant", text: "Hello world" });
  response.streamingReply = null;
  response.status = "ready";
  await view.state.refresh();
  assert.equal(view.state.adapter.value.conversation.turns.length, 1);
  assert.equal(view.state.adapter.value.conversation.turns[0].pending, false);
  assert.equal(view.state.state.value.messages.length, 2);
});

test("an older failed refresh cannot restore a recovered connection error", async (t) => {
  const pending = [];
  const view = mount(t, () => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const newer = view.state.refresh();
  pending[1].resolve({ messages: [], status: "ready", error: "" });
  await newer;
  pending[0].reject(new Error("Old network failure"));
  await flush();
  assert.equal(view.state.connectionError.value, "");
  assert.equal(view.notices.length, 0);
});

test("renaming updates conversation and composer labels without losing the draft", async (t) => {
  const props = vue.reactive({ name: "Colleague" });
  const view = mount(t, async () => ({ messages: [], status: "ready" }), props);
  await flush();
  view.state.draft.value = "Keep my question";
  props.name = "Ada";
  await flush();
  assert.equal(view.state.adapter.value.conversation.assistantLabel, "Ada");
  assert.equal(view.state.adapter.value.composer.ariaLabel, "Message Ada");
  assert.equal(view.state.adapter.value.composer.submitAriaLabel, "Send to Ada");
  assert.equal(view.state.draft.value, "Keep my question");
});

function mount(t, request, props = vue.reactive({ name: "Colleague" })) {
  const notices = [];
  const events = [];
  const realtime = new Map();
  const module = { exports: {} };
  const imports = {
    vue,
    "@jskit-ai/realtime/client/composables/useRealtimeEvent": {
      useRealtimeEvent: ({ event, onEvent }) => realtime.set(event, payload => onEvent({ payload })),
      useRealtimeSocket: () => ({ on: (event, handler) => realtime.set(event, handler), off: event => realtime.delete(event) })
    },
    "@mdi/js": mdi,
    "@/lib/vibe64AssistantHost.js": { VIBE64_COLLEAGUE_LAUNCHER_KEY: Symbol("launcher") },
    "@jskit-ai/shell-web/client/error": { useShellWebErrorRuntime: () => ({ report: notice => notices.push(notice) }) },
    "@jskit-ai/assistant-core/client/conversation": { AssistantConversationElement: {}, AssistantPromptInput: {} },
    "@jskit-ai/assistant-core/shared/conversation": { conversationTurnsFromMessages },
    "@/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue": { default: {} }
  };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(imports, name), name);
    return imports[name];
  }, module, module.exports);
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  let state;
  const renderer = vue.createRenderer({
    createComment: () => ({}), createElement: () => ({}), createText: () => ({}),
    insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {},
    parentNode: () => null, nextSibling: () => null
  });
  const app = renderer.createApp({ setup() {
    Object.assign(props, { request, focus: {}, navigate: null });
    state = module.exports.default.setup(props, { expose() {}, emit: (...args) => events.push(args) });
    return () => null;
  } });
  app.mount({});
  t.after(() => { app.unmount(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  return { state, notices, events, realtime };
}

test("avatar tap stays a tap; holding emits one recording gesture and suppresses its trailing click", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const view = mount(t, async () => ({ messages: [], status: "ready" }), vue.reactive({ name: "Colleague", holdToTalk: true }));
  await flush();
  const press = { pointerId: 1, button: 0, isPrimary: true, currentTarget: { setPointerCapture() {} } };
  view.state.startAvatarPress(press);
  t.mock.timers.tick(100);
  view.state.endAvatarPress(press);
  t.mock.timers.tick(400);
  assert.deepEqual(view.events, []);
  view.state.startAvatarPress(press);
  t.mock.timers.tick(350);
  assert.deepEqual(view.events, [["voice-hold-start"]]);
  view.state.endAvatarPress(press);
  view.state.cancelAvatarPress();
  assert.deepEqual(view.events, [["voice-hold-start"], ["voice-hold-end"]]);
  let prevented = false;
  view.state.avatarClick({ detail: 1, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(prevented, true);
  view.state.avatarClick({ detail: 0, preventDefault() { assert.fail("Keyboard activation remains available."); } });
});

test("cancelled avatar holds stop once and do not complete a recording", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const view = mount(t, async () => ({ messages: [], status: "ready" }), vue.reactive({ name: "Colleague", holdToTalk: true }));
  await flush();
  const press = { pointerId: 2, button: 0, currentTarget: { setPointerCapture() {} } };
  view.state.startAvatarPress(press);
  t.mock.timers.tick(350);
  view.state.cancelAvatarPress();
  view.state.endAvatarPress(press);
  assert.deepEqual(view.events, [["voice-hold-start"], ["voice-hold-cancel"]]);
});

async function flush() { await new Promise(resolve => setImmediate(resolve)); await vue.nextTick(); }


test("live replies precede polling, reject stale projections and reconcile completion once", async (t) => {
  const response = { messages: [{ id: "u", role: "user", text: "Hi" }], status: "working",
    streamEpoch: "runtime", streamRevision: 1, conversationId: "conversation" };
  const view = mount(t, async () => structuredClone(response));
  await flush();
  const receive = view.realtime.get("vibe64.colleague.reply.changed");
  const projection = { streamEpoch: "runtime", streamRevision: 3, conversationId: "conversation",
    streamingReply: { id: "answer", text: "Enough to start speaking. ", role: "assistant", status: "inProgress" } };
  receive(projection);
  assert.equal(view.state.state.value.streamingReply.text, projection.streamingReply.text);
  await view.state.refresh();
  receive({ ...projection, streamRevision: 2, streamingReply: null });
  assert.equal(view.state.state.value.streamingReply.text, projection.streamingReply.text, "a late HTTP response or event cannot rewind speech");
  receive({ ...projection, streamRevision: 4, streamingReply: null,
    completedMessage: { id: "answer", text: "Enough to start speaking. Finished.", role: "assistant" } });
  await flush();
  assert.equal(view.state.state.value.messages.filter(message => message.id === "answer").length, 1);
  assert.equal(view.state.state.value.streamingReply, null);
  receive(projection);
  assert.equal(view.state.state.value.streamingReply, null, "late tokens cannot replay a completed reply");
});


test("live user transcription shares chat and is replaced once by its admitted message", async (t) => {
  const props = vue.reactive({ name: "Colleague", voiceTranscript: null });
  const response = { messages: [], status: "ready" };
  const view = mount(t, async () => structuredClone(response), props);
  await flush();
  view.state.draft.value = "My independent typed draft";
  props.voiceTranscript = { id: "voice-1", text: "I meant A" };
  assert.equal(view.state.adapter.value.conversation.turns[0].user.text, "I meant A");
  assert.equal(view.state.adapter.value.conversation.turns[0].optimistic.status, "pending");
  props.voiceTranscript.text = "I meant A with sugar";
  assert.equal(view.state.adapter.value.conversation.turns[0].user.text, "I meant A with sugar");
  assert.equal(view.state.state.value.messages.length, 0, "partial words are not canonical history");
  response.messages = [{ id: "voice-1", role: "user", text: props.voiceTranscript.text }];
  await view.state.refresh();
  assert.equal(view.state.adapter.value.conversation.turns.length, 1);
  assert.equal(view.state.adapter.value.conversation.turns[0].optimistic, undefined);
  props.voiceTranscript = null;
  assert.equal(view.state.adapter.value.conversation.turns.length, 1);
  assert.equal(view.state.draft.value, "My independent typed draft");
});
