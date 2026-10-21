// Learn and Develop. Every learner is in one of two modes: Learn shows only
// their practice projects, Develop only their own projects. The mode is a
// saved per-learner flag, separate from any lesson; switching ends nothing.
// Opening a project of the other mode is refused with a short reason. Nothing
// inside an allowed project is limited, and non-project pages (Account
// settings, AI Accounts) are never affected, so switching is always one press
// of L.
//
// Training owns the saved mode; each host registers one reader of it. The mode
// keeps a learner focused; it is not an access grant or a security boundary
// (ordinary project access and practice admission still apply first), so a
// reader that fails is reported and counts as Develop. Without a registered
// reader (no Learning on this host) there is no mode and nothing is limited.

const LEARNING_MODE_PROJECT_CODE = "vibe64_learning_mode_project";
const LEARNING_MODE_PROJECT_MESSAGE = "You're in Learn mode. Press L to go back to your projects.";
const PRACTICE_PROJECT_MODE_MESSAGE = "This is a practice project. Press L to switch to Learn.";
const DEVELOP_MODE = Object.freeze({ on: false, currentAttemptId: "", lessonCode: "", practiceSlug: "" });

let learningModeReader = null;
let learningModeReadFailure = null;
const requestModes = new WeakMap();

function registerLearningModeReader(reader, { onReadFailure = null } = {}) {
  if (reader !== null && typeof reader !== "function") throw new TypeError("Learning mode needs its Training reader.");
  learningModeReader = reader;
  learningModeReadFailure = typeof onReadFailure === "function" ? onReadFailure : null;
}

// The learner's mode: { on, currentAttemptId, lessonCode, practiceSlug }, or
// null when no reader is registered. A Colleague turn passes its `thread`
// ("learn" or "develop"): the turn keeps that thread's mode after a switch
// with L, so the switch never interrupts it. A request object (HTTP or
// WebSocket) caches the one result for its lifetime.
async function readLearningModeFor(actor = null, { request = null, thread = "" } = {}) {
  if (!learningModeReader) return null;
  if (request && typeof request === "object" && requestModes.has(request)) return requestModes.get(request);
  let mode = DEVELOP_MODE;
  try {
    const value = await learningModeReader({ actor });
    mode = Object.freeze({
      on: value?.on === true,
      currentAttemptId: String(value?.currentAttemptId || ""),
      lessonCode: String(value?.lessonCode || ""),
      practiceSlug: String(value?.practiceSlug || "")
    });
  } catch (error) {
    learningModeReadFailure?.(error);
  }
  if (thread === "learn" || thread === "develop") mode = Object.freeze({ ...mode, on: thread === "learn" });
  if (request && typeof request === "object") requestModes.set(request, mode);
  return mode;
}

// Learn allows only practice projects; Develop refuses them. `practice` is
// whether practice admission found a learning-space project for `slug`; a
// caller without admission leaves it out, and then only the learner's current
// practice project counts (with one lesson in progress, it is their only one).
function learningModeAllowsProject(mode = null, slug = "", { practice } = {}) {
  if (!mode) return true;
  const isPractice = typeof practice === "boolean" ? practice
    : Boolean(mode.practiceSlug) && mode.practiceSlug === String(slug || "");
  return mode.on === true ? isPractice : !isPractice;
}

function refusal(mode = null) {
  const learn = mode?.on === true;
  return {
    code: LEARNING_MODE_PROJECT_CODE,
    message: learn ? LEARNING_MODE_PROJECT_MESSAGE : PRACTICE_PROJECT_MODE_MESSAGE,
    statusCode: 403,
    ...(learn && mode.practiceSlug ? { details: { practiceSlug: mode.practiceSlug } } : {})
  };
}

// The refusal for opening `slug` in this mode, or null.
function learningModeProjectBlock(mode = null, slug = "", options = {}) {
  return learningModeAllowsProject(mode, slug, options) ? null : refusal(mode);
}

function learningModeProjectError(mode = null) {
  const { message, ...fields } = refusal(mode);
  return Object.assign(new Error(message), fields);
}

async function assertLearningModeAllowsProject({ actor = null, slug = "", request = null, thread = "", practice } = {}) {
  const mode = await readLearningModeFor(actor, { request, thread });
  if (!learningModeAllowsProject(mode, slug, { practice })) throw learningModeProjectError(mode);
}

export {
  LEARNING_MODE_PROJECT_CODE,
  LEARNING_MODE_PROJECT_MESSAGE,
  PRACTICE_PROJECT_MODE_MESSAGE,
  assertLearningModeAllowsProject,
  learningModeProjectBlock,
  learningModeProjectError,
  readLearningModeFor,
  registerLearningModeReader
};
