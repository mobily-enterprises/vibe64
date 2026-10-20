import path from "node:path";
import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as LearningLib from "../../src/lib/vibe64Learning.js";
import { watchColleagueLearningRequests } from "../../packages/vibe64-colleague/src/client/colleagueLearningRequests.js";

const { VIBE64_LEARNING_ROUTES, VIBE64_LEARNING_TEACH_MESSAGE, createVibe64Learning, showMeCommand } = LearningLib;

// Learning v2 environment (C6): the shared controller and the lesson reader.
// HTTP is a stub of the C3 actions; verdicts always come from those actions.
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const lessonResult = (overrides = {}) => ({
  ok: true, available: true,
  // C3 lesson.read attempt summary: practiceSlug names the practice project.
  attempt: { attemptId: ATTEMPT, ended: false, practiceSlug: "practice-one" },
  lesson: { schemaVersion: 2, code: "V64-START-01", title: "Orientation", notesText: "Notes.",
    steps: [
      { id: "read", title: "Read", bodyText: "# Hello", required: false, check: { kind: "none" } },
      { id: "quiz", title: "Quiz", bodyText: "Pick.", required: true,
        check: { kind: "choice", question: "Which?", options: ["A", "B", "C"] } },
      { id: "preview", title: "Open the Preview", bodyText: "Look.", required: true,
        visual: { id: "client-server", play: [{ name: "showOverview", parameters: {} }, { name: "highlight", parameters: { part: "server" } }] },
        guide: { target: "preview", navigate: true, caption: "Your app runs here" },
        check: { kind: "auto", check: "orientation-response", files: [] } },
      { id: "tick", title: "Tick", bodyText: "Do it.", required: true, check: { kind: "self" } }
    ] },
  results: [], ...overrides
});

let saved;
beforeEach(() => {
  saved = new Map();
  vi.stubGlobal("window", { sessionStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function controller({ reads = () => lessonResult(), posts = () => ({ ok: true }), ...options } = {}) {
  const calls = [];
  const request = vi.fn(async (url, { method, body } = {}) => {
    calls.push({ url, method, body });
    return method === "GET" ? reads(url, calls) : posts(url, body, calls);
  });
  return { learning: createVibe64Learning({ request, ...options }), calls, request };
}
const flush = async () => { for (let i = 0; i < 4; i += 1) { await Promise.resolve(); await Vue.nextTick(); } };

describe("useVibe64Learning controller", () => {
  it("opens nothing until the overlay binds a signed-in viewer, then opens the reader on the saved place", async () => {
    const { learning, calls } = controller({ reads: () => lessonResult({ reader: { attemptId: ATTEMPT, stepId: "quiz", scroll: 120 } }) });
    await expect(learning.show()).rejects.toThrow("Sign in");
    learning.setViewer("member");
    const focus = await learning.show({ attemptId: ATTEMPT });
    expect(calls[0]).toEqual({ url: VIBE64_LEARNING_ROUTES.lessonRead(ATTEMPT), method: "GET", body: undefined });
    expect(learning.open).toBe(true);
    expect(learning.surface).toBe("lesson");
    // No browser place yet: the learner's saved reader.json position is restored.
    expect(learning.stepId).toBe("quiz");
    expect(learning.scroll).toBe(120);
    expect(focus).toEqual({ learningOpen: true, learningSurface: "lesson", learningAttemptId: ATTEMPT, learningStepId: "quiz" });
    expect(learning.lesson.value.practiceProjectSlug).toBe("practice-one");
    expect(learning.lesson.value.steps.every(step => !Object.hasOwn(step.check || {}, "answer"))).toBe(true);
  });

  it("reads every page of a lesson whose step text lesson.read paged", async () => {
    const first = lessonResult({ page: { index: 0, count: 2 } });
    delete first.lesson.steps[3].bodyText;
    const { learning, calls } = controller({ reads: url => url.endsWith("?page=1")
      ? lessonResult({ page: { index: 1, count: 2 }, lesson: { schemaVersion: 2, code: "V64-START-01", steps: [{ id: "tick", bodyText: "Long text." }] } })
      : first });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    expect(calls.map(call => call.url)).toEqual([VIBE64_LEARNING_ROUTES.lessonRead(ATTEMPT), `${VIBE64_LEARNING_ROUTES.lessonRead(ATTEMPT)}?page=1`]);
    expect(learning.lesson.value.steps.find(step => step.id === "tick").bodyText).toBe("Long text.");
    expect(learning.lesson.value.steps.find(step => step.id === "read").bodyText).toBe("# Hello");
  });

  it("minimise keeps the place, close returns to the app and reopening restores the exact step", async () => {
    vi.useFakeTimers();
    const { learning, calls } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    learning.selectStep("preview");
    learning.setScroll(48.4);
    learning.minimise();
    expect(learning.open).toBe(false);
    expect(learning.minimised).toBe(true);
    expect(learning.stepId).toBe("preview");
    // Minimising saves reader.json at once (last write wins); later timers add nothing new.
    expect(calls.filter(call => call.method === "POST")).toEqual([
      { url: VIBE64_LEARNING_ROUTES.readerSave(ATTEMPT), method: "POST", body: { stepId: "preview", scroll: 48 } }]);
    vi.runAllTimers();
    expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
    await learning.show();
    expect(learning.open).toBe(true);
    expect(learning.surface).toBe("lesson");
    expect(learning.stepId).toBe("preview");
    learning.close();
    expect(learning.open).toBe(false);
    expect(learning.minimised).toBe(false);

    // A new page in the same tab restores this browser's place before reader.json.
    const again = controller({ reads: () => lessonResult({ reader: { attemptId: ATTEMPT, stepId: "quiz", scroll: 7 } }) });
    again.learning.setViewer("member");
    expect(again.learning.attemptId).toBe(ATTEMPT);
    await again.learning.show();
    expect(again.learning.stepId).toBe("preview");
    expect(again.learning.scroll).toBe(48);
    expect(again.calls[0].url).toBe(VIBE64_LEARNING_ROUTES.lessonRead(ATTEMPT));
  });

  it("forgets the previous person's place, lesson and pending Teach me on a viewer change", async () => {
    const { learning } = controller();
    learning.setViewer("first");
    await learning.show({ attemptId: ATTEMPT, stepId: "tick" });
    learning.teachMe("tick");
    learning.setViewer("second");
    expect([learning.open, learning.attemptId, learning.lesson.value, learning.colleagueRequest.value]).toEqual([false, "", null, null]);
    learning.setViewer("");
    expect(learning.state.actorKey).toBe("");
  });

  it("answers, marks done and runs checks through the step actions, keeping a retry's request ID", async () => {
    let fail = true;
    let results = [];
    const { learning, calls } = controller({
      reads: () => lessonResult({ results }),
      posts: (url, body) => {
        if (url === VIBE64_LEARNING_ROUTES.stepAnswer(ATTEMPT) && fail) { fail = false; throw new Error("Network"); }
        results = [...results, { stepId: body.stepId, outcome: "passed" }];
        return { ok: true };
      }
    });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    expect(await learning.answer("quiz", [2, 0])).toBeNull();
    expect(learning.state.error).toBe("Network");
    await learning.answer("quiz", [0, 2]);
    const answers = calls.filter(call => call.url === VIBE64_LEARNING_ROUTES.stepAnswer(ATTEMPT));
    expect(answers.map(call => call.body.selected)).toEqual([[0, 2], [0, 2]]);
    expect(answers[0].body.requestId).toBe(answers[1].body.requestId);
    expect(learning.stepStatus("quiz")).toBe("passed");
    await learning.done("tick");
    await learning.runCheck("preview");
    const done = calls.find(call => call.url === VIBE64_LEARNING_ROUTES.stepDone(ATTEMPT));
    const check = calls.find(call => call.url === VIBE64_LEARNING_ROUTES.stepCheck(ATTEMPT));
    expect(done.body).toEqual({ stepId: "tick", requestId: expect.any(String) });
    expect(check.body).toEqual({ stepId: "preview", requestId: expect.any(String) });
    expect(done.body.requestId).not.toBe(answers[0].body.requestId);
    // Every confirmed action is followed by a fresh lesson.read.
    expect(calls.filter(call => call.method === "GET")).toHaveLength(4);
    expect(learning.stepStatus("read")).toBe("not-started");
  });

  it("Show me minimises L, then guides with the practice project's view; Teach me asks Colleague", async () => {
    const navigateBrowser = vi.fn();
    const view = { projectSlug: "practice-one", openFile: vi.fn() };
    const runGuide = vi.fn(async () => ({ guide: { shown: true, step: "preview" } }));
    const { learning } = controller({ browserNavigation: Vue.shallowRef(navigateBrowser), colleagueView: Vue.shallowRef(view), runGuide });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "preview" });
    const receipt = await learning.showMe("preview");
    expect(receipt).toEqual({ guide: { shown: true, step: "preview" } });
    expect(learning.minimised).toBe(true);
    const [command, options] = runGuide.mock.calls[0];
    expect(command).toMatchObject({ projectSlug: "practice-one", pane: "preview",
      guide: { target: "preview", navigate: true, highlight: true, caption: "Your app runs here" } });
    expect(options.navigateBrowser).toBe(navigateBrowser);
    // The file opener reads the published view when it is used, for this project only.
    expect(options.view.openFile("src/app.js")).toBe(false);
    view.openFile.mockReturnValue(true);
    expect(options.view.openFile("src/app.js")).toBe(true);

    await learning.show();
    const request = learning.teachMe("quiz");
    expect(learning.minimised).toBe(true);
    expect(request).toMatchObject({ kind: "teach", message: VIBE64_LEARNING_TEACH_MESSAGE, attemptId: ATTEMPT, stepId: "quiz" });
    expect(learning.focus.value).toEqual({ learningOpen: false, learningSurface: "lesson", learningAttemptId: ATTEMPT, learningStepId: "quiz" });
    expect(learning.consumeColleagueRequest("other")).toBeNull();
    expect(learning.consumeColleagueRequest(request.id)).toBe(request);
    expect(learning.colleagueRequest.value).toBeNull();
  });

  it("Show me opens a file guide through the Working view published after navigation, without the old mode", async () => {
    const filesStep = { id: "edit", title: "Edit", bodyText: "Open it.", required: false, check: { kind: "none" },
      guide: { target: "files", navigate: true, filePath: "src/app.js" } };
    const reads = () => { const value = lessonResult(); value.lesson.steps.push(filesStep); return value; };
    const colleagueView = Vue.shallowRef({ projectSlug: "elsewhere", ready: true, openFile: vi.fn(() => true) });
    const working = { projectSlug: "practice-one", ready: true, openFile: vi.fn(path => path === "src/app.js") };
    const navigateBrowser = vi.fn(async command => {
      // L was opened from another page: the practice project's ordinary
      // Working view (no Learning binding) publishes itself after navigation.
      setTimeout(() => { colleagueView.value = working; }, 60);
      return { projectSlug: command.projectSlug, pane: command.pane };
    });
    const { learning } = controller({ reads, browserNavigation: Vue.shallowRef(navigateBrowser), colleagueView });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "edit" });
    const receipt = await learning.showMe("edit");
    expect(navigateBrowser).toHaveBeenCalledWith(expect.objectContaining({ projectSlug: "practice-one", pane: "files" }));
    expect(working.openFile).toHaveBeenCalledWith("src/app.js");
    expect(colleagueView.value.learningBinding).toBeUndefined();
    expect(receipt.focus).toEqual({ projectSlug: "practice-one", pane: "files" });
    expect(receipt.guide.shown).toBe(false);

    // A view of another project never opens the file; the guide says so.
    let clock = 0;
    const stale = Vue.shallowRef({ projectSlug: "elsewhere", ready: true, openFile: vi.fn(() => true) });
    const other = controller({ reads, browserNavigation: Vue.shallowRef(async () => ({})), colleagueView: stale,
      now: () => (clock += 10000) });
    other.learning.setViewer("member");
    await other.learning.show({ attemptId: ATTEMPT, stepId: "edit" });
    await expect(other.learning.showMe("edit")).rejects.toThrow("could not open that practice project file");
    expect(stale.value.openFile).not.toHaveBeenCalled();
  });

  it("Teach me opens this host's Colleague and sends the fixed message once, for the same person only", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "quiz" });
    const order = [];
    let actor = "member";
    let accepted = true;
    const report = vi.fn();
    const stop = watchColleagueLearningRequests({ learning, actorKey: () => actor, report,
      reveal: vi.fn(async () => { order.push("reveal"); }),
      send: vi.fn(async message => { order.push(["send", message]); return accepted; }) });
    try {
      learning.teachMe("quiz");
      await flush();
      expect(learning.minimised).toBe(true);
      expect(order).toEqual(["reveal", ["send", VIBE64_LEARNING_TEACH_MESSAGE]]);
      expect(learning.colleagueRequest.value).toBeNull();
      expect(report).not.toHaveBeenCalled();

      // A rejected send is reported; the request is not resent by itself.
      accepted = false;
      learning.teachMe("quiz");
      await flush();
      expect(order).toHaveLength(4);
      expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Teach me") }));

      // Another signed-in person's Colleague never sends this person's request.
      actor = "someone-else";
      learning.teachMe("quiz");
      await flush();
      expect(order).toHaveLength(4);
      expect(learning.colleagueRequest.value).toMatchObject({ actorKey: "member" });
    } finally { stop(); }
    const colleagueSource = readFileSync(path.resolve("packages/vibe64-colleague/src/client/Vibe64Colleague.vue"), "utf8");
    expect(colleagueSource).toContain("watchColleagueLearningRequests({ learning");
    // One injection of the L controller feeds both the step card (E) and Teach me (D).
    expect(colleagueSource).toContain("const learningOwner = inject(VIBE64_LEARNING_KEY, null);");
    expect(colleagueSource).toContain("const learning = unref(learningOwner);");
  });

  it("guides point-only without a practice project or at the L button", () => {
    expect(showMeCommand({ target: "preview", navigate: true }, {})).toEqual({
      guide: { target: "preview", navigate: false, highlight: true, steps: [{ id: "preview", label: "Preview" }], caption: "Preview" } });
    expect(showMeCommand({ target: "learning", navigate: true }, { projectSlug: "practice-one" }).projectSlug).toBeUndefined();
    expect(showMeCommand({ target: "files", navigate: true, filePath: "src/app.js" }, { projectSlug: "p" })).toMatchObject({
      projectSlug: "p", pane: "files", guide: { filePath: "src/app.js", caption: "Dashboard → Files → src/app.js" } });
    expect(() => showMeCommand({ target: "nowhere" })).toThrow("declared Vibe64 guide places");
  });

  it("rereads the displayed attempt only for its own learner change", async () => {
    const { learning, calls } = controller();
    learning.setViewer("member");
    expect(learning.learnerChanged({ attemptId: ATTEMPT })).toBeNull();
    await learning.show({ attemptId: ATTEMPT });
    expect(learning.learnerChanged({ attemptId: OTHER })).toBeNull();
    await learning.learnerChanged({ attemptId: ATTEMPT });
    expect(calls.filter(call => call.method === "GET")).toHaveLength(2);
  });
});

// The actual reader template and setup with bounded widgets.
function compiledUi(filename, imports) {
  const descriptor = parse(readFileSync(filename, "utf8"), { filename }).descriptor;
  const script = compileScript(descriptor, { id: "learning-env" });
  const compiled = compileTemplate({ source: descriptor.template.content, filename, id: "learning-env",
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
const widget = { inheritAttrs: false, setup: (_props, { attrs, slots }) => () => Vue.h("div", attrs, slots.default?.()) };
const nodes = root => [root, ...root.children.flatMap(nodes)];
const byTest = (root, id) => nodes(root).find(node => node.props?.["data-test"] === id);
const textOf = node => [node.text || "", ...node.children.map(textOf)].join("");

async function mountReader(learning) {
  const players = [];
  const player = Vue.defineComponent({ props: ["resource", "attemptId"], setup(props, { expose }) {
    const instance = { restores: [], commands: [] };
    players.push(instance);
    expose({ restore: async value => { instance.restores.push(value); }, command: async value => { instance.commands.push(value); } });
    return () => Vue.h("figure");
  } });
  const readVisual = vi.fn(async () => ({ id: "client-server", visual: { id: "client-server", initialState: "idle" } }));
  const reader = compiledUi(path.resolve("src/components/learning/Vibe64LearningReader.vue"), {
    vue: Vue, "vue-router": { useRouter: () => ({ push: vi.fn() }) },
    "@jskit-ai/http-web/client/lib/httpClient": { getHttpWebClient: () => { throw new Error("stubbed"); } },
    "@local/vibe64-training/client/visual-player": { default: player },
    "@/lib/studioUrls.js": { resolveStudioRequestUrl: url => url },
    "@/lib/vibe64ProjectScope.js": { projectAppPath: slug => `/app/project/${slug}` },
    "@/lib/vibe64Learning.js": LearningLib,
    "./Vibe64LearningMarkdown.vue": { default: { props: ["text"], setup: props => () => Vue.h("section", { "data-markdown": props.text }) } }
  });
  const root = { children: [] };
  const app = uiRenderer().createApp({ render: () => Vue.h(reader, { learning, learningRevision: 3, readVisual }) });
  for (const tag of ["v-btn", "v-alert", "v-skeleton-loader", "v-checkbox"]) app.component(tag, widget);
  app.mount(root);
  await flush();
  return { app, root, players, readVisual };
}

describe("Learning reader", () => {
  it("shows steps with Markdown bodies and records a choice answer and Done only through the actions", async () => {
    const { learning, calls } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "quiz" });
    const view = await mountReader(learning);
    try {
      const stepButtons = nodes(view.root).filter(node => node.props?.["data-step-id"]);
      expect(stepButtons.map(node => node.props["data-step-id"])).toEqual(["read", "quiz", "preview", "tick"]);
      expect(stepButtons[1].props["aria-current"]).toBe("step");
      expect(nodes(view.root).some(node => node.props?.["data-markdown"] === "Pick.")).toBe(true);
      expect(byTest(view.root, "learning-answer").props.disabled).toBe(true);
      const options = nodes(view.root).filter(node => node.tag === "div" && node.props?.label);
      expect(options.map(node => node.props.label)).toEqual(["A", "B", "C"]);
      options[1].props["onUpdate:modelValue"](true);
      await flush();
      byTest(view.root, "learning-answer").props.onClick();
      await flush();
      expect(calls.find(call => call.method === "POST").body).toMatchObject({ stepId: "quiz", selected: [1] });

      stepButtons[3].props.onClick();
      await flush();
      byTest(view.root, "learning-done").props.onClick();
      await flush();
      expect(calls.filter(call => call.method === "POST").at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.stepDone(ATTEMPT), body: { stepId: "tick" } });
      byTest(view.root, "learning-teach-me").props.onClick();
      expect(learning.colleagueRequest.value).toMatchObject({ stepId: "tick", message: VIBE64_LEARNING_TEACH_MESSAGE });
      expect(learning.minimised).toBe(true);
    } finally { view.app.unmount(); }
  });

  it("plays a diagram from its initial state with fresh IDs and remounts before 64 command IDs", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "preview" });
    const view = await mountReader(learning);
    try {
      expect(view.readVisual).toHaveBeenCalledWith(VIBE64_LEARNING_ROUTES.visual(ATTEMPT, "client-server"));
      expect(byTest(view.root, "learning-check")).toBeTruthy();
      expect(textOf(byTest(view.root, "learning-step-status"))).toContain("Not checked yet");
      const play = async () => { byTest(view.root, "learning-play").props.onClick(); await flush(); };
      await play();
      expect(view.players).toHaveLength(1);
      expect(view.players[0].restores).toEqual([{ state: "idle", paused: false, labels: {} }]);
      expect(view.players[0].commands.map(command => command.name)).toEqual(["showOverview", "highlight"]);
      expect(view.players[0].commands[1].parameters).toEqual({ part: "server" });
      expect(new Set(view.players[0].commands.map(command => command.commandId)).size).toBe(2);
      // 32 plays use 64 IDs on the first instance; the 33rd remounts first.
      for (let count = 1; count < 32; count += 1) await play();
      expect(view.players).toHaveLength(1);
      expect(view.players[0].commands).toHaveLength(64);
      await play();
      expect(view.players).toHaveLength(2);
      expect(view.players[1].commands).toHaveLength(2);
      const ids = [...view.players[0].commands, ...view.players[1].commands].map(command => command.commandId);
      expect(new Set(ids).size).toBe(66);
    } finally { view.app.unmount(); }
  });

  it("keeps an earlier-format attempt readable and only offers to end it", async () => {
    const { learning, calls } = controller({ reads: () => ({ ok: true, available: true,
      attempt: { attemptId: ATTEMPT, ended: false }, lesson: { schemaVersion: 1, code: "V64-START-01", title: "Old" } }),
    posts: () => ({ ok: true, available: true }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    const view = await mountReader(learning);
    try {
      expect(textOf(view.root)).toContain("cannot continue here");
      expect(nodes(view.root).some(node => node.props?.["data-step-id"])).toBe(false);
      const end = nodes(view.root).find(node => textOf(node) === "End this lesson" && node.props?.onClick);
      end.props.onClick();
      await flush();
      expect(calls.find(call => call.method === "POST")).toMatchObject({ url: VIBE64_LEARNING_ROUTES.lessonEnd(ATTEMPT),
        body: { expectedRevision: 3, requestId: expect.any(String) } });
    } finally { view.app.unmount(); }
  });
});

describe("Learning overlay", () => {
  it("binds the signed-in viewer, mounts one guide overlay, opens courses and the reader, and closes on Escape", async () => {
    const { learning } = controller();
    const realtime = [];
    const modeOptions = [];
    const HostKeys = await import("../../src/lib/vibe64AssistantHost.js");
    const LearnerEvents = await import("../../packages/vibe64-training/src/shared/learnerEvents.js");
    const overlay = compiledUi(path.resolve("src/components/learning/Vibe64LearningOverlay.vue"), {
      vue: Vue,
      "@jskit-ai/realtime/client/composables/useRealtimeEvent": { useRealtimeEvent: options => realtime.push(options) },
      "@local/vibe64-training/client/guide-overlay": { default: { render: () => Vue.h("aside", { "data-guide-overlay": "mounted" }) } },
      "@local/vibe64-training/shared/learner-events": LearnerEvents,
      "@/lib/vibe64AssistantHost.js": HostKeys,
      "@/composables/useVibe64Learning.js": { useVibe64Learning: () => learning },
      "@/composables/useVibe64LearningMode.js": { useVibe64LearningMode: options => { modeOptions.push(options);
        return { learningResource: { data: Vue.ref({ ok: true, revision: 9 }), reload: vi.fn() } }; } },
      "@/components/studio/Vibe64LearningLessonLauncher.vue": { default: { props: { learning: Object, environment: Boolean }, emits: ["opened"],
        setup: (props, { emit }) => () => Vue.h("section", { "data-test": "courses", environment: props.environment,
          onClick: () => emit("opened", { attemptId: ATTEMPT }) }) } },
      "./Vibe64LearningReader.vue": { default: { props: ["learning", "learningRevision"],
        setup: props => () => Vue.h("article", { "data-test": "reader", revision: props.learningRevision }) } }
    });
    const viewer = Vue.ref({ actorKey: "member" });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(overlay) });
    app.provide(HostKeys.VIBE64_ASSISTANT_VIEWER_KEY, viewer);
    for (const tag of ["v-btn"]) app.component(tag, widget);
    app.mount(root);
    try {
      await flush();
      expect(learning.state.actorKey).toBe("member");
      expect(nodes(root).filter(node => node.props?.["data-guide-overlay"])).toHaveLength(1);
      expect(byTest(root, "courses")).toBeUndefined();
      expect(realtime[0].event).toBe("vibe64.training.learner.changed");
      expect(modeOptions[0].active.value).toBe(false);
      await learning.show();
      await flush();
      expect(modeOptions[0].active.value).toBe(true);
      const layer = nodes(root).find(node => node.props?.role === "dialog");
      expect(layer.props["aria-label"]).toBe("Learning");
      expect(byTest(root, "courses").props.environment).toBe(true);
      byTest(root, "courses").props.onClick();
      await flush();
      expect(learning.surface).toBe("lesson");
      expect(byTest(root, "reader").props.revision).toBe(9);
      layer.props.onKeydown({ key: "Escape", defaultPrevented: false, stopPropagation() {} });
      await flush();
      expect(learning.open).toBe(false);
      // Kept mounted (hidden) so the place stays exactly as it was.
      expect(byTest(root, "reader")).toBeTruthy();
      viewer.value = { actorKey: "someone-else" };
      await flush();
      expect(learning.attemptId).toBe("");
    } finally { app.unmount(); }
    expect(learning.state.actorKey).toBe("");
  });
});
