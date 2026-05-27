import { nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  vibe64SessionModeStorageKey
} from "../../src/lib/vibe64SessionModeStorage.js";
import {
  useVibe64SessionMode
} from "../../src/composables/useVibe64SessionMode.js";

describe("useVibe64SessionMode", () => {
  let originalWindowDescriptor;

  beforeEach(() => {
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    installWindowStorage();
  });

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      delete globalThis.window;
    }
  });

  it("keeps Autopilot and Inspect mode scoped to each session", async () => {
    const selectedSessionId = ref("");
    const route = refRoute({
      mode: "inspect",
      surface: "home"
    });
    const router = refRouter(route);
    const sessionMode = useVibe64SessionMode({
      route,
      router,
      selectedSessionId
    });

    selectedSessionId.value = "session-alpha";
    await nextTick();

    expect(sessionMode.sessionMode.value).toBe("inspect");
    expect(window.localStorage.getItem(vibe64SessionModeStorageKey("session-alpha"))).toBe("inspect");
    expect(route.query).toEqual({
      mode: "inspect",
      surface: "home"
    });

    selectedSessionId.value = "session-beta";
    await nextTick();

    expect(sessionMode.sessionMode.value).toBe("autopilot");
    expect(window.localStorage.getItem(vibe64SessionModeStorageKey("session-beta"))).toBeNull();
    expect(route.query).toEqual({
      surface: "home"
    });

    sessionMode.setSessionMode("inspect");
    expect(window.localStorage.getItem(vibe64SessionModeStorageKey("session-beta"))).toBe("inspect");
    expect(route.query).toEqual({
      mode: "inspect",
      surface: "home"
    });

    selectedSessionId.value = "session-alpha";
    await nextTick();

    expect(sessionMode.sessionMode.value).toBe("inspect");
    expect(window.localStorage.getItem(vibe64SessionModeStorageKey("session-alpha"))).toBe("inspect");
  });
});

function installWindowStorage() {
  const values = new Map();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => {
          values.set(key, String(value));
        })
      }
    }
  });
}

function refRoute(query = {}) {
  return {
    query: {
      ...query
    }
  };
}

function refRouter(route) {
  return {
    replace: vi.fn(({ query }) => {
      route.query = {
        ...query
      };
    })
  };
}
