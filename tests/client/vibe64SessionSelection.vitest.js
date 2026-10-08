import { effectScope, nextTick, reactive, ref, watch } from "vue";
import { afterEach, expect, it } from "vitest";
import { useVibe64SessionSelection } from "../../src/composables/useVibe64SessionSelection.js";

let scope;
afterEach(() => scope?.stop());

function selectionFixture() {
  const route = reactive({ query: { session: "first" } });
  const sessions = ref([{ id: "first" }, { id: "second" }]);
  scope = effectScope();
  const selection = scope.run(() => {
    const value = useVibe64SessionSelection({ projectSlug: ref("session-click-test"), route });
    watch([value.selectedId, sessions], () => value.selectAvailableId(sessions.value), { immediate: true });
    return value;
  });
  return { route, sessions, selection };
}

it("keeps a clicked session selected when the URL still names the previous session", async () => {
  const { route, sessions, selection } = selectionFixture();
  expect(selection.selectedId.value).toBe("first");
  selection.select("second");
  await nextTick();
  expect(route.query.session).toBe("first");
  expect(selection.selectedId.value).toBe("second");
  sessions.value = [{ id: "first" }, { id: "second" }];
  await nextTick();
  expect(selection.selectedId.value).toBe("second");
});

it("still follows a later explicit session URL and browser navigation", async () => {
  const { route, selection } = selectionFixture();
  route.query.session = "second";
  await nextTick();
  expect(selection.selectedId.value).toBe("second");
  route.query.session = "first";
  await nextTick();
  expect(selection.selectedId.value).toBe("first");
});

it("uses an available session when the selected session disappears", async () => {
  const { sessions, selection } = selectionFixture();
  selection.select("second");
  await nextTick();
  sessions.value = [{ id: "first" }];
  await nextTick();
  expect(selection.selectedId.value).toBe("first");
});

it("remembers Working and picker-wide own Learning choices without reading or writing storage while learner identity is pending", async () => {
  const { vi } = await import("vitest");
  const values = new Map();
  const storage = { getItem: vi.fn(key => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, value)), removeItem: vi.fn(key => values.delete(key)) };
  const previousWindow = globalThis.window;
  globalThis.window = { sessionStorage: storage };
  try {
    const route = reactive({ query: { session: "first" } });
    const purpose = ref("working");
    const learnerId = ref("");
    const projectSlug = ref("mode-memory-project");
    scope = effectScope();
    const working = scope.run(() => useVibe64SessionSelection({ route, projectSlug }));
    const learning = scope.run(() => useVibe64SessionSelection({ route, purpose: "learning", learnerId, projectSlug }));
    const selection = { selectedId: { get value() { return purpose.value === "learning" ? learning.selectedId.value : working.selectedId.value; } },
      select: id => (purpose.value === "learning" ? learning : working).select(id),
      selectAvailableId: (...args) => (purpose.value === "learning" ? learning : working).selectAvailableId(...args),
      capture: () => working.capture() };
    selection.select("second");
    const workingKey = [...values.keys()][0];
    const captured = selection.capture();
    const callsBefore = storage.getItem.mock.calls.length + storage.setItem.mock.calls.length + storage.removeItem.mock.calls.length;
    purpose.value = "learning";
    await nextTick();
    expect(selection.selectedId.value).toBe("");
    selection.select("cannot-store-an-unknown-actor");
    selection.selectAvailableId([{ id: "unknown" }], { fallbackId: "unknown" });
    expect(storage.getItem.mock.calls.length + storage.setItem.mock.calls.length + storage.removeItem.mock.calls.length).toBe(callsBefore);
    expect(values.has("")).toBe(false);
    learnerId.value = "actual-learner";
    await nextTick();
    selection.select("learning-one");
    const learningKey = [...values.keys()].find(key => key.includes(":learning:"));
    expect(learningKey).toContain(":learning:actual-learner");
    expect(learningKey).not.toContain(":attempt:");
    selection.select("learning-two");
    captured.select("working-created-late");
    expect(selection.selectedId.value).toBe("learning-two");
    expect(values.get(workingKey)).toBe("working-created-late");
    expect(values.get(learningKey)).toBe("learning-two");
    purpose.value = "working";
    await nextTick();
    expect(selection.selectedId.value).toBe("working-created-late");
    purpose.value = "learning";
    await nextTick();
    expect(selection.selectedId.value).toBe("learning-two");
    route.query.learningSession = "learning-one";
    await nextTick();
    expect(selection.selectedId.value).toBe("learning-one");
    learnerId.value = "other-confirmed-learner";
    route.query.learningSession = undefined;
    await nextTick();
    expect(selection.selectedId.value).toBe("");
    expect(values.get(learningKey)).toBe("learning-two");
  } finally {
    scope?.stop();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
