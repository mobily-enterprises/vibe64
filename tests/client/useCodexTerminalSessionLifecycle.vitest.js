import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

const lifecycleHooks = vi.hoisted(() => ({
  beforeUnmount: [],
  mounted: []
}));
const terminalSocket = vi.hoisted(() => ({
  closeSocket: vi.fn(),
  connect: vi.fn(async () => true),
  send: vi.fn(async () => true)
}));

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onBeforeUnmount(callback) {
      lifecycleHooks.beforeUnmount.push(callback);
    },
    onMounted(callback) {
      lifecycleHooks.mounted.push(callback);
    }
  };
});

vi.mock("@/composables/useCodexTerminalSocket.js", () => ({
  useCodexTerminalSocket: vi.fn(() => terminalSocket)
}));

describe("useCodexTerminalSessionLifecycle", () => {
  beforeEach(() => {
    lifecycleHooks.beforeUnmount.length = 0;
    lifecycleHooks.mounted.length = 0;
    vi.clearAllMocks();
    terminalSocket.connect.mockResolvedValue(true);
    terminalSocket.send.mockResolvedValue(true);
  });

  it("starts the terminal after mount tick and invokes mounted readiness once", async () => {
    const { useCodexTerminalSessionLifecycle } = await import("../../src/composables/useCodexTerminalSessionLifecycle.js");
    const options = createLifecycleOptions();

    useCodexTerminalSessionLifecycle(options);

    expect(lifecycleHooks.mounted).toHaveLength(1);

    lifecycleHooks.mounted[0]();

    expect(options.componentMounted.value).toBe(true);
    expect(options.startTerminalSession).not.toHaveBeenCalled();
    expect(options.onMountedReady).not.toHaveBeenCalled();

    await nextTick();
    await Promise.resolve();

    expect(options.startTerminalSession).toHaveBeenCalledTimes(1);
    expect(options.startTerminalSession).toHaveBeenCalledWith("session-1");
    expect(options.onMountedReady).toHaveBeenCalledTimes(1);
  });

  it("disposes only the visual terminal viewport when hidden", async () => {
    const { useCodexTerminalSessionLifecycle } = await import("../../src/composables/useCodexTerminalSessionLifecycle.js");
    const options = createLifecycleOptions({
      visible: ref(true)
    });

    useCodexTerminalSessionLifecycle(options);

    options.visible.value = false;
    await nextTick();

    expect(options.disposeTerminalViewport).toHaveBeenCalledTimes(1);
    expect(options.disposeTerminalViewport).toHaveBeenCalledWith({
      preserveDisplay: true
    });
    expect(terminalSocket.closeSocket).not.toHaveBeenCalled();
    expect(options.clearTerminalOutput).not.toHaveBeenCalled();
  });

  it("recreates the visual terminal viewport and replays output when shown again", async () => {
    const { useCodexTerminalSessionLifecycle } = await import("../../src/composables/useCodexTerminalSessionLifecycle.js");
    const options = createLifecycleOptions({
      terminalSessionId: ref("terminal-1"),
      visible: ref(false)
    });

    useCodexTerminalSessionLifecycle(options);

    options.visible.value = true;

    await vi.waitFor(() => {
      expect(options.setupTerminalUi).toHaveBeenCalled();
      expect(options.fitTerminal).toHaveBeenCalled();
      expect(options.refreshTerminalOutput).toHaveBeenCalled();
    });
  });
});

function createLifecycleOptions(overrides = {}) {
  return {
    appendTerminalOutput: vi.fn(),
    canUseTerminal: ref(true),
    clearCodexBusy: vi.fn(),
    clearPromptEchoFilters: vi.fn(),
    clearTerminalDisplay: vi.fn(),
    clearTerminalOutput: vi.fn(),
    closeTerminalSession: vi.fn(async () => ({})),
    componentMounted: ref(false),
    defaultExpanded: () => true,
    disposeTerminalViewport: vi.fn(),
    emitSessionState: vi.fn(),
    expanded: ref(false),
    fitTerminal: vi.fn(),
    onBeforeDetach: vi.fn(),
    onBeforeDispose: vi.fn(),
    onMountedReady: vi.fn(),
    onSessionChanged: vi.fn(),
    onTerminalRecovered: vi.fn(),
    onTerminalSnapshot: vi.fn(),
    onTerminalStarted: vi.fn(),
    refreshTerminalOutput: vi.fn(),
    resetTerminal: vi.fn(),
    sessionId: ref("session-1"),
    setupTerminalUi: vi.fn(async () => true),
    startTerminalSession: vi.fn(async () => ({
      commandPreview: "npx codex",
      id: "terminal-1",
      status: "running"
    })),
    terminalCommandPreview: ref(""),
    terminalError: ref(""),
    terminalHost: ref(null),
    terminalSessionId: ref(""),
    terminalStarting: ref(false),
    terminalStatus: ref(""),
    visible: ref(true),
    webSocketUrl: ref("ws://example.test"),
    writeTerminalOutput: vi.fn(),
    ...overrides
  };
}
