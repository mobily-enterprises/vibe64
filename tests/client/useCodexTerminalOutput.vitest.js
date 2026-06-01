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

  it("appends raw display chunks when no prompt filter is pending", () => {
    const appendDisplay = vi.fn();
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      appendDisplay,
      writeDisplay
    });

    terminalOutput.appendTerminalOutput("first ");
    terminalOutput.appendTerminalOutput("second");

    vi.advanceTimersByTime(80);

    expect(appendDisplay).toHaveBeenCalledTimes(1);
    expect(appendDisplay).toHaveBeenLastCalledWith("first second");
    expect(writeDisplay).not.toHaveBeenCalled();
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

  it("does not render display output while the terminal is headless", () => {
    const displayActive = ref(false);
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      displayActive,
      writeDisplay
    });

    terminalOutput.appendTerminalOutput("hidden output");
    vi.advanceTimersByTime(1000);

    expect(writeDisplay).not.toHaveBeenCalled();

    displayActive.value = true;
    terminalOutput.writeTerminalOutput(terminalOutput.getTerminalOutput());

    expect(writeDisplay).toHaveBeenCalledTimes(1);
    expect(writeDisplay).toHaveBeenLastCalledWith("hidden output");
  });

  it("batches output observers with streamed output", () => {
    const onOutputChanged = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      onOutputChanged,
      writeDisplay: vi.fn()
    });

    terminalOutput.appendTerminalOutput("first ");
    terminalOutput.appendTerminalOutput("second");

    expect(onOutputChanged).not.toHaveBeenCalled();

    vi.advanceTimersByTime(119);
    expect(onOutputChanged).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onOutputChanged).toHaveBeenCalledTimes(1);
    expect(onOutputChanged).toHaveBeenLastCalledWith("first second");
  });

  it("does not observe streamed output while the observer is disabled", () => {
    const onOutputChanged = vi.fn();
    const observerEnabled = ref(false);
    const terminalOutput = useCodexTerminalOutput({
      onOutputChanged,
      shouldNotifyOutputChanged: () => observerEnabled.value,
      writeDisplay: vi.fn()
    });

    terminalOutput.appendTerminalOutput("first ");
    terminalOutput.appendTerminalOutput("second");
    vi.advanceTimersByTime(120);

    expect(onOutputChanged).not.toHaveBeenCalled();

    observerEnabled.value = true;
    terminalOutput.appendTerminalOutput(" third");
    vi.advanceTimersByTime(120);

    expect(onOutputChanged).toHaveBeenCalledTimes(1);
    expect(onOutputChanged).toHaveBeenLastCalledWith("first second third");
  });

  it("keeps only a bounded diagnostic tail for streamed output", () => {
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay: vi.fn()
    });
    const longOutput = `${"a".repeat(300000)}final`;

    terminalOutput.appendTerminalOutput(longOutput);

    expect(terminalOutput.getTerminalOutput()).toHaveLength(256 * 1024);
    expect(terminalOutput.getTerminalOutput()).toMatch(/a+final$/u);
  });

  it("keeps plain streamed text without requiring terminal-control parsing", () => {
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay: vi.fn()
    });

    terminalOutput.appendTerminalOutput("plain user-facing text");

    expect(terminalOutput.getTerminalOutput()).toBe("plain user-facing text");
  });

  it("renders echoed prompts and context markers as raw terminal output", () => {
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay
    });
    const longPrompt = [
      "[[VIBE64_CONTEXT_START]]",
      "hidden prompt body",
      "[[VIBE64_CONTEXT_END]]"
    ].join("\n");

    terminalOutput.appendTerminalOutput(`${longPrompt}\nVisible output`);
    vi.advanceTimersByTime(80);

    const displayOutput = writeDisplay.mock.calls.at(-1)?.[0] || "";
    expect(displayOutput).toContain(longPrompt);
    expect(displayOutput).toContain("hidden prompt body");
    expect(displayOutput).toContain("[[VIBE64_CONTEXT_START]]");
    expect(displayOutput).toContain("[[VIBE64_CONTEXT_END]]");
    expect(displayOutput).toContain("Visible output");
  });

  it("reports Codex background work separately from explicit busy state", () => {
    const activityEvents = [];
    const terminalOutput = useCodexTerminalOutput({
      emitBusyChanged: (event) => activityEvents.push(event),
      writeDisplay: vi.fn()
    });

    terminalOutput.appendTerminalOutput("Waiting for background terminal (4s) - 1 background terminal running");

    expect(terminalOutput.codexBusy.value).toBe(false);
    expect(terminalOutput.codexWorking.value).toBe(true);
    expect(activityEvents.at(-1)).toMatchObject({
      busy: false,
      working: true
    });

    vi.advanceTimersByTime(2200);

    expect(terminalOutput.codexBusy.value).toBe(false);
    expect(terminalOutput.codexWorking.value).toBe(true);

    terminalOutput.writeTerminalOutput("tab to queue message");

    expect(terminalOutput.codexWorking.value).toBe(false);
    expect(activityEvents.at(-1)).toMatchObject({
      busy: false,
      working: false
    });
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

  it("does not mark passive terminal output busy", () => {
    const activityEvents = [];
    const appendDisplay = vi.fn();
    const onOutputChanged = vi.fn();
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      appendDisplay,
      emitBusyChanged: (event) => activityEvents.push(event),
      onOutputChanged,
      writeDisplay
    });

    terminalOutput.appendTerminalOutput("\u001b[?25h");

    expect(terminalOutput.codexBusy.value).toBe(false);
    expect(terminalOutput.terminalStreaming.value).toBe(true);
    expect(terminalOutput.getTerminalOutput()).toBe("\u001b[?25h");
    expect(activityEvents.at(-1)).toMatchObject({
      busy: false,
      streaming: true,
      working: false
    });

    vi.advanceTimersByTime(649);
    expect(terminalOutput.terminalStreaming.value).toBe(true);

    vi.advanceTimersByTime(1);

    expect(appendDisplay).toHaveBeenCalledWith("\u001b[?25h");
    vi.advanceTimersByTime(40);
    expect(onOutputChanged).toHaveBeenCalledWith("\u001b[?25h");
    expect(writeDisplay).not.toHaveBeenCalled();

    expect(terminalOutput.codexBusy.value).toBe(false);
    expect(terminalOutput.terminalStreaming.value).toBe(false);
    expect(activityEvents.at(-1)).toMatchObject({
      busy: false,
      streaming: false,
      working: false
    });
  });

  it("preserves pure terminal-control snapshots for raw xterm replay", () => {
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay
    });

    terminalOutput.writeTerminalOutput("\u001b[22;2H\u001b[0m\u001b[49m\u001b[K\u001b[?25h");

    expect(terminalOutput.getTerminalOutput()).toBe("\u001b[22;2H\u001b[0m\u001b[49m\u001b[K\u001b[?25h");
    expect(writeDisplay).toHaveBeenCalledWith("\u001b[22;2H\u001b[0m\u001b[49m\u001b[K\u001b[?25h");
  });

  it("replays terminal-control snapshots through xterm instead of flattening repaint frames", () => {
    const writeDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      writeDisplay
    });
    const snapshot = [
      "\u001b[2J\u001b[H",
      "OpenAI Codex\r\n",
      "\u001b[3;1H",
      "directory: /workspace/app\r",
      "\u001b[K",
      "\u001b[5;1H",
      "gpt-5.5 xhigh"
    ].join("");

    terminalOutput.writeTerminalOutput(snapshot);

    expect(terminalOutput.getTerminalOutput()).toBe(snapshot);
    expect(writeDisplay).toHaveBeenCalledWith(snapshot);
  });

  it("stores tiny cursor-repaint fragments exactly as received", () => {
    const appendDisplay = vi.fn();
    const terminalOutput = useCodexTerminalOutput({
      appendDisplay,
      writeDisplay: vi.fn()
    });
    const repaint = "\u001b[?2026h\u001b[22;2H\u001b[0m\u001b[49m\u001b[K\u001b[23;1HWo\u001b[39m\u001b[49m\u001b[0m\u001b[?25h\u001b[26;3H\u001b[?2026l";

    terminalOutput.appendTerminalOutput(repaint);

    expect(terminalOutput.codexBusy.value).toBe(false);
    expect(terminalOutput.terminalStreaming.value).toBe(true);
    expect(terminalOutput.getTerminalOutput()).toBe(repaint);

    vi.advanceTimersByTime(80);

    expect(appendDisplay).toHaveBeenCalledTimes(1);
    expect(appendDisplay).toHaveBeenCalledWith(repaint);

    vi.advanceTimersByTime(570);

    expect(terminalOutput.terminalStreaming.value).toBe(false);
  });
});
