import fs from "node:fs";
import path from "node:path";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { transformSync } from "esbuild";
import * as vue from "vue";
import * as mdi from "@mdi/js";
import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageDelivery } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { createProjectVoiceBinding } from "../../packages/vibe64-voice/src/client/projectVoiceBinding.js";
import { sourceEditorLinkTarget } from "../../src/lib/vibe64SourceEditorLinks.js";
import { thinkingMessagePresentation, usesCommentaryForThinking } from "../../src/lib/vibe64ThinkingPresentation.js";
import { parseIntegrationSetupRequest, vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";

const componentPath = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
const composablePath = path.resolve("src/composables/useVibe64AutopilotView.js");
const promptTextareaPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue"
);
const sharedPromptInputPath = path.resolve(
  "node_modules/@jskit-ai/assistant-core/src/client/conversation/AssistantPromptInput.vue"
);
const sharedComposerActionsPath = path.resolve(
  "node_modules/@jskit-ai/assistant-core/src/client/conversation/AssistantComposerActions.vue"
);
const promptHintsPath = path.resolve(
  "node_modules/@jskit-ai/assistant-core/src/client/conversation/AssistantComposerSupport.vue"
);
const runtimeHostPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue");
const temporaryAiPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue"
);
const temporaryAiComposablePath = path.resolve("src/composables/useVibe64TemporaryAi.js");
const temporaryAiFixActionPath = path.resolve(
  "src/components/studio/Vibe64TemporaryAiFixAction.vue"
);

// Match the original Colleague client renderer: compile the actual SFC setup,
// use the real Vue instance and moved launcher, and stub presentation only.
function mountMainConversationLog({ render = false } = {}) {
  const filename = path.resolve("src/components/studio/vibe64-session/Vibe64ConversationLog.vue");
  const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
  const script = compileScript(descriptor, { id: "main-voice-client" });
  const { code } = transformSync(script.content, { format: "cjs" });
  const launcherFilename = new URL("./voiceLauncher.js", import.meta.resolve("@jskit-ai/assistant-voice/client"));
  const { code: launcherCode } = transformSync(fs.readFileSync(launcherFilename, "utf8"), { format: "cjs" });
  const launcher = { exports: {} };
  new Function("require", "module", "exports", launcherCode)(name => {
    expect(name).toBe("vue");
    return vue;
  }, launcher, launcher.exports);
  const voice = {
    controller: { state: vue.shallowReactive({ binding: null, session: null, nextTarget: null, error: "" }) },
    readAloudFor: vi.fn(binding => binding.defaults?.readAloud === true),
    readAloudChangePendingFor: vi.fn(() => false),
    open: vi.fn(async binding => {
      voice.controller.state.binding = binding;
      voice.controller.state.session = {
        composerBlocked: vue.ref(false), live: vue.ref(false), callMode: vue.ref("push-to-talk"), starting: vue.ref(false), capturing: vue.ref(false),
        microphoneMuted: vue.ref(false), sending: vue.ref(false), pendingTranscript: vue.ref(null), pushHolding: vue.ref(false),
        canTakeTranscript: vi.fn(() => true),
        voice: { listening: vue.ref(false), speaking: vue.ref(false) }, avatarVisual: vue.ref({ state: "idle" }), readAloud: vue.ref(voice.readAloudFor(binding)),
        toggleReadAloud: vi.fn(async () => { voice.controller.state.session.readAloud.value = !voice.controller.state.session.readAloud.value; }),
        discardRecording: vi.fn(async () => {}), toggleHandsFree: vi.fn(async () => {}),
        startPushToTalk: vi.fn(async () => {}), finishPushToTalk: vi.fn(async () => {}), cancelPushToTalk: vi.fn(async () => {})
      };
      return true;
    })
  };
  const imports = {
    vue, "@mdi/js": mdi,
    "@local/vibe64-voice/client": { useVibe64Voice: () => voice, createProjectVoiceBinding },
    "@jskit-ai/assistant-voice/client": { VoiceAvatar: {}, VoiceConversationControls: {}, VoiceConversationHost: {}, VoiceConversationSettings: {}, useVoiceLauncher: launcher.exports.useVoiceLauncher },
    "@jskit-ai/assistant-core/client/conversation": { AssistantConversationElement: {} },
    "@local/vibe64-runtime/shared/assistantRouting": { assistantModeLabel },
    "@local/vibe64-runtime/shared": { parseIntegrationSetupRequest, vibe64AssistantSelectionLabel },
    "@/lib/vibe64SourceEditorLinks.js": { sourceEditorLinkTarget },
    "@/lib/vibe64ThinkingPresentation.js": { thinkingMessagePresentation, usesCommentaryForThinking }
  };
  const controls = [];
  if (render) {
    const controlsFilename = new URL("./VoiceConversationControls.vue", import.meta.resolve("@jskit-ai/assistant-voice/client"));
    const controlsDescriptor = parse(fs.readFileSync(controlsFilename, "utf8"), { filename: controlsFilename.pathname }).descriptor;
    const controlsCode = transformSync(compileScript(controlsDescriptor, { id: "main-voice-controls" }).content, { format: "cjs" }).code;
    const controlsModule = { exports: {} };
    new Function("require", "module", "exports", controlsCode)(name => {
      if (name === "./voiceLauncher.js") return launcher.exports;
      if (name === "vue") return vue;
      if (name === "@mdi/js") return mdi;
      throw new Error(`Unexpected control import ${name}`);
    }, controlsModule, controlsModule.exports);
    const originalControlsSetup = controlsModule.exports.default.setup;
    controlsModule.exports.default.setup = (props, context) => {
      const state = originalControlsSetup(props, context);
      controls.push(state);
      return state;
    };
    controlsModule.exports.default.render = () => null;
    imports["@jskit-ai/assistant-voice/client"].VoiceConversationControls = controlsModule.exports.default;
    imports["@jskit-ai/assistant-voice/client"].VoiceConversationHost = {
      props: ["controller", "presentation"], setup: (props, { slots }) => () => slots.conversation({ session: props.controller.state.session, disabled: false })
    };
    imports["@jskit-ai/assistant-core/client/conversation"].AssistantConversationElement = {
      inheritAttrs: false, props: ["avatarSize"], setup: (props, { slots }) => () => vue.h("section", [
        slots["avatar-tools"]?.(), slots["avatar-control"]?.({ size: props.avatarSize }), slots.hints?.()
      ])
    };
  }
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name.startsWith("./") && name.endsWith(".vue")) return { default: {} };
    expect(imports[name], name).toBeTruthy();
    return imports[name];
  }, module, module.exports);
  if (render) {
    const template = compileTemplate({ source: descriptor.template.content, filename, id: "main-voice-client", compilerOptions: { bindingMetadata: script.bindings } });
    expect(template.errors).toEqual([]);
    const templateModule = { exports: {} };
    new Function("require", "module", "exports", transformSync(template.code, { format: "cjs" }).code)(() => vue, templateModule, templateModule.exports);
    module.exports.default.render = templateModule.exports.render;
  }
  const runtime = (projectSlug, sessionId) => ({
    identity: { actorKey: "learner", projectSlug, sessionId }, available: vue.ref(true),
    conversationLog: { turns: [], loading: false }, mounted: { session: vue.ref({ sessionName: sessionId }) },
    access: { canUseChat: vue.ref(true) }
  });
  const props = vue.shallowReactive({ voiceRuntime: runtime("one", "session-1"), visible: true, turns: [], sessionId: "session-1", working: false });
  const renderer = vue.createRenderer({
    createComment: () => ({}), createElement: tag => ({ tag, props: {}, style: {} }), createText: () => ({}),
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      const children = parent.children ||= [];
      const index = anchor ? children.indexOf(anchor) : -1;
      children.splice(index < 0 ? children.length : index, 0, node);
      node.parent = parent;
    },
    remove(node) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
    },
    setText() {}, setElementText() {}, patchProp(node, key, _previous, value) { node.props[key] = value; },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null
  });
  let state;
  let exposed;
  const originalSetup = module.exports.default.setup;
  if (render) module.exports.default.setup = (props, context) => {
    state = originalSetup(props, context);
    return state;
  };
  const app = renderer.createApp({ setup() {
    if (render) return () => vue.h(module.exports.default, props);
    state = module.exports.default.setup(props, { emit: vi.fn(), expose: value => { exposed = value; } });
    return () => null;
  } });
  if (render) {
    for (const name of ["v-btn", "v-icon", "v-card", "v-card-actions", "v-card-text"]) {
      app.component(name, { setup: (_, { slots }) => () => vue.h("span", slots.default?.()) });
    }
  }
  const root = {};
  app.mount(root);
  if (render) exposed = app._instance.subTree.component.exposed;
  return { app, root, state, exposed, props, voice, runtime, controls };
}

describe("Vibe64 direct session view", () => {
  it("blocks keyboard and button delivery while Main owns unsent speech without consuming the typed draft", async () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const owner = component.match(/async function sendComposerMessage\(\) \{[\s\S]*?\n\}/u)?.[0];
    expect(owner).toBeTruthy();
    const conversationView = vue.ref({ composerBlocked: true });
    const composerInput = vue.ref({ attachmentsCanSubmit: () => true });
    const stopTyping = vi.fn();
    const deliver = vi.fn(async () => "accepted");
    const submit = new Function("conversationView", "composerInput", "stopTypingOnSubmit", "submitComposerMessage", `${owner}\nreturn sendComposerMessage;`)(conversationView, composerInput, stopTyping, deliver);
    expect(await submit()).toBe(false);
    expect(stopTyping).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    conversationView.value.composerBlocked = false;
    composerInput.value.attachmentsCanSubmit = () => false;
    expect(await submit()).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
    composerInput.value.attachmentsCanSubmit = () => true;
    expect(await submit()).toBe("accepted");
    expect(stopTyping).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(component).toContain(':submit-enabled="composerCanSubmit && !composerBlocked"');
    expect(component).toContain(':disabled="!composerCanSubmit || composerBlocked || !attachmentState.canSubmit"');
    const footer = component.slice(component.indexOf('<div class="studio-autopilot__composer-delivery">'), component.indexOf('</div>', component.indexOf('<div class="studio-autopilot__composer-delivery">')));
    expect(footer.indexOf('aria-label="Stop"')).toBeLessThan(footer.indexOf('ref="composerSendButton"'));
    expect(footer).not.toContain('<Vibe64ProjectVoiceLauncher');
    expect(footer).not.toContain('VoiceConversationControls');
  });

  it("keeps Main avatar presentation passive and detaches the exact old view on navigation and unmount", async () => {
    const main = mountMainConversationLog();
    let unmounted = false;
    try {
      const binding = main.state.voiceBinding.value;
      expect(main.state.avatarSize.value).toBe("compact");
      main.state.showAvatar();
      expect(main.voice.open).not.toHaveBeenCalled();
      expect(binding.presentation).toBe("inline");
      expect(binding.adapter).toBe(main.state.adapter.value);
      expect(binding.adapter.conversation.turns).toEqual([]);
      main.props.voiceRuntime = main.runtime("other", "session-2");
      await vue.nextTick();
      expect(main.state.avatarSize.value).toBe("compact");
      expect(binding.presentation).toBe("dialog");
      expect(binding.adapter).toBeNull();
      expect(binding.captureContext()).toEqual({ actorKey: "learner", projectSlug: "one", sessionId: "session-1" });
      const current = main.state.voiceBinding.value;
      main.app.unmount();
      unmounted = true;
      expect(current.presentation).toBe("dialog");
      expect(current.adapter).toBeNull();
    } finally { if (!unmounted) main.app.unmount(); }
  });

  it("supplies live Main narration facts with access and page visibility independent of avatar collapse", async () => {
    const browserDocument = new EventTarget();
    browserDocument.visibilityState = "visible";
    vi.stubGlobal("document", browserDocument);
    const main = mountMainConversationLog();
    let unmounted = false;
    try {
      const runtime = main.props.voiceRuntime;
      const binding = main.state.voiceBinding.value;
      expect(binding.defaults.readAloud).toBe(true);
      expect(binding.narration).toMatchObject({ loading: false, working: false, eligible: true,
        vocalizeThinking: false, vocalizeInterimTurns: false, thinkingSounds: true });
      const turns = [{ turnId: "native-turn", messages: [{ role: "assistant", channel: "commentary", text: "Current work" }] }];
      runtime.conversationLog.turns = turns;
      runtime.conversationLog.loading = true;
      runtime.mounted.session.value.agentSession = { turn: { active: true } };
      expect(binding.narration.turns).toBe(turns);
      expect(binding.narration.loading).toBe(true);
      expect(binding.narration.working).toBe(true);
      main.state.avatarSize.value = "hidden";
      expect(binding.narration.eligible).toBe(true);
      browserDocument.visibilityState = "hidden";
      browserDocument.dispatchEvent(new Event("visibilitychange"));
      expect(binding.narration.eligible).toBe(false);
      browserDocument.visibilityState = "visible";
      browserDocument.dispatchEvent(new Event("visibilitychange"));
      expect(binding.narration.eligible).toBe(true);
      runtime.access.canUseChat.value = false;
      expect(binding.narration.eligible).toBe(false);
      runtime.access.canUseChat.value = true;
      main.props.voiceRuntime = main.runtime("other", "session-2");
      await vue.nextTick();
      expect(binding.narration.eligible).toBe(false);
      const current = main.state.voiceBinding.value;
      main.app.unmount();
      unmounted = true;
      expect(current.narration.eligible).toBe(false);
      browserDocument.visibilityState = "hidden";
      browserDocument.dispatchEvent(new Event("visibilitychange"));
      expect(main.state.pageVisible.value).toBe(true, "unmount removes the original page listener");
    } finally { if (!unmounted) main.app.unmount(); vi.unstubAllGlobals(); }
  });

  it("edits Main's unsent speech in its bubble without changing its native draft and gates uncertain admission", async () => {
    const main = mountMainConversationLog();
    try {
      const runtime = main.props.voiceRuntime;
      runtime.current = vue.ref(true);
      runtime.draft = vue.ref("");
      runtime.delivery = createAssistantMessageDelivery();
      const session = await main.state.openVoice();
      const binding = main.state.voiceBinding.value;
      session.takeTranscript = vi.fn(async () => {
        session.pendingTranscript.value = null;
        binding.onTranscript(null, { canTake: false });
        return true;
      });
      session.beginTranscriptEdit = vi.fn(async messageId => {
        session.pendingTranscript.value = { messageId, text: "Exact temporary words", editing: true };
        return true;
      });
      session.editTranscript = vi.fn((text, messageId) => {
        session.pendingTranscript.value = { ...session.pendingTranscript.value, text };
        binding.onTranscript({ id: messageId, text }, { canTake: true });
      });
      session.deliverTranscript = vi.fn(async () => {
        const pending = session.pendingTranscript.value;
        await runtime.delivery.send({ message: pending.text, request: { text: pending.text } },
          { messageId: pending.messageId, deliver: async () => ({ ok: true }) });
        session.pendingTranscript.value = null;
        binding.onTranscript(null, { canTake: false });
      });
      await runtime.delivery.send({ message: "Exact temporary words", request: { text: "Exact temporary words", steer: true } },
        { messageId: "unsent", deliver: async () => ({ ok: false, error: "No active turn" }) });
      expect(runtime.delivery.find("unsent").payload.request.steer).toBe(true);
      binding.onTranscript({ id: "unsent", text: "Exact temporary words" }, { canTake: true });
      const actions = main.state.adapter.value.conversation.previewMessage.actions;
      expect(actions.canEdit).toBe(true);
      runtime.draft.value = "Do not overwrite this draft";
      expect(main.state.adapter.value.conversation.previewMessage.actions.canEdit).toBe(true);
      expect(await actions.edit("stale")).toBe(false);
      expect(session.beginTranscriptEdit).not.toHaveBeenCalled();
      expect(await actions.edit("unsent")).toBe(true);
      expect(runtime.delivery.find("unsent")).toBeNull();
      expect(runtime.draft.value).toBe("Do not overwrite this draft");
      expect(main.state.adapter.value.conversation.previewMessage.text).toBe("Exact temporary words");
      expect(main.state.adapter.value.conversation.previewMessage.actions.editing).toBe(true);
      expect(actions.update("stale", "Wrong message")).toBe(false);
      expect(session.editTranscript).not.toHaveBeenCalled();
      expect(actions.update("unsent", "")).toBe(true);
      expect(main.state.adapter.value.conversation.previewMessage.text).toBe("");
      expect(main.state.adapter.value.conversation.previewMessage.actions.canSend).toBe(false);
      expect(await actions.send?.("unsent")).toBeUndefined();
      expect(await main.state.adapter.value.conversation.previewMessage.actions.send("unsent")).toBe(false);
      expect(session.deliverTranscript).not.toHaveBeenCalled();
      expect(actions.update("unsent", "Edited speech")).toBe(true);
      expect(main.state.adapter.value.conversation.previewMessage.actions.canSend).toBe(true);
      runtime.delivery.state.messages.push({ id: "uncertain", status: "uncertain" });
      expect(main.state.adapter.value.conversation.previewMessage.actions.canSend).toBe(false);
      expect(await main.state.adapter.value.conversation.previewMessage.actions.send("unsent")).toBe(false);
      runtime.delivery.state.messages.length = 0;
      expect(await main.state.adapter.value.conversation.previewMessage.actions.send("unsent")).toBe(true);
      expect(session.deliverTranscript).toHaveBeenCalledTimes(1);
      expect(runtime.delivery.find("unsent").payload.request).toEqual({ text: "Edited speech" });
      expect(main.state.adapter.value.conversation.previewMessage).toBeNull();
      expect(runtime.draft.value).toBe("Do not overwrite this draft");
      expect(main.state.adapter.value.conversation.turns).toEqual([]);
      await runtime.delivery.send({ message: "Discard this only", request: { text: "Discard this only", steer: true } },
        { messageId: "next", deliver: async () => ({ ok: false, error: "No active turn" }) });
      binding.onTranscript({ id: "next", text: "Discard this only" }, { canTake: true });
      runtime.delivery.state.messages.push({ id: "uncertain", status: "uncertain" });
      expect(main.state.adapter.value.conversation.previewMessage.actions.canDiscard).toBe(false);
      const calls = session.takeTranscript.mock.calls.length;
      expect(await main.state.adapter.value.conversation.previewMessage.actions.discard("next")).toBe(false);
      expect(session.takeTranscript).toHaveBeenCalledTimes(calls);
      runtime.delivery.state.messages.length = 0;
      expect(await main.state.adapter.value.conversation.previewMessage.actions.discard("next")).toBe(true);
      expect(runtime.delivery.find("next")).toBeNull();
      expect(runtime.draft.value).toBe("Do not overwrite this draft");
      expect(session.discardRecording).not.toHaveBeenCalled();
      expect(session.toggleHandsFree).not.toHaveBeenCalled();
      main.props.voiceRuntime = main.runtime("other", "session-2");
      binding.onTranscript({ id: "late", text: "Wrong target" }, { canTake: true });
      await vue.nextTick();
      expect(main.state.voiceTranscript.value).toBeNull();
    } finally { main.app.unmount(); }
  });

  it("edits speech through Main's original available facade without inventing a current ref", async () => {
    const main = mountMainConversationLog();
    try {
      const runtime = main.props.voiceRuntime;
      expect(runtime.current).toBeUndefined();
      runtime.draft = vue.ref("Keep native typed draft");
      runtime.delivery = createAssistantMessageDelivery();
      const session = await main.state.openVoice();
      const binding = main.state.voiceBinding.value;
      session.beginTranscriptEdit = vi.fn(async messageId => {
        session.pendingTranscript.value = { messageId, text: "Actual Main capture", editing: true };
        binding.onTranscript({ id: messageId, text: "Actual Main capture" }, { canTake: true });
        return true;
      });
      session.editTranscript = vi.fn((text, messageId) => {
        session.pendingTranscript.value = { ...session.pendingTranscript.value, text };
        binding.onTranscript({ id: messageId, text }, { canTake: true });
      });
      binding.onTranscript({ id: "captured-main", text: "Actual Main capture" }, { canTake: true });
      expect(await main.state.adapter.value.conversation.previewMessage.actions.edit("captured-main")).toBe(true);
      expect(session.beginTranscriptEdit).toHaveBeenCalledExactlyOnceWith("captured-main");
      const preview = main.state.adapter.value.conversation.previewMessage;
      expect(preview.actions.editing).toBe(true);
      expect(preview.actions.update("captured-main", "")).toBe(true);
      expect(main.state.adapter.value.conversation.previewMessage.text).toBe("");
      expect(main.state.adapter.value.conversation.previewMessage.actions.editing).toBe(true);
      expect(main.state.adapter.value.conversation.previewMessage.actions.canSend).toBe(false);
      runtime.available.value = false;
      expect(await main.state.adapter.value.conversation.previewMessage.actions.edit("captured-main")).toBe(false);
      expect(main.state.adapter.value.conversation.previewMessage.actions.update("captured-main", "Unavailable edit")).toBe(false);
      expect(session.beginTranscriptEdit).toHaveBeenCalledTimes(1);
      expect(runtime.draft.value).toBe("Keep native typed draft");
    } finally { main.app.unmount(); }
  });

  it("uses only the exact Main actor/project/session speech and keeps collapse independent of capture", async () => {
    const main = mountMainConversationLog({ render: true });
    try {
      const session = await main.state.openVoice();
      const binding = main.state.voiceBinding.value;
      expect(session).toBe(main.voice.controller.state.session);
      expect(main.state.composerBlocked.value).toBe(false);
      session.composerBlocked.value = true;
      expect(main.state.composerBlocked.value).toBe(true);
      expect(main.exposed.composerBlocked.value).toBe(true);
      session.voice.listening.value = true;
      session.voice.speaking.value = true;
      main.state.avatarSize.value = "hidden";
      await vue.nextTick();
      const indicators = () => {
        const pending = [main.root], found = [];
        while (pending.length) {
          const node = pending.pop();
          if (node.props?.role === "img") found.push(node);
          pending.push(...(node.children || []));
        }
        return found.sort((a, b) => a.props["aria-label"].localeCompare(b.props["aria-label"]));
      };
      expect(indicators().map(node => node.props["aria-label"])).toEqual(["Listening", "Speaking"]);
      for (const indicator of indicators()) {
        expect(indicator.tag).toBe("span");
        expect(indicator.props.title).toBe(indicator.props["aria-label"]);
        expect(Object.keys(indicator.props).some(key => key.startsWith("on"))).toBe(false);
        expect(indicator.props.tabindex).toBeUndefined();
      }
      session.microphoneMuted.value = true;
      await vue.nextTick();
      expect(indicators().map(node => node.props["aria-label"])).toEqual(["Speaking"]);
      session.voice.speaking.value = false;
      await vue.nextTick();
      expect(indicators()).toEqual([]);
      session.voice.speaking.value = true;
      session.microphoneMuted.value = false;
      main.state.avatarSize.value = "compact";
      await vue.nextTick();
      expect(indicators()).toEqual([]);
      main.state.avatarSize.value = "hidden";
      await vue.nextTick();
      expect(indicators()).toHaveLength(2);
      expect(session.voice.listening.value).toBe(true);
      expect(session.voice.speaking.value).toBe(true);
      expect(session.discardRecording).not.toHaveBeenCalled();
      expect(session.toggleHandsFree).not.toHaveBeenCalled();
      expect(session.finishPushToTalk).not.toHaveBeenCalled();
      expect(session.cancelPushToTalk).not.toHaveBeenCalled();
      for (const identity of [
        { actorKey: "other", projectSlug: "one", sessionId: "session-1" },
        { actorKey: "learner", projectSlug: "other", sessionId: "session-1" },
        { actorKey: "learner", projectSlug: "one", sessionId: "session-2" }
      ]) {
        main.voice.controller.state.binding = { ...binding, id: JSON.stringify(["project", identity.actorKey, identity.projectSlug, identity.sessionId]) };
        expect(main.state.voiceSession.value).toBeNull();
        expect(main.state.composerBlocked.value).toBe(false);
        await vue.nextTick();
        expect(indicators()).toEqual([]);
      }
      main.voice.controller.state.binding = { ...binding, conversationId: "another-conversation" };
      expect(main.state.voiceSession.value).toBeNull();
      await vue.nextTick();
      expect(indicators()).toEqual([]);
      expect(session.voice.listening.value).toBe(true);
      expect(session.voice.speaking.value).toBe(true);
      expect(session.discardRecording).not.toHaveBeenCalled();
    } finally { main.app.unmount(); }
  });

  it("keeps failed Main speech and newer capture separate through explicit recovery", async () => {
    for (const recovery of ["edit", "discard"]) {
      const main = mountMainConversationLog();
      try {
        const runtime = main.props.voiceRuntime;
        runtime.current = vue.ref(true);
        runtime.draft = vue.ref("Keep typed draft");
        runtime.delivery = createAssistantMessageDelivery();
        const session = await main.state.openVoice();
        const binding = main.state.voiceBinding.value;
        session.pendingTranscript.value = { messageId: "failed-a", text: "Failed A words", focus: { projectSlug: "original" } };
        session.takeTranscript = vi.fn(async messageId => {
          if (session.pendingTranscript.value?.messageId === messageId) session.pendingTranscript.value = null;
          else binding.onTranscript(null, { canTake: false });
          return true;
        });
        session.beginTranscriptEdit = vi.fn(async messageId => {
          if (session.pendingTranscript.value?.messageId !== messageId) return false;
          session.pendingTranscript.value = { ...session.pendingTranscript.value, editing: true };
          return true;
        });
        session.editTranscript = vi.fn((text, messageId) => {
          if (session.pendingTranscript.value?.messageId === messageId) session.pendingTranscript.value = { ...session.pendingTranscript.value, text };
        });
        session.deliverTranscript = vi.fn(async () => {
          const pending = session.pendingTranscript.value;
          await runtime.delivery.send({ message: pending.text, request: { text: pending.text } },
            { messageId: pending.messageId, deliver: async () => ({ ok: true }) });
          session.pendingTranscript.value = null;
        });
        await runtime.delivery.send({ message: "Failed A words", request: { text: "Failed A words", steer: true } },
          { messageId: "failed-a", deliver: async () => ({ ok: false, error: "No active turn" }) });
        binding.onTranscript({ id: "live-b", text: "Keep newer B words" }, { canTake: true });
        const previews = main.state.adapter.value.conversation.previewMessages;
        expect(previews.map(preview => preview.id)).toEqual(["failed-a", "live-b"]);
        expect(previews[0].actions.canEdit).toBe(true);
        expect(previews[1].actions.canEdit).toBe(false);
        expect(previews[1].actions.canDiscard).toBe(true);
        if (recovery === "edit") {
          expect(await previews[0].actions.edit("failed-a")).toBe(true);
          expect(runtime.delivery.find("failed-a")).toBeNull();
          expect(main.state.adapter.value.conversation.previewMessages[1].text).toBe("Keep newer B words");
          expect(previews[0].actions.update("failed-a", "Corrected A words")).toBe(true);
          expect(await main.state.adapter.value.conversation.previewMessages[0].actions.send("failed-a")).toBe(true);
          expect(runtime.delivery.find("failed-a").payload.request).toEqual({ text: "Corrected A words" });
        } else {
          expect(await previews[0].actions.discard("failed-a")).toBe(true);
          expect(runtime.delivery.find("failed-a")).toBeNull();
        }
        expect(main.state.adapter.value.conversation.previewMessages.map(preview => [preview.id, preview.text]))
          .toEqual([["live-b", "Keep newer B words"]]);
        expect(main.state.adapter.value.conversation.previewMessages[0].actions.canEdit).toBe(true);
        expect(runtime.draft.value).toBe("Keep typed draft");
        expect(main.props.turns).toEqual([]);
      } finally { main.app.unmount(); }
    }
  });

  it("keeps automatic speech admission out of the bubble's manual recovery controls", async () => {
    const main = mountMainConversationLog();
    try {
      const runtime = main.props.voiceRuntime;
      runtime.delivery = createAssistantMessageDelivery();
      const session = await main.state.openVoice();
      session.pendingTranscript.value = { messageId: "waiting-a", text: "First spoken words", reviewBeforeSend: false };
      session.sending.value = true;
      main.state.voiceBinding.value.onTranscript({ id: "capturing-b", text: "Second spoken words" }, { canTake: true });
      const previews = main.state.adapter.value.conversation.previewMessages;
      expect(previews.map(preview => preview.text)).toEqual(["First spoken words", "Second spoken words"]);
      expect(previews[0].actions.send).toBeNull();
      expect(previews[1].actions.send).toBeNull();
      expect(previews[0].actions.canEdit).toBe(false);
      session.sending.value = false;
      expect(main.state.adapter.value.conversation.previewMessages[0].actions.send).toBeTypeOf("function");
      expect(main.state.adapter.value.conversation.previewMessages[0].actions.canSend).toBe(true);
      session.pendingTranscript.value.reviewBeforeSend = true;
      session.sending.value = true;
      expect(main.state.adapter.value.conversation.previewMessages[0].actions.send).toBeTypeOf("function");
      expect(main.state.adapter.value.conversation.previewMessages[0].actions.canSend).toBe(false);
    } finally { main.app.unmount(); }
  });

  it("reports an idle Main voice failure locally and clears it on retry without borrowing another target's error", async () => {
    const main = mountMainConversationLog();
    try {
      main.voice.controller.state.error = "Another conversation's old failure";
      expect(main.state.voiceError.value).toBe("");
      main.voice.open.mockRejectedValueOnce(new Error("Main speech is unavailable. You can still type."));
      expect(await main.state.openVoice()).toBeNull();
      expect(main.state.voiceError.value).toBe("Main speech is unavailable. You can still type.");
      expect(main.state.adapter.value.conversation.visible).toBe(true);
      expect(await main.state.openVoice()).toBe(main.voice.controller.state.session);
      expect(main.state.voiceError.value).toBe("");
      const log = fs.readFileSync(path.resolve("src/components/studio/vibe64-session/Vibe64ConversationLog.vue"), "utf8");
      expect(log).toContain('!voice.controller.state.nextTarget');
      expect(log).toContain('v-if="voiceError && visible"');
      expect(log).toContain('title="click or long press to talk"');
    } finally { main.app.unmount(); }
  });

  it("toggles idle Main output without recording and uses only the matching session's speaker choice", async () => {
    const main = mountMainConversationLog();
    try {
      expect(main.state.readAloud.value).toBe(true);
      await main.state.toggleReadAloud();
      const session = main.voice.controller.state.session;
      expect(main.voice.open).toHaveBeenCalledTimes(1);
      expect(main.voice.open).toHaveBeenCalledWith(main.state.voiceBinding.value);
      expect(session.toggleReadAloud).toHaveBeenCalledTimes(1);
      expect(main.state.readAloud.value).toBe(false);
      expect(session.startPushToTalk).not.toHaveBeenCalled();
      expect(session.toggleHandsFree).not.toHaveBeenCalled();
      expect(session.voice.listening.value).toBe(false);
      await main.state.toggleReadAloud();
      expect(main.voice.open).toHaveBeenCalledTimes(1);
      expect(session.toggleReadAloud).toHaveBeenCalledTimes(2);
      expect(main.state.readAloud.value).toBe(true);

      main.voice.controller.state.binding = { ...main.state.voiceBinding.value, conversationId: "other" };
      main.voice.open.mockResolvedValueOnce(false);
      await main.state.toggleReadAloud();
      expect(session.toggleReadAloud).toHaveBeenCalledTimes(2);
      expect(session.startPushToTalk).not.toHaveBeenCalled();
      expect(session.toggleHandsFree).not.toHaveBeenCalled();
      const log = fs.readFileSync(path.resolve("src/components/studio/vibe64-session/Vibe64ConversationLog.vue"), "utf8");
      expect(log.match(/v-if="!voiceSession \|\| holdingVoice"/gu)).toHaveLength(3);
      expect(log).toContain(':icon="readAloud ? mdiVolumeHigh : mdiVolumeOff"');
    } finally { main.app.unmount(); }
  });

  it("honors saved idle output choice and fences only speaker toggles during a pending preference save", async () => {
    const main = mountMainConversationLog();
    const savedChoice = vue.ref(false);
    const saving = vue.ref(true);
    main.voice.readAloudFor.mockImplementation(() => savedChoice.value);
    main.voice.readAloudChangePendingFor.mockImplementation(() => saving.value);
    try {
      expect(main.state.readAloud.value).toBe(false);
      expect(main.state.readAloudChangePending.value).toBe(true);
      await main.state.toggleReadAloud();
      expect(main.voice.open).not.toHaveBeenCalled();
      expect(main.state.composerBlocked.value).toBe(false);
      expect(main.state.voiceBinding.value.available).toBe(true);
      saving.value = false;
      expect(main.state.readAloudChangePending.value).toBe(false);
      await main.state.toggleReadAloud();
      const session = main.voice.controller.state.session;
      expect(main.voice.open).toHaveBeenCalledTimes(1);
      expect(session.toggleReadAloud).toHaveBeenCalledTimes(1);
      expect(main.state.readAloud.value).toBe(true);
      saving.value = true;
      await main.state.toggleReadAloud();
      expect(session.toggleReadAloud).toHaveBeenCalledTimes(1);
      expect(main.state.composerBlocked.value).toBe(false);
      expect(session.startPushToTalk).not.toHaveBeenCalled();
      expect(session.toggleHandsFree).not.toHaveBeenCalled();
      expect(session.voice.listening.value).toBe(false);
    } finally { main.app.unmount(); }
  });

  it("uses the existing hold lifecycle and cancels a released recording while Main voice is still opening", async () => {
    vi.useFakeTimers();
    const main = mountMainConversationLog({ render: true });
    const pointer = { button: 0, pointerId: 7, currentTarget: { setPointerCapture() {} } };
    const microphoneIcon = () => {
      const nodes = [main.root];
      while (nodes.length) {
        const node = nodes.shift();
        if (["Talk", "Release to send"].includes(node.props?.["aria-label"])) return node.props.icon;
        nodes.push(...(node.children || []));
      }
    };
    try {
      expect(microphoneIcon()).toBe(mdi.mdiMicrophoneOff);
      main.state.voiceGesture.pointerDown(pointer);
      await vi.advanceTimersByTimeAsync(350);
      const session = main.voice.controller.state.session;
      expect(main.state.holdingVoice.value).toBe(true);
      expect(session.startPushToTalk).toHaveBeenCalledTimes(1);
      expect(microphoneIcon()).toBe(mdi.mdiMicrophoneOff);
      session.voice.listening.value = true;
      await vue.nextTick();
      expect(microphoneIcon()).toBe(mdi.mdiMicrophone);
      session.microphoneMuted.value = true;
      await vue.nextTick();
      expect(microphoneIcon()).toBe(mdi.mdiMicrophoneOff);
      main.state.voiceGesture.pointerUp(pointer);
      await vi.advanceTimersByTimeAsync(0);
      expect(session.finishPushToTalk).toHaveBeenCalledTimes(1);
      expect(main.state.holdingVoice.value).toBe(false);
      main.voice.controller.state.binding = null;
      main.voice.controller.state.session = null;
      const pending = Promise.withResolvers();
      const originalOpen = main.voice.open.getMockImplementation();
      main.voice.open.mockImplementation(async binding => { await pending.promise; return originalOpen(binding); });
      main.state.voiceGesture.pointerDown(pointer);
      await vi.advanceTimersByTimeAsync(350);
      main.state.voiceGesture.pointerUp(pointer);
      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(main.voice.controller.state.session.startPushToTalk).not.toHaveBeenCalled();
      expect(main.state.holdingVoice.value).toBe(false);
      main.voice.controller.state.binding = null;
      main.voice.controller.state.session = null;
      const navigation = Promise.withResolvers();
      main.voice.open.mockImplementation(async binding => { await navigation.promise; return originalOpen(binding); });
      main.state.voiceGesture.click({ detail: 0 });
      main.props.visible = false;
      navigation.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(main.voice.controller.state.session.toggleHandsFree).not.toHaveBeenCalled();
      const log = fs.readFileSync(path.resolve("src/components/studio/vibe64-session/Vibe64ConversationLog.vue"), "utf8");
      expect(log).toContain('v-if="!voiceSession || holdingVoice"');
    } finally {
      main.app.unmount();
      vi.useRealTimers();
    }
  });
  it("retains the original mounted Main hold while a target switch is awaiting the person's decision", async () => {
    vi.useFakeTimers();
    const main = mountMainConversationLog({ render: true });
    const pointer = { button: 0, pointerId: 7, currentTarget: { setPointerCapture() {} } };
    let unmounted = false;
    try {
      const session = await main.state.openVoice();
      await vue.nextTick();
      expect(main.controls).toHaveLength(1);
      const controls = main.controls[0];
      controls.gesture.pointerDown(pointer);
      await vi.advanceTimersByTimeAsync(350);
      expect(session.startPushToTalk).toHaveBeenCalledTimes(1);
      session.composerBlocked.value = true;
      main.voice.controller.state.nextTarget = { id: "colleague" };
      await vue.nextTick();
      expect(session.cancelPushToTalk).not.toHaveBeenCalled();
      expect(controls.gesture.holding.value).toBe(true);
      main.voice.controller.state.nextTarget = null;
      await vue.nextTick();
      expect(main.controls).toHaveLength(1);
      controls.gesture.pointerUp(pointer);
      await vi.advanceTimersByTimeAsync(0);
      expect(session.finishPushToTalk).toHaveBeenCalledTimes(1);
      expect(session.cancelPushToTalk).not.toHaveBeenCalled();

      controls.gesture.pointerDown(pointer);
      await vi.advanceTimersByTimeAsync(350);
      controls.gesture.cancel({ type: "blur" });
      await vi.advanceTimersByTimeAsync(0);
      expect(session.cancelPushToTalk).toHaveBeenCalledTimes(1);
      controls.gesture.pointerDown(pointer);
      await vi.advanceTimersByTimeAsync(350);
      main.app.unmount();
      unmounted = true;
      await vi.advanceTimersByTimeAsync(0);
      expect(session.cancelPushToTalk).toHaveBeenCalledTimes(2);
    } finally {
      if (!unmounted) main.app.unmount();
      vi.useRealTimers();
    }
  });

  it("uses one shared Fix it with AI control for every Temporary AI recovery launcher", () => {
    const autopilot = fs.readFileSync(componentPath, "utf8");
    const outputControls = fs.readFileSync(
      path.resolve("src/components/studio/Vibe64OutputControls.vue"),
      "utf8"
    );
    const repository = fs.readFileSync(
      path.resolve("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      "utf8"
    );
    const fixAction = fs.readFileSync(temporaryAiFixActionPath, "utf8");

    expect(autopilot.match(/<Vibe64TemporaryAiFixAction/gu)).toHaveLength(2);
    expect(outputControls.match(/<Vibe64TemporaryAiFixAction/gu)).toHaveLength(1);
    expect(repository.match(/<Vibe64TemporaryAiFixAction/gu)).toHaveLength(1);
    expect([autopilot, outputControls, repository].join("\n")).not.toContain(
      "Fix with temporary AI"
    );
    expect(fixAction).toContain('aria-label="Fix it with AI"');
    expect(fixAction).toContain('{{ pending ? "Opening…" : "Fix it with AI" }}');
  });

  it("is chat-first and contains no workflow state-machine surface", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const retiredNames = [
      "AutopilotNavigation",
      "WorkflowControlForm",
      "SessionCurrentStep",
      "SessionTimeline",
      "ReportPreview",
      "SessionRecoveryNotice",
      "StepInputDisplayFields",
      "activateWorkflowButtonControl",
      "runNextOperation",
      "rewindToAutopilotStep"
    ];

    expect(component).toContain("<Vibe64ConversationLog");
    expect(component).toContain(':welcome-message="emptyConversationWelcome"');
    expect(component).toContain(':source-operations-suspended="sourceOperationsSuspended"');
    expect(component).not.toContain(':source-operations-suspended="sourceOperationsSuspended || agentActive"');
    expect(component).toContain(':busy="agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"');
    expect(component).toContain("<Vibe64AutopilotPromptTextarea");
    for (const retiredName of retiredNames) {
      expect(component).not.toContain(retiredName);
      expect(composable).not.toContain(retiredName);
    }
  });

  it("offers native confirmed Save with temporary action output, not an AI prompt", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const combined = `${component}\n${composable}`;

    expect(composable).toContain("saveWorkActionLabel");
    expect(component).toContain('v-if="saveWorkHeaderVisible"');
    expect(component).toContain("saveWorkHeaderAriaLabel");
    expect(component).not.toContain("saveWorkHeaderLabel");
    expect(component).not.toContain("saveWorkTeleportTarget");
    expect(component).toContain(':aria-busy="saveWorkSending ? \'true\' : undefined"');
    expect(component).not.toContain(':loading="saveWorkSending"');
    expect(component).toContain(":icon=\"mdiIncognito\"");
    expect(component).toContain("@click=\"confirmSaveWork\"");
    expect(component).toContain("<Vibe64TemporaryActionTerminal");
    expect(component.indexOf("<Vibe64TemporaryActionTerminal")).toBeLessThan(
      component.indexOf("<Vibe64ConversationLog")
    );
    expect(component).toContain('#error-actions');
    expect(component).toContain("saveWorkRequiresUpdate ? 'warning' : (saveWorkUnsaved ? 'primary' : undefined)");
    expect(composable).toContain("const result = await props.saveSessionWork({ destinationReview: saveWorkReview.value });");
    expect(composable).toContain("const result = await props.updateSessionWork(input);");
    expect(composable).toContain("const saveWorkUnsaved = computed");
    expect(composable).toContain("const saveWorkOperationActive = computed");
    expect(component).toContain('class="studio-autopilot__activity"');
    expect(component).toContain(".studio-autopilot__activity:empty");
    expect(composable).toContain("Vibe64—not Temporary AI—owns every repository operation");
    expect(component).toContain(':disabled="repositoryRecoverySending || !(saveWorkActivityIsUpdate ? assistantSeniorAllowed : assistantJuniorAllowed)"');
    expect(component).toContain(":title=\"(saveWorkActivityIsUpdate ? assistantSeniorAllowed : assistantJuniorAllowed) ? 'Open temporary AI to resolve this repository problem' : saveWorkActivityIsUpdate ? assistantSeniorRestrictionMessage : assistantJuniorRestrictionMessage\"");
    expect(component).toContain(":title=\"assistantJuniorAllowed ? 'Open temporary AI to resolve workspace preparation' : assistantJuniorRestrictionMessage\"");
    expect(component).toContain("assistantDirectAllowed: assistantDirectAllowed.value");
    expect(component).toContain("assistantRestrictionMessage: assistantRestrictionMessage.value");
    expect(composable).toContain("Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase");
    expect(composable).toContain("leave both byte-for-byte unchanged");
    expect(composable).toContain("Resolve only by editing the conflicting working-tree files");
    expect(composable).toContain("Preserve the intended behavior of both the latest saved work and this session");
    expect(component).toContain('@click="requestSessionSaveWork"');
    expect(component).toContain('@check-update="checkTemporaryAiUpdate"');
    expect(component).toContain("temporaryAiWorkspace.value?.updateRepairTask");
    expect(component).toContain("{ force: true }");
    expect(component).toContain(':active="saveWorkOperationActive || saveWorkSending"');
    expect(component).toContain(':dismissed="saveWorkActivityDismissed || updateHandledInRepair"');
    expect(component).toContain(':operation-key="saveWorkActivityKey"');
    expect(component).toContain('@dismiss="dismissSaveWorkActivity"');
    expect(composable).toContain("SHORT_ACTION_DISMISSALS_STORAGE_PREFIX");
    expect(composable).not.toContain("SAVE_WORK_PROMPT");
    expect(combined).not.toMatch(/runGit|executeGit|merge pr|finish session/iu);
    expect(component).toContain("sessionGithubActor.displayLabel");
    expect(component).toContain(":to=\"props.githubActorTeleportTarget\"");
    expect(composable).toContain("sessionGithubCommandActor(props.session || {})");
    expect(composable).toContain("sessionGithubActor.value.available");
    const sessionHeader = component.slice(
      component.indexOf('<header class="studio-autopilot__session-header">'),
      component.indexOf("</header>")
    );
    expect(sessionHeader).toContain("studio-autopilot__save-work");
    expect(sessionHeader).toContain('<v-icon v-if="saveWorkRequiresUpdate" :icon="mdiSourceCommit" />');
    expect(sessionHeader).toContain('v-else-if="props.workState?.destination?.mode === \'github\'"');
    expect(sessionHeader).toContain('class="studio-autopilot__save-symbol-commit"');
    expect(sessionHeader).toContain('<v-icon v-else :icon="mdiContentSaveOutline" />');
    expect(sessionHeader).toContain('height="48"');
    expect(sessionHeader).toContain('width="48"');
    expect(sessionHeader).not.toContain("studio-autopilot__save-work-label");
  });

  it("keeps temporary AI separate, restorable, multi-task, and attachment-owned", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const temporaryAi = fs.readFileSync(temporaryAiPath, "utf8");
    const temporaryAiComposable = fs.readFileSync(temporaryAiComposablePath, "utf8");
    const temporaryAiFixAction = fs.readFileSync(temporaryAiFixActionPath, "utf8");

    expect(component).toContain("Open temporary AI");
    expect(component).toContain("<Vibe64TemporaryAiFixAction");
    expect(temporaryAiFixAction).toContain("Fix it with AI");
    expect(component).toContain("<Vibe64TemporaryAiWorkspace");
    expect(temporaryAi).toContain("grid-row: 3 / -1");
    expect(temporaryAi).not.toContain("position: sticky");
    expect(temporaryAi.indexOf("data-temporary-ai-check-update")).toBeLessThan(
      temporaryAi.indexOf("<Vibe64EphemeralConversationMessages")
    );
    expect(component).toContain("temporaryAiWorkspace.value?.showWorkspace?.()");
    // Switching sessions retains the temporary workspace; Main chat closes it.
    expect(component).not.toContain("activateRealSession");
    expect(component).toContain("@select-main-chat=\"showMainChat\"");
    expect(component).toContain("@task-finished=\"finishTemporaryAiTask\"");
    expect(component).toContain("reportTaskRecovery");
    expect(component).toContain("Workspace preparation succeeded. Vibe64 independently verified the AI repair.");
    expect(component).toContain("temporaryAiWorkspace.value?.closeWorkspace?.()");
    expect(component).toContain("mainChat.value?.focus?.({ preventScroll: true })");
    expect(temporaryAi).toContain("Main chat");
    expect(temporaryAi).toContain("data-temporary-ai-main-chat");
    expect(temporaryAi).toContain("Main and temporary conversations");
    expect(temporaryAi).toContain('aria-label="New temporary AI task"');
    expect(temporaryAi).toContain("function showWorkspace()");
    expect(temporaryAi).toContain("startTask");
    expect(temporaryAi).not.toContain("Not saved to session history");
    expect(temporaryAi).not.toContain("vibe64-temporary-ai__header");
    expect(temporaryAi).not.toMatch(/R\/W|R\/O|updatePolicy/u);
    expect(temporaryAi).not.toContain("Read-only guidance");
    expect(temporaryAi).not.toContain("Allow edits");
    expect(temporaryAi).toContain('v-for="task in temporary.tasks.value"');
    expect(temporaryAi).toContain("<Vibe64AgentSettingsMenu");
    expect(temporaryAi).toContain("<Vibe64AutopilotPromptTextarea");
    expect(temporaryAi).toContain("data-temporary-ai-recovery");
    expect(temporaryAi).toContain("AI repair in progress");
    expect(temporaryAi).toContain("The repair was independently verified.");
    expect(temporaryAi).toContain("activeTaskRecoveryStatus");
    expect(temporaryAi).toContain("AI is working…");
    expect(temporaryAi).toContain('class="vibe64-temporary-ai__activity"');
    expect(temporaryAi).toContain('role="status"');
    expect(temporaryAi).toContain("vibe64.temporary-ai.feedback");
    expect(temporaryAi).toContain("finished. Review the result before continuing.");
    expect(temporaryAi).toContain('aria-label="Attach preview screenshot"');
    expect(temporaryAi).toContain('aria-label="Attach console and network diagnostics"');
    expect(temporaryAi).toContain("previewAttachmentState.capture?.()");
    expect(temporaryAi).toContain("previewAttachmentState.attachDiagnostics?.()");
    expect(temporaryAiComposable).not.toContain("beforeunload");
    expect(temporaryAiComposable).toContain("watch([currentSessionId, currentSessionsApiPath, actorKey, () => readRefOrGetterValue(assistantReady)]");
    expect(temporaryAiComposable).toContain("() => void restoreTasks(), { immediate: true });");
    expect(temporaryAiComposable).toContain("for (const taskId of saveTimers.keys()) void saveTask(taskId);");
    expect(temporaryAiComposable).toContain("attachmentIds: task.attachments.map((attachment) => attachment.attachmentId)");
    expect(temporaryAiComposable).toContain("attachments: record.attachments || []");
    expect(temporaryAiComposable).toContain("function showWorkspace()");
    expect(temporaryAiComposable).toContain("async function startTask(options = {})");
    expect(temporaryAiComposable).toContain("if (tasks.value.length === 0)");
    expect(temporaryAiComposable).toContain("useAssistantConversationFactory");
    expect(temporaryAiComposable).toContain("temporaryAiMessages(runtime.turns.value)");
    expect(temporaryAiComposable).toContain("displayMessage: draftPayload.displayMessage");
    expect(temporaryAiComposable).not.toMatch(/localStorage|sessionStorage/gu);
  });

  it("keeps direct files, subsystems, preview, terminal, and close controls", () => {
    const component = fs.readFileSync(componentPath, "utf8");

    expect(component).toContain("<Vibe64SessionToolbar");
    expect(component).toContain(":archive=\"props.sessionArchive\"");
    expect(component).toContain("<Vibe64SessionFiles");
    expect(component).toContain("<Vibe64SubsystemsView");
    expect(component).toContain("<Vibe64OutputControls");
    expect(component).toContain("name=\"ai-terminal\"");
    expect(component).not.toContain("Session tools");
    expect(component).not.toContain("mdiDotsHorizontal");
  });

  it("offers preview attachments as ordinary direct-chat controls", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");

    expect(component).toContain("aria-label=\"Attach visible preview\"");
    expect(component).toContain("aria-label=\"Attach console & network\"");
    expect(component).toContain("@preview-attachment-state=\"updatePreviewAttachmentState\"");
    expect(component).not.toContain("Composer menu");
    expect(promptTextarea).toContain("const attachmentCommands = useVibe64AttachmentCommands();");
    expect(promptTextarea).toContain("canUpload: () => props.attachmentsEnabled && !props.disabled");
    expect(promptTextarea).toContain("onError: attachmentFeedback.error");
    expect(promptTextarea).toContain('source: "vibe64.agent-attachment.upload.feedback"');
    expect(promptTextarea).not.toContain("attachments.status.value");
    expect(promptTextarea).not.toContain("Attachments are disabled for this prompt.");
  });

  it("labels active-turn messages as compact steering", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const promptHints = fs.readFileSync(promptHintsPath, "utf8");
    const composerActions = fs.readFileSync(sharedComposerActionsPath, "utf8");

    expect(component).toContain('v-if="agentStopVisible"');
    expect(component).toContain(':disabled="!agentStopEnabled"');
    expect(component).toContain(':aria-label="composerSubmitAriaLabel"');
    expect(component).toContain("composerSubmitMode === 'send' ? mdiSend");
    expect(component).toContain(':aria-busy="composerSending && !composerCanSubmit ? \'true\' : undefined"');
    expect(component).toContain('@click="sendComposerMessage"');
    expect(component).toContain('@click="requestAgentInterrupt"');
    expect(composerActions).toContain(':aria-busy="state.pending && !state.canSend ? \'true\' : undefined"');
    expect(composerActions).toContain(':aria-busy="state.stopPending ? \'true\' : undefined"');
    expect(composerActions).not.toContain(":loading=");
    expect(composerActions).toContain('v-if="state.canStop"');
    expect(composerActions).toContain("{{ state.stopPending ? 'Stopping…' : 'Stop' }}");
    expect(component).toContain(':described-by="composerSupportStatusVisible ? thinkingStatusId : \'\'"');
    expect(component).toContain("<AssistantComposerSupport");
    expect(promptHints).toContain("@media (prefers-reduced-motion: reduce)");
    expect(composable).toContain('waiting: "Waiting…"');
    expect(composable).toContain('steering: "Steering…"');
    expect(composable).toContain('retry: "Retry"');
    expect(composable).toContain('state) === "active"');
    expect(composable).toContain('props.agentConnectionStatus === "connected"');
    expect(composable).not.toContain("Send guidance while the assistant is working.");
  });

  it("requires complete compact structured answers while preserving free-form escape", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const questions = fs.readFileSync(path.resolve("node_modules/@jskit-ai/assistant-core/src/client/conversation/AssistantQuestionInputs.vue"), "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");

    expect(component).toContain("<AssistantQuestionInputs")
    expect(questions).toContain("<v-select");
    expect(questions).toContain('item-title="selectLabel"');
    expect(component).toContain(':select-items="numberedQuestionSelectItems"');
    expect(questions).not.toContain("#selection=");
    expect(questions).toContain("Answer normally instead");
    expect(questions).toContain(':prepend-icon="mdiPencilOutline"');
    expect(component.match(/:disabled="!composerCanSubmit \|\| composerBlocked \|\| !attachmentState\.canSubmit"/gu)).toHaveLength(1);
    expect(composable).toContain('const NUMBERED_QUESTION_UNSURE_VALUE = "I am not sure";');
    expect(composable).toContain("numberedQuestions.value.every");
  });

  it("passes only direct chat and tool state through the runtime host", () => {
    const runtimeHost = fs.readFileSync(runtimeHostPath, "utf8");
    const runtimeHostComposable = fs.readFileSync(
      path.resolve("src/composables/useVibe64SessionRuntimeHost.js"),
      "utf8"
    );
    const conversationRuntimeComposable = fs.readFileSync(
      path.resolve("src/composables/useVibe64ConversationRuntime.js"),
      "utf8"
    );

    expect(runtimeHost).toContain(":send-agent-message=\"sendAgentMessage\"");
    expect(runtimeHost).toContain(":conversation-log=\"conversationLog\"");
    expect(runtimeHost).toContain(":retry-workspace-setup=\"retryWorkspaceSetup\"");
    expect(runtimeHost).toContain(":save-session-work=\"saveSessionWork\"");
    expect(runtimeHost).toContain(":update-session-work=\"updateSessionWork\"");
    expect(runtimeHost).toContain(":work-state=\"workState\"");
    expect(runtimeHost).toContain("sessions: props.toolbarSessions");
    expect(runtimeHost).not.toContain(":source-safety=\"sourceSafety\"");
    expect(runtimeHost).not.toContain(":autopilot-steps=");
    expect(runtimeHost).not.toContain(":automation-enabled=");
    expect(runtimeHost).not.toContain(":report-preview=");
    expect(runtimeHost).not.toContain(":rewind-to-step=");
    expect(runtimeHost).not.toContain(":actions=");
    expect(runtimeHostComposable).toContain(
      "return conversationRuntime.value?.sendAgentMessage(input) ?? false;"
    );
    expect(conversationRuntimeComposable).toContain(
      'void mounted.refresh({ reason: "agent-message-accepted" }).catch(() => {});'
    );
    expect(conversationRuntimeComposable).not.toContain(
      'await mounted.refresh({ reason: "agent-message-accepted" })'
    );
  });

  it("keeps workspace preparation status in chat while routing recovery to Temporary AI", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");

    const chatStart = component.indexOf("class=\"studio-autopilot__chat-panel\"");
    const projectStart = component.indexOf("class=\"studio-autopilot__project-panel\"");
    const activityStart = component.indexOf('aria-label="Session activity"');
    const conversationStart = component.indexOf("<Vibe64ConversationLog");

    expect(activityStart).toBeGreaterThan(chatStart);
    expect(activityStart).toBeLessThan(conversationStart);
    expect(conversationStart).toBeLessThan(projectStart);
    expect(component).toContain(':title="workspaceSetupTitle"');
    expect(component).toContain("<Vibe64TemporaryAiFixAction");
    expect(component).toContain('@retry="retryWorkspaceSetup"');
    expect(component).not.toContain(':error-messages="composerError"');
    expect(composable).toContain("requestTemporaryAi({");
    expect(composable).not.toContain('policy: "workspace_write"');
    expect(composable).toContain("handleTemporaryAiTaskFinished");
    expect(composable).toContain("Vibe64 will automatically rerun its deterministic workspace preparation");
    expect(composable.match(/recoveryNotice: TEMPORARY_AI_RECOVERY_NOTICE/gu)).toHaveLength(4);
    expect(composable).not.toContain("sendChatPayload(chatMessagePayload(workspaceSetupFixPrompt");
    expect(component).not.toMatch(/workspace.*(?:dialog|stepper)|(?:dialog|stepper).*workspace/iu);
  });

  it("turns a rejected managed preview identity into a Temporary AI repair request", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const launchControls = fs.readFileSync(
      path.resolve("src/components/studio/Vibe64OutputControls.vue"),
      "utf8"
    );

    expect(component).toContain(":ask-codex-to-fix-preview-identity=\"assistantJuniorAllowed ? askCodexToFixPreviewIdentity : null\"");
    expect(launchControls).toContain("previewIdentityFixAvailable");
    expect(launchControls).toContain("<Vibe64TemporaryAiFixAction");
    expect(launchControls).toContain("previewIdentityFixSending");
    expect(composable).not.toContain("sendChatPayload(chatMessagePayload(previewIdentityFixPrompt(input)))");
    expect(composable).toContain("app-owned, idempotent development seed");
    expect(composable).toContain("Keep preview authentication material host-managed");
  });

  it("uses multiline Enter and moves Tab directly from chat input to Send", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");
    const sharedPromptInput = fs.readFileSync(sharedPromptInputPath, "utf8");

    expect(component).toContain("tab-to-submit");
    expect(component).toContain(':submit-enabled="composerCanSubmit && !composerBlocked"');
    expect(component).toContain("@tab-to-submit=\"focusComposerSendButton\"");
    expect(component).not.toContain("submit-on-enter");
    expect(composable).not.toContain("Enter sends. Shift+Enter adds a line.");
    expect(promptTextarea).toContain("<AssistantPromptInput");
    expect(promptTextarea).toContain('@tab-to-submit="emit(\'tab-to-submit\')"');
    expect(sharedPromptInput).toContain('event.key === "Enter" && !props.submitOnEnter');
    expect(sharedPromptInput).toContain("props.submitEnabled");
    expect(sharedPromptInput).toContain("event.stopPropagation()");
  });

});


it("projects actual source availability without suppressing suspended Working controls", () => {
  const source = fs.readFileSync(composablePath, "utf8");
  const expression = source.match(/const saveWorkHeaderVisible = computed\(\(\) => Boolean\(([\s\S]*?)\n  \)\);/u)?.[1];
  expect(expression).toBeTruthy();
  const visible = new Function("props", "sessionId", `return Boolean(${expression});`);
  for (const suspended of [true, false]) {
    const props = { active: true, sourceOperationsSuspended: suspended };
    expect(visible(props, vue.ref("working"))).toBe(true);
    expect(visible({ ...props, sourceWorkspaceAvailable: true }, vue.ref("working"))).toBe(true);
    expect(visible({ ...props, sourceWorkspaceAvailable: false }, vue.ref("learning"))).toBe(false);
  }
  expect(visible({ active: false }, vue.ref("working"))).toBe(false);
  const component = fs.readFileSync(componentPath, "utf8");
  expect(component).toContain('v-if="props.sourceWorkspaceAvailable || props.sessionRenewal?.visible"');
  const temporary = component.slice(component.indexOf('<Vibe64TemporaryAiWorkspace'), component.indexOf('/>', component.indexOf('<Vibe64TemporaryAiWorkspace')));
  expect(temporary).toContain('v-if="props.sourceWorkspaceAvailable"');
  const presentation = component.slice(component.indexOf('<TrainingPreviewPresentation'), component.indexOf('</TrainingPreviewPresentation>'));
  expect(presentation).toContain('v-if="props.sourceWorkspaceAvailable"');
  expect(component).toContain('v-if="!props.sourceWorkspaceAvailable"');
  expect(component).toContain('aria-label="Lessons"');
  expect(fs.readFileSync(runtimeHostPath, "utf8")).toContain(':source-workspace-available="sourceWorkspaceAvailable"');
});
