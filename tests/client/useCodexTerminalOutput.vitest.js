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

  it("batches streamed display writes", () => {
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay
    });

    terminalOutput.appendTerminalOutput("first ");
    terminalOutput.appendTerminalOutput("second");

    expect(writeDisplay).not.toHaveBeenCalled();

    vi.advanceTimersByTime(79);
    expect(writeDisplay).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(writeDisplay).toHaveBeenCalledTimes(1);
    expect(writeDisplay).toHaveBeenLastCalledWith("first second");
  });

  it("writes snapshots immediately", () => {
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay
    });

    terminalOutput.writeTerminalOutput("snapshot");

    expect(writeDisplay).toHaveBeenCalledTimes(1);
    expect(writeDisplay).toHaveBeenLastCalledWith("snapshot");
  });
});
