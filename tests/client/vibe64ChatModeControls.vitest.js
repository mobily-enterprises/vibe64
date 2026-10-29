import { createRenderer, nextTick, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(), openAccounts: vi.fn() }));
vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({ requestVibe64AccountConnectionsDialog: mocks.openAccounts }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => ({ run: () => mocks.save(options.buildRawPayload().assistantRouting) })
}));
vi.mock("@local/vibe64-accounts/client", () => ({ ModelRoutingForm: { render: () => null } }));

import Vibe64ChatModeControls from "../../src/components/studio/vibe64-session/Vibe64ChatModeControls.vue";

const override = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex",
  modelProviderId: "deepseek", modelId: "deepseek-flash", variantId: "low", catalogRevision: `sha256:${"a".repeat(64)}` };
let app;
function mount(savePreferences, temporary = false, props = {}) {
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...Vibe64ChatModeControls, render: () => null }, {
      session: { sessionId: "session-1", metadata: { assistant_routing: JSON.stringify({
        mode: "junior", review: false, override
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
    const main = temporary ? {} : { autoSave: true };
    const state = mount(temporary ? mocks.save : undefined, temporary);
    expect(state.modeLabel).toBe("Junior");
    expect(state.reviewAvailable).toBe(false);
    await state.save("junior", true);
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "junior", review: !temporary, ...main, override });
    await state.save("junior", false);
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "junior", review: false, ...main, override });
    await state.save("senior", false);
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", review: false, ...main });
    expect(state.modeLabel).toBe("Senior");
    expect(state.reviewAvailable).toBe(false);
    await state.save("auto", true);
    expect(state.reviewAvailable).toBe(!temporary);
    expect(mocks.save).toHaveBeenLastCalledWith(temporary ? { mode: "senior", review: false } : { mode: "auto", review: true, autoSave: true });
    expect(state.modes.map(({ id }) => id)).toEqual(temporary ? ["custom", "senior", "junior", "fix"] : ["custom", "senior", "junior", "auto"]);
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
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", review: true, autoSave: true });
});

it("turning Deslop off asks first; Cancel keeps it on", async () => {
  const state = mount();
  await state.save("auto", true);
  mocks.save.mockClear();
  state.changeDeslop(false);
  expect(state.deslopConfirmOpen).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
  state.deslopConfirmOpen = false;
  expect(state.review).toBe(true);
  state.changeDeslop(false);
  await state.confirmDeslopOff();
  expect(state.deslopConfirmOpen).toBe(false);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", review: false, autoSave: true });
  state.changeDeslop(true);
  expect(state.deslopConfirmOpen).toBe(false);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", review: true, autoSave: true });
});

it("starts with Deslop and automatic save on when the chat has no saved preferences", () => {
  const state = mount(undefined, false, { session: { sessionId: "session-1", metadata: {} } });
  expect(state.review).toBe(true);
  expect(state.autoSave).toBe(true);
});

it("Auto after a Custom model starts with Deslop and automatic save on; turning save off keeps Deslop", async () => {
  const state = mount(undefined, false, { session: { sessionId: "session-1", metadata: { assistant_routing: JSON.stringify({
    mode: "custom", review: false, autoSave: false, override }) } } });
  await state.save("auto");
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", review: true, autoSave: true });
  await state.save("auto", state.review, false);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", review: true, autoSave: false });
  expect(state.triggerLabel).toMatch(/Automatic deslop by Senior on$/);
});

it("ends each sentence of the mode label with one period", () => {
  const state = mount(undefined, false, { canConfigure: true, session: { sessionId: "session-1", metadata: {
    assistant_routing: JSON.stringify({ mode: "auto", review: true, autoSave: true }) } } });
  expect(state.triggerLabel).toBe("Chat mode: Auto. Senior for plans and reviews; Junior otherwise · Router: " +
    "Choose a model in Models. Automatic deslop by Senior on. Automatic save after plans on");
});

it("does not save Helper as a chat mode", async () => {
  const state = mount();
  await state.save("helper", false);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(state.mode).toBe("junior");
});

it("keeps a merge repair on Fix it with AI while exposing the custom model picker", async () => {
  const openPicker = vi.fn();
  const state = mount(mocks.save, true, { requiredMode: "fix", onCustom: openPicker, session: {
    sessionId: "repair", metadata: { assistant_routing: JSON.stringify({ mode: "fix", review: false }) }
  } });
  expect(state.modeLabel).toBe("Fix it with AI");
  expect(state.modes.map(({ id }) => id)).toEqual(["custom", "fix"]);
  await state.save("junior");
  await state.save("senior");
  expect(mocks.save).not.toHaveBeenCalled();
  state.detailsOpen = true;
  state.openCustom();
  expect(state.detailsOpen).toBe(false);
  expect(openPicker).toHaveBeenCalledOnce();
  expect(state.mode).toBe("fix");
});

it("lists only Fix it with AI and Custom when Senior and Junior need the owner's approval", () => {
  const approval = { available: false, approvalRequired: true, message: "Main chat runs on the owner's AI." };
  const state = mount(mocks.save, true, { purposes: { senior: approval, junior: approval, fix: { available: true } } });
  expect(state.modes.map(({ id }) => id)).toEqual(["custom", "fix"]);
});

it("a team member's Main chat offers no mode, Custom model or Deslop change", () => {
  const approval = { available: false, approvalRequired: true, message: "Main chat runs on the owner's AI." };
  const purposes = Object.fromEntries(["custom", "senior", "junior", "auto", "review"].map((id) => [id, approval]));
  const openPicker = vi.fn();
  const state = mount(mocks.save, false, { purposes, onCustom: openPicker, session: { sessionId: "session-1",
    metadata: { assistant_routing: JSON.stringify({ mode: "auto", review: true }) } } });
  expect(state.ownerOnly).toBe(true);
  expect(state.modes).toEqual([]);
  expect(state.reviewAvailable).toBe(false);
  state.openCustom();
  expect(openPicker).not.toHaveBeenCalled();
  app.unmount();
  const temporary = mount(mocks.save, true, { purposes });
  expect(temporary.ownerOnly).toBe(false);
});

it("a failed save restores the mode and exact override", async () => {
  const state = mount();
  mocks.save.mockRejectedValueOnce(new Error("Previous assistant could not stop."));
  await state.save("senior", false);
  expect(state.mode).toBe("junior");
  expect(state.saveError).toBe("Previous assistant could not stop.");
  expect(state.updatedPreferences).toEqual({ mode: "junior", review: false, autoSave: true, override });
});

for (const temporary of [false, true]) {
  for (const phase of [{ active: true }, { connecting: true }, { active: true, connecting: true }]) {
    it(`saves ${temporary ? "temporary" : "main"} next-turn settings during ${JSON.stringify(phase)}`, async () => {
      const openPicker = vi.fn();
      const state = mount(temporary ? mocks.save : undefined, temporary, { ...phase, onCustom: openPicker });
      state.detailsOpen = true;
      state.openCustom();
      expect(openPicker).toHaveBeenCalledOnce();
      expect(state.detailsOpen).toBe(false);
      await state.save("senior", false);
      expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", review: false, ...(temporary ? {} : { autoSave: true }) });
    });
  }
}

for (const status of ["paused", "active"]) {
  it(`saves settings without cancelling a ${status} goal`, async () => {
    const goal = { status, objective: "Finish the agreed work", tokenBudget: 20000 };
    const openPicker = vi.fn();
    const state = mount(undefined, false, { goal, active: true, onCustom: openPicker });
    expect(state.hasGoal).toBe(true);
    state.openCustom();
    expect(openPicker).toHaveBeenCalledOnce();
    await state.save("senior");
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", review: false, autoSave: true });
    await state.save("auto");
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", review: false, autoSave: true });
    expect(goal).toEqual({ status, objective: "Finish the agreed work", tokenBudget: 20000 });
  });
}

it("uses the shared native goal rather than stale session and routing snapshots", async () => {
  const state = mount(undefined, false, { goal: { status: "paused", objective: "Native goal" },
    session: { sessionId: "session-1", agentSession: { goal: { status: "active" }, turn: { goalStatus: "active" } },
      metadata: { assistant_routing: JSON.stringify({ mode: "senior" }),
        assistant_routing_goal: JSON.stringify({ status: "active" }) } } });
  expect(state.hasGoal).toBe(true);
  await state.save("junior");
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "junior", review: true, autoSave: true });
  app._instance.props.goal = null;
  await nextTick();
  expect(state.hasGoal).toBe(false);
});

it("the Models dialog hands its team key and other-tool steps to AI setup", () => {
  const state = mount();
  state.routingOpen = true;
  state.openAccountConnections({ providerId: "ai", section: "team" });
  expect(state.routingOpen).toBe(false);
  state.openAccountConnections({ providerId: "deepseek" });
  expect(mocks.openAccounts.mock.calls).toEqual([[{ providerId: "ai", section: "team" }], [{ providerId: "deepseek" }]]);
});
