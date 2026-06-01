import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
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

  it("passes streamed chunks directly to xterm display", () => {
    const appendDisplay = vi.fn();
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      appendDisplay,
      writeDisplay
    });

    terminalOutput.appendTerminalOutput("first ");
    terminalOutput.appendTerminalOutput("second");

    expect(appendDisplay).toHaveBeenCalledTimes(2);
    expect(appendDisplay).toHaveBeenNthCalledWith(1, "first ");
    expect(appendDisplay).toHaveBeenNthCalledWith(2, "second");
    expect(writeDisplay).not.toHaveBeenCalled();
    expect(terminalOutput.getTerminalOutput()).toBe("first second");
  });

  it("falls back to direct chunk writes when append display is unavailable", () => {
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay
    });

    terminalOutput.appendTerminalOutput("first ");
    terminalOutput.appendTerminalOutput("second");

    expect(writeDisplay).toHaveBeenCalledTimes(2);
    expect(writeDisplay).toHaveBeenNthCalledWith(1, "first ");
    expect(writeDisplay).toHaveBeenNthCalledWith(2, "second");
  });

  it("stores snapshots without replaying them into xterm", () => {
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay
    });

    terminalOutput.writeTerminalOutput("snapshot");

    expect(writeDisplay).not.toHaveBeenCalled();
    expect(terminalOutput.getTerminalOutput()).toBe("snapshot");
  });

  it("stores output while display is inactive without replaying it when asked", () => {
    const displayActive = ref(false);
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      displayActive,
      writeDisplay
    });

    terminalOutput.appendTerminalOutput("hidden output");

    expect(writeDisplay).not.toHaveBeenCalled();

    displayActive.value = true;
    terminalOutput.writeTerminalOutput(terminalOutput.getTerminalOutput());

    expect(writeDisplay).not.toHaveBeenCalled();
    expect(terminalOutput.getTerminalOutput()).toBe("hidden output");
  });

  it("keeps terminal-control bytes exactly as received", () => {
    const appendDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      appendDisplay,
      writeDisplay: vi.fn()
    });
    const repaint = "\u001b[?2026h\u001b[22;2H\u001b[0m\u001b[49m\u001b[K\u001b[23;1HWo\u001b[39m\u001b[49m\u001b[0m\u001b[?25h\u001b[26;3H\u001b[?2026l";

    terminalOutput.appendTerminalOutput(repaint);

    expect(terminalOutput.getTerminalOutput()).toBe(repaint);
    expect(appendDisplay).toHaveBeenCalledWith(repaint);
  });

  it("keeps explicit busy state until output goes quiet", () => {
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay: vi.fn()
    });

    terminalOutput.markCodexBusy();
    terminalOutput.appendTerminalOutput("Codex response");

    expect(terminalOutput.codexBusy.value).toBe(true);

    vi.advanceTimersByTime(2200);

    expect(terminalOutput.codexBusy.value).toBe(false);
  });

  it("tracks terminal streaming only while bytes are arriving", () => {
    const activityEvents = [];
    const terminalOutput = useCodexTerminalOutput({
      emitBusyChanged: (event) => activityEvents.push(event),
      writeDisplay: vi.fn()
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
