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
  templatesData: null,
  templatesReload: vi.fn(),
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
    endpointMocks.templatesReload.mockReset();
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
    endpointMocks.templatesData = ref({
      eligibility: {
        eligible: false
      },
      templates: []
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
      if (options.requestRecoveryLabel === "Project templates") {
        return {
          data: endpointMocks.templatesData,
          isInitialLoading: ref(false),
          isLoading: ref(false),
          loadError: ref(""),
          reload: endpointMocks.templatesReload
        };
      }
      throw new Error(`Unexpected endpoint resource: ${options.requestRecoveryLabel}`);
    });
    commandMocks.run.mockReset();
    commandMocks.useCommand.mockReset();
    commandMocks.run.mockImplementation(async (options, context) => {
      const payload = options.buildRawPayload({}, {
        context
      });
      await options.onRunSuccess?.();
      return {
        ok: true,
        payload
      };
    });
    commandMocks.useCommand.mockImplementation((options) => ({
      get message() {
        return "";
      },
      get messageType() {
        return "";
      },
      run: (context) => commandMocks.run(options, context)
    }));
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    vi.restoreAllMocks();
  });

  it("reads project setup from the baseline and saves session drafts only when explicit", async () => {
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

    expect(endpointMocks.calls.some((call) => call.requestRecoveryLabel === "Vibe64 sessions")).toBe(false);
    expect(projectTypeRequest.readQuery).toBeNull();
    expect(projectTypeRequest.queryKey.value).toContain("project");
    expect(projectTypeRequest.queryKey.value).not.toContain("2026-06-23_10-58-14");
    expect(projectConfigRequest.readQuery.value).toBeNull();
    expect(projectConfigRequest.queryKey.value).toContain("project");
    expect(projectConfigRequest.queryKey.value).not.toContain("2026-06-23_10-58-14");

    gate.selectDraftProjectType("jskit");
    await nextTick();
    expect(projectConfigRequest.readQuery.value).toEqual({
      projectType: "jskit"
    });

    await gate.saveProjectConfig({
      jskit_database_runtime: "postgres"
    });

    expect(commandMocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        placementSource: "vibe64.project-config.save"
      }),
      {
        projectType: "jskit",
        sessionId: "",
        values: {
          jskit_database_runtime: "postgres"
        }
      }
    );
    expect((await commandMocks.run.mock.results.at(-1).value).payload).toEqual({
      projectType: "jskit",
      sessionId: "",
      values: {
        jskit_database_runtime: "postgres"
      }
    });

    await gate.saveProjectConfig({
      jskit_database_runtime: "mariadb"
    }, {
      sessionId: "2026-06-23_06-34-52"
    });

    expect(commandMocks.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        placementSource: "vibe64.project-config.save"
      }),
      {
        projectType: "",
        sessionId: "2026-06-23_06-34-52",
        values: {
          jskit_database_runtime: "mariadb"
        }
      }
    );
    expect(emitted.some((entry) => entry.event === "ready")).toBe(true);

    scope.stop();
  });

  it("ignores route and stored session selection for project setup reads", async () => {
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

    expect(endpointMocks.calls.some((call) => call.requestRecoveryLabel === "Vibe64 sessions")).toBe(false);
    expect(projectTypeRequest.readQuery).toBeNull();
    expect(projectTypeRequest.queryKey.value).not.toContain("2026-06-23_10-58-14");
    expect(projectConfigRequest.readQuery.value).toBeNull();
    expect(projectConfigRequest.queryKey.value).not.toContain("2026-06-23_10-58-14");
    expect(globalThis.window.sessionStorage.setItem).not.toHaveBeenCalled();

    scope.stop();
  });

  it("offers templates for an eligible empty project and preserves Advanced setup", async () => {
    endpointMocks.projectTypeData.value = {
      projectType: {
        availableApplicationTypes: [],
        availableProjectTypes: [],
        projectType: "",
        ready: false,
        status: "missing"
      }
    };
    endpointMocks.templatesData.value = {
      eligibility: {
        eligible: true
      },
      templates: [
        {
          id: "jskit-public",
          name: "Public"
        },
        {
          id: "jskit-database",
          name: "Database"
        }
      ]
    };

    const scope = effectScope();
    let gate;
    scope.run(() => {
      gate = useProjectTypeGate({
        emit: () => null
      });
    });
    await nextTick();

    expect(gate.projectTemplateChooserVisible.value).toBe(true);
    expect(gate.projectTemplates.value.map((template) => template.id)).toEqual([
      "jskit-public",
      "jskit-database"
    ]);
    expect(gate.canReturnToProjectTemplates.value).toBe(true);

    gate.showAdvancedProjectSetup();
    expect(gate.projectTemplateChooserVisible.value).toBe(false);
    gate.showProjectTemplates();
    expect(gate.projectTemplateChooserVisible.value).toBe(true);

    await gate.applyProjectTemplate("jskit-database");
    const templateCommandCall = commandMocks.run.mock.calls.find(([options]) => (
      options.placementSource === "vibe64.project-templates.apply"
    ));
    expect(templateCommandCall?.[1]).toEqual({
      templateId: "jskit-database"
    });
    expect(templateCommandCall?.[0].buildCommandOptions({}, {
      context: templateCommandCall[1]
    }).path).toMatch(/\/project-templates\/jskit-database\/apply$/u);
    expect(endpointMocks.projectTypeReload).toHaveBeenCalled();
    expect(gate.applyingTemplateId.value).toBe("");

    scope.stop();
  });

  it("goes straight to Advanced setup when an existing project is not eligible", async () => {
    endpointMocks.projectTypeData.value = {
      projectType: {
        projectType: "",
        ready: false,
        status: "missing"
      }
    };
    endpointMocks.templatesData.value = {
      eligibility: {
        code: "vibe64_project_template_destination_not_empty",
        eligible: false,
        message: "This project already contains source."
      },
      templates: []
    };

    const scope = effectScope();
    let gate;
    scope.run(() => {
      gate = useProjectTypeGate({
        emit: () => null
      });
    });
    await nextTick();

    expect(gate.needsProjectType.value).toBe(true);
    expect(gate.projectTemplateChooserVisible.value).toBe(false);
    expect(gate.canReturnToProjectTemplates.value).toBe(false);

    scope.stop();
  });

  it("shows repository and manifest failures instead of the app-type chooser", async () => {
    endpointMocks.projectTypeData.value = {
      projectType: {
        errorCode: "vibe64_committed_project_manifest_invalid",
        message: "Committed vibe64.project.json contains invalid JSON.",
        projectType: "",
        ready: false,
        status: "unavailable"
      }
    };

    const scope = effectScope();
    let gate;
    scope.run(() => {
      gate = useProjectTypeGate({
        emit: () => null
      });
    });
    await nextTick();

    expect(gate.needsProjectType.value).toBe(false);
    expect(gate.projectTemplateChooserVisible.value).toBe(false);
    expect(gate.errorMessage.value).toBe("Committed vibe64.project.json contains invalid JSON.");
    const templatesRequest = endpointMocks.calls.find((call) => call.requestRecoveryLabel === "Project templates");
    expect(templatesRequest.enabled.value).toBe(false);

    scope.stop();
  });
});
