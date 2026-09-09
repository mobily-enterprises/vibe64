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
  ref,
  ssrContextKey
} from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const temporaryProvider = vi.hoisted(() => ({ value: null }));

vi.mock("@/composables/useVibe64TemporaryAi.js", () => ({
  TEMPORARY_AI_WORKSPACE_WRITE_POLICY: "workspace_write",
  useVibe64TemporaryAi: () => temporaryProvider.value
}));

vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({
  useUiFeedback: () => ({
    error: vi.fn(),
    success: vi.fn()
  })
}));

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("button", attrs, slots.default?.());
    }
  })
}));

vi.mock("vuetify/components/VIcon", () => ({
  VIcon: defineComponent({ render: () => null })
}));

vi.mock("vuetify/components/VDialog", () => ({
  VDialog: defineComponent({ render: () => null })
}));

vi.mock("vuetify/components/VCard", () => ({
  VCard: defineComponent({ render: () => null }),
  VCardTitle: defineComponent({ render: () => null }),
  VCardText: defineComponent({ render: () => null }),
  VCardActions: defineComponent({ render: () => null })
}));

vi.mock("vuetify/components/VAlert", () => ({
  VAlert: defineComponent({
    inheritAttrs: false,
    props: {
      title: {
        default: "",
        type: String
      }
    },
    setup(componentProps, { attrs, slots }) {
      return () => h("section", attrs, [
        h("strong", componentProps.title),
        ...(slots.default?.() || [])
      ]);
    }
  })
}));

vi.mock("@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue", () => ({
  default: defineComponent({ render: () => null })
}));

vi.mock("@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue", () => ({
  default: defineComponent({ render: () => null })
}));

vi.mock("@/components/studio/vibe64-session/Vibe64ConversationAttachments.vue", () => ({
  default: defineComponent({ render: () => null })
}));

import Vibe64TemporaryAiWorkspace from "../../src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue";
import Vibe64EphemeralConversationMessages from "../../src/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue";

import Vibe64ConversationProgress from "../../src/components/studio/vibe64-session/Vibe64ConversationProgress.vue";
import Vibe64PromptHints from "../../src/components/studio/vibe64-session/Vibe64PromptHints.vue";

for (const [name, component] of [
  ["Vibe64ConversationProgress", Vibe64ConversationProgress],
  ["Vibe64PromptHints", Vibe64PromptHints],
  ["Vibe64TemporaryAiWorkspace", Vibe64TemporaryAiWorkspace],
  ["Vibe64EphemeralConversationMessages", Vibe64EphemeralConversationMessages]
]) {
  const componentPath = path.resolve(`src/components/studio/vibe64-session/${name}.vue`);
  const componentSource = fs.readFileSync(componentPath, "utf8");
  const { descriptor } = parse(componentSource, { filename: componentPath });
  const script = compileScript(descriptor, { id: `${name}-test` });
  const template = compile(descriptor.template.content, {
    bindingMetadata: script.bindings,
    mode: "function",
    prefixIdentifiers: true
  });
  component.render = new Function("Vue", template.code)(VueRuntime);
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function temporaryAiTestState(startResult) {
  const tasks = ref([]);
  const activeTaskId = ref("");
  const open = ref(false);
  return {
    activeTask: computed(() => tasks.value.find((task) => task.id === activeTaskId.value) || null),
    activeTaskId,
    closeTask: vi.fn(),
    closeWorkspace: vi.fn(),
    open,
    openTask: vi.fn(),
    reportRecoveryOutcome: vi.fn((taskId, outcome = {}) => {
      if (!tasks.value.some((task) => task.id === taskId)) {
        return false;
      }
      tasks.value = tasks.value.map((task) => (
        task.id === taskId
          ? {
              ...task,
              recoveryOutcome: outcome.status,
              recoveryOutcomeMessage: outcome.message
            }
          : task
      ));
      return true;
    }),
    selectTask: vi.fn((taskId) => {
      activeTaskId.value = taskId;
      open.value = true;
    }),
    send: vi.fn(),
    showWorkspace: vi.fn(),
    startTask: vi.fn(() => {
      const task = {
        agentSettings: {},
        busy: true,
        draft: "",
        error: "",
        id: "recovery-task",
        messages: [],
        policy: "workspace_write",
        title: "Fix preview"
      };
      tasks.value = [task];
      activeTaskId.value = task.id;
      open.value = true;
      return startResult.promise;
    }),
    stopTask: vi.fn(),
    tasks,
    updateAgentSetting: vi.fn(),
    updateAttachments: vi.fn(),
    updateDraft: vi.fn(),
    updatePolicy: vi.fn()
  };
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ text, type: "comment" }),
    createElement: (type) => ({
      children: [],
      focus: vi.fn(),
      parent: null,
      props: {},
      scrollIntoView: vi.fn(),
      type
    }),
    createText: (text) => ({ text, type: "text" }),
    insert(child, parent, anchor = null) {
      child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) {
        parent.children.push(child);
      } else {
        parent.children.splice(index, 0, child);
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
    remove(child) {
      const index = child.parent?.children?.indexOf(child) ?? -1;
      if (index >= 0) {
        child.parent.children.splice(index, 1);
      }
    },
    setElementText(element, text) {
      element.text = text;
    },
    setText(node, text) {
      node.text = text;
    }
  });
}

function mountWorkspace(container, props) {
  const app = testRenderer().createApp(Vibe64TemporaryAiWorkspace, props);
  app.component("VAlert", defineComponent({
    inheritAttrs: false,
    props: {
      title: {
        default: "",
        type: String
      }
    },
    setup(componentProps, { attrs, slots }) {
      return () => h("section", attrs, [
        h("strong", componentProps.title),
        ...(slots.default?.() || [])
      ]);
    }
  }));
  app.component("VBtn", defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("button", attrs, slots.default?.());
    }
  }));
  app.provide(ssrContextKey, { modules: new Set() });
  return { app, workspace: app.mount(container) };
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

function nodeText(root) {
  return [
    root?.text || "",
    ...(root?.children || []).map((child) => nodeText(child))
  ].filter(Boolean).join(" ");
}

async function flushWorkspaceReveal() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe("Temporary AI recovery workspace accessibility", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      callback();
      return 1;
    });
  });

  afterEach(() => {
    temporaryProvider.value = null;
    vi.unstubAllGlobals();
  });

  it("preserves the main chat's two-update preview and resets completed progress to collapsed", async () => {
    const pending = ref(true);
    const messages = ref([1, 2, 3].map((id) => ({ id: String(id), text: `Progress ${id}.` })));
    const app = testRenderer().createApp(defineComponent({
      setup: () => () => h(Vibe64ConversationProgress, {
        key: pending.value ? "active" : "completed", pending: pending.value, messages: messages.value
      })
    }));
    app.provide(ssrContextKey, { modules: new Set() });
    const container = { children: [], parent: null, type: "root" };
    app.mount(container);
    try {
      expect(nodeText(container)).toBe("Show all 3 progress updates Progress 2. Progress 3.");
      findNode(container, (node) => node.type === "button").props.onClick();
      await nextTick();
      expect(nodeText(container)).toBe("Show latest 2 progress updates Progress 1. Progress 2. Progress 3.");
      pending.value = false;
      await nextTick();
      expect(nodeText(container)).toBe("Show all 3 progress updates");
      findNode(container, (node) => node.type === "button").props.onClick();
      await nextTick();
      expect(nodeText(container)).toBe("Hide progress updates Progress 1. Progress 2. Progress 3.");
    } finally { app.unmount(); }
  });

  it("reveals and focuses the recovery task before its request finishes", async () => {
    const startResult = deferred();
    temporaryProvider.value = temporaryAiTestState(startResult);
    const container = { children: [], parent: null, type: "root" };
    const { app, workspace } = mountWorkspace(container, {
      sessionId: "session-1",
      sessionsApiPath: "/api/vibe64/sessions"
    });

    const started = workspace.startTask({ draft: "Fix the preview" });
    await flushWorkspaceReveal();

    const taskButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-task-id"] === "recovery-task"
    ));
    expect(taskButton).toBeTruthy();
    expect(taskButton.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest"
    });
    expect(taskButton.focus).toHaveBeenCalledWith({ preventScroll: true });

    startResult.resolve({ ok: true, started: true, taskId: "recovery-task" });
    await expect(started).resolves.toMatchObject({ started: true });
    app.unmount();
  });

  it("shows only the repair heading while temporary AI is working", async () => {
    const startResult = deferred();
    const temporary = temporaryAiTestState(startResult);
    temporary.tasks.value = [{
      agentSettings: {},
      busy: true,
      draft: "",
      error: "",
      id: "recovery-task",
      messages: [],
      nextStepMessage: "Vibe64 will verify the repair when the AI finishes.",
      policy: "workspace_write",
      recoveryNotice: "Temporary AI can edit this session in a separate temporary chat.",
      status: "inProgress",
      title: "Fix workspace preparation"
    }];
    temporary.activeTaskId.value = "recovery-task";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const container = { children: [], parent: null, type: "root" };
    const { app } = mountWorkspace(container, {
      sessionId: "session-1",
      sessionsApiPath: "/api/vibe64/sessions"
    });
    await flushWorkspaceReveal();

    const recoveryNotice = findNode(container, (node) => (
      node.props?.["data-temporary-ai-recovery"] === ""
    ));
    expect(recoveryNotice).toBeTruthy();
    expect(recoveryNotice.props.role).toBe("status");
    expect(nodeText(recoveryNotice)).toContain("AI repair in progress");
    expect(nodeText(recoveryNotice)).not.toContain("separate temporary chat");
    expect(nodeText(recoveryNotice)).not.toContain("Vibe64 will verify the repair");
    app.unmount();
  });

  it("keeps thinking in collapsed conversation details and the working status concise", async () => {
    const temporary = temporaryAiTestState(deferred());
    temporary.tasks.value = [{
      agentSettings: {},
      busy: true,
      draft: "",
      error: "",
      id: "recovery-task",
      messages: [
        {
          id: "user-1",
          progressUpdates: [{ id: "user-progress", text: "This is not assistant progress." }],
          role: "user",
          text: "Check this repair."
        },
        {
          id: "assistant-1",
          progressUpdates: [
            { id: "progress-1", text: "Inspecting the conflict." },
            { id: "progress-2", text: "Checking the repair." }
          ],
          role: "assistant",
          status: "inProgress",
          text: ""
        }
      ],
      policy: "workspace_write",
      title: "Fix workspace preparation"
    }];
    temporary.activeTaskId.value = "recovery-task";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const container = { children: [], parent: null, type: "root" };
    const { app } = mountWorkspace(container, {
      sessionId: "session-1",
      sessionsApiPath: "/api/vibe64/sessions"
    });
    try {
      await flushWorkspaceReveal();
      const progress = findNode(container, (node) => (
        node.props?.["aria-label"] === "Temporary AI progress"
      ));
      expect(progress).toBeTruthy();
      expect(nodeText(progress)).toBe("Show all 2 progress updates");
      const toggle = findNode(progress, (node) => node.type === "button");
      expect(toggle.props["aria-expanded"]).toBe(false);
      toggle.props.onClick();
      await nextTick();
      expect(nodeText(progress)).toBe("Hide progress updates Inspecting the conflict. Checking the repair.");
      const activity = findNode(container, (node) => (
        node.props?.class === "vibe64-prompt-hints__assistant-status"
      ));
      expect(nodeText(activity)).toBe("AI is working…");
      expect(findNode(container, (node) => (
        node.props?.role === "status" && nodeText(node) === "AI is working…"
      ))).toBeTruthy();
      expect(findNode(container, (node) => node.type === "span" && nodeText(node) === "Working…")).toBeNull();

      const userMessage = findNode(container, (node) => (
        node.type === "article" && nodeText(node).includes("Check this repair.")
      ));
      expect(userMessage).toBeTruthy();
      expect(findNode(userMessage, (node) => (
        node.props?.["aria-label"] === "Temporary AI progress"
      ))).toBeNull();
      expect(nodeText(container)).not.toContain("This is not assistant progress.");

      temporary.tasks.value[0].messages[1].progressUpdates.push({
        id: "progress-3",
        text: "The repair is ready for verification."
      });
      await nextTick();
      const updatedProgress = findNode(container, (node) => (
        node.props?.["aria-label"] === "Temporary AI progress"
      ));
      expect(nodeText(updatedProgress)).toBe(
        "Hide progress updates Inspecting the conflict. Checking the repair. The repair is ready for verification."
      );
      expect(nodeText(activity)).toBe("AI is working…");
      toggle.props.onClick();
      await nextTick();
      expect(nodeText(updatedProgress)).toBe("Show all 3 progress updates");
      expect(nodeText(container)).not.toContain("This is not assistant progress.");
    } finally {
      app.unmount();
    }
  });

  it("makes independent product verification the recovery headline", async () => {
    const startResult = deferred();
    const temporary = temporaryAiTestState(startResult);
    temporary.tasks.value = [{
      agentSettings: {},
      busy: false,
      draft: "",
      error: "Timed out waiting for the provider response.",
      id: "recovery-task",
      messages: [],
      policy: "workspace_write",
      recoveryNotice: "Temporary AI can edit this session in a separate temporary chat.",
      status: "failed",
      title: "Fix workspace preparation"
    }];
    temporary.activeTaskId.value = "recovery-task";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const container = { children: [], parent: null, type: "root" };
    const { app, workspace } = mountWorkspace(container, {
      sessionId: "session-1",
      sessionsApiPath: "/api/vibe64/sessions"
    });

    expect(workspace.reportTaskRecovery("recovery-task", {
      message: "Workspace preparation succeeded. Vibe64 independently verified the AI repair.",
      status: "succeeded"
    })).toBe(true);
    await flushWorkspaceReveal();

    const recoveryNotice = findNode(container, (node) => (
      node.props?.["data-temporary-ai-recovery"] === ""
    ));
    expect(nodeText(recoveryNotice)).toContain("Repair verified");
    expect(nodeText(recoveryNotice)).toContain("Workspace preparation succeeded");
    expect(nodeText(container)).toContain("The repair was independently verified");
    app.unmount();
  });

  it("keeps Check Update outside the transcript, disables it during work, and shows verified success", async () => {
    const temporary = temporaryAiTestState(deferred());
    temporary.tasks.value = [{
      agentSettings: {}, attachments: [], busy: false, draft: "", error: "", id: "repair",
      messages: [], policy: "workspace_write", recoveryNotice: "Repair this Update.",
      recoveryOperation: "update", outcomeKind: "continue", status: "completed", title: "Resolve Update"
    }];
    temporary.activeTaskId.value = "repair";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const checkUpdate = vi.fn();
    const container = { children: [], parent: null, type: "root" };
    const { app } = mountWorkspace(container, {
      onCheckUpdate: checkUpdate, sessionId: "session-1", sessionsApiPath: "/api/vibe64/sessions"
    });
    try {
      await flushWorkspaceReveal();
      const button = findNode(container, (node) => node.props?.["data-temporary-ai-check-update"] === "");
      const messages = findNode(container, (node) => node.props?.class === "vibe64-temporary-ai__messages");
      expect(button).toBeTruthy();
      expect(findNode(messages, (node) => node === button)).toBeNull();
      expect(button.props.disabled).toBeFalsy();
      expect(nodeText(container)).toContain("Update not yet verified");
      button.props.onClick();
      expect(checkUpdate).toHaveBeenCalledWith(temporary.tasks.value[0]);
      temporary.tasks.value[0].busy = true;
      await nextTick();
      expect(button.props.disabled).toBe(true);
      temporary.tasks.value[0].busy = false;
      temporary.tasks.value[0].recoveryOutcome = "checking";
      await nextTick();
      expect(button.props.disabled).toBe(true);
      expect(nodeText(container)).toContain("Checking Update…");
      temporary.tasks.value[0].recoveryOutcome = "succeeded";
      await nextTick();
      expect(nodeText(container)).toContain("Session updated");
      expect(findNode(container, (node) => node.props?.["data-temporary-ai-check-update"] === "")).toBeNull();
    } finally {
      app.unmount();
    }
  });

  it("scrolls an ordinary newly active task into view without stealing focus", async () => {
    const startResult = deferred();
    const temporary = temporaryAiTestState(startResult);
    temporary.tasks.value = [
      {
        agentSettings: {}, busy: false, draft: "", error: "", id: "first",
        messages: [], policy: "read", title: "First"
      },
      {
        agentSettings: {}, busy: false, draft: "", error: "", id: "second",
        messages: [], policy: "read", title: "Second"
      }
    ];
    temporary.activeTaskId.value = "first";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const container = { children: [], parent: null, type: "root" };
    const { app, workspace } = mountWorkspace(container, {
      sessionId: "session-1",
      sessionsApiPath: "/api/vibe64/sessions"
    });
    await flushWorkspaceReveal();

    const secondTaskButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-task-id"] === "second"
    ));
    secondTaskButton.focus.mockClear();
    secondTaskButton.scrollIntoView.mockClear();

    workspace.showWorkspace();
    await flushWorkspaceReveal();
    const firstTaskButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-task-id"] === "first"
    ));
    expect(firstTaskButton.scrollIntoView).toHaveBeenCalled();
    expect(firstTaskButton.focus).not.toHaveBeenCalled();

    temporary.activeTaskId.value = "second";
    await flushWorkspaceReveal();

    expect(secondTaskButton.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest"
    });
    expect(secondTaskButton.focus).not.toHaveBeenCalled();
    app.unmount();
  });

  it("offers Main chat first without closing or changing temporary tasks", async () => {
    const startResult = deferred();
    const temporary = temporaryAiTestState(startResult);
    temporary.tasks.value = [
      {
        agentSettings: {}, busy: true, draft: "", error: "", id: "first",
        messages: [], policy: "read", title: "First"
      },
      {
        agentSettings: {}, busy: false, draft: "", error: "", id: "second",
        messages: [], policy: "read", title: "Second"
      }
    ];
    temporary.activeTaskId.value = "first";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const selectMainChat = vi.fn();
    const container = { children: [], parent: null, type: "root" };
    const { app } = mountWorkspace(container, {
      onSelectMainChat: selectMainChat,
      sessionId: "session-1",
      sessionsApiPath: "/api/vibe64/sessions"
    });
    await flushWorkspaceReveal();

    const conversationNavigation = findNode(container, (node) => (
      node.props?.["aria-label"] === "Main and temporary conversations"
    ));
    const mainChatButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-main-chat"] === ""
    ));
    const currentTaskButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-task-id"] === "first"
    ));

    expect(conversationNavigation).toBeTruthy();
    expect(mainChatButton).toBeTruthy();
    expect(currentTaskButton.props["aria-current"]).toBe("page");
    mainChatButton.props.onClick();

    expect(selectMainChat).toHaveBeenCalledTimes(1);
    expect(temporary.closeTask).not.toHaveBeenCalled();
    expect(temporary.tasks.value).toHaveLength(2);
    expect(temporary.activeTaskId.value).toBe("first");
    const workspaceComponentSource = fs.readFileSync(
      path.resolve("src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue"),
      "utf8"
    );
    expect(workspaceComponentSource).not.toContain("position: sticky");
    expect(mainChatButton.parent).not.toBe(currentTaskButton.parent.parent);
    app.unmount();
  });
});
