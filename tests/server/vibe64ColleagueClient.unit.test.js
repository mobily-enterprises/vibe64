import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import * as vue from "vue";
import { routeLocationKey } from "vue-router";
import * as mdi from "@mdi/js";
import { compileScript, parse } from "@vue/compiler-sfc";
import { transform } from "esbuild";
import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";
import * as realtimeComposables from "@jskit-ai/realtime/client/composables/useRealtimeEvent";

// This source-evaluating renderer compiles the exercised SFCs below. Package
// barrels need only presentation placeholders; all JavaScript stays installed.
const presentationRoots = ["assistant-core", "assistant-runtime", "assistant-voice"]
  .map(name => new URL("./", import.meta.resolve(`@jskit-ai/${name}/client`)).href);
const presentationStub = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".vue") && presentationRoots.some(root => url.startsWith(root))) {
      return { format: "module", source: "export default {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  }
});
let createAssistantApi;
let projectConversationVoiceState;
let useAssistantConversation;
try {
  ({ createAssistantApi } = await import("@jskit-ai/assistant-core/client"));
  ({ projectConversationVoiceState } = await import("@jskit-ai/assistant-voice/client"));
  ({ useAssistantConversation } = await import(new URL("./composables/useAssistantConversation.js",
    import.meta.resolve("@jskit-ai/assistant-runtime/client"))));
} finally {
  presentationStub.deregister();
}
const { createWebPlacementRuntime } = await import(new URL("./runtime.js",
  import.meta.resolve("@jskit-ai/shell-web/client/placement")));
const { ASSISTANT_CONVERSATION_SUBSCRIBE, ASSISTANT_CONVERSATION_UNSUBSCRIBE, ASSISTANT_CONVERSATION_EVENT } =
  await import(new URL("../shared/conversationRealtime.js", import.meta.resolve("@jskit-ai/assistant-runtime/client")));

const filename = new URL("../../packages/vibe64-colleague/src/client/Vibe64Colleague.vue", import.meta.url);
const { descriptor } = parse(await readFile(filename, "utf8"), { filename: String(filename) });
const { code } = await transform(compileScript(descriptor, { id: "colleague-client" }).content, { format: "cjs" });
const elementFilename = new URL("./AssistantConversationElement.vue", import.meta.resolve("@jskit-ai/assistant-core/client/conversation"));
const { descriptor: elementDescriptor } = parse(await readFile(elementFilename, "utf8"), { filename: String(elementFilename) });
const { code: elementCode } = await transform(compileScript(elementDescriptor, { id: "colleague-element" }).content, { format: "cjs" });
const elementModule = { exports: {} };
new Function("require", "module", "exports", elementCode)(name => {
  if (name === "vue") return vue;
  if (name === "@mdi/js") return mdi;
  assert.ok(name.endsWith(".vue"), name);
  return { default: {} };
}, elementModule, elementModule.exports);
// Use the moved launcher with this renderer's Vue instance. SFC imports are
// presentation stubs; the actual hold/cancel implementation remains exercised.
const launcherSource = new URL("./voiceLauncher.js", import.meta.resolve("@jskit-ai/assistant-voice/client"));
const { code: launcherCode } = await transform(await readFile(launcherSource, "utf8"), { format: "cjs" });
const launcherModule = { exports: {} };
new Function("require", "module", "exports", launcherCode)(name => {
  assert.equal(name, "vue");
  return vue;
}, launcherModule, launcherModule.exports);

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

test("voice admission sends directly to Colleague and preserves its identity and focus", async (t) => {
  const requests = [];
  const view = mount(t, async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/messages")) return { status: "accepted", messageId: options.body.messageId, turnId: options.body.messageId };
    return { ok: true, messages: [], status: "ready" };
  });
  await flush();
  const focus = { projectSlug: "tea" };
  await view.state.sendMessage("What about sugar?", { messageId: "voice-question", focus });
  const commands = requests.filter(request => request.options.method === "POST");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].url, "/api/assistant/app/conversations/conversation/messages");
  assert.equal(commands[0].options.body.text, "What about sugar?");
  assert.equal(commands[0].options.body.messageId, "voice-question");
  assert.deepEqual(commands[0].options.body.data.focus, focus);
  assert.equal(requests.some(request => request.url.includes("/voice/")), false);
});

test("Colleague model selection uses its canonical identity and the existing product choice", async t => {
  const assistantSelection = { engineId: "codex", modelProviderId: "openai", modelId: "offered-model", catalogRevision: "observed-revision" };
  const view = mount(t, async (url, options) => ({ ok: true, conversationId: "same-person", messages: [], status: "ready",
    ...(url.endsWith("/selection") ? { assistantSelection: options.body.selection.assistantSelection } : {}) }));
  await flush();
  view.state.draft.value = "Keep this draft";
  const result = await view.state.selectModel(assistantSelection);
  await flush();
  assert.equal(result.ok, true);
  const changes = view.requests.filter(({ options }) => options.method === "POST");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].url, "/api/assistant/app/conversations/same-person/selection");
  assert.deepEqual(changes[0].options.body, { selection: { assistantSelection } });
  assert.equal(changes[0].options.headers["x-jskit-surface"], "app");
  assert.deepEqual(view.state.product.value.assistantSelection, assistantSelection);
  assert.equal(view.state.draft.value, "Keep this draft");
  assert.equal(view.requests.some(({ url }) => url === "/api/vibe64/colleague/model"), false);
});

test("Colleague signals a local message submission before its delayed admission", async (t) => {
  const admission = Promise.withResolvers();
  const view = mount(t, async (url) => url.endsWith("/messages") ? admission.promise : { messages: [], status: "ready" });
  await flush();
  await view.state.openVoice();
  const sending = view.state.sendMessage("Please speak again", { messageId: "invitation" });
  assert.deepEqual(view.events, [["message-submit", "invitation"]]);
  await assert.rejects(view.state.sendMessage("A duplicate", { messageId: "other" }), /Another message/);
  assert.equal(view.events.length, 1, "rejected overlapping sends do not invite speech");
  view.setConversation({ messages: [{ id: "invitation", role: "user", text: "Please speak again" }], status: "working" });
  admission.resolve({ status: "accepted", messageId: "invitation", turnId: "invitation" });
  await sending;
  await flush();
  assert.equal(view.state.voice.controller.state.binding.state.messages[0].id, "invitation");
});

test("Colleague updates one reply bubble while keeping unfinished text out of voice history", async (t) => {
  const response = { messages: [{ id: "user", role: "user", text: "Hi" }], status: "working", streamingReply: null };
  const view = mount(t, async () => structuredClone(response));
  await flush();
  await view.state.openVoice();
  response.streamingReply = { id: "answer", role: "assistant", text: "Hello", status: "inProgress" };
  let snapshot = view.setConversation(response, 1);
  view.publish({ type: "message", ...snapshot.streaming.messages[0], streaming: snapshot.streaming });
  assert.equal(view.state.adapter.value.conversation.turns[0].assistant.text, "Hello");
  assert.equal(view.state.adapter.value.conversation.turns[0].pending, true);
  assert.equal(view.state.voice.controller.state.binding.state.messages.length, 1, "voice receives only saved messages");
  response.streamingReply.text = "Hello world";
  snapshot = view.setConversation(response, 2);
  view.publish({ type: "message", ...snapshot.streaming.messages[0], streaming: snapshot.streaming });
  assert.equal(view.state.adapter.value.conversation.turns.length, 1);
  assert.equal(view.state.adapter.value.conversation.turns[0].assistant.text, "Hello world");
  response.messages.push({ id: "answer", role: "assistant", text: "Hello world" });
  response.streamingReply = null;
  response.status = "ready";
  view.setConversation(response, 3);
  view.publish({ type: "settled", turnId: "user", status: "complete" });
  await flush();
  assert.equal(view.state.adapter.value.conversation.turns.length, 1);
  assert.equal(view.state.adapter.value.conversation.turns[0].pending, false);
  assert.equal(view.state.voice.controller.state.binding.state.messages.length, 2);
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

function conversationSnapshot(response = {}, streamRevision = response.streamRevision || 0) {
  const messages = response.messages || [];
  const conversationLog = conversationTurnsFromMessages(messages).map(turn => ({ ...turn,
    metadata: { runtime: { status: turn.assistant || response.status !== "working" ? "complete" : "running", origin: "user" } }
  }));
  const reply = response.streamingReply;
  const live = reply?.text ? conversationTurnsFromMessages([...messages, reply]).at(-1) : null;
  return {
    id: response.conversationId || "conversation", status: response.status || "ready", error: response.error || "",
    capabilities: { steering: true, goals: false, attachments: false }, pendingRequest: null, conversationLog,
    streaming: { revision: streamRevision, messages: live ? [{ ...live.assistant,
      turnId: live.turnId, origin: "user", status: "inProgress" }] : [] }
  };
}

function mount(t, request, props = vue.reactive({ name: "Colleague" })) {
  const notices = [];
  const events = [];
  const requests = [];
  const listeners = new Map();
  const subscriptions = new Map();
  let canonical = conversationSnapshot();
  let initialized = false;
  function dispatch(event, payload) {
    for (const listener of [...(listeners.get(event) || [])]) listener(payload);
  }
  const socket = {
    connected: true,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    },
    off(event, listener) { listeners.get(event)?.delete(listener); },
    emit(event, input) {
      assert.equal(event, ASSISTANT_CONVERSATION_UNSUBSCRIBE);
      subscriptions.delete(input.subscriptionId);
    },
    timeout() {
      return { emit(event, input, acknowledge) {
        assert.equal(event, ASSISTANT_CONVERSATION_SUBSCRIBE);
        const subscription = { ...input, epoch: crypto.randomUUID(), revision: 0 };
        subscriptions.set(input.subscriptionId, subscription);
        acknowledge(null, { ok: true, subscriptionId: input.subscriptionId,
          streamEpoch: subscription.epoch, state: structuredClone(canonical) });
      } };
    }
  };
  function publish(event, { streamRevision, streamEpoch } = {}) {
    for (const subscription of [...subscriptions.values()]) {
      const revision = streamRevision ?? subscription.revision + 1;
      subscription.revision = Math.max(subscription.revision, revision);
      dispatch(ASSISTANT_CONVERSATION_EVENT, { subscriptionId: subscription.subscriptionId,
        conversationId: subscription.conversationId, streamEpoch: streamEpoch || subscription.epoch,
        streamRevision: revision, event: { conversationId: subscription.conversationId, ...structuredClone(event) } });
    }
  }
  function setConversation(response, streamRevision) {
    initialized = true;
    canonical = conversationSnapshot(response, streamRevision);
    return structuredClone(canonical);
  }
  async function requestHost(url, options = {}) {
    requests.push({ url, options });
    // Canonical reads have their own controlled response. In particular, they
    // must not consume either deferred product request in the stale-read case.
    if (url === `/api/assistant/app/conversations/${canonical.id}` && options.method === "GET") return structuredClone(canonical);
    const result = await request(url, options);
    if (url.startsWith("/api/vibe64/colleague?") && result) {
      if (!initialized) setConversation(result);
      return { ...result, conversationId: result.conversationId || canonical.id };
    }
    return result;
  }
  const voiceState = vue.shallowReactive({ binding: null, session: null, visible: false });
  const voice = {
    launcher: vue.ref(null),
    controller: {
      state: voiceState,
      minimize() { voiceState.visible = false; },
      reveal() { voiceState.visible = true; },
      async end() { voiceState.binding = null; voiceState.session = null; voiceState.visible = false; }
    },
    async open(binding) {
      voiceState.binding = binding;
      voiceState.visible = true;
      voiceState.session = {
        voice: { listening: vue.ref(false) }, microphoneMuted: vue.ref(true),
        startHeldRecording() { events.push(["voice-hold-start"]); },
        finishHeldRecording() { events.push(["voice-hold-end"]); },
        discardHeldRecording() { events.push(["voice-hold-cancel"]); },
        inviteSpeech() {}
      };
      return true;
    }
  };
  const module = { exports: {} };
  const imports = {
    vue,
    "@local/vibe64-voice/client": { useVibe64Voice: () => voice },
    "@jskit-ai/assistant-voice/client": { ConversationDialog: {}, projectConversationVoiceState,
      useVoiceLauncher: launcherModule.exports.useVoiceLauncher },
    "@jskit-ai/assistant-runtime/client": { useAssistantConversation },
    "@jskit-ai/assistant-core/client": { createAssistantApi },
    "@jskit-ai/realtime/client/composables/useRealtimeEvent": realtimeComposables,
    "@mdi/js": mdi,
    "/src/lib/vibe64AssistantHost.js": { VIBE64_COLLEAGUE_LAUNCHER_KEY: Symbol("launcher"), VIBE64_ASSISTANT_VIEWER_KEY: Symbol("viewer") },
    "@jskit-ai/shell-web/client/error": { useShellWebErrorRuntime: () => ({ report: notice => notices.push(notice) }) },
    "@jskit-ai/assistant-core/client/conversation": { AssistantConversationElement: {}, AssistantPromptInput: {} },
    "@jskit-ai/assistant-core/shared/conversation": { conversationTurnsFromMessages },
    "/src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue": { default: {} }
  };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(imports, name), name);
    return imports[name];
  }, module, module.exports);
  const previousWindow = globalThis.window;
  const previousConfig = globalThis.__JSKIT_CLIENT_APP_CONFIG__;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.__JSKIT_CLIENT_APP_CONFIG__ = {
    surfaceDefinitions: { app: { requiresWorkspace: false } },
    assistantSurfaces: { app: { settingsSurfaceId: "app", configScope: "global" } }
  };
  let state;
  let element;
  const renderer = vue.createRenderer({
    createComment: () => ({}), createElement: () => ({}), createText: () => ({}),
    insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {},
    parentNode: () => null, nextSibling: () => null
  });
  const app = renderer.createApp({ setup() {
    Object.assign(props, { request: requestHost, focus: {}, navigate: null });
    state = module.exports.default.setup(props, { expose() {}, emit: (...args) => events.push(args) });
    // The moved preview belongs to the actual element display after delivery,
    // never the canonical turns observed by admission reconciliation.
    const elementProps = vue.reactive({ get adapter() { return state.adapter.value; } });
    element = elementModule.exports.default.setup(elementProps, { expose() {} });
    return () => null;
  } });
  const placement = createWebPlacementRuntime({ components: new Map() });
  placement.setContext({ surfaceConfig: { defaultSurfaceId: "app", surfacesById: {
    app: { id: "app", routeBase: "/", requiresWorkspace: false }
  } } });
  app.provide("jskit.shell-web.runtime.web-placement.client", placement);
  app.provide(routeLocationKey, vue.reactive({ path: "/" }));
  app.provide("jskit.realtime.runtime.client.socket", socket);
  app.mount({});
  t.after(() => {
    app.unmount();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousConfig === undefined) delete globalThis.__JSKIT_CLIENT_APP_CONFIG__; else globalThis.__JSKIT_CLIENT_APP_CONFIG__ = previousConfig;
  });
  return { state, notices, events, requests, socket, subscriptions, publish, setConversation, display: element.conversation,
    reconnect() {
      socket.connected = false;
      dispatch("disconnect");
      socket.connected = true;
      dispatch("connect");
    }
  };
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
  await flush();
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
  await flush();
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
  await view.state.openVoice();
  const message = { messageId: "answer", turnId: "u", origin: "user",
    text: "Enough to start speaking. ", role: "assistant", status: "inProgress" };
  const projection = { type: "message", ...message, streaming: { revision: 3, messages: [message] } };
  view.publish(projection, { streamRevision: 3 });
  assert.equal(view.state.voice.controller.state.binding.state.streamingReply.text, projection.text);
  await view.state.refresh();
  view.state.adapter.value.actions.reload();
  await flush();
  view.publish({ type: "message-complete", turnId: "u", messageId: "answer",
    streaming: { revision: 2, messages: [] } }, { streamRevision: 2 });
  assert.equal(view.state.voice.controller.state.binding.state.streamingReply.text, projection.text, "a late HTTP response or event cannot rewind speech");
  const final = { id: "answer", text: "Enough to start speaking. Finished.", role: "assistant" };
  const completed = view.setConversation({ ...response, status: "ready", messages: [...response.messages, final] }, 4);
  view.publish({ type: "message", ...message, text: final.text, status: "complete", streaming: completed.streaming }, { streamRevision: 4 });
  view.publish({ type: "settled", turnId: "u", status: "complete" });
  await flush();
  assert.equal(view.state.voice.controller.state.binding.state.messages.filter(message => message.id === "u:assistant").length, 1);
  assert.equal(view.state.voice.controller.state.binding.state.streamingReply, null);
  view.publish(projection, { streamRevision: 3 });
  assert.equal(view.state.voice.controller.state.binding.state.streamingReply, null, "late tokens cannot replay a completed reply");
});


test("live user transcription shares chat and is replaced once by its admitted message", async (t) => {
  const props = vue.reactive({ name: "Colleague" });
  const response = { messages: [], status: "ready" };
  const view = mount(t, async () => structuredClone(response), props);
  await flush();
  await view.state.openVoice();
  view.state.draft.value = "My independent typed draft";
  view.state.voiceTranscript.value = { id: "voice-1", text: "I meant A" };
  assert.equal(view.display.value.turns[0].user.text, "I meant A");
  assert.equal(view.display.value.turns[0].optimistic.status, "pending");
  view.state.voiceTranscript.value.text = "I meant A with sugar";
  assert.equal(view.display.value.turns[0].user.text, "I meant A with sugar");
  assert.equal(view.state.voice.controller.state.binding.state.messages.length, 0, "partial words are not canonical history");
  response.messages = [{ id: "voice-1", role: "user", text: view.state.voiceTranscript.value.text }];
  await view.state.refresh();
  view.setConversation(response);
  view.publish({ type: "accepted", turnId: "voice-1", messageId: "voice-1" });
  await flush();
  assert.equal(view.display.value.turns.length, 1);
  assert.equal(view.display.value.turns[0].optimistic, undefined);
  view.state.voiceTranscript.value = null;
  assert.equal(view.display.value.turns.length, 1);
  assert.equal(view.state.draft.value, "My independent typed draft");
});
