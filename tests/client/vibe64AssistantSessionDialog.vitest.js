import { computed, createRenderer, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, branches: null, branchOptions: null, routingOptions: null, openSettings: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: (options) => {
    mocks.branchOptions = options;
    return mocks.branches;
  }
}));
vi.mock("@local/vibe64-accounts/client", () => ({
  useModelRouting: (options) => (mocks.routingOptions = options, { resource: mocks.resource, loadError: ref(""),
    mainChatSelection: computed(() => mocks.resource.data.value?.setups?.owner?.roles?.senior?.effective ||
      mocks.resource.data.value?.setups?.owner?.roles?.senior?.recommendation || null) })
}));
vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({ requestVibe64AccountConnectionsDialog: mocks.openSettings }));
import AssistantSessionDialog from "../../src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue";

const senior = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex", modelProviderId: "openai",
  modelId: "gpt-6-astra", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}` };
let app;
function mount(toolbar = {}) {
  const createSession = vi.fn(async () => ({ ok: true, sessionId: "new-chat" }));
  const created = vi.fn();
  const update = vi.fn();
  const renderer = createRenderer({ createComment: (text) => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...AssistantSessionDialog, render: () => null }, {
    modelValue: true, toolbar: { createSession, ...toolbar }, onCreated: created, "onUpdate:modelValue": update
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { state: app._instance.setupState, createSession, created, update };
}
beforeEach(() => {
  mocks.openSettings.mockReset();
  mocks.branchOptions = null;
  mocks.branches = {
    data: ref({ defaultBranch: "main", branches: [{ name: "main", commit: "a".repeat(40) }] }),
    isLoading: ref(false), loadError: ref(""), reload: vi.fn()
  };
  mocks.resource = { data: ref({ ok: true, setups: { owner: { roles: { senior: { effective: senior, recommendation: null } } } } }),
    isInitialLoading: ref(false), reload: vi.fn() };
});
afterEach(() => app?.unmount());

it("shows main chat's AI from the owner's setup and submits no tool or model choice", async () => {
  const f = mount();
  expect(f.state.mainSelection).toEqual(senior);
  // The dialog never waits for every engine's live model catalogue.
  expect(mocks.routingOptions.view).toBe("main");
  f.state.openConnectionSettings();
  expect(mocks.openSettings).toHaveBeenCalledWith({ section: "ai" });
  await f.state.submit();
  expect(f.createSession).toHaveBeenCalledWith({}, {});
  expect(f.created).toHaveBeenCalledWith({ ok: true, sessionId: "new-chat" });
  expect(f.update).toHaveBeenCalledWith(false);
});

it("uses Senior's recommendation before the setup is saved and cannot submit without an AI", async () => {
  mocks.resource.data.value.setups.owner.roles.senior = { effective: null, recommendation: senior };
  expect(mount().state.mainSelection).toEqual(senior);
  app.unmount();
  mocks.resource.data.value.setups.owner.roles.senior = { effective: null, recommendation: null };
  const f = mount();
  await f.state.submit();
  expect(f.createSession).not.toHaveBeenCalled();
});

it("creation stays open on failure", async () => {
  const f = mount();
  f.createSession.mockResolvedValue({ ok: false, error: "Routing changed" });
  await f.state.submit();
  expect(f.created).not.toHaveBeenCalled();
  expect(f.update).not.toHaveBeenCalled();
});

it("creation publishes a reviewed branch selection", async () => {
  const f = mount({ projectContext: { slug: "app", repository: { mode: "github", defaultBranch: "main" } } });
  expect(mocks.branchOptions.enabled.value).toBe(false);
  f.state.branchMode = "new";
  f.state.newBranchName = "feature/review";
  await f.state.submit();
  expect(f.createSession).toHaveBeenCalledWith({}, {
    repositoryBranch: { name: "feature/review", fromBranch: "main", expectedCommit: "a".repeat(40) }
  });
});
