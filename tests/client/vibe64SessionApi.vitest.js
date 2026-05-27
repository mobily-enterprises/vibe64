import { describe, expect, it } from "vitest";

import {
  normalizeVibe64ProjectToolFixInput
} from "../../src/lib/vibe64SessionApi.js";

describe("vibe64SessionApi", () => {
  it("strips session-only terminal context from project tool fix payloads", () => {
    expect(normalizeVibe64ProjectToolFixInput({
      actionId: "push_to_production",
      actionLabel: "Push to production",
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
      toolId: "push_to_production",
      toolLabel: "Push to production"
    })).toEqual({
      actionId: "push_to_production",
      actionLabel: "Push to production",
      attemptedCommand: "bash -lc false",
      closeError: "exit 1",
      commandPreview: "false",
      exitCode: "1",
      output: "failed",
      terminalSessionId: "terminal-1",
      terminalStatus: "exited",
      toolId: "push_to_production",
      toolLabel: "Push to production",
      userMessage: ""
    });
  });
});
