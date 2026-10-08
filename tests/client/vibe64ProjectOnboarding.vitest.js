import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  configureHttpWebClient,
  getHttpWebClient,
  resetHttpWebClientForTests
} from "@jskit-ai/http-web/client/lib/httpClient";
import * as Vue from "vue";
import { renderToString } from "@vue/server-renderer";
import { routeLocationKey } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIBE64_COLLEAGUE_PREVIEW_KEY, VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_TRAINING_LEARNER_GESTURE_KEY } from "../../src/lib/vibe64AssistantHost.js";
import { alternateVisualResource } from "../fixtures/trainingVisualFixture.js";
import { provideConversationFixture } from "./helpers/conversationRuntimeFixture.js";
import { createTemporaryConversationFixture, temporaryRequestBody } from "./helpers/temporaryConversationFixture.js";

const mocks = vi.hoisted(() => ({ live: false, resource: null, query: null, visuals: [] }));
vi.mock("@jskit-ai/assistant-core/client", async (importOriginal) => ({
  ...await importOriginal(), assistantHttpClient: { request: (...args) => getHttpWebClient().request(...args) }
}));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: passthroughComponent("button") }));
vi.mock("vuetify/components/VAlert", () => ({ VAlert: passthroughComponent("aside") }));
vi.mock("vuetify/components/VTextarea", () => ({ VTextarea: passthroughComponent("textarea") }));
vi.mock("vuetify/components/VSkeletonLoader", () => ({ VSkeletonLoader: passthroughComponent("div") }));

// Contract stand-in for the already browser-proven player; these cases verify
// Preview composition/ownership, not controller transitions or sandbox proof.
vi.mock("../../packages/vibe64-training/src/client/TrainingVisualPlayer.vue", async () => {
  const Vue = await import("vue");
  return { default: Vue.defineComponent({
    props: { resource: Object, attemptId: String }, emits: ["state", "error"],
    setup(props, { emit, expose }) {
      const entry = { operations: [], disposed: false, semantic: { state: "overview", paused: false, labels: {} } };
      const playerInstanceId = `fixture-${mocks.visuals.length + 1}`;
      entry.ready = () => emit("state", { attemptId: props.attemptId, playerInstanceId,
        phase: "ready", state: entry.semantic.state, description: "Current semantic display", error: "" });
      entry.failMount = message => emit("error", message);
      entry.state = value => emit("state", value);
      entry.finish = (index, fields = {}) => {
        const operation = entry.operations[index];
        entry.semantic = { ...entry.semantic, ...fields };
        entry.ready();
        operation.resolve({ protocolVersion: 1, playerInstanceId, type: "completed", commandId: operation.input.commandId,
          state: entry.semantic.state, description: "Actual completed display" });
      };
      expose({ command(input) {
        structuredClone(input.parameters); // Original player sends plain bounded parameters across MessageChannel.
        const pending = Promise.withResolvers();
        entry.operations.push({ input, ...pending });
        emit("state", { attemptId: props.attemptId, playerInstanceId, phase: "accepted",
          state: entry.semantic.state, description: "Current semantic display", error: "" });
        return pending.promise;
      }, snapshot: async () => structuredClone(entry.semantic) });
      Vue.onBeforeUnmount(() => {
        entry.disposed = true;
        for (const operation of entry.operations) operation.reject(new Error("The original player instance retired."));
      });
      mocks.visuals.push(entry);
      return () => Vue.h("iframe", { title: props.resource.visual.title });
    }
  }) };
});

function passthroughComponent(element) {
  return Vue.defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) { return () => Vue.h(element, attrs, slots.default?.()); }
  });
}
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useEndpointResource(options) {
      mocks.query = options;
      return mocks.live ? actual.useEndpointResource(options) : mocks.resource;
    }
  };
});
vi.mock("@jskit-ai/http-web/client/composables/useCommand", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useCommand: (options) => mocks.live ? actual.useCommand(options) : { run: vi.fn(async () => ({ ok: true })) }
  };
});
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug: () => Vue.ref("project-a")
}));
import PreviewPresentation from "../../packages/vibe64-training/src/client/TrainingPreviewPresentation.vue";
import Onboarding from "../../src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue";
import FixAction from "../../src/components/studio/Vibe64TemporaryAiFixAction.vue";
import { useVibe64ConversationRuntime } from "../../src/composables/useVibe64ConversationRuntime.js";
import { useVibe64TemporaryAi } from "../../src/composables/useVibe64TemporaryAi.js";

for (const [component, relativePath] of [
  [Onboarding, "src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue"],
  [PreviewPresentation, "packages/vibe64-training/src/client/TrainingPreviewPresentation.vue"],
  [FixAction, "src/components/studio/Vibe64TemporaryAiFixAction.vue"]
]) {
  const filename = path.resolve(relativePath);
  const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
  const script = compileScript(descriptor, { id: "onboarding-test" });
  component.render = new Function("Vue", compile(descriptor.template.content, {
    bindingMetadata: script.bindings, mode: "function", prefixIdentifiers: true
  }).code)(Vue);
}

const autopilot = fs.readFileSync(path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue"), "utf8");
// Compile the unchanged actual Autopilot Preview subtree: unrelated chat/source
// tools stay outside this finite composition fixture. Original wrapper and
// Onboarding setup still own resources; only OutputControls display is observed.
const previewSubtree = autopilot.slice(autopilot.indexOf("<TrainingPreviewPresentation"),
  autopilot.indexOf("</TrainingPreviewPresentation>") + "</TrainingPreviewPresentation>".length);
const ActualAutopilotPreview = Vue.defineComponent({
  props: { model: Object, requestTemporaryAi: Function },
  setup({ model, requestTemporaryAi }) {
    return {
      props: Vue.computed(() => ({ ...model, sourceWorkspaceAvailable: model.sourceWorkspaceAvailable ?? model.appAvailable,
        outputWorkspaceAvailable: model.appAvailable,
        learningAttemptId: model.attemptId, sessionSelectionArchived: model.archived,
        previewToolbarTeleportTarget: "#actual-preview-toolbar" })),
      projectSlug: Vue.computed(() => model.projectSlug),
      selectedAssistantSessionId: Vue.computed(() => model.sessionId),
      dashboardContext: {}, sourceOperationsSuspended: false, agentActive: false,
      assistantJuniorAllowed: true, startTemporaryAiTask: requestTemporaryAi,
      askCodexToFixPreviewIdentity() {}, attachPreviewFile() {}, attachPreviewFileProducer() {},
      updatePreviewAttachmentState() {}, updateTestApproval() {}
    };
  },
  render: new Function("Vue", compile(previewSubtree, { mode: "function", prefixIdentifiers: true }).code)(Vue)
});
const onboardingTag = autopilot.match(/<Vibe64ProjectOnboarding\b[\s\S]*?>/u)?.[0];
const activeBinding = onboardingTag?.match(/:active="([^"]+)"/u)?.[1];
if (!activeBinding) throw new Error("The actual onboarding activity binding is required.");
const onboardingActive = new Function("props", "appVisible = true", `return (${activeBinding});`);

function opening(state = "ready", sessionId = "session-a") {
  return {
    available: true,
    inspection: { state, diagnostics: [], nextAction: state === "ready" ? "work" : "create" },
    ok: true,
    source: { rootKind: "session-source", sessionId },
    templates: state === "new"
      ? [{ id: "official:jskit/public", technology: "jskit", name: "Public starter", description: "A public app." }]
      : []
  };
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function nodeText(node) {
  return [node.text || "", ...(node.children || []).map(nodeText)].join("");
}

// Real Onboarding setup/template, QueryClient, command, feedback and realtime;
// only Vuetify presentation and the ready OutputControls slot are stand-ins.
function mountOnboarding({ active = true, projectPane = "preview", live = true, temporaryChats = false, withPresentation = false, withAutopilotPreview = false, lessonsAvailable = false, appAvailable = true, attemptId = "", holdCheckpoints = false, withLearningMain = false, practiceLearning = false, practiceApp = false, learnerGestureOwner = null } = {}) {
  mocks.live = live;
  if (withPresentation || withAutopilotPreview) mocks.visuals = [];
  const props = Vue.reactive({ active, archived: false, busy: false, canAsk: true, mounted: true, projectPane, lessonsAvailable, appAvailable, attemptId, sessionId: "session-a", projectSlug: "project-a", presentation: null });
  if (practiceApp) {
    props.sourceWorkspaceAvailable = false;
    props.sessionId = "saved-practice-initial";
    props.projectSlug = "exact-practice";
    props.conversationRuntime = { identity: {
      actorKey: "learning-member-42", viewerActorKey: "member-42", learnerId: "42", projectSlug: "",
      learningAttemptId: attemptId, sessionId: props.sessionId, noExercise: false,
      sourceProjectSlug: props.projectSlug, sessionsApiPath: `/api/learning/${attemptId}/vibe64/sessions`
    } };
  }
  const reads = [];
  const visualReads = [];
  const learningMainReads = [];
  const checkpointReads = [];
  const checkpointWrites = [];
  let savedVisual = null;
  let checkpointRevision = 0;
  const presentationHost = Vue.shallowRef(null);
  const viewer = Vue.shallowRef({ actorKey: "member-42" });
  const writes = [];
  const conversationRequests = [];
  const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
  let temporary;
  const listeners = new Set();
  const sessionListeners = new Set();
  const feedback = { dismiss: vi.fn(), report: vi.fn(() => ({ skipped: true })) };
  const outputs = { mounted: vi.fn(), unmounted: vi.fn(), controls: Vue.shallowRef(null) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let closed = false;
  const colleaguePreview = Vue.shallowRef(null);
  const transport = {
    request(url, options) {
      if (practiceApp && url === `${props.conversationRuntime.identity.sessionsApiPath}/${props.sessionId}/onboarding`) {
        expect(options.method).toBe("GET");
        const response = Promise.withResolvers(); reads.push({ url, options, ...response });
        if (closed) response.resolve(opening());
        return response.promise;
      }
      if (withLearningMain && url === `/api/learning/${props.attemptId}/vibe64/sessions/${props.sessionId}`) {
        expect(options.method).toBe("GET");
        learningMainReads.push({ url, options });
        return Promise.resolve({ session: { sessionId: props.sessionId, purpose: "learning", learningAttemptId: props.attemptId } });
      }
      if (url.startsWith("/api/vibe64/training/attempts/") || url.startsWith("/api/learning/")) {
        const scope = JSON.stringify([viewer.value?.actorKey, props.projectSlug, props.sessionId, url]);
        if (options.method === "POST") {
          expect(savedVisual?.scope).toBe(scope);
          if (url.startsWith("/api/learning/")) {
            if (practiceLearning) expect(options.body.projectSlug).toBe(props.conversationRuntime.identity.sourceProjectSlug);
            else expect(Object.hasOwn(options.body, "projectSlug")).toBe(false);
          }
          else expect(options.body.projectSlug).toBe(props.projectSlug);
          expect(options.body.sessionId).toBe(props.sessionId);
          expect(options.body.expectedRevision).toBe(checkpointRevision);
          expect(options.body.requestId).toMatch(/^[a-f0-9-]{36}$/u);
          checkpointWrites.push({ url, options: structuredClone(options) });
          return Promise.resolve({ revision: ++checkpointRevision });
        }
        if (savedVisual?.scope === scope) {
          const response = { ...savedVisual.resource, revision: checkpointRevision };
          if (holdCheckpoints) {
            const pending = Promise.withResolvers();
            checkpointReads.push({ url, options, resolve: () => pending.resolve(response) });
            return pending.promise;
          }
          checkpointReads.push({ url, options });
          return Promise.resolve(response);
        }
        const response = Promise.withResolvers();
        visualReads.push({ url, options, reject: response.reject, resolve(value) {
          if (value?.id === url.split("/").at(-1) && value.visual?.id === value.id) {
            savedVisual = { scope, resource: value };
          }
          response.resolve(value);
        } });
        return response.promise;
      }
      if (url.startsWith("/api/vibe64/sessions/") || url.startsWith("/api/assistant/app/conversations/")) {
        conversationRequests.push({ url, ...options });
        if (url.endsWith("/temporary-conversations")) {
          return Promise.resolve({ ok: true, conversationId: options.body.conversationId });
        }
        return Promise.resolve({ ok: true, runId: "repair-turn", status: "inProgress" });
      }
      const response = Promise.withResolvers();
      if (options.method === "GET") {
        expect(url).toBe("/api/vibe64/onboarding");
        reads.push({ options, ...response });
      } else {
        expect(options.method).toBe("POST");
        expect(url).toBe("/api/vibe64/templates/apply");
        writes.push({ options, ...response });
      }
      if (closed) response.resolve({ ok: true });
      return response.promise;
    }
  };
  const temporaryTransport = temporaryChats ? createTemporaryConversationFixture(transport) : null;
  configureHttpWebClient(temporaryTransport || transport);
  const outputSlot = Vue.defineComponent({
    setup() {
      outputs.mounted();
      Vue.onBeforeUnmount(outputs.unmounted);
      return () => Vue.h("output", "Running output instance");
    }
  });
  const renderer = Vue.createRenderer({
    createElement: (type) => ({ type, children: [], props: {}, parent: null, style: {} }),
    createComment: (text) => ({ type: "comment", text, children: [], props: {} }),
    createText: (text) => ({ type: "text", text, children: [], props: {} }),
    insert(child, parent, anchor = null) {
      const previous = child.parent?.children?.indexOf(child) ?? -1;
      if (previous >= 0) child.parent.children.splice(previous, 1);
      child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(child);
      else parent.children.splice(index, 0, child);
    },
    remove(child) {
      const index = child.parent?.children?.indexOf(child) ?? -1;
      if (index >= 0) child.parent.children.splice(index, 1);
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    patchProp: (node, key, _previous, value) => { node.props[key] = value; },
    setElementText(node, text) { node.children = []; node.text = text; },
    setText: (node, text) => { node.text = text; }
  });
  const app = renderer.createApp({
    setup() {
      if (temporaryChats) {
        temporary = useVibe64TemporaryAi({
          sessionId: () => props.sessionId,
          sessionsApiPath: () => "/api/vibe64/sessions"
        });
        requestTemporaryAi.mockImplementation(temporary.startTask);
      }
      const appBody = ({ presentation = props.presentation, appVisible = true } = {}) => Vue.h(Onboarding, {
        active: onboardingActive(props, appVisible), archived: props.archived, busy: props.busy, canAsk: props.canAsk,
        requestTemporaryAi, sessionId: props.sessionId, presentation
      }, { default: () => Vue.h(outputSlot) });
      return () => !props.mounted ? null : withAutopilotPreview ? Vue.h(ActualAutopilotPreview, {
        model: props, requestTemporaryAi
      }, { dashboard: () => Vue.h("input", { "aria-label": "Actual Lessons slot" }) }) : withPresentation ? Vue.h(PreviewPresentation, {
        ref: presentationHost, active: onboardingActive(props) && !props.archived,
        projectSlug: props.projectSlug, sessionId: props.sessionId,
        lessonsAvailable: props.lessonsAvailable, appAvailable: props.appAvailable, attemptId: props.attemptId
      }, { default: appBody, lessons: () => Vue.h("input", { "aria-label": "Lesson picker selection" }) }) : appBody();
    }
  });
  app.component("TrainingPreviewPresentation", PreviewPresentation);
  app.component("Vibe64ProjectOnboarding", Onboarding);
  app.component("Vibe64OutputControls", Vue.defineComponent({
    props: ["previewDisplayed", "windowDisplayed", "toolbarTeleportTarget", "learningBinding"],
    setup(controls) {
      outputs.controls.value = controls;
      outputs.mounted(); Vue.onBeforeUnmount(outputs.unmounted);
      return () => Vue.h("output", "Actual output controls placement");
    }
  }));
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_COLLEAGUE_PREVIEW_KEY, colleaguePreview);
  if (learnerGestureOwner) app.provide(VIBE64_TRAINING_LEARNER_GESTURE_KEY, Vue.shallowRef(learnerGestureOwner));
  if (withPresentation || withAutopilotPreview || practiceApp) app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  app.provide(routeLocationKey, Vue.reactive({ path: "/app/project/project-a", params: {}, query: {}, matched: [] }));
  app.provide("jskit.shell-web.runtime.web-error.client", feedback);
  const socketEvents = temporaryChats ? new EventEmitter() : null;
  const socket = {
    on(event, handler) {
      if (event === "vibe64.project.changed") listeners.add(handler);
      if (event === "vibe64.session.changed") sessionListeners.add(handler);
      socketEvents?.on(event, handler);
    },
    off(event, handler) {
      if (event === "vibe64.project.changed") listeners.delete(handler);
      if (event === "vibe64.session.changed") sessionListeners.delete(handler);
      socketEvents?.off(event, handler);
    },
    emit(...args) { return socketEvents?.emit(...args); }
  };
  if (temporaryTransport) provideConversationFixture(app, temporaryTransport.attach(socket));
  else app.provide("jskit.realtime.runtime.client.socket", socket);
  for (const [name, element] of [["VAlert", "aside"], ["VBtn", "button"], ["VTextarea", "textarea"], ["VSkeletonLoader", "div"]]) {
    app.component(name, passthroughComponent(element));
  }
  const container = { children: [], props: {}, type: "root" };
  app.mount(container);
  return {
    colleaguePreview, container, conversationRequests, feedback, listeners, outputs, props, reads, requestTemporaryAi, temporary, writes,
    visualReads, learningMainReads, checkpointReads, checkpointWrites, presentationHost, viewer,
    button: (label) => findNode(container, (node) => node.type === "button" && nodeText(node).includes(label)),
    async projectChanged(projectSlug = "project-a") {
      for (const handler of listeners) handler({ projectSlug });
      await Vue.nextTick();
    },
    async sessionChanged(payload) {
      for (const handler of sessionListeners) handler(payload);
      await Vue.nextTick();
    },
    async settleRead(index, data = opening()) {
      const request = reads[index];
      const query = queryClient.getQueryCache().find({
        exact: true,
        queryKey: ["vibe64", "project-onboarding", "project-a", request.options.query.sessionId]
      });
      const pending = query?.promise;
      request.resolve(data);
      await pending;
      await Vue.nextTick();
    },
    close() {
      if (closed) return;
      closed = true;
      app.unmount();
      queryClient.clear();
      for (const request of reads) request.resolve(opening());
      for (const request of writes) request.resolve({ ok: true });
      resetHttpWebClientForTests();
    }
  };
}

async function render(state, props = {}, environmentSetup = null) {
  mocks.resource.data.value = state === null ? null : {
    ok: true, available: true, environmentSetup,
    inspection: { state, nextAction: "migrate", diagnostics: [{ message: "The project uses an older format." }] },
    // Deliberately retain stale offers: the presentation must still obey state.
    templates: [{ id: "official:jskit/public", technology: "jskit", name: "Public starter", description: "A public app." }]
  };
  const app = Vue.createSSRApp({
    render: () => Vue.h(Onboarding, { active: true, sessionId: "session-a", canAsk: true, requestTemporaryAi: async () => {}, ...props }, {
      default: () => Vue.h("div", "Normal outputs")
    })
  });
  for (const [name, element] of [["v-alert", "aside"], ["v-btn", "button"], ["v-textarea", "textarea"], ["v-skeleton-loader", "div"]]) {
    app.component(name, passthroughComponent(element));
  }
  return renderToString(app);
}

describe("Preview project onboarding", () => {
  beforeEach(() => {
    mocks.live = false;
    mocks.resource = { data: Vue.ref(null), isFetching: Vue.ref(false), loadError: Vue.ref(""), reload: vi.fn() };
  });
  it("refreshes visible setup after a temporary agent finishes, scoped to its project and session", async () => {
    const fixture = mountOnboarding();
    const finished = { projectSlug: "project-a", sessionId: "session-a", reason: "temporary-agent-turn-idle" };
    try {
      await fixture.settleRead(0, opening("new"));
      for (const payload of [
        { ...finished, projectSlug: "project-b" },
        { ...finished, projectSlug: undefined },
        { ...finished, sessionId: "session-b" },
        { ...finished, reason: "assistant-stream" }
      ]) await fixture.sessionChanged(payload);
      expect(fixture.reads).toHaveLength(1);
      await fixture.sessionChanged(finished);
      expect(fixture.reads).toHaveLength(2);
      await fixture.settleRead(1, opening());
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
      expect(fixture.colleaguePreview.value.screen).toBe("outputs");
      expect(nodeText(fixture.container)).not.toContain("What would you like to build with?");

      fixture.props.active = false;
      await Vue.nextTick();
      await fixture.sessionChanged(finished);
      expect(fixture.reads).toHaveLength(2);
      fixture.props.active = true;
      await Vue.nextTick();
      expect(fixture.reads).toHaveLength(3);
      await fixture.settleRead(2);
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
      fixture.close();
      await fixture.sessionChanged(finished);
      expect(fixture.reads).toHaveLength(3);
    } finally { fixture.close(); }
  });
  it("reports the displayed setup screen and clears it when hidden or unmounted", async () => {
    const fixture = mountOnboarding();
    try {
      expect({ ...fixture.colleaguePreview.value }).toEqual({ projectSlug: "project-a", sessionId: "session-a", screen: "checking-project-setup", presentation: null });
      await fixture.settleRead(0, opening("adoption"));
      expect(fixture.colleaguePreview.value.screen).toBe("existing-project-setup");
      expect(nodeText(fixture.container)).toContain("Set up this existing project");
      fixture.props.projectPane = "dashboard";
      await Vue.nextTick();
      expect(fixture.colleaguePreview.value).toBeNull();
      fixture.props.projectPane = "preview";
      await Vue.nextTick();
      expect(fixture.colleaguePreview.value.screen).toBe("existing-project-setup");
      fixture.props.archived = true;
      await Vue.nextTick();
      expect(fixture.colleaguePreview.value.screen).toBe("outputs");
      expect(nodeText(fixture.container)).not.toContain("Set up this existing project");
      fixture.props.mounted = false;
      await Vue.nextTick();
      expect(fixture.colleaguePreview.value).toBeNull();
    } finally { fixture.close(); }
  });
  it.each(["new", "ready", "attention"])("reports the actual %s view and never overwrites a newer owner on cleanup", async (state) => {
    const fixture = mountOnboarding();
    try {
      await fixture.settleRead(0, opening(state));
      expect(fixture.colleaguePreview.value.screen).toBe({ new: "new-project-setup", ready: "outputs", attention: "outputs-with-setup-warning" }[state]);
      const newer = { projectSlug: "project-b", sessionId: "session-b", screen: "outputs" };
      fixture.colleaguePreview.value = newer;
      fixture.props.mounted = false;
      await Vue.nextTick();
      expect(fixture.colleaguePreview.value).toBe(newer);
    } finally { fixture.close(); }
  });
  it("shows project requirements independently of outputs and hides them when satisfied or archived", async () => {
    const setup = { missingKeys: ["STORAGE_TOKEN"], warning: "" };
    const html = await render("ready", {}, setup);
    expect(html).toContain("Set up your project&#39;s environment");
    expect(html).toContain("STORAGE_TOKEN");
    expect(html).toContain('to="/app/project/project-a/dashboard/env"');
    expect(html).toContain("Normal outputs");
    expect(await render("ready", {}, { missingKeys: [], warning: "" })).not.toContain("Open Env");
    expect(await render("ready", { archived: true }, setup)).not.toContain("Open Env");
  });
  it("offers a starter only for empty projects and disables choices during source work", async () => {
    expect(await render("new")).toContain("Public starter");
    const busy = await render("new", { busy: true });
    expect(busy).toMatch(/disabled[^>]*><strong[^>]*>Public starter/u);
    expect(mocks.query.readQuery.value).toEqual({ sessionId: "session-a" });
  });
  it("asks an existing project's purpose and never renders stale seed offers", async () => {
    const html = await render("adoption");
    expect(html).toContain("Set up this existing project");
    expect(html).toContain("What is this project?");
    expect(html).toContain("Inspect it for me");
    expect(html).not.toContain("Public starter");
    expect(html).not.toContain("Normal outputs");
  });
  it("shows a concrete repair issue and lets ready projects use normal outputs", async () => {
    const attention = await render("attention");
    expect(attention).toContain("The project uses an older format.");
    expect(attention).toContain("Normal outputs");
    expect(attention).toContain("Recheck setup");
    expect(attention).not.toContain("Public starter");
    expect(await render("ready")).toContain("Normal outputs");
  });
  it("does not offer templates before inspection or for archived sessions", async () => {
    expect(await render(null)).not.toContain("Public starter");
    expect(await render("new", { archived: true })).toContain("Normal outputs");
    expect(mocks.query.enabled.value).toBe(false);
  });

  it("opens outputs even when the initial setup request fails", async () => {
    mocks.resource.loadError.value = "Setup inspection is unavailable.";
    const html = await render(null);
    expect(html).toContain("Setup inspection is unavailable.");
    expect(html).toContain("Normal outputs");
    expect(html).toContain("Recheck setup");
  });

  it("keeps the same output instance through setup warnings, failed rechecks and recovery during AI work", async () => {
    const fixture = mountOnboarding();
    try {
      await fixture.settleRead(0);
      const output = findNode(fixture.container, (node) => node.type === "output");
      fixture.props.busy = true;
      await Vue.nextTick();
      await fixture.projectChanged();
      const attention = opening("attention");
      attention.inspection.diagnostics = [{ message: "Program module cites a missing or ineligible source file: src/Old.vue." }];
      await fixture.settleRead(1, attention);
      expect(nodeText(fixture.container)).toContain("src/Old.vue");
      expect(fixture.button("Fix it with AI").props.disabled).toBe(false);
      expect(fixture.button("Recheck setup").props.disabled).toBe(false);
      expect(findNode(fixture.container, (node) => node.type === "output")).toBe(output);

      const failedCheck = fixture.button("Recheck setup").props.onClick();
      await Vue.nextTick();
      expect(fixture.button("Checking setup").props.disabled).toBe(true);
      await fixture.settleRead(2, { ok: false, error: "Setup inspection failed." });
      await failedCheck;
      expect(nodeText(fixture.container)).toContain("Project setup could not be read");
      expect(findNode(fixture.container, (node) => node.type === "output")).toBe(output);

      const recovery = fixture.button("Recheck setup").props.onClick();
      await fixture.settleRead(3);
      await recovery;
      expect(fixture.button("Recheck setup")).toBeNull();
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
      expect(fixture.outputs.unmounted).not.toHaveBeenCalled();
    } finally {
      fixture.close();
    }
  });

  it("opens separate repair conversations while the main assistant and a previous repair are working", async () => {
    expect(onboardingTag).toContain(':can-ask="assistantJuniorAllowed"');
    expect(onboardingTag).toContain(':request-temporary-ai="startTemporaryAiTask"');
    const fixture = mountOnboarding({ temporaryChats: true });
    try {
      const attention = opening("attention");
      const diagnostic = "genesis/subsystems.md: workplace-operations: Data used must reference a table owned by another declared subsystem.";
      attention.inspection.diagnostics = [{ message: diagnostic }];
      await fixture.settleRead(0, attention);
      fixture.props.busy = true;
      await Vue.nextTick();
      const help = fixture.button("Fix it with AI");
      expect(help.props.disabled).toBe(false);
      await help.props.onClick();
      await fixture.requestTemporaryAi.mock.results.at(-1).value;
      await Vue.nextTick();
      expect(fixture.temporary.open.value).toBe(true);
      expect(fixture.temporary.activeTask.value.busy).toBe(true);
      expect(help.props.disabled).toBe(false);
      await help.props.onClick();
      await fixture.requestTemporaryAi.mock.results.at(-1).value;
      const creations = fixture.conversationRequests.filter(({ url, method }) => method === "POST" && url.endsWith("/temporary-conversations"));
      const turns = fixture.conversationRequests
        .filter(({ url, method }) => method === "POST" && url.endsWith("/messages"))
        .map(request => ({ ...request, body: temporaryRequestBody(request) }));
      expect(creations).toHaveLength(2);
      expect(turns).toHaveLength(2);
      expect(creations[0].body.conversationId).not.toBe(creations[1].body.conversationId);
      expect(turns.every(({ body }) => body.message.includes(diagnostic))).toBe(true);
      expect(turns.every(({ body }) => body.displayMessage === "Fix project setup.")).toBe(true);
      expect(fixture.temporary.tasks.value).toHaveLength(2);
      expect(fixture.writes).toHaveLength(0);
      expect(nodeText(fixture.container)).not.toContain("The assistant is working; setup can still be rechecked.");
    } finally {
      fixture.close();
    }
  });

  it.each([
    { state: "new", label: "Start through conversation", title: "Start this project", detail: "I have not selected a starter" },
    { state: "adoption", label: "Inspect it for me", title: "Inspect project setup", detail: "Inspect it for me to identify what it does" },
    { state: "adoption", label: "Set up project", title: "Set up this project", detail: "Invoice processing CLI", purpose: true },
    { state: "attention", label: "Fix it with AI", title: "Fix project setup", detail: "requires a newer Genesis installation", nextAction: "update-genesis" },
    { state: null, label: "Fix it with AI", title: "Fix project setup", detail: "Setup inspection is unavailable.", loadError: true }
  ])("opens Temporary AI for $label ($state) during main assistant work", async ({ state, label, title, detail, purpose, nextAction, loadError }) => {
    mocks.resource.data.value = state ? opening(state) : null;
    if (nextAction) mocks.resource.data.value.inspection.nextAction = nextAction;
    if (loadError) mocks.resource.loadError.value = detail;
    const fixture = mountOnboarding({ live: false });
    try {
      fixture.props.busy = true;
      await Vue.nextTick();
      if (purpose) {
        expect(fixture.button(label).props.disabled).toBe(true);
        const field = findNode(fixture.container, ({ type }) => type === "textarea");
        expect(field.props.disabled).toBe(false);
        field.props["onUpdate:modelValue"](detail);
        await Vue.nextTick();
      }
      expect(fixture.button(label).props.disabled).toBe(false);
      await fixture.button(label).props.onClick();
      expect(fixture.requestTemporaryAi).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        title, message: expect.stringContaining(detail)
      }));
      if (state === "new") {
        expect(fixture.button("Public starter").props.disabled).toBe(true);
        await fixture.button("Public starter").props.onClick();
        expect(fixture.writes).toHaveLength(0);
      }
    } finally {
      fixture.close();
    }
  });

  it("guards duplicate help clicks, recovers after a failed start and respects assistant access", async () => {
    mocks.resource.data.value = opening("attention");
    const fixture = mountOnboarding({ live: false });
    const start = Promise.withResolvers();
    try {
      fixture.props.busy = true;
      fixture.requestTemporaryAi.mockReturnValueOnce(start.promise);
      const help = fixture.button("Fix it with AI");
      help.props.onClick();
      const pending = fixture.requestTemporaryAi.mock.results.at(-1).value;
      await Vue.nextTick();
      expect(help.props.disabled).toBe(true);
      expect(nodeText(fixture.container)).toContain("Opening…");
      await help.props.onClick();
      expect(fixture.requestTemporaryAi).toHaveBeenCalledOnce();
      start.resolve({ ok: false });
      await pending;
      await Vue.nextTick();
      expect(help.props.disabled).toBe(false);
      fixture.props.canAsk = false;
      await Vue.nextTick();
      expect(help.props.disabled).toBe(true);
      await help.props.onClick();
      expect(fixture.requestTemporaryAi).toHaveBeenCalledOnce();
    } finally {
      start.resolve({ ok: false });
      fixture.close();
    }
  });

  it.each([
    { hidden: "Dashboard", active: true, projectPane: "dashboard" },
    { hidden: "an inactive host", active: false, projectPane: "preview" }
  ])("does not inspect on a cold mount hidden by $hidden", async ({ active, projectPane }) => {
    const fixture = mountOnboarding({ active, projectPane });
    try {
      await Vue.nextTick();
      await fixture.projectChanged();
      expect(fixture.reads).toHaveLength(0);
      expect(fixture.listeners.size).toBe(0);
      expect(fixture.outputs.mounted).not.toHaveBeenCalled();

      fixture.props.active = true;
      fixture.props.projectPane = "preview";
      await Vue.nextTick();
      expect(fixture.reads).toHaveLength(1);
      expect(fixture.reads[0].options.query).toEqual({ sessionId: "session-a" });
      await fixture.settleRead(0);
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
    } finally {
      fixture.close();
    }
  });

  it.each(["Dashboard", "inactive host"])("retains cached outputs without hidden reads through %s and refreshes once on return", async (hidden) => {
    const fixture = mountOnboarding();
    try {
      await fixture.settleRead(0);
      const output = findNode(fixture.container, (node) => node.type === "output");
      expect(output).not.toBeNull();
      expect(fixture.listeners.size).toBe(1);
      await fixture.projectChanged("another-project");
      expect(fixture.reads).toHaveLength(1);

      if (hidden === "Dashboard") fixture.props.projectPane = "dashboard";
      else fixture.props.active = false;
      await Vue.nextTick();
      await fixture.projectChanged();
      fixture.props.busy = true;
      await Vue.nextTick();
      fixture.props.busy = false;
      await Vue.nextTick();
      expect(fixture.reads).toHaveLength(1);
      expect(fixture.listeners.size).toBe(0);
      expect(findNode(fixture.container, (node) => node.type === "output")).toBe(output);
      expect(fixture.outputs.unmounted).not.toHaveBeenCalled();

      fixture.props.active = true;
      fixture.props.projectPane = "preview";
      await Vue.nextTick();
      expect(fixture.reads).toHaveLength(2);
      expect(fixture.listeners.size).toBe(1);
      expect(findNode(fixture.container, (node) => node.type === "output")).toBe(output);
      await fixture.settleRead(1);
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
      expect(fixture.outputs.unmounted).not.toHaveBeenCalled();
      await fixture.projectChanged();
      expect(fixture.reads).toHaveLength(3);
      await fixture.settleRead(2);
    } finally {
      fixture.close();
    }
    expect(fixture.listeners.size).toBe(0);
    expect(fixture.outputs.unmounted).toHaveBeenCalledOnce();
    await fixture.projectChanged();
    expect(fixture.reads).toHaveLength(3);
  });

  it("lets an admitted inspection finish while hidden without starting another read", async () => {
    const fixture = mountOnboarding();
    try {
      expect(fixture.reads).toHaveLength(1);
      fixture.props.active = false;
      await Vue.nextTick();
      await fixture.settleRead(0);
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
      await fixture.projectChanged();
      expect(fixture.reads).toHaveLength(1);
      expect(fixture.listeners.size).toBe(0);
      fixture.props.active = true;
      await Vue.nextTick();
      expect(fixture.reads).toHaveLength(2);
      await fixture.settleRead(1);
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
    } finally {
      fixture.close();
    }
  });

  it.each(["Dashboard", "inactive host"])("defers a late starter acknowledgement's inspection while hidden by %s", async (hidden) => {
    const fixture = mountOnboarding();
    let applying = Promise.resolve();
    try {
      await fixture.settleRead(0, opening("new"));
      applying = fixture.button("Public starter").props.onClick();
      let settled = false;
      void applying.then(() => { settled = true; }, () => { settled = true; });
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      expect(fixture.writes[0].options.body).toEqual({ sessionId: "session-a", templateId: "official:jskit/public" });
      if (hidden === "Dashboard") fixture.props.projectPane = "dashboard";
      else fixture.props.active = false;
      await Vue.nextTick();
      fixture.writes[0].resolve({ ok: true });
      // A regressed reload holds apply open; observe either outcome before asserting,
      // so cleanup can release the extra HTTP request instead of hanging the test.
      await vi.waitFor(() => expect(settled || fixture.reads.length > 1).toBe(true));
      expect(fixture.reads).toHaveLength(1);
      await applying;
      await Vue.nextTick();
      expect(nodeText(fixture.container)).not.toContain("Preparing your starter");
      expect(fixture.button("Public starter").props.disabled).toBe(true);
      await fixture.projectChanged();
      expect(fixture.reads).toHaveLength(1);

      fixture.props.active = true;
      fixture.props.projectPane = "preview";
      await Vue.nextTick();
      expect(fixture.reads).toHaveLength(2);
      await fixture.settleRead(1);
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
      expect(fixture.writes).toHaveLength(1);
    } finally {
      fixture.close();
      await applying.catch(() => {});
    }
  });

  it("does not reload a replacement session after the previous starter acknowledges", async () => {
    const fixture = mountOnboarding();
    let applying = Promise.resolve();
    try {
      await fixture.settleRead(0, opening("new"));
      applying = fixture.button("Public starter").props.onClick();
      void applying.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      fixture.props.sessionId = "session-b";
      await Vue.nextTick();
      expect(fixture.reads).toHaveLength(2);
      expect(fixture.reads[1].options.query).toEqual({ sessionId: "session-b" });
      fixture.writes[0].resolve({ ok: true });
      await applying;
      expect(fixture.reads).toHaveLength(2);
      await fixture.settleRead(1, opening("adoption", "session-b"));
      expect(nodeText(fixture.container)).toContain("Set up this existing project");
      expect(nodeText(fixture.container)).not.toContain("Public starter");
      expect(fixture.outputs.mounted).not.toHaveBeenCalled();
    } finally {
      fixture.close();
      await applying.catch(() => {});
    }
  });

  it("does not inspect after a pending starter's component unmounts and refreshes once on remount", async () => {
    const fixture = mountOnboarding();
    let applying = Promise.resolve();
    try {
      await fixture.settleRead(0, opening("new"));
      applying = fixture.button("Public starter").props.onClick();
      let settled = false;
      void applying.then(() => { settled = true; }, () => { settled = true; });
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      fixture.props.mounted = false;
      await Vue.nextTick();
      expect(fixture.props.active).toBe(true);
      expect(fixture.listeners.size).toBe(0);
      fixture.writes[0].resolve({ ok: true });
      await vi.waitFor(() => expect(settled || fixture.reads.length > 1).toBe(true));
      expect(fixture.reads).toHaveLength(1);
      await applying;

      fixture.props.mounted = true;
      await Vue.nextTick();
      expect(fixture.reads).toHaveLength(2);
      await fixture.settleRead(1);
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
      expect(fixture.writes).toHaveLength(1);
    } finally {
      fixture.close();
      await applying.catch(() => {});
    }
  });

  it("handles a real starter POST failure once and retains the choice for retry", async () => {
    const fixture = mountOnboarding();
    let applying = Promise.resolve();
    try {
      await fixture.settleRead(0, opening("new"));
      applying = fixture.button("Public starter").props.onClick();
      const outcome = applying.then(() => null, (error) => error);
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      expect(fixture.button("Public starter").props.disabled).toBe(true);
      await fixture.button("Public starter").props.onClick();
      expect(fixture.writes).toHaveLength(1);
      const failure = new Error("The selected starter could not be downloaded.");
      fixture.writes[0].reject(failure);
      expect(await outcome).toBeNull();
      await Vue.nextTick();
      expect(fixture.feedback.report).toHaveBeenCalledOnce();
      expect(fixture.feedback.report).toHaveBeenCalledWith(expect.objectContaining({
        cause: failure, intent: "action-feedback", severity: "error"
      }));
      expect(fixture.button("Public starter").props.disabled).toBe(false);
      expect(nodeText(fixture.container)).not.toContain("Preparing your starter");
      expect(fixture.reads).toHaveLength(1);

      applying = fixture.button("Public starter").props.onClick();
      void applying.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(2));
      expect(fixture.writes[1].options.body).toEqual(fixture.writes[0].options.body);
      fixture.writes[1].resolve({ ok: true });
      await vi.waitFor(() => expect(fixture.reads).toHaveLength(2));
      expect(fixture.button("Public starter").props.disabled).toBe(true);
      expect(nodeText(fixture.container)).toContain("Preparing your starter");
      await fixture.settleRead(1);
      await applying;
      expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
      expect(fixture.feedback.report).toHaveBeenCalledTimes(2);
    } finally {
      fixture.close();
      await applying.catch(() => {});
    }
  });

  it("propagates an unexpected starter reload failure and releases pending state", async () => {
    mocks.resource.data.value = opening("new");
    const failure = new Error("Unexpected onboarding refresh failure.");
    mocks.resource.reload.mockRejectedValueOnce(failure);
    const fixture = mountOnboarding({ live: false });
    try {
      await expect(fixture.button("Public starter").props.onClick()).rejects.toBe(failure);
      await Vue.nextTick();
      expect(fixture.button("Public starter").props.disabled).toBe(false);
      expect(nodeText(fixture.container)).not.toContain("Preparing your starter");
      await fixture.button("Public starter").props.onClick();
      expect(mocks.resource.reload).toHaveBeenCalledTimes(2);
    } finally {
      fixture.close();
    }
  });
});

const visualRequest = { attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", visualId: "alternate" };
function visualResource(pause = true) {
  const resource = alternateVisualResource();
  if (pause) resource.visual.commands.push({ name: "pause", completionState: "unchanged", parameters: [] });
  return resource;
}

it("rejects opening promptly when the original player reports a construction error without a state event", async () => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    await fixture.settleRead(0);
    const handle = fixture.colleaguePreview.value.presentation;
    const pending = handle.open(visualRequest).catch(error => error);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    fixture.visualReads[0].resolve(visualResource());
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
    mocks.visuals[0].failMount("The diagram could not construct its player.");
    expect((await pending).message).toBe("The diagram could not construct its player.");
    expect(handle.state.phase).toBe("failed");
    expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
    expect(fixture.outputs.unmounted).not.toHaveBeenCalled();
    expect(fixture.writes).toHaveLength(0);
  } finally { fixture.close(); }
});

it("publishes a live optional presentation handle through the original displayed Preview owner", async () => {
  const fixture = mountOnboarding();
  try {
    const owner = fixture.colleaguePreview.value;
    expect(owner.presentation).toBeNull();
    const first = { state: { phase: "ready" } };
    fixture.props.presentation = first;
    await Vue.nextTick();
    expect(fixture.colleaguePreview.value).toBe(owner);
    expect(owner.presentation).toBe(fixture.props.presentation);
    fixture.props.presentation = null;
    await Vue.nextTick();
    expect(owner.presentation).toBeNull();
    expect(fixture.visualReads).toHaveLength(0);
    expect(fixture.writes).toHaveLength(0);
  } finally { fixture.close(); }
});

it("opens only after actual player readiness and preserves the original App slot through switch/collapse/reopen", async () => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    await fixture.settleRead(0);
    const output = findNode(fixture.container, node => node.type === "output");
    const owner = fixture.colleaguePreview.value;
    const handle = owner.presentation;
    let opened = false;
    const pending = handle.open(visualRequest).then(value => { opened = true; return value; });
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    expect(fixture.visualReads[0].url).toBe(`/api/vibe64/training/attempts/${visualRequest.attemptId}/visuals/alternate`);
    expect(fixture.visualReads[0].options).toEqual({ method: "GET" });
    fixture.visualReads[0].resolve(visualResource());
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
    expect(opened).toBe(false);
    expect(handle.state.phase).toBe("loading");
    mocks.visuals[0].ready();
    expect(await pending).toEqual(expect.objectContaining({ ok: true, ...visualRequest, phase: "ready", visible: true }));
    expect(fixture.colleaguePreview.value).toBe(owner);
    expect(findNode(fixture.container, node => node.type === "output")).toBe(output);
    expect(fixture.outputs.mounted).toHaveBeenCalledOnce();
    fixture.button("Minimise presentation").props.onClick();
    await vi.waitFor(() => expect(mocks.visuals[0].operations).toHaveLength(1));
    expect(mocks.visuals[0].operations[0].input.name).toBe("pause");
    mocks.visuals[0].finish(0, { paused: true });
    await Vue.nextTick();
    expect(handle.state.visible).toBe(false);
    fixture.button("Restore presentation").props.onClick();
    await Vue.nextTick();
    expect(handle.state.visible).toBe(true);
    expect(mocks.visuals[0].operations).toHaveLength(1);
    expect(mocks.visuals[0].disposed).toBe(false);
    expect((await handle.open(visualRequest)).playerInstanceId).toBe("fixture-1");
    expect(fixture.visualReads).toHaveLength(1);
    fixture.button("App preview").props.onClick();
    await vi.waitFor(() => expect(mocks.visuals[0].operations).toHaveLength(2));
    mocks.visuals[0].finish(1, { paused: true });
    fixture.button("Colleague presentation").props.onClick();
    await Vue.nextTick();
    expect(findNode(fixture.container, node => node.type === "output")).toBe(output);
    expect(fixture.outputs.unmounted).not.toHaveBeenCalled();
    expect(mocks.visuals).toHaveLength(1);
    expect(mocks.visuals[0].operations).toHaveLength(2);
  } finally { fixture.close(); }
});

it("keeps accepted commands provisional, returns actual completion/snapshot and rejects wrong identities or hidden motion", async () => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    await fixture.settleRead(0);
    const handle = fixture.colleaguePreview.value.presentation;
    const opening = handle.open(visualRequest);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    fixture.visualReads[0].resolve(visualResource(false));
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
    mocks.visuals[0].ready();
    await opening;
    for (const input of [{ ...visualRequest, visualId: "other" }, { ...visualRequest, attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]) {
      await expect(handle.command({ ...input, commandId: "command-one", name: "advance" })).rejects.toThrow("exact displayed");
      await expect(handle.snapshot(input)).rejects.toThrow("exact displayed");
    }
    expect(mocks.visuals[0].operations).toHaveLength(0);
    let completed = false;
    const pending = handle.command({ ...visualRequest, commandId: "command-one", name: "advance", parameters: { label: "Seen" } })
      .then(value => { completed = true; return value; });
    await Vue.nextTick();
    expect(completed).toBe(false);
    expect(handle.state.phase).toBe("accepted");
    mocks.visuals[0].finish(0, { state: "shown", labels: { caption: "Seen" } });
    expect(await pending).toEqual({ ok: true, ...visualRequest, playerInstanceId: "fixture-1", phase: "completed",
      commandId: "command-one", state: "shown", description: "Actual completed display" });
    const snapshot = await handle.snapshot(visualRequest);
    expect(snapshot.snapshot).toEqual({ state: "shown", paused: false, labels: { caption: "Seen" } });
    expect(JSON.stringify(handle.state)).not.toContain("controller");
    expect(Object.keys(handle)).toEqual(["open", "command", "snapshot", "armCue", "observeCue", "playback", "retireCue", "state"]);
    fixture.props.projectPane = "dashboard";
    await Vue.nextTick();
    expect(handle.state.visible).toBe(false);
    await expect(handle.command({ ...visualRequest, commandId: "hidden", name: "advance" })).rejects.toThrow("Show the lesson");
    expect(mocks.visuals[0].operations).toHaveLength(1);
    fixture.props.projectPane = "preview";
    await Vue.nextTick();
    expect(mocks.visuals[0].operations).toHaveLength(1);
    const failed = handle.command({ ...visualRequest, commandId: "command-failed", name: "advance" });
    const failure = Object.assign(new Error("The authored command failed."), { code: "interrupted" });
    mocks.visuals[0].operations[1].reject(failure);
    await expect(failed).rejects.toBe(failure);
  } finally { fixture.close(); }
});

it.each(["actor", "session", "unmount"])("retires late resource responses on %s change without changing the App owner", async change => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    await fixture.settleRead(0);
    const handle = fixture.colleaguePreview.value.presentation;
    const pending = handle.open(visualRequest).catch(error => error);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    if (change === "actor") fixture.viewer.value = null;
    if (change === "session") fixture.props.sessionId = "session-b";
    if (change === "unmount") fixture.props.mounted = false;
    await Vue.nextTick();
    fixture.visualReads[0].resolve(visualResource());
    expect(await pending).toBeInstanceOf(Error);
    expect(handle.state.phase).toBe("closed");
    expect(mocks.visuals).toHaveLength(0);
    expect(fixture.writes).toHaveLength(0);
  } finally { fixture.close(); }
});

it("retires pending actual readiness on account change and keeps resource failure retry read-only", async () => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    await fixture.settleRead(0);
    const handle = fixture.colleaguePreview.value.presentation;
    const failed = handle.open(visualRequest);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    fixture.visualReads[0].resolve({ id: "wrong" });
    await expect(failed).rejects.toThrow("did not match");
    expect(handle.state.phase).toBe("failed");
    const pending = handle.open(visualRequest).catch(error => error);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(2));
    fixture.visualReads[1].resolve(visualResource());
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
    fixture.viewer.value = { actorKey: "member-43" };
    await Vue.nextTick();
    expect(await pending).toBeInstanceOf(Error);
    expect(handle.state.phase).toBe("closed");
    expect(mocks.visuals[0].disposed).toBe(true);
    expect(fixture.writes).toHaveLength(0);
  } finally { fixture.close(); }
});

const cueInput = { ...visualRequest, cueId: "cue-one", commandId: "transition-one", navigationId: "navigation-one",
  conversationId: "conversation-a", turnId: "turn-a", clientId: "browser-a", name: "advance", parameters: {} };
async function openCueFixture(fixture) {
  await fixture.settleRead(0);
  const handle = fixture.colleaguePreview.value.presentation;
  const opening = handle.open(visualRequest);
  await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
  fixture.visualReads[0].resolve(visualResource());
  await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
  mocks.visuals[0].ready();
  await opening;
  const armed = await handle.armCue(cueInput);
  expect(armed.phase).toBe("armed");
  expect(armed.canonicalFinal).toBe(false);
  expect(mocks.visuals[0].operations).toHaveLength(0);
  return { handle, armed, final: { ...armed, outputId: "turn-a:reply-final", canonicalFinal: true, phase: "bound" } };
}

it.each(["audio-first", "visual-first"])("a cue waits for actual final identity and both real completion receipts: %s", async order => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    const { handle, armed, final } = await openCueFixture(fixture);
    expect(handle.observeCue({ ...armed, outputId: "progress", canonicalFinal: false }, { readAloud: true })).toBe(false);
    expect(handle.playback({ conversationId: "conversation-a", outputId: "progress", phase: "started" })).toBe(false);
    expect(mocks.visuals[0].operations).toHaveLength(0);
    expect(handle.observeCue(final, { readAloud: true })).toBe(true);
    expect(handle.state.cue.phase).toBe("awaiting-audio");
    expect(handle.playback({ conversationId: "other", outputId: final.outputId, phase: "started" })).toBe(false);
    expect(handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "completed" })).toBe(true);
    expect(mocks.visuals[0].operations).toHaveLength(0);
    handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "started" });
    await Vue.nextTick();
    expect(mocks.visuals[0].operations).toHaveLength(1);
    expect(mocks.visuals[0].operations[0].input.commandId).toBe(cueInput.commandId);
    expect(handle.state.cue.visualPhase).toBe("accepted");
    expect(handle.state.cue.phase).toBe("playing");
    const completeAudio = () => handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "completed" });
    if (order === "audio-first") {
      completeAudio();
      expect(handle.state.cue.phase).toBe("playing");
    }
    mocks.visuals[0].finish(0, { state: "shown" });
    await vi.waitFor(() => expect(handle.state.cue.visualPhase).toBe("completed"));
    if (order === "visual-first") {
      expect(handle.state.cue.phase).toBe("playing");
      completeAudio();
    }
    expect(handle.state.cue).toEqual(expect.objectContaining({ phase: "completed", visualPhase: "completed", audioPhase: "completed", state: "shown" }));
    handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "started" });
    expect(mocks.visuals[0].operations).toHaveLength(1);
  } finally { fixture.close(); }
});

it("sound-off Continue waits for the final canonical explanation and never fabricates an audio receipt", async () => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    const { handle, final } = await openCueFixture(fixture);
    expect(fixture.button("Continue")).toBeNull();
    handle.observeCue(final, { readAloud: false });
    await Vue.nextTick();
    expect(mocks.visuals[0].operations).toHaveLength(0);
    expect(handle.state.cue.phase).toBe("awaiting-continue");
    fixture.button("Continue").props.onClick();
    await Vue.nextTick();
    expect(mocks.visuals[0].operations).toHaveLength(1);
    mocks.visuals[0].finish(0, { state: "shown" });
    await vi.waitFor(() => expect(handle.state.cue.phase).toBe("completed"));
    expect(handle.state.cue.audioPhase).toBe("off");
  } finally { fixture.close(); }
});

it("blocked/no-audio needs an explicit Continue; hidden and retired players cannot replay the cue", async () => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    const { handle, final } = await openCueFixture(fixture);
    handle.observeCue(final, { readAloud: true });
    handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "failed", reason: "no-audio" });
    await Vue.nextTick();
    expect(handle.state.cue.phase).toBe("awaiting-continue");
    expect(mocks.visuals[0].operations).toHaveLength(0);
    fixture.button("Minimise presentation").props.onClick();
    await vi.waitFor(() => expect(mocks.visuals[0].operations).toHaveLength(1));
    expect(mocks.visuals[0].operations[0].input.name).toBe("pause");
    mocks.visuals[0].finish(0, { paused: true });
    await Vue.nextTick();
    expect(handle.state.cue.phase).toBe("interrupted");
    fixture.button("Restore presentation").props.onClick();
    handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "started" });
    await Vue.nextTick();
    expect(mocks.visuals[0].operations).toHaveLength(1);
    await handle.armCue({ ...cueInput, cueId: "cue-two" });
    mocks.visuals[0].state({ attemptId: visualRequest.attemptId, playerInstanceId: "reloaded-instance", phase: "loading" });
    expect(handle.state.cue.phase).toBe("interrupted");
    expect(handle.observeCue(final, { readAloud: true })).toBe(false);
    fixture.viewer.value = null;
    await Vue.nextTick();
    expect(handle.state.cue).toBeUndefined();
  } finally { fixture.close(); }
});

it("interrupting a running cue pauses the same original player and never reports completion", async () => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    const { handle, final } = await openCueFixture(fixture);
    handle.observeCue(final, { readAloud: true });
    handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "started" });
    await Vue.nextTick();
    handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "interrupted" });
    await vi.waitFor(() => expect(mocks.visuals[0].operations).toHaveLength(2));
    expect(mocks.visuals[0].operations[1].input.name).toBe("pause");
    mocks.visuals[0].operations[0].reject(new Error("The authored transition was paused."));
    mocks.visuals[0].finish(1, { paused: true });
    await Vue.nextTick();
    expect(handle.state.cue.phase).toBe("interrupted");
    expect((await handle.snapshot(visualRequest)).snapshot.paused).toBe(true);
    handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "completed" });
    expect(handle.state.cue.phase).toBe("interrupted");
  } finally { fixture.close(); }
});

it("a stopped armed cue ignores its late final identity and never starts motion", async () => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    const { handle, final } = await openCueFixture(fixture);
    handle.retireCue("The learner stopped the explanation.");
    await vi.waitFor(() => expect(mocks.visuals[0].operations).toHaveLength(1));
    expect(mocks.visuals[0].operations[0].input.name).toBe("pause");
    mocks.visuals[0].finish(0, { paused: true });
    expect(handle.observeCue(final, { readAloud: true })).toBe(false);
    handle.playback({ conversationId: "conversation-a", outputId: final.outputId, phase: "started" });
    expect(handle.state.cue.phase).toBe("interrupted");
    expect(handle.state.cue.outputId).toBe("");
    expect(mocks.visuals[0].operations).toHaveLength(1);
  } finally { fixture.close(); }
});


it("offers opt-in App/Lessons/Presentation in one retained original host without remounting slots or player", async () => {
  const fixture = mountOnboarding({ withPresentation: true, lessonsAvailable: true, attemptId: visualRequest.attemptId });
  try {
    fixture.button("App").props.onClick(); await Vue.nextTick();
    await vi.waitFor(() => expect(fixture.reads).toHaveLength(1));
    await fixture.settleRead(0);
    fixture.button("Lessons").props.onClick(); await Vue.nextTick();
    const output = findNode(fixture.container, node => node.type === "output");
    const picker = findNode(fixture.container, node => node.props?.["aria-label"] === "Lesson picker selection");
    picker.props.value = "retained exact release";
    expect(fixture.button("Lessons").props["aria-pressed"]).toBe(true);
    const handle = fixture.presentationHost.value.presentation;
    await expect(handle.open({ ...visualRequest, attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })).rejects.toThrow("exact attempt");
    expect(fixture.visualReads).toHaveLength(0);
    const opening = handle.open(visualRequest);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    fixture.visualReads[0].resolve(visualResource(false));
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
    mocks.visuals[0].ready(); await opening;
    const playerId = handle.state.playerInstanceId;
    fixture.button("Lessons").props.onClick(); await Vue.nextTick();
    expect(handle.state.visible).toBe(false);
    expect(findNode(fixture.container, node => node.props?.["aria-label"] === "Lesson picker selection")).toBe(picker);
    expect(picker.props.value).toBe("retained exact release");
    fixture.button("App").props.onClick(); await Vue.nextTick();
    expect(findNode(fixture.container, node => node.type === "output")).toBe(output);
    expect(fixture.outputs.mounted).toHaveBeenCalledOnce(); expect(fixture.outputs.unmounted).not.toHaveBeenCalled();
    fixture.button("Presentation").props.onClick(); await Vue.nextTick();
    expect(handle.state.visible).toBe(true); expect(handle.state.playerInstanceId).toBe(playerId);
    expect(mocks.visuals).toHaveLength(1);
    fixture.props.attemptId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; await Vue.nextTick();
    expect(handle.state.phase).toBe("closed"); expect(handle.state.attemptId).toBeUndefined();
    expect(fixture.visualReads).toHaveLength(1);
  } finally { fixture.close(); }
});

it("shows Lessons without creating a source-less App or claiming an available presentation", async () => {
  const fixture = mountOnboarding({ withPresentation: true, lessonsAvailable: true, appAvailable: false, attemptId: visualRequest.attemptId });
  try {
    await Vue.nextTick();
    expect(fixture.reads).toHaveLength(0); expect(fixture.outputs.mounted).not.toHaveBeenCalled();
    expect(fixture.button("App")).toBeNull();
    expect(fixture.button("Lessons").props["aria-pressed"]).toBe(true);
    expect(fixture.button("Presentation").props.disabled).toBe(true);
    expect(nodeText(fixture.container)).toContain("This lesson has no App preview. No lesson presentation is open.");
    await expect(fixture.presentationHost.value.presentation.open(visualRequest)).rejects.toThrow("exact attempt");
    expect(fixture.visualReads).toHaveLength(0); expect(fixture.writes).toHaveLength(0);
  } finally { fixture.close(); }
});


it("keeps original fresh checkpoint reads and writes distinct from opening without hiding their exact receipts", async () => {
  const fixture = mountOnboarding({ withPresentation: true });
  try {
    await fixture.settleRead(0);
    const handle = fixture.presentationHost.value.presentation;
    const opening = handle.open(visualRequest);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    fixture.visualReads[0].resolve(visualResource(false));
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
    mocks.visuals[0].ready(); await opening;
    const pending = handle.command({ ...visualRequest, commandId: "fresh-checkpoint", name: "advance" });
    mocks.visuals[0].finish(0, { state: "shown", labels: { caption: "Saved actual state" } });
    expect((await pending).phase).toBe("completed");
    expect(fixture.visualReads).toHaveLength(1);
    expect(fixture.checkpointReads).toHaveLength(1);
    expect(fixture.checkpointWrites).toHaveLength(1);
    expect(fixture.checkpointReads[0].url).toBe(fixture.visualReads[0].url);
    expect(fixture.checkpointWrites[0].url).toBe(fixture.visualReads[0].url);
    expect(fixture.checkpointWrites[0].options.body).toEqual(expect.objectContaining({
      projectSlug: "project-a", sessionId: "session-a", expectedRevision: 0,
      snapshot: { state: "shown", paused: false, labels: { caption: "Saved actual state" } }
    }));
  } finally { fixture.close(); }
});


it("honours a newer hide of the same player while its earlier pause checkpoint is held without replaying that save", async () => {
  const fixture = mountOnboarding({ withPresentation: true, holdCheckpoints: true });
  try {
    await fixture.settleRead(0);
    const handle = fixture.presentationHost.value.presentation;
    const opening = handle.open(visualRequest);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    fixture.visualReads[0].resolve(visualResource());
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
    mocks.visuals[0].ready(); await opening;
    fixture.button("Minimise presentation").props.onClick();
    await vi.waitFor(() => expect(mocks.visuals[0].operations).toHaveLength(1));
    mocks.visuals[0].finish(0, { paused: true });
    await vi.waitFor(() => expect(fixture.checkpointReads).toHaveLength(1));
    fixture.button("Restore presentation").props.onClick(); await Vue.nextTick();
    expect(handle.state.visible).toBe(true);
    fixture.button("App preview").props.onClick(); await Vue.nextTick();
    expect(handle.state.visible).toBe(false);
    expect(mocks.visuals[0].operations).toHaveLength(1);
    expect(fixture.checkpointWrites).toHaveLength(0);
    fixture.checkpointReads[0].resolve();
    await vi.waitFor(() => expect(mocks.visuals[0].operations).toHaveLength(2));
    expect(mocks.visuals[0].operations.map(value => value.input.name)).toEqual(["pause", "pause"]);
    expect(mocks.visuals[0].operations[0].input.commandId).not.toBe(mocks.visuals[0].operations[1].input.commandId);
    expect(fixture.checkpointWrites).toHaveLength(1);
    mocks.visuals[0].finish(1, { paused: true });
    await vi.waitFor(() => expect(fixture.checkpointReads).toHaveLength(2));
    fixture.checkpointReads[1].resolve();
    await vi.waitFor(() => expect(fixture.checkpointWrites).toHaveLength(2));
    await Vue.nextTick(); await Vue.nextTick();
    expect(mocks.visuals[0].operations).toHaveLength(2);
    expect(new Set(fixture.checkpointWrites.map(value => value.options.body.requestId)).size).toBe(2);
    expect(fixture.checkpointWrites.map(value => value.options.body.expectedRevision)).toEqual([0, 1]);
  } finally { fixture.close(); }
});


it("uses the actual compiled Autopilot choices for display, original bridge and toolbar truth while Learning stays on its dashboard pane", async () => {
  const fixture = mountOnboarding({ withAutopilotPreview: true, lessonsAvailable: true, projectPane: "dashboard" });
  try {
    await Vue.nextTick(); await Vue.nextTick();
    expect(fixture.reads).toHaveLength(0);
    const bridge = fixture.colleaguePreview.value;
    expect(bridge).toBeTruthy(); expect(bridge.screen).toBeUndefined();
    const lessons = findNode(fixture.container, node => node.props?.["aria-label"] === "Actual Lessons slot");
    const opening = bridge.presentation.open(visualRequest);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    fixture.visualReads[0].resolve(visualResource(false));
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
    mocks.visuals[0].ready(); await opening; await Vue.nextTick();
    expect(bridge.presentation.state.visible).toBe(true);
    expect(fixture.colleaguePreview.value).toBe(bridge);
    expect(fixture.reads).toHaveLength(0); expect(fixture.outputs.mounted).not.toHaveBeenCalled();
    expect(Vue.toValue(mocks.query.enabled)).toBe(false);
    fixture.button("App").props.onClick(); await Vue.nextTick();
    await vi.waitFor(() => expect(fixture.reads).toHaveLength(1)); await fixture.settleRead(0);
    const output = findNode(fixture.container, node => node.type === "output");
    expect(fixture.props.projectPane).toBe("dashboard");
    expect(fixture.colleaguePreview.value).toBe(bridge); expect(bridge.screen).toBe("outputs");
    expect(fixture.outputs.controls.value.previewDisplayed).toBe(true);
    expect(fixture.outputs.controls.value.windowDisplayed).toBe(true);
    expect(fixture.outputs.controls.value.toolbarTeleportTarget).toBe("#actual-preview-toolbar");
    fixture.button("Presentation").props.onClick(); await Vue.nextTick();
    expect(fixture.colleaguePreview.value).toBe(bridge); expect(bridge.presentation.state.visible).toBe(true);
    expect(bridge.screen).toBeUndefined(); expect(Vue.toValue(mocks.query.enabled)).toBe(false);
    expect(fixture.outputs.controls.value.previewDisplayed).toBe(false);
    expect(fixture.outputs.controls.value.windowDisplayed).toBe(true);
    expect(fixture.outputs.controls.value.toolbarTeleportTarget).toBe("");
    fixture.button("Lessons").props.onClick(); await Vue.nextTick();
    expect(fixture.colleaguePreview.value).toBe(bridge); expect(bridge.presentation.state.visible).toBe(false);
    expect(bridge.screen).toBeUndefined(); expect(Vue.toValue(mocks.query.enabled)).toBe(false);
    expect(fixture.outputs.controls.value.previewDisplayed).toBe(false);
    expect(fixture.outputs.controls.value.windowDisplayed).toBe(true);
    expect(fixture.outputs.controls.value.toolbarTeleportTarget).toBe("");
    expect(findNode(fixture.container, node => node.type === "output")).toBe(output);
    expect(findNode(fixture.container, node => node.props?.["aria-label"] === "Actual Lessons slot")).toBe(lessons);
    expect(fixture.outputs.mounted).toHaveBeenCalledOnce(); expect(fixture.outputs.unmounted).not.toHaveBeenCalled();
    expect(mocks.visuals).toHaveLength(1); expect(mocks.visuals[0].disposed).toBe(false);
    fixture.button("App").props.onClick(); await Vue.nextTick();
    expect(fixture.colleaguePreview.value).toBe(bridge);
    expect(fixture.outputs.controls.value.previewDisplayed).toBe(true);
    expect(Vue.toValue(mocks.query.enabled)).toBe(true);
    fixture.props.active = false; await Vue.nextTick();
    expect(fixture.colleaguePreview.value).toBeNull();
    expect(fixture.outputs.controls.value.windowDisplayed).toBe(false);
  } finally { fixture.close(); }
});

it("does not mount source-backed App owners in the actual source-less Autopilot Preview composition", async () => {
  const fixture = mountOnboarding({ withAutopilotPreview: true, lessonsAvailable: true, appAvailable: false, projectPane: "dashboard" });
  try {
    await Vue.nextTick(); await Vue.nextTick();
    expect(fixture.reads).toHaveLength(0); expect(fixture.outputs.mounted).not.toHaveBeenCalled();
    expect(fixture.button("App")).toBeNull(); expect(fixture.button("Presentation").props.disabled).toBe(true);
    expect(findNode(fixture.container, node => node.props?.["aria-label"] === "Actual Lessons slot")).toBeTruthy();
  } finally { fixture.close(); }
});

function configureActualLearningPreview(fixture, bindingChanges = {}) {
  const attempt = visualRequest.attemptId;
  fixture.props.projectSlug = "";
  fixture.props.sessionId = `learning-${attempt}`;
  fixture.props.attemptId = attempt;
  fixture.props.conversationRuntime = { identity: { actorKey: JSON.stringify(["learning", "member-42", "42", attempt]), viewerActorKey: "member-42", learnerId: "42", projectSlug: "",
    learningAttemptId: attempt, sessionId: fixture.props.sessionId,
    sessionsApiPath: `/api/learning/${attempt}/vibe64/sessions`, ...bindingChanges } };
}

it("source-less actual Autopilot Preview opens the same player from Lessons through its captured Main session route and checkpoint", async () => {
  const fixture = mountOnboarding({ withAutopilotPreview: true, lessonsAvailable: true, appAvailable: false, projectPane: "dashboard" });
  try {
    configureActualLearningPreview(fixture);
    await Vue.nextTick(); await Vue.nextTick();
    const bridge = fixture.colleaguePreview.value;
    expect(bridge).toBeTruthy();
    expect(bridge.learningAttemptId).toBe(visualRequest.attemptId);
    expect(bridge.learnerId).toBe("42"); expect(bridge.projectSlug).toBe("");
    expect(bridge.sessionId).toBe(fixture.props.sessionId); expect(bridge.screen).toBeUndefined();
    const handle = bridge.presentation;
    const opening = handle.open(visualRequest);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    const expectedUrl = `/api/learning/${visualRequest.attemptId}/vibe64/sessions/${fixture.props.sessionId}/training/visuals/alternate`;
    expect(fixture.visualReads[0].url).toBe(expectedUrl);
    fixture.visualReads[0].resolve(visualResource());
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1));
    expect(handle.state.phase).toBe("loading"); mocks.visuals[0].ready();
    expect(await opening).toMatchObject({ ok: true, ...visualRequest, phase: "ready", visible: true });
    const command = handle.command({ ...visualRequest, commandId: "learning-advance", name: "advance", parameters: { label: "Seen" } });
    await vi.waitFor(() => expect(mocks.visuals[0].operations).toHaveLength(1));
    expect(fixture.checkpointWrites).toHaveLength(0);
    mocks.visuals[0].finish(0, { state: "arrived", paused: true });
    expect(await command).toMatchObject({ ok: true, commandId: "learning-advance", phase: "completed", state: "arrived" });
    expect(fixture.checkpointWrites).toHaveLength(1);
    expect(fixture.checkpointWrites[0].url).toBe(expectedUrl);
    expect(fixture.checkpointWrites[0].options.body).toEqual({ requestId: expect.any(String), expectedRevision: 0,
      sessionId: fixture.props.sessionId, snapshot: { state: "arrived", paused: true, labels: {} } });
    const player = mocks.visuals[0];
    fixture.button("Lessons").props.onClick(); await Vue.nextTick();
    await vi.waitFor(() => expect(player.operations).toHaveLength(2)); player.finish(1, { paused: true });
    await vi.waitFor(() => expect(fixture.checkpointWrites).toHaveLength(2));
    expect(handle.state.visible).toBe(false); expect(fixture.colleaguePreview.value).toBe(bridge);
    fixture.button("Presentation").props.onClick(); await Vue.nextTick();
    expect(handle.state.visible).toBe(true); expect(mocks.visuals).toHaveLength(1); expect(player.disposed).toBe(false);
    expect(fixture.button("App")).toBeNull(); expect(fixture.reads).toHaveLength(0);
    expect(fixture.outputs.mounted).not.toHaveBeenCalled(); expect(fixture.writes).toHaveLength(0);
    fixture.props.active = false; await Vue.nextTick(); expect(fixture.colleaguePreview.value).toBeNull();
  } finally { fixture.close(); }
});

it("source-less Preview rejects absent foreign mixed or mismatched actual Main bindings before visual reads", async () => {
  for (const changes of [{ viewerActorKey: "member-43" }, { viewerActorKey: "" }, { actorKey: "" }, { learnerId: "" }, { projectSlug: "working" },
    { learningAttemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, { sessionId: "other" },
    { sessionsApiPath: "/api/vibe64/sessions" }]) {
    const fixture = mountOnboarding({ withAutopilotPreview: true, lessonsAvailable: true, appAvailable: false });
    try {
      configureActualLearningPreview(fixture, changes); await Vue.nextTick(); await Vue.nextTick();
      expect(fixture.colleaguePreview.value).toBeNull(); expect(fixture.visualReads).toHaveLength(0);
      expect(fixture.button("Presentation").props.disabled).toBe(true);
      expect(fixture.reads).toHaveLength(0); expect(fixture.outputs.mounted).not.toHaveBeenCalled();
    } finally { fixture.close(); }
  }
});

it("source-less Preview retires a held resource read when its captured learner or API target changes", async () => {
  for (const change of [{ viewerActorKey: "member-43" }, { actorKey: "successor-binding" }, { learnerId: "43" }, { projectSlug: "foreign-working-project" }, { sessionsApiPath: "/api/vibe64/sessions" }]) {
    const fixture = mountOnboarding({ withAutopilotPreview: true, lessonsAvailable: true, appAvailable: false });
    try {
      configureActualLearningPreview(fixture); await Vue.nextTick(); await Vue.nextTick();
      const oldHandle = fixture.colleaguePreview.value.presentation;
      const pending = oldHandle.open(visualRequest).catch(error => error);
      await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
      Object.assign(fixture.props.conversationRuntime.identity, change); await Vue.nextTick();
      fixture.visualReads[0].resolve(visualResource());
      expect((await pending).message).toContain("no longer selected");
      expect(mocks.visuals).toHaveLength(0); expect(fixture.checkpointWrites).toHaveLength(0);
      expect(oldHandle.state.phase).toBe("closed"); expect(oldHandle.state.visible).toBe(false);
      expect(fixture.reads).toHaveLength(0); expect(fixture.outputs.mounted).not.toHaveBeenCalled();
    } finally { fixture.close(); }
  }
});

it("passes the actual retained Main Learning identity into the compiled Preview without replacing its composite actor scope", async () => {
  const fixture = mountOnboarding({ withAutopilotPreview: true, lessonsAvailable: true, appAvailable: false, withLearningMain: true });
  configureActualLearningPreview(fixture);
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setElementText() {}, setText() {}, insert() {}, remove() {}, patchProp() {}, parentNode() {}, nextSibling() {} });
  let runtime;
  const identityApp = renderer.createApp({ setup() {
    runtime = useVibe64ConversationRuntime({ active: false, projectSlug: "", learnerId: "42",
      sessionId: fixture.props.sessionId, learningAttemptId: visualRequest.attemptId,
      sessionsApiPath: `/api/learning/${visualRequest.attemptId}/vibe64/sessions` });
    return () => Vue.h("div");
  } });
  identityApp.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
  identityApp.provide(VIBE64_ASSISTANT_VIEWER_KEY, fixture.viewer);
  provideConversationFixture(identityApp, { connected: false, on() {}, off() {} }, "member-42");
  identityApp.mount({});
  try {
    await vi.waitFor(() => expect(runtime.value).toBeTruthy());
    const original = runtime.value;
    expect(original.identity.actorKey).toBe(JSON.stringify(["learning", "member-42", "42", visualRequest.attemptId]));
    fixture.props.conversationRuntime = original;
    await Vue.nextTick(); await Vue.nextTick();
    const handle = fixture.colleaguePreview.value?.presentation;
    expect(handle).toBeTruthy();
    expect(original.identity.viewerActorKey).toBe("member-42");
    const opening = handle.open(visualRequest);
    await vi.waitFor(() => expect(fixture.visualReads.map(read => read.url)).toEqual([`/api/learning/${visualRequest.attemptId}/vibe64/sessions/${fixture.props.sessionId}/training/visuals/alternate`]));
    expect(fixture.visualReads[0].url).toBe(`/api/learning/${visualRequest.attemptId}/vibe64/sessions/${fixture.props.sessionId}/training/visuals/alternate`);
    fixture.visualReads[0].resolve(visualResource());
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1)); mocks.visuals[0].ready();
    expect(await opening).toMatchObject({ ok: true, phase: "ready", visible: true });
    fixture.viewer.value = { actorKey: "member-43" };
    await Vue.nextTick(); await Vue.nextTick();
    expect(fixture.colleaguePreview.value).toBeNull();
    expect(handle.state.phase).toBe("closed");
    expect(original.identity.actorKey).toBe(JSON.stringify(["learning", "member-42", "42", visualRequest.attemptId]));
    expect(original.identity.viewerActorKey).toBe("member-42");
    for (const read of fixture.learningMainReads) {
      expect(read.options.method).toBe("GET");
      expect(read.url).toBe(`/api/learning/${visualRequest.attemptId}/vibe64/sessions/${fixture.props.sessionId}`);
    }
    expect(fixture.checkpointWrites).toHaveLength(0); expect(fixture.conversationRequests).toHaveLength(0);
  } finally { identityApp.unmount(); fixture.close(); }
});


it("opens the same lesson player for a captured practice Main target and retires a changed source display identity", async () => {
  const fixture = mountOnboarding({ withAutopilotPreview: true, lessonsAvailable: true, appAvailable: false, projectPane: "dashboard", practiceLearning: true });
  try {
    configureActualLearningPreview(fixture, { noExercise: false, sourceProjectSlug: "practice-confirmed" });
    fixture.props.sessionId = `training-${visualRequest.attemptId}`;
    fixture.props.conversationRuntime.identity.sessionId = fixture.props.sessionId;
    await Vue.nextTick(); await Vue.nextTick();
    const bridge = fixture.colleaguePreview.value;
    expect(bridge).toBeTruthy(); expect(bridge.projectSlug).toBe("practice-confirmed");
    expect(bridge.sessionId).toBe(fixture.props.sessionId);
    expect(fixture.props.conversationRuntime.identity.projectSlug).toBe("");
    const opening = bridge.presentation.open(visualRequest);
    await vi.waitFor(() => expect(fixture.visualReads).toHaveLength(1));
    const expectedUrl = `/api/learning/${visualRequest.attemptId}/vibe64/sessions/${fixture.props.sessionId}/training/visuals/alternate`;
    expect(fixture.visualReads[0].url).toBe(expectedUrl);
    fixture.visualReads[0].resolve(visualResource());
    await vi.waitFor(() => expect(mocks.visuals).toHaveLength(1)); mocks.visuals[0].ready();
    expect(await opening).toMatchObject({ ok: true, phase: "ready", visible: true });
    const command = bridge.presentation.command({ ...visualRequest, commandId: "practice-advance", name: "advance", parameters: { label: "Seen" } });
    await vi.waitFor(() => expect(mocks.visuals[0].operations).toHaveLength(1));
    mocks.visuals[0].finish(0, { state: "arrived", paused: true });
    expect(await command).toMatchObject({ ok: true, commandId: "practice-advance", phase: "completed", state: "arrived" });
    expect(fixture.checkpointWrites[0].url).toBe(expectedUrl);
    expect(fixture.checkpointWrites[0].options.body).toEqual({ requestId: expect.any(String), expectedRevision: 0,
      projectSlug: "practice-confirmed", sessionId: fixture.props.sessionId,
      snapshot: { state: "arrived", paused: true, labels: {} } });
    expect(fixture.button("App")).toBeNull(); expect(fixture.outputs.mounted).not.toHaveBeenCalled();
    expect(fixture.reads).toHaveLength(0); expect(fixture.writes).toHaveLength(0);
    fixture.props.projectSlug = "unrelated-working"; await Vue.nextTick();
    expect(bridge.projectSlug).toBe("practice-confirmed"); expect(bridge.presentation.state.phase).toBe("ready");
    fixture.props.conversationRuntime.identity.sourceProjectSlug = "different-confirmed-source";
    await Vue.nextTick(); await Vue.nextTick();
    expect(bridge.presentation.state.phase).toBe("closed");
    await expect(bridge.presentation.command({ ...visualRequest, commandId: "retired", name: "advance", parameters: { label: "No" } })).rejects.toThrow(/selected|identity/u);
  } finally { fixture.close(); }
});

it("actual practice App keeps Learning admission and Main presentation while showing only original output controls", async () => {
  const attemptId = "12345678-1234-4234-8234-123456789abc";
  const fixture = mountOnboarding({ practiceApp: true, withAutopilotPreview: true, lessonsAvailable: true,
    appAvailable: true, attemptId, projectPane: "dashboard" });
  try {
    fixture.button("App").props.onClick(); await Vue.nextTick();
    await vi.waitFor(() => expect(fixture.reads).toHaveLength(1));
    expect(fixture.reads[0].url).toBe(`/api/learning/${attemptId}/vibe64/sessions/saved-practice-initial/onboarding`);
    expect(fixture.reads[0].options.query || {}).toEqual({});
    fixture.reads[0].resolve(opening("ready", fixture.props.sessionId));
    await vi.waitFor(() => expect(fixture.outputs.mounted).toHaveBeenCalledOnce());
    expect(fixture.outputs.controls.value.learningBinding).toBe(fixture.props.conversationRuntime.identity);
    expect(fixture.colleaguePreview.value.learningAttemptId).toBe(attemptId);
    expect(fixture.colleaguePreview.value.projectSlug).toBe("exact-practice");
    expect(fixture.props.conversationRuntime.identity.projectSlug).toBe("");
    fixture.props.projectSlug = "unrelated-working"; await Vue.nextTick();
    expect(fixture.reads).toHaveLength(1);
    expect(fixture.requestTemporaryAi).not.toHaveBeenCalled();
    const presentation = fixture.colleaguePreview.value.presentation;
    fixture.viewer.value = { actorKey: "different-member" }; await Vue.nextTick();
    expect(Vue.toValue(mocks.query.enabled)).toBe(false);
    await expect(presentation.open({ attemptId, visualId: "alternate" })).rejects.toThrow();
    expect(fixture.visualReads).toHaveLength(0);
    expect(fixture.reads).toHaveLength(1);
  } finally { fixture.close(); }
});

it("practice onboarding does not mount template, Temporary AI or Env mutation controls", async () => {
  mocks.live = false;
  mocks.resource = { data: Vue.ref(null), isFetching: Vue.ref(false), loadError: Vue.ref(""), reload: vi.fn() };
  const binding = { noExercise: false, sourceProjectSlug: "exact-practice", learnerId: "42",
    viewerActorKey: "member-42", learningAttemptId: "12345678-1234-4234-8234-123456789abc",
    sessionId: "session-a", sessionsApiPath: "/api/learning/12345678-1234-4234-8234-123456789abc/vibe64/sessions" };
  const html = await render("new", { learningBinding: binding }, { missingKeys: ["API_KEY"], warning: "" });
  expect(html).toContain("Practice setup needs attention");
  expect(html).not.toContain("Use this starter");
  expect(html).not.toContain("Start through conversation");
  expect(html).not.toContain("Open Env");
  expect(html).not.toContain("Open Temporary AI");
});


it("the original App choice forwards only its person event before changing actual Preview visibility", async () => {
  const effects = [], event = { type: "click", isTrusted: true }, ticket = Object.freeze({ id: "app-choice" });
  let fixture;
  const owner = {
    begin(actual, control, target) { effects.push({ phase: "begin", actual, control, target, appVisible: fixture.colleaguePreview.value.appVisible }); return actual?.isTrusted ? ticket : null; },
    async finish(actual) { await vi.waitFor(() => expect(fixture.colleaguePreview.value.appVisible).toBe(true)); effects.push({ phase: "finish", actual, appVisible: fixture.colleaguePreview.value.appVisible }); }
  };
  fixture = mountOnboarding({ practiceApp: true, withAutopilotPreview: true, lessonsAvailable: true, appAvailable: true,
    attemptId: "12345678-1234-4234-8234-123456789abc", learnerGestureOwner: owner });
  try {
    expect(effects).toEqual([]);
    fixture.button("App").props.onClick(event);
    await vi.waitFor(() => expect(effects).toHaveLength(2));
    expect(effects).toEqual([{ phase: "begin", actual: event, control: "preview-select",
      target: { projectSlug: "exact-practice", sessionId: "saved-practice-initial" }, appVisible: false },
      { phase: "finish", actual: ticket, appVisible: true }]);
    await vi.waitFor(() => expect(fixture.reads).toHaveLength(1));
    fixture.reads[0].resolve(opening("ready", fixture.props.sessionId));
    const displayedApp = fixture.colleaguePreview.value;
    expect(displayedApp.appVisible).toBe(true);
    fixture.button("Lessons").props.onClick(); await Vue.nextTick();
    expect(effects).toHaveLength(2);
    await vi.waitFor(() => expect(displayedApp.appVisible).toBe(false));
    fixture.button("App").props.onClick({ type: "click", isTrusted: false }); await Vue.nextTick();
    expect(effects).toHaveLength(3); expect(effects.at(-1).phase).toBe("begin");
    await vi.waitFor(() => expect(displayedApp.appVisible).toBe(true));
    expect(fixture.colleaguePreview.value).toBe(displayedApp);
  } finally { fixture.close(); }
});


it("the actual selected Learning workspace publisher waits for the original snapshot and truthfully observes phone App visibility", async () => {
  const source = fs.readFileSync(path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue"), "utf8");
  const start = source.indexOf("const assistantHost = inject(");
  const end = source.indexOf("const assistantLayerSelected = computed(", start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const layout = Vue.shallowRef(null), view = Vue.shallowRef(null), preview = Vue.shallowRef(null), width = Vue.ref(1200);
  const keyNames = ["VIBE64_ASSISTANT_HOST_KEY", "VIBE64_COLLEAGUE_VIEW_KEY", "VIBE64_COLLEAGUE_LAYOUT_KEY", "VIBE64_COLLEAGUE_PREVIEW_KEY"];
  const keys = Object.fromEntries(keyNames.map(name => [name, Symbol(name)]));
  const binding = Object.freeze({ actorKey: "scoped", viewerActorKey: "member", learnerId: "own", learningAttemptId: "saved-attempt",
    sessionId: "saved-initial", sourceProjectSlug: "practice", noExercise: false });
  const ready = Vue.ref(false), available = Vue.ref(true), collapsed = Vue.ref(false);
  const props = Vue.shallowReactive({ active: true, sessionSelectionArchived: false, conversationRuntime: {
    identity: binding, conversationReady: ready, available } });
  let selected;
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp({ setup() {
    const args = ["inject", "ref", "computed", "watchEffect", "onBeforeUnmount", "useDisplay", "props", "chatCollapsed", ...keyNames];
    selected = new Function(...args, `${source.slice(start, end)}\nreturn {learningView,learningLayout};`)(Vue.inject, Vue.ref, Vue.computed,
      Vue.watchEffect, Vue.onBeforeUnmount, () => ({ width }), props, collapsed, ...keyNames.map(name => keys[name]));
    return () => null;
  } });
  app.provide(keys.VIBE64_ASSISTANT_HOST_KEY, Vue.shallowRef(null)); app.provide(keys.VIBE64_COLLEAGUE_VIEW_KEY, view);
  app.provide(keys.VIBE64_COLLEAGUE_LAYOUT_KEY, layout); app.provide(keys.VIBE64_COLLEAGUE_PREVIEW_KEY, preview);
  const root = {}; app.mount(root);
  try {
    expect(view.value).toBe(selected.learningView); expect(layout.value.ready).toBe(false);
    ready.value = true; expect(layout.value.ready).toBe(true); expect(view.value.pane).toBe("lessons");
    preview.value = { ...binding, projectSlug: "practice", appVisible: true, presentation: { state: { visible: false } } };
    expect(view.value.pane).toBe("preview"); expect(layout.value.chatVisible).toBe(true);
    width.value = 500; expect(layout.value.projectVisible).toBe(false); expect(view.value.pane).toBe("chat");
    collapsed.value = true; expect(layout.value.projectVisible).toBe(true); expect(layout.value.chatVisible).toBe(false);
    expect(view.value.pane).toBe("preview");
    preview.value = { ...preview.value, learningAttemptId: "foreign" }; expect(view.value.pane).toBe("lessons");
    available.value = false; expect(view.value).toBeNull(); expect(layout.value).toBeNull();
    available.value = true; props.active = false; expect(view.value).toBeNull();
  } finally { app.unmount(); }
});
