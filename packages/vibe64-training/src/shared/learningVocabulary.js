import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// The learning vocabulary: the real Vibe64 places a lesson or its teacher can
// point at or open, the activities a lesson `do` beat can wait for, and the
// names of the facts a `fact` check can read. Public Training owns its
// built-in half; a host adds its own places, activities and facts by
// composition (registerLearningVocabulary, on its server and in its browser),
// never by editing this list. Lessons never supply selectors: each place names
// the `data-vibe64-guide` ids of the controls on its path, and the overlay
// rings the deepest one visible.
//
// place = { id, label, scope, open, steps, shown?, event?, who? }
//   scope   "project": exists only in a practice project; "studio": the
//           screens outside any project (shown in both Learn and Develop).
//   open    { pane, databaseView? } a project view; { route } a studio page;
//           { learning: true } Courses; null: point only.
//   steps   [{ id, label }]: the controls on the way, the place itself last.
//   shown   page-focus matchers, any of which means "the learner is at this
//           place now" (route matches by prefix); derived from open when absent.
//   event   the page activity that completes `do <place>`.
//   who     "everyone" (default) or "owner": who this place is open to.
// activity = { id, event, place? }: a `do` target that is something done
//   rather than a place; event is the page activity reported, place the one
//   to point at.
// fact = id: a server fact reader of that name exists (learningFacts.js).
const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const SCOPES = new Set(["studio", "project"]);
const WHO = new Set(["everyone", "owner"]);
const pathStep = (id, label) => Object.freeze({ id, label });
const PREVIEW = pathStep("preview", "Preview");
const DASHBOARD = pathStep("dashboard", "Dashboard");
const DATABASE = pathStep("database", "Database");
const ACCOUNT_MENU = pathStep("account-menu", "Account menu");

const BUILT_IN_PLACES = [
  { id: "preview", label: "Preview", scope: "project", open: { pane: "preview" }, steps: [PREVIEW] },
  // Dashboard has no single view to open: open one of its sections instead.
  { id: "dashboard", label: "Dashboard", scope: "project", open: null, steps: [DASHBOARD] },
  {
    id: "database-erd",
    label: "ERD",
    scope: "project",
    open: { pane: "database", databaseView: "erd" },
    steps: [DASHBOARD, DATABASE, pathStep("database-erd", "ERD")]
  },
  {
    id: "database-data",
    label: "Data",
    scope: "project",
    open: { pane: "database", databaseView: "data" },
    steps: [DASHBOARD, DATABASE, pathStep("database-data", "Data")]
  },
  { id: "files", label: "Files", scope: "project", open: { pane: "files" }, steps: [DASHBOARD, pathStep("files", "Files")] },
  {
    id: "changes",
    label: "Current changes",
    scope: "project",
    open: { pane: "changes" },
    steps: [DASHBOARD, pathStep("changes", "Current changes")]
  },
  { id: "git-log", label: "Git log", scope: "project", open: { pane: "repository" }, steps: [DASHBOARD, pathStep("git-log", "Git log")] },
  {
    id: "session-info",
    label: "Session info",
    scope: "project",
    open: { pane: "session" },
    steps: [DASHBOARD, pathStep("session-info", "Session info")]
  },
  {
    id: "architecture",
    label: "Architecture",
    scope: "project",
    open: { pane: "system" },
    steps: [DASHBOARD, pathStep("architecture", "Architecture")]
  },
  { id: "publish", label: "Publish", scope: "project", open: { pane: "publish" }, steps: [DASHBOARD, pathStep("publish", "Publish")] },
  {
    id: "chat",
    label: "Coding chat",
    scope: "project",
    open: null,
    shown: [{ pane: "chat" }, { chatVisible: true }],
    steps: [pathStep("chat", "Coding chat")]
  },
  { id: "save", label: "Save", scope: "project", open: null, event: "saved", steps: [pathStep("save", "Save")] },
  {
    id: "reload-preview",
    label: "Reload preview",
    scope: "project",
    open: null,
    event: "preview-reloaded",
    steps: [PREVIEW, pathStep("reload-preview", "Reload preview")]
  },
  // The L button that switches between Develop and Learn (opening it opens Courses).
  {
    id: "learning",
    label: "Learning",
    scope: "studio",
    open: { learning: true },
    shown: [],
    event: "learn-toggled",
    steps: [pathStep("learning", "Learning")]
  },
  { id: "lesson", label: "Lesson", scope: "studio", open: null, shown: [{ pane: "lesson" }], steps: [pathStep("lesson", "Lesson")] },
  { id: "lesson-bar", label: "Lesson step bar", scope: "studio", open: null, steps: [pathStep("lesson-bar", "Lesson step bar")] },
  {
    id: "courses",
    label: "Courses",
    scope: "studio",
    open: null,
    shown: [{ learningOpen: true }],
    steps: [pathStep("courses", "Courses")]
  },
  {
    id: "colleague",
    label: "Colleague",
    scope: "studio",
    open: null,
    event: "colleague-opened",
    steps: [pathStep("colleague", "Colleague")]
  },
  { id: "account-menu", label: "Account menu", scope: "studio", open: null, steps: [ACCOUNT_MENU] },
  {
    id: "account-settings",
    label: "Account settings",
    scope: "studio",
    open: null,
    steps: [ACCOUNT_MENU, pathStep("account-settings", "Account settings")]
  },
  { id: "ai-setup", label: "AI setup", scope: "studio", open: null, steps: [ACCOUNT_MENU, pathStep("ai-setup", "AI setup")] }
];
const BUILT_IN_ACTIVITIES = [
  { id: "send-message", event: "message-sent", place: "chat" },
  { id: "agent-finished", event: "agent-finished" },
  { id: "file-opened", event: "file-opened", place: "files" },
  { id: "app-pressed", event: "app-pressed", place: "preview" },
  { id: "colleague-minimised", event: "colleague-minimised", place: "colleague" }
];
// Fact readers public Training registers on the server.
const BUILT_IN_FACTS = ["ai-ready"];

function vocabularyFailure(message) {
  return Object.assign(new Error(message), { code: "VIBE64_TRAINING_VOCABULARY_INVALID" });
}

const label = value => typeof value === "string" && value.trim().length > 0 && value.length <= 64;

function definePlace(value) {
  if (!isRecord(value) || !ID.test(value.id || "")) throw vocabularyFailure("A place needs a lowercase id.");
  const name = `Place ${value.id}`;
  if (!label(value.label)) throw vocabularyFailure(`${name} needs a label.`);
  if (!SCOPES.has(value.scope)) throw vocabularyFailure(`${name} scope is studio or project.`);
  const who = value.who ?? "everyone";
  if (!WHO.has(who)) throw vocabularyFailure(`${name} who is everyone or owner.`);
  const open = value.open ?? null;
  if (open !== null) {
    const keys = Object.keys(open || {}).sort().join(",");
    const valid = keys === "pane" || keys === "databaseView,pane" ? value.scope === "project" && ID.test(open.pane)
      : keys === "route" ? value.scope === "studio" && typeof open.route === "string" && /^\/app(?:\/[a-z0-9-]+)*$/u.test(open.route)
        : keys === "learning" && open.learning === true;
    if (!valid) throw vocabularyFailure(`${name} opens a project pane, a studio /app route, Courses, or nothing.`);
  }
  if (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > 6 ||
      value.steps.some(item => !ID.test(item?.id || "") || !label(item.label)) || value.steps.at(-1).id !== value.id) {
    throw vocabularyFailure(`${name} needs 1 to 6 labelled steps ending with itself.`);
  }
  const shown = value.shown ?? (open?.pane ? [{ pane: open.pane, ...(open.databaseView ? { databaseView: open.databaseView } : {}) }]
    : open?.route ? [{ route: open.route }] : []);
  if (!Array.isArray(shown) || shown.some(item => !isRecord(item) || !Object.keys(item).length)) {
    throw vocabularyFailure(`${name} shown is a list of page focus matchers.`);
  }
  if (value.event !== undefined && !ID.test(value.event)) throw vocabularyFailure(`${name} event is a lowercase activity name.`);
  return Object.freeze({
    id: value.id,
    label: value.label,
    scope: value.scope,
    who,
    open: open && Object.freeze({ ...open }),
    steps: Object.freeze(value.steps.map(item => pathStep(item.id, item.label))),
    shown: Object.freeze(shown.map(item => Object.freeze({ ...item }))),
    ...(value.event ? { event: value.event } : {})
  });
}

function defineActivity(value) {
  if (!isRecord(value) || !ID.test(value.id || "")) throw vocabularyFailure("An activity needs a lowercase id.");
  if (!ID.test(value.event || "")) throw vocabularyFailure(`Activity ${value.id} needs its page activity event.`);
  if (value.place !== undefined && !ID.test(value.place)) throw vocabularyFailure(`Activity ${value.id} place is a place id.`);
  return Object.freeze({
    id: value.id,
    event: value.event,
    ...(value.place ? { place: value.place } : {})
  });
}

/**
 * An installation's vocabulary declares no names of its own.
 */
function declaresNothing() {
  return false;
}

/**
 * One vocabulary: the built-ins plus what a host registers. The same names
 * are registered identically on a host's server and in its browser; a name
 * registered twice must mean the same thing. Only a topic's bundler
 * vocabulary declares names: here declared, declaredPlace and
 * declaredActivity answer false.
 */
function createLearningVocabulary({
  places: initialPlaces = BUILT_IN_PLACES,
  activities: initialActivities = BUILT_IN_ACTIVITIES,
  facts: initialFacts = BUILT_IN_FACTS
} = {}) {
  const placeMap = new Map();
  const activityMap = new Map();
  const factSet = new Set();
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  function register({ places: newPlaces = [], activities: newActivities = [], facts: newFacts = [] } = {}) {
    const placed = newPlaces.map(definePlace);
    const acted = newActivities.map(defineActivity);
    for (const value of [...placed, ...acted]) {
      if (placeMap.has(value.id) && !same(placeMap.get(value.id), value) ||
          activityMap.has(value.id) && !same(activityMap.get(value.id), value) ||
          placed.includes(value) && activityMap.has(value.id) || acted.includes(value) && placeMap.has(value.id)) {
        throw vocabularyFailure(`${value.id} is already registered with another meaning.`);
      }
    }
    for (const fact of newFacts) if (!ID.test(fact || "")) throw vocabularyFailure("A fact needs a lowercase id.");
    for (const value of placed) placeMap.set(value.id, value);
    for (const value of acted) activityMap.set(value.id, value);
    for (const fact of newFacts) factSet.add(fact);
  }
  register({ places: initialPlaces, activities: initialActivities, facts: initialFacts });

  function place(id) {
    return placeMap.get(id) || null;
  }

  function activity(id) {
    return activityMap.get(id) || null;
  }

  function hasFact(id) {
    return factSet.has(id);
  }

  function places() {
    return [...placeMap.values()];
  }

  /**
   * Every page activity a view may report: activity events and place events.
   */
  function events() {
    return new Set([...[...activityMap.values()].map(value => value.event),
      ...[...placeMap.values()].filter(value => value.event).map(value => value.event)]);
  }

  return Object.freeze({
    register,
    place,
    activity,
    hasFact,
    places,
    events,
    declared: declaresNothing,
    declaredPlace: declaresNothing,
    declaredActivity: declaresNothing
  });
}

// This installation's vocabulary (one per server process and per browser).
// Its facts are those whose server reader is registered (learningFacts.js).
const learningVocabulary = createLearningVocabulary({ facts: [] });
const registerLearningVocabulary = value => learningVocabulary.register(value);

/**
 * The bundler's vocabulary for one topic: the built-ins, plus the names the
 * topic declares (`places`, `activities`, `facts`), accepted by name only and
 * checked against a host's registry by that host's own drift test.
 */
function declaredLearningVocabulary({ places = [], activities = [], facts = [] } = {}) {
  const vocabulary = createLearningVocabulary();
  const known = new Set(vocabulary.places().map(value => value.id));
  for (const id of [...places, ...activities, ...facts]) {
    if (!ID.test(id || "")) {
      throw vocabularyFailure(`Declared name ${id} is not a lowercase id.`);
    }
  }
  const declaredPlaces = new Set(places.filter(id => !known.has(id)));
  const declaredActivities = new Set(activities.filter(id => !vocabulary.activity(id)));

  function declaredPlace(id) {
    return declaredPlaces.has(id);
  }

  function declaredActivity(id) {
    return declaredActivities.has(id);
  }

  function declared(id) {
    return declaredPlace(id) || declaredActivity(id);
  }

  function hasFact(id) {
    return vocabulary.hasFact(id) || facts.includes(id);
  }

  return Object.freeze({
    register: vocabulary.register,
    place: vocabulary.place,
    activity: vocabulary.activity,
    hasFact,
    places: vocabulary.places,
    events: vocabulary.events,
    declared,
    declaredPlace,
    declaredActivity
  });
}

// Relative, bounded, no "..", backslash or control character.
// eslint-disable-next-line no-control-regex -- Deliberately reject control characters in a teacher-supplied path.
const filePathExpression = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000-\u001f\\]{1,512}$/u;

const TRAINING_GUIDE_CAPTION_LIMIT = 256;

/**
 * A guide request this installation cannot honour: a 422 refusal with its own code.
 * @param {string} message
 * @param {string} code
 * @param {object} [params]
 */
function guideFailure(message, code, params) {
  return new AppError(422, message, { code, params });
}

const placeOpens = place => Boolean(place?.open);

/**
 * Normalize one guide request (a teacher's navigation.guide, a lesson step's
 * guide). Throws a 422 for a request that cannot be honoured. navigate opens
 * the place first; highlight rings it (both default to: point only).
 */
function trainingGuideRequest(input = {}, vocabulary = learningVocabulary) {
  const place = typeof input.target === "string" ? vocabulary.place(input.target) : null;
  const declared = !place && vocabulary.declaredPlace(input.target);
  if (!place && !declared) {
    const places = vocabulary.places().map(value => value.id).join(", ");
    throw guideFailure(`Use one of this installation's guide places: ${places}.`, "VIBE64_TRAINING_GUIDE_INVALID", { places });
  }
  const target = input.target;
  const navigate = input.navigate ?? false;
  const highlight = input.highlight ?? true;
  if (typeof navigate !== "boolean" || typeof highlight !== "boolean") {
    throw guideFailure("navigate and highlight are booleans.", "VIBE64_TRAINING_GUIDE_FLAGS_INVALID");
  }
  if (!navigate && !highlight) {
    throw guideFailure(
      "Point at the place (highlight) or open it (navigate); this request does neither.",
      "VIBE64_TRAINING_GUIDE_ACTION_MISSING"
    );
  }
  if (navigate && target === "dashboard") {
    throw guideFailure(
      "Dashboard has no single view to open. Point at it, or open one Dashboard section such as files or database-erd.",
      "VIBE64_TRAINING_GUIDE_DASHBOARD_UNOPENABLE"
    );
  }
  if (navigate && place && !placeOpens(place)) {
    throw guideFailure(`${place.label} has no view to open; point at it instead.`, "VIBE64_TRAINING_GUIDE_PLACE_UNOPENABLE", {
      place: place.label
    });
  }
  const request = { target, navigate, highlight };
  if (input.filePath !== undefined) {
    if (target !== "files") throw guideFailure("filePath is only for the files place.", "VIBE64_TRAINING_GUIDE_FILE_PATH_MISPLACED");
    if (typeof input.filePath !== "string" || !filePathExpression.test(input.filePath)) {
      throw guideFailure("Use a relative practice project file path without '..'.", "VIBE64_TRAINING_GUIDE_FILE_PATH_INVALID");
    }
    request.filePath = input.filePath;
  }
  if (input.caption !== undefined) {
    if (typeof input.caption !== "string" || !input.caption.trim() || input.caption.length > TRAINING_GUIDE_CAPTION_LIMIT) {
      throw guideFailure(`Use a caption of 1 to ${TRAINING_GUIDE_CAPTION_LIMIT} characters.`, "VIBE64_TRAINING_GUIDE_CAPTION_INVALID", {
        limit: TRAINING_GUIDE_CAPTION_LIMIT
      });
    }
    request.caption = input.caption.trim();
  }
  return request;
}

function trainingGuideSteps(request, vocabulary = learningVocabulary) {
  const steps = vocabulary.place(request.target).steps.map(value => ({ ...value }));
  if (request.filePath) steps.push({ id: "file", path: request.filePath, label: request.filePath });
  return steps;
}

/**
 * The browser command for one normalized request. A point-only command changes
 * no view; its receipt carries only what the overlay actually drew. Opening
 * shows the real place: a project view in the exact project/session, a studio
 * page by its route, or Courses for the learning place.
 */
function trainingGuideCommand(request, { id, projectSlug = "", sessionId = "" }, vocabulary = learningVocabulary) {
  const place = vocabulary.place(request.target);
  const steps = trainingGuideSteps(request, vocabulary);
  const guide = { ...request, steps, caption: request.caption || steps.map(value => value.label).join(" → ") };
  if (!request.navigate) return { id, guide, status: "pending" };
  // Opening without a highlight is the ordinary navigation command.
  const highlighted = request.highlight ? { guide } : {};
  if (place.open.learning) return { id, learning: { open: true }, ...highlighted, status: "pending" };
  if (place.open.route) return { id, route: place.open.route, ...highlighted, status: "pending" };
  return {
    id,
    projectSlug,
    sessionId,
    conversationId: "",
    pane: place.open.pane,
    ...(place.open.databaseView ? { databaseView: place.open.databaseView } : {}),
    ...highlighted,
    status: "pending"
  };
}

/**
 * The single matcher for "the learner is at this place now", from a host's
 * page focus (Colleague's focus shape; chatVisible: the coding chat is on
 * screen; learningOpen: Courses is open). null: the place has no view to be at.
 */
function trainingPlaceShown(target, focus = {}, vocabulary = learningVocabulary) {
  const place = vocabulary.place(target);
  if (!place?.shown.length) return null;
  return place.shown.some(matcher => Object.entries(matcher).every(([key, value]) => key === "route"
    ? typeof focus.route === "string" && (focus.route === value || focus.route.startsWith(`${value}/`))
    : focus[key] === value));
}

/**
 * Whether this person may see a place: owner places only for the workspace owner.
 */
function learningPlaceOpenTo(place, viewer = {}) {
  return place.who !== "owner" || viewer.owner === true;
}

/**
 * The vocabulary one lesson step names: the places, activities and facts of
 * its beats, guide and check. step is an installed reader step (beats parsed).
 */
function lessonStepNeeds(step, vocabulary = learningVocabulary) {
  const places = new Set();
  const activities = new Set();
  const facts = new Set();
  for (const beat of Array.isArray(step?.beats) ? step.beats : []) {
    if (beat.kind === "check") continue;
    const activity = vocabulary.activity(beat.target);
    if (activity || vocabulary.declaredActivity(beat.target)) {
      activities.add(beat.target);
      if (activity?.place) places.add(activity.place);
    } else {
      places.add(beat.target);
    }
  }
  if (step?.guide?.target) places.add(step.guide.target);
  if (step?.check?.kind === "fact") facts.add(step.check.fact);
  return { places: [...places], activities: [...activities], facts: [...facts] };
}

/**
 * The availability rule: a step is available here when every place, activity
 * and fact it names is registered by this installation and its places are
 * open to this viewer ({ owner }). Unavailable steps are simply absent.
 */
function lessonStepAvailable(step, { vocabulary = learningVocabulary, viewer = {} } = {}) {
  const needs = lessonStepNeeds(step, vocabulary);
  return needs.places.every(id => {
    const place = vocabulary.place(id);
    return Boolean(place) && learningPlaceOpenTo(place, viewer);
  }) && needs.activities.every(id => Boolean(vocabulary.activity(id))) && needs.facts.every(id => vocabulary.hasFact(id));
}

/**
 * A lesson is available when all its required steps are.
 */
function lessonAvailable(steps, options) {
  return steps.every(step => !step.required || lessonStepAvailable(step, options));
}

const __testables = Object.freeze({ createLearningVocabulary, lessonStepNeeds });

export {
  TRAINING_GUIDE_CAPTION_LIMIT,
  declaredLearningVocabulary,
  filePathExpression as TRAINING_GUIDE_FILE_PATH,
  learningPlaceOpenTo,
  learningVocabulary,
  lessonAvailable,
  lessonStepAvailable,
  registerLearningVocabulary,
  trainingGuideCommand,
  trainingGuideRequest,
  trainingGuideSteps,
  trainingPlaceShown,
  __testables
};
