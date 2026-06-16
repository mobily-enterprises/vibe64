import { describe, expect, it } from "vitest";

import {
  vibe64CodexTerminalAttentionSignature,
  vibe64SessionNeedsCodexTerminalAttention
} from "../../src/lib/vibe64CodexTerminalAttention.js";

describe("vibe64CodexTerminalAttention", () => {
  it("requires terminal recovery for failed Codex app-server background tasks", () => {
    const session = {
      sessionId: "session-1",
      presentation: {
        backgroundTasks: [
          {
            error: "Codex app-server preparation failed.",
            id: "codex_app_server",
            message: "Codex app-server preparation failed.",
            status: "failed",
            updatedAt: "2026-06-10T01:00:00.000Z"
          }
        ]
      }
    };

    expect(vibe64SessionNeedsCodexTerminalAttention(session)).toBe(true);
    expect(vibe64CodexTerminalAttentionSignature(session)).toContain("background-task|codex_app_server|failed");
  });

  it("does not require terminal recovery while Codex app-server preparation is running", () => {
    expect(vibe64SessionNeedsCodexTerminalAttention({
      sessionId: "session-1",
      presentation: {
        backgroundTasks: [
          {
            id: "codex_app_server",
            message: "Preparing Codex app-server for this session.",
            status: "running"
          }
        ]
      }
    })).toBe(false);
  });

  it("does not require terminal recovery for blocked Codex app-server session handoff", () => {
    expect(vibe64SessionNeedsCodexTerminalAttention({
      sessionId: "session-1",
      presentation: {
        backgroundTasks: [
          {
            error: "Session worktree was removed. Recover this session before continuing with Codex.",
            id: "codex_app_server",
            message: "Recover this session worktree before continuing with Codex.",
            status: "ready"
          }
        ]
      }
    })).toBe(false);
  });

  it("ignores stale missing Codex terminal sessions", () => {
    expect(vibe64SessionNeedsCodexTerminalAttention({
      codexTerminal: {
        closeError: "Terminal session not found.",
        id: "codex-terminal-1",
        status: "exited"
      },
      sessionId: "session-1"
    })).toBe(false);
  });

  it("requires terminal recovery for a real errored Codex terminal", () => {
    expect(vibe64SessionNeedsCodexTerminalAttention({
      codexTerminal: {
        closeError: "Codex terminal exited with code 1.",
        id: "codex-terminal-1",
        status: "exited"
      },
      sessionId: "session-1"
    })).toBe(true);
  });

  it("does not require terminal recovery for a cleanly exited Codex terminal", () => {
    expect(vibe64SessionNeedsCodexTerminalAttention({
      codexTerminal: {
        id: "codex-terminal-1",
        status: "exited"
      },
      sessionId: "session-1"
    })).toBe(false);
  });

  it("requires terminal recovery for failed Codex app-server turns", () => {
    expect(vibe64SessionNeedsCodexTerminalAttention({
      codexAgentTurn: {
        active: false,
        error: "Codex app-server prompt delivery failed.",
        state: "idle",
        status: "failed",
        turnId: "turn-1"
      },
      codexAgentTurnActive: false,
      sessionId: "session-1"
    })).toBe(true);
  });

  it("does not require terminal recovery for user-interrupted Codex turns", () => {
    expect(vibe64SessionNeedsCodexTerminalAttention({
      codexAgentTurn: {
        active: false,
        error: "Stopped by user.",
        state: "interrupted",
        status: "interrupted",
        turnId: "turn-1"
      },
      codexAgentTurnActive: false,
      sessionId: "session-1"
    })).toBe(false);
  });
});
