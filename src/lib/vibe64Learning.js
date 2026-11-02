import { computed, reactive, readonly } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { runTrainingGuideCommand } from "@local/vibe64-training/client/guide";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { createLessonPlayer } from "@/lib/vibe64LessonPlayer.js";
import { createLearningAttempts, createLearningPracticeList } from "@/lib/vibe64LearningAttempts.js";
import { createLearningCurrentLesson } from "@/lib/vibe64LearningCurrentLesson.js";
import {
  VIBE64_LEARNING_AI_REQUIRED_CODE,
  createPendingRequestIds,
  readPlace,
  rememberPlace,
  reviewNote,
  stepStatus,
  text
} from "@/lib/vibe64LearningModel.js";
import { createLearningModes } from "@/lib/vibe64LearningModes.js";
import { createLearningNotes } from "@/lib/vibe64LearningNotes.js";
import { createLearningStepActions } from "@/lib/vibe64LearningStepActions.js";
import { createLearningStepHelp } from "@/lib/vibe64LearningStepHelp.js";

// Learn and Develop: one host shell, two modes. One controller per host shell
// owns the mode (server-backed, per learner), each mode's place in this
// browser, the Courses overlay (the catalogue: open/minimised, surface), the
// current lesson (the one attempt in progress, read in the Learn page's Lesson
// pane) and its step bar. Admission, progress, checks,
// practice projects and archives stay with the Training actions; every change
// below is one of those actions, followed by fresh reads.

/** @typedef {import("./vibe64LearningModel.js").LearningBrowserNavigation} LearningBrowserNavigation */
/** @typedef {import("./vibe64LearningModel.js").LearningColleagueView} LearningColleagueView */
/** @typedef {import("./vibe64LearningModel.js").LearningGuideRunner} LearningGuideRunner */
/** @typedef {import("./vibe64LearningModel.js").LearningLayout} LearningLayout */
/** @typedef {import("./vibe64LearningModel.js").LearningPageActivity} LearningPageActivity */
/** @typedef {import("./vibe64LearningModel.js").LearningPageFocus} LearningPageFocus */
/** @typedef {import("./vibe64LearningModel.js").LearningRequest} LearningRequest */
/** @typedef {import("./vibe64LearningModel.js").LearningRouter} LearningRouter */
/** @typedef {import("./vibe64LearningModel.js").LearningState} LearningState */

/**
 * The studio's HTTP request for a Training action.
 * @type {LearningRequest}
 */
function requestStudio(url, options) {
  return getHttpWebClient().request(resolveStudioRequestUrl(url), options);
}

/**
 * The host shell's Learning controller. It composes one factory per concern
 * (the current lesson, the modes with the Courses overlay and Lesson pane,
 * the practice list and attempts, the step actions, the step help, the
 * learner notes and the step bar's player) over one reactive state, and
 * offers their members by name.
 * @param {object} collaborators
 * @param {LearningBrowserNavigation} collaborators.browserNavigation
 * @param {LearningColleagueView} collaborators.colleagueView
 * @param {LearningLayout} collaborators.layout
 * @param {LearningPageFocus} collaborators.pageFocus
 * @param {LearningPageActivity} collaborators.pageActivity
 * @param {LearningRouter} collaborators.router
 * @param {LearningRequest} collaborators.request the studio's HTTP request (`requestStudio`)
 * @param {LearningGuideRunner} [collaborators.runGuide]
 * @param {() => number} [collaborators.now]
 */
function createVibe64Learning({
  browserNavigation,
  colleagueView,
  layout,
  pageFocus,
  pageActivity,
  router,
  request,
  runGuide = runTrainingGuideCommand,
  now = Date.now
}) {
  /** @type {LearningState} */
  const state = reactive({ open: false, minimised: false, surface: "courses", attemptId: "", stepId: "", scroll: 0,
    loading: false, lessonError: "", attemptsError: "", actorKey: "", busy: "", hiddenBy: "", finished: false, notice: "", modeBusy: "",
    modeRead: false, trialAttemptId: "", beat: 0, beatPaused: false, orientationRequested: false });
  const pending = createPendingRequestIds();

  const currentLesson = createLearningCurrentLesson({
    state,
    request
  });
  const practiceList = createLearningPracticeList({
    state,
    request
  });
  const modes = createLearningModes({
    state,
    request,
    currentLesson,
    practiceList,
    layout,
    pageActivity,
    router
  });
  const attempts = createLearningAttempts({
    state,
    request,
    pending,
    modes,
    practiceList
  });
  const stepActions = createLearningStepActions({
    state,
    request,
    pending,
    currentLesson,
    modes
  });
  const learnerNotes = createLearningNotes({
    state,
    request,
    pending
  });

  const lessonAttemptId = computed(() => state.finished ? state.attemptId : state.trialAttemptId || modes.mode.value?.currentAttemptId || "");
  // The step bar shows the current lesson's step (not a finished lesson's screen).
  const stepBarVisible = computed(() => Boolean(modes.learnMode.value && !state.finished && lessonAttemptId.value &&
    state.attemptId === lessonAttemptId.value && currentLesson.currentStep.value));
  // The lesson waits for the learner's AI: its practice project has none to prepare with.
  const aiRequired = computed(() => !currentLesson.lesson.value?.attempt?.ended &&
    currentLesson.lesson.value?.attempt?.preparation?.failure?.code === VIBE64_LEARNING_AI_REQUIRED_CODE);
  const passed = stepId => stepStatus(currentLesson.results.value, stepId, currentLesson.lesson.value?.passedStepIds) === "passed";
  const player = createLessonPlayer({
    state,
    steps: currentLesson.steps,
    currentStep: currentLesson.currentStep,
    selectStep: currentLesson.selectStep,
    remember: () => rememberPlace(state),
    active: () => stepBarVisible.value && !currentLesson.lesson.value?.attempt?.ended && !aiRequired.value,
    activity: pageActivity,
    focus: () => pageFocus.value ? { ...pageFocus.value, chatVisible: Boolean(layout.value?.chatVisible) } : null,
    practiceSlug: () => currentLesson.lesson.value?.practiceProjectSlug || "",
    passed,
    // A self-checked step whose do beats were all detected is done.
    allDone: stepId => {
      const step = currentLesson.steps.value.find(value => value.id === stepId);
      if (step?.check?.kind === "self" && !passed(stepId)) void stepActions.done(stepId);
    }
  });
  const stepHelp = createLearningStepHelp({
    state,
    currentLesson,
    modes,
    player,
    layout,
    colleagueView,
    browserNavigation,
    runGuide,
    now
  });

  /**
   * The signed-in viewer is supplied by the mounted overlay (the host's
   * authenticated shell provides it below this controller). A different viewer sees nothing of the
   * previous person's mode, places, lesson or pending requests.
   */
  function setViewer(actorKey) {
    const next = String(actorKey || "");
    if (next === state.actorKey) return;
    currentLesson.reset();
    modes.reset();
    practiceList.reset();
    attempts.reset();
    stepActions.reset();
    stepHelp.reset();
    learnerNotes.reset();
    pending.clear();
    Object.assign(state, { open: false, minimised: false, surface: "courses", attemptId: "", stepId: "", scroll: 0,
      loading: false, lessonError: "", attemptsError: "", busy: "", hiddenBy: "", finished: false, notice: "", modeBusy: "", modeRead: false,
      trialAttemptId: "", beat: 0, beatPaused: false, orientationRequested: false, actorKey: next });
    const place = next ? readPlace(next) : null;
    if (place) Object.assign(state, place);
    // A restored attempt is read at once, so the step bar and Colleague's
    // current-step button are ready (the mode is read separately).
    if (state.attemptId) void currentLesson.loadLesson();
    if (next) void modes.readLearningMode();
  }

  /**
   * Realtime: a notes change rereads the notes when they were shown; a step
   * change rereads the current lesson; every other learner change (mode,
   * lesson, practice) rereads the mode and the In progress / Archived lists.
   */
  function learnerChanged(payload = {}) {
    if (payload.reason === "notes") return learnerNotes.notes.value ? learnerNotes.readNotes() : null;
    if (!state.actorKey) return null;
    if (payload.reason !== "steps") {
      void modes.readLearningMode();
      if (practiceList.practice.value.loaded) void practiceList.readPractice();
    }
    if (state.attemptId && (!payload.attemptId || payload.attemptId === state.attemptId) && currentLesson.lesson.value) {
      return currentLesson.loadLesson(state.attemptId);
    }
    return null;
  }

  return Object.freeze({
    state: readonly(state),
    get open() { return state.open; },
    get coursesOpen() { return state.open; },
    get minimised() { return state.minimised; },
    get hiddenBy() { return state.hiddenBy; },
    get surface() { return state.surface; },
    get attemptId() { return state.attemptId; },
    get stepId() { return currentLesson.currentStep.value?.id || ""; },
    get scroll() { return state.scroll; },
    get complete() { return currentLesson.complete.value; },
    get finished() { return state.finished; },
    get mode() { return modes.mode.value; },
    get learnMode() { return modes.learnMode.value; },
    // The lesson the Lesson pane shows: the current lesson (the mode's attempt
    // in progress, or this tab's other saved lesson), or a just finished lesson's
    // Finished screen until it is left.
    get lessonAttemptId() { return lessonAttemptId.value; },
    get stepBarVisible() { return stepBarVisible.value; },
    get aiRequired() { return aiRequired.value; },
    get lessonTitle() { return modes.mode.value?.currentAttemptId ? modes.mode.value.lessonTitle || modes.mode.value.lessonCode || "" : ""; },
    get practice() { return practiceList.practice.value; },
    get confirmArchive() { return attempts.confirmArchive.value; },
    // The step bar's Lesson toggle: on a studio page, and on a practice project
    // shown one side at a time (a phone; otherwise its toggle is beside
    // Preview | Dash; a lesson without a project is its only pane).
    // lessonShown: the toggle is pressed.
    get lessonSwitchable() { return Boolean(layout.value?.studio || layout.value?.lessonToggleOnBar); },
    get lessonShown() { return Boolean(layout.value?.lessonShown); },
    get notice() { return state.notice; },
    get orientationRequested() { return state.orientationRequested; },
    lesson: currentLesson.lesson,
    results: currentLesson.results,
    steps: currentLesson.steps,
    currentStep: currentLesson.currentStep,
    focus: modes.focus,
    colleagueRequest: stepHelp.colleagueRequest,
    notes: learnerNotes.notes,
    notesState: learnerNotes.notesState,
    player,
    stepStatus: stepId => stepStatus(currentLesson.results.value, stepId, currentLesson.lesson.value?.passedStepIds || []),
    // readable-check: allow setter-seam - not a slot: setViewer binds the signed-in viewer, which is data the host's authenticated content supplies below this controller
    setViewer,
    show: modes.show,
    openCourses: modes.openCourses,
    openLesson: modes.openLesson,
    hideLesson: modes.hideLesson,
    toggleLesson: modes.toggleLesson,
    closeCourses: modes.closeCourses,
    showFinished: modes.showFinished,
    finishSummary: attempts.finishSummary,
    minimise: modes.minimise,
    selectStep: currentLesson.selectStep,
    // readable-check: allow setter-seam - not a slot: setScroll records the reader's scroll position, which is data
    setScroll: currentLesson.setScroll,
    flushReader: currentLesson.flushReader,
    loadLesson: currentLesson.loadLesson,
    runCheck: stepActions.runCheck,
    answer: stepActions.answer,
    done: stepActions.done,
    review: stepActions.review,
    savedReview: stepActions.savedReview,
    reviewNote,
    showMe: stepHelp.showMe,
    teachMe: stepHelp.teachMe,
    stuck: stepHelp.stuck,
    doItForMe: stepHelp.doItForMe,
    doItForMeKind: stepHelp.doItForMeKind,
    consumeColleagueRequest: stepHelp.consumeColleagueRequest,
    learnerChanged,
    exerciseStep: stepActions.exerciseStep,
    beginExercise: stepActions.beginExercise,
    exerciseCurrent: stepActions.exerciseCurrent,
    finishExercise: stepActions.finishExercise,
    prepareExercise: stepActions.prepareExercise,
    readNotes: learnerNotes.readNotes,
    saveNotes: learnerNotes.saveNotes,
    clearNotes: learnerNotes.clearNotes,
    readLearningMode: modes.readLearningMode,
    // readable-check: allow setter-seam - not a slot: setMode switches the learner's mode through a Training action
    setMode: modes.setMode,
    toggleMode: modes.toggleMode,
    modePlace: modes.modePlace,
    openCurrent: modes.openCurrent,
    showNotice: modes.showNotice,
    clearNotice: modes.clearNotice,
    startLesson: attempts.startLesson,
    openOrientation: attempts.openOrientation,
    orientationAnswered: attempts.orientationAnswered,
    admitted: attempts.admitted,
    opened: attempts.opened,
    confirmArchiveAndStart: attempts.confirmArchiveAndStart,
    cancelArchive: attempts.cancelArchive,
    restart: attempts.restart,
    finish: attempts.finish,
    deleteAttempt: attempts.deleteAttempt,
    readPractice: practiceList.readPractice,
    deleteArchived: attempts.deleteArchived
  });
}


// The start of an installed course's orientation lesson (its studio
// lesson that Take the tour starts) from the Courses reads, or null when no
// enabled course this person may start names a published one. Released
// courses come first.
function orientationSelection(catalogue, saved) {
  if (catalogue?.ok !== true || !Array.isArray(catalogue.courses) || saved?.ok !== true || saved.available !== true ||
      !Number.isSafeInteger(saved.revision)) return null;
  const startable = catalogue.courses.filter(course => course?.enabled === true && text(course.orientation) &&
    (course.status === "released" || catalogue.canTryPreviews === true) &&
    course.lessons?.some(lesson => lesson?.code === course.orientation && lesson.status === "published"));
  const course = startable.find(value => value.status === "released") || startable[0];
  return course ? Object.freeze({ courseId: course.courseId, release: course.release, lessonCode: course.orientation,
    expectedRevision: saved.revision }) : null;
}

// A link in lesson text to another site opens in a new tab, so following
// "open Z.AI's key page" keeps Vibe64, Learning and the reader's place open.
// Links inside Vibe64, modified clicks and non-web schemes keep the default.
function openLessonLink(event, browser = globalThis) {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  let url;
  try { url = new URL(link.getAttribute("href"), browser.location.href); } catch { return false; }
  if (!/^https?:$/u.test(url.protocol) || url.origin === browser.location.origin) return false;
  event.preventDefault();
  browser.open(url.href, "_blank", "noopener,noreferrer");
  return true;
}

// On a phone the step list is one horizontal row; the current step is scrolled
// into that row so Next and Previous never leave it hidden off-screen. Only
// the row moves: the page and the reader body keep their scroll.
function revealCurrentStep(list) {
  if (!list) return false;
  const current = list.querySelector('[aria-current="step"]');
  if (!current || !(list.scrollWidth > list.clientWidth)) return false;
  const row = list.getBoundingClientRect();
  const item = current.getBoundingClientRect();
  if (item.left < row.left) list.scrollLeft -= row.left - item.left;
  else if (item.right > row.right) list.scrollLeft += item.right - row.right;
  else return false;
  return true;
}


export {
  STEP_STATUS_LABELS,
  VIBE64_DEVELOP_MODE_NOTE,
  VIBE64_LEARNING_MODE_NOTE,
  VIBE64_LEARNING_MODE_PROJECT_CODE,
  VIBE64_LEARNING_NOTES_MAX,
  VIBE64_LEARNING_PAGE_PATH,
  VIBE64_LEARNING_ROUTES,
  VIBE64_LEARNING_STUCK_MESSAGE,
  VIBE64_LEARNING_TEACH_MESSAGE,
  VIBE64_LESSON_IN_PROGRESS_CODE,
  checkNote,
  lessonShownIn,
  modeRedirect,
  normalizePractice,
  reviewRunNote,
  setLearningStudioHome,
  showMeCommand,
  withLesson,
  withoutLesson
} from "@/lib/vibe64LearningModel.js";
export {
  VIBE64_LEARNING_AI_REQUIRED_CODE,
  createVibe64Learning,
  openLessonLink,
  orientationSelection,
  requestStudio,
  reviewNote,
  revealCurrentStep,
  stepStatus
};
