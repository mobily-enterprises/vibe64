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
    roles: Object.fromEntries(["plan", "code", "economy", "router", "sharedBackup"].map((role) => [role, {
      assignment: role === "plan" ? astra : role === "code" ? { ...astra, selectionSource: "explicit" } : pickle,
      recommendation: role === "plan" ? astra : deepseek, choices, error: ""
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
  state.choose("economy", state.choiceId(foreign));
  expect(mocks.command.buildRawPayload().orchestrators.codex.economy).toMatchObject({ engineId: "opencode", selectionSource: "explicit" });
  expect(mocks.command.buildRawPayload().orchestrators.codex.code).toBeUndefined();
});

it("refreshes post-connection choices, proposes each role separately, and keeps custom Code unchecked", async () => {
  const unavailable = structuredClone(resourceData().engines[0]);
  unavailable.engineId = "claude";
  unavailable.roles.plan.recommendation = null;
  unavailable.roles.code.recommendation = null;
  mocks.resource.data.value.engines.push(unavailable);
  const refreshed = Promise.withResolvers();
  mocks.resource.reload.mockImplementation(async () => refreshed.promise);
  const state = mount({ connectionId: "deepseek", connectionEngines: ["codex", "claude"] });
  expect(state.baseRevision).toBe(null);
  expect(mocks.resource.reload).toHaveBeenCalledOnce();
  refreshed.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.baseRevision).toBe(3);
  expect(state.suggestedChanges.map(({ id }) => id)).toEqual(["codex:code", "codex:economy", "codex:router", "codex:sharedBackup"]);
  expect(state.proposals).toEqual(["codex:economy", "codex:router", "codex:sharedBackup"]);
  const payload = mocks.command.buildRawPayload();
  expect(payload.orchestrators.codex.code).toBeUndefined();
  expect(payload.orchestrators.claude).toBeUndefined();
  expect(payload.orchestrators.codex.economy.modelId).toBe("deepseek-flash");
  state.customize();
  expect(state.draft.codex.router.modelId).toBe("deepseek-flash");
  expect(state.draft.codex.plan.modelId).toBe("gpt-6-astra");
  expect(state.proposalMode).toBe(false);
});

it("ignores superseded draft previews and preserves edits when the saved revision changes", async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const state = mount();
  state.choose("economy", state.choiceId(deepseek));
  await nextTick();
  await vi.advanceTimersByTimeAsync(250);
  expect(state.previewPending).toBe(true);
  state.choose("economy", state.choiceId(foreign));
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
  expect(state.draft.codex.economy.engineId).toBe("opencode");
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
  state.proposals = ["codex:code"];
  mocks.resource.data.value = { ...resourceData(), revision: 5 };
  await nextTick();
  expect(state.baseRevision).toBe(4);
  expect(state.stale).toBe(true);
  expect(state.proposals).toEqual(["codex:code"]);
});

it("drops an unsaved owner draft immediately when the active viewer changes", async () => {
  const state = mount();
  state.choose("economy", state.choiceId(deepseek));
  mocks.scopeKey.value = "member:first";
  expect(state.baseRevision).toBe(null);
  expect(state.draft).toEqual({});
  expect(state.preview).toBe(null);
  mocks.resource.data.value = { ...resourceData(), canConfigure: false };
  await nextTick();
  expect(state.canEdit).toBe(false);
  expect(state.draft.codex.economy.modelId).toBe("big-pickle");
});


it("sends only edits without disabling absent roles in another workflow", () => {
  const empty = structuredClone(resourceData().engines[0]);
  empty.engineId = "claude";
  for (const role of Object.values(empty.roles)) role.assignment = null;
  mocks.resource.data.value.engines.push(empty);
  const state = mount();
  expect(mocks.command.buildRawPayload().orchestrators).toEqual({});
  state.choose("economy", state.choiceId(foreign));
  expect(mocks.command.buildRawPayload().orchestrators).toEqual({ codex: { economy: expect.objectContaining({ modelId: "deepseek-flash" }) } });
  state.choose("router", "");
  expect(mocks.command.buildRawPayload().orchestrators.codex.router).toBeNull();
});
