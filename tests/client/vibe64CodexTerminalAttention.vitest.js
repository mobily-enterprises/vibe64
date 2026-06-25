import { describe, expect, it } from "vitest";

import {
  codexReconnectRequiredResult,
  codexReconnectRequiredSignature,
  vibe64CodexTerminalAttentionSignature,
  vibe64SessionNeedsCodexReconnect,
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
            error: "Session clone was removed. Recover this session before continuing with Codex.",
            id: "codex_app_server",
            message: "Recover this session clone before continuing with Codex.",
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

  it("detects reconnect-required Codex app-server failures from persisted session state", () => {
    const session = {
      sessionId: "session-1",
      presentation: {
        backgroundTasks: [
          {
            error: "Codex authentication was rejected. Reconnect Codex to continue.",
            id: "codex_app_server",
            status: "failed",
            updatedAt: "2026-06-21T03:00:00.000Z"
          }
        ]
      }
    };

    expect(vibe64SessionNeedsCodexReconnect(session)).toBe(true);
    expect(codexReconnectRequiredSignature(session)).toContain("background-task|codex_app_server|failed");
  });

  it("does not treat non-auth Codex app-server failures as reconnect-required", () => {
    expect(vibe64SessionNeedsCodexReconnect({
      sessionId: "session-1",
      presentation: {
        backgroundTasks: [
          {
            error: "Codex app-server did not become ready.",
            id: "codex_app_server",
            status: "failed"
          }
        ]
      }
    })).toBe(false);
  });

  it("detects reconnect-required command results by code or shared message", () => {
    expect(codexReconnectRequiredResult({
      code: "vibe64_codex_reconnect_required",
      ok: false
    })).toBe(true);
    expect(codexReconnectRequiredResult({
      errors: [
        {
          message: "Codex authentication was rejected. Reconnect Codex to continue."
        }
      ],
      ok: false
    })).toBe(true);
    expect(codexReconnectRequiredResult({
      error: "Codex app-server preparation failed.",
      ok: false
    })).toBe(false);
  });
});
