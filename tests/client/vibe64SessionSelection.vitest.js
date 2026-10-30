import { effectScope, nextTick, reactive, ref, watch } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
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

// The project page passes the person's server record as the remembered
// session; this tab's stored selection is then only mirrored for other readers.
function rememberedFixture({ routeSession = "", stored = "" } = {}) {
  const storage = new Map(stored ? [["vibe64:selected-session-id:project:alpha", stored]] : []);
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key) => storage.get(key) ?? null,
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, value)
  } });
  const route = reactive({ query: routeSession ? { session: routeSession } : {} });
  const remembered = ref("");
  scope = effectScope();
  const selection = scope.run(() => useVibe64SessionSelection({ projectSlug: ref("alpha"), rememberedId: remembered, route }));
  const reconcile = (ids) => selection.selectAvailableId(ids.map((id) => ({ id })), { fallbackId: ids.at(-1) });
  return { remembered, reconcile, route, selection, stored: () => storage.get("vibe64:selected-session-id:project:alpha") };
}

describe("remembered session", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the person's remembered session, not this tab's stored one", () => {
    const f = rememberedFixture({ stored: "s1" });
    expect(f.selection.selectedId.value).toBe("");
    f.remembered.value = "s3";
    expect(f.reconcile(["s1", "s2", "s3", "s4"])).toBe("s3");
    expect(f.stored()).toBe("s3");
  });

  it("lets an explicit session in the address win", () => {
    const f = rememberedFixture({ routeSession: "s2" });
    expect(f.selection.selectedId.value).toBe("s2");
    f.remembered.value = "s3";
    expect(f.reconcile(["s1", "s2", "s3"])).toBe("s2");
  });

  it("falls back to the default when the remembered session is not listed", () => {
    const f = rememberedFixture({ stored: "s1" });
    f.remembered.value = "archived";
    expect(f.reconcile(["s1", "s2"])).toBe("s2");
  });

  it("still lets other readers follow this tab's stored selection", () => {
    rememberedFixture({ stored: "s1" });
    const reader = scope.run(() => useVibe64SessionSelection({ projectSlug: ref("alpha"), route: reactive({ query: {} }) }));
    expect(reader.selectedId.value).toBe("s1");
  });
});
