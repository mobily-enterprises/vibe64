import { describe, expect, it } from "vitest";

import {
  normalizeVibe64ProjectToolFixInput
} from "../../src/lib/vibe64SessionRequestConfig.js";

describe("Vibe64 session request config payloads", () => {
  it("strips session-only terminal context from project tool fix payloads", () => {
    expect(normalizeVibe64ProjectToolFixInput({
      actionId: "sync_main_with_main",
      actionLabel: "Sync main with main",
      attemptedCommand: "bash -lc false",
      closeError: "exit 1",
      commandPreview: "false",
      exitCode: 1,
      launchTargetId: "dev",
      output: "failed",
      sessionId: "session-1",
      shellTarget: "main",
      terminalKind: "tool",
      terminalSessionId: "terminal-1",
      terminalStatus: "exited",
      toolId: "sync_main_with_main",
      toolLabel: "Sync main with main"
    })).toEqual({
      actionId: "sync_main_with_main",
      actionLabel: "Sync main with main",
      attemptedCommand: "bash -lc false",
      closeError: "exit 1",
      commandPreview: "false",
      exitCode: "1",
      output: "failed",
      terminalSessionId: "terminal-1",
      terminalStatus: "exited",
      toolId: "sync_main_with_main",
      toolLabel: "Sync main with main",
      userMessage: ""
    });
  });
});
