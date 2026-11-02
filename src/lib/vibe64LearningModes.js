import { computed, nextTick, shallowRef } from "vue";
import { projectSlugFromPathname } from "@/lib/vibe64ProjectScope.js";
import {
  DEVELOP_HOME_PATH,
  SURFACES,
  VIBE64_LEARNING_ROUTES,
  learnHomePath,
  modePlaceKey,
  modeRedirect,
  modeSide,
  normalizeLearningMode,
  readJson,
  rememberPlace,
  text,
  withLesson,
  writeJson
} from "@/lib/vibe64LearningModel.js";

/** @typedef {import("./vibe64LearningModel.js").LearningState} LearningState */
/** @typedef {import("./vibe64LearningModel.js").LearningRequest} LearningRequest */
/** @typedef {import("./vibe64LearningModel.js").LearningLayout} LearningLayout */
/** @typedef {import("./vibe64LearningModel.js").LearningPageActivity} LearningPageActivity */
/** @typedef {import("./vibe64LearningModel.js").LearningRouter} LearningRouter */
/** @typedef {import("./vibe64LearningCurrentLesson.js").LearningCurrentLesson} LearningCurrentLesson */
/** @typedef {import("./vibe64LearningAttempts.js").LearningPracticeList} LearningPracticeList */
/** @typedef {ReturnType<typeof createLearningModes>} LearningModes */

/**
 * Learn and Develop: the learner's mode (server-backed), each mode's place in
 * this browser, and where Learning shows itself in the current mode: the
 * Courses overlay (open or minimised, on a surface) and the Lesson pane.
 * @param {object} dependencies
 * @param {LearningState} dependencies.state
 * @param {LearningRequest} dependencies.request
 * @param {LearningCurrentLesson} dependencies.currentLesson
 * @param {LearningPracticeList} dependencies.practiceList
 * @param {LearningLayout} dependencies.layout
 * @param {LearningPageActivity | null} dependencies.pageActivity
 * @param {LearningRouter | null} dependencies.router
 */
function createLearningModes({ state, request, currentLesson, practiceList, layout, pageActivity, router }) {
  // The learner's mode (server-backed): null until read or when unreadable (Develop).
  const mode = shallowRef(null);
  // viewer fences everything of one signed-in person.
  let viewer = 0;
  let modeReads = 0;
  // The latest mode read in flight.
  let modeLoad = null;

  const learnMode = computed(() => Boolean(state.actorKey && mode.value?.on));
  const focus = computed(() => ({ learningOpen: state.open, learningSurface: state.surface,
    ...(state.attemptId ? { learningAttemptId: state.attemptId } : {}),
    ...(state.attemptId && currentLesson.currentStep.value ? { learningStepId: currentLesson.currentStep.value.id } : {}) }));

  function acceptMode(value) {
    mode.value = value;
    state.modeRead = true;
    // The current lesson is the attempt in progress (or this tab's author
    // trial), also in a fresh tab; a Lesson finished screen keeps its lesson
    // until it is left.
    const current = state.trialAttemptId || value?.currentAttemptId || "";
    if (!value || state.finished || current === state.attemptId) return;
    currentLesson.selectAttempt(current);
    rememberPlace(state);
    if (current) void currentLesson.loadLesson();
  }

  /**
   * Reads the learner's mode; the latest read wins. A failed read counts as Develop.
   */
  async function readLearningMode() {
    if (!state.actorKey) return null;
    const expected = ++modeReads;
    let value = null;
    const load = request(VIBE64_LEARNING_ROUTES.learningMode, { method: "GET" });
    modeLoad = load;
    try {
      value = normalizeLearningMode(await load);
    } catch { value = null; }
    finally { if (modeLoad === load) modeLoad = null; }
    if (expected !== modeReads) return mode.value;
    acceptMode(value);
    return value;
  }

  /**
   * The mode once any read in flight (and its realtime follow-up) settles.
   */
  async function settledMode() {
    if (modeLoad) await modeLoad.catch(() => null);
    await Promise.resolve();
  }

  /**
   * The mode with this attempt in progress: the latest read (a start's
   * realtime change usually reread it already), else a fresh read.
   */
  async function modeWith(attemptId) {
    await settledMode();
    return mode.value?.on && mode.value.currentAttemptId === attemptId ? mode.value : readLearningMode();
  }

  function currentPath() {
    return String(router?.currentRoute?.value?.fullPath || "");
  }

  function readModePlace(side) {
    const path = readJson("localStorage", modePlaceKey(state.actorKey, side))?.path;
    return text(path) && path.startsWith("/app") ? path : "";
  }

  /**
   * This mode's place: its last place in this browser while the mode still
   * allows it, else its home (Learn: the lesson's place; Develop: /app).
   */
  function modePlace(value = mode.value) {
    const saved = readModePlace(modeSide(value?.on));
    const pathname = saved.split(/[?#]/u)[0];
    if (saved && !modeRedirect({ mode: value, slug: projectSlugFromPathname(pathname), path: pathname })) return saved;
    return value?.on ? learnHomePath(value) : DEVELOP_HOME_PATH;
  }

  /**
   * L: saves this mode's place, switches the learner's mode on the server
   * (nothing is ended or paused by it beyond the switch), then returns to the
   * other mode's place.
   */
  async function setMode(on) {
    if (!state.actorKey || state.modeBusy) return null;
    const expected = viewer;
    const path = currentPath();
    if (path.startsWith("/app")) writeJson("localStorage", modePlaceKey(state.actorKey, modeSide(learnMode.value)), { path });
    state.modeBusy = "set";
    try {
      const value = normalizeLearningMode(await request(VIBE64_LEARNING_ROUTES.learningMode, { method: "POST", body: { on: on === true } }));
      if (!value) throw new Error("The switch was not confirmed. Press L again.");
      if (expected !== viewer) return null;
      modeReads += 1;
      acceptMode(value);
      if (!value.on) minimise();
      const target = modePlace(value);
      if (router && target !== path) await router.push(target);
      // Learn with no lesson in progress starts at the lesson picker.
      if (value.on && !value.currentAttemptId) void openCourses("courses");
      pageActivity?.report("learn-toggled", { projectSlug: projectSlugFromPathname(currentPath()) });
      return value;
    } catch (cause) {
      if (expected === viewer) showNotice(cause?.message || "The switch was not confirmed. Press L again.");
      return null;
    } finally {
      if (state.modeBusy === "set") state.modeBusy = "";
    }
  }

  const toggleMode = () => setMode(!learnMode.value);

  function showNotice(value) { state.notice = String(value || ""); }
  function clearNotice() { state.notice = ""; }

  /**
   * Open the Courses catalogue (or bring it back from minimised) on a tab. A
   * lesson attempt or step is shown in the Lesson pane instead (openLesson).
   */
  async function show({ surface, attemptId, stepId } = {}) {
    if (!state.actorKey) throw new Error("Sign in before opening Courses.");
    if (text(attemptId) || text(stepId)) return openLesson({ attemptId, stepId });
    state.open = true;
    state.minimised = false;
    state.hiddenBy = "";
    if (SURFACES.includes(surface)) state.surface = surface;
    // Leaving a finished lesson's screen returns to the current lesson (or none).
    if (state.finished) {
      state.finished = false;
      if (mode.value) acceptMode(mode.value);
    }
    rememberPlace(state);
    if (state.surface === "progress" || state.surface === "archived") void practiceList.readPractice();
    return focus.value;
  }

  // The Courses button: the overlay where the learner left it (or on a surface).
  const openCourses = surface => show({ surface });

  /**
   * The Lesson pane of the Learn page: Learn mode on, Courses closed (not as
   * the learner's own close), the step selected, and the lesson shown (its
   * Lesson flag on) over the practice project's Preview or Dash where the
   * learner is, else on the lesson's home.
   */
  async function openLesson({ attemptId, stepId } = {}) {
    if (!state.actorKey) throw new Error("Sign in before opening a lesson.");
    let value = state.modeRead ? mode.value : await readLearningMode();
    if (!value?.on) value = await setMode(true);
    if (!value?.on) return null;
    minimise();
    const changed = text(attemptId) && attemptId !== state.attemptId;
    // Another attempt than this tab's saved lesson ends that lesson here.
    if (text(attemptId) && attemptId !== state.trialAttemptId) state.trialAttemptId = "";
    if (changed) {
      state.finished = false;
      currentLesson.selectAttempt(attemptId, stepId);
    } else if (text(stepId) && stepId !== state.stepId) {
      if (currentLesson.steps.value.length) currentLesson.selectStep(stepId);
      else Object.assign(state, { stepId, beat: 0 });
    }
    rememberPlace(state);
    // In its practice project the lesson covers the Preview or Dash view the
    // learner is on (not its Lesson finished screen: finishing archives that
    // project); a studio lesson docks it on the studio page showing a stage
    // frame; anything else goes to the lesson's home.
    const here = String(router?.currentRoute?.value?.path || "");
    const inPractice = !state.finished && Boolean(value.practiceSlug) && projectSlugFromPathname(here) === value.practiceSlug;
    const home = inPractice ? here : value.lessonStage === "project" ? learnHomePath(value)
      : layout.value?.studio && here ? here : learnHomePath(value);
    const target = withLesson(home);
    if (router && currentPath() !== target) await router.push(target);
    // A phone shows one side: the project side, where the Lesson pane is,
    // also when the address already names it (after L, or Show chat).
    await nextTick();
    layout.value?.showProject?.();
    // A read already under way for this attempt (a restored or current lesson) is awaited, not repeated.
    if (changed || (!currentLesson.lesson.value && !state.loading)) await currentLesson.loadLesson();
    else if (!currentLesson.lesson.value) await currentLesson.lessonLoad;
    return focus.value;
  }

  /**
   * Hide the overlay with its state kept; Courses or Colleague brings it back.
   * by = "learner" only for the learner's own close or Escape; Show me, Teach
   * me and app navigation hide it to show something else.
   */
  function minimise(by = "") {
    if (!state.open) return;
    state.hiddenBy = by === "learner" ? "learner" : "";
    state.open = false;
    state.minimised = true;
    currentLesson.flushReader();
  }

  const closeCourses = () => minimise("learner");

  /**
   * The Lesson toggle: pressing it again hides the lesson (its flag off); the
   * Preview or Dash it covered is still there, as it was.
   */
  function hideLesson() { layout.value?.hideLesson?.(); }
  const toggleLesson = () => layout.value?.lessonShown ? hideLesson() : openLesson();

  /**
   * The "Lesson finished" screen of the current lesson, in the Lesson pane:
   * shown when this learner's own step action completes the lesson, and again
   * from the reader of a complete lesson. The screen finishes the attempt.
   */
  async function showFinished() {
    if (!state.attemptId) return null;
    state.finished = Boolean(currentLesson.complete.value);
    return openLesson();
  }

  // The current lesson's place (Courses → In progress → Open, or
  // Projects): its Lesson pane.
  const openCurrent = () => openLesson();

  /**
   * Another signed-in viewer: no mode, and no read or switch of the previous one lands.
   */
  function reset() {
    viewer += 1;
    modeReads += 1;
    mode.value = null;
  }

  return Object.freeze({
    mode,
    learnMode,
    focus,
    readLearningMode,
    settledMode,
    modeWith,
    modePlace,
    // readable-check: allow setter-seam - not a slot: setMode switches the learner's mode through a Training action
    setMode,
    toggleMode,
    showNotice,
    clearNotice,
    show,
    openCourses,
    openLesson,
    minimise,
    closeCourses,
    hideLesson,
    toggleLesson,
    showFinished,
    openCurrent,
    reset
  });
}

export { createLearningModes };
