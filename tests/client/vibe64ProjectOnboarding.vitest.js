import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  configureHttpWebClient,
  resetHttpWebClientForTests
} from "@jskit-ai/http-web/client/lib/httpClient";
import * as Vue from "vue";
import { renderToString } from "@vue/server-renderer";
import { routeLocationKey } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ live: false, resource: null, query: null }));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: passthroughComponent("button") }));
vi.mock("vuetify/components/VAlert", () => ({ VAlert: passthroughComponent("aside") }));
vi.mock("vuetify/components/VTextarea", () => ({ VTextarea: passthroughComponent("textarea") }));
vi.mock("vuetify/components/VSkeletonLoader", () => ({ VSkeletonLoader: passthroughComponent("div") }));

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
import Onboarding from "../../src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue";
import FixAction from "../../src/components/studio/Vibe64TemporaryAiFixAction.vue";
import { useVibe64TemporaryAi } from "../../src/composables/useVibe64TemporaryAi.js";

for (const [component, relativePath] of [
  [Onboarding, "src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue"],
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
const onboardingTag = autopilot.match(/<Vibe64ProjectOnboarding\b[\s\S]*?>/u)?.[0];
const activeBinding = onboardingTag?.match(/:active="([^"]+)"/u)?.[1];
if (!activeBinding) throw new Error("The actual onboarding activity binding is required.");
const onboardingActive = new Function("props", `return (${activeBinding});`);

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
function mountOnboarding({ active = true, projectPane = "preview", live = true, temporaryChats = false } = {}) {
  mocks.live = live;
  const props = Vue.reactive({ active, archived: false, busy: false, canAsk: true, mounted: true, projectPane, sessionId: "session-a" });
  const reads = [];
  const writes = [];
  const conversationRequests = [];
  const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
  let temporary;
  const listeners = new Set();
  const feedback = { dismiss: vi.fn(), report: vi.fn(() => ({ skipped: true })) };
  const outputs = { mounted: vi.fn(), unmounted: vi.fn() };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let closed = false;
  configureHttpWebClient({
    request(url, options) {
      if (url.startsWith("/api/vibe64/sessions/")) {
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
  });
  const outputSlot = Vue.defineComponent({
    setup() {
      outputs.mounted();
      Vue.onBeforeUnmount(outputs.unmounted);
      return () => Vue.h("output", "Running output instance");
    }
  });
  const renderer = Vue.createRenderer({
    createElement: (type) => ({ type, children: [], props: {}, parent: null }),
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
      return () => props.mounted ? Vue.h(Onboarding, {
        active: onboardingActive(props),
        archived: props.archived,
        busy: props.busy,
        canAsk: props.canAsk,
        requestTemporaryAi,
        sessionId: props.sessionId
      }, { default: () => Vue.h(outputSlot) }) : null;
    }
  });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  app.provide(routeLocationKey, Vue.reactive({ path: "/app/project/project-a", params: {}, query: {}, matched: [] }));
  app.provide("jskit.shell-web.runtime.web-error.client", feedback);
  app.provide("jskit.realtime.runtime.client.socket", {
    on(event, handler) { if (event === "vibe64.project.changed") listeners.add(handler); },
    off(event, handler) { if (event === "vibe64.project.changed") listeners.delete(handler); }
  });
  for (const [name, element] of [["VAlert", "aside"], ["VBtn", "button"], ["VTextarea", "textarea"], ["VSkeletonLoader", "div"]]) {
    app.component(name, passthroughComponent(element));
  }
  const container = { children: [], props: {}, type: "root" };
  app.mount(container);
  return {
    container, conversationRequests, feedback, listeners, outputs, props, reads, requestTemporaryAi, temporary, writes,
    button: (label) => findNode(container, (node) => node.type === "button" && nodeText(node).includes(label)),
    async projectChanged(projectSlug = "project-a") {
      for (const handler of listeners) handler({ projectSlug });
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
    expect(onboardingTag).toContain(':can-ask="assistantDirectAllowed"');
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
      const turns = fixture.conversationRequests.filter(({ url, method }) => method === "POST" && url.endsWith("/turns"));
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
