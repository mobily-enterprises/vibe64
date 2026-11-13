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

import { GENESIS_PASSES_ADAPTER } from "../../packages/vibe64-genesis/src/server/passes.js";
import { useVibe64Passes } from "../../src/composables/useVibe64Passes.js";
import Vibe64PassesMenu from "../../src/components/studio/vibe64-session/Vibe64PassesMenu.vue";
import Vibe64PassSuggestion from "../../src/components/studio/vibe64-session/Vibe64PassSuggestion.vue";

const DAY = 24 * 60 * 60 * 1000;
// The server's read: the adapter's passes, with the project's last runs.
const listed = (states = {}) => GENESIS_PASSES_ADAPTER.map((pass) => ({
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

it("lists Genesis's passes from the session's read, each with its last run or Never run", () => {
  const ran = new Date(Date.now() - 3 * DAY);
  mocks.resource.data.value.passes = listed({ "quality-pass": { lastRun: ran.toISOString(), commitsSince: 7 } });
  const { state } = passes();
  expect(mocks.resource.options.path.value).toBe("/api/sessions/session-1/passes");
  expect(state.passes.value.map(({ id, title, description }) => ({ id, title, description })))
    .toEqual(GENESIS_PASSES_ADAPTER.map(({ id, title, description }) => ({ id, title, description })));
  const menu = mount(Vibe64PassesMenu, { passes: state });
  expect(menu.list.map(({ title }) => title)).toEqual(GENESIS_PASSES_ADAPTER.map(({ title }) => title));
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(ran);
  expect(menu.lastRunLabel(menu.list.find(({ id }) => id === "quality-pass"))).toBe(`Last run: ${date} · 7 commits since`);
  expect(menu.lastRunLabel(menu.list.find(({ id }) => id === "deslop"))).toBe("Never run");
});

it("Run sends the pass's own request to Main chat as the person's message for Genesis's task, and closes the list", async () => {
  const { state, send } = passes();
  const menu = mount(Vibe64PassesMenu, { passes: state });
  menu.opened = true;
  await menu.start(state.passes.value.find(({ id }) => id === "quality-pass"));
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ message: "Quality pass the whole app.", genesisTask: "quality-pass", submissionKind: "send" });
  expect(menu.opened).toBe(false);
  expect(state.error.value).toBe("");
  expect(mocks.resource.reload).toHaveBeenCalled();
});

it("a refused Run keeps the list open with Main chat's reason", async () => {
  const send = vi.fn(async () => {
    throw new Error("Quality pass uses the Senior model in its own turn. Finish or stop the current turn, then send Quality pass again.");
  });
  const { state } = passes({ send });
  const menu = mount(Vibe64PassesMenu, { passes: state, blockedReason: "" });
  menu.opened = true;
  await menu.start(state.passes.value.find(({ id }) => id === "quality-pass"));
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
  expect(suggestion.headline).toBe("Your app has changed a lot since Quality pass last ran. Run it again?");
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
  expect(first.headline).toBe("Visual identity has never run on this app. Run it?");
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
