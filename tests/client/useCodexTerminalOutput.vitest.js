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

  it("does not retain streamed output", () => {
    const terminalOutput = useCodexTerminalOutput();

    terminalOutput.appendTerminalOutput("first ");
    terminalOutput.writeTerminalOutput("snapshot");

    expect(terminalOutput).not.toHaveProperty("getTerminalOutput");
  });

  it("ignores empty chunks", () => {
    const terminalOutput = useCodexTerminalOutput();

    terminalOutput.appendTerminalOutput("");

    expect(terminalOutput.terminalStreaming.value).toBe(false);
  });

  it("resets activity state", () => {
    const terminalOutput = useCodexTerminalOutput();

    terminalOutput.markCodexBusy();
    terminalOutput.appendTerminalOutput("output");
    terminalOutput.resetTerminalOutput();

    expect(terminalOutput.codexBusy.value).toBe(false);
    expect(terminalOutput.terminalStreaming.value).toBe(false);
  });

  it("goes idle after a snapshot once output is quiet", () => {
    const terminalOutput = useCodexTerminalOutput();

    terminalOutput.markCodexBusy();
    terminalOutput.writeTerminalOutput("snapshot");

    expect(terminalOutput.codexBusy.value).toBe(true);
    expect(terminalOutput.terminalStreaming.value).toBe(false);

    vi.advanceTimersByTime(2200);

    expect(terminalOutput.codexBusy.value).toBe(false);
  });

  it("stays busy while no output has arrived since marking busy", () => {
    const terminalOutput = useCodexTerminalOutput();

    terminalOutput.appendTerminalOutput("before");
    terminalOutput.markCodexBusy();
    vi.advanceTimersByTime(5000);

    expect(terminalOutput.codexBusy.value).toBe(true);
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
