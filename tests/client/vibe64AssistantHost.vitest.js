import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { createAssistantTextSubmission } from "@jskit-ai/assistant-core/client/conversation-submit";
import { afterEach, expect, it, vi } from "vitest";
import { VIBE64_ASSISTANT_HOST_KEY } from "../../src/lib/vibe64AssistantHost.js";

const source = readFileSync(new URL(
  "../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue", import.meta.url
), "utf8");
const layerSource = source.slice(source.indexOf("const assistantHost = inject("), source.indexOf("</script>"));
const unmounts = [];
afterEach(() => { while (unmounts.length) unmounts.pop()(); });

function mountLayer() {
  const host = Vue.shallowRef(null);
  const props = Vue.reactive({ active: true, sessionSelectionArchived: false });
  const temporaryAiWorkspace = Vue.ref({ visible: false });
  const composerDraft = Vue.ref("");
  const composerCanSubmit = Vue.ref(false);
  const sendComposerMessage = vi.fn(async () => true);
  const bindings = {
    computed: Vue.computed, inject: Vue.inject, nextTick: Vue.nextTick,
    onBeforeUnmount: Vue.onBeforeUnmount, reactive: Vue.reactive, ref: Vue.ref, watchEffect: Vue.watchEffect,
    VIBE64_ASSISTANT_HOST_KEY, createAssistantTextSubmission, props,
    temporaryAiWorkspace, composerDraft, composerCanSubmit, sendComposerMessage,
    sessionId: Vue.ref("session-a"), chatTurns: Vue.ref([]), agentActive: Vue.ref(false),
    composerSending: Vue.ref(false), composerInput: Vue.ref(null)
  };
  const setupLayer = new Function(...Object.keys(bindings), `${layerSource}\nreturn assistantLayer;`);
  let layer;
  const renderer = Vue.createRenderer({
    createComment: () => ({}), insert() {}, remove() {},
    parentNode: () => null, nextSibling: () => null
  });
  const app = renderer.createApp({ setup() { layer = setupLayer(...Object.values(bindings)); return () => null; } });
  app.provide(VIBE64_ASSISTANT_HOST_KEY, host);
  app.mount({});
  unmounts.push(() => app.unmount());
  return { host, props, temporaryAiWorkspace, composerDraft, composerCanSubmit, sendComposerMessage, layer };
}

it("withdraws Main's companion layer while another conversation is selected", async () => {
  const view = mountLayer();
  expect(view.host.value).toBe(view.layer);
  view.temporaryAiWorkspace.value.visible = true;
  await Vue.nextTick();
  expect(view.host.value).toBeNull();
  await expect(view.layer.submitText("Hidden draft", { sendImmediately: false })).rejects.toThrow("not ready");
  expect(view.composerDraft.value).toBe("");
  expect(view.sendComposerMessage).not.toHaveBeenCalled();
  view.temporaryAiWorkspace.value.visible = false;
  await Vue.nextTick();
  expect(view.host.value).toBe(view.layer);
  expect(await view.layer.submitText("Visible draft", { sendImmediately: false })).toBe("draft");
  expect(view.composerDraft.value).toBe("Visible draft");
});

it("keeps a pending voice draft unsent when another conversation opens", async () => {
  const view = mountLayer();
  const submission = view.layer.submitText("Pending voice words").catch((error) => error);
  await Vue.nextTick();
  expect(view.composerDraft.value).toBe("Pending voice words");
  view.temporaryAiWorkspace.value.visible = true;
  view.composerCanSubmit.value = true;
  expect(await submission).toBeInstanceOf(Error);
  expect(view.sendComposerMessage).not.toHaveBeenCalled();
  expect(view.composerDraft.value).toBe("Pending voice words");
});

it.each(["inactive", "archived"])("does not publish or accept voice for an %s session", async (state) => {
  const view = mountLayer();
  if (state === "inactive") view.props.active = false;
  else view.props.sessionSelectionArchived = true;
  await Vue.nextTick();
  expect(view.host.value).toBeNull();
  await expect(view.layer.submitText("Late words")).rejects.toThrow("not ready");
  expect(view.composerDraft.value).toBe("");
  expect(view.sendComposerMessage).not.toHaveBeenCalled();
});
