import path from "node:path";
import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as LearningLib from "../../src/lib/vibe64Learning.js";
import { watchColleagueLearningRequests } from "../../packages/vibe64-colleague/src/client/colleagueLearningRequests.js";

const { VIBE64_LEARNING_ROUTES, VIBE64_LEARNING_TEACH_MESSAGE, createVibe64Learning, openLessonLink, revealCurrentStep, showMeCommand } = LearningLib;

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

// Learning-mode requests are answered by `mode` and recorded apart in modeCalls.
function controller({ reads = () => lessonResult(), posts = () => ({ ok: true }), mode = () => ({ on: false }),
  ...options } = {}) {
  const calls = [];
  const modeCalls = [];
  const request = vi.fn(async (url, { method, body } = {}) => {
    if (url.includes("/learning-mode")) {
      modeCalls.push({ url, method, body });
      return { ok: true, available: true, learningMode: mode(url, method), ...(method === "POST" ? { changed: true } : {}) };
    }
    calls.push({ url, method, body });
    return method === "GET" ? reads(url, calls) : posts(url, body, calls);
  });
  return { learning: createVibe64Learning({ request, ...options }), calls, modeCalls, request };
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

  it("shows a step passed in an earlier attempt of the same lesson content as passed", async () => {
    // A continued or restarted lesson has no results of its own yet; lesson.read
    // names the steps already passed in any attempt of this exact lesson content.
    const { learning } = controller({ reads: () => lessonResult({ results: [], passedStepIds: ["quiz"] }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    expect(learning.stepStatus("quiz")).toBe("passed");
    expect(learning.stepStatus("tick")).toBe("not-started");
  });

  it("opens a continued lesson at its first required step not yet passed, unless a place is saved", async () => {
    const { learning } = controller({ reads: () => lessonResult({ results: [], passedStepIds: ["quiz"] }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    expect(learning.stepId, "read is optional and quiz passed in an earlier attempt").toBe("preview");
  });

  it("opens a lesson with nothing passed yet at its first step, even when that step is optional", async () => {
    const { learning } = controller({ reads: () => lessonResult({ results: [] }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    expect(learning.stepId, "a fresh lesson does not skip its optional introduction").toBe("read");
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

  it("records whether the learner's own L or Escape hid L, for Colleague's phone return", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    learning.minimise("learner");
    expect(learning.hiddenBy).toBe("learner");
    await learning.show();
    expect(learning.hiddenBy, "showing L again clears it").toBe("");
    learning.minimise();
    expect(learning.hiddenBy, "Show me, Teach me and app navigation hide L to show something else").toBe("");
    await learning.show();
    learning.toggle();
    expect(learning.hiddenBy, "L is the learner's own hide").toBe("learner");
    expect(learning.minimised).toBe(true);
  });

  it("is in a lesson while the server's learning mode is on, with L open or hidden, until the lesson ends", async () => {
    let ended = false;
    const { learning, modeCalls } = controller({ reads: () => lessonResult({ attempt: { attemptId: ATTEMPT, ended, practiceSlug: "practice-one" } }),
      mode: () => ended ? { on: false } : { on: true, attemptId: ATTEMPT, lessonCode: "V64-START-01",
        lessonTitle: "Orientation", practiceSlug: "practice-one", projectSlugs: ["practice-one"] },
      posts: (url, body) => { ended = url === VIBE64_LEARNING_ROUTES.lessonEnd(ATTEMPT) && body.reason === "finished"; return { ok: true, available: true }; } });
    learning.setViewer("member");
    expect(learning.inLesson, "not before the mode is read").toBe(false);
    await flush();
    expect(modeCalls[0]).toEqual({ url: VIBE64_LEARNING_ROUTES.learningMode, method: "GET", body: undefined });
    expect(learning.inLesson, "learning mode comes from the server, also in a fresh tab").toBe(true);
    expect(learning.lessonTitle).toBe("Orientation");
    await learning.show({ attemptId: ATTEMPT });
    learning.toggle();
    expect(learning.inLesson, "hidden L keeps the lesson going").toBe(true);
    await learning.show();
    await learning.finishLesson({ expectedRevision: 1 });
    await flush();
    expect(learning.inLesson, "a finished lesson returns the app bar to normal").toBe(false);
    expect(learning.lessonTitle).toBe("");
    learning.setViewer("someone-else");
    expect(learning.inLesson).toBe(false);
    expect(learning.learningMode).toBeNull();

    // An unreadable mode never locks the learner in.
    const failing = createVibe64Learning({ request: async () => { throw new Error("offline"); } });
    failing.setViewer("member");
    await flush();
    expect(failing.inLesson).toBe(false);
  });

  it("leaves the lesson through its action, ending learning mode, and rereads the mode, also on another tab's change", async () => {
    let on = true;
    const { learning, modeCalls } = controller({ mode: (url, method) => {
      if (method === "POST") on = false;
      return on ? { on: true, attemptId: ATTEMPT, lessonTitle: "Orientation", practiceSlug: "practice-one",
        projectSlugs: ["practice-one"] } : { on: false };
    } });
    learning.setViewer("member");
    await flush();
    expect(learning.inLesson).toBe(true);
    learning.showNotice("note");
    const left = learning.leaveLesson();
    expect(learning.state.modeBusy).toBe("leave");
    expect(await learning.leaveLesson(), "one leave at a time").toBeNull();
    await left;
    expect(modeCalls.slice(1)).toEqual([
      { url: VIBE64_LEARNING_ROUTES.learningModeLeave(ATTEMPT), method: "POST", body: {} },
      { url: VIBE64_LEARNING_ROUTES.learningMode, method: "GET", body: undefined }]);
    expect(learning.inLesson).toBe(false);
    expect(learning.learningMode).toMatchObject({ on: false, attemptId: "" });
    expect(Object.hasOwn(learning.learningMode, "paused"), "a lesson is in progress or not").toBe(false);
    expect(learning.notice, "leaving clears the redirect note").toBe("");
    expect(learning.state.modeBusy).toBe("");
    expect(await learning.leaveLesson(), "nothing to leave outside a lesson").toBeNull();
    expect(learning.resumeLearningMode, "there is no paused lesson to re-enter").toBeUndefined();

    // Another tab or device started, then left, the lesson: each learner change rereads the mode here.
    on = true;
    learning.learnerChanged({ learnerId: "learner", attemptId: ATTEMPT, reason: "learning-mode" });
    await flush();
    expect(learning.inLesson).toBe(true);
    on = false;
    const before = modeCalls.length;
    learning.learnerChanged({ learnerId: "learner", attemptId: ATTEMPT, reason: "learning-mode" });
    await flush();
    expect(modeCalls.length).toBe(before + 1);
    expect(learning.inLesson).toBe(false);
    learning.learnerChanged({ reason: "notes" });
    await flush();
    expect(modeCalls.length, "a notes change does not reread the mode").toBe(before + 1);
    learning.clearNotice();
    expect(learning.notice).toBe("");
  });

  it("redirects other projects in learning mode to the lesson's practice project, or the Learning page without one", () => {
    const { learningModeRedirect } = LearningLib;
    const mode = { on: true, practiceSlug: "training-abc", projectSlugs: ["training-abc"] };
    expect(learningModeRedirect({ mode, slug: "my-shop" })).toEqual({ slug: "training-abc", path: "/app/project/training-abc" });
    expect(learningModeRedirect({ mode, slug: "training-abc" })).toBeNull();
    expect(learningModeRedirect({ mode, slug: "" }), "pages outside a project stay").toBeNull();
    expect(learningModeRedirect({ mode: { on: true, practiceSlug: "", projectSlugs: [] }, slug: "my-shop" }),
      "Lesson 0 has no practice project").toEqual({ slug: "", path: "/app/learning" });
    expect(learningModeRedirect({ mode: { on: false }, slug: "my-shop" })).toBeNull();
    expect(learningModeRedirect({ mode: null, slug: "my-shop" })).toBeNull();
  });

  it("minimise keeps the place, L hides and reopens L at the exact step", async () => {
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
    expect(learning.close, "L is the one control that opens and hides Learning").toBeUndefined();
    learning.toggle();
    expect(learning.open).toBe(false);
    expect(learning.minimised, "hiding L with L keeps its place").toBe(true);
    await learning.toggle();
    expect(learning.open).toBe(true);
    expect(learning.stepId).toBe("preview");

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

  it("Show me opens a Database view with the practice project's selected session", async () => {
    const dataStep = { id: "rows", title: "Rows", bodyText: "Look.", required: true, check: { kind: "self" },
      guide: { target: "database-data", navigate: true } };
    const reads = () => { const value = lessonResult(); value.lesson.steps.push(dataStep); return value; };
    const runGuide = vi.fn(async () => ({ guide: { shown: true, step: "database-data" } }));
    // Already on the practice project: its selected session is used directly.
    const here = Vue.shallowRef({ projectSlug: "practice-one", sessionId: "session-b", ready: true });
    const navigateHere = vi.fn();
    const first = controller({ reads, browserNavigation: Vue.shallowRef(navigateHere), colleagueView: here, runGuide });
    first.learning.setViewer("member");
    await first.learning.show({ attemptId: ATTEMPT, stepId: "rows" });
    await first.learning.showMe("rows");
    expect(navigateHere).not.toHaveBeenCalled();
    expect(runGuide.mock.calls[0][0]).toMatchObject({ projectSlug: "practice-one", sessionId: "session-b",
      pane: "database", databaseView: "data", guide: { target: "database-data", navigate: true } });

    // From another page: open the practice project, then use the session it selects.
    const elsewhere = Vue.shallowRef({ projectSlug: "elsewhere", sessionId: "other", ready: true });
    const navigateBrowser = vi.fn(async () => {
      setTimeout(() => { elsewhere.value = { projectSlug: "practice-one", sessionId: "session-a", ready: false }; }, 60);
      return {};
    });
    const second = controller({ reads, browserNavigation: Vue.shallowRef(navigateBrowser), colleagueView: elsewhere, runGuide });
    second.learning.setViewer("member");
    await second.learning.show({ attemptId: ATTEMPT, stepId: "rows" });
    await second.learning.showMe("rows");
    expect(navigateBrowser).toHaveBeenCalledWith({ projectSlug: "practice-one" });
    expect(runGuide.mock.calls[1][0]).toMatchObject({ projectSlug: "practice-one", sessionId: "session-a", databaseView: "data" });
    expect(showMeCommand({ target: "preview", navigate: true }, { projectSlug: "p", sessionId: "s" })).toMatchObject({ sessionId: "s" });
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
    // One injection of the L controller feeds both the step card (E) and Teach me (D).
    expect(colleagueSource).toContain("const learningOwner = inject(VIBE64_LEARNING_KEY, null);");
    expect(colleagueSource).toContain("const learningController = computed(() => unref(learningOwner) || null);");
    expect(colleagueSource).toContain("watchColleagueLearningRequests({ learning: learningController.value");
  });

  it("guides point-only without a practice project or at the L button", () => {
    expect(showMeCommand({ target: "preview", navigate: true }, {})).toEqual({
      guide: { target: "preview", navigate: false, highlight: true, steps: [{ id: "preview", label: "Preview" }], caption: "Preview" } });
    expect(showMeCommand({ target: "learning", navigate: true }, { projectSlug: "practice-one" }).projectSlug).toBeUndefined();
    expect(showMeCommand({ target: "files", navigate: true, filePath: "src/app.js" }, { projectSlug: "p" })).toMatchObject({
      projectSlug: "p", pane: "files", guide: { filePath: "src/app.js", caption: "Dashboard → Files → src/app.js" } });
    expect(() => showMeCommand({ target: "nowhere" })).toThrow("declared Vibe64 guide places");
  });

  it("reads, saves and clears the learner's teacher notes against the shown revision, keeping a retry's request ID", async () => {
    let saved = { text: "", revision: 0, updatedAt: null, updatedBy: null };
    let fail = null;
    const { learning, calls } = controller({
      reads: url => url === VIBE64_LEARNING_ROUTES.notes ? { ok: true, notes: saved } : lessonResult(),
      posts: (url, body) => {
        if (fail) { const error = fail; fail = null; throw error; }
        saved = { text: url === VIBE64_LEARNING_ROUTES.notesClear ? "" : body.text, revision: saved.revision + 1,
          updatedAt: "2026-10-20T10:00:00.000Z", updatedBy: "learner" };
        return { ok: true, notes: saved };
      }
    });
    expect(await learning.readNotes()).toBeNull();
    learning.setViewer("member");
    expect(await learning.readNotes()).toEqual(saved);
    expect(calls[0]).toEqual({ url: VIBE64_LEARNING_ROUTES.notes, method: "GET", body: undefined });
    fail = Object.assign(new Error("The save was not confirmed."), { status: 500 });
    expect(await learning.saveNotes("Likes diagrams.")).toBeNull();
    expect(learning.notesState.error).toBe("The save was not confirmed.");
    await learning.saveNotes("Likes diagrams.");
    const posts = calls.filter(call => call.method === "POST");
    expect(posts[1].body).toEqual({ text: "Likes diagrams.", requestId: posts[0].body.requestId, expectedRevision: 0 });
    expect(learning.notes.value.text).toBe("Likes diagrams.");
    expect(learning.notesState.error).toBe("");
    expect(await learning.saveNotes("")).toBeNull();
    expect(await learning.saveNotes("x".repeat(4001))).toBeNull();
    expect(calls.filter(call => call.method === "POST")).toHaveLength(2);
    // Colleague changed them meanwhile: the refusal shows the current notes and its message.
    saved = { ...saved, text: "Colleague's newer summary.", revision: 5, updatedBy: "colleague" };
    fail = Object.assign(new Error("The notes changed since they were read."), { code: "VIBE64_TRAINING_NOTES_CHANGED", status: 409 });
    expect(await learning.saveNotes("My edit.")).toBeNull();
    expect(learning.notes.value.text).toBe("Colleague's newer summary.");
    expect(learning.notesState.error).toMatch(/changed/u);
    await learning.clearNotes();
    expect(calls.at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.notesClear, method: "POST", body: { expectedRevision: 5 } });
    expect(learning.notes.value.text).toBe("");
    // A read that lands after a newer save never brings back older notes.
    const current = saved;
    saved = { text: "Older summary.", revision: 3, updatedAt: "2026-10-20T09:00:00.000Z", updatedBy: "colleague" };
    await learning.readNotes();
    expect(learning.notes.value).toEqual(current);
    saved = current;
    // A notes notice rereads them; a lesson notice does not; another viewer sees none of them.
    const reads = () => calls.filter(call => call.url === VIBE64_LEARNING_ROUTES.notes && call.method === "GET").length;
    const before = reads();
    await learning.learnerChanged({ reason: "notes" });
    expect(reads()).toBe(before + 1);
    learning.setViewer("someone-else");
    expect(learning.notes.value).toBeNull();
    expect(learning.learnerChanged({ reason: "notes" })).toBeNull();
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

// The shared step view (reader and Colleague's step dialog) with a bounded diagram player.
function stepUi(players) {
  const player = Vue.defineComponent({ props: ["resource", "attemptId"], setup(props, { expose }) {
    const instance = { restores: [], commands: [] };
    players.push(instance);
    expose({ restore: async value => { instance.restores.push(value); }, command: async value => { instance.commands.push(value); } });
    return () => Vue.h("figure");
  } });
  return compiledUi(path.resolve("src/components/learning/Vibe64LearningStep.vue"), {
    vue: Vue,
    "@jskit-ai/http-web/client/lib/httpClient": { getHttpWebClient: () => { throw new Error("stubbed"); } },
    "@local/vibe64-training/client/visual-player": { default: player },
    "@/lib/studioUrls.js": { resolveStudioRequestUrl: url => url },
    "@/lib/vibe64Learning.js": LearningLib,
    "./Vibe64LearningMarkdown.vue": { default: { props: ["text"], setup: props => () => Vue.h("section", { "data-markdown": props.text }) } }
  });
}
const WIDGETS = ["v-btn", "v-alert", "v-skeleton-loader", "v-checkbox", "v-dialog", "v-card", "v-card-title", "v-card-text",
  "v-card-actions", "v-divider", "v-icon", "v-progress-circular"];

async function mountReader(learning, extraProps = {}) {
  const players = [];
  const readVisual = vi.fn(async () => ({ id: "client-server", visual: { id: "client-server", initialState: "idle" } }));
  const reader = compiledUi(path.resolve("src/components/learning/Vibe64LearningReader.vue"), {
    vue: Vue, "vue-router": { useRouter: () => ({ push: vi.fn() }) },
    "@/lib/vibe64ProjectScope.js": { projectAppPath: slug => `/app/project/${slug}` },
    "@/lib/vibe64Learning.js": LearningLib,
    "./Vibe64LearningStep.vue": { default: stepUi(players) },
    "./Vibe64LearningMarkdown.vue": { default: { props: ["text"], setup: props => () => Vue.h("section", { "data-markdown": props.text }) } }
  });
  const root = { children: [] };
  const app = uiRenderer().createApp({ render: () => Vue.h(reader, { learning, learningRevision: 3, readVisual, ...extraProps }) });
  for (const tag of WIDGETS) app.component(tag, widget);
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

  it("keeps the current step in view in the phone's scrolling step row", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "read" });
    const view = await mountReader(learning);
    try {
      // The rendered row has no layout here: give it a phone's overflowing
      // geometry and resolve the current circle from the rendered buttons.
      const row = nodes(view.root).find(node => node.tag === "ol");
      const stepButtons = nodes(view.root).filter(node => node.props?.["data-step-id"]);
      const revealed = [];
      Object.assign(row, { scrollLeft: 0, scrollWidth: 464, clientWidth: 366, getBoundingClientRect: () => ({ left: 12, right: 378 }),
        querySelector: selector => {
          const current = stepButtons.find(button => button.props["aria-current"] === "step");
          if (selector !== '[aria-current="step"]' || !current) return null;
          revealed.push(current.props["data-step-id"]);
          return { getBoundingClientRect: () => ({ left: 428, right: 476 }) };
        } });
      stepButtons[3].props.onClick();
      await flush();
      expect(revealed).toEqual([stepButtons[3].props["data-step-id"]]);
      expect(row.scrollLeft).toBe(98);
      // Reopening L brings the current step back into view as well.
      learning.minimise();
      await flush();
      await learning.show();
      await flush();
      expect(revealed).toEqual([stepButtons[3].props["data-step-id"], stepButtons[3].props["data-step-id"]]);
    } finally { view.app.unmount(); }
  });

  it("shows why an automatic check did not pass without changing the step status", async () => {
    const reason = "No App interaction has been captured for this step yet. Press the App's control in this lesson's Preview first.";
    const { learning, calls } = controller({ posts: () => ({ ok: true, stepId: "preview", outcome: "not-yet-passed", recorded: false, reason }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "preview" });
    const view = await mountReader(learning);
    try {
      expect(byTest(view.root, "learning-check-reason")).toBeUndefined();
      byTest(view.root, "learning-check").props.onClick();
      await flush(); await flush();
      expect(calls.find(call => call.method === "POST")).toMatchObject({ url: VIBE64_LEARNING_ROUTES.stepCheck(ATTEMPT), body: { stepId: "preview" } });
      expect(textOf(byTest(view.root, "learning-check-reason"))).toBe(reason);
      expect(textOf(byTest(view.root, "learning-step-status"))).toContain("Not checked yet");
      // A realtime reread of the same step keeps the reason; another step clears it.
      await learning.learnerChanged({ attemptId: ATTEMPT });
      await flush(); await flush();
      expect(textOf(byTest(view.root, "learning-check-reason"))).toBe(reason);
      learning.selectStep("tick");
      await flush();
      expect(byTest(view.root, "learning-check-reason")).toBeUndefined();
    } finally { view.app.unmount(); }
  });

  it("says an answer or check on a step already passed was not checked again, instead of a bare Passed", async () => {
    const note = "You already passed this step, so this was not checked again. Your earlier pass counts.";
    const { learning, calls } = controller({ reads: () => lessonResult({ passedStepIds: ["quiz", "preview"] }),
      posts: (_url, body) => ({ ok: true, stepId: body.stepId, outcome: "passed", recorded: false, replayed: false, alreadyPassed: true }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "quiz" });
    const view = await mountReader(learning);
    try {
      nodes(view.root).filter(node => node.tag === "div" && node.props?.label)[0].props["onUpdate:modelValue"](true);
      await flush();
      byTest(view.root, "learning-answer").props.onClick();
      await flush(); await flush();
      expect(calls.find(call => call.method === "POST")).toMatchObject({ url: VIBE64_LEARNING_ROUTES.stepAnswer(ATTEMPT), body: { stepId: "quiz", selected: [0] } });
      expect(textOf(byTest(view.root, "learning-check-reason"))).toBe(note);
      expect(textOf(byTest(view.root, "learning-step-status"))).toContain("Passed");
      learning.selectStep("preview");
      await flush();
      expect(byTest(view.root, "learning-check-reason")).toBeUndefined();
      byTest(view.root, "learning-check").props.onClick();
      await flush(); await flush();
      expect(textOf(byTest(view.root, "learning-check-reason"))).toBe(note);
    } finally { view.app.unmount(); }
  });

  it("tells a code step's learner that saving does not check it, unlike an App interaction step", async () => {
    const codeStep = { id: "code", title: "Code", bodyText: "Change it.", required: true,
      check: { kind: "auto", check: "greeting-count", files: ["greeting.mjs"] } };
    const reads = () => { const value = lessonResult(); value.lesson.steps.push(codeStep); return value; };
    const { learning } = controller({ reads });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "preview" });
    const view = await mountReader(learning);
    const checkText = () => textOf(nodes(view.root).find(node => node.props?.["aria-label"] === "Automatic check"));
    try {
      expect(checkText()).toContain("checked automatically when you do it in your practice project");
      learning.selectStep("code");
      await flush();
      expect(checkText()).toContain("Make this change yourself in Dashboard → Files. Saving does not check it: press Check now");
      expect(checkText()).not.toContain("checked automatically");
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
      // No invented snapshot: the player restarts at the declared initial state
      // with the controller's own labels (a controller rejects other label sets).
      expect(view.players[0].restores).toEqual([undefined]);
      expect(view.players[0].commands.map(command => command.name)).toEqual(["showOverview", "highlight"]);
      expect(view.players[0].commands[1].parameters).toEqual({ part: "server" });
      expect(new Set(view.players[0].commands.map(command => command.commandId)).size).toBe(2);
      // A realtime reread of the same step (the reader's own scroll save emits
      // one) neither remounts the playing diagram nor jumps the scroll back.
      const article = nodes(view.root).find(node => node.tag === "article");
      article.scrollTop = 500;
      await learning.learnerChanged({ attemptId: ATTEMPT });
      await flush(); await flush();
      expect(view.players).toHaveLength(1);
      expect(view.readVisual).toHaveBeenCalledTimes(1);
      expect(article.scrollTop).toBe(500);
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

  it("does not compare a passed question again and says so instead of showing a verdict", async () => {
    const { learning } = controller({ reads: () => lessonResult({ results: [{ stepId: "quiz", outcome: "passed" }] }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "quiz" });
    const view = await mountReader(learning);
    try {
      expect(textOf(byTest(view.root, "learning-answer-kept"))).toContain("You already passed this question");
      const options = nodes(view.root).filter(node => node.tag === "div" && node.props?.label);
      options[0].props["onUpdate:modelValue"](true);
      await flush();
      expect(byTest(view.root, "learning-answer").props.disabled).toBe(true);
      expect(textOf(byTest(view.root, "learning-step-status"))).toContain("Passed");
    } finally { view.app.unmount(); }
  });

  it("shows a passed question's saved selection from its recorded evidence, also in a fresh browser", async () => {
    const { learning } = controller({ reads: () => lessonResult({ results: [
      { stepId: "quiz", kind: "choice", outcome: "not-yet-passed", evidence: { selected: [1] } },
      { stepId: "quiz", kind: "choice", outcome: "passed", evidence: { selected: [0, 2] } }] }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "read" });
    const view = await mountReader(learning);
    const checked = () => nodes(view.root).filter(node => node.tag === "div" && node.props?.label).map(node => node.props["model-value"] ?? node.props.modelValue);
    try {
      learning.selectStep("quiz");
      await flush();
      expect(checked()).toEqual([true, false, true]);
      expect(byTest(view.root, "learning-answer").props.disabled).toBe(true);
      // A realtime reread keeps it; another step and back shows it again.
      await learning.learnerChanged({ attemptId: ATTEMPT });
      await flush();
      expect(checked()).toEqual([true, false, true]);
      learning.selectStep("tick");
      await flush();
      learning.selectStep("quiz");
      await flush();
      expect(checked()).toEqual([true, false, true]);
    } finally { view.app.unmount(); }
  });

  it("leaves a self step's instruction to the lesson and says when an earlier attempt already passed it", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "tick" });
    const view = await mountReader(learning);
    const selfText = () => textOf(nodes(view.root).find(node => node.props?.["aria-label"] === "Self check"));
    try {
      expect(selfText()).not.toContain("mark it done");
      expect(byTest(view.root, "learning-done-kept")).toBeUndefined();
      expect(byTest(view.root, "learning-done").props.disabled).toBe(false);
    } finally { view.app.unmount(); }

    const retake = controller({ reads: () => lessonResult({ passedStepIds: ["tick"] }) });
    retake.learning.setViewer("member");
    await retake.learning.show({ attemptId: ATTEMPT, stepId: "tick" });
    const again = await mountReader(retake.learning);
    try {
      expect(textOf(byTest(again.root, "learning-done-kept"))).toContain("You already passed this step");
      expect(byTest(again.root, "learning-done").props.disabled).toBe(true);
    } finally { again.app.unmount(); }
  });

  it("opens the Lesson finished screen again from a complete lesson's reader", async () => {
    const passed = ["quiz", "preview", "tick"].map(stepId => ({ stepId, outcome: "passed" }));
    const { learning, calls } = controller({ reads: () => lessonResult({ results: passed }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "read" });
    const view = await mountReader(learning);
    try {
      expect(textOf(view.root)).toContain("This lesson is complete.");
      expect(learning.finished).toBe(false);
      await byTest(view.root, "learning-finish").props.onClick();
      await flush();
      expect(learning.finished).toBe(true);
      expect(learning.surface).toBe("lesson");
      expect(learning.open).toBe(true);
      expect(calls.filter(call => call.method === "POST"), "the finished screen ends the lesson, not the reader").toEqual([]);
    } finally { view.app.unmount(); }
  });

  it("offers no Finish lesson before every required step has passed", async () => {
    const { learning } = controller({ reads: () => lessonResult({ results: [{ stepId: "quiz", outcome: "passed" }] }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "read" });
    const view = await mountReader(learning);
    try { expect(byTest(view.root, "learning-finish")).toBeUndefined(); } finally { view.app.unmount(); }
  });
});

describe("Learning overlay", () => {
  it("binds the signed-in viewer, mounts one guide overlay, opens courses and the reader, and hides on Escape or its own L", async () => {
    let modeOn = true;
    let practiceSlug = "training-1111";
    const { learning, modeCalls } = controller({ mode: (url, method) => {
      if (method === "POST") modeOn = false;
      return modeOn ? { on: true, attemptId: ATTEMPT, lessonTitle: "Orientation", practiceSlug,
        projectSlugs: practiceSlug ? [practiceSlug] : [] } : { on: false };
    } });
    const route = Vue.reactive({ path: "/app/project/my-shop/dashboard", fullPath: "/app/project/my-shop/dashboard", params: { slug: "my-shop" } });
    const replace = vi.fn(async path => { Object.assign(route, { path, fullPath: path, params: { slug: path.split("/")[3] || "" } }); });
    const realtime = [];
    const coursesOptions = [];
    const courses = { learningResource: { data: Vue.ref({ ok: true, revision: 9 }), reload: vi.fn() } };
    const HostKeys = await import("../../src/lib/vibe64AssistantHost.js");
    const LearnerEvents = await import("../../packages/vibe64-training/src/shared/learnerEvents.js");
    const overlay = compiledUi(path.resolve("src/components/learning/Vibe64LearningOverlay.vue"), {
      vue: Vue,
      "vue-router": { useRoute: () => route, useRouter: () => ({ replace }) },
      "@/lib/vibe64ProjectScope.js": { projectSlugFromRoute: value => String(value?.params?.slug || "") },
      "@/lib/vibe64PracticeProjectName.js": { isPracticeProjectSlug: slug => slug.startsWith("training-") },
      "@/lib/vibe64Learning.js": LearningLib,
      "@jskit-ai/realtime/client/composables/useRealtimeEvent": { useRealtimeEvent: options => realtime.push(options) },
      "@local/vibe64-training/client/guide-overlay": { default: { render: () => Vue.h("aside", { "data-guide-overlay": "mounted" }) } },
      "@local/vibe64-training/shared/learner-events": LearnerEvents,
      "@/lib/vibe64AssistantHost.js": HostKeys,
      "@/composables/useVibe64Learning.js": { useVibe64Learning: () => learning },
      "@/composables/useVibe64LearningCourses.js": { useVibe64LearningCourses: options => { coursesOptions.push(options); return courses; } },
      "./Vibe64LearningCourses.vue": { default: { props: { learning: Object }, emits: ["opened"],
        setup: (props, { emit }) => () => Vue.h("section", { "data-test": "courses", own: props.learning === courses,
          onClick: () => emit("opened", { attemptId: ATTEMPT }) }) } },
      "./Vibe64LearningFinished.vue": { default: { props: ["learning", "courses", "learningRevision"],
        setup: props => () => Vue.h("section", { "data-test": "finished", revision: props.learningRevision }) } },
      "./Vibe64LearningReader.vue": { default: { props: ["learning"],
        setup: props => () => Vue.h("article", { "data-test": "reader", own: props.learning === learning }) } },
      "./Vibe64LearningTeacherNotes.vue": { default: { props: ["learning"],
        setup: props => () => Vue.h("aside", { "data-test": "teacher-notes", own: props.learning === learning }) } },
      "./Vibe64LearningPractice.vue": { default: { props: ["learning", "learningRevision"],
        setup: props => () => Vue.h("aside", { "data-test": "practice", own: props.learning === learning, revision: props.learningRevision }) } }
    });
    const bodyClasses = new Set();
    vi.stubGlobal("document", { activeElement: null, body: { classList: {
      toggle: (name, on) => { if (on) bodyClasses.add(name); else bodyClasses.delete(name); },
      remove: name => bodyClasses.delete(name) } } });
    const viewer = Vue.ref({ actorKey: "member" });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(overlay) });
    app.provide(HostKeys.VIBE64_ASSISTANT_VIEWER_KEY, viewer);
    for (const tag of ["v-btn", "v-snackbar"]) app.component(tag, widget);
    app.mount(root);
    try {
      await flush();
      expect(learning.state.actorKey).toBe("member");
      // Learning mode: another project's URL goes to the lesson's practice project, with the note.
      expect(replace).toHaveBeenCalledWith("/app/project/training-1111");
      expect(replace).toHaveBeenCalledTimes(1);
      expect(learning.notice).toBe(LearningLib.VIBE64_LEARNING_MODE_NOTE);
      expect(byTest(root, "learning-mode-notice").props["model-value"]).toBe(true);
      expect(nodes(root).filter(node => node.props?.["data-guide-overlay"])).toHaveLength(1);
      expect(byTest(root, "courses")).toBeUndefined();
      expect(realtime[0].event).toBe("vibe64.training.learner.changed");
      expect(coursesOptions[0].active.value).toBe(false);
      await learning.show();
      await flush();
      expect(coursesOptions[0].active.value).toBe(true);
      const layer = nodes(root).find(node => node.props?.role === "dialog");
      expect(layer.props["aria-label"]).toBe("Learning");
      expect(byTest(root, "courses").props.own, "the courses surface reads L's own courses adapter").toBe(true);
      expect(byTest(root, "teacher-notes").props.own, "the courses surface shows this learner's teacher notes").toBe(true);
      expect(byTest(root, "practice"), "practice projects have their own tab").toBeUndefined();
      byTest(root, "learning-practice-tab").props.onClick();
      await flush();
      expect(learning.surface).toBe("practice");
      expect(byTest(root, "practice").props.own).toBe(true);
      expect(byTest(root, "practice").props.revision, "Open continues against the saved learning revision").toBe(9);
      byTest(root, "learning-courses-tab").props.onClick();
      await flush();
      byTest(root, "courses").props.onClick();
      await flush();
      expect(learning.surface).toBe("lesson");
      expect(byTest(root, "reader").props.own).toBe(true);
      expect(byTest(root, "learning-minimise"), "L itself hides Learning").toBeUndefined();
      expect(byTest(root, "learning-close")).toBeUndefined();
      const hide = byTest(root, "learning-hide");
      expect(hide.props["aria-label"]).toBe("Hide Learning");
      expect(hide.props.title).toBe("Hide Learning (your place is kept)");
      hide.props.onClick();
      await flush();
      expect(learning.open).toBe(false);
      expect(learning.minimised).toBe(true);
      expect(learning.hiddenBy, "the header L is the learner's own hide").toBe("learner");
      await learning.show();
      await flush();
      expect(learning.surface, "L returns to exactly where the learner was").toBe("lesson");
      expect(bodyClasses.has("vibe64-in-lesson"), "the app bar stays yellow in a lesson").toBe(true);
      // Leave lesson in L's header ends the lesson and learning mode, hides L and
      // leaves the practice project for /app.
      await byTest(root, "learning-header-leave").props.onClick();
      await flush();
      expect(modeCalls.some(call => call.url === VIBE64_LEARNING_ROUTES.learningModeLeave(ATTEMPT))).toBe(true);
      expect(bodyClasses.has("vibe64-in-lesson"), "leaving returns the app bar to normal").toBe(false);
      expect(learning.open).toBe(false);
      expect(byTest(root, "learning-header-leave")).toBeUndefined();
      expect(replace).toHaveBeenLastCalledWith("/app");
      Object.assign(route, { path: "/app/project/my-shop", fullPath: "/app/project/my-shop", params: { slug: "my-shop" } });
      await flush();
      expect(replace, "out of learning mode every project opens").toHaveBeenCalledTimes(2);
      // Continuing the lesson elsewhere (another tab or Colleague) turns learning mode on again here.
      modeOn = true;
      learning.learnerChanged({ attemptId: ATTEMPT, reason: "learning-mode" });
      await flush();
      expect(replace).toHaveBeenLastCalledWith("/app/project/training-1111");
      await learning.show();
      await flush();
      layer.props.onKeydown({ key: "Escape", defaultPrevented: false, stopPropagation() {} });
      await flush();
      expect(learning.open).toBe(false);
      expect(learning.hiddenBy, "Escape is the learner's own hide").toBe("learner");
      expect(learning.minimised, "Escape keeps the place").toBe(true);
      // Kept mounted (hidden) so the place stays exactly as it was.
      expect(byTest(root, "reader")).toBeTruthy();
      // A lesson without a practice project lives on the Learning page; leaving
      // it returns to /app, where the projects are.
      practiceSlug = "";
      learning.learnerChanged({ attemptId: ATTEMPT, reason: "learning-mode" });
      await flush();
      expect(replace).toHaveBeenLastCalledWith(LearningLib.VIBE64_LEARNING_PAGE_PATH);
      await learning.leaveLesson();
      await flush();
      expect(replace).toHaveBeenLastCalledWith("/app");
      viewer.value = { actorKey: "someone-else" };
      await flush();
      expect(learning.attemptId).toBe("");
    } finally { app.unmount(); vi.unstubAllGlobals(); }
    expect(learning.state.actorKey).toBe("");
    expect(bodyClasses.has("vibe64-in-lesson"), "leaving the host clears the yellow bar").toBe(false);
  });
});

describe("L's Practice tab", () => {
  it("lists practice projects with lesson and status, opens one into its lesson over minimised L, and archives or deletes with one click", async () => {
    const opened = { attemptId: OTHER };
    const { learning, modeCalls } = controller({ mode: () => ({ on: true, attemptId: OTHER, practiceSlug: "training-mine", projectSlugs: ["training-mine"] }) });
    learning.setViewer("member");
    await learning.show({ surface: "practice" });
    const practiceOptions = [];
    const projects = Vue.ref([
      { practiceId: ATTEMPT, slug: "training-mine", name: "Practice: Orientation", status: "not-finished", statusLabel: "Not finished" },
      { practiceId: OTHER, slug: "training-gone", name: "Practice: Your first change", status: "deleting", statusLabel: "Being deleted" }
    ]);
    const archived = Vue.ref([{ practiceId: "33333333-3333-4333-8333-333333333333", archiveId: "20261020T101500Z-training-old",
      name: "Practice: Old lesson", archivedAt: "2026-10-20T10:15:00.000Z" }]);
    const practice = { projects, archived, loaded: Vue.ref(true), loadError: Vue.ref(""), busy: Vue.ref(""), error: Vue.ref(""),
      open: vi.fn(async () => ({ ok: true, attempt: opened })), archive: vi.fn(async () => ({ ok: true })),
      remove: vi.fn(async () => ({ ok: true })), removeArchive: vi.fn(async () => ({ ok: true })) };
    const push = vi.fn();
    const panel = compiledUi(path.resolve("src/components/learning/Vibe64LearningPractice.vue"), {
      vue: Vue, "vue-router": { useRouter: () => ({ push }) }, "@mdi/js": { mdiDeleteOutline: "trash", mdiArchiveArrowDownOutline: "archive" },
      "@/lib/vibe64ProjectScope.js": { projectAppPath: slug => `/app/project/${slug}` },
      "@/composables/useVibe64PracticeProjects.js": { useVibe64PracticeProjects: options => { practiceOptions.push(options); return practice; } }
    });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(panel, { learning, learningRevision: 7 }) });
    for (const tag of ["v-btn", "v-alert"]) app.component(tag, widget);
    app.mount(root);
    try {
      await flush();
      expect(practiceOptions[0].enabled.value, "practice.list is read only while L is open").toBe(true);
      expect(nodes(root).filter(node => node.props?.["data-practice-id"]).map(node => node.props["data-practice-id"])).toEqual([ATTEMPT, OTHER]);
      expect(textOf(root)).toContain("Practice: Orientation");
      expect(textOf(root)).toContain("Not finished");
      // A project in deletion offers only Delete.
      expect(nodes(root).filter(node => node.props?.["data-test"] === "learning-practice-open")).toHaveLength(1);
      expect(nodes(root).filter(node => node.props?.["data-test"] === "learning-practice-archive")).toHaveLength(1);
      expect(nodes(root).filter(node => node.props?.["data-test"] === "learning-practice-delete")).toHaveLength(2);
      const archivedList = byTest(root, "learning-practice-archived");
      expect(textOf(archivedList)).toContain("Practice: Old lesson");
      expect(textOf(archivedList)).toContain("Archived");
      byTest(root, "learning-practice-archive").props.onClick();
      expect(practice.archive).toHaveBeenCalledWith(projects.value[0]);
      nodes(root).filter(node => node.props?.["data-test"] === "learning-practice-delete")[1].props.onClick();
      expect(practice.remove).toHaveBeenCalledWith(projects.value[1]);
      byTest(root, "learning-practice-archive-delete").props.onClick();
      expect(practice.removeArchive).toHaveBeenCalledWith(archived.value[0]);
      await byTest(root, "learning-practice-open").props.onClick();
      await flush();
      expect(practice.open).toHaveBeenCalledWith(projects.value[0], { expectedRevision: 7 });
      expect(modeCalls.at(-1), "opening turns learning mode on; it is reread").toMatchObject({ method: "GET" });
      expect(learning.attemptId, "L follows the continued attempt").toBe(OTHER);
      expect(learning.open, "the project shows with L minimised on the current step").toBe(false);
      expect(learning.minimised).toBe(true);
      expect(push).toHaveBeenCalledWith("/app/project/training-mine");
      projects.value = [];
      archived.value = [];
      await flush();
      expect(byTest(root, "learning-practice-empty")).toBeTruthy();
    } finally { app.unmount(); }
  });

  it("stays on the Practice tab when opening is refused", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await learning.show({ surface: "practice" });
    const practice = { projects: Vue.ref([{ practiceId: ATTEMPT, slug: "training-mine", name: "Practice: Orientation", status: "finished", statusLabel: "Finished" }]),
      archived: Vue.ref([]), loaded: Vue.ref(true), loadError: Vue.ref(""), busy: Vue.ref(""), error: Vue.ref("Refused."),
      open: vi.fn(async () => null) };
    const push = vi.fn();
    const panel = compiledUi(path.resolve("src/components/learning/Vibe64LearningPractice.vue"), {
      vue: Vue, "vue-router": { useRouter: () => ({ push }) }, "@mdi/js": { mdiDeleteOutline: "trash", mdiArchiveArrowDownOutline: "archive" },
      "@/lib/vibe64ProjectScope.js": { projectAppPath: slug => `/app/project/${slug}` },
      "@/composables/useVibe64PracticeProjects.js": { useVibe64PracticeProjects: () => practice }
    });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(panel, { learning, learningRevision: 7 }) });
    for (const tag of ["v-btn", "v-alert"]) app.component(tag, widget);
    app.mount(root);
    try {
      await flush();
      await byTest(root, "learning-practice-open").props.onClick();
      await flush();
      expect(push).not.toHaveBeenCalled();
      expect([learning.open, learning.surface]).toEqual([true, "practice"]);
      expect(textOf(byTest(root, "learning-practice-error"))).toContain("Refused.");
    } finally { app.unmount(); }
  });
});

describe("What my teacher knows about me", () => {
  it("reads the learner's notes, edits them and clears them only after a second confirmation", async () => {
    let saved = { text: "Prefers **short** steps.", revision: 2, updatedAt: "2026-10-20T10:00:00.000Z", updatedBy: "colleague" };
    const { learning, calls } = controller({
      reads: () => ({ ok: true, notes: saved }),
      posts: (url, body) => {
        saved = { text: url === VIBE64_LEARNING_ROUTES.notesClear ? "" : body.text, revision: saved.revision + 1,
          updatedAt: "2026-10-20T11:00:00.000Z", updatedBy: "learner" };
        return { ok: true, notes: saved };
      }
    });
    learning.setViewer("member");
    const panel = compiledUi(path.resolve("src/components/learning/Vibe64LearningTeacherNotes.vue"), {
      vue: Vue, "@/lib/vibe64Learning.js": LearningLib,
      "./Vibe64LearningMarkdown.vue": { default: { props: ["text"], setup: props => () => Vue.h("section", { "data-markdown": props.text }) } }
    });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(panel, { learning }) });
    for (const tag of ["v-btn", "v-alert", "v-textarea"]) app.component(tag, widget);
    app.mount(root);
    try {
      await flush();
      expect(textOf(root)).toContain("What my teacher knows about me");
      expect(textOf(root)).toContain("Only you can see it");
      expect(nodes(root).find(node => node.props?.["data-markdown"])?.props["data-markdown"]).toBe("Prefers **short** steps.");
      expect(textOf(root)).toContain("Updated by Colleague");
      byTest(root, "teacher-notes-edit").props.onClick();
      await flush();
      const draft = byTest(root, "teacher-notes-draft");
      expect(draft.props.modelValue).toBe("Prefers **short** steps.");
      expect(draft.props.counter).toBe(4000);
      draft.props["onUpdate:modelValue"]("I like diagrams.");
      await flush();
      byTest(root, "teacher-notes-save").props.onClick();
      await flush();
      expect(calls.at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.notes, method: "POST", body: { text: "I like diagrams.", expectedRevision: 2 } });
      expect(byTest(root, "teacher-notes-draft")).toBeUndefined();
      expect(textOf(root)).toContain("Updated by you");
      byTest(root, "teacher-notes-clear").props.onClick();
      await flush();
      expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
      byTest(root, "teacher-notes-clear-confirm").props.onClick();
      await flush();
      expect(calls.at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.notesClear, method: "POST", body: { expectedRevision: 3 } });
      expect(byTest(root, "teacher-notes-empty")).toBeTruthy();
    } finally { app.unmount(); }
  });
});

describe("Lesson text links", () => {
  const browser = { location: { href: "https://vibe64.example/app/project/demo", origin: "https://vibe64.example" }, open: vi.fn() };
  const click = (href, extra = {}) => ({ button: 0, defaultPrevented: false, preventDefault: vi.fn(), ...extra,
    target: { closest: selector => (selector === "a[href]" && href !== null ? { getAttribute: () => href } : null) } });
  beforeEach(() => browser.open.mockClear());

  it("opens a link to another site in a new tab so the lesson stays open", () => {
    const event = click("https://z.ai/manage-apikey/apikey-list");
    expect(openLessonLink(event, browser)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(browser.open).toHaveBeenCalledExactlyOnceWith("https://z.ai/manage-apikey/apikey-list", "_blank", "noopener,noreferrer");
  });

  it("keeps the default for Vibe64 links, other schemes, modified clicks and text", () => {
    for (const event of [click("/app/project/other"), click("mailto:help@example.com"), click("https://z.ai/", { ctrlKey: true }),
      click("https://z.ai/", { button: 1 }), click(null)]) {
      expect(openLessonLink(event, browser)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(browser.open).not.toHaveBeenCalled();
  });
});

describe("Phone step row", () => {
  // The phone walk of V64-START-00: Next to step 9 of 9 left the current step
  // at 428-476px in a 390px-wide row. The row now follows the current step.
  const row = ({ left, right, scrollLeft = 0, scrollWidth = 464, clientWidth = 366 }) => {
    const list = { scrollLeft, scrollWidth, clientWidth, getBoundingClientRect: () => ({ left: 12, right: 378 }),
      querySelector: selector => (selector === '[aria-current="step"]' ? { getBoundingClientRect: () => ({ left, right }) } : null) };
    return list;
  };

  it("scrolls the row just enough to show a current step past either edge", () => {
    const pastEnd = row({ left: 428, right: 476 });
    expect(revealCurrentStep(pastEnd)).toBe(true);
    expect(pastEnd.scrollLeft).toBe(98);
    const beforeStart = row({ left: -40, right: 8, scrollLeft: 98 });
    expect(revealCurrentStep(beforeStart)).toBe(true);
    expect(beforeStart.scrollLeft).toBe(46);
  });

  it("leaves a visible step, a row that does not overflow and a missing row alone", () => {
    const visible = row({ left: 100, right: 148, scrollLeft: 5 });
    expect(revealCurrentStep(visible)).toBe(false);
    expect(visible.scrollLeft).toBe(5);
    const desktop = row({ left: 428, right: 476, scrollWidth: 300, clientWidth: 300 });
    expect(revealCurrentStep(desktop)).toBe(false);
    expect(desktop.scrollLeft).toBe(0);
    expect(revealCurrentStep(null)).toBe(false);
    expect(revealCurrentStep({ querySelector: () => null })).toBe(false);
  });
});

describe("The current lesson's linear flow", () => {
  const passedAll = ["quiz", "preview", "tick"].map(stepId => ({ stepId, outcome: "passed" }));

  it("opens L on the Lesson finished screen when the learner's own step result completes the lesson, only then", async () => {
    let results = passedAll.slice(0, 2);
    const { learning } = controller({ reads: () => lessonResult({ results }),
      posts: () => { results = passedAll; return { ok: true, outcome: "passed" }; } });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "tick" });
    learning.minimise();
    expect(learning.complete).toBe(false);
    await learning.done("tick");
    await flush();
    expect(learning.complete).toBe(true);
    expect([learning.open, learning.surface, learning.finished]).toEqual([true, "lesson", true]);
    // A later result on a lesson already complete opens nothing.
    learning.closeFinished();
    learning.minimise();
    await learning.done("read");
    await flush();
    expect([learning.open, learning.finished]).toEqual([false, false]);
  });

  async function mountDialog(learning) {
    const players = [];
    const dialog = compiledUi(path.resolve("src/components/learning/Vibe64LearningStepDialog.vue"), {
      vue: Vue, "@mdi/js": { mdiClose: "close", mdiOpenInNew: "open" }, "./Vibe64LearningStep.vue": { default: stepUi(players) } });
    const events = [];
    const root = { children: [] };
    const readVisual = vi.fn(async () => ({ id: "client-server", visual: { id: "client-server", initialState: "idle" } }));
    const app = uiRenderer().createApp({ render: () => Vue.h(dialog, { modelValue: true, learning, readVisual,
      "onUpdate:modelValue": value => events.push(["model", value]), onOpenLearning: () => events.push(["open-learning"]),
      onLeave: kind => events.push(["leave", kind]), onReturn: () => events.push(["return"]) }) });
    for (const tag of WIDGETS) app.component(tag, widget);
    app.mount(root);
    await flush();
    return { app, root, events };
  }

  it("shows only the current step, with Next once it is passed or optional, through the shared controller", async () => {
    let results = [];
    const { learning, calls } = controller({ reads: () => lessonResult({ results }),
      posts: (_url, body) => { results = [...results, { stepId: body.stepId, outcome: "passed", kind: "choice", evidence: { selected: [1] } }]; return { ok: true }; } });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "read" });
    learning.minimise();
    const view = await mountDialog(learning);
    try {
      expect(textOf(view.root)).toContain("Step 1 of 4");
      expect(textOf(view.root)).toContain("Orientation");
      expect(nodes(view.root).some(node => node.props?.["data-step-id"]), "no step list: that is L").toBe(false);
      expect(byTest(view.root, "learning-next").props.disabled, "an optional step can be left").toBe(false);
      byTest(view.root, "learning-next").props.onClick();
      await flush();
      expect(learning.stepId).toBe("quiz");
      expect(byTest(view.root, "learning-next").props.disabled, "a required step is passed first").toBe(true);
      nodes(view.root).filter(node => node.tag === "div" && node.props?.label)[1].props["onUpdate:modelValue"](true);
      await flush();
      await byTest(view.root, "learning-answer").props.onClick();
      await flush();
      expect(calls.filter(call => call.method === "POST").at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.stepAnswer(ATTEMPT), body: { stepId: "quiz", selected: [1] } });
      expect(byTest(view.root, "learning-next").props.disabled).toBe(false);
      byTest(view.root, "learning-previous").props.onClick();
      await flush();
      expect(learning.stepId).toBe("read");
      byTest(view.root, "learning-step-open-l").props.onClick();
      expect(view.events).toContainEqual(["open-learning"]);
    } finally { view.app.unmount(); }
  });

  it("hides for Show me and Teach me, and comes back with the reason when Show me cannot show its place", async () => {
    const runGuide = vi.fn(async () => ({ guide: { shown: false } }));
    const { learning } = controller({ runGuide });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "preview" });
    learning.minimise();
    const view = await mountDialog(learning);
    try {
      await byTest(view.root, "learning-show-me").props.onClick();
      await flush();
      expect(runGuide).toHaveBeenCalledOnce();
      expect(view.events).toEqual([["leave", "show-me"], ["return"]]);
      expect(textOf(view.root)).toContain("That place is not visible on this page.");
      expect(learning.open, "Show me from the dialog does not open L").toBe(false);
      byTest(view.root, "learning-teach-me").props.onClick();
      expect(view.events.at(-1)).toEqual(["leave", "teach-me"]);
      expect(learning.colleagueRequest.value).toMatchObject({ stepId: "preview", message: VIBE64_LEARNING_TEACH_MESSAGE });
    } finally { view.app.unmount(); }
  });

  it("offers Finish lesson on the last step of a complete lesson", async () => {
    const { learning } = controller({ reads: () => lessonResult({ results: passedAll }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "tick" });
    learning.minimise();
    const view = await mountDialog(learning);
    try {
      expect(byTest(view.root, "learning-next")).toBeUndefined();
      await byTest(view.root, "learning-finish").props.onClick();
      await flush();
      expect([learning.open, learning.finished]).toEqual([true, true]);
    } finally { view.app.unmount(); }
  });
});

describe("Lesson finished screen", () => {
  const practiceFake = () => ({ projects: Vue.ref([{ practiceId: ATTEMPT, slug: "training-1111" }]), loaded: Vue.ref(true),
    busy: Vue.ref(""), error: Vue.ref(""), archive: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => ({ ok: true })) });
  const COURSE = { courseId: "getting-started", release: "0.2.0", title: "Getting started", enabled: true, status: "released", topics: [],
    lessons: [{ code: "V64-START-01", hash: "h1", title: "Orientation", status: "published", required: true },
      { code: "V64-START-02", hash: "h2", title: "Your first change", status: "published", required: true }] };
  const pin = { course: { courseId: COURSE.courseId, release: COURSE.release }, lesson: { code: "V64-START-01", hash: "h1" } };

  it("finishes the lesson once, then keeps the practice project, starts the next lesson or returns to Courses", async () => {
    let ended = false;
    const passed = ["quiz", "preview", "tick"].map(stepId => ({ stepId, outcome: "passed" }));
    const { learning, calls } = controller({
      reads: () => lessonResult({ results: passed, attempt: { attemptId: ATTEMPT, ended, practiceSlug: "training-1111", pin } }),
      posts: url => { ended = url === VIBE64_LEARNING_ROUTES.lessonEnd(ATTEMPT) ? { reason: "finished" } : ended; return { ok: true, available: true }; } });
    learning.setViewer("member");
    await learning.showFinished();
    await learning.show({ attemptId: ATTEMPT });
    await learning.showFinished();
    expect(learning.finished).toBe(true);
    const saved = Vue.ref({ ok: true, available: true, revision: 3, active: { attemptId: ATTEMPT, pin }, history: [],
      lessonProgress: [{ lessonCode: "V64-START-01", lessonHash: "h1", required: 3, passed: 3, completed: true, open: false }] });
    const startLesson = vi.fn(async () => ({ attemptId: OTHER, current: true }));
    const courses = { learningResource: { data: saved, reload: vi.fn(async () => { saved.value = { ...saved.value, revision: 4, active: null }; }) },
      coursesResource: { data: Vue.ref({ ok: true, available: true, courses: [COURSE] }) }, busy: Vue.ref(false), starting: Vue.ref(false), startLesson };
    const practice = practiceFake();
    const finished = compiledUi(path.resolve("src/components/learning/Vibe64LearningFinished.vue"), {
      vue: Vue, "@mdi/js": { mdiCheckCircle: "check" },
      "@local/vibe64-training/client/course-progress": await import("../../packages/vibe64-training/src/client/courseProgress.js"),
      "@/composables/useVibe64PracticeProjects.js": { useVibe64PracticeProjects: () => practice }
    });
    const root = { children: [] };
    const onEnded = vi.fn(() => courses.learningResource.reload());
    const app = uiRenderer().createApp({ render: () => Vue.h(finished, { learning, courses, learningRevision: 3, onEnded }) });
    for (const tag of WIDGETS) app.component(tag, widget);
    app.mount(root);
    try {
      await flush(); await flush();
      const ends = calls.filter(call => call.method === "POST" && call.url === VIBE64_LEARNING_ROUTES.lessonEnd(ATTEMPT));
      expect(ends).toEqual([expect.objectContaining({ body: { expectedRevision: 3, requestId: expect.any(String), reason: "finished" } })]);
      expect(onEnded).toHaveBeenCalledOnce();
      expect(learning.state.attemptId).toBe(ATTEMPT);
      expect(textOf(root)).toContain("Lesson finished");
      expect(textOf(root)).toContain("3 of 4 steps passed");
      byTest(root, "learning-finished-keep").props.onClick();
      await flush();
      expect(textOf(root)).toContain("The practice project is kept.");
      expect(practice.remove).not.toHaveBeenCalled();
      expect(practice.archive).not.toHaveBeenCalled();
      expect(textOf(byTest(root, "learning-finished-next"))).toContain("Next lesson: Your first change");
      await byTest(root, "learning-finished-next").props.onClick();
      await flush();
      expect(startLesson).toHaveBeenCalledWith({ courseId: COURSE.courseId, release: COURSE.release, lessonCode: "V64-START-02", expectedRevision: 4 });
      expect([learning.state.attemptId, learning.surface, learning.finished]).toEqual([OTHER, "lesson", false]);
    } finally { app.unmount(); }
  });

  it("continues a next lesson left earlier in its own practice project instead of starting it again", async () => {
    const passed = ["quiz", "preview", "tick"].map(stepId => ({ stepId, outcome: "passed" }));
    const { learning } = controller({ reads: () => lessonResult({ results: passed,
      attempt: { attemptId: ATTEMPT, ended: { reason: "finished" }, practiceSlug: "training-1111", pin } }) });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    await learning.showFinished();
    const left = { attemptId: OTHER, ended: { reason: "left" }, pin: { ...pin, lesson: { code: "V64-START-02", hash: "h2" } } };
    const continueLesson = vi.fn(async () => ({ attemptId: "44444444-4444-4444-8444-444444444444", current: true }));
    const courses = { learningResource: { data: Vue.ref({ ok: true, available: true, revision: 5, active: null, history: [left],
      lessonProgress: [{ lessonCode: "V64-START-01", lessonHash: "h1", required: 3, passed: 3, completed: true, open: false }] }), reload: vi.fn() },
    coursesResource: { data: Vue.ref({ ok: true, available: true, courses: [COURSE] }) }, busy: Vue.ref(false), starting: Vue.ref(false),
    startLesson: vi.fn(), continueLesson };
    const finished = compiledUi(path.resolve("src/components/learning/Vibe64LearningFinished.vue"), {
      vue: Vue, "@mdi/js": { mdiCheckCircle: "check" },
      "@local/vibe64-training/client/course-progress": await import("../../packages/vibe64-training/src/client/courseProgress.js"),
      "@/composables/useVibe64PracticeProjects.js": { useVibe64PracticeProjects: () => practiceFake() }
    });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(finished, { learning, courses, learningRevision: 3 }) });
    for (const tag of WIDGETS) app.component(tag, widget);
    app.mount(root);
    try {
      await flush();
      await byTest(root, "learning-finished-next").props.onClick();
      await flush();
      expect(continueLesson).toHaveBeenCalledWith({ attemptId: OTHER, expectedRevision: 5 });
      expect(courses.startLesson).not.toHaveBeenCalled();
    } finally { app.unmount(); }
  });

  for (const [action, test, outcome] of [["archive", "learning-finished-archive", "The practice project is archived."],
    ["remove", "learning-finished-delete", "The practice project is deleted."]]) {
    it(`${action === "archive" ? "archives" : "deletes"} the practice project with one click and returns to Courses`, async () => {
      const passed = ["quiz", "preview", "tick"].map(stepId => ({ stepId, outcome: "passed" }));
      const { learning } = controller({ reads: () => lessonResult({ results: passed,
        attempt: { attemptId: OTHER, ended: { reason: "finished" }, practiceSlug: "training-1111", pin } }) });
      learning.setViewer("member");
      await learning.show({ attemptId: OTHER });
      await learning.showFinished();
      const practice = practiceFake();
      const courses = { learningResource: { data: Vue.ref({ ok: true, available: true, revision: 3, active: null, history: [] }), reload: vi.fn() },
        coursesResource: { data: Vue.ref({ ok: true, available: true, courses: [] }) }, busy: Vue.ref(false), starting: Vue.ref(false), startLesson: vi.fn() };
      const finished = compiledUi(path.resolve("src/components/learning/Vibe64LearningFinished.vue"), {
        vue: Vue, "@mdi/js": { mdiCheckCircle: "check" },
        "@local/vibe64-training/client/course-progress": await import("../../packages/vibe64-training/src/client/courseProgress.js"),
        "@/composables/useVibe64PracticeProjects.js": { useVibe64PracticeProjects: () => practice }
      });
      const root = { children: [] };
      const app = uiRenderer().createApp({ render: () => Vue.h(finished, { learning, courses, learningRevision: 3 }) });
      for (const tag of WIDGETS) app.component(tag, widget);
      app.mount(root);
      try {
        await flush();
        expect(byTest(root, "learning-finished-next"), "no next lesson in an unknown course").toBeUndefined();
        expect(textOf(byTest(root, "learning-finished-keep"))).toBe("Keep");
        // The continued attempt's project is still listed, so it is offered, not reported deleted.
        expect(textOf(root)).not.toContain("The practice project is deleted.");
        await byTest(root, test).props.onClick();
        await flush();
        // A continued lesson (attempt OTHER) acts on the practice project its first attempt created,
        // found in the Practice list by slug.
        expect(practice[action]).toHaveBeenCalledWith({ practiceId: ATTEMPT });
        expect(textOf(root)).toContain(outcome);
        await byTest(root, "learning-finished-courses").props.onClick();
        expect([learning.surface, learning.finished]).toEqual(["courses", false]);
      } finally { app.unmount(); }
    });
  }
});
