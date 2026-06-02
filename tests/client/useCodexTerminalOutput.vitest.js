import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCodexTerminalOutput
} from "../../src/composables/useCodexTerminalOutput.js";

describe("useCodexTerminalOutput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores streamed chunks without owning xterm writes", () => {
    const terminalOutput = useCodexTerminalOutput();

    terminalOutput.appendTerminalOutput("first ");
    terminalOutput.appendTerminalOutput("second");

    expect(terminalOutput.getTerminalOutput()).toBe("first second");
  });

  it("stores snapshots without replaying them", () => {
    const terminalOutput = useCodexTerminalOutput();

    terminalOutput.writeTerminalOutput("snapshot");

    expect(terminalOutput.getTerminalOutput()).toBe("snapshot");
  });

  it("resets stored output and activity state", () => {
    const terminalOutput = useCodexTerminalOutput();

    terminalOutput.markCodexBusy();
    terminalOutput.appendTerminalOutput("output");
    terminalOutput.resetTerminalOutput();

    expect(terminalOutput.getTerminalOutput()).toBe("");
    expect(terminalOutput.codexBusy.value).toBe(false);
    expect(terminalOutput.terminalStreaming.value).toBe(false);
  });

  it("keeps terminal-control bytes exactly as received", () => {
    const terminalOutput = useCodexTerminalOutput();
    const repaint = "\u001b[?2026h\u001b[22;2H\u001b[0m\u001b[49m\u001b[K\u001b[23;1HWo\u001b[39m\u001b[49m\u001b[0m\u001b[?25h\u001b[26;3H\u001b[?2026l";

    terminalOutput.appendTerminalOutput(repaint);

    expect(terminalOutput.getTerminalOutput()).toBe(repaint);
  });

  it("keeps explicit busy state until output goes quiet", () => {
    const terminalOutput = useCodexTerminalOutput();

    terminalOutput.markCodexBusy();
    terminalOutput.appendTerminalOutput("Codex response");

    expect(terminalOutput.codexBusy.value).toBe(true);

    vi.advanceTimersByTime(2200);

    expect(terminalOutput.codexBusy.value).toBe(false);
  });

  it("tracks terminal streaming only while bytes are arriving", () => {
    const activityEvents = [];
    const terminalOutput = useCodexTerminalOutput({
      emitBusyChanged: (event) => activityEvents.push(event)
    });

    terminalOutput.appendTerminalOutput("\u001b[?25h");

    expect(terminalOutput.terminalStreaming.value).toBe(true);
    expect(activityEvents.at(-1)).toMatchObject({
      streaming: true
    });

    vi.advanceTimersByTime(2500);

    expect(terminalOutput.terminalStreaming.value).toBe(false);
    expect(activityEvents.at(-1)).toMatchObject({
      streaming: false
    });
  });
});
