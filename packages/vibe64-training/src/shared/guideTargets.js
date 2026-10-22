// The closed product list of real Vibe64 places a lesson teacher can point at
// or open. Each step is a `data-vibe64-guide` id on an existing control; the
// overlay rings the deepest visible step, so the learner sees where to click
// next from wherever they are. Lessons never supply selectors.
const step = (id, label) => Object.freeze({ id, label });
const PREVIEW = step("preview", "Preview");
const DASHBOARD = step("dashboard", "Dashboard");
const DATABASE = step("database", "Database");
const TRAINING_GUIDE_PLACES = Object.freeze({
  preview: Object.freeze({ pane: "preview", steps: [PREVIEW] }),
  // Dashboard has no single view to open: open one of its sections instead.
  dashboard: Object.freeze({ pointOnly: true, steps: [DASHBOARD] }),
  "database-erd": Object.freeze({ pane: "database", databaseView: "erd", steps: [DASHBOARD, DATABASE, step("database-erd", "ERD")] }),
  "database-data": Object.freeze({ pane: "database", databaseView: "data", steps: [DASHBOARD, DATABASE, step("database-data", "Data")] }),
  files: Object.freeze({ pane: "files", steps: [DASHBOARD, step("files", "Files")] }),
  changes: Object.freeze({ pane: "changes", steps: [DASHBOARD, step("changes", "Current changes")] }),
  "git-log": Object.freeze({ pane: "repository", steps: [DASHBOARD, step("git-log", "Git log")] }),
  "session-info": Object.freeze({ pane: "session", steps: [DASHBOARD, step("session-info", "Session info")] }),
  architecture: Object.freeze({ pane: "system", steps: [DASHBOARD, step("architecture", "Architecture")] }),
  // The L button that switches between Develop and Learn (navigate also opens Courses).
  learning: Object.freeze({ project: false, steps: [step("learning", "Learning")] }),
  // Point-only places (a lesson step bar beat or a teacher's pointer; no view
  // to open). project: false also exists in a lesson without a practice
  // project; event names the page activity that completes a `do` beat there.
  lesson: Object.freeze({ pane: "lesson", pointOnly: true, project: false, steps: [step("lesson", "Lesson")] }),
  chat: Object.freeze({ pointOnly: true, steps: [step("chat", "Coding chat")] }),
  colleague: Object.freeze({ pointOnly: true, project: false, event: "colleague-opened", steps: [step("colleague", "Colleague")] }),
  courses: Object.freeze({ pointOnly: true, project: false, steps: [step("courses", "Courses")] }),
  "lesson-bar": Object.freeze({ pointOnly: true, project: false, steps: [step("lesson-bar", "Lesson step bar")] }),
  save: Object.freeze({ pointOnly: true, event: "saved", steps: [step("save", "Save")] }),
  "reload-preview": Object.freeze({ pointOnly: true, event: "preview-reloaded", steps: [PREVIEW, step("reload-preview", "Reload preview")] })
});
// Earlier teacher targets keep their original "open the view" meaning.
const TRAINING_GUIDE_ALIASES = Object.freeze({ "workspace-preview": "preview", "workspace-erd": "database-erd" });
const TRAINING_GUIDE_TARGETS = Object.freeze([...Object.keys(TRAINING_GUIDE_PLACES), ...Object.keys(TRAINING_GUIDE_ALIASES)]);
// Relative, bounded, no "..", backslash or control character.
// eslint-disable-next-line no-control-regex -- Deliberately reject control characters in a teacher-supplied path.
const filePathExpression = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000-\u001f\\]{1,512}$/u;

const TRAINING_GUIDE_CAPTION_LIMIT = 256;

function guideFailure(message) {
  return Object.assign(new Error(message), { code: "VIBE64_TRAINING_GUIDE_INVALID", statusCode: 422 });
}

// Normalize one teacher request. Throws a 422 for a request that cannot be honoured.
function trainingGuideRequest(input = {}) {
  const alias = TRAINING_GUIDE_ALIASES[input.target];
  const target = alias || input.target;
  const place = TRAINING_GUIDE_PLACES[target];
  if (!place) throw guideFailure("Use one of the declared Vibe64 guide places.");
  const navigate = input.navigate ?? Boolean(alias);
  const highlight = input.highlight ?? true;
  if (typeof navigate !== "boolean" || typeof highlight !== "boolean") throw guideFailure("navigate and highlight are booleans.");
  if (!navigate && !highlight) throw guideFailure("Point at the place (highlight) or open it (navigate); this request does neither.");
  if (navigate && target === "dashboard") {
    throw guideFailure("Dashboard has no single view to open. Point at it, or open one Dashboard section such as files or database-erd.");
  }
  if (navigate && place.pointOnly) throw guideFailure(`${place.steps.at(-1).label} has no view to open; point at it instead.`);
  const request = { target, navigate, highlight };
  if (input.filePath !== undefined) {
    if (target !== "files") throw guideFailure("filePath is only for the files place.");
    if (typeof input.filePath !== "string" || !filePathExpression.test(input.filePath)) {
      throw guideFailure("Use a relative practice project file path without '..'.");
    }
    request.filePath = input.filePath;
  }
  if (input.caption !== undefined) {
    if (typeof input.caption !== "string" || !input.caption.trim() || input.caption.length > TRAINING_GUIDE_CAPTION_LIMIT) {
      throw guideFailure(`Use a caption of 1 to ${TRAINING_GUIDE_CAPTION_LIMIT} characters.`);
    }
    request.caption = input.caption.trim();
  }
  return request;
}

function trainingGuideSteps(request) {
  const steps = TRAINING_GUIDE_PLACES[request.target].steps.map(value => ({ ...value }));
  if (request.filePath) steps.push({ id: "file", path: request.filePath, label: request.filePath });
  return steps;
}

// The browser command for one normalized request. A point-only command changes
// no view; its receipt carries only what the overlay actually drew. "Show me"
// opens the real place in the exact project/session, or the Learning
// environment (L) for the learning place.
function trainingGuideCommand(request, { id, projectSlug = "", sessionId = "" }) {
  const place = TRAINING_GUIDE_PLACES[request.target];
  const steps = trainingGuideSteps(request);
  const guide = { ...request, steps, caption: request.caption || steps.map(value => value.label).join(" → ") };
  if (!request.navigate) return { id, guide, status: "pending" };
  // Opening without a highlight is the ordinary navigation command.
  const highlighted = request.highlight ? { guide } : {};
  if (request.target === "learning") return { id, learning: { open: true }, ...highlighted, status: "pending" };
  return { id, projectSlug, sessionId, conversationId: "", pane: place.pane,
    ...(place.databaseView ? { databaseView: place.databaseView } : {}), ...highlighted, status: "pending" };
}

// The page activity a `do` beat can wait for (vibe64PageActivity reports only
// these). Beats name a place or one of these actions, never an event directly.
const TRAINING_BEAT_EVENTS = Object.freeze(["app-pressed", "message-sent", "agent-finished", "saved",
  "preview-reloaded", "file-opened", "colleague-opened"]);
// `do` targets that are an action rather than a place, with the place to point at.
const TRAINING_BEAT_ACTIONS = Object.freeze({
  "send-message": Object.freeze({ event: "message-sent", place: "chat" }),
  "agent-finished": Object.freeze({ event: "agent-finished" }),
  "file-opened": Object.freeze({ event: "file-opened", place: "files" }),
  "app-pressed": Object.freeze({ event: "app-pressed", place: "preview" })
});

// The single matcher for "the learner is at this place now", from a host's
// page focus (Colleague's focus shape; chatVisible: the coding chat is on
// screen). null: the place has no view to be at.
function trainingPlaceShown(target, focus = {}) {
  const place = TRAINING_GUIDE_PLACES[target];
  if (target === "chat") return focus.pane === "chat" || focus.chatVisible === true;
  if (target === "courses") return focus.learningOpen === true;
  if (!place?.pane) return null;
  return focus.pane === place.pane && (!place.databaseView || focus.databaseView === place.databaseView);
}

export { TRAINING_BEAT_ACTIONS, TRAINING_BEAT_EVENTS, TRAINING_GUIDE_CAPTION_LIMIT, TRAINING_GUIDE_PLACES, TRAINING_GUIDE_TARGETS,
  filePathExpression as TRAINING_GUIDE_FILE_PATH, trainingGuideCommand, trainingGuideRequest, trainingGuideSteps, trainingPlaceShown };
