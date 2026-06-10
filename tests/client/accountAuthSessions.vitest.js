import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import {
  codexAuthSessionNeedsTerminalAttention,
  useAccountAuthSessions
} from "../../src/composables/useAccountAuthSessions.js";

describe("account auth sessions", () => {
  it("starts browser auth without opening the link until the user chooses to", async () => {
    const accounts = fakeAccounts({
      startAuth: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        authUrl: "https://github.com/login/device",
        id: "auth-1",
        status: "authenticating",
        terminalStatus: "running"
      })
    });
    const browserWindow = fakeBrowserWindow();
    const scheduler = fakeScheduler();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "github"
        }
      ]),
      browserWindow,
      clearIntervalFn: scheduler.clearInterval,
      setIntervalFn: scheduler.setInterval
    });

    await authSessions.startBrowserAuth("github");

    expect(accounts.startAuth).toHaveBeenCalledWith("github", "browser");
    expect(browserWindow.open).not.toHaveBeenCalled();
    expect(authSessions.activeSessionFor("github")?.id).toBe("auth-1");
    expect(authSessions.authBusy).toBe(true);
    expect(scheduler.setInterval).toHaveBeenCalledTimes(1);

    authSessions.openAuthUrl(authSessions.activeSessionFor("github"));

    expect(browserWindow.open).toHaveBeenCalledTimes(1);
    expect(browserWindow.open).toHaveBeenCalledWith(
      "https://github.com/login/device",
      "_blank",
      "noopener"
    );
  });

  it("refreshes status and removes an auth session after it connects", async () => {
    const accounts = fakeAccounts({
      readAuthSession: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        id: "auth-1",
        status: "connected"
      }),
      startAuth: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        id: "auth-1",
        status: "authenticating"
      })
    });
    const scheduler = fakeScheduler();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "github"
        }
      ]),
      browserWindow: fakeBrowserWindow(),
      clearIntervalFn: scheduler.clearInterval,
      setIntervalFn: scheduler.setInterval
    });

    await authSessions.startBrowserAuth("github");
    await authSessions.pollAuthSessions();

    expect(accounts.readAuthSession).toHaveBeenCalledWith("auth-1");
    expect(accounts.refresh).toHaveBeenCalledTimes(1);
    expect(authSessions.activeSessionFor("github")).toBeNull();
    expect(authSessions.authBusy).toBe(false);
  });

  it("starts Codex device auth and copies the one-time code after it is available", async () => {
    const accounts = fakeAccounts({
      startAuth: async () => ({
        account: {
          id: "codex",
          label: "Codex"
        },
        authUrl: "https://auth.openai.com/codex/device",
        id: "auth-codex-1",
        mode: "device",
        status: "authenticating",
        terminalStatus: "running",
        userCode: "CKVC-RY1P4"
      })
    });
    const clipboard = {
      writeText: vi.fn(async () => undefined)
    };
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "codex"
        }
      ]),
      browserWindow: fakeBrowserWindow(),
      clipboard
    });

    await authSessions.startDeviceAuth("codex");
    await authSessions.copyAuthCode(authSessions.activeSessionFor("codex"));

    expect(accounts.startAuth).toHaveBeenCalledWith("codex", "device");
    expect(clipboard.writeText).toHaveBeenCalledWith("CKVC-RY1P4");
    expect(authSessions.authCopyStatus["auth-codex-1"]).toBe("One-time code copied.");
  });

  it("starts Codex API key auth without opening a browser", async () => {
    const accounts = fakeAccounts({
      startAuth: async () => ({
        account: {
          id: "codex",
          label: "Codex"
        },
        id: "auth-codex-api-key-1",
        mode: "api_key",
        status: "authenticating",
        terminalStatus: "running"
      })
    });
    const browserWindow = fakeBrowserWindow();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "codex"
        }
      ]),
      browserWindow
    });

    await authSessions.startApiKeyAuth("codex", "sk-test-secret");

    expect(accounts.startAuth).toHaveBeenCalledWith("codex", "api_key", {
      apiKey: "sk-test-secret"
    });
    expect(browserWindow.open).not.toHaveBeenCalled();
    expect(authSessions.activeSessionFor("codex")).toMatchObject({
      id: "auth-codex-api-key-1",
      mode: "api_key"
    });
  });

  it("derives Codex device codes from auth output when polling has not parsed them yet", async () => {
    const accounts = fakeAccounts({
      startAuth: async () => ({
        account: {
          id: "codex",
          label: "Codex"
        },
        authUrl: "https://auth.openai.com/codex/device",
        id: "auth-codex-1",
        mode: "device",
        output: [
          "Follow these steps to sign in with ChatGPT using device code authorization:",
          "   ¤[94mhttps://auth.openai.com/codex/device¤[0m",
          "2. Enter this one-time code ¤[90m(expires in 15 minutes)¤[0m",
          "   ¤[94mCK13-6J2ZT¤[0m"
        ].join("\n"),
        status: "authenticating",
        terminalStatus: "running"
      })
    });
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "codex"
        }
      ]),
      browserWindow: fakeBrowserWindow()
    });

    await authSessions.startDeviceAuth("codex");

    expect(authSessions.activeSessionFor("codex")).toMatchObject({
      authUrl: "https://auth.openai.com/codex/device",
      userCode: "CK13-6J2ZT"
    });
  });

  it("uses the terminal as the recovery surface when Codex prints output without a device code", async () => {
    const session = {
      account: {
        id: "codex",
        label: "Codex"
      },
      id: "auth-codex-attention",
      mode: "device",
      output: [
        "Welcome to Codex [v0.136.0]",
        "Codex needs terminal input before it can continue."
      ].join("\n"),
      status: "authenticating",
      terminalStatus: "running"
    };

    expect(codexAuthSessionNeedsTerminalAttention(session)).toBe(true);
  });

  it("does not require terminal attention after Codex prints a usable device code", () => {
    const session = {
      account: {
        id: "codex",
        label: "Codex"
      },
      id: "auth-codex-code",
      mode: "device",
      output: [
        "Open this link in your browser",
        "https://auth.openai.com/codex/device",
        "Enter this one-time code",
        "CKVC-RY1P4"
      ].join("\n"),
      status: "authenticating",
      terminalStatus: "running"
    };

    expect(codexAuthSessionNeedsTerminalAttention(session)).toBe(false);
  });

  it("uses the terminal as the recovery surface for failed Codex auth", () => {
    const session = {
      account: {
        id: "codex",
        label: "Codex"
      },
      id: "auth-codex-failed",
      mode: "device",
      output: "Codex login failed.",
      status: "failed",
      terminalStatus: "exited"
    };

    expect(codexAuthSessionNeedsTerminalAttention(session)).toBe(true);
  });

  it("keeps failed auth sessions visible and stops polling them", async () => {
    const accounts = fakeAccounts({
      readAuthSession: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        id: "auth-1",
        output: "GitHub login failed because the token expired.",
        status: "failed",
        terminalStatus: "exited"
      }),
      startAuth: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        id: "auth-1",
        status: "authenticating"
      })
    });
    const scheduler = fakeScheduler();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "github"
        }
      ]),
      browserWindow: fakeBrowserWindow(),
      clearIntervalFn: scheduler.clearInterval,
      setIntervalFn: scheduler.setInterval
    });

    await authSessions.startBrowserAuth("github");
    await authSessions.pollAuthSessions();
    await authSessions.pollAuthSessions();

    expect(accounts.readAuthSession).toHaveBeenCalledTimes(1);
    expect(accounts.refresh).toHaveBeenCalledTimes(1);
    expect(authSessions.activeSessionFor("github")).toMatchObject({
      id: "auth-1",
      output: "GitHub login failed because the token expired.",
      status: "failed"
    });
    expect(authSessions.authBusy).toBe(false);
    expect(scheduler.clearInterval).toHaveBeenCalledWith(1001);
  });

  it("does not start login for an already connected account", async () => {
    const accounts = fakeAccounts();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: true,
          id: "github"
        }
      ]),
      browserWindow: fakeBrowserWindow()
    });

    await authSessions.startBrowserAuth("github");

    expect(accounts.startAuth).not.toHaveBeenCalled();
  });

  it("requires Git identity before starting GitHub auth", async () => {
    const accounts = fakeAccounts();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          gitIdentityRequired: true,
          id: "github"
        }
      ]),
      browserWindow: fakeBrowserWindow()
    });

    await authSessions.startBrowserAuth("github", {
      gitUserEmail: "",
      gitUserName: ""
    });

    expect(accounts.startAuth).not.toHaveBeenCalled();
    expect(authSessions.errorMessage).toBe("Git user.name and user.email are required before GitHub login.");
  });

  it("passes Git identity when starting GitHub auth", async () => {
    const accounts = fakeAccounts({
      startAuth: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        id: "auth-1",
        status: "authenticating"
      })
    });
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: true,
          gitIdentityRequired: true,
          id: "github"
        }
      ]),
      browserWindow: fakeBrowserWindow()
    });

    await authSessions.startBrowserAuth("github", {
      gitUserEmail: "ada@example.com",
      gitUserName: "Ada Lovelace"
    });

    expect(accounts.startAuth).toHaveBeenCalledWith("github", "browser", {
      gitUserEmail: "ada@example.com",
      gitUserName: "Ada Lovelace"
    });
  });

  it("surfaces start failures and closes the prepared browser window", async () => {
    const accounts = fakeAccounts({
      startAuth: async () => {
        throw new Error("GitHub refused login.");
      }
    });
    const browserWindow = fakeBrowserWindow();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "github"
        }
      ]),
      browserWindow
    });

    await authSessions.startBrowserAuth("github");

    expect(authSessions.errorMessage).toBe("GitHub refused login.");
    expect(browserWindow.open).not.toHaveBeenCalled();
  });
});

function fakeAccounts(overrides = {}) {
  const accounts = {
    cancelAuthSession: vi.fn(async () => ({})),
    loadError: "",
    logout: vi.fn(async () => ({})),
    readAuthSession: vi.fn(async () => ({})),
    refresh: vi.fn(async () => ({})),
    startAuth: vi.fn(async () => ({})),
    startAuthCommand: {
      message: "",
      messageType: ""
    }
  };
  for (const [key, value] of Object.entries(overrides)) {
    accounts[key] = typeof value === "function" ? vi.fn(value) : value;
  }
  return accounts;
}

function fakeBrowserWindow() {
  const openedWindows = [];
  return {
    openedWindows,
    open: vi.fn((url, target, features) => {
      const preparedWindow = {
        closed: false,
        close: vi.fn(function closeWindow() {
          this.closed = true;
        }),
        features,
        location: {
          href: String(url || "")
        },
        opener: {},
        target
      };
      openedWindows.push(preparedWindow);
      return preparedWindow;
    })
  };
}

function fakeScheduler() {
  return {
    clearInterval: vi.fn(),
    setInterval: vi.fn(() => 1001)
  };
}
