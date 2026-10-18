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
  dashboard: Object.freeze({ steps: [DASHBOARD] }),
  "database-erd": Object.freeze({ pane: "database", databaseView: "erd", steps: [DASHBOARD, DATABASE, step("database-erd", "ERD")] }),
  "database-data": Object.freeze({ pane: "database", databaseView: "data", steps: [DASHBOARD, DATABASE, step("database-data", "Data")] }),
  files: Object.freeze({ pane: "files", steps: [DASHBOARD, step("files", "Files")] }),
  changes: Object.freeze({ pane: "changes", steps: [DASHBOARD, step("changes", "Current changes")] }),
  "git-log": Object.freeze({ pane: "repository", steps: [DASHBOARD, step("git-log", "Git log")] }),
  "session-info": Object.freeze({ pane: "session", steps: [DASHBOARD, step("session-info", "Session info")] }),
  architecture: Object.freeze({ pane: "system", steps: [DASHBOARD, step("architecture", "Architecture")] }),
  learning: Object.freeze({ steps: [step("learning", "Learning")] })
});
// Earlier teacher targets keep their original "open the view" meaning.
const TRAINING_GUIDE_ALIASES = Object.freeze({ "workspace-preview": "preview", "workspace-erd": "database-erd" });
const TRAINING_GUIDE_TARGETS = Object.freeze([...Object.keys(TRAINING_GUIDE_PLACES), ...Object.keys(TRAINING_GUIDE_ALIASES)]);
// Relative, bounded, no "..", backslash or control character.
// eslint-disable-next-line no-control-regex -- Deliberately reject control characters in a teacher-supplied path.
const filePathExpression = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000-\u001f\\]{1,512}$/u;

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
  const request = { target, navigate, highlight };
  if (input.filePath !== undefined) {
    if (target !== "files") throw guideFailure("filePath is only for the files place.");
    if (typeof input.filePath !== "string" || !filePathExpression.test(input.filePath)) {
      throw guideFailure("Use a relative practice project file path without '..'.");
    }
    request.filePath = input.filePath;
  }
  return request;
}

function trainingGuideSteps(request) {
  const steps = TRAINING_GUIDE_PLACES[request.target].steps.map(value => ({ ...value }));
  if (request.filePath) steps.push({ id: "file", path: request.filePath, label: request.filePath });
  return steps;
}

// The browser command for one normalized request. A point-only command
// changes no view; its receipt carries only what the overlay actually drew.
function trainingGuideCommand(request, { id, projectSlug, sessionId, attemptId }) {
  const place = TRAINING_GUIDE_PLACES[request.target];
  const steps = trainingGuideSteps(request);
  const guide = { ...request, steps, caption: steps.map(value => value.label).join(" → ") };
  if (!request.navigate) return { id, guide, learningAttemptId: attemptId, status: "pending" };
  const learning = request.target === "learning";
  return { id, projectSlug, sessionId, conversationId: "", pane: learning ? "preview" : place.pane,
    ...(place.databaseView ? { databaseView: place.databaseView } : {}),
    learningMode: true, learningView: learning ? "learning" : "workspace",
    ...(learning ? { learningContent: "active" } : {}), learningAttemptId: attemptId,
    // Opening without a highlight is the ordinary navigation command.
    ...(request.highlight ? { guide } : {}), status: "pending" };
}

export { TRAINING_GUIDE_ALIASES, TRAINING_GUIDE_PLACES, TRAINING_GUIDE_TARGETS,
  trainingGuideCommand, trainingGuideRequest, trainingGuideSteps };
