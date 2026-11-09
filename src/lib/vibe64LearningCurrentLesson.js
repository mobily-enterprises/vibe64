import { computed, shallowRef } from "vue";
import { VIBE64_LEARNING_ROUTES, normalizeLesson, rememberPlace, stepStatus, text } from "@/lib/vibe64LearningModel.js";

/** @typedef {import("./vibe64LearningModel.js").LearningState} LearningState */
/** @typedef {import("./vibe64LearningModel.js").LearningRequest} LearningRequest */
/** @typedef {ReturnType<typeof createLearningCurrentLesson>} LearningCurrentLesson */

const READER_SAVE_DELAY_MS = 800;

/**
 * The current lesson: its read (every page of it), the selected step, and the
 * reader's place, kept in this tab and saved on the server.
 * @param {object} dependencies
 * @param {LearningState} dependencies.state
 * @param {LearningRequest} dependencies.request
 */
function createLearningCurrentLesson({ state, request }) {
  const lesson = shallowRef(null);
  // reads fences lesson reads.
  let reads = 0;
  // The latest lesson read.
  let lessonLoad = null;
  let saveTimer = null;
  let lastSaved = "";

  const results = computed(() => lesson.value?.results || []);
  const steps = computed(() => lesson.value?.steps || []);
  const currentStep = computed(() => steps.value.find(step => step.id === state.stepId) || steps.value[0] || null);
  // Every required step of the read lesson with steps (format 2 or 3) is passed.
  const complete = computed(() => Boolean(lesson.value?.schemaVersion >= 2 && steps.value.length &&
    steps.value.filter(step => step.required).every(step => stepStatus(results.value, step.id, lesson.value.passedStepIds) === "passed")));

  function selectAttempt(attemptId, stepId = "") {
    lesson.value = null;
    state.attemptId = attemptId;
    state.stepId = text(stepId) ? stepId : "";
    state.scroll = 0;
    state.beat = 0;
    lastSaved = "";
  }

  /**
   * lesson.read pages step text over 64 KiB; the reader shows every step, so
   * the other pages' bodies are merged into the first page's steps.
   */
  async function readAllPages(attemptId) {
    const first = await request(VIBE64_LEARNING_ROUTES.lessonRead(attemptId), { method: "GET" });
    const count = Number.isSafeInteger(first?.page?.count) ? first.page.count : 1;
    const steps = Array.isArray(first?.lesson?.steps) ? first.lesson.steps : null;
    if (count <= 1 || !steps) return first;
    const pages = await Promise.all(Array.from({ length: count - 1 }, (_, index) =>
      request(`${VIBE64_LEARNING_ROUTES.lessonRead(attemptId)}?page=${index + 1}`, { method: "GET" })));
    const bodies = new Map();
    for (const page of pages) {
      for (const step of page?.lesson?.steps || []) if (typeof step?.bodyText === "string") bodies.set(step.id, step.bodyText);
    }
    return { ...first, lesson: { ...first.lesson,
      steps: steps.map(step => typeof step?.bodyText === "string" || !bodies.has(step?.id) ? step : { ...step, bodyText: bodies.get(step.id) }) } };
  }

  function loadLesson(attemptId = state.attemptId) {
    lessonLoad = readLesson(attemptId);
    return lessonLoad;
  }

  async function readLesson(attemptId) {
    if (!attemptId || !state.actorKey) return null;
    const expected = ++reads;
    state.loading = true;
    state.lessonError = "";
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
        state.beat = 0;
      }
      rememberPlace(state);
      return value;
    } catch (cause) {
      if (expected === reads) state.lessonError = String(cause?.message || "This lesson could not be read.");
      return null;
    } finally {
      if (expected === reads) state.loading = false;
    }
  }

  /**
   * beat: where the step bar starts this step (Back enters a step at its end).
   */
  function selectStep(stepId, beat = 0) {
    if (!steps.value.some(step => step.id === stepId) || stepId === state.stepId) return;
    state.stepId = stepId;
    state.scroll = 0;
    state.beat = beat;
    rememberPlace(state);
    scheduleReaderSave();
  }

  function setScroll(scroll) {
    const value = Math.max(0, Math.round(Number(scroll) || 0));
    if (value === state.scroll) return;
    state.scroll = value;
    rememberPlace(state);
    scheduleReaderSave();
  }

  function scheduleReaderSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushReader, READER_SAVE_DELAY_MS);
  }

  /**
   * reader.json is last-write-wins; a failed save keeps this tab's place only.
   */
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

  /**
   * Another signed-in viewer: no lesson, and no read or reader save of the previous one lands.
   */
  function reset() {
    reads += 1;
    clearTimeout(saveTimer);
    lesson.value = null;
  }

  return {
    lesson,
    results,
    steps,
    currentStep,
    complete,
    get lessonLoad() { return lessonLoad; },
    selectAttempt,
    loadLesson,
    selectStep,
    // readable-check: allow setter-seam - not a slot: setScroll records the reader's scroll position, which is data
    setScroll,
    flushReader,
    reset
  };
}

export { createLearningCurrentLesson };
