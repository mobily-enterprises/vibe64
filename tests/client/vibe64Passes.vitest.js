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

import { GENESIS_PASSES } from "../fixtures/genesisPasses.js";
import { runKey, useVibe64Passes } from "../../src/composables/useVibe64Passes.js";
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
    data: ref({ ok: true, passes: listed(), recommendation: "" }),
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
  mocks.resource.data.value.passes = listed({ "quality-pass": { lastRun: new Date().toISOString(), runs: [...quality.runs, since] } });
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
  expect(send.mock.calls.map(([input]) => input.message)).toEqual(["Quality pass the whole app.", since.request]);
  expect(starting).toEqual(["quality-pass:whole", "quality-pass:since-last"]);
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
