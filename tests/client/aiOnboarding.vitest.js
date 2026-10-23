import { readFile } from "node:fs/promises";
import { computed, createRenderer, effectScope, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";

const mocks = vi.hoisted(() => ({ route: null, accounts: null, curated: null, openCode: null, routing: null, colleague: null }));
vi.mock("vue-router", () => ({ useRoute: () => mocks.route, useRouter: () => ({ replace: vi.fn() }) }));
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
import { VIBE64_LEARNING_KEY } from "../../src/lib/vibe64AssistantHost.js";
import { AI_ONBOARDING_PROVIDERS } from "../../packages/vibe64-accounts/src/client/onboarding/aiOnboardingProviders.js";
import { aiOnboardingAvailable, aiOnboardingBlocked, aiOnboardingNeeded, onVibe64AiOnboardingRequested, requestVibe64AiOnboarding }
  from "../../packages/vibe64-accounts/src/client/onboarding/aiOnboardingEvents.js";
import { aiIsSetUp, aiOnboardingConnections, aiOnboardingSnoozed, snoozeAiOnboarding, useAiOnboarding }
  from "../../packages/vibe64-accounts/src/client/onboarding/useAiOnboarding.js";
import AiOnboarding from "../../packages/vibe64-accounts/src/client/onboarding/AiOnboarding.vue";
import AiOnboardingHost from "../../packages/vibe64-accounts/src/client/onboarding/AiOnboardingHost.vue";
import AiSetup from "../../packages/vibe64-accounts/src/client/onboarding/AiSetup.vue";

const empty = { accounts: [], curated: [], openCode: [] };
const FREE_GLM = { id: "zai", modelProviderId: "zai", connected: true };
const claude = AI_ONBOARDING_PROVIDERS.find(({ id }) => id === "claude");
const deepseek = AI_ONBOARDING_PROVIDERS.find(({ id }) => id === "deepseek");
const glm = AI_ONBOARDING_PROVIDERS.find(({ id }) => id === "glm");
const ENGINE_LABELS = { claude: "Claude Code", codex: "Codex" };
const SENIOR_PROVIDERS = { claude: "anthropic", codex: "openai" };
let unregisterColleague = () => null;

let app;
let storage;
function mount(component, props, provides = []) {
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...component, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  for (const [key, value] of provides) app.provide(key, value);
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
    loadError: ref(""), busy: ref(false) };
  mocks.curated.connections = computed(() => mocks.curated.resource.data.value?.providers || []);
  mocks.curated.resource.isInitialLoading = ref(false);
  mocks.openCode = { connections: ref([]), loadError: ref(""), isInitialLoading: ref(false), reload: vi.fn().mockResolvedValue({}),
    removingProviderId: ref(""), savingProviderId: ref(""), updatingModelAccessProviderId: ref("") };
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
    }),
    sayHello: vi.fn(async () => ({ ok: true, reply: "Hello there!" })) };
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

  it("leads with each plan's official name and price, the spending advice beneath", () => {
    // No budget figure under Claude's $20 headline; the comparisons quote that $20.
    expect(claude).toMatchObject({ crown: true, plan: { name: "Claude Pro", price: "$20/month",
      budget: "", more: "Coding a lot? Max · $100/month" } });
    expect(glm.plan.budget).toContain("$30/month");
    expect(glm.note).toContain("There's no point in getting it when Claude Pro is $20/month.");
    expect(deepseek.note).toContain("For $20 a month, Claude Pro gives a far better experience.");
    expect(AI_ONBOARDING_PROVIDERS.filter(({ crown }) => crown)).toHaveLength(1);
    // "Recommended" belongs to Claude's ribbon alone, and only Claude rates 5 on quota.
    expect(JSON.stringify(AI_ONBOARDING_PROVIDERS)).not.toMatch(/Recommended:/u);
    expect(AI_ONBOARDING_PROVIDERS.filter(({ bullets }) => bullets.some(([aspect, rating]) => aspect === "quota" && rating === 5))
      .map(({ id }) => id)).toEqual(["claude"]);
    expect(new Set(AI_ONBOARDING_PROVIDERS.map(({ shape }) => shape)).size).toBe(AI_ONBOARDING_PROVIDERS.length);
    expect(deepseek.haveTitle).toBe("Already have credit");
    // The one free option: GLM with a free Z.AI account, connected through OpenCode.
    expect(AI_ONBOARDING_PROVIDERS.filter(({ free }) => free).map(({ id }) => id)).toEqual(["glm"]);
    expect(glm.free).toMatchObject({ label: "Free option: GLM-4.7 Flash with a free Z.AI account",
      connect: { engineId: "opencode", modelProviderId: "zai", access: "workspace" }, matches: { opencode: ["zai"] } });
  });
});

describe("set-up rule", () => {
  it("does not count nothing, non-AI accounts or a failed connection as set up", () => {
    expect(aiIsSetUp(empty)).toBe(false);
    expect(aiIsSetUp({ ...empty, accounts: [{ id: "github", connected: true }] })).toBe(false);
    expect(aiIsSetUp({ ...empty, openCode: [{ modelProviderId: "openrouter", connected: false }] })).toBe(false);
  });

  it("counts the free GLM option and any other AI, including providers onboarding does not list", () => {
    expect(aiIsSetUp({ ...empty, openCode: [FREE_GLM] })).toBe(true);
    expect(aiIsSetUp({ ...empty, openCode: [{ modelProviderId: "openrouter", connected: true }] })).toBe(true);
    expect(aiIsSetUp({ ...empty, curated: [{ id: "zai", connected: false, claudeReady: true }] })).toBe(true);
    expect(aiIsSetUp({ ...empty, accounts: [{ id: "codex", connected: true }] })).toBe(true);
  });

  it("marks a card connected through each orchestrator that serves it", () => {
    const lists = { accounts: [{ id: "claude", connected: true }], curated: [{ id: "deepseek", connected: true, claudeReady: true }],
      openCode: [FREE_GLM] };
    expect(aiOnboardingConnections(claude, lists)).toEqual(["Claude Code"]);
    expect(aiOnboardingConnections(deepseek, lists)).toEqual(["Codex", "Claude Code"]);
    expect(aiOnboardingConnections(glm, lists)).toEqual([]);
    expect(aiOnboardingConnections(glm.free, lists)).toEqual(["OpenCode"]);
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
      () => { mocks.openCode.connections.value = [{ modelProviderId: "openrouter", connected: true }]; }
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
      mocks.openCode.connections.value = [];
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

describe("shell", () => {
  const shell = (props) => mount(AiOnboarding, { open: true, canConfigure: true,
    onboarding: effectScope().run(() => useAiOnboarding({ enabled: true })), ...props });

  it("opens first run on Why, and a redo, an existing setup or a member on the setup stage", () => {
    expect(shell({ start: "why" }).view).toBe("why");
    app.unmount();
    expect(shell({ start: "choose" }).view).toBe("setup");
    app.unmount();
    expect(shell({ start: "why", redo: true }).view).toBe("setup");
    app.unmount();
    expect(shell({ start: "why", canConfigure: false }).view).toBe("setup");
    app.unmount();
    mocks.accounts.status.value.accounts[2].connected = true;
    expect(shell({ start: "why" }).view).toBe("setup");
  });

  it("an automatic open leaves Why only once connections are read and show a setup", async () => {
    mocks.openCode.isInitialLoading.value = true;
    const state = shell({ start: "why" });
    expect(state.view).toBe("why");
    mocks.accounts.status.value.accounts[2].connected = true;
    mocks.openCode.isInitialLoading.value = false;
    await vi.waitFor(() => expect(state.view).toBe("setup"));
  });
});

describe("flow", () => {
  async function flow({ setUp = false, redo = setUp, learnMode = false } = {}) {
    if (setUp) mocks.accounts.status.value.accounts[2].connected = true;
    const onboarding = effectScope().run(() => useAiOnboarding({ enabled: true }));
    const state = mount(AiSetup, { open: true, redo, onboarding, canConfigure: true },
      [[VIBE64_LEARNING_KEY, { learnMode }]]);
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

  it("starts first-run at Choose and routes a new person straight to success", async () => {
    const { state } = await flow();
    expect([state.screen, state.firstRun]).toEqual(["choose", true]);
    state.connect(claude, "opened");
    expect([state.screen, state.signUp]).toEqual(["connect", "opened"]);
    connectClaude();
    await state.finish();
    expect(state.screen).toBe("success");
    expect(mocks.colleague.selectForWorkflow).toHaveBeenCalledExactlyOnceWith({ engineId: "claude", modelProviderId: "anthropic" });
    expect(state.outcome).toMatchObject({ routed: true, error: "",
      colleague: { engineId: "claude", modelProviderId: "anthropic", label: "claude-model" } });
    expect(state.colleagueNote).toBe("uses");
    await vi.waitFor(() => expect(state.hello).toEqual({ state: "replied", reply: "Hello there!", error: "" }));
    expect(state.proven).toBe(true);
  });

  it("says what finishing does and reads routing alongside the new connection", async () => {
    const { state } = await flow();
    state.connect(claude, "have");
    connectClaude();
    let accountsRead;
    mocks.accounts.statusResource.reload.mockReturnValueOnce(new Promise((resolve) => { accountsRead = resolve; }));
    const finishing = state.finish();
    await vi.waitFor(() => expect(mocks.routing.configuration.resource.reload).toHaveBeenCalled());
    expect(mocks.routing.workflows.resource.reload).toHaveBeenCalled();
    expect([state.verifying, state.verifyLabel]).toEqual([true, "Setting up Claude as your main AI…"]);
    accountsRead({});
    await finishing;
    expect([state.screen, state.verifying]).toEqual(["success", false]);
  });

  it("in Learn mode sends no hello into the lesson's teacher thread", async () => {
    const { state } = await flow({ learnMode: true });
    state.connect(claude, "have");
    connectClaude();
    await state.finish();
    expect([state.screen, state.colleagueNote, state.proven]).toEqual(["success", "uses", true]);
    await Promise.resolve();
    expect(mocks.colleague.sayHello).not.toHaveBeenCalled();
    expect([state.hello.state, state.doneLabel]).toEqual(["", "Back to Learn"]);
  });

  it("names the way back by mode: Start building in Develop", async () => {
    const { state } = await flow();
    expect(state.doneLabel).toBe("Start building");
  });

  it("shows Colleague's failed hello without the check until a retry succeeds", async () => {
    mocks.colleague.sayHello.mockResolvedValueOnce({ ok: false, error: "Insufficient balance." });
    const { state } = await flow();
    state.connect(claude, "have");
    connectClaude();
    await state.finish();
    await vi.waitFor(() => expect(state.hello).toEqual({ state: "failed", reply: "", error: "Insufficient balance." }));
    expect(state.proven).toBe(false);
    await state.sayHello();
    expect([state.hello.state, state.proven]).toEqual(["replied", true]);
  });

  it("without a Colleague here, success only points to its model menu", async () => {
    unregisterColleague();
    const onboarding = effectScope().run(() => useAiOnboarding({ enabled: true }));
    const state = mount(AiSetup, { open: true, onboarding, canConfigure: true });
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
    const { state, onboarding } = await flow({ setUp: true });
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
    const { state } = await flow({ setUp: true });
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

  it("Yes on the plain routing question applies the suggestions and moves Colleague", async () => {
    onCodexOpenAi();
    const { state } = await flow({ setUp: true });
    routeDeepSeek({ assignment: { engineId: "codex", modelProviderId: "openai", modelId: "gpt" },
      recommendation: { engineId: "codex", modelProviderId: "deepseek", modelId: "deepseek-v4-pro" } });
    state.connect(state.cards.find(({ id }) => id === "deepseek"));
    await state.finish();
    expect([state.screen, state.autoRouting, state.currentSenior?.name]).toEqual(["routing", false, "Codex"]);
    mocks.colleague.seniorProviders.codex = "deepseek";
    state.routingForm = { applySuggested: vi.fn(async () => {
      mocks.routing.configuration.engines.value = [{ engineId: "codex", roles: {
        senior: { assignment: { engineId: "codex", modelProviderId: "deepseek", modelId: "deepseek-v4-pro" } } } }];
      await state.routingDone();
    }) };
    await state.useAsMain();
    expect([state.screen, state.routingDetails]).toEqual(["success", false]);
    expect(mocks.colleague.selectForWorkflow).toHaveBeenCalledExactlyOnceWith({ engineId: "codex", modelProviderId: "deepseek" });
  });

  it("with no Senior model in use, a redo applies the suggestions without asking", async () => {
    onCodexOpenAi();
    const { state } = await flow({ setUp: true });
    routeDeepSeek({ assignment: null, recommendation: { engineId: "codex", modelProviderId: "deepseek", modelId: "deepseek-v4-pro" } });
    state.connect(state.cards.find(({ id }) => id === "deepseek"));
    await state.finish();
    expect([state.screen, state.autoRouting, state.currentSenior]).toEqual(["routing", true, null]);
    mocks.colleague.seniorProviders.codex = "deepseek";
    state.routingForm = { applySuggested: vi.fn(async () => {
      mocks.routing.configuration.engines.value = [{ engineId: "codex", roles: {
        senior: { assignment: { engineId: "codex", modelProviderId: "deepseek", modelId: "deepseek-v4-pro" } } } }];
      await state.routingDone();
    }) };
    await vi.waitFor(() => expect(state.screen).toBe("success"));
    expect(mocks.colleague.selectForWorkflow).toHaveBeenCalledExactlyOnceWith({ engineId: "codex", modelProviderId: "deepseek" });
  });

  it("a redo keeps the upsell on Claude's card only and stops selling connected cards", async () => {
    onCodexOpenAi();
    const { state } = await flow({ setUp: true });
    const card = (id) => state.cards.find((item) => item.id === id);
    expect(state.cardNote(card("codex"))).toBe("");
    expect(state.cardNote(card("claude"))).toBe(claude.upgrade);
    expect(state.connectedLabel(card("codex"))).toBe("Connected · in use");
  });

  it("a redo opened before connections load never moves Colleague unasked", async () => {
    onCodexOpenAi();
    mocks.openCode.isInitialLoading.value = true;
    const { state } = await flow({ setUp: true, redo: true });
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
    const { state } = await flow();
    expect([state.wasSetUp, state.firstRun]).toEqual([false, false]);
    mocks.accounts.status.value.accounts[2].connected = true;
    mocks.openCode.isInitialLoading.value = false;
    await vi.waitFor(() => expect(state.wasSetUp).toBe(true));
    expect([state.screen, state.wasSetUp, state.firstRun]).toEqual(["choose", true, false]);
  });

  it("opens Manage on a configured card with only that card's connections", async () => {
    mocks.curated.resource.data.value.providers.find(({ id }) => id === "deepseek")
      .configuredEngines = ["codex", "claude"];
    Object.assign(mocks.curated.resource.data.value.providers.find(({ id }) => id === "deepseek"), { connected: true, claudeReady: true });
    mocks.openCode.connections.value = [FREE_GLM];
    const { state } = await flow({ setUp: true });
    const card = (id) => state.cards.find((item) => item.id === id);
    expect(state.cardRows(card("deepseek")).map(({ kind, engineId }) => [kind, engineId]))
      .toEqual([["codex-provider", "codex"], ["codex-provider", "claude"]]);
    expect(state.cardRows(card("codex")).map(({ kind }) => kind)).toEqual(["codex"]);
    expect([state.cardRows(card("glm")).length, state.cardRows(card("glm").free).map(({ id }) => id)]).toEqual([0, ["zai"]]);
    expect(state.cardRows(card("claude"))).toEqual([]);
    state.openManage(card("deepseek"));
    expect([state.manageOpen, state.managedCard.id]).toEqual([true, "deepseek"]);
  });

  it("leads a configured setup with its cards, and asks to reconnect one that stopped working", async () => {
    mocks.accounts.status.value.accounts[1] = { id: "claude", connected: false, status: "reconnect_required" };
    const { state } = await flow({ setUp: true });
    const claudeCard = state.cards.find(({ id }) => id === "claude");
    expect(state.orderedCards.map(({ id }) => id)).toEqual(["claude", "codex", "deepseek", "glm"]);
    expect([state.cardAction(claudeCard), state.cardNote(claudeCard), state.configured(claudeCard)]).toEqual(["reconnect", "", true]);
    mocks.accounts.status.value.accounts[1] = { id: "claude", connected: false, status: "not_connected" };
    mocks.curated.resource.data.value.providers.find(({ id }) => id === "deepseek")
      .configuredEngines = ["codex"];
    mocks.curated.resource.data.value.providers.find(({ id }) => id === "deepseek").connected = true;
    expect(state.orderedCards.map(({ id }) => id)).toEqual(["codex", "deepseek", "claude", "glm"]);
    expect(state.cardAction(state.cards.find(({ id }) => id === "claude"))).toBe("get");
  });

  it("keeps connections no card shows: they count as connected and appear under Advanced", async () => {
    const zen = { id: "opencode", modelProviderId: "opencode", connected: true, label: "OpenCode Zen" };
    const groq = { id: "groq", modelProviderId: "groq", connected: true, label: "Groq" };
    mocks.openCode.connections.value = [FREE_GLM, zen, groq];
    const { state } = await flow({ setUp: true });
    expect(state.otherRows.map(({ id }) => id)).toEqual(["opencode", "groq"]);
    expect([state.currentMarks.map(({ id, mark }) => [id, mark]), state.currentNames])
      .toEqual([[["codex", "O"], ["other", "+2"]], ["Codex", "OpenCode Zen", "Groq"]]);
    expect(state.showAdvanced).toBe(true);
  });

  it("says which program a card needs on this computer before anyone picks it", async () => {
    mocks.accounts.status.value.missingTools = [{ id: "claude", label: "Claude Code" }, { id: "opencode", label: "opencode" }];
    const { state } = await flow();
    const card = (id) => state.cards.find((item) => item.id === id);
    expect([state.neededTool(card("claude"))?.label, state.neededTool(card("codex")), state.neededTool(card("glm").free)?.label])
      .toEqual(["Claude Code", null, "opencode"]);
  });

  // Inline, as Account settings' AI Accounts: it reads its own setup state.
  const inline = async (props = {}) => {
    const state = mount(AiSetup, { inline: true, canConfigure: true, ...props });
    await vi.waitFor(() => expect(mocks.colleague.current).toHaveBeenCalled());
    await Promise.resolve();
    return state;
  };

  it("inline with nothing configured shows the onboarding cards, also while the only AI needs reconnecting", async () => {
    mocks.accounts.status.value.accounts[1] = { id: "claude", connected: false, status: "reconnect_required" };
    const state = await inline();
    expect([state.wasSetUp, state.skippable, state.cardAction(state.cards.find(({ id }) => id === "claude"))])
      .toEqual([false, false, "reconnect"]);
    app.unmount();
    mocks.accounts.status.value.accounts[1] = { id: "claude", connected: true, status: "connected" };
    expect((await inline()).wasSetUp).toBe(true);
  });

  it("inline, finishing returns to the overview instead of closing", async () => {
    const onClose = vi.fn();
    const state = await inline({ onClose });
    state.connect(state.cards.find(({ id }) => id === "deepseek"), "have");
    expect(state.screen).toBe("connect");
    state.close("done");
    expect([state.screen, state.chosen, onClose.mock.calls.length]).toEqual(["choose", null, 0]);
  });

  it("lands each deep link on the card's Manage, its connect step, or the key editor", async () => {
    mocks.accounts.status.value.accounts[1] = { id: "claude", connected: true, status: "connected" };
    const state = await inline();
    state.manager.openProvider = vi.fn();
    state.openProvider("claude");
    expect([state.manageOpen, state.managedCard.id]).toEqual([true, "claude"]);
    state.manageOpen = false;
    state.openProvider("deepseek");
    expect([state.screen, state.chosen.id, state.manageOpen]).toEqual(["connect", "deepseek", false]);
    const revision = `sha256:${"a".repeat(64)}`;
    state.openProvider("zai", { providerRevision: revision, providerLabel: "Z.AI" });
    state.openProvider("opencode");
    state.openProvider("mystery");
    expect(state.manager.openProvider.mock.calls).toEqual([
      ["zai", { providerRevision: revision, providerLabel: "Z.AI" }], ["opencode", {}], ["mystery", {}]
    ]);
  });

  it("inline, opens the card a route names once connections are read", async () => {
    mocks.route = { path: "/app/manage/accounts", query: { providerId: "deepseek", providerLabel: "DeepSeek" } };
    const state = await inline();
    expect([state.screen, state.chosen?.id]).toEqual(["connect", "deepseek"]);
  });

  it("shows the owner-only notice to members", () => {
    const onboarding = effectScope().run(() => useAiOnboarding({ enabled: false }));
    expect(mount(AiSetup, { open: true, onboarding, canConfigure: false }).screen).toBe("owner");
  });

  it("never offers removal on the card face and turns motion off for reduced-motion users", async () => {
    for (const file of ["AiOnboarding.vue", "AiSetup.vue"]) {
      const source = await readFile(new URL(`../../packages/vibe64-accounts/src/client/onboarding/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/removeConnection|requestRemove|Disconnect|logout|>\s*Remove\s*</u);
      expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none;[\s\S]*transform: none;/u);
    }
  });

  it("leaves who may use a connection to the host, through the connection-access slot", async () => {
    const read = (file) => readFile(new URL(`../../packages/vibe64-accounts/src/client/${file}`, import.meta.url), "utf8");
    const files = ["onboarding/AiOnboarding.vue", "onboarding/AiSetup.vue", "onboarding/AiOnboardingHost.vue",
      "studio/AiProviderManage.vue", "studio/AiConnectionRow.vue", "studio/AiSetupAdvanced.vue"];
    const sources = await Promise.all(files.map(read));
    for (const source of sources) expect(source).not.toMatch(/Workspace use|Personal use|Workspace members|workspace owner|your account menu|[Hh]osted/u);
    const [, setup, , manage, row, advanced] = sources;
    expect(setup.match(/<slot name="connection-access" :card="(?:card|chosen)" place="(?:badge|success)" \/>/gu)).toHaveLength(2);
    expect(row).toMatch(/<slot name="connection-access" :connection="account" place="row" \/>/u);
    for (const source of [setup, manage, advanced]) expect(source).toMatch(/#connection-access="scope"><slot name="connection-access" v-bind="scope" \/>/u);
  });

  it("offers Remove only inside a card's Manage", async () => {
    const studio = (file) => readFile(new URL(`../../packages/vibe64-accounts/src/client/studio/${file}`, import.meta.url), "utf8");
    const [setup, manage, row] = await Promise.all([
      readFile(new URL("../../packages/vibe64-accounts/src/client/onboarding/AiSetup.vue", import.meta.url), "utf8"),
      studio("AiProviderManage.vue"), studio("AiConnectionRow.vue")]);
    expect(setup).toMatch(/<AiProviderManage v-model="manageOpen" :card="managedCard"/u);
    expect(manage).toMatch(/<AiConnectionRow v-for="row in rows"/u);
    expect(row).toMatch(/@click="requestRemove\(account\)"[\s\S]*Remove/u);
  });
});
