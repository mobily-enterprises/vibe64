import { readFileSync } from "node:fs";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, createRenderer, effectScope, nextTick, reactive, ref, unref } from "vue";
import { routeLocationKey } from "vue-router";

const endpointMocks = vi.hoisted(() => ({
  calls: [],
  live: false,
  resources: [],
  useEndpointResource: vi.fn()
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useEndpointResource: (options) => endpointMocks.live
      ? actual.useEndpointResource(options)
      : endpointMocks.useEndpointResource(options)
  };
});
vi.mock("@jskit-ai/http-web/client/composables/useCommand", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useCommand: (options) => endpointMocks.live
      ? actual.useCommand(options)
      : { isRunning: false, run: vi.fn() }
  };
});

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({
    api: (suffix = "") => `/api${suffix}`
  })
}));

import { VIBE64_LESSON_DASHBOARD_KEY, lessonDashboardScope } from "../../src/lib/vibe64LessonDashboard.js";
import {
  useVibe64SystemGraph
} from "../../packages/vibe64-system-graph/src/client/composables/useVibe64SystemGraph.js";
import {
  useVibe64DatabaseTools
} from "../../packages/vibe64-database-tools/src/client/composables/useVibe64DatabaseTools.js";

function endpointResource(data = null) {
  return {
    data: ref(data),
    mutation: { reset: vi.fn() },
    isLoading: ref(false),
    isSaving: ref(false),
    loadError: ref(""),
    reload: vi.fn(async () => ({ data })),
    save: vi.fn(async () => ({ ok: true })),
    saveError: ref("")
  };
}

describe("Genesis City client resources", () => {
  beforeEach(() => {
    endpointMocks.calls.length = 0;
    endpointMocks.live = false;
    endpointMocks.resources = [
      endpointResource({
        cities: {
          machine: { available: true },
          program: { available: false }
        },
        status: "partial"
      }),
      endpointResource({ city: { schema: "genesis.machine-city.v1" } }),
      endpointResource(null),
      endpointResource(null),
      endpointResource(null),
      endpointResource(null),
      endpointResource({ status: "missing", subsystems: [] }),
      endpointResource(null)
    ];
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.calls.push(options);
      return endpointMocks.resources[endpointMocks.calls.length - 1];
    });
  });

  it("defers a subsystem map reload until the retained view becomes active", async () => {
    const active = ref(false);
    const reloadVersion = ref(0);
    const scope = effectScope();
    scope.run(() => useVibe64SystemGraph({ active, reloadVersion, sessionId: "session-1" }));
    reloadVersion.value += 1;
    await nextTick();
    expect(endpointMocks.resources[6].reload).not.toHaveBeenCalled();
    active.value = true;
    await nextTick();
    expect(endpointMocks.resources[6].reload).toHaveBeenCalledOnce();
    active.value = false;
    await nextTick();
    active.value = true;
    await nextTick();
    expect(endpointMocks.resources[6].reload).toHaveBeenCalledOnce();
    scope.stop();
  });

  it.each([
    { component: "Vibe64DatabaseWorkspace", pane: "database", useTool: useVibe64DatabaseTools, resources: 1 },
    { component: "Vibe64ArchitectureView", pane: "system", useTool: useVibe64SystemGraph, resources: 8 }
  ])("pauses $component resource admission through the actual retained-session binding", async ({ component, pane, useTool, resources }) => {
    const autopilot = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue", import.meta.url
    ), "utf8");
    const tag = autopilot.match(new RegExp(`<${component}\\b[\\s\\S]*?>`, "u"))?.[0];
    const binding = tag?.match(/:active="([^"]+)"/u)?.[1];
    expect(binding).toBeDefined();
    const childActive = new Function("props", "rightPaneTab", "normalWorkspaceActive", `return (${binding});`);
    const props = reactive({ active: true, projectPane: "dashboard" });
    const rightPaneTab = ref(pane);
    const normalWorkspaceActive = ref(true);
    const sessionId = ref("session/a");
    const scope = effectScope();
    try {
      scope.run(() => useTool({
        active: computed(() => childActive(props, rightPaneTab.value, normalWorkspaceActive.value)),
        sessionId
      }));
      expect(endpointMocks.calls).toHaveLength(resources);
      expect(endpointMocks.calls[0].enabled.value).toBe(true);
      const paths = endpointMocks.calls.map((call) => call.path.value);
      const keys = endpointMocks.calls.map((call) => call.queryKey.value);
      const enabled = endpointMocks.calls.map((call) => unref(call.enabled));
      expect(paths[0]).toContain("/sessions/session%2Fa");

      normalWorkspaceActive.value = false;
      await nextTick();
      expect(endpointMocks.calls.every((call) => unref(call.enabled) === false)).toBe(true);
      normalWorkspaceActive.value = true;
      await nextTick();
      expect(endpointMocks.calls.map((call) => unref(call.enabled))).toEqual(enabled);

      props.active = false;
      await nextTick();
      expect(endpointMocks.calls.every((call) => unref(call.enabled) === false)).toBe(true);
      expect(endpointMocks.calls.map((call) => call.path.value)).toEqual(pane === "database" ? Array(resources).fill("") : paths);

      props.active = true;
      await nextTick();
      expect(endpointMocks.calls.map((call) => call.path.value)).toEqual(paths);
      expect(endpointMocks.calls.map((call) => call.queryKey.value)).toEqual(keys);
      expect(endpointMocks.calls).toHaveLength(resources);
      expect(sessionId.value).toBe("session/a");

      rightPaneTab.value = "editor";
      await nextTick();
      expect(endpointMocks.calls.every((call) => unref(call.enabled) === false)).toBe(true);
      rightPaneTab.value = pane;
      props.projectPane = "preview";
      await nextTick();
      expect(endpointMocks.calls.every((call) => unref(call.enabled) === false)).toBe(true);
      props.projectPane = "dashboard";
      await nextTick();
      expect(endpointMocks.calls.map((call) => call.path.value)).toEqual(paths);
    } finally {
      scope.stop();
    }
  });

  it("reports project progress only during refresh and retains command failures inline", async () => {
    const scope = effectScope();
    let graph;
    scope.run(() => { graph = useVibe64SystemGraph({ sessionId: "session-1" }); });
    const refresh = endpointMocks.resources[4];
    const status = endpointMocks.calls[7];
    expect(unref(status.enabled)).toBe(true);
    expect(status.realtime.event).toBe("vibe64.session.changed");
    const pending = Promise.withResolvers();
    refresh.save.mockImplementation(async () => {
      refresh.isSaving.value = true;
      try { return await pending.promise; }
      catch (error) { refresh.saveError.value = error.message; throw error; }
      finally { refresh.isSaving.value = false; }
    });
    const result = graph.refresh();
    expect(unref(status.enabled)).toBe(true);
    endpointMocks.resources[7].data.value = { refresh: { status: "running", startedAt: Date.now() - 12000, message: "Running UI inspector…", elapsedSeconds: 12 } };
    expect(graph.refreshProgress.value.message).toBe("Running UI inspector…");
    endpointMocks.resources[7].data.value = { refresh: { status: "failed", message: "UI inspector failed.", commandOutput: "Required file missing." } };
    pending.reject(Object.assign(new Error("UI inspector failed."), { details: { commandOutput: "Required file missing." } }));
    await expect(result).resolves.toBeNull();
    expect(graph.error.value).toBe("UI inspector failed.");
    expect(graph.refreshOutput.value).toBe("Required file missing.");
    expect(graph.refreshProgress.value).toBeNull();
    expect(unref(status.enabled)).toBe(true);
    expect(endpointMocks.resources[0].reload).toHaveBeenCalled();
    scope.stop();
  });

  it("reads a practice lesson's Architecture on its lesson URL and follows only that attempt's refresh events", () => {
    const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let graph;
    const app = createRenderer({ createComment: () => ({}), insert() {}, nextSibling: () => null,
      parentNode: () => null, remove() {} }).createApp({ setup() {
      graph = useVibe64SystemGraph({ active: ref(true), sessionId: ref("training-own") });
      return () => null;
    } });
    app.provide(routeLocationKey, reactive({ path: "/app/project/working", fullPath: "/app/project/working",
      params: { slug: "working" }, query: {} }));
    app.provide(VIBE64_LESSON_DASHBOARD_KEY, ref(lessonDashboardScope(attemptId, "training-own")));
    app.mount({});
    try {
      expect(graph).toBeTruthy();
      const paths = endpointMocks.calls.map(call => unref(call.path));
      expect(paths).toHaveLength(8);
      for (const path of paths) expect(path.startsWith(`/api/learning/${attemptId}/vibe64/system-graph/sessions/training-own/`)).toBe(true);
      // The Working project's cache entries are never reused for the lesson.
      for (const call of endpointMocks.calls) expect(JSON.stringify(unref(call.queryKey))).not.toContain("working");
      const status = endpointMocks.calls.find(call => call.realtime);
      const event = payload => status.realtime.matches({ payload: { sessionId: "training-own", reason: "architecture-refresh", ...payload } });
      expect(event({ learningAttemptId: attemptId, projectSlug: "" })).toBe(true);
      expect(event({ learningAttemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", projectSlug: "" })).toBe(false);
      expect(event({ projectSlug: "working" })).toBe(false);
    } finally { app.unmount(); }
  });

  it("reads status and native Cities, then refreshes synchronously", async () => {
    const scope = effectScope();
    let graph;
    scope.run(() => {
      graph = useVibe64SystemGraph({
        active: ref(true),
        sessionId: ref("session/a")
      });
    });

    expect(endpointMocks.calls).toHaveLength(8);
    expect(endpointMocks.calls.map((call) => call.path.value)).toEqual([
      "/api/vibe64/system-graph/sessions/session%2Fa/status",
      "/api/vibe64/system-graph/sessions/session%2Fa/cities/machine",
      "/api/vibe64/system-graph/sessions/session%2Fa/architecture",
      "/api/vibe64/system-graph/sessions/session%2Fa/cities/program",
      "/api/vibe64/system-graph/sessions/session%2Fa/refresh",
      "/api/vibe64/system-graph/sessions/session%2Fa/refresh/cancel",
      "/api/vibe64/system-graph/sessions/session%2Fa/subsystems",
      "/api/vibe64/system-graph/sessions/session%2Fa/refresh/status"
    ]);
    expect(endpointMocks.calls[1].enabled.value).toBe(true);
    expect(endpointMocks.calls[3].enabled.value).toBe(false);
    expect(endpointMocks.calls[4].enabled).toBe(false);
    expect(graph.machineCity.value).toEqual({ schema: "genesis.machine-city.v1" });
    expect(graph.programCity.value).toBeNull();

    await graph.refresh();

    expect(endpointMocks.resources[4].save).toHaveBeenCalledOnce();
    expect(endpointMocks.resources[4].save).toHaveBeenCalledWith({}, { method: "POST", options: { timeoutMs: 600_000 } });
    expect(endpointMocks.resources[0].reload).toHaveBeenCalledOnce();
    expect(endpointMocks.resources[1].reload).toHaveBeenCalledOnce();
    expect(endpointMocks.resources[3].reload).not.toHaveBeenCalled();
    scope.stop();
  });

  it.each([
    { label: "Database schema", family: "database", useTool: useVibe64DatabaseTools },
    { label: "Cities", family: "system-graph", useTool: useVibe64SystemGraph },
    { label: "Cities status", family: "system-graph", useTool: useVibe64SystemGraph, holdStatus: true },
    { label: "Architecture", family: "system-graph", useTool: useVibe64SystemGraph, projection: "architecture" },
    { label: "Architecture status", family: "system-graph", useTool: useVibe64SystemGraph, projection: "architecture", holdStatus: true }
  ])("finishes a held $label refresh while hidden without a path error and reads fresh data on return", async ({ family, useTool, holdStatus = false, projection = "native" }) => {
    endpointMocks.live = true;
    const database = family === "database";
    const sessionPath = `/api/vibe64/${family}/sessions/session%2Fa`;
    const readPaths = database
      ? [sessionPath]
      : (projection === "architecture" ? ["/status", "/architecture"] : ["/status", "/cities/machine", "/cities/program"]).map((suffix) => `${sessionPath}${suffix}`);
    const writePath = `${sessionPath}${database ? "/schema/refresh" : "/refresh"}`;
    const reads = [];
    const writes = [];
    const commandResponse = Promise.withResolvers();
    const statusResponse = Promise.withResolvers();
    const previousClient = getHttpWebClient();
    const active = ref(true);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    let revision = 1;
    let tool;
    let refreshing = Promise.resolve();
    configureHttpWebClient({
      request(url, options) {
        if (options.method === "POST") {
          expect(url).toBe(writePath);
          if (!database) expect(options.timeoutMs).toBe(600_000);
          writes.push(url);
          return commandResponse.promise;
        }
        expect(options.method).toBe("GET");
        if (!database && url === `${sessionPath}/refresh/status`) return Promise.resolve({ refresh: { message: "Scanning source…", elapsedSeconds: 2 } });
        if (!database && url === `${sessionPath}/subsystems`) return Promise.resolve({ subsystems: [], status: "missing" });
        expect(readPaths).toContain(url);
        reads.push(url);
        if (database) return Promise.resolve({ revision, schema: { tables: [] } });
        if (url.endsWith("/status")) {
          if (holdStatus && reads.length === readPaths.length + 1) return statusResponse.promise;
          return Promise.resolve({
            revision,
            cities: { machine: { available: true }, program: { available: true } }
          });
        }
        return Promise.resolve(projection === "architecture" ? { architecture: { revision } } : { city: { revision } });
      }
    });
    const app = createRenderer({
      createComment: () => ({}),
      insert() {},
      nextSibling: () => null,
      parentNode: () => null,
      remove() {}
    }).createApp({
      setup() {
        tool = useTool({ active, sessionId: ref("session/a"), projection });
        return () => null;
      }
    });
    app.use(VueQueryPlugin, { queryClient });
    app.provide(routeLocationKey, reactive({ fullPath: "/app/project/project-a/dashboard", params: {}, query: {} }));
    app.provide("jskit.shell-web.runtime.web-error.client", {
      dismiss: vi.fn(),
      report: vi.fn(() => ({ skipped: true }))
    });
    try {
      app.mount({});
      await vi.waitFor(() => {
        expect(reads).toHaveLength(readPaths.length);
        expect(queryClient.isFetching()).toBe(0);
      });
      expect(tool.error.value).toBe("");
      refreshing = database ? tool.refreshSchema() : tool.refresh();
      void refreshing.catch(() => {});
      await vi.waitFor(() => expect(writes).toEqual([writePath]));
      expect(tool.refreshing.value).toBe(true);
      if (holdStatus) {
        commandResponse.resolve({ ok: true });
        await vi.waitFor(() => expect(reads).toHaveLength(readPaths.length + 1));
        expect(reads.at(-1)).toBe(`${sessionPath}/status`);
      }
      active.value = false;
      await nextTick();
      revision = 2;
      commandResponse.resolve({ ok: true });
      statusResponse.resolve({
        revision,
        cities: { machine: { available: true }, program: { available: true } }
      });
      expect(await refreshing).toEqual({ ok: true });
      await tool.reload();
      await nextTick();
      const hiddenError = tool.error.value;
      expect(tool.refreshing.value).toBe(false);
      const beforeReturn = readPaths.length + (holdStatus ? 1 : 0);
      expect(reads).toHaveLength(beforeReturn);

      active.value = true;
      await nextTick();
      await vi.waitFor(() => {
        expect(reads).toHaveLength(beforeReturn + readPaths.length);
        expect(queryClient.isFetching()).toBe(0);
        expect(tool.error.value).toBe("");
      });
      expect(reads.slice(beforeReturn).sort()).toEqual([...readPaths].sort());
      if (database) {
        expect(tool.state.value.revision).toBe(2);
      } else {
        expect(tool.systemStatus.value.revision).toBe(2);
        if (projection === "architecture") {
          expect(tool.architecture.value.revision).toBe(2);
          expect(tool.machineCity.value).toBeNull();
          expect(tool.programCity.value).toBeNull();
        } else {
          expect(tool.machineCity.value.revision).toBe(2);
          expect(tool.programCity.value.revision).toBe(2);
        }
      }
      expect(writes).toEqual([writePath]);
      expect(hiddenError).toBe("");
    } finally {
      app.unmount();
      commandResponse.resolve({ ok: true });
      statusResponse.resolve({ cities: {} });
      await refreshing.catch(() => {});
      queryClient.clear();
      configureHttpWebClient(previousClient);
      endpointMocks.live = false;
    }
  });
});
