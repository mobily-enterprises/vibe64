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
