import { createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, scopeKey: null, branches: null, branchOptions: null, routingOptions: null }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: (options) => {
    mocks.branchOptions = options;
    return mocks.branches;
  }
}));
vi.mock("@local/vibe64-accounts/client", () => ({
  ModelRoutingForm: { render: () => null },
  useModelRouting: (options) => {
    mocks.routingOptions = options;
    return { resource: mocks.resource, scopeKey: mocks.scopeKey, loadError: ref("") };
  }
}));
vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({ requestVibe64AccountConnectionsDialog: vi.fn() }));
import WorkflowSelector from "../../src/components/studio/vibe64-session/Vibe64WorkflowSelector.vue";
import AssistantSessionDialog from "../../src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue";

let app;
function mount(component = WorkflowSelector) {
  const createSession = vi.fn(async () => ({ ok: true, sessionId: "new-chat" }));
  const created = vi.fn();
  const update = vi.fn();
  const workflow = vi.fn();
  const ready = vi.fn();
  const renderer = createRenderer({ createComment: (text) => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...component, render: () => null }, {
    active: true, "onUpdate:workflow": workflow, "onUpdate:ready": ready,
    modelValue: true, toolbar: { createSession }, onCreated: created, "onUpdate:modelValue": update
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { state: app._instance.setupState, createSession, created, update, workflow, ready };
}
beforeEach(() => {
  mocks.branchOptions = null;
  mocks.branches = {
    data: ref({ defaultBranch: "main", branches: [{ name: "main", commit: "a".repeat(40) }] }),
    isLoading: ref(false), loadError: ref(""), reload: vi.fn()
  };
  mocks.scopeKey = ref("owner:workspace");
  mocks.resource = { data: ref({ canConfigure: true, workflows: [
    { engineId: "codex", label: "Codex", available: true, planLabel: "Codex · gpt-6-astra", codeLabel: "Codex · deepseek-flash" },
    { engineId: "opencode", label: "OpenCode", available: true, planLabel: "OpenCode · big-pickle", codeLabel: "OpenCode · big-pickle" }
  ] }),
    isInitialLoading: ref(false), reload: vi.fn() };
});
afterEach(() => app?.unmount());

it("previews initial roles without writing and submits the workflow rather than a frozen model", async () => {
  const f = mount();
  expect(mocks.routingOptions.workflowsOnly).toBe(true);
  expect(f.state.choices).toHaveLength(2);
  expect(f.state.selectedChoice).toMatchObject({ engineId: "codex", available: true, planLabel: "Codex · gpt-6-astra", codeLabel: "Codex · deepseek-flash" });
  expect(f.createSession).not.toHaveBeenCalled();
  expect(f.workflow).toHaveBeenLastCalledWith("codex");
  expect(f.ready).toHaveBeenLastCalledWith(true);
});

it("shows a collaborator's backup pair and hides configuration", async () => {
  mocks.resource.data.value.canConfigure = false;
  Object.assign(mocks.resource.data.value.workflows[0], { backupUsed: true,
    planLabel: "OpenCode · big-pickle", codeLabel: "OpenCode · big-pickle" });
  const f = mount();
  expect(f.state.canConfigure).toBe(false);
  expect(f.state.selectedChoice).toMatchObject({ engineId: "codex", available: true, backupUsed: true,
    planLabel: "OpenCode · big-pickle", codeLabel: "OpenCode · big-pickle" });
  expect(f.workflow).toHaveBeenLastCalledWith("codex");
  expect(f.ready).toHaveBeenLastCalledWith(true);
});

it("retains an unavailable configured workflow with its reason and selects an available one", async () => {
  Object.assign(mocks.resource.data.value.workflows[0], { available: false, error: "Reconnect GPT" });
  const f = mount();
  expect(f.state.choices[0]).toMatchObject({ available: false, error: "Reconnect GPT" });
  expect(f.state.selectedChoiceId).toBe("opencode");
  f.state.selectedChoiceId = "codex";
  await nextTick();
  expect(f.workflow).toHaveBeenLastCalledWith("");
  expect(f.ready).toHaveBeenLastCalledWith(false);
});

it("keeps the selected workflow on a refresh", async () => {
  const f = mount();
  f.state.selectedChoiceId = "opencode";
  mocks.resource.data.value = { ...mocks.resource.data.value };
  await nextTick();
  expect(f.state.selectedChoiceId).toBe("opencode");

});

it("clears a previous actor's selection and configuration overlay immediately", async () => {
  const f = mount();
  f.state.routingOpen = true;
  mocks.scopeKey.value = "member:workspace";
  expect(f.state.selectedChoiceId).toBe("");
  expect(f.state.routingOpen).toBe(false);
  await nextTick();
  expect(f.workflow).toHaveBeenLastCalledWith("");
  expect(f.ready).toHaveBeenLastCalledWith(false);
});

it("creation submits only the selected workflow and closes after success", async () => {
  const f = mount(AssistantSessionDialog);
  f.state.workflowEngineId = "codex";
  f.state.workflowReady = true;
  await f.state.submit();
  expect(f.createSession).toHaveBeenCalledWith({}, { workflowEngineId: "codex" });
  expect(f.created).toHaveBeenCalledWith({ ok: true, sessionId: "new-chat" });
  expect(f.update).toHaveBeenCalledWith(false);
});

it("creation stays open on failure and cannot submit an unready workflow", async () => {
  const f = mount(AssistantSessionDialog);
  f.state.workflowEngineId = "codex";
  await f.state.submit();
  expect(f.createSession).not.toHaveBeenCalled();
  f.state.workflowReady = true;
  f.createSession.mockResolvedValue({ ok: false, error: "Routing changed" });
  await f.state.submit();
  expect(f.created).not.toHaveBeenCalled();
  expect(f.update).not.toHaveBeenCalled();
});

it("creation keeps the workflow choice when publishing a reviewed branch selection", async () => {
  const f = mount(AssistantSessionDialog);
  expect(mocks.branchOptions.enabled.value).toBe(false);
  f.state.workflowEngineId = "opencode";
  f.state.workflowReady = true;
  f.state.chooseBranch = true;
  f.state.createBranch = true;
  f.state.newBranchName = "feature/review";
  await f.state.submit();
  expect(f.createSession).toHaveBeenCalledWith({}, {
    workflowEngineId: "opencode",
    repositoryBranch: { name: "feature/review", fromBranch: "main", expectedCommit: "a".repeat(40) }
  });
});
