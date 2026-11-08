import { createRenderer, nextTick, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(), openAccounts: vi.fn() }));
vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({ requestVibe64AccountConnectionsDialog: mocks.openAccounts }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => ({ run: () => mocks.save(options.buildRawPayload().assistantRouting) })
}));
vi.mock("@local/vibe64-accounts/client", () => ({ ModelRoutingForm: { render: () => null } }));

import Vibe64ChatModeControls from "../../src/components/studio/vibe64-session/Vibe64ChatModeControls.vue";
import { ASSISTANT_FINISHING_STEPS } from "@local/vibe64-runtime/shared/assistantFinishing";

const override = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex",
  modelProviderId: "deepseek", modelId: "deepseek-flash", variantId: "low", catalogRevision: `sha256:${"a".repeat(64)}` };
// The defaults: review, Deslop and save on, the UI pass off.
const defaults = { review: true, deslop: true, uiPass: false, autoSave: true };
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
const routing = (preferences) => ({ session: { sessionId: "session-1", metadata: { assistant_routing: JSON.stringify(preferences) } } });
beforeEach(() => { mocks.save.mockReset(); mocks.save.mockResolvedValue({ ok: true }); });
afterEach(() => { app?.unmount(); });

for (const temporary of [false, true]) {
  it(`${temporary ? "temporary" : "main"} direct roles retain their custom model; ${temporary ? "no" : "every"} mode offers the switches`, async () => {
    const state = mount(temporary ? mocks.save : undefined, temporary);
    expect(state.modeLabel).toBe("Junior");
    expect(state.switchesAvailable).toBe(!temporary);
    await state.save("junior", { review: true });
    expect(mocks.save).toHaveBeenLastCalledWith(temporary ? { mode: "junior", review: false, override }
      : { mode: "junior", ...defaults, override });
    await state.save("senior", { review: false });
    expect(mocks.save).toHaveBeenLastCalledWith(temporary ? { mode: "senior", review: false } : { mode: "senior", ...defaults, review: false });
    expect(state.modeLabel).toBe("Senior");
    expect(state.switchesAvailable).toBe(!temporary);
    await state.save("auto", { review: true });
    expect(state.switchesAvailable).toBe(!temporary);
    expect(mocks.save).toHaveBeenLastCalledWith(temporary ? { mode: "senior", review: false } : { mode: "auto", ...defaults });
    expect(state.modes.map(({ id }) => id)).toEqual(temporary ? ["custom", "senior", "junior", "fix"] : ["custom", "senior", "junior", "auto"]);
  });
}

it("a failed switch to Auto keeps the direct role and custom model", async () => {
  const state = mount();
  mocks.save.mockRejectedValueOnce(new Error("Connection interrupted."));
  await state.save("auto", { review: true });
  expect(state.review).toBe(false);
  expect(state.mode).toBe("junior");
  expect(state.saveError).toBe("Connection interrupted.");
  await state.save("auto", { review: true });
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", ...defaults });
});

for (const step of ["review", "deslop", "autoSave"]) it(`turning ${step} off asks first, naming what is lost; Cancel keeps it on`, async () => {
  const state = mount(undefined, false, routing({ mode: "senior" }));
  state.changeSwitch(step, false);
  expect(state.offConfirmOpen).toBe(true);
  expect(state.offConfirmSwitch).toBe(step);
  expect(state.switchText[step].lost).toMatch(/^Without it, /u);
  expect(mocks.save).not.toHaveBeenCalled();
  state.offConfirmOpen = false;
  expect(state[step]).toBe(true);
  state.changeSwitch(step, false);
  await state.confirmSwitchOff();
  expect(state.offConfirmOpen).toBe(false);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", ...defaults, [step]: false });
  await state.changeSwitch(step, true);
  expect(state.offConfirmOpen).toBe(false);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", ...defaults });
});

it("turning the automatic UI pass on saves at once; turning it off asks first and Cancel keeps it on", async () => {
  const state = mount(undefined, false, routing({ mode: "auto" }));
  await state.changeSwitch("uiPass", true);
  expect(state.offConfirmOpen).toBe(false);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", ...defaults, uiPass: true });
  mocks.save.mockClear();
  state.changeSwitch("uiPass", false);
  expect(state.offConfirmOpen).toBe(true);
  expect(state.offConfirmSwitch).toBe("uiPass");
  expect(mocks.save).not.toHaveBeenCalled();
  state.offConfirmOpen = false;
  expect(state.uiPass).toBe(true);
  state.changeSwitch("uiPass", false);
  await state.confirmSwitchOff();
  expect(state.uiPass).toBe(false);
  // Turning one switch off leaves the others as they were.
  expect(state.deslop).toBe(true);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", ...defaults });
});

it("the four switches are worded as the Chat settings, with Deslop's and the UI pass's help lines", () => {
  const state = mount(undefined, false, routing({ mode: "junior" }));
  expect(ASSISTANT_FINISHING_STEPS.map(({ setting }) => setting)).toEqual(["Automatically review changes",
    "Automatically deslop changes", "Automatically UI pass changes", "Automatically save changes"]);
  expect(state.switchText.deslop.help).toBe("Or tell the agent “Deslop” any time.");
  expect(state.switchText.uiPass.help).toBe("Or tell the agent “UI pass” any time — add “: <section>” or “: the whole app”.");
  expect(state.switchText.review.help).toBeUndefined();
  expect(state.finishingAgent).toBe("Junior does them itself");
});

it("starts with review, Deslop and save on and the UI pass off when the chat has no saved preferences", () => {
  const state = mount(undefined, false, { session: { sessionId: "session-1", metadata: {} } });
  expect([state.review, state.deslop, state.uiPass, state.autoSave]).toEqual([true, true, false, true]);
});

it("a Custom model keeps its own switches; turning save off keeps Deslop", async () => {
  const state = mount(undefined, false, routing({ mode: "custom", review: false, deslop: true, uiPass: false, autoSave: true, override }));
  expect(state.switchesAvailable).toBe(true);
  expect(state.finishingAgent).toBe("Your custom model does them itself");
  await state.save("auto");
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", ...defaults, review: false });
  await state.save("auto", { autoSave: false });
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", ...defaults, review: false, autoSave: false });
  expect(state.triggerLabel).toMatch(/Automatic deslop on$/);
});

it("the trigger names each step that is on, and a failed save puts a switch back", async () => {
  const state = mount(undefined, false, routing({ mode: "auto" }));
  expect(state.triggerLabel).not.toMatch(/UI pass/);
  await state.save("auto", { uiPass: true });
  expect(state.triggerLabel).toMatch(/Automatic review on\. Automatic deslop on\. Automatic UI pass on\. Automatic save on$/);
  await state.save("auto", { uiPass: false });
  mocks.save.mockRejectedValueOnce(new Error("Connection interrupted."));
  await state.save("auto", { uiPass: true });
  expect(state.uiPass).toBe(false);
});

it("a temporary chat never carries a finishing step", async () => {
  const state = mount(mocks.save, true);
  await state.save("senior", { review: true, deslop: true, uiPass: true, autoSave: true });
  expect([state.review, state.deslop, state.uiPass, state.autoSave]).toEqual([false, false, false, false]);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", review: false });
});

it("a lesson shows no Chat settings, even with switches saved on", () => {
  const lesson = routing({ mode: "junior", ...defaults });
  const state = mount(undefined, false, { session: { ...lesson.session, purpose: "learning" } });
  expect(state.finishingShown).toBe(false);
  expect(state.switchesAvailable).toBe(false);
  expect(state.triggerLabel).not.toMatch(/Automatic/u);
});

it("ends each sentence of the mode label with one period", () => {
  const state = mount(undefined, false, { canConfigure: true, ...routing({ mode: "auto", review: true, autoSave: true }) });
  expect(state.triggerLabel).toBe("Chat mode: Auto. Senior for plans and finishing steps; Junior otherwise · Router: " +
    "Choose a model in Models. Automatic review on. Automatic deslop on. Automatic save on");
});

it("does not save Helper as a chat mode", async () => {
  const state = mount();
  await state.save("helper", { review: false });
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
  expect(state.switchesAvailable).toBe(false);
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

it("a team member's Main chat offers no mode, Custom model or Chat settings change", () => {
  const approval = { available: false, approvalRequired: true, message: "Main chat runs on the owner's AI." };
  const purposes = Object.fromEntries(["custom", "senior", "junior", "auto", "review"].map((id) => [id, approval]));
  const openPicker = vi.fn();
  const state = mount(mocks.save, false, { purposes, onCustom: openPicker, ...routing({ mode: "auto", review: true }) });
  expect(state.ownerOnly).toBe(true);
  expect(state.modes).toEqual([]);
  expect(state.switchesAvailable).toBe(false);
  state.openCustom();
  expect(openPicker).not.toHaveBeenCalled();
  app.unmount();
  const temporary = mount(mocks.save, true, { purposes });
  expect(temporary.ownerOnly).toBe(false);
});

it("a failed save restores the mode and exact override", async () => {
  const state = mount();
  mocks.save.mockRejectedValueOnce(new Error("Previous assistant could not stop."));
  await state.save("senior", { review: false });
  expect(state.mode).toBe("junior");
  expect(state.saveError).toBe("Previous assistant could not stop.");
  expect(state.updatedPreferences).toEqual({ mode: "junior", ...defaults, review: false, override });
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
      await state.save("senior");
      expect(mocks.save).toHaveBeenLastCalledWith(temporary ? { mode: "senior", review: false } : { mode: "senior", ...defaults, review: false });
    });
  }
}

for (const status of ["paused", "active"]) {
  it(`saves settings without cancelling a ${status} goal`, async () => {
    const goal = { status, objective: "Finish the agreed work", tokenBudget: 20000 };
    const openPicker = vi.fn();
    const state = mount(undefined, false, { goal, active: true, onCustom: openPicker });
    expect(state.hasGoal).toBe(true);
    expect(state.switchesAvailable).toBe(false);
    state.openCustom();
    expect(openPicker).toHaveBeenCalledOnce();
    await state.save("senior");
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", ...defaults, review: false });
    await state.save("auto");
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", ...defaults, review: false });
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
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "junior", ...defaults });
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
