import { readFileSync } from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import * as Vue from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureHttpWebClient,
  getHttpWebClient,
  resetHttpWebClientForTests
} from "@jskit-ai/http-web/client/lib/httpClient";

import {
  PROJECT_SELECTION_ENDPOINT,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  VIBE64_PROJECT_CHANGED_EVENT,
  projectSelectionQueryKey
} from "../../src/lib/studioGateApi.js";
import {
  projectSelectionGateEndpoint,
  projectSelectionGateQueryKey
} from "../../src/composables/useProjectSelectionGate.js";
import {
  resolveWebSocketUrl,
  resolveStudioRequestUrl,
  scopedDevelopmentApiUrl,
  scopedDevelopmentApiPathname
} from "../../src/lib/studioUrls.js";
import {
  vibe64AgentTerminalWebSocketUrl
} from "../../src/lib/vibe64SessionApi.js";
import {
  vibe64ProjectScopedStorageKey,
  vibe64ProjectQueryScope,
  normalizeProjectRoutePath,
  projectAppPath,
  projectSlugFromPathname
} from "../../src/lib/vibe64ProjectScope.js";

const projectQueryMocks = vi.hoisted(() => ({ route: null }));
vi.mock("vue-router", () => ({
  RouterView: { render: () => null },
  useRoute: () => projectQueryMocks.route,
  useRouter: () => ({ push: vi.fn(), afterEach: vi.fn(() => vi.fn()) })
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: () => ({
    canRun: true, isRunning: false, message: "", messageType: "",
    run: vi.fn(async () => ({ ok: true, runtime: { open: true } }))
  })
}));
vi.mock("@/composables/useStudioShellDrawer.js", () => ({ useStudioShellDrawer() {} }));
vi.mock("@/components/StudioAppShellLayout.vue", () => ({ default: passthroughComponent("section") }));
vi.mock("@/components/studio/Vibe64AuthSettingsButton.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/studio/StudioErrorNotice.vue", () => ({ default: passthroughComponent("aside") }));
vi.mock("@/components/studio/Vibe64SessionPanel.vue", () => ({
  default: Vue.defineComponent({
    inheritAttrs: false,
    props: { projectContext: { type: Object, required: true } },
    setup(props) {
      return () => Vue.h("article", { "data-project-slug": props.projectContext.slug });
    }
  })
}));
vi.mock("vuetify/components/VAlert", () => ({ VAlert: passthroughComponent("aside") }));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: passthroughComponent("button") }));
vi.mock("vuetify/components/VForm", () => ({ VForm: passthroughComponent("form") }));
vi.mock("vuetify/components/VIcon", () => ({ VIcon: passthroughComponent("span") }));
vi.mock("vuetify/components/VList", () => ({
  VList: passthroughComponent("ul"),
  VListItem: passthroughComponent("li")
}));
vi.mock("vuetify/components/VMenu", () => ({ VMenu: passthroughComponent("div") }));
vi.mock("vuetify/components/VSheet", () => ({ VSheet: passthroughComponent("section") }));
vi.mock("vuetify/components/VSkeletonLoader", () => ({ VSkeletonLoader: passthroughComponent("div") }));
vi.mock("vuetify/components/VTextField", () => ({ VTextField: passthroughComponent("input") }));

import ProjectPage from "../../src/pages/app/project/[slug].vue";
import ProjectSelectionGate from "../../src/components/studio/ProjectSelectionGate.vue";

for (const [component, file] of [
  [ProjectPage, "../../src/pages/app/project/[slug].vue"],
  [ProjectSelectionGate, "../../src/components/studio/ProjectSelectionGate.vue"]
]) {
  const filename = new URL(file, import.meta.url).pathname;
  const { descriptor } = parse(readFileSync(filename, "utf8"), { filename });
  const script = compileScript(descriptor, { id: "project-query-owner-test" });
  component.render = new Function("Vue", compile(descriptor.template.content, {
    bindingMetadata: script.bindings,
    mode: "function",
    prefixIdentifiers: true
  }).code)(Vue);
}

function passthroughComponent(element) {
  return Vue.defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => Vue.h(element, attrs, Object.values(slots).flatMap((slot) => slot({ props: {} })));
    }
  });
}

function projectSelection(slug) {
  const project = { slug, path: `/projects/${slug}`, runtime: { open: true } };
  return {
    currentProject: project,
    hasSelection: true,
    ok: true,
    projects: [project],
    projectsRoot: "/projects",
    targetRoot: project.path
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

function mountProjectQueries(slug, { catalog = null } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const requests = [];
  const listeners = new Map();
  const socket = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    }
  };
  configureHttpWebClient({
    request(url, options) {
      expect(options.method).toBe("GET");
      const response = Promise.withResolvers();
      requests.push({ url, ...response });
      return response.promise;
    }
  });
  if (catalog) queryClient.setQueryData(projectSelectionQueryKey("app", "public", slug), catalog);
  const route = Vue.reactive({ params: { slug }, path: projectAppPath(slug), query: {} });
  projectQueryMocks.route = route;
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
    nextSibling(node) {
      return node.parent?.children[node.parent.children.indexOf(node) + 1] || null;
    },
    patchProp: (node, key, _previous, value) => { node.props[key] = value; },
    setElementText: (node, text) => { node.text = text; },
    setText: (node, text) => { node.text = text; }
  });
  const app = renderer.createApp(ProjectPage);
  for (const [name, element] of [
    ["VAlert", "aside"], ["VBtn", "button"], ["VForm", "form"], ["VIcon", "span"],
    ["VList", "ul"], ["VListItem", "li"], ["VMenu", "div"], ["VSheet", "section"],
    ["VSkeletonLoader", "div"], ["VTextField", "input"]
  ]) app.component(name, passthroughComponent(element));
  app.use(VueQueryPlugin, { queryClient });
  app.provide("jskit.realtime.runtime.client.socket", socket);
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  const container = { children: [], props: {}, type: "root" };
  app.mount(container);
  return {
    queryClient,
    requests,
    route,
    renderedProject: () => findNode(container, (node) => node.type === "article")?.props["data-project-slug"],
    navigationVisible: () => Boolean(findNode(container, (node) => node.props.role === "tablist")),
    async projectChanged() {
      for (const handler of listeners.get(VIBE64_PROJECT_CHANGED_EVENT) || []) {
        handler({ projectSlug: route.params.slug });
      }
      await Vue.nextTick();
    },
    listenerCount: () => [...listeners.values()].reduce((count, handlers) => count + handlers.size, 0),
    async resolveProject(projectSlug) {
      const queries = queryClient.getQueryCache().findAll({
        queryKey: projectSelectionQueryKey("app", "public", projectSlug)
      });
      const pending = queries.map((query) => query.promise);
      for (const request of requests) {
        if (request.url === `/api/app/${projectSlug}/vibe64/projects`) request.resolve(projectSelection(projectSlug));
      }
      await Promise.all(pending);
      await Vue.nextTick();
    },
    close() {
      app.unmount();
      queryClient.clear();
      for (const request of requests) request.resolve({});
    }
  };
}

describe("Vibe64 project client scope", () => {
  afterEach(() => {
    resetHttpWebClientForTests();
    vi.unstubAllGlobals();
  });

  it("derives project scope from development paths", () => {
    expect(projectAppPath("alpha_1")).toBe("/app/project/alpha_1");
    expect(projectAppPath("beta-2", "/dashboard/history")).toBe("/app/project/beta-2/dashboard/history");
    expect(normalizeProjectRoutePath("app/project/beta-2/dashboard/history/")).toBe("/app/project/beta-2/dashboard/history");
    expect(normalizeProjectRoutePath("//app//project//beta-2//dashboard//history//")).toBe("/app/project/beta-2/dashboard/history");
    expect(normalizeProjectRoutePath("/")).toBe("/");
    expect(projectSlugFromPathname("/app/project/alpha_1")).toBe("alpha_1");
    expect(projectSlugFromPathname("/app/project/beta-2/dashboard/history")).toBe("beta-2");
    expect(projectSlugFromPathname("/app")).toBe("");
    expect(projectSlugFromPathname("/app/alpha_1")).toBe("");
  });

  it("adds project scope to query and storage keys", () => {
    expect(VIBE64_CONNECTIONS_CHANGED_EVENT).toBe("vibe64.connections.changed");
    expect(vibe64ProjectQueryScope("alpha_1")).toEqual(["project", "alpha_1"]);
    expect(vibe64ProjectQueryScope()).toEqual(["project", "unscoped"]);
    expect(vibe64ProjectScopedStorageKey("vibe64:selected-session-id", "alpha_1"))
      .toBe("vibe64:selected-session-id:project:alpha_1");

  });

  it("does not rewrite global Studio and owner API paths into project API paths", () => {
    expect(scopedDevelopmentApiPathname("/api/studio/health", "alpha_1"))
      .toBe("/api/studio/health");
    expect(scopedDevelopmentApiPathname("/api/studio/browser-lifecycle/ws", "alpha_1"))
      .toBe("/api/studio/browser-lifecycle/ws");
    expect(scopedDevelopmentApiPathname("/api/vibe64/projects", "alpha_1"))
      .toBe("/api/vibe64/projects");
    expect(scopedDevelopmentApiPathname("/api/vibe64/projects/alpha_1/repository/github", "alpha_1"))
      .toBe("/api/vibe64/projects/alpha_1/repository/github");
    expect(scopedDevelopmentApiPathname("/api/vibe64/github/repositories/search", "alpha_1"))
      .toBe("/api/vibe64/github/repositories/search");
  });

  it("resolves direct browser transport URLs through the current project scope", () => {
    vi.stubGlobal("window", {
      location: {
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/alpha_1/dashboard/health"
      }
    });

    expect(resolveStudioRequestUrl("/api/studio/health"))
      .toBe("/api/studio/health");
    expect(resolveWebSocketUrl("/api/studio/browser-lifecycle/ws"))
      .toBe("ws://127.0.0.1:5173/api/studio/browser-lifecycle/ws");
  });

  it("adds the tab origin to session assistant terminal WebSocket URLs", () => {
    vi.stubGlobal("window", {
      location: {
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/alpha_1"
      }
    });

    const url = vibe64AgentTerminalWebSocketUrl("session 1", "terminal 1");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/app/alpha_1/vibe64/sessions/session%201/agent-terminal/terminal%201/ws");
    expect(parsed.searchParams.get("originId")).toMatch(/^tab:/u);
  });

  it("scopes direct command URLs through the current project scope", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/beepollen"
      }
    });

    expect(scopedDevelopmentApiUrl("/api/vibe64/sessions/session-1/output-runs"))
      .toBe("/api/app/beepollen/vibe64/sessions/session-1/output-runs");
  });

  it("keeps JSKIT HTTP client project catalog requests global on project pages", async () => {
    const requestedUrls = [];
    configureHttpWebClient({
      csrf: {
        enabled: false
      },
      resolveRequestUrl(url) {
        return resolveStudioRequestUrl(url);
      }
    });
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/beepollen"
      }
    });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      requestedUrls.push(url);
      return {
        headers: {
          get: () => "application/json"
        },
        json: async () => ({
          ok: true,
          projects: []
        }),
        ok: true,
        status: 200
      };
    }));

    await getHttpWebClient().get(PROJECT_SELECTION_ENDPOINT);

    expect(requestedUrls).toEqual([
      "/api/vibe64/projects"
    ]);
  });

  it("scopes the project selection gate endpoint on project pages without changing catalog defaults", () => {
    expect(projectSelectionGateEndpoint({
      projectSlug: "alpha_1"
    })).toBe(PROJECT_SELECTION_ENDPOINT);
    expect(projectSelectionGateQueryKey({
      ownershipFilter: "public",
      projectSlug: "alpha_1",
      surfaceId: "app"
    })).toEqual(projectSelectionQueryKey("app", "public", "alpha_1"));

    expect(projectSelectionGateEndpoint({
      projectSlug: "alpha_1",
      scopeSelectionToCurrentProject: true
    })).toBe("/api/app/alpha_1/vibe64/projects");
    expect(projectSelectionGateQueryKey({
      ownershipFilter: "public",
      projectSlug: "alpha_1",
      scopeSelectionToCurrentProject: true,
      surfaceId: "app"
    })).toEqual([
      ...projectSelectionQueryKey("app", "public", "alpha_1"),
      "route-selection"
    ]);
  });

  it("shares one scoped project query and initial request between the app and its gate", async () => {
    const slug = "shared-query-project";
    const fixture = mountProjectQueries(slug);
    try {
      expect(fixture.requests.map(({ url }) => url)).toEqual([
        `/api/app/${slug}/vibe64/projects`
      ]);
      const queries = fixture.queryClient.getQueryCache().findAll({
        queryKey: projectSelectionQueryKey("app", "public", slug)
      });
      expect(queries).toHaveLength(1);
      expect(queries[0].getObserversCount()).toBe(2);
      expect(fixture.renderedProject()).toBeUndefined();
      expect(fixture.navigationVisible()).toBe(false);

      await fixture.resolveProject(slug);
      expect(fixture.renderedProject()).toBe(slug);
      expect(fixture.navigationVisible()).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it("shares the destination query while project switching excludes late prior-project data", async () => {
    const firstSlug = "route-query-a";
    const nextSlug = "route-query-b";
    const fixture = mountProjectQueries(firstSlug);
    try {
      await fixture.resolveProject(firstSlug);
      expect(fixture.renderedProject()).toBe(firstSlug);
      expect(fixture.navigationVisible()).toBe(true);
      const earlierRefresh = fixture.queryClient.refetchQueries({
        queryKey: projectSelectionQueryKey("app", "public", firstSlug)
      });

      fixture.route.params.slug = nextSlug;
      fixture.route.path = projectAppPath(nextSlug);
      await Vue.nextTick();
      expect(fixture.renderedProject()).toBeUndefined();
      expect(fixture.navigationVisible()).toBe(false);
      expect(fixture.requests.filter(({ url }) => url === `/api/app/${nextSlug}/vibe64/projects`))
        .toHaveLength(1);
      const nextQueries = fixture.queryClient.getQueryCache().findAll({
        queryKey: projectSelectionQueryKey("app", "public", nextSlug)
      });
      expect(nextQueries).toHaveLength(1);
      expect(nextQueries[0].getObserversCount()).toBe(2);

      await fixture.resolveProject(nextSlug);
      expect(fixture.renderedProject()).toBe(nextSlug);
      expect(fixture.navigationVisible()).toBe(true);
      await fixture.resolveProject(firstSlug);
      await earlierRefresh;
      expect(fixture.renderedProject()).toBe(nextSlug);
      expect(fixture.navigationVisible()).toBe(true);

      fixture.route.params.slug = firstSlug;
      fixture.route.path = projectAppPath(firstSlug);
      await vi.waitFor(() => expect(fixture.renderedProject()).toBe(firstSlug));
      expect(fixture.navigationVisible()).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it("refreshes the shared warm projects query once per realtime event without invalidating other scopes", async () => {
    const slug = "realtime-query-project";
    const fixture = mountProjectQueries(slug, { catalog: projectSelection("catalog-project") });
    try {
      await fixture.resolveProject(slug);
      const foreignKey = projectSelectionGateQueryKey({
        ownershipFilter: "public", projectSlug: "other-project", scopeSelectionToCurrentProject: true, surfaceId: "app"
      });
      fixture.queryClient.setQueryData(foreignKey, projectSelection("other-project"));

      await fixture.projectChanged();

      expect(fixture.requests.map(({ url }) => url)).toEqual([
        `/api/app/${slug}/vibe64/projects`,
        `/api/app/${slug}/vibe64/projects`
      ]);
      expect(fixture.queryClient.getQueryState(foreignKey).isInvalidated).toBe(false);
      expect(fixture.queryClient.getQueryState(projectSelectionQueryKey("app", "public", slug)).isInvalidated)
        .toBe(false);
      await fixture.resolveProject(slug);
      expect(fixture.renderedProject()).toBe(slug);
    } finally {
      fixture.close();
    }
  });

  it("replaces a held pre-mutation projects refresh once and ignores its late stale result", async () => {
    const slug = "realtime-held-project";
    const fixture = mountProjectQueries(slug);
    try {
      await fixture.resolveProject(slug);
      const query = fixture.queryClient.getQueryCache().find({
        queryKey: projectSelectionGateQueryKey({
          ownershipFilter: "public", projectSlug: slug, scopeSelectionToCurrentProject: true, surfaceId: "app"
        })
      });
      const earlierRefresh = fixture.queryClient.refetchQueries({ queryKey: query.queryKey });
      await Vue.nextTick();
      const earlierRequest = fixture.requests.at(-1);
      expect(fixture.requests).toHaveLength(2);

      await fixture.projectChanged();
      expect(fixture.requests).toHaveLength(3);
      const updated = projectSelection(slug);
      updated.currentProject.path = `/projects/${slug}/after-mutation`;
      fixture.requests.at(-1).resolve(updated);
      await query.promise;
      await Vue.nextTick();
      earlierRequest.resolve(projectSelection(slug));
      await earlierRefresh;
      await Vue.nextTick();

      expect(query.state.data.currentProject.path).toBe(updated.currentProject.path);
      expect(fixture.renderedProject()).toBe(slug);
    } finally {
      fixture.close();
    }
  });

  it("keeps one realtime refresh owner through project changes, refresh failure, retry and teardown", async () => {
    const fixture = mountProjectQueries("realtime-lifetime-a");
    try {
      await fixture.resolveProject("realtime-lifetime-a");
      fixture.route.params.slug = "realtime-lifetime-b";
      fixture.route.path = projectAppPath("realtime-lifetime-b");
      await Vue.nextTick();
      await fixture.resolveProject("realtime-lifetime-b");
      const query = fixture.queryClient.getQueryCache().find({
        queryKey: projectSelectionGateQueryKey({
          ownershipFilter: "public", projectSlug: "realtime-lifetime-b", scopeSelectionToCurrentProject: true, surfaceId: "app"
        })
      });
      const beforeRefresh = fixture.requests.length;
      await fixture.projectChanged();
      expect(fixture.requests.length - beforeRefresh).toBe(1);
      fixture.requests.at(-1).reject(new Error("Projects refresh failed."));
      await query.promise.catch(() => {});
      await Vue.nextTick();
      expect(query.state.error.message).toBe("Projects refresh failed.");

      await fixture.projectChanged();
      expect(fixture.requests.length - beforeRefresh).toBe(2);
      await fixture.resolveProject("realtime-lifetime-b");
      expect(query.state.error).toBeNull();
      expect(fixture.renderedProject()).toBe("realtime-lifetime-b");
      expect(fixture.requests.filter(({ url }) => url.includes("/realtime-lifetime-a/"))).toHaveLength(1);
    } finally {
      fixture.close();
    }
    const completedRequests = fixture.requests.length;
    expect(fixture.listenerCount()).toBe(0);
    await fixture.projectChanged();
    expect(fixture.requests).toHaveLength(completedRequests);
  });

  it("keeps the global catalog cache separate from both scoped project readers", async () => {
    const slug = "catalog-query-project";
    const catalog = projectSelection("globally-selected-project");
    const fixture = mountProjectQueries(slug, { catalog });
    try {
      const catalogKey = projectSelectionQueryKey("app", "public", slug);
      const catalogQuery = fixture.queryClient.getQueryCache().find({ queryKey: catalogKey, exact: true });
      expect(catalogQuery.getObserversCount()).toBe(0);
      expect(fixture.renderedProject()).toBeUndefined();
      expect(fixture.navigationVisible()).toBe(false);
      expect(fixture.requests.map(({ url }) => url)).toEqual([
        `/api/app/${slug}/vibe64/projects`
      ]);

      await fixture.resolveProject(slug);
      expect(fixture.queryClient.getQueryData(catalogKey)).toEqual(catalog);
      expect(fixture.renderedProject()).toBe(slug);
      expect(fixture.navigationVisible()).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it("routes created and selected projects to their project pages", () => {
    const source = readFileSync(new URL("../../src/components/studio/ProjectSelectionGate.vue", import.meta.url), "utf8");

    expect(projectAppPath("beepollen")).toBe("/app/project/beepollen");
    expect(source).toContain("const selected = await createProject();");
    expect(source).toContain("const selected = await selectProject(slug);");
    expect(source).toContain("router.push(projectAppPath(selected))");
    expect(source).toContain('v-if="!displayError && (selectionInitialLoading || !runtimeReady)"');
    expect(source).toContain("<v-skeleton-loader");
  });
});
