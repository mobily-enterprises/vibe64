import { computed, createRenderer, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(), workflows: null }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => ({ run: async () => {
    const result = await mocks.save(options.buildRawPayload().assistantRouting);
    options.onRunSuccess(result);
    return result;
  } })
}));
vi.mock("@local/vibe64-accounts/client", () => ({
  useModelRouting: () => ({ connectedWorkflows: computed(() => mocks.workflows.value.filter(choice => choice.connected)) })
}));

import Vibe64SwitchWorkflowButton from "../../src/components/studio/vibe64-session/Vibe64SwitchWorkflowButton.vue";

let app;
function mount(routing = { mode: "junior", review: true, workflowEngineId: "codex" }) {
  const saved = vi.fn();
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...Vibe64SwitchWorkflowButton, render: () => null }, {
      session: { sessionId: "session-1", metadata: { assistant_routing: JSON.stringify(routing) } }, onSaved: saved
    });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { state: app._instance.setupState, saved };
}
beforeEach(() => {
  mocks.save.mockReset();
  mocks.save.mockResolvedValue({ ok: true });
  mocks.workflows = ref([
    { engineId: "codex", label: "Codex", connected: false, available: false },
    { engineId: "opencode", label: "OpenCode", connected: true, available: false },
    { engineId: "claude", label: "Claude Code", connected: true, available: true }
  ]);
});
afterEach(() => { app?.unmount(); });

it("switches an unavailable chat to the first other usable orchestrator, keeping its role and Deslop choice", async () => {
  const { state, saved } = mount();
  expect(state.target.engineId).toBe("claude");
  await state.switchWorkflow();
  expect(mocks.save).toHaveBeenCalledWith({ mode: "junior", review: true, workflowEngineId: "claude" });
  expect(saved).toHaveBeenCalledTimes(1);
  app.unmount();
  const off = mount({ mode: "auto", review: false, workflowEngineId: "codex" });
  await off.state.switchWorkflow();
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", review: false, workflowEngineId: "claude" });
});

it("uses Senior for a custom chat and offers nothing when no other orchestrator is usable", async () => {
  const override = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex",
    modelProviderId: "openai", modelId: "gpt-6-astra", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
  const { state } = mount({ mode: "custom", review: false, workflowEngineId: "codex", override });
  await state.switchWorkflow();
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", review: true, workflowEngineId: "claude" });
  mocks.workflows.value = mocks.workflows.value.filter(choice => choice.engineId !== "claude");
  expect(state.target).toBe(null);
});

it("reports a refused switch without claiming success", async () => {
  mocks.save.mockResolvedValue({ ok: false, error: "Chat mode could not be saved." });
  const { state, saved } = mount();
  await state.switchWorkflow();
  expect(state.error).toBe("Chat mode could not be saved.");
  expect(saved).not.toHaveBeenCalled();
});
