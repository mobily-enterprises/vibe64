import { describe, expect, it, beforeEach, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  runError: null,
  useCommand: vi.fn()
}));

vi.mock("@jskit-ai/users-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@jskit-ai/users-web/client/composables/usePaths", () => ({
  usePaths: () => ({
    api: (suffix) => `/api${suffix}`
  })
}));

import {
  useVibe64TerminalCommands
} from "../../src/composables/useVibe64TerminalCommands.js";

describe("useVibe64TerminalCommands", () => {
  beforeEach(() => {
    commandMocks.runError = null;
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        if (options.placementSource === "vibe64.terminal.start" && commandMocks.runError) {
          await options.onRunError?.(commandMocks.runError, {
            context
          });
          throw commandMocks.runError;
        }
        return {
          ok: true
        };
      })
    }));
  });

  it("turns stale terminal starts into refreshable results instead of generic failures", async () => {
    commandMocks.runError = {
      code: "vibe64_action_disabled",
      details: {
        operationOutcome: "state_rejected",
        refreshRecommended: true
      },
      status: 409
    };
    const commands = useVibe64TerminalCommands({
      sessionsApiPath: "/api/app/example/vibe64/sessions"
    });

    await expect(commands.startCommandTerminal("session-1", {
      actionId: "create_worktree"
    })).rejects.toMatchObject({
      code: "vibe64_action_disabled",
      ok: false,
      operationOutcome: "state_rejected",
      refreshRecommended: true,
      stale: true,
      status: 409
    });
  });
});
