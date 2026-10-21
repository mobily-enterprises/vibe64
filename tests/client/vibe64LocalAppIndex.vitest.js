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
  // The shared controller's open step: a start no longer current opens nothing.
  const controller = { opened: async outcome => { if (outcome?.current !== false) calls.opened.push(outcome); return outcome; } };
  controller.startLesson = (selection, start) => start(selection).then(controller.opened);
  const component = compiledUi(path.resolve("src/components/learning/Vibe64LearningCourses.vue"), {
    vue: Vue, "vue-router": { useRoute: () => route }, "@local/vibe64-training/client/lesson-picker": { default: picker },
    "@/composables/useVibe64Learning.js": { useVibe64Learning: () => controller }
  });
  const root = { children: [] };
  const app = uiRenderer().createApp({ render: () => Vue.h(component, { learning: owner }) });
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
  // The start passes through the shared controller, a few promise hops.
  const settle = async () => { for (let index = 0; index < 4; index += 1) await Vue.nextTick(); };
  const start = () => nodes(view.root).find(node => node.props?.["data-test"] === "start-lesson").props.onClick();
  try {
    let reject;
    view.owner.startLesson = () => new Promise((_resolve, fail) => { reject = fail; });
    start();
    view.owner.active.value = false; await Vue.nextTick();
    view.owner.active.value = true; await Vue.nextTick();
    reject(new Error("retired operation")); await settle();
    expect(messages()).not.toContain("retired operation");
    view.owner.startLesson = async () => { throw new Error("current operation"); };
    start(); await settle();
    expect(messages()).toContain("current operation");
    view.route.fullPath = "/app/project/other"; await Vue.nextTick();
    expect(messages()).not.toContain("current operation");
    start(); await settle();
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
    "@/lib/vibe64Learning.js": LearningEnvironment, "vue-router": { useRouter: () => null } });
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

// Local /app has no Projects page: it resolves by mode once the mode is read.
// Develop opens the started project; Learn opens Learn's place.
describe("local /app mode resolver", () => {
  // The server redirects a request for /app to the started project; `startedUrl`
  // is where that redirect ends (still /app when no project was started).
  async function resolveApp({ startedUrl = "http://127.0.0.1:4531/app/project/my-app", learning = null } = {}) {
    const replace = vi.fn(async () => {});
    const fetch = vi.fn(async () => ({ ok: true, url: startedUrl }));
    vi.stubGlobal("fetch", fetch);
    const stub = name => ({ props: ["title", "error"], setup: (props, { slots }) => () => Vue.h("div", { "data-stub": name, ...props },
      [slots.default?.(), slots["top-right"]?.(), slots.actions?.()]) });
    const page = compiledUi(path.resolve("src/pages/app/index.vue"), {
      vue: Vue, "vue-router": { useRouter: () => ({ replace }) },
      "@/components/StudioAppShellLayout.vue": { default: stub("shell") },
      "@/components/studio/StudioErrorNotice.vue": { default: stub("error") },
      "@/components/studio/Vibe64AuthSettingsButton.vue": { default: stub("account-settings") },
      "@/composables/useVibe64Learning.js": { useVibe64Learning: () => learning }
    });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(page) });
    for (const tag of ["v-btn", "v-skeleton-loader"]) app.component(tag, uiWidget);
    app.mount(root);
    const settle = async () => { for (let index = 0; index < 4; index += 1) { await Promise.resolve(); await Vue.nextTick(); } };
    await settle();
    return { app, root, replace, fetch, settle };
  }

  it("opens the started project in Develop by following the server's /app redirect", async () => {
    const view = await resolveApp();
    try {
      expect(view.fetch).toHaveBeenCalledWith("/app", { method: "HEAD", credentials: "same-origin" });
      expect(view.replace).toHaveBeenCalledWith("/app/project/my-app");
    } finally { view.app.unmount(); vi.unstubAllGlobals(); }
  });

  it("waits for the mode, then opens Learn's place in Learn mode", async () => {
    const learning = Vue.reactive({ state: { modeRead: false }, learnMode: false, modePlace: vi.fn(() => "/app/project/training-abc/dashboard") });
    const view = await resolveApp({ learning });
    try {
      expect(view.replace, "nothing before the mode is read").not.toHaveBeenCalled();
      Object.assign(learning, { learnMode: true, state: { modeRead: true } });
      await view.settle();
      expect(view.replace).toHaveBeenCalledWith("/app/project/training-abc/dashboard");
      expect(view.fetch).not.toHaveBeenCalled();
    } finally { view.app.unmount(); vi.unstubAllGlobals(); }
  });

  it("explains a missing started project with Try again instead of a Projects page", async () => {
    // The server did not redirect /app: no project was started.
    const view = await resolveApp({ startedUrl: "http://127.0.0.1:4531/app" });
    try {
      expect(view.replace).not.toHaveBeenCalled();
      const notice = nodes(view.root).find(node => node.props?.["data-stub"] === "error");
      expect(notice.props.error).toContain("no started project");
      expect(nodes(view.root).some(node => node.props?.["data-stub"] === "account-settings")).toBe(true);
    } finally { view.app.unmount(); vi.unstubAllGlobals(); }
  });
});

// /app/learning: Learn mode with no practice project selected is the project
// page with no project selected.
it("renders /app/learning as the project page", () => {
  const page = compiledUi(path.resolve("src/pages/app/learning.vue"), { "./project/[slug].vue": { default: { render: () => Vue.h("main", { "data-stub": "project-page" }) } } });
  const root = { children: [] };
  const app = uiRenderer().createApp({ render: () => Vue.h(page) });
  app.mount(root);
  try { expect(nodes(root).some(node => node.props?.["data-stub"] === "project-page")).toBe(true); } finally { app.unmount(); }
});
