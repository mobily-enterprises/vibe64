import { computed, createRenderer, createSSRApp, nextTick, ref, ssrContextKey } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, scopeKey: null, request: vi.fn(), command: null }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useModelRouting.js", () => ({
  useModelRouting: () => ({ resource: mocks.resource, scopeKey: mocks.scopeKey,
    engines: computed(() => mocks.resource.data.value?.engines || []),
    team: computed(() => mocks.resource.data.value?.team || { available: false, ownerName: "", memberCount: 0 }),
    setups: computed(() => mocks.resource.data.value?.setups || null), loadError: ref("") })
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand(options) { mocks.command = options; return { run: vi.fn() }; }
}));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
vi.mock("../../packages/vibe64-accounts/src/client/lib/accountsGateApi.js", () => ({ ACCOUNTS_ENDPOINT: "/api/accounts" }));
import ModelRoutingForm from "../../packages/vibe64-accounts/src/client/studio/ModelRoutingForm.vue";
import ModelRoutingRow from "../../packages/vibe64-accounts/src/client/studio/ModelRoutingRow.vue";

const VARIANTS = [{ id: "low", label: "Low" }, { id: "medium", label: "Medium" }, { id: "high", label: "High" }];
const selection = (engineId, provider, modelId, variantId = "high", selectionSource = "recommended") => ({
  schema: "vibe64.assistant-selection.v1", engineId, modelProviderId: provider, modelId,
  agentId: engineId, variantId, catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource
});
const LABELS = { opus: "Opus 5.5", haiku: "Haiku 5.5", "deepseek-v4-pro": "DeepSeek V4 Pro", "deepseek-flash": "DeepSeek V4.1 Flash" };
const opus = selection("claude", "anthropic", "opus");
const opusMedium = selection("claude", "anthropic", "opus", "medium");
const haiku = selection("claude", "anthropic", "haiku", "low");
const proClaude = selection("claude", "deepseek", "deepseek-v4-pro");
const proCodex = selection("codex", "deepseek", "deepseek-v4-pro");
const flash = selection("claude", "deepseek", "deepseek-flash", "low");
const choice = (item) => ({ ...item, label: LABELS[item.modelId], engineLabel: item.engineId === "claude" ? "Claude Code" : "Codex",
  providerLabel: item.modelProviderId === "anthropic" ? "Claude" : "DeepSeek", variants: VARIANTS, available: true,
  ownerOnly: item.modelProviderId === "anthropic", endpointCode: item.modelProviderId === "anthropic" ? "claude_subscription" : "",
  accessLabel: item.modelProviderId === "anthropic" ? "Personal use" : "Workspace use", capabilities: { toolcall: true } });
const OWNER_CHOICES = [opus, haiku, proClaude, proCodex, flash].map(choice);
const TEAM_CHOICES = OWNER_CHOICES.filter(({ ownerOnly }) => !ownerOnly);
const OWNER_ROLES = ["senior", "junior", "router", "colleague", "fix", "explain", "quickHelper"];
const TEAM_ROLES = ["colleague", "fix", "explain", "quickHelper"];
const GOLD = { senior: opus, junior: opusMedium, router: haiku, quickHelper: haiku,
  colleague: { follows: "senior" }, fix: { follows: "junior" }, explain: { follows: "quickHelper" } };
const TEAM_RECOMMENDED = { colleague: proClaude, fix: { follows: "colleague" }, explain: { follows: "quickHelper" }, quickHelper: flash };
function resourceData({ owner = GOLD, nonOwner = {}, canConfigure = true } = {}) {
  const role = (values, name, recommendation, choices) => ({ value: values[name] ?? null, configured: Object.hasOwn(values, name),
    recommendation, choices, error: "" });
  return { ok: true, revision: 3, canConfigure, team: { available: true, ownerName: "Tony", memberCount: 2 },
    engines: [{ engineId: "claude", label: "Claude Code", connected: true }, { engineId: "codex", label: "Codex", connected: true }],
    setups: {
      owner: { roles: Object.fromEntries(OWNER_ROLES.map((name) => [name, role(owner, name, GOLD[name], OWNER_CHOICES)])), preview: {} },
      nonOwner: { roles: Object.fromEntries(TEAM_ROLES.map((name) => [name, role(nonOwner, name, TEAM_RECOMMENDED[name], TEAM_CHOICES)])), preview: {} }
    } };
}
let app;
function mount(component, props = {}) {
  const renderer = createRenderer({ createComment: (text) => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const events = [];
  app = renderer.createApp({ ...component, render: () => null }, { ...props, onUpdate: (value) => events.push(["update", value]),
    onAddTeamKey: () => events.push(["add-team-key"]), onConnectProvider: (id) => events.push(["connect-provider", id]) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return Object.assign(app._instance.setupState, { events });
}
async function render(component, props = {}) {
  const view = createSSRApp(component, props);
  view.use(createVuetify({ ssr: true }));
  return (await renderToString(view)).replace(/<!--.*?-->/gu, "").replace(/&#39;/gu, "'").replace(/\s+/gu, " ");
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.scopeKey = ref("owner:first");
  mocks.resource = { data: ref(resourceData()), isInitialLoading: ref(false), loadError: ref(""), reload: vi.fn(async () => {}) };
  mocks.request.mockReset();
});
afterEach(() => { app?.unmount(); app = null; vi.useRealTimers(); });

describe("setups", () => {
  it("hydrates both setups, shows absent following roles as their default Same as and sends only edited roles", () => {
    const owner = { ...GOLD };
    delete owner.explain;
    mocks.resource.data.value = resourceData({ owner });
    const state = mount(ModelRoutingForm);
    expect(state.baseRevision).toBe(3);
    expect(state.draft.owner.explain).toEqual({ follows: "quickHelper" });
    expect(state.draft.nonOwner).toEqual({ fix: { follows: "colleague" }, explain: { follows: "quickHelper" } });
    expect(state.showSwitch).toBe(false, "a default Same as is not a team model");
    expect(mocks.command.buildRawPayload()).toEqual({ revision: 3 });
    state.update("nonOwner", "fix", { follows: "colleague" });
    expect(mocks.command.buildRawPayload()).toEqual({ revision: 3 }, "choosing the default again changes nothing");
    state.update("owner", "quickHelper", { ...flash, selectionSource: "explicit" });
    state.update("nonOwner", "colleague", { ...flash, selectionSource: "explicit" });
    expect(mocks.command.buildRawPayload()).toEqual({ revision: 3,
      owner: { quickHelper: { ...flash, selectionSource: "explicit" }, explain: { follows: "quickHelper" } },
      nonOwner: { colleague: { ...flash, selectionSource: "explicit" }, fix: { follows: "colleague" }, explain: { follows: "quickHelper" } } });
  });

  it("groups the owner setup into Main chat and Helpers, with quiet Same as rows", async () => {
    const html = await render(ModelRoutingForm);
    expect(html).toContain("Models");
    expect(html.indexOf("Main chat")).toBeLessThan(html.indexOf("Helpers"));
    for (const [role, line] of [["Colleague", "Same as Senior · Opus 5.5 · High"], ["Fix it with AI", "Same as Junior · Opus 5.5 · Medium"],
      ["Explain &amp; check", "Same as Quick helper · Haiku 5.5 · Low"]]) {
      expect(html).toContain(role);
      expect(html).toContain(line);
    }
    expect(html).toContain("Plans, reviews and Deslop in main chat. Your most capable model.");
    expect(html).toContain("Titles, commit messages, prompt hints and summaries.");
    expect(html).not.toContain("Team members");
  });

  it("Change gives a Same as row its followed model; an explicit row returns with Use Senior's model", () => {
    const state = mount(ModelRoutingForm);
    expect(state.followedLabel("owner", "colleague")).toBe("Opus 5.5 · High");
    expect(state.defaultFollows("owner", "colleague")).toBe("");
    state.changeFollowing("owner", "colleague");
    expect(state.draft.owner.colleague).toEqual({ ...opus, selectionSource: "explicit" });
    expect(state.defaultFollows("owner", "colleague")).toBe("senior");
    expect(state.defaultFollows("owner", "senior")).toBe("");
    expect(state.defaultFollows("nonOwner", "colleague")).toBe("");
    state.update("owner", "colleague", { follows: "senior" });
    expect(mocks.command.buildRawPayload()).toEqual({ revision: 3 });
  });

  it("shows Owner | Team members only to the owner once a team model exists or from the team card", () => {
    expect(mount(ModelRoutingForm).showSwitch).toBe(false);
    app.unmount();
    expect(mount(ModelRoutingForm, { initialSetup: "nonOwner" })).toMatchObject({ showSwitch: true, setup: "nonOwner", teamEmpty: true });
    app.unmount();
    mocks.resource.data.value = resourceData({ nonOwner: { colleague: proClaude } });
    expect(mount(ModelRoutingForm)).toMatchObject({ showSwitch: true, setup: "owner", teamEmpty: false });
    app.unmount();
    mocks.resource.data.value = resourceData({ nonOwner: { colleague: proClaude }, canConfigure: false });
    expect(mount(ModelRoutingForm, { readonly: true })).toMatchObject({ showSwitch: false, setup: "nonOwner", canEdit: false });
  });

  it("explains the team setup to the owner and lists only team-usable models", async () => {
    mocks.resource.data.value = resourceData({ nonOwner: { colleague: proClaude, fix: { follows: "colleague" }, explain: { follows: "quickHelper" }, quickHelper: flash } });
    const html = await render(ModelRoutingForm, { initialSetup: "nonOwner" });
    expect(html).toContain("Owner (you)");
    expect(html).toContain("Team members' Colleague, Fix it with AI, Explain &amp; check and Quick helper use these models. Main chat always runs on your setup, and you approve what team members send to it.");
    expect(html).toContain("Personal plans, like your Claude plan, can't be used by team members.");
    expect(html).toContain("Same as Colleague · DeepSeek V4 Pro · High");
    expect(html).toContain("Same as Quick helper · DeepSeek V4.1 Flash · Low");
    expect(html).not.toContain("Main chat</h3>");
    expect(html).not.toContain("Personal use");
  });

  it("offers an empty team setup's DeepSeek key, and tells a member to ask the owner", async () => {
    const owner = await render(ModelRoutingForm, { initialSetup: "nonOwner", onAddTeamKey: () => {} });
    expect(owner).toContain("No team AI yet. Team members can't open projects until you add one.");
    expect(owner).toContain("Or choose a Workspace-use model you already connected below.");
    expect(owner).toContain("Add a DeepSeek key");
    expect(owner).toContain("Same as Colleague · Not chosen yet");
    expect(owner).toContain("Same as Quick helper · Not chosen yet");
    expect(owner).toMatch(/>Colleague model</u);
    expect(owner).not.toMatch(/>Fix it with AI model</u, "no blank picker for a default Same as role");
    expect(owner).not.toMatch(/Review recommendations|No recommended changes/u);
    expect(await render(ModelRoutingForm, { initialSetup: "nonOwner" })).not.toContain("Add a DeepSeek key",
      "no button where the host can't open the team key step");
    mocks.resource.data.value = resourceData({ canConfigure: false });
    const member = await render(ModelRoutingForm, { readonly: true });
    expect(member).toContain("No team AI yet. Ask Tony to set up AI for team members.");
    expect(member).toContain("Change your own Colleague's model from Colleague's menu.");
    expect(member).not.toContain("Add a DeepSeek key");
    expect(member).not.toContain(">Save<");
  });

  it("reviews the active setup's recommended changes before applying them to the form", () => {
    mocks.resource.data.value = resourceData({ nonOwner: { colleague: proCodex } });
    const state = mount(ModelRoutingForm);
    expect(state.recommendedChanges).toEqual([]);
    state.activeSetup = "nonOwner";
    expect(state.recommendedChanges.map(({ role }) => role)).toEqual(["colleague", "quickHelper"], "Same as roles already follow");
    state.reviewRecommendations();
    state.useRecommendations();
    expect(state.draft.nonOwner).toMatchObject({ colleague: proClaude, fix: { follows: "colleague" }, quickHelper: flash });
  });

  it("ignores superseded draft previews and preserves edits when the saved revision changes", async () => {
    const first = Promise.withResolvers();
    const second = Promise.withResolvers();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const state = mount(ModelRoutingForm);
    state.update("owner", "quickHelper", flash);
    await nextTick();
    await vi.advanceTimersByTimeAsync(250);
    expect(state.previewPending).toBe(true);
    expect(mocks.request.mock.calls[0][0]).toBe("/api/accounts/model-routing/preview");
    state.update("owner", "quickHelper", { ...flash, variantId: "high" });
    await nextTick();
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.request.mock.calls[0][1].signal.aborted).toBe(true);
    second.resolve({ ...resourceData(), marker: "current" });
    await nextTick();
    await nextTick();
    first.resolve({ ...resourceData(), marker: "stale" });
    await nextTick();
    await nextTick();
    expect(state.preview.marker).toBe("current");
    mocks.resource.data.value = { ...resourceData(), revision: 4 };
    await nextTick();
    expect(state.stale).toBe(true);
    expect(state.draft.owner.quickHelper.variantId).toBe("high");
  });

  it("drops an unsaved draft immediately when the active viewer changes", async () => {
    const state = mount(ModelRoutingForm);
    state.update("owner", "quickHelper", flash);
    mocks.scopeKey.value = "member:first";
    expect(state.baseRevision).toBe(null);
    expect(state.draft).toEqual({ owner: {}, nonOwner: {} });
    mocks.resource.data.value = { ...resourceData(), canConfigure: false };
    await nextTick();
    expect(state.draft.owner.quickHelper.modelId).toBe("haiku");
  });
});

describe("proposals after a connection", () => {
  it("proposes owner roles whose global recommendation moves onto the connection", async () => {
    mocks.resource.data.value.setups.owner.roles.router.recommendation = flash;
    const state = mount(ModelRoutingForm, { connectionId: "deepseek" });
    expect(state.baseRevision).toBe(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.suggestedChanges.map(({ id }) => id)).toEqual(["owner:router"]);
    expect(state.proposals).toEqual(["owner:router"]);
    expect(mocks.command.buildRawPayload().owner).toEqual({ router: flash });
  });

  it("Use as main AI proposes Senior, Junior, Router and Quick helper on that provider and tool, even deliberate ones", async () => {
    const preferred = Object.fromEntries(Object.entries({ senior: proClaude, junior: { ...proClaude, variantId: "medium" }, router: flash,
      quickHelper: flash, colleague: { follows: "senior" } }).map(([role, recommendation]) => [role, { recommendation }]));
    mocks.request.mockResolvedValueOnce({ ok: true, setups: { owner: { roles: preferred } } });
    mocks.resource.data.value.setups.owner.roles.senior.value = { ...opus, selectionSource: "explicit" };
    const state = mount(ModelRoutingForm, { connectionId: "deepseek", preferEngineId: "claude" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.request).toHaveBeenCalledWith("/api/accounts/model-routing/preview", { method: "POST", signal: undefined,
      body: { revision: 3, preferProvider: { setup: "owner", modelProviderId: "deepseek", engineId: "claude" } } });
    expect(state.proposals).toEqual(["owner:senior", "owner:junior", "owner:router", "owner:quickHelper"]);
    expect(Object.keys(mocks.command.buildRawPayload().owner)).toEqual(["senior", "junior", "router", "quickHelper"]);
  });
});

describe("rows", () => {
  const role = (id) => ({ id, label: id, description: `${id} description` });

  it("shows a subscription's fixed tool under Advanced and no tool suffix", () => {
    const row = mount(ModelRoutingRow, { role: role("senior"), value: opus, choices: OWNER_CHOICES });
    expect([row.hasAdvanced, row.offDefault, row.fixedLine]).toEqual([true, false, "Runs in Claude Code — required by your Claude plan."]);
    expect(row.items.find(({ id }) => id === row.pickerValue)).toMatchObject({ label: "Opus 5.5", personal: true, providerLabel: "Claude" });
  });

  it("lists each model once, with Runs in only where a real choice exists, defaulting DeepSeek to Claude Code", () => {
    const row = mount(ModelRoutingRow, { role: role("junior"), value: proClaude, choices: OWNER_CHOICES, recommendation: proClaude });
    expect(row.items.map(({ label }) => label)).toEqual(["Opus 5.5", "Haiku 5.5", "DeepSeek V4 Pro", "DeepSeek V4.1 Flash"]);
    expect(row.items.find(({ label }) => label === "DeepSeek V4 Pro")).toMatchObject({ recommended: true, defaultEngineId: "claude" });
    expect([row.hasAdvanced, row.runsIn, row.offDefault, row.fixedLine]).toEqual([true, ["claude", "codex"], false, ""]);
    row.chooseRunsIn("codex");
    expect(row.events.at(-1)).toEqual(["update", { ...proCodex, selectionSource: "explicit" }]);
    app.unmount();
    const onCodex = mount(ModelRoutingRow, { role: role("junior"), value: proCodex, choices: OWNER_CHOICES });
    expect(onCodex.offDefault).toBe(true);
    // Choosing another model takes its default tool and keeps the thinking it offers.
    onCodex.chooseModel(onCodex.items.find(({ label }) => label === "DeepSeek V4.1 Flash").id);
    expect(onCodex.events.at(-1)).toEqual(["update", { ...flash, variantId: "high", selectionSource: "explicit" }]);
    app.unmount();
    const single = mount(ModelRoutingRow, { role: role("quickHelper"), value: flash, choices: OWNER_CHOICES });
    expect([single.hasAdvanced, single.elsewhere]).toEqual([false, ["codex", "opencode"]]);
  });

  it("keeps an unavailable saved choice visible and disabled", () => {
    const gone = selection("codex", "openai", "gpt-6-astra");
    const row = mount(ModelRoutingRow, { role: role("senior"), value: gone, choices: OWNER_CHOICES });
    expect(row.pickerValue).toBe("saved");
    expect(row.items[0]).toMatchObject({ label: "gpt-6-astra", status: "Unavailable saved choice", props: { disabled: true } });
    expect(row.hasAdvanced).toBe(false);
  });

  it("renders the tool beside the model only off its default, and Use Senior's model on an explicit following role", async () => {
    const offDefault = await render(ModelRoutingRow, { role: role("junior"), value: proCodex, choices: OWNER_CHOICES });
    expect(offDefault).toContain("runs in Codex");
    expect(offDefault).toContain("Advanced");
    const explicit = await render(ModelRoutingRow, { role: role("colleague"), value: proClaude, choices: OWNER_CHOICES, defaultFollows: "senior" });
    expect(explicit).not.toContain("runs in");
    expect(explicit).toContain("Use Senior's model");
    const follows = await render(ModelRoutingRow, { role: role("fix"), value: { follows: "junior" }, followedLabel: "Opus 5.5 · Medium", choices: OWNER_CHOICES });
    expect(follows).toContain("Same as Junior · Opus 5.5 · Medium");
    expect(follows).toContain("Change");
    expect(follows).not.toContain("Advanced");
  });
});
