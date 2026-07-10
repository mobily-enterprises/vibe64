import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";

import {
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "../../src/lib/vibe64PresentationControls.js";
import {
  runVibe64ClientControl
} from "../../src/lib/vibe64ClientControlDispatcher.js";

describe("vibe64ClientControlDispatcher", () => {
  let ensureAgentSession;
  let reconnectAgentSessions;

  beforeEach(() => {
    ensureAgentSession = vi.fn();
    reconnectAgentSessions = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches the open diff control through the shared action contract", async () => {
    const openDialog = vi.fn();

    await expect(runVibe64ClientControl({
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF
      }
    }, {
      diff: {
        openDialog
      }
    })).resolves.toBe(true);

    expect(openDialog).toHaveBeenCalledTimes(1);
  });

  it("opens the right-pane diff surface when the caller provides one", async () => {
    const openDialog = vi.fn();
    const openDiffPane = vi.fn(() => true);

    await expect(runVibe64ClientControl({
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF
      }
    }, {
      diff: {
        openDialog
      },
      openDiffPane
    })).resolves.toBe(true);

    expect(openDiffPane).toHaveBeenCalledTimes(1);
    expect(openDialog).not.toHaveBeenCalled();
  });

  it("dispatches assistant retry controls through app-server thread preparation", async () => {
    const refreshSessionData = vi.fn();
    const openCodexTerminal = vi.fn();
    ensureAgentSession.mockResolvedValue({
      ok: true
    });

    await expect(runVibe64ClientControl({
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.START_AGENT_TERMINAL
      }
    }, {
      openCodexTerminal,
      ensureAgentSession,
      refreshSessionData,
      sessionId: "session_123"
    })).resolves.toBe(true);

    expect(ensureAgentSession).toHaveBeenCalledWith("session_123");
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
    expect(openCodexTerminal).not.toHaveBeenCalled();
  });

  it("opens the Codex terminal surface when app-server thread preparation fails", async () => {
    const openCodexTerminal = vi.fn(() => true);
    ensureAgentSession.mockResolvedValue({
      error: "Codex app-server preparation failed.",
      ok: false
    });

    await expect(runVibe64ClientControl({
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.START_AGENT_TERMINAL
      }
    }, {
      openCodexTerminal,
      ensureAgentSession,
      sessionId: "session_123"
    })).resolves.toEqual({
      error: "Codex app-server preparation failed.",
      ok: false
    });

    expect(openCodexTerminal).toHaveBeenCalledWith({
      result: {
        error: "Codex app-server preparation failed.",
        ok: false
      },
      source: "client_control"
    });
  });

  it("opens the assistant reconnect dialog from proven auth failures without refreshing status first", async () => {
    const dispatchedEvents = [];
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn((event) => {
        dispatchedEvents.push(event);
        return true;
      })
    });
    const openCodexTerminal = vi.fn(() => true);
    ensureAgentSession.mockResolvedValue({
      code: CODEX_RECONNECT_REQUIRED_CODE,
      error: CODEX_RECONNECT_REQUIRED_MESSAGE,
      ok: false
    });

    await expect(runVibe64ClientControl({
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.START_AGENT_TERMINAL
      }
    }, {
      openCodexTerminal,
      ensureAgentSession,
      sessionId: "session_123"
    })).resolves.toEqual({
      code: CODEX_RECONNECT_REQUIRED_CODE,
      error: CODEX_RECONNECT_REQUIRED_MESSAGE,
      ok: false
    });

    expect(openCodexTerminal).not.toHaveBeenCalled();
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchedEvents[0].detail).toEqual({
      codexReconnectRequired: true,
      providerId: "codex",
      refresh: false
    });
  });

  it("dispatches assistant reconnect controls through project-wide app-server reconciliation", async () => {
    const refreshSessionData = vi.fn();
    reconnectAgentSessions.mockResolvedValue({
      ok: true
    });

    await expect(runVibe64ClientControl({
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_AGENT_SESSIONS
      }
    }, {
      reconnectAgentSessions,
      refreshSessionData,
      sessionId: "session_123"
    })).resolves.toBe(true);

    expect(reconnectAgentSessions).toHaveBeenCalledTimes(1);
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
    expect(ensureAgentSession).not.toHaveBeenCalled();
  });

});
