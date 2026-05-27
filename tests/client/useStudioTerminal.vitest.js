import { describe, expect, it } from "vitest";

import {
  INVALID_TERMINAL_SIZE_ERROR,
  reportableTerminalSize,
  terminalResizeErrorMessage
} from "../../src/lib/studioTerminalSize.js";

describe("useStudioTerminal", () => {
  it("does not report transient terminal sizes that the PTY server rejects", () => {
    expect(reportableTerminalSize({
      cols: 19,
      rows: 30
    })).toBeNull();
    expect(reportableTerminalSize({
      cols: 80,
      rows: 4
    })).toBeNull();
    expect(reportableTerminalSize({
      cols: Number.NaN,
      rows: 30
    })).toBeNull();
  });

  it("normalizes valid terminal sizes before sending resize messages", () => {
    expect(reportableTerminalSize({
      cols: 120.8,
      rows: 32.4
    })).toEqual({
      cols: 120,
      rows: 32
    });
  });

  it("recognizes resize failures as non-fatal terminal messages", () => {
    expect(terminalResizeErrorMessage(INVALID_TERMINAL_SIZE_ERROR)).toBe(true);
    expect(terminalResizeErrorMessage("Terminal stream failed.")).toBe(false);
  });
});
