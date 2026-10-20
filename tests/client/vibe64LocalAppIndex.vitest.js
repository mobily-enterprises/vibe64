import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Actual Learning Courses and shell-context setup/templates; only the courses
// adapter and presentation widgets are bounded fixtures.
import * as Vue from "vue";
import * as HostKeys from "../../src/lib/vibe64AssistantHost.js";
import * as LearningEnvironment from "../../src/lib/vibe64Learning.js";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";

function compiledUi(filename, imports) {
  const descriptor = parse(readFileSync(filename, "utf8"), { filename }).descriptor;
  const script = compileScript(descriptor, { id: "learning-ui" });
  const compiled = compileTemplate({ source: descriptor.template.content, filename, id: "learning-ui",
    compilerOptions: { bindingMetadata: script.bindings } });
  expect(compiled.errors).toEqual([]);
  const module = { exports: {} };
  new Function("require", "module", "exports", transformSync(script.content, { format: "cjs" }).code)(name => {
    expect(imports[name], name).toBeTruthy();
    return imports[name].default ? { __esModule: true, ...imports[name] } : imports[name];
  }, module, module.exports);
  const template = { exports: {} };
  new Function("require", "module", "exports", transformSync(compiled.code, { format: "cjs" }).code)(() => Vue, template, template.exports);
  module.exports.default.render = template.exports.render;
  return module.exports.default;
}

function uiRenderer() {
  return Vue.createRenderer({
    createElement: tag => ({ tag, props: {}, style: {}, children: [] }),
    createText: text => ({ text, children: [] }), createComment: text => ({ comment: text, children: [] }),
    insert(node, parent, anchor) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = parent; const at = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(at < 0 ? parent.children.length : at, 0, node); },
    remove(node) { node.parent?.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1],
    patchProp(node, key, _old, value) { node.props[key] = value; },
    setElementText(node, text) { node.text = text; node.children = []; }, setText(node, text) { node.text = text; }
  });
}
const uiWidget = { setup: (_props, { attrs, slots }) => () => Vue.h("div", attrs, slots.default?.()) };
function nodes(root) { return [root, ...root.children.flatMap(nodes)]; }

async function mountCourses({ authorTrial = null } = {}) {
  const route = Vue.reactive({ fullPath: "/app" });
  const calls = { pickerProps: null, opened: [] };
  const owner = { active: Vue.ref(true), learnerId: Vue.ref("learner"), busy: Vue.ref(false), startRetry: Vue.ref(null),
    learningResource: { data: Vue.ref({ ok: true, available: true, learnerId: "learner", sessions: [] }), isLoading: Vue.ref(false), loadError: Vue.ref("") },
    coursesResource: { data: Vue.ref({ ok: true, available: true, courses: [] }), isLoading: Vue.ref(false), loadError: Vue.ref("") } };
  owner.refresh = async () => null;
  owner.startLesson = async input => { calls.start = input; return { attemptId: "attempt", current: true }; };
  owner.resumeLesson = async attempt => { calls.resume = attempt; return { attemptId: attempt, current: true }; };
  owner.retryStart = async () => { calls.retry = true; };
  if (authorTrial) {
    owner.authorPreviewEnabled = Vue.ref(true);
    owner.authorPreviewResource = { data: Vue.ref({ ok: true, available: true, authorPreview: true }), isLoading: Vue.ref(false), loadError: Vue.ref("") };
    owner.savedAuthorPreview = Vue.ref(authorTrial);
    owner.resumeAuthorPreview = async attemptId => { calls.authorPreview = attemptId; return { attemptId, current: true }; };
  }
  const picker = { props: ["canStart", "canResume", "learningResult"], emits: ["start", "resume", "refresh"], setup(props, { emit }) {
    calls.pickerProps = props;
    return () => Vue.h("button", { "data-test": "start-lesson", onClick: () => emit("start", { courseId: "course", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 3 }) });
  } };
  const component = compiledUi(path.resolve("src/components/learning/Vibe64LearningCourses.vue"), {
    vue: Vue, "vue-router": { useRoute: () => route }, "@local/vibe64-training/client/lesson-picker": { default: picker }
  });
  const root = { children: [] };
  const app = uiRenderer().createApp({ render: () => Vue.h(component, { learning: owner, onOpened: outcome => calls.opened.push(outcome) }) });
  for (const tag of ["v-btn", "v-alert", "v-skeleton-loader"]) app.component(tag, uiWidget);
  app.mount(root); await Vue.nextTick();
  return { app, root, owner, calls, route };
}

it("starts a lesson through the supplied courses owner and opens its actual returned attempt in the reader", async () => {
  const view = await mountCourses();
  try {
    expect(view.calls.pickerProps.canStart).toBe(true);
    nodes(view.root).find(node => node.props?.["data-test"] === "start-lesson").props.onClick();
    await Vue.nextTick(); await Vue.nextTick();
    expect(view.calls.start).toEqual({ courseId: "course", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 3 });
    expect(view.calls.opened).toEqual([{ attemptId: "attempt", current: true }]);
    view.owner.startLesson = async () => ({ attemptId: "stale", current: false });
    nodes(view.root).find(node => node.props?.["data-test"] === "start-lesson").props.onClick();
    await Vue.nextTick(); await Vue.nextTick();
    expect(view.calls.opened, "a start that is no longer current opens no reader").toHaveLength(1);
    view.owner.active.value = false; await Vue.nextTick();
    expect(view.calls.pickerProps.canStart).toBe(false);
  } finally { view.app.unmount(); }
});

it("retires local lesson errors when Learning closes, the route or the learner changes, including late failures", async () => {
  const view = await mountCourses();
  const messages = () => nodes(view.root).map(node => node.text || "").join(" ");
  const start = () => nodes(view.root).find(node => node.props?.["data-test"] === "start-lesson").props.onClick();
  try {
    let reject;
    view.owner.startLesson = () => new Promise((_resolve, fail) => { reject = fail; });
    start();
    view.owner.active.value = false; await Vue.nextTick();
    view.owner.active.value = true; await Vue.nextTick();
    reject(new Error("retired operation")); await Vue.nextTick(); await Vue.nextTick();
    expect(messages()).not.toContain("retired operation");
    view.owner.startLesson = async () => { throw new Error("current operation"); };
    start(); await Vue.nextTick(); await Vue.nextTick();
    expect(messages()).toContain("current operation");
    view.route.fullPath = "/app/project/other"; await Vue.nextTick();
    expect(messages()).not.toContain("current operation");
    start(); await Vue.nextTick(); await Vue.nextTick();
    expect(messages()).toContain("current operation");
    view.owner.learnerId.value = "another-learner"; await Vue.nextTick();
    expect(messages()).not.toContain("current operation");
    expect(view.calls.opened).toEqual([]);
  } finally { view.app.unmount(); }
});

it("adds one saved author-trial control beside the courses without released-course start", async () => {
  const view = await mountCourses({ authorTrial: { attemptId: "saved-preview",
    pin: { topic: { release: "0.1.8", commit: "f".repeat(40) }, lesson: { code: "DRAFT-ONE" } } } });
  try {
    const button = nodes(view.root).find(node => node.props?.["data-test"] === "resume-author-trial");
    expect(button).toBeTruthy(); expect(button.props.disabled).toBeFalsy();
    button.props.onClick(); await Vue.nextTick(); await Vue.nextTick();
    expect(view.calls.authorPreview).toBe("saved-preview"); expect(view.calls.start).toBeUndefined();
    expect(view.calls.opened).toEqual([{ attemptId: "saved-preview", current: true }]);
    expect(view.calls.pickerProps.learningResult).toBe(view.owner.learningResource.data.value);
  } finally { view.app.unmount(); }
});

const appSource = () => readFileSync(path.resolve("src/App.vue"), "utf8");
it("shared original shell refs are per mount and only local composition supplies the established local display identity", () => {
  const context = compiledUi(path.resolve("src/components/Vibe64AssistantShellContext.vue"), { vue: Vue, "@/lib/vibe64AssistantHost.js": HostKeys,
    "@/lib/vibe64Learning.js": LearningEnvironment });
  const mount = local => {
    let captured;
    const probe = { setup() { captured = Object.fromEntries(Object.entries(HostKeys).map(([name, key]) => [name, Vue.inject(key, null)])); return () => Vue.h("aside"); } };
    const root = { children: [] }, app = uiRenderer().createApp({ setup: () => () => Vue.h(context, { local }, { default: () => Vue.h(probe) }) });
    app.mount(root); return { app, captured };
  };
  const local = mount(true), hosted = mount(false);
  try {
    expect(local.captured.VIBE64_ASSISTANT_VIEWER_KEY).toEqual({ actorKey: "local" });
    expect(hosted.captured.VIBE64_ASSISTANT_VIEWER_KEY).toBeNull();
    for (const key of ["VIBE64_COLLEAGUE_VIEW_KEY", "VIBE64_COLLEAGUE_LAYOUT_KEY", "VIBE64_COLLEAGUE_PREVIEW_KEY", "VIBE64_BROWSER_NAVIGATION_KEY"]) {
      expect(Vue.isRef(local.captured[key])).toBe(true); expect(local.captured[key].value).toBeNull();
      expect(local.captured[key]).not.toBe(hosted.captured[key]);
    }
    // One Learning environment controller per shell, closed until the overlay binds a viewer.
    expect(local.captured.VIBE64_LEARNING_KEY.state.open).toBe(false);
    expect(local.captured.VIBE64_LEARNING_KEY.state.actorKey).toBe("");
    expect(local.captured.VIBE64_LEARNING_KEY).not.toBe(hosted.captured.VIBE64_LEARNING_KEY);
    expect(appSource()).toContain("<Vibe64LearningOverlay />");
    expect(appSource()).toContain("<Vibe64AssistantShellContext local>");
    expect(appSource()).toContain("<Vibe64LocalColleagueHost />");
    const localSource = readFileSync(path.resolve("src/components/Vibe64LocalColleagueHost.vue"), "utf8");
    expect(localSource).toContain('import { Vibe64Colleague } from "@local/vibe64-colleague/client"');
    expect(localSource).toContain("if (browserNavigation) browserNavigation.value = navigate;");
    // A template auto-unwraps the injected ref, so Colleague receives the local navigator itself.
    expect(localSource).toContain(':navigate="navigate"');
    expect(localSource).not.toContain("createConversationRuntime");
  } finally { local.app.unmount(); hosted.app.unmount(); }
});

// Local /app resolves to a place and never shows a Projects page (absent locally).
describe("local /app resolver", () => {
  async function resolveApp({ mode = { on: false }, currentProject = { slug: "my-app" }, actorKey = "local" } = {}) {
    const replace = vi.fn(async () => {});
    const request = vi.fn(async () => ({ ok: true, currentProject }));
    const learning = Vue.reactive({ state: { actorKey }, readLearningMode: vi.fn(async () => LearningEnvironment.normalizeLearningMode(
      { ok: true, available: true, learningMode: mode })) });
    const stub = name => ({ props: ["title", "error"], setup: (props, { slots }) => () => Vue.h("div", { "data-stub": name, ...props },
      [slots.default?.(), slots["top-right"]?.(), slots.actions?.()]) });
    const page = compiledUi(path.resolve("src/pages/app/index.vue"), {
      vue: Vue, "vue-router": { useRouter: () => ({ replace }) },
      "@jskit-ai/http-web/client/lib/httpClient": { getHttpWebClient: () => ({ request }) },
      "@/components/StudioAppShellLayout.vue": { default: stub("shell") },
      "@/components/studio/StudioErrorNotice.vue": { default: stub("error") },
      "@/components/studio/Vibe64AuthSettingsButton.vue": { default: stub("account-settings") },
      "@/lib/studioGateApi.js": { PROJECT_SELECTION_ENDPOINT: "/api/vibe64/projects" },
      "@/lib/vibe64Learning.js": LearningEnvironment,
      "@/lib/vibe64ProjectScope.js": { projectAppPath: slug => `/app/project/${slug}` },
      "@/composables/useVibe64Learning.js": { useVibe64Learning: () => learning }
    });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(page) });
    for (const tag of ["v-btn", "v-skeleton-loader"]) app.component(tag, uiWidget);
    app.mount(root);
    for (let index = 0; index < 4; index += 1) { await Promise.resolve(); await Vue.nextTick(); }
    return { app, root, replace, request, learning };
  }

  it("opens the lesson's practice project during a lesson, without reading the started project", async () => {
    const view = await resolveApp({ mode: { on: true, attemptId: "a", practiceSlug: "training-abc", projectSlugs: ["training-abc"] } });
    try {
      expect(view.replace).toHaveBeenCalledWith("/app/project/training-abc");
      expect(view.request).not.toHaveBeenCalled();
    } finally { view.app.unmount(); }
  });

  it("opens the Learning page for a lesson without a practice project", async () => {
    const view = await resolveApp({ mode: { on: true, attemptId: "a", practiceSlug: "", projectSlugs: [] } });
    try { expect(view.replace).toHaveBeenCalledWith("/app/learning"); } finally { view.app.unmount(); }
  });

  it("opens the started project outside a lesson, once the overlay binds the viewer", async () => {
    const view = await resolveApp({ actorKey: "" });
    try {
      expect(view.learning.readLearningMode, "the mode read waits for the signed-in viewer").not.toHaveBeenCalled();
      view.learning.state.actorKey = "local";
      for (let index = 0; index < 4; index += 1) { await Promise.resolve(); await Vue.nextTick(); }
      expect(view.request).toHaveBeenCalledWith("/api/vibe64/projects", { method: "GET" });
      expect(view.replace).toHaveBeenCalledWith("/app/project/my-app");
    } finally { view.app.unmount(); }
  });

  it("explains a missing started project with Try again instead of a Projects page", async () => {
    const view = await resolveApp({ currentProject: null });
    try {
      expect(view.replace).not.toHaveBeenCalled();
      const notice = nodes(view.root).find(node => node.props?.["data-stub"] === "error");
      expect(notice.props.error).toContain("no started project");
      expect(nodes(view.root).some(node => node.props?.["data-stub"] === "account-settings")).toBe(true);
    } finally { view.app.unmount(); }
  });
});

// /app/learning: the shell for a lesson without a practice project, and L outside a project.
describe("Learning page", () => {
  async function openPage(mode) {
    const learning = Vue.reactive({ state: { actorKey: "local", modeBusy: "" }, inLesson: mode.on === true, lessonTitle: mode.lessonTitle || "",
      learningMode: LearningEnvironment.normalizeLearningMode({ ok: true, available: true, learningMode: mode }),
      readLearningMode: vi.fn(async () => learning.learningMode), show: vi.fn(async () => null), leaveLesson: vi.fn(async () => ({ ok: true })) });
    const stub = name => ({ setup: (_props, { slots }) => () => Vue.h("div", { "data-stub": name },
      [slots["top-left"]?.(), slots["top-right"]?.(), slots.default?.()]) });
    const page = compiledUi(path.resolve("src/pages/app/learning.vue"), {
      vue: Vue,
      "@/components/StudioAppShellLayout.vue": { default: stub("shell") },
      "@/components/studio/Vibe64AuthSettingsButton.vue": { default: stub("account-settings") },
      "@/composables/useVibe64Learning.js": { useVibe64Learning: () => learning },
      "@/lib/vibe64Learning.js": LearningEnvironment
    });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(page) });
    app.component("v-btn", uiWidget);
    app.mount(root);
    for (let index = 0; index < 4; index += 1) { await Promise.resolve(); await Vue.nextTick(); }
    return { app, root, learning };
  }
  const byTest = (root, id) => nodes(root).find(node => node.props?.["data-test"] === id);

  it("opens L on the lesson in progress, with Leave lesson and Account settings", async () => {
    const view = await openPage({ on: true, attemptId: "a", lessonTitle: "Set yourself up", practiceSlug: "", projectSlugs: [] });
    try {
      expect(view.learning.show).toHaveBeenCalledWith({ surface: "lesson", attemptId: "a" });
      expect(nodes(view.root).some(node => node.props?.["data-stub"] === "account-settings")).toBe(true);
      byTest(view.root, "learning-page-leave").props.onClick();
      expect(view.learning.leaveLesson).toHaveBeenCalledOnce();
      expect(byTest(view.root, "learning-page-projects")).toBeUndefined();
    } finally { view.app.unmount(); }
  });

  it("opens L on the courses outside a lesson, with a way back to the projects", async () => {
    const view = await openPage({ on: false });
    try {
      expect(view.learning.show).toHaveBeenCalledWith({ surface: "courses" });
      expect(byTest(view.root, "learning-page-projects").props.to).toBe("/app");
      expect(byTest(view.root, "learning-page-leave")).toBeUndefined();
    } finally { view.app.unmount(); }
  });
});
