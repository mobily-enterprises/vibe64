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
import { masterRequest, runKey, useVibe64Passes } from "../../src/composables/useVibe64Passes.js";
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
    data: ref({ ok: true, passes: listed(), master: { ...GENESIS_MASTER_PASS, commitsSince: 12 }, recommendation: "" }),
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

it("each run Genesis offers sends its own request verbatim to Main chat as the person's message for Genesis's task", async () => {
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
    expect(send).toHaveBeenLastCalledWith({ message: passRun.request, genesisTask: "quality-pass", submissionKind: "send" });
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
  const reason = "This project's Genesis (genesis-compiler 1.10.15) cannot run passes. Update it to 1.10.21 or later.";
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
    expect(send).toHaveBeenLastCalledWith({ message: deep.request, genesisTask: pass.id, submissionKind: "send" });
  }
  expect(send.mock.calls.find(([input]) => input.genesisTask === "security-pass")[0].message).toBe("Security pass the whole app deeply.");
  expect(menu.DEEP_NOTE).toBe("Deep reads every file: it takes much longer and uses far more of your AI's allowance.");
});

it("the Master pass ticks every pass it runs, and Start sends Genesis's request for all of them, with its size and cost", async () => {
  const { state, send } = passes();
  const menu = mount(Vibe64PassesMenu, { passes: state });
  expect(menu.master.title).toBe("Master pass");
  expect(menu.ticked).toEqual(GENESIS_MASTER_PASS.passes);
  expect(GENESIS_MASTER_PASS.passes.map(menu.titleOf)).toEqual(["Review", "Security pass", "Data pass", "Quality pass", "Speed pass",
    "User experience pass", "Visual identity", "UI pass", "Deslop"]);
  const [whole] = menu.master.runs;
  expect(whole.label).toBe("Whole app (212 files, 18,450 lines)");
  expect(menu.lastRunLabel(menu.master)).toBe("Never completed");
  expect(menu.MASTER_NOTE).toBe("Runs each ticked pass deeply, one after another: it takes much longer and uses far more of your AI's allowance.");
  menu.opened = true;
  await menu.startMaster(whole);
  expect(send).toHaveBeenCalledWith({ message: "Master pass the whole app.", genesisTask: "master-pass", submissionKind: "send" });
  expect(menu.opened).toBe(false);
});

it("an unticked pass is not run: Start names only the ticked passes, in the Master order, and nothing ticked sends nothing", async () => {
  const { state, send } = passes();
  const menu = mount(Vibe64PassesMenu, { passes: state });
  menu.ticked = ["deslop", "ux-pass", "security-pass"];
  await menu.startMaster(menu.master.runs[0]);
  const [{ message }] = send.mock.calls.at(-1);
  expect(message).toBe("Master pass (Security pass, User experience pass, Deslop) the whole app.");
  for (const left of ["Review", "Data pass", "Quality pass", "Speed pass", "Visual identity", "UI pass"]) expect(message).not.toContain(left);
  // A run since the last completed Master pass names them the same way.
  const since = {
    id: "since-last",
    label: "Since last completed (abc1234, 3 commits; 4 files, 120 lines)",
    request: "Master pass: the changes since commit abc1234, judged against the whole app.",
    selectedRequest: "Master pass ({passes}): the changes since commit abc1234, judged against the whole app."
  };
  expect(masterRequest(GENESIS_MASTER_PASS, since, ["data-pass"], state.passes.value))
    .toBe("Master pass (Data pass): the changes since commit abc1234, judged against the whole app.");
  expect(masterRequest(GENESIS_MASTER_PASS, since, [...GENESIS_MASTER_PASS.passes], state.passes.value)).toBe(since.request);
  menu.ticked = [];
  send.mockClear();
  expect(await menu.startMaster(menu.master.runs[0])).toBeUndefined();
  expect(await state.runMaster(menu.master.runs[0], [])).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it("a suggestion offers the pass's ordinary runs; its deep run stays in Passes beside its cost", () => {
  mocks.resource.data.value = { ok: true, recommendation: "quality-pass", master: null,
    passes: listed({ "quality-pass": { lastRun: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(), commitsSince: 42 } }) };
  const { state } = passes();
  const suggestion = mount(Vibe64PassSuggestion, { passes: state, pass: state.recommendation.value });
  expect(state.recommendation.value.runs.map(({ id }) => id)).toEqual(["whole", "deep"]);
  expect(suggestion.runs.map(({ id }) => id)).toEqual(["whole"]);
  const menu = mount(Vibe64PassesMenu, { passes: state });
  expect(menu.master, "a read without the Master pass shows none").toBe(null);
});

// Lets a save started by a tick finish.
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

// Main chat's session, its saved chat mode carrying the passes it runs after a completed plan.
const mainChat = (preferences = {}, session = {}) => ({ sessionId: "session-1", ...session, metadata: { assistant_routing: JSON.stringify({
  mode: "auto", afterPlan: ["review", "security-pass", "data-pass", "quality-pass", "ui-pass", "deslop"], afterPlanDeep: [], autoSave: false, ...preferences
}) } });

it("Main chat's Passes tick the passes that run after a plan: Review and Security always, the rest saved through Chat settings in Master order", async () => {
  const { state } = passes();
  const menu = mount(Vibe64PassesMenu, { passes: state, session: mainChat(), sessionsApiPath: "/api/sessions" });
  expect(menu.afterPlanShown).toBe(true);
  expect(menu.afterPlanChangeable).toBe(true);
  expect(menu.AFTER_PLAN_NOTE).toMatch(/^After a plan: when a plan is completed, each ticked pass checks the plan's changes in its own turn/u);
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
