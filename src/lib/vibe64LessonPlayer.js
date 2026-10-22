import { computed, reactive, watch } from "vue";
import { clearTrainingGuide, showTrainingGuide, trainingGuide } from "@local/vibe64-training/client/guide";
import { TRAINING_BEAT_ACTIONS, TRAINING_GUIDE_PLACES, trainingGuideSteps, trainingPlaceShown } from "@local/vibe64-training/shared/guide-targets";

// The lesson step bar's beat player, owned by the Learning controller: one
// deterministic player per host shell. A step's beats (lesson.read
// step.beats) play in order: a show beat points at its place and moves on by
// itself after a time set by its length; do and check beats wait for the
// learner: a do beat is done when the page focus shows its place, or when the
// page activity it names happens in the lesson's practice project during its
// step, after the step's previous do beat was done (so a message sent while
// an earlier beat played, or an agent that finished before its beat began,
// still counts); its confirmation shows briefly, then the next beat plays. Back
// and Next move by beat and cross into the neighbouring step at either end. The beat index and the pause are this tab's place (the
// controller's state, saved with it); nothing of the player is saved on the
// server.
const SHOW_MIN_MS = 5000;
const SHOW_MAX_MS = 12000;
const SHOW_PER_CHARACTER_MS = 50;
const TICK_MS = 100;
// How long a do beat's ring stays (the learner may dismiss it at once).
const DO_RING_MS = 15000;
const POINT_SETTLE_MS = 1500;
// How long a do beat's confirmation shows before the next beat.
const CONFIRM_MS = 1500;

const showDuration = text => Math.min(SHOW_MAX_MS, Math.max(SHOW_MIN_MS, SHOW_MIN_MS + SHOW_PER_CHARACTER_MS * String(text || "").length));

function reducedMotion() {
  try { return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); } catch { return false; }
}

function documentHidden() {
  return globalThis.document?.visibilityState === "hidden";
}

// The page activity that completes a do beat, or "".
function beatEvent(beat) {
  return TRAINING_BEAT_ACTIONS[beat.target]?.event || TRAINING_GUIDE_PLACES[beat.target]?.event || "";
}

// The place a beat points at, or "" (an action with no place, a check).
function beatPlace(beat) {
  if (!beat || beat.kind === "check") return "";
  return TRAINING_BEAT_ACTIONS[beat.target] ? TRAINING_BEAT_ACTIONS[beat.target].place || "" : beat.target;
}

// state: the controller's reactive state (stepId, beat, beatPaused, open);
// steps/currentStep: its computed lesson steps; active():
// the step bar shows the current lesson's step; selectStep(id, beat) and
// remember() are the controller's own. focus(): the page focus (null when the
// host has none); activity: the page activity channel; practiceSlug(): the
// lesson's practice project; allDone(stepId): every do beat of that step was
// detected (the controller then records a self-checked step as done).
function createLessonPlayer({ state, steps, currentStep, active, selectStep, remember,
  focus = () => null, activity = null, practiceSlug = () => "", allDone = () => {},
  showGuide = showTrainingGuide, clearGuide = clearTrainingGuide, shownGuide = () => trainingGuide.value?.id || "",
  motionReduced = reducedMotion, hidden = documentHidden } = {}) {
  // confirmed: the do beat's confirmation line while it shows.
  const local = reactive({ remaining: 0, duration: 0, held: false, ring: "", confirmed: "" });
  // The do beats detected in this tab (stepId:index); never saved.
  const detected = new Set();
  // The current step's page activity in order, and the position of the one
  // that completed its latest do beat; in memory only, reset with the step.
  const heard = { stepId: "", events: [], used: -1 };
  function stepActivity() {
    const stepId = currentStep.value?.id || "";
    if (heard.stepId !== stepId) Object.assign(heard, { stepId, events: [], used: -1 });
    return heard;
  }
  const activityMatches = (value, event) => value?.kind === "do" && beatEvent(value) === event.name &&
    (!value.path || event.path === value.path);
  const beats = computed(() => Array.isArray(currentStep.value?.beats) ? currentStep.value.beats : []);
  // A step whose last beat is its check ends on that beat; otherwise it ends
  // one past its last beat, where the bar shows the step's own verdict control.
  const end = computed(() => beats.value.length ? beats.value.length - (beats.value.at(-1).kind === "check" ? 1 : 0) : 0);
  const index = computed(() => Math.max(0, Math.min(Number.isSafeInteger(state.beat) ? state.beat : 0, end.value)));
  const beat = computed(() => beats.value[index.value] || null);
  const stepIndex = computed(() => steps.value.findIndex(step => step.id === currentStep.value?.id));
  // Everything that holds a show beat still except the document's visibility,
  // which the tick reads.
  const playing = computed(() => Boolean(active() && beat.value?.kind === "show" && !state.beatPaused && !local.held &&
    !state.open));

  function moveTo(value) {
    local.confirmed = "";
    state.beat = value;
    remember();
  }

  function next() {
    if (index.value < end.value) return moveTo(index.value + 1);
    const following = steps.value[stepIndex.value + 1];
    if (following) selectStep(following.id, 0);
  }

  function back() {
    if (index.value > 0) return moveTo(index.value - 1);
    const previous = steps.value[stepIndex.value - 1];
    if (!previous) return;
    const previousBeats = Array.isArray(previous.beats) ? previous.beats : [];
    selectStep(previous.id, previousBeats.length - (previousBeats.at(-1)?.kind === "check" ? 1 : 0));
  }

  // Show me on a step with beats: play it from its first beat.
  function start(stepId = currentStep.value?.id) {
    state.beatPaused = false;
    if (stepId === currentStep.value?.id) moveTo(0);
    else selectStep(stepId, 0);
  }

  function togglePause() {
    state.beatPaused = !state.beatPaused;
    remember();
  }

  // Pointer or keyboard focus inside the bar holds a show beat.
  function hold(value) { local.held = value === true; }

  // Each beat (re)starts its show timer and points at its place once.
  let timer = null;
  let confirmTimer = null;
  function stopTimer() {
    clearInterval(timer);
    timer = null;
  }
  function tick() {
    if (!playing.value || hidden() || motionReduced()) return;
    local.remaining = Math.max(0, local.remaining - TICK_MS);
    if (local.remaining > 0) return;
    stopTimer();
    next();
  }
  watch(() => [active(), currentStep.value?.id, index.value, beat.value], ([shown, , , value]) => {
    stopTimer();
    clearTimeout(confirmTimer);
    local.confirmed = "";
    if (local.ring) clearGuide(local.ring);
    local.ring = "";
    local.duration = value?.kind === "show" ? showDuration(value.text) : 0;
    local.remaining = local.duration;
    if (!shown || !value) return;
    if (value.kind === "show") timer = setInterval(tick, TICK_MS);
    if (value.kind === "do" && placeShown(value)) return confirm(value, "✓ You're already here.");
    // What the learner already did in this step completes a beat they have
    // not yet done here (Back onto a done beat leaves it waiting).
    if (value.kind === "do" && !detected.has(`${currentStep.value?.id}:${index.value}`)) {
      const history = stepActivity();
      const position = history.events.findIndex((event, at) => at > history.used && activityMatches(value, event));
      if (position >= 0) return confirm(value, "✓ Done.", position);
    }
    void point(value);
  }, { immediate: true });

  // Do beats: the place shown, or the page activity it names.
  function placeShown(value) {
    const current = focus();
    return Boolean(current && !TRAINING_BEAT_ACTIONS[value.target] &&
      trainingPlaceShown(value.target, { ...current, learningOpen: state.open }) === true);
  }
  function confirm(value, line = "✓ Done.", position = -1) {
    const stepId = currentStep.value?.id;
    const at = index.value;
    detected.add(`${stepId}:${at}`);
    if (position >= 0) stepActivity().used = position;
    if (local.ring) clearGuide(local.ring);
    local.ring = "";
    local.confirmed = line;
    clearTimeout(confirmTimer);
    const doBeats = beats.value.map((item, position) => [item, position]).filter(([item]) => item.kind === "do");
    if (doBeats.every(([, position]) => detected.has(`${stepId}:${position}`))) allDone(stepId);
    confirmTimer = setTimeout(() => {
      local.confirmed = "";
      if (currentStep.value?.id === stepId && index.value === at && beat.value === value) next();
    }, CONFIRM_MS);
  }
  watch(() => beat.value?.kind === "do" && active() && !local.confirmed && placeShown(beat.value), shown => {
    if (shown) confirm(beat.value);
  });
  activity?.subscribe(event => {
    if (practiceSlug() && event.projectSlug && event.projectSlug !== practiceSlug()) return;
    const history = stepActivity();
    history.events.push(event);
    const value = beat.value;
    if (local.confirmed || !active() || !activityMatches(value, event)) return;
    confirm(value, "✓ Done.", history.events.length - 1);
  });
  // Open Courses takes the ring away with the beat's text.
  watch(() => state.open, covered => {
    if (covered && local.ring) clearGuide(local.ring);
  });

  async function point(value) {
    const place = beatPlace(value);
    if (!place || state.open) return null;
    const request = { target: place, ...(value.path ? { filePath: value.path } : {}) };
    const guideSteps = trainingGuideSteps(request);
    const receipt = await showGuide({ ...request, highlight: true, navigate: false, steps: guideSteps,
      caption: guideSteps.map(item => item.label).join(" → ") },
    // The bar and its places may still be rendering when a beat begins.
    { settleMs: POINT_SETTLE_MS, durationMs: value.kind === "show" ? local.duration : DO_RING_MS });
    if (receipt?.shown) {
      // Only this player's own ring is taken away again.
      // A ring drawn after its beat moved on, or after Courses covered it, goes at once.
      if (beat.value === value && !state.open) local.ring = shownGuide();
      else clearGuide(shownGuide());
    }
    return receipt;
  }

  return Object.freeze({
    beats, beat, index, end,
    // The step's verdict state: its check beat, or one past its last beat.
    get final() { return Boolean(beats.value.length) && index.value === end.value; },
    get paused() { return Boolean(state.beatPaused); },
    get playing() { return playing.value && !motionReduced(); },
    get progress() { return local.duration ? 1 - local.remaining / local.duration : 0; },
    get atStart() { return index.value === 0 && stepIndex.value <= 0; },
    get atEnd() { return index.value >= end.value && stepIndex.value >= steps.value.length - 1; },
    get confirmed() { return local.confirmed; },
    next, back, start, togglePause, hold, point: () => beat.value && point(beat.value)
  });
}

export { createLessonPlayer, showDuration };
