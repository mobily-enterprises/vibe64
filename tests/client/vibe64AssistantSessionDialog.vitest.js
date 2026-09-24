import { computed, createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, scopeKey: null }));
vi.mock("@local/vibe64-accounts/client", () => ({
  ModelRoutingForm: { render: () => null },
  useModelRouting: () => ({ resource: mocks.resource, scopeKey: mocks.scopeKey,
    engines: computed(() => mocks.resource.data.value?.engines || []), loadError: ref("") })
}));
vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({ requestVibe64AccountConnectionsDialog: vi.fn() }));
import WorkflowSelector from "../../src/components/studio/vibe64-session/Vibe64WorkflowSelector.vue";
import AssistantSessionDialog from "../../src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue";

const astra = { engineId: "codex", modelProviderId: "openai", modelId: "gpt-6-astra", label: "Astra" };
const deepseek = { engineId: "codex", modelProviderId: "deepseek", modelId: "deepseek-flash", label: "DeepSeek" };
const pickle = { engineId: "opencode", modelProviderId: "opencode", modelId: "big-pickle", label: "Big Pickle" };
const decision = (selection, backupUsed = false) => ({ available: true, effectiveSelection: selection, backupUsed });
function engine(engineId, label, plan, code) {
  return { engineId, label, choices: [plan, code], roles: {
    plan: { assignment: null, recommendation: plan }, code: { assignment: null, recommendation: code }
  }, setupPreview: { plan: decision(plan), code: decision(code) }, preview: { viewer: { plan: { available: false } } } };
}
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
  mocks.scopeKey = ref("owner:workspace");
  mocks.resource = { data: ref({ canConfigure: true, engines: [engine("codex", "Codex", astra, deepseek), engine("opencode", "OpenCode", pickle, pickle)] }),
    isInitialLoading: ref(false), reload: vi.fn() };
});
afterEach(() => app?.unmount());

it("previews initial roles without writing and submits the workflow rather than a frozen model", async () => {
  const f = mount();
  expect(f.state.choices).toHaveLength(2);
  expect(f.state.selectedChoice).toMatchObject({ engineId: "codex", available: true, planLabel: "Codex · Astra", codeLabel: "Codex · DeepSeek" });
  expect(f.createSession).not.toHaveBeenCalled();
  expect(f.workflow).toHaveBeenLastCalledWith("codex");
  expect(f.ready).toHaveBeenLastCalledWith(true);
});

it("shows a collaborator's backup pair and hides configuration", async () => {
  mocks.resource.data.value.canConfigure = false;
  mocks.resource.data.value.engines[0].setupPreview = { plan: decision(pickle, true), code: decision(pickle, true) };
  const f = mount();
  expect(f.state.canConfigure).toBe(false);
  expect(f.state.selectedChoice).toMatchObject({ engineId: "codex", available: true, backupUsed: true,
    planLabel: "OpenCode · Big Pickle", codeLabel: "OpenCode · Big Pickle" });
  expect(f.workflow).toHaveBeenLastCalledWith("codex");
  expect(f.ready).toHaveBeenLastCalledWith(true);
});

it("retains an unavailable configured workflow with its reason and selects an available one", async () => {
  const codex = mocks.resource.data.value.engines[0];
  codex.roles.plan.assignment = astra;
  codex.setupPreview.plan = { available: false, configuredSelection: astra, message: "Reconnect GPT" };
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
