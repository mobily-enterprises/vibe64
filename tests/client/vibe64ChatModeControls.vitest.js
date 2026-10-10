import { computed, createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => ({ run: () => mocks.save(options.buildRawPayload().assistantRouting) })
}));
vi.mock("@local/vibe64-accounts/client", () => ({
  ModelRoutingForm: { render: () => null },
  useModelRouting: () => {
    const data = ref({ workflows: [
      { engineId: "codex", label: "Codex", connected: true, available: true },
      { engineId: "claude", label: "Claude Code", connected: true, available: true },
      { engineId: "opencode", label: "OpenCode", connected: false, available: false, error: "Connect an account first." }
    ] });
    return { engines: ref([]), loadError: ref(""), resource: { isInitialLoading: ref(false), data },
      connectedWorkflows: computed(() => data.value.workflows.filter(choice => choice.connected)) };
  }
}));

import Vibe64ChatModeControls from "../../src/components/studio/vibe64-session/Vibe64ChatModeControls.vue";

const override = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex",
  modelProviderId: "deepseek", modelId: "deepseek-flash", variantId: "low", catalogRevision: `sha256:${"a".repeat(64)}` };
let app;
function mount(savePreferences, temporary = false, props = {}) {
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...Vibe64ChatModeControls, render: () => null }, {
      session: { sessionId: "session-1", metadata: { assistant_routing: JSON.stringify({
        mode: "junior", review: false, workflowEngineId: "codex", override
      }) } }, savePreferences, temporary, ...props
    });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
beforeEach(() => { mocks.save.mockReset(); mocks.save.mockResolvedValue({ ok: true }); });
afterEach(() => { app?.unmount(); });

for (const temporary of [false, true]) {
  it(`${temporary ? "temporary" : "main"} direct roles retain their custom model; only Auto offers review`, async () => {
    const state = mount(temporary ? mocks.save : undefined, temporary);
    const workflow = temporary ? {} : { workflowEngineId: "codex" };
    expect(state.modeLabel).toBe("Junior");
    expect(state.reviewAvailable).toBe(false);
    await state.save("junior", true);
    expect(mocks.save).toHaveBeenLastCalledWith({ ...workflow, mode: "junior", review: !temporary, override });
    await state.save("junior", false);
    expect(mocks.save).toHaveBeenLastCalledWith({ ...workflow, mode: "junior", review: false, override });
    await state.save("senior", false);
    expect(mocks.save).toHaveBeenLastCalledWith({ ...workflow, mode: "senior", review: false });
    expect(state.modeLabel).toBe("Senior");
    expect(state.reviewAvailable).toBe(false);
    await state.save("auto", true);
    expect(state.reviewAvailable).toBe(!temporary);
    expect(mocks.save).toHaveBeenLastCalledWith(temporary ? { mode: "senior", review: false } : { ...workflow, mode: "auto", review: true });
    expect(state.modes.map(({ id }) => id)).toEqual(temporary ? ["custom", "senior", "junior"] : ["custom", "senior", "junior", "auto"]);
  });
}

it("a failed switch to Auto keeps the direct role and custom model", async () => {
  const state = mount();
  mocks.save.mockRejectedValueOnce(new Error("Connection interrupted."));
  await state.save("auto", true);
  expect(state.review).toBe(false);
  expect(state.mode).toBe("junior");
  expect(state.saveError).toBe("Connection interrupted.");
  await state.save("auto", true);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", review: true, workflowEngineId: "codex" });
});

it("does not save Helper as a chat mode", async () => {
  const state = mount();
  await state.save("helper", false);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(state.mode).toBe("junior");
});

it("keeps a merge repair on Senior while exposing the custom model picker", async () => {
  const openPicker = vi.fn();
  const state = mount(mocks.save, true, { requiredMode: "senior", onCustom: openPicker, session: {
    sessionId: "repair", metadata: { assistant_routing: JSON.stringify({ mode: "senior", review: false, workflowEngineId: "codex" }) }
  } });
  expect(state.modeLabel).toBe("Senior");
  expect(state.modes.map(({ id }) => id)).toEqual(["custom", "senior"]);
  await state.save("junior");
  await state.save("auto");
  expect(mocks.save).not.toHaveBeenCalled();
  state.detailsOpen = true;
  state.openCustom();
  expect(state.detailsOpen).toBe(false);
  expect(openPicker).toHaveBeenCalledOnce();
  expect(state.mode).toBe("senior");
});

for (const mode of ["senior", "junior", "auto"]) {
  it(`switches the orchestrator in ${mode} without entering Custom or carrying the old model override`, async () => {
    const state = mount();
    state.mode = mode;
    await state.save(mode, mode === "auto", "claude");
    expect(mocks.save).toHaveBeenLastCalledWith({ mode, review: mode === "auto", workflowEngineId: "claude" });
    expect(state.mode).toBe(mode);
    expect(state.workflowEngineId).toBe("claude");
    await state.save(mode, mode === "auto", "codex");
    expect(mocks.save).toHaveBeenLastCalledWith({ mode, review: mode === "auto", workflowEngineId: "codex" });
  });
}

it("a failed orchestrator handover restores the workflow, mode and exact override", async () => {
  const state = mount();
  mocks.save.mockRejectedValueOnce(new Error("Previous assistant could not stop."));
  await state.save("junior", false, "claude");
  expect(state.workflowEngineId).toBe("codex");
  expect(state.mode).toBe("junior");
  expect(state.saveError).toBe("Previous assistant could not stop.");
  expect(state.updatedPreferences).toEqual({ mode: "junior", review: false, workflowEngineId: "codex", override });
});

it("does not switch an active or unavailable workflow, or silently change Custom's exact model", async () => {
  const state = mount();
  await state.save("junior", false, "opencode");
  await state.save("custom", false, "claude");
  state.mode = "custom";
  expect(mocks.save).not.toHaveBeenCalled();
  expect(state.workflowChoices.map(choice => choice.engineId)).toEqual(["codex", "claude"]);
  const claude = state.workflows.data.value.workflows.find(choice => choice.engineId === "claude");
  claude.available = false;
  claude.error = "Choose a Senior model in Model routing.";
  expect(state.workflowChoices.find(choice => choice.engineId === "claude").props).toEqual({
    disabled: true, "aria-disabled": "true", subtitle: claude.error
  });
  await state.save("junior", false, "claude");
  expect(mocks.save).not.toHaveBeenCalled();
  app.unmount();
  const active = mount(undefined, false, { active: true });
  await active.save("junior", false, "claude");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("blocks selection changes during reconnection and permits them when preparation finishes", async () => {
  const state = mount(undefined, false, { connecting: true });
  state.detailsOpen = true;
  await state.save("junior", false, "claude");
  await state.save("senior", false);
  state.openCustom();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(state.workflowEngineId).toBe("codex");
  expect(state.mode).toBe("junior");
  expect(state.detailsOpen).toBe(true);
  expect(state.saveError).toBe("");
  app._instance.props.connecting = false;
  await nextTick();
  await state.save("junior", false, "claude");
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "junior", review: false, workflowEngineId: "claude" });
});


it("lets an idle paused goal change direct modes and open Custom while retaining the goal", async () => {
  const goal = { status: "paused", objective: "Finish the agreed work", tokenBudget: 20000 };
  const openPicker = vi.fn();
  const state = mount(undefined, false, { onCustom: openPicker, session: { sessionId: "session-1", agentSession: { goal },
    metadata: { assistant_routing: JSON.stringify({ mode: "junior", review: false, workflowEngineId: "codex", override }) } } });
  expect(state.hasGoal).toBe(true);
  expect(state.goalLocksSelection).toBe(false);
  state.openCustom();
  expect(openPicker).toHaveBeenCalledOnce();
  await state.save("senior");
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", review: false, workflowEngineId: "codex" });
  mocks.save.mockClear();
  await state.save("auto");
  await state.save("senior", false, "claude");
  expect(mocks.save).not.toHaveBeenCalled();
  app._instance.props.active = true;
  await nextTick();
  await state.save("junior");
  state.openCustom();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(openPicker).toHaveBeenCalledOnce();
  app._instance.props.active = false;
  goal.status = "active";
  app._instance.props.session = { ...app._instance.props.session, agentSession: { goal: { ...goal } } };
  await nextTick();
  expect(state.goalLocksSelection).toBe(true);
  await state.save("junior");
  expect(mocks.save).not.toHaveBeenCalled();
});
