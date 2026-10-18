import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { vibe64SessionToolRouteSegment } from "../../src/lib/vibe64SessionToolDefinitions.js";

// Learning is a guide on the real Vibe64 workspace: its panes are an extra,
// toggleable tab beside Preview | Dashboard, a practice lesson's Dashboard keeps
// its editable Database and ordinary Files editor, and Check my code stays reachable.

const fixture = vi.hoisted(() => ({ route: null, page: null, learning: null, panel: null }));
vi.mock("vue-router", () => ({ RouterView: { render: () => null }, useRoute: () => fixture.route }));
vi.mock("@/composables/useVibe64AppPage.js", () => ({ useVibe64AppPage: () => fixture.page }));
vi.mock("@/composables/useVibe64LearningMode.js", () => ({ useVibe64LearningMode: () => fixture.learning }));
vi.mock("@/components/StudioAppShellLayout.vue", () => ({ default: passthrough("section") }));
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
  props: ["learningView", "projectPane"],
  setup(props, { expose }) {
    expose({ get learningWorkspaceAvailable() { return fixture.panel.workspace.value; } });
    return () => Vue.h("article", { "data-learning-view": props.learningView, "data-project-pane": props.projectPane });
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

function mountLearningPage({ workspace = true, learningView = "workspace" } = {}) {
  const route = Vue.reactive({ path: "/app/project/practice", params: { slug: "practice" },
    query: { mode: "learning", learningView } });
  fixture.route = route;
  const projectPane = Vue.ref("preview");
  fixture.page = {
    chatCollapsed: Vue.ref(false), chatToggleIcon: "", chatToggleTitle: "", dashboardRouteActive: Vue.ref(false),
    emitPageTitle: vi.fn(), handleProjectSelectionError: vi.fn(), handleProjectSelectionMissing: vi.fn(),
    handleProjectSelectionReady: vi.fn(), mdiChevronDown: "", mdiChevronRight: "", mobilePaneSwipeEnabled: Vue.ref(false),
    mobileProjectAction: Vue.ref({ ariaLabel: "", label: "", pane: "preview" }), mobileProjectActionVisible: Vue.ref(false),
    openProject: vi.fn(), pageError: Vue.ref(""), previewToolbarHostId: "preview-toolbar",
    previewToolbarHostVisible: Vue.ref(false), previewToolbarTeleportTarget: Vue.ref(""), projectLoadError: Vue.ref(""),
    projectPane, projectPaneNavigationVisible: Vue.ref(true), projectRuntimeError: Vue.ref(""),
    projectRuntimeReady: Vue.ref(true), projectSlug: Vue.ref("practice"),
    projectTabs: [{ id: "preview", label: "Preview" }, { id: "dashboard", label: "Dashboard" }],
    retryProjectRuntime: vi.fn(), selectProjectPane: vi.fn((pane) => { projectPane.value = pane; }),
    setChatCollapsed: vi.fn(), showProjectPane: vi.fn(), switcherProjects: Vue.ref([]), targetFolderName: Vue.ref("practice")
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
    createElement: type => ({ type, children: [], props: {}, parent: null }),
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
  const toggle = () => findAll(root, node => /Learning panes$/u.test(node.props["aria-label"] || ""))[0];
  const panel = () => findAll(root, node => node.type === "article")[0];
  return { route, root, tabs, toggle, panel, views, projectPane, page: fixture.page };
}

describe("Learning panes beside Preview | Dashboard", () => {
  it("keeps the real Preview and Dashboard tabs and adds a Learning tab beside them", async () => {
    const view = mountLearningPage();
    await Vue.nextTick();
    expect(view.tabs().map(tab => tab.label)).toEqual(["Preview", "Dashboard", "Learning"]);
    expect(view.tabs().map(tab => tab.selected)).toEqual([true, false, false]);
    expect(view.tabs().some(tab => tab.label === "Workspace")).toBe(false);
    expect(view.toggle().props["aria-label"]).toBe("Hide Learning panes");
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

  it("hides and shows the extra Learning tab without removing Preview or Dashboard", async () => {
    const view = mountLearningPage({ learningView: "learning" });
    await Vue.nextTick();
    view.toggle().props.onClick(); await Vue.nextTick(); await Vue.nextTick();
    expect(view.tabs().map(tab => tab.label)).toEqual(["Preview", "Dashboard"]);
    expect(view.route.query.learningView).toBe("workspace");
    expect(view.toggle().props["aria-label"]).toBe("Show Learning panes");
    expect(view.toggle().props["aria-pressed"]).toBe("false");

    view.toggle().props.onClick(); await Vue.nextTick(); await Vue.nextTick();
    expect(view.tabs().map(tab => tab.label)).toEqual(["Preview", "Dashboard", "Learning"]);
    expect(view.route.query.learningView).toBe("learning");

    view.toggle().props.onClick(); await Vue.nextTick(); await Vue.nextTick();
    expect(view.tabs().map(tab => tab.label)).toEqual(["Preview", "Dashboard"]);
    // A teacher or Colleague navigation to the Learning view shows its tab again.
    view.route.query = { ...view.route.query, learningView: "learning" }; await Vue.nextTick(); await Vue.nextTick();
    expect(view.tabs().map(tab => tab.label)).toEqual(["Preview", "Dashboard", "Learning"]);
  });

  it("keeps a source-less lesson on Learning with Preview, Dashboard and the toggle disabled", async () => {
    const view = mountLearningPage({ workspace: false });
    await Vue.nextTick();
    expect(view.tabs().map(({ label, selected, disabled }) => ({ label, selected, disabled }))).toEqual([
      { label: "Preview", selected: false, disabled: true },
      { label: "Dashboard", selected: false, disabled: true },
      { label: "Learning", selected: true, disabled: false }
    ]);
    expect(view.toggle().props.disabled).toBe(true);
    await view.tabs()[0].node.props.onClick({ type: "click", isTrusted: true });
    view.toggle().props.onClick(); await Vue.nextTick();
    expect(view.page.selectProjectPane).not.toHaveBeenCalled();
    expect(view.tabs().map(tab => tab.label)).toContain("Learning");
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
