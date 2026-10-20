import { readFile } from "node:fs/promises";
import { createRenderer, effectScope, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";

const mocks = vi.hoisted(() => ({ route: null, accounts: null, curated: null, openCode: null, routing: null, colleague: null }));
vi.mock("vue-router", () => ({ useRoute: () => mocks.route }));
vi.mock("vuetify", () => ({ useDisplay: () => ({ xs: ref(false) }) }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useVibe64Accounts.js", () => ({ useVibe64Accounts: () => mocks.accounts }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useCodexProviderConnections.js", () => ({
  useCodexProviderConnections: () => mocks.curated
}));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useAiConnections.js", () => ({ useAiConnections: () => mocks.openCode }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useModelRouting.js", async (importOriginal) => ({
  routingSuggestsChanges: (await importOriginal()).routingSuggestsChanges,
  useModelRouting: ({ workflowsOnly }) => workflowsOnly ? mocks.routing.workflows : mocks.routing.configuration
}));
vi.mock("../../packages/vibe64-accounts/src/client/studio/AIAccountsSetup.vue", () => ({ default: {} }));
vi.mock("../../packages/vibe64-accounts/src/client/studio/ModelRoutingForm.vue", () => ({ default: {} }));
vi.mock("../../packages/vibe64-accounts/src/client/studio/NativeProviderConnections.vue", () => ({ default: {} }));

import { registerVibe64ColleagueModel } from "../../src/lib/vibe64ColleagueModelBridge.js";
import { AI_ONBOARDING_PROVIDERS } from "../../packages/vibe64-accounts/src/client/onboarding/aiOnboardingProviders.js";
import { aiOnboardingAvailable, aiOnboardingBlocked, aiOnboardingNeeded, onVibe64AiOnboardingRequested, requestVibe64AiOnboarding }
  from "../../packages/vibe64-accounts/src/client/onboarding/aiOnboardingEvents.js";
import { aiIsSetUp, aiOnboardingConnections, aiOnboardingSnoozed, snoozeAiOnboarding, useAiOnboarding }
  from "../../packages/vibe64-accounts/src/client/onboarding/useAiOnboarding.js";
import AiOnboarding from "../../packages/vibe64-accounts/src/client/onboarding/AiOnboarding.vue";
import AiOnboardingHost from "../../packages/vibe64-accounts/src/client/onboarding/AiOnboardingHost.vue";

const empty = { accounts: [], curated: [], openCode: [] };
const BIG_PICKLE = { id: "opencode", modelProviderId: "opencode", builtIn: true, connected: true };
const claude = AI_ONBOARDING_PROVIDERS.find(({ id }) => id === "claude");
const deepseek = AI_ONBOARDING_PROVIDERS.find(({ id }) => id === "deepseek");
const glm = AI_ONBOARDING_PROVIDERS.find(({ id }) => id === "glm");
const ENGINE_LABELS = { claude: "Claude Code", codex: "Codex" };
const SENIOR_PROVIDERS = { claude: "anthropic", codex: "openai" };
let unregisterColleague = () => null;

let app;
let storage;
function mount(component, props) {
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...component, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
const resource = (data) => ({ data: ref(data), reload: vi.fn().mockResolvedValue({}) });

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
  } }));
  vi.stubGlobal("document", { activeElement: null, querySelector: () => null });
  mocks.route = { path: "/app", query: {} };
  mocks.accounts = { status: ref({ accounts: [{ id: "github", connected: true }, { id: "claude", connected: false }, { id: "codex", connected: false }] }),
    loadError: ref(""), statusResource: { reload: vi.fn().mockResolvedValue({}) } };
  mocks.curated = { resource: resource({ providers: CURATED_CODEX_PROVIDERS.map(({ id }) => ({ id, connected: false, claudeReady: false })) }),
    loadError: ref("") };
  mocks.openCode = { connections: ref([BIG_PICKLE]), loadError: ref(""), isInitialLoading: ref(false), reload: vi.fn().mockResolvedValue({}) };
  const workflows = ref([]);
  const engines = ref([]);
  mocks.routing = { workflows: { resource: { reload: vi.fn().mockResolvedValue({}) }, workflows },
    configuration: { resource: { reload: vi.fn().mockResolvedValue({}) }, engines } };
  // A mounted Colleague as the real bridge sees it: the workflow's routed Senior,
  // refused when that Senior uses another provider.
  const selection = ref(null);
  const labelled = () => ({ selection: selection.value, engineLabel: ENGINE_LABELS[selection.value.engineId],
    modelLabel: selection.value.modelId });
  mocks.colleague = { selection, seniorProviders: { ...SENIOR_PROVIDERS },
    current: vi.fn(async () => selection.value ? labelled() : null),
    selectForWorkflow: vi.fn(async ({ engineId, modelProviderId }) => {
      if (mocks.colleague.seniorProviders[engineId] !== modelProviderId) return { ok: false, error: "Its Senior uses another provider." };
      selection.value = { engineId, modelProviderId, modelId: `${engineId}-model` };
      return { ok: true, ...labelled() };
    }) };
  unregisterColleague = registerVibe64ColleagueModel(mocks.colleague);
});
afterEach(() => {
  unregisterColleague();
  app?.unmount();
  app = null;
  vi.unstubAllGlobals();
});

describe("provider data", () => {
  it("routes every card through an existing provider with the matching access", () => {
    expect(AI_ONBOARDING_PROVIDERS.map(({ id, rank }) => [id, rank])).toEqual([["claude", 1], ["codex", 2], ["deepseek", 3], ["glm", 4]]);
    for (const { connect } of AI_ONBOARDING_PROVIDERS) {
      const curated = CURATED_CODEX_PROVIDERS.find(({ id }) => id === connect.modelProviderId);
      expect(curated || ["anthropic", "openai"].includes(connect.modelProviderId)).toBeTruthy();
      expect(connect.access).toBe(!curated || curated.ownerOnly ? "personal" : "workspace");
      expect(["codex", "claude"]).toContain(connect.engineId);
    }
  });

  it("keeps the recommended spend text and names the plan beside it", () => {
    expect(claude).toMatchObject({ crown: true, plan: { name: "Claude Pro", headline: "Recommended: $30/month" } });
    expect(AI_ONBOARDING_PROVIDERS.find(({ id }) => id === "glm")).toMatchObject({
      plan: { name: "GLM Coding Plan", headline: "Recommended: $30/month plan" },
      note: "There's no point in getting it if you can get Claude for the same price."
    });
    expect(AI_ONBOARDING_PROVIDERS.filter(({ crown }) => crown)).toHaveLength(1);
  });
});

describe("set-up rule", () => {
  it("does not count the built-in starter or non-AI accounts as set up", () => {
    expect(aiIsSetUp({ ...empty, accounts: [{ id: "github", connected: true }], openCode: [BIG_PICKLE] })).toBe(false);
  });

  it("does not count the free regular Z.AI starter or a failed connection as set up", () => {
    expect(aiIsSetUp({ ...empty, openCode: [{ modelProviderId: "zai", builtIn: false, connected: true }] })).toBe(false);
    expect(aiIsSetUp({ ...empty, openCode: [{ modelProviderId: "openrouter", builtIn: false, connected: false }] })).toBe(false);
  });

  it("counts any other AI, including providers onboarding does not list", () => {
    expect(aiIsSetUp({ ...empty, openCode: [{ modelProviderId: "openrouter", builtIn: false, connected: true }] })).toBe(true);
    expect(aiIsSetUp({ ...empty, curated: [{ id: "zai", connected: false, claudeReady: true }] })).toBe(true);
    expect(aiIsSetUp({ ...empty, accounts: [{ id: "codex", connected: true }] })).toBe(true);
  });

  it("marks a card connected through each orchestrator that serves it", () => {
    const lists = { accounts: [{ id: "claude", connected: true }], curated: [{ id: "deepseek", connected: true, claudeReady: true }],
      openCode: [BIG_PICKLE, { modelProviderId: "zai", builtIn: false, connected: true }] };
    expect(aiOnboardingConnections(claude, lists)).toEqual(["Claude Code"]);
    expect(aiOnboardingConnections(deepseek, lists)).toEqual(["Codex", "Claude Code"]);
    expect(aiOnboardingConnections(glm, lists)).toEqual([]);
    expect(aiOnboardingConnections(glm, { ...lists, curated: [{ id: "zai", connected: true }] })).toEqual([]);
    expect(aiOnboardingConnections(glm, { ...lists, curated: [{ id: "zai-coding-plan", connected: true }] })).toEqual(["Codex"]);
    expect(aiOnboardingConnections(AI_ONBOARDING_PROVIDERS[1], lists)).toEqual([]);
  });
});

describe("snooze and events", () => {
  it("snoozes Set up later for 24 hours per viewer", () => {
    snoozeAiOnboarding("owner-1", 1_000);
    expect(aiOnboardingSnoozed("owner-1", 1_000 + 23 * 3_600_000)).toBe(true);
    expect(aiOnboardingSnoozed("owner-1", 1_000 + 25 * 3_600_000)).toBe(false);
    expect(aiOnboardingSnoozed("owner-2", 1_000)).toBe(false);
  });

  it("treats unavailable storage as not snoozed without throwing", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("SecurityError"); } });
    expect(() => snoozeAiOnboarding("local")).not.toThrow();
    expect(aiOnboardingSnoozed("local")).toBe(false);
  });

  it("requests the flow through one window event", () => {
    const handler = vi.fn();
    const stop = onVibe64AiOnboardingRequested(handler);
    expect(requestVibe64AiOnboarding()).toBe(true);
    requestVibe64AiOnboarding({ start: "why" });
    requestVibe64AiOnboarding({ redo: true });
    stop();
    requestVibe64AiOnboarding();
    expect(handler.mock.calls.map(([event]) => event.detail)).toEqual([
      { start: "choose", redo: false }, { start: "why", redo: false }, { start: "choose", redo: true }]);
  });
});

describe("host auto-open", () => {
  // Auto-open is once per page load, so the closed cases run first.
  it("stays closed on load errors, snooze, Learning routes, members and existing setups", () => {
    const cases = [
      () => { mocks.curated.loadError.value = "Provider connections could not be loaded."; },
      () => { mocks.openCode.isInitialLoading.value = true; },
      () => { snoozeAiOnboarding("local"); },
      () => { mocks.route = { path: "/app/learning/lesson-0", query: {} }; },
      () => { mocks.route = { path: "/app/projects", query: { mode: "learning" } }; },
      () => { mocks.openCode.connections.value = [BIG_PICKLE, { modelProviderId: "openrouter", builtIn: false, connected: true }]; }
    ];
    for (const arrange of cases) {
      storage.clear();
      mocks.route = { path: "/app", query: {} };
      arrange();
      const state = mount(AiOnboardingHost, { canConfigure: true });
      expect(state.open).toBe(false);
      app.unmount();
      mocks.curated.loadError.value = "";
      mocks.openCode.isInitialLoading.value = false;
      mocks.openCode.connections.value = [BIG_PICKLE];
    }
    const member = mount(AiOnboardingHost, { canConfigure: false });
    expect(member.open).toBe(false);
    expect(aiOnboardingNeeded.value).toBe(false);
  });

  it("opens once for an owner with nothing set up and flags the nudge", async () => {
    const state = mount(AiOnboardingHost, { canConfigure: true });
    expect(state.open).toBe(true);
    expect(state.start).toBe("why");
    expect(aiOnboardingNeeded.value).toBe(true);
    await state.close("dismiss");
    expect(state.open).toBe(false);
    app.unmount();
    app = null;
    expect(mount(AiOnboardingHost, { canConfigure: true }).open).toBe(false);
  });

  it("opens on request, snoozes Set up later and only for this viewer", async () => {
    mocks.accounts.status.value.accounts[2].connected = true;
    const state = mount(AiOnboardingHost, { canConfigure: true, actorKey: "owner-1" });
    expect(state.open).toBe(false);
    requestVibe64AiOnboarding({ redo: true });
    expect([state.open, state.start, state.redo]).toEqual([true, "choose", true]);
    await state.close("later");
    expect(aiOnboardingSnoozed("owner-1")).toBe(true);
    expect(aiOnboardingSnoozed("local")).toBe(false);
  });

  it("returns focus to the stand-in a listener names when the opener has gone", async () => {
    mocks.accounts.status.value.accounts[2].connected = true;
    const state = mount(AiOnboardingHost, { canConfigure: true });
    expect(aiOnboardingAvailable.value).toBe(true);
    const opener = { isConnected: false, focus: vi.fn() };
    const activator = { isConnected: true, focus: vi.fn() };
    document.activeElement = opener;
    const stop = onVibe64AiOnboardingRequested((event) => { event.detail.returnFocus = activator; });
    requestVibe64AiOnboarding();
    stop();
    await state.close("dismiss");
    expect(activator.focus).toHaveBeenCalledOnce();
    expect(opener.focus).not.toHaveBeenCalled();
    app.unmount();
    app = null;
    expect(aiOnboardingAvailable.value).toBe(false);
  });

  it("does not open while a busy dialog blocks it", () => {
    mocks.accounts.status.value.accounts[2].connected = true;
    const state = mount(AiOnboardingHost, { canConfigure: true });
    aiOnboardingBlocked.value = true;
    expect(requestVibe64AiOnboarding()).toBe(false);
    expect(state.open).toBe(false);
    aiOnboardingBlocked.value = false;
  });
});

describe("embedded setup", () => {
  it("closes key setup after a save and proposes routing only when its setup failed", async () => {
    const { default: Native } = await vi.importActual("../../packages/vibe64-accounts/src/client/studio/NativeProviderConnections.vue");
    Object.assign(mocks.curated, { busy: ref(false), connections: ref([]), change: vi.fn().mockResolvedValue({ ok: true, routing: { ok: true } }) });
    mocks.curated.resource.isInitialLoading = ref(false);
    const onClose = vi.fn();
    const state = mount(Native, { embedded: true, adding: true, selectProvider: false, engineId: "codex", modelValue: "deepseek", onClose });
    state.apiKey = "fixture-key";
    await state.save();
    expect([onClose.mock.calls.length, state.routingProposal]).toEqual([1, false]);
    mocks.curated.change.mockResolvedValueOnce({ ok: true, routing: { ok: false, error: "Routing failed." } });
    state.apiKey = "fixture-key";
    await state.save();
    expect([onClose.mock.calls.length, state.routingProposal, state.routingSetupError]).toEqual([1, true, "Routing failed."]);
  });

  it("fixes the login provider for onboarding", async () => {
    const { default: Setup } = await vi.importActual("../../packages/vibe64-accounts/src/client/studio/AIAccountsSetup.vue");
    expect(mount(Setup, { embedded: true, providerId: "claude", modelProviderId: "anthropic" }).selectedModelProviderId).toBe("anthropic");
    app.unmount();
    expect(mount(Setup, { providerId: "codex" }).selectedModelProviderId).toBe("openai");
  });
});

describe("flow", () => {
  async function flow({ setUp = false, start = "why", redo = setUp } = {}) {
    if (setUp) mocks.accounts.status.value.accounts[2].connected = true;
    const onboarding = effectScope().run(() => useAiOnboarding({ enabled: true }));
    const state = mount(AiOnboarding, { open: true, start, redo, onboarding, canConfigure: true });
    await vi.waitFor(() => expect(mocks.colleague.current).toHaveBeenCalled());
    await Promise.resolve();
    return { state, onboarding };
  }
  const onCodexOpenAi = () => {
    mocks.colleague.selection.value = { engineId: "codex", modelProviderId: "openai", modelId: "gpt" };
  };
  const connectClaude = () => {
    mocks.accounts.status.value.accounts[1].connected = true;
    mocks.routing.workflows.workflows.value = [{ engineId: "claude", available: true }];
    mocks.routing.configuration.engines.value = [{ engineId: "claude", roles: {
      senior: { assignment: { engineId: "claude", modelProviderId: "anthropic", modelId: "opus" } } } }];
  };
  const routeDeepSeek = (senior) => {
    mocks.curated.resource.data.value.providers.find(({ id }) => id === "deepseek").connected = true;
    mocks.routing.workflows.workflows.value = [{ engineId: "codex", available: true }];
    mocks.routing.configuration.engines.value = [{ engineId: "codex", roles: { senior } }];
  };

  it("starts first-run at Why and routes a new person straight to success", async () => {
    const { state } = await flow();
    expect(state.screen).toBe("why");
    state.connect(claude, "opened");
    expect([state.screen, state.signUp]).toEqual(["connect", "opened"]);
    connectClaude();
    await state.finish();
    expect(state.screen).toBe("success");
    expect(mocks.colleague.selectForWorkflow).toHaveBeenCalledExactlyOnceWith({ engineId: "claude", modelProviderId: "anthropic" });
    expect(state.outcome).toMatchObject({ routed: true, error: "",
      colleague: { engineId: "claude", modelProviderId: "anthropic", label: "Claude Code (claude-model)" } });
    expect(state.colleagueNote).toBe("uses");
  });

  it("without a Colleague here, success only points to its model menu", async () => {
    unregisterColleague();
    const onboarding = effectScope().run(() => useAiOnboarding({ enabled: true }));
    const state = mount(AiOnboarding, { open: true, start: "choose", onboarding, canConfigure: true });
    state.connect(claude, "have");
    connectClaude();
    await state.finish();
    expect([state.screen, state.colleagueNote]).toEqual(["success", "menu"]);
  });

  it("does not mark the sign-up step done for someone who already has a plan", async () => {
    const { state } = await flow();
    state.connect(claude, "have");
    expect([state.screen, state.signUp]).toEqual(["connect", "have"]);
  });

  it("shows Colleague's refusal instead of claiming the switch", async () => {
    const { state } = await flow();
    state.connect(deepseek);
    routeDeepSeek({ assignment: { engineId: "codex", modelProviderId: "deepseek", modelId: "deepseek-v4-pro" } });
    await state.finish();
    expect(state.screen).toBe("success");
    expect(state.outcome).toMatchObject({ colleague: null, error: "Its Senior uses another provider." });
    expect(state.colleagueNote).toBe("switch");
  });

  it("stays in Connect until the provider is connected and has a Senior model", async () => {
    const { state } = await flow();
    state.connect(claude);
    await state.finish();
    expect(state.screen).toBe("connect");
    expect(state.warning).toContain("Claude isn't connected yet");
    mocks.accounts.status.value.accounts[1].connected = true;
    mocks.routing.workflows.workflows.value = [{ engineId: "claude", available: false }];
    await state.finish();
    expect([state.screen, state.notReady]).toEqual(["connect", true]);
    expect(mocks.colleague.selectForWorkflow).not.toHaveBeenCalled();
  });

  it("is not ready when the workflow's Senior is another provider", async () => {
    const { state } = await flow();
    state.connect(deepseek);
    routeDeepSeek({ assignment: { engineId: "codex", modelProviderId: "openai", modelId: "gpt" } });
    await state.finish();
    expect([state.screen, state.notReady]).toEqual(["connect", true]);
  });

  it("redo opens at Choose with live state and keeps the current setup untouched", async () => {
    onCodexOpenAi();
    const { state, onboarding } = await flow({ setUp: true, start: "why" });
    expect([state.screen, state.wasSetUp]).toEqual(["choose", true]);
    const codex = state.cards.find(({ id }) => id === "codex");
    expect(codex).toMatchObject({ connected: true, through: ["Codex"] });
    expect(state.cardAction(codex)).toBe("keep");
    expect(state.cardAction(state.cards.find(({ id }) => id === "claude"))).toBe("get");
    mocks.curated.resource.data.value.providers.find(({ id }) => id === "deepseek").connected = true;
    await onboarding.reload();
    expect(state.cardAction(state.cards.find(({ id }) => id === "deepseek"))).toBe("main");
    mocks.routing.workflows.workflows.value = [{ engineId: "codex", available: true }];
    mocks.routing.configuration.engines.value = [{ engineId: "codex", roles: {
      senior: { assignment: { engineId: "codex", modelProviderId: "openai", modelId: "gpt" } } } }];
    await state.keep(codex);
    expect(state.screen).toBe("success");
    expect(mocks.colleague.selectForWorkflow).not.toHaveBeenCalled();
  });

  it("redo asks before routing changes and switches Colleague only when asked", async () => {
    onCodexOpenAi();
    const { state } = await flow({ setUp: true, start: "choose" });
    routeDeepSeek({ assignment: { engineId: "codex", modelProviderId: "openai", modelId: "gpt" },
      recommendation: { engineId: "codex", modelProviderId: "deepseek", modelId: "deepseek-v4-pro" } });
    state.connect(state.cards.find(({ id }) => id === "deepseek"));
    await state.finish();
    expect(state.screen).toBe("routing");
    state.routingDone();
    await vi.waitFor(() => expect(state.screen).toBe("success"));
    expect(state.outcome.routed).toBe(false);
    expect(mocks.colleague.selectForWorkflow).not.toHaveBeenCalled();
    expect(state.colleagueNote).toBe("switch");
    mocks.colleague.seniorProviders.codex = "deepseek";
    await state.switchColleague();
    expect(mocks.colleague.selectForWorkflow).toHaveBeenCalledExactlyOnceWith({ engineId: "codex", modelProviderId: "deepseek" });
    expect(state.colleagueNote).toBe("uses");
  });

  it("a redo opened before connections load never moves Colleague unasked", async () => {
    onCodexOpenAi();
    mocks.openCode.isInitialLoading.value = true;
    const { state } = await flow({ setUp: true, start: "why", redo: true });
    expect([state.screen, state.wasSetUp, state.firstRun, state.skippable]).toEqual(["choose", true, false, false]);
    mocks.openCode.isInitialLoading.value = false;
    connectClaude();
    state.connect(claude);
    await state.finish();
    expect(state.screen).toBe("success");
    expect(mocks.colleague.selectForWorkflow).not.toHaveBeenCalled();
  });

  it("an automatic open settles first run only once connections are read", async () => {
    mocks.openCode.isInitialLoading.value = true;
    const { state } = await flow({ start: "why" });
    expect([state.screen, state.firstRun]).toEqual(["why", false]);
    mocks.accounts.status.value.accounts[2].connected = true;
    mocks.openCode.isInitialLoading.value = false;
    await vi.waitFor(() => expect(state.screen).toBe("choose"));
    expect([state.wasSetUp, state.firstRun]).toEqual([true, false]);
  });

  it("shows the owner-only notice to members", () => {
    const onboarding = effectScope().run(() => useAiOnboarding({ enabled: false }));
    expect(mount(AiOnboarding, { open: true, onboarding, canConfigure: false }).screen).toBe("owner");
  });

  it("never offers removal and turns motion off for reduced-motion users", async () => {
    const source = await readFile(new URL("../../packages/vibe64-accounts/src/client/onboarding/AiOnboarding.vue", import.meta.url), "utf8");
    expect(source).not.toMatch(/removeConnection|Disconnect|logout/u);
    expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none;[\s\S]*transform: none;/u);
  });
});
