import path from "node:path";
import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as LearningLib from "../../src/lib/vibe64Learning.js";
import { createPageActivity } from "../../src/lib/vibe64PageActivity.js";
import { watchColleagueLearningRequests } from "../../packages/vibe64-colleague/src/client/colleagueLearningRequests.js";
import { applyLearningNavigation, learningPanelFocus, learningPanelMatches } from "../../packages/vibe64-colleague/src/shared/learningFocus.js";

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

// Mode, saved-progress and practice-list requests are answered apart; mode requests are recorded in modeCalls.
const LEARN = Object.freeze({ on: true, currentAttemptId: ATTEMPT, lessonCode: "V64-START-01", lessonTitle: "Orientation", practiceSlug: "practice-one", lessonStage: "project" });
function controller({ reads = () => lessonResult(), posts = () => ({ ok: true }), mode = () => LEARN,
  practice = () => ({ ok: true, current: null, archived: [] }), ...options } = {}) {
  const calls = [];
  const modeCalls = [];
  const request = vi.fn(async (url, { method, body } = {}) => {
    if (url.includes("/learning-mode")) {
      modeCalls.push({ url, method, body });
      return { ok: true, available: true, learningMode: mode(url, method, body) };
    }
    if (url === VIBE64_LEARNING_ROUTES.learning) return { ok: true, available: true, revision: 3 };
    if (url === VIBE64_LEARNING_ROUTES.practice) return practice();
    calls.push({ url, method, body });
    return method === "GET" ? reads(url, calls) : posts(url, body, calls);
  });
  return { learning: createVibe64Learning({ request, ...options }), calls, modeCalls, request };
}
const flush = async () => { for (let i = 0; i < 4; i += 1) { await Promise.resolve(); await Vue.nextTick(); } };

describe("useVibe64Learning controller", () => {
  it("opens nothing until the overlay binds a signed-in viewer, then opens the Lesson pane on the saved place", async () => {
    const { learning, calls } = controller({ reads: () => lessonResult({ reader: { attemptId: ATTEMPT, stepId: "quiz", scroll: 120 } }) });
    await expect(learning.show()).rejects.toThrow("Sign in");
    await expect(learning.openLesson()).rejects.toThrow("Sign in");
    learning.setViewer("member");
    const focus = await learning.show({ attemptId: ATTEMPT });
    expect(calls[0]).toEqual({ url: VIBE64_LEARNING_ROUTES.lessonRead(ATTEMPT), method: "GET", body: undefined });
    expect(learning.open, "a lesson is read in the Lesson pane, never in Courses").toBe(false);
    expect(learning.surface).toBe("courses");
    // No browser place yet: the learner's saved reader.json position is restored.
    expect(learning.stepId).toBe("quiz");
    expect(learning.scroll).toBe(120);
    expect(focus).toEqual({ learningOpen: false, learningSurface: "courses", learningAttemptId: ATTEMPT, learningStepId: "quiz" });
    expect(learning.lesson.value.practiceProjectSlug).toBe("practice-one");
    expect(learning.lesson.value.steps.every(step => !Object.hasOwn(step.check || {}, "answer"))).toBe(true);
  });

  it("shows a step lesson.read names as passed as passed", async () => {
    // lesson.read names the steps this attempt has passed, also when the
    // results page does not carry them.
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
    expect(learning.stepId, "read is optional and quiz is passed").toBe("preview");
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

  it("records whether the learner's own close or Escape hid Courses, for Colleague's phone return", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await learning.show();
    learning.minimise("learner");
    expect(learning.hiddenBy).toBe("learner");
    await learning.show();
    expect(learning.hiddenBy, "showing L again clears it").toBe("");
    learning.minimise();
    expect(learning.hiddenBy, "Show me, Teach me and app navigation hide L to show something else").toBe("");
    await learning.show();
    learning.closeCourses();
    expect(learning.hiddenBy, "closing Courses is the learner's own hide").toBe("learner");
    expect(learning.minimised).toBe(true);
  });

  it("shows Colleague's exact lesson step in the Lesson pane, and opens and closes Courses, through the shared Colleague rule", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await vi.waitFor(() => expect(learning.mode?.currentAttemptId).toBe(ATTEMPT));
    const courses = { learning: { open: true } };
    await applyLearningNavigation(learning, courses.learning);
    expect(learning.coursesOpen).toBe(true);
    expect(learningPanelMatches(courses, learningPanelFocus(learning))).toBe(true);
    const command = { learning: { attemptId: ATTEMPT, stepId: "tick" } };
    await applyLearningNavigation(learning, command.learning);
    expect([learning.coursesOpen, learning.hiddenBy, learning.attemptId, learning.stepId], "the step shows in the Lesson pane, Courses closes")
      .toEqual([false, "", ATTEMPT, "tick"]);
    const focus = learningPanelFocus(learning);
    expect(learningPanelMatches(command, { ...focus, pane: "lesson" }), "the acknowledgement Colleague waits for").toBe(true);
    expect(learningPanelMatches(command, { ...focus, pane: "preview" }), "only while the Lesson pane shows").toBe(false);
    expect(learningPanelMatches(command, { ...focus, pane: "lesson", learningStepId: "quiz" }), "at that exact step").toBe(false);
    await applyLearningNavigation(learning, { open: false });
    expect([learning.coursesOpen, learning.hiddenBy], "Colleague's close is not the learner's own").toEqual([false, ""]);
  });

  it("reads the learner's mode: Learn with its current lesson, Develop, and an unreadable mode counts as Develop", async () => {
    let on = true;
    const { learning, modeCalls, calls } = controller({ mode: () => on ? LEARN : { ...LEARN, on: false } });
    learning.setViewer("member");
    expect(learning.learnMode, "not before the mode is read").toBe(false);
    await flush();
    expect(modeCalls[0]).toEqual({ url: VIBE64_LEARNING_ROUTES.learningMode, method: "GET", body: undefined });
    expect(learning.learnMode, "the mode comes from the server, also in a fresh tab").toBe(true);
    expect(learning.mode).toEqual(LEARN);
    expect(learning.lessonTitle).toBe("Orientation");
    expect(learning.attemptId, "the current lesson is read for the step bar and Colleague").toBe(ATTEMPT);
    expect(calls.some(call => call.url === VIBE64_LEARNING_ROUTES.lessonRead(ATTEMPT))).toBe(true);
    expect(learning.open, "Courses stays hidden").toBe(false);
    on = false;
    await learning.learnerChanged({ reason: "learning-mode" });
    await flush();
    expect(learning.learnMode).toBe(false);
    expect(learning.attemptId, "Develop pauses the lesson; it stays current").toBe(ATTEMPT);
    learning.setViewer("someone-else");
    expect([learning.learnMode, learning.mode]).toEqual([false, null]);

    const failing = createVibe64Learning({ request: async () => { throw new Error("offline"); } });
    failing.setViewer("member");
    await flush();
    expect([failing.learnMode, failing.state.modeRead]).toEqual([false, true]);
  });

  it("switches the mode with L, keeping each mode's place in this browser, and returns to it after a reload", async () => {
    const local = new Map();
    vi.stubGlobal("window", { sessionStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
      localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) } });
    let on = false;
    const route = { fullPath: "/app/project/my-shop/dashboard/env" };
    const router = { currentRoute: { value: route }, push: vi.fn(async path => { route.fullPath = path; }) };
    const { learning, modeCalls } = controller({ router, mode: (_url, method, body) => {
      if (method === "POST") on = body.on;
      return { ...LEARN, on, practiceSlug: "training-abc" };
    } });
    learning.setViewer("member");
    await flush();
    expect(learning.learnMode).toBe(false);
    await learning.toggleMode();
    expect(modeCalls.at(-1)).toEqual({ url: VIBE64_LEARNING_ROUTES.learningMode, method: "POST", body: { on: true } });
    expect(learning.learnMode).toBe(true);
    expect(router.push, "Learn opens at the current lesson's practice project the first time").toHaveBeenLastCalledWith("/app/project/training-abc");
    route.fullPath = "/app/project/training-abc/dashboard/health";
    await learning.toggleMode();
    expect(router.push, "Develop returns to exactly where it was").toHaveBeenLastCalledWith("/app/project/my-shop/dashboard/env");
    expect(learning.learnMode).toBe(false);

    // A reload (a new controller in the same browser) returns each mode to its own place.
    const again = controller({ router, mode: (_url, method, body) => {
      if (method === "POST") on = body.on;
      return { ...LEARN, on, practiceSlug: "training-abc" };
    } });
    again.learning.setViewer("member");
    await flush();
    await again.learning.toggleMode();
    expect(router.push).toHaveBeenLastCalledWith("/app/project/training-abc/dashboard/health");
    expect(again.learning.modePlace()).toBe("/app/project/training-abc/dashboard/health");
    // A saved place the mode no longer allows (the lesson's project is gone) falls back to the mode's home.
    on = true;
    const gone = controller({ router, mode: () => ({ ...LEARN, on: true, currentAttemptId: "", practiceSlug: "" }) });
    gone.learning.setViewer("member");
    await flush();
    expect(gone.learning.modePlace()).toBe(LearningLib.VIBE64_LEARNING_PAGE_PATH);
    expect(again.learning.state.modeBusy).toBe("");
  });

  it("opens the Lesson pane at a step: Courses closes, and the lesson's home shows ?pane=lesson", async () => {
    const route = { fullPath: "/app/project/practice-one" };
    const router = { currentRoute: { value: route }, push: vi.fn(async path => { route.fullPath = path; }) };
    const { learning } = controller({ router });
    learning.setViewer("member");
    await flush();
    await learning.openCourses("courses");
    await learning.openLesson({ stepId: "quiz" });
    expect(router.push).toHaveBeenLastCalledWith("/app/project/practice-one?pane=lesson");
    expect([learning.open, learning.hiddenBy, learning.stepId]).toEqual([false, "", "quiz"]);
    expect(learning.lessonAttemptId).toBe(ATTEMPT);
    // Without a practice project the lesson's home is the Learn page.
    const plain = controller({ router, mode: () => ({ ...LEARN, practiceSlug: "" }) });
    plain.learning.setViewer("member");
    await flush();
    await plain.learning.openLesson();
    expect(router.push).toHaveBeenLastCalledWith(`${LearningLib.VIBE64_LEARNING_PAGE_PATH}?pane=lesson`);
    // A studio lesson docks its Lesson pane on the studio page showing a stage frame.
    const studioRoute = { path: "/app/studio-page", fullPath: "/app/studio-page" };
    const studioRouter = { currentRoute: { value: studioRoute }, push: vi.fn(async target => { studioRoute.fullPath = target; }) };
    const layout = Vue.shallowRef({ studio: true, projectSlug: "", lessonPane: false });
    const studio = controller({ router: studioRouter, layout, mode: () => ({ ...LEARN, practiceSlug: "", lessonStage: "studio" }) });
    studio.learning.setViewer("member");
    await flush();
    expect(studio.learning.lessonSwitchable, "a studio stage frame offers Lesson").toBe(true);
    await studio.learning.openLesson();
    expect(studioRouter.push).toHaveBeenLastCalledWith("/app/studio-page?pane=lesson");
    // In its practice project (no stage frame there) a studio lesson shows the
    // project's Lesson pane instead of leaving the project for the studio home.
    const deployRoute = { path: "/app/project/training-abc/dashboard/deploy", fullPath: "/app/project/training-abc/dashboard/deploy" };
    const deployRouter = { currentRoute: { value: deployRoute }, push: vi.fn(async target => { deployRoute.fullPath = target; }) };
    const projectLayout = Vue.shallowRef({ studio: false, projectSlug: "training-abc", lessonPane: false });
    const practice = controller({ router: deployRouter, layout: projectLayout,
      mode: () => ({ ...LEARN, practiceSlug: "training-abc", lessonStage: "studio" }) });
    practice.learning.setViewer("member");
    await flush();
    await practice.learning.openLesson();
    expect(deployRouter.push).toHaveBeenLastCalledWith("/app/project/training-abc?pane=lesson");
  });

  it("opens Courses on its lesson picker when L switches to Learn with no lesson in progress", async () => {
    const route = { fullPath: "/app/project/my-shop" };
    const router = { currentRoute: { value: route }, push: vi.fn(async path => { route.fullPath = path; }) };
    let current = "";
    let on = false;
    const { learning } = controller({ router, mode: (_url, method, body) => {
      if (method === "POST") on = body.on;
      return { ...LEARN, on, currentAttemptId: current, practiceSlug: "" };
    } });
    learning.setViewer("member");
    await flush();
    await learning.toggleMode();
    await flush();
    expect([learning.learnMode, learning.state.open, learning.state.surface]).toEqual([true, true, "courses"]);
    learning.minimise();
    await learning.toggleMode();
    // Lesson 0 has no practice project but is a lesson: L only switches.
    current = ATTEMPT;
    await learning.toggleMode();
    await flush();
    expect([learning.learnMode, learning.state.open]).toEqual([true, false]);
  });

  it("keeps each address in its mode", () => {
    const { modeRedirect, VIBE64_LEARNING_PAGE_PATH, VIBE64_LEARNING_MODE_NOTE, VIBE64_DEVELOP_MODE_NOTE } = LearningLib;
    const learn = { ...LEARN, practiceSlug: "training-abc" };
    expect(modeRedirect({ mode: learn, slug: "my-shop" })).toEqual({ path: "/app/project/training-abc", note: VIBE64_LEARNING_MODE_NOTE });
    expect(modeRedirect({ mode: learn, slug: "training-abc" })).toBeNull();
    expect(modeRedirect({ mode: learn, path: VIBE64_LEARNING_PAGE_PATH }), "a lesson with a project opens it").toEqual({ path: "/app/project/training-abc", note: "" });
    expect(modeRedirect({ mode: learn, path: "/app" }), "pages outside a project stay").toBeNull();
    const noProject = { ...LEARN, practiceSlug: "" };
    expect(modeRedirect({ mode: noProject, slug: "my-shop" }), "Lesson 0 or no lesson: no project selected")
      .toEqual({ path: VIBE64_LEARNING_PAGE_PATH, note: VIBE64_LEARNING_MODE_NOTE });
    expect(modeRedirect({ mode: noProject, path: VIBE64_LEARNING_PAGE_PATH })).toBeNull();
    const develop = { ...learn, on: false };
    expect(modeRedirect({ mode: develop, slug: "my-shop" })).toBeNull();
    expect(modeRedirect({ mode: develop, slug: "training-abc" })).toEqual({ path: "/app", note: VIBE64_DEVELOP_MODE_NOTE });
    expect(modeRedirect({ mode: develop, slug: "training-0123" }), "the server decides any other training project").toBeNull();
    expect(modeRedirect({ mode: develop, path: `${VIBE64_LEARNING_PAGE_PATH}/` })).toEqual({ path: "/app", note: "" });
    expect(modeRedirect({ mode: null, slug: "my-shop" })).toBeNull();
    // The lesson's stage, not the presence of a practice project, decides its home.
    const studio = { ...learn, lessonStage: "studio" };
    expect(modeRedirect({ mode: studio, path: VIBE64_LEARNING_PAGE_PATH }), "a studio lesson stays on the studio home").toBeNull();
    expect(modeRedirect({ mode: studio, slug: "my-shop" })).toEqual({ path: VIBE64_LEARNING_PAGE_PATH, note: VIBE64_LEARNING_MODE_NOTE });
    // A host with its own studio pages sets its studio home; /app/learning then sends Learn there.
    LearningLib.setLearningStudioHome("/app/studio-test");
    try {
      expect(modeRedirect({ mode: studio, path: VIBE64_LEARNING_PAGE_PATH })).toEqual({ path: "/app/studio-test", note: "" });
      expect(modeRedirect({ mode: studio, path: "/app/studio-test/other" })).toBeNull();
      expect(modeRedirect({ mode: noProject, slug: "my-shop" })).toEqual({ path: "/app/studio-test", note: VIBE64_LEARNING_MODE_NOTE });
    } finally { LearningLib.setLearningStudioHome(VIBE64_LEARNING_PAGE_PATH); }
    expect(() => LearningLib.setLearningStudioHome("https://example.com")).toThrow("not an /app page");
  });

  it("asks once before a start archives a different lesson in progress: confirm starts with archiveCurrent, cancel keeps it", async () => {
    const router = { currentRoute: { value: { fullPath: "/app/learning" } }, push: vi.fn(async path => { router.currentRoute.value.fullPath = path; }) };
    const { learning } = controller({ router, mode: () => ({ ...LEARN, currentAttemptId: OTHER, practiceSlug: "training-next" }) });
    learning.setViewer("member");
    await flush();
    const selection = { courseId: "getting-started", release: "0.2.0", lessonCode: "V64-START-02", expectedRevision: 4 };
    const refused = Object.assign(new Error("Another lesson is in progress."), { code: LearningLib.VIBE64_LESSON_IN_PROGRESS_CODE,
      details: { attemptId: ATTEMPT, lessonTitle: "Orientation" } });
    const start = vi.fn(async input => { if (!input.archiveCurrent) throw refused; return { attemptId: OTHER, current: true }; });
    expect(await learning.startLesson(selection, start)).toBeNull();
    expect(learning.confirmArchive).toMatchObject({ next: selection, current: { attemptId: ATTEMPT, lessonTitle: "Orientation" } });
    learning.cancelArchive();
    expect(learning.confirmArchive, "cancelling keeps the lesson in progress").toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
    await learning.startLesson(selection, start);
    const outcome = await learning.confirmArchiveAndStart();
    expect(start).toHaveBeenLastCalledWith({ ...selection, archiveCurrent: true }, { onAdmitted: learning.admitted });
    expect(outcome).toMatchObject({ attemptId: OTHER });
    expect(learning.confirmArchive).toBeNull();
    expect(router.push, "the started lesson opens at its place, in its Lesson pane").toHaveBeenLastCalledWith("/app/project/training-next?pane=lesson");
    expect([learning.open, learning.attemptId], "Courses closes").toEqual([false, OTHER]);
    await expect(learning.startLesson(selection, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(learning.confirmArchive, "other failures are not a confirmation").toBeNull();
  });

  it("Take the tour asks the mounted overlay to start the course orientation, for the signed-in viewer only", async () => {
    const { learning } = controller();
    learning.openOrientation();
    expect(learning.orientationRequested, "nobody is signed in yet").toBe(false);
    learning.setViewer("member");
    learning.openOrientation();
    expect(learning.orientationRequested).toBe(true);
    learning.orientationAnswered();
    expect(learning.orientationRequested).toBe(false);
    learning.openOrientation();
    learning.setViewer("someone-else");
    expect(learning.orientationRequested, "a viewer change forgets the request").toBe(false);
  });

  it("selects an enabled course's published orientation lesson this person may start, released courses first", () => {
    const { orientationSelection } = LearningLib;
    const saved = { ok: true, available: true, revision: 7 };
    const course = (courseId, status, extra = {}) => ({ courseId, release: "0.5.0", status, enabled: true, orientation: "V64-WELCOME",
      lessons: [{ code: "V64-WELCOME", status: "published" }], ...extra });
    const catalogue = courses => ({ ok: true, canTryPreviews: false, courses });
    expect(orientationSelection(catalogue([course("preview", "preview"), course("released", "released")]), saved))
      .toEqual({ courseId: "released", release: "0.5.0", lessonCode: "V64-WELCOME", expectedRevision: 7 });
    expect(orientationSelection(catalogue([course("preview", "preview")]), saved), "previews only for those who may try them").toBeNull();
    expect(orientationSelection({ ...catalogue([course("preview", "preview")]), canTryPreviews: true }, saved)?.courseId).toBe("preview");
    expect(orientationSelection(catalogue([course("off", "released", { enabled: false })]), saved)).toBeNull();
    expect(orientationSelection(catalogue([course("none", "released", { orientation: undefined })]), saved)).toBeNull();
    expect(orientationSelection(catalogue([course("draft", "released", { lessons: [{ code: "V64-WELCOME", status: "draft" }] })]), saved)).toBeNull();
    expect(orientationSelection(catalogue([course("released", "released")]), { ok: true, available: false })).toBeNull();
  });

  it("closes Courses as soon as the server confirms a start, before the rereads, and shows the Lesson pane", async () => {
    const router = { currentRoute: { value: { fullPath: "/app/learning" } }, push: vi.fn(async path => { router.currentRoute.value.fullPath = path; }) };
    let mode = { ...LEARN, currentAttemptId: "", practiceSlug: "" };
    const { learning } = controller({ router, mode: () => mode });
    learning.setViewer("member");
    await flush();
    await learning.show();
    const reread = Promise.withResolvers();
    let closedAtConfirmation;
    // The Courses adapter calls onAdmitted once the server confirms, then rereads progress.
    const start = vi.fn(async (_selection, { onAdmitted }) => {
      onAdmitted(OTHER);
      closedAtConfirmation = learning.open;
      await reread.promise;
      return { attemptId: OTHER, current: true };
    });
    const started = learning.startLesson({ lessonCode: "V64-START-02" }, start);
    await flush();
    expect(closedAtConfirmation, "Courses closes at confirmation").toBe(false);
    expect(learning.hiddenBy, "not as the learner's own close").toBe("");
    mode = { ...LEARN, currentAttemptId: OTHER, practiceSlug: "training-next" };
    reread.resolve();
    await started;
    expect(router.push).toHaveBeenLastCalledWith("/app/project/training-next?pane=lesson");
    expect([learning.open, learning.attemptId]).toEqual([false, OTHER]);

    // When the realtime change already made it the lesson in progress here,
    // its Lesson pane opens at confirmation too.
    await learning.show();
    router.currentRoute.value.fullPath = "/app/project/training-next";
    router.push.mockClear();
    const next = vi.fn(async (_selection, { onAdmitted }) => { onAdmitted(OTHER); await flush(); return { attemptId: OTHER, current: true }; });
    await learning.startLesson({ lessonCode: "V64-START-02" }, next);
    expect(router.push.mock.calls[0], "shown before the start's own open").toEqual(["/app/project/training-next?pane=lesson"]);
    expect(learning.open).toBe(false);
  });

  it("shows a confirmed start's Lesson pane once the mode read its realtime change started is in", async () => {
    const router = { currentRoute: { value: { fullPath: "/app/learning" } }, push: vi.fn(async path => { router.currentRoute.value.fullPath = path; }) };
    let modeRead = null;
    const request = vi.fn(async url => {
      if (url.includes("/learning-mode")) {
        const value = modeRead ? await modeRead.promise : { ...LEARN, currentAttemptId: "", practiceSlug: "" };
        return { ok: true, available: true, learningMode: value };
      }
      if (url === VIBE64_LEARNING_ROUTES.practice) return { ok: true, current: null, archived: [] };
      return lessonResult();
    });
    const learning = createVibe64Learning({ request, router });
    learning.setViewer("member");
    await flush();
    await learning.show();
    modeRead = Promise.withResolvers();
    const reread = Promise.withResolvers();
    const start = vi.fn(async (_selection, { onAdmitted }) => {
      void learning.learnerChanged({ reason: "attempt" });
      onAdmitted(ATTEMPT);
      await reread.promise;
      return { attemptId: ATTEMPT, current: true };
    });
    const started = learning.startLesson({ lessonCode: "V64-START-01" }, start);
    await flush();
    expect([learning.open, router.push.mock.calls.length]).toEqual([false, 0]);
    modeRead.resolve(LEARN);
    await flush();
    expect(router.push, "before the start's progress reread is in").toHaveBeenCalledWith("/app/project/practice-one?pane=lesson");
    reread.resolve();
    await started;
    expect(router.push).toHaveBeenCalledOnce();
  });

  it("shows the project side on a phone whenever a lesson opens, also when its address is already the Lesson pane", async () => {
    const router = { currentRoute: { value: { fullPath: "/app/project/practice-one?pane=lesson" } }, push: vi.fn() };
    const layout = Vue.shallowRef({ showProject: vi.fn() });
    const { learning } = controller({ router, layout });
    learning.setViewer("member");
    await flush();
    await learning.openLesson({ stepId: "quiz" });
    expect(router.push, "the address already names the Lesson pane").not.toHaveBeenCalled();
    expect(layout.value.showProject).toHaveBeenCalledOnce();
  });

  it("shows an author trial, which never becomes the mode's lesson, as this tab's current lesson in the Lesson pane", async () => {
    const router = { currentRoute: { value: { fullPath: "/app/learning" } }, push: vi.fn(async path => { router.currentRoute.value.fullPath = path; }) };
    const { learning } = controller({ router, mode: () => ({ ...LEARN, currentAttemptId: "", practiceSlug: "" }) });
    learning.setViewer("member");
    await flush();
    await learning.opened({ attemptId: ATTEMPT, current: true });
    expect(router.push).toHaveBeenLastCalledWith("/app/learning?pane=lesson");
    expect([learning.attemptId, learning.lessonAttemptId, learning.open]).toEqual([ATTEMPT, ATTEMPT, false]);
    await learning.readLearningMode();
    expect(learning.lessonAttemptId, "a mode read keeps the trial").toBe(ATTEMPT);
    // A reload of this tab keeps it.
    const again = controller({ mode: () => ({ ...LEARN, currentAttemptId: "", practiceSlug: "" }) });
    again.learning.setViewer("member");
    await flush();
    expect(again.learning.lessonAttemptId).toBe(ATTEMPT);
    // Opening another attempt ends the trial here.
    await learning.openLesson({ attemptId: OTHER });
    await learning.readLearningMode();
    expect([learning.attemptId, learning.lessonAttemptId]).toEqual(["", ""]);
  });

  it("restarts, finishes and deletes the lesson in progress through its actions, and lists it with the archived lessons", async () => {
    let current = ATTEMPT;
    const list = { ok: true, current: { attemptId: ATTEMPT, lesson: { code: "V64-START-01", title: "Orientation" }, slug: "training-abc", status: "in-progress" },
      archived: [{ attemptId: OTHER, lesson: { code: "V64-START-00", title: "Set yourself up" }, reason: "finished", archivedAt: "2026-10-20T10:15:00.000Z", hasProject: false }] };
    const { learning, calls } = controller({ mode: () => ({ ...LEARN, currentAttemptId: current }), practice: () => list,
      posts: url => {
        if (url === VIBE64_LEARNING_ROUTES.lessonRestart(ATTEMPT)) current = "33333333-3333-4333-8333-333333333333";
        if (url.endsWith("/delete") || url.endsWith("/finish")) current = "";
        return { ok: true };
      } });
    learning.setViewer("member");
    await flush();
    await learning.readPractice();
    expect(learning.practice.current).toMatchObject({ attemptId: ATTEMPT, name: "Orientation", projectName: "Practice: Orientation", slug: "training-abc" });
    expect(learning.practice.archived).toEqual([{ attemptId: OTHER, name: "Set yourself up", reason: "finished",
      archivedAt: "2026-10-20T10:15:00.000Z", hasProject: false }]);
    await learning.restart();
    const restart = calls.find(call => call.url === VIBE64_LEARNING_ROUTES.lessonRestart(ATTEMPT));
    expect(restart.body).toEqual({ requestId: expect.any(String), expectedRevision: 3 });
    expect(learning.attemptId, "the new attempt is current").toBe("33333333-3333-4333-8333-333333333333");
    await learning.deleteAttempt();
    expect(calls.at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.lessonDelete("33333333-3333-4333-8333-333333333333"), body: { confirmed: true } });
    expect([learning.attemptId, learning.lesson.value]).toEqual(["", null]);
    expect(await learning.deleteAttempt(), "nothing in progress to delete").toBeNull();
    await learning.deleteArchived(OTHER);
    expect(calls.at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.archiveDelete(OTHER), body: { confirmed: true } });
    expect(LearningLib.normalizePractice({ ok: false })).toMatchObject({ current: null, archived: [], loaded: false });
  });

  it("keeps the Lesson pane's place and Courses' tab; closing and reopening Courses changes neither", async () => {
    vi.useFakeTimers();
    const { learning, calls } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT });
    learning.selectStep("preview");
    learning.setScroll(48.4);
    // The Lesson pane saves reader.json at once when it hides (last write wins); later timers add nothing new.
    learning.flushReader();
    expect(learning.stepId).toBe("preview");
    expect(calls.filter(call => call.method === "POST")).toEqual([
      { url: VIBE64_LEARNING_ROUTES.readerSave(ATTEMPT), method: "POST", body: { stepId: "preview", scroll: 48 } }]);
    vi.runAllTimers();
    expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
    await learning.show({ surface: "progress" });
    expect(learning.open).toBe(true);
    learning.minimise();
    expect(learning.minimised).toBe(true);
    await learning.show();
    expect(learning.open).toBe(true);
    expect(learning.surface, "Courses comes back on its tab").toBe("progress");
    expect(learning.stepId).toBe("preview");
    learning.closeCourses();
    expect(learning.open).toBe(false);
    expect(learning.minimised, "closing Courses keeps its place").toBe(true);
    await learning.openCourses();
    expect(learning.open).toBe(true);
    expect(learning.stepId).toBe("preview");

    // A new page in the same tab restores this browser's place before reader.json.
    const again = controller({ reads: () => lessonResult({ reader: { attemptId: ATTEMPT, stepId: "quiz", scroll: 7 } }) });
    again.learning.setViewer("member");
    expect(again.learning.attemptId).toBe(ATTEMPT);
    await again.learning.openLesson();
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

  it("Show me closes Courses, then guides with the practice project's view; Teach me asks Colleague", async () => {
    const navigateBrowser = vi.fn();
    const view = { projectSlug: "practice-one", openFile: vi.fn() };
    const runGuide = vi.fn(async () => ({ guide: { shown: true, step: "preview" } }));
    const { learning } = controller({ browserNavigation: Vue.shallowRef(navigateBrowser), colleagueView: Vue.shallowRef(view), runGuide });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "preview" });
    await learning.show();
    const receipt = await learning.showMe("preview");
    expect(receipt).toEqual({ guide: { shown: true, step: "preview" } });
    expect([learning.open, learning.hiddenBy], "Courses gives way to the real place").toEqual([false, ""]);
    const [command, options] = runGuide.mock.calls[0];
    expect(command).toMatchObject({ projectSlug: "practice-one", pane: "preview",
      guide: { target: "preview", navigate: true, highlight: true, caption: "Your app runs here" } });
    expect(options.navigateBrowser).toBe(navigateBrowser);
    // The file opener reads the published view when it is used, for this project only.
    expect(options.view.openFile("src/app.js")).toBe(false);
    view.openFile.mockReturnValue(true);
    expect(options.view.openFile("src/app.js")).toBe(true);

    const request = learning.teachMe("quiz");
    expect(learning.open, "Teach me leaves the step in the Lesson pane, beside Colleague").toBe(false);
    expect(request).toMatchObject({ kind: "teach", message: VIBE64_LEARNING_TEACH_MESSAGE, attemptId: ATTEMPT, stepId: "quiz" });
    expect(learning.focus.value).toEqual({ learningOpen: false, learningSurface: "courses", learningAttemptId: ATTEMPT, learningStepId: "quiz" });
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
      expect(learning.open).toBe(false);
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
    expect(() => showMeCommand({ target: "nowhere" })).toThrow("this installation's guide places");
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

// The shared step view (the lesson reader) with a bounded diagram player.
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
      expect(learning.open, "the step moves to the Lesson pane beside Colleague").toBe(false);
    } finally { view.app.unmount(); }
  });

  it("keeps the current step in view in the phone's scrolling step row", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "read" });
    const visible = Vue.ref(true);
    const view = await mountReader(learning, { get visible() { return visible.value; } });
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
      // Showing the reader again (its pane or L) brings the current step back into view as well.
      visible.value = false;
      await flush();
      visible.value = true;
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

  it("leaves a self step's instruction to the lesson and says when it is already passed", async () => {
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

  it("marks a reading step done with Mark as done, moves on, and then shows it Done in the step list", async () => {
    const { learning, calls } = controller();
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "read" });
    const view = await mountReader(learning);
    const listStatus = root => nodes(root).filter(node => node.props?.class === "vibe64-learning-reader__step-status").map(textOf);
    try {
      expect(listStatus(view.root)[0]).toBe("Optional");
      expect(byTest(view.root, "learning-mark-read-kept")).toBeUndefined();
      byTest(view.root, "learning-mark-read").props.onClick();
      await flush();
      expect(calls.filter(call => call.method === "POST").at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.stepDone(ATTEMPT), body: { stepId: "read" } });
      expect(learning.currentStep.value.id, "Mark as done moves to the next step").toBe("quiz");
      await flush();
      expect(byTest(view.root, "learning-mark-read"), "checked steps are proven by their checks, never marked by hand").toBeUndefined();
    } finally { view.app.unmount(); }

    const marked = controller({ reads: () => lessonResult({ passedStepIds: ["read"] }) });
    marked.learning.setViewer("member");
    await marked.learning.show({ attemptId: ATTEMPT, stepId: "read" });
    const again = await mountReader(marked.learning);
    try {
      expect(listStatus(again.root)[0]).toBe("Done");
      expect(textOf(byTest(again.root, "learning-step-status"))).toBe("Done");
      expect(textOf(byTest(again.root, "learning-mark-read-kept"))).toContain("You marked this step done");
      expect(byTest(again.root, "learning-mark-read")).toBeUndefined();
      expect(marked.learning.complete, "an optional step never completes the lesson").toBe(false);
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
      expect(learning.open, "the Finished screen shows in the Lesson pane, not in Courses").toBe(false);
      expect(learning.lessonAttemptId, "the Lesson pane keeps the finished lesson").toBe(ATTEMPT);
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

describe("Courses overlay", () => {
  it("binds the signed-in viewer, keeps each address in its mode, opens the Courses, In progress and Archived catalogue, and confirms an archiving start", async () => {
    let mode = { ...LEARN, practiceSlug: "training-1111" };
    const router = { currentRoute: { get value() { return route; } }, push: vi.fn(async () => {}) };
    const { learning } = controller({ mode: () => mode, router });
    const route = Vue.reactive({ path: "/app/project/my-shop/dashboard", fullPath: "/app/project/my-shop/dashboard", params: { slug: "my-shop" } });
    const replace = vi.fn(async path => { Object.assign(route, { path, fullPath: path, params: { slug: path.split("/")[3] || "" } }); });
    const realtime = [];
    const coursesOptions = [];
    const courses = { learningResource: { data: Vue.ref({ ok: true, revision: 9 }), reload: vi.fn() } };
    const HostKeys = await import("../../src/lib/vibe64AssistantHost.js");
    const LearnerEvents = await import("../../packages/vibe64-training/src/shared/learnerEvents.js");
    const stub = (test, tag = "section") => ({ default: { props: ["learning", "courses", "archived"],
      setup: props => () => Vue.h(tag, { "data-test": test, own: props.learning === learning || props.learning === courses, archived: props.archived }) } });
    const overlay = compiledUi(path.resolve("src/components/learning/Vibe64LearningOverlay.vue"), {
      vue: Vue,
      "vue-router": { useRoute: () => route, useRouter: () => ({ replace }) },
      "@mdi/js": { mdiClose: "close" },
      "@/lib/vibe64ProjectScope.js": { projectSlugFromRoute: value => String(value?.params?.slug || "") },
      "@/lib/vibe64Learning.js": LearningLib,
      "@jskit-ai/realtime/client/composables/useRealtimeEvent": { useRealtimeEvent: options => realtime.push(options) },
      "@local/vibe64-training/client/guide-overlay": { default: { render: () => Vue.h("aside", { "data-guide-overlay": "mounted" }) } },
      "@local/vibe64-training/shared/learner-events": LearnerEvents,
      "@/lib/vibe64AssistantHost.js": HostKeys,
      "@/composables/useVibe64Learning.js": { useVibe64Learning: () => learning },
      "@/composables/useVibe64LearningCourses.js": { useVibe64LearningCourses: options => { coursesOptions.push(options); return courses; } },
      "./Vibe64LearningCourses.vue": stub("courses"),
      "./Vibe64LearningAttempts.vue": stub("attempts"),
      "./Vibe64LearningTeacherNotes.vue": stub("teacher-notes", "aside")
    });
    const bodyClasses = new Set();
    vi.stubGlobal("document", { activeElement: null, body: { classList: {
      toggle: (name, on) => { if (on) bodyClasses.add(name); else bodyClasses.delete(name); },
      remove: name => bodyClasses.delete(name) } } });
    const viewer = Vue.ref({ actorKey: "member" });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(overlay) });
    app.provide(HostKeys.VIBE64_ASSISTANT_VIEWER_KEY, viewer);
    for (const tag of ["v-btn", "v-snackbar", ...WIDGETS]) app.component(tag, widget);
    app.mount(root);
    try {
      await flush();
      expect(learning.state.actorKey).toBe("member");
      // Learn mode: the page's first address, another project, goes to the lesson's practice project with the note.
      expect(replace).toHaveBeenCalledWith("/app/project/training-1111");
      expect(learning.notice).toBe(LearningLib.VIBE64_LEARNING_MODE_NOTE);
      learning.clearNotice();
      expect(bodyClasses.has("vibe64-learn-mode"), "Learn mode's app bar is yellow").toBe(true);
      expect(nodes(root).filter(node => node.props?.["data-guide-overlay"])).toHaveLength(1);
      expect(realtime[0].event).toBe("vibe64.training.learner.changed");
      // An address the learner opens in Learn mode gets the note.
      Object.assign(route, { path: "/app/project/my-shop", fullPath: "/app/project/my-shop", params: { slug: "my-shop" } });
      await flush();
      expect(replace).toHaveBeenLastCalledWith("/app/project/training-1111");
      expect(learning.notice).toBe(LearningLib.VIBE64_LEARNING_MODE_NOTE);
      expect(byTest(root, "learning-mode-notice").props["model-value"]).toBe(true);
      // A move after a mode change gets no note.
      learning.clearNotice();
      mode = { on: false, currentAttemptId: ATTEMPT, lessonCode: "V64-START-01", lessonTitle: "Orientation", practiceSlug: "training-1111", lessonStage: "project" };
      await learning.readLearningMode();
      await flush();
      expect(replace).toHaveBeenLastCalledWith("/app");
      expect(learning.notice, "Develop after a mode change").toBe("");
      mode = { ...LEARN, practiceSlug: "training-1111" };
      await learning.readLearningMode();
      await flush();

      expect(coursesOptions[0].active.value).toBe(false);
      await learning.openCourses();
      await flush();
      expect(coursesOptions[0].active.value).toBe(true);
      const layer = nodes(root).find(node => node.props?.role === "dialog" && node.props["aria-label"] === "Courses");
      expect(byTest(root, "courses").props.own, "the Courses surface reads its own courses adapter").toBe(true);
      expect(byTest(root, "teacher-notes").props.own).toBe(true);
      expect(nodes(root).filter(node => /^learning-.*-tab$/u.test(node.props?.["data-test"] || "")).map(node => textOf(node).trim()))
        .toEqual(["Courses", "In progress", "Archived"], "the lesson itself is read in the Lesson pane, not in Courses");
      byTest(root, "learning-progress-tab").props.onClick();
      await flush();
      expect([learning.surface, byTest(root, "attempts").props.archived]).toEqual(["progress", false]);
      byTest(root, "learning-archived-tab").props.onClick();
      await flush();
      expect([learning.surface, byTest(root, "attempts").props.archived]).toEqual(["archived", true]);
      expect(textOf(byTest(root, "learning-back-to-editor")).trim()).toBe("Back to editor");
      byTest(root, "learning-back-to-editor").props.onClick();
      await flush();
      expect([learning.open, learning.minimised, learning.hiddenBy], "the labelled way out closes Courses").toEqual([false, true, "learner"]);
      await learning.openCourses("archived");
      await flush();
      byTest(root, "learning-hide").props.onClick();
      await flush();
      expect([learning.open, learning.minimised, learning.hiddenBy]).toEqual([false, true, "learner"]);
      await learning.openCourses("lesson");
      await flush();
      expect(learning.surface, "the retired lesson tab is no Courses tab").toBe("archived");
      layer.props.onKeydown({ key: "Escape", defaultPrevented: false, stopPropagation() {} });
      await flush();
      expect([learning.open, learning.hiddenBy]).toEqual([false, "learner"]);
      expect(byTest(root, "attempts"), "kept mounted while hidden, so its place stays").toBeTruthy();

      // A start refused by the lesson in progress asks once.
      const start = vi.fn(async input => {
        if (!input.archiveCurrent) throw Object.assign(new Error("in progress"), { code: LearningLib.VIBE64_LESSON_IN_PROGRESS_CODE, details: { lessonTitle: "Orientation" } });
        return { attemptId: OTHER, current: false };
      });
      await learning.startLesson({ lessonCode: "V64-START-02" }, start);
      await flush();
      expect(textOf(byTest(root, "learning-archive-confirm"))).toContain("Orientation");
      expect(byTest(root, "learning-archive-confirm").parent.props.style, "the confirmation opens above Courses (2400) even over a toast")
        .toEqual({ "z-index": "2410" });
      byTest(root, "learning-archive-cancel").props.onClick();
      await flush();
      expect(byTest(root, "learning-archive-confirm")).toBeUndefined();
      await learning.startLesson({ lessonCode: "V64-START-02" }, start);
      await flush();
      await byTest(root, "learning-archive-start").props.onClick();
      await flush();
      expect(start).toHaveBeenLastCalledWith({ lessonCode: "V64-START-02", archiveCurrent: true }, { onAdmitted: learning.admitted });

      // Develop: the lesson's practice project is not shown; other projects open.
      mode = { ...mode, on: false };
      await learning.readLearningMode();
      await flush();
      expect(replace).toHaveBeenLastCalledWith("/app");
      expect(bodyClasses.has("vibe64-learn-mode")).toBe(false);
      const moves = replace.mock.calls.length;
      Object.assign(route, { path: "/app/project/my-shop", fullPath: "/app/project/my-shop", params: { slug: "my-shop" } });
      await flush();
      expect(replace).toHaveBeenCalledTimes(moves);

      // L waits for its own move to Learn's saved place; the address check does not cancel it.
      const learnPlace = "/app/project/training-1111/dashboard/files";
      vi.stubGlobal("window", { sessionStorage: { getItem: () => null, setItem() {} },
        localStorage: { getItem: key => key.endsWith("member:learn") ? JSON.stringify({ path: learnPlace }) : null, setItem() {} } });
      let arrive;
      router.push = vi.fn(target => new Promise(resolve => { arrive = () => {
        Object.assign(route, { path: target, fullPath: target, params: { slug: target.split("/")[3] || "" } });
        resolve();
      }; }));
      mode = { ...mode, on: true };
      const switching = learning.toggleMode();
      await flush();
      expect(router.push).toHaveBeenCalledWith(learnPlace);
      expect(replace, "no redirect while the switch moves").toHaveBeenCalledTimes(moves);
      arrive();
      await switching;
      await flush();
      expect([route.fullPath, replace.mock.calls.length]).toEqual([learnPlace, moves]);
      viewer.value = { actorKey: "someone-else" };
      await flush();
      expect(learning.state.actorKey).toBe("someone-else");
    } finally { app.unmount(); vi.unstubAllGlobals(); }
    expect(learning.state.actorKey).toBe("");
    expect(bodyClasses.has("vibe64-learn-mode"), "leaving the host clears the yellow bar").toBe(false);
  });
});

describe("Courses → In progress and Archived", () => {
  async function mountAttempts(learning, archived) {
    const panel = compiledUi(path.resolve("src/components/learning/Vibe64LearningAttempts.vue"), {
      vue: Vue, "@mdi/js": { mdiDeleteOutline: "trash" } });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(panel, { learning, archived }) });
    for (const tag of ["v-btn", "v-alert", "v-progress-circular"]) app.component(tag, widget);
    app.mount(root);
    await flush();
    return { app, root };
  }
  const list = { ok: true, current: { attemptId: ATTEMPT, lesson: { code: "V64-START-01", title: "Orientation" }, slug: "training-abc", status: "in-progress" },
    archived: [{ attemptId: OTHER, lesson: { code: "V64-START-00", title: "Set yourself up" }, reason: "archived", archivedAt: "2026-10-20T10:15:00.000Z", hasProject: true }] };

  it("shows the one lesson in progress with Open, Restart and Delete, restarting and deleting only after a second click", async () => {
    const { learning } = controller({ practice: () => list });
    learning.setViewer("member");
    await learning.readPractice();
    const actions = { openCurrent: vi.fn(), restart: vi.fn(), deleteAttempt: vi.fn() };
    const view = await mountAttempts({ ...actions, practice: learning.practice, state: learning.state, readPractice: vi.fn() }, false);
    try {
      expect(textOf(view.root)).toContain("Orientation");
      expect(textOf(view.root)).toContain("Practice: Orientation");
      byTest(view.root, "learning-progress-open").props.onClick();
      expect(actions.openCurrent).toHaveBeenCalledOnce();
      await byTest(view.root, "learning-progress-restart").props.onClick();
      await flush();
      expect(actions.restart, "the first click asks").not.toHaveBeenCalled();
      expect(textOf(byTest(view.root, "learning-progress-restart"))).toContain("Archive and restart");
      await byTest(view.root, "learning-progress-restart").props.onClick();
      expect(actions.restart).toHaveBeenCalledOnce();
      await byTest(view.root, "learning-progress-delete").props.onClick();
      await flush();
      expect(actions.deleteAttempt, "the first click asks").not.toHaveBeenCalled();
      expect(textOf(byTest(view.root, "learning-progress-delete"))).toContain("Delete for good");
      await byTest(view.root, "learning-progress-delete").props.onClick();
      expect(actions.deleteAttempt).toHaveBeenCalledOnce();
    } finally { view.app.unmount(); }
  });

  it("shows a loader until the first read answers, never a blank section", async () => {
    const { learning } = controller({ practice: () => list });
    const view = await mountAttempts({ practice: learning.practice, state: learning.state, readPractice: vi.fn() }, false);
    try {
      expect(byTest(view.root, "learning-attempts-loading")).toBeTruthy();
      expect(textOf(view.root)).toContain("Loading your lesson…");
    } finally { view.app.unmount(); }
  });

  it("says when nothing is in progress, and lists archived lessons with Delete", async () => {
    const { learning } = controller({ practice: () => ({ ...list, current: null }) });
    learning.setViewer("member");
    await learning.readPractice();
    const progress = await mountAttempts(learning, false);
    try { expect(byTest(progress.root, "learning-progress-empty")).toBeTruthy(); } finally { progress.app.unmount(); }
    const deleteArchived = vi.fn();
    const view = await mountAttempts({ deleteArchived, practice: learning.practice, state: learning.state, readPractice: vi.fn() }, true);
    try {
      expect(textOf(view.root)).toContain("Set yourself up");
      expect(textOf(view.root)).toContain("with practice project");
      await byTest(view.root, "learning-archived-delete").props.onClick();
      await flush();
      await byTest(view.root, "learning-archived-delete-confirm").props.onClick();
      expect(deleteArchived).toHaveBeenCalledWith(OTHER);
    } finally { view.app.unmount(); }
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

  it("completes a format 3 studio lesson like a format 2 one", async () => {
    const studio = () => { const value = lessonResult({ results: passedAll }); value.lesson = { ...value.lesson, schemaVersion: 3, stage: "studio" }; return value; };
    const { learning } = controller({ reads: studio });
    learning.setViewer("member");
    await learning.show({ attemptId: ATTEMPT, stepId: "tick" });
    expect([learning.lesson.value.stage, learning.complete]).toEqual(["studio", true]);
  });

  it("opens the Lesson pane's Lesson finished screen when the learner's own step result completes the lesson, only then", async () => {
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
    expect([learning.open, learning.finished, learning.lessonAttemptId]).toEqual([false, true, ATTEMPT]);
    // A later result on a lesson already complete opens nothing.
    await learning.show({ surface: "courses" });
    learning.minimise();
    await learning.done("read");
    await flush();
    expect([learning.open, learning.finished]).toEqual([false, false]);
  });

  async function mountPane(learning, host = learning) {
    const players = [];
    const reader = compiledUi(path.resolve("src/components/learning/Vibe64LearningReader.vue"), {
      vue: Vue, "@/lib/vibe64Learning.js": LearningLib, "./Vibe64LearningStep.vue": { default: stepUi(players) },
      "./Vibe64LearningMarkdown.vue": { default: { props: ["text"], setup: props => () => Vue.h("section", { "data-markdown": props.text }) } } });
    const pane = compiledUi(path.resolve("src/components/learning/Vibe64LearningLessonPane.vue"), {
      vue: Vue, "./Vibe64LearningReader.vue": { default: reader },
      "./Vibe64LearningFinished.vue": { default: { props: ["learning", "courses"], setup: () => () => Vue.h("section", { "data-test": "finished" }) } },
      "@/composables/useVibe64LearningCourses.js": { useVibe64LearningCourses: () => ({}) },
      "@/composables/useVibe64Learning.js": { useVibe64Learning: () => host } });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(pane) });
    for (const tag of WIDGETS) app.component(tag, widget);
    app.mount(root);
    await flush();
    return { app, root };
  }

  it("keeps the step in the Lesson pane for Teach me, and shows it again with the reason when Show me cannot show its place", async () => {
    const runGuide = vi.fn(async () => ({ guide: { shown: false } }));
    const { learning } = controller({ runGuide });
    learning.setViewer("member");
    await learning.openLesson({ attemptId: ATTEMPT, stepId: "preview" });
    // The pane's own controller, with openLesson observed.
    const openLesson = vi.fn(() => learning.openLesson());
    const host = Object.defineProperty(Object.create(learning), "openLesson", { value: openLesson });
    const view = await mountPane(learning, host);
    try {
      expect(byTest(view.root, "learning-lesson-pane")).toBeTruthy();
      expect(nodes(view.root).some(node => node.props?.["data-step-id"]), "the real reader, with its step list").toBe(true);
      await byTest(view.root, "learning-show-me").props.onClick();
      await flush();
      expect(runGuide).toHaveBeenCalledOnce();
      expect(textOf(view.root)).toContain("That place is not visible on this page.");
      expect(openLesson, "an unshown place selects the Lesson pane again").toHaveBeenCalled();
      expect(learning.open, "Show me never opens Courses").toBe(false);
      byTest(view.root, "learning-teach-me").props.onClick();
      expect(learning.colleagueRequest.value).toMatchObject({ stepId: "preview", message: VIBE64_LEARNING_TEACH_MESSAGE });
      expect([learning.open, learning.stepId], "Teach me leaves the step on screen").toEqual([false, "preview"]);
    } finally { view.app.unmount(); }
  });
});

describe("Lesson finished screen", () => {
  const COURSE = { courseId: "getting-started", release: "0.2.0", title: "Getting started", enabled: true, status: "released", topics: [],
    lessons: [{ code: "V64-START-01", hash: "h1", title: "Orientation", status: "published", required: true },
      { code: "V64-START-02", hash: "h2", title: "Your first change", status: "published", required: true }] };
  const pin = { course: { courseId: COURSE.courseId, release: COURSE.release }, lesson: { code: "V64-START-01", hash: "h1" } };
  const passed = ["quiz", "preview", "tick"].map(stepId => ({ stepId, outcome: "passed" }));

  async function mountFinished(learning, courses) {
    const finished = compiledUi(path.resolve("src/components/learning/Vibe64LearningFinished.vue"), {
      vue: Vue, "@mdi/js": { mdiCheckCircle: "check" },
      "@local/vibe64-training/client/course-progress": await import("../../packages/vibe64-training/src/client/courseProgress.js")
    });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(finished, { learning, courses }) });
    for (const tag of WIDGETS) app.component(tag, widget);
    app.mount(root);
    await flush(); await flush();
    return { app, root };
  }

  it("finishes (archives) the lesson once, then starts the next lesson or returns to Courses", async () => {
    let current = ATTEMPT;
    const { learning, calls } = controller({
      mode: () => ({ ...LEARN, currentAttemptId: current }),
      reads: () => lessonResult({ results: passed, attempt: { attemptId: ATTEMPT, ended: false, practiceSlug: "training-1111", pin } }),
      posts: url => { if (url === VIBE64_LEARNING_ROUTES.lessonFinish(ATTEMPT)) current = ""; return { ok: true, available: true }; } });
    learning.setViewer("member");
    await flush();
    await learning.showFinished();
    expect(learning.finished).toBe(true);
    const saved = Vue.ref({ ok: true, available: true, revision: 3, active: { attemptId: ATTEMPT, pin }, history: [],
      lessonProgress: [{ lessonCode: "V64-START-01", lessonHash: "h1", required: 3, passed: 3, completed: true, open: false }] });
    const startLesson = vi.fn(async () => ({ attemptId: OTHER, current: true }));
    const courses = { learningResource: { data: saved, reload: vi.fn(async () => { saved.value = { ...saved.value, revision: 4, active: null }; }) },
      coursesResource: { data: Vue.ref({ ok: true, available: true, courses: [COURSE] }) }, busy: Vue.ref(false), starting: Vue.ref(false), startLesson };
    const view = await mountFinished(learning, courses);
    try {
      const finishes = calls.filter(call => call.method === "POST" && call.url === VIBE64_LEARNING_ROUTES.lessonFinish(ATTEMPT));
      expect(finishes).toEqual([expect.objectContaining({ body: { expectedRevision: 3 } })]);
      expect(courses.learningResource.reload).toHaveBeenCalledOnce();
      expect(learning.mode.currentAttemptId, "Learn mode stays on with no lesson").toBe("");
      expect(learning.state.attemptId, "the screen keeps its lesson").toBe(ATTEMPT);
      expect(textOf(view.root)).toContain("Lesson finished");
      expect(textOf(view.root)).toContain("3 of 4 steps passed");
      expect(textOf(view.root)).toContain("Courses → Archived");
      expect(["learning-finished-keep", "learning-finished-archive", "learning-finished-delete", "learning-finished-read"]
        .map(id => byTest(view.root, id))).toEqual([undefined, undefined, undefined, undefined]);
      expect(textOf(byTest(view.root, "learning-finished-next"))).toContain("Next lesson: Your first change");
      await byTest(view.root, "learning-finished-next").props.onClick();
      await flush();
      expect(startLesson).toHaveBeenCalledWith({ courseId: COURSE.courseId, release: COURSE.release, lessonCode: "V64-START-02", expectedRevision: 4 },
        { onAdmitted: learning.admitted });
      expect([learning.state.attemptId, learning.open, learning.finished], "the next lesson opens in the Lesson pane").toEqual([OTHER, false, false]);
    } finally { view.app.unmount(); }
  });

  it("offers Back to courses, which leaves the finished lesson", async () => {
    let current = ATTEMPT;
    const { learning } = controller({ mode: () => ({ ...LEARN, currentAttemptId: current }),
      reads: () => lessonResult({ results: passed, attempt: { attemptId: ATTEMPT, ended: false, practiceSlug: "training-1111", pin } }),
      posts: () => { current = ""; return { ok: true }; } });
    learning.setViewer("member");
    await flush();
    await learning.showFinished();
    const courses = { learningResource: { data: Vue.ref({ ok: true, available: true, revision: 3, active: null, history: [] }), reload: vi.fn() },
      coursesResource: { data: Vue.ref({ ok: true, available: true, courses: [] }) }, busy: Vue.ref(false), starting: Vue.ref(false), startLesson: vi.fn() };
    const view = await mountFinished(learning, courses);
    try {
      expect(byTest(view.root, "learning-finished-next"), "no next lesson in an unknown course").toBeUndefined();
      await byTest(view.root, "learning-finished-courses").props.onClick();
      expect([learning.surface, learning.finished, learning.attemptId]).toEqual(["courses", false, ""]);
    } finally { view.app.unmount(); }
  });

  it("shows a refused finish with a retry", async () => {
    const { learning } = controller({ reads: () => lessonResult({ results: passed }), posts: () => ({ ok: false, error: "Not complete." }) });
    learning.setViewer("member");
    await flush();
    await learning.showFinished();
    const courses = { learningResource: { data: Vue.ref(null), reload: vi.fn() }, coursesResource: { data: Vue.ref(null) },
      busy: Vue.ref(false), starting: Vue.ref(false), startLesson: vi.fn() };
    const view = await mountFinished(learning, courses);
    try {
      expect(textOf(view.root)).toContain("Not complete.");
      expect(textOf(view.root)).not.toContain("Courses → Archived");
    } finally { view.app.unmount(); }
  });
});

// A lesson whose first step plays beats and whose self step ends in its check beat.
const beatsLesson = () => {
  const value = lessonResult();
  value.lesson.steps[0] = { ...value.lesson.steps[0], beats: [
    { kind: "show", target: "preview", text: "This is your app." }, { kind: "show", target: "lesson-bar", text: "This bar guides you." }] };
  value.lesson.steps[3] = { ...value.lesson.steps[3], beats: [{ kind: "check", target: "done", text: "Press Done when it is green." }] };
  return value;
};

const STEP_BAR_ICONS = Object.freeze({ mdiBookOpenPageVariantOutline: "book", mdiChevronLeft: "left",
  mdiChevronRight: "right", mdiPause: "pause", mdiPlay: "play", mdiSchoolOutline: "school" });
// The step bar over a host layout.
function mountStepBar(learning, accounts = { aiOnboardingAvailable: Vue.ref(true),
  aiOnboardingNeeded: Vue.ref(false), requestVibe64AiOnboarding: vi.fn(() => true) }) {
  const bar = compiledUi(path.resolve("src/components/learning/Vibe64LearningStepBar.vue"), {
    vue: Vue, "@mdi/js": STEP_BAR_ICONS,
    "@/composables/useVibe64Learning.js": { useVibe64Learning: () => learning },
    "@local/vibe64-accounts/client": accounts });
  const root = { children: [] };
  const app = uiRenderer().createApp({ render: () => Vue.h(bar) });
  for (const tag of WIDGETS) app.component(tag, widget);
  app.mount(root);
  return { root, app };
}

describe("Lesson step bar", () => {
  it("does a do beat for the learner, detects it in the practice project and records a self step done once all are detected", async () => {
    const pageActivity = createPageActivity();
    const sendLessonMessage = vi.fn(async () => true);
    const colleagueView = Vue.shallowRef({ projectSlug: "practice-one", sessionId: "s1", sendLessonMessage });
    const reads = () => {
      const value = lessonResult();
      value.lesson.steps[3] = { ...value.lesson.steps[3], beats: [
        { kind: "do", target: "send-message", prompt: "Make it green", text: "Ask it: \"Make it green\"" },
        { kind: "do", target: "colleague", text: "Open Colleague." }, { kind: "do", target: "save", text: "Save." },
        { kind: "do", target: "agent-finished", text: "Wait for the agent." }] };
      return value;
    };
    const { learning, calls } = controller({ reads, colleagueView, pageActivity, pageFocus: Vue.shallowRef(null) });
    learning.setViewer("member");
    await flush();
    learning.selectStep("tick");
    await flush();
    expect(["send-message", "colleague", "save", "agent-finished"].map(target => learning.doItForMeKind({ kind: "do", target })))
      .toEqual(["send", "colleague", "point", ""]);
    expect(await learning.doItForMe()).toBe(true);
    expect(sendLessonMessage).toHaveBeenCalledWith("Make it green");
    pageActivity.report("message-sent", { projectSlug: "practice-one", sessionId: "s1" });
    expect(learning.player.confirmed).toBe("✓ Done.");
    learning.player.next();
    expect(await learning.doItForMe()).toBe(true);
    expect(learning.colleagueRequest.value, "Colleague opens and sends nothing").toMatchObject({ kind: "open", stepId: "tick" });
    expect(learning.colleagueRequest.value.message).toBeUndefined();
    pageActivity.report("colleague-opened", { projectSlug: "practice-one" });
    learning.player.next();
    pageActivity.report("saved", { projectSlug: "practice-one" });
    learning.player.next();
    expect(calls.some(call => call.url === VIBE64_LEARNING_ROUTES.stepDone(ATTEMPT)), "not before every do beat").toBe(false);
    pageActivity.report("agent-finished", { projectSlug: "practice-one" });
    await flush();
    expect(calls.filter(call => call.method === "POST").at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.stepDone(ATTEMPT), body: { stepId: "tick" } });
    // Without the practice project's session view nothing is sent.
    colleagueView.value = { projectSlug: "elsewhere", sendLessonMessage };
    learning.selectStep("tick");
    expect(await learning.doItForMe()).toBe(false);
    expect(sendLessonMessage).toHaveBeenCalledTimes(1);
  });

  it("offers I'm stuck on a step its own check decides, and asks Colleague with the fixed message", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await flush();
    const { root, app } = mountStepBar(learning);
    try {
      learning.selectStep("tick");
      await flush();
      expect(byTest(root, "learning-step-bar-stuck"), "a self step without do beats is the learner's own verdict").toBeUndefined();
      learning.selectStep("preview");
      await flush();
      byTest(root, "learning-step-bar-stuck").props.onClick();
      expect(learning.colleagueRequest.value).toMatchObject({ kind: "stuck", message: LearningLib.VIBE64_LEARNING_STUCK_MESSAGE,
        stepId: "preview", attemptId: ATTEMPT });
      expect(LearningLib.VIBE64_LEARNING_STUCK_MESSAGE).toBe("I'm stuck on this step.");
    } finally { app.unmount(); }
  });

  it("checks a review step's work with the learner's AI and shows its verdict, hint and saved pass", async () => {
    let passed = false;
    const reads = () => {
      const value = lessonResult(passed ? { results: [{ stepId: "tick", outcome: "passed", kind: "review",
        review: { comment: "Clean change." } }] } : {});
      value.lesson.steps[3] = { ...value.lesson.steps[3], check: { kind: "review", rubric: "The heading is green.", evidence: ["changes"] },
        beats: [{ kind: "do", target: "send-message", prompt: "Make it green", text: "Ask it: \"Make it green\"" },
          { kind: "check", target: "review", text: "" }] };
      return value;
    };
    const posts = vi.fn(async url => url === VIBE64_LEARNING_ROUTES.stepReview(ATTEMPT) ? (passed
      ? { ok: true, stepId: "tick", outcome: "passed", recorded: true, review: { comment: "Clean change." } }
      : { ok: true, stepId: "tick", outcome: "not-yet-passed", recorded: true, review: { comment: "The box lost its border.", hint: "Keep the border." } })
      : { ok: true });
    const { learning, calls } = controller({ reads, posts });
    learning.setViewer("member");
    await flush();
    const { root, app } = mountStepBar(learning);
    try {
      learning.selectStep("tick", 1);
      await flush();
      expect(textOf(byTest(root, "learning-step-bar-beat")), "a review check's line is the rubric").toBe("The heading is green.");
      expect(textOf(byTest(root, "learning-step-bar-verdict")).trim()).toBe("Check my work");
      await byTest(root, "learning-step-bar-verdict").props.onClick();
      await flush();
      expect(calls.filter(call => call.method === "POST").at(-1)).toMatchObject({ url: VIBE64_LEARNING_ROUTES.stepReview(ATTEMPT), body: { stepId: "tick" } });
      expect(textOf(byTest(root, "learning-step-bar-note"))).toBe("Not yet: The box lost its border. Hint: Keep the border.");
      expect(textOf(byTest(root, "learning-step-bar-verdict")).trim()).toBe("Check again");
      passed = true;
      await byTest(root, "learning-step-bar-verdict").props.onClick();
      await flush();
      expect(textOf(byTest(root, "learning-step-bar-beat"))).toBe("Passed ✓ Clean change.");
      expect(byTest(root, "learning-step-bar-verdict"), "a pass is final").toBeUndefined();
      expect(LearningLib.reviewNote({ outcome: "not-yet-passed", recorded: false, reason: "No changes yet. Change your practice project first, then check your work again." }))
        .toBe("No changes yet. Change your practice project first, then check your work again.");
    } finally { app.unmount(); }
  });

  it("opens Colleague for an open request without sending anything", async () => {
    const learning = { colleagueRequest: Vue.shallowRef(null), consumeColleagueRequest(id) {
      const value = this.colleagueRequest.value?.id === id ? this.colleagueRequest.value : null;
      this.colleagueRequest.value = null;
      return value;
    } };
    const reveal = vi.fn(async () => true);
    const send = vi.fn(async () => true);
    const stop = watchColleagueLearningRequests({ learning, actorKey: () => "member", reveal, send, report: vi.fn() });
    learning.colleagueRequest.value = { id: "open-1", kind: "open", actorKey: "member" };
    await flush();
    expect([reveal.mock.calls.length, send.mock.calls.length]).toEqual([1, 0]);
    stop();
  });

  it("shows the current lesson's step in Learn mode and moves through steps, with no Open and no collapse", async () => {
    let on = true;
    const { learning } = controller({ mode: () => ({ ...LEARN, on }) });
    learning.setViewer("member");
    await flush();
    const { root, app } = mountStepBar(learning);
    try {
      await flush();
      expect(textOf(byTest(root, "learning-step-bar"))).toContain("Step 1 of 4: Read");
      expect(textOf(root)).toContain("Orientation");
      expect(byTest(root, "learning-step-bar-previous").props.disabled).toBe(true);
      byTest(root, "learning-step-bar-next").props.onClick();
      await flush();
      expect(learning.stepId).toBe("quiz");
      expect(textOf(root)).toContain("Not checked yet");
      expect(byTest(root, "learning-step-bar-open"), "the bar's Lesson button opens the lesson; it has no Open").toBeUndefined();
      expect([byTest(root, "learning-step-bar-toggle"), learning.toggleStepBar], "the bar is always its one line").toEqual([undefined, undefined]);
      expect(textOf(root)).toContain("Step 2 of 4: Quiz");
      on = false;
      await learning.readLearningMode();
      await flush();
      expect(byTest(root, "learning-step-bar"), "Develop shows no lesson").toBeUndefined();
    } finally { app.unmount(); }
  });

  it("offers Lesson beside a practice project's panes, pressed while the Lesson pane shows, and opens the lesson", async () => {
    const layout = Vue.shallowRef({ projectSlug: "practice-one", lessonPane: false, showProject: vi.fn() });
    const router = { currentRoute: Vue.ref({ fullPath: "/app/project/practice-one" }), push: vi.fn(async () => {}) };
    const { learning } = controller({ layout, router });
    learning.setViewer("member");
    await flush();
    const { root, app } = mountStepBar(learning);
    try {
      await flush();
      const lesson = () => byTest(root, "learning-step-bar-lesson");
      expect([textOf(lesson()).trim(), lesson().props["aria-pressed"], lesson().props["data-vibe64-guide"]]).toEqual(["Lesson", "false", "lesson"]);
      await lesson().props.onClick();
      await flush();
      expect(router.push, "Lesson opens the lesson's Lesson pane").toHaveBeenLastCalledWith("/app/project/practice-one?pane=lesson");
      layout.value = { ...layout.value, lessonPane: true };
      await flush();
      expect(lesson().props["aria-pressed"], "pressed while the Lesson pane shows").toBe("true");
      layout.value = { ...layout.value, projectSlug: "" };
      await flush();
      expect(lesson(), "a lesson without a practice project is its only pane").toBeUndefined();
    } finally { app.unmount(); }
  });

  it("plays a step's beats with dots, moves by beat, and ends on the step's own verdict control", async () => {
    const { learning, calls } = controller({ reads: () => beatsLesson() });
    learning.setViewer("member");
    await flush();
    const { root, app } = mountStepBar(learning);
    try {
      await flush();
      expect(textOf(byTest(root, "learning-step-bar-beat"))).toBe("This is your app.");
      expect(textOf(root)).toContain("1/4");
      expect(byTest(root, "learning-step-bar-dots").props["aria-label"]).toBe("Part 1 of 2");
      expect(byTest(root, "learning-step-bar-pause")).toBeDefined();
      expect(byTest(root, "learning-step-bar-previous").props.disabled).toBe(true);
      byTest(root, "learning-step-bar-next").props.onClick();
      await flush();
      expect(textOf(byTest(root, "learning-step-bar-beat"))).toBe("This bar guides you.");
      expect(JSON.parse(saved.get("vibe64:learning-environment:v2:member")).beat, "the beat is this tab's place").toBe(1);
      byTest(root, "learning-step-bar-next").props.onClick();
      await flush();
      // A reading step after its last beat: its own Mark as done, then Next step once done.
      expect(textOf(byTest(root, "learning-step-bar-verdict"))).toContain("Mark as done");
      expect(byTest(root, "learning-step-bar-pause"), "nothing to pause after the beats").toBeUndefined();
      learning.selectStep("tick");
      await flush();
      expect(textOf(byTest(root, "learning-step-bar-beat"))).toBe("Press Done when it is green.");
      await byTest(root, "learning-step-bar-verdict").props.onClick();
      expect(calls.some(call => call.url === VIBE64_LEARNING_ROUTES.stepDone(ATTEMPT) && call.body.stepId === "tick")).toBe(true);
      // Show me on a step with beats plays it in the bar from its first beat.
      expect(await learning.showMe("read")).toEqual({ beats: true });
      await flush();
      expect([learning.stepId, learning.state.beat]).toEqual(["read", 0]);
    } finally { app.unmount(); }
  });

  it("says a lesson waits for the learner's AI instead of playing beats, and a lesson message with no AI was not sent", async () => {
    const waiting = "This lesson's practice project needs your AI, which isn't set up yet.";
    let failure = { code: LearningLib.VIBE64_LEARNING_AI_REQUIRED_CODE, message: waiting };
    const reads = () => {
      const value = beatsLesson();
      value.attempt = { ...value.attempt, preparation: { phase: "preparing", ...(failure ? { failure } : {}) } };
      value.lesson.steps[1] = { ...value.lesson.steps[1], beats: [{ kind: "do", target: "send-message", prompt: "Make it green", text: "Ask it" }] };
      return value;
    };
    const { learning } = controller({ reads });
    learning.setViewer("member");
    await flush();
    const accounts = { aiOnboardingAvailable: Vue.ref(true), aiOnboardingNeeded: Vue.ref(true), requestVibe64AiOnboarding: vi.fn(() => true) };
    const { root, app } = mountStepBar(learning, accounts);
    try {
      await flush();
      expect(learning.aiRequired).toBe(true);
      expect(textOf(byTest(root, "learning-step-bar-ai-required"))).toBe(waiting);
      for (const id of ["learning-step-bar-beat", "learning-step-bar-pause", "learning-step-bar-verdict", "learning-step-bar-do-it"]) {
        expect(byTest(root, id), id).toBeUndefined();
      }
      byTest(root, "learning-step-bar-set-up-ai").props.onClick();
      expect(accounts.requestVibe64AiOnboarding).toHaveBeenCalledTimes(1);
      // Prepared (or a different failure): the beats play again.
      failure = { code: "VIBE64_TRAINING_SETUP_INCOMPLETE", message: "Setup is incomplete." };
      await learning.loadLesson(ATTEMPT);
      await flush();
      expect(learning.aiRequired).toBe(false);
      expect(textOf(byTest(root, "learning-step-bar-beat"))).toBe("This is your app.");
      expect(byTest(root, "learning-step-bar-set-up-ai")).toBeUndefined();
      // Do it for me on a lesson message, with no practice session view and no AI.
      learning.selectStep("quiz", 0);
      await flush();
      await byTest(root, "learning-step-bar-do-it").props.onClick();
      await flush();
      expect(textOf(byTest(root, "learning-step-bar-note"))).toBe("No AI is connected yet, so nothing was sent. Set up your AI, or press Next.");
      expect(byTest(root, "learning-step-bar-set-up-ai")).toBeDefined();
      accounts.aiOnboardingNeeded.value = false;
      await byTest(root, "learning-step-bar-do-it").props.onClick();
      await flush();
      expect(textOf(byTest(root, "learning-step-bar-note"))).toBe("That could not be sent here. Send it yourself, or press Next.");
      expect(byTest(root, "learning-step-bar-set-up-ai")).toBeUndefined();
    } finally { app.unmount(); }
  });

  it("shows a step without beats with its own verdict control at once", async () => {
    const { learning } = controller();
    learning.setViewer("member");
    await flush();
    const { root, app } = mountStepBar(learning);
    try {
      await flush();
      const labels = {};
      for (const stepId of ["read", "quiz", "preview", "tick"]) {
        learning.selectStep(stepId);
        await flush();
        labels[stepId] = textOf(byTest(root, "learning-step-bar-verdict") || { text: "", children: [] }).trim();
      }
      expect(labels).toEqual({ read: "Mark as done", quiz: "Answer in Lesson", preview: "Check my work", tick: "Done" });
    } finally { app.unmount(); }
  });

  it("offers Check now on a fact step's bar", async () => {
    const lesson = { schemaVersion: 3, stage: "studio", code: "V64-WELCOME", title: "Welcome", steps: [
      { id: "ai", title: "Your AI", bodyText: "Press Check now.", required: true, check: { kind: "fact", fact: "ai-ready" } }] };
    const { learning } = controller({ reads: () => lessonResult({ lesson }) });
    learning.setViewer("member");
    await flush();
    const { root, app } = mountStepBar(learning);
    try {
      await flush();
      expect(textOf(byTest(root, "learning-step-bar-verdict")).trim()).toBe("Check now");
    } finally { app.unmount(); }
  });
});

describe("Learning route hold", () => {
  it("holds a practice page from the L press, cancels its requests in flight and drops a refusal from the mode it left", async () => {
    const { QueryClient } = await import("@tanstack/vue-query");
    const HostKeys = await import("../../src/lib/vibe64AssistantHost.js");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const scope = slug => ["project", slug];
    let on = true;
    let answerSwitch = null;
    const route = Vue.reactive({ path: "/app/project/training-1111", fullPath: "/app/project/training-1111", params: { slug: "training-1111" } });
    const router = { currentRoute: { get value() { return route; } }, push: vi.fn(async () => {}) };
    const { learning } = controller({ router, mode: (_url, method, body) => {
      if (method === "POST") on = body.on;
      return { ...LEARN, on, practiceSlug: "training-1111" };
    } });
    const hold = compiledUi(path.resolve("src/components/learning/Vibe64LearningRouteHold.vue"), {
      vue: Vue,
      "vue-router": { useRoute: () => route },
      "@tanstack/vue-query": { useQueryClient: () => queryClient },
      "@/lib/vibe64AssistantHost.js": HostKeys,
      "@/lib/vibe64ProjectScope.js": { projectSlugFromRoute: value => String(value?.params?.slug || ""), vibe64ProjectQueryScope: scope },
      "@/lib/vibe64Learning.js": LearningLib,
      "@/composables/useVibe64Learning.js": { useVibe64Learning: () => learning }
    });
    vi.stubGlobal("window", { sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => null, setItem() {} } });
    const sessionsKey = ["vibe64", ...scope("training-1111"), "app", "public", "sessions"];
    const refusedKey = ["vibe64", ...scope("training-1111"), "app", "public", "session", "s1", "detail"];
    const otherKey = ["vibe64", ...scope("my-shop"), "app", "public", "sessions"];
    queryClient.setQueryData(sessionsKey, { sessions: ["kept"] });
    queryClient.setQueryData(otherKey, { sessions: ["other"] });
    const viewer = Vue.ref({ actorKey: "member" });
    const root = { children: [] };
    const app = uiRenderer().createApp({ render: () => Vue.h(hold, null, { default: () => Vue.h("main", { "data-test": "page" }) }) });
    app.provide(HostKeys.VIBE64_ASSISTANT_VIEWER_KEY, viewer);
    app.mount(root);
    try {
      learning.setViewer("member");
      await flush();
      expect(byTest(root, "page"), "the practice page shows in Learn").toBeTruthy();
      // A session-list refresh is in flight, and another tab's switch already had a detail refused.
      let aborted = false;
      const refresh = queryClient.fetchQuery({ queryKey: sessionsKey, staleTime: 0, queryFn: ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); });
      }) });
      await queryClient.fetchQuery({ queryKey: refusedKey, queryFn: async () => {
        throw Object.assign(new Error(LearningLib.VIBE64_DEVELOP_MODE_NOTE), { code: LearningLib.VIBE64_LEARNING_MODE_PROJECT_CODE });
      } }).catch(() => null);
      // L: the page goes at the press, before the server answers the switch.
      router.push = vi.fn(() => new Promise(resolve => { answerSwitch = resolve; }));
      const switching = learning.toggleMode();
      await flush();
      expect(learning.state.modeBusy).toBe("set");
      expect(byTest(root, "page"), "held while L switches").toBeUndefined();
      await refresh.catch(() => null);
      expect(aborted, "the refresh in flight is cancelled").toBe(true);
      expect(queryClient.getQueryState(sessionsKey)).toMatchObject({ data: { sessions: ["kept"] }, error: null, status: "success" });
      expect(queryClient.getQueryState(refusedKey), "the refusal is not kept for the project's return").toBeUndefined();
      expect(queryClient.getQueryData(otherKey), "other projects are untouched").toEqual({ sessions: ["other"] });
      answerSwitch?.();
      await switching;
      await flush();
      expect(learning.learnMode).toBe(false);
      expect(byTest(root, "page"), "Develop never shows the practice project").toBeUndefined();
      // Develop shows the learner's own projects.
      Object.assign(route, { path: "/app/project/my-shop", fullPath: "/app/project/my-shop", params: { slug: "my-shop" } });
      await flush();
      expect(byTest(root, "page")).toBeTruthy();
    } finally { app.unmount(); queryClient.clear(); }
  });
});
