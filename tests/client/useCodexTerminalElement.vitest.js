import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const useStudioTerminalMock = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useStudioTerminal.js", () => ({
  useStudioTerminal: useStudioTerminalMock
}));

import {
  normalizeTerminalSessionId,
  useCodexTerminalElement
} from "../../src/composables/useCodexTerminalElement.js";

describe("useCodexTerminalElement", () => {
  beforeEach(() => {
    useStudioTerminalMock.mockReset();
  });

  it("normalizes Codex terminal session ids from either supported field", () => {
    expect(normalizeTerminalSessionId({
      id: " terminal-1 "
    })).toBe("terminal-1");
    expect(normalizeTerminalSessionId({
      terminalSessionId: " terminal-2 "
    })).toBe("terminal-2");
    expect(normalizeTerminalSessionId({})).toBe("");
  });

  it("creates the shared terminal with the Codex debounced resize contract", () => {
    const fakeTerminal = createFakeStudioTerminal();
    const onOutput = vi.fn();
    const webSocketUrl = vi.fn();
    useStudioTerminalMock.mockReturnValue(fakeTerminal);

    const terminal = useCodexTerminalElement({
      onOutput,
      readOnly: true,
      webSocketUrl
    });

    expect(useStudioTerminalMock).toHaveBeenCalledWith(expect.objectContaining({
      fitOnResize: true,
      liveResize: true,
      onOutput,
      readOnly: true,
      resizeReportDelayMs: 120,
      webSocketUrl
    }));
    expect(terminal.terminalSessionId).toBe(fakeTerminal.terminalSessionId);
    expect(terminal.applyTerminalSession).toBeUndefined();
  });

  it("applies a new Codex session with one initial resize", () => {
    const fakeTerminal = createFakeStudioTerminal();
    useStudioTerminalMock.mockReturnValue(fakeTerminal);
    const terminal = useCodexTerminalElement();

    const result = terminal.applyCodexTerminalSession({
      id: "terminal-1",
      status: "running"
    });

    expect(result).toEqual({
      applied: true,
      sameTerminalSession: false,
      terminalSessionChanged: false,
      terminalSessionId: "terminal-1"
    });
    expect(fakeTerminal.applyTerminalSession).toHaveBeenCalledWith({
      id: "terminal-1",
      status: "running"
    }, {
      fallbackStatus: "running",
      preserveOutput: true,
      resize: true
    });
  });

  it("refreshes the same Codex session as metadata only", () => {
    const fakeTerminal = createFakeStudioTerminal("terminal-1");
    const onBeforeTerminalSessionChange = vi.fn();
    useStudioTerminalMock.mockReturnValue(fakeTerminal);
    const terminal = useCodexTerminalElement({
      onBeforeTerminalSessionChange
    });

    const result = terminal.applyCodexTerminalSession({
      commandPreview: "codex",
      id: "terminal-1"
    });

    expect(result.sameTerminalSession).toBe(true);
    expect(onBeforeTerminalSessionChange).not.toHaveBeenCalled();
    expect(fakeTerminal.applyTerminalSession).toHaveBeenCalledWith({
      commandPreview: "codex",
      id: "terminal-1"
    }, {
      fallbackStatus: "running",
      preserveOutput: true,
      resize: false
    });
  });

  it("notifies before switching Codex terminal sessions", () => {
    const fakeTerminal = createFakeStudioTerminal("terminal-1");
    const onBeforeTerminalSessionChange = vi.fn();
    useStudioTerminalMock.mockReturnValue(fakeTerminal);
    const terminal = useCodexTerminalElement({
      onBeforeTerminalSessionChange
    });

    const result = terminal.applyCodexTerminalSession({
      terminalSessionId: "terminal-2"
    }, {
      fallbackStatus: "pending",
      preserveOutput: false
    });

    expect(result).toEqual({
      applied: true,
      sameTerminalSession: false,
      terminalSessionChanged: true,
      terminalSessionId: "terminal-2"
    });
    expect(onBeforeTerminalSessionChange).toHaveBeenCalledWith({
      nextTerminalSessionId: "terminal-2",
      previousTerminalSessionId: "terminal-1"
    });
    expect(fakeTerminal.applyTerminalSession).toHaveBeenCalledWith({
      id: "terminal-2",
      terminalSessionId: "terminal-2"
    }, {
      fallbackStatus: "pending",
      preserveOutput: false,
      resize: true
    });
  });

  it("ignores missing Codex terminal sessions", () => {
    const fakeTerminal = createFakeStudioTerminal("terminal-1");
    useStudioTerminalMock.mockReturnValue(fakeTerminal);
    const terminal = useCodexTerminalElement();

    expect(terminal.applyCodexTerminalSession({})).toEqual({
      applied: false,
      hasTerminalSession: true
    });
    expect(fakeTerminal.applyTerminalSession).not.toHaveBeenCalled();
  });
});

function createFakeStudioTerminal(initialSessionId = "") {
  const terminalSessionId = ref(initialSessionId);

  return {
    applyTerminalSession: vi.fn((session = {}) => {
      terminalSessionId.value = String(session.id || "");
    }),
    terminalSessionId
  };
}
