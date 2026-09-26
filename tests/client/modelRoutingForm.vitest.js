import { computed, createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, scopeKey: null, request: vi.fn(), command: null }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useModelRouting.js", () => ({
  useModelRouting: () => ({ resource: mocks.resource, scopeKey: mocks.scopeKey, engines: computed(() => mocks.resource.data.value?.engines || []), loadError: ref("") })
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
  return { ok: true, revision: 3, canConfigure: true, engines: [{ engineId: "codex", label: "Codex",
    roles: Object.fromEntries(["senior", "junior", "intern", "router", "sharedBackup"].map((role) => [role, {
      assignment: role === "senior" ? astra : role === "junior" ? { ...astra, selectionSource: "explicit" } : pickle,
      recommendation: role === "senior" ? astra : deepseek, choices, error: ""
    }])), preview: { owner: {}, collaborator: {} } }] };
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

it("hydrates a warm routing resource immediately and keeps engine identities distinct", async () => {
  const state = mount();
  expect(state.baseRevision).toBe(3);
  expect(state.draft.codex.router.modelId).toBe("big-pickle");
  expect(state.choiceId(deepseek)).not.toBe(state.choiceId(foreign));
  state.choose("intern", state.choiceId(foreign));
  expect(mocks.command.buildRawPayload().orchestrators.codex.intern).toMatchObject({ engineId: "opencode", selectionSource: "explicit" });
  expect(mocks.command.buildRawPayload().orchestrators.codex.junior).toBeUndefined();
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
  expect(state.recommendationReview.changes.map(({ role }) => role)).toEqual(["router", "senior", "intern"]);
  expect(state.recommendationReview.changes[1]).toMatchObject({
    description: "default thinking", proposed: { modelId: "gpt-6-astra", variantId: "" }
  });
  expect(state.recommendationReview.changes[0].description).toBe("deepseek-flash · codex");
  state.recommendationReview = null;
  expect(JSON.stringify(state.draft)).toBe(before);
  state.reviewRecommendations();
  state.useRecommendations();
  expect(state.draft.codex).toMatchObject({ senior: astra, junior: { modelId: "deepseek-flash", selectionSource: "explicit" }, intern: deepseek, router: deepseek, sharedBackup: pickle });
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
  state.selectedEngine = "other";
  expect(state.recommendationReview).toBeNull();
  state.selectedEngine = "codex";
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
  const state = mount({ connectionId: "deepseek", connectionEngines: ["codex", "claude"] });
  expect(state.baseRevision).toBe(null);
  expect(mocks.resource.reload).toHaveBeenCalledOnce();
  refreshed.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.baseRevision).toBe(3);
  expect(state.suggestedChanges.map(({ id }) => id)).toEqual(["codex:junior", "codex:intern", "codex:router", "codex:sharedBackup"]);
  expect(state.proposals).toEqual(["codex:intern", "codex:router", "codex:sharedBackup"]);
  const payload = mocks.command.buildRawPayload();
  expect(payload.orchestrators.codex.junior).toBeUndefined();
  expect(payload.orchestrators.claude).toBeUndefined();
  expect(payload.orchestrators.codex.intern.modelId).toBe("deepseek-flash");
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
  state.choose("intern", state.choiceId(deepseek));
  await nextTick();
  await vi.advanceTimersByTimeAsync(250);
  expect(state.previewPending).toBe(true);
  state.choose("intern", state.choiceId(foreign));
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
  expect(state.draft.codex.intern.engineId).toBe("opencode");
});

it("members receive the saved viewer result without calling the owner draft endpoint", async () => {
  mocks.resource.data.value.canConfigure = false;
  const state = mount({ readonly: true });
  expect(state.canEdit).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.request).not.toHaveBeenCalled();
});

it("accepts late setup defaults while untouched and preserves changed proposal checkboxes", async () => {
  const state = mount({ connectionId: "deepseek", connectionEngines: ["codex"] });
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
  state.choose("intern", state.choiceId(deepseek));
  mocks.scopeKey.value = "member:first";
  expect(state.baseRevision).toBe(null);
  expect(state.draft).toEqual({});
  expect(state.preview).toBe(null);
  mocks.resource.data.value = { ...resourceData(), canConfigure: false };
  await nextTick();
  expect(state.canEdit).toBe(false);
  expect(state.draft.codex.intern.modelId).toBe("big-pickle");
});


it("sends only edits without disabling absent roles in another workflow", () => {
  const empty = structuredClone(resourceData().engines[0]);
  empty.engineId = "claude";
  for (const role of Object.values(empty.roles)) role.assignment = null;
  mocks.resource.data.value.engines.push(empty);
  const state = mount();
  expect(mocks.command.buildRawPayload().orchestrators).toEqual({});
  state.choose("intern", state.choiceId(foreign));
  expect(mocks.command.buildRawPayload().orchestrators).toEqual({ codex: { intern: expect.objectContaining({ modelId: "deepseek-flash" }) } });
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
  expect(state.roleHint({ id: "senior" })).toBe("Collaborators: big-pickle · opencode / opencode (shared backup)");
  expect(state.roleHint({ id: "junior" })).toBe("Collaborators: deepseek-flash · codex / deepseek");
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
  expect(state.roleHint({ id: "senior" })).toBe("Collaborators: deepseek-flash · codex / deepseek (shared backup)");
});

it("does not expose or submit the retired temporary chat default from cached data", () => {
  mocks.resource.data.value.temporaryChatRole = "junior";
  const state = mount();
  expect(state.temporaryChatRole).toBeUndefined();
  expect(mocks.command.buildRawPayload()).toEqual({ revision: 3, orchestrators: {}, reviewedHelperWorkflows: [] });
});
