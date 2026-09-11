import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "@vue/compiler-dom";
import { parse } from "@vue/compiler-sfc";
import { describe, expect, it, vi } from "vitest";
import * as Vue from "vue";
import {
  computed,
  createRenderer,
  defineComponent,
  h,
  nextTick,
  reactive,
  ref
} from "vue";

function componentFromSfcTemplate(relativePath, {
  emits = [],
  name,
  props = {},
  setup
}) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(filename, "utf8");
  const { descriptor } = parse(source, { filename });
  const compiled = compile(descriptor.template.content, {
    filename,
    mode: "function",
    prefixIdentifiers: true
  });
  const render = new Function("Vue", compiled.code)(Vue);
  return defineComponent({
    name,
    props,
    emits,
    setup,
    render
  });
}

function slotHost(name, slotPayload = undefined) {
  return defineComponent({
    name,
    setup(_props, { slots }) {
      return () => h("div", { "data-test-host": name }, slots.default?.(slotPayload));
    }
  });
}

function emptyComponent(name) {
  return defineComponent({
    name,
    setup() {
      return () => null;
    }
  });
}

const RecoveryAutopilot = defineComponent({
  name: "RecoveryAutopilot",
  emits: ["chat-attention"],
  setup(_props, { emit }) {
    return () => h("button", {
      "data-test": "recovery-action",
      onClick: () => emit("chat-attention"),
      type: "button"
    }, "Fix it with AI");
  }
});

const SessionRuntimeHost = componentFromSfcTemplate(
  "../../src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue",
  {
    emits: [
      "busy-change",
      "chat-attention",
      "page-error-change",
      "work-state-change",
      "toolbar-controls-ready",
      "project-attention"
    ],
    name: "Vibe64SessionRuntimeHost",
    props: {
      active: { default: false, type: Boolean },
      chatCollapsed: { default: false, type: Boolean },
      githubActorTeleportTarget: { default: "", type: String },
      previewToolbarTeleportTarget: { default: "", type: String },
      promptHintPolicy: { default: () => ({}), type: Object },
      projectContext: { default: () => ({}), type: Object },
      projectPane: { default: "preview", type: String },
      sessionData: { required: true, type: Object },
      sessionId: { required: true, type: String },
      toolbarSessions: { default: () => [], type: Array }
    },
    setup(props, { emit }) {
      return {
        agentConnectionStatus: ref("connected"),
        agentTerminal: { sessionUpdate: vi.fn() },
        autopilotModeActive: ref(true),
        autopilotSessionToolbar: reactive({}),
        cancelAgentMessage: vi.fn(),
        codexTerminalCanStart: ref(false),
        conversationLog: reactive({ turns: [] }),
        dialogs: reactive({}),
        emitChatAttention: () => emit("chat-attention"),
        emitProjectAttention: () => emit("project-attention"),
        guardedPage: reactive({}),
        interruptAgentTurn: vi.fn(),
        props,
        refreshSessionData: vi.fn(),
        refreshWorkState: vi.fn(),
        retryWorkspaceSetup: vi.fn(),
        saveSessionWork: vi.fn(),
        selectedAgentTerminalId: ref(""),
        selection: reactive({
          isArchived: false,
          selectedSession: { sessionId: props.sessionId }
        }),
        sendAgentMessage: vi.fn(),
        setAutopilotBusy: vi.fn(),
        updateSessionWork: vi.fn(),
        workState: reactive({})
      };
    }
  }
);

const SessionPanel = componentFromSfcTemplate(
  "../../src/components/studio/Vibe64SessionPanel.vue",
  {
    emits: ["chat-attention", "title-change", "project-attention"],
    name: "Vibe64SessionPanel",
    props: {
      chatCollapsed: { default: false, type: Boolean },
      githubActorTeleportTarget: { default: "", type: String },
      previewToolbarTeleportTarget: { default: "", type: String },
      projectContext: { default: () => ({}), type: Object },
      projectPane: { default: "", type: String }
    },
    setup(props, { emit }) {
      return {
        chatCollapsed: computed(() => Boolean(props.chatCollapsed)),
        chatColumnBounds: { max: 720, min: 240 },
        chatColumnResizing: ref(false),
        chatColumnSeparator: ref(null),
        chatColumnWidth: ref(384),
        dashboardProjectActive: ref(false),
        dismissPageError: vi.fn(),
        emitChatAttention: () => emit("chat-attention"),
        emitProjectAttention: () => emit("project-attention"),
        emptyChatHintText: ref(""),
        emptyCreateAttention: ref(false),
        emptyDashboardContext: ref({}),
        emptyLayoutVisible: ref(false),
        emptyPreviewDetailText: ref(""),
        emptyPreviewTitleText: ref(""),
        emptyStateLoading: ref(false),
        emptyStateStatusText: ref(""),
        pageError: ref(""),
        promptHintPolicy: ref({
          enabled: true,
          ready: true,
          revision: 1,
          version: 1
        }),
        projectPane: computed(() => props.projectPane),
        props,
        resizeChatColumnWithKeyboard: vi.fn(),
        runtimeHostSessionIds: ref(["session-1"]),
        selectedArchive: reactive({}),
        selectedSessionArchiving: ref(false),
        selection: reactive({
          isArchived: false,
          selectedSessionId: "session-1"
        }),
        sessionData: reactive({
          sessionsApiPath: "/api/vibe64/sessions"
        }),
        setRuntimeBusy: vi.fn(),
        setRuntimePageError: vi.fn(),
        setRuntimeToolbarControls: vi.fn(),
        setRuntimeWorkState: vi.fn(),
        startChatColumnResize: vi.fn(),
        toolbar: reactive({ sessions: [] }),
        visiblePageError: ref(false)
      };
    }
  }
);

function projectPage(setChatCollapsed, chatCollapsed) {
  return componentFromSfcTemplate("../../src/pages/app/project/[slug].vue", {
    name: "ProjectPage",
    setup() {
      return {
        chatCollapsed,
        chatToggleIcon: "",
        chatToggleTitle: "Show chat",
        dashboardRouteActive: ref(false),
        emitPageTitle: vi.fn(),
        handleProjectSelectionError: vi.fn(),
        handleProjectSelectionMissing: vi.fn(),
        handleProjectSelectionReady: vi.fn(),
        githubActorHostId: "github-actor",
        mobileProjectAction: ref({ ariaLabel: "", label: "", pane: "preview" }),
        mobileProjectActionVisible: ref(false),
        openProject: vi.fn(),
        pageError: ref(""),
        previewToolbarHostId: "preview-toolbar",
        previewToolbarHostVisible: ref(false),
        previewToolbarTeleportTarget: "#preview-toolbar",
        projectLoadError: ref(""),
        projectPane: ref("preview"),
        projectPaneNavigationVisible: ref(false),
        projectSlug: ref("project-a"),
        projectTabs: [],
        selectProjectPane: vi.fn(),
        setChatCollapsed,
        showProjectPane: vi.fn(),
        switcherProjects: ref([]),
        targetFolderName: ref("Project A")
      };
    }
  });
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ children: [], parent: null, style: {}, text, type: "comment" }),
    createElement: (type) => ({ children: [], parent: null, props: {}, style: {}, type }),
    createText: (text) => ({ children: [], parent: null, style: {}, text, type: "text" }),
    insert(child, parent, anchor = null) {
      child.parent = parent;
      const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1;
      if (anchorIndex >= 0) {
        parent.children.splice(anchorIndex, 0, child);
        return;
      }
      parent.children.push(child);
    },
    nextSibling(node) {
      const index = node.parent?.children?.indexOf(node) ?? -1;
      return index >= 0 ? node.parent.children[index + 1] || null : null;
    },
    parentNode: (node) => node.parent,
    patchProp(node, key, _previous, value) {
      node.props[key] = value;
    },
    remove(node) {
      const index = node.parent?.children?.indexOf(node) ?? -1;
      if (index >= 0) {
        node.parent.children.splice(index, 1);
      }
    },
    setElementText(node, text) {
      node.text = text;
    },
    setText(node, text) {
      node.text = text;
    }
  });
}

function findNode(node, predicate) {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children || []) {
    const match = findNode(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

describe("Vibe64 recovery chat attention", () => {
  it("reveals collapsed chat through the mounted session hierarchy", async () => {
    const chatCollapsed = ref(true);
    const setChatCollapsed = vi.fn((collapsed) => {
      chatCollapsed.value = Boolean(collapsed);
    });
    const container = { children: [], parent: null, style: {}, type: "root" };
    const app = testRenderer().createApp(projectPage(setChatCollapsed, chatCollapsed));
    app.component("ProjectSelectionGate", slotHost("ProjectSelectionGate", {
      projectSelection: { currentProject: { slug: "project-a" } }
    }));
    app.component("RouterView", emptyComponent("RouterView"));
    app.component("StudioAppShellLayout", slotHost("StudioAppShellLayout"));
    app.component("StudioErrorNotice", emptyComponent("StudioErrorNotice"));
    app.component("VAlert", slotHost("VAlert"));
    app.component("VIcon", emptyComponent("VIcon"));
    app.component("Vibe64AuthSettingsButton", emptyComponent("Vibe64AuthSettingsButton"));
    app.component("Vibe64AutopilotView", RecoveryAutopilot);
    app.component("Vibe64CodexSession", emptyComponent("Vibe64CodexSession"));
    app.component("Vibe64CreateSessionButton", emptyComponent("Vibe64CreateSessionButton"));
    app.component("Vibe64SessionRenewalDialog", emptyComponent("Vibe64SessionRenewalDialog"));
    app.component("Vibe64SessionPanel", SessionPanel);
    app.component("Vibe64SessionRuntimeHost", SessionRuntimeHost);
    app.component("Vibe64SessionToolbar", emptyComponent("Vibe64SessionToolbar"));
    app.component("VSkeletonLoader", emptyComponent("VSkeletonLoader"));
    app.component("VSheet", slotHost("VSheet"));
    app.mount(container);
    await nextTick();

    expect(chatCollapsed.value).toBe(true);
    const recoveryAction = findNode(container, (node) => (
      node.props?.["data-test"] === "recovery-action"
    ));
    expect(recoveryAction).not.toBeNull();

    recoveryAction.props.onClick();
    await nextTick();

    expect(setChatCollapsed).toHaveBeenCalledTimes(1);
    expect(setChatCollapsed).toHaveBeenCalledWith(false);
    expect(chatCollapsed.value).toBe(false);

    app.unmount();
  });
});
