import { createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null }));
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
  expect(GENESIS_MASTER_PASS.passes.map(menu.titleOf)).toEqual(["Security pass", "Data pass", "Quality pass", "Speed pass",
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
  for (const left of ["Data pass", "Quality pass", "Speed pass", "Visual identity", "UI pass"]) expect(message).not.toContain(left);
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
