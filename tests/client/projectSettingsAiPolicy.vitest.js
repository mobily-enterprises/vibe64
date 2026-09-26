import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  configureHttpWebClient,
  resetHttpWebClientForTests
} from "@jskit-ai/http-web/client/lib/httpClient";
import * as VueRuntime from "vue";
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  reactive,
  ref,
  ssrContextKey
} from "vue";
import { routeLocationKey } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLABORATION_ENDPOINT,
  ENGINEERING_ENDPOINT,
  PROJECT_SETTINGS_ENDPOINT,
  VIBE64_PROJECT_CHANGED_EVENT,
  engineeringSettingsQueryKey,
  projectSettingsQueryKey
} from "../../src/lib/studioGateApi.js";
import { useVibe64SessionPanel } from "../../src/composables/useVibe64SessionPanel.js";

const projectSettingsMocks = vi.hoisted(() => ({
  commandOptions: [],
  commands: [],
  dialog: vi.fn(),
  endpointOptions: [],
  engineeringResource: null,
  liveCommands: false,
  liveQueries: false,
  projectSlug: null,
  realtimeOptions: [],
  resource: null,
  route: { query: {} },
  router: { replace: vi.fn() },
  sessionEventMatches: vi.fn(() => true)
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useEndpointResource(options) {
      if (projectSettingsMocks.liveQueries) return actual.useEndpointResource(options);
      const index = projectSettingsMocks.endpointOptions.length;
      projectSettingsMocks.endpointOptions.push(options);
      return index === 0
        ? projectSettingsMocks.resource
        : projectSettingsMocks.engineeringResource;
    }
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRoute() {
      return projectSettingsMocks.route;
    },
    useRouter() {
      return projectSettingsMocks.router;
    }
  };
});

vi.mock("@jskit-ai/http-web/client/composables/useCommand", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useCommand(options) {
      if (projectSettingsMocks.liveCommands) return actual.useCommand(options);
      if (projectSettingsMocks.liveQueries) return createCommand();
      const index = projectSettingsMocks.commandOptions.length;
      projectSettingsMocks.commandOptions.push(options);
      return projectSettingsMocks.commands[index];
    }
  };
});

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRealtimeEvent(options) {
      if (projectSettingsMocks.liveQueries) return actual.useRealtimeEvent(options);
      projectSettingsMocks.realtimeOptions.push(options);
    }
  };
});

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug() {
    return projectSettingsMocks.projectSlug;
  }
}));

vi.mock("@/composables/useVibe64SessionData.js", () => ({
  sessionListRealtimeShouldRefresh: projectSettingsMocks.sessionEventMatches,
  useVibe64SessionData: () => ({
    createSessionRunning: ref(false),
    isSelectedSessionArchived: ref(false),
    selectedSession: ref(null),
    selectedSessionId: ref(""),
    sessionList: { isInitialLoading: false, loadError: "" },
    sessions: ref([]),
    sessionsApiPath: ref("/api/vibe64/sessions")
  })
}));

vi.mock("@/composables/useVibe64SessionRepositoryStatusRegistry.js", () => ({
  useVibe64SessionRepositoryStatusRegistry: () => ({ observe: vi.fn() })
}));

vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({
  requestVibe64AccountConnectionsDialog: projectSettingsMocks.dialog
}));

vi.mock("@/components/common/Vibe64AsyncModuleState.vue", () => ({
  default: passthroughComponent("aside")
}));

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));

vi.mock("vuetify/components/VRadio", () => ({
  VRadio: passthroughComponent("input")
}));

vi.mock("vuetify/components/VRadioGroup", () => ({
  VRadioGroup: passthroughComponent("fieldset")
}));

vi.mock("vuetify/components/VSelect", () => ({
  VSelect: passthroughComponent("select")
}));

vi.mock("vuetify/components/VSwitch", () => ({
  VSwitch: passthroughComponent("input")
}));

vi.mock("vuetify/components/VTextarea", () => ({
  VTextarea: passthroughComponent("textarea")
}));

import ProjectSettingsPanel from "../../src/components/studio/ProjectSettingsPanel.vue";

const componentPath = path.resolve("src/components/studio/ProjectSettingsPanel.vue");
const componentSource = fs.readFileSync(componentPath, "utf8");
const { descriptor } = parse(componentSource, {
  filename: componentPath
});
const componentScript = compileScript(descriptor, {
  id: "project-settings-collaboration-test"
});
const componentTemplate = compile(descriptor.template.content, {
  bindingMetadata: componentScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
ProjectSettingsPanel.render = new Function("Vue", componentTemplate.code)(VueRuntime);

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

function createCommand({ pending = null } = {}) {
  const running = ref(false);
  const run = vi.fn(async () => {
    running.value = true;
    try {
      await pending?.promise;
      return { ok: true };
    } finally {
      running.value = false;
    }
  });
  return {
    get isRunning() {
      return running.value;
    },
    run,
    running
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createResource({
  available = true,
  canEdit = true,
  developmentDatabase = {},
  collaboration: collaborationOverrides = {},
  promptHints = false
} = {}) {
  const databaseOptions = developmentDatabase.options || {};
  const data = ref({
    collaboration: {
      available,
      canEdit,
      choices: {
        experience: [
          { id: "beginner", name: "Beginner" },
          { id: "comfortable", name: "Comfortable" },
          { id: "expert", name: "Expert" }
        ],
        explanationStyle: [
          { id: "conclusions", name: "Conclusions only" },
          { id: "concise", name: "Concise rationale" },
          { id: "teaching", name: "Teaching detail" }
        ],
        responseLength: [
          { id: "very_short", name: "Very short" },
          { id: "concise", name: "Concise" },
          { id: "balanced", name: "Balanced" },
          { id: "detailed", name: "Detailed" }
        ],
        tone: [
          { id: "encouraging", name: "Encouraging" },
          { id: "playful", name: "Playful and cheeky" },
          { id: "direct", name: "Direct" },
          { id: "military", name: "Crisp and military" }
        ]
      },
      experience: "expert",
      explanationStyle: "teaching",
      requirements: "Use Australian English.",
      responseLength: "detailed",
      source: {
        rootKind: "session-source",
        sessionId: "session-a"
      },
      status: "configured",
      tone: "military",
      unavailableReason: "",
      ...collaborationOverrides
    },
    developmentDatabase: {
      canChange: true,
      managed: true,
      openSessionCount: 0,
      scope: "session",
      ...developmentDatabase,
      options: {
        project: {
          available: true,
          ...databaseOptions.project
        },
        session: {
          available: true,
          ...databaseOptions.session
        }
      }
    },
    promptHints: {
      canEdit,
      enabled: promptHints
    }
  });
  return {
    data,
    isLoading: ref(false),
    loadError: ref(""),
    reload: vi.fn(async () => ({ data: data.value }))
  };
}

function createEngineeringResource({
  available = true,
  profile = "focused.v1",
  sessionId = "session-a",
  status = "configured"
} = {}) {
  const profiles = [
    {
      description: "Small, direct changes for ordinary product work.",
      id: "focused.v1",
      name: "Focused"
    },
    {
      description: "Long-lived product work with explicit compatibility and operational care.",
      id: "durable.v1",
      name: "Durable product"
    },
    {
      description: "Security- or reliability-critical work backed by explicit risks and evidence.",
      id: "high-assurance.v1",
      name: "High assurance"
    }
  ];
  const data = ref({
    engineering: available
      ? {
          available: true,
          profile: profiles.find((candidate) => candidate.id === profile),
          profiles,
          source: {
            rootKind: "session-source",
            sessionId
          },
          status,
          unavailableReason: ""
        }
      : {
          available: false,
          profile: null,
          profiles: [],
          source: {
            rootKind: "metadata-only",
            sessionId: ""
          },
          unavailableReason: "Create or select an AI session to choose an engineering profile."
        }
  });
  return {
    data,
    isLoading: ref(false),
    loadError: ref(""),
    reload: vi.fn(async () => ({ data: data.value }))
  };
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ children: [], props: {}, text, type: "comment" }),
    createElement: (type) => ({
      children: [],
      focus: vi.fn(),
      parent: null,
      props: {},
      style: {},
      type
    }),
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

function mountPanel({ liveQueries = false, liveCommands = false } = {}) {
  const container = { children: [], parent: null, props: {}, type: "root" };
  const requests = [];
  const writes = [];
  const feedback = { dismiss: vi.fn(), report: vi.fn(() => ({ skipped: true })) };
  const listeners = new Map();
  const showSettings = ref(true);
  const queryClient = liveQueries
    ? new QueryClient({ defaultOptions: { queries: { retry: false } } })
    : null;
  let sessionPanel;
  let closed = false;
  projectSettingsMocks.liveCommands = liveCommands;
  projectSettingsMocks.liveQueries = liveQueries;
  if (liveQueries) {
    configureHttpWebClient({
      request(requestUrl, options) {
        const scope = /^\/api\/app\/([^/]+)(\/.*)$/u.exec(requestUrl);
        const url = scope ? `/api${scope[2]}` : requestUrl;
        if (options.method === "PUT") {
          expect(liveCommands).toBe(true);
          expect([COLLABORATION_ENDPOINT, ENGINEERING_ENDPOINT]).toContain(url);
          const response = Promise.withResolvers();
          writes.push({ body: options.body, projectSlug: projectSettingsMocks.projectSlug.value, url, ...response });
          if (closed) response.resolve({ ok: true });
          return response.promise;
        }
        expect(options.method).toBe("GET");
        expect([PROJECT_SETTINGS_ENDPOINT, ENGINEERING_ENDPOINT]).toContain(url);
        const projectSlug = scope ? decodeURIComponent(scope[1]) : projectSettingsMocks.projectSlug.value;
        const sessionId = options.query?.sessionId || "";
        const source = { rootKind: sessionId ? "session-source" : "standalone-source", sessionId };
        const data = url === PROJECT_SETTINGS_ENDPOINT
          ? createResource({ collaboration: { source } }).data.value
          : createEngineeringResource({ sessionId }).data.value;
        if (data.engineering) data.engineering.source = source;
        const key = (url === PROJECT_SETTINGS_ENDPOINT ? projectSettingsQueryKey : engineeringSettingsQueryKey)(
          "app", "public", projectSlug, sessionId
        );
        const response = Promise.withResolvers();
        requests.push({ data, key, projectSlug, requestUrl, sessionId, url, ...response });
        if (closed) response.resolve(data);
        return response.promise;
      }
    });
  }
  const sessionParent = liveQueries
    ? defineComponent({
        setup() {
          sessionPanel = useVibe64SessionPanel({ projectContext: {}, projectPane: "dashboard" }, vi.fn());
          return () => showSettings.value ? h(ProjectSettingsPanel) : null;
        }
      })
    : ProjectSettingsPanel;
  const root = liveQueries
    ? defineComponent({
        setup: () => () => h(sessionParent, { key: projectSettingsMocks.projectSlug.value })
      })
    : ProjectSettingsPanel;
  const app = testRenderer().createApp(root);
  app.component("VBtn", passthroughComponent("button"));
  app.component("VRadio", passthroughComponent("input"));
  app.component("VRadioGroup", passthroughComponent("fieldset"));
  app.component("VSelect", passthroughComponent("select"));
  app.component("VSwitch", passthroughComponent("input"));
  app.component("VTextarea", passthroughComponent("textarea"));
  if (queryClient) {
    app.use(VueQueryPlugin, { queryClient });
    app.provide(routeLocationKey, projectSettingsMocks.route);
    app.provide("jskit.shell-web.runtime.web-error.client", feedback);
    app.provide("jskit.realtime.runtime.client.socket", {
      on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
      },
      off(event, handler) {
        listeners.get(event)?.delete(handler);
      }
    });
  }
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(container);
  return {
    app,
    container,
    feedback,
    queryClient,
    requests,
    writes,
    get sessionPanel() { return sessionPanel; },
    showSettings,
    async projectChanged() {
      for (const handler of listeners.get(VIBE64_PROJECT_CHANGED_EVENT) || []) {
        handler({ projectSlug: projectSettingsMocks.projectSlug.value });
      }
      await nextTick();
    },
    listenerCount: () => [...listeners.values()].reduce((count, handlers) => count + handlers.size, 0),
    async resolveReads(from = 0) {
      const pending = requests.slice(from).map(({ key }) => (
        queryClient.getQueryCache().find({ queryKey: key, exact: true })?.promise
      ));
      for (const request of requests.slice(from)) request.resolve(request.data);
      await Promise.all(pending);
      await nextTick();
    },
    close() {
      closed = true;
      app.unmount();
      queryClient?.clear();
      for (const request of requests) request.resolve({});
      for (const request of writes) request.resolve({ ok: true });
    }
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

function findField(root, label) {
  return findNode(root, (node) => node.props?.label === label);
}

function findNodeById(root, id) {
  return findNode(root, (node) => node.props?.id === id);
}

function findRadioGroup(root) {
  return findNode(root, (node) => node.type === "fieldset");
}

function findButton(root, label) {
  return findNode(root, (node) => (
    node.type === "button" && nodeText(node).includes(label)
  ));
}

function nodeText(node) {
  return [node.text || "", ...(node.children || []).map(nodeText)].join("");
}

describe("ProjectSettingsPanel AI behaviour", () => {
  beforeEach(() => {
    projectSettingsMocks.commandOptions.length = 0;
    projectSettingsMocks.commands = [
      createCommand(),
      createCommand(),
      createCommand(),
      createCommand(),
      createCommand()
    ];
    projectSettingsMocks.dialog.mockReset();
    projectSettingsMocks.endpointOptions.length = 0;
    projectSettingsMocks.engineeringResource = createEngineeringResource();
    projectSettingsMocks.liveCommands = false;
    projectSettingsMocks.liveQueries = false;
    projectSettingsMocks.projectSlug = ref("project-a");
    projectSettingsMocks.realtimeOptions.length = 0;
    projectSettingsMocks.resource = createResource();
    projectSettingsMocks.route = reactive({ query: { sessionId: "session-a" } });
    projectSettingsMocks.router.replace.mockReset();
    projectSettingsMocks.sessionEventMatches.mockClear();
  });

  afterEach(() => {
    resetHttpWebClientForTests();
  });

  it("restores the cached PR requirement when Settings is mounted again", async () => {
    projectSettingsMocks.resource.data.value.repositoryWorkflow = { available: true, canEdit: true, requirePullRequest: true };
    for (let visit = 0; visit < 2; visit += 1) {
      projectSettingsMocks.endpointOptions.length = 0;
      projectSettingsMocks.commandOptions.length = 0;
      const { app, container } = mountPanel();
      await nextTick();
      expect(findField(container, "Require pull requests for Vibe64 publication").props.modelValue).toBe(true);
      expect(findButton(container, "Save repository workflow").props.disabled).toBe(true);
      app.unmount();
    }
  });

  it("binds panel and persistent settings read URLs to the query's project and source", async () => {
    const fixture = mountPanel({ liveQueries: true });
    try {
      expect(fixture.requests.map(({ requestUrl, sessionId }) => [requestUrl, sessionId])).toEqual([
        ["/api/app/project-a/vibe64/settings", ""],
        ["/api/app/project-a/vibe64/settings", "session-a"],
        ["/api/app/project-a/vibe64/settings/engineering", "session-a"]
      ]);
      await fixture.resolveReads();
      projectSettingsMocks.projectSlug.value = "project-b";
      projectSettingsMocks.route.query.sessionId = "session-b";
      await nextTick();
      expect(fixture.requests.slice(3).map(({ requestUrl, sessionId }) => [requestUrl, sessionId])).toEqual([
        ["/api/app/project-b/vibe64/settings", ""],
        ["/api/app/project-b/vibe64/settings", "session-b"],
        ["/api/app/project-b/vibe64/settings/engineering", "session-b"]
      ]);
      await fixture.resolveReads(3);
    } finally {
      fixture.close();
    }
  });

  it.each(["", "session-a"])("refreshes each active settings source once through the real parent query owner (source %j)", async (sessionId) => {
    projectSettingsMocks.route.query = sessionId ? { sessionId } : {};
    const fixture = mountPanel({ liveQueries: true });
    try {
      const sources = sessionId ? ["", sessionId] : [""];
      expect(fixture.requests.filter(({ url }) => url === PROJECT_SETTINGS_ENDPOINT).map((request) => request.sessionId))
        .toEqual(sources);
      await fixture.resolveReads();
      expect(fixture.sessionPanel.promptHintPolicy.value).toEqual({ enabled: false, ready: true });
      const foreignKey = projectSettingsQueryKey("app", "public", "other-project", sessionId);
      fixture.queryClient.setQueryData(foreignKey, { promptHints: { enabled: false } });
      const from = fixture.requests.length;

      await fixture.projectChanged();

      const refreshes = fixture.requests.slice(from);
      expect(refreshes.filter(({ url }) => url === PROJECT_SETTINGS_ENDPOINT).map((request) => request.sessionId))
        .toEqual(sources);
      expect(refreshes.filter(({ url }) => url === ENGINEERING_ENDPOINT)).toHaveLength(1);
      expect(fixture.queryClient.getQueryState(foreignKey).isInvalidated).toBe(false);
      for (const request of refreshes) {
        if (request.data.promptHints) request.data.promptHints.enabled = true;
      }
      await fixture.resolveReads(from);
      expect(fixture.sessionPanel.promptHintPolicy.value).toEqual({ enabled: true, ready: true });
      expect(findField(fixture.container, "Suggest useful next prompts").props.modelValue).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it("replaces a held pre-mutation settings refresh once without publishing its stale draft", async () => {
    projectSettingsMocks.route.query = {};
    const fixture = mountPanel({ liveQueries: true });
    try {
      await fixture.resolveReads();
      const key = projectSettingsQueryKey("app", "public", "project-a");
      const earlierRefresh = fixture.queryClient.refetchQueries({ queryKey: key, exact: true });
      await nextTick();
      const earlierRequest = fixture.requests.at(-1);
      expect(earlierRequest.url).toBe(PROJECT_SETTINGS_ENDPOINT);
      earlierRequest.data.collaboration.requirements = "Read before the mutation.";
      const from = fixture.requests.length;

      await fixture.projectChanged();

      const settingsRefreshes = fixture.requests.slice(from).filter(({ url }) => url === PROJECT_SETTINGS_ENDPOINT);
      expect(settingsRefreshes).toHaveLength(1);
      settingsRefreshes[0].data.collaboration.requirements = "Freshly saved requirements.";
      await fixture.resolveReads(from);
      earlierRequest.resolve(earlierRequest.data);
      await earlierRefresh;
      await nextTick();
      expect(findField(fixture.container, "Project requirements (optional)").props.modelValue)
        .toBe("Freshly saved requirements.");
      expect(fixture.queryClient.getQueryData(key).collaboration.requirements).toBe("Freshly saved requirements.");
    } finally {
      fixture.close();
    }
  });

  it("follows active settings sources and keyed project remounts without refreshing inactive scopes", async () => {
    const fixture = mountPanel({ liveQueries: true });
    try {
      await fixture.resolveReads();
      const earlierKey = projectSettingsQueryKey("app", "public", "project-a", "session-a");
      const earlierRefresh = fixture.queryClient.refetchQueries({ queryKey: earlierKey, exact: true });
      await nextTick();
      const earlierRequest = fixture.requests.at(-1);
      earlierRequest.data.collaboration.requirements = "Late source A requirements.";
      const beforeSourceSwitch = fixture.requests.length;
      projectSettingsMocks.route.query.sessionId = "session-b";
      await nextTick();
      expect(fixture.requests.slice(beforeSourceSwitch).map(({ url, sessionId }) => [url, sessionId])).toEqual([
        [PROJECT_SETTINGS_ENDPOINT, "session-b"],
        [ENGINEERING_ENDPOINT, "session-b"]
      ]);
      await fixture.resolveReads(beforeSourceSwitch);

      const beforeSourceRefresh = fixture.requests.length;
      await fixture.projectChanged();
      const sourceRefreshes = fixture.requests.slice(beforeSourceRefresh);
      expect(sourceRefreshes.filter(({ url }) => url === PROJECT_SETTINGS_ENDPOINT).map(({ sessionId }) => sessionId))
        .toEqual(["", "session-b"]);
      expect(fixture.queryClient.getQueryState(earlierKey).isInvalidated).toBe(true);
      for (const request of sourceRefreshes) {
        if (request.data.collaboration) request.data.collaboration.requirements = "Current source B requirements.";
      }
      await fixture.resolveReads(beforeSourceRefresh);
      earlierRequest.resolve(earlierRequest.data);
      await earlierRefresh;
      await nextTick();
      expect(findField(fixture.container, "Project requirements (optional)").props.modelValue)
        .toBe("Current source B requirements.");

      const beforeProjectSwitch = fixture.requests.length;
      projectSettingsMocks.projectSlug.value = "project-b";
      await nextTick();
      expect(fixture.requests.slice(beforeProjectSwitch).map(({ projectSlug, url, sessionId }) => [projectSlug, url, sessionId]))
        .toEqual([
          ["project-b", PROJECT_SETTINGS_ENDPOINT, ""],
          ["project-b", PROJECT_SETTINGS_ENDPOINT, "session-b"],
          ["project-b", ENGINEERING_ENDPOINT, "session-b"]
        ]);
      await fixture.resolveReads(beforeProjectSwitch);
      const beforeProjectRefresh = fixture.requests.length;
      await fixture.projectChanged();
      expect(fixture.requests.slice(beforeProjectRefresh).map(({ projectSlug, url, sessionId }) => [projectSlug, url, sessionId]))
        .toEqual([
          ["project-b", PROJECT_SETTINGS_ENDPOINT, ""],
          ["project-b", PROJECT_SETTINGS_ENDPOINT, "session-b"],
          ["project-b", ENGINEERING_ENDPOINT, "session-b"]
        ]);
      await fixture.resolveReads(beforeProjectRefresh);
    } finally {
      fixture.close();
    }
  });

  it("exposes a shared settings refresh failure and retries once on the next event", async () => {
    projectSettingsMocks.route.query = {};
    const fixture = mountPanel({ liveQueries: true });
    try {
      await fixture.resolveReads();
      const key = projectSettingsQueryKey("app", "public", "project-a");
      const from = fixture.requests.length;
      await fixture.projectChanged();
      const refreshes = fixture.requests.slice(from);
      expect(refreshes.filter(({ url }) => url === PROJECT_SETTINGS_ENDPOINT)).toHaveLength(1);
      const query = fixture.queryClient.getQueryCache().find({ queryKey: key, exact: true });
      const failedRead = query.promise;
      for (const request of refreshes) {
        if (request.url === PROJECT_SETTINGS_ENDPOINT) request.reject(new Error("Settings refresh failed."));
        else request.resolve(request.data);
      }
      await failedRead.catch(() => {});
      await nextTick();
      expect(fixture.sessionPanel.promptHintPolicy.value.ready).toBe(false);
      expect(findField(fixture.container, "Project settings").props.message).toBe("Settings refresh failed.");

      const beforeRetry = fixture.requests.length;
      await fixture.projectChanged();
      expect(fixture.requests.slice(beforeRetry).filter(({ url }) => url === PROJECT_SETTINGS_ENDPOINT)).toHaveLength(1);
      await fixture.resolveReads(beforeRetry);
      expect(fixture.sessionPanel.promptHintPolicy.value.ready).toBe(true);
      expect(findField(fixture.container, "Project settings")).toBeNull();
    } finally {
      fixture.close();
    }
  });

  it("keeps settings-family invalidation with the mounted parent after the child leaves and releases it on teardown", async () => {
    const fixture = mountPanel({ liveQueries: true });
    try {
      await fixture.resolveReads();
      const explicitKey = projectSettingsQueryKey("app", "public", "project-a", "session-a");
      fixture.showSettings.value = false;
      await nextTick();
      const from = fixture.requests.length;

      await fixture.projectChanged();

      expect(fixture.requests.slice(from).map(({ url, sessionId }) => [url, sessionId]))
        .toEqual([[PROJECT_SETTINGS_ENDPOINT, ""]]);
      expect(fixture.queryClient.getQueryState(explicitKey).isInvalidated).toBe(true);
      await fixture.resolveReads(from);
      const beforeReturn = fixture.requests.length;
      fixture.showSettings.value = true;
      await nextTick();
      expect(fixture.requests.slice(beforeReturn).map(({ url, sessionId }) => [url, sessionId])).toEqual([
        [PROJECT_SETTINGS_ENDPOINT, "session-a"],
        [ENGINEERING_ENDPOINT, "session-a"]
      ]);
      await fixture.resolveReads(beforeReturn);
    } finally {
      fixture.close();
    }
    const completedRequests = fixture.requests.length;
    expect(fixture.listenerCount()).toBe(0);
    await fixture.projectChanged();
    expect(fixture.requests).toHaveLength(completedRequests);
  });

  it.each(["held", "settled"])("uses one canonical engineering read when the save event arrives before PUT acknowledgement (%s event read)", async (eventRead) => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    try {
      await fixture.resolveReads();
      findField(fixture.container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      const from = fixture.requests.length;
      saving = findButton(fixture.container, "Save engineering approach").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      expect(fixture.writes[0].body).toEqual({ profile: "durable.v1", sessionId: "session-a" });
      expect(fixture.queryClient.isMutating()).toBe(1);

      await fixture.projectChanged();
      for (const request of fixture.requests.slice(from)) {
        if (request.url === ENGINEERING_ENDPOINT) {
          request.data = createEngineeringResource({ profile: "durable.v1" }).data.value;
        }
      }
      if (eventRead === "settled") await fixture.resolveReads(from);
      expect(findButton(fixture.container, "Saving…").props.disabled).toBe(true);

      const afterAcknowledgement = fixture.requests.length;
      fixture.writes[0].resolve({
        ...createEngineeringResource({ profile: "durable.v1" }).data.value,
        ok: true,
        projectSlug: "project-a"
      });
      await vi.waitFor(() => expect(
        fixture.requests.slice(afterAcknowledgement).filter(({ url }) => url === ENGINEERING_ENDPOINT)
      ).toHaveLength(1));
      expect(fixture.queryClient.isMutating()).toBe(0);
      expect(findField(fixture.container, "Engineering profile").props.disabled).toBe(true);
      for (const request of fixture.requests.slice(afterAcknowledgement)) {
        request.data = createEngineeringResource({ profile: "durable.v1" }).data.value;
      }
      await fixture.resolveReads(from);
      await saving;
      await nextTick();

      expect(fixture.requests.slice(from).filter(({ url }) => url === ENGINEERING_ENDPOINT)).toHaveLength(1);
      expect(findField(fixture.container, "Engineering profile").props.modelValue).toBe("durable.v1");
      expect(findButton(fixture.container, "Save engineering approach").props.disabled).toBe(true);
    } finally {
      fixture.close();
      await saving.catch(() => {});
    }
  });

  it("does not reuse a held pre-mutation engineering read when the PUT is acknowledged without an event", async () => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    let earlierRefresh = Promise.resolve();
    try {
      await fixture.resolveReads();
      const key = engineeringSettingsQueryKey("app", "public", "project-a", "session-a");
      const from = fixture.requests.length;
      earlierRefresh = fixture.queryClient.refetchQueries({ queryKey: key, exact: true });
      await nextTick();
      const earlierRead = fixture.requests.at(-1);
      expect(earlierRead.url).toBe(ENGINEERING_ENDPOINT);
      findField(fixture.container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      saving = findButton(fixture.container, "Save engineering approach").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      const afterAcknowledgement = fixture.requests.length;
      fixture.writes[0].resolve({
        ...createEngineeringResource({ profile: "durable.v1" }).data.value,
        ok: true,
        projectSlug: "project-a"
      });
      await vi.waitFor(() => expect(fixture.requests.slice(afterAcknowledgement)).toHaveLength(1));
      fixture.requests.at(-1).data = createEngineeringResource({ profile: "durable.v1" }).data.value;
      await fixture.resolveReads(afterAcknowledgement);
      await saving;
      earlierRead.resolve(earlierRead.data);
      await earlierRefresh;
      await nextTick();

      expect(fixture.requests.slice(from).filter(({ url }) => url === ENGINEERING_ENDPOINT)).toHaveLength(2);
      expect(fixture.queryClient.getQueryData(key).engineering.profile.id).toBe("durable.v1");
      expect(findField(fixture.container, "Engineering profile").props.modelValue).toBe("durable.v1");
      expect(findButton(fixture.container, "Save engineering approach").props.disabled).toBe(true);
    } finally {
      fixture.close();
      await Promise.all([saving.catch(() => {}), earlierRefresh]);
    }
  });

  it.each(["during", "after"])("keeps a newer engineering event authoritative %s the canonical save reload", async (eventTiming) => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    try {
      await fixture.resolveReads();
      findField(fixture.container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      saving = findButton(fixture.container, "Save engineering approach").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      const afterAcknowledgement = fixture.requests.length;
      fixture.writes[0].resolve({
        ...createEngineeringResource({ profile: "durable.v1" }).data.value,
        ok: true,
        projectSlug: "project-a"
      });
      await vi.waitFor(() => expect(fixture.requests.slice(afterAcknowledgement)).toHaveLength(1));
      const canonicalRead = fixture.requests.at(-1);
      canonicalRead.data = createEngineeringResource({ profile: "durable.v1" }).data.value;
      expect(fixture.queryClient.isMutating()).toBe(0);
      if (eventTiming === "after") {
        await fixture.resolveReads(afterAcknowledgement);
        await saving;
      }
      const afterEvent = fixture.requests.length;
      await fixture.projectChanged();
      expect(fixture.requests.slice(afterEvent).filter(({ url }) => url === ENGINEERING_ENDPOINT)).toHaveLength(1);
      for (const request of fixture.requests.slice(afterEvent)) {
        if (request.url === ENGINEERING_ENDPOINT) {
          request.data = createEngineeringResource({ profile: "high-assurance.v1" }).data.value;
        }
      }
      await fixture.resolveReads(afterEvent);
      canonicalRead.resolve(canonicalRead.data);
      await saving;
      await nextTick();

      const key = engineeringSettingsQueryKey("app", "public", "project-a", "session-a");
      expect(fixture.queryClient.getQueryData(key).engineering.profile.id).toBe("high-assurance.v1");
      expect(fixture.requests.slice(afterAcknowledgement).filter(({ url }) => url === ENGINEERING_ENDPOINT)).toHaveLength(2);
      expect(findField(fixture.container, "Engineering profile").props.disabled).toBe(false);
      expect(findField(fixture.container, "Engineering profile").props.modelValue)
        .toBe(eventTiming === "during" ? "durable.v1" : "high-assurance.v1");
    } finally {
      fixture.close();
      await saving.catch(() => {});
    }
  });

  it("handles a real engineering PUT failure once and keeps canonical refresh and draft retry", async () => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    try {
      await fixture.resolveReads();
      findField(fixture.container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      saving = findButton(fixture.container, "Save engineering approach").props.onClick();
      const outcome = saving.then(() => null, (error) => error);
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      const afterFailure = fixture.requests.length;
      const failure = new Error("Controlled engineering PUT failure.");
      fixture.writes[0].reject(failure);
      await vi.waitFor(() => expect(fixture.requests.slice(afterFailure)).toHaveLength(1));
      expect(fixture.requests.at(-1).url).toBe(ENGINEERING_ENDPOINT);
      await fixture.resolveReads(afterFailure);
      expect(await outcome).toBeNull();
      await nextTick();
      expect(fixture.feedback.report).toHaveBeenCalledOnce();
      expect(fixture.feedback.report).toHaveBeenCalledWith(expect.objectContaining({
        cause: failure,
        intent: "action-feedback",
        severity: "error"
      }));
      expect(findField(fixture.container, "Engineering profile").props.modelValue).toBe("durable.v1");
      expect(findButton(fixture.container, "Save engineering approach").props.disabled).toBe(false);

      saving = findButton(fixture.container, "Save engineering approach").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(2));
      const afterRetry = fixture.requests.length;
      fixture.writes[1].resolve({
        ...createEngineeringResource({ profile: "durable.v1" }).data.value,
        ok: true,
        projectSlug: "project-a"
      });
      await vi.waitFor(() => expect(fixture.requests.slice(afterRetry)).toHaveLength(1));
      fixture.requests.at(-1).data = createEngineeringResource({ profile: "durable.v1" }).data.value;
      await fixture.resolveReads(afterRetry);
      await saving;
      await nextTick();
      expect(findField(fixture.container, "Engineering profile").props.modelValue).toBe("durable.v1");
      expect(findButton(fixture.container, "Save engineering approach").props.disabled).toBe(true);
    } finally {
      fixture.close();
      await saving.catch(() => {});
    }
  });

  it("shows an actual canonical engineering query error and retries without another PUT", async () => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    let retrying = Promise.resolve();
    try {
      await fixture.resolveReads();
      findField(fixture.container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      saving = findButton(fixture.container, "Save engineering approach").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      const afterAcknowledgement = fixture.requests.length;
      fixture.writes[0].resolve({
        ...createEngineeringResource({ profile: "durable.v1" }).data.value,
        ok: true,
        projectSlug: "project-a"
      });
      await vi.waitFor(() => expect(fixture.requests.slice(afterAcknowledgement)).toHaveLength(1));
      fixture.requests.at(-1).reject(new Error("Engineering canonical read failed."));
      await saving;
      await nextTick();
      const notice = findField(fixture.container, "Project settings");
      expect(notice.props.message).toBe("Engineering canonical read failed.");
      expect(fixture.queryClient.isMutating()).toBe(0);
      const beforeRetry = fixture.requests.length;
      retrying = notice.props.onRetry();
      await nextTick();
      expect(fixture.requests.slice(beforeRetry).map(({ url }) => url))
        .toEqual([PROJECT_SETTINGS_ENDPOINT, ENGINEERING_ENDPOINT]);
      fixture.requests.at(-1).data = createEngineeringResource({ profile: "durable.v1" }).data.value;
      await fixture.resolveReads(beforeRetry);
      await retrying;
      await nextTick();
      expect(fixture.writes).toHaveLength(1);
      expect(findField(fixture.container, "Project settings")).toBeNull();
      expect(findField(fixture.container, "Engineering profile").props.modelValue).toBe("durable.v1");
      expect(findField(fixture.container, "Engineering profile").props.disabled).toBe(false);
      expect(findButton(fixture.container, "Save engineering approach").props.disabled).toBe(true);
    } finally {
      fixture.close();
      await Promise.all([saving.catch(() => {}), retrying]);
    }
  });

  it("keeps a new source profile isolated when an earlier engineering save is acknowledged", async () => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    try {
      await fixture.resolveReads();
      findField(fixture.container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      saving = findButton(fixture.container, "Save engineering approach").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      expect(fixture.writes[0].body.sessionId).toBe("session-a");
      const beforeSourceSwitch = fixture.requests.length;
      projectSettingsMocks.route.query.sessionId = "session-b";
      await nextTick();
      for (const request of fixture.requests.slice(beforeSourceSwitch)) {
        if (request.url === ENGINEERING_ENDPOINT) {
          request.data = createEngineeringResource({ profile: "high-assurance.v1", sessionId: "session-b" }).data.value;
        }
      }
      await fixture.resolveReads(beforeSourceSwitch);
      expect(findField(fixture.container, "Engineering profile").props.modelValue).toBe("high-assurance.v1");
      const afterAcknowledgement = fixture.requests.length;
      fixture.writes[0].resolve({
        ...createEngineeringResource({ profile: "durable.v1" }).data.value,
        ok: true,
        projectSlug: "project-a"
      });
      await vi.waitFor(() => expect(fixture.requests.slice(afterAcknowledgement)).toHaveLength(1));
      const refresh = fixture.requests.at(-1);
      expect(refresh.sessionId).toBe("session-b");
      refresh.data = createEngineeringResource({ profile: "high-assurance.v1", sessionId: "session-b" }).data.value;
      await fixture.resolveReads(afterAcknowledgement);
      await saving;
      await nextTick();
      const key = engineeringSettingsQueryKey("app", "public", "project-a", "session-b");
      expect(fixture.queryClient.getQueryData(key).engineering.profile.id).toBe("high-assurance.v1");
      expect(findField(fixture.container, "Engineering profile").props.modelValue).toBe("high-assurance.v1");
      expect(findField(fixture.container, "Engineering profile").props.disabled).toBe(false);
      expect(fixture.writes).toHaveLength(1);
    } finally {
      fixture.close();
      await saving.catch(() => {});
    }
  });

  it("keeps Collaboration pending through its canonical read before accepting an old-value reversion", async () => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    let refreshing = Promise.resolve();
    try {
      await fixture.resolveReads();
      expect(findField(fixture.container, "Tone").props.modelValue).toBe("military");
      findField(fixture.container, "Tone").props["onUpdate:modelValue"]("playful");
      await nextTick();
      saving = findButton(fixture.container, "Save collaboration").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      expect(fixture.writes[0].url).toBe(COLLABORATION_ENDPOINT);
      expect(fixture.writes[0].body).toEqual({
        experience: "expert",
        explanationStyle: "teaching",
        requirements: "Use Australian English.",
        responseLength: "detailed",
        sessionId: "session-a",
        tone: "playful"
      });
      const afterAcknowledgement = fixture.requests.length;
      const saved = createResource({ collaboration: { tone: "playful" } }).data.value;
      fixture.writes[0].resolve({ collaboration: saved.collaboration, ok: true, projectSlug: "project-a" });
      await vi.waitFor(() => expect(fixture.requests.slice(afterAcknowledgement)).toHaveLength(1));
      expect(fixture.requests.at(-1).url).toBe(PROJECT_SETTINGS_ENDPOINT);
      fixture.requests.at(-1).data = saved;

      expect(fixture.queryClient.isMutating()).toBe(0);
      for (const label of ["Tone", "Response length", "Experience level", "Explanation style", "Project requirements (optional)"]) {
        expect(findField(fixture.container, label).props.disabled).toBe(true);
      }
      const pendingSave = findButton(fixture.container, "Saving…");
      expect(pendingSave.props.disabled).toBe(true);
      await pendingSave.props.onClick();
      expect(fixture.writes).toHaveLength(1);
      await fixture.resolveReads(afterAcknowledgement);
      await saving;
      await nextTick();
      expect(findField(fixture.container, "Tone").props.disabled).toBe(false);
      expect(findField(fixture.container, "Tone").props.modelValue).toBe("playful");
      expect(findButton(fixture.container, "Save collaboration").props.disabled).toBe(true);

      // Reverting to the former baseline is a new edit, not a clean old snapshot.
      findField(fixture.container, "Tone").props["onUpdate:modelValue"]("military");
      await nextTick();
      const from = fixture.requests.length;
      const key = projectSettingsQueryKey("app", "public", "project-a", "session-a");
      refreshing = fixture.queryClient.refetchQueries({ queryKey: key, exact: true });
      await nextTick();
      fixture.requests.at(-1).data = saved;
      await fixture.resolveReads(from);
      await refreshing;
      expect(findField(fixture.container, "Tone").props.modelValue).toBe("military");
      expect(findButton(fixture.container, "Save collaboration").props.disabled).toBe(false);
      expect(fixture.writes).toHaveLength(1);
    } finally {
      fixture.close();
      await Promise.all([saving.catch(() => {}), refreshing]);
    }
  });

  it("handles a real Collaboration PUT failure once and preserves its draft for retry", async () => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    try {
      await fixture.resolveReads();
      findField(fixture.container, "Tone").props["onUpdate:modelValue"]("playful");
      await nextTick();
      saving = findButton(fixture.container, "Save collaboration").props.onClick();
      const outcome = saving.then(() => null, (error) => error);
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      expect(fixture.writes[0].url).toBe(COLLABORATION_ENDPOINT);
      const failure = new Error("Controlled Collaboration PUT failure.");
      fixture.writes[0].reject(failure);
      expect(await outcome).toBeNull();
      await nextTick();
      expect(fixture.feedback.report).toHaveBeenCalledOnce();
      expect(fixture.feedback.report).toHaveBeenCalledWith(expect.objectContaining({
        cause: failure,
        intent: "action-feedback",
        severity: "error"
      }));
      expect(findField(fixture.container, "Tone").props.modelValue).toBe("playful");
      expect(findField(fixture.container, "Tone").props.disabled).toBe(false);
      expect(findButton(fixture.container, "Save collaboration").props.disabled).toBe(false);

      saving = findButton(fixture.container, "Save collaboration").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(2));
      expect(fixture.writes[1].url).toBe(COLLABORATION_ENDPOINT);
      expect(fixture.writes[1].body).toEqual(fixture.writes[0].body);
      const afterRetry = fixture.requests.length;
      const saved = createResource({ collaboration: { tone: "playful" } }).data.value;
      fixture.writes[1].resolve({ collaboration: saved.collaboration, ok: true, projectSlug: "project-a" });
      await vi.waitFor(() => expect(fixture.requests.slice(afterRetry)).toHaveLength(1));
      expect(fixture.requests.at(-1).url).toBe(PROJECT_SETTINGS_ENDPOINT);
      fixture.requests.at(-1).data = saved;
      await fixture.resolveReads(afterRetry);
      await saving;
      await nextTick();
      expect(findField(fixture.container, "Tone").props.disabled).toBe(false);
      expect(findField(fixture.container, "Tone").props.modelValue).toBe("playful");
      expect(findButton(fixture.container, "Save collaboration").props.disabled).toBe(true);
    } finally {
      fixture.close();
      await saving.catch(() => {});
    }
  });

  it("retries a failed canonical Collaboration read without resubmitting the saved choices", async () => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    let retrying = Promise.resolve();
    try {
      await fixture.resolveReads();
      findField(fixture.container, "Tone").props["onUpdate:modelValue"]("playful");
      await nextTick();
      saving = findButton(fixture.container, "Save collaboration").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      expect(fixture.writes[0].url).toBe(COLLABORATION_ENDPOINT);
      const afterAcknowledgement = fixture.requests.length;
      const saved = createResource({ collaboration: { tone: "playful" } }).data.value;
      fixture.writes[0].resolve({ collaboration: saved.collaboration, ok: true, projectSlug: "project-a" });
      await vi.waitFor(() => expect(fixture.requests.slice(afterAcknowledgement)).toHaveLength(1));
      expect(fixture.requests.at(-1).url).toBe(PROJECT_SETTINGS_ENDPOINT);
      fixture.requests.at(-1).reject(new Error("Collaboration canonical read failed."));
      await saving;
      await nextTick();
      const notice = findField(fixture.container, "Project settings");
      expect(notice.props.message).toBe("Collaboration canonical read failed.");
      expect(fixture.queryClient.isMutating()).toBe(0);

      const beforeRetry = fixture.requests.length;
      retrying = notice.props.onRetry();
      await nextTick();
      expect(fixture.requests.slice(beforeRetry).map(({ url }) => url))
        .toEqual([PROJECT_SETTINGS_ENDPOINT, ENGINEERING_ENDPOINT]);
      fixture.requests.find((request, index) => index >= beforeRetry && request.url === PROJECT_SETTINGS_ENDPOINT).data = saved;
      await fixture.resolveReads(beforeRetry);
      await retrying;
      await nextTick();
      expect(fixture.writes).toHaveLength(1);
      expect(findField(fixture.container, "Project settings")).toBeNull();
      expect(findField(fixture.container, "Tone").props.modelValue).toBe("playful");
      expect(findField(fixture.container, "Tone").props.disabled).toBe(false);
      expect(findButton(fixture.container, "Save collaboration").props.disabled).toBe(true);
    } finally {
      fixture.close();
      await Promise.all([saving.catch(() => {}), retrying]);
    }
  });

  it("keeps source B's Collaboration choices isolated through A's late save acknowledgement", async () => {
    const fixture = mountPanel({ liveQueries: true, liveCommands: true });
    let saving = Promise.resolve();
    try {
      await fixture.resolveReads();
      findField(fixture.container, "Tone").props["onUpdate:modelValue"]("playful");
      await nextTick();
      saving = findButton(fixture.container, "Save collaboration").props.onClick();
      void saving.catch(() => {});
      await vi.waitFor(() => expect(fixture.writes).toHaveLength(1));
      expect(fixture.writes[0].url).toBe(COLLABORATION_ENDPOINT);
      expect(fixture.writes[0].body.sessionId).toBe("session-a");
      const beforeSourceSwitch = fixture.requests.length;
      projectSettingsMocks.route.query.sessionId = "session-b";
      await nextTick();
      const sourceB = createResource({ collaboration: {
        requirements: "Source B requirements.",
        source: { rootKind: "session-source", sessionId: "session-b" },
        tone: "direct"
      } }).data.value;
      for (const request of fixture.requests.slice(beforeSourceSwitch)) {
        if (request.url === PROJECT_SETTINGS_ENDPOINT) request.data = sourceB;
      }
      await fixture.resolveReads(beforeSourceSwitch);
      expect(findField(fixture.container, "Tone").props.modelValue).toBe("direct");

      const afterAcknowledgement = fixture.requests.length;
      const savedA = createResource({ collaboration: { tone: "playful" } }).data.value;
      fixture.writes[0].resolve({ collaboration: savedA.collaboration, ok: true, projectSlug: "project-a" });
      await vi.waitFor(() => expect(fixture.requests.slice(afterAcknowledgement)).toHaveLength(1));
      const refresh = fixture.requests.at(-1);
      expect(refresh.url).toBe(PROJECT_SETTINGS_ENDPOINT);
      expect(refresh.sessionId).toBe("session-b");
      refresh.data = sourceB;
      expect(findField(fixture.container, "Tone").props.disabled).toBe(true);
      await fixture.resolveReads(afterAcknowledgement);
      await saving;
      await nextTick();
      const key = projectSettingsQueryKey("app", "public", "project-a", "session-b");
      expect(fixture.queryClient.getQueryData(key).collaboration).toEqual(sourceB.collaboration);
      expect(findField(fixture.container, "Tone").props.modelValue).toBe("direct");
      expect(findField(fixture.container, "Project requirements (optional)").props.modelValue).toBe("Source B requirements.");
      expect(findField(fixture.container, "Tone").props.disabled).toBe(false);
      expect(findButton(fixture.container, "Save collaboration").props.disabled).toBe(true);
      expect(fixture.writes).toHaveLength(1);
    } finally {
      fixture.close();
      await saving.catch(() => {});
    }
  });

  it("hydrates every writable field synchronously from warm cached project data", () => {
    const { app, container } = mountPanel();

    expect(findRadioGroup(container).props.modelValue).toBe("session");
    expect(findRadioGroup(container).props["aria-labelledby"])
      .toBe("development-database-title");
    expect(findField(container, "A separate database for each session").props.disabled)
      .toBe(false);
    expect(findField(container, "One database shared by this project").props.disabled)
      .toBe(false);
    expect(findField(container, "Tone").props.modelValue).toBe("military");
    expect(findField(container, "Tone").props.density).toBe("comfortable");
    expect(findField(container, "Tone").props.items).toContainEqual({
      label: "Crisp and military",
      value: "military"
    });
    expect(findField(container, "Response length").props.modelValue).toBe("detailed");
    expect(findField(container, "Response length").props.density).toBe("comfortable");
    expect(findField(container, "Experience level").props.modelValue).toBe("expert");
    expect(findField(container, "Experience level").props.density).toBe("comfortable");
    expect(findField(container, "Explanation style").props.modelValue).toBe("teaching");
    expect(findField(container, "Explanation style").props.density).toBe("comfortable");
    expect(findField(container, "Project requirements (optional)").props.modelValue)
      .toBe("Use Australian English.");
    expect(findField(container, "Suggest useful next prompts").props.modelValue).toBe(false);
    expect(findField(container, "Engineering profile").props.modelValue).toBe("focused.v1");
    expect(findField(container, "Engineering profile").props.hint)
      .toContain("Small, direct changes");
    expect(findButton(container, "Save engineering approach").props.disabled).toBe(true);
    expect(findButton(container, "Save collaboration").props.disabled).toBe(true);
    expect(findButton(container, "Save prompt suggestions").props.disabled).toBe(true);

    app.unmount();
  });

  it("keeps warm settings visible during refresh and preserves an unsaved database draft", async () => {
    projectSettingsMocks.resource = createResource({
      developmentDatabase: {
        scope: "project"
      }
    });
    projectSettingsMocks.resource.isLoading.value = true;
    const { app, container } = mountPanel();

    const group = findRadioGroup(container);
    expect(group.props.modelValue).toBe("project");
    expect(findField(container, "Tone")).toBeTruthy();
    expect(findNode(container, (node) => node.type === "aside")).toBeNull();

    group.props["onUpdate:modelValue"]("session");
    await nextTick();
    projectSettingsMocks.resource.data.value = {
      ...projectSettingsMocks.resource.data.value,
      developmentDatabase: {
        canChange: false,
        disabledReason: "Close both open sessions before changing the development database.",
        managed: true,
        openSessionCount: 2,
        options: {
          project: {
            available: false,
            disabledReason: "A shared database allows one open session, but this project has 2."
          },
          session: {
            available: true
          }
        },
        scope: "project"
      }
    };
    projectSettingsMocks.realtimeOptions[0].onEvent();
    await nextTick();

    expect(findRadioGroup(container).props.modelValue).toBe("session");
    expect(findField(container, "One database shared by this project").props.disabled)
      .toBe(true);
    expect(projectSettingsMocks.resource.reload).toHaveBeenCalledOnce();

    app.unmount();
  });

  it("disables and describes only the unavailable shared-database choice", () => {
    const projectReason = "A shared database allows one open session, but this project has 2.";
    projectSettingsMocks.resource = createResource({
      developmentDatabase: {
        canChange: false,
        disabledReason: "Close both open sessions before changing the development database.",
        openSessionCount: 2,
        options: {
          project: {
            available: false,
            disabledReason: projectReason
          },
          session: {
            available: true
          }
        },
        scope: "project"
      }
    });
    const { app, container } = mountPanel();

    const sessionChoice = findField(container, "A separate database for each session");
    const projectChoice = findField(container, "One database shared by this project");
    expect(findRadioGroup(container).props.modelValue).toBe("project");
    expect(sessionChoice.props.disabled).toBe(false);
    expect(sessionChoice.props["aria-describedby"]).toBeUndefined();
    expect(projectChoice.props.disabled).toBe(true);
    expect(projectChoice.props["aria-describedby"])
      .toBe("development-database-project-reason");
    expect(nodeText(findNodeById(container, "development-database-project-reason")))
      .toContain(projectReason);
    expect(findButton(container, "Save database choice").props.disabled).toBe(true);

    app.unmount();
  });

  it("guards the database command when the selected scope is unavailable", async () => {
    projectSettingsMocks.resource = createResource({
      developmentDatabase: {
        options: {
          project: {
            available: false,
            disabledReason: "A shared database is unavailable."
          },
          session: {
            available: true
          }
        }
      }
    });
    const { app, container } = mountPanel();

    findRadioGroup(container).props["onUpdate:modelValue"]("project");
    await nextTick();
    const save = findButton(container, "Save database choice");
    expect(save.props.disabled).toBe(true);
    await save.props.onClick();
    expect(projectSettingsMocks.commands[0].run).not.toHaveBeenCalled();
    expect(projectSettingsMocks.resource.reload).not.toHaveBeenCalled();

    app.unmount();
  });

  it("labels the database controls and their unavailable-choice explanation", () => {
    expect(componentSource).toContain('aria-labelledby="development-database-title"');
    expect(componentSource).toContain("development-database-project-reason");
  });

  it("lets an owner edit but keeps a member read-only even if an event is invoked", async () => {
    let mounted = mountPanel();
    const ownerTone = findField(mounted.container, "Tone");
    expect(ownerTone.props.disabled).toBe(false);

    ownerTone.props["onUpdate:modelValue"]("playful");
    await nextTick();
    expect(findButton(mounted.container, "Save collaboration").props.disabled).toBe(false);
    mounted.app.unmount();

    projectSettingsMocks.commandOptions.length = 0;
    projectSettingsMocks.commands = [
      createCommand(),
      createCommand(),
      createCommand(),
      createCommand()
    ];
    projectSettingsMocks.realtimeOptions.length = 0;
    projectSettingsMocks.resource = createResource({ canEdit: false });
    mounted = mountPanel();

    const memberTone = findField(mounted.container, "Tone");
    expect(memberTone.props.disabled).toBe(true);
    expect(findField(mounted.container, "Project requirements (optional)").props.disabled).toBe(true);
    memberTone.props["onUpdate:modelValue"]("playful");
    await nextTick();
    const save = findButton(mounted.container, "Save collaboration");
    expect(save.props.disabled).toBe(true);
    await save.props.onClick();
    expect(projectSettingsMocks.commands[1].run).not.toHaveBeenCalled();

    mounted.app.unmount();
  });

  it("keeps the Vibe64 prompt-suggestion toggle usable when collaboration source is unavailable", async () => {
    projectSettingsMocks.resource = createResource({
      available: false,
      collaboration: {
        canEdit: false,
        unavailableReason: "This session has no project source."
      }
    });
    const { app, container } = mountPanel();

    expect(findField(container, "Tone").props.disabled).toBe(true);
    const promptHints = findField(container, "Suggest useful next prompts");
    expect(promptHints.props.disabled).toBe(false);
    promptHints.props["onUpdate:modelValue"](true);
    await nextTick();
    const save = findButton(container, "Save prompt suggestions");
    expect(save.props.disabled).toBe(false);
    await save.props.onClick();
    expect(projectSettingsMocks.commands[2].run).toHaveBeenCalledWith({
      promptHints: true
    });
    expect(projectSettingsMocks.commandOptions[2].buildRawPayload(null, {
      context: { promptHints: true }
    })).toEqual({ promptHints: true });

    app.unmount();
  });

  it("preserves one unsaved setting when the separately saved setting refreshes", async () => {
    const { app, container } = mountPanel();

    findField(container, "Tone").props["onUpdate:modelValue"]("playful");
    await nextTick();
    projectSettingsMocks.resource.data.value = {
      ...projectSettingsMocks.resource.data.value,
      promptHints: {
        canEdit: true,
        enabled: true
      }
    };
    await nextTick();

    expect(findField(container, "Tone").props.modelValue).toBe("playful");
    expect(findButton(container, "Save collaboration").props.disabled).toBe(false);
    expect(findField(container, "Suggest useful next prompts").props.modelValue).toBe(true);

    findField(container, "Suggest useful next prompts").props["onUpdate:modelValue"](false);
    await nextTick();
    projectSettingsMocks.resource.data.value = {
      ...projectSettingsMocks.resource.data.value,
      collaboration: {
        ...projectSettingsMocks.resource.data.value.collaboration,
        tone: "direct"
      }
    };
    await nextTick();

    expect(findField(container, "Suggest useful next prompts").props.modelValue).toBe(false);
    expect(findButton(container, "Save prompt suggestions").props.disabled).toBe(false);

    app.unmount();
  });

  it.each([
    ["warm session cache", "session", false],
    ["cold session cache", "session", true],
    ["another project with the same standalone identity", "project", false]
  ])("does not submit a dirty collaboration draft after switching to %s", async (_label, selection, cold) => {
    const standalone = selection === "project";
    const source = {
      rootKind: standalone ? "standalone-source" : "session-source",
      sessionId: standalone ? "" : "session-a"
    };
    projectSettingsMocks.resource = createResource({ collaboration: { source } });
    projectSettingsMocks.engineeringResource.data.value.engineering.source = { ...source };
    projectSettingsMocks.route.query = source.sessionId ? { sessionId: source.sessionId } : {};
    const { app, container } = mountPanel();
    try {
      findField(container, "Tone").props["onUpdate:modelValue"]("playful");
      findField(container, "Project requirements (optional)").props["onUpdate:modelValue"]("Keep source A's draft.");
      await nextTick();
      const previousSave = findButton(container, "Save collaboration");
      const nextSource = { ...source, sessionId: standalone ? "" : "session-b" };
      if (standalone) projectSettingsMocks.projectSlug.value = "project-b";
      else projectSettingsMocks.route.query = { sessionId: "session-b" };

      if (cold) {
        projectSettingsMocks.resource.isLoading.value = true;
        projectSettingsMocks.resource.data.value = undefined;
        await nextTick();
        expect(findField(container, "Tone")).toBeNull();
        await previousSave.props.onClick();
        expect(projectSettingsMocks.commands[1].run).not.toHaveBeenCalled();
      }

      const nextCollaboration = {
        experience: "beginner",
        explanationStyle: "conclusions",
        requirements: "Source B's requirements.",
        responseLength: "balanced",
        source: nextSource,
        tone: "direct"
      };
      projectSettingsMocks.resource.data.value = createResource({
        collaboration: nextCollaboration
      }).data.value;
      projectSettingsMocks.resource.isLoading.value = false;
      await nextTick();

      expect(projectSettingsMocks.endpointOptions[0].readQuery.value)
        .toEqual(standalone ? {} : { sessionId: "session-b" });
      if (standalone) expect(projectSettingsMocks.endpointOptions[0].queryKey.value).toContain("project-b");
      const save = findButton(container, "Save collaboration");
      await save.props.onClick();
      expect(projectSettingsMocks.commands[1].run).not.toHaveBeenCalled();
      expect(save.props.disabled).toBe(true);
      expect(findField(container, "Tone").props.modelValue).toBe("direct");
      expect(findField(container, "Response length").props.modelValue).toBe("balanced");
      expect(findField(container, "Experience level").props.modelValue).toBe("beginner");
      expect(findField(container, "Explanation style").props.modelValue).toBe("conclusions");
      expect(findField(container, "Project requirements (optional)").props.modelValue)
        .toBe("Source B's requirements.");

      findField(container, "Tone").props["onUpdate:modelValue"]("encouraging");
      await nextTick();
      await findButton(container, "Save collaboration").props.onClick();
      expect(projectSettingsMocks.commands[1].run).toHaveBeenCalledOnce();
      expect(projectSettingsMocks.commandOptions[1].buildRawPayload(null, {
        context: projectSettingsMocks.commands[1].run.mock.calls[0][0]
      })).toEqual({
        experience: "beginner",
        explanationStyle: "conclusions",
        requirements: "Source B's requirements.",
        responseLength: "balanced",
        ...(standalone ? {} : { sessionId: "session-b" }),
        tone: "encouraging"
      });
    } finally {
      app.unmount();
    }
  });

  it("clears a dirty collaboration draft when standalone source becomes metadata-only", async () => {
    const source = { rootKind: "standalone-source", sessionId: "" };
    projectSettingsMocks.resource = createResource({ collaboration: { source } });
    projectSettingsMocks.engineeringResource.data.value.engineering.source = { ...source };
    projectSettingsMocks.route.query = {};
    const { app, container } = mountPanel();
    try {
      findField(container, "Tone").props["onUpdate:modelValue"]("playful");
      findField(container, "Project requirements (optional)").props["onUpdate:modelValue"]("Standalone draft.");
      await nextTick();
      projectSettingsMocks.resource.data.value = createResource({
        available: false,
        collaboration: {
          canEdit: false,
          choices: {},
          experience: "",
          explanationStyle: "",
          requirements: "",
          responseLength: "",
          source: { rootKind: "metadata-only", sessionId: "" },
          status: "unavailable",
          tone: "",
          unavailableReason: "Create or select an AI session to set collaboration guidance."
        }
      }).data.value;
      await nextTick();

      const save = findButton(container, "Save collaboration");
      expect(save.props.disabled).toBe(true);
      await save.props.onClick();
      expect(projectSettingsMocks.commands[1].run).not.toHaveBeenCalled();
      expect(findField(container, "Tone").props.disabled).toBe(true);
      expect(findField(container, "Tone").props.modelValue).toBe("");
      expect(findField(container, "Project requirements (optional)").props.modelValue).toBe("");
    } finally {
      app.unmount();
    }
  });

  it.each(["refresh", "unresolved query transition"])(
    "preserves a dirty collaboration draft through a same-source %s",
    async (transition) => {
      const { app, container } = mountPanel();
      try {
        findField(container, "Tone").props["onUpdate:modelValue"]("playful");
        findField(container, "Project requirements (optional)").props["onUpdate:modelValue"]("");
        await nextTick();
        if (transition === "unresolved query transition") {
          projectSettingsMocks.resource.isLoading.value = true;
          projectSettingsMocks.resource.data.value = undefined;
          await nextTick();
        }
        projectSettingsMocks.resource.data.value = createResource({
          collaboration: { tone: "direct", requirements: "Refreshed source requirements." }
        }).data.value;
        projectSettingsMocks.resource.isLoading.value = false;
        await nextTick();

        expect(findField(container, "Tone").props.modelValue).toBe("playful");
        expect(findField(container, "Project requirements (optional)").props.modelValue).toBe("");
        expect(findButton(container, "Save collaboration").props.disabled).toBe(false);
        await findButton(container, "Save collaboration").props.onClick();
        expect(projectSettingsMocks.commands[1].run).toHaveBeenCalledWith({
          collaboration: {
            experience: "expert",
            explanationStyle: "teaching",
            requirements: "",
            responseLength: "detailed",
            tone: "playful"
          },
          sessionId: "session-a"
        });
      } finally {
        app.unmount();
      }
    }
  );

  it("uses a stable pending label and blocks a duplicate owner submission", async () => {
    const pending = createDeferred();
    const aiCommand = createCommand({ pending });
    projectSettingsMocks.commands = [
      createCommand(),
      aiCommand,
      createCommand(),
      createCommand()
    ];
    const { app, container } = mountPanel();

    findField(container, "Tone").props["onUpdate:modelValue"]("encouraging");
    await nextTick();
    let save = findButton(container, "Save collaboration");
    const firstSubmission = save.props.onClick();
    const duplicateSubmission = save.props.onClick();
    await nextTick();

    save = findButton(container, "Saving…");
    expect(save.props.disabled).toBe(true);
    expect(aiCommand.run).toHaveBeenCalledOnce();
    expect(projectSettingsMocks.commandOptions[1].buildRawPayload(null, {
      context: aiCommand.run.mock.calls[0][0]
    })).toMatchObject({
      experience: "expert",
      explanationStyle: "teaching",
      requirements: "Use Australian English.",
      responseLength: "detailed",
      sessionId: "session-a",
      tone: "encouraging"
    });

    pending.resolve();
    await Promise.all([firstSubmission, duplicateSubmission]);
    await nextTick();
    expect(projectSettingsMocks.resource.reload).toHaveBeenCalledOnce();
    expect(findButton(container, "Save collaboration")).toBeTruthy();

    app.unmount();
  });

  it("leaves project-requirements validation to Genesis", async () => {
    const { app, container } = mountPanel();
    const note = findField(container, "Project requirements (optional)");

    note.props["onUpdate:modelValue"]("🌱".repeat(501));
    await nextTick();
    expect(findField(container, "Project requirements (optional)").props.errorMessages)
      .toBeUndefined();
    expect(findButton(container, "Save collaboration").props.disabled).toBe(false);

    app.unmount();
  });

  it("saves a source-owned engineering profile with stable pending feedback", async () => {
    const pending = createDeferred();
    const engineeringCommand = createCommand({ pending });
    projectSettingsMocks.commands = [
      createCommand(),
      createCommand(),
      createCommand(),
      createCommand(),
      engineeringCommand
    ];
    const { app, container } = mountPanel();

    findField(container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
    await nextTick();
    expect(findField(container, "Engineering profile").props.hint)
      .toContain("Long-lived product work");
    const firstSubmission = findButton(container, "Save engineering approach").props.onClick();
    const duplicateSubmission = findButton(container, "Save engineering approach").props.onClick();
    await nextTick();

    expect(findButton(container, "Saving…").props.disabled).toBe(true);
    expect(engineeringCommand.run).toHaveBeenCalledOnce();
    expect(projectSettingsMocks.commandOptions[4].buildRawPayload(null, {
      context: engineeringCommand.run.mock.calls[0][0]
    })).toEqual({
      profile: "durable.v1",
      sessionId: "session-a"
    });

    pending.resolve();
    await Promise.all([firstSubmission, duplicateSubmission]);
    await nextTick();
    expect(projectSettingsMocks.engineeringResource.reload).toHaveBeenCalledOnce();

    app.unmount();
  });

  it.each(["focused.v1", "high-assurance.v1"])(
    "preserves an unsaved engineering choice when the same source refreshes with %s",
    async (profile) => {
      const { app, container } = mountPanel();
      try {
        findField(container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
        await nextTick();
        projectSettingsMocks.engineeringResource.data.value = createEngineeringResource({ profile }).data.value;
        await nextTick();

        expect(findField(container, "Engineering profile").props.modelValue).toBe("durable.v1");
        expect(findButton(container, "Save engineering approach").props.disabled).toBe(false);
      } finally {
        app.unmount();
      }
    }
  );

  it("preserves an engineering draft across an unresolved query transition for the same source", async () => {
    const { app, container } = mountPanel();
    try {
      findField(container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      projectSettingsMocks.engineeringResource.isLoading.value = true;
      projectSettingsMocks.engineeringResource.data.value = undefined;
      await nextTick();
      projectSettingsMocks.engineeringResource.data.value = createEngineeringResource().data.value;
      projectSettingsMocks.engineeringResource.isLoading.value = false;
      await nextTick();

      expect(findField(container, "Engineering profile").props.modelValue).toBe("durable.v1");
      expect(findButton(container, "Save engineering approach").props.disabled).toBe(false);
    } finally {
      app.unmount();
    }
  });

  it("keeps the engineering save pending until its canonical refresh finishes", async () => {
    const refreshStarted = createDeferred();
    const refresh = createDeferred();
    const { app, container } = mountPanel();
    let saving;
    try {
      findField(container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      projectSettingsMocks.engineeringResource.reload.mockImplementationOnce(async () => {
        refreshStarted.resolve();
        await refresh.promise;
        const data = createEngineeringResource({ profile: "durable.v1" }).data.value;
        projectSettingsMocks.engineeringResource.data.value = data;
        return { data };
      });
      saving = findButton(container, "Save engineering approach").props.onClick();
      await refreshStarted.promise;
      await nextTick();

      expect(projectSettingsMocks.commands[4].isRunning).toBe(false);
      expect(findField(container, "Engineering profile").props.disabled).toBe(true);
      expect(findButton(container, "Saving…").props.disabled).toBe(true);
      await findButton(container, "Saving…").props.onClick();
      expect(projectSettingsMocks.commands[4].run).toHaveBeenCalledOnce();
      refresh.resolve();
      await saving;
      await nextTick();
      expect(findField(container, "Engineering profile").props.modelValue).toBe("durable.v1");
      expect(findField(container, "Engineering profile").props.disabled).toBe(false);
      expect(findButton(container, "Save engineering approach").props.disabled).toBe(true);
    } finally {
      refresh.resolve();
      await saving;
      app.unmount();
    }
  });

  it("propagates an unexpected Collaboration refresh failure and releases its pending state", async () => {
    const { app, container } = mountPanel();
    try {
      const failure = new Error("Unexpected Collaboration refresh failure");
      projectSettingsMocks.resource.reload.mockRejectedValueOnce(failure);
      findField(container, "Tone").props["onUpdate:modelValue"]("playful");
      await nextTick();

      await expect(findButton(container, "Save collaboration").props.onClick()).rejects.toBe(failure);
      await nextTick();
      expect(findField(container, "Tone").props.modelValue).toBe("playful");
      expect(findField(container, "Tone").props.disabled).toBe(false);
      expect(findButton(container, "Save collaboration").props.disabled).toBe(false);
      await findButton(container, "Save collaboration").props.onClick();
      expect(projectSettingsMocks.commands[1].run).toHaveBeenCalledTimes(2);
    } finally {
      app.unmount();
    }
  });

  it.each(["save", "refresh"])("releases the engineering action after a %s failure and permits retry", async (stage) => {
    const { app, container } = mountPanel();
    try {
      const failure = new Error(`Controlled engineering ${stage} failure`);
      if (stage === "save") projectSettingsMocks.commands[4].run.mockRejectedValueOnce(failure);
      else projectSettingsMocks.engineeringResource.reload.mockRejectedValueOnce(failure);
      findField(container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();

      const saving = findButton(container, "Save engineering approach").props.onClick();
      if (stage === "save") await expect(saving).resolves.toBeUndefined();
      else await expect(saving).rejects.toBe(failure);
      await nextTick();
      expect(findField(container, "Engineering profile").props.modelValue).toBe("durable.v1");
      expect(findField(container, "Engineering profile").props.disabled).toBe(false);
      expect(findButton(container, "Save engineering approach").props.disabled).toBe(false);
      await findButton(container, "Save engineering approach").props.onClick();
      expect(projectSettingsMocks.commands[4].run).toHaveBeenCalledTimes(2);
    } finally {
      app.unmount();
    }
  });

  it("updates a clean engineering choice and marks a saved draft clean", async () => {
    const { app, container } = mountPanel();
    try {
      projectSettingsMocks.engineeringResource.data.value = createEngineeringResource({
        profile: "high-assurance.v1"
      }).data.value;
      await nextTick();
      expect(findField(container, "Engineering profile").props.modelValue).toBe("high-assurance.v1");
      expect(findButton(container, "Save engineering approach").props.disabled).toBe(true);

      findField(container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      projectSettingsMocks.engineeringResource.reload.mockImplementationOnce(async () => {
        const data = createEngineeringResource({ profile: "durable.v1" }).data.value;
        projectSettingsMocks.engineeringResource.data.value = data;
        return { data };
      });
      await findButton(container, "Save engineering approach").props.onClick();
      await nextTick();

      expect(projectSettingsMocks.commands[4].run).toHaveBeenCalledWith({
        profile: "durable.v1",
        sessionId: "session-a"
      });
      expect(findField(container, "Engineering profile").props.modelValue).toBe("durable.v1");
      expect(findButton(container, "Save engineering approach").props.disabled).toBe(true);
    } finally {
      app.unmount();
    }
  });

  it("does not carry a dirty engineering choice into another session source", async () => {
    const { app, container } = mountPanel();
    try {
      findField(container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      projectSettingsMocks.route.query = { sessionId: "session-b" };
      projectSettingsMocks.engineeringResource.data.value = createEngineeringResource({
        profile: "high-assurance.v1",
        sessionId: "session-b"
      }).data.value;
      await nextTick();

      expect(findField(container, "Engineering profile").props.modelValue).toBe("high-assurance.v1");
      expect(findButton(container, "Save engineering approach").props.disabled).toBe(true);
    } finally {
      app.unmount();
    }
  });

  it("does not carry a dirty engineering choice between projects with the same local source identity", async () => {
    projectSettingsMocks.engineeringResource = createEngineeringResource({ sessionId: "" });
    projectSettingsMocks.engineeringResource.data.value.engineering.source.rootKind = "standalone-source";
    const { app, container } = mountPanel();
    try {
      findField(container, "Engineering profile").props["onUpdate:modelValue"]("durable.v1");
      await nextTick();
      projectSettingsMocks.projectSlug.value = "project-b";
      const data = createEngineeringResource({ profile: "high-assurance.v1", sessionId: "" }).data.value;
      data.engineering.source.rootKind = "standalone-source";
      projectSettingsMocks.engineeringResource.data.value = data;
      await nextTick();

      expect(findField(container, "Engineering profile").props.modelValue).toBe("high-assurance.v1");
      expect(findButton(container, "Save engineering approach").props.disabled).toBe(true);
    } finally {
      app.unmount();
    }
  });

  it("keeps an unavailable source error in the engineering section", () => {
    projectSettingsMocks.engineeringResource = createEngineeringResource({ available: false });
    const { app, container } = mountPanel();

    expect(findField(container, "Engineering profile")).toBeNull();
    expect(nodeText(container)).toContain(
      "Create or select an AI session to choose an engineering profile."
    );

    app.unmount();
  });

  it("persists the selected session in the URL and rehydrates from a warm back-navigation cache", async () => {
    projectSettingsMocks.route.query = {};
    let mounted = mountPanel();
    await nextTick();
    expect(projectSettingsMocks.router.replace).toHaveBeenCalledWith({
      query: {
        sessionId: "session-a"
      }
    });
    mounted.app.unmount();

    projectSettingsMocks.commandOptions.length = 0;
    projectSettingsMocks.commands = [
      createCommand(),
      createCommand(),
      createCommand(),
      createCommand()
    ];
    projectSettingsMocks.endpointOptions.length = 0;
    projectSettingsMocks.engineeringResource = createEngineeringResource({
      profile: "high-assurance.v1",
      sessionId: "session-b"
    });
    projectSettingsMocks.route.query = { sessionId: "session-b" };
    projectSettingsMocks.router.replace.mockReset();
    mounted = mountPanel();

    expect(findField(mounted.container, "Engineering profile").props.modelValue)
      .toBe("high-assurance.v1");
    expect(projectSettingsMocks.endpointOptions[1].readQuery.value)
      .toEqual({ sessionId: "session-b" });
    expect(projectSettingsMocks.router.replace).not.toHaveBeenCalled();

    mounted.app.unmount();
  });

  it("refreshes manually and on session changes while engineering retains its realtime subscription", async () => {
    const { app, container } = mountPanel();

    expect(projectSettingsMocks.endpointOptions[1].realtime).toEqual({
      event: "vibe64.project.changed",
      matches: expect.any(Function)
    });
    const sessionRealtime = projectSettingsMocks.realtimeOptions[0];
    expect(sessionRealtime.event).toBe("vibe64.session.changed");
    expect(sessionRealtime.matches).toBe(projectSettingsMocks.sessionEventMatches);

    await findButton(container, "Refresh").props.onClick();
    sessionRealtime.onEvent();
    await nextTick();
    expect(projectSettingsMocks.resource.reload).toHaveBeenCalledTimes(2);
    expect(projectSettingsMocks.engineeringResource.reload).toHaveBeenCalledTimes(2);

    projectSettingsMocks.resource.isLoading.value = true;
    await nextTick();
    const pendingRefresh = findButton(container, "Refreshing…");
    expect(pendingRefresh.props.disabled).toBe(true);

    app.unmount();
  });

  it("opens the personal profile section from the project-owned settings screen", async () => {
    const { app, container } = mountPanel();

    await findButton(container, "Set your Vibe64 name").props.onClick();
    expect(projectSettingsMocks.dialog).toHaveBeenCalledWith({
      refresh: false,
      section: "profile"
    });

    app.unmount();
  });
});
