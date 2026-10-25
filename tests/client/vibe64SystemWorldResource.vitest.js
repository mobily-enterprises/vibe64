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

describe("Architecture client resources", () => {
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
      endpointResource({ architecture: { schema: "genesis.architecture.v1" } }),
      endpointResource(null),
      endpointResource(null),
      endpointResource(null)
    ];
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.calls.push(options);
      return endpointMocks.resources[endpointMocks.calls.length - 1];
    });
  });

  it("defers an Architecture reload until the retained view becomes active", async () => {
    const active = ref(false);
    const reloadVersion = ref(0);
    const scope = effectScope();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    scope.run(() => useVibe64SystemGraph({ active, reloadVersion, sessionId: "session-1" }));
    reloadVersion.value += 1;
    await nextTick();
    await settle();
    expect(endpointMocks.resources[1].reload).not.toHaveBeenCalled();
    active.value = true;
    await nextTick();
    await settle();
    expect(endpointMocks.resources[1].reload).toHaveBeenCalledOnce();
    active.value = false;
    await nextTick();
    active.value = true;
    await nextTick();
    await settle();
    expect(endpointMocks.resources[1].reload).toHaveBeenCalledOnce();
    scope.stop();
  });

  it.each([
    { component: "Vibe64DatabaseWorkspace", pane: "database", useTool: useVibe64DatabaseTools, resources: 1 },
    { component: "Vibe64ArchitectureView", pane: "system", useTool: useVibe64SystemGraph, resources: 5 }
  ])("pauses $component resource admission through the actual retained-session binding", async ({ component, pane, useTool, resources }) => {
    const autopilot = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue", import.meta.url
    ), "utf8");
    const tag = autopilot.match(new RegExp(`<${component}\\b[\\s\\S]*?>`, "u"))?.[0];
    const binding = tag?.match(/:active="([^"]+)"/u)?.[1];
    expect(binding).toBeDefined();
    const childActive = new Function("props", "rightPaneTab", `return (${binding});`);
    const props = reactive({ active: true, projectPane: "dashboard" });
    const rightPaneTab = ref(pane);
    const sessionId = ref("session/a");
    const scope = effectScope();
    try {
      scope.run(() => useTool({
        active: computed(() => childActive(props, rightPaneTab.value)),
        sessionId
      }));
      expect(endpointMocks.calls).toHaveLength(resources);
      expect(endpointMocks.calls[0].enabled.value).toBe(true);
      const paths = endpointMocks.calls.map((call) => call.path.value);
      const keys = endpointMocks.calls.map((call) => call.queryKey.value);
      expect(paths[0]).toContain("/sessions/session%2Fa");

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
    const refresh = endpointMocks.resources[2];
    const status = endpointMocks.calls[4];
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
    endpointMocks.resources[4].data.value = { refresh: { status: "running", startedAt: Date.now() - 12000, message: "Running UI inspector…", elapsedSeconds: 12 } };
    expect(graph.refreshProgress.value.message).toBe("Running UI inspector…");
    endpointMocks.resources[4].data.value = { refresh: { status: "failed", message: "UI inspector failed.", commandOutput: "Required file missing." } };
    pending.reject(Object.assign(new Error("UI inspector failed."), { details: { commandOutput: "Required file missing." } }));
    await expect(result).resolves.toBeNull();
    expect(graph.error.value).toBe("UI inspector failed.");
    expect(graph.refreshOutput.value).toBe("Required file missing.");
    expect(graph.refreshProgress.value).toBeNull();
    expect(unref(status.enabled)).toBe(true);
    expect(endpointMocks.resources[0].reload).toHaveBeenCalled();
    scope.stop();
  });

  it("reads status and Architecture, then refreshes synchronously", async () => {
    const scope = effectScope();
    let graph;
    scope.run(() => {
      graph = useVibe64SystemGraph({
        active: ref(true),
        sessionId: ref("session/a")
      });
    });

    expect(endpointMocks.calls.map((call) => call.path.value)).toEqual([
      "/api/vibe64/system-graph/sessions/session%2Fa/status",
      "/api/vibe64/system-graph/sessions/session%2Fa/architecture",
      "/api/vibe64/system-graph/sessions/session%2Fa/refresh",
      "/api/vibe64/system-graph/sessions/session%2Fa/refresh/cancel",
      "/api/vibe64/system-graph/sessions/session%2Fa/refresh/status"
    ]);
    expect(endpointMocks.calls[1].enabled.value).toBe(true);
    expect(endpointMocks.calls[2].enabled).toBe(false);
    expect(graph.architecture.value).toEqual({ schema: "genesis.architecture.v1" });
    for (const retired of ["machineCity", "programCity", "subsystemMap"]) expect(graph[retired]).toBeUndefined();

    await graph.refresh();

    expect(endpointMocks.resources[2].save).toHaveBeenCalledOnce();
    expect(endpointMocks.resources[2].save).toHaveBeenCalledWith({}, { method: "POST", options: { timeoutMs: 600_000 } });
    expect(endpointMocks.resources[0].reload).toHaveBeenCalledOnce();
    expect(endpointMocks.resources[1].reload).toHaveBeenCalledOnce();
    scope.stop();
  });

  it.each([
    { label: "Database schema", family: "database", useTool: useVibe64DatabaseTools },
    { label: "Architecture", family: "system-graph", useTool: useVibe64SystemGraph },
    { label: "Architecture status", family: "system-graph", useTool: useVibe64SystemGraph, holdStatus: true }
  ])("finishes a held $label refresh while hidden without a path error and reads fresh data on return", async ({ family, useTool, holdStatus = false }) => {
    endpointMocks.live = true;
    const database = family === "database";
    const sessionPath = `/api/vibe64/${family}/sessions/session%2Fa`;
    const readPaths = database
      ? [sessionPath]
      : ["/status", "/architecture"].map((suffix) => `${sessionPath}${suffix}`);
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
        return Promise.resolve({ architecture: { revision } });
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
        tool = useTool({ active, sessionId: ref("session/a") });
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
        expect(tool.architecture.value.revision).toBe(2);
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
