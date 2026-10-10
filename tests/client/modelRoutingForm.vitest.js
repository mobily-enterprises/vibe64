import { computed, createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, scopeKey: null, request: vi.fn(), command: null, routingOptions: [] }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useModelRouting.js", () => ({
  useModelRouting: (options) => {
    mocks.routingOptions.push(options);
    return { resource: mocks.resource, scopeKey: mocks.scopeKey, engines: computed(() => mocks.resource.data.value?.engines || []), loadError: ref("") };
  }
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
function resourceData() {
  const choices = [astra, deepseek, foreign, pickle].map((item) => ({ ...item, label: item.modelId, engineLabel: item.engineId,
    providerLabel: item.modelProviderId, accessLabel: item === astra ? "Personal use" : "Workspace use", available: true, variants: [] }));
  return { ok: true, revision: 3, canConfigure: true, engines: [{ engineId: "codex", label: "Codex", connected: true,
    roles: Object.fromEntries(["senior", "junior", "helper", "router", "sharedBackup"].map((role) => [role, {
      assignment: role === "senior" ? astra : role === "junior" ? { ...astra, selectionSource: "explicit" } : pickle,
      recommendation: role === "senior" ? astra : deepseek, choices, error: ""
    }])), preview: { owner: {}, collaborator: {} } }] };
}
let app;
function mount(props = {}) {
  const renderer = createRenderer({ createComment: (text) => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...ModelRoutingForm, render: () => null }, { engineId: "codex", ...props });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.scopeKey = ref("owner:first");
  mocks.resource = { data: ref(resourceData()), isInitialLoading: ref(false), loadError: ref(""), reload: vi.fn(async () => {}) };
  mocks.request.mockReset();
  mocks.routingOptions = [];
});
afterEach(() => { app?.unmount(); vi.useRealTimers(); });

it("hydrates a warm routing resource immediately and keeps engine identities distinct", async () => {
  const state = mount();
  expect(state.baseRevision).toBe(3);
  expect(state.draft.codex.router.modelId).toBe("big-pickle");
  expect(state.choiceId(deepseek)).not.toBe(state.choiceId(foreign));
  state.choose("helper", state.choiceId(foreign));
  expect(mocks.command.buildRawPayload().orchestrators.codex.helper).toMatchObject({ engineId: "opencode", selectionSource: "explicit" });
  expect(mocks.command.buildRawPayload().orchestrators.codex.junior).toBeUndefined();
});

it("groups model choices by agent without thinking and keeps thinking in its separate control", () => {
  const role = mocks.resource.data.value.engines[0].roles.router;
  role.assignment = { ...deepseek, variantId: "low" };
  role.choices = role.choices.map(choice => ({ ...choice, variantId: "high",
    variants: [{ id: "low", label: "Low" }, { id: "high", label: "High" }] }));
  const state = mount();
  const options = state.items("router");
  const labels = options.map(item => item.label);
  expect(options.filter(item => item.type === "subheader").map(item => item.label)).toEqual(["Codex", "OpenCode"]);
  expect(options.find(item => item.id === state.choiceId(deepseek))).toMatchObject({ recommended: true, props: { subtitle: "deepseek · Workspace use", disabled: false } });
  expect(options.find(item => item.id === state.choiceId(foreign))).toMatchObject({ recommended: false });
  expect(labels).toContain("gpt-6-astra");
  expect(labels).toContain("deepseek-flash");
  expect(state.items("router").filter(item => item.label === "deepseek-flash").map(item => item.agent)).toEqual(["Codex", "OpenCode"]);
  expect(labels.join(" ")).not.toMatch(/\b(?:low|high|default|not recorded)\b/);
  expect(state.draft.codex.router.variantId).toBe("low");
  state.choose("router", state.choiceId(astra));
  expect(state.draft.codex.router.variantId).toBe("high");
  state.changeEffort("router", "low");
  expect(state.draft.codex.router.variantId).toBe("low");
  expect(state.items("router").find(item => item.id === state.choiceId(astra)).label).toBe("gpt-6-astra");
  expect(mocks.command.buildRawPayload().orchestrators.codex.router).toMatchObject({ modelId: "gpt-6-astra", variantId: "low" });
  state.draft.codex.router = { ...astra, modelId: "unavailable-model", variantId: "high" };
  expect(state.items("router").find(item => item.id === state.choiceId(state.draft.codex.router))).toMatchObject({ label: "unavailable-model", status: "Unavailable saved choice", agent: "Codex", props: { disabled: true } });
  expect(state.selectionLabel(state.draft.codex.router)).toBe("Codex (unavailable-model high)");
  role.choices[1].compatibilityError = "History compatibility not verified";
  expect(state.items("router").find(item => item.id === state.choiceId(deepseek))).toMatchObject({ status: "Compatibility pending", recommended: false, props: { disabled: true } });
});

it("reviews only changes to the current draft before applying recommendations to one workflow", () => {
  const other = structuredClone(resourceData().engines[0]);
  other.engineId = "opencode";
  mocks.resource.data.value.engines.push(other);
  mocks.resource.data.value.engines[0].roles.sharedBackup.recommendation = null;
  const state = mount();
  state.choose("junior", state.choiceId(deepseek));
  state.changeEffort("senior", "high");
  const before = JSON.stringify(state.draft);
  state.reviewRecommendations();
  expect(JSON.stringify(state.draft)).toBe(before);
  expect(state.recommendationReview.changes.map(({ role }) => role)).toEqual(["router", "senior", "helper"]);
  expect(state.recommendationReview.changes[1]).toMatchObject({
    description: "Codex (gpt-6-astra default)", proposed: { modelId: "gpt-6-astra", variantId: "" }
  });
  expect(state.recommendationReview.changes[0].description).toBe("Codex (deepseek-flash default) · codex agent");
  state.recommendationReview = null;
  expect(JSON.stringify(state.draft)).toBe(before);
  state.reviewRecommendations();
  state.useRecommendations();
  expect(state.draft.codex).toMatchObject({ senior: astra, junior: { modelId: "deepseek-flash", selectionSource: "explicit" }, helper: deepseek, router: deepseek, sharedBackup: pickle });
  expect(state.draft.opencode.senior).toEqual(astra);
  expect(state.recommendationReview).toBeNull();
  expect(mocks.resource.reload).not.toHaveBeenCalled();
  expect(state.recommendedChanges).toEqual([]);
  state.reviewRecommendations();
  expect(state.recommendationReview).toBeNull();
});

it("invalidates recommendation reviews when routing reloads or workflow ownership changes", async () => {
  const state = mount();
  state.reviewRecommendations();
  app._instance.props.engineId = "other";
  expect(state.recommendationReview).toBeNull();
  app._instance.props.engineId = "codex";
  state.reviewRecommendations();
  mocks.resource.data.value = { ...resourceData(), revision: 4 };
  await nextTick();
  expect(state.recommendationReview).toBeNull();
  state.choose("senior", state.choiceId(deepseek));
  state.reviewRecommendations();
  mocks.resource.data.value = { ...resourceData(), revision: 5 };
  await nextTick();
  expect(state.stale).toBe(true);
  state.useRecommendations();
  expect(state.draft.codex.router).toEqual(pickle);
  mocks.scopeKey.value = "member:other";
  expect(state.recommendationReview).toBeNull();
});

it("refreshes post-connection choices, proposes each role separately, and keeps custom Junior unchecked", async () => {
  const unavailable = structuredClone(resourceData().engines[0]);
  unavailable.engineId = "claude";
  unavailable.roles.senior.recommendation = null;
  unavailable.roles.junior.recommendation = null;
  mocks.resource.data.value.engines.push(unavailable);
  const refreshed = Promise.withResolvers();
  mocks.resource.reload.mockImplementation(async () => refreshed.promise);
  const state = mount({ connectionId: "deepseek" });
  expect(state.baseRevision).toBe(null);
  expect(mocks.resource.reload).toHaveBeenCalledOnce();
  refreshed.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.baseRevision).toBe(3);
  expect(state.suggestedChanges.map(({ id }) => id)).toEqual(["codex:junior", "codex:helper", "codex:router", "codex:sharedBackup"]);
  expect(state.proposals).toEqual(["codex:helper", "codex:router", "codex:sharedBackup"]);
  const payload = mocks.command.buildRawPayload();
  expect(payload.orchestrators.codex.junior).toBeUndefined();
  expect(payload.orchestrators.claude).toBeUndefined();
  expect(payload.orchestrators.codex.helper.modelId).toBe("deepseek-flash");
  state.customize();
  expect(state.draft.codex.router.modelId).toBe("deepseek-flash");
  expect(state.draft.codex.senior.modelId).toBe("gpt-6-astra");
  expect(state.proposalMode).toBe(false);
});

it("ignores superseded draft previews and preserves edits when the saved revision changes", async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const state = mount();
  state.choose("helper", state.choiceId(deepseek));
  await nextTick();
  await vi.advanceTimersByTimeAsync(250);
  expect(state.previewPending).toBe(true);
  state.choose("helper", state.choiceId(foreign));
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
  expect(state.draft.codex.helper.engineId).toBe("opencode");
});

it("members receive the saved viewer result without calling the owner draft endpoint", async () => {
  mocks.resource.data.value.canConfigure = false;
  const state = mount({ readonly: true });
  expect(state.canEdit).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.request).not.toHaveBeenCalled();
});

it("accepts late setup defaults while untouched and preserves changed proposal checkboxes", async () => {
  const state = mount({ connectionId: "deepseek" });
  await vi.advanceTimersByTimeAsync(0);
  const connected = resourceData();
  connected.revision = 4;
  connected.engines[0].roles.router.assignment = deepseek;
  mocks.resource.data.value = connected;
  await nextTick();
  expect(state.baseRevision).toBe(4);
  expect(state.draft.codex.router.modelId).toBe("deepseek-flash");
  state.proposals = ["codex:junior"];
  mocks.resource.data.value = { ...resourceData(), revision: 5 };
  await nextTick();
  expect(state.baseRevision).toBe(4);
  expect(state.stale).toBe(true);
  expect(state.proposals).toEqual(["codex:junior"]);
});

it("drops an unsaved owner draft immediately when the active viewer changes", async () => {
  const state = mount();
  state.choose("helper", state.choiceId(deepseek));
  mocks.scopeKey.value = "member:first";
  expect(state.baseRevision).toBe(null);
  expect(state.draft).toEqual({});
  expect(state.preview).toBe(null);
  mocks.resource.data.value = { ...resourceData(), canConfigure: false };
  await nextTick();
  expect(state.canEdit).toBe(false);
  expect(state.draft.codex.helper.modelId).toBe("big-pickle");
});


it("sends only edits without disabling absent roles in another workflow", () => {
  const empty = structuredClone(resourceData().engines[0]);
  empty.engineId = "claude";
  for (const role of Object.values(empty.roles)) role.assignment = null;
  mocks.resource.data.value.engines.push(empty);
  const state = mount();
  expect(mocks.command.buildRawPayload().orchestrators).toEqual({});
  state.choose("helper", state.choiceId(foreign));
  expect(mocks.command.buildRawPayload().orchestrators).toEqual({ codex: { helper: expect.objectContaining({ modelId: "deepseek-flash" }) } });
  state.choose("router", "");
  expect(mocks.command.buildRawPayload().orchestrators.codex.router).toBeNull();
});


it("shows collaborators the effective assignment and preserves access restrictions", () => {
  const state = mount();
  state.preview = { engines: [{ engineId: "codex", preview: { collaborator: {
    senior: { available: true, effectiveSelection: pickle, backupUsed: true },
    junior: { available: true, effectiveSelection: deepseek },
    request_routing: { available: false, message: "Router uses a personal connection." }
  } } }] };
  expect(state.roleHint({ id: "senior" })).toBe("Collaborators: OpenCode (big-pickle default) (shared backup)");
  expect(state.roleHint({ id: "junior" })).toBe("Collaborators: Codex (deepseek-flash default)");
  expect(state.roleHint({ id: "router" })).toBe("Collaborators: Router uses a personal connection.");
  expect(state.roleHint({ id: "sharedBackup" })).toBe("");
  state.previewPending = true;
  expect(state.roleHint({ id: "senior" })).toBe("Checking access…");
});

it("refreshes collaborator labels when a changed backup produces a new effective model", async () => {
  mocks.resource.data.value.engines[0].preview.collaborator = {
    senior: { available: true, effectiveSelection: pickle, backupUsed: true }
  };
  const state = mount();
  expect(state.roleHint({ id: "senior" })).toContain("big-pickle");
  const updated = resourceData();
  updated.engines[0].preview.collaborator = {
    senior: { available: true, effectiveSelection: deepseek, backupUsed: true }
  };
  mocks.request.mockResolvedValue(updated);
  state.choose("sharedBackup", state.choiceId(deepseek));
  await vi.advanceTimersByTimeAsync(250);
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.request.mock.calls[0][1].body.orchestrators.codex.sharedBackup.modelId).toBe("deepseek-flash");
  expect(state.roleHint({ id: "senior" })).toBe("Collaborators: Codex (deepseek-flash default) (shared backup)");
});

it("does not expose or submit the retired temporary chat default from cached data", () => {
  mocks.resource.data.value.temporaryChatRole = "junior";
  const state = mount();
  expect(state.temporaryChatRole).toBeUndefined();
  expect(mocks.command.buildRawPayload()).toEqual({ revision: 3, engineId: "codex", orchestrators: {}, reviewedHelperWorkflows: [] });
});

it("keeps edits and Helper acknowledgement inside the named orchestrator", () => {
  const other = structuredClone(resourceData().engines[0]);
  other.engineId = "opencode";
  mocks.resource.data.value.engines.push(other);
  const state = mount({ engineId: "codex" });
  state.draft.opencode.helper = foreign;
  state.reviewedHelpers = ["codex", "opencode"];
  state.choose("helper", state.choiceId(deepseek));
  expect(state.reviewedHelpers).toEqual([]);
  state.reviewedHelpers = ["codex"];
  expect(mocks.command.buildRawPayload()).toMatchObject({ engineId: "codex", reviewedHelperWorkflows: ["codex"] });
  expect(Object.keys(mocks.command.buildRawPayload().orchestrators)).toEqual(["codex"]);
});

it("keeps the requested orchestrator when its connection disappears", async () => {
  mocks.resource.data.value.engines[0].connected = false;
  const state = mount({ engineId: "claude" });
  expect(state.selectedEngine).toBe("claude");
  expect(state.engine).toBeUndefined();
  await state.save();
  expect(mocks.resource.reload).not.toHaveBeenCalled();
});

it.each(["codex", "claude", "opencode"])("keeps %s connection suggestions, previews and saves in the selected orchestrator", async (engineId) => {
  mocks.resource.data.value.engines = ["opencode", "claude", "codex"].map(id => ({
    ...resourceData().engines[0], engineId: id, label: id,
    roles: Object.fromEntries(["senior", "junior", "helper", "router", "sharedBackup"].map(role => [role, {
      assignment: null, recommendation: selection(id, "deepseek", "deepseek-flash"), choices: []
    }]))
  }));
  const state = mount({ engineId, connectionId: "deepseek" });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.routingOptions[0].engineId.value).toBe(engineId);
  expect(state.selectedEngine).toBe(engineId);
  expect(state.suggestedChanges).toHaveLength(5);
  expect(state.suggestedChanges.every(change => change.engineId === engineId && change.proposed.engineId === engineId)).toBe(true);
  const payload = mocks.command.buildRawPayload();
  expect(payload.engineId).toBe(engineId);
  expect(Object.keys(payload.orchestrators)).toEqual([engineId]);
  await vi.advanceTimersByTimeAsync(250);
  expect(mocks.request.mock.calls[0][1].body).toEqual(payload);
  state.customize();
  expect(state.selectedEngine).toBe(engineId);
  expect(state.proposalMode).toBe(false);
  state.otherModelsRequested = true;
  expect(mocks.routingOptions[1].enabled.value).toBe(true);
  expect(mocks.command.buildRawPayload()).toEqual(payload);
});

it("does not substitute another orchestrator when the selected connection has no suggestions", async () => {
  const other = structuredClone(resourceData().engines[0]);
  other.engineId = "opencode";
  mocks.resource.data.value.engines.unshift(other);
  for (const role of Object.values(mocks.resource.data.value.engines[1].roles)) role.recommendation = foreign;
  const state = mount({ engineId: "codex", connectionId: "deepseek" });
  await vi.advanceTimersByTimeAsync(0);
  expect(state.selectedEngine).toBe("codex");
  expect(state.suggestedChanges).toEqual([]);
  expect(mocks.command.buildRawPayload()).toEqual({ revision: 3, engineId: "codex", orchestrators: {}, reviewedHelperWorkflows: [] });
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.request).not.toHaveBeenCalled();
});
