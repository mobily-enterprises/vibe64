import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  startVibe64CodexTerminal
} from "@/lib/vibe64SessionApi.js";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "../../src/lib/vibe64PresentationControls.js";
import {
  useVibe64BackgroundTasks,
  normalizeBackgroundTasks
} from "../../src/composables/useVibe64BackgroundTasks.js";

vi.mock("@/lib/vibe64SessionApi.js", () => ({
  startVibe64CodexTerminal: vi.fn()
}));

describe("useVibe64BackgroundTasks", () => {
  beforeEach(() => {
    vi.mocked(startVibe64CodexTerminal).mockReset();
  });

  it("normalizes presentation background tasks for the UI", () => {
    expect(normalizeBackgroundTasks({
      presentation: {
        backgroundTasks: [
          {
            error: "  no worktree  ",
            id: "codex_bootstrap",
            label: "Codex bootstrap",
            message: "failed",
            retry: {
              control: {
                action: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
              },
              label: "Retry Codex"
            },
            status: "failed",
            updatedAt: "2026-05-25T00:00:00.000Z"
          },
          {
            id: "",
            status: "running"
          }
        ]
      }
    })).toEqual([
      {
        error: "no worktree",
        id: "codex_bootstrap",
        label: "Codex bootstrap",
        message: "failed",
        retry: {
          control: {
            action: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
          },
          label: "Retry Codex"
        },
        status: "failed",
        updatedAt: "2026-05-25T00:00:00.000Z"
      }
    ]);
  });

  it("retries background tasks through server-declared retry controls", async () => {
    const refreshSessionData = vi.fn();
    vi.mocked(startVibe64CodexTerminal).mockResolvedValue({
      ok: true
    });
    const session = ref({
      sessionId: "session_123",
      presentation: {
        backgroundTasks: [
          {
            id: "codex_bootstrap",
            retry: {
              control: {
                action: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
              },
              label: "Retry Codex"
            },
            status: "failed"
          }
        ]
      }
    });
    const backgroundTasks = useVibe64BackgroundTasks({
      refreshSessionData,
      session
    });

    await expect(backgroundTasks.retryBackgroundTask(backgroundTasks.backgroundTasks.value[0]))
      .resolves.toBe(true);

    expect(startVibe64CodexTerminal).toHaveBeenCalledWith("session_123");
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
  });
});
