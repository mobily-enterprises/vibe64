// The studio stage frame: the Lesson pane it docks beside a studio page stays
// docked while the learner moves between that page's views, until closed.
import { createRenderer, nextTick, reactive, ref, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";

const route = reactive({ path: "/app/manage/launcher", query: { pane: "lesson" } });
const router = { replace: vi.fn(async ({ path, query }) => Object.assign(route, { path, query })) };
const smAndDown = ref(false);

vi.mock("vue-router", () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock("vuetify", () => ({ useDisplay: () => ({ smAndDown }) }));
vi.mock("@/composables/useVibe64Learning.js", () => ({ useVibe64Learning: () => ({ learnMode: true, lessonAttemptId: "attempt-1" }) }));
vi.mock("../../src/components/learning/Vibe64LearningLessonPane.vue", () => ({ default: { render: () => null } }));
vi.mock("../../src/components/learning/Vibe64LearningStepBar.vue", () => ({ default: { render: () => null } }));

const { default: Stage } = await import("../../src/components/learning/Vibe64LearningStage.vue");

let app;
afterEach(() => {
  app?.unmount();
  app = null;
  router.replace.mockClear();
});

function mount() {
  const node = () => ({});
  const renderer = createRenderer({ createComment: node, createElement: node, createText: node, setText() {}, setElementText() {},
    patchProp() {}, insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...Stage, render: () => null }, { studio: true });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}

const go = async (path, query = {}) => {
  Object.assign(route, { path, query });
  await nextTick();
  await nextTick();
};

it("keeps the docked Lesson pane while the learner moves between studio views, until they close it", async () => {
  Object.assign(route, { path: "/app/manage/launcher", query: { pane: "lesson" } });
  smAndDown.value = false;
  const stage = mount();
  await go("/app/manage/projects");
  expect(router.replace).toHaveBeenLastCalledWith({ path: "/app/manage/projects", query: { pane: "lesson" } });
  expect(route.query.pane).toBe("lesson");
  // The learner's own close is kept.
  stage.closeLesson();
  await nextTick();
  await nextTick();
  router.replace.mockClear();
  await go("/app/manage/users");
  expect(router.replace).not.toHaveBeenCalled();
});

it("shows the page the learner moved to on a phone", async () => {
  Object.assign(route, { path: "/app/manage/launcher", query: { pane: "lesson" } });
  smAndDown.value = true;
  mount();
  await go("/app/manage/projects");
  expect(router.replace).not.toHaveBeenCalled();
});
