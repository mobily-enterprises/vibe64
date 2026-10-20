import { computed, reactive, readonly, shallowRef } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { runTrainingGuideCommand } from "@local/vibe64-training/client/guide";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { trainingGuideRequest, trainingGuideSteps, TRAINING_GUIDE_PLACES } from "@local/vibe64-training/shared/guide-targets";

// The Learning environment (L) above every signed-in page. One controller per
// host shell: it owns only what L displays (open/minimised, surface, the
// selected attempt and step, the read lesson and its results). Admission,
// progress, checks and practice projects stay with the Training actions; every
// change below is one of those actions, followed by a fresh lesson.read.
const TRAINING_PATH = "/api/vibe64/training";
const attemptPath = (attemptId, suffix = "") => `${TRAINING_PATH}/attempts/${encodeURIComponent(attemptId)}${suffix}`;
// HTTP routes for the C3 actions (registerRoutes.js assembles their input).
const VIBE64_LEARNING_ROUTES = Object.freeze({
  lessonRead: attemptId => attemptPath(attemptId, "/lesson"),
  stepCheck: attemptId => attemptPath(attemptId, "/steps/check"),
  stepAnswer: attemptId => attemptPath(attemptId, "/steps/answer"),
  stepDone: attemptId => attemptPath(attemptId, "/steps/done"),
  readerSave: attemptId => attemptPath(attemptId, "/reader"),
  lessonEnd: attemptId => attemptPath(attemptId, "/end"),
  visual: (attemptId, visualId) => attemptPath(attemptId, `/visuals/${encodeURIComponent(visualId)}`)
});
const SURFACES = Object.freeze(["courses", "lesson"]);
const STORAGE_PREFIX = "vibe64:learning-environment:v1:";
const READER_SAVE_DELAY_MS = 800;
// How long a file guide waits for the navigated project view to publish itself.
const PROJECT_VIEW_WAIT_MS = 5000;
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

// A v2 lesson.read result, tolerating the lesson either nested or at top level.
function normalizeLesson(result) {
  if (!result || result.ok === false || result.available === false) return null;
  const lesson = result.lesson && typeof result.lesson === "object" ? result.lesson : result;
  const steps = Array.isArray(lesson.steps) ? lesson.steps.filter(step => text(step?.id)) : [];
  const attempt = result.attempt || lesson.attempt || null;
  return Object.freeze({
    schemaVersion: lesson.schemaVersion ?? (steps.length ? 2 : 1),
    code: lesson.code || attempt?.pin?.lesson?.code || "",
    title: lesson.title || "",
    notesText: text(lesson.notesText) ? lesson.notesText : "",
    visuals: Array.isArray(lesson.visuals) ? lesson.visuals : [],
    steps,
    attempt,
    practiceProjectSlug: attempt?.practiceSlug || attempt?.practice?.projectSlug || attempt?.practice?.slug || attempt?.practiceProjectSlug || "",
    reader: result.reader && text(result.reader.stepId) ? result.reader : null,
    results: Array.isArray(result.results) ? result.results : Array.isArray(lesson.results) ? lesson.results : []
  });
}

// passed wins over any later not-yet-passed (a pass is final); otherwise the latest outcome.
function stepStatus(results, stepId) {
  const own = results.filter(result => result?.stepId === stepId);
  if (own.some(result => result.outcome === "passed")) return "passed";
  return own.length ? own.at(-1).outcome || "not-yet-passed" : "not-started";
}

// The browser guide command for one step's declared guide. A step without a
// practice project (or a guide at the L button) only points.
function showMeCommand(guide, { projectSlug = "" } = {}) {
  const request = trainingGuideRequest({ target: guide?.target,
    ...(guide?.navigate !== undefined ? { navigate: guide.navigate } : {}),
    ...(guide?.filePath !== undefined ? { filePath: guide.filePath } : {}) });
  const steps = trainingGuideSteps(request);
  const caption = text(guide?.caption) ? guide.caption.slice(0, 256) : steps.map(value => value.label).join(" → ");
  const navigate = request.navigate && request.target !== "learning" && Boolean(projectSlug);
  const command = { guide: { ...request, navigate, highlight: true, steps, caption } };
  if (!navigate) return command;
  const place = TRAINING_GUIDE_PLACES[request.target];
  return { ...command, projectSlug, ...(place.pane ? { pane: place.pane } : {}),
    ...(place.databaseView ? { databaseView: place.databaseView } : {}) };
}

function createVibe64Learning({ request: requestOverride = null, browserNavigation = null, colleagueView = null,
  runGuide = null, now = () => Date.now() } = {}) {
  const state = reactive({ open: false, minimised: false, surface: "courses", attemptId: "", stepId: "", scroll: 0,
    loading: false, error: "", actorKey: "", busy: "" });
  const lesson = shallowRef(null);
  const colleagueRequest = shallowRef(null);
  const pending = new Map();
  // viewer fences everything of one signed-in person; reads fences lesson reads.
  let viewer = 0;
  let reads = 0;
  let saveTimer = null;
  let lastSaved = "";

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
    lesson.value = null;
    colleagueRequest.value = null;
    Object.assign(state, { open: false, minimised: false, surface: "courses", attemptId: "", stepId: "", scroll: 0,
      loading: false, error: "", busy: "", actorKey: next });
    const place = next ? readPlace(next) : null;
    if (place) Object.assign(state, place);
  }

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
      // Restore the exact place: this tab's browser state first, then the
      // learner's saved reader position, then the first step.
      const known = id => value.steps.some(step => step.id === id);
      if (!known(state.stepId)) {
        const saved = value.reader?.attemptId === undefined || value.reader?.attemptId === attemptId ? value.reader : null;
        state.stepId = saved && known(saved.stepId) ? saved.stepId : value.steps[0]?.id || "";
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
  function minimise() {
    if (!state.open) return;
    state.open = false;
    state.minimised = true;
    flushReader();
  }

  function close() {
    state.open = false;
    state.minimised = false;
    flushReader();
  }

  function toggle() {
    return state.open ? close() : show();
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

  // One step action. A retry of the same input keeps its request ID until a
  // confirmed result arrives; the verdict is then reread from lesson.read.
  async function stepAction(kind, route, stepId, extra = {}) {
    if (!state.attemptId || state.busy) return null;
    const attemptId = state.attemptId;
    const key = JSON.stringify([attemptId, kind, stepId, extra]);
    const requestId = pending.get(key) || globalThis.crypto.randomUUID();
    pending.set(key, requestId);
    const expected = viewer;
    state.busy = `${kind}:${stepId}`;
    state.error = "";
    try {
      const result = await request(route(attemptId), { method: "POST", body: { stepId, ...extra, requestId } });
      if (result?.ok === false) throw new Error(result.error || "The step result was not confirmed. Try again.");
      pending.delete(key);
      if (expected === viewer && attemptId === state.attemptId) await loadLesson(attemptId);
      return result;
    } catch (cause) {
      if (expected === viewer) state.error = String(cause?.message || "The step result was not confirmed. Try again.");
      return null;
    } finally {
      if (state.busy === `${kind}:${stepId}`) state.busy = "";
    }
  }

  const runCheck = stepId => stepAction("check", VIBE64_LEARNING_ROUTES.stepCheck, stepId);
  const answer = (stepId, selected) => stepAction("answer", VIBE64_LEARNING_ROUTES.stepAnswer, stepId,
    { selected: [...selected].map(Number).sort((left, right) => left - right) });
  const done = stepId => stepAction("done", VIBE64_LEARNING_ROUTES.stepDone, stepId);

  // Show me: minimise L, then point at (and, when declared, open) the real place.
  async function showMe(stepId = currentStep.value?.id) {
    const step = steps.value.find(value => value.id === stepId);
    if (!step?.guide) throw new Error("This step has nothing to show.");
    const command = showMeCommand(step.guide, { projectSlug: lesson.value?.practiceProjectSlug || "" });
    minimise();
    const navigator = browserNavigation?.value || null;
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

  async function waitForProjectView(projectSlug) {
    const deadline = now() + PROJECT_VIEW_WAIT_MS;
    while (!projectView(projectSlug) && now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
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

  async function endLesson({ expectedRevision, reason } = {}) {
    if (!state.attemptId || state.busy) return null;
    const attemptId = state.attemptId;
    const key = JSON.stringify([attemptId, "end"]);
    const requestId = pending.get(key) || globalThis.crypto.randomUUID();
    pending.set(key, requestId);
    state.busy = "end";
    state.error = "";
    try {
      const result = await request(VIBE64_LEARNING_ROUTES.lessonEnd(attemptId), { method: "POST",
        body: { requestId, expectedRevision, ...(reason ? { reason } : {}) } });
      if (result?.ok !== true) throw new Error(result?.error || "Ending the lesson was not confirmed. Retry the same request.");
      pending.delete(key);
      await loadLesson(attemptId);
      return result;
    } catch (cause) {
      state.error = String(cause?.message || "Ending the lesson was not confirmed.");
      return null;
    } finally {
      if (state.busy === "end") state.busy = "";
    }
  }

  // Realtime: a learner change for the displayed attempt rereads it.
  function learnerChanged(payload = {}) {
    if (state.attemptId && (!payload.attemptId || payload.attemptId === state.attemptId) && lesson.value) {
      return loadLesson(state.attemptId);
    }
    return null;
  }

  return Object.freeze({
    state: readonly(state),
    get open() { return state.open; },
    get minimised() { return state.minimised; },
    get surface() { return state.surface; },
    get attemptId() { return state.attemptId; },
    get stepId() { return currentStep.value?.id || ""; },
    get scroll() { return state.scroll; },
    lesson, results, steps, currentStep, focus, colleagueRequest,
    stepStatus: stepId => stepStatus(results.value, stepId),
    setViewer, show, minimise, close, toggle, selectStep, setScroll, flushReader, loadLesson,
    runCheck, answer, done, showMe, teachMe, consumeColleagueRequest, endLesson, learnerChanged
  });
}

export { VIBE64_LEARNING_ROUTES, VIBE64_LEARNING_TEACH_MESSAGE, createVibe64Learning, normalizeLesson, showMeCommand, stepStatus };
