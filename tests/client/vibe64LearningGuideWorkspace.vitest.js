import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { vibe64SessionToolRouteSegment } from "../../src/lib/vibe64SessionToolDefinitions.js";

// Learning is a guide on the real Vibe64 workspace: one header serves both modes and
// Learning only adds a graduation-cap option to the same Preview | Dashboard group, a practice lesson's Dashboard keeps
// its editable Database and ordinary Files editor, and Check my code stays reachable.

const fixture = vi.hoisted(() => ({ route: null, page: null, learning: null, panel: null }));
vi.mock("vue-router", () => ({ RouterView: { render: () => null }, useRoute: () => fixture.route }));
vi.mock("@/composables/useVibe64AppPage.js", () => ({ useVibe64AppPage: () => fixture.page }));
vi.mock("@/composables/useVibe64LearningMode.js", () => ({ useVibe64LearningMode: () => fixture.learning }));
vi.mock("@/components/StudioAppShellLayout.vue", () => ({ default: Vue.defineComponent({
  props: ["chatCollapsed", "mobilePaneSwipeEnabled", "learningMode"],
  setup(props, { attrs, slots }) {
    return () => Vue.h("section", { ...attrs, "data-shell": true, "chat-collapsed": props.chatCollapsed,
      "mobile-pane-swipe-enabled": props.mobilePaneSwipeEnabled }, Object.values(slots).flatMap(slot => slot({ props: {} })));
  }
}) }));
vi.mock("@/components/studio/Vibe64AuthSettingsButton.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/studio/repository/Vibe64LocalRemoteControls.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/studio/Vibe64LearningPracticeProjectSelector.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/studio/Vibe64LearningLessonLauncher.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/studio/ProjectSelectionGate.vue", () => ({ default: Vue.defineComponent({
  setup(_props, { slots }) {
    return () => slots.default?.({ contentActive: true, projectSelection: { currentProject: { slug: "practice" } } });
  }
}) }));
vi.mock("@/components/studio/Vibe64SessionPanel.vue", () => ({ default: Vue.defineComponent({
  props: ["learningView", "projectPane", "chatCollapsed", "previewToolbarTeleportTarget"],
  setup(props, { expose }) {
    expose({ get learningWorkspaceAvailable() { return fixture.panel.workspace.value; } });
    return () => Vue.h("article", { "data-learning-view": props.learningView, "data-project-pane": props.projectPane,
      "data-chat-collapsed": props.chatCollapsed, "data-preview-toolbar": props.previewToolbarTeleportTarget });
  }
}) }));

import ProjectPage from "../../src/pages/app/project/[slug].vue";

const pageFile = path.resolve("src/pages/app/project/[slug].vue");
{
  const { descriptor } = parse(fs.readFileSync(pageFile, "utf8"), { filename: pageFile });
  const script = compileScript(descriptor, { id: "learning-guide-page" });
  ProjectPage.render = new Function("Vue", compile(descriptor.template.content, {
    bindingMetadata: script.bindings, mode: "function", prefixIdentifiers: true
  }).code)(Vue);
}

function passthrough(element) {
  return Vue.defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => Vue.h(element, attrs, Object.values(slots).flatMap(slot => slot({ props: {} })));
    }
  });
}

function textOf(node) {
  return node.type === "text" ? node.text : (node.children || []).map(textOf).join("") + (node.text || "");
}
function findAll(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of node.children || []) findAll(child, predicate, found);
  return found;
}

const mounted = [];
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); });

function mountLearningPage({ workspace = true, learningView = "workspace", mode = "learning", previewToolbar = false,
  mobile = false } = {}) {
  const route = Vue.reactive({ path: "/app/project/practice", params: { slug: "practice" },
    query: mode === "learning" ? { mode, learningView } : {} });
  const chatCollapsed = Vue.ref(false);
  fixture.route = route;
  const projectPane = Vue.ref("preview");
  fixture.page = {
    chatCollapsed, chatToggleIcon: "", chatToggleTitle: "Collapse chat", dashboardRouteActive: Vue.ref(false),
    emitPageTitle: vi.fn(), handleProjectSelectionError: vi.fn(), handleProjectSelectionMissing: vi.fn(),
    handleProjectSelectionReady: vi.fn(), mdiChevronDown: "", mdiChevronRight: "", mobilePaneSwipeEnabled: Vue.ref(true),
    mobileProjectAction: Vue.ref({ ariaLabel: "", label: "", pane: "preview" }), mobileProjectActionVisible: Vue.ref(mobile),
    openProject: vi.fn(), pageError: Vue.ref(""), previewToolbarHostId: "preview-toolbar",
    previewToolbarHostVisible: Vue.computed(() => previewToolbar && projectPane.value === "preview"),
    previewToolbarTeleportTarget: Vue.computed(() => previewToolbar && projectPane.value === "preview" ? "#preview-toolbar" : ""), projectLoadError: Vue.ref(""),
    projectPane, projectPaneNavigationVisible: Vue.ref(true), projectRuntimeError: Vue.ref(""),
    projectRuntimeReady: Vue.ref(true), projectSlug: Vue.ref("practice"),
    projectTabs: [{ id: "preview", label: "Preview" }, { id: "dashboard", label: "Dashboard" }],
    retryProjectRuntime: vi.fn(), selectProjectPane: vi.fn((pane) => { projectPane.value = pane; }),
    setChatCollapsed: vi.fn((value) => { chatCollapsed.value = Boolean(value); }), showProjectPane: vi.fn(), switcherProjects: Vue.ref([]), targetFolderName: Vue.ref("practice")
  };
  const views = [];
  fixture.learning = {
    learningMode: Vue.computed(() => route.query.mode === "learning"),
    learningView: Vue.computed(() => route.query.learningView === "learning" ? "learning" : "workspace"),
    purposeFilter: Vue.computed(() => "learning"), learningResource: null, learnerId: Vue.ref("learner"),
    setLearningMode: vi.fn(),
    setLearningView: vi.fn(async (value) => { views.push(value); route.query = { ...route.query, learningView: value }; })
  };
  fixture.panel = { workspace: Vue.ref(workspace) };
  const renderer = Vue.createRenderer({
    createElement: type => ({ type, children: [], props: {}, style: {}, parent: null }),
    createComment: text => ({ type: "comment", text, children: [], props: {} }),
    createText: text => ({ type: "text", text, children: [], props: {} }),
    insert(child, parent, anchor = null) {
      const previous = child.parent?.children?.indexOf(child) ?? -1;
      if (previous >= 0) child.parent.children.splice(previous, 1);
      child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child);
    },
    remove(child) { const index = child.parent?.children?.indexOf(child) ?? -1; if (index >= 0) child.parent.children.splice(index, 1); },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    patchProp: (node, key, _previous, value) => { node.props[key] = value; },
    setElementText: (node, text) => { node.text = text; node.children = []; },
    setText: (node, text) => { node.text = text; }
  });
  const app = renderer.createApp(ProjectPage);
  for (const [name, element] of [["VAlert", "aside"], ["VBtn", "button"], ["VIcon", "span"], ["VList", "ul"],
    ["VListItem", "li"], ["VMenu", "div"]]) app.component(name, passthrough(element));
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  const root = { type: "root", children: [], props: {} };
  app.mount(root);
  mounted.push(app);
  const tabs = () => findAll(root, node => node.props.role === "tab").map(node => ({ node, label: textOf(node).trim(),
    selected: node.props["aria-selected"] === "true", disabled: Boolean(node.props.disabled) }));
  const panel = () => findAll(root, node => node.type === "article")[0];
  const shell = () => findAll(root, node => node.props["data-shell"])[0];
  return { route, root, tabs, panel, shell, views, projectPane, page: fixture.page };
}

describe("one Preview | Dashboard header for Working and Learning", () => {
  const tablist = view => findAll(view.root, node => node.props.role === "tablist");
  const collapse = view => findAll(view.root, node => String(node.props.class || "").includes("studio-home-shell-chat-toggle"));

  it("renders the same tab group, positions and classes; Learning only adds the graduation-cap option", async () => {
    const working = mountLearningPage({ mode: "working" });
    const learning = mountLearningPage();
    await Vue.nextTick();
    expect(tablist(working)).toHaveLength(1);
    expect(tablist(learning)).toHaveLength(1);
    expect(tablist(learning)[0].props.class).toEqual(tablist(working)[0].props.class);
    expect(tablist(learning)[0].props["aria-label"]).toBe(tablist(working)[0].props["aria-label"]);
    expect(working.tabs().map(tab => tab.label)).toEqual(["Preview", "Dashboard"]);
    expect(learning.tabs().map(tab => tab.node.props["aria-label"] || tab.label)).toEqual(["Preview", "Dashboard", "Learning"]);
    expect(learning.tabs().map(tab => tab.node.props.class)).toEqual(working.tabs().map(tab => tab.node.props.class).concat([
      learning.tabs()[2].node.props.class]));
    expect(learning.tabs().map(tab => tab.node.props["data-vibe64-guide"])).toEqual(["tab-preview", "tab-dashboard", "tab-learning"]);
    expect(working.tabs().map(tab => tab.node.props["data-vibe64-guide"])).toEqual(["tab-preview", "tab-dashboard"]);
    expect(learning.tabs()[2].node.props.title).toBe("Learning: courses and lesson");
    expect(learning.tabs()[2].label).toBe("");
    expect(findAll(learning.root, node => /Learning panes$/u.test(node.props["aria-label"] || ""))).toHaveLength(0);
    // Controls keep their order: collapse arrow, tabs, Preview toolbar.
    const order = view => findAll(view.root, node => node.props.class === "studio-home-shell-project-controls")[0].children
      .filter(node => node.type !== "comment").map(node => String(node.props.class || node.props.id));
    expect(order(learning)).toEqual(order(working));
  });

  it("selects one of three options: the cap shows Learning panes, Preview or Dashboard deselects it", async () => {
    const view = mountLearningPage();
    await Vue.nextTick();
    expect(view.tabs().map(tab => tab.selected)).toEqual([true, false, false]);
    expect(view.panel().props["data-learning-view"]).toBe("workspace");

    const event = { type: "click", isTrusted: true };
    view.tabs()[2].node.props.onClick(event); await Vue.nextTick();
    expect(view.route.query.learningView).toBe("learning");
    expect(view.tabs().map(tab => tab.selected)).toEqual([false, false, true]);
    expect(view.panel().props["data-learning-view"]).toBe("learning");

    await view.tabs()[1].node.props.onClick(event); await Vue.nextTick();
    expect(view.views.at(-1)).toBe("workspace");
    expect(view.page.selectProjectPane).toHaveBeenLastCalledWith("dashboard", event);
    expect(view.tabs().map(tab => tab.selected)).toEqual([false, true, false]);
    expect(view.panel().props["data-project-pane"]).toBe("dashboard");
  });

  it("keeps the same collapse-chat arrow and chat state in Learning", async () => {
    const working = mountLearningPage({ mode: "working" });
    const view = mountLearningPage();
    await Vue.nextTick();
    expect(collapse(view)).toHaveLength(1);
    expect(collapse(view)[0].props.class).toBe(collapse(working)[0].props.class);
    const event = { type: "click", isTrusted: true };
    collapse(view)[0].props.onClick(event); await Vue.nextTick();
    expect(view.page.setChatCollapsed).toHaveBeenLastCalledWith(true, event);
    expect(view.panel().props["data-chat-collapsed"]).toBe(true);
    expect(view.shell().props["chat-collapsed"]).toBe(true);
    expect(view.shell().props["mobile-pane-swipe-enabled"]).toBe(true);
  });

  it("shows the same Preview toolbar host in Learning while Preview is shown", async () => {
    const view = mountLearningPage({ previewToolbar: true });
    await Vue.nextTick();
    const host = () => findAll(view.root, node => node.props.id === "preview-toolbar")[0];
    expect(host()).toBeTruthy();
    expect(view.panel().props["data-preview-toolbar"]).toBe("#preview-toolbar");
    view.tabs()[2].node.props.onClick({ type: "click", isTrusted: true }); await Vue.nextTick();
    expect(view.panel().props["data-preview-toolbar"]).toBe("");
  });

  it("cycles the same phone next-pane button through Preview, Dashboard and the cap", async () => {
    const view = mountLearningPage({ mobile: true });
    await Vue.nextTick();
    const action = () => findAll(view.root, node => node.props.class === "studio-home-shell-project-mobile-action")[0];
    expect(action().props["aria-label"]).toBe("Go to dashboard");
    await action().props.onClick({ type: "click", isTrusted: true }); await Vue.nextTick();
    expect(view.page.selectProjectPane).toHaveBeenLastCalledWith("dashboard", expect.anything());
    expect(action().props["aria-label"]).toBe("Go to learning");
    await action().props.onClick({ type: "click", isTrusted: true }); await Vue.nextTick();
    expect(view.route.query.learningView).toBe("learning");
    expect(action().props["aria-label"]).toBe("Go to preview");
  });

  it("keeps a source-less lesson on the cap with Preview and Dashboard disabled", async () => {
    const view = mountLearningPage({ workspace: false });
    await Vue.nextTick();
    expect(view.tabs().map(({ node, selected, disabled }) => ({ label: node.props["aria-label"] || textOf(node).trim(), selected, disabled }))).toEqual([
      { label: "Preview", selected: false, disabled: true },
      { label: "Dashboard", selected: false, disabled: true },
      { label: "Learning", selected: true, disabled: false }
    ]);
    await view.tabs()[0].node.props.onClick({ type: "click", isTrusted: true });
    expect(view.page.selectProjectPane).not.toHaveBeenCalled();
  });
});

const autopilotFile = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
const autopilotSource = fs.readFileSync(autopilotFile, "utf8");

function templateNodes(file) {
  const { descriptor } = parse(fs.readFileSync(file, "utf8"), { filename: file });
  return descriptor.template.ast;
}
function findTemplate(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of node.children || []) findTemplate(child, predicate, found);
  return found;
}
const attribute = (node, name) => (node.props || []).find(prop => prop.name === name ||
  prop.name === "bind" && prop.arg?.content === name || prop.name === "slot" && prop.arg?.content === name);

describe("a practice lesson's Dashboard and Check my code", () => {
  it("offers Database and the ordinary Files editor; Check my code lives in the Learning pane", () => {
    const ast = templateNodes(autopilotFile);
    const lessonTabs = findTemplate(ast, node => node.tag === "v-btn-toggle" &&
      attribute(node, "aria-label")?.value?.content === "Lesson dashboard tools")[0];
    expect(lessonTabs.children.filter(child => child.tag === "v-btn").map(child => [
      attribute(child, "value").value.content, child.children[0].content.trim()])).toEqual([["database", "Database"], ["files", "Files"]]);
    const lessonEditor = findTemplate(ast, node => node.tag === "Vibe64SessionSourceEditor" && attribute(node, "lesson-scoped"))[0];
    expect(attribute(lessonEditor, "file-bookmarks").exp.content).toBe("fileBookmarks");
    expect(attribute(lessonEditor, "sessions-api-path").exp.content).toBe("learningSessionsApiPath");
    const label = node => typeof node.children?.[0]?.content === "string" ? node.children[0].content.trim() : "";
    const checks = findTemplate(ast, node => node.tag === "v-btn" && label(node) === "Check my code");
    expect(checks).toHaveLength(1);
    const lessons = findTemplate(ast, node => node.tag === "template" && attribute(node, "lessons"))[0];
    expect(findTemplate(lessons, node => checks.includes(node))).toHaveLength(1);
    expect(attribute(checks[0].parent || findTemplate(lessons, node => node.children?.includes(checks[0]))[0], "if")
      ?.exp?.content).toBe("learningDatabaseAvailable");
  });

  it("reports the selected lesson Dashboard tab and checks the learner's code from the Learning pane", async () => {
    const start = autopilotSource.indexOf("const assistantHost = inject(");
    const end = autopilotSource.indexOf("const assistantLayerSelected = computed(", start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const keyNames = ["VIBE64_ASSISTANT_HOST_KEY", "VIBE64_COLLEAGUE_VIEW_KEY", "VIBE64_COLLEAGUE_LAYOUT_KEY",
      "VIBE64_COLLEAGUE_PREVIEW_KEY", "VIBE64_TRAINING_LEARNER_GESTURE_KEY"];
    const keys = Object.fromEntries(keyNames.map(name => [name, Symbol(name)]));
    const binding = Object.freeze({ actorKey: "scoped", viewerActorKey: "member", learnerId: "own",
      learningAttemptId: "12345678-1234-4234-8234-123456789abc", sessionId: "saved-initial",
      sourceProjectSlug: "practice", noExercise: false });
    const props = Vue.shallowReactive({ active: true, sessionSelectionArchived: false, lessonsAvailable: true,
      learningView: "workspace", projectPane: "dashboard", sourceWorkspaceAvailable: false, outputWorkspaceAvailable: true,
      learningAttemptId: binding.learningAttemptId,
      conversationRuntime: { identity: binding, conversationReady: Vue.ref(true), available: Vue.ref(true) } });
    const rightPaneTab = Vue.ref("env");
    const submitted = [];
    const owner = { matchesLearning: value => value === binding,
      async submitCode(event) { submitted.push(event); return { checkOutcome: "passed" }; } };
    const view = Vue.shallowRef(null);
    let selected;
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
    const app = renderer.createApp({ setup() {
      const args = ["inject", "ref", "computed", "watch", "watchEffect", "onBeforeUnmount", "useDisplay", "props",
        "chatCollapsed", "rightPaneTab", "vibe64SessionToolRouteSegment", ...keyNames];
      selected = new Function(...args, `${autopilotSource.slice(start, end)}
return { learningView, learningDashboardTab, learningCodeResult, checkLearningCode, learningDatabaseAvailable };`)(
        Vue.inject, Vue.ref, Vue.computed, Vue.watch, Vue.watchEffect, Vue.onBeforeUnmount, () => ({ width: Vue.ref(1200) }),
        props, Vue.ref(false), rightPaneTab, vibe64SessionToolRouteSegment, ...keyNames.map(name => keys[name]));
      return () => null;
    } });
    app.provide(keys.VIBE64_ASSISTANT_HOST_KEY, Vue.shallowRef(null)); app.provide(keys.VIBE64_COLLEAGUE_VIEW_KEY, view);
    app.provide(keys.VIBE64_COLLEAGUE_LAYOUT_KEY, Vue.shallowRef(null));
    app.provide(keys.VIBE64_COLLEAGUE_PREVIEW_KEY, Vue.shallowRef(null));
    app.provide(keys.VIBE64_TRAINING_LEARNER_GESTURE_KEY, Vue.shallowRef(owner));
    app.mount({});
    try {
      expect(selected.learningDatabaseAvailable.value).toBe(true);
      expect(view.value.pane).toBe("database");
      selected.learningDashboardTab.value = "files";
      expect(view.value.pane).toBe("files");
      rightPaneTab.value = "database"; await Vue.nextTick();
      expect(selected.learningDashboardTab.value).toBe("database");
      rightPaneTab.value = "editor"; await Vue.nextTick();
      expect(selected.learningDashboardTab.value).toBe("files");

      props.learningView = "learning";
      const press = { type: "click", isTrusted: true };
      await selected.checkLearningCode(press);
      expect(submitted).toEqual([press]);
      expect(selected.learningCodeResult.value.message).toMatch(/^Your code passed the check/u);
    } finally { app.unmount(); }
  });

  it("removes the lesson-only Files restrictions except the missing Interface reader", () => {
    const editorFile = path.resolve("src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue");
    const { descriptor } = parse(fs.readFileSync(editorFile, "utf8"), { filename: editorFile });
    const restricted = descriptor.template.content.split("\n").filter(line => line.includes("lessonScoped"));
    expect(restricted).toHaveLength(1);
    expect(restricted[0]).toContain("'Interface'");
    const treeFile = path.resolve("src/components/studio/vibe64-session/Vibe64SourceFileTree.vue");
    expect(fs.readFileSync(treeFile, "utf8")).not.toContain("lessonScoped");
  });
});
