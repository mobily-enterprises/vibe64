import { createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ accounts: null, providers: null, connections: null }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("vuetify", () => ({ useDisplay: () => ({ smAndDown: ref(false) }) }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useVibe64Accounts.js", () => ({
  useVibe64Accounts: () => mocks.accounts
}));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useCodexProviderConnections.js", () => ({
  useCodexProviderConnections: () => mocks.providers
}));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useAiConnections.js", () => ({
  useAiConnections: () => mocks.connections
}));
vi.mock("../../packages/vibe64-accounts/src/client/studio/NativeProviderConnections.vue", () => ({ default: {} }));
vi.mock("../../packages/vibe64-accounts/src/client/studio/ModelRoutingForm.vue", () => ({ default: {} }));
vi.mock("../../packages/vibe64-accounts/src/client/studio/ProviderAccountsSetup.vue", () => ({ default: {} }));
vi.mock("../../packages/vibe64-accounts/src/client/studio/FreeAiSelector.vue", () => ({ default: {} }));
import AiConnectionsSettings from "../../packages/vibe64-accounts/src/client/studio/AiConnectionsSettings.vue";

let app;
function mount() {
  const renderer = createRenderer({ createComment: text => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...AiConnectionsSettings, render: () => null }, { isOwner: true });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
beforeEach(() => {
  vi.stubGlobal("document", { activeElement: {} });
  mocks.accounts = {
    status: ref({ accounts: [{ id: "codex", connected: true, ownerOnly: true }, { id: "claude", connected: true }] }),
    isLoading: ref(false), loadError: ref("")
  };
  mocks.providers = {
    connections: ref(["deepseek", "zai-coding-plan", "zai"].map(id => ({
      id, status: "connected", connected: true, claudeReady: true, configuredEngines: ["codex", "claude"]
    }))),
    busy: ref(false), loadError: ref(""), change: vi.fn().mockResolvedValue({ ok: true }),
    resource: { isInitialLoading: ref(false), reload: vi.fn() }
  };
  mocks.connections = {
    connections: ref([{ id: "opencode", builtIn: true, preferred: true, removable: false }]),
    catalogEngine: ref(null), catalogProvider: ref(null), catalogLoadError: ref(""),
    isInitialLoading: ref(false), loadError: ref(""), registryProviders: ref([]),
    registryIsInitialLoading: ref(false), registryIsFetching: ref(false), registryLoadError: ref(""),
    registryLoaded: ref(true), reloadRegistry: vi.fn().mockResolvedValue({}),
    removingProviderId: ref(""), savingProviderId: ref(""), updatingModelAccessProviderId: ref("")
  };
});
afterEach(() => {
  app?.unmount();
  vi.unstubAllGlobals();
});

it("groups configured pairs by orchestrator and retains the included default", () => {
  const state = mount();
  expect(state.configuredAiGroups.map(group => [group.label, group.accounts.map(account => account.id)])).toEqual([
    ["Codex", ["codex", "deepseek", "zai-coding-plan", "zai"]],
    ["Claude Code", ["claude", "deepseek", "zai-coding-plan", "zai"]],
    ["OpenCode", ["opencode"]]
  ]);
  expect(state.configuredAiGroups[2].accounts[0]).toMatchObject({ builtIn: true, preferred: true, removable: false });
  expect(state.nativeChoices).toEqual([]);
  expect(state.canAddConnection).toBe(false);
});

it("opens settings for the exact orchestrator and provider without checking or changing a key", () => {
  const state = mount();
  for (const engine of ["codex", "claude"]) {
    const group = state.configuredAiGroups.find(group => group.id === engine);
    for (const account of group.accounts) {
      state.manageConfiguredAi(account);
      expect(state.nativeSetupProviderId).toBe(engine);
      expect(state.nativeModelProviderId).toBe(account.kind === "codex-provider" ? account.id : engine === "claude" ? "anthropic" : "openai");
      expect(state.nativeSetupOpen).toBe(true);
      expect(state.nativeSetupOrigin).toBe("manage");
      expect(state.nativeProviderPickerOpen).toBe(false);
    }
  }
  expect(mocks.providers.change).not.toHaveBeenCalled();
});

it("offers only missing pairs, then opens a fixed Add form and returns to its provider list", () => {
  mocks.providers.connections.value.find(({ id }) => id === "deepseek").configuredEngines = ["codex"];
  const state = mount();
  expect(state.nativeChoices.map(({ id, providers }) => [id, providers.map(({ id }) => id)])).toEqual([
    ["claude", ["deepseek"]]
  ]);
  state.chooseAiType("codex");
  expect(state.nativeProviderPickerOpen).toBe(false);
  state.chooseAiType("claude");
  expect(state.nativeProviderPickerOpen).toBe(true);
  expect(state.nativeSetupOpen).toBe(false);
  state.chooseNativeProvider("zai-coding-plan");
  expect(state.nativeSetupOpen).toBe(false);
  state.chooseNativeProvider("deepseek");
  expect(state.nativeSetupOrigin).toBe("add");
  expect(state.nativeSetupProviderId).toBe("claude");
  expect(state.nativeModelProviderId).toBe("deepseek");
  expect(state.nativeSetupOpen).toBe(true);
  state.backFromNativeSetup();
  expect(state.nativeSetupOpen).toBe(false);
  expect(state.nativeProviderPickerOpen).toBe(true);
  expect(mocks.providers.change).not.toHaveBeenCalled();
});

it("keeps native login reconnection under Manage instead of offering it as new", () => {
  mocks.accounts.status.value.accounts[0] = { id: "codex", connected: false, status: "reconnect_required" };
  const state = mount();
  expect(state.nativeChoices).toEqual([]);
  const account = state.configuredAiGroups[0].accounts[0];
  expect(account).toMatchObject({ id: "codex", keyHint: "Reconnect required", connected: false });
  state.manageConfiguredAi(account);
  expect(state.nativeSetupOrigin).toBe("manage");
  expect(state.nativeModelProviderId).toBe("openai");
});

it("updates Add availability with warm connection data and refreshed OpenCode providers", async () => {
  const state = mount();
  state.addAiOpen = true;
  await nextTick();
  expect(mocks.connections.reloadRegistry).toHaveBeenCalledOnce();
  mocks.connections.registryProviders.value = [{ id: "opencode", defaultModelId: "big-pickle" }];
  expect(state.openCodeAddAvailable).toBe(false);
  mocks.connections.registryProviders.value.push({ id: "zai", defaultModelId: "glm-4.7-flash" });
  expect(state.canAddConnection).toBe(true);
  mocks.connections.connections.value.push({ id: "zai", connected: true });
  expect(state.canAddConnection).toBe(false);
  mocks.providers.connections.value = mocks.providers.connections.value.filter(({ id }) => id !== "zai");
  expect(state.nativeChoices.map(({ providers }) => providers.map(({ id }) => id))).toEqual([["zai"], ["zai"]]);
  expect(state.canAddConnection).toBe(true);
});

it("does not mistake an unloaded or failed OpenCode catalogue for exhaustion", () => {
  mocks.connections.registryLoaded.value = false;
  const state = mount();
  expect(state.canAddConnection).toBe(true);
  mocks.connections.registryLoaded.value = true;
  mocks.connections.registryLoadError.value = "Try again";
  expect(state.canAddConnection).toBe(true);
});

it("does not turn a stale Add choice into replacement of an existing OpenCode connection", async () => {
  const state = mount();
  await state.chooseProvider({ id: "opencode" }, { origin: "provider-picker" });
  expect(state.editorOpen).toBe(false);
  expect(state.preparingProviderId).toBe("");
});

it("shows GPT's actual access scope and does not guess when it is unavailable", () => {
  const state = mount();
  expect(state.configuredAiGroups[0].accounts[0].accessLabel).toBe("Personal use");
  mocks.accounts.status.value.accounts[0].ownerOnly = false;
  expect(state.configuredAiGroups[0].accounts[0].accessLabel).toBe("Workspace use");
  delete mocks.accounts.status.value.accounts[0].ownerOnly;
  expect(state.configuredAiGroups[0].accounts[0].accessLabel).toBe("");
});

it("shows a Claude-only provider without creating an empty Codex group", () => {
  mocks.accounts.status.value.accounts = [];
  mocks.providers.connections.value = [{ id: "deepseek", status: "connected", connected: false, claudeReady: true, configuredEngines: ["claude"] }];
  const state = mount();
  expect(state.configuredAiGroups.map(group => group.id)).toEqual(["claude", "opencode"]);
  const [account] = state.configuredAiGroups[0].accounts;
  expect(account.connected).toBe(true);
  state.manageConfiguredAi(account);
  expect(state.nativeSetupProviderId).toBe("claude");
});

it("keeps unavailable configured pairs in their own groups for reconnection", () => {
  mocks.providers.connections.value = [{ id: "deepseek", status: "reconnect_required", connected: false, claudeReady: false, configuredEngines: ["claude"] }];
  const state = mount();
  expect(state.configuredAiGroups[0].accounts.map(account => account.id)).toEqual(["codex"]);
  const account = state.configuredAiGroups[1].accounts.find(account => account.id === "deepseek");
  expect(account).toMatchObject({ connected: false, keyHint: "Reconnect required" });
  state.manageConfiguredAi(account);
  expect(state.nativeSetupProviderId).toBe("claude");
});

it("removes a shared key through its existing owner regardless of the selected group", async () => {
  const state = mount();
  const account = state.configuredAiGroups[1].accounts.find(account => account.id === "deepseek");
  state.requestRemove(account);
  await state.confirmRemove();
  expect(mocks.providers.change).toHaveBeenCalledExactlyOnceWith({ modelProviderId: "deepseek", remove: true });
  expect(state.removeOpen).toBe(false);
});
