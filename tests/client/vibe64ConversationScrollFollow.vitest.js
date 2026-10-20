import fs from "node:fs";
import path from "node:path";

import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  ref,
  ssrContextKey
} from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const messageSessionLists = VueRuntime.ref({});
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({ api: (suffix, { params }) => `/api/app/${params.slug}${suffix}` })
}));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: ({ path }) => ({ data: VueRuntime.computed(() => messageSessionLists.value[path.value]) })
}));

vi.mock("vuetify/components/VAlert", () => ({
  VAlert: passthroughComponent()
}));

vi.mock("vuetify/components/VSelect", () => ({ VSelect: defineComponent({ render: () => null }) }));

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));

vi.mock("vuetify/components/VIcon", () => ({
  VIcon: passthroughComponent("span")
}));
vi.mock("vuetify/components/VCard", () => ({
  VCard: passthroughComponent(), VCardText: passthroughComponent(), VCardActions: passthroughComponent()
}));

vi.mock("vuetify/components/VSkeletonLoader", () => ({
  VSkeletonLoader: passthroughComponent()
}));

vi.mock("@/components/studio/vibe64-session/Vibe64AttachmentDialog.vue", () => ({
  default: defineComponent({ render: () => null })
}));

import * as SharedConversation from "@jskit-ai/assistant-core/client/conversation";
import Vibe64ConversationLog from "../../src/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import Vibe64ConversationAttachments from "../../src/components/studio/vibe64-session/Vibe64ConversationAttachments.vue";

import { createAssistantMessageDelivery } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";
import { chatTurnsWithRouting } from "../../src/lib/vibe64ChatDelivery.js";
import { assistantModePrompt } from "@local/vibe64-runtime/shared/assistantRouting";
import Vibe64ConversationStatus from "../../src/components/studio/vibe64-session/Vibe64ConversationStatus.vue";
import Vibe64ProjectMessage from "../../src/components/studio/vibe64-session/Vibe64ProjectMessage.vue";
import Vibe64EphemeralConversationMessages from "../../src/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue";

Object.assign(SharedConversation.LongTextPreviewBlocks, {
  inheritAttrs: false,
  setup(props, { attrs }) {
    return () => h("span", { ...attrs, ...props });
  }
});

function attachClientRender(component, sourcePath, id) {
  const componentPath = component.__file || path.resolve(sourcePath);
  const componentSource = fs.readFileSync(componentPath, "utf8");
  const { descriptor } = parse(componentSource, {
    filename: componentPath
  });
  const componentScript = compileScript(descriptor, { id });
  const componentTemplate = compile(descriptor.template.content, {
    bindingMetadata: componentScript.bindings,
    mode: "function",
    prefixIdentifiers: true
  });
  component.render = new Function("Vue", componentTemplate.code)(VueRuntime);
}

for (const name of [
  "AssistantConversationElement",
  "AssistantConversationStatus",
  "AssistantTranscript",
  "AssistantProgress",
  "AssistantComposerSupport",
  "AssistantMessageAttachments",
  "LongTextInlineParts",
  "AssistantPromptInput",
  "AssistantComposerActions"
]) {
  attachClientRender(SharedConversation[name], `node_modules/@jskit-ai/assistant-core/src/client/conversation/${name}.vue`, `${name}-test`);
}

attachClientRender(
  Vibe64ConversationLog,
  "src/components/studio/vibe64-session/Vibe64ConversationLog.vue",
  "vibe64-conversation-scroll-follow-test"
);
attachClientRender(
  Vibe64ConversationAttachments,
  "src/components/studio/vibe64-session/Vibe64ConversationAttachments.vue",
  "vibe64-conversation-attachments-test"
);

for (const component of [Vibe64ConversationStatus, Vibe64ProjectMessage, Vibe64EphemeralConversationMessages]) {
  attachClientRender(component, `src/components/studio/vibe64-session/${component.__name}.vue`, `${component.__name}-test`);
}

function passthroughComponent(element = "div") {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

function createHostElement(type) {
  let scrollTop = 0;
  const element = {
    children: [],
    clientHeight: 240,
    focus: vi.fn(),
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => [],
    parent: null,
    props: {},
    scrollHeight: 1_200,
    scrollWrites: [],
    style: {},
    type
  };
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get() {
      return scrollTop;
    },
    set(value) {
      scrollTop = Number(value);
      element.scrollWrites.push(scrollTop);
    }
  });
  return element;
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ children: [], props: {}, text, type: "comment" }),
    createElement: createHostElement,
    createText: (text) => ({ children: [], props: {}, text, type: "text" }),
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

function nodeText(node) {
  return [node.text || "", ...(node.children || []).map(nodeText)].join("");
}

function userTurn(id, text = `User ${id}`, attachments = []) {
  return {
    turnId: id,
    user: {
      ...(attachments.length ? { attachments } : {}),
      at: "2026-08-24T10:00:00.000Z",
      messageId: `${id}-user`,
      role: "user",
      text
    }
  };
}

function agentTurn(id, text = `Assistant ${id}`) {
  return {
    ...userTurn(id),
    messages: [{
      at: "2026-08-24T10:00:01.000Z",
      messageId: `${id}-assistant`,
      role: "assistant",
      text
    }]
  };
}

function mountConversation({
  integrationRequestsEnabled = false,
  error = "",
  followLatestKey = 0,
  hasMoreBefore = false,
  turns = [agentTurn("turn-1")]
} = {}) {
  const loadMoreRequests = [];
  const integrationRequests = [];
  const integrationSkips = [];
  const integrationResumes = [];
  const integrationChecks = [];
  const state = {
    assistantLabel: ref("Codex"),
    error: ref(error),
    followLatestKey: ref(followLatestKey),
    hasMoreBefore: ref(hasMoreBefore),
    scrollKey: ref("session-1"),
    visible: ref(true),
    turns: ref(turns)
  };
  const Root = defineComponent({
    setup() {
      return () => h(Vibe64ConversationLog, {
        assistantLabel: state.assistantLabel.value,
        sessionId: state.scrollKey.value,
        integrationRequestsEnabled,
        onSkipIntegration: (request) => integrationSkips.push(request),
        onCheckIntegration: (request) => integrationChecks.push(request),
        onResumeIntegration: (request) => integrationResumes.push(request),
        onOpenIntegration: (request) => integrationRequests.push(request),
        error: state.error.value,
        followLatestKey: state.followLatestKey.value,
        hasMoreBefore: state.hasMoreBefore.value,
        onLoadMore: (request) => loadMoreRequests.push(request),
        scrollKey: state.scrollKey.value,
        turns: state.turns.value,
        visible: state.visible.value
      });
    }
  });
  const container = { children: [], parent: null, props: {}, type: "root" };
  const app = testRenderer().createApp(Root);
  app.component("VAlert", passthroughComponent());
  app.component("VBtn", passthroughComponent("button"));
  app.component("VIcon", passthroughComponent("span"));
  app.component("VSelect", passthroughComponent());
  app.component("VCard", passthroughComponent());
  app.component("VCardText", passthroughComponent());
  app.component("VCardActions", passthroughComponent());
  app.component("VSkeletonLoader", passthroughComponent());
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(container);
  return { app, container, integrationChecks, integrationSkips, integrationResumes, integrationRequests, loadMoreRequests, state };
}

function conversationBody(container) {
  return findNode(container, (node) => String(node.props?.class || "")
    .split(" ")
    .includes("assistant-transcript__body"));
}

function loadOlderButton(container) {
  return findNode(container, (node) => (
    node.type === "button" && nodeText(node).includes("Load older messages")
  ));
}

function nodeHasClass(node, className) {
  return String(node?.props?.class || "").split(" ").includes(className);
}

function userPromptContent(container) {
  return findNode(container, (node) => nodeHasClass(node, "assistant-transcript__user-content"));
}

function renderedUserPromptBlocks(container) {
  return findNode(
    userPromptContent(container),
    (node) => Array.isArray(node.props?.blocks)
  )?.props.blocks || [];
}

function userPromptToggle(container) {
  return findNode(container, (node) => (
    node.type === "button" && nodeHasClass(node, "assistant-transcript__user-content-toggle")
  ));
}

describe("Vibe64 conversation scroll following", () => {
  let animationFrames;
  let nextAnimationFrameId;
  let originalWindowDescriptor;

  beforeEach(() => {
    messageSessionLists.value = {};
    vi.useFakeTimers();
    animationFrames = new Map();
    nextAnimationFrameId = 1;
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        cancelAnimationFrame(id) {
          animationFrames.delete(id);
        },
        clearTimeout,
        requestAnimationFrame(callback) {
          const id = nextAnimationFrameId;
          nextAnimationFrameId += 1;
          animationFrames.set(id, callback);
          return id;
        },
        setTimeout
      }
    });
  });

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      delete globalThis.window;
    }
    vi.useRealTimers();
  });

  it("shows a goal objective without generated role instructions while retaining authored text and history", async () => {
    for (const mode of ["custom", "senior", "junior"]) {
      const objective = "Finish the remaining checks.\n\nKeep the results in the report.";
      const nativeText = `/goal ${assistantModePrompt(mode, objective)}`;
      const turn = userTurn("goal", nativeText);
      const mounted = mountConversation({ turns: [turn] });
      await nextTick();
      expect(JSON.stringify(renderedUserPromptBlocks(mounted.container))).toContain("Finish the remaining checks.");
      expect(JSON.stringify(renderedUserPromptBlocks(mounted.container))).not.toContain("Vibe64 role:");
      expect(turn.user.text).toBe(nativeText);

      const authored = "/goal [Vibe64 role: Junior]\n\nKeep this example verbatim.";
      mounted.state.turns.value = [userTurn("authored", authored)];
      await nextTick();
      expect(JSON.stringify(renderedUserPromptBlocks(mounted.container))).toContain("Vibe64 role: Junior");
      expect(JSON.stringify(renderedUserPromptBlocks(mounted.container))).toContain("Keep this example verbatim.");
      mounted.app.unmount();
    }
  });

  it("hides delivered Claude goal commands and confirmations while retaining work, failed controls and native history", async () => {
    const objective = "Finish the remaining checks.";
    for (const mode of ["custom", "senior", "junior"]) {
      for (const prefix of ["Goal set: ", "Goal cleared: ", "Goal active: "]) {
        const command = prefix === "Goal cleared: " ? "/goal clear" : `/goal ${assistantModePrompt(mode, objective)}`;
        const confirmation = { messageId: "claude_8d9f8b5f-81a2-4a08-a0ee-bf2e0ed1160b_0", role: "assistant",
          text: prefix + assistantModePrompt(mode, objective), complete: true };
        const work = { role: "commentary", messageId: "work", text: "I am checking the next item.", complete: true };
        const turn = { ...userTurn("goal", command), metadata: { engineId: "claude", upstreamMessageId: "native-goal" },
          messages: [confirmation, work] };
        const original = JSON.stringify(turn);
        const mounted = mountConversation({ turns: [turn] });
        await nextTick();
        const transcript = () => findNode(mounted.container, node => Array.isArray(node.props?.blocks))?.props.blocks;
        expect(JSON.stringify(transcript())).toContain(work.text);
        expect(JSON.stringify(transcript())).not.toContain("/goal");
        expect(JSON.stringify(transcript())).not.toContain(prefix);
        expect(JSON.stringify(turn)).toBe(original);
        // Reloaded canonical rows and legacy separate commentary arrays use the same projection.
        mounted.state.turns.value = [{ ...structuredClone(turn), messages: undefined,
          assistant: work, commentary: [{ ...confirmation, role: "commentary" }] }];
        await nextTick();
        expect(JSON.stringify(transcript())).toContain(work.text);
        expect(JSON.stringify(transcript())).not.toContain(prefix);
        mounted.app.unmount();
      }
    }
    for (const status of ["pending", "failed", "uncertain"]) {
      const turn = { ...userTurn("retry", `/goal ${assistantModePrompt("junior", objective)}`),
        metadata: { engineId: "claude", upstreamMessageId: "native-goal" }, optimistic: { id: "retry-user", status } };
      const mounted = mountConversation({ turns: [turn] });
      await nextTick();
      expect(JSON.stringify(renderedUserPromptBlocks(mounted.container))).toContain(`/goal ${objective}`);
      expect(JSON.stringify(renderedUserPromptBlocks(mounted.container))).not.toContain("Vibe64 role:");
      mounted.app.unmount();
    }
  });

  it("keeps ordinary assistant goal prose and authored examples while hiding proven native command outputs", async () => {
    const protocols = [
      { engineId: "claude", type: "system", subtype: "local_command_output" },
      { engineId: "claude", type: "system", subtype: "local_command", command: "goal", output: "stdout" },
      { engineId: "claude", type: "assistant", command: "goal", output: "stdout" },
      { engineId: "claude", type: "result", command: "goal", output: "stdout" }
    ];
    const prose = "Goal set: smash every remaining item. I will work in order.";
    for (const native of protocols) for (const text of ["Goal set: Finish checks", "Goal cleared: Finish checks", "Goal active: Finish checks (1 turn)", "No goal set"]) {
      const turn = { ...userTurn("normal", "Explain how /goal clear works."), metadata: { engineId: "claude", upstreamMessageId: "native-user" },
        messages: [{ role: "commentary", text, messageId: "native-output", data: { native } },
          { role: "assistant", text: prose, messageId: "genuine-reply" }] };
      const mounted = mountConversation({ turns: [turn] });
      await nextTick();
      expect(JSON.stringify(renderedUserPromptBlocks(mounted.container))).toContain("Explain how /goal clear works.");
      const assistant = findNode(mounted.container, node => Array.isArray(node.props?.blocks) && JSON.stringify(node.props.blocks).includes(prose));
      expect(assistant).not.toBeNull();
      expect(findNode(mounted.container, node => Array.isArray(node.props?.blocks) && JSON.stringify(node.props.blocks).includes(text))).toBeNull();
      mounted.app.unmount();
    }
  });

  async function flushScrollWork() {
    await nextTick();
    await Promise.resolve();
    const frames = [...animationFrames.values()];
    animationFrames.clear();
    frames.forEach((callback) => callback());
    await Promise.resolve();
    vi.runAllTimers();
    await nextTick();
  }

  it.each(["main", "temporary"])("shows only model updates, including when expanded, in %s chat", async (surface) => {
    const selection = { engineId: "codex", modelProviderId: "deepseek", modelId: "deepseek-flash", variantId: "max" };
    const messages = ref([{ messageId: "detail-1", role: "thinking", text: "Raw reasoning before the update." }]);
    const working = ref(true);
    const app = testRenderer().createApp({ render: () => surface === "main"
      ? h(Vibe64ConversationLog, {
        visible: true,
        working: working.value,
        turns: [{ turnId: "turn-1", metadata: { assistantSelection: selection }, messages: messages.value }]
      })
      : h(Vibe64EphemeralConversationMessages, {
        working: working.value,
        adapter: { conversation: { turns: [{
          turnId: "turn-1", metadata: { assistantSelection: selection }, messages: messages.value
        }] } }
      })
    });
    for (const name of ["VAlert", "VIcon", "VSelect", "VCard", "VCardText", "VCardActions", "VSkeletonLoader"]) {
      app.component(name, passthroughComponent());
    }
    app.component("VBtn", passthroughComponent("button"));
    app.provide(ssrContextKey, { modules: new Set() });
    const container = createHostElement("root");
    app.mount(container);
    try {
      await flushScrollWork();
      expect(nodeText(container)).not.toContain("Raw reasoning");
      expect(nodeText(container)).not.toContain("progress update");
      messages.value.push(
        { messageId: "comment-1", role: "commentary", text: "Checking the sources." },
        { messageId: "comment-2", role: "commentary", text: "Comparing the latest figures." },
        { messageId: "detail-2", role: "thinking", text: "Raw reasoning after the update." }
      );
      await flushScrollWork();
      expect(nodeText(container)).toContain("Comparing the latest figures.");
      expect(nodeText(container)).not.toContain("Checking the sources.");
      expect(nodeText(container)).not.toContain("Raw reasoning");
      expect(findNode(container, (node) => node.props?.["data-message-role"] === "commentary")).toBeNull();
      const toggle = () => findNode(container, (node) => nodeHasClass(node, "assistant-progress__toggle"));
      toggle().props.onClick();
      await flushScrollWork();
      expect(nodeText(container)).toContain("Checking the sources.");
      expect(nodeText(container)).not.toContain("Raw reasoning");
      toggle().props.onClick();
      messages.value.push({ messageId: "answer", role: "assistant", text: "The final answer." });
      working.value = false;
      await flushScrollWork();
      expect(nodeText(container)).not.toContain("Raw reasoning");
      expect(nodeText(container)).not.toContain("Checking the sources.");
      const answerRow = findNode(container, (node) => node.props?.["data-message-role"] === "assistant");
      expect(answerRow).not.toBeNull();
      expect(JSON.stringify(findNode(answerRow, (node) => Array.isArray(node.props?.blocks))?.props.blocks)).toContain("The final answer.");
      toggle().props.onClick();
      await flushScrollWork();
      expect(nodeText(container)).toContain("Checking the sources.");
      expect(nodeText(container)).not.toContain("Raw reasoning");
    } finally {
      app.unmount();
    }
  });

  it.each(["main", "temporary"])("interleaves saved %s user messages and native replies by time, including steers inside one native turn", async (surface) => {
    const at = minute => `2026-10-13T06:${minute}:00.000Z`;
    const user = (id, minute) => ({ turnId: id, user: { messageId: id, role: "user", text: id, at: at(minute) } });
    const reply = (id, minute) => ({ messageId: id, role: "assistant", text: id, at: at(minute) });
    const turns = ref([user("first-question", "29"), user("steering-question", "33"), user("last-question", "39"),
      { turnId: "native-turn", messages: [reply("first-reply", "32"), reply("second-reply", "38")] }]);
    const app = testRenderer().createApp({ render: () => surface === "main"
      ? h(Vibe64ConversationLog, { visible: true, turns: turns.value })
      : h(Vibe64EphemeralConversationMessages, { adapter: { conversation: { turns: turns.value } } }) });
    for (const name of ["VAlert", "VIcon", "VCard", "VCardText", "VCardActions", "VSkeletonLoader"]) app.component(name, passthroughComponent());
    app.component("VBtn", passthroughComponent("button"));
    app.provide(ssrContextKey, { modules: new Set() });
    const container = createHostElement("root");
    app.mount(container);
    const order = () => {
      const rows = [];
      function visit(node) {
        if (node.type === "article") {
          const user = findNode(node, item => nodeHasClass(item, "assistant-transcript__plain-user"));
          rows.push(user ? nodeText(user) : JSON.stringify(findNode(node, item => Array.isArray(item.props?.blocks))?.props.blocks));
        } else for (const child of node.children || []) visit(child);
      }
      visit(container);
      return rows.map(row => ["first-question", "steering-question", "last-question", "first-reply", "second-reply", "last-reply"].find(id => row?.includes(id)));
    };
    try {
      await flushScrollWork();
      expect(order()).toEqual(["first-question", "first-reply", "steering-question", "second-reply", "last-question"]);
      turns.value[3].messages.push(reply("last-reply", "40"));
      await flushScrollWork();
      expect(order()).toEqual(["first-question", "first-reply", "steering-question", "second-reply", "last-question", "last-reply"]);
      expect(turns.value.map(turn => turn.turnId)).toEqual(["first-question", "steering-question", "last-question", "native-turn"]);
    } finally { app.unmount(); }
  });

  it.each(["main", "temporary"])("renders sending and unconfirmed delivery accurately in %s chat", async (surface) => {
    const delivery = createAssistantMessageDelivery();
    const response = Promise.withResolvers();
    const sending = delivery.send({ message: "Hello" }, { messageId: "message-1", deliver: () => response.promise });
    const route = ref({ schemaVersion: 5, messageId: "message-1", status: "working", delivery: "sending", attemptedMessageId: "message-1", input: { message: "Hello" }, assignments: {} });
    const messages = ref([]);
    const checks = [];
    const cancellations = [];
    const app = testRenderer().createApp({ render: () => surface === "main"
      ? h(Vibe64ConversationLog, {
        visible: true, turns: chatTurnsWithRouting(delivery.turns(messages.value), route.value),
        onResendTurn: (id) => checks.push(id), onCancelTurn: id => cancellations.push(id)
      })
      : h(Vibe64EphemeralConversationMessages, {
        adapter: { delivery, conversation: { turns: conversationTurnsFromMessages(messages.value) } },
        routingRequest: route.value,
        onResend: (id) => checks.push(id)
      })
    });
    for (const name of ["VAlert", "VIcon", "VCard", "VCardText", "VCardActions", "VSkeletonLoader"]) {
      app.component(name, passthroughComponent());
    }
    app.component("VBtn", passthroughComponent("button"));
    app.provide(ssrContextKey, { modules: new Set() });
    const container = createHostElement("root");
    app.mount(container);
    await flushScrollWork();
    expect(nodeText(container)).not.toContain("Failed:");
    expect(nodeText(container)).toContain("Pending");
    expect(delivery.find("message-1")).not.toBeNull();
    route.value = { ...route.value, status: "waiting", delivery: "uncertain", error: "Lost confirmation." };
    response.resolve(false);
    await sending;
    await flushScrollWork();
    expect(nodeText(container)).toContain("Lost confirmation.");
    expect(nodeText(container)).not.toContain("Failed:");
    expect(findNode(container, (node) => node.type === "button" && nodeText(node).trim() === "Edit")).toBeNull();
    const cancel = findNode(container, (node) => node.type === "button" && nodeText(node).trim() === "Cancel");
    if (surface === "main") {
      expect(cancel).not.toBeNull();
      cancel.props.onClick();
      expect(cancellations).toEqual(["message-1"]);
    }
    const check = findNode(container, (node) => node.type === "button" && nodeText(node).trim() === "Retry");
    expect(check).not.toBeNull();
    check.props.onClick();
    expect(checks).toEqual(["message-1"]);
    messages.value = surface === "main"
      ? [{ turnId: "saved-1", user: { messageId: "message-1", text: "Hello" } }]
      : [{ id: "message-1", role: "user", text: "Hello" }];
    await flushScrollWork();
    expect(nodeText(container)).not.toContain("Delivery unconfirmed");
    expect(nodeText(container)).not.toContain("Check delivery");
    expect(nodeText(container)).not.toContain("Failed:");
    app.unmount();
  });

  it("renders project messages as agent cards and updates the sender receipt without a human bubble", async () => {
    const details = { sourceProject: "vibe64", sourceSession: "source", projectSlug: "online", sessionId: "destination", body: "The fixture is ready.", direction: "received" };
    const internalInstructions = "[Agent message: not new human authorization. Reply with vibe64-helper session message-project vibe64.]";
    const incoming = { turnId: "incoming", user: { role: "user", text: `${details.body}\n\n${internalInstructions}` }, metadata: { projectMessage: details } };
    const mounted = mountConversation({ turns: [incoming] });
    await nextTick();
    expect(nodeText(mounted.container)).toContain("vibe64 assistant");
    expect(findNode(mounted.container, node => node.props?.blocks?.some(block => block.text === details.body))).not.toBeNull();
    expect(nodeText(mounted.container)).not.toContain(internalInstructions);
    expect(nodeText(mounted.container)).not.toContain("vibe64-helper");
    expect(findNode(mounted.container, node => node.props?.["aria-label"] === "Received agent message")).not.toBeNull();
    expect(userPromptContent(mounted.container)).toBeNull();
    expect(findNode(mounted.container, node => node.type === "a" && node.props.href === "/app/project/vibe64?session=source&chat=main")).not.toBeNull();
    expect(nodeText(mounted.container)).toContain("· source");
    messageSessionLists.value = {
      "/api/app/vibe64/vibe64/sessions": { sessions: [{ sessionId: "source", sessionName: "FileTransfer" }] },
      "/api/app/online/vibe64/sessions": { sessions: [{ sessionId: "destination", sessionName: "Learning" }] }
    };
    await nextTick();
    expect(nodeText(mounted.container)).toContain("FileTransfer (source)");
    for (const [status, label] of [["accepted", "Accepted · delivery not confirmed"], ["delivered", "Delivered to assistant"], ["failed", "Delivery failed"]]) {
      mounted.state.turns.value = [{ turnId: "outgoing", system: { role: "system", text: details.body },
        metadata: { projectMessage: { ...details, direction: "sent", status } } }];
      await nextTick();
      expect(nodeText(mounted.container)).toContain(label);
      expect(nodeText(mounted.container)).toContain("Learning (destination)");
      expect(findNode(mounted.container, node => node.props?.["aria-label"] === "Sent agent message")).not.toBeNull();
      expect(findNode(mounted.container, node => node.type === "a" && node.props.href === "/app/project/online?session=destination&chat=main")).not.toBeNull();
    }
    messageSessionLists.value = {};
    await nextTick();
    expect(nodeText(mounted.container)).toContain("· destination");
    expect(nodeText(mounted.container)).not.toContain("Learning (destination)");
    mounted.app.unmount();
  });

  it("shows a delivered Learning watch observation as a short status line, never its teacher prompt", async () => {
    const evidence = { outcome: "confirmed", control: "view-change", origin: "view",
      workspace: { projectSlug: "training-1", sessionId: "training-1", pane: "preview", ready: true, learningView: "workspace" } };
    const prompt = [
      "A supervised Learning observation is available for this exact pinned lesson.",
      "Current lesson outcome or criterion: Watch me while I do my lesson's practice task.",
      `Observed application fact: ${JSON.stringify({ evidence, progress: { revision: 9 } })}`,
      "Treat this as application-origin context, not as the learner's authored answer and not as assessment evidence."
    ].join("\n");
    const user = { at: "2026-10-18T05:28:24.577Z", messageId: "learning-guidance-edf2b224", role: "user", text: prompt };
    const reply = { at: "2026-10-18T05:28:34.516Z", messageId: "guidance-reply", role: "assistant",
      text: "You're in Preview and it's ready. Go ahead and add your note." };
    const forged = { ...userTurn("own"), user: { ...userTurn("own").user, messageId: "learning-guidance-own", text: "My own words." } };
    const mounted = mountConversation({ turns: [{ turnId: "000002", user, messages: [user, reply] }, forged] });
    await nextTick();
    // Rendered words live in text nodes, Markdown blocks and status-message props.
    const rendered = node => [node.text || "", JSON.stringify(node.props?.blocks || ""), String(node.props?.message?.text || ""),
      ...(node.children || []).map(rendered)].join("");
    const text = rendered(mounted.container);
    expect(text).toContain("Go ahead and add your note.");
    expect(text).not.toContain("supervised Learning observation");
    expect(text).not.toContain("Observed application fact");
    expect(text).not.toContain("view-change");
    expect(text).toContain("Watching: you are in Preview.");
    // Only the exact delivered guidance format is summarised; the learner's own words stay a user bubble.
    expect(renderedUserPromptBlocks(mounted.container).some(block => block.text === "My own words.")).toBe(true);
    mounted.app.unmount();
  });

  it("expands agent Markdown without resetting on receipt updates", async () => {
    const body = "**Checks passed.**\n\n- Preview stopped automatically.\n- Registration remains usable.\n\n" + "Retained evidence. ".repeat(25) + "\n\n`final-proof.log`";
    const details = { sourceProject: "vibe64", sourceSession: "source", projectSlug: "online", sessionId: "destination", body, direction: "sent", status: "accepted" };
    const turn = { turnId: "outgoing", system: { role: "system", text: body }, metadata: { projectMessage: details } };
    const mounted = mountConversation({ turns: [turn] });
    await nextTick();
    const toggle = () => findNode(mounted.container, node => node.type === "button" && /Read more|Show less/.test(nodeText(node)));
    const blocks = () => findNode(mounted.container, node => Array.isArray(node.props?.blocks))?.props.blocks;
    expect(toggle().props["aria-expanded"]).toBe(false);
    expect(JSON.stringify(blocks())).not.toContain("final-proof.log");
    toggle().props.onClick();
    await nextTick();
    expect(toggle().props["aria-expanded"]).toBe(true);
    expect(blocks().some(block => block.type === "ul")).toBe(true);
    expect(JSON.stringify(blocks())).toContain("final-proof.log");
    mounted.state.turns.value = [{ ...turn, metadata: { projectMessage: { ...details, status: "delivered" } } }];
    await nextTick();
    expect(toggle().props["aria-expanded"]).toBe(true);
    expect(nodeText(mounted.container)).toContain("Delivered to assistant");
    toggle().props.onClick();
    await nextTick();
    expect(JSON.stringify(blocks())).not.toContain("final-proof.log");
    mounted.app.unmount();
  });

  it("keeps recorded reply names when the next recipient changes, with agent for old replies", async () => {
    const mounted = mountConversation({ turns: [
      agentTurn("old"),
      { ...agentTurn("codex"), metadata: { assistantSelection: {
        engineId: "codex", modelId: "gpt-6-astra", modelProviderId: "openai", variantId: "high"
      } } },
      { ...agentTurn("opencode"), metadata: { assistantSelection: {
        engineId: "opencode", modelId: "big-pickle", modelProviderId: "opencode", variantId: ""
      } } }
    ] });
    for (const recipient of ["Codex", "OpenCode"]) {
      mounted.state.assistantLabel.value = recipient;
      await flushScrollWork();
      for (const name of ["agent", "Codex (gpt-6-astra high)", "OpenCode (big-pickle default)"]) {
        const label = findNode(mounted.container, node => node.type === "span" && nodeText(node).trim() === name);
        expect(label).not.toBeNull();
        if (name === "agent") expect(label.props.title).toBeUndefined();
        if (name === "Codex (gpt-6-astra high)") expect(label.props.title).toContain("gpt-6-astra");
      }
    }
    mounted.app.unmount();
  });

  it("shows Skip for a saved request and restores its skipped outcome", async () => {
    const turn = { turnId: "000001", integrationSetup: { integrationId: "mail", requestId: "a".repeat(64), outcome: "pending" },
      assistant: { role: "assistant", text: 'Configure mail.\n\n```vibe64-integration\n{"integrationId":"mail"}\n```' } };
    const mounted = mountConversation({ integrationRequestsEnabled: true, turns: [turn] });
    await flushScrollWork();
    const skip = () => findNode(mounted.container, (node) => node.type === "button" && nodeText(node).trim() === "Skip");
    expect(skip().props.disabled).toBe(false);
    skip().props.onClick();
    expect(mounted.integrationSkips).toEqual([{ sessionId: "session-1", turnId: "000001", requestId: "a".repeat(64) }]);
    mounted.state.turns.value = [{ ...turn, integrationSetup: { ...turn.integrationSetup, outcome: "skipped" } }];
    await flushScrollWork();
    expect(skip()).toBeNull();
    expect(findNode(mounted.container, (node) => node.props?.role === "status" && nodeText(node) === "Skipped")).not.toBeNull();
    mounted.state.turns.value = [{ ...turn, integrationSetup: { ...turn.integrationSetup, outcome: "completed" } }];
    await flushScrollWork();
    expect(skip()).toBeNull();
    expect(findNode(mounted.container, (node) => node.props?.role === "status" && nodeText(node) === "Setup completed")).not.toBeNull();
    for (const [status, message] of [
      ["pending", "Assistant continuation is pending. Check continuation to resume."],
      ["sending", "Assistant delivery is not yet confirmed. Check continuation to inspect delivery without sending it again."],
      ["accepted", "Assistant continuation accepted."]
    ]) {
      mounted.state.turns.value = [{ ...turn, integrationSetup: {
        ...turn.integrationSetup, outcome: "completed", continuation: { status }
      } }];
      await flushScrollWork();
      expect(findNode(mounted.container, (node) => node.props?.role === "status" && nodeText(node).trim() === message)).not.toBeNull();
      const label = status === "accepted" ? "Configure" : "Check continuation";
      const button = findNode(mounted.container, (node) => node.type === "button" && nodeText(node).trim() === label);
      expect(button.props.disabled).toBe(false);
      if (status !== "accepted") {
        button.props.onClick();
        expect(mounted.integrationResumes.at(-1)).toEqual({ sessionId: "session-1", turnId: "000001", requestId: "a".repeat(64) });
      }
    }
    mounted.app.unmount();
  });

  it("restores an explicit integration card from history and binds navigation to its current session", async () => {
    const turn = {
      turnId: "setup-turn",
      integrationSetup: { requestId: "a".repeat(64), outcome: "pending" },
      assistant: { role: "assistant", text: 'Configure the mailbox.\n\n```vibe64-integration\n{"integrationId":"gmail-business"}\n```' }
    };
    const mounted = mountConversation({ integrationRequestsEnabled: true, turns: [turn] });
    await flushScrollWork();
    const configure = () => findNode(mounted.container, (node) => node.type === "button" && nodeText(node).trim() === "Configure");
    expect(configure().props.disabled).toBe(false);
    expect(mounted.integrationChecks).toEqual([{ sessionId: "session-1", turnId: "setup-turn", requestId: "a".repeat(64) }]);
    configure().props.onClick();
    expect(mounted.integrationRequests).toEqual([{ sessionId: "session-1", turnId: "setup-turn", requestId: "a".repeat(64), integrationId: "gmail-business" }]);
    mounted.state.scrollKey.value = "session-2";
    mounted.state.turns.value = [];
    await flushScrollWork();
    expect(configure()).toBeNull();
    mounted.state.scrollKey.value = "session-1";
    mounted.state.turns.value = [JSON.parse(JSON.stringify(turn))];
    await flushScrollWork();
    expect(configure().props.disabled).toBe(false);
    expect(mounted.integrationChecks).toHaveLength(2);
    mounted.state.turns.value = [{ ...turn, pending: true }];
    await flushScrollWork();
    expect(configure().props.disabled).toBe(true);
    mounted.app.unmount();

    const restored = mountConversation({ turns: [JSON.parse(JSON.stringify(turn))] });
    await flushScrollWork();
    const archivedButton = findNode(restored.container, (node) => node.type === "button" && nodeText(node).trim() === "Configure");
    expect(archivedButton.props.disabled).toBe(true);
    expect(restored.integrationRequests).toEqual([]);
    expect(restored.integrationChecks).toEqual([]);
    restored.app.unmount();
  });

  it("renders sent attachments as distinct file details", async () => {
    const { app, container } = mountConversation({
      turns: [userTurn("attachment", "Please inspect this.", [{
        fileName: "screenshot.png",
        size: 2048
      }])]
    });
    await flushScrollWork();

    const attachments = findNode(
      container,
      (node) => node.props?.["aria-label"] === "Attached files"
    );
    expect(nodeText(attachments)).toContain("screenshot.png");
    expect(nodeText(attachments)).toContain("2.0 KB");
    expect(JSON.stringify(renderedUserPromptBlocks(container))).not.toContain("screenshot.png");

    app.unmount();
  });

  it("collapses only long user prompts and expands them in place", async () => {
    const longPrompt = [
      "First line of the request.",
      "Second line adds context.",
      "Third line explains the constraint.",
      "Fourth line completes the preview.",
      "Fifth line should initially remain below the visual guard."
    ].join("\n");
    const { app, container } = mountConversation({
      turns: [userTurn("long-prompt", longPrompt)]
    });
    await flushScrollWork();

    expect(JSON.stringify(renderedUserPromptBlocks(container))).toContain("Fourth line completes the preview.…");
    expect(JSON.stringify(renderedUserPromptBlocks(container))).not.toContain("Fifth line");
    expect(nodeText(userPromptToggle(container))).toBe("Read more");
    expect(userPromptToggle(container).props["aria-expanded"]).toBe(false);

    userPromptToggle(container).props.onClick();
    await nextTick();

    expect(JSON.stringify(renderedUserPromptBlocks(container))).toContain("Fifth line");
    expect(nodeText(userPromptToggle(container))).toBe("Show less");
    expect(userPromptToggle(container).props["aria-expanded"]).toBe(true);

    app.unmount();

    const shortConversation = mountConversation({
      turns: [userTurn("short-prompt", "A short request stays fully visible.")]
    });
    await flushScrollWork();
    expect(userPromptToggle(shortConversation.container)).toBeNull();
    shortConversation.app.unmount();
  });

  it("follows only while at the bottom and lets an accepted local send resume follow", async () => {
    const { app, container, state } = mountConversation();
    await flushScrollWork();
    const body = conversationBody(container);

    expect(body.props.tabindex).toBe("0");
    expect(body.props["aria-label"]).toBe("Conversation messages");
    expect(body.scrollTop).toBe(1_200);

    body.scrollWrites.length = 0;
    body.props.onPointerdown({
      currentTarget: body,
      target: body
    });
    body.scrollHeight = 1_300;
    state.turns.value = [...state.turns.value, agentTurn("after-background-click")];
    await flushScrollWork();
    await flushScrollWork();
    expect(body.scrollTop).toBe(1_300);

    body.scrollWrites.length = 0;
    body.props.onWheelPassive({});
    body.scrollTop = 320;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    body.scrollHeight = 1_400;
    state.turns.value = [...state.turns.value, userTurn("remote-user")];
    await flushScrollWork();
    expect(body.scrollWrites).toEqual([]);

    body.scrollTop = 1_160;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    body.scrollHeight = 1_600;
    state.turns.value = [...state.turns.value, {
      system: {
        messageId: "system-1",
        role: "system",
        text: "The session state changed."
      },
      turnId: "system-1"
    }];
    await flushScrollWork();
    expect(body.scrollTop).toBe(1_600);

    body.scrollWrites.length = 0;
    body.props.onKeydownCapture({
      defaultPrevented: false,
      key: "PageUp",
      target: body
    });
    body.scrollTop = 500;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    body.scrollHeight = 1_800;
    state.turns.value = [...state.turns.value, agentTurn("agent-after-keyboard")];
    await flushScrollWork();
    expect(body.scrollWrites).toEqual([]);

    state.followLatestKey.value += 1;
    await flushScrollWork();
    expect(body.scrollTop).toBe(1_800);

    app.unmount();
  });

  it("preserves the history anchor after a slow older-page load and stays detached", async () => {
    const { app, container, loadMoreRequests, state } = mountConversation({
      hasMoreBefore: true,
      turns: [agentTurn("turn-2"), agentTurn("turn-3")]
    });
    await flushScrollWork();
    const body = conversationBody(container);

    body.props.onWheelPassive({});
    body.scrollTop = 400;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    loadOlderButton(container).props.onClick();
    vi.advanceTimersByTime(700);

    body.scrollHeight = 1_500;
    state.turns.value = [agentTurn("turn-1"), ...state.turns.value];
    loadMoreRequests[0].complete({ changed: true, loaded: true });
    await flushScrollWork();
    expect(body.scrollTop).toBe(700);

    body.scrollWrites.length = 0;
    body.scrollHeight = 1_700;
    state.turns.value = [...state.turns.value, agentTurn("turn-4")];
    await flushScrollWork();
    expect(body.scrollWrites).toEqual([]);

    app.unmount();
  });

  it("disarms a failed or empty older-page request before later realtime trimming", async () => {
    const { app, container, loadMoreRequests, state } = mountConversation({
      hasMoreBefore: true,
      turns: [agentTurn("turn-1"), agentTurn("turn-2")]
    });
    await flushScrollWork();
    const body = conversationBody(container);

    body.props.onWheelPassive({});
    body.scrollTop = 300;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    loadOlderButton(container).props.onClick();
    loadMoreRequests[0].complete({ changed: false, loaded: false });
    await flushScrollWork();

    body.scrollHeight = 1_400;
    state.turns.value = [agentTurn("turn-2"), agentTurn("turn-3")];
    await flushScrollWork();
    expect(body.scrollWrites).toEqual([]);

    app.unmount();
  });

  it("bottoms a newly visible or newly selected session", async () => {
    const { app, container, state } = mountConversation();
    await flushScrollWork();
    let body = conversationBody(container);

    body.props.onWheelPassive({});
    body.scrollTop = 260;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    state.scrollKey.value = "session-2";
    state.turns.value = [agentTurn("other-session")];
    await flushScrollWork();
    expect(body.scrollTop).toBe(1_200);

    state.visible.value = false;
    await flushScrollWork();
    expect(conversationBody(container)).toBeNull();
    state.visible.value = true;
    await flushScrollWork();
    body = conversationBody(container);
    expect(body.scrollTop).toBe(1_200);

    app.unmount();
  });

  it("retains the warm scroll body while a compact error recovers", async () => {
    const { app, container, state } = mountConversation({ error: "Conversation failed." });
    await flushScrollWork();
    const body = conversationBody(container);
    expect(body).not.toBeNull();
    expect(nodeText(container)).toContain("Conversation failed.");

    state.error.value = "";
    await flushScrollWork();
    expect(conversationBody(container)).toBe(body);
    expect(nodeText(container)).not.toContain("Conversation failed.");
    expect(conversationBody(container).scrollTop).toBe(1_200);

    app.unmount();
  });
});
