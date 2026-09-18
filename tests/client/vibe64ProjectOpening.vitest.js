import fs from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ command: null, requests: [], selectionReload: vi.fn() }));
vi.mock("@/composables/useStudioShellDrawer.js", () => ({ useStudioShellDrawer() {} }));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({ useRealtimeEvent() {} }));
vi.mock("@/composables/useVibe64ProjectsResource.js", () => ({
  useVibe64ProjectsResource: () => ({
    loadError: Vue.ref(""), projects: Vue.ref([]), isLoading: Vue.ref(false),
    targetRoot: Vue.ref("/projects/dogandgroom"), selfTargetAutoSelectProjectRepro: Vue.ref({})
  })
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand(options) {
    if (!options.apiSuffix.endsWith("/open")) return { run: vi.fn() };
    mocks.command = Vue.reactive({
      canRun: true,
      isRunning: false,
      async run(context) {
        if (!this.canRun || this.isRunning) return null;
        this.isRunning = true;
        const request = Promise.withResolvers();
        mocks.requests.push({ context, options: options.buildCommandOptions(null, { context }), ...request });
        try { return await request.promise; }
        finally { this.isRunning = false; }
      }
    });
    return mocks.command;
  }
}));
vi.mock("@/composables/useProjectSelectionGate.js", () => ({
  useProjectSelectionGate: () => ({
    busy: Vue.ref(false), creating: Vue.ref(false), errorMessage: Vue.ref(""),
    hasSelection: Vue.ref(true), projectSelection: Vue.ref({ hasSelection: true }),
    projects: Vue.ref([]), projectsRoot: Vue.ref("/projects"), newProjectName: Vue.ref(""),
    selectingSlug: Vue.ref(""), selectionInitialLoading: Vue.ref(false), selectionReady: Vue.ref(true),
    loadProjectSelection: mocks.selectionReload
  })
}));
vi.mock("@/components/studio/StudioErrorNotice.vue", () => ({ default: {
  setup: (_props, { slots }) => () => Vue.h("aside", slots.actions?.())
} }));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: passthrough("button") }));
vi.mock("vuetify/components/VAlert", () => ({ VAlert: passthrough("aside") }));
vi.mock("vuetify/components/VSkeletonLoader", () => ({ VSkeletonLoader: passthrough("div") }));
vi.mock("vuetify/components/VSheet", () => ({ VSheet: passthrough("section") }));
vi.mock("vuetify/components/VForm", () => ({ VForm: passthrough("form") }));
vi.mock("vuetify/components/VTextField", () => ({ VTextField: passthrough("input") }));

import { useVibe64AppPage } from "../../src/composables/useVibe64AppPage.js";
import ProjectSelectionGate from "../../src/components/studio/ProjectSelectionGate.vue";

const filename = new URL("../../src/components/studio/ProjectSelectionGate.vue", import.meta.url).pathname;
const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
const bindings = compileScript(descriptor, { id: "project-opening" }).bindings;
const { code } = compile(descriptor.template.content, { mode: "function", prefixIdentifiers: true, bindingMetadata: bindings });
ProjectSelectionGate.render = new Function("Vue", code)(Vue);

function passthrough(tag) {
  return Vue.defineComponent({ setup: (_props, { attrs, slots }) => () => Vue.h(tag, attrs, slots.default?.()) });
}

const dispose = [];
afterEach(() => { while (dispose.length) dispose.pop()(); });
const success = { ok: true, runtime: { open: true } };
async function flush() { for (let i = 0; i < 8; i += 1) await Vue.nextTick(); }

async function mountPage() {
  mocks.requests = [];
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/app/project/:slug", component: { render: () => null } },
    { path: "/app/project/:slug/dashboard/files", component: { render: () => null } },
    { path: "/app/manage/projects", component: { render: () => null } }
  ] });
  await router.push("/app/project/dogandgroom");
  const renderer = Vue.createRenderer({
    createElement: (type) => ({ type, children: [], props: {} }),
    createText: (text) => ({ type: "text", text, children: [] }),
    createComment: (text) => ({ type: "comment", text, children: [] }),
    insert(node, parent, anchor) {
      const previous = node.parent?.children.indexOf(node) ?? -1;
      if (previous >= 0) node.parent.children.splice(previous, 1);
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node);
    },
    remove(node) {
      const index = node.parent?.children.indexOf(node) ?? -1;
      if (index >= 0) node.parent.children.splice(index, 1);
      node.parent = null;
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    patchProp: (node, key, _old, value) => { node.props[key] = value; },
    setElementText: (node, text) => { node.text = text; node.children = []; },
    setText: (node, text) => { node.text = text; }
  });
  let page;
  const sessionMounted = vi.fn();
  const Session = Vue.defineComponent({ setup() { sessionMounted(); return () => Vue.h("article", "Assistant ready"); } });
  const app = renderer.createApp({ setup() {
    page = useVibe64AppPage();
    return () => Vue.h(ProjectSelectionGate, {
      runtimeReady: page.projectRuntimeReady.value,
      runtimeError: page.projectRuntimeError.value,
      onRetryRuntime: page.retryProjectRuntime
    }, { default: () => Vue.h(Session) });
  } });
  app.use(router);
  for (const [name, tag] of Object.entries({
    "v-skeleton-loader": "div", "v-alert": "aside", "v-btn": "button",
    "v-text-field": "input", "v-form": "form", "v-sheet": "section"
  })) app.component(name, passthrough(tag));
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  const root = { children: [] };
  app.mount(root);
  dispose.push(() => app.unmount());
  await flush();
  return { page, root, router, sessionMounted };
}
function find(node, type) {
  if (node.type === type) return node;
  for (const child of node.children || []) { const found = find(child, type); if (found) return found; }
  return null;
}

describe("opening a routed project", () => {
  it("holds cached session content until the direct-link open request succeeds", async () => {
    const view = await mountPage();
    expect(mocks.requests).toHaveLength(1);
    expect(mocks.requests[0].options.path).toBe("/api/app/dogandgroom/vibe64/project-runtime/open");
    expect(view.sessionMounted).not.toHaveBeenCalled();
    mocks.requests[0].resolve(success);
    await flush();
    expect(view.sessionMounted).toHaveBeenCalledTimes(1);
    expect(view.page.projectRuntimeReady.value).toBe(true);
  });

  it("shows an opening failure and retries from the visible action without reloading", async () => {
    const view = await mountPage();
    mocks.requests[0].reject(new Error("Project could not open."));
    await flush();
    expect(view.sessionMounted).not.toHaveBeenCalled();
    expect(view.page.projectRuntimeError.value).toBe("Project could not open.");
    const retry = find(view.root, "button");
    expect(retry).toBeTruthy();
    retry.props.onClick();
    await flush();
    expect(mocks.requests).toHaveLength(2);
    mocks.requests[1].resolve(success);
    await flush();
    expect(view.page.projectRuntimeError.value).toBe("");
    expect(view.sessionMounted).toHaveBeenCalledTimes(1);
  });

  it("opens the latest project after an earlier navigation's request finishes", async () => {
    const view = await mountPage();
    await view.router.push("/app/project/other");
    await flush();
    expect(mocks.requests).toHaveLength(1);
    mocks.requests[0].resolve(success);
    await flush();
    expect(mocks.requests).toHaveLength(2);
    expect(mocks.requests[1].context.projectSlug).toBe("other");
    expect(view.sessionMounted).not.toHaveBeenCalled();
    mocks.requests[1].resolve(success);
    await flush();
    expect(view.sessionMounted).toHaveBeenCalledTimes(1);
  });

  it("reopens from the same project link and from the current project selector", async () => {
    const view = await mountPage();
    mocks.requests[0].resolve(success);
    await flush();
    await view.router.push("/app/project/dogandgroom");
    await flush();
    expect(mocks.requests).toHaveLength(2);
    expect(view.page.projectRuntimeReady.value).toBe(false);
    mocks.requests[1].resolve(success);
    await flush();
    view.page.openProject({ slug: "dogandgroom" });
    await flush();
    expect(mocks.requests).toHaveLength(3);
    mocks.requests[2].resolve(success);
    await flush();
    expect(view.page.projectRuntimeReady.value).toBe(true);
  });

  it("does not reuse an earlier opening when returning while another project is opening", async () => {
    const view = await mountPage();
    mocks.requests[0].resolve(success);
    await flush();
    await view.router.push("/app/project/other");
    await flush();
    await view.router.push("/app/project/dogandgroom");
    await flush();
    expect(view.page.projectRuntimeReady.value).toBe(false);
    mocks.requests[1].resolve(success);
    await flush();
    expect(mocks.requests).toHaveLength(3);
    expect(mocks.requests[2].context.projectSlug).toBe("dogandgroom");
    expect(view.page.projectRuntimeReady.value).toBe(false);
    mocks.requests[2].resolve(success);
    await flush();
    expect(view.page.projectRuntimeReady.value).toBe(true);
  });

  it("reopens the current project when selected from its dashboard", async () => {
    const view = await mountPage();
    mocks.requests[0].resolve(success);
    await flush();
    await view.router.push("/app/project/dogandgroom/dashboard/files");
    await flush();
    expect(mocks.requests).toHaveLength(1);
    view.page.openProject({ slug: "dogandgroom" });
    await flush();
    expect(mocks.requests).toHaveLength(2);
    expect(view.page.projectRuntimeReady.value).toBe(false);
    mocks.requests[1].resolve(success);
    await flush();
    expect(view.page.projectRuntimeReady.value).toBe(true);
  });
});
