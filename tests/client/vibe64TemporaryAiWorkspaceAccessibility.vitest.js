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
const presenceEvents = vi.hoisted(() => ({ receive: null }));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) { presenceEvents.receive = options.onEvent; },
  useRealtimeSocket: () => ({ on() {}, off() {} })
}));

vi.mock("@/composables/useVibe64TemporaryAi.js", () => ({
  useVibe64TemporaryAi: () => temporaryProvider.value
}));

vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({
  useUiFeedback: () => ({
    error: vi.fn(),
    success: vi.fn()
  })
}));

vi.mock("@/components/studio/vibe64-session/Vibe64ChatModeControls.vue", () => ({
  default: defineComponent({ render: () => null })
}));

vi.mock("vuetify/components/VSkeletonLoader", () => ({ VSkeletonLoader: defineComponent({ render: () => null }) }));

vi.mock("vuetify/components/VSelect", () => ({ VSelect: defineComponent({ render: () => null }) }));

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

import * as SharedConversation from "@jskit-ai/assistant-core/client/conversation";
import { VIBE64_HOST_CONVERSATION_KEY } from "../../src/lib/vibe64AssistantHost.js";
import { createAssistantMessageDelivery } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { AssistantProgress as Vibe64ConversationProgress } from "@jskit-ai/assistant-core/client/conversation";
import { AssistantComposerSupport } from "@jskit-ai/assistant-core/client/conversation";

for (const [name, component] of [
  ...["AssistantConversationElement", "AssistantTranscript", "AssistantProgress", "LongTextPreviewBlocks", "LongTextInlineParts", "AssistantPromptInput", "AssistantComposerActions"].map((name) => [name, SharedConversation[name]]),
  ["AssistantComposerSupport", AssistantComposerSupport],
  ["Vibe64TemporaryAiWorkspace", Vibe64TemporaryAiWorkspace],
  ["Vibe64EphemeralConversationMessages", Vibe64EphemeralConversationMessages]
]) {
  const componentPath = path.resolve(SharedConversation[name]
    ? `node_modules/@jskit-ai/assistant-core/src/client/conversation/${name}.vue`
    : `src/components/studio/vibe64-session/${name}.vue`);
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
    closeTask: vi.fn(async (taskId) => {
      tasks.value = tasks.value.filter((task) => task.id !== taskId);
      activeTaskId.value = tasks.value[0]?.id || "";
      open.value = tasks.value.length > 0;
    }),
    closeWorkspace: vi.fn(),
    open,
    openTask: vi.fn(),
    restoreError: ref(""),
    restoreTasks: vi.fn(),
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
        agentSettings: {}, delivery: createAssistantMessageDelivery(),
        busy: true,
        draft: "",
        error: "",
        id: "recovery-task",
        messages: [],
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

function mountWorkspace(container, props, hostConversation = null) {
  const app = testRenderer().createApp(Vibe64TemporaryAiWorkspace, props);
  if (hostConversation) app.provide(VIBE64_HOST_CONVERSATION_KEY, hostConversation);
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
  for (const name of ["VIcon", "VSelect", "VSkeletonLoader", "VCard", "VCardTitle", "VCardText", "VCardActions", "VDialog", "VChip"]) {
    app.component(name, defineComponent({ setup: (_props, { attrs, slots }) => () => h("div", attrs, slots.default?.()) }));
  }
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

  it("reports selection of temporary and host conversations to Main's companion owner", async () => {
    const temporary = temporaryAiTestState(deferred());
    temporary.open.value = false;
    temporaryProvider.value = temporary;
    const host = ref({ selected: false, label: "Host conversation", component: defineComponent({ render: () => null }) });
    const { app, workspace } = mountWorkspace({ children: [], type: "root" }, { sessionId: "session-1" }, host);
    try {
      expect(workspace.visible).toBe(false);
      temporary.open.value = true;
      expect(workspace.visible).toBe(true);
      temporary.open.value = false;
      host.value.selected = true;
      expect(workspace.visible).toBe(true);
      host.value.selected = false;
      expect(workspace.visible).toBe(false);
    } finally {
      app.unmount();
    }
  });

  it.each([
    ["skipped_incomplete", "Coding stopped. Automatic review was skipped."],
    ["incomplete", "Review stopped before finishing."],
    ["skipped_unconfirmed", "Automatic review skipped: coding completion could not be confirmed."],
    ["cancelled", "Automatic review cancelled."],
    ["skipped_question", "Waiting for your answer. Automatic review was skipped."]
  ])("does not restore a permanent banner for %s review status", async (reviewStatus, message) => {
    const temporary = temporaryAiTestState(deferred());
    const request = { status: "done", reviewStatus, messageId: "request-1", resolvedMode: "junior" };
    temporary.tasks.value = [{
      id: "chat", conversationId: "chat", agentSettings: {}, delivery: createAssistantMessageDelivery(),
      busy: false, draft: "My next question", error: "", messages: [], title: "Temporary 1",
      routingMetadata: { assistant_routing_request: JSON.stringify(request) }
    }];
    temporary.activeTaskId.value = "chat";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const container = { children: [], type: "root" };
    const { app } = mountWorkspace(container, { active: true, sessionId: "session-1" });
    try {
      await flushWorkspaceReveal();
      const notice = findNode(container, (node) => node.props?.role === "status" && nodeText(node).includes(message));
      expect(notice).toBeFalsy();
      expect(temporary.send).not.toHaveBeenCalled();
      expect(temporary.tasks.value[0].draft).toBe("My next question");
      temporary.tasks.value[0].routingMetadata.assistant_routing_request = JSON.stringify({ ...request, reviewStatus: "completed" });
      await nextTick();
      expect(nodeText(container)).not.toContain(message);
      expect(nodeText(container)).not.toContain("Review finished");
    } finally { app.unmount(); }
  });

  it("uses the shared status for typing only in the visible temporary conversation", async () => {
    const temporary = temporaryAiTestState(deferred());
    temporaryProvider.value = temporary;
    temporary.tasks.value = ["one", "two"].map((id) => ({
      id, conversationId: id, agentSettings: {}, delivery: createAssistantMessageDelivery(), busy: false, draft: "", error: "", messages: [], title: id
    }));
    temporary.activeTaskId.value = "one";
    temporary.open.value = true;
    const container = { children: [], type: "root" };
    const { app } = mountWorkspace(container, {
      active: true, projectSlug: "beepollen", sessionId: "session-1", sessionsApiPath: "/api/vibe64/sessions"
    });
    const payload = {
      actorId: "member", displayName: "John", originId: "other-tab", projectSlug: "beepollen",
      sessionId: "session-1", conversationId: "two", typing: true, sequence: 1,
      updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3000).toISOString()
    };
    try {
      presenceEvents.receive({ payload });
      await nextTick();
      expect(nodeText(container)).not.toContain("John is typing");
      presenceEvents.receive({ payload: { ...payload, conversationId: "one" } });
      await nextTick();
      expect(nodeText(container)).toContain("John is typing…");
      temporary.selectTask("two");
      await nextTick();
      expect(nodeText(container)).not.toContain("John is typing");
      presenceEvents.receive({ payload });
      await nextTick();
      expect(nodeText(container)).toContain("John is typing…");
      temporary.tasks.value[1].busy = true;
      await nextTick();
      expect(nodeText(container)).toContain("AI is working…");
      expect(nodeText(container)).not.toContain("John is typing");
    } finally {
      app.unmount();
    }
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
      agentSettings: {}, delivery: createAssistantMessageDelivery(),
      busy: true,
      draft: "",
      error: "",
      id: "recovery-task",
      messages: [],
      nextStepMessage: "Vibe64 will verify the repair when the AI finishes.",
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

  it("returns to Main chat after closing only the completed repair, and retains the chat if closing fails", async () => {
    const temporary = temporaryAiTestState(deferred());
    temporary.tasks.value = [{
      agentSettings: {}, delivery: createAssistantMessageDelivery(), busy: false, draft: "", error: "", id: "repair",
      messages: [
        { id: "recovery_repair", role: "system", text: "Session updated. Your changes were preserved. Nothing was published." }
      ],
      recoveryNotice: "Review the repair.",
      recoveryOperation: "update", recoveryOutcome: "succeeded",
      status: "completed", title: "Resolve Update"
    }];
    temporary.activeTaskId.value = "repair";
    temporary.open.value = true;
    temporary.tasks.value.push({
      agentSettings: {}, delivery: createAssistantMessageDelivery(), busy: false, draft: "Keep this other draft.", id: "other",
      messages: [], title: "Other task"
    });
    temporaryProvider.value = temporary;
    const selectMainChat = vi.fn();
    const container = { children: [], parent: null, type: "root" };
    const { app } = mountWorkspace(container, {
      onSelectMainChat: selectMainChat, sessionId: "session-1", workspaceSetupStatus: "succeeded"
    });
    try {
      await flushWorkspaceReveal();
      expect(findNode(container, (node) => node.props?.["data-temporary-ai-recovery"] === "")).toBeNull();
      const message = findNode(container, (node) => node.type === "article" && nodeText(node).includes("Session updated"));
      expect(nodeText(findNode(message, (node) => node.props?.class === "assistant-transcript__system-meta"))).toContain("System");
      expect(nodeText(findNode(message, (node) => node.type === "p"))).toBe(
        "Session updated and workspace ready. Your changes were preserved. Nothing was published."
      );
      expect(nodeText(container).match(/Session updated/gu)).toHaveLength(1);
      const button = findNode(message, (node) => node.type === "button" && nodeText(node).trim() === "Return to main chat");
      expect(button).toBeTruthy();
      temporary.closeTask.mockRejectedValueOnce(new Error("Could not close the chat."));
      await button.props.onClick();
      await nextTick();
      expect(nodeText(container)).toContain("Could not close the chat.");
      expect(selectMainChat).not.toHaveBeenCalled();
      expect(temporary.tasks.value).toHaveLength(2);
      await button.props.onClick();
      await nextTick();
      expect(temporary.closeTask).toHaveBeenLastCalledWith("repair");
      expect(selectMainChat).toHaveBeenCalledOnce();
      expect(temporary.tasks.value).toHaveLength(1);
      expect(temporary.tasks.value[0]).toMatchObject({ id: "other", draft: "Keep this other draft." });
    } finally {
      app.unmount();
    }
  });

  it.each([
    ["running", "Session updated. Preparing workspace…", false],
    ["failed", "Workspace preparation failed", false],
    ["ambiguous", "Workspace preparation needs a choice", false],
    ["required", "Workspace preparation is still required", false],
    ["unconfigured", "Session updated.", true],
    ["", "Session updated.", false]
  ])("reports preparation status %s without claiming readiness", async (status, text, canReturn) => {
    const temporary = temporaryAiTestState(deferred());
    temporary.tasks.value = [{
      agentSettings: {}, delivery: createAssistantMessageDelivery(), busy: false, draft: "", error: "", id: "repair", runId: "latest",
      messages: [
        { id: "recovery_earlier", role: "system", text: "Earlier repair verified." },
        { id: "recovery_latest", role: "system", text: "Session updated." }
      ],
      recoveryOperation: "update", recoveryOutcome: "succeeded", status: "completed",
      title: "Resolve Update"
    }];
    temporary.activeTaskId.value = "repair";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const container = { children: [], parent: null, type: "root" };
    const { app } = mountWorkspace(container, { sessionId: "session-1", workspaceSetupStatus: status });
    try {
      await flushWorkspaceReveal();
      expect(nodeText(container)).toContain(text);
      expect(nodeText(container)).toContain("Earlier repair verified.");
      expect(nodeText(container)).not.toContain("workspace ready");
      const button = findNode(container, (node) => node.type === "button" && nodeText(node).trim() === "Return to main chat");
      expect(Boolean(button)).toBe(canReturn);
      expect(temporary.closeTask).not.toHaveBeenCalled();
    } finally {
      app.unmount();
    }
  });

  it("keeps thinking in collapsed conversation details and the working status concise", async () => {
    const temporary = temporaryAiTestState(deferred());
    temporary.tasks.value = [{
      agentSettings: {}, delivery: createAssistantMessageDelivery(),
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
        node.props?.class === "assistant-composer-support__assistant-status"
      ));
      expect(nodeText(activity)).toBe("AI is working…");
      expect(findNode(container, (node) => (
        node.props?.role === "status" && nodeText(node) === "AI is working…"
      ))).toBeTruthy();
      expect(findNode(container, (node) => node.type === "span" && nodeText(node) === "Working…")).toBeNull();

      const userMessage = findNode(container, (node) => (
        String(node.props?.class || "").split(" ").includes("assistant-transcript__message--user") && nodeText(node).includes("Check this repair.")
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

  it("dismisses the repair panel after independent verification despite an earlier provider error", async () => {
    const startResult = deferred();
    const temporary = temporaryAiTestState(startResult);
    temporary.tasks.value = [{
      agentSettings: {}, delivery: createAssistantMessageDelivery(),
      busy: false,
      draft: "",
      error: "Timed out waiting for the provider response.",
      id: "recovery-task",
      messages: [],
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
    expect(recoveryNotice).toBeNull();
    expect(nodeText(container)).toContain("The repair was independently verified");
    app.unmount();
  });

  it("keeps Check Update outside the transcript, disables it during work, and removes it after success", async () => {
    const temporary = temporaryAiTestState(deferred());
    temporary.tasks.value = [{
      agentSettings: {}, delivery: createAssistantMessageDelivery(), attachments: [], busy: false, draft: "", error: "", id: "repair",
      messages: [], recoveryNotice: "Repair this Update.",
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
      const messages = findNode(container, (node) => String(node.props?.class || "").split(" ").includes("assistant-transcript__body"));
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
      expect(findNode(container, (node) => node.props?.["data-temporary-ai-recovery"] === "")).toBeNull();
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
        agentSettings: {}, delivery: createAssistantMessageDelivery(), busy: false, draft: "", error: "", id: "first",
        messages: [], title: "First"
      },
      {
        agentSettings: {}, delivery: createAssistantMessageDelivery(), busy: false, draft: "", error: "", id: "second",
        messages: [], title: "Second"
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
        agentSettings: {}, delivery: createAssistantMessageDelivery(), busy: true, draft: "", error: "", id: "first",
        messages: [], title: "First"
      },
      {
        agentSettings: {}, delivery: createAssistantMessageDelivery(), busy: false, draft: "", error: "", id: "second",
        messages: [], title: "Second"
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
