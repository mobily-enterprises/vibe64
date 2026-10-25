import { describe, expect, it, beforeEach, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  runs: [],
  runError: null,
  useCommand: vi.fn()
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({
    api: (suffix) => `/api${suffix}`
  })
}));

import {
  useVibe64TerminalCommands
} from "../../src/composables/useVibe64TerminalCommands.js";

describe("useVibe64TerminalCommands", () => {
  beforeEach(() => {
    commandMocks.runs = [];
    commandMocks.runError = null;
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        commandMocks.runs.push({ context, options });
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

  it("sends terminal attachment paths and ids through the atomic control-text route", async () => {
    const commands = useVibe64TerminalCommands();

    await expect(commands.sendAgentTerminalText(
      "session-1",
      "terminal-1",
      "[/tmp/example.png] ",
      { attachmentIds: ["attachment-1"] }
    )).resolves.toEqual({ ok: true });

    const run = commandMocks.runs.find(({ options }) => (
      options.placementSource === "vibe64.terminal.write"
    ));
    expect(run.context).toEqual({
      attachmentIds: ["attachment-1"],
      path: "/api/vibe64/sessions/session-1/agent-terminal/terminal-1/control/text",
      text: "[/tmp/example.png] "
    });
    expect(run.options.buildRawPayload(null, { context: run.context })).toEqual({
      attachmentIds: ["attachment-1"],
      text: "[/tmp/example.png] "
    });
  });

  it("turns stale AI terminal starts into refreshable results instead of generic failures", async () => {
    commandMocks.runError = {
      code: "vibe64_stale_command_start",
      details: {
        operationOutcome: "state_rejected",
        refreshRecommended: true
      },
      status: 409
    };
    const commands = useVibe64TerminalCommands();

    await expect(commands.startAgentTerminal("session-1")).rejects.toMatchObject({
      code: "vibe64_stale_command_start",
      ok: false,
      operationOutcome: "state_rejected",
      refreshRecommended: true,
      stale: true,
      status: 409
    });
  });
});
