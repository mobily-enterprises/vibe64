import { computed, createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, scopeKey: null, request: vi.fn(), command: null }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useModelRouting.js", () => ({
  useModelRouting: () => ({ resource: mocks.resource, scopeKey: mocks.scopeKey,
    engines: computed(() => mocks.resource.data.value?.engines || []),
    setups: computed(() => mocks.resource.data.value?.setups || null), loadError: ref("") })
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand(options) { mocks.command = options; return { run: vi.fn() }; }
}));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
vi.mock("../../packages/vibe64-accounts/src/client/lib/accountsGateApi.js", () => ({ ACCOUNTS_ENDPOINT: "/api/accounts" }));
vi.mock("vuetify", () => ({ useDisplay: () => ({ smAndDown: ref(false) }) }));
import ModelRoutingForm from "../../packages/vibe64-accounts/src/client/studio/ModelRoutingForm.vue";

const selection = (engineId, provider, modelId, selectionSource = "recommended") => ({
  schema: "vibe64.assistant-selection.v1", engineId, modelProviderId: provider, modelId,
  agentId: engineId, variantId: "", catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource
});
const astra = selection("codex", "openai", "gpt-6-astra");
const deepseek = selection("codex", "deepseek", "deepseek-flash");
const foreign = selection("opencode", "deepseek", "deepseek-flash");
const pickle = selection("opencode", "opencode", "big-pickle");
const OWNER_ROLES = ["senior", "junior", "router", "colleague", "fix", "explain", "quickHelper"];
const TEAM_ROLES = ["colleague", "fix", "explain", "quickHelper"];
const ownerRecommendations = { senior: astra, colleague: { follows: "senior" }, fix: { follows: "junior" }, explain: { follows: "quickHelper" } };
const teamRecommendations = { fix: { follows: "colleague" }, explain: { follows: "quickHelper" } };
function resourceData() {
  const choices = [astra, deepseek, foreign, pickle].map((item) => ({ ...item, label: item.modelId, engineLabel: item.engineId,
    providerLabel: item.modelProviderId, accessLabel: item === astra ? "Personal use" : "Workspace use", ownerOnly: item === astra, available: true, variants: [] }));
  const owner = { senior: astra, junior: { ...astra, selectionSource: "explicit" }, router: pickle, quickHelper: pickle,
    colleague: { follows: "senior" }, fix: { follows: "junior" } };
  const role = (values, name, recommendation) => ({ value: values[name] ?? null, configured: Object.hasOwn(values, name),
    recommendation, choices, error: "" });
  return { ok: true, revision: 3, canConfigure: true, team: { available: true, ownerName: "Owner", memberCount: 2 },
    engines: [{ engineId: "codex", label: "Codex", connected: true }],
    setups: {
      owner: { roles: Object.fromEntries(OWNER_ROLES.map((name) => [name, role(owner, name, ownerRecommendations[name] || deepseek)])), preview: {} },
      nonOwner: { roles: Object.fromEntries(TEAM_ROLES.map((name) => [name, role({ colleague: pickle }, name, teamRecommendations[name] || pickle)])), preview: {} }
    } };
}
let app;
function mount(props = {}) {
  const renderer = createRenderer({ createComment: (text) => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...ModelRoutingForm, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.scopeKey = ref("owner:first");
  mocks.resource = { data: ref(resourceData()), isInitialLoading: ref(false), loadError: ref(""), reload: vi.fn(async () => {}) };
  mocks.request.mockReset();
});
afterEach(() => { app?.unmount(); vi.useRealTimers(); });

it("hydrates both setups, keeps absent roles absent and sends only edited roles", () => {
  const state = mount();
  expect(state.baseRevision).toBe(3);
  expect(state.draft.owner.router.modelId).toBe("big-pickle");
  expect(Object.hasOwn(state.draft.owner, "explain")).toBe(false);
  expect(state.draft.nonOwner).toEqual({ colleague: pickle });
  expect(state.choiceId(deepseek)).not.toBe(state.choiceId(foreign));
  expect(mocks.command.buildRawPayload()).toEqual({ revision: 3 });
  state.choose("owner", "quickHelper", state.choiceId(foreign));
  state.choose("nonOwner", "fix", "follows:colleague");
  expect(mocks.command.buildRawPayload()).toEqual({ revision: 3,
    owner: { quickHelper: { ...foreign, selectionSource: "explicit" } }, nonOwner: { fix: { follows: "colleague" } } });
});

it("offers Same as only to following roles and groups model choices by tool", () => {
  const state = mount();
  const fix = state.items("owner", "fix");
  expect(fix.filter((item) => item.id.startsWith("follows:")).map((item) => item.label))
    .toEqual(["Same as Senior", "Same as Junior", "Same as Router", "Same as Explain & check", "Same as Quick helper"]);
  expect(state.items("owner", "senior").some((item) => item.id.startsWith("follows:"))).toBe(false);
  expect(fix.filter((item) => item.type === "subheader").map((item) => item.label)).toEqual(["codex", "opencode"]);
  expect(fix.find((item) => item.id === state.choiceId(astra))).toMatchObject({ personal: true, props: { subtitle: "openai" } });
  expect(state.personalProviders).toEqual(["openai"]);
  expect(state.selectionLabel("owner", "colleague", { follows: "senior" })).toBe("Same as Senior");
});

it("shows the team setup only to the owner and never previews for a reader", async () => {
  expect(mount().visibleSetups.map(({ id }) => id)).toEqual(["owner", "nonOwner"]);
  app.unmount();
  mocks.resource.data.value.canConfigure = false;
  const state = mount({ readonly: true });
  expect(state.canEdit).toBe(false);
  expect(state.visibleSetups.map(({ id }) => id)).toEqual(["owner"]);
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.request).not.toHaveBeenCalled();
});

it("reviews recommended changes across both setups before applying them to the form", () => {
  const state = mount();
  expect(state.recommendedChanges.map(({ setup, role }) => `${setup}.${role}`)).toEqual([
    "owner.junior", "owner.router", "owner.explain", "owner.quickHelper", "nonOwner.fix", "nonOwner.explain", "nonOwner.quickHelper"]);
  state.reviewRecommendations();
  state.useRecommendations();
  expect(state.draft.owner.junior.modelId).toBe("deepseek-flash");
  expect(state.draft.nonOwner.quickHelper.modelId).toBe("big-pickle");
  expect(state.draft.nonOwner.fix).toEqual({ follows: "colleague" });
  expect(state.recommendationReview).toBe(null);
});

it("ignores superseded draft previews and preserves edits when the saved revision changes", async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const state = mount();
  state.choose("owner", "quickHelper", state.choiceId(deepseek));
  await nextTick();
  await vi.advanceTimersByTimeAsync(250);
  expect(state.previewPending).toBe(true);
  expect(mocks.request.mock.calls[0][0]).toBe("/api/accounts/model-routing/preview");
  state.choose("owner", "quickHelper", state.choiceId(foreign));
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
  expect(state.baseRevision).toBe(3);
  expect(state.draft.owner.quickHelper.engineId).toBe("opencode");
});

it("refreshes post-connection choices and proposes owner roles that move onto the connection", async () => {
  const refreshed = Promise.withResolvers();
  mocks.resource.reload.mockImplementation(async () => refreshed.promise);
  const state = mount({ connectionId: "deepseek" });
  expect(state.baseRevision).toBe(null);
  expect(mocks.resource.reload).toHaveBeenCalledOnce();
  refreshed.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.baseRevision).toBe(3);
  expect(state.suggestedChanges.map(({ id }) => id)).toEqual(["owner:junior", "owner:router", "owner:quickHelper"]);
  // A deliberately chosen Junior stays unchecked.
  expect(state.proposals).toEqual(["owner:router", "owner:quickHelper"]);
  const payload = mocks.command.buildRawPayload();
  expect(payload.owner.junior).toBeUndefined();
  expect(payload.owner.router.modelId).toBe("deepseek-flash");
  expect(payload.nonOwner).toBeUndefined();
  state.customize();
  expect(state.draft.owner.router.modelId).toBe("deepseek-flash");
  expect(state.proposalMode).toBe(false);
});

it("drops an unsaved draft immediately when the active viewer changes", async () => {
  const state = mount();
  state.choose("owner", "quickHelper", state.choiceId(deepseek));
  mocks.scopeKey.value = "member:first";
  expect(state.baseRevision).toBe(null);
  expect(state.draft).toEqual({ owner: {}, nonOwner: {} });
  mocks.resource.data.value = { ...resourceData(), canConfigure: false };
  await nextTick();
  expect(state.draft.owner.quickHelper.modelId).toBe("big-pickle");
});
