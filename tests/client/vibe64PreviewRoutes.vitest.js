import { describe, expect, it } from "vitest";

import {
  previewRouteHasParams,
  previewRouteInitialFormValues,
  previewRouteParams,
  previewRoutePath,
  previewRoutesForTarget
} from "../../src/lib/vibe64PreviewRoutes.js";

describe("Vibe64 preview routes", () => {
  it("uses only adapter-declared preview routes", () => {
    expect(previewRoutesForTarget({
      previewRoutes: [
        { id: "home", label: "Home", pathTemplate: "/home" },
        { label: "Broken route", pathTemplate: "/broken" },
        { id: "missing-path", label: "Missing path" }
      ]
    })).toEqual([
      { id: "home", label: "Home", pathTemplate: "/home" }
    ]);
  });

  it("resolves parameterized route templates", () => {
    const route = {
      id: "job",
      pathTemplate: "/w/:workspaceSlug/admin/jobs/:jobId",
      params: [
        {
          defaultValue: "mercmobily",
          name: "workspaceSlug"
        },
        {
          label: "Job",
          name: "jobId"
        }
      ]
    };

    expect(previewRouteHasParams(route)).toBe(true);
    expect(previewRouteInitialFormValues(route)).toEqual({
      jobId: "",
      workspaceSlug: "mercmobily"
    });
    expect(previewRoutePath(route, {
      jobId: "11514",
      workspaceSlug: "merc mobily"
    })).toEqual({
      missingParam: "",
      ok: true,
      path: "/w/merc%20mobily/admin/jobs/11514"
    });
    expect(previewRoutePath(route, {
      workspaceSlug: "mercmobily"
    })).toMatchObject({
      missingParam: "jobId",
      ok: false
    });
  });

  it("infers missing parameter metadata from the route template", () => {
    expect(previewRouteParams({
      id: "job",
      pathTemplate: "/w/:workspaceSlug/admin/jobs/:jobId"
    })).toEqual([
      {
        label: "Workspace Slug",
        name: "workspaceSlug",
        placeholder: "workspaceSlug",
        required: true
      },
      {
        label: "Job Id",
        name: "jobId",
        placeholder: "jobId",
        required: true
      }
    ]);
  });
});


// The supplied Training projections use the original server operations. These
// component cases leave the Preview route assertions above unchanged.
import { renderToString } from "@vue/server-renderer";
import { createRenderer, createSSRApp, h, nextTick, ssrContextKey } from "vue";
import { createVuetify } from "vuetify";
import { afterEach, vi } from "vitest";
import TrainingLessonPicker from "../../packages/vibe64-training/src/client/TrainingLessonPicker.vue";
import TrainingCoursePage from "../../packages/vibe64-training/src/client/TrainingCoursePage.vue";
import TrainingCourseCreator from "../../packages/vibe64-training/src/client/TrainingCourseCreator.vue";
import TrainingStartFeedback from "../../packages/vibe64-training/src/client/TrainingStartFeedback.vue";
import { courseProgress } from "../../packages/vibe64-training/src/client/courseProgress.js";

const pickerHash = "c".repeat(64);
const savedId = "11111111-1111-4111-8111-111111111111";
function pickerCatalogue() {
  return { ok: true, available: true, revision: 3, courses: [
    { courseId: "getting-started", release: "0.1.7", title: "Getting started", status: "released", enabled: true,
      topics: [{ topicId: "intro", release: "0.1.7", title: "Introduction" }], lessons: [
      { code: "V64-START-00", title: "Connect your first AI", hash: pickerHash, topicId: "intro", topicRelease: "0.1.7", status: "published", required: true },
      { code: "V64-START-01", title: "Explore Vibe64", hash: "d".repeat(64), topicId: "intro", topicRelease: "0.1.7", status: "published", required: true }
    ] }
  ] };
}
function pickerLearning(active = null) {
  return { ok: true, available: true, revision: 9, activeSummaryCurrent: true, active, completion: null, history: [] };
}
function pickerAttempt() {
  return { attemptId: savedId, pin: {
    course: { courseId: "getting-started", release: "0.1.6" },
    topic: { topicId: "intro", release: "0.1.6", commit: "a".repeat(40), topicHash: "b".repeat(64) },
    lesson: { code: "V64-START-00", hash: pickerHash }
  }, projectSlug: "", preparation: { phase: "reserved" }, learning: { submissions: [], resume: null } };
}
async function renderPicker(props = {}, component = TrainingLessonPicker) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify());
  return renderToString(app);
}
function renderCoursePage(course = pickerCatalogue().courses[0], { lessonProgress = [], active = null, ...props } = {}) {
  return renderPicker({ course, progress: courseProgress(course, lessonProgress, active), startAllowed: true, resumeAllowed: true, ...props }, TrainingCoursePage);
}
let pickerApp;
afterEach(() => { pickerApp?.unmount(); pickerApp = null; });
function mountPicker(props = {}, component = TrainingLessonPicker) {
  pickerApp = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...component, render: () => null }, component === TrainingLessonPicker ? {
      catalogueResult: pickerCatalogue(), learningResult: pickerLearning(), canStart: true, canResume: true, ...props
    } : props);
  pickerApp.provide(ssrContextKey, { modules: new Set() });
  pickerApp.mount({});
  return pickerApp._instance.setupState;
}
function selectFirst(state) {
  state.selectionId = state.choiceId(state.courses[0], state.courses[0].lessons[0]);
}

describe("Training lesson picker prerequisite", () => {
  it("shows exact installed release/hash in original lesson order without auto-selecting or starting", async () => {
    const start = vi.fn();
    const state = mountPicker({ onStart: start });
    expect(state.selected).toBeNull();
    expect(state.startEnabled).toBeFalsy();
    expect(start).not.toHaveBeenCalled();
    const html = await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: pickerLearning(), canStart: true });
    expect(html).toContain('aria-label="Courses"');
    expect(html).toContain("getting-started · 0.1.7");
    expect(html).toContain("0 of 2 lessons complete");
    expect(html).toContain("View course");
    const page = await renderCoursePage();
    expect(page).toContain("Back to courses");
    expect(page).toContain("Introduction");
    expect(page).toContain(pickerHash);
    expect(page.indexOf("V64-START-00")).toBeLessThan(page.indexOf("V64-START-01"));
    expect(page).toContain("Start next lesson");
  });

  it("emits only the existing start input's captured exact choice and learner revision", async () => {
    const start = vi.fn();
    const state = mountPicker({ onStart: start });
    selectFirst(state);
    state.requestStart();
    expect(start).toHaveBeenCalledExactlyOnceWith({ courseId: "getting-started", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 9 });
    const captured = start.mock.calls[0][0];
    pickerApp._instance.props.catalogueResult = { ...pickerCatalogue(), courses: [] };
    pickerApp._instance.props.learningResult = { ...pickerLearning(), revision: 10 };
    await nextTick();
    expect(state.selected).toBeNull();
    state.requestStart();
    expect(start).toHaveBeenCalledOnce();
    expect(captured).toEqual({ courseId: "getting-started", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 9 });
  });

  it("retires selection when the exact displayed lesson hash changes instead of retargeting it", async () => {
    const start = vi.fn();
    const state = mountPicker({ onStart: start });
    selectFirst(state);
    const changed = pickerCatalogue();
    changed.courses[0].lessons[0].hash = "e".repeat(64);
    pickerApp._instance.props.catalogueResult = changed;
    await nextTick();
    expect(state.selectionId).toBe("");
    expect(state.selected).toBeNull();
    state.requestStart();
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["disabled", "preview", "draft"])("displays %s choices without emitting a new start", async (kind) => {
    const catalogue = pickerCatalogue();
    if (kind === "disabled") catalogue.courses[0].enabled = false;
    if (kind === "preview") catalogue.courses[0].status = "preview";
    if (kind === "draft") catalogue.courses[0].lessons[0].status = "draft";
    const start = vi.fn();
    const state = mountPicker({ catalogueResult: catalogue, onStart: start });
    selectFirst(state);
    state.requestStart();
    expect(start).not.toHaveBeenCalled();
    const html = kind === "draft" ? await renderCoursePage(catalogue.courses[0])
      : await renderPicker({ catalogueResult: catalogue, learningResult: pickerLearning(), canStart: true });
    expect(html).toContain(kind === "disabled" ? "Disabled for new lessons" : kind === "preview" ? "Preview course" : "Draft — unavailable for new lessons");
  });

  it("offers Start lesson on a preview course only when courses.list reports the person may try previews", async () => {
    const catalogue = pickerCatalogue();
    catalogue.courses[0].status = "preview";
    const owner = { ...catalogue, canTryPreviews: true };
    const start = vi.fn();
    const state = mountPicker({ catalogueResult: owner, onStart: start });
    state.startLesson(owner.courses[0], owner.courses[0].lessons[0]);
    expect(start).toHaveBeenCalledExactlyOnceWith({ courseId: "getting-started", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 9 });
    const ownerCard = await renderPicker({ catalogueResult: owner, learningResult: pickerLearning(), canStart: true });
    expect(ownerCard).toContain("Start lesson");
    expect(ownerCard).toContain("Preview course");
    expect(ownerCard).not.toContain("the workspace owner can try it");
    const ownerPage = await renderPicker({ course: owner.courses[0], canTryPreviews: true, startAllowed: true, resumeAllowed: true,
      progress: courseProgress(owner.courses[0], [], null, [], { canTryPreviews: true }) }, TrainingCoursePage);
    expect(ownerPage).toContain("Start next lesson");
    expect(ownerPage).toContain("Start lesson");

    const memberCard = await renderPicker({ catalogueResult: catalogue, learningResult: pickerLearning(), canStart: true });
    expect(memberCard).toContain("Preview — the workspace owner can try it; it becomes startable when released.");
    expect(memberCard).not.toContain("Start lesson");
    const memberPage = await renderCoursePage(catalogue.courses[0]);
    expect(memberPage).toContain("Preview — the workspace owner can try it; it becomes startable when released.");
    expect(memberPage).not.toContain("Start lesson");
    expect(memberPage).not.toContain("Start next lesson");

    const released = await renderPicker({ catalogueResult: { ...pickerCatalogue(), canTryPreviews: true }, learningResult: pickerLearning(), canStart: true });
    expect(released).not.toContain("Try preview");
    expect(released).toContain("Start lesson");
  });

  it("resumes the exact saved attempt independently of disabled or missing current catalogue release", () => {
    const resume = vi.fn();
    const start = vi.fn();
    const state = mountPicker({ catalogueResult: { ...pickerCatalogue(), courses: [] }, learningResult: pickerLearning(pickerAttempt()), onResume: resume, onStart: start });
    expect(state.resumeEnabled).toBeTruthy();
    state.requestResume();
    expect(resume).toHaveBeenCalledExactlyOnceWith({ attemptId: savedId });
    state.requestStart();
    expect(start).not.toHaveBeenCalled();
  });

  it("does not infer resume support from a saved attempt or hide read-only ended history", async () => {
    const attempt = pickerAttempt();
    const learning = pickerLearning(attempt);
    learning.history = [{ ...pickerAttempt(), attemptId: "22222222-2222-4222-8222-222222222222", ended: { reason: "restart", revision: 4, requestId: "end-one" } }];
    const resume = vi.fn();
    const state = mountPicker({ catalogueResult: { ...pickerCatalogue(), courses: [] }, learningResult: learning, canResume: false, onResume: resume });
    state.requestResume();
    expect(resume).not.toHaveBeenCalled();
    const html = await renderPicker({ catalogueResult: { ...pickerCatalogue(), courses: [] }, learningResult: learning, canResume: false });
    expect(html).toContain("Your lesson remains visible.");
    expect(html).toContain("Saved lesson history (1)");
    expect(html).toContain("22222222-2222-4222-8222-222222222222");
    expect(html).toContain("Ended attempt");
    expect(html).not.toContain("This lesson is complete.");
  });

  it("shows only supplied matching completion counts and refuses a mismatched saved lesson result", async () => {
    const learning = pickerLearning(pickerAttempt());
    learning.completion = { lessonCode: "V64-START-00", lessonHash: pickerHash, required: 3, passed: 2, completed: false };
    const html = await renderPicker({ learningResult: learning });
    expect(html).toContain("2 of 3 required steps passed. Continue the remaining steps.");
    expect(html).not.toContain("This lesson is complete.");
    const done = await renderPicker({ learningResult: { ...learning, completion: { ...learning.completion, passed: 3, completed: true } } });
    expect(done).toContain("3 of 3 required steps passed. This lesson is complete.");
    const resume = vi.fn();
    learning.completion = { ...learning.completion, lessonHash: "f".repeat(64) };
    const state = mountPicker({ learningResult: learning, onResume: resume });
    expect(state.learningInvalid).toBe(true);
    state.requestResume();
    expect(resume).not.toHaveBeenCalled();
    expect(await renderPicker({ learningResult: learning })).toContain("Saved learning could not be displayed.");
  });

  it("shows truthful initial loading, unavailable, empty, corrupt and explicit read-error states", async () => {
    const loading = await renderPicker({ catalogueLoading: true, learningLoading: true });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('aria-label="Loading installed courses"');
    expect(loading).toContain('aria-label="Loading saved lesson"');
    expect(loading).not.toContain("No courses are installed.");
    expect(await renderPicker({ catalogueResult: { ok: false, available: false, error: "Courses unavailable" } })).toContain("Courses unavailable");
    expect(await renderPicker({ catalogueResult: { ok: true, available: true, revision: 0, courses: [] }, learningResult: pickerLearning() })).toContain("No courses are installed.");
    expect(await renderPicker({ catalogueResult: { ok: true, available: true, revision: 1, courses: [{}] } })).toContain("Installed courses could not be displayed.");
    expect(await renderPicker({ catalogueError: "Pinned catalogue is corrupt", learningError: "Saved learning cannot load" })).toContain("Pinned catalogue is corrupt");
    expect(await renderPicker({ catalogueError: "Pinned catalogue is corrupt", learningError: "Saved learning cannot load" })).toContain("Saved learning cannot load");
  });

  it.each(["busy", "catalogueLoading", "learningLoading", "catalogueError", "learningError", "canStart"])("does not dispatch a start through %s", (gate) => {
    const start = vi.fn();
    const props = { onStart: start, [gate]: gate.endsWith("Error") ? "Read unavailable" : gate === "canStart" ? false : true };
    const state = mountPicker(props);
    selectFirst(state);
    state.requestStart();
    expect(start).not.toHaveBeenCalled();
  });

  it("shows a start in flight or an unconfirmed start as such, never as an unavailable installation", async () => {
    for (const gate of ["starting", "startUnconfirmed"]) {
      const start = vi.fn();
      const state = mountPicker({ onStart: start, [gate]: true });
      selectFirst(state);
      state.requestStart();
      expect(start).not.toHaveBeenCalled();
      pickerApp.unmount(); pickerApp = null;
    }
    const starting = await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: pickerLearning(), canStart: true, busy: true, starting: true });
    expect(starting).not.toContain("unavailable in this installation");
    const unconfirmed = await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: pickerLearning(), canStart: true, startUnconfirmed: true });
    expect(unconfirmed).toContain("Use Retry lesson start");
    expect(unconfirmed).not.toContain("unavailable in this installation");
    expect(await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: pickerLearning(), canStart: false }))
      .toContain("Starting lessons is unavailable in this installation.");
  });

  it("shows a start's progress and failure on the course and lesson that requested it", async () => {
    const start = vi.fn();
    const state = mountPicker({ onStart: start });
    const [course] = state.courses;
    const key = state.courseKey(course);
    expect(state.feedbackFor(key)).toBeNull();
    state.startLesson(course, course.lessons[0]);
    expect(start).toHaveBeenCalledOnce();
    const props = pickerApp._instance.props;
    props.starting = true; props.busy = true;
    await nextTick();
    expect(state.feedbackFor(key)).toEqual({ phase: "starting" });
    expect(state.feedbackFor("other")).toBeNull();
    expect(state.startingHere(course, course.lessons[0])).toBe(true);
    expect(state.startingHere(course, course.lessons[1])).toBe(false);
    props.starting = false; props.busy = false; props.startError = "No practice project could be created.";
    await nextTick();
    expect(state.feedbackFor(key)).toEqual({ phase: "failed", message: "No practice project could be created." });
    expect(state.startingHere(course, course.lessons[0])).toBe(false);

    const progress = await renderPicker({ feedback: { phase: "starting" } }, TrainingStartFeedback);
    expect(progress).toContain("Creating your practice project.");
    expect(progress).toContain("the lesson opens by itself when it is ready");
    expect(progress).toContain('role="status"');
    const failed = await renderPicker({ feedback: { phase: "failed", message: "No practice project could be created." } }, TrainingStartFeedback);
    expect(failed).toContain("The lesson did not start");
    expect(failed).toContain('role="alert"');
    const page = await renderCoursePage(undefined, { startAllowed: false, startFeedback: { phase: "starting" },
      startingLesson: lesson => lesson.code === "V64-START-00" });
    expect(page).toContain("Starting lesson…");
    expect(page).toContain("Creating your practice project.");
  });

  it("retains displayed cached choices during refresh without admitting new work", async () => {
    const state = mountPicker();
    selectFirst(state);
    pickerApp._instance.props.catalogueLoading = true;
    await nextTick();
    expect(state.selected.lesson.code).toBe("V64-START-00");
    expect(state.startEnabled).toBeFalsy();
    const html = await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: pickerLearning(pickerAttempt()), catalogueLoading: true, learningLoading: true });
    expect(html).toContain("Lesson in progress · V64-START-00");
    expect(html).toContain("Getting started");
    expect(html).not.toContain('aria-label="Loading installed courses"');
    expect(html).not.toContain('aria-label="Loading saved lesson"');
  });
});


it("shows the actual readable lesson title alongside its exact code", async () => {
  const html = await renderCoursePage();
  expect(html).toContain("Connect your first AI · V64-START-00");
  expect(html).toContain("Explore Vibe64 · V64-START-01");
  expect(html).toContain(pickerHash);
});

it("missing titles refuse new choice intent while retaining saved attempt and read-only history", async () => {
  const catalogue = pickerCatalogue();
  delete catalogue.courses[0].lessons[0].title;
  const learning = pickerLearning(pickerAttempt());
  learning.history = [{ ...pickerAttempt(), attemptId: "22222222-2222-4222-8222-222222222222", ended: { reason: "restart" } }];
  const html = await renderPicker({ catalogueResult: catalogue, learningResult: learning, canStart: true, canResume: true });
  expect(html).toContain("Lesson titles are unavailable. Refresh courses");
  expect(html).toContain("Refresh courses");
  expect(html).toContain("Lesson in progress · V64-START-00");
  expect(html).toContain("Saved lesson history (1)");
  const start = vi.fn();
  const state = mountPicker({ onStart: start });
  selectFirst(state);
  const captured = state.selectionId;
  pickerApp._instance.props.catalogueResult = catalogue;
  await nextTick();
  expect(state.catalogueInvalid).toBe(true);
  expect(state.selectionId).toBe(captured);
  expect(state.selected).toBeNull();
  state.requestStart();
  expect(start).not.toHaveBeenCalled();
  pickerApp._instance.props.catalogueResult = pickerCatalogue();
  await nextTick();
  expect(state.selected.lesson.title).toBe("Connect your first AI");
  expect(state.selected.lesson.hash).toBe(pickerHash);
});

describe("Training courses", () => {
  const passed = (code, hash, extra = {}) => ({ lessonCode: code, lessonHash: hash, required: 1, passed: 1, completed: true, open: false, ...extra });
  const releasedAttempt = () => {
    const attempt = pickerAttempt();
    attempt.pin.course.release = "0.1.7";
    return attempt;
  };

  it("derives read-only lesson statuses and course progress from saved per-lesson passes", () => {
    const course = pickerCatalogue().courses[0];
    expect(courseProgress(course).lessons.map(value => value.status)).toEqual(["not-started", "not-started"]);
    const done = courseProgress(course, [passed("V64-START-00", pickerHash)]);
    expect(done.lessons.map(value => value.status)).toEqual(["completed", "not-started"]);
    expect([done.completed, done.total, done.next.code]).toEqual([1, 2, "V64-START-01"]);
    const started = courseProgress(course, [{ ...passed("V64-START-01", "d".repeat(64)), completed: false, passed: 0, open: true }]);
    expect(started.lessons[1].status).toBe("in-progress");
    expect(courseProgress(course, [passed("V64-START-00", "e".repeat(64))]).lessons[0].status).toBe("not-started");
    course.lessons[1].required = false;
    expect(courseProgress(course, [passed("V64-START-00", pickerHash)]).total).toBe(1);
  });

  it("starts the course's first not-completed lesson through the original start intent", async () => {
    const start = vi.fn();
    const learning = { ...pickerLearning(), lessonProgress: [passed("V64-START-00", pickerHash)] };
    const state = mountPicker({ learningResult: learning, onStart: start });
    const [summary] = state.summaries;
    expect(summary.progress.next.code).toBe("V64-START-01");
    state.startLesson(summary.course, summary.progress.next);
    expect(start).toHaveBeenCalledExactlyOnceWith({ courseId: "getting-started", release: "0.1.7", lessonCode: "V64-START-01", expectedRevision: 9 });
    const html = await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: learning, canStart: true });
    expect(html).toContain("1 of 2 lessons complete");
    expect(html).toContain(">Start lesson<");
    expect(await renderCoursePage(undefined, { lessonProgress: learning.lessonProgress })).toContain("Completed");
  });

  it("continues the lesson in progress, and still lets another lesson start (the server asks before archiving it)", async () => {
    const start = vi.fn();
    const resume = vi.fn();
    const state = mountPicker({ learningResult: pickerLearning(releasedAttempt()), onStart: start, onResume: resume });
    expect(state.summaries[0].progress.activeHere).toBe(true);
    state.requestResume();
    expect(resume).toHaveBeenCalledExactlyOnceWith({ attemptId: savedId });
    state.startLesson(state.summaries[0].course, state.summaries[0].course.lessons[1]);
    expect(start).toHaveBeenCalledOnce();
    expect(await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: pickerLearning(releasedAttempt()), canStart: true, canResume: true })).toContain(">Continue lesson<");
    const other = mountPicker({ learningResult: pickerLearning(pickerAttempt()) });
    expect(other.summaries[0].progress.activeHere).toBe(false);
    expect(other.startPossible).toBe(true);
  });

  it("opens one course page, returns to the list and refuses malformed saved progress", async () => {
    const state = mountPicker();
    state.openCourseKey = state.summaries[0].key;
    await nextTick();
    expect(state.openCourse.course.courseId).toBe("getting-started");
    pickerApp._instance.props.catalogueResult = { ...pickerCatalogue(), courses: [] };
    await nextTick();
    expect(state.openCourseKey).toBe("");
    const invalid = mountPicker({ learningResult: { ...pickerLearning(), lessonProgress: [{ lessonCode: "V64-START-00" }] } });
    expect(invalid.learningInvalid).toBe(true);
  });

  it("offers owner-only New course from enabled released topics and opens the confirmed course", async () => {
    const created = { ok: true, available: true, revision: 4, course: { courseId: "custom-mine", release: "1.0.0", title: "Mine", status: "released", enabled: true } };
    const createCourse = vi.fn(async () => created);
    const catalogue = pickerCatalogue();
    catalogue.courses.push({ ...catalogue.courses[0], courseId: "preview", status: "preview", topics: [{ topicId: "draft-topic", release: "0.2.0", title: "Draft topic" }], lessons: [] });
    expect(mountPicker({ catalogueResult: catalogue, createCourse }).canCreateCourses).toBe(false);
    pickerApp.unmount();
    const state = mountPicker({ catalogueResult: { ...catalogue, canCreateCourses: true }, createCourse });
    expect(state.canCreateCourses).toBe(true);
    expect(state.availableTopics).toEqual([{ topicId: "intro", release: "0.1.7", title: "Introduction" }]);
    await state.requestCreateCourse({ title: "Mine", topics: [{ topicId: "intro", release: "0.1.7" }] });
    expect(createCourse).toHaveBeenCalledExactlyOnceWith({ title: "Mine", topics: [{ topicId: "intro", release: "0.1.7" }], expectedRevision: 3 });
    expect(state.openCourseKey).toBe(JSON.stringify(["custom-mine", "1.0.0"]));
    expect(await renderPicker({ catalogueResult: { ...catalogue, canCreateCourses: true }, learningResult: pickerLearning(), createCourse })).toContain("New course");
    expect(await renderPicker({ catalogueResult: catalogue, learningResult: pickerLearning(), createCourse })).not.toContain("New course");
  });

  it("collects a named course of ordered whole topics", async () => {
    const create = vi.fn();
    const topics = [{ topicId: "intro", release: "0.1.7", title: "Introduction" }, { topicId: "data", release: "0.3.0", title: "Data" }];
    const state = mountPicker({ topics, onCreate: create }, TrainingCourseCreator);
    state.requestCreate();
    expect(create).not.toHaveBeenCalled();
    state.name = "  My path ";
    state.toggle(topics[0], true);
    state.toggle(topics[1], true);
    state.move(1, -1);
    state.requestCreate();
    expect(create).toHaveBeenCalledExactlyOnceWith({ title: "My path", topics: [{ topicId: "data", release: "0.3.0" }, { topicId: "intro", release: "0.1.7" }] });
    const html = await renderPicker({ topics }, TrainingCourseCreator);
    expect(html).toContain("Course name");
    expect(html).toContain("Introduction · 0.1.7");
    expect(html).toContain("Create course");
  });
});
