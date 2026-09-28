import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { transform } from "esbuild";

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
  const module = { exports: {} };
  const imports = {
    vue,
    "@jskit-ai/shell-web/client/error": { useShellWebErrorRuntime: () => ({ report: notice => notices.push(notice) }) },
    "@jskit-ai/assistant-core/client/conversation": { AssistantConversationElement: {} },
    "@jskit-ai/assistant-core/shared/conversation": { conversationTurnsFromMessages: () => [] },
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
    state = module.exports.default.setup(props, { expose() {} });
    return () => null;
  } });
  app.mount({});
  t.after(() => { app.unmount(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  return { state, notices };
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); await vue.nextTick(); }
