import { ref } from "vue";
import { describe, expect, it } from "vitest";

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
});
