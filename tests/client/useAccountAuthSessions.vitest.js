import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  realtimeOptions: []
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    mocks.realtimeOptions.push(options);
    return {
      active: {
        value: true
      }
    };
  }
}));

import {
  codexAuthSessionNeedsTerminalAttention,
  pollFailureBackoffMs,
  useAccountAuthSessions
} from "../../packages/vibe64-accounts/src/client/composables/useAccountAuthSessions.js";

describe("useAccountAuthSessions", () => {
  beforeEach(() => {
    mocks.realtimeOptions.length = 0;
  });

  it("does not throw raw property errors for null auth-session reads", async () => {
    const accounts = {
      loadError: "",
      readAuthSession: vi.fn().mockResolvedValue(null),
      refresh: vi.fn(),
      startAuth: vi.fn().mockResolvedValue({
        account: {
          id: "codex"
        },
        id: "auth-session-1",
        mode: "device",
        status: "authenticating"
      }),
      startAuthCommand: {}
    };
    const scheduler = {
      clearInterval: vi.fn(),
      setInterval: vi.fn(() => 1)
    };
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: [
        {
          id: "codex"
        }
      ],
      browserWindow: null,
      clearIntervalFn: scheduler.clearInterval,
      setIntervalFn: scheduler.setInterval
    });

    await authSessions.startDeviceAuth("codex");
    await expect(authSessions.pollAuthSessions()).rejects.toThrow("Account login session did not return status.");

    expect(authSessions.localError).toBe("Account login session did not return status.");
    expect(accounts.readAuthSession).toHaveBeenCalledWith("auth-session-1");
  });

  it("does not overlap auth-session polls when a read is still in flight", async () => {
    const firstRead = deferred();
    const accounts = {
      loadError: "",
      readAuthSession: vi.fn()
        .mockReturnValueOnce(firstRead.promise)
        .mockResolvedValue({
          account: {
            id: "codex"
          },
          id: "auth-session-1",
          mode: "device",
          status: "authenticating"
        }),
      refresh: vi.fn(),
      startAuth: vi.fn().mockResolvedValue({
        account: {
          id: "codex"
        },
        id: "auth-session-1",
        mode: "device",
        status: "authenticating"
      }),
      startAuthCommand: {}
    };
    let pollTick = null;
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: [
        {
          id: "codex"
        }
      ],
      browserWindow: null,
      clearIntervalFn: vi.fn(),
      setIntervalFn: vi.fn((callback) => {
        pollTick = callback;
        return 1;
      })
    });

    await authSessions.startDeviceAuth("codex");
    pollTick();
    pollTick();

    expect(accounts.readAuthSession).toHaveBeenCalledTimes(1);

    firstRead.resolve({
      account: {
        id: "codex"
      },
      id: "auth-session-1",
      mode: "device",
      status: "authenticating"
    });
    await flushAsyncWork();

    pollTick();
    await flushAsyncWork();

    expect(accounts.readAuthSession).toHaveBeenCalledTimes(2);
  });

  it("keeps a slow auth-session recovery poll by default", async () => {
    const setIntervalFn = vi.fn(() => 1);
    const accounts = {
      loadError: "",
      readAuthSession: vi.fn(),
      refresh: vi.fn(),
      startAuth: vi.fn().mockResolvedValue({
        account: {
          id: "codex"
        },
        id: "auth-session-1",
        mode: "device",
        status: "authenticating"
      }),
      startAuthCommand: {}
    };
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: [
        {
          id: "codex"
        }
      ],
      browserWindow: null,
      clearIntervalFn: vi.fn(),
      setIntervalFn
    });

    await authSessions.startDeviceAuth("codex");

    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it("updates auth-session state from scoped realtime events", async () => {
    const accounts = {
      invalidateCapabilities: vi.fn(),
      loadError: "",
      readAuthSession: vi.fn(),
      refresh: vi.fn(),
      startAuth: vi.fn().mockResolvedValue({
        account: {
          id: "codex"
        },
        id: "auth-session-1",
        mode: "device",
        status: "authenticating"
      }),
      startAuthCommand: {}
    };
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: [
        {
          id: "codex"
        }
      ],
      browserWindow: null,
      clearIntervalFn: vi.fn(),
      setIntervalFn: vi.fn(() => 1)
    });

    await authSessions.startDeviceAuth("codex");
    const realtime = mocks.realtimeOptions.at(-1);

    expect(realtime.matches({
      payload: {
        sessionId: "auth-session-1"
      }
    })).toBe(true);
    expect(realtime.matches({
      payload: {
        sessionId: "other-session"
      }
    })).toBe(false);

    await realtime.onEvent({
      payload: {
        session: {
          account: {
            id: "codex"
          },
          id: "auth-session-1",
          mode: "device",
          status: "connected"
        },
        sessionId: "auth-session-1"
      }
    });

    expect(accounts.readAuthSession).not.toHaveBeenCalled();
    expect(accounts.refresh).toHaveBeenCalledTimes(1);
    expect(accounts.invalidateCapabilities).toHaveBeenCalledWith({
      event: "client.auth.session.realtime",
      payload: {
        accountId: "codex",
        authSessionId: "auth-session-1",
        connected: true,
        status: "connected"
      }
    });
    expect(authSessions.activeSessionFor("codex")).toBe(null);
  });

  it("backs off auth-session polling after transport failures", async () => {
    let now = 1_000;
    const accounts = {
      loadError: "",
      readAuthSession: vi.fn().mockRejectedValue(new Error("Network request failed.")),
      refresh: vi.fn(),
      startAuth: vi.fn().mockResolvedValue({
        account: {
          id: "codex"
        },
        id: "auth-session-1",
        mode: "device",
        status: "authenticating"
      }),
      startAuthCommand: {}
    };
    let pollTick = null;
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: [
        {
          id: "codex"
        }
      ],
      browserWindow: null,
      clearIntervalFn: vi.fn(),
      nowFn: () => now,
      pollIntervalMs: 1_000,
      setIntervalFn: vi.fn((callback) => {
        pollTick = callback;
        return 1;
      })
    });

    await authSessions.startDeviceAuth("codex");
    pollTick();
    await flushAsyncWork();

    expect(accounts.readAuthSession).toHaveBeenCalledTimes(1);
    expect(authSessions.localError).toBe("Network request failed.");

    pollTick();
    await flushAsyncWork();
    expect(accounts.readAuthSession).toHaveBeenCalledTimes(1);

    now += pollFailureBackoffMs(1, 1_000) - 1;
    pollTick();
    await flushAsyncWork();
    expect(accounts.readAuthSession).toHaveBeenCalledTimes(1);

    now += 1;
    pollTick();
    await flushAsyncWork();
    expect(accounts.readAuthSession).toHaveBeenCalledTimes(2);
  });

  it("handles null terminal-attention checks as idle", () => {
    expect(codexAuthSessionNeedsTerminalAttention(null)).toBe(false);
  });
});

function deferred() {
  let reject = null;
  let resolve = null;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    promise,
    reject,
    resolve
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
