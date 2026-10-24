// The studio stage frame: the lesson it lays over a studio page (?lesson=1)
// stays shown while the learner moves between that page's views, until hidden.
import { createRenderer, nextTick, reactive, ref, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";

const route = reactive({ path: "/app/manage/launcher", query: { lesson: "1" } });
const router = { replace: vi.fn(async ({ path, query }) => Object.assign(route, { path, query })) };
const smAndDown = ref(false);

vi.mock("vue-router", () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock("vuetify", () => ({ useDisplay: () => ({ smAndDown }) }));
vi.mock("@/composables/useVibe64Learning.js", () => ({ useVibe64Learning: () => ({ learnMode: true, lessonAttemptId: "attempt-1" }) }));
vi.mock("../../src/components/learning/Vibe64LessonSheet.vue", () => ({ default: { render: () => null } }));
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

it("keeps the lesson shown while the learner moves between studio views, until they hide it", async () => {
  Object.assign(route, { path: "/app/manage/launcher", query: { lesson: "1" } });
  smAndDown.value = false;
  const stage = mount();
  await go("/app/manage/projects");
  expect(router.replace).toHaveBeenLastCalledWith({ path: "/app/manage/projects", query: { lesson: "1" } });
  expect(route.query.lesson).toBe("1");
  expect(stage.owner.lessonShown).toBe(true);
  // The learner's own hide (the toggle, or the sheet's Hide lesson) is kept.
  stage.owner.hideLesson();
  await nextTick();
  await nextTick();
  router.replace.mockClear();
  expect([route.query.lesson, stage.owner.lessonShown]).toEqual([undefined, false]);
  await go("/app/manage/users");
  expect(router.replace).not.toHaveBeenCalled();
});

it("shows the page the learner moved to on a phone", async () => {
  Object.assign(route, { path: "/app/manage/launcher", query: { lesson: "1" } });
  smAndDown.value = true;
  mount();
  await go("/app/manage/projects");
  expect(router.replace).not.toHaveBeenCalled();
});
