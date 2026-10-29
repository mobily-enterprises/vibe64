import { createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ accounts: null, providers: null, connections: null, requestOnboarding: null }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useModelRouting.js", () => ({
  useModelRouting: () => ({ connectedWorkflows: ref([{ engineId: "codex", connected: true }, { engineId: "opencode", connected: true }]) })
}));
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
vi.mock("../../packages/vibe64-accounts/src/client/onboarding/aiOnboardingEvents.js", () => ({
  aiOnboardingAvailable: ref(true),
  requestVibe64AiOnboarding: (...args) => mocks.requestOnboarding(...args)
}));
import { useAiConnectionManager } from "../../packages/vibe64-accounts/src/client/composables/useAiConnectionManager.js";

let app;
function mount() {
  const renderer = createRenderer({ createComment: text => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ setup: () => useAiConnectionManager({ isOwner: true }), render: () => null });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
const engineGroup = (state, id) => state.configuredAiGroups.find(group => group.id === id);
beforeEach(() => {
  vi.stubGlobal("document", { activeElement: {} });
  mocks.requestOnboarding = vi.fn();
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
    connections: ref([{ id: "opencode", preferred: true }]),
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

it("groups configured pairs by orchestrator", () => {
  const state = mount();
  expect(state.configuredAiGroups.map(group => [group.label, group.accounts.map(account => account.id)])).toEqual([
    ["Claude Code", ["claude", "deepseek", "zai-coding-plan", "zai"]],
    ["Codex", ["codex", "deepseek", "zai-coding-plan", "zai"]],
    ["OpenCode", ["opencode"]]
  ]);
  expect(state.configuredAiGroups[2].accounts[0]).toMatchObject({ id: "opencode", preferred: true });
  expect(state.nativeChoices).toEqual([]);
  expect(state.canAddConnection).toBe(false);
});

it("names the Claude plan Claude, as AI setup does, beside DeepSeek in the Claude Code group", () => {
  const state = mount();
  expect(engineGroup(state, "claude").accounts.slice(0, 2).map(({ id, providerLabel }) => [id, providerLabel])).toEqual([
    ["claude", "Claude"], ["deepseek", "DeepSeek"]
  ]);
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
  const account = engineGroup(state, "codex").accounts[0];
  expect(account).toMatchObject({ id: "codex", keyHint: "Reconnect required", connected: false });
  state.manageConfiguredAi(account);
  expect(state.nativeSetupOrigin).toBe("manage");
  expect(state.nativeModelProviderId).toBe("openai");
});

it("names Codex's own sign-in's provider OpenAI in its row and in Add a connection", () => {
  expect(engineGroup(mount(), "codex").accounts[0]).toMatchObject({ id: "codex", providerLabel: "OpenAI" });
  app.unmount();
  mocks.accounts.status.value.accounts[0] = { id: "codex", connected: false, status: "missing" };
  const offered = mount().nativeChoices.find(({ id }) => id === "codex").providers[0];
  expect(offered).toMatchObject({ id: "openai", label: "OpenAI", description: "ChatGPT login or OpenAI API key" });
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

it("carries GPT's actual access scope for the host and does not guess when it is unavailable", () => {
  const state = mount();
  expect(engineGroup(state, "codex").accounts[0].ownerOnly).toBe(true);
  mocks.accounts.status.value.accounts[0].ownerOnly = false;
  expect(engineGroup(state, "codex").accounts[0].ownerOnly).toBe(false);
  delete mocks.accounts.status.value.accounts[0].ownerOnly;
  expect(engineGroup(state, "codex").accounts[0].ownerOnly).toBeUndefined();
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
  expect(engineGroup(state, "codex").accounts.map(account => account.id)).toEqual(["codex"]);
  const account = engineGroup(state, "claude").accounts.find(account => account.id === "deepseek");
  expect(account).toMatchObject({ connected: false, keyHint: "Reconnect required" });
  state.manageConfiguredAi(account);
  expect(state.nativeSetupProviderId).toBe("claude");
});

it("removes only the selected orchestrator key through its existing owner", async () => {
  const state = mount();
  const account = engineGroup(state, "claude").accounts.find(account => account.id === "deepseek");
  state.requestRemove(account);
  await state.confirmRemove();
  expect(mocks.providers.change).toHaveBeenCalledExactlyOnceWith({ engineId: "claude", modelProviderId: "deepseek", remove: true });
  expect(state.removeOpen).toBe(false);
});

it("is idle with no provider id saving, removing or changing model access", () => {
  Object.assign(mocks.connections, {
    removingProviderId: ref(""), savingProviderId: ref(""), updatingModelAccessProviderId: ref("")
  });
  const state = mount();
  expect([state.removeTarget, state.modelAccessTarget].map(Boolean)).toEqual([false, false]);
  expect([state.removeRunning, state.modelAccessRunning, state.editorSaving, state.busy]).toEqual([false, false, false, false]);
  mocks.connections.removingProviderId.value = "zai";
  state.requestRemove({ id: "zai", kind: "opencode", engineId: "opencode" });
  expect(state.busy).toBe(true);
});

it("reports busy while a removal runs so Redo onboarding cannot interrupt it", () => {
  const state = mount();
  expect(state.busy).toBe(false);
  mocks.providers.busy.value = true;
  expect(state.busy).toBe(true);
});
