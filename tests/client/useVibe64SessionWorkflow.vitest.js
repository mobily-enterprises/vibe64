import { describe, expect, it } from "vitest";

import {
  agentTerminalSnapshot,
  agentTerminalUpdateNeedsSessionRefresh
} from "../../src/composables/useVibe64SessionWorkflow.js";

describe("useVibe64SessionWorkflow", () => {
  it("does not refresh session data when a terminal attach reports unchanged state", () => {
    const session = {
      agentSession: {
        terminal: {
          id: "terminal-1",
          status: "running"
        }
      },
      sessionId: "session-1"
    };

    expect(agentTerminalUpdateNeedsSessionRefresh({
      agentTerminalSessionId: "terminal-1",
      agentTerminalStatus: "running",
      sessionId: "session-1"
    }, session)).toBe(false);
  });

  it("does not refresh the selected session for terminal events from another session", () => {
    expect(agentTerminalUpdateNeedsSessionRefresh({
      agentTerminalSessionId: "terminal-2",
      agentTerminalStatus: "running",
      sessionId: "session-2"
    }, {
      agentSession: {
        terminal: {
          id: "terminal-1",
          status: "running"
        }
      },
      sessionId: "session-1"
    })).toBe(false);
  });

  it("does not refresh session data when local terminal start reports a new running terminal", () => {
    const session = {
      agentSession: {
        terminal: {
          id: "terminal-1",
          status: "running"
        }
      },
      sessionId: "session-1"
    };

    expect(agentTerminalUpdateNeedsSessionRefresh({
      agentTerminalSessionId: "terminal-2",
      agentTerminalStatus: "running",
      sessionId: "session-1"
    }, session)).toBe(false);
  });

  it("refreshes session data when terminal cleanup or terminal status changes need reconciliation", () => {
    const session = {
      agentSession: {
        terminal: {
          id: "terminal-1",
          status: "running"
        }
      },
      sessionId: "session-1"
    };

    expect(agentTerminalUpdateNeedsSessionRefresh({
      agentTerminalSessionId: "terminal-1",
      agentTerminalStatus: "exited",
      sessionId: "session-1"
    }, session)).toBe(true);
    expect(agentTerminalUpdateNeedsSessionRefresh({
      agentTerminalSessionId: "terminal-2",
      agentTerminalStatus: "stale",
      sessionId: "session-1"
    }, session)).toBe(true);
  });

  it("reads terminal state from presentation metadata when raw session state is empty", () => {
    const session = {
      agentSession: {
        terminal: {}
      },
      presentation: {
        terminal: {
          agent: {
            status: "running",
            terminalSessionId: "terminal-1"
          }
        }
      },
      sessionId: "session-1"
    };

    expect(agentTerminalSnapshot(session)).toEqual({
      status: "running",
      terminalSessionId: "terminal-1"
    });
    expect(agentTerminalUpdateNeedsSessionRefresh({
      agentTerminalSessionId: "terminal-1",
      agentTerminalStatus: "running",
      sessionId: "session-1"
    }, session)).toBe(false);
  });
});
