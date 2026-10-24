import { createRenderer, nextTick, ssrContextKey } from "vue";
import { expect, it, onTestFinished, vi } from "vitest";

const fixture = vi.hoisted(() => ({ paths: [], command: vi.fn(), hideCatalog: null, revision: null, reloads: 0 }));
vi.mock("@jskit-ai/assistant-core/client/conversation", () => ({
  AssistantModelControl: { render: () => null }
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: () => ({ run: fixture.command }) }));
vi.mock("@/composables/useVibe64AssistantCatalog.js", async () => {
  const { computed, ref, unref } = await import("vue");
  fixture.hideCatalog = ref(false);
  fixture.revision = ref("current");
  const engines = ["codex", "claude"].map((engineId) => ({
    engineId, label: engineId, revision: "current", health: { status: "ready" },
    defaults: { agentId: engineId, modelProviderId: "provider", modelId: `${engineId}-model` },
    agents: [{ id: engineId, mode: "primary" }],
    modelProviders: [{ id: "provider", connected: true, models: [{ id: `${engineId}-model`, status: "available", variants: [] }] }]
  }));
  return { useVibe64AssistantCatalog(options) {
    fixture.paths.push(unref(options.path));
    const selected = computed(() => fixture.hideCatalog.value ? null
      : { ...engines.find((engine) => engine.engineId === unref(options.engineId)), revision: fixture.revision.value });
    const page = () => ({ isInitialLoading: ref(false), loadError: ref("") });
    return { engines: ref(engines), selectedOverviewEngine: selected, modelEngine: selected, providerEngine: selected,
      overview: page(), modelPage: page(), providerPage: page(), reload: async () => { fixture.reloads += 1; }, apiPath: ref(unref(options.path)) };
  } };
});
import ModelPicker from "../../src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";

it("Colleague reuses the picker without a session and polling cannot replace an unapplied choice", async () => {
  const savedSelection = { engineId: "codex", modelProviderId: "provider", modelId: "codex-model", agentId: "codex", variantId: "" };
  const saveSelection = vi.fn(async () => ({ ok: true }));
  const props = { modelValue: true, selection: savedSelection, catalogPath: "/api/vibe64/colleague/models", saveSelection };
  const renderer = createRenderer({
    createComment: () => ({}), createElement: () => ({}), createText: () => ({}),
    insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {},
    parentNode: () => null, nextSibling: () => null
  });
  const app = renderer.createApp({ ...ModelPicker, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.config.warnHandler = () => {};
  onTestFinished(() => app.unmount());
  app.mount({});
  const state = app._instance.setupState;
  await nextTick();
  fixture.hideCatalog.value = true;
  state.selectEngine("claude");
  await nextTick();
  expect(state.engineId).toBe("claude");
  fixture.hideCatalog.value = false;
  await nextTick();
  expect(state.canSave).toBe(true);
  app._instance.props.selection = { ...savedSelection };
  await nextTick();
  expect(state.engineId).toBe("claude");
  expect(state.modelId).toBe("claude-model");
  await state.save();
  expect(saveSelection).toHaveBeenCalledWith(expect.objectContaining({ engineId: "claude", modelId: "claude-model", catalogRevision: "current" }));
  expect(fixture.command).not.toHaveBeenCalled();
  expect(fixture.paths.length).toBeGreaterThan(1);
  expect(fixture.paths.every((path) => path === "/api/vibe64/colleague/models")).toBe(true);
});

it("a refused save shows the current catalogue so the retry carries its revision", async () => {
  const savedSelection = { engineId: "codex", modelProviderId: "provider", modelId: "codex-model", agentId: "codex", variantId: "" };
  const saveSelection = vi.fn(async ({ catalogRevision }) => catalogRevision === "fresh" ? { ok: true }
    : { ok: false, error: "The assistant catalog changed. Review the current choices and try again." });
  const renderer = createRenderer({
    createComment: () => ({}), createElement: () => ({}), createText: () => ({}),
    insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {},
    parentNode: () => null, nextSibling: () => null
  });
  const app = renderer.createApp({ ...ModelPicker, render: () => null },
    { modelValue: true, selection: savedSelection, catalogPath: "/api/vibe64/colleague/models", saveSelection });
  app.provide(ssrContextKey, { modules: new Set() });
  app.config.warnHandler = () => {};
  onTestFinished(() => app.unmount());
  app.mount({});
  const state = app._instance.setupState;
  await nextTick();
  state.selectEngine("claude");
  await nextTick();
  const before = fixture.reloads;
  await state.save();
  expect(state.saveError).toContain("catalog changed");
  expect(fixture.reloads).toBeGreaterThan(before);
  fixture.revision.value = "fresh";
  await nextTick();
  await state.save();
  expect(saveSelection).toHaveBeenLastCalledWith(expect.objectContaining({ engineId: "claude", catalogRevision: "fresh" }));
});
