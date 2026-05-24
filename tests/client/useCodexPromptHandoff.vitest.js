import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import {
  useCodexPromptHandoff
} from "../../src/composables/useCodexPromptHandoff.js";

const THREAD_CAPTURE_WAITING_ERROR = "Waiting for Codex thread id before injecting prompt.";
const THREAD_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("useCodexPromptHandoff", () => {
  it("clears the stale thread-capture warning when the session snapshot has a thread id", () => {
    const terminalError = ref(THREAD_CAPTURE_WAITING_ERROR);
    const handoff = useCodexPromptHandoff({
      terminalError
    });

    handoff.applyCodexThreadState({
      codexThreadId: THREAD_ID
    });

    expect(terminalError.value).toBe("");
  });

  it("does not clear unrelated terminal errors when the thread id arrives", () => {
    const terminalError = ref("Terminal stream failed.");
    const handoff = useCodexPromptHandoff({
      terminalError
    });

    handoff.applyCodexThreadState({
      codexThreadId: THREAD_ID
    });

    expect(terminalError.value).toBe("Terminal stream failed.");
  });

  it("clears the stale thread-capture warning when capture succeeds from terminal output", async () => {
    const terminalError = ref(THREAD_CAPTURE_WAITING_ERROR);
    const sessionId = ref("session-1");
    let savedThreadId = "";
    const handoff = useCodexPromptHandoff({
      saveThread: async (_sessionId, threadId) => {
        savedThreadId = threadId;
        return {
          codexThreadId: threadId,
          ok: true
        };
      },
      sessionId,
      terminalError
    });

    handoff.applyCodexThreadState({
      needsThreadCapture: true
    });
    const captured = await handoff.captureCodexThreadFromOutput(`CODEX_THREAD_ID\n${THREAD_ID}\n`);

    expect(captured).toBe(true);
    expect(savedThreadId).toBe(THREAD_ID);
    expect(terminalError.value).toBe("");
  });

  it("does not probe when the session already has a Codex thread id", async () => {
    const sentInputs = [];
    const handoff = useCodexPromptHandoff({
      sendTerminalData: async (input) => {
        sentInputs.push(input);
        return true;
      }
    });

    handoff.applyCodexThreadState({
      codexThreadId: THREAD_ID,
      needsThreadCapture: false
    });

    expect(await handoff.ensureCodexThreadReady()).toBe(true);
    expect(sentInputs).toEqual([]);
  });

  it("does not send a second thread probe while capture is already waiting", async () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
      clearInterval: (...args) => globalThis.clearInterval(...args),
      clearTimeout: (...args) => globalThis.clearTimeout(...args),
      setInterval: (...args) => globalThis.setInterval(...args),
      setTimeout: (...args) => globalThis.setTimeout(...args)
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T00:00:10.000Z"));

    try {
      const sentInputs = [];
      const sessionId = ref("session-1");
      const terminalSessionId = ref("terminal-1");
      const terminalStatus = ref("running");
      const handoff = useCodexPromptHandoff({
        hasTerminalOutput: () => true,
        lastTerminalOutputAt: () => Date.parse("2026-05-23T00:00:10.000Z"),
        saveThread: async (_sessionId, threadId) => ({
          codexThreadId: threadId,
          ok: true
        }),
        sendTerminalData: async (input) => {
          sentInputs.push(input);
          return true;
        },
        sessionId,
        terminalSessionId,
        terminalStatus
      });

      handoff.applyCodexThreadState({
        needsThreadCapture: true
      });
      handoff.noteTerminalStarted();

      const firstCapture = handoff.ensureCodexThreadReady();
      await vi.advanceTimersByTimeAsync(3500);
      const secondCapture = handoff.ensureCodexThreadReady();
      await vi.advanceTimersByTimeAsync(500);

      expect(sentInputs.filter((input) => input === "echo $CODEX_THREAD_ID")).toHaveLength(1);

      await handoff.captureCodexThreadFromOutput(`CODEX_THREAD_ID\n${THREAD_ID}\n`);
      await vi.advanceTimersByTimeAsync(250);

      await expect(firstCapture).resolves.toBe(true);
      await expect(secondCapture).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
      globalThis.window = previousWindow;
    }
  });
});
