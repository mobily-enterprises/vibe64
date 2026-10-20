import { computed, reactive, readonly, shallowRef } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { runTrainingGuideCommand } from "@local/vibe64-training/client/guide";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import { trainingGuideRequest, trainingGuideSteps, TRAINING_GUIDE_PLACES } from "@local/vibe64-training/shared/guide-targets";

// The Learning environment (L) above every signed-in page. One controller per
// host shell: it owns only what L displays (open/minimised, surface, the
// selected attempt and step, the read lesson and its results). Admission,
// progress, checks and practice projects stay with the Training actions; every
// change below is one of those actions, followed by a fresh lesson.read.
const TRAINING_PATH = "/api/vibe64/training";
const attemptPath = (attemptId, suffix = "") => `${TRAINING_PATH}/attempts/${encodeURIComponent(attemptId)}${suffix}`;
const practicePath = (practiceId = "", suffix = "") =>
  `${TRAINING_PATH}/practice${practiceId ? `/${encodeURIComponent(practiceId)}${suffix}` : ""}`;
// HTTP routes for the C3 actions (registerRoutes.js assembles their input).
const VIBE64_LEARNING_ROUTES = Object.freeze({
  lessonRead: attemptId => attemptPath(attemptId, "/lesson"),
  stepObserve: attemptId => attemptPath(attemptId, "/steps/observe"),
  stepCheck: attemptId => attemptPath(attemptId, "/steps/check"),
  stepAnswer: attemptId => attemptPath(attemptId, "/steps/answer"),
  stepDone: attemptId => attemptPath(attemptId, "/steps/done"),
  readerSave: attemptId => attemptPath(attemptId, "/reader"),
  lessonEnd: attemptId => attemptPath(attemptId, "/end"),
  visual: (attemptId, visualId) => attemptPath(attemptId, `/visuals/${encodeURIComponent(visualId)}`),
  // Learner notes (C7): the signed-in learner's own teacher notes.
  notes: `${TRAINING_PATH}/teacher-notes`,
  notesClear: `${TRAINING_PATH}/teacher-notes/clear`,
  // Learning mode: the learner's lesson in progress, derived from the active attempt.
  learningMode: `${TRAINING_PATH}/learning-mode`,
  learningModeLeave: attemptId => attemptPath(attemptId, "/learning-mode/leave"),
  // The learner's practice projects in the learning space (L's Practice tab).
  practice: practicePath(),
  practiceOpen: practiceId => practicePath(practiceId, "/open"),
  practiceArchive: practiceId => practicePath(practiceId, "/archive"),
  practiceDelete: practiceId => practicePath(practiceId, "/delete"),
  practiceArchiveDelete: (practiceId, archiveId) => practicePath(practiceId, `/archives/${encodeURIComponent(archiveId)}/delete`)
});
// The page for a lesson without a practice project (Lesson 0), and L outside a project.
const VIBE64_LEARNING_PAGE_PATH = "/app/learning";
// Shown after an other project's URL was redirected to the lesson's place.
const VIBE64_LEARNING_MODE_NOTE = "You're in a lesson. Leave lesson to get back to your projects.";
// The server's refusal of a project-scoped request outside the lesson.
const VIBE64_LEARNING_MODE_PROJECT_CODE = "vibe64_learning_mode_project";
const VIBE64_LEARNING_NOTES_MAX = 4000;
const SURFACES = Object.freeze(["courses", "practice", "lesson"]);
const STORAGE_PREFIX = "vibe64:learning-environment:v1:";
const READER_SAVE_DELAY_MS = 800;
// How long a file or Database guide waits for the navigated project view to publish itself.
const PROJECT_VIEW_WAIT_MS = 5000;
// Learner App presses whose observation is still being recorded.
const MAX_EXERCISE_OBSERVATIONS = 8;
// Teach me sends this exact text; the step itself travels in Colleague's focus.
const VIBE64_LEARNING_TEACH_MESSAGE = "Teach me this step.";

const text = value => typeof value === "string" && value.length > 0;

function storage() {
  try { return globalThis.window?.sessionStorage || null; } catch { return null; }
}

function readPlace(actorKey) {
  try {
    const value = JSON.parse(storage()?.getItem(`${STORAGE_PREFIX}${actorKey}`) || "null");
    if (!value || typeof value !== "object") return null;
    return { surface: SURFACES.includes(value.surface) ? value.surface : "courses",
      attemptId: text(value.attemptId) ? value.attemptId : "", stepId: text(value.stepId) ? value.stepId : "",
      scroll: Number.isSafeInteger(value.scroll) && value.scroll >= 0 ? value.scroll : 0 };
  } catch { return null; }
}

function writePlace(actorKey, place) {
  try { storage()?.setItem(`${STORAGE_PREFIX}${actorKey}`, JSON.stringify(place)); } catch { /* per-tab convenience only */ }
}

// A lesson.read result as L displays it.
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
    // Steps passed in any attempt of this same lesson content (they count toward completion).
    passedStepIds: Array.isArray(result.passedStepIds) ? result.passedStepIds.filter(text) : []
  });
}

// A learning-mode read as the client uses it; anything unreadable is "not in
// learning mode", so a failed read never locks the learner out of projects.
function normalizeLearningMode(result) {
  const mode = result?.ok === true && result.available !== false ? result.learningMode : null;
  if (!mode || typeof mode !== "object") return null;
  const practiceSlug = text(mode.practiceSlug) ? mode.practiceSlug : "";
  const projectSlugs = [...new Set([...(Array.isArray(mode.projectSlugs) ? mode.projectSlugs.filter(text) : []),
    ...(practiceSlug ? [practiceSlug] : [])])];
  return Object.freeze({ on: mode.on === true,
    attemptId: text(mode.attemptId) ? mode.attemptId : "", lessonCode: text(mode.lessonCode) ? mode.lessonCode : "",
    lessonTitle: text(mode.lessonTitle) ? mode.lessonTitle : "", practiceSlug, projectSlugs: Object.freeze(projectSlugs) });
}

// The redirect a project URL needs in learning mode (as normalizeLearningMode
// returns it, so projectSlugs already holds practiceSlug): null when allowed (or
// not in learning mode), else the lesson's practice project root, or the
// Learning page when the lesson has no practice project (Lesson 0).
function learningModeRedirect({ mode = null, slug = "" } = {}) {
  const projectSlug = String(slug || "").trim();
  if (!mode?.on || !projectSlug || mode.projectSlugs.includes(projectSlug)) return null;
  return Object.freeze({ slug: mode.practiceSlug, path: lessonPath(mode) });
}

// Where a lesson in progress lives: its practice project, else the Learning page.
function lessonPath(mode) {
  return mode?.practiceSlug ? projectAppPath(mode.practiceSlug) : VIBE64_LEARNING_PAGE_PATH;
}

// passed wins over any later not-yet-passed (a pass is final), including a pass
// kept from an earlier attempt of the same lesson content; otherwise the latest outcome.
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
  runGuide = null, now = () => Date.now() } = {}) {
  // hiddenBy: "learner" when the learner's own L or Escape hid L
  // (Colleague then returns a phone learner to its conversation), else "".
  // finished: the lesson surface shows the "Lesson finished" screen.
  const state = reactive({ open: false, minimised: false, surface: "courses", attemptId: "", stepId: "", scroll: 0,
    loading: false, error: "", actorKey: "", busy: "", hiddenBy: "", finished: false, notice: "", modeBusy: "" });
  const lesson = shallowRef(null);
  // Learning mode (server-backed, per learner): null until read or when unreadable.
  const learningMode = shallowRef(null);
  const colleagueRequest = shallowRef(null);
  // The teacher's notes about this learner, read when L shows them.
  const notes = shallowRef(null);
  const notesState = reactive({ loading: false, saving: false, error: "" });
  const pending = new Map();
  const exerciseObservations = new Set();
  // viewer fences everything of one signed-in person; reads fences lesson reads.
  let viewer = 0;
  let reads = 0;
  let modeReads = 0;
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

  const results = computed(() => lesson.value?.results || []);
  const steps = computed(() => lesson.value?.steps || []);
  const currentStep = computed(() => steps.value.find(step => step.id === state.stepId) || steps.value[0] || null);
  const focus = computed(() => ({ learningOpen: state.open, learningSurface: state.surface,
    ...(state.attemptId ? { learningAttemptId: state.attemptId } : {}),
    ...(state.attemptId && currentStep.value ? { learningStepId: currentStep.value.id } : {}) }));
  // The learner is in a lesson while the server says learning mode is on (an
  // attempt is in progress: not left, finished or ended), in every tab and device.
  const inLesson = computed(() => Boolean(state.actorKey && learningMode.value?.on));
  // Every required step of the read version 2 lesson is passed.
  const complete = computed(() => Boolean(lesson.value?.schemaVersion === 2 && steps.value.length &&
    steps.value.filter(step => step.required).every(step => stepStatus(results.value, step.id, lesson.value.passedStepIds) === "passed")));

  function remember() {
    if (!state.actorKey) return;
    writePlace(state.actorKey, { surface: state.surface, attemptId: state.attemptId, stepId: state.stepId, scroll: state.scroll });
  }

  // The signed-in viewer is supplied by the mounted overlay (hosted AuthGate
  // provides it below this controller). A different viewer sees nothing of the
  // previous person's place, lesson or pending requests.
  function setViewer(actorKey) {
    const next = String(actorKey || "");
    if (next === state.actorKey) return;
    viewer += 1;
    reads += 1;
    clearTimeout(saveTimer);
    pending.clear();
    exerciseObservations.clear();
    modeReads += 1;
    lesson.value = null;
    learningMode.value = null;
    colleagueRequest.value = null;
    notes.value = null;
    Object.assign(notesState, { loading: false, saving: false, error: "" });
    Object.assign(state, { open: false, minimised: false, surface: "courses", attemptId: "", stepId: "", scroll: 0,
      loading: false, error: "", busy: "", hiddenBy: "", finished: false, notice: "", modeBusy: "", actorKey: next });
    const place = next ? readPlace(next) : null;
    if (place) Object.assign(state, place);
    // A restored attempt is read at once, so Colleague's current-step button and
    // L's lesson tab are ready while L is hidden (learning mode is read separately).
    if (state.attemptId) void loadLesson();
    if (next) void readLearningMode();
  }

  // Reads the learner's learning mode; the latest read wins. A failed read
  // falls back to "not in learning mode".
  async function readLearningMode() {
    if (!state.actorKey) return null;
    const expected = ++modeReads;
    let value = null;
    try {
      value = normalizeLearningMode(await request(VIBE64_LEARNING_ROUTES.learningMode, { method: "GET" }));
    } catch { value = null; }
    if (expected !== modeReads) return learningMode.value;
    learningMode.value = value;
    return value;
  }

  // Leave lesson ends the attempt (its results and practice project are kept)
  // and with it learning mode; the mode is reread afterwards.
  async function leaveLesson() {
    const attemptId = learningMode.value?.attemptId || "";
    // Its own busy flag: a step check or answer in flight never delays leaving.
    if (!state.actorKey || !text(attemptId) || state.modeBusy) return null;
    const expected = viewer;
    state.modeBusy = "leave";
    state.error = "";
    try {
      const result = await request(VIBE64_LEARNING_ROUTES.learningModeLeave(attemptId), { method: "POST", body: {} });
      if (result?.ok !== true) throw new Error(result?.error || "Leaving the lesson was not confirmed. Try again.");
      if (expected !== viewer) return null;
      const value = normalizeLearningMode(result);
      if (value) { modeReads += 1; learningMode.value = value; }
      await readLearningMode();
      state.notice = "";
      if (state.attemptId === attemptId && lesson.value) void loadLesson(attemptId);
      return result;
    } catch (cause) {
      if (expected === viewer) state.error = String(cause?.message || "Leaving the lesson was not confirmed. Try again.");
      return null;
    } finally {
      if (state.modeBusy === "leave") state.modeBusy = "";
    }
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
      // The lesson ended elsewhere (another tab or device): learning mode ends with it.
      if (value.attempt?.ended && learningMode.value?.on && learningMode.value.attemptId === attemptId) void readLearningMode();
      // Restore the exact place: this tab's browser state first, then the
      // learner's saved reader position, then the first required step not yet
      // passed for this lesson content (a continued lesson resumes there). A
      // lesson with nothing passed yet starts at its first step.
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

  // Open L (or bring it back from minimised) on a surface, attempt and step.
  async function show({ surface, attemptId, stepId } = {}) {
    if (!state.actorKey) throw new Error("Sign in before opening Learning.");
    state.open = true;
    state.minimised = false;
    state.hiddenBy = "";
    state.finished = false;
    if (text(attemptId) && attemptId !== state.attemptId) {
      lesson.value = null;
      state.attemptId = attemptId;
      state.stepId = text(stepId) ? stepId : "";
      state.scroll = 0;
      lastSaved = "";
    } else if (text(stepId) && stepId !== state.stepId) {
      if (steps.value.length) selectStep(stepId);
      else state.stepId = stepId;
    }
    state.surface = SURFACES.includes(surface) ? surface : text(attemptId) ? "lesson" : state.surface;
    if (state.surface === "lesson" && !state.attemptId) state.surface = "courses";
    remember();
    if (state.surface === "lesson" && (!lesson.value || text(attemptId))) await loadLesson();
    return focus.value;
  }

  // Hide L with its state kept; the L button or Colleague brings it back.
  // by = "learner" only for the learner's own L or Escape; Show me, Teach me
  // and app navigation hide L to show something else.
  function minimise(by = "") {
    if (!state.open) return;
    state.hiddenBy = by === "learner" ? "learner" : "";
    state.open = false;
    state.minimised = true;
    flushReader();
  }

  // L is the one control that opens and hides Learning; hiding keeps the place.
  function toggle() {
    return state.open ? minimise("learner") : show();
  }

  // The "Lesson finished" screen of L's attempt, in L's lesson surface: shown
  // when this learner's own step action completes the lesson, and again from
  // the reader of a complete lesson. The screen ends the attempt (lesson.end,
  // reason finished).
  async function showFinished() {
    if (!state.attemptId) return null;
    await show({ surface: "lesson" });
    state.finished = Boolean(complete.value);
    return focus.value;
  }

  // The finished screen's "Read the lesson again" returns to the steps.
  function closeFinished() {
    state.finished = false;
  }

  // A learner's own step result that completes the lesson opens L on its
  // finished screen (Colleague's step dialog gives way to it).
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
  // answers. Only L's current step of its open, prepared, not-ended version 2
  // attempt whose practice project is projectSlug, while L does not cover the
  // app, and only when that step declares an automatic response check (code
  // checks always name files). The server's step owner decides everything else.
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

  // After a reload L remembers its attempt but has not read it yet; a practice
  // App announcing itself reads it so the learner's next press can count.
  function prepareExercise(projectSlug) {
    if (!text(projectSlug) || !state.actorKey || !state.attemptId || lesson.value || state.loading) return null;
    return loadLesson(state.attemptId);
  }

  const runCheck = stepId => stepAction("check", VIBE64_LEARNING_ROUTES.stepCheck, stepId);
  const answer = (stepId, selected) => stepAction("answer", VIBE64_LEARNING_ROUTES.stepAnswer, stepId,
    { selected: [...selected].map(Number).sort((left, right) => left - right) });
  const done = stepId => stepAction("done", VIBE64_LEARNING_ROUTES.stepDone, stepId);

  // Show me: minimise L, then point at (and, when declared, open) the real place.
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

  // Teach me: minimise L and ask this host's Colleague, which opens and sends
  // the fixed message (watchColleagueLearningRequests in vibe64-colleague).
  function teachMe(stepId = currentStep.value?.id) {
    if (!state.attemptId || !stepId) throw new Error("Open a lesson step before asking Colleague to teach it.");
    selectStep(stepId);
    minimise();
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

  // Finishing a complete lesson ends its attempt (lesson.end, reason finished);
  // every result and the practice project are kept.
  async function finishLesson({ expectedRevision } = {}) {
    if (!state.attemptId || state.busy) return null;
    const attemptId = state.attemptId;
    const key = JSON.stringify([attemptId, "end"]);
    const requestId = pendingRequestId(key);
    state.busy = "end";
    state.error = "";
    try {
      const result = await request(VIBE64_LEARNING_ROUTES.lessonEnd(attemptId), { method: "POST",
        body: { requestId, expectedRevision, reason: "finished" } });
      if (result?.ok !== true) throw new Error(result?.error || "Finishing the lesson was not confirmed. Retry the same request.");
      pending.delete(key);
      // Finishing the lesson ends learning mode.
      await Promise.all([loadLesson(attemptId), readLearningMode()]);
      return result;
    } catch (cause) {
      state.error = String(cause?.message || "Finishing the lesson was not confirmed.");
      return null;
    } finally {
      if (state.busy === "end") state.busy = "";
    }
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

  // Realtime: a learner change for the displayed attempt rereads it; a notes
  // change rereads the notes when L has shown them.
  // Every other learner change (start, continue, finish, leave, practice)
  // also rereads learning mode, which is cheap.
  function learnerChanged(payload = {}) {
    if (payload.reason === "notes") return notes.value ? readNotes() : null;
    if (state.actorKey) void readLearningMode();
    if (state.attemptId && (!payload.attemptId || payload.attemptId === state.attemptId) && lesson.value) {
      return loadLesson(state.attemptId);
    }
    return null;
  }

  return Object.freeze({
    state: readonly(state),
    get open() { return state.open; },
    get minimised() { return state.minimised; },
    get hiddenBy() { return state.hiddenBy; },
    get surface() { return state.surface; },
    get attemptId() { return state.attemptId; },
    get stepId() { return currentStep.value?.id || ""; },
    get scroll() { return state.scroll; },
    get inLesson() { return inLesson.value; },
    get complete() { return complete.value; },
    get finished() { return state.finished; },
    get learningMode() { return learningMode.value; },
    get lessonTitle() { return learningMode.value?.on ? learningMode.value.lessonTitle || learningMode.value.lessonCode || "" : ""; },
    get notice() { return state.notice; },
    lesson, results, steps, currentStep, focus, colleagueRequest, notes, notesState: readonly(notesState),
    stepStatus: stepId => stepStatus(results.value, stepId, lesson.value?.passedStepIds || []),
    setViewer, show, showFinished, closeFinished, minimise, toggle, selectStep, setScroll, flushReader, loadLesson,
    runCheck, answer, done, showMe, teachMe, consumeColleagueRequest, finishLesson, learnerChanged,
    exerciseStep, beginExercise, exerciseCurrent, finishExercise, prepareExercise,
    readNotes, saveNotes, clearNotes,
    readLearningMode, leaveLesson, showNotice, clearNotice
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

export { VIBE64_LEARNING_MODE_NOTE, VIBE64_LEARNING_MODE_PROJECT_CODE, VIBE64_LEARNING_NOTES_MAX, VIBE64_LEARNING_PAGE_PATH, VIBE64_LEARNING_ROUTES, VIBE64_LEARNING_TEACH_MESSAGE, createVibe64Learning, learningModeRedirect, lessonPath, normalizeLearningMode, openLessonLink, revealCurrentStep, showMeCommand, stepStatus };
