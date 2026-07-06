import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

const commandMocks = vi.hoisted(() => ({
  calls: [],
  useCommand: vi.fn()
}));

const endpointMocks = vi.hoisted(() => ({
  calls: [],
  toolsData: null,
  toolsReload: vi.fn(),
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

vi.mock("../../src/composables/useVibe64FixCodexDialog.js", () => ({
  useVibe64FixCodexDialog: () => ({
    fixDialogOpen: {
      value: false
    },
    fixJob: {
      value: null
    },
    fixTerminal: {
      value: null
    },
    openFixCodexDialog: vi.fn()
  })
}));

vi.mock("../../src/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug: () => projectScopeMocks.projectSlug
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeMocks.route
}));

import {
  sourceSelectionInputFromContext,
  useVibe64ProjectTools
} from "../../src/composables/useVibe64ProjectTools.js";

describe("useVibe64ProjectTools", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = globalThis.window;
    globalThis.window = {
      sessionStorage: {
        getItem: vi.fn(() => "source-session"),
        removeItem: vi.fn(),
        setItem: vi.fn()
      }
    };
    routeMocks.route = {
      query: {}
    };
    commandMocks.calls.length = 0;
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options) => ({
      run: vi.fn(async (context = {}) => {
        commandMocks.calls.push({
          context,
          payload: options.buildRawPayload({}, {
            context
          })
        });
        return {
          ok: true
        };
      })
    }));
    endpointMocks.calls.length = 0;
    endpointMocks.toolsData = ref({
      tools: []
    });
    endpointMocks.toolsReload.mockReset();
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.calls.push(options);
      return {
        data: endpointMocks.toolsData,
        isFetching: ref(false),
        reload: endpointMocks.toolsReload
      };
    });
    projectScopeMocks.projectSlug = ref("compas-next");
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("loads and runs project tools with the stored selected session", async () => {
    const emitted = [];
    const scope = effectScope();
    let tools;
    scope.run(() => {
      tools = useVibe64ProjectTools({}, (event, payload) => {
        emitted.push({
          event,
          payload
        });
      });
    });

    expect(endpointMocks.calls[0].readQuery.value).toEqual({
      sessionId: "source-session"
    });
    expect(endpointMocks.calls[0].queryKey.value).toEqual([
      "vibe64",
      "project",
      "compas-next",
      "project-tools",
      "source-session"
    ]);

    tools.selectTool({
      enabled: true,
      id: "prompt-tool",
      label: "Prompt tool",
      type: "prompt"
    });
    await nextTick();
    await Promise.resolve();

    expect(commandMocks.calls[0].payload).toEqual({
      parameters: {},
      sessionId: "source-session"
    });
    expect(emitted.map((entry) => entry.event)).toEqual([
      "global-codex-update",
      "global-codex-open"
    ]);

    tools.selectTool({
      enabled: true,
      id: "command-tool",
      label: "Command tool",
      type: "command"
    });

    expect(tools.runActionInput.value).toEqual({
      parameters: {},
      sessionId: "source-session"
    });
    expect(tools.terminalDialogOpen.value).toBe(true);
    scope.stop();
  });

  it("loads project tools with the route selected session before stored selection", () => {
    routeMocks.route = {
      query: {
        session: "route-session"
      }
    };

    const scope = effectScope();
    scope.run(() => {
      useVibe64ProjectTools({}, () => null);
    });

    expect(endpointMocks.calls[0].readQuery.value).toEqual({
      sessionId: "route-session"
    });
    expect(endpointMocks.calls[0].queryKey.value).toEqual([
      "vibe64",
      "project",
      "compas-next",
      "project-tools",
      "route-session"
    ]);

    scope.stop();
  });

  it("normalizes source selection input without leaking empty fields", () => {
    expect(sourceSelectionInputFromContext({
      sessionId: "  source-session  ",
      sourcePath: ""
    })).toEqual({
      sessionId: "source-session"
    });
  });
});
