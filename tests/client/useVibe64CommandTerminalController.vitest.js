import { describe, expect, it } from "vitest";

import {
  commandTerminalCanRequestAiFix
} from "../../src/composables/useVibe64CommandTerminalController.js";

describe("useVibe64CommandTerminalController", () => {
  it("does not offer AI fixes while a terminal is still running", () => {
    expect(commandTerminalCanRequestAiFix({
      aiFixAvailable: true,
      sessionId: "session-1",
      terminalCommandPreview: "npm run server",
      terminalError: "Terminal size must include valid cols and rows.",
      terminalRunning: true
    })).toBe(false);
  });

  it("offers AI fixes after a failed terminal exits", () => {
    expect(commandTerminalCanRequestAiFix({
      aiFixAvailable: true,
      sessionId: "session-1",
      terminalCommandPreview: "npm run server",
      terminalExited: true,
      terminalExitCode: 1
    })).toBe(true);
  });
});
