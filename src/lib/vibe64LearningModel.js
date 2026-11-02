import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import { practiceProjectName } from "@/lib/vibe64PracticeProjectName.js";
import { learningVocabulary, trainingGuideRequest, trainingGuideSteps } from "@local/vibe64-training/shared/learning-vocabulary";
import {
  LEARNER_NOTES_MAX_CHARS,
  TRAINING_LESSON_IN_PROGRESS_CODE,
  TRAINING_PRACTICE_AI_REQUIRED_CODE
} from "@local/vibe64-training/shared/learner-contract";

// The Learning controller's pure parts and the types its concern factories
// share: the Training actions' HTTP routes, the addresses each mode allows,
// this browser's saved places, the normalized reads, the words for step
// results and the Show me command.
const TRAINING_PATH = "/api/vibe64/training";
const attemptPath = (attemptId, suffix = "") => `${TRAINING_PATH}/attempts/${encodeURIComponent(attemptId)}${suffix}`;
// HTTP routes for the Training actions (registerRoutes.js assembles their input).
const VIBE64_LEARNING_ROUTES = Object.freeze({
  lessonRead: attemptId => attemptPath(attemptId, "/lesson"),
  stepObserve: attemptId => attemptPath(attemptId, "/steps/observe"),
  stepCheck: attemptId => attemptPath(attemptId, "/steps/check"),
  stepAnswer: attemptId => attemptPath(attemptId, "/steps/answer"),
  stepDone: attemptId => attemptPath(attemptId, "/steps/done"),
  // check.kind "review": an AI review of the learner's work, on their own AI.
  stepReview: attemptId => attemptPath(attemptId, "/steps/review"),
  readerSave: attemptId => attemptPath(attemptId, "/reader"),
  visual: (attemptId, visualId) => attemptPath(attemptId, `/visuals/${encodeURIComponent(visualId)}`),
  // The lesson in progress: restart (archive it, start again), finish (archive a complete lesson), delete.
  lessonRestart: attemptId => attemptPath(attemptId, "/restart"),
  lessonFinish: attemptId => attemptPath(attemptId, "/finish"),
  lessonDelete: attemptId => attemptPath(attemptId, "/delete"),
  // Saved progress (its revision fences restart and finish).
  learning: `${TRAINING_PATH}/learning`,
  // Courses: the installed courses and the official catalogue.
  courses: `${TRAINING_PATH}/courses`,
  available: `${TRAINING_PATH}/available`,
  courseInstall: `${TRAINING_PATH}/courses/install`,
  lessonStart: `${TRAINING_PATH}/lessons/start`,
  lessonResume: attemptId => attemptPath(attemptId, "/resume"),
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
// Training's refusal codes and notes limit (owned by its learner contract).
const VIBE64_LESSON_IN_PROGRESS_CODE = TRAINING_LESSON_IN_PROGRESS_CODE;
const VIBE64_LEARNING_AI_REQUIRED_CODE = TRAINING_PRACTICE_AI_REQUIRED_CODE;
const VIBE64_LEARNING_NOTES_MAX = LEARNER_NOTES_MAX_CHARS;
// The Courses catalogue's tabs. A stored "lesson" (the retired reader tab) reads as courses.
const SURFACES = Object.freeze(["courses", "progress", "archived"]);
const STORAGE_PREFIX = "vibe64:learning-environment:v2:";
const MODE_PLACE_PREFIX = "vibe64:mode-place:v1:";
// Teach me sends this exact text; the step itself travels in Colleague's focus.
const VIBE64_LEARNING_TEACH_MESSAGE = "Teach me this step.";
const VIBE64_LEARNING_STUCK_MESSAGE = "I'm stuck on this step.";
const EMPTY_PRACTICE = Object.freeze({ current: null, archived: Object.freeze([]), loaded: false });
// A part the host shell does not publish (its layout, page focus, browser
// navigation or Colleague's project view): a ref that holds nothing.
const NO_HOST_PART = Object.freeze({ value: null });

/**
 * The controller's reactive state, which its concern factories share.
 * @typedef {object} LearningState
 * @property {boolean} open the Courses overlay shows
 * @property {boolean} minimised the Courses overlay is hidden with its state kept
 * @property {string} surface the Courses tab (one of SURFACES)
 * @property {string} attemptId the attempt the Lesson pane reads
 * @property {string} stepId its selected step
 * @property {number} scroll the reader's scroll in that step
 * @property {boolean} loading a lesson read is in flight
 * @property {string} lessonError the error of the lesson read and the step actions (Reader, Step, step bar); each
 *   surface has its own error, cleared only when its own operation starts
 * @property {string} attemptsError the error of restart, finish, delete and the In progress / Archived list (Attempts,
 *   Finished)
 * @property {string} actorKey the signed-in viewer
 * @property {string} busy the step or attempt action in flight
 * @property {string} hiddenBy "learner" when the learner's own close or Escape hid the overlay (Colleague then returns a
 *   phone learner to its conversation), else ""
 * @property {boolean} finished the Lesson pane shows the "Lesson finished" screen
 * @property {string} notice the overlay notice (a failed L switch)
 * @property {string} modeBusy the L switch in flight
 * @property {boolean} modeRead this viewer's mode has been read (or found unreadable)
 * @property {string} trialAttemptId a saved lesson opened in this tab that is not the mode's lesson in progress (a
 *   host's own saved lesson in Courses); it is the current lesson here and never changes the learner's mode
 * @property {number} beat where the step bar is in the step's beats
 * @property {boolean} beatPaused the step bar's pause
 * @property {boolean} orientationRequested Take the tour asked the mounted Courses overlay to start its orientation lesson
 */

/**
 * The studio's HTTP request for a Training action (or a test's stub).
 * @typedef {(url: string, options: { method: string, body?: object }) => Promise<any>} LearningRequest
 */

/**
 * The page layout a host shell publishes: a studio page, the Lesson toggle's
 * place and state, the chat's visibility, and the moves between a phone's two
 * sides.
 * @typedef {import("vue").Ref<{
 *   studio?: boolean,
 *   lessonShown?: boolean,
 *   lessonToggleOnBar?: boolean,
 *   chatVisible?: boolean,
 *   showProject?: () => void,
 *   hideLesson?: () => void,
 *   showChat?: () => void
 * } | null>} LearningLayout
 */

/**
 * Colleague's project view (its project, selected session and file opener), as a host shell publishes it.
 * @typedef {import("vue").Ref<object | null>} LearningColleagueView
 */

/**
 * The host shell's browser navigation to a project place.
 * @typedef {import("vue").Ref<Function | null>} LearningBrowserNavigation
 */

/** @typedef {typeof import("@local/vibe64-training/client/guide").runTrainingGuideCommand} LearningGuideRunner */
/** @typedef {import("vue-router").Router} LearningRouter */
/** @typedef {ReturnType<typeof import("./vibe64PageActivity.js").createPageActivity>} LearningPageActivity */
/** @typedef {ReturnType<typeof createPendingRequestIds>} LearningPendingRequestIds */

const text = value => typeof value === "string" && value.length > 0;

/**
 * This browser's storage of one kind, or null where it cannot be reached.
 */
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

/**
 * This tab's place (sessionStorage): the Courses tab, and the Lesson pane's
 * attempt, step and scroll (trialAttemptId: a saved lesson opened here that is
 * not the learner's lesson in progress), and
 * the step bar's beat and pause.
 */
function readPlace(actorKey) {
  const value = readJson("sessionStorage", `${STORAGE_PREFIX}${actorKey}`);
  if (!value) return null;
  return { surface: SURFACES.includes(value.surface) ? value.surface : "courses",
    attemptId: text(value.attemptId) ? value.attemptId : "", stepId: text(value.stepId) ? value.stepId : "",
    trialAttemptId: text(value.trialAttemptId) && value.trialAttemptId === value.attemptId ? value.trialAttemptId : "",
    scroll: Number.isSafeInteger(value.scroll) && value.scroll >= 0 ? value.scroll : 0,
    beat: Number.isSafeInteger(value.beat) && value.beat >= 0 ? value.beat : 0, beatPaused: value.beatPaused === true };
}

/**
 * Saves this tab's place (readPlace) for the signed-in viewer.
 * @param {LearningState} state
 */
function rememberPlace(state) {
  if (!state.actorKey) return;
  writeJson("sessionStorage", `${STORAGE_PREFIX}${state.actorKey}`, { surface: state.surface, attemptId: state.attemptId,
    stepId: state.stepId, scroll: state.scroll, trialAttemptId: state.trialAttemptId,
    beat: state.beat, beatPaused: state.beatPaused });
}

// The lesson's own on/off flag in the address (?lesson=1), apart from the
// project's Preview | Dash pane: while it is on, the Lesson sheet covers the
// pane it is shown over (or docks beside a studio page).
const lessonShownIn = query => query?.lesson === "1";
const withLesson = path => `${path}?lesson=1`;
function withoutLesson(query = {}) {
  const { lesson: _lesson, ...rest } = query || {};
  return rest;
}

// Each mode's last place in this browser (localStorage): the full route,
// including the Preview/Dashboard pane and the dashboard section.
const modePlaceKey = (actorKey, side) => `${MODE_PLACE_PREFIX}${actorKey}:${side}`;
const modeSide = on => on ? "learn" : "develop";

/**
 * A lesson.read result as the reader displays it.
 */
function normalizeLesson(result) {
  if (!result || result.ok === false || result.available === false) return null;
  const lesson = result.lesson || {};
  const steps = Array.isArray(lesson.steps) ? lesson.steps.filter(step => text(step?.id)) : [];
  const attempt = result.attempt || null;
  return Object.freeze({
    schemaVersion: lesson.schemaVersion ?? (steps.length ? 2 : 1),
    stage: lesson.stage === "studio" || lesson.stage === "project" ? lesson.stage : "",
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

/**
 * A learning-mode read as the client uses it; anything unreadable is null,
 * which counts as Develop, so a failed read never locks anyone out of projects.
 */
function normalizeLearningMode(result) {
  const mode = result?.ok === true && result.available !== false ? result.learningMode : null;
  if (!mode || typeof mode !== "object") return null;
  const value = key => text(mode[key]) ? mode[key] : "";
  return Object.freeze({ on: mode.on === true, currentAttemptId: value("currentAttemptId"),
    lessonCode: value("lessonCode"), lessonTitle: value("lessonTitle"), practiceSlug: value("practiceSlug"),
    lessonStage: ["studio", "project"].includes(mode.lessonStage) ? mode.lessonStage : "" });
}

/**
 * practice.list as Courses → In progress / Archived shows it: the lesson in
 * progress (its practice project, if any) and the archived attempts. Display
 * only; the Training actions authorize every change.
 */
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

// The studio home: where Learn mode lives outside any project. Public's is
// /app/learning (the project page with no project selected); a host whose
// studio has its own pages sets its own at startup.
let studioHome = VIBE64_LEARNING_PAGE_PATH;
function setLearningStudioHome(path) {
  if (typeof path !== "string" || !/^\/app(\/[a-z0-9-]+)*$/u.test(path)) throw new TypeError(`Studio home ${path} is not an /app page.`);
  studioHome = path;
}

/**
 * Where Learn mode lives: a project lesson's practice project, else (a studio
 * lesson, or no lesson) the studio home. The lesson's stage decides.
 */
function learnHomePath(mode) {
  return mode?.lessonStage === "project" && mode.practiceSlug ? projectAppPath(mode.practiceSlug) : studioHome;
}

/**
 * The move an address needs in the current mode, or null when it may stay.
 * Learn allows the current lesson's practice project and the studio pages
 * outside any project (a project lesson leaves /app/learning for its
 * project); Develop allows everything but that practice project and
 * /app/learning. The server decides any other practice project.
 * An unread or unreadable mode (null) moves nothing.
 */
function modeRedirect({ mode = null, slug = "", path = "" } = {}) {
  if (!mode) return null;
  const projectSlug = String(slug || "").trim();
  const atLearnPage = String(path || "").replace(/\/+$/u, "") === VIBE64_LEARNING_PAGE_PATH;
  if (mode.on) {
    if (projectSlug ? projectSlug === mode.practiceSlug : !(atLearnPage && learnHomePath(mode) !== VIBE64_LEARNING_PAGE_PATH)) return null;
    return Object.freeze({ path: learnHomePath(mode), note: projectSlug ? VIBE64_LEARNING_MODE_NOTE : "" });
  }
  if (atLearnPage) return Object.freeze({ path: DEVELOP_HOME_PATH, note: "" });
  if (projectSlug && projectSlug === mode.practiceSlug) return Object.freeze({ path: DEVELOP_HOME_PATH, note: VIBE64_DEVELOP_MODE_NOTE });
  return null;
}

// A step's status, as the Lesson pane, its step list and the step bar say it.
const STEP_STATUS_LABELS = Object.freeze({ passed: "Passed", "not-yet-passed": "Not yet passed", "not-started": "Not checked yet" });

// A step passed earlier in this attempt keeps its pass: the server neither
// checks nor records a later answer, check or review.
const ALREADY_PASSED_NOTE = "You already passed this step, so this was not checked again. Your earlier pass counts.";

/**
 * The words for an answer or check result (step.answer, step.check): an
 * earlier pass kept, or why it did not pass. A pass says nothing more.
 */
function checkNote(result) {
  if (result?.alreadyPassed) return ALREADY_PASSED_NOTE;
  return result?.outcome === "not-yet-passed" && result.reason ? String(result.reason) : "";
}

/**
 * The words for a review result (step.review.run, or a saved review result):
 * its verdict with the reviewer's comment, and a Not yet's hint.
 */
function reviewNote(result) {
  if (!result) return "";
  if (result.alreadyPassed) return ALREADY_PASSED_NOTE;
  const comment = String(result.review?.comment || "").trim();
  const hint = String(result.review?.hint || "").trim();
  if (result.outcome === "passed") return comment ? `Passed ✓ ${comment}` : "Passed ✓";
  // No review (for example no changes yet): the server's reason as it is.
  if (!comment) return String(result.reason || "").trim();
  return `Not yet: ${comment}${hint ? ` Hint: ${hint}` : ""}`;
}

/**
 * The words after Check my work on a review step: its result, or why the
 * review could not run (the lesson's error from step.review.run).
 */
function reviewRunNote(result, lessonError = "") {
  return result ? reviewNote(result) : lessonError || "Your work could not be checked. Try again.";
}

/**
 * passed wins over any later not-yet-passed (a pass is final); otherwise the latest outcome.
 */
function stepStatus(results, stepId, passedStepIds = []) {
  const own = results.filter(result => result?.stepId === stepId);
  if (passedStepIds.includes(stepId) || own.some(result => result.outcome === "passed")) return "passed";
  return own.length ? own.at(-1).outcome || "not-yet-passed" : "not-started";
}

/**
 * The browser guide command for one step's declared guide: a studio page
 * opens by its route, a project view only in the practice project; anything
 * else (the L button, a project place without a practice project) only points.
 */
function showMeCommand(guide, { projectSlug = "", sessionId = "" } = {}) {
  const request = trainingGuideRequest({ target: guide?.target,
    ...(guide?.navigate !== undefined ? { navigate: guide.navigate } : {}),
    ...(guide?.filePath !== undefined ? { filePath: guide.filePath } : {}) });
  const steps = trainingGuideSteps(request);
  const caption = text(guide?.caption) ? guide.caption.slice(0, 256) : steps.map(value => value.label).join(" → ");
  const open = learningVocabulary.place(request.target).open;
  const navigate = request.navigate && Boolean(open?.route || open?.pane && projectSlug);
  const command = { guide: { ...request, navigate, highlight: true, steps, caption } };
  if (!navigate) return command;
  if (open.route) return { ...command, route: open.route };
  return { ...command, projectSlug, ...(text(sessionId) ? { sessionId } : {}), pane: open.pane,
    ...(open.databaseView ? { databaseView: open.databaseView } : {}) };
}

/**
 * The request IDs of unconfirmed requests: a retry of the same input reuses
 * its request ID until a confirmed result forgets it.
 */
function createPendingRequestIds() {
  const pending = new Map();

  function requestId(key) {
    const value = pending.get(key) || globalThis.crypto.randomUUID();
    pending.set(key, value);
    return value;
  }

  function forget(key) {
    pending.delete(key);
  }

  function clear() {
    pending.clear();
  }

  return Object.freeze({
    requestId,
    forget,
    clear
  });
}

export {
  DEVELOP_HOME_PATH,
  EMPTY_PRACTICE,
  NO_HOST_PART,
  STEP_STATUS_LABELS,
  SURFACES,
  VIBE64_DEVELOP_MODE_NOTE,
  VIBE64_LEARNING_AI_REQUIRED_CODE,
  VIBE64_LEARNING_MODE_NOTE,
  VIBE64_LEARNING_MODE_PROJECT_CODE,
  VIBE64_LEARNING_NOTES_MAX,
  VIBE64_LEARNING_PAGE_PATH,
  VIBE64_LEARNING_ROUTES,
  VIBE64_LEARNING_STUCK_MESSAGE,
  VIBE64_LEARNING_TEACH_MESSAGE,
  VIBE64_LESSON_IN_PROGRESS_CODE,
  checkNote,
  createPendingRequestIds,
  learnHomePath,
  lessonShownIn,
  modePlaceKey,
  modeRedirect,
  modeSide,
  normalizeLearningMode,
  normalizeLesson,
  normalizePractice,
  readJson,
  readPlace,
  rememberPlace,
  reviewNote,
  reviewRunNote,
  setLearningStudioHome,
  showMeCommand,
  stepStatus,
  text,
  withLesson,
  withoutLesson,
  writeJson
};
