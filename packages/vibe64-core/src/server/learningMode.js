// Learning mode (Learning v2 product decision 8). While a learner has a lesson
// in progress and has not left it, their projects are the practice projects of
// that lesson only: listings show only those, and opening any other project
// page or session is refused with a short reason. Nothing inside the lesson's
// practice project is limited, and non-project pages (Learning, Account
// settings, AI Accounts) are never affected, so leaving is always one click.
//
// Training owns the saved mode; each host registers one reader of it. Learning
// mode keeps a learner focused; it is not an access grant or a security
// boundary (ordinary project access still applies first), so a reader that
// fails is reported and treated as "not in learning mode" instead of locking
// the learner out of their own projects.

const LEARNING_MODE_PROJECT_CODE = "vibe64_learning_mode_project";
const LEARNING_MODE_PROJECT_MESSAGE = "You're in a lesson. Leave lesson to get back to your projects.";

let learningModeReader = null;
let learningModeReadFailure = null;
const requestModes = new WeakMap();

function registerLearningModeReader(reader, { onReadFailure = null } = {}) {
  if (reader !== null && typeof reader !== "function") throw new TypeError("Learning mode needs its Training reader.");
  learningModeReader = reader;
  learningModeReadFailure = typeof onReadFailure === "function" ? onReadFailure : null;
}

// The learner's current mode, or null when they are not in learning mode. A
// request object (HTTP or WebSocket) caches the one read for its lifetime.
async function readLearningModeFor(actor = null, { request = null } = {}) {
  if (!learningModeReader) return null;
  if (request && typeof request === "object" && requestModes.has(request)) return requestModes.get(request);
  let mode = null;
  try {
    const value = await learningModeReader({ actor });
    mode = value?.on === true ? Object.freeze({
      attemptId: String(value.attemptId || ""),
      lessonCode: String(value.lessonCode || ""),
      practiceSlug: String(value.practiceSlug || ""),
      projectSlugs: Object.freeze((Array.isArray(value.projectSlugs) ? value.projectSlugs : []).map(String).filter(Boolean))
    }) : null;
  } catch (error) {
    learningModeReadFailure?.(error);
    mode = null;
  }
  if (request && typeof request === "object") requestModes.set(request, mode);
  return mode;
}

function learningModeAllowsProject(mode = null, slug = "") {
  return !mode || mode.projectSlugs.includes(String(slug || ""));
}

function refusal(mode = null) {
  return {
    code: LEARNING_MODE_PROJECT_CODE,
    message: LEARNING_MODE_PROJECT_MESSAGE,
    statusCode: 403,
    ...(mode?.practiceSlug ? { details: { practiceSlug: mode.practiceSlug } } : {})
  };
}

// The refusal for opening `slug` while in learning mode, or null.
function learningModeProjectBlock(mode = null, slug = "") {
  return learningModeAllowsProject(mode, slug) ? null : refusal(mode);
}

function learningModeProjectError(mode = null) {
  const { message, ...fields } = refusal(mode);
  return Object.assign(new Error(message), fields);
}

async function assertLearningModeAllowsProject({ actor = null, slug = "", request = null } = {}) {
  const mode = await readLearningModeFor(actor, { request });
  if (!learningModeAllowsProject(mode, slug)) throw learningModeProjectError(mode);
}

// A listing as a learner in learning mode sees it: only this lesson's
// practice projects (none for a lesson without a practice project).
function learningModeProjects(projects = [], mode = null) {
  if (!mode) return projects;
  return projects.filter((project) => mode.projectSlugs.includes(String(project?.slug || "")));
}

export {
  LEARNING_MODE_PROJECT_CODE,
  LEARNING_MODE_PROJECT_MESSAGE,
  assertLearningModeAllowsProject,
  learningModeAllowsProject,
  learningModeProjectBlock,
  learningModeProjectError,
  learningModeProjects,
  readLearningModeFor,
  registerLearningModeReader
};
