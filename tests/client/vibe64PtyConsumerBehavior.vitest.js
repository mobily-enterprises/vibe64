import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import {
  computed,
  createRenderer,
  defineComponent,
  h,
  nextTick,
  reactive,
  ref,
  ssrContextKey
} from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const terminalMocks = vi.hoisted(() => {
  class FakeTerminal {
    static instances = [];

    constructor() {
      this.cols = 93;
      this.dataHandler = null;
      this.rows = 28;
      this.writes = [];
      FakeTerminal.instances.push(this);
    }

    dispose() {}
    emitData(data) {
      this.dataHandler?.(data);
    }
    focus() {}
    hasSelection() {
      return false;
    }
    loadAddon() {}
    onData(handler) {
      this.dataHandler = handler;
      return { dispose: () => { this.dataHandler = null; } };
    }
    onScroll() {
      return { dispose() {} };
    }
    onSelectionChange() {
      return { dispose() {} };
    }
    open() {}
    refresh() {}
    reset() {
      this.writes = [];
    }
    scrollToBottom() {}
    write(chunk, callback) {
      this.writes.push(chunk);
      callback?.();
    }
  }

  class FakeFitAddon {
    fit() {}
  }

  return {
    accountAuthSessions: null,
    attachmentCanAddFiles: null,
    FakeFitAddon,
    FakeTerminal,
    loadXtermModules: vi.fn(),
    mountedApps: [],
    uploadAttachmentFiles: vi.fn(),
    handleAttachmentDrop: vi.fn()
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: terminalMocks.FakeTerminal
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: terminalMocks.FakeFitAddon
}));

vi.mock("@/lib/xtermModuleLoader.js", () => ({
  loadXtermModules: terminalMocks.loadXtermModules
}));

vi.mock(
  "../../packages/vibe64-accounts/src/client/composables/useAccountAuthSessions.js",
  () => ({
    useAccountAuthSessions() {
      return terminalMocks.accountAuthSessions;
    }
  })
);

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent: () => ({ active: ref(false) })
}));

vi.mock("@/components/studio/vibe64-session/Vibe64AttachmentQueue.vue", () => ({
  default: defineComponent({ render: () => null })
}));

vi.mock("@/composables/useVibe64CodexCommands.js", () => ({
  useVibe64CodexCommands: () => ({
    closeAgentTerminal: vi.fn().mockResolvedValue({ ok: true }),
    closeGlobalCodexTerminal: vi.fn().mockResolvedValue({ ok: true }),
    deleteAttachment: vi.fn(),
    sendAgentTerminalText: vi.fn().mockResolvedValue({ ok: true }),
    startAgentTerminal: vi.fn(),
    startGlobalCodexTerminal: vi.fn(),
    uploadAttachment: vi.fn()
  })
}));

vi.mock("@/composables/useVibe64TerminalCommands.js", () => ({
  useVibe64TerminalCommands: () => ({
    closeAgentTerminal: vi.fn().mockResolvedValue({ ok: true }),
    sendAgentTerminalText: vi.fn().mockResolvedValue({ ok: true }),
    startAgentTerminal: vi.fn()
  })
}));

vi.mock("@/composables/useVibe64AttachmentCommands.js", () => ({
  useVibe64AttachmentCommands: () => ({ deleteAttachment: vi.fn(), uploadAttachment: vi.fn() })
}));

vi.mock("@/composables/useAgentTerminalAttachments.js", () => ({
  useAgentTerminalAttachments: (options) => ({
    abandonAttachments: vi.fn().mockResolvedValue([]),
    attachmentCanAddFiles: computed(() => options.canUpload.value && terminalMocks.attachmentCanAddFiles.value),
    attachmentDragActive: ref(false),
    attachmentQueueItems: ref([]),
    attachmentStatus: ref(""),
    cancelAttachment: vi.fn(),
    clearAttachmentStatus: vi.fn(),
    handleAttachmentDragEnter: vi.fn(),
    handleAttachmentDragLeave: vi.fn(),
    handleAttachmentDragOver: vi.fn(),
    handleAttachmentDrop: terminalMocks.handleAttachmentDrop,
    removeAttachment: vi.fn(),
    retryAttachment: vi.fn(),
    resetAttachmentDragState: vi.fn(),
    uploadAttachmentFiles: terminalMocks.uploadAttachmentFiles
  })
}));

vi.mock("@/composables/useCodexTerminalOutput.js", () => ({
  useCodexTerminalOutput: () => ({
    appendTerminalOutput: vi.fn(),
    clearCodexBusy: vi.fn(),
    clearCodexWorking: vi.fn(),
    codexBusy: ref(false),
    codexWorking: ref(false),
    markCodexBusy: vi.fn(),
    resetTerminalOutput: vi.fn(),
    terminalStreaming: ref(false),
    writeTerminalOutput: vi.fn()
  })
}));

vi.mock("@/lib/vibe64SessionApi.js", () => ({
  vibe64AgentTerminalWebSocketUrl: (sessionId, terminalId) => (
    `ws://codex/${sessionId}/${terminalId}`
  ),
  vibe64GlobalCodexTerminalWebSocketUrl: (scopeId, terminalId) => (
    `ws://codex/${scopeId}/${terminalId}`
  )
}));

vi.mock("@local/vibe64-accounts/client", () => ({
  VIBE64_ACCOUNTS_CHANGED_EVENT: "vibe64.accounts.changed"
}));

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));

vi.mock("vuetify/components/VChip", () => ({
  VChip: passthroughComponent("span")
}));

vi.mock("vuetify/components/VDialog", () => ({
  VDialog: passthroughComponent("dialog")
}));

vi.mock("vuetify/components/VIcon", () => ({
  VIcon: passthroughComponent("i")
}));

vi.mock("vuetify/components/VSheet", () => ({
  VSheet: passthroughComponent("section")
}));

vi.mock("@/components/studio/StudioErrorNotice.vue", () => ({
  default: defineComponent({ render: () => null })
}));

import Vibe64NativeAgentSession from "../../src/components/studio/Vibe64NativeAgentSession.vue";
import Vibe64CodexSession from "../../src/components/studio/Vibe64CodexSession.vue";
import Vibe64InteractiveTerminal from "../../src/components/studio/Vibe64InteractiveTerminal.vue";
import Vibe64Terminal from "../../src/components/studio/Vibe64Terminal.vue";
import Vibe64TerminalSurface from "../../src/components/studio/Vibe64TerminalSurface.vue";
import {
  useProviderAccountsSetup
} from "../../packages/vibe64-accounts/src/client/composables/useProviderAccountsSetup.js";

attachClientRender(
  Vibe64NativeAgentSession,
  path.resolve("src/components/studio/Vibe64NativeAgentSession.vue"),
  "vibe64-native-agent-session-behavior-test"
);
attachClientRender(
  Vibe64CodexSession,
  path.resolve("src/components/studio/Vibe64CodexSession.vue"),
  "vibe64-codex-session-behavior-test"
);
attachClientRender(
  Vibe64InteractiveTerminal,
  path.resolve("src/components/studio/Vibe64InteractiveTerminal.vue"),
  "vibe64-interactive-terminal-behavior-test"
);
attachClientRender(
  Vibe64Terminal,
  path.resolve("src/components/studio/Vibe64Terminal.vue"),
  "vibe64-terminal-behavior-test"
);
attachClientRender(
  Vibe64TerminalSurface,
  path.resolve("src/components/studio/Vibe64TerminalSurface.vue"),
  "vibe64-terminal-surface-behavior-test"
);

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

function registerTestComponents(app) {
  app.component("VBtn", passthroughComponent("button"));
  app.component("VChip", passthroughComponent("span"));
  app.component("VDialog", passthroughComponent("dialog"));
  app.component("VIcon", passthroughComponent("i"));
  app.component("VSheet", passthroughComponent("section"));
}

function attachClientRender(component, componentPath, id) {
  const { descriptor } = parse(fs.readFileSync(componentPath, "utf8"), {
    filename: componentPath
  });
  const script = compileScript(descriptor, { id });
  const template = compile(descriptor.template.content, {
    bindingMetadata: script.bindings,
    mode: "function",
    prefixIdentifiers: true
  });
  component.render = new Function("Vue", template.code)(VueRuntime);
}

const testRenderer = createRenderer({
  createComment: (text) => ({ children: [], props: {}, style: {}, text, type: "comment" }),
  createElement: (type) => terminalHostNode(type),
  createText: (text) => ({ children: [], props: {}, style: {}, text, type: "text" }),
  insert(child, parent, anchor = null) {
    child.parent = parent;
    parent.children ||= [];
    const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1;
    if (anchorIndex < 0) {
      parent.children.push(child);
    } else {
      parent.children.splice(anchorIndex, 0, child);
    }
  },
  nextSibling(node) {
    const index = node.parent?.children?.indexOf(node) ?? -1;
    return index >= 0 ? node.parent.children[index + 1] || null : null;
  },
  parentNode: (node) => node.parent,
  patchProp(element, key, _previous, value) {
    element.props[key] = value;
  },
  querySelector: () => null,
  remove(child) {
    const index = child.parent?.children?.indexOf(child) ?? -1;
    if (index >= 0) {
      child.parent.children.splice(index, 1);
    }
    child.parent = null;
  },
  setElementText(element, text) {
    element.text = text;
  },
  setText(node, text) {
    node.text = text;
  }
});

describe("visible PTY consumer behavior", () => {
  let originalDocument;
  let originalWebSocket;
  let originalWindow;

  beforeEach(() => {
    originalDocument = globalThis.document;
    originalWebSocket = globalThis.WebSocket;
    originalWindow = globalThis.window;
    FakeWebSocket.instances.length = 0;
    terminalMocks.FakeTerminal.instances.length = 0;
    terminalMocks.attachmentCanAddFiles = ref(true);
    terminalMocks.loadXtermModules.mockReset();
    terminalMocks.loadXtermModules.mockResolvedValue({
      FitAddon: terminalMocks.FakeFitAddon,
      Terminal: terminalMocks.FakeTerminal
    });
    terminalMocks.uploadAttachmentFiles.mockReset();
    terminalMocks.handleAttachmentDrop.mockReset();
    globalThis.WebSocket = FakeWebSocket;
    globalThis.document = {
      activeElement: null
    };
    globalThis.window = {
      addEventListener: vi.fn(),
      clearTimeout: globalThis.clearTimeout,
      location: {
        host: "vibe64.test",
        origin: "http://vibe64.test",
        pathname: "/app/project/example",
        protocol: "http:"
      },
      matchMedia: () => ({
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn()
      }),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout
    };
  });

  afterEach(() => {
    for (const app of terminalMocks.mountedApps.splice(0)) {
      app.unmount();
    }
    terminalMocks.accountAuthSessions = null;
    terminalMocks.attachmentCanAddFiles = null;
    globalThis.document = originalDocument;
    globalThis.WebSocket = originalWebSocket;
    globalThis.window = originalWindow;
  });

  it("opens the existing Codex PTY as the session's full interactive terminal", async () => {
    const container = terminalHostNode("root");
    const session = reactive({
      agentSession: {
        terminal: {
          id: "codex-terminal-1",
          status: "running"
        }
      },
      sessionId: "session-1"
    });
    const app = testRenderer.createApp({
      render: () => h(Vibe64CodexSession, {
        allowStart: false,
        session,
        visible: true
      })
    });
    registerTestComponents(app);
    app.provide(ssrContextKey, { modules: new Set() });
    app.mount(container);
    terminalMocks.mountedApps.push(app);

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    socket.dispatch("open");
    socket.dispatch("message", {
      data: JSON.stringify({
        chunk: "Booting Codex\rReady for work\r",
        outputVersion: 1,
        type: "output"
      })
    });
    await flushAsyncWork();

    const surface = findNode(container, hasClass("vibe64-terminal-surface"));
    const summary = findNode(container, hasClass("vibe64-terminal-surface__summary"));
    const attachFiles = findNode(container, (node) => (
      node.type === "button" &&
      node.props?.["aria-label"] === "Attach files to Codex terminal"
    ));

    expect(surface).toBeTruthy();
    expect(summary).toBeNull();
    expect(attachFiles).toBeTruthy();
    expect(attachFiles.props.disabled).toBe(false);
    expect(attachFiles.props.type).toBe("button");
    const fileInput = findNode(container, (node) => (
      node.type === "input" && node.props?.type === "file"
    ));
    const selectedFile = { name: "keyboard.txt", size: 8 };
    const inputTarget = {
      files: [selectedFile],
      value: "C:\\fakepath\\keyboard.txt"
    };
    fileInput.props.onChange({ currentTarget: inputTarget });
    expect(inputTarget.value).toBe("");
    expect(terminalMocks.uploadAttachmentFiles).toHaveBeenCalledWith([selectedFile]);

    terminalMocks.attachmentCanAddFiles.value = false;
    await nextTick();
    expect(attachFiles.props.disabled).toBe(true);
    expect(attachFiles.props["aria-label"]).toBe("Codex terminal attachment limit reached");
    expect(nodeText(surface)).toContain("running");
    await vi.waitFor(() => expect(terminalMocks.FakeTerminal.instances).toHaveLength(1));

    const xterm = terminalMocks.FakeTerminal.instances[0];
    xterm.emitData("status\r");
    await flushAsyncWork();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.sentMessages()).toContainEqual({
      data: "status\r",
      type: "input"
    });
  });

  it("does not render attachment actions for global or read-only terminals", async () => {
    for (const terminalProps of [
      {
        readOnly: true,
        session: { sessionId: "read-only-session" }
      },
      {
        scope: "global"
      }
    ]) {
      const container = terminalHostNode("root");
      const app = testRenderer.createApp({
        render: () => h(Vibe64CodexSession, {
          allowStart: false,
          visible: true,
          ...terminalProps
        })
      });
      registerTestComponents(app);
      app.provide(ssrContextKey, { modules: new Set() });
      app.mount(container);
      await flushAsyncWork();

      expect(findNode(container, (node) => (
        node.type === "button" &&
        String(node.props?.["aria-label"] || "").includes("Codex terminal")
      ))).toBeNull();
      app.unmount();
    }
  });

  it("offers picker, file drop and file paste on the running OpenCode terminal without submitting", async () => {
    const container = terminalHostNode("root");
    const session = reactive({
      assistantSelection: { engineId: "opencode" },
      agentSession: { terminal: { id: "opencode-terminal-1", status: "running" } },
      sessionId: "session-1"
    });
    const props = reactive({ readOnly: false, session, visible: true });
    const app = testRenderer.createApp({ render: () => h(Vibe64NativeAgentSession, props) });
    registerTestComponents(app);
    app.provide(ssrContextKey, { modules: new Set() });
    app.mount(container);
    terminalMocks.mountedApps.push(app);
    await flushAsyncWork();

    const button = findNode(container, (node) => node.props?.["aria-label"] === "Attach files to OpenCode terminal");
    expect(button).toBeTruthy();
    expect(button.props.disabled).toBe(false);
    const input = findNode(container, (node) => node.type === "input" && node.props.type === "file");
    const file = { name: "screen.png", size: 8 };
    const picker = { files: [file], value: "C:\\fakepath\\screen.png" };
    input.props.onChange({ currentTarget: picker });
    expect(picker.value).toBe("");
    expect(terminalMocks.uploadAttachmentFiles).toHaveBeenCalledWith([file]);
    const root = findNode(container, hasClass("vibe64-native-agent-session"));
    const drop = { preventDefault: vi.fn(), dataTransfer: { files: [file] } };
    root.props.onDrop(drop);
    expect(drop.preventDefault).toHaveBeenCalled();
    expect(terminalMocks.handleAttachmentDrop).toHaveBeenCalledWith(drop);

    const paste = {
      clipboardData: { files: [file], getData: () => "do this now\n" },
      preventDefault: vi.fn(), stopPropagation: vi.fn()
    };
    root.props.onPasteCapture(paste);
    expect(paste.preventDefault).toHaveBeenCalled();
    expect(paste.stopPropagation).toHaveBeenCalled();
    expect(terminalMocks.uploadAttachmentFiles).toHaveBeenCalledTimes(2);
    const textPaste = { clipboardData: { files: [], getData: () => "ordinary text" }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    root.props.onPasteCapture(textPaste);
    expect(textPaste.preventDefault).not.toHaveBeenCalled();
    expect(textPaste.stopPropagation).not.toHaveBeenCalled();
    expect(terminalMocks.uploadAttachmentFiles).toHaveBeenCalledTimes(2);

    props.readOnly = true;
    await nextTick();
    expect(findNode(container, (node) => node.props?.["aria-label"] === "Attach files to OpenCode terminal")).toBeNull();
    props.readOnly = false;
    session.assistantSelection.engineId = "claude";
    await nextTick();
    expect(findNode(container, (node) => node.props?.["aria-label"] === "Attach files to OpenCode terminal")).toBeNull();
  });

  it("keeps one provider login PTY while switching active auth sessions", async () => {
    const sessions = reactive({
      codex: authSession("codex", "auth-codex", "Codex ready\r")
    });
    terminalMocks.accountAuthSessions = accountAuthHarness(sessions);
    const accountRows = reactive([
      { connected: false, id: "codex", label: "Codex" },
      { connected: false, id: "github", label: "GitHub" }
    ]);
    let setup = null;
    const app = testRenderer.createApp({
      setup() {
        setup = useProviderAccountsSetup({
          accountRows,
          accounts: {
            isLoading: ref(false),
            saveGitIdentityCommand: {}
          },
          actionsEnabled: true,
          statusLoaded: true
        });
        return () => null;
      }
    });
    app.mount(terminalHostNode("root"));
    terminalMocks.mountedApps.push(app);

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.dispatch("open");
    await flushAsyncWork();

    expect(setup.authTerminalVisible(sessions.codex)).toBe(true);
    expect(setup.authTerminalExpanded.value).toBe(false);
    expect(setup.authTerminal.terminalSummaryLine.value).toBe("Codex ready");

    setup.authTerminal.setTerminalHost(terminalHostNode("div"));
    setup.updateAuthTerminalExpanded(true);
    await setup.authTerminal.setupTerminalUi();
    expect(terminalMocks.FakeTerminal.instances).toHaveLength(1);

    terminalMocks.FakeTerminal.instances[0].emitData("continue\r");
    await flushAsyncWork();
    expect(firstSocket.sentMessages()).toContainEqual({
      data: "continue\r",
      type: "input"
    });

    const previousSession = sessions.codex;
    delete sessions.codex;
    sessions.github = authSession("github", "auth-github", "GitHub ready\r");
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances[1].dispatch("open");
    await flushAsyncWork();

    expect(setup.authTerminalVisible(previousSession)).toBe(false);
    expect(setup.authTerminalVisible(sessions.github)).toBe(true);
    expect(setup.authTerminalExpanded.value).toBe(false);
    expect(setup.authTerminal.terminalSummaryLine.value).toBe("GitHub ready");
    expect(terminalMocks.FakeTerminal.instances).toHaveLength(1);
  });
});

function accountAuthHarness(sessions) {
  const authBusy = computed(() => Object.values(sessions).some((session) => (
    session?.status === "authenticating"
  )));
  return {
    activeSessionFor: (accountId) => sessions[accountId] || null,
    authBusy,
    authCopyStatus: reactive({}),
    authSessionNeedsTerminalAttention: () => false,
    cancelSession: vi.fn(),
    copyAuthCode: vi.fn(),
    errorMessage: ref(""),
    localError: ref(""),
    loginDisabled: () => false,
    logoutAccount: vi.fn(),
    logoutAccountId: ref(""),
    openAuthUrl: vi.fn(),
    refreshStatus: vi.fn(),
    startApiKeyAuth: vi.fn(),
    startBrowserAuth: vi.fn(),
    startDeviceAuth: vi.fn(),
    stopPolling: vi.fn()
  };
}

function authSession(accountId, id, output) {
  return {
    account: {
      id: accountId,
      label: accountId === "codex" ? "Codex" : "GitHub"
    },
    id,
    mode: "device",
    output,
    outputVersion: 1,
    status: "authenticating",
    terminalStatus: "running"
  };
}

function terminalHostNode(type) {
  return {
    addEventListener: vi.fn(),
    children: [],
    contains: () => false,
    focus: vi.fn(),
    parent: null,
    props: {},
    querySelectorAll: () => [],
    removeEventListener: vi.fn(),
    replaceChildren: vi.fn(),
    style: {},
    type
  };
}

function findNode(root, predicate) {
  if (predicate(root)) {
    return root;
  }
  for (const child of root.children || []) {
    const match = findNode(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

function hasClass(className) {
  return (node) => String(node.props?.class || "").includes(className);
}

function nodeText(node) {
  return [node.text || "", ...(node.children || []).map(nodeText)].join("");
}

async function flushAsyncWork() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.listeners = new Map();
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(eventName, handler) {
    this.listeners.set(eventName, handler);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close");
  }

  dispatch(eventName, event = {}) {
    if (eventName === "open") {
      this.readyState = FakeWebSocket.OPEN;
    }
    this.listeners.get(eventName)?.(event);
  }

  send(message) {
    this.sent.push(JSON.parse(String(message || "{}")));
  }

  sentMessages() {
    return this.sent;
  }
}
