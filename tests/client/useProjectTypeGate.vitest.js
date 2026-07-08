import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

const commandMocks = vi.hoisted(() => ({
  run: vi.fn(),
  useCommand: vi.fn()
}));

const endpointMocks = vi.hoisted(() => ({
  calls: [],
  configData: null,
  configReload: vi.fn(),
  projectTypeData: null,
  projectTypeReload: vi.fn(),
  sessionsData: null,
  sessionsReload: vi.fn(),
  useEndpointResource: vi.fn()
}));

const projectScopeMocks = vi.hoisted(() => ({
  projectSlug: null
}));

const routeMocks = vi.hoisted(() => ({
  route: {
    query: {}
  }
}));

vi.mock("@jskit-ai/users-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@jskit-ai/users-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@jskit-ai/users-web/client/composables/usePaths", () => ({
  usePaths: () => ({
    api: (suffix = "") => `/api${suffix}`
  })
}));

vi.mock("../../src/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug: () => projectScopeMocks.projectSlug
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeMocks.route
}));

import {
  useProjectTypeGate
} from "../../src/composables/useProjectTypeGate.js";

describe("useProjectTypeGate", () => {
  let originalWindow;
  let storage;

  beforeEach(() => {
    originalWindow = globalThis.window;
    storage = new Map();
    globalThis.window = {
      sessionStorage: {
        getItem: vi.fn((key) => storage.get(key) || ""),
        removeItem: vi.fn((key) => storage.delete(key)),
        setItem: vi.fn((key, value) => storage.set(key, value))
      }
    };
    endpointMocks.calls.length = 0;
    endpointMocks.configReload.mockReset();
    endpointMocks.projectTypeReload.mockReset();
    endpointMocks.sessionsReload.mockReset();
    projectScopeMocks.projectSlug = ref("compas-next");
    routeMocks.route = {
      query: {}
    };
    endpointMocks.sessionsData = ref({
      sessions: [
        {
          sessionId: "2026-06-23_06-34-52",
          status: "active"
        },
        {
          sessionId: "2026-06-23_10-58-14",
          status: "active"
        }
      ]
    });
    endpointMocks.projectTypeData = ref({
      projectType: {
        adapter: {
          label: "JSKIT"
        },
        projectType: "jskit",
        ready: true
      }
    });
    endpointMocks.configData = ref({
      config: {
        ready: true,
        values: {}
      }
    });
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.calls.push(options);
      if (options.requestRecoveryLabel === "Vibe64 sessions") {
        return {
          data: endpointMocks.sessionsData,
          isInitialLoading: ref(false),
          isLoading: ref(false),
          loadError: ref(""),
          reload: endpointMocks.sessionsReload
        };
      }
      if (options.requestRecoveryLabel === "Project type") {
        return {
          data: endpointMocks.projectTypeData,
          isInitialLoading: ref(false),
          isLoading: ref(false),
          loadError: ref(""),
          reload: endpointMocks.projectTypeReload
        };
      }
      if (options.requestRecoveryLabel === "Project config") {
        return {
          data: endpointMocks.configData,
          isInitialLoading: ref(false),
          isLoading: ref(false),
          loadError: ref(""),
          reload: endpointMocks.configReload
        };
      }
      throw new Error(`Unexpected endpoint resource: ${options.requestRecoveryLabel}`);
    });
    commandMocks.run.mockReset();
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options) => ({
      get message() {
        return "";
      },
      get messageType() {
        return "";
      },
      run: commandMocks.run.mockImplementation(async (context) => {
        const payload = options.buildRawPayload({}, {
          context
        });
        await options.onRunSuccess?.();
        return {
          ok: true,
          payload
        };
      })
    }));
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    vi.restoreAllMocks();
  });

  it("scopes project setup reads and saves to the selected active session source", async () => {
    const emitted = [];
    const scope = effectScope();
    let gate;
    scope.run(() => {
      gate = useProjectTypeGate({
        emit: (event, payload) => emitted.push({
          event,
          payload
        })
      });
    });
    await nextTick();

    const projectTypeRequest = endpointMocks.calls.find((call) => call.requestRecoveryLabel === "Project type");
    const projectConfigRequest = endpointMocks.calls.find((call) => call.requestRecoveryLabel === "Project config");

    expect(projectTypeRequest.enabled.value).toBe(true);
    expect(projectTypeRequest.readQuery.value).toEqual({
      sessionId: "2026-06-23_10-58-14"
    });
    expect(projectTypeRequest.queryKey.value).toContain("2026-06-23_10-58-14");
    expect(projectConfigRequest.readQuery.value).toEqual({
      sessionId: "2026-06-23_10-58-14"
    });
    expect(projectConfigRequest.queryKey.value).toContain("2026-06-23_10-58-14");

    gate.selectDraftProjectType("jskit");
    await gate.saveProjectConfig({
      jskit_database_runtime: "postgres"
    });

    expect(commandMocks.run).toHaveBeenCalledWith({
      projectType: "jskit",
      sessionId: "2026-06-23_10-58-14",
      values: {
        jskit_database_runtime: "postgres"
      }
    });
    expect((await commandMocks.run.mock.results.at(-1).value).payload).toEqual({
      projectType: "jskit",
      sessionId: "2026-06-23_10-58-14",
      values: {
        jskit_database_runtime: "postgres"
      }
    });

    await gate.saveProjectConfig({
      jskit_database_runtime: "mariadb"
    }, {
      sessionId: "2026-06-23_06-34-52"
    });

    expect(commandMocks.run).toHaveBeenLastCalledWith({
      projectType: "",
      sessionId: "2026-06-23_06-34-52",
      values: {
        jskit_database_runtime: "mariadb"
      }
    });
    expect(emitted.some((entry) => entry.event === "ready")).toBe(true);

    scope.stop();
  });

  it("prefers the route session over stale stored session selection", async () => {
    storage.set("vibe64:selected-session-id:project:compas-next", "2026-06-23_06-34-52");
    routeMocks.route = {
      query: {
        session: "2026-06-23_10-58-14"
      }
    };

    const scope = effectScope();
    scope.run(() => {
      useProjectTypeGate({
        emit: () => null
      });
    });
    await nextTick();

    const projectTypeRequest = endpointMocks.calls.find((call) => call.requestRecoveryLabel === "Project type");
    const projectConfigRequest = endpointMocks.calls.find((call) => call.requestRecoveryLabel === "Project config");

    expect(projectTypeRequest.readQuery.value).toEqual({
      sessionId: "2026-06-23_10-58-14"
    });
    expect(projectConfigRequest.readQuery.value).toEqual({
      sessionId: "2026-06-23_10-58-14"
    });
    expect(globalThis.window.sessionStorage.setItem).toHaveBeenCalledWith(
      "vibe64:selected-session-id:project:compas-next",
      "2026-06-23_10-58-14"
    );

    scope.stop();
  });
});
