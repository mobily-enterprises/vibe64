import { describe, expect, it } from "vitest";

import {
  codexTerminalSnapshot,
  codexTerminalUpdateNeedsSessionRefresh
} from "../../src/composables/useVibe64SessionWorkflow.js";

describe("useVibe64SessionWorkflow", () => {
  it("does not refresh session data when a terminal attach reports unchanged state", () => {
    const session = {
      codexTerminal: {
        id: "terminal-1",
        status: "running"
      },
      sessionId: "session-1"
    };

    expect(codexTerminalUpdateNeedsSessionRefresh({
      codexTerminalSessionId: "terminal-1",
      codexTerminalStatus: "running",
      sessionId: "session-1"
    }, session)).toBe(false);
  });

  it("does not refresh the selected session for terminal events from another session", () => {
    expect(codexTerminalUpdateNeedsSessionRefresh({
      codexTerminalSessionId: "terminal-2",
      codexTerminalStatus: "running",
      sessionId: "session-2"
    }, {
      codexTerminal: {
        id: "terminal-1",
        status: "running"
      },
      sessionId: "session-1"
    })).toBe(false);
  });

  it("does not refresh session data when local terminal start reports a new running terminal", () => {
    const session = {
      codexTerminal: {
        id: "terminal-1",
        status: "running"
      },
      sessionId: "session-1"
    };

    expect(codexTerminalUpdateNeedsSessionRefresh({
      codexTerminalSessionId: "terminal-2",
      codexTerminalStatus: "running",
      sessionId: "session-1"
    }, session)).toBe(false);
  });

  it("refreshes session data when terminal cleanup or terminal status changes need reconciliation", () => {
    const session = {
      codexTerminal: {
        id: "terminal-1",
        status: "running"
      },
      sessionId: "session-1"
    };

    expect(codexTerminalUpdateNeedsSessionRefresh({
      codexTerminalSessionId: "terminal-1",
      codexTerminalStatus: "exited",
      sessionId: "session-1"
    }, session)).toBe(true);
    expect(codexTerminalUpdateNeedsSessionRefresh({
      codexTerminalSessionId: "terminal-2",
      codexTerminalStatus: "stale",
      sessionId: "session-1"
    }, session)).toBe(true);
  });

  it("reads terminal state from presentation metadata when raw session state is empty", () => {
    const session = {
      codexTerminal: {},
      presentation: {
        terminal: {
          codex: {
            status: "running",
            terminalSessionId: "terminal-1"
          }
        }
      },
      sessionId: "session-1"
    };

    expect(codexTerminalSnapshot(session)).toEqual({
      status: "running",
      terminalSessionId: "terminal-1"
    });
    expect(codexTerminalUpdateNeedsSessionRefresh({
      codexTerminalSessionId: "terminal-1",
      codexTerminalStatus: "running",
      sessionId: "session-1"
    }, session)).toBe(false);
  });
});
