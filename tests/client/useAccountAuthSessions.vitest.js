import { describe, expect, it, vi } from "vitest";

import {
  codexAuthSessionNeedsTerminalAttention,
  useAccountAuthSessions
} from "../../packages/vibe64-accounts/src/client/composables/useAccountAuthSessions.js";

describe("useAccountAuthSessions", () => {
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

  it("handles null terminal-attention checks as idle", () => {
    expect(codexAuthSessionNeedsTerminalAttention(null)).toBe(false);
  });
});
