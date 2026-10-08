import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Vibe64LocalAppIndex", () => {
  it("uses the shared project selection gate instead of auto-selecting a project", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "src/components/studio/Vibe64LocalAppIndex.vue"),
      "utf8"
    );

    expect(source).toContain("ProjectSelectionGate");
    expect(source).toContain("force-picker");
    expect(source).toContain("navigate-on-select");
    expect(source).not.toContain("useVibe64ProjectsResource");
    expect(source).not.toContain("router.replace");
    expect(source).not.toContain("targetProjectSlug");
    expect(source).not.toContain("watch(");
    expect(source).not.toContain("v-for=\"project");
  });
});

// Actual app-index and launcher setup/templates; only saved native sessions and
// presentation widgets are bounded fixtures. No teacher/runtime is fabricated.
import * as Vue from "vue";
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

async function mountLearningIndex() {
  const route = Vue.reactive({ fullPath: "/app?mode=learning" });
  const calls = { panels: 0, unmounts: 0, gateProps: null, pickerProps: null, select: [] };
  const owner = { learningMode: Vue.ref(true), purposeFilter: Vue.ref("learning"), learnerId: Vue.ref("learner"),
    busy: Vue.ref(false), startRetry: Vue.ref(null),
    learningResource: { data: Vue.ref({ ok: true, available: true, learnerId: "learner", sessions: [] }), isLoading: Vue.ref(false), loadError: Vue.ref("") },
    coursesResource: { data: Vue.ref({ ok: true, available: true, courses: [] }), isLoading: Vue.ref(false), loadError: Vue.ref("") } };
  owner.setLearningMode = async value => { owner.learningMode.value = value; owner.purposeFilter.value = value ? "learning" : "working"; };
  owner.refresh = async () => null;
  let opened;
  owner.startLesson = async input => { calls.start = input; opened({ attemptId: "attempt", learnerId: "learner", sessionId: "learning-session" }); };
  owner.resumeLesson = async attempt => { calls.resume = attempt; };
  owner.retryStart = async () => { calls.retry = true; };
  const picker = { props: ["canStart", "canResume", "learningResult"], emits: ["start", "resume", "refresh"], setup(props, { emit }) {
    calls.pickerProps = props;
    return () => Vue.h("button", { "data-test": "start-lesson", onClick: () => emit("start", { courseId: "course", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 3 }) });
  } };
  const launcher = compiledUi(path.resolve("src/components/studio/Vibe64LearningLessonLauncher.vue"), {
    vue: Vue, "vue-router": { useRoute: () => route }, "@local/vibe64-training/client/lesson-picker": { default: picker }
  });
  const shell = compiledUi(path.resolve("src/components/StudioAppShellLayout.vue"), {
    vue: Vue, "@jskit-ai/shell-web/client/components/ShellOutlet": { default: uiWidget },
    "./Vibe64ColleagueLauncherTarget.vue": { default: uiWidget }
  });
  const panel = { props: ["learningResource", "purposeFilter", "chatCollapsed", "projectPane", "active"], setup(props, { slots, expose }) {
    calls.panels++; calls.panelProps = props; Vue.onUnmounted(() => { calls.unmounts++; });
    expose({ selectLearningConversation(identity) { calls.select.push(identity); return true; } });
    return () => Vue.h("article", { "data-test": "retained-panel" }, slots.dashboard?.());
  } };
  const gate = { props: { forcePicker: Boolean, navigateOnSelect: Boolean }, setup(props) { calls.gateProps = props; return () => Vue.h("aside"); } };
  const component = compiledUi(path.resolve("src/components/studio/Vibe64LocalAppIndex.vue"), {
    vue: Vue,
    "@/components/StudioAppShellLayout.vue": { default: shell },
    "@/components/studio/ProjectSelectionGate.vue": { default: gate },
    "@/components/studio/Vibe64AuthSettingsButton.vue": { default: uiWidget },
    "@/components/studio/Vibe64SessionPanel.vue": { default: panel },
    "@/components/studio/Vibe64LearningLessonLauncher.vue": { default: launcher },
    "@/composables/useVibe64LearningMode.js": { useVibe64LearningMode(options) { opened = options.onConversationOpened; return owner; } }
  });
  const root = { children: [] }; const app = uiRenderer().createApp(component);
  for (const tag of ["v-app-bar", "v-btn", "v-icon", "v-spacer", "v-main", "v-container", "v-alert"]) app.component(tag, uiWidget);
  app.mount(root); await Vue.nextTick();
  return { app, root, owner, calls, route };
}

it("mounts actual L/root lesson controls without a project and retains one original panel across mode transitions", async () => {
  const view = await mountLearningIndex();
  try {
    expect(view.calls.panels).toBe(1);
    expect(view.calls.panelProps.learningResource).toBe(view.owner.learningResource);
    expect(view.calls.panelProps.purposeFilter).toBe("learning");
    expect(view.calls.gateProps.forcePicker).toBe(true);
    expect(view.calls.gateProps.navigateOnSelect).toBe(true);
    const plate = nodes(view.root).find(node => node.props?.["aria-label"] === "Learning mode");
    expect(plate.props["aria-pressed"]).toBe(true);
    plate.props.onClick(); await Vue.nextTick();
    expect(view.calls.panelProps.purposeFilter).toBe("working");
    expect(view.calls.panelProps.active).toBe(false);
    expect(plate.props["aria-pressed"]).toBe(false);
    plate.props.onClick(); await Vue.nextTick();
    expect(view.calls.panelProps.purposeFilter).toBe("learning");
    expect(view.calls.panelProps.active).toBe(true);
    expect(view.calls.panels).toBe(1); expect(view.calls.unmounts).toBe(0);
  } finally { view.app.unmount(); }
});

it("routes a direct Lesson0 start through the supplied original owner and selects its actual returned conversation", async () => {
  const view = await mountLearningIndex();
  try {
    nodes(view.root).find(node => node.props?.["data-test"] === "start-lesson").props.onClick();
    await Vue.nextTick(); await Vue.nextTick();
    expect(view.calls.start).toEqual({ courseId: "course", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 3 });
    expect(view.calls.select).toEqual([{ attemptId: "attempt", learnerId: "learner", sessionId: "learning-session" }]);
    expect(view.calls.panelProps.chatCollapsed).toBe(false);
    expect(view.calls.panels).toBe(1);
  } finally { view.app.unmount(); }
});

it("delegates exposed Learning selection only for the actual loaded own-learner row and confirmed original selection", async () => {
  const source = readFileSync(path.resolve("src/components/studio/Vibe64SessionPanel.vue"), "utf8");
  const method = source.match(/function selectLearningConversation\([\s\S]*?\n\}/u)?.[0]; expect(method).toBeTruthy();
  const props = { purposeFilter: "learning" };
  const sessionData = { learningLearnerId: Vue.ref("learner"), selectedSessionId: Vue.ref(""), availableSessions: Vue.ref([
    { sessionId: "learning-session", purpose: "learning", learningAttemptId: "attempt" },
    { sessionId: "working-session", purpose: "working" }
  ]), selectSessionId(id) { this.selectedSessionId.value = id; } };
  const select = new Function("props", "sessionData", `${method}\nreturn selectLearningConversation;`)(props, sessionData);
  const identity = { sessionId: "learning-session", attemptId: "attempt", learnerId: "learner" };
  for (const patch of [{ learnerId: "foreign" }, { attemptId: "other" }, { sessionId: "working-session" }, { sessionId: "unknown" }]) {
    expect(select({ ...identity, ...patch })).toBe(false); expect(sessionData.selectedSessionId.value).toBe("");
  }
  expect(select(identity)).toBe(true); expect(sessionData.selectedSessionId.value).toBe("learning-session");
  sessionData.selectedSessionId.value = ""; sessionData.selectSessionId = () => {};
  expect(select(identity)).toBe(false);
  props.purposeFilter = "working"; expect(select(identity)).toBe(false);
});


it("retires local lesson errors when mode, route or learner changes, including late failures", async () => {
  const view = await mountLearningIndex();
  const messages = () => nodes(view.root).map(node => node.text || "").join(" ");
  const start = () => nodes(view.root).find(node => node.props?.["data-test"] === "start-lesson").props.onClick();
  try {
    let reject;
    view.owner.startLesson = () => new Promise((_resolve, fail) => { reject = fail; });
    start();
    view.owner.learningMode.value = false; await Vue.nextTick();
    view.owner.learningMode.value = true; await Vue.nextTick();
    reject(new Error("retired operation")); await Vue.nextTick(); await Vue.nextTick();
    expect(messages()).not.toContain("retired operation");
    view.owner.startLesson = async () => { throw new Error("current operation"); };
    start(); await Vue.nextTick(); await Vue.nextTick();
    expect(messages()).toContain("current operation");
    view.route.fullPath = "/app?mode=learning&other=route"; await Vue.nextTick();
    expect(messages()).not.toContain("current operation");
    start(); await Vue.nextTick(); await Vue.nextTick();
    expect(messages()).toContain("current operation");
    view.owner.learnerId.value = "another-learner"; await Vue.nextTick();
    expect(messages()).not.toContain("current operation");
    expect(messages()).not.toContain("still being completed");
  } finally { view.app.unmount(); }
});


it("keeps the original empty Temporary host out of Learning and fences its late selection callback", async () => {
  const source = readFileSync(path.resolve("src/components/studio/Vibe64SessionPanel.vue"), "utf8");
  expect(source).toContain("v-if=\"hostConversation\" v-show=\"props.purposeFilter !== 'learning'\"");
  expect(source).toContain(":active=\"props.active && props.purposeFilter !== 'learning'\"");
  const method = source.match(/function closeEmptyHostConversation\([\s\S]*?\n\}/u)?.[0];
  expect(method).toBeTruthy();
  const props = { active: true, purposeFilter: "learning" };
  let closed = 0;
  const close = new Function("props", "hostConversation", `${method}\nreturn closeEmptyHostConversation;`)(props, { close() { closed++; } });
  close(); expect(closed).toBe(0);
  props.purposeFilter = "working"; props.active = false; close(); expect(closed).toBe(0);
  props.active = true; close(); expect(closed).toBe(1);
});
