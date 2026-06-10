import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureVibe64CodexThread
} from "@/lib/vibe64SessionApi.js";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "../../src/lib/vibe64PresentationControls.js";
import {
  useVibe64BackgroundTasks,
  normalizeBackgroundTasks
} from "../../src/composables/useVibe64BackgroundTasks.js";

vi.mock("@/lib/vibe64SessionApi.js", () => ({
  ensureVibe64CodexThread: vi.fn()
}));

describe("useVibe64BackgroundTasks", () => {
  beforeEach(() => {
    vi.mocked(ensureVibe64CodexThread).mockReset();
  });

  it("normalizes presentation background tasks for the UI", () => {
    expect(normalizeBackgroundTasks({
      presentation: {
        backgroundTasks: [
          {
            error: "  no worktree  ",
            id: "codex_app_server",
            label: "Codex app-server",
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
        id: "codex_app_server",
        label: "Codex app-server",
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
    const openCodexTerminal = vi.fn();
    vi.mocked(ensureVibe64CodexThread).mockResolvedValue({
      ok: true
    });
    const session = ref({
      sessionId: "session_123",
      presentation: {
        backgroundTasks: [
          {
            id: "codex_app_server",
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
      openCodexTerminal,
      refreshSessionData,
      session
    });

    await expect(backgroundTasks.retryBackgroundTask(backgroundTasks.backgroundTasks.value[0]))
      .resolves.toBe(true);

    expect(ensureVibe64CodexThread).toHaveBeenCalledWith("session_123");
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
    expect(openCodexTerminal).not.toHaveBeenCalled();
  });

  it("opens the Codex terminal when Codex retry controls fail", async () => {
    const refreshSessionData = vi.fn();
    const openCodexTerminal = vi.fn(() => true);
    vi.mocked(ensureVibe64CodexThread).mockResolvedValue({
      error: "Codex app-server preparation failed.",
      ok: false
    });
    const session = ref({
      sessionId: "session_123",
      presentation: {
        backgroundTasks: [
          {
            id: "codex_app_server",
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
      openCodexTerminal,
      refreshSessionData,
      session
    });

    await expect(backgroundTasks.retryBackgroundTask(backgroundTasks.backgroundTasks.value[0]))
      .resolves.toBe(false);

    expect(openCodexTerminal).toHaveBeenCalledWith({
      source: "background_task",
      task: backgroundTasks.backgroundTasks.value[0]
    });
  });
});
