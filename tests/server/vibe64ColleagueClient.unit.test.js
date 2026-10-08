import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import * as vue from "vue";
import { useTrainingPresentationCue } from "../../packages/vibe64-training/src/client/useTrainingPresentationCue.js";
import { useTrainingLearnerGestures } from "../../packages/vibe64-training/src/client/useTrainingLearnerGestures.js";
import { createTrainingNavigation } from "../../packages/vibe64-training/src/client/createTrainingNavigation.js";
import { routeLocationKey } from "vue-router";
import * as mdi from "@mdi/js";
import { compileScript, parse } from "@vue/compiler-sfc";
import { transform } from "esbuild";
import { conversationTurnsFromMessages, mergeConversationLogPages, normalizeConversationLogPage } from "@jskit-ai/assistant-core/shared/conversation";
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

test("combined Colleague retains its adapter and typed draft while speech review gates only Send", async t => {
  const view = mount(t, async () => ({ ok: true, conversationId: "same-person", messages: [], status: "ready" }));
  await flush();
  const original = view.state.conversation.runtime.value;
  const actions = view.state.adapter.value.actions;
  view.state.draft.value = "Keep this separate typed draft";
  await view.state.openVoice();
  const { binding, session } = view.state.voice.controller.state;
  assert.equal(binding.conversationId, original.identity.conversationId);
  assert.equal(binding.id, JSON.stringify(["colleague", original.identity.actorKey]));
  assert.equal(binding.openText, undefined, "combined Colleague has no mode navigation");
  assert.equal(binding.adapter.actions.submit, view.state.conversation.adapter.value.actions.submit);
  const target = vue.markRaw({});
  binding.setConversationTarget(target);
  assert.equal(view.state.voicePanelTarget.value, target);
  assert.equal(view.state.bodyVisible.value, true);
  session.hasUnsentSpeech.value = true;
  assert.equal(view.state.adapter.value.composer.canSend, false);
  assert.equal(view.state.adapter.value.composer.disabled, false);
  const before = view.requests.filter(({ options }) => options.method === "POST").length;
  await view.state.submit();
  assert.equal(view.requests.filter(({ options }) => options.method === "POST").length, before);
  view.state.draft.value = "Still editable during review";
  assert.equal(view.state.draft.value, "Still editable during review");
  session.hasUnsentSpeech.value = false;
  assert.equal(view.state.adapter.value.composer.canSend, true);
  view.state.voice.controller.minimize();
  assert.equal(view.state.bodyVisible.value, false);
  view.state.voice.controller.reveal();
  assert.equal(view.state.bodyVisible.value, true);
  assert.equal(view.state.conversation.runtime.value, original);
  assert.equal(view.state.adapter.value.actions.submit, actions.submit);
  assert.equal(view.subscriptions.size, 1);
  binding.setConversationTarget(null);
  assert.equal(view.state.voicePanelTarget.value, null);
});

test("the right drawer and fullscreen phone keep one Colleague target through resize and minimize", async t => {
  const view = mount(t, async () => ({ ok: true, conversationId: "drawer-person", messages: [], status: "ready" }));
  await flush();
  const runtime = view.state.conversation.runtime.value;
  const submit = view.state.adapter.value.actions.submit;
  const desktopPanel = vue.markRaw({ id: "desktop-panel" });
  const phonePanel = vue.markRaw({ id: "phone-panel" });
  view.state.desktopPanelTarget.value = desktopPanel;
  view.state.panelTarget.value = phonePanel;
  view.state.draft.value = "Keep this typed question";
  await view.state.openVoice();
  const { binding, session } = view.state.voice.controller.state;
  assert.equal(binding.presentation, "inline", "Colleague owns its frame, not a second root voice dialog");
  assert.equal(view.state.inlineVoice.value, false, "Colleague's inline frame is distinct from Main's inline view");
  assert.equal(view.state.conversationTarget.value, desktopPanel);
  assert.equal(view.state.shown.value, true);
  session.pendingTranscript.value = { messageId: "drawer-speech", text: "Keep these spoken words", editing: true };
  session.sending.value = true;
  let ended = 0;
  const end = view.state.voice.controller.end;
  view.state.voice.controller.end = async options => { ended++; await end(options); };
  let focused = 0;
  view.state.launcher.value = vue.markRaw({ $el: { focus() { focused++; } } });

  view.state.xs.value = true;
  await flush();
  assert.equal(view.state.conversationTarget.value, phonePanel);
  assert.equal(view.state.bodyVisible.value, true);
  assert.deepEqual(view.state.adapter.value.conversation.previewMessages.map(({ id, text }) => [id, text]),
    [["drawer-speech", "Keep these spoken words"]]);
  await view.state.toggleConversation();
  assert.equal(view.state.bodyVisible.value, false);
  assert.equal(view.state.minimizedVoice.value, true);
  assert.equal(focused, 1, "minimizing returns focus to the existing launcher");
  assert.equal(ended, 0, "hiding the phone frame does not stop admission, capture or playback");
  view.state.xs.value = false;
  await view.state.toggleConversation();
  assert.equal(view.state.conversationTarget.value, desktopPanel);
  assert.equal(view.state.bodyVisible.value, true);
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.state.voice.controller.state.binding, binding);
  assert.equal(view.state.conversation.runtime.value, runtime);
  assert.equal(view.state.adapter.value.actions.submit, submit);
  assert.equal(view.state.draft.value, "Keep this typed question");
  assert.equal(session.sending.value, true);
  assert.equal(session.pendingTranscript.value.messageId, "drawer-speech");
  assert.equal(view.subscriptions.size, 1);
  assert.equal(view.requests.some(({ options }) => options.method === "POST"), false);

  const switchDialog = vue.markRaw({ id: "original-target-switch-dialog" });
  binding.setConversationTarget(switchDialog);
  assert.equal(view.state.voicePanelTarget.value, switchDialog, "the original root target switch retains its body facility");
  binding.setConversationTarget(null);
  assert.equal(view.state.conversationTarget.value, desktopPanel);
  await view.state.closeText();
  assert.equal(ended, 1, "only explicit Close ends the existing voice session");
  assert.equal(focused, 2);
  assert.equal(view.state.bodyVisible.value, false);
  assert.equal(view.state.draft.value, "Keep this typed question");
  assert.equal(view.state.conversation.runtime.value, runtime);
});

test("Colleague temporary speech edits its bubble independently of the typed draft and preserves uncertain recovery", async t => {
  const view = mount(t, async () => ({ ok: true, messages: [], status: "ready" }));
  await flush();
  await view.state.openVoice();
  const { binding, session } = view.state.voice.controller.state;
  const target = view.state.conversation.runtime.value;
  const calls = [];
  session.takeTranscript = async messageId => {
    calls.push(messageId);
    session.pendingTranscript.value = null;
    binding.onTranscript(null, { canTake: false });
    return true;
  };
  session.beginTranscriptEdit = async messageId => {
    session.pendingTranscript.value = { messageId, text: "Exact temporary words", editing: true };
    return true;
  };
  session.editTranscript = (text, messageId) => {
    session.pendingTranscript.value = { ...session.pendingTranscript.value, text };
    binding.onTranscript({ id: messageId, text }, { canTake: true });
  };
  let sends = 0;
  session.deliverTranscript = async () => {
    sends += 1;
    const pending = session.pendingTranscript.value;
    await target.delivery.send({ message: pending.text, request: { text: pending.text } },
      { messageId: pending.messageId, deliver: async () => ({ ok: true }) });
    session.pendingTranscript.value = null;
    binding.onTranscript(null, { canTake: false });
  };
  await target.delivery.send({ message: "Exact temporary words", request: { text: "Exact temporary words", steer: true } },
    { messageId: "unsent", deliver: async () => ({ ok: false, error: "No active turn" }) });
  assert.equal(target.delivery.find("unsent").payload.request.steer, true);
  binding.onTranscript({ id: "unsent", text: "Exact temporary words" }, { canTake: true });
  const actions = view.state.adapter.value.conversation.previewMessage.actions;
  assert.equal(actions.canEdit, true);
  view.state.draft.value = "Keep my typed request";
  assert.equal(view.state.adapter.value.conversation.previewMessage.actions.canEdit, true);
  assert.equal(await actions.edit("stale"), false);
  assert.equal(session.pendingTranscript.value, null);
  assert.equal(await actions.edit("unsent"), true);
  assert.equal(target.delivery.find("unsent"), null);
  assert.equal(view.state.draft.value, "Keep my typed request");
  assert.equal(view.state.adapter.value.conversation.previewMessage.text, "Exact temporary words");
  assert.equal(view.state.adapter.value.conversation.previewMessage.actions.editing, true);
  assert.equal(actions.update("stale", "Wrong message"), false);
  assert.equal(actions.update("unsent", ""), true);
  assert.equal(view.state.adapter.value.conversation.previewMessage.text, "");
  assert.equal(view.state.adapter.value.conversation.previewMessage.actions.canSend, false);
  assert.equal(await view.state.adapter.value.conversation.previewMessage.actions.send("unsent"), false);
  assert.equal(sends, 0);
  assert.equal(actions.update("unsent", "Edited speech"), true);
  assert.equal(view.state.adapter.value.conversation.previewMessage.actions.canSend, true);
  assert.equal(await view.state.adapter.value.conversation.previewMessage.actions.send("unsent"), true);
  assert.equal(sends, 1);
  assert.deepEqual(target.delivery.find("unsent").payload.request, { text: "Edited speech" });
  assert.equal(view.state.draft.value, "Keep my typed request");
  assert.equal(view.state.adapter.value.conversation.previewMessage, null);
  assert.equal(view.state.adapter.value.conversation.turns.length, 0);
  await target.delivery.send({ message: "Only these words", request: { text: "Only these words", steer: true } },
    { messageId: "discard", deliver: async () => ({ ok: false, error: "No active turn" }) });
  binding.onTranscript({ id: "discard", text: "Only these words" }, { canTake: true });
  target.delivery.state.messages.push({ id: "uncertain", status: "uncertain" });
  assert.equal(view.state.adapter.value.conversation.previewMessage.actions.canDiscard, false);
  const before = calls.length;
  assert.equal(await view.state.adapter.value.conversation.previewMessage.actions.discard("discard"), false);
  assert.equal(calls.length, before);
  target.delivery.state.messages.pop();
  assert.equal(await view.state.adapter.value.conversation.previewMessage.actions.discard("discard"), true);
  assert.equal(target.delivery.find("discard"), null);
  assert.equal(view.state.draft.value, "Keep my typed request");
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.subscriptions.size, 1);
});

for (const recovery of ["edit", "discard"]) {
  test(`Colleague retains failed A and newer B through explicit ${recovery}`, async t => {
    const view = mount(t, async () => ({ ok: true, messages: [], status: "ready" }));
    await flush();
    await view.state.openVoice();
    const { binding, session } = view.state.voice.controller.state;
    const target = view.state.conversation.runtime.value;
    view.state.draft.value = "Keep typed draft";
    session.pendingTranscript.value = { messageId: "failed-a", text: "Failed A words", focus: { projectSlug: "original" } };
    session.takeTranscript = async messageId => {
      if (session.pendingTranscript.value?.messageId === messageId) session.pendingTranscript.value = null;
      else binding.onTranscript(null, { canTake: false });
      return true;
    };
    session.beginTranscriptEdit = async messageId => {
      if (session.pendingTranscript.value?.messageId !== messageId) return false;
      session.pendingTranscript.value = { ...session.pendingTranscript.value, editing: true };
      return true;
    };
    session.editTranscript = (text, messageId) => {
      if (session.pendingTranscript.value?.messageId === messageId) session.pendingTranscript.value = { ...session.pendingTranscript.value, text };
    };
    session.deliverTranscript = async () => {
      const pending = session.pendingTranscript.value;
      await target.delivery.send({ message: pending.text, request: { text: pending.text } },
        { messageId: pending.messageId, deliver: async () => ({ ok: true }) });
      session.pendingTranscript.value = null;
    };
    await target.delivery.send({ message: "Failed A words", request: { text: "Failed A words", steer: true } },
      { messageId: "failed-a", deliver: async () => ({ ok: false, error: "No active turn" }) });
    binding.onTranscript({ id: "live-b", text: "Keep newer B words" }, { canTake: true });
    const previews = view.state.adapter.value.conversation.previewMessages;
    assert.deepEqual(previews.map(preview => preview.id), ["failed-a", "live-b"]);
    assert.equal(previews[0].actions.canEdit, true);
    assert.equal(previews[1].actions.canEdit, false);
    assert.equal(previews[1].actions.canDiscard, true);
    if (recovery === "edit") {
      assert.equal(await previews[0].actions.edit("failed-a"), true);
      assert.equal(target.delivery.find("failed-a"), null);
      assert.equal(view.state.adapter.value.conversation.previewMessages[1].text, "Keep newer B words");
      assert.equal(previews[0].actions.update("failed-a", "Corrected A words"), true);
      assert.equal(await view.state.adapter.value.conversation.previewMessages[0].actions.send("failed-a"), true);
      assert.deepEqual(target.delivery.find("failed-a").payload.request, { text: "Corrected A words" });
    } else {
      assert.equal(await previews[0].actions.discard("failed-a"), true);
      assert.equal(target.delivery.find("failed-a"), null);
    }
    assert.deepEqual(view.state.adapter.value.conversation.previewMessages.map(preview => [preview.id, preview.text]),
      [["live-b", "Keep newer B words"]]);
    assert.equal(view.state.adapter.value.conversation.previewMessages[0].actions.canEdit, true);
    assert.equal(view.state.draft.value, "Keep typed draft");
    assert.equal(view.state.conversation.runtime.value, target);
  });
}

test("opening Colleague keeps its existing typed body available when voice setup fails", async t => {
  const view = mount(t, async () => ({ ok: true, messages: [], status: "ready" }));
  await flush();
  view.state.draft.value = "I can send this without speech";
  view.state.voice.open = async () => { throw new Error("Speech is unavailable"); };
  await assert.rejects(view.state.toggleConversation(), /Speech is unavailable/);
  assert.equal(view.state.open.value, true);
  assert.equal(view.state.bodyVisible.value, true);
  assert.equal(view.state.adapter.value.composer.canSend, true);
  assert.equal(view.state.draft.value, "I can send this without speech");
  assert.equal(view.subscriptions.size, 1);
});

test("the Colleague launcher opens its target while Main is inline and preserves a pending target switch", async t => {
  const view = mount(t, async () => ({ ok: true, messages: [], status: "ready" }));
  await flush();
  view.state.draft.value = "Keep this Colleague draft";
  const state = view.state.voice.controller.state;
  const main = { id: "main", presentation: "inline", label: "Project agent" };
  const recording = { hasUnsentSpeech: vue.ref(true) };
  state.binding = main;
  state.session = recording;
  state.visible = true;
  assert.equal(view.state.shown.value, false, "Main's inline controls are not an open Colleague dialog");
  assert.equal(view.state.minimizedVoice.value, false, "Main's visible inline view is not a minimized dialog");
  view.state.voice.open = async binding => {
    state.nextTarget = binding;
    state.visible = true;
    return false;
  };
  await view.state.toggleConversation();
  assert.equal(state.binding, main);
  assert.equal(state.session, recording, "opening Colleague cannot discard Main's recording");
  assert.equal(state.nextTarget.socketUrl, "/api/vibe64/colleague/voice/ws");
  assert.equal(view.state.shown.value, true, "the existing pending-switch dialog becomes reachable");
  assert.equal(view.state.bodyVisible.value, false, "Colleague does not cover the pending-switch dialog");
  assert.equal(view.state.draft.value, "Keep this Colleague draft");
  assert.equal(view.requests.some(({ options }) => options.method === "POST"), false, "opening sends no agent request");
});

test("the root voice host keeps live adapters and forwards explicit preferences and canonical playback", async t => {
  const filename = new URL("../../packages/vibe64-voice/src/client/Vibe64VoiceHost.vue", import.meta.url);
  const { descriptor } = parse(await readFile(filename, "utf8"), { filename: String(filename) });
  const { code } = await transform(compileScript(descriptor, { id: "voice-host" }).content, { format: "cjs" });
  const key = Symbol("voice-host");
  const controller = { state: {}, open({ conversation }) { this.state.binding = conversation; return true; }, dispose() {} };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "vue") return vue;
    if (name === "@jskit-ai/assistant-voice/client") return { createVoiceConversationController: () => controller, VoiceConversationHost: {} };
    assert.equal(name, "./voiceHost.js");
    return { VIBE64_VOICE_KEY: key };
  }, module, module.exports);
  const events = [];
  const props = vue.reactive({ preferences: {
    actorKey: "original-actor",
    colleague: { avatar: "colleague-artwork", voice: "kitten_jasper" },
    coding: { avatar: "coding-artwork", voice: "kitten_bella" }
  } });
  let voice;
  const renderer = vue.createRenderer({ createComment: () => ({}), createElement: () => ({}), createText: () => ({}),
    insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {}, parentNode: () => null, nextSibling: () => null });
  const app = renderer.createApp({ setup() {
    module.exports.default.setup(props, { expose() {}, emit: (...args) => events.push(args) });
    return () => vue.h({ setup() { voice = vue.inject(key); return () => null; } });
  } });
  app.mount({});
  t.after(() => app.unmount());
  let adapter = { composer: { draft: "original" } };
  let available = true;
  let presentation = "inline";
  const changes = [];
  const playback = [];
  const original = { preferenceTarget: "colleague", id: "retained-target", conversationId: "canonical-conversation",
    get adapter() { return adapter; }, get available() { return available; },
    get presentation() { return presentation; },
    get state() { return { status: available ? "ready" : "unavailable" }; },
    onReadAloudChange: value => changes.push(value), onPlayback: event => playback.push(event) };
  await voice.open(original);
  const binding = controller.state.binding;
  assert.equal(binding.id, original.id);
  assert.equal(binding.conversationId, original.conversationId);
  assert.equal(binding.defaults.readAloud, false);
  assert.equal(binding.avatar, "colleague-artwork", "the Colleague binding uses its personal artwork");
  assert.equal(binding.defaults.voiceId, "kitten_jasper");
  assert.equal(binding.presentation, "inline");
  assert.deepEqual(events, [], "default hydration emits no preference or playback event");
  adapter = { composer: { draft: "updated" } };
  assert.equal(binding.adapter, adapter);
  presentation = "dialog";
  assert.equal(binding.presentation, "dialog", "an unmounted inline view returns to the retained dialog target");
  available = false;
  assert.equal(binding.available, false);
  assert.equal(binding.state.status, "unavailable");
  props.preferences = {
    actorKey: "successor-actor",
    colleague: { readAloud: true, voice: "current", avatar: "colleague-artwork" },
    coding: { avatar: "coding-artwork", voice: "kitten_bella" }
  };
  assert.equal(binding.defaults.readAloud, true);
  assert.equal(binding.defaults.voiceId, "");
  assert.deepEqual(changes, []);
  binding.onReadAloudChange(false);
  const event = { conversationId: "canonical-conversation", outputId: "canonical-output", phase: "completed" };
  binding.onPlayback(event);
  assert.deepEqual(changes, [false]);
  assert.equal(playback[0], event);
  assert.deepEqual(events, [["read-aloud-change", false, { target: "colleague", actorKey: "original-actor" }], ["playback", event]]);
  await voice.open({ ...original, preferenceTarget: "coding", id: "coding-target", conversationId: "coding-conversation" });
  assert.equal(controller.state.binding.avatar, "coding-artwork");
  assert.equal(controller.state.binding.defaults.voiceId, "kitten_bella");
  assert.equal(controller.state.binding.defaults.readAloud, false, "Colleague's sound choice is not borrowed by coding");
  assert.equal(binding.avatar, "colleague-artwork", "retained bindings continue reading their own profile");
  assert.equal(binding.narration, undefined, "Colleague has no opt-in Main narrator");
  let turns = [{ turnId: "main-turn", messages: [] }];
  let loading = false;
  let eligible = true;
  const main = { ...original, preferenceTarget: "coding", id: "main-target", defaults: { readAloud: true },
    get narration() { return { turns, loading, working: true, eligible,
      vocalizeThinking: false, vocalizeInterimTurns: false, thinkingSounds: true }; } };
  assert.equal(voice.readAloudFor(main), true, "idle presentation reads the same original default as open");
  assert.equal(voice.readAloudChangePendingFor(main), false);
  await voice.open(main);
  const mainBinding = controller.state.binding;
  assert.equal(mainBinding.defaults.readAloud, true, "Main restores its original absent-choice default");
  assert.equal(mainBinding.narration.turns, turns);
  props.preferences.coding = { readAloud: false, vocalizeThinking: true, vocalizeInterimTurns: true, thinkingSounds: false, isSaving: true };
  assert.equal(mainBinding.defaults.readAloud, false, "an explicit saved choice wins over Main's default");
  assert.equal(voice.readAloudFor(main), false);
  assert.equal(voice.readAloudChangePendingFor(main), true);
  assert.equal(mainBinding.readAloudChangePending, true, "the shared toggle reads the same per-target pending-save fence");
  props.preferences.coding.isSaving = false;
  assert.equal(mainBinding.readAloudChangePending, false);
  assert.deepEqual(mainBinding.narration, { turns, loading: false, working: true, eligible: true,
    vocalizeThinking: true, vocalizeInterimTurns: true, thinkingSounds: false });
  turns = [{ turnId: "new-main-turn", messages: [] }];
  loading = true;
  eligible = false;
  assert.equal(mainBinding.narration.turns, turns);
  assert.equal(mainBinding.narration.loading, true);
  assert.equal(mainBinding.narration.eligible, false);
  assert.equal(events.length, 2, "remote preference and narrator hydration write no echo");
  mainBinding.onReadAloudChange(true);
  assert.deepEqual(events.at(-1), ["read-aloud-change", true, { target: "coding", actorKey: "successor-actor" }]);
  assert.deepEqual(changes, [false, true], "the binding's original callback is retained");
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
  await flush();
  assert.deepEqual(view.events, [["message-submit", "invitation"]]);
  const queued = view.state.sendMessage("A follow-up", { messageId: "other" });
  await flush();
  assert.equal(view.events.length, 1, "locally queued sends do not invite speech before dispatch");
  view.setConversation({ messages: [{ id: "invitation", role: "user", text: "Please speak again" }], status: "working" });
  admission.resolve({ status: "accepted", messageId: "invitation", turnId: "invitation" });
  await sending;
  await flush();
  assert.equal(view.state.voice.controller.state.binding.state.messages[0].id, "invitation");
  assert.equal(view.events.length, 1);
  view.setConversation({ messages: [{ id: "invitation", role: "user", text: "Please speak again" }], status: "ready" });
  view.publish({ type: "settled" });
  await queued;
  assert.deepEqual(view.events, [["message-submit", "invitation"], ["message-submit", "other"]]);
});

test("nonsteerable Colleague keeps typed and spoken follow-ups local until each real turn is ready", async t => {
  const authored = [];
  let view;
  view = mount(t, async (url, options) => {
    if (!url.endsWith("/messages")) return { messages: [], status: "working", capabilities: { steering: false } };
    const input = structuredClone(options.body);
    authored.push(input);
    view.setConversation({ messages: authored.map(message => ({ id: message.messageId, role: "user", text: message.text })),
      status: "working", capabilities: { steering: false } });
    view.publish({ type: "accepted" });
    return { status: "accepted", messageId: input.messageId, turnId: input.messageId };
  });
  await flush();
  assert.equal(view.state.adapter.value.composer.submitLabel, "Send");
  assert.equal(view.state.adapter.value.composer.disabled, false);
  view.state.draft.value = "Typed while working";
  const typed = view.state.submit();
  const focus = { projectSlug: "captured-project" };
  const spoken = view.state.sendMessage("Spoken while working", { messageId: "spoken-follow-up", focus });
  focus.projectSlug = "later-project";
  await flush();
  const [typedEntry, spokenEntry] = view.state.conversation.runtime.value.delivery.state.messages;
  assert.equal(typedEntry.status, "pending");
  assert.equal(spokenEntry.status, "pending");
  assert.equal(authored.length, 0, "follow-ups make no HTTP message request while the real turn is working");
  assert.equal(view.state.draft.value, "Typed while working", "accepted-only draft clearing remains intact");
  assert.equal(view.state.adapter.value.composer.disabled, false);
  view.setConversation({ status: "ready", capabilities: { steering: false } });
  view.publish({ type: "settled" });
  await typed;
  await flush();
  assert.deepEqual(authored[0], { messageId: typedEntry.id, text: typedEntry.text,
    data: { clientId: authored[0].data.clientId, focus: {} } });
  assert.equal(authored.length, 1, "the spoken follower waits for the typed request's turn");
  view.setConversation({ messages: [{ id: typedEntry.id, role: "user", text: typedEntry.text }],
    status: "ready", capabilities: { steering: false } });
  view.publish({ type: "settled" });
  await spoken;
  assert.deepEqual(authored[1], { messageId: "spoken-follow-up", text: "Spoken while working",
    data: { clientId: authored[0].data.clientId, focus: { projectSlug: "captured-project" } } });
  assert.equal(view.requests.some(({ url }) => url.endsWith("/cancel")), false);
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
    capabilities: { steering: true, goals: false, attachments: false, ...response.capabilities }, pendingRequest: null, conversationLog,
    streaming: { revision: streamRevision, messages: live ? [{ ...live.assistant,
      turnId: live.turnId, origin: "user", status: "inProgress" }] : [] }
  };
}

function mount(t, request, props = vue.reactive({ name: "Colleague" }), viewer = null, sessionStorage = null, preview = null, gestureChannel = null, voiceHost = null, bodyChannel = null) {
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
  const display = { xs: vue.ref(false) };
  const voiceState = vue.shallowReactive({ binding: null, session: null, visible: false });
  const voice = voiceHost || {
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
      const composerBlocked = vue.ref(false);
      voiceState.session = {
        voice: { listening: vue.ref(false) }, microphoneMuted: vue.ref(true), readAloud: vue.ref(true),
        pendingTranscript: vue.ref(null), sending: vue.ref(false), canTakeTranscript: () => true,
        hasUnsentSpeech: composerBlocked, composerBlocked, avatarVisual: vue.ref({ state: "idle" }),
        startHeldRecording() { events.push(["voice-hold-start"]); },
        finishHeldRecording() { events.push(["voice-hold-end"]); },
        discardHeldRecording() { events.push(["voice-hold-cancel"]); },
        inviteSpeech() {},
        stopSpeech() { events.push(["voice-stop-speech"]); }
      };
      return true;
    }
  };
  const module = { exports: {} };
  const imports = {
    vue,
    vuetify: { useDisplay: () => display },
    "vuetify/components": { VNavigationDrawer: {} },
    "@local/vibe64-voice/client": { useVibe64Voice: () => voice },
    "@local/vibe64-training/client/presentation-cue": { useTrainingPresentationCue },
    "@local/vibe64-training/client/navigation": { createTrainingNavigation },
    "@local/vibe64-training/client/learner-gestures": { useTrainingLearnerGestures },
    "@jskit-ai/assistant-voice/client": { ConversationDialog: {}, VoiceConversationControls: {}, projectConversationVoiceState,
      useVoiceLauncher: launcherModule.exports.useVoiceLauncher },
    "@jskit-ai/assistant-runtime/client": { useAssistantConversation },
    "@jskit-ai/assistant-core/client": { createAssistantApi },
    "@jskit-ai/realtime/client/composables/useRealtimeEvent": realtimeComposables,
    "@mdi/js": mdi,
    "/src/lib/vibe64AssistantHost.js": { VIBE64_COLLEAGUE_LAUNCHER_KEY: Symbol("launcher"), VIBE64_ASSISTANT_VIEWER_KEY: Symbol("viewer"), VIBE64_COLLEAGUE_PREVIEW_KEY: Symbol("preview"), VIBE64_TRAINING_LEARNER_GESTURE_KEY: Symbol("learner-gesture"), VIBE64_COLLEAGUE_BODY_KEY: Symbol("body") },
    "@jskit-ai/shell-web/client/error": { useShellWebErrorRuntime: () => ({ report: notice => notices.push(notice) }) },
    "@jskit-ai/assistant-core/client/conversation": { AssistantConversationElement: {}, AssistantConversationStatus: {}, AssistantPromptInput: {}, AssistantTranscript: {} },
    "@jskit-ai/assistant-core/shared/conversation": { conversationTurnsFromMessages, mergeConversationLogPages, normalizeConversationLogPage },
    "/src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue": { default: {} }
  };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(imports, name), name);
    return imports[name];
  }, module, module.exports);
  const previousWindow = globalThis.window;
  const previousConfig = globalThis.__JSKIT_CLIENT_APP_CONFIG__;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, sessionStorage };
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
  if (viewer) app.provide(imports["/src/lib/vibe64AssistantHost.js"].VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  if (preview) app.provide(imports["/src/lib/vibe64AssistantHost.js"].VIBE64_COLLEAGUE_PREVIEW_KEY, preview);
  if (gestureChannel) app.provide(imports["/src/lib/vibe64AssistantHost.js"].VIBE64_TRAINING_LEARNER_GESTURE_KEY, gestureChannel);
  if (bodyChannel) app.provide(imports["/src/lib/vibe64AssistantHost.js"].VIBE64_COLLEAGUE_BODY_KEY, bodyChannel);
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

test("fresh confirmation leaves old voice and drafts intact until exact archive success and retries a lost response unchanged", async t => {
  let completeFresh;
  let current = "original";
  const view = mount(t, async (url, options) => {
    if (url.endsWith("/conversations/fresh")) return new Promise((resolve, reject) => { completeFresh = { resolve, reject, body: options.body }; });
    if (url.startsWith("/api/assistant/")) return conversationSnapshot({ conversationId: current });
    return { ok: true, conversationId: current, messages: [], status: "ready", watches: [{ watchId: "watch", status: "active" }] };
  });
  await flush();
  await view.state.openVoice();
  const { binding, session } = view.state.voice.controller.state;
  const runtime = view.state.conversation.runtime.value;
  const focus = { projectSlug: "tea", sessionId: "old-session" };
  await runtime.delivery.send({ message: "Original unknown words", request: { text: "Original unknown words", data: { clientId: "original-client", focus } } },
    { messageId: "unknown-a", deliver: async () => ({ ok: false, status: "uncertain", error: "Admission response was lost." }) });
  session.pendingTranscript.value = { messageId: "unknown-a", text: "Original unknown words", focus };
  view.state.draft.value = "Keep typed draft";
  view.state.showFreshConfirmation();
  view.state.closeFreshConfirmation();
  assert.equal(view.requests.some(request => request.url.endsWith("/conversations/fresh")), false, "Cancel cannot start the server operation");
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.state.draft.value, "Keep typed draft");
  view.state.showFreshConfirmation();
  const first = view.state.startFresh();
  await flush();
  assert.equal(view.state.voice.controller.state.session, session, "HTTP in flight is not archive acceptance");
  const originalBody = JSON.parse(JSON.stringify(completeFresh.body));
  assert.equal(originalBody.expectedConversationId, "original");
  assert.deepEqual(originalBody.unconfirmedMessages, [{ messageId: "unknown-a", text: "Original unknown words", clientId: "original-client", focus }]);
  assert.equal(view.state.adapter.value.composer.canSend, false);
  view.state.draft.value = "Latest editable typed draft";
  completeFresh.reject(new Error("Fresh response was lost."));
  assert.equal(await first, false);
  assert.match(view.state.freshError.value, /Nothing was resent/);
  assert.equal(view.state.product.value.conversationId, "original");
  assert.equal(view.state.voice.controller.state.binding, binding);
  assert.equal(runtime.delivery.find("unknown-a").status, "uncertain");
  const reads = view.requests.length;
  await view.state.refresh();
  assert.equal(view.requests.length, reads, "background refresh cannot silently retarget an unresolved fresh operation");
  // An exact canonical acceptance may arrive late. The original annotation body
  // remains stable; the server's history reader owns accepted-ID deduplication.
  view.setConversation({ conversationId: "original", messages: [{ id: "unknown-a", role: "user", text: "Original unknown words" }], status: "ready" });
  view.publish({ type: "accepted", turnId: "unknown-a", messageId: "unknown-a" });
  await flush();
  assert.equal(runtime.delivery.find("unknown-a")?.status === "uncertain", false, "the original runtime reconciles the canonical accepted receipt");
  session.pendingTranscript.value = null;
  const retry = view.state.startFresh();
  await flush();
  assert.deepEqual(completeFresh.body, originalBody);
  current = "latest-current";
  completeFresh.resolve({ ok: true, conversationId: current, status: "ready", watches: [{ watchId: "watch", status: "active" }],
    fresh: { operationId: originalBody.operationId, previousConversationId: "original", conversationId: "first-successor", duplicate: true } });
  assert.equal(await retry, true);
  assert.equal(view.state.product.value.conversationId, "latest-current", "a later server pointer must not reopen a historical receipt successor");
  assert.notEqual(view.state.voice.controller.state.session, session, "the retired session is not reused for the fresh conversation");
  assert.equal(view.state.voice.controller.state.binding.conversationId, "latest-current");
  assert.equal(view.state.voiceSession.value, view.state.voice.controller.state.session);
  assert.equal(view.state.draft.value, "Latest editable typed draft");
  assert.equal(view.state.freshOperation.value, null);
  assert.equal(view.state.watches.value[0].watchId, "watch");
  assert.equal(view.requests.some(({ options }) => options.method === "POST" && options.body?.text), false, "fresh recovery submits no AI message");
});

test("uncertain A does not trap newer known-unsent B: pause then its X reaches the fresh precondition without losing A", async t => {
  let current = "original";
  const view = mount(t, async (url, options) => {
    if (url.endsWith("/conversations/fresh")) {
      current = "new";
      return { ok: true, conversationId: current, fresh: { operationId: options.body.operationId, previousConversationId: "original", conversationId: current } };
    }
    if (url.startsWith("/api/assistant/")) return conversationSnapshot({ conversationId: current });
    return { ok: true, conversationId: current, messages: [], status: "ready" };
  });
  await flush();
  await view.state.openVoice();
  const { binding, session } = view.state.voice.controller.state;
  const runtime = view.state.conversation.runtime.value;
  await runtime.delivery.send({ message: "Unknown A", request: { text: "Unknown A", data: { clientId: "client-a", focus: { projectSlug: "a" } } } },
    { messageId: "unknown-a", deliver: async () => ({ ok: false, status: "uncertain" }) });
  session.pendingTranscript.value = { messageId: "unknown-a", text: "Unknown A" };
  session.capturing = vue.ref(true);
  session.microphoneMuted.value = false;
  binding.onTranscript({ id: "unsent-b", text: "Newer B" }, { canTake: true });
  session.takeTranscript = async id => {
    assert.equal(id, "unsent-b");
    assert.equal(session.microphoneMuted.value, true, "person explicitly pauses before using the original capture discard");
    session.capturing.value = false;
    binding.onTranscript({ id: "unknown-a", text: "Unknown A" }, { canTake: true });
    return true;
  };
  view.state.draft.value = "Keep typed words";
  const [a, b] = view.state.adapter.value.conversation.previewMessages;
  assert.equal(a.actions.canDiscard, false);
  assert.equal(a.actions.canSend, false);
  assert.equal(b.actions.canDiscard, true);
  assert.equal(b.actions.canEdit, false, "pending A owns the existing edit slot");
  assert.equal(await view.state.startFresh(), false);
  assert.equal(view.requests.some(request => request.url.endsWith("/conversations/fresh")), false);
  session.microphoneMuted.value = true;
  assert.equal(await b.actions.discard("unsent-b"), true);
  assert.equal(session.pendingTranscript.value.messageId, "unknown-a");
  assert.equal(runtime.delivery.find("unknown-a").status, "uncertain");
  assert.equal(view.state.freshBlocked.value, "");
  assert.equal(await view.state.startFresh(), true);
  const fresh = view.requests.find(request => request.url.endsWith("/conversations/fresh"));
  assert.deepEqual(fresh.options.body.unconfirmedMessages.map(message => message.messageId), ["unknown-a"], "known unsent B is never silently archived as uncertain");
  assert.equal(view.state.draft.value, "Keep typed words");
});

for (const changedScope of ["actor", "conversation", "voice"]) {
  test(`fresh completion cannot retire or copy a draft into a changed ${changedScope} scope`, async t => {
    const viewer = vue.ref({ actorKey: "person-a" });
    let finish;
    const view = mount(t, async (url, options) => {
      if (url.endsWith("/conversations/fresh")) return new Promise(resolve => { finish = () => resolve({ ok: true, conversationId: "fresh-a",
        fresh: { operationId: options.body.operationId, previousConversationId: "original", conversationId: "fresh-a" } }); });
      if (url.startsWith("/api/assistant/")) return conversationSnapshot({ conversationId: "other" });
      return { ok: true, conversationId: viewer.value.actorKey === "person-a" ? "original" : "other", messages: [], status: "ready" };
    }, vue.reactive({ name: "Colleague" }), viewer);
    await flush();
    await view.state.openVoice();
    const originalSession = view.state.voice.controller.state.session;
    view.state.draft.value = "Person A's draft";
    const pending = view.state.startFresh();
    await flush();
    if (changedScope === "actor") {
      viewer.value = { actorKey: "person-b" };
      await flush();
    } else if (changedScope === "conversation") {
      view.state.product.value = { conversationId: "other" };
      await flush();
    } else {
      view.state.voice.controller.state.session = { hasUnsentSpeech: vue.ref(true) };
      view.state.voice.controller.state.binding = { id: "unrelated-main", presentation: "inline" };
    }
    const currentSession = view.state.voice.controller.state.session;
    if (changedScope !== "voice") view.state.draft.value = "New scope's own draft";
    finish();
    assert.equal(await pending, false);
    assert.equal(view.state.voice.controller.state.session, currentSession);
    assert.equal(view.state.product.value.conversationId, changedScope === "voice" ? "original" : "other");
    assert.equal(view.state.draft.value, changedScope === "voice" ? "Person A's draft" : "New scope's own draft");
    assert.equal(originalSession.pendingTranscript.value, null);
  });
}

test("speech starting during held fresh admission remains recoverable and the same operation can finish after explicit resolution", async t => {
  let complete;
  let current = "original";
  const view = mount(t, async (url, options) => {
    if (url.endsWith("/conversations/fresh")) return new Promise(resolve => { complete = () => resolve({ ok: true, conversationId: "fresh",
      fresh: { operationId: options.body.operationId, previousConversationId: "original", conversationId: "fresh", duplicate: true } }); });
    if (url.startsWith("/api/assistant/")) return conversationSnapshot({ conversationId: current });
    return { ok: true, conversationId: current, messages: [], status: "ready" };
  });
  await flush();
  await view.state.openVoice();
  const { binding, session } = view.state.voice.controller.state;
  session.capturing = vue.ref(false);
  const first = view.state.startFresh();
  await flush();
  const operationId = view.state.freshOperation.value.body.operationId;
  session.capturing.value = true;
  binding.onTranscript({ id: "new-b", text: "Preserve these newer words" }, { canTake: true });
  complete();
  assert.equal(await first, false);
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.state.voiceTranscript.value.text, "Preserve these newer words");
  assert.equal(view.state.product.value.conversationId, "original");
  // Explicit Stop voice resolves capture through the existing owner. The
  // original HTTP operation is checked again; no speech is automatically sent.
  await view.state.closeText();
  const retry = view.state.startFresh();
  await flush();
  assert.equal(view.state.freshOperation.value.body.operationId, operationId);
  current = "fresh";
  complete();
  assert.equal(await retry, true);
  assert.equal(view.requests.filter(request => request.url.endsWith("/messages")).length, 0);
});

test("previous conversations use read-only original cursor pages and never open a runtime or expose delivery actions", async t => {
  const view = mount(t, async url => {
    if (url.includes("/history/page")) {
      const older = url.includes("beforeTurnId=filtered-cursor");
      return { ok: true, id: "archived", readOnly: true,
        conversationLog: older ? [{ turnId: "old", user: { role: "user", messageId: "accepted", text: "Saved words" }, messages: [{ role: "user", messageId: "accepted", text: "Saved words" }] }] : [],
        pagination: { hasMoreBefore: !older, nextBeforeTurnId: older ? "" : "filtered-cursor" },
        unconfirmedMessages: [{ messageId: "unknown", text: "Reported unknown words", clientId: "old-client", source: "client-reported", status: "unconfirmed" }],
        unconfirmedDelivery: { messageId: "unknown", status: "unconfirmed" } };
    }
    if (url.includes("/history?")) return { ok: true, conversations: [{ conversationId: "archived", archivedAt: "2026-10-06T00:00:00Z", unconfirmedCount: 1 }], nextOffset: 20, hasMore: !url.includes("offset=20") };
    return { ok: true, conversationId: "current", messages: [], status: "ready" };
  });
  await flush();
  view.state.draft.value = "Current draft";
  const runtime = view.state.conversation.runtime.value;
  const subscriptionIds = [...view.subscriptions.keys()];
  await view.state.loadHistory();
  await view.state.loadHistory({ more: true });
  assert.ok(view.requests.some(request => request.url.includes("history?offset=20")));
  await view.state.readHistoryPage("archived");
  assert.equal(view.state.historyTurns.value.length, 0);
  assert.equal(view.state.historyPagination.value.nextBeforeTurnId, "filtered-cursor", "filtered internal-only page retains original paging cursor");
  await view.state.readHistoryPage("archived", { more: true });
  assert.ok(view.requests.some(request => request.url.includes("beforeTurnId=filtered-cursor")));
  assert.equal(view.state.historyTurns.value[0].user.text, "Saved words");
  assert.equal(view.state.historyUnconfirmed.value[0].status, "unconfirmed");
  assert.equal(view.state.conversation.runtime.value, runtime);
  assert.deepEqual([...view.subscriptions.keys()], subscriptionIds);
  assert.equal(view.state.voice.controller.state.session, null);
  assert.equal(view.state.draft.value, "Current draft");
  assert.equal(view.requests.some(({ options }) => options.method === "POST"), false);
  const historyTemplate = descriptor.template.content.split('<ConversationDialog :model-value="historyOpen"')[1];
  assert.ok(historyTemplate.includes("<AssistantTranscript"));
  assert.equal(/AssistantPromptInput|VoiceConversation|@check-delivery|@retry|@send|modelMenu/.test(historyTemplate), false);
  view.state.closeHistory();
  assert.equal(view.state.historyTurns.value.length, 0);
  assert.equal(view.state.historyUnconfirmed.value.length, 0);
});

test("late archived history cannot leak into a changed actor or closed dialog", async t => {
  const viewer = vue.ref({ actorKey: "person-a" });
  let finish;
  const view = mount(t, async url => {
    if (url.includes("/history?")) return new Promise(resolve => { finish = resolve; });
    return { ok: true, conversationId: viewer.value.actorKey, messages: [], status: "ready" };
  }, vue.reactive({ name: "Colleague" }), viewer);
  await flush();
  const read = view.state.loadHistory();
  await flush();
  viewer.value = { actorKey: "person-b" };
  await flush();
  finish({ ok: true, conversations: [{ conversationId: "private-a" }], hasMore: false });
  await read;
  assert.equal(view.state.historyOpen.value, false);
  assert.deepEqual(view.state.historyConversations.value, []);
  const closedRead = view.state.loadHistory();
  await flush();
  view.state.closeHistory();
  finish({ ok: true, conversations: [{ conversationId: "private-b" }], hasMore: false });
  await closedRead;
  assert.deepEqual(view.state.historyConversations.value, []);
});

test("a mismatched fresh receipt cannot end voice or publish a new conversation", async t => {
  const view = mount(t, async (url, options) => {
    if (url.endsWith("/conversations/fresh")) return { ok: true, conversationId: "wrong", fresh: {
      operationId: "different-operation", previousConversationId: options.body.expectedConversationId, conversationId: "wrong" } };
    return { ok: true, conversationId: "original", messages: [], status: "ready" };
  });
  await flush();
  await view.state.openVoice();
  const session = view.state.voice.controller.state.session;
  view.state.draft.value = "Still mine";
  assert.equal(await view.state.startFresh(), false);
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.state.product.value.conversationId, "original");
  assert.equal(view.state.draft.value, "Still mine");
  assert.match(view.state.freshError.value, /receipt did not match/);
  assert.ok(view.state.freshOperation.value.body.operationId);
});

test("a product refresh already in flight cannot retarget the binding during a held fresh operation", async t => {
  let holdRead = false;
  let finishRead;
  let finishFresh;
  const view = mount(t, async (url, options) => {
    if (url.endsWith("/conversations/fresh")) return new Promise(resolve => { finishFresh = () => resolve({ ok: true, conversationId: "fresh",
      fresh: { operationId: options.body.operationId, previousConversationId: "original", conversationId: "fresh" } }); });
    if (url.startsWith("/api/vibe64/colleague?")) {
      if (holdRead) return new Promise(resolve => { finishRead = resolve; });
      return { ok: true, conversationId: "original", messages: [], status: "ready" };
    }
    return conversationSnapshot({ conversationId: "fresh" });
  });
  await flush();
  await view.state.openVoice();
  const runtime = view.state.conversation.runtime.value;
  const session = view.state.voice.controller.state.session;
  view.state.draft.value = "Preserve while waiting";
  holdRead = true;
  const staleRead = view.state.refresh();
  await flush();
  const fresh = view.state.startFresh();
  await flush();
  finishRead({ ok: true, conversationId: "fresh", status: "ready" });
  await staleRead;
  assert.equal(view.state.product.value.conversationId, "original");
  assert.equal(view.state.conversation.runtime.value, runtime);
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.state.draft.value, "Preserve while waiting");
  assert.equal(view.state.freshOperation.value.body.expectedConversationId, "original");
  finishFresh();
  assert.equal(await fresh, true);
  assert.equal(view.state.product.value.conversationId, "fresh");
  assert.equal(view.state.draft.value, "Preserve while waiting");
  assert.equal(view.state.freshOperation.value, null);
});

test("another tab's held product refresh retains old recognized words and requires explicit resolved retarget with the same actor draft", async t => {
  let current = "original";
  let holdRead = false;
  let finishRead;
  const view = mount(t, async url => {
    if (url.startsWith("/api/vibe64/colleague?")) {
      if (holdRead) return new Promise(resolve => { finishRead = resolve; });
      return { ok: true, conversationId: current, messages: [], status: "ready" };
    }
    return conversationSnapshot({ conversationId: current });
  });
  await flush();
  await view.state.openVoice();
  const { binding, session } = view.state.voice.controller.state;
  const original = view.state.conversation.runtime.value;
  session.hasUnsentSpeech.value = true;
  binding.onTranscript({ id: "old-recognized-b", text: "Keep these original words" }, { canTake: true });
  view.state.draft.value = "Keep same-person typed draft";
  holdRead = true;
  const read = view.state.refresh();
  await flush();
  current = "other-tab-current";
  finishRead({ ok: true, conversationId: current, status: "ready" });
  await read;
  assert.equal(view.state.product.value.conversationId, "original");
  assert.equal(view.state.conversation.runtime.value, original);
  assert.equal(view.state.voiceSession.value, session);
  assert.equal(view.state.voiceTranscript.value.text, "Keep these original words");
  assert.equal(binding.available, true, "retarget guard does not invent or override runtime availability");
  assert.match(view.state.pointerNotice.value, /Resolve the old speech first/);
  const unresolved = view.state.refresh({ allowRetarget: true });
  await flush();
  finishRead({ ok: true, conversationId: current });
  await unresolved;
  assert.equal(view.state.product.value.conversationId, "original", "even an explicit refresh cannot discard retained unsent speech");
  assert.equal(await view.state.startFresh(), false, "a known external rotation is resolved by refresh, not a stale predecessor fresh request");
  assert.equal(view.requests.some(request => request.url.endsWith("/conversations/fresh")), false);
  // The person explicitly resolves the old voice owner. No new transport,
  // controller availability override or implicit speech transfer is involved.
  await view.state.closeText();
  view.state.voiceTranscript.value = null;
  view.state.draft.value = "Latest same-person draft while waiting";
  holdRead = false;
  await view.state.refresh();
  assert.equal(view.state.product.value.conversationId, "original", "after the notice, retarget still requires the explicit refresh control");
  await view.state.refresh({ allowRetarget: true });
  assert.equal(view.state.product.value.conversationId, "other-tab-current");
  assert.equal(view.state.draft.value, "Latest same-person draft while waiting");
  assert.equal(view.state.voice.controller.state.session, null);
  assert.equal(view.state.pointerNotice.value, "");
  assert.equal(view.requests.some(({ options }) => options.method === "POST"), false);
});

test("explicit external retarget retains the original uncertain UUID/payload in the original tab draft owner", async t => {
  const records = new Map();
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const viewer = vue.ref({ actorKey: "person-a" });
  let current = "original";
  const view = mount(t, async url => url.startsWith("/api/assistant/") ? conversationSnapshot({ conversationId: current })
    : { ok: true, conversationId: current, messages: [], status: "ready" }, vue.reactive({ name: "Colleague" }), viewer, storage);
  await flush();
  await view.state.openVoice();
  const runtime = view.state.conversation.runtime.value;
  const messageId = crypto.randomUUID();
  const payload = { message: "Unknown captured words", request: { text: "Unknown captured words", data: { clientId: "original-client", focus: { projectSlug: "original-project" } }, steer: true } };
  await runtime.delivery.send(payload, { messageId, deliver: async () => ({ ok: false, status: "uncertain" }) });
  view.state.draft.value = "Current unsent typed draft";
  view.state.voice.controller.state.session.pendingTranscript.value = { messageId, text: payload.message };
  view.state.voice.controller.state.session.hasUnsentSpeech.value = true;
  current = "latest";
  await view.state.refresh();
  assert.equal(view.state.product.value.conversationId, "original");
  assert.equal(runtime.delivery.find(messageId).status, "uncertain");
  await view.state.closeText();
  await view.state.refresh({ allowRetarget: true });
  assert.equal(view.state.product.value.conversationId, "latest");
  assert.equal(view.state.draft.value, "Current unsent typed draft");
  const previousKey = `vibe64:colleague-composer:v1:${JSON.stringify(["person-a", "original"])}`;
  const saved = JSON.parse(records.get(previousKey));
  assert.equal(saved.messages[0].id, messageId);
  assert.equal(saved.messages[0].status, "uncertain");
  assert.deepEqual(saved.messages[0].payload, payload);
  const currentKey = `vibe64:colleague-composer:v1:${JSON.stringify(["person-a", "latest"])}`;
  assert.deepEqual(JSON.parse(records.get(currentKey)).messages, [], "old uncertainty never moves into the new delivery owner");
  assert.equal(view.requests.some(({ options }) => options.method === "POST"), false);
});

test("Colleague reload restores the original uncertain tab record without resend and isolates it from another actor", async t => {
  const messageId = crypto.randomUUID();
  const payload = { message: "Retain original words", request: { text: "Retain original words", data: { clientId: "saved-client", focus: { projectSlug: "saved-project" } }, steer: true } };
  const key = `vibe64:colleague-composer:v1:${JSON.stringify(["person-a", "original"])}`;
  const records = new Map([[key, JSON.stringify({ draft: "Person A's typed draft", attachments: [], messages: [{ id: messageId,
    text: payload.message, status: "uncertain", payload, createdAtMs: 1 }] })]]);
  const storage = { getItem: id => records.get(id) ?? null, setItem: (id, value) => records.set(id, value), removeItem: id => records.delete(id) };
  const viewer = vue.ref({ actorKey: "person-a" });
  const view = mount(t, async () => ({ ok: true, conversationId: "original", messages: [], status: "ready" }),
    vue.reactive({ name: "Colleague" }), viewer, storage);
  await flush();
  assert.equal(view.state.draft.value, "Person A's typed draft");
  const restored = view.state.conversation.runtime.value.delivery.find(messageId);
  assert.equal(restored.id, messageId);
  assert.equal(restored.status, "uncertain");
  assert.deepEqual(restored.payload, payload);
  assert.equal(view.state.adapter.value.composer.canSend, false);
  assert.equal(view.requests.some(({ options }) => options.method === "POST"), false, "restoration is not resend");
  viewer.value = { actorKey: "person-b" };
  await flush();
  assert.equal(view.state.draft.value, "");
  assert.equal(view.state.conversation.runtime.value.delivery.find(messageId), null);
  assert.deepEqual(JSON.parse(records.get(key)).messages[0].payload, payload);
  viewer.value = { actorKey: "person-a" };
  await flush();
  assert.equal(view.state.draft.value, "Person A's typed draft");
  assert.equal(view.state.conversation.runtime.value.delivery.find(messageId).status, "uncertain");
  assert.equal(view.requests.some(({ options }) => options.method === "POST"), false);
});


test("an armed cue buffers only unclassified speech, then forwards actual final correlation/playback and one exact terminal receipt", async t => {
  const cue = vue.ref(null);
  const observed = [];
  const playback = [];
  const retired = [];
  const preview = vue.shallowRef({ presentation: {
    get state() { return { cue: cue.value && { ...cue.value } }; },
    observeCue(value, options) { observed.push({ value, options }); cue.value = { ...cue.value, ...value, phase: "awaiting-audio" }; return true; },
    playback(value) { playback.push(value); },
    retireCue(reason) { retired.push(reason); }
  } });
  const acknowledgements = [];
  const response = { conversationId: "conversation", messages: [{ id: "turn-user", role: "user", text: "Explain." }], status: "working", assistantSelection: {} };
  const viewer = vue.ref({ actorKey: "member" });
  const view = mount(t, async (url, options) => {
    if (url.endsWith("/navigation/ack")) { acknowledgements.push(options.body); return { ok: true }; }
    return structuredClone(response);
  }, vue.reactive({ name: "Colleague" }), viewer, null, preview);
  await flush();
  await view.state.openVoice();
  const binding = view.state.voice.controller.state.binding;
  const identity = { clientId: view.state.clientId, conversationId: "conversation", turnId: "turn-user",
    attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", visualId: "request", playerInstanceId: "player-one",
    cueId: "cue-one", commandId: "transition-one", navigationId: "navigation-one" };
  cue.value = { ...identity, phase: "armed", outputId: "", canonicalFinal: false };
  const stream = view.setConversation({ conversationId: "conversation", messages: response.messages,
    status: "working", streamingReply: { id: "prelude", outputId: "prelude", role: "assistant", text: "Let me check one thing.", status: "inProgress" } }, 1);
  view.publish({ type: "message", ...stream.streaming.messages[0], streaming: stream.streaming });
  await flush();
  assert.ok(view.state.adapter.value.conversation.turns.at(-1)?.assistant, JSON.stringify({
    stream, snapshot: view.state.conversation.runtime.value.snapshot.value, turns: view.state.adapter.value.conversation.turns
  }));
  assert.equal(view.state.adapter.value.conversation.turns.at(-1).assistant.text, "Let me check one thing.", "the original transcript still streams");
  assert.equal(binding.state.streamingReply, null, "only this armed cue's speech waits for actual classification");
  view.publish({ type: "message", turnId: "turn-user", messageId: "prelude", role: "commentary", status: "complete",
    text: "Let me check one thing.", streaming: { revision: 2, messages: [] } });
  await flush();
  assert.equal(observed.length, 0);
  const final = { ...identity, phase: "bound", outputId: "actual-final", canonicalFinal: true };
  response.messages.push({ id: "answer", role: "assistant", text: "The server receives your request." });
  response.status = "ready";
  const completed = view.setConversation(response, 3);
  view.publish({ type: "message", turnId: "turn-user", messageId: "answer", outputId: "actual-final", role: "assistant",
    status: "complete", text: "The server receives your request.", presentationCue: final,
    streaming: completed.streaming });
  view.publish({ type: "settled", turnId: "turn-user", status: "complete" });
  await flush();
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], { value: final, options: { readAloud: true } });
  assert.equal(binding.state.streamingReply?.text || binding.state.messages.at(-1).text, "The server receives your request.");
  const event = { conversationId: "conversation", outputId: "actual-final", phase: "started" };
  binding.onPlayback(event);
  assert.deepEqual(playback, [event]);
  cue.value = { ...identity, outputId: "actual-final", canonicalFinal: true, phase: "completed", audioPhase: "completed",
    visualPhase: "completed", state: "shown", description: "One request shown.", error: "" };
  await flush();
  assert.equal(acknowledgements.length, 1);
  assert.deepEqual(acknowledgements[0], { clientId: identity.clientId, commandId: "navigation-one", ok: true, cue: cue.value });
  cue.value = { ...cue.value };
  await flush();
  assert.equal(acknowledgements.length, 1, "reactive rereads do not repeat terminal delivery");
  viewer.value = { actorKey: "another-member" };
  await flush();
  assert.ok(retired.some(reason => reason.includes("learner changed")));
  assert.equal(acknowledgements.length, 1, "old-target cue facts never post under the new actor");
});

test("a mobile presentation open minimises the original Colleague frame without ending its voice session or draft", async t => {
  const calls = [];
  const view = mount(t, async (url, options) => {
    if (url.endsWith("/navigation/ack")) { calls.push(options.body); return { ok: true }; }
    return { conversationId: "conversation", messages: [], status: "ready", assistantSelection: {} };
  });
  await flush();
  view.state.xs.value = true;
  await view.state.openVoice();
  view.state.adapter.value.actions.setDraft("Keep my separate question.");
  const binding = view.state.voice.controller.state.binding;
  const session = view.state.voice.controller.state.session;
  view.state.props.navigate = async () => ({ focus: { projectSlug: "practice", sessionId: "session-1", pane: "preview" },
    presentation: { attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", visualId: "request", playerInstanceId: "player-one", phase: "ready" } });
  await view.state.handleNavigation({ id: "navigation-one", status: "pending", presentation: { operation: "open" } });
  assert.equal(view.state.shown.value, false);
  assert.equal(view.state.voice.controller.state.binding, binding);
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.state.draft.value, "Keep my separate question.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].presentation.phase, "ready");
});


test("deliberate diagram retirement stops only its still-audible output, never drawer minimise or a successor", async t => {
  const cue = vue.ref(null);
  const preview = vue.shallowRef({ presentation: {
    get state() { return { cue: cue.value && { ...cue.value } }; }, observeCue() {}, playback() {}, retireCue() {}
  } });
  const view = mount(t, async () => ({ ok: true, conversationId: "conversation", messages: [], status: "ready", assistantSelection: {} }),
    vue.reactive({ name: "Colleague" }), null, null, preview);
  await flush();
  await view.state.openVoice();
  const binding = view.state.voice.controller.state.binding;
  const identity = { conversationId: "conversation", clientId: view.state.clientId, outputId: "cue-output", audioPhase: "started", phase: "playing" };
  cue.value = { ...identity };
  binding.onPlayback({ conversationId: "conversation", outputId: "cue-output", phase: "started" });
  await view.state.toggleConversation();
  assert.equal(view.events.filter(event => event[0] === "voice-stop-speech").length, 0, "drawer minimise preserves ongoing voice");
  cue.value.phase = "interrupted";
  assert.equal(view.events.filter(event => event[0] === "voice-stop-speech").length, 1);
  cue.value = { ...identity };
  binding.onPlayback({ conversationId: "conversation", outputId: "cue-output", phase: "started" });
  binding.onPlayback({ conversationId: "conversation", outputId: "newer-output", phase: "started" });
  cue.value.phase = "interrupted";
  assert.equal(view.events.filter(event => event[0] === "voice-stop-speech").length, 1, "a newer audible output is not the retired cue");
  cue.value = { ...identity };
  binding.onPlayback({ conversationId: "conversation", outputId: "cue-output", phase: "started" });
  view.state.voice.controller.state.binding = { id: "main", conversationId: "other-conversation", socketUrl: "main" };
  cue.value.phase = "interrupted";
  assert.equal(view.events.filter(event => event[0] === "voice-stop-speech").length, 1, "another conversation owns voice now");
});

const authoredQuestion = { attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", questionId: "question-one", assessmentId: "help-or-change",
  issuedRevision: 3, topicHash: "a".repeat(64), lessonHash: "b".repeat(64) };

test("typed and spoken queued followers retain their authored question reference when a newer question becomes visible", async t => {
  const requests = [];
  const response = { messages: [], status: "working", capabilities: { steering: false }, trainingQuestion: structuredClone(authoredQuestion) };
  const view = mount(t, async (url, options) => {
    if (!url.endsWith("/messages")) return structuredClone(response);
    requests.push(structuredClone(options.body));
    view.setConversation({ messages: requests.map(message => ({ id: message.messageId, role: "user", text: message.text })),
      status: "working", capabilities: { steering: false } });
    view.publish({ type: "accepted" });
    return { status: "accepted", messageId: options.body.messageId, turnId: options.body.messageId };
  });
  await flush();
  view.state.props.focus = { projectSlug: "captured-project" };
  await view.state.openVoice();
  const { binding, session } = view.state.voice.controller.state;
  const captured = binding.captureContext();
  assert.deepEqual(captured, { projectSlug: "captured-project", trainingQuestion: authoredQuestion });
  view.state.draft.value = "Typed answer.";
  const typed = view.state.submit();
  const spoken = binding.submitText("Spoken answer.", { messageId: "spoken-question-answer", context: captured });
  await flush();
  const [a, b] = view.state.conversation.runtime.value.delivery.state.messages;
  assert.equal(requests.length, 0);
  assert.deepEqual(a.payload.request.data.trainingQuestion, authoredQuestion);
  assert.deepEqual(b.payload.request.data.trainingQuestion, authoredQuestion);
  response.trainingQuestion = { ...authoredQuestion, questionId: "question-two", issuedRevision: 8 };
  await view.state.refresh();
  assert.deepEqual(binding.captureContext().trainingQuestion, response.trainingQuestion, "the next utterance sees the newly issued question");
  captured.trainingQuestion.questionId = "incidental-context-mutation";
  view.state.props.focus.projectSlug = "later-project";
  view.setConversation({ status: "ready", capabilities: { steering: false } });
  view.publish({ type: "settled" });
  await typed;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messageId, a.id);
  assert.deepEqual(requests[0].data.trainingQuestion, authoredQuestion);
  view.setConversation({ messages: [{ id: a.id, role: "user", text: a.text }], status: "ready", capabilities: { steering: false } });
  view.publish({ type: "settled" });
  await spoken;
  assert.equal(requests[1].messageId, "spoken-question-answer");
  assert.equal(requests[1].text, "Spoken answer.");
  assert.deepEqual(requests[1].data, { clientId: view.state.clientId, focus: { projectSlug: "captured-project" }, trainingQuestion: authoredQuestion });
  assert.equal(view.state.voice.controller.state.binding, binding);
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.requests.some(({ url }) => url.endsWith("/cancel")), false);
});

test("speech authored before issuance remains unassociated and a definite failed retry keeps its original reference", async t => {
  let reference = null;
  const submitted = [];
  const view = mount(t, async (url, options) => {
    if (!url.endsWith("/messages")) return { messages: [], status: "ready", trainingQuestion: reference };
    submitted.push(structuredClone(options.body));
    if (submitted.length === 1) throw Object.assign(new Error("Known pre-admission rejection."), { code: "ACTION_VALIDATION_FAILED" });
    return { status: "accepted", messageId: options.body.messageId, turnId: options.body.messageId };
  });
  await flush();
  await view.state.openVoice();
  const binding = view.state.voice.controller.state.binding;
  const earlier = binding.captureContext();
  reference = structuredClone(authoredQuestion);
  await view.state.refresh();
  assert.equal((await binding.submitText("Earlier words.", { messageId: "before-question", context: earlier })).ok, false);
  assert.equal(submitted[0].data.trainingQuestion, undefined, "submission never substitutes the newly visible question");
  const captured = binding.captureContext();
  await binding.submitText("Answer words.", { messageId: "question-answer", context: captured });
  assert.deepEqual(submitted[1].data.trainingQuestion, authoredQuestion);
  reference = { ...authoredQuestion, questionId: "question-two", issuedRevision: 9 };
  await view.state.refresh();
  await binding.submitText("Earlier words.", { messageId: "before-question", context: binding.captureContext() });
  assert.equal(submitted[2].messageId, "before-question");
  assert.equal(submitted[2].data.trainingQuestion, undefined, "same authored UUID retry uses the original payload, not a later capture");
});

test("changing learner retires a queued question-bearing draft without dispatch or carrying the reference to the new actor", async t => {
  const viewer = vue.ref({ actorKey: "person-a" });
  const view = mount(t, async () => ({ messages: [], status: "working", capabilities: { steering: false }, trainingQuestion: authoredQuestion }),
    vue.reactive({ name: "Colleague" }), viewer);
  await flush();
  view.state.draft.value = "Only person A's answer.";
  const sending = view.state.submit();
  await flush();
  const original = view.state.conversation.runtime.value;
  const pending = original.delivery.state.messages[0];
  assert.deepEqual(pending.payload.request.data.trainingQuestion, authoredQuestion);
  viewer.value = { actorKey: "person-b" };
  await flush();
  await sending;
  assert.notEqual(view.state.conversation.runtime.value, original);
  assert.equal(view.state.draft.value, "");
  assert.equal(view.state.conversation.runtime.value.delivery.state.messages.length, 0);
  assert.equal(view.requests.some(({ options }) => options.method === "POST"), false);
});


// Unit fixtures exercise the native owner contract; real isTrusted event
// forwarding is separately proved by the original mounted browser test.
const nativeClick = { type: "click", isTrusted: true };
const workspaceQuestion = { ...authoredQuestion, assessmentId: "workspace-navigation" };
const nativeWorkspace = { projectSlug: "practice", sessionId: "practice-session", mainChatVisible: true,
  projectVisible: true, pane: "preview", ready: true };

test("native lesson controls retain one exact delivered question across three settled steps without changing drafts or voice", async t => {
  const channel = vue.shallowRef(null);
  const observations = [];
  const settled = [];
  const props = vue.reactive({ name: "Colleague", settleWorkspace: async (target, current) => {
    assert.equal(current(), true);
    settled.push(target);
    return { ...nativeWorkspace };
  } });
  const view = mount(t, async (url, options) => {
    if (!url.endsWith("/training/observations")) return { messages: [], status: "ready", trainingQuestion: workspaceQuestion };
    observations.push(structuredClone(options.body));
    return { ok: true, gestureId: options.body.gestureId, assessmentId: workspaceQuestion.assessmentId,
      phase: observations.length === 3 ? "completed" : "collecting", acceptedSteps: observations.length };
  }, props, vue.ref({ actorKey: "member" }), null, null, channel);
  await flush();
  props.focus = { projectSlug: "practice", sessionId: "practice-session" };
  view.state.draft.value = "My ordinary typed draft stays here.";
  await view.state.openVoice();
  const session = view.state.voice.controller.state.session;
  const binding = view.state.voice.controller.state.binding;
  await view.state.toggleConversation(nativeClick);
  await flush();
  assert.equal(view.state.bodyVisible.value, false);
  await view.state.toggleConversation(nativeClick);
  await flush();
  assert.equal(view.state.bodyVisible.value, true);
  assert.deepEqual(settled, [], "ordinary lesson launcher visibility is not a workspace assessment step");
  assert.deepEqual(observations, [], "trusted hide/show allocates no observation request for this question");
  assert.deepEqual(view.notices, [], "normal launcher use never reports a false practical failure");
  assert.equal(view.state.draft.value, "My ordinary typed draft stays here.");
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.state.voice.controller.state.binding, binding);
  for (const [control, target] of [["project-select", { projectSlug: "practice" }],
    ["session-select", { sessionId: "practice-session" }], ["preview-select", {}]]) {
    const ticket = channel.value.begin(nativeClick, control, target);
    assert.ok(ticket);
    assert.equal(Object.isFrozen(ticket.reference), true);
    assert.equal(Object.isFrozen(ticket.target), true);
    const result = await channel.value.finish(ticket);
    assert.equal(result.gestureId, ticket.gestureId);
    assert.equal(await channel.value.finish(ticket), false, "a consumed native ticket cannot send twice");
  }
  assert.deepEqual(settled.map(step => step.control), ["project-select", "session-select", "preview-select"]);
  assert.equal(new Set(observations.map(step => step.gestureId)).size, 3);
  for (const body of observations) {
    assert.deepEqual(Object.keys(body).sort(), ["clientId", "control", "conversationId", "gestureId", "reference", "workspace"]);
    assert.deepEqual(body.reference, workspaceQuestion);
    assert.equal(body.conversationId, view.state.product.value.conversationId);
    assert.deepEqual(body.workspace, { ...nativeWorkspace, colleagueVisible: true });
    assert.equal(body.clientId, view.state.clientId);
  }
  assert.equal(view.state.draft.value, "My ordinary typed draft stays here.");
  assert.equal(view.state.voice.controller.state.session, session);
  assert.equal(view.state.voice.controller.state.binding, binding);
});

test("native observations reject synthetic and programmatic controls and never treat another assistant's visible frame as Colleague", async t => {
  const channel = vue.shallowRef(null);
  const question = { ...workspaceQuestion, assessmentId: "return-to-colleague" };
  const props = vue.reactive({ name: "Colleague", settleWorkspace: async () => ({ ...nativeWorkspace }) });
  const view = mount(t, async () => ({ messages: [], status: "ready", trainingQuestion: question }),
    props, null, null, null, channel);
  await flush();
  props.focus = { projectSlug: "practice", sessionId: "practice-session" };
  for (const event of [undefined, { type: "click", isTrusted: false }, { type: "pointerdown", isTrusted: true }]) {
    assert.equal(channel.value.begin(event, "project-select"), null);
  }
  assert.equal(channel.value.begin(nativeClick, "teacher-navigation"), null);
  await view.state.toggleConversation();
  await view.state.toggleConversation();
  assert.equal(view.requests.some(request => request.url.endsWith("/training/observations")), false);
  assert.equal(view.state.product.value.trainingQuestion.assessmentId, "return-to-colleague",
    "body-ownership refusal is tested with an assessment that admits visibility gestures");
  const controller = view.state.voice.controller;
  controller.state.binding = { socketUrl: "/another-assistant/voice/ws", presentation: "dialog", conversationId: "another" };
  controller.state.visible = true;
  assert.equal(view.state.shown.value, true);
  assert.equal(view.state.bodyVisible.value, false);
  assert.equal(channel.value.begin(nativeClick, "colleague-minimize"), null);
  assert.equal(view.requests.some(request => request.url.endsWith("/training/observations")), false);
});

test("original Colleague minimize and restore observations use the actual body and keep the same voice session", async t => {
  const channel = vue.shallowRef(null);
  const observations = [];
  const question = { ...workspaceQuestion, assessmentId: "return-to-colleague" };
  const props = vue.reactive({ name: "Colleague", settleWorkspace: async () => ({ ...nativeWorkspace }) });
  const view = mount(t, async (url, options) => {
    if (!url.endsWith("/training/observations")) return { messages: [], status: "ready", trainingQuestion: question };
    observations.push(structuredClone(options.body));
    return { ok: true, gestureId: options.body.gestureId, assessmentId: question.assessmentId,
      phase: "collecting", acceptedSteps: 1 };
  }, props, null, null, null, channel);
  await flush();
  props.focus = { projectSlug: "practice", sessionId: "practice-session" };
  await view.state.openVoice();
  const session = view.state.voice.controller.state.session;
  await view.state.toggleConversation(nativeClick);
  await flush();
  assert.equal(view.state.bodyVisible.value, false);
  const use = channel.value.begin(nativeClick, "preview-select");
  await channel.value.finish(use);
  await view.state.toggleConversation(nativeClick);
  await flush();
  assert.equal(view.state.bodyVisible.value, true);
  assert.deepEqual(observations.map(body => [body.control, body.workspace.colleagueVisible]),
    [["colleague-minimize", false], ["preview-select", false], ["colleague-restore", true]]);
  assert.equal(view.state.voice.controller.state.session, session);
  assert.ok(observations.every(body => JSON.stringify(body.reference) === JSON.stringify(question)));
});

test("changed native question, actor or conversation fences a held workspace observation before HTTP", async t => {
  const viewer = vue.ref({ actorKey: "member-a" });
  const channel = vue.shallowRef(null);
  let reference = workspaceQuestion;
  let resolveWorkspace;
  const props = vue.reactive({ name: "Colleague", settleWorkspace: () => new Promise(resolve => { resolveWorkspace = resolve; }) });
  const view = mount(t, async () => ({ conversationId: "colleague-native", messages: [], status: "ready", trainingQuestion: reference }),
    props, viewer, null, null, channel);
  await flush();
  props.focus = { projectSlug: "practice", sessionId: "practice-session" };
  for (const change of [async () => { reference = { ...reference, issuedRevision: reference.issuedRevision + 1 }; await view.state.refresh(); },
    async () => { viewer.value = { actorKey: "member-b" }; await flush(); },
    async () => { view.state.product.value = { ...view.state.product.value, conversationId: "other-current" }; }]) {
    const ticket = channel.value.begin(nativeClick, "preview-select");
    assert.ok(ticket);
    const pending = channel.value.finish(ticket);
    await change();
    resolveWorkspace({ ...nativeWorkspace });
    assert.equal(await pending, false);
  }
  assert.equal(view.requests.some(request => request.url.endsWith("/training/observations")), false);
  assert.deepEqual(view.notices, []);
});

test("failed lesson observation leaves the successful workspace action and typed draft alone, with bounded transient tickets", async t => {
  const channel = vue.shallowRef(null);
  const props = vue.reactive({ name: "Colleague", settleWorkspace: async () => ({ ...nativeWorkspace }) });
  const view = mount(t, async (url) => {
    if (url.endsWith("/training/observations")) throw new Error("Connection lost.");
    return { messages: [], status: "ready", trainingQuestion: workspaceQuestion };
  }, props, null, null, null, channel);
  await flush();
  props.focus = { projectSlug: "practice", sessionId: "practice-session" };
  view.state.draft.value = "Do not submit or discard this.";
  const tickets = Array.from({ length: 8 }, () => channel.value.begin(nativeClick, "project-select"));
  assert.ok(tickets.every(Boolean));
  assert.equal(channel.value.begin(nativeClick, "project-select"), null);
  assert.equal(await channel.value.finish(tickets[0]), false);
  assert.equal(view.state.draft.value, "Do not submit or discard this.");
  assert.match(view.notices.at(-1).message, /observation was not confirmed.*workspace action was not undone/u);
  assert.ok(channel.value.begin(nativeClick, "project-select"), "finishing releases only its own slot");
});


const exerciseQuestion = { ...authoredQuestion, assessmentId: "try-the-application" };
const exerciseFrame = { projectSlug: "practice", sessionId: "practice-session", frameRequestId: 7,
  instanceId: "11111111-1111-4111-8111-111111111111", interactionId: "22222222-2222-4222-8222-222222222222",
  playerInstanceId: "33333333-3333-4333-8333-333333333333" };
const exerciseResponse = { requestId: "44444444-4444-4444-8444-444444444444" };

test("exercise channel captures the delivered practical and sends only exact verified-frame identities", async t => {
  const channel = vue.shallowRef(null);
  const observations = [];
  const props = vue.reactive({ name: "Colleague", settleWorkspace: async (target, current) => {
    assert.equal(current(), true);
    assert.deepEqual(target, { projectSlug: "practice", sessionId: "practice-session", control: "exercise-response" });
    return { ...nativeWorkspace };
  } });
  const view = mount(t, async (url, options) => {
    if (!url.endsWith("/training/observations")) return { messages: [], status: "ready", trainingQuestion: exerciseQuestion };
    observations.push(structuredClone(options.body));
    return { ok: true, gestureId: options.body.gestureId, assessmentId: "try-the-application", phase: "completed", acceptedSteps: 1 };
  }, props, vue.ref({ actorKey: "member" }), null, null, channel);
  await flush();
  props.focus = { projectSlug: "practice", sessionId: "practice-session", pane: "preview" };
  view.state.draft.value = "My explanation is not silently submitted.";
  assert.equal(channel.value.begin(nativeClick, "preview-select"), null, "workspace controls cannot substitute for the application practical");
  const ticket = channel.value.beginExercise(exerciseFrame, () => true);
  assert.ok(ticket);
  assert.equal(Object.isFrozen(ticket.exercise), true);
  const result = await channel.value.finishExercise(ticket, exerciseResponse);
  assert.equal(result.phase, "completed");
  assert.deepEqual(observations, [{ clientId: view.state.clientId, conversationId: view.state.product.value.conversationId,
    gestureId: ticket.gestureId, control: "exercise-response", reference: exerciseQuestion,
    workspace: { ...nativeWorkspace, colleagueVisible: false },
    exercise: { instanceId: exerciseFrame.instanceId, interactionId: exerciseFrame.interactionId,
      playerInstanceId: exerciseFrame.playerInstanceId, frameRequestId: 7, requestId: exerciseResponse.requestId } }]);
  assert.equal(await channel.value.finishExercise(ticket, exerciseResponse), false, "same UI ticket cannot execute another check");
  assert.equal(view.state.draft.value, "My explanation is not silently submitted.");
});

test("retiring hidden App, changed frame, or full-screen Colleague permanently fences that unfinished exercise ticket", async t => {
  const channel = vue.shallowRef(null);
  const props = vue.reactive({ name: "Colleague", settleWorkspace: async () => ({ ...nativeWorkspace }) });
  const view = mount(t, async () => ({ messages: [], status: "ready", trainingQuestion: exerciseQuestion }),
    props, null, null, null, channel);
  await flush();
  props.focus = { projectSlug: "practice", sessionId: "practice-session", pane: "preview" };
  let frameVisible = true;
  const retired = channel.value.beginExercise(exerciseFrame, () => frameVisible);
  frameVisible = false;
  assert.equal(await channel.value.finishExercise(retired), false);
  frameVisible = true;
  assert.equal(await channel.value.finishExercise(retired, exerciseResponse), false);
  const hidden = channel.value.beginExercise(exerciseFrame, () => true);
  props.focus = { ...props.focus, pane: "chat" };
  props.focus = { ...props.focus, pane: "preview" };
  assert.equal(await channel.value.finishExercise(hidden, exerciseResponse), false);
  await view.state.openVoice();
  view.state.xs.value = true;
  assert.equal(view.state.bodyVisible.value, true);
  assert.equal(channel.value.beginExercise(exerciseFrame, () => true), null, "phone Colleague covers the actual App");
  await view.state.toggleConversation();
  const minimized = channel.value.beginExercise(exerciseFrame, () => true);
  assert.ok(minimized);
  await channel.value.finishExercise(minimized);
  assert.equal(channel.value.beginExercise({ ...exerciseFrame, sessionId: "foreign" }, () => true), null);
  assert.equal(view.requests.some(request => request.url.endsWith("/training/observations")), false);
});

test("exercise observation cannot outlive a held question, learner, frame or workspace visibility change", async t => {
  const viewer = vue.ref({ actorKey: "member-a" });
  const channel = vue.shallowRef(null);
  let reference = exerciseQuestion;
  let resolveWorkspace;
  let frameCurrent = true;
  const props = vue.reactive({ name: "Colleague", settleWorkspace: () => new Promise(resolve => { resolveWorkspace = resolve; }) });
  const view = mount(t, async () => ({ messages: [], status: "ready", trainingQuestion: reference }),
    props, viewer, null, null, channel);
  await flush();
  props.focus = { projectSlug: "practice", sessionId: "practice-session", pane: "preview" };
  for (const change of [async () => { reference = { ...reference, issuedRevision: reference.issuedRevision + 1 }; await view.state.refresh(); },
    async () => { viewer.value = { actorKey: "member-b" }; await flush(); },
    async () => { frameCurrent = false; }, async () => { props.focus = { ...props.focus, pane: "chat" }; }]) {
    frameCurrent = true;
    props.focus = { ...props.focus, pane: "preview" };
    const ticket = channel.value.beginExercise(exerciseFrame, () => frameCurrent);
    assert.ok(ticket);
    const pending = channel.value.finishExercise(ticket, exerciseResponse);
    await change();
    resolveWorkspace({ ...nativeWorkspace });
    assert.equal(await pending, false);
  }
  assert.equal(view.requests.some(request => request.url.endsWith("/training/observations")), false);
  assert.deepEqual(view.notices, []);
});

test("exercise check rejection preserves pending learner explanation and releases only its own bounded ticket", async t => {
  const channel = vue.shallowRef(null);
  const props = vue.reactive({ name: "Colleague", settleWorkspace: async () => ({ ...nativeWorkspace }) });
  const view = mount(t, async url => {
    if (url.endsWith("/training/observations")) throw new Error("Request expired; press again.");
    return { messages: [], status: "ready", trainingQuestion: exerciseQuestion };
  }, props, null, null, null, channel);
  await flush();
  props.focus = { projectSlug: "practice", sessionId: "practice-session", pane: "preview" };
  view.state.draft.value = "I pressed the button and saw a greeting.";
  const tickets = Array.from({ length: 8 }, () => channel.value.beginExercise(exerciseFrame, () => true));
  assert.ok(tickets.every(Boolean));
  assert.equal(channel.value.beginExercise(exerciseFrame, () => true), null);
  assert.equal(await channel.value.finishExercise(tickets[0], exerciseResponse), false);
  assert.match(view.notices.at(-1).message, /application observation was not confirmed.*Press Ask the server again/u);
  assert.equal(view.state.draft.value, "I pressed the button and saw a greeting.");
  assert.ok(channel.value.beginExercise(exerciseFrame, () => true));
});


test("previous-conversation list offers explicit fresh recovery after a terminal provider failure without uncertain delivery", async t => {
  let current = "failed-conversation";
  const view = mount(t, async (url, options) => {
    if (url.includes("/history?")) return { ok: true, conversations: [], hasMore: false };
    if (url.endsWith("/conversations/fresh")) {
      current = "fresh-conversation";
      return { ok: true, conversationId: current,
        fresh: { operationId: options.body.operationId, previousConversationId: "failed-conversation", conversationId: current } };
    }
    const state = { conversationId: current, messages: [], status: "ready",
      error: current === "failed-conversation" ? "The provider refused compaction." : "" };
    return url.startsWith("/api/assistant/") ? conversationSnapshot(state) : { ok: true, ...state };
  });
  await flush();
  view.state.draft.value = "Keep my next request unsent.";
  const runtime = view.state.conversation.runtime.value;
  assert.equal(runtime.delivery.state.messages.some(message => message.status === "uncertain"), false);
  await view.state.loadHistory();
  assert.equal(view.state.historyOpen.value, true);
  assert.deepEqual(view.state.historyConversations.value, []);
  const list = descriptor.template.content.split('<ConversationDialog :model-value="historyOpen"')[1]
    .split('<template v-if="!historyId">')[1].split('<template v-else>')[0];
  assert.match(list, /:disabled="freshBusy \|\| Boolean\(freshBlocked\)" @click="showFreshConfirmation">Start fresh/);
  assert.ok(list.includes('<p v-if="freshBlocked" role="status">{{ freshBlocked }}</p>'));
  runtime.snapshot.value = { ...runtime.snapshot.value, status: "working" };
  assert.match(view.state.freshBlocked.value, /Wait for the current request/);
  view.state.showFreshConfirmation();
  assert.equal(view.state.historyOpen.value, false, "the existing close owner retires the history dialog before confirmation");
  assert.equal(view.state.freshConfirm.value, true);
  assert.equal(await view.state.startFresh(), false, "existing busy admission blocks even a direct confirmation attempt");
  assert.equal(view.requests.some(request => request.options.method === "POST"), false);
  runtime.snapshot.value = { ...runtime.snapshot.value, status: "ready" };
  view.state.closeFreshConfirmation();
  await view.state.loadHistory();
  view.state.showFreshConfirmation();
  assert.equal(view.state.historyOpen.value, false);
  assert.equal(view.state.freshConfirm.value, true);
  assert.equal(view.requests.some(request => request.options.method === "POST"), false, "opening confirmation never executes fresh or resends messages");
  assert.equal(view.state.conversation.runtime.value, runtime);
  assert.equal(view.state.draft.value, "Keep my next request unsent.");
  assert.equal(await view.state.startFresh(), true);
  const posts = view.requests.filter(request => request.options.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "/api/vibe64/colleague/conversations/fresh");
  assert.equal(posts[0].options.body.expectedConversationId, "failed-conversation");
  assert.deepEqual(posts[0].options.body.unconfirmedMessages, []);
  assert.equal(view.state.product.value.conversationId, "fresh-conversation");
  assert.equal(view.state.draft.value, "Keep my next request unsent.");
  assert.equal(view.state.voice.controller.state.binding.conversationId, "fresh-conversation");
  assert.equal(view.state.voiceSession.value, view.state.voice.controller.state.session, "fresh recovery restores the original controls");
  assert.equal(view.state.voiceSession.value.voice.listening.value, false, "restoring controls does not start recording");
});

test("fresh recovery binds a new paused original voice session without transport, capture, playback or submission", async t => {
  const { createVoiceConversationController } = await import(new URL("./voiceController.js", import.meta.resolve("@jskit-ai/assistant-voice/client")));
  const { useVoiceConversation } = await import(new URL("./voiceConversation.js", import.meta.resolve("@jskit-ai/assistant-voice/client")));
  const { useVoiceTransport } = await import(new URL("./voiceTransport.js", import.meta.resolve("@jskit-ai/assistant-voice/client")));
  let current = "original";
  const effects = [];
  const preferences = { readAloud: true, voiceId: "kitten_jasper" };
  const controller = createVoiceConversationController({
    connectSpeech: binding => binding.socketUrl,
    createSession(binding, options) {
      return useVoiceConversation(binding, { ...options, createTransport(configuration) {
        const transport = useVoiceTransport(configuration);
        for (const name of ["connect", "startListening", "preparePlayback", "speak"]) {
          const original = transport[name];
          transport[name] = (...args) => { effects.push(name); return original(...args); };
        }
        return transport;
      } });
    }
  });
  t.after(() => controller.dispose());
  const voiceHost = { launcher: vue.ref(null), controller, open(binding) {
    binding.defaults = preferences;
    return controller.open({ conversation: binding });
  } };
  const view = mount(t, async (url, options) => {
    if (url.endsWith("/conversations/fresh")) {
      current = "fresh-paused";
      return { ok: true, conversationId: current,
        fresh: { operationId: options.body.operationId, previousConversationId: "original", conversationId: current } };
    }
    const state = { conversationId: current, messages: [], status: "ready" };
    return url.startsWith("/api/assistant/") ? conversationSnapshot(state) : { ok: true, ...state };
  }, vue.reactive({ name: "Colleague" }), null, null, null, null, voiceHost);
  await flush();
  await view.state.openVoice();
  const old = controller.state.session;
  let closed = 0;
  const close = old.close;
  old.close = async () => { closed += 1; await close(); };
  view.state.draft.value = "Leave this next request unsent.";
  assert.equal(await view.state.startFresh(), true);
  await flush();
  const paused = controller.state.session;
  assert.notEqual(paused, old);
  assert.equal(closed, 1);
  assert.equal(controller.state.binding.conversationId, current);
  assert.equal(controller.state.binding.id, JSON.stringify(["colleague", view.state.actorKey.value]));
  assert.equal(view.state.voiceSession.value, paused, "the original controls receive the new matching session");
  assert.equal(view.state.bodyVisible.value, true);
  assert.equal(paused.live.value, false);
  assert.equal(paused.starting.value, false);
  assert.equal(paused.capturing.value, false);
  assert.equal(paused.voice.captureState.value, "idle");
  assert.equal(paused.voice.listening.value, false);
  assert.equal(paused.voice.speaking.value, false);
  assert.equal(paused.voice.ready.value, false);
  assert.equal(paused.pendingTranscript.value, null);
  assert.equal(paused.readAloud.value, preferences.readAloud);
  assert.equal(paused.voice.selectedVoice.value, preferences.voiceId);
  assert.equal(view.state.draft.value, "Leave this next request unsent.");
  assert.deepEqual(effects, [], "actual original voice lifecycle invokes no connect/capture/playback on paused binding");
  assert.equal(view.requests.filter(value => value.options.method === "POST").length, 1, "only the original fresh operation was submitted");
  assert.match(descriptor.template.content, /v-if="voiceSession"[^>]*:session="voiceSession"/);
  assert.ok(descriptor.template.content.includes('<VoiceConversationSettings :voice="voiceSession.voice"'));
});

test("fresh paused controls preserve competing root targets, busy activation and pending target switches", async t => {
  for (const obstacle of ["session", "binding", "busy", "nextTarget"]) {
    await t.test(obstacle, async t => {
      let current = "original";
      const view = mount(t, async (url, options) => {
        if (url.endsWith("/conversations/fresh")) {
          current = "fresh";
          return { ok: true, conversationId: current,
            fresh: { operationId: options.body.operationId, previousConversationId: "original", conversationId: current } };
        }
        return { ok: true, conversationId: current, messages: [], status: "ready" };
      });
      await flush();
      const state = view.state.voice.controller.state;
      const retained = { id: "unrelated-main" };
      state[obstacle] = obstacle === "busy" ? true : retained;
      let opened = 0, ended = 0;
      view.state.voice.open = async () => { opened += 1; return true; };
      view.state.voice.controller.end = async () => { ended += 1; };
      view.state.draft.value = "Keep this personal draft.";
      const blocked = obstacle === "busy" || obstacle === "nextTarget";
      assert.equal(await view.state.startFresh(), !blocked);
      assert.equal(state[obstacle], obstacle === "busy" ? true : retained);
      assert.equal(opened, 0);
      assert.equal(ended, 0);
      assert.equal(view.state.open.value, !blocked);
      assert.equal(view.state.draft.value, "Keep this personal draft.");
      assert.equal(view.state.freshOperation.value, null);
      if (blocked) {
        assert.equal(view.requests.filter(value => value.url.endsWith("/conversations/fresh")).length, 0);
        assert.match(view.state.freshError.value, /pending voice switch/);
      }
    });
  }
});

test("late paused presentation failure leaves fresh archive committed and text recovery usable without another archive", async t => {
  let current = "original";
  const view = mount(t, async (url, options) => {
    if (url.endsWith("/conversations/fresh")) {
      current = "fresh";
      return { ok: true, conversationId: current,
        fresh: { operationId: options.body.operationId, previousConversationId: "original", conversationId: current } };
    }
    return { ok: true, conversationId: current, messages: [], status: "ready" };
  });
  await flush();
  const open = view.state.voice.open;
  view.state.voice.open = async () => { throw new Error("The voice presentation failed."); };
  view.state.draft.value = "Keep my draft.";
  assert.equal(await view.state.startFresh(), true);
  assert.equal(view.state.product.value.conversationId, "fresh");
  assert.equal(view.state.freshOperation.value, null);
  assert.equal(view.state.freshError.value, "");
  assert.equal(view.state.freshBusy.value, false);
  assert.equal(view.state.open.value, true);
  assert.equal(view.state.draft.value, "Keep my draft.");
  assert.equal(view.notices.length, 1);
  assert.match(view.notices[0].message, /fresh conversation is ready.*voice controls could not open/i);
  view.state.voice.open = open;
  await view.state.openVoice();
  assert.equal(view.state.voiceSession.value, view.state.voice.controller.state.session);
  assert.equal(view.requests.filter(value => value.url.endsWith("/conversations/fresh")).length, 1);
});

for (const changedScope of ["actor", "pointer"]) {
  test(`paused fresh activation cannot hide another ${changedScope} scope after its open settles`, async t => {
    let current = "original";
    const viewer = vue.ref({ actorKey: "person-a" });
    const view = mount(t, async (url, options) => {
      if (url.endsWith("/conversations/fresh")) {
        current = "fresh";
        return { ok: true, conversationId: current,
          fresh: { operationId: options.body.operationId, previousConversationId: "original", conversationId: current } };
      }
      return { ok: true, conversationId: current, messages: [], status: "ready" };
    }, vue.reactive({ name: "Colleague" }), viewer);
    await flush();
    let finishOpen;
    view.state.voice.open = () => new Promise(resolve => { finishOpen = resolve; });
    const pending = view.state.startFresh();
    await flush();
    assert.equal(view.state.product.value.conversationId, "fresh");
    assert.equal(view.state.freshOperation.value, null, "archive success is committed before voice presentation starts");
    if (changedScope === "actor") viewer.value = { actorKey: "person-b" };
    current = "other";
    view.state.product.value = { conversationId: current, status: "ready", messages: [] };
    await flush();
    view.state.open.value = true;
    view.state.draft.value = "New scope's own draft.";
    finishOpen(false);
    assert.equal(await pending, false);
    assert.equal(view.state.open.value, true, "obsolete openVoice must not close the new scope's text view");
    assert.equal(view.state.draft.value, "New scope's own draft.");
    assert.equal(view.state.freshOperation.value, null);
    assert.equal(view.notices.length, 0);
  });
}


test("archived Colleague pagination completes each shared request before render and releases failed requests", async t => {
  let page = 0;
  let rejectPage = false;
  const view = mount(t, async url => {
    if (url.includes("/history/page")) {
      if (rejectPage) throw new Error("History unavailable");
      page += 1;
      return { ok: true, id: "archived", readOnly: true,
        conversationLog: [{ turnId: `saved-${page}`, user: { role: "user", messageId: `saved-${page}`, text: `Saved page ${page}` },
          messages: [{ role: "user", messageId: `saved-${page}`, text: `Saved page ${page}` }] }],
        pagination: { hasMoreBefore: true, nextBeforeTurnId: `cursor-${page}` } };
    }
    if (url.includes("/history?")) return { ok: true, conversations: [], nextOffset: 0, hasMore: false };
    return { ok: true, conversationId: "current", messages: [], status: "ready" };
  });
  await flush();
  await view.state.loadHistory();
  await view.state.readHistoryPage("archived");
  const order = [];
  const stop = vue.watch(view.state.historyPages, () => order.push("render"), { flush: "post" });
  t.after(stop);
  for (const expected of [2, 3]) {
    order.length = 0;
    const completed = [];
    await view.state.readHistoryPage("archived", { more: true, complete: result => {
      completed.push(result);
      order.push("complete");
      assert.equal(view.state.historyPages.value.length, expected);
      assert.equal(view.state.historyLoading.value, false);
    } });
    await vue.nextTick();
    assert.deepEqual(completed, [{ changed: true }]);
    assert.deepEqual(order, ["complete", "render"], "freeze the shared anchor before the reactive page renders");
  }
  const completed = [];
  rejectPage = true;
  await view.state.readHistoryPage("archived", { more: true, complete: result => completed.push(result) });
  assert.deepEqual(completed, [{ changed: false }]);
  assert.equal(view.state.historyError.value, "History unavailable");
  assert.equal(view.state.historyPages.value.length, 3);
  assert.equal(view.requests.some(({ options }) => options.method === "POST"), false);
});


for (const invalidation of ["closed view", "changed actor"]) {
  test(`archived Colleague pagination releases busy and late requests after ${invalidation}`, async t => {
    const viewer = vue.ref({ actorKey: "person-a" });
    let finish;
    const view = mount(t, async url => {
      if (url.includes("/history/page")) return new Promise(resolve => { finish = resolve; });
      if (url.includes("/history?")) return { ok: true, conversations: [], nextOffset: 0, hasMore: false };
      return { ok: true, conversationId: viewer.value.actorKey, messages: [], status: "ready" };
    }, vue.reactive({ name: "Colleague" }), viewer);
    await flush();
    await view.state.loadHistory();
    const completed = [];
    const held = view.state.readHistoryPage("archived", { more: true, complete: result => completed.push(result) });
    await flush();
    const busy = [];
    await view.state.readHistoryPage("archived", { more: true, complete: result => busy.push(result) });
    assert.deepEqual(busy, [{ changed: false }]);
    assert.equal(view.requests.filter(request => request.url.includes("/history/page")).length, 1);
    if (invalidation === "closed view") view.state.closeHistory();
    else viewer.value = { actorKey: "person-b" };
    await flush();
    finish({ ok: true, id: "archived", readOnly: true,
      conversationLog: [{ turnId: "old", messages: [{ role: "user", messageId: "old", text: "Private old words" }] }],
      pagination: { hasMoreBefore: false, nextBeforeTurnId: "" } });
    await held;
    assert.deepEqual(completed, [{ changed: false }]);
    assert.deepEqual(view.state.historyPages.value, []);
    assert.equal(view.requests.some(({ options }) => options.method === "POST"), false);
  });
}

test("watch details preserve the conversation and use existing resume/cancel admission", async t => {
  const viewer = vue.ref({ actorKey: "person-a" });
  let watches = [{ watchId: "paused-watch", status: "paused", question: "Tell me when it replies" }];
  const assignments = [{ assignmentId: "assignment", status: "waiting", summary: "Finish the change" }];
  const view = mount(t, async url => {
    if (url.endsWith("/watches/resume")) watches = [{ ...watches[0], status: "active" }];
    if (url.endsWith("/watches/cancel")) watches = [];
    return { ok: true, conversationId: viewer.value.actorKey, messages: [], status: "ready",
      watches: viewer.value.actorKey === "person-a" ? watches : [],
      assignments: viewer.value.actorKey === "person-a" ? assignments : [] };
  }, vue.reactive({ name: "Colleague" }), viewer);
  await flush();
  const original = view.state.conversation.runtime.value;
  view.state.draft.value = "Keep this draft";
  view.state.watchDetails.value = true;
  await view.state.changeWatch("paused-watch", "resume");
  assert.equal(view.state.watches.value[0].status, "active");
  await view.state.changeWatch("paused-watch", "cancel");
  assert.equal(view.state.watches.value.length, 0);
  assert.equal(view.state.assignments.value.length, 1);
  assert.equal(view.state.watchDetails.value, true);
  assert.equal(view.state.conversation.runtime.value, original);
  assert.equal(view.state.draft.value, "Keep this draft");
  assert.deepEqual(view.requests.filter(({ options }) => options.method === "POST").map(({ url, options }) => [url, options.body]), [
    ["/api/vibe64/colleague/watches/resume", { watchId: "paused-watch" }],
    ["/api/vibe64/colleague/watches/cancel", { watchId: "paused-watch" }]
  ]);
  assert.equal(view.subscriptions.size, 1);
  viewer.value = { actorKey: "person-b" };
  await flush();
  assert.equal(view.state.watchDetails.value, false);
  assert.equal(view.state.watches.value.length, 0);
  assert.equal(view.state.assignments.value.length, 0);
});


// Genuine new Main native saved-block timing. The SAME shared cue/voice owners
// run here; synthesis/playback transport is controlled, not acoustic acceptance.
test("Main holds saved native blocks before checkpoint; failed A never speaks after proven B", async t => {
  const { useVoiceConversation } = await import(new URL("./voiceConversation.js", import.meta.resolve("@jskit-ai/assistant-voice/client")));
  const { useVoiceTransport } = await import(new URL("./voiceTransport.js", import.meta.resolve("@jskit-ai/assistant-voice/client")));
  const scope = vue.effectScope(); t.after(() => scope.stop());
  const cue = vue.ref(null); const turns = vue.ref([]); const spoken = []; const receipts = [];
  const target = "actual-learning-main"; const actor = { mounted: true, actorKey: "own-viewer", clientId: "own-client",
    conversationId: target, runtimeConversationId: target };
  let shared; let session;
  const presentation = { get state() { return { cue: cue.value }; }, playback(event) { receipts.push(event); },
    observeCue() {}, retireCue() {} };
  const makeCue = (turnId, cueId) => ({ clientId: actor.clientId, conversationId: target, turnId, cueId,
    navigationId: `navigation-${cueId}`, outputId: "", canonicalFinal: false, phase: "armed" });
  const user = id => ({ role: "user", messageId: id, text: `Request ${id}`, receipt: true });
  scope.run(() => {
    shared = useTrainingPresentationCue({ scope: () => actor, presentation: () => presentation,
      voiceSession: vue.ref(null), acknowledge: async () => ({ ok: true }), error: vue.ref(""), holdMainReplies: true });
    session = useVoiceConversation({ id: "same-main-binding", conversationId: target, defaults: { readAloud: true },
      get state() { return shared.voiceState(projectConversationVoiceState({ turns: turns.value }), target, turns.value); },
      get narration() { return shared.narration({ turns: turns.value, loading: false, working: true,
        eligible: true, vocalizeThinking: true, vocalizeInterimTurns: true, thinkingSounds: false }, target); },
      onPlayback(event) { shared.playback(event, target); }, submitText: async () => ({ delivered: true }) }, {
      createTransport(configuration) {
        const transport = useVoiceTransport(configuration);
        transport.speak = async (text, turnId) => { spoken.push(text); transport.activeSpeechTurnId.value = turnId;
          configuration.onPlayback({ turnId, phase: "started" }); return true; };
        transport.appendSpeech = text => { spoken.push(text); return true; };
        transport.endSpeech = () => { const turnId = transport.activeSpeechTurnId.value;
          configuration.onPlayback({ turnId, phase: "completed" }); transport.activeSpeechTurnId.value = ""; };
        return transport;
      }
    });
  });
  t.after(() => session.close());
  await flush();
  cue.value = makeCue("000001", "cue-a");
  turns.value = [{ turnId: "000001", user: user("request-a"), assistant: {
    role: "assistant", messageId: "native-block-a", outputId: "native-block-a", text: "Do not speak this unfinished A." } }];
  await flush(); assert.deepEqual(spoken, [], "saved patch before checkpoint is held, not merely its stream overlay");
  turns.value = [{ ...turns.value[0], thinking: [{ role: "thinking", messageId: "thinking-a", text: "Unconfirmed thinking A." }],
    commentary: [{ role: "commentary", messageId: "commentary-a", text: "Unconfirmed interim A." }] }];
  await flush();
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.deepEqual(spoken, [], "optional narration cannot bypass the final hold at its original settle deadline");
  cue.value = { ...cue.value, phase: "interrupted" };
  await flush(); assert.deepEqual(spoken, [], "Stop does not release an unconfirmed saved reply");
  session.stopSpeech(); session.inviteSpeech("request-b");
  cue.value = makeCue("000002", "cue-b");
  turns.value = [...turns.value, { turnId: "000002", user: user("request-b"), assistant: {
    role: "assistant", messageId: "native-block-b", outputId: "native-block-b", text: "Hold B until its exact final." } }];
  await flush(); assert.deepEqual(spoken, [], "a new invitation/cue must not expose the failed older A");
  turns.value = [turns.value[0], { ...turns.value[1], assistant: { role: "assistant", messageId: "native-final-b",
    outputId: "native-final-b", text: "The verified final B." } }];
  await flush(); assert.deepEqual(spoken, [], "saving the final text alone is not native checkpoint proof");
  cue.value = { ...cue.value, canonicalFinal: true, outputId: "native-final-b", phase: "bound" };
  await flush();
  assert.deepEqual(spoken, ["The verified final B."], "the exact proven B reaches the original queue once");
  assert.deepEqual(receipts.map(event => [event.outputId, event.phase]), [["native-final-b", "started"], ["native-final-b", "completed"]]);
  turns.value = turns.value.map(turn => ({ ...turn })); await flush();
  assert.deepEqual(spoken, ["The verified final B."], "history/state refresh does not speak B twice");
});

test("Main saved-reply hold is opt-in; original Colleague projection is unchanged", t => {
  const scope = vue.effectScope(); t.after(() => scope.stop());
  const cue = vue.ref({ clientId: "own", conversationId: "original", turnId: "000001", phase: "armed", canonicalFinal: false });
  const saved = { messages: [{ id: "saved", role: "assistant", text: "Original saved reply." }],
    streamingReply: { id: "stream", role: "assistant", text: "Original stream." }, status: "working" };
  let shared;
  scope.run(() => { shared = useTrainingPresentationCue({ scope: () => ({ mounted: true, actorKey: "actor", clientId: "own", conversationId: "original" }),
    presentation: () => ({ state: { cue: cue.value } }), voiceSession: vue.ref(null), acknowledge: async () => ({ ok: true }), error: vue.ref("") }); });
  assert.deepEqual(shared.voiceState(saved, "original"), { ...saved, streamingReply: null });
  assert.equal(shared.voiceState(saved, "other"), saved);
});

test("Main origin ceiling refuses prospectively through the original navigation ACK before player or audio effects", async t => {
  const owner = vue.effectScope(); t.after(() => owner.stop());
  const value = vue.ref(null), receipts = [], effects = [];
  const current = { mounted: true, actorKey: "own", clientId: "client", conversationId: "main", runtimeConversationId: "main" };
  let cue, navigation;
  owner.run(() => {
    cue = useTrainingPresentationCue({ scope: () => current, presentation: () => ({ state: { cue: value.value } }),
      voiceSession: vue.ref(null), acknowledge: async () => ({ ok: true }), error: vue.ref(""), holdMainReplies: true });
    navigation = createTrainingNavigation({ scope: () => current, beforeNavigate: () => undefined,
      navigate: () => async command => { cue.requireCueCapacity(); effects.push(command.id); return {}; },
      acknowledge: async receipt => { receipts.push(receipt); }, error: vue.ref("") });
  });
  for (let index = 0; index < 128; index += 1) {
    value.value = { clientId: "client", conversationId: "main", turnId: `turn-${index}`, cueId: `cue-${index}`,
      phase: "failed", canonicalFinal: false };
  }
  await flush();
  const command = { id: "after-128", status: "pending", presentation: { operation: "cue" } };
  await navigation.handle(command);
  assert.deepEqual(effects, [], "capacity is checked inside the original effect before armCue/playback");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].ok, false);
  assert.match(receipts[0].error, /128 interrupted explanations/u);
  await navigation.handle(command);
  assert.equal(receipts.length, 2, "same original navigation receipt can be acknowledged again without another effect");
  assert.deepEqual(receipts[1], receipts[0]);
  // New cue and missing loaded pages do not clear old origins.
  value.value = { clientId: "client", conversationId: "main", turnId: "new", phase: "armed", canonicalFinal: false };
  assert.throws(() => cue.requireCueCapacity(), /128/u);
  const saved = { messages: [{ id: "old-output", role: "assistant", text: "Old suppressed reply." }], streamingReply: null };
  const turn = { turnId: "turn-0", assistant: { outputId: "old-output" } };
  assert.deepEqual(cue.voiceState(saved, "main", [turn]).messages, []);
  cue.voiceState({ messages: [], streamingReply: null }, "main", []);
  assert.deepEqual(cue.voiceState(saved, "main", [turn]).messages, [], "page omission cannot evict suppression");
});


test("the actual general Colleague body delegates its trusted minimize/restore to selected Main without replacing its owner", async t => {
  const observations = [], body = vue.shallowRef(null);
  const main = { begin(event, control) { return event === nativeClick ? { control } : null; },
    async finish(ticket) { observations.push({ control: ticket.control, visible: body.value.visible,
      actor: body.value.actorKey, conversationId: body.value.conversationId }); } };
  const channel = vue.shallowRef(main);
  const view = mount(t, async () => ({ conversationId: "general-same", messages: [], status: "ready" }),
    vue.reactive({ name: "Colleague" }), vue.ref({ actorKey: "member" }), null, null, channel, null, body);
  await flush();
  const owner = body.value;
  assert.equal(channel.value, main);
  view.state.draft.value = "Keep the supervisor draft";
  await view.state.toggleConversation(nativeClick); await flush();
  const voice = view.state.voice.controller.state.session;
  await view.state.toggleConversation(nativeClick); await flush();
  await view.state.toggleConversation(nativeClick); await flush();
  assert.equal(body.value, owner);
  assert.equal(channel.value, main);
  assert.deepEqual(observations.map(value => [value.control, value.visible]),
    [["colleague-restore", true], ["colleague-minimize", false], ["colleague-restore", true]]);
  assert.ok(observations.every(value => value.actor === "member" && value.conversationId === "general-same"));
  assert.equal(view.state.voice.controller.state.session, voice);
  assert.equal(view.state.draft.value, "Keep the supervisor draft");
  assert.equal(view.requests.some(value => value.url.endsWith("/training/observations")), false);
});

function mountMainGestureOwner(t, question = { ...workspaceQuestion, assessmentId: "return-to-colleague" }) {
  const product = vue.ref({ conversationId: "actual-typed-main", trainingQuestion: question });
  const actor = vue.ref("member"), current = vue.ref(true), visible = vue.ref(true), owner = vue.shallowRef({ body: "A" });
  const conversationId = vue.ref("general-A"), requests = [], notices = [];
  const scope = { actorKey: actor, product, clientId: "actual-client", current: () => current.value, preserveDrawer: true };
  let gestures;
  const renderer = vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp({ setup() {
    gestures = useTrainingLearnerGestures({ scope,
      workspace: { focus: { projectSlug: "practice", sessionId: "practice-session", pane: "preview" }, settle: async () => ({ ...nativeWorkspace }) },
      drawer: { bodyVisible: visible, xs: vue.ref(false), owner, conversationId },
      observe: async request => { requests.push(structuredClone(request.body)); return { ok: true }; }, failure: error => notices.push(error.message) });
    return () => null;
  } });
  app.mount({}); t.after(() => app.unmount());
  return { gestures, product, actor, current, visible, owner, conversationId, requests, notices };
}

test("Main return practical retains the actual general body across collapse but refuses A-to-fresh-B evidence until a repeated question", async t => {
  const f = mountMainGestureOwner(t);
  const first = f.gestures.begin(nativeClick, "colleague-minimize"); assert.ok(first);
  f.visible.value = false; assert.equal((await f.gestures.finish(first)).ok, true);
  f.current.value = false; f.gestures.clear(); f.current.value = true;
  const use = f.gestures.begin(nativeClick, "preview-select"); assert.ok(use);
  assert.equal((await f.gestures.finish(use)).ok, true);
  f.conversationId.value = "general-B";
  f.product.value = { ...f.product.value, trainingQuestion: null };
  f.product.value = { ...f.product.value, trainingQuestion: { ...workspaceQuestion, assessmentId: "return-to-colleague" } };
  assert.equal(f.gestures.begin(nativeClick, "colleague-restore"), null);
  assert.equal(f.requests.length, 2);
  assert.match(f.notices[0], /Colleague changed.*repeat the question/u);
  f.product.value = { ...f.product.value, trainingQuestion: { ...f.product.value.trainingQuestion, questionId: "genuine-repeat" } };
  const restore = f.gestures.begin(nativeClick, "colleague-restore"); assert.ok(restore);
  f.visible.value = true; assert.equal((await f.gestures.finish(restore)).ok, true);
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].reference.questionId, "genuine-repeat");
});

test("Main's selected lifetime and actual body handle fence held receipts; synthetic events still allocate no ticket", async t => {
  const f = mountMainGestureOwner(t);
  assert.equal(f.gestures.begin({ type: "click", isTrusted: false }, "colleague-minimize"), null);
  const ticket = f.gestures.begin(nativeClick, "colleague-minimize"); assert.ok(ticket);
  f.visible.value = false; f.owner.value = { body: "new body, same conversation" };
  assert.equal(await f.gestures.finish(ticket), false);
  assert.deepEqual(f.requests, []);
  assert.equal(f.gestures.begin(nativeClick, "colleague-restore"), null);
});
