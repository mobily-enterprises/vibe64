import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { afterEach, expect, it } from "vitest";
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
  const bindings = {
    computed: Vue.computed, inject: Vue.inject,
    onBeforeUnmount: Vue.onBeforeUnmount, reactive: Vue.reactive, watchEffect: Vue.watchEffect,
    VIBE64_ASSISTANT_HOST_KEY, props, temporaryAiWorkspace, sessionId: Vue.ref("session-a")
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
  return { host, props, temporaryAiWorkspace, layer };
}

it("withdraws Main's companion layer while another conversation is selected", async () => {
  const view = mountLayer();
  expect(view.host.value).toBe(view.layer);
  view.temporaryAiWorkspace.value.visible = true;
  await Vue.nextTick();
  expect(view.host.value).toBeNull();
  view.temporaryAiWorkspace.value.visible = false;
  await Vue.nextTick();
  expect(view.host.value).toBe(view.layer);
});

it.each(["inactive", "archived"])("does not publish Main's companion layer for an %s session", async (state) => {
  const view = mountLayer();
  if (state === "inactive") view.props.active = false;
  else view.props.sessionSelectionArchived = true;
  await Vue.nextTick();
  expect(view.host.value).toBeNull();
});
