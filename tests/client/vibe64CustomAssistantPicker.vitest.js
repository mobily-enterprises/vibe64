import { computed, createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ engines: null, loading: null, error: null, save: null, catalogOptions: [],
  modelLoading: null, modelError: null, modelRevisions: null }));
vi.mock("@/composables/useVibe64AssistantCatalog.js", () => ({
  useVibe64AssistantCatalog(options) {
    mocks.catalogOptions.push(options);
    return { engines: mocks.engines, apiPath: ref("/api/assistants"),
      selectedOverviewEngine: computed(() => mocks.engines.value.find(row => row.engineId === (options.engineId?.value || options.engineId))),
      modelEngine: computed(() => {
        const engineId = options.engineId?.value || options.engineId;
        const providerId = options.modelProviderId?.value || options.modelProviderId;
        const engine = mocks.engines.value.find(row => row.engineId === engineId);
        return engine && providerId ? { ...engine,
          revision: mocks.modelRevisions.value[`${engineId}:${providerId}`] || engine.revision,
          modelProviders: engine.modelProviders.filter(row => row.id === providerId) } : null;
      }),
      modelPage: { isInitialLoading: mocks.modelLoading, loadError: mocks.modelError },
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
  mocks.modelLoading = ref(false); mocks.modelError = ref(""); mocks.modelRevisions = ref({});
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

it("applies Claude external choices with their provider revision while retaining the warmed full-model list", async () => {
  const claude = { ...mocks.engines.value[0], engineId: "claude", label: "Claude",
    agents: [{ id: "claude", mode: "primary" }], defaults: { agentId: "claude", modelProviderId: "zai", modelId: "glm" } };
  mocks.engines.value.push(claude);
  const scopedRevision = `sha256:${"b".repeat(64)}`;
  mocks.modelRevisions.value["claude:zai"] = scopedRevision;
  const state = mount(); state.menuOpen = true; await nextTick();
  state.selectEngine("claude"); await nextTick();
  expect(state.modelRows.map(row => row.modelProviderId)).toEqual(["zai", "other"]);
  const options = mocks.catalogOptions.find(row => row.engineId === "claude");
  expect(options.allConnectedModels).toBe(true);
  expect(options.modelProviderId.value).toBe("zai");
  expect(state.canSave).toBe(true);
  expect(state.draftSelection.catalogRevision).toBe(scopedRevision);
  await state.save();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ assistantSelection: expect.objectContaining({
    engineId: "claude", modelProviderId: "zai", agentId: "claude", modelId: "glm", catalogRevision: scopedRevision
  }) }));
});

it("blocks Apply while the selected provider loads or fails and uses its refreshed revision on retry", async () => {
  const state = mount(); state.menuOpen = true; await nextTick();
  mocks.modelLoading.value = true; await nextTick();
  expect(state.canSave).toBe(false);
  await state.save(); expect(mocks.save).not.toHaveBeenCalled();
  mocks.modelLoading.value = false; mocks.modelError.value = "Provider catalogue unavailable"; await nextTick();
  expect(state.canSave).toBe(false);
  expect(state.catalogError).toBe("Provider catalogue unavailable");
  await state.save(); expect(mocks.save).not.toHaveBeenCalled();
  const refreshedRevision = `sha256:${"c".repeat(64)}`;
  mocks.modelRevisions.value["opencode:zai"] = refreshedRevision;
  mocks.modelError.value = ""; await nextTick();
  expect(state.canSave).toBe(true);
  await state.save();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ assistantSelection: expect.objectContaining({
    catalogRevision: refreshedRevision
  }) }));
});
