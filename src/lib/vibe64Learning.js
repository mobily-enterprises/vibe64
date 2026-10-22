import { computed, reactive, readonly, shallowRef } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { runTrainingGuideCommand } from "@local/vibe64-training/client/guide";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { projectAppPath, projectSlugFromPathname } from "@/lib/vibe64ProjectScope.js";
import { practiceProjectName } from "@/lib/vibe64PracticeProjectName.js";
import { trainingGuideRequest, trainingGuideSteps, TRAINING_GUIDE_PLACES } from "@local/vibe64-training/shared/guide-targets";

// Learn and Develop: one host shell, two modes. One controller per host shell
// owns the mode (server-backed, per learner), each mode's place in this
// browser, the Courses overlay (open/minimised, surface), the current lesson
// (the one attempt in progress) and its step bar. Admission, progress, checks,
// practice projects and archives stay with the Training actions; every change
// below is one of those actions, followed by fresh reads.
const TRAINING_PATH = "/api/vibe64/training";
const attemptPath = (attemptId, suffix = "") => `${TRAINING_PATH}/attempts/${encodeURIComponent(attemptId)}${suffix}`;
// HTTP routes for the Training actions (registerRoutes.js assembles their input).
const VIBE64_LEARNING_ROUTES = Object.freeze({
  lessonRead: attemptId => attemptPath(attemptId, "/lesson"),
  stepObserve: attemptId => attemptPath(attemptId, "/steps/observe"),
  stepCheck: attemptId => attemptPath(attemptId, "/steps/check"),
  stepAnswer: attemptId => attemptPath(attemptId, "/steps/answer"),
  stepDone: attemptId => attemptPath(attemptId, "/steps/done"),
  readerSave: attemptId => attemptPath(attemptId, "/reader"),
  visual: (attemptId, visualId) => attemptPath(attemptId, `/visuals/${encodeURIComponent(visualId)}`),
  // The lesson in progress: restart (archive it, start again), finish (archive a complete lesson), delete.
  lessonRestart: attemptId => attemptPath(attemptId, "/restart"),
  lessonFinish: attemptId => attemptPath(attemptId, "/finish"),
  lessonDelete: attemptId => attemptPath(attemptId, "/delete"),
  // Saved progress (its revision fences restart and finish).
  learning: `${TRAINING_PATH}/learning`,
  // Learner notes (C7): the signed-in learner's own teacher notes.
  notes: `${TRAINING_PATH}/teacher-notes`,
  notesClear: `${TRAINING_PATH}/teacher-notes/clear`,
  // Learn or Develop: GET reads the mode, POST { on } sets it.
  learningMode: `${TRAINING_PATH}/learning-mode`,
  // The lesson in progress and the archived attempts (Courses → In progress / Archived).
  practice: `${TRAINING_PATH}/practice`,
  archiveDelete: attemptId => `${TRAINING_PATH}/archives/${encodeURIComponent(attemptId)}/delete`
});
// Learn mode with no practice project: the project page with no project selected.
const VIBE64_LEARNING_PAGE_PATH = "/app/learning";
const DEVELOP_HOME_PATH = "/app";
// Shown after a project address was moved to the mode's own place.
const VIBE64_LEARNING_MODE_NOTE = "You're in Learn mode. Press L to go back to your projects.";
const VIBE64_DEVELOP_MODE_NOTE = "This is a practice project. Press L to switch to Learn.";
// The server's refusal of a project the current mode does not allow.
const VIBE64_LEARNING_MODE_PROJECT_CODE = "vibe64_learning_mode_project";
// lesson.start's refusal while a different lesson is in progress.
const VIBE64_LESSON_IN_PROGRESS_CODE = "VIBE64_TRAINING_LESSON_IN_PROGRESS";
const VIBE64_LEARNING_NOTES_MAX = 4000;
const SURFACES = Object.freeze(["courses", "progress", "archived", "lesson"]);
const STORAGE_PREFIX = "vibe64:learning-environment:v2:";
const MODE_PLACE_PREFIX = "vibe64:mode-place:v1:";
const READER_SAVE_DELAY_MS = 800;
// How long a file or Database guide waits for the navigated project view to publish itself.
const PROJECT_VIEW_WAIT_MS = 5000;
// Learner App presses whose observation is still being recorded.
const MAX_EXERCISE_OBSERVATIONS = 8;
// Teach me sends this exact text; the step itself travels in Colleague's focus.
const VIBE64_LEARNING_TEACH_MESSAGE = "Teach me this step.";
const EMPTY_PRACTICE = Object.freeze({ current: null, archived: Object.freeze([]), loaded: false });

const text = value => typeof value === "string" && value.length > 0;

function storage(kind) {
  try { return globalThis.window?.[kind] || null; } catch { return null; }
}

function readJson(kind, key) {
  try {
    const value = JSON.parse(storage(kind)?.getItem(key) || "null");
    return value && typeof value === "object" ? value : null;
  } catch { return null; }
}

function writeJson(kind, key, value) {
  try { storage(kind)?.setItem(key, JSON.stringify(value)); } catch { /* a browser convenience only */ }
}

// This tab's overlay place (sessionStorage).
function readPlace(actorKey) {
  const value = readJson("sessionStorage", `${STORAGE_PREFIX}${actorKey}`);
  if (!value) return null;
  return { surface: SURFACES.includes(value.surface) ? value.surface : "courses",
    attemptId: text(value.attemptId) ? value.attemptId : "", stepId: text(value.stepId) ? value.stepId : "",
    scroll: Number.isSafeInteger(value.scroll) && value.scroll >= 0 ? value.scroll : 0,
    stepBarCollapsed: value.stepBarCollapsed === true };
}

// Each mode's last place in this browser (localStorage): the full route,
// including the Preview/Dashboard pane and the dashboard section.
const modePlaceKey = (actorKey, side) => `${MODE_PLACE_PREFIX}${actorKey}:${side}`;
const modeSide = on => on ? "learn" : "develop";

// A lesson.read result as the reader displays it.
function normalizeLesson(result) {
  if (!result || result.ok === false || result.available === false) return null;
  const lesson = result.lesson || {};
  const steps = Array.isArray(lesson.steps) ? lesson.steps.filter(step => text(step?.id)) : [];
  const attempt = result.attempt || null;
  return Object.freeze({
    schemaVersion: lesson.schemaVersion ?? (steps.length ? 2 : 1),
    code: lesson.code || attempt?.pin?.lesson?.code || "",
    title: lesson.title || "",
    notesText: text(lesson.notesText) ? lesson.notesText : "",
    visuals: Array.isArray(lesson.visuals) ? lesson.visuals : [],
    steps,
    attempt,
    practiceProjectSlug: attempt?.practiceSlug || "",
    reader: result.reader && text(result.reader.stepId) ? result.reader : null,
    results: Array.isArray(result.results) ? result.results : [],
    passedStepIds: Array.isArray(result.passedStepIds) ? result.passedStepIds.filter(text) : []
  });
}

// A learning-mode read as the client uses it; anything unreadable is null,
// which counts as Develop, so a failed read never locks anyone out of projects.
function normalizeLearningMode(result) {
  const mode = result?.ok === true && result.available !== false ? result.learningMode : null;
  if (!mode || typeof mode !== "object") return null;
  const value = key => text(mode[key]) ? mode[key] : "";
  return Object.freeze({ on: mode.on === true, currentAttemptId: value("currentAttemptId"),
    lessonCode: value("lessonCode"), lessonTitle: value("lessonTitle"), practiceSlug: value("practiceSlug") });
}

// practice.list as Courses → In progress / Archived shows it: the lesson in
// progress (its practice project, if any) and the archived attempts. Display
// only; the Training actions authorize every change.
function normalizePractice(result) {
  if (result?.ok !== true) return EMPTY_PRACTICE;
  const lessonName = lesson => String(lesson?.title || lesson?.code || "") || "Lesson";
  const current = result.current && text(result.current.attemptId) ? Object.freeze({
    attemptId: result.current.attemptId, name: lessonName(result.current.lesson),
    projectName: text(result.current.slug) ? practiceProjectName({ lessonTitle: result.current.lesson?.title, lessonCode: result.current.lesson?.code }) : "",
    slug: text(result.current.slug) ? result.current.slug : "",
    status: result.current.status === "deleting" ? "deleting" : "in-progress" }) : null;
  const archived = (Array.isArray(result.archived) ? result.archived : []).filter(entry => text(entry?.attemptId))
    .map(entry => Object.freeze({ attemptId: entry.attemptId, name: lessonName(entry.lesson),
      reason: entry.reason === "finished" ? "finished" : "archived", archivedAt: String(entry.archivedAt || ""),
      hasProject: entry.hasProject === true }));
  return Object.freeze({ current, archived: Object.freeze(archived), loaded: true });
}

// Where Learn mode lives: the current lesson's practice project, else the
// project page with no project selected.
function learnHomePath(mode) {
  return mode?.practiceSlug ? projectAppPath(mode.practiceSlug) : VIBE64_LEARNING_PAGE_PATH;
}

// The move an address needs in the current mode, or null when it may stay.
// Learn allows only the current lesson's practice project (or, without one,
// the no-project page); Develop allows everything but that practice project
// and the no-project page. The server decides any other practice project.
// An unread or unreadable mode (null) moves nothing.
function modeRedirect({ mode = null, slug = "", path = "" } = {}) {
  if (!mode) return null;
  const projectSlug = String(slug || "").trim();
  const atLearnPage = String(path || "").replace(/\/+$/u, "") === VIBE64_LEARNING_PAGE_PATH;
  if (mode.on) {
    if (projectSlug ? projectSlug === mode.practiceSlug : !(atLearnPage && mode.practiceSlug)) return null;
    return Object.freeze({ path: learnHomePath(mode), note: projectSlug ? VIBE64_LEARNING_MODE_NOTE : "" });
  }
  if (atLearnPage) return Object.freeze({ path: DEVELOP_HOME_PATH, note: "" });
  if (projectSlug && projectSlug === mode.practiceSlug) return Object.freeze({ path: DEVELOP_HOME_PATH, note: VIBE64_DEVELOP_MODE_NOTE });
  return null;
}

// passed wins over any later not-yet-passed (a pass is final); otherwise the latest outcome.
function stepStatus(results, stepId, passedStepIds = []) {
  const own = results.filter(result => result?.stepId === stepId);
  if (passedStepIds.includes(stepId) || own.some(result => result.outcome === "passed")) return "passed";
  return own.length ? own.at(-1).outcome || "not-yet-passed" : "not-started";
}

// The browser guide command for one step's declared guide. A step without a
// practice project (or a guide at the L button) only points.
function showMeCommand(guide, { projectSlug = "", sessionId = "" } = {}) {
  const request = trainingGuideRequest({ target: guide?.target,
    ...(guide?.navigate !== undefined ? { navigate: guide.navigate } : {}),
    ...(guide?.filePath !== undefined ? { filePath: guide.filePath } : {}) });
  const steps = trainingGuideSteps(request);
  const caption = text(guide?.caption) ? guide.caption.slice(0, 256) : steps.map(value => value.label).join(" → ");
  const navigate = request.navigate && request.target !== "learning" && Boolean(projectSlug);
  const command = { guide: { ...request, navigate, highlight: true, steps, caption } };
  if (!navigate) return command;
  const place = TRAINING_GUIDE_PLACES[request.target];
  return { ...command, projectSlug, ...(text(sessionId) ? { sessionId } : {}), ...(place.pane ? { pane: place.pane } : {}),
    ...(place.databaseView ? { databaseView: place.databaseView } : {}) };
}

function createVibe64Learning({ request: requestOverride = null, browserNavigation = null, colleagueView = null,
  router = null, runGuide = null, now = () => Date.now() } = {}) {
  // open/minimised: the Courses overlay. hiddenBy: "learner" when the
  // learner's own close or Escape hid it (Colleague then returns a phone
  // learner to its conversation), else "". finished: the lesson surface shows
  // the "Lesson finished" screen. modeRead: this viewer's mode has been read
  // (or found unreadable).
  const state = reactive({ open: false, minimised: false, surface: "courses", attemptId: "", stepId: "", scroll: 0,
    loading: false, error: "", actorKey: "", busy: "", hiddenBy: "", finished: false, notice: "", modeBusy: "",
    modeRead: false, stepBarCollapsed: false });
  const lesson = shallowRef(null);
  // The learner's mode (server-backed): null until read or when unreadable (Develop).
  const mode = shallowRef(null);
  const practice = shallowRef(EMPTY_PRACTICE);
  // A different lesson in progress refused a start: { current, next } until confirmed or cancelled.
  const confirmArchive = shallowRef(null);
  const colleagueRequest = shallowRef(null);
  // The teacher's notes about this learner, read when Courses shows them.
  const notes = shallowRef(null);
  const notesState = reactive({ loading: false, saving: false, error: "" });
  const pending = new Map();
  const exerciseObservations = new Set();
  // viewer fences everything of one signed-in person; reads fences lesson reads.
  let viewer = 0;
  let reads = 0;
  let modeReads = 0;
  let practiceReads = 0;
  let saveTimer = null;
  let lastSaved = "";

  // A retry of the same input reuses its request ID until a confirmed result.
  function pendingRequestId(key) {
    const requestId = pending.get(key) || globalThis.crypto.randomUUID();
    pending.set(key, requestId);
    return requestId;
  }

  async function request(url, options = {}) {
    if (requestOverride) return requestOverride(url, options);
    return getHttpWebClient().request(resolveStudioRequestUrl(url), options);
  }

  const learnMode = computed(() => Boolean(state.actorKey && mode.value?.on));
  const results = computed(() => lesson.value?.results || []);
  const steps = computed(() => lesson.value?.steps || []);
  const currentStep = computed(() => steps.value.find(step => step.id === state.stepId) || steps.value[0] || null);
  const focus = computed(() => ({ learningOpen: state.open, learningSurface: state.surface,
    ...(state.attemptId ? { learningAttemptId: state.attemptId } : {}),
    ...(state.attemptId && currentStep.value ? { learningStepId: currentStep.value.id } : {}) }));
  // Every required step of the read version 2 lesson is passed.
  const complete = computed(() => Boolean(lesson.value?.schemaVersion === 2 && steps.value.length &&
    steps.value.filter(step => step.required).every(step => stepStatus(results.value, step.id, lesson.value.passedStepIds) === "passed")));

  function remember() {
    if (!state.actorKey) return;
    writeJson("sessionStorage", `${STORAGE_PREFIX}${state.actorKey}`, { surface: state.surface, attemptId: state.attemptId,
      stepId: state.stepId, scroll: state.scroll, stepBarCollapsed: state.stepBarCollapsed });
  }

  // The signed-in viewer is supplied by the mounted overlay (hosted AuthGate
  // provides it below this controller). A different viewer sees nothing of the
  // previous person's mode, places, lesson or pending requests.
  function setViewer(actorKey) {
    const next = String(actorKey || "");
    if (next === state.actorKey) return;
    viewer += 1;
    reads += 1;
    modeReads += 1;
    practiceReads += 1;
    clearTimeout(saveTimer);
    pending.clear();
    exerciseObservations.clear();
    lesson.value = null;
    mode.value = null;
    practice.value = EMPTY_PRACTICE;
    confirmArchive.value = null;
    colleagueRequest.value = null;
    notes.value = null;
    Object.assign(notesState, { loading: false, saving: false, error: "" });
    Object.assign(state, { open: false, minimised: false, surface: "courses", attemptId: "", stepId: "", scroll: 0,
      loading: false, error: "", busy: "", hiddenBy: "", finished: false, notice: "", modeBusy: "", modeRead: false,
      stepBarCollapsed: false, actorKey: next });
    const place = next ? readPlace(next) : null;
    if (place) Object.assign(state, place);
    // A restored attempt is read at once, so the step bar and Colleague's
    // current-step button are ready (the mode is read separately).
    if (state.attemptId) void loadLesson();
    if (next) void readLearningMode();
  }

  function acceptMode(value) {
    mode.value = value;
    state.modeRead = true;
    // The current lesson is the attempt in progress, also in a fresh tab; a
    // Lesson finished screen keeps its lesson until it is left.
    const current = value?.currentAttemptId || "";
    if (!value || state.finished || current === state.attemptId) return;
    selectAttempt(current);
    if (!current && state.surface === "lesson") state.surface = "courses";
    remember();
    if (current) void loadLesson();
  }

  // Reads the learner's mode; the latest read wins. A failed read counts as Develop.
  async function readLearningMode() {
    if (!state.actorKey) return null;
    const expected = ++modeReads;
    let value = null;
    try {
      value = normalizeLearningMode(await request(VIBE64_LEARNING_ROUTES.learningMode, { method: "GET" }));
    } catch { value = null; }
    if (expected !== modeReads) return mode.value;
    acceptMode(value);
    return value;
  }

  function currentPath() {
    return String(router?.currentRoute?.value?.fullPath || "");
  }

  function readModePlace(side) {
    const path = readJson("localStorage", modePlaceKey(state.actorKey, side))?.path;
    return text(path) && path.startsWith("/app") ? path : "";
  }

  // This mode's place: its last place in this browser while the mode still
  // allows it, else its home (Learn: the lesson's place; Develop: /app).
  function modePlace(value = mode.value) {
    const saved = readModePlace(modeSide(value?.on));
    const pathname = saved.split(/[?#]/u)[0];
    if (saved && !modeRedirect({ mode: value, slug: projectSlugFromPathname(pathname), path: pathname })) return saved;
    return value?.on ? learnHomePath(value) : DEVELOP_HOME_PATH;
  }

  // L: saves this mode's place, switches the learner's mode on the server
  // (nothing is ended or paused by it beyond the switch), then returns to the
  // other mode's place.
  async function setMode(on) {
    if (!state.actorKey || state.modeBusy) return null;
    const expected = viewer;
    const path = currentPath();
    if (path.startsWith("/app")) writeJson("localStorage", modePlaceKey(state.actorKey, modeSide(learnMode.value)), { path });
    state.modeBusy = "set";
    state.error = "";
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
      return value;
    } catch (cause) {
      if (expected === viewer) state.error = String(cause?.message || "The switch was not confirmed. Press L again.");
      return null;
    } finally {
      if (state.modeBusy === "set") state.modeBusy = "";
    }
  }

  const toggleMode = () => setMode(!learnMode.value);

  function selectAttempt(attemptId, stepId = "") {
    lesson.value = null;
    state.attemptId = attemptId;
    state.stepId = text(stepId) ? stepId : "";
    state.scroll = 0;
    lastSaved = "";
  }

  function showNotice(value) { state.notice = String(value || ""); }
  function clearNotice() { state.notice = ""; }

  // lesson.read pages step text over 64 KiB; the reader shows every step, so
  // the other pages' bodies are merged into the first page's steps.
  async function readAllPages(attemptId) {
    const first = await request(VIBE64_LEARNING_ROUTES.lessonRead(attemptId), { method: "GET" });
    const count = Number.isSafeInteger(first?.page?.count) ? Math.min(first.page.count, 32) : 1;
    const steps = Array.isArray(first?.lesson?.steps) ? first.lesson.steps : null;
    if (count <= 1 || !steps) return first;
    const bodies = new Map();
    for (let index = 1; index < count; index++) {
      const page = await request(`${VIBE64_LEARNING_ROUTES.lessonRead(attemptId)}?page=${index}`, { method: "GET" });
      for (const step of page?.lesson?.steps || []) if (typeof step?.bodyText === "string") bodies.set(step.id, step.bodyText);
    }
    return { ...first, lesson: { ...first.lesson,
      steps: steps.map(step => typeof step?.bodyText === "string" || !bodies.has(step?.id) ? step : { ...step, bodyText: bodies.get(step.id) }) } };
  }

  async function loadLesson(attemptId = state.attemptId) {
    if (!attemptId || !state.actorKey) return null;
    const expected = ++reads;
    state.loading = true;
    state.error = "";
    try {
      const result = await readAllPages(attemptId);
      if (expected !== reads || attemptId !== state.attemptId) return null;
      const value = normalizeLesson(result);
      if (!value) throw new Error(result?.error || "This lesson could not be read. Refresh and try again.");
      lesson.value = value;
      // Restore the exact place: this tab's state first, then the learner's
      // saved reader position, then the first required step not yet passed.
      // A lesson with nothing passed yet starts at its first step.
      const known = id => value.steps.some(step => step.id === id);
      if (!known(state.stepId)) {
        const saved = value.reader?.attemptId === undefined || value.reader?.attemptId === attemptId ? value.reader : null;
        const passed = step => stepStatus(value.results, step.id, value.passedStepIds) === "passed";
        const unpassed = value.steps.some(passed) ? value.steps.find(step => step.required && !passed(step)) : null;
        state.stepId = saved && known(saved.stepId) ? saved.stepId : (unpassed || value.steps[0])?.id || "";
        state.scroll = saved && known(saved.stepId) && Number.isSafeInteger(saved.scroll) ? saved.scroll : 0;
      }
      remember();
      return value;
    } catch (cause) {
      if (expected === reads) state.error = String(cause?.message || "This lesson could not be read.");
      return null;
    } finally {
      if (expected === reads) state.loading = false;
    }
  }

  // Open the Courses overlay (or bring it back from minimised) on a surface,
  // and on the lesson reader at a step of the current lesson.
  async function show({ surface, attemptId, stepId } = {}) {
    if (!state.actorKey) throw new Error("Sign in before opening Courses.");
    state.open = true;
    state.minimised = false;
    state.hiddenBy = "";
    if (text(attemptId) && attemptId !== state.attemptId) {
      state.finished = false;
      selectAttempt(attemptId, stepId);
    } else if (text(stepId) && stepId !== state.stepId) {
      if (steps.value.length) selectStep(stepId);
      else state.stepId = stepId;
    }
    state.surface = SURFACES.includes(surface) ? surface : text(attemptId) ? "lesson" : state.surface;
    if (state.surface !== "lesson") state.finished = false;
    // Leaving a finished lesson's screen returns to the current lesson (or none).
    if (!state.finished && mode.value && mode.value.currentAttemptId !== state.attemptId && !text(attemptId)) acceptMode(mode.value);
    if (state.surface === "lesson" && !state.attemptId) state.surface = "courses";
    remember();
    if (state.surface === "lesson" && (!lesson.value || text(attemptId))) await loadLesson();
    if (state.surface === "progress" || state.surface === "archived") void readPractice();
    return focus.value;
  }

  // The Courses button: the overlay where the learner left it (or on a surface).
  const openCourses = surface => show({ surface });

  // The Lesson pane of the Learn page: Learn mode on, Courses closed (not as
  // the learner's own close), the step selected, and the lesson's home (its
  // practice project, else /app/learning) showing its Lesson pane.
  async function openLesson({ attemptId, stepId } = {}) {
    if (!state.actorKey) throw new Error("Sign in before opening a lesson.");
    const value = learnMode.value ? mode.value : await setMode(true);
    if (!value?.on) return null;
    minimise();
    if (text(attemptId) && attemptId !== state.attemptId) {
      state.finished = false;
      selectAttempt(attemptId, stepId);
    } else if (text(stepId) && stepId !== state.stepId) {
      if (steps.value.length) selectStep(stepId);
      else state.stepId = stepId;
    }
    remember();
    const target = `${learnHomePath(value)}?pane=lesson`;
    if (router && currentPath() !== target) await router.push(target);
    if (!lesson.value || text(attemptId)) await loadLesson();
    return focus.value;
  }

  // Hide the overlay with its state kept; Courses or Colleague brings it back.
  // by = "learner" only for the learner's own close or Escape; Show me, Teach
  // me and app navigation hide it to show something else.
  function minimise(by = "") {
    if (!state.open) return;
    state.hiddenBy = by === "learner" ? "learner" : "";
    state.open = false;
    state.minimised = true;
    flushReader();
  }

  const closeCourses = () => minimise("learner");

  function toggleStepBar() {
    state.stepBarCollapsed = !state.stepBarCollapsed;
    remember();
  }

  // The "Lesson finished" screen of the current lesson, in the lesson surface:
  // shown when this learner's own step action completes the lesson, and again
  // from the reader of a complete lesson. The screen finishes the attempt.
  async function showFinished() {
    if (!state.attemptId) return null;
    await show({ surface: "lesson" });
    state.finished = Boolean(complete.value);
    return focus.value;
  }

  // A learner's own step result that completes the lesson opens the Finished
  // screen (Colleague's step dialog gives way to it).
  function finishedBy(before, attemptId) {
    if (!before && complete.value && attemptId === state.attemptId) void showFinished().catch(() => {});
  }

  function selectStep(stepId) {
    if (!steps.value.some(step => step.id === stepId) || stepId === state.stepId) return;
    state.stepId = stepId;
    state.scroll = 0;
    remember();
    scheduleReaderSave();
  }

  function setScroll(scroll) {
    const value = Math.max(0, Math.round(Number(scroll) || 0));
    if (value === state.scroll) return;
    state.scroll = value;
    remember();
    scheduleReaderSave();
  }

  function scheduleReaderSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushReader, READER_SAVE_DELAY_MS);
  }

  // reader.json is last-write-wins; a failed save keeps this tab's place only.
  function flushReader() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!state.actorKey || !state.attemptId || !state.stepId || lesson.value?.attempt?.ended) return null;
    const body = { stepId: state.stepId, scroll: state.scroll };
    const key = JSON.stringify([state.attemptId, body]);
    if (key === lastSaved) return null;
    lastSaved = key;
    return Promise.resolve(request(VIBE64_LEARNING_ROUTES.readerSave(state.attemptId), { method: "POST", body }))
      .catch(() => { if (lastSaved === key) lastSaved = ""; });
  }

  // One step action; its confirmed verdict is then reread from lesson.read.
  async function stepAction(kind, route, stepId, extra = {}) {
    if (!state.attemptId || state.busy) return null;
    const attemptId = state.attemptId;
    const key = JSON.stringify([attemptId, kind, stepId, extra]);
    const requestId = pendingRequestId(key);
    const expected = viewer;
    const before = complete.value;
    state.busy = `${kind}:${stepId}`;
    state.error = "";
    try {
      const result = await request(route(attemptId), { method: "POST", body: { stepId, ...extra, requestId } });
      if (result?.ok === false) throw new Error(result.error || "The step result was not confirmed. Try again.");
      pending.delete(key);
      if (expected === viewer && attemptId === state.attemptId) {
        await loadLesson(attemptId);
        finishedBy(before, attemptId);
      }
      return result;
    } catch (cause) {
      if (expected === viewer) state.error = String(cause?.message || "The step result was not confirmed. Try again.");
      return null;
    } finally {
      if (state.busy === `${kind}:${stepId}`) state.busy = "";
    }
  }

  // Learner-origin App interaction: the step a press in projectSlug's Preview
  // answers. Only the current step of the current, prepared, not-ended version
  // 2 attempt whose practice project is projectSlug, while Courses does not
  // cover the app, and only when that step declares an automatic response
  // check (code checks always name files). The server's step owner decides
  // everything else.
  function exerciseStep(projectSlug) {
    const value = lesson.value;
    const step = currentStep.value;
    const attempt = value?.attempt;
    if (!state.actorKey || !state.attemptId || state.open || !text(projectSlug) || value?.schemaVersion !== 2 ||
        attempt?.attemptId !== state.attemptId || attempt.ended || attempt.preparation?.phase !== "ready" ||
        value.practiceProjectSlug !== projectSlug || step?.check?.kind !== "auto" || step.check.files?.length) return null;
    return { attemptId: state.attemptId, stepId: step.id };
  }

  // A press can begin only with a current response step; the ticket fences the
  // signed-in viewer, attempt, step and practice project until it finishes.
  function beginExercise(projectSlug) {
    const target = exerciseStep(projectSlug);
    if (!target || exerciseObservations.size >= MAX_EXERCISE_OBSERVATIONS) return null;
    return Object.freeze({ ...target, projectSlug, actorKey: state.actorKey, viewer });
  }

  function exerciseCurrent(ticket) {
    const target = ticket && ticket.viewer === viewer && ticket.actorKey === state.actorKey ? exerciseStep(ticket.projectSlug) : null;
    return Boolean(target && target.attemptId === ticket.attemptId && target.stepId === ticket.stepId);
  }

  // step.observe: the browser-only receipt of the learner's own press, with the
  // exact identities its declared check verifies against the App server.
  async function finishExercise(ticket, { sessionId, instanceId, interactionId, requestId } = {}) {
    if (!exerciseCurrent(ticket) || !text(sessionId) || exerciseObservations.has(requestId)) return null;
    exerciseObservations.add(requestId);
    const expected = viewer;
    const before = complete.value;
    try {
      const result = await request(VIBE64_LEARNING_ROUTES.stepObserve(ticket.attemptId), { method: "POST", body: {
        stepId: ticket.stepId, observation: { control: "exercise-response",
          exercise: { instanceId, interactionId, requestId },
          workspace: { projectSlug: ticket.projectSlug, sessionId, projectVisible: true, pane: "preview", ready: true } } } });
      if (result?.ok === false) throw new Error(result.error || "The App press was not recorded. Press the App's button again.");
      if (expected === viewer && ticket.attemptId === state.attemptId) {
        await loadLesson(ticket.attemptId);
        finishedBy(before, ticket.attemptId);
      }
      return result;
    } catch (cause) {
      if (expected === viewer) state.error = String(cause?.message || "The App press was not recorded. Press the App's button again.");
      return null;
    } finally {
      exerciseObservations.delete(requestId);
    }
  }

  // After a reload the current attempt is remembered but not read yet; a
  // practice App announcing itself reads it so the learner's next press can count.
  function prepareExercise(projectSlug) {
    if (!text(projectSlug) || !state.actorKey || !state.attemptId || lesson.value || state.loading) return null;
    return loadLesson(state.attemptId);
  }

  const runCheck = stepId => stepAction("check", VIBE64_LEARNING_ROUTES.stepCheck, stepId);
  const answer = (stepId, selected) => stepAction("answer", VIBE64_LEARNING_ROUTES.stepAnswer, stepId,
    { selected: [...selected].map(Number).sort((left, right) => left - right) });
  const done = stepId => stepAction("done", VIBE64_LEARNING_ROUTES.stepDone, stepId);

  // Show me: minimise Courses, then point at (and, when declared, open) the real place.
  async function showMe(stepId = currentStep.value?.id) {
    const step = steps.value.find(value => value.id === stepId);
    if (!step?.guide) throw new Error("This step has nothing to show.");
    let command = showMeCommand(step.guide, { projectSlug: lesson.value?.practiceProjectSlug || "" });
    minimise();
    const navigator = browserNavigation?.value || null;
    // A Database view belongs to one session: both hosts open it only with that
    // exact sessionId. Use the practice project's selected session, opening the
    // project first.
    if (navigator && command.databaseView) {
      if (!selectedSession(command.projectSlug)) {
        await navigator({ projectSlug: command.projectSlug });
        await waitForProjectView(command.projectSlug, selectedSession);
      }
      const sessionId = selectedSession(command.projectSlug);
      if (sessionId) command = { ...command, sessionId };
    }
    // A file guide opens its file through the view the navigation selected:
    // the view is read only after navigation and must belong to the target project.
    const navigateBrowser = navigator && command.guide.filePath
      ? async navigation => {
        const focus = await navigator(navigation);
        await waitForProjectView(command.projectSlug);
        return focus;
      }
      : navigator;
    const view = { openFile(path) {
      const handle = projectView(command.projectSlug);
      return handle ? handle.openFile(path) === true : false;
    } };
    return (runGuide || runTrainingGuideCommand)(command, { navigateBrowser, view });
  }

  function projectView(projectSlug) {
    const handle = colleagueView?.value;
    return projectSlug && handle?.projectSlug === projectSlug && handle.ready !== false &&
      typeof handle.openFile === "function" ? handle : null;
  }

  function selectedSession(projectSlug) {
    const handle = colleagueView?.value;
    return projectSlug && handle?.projectSlug === projectSlug && text(handle.sessionId) ? handle.sessionId : "";
  }

  async function waitForProjectView(projectSlug, published = projectView) {
    const deadline = now() + PROJECT_VIEW_WAIT_MS;
    while (!published(projectSlug) && now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Teach me: ask this host's Colleague, which opens beside the step and sends
  // the fixed message (watchColleagueLearningRequests in vibe64-colleague).
  // The step stays visible; from Courses it moves to the Lesson pane.
  function teachMe(stepId = currentStep.value?.id) {
    if (!state.attemptId || !stepId) throw new Error("Open a lesson step before asking Colleague to teach it.");
    selectStep(stepId);
    if (state.open) void openLesson().catch(() => {});
    colleagueRequest.value = Object.freeze({ id: `teach-${now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "teach", message: VIBE64_LEARNING_TEACH_MESSAGE, actorKey: state.actorKey, attemptId: state.attemptId, stepId });
    return colleagueRequest.value;
  }

  function consumeColleagueRequest(id) {
    if (colleagueRequest.value?.id !== id) return null;
    const value = colleagueRequest.value;
    colleagueRequest.value = null;
    return value;
  }

  // The current lesson's place: Learn mode on, the overlay hidden, the
  // lesson's practice project (or no project selected) with its step bar.
  async function openCurrent() {
    const value = learnMode.value ? await readLearningMode() : await setMode(true);
    if (!value?.on) return null;
    minimise();
    if (router && currentPath() !== learnHomePath(value)) await router.push(learnHomePath(value));
    return value;
  }

  // After a confirmed start, resume or restart: the attempt is current, Learn
  // mode is on; show its lesson over its place.
  async function opened(outcome) {
    if (!outcome?.attemptId || outcome.current === false) return outcome;
    const value = await readLearningMode();
    if (value?.on && router && currentPath() !== learnHomePath(value)) await router.push(learnHomePath(value));
    await show({ surface: "lesson", attemptId: outcome.attemptId });
    void readPractice();
    return outcome;
  }

  // Start a lesson through Courses' start (useVibe64LearningCourses.startLesson).
  // A different lesson in progress is refused once: the learner then confirms
  // archiving it (confirmArchiveAndStart) or keeps it (cancelArchive).
  async function startLesson(selection, start) {
    confirmArchive.value = null;
    try {
      return await opened(await start(selection));
    } catch (cause) {
      if (cause?.code !== VIBE64_LESSON_IN_PROGRESS_CODE) throw cause;
      confirmArchive.value = Object.freeze({ next: selection, start, current: Object.freeze({
        attemptId: String(cause.details?.attemptId || mode.value?.currentAttemptId || ""),
        lessonTitle: String(cause.details?.lessonTitle || mode.value?.lessonTitle || mode.value?.lessonCode || "") }) });
      return null;
    }
  }

  async function confirmArchiveAndStart() {
    const value = confirmArchive.value;
    if (!value) return null;
    confirmArchive.value = null;
    return opened(await value.start({ ...value.next, archiveCurrent: true }));
  }

  function cancelArchive() { confirmArchive.value = null; }

  // The saved progress revision that restart and finish are fenced by.
  async function readRevision() {
    const result = await request(VIBE64_LEARNING_ROUTES.learning, { method: "GET" });
    if (result?.ok !== true || !Number.isSafeInteger(result.revision)) throw new Error(result?.error || "Your saved lessons could not be read. Try again.");
    return result.revision;
  }

  // One change to the lesson in progress or an archive; then the mode, the
  // current lesson and the In progress / Archived lists are reread.
  async function attemptAction(kind, url, body = () => ({}), fallback = "The change was not confirmed. Try again.") {
    if (!state.actorKey || state.busy) return null;
    const expected = viewer;
    state.busy = kind;
    state.error = "";
    try {
      const result = await request(url, { method: "POST", body: await body() });
      if (result?.ok !== true) throw new Error(result?.error || fallback);
      if (expected === viewer) await Promise.all([readLearningMode(), readPractice()]);
      return result;
    } catch (cause) {
      if (expected === viewer) state.error = String(cause?.message || fallback);
      return null;
    } finally {
      if (state.busy === kind) state.busy = "";
    }
  }

  const currentAttemptId = () => mode.value?.currentAttemptId || "";

  // Finish: a complete lesson's attempt is archived as finished (its record,
  // practice project and conversation); Learn mode stays on with no lesson.
  function finish() {
    const attemptId = state.attemptId;
    if (!attemptId) return Promise.resolve(null);
    // A retry of the same attempt resumes its close; no request identity.
    return attemptAction("finish", VIBE64_LEARNING_ROUTES.lessonFinish(attemptId),
      async () => ({ expectedRevision: await readRevision() }), "Finishing the lesson was not confirmed. Try again.");
  }

  // Restart: archive the lesson in progress and start it again (a fresh
  // practice project, teacher conversation and results), then open it.
  async function restart() {
    const attemptId = currentAttemptId();
    if (!attemptId) return null;
    const key = JSON.stringify([attemptId, "restart"]);
    const result = await attemptAction("restart", VIBE64_LEARNING_ROUTES.lessonRestart(attemptId),
      async () => ({ requestId: pendingRequestId(key), expectedRevision: await readRevision() }),
      "Restarting the lesson was not confirmed. Try again.");
    if (!result) return null;
    pending.delete(key);
    const next = mode.value?.currentAttemptId || result.active?.attemptId || "";
    await opened({ attemptId: next });
    return result;
  }

  // Delete: remove the lesson in progress, its practice project and its
  // conversation, with no archive. Learn mode stays on with no lesson.
  async function deleteAttempt() {
    const attemptId = currentAttemptId();
    if (!attemptId) return null;
    return attemptAction("delete", VIBE64_LEARNING_ROUTES.lessonDelete(attemptId), () => ({ confirmed: true }),
      "Deleting the lesson was not confirmed. Try again.");
  }

  const deleteArchived = attemptId => attemptAction(`archive-delete:${attemptId}`, VIBE64_LEARNING_ROUTES.archiveDelete(attemptId),
    () => ({ confirmed: true }), "Deleting the archived lesson was not confirmed. Try again.");

  // The lesson in progress and the archived attempts; the latest read wins.
  async function readPractice() {
    if (!state.actorKey) return null;
    const expected = ++practiceReads;
    try {
      const value = normalizePractice(await request(VIBE64_LEARNING_ROUTES.practice, { method: "GET" }));
      if (expected === practiceReads) practice.value = value;
    } catch (cause) {
      if (expected === practiceReads) state.error = String(cause?.message || "Your lessons could not be read. Try again.");
    }
    return practice.value;
  }

  // Learner notes (C7). Saves replace the whole text against the revision
  // shown, so a newer change by Colleague is never silently overwritten.
  async function readNotes() {
    if (!state.actorKey) return null;
    const expected = viewer;
    notesState.loading = true;
    notesState.error = "";
    try {
      const result = await request(VIBE64_LEARNING_ROUTES.notes, { method: "GET" });
      if (result?.ok !== true || !result.notes) throw new Error(result?.error || "The notes could not be read.");
      // A read that finishes after a newer save never brings back older notes.
      if (expected === viewer && !(result.notes.revision < (notes.value?.revision ?? 0))) notes.value = Object.freeze({ ...result.notes });
      return expected === viewer ? notes.value : null;
    } catch (cause) {
      if (expected === viewer) notesState.error = String(cause?.message || "The notes could not be read.");
      return null;
    } finally {
      if (expected === viewer) notesState.loading = false;
    }
  }

  async function writeNotes(kind, route, body) {
    if (!state.actorKey || notesState.saving) return null;
    const expected = viewer;
    const expectedRevision = notes.value?.revision ?? 0;
    const key = JSON.stringify(["notes", kind, body.text ?? "", expectedRevision]);
    const requestId = pendingRequestId(key);
    notesState.saving = true;
    notesState.error = "";
    try {
      const result = await request(route, { method: "POST", body: { ...body, requestId, expectedRevision } });
      if (result?.ok !== true || !result.notes) throw new Error(result?.error || "The notes save was not confirmed. Try again.");
      pending.delete(key);
      if (expected === viewer) notes.value = Object.freeze({ ...result.notes });
      return result;
    } catch (cause) {
      if (expected === viewer) {
        notesState.error = String(cause?.message || "The notes save was not confirmed. Try again.");
        // Someone else changed them: show the current notes; the edit stays with the caller.
        if (cause?.code === "VIBE64_TRAINING_NOTES_CHANGED") {
          pending.delete(key);
          const message = notesState.error;
          await readNotes();
          notesState.error = message;
        }
      }
      return null;
    } finally {
      if (expected === viewer) notesState.saving = false;
    }
  }

  function saveNotes(text) {
    const value = String(text ?? "");
    if (!value || value.length > VIBE64_LEARNING_NOTES_MAX) {
      notesState.error = `Write between 1 and ${VIBE64_LEARNING_NOTES_MAX} characters, or clear the notes.`;
      return Promise.resolve(null);
    }
    return writeNotes("update", VIBE64_LEARNING_ROUTES.notes, { text: value });
  }

  const clearNotes = () => writeNotes("clear", VIBE64_LEARNING_ROUTES.notesClear, {});

  // Realtime: a notes change rereads the notes when they were shown; a step
  // change rereads the current lesson; every other learner change (mode,
  // lesson, practice) rereads the mode and the In progress / Archived lists.
  function learnerChanged(payload = {}) {
    if (payload.reason === "notes") return notes.value ? readNotes() : null;
    if (!state.actorKey) return null;
    if (payload.reason !== "steps") {
      void readLearningMode();
      if (practice.value.loaded) void readPractice();
    }
    if (state.attemptId && (!payload.attemptId || payload.attemptId === state.attemptId) && lesson.value) {
      return loadLesson(state.attemptId);
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
    get stepId() { return currentStep.value?.id || ""; },
    get scroll() { return state.scroll; },
    get complete() { return complete.value; },
    get finished() { return state.finished; },
    get mode() { return mode.value; },
    get learnMode() { return learnMode.value; },
    // The lesson the Lesson pane shows: the mode's current attempt.
    get lessonAttemptId() { return mode.value?.currentAttemptId || ""; },
    get lessonTitle() { return mode.value?.currentAttemptId ? mode.value.lessonTitle || mode.value.lessonCode || "" : ""; },
    get practice() { return practice.value; },
    get confirmArchive() { return confirmArchive.value; },
    get stepBarCollapsed() { return state.stepBarCollapsed; },
    get notice() { return state.notice; },
    lesson, results, steps, currentStep, focus, colleagueRequest, notes, notesState: readonly(notesState),
    stepStatus: stepId => stepStatus(results.value, stepId, lesson.value?.passedStepIds || []),
    setViewer, show, openCourses, openLesson, closeCourses, showFinished, minimise, selectStep, setScroll, flushReader, loadLesson,
    runCheck, answer, done, showMe, teachMe, consumeColleagueRequest, learnerChanged,
    exerciseStep, beginExercise, exerciseCurrent, finishExercise, prepareExercise,
    readNotes, saveNotes, clearNotes,
    readLearningMode, setMode, toggleMode, modePlace, openCurrent, toggleStepBar, showNotice, clearNotice,
    startLesson, opened, confirmArchiveAndStart, cancelArchive, restart, finish, deleteAttempt, readPractice, deleteArchived
  });
}

// A link in lesson text to another site opens in a new tab, so following
// "open Z.AI's key page" keeps Vibe64, Learning and the reader's place open.
// Links inside Vibe64, modified clicks and non-web schemes keep the default.
function openLessonLink(event, browser = globalThis) {
  const link = event?.target?.closest?.("a[href]");
  if (!link || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  let url;
  try { url = new URL(link.getAttribute("href"), browser.location?.href); } catch { return false; }
  if (!/^https?:$/u.test(url.protocol) || url.origin === browser.location?.origin) return false;
  event.preventDefault();
  browser.open?.(url.href, "_blank", "noopener,noreferrer");
  return true;
}

// On a phone the step list is one horizontal row; the current step is scrolled
// into that row so Next and Previous never leave it hidden off-screen. Only
// the row moves: the page and the reader body keep their scroll.
function revealCurrentStep(list) {
  const current = list?.querySelector?.('[aria-current="step"]');
  if (!current || !(list.scrollWidth > list.clientWidth)) return false;
  const row = list.getBoundingClientRect();
  const item = current.getBoundingClientRect();
  if (item.left < row.left) list.scrollLeft -= row.left - item.left;
  else if (item.right > row.right) list.scrollLeft += item.right - row.right;
  else return false;
  return true;
}

export { VIBE64_DEVELOP_MODE_NOTE, VIBE64_LEARNING_MODE_NOTE, VIBE64_LEARNING_MODE_PROJECT_CODE, VIBE64_LEARNING_NOTES_MAX, VIBE64_LEARNING_PAGE_PATH, VIBE64_LEARNING_ROUTES, VIBE64_LEARNING_TEACH_MESSAGE, VIBE64_LESSON_IN_PROGRESS_CODE, createVibe64Learning, modeRedirect, normalizePractice, openLessonLink, revealCurrentStep, showMeCommand, stepStatus };
