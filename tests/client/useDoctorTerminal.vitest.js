import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  closeRun: vi.fn(),
  startRun: vi.fn(),
  useCommand: vi.fn()
}));

const endpointMocks = vi.hoisted(() => ({
  reload: vi.fn(),
  save: vi.fn(),
  useEndpointResource: vi.fn()
}));

const recoveryMocks = vi.hoisted(() => ({
  notify: vi.fn()
}));

const xtermMock = vi.hoisted(() => {
  class FakeTerminal {
    dispose() {}
    hasSelection() {
      return false;
    }
    loadAddon() {}
    open() {}
    onData() {
      return {
        dispose() {}
      };
    }
    onSelectionChange() {
      return {
        dispose() {}
      };
    }
    reset() {}
    write() {}
  }

  return {
    FakeTerminal
  };
});

vi.mock("@jskit-ai/kernel/client/asyncModuleRecovery", () => ({
  isDynamicImportError: () => false
}));

vi.mock("@jskit-ai/shell-web/client/asyncModuleRecovery", () => ({
  useShellAsyncModuleRecoveryRuntime: () => ({
    notify: recoveryMocks.notify
  })
}));

vi.mock("@jskit-ai/users-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@jskit-ai/users-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: xtermMock.FakeTerminal
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FakeFitAddon {
    fit() {}
  }
}));

import {
  useDoctorTerminal
} from "../../src/composables/useDoctorTerminal.js";

describe("useDoctorTerminal", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = globalThis.window;
    globalThis.window = {
      addEventListener: vi.fn(),
      clearInterval: vi.fn(),
      clearTimeout: globalThis.clearTimeout,
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 1),
      setTimeout: globalThis.setTimeout
    };
    commandMocks.closeRun.mockReset();
    commandMocks.startRun.mockReset();
    commandMocks.useCommand.mockReset();
    endpointMocks.reload.mockReset();
    endpointMocks.save.mockReset();
    endpointMocks.useEndpointResource.mockReset();
    recoveryMocks.notify.mockReset();
    commandMocks.useCommand
      .mockReturnValueOnce({
        run: commandMocks.startRun
      })
      .mockReturnValueOnce({
        run: commandMocks.closeRun
      });
    endpointMocks.useEndpointResource.mockReturnValue({
      data: {
        value: {}
      },
      reload: endpointMocks.reload,
      save: endpointMocks.save
    });
    endpointMocks.reload.mockResolvedValue({
      data: {
        commandPreview: "gh auth login",
        id: "terminal-1",
        output: "Started.",
        status: "running"
      }
    });
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("starts the terminal action after the xterm UI loads", async () => {
    commandMocks.startRun.mockResolvedValue({
      commandPreview: "gh auth login",
      id: "terminal-1",
      output: "",
      status: "running"
    });
    const terminal = useDoctorTerminal({
      terminalEndpoint: () => "/api/studio/connections/terminal"
    });

    terminal.terminalHost.value = fakeTerminalHost();
    const result = await terminal.openTerminal({
      repair: {
        actionId: "terminal-github-auth-login",
        commandPreview: "gh auth login",
        label: "Connect GitHub"
      },
      visible: true
    });

    expect(result).toEqual(expect.objectContaining({
      id: "terminal-1",
      status: "running"
    }));
    expect(terminal.terminalError.value).toBe("");
    expect(terminal.terminalSessionId.value).toBe("terminal-1");
    expect(commandMocks.startRun).toHaveBeenCalledWith({
      path: "/api/studio/connections/terminal",
      payload: {
        actionId: "terminal-github-auth-login",
        inputs: {}
      }
    });
    expect(endpointMocks.reload).toHaveBeenCalledTimes(1);
    expect(recoveryMocks.notify).not.toHaveBeenCalled();
  });

  it("exposes a URL from terminal output for setup copy actions", async () => {
    commandMocks.startRun.mockResolvedValue({
      commandPreview: "gh auth login",
      id: "terminal-1",
      output: "",
      status: "running"
    });
    endpointMocks.reload.mockResolvedValue({
      data: {
        commandPreview: "gh auth login",
        id: "terminal-1",
        output: "Open https://github.com/login/device and enter ABCD-1234.",
        status: "running"
      }
    });
    const terminal = useDoctorTerminal({
      terminalEndpoint: () => "/api/studio/connections/terminal"
    });

    terminal.terminalHost.value = fakeTerminalHost();
    await terminal.openTerminal({
      repair: {
        actionId: "terminal-github-auth-login",
        commandPreview: "gh auth login",
        label: "Connect GitHub"
      },
      visible: true
    });

    expect(terminal.terminalUrl.value).toBe("https://github.com/login/device");
  });
});

function fakeTerminalHost() {
  return {
    addEventListener() {},
    removeEventListener() {}
  };
}
