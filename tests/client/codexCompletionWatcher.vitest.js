import { afterEach, describe, expect, it, vi } from "vitest";

import {
  codexOutputEndsWithConversationInterrupted,
  createCodexCompletionWatcher
} from "../../src/lib/codexCompletionWatcher.js";

describe("codex completion watcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks Codex finished after output is quiet for the idle window", () => {
    vi.useFakeTimers();
    const states = [];
    const watcher = createCodexCompletionWatcher({
      onChange: (state) => states.push(state.status)
    });

    watcher.start({
      output: "Prompt submitted.",
      watchKey: "session:step"
    });
    watcher.observeOutput("Working...\nDone.");

    vi.advanceTimersByTime(999);
    expect(watcher.snapshot().status).toBe("waiting");

    vi.advanceTimersByTime(1);
    expect(watcher.snapshot().status).toBe("finished");
    expect(states).toContain("finished");
  });

  it("marks Codex interrupted when the quiet output ends with Conversation interrupted", () => {
    vi.useFakeTimers();
    const watcher = createCodexCompletionWatcher();

    watcher.start({
      output: "",
      watchKey: "session:step"
    });
    watcher.observeOutput("Working...\nConversation interrupted");
    vi.advanceTimersByTime(1000);

    expect(watcher.snapshot().status).toBe("interrupted");
    expect(codexOutputEndsWithConversationInterrupted("x\nConversation interrupted")).toBe(true);
  });

  it("marks a quiet user turn as finished until Codex emits new output", () => {
    vi.useFakeTimers();
    const watcher = createCodexCompletionWatcher();

    watcher.start({
      output: "",
      watchKey: "session:step"
    });
    watcher.observeOutput("Conversation interrupted");
    vi.advanceTimersByTime(1000);
    expect(watcher.snapshot().status).toBe("interrupted");

    watcher.recordUserInput();
    vi.advanceTimersByTime(1000);
    expect(watcher.snapshot().status).toBe("finished");

    watcher.observeOutput("Conversation interrupted\nNew answer.");
    expect(watcher.snapshot().status).toBe("waiting");
    vi.advanceTimersByTime(1000);
    expect(watcher.snapshot().status).toBe("finished");
  });

  it("marks a prompt with no output as finished after the idle window", () => {
    vi.useFakeTimers();
    const watcher = createCodexCompletionWatcher();

    watcher.start({
      output: "Existing terminal output.",
      watchKey: "session:step"
    });

    vi.advanceTimersByTime(999);
    expect(watcher.snapshot().status).toBe("waiting");

    vi.advanceTimersByTime(1);
    expect(watcher.snapshot().status).toBe("finished");
  });

  it("returns to waiting when output arrives after a quiet prompt", () => {
    vi.useFakeTimers();
    const watcher = createCodexCompletionWatcher();

    watcher.start({
      output: "",
      watchKey: "session:step"
    });
    vi.advanceTimersByTime(1000);
    expect(watcher.snapshot().status).toBe("finished");

    watcher.observeOutput("Late answer.");
    expect(watcher.snapshot().status).toBe("waiting");
    vi.advanceTimersByTime(1000);
    expect(watcher.snapshot().status).toBe("finished");
  });
});
