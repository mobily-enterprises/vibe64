import { computed, createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ engines: null, loading: null, error: null, save: null, catalogOptions: [] }));
vi.mock("@/composables/useVibe64AssistantCatalog.js", () => ({
  useVibe64AssistantCatalog(options) {
    mocks.catalogOptions.push(options);
    return { engines: mocks.engines, apiPath: ref("/api/assistants"),
      selectedOverviewEngine: computed(() => mocks.engines.value.find(row => row.engineId === (options.engineId?.value || options.engineId))),
      overview: { isInitialLoading: mocks.loading, loadError: mocks.error }, reload: vi.fn() };
  }
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: () => ({ run: (...args) => mocks.save(...args) }) }));
vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({ requestVibe64AccountConnectionsDialog: vi.fn() }));
import Menu from "../../src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";

let app;
afterEach(() => app?.unmount());
const selection = { engineId: "opencode", agentId: "build", modelProviderId: "zai", modelId: "glm", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
beforeEach(() => {
  mocks.loading = ref(false); mocks.error = ref(""); mocks.save = vi.fn(async () => ({ ok: true })); mocks.catalogOptions = [];
  mocks.engines = ref(["opencode", "codex"].map(engineId => ({ engineId, label: engineId, revision: selection.catalogRevision,
    health: { status: "ready" }, defaults: { agentId: "build", modelProviderId: "zai", modelId: "glm" },
    agents: [{ id: "build", mode: "primary" }], modelProviders: ["zai", "other"].map(id => ({
      id, connected: true, label: id, models: [
        { id: "glm", label: "GLM", status: "available", variants: [{ id: "high", label: "High" }] },
        { id: "paid", label: "Paid", status: "locked", variants: [] }
      ]
    })) })));
});
function mount({ mode = "auto", saved = selection, disabled = false, saveSelection } = {}) {
  const open = ref(false);
  const session = { sessionId: "one", assistantSelection: saved, metadata: { assistant_routing: JSON.stringify({ mode, workflowEngineId: saved.engineId,
    ...(mode === "custom" ? { override: saved } : {}) }) } };
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...Menu, render: () => null }, { modelValue: open.value, session,
    changesDisabled: disabled, sessionsApiPath: "/api/sessions", saveSelection });
  app.provide(ssrContextKey, { modules: new Set() }); app.mount({});
  return app._instance.setupState;
}
it("can leave Auto with the same model; saves exactly the chosen engine, provider, model and effort", async () => {
  const state = mount(); state.menuOpen = true; await nextTick();
  expect(state.canSave).toBe(true);
  expect(state.modelRows.map(row => row.modelProviderId)).toEqual(["zai", "other"]);
  state.selectEngine("codex"); await nextTick();
  state.selectModel(JSON.stringify(["other", "glm"])); await nextTick();
  state.selectVariant("high"); await nextTick();
  expect(state.draftSelection).toMatchObject({ engineId: "codex", modelId: "glm", variantId: "high" });
  expect(mocks.save).not.toHaveBeenCalled();
  await state.save();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ assistantSelection: expect.objectContaining({
    engineId: "codex", modelProviderId: "other", modelId: "glm", variantId: "high"
  }) }));
  expect(state.menuOpen).toBe(false);
});
it("keeps failed saves visible and permits retry", async () => {
  const state = mount(); state.menuOpen = true; await nextTick();
  mocks.save.mockRejectedValueOnce(new Error("Reconnect Codex"));
  await state.save(); expect(state.saveError).toBe("Reconnect Codex"); expect(state.menuOpen).toBe(true);
  await state.save(); expect(state.saveError).toBe(""); expect(state.menuOpen).toBe(false);
});
it("only recovers an unavailable provider in the draft, and Cancel discards it", async () => {
  const state = mount({ saved: { ...selection, modelProviderId: "removed" } });
  state.menuOpen = true; await nextTick();
  expect(state.modelProviderId).toBe("zai"); expect(mocks.save).not.toHaveBeenCalled();
  state.selectModel(JSON.stringify(["other", "glm"])); state.menuOpen = false; await nextTick();
  state.menuOpen = true; await nextTick(); expect(state.modelProviderId).toBe("zai");
  expect(mocks.save).not.toHaveBeenCalled();
});
it("does not discover catalogues while closed and refuses unavailable or busy choices", async () => {
  const state = mount(); expect(mocks.catalogOptions[0].active.value).toBe(false);
  state.menuOpen = true; await nextTick(); expect(mocks.catalogOptions[0].active.value).toBe(true);
  mocks.error.value = "Catalogue unavailable"; await nextTick(); expect(state.canSave).toBe(false);
  await state.save(); expect(mocks.save).not.toHaveBeenCalled();
});
it("uses the temporary conversation save callback with the same exact selection", async () => {
  const saveSelection = vi.fn(async () => ({ ok: true }));
  const state = mount({ saveSelection }); state.menuOpen = true; await nextTick(); await state.save();
  expect(saveSelection).toHaveBeenCalledWith(expect.objectContaining(selection)); expect(mocks.save).not.toHaveBeenCalled();
});

it("warms connected orchestrators together while open, leaving disconnected engines alone", async () => {
  const state = mount(); state.menuOpen = true; await nextTick();
  expect(mocks.catalogOptions.filter(options => options.allConnectedModels && options.active.value).map(options => options.engineId).sort())
    .toEqual(["codex", "opencode"]);
  state.menuOpen = false; await nextTick();
  expect(mocks.catalogOptions.some(options => options.active.value)).toBe(false);
});
