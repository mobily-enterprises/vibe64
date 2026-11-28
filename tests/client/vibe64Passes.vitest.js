import { createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, saveSelection: null }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({ useEndpointResource: (options) => {
  mocks.resource.options = options;
  return mocks.resource;
} }));
vi.mock("@/composables/useVibe64ProjectScope.js", async () => {
  const { ref: vueRef } = await import("vue");
  return { useVibe64ProjectSlug: () => vueRef("demo") };
});
vi.mock("vuetify", async () => {
  const { ref: vueRef } = await import("vue");
  return { useDisplay: () => ({ xs: vueRef(false) }) };
});
vi.mock("vuetify/components", () => ({ VBottomSheet: {}, VMenu: {} }));
// Main chat's settings route, which After a plan saves through.
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => ({ run: () => mocks.saveSelection(options.buildCommandOptions(), options.buildRawPayload().assistantRouting) })
}));

import { GENESIS_MASTER_PASS, GENESIS_PASSES } from "../fixtures/genesisPasses.js";
import { runKey, seriesMessage, useVibe64Passes } from "../../src/composables/useVibe64Passes.js";
import Vibe64PassesMenu from "../../src/components/studio/vibe64-session/Vibe64PassesMenu.vue";
import Vibe64PassSuggestion from "../../src/components/studio/vibe64-session/Vibe64PassSuggestion.vue";

const DAY = 24 * 60 * 60 * 1000;
// The server's read: the adapter's passes, with when each last completed in the project.
const listed = (states = {}) => GENESIS_PASSES.map((pass) => ({
  ...pass, lastRun: null, commitsSince: 12, snoozedUntil: "", dismissed: false, ...states[pass.id]
}));
let apps = [];
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
function mount(component, props = {}) {
  const app = renderer.createApp({ ...component, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  apps.push(app);
  return app._instance.setupState;
}
function passes({ idle = ref(true), send = vi.fn(async () => ({ ok: true })) } = {}) {
  let state;
  mount({ setup() {
    state = useVibe64Passes({ session: () => ({ sessionId: "session-1" }), sessionsApiPath: "/api/sessions", enabled: true, idle, send });
    return {};
  } });
  return { state, send, idle };
}
beforeEach(() => {
  mocks.resource = {
    // The order Genesis runs several passes in, and the open plan's passes (none).
    data: ref({ ok: true, passes: listed(), master: { passes: GENESIS_MASTER_PASS.passes }, plan: null, recommendation: "" }),
    isLoading: ref(false),
    loadError: ref(""),
    reload: vi.fn(async () => {}),
    save: vi.fn(async () => ({ ok: true }))
  };
  mocks.saveSelection = vi.fn(async () => ({ ok: true }));
});
afterEach(() => {
  for (const app of apps) app.unmount();
  apps = [];
});

it("lists Genesis's passes from the session's read, each with when it last completed or Never completed", () => {
  const ran = new Date(Date.now() - 3 * DAY);
  mocks.resource.data.value.passes = listed({ "quality-pass": { lastRun: ran.toISOString(), commitsSince: 7 } });
  const { state } = passes();
  expect(mocks.resource.options.path.value).toBe("/api/sessions/session-1/passes");
  expect(state.passes.value.map(({ id, title, description }) => ({ id, title, description })))
    .toEqual(GENESIS_PASSES.map(({ id, title, description }) => ({ id, title, description })));
  const menu = mount(Vibe64PassesMenu, { passes: state });
  expect(menu.list.map(({ title }) => title)).toEqual(GENESIS_PASSES.map(({ title }) => title));
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(ran);
  expect(menu.lastRunLabel(menu.list.find(({ id }) => id === "quality-pass"))).toBe(`Last completed: ${date} · 7 commits since`);
  expect(menu.lastRunLabel(menu.list.find(({ id }) => id === "deslop"))).toBe("Never completed");
  expect(state.unavailable.value, "a read without a reason runs passes").toBe("");
});

it("each run Genesis offers sends its own request verbatim to Main chat as the person's message for Genesis's task, naming the run", async () => {
  const since = {
    id: "since-last",
    label: "Since last completed (abc1234, 42 commits)",
    request: "Quality pass: the changes since commit abc1234, judged against the whole app."
  };
  const quality = GENESIS_PASSES.find(({ id }) => id === "quality-pass");
  const [whole, deep] = quality.runs;
  mocks.resource.data.value.passes = listed({ "quality-pass": { lastRun: new Date().toISOString(), runs: [whole, since, deep] } });
  const starting = [];
  const send = vi.fn(async () => {
    starting.push(state.starting.value);
    return { ok: true };
  });
  const { state } = passes({ send });
  const menu = mount(Vibe64PassesMenu, { passes: state });
  const pass = state.passes.value.find(({ id }) => id === "quality-pass");
  for (const passRun of pass.runs) {
    menu.opened = true;
    await menu.start(pass, passRun);
    expect(send).toHaveBeenLastCalledWith({ message: passRun.request, genesisTask: "quality-pass", passRun: passRun.id, submissionKind: "send" });
    expect(menu.opened).toBe(false);
  }
  expect(send.mock.calls.map(([input]) => input.message)).toEqual(["Quality pass the whole app.", since.request, "Quality pass the whole app deeply."]);
  expect(starting).toEqual(["quality-pass:whole", "quality-pass:since-last", "quality-pass:deep"]);
  expect(runKey(pass, since)).toBe("quality-pass:since-last");
  expect(state.starting.value).toBe("");
  expect(state.error.value).toBe("");
  expect(mocks.resource.reload).toHaveBeenCalled();
});

it("a project whose own Genesis runs no pass reads Genesis's reason, and its passes offer no run", () => {
  const reason = "This Genesis source (genesis-compiler 1.10.15) cannot run passes.";
  mocks.resource.data.value = { ok: true, unavailable: reason, recommendation: "",
    passes: listed(Object.fromEntries(GENESIS_PASSES.map(({ id }) => [id, { unavailable: reason, runs: [] }]))) };
  const { state } = passes();
  expect(state.unavailable.value).toBe(reason);
  expect(state.passes.value.map(({ runs }) => runs.length)).toEqual(GENESIS_PASSES.map(() => 0));
});

it("a refused Run keeps the list open with Main chat's reason", async () => {
  const send = vi.fn(async () => {
    throw new Error("Quality pass uses the Senior model in its own turn. Finish or stop the current turn, then send Quality pass again.");
  });
  const { state } = passes({ send });
  const menu = mount(Vibe64PassesMenu, { passes: state, blockedReason: "" });
  menu.opened = true;
  const pass = state.passes.value.find(({ id }) => id === "quality-pass");
  await menu.start(pass, pass.runs[0]);
  expect(menu.opened).toBe(true);
  expect(state.error.value).toMatch(/^Quality pass uses the Senior model in its own turn/u);
  expect(state.starting.value).toBe("");
});

it("suggests the pass the server's rule picked; Later and Dismiss change only the suggestion", async () => {
  mocks.resource.data.value = { ok: true, recommendation: "quality-pass",
    passes: listed({ "quality-pass": { lastRun: new Date(Date.now() - 18 * DAY).toISOString(), commitsSince: 42 } }) };
  const { state, send } = passes();
  expect(state.recommendation.value.id).toBe("quality-pass");
  const suggestion = mount(Vibe64PassSuggestion, { passes: state, pass: state.recommendation.value });
  expect(suggestion.headline).toBe("Your app has changed a lot since Quality pass was last completed. Run it again?");
  expect(suggestion.detail).toBe("42 commits in 18 days.");
  await state.snooze(state.recommendation.value);
  expect(mocks.resource.save).toHaveBeenLastCalledWith({ passId: "quality-pass", action: "snooze" },
    { path: "/api/sessions/session-1/passes/recommendation", method: "POST" });
  await state.dismiss(state.recommendation.value);
  expect(mocks.resource.save).toHaveBeenLastCalledWith({ passId: "quality-pass", action: "dismiss" },
    { path: "/api/sessions/session-1/passes/recommendation", method: "POST" });
  expect(mocks.resource.reload).toHaveBeenCalledTimes(2);
  expect(send).not.toHaveBeenCalled();

  const never = { ...state.passes.value.find(({ id }) => id === "identity-pass"), commitsSince: 60 };
  const first = mount(Vibe64PassSuggestion, { passes: state, pass: never });
  expect(first.headline).toBe("Visual identity has never been completed on this app. Run it?");
  expect(first.detail).toBe("60 commits so far.");
});

it("nothing runs a pass by itself: a suggestion, a finished turn and an opened list only read", async () => {
  mocks.resource.data.value = { ok: true, recommendation: "deslop", passes: listed({ deslop: { commitsSince: 90 } }) };
  const idle = ref(false);
  const { state, send } = passes({ idle });
  mount(Vibe64PassSuggestion, { passes: state, pass: state.recommendation.value });
  const menu = mount(Vibe64PassesMenu, { passes: state });
  idle.value = true;
  await nextTick();
  expect(mocks.resource.reload).toHaveBeenCalledTimes(1);
  menu.onOpenChange(true);
  expect(mocks.resource.reload).toHaveBeenCalledTimes(2);
  expect(send).not.toHaveBeenCalled();
});

it("each pass offers Genesis's Deep run with its size, sends it verbatim and says what it costs", async () => {
  const { state, send } = passes();
  const menu = mount(Vibe64PassesMenu, { passes: state });
  for (const pass of menu.list) {
    const deep = pass.runs.find(({ id }) => id === "deep");
    expect(deep.label).toBe("Deep (212 files, 18,450 lines)");
    await menu.start(pass, deep);
    expect(send).toHaveBeenLastCalledWith({ message: deep.request, genesisTask: pass.id, passRun: "deep", submissionKind: "send" });
  }
  expect(send.mock.calls.find(([input]) => input.genesisTask === "security-pass")[0].message).toBe("Security pass the whole app deeply.");
  expect(menu.DEEP_NOTE).toBe("Deep reads every file: it takes much longer and uses far more of your AI's allowance.");
});

it("Several passes runs the ticked passes in Genesis's order, with one run all of them offer; nothing ticked sends nothing", async () => {
  const quality = GENESIS_PASSES.find(({ id }) => id === "quality-pass");
  const since = { id: "since-last", label: "Since last completed (abc1234, 3 commits)", request: "Quality pass: the changes since commit abc1234, judged against the whole app." };
  mocks.resource.data.value.passes = listed({ "quality-pass": { lastRun: new Date().toISOString(), runs: [...quality.runs, since] } });
  const { state, send } = passes();
  const menu = mount(Vibe64PassesMenu, { passes: state, session: mainChat() });
  expect(menu.ticked, "none until the person ticks them").toEqual([]);
  expect(menu.SERIES_NOTE).toBe("Tick passes and choose one run for all of them. They join the plan's Passes and run one after another, each in its own turn.");
  expect(state.order.value).toEqual(GENESIS_MASTER_PASS.passes);
  menu.ticked = ["quality-pass"];
  expect(menu.seriesRuns.map(({ id }) => id)).toEqual(["whole", "since-last", "deep"]);
  menu.ticked = ["deslop", "ux-pass", "quality-pass"];
  expect(menu.seriesRuns.map(({ id }) => id), "Since last completed only when every ticked pass offers it").toEqual(["whole", "deep"]);
  menu.opened = true;
  await menu.startSeries("deep");
  expect(send).toHaveBeenLastCalledWith({ message: "Run Quality pass, User experience pass and Deslop deeply.",
    passes: ["quality-pass", "ux-pass", "deslop"], passRun: "deep", submissionKind: "send" });
  expect(menu.opened).toBe(false);
  expect(seriesMessage(["Review"], "since-last")).toBe("Run Review since their last completed run.");
  expect(seriesMessage(["Review", "Data pass"], "whole")).toBe("Run Review and Data pass on the whole app.");
  send.mockClear();
  menu.ticked = [];
  await menu.startSeries("whole");
  expect(await state.runSeries([], "whole")).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it("the open plan's passes show each one's state, and Continue, Run this pass again and Restart send the person's message for them", async () => {
  mocks.resource.data.value.plan = { title: "Bookings", atPasses: true, passes: [
    { id: "review", title: "Review", scope: "the plan's changes", item: "Review: the plan's changes", done: true, state: "done" },
    { id: "data-pass", title: "Data pass", scope: "the plan's changes", item: "Data pass: the plan's changes", done: false, state: "needs-you" },
    { id: "deslop", title: "Deslop", scope: "whole app", item: "Deslop: whole app", done: false, state: "" }
  ] };
  const { state, send } = passes();
  const menu = mount(Vibe64PassesMenu, { passes: state, session: mainChat() });
  expect(menu.plansPasses).toBe(true);
  expect(menu.planLine).toBe("Review ✓ · Data pass: needs you · Deslop");
  expect(menu.planDone).toBe(false);
  expect(menu.donePasses.map(({ id }) => id)).toEqual(["review"]);
  await menu.act("continue");
  expect(send).toHaveBeenLastCalledWith({ message: "Continue the plan's passes.", passAction: "continue", submissionKind: "send" });
  await menu.act("again", menu.donePasses[0]);
  expect(send).toHaveBeenLastCalledWith({ message: "Run Review again.", passAction: "again", passId: "review", submissionKind: "send" });
  await menu.act("restart");
  expect(send).toHaveBeenLastCalledWith({ message: "Restart the plan's passes from the first one.", passAction: "restart", submissionKind: "send" });
  // A lesson, Fix it with AI and a chat with no mode yet run each pass as its own turn: no plan's passes, no Several passes.
  expect(mount(Vibe64PassesMenu, { passes: state, session: mainChat({}, { purpose: "learning" }) }).plansPasses).toBe(false);
  expect(mount(Vibe64PassesMenu, { passes: state, session: mainChat({ mode: "fix", afterPlan: ["review", "security-pass"] }) }).plansPasses).toBe(false);
  expect(mount(Vibe64PassesMenu, { passes: state, session: { sessionId: "session-1", metadata: {} } }).plansPasses).toBe(false);
});

// A plan at its passes, as whs2's was: Review done, eight to go, and Speed pass among them.
const NINE = ["review", "security-pass", "data-pass", "quality-pass", "ux-pass", "speed-pass", "ui-pass", "identity-pass", "deslop"];
const planAt = (done, { atPasses = true } = {}) => ({ title: "Bookings", atPasses, passes: NINE.map((id, index) => {
  const title = GENESIS_PASSES.find((pass) => pass.id === id).title;
  return { id, title, scope: "the plan's changes", item: `${title}: the plan's changes`, done: index < done, state: index < done ? "done" : "" };
}) });

it("while the open plan's passes are unfinished, the bar above the composer shows them with the list's Continue naming what's left, and no pass is suggested", async () => {
  const { default: Vibe64PlanPassesBar } = await import("../../src/components/studio/vibe64-session/Vibe64PlanPassesBar.vue");
  mocks.resource.data.value = { ok: true, passes: listed(), master: { passes: GENESIS_MASTER_PASS.passes }, plan: planAt(1), recommendation: "speed-pass" };
  const { state, send } = passes();
  expect(state.planProgress.value).toEqual({ done: 1, total: 9, left: 8 });
  // Speed pass is this plan's own: nothing suggests it, or any other pass, beside the plan's next step.
  expect(state.recommendation.value).toBe(null);
  const bar = mount(Vibe64PlanPassesBar, { passes: state, session: mainChat() });
  expect(bar.shown).toBe(true);
  expect(bar.summary).toBe("This plan's passes: 1 of 9 done");
  expect(bar.continueLabel).toBe("Continue (8 passes left)");
  const menu = mount(Vibe64PassesMenu, { passes: state, session: mainChat() });
  expect(menu.continueLabel, "the list's Continue says the same").toBe("Continue (8 passes left)");
  // The bar's Continue is the list's: the same call and the same message.
  await bar.continuePasses();
  expect(send).toHaveBeenLastCalledWith({ message: "Continue the plan's passes.", passAction: "continue", submissionKind: "send" });
  await menu.act("continue");
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);

  mocks.resource.data.value = { ...mocks.resource.data.value, plan: planAt(8) };
  expect([bar.summary, bar.continueLabel, menu.continueLabel]).toEqual(["This plan's passes: 8 of 9 done", "Continue (1 pass left)", "Continue (1 pass left)"]);
  // Before Senior's review the plan's passes don't run yet: no bar, and still no suggestion beside them.
  mocks.resource.data.value = { ...mocks.resource.data.value, plan: planAt(0, { atPasses: false }) };
  expect([bar.shown, state.recommendation.value]).toEqual([false, null]);
  // A lesson, Fix it with AI and a chat with no mode yet show no plan's passes, so no bar either.
  for (const session of [mainChat({}, { purpose: "learning" }), mainChat({ mode: "fix" }), { sessionId: "session-1", metadata: {} }]) {
    mocks.resource.data.value = { ...mocks.resource.data.value, plan: planAt(1) };
    expect(mount(Vibe64PlanPassesBar, { passes: state, session }).shown).toBe(false);
  }
  // Once every pass is done, or the plan is finished, the bar goes and suggestions come back.
  for (const plan of [planAt(9), null]) {
    mocks.resource.data.value = { ...mocks.resource.data.value, plan };
    expect(bar.shown).toBe(false);
    expect(state.recommendation.value?.id).toBe("speed-pass");
  }
});

it("a suggestion offers the pass's ordinary runs; its deep run stays in Passes beside its cost", () => {
  mocks.resource.data.value = { ok: true, recommendation: "quality-pass", master: null,
    passes: listed({ "quality-pass": { lastRun: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(), commitsSince: 42 } }) };
  const { state } = passes();
  const suggestion = mount(Vibe64PassSuggestion, { passes: state, pass: state.recommendation.value });
  expect(state.recommendation.value.runs.map(({ id }) => id)).toEqual(["whole", "deep"]);
  expect(suggestion.runs.map(({ id }) => id)).toEqual(["whole"]);
  expect(state.order.value, "a read without Genesis's order keeps its list order").toEqual(GENESIS_PASSES.map(({ id }) => id));
});

// Lets a save started by a tick finish.
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

// Main chat's session, its saved chat mode carrying the passes it runs after a completed plan.
const mainChat = (preferences = {}, session = {}) => ({ sessionId: "session-1", ...session, metadata: { assistant_routing: JSON.stringify({
  mode: "auto", afterPlan: ["review", "security-pass", "data-pass", "quality-pass", "ui-pass", "deslop"], afterPlanDeep: [], autoSave: false, ...preferences
}) } });

it("Main chat's Passes tick the passes each new plan's Passes start with: Review and Security always, the rest saved through Chat settings in Master order", async () => {
  const { state } = passes();
  const menu = mount(Vibe64PassesMenu, { passes: state, session: mainChat(), sessionsApiPath: "/api/sessions" });
  expect(menu.afterPlanShown).toBe(true);
  expect(menu.afterPlanChangeable).toBe(true);
  expect(menu.AFTER_PLAN_NOTE).toBe("After a plan: each new plan's Passes section starts with the ticked passes, which check the plan's changes: " +
    "Review in Senior's review of the plan, the others each in its own turn after it. To change one plan's passes, change that plan.");
  expect(menu.afterPlan).toEqual(["review", "security-pass", "data-pass", "quality-pass", "ui-pass", "deslop"]);
  // The mandatory pair is ticked and can't be unticked: its tick is disabled, and nothing is sent.
  expect(["review", "security-pass"].filter(menu.mandatory)).toEqual(["review", "security-pass"]);
  expect(menu.list.filter(({ id }) => menu.mandatory(id)).map(({ title }) => title)).toEqual(["Security pass", "Review"]);
  menu.tickAfterPlan("review", false);
  menu.tickAfterPlan("security-pass", false);
  expect(mocks.saveSelection).not.toHaveBeenCalled();
  // Ticking Speed saves the chat's mode with its ticks in Master pass order; its save choice stays the server's.
  menu.tickAfterPlan("speed-pass", true);
  await settle();
  expect(mocks.saveSelection).toHaveBeenLastCalledWith({ method: "PATCH", path: "/api/sessions/session-1/assistant-selection" },
    { mode: "auto", afterPlan: ["review", "security-pass", "data-pass", "quality-pass", "speed-pass", "ui-pass", "deslop"], afterPlanDeep: [] });
  expect(menu.afterPlan).toContain("speed-pass");
  // A refused save puts the ticks back and says why.
  mocks.saveSelection.mockRejectedValueOnce(new Error("Only the owner can change its chat mode, passes after a plan, Chat settings or model."));
  await menu.saveAfterPlan(menu.afterPlan.filter((id) => id !== "deslop"), []);
  expect(menu.afterPlan).toContain("deslop");
  expect(menu.afterPlanError).toMatch(/^Only the owner can change/u);
});

it("Deeply is offered where Genesis has a deep run since a base, needs After a plan, and goes when After a plan is unticked", async () => {
  mocks.resource.data.value.passes = listed({ review: { sinceBase: { request: "Review: the changes since base commit {base}, judged against the whole app.", deep: null } } });
  const { state } = passes();
  const menu = mount(Vibe64PassesMenu, { passes: state, session: mainChat({ mode: "custom", override: {
    schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex", modelProviderId: "deepseek", modelId: "deepseek-flash",
    variantId: "low", catalogRevision: `sha256:${"a".repeat(64)}` } }), sessionsApiPath: "/api/sessions" });
  expect(menu.list.filter((pass) => pass.sinceBase?.deep).map(({ id }) => id)).not.toContain("review");
  await menu.saveAfterPlan(menu.afterPlan, ["data-pass", "speed-pass"]);
  const [, saved] = mocks.saveSelection.mock.calls.at(-1);
  expect(saved.afterPlanDeep, "Deeply on an unticked pass is dropped").toEqual(["data-pass"]);
  expect(saved.mode).toBe("custom");
  expect(saved.override.modelId, "a Custom chat keeps its model").toBe("deepseek-flash");
  menu.tickAfterPlan("data-pass", false);
  await settle();
  expect(mocks.saveSelection.mock.calls.at(-1)[1]).toMatchObject({ afterPlanDeep: [] });
  expect(menu.afterPlan).not.toContain("data-pass");
});

it("After a plan shows only in Main chat outside lessons and Fix it with AI, and changes only once a chat mode is chosen and no goal runs", () => {
  const { state } = passes();
  expect(mount(Vibe64PassesMenu, { passes: state }).afterPlanShown, "no Main chat session").toBe(false);
  expect(mount(Vibe64PassesMenu, { passes: state, session: mainChat({}, { purpose: "learning" }) }).afterPlanShown, "a lesson").toBe(false);
  expect(mount(Vibe64PassesMenu, { passes: state, session: mainChat({ mode: "fix", afterPlan: ["review", "security-pass"] }) }).afterPlanShown,
    "Fix it with AI").toBe(false);
  const fresh = mount(Vibe64PassesMenu, { passes: state, session: { sessionId: "session-1", metadata: {} } });
  expect(fresh.afterPlanShown).toBe(true);
  expect(fresh.afterPlan, "a chat with no mode yet runs the defaults").toEqual(["review", "security-pass", "data-pass", "quality-pass", "ui-pass", "deslop"]);
  expect(fresh.afterPlanChangeable).toBe(false);
  expect(fresh.afterPlanStatus).toBe("Choose a Chat mode to change these; until then the ticked passes run after a plan.");
  const goal = mount(Vibe64PassesMenu, { passes: state, session: mainChat(), afterPlanReason: "After a plan can change once the current goal finishes." });
  expect(goal.afterPlanChangeable).toBe(false);
  goal.tickAfterPlan("speed-pass", true);
  expect(mocks.saveSelection).not.toHaveBeenCalled();
});
