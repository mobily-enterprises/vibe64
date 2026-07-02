import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive, ref } from "vue";
import {
  vibe64BrowserTabOriginId
} from "../../src/lib/vibe64BrowserTabOrigin.js";

const mocks = vi.hoisted(() => ({
  beforeUnmount: [],
  realtimeOptions: [],
  requestCalls: [],
  route: null,
  routerPushCalls: []
}));

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onBeforeUnmount(callback) {
      mocks.beforeUnmount.push(callback);
    }
  };
});

vi.mock("vue-router", () => ({
  useRoute() {
    return mocks.route;
  },
  useRouter() {
    return {
      async push(routeFullPath) {
        mocks.routerPushCalls.push(routeFullPath);
        mocks.route.fullPath = routeFullPath;
      }
    };
  }
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    mocks.realtimeOptions.push(options);
  }
}));

vi.mock("@jskit-ai/users-web/client/lib/httpClient", () => ({
  getUsersWebHttpClient() {
    return {
      async request(...args) {
        mocks.requestCalls.push(args);
        return {};
      }
    };
  }
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useVibe64SessionViewSync", () => {
  beforeEach(() => {
    mocks.beforeUnmount.length = 0;
    mocks.realtimeOptions.length = 0;
    mocks.requestCalls.length = 0;
    mocks.routerPushCalls.length = 0;
    mocks.route = reactive({
      fullPath: "/app/project/beepollen",
      params: {
        slug: "beepollen"
      }
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const callback of mocks.beforeUnmount) {
      callback();
    }
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("normalizes only preview and dashboard routes for the active project", async () => {
    const {
      normalizeSessionViewRouteFullPath,
      sessionViewProjectPane
    } = await import("../../src/composables/useVibe64SessionViewSync.js");

    expect(normalizeSessionViewRouteFullPath(
      "/app/project/beepollen/dashboard//diff?mode=review#changes",
      "beepollen"
    )).toBe("/app/project/beepollen/dashboard/diff?mode=review#changes");
    expect(sessionViewProjectPane("/app/project/beepollen", "beepollen")).toBe("preview");
    expect(sessionViewProjectPane("/app/project/beepollen/dashboard/env", "beepollen")).toBe("dashboard");
    expect(normalizeSessionViewRouteFullPath(
      "/app/project/other/dashboard/diff",
      "beepollen"
    )).toBe("");
    expect(normalizeSessionViewRouteFullPath(
      "https://example.com/app/project/beepollen/dashboard/diff",
      "beepollen"
    )).toBe("");
  });

  it("publishes selected-session route changes without publishing the initial route", async () => {
    const {
      useVibe64SessionViewSync
    } = await import("../../src/composables/useVibe64SessionViewSync.js");
    useVibe64SessionViewSync({
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/sessions")
    });

    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls).toEqual([]);

    mocks.route.fullPath = "/app/project/beepollen/dashboard/env";
    await nextTick();
    await flushPromises();

    expect(mocks.requestCalls).toEqual([
      [
        "/api/app/vibe64/sessions/session-1/view-state",
        {
          body: {
            originId: vibe64BrowserTabOriginId(),
            projectSlug: "beepollen",
            routeFullPath: "/app/project/beepollen/dashboard/env"
          },
          method: "POST"
        }
      ]
    ]);
  });

  it("hydrates selected-session route state without publishing it back", async () => {
    const {
      useVibe64SessionViewSync
    } = await import("../../src/composables/useVibe64SessionViewSync.js");
    useVibe64SessionViewSync({
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/sessions"),
      viewState: ref({
        originId: "other-tab",
        projectSlug: "beepollen",
        routeFullPath: "/app/project/beepollen/dashboard/files",
        sessionId: "session-1",
        updatedAt: "2026-07-02T00:00:00.000Z"
      })
    });

    await nextTick();
    await flushPromises();

    expect(mocks.routerPushCalls).toEqual([
      "/app/project/beepollen/dashboard/files"
    ]);
    expect(mocks.requestCalls).toEqual([]);
  });

  it("follows matching remote route changes without echoing them", async () => {
    const {
      useVibe64SessionViewSync
    } = await import("../../src/composables/useVibe64SessionViewSync.js");
    useVibe64SessionViewSync({
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/sessions")
    });
    const realtime = mocks.realtimeOptions.at(-1);

    expect(realtime.matches({
      payload: {
        originId: "other-tab",
        projectSlug: "beepollen",
        routeFullPath: "/app/project/beepollen/dashboard/diff",
        sessionId: "session-1"
      }
    })).toBe(true);
    expect(realtime.matches({
      payload: {
        originId: vibe64BrowserTabOriginId(),
        projectSlug: "beepollen",
        routeFullPath: "/app/project/beepollen/dashboard/diff",
        sessionId: "session-1"
      }
    })).toBe(false);
    expect(realtime.matches({
      payload: {
        originId: "other-tab",
        projectSlug: "beepollen",
        routeFullPath: "/app/project/beepollen/dashboard/diff",
        sessionId: "session-2"
      }
    })).toBe(false);
    expect(realtime.matches({
      payload: {
        originId: "other-tab",
        projectSlug: "other-project",
        routeFullPath: "/app/project/other-project/dashboard/diff",
        sessionId: "session-1"
      }
    })).toBe(false);

    realtime.onEvent({
      payload: {
        originId: "other-tab",
        projectSlug: "beepollen",
        routeFullPath: "/app/project/beepollen/dashboard/diff",
        sessionId: "session-1"
      }
    });
    await nextTick();
    await flushPromises();

    expect(mocks.routerPushCalls).toEqual([
      "/app/project/beepollen/dashboard/diff"
    ]);
    expect(mocks.requestCalls).toEqual([]);
  });
});
