import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "../../src/lib/vibe64PresentationControls.js";
import {
  VIBE64_CODEX_APP_SERVER_TASK_ID
} from "../../src/lib/vibe64CodexTerminalAttention.js";
import {
  useVibe64BackgroundTasks,
  normalizeBackgroundTasks
} from "../../src/composables/useVibe64BackgroundTasks.js";

describe("useVibe64BackgroundTasks", () => {
  let ensureAgentSession;
  let reconnectAgentSessions;
  let runClientControl;

  beforeEach(() => {
    ensureAgentSession = vi.fn();
    reconnectAgentSessions = vi.fn();
    runClientControl = vi.fn(async (control, context = {}) => {
      const action = control?.control?.action;
      const result = action === VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_AGENT_SESSIONS
        ? await reconnectAgentSessions()
        : await ensureAgentSession(context.sessionId);
      if (result?.ok !== false) {
        await context.refreshSessionData?.();
      }
      return result;
    });
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
                action: VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_AGENT_SESSIONS
              },
              label: "Reconnect Codex"
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
              action: VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_AGENT_SESSIONS
            },
            label: "Reconnect Codex"
          },
        status: "failed",
        updatedAt: "2026-05-25T00:00:00.000Z"
      }
    ]);
  });

  it("hides the running Codex app-server preparation task from visible UI tasks", () => {
    const session = ref({
      presentation: {
        backgroundTasks: [
          {
            id: VIBE64_CODEX_APP_SERVER_TASK_ID,
            label: "Codex app-server",
            message: "Preparing Codex app-server for this session.",
            status: "running"
          },
          {
            id: VIBE64_CODEX_APP_SERVER_TASK_ID,
            label: "Codex app-server",
            message: "Codex app-server preparation failed.",
            status: "failed"
          },
          {
            id: "other_background_task",
            label: "Other task",
            message: "Running visible work.",
            status: "running"
          }
        ]
      }
    });
    const backgroundTasks = useVibe64BackgroundTasks({
      runClientControl,
      session
    });

    expect(backgroundTasks.backgroundTasks.value).toHaveLength(3);
    expect(backgroundTasks.visibleBackgroundTasks.value.map((task) => ({
      id: task.id,
      status: task.status
    }))).toEqual([
      {
        id: VIBE64_CODEX_APP_SERVER_TASK_ID,
        status: "failed"
      },
      {
        id: "other_background_task",
        status: "running"
      }
    ]);
  });

  it("retries background tasks through server-declared retry controls", async () => {
    const refreshSessionData = vi.fn();
    const openCodexTerminal = vi.fn();
    reconnectAgentSessions.mockResolvedValue({
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
                action: VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_AGENT_SESSIONS
              },
              label: "Reconnect Codex"
            },
            status: "failed"
          }
        ]
      }
    });
    const backgroundTasks = useVibe64BackgroundTasks({
      openCodexTerminal,
      refreshSessionData,
      runClientControl,
      session
    });

    await expect(backgroundTasks.retryBackgroundTask(backgroundTasks.backgroundTasks.value[0]))
      .resolves.toBe(true);

    expect(reconnectAgentSessions).toHaveBeenCalledTimes(1);
    expect(ensureAgentSession).not.toHaveBeenCalled();
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
    expect(openCodexTerminal).not.toHaveBeenCalled();
  });

  it("ignores background task retries without a control object", async () => {
    const refreshSessionData = vi.fn();
    const openCodexTerminal = vi.fn();
    const session = ref({
      sessionId: "session_123",
      presentation: {
        backgroundTasks: [
          {
            id: "codex_app_server",
            retry: null,
            status: "failed"
          }
        ]
      }
    });
    const backgroundTasks = useVibe64BackgroundTasks({
      openCodexTerminal,
      refreshSessionData,
      runClientControl,
      session
    });

    await expect(backgroundTasks.retryBackgroundTask(backgroundTasks.backgroundTasks.value[0]))
      .resolves.toBe(false);

    expect(runClientControl).not.toHaveBeenCalled();
    expect(refreshSessionData).not.toHaveBeenCalled();
    expect(openCodexTerminal).not.toHaveBeenCalled();
  });

  it("opens the Codex terminal when assistant retry controls fail", async () => {
    const refreshSessionData = vi.fn();
    const openCodexTerminal = vi.fn(() => true);
    reconnectAgentSessions.mockResolvedValue({
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
                action: VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_AGENT_SESSIONS
              },
              label: "Reconnect Codex"
            },
            status: "failed"
          }
        ]
      }
    });
    const backgroundTasks = useVibe64BackgroundTasks({
      openCodexTerminal,
      refreshSessionData,
      runClientControl,
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
