import { createRenderer, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => ({ run: () => mocks.save(options.buildRawPayload().assistantRouting) })
}));
vi.mock("@local/vibe64-accounts/client", () => ({
  ModelRoutingForm: { render: () => null },
  useModelRouting: () => ({ engines: ref([]), loadError: ref(""), resource: { isInitialLoading: ref(false), data: ref({ workflows: [
    { engineId: "codex", label: "Codex", available: true },
    { engineId: "claude", label: "Claude Code", available: true },
    { engineId: "opencode", label: "OpenCode", available: false, error: "Connect an account first." }
  ] }) } })
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
  expect(state.workflowChoices.find(choice => choice.engineId === "opencode").props).toEqual({
    disabled: true, "aria-disabled": "true", subtitle: "Connect an account first."
  });
  app.unmount();
  const active = mount(undefined, false, { active: true });
  await active.save("junior", false, "claude");
  expect(mocks.save).not.toHaveBeenCalled();
});
