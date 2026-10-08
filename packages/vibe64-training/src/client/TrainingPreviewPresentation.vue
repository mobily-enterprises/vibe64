<script setup>
import { mainConversationId } from "@local/vibe64-sessions/shared/conversation";
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, unref, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "/src/lib/vibe64AssistantHost.js";
import { resolveStudioRequestUrl } from "/src/lib/studioUrls.js";
import TrainingVisualPlayer from "./TrainingVisualPlayer.vue";
import { useTrainingPreviewRegistration } from "./useTrainingPreviewRegistration.js";

const props = defineProps({
  active: Boolean,
  lessonsAvailable: Boolean,
  appAvailable: { type: Boolean, default: true },
  attemptId: { type: String, default: "" },
  learningBinding: { type: Object, default: null },
  projectSlug: { type: String, required: true },
  sessionId: { type: String, required: true }
});
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
const actorKey = computed(() => unref(viewer)?.actorKey || "");
const learningAvailable = computed(() => {
  const binding = props.learningBinding;
  return (!props.appAvailable || binding?.noExercise === false) && props.lessonsAvailable && binding &&
    (binding.noExercise === false
      ? /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(binding.sourceProjectSlug || "") && props.projectSlug === binding.sourceProjectSlug
      : !props.projectSlug) &&
    actorKey.value && binding.viewerActorKey === actorKey.value && typeof binding.actorKey === "string" && binding.actorKey && binding.learnerId && !binding.projectSlug &&
    binding.learningAttemptId === props.attemptId && binding.sessionId === props.sessionId &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(props.attemptId) &&
    binding.sessionsApiPath === `/api/learning/${props.attemptId}/vibe64/sessions`;
});
function sameLearningBinding(expected) {
  return learningAvailable.value && ["actorKey", "viewerActorKey", "learnerId", "learningAttemptId", "sessionId", "sessionsApiPath", "noExercise", "sourceProjectSlug"]
    .every(key => expected[key] === props.learningBinding[key]);
}
const selection = shallowRef(null);
const resource = shallowRef(null);
const player = ref(null);
const display = ref({ phase: "closed", state: "", description: "", error: "" });
const revision = ref(0);
const mode = ref(props.appAvailable && !props.lessonsAvailable ? "app" : "lessons");
const collapsed = ref(false);
const cue = ref(null);
const visible = computed(() => props.active && mode.value === "presentation" && !collapsed.value);
const appVisible = computed(() => props.appAvailable && (mode.value === "app" || collapsed.value));
const lessonsVisible = computed(() => props.lessonsAvailable && (mode.value === "lessons" || !props.appAvailable && collapsed.value));
watch(() => props.lessonsAvailable, enabled => {
  if (!enabled && mode.value === "lessons" && props.appAvailable) mode.value = "app";
});
let mounted = true;
let pausing = null;
let hiddenRevision = 0;
watch(visible, (shown, wasShown) => { if (wasShown && !shown) hiddenRevision += 1; }, { flush: "sync" });
let transitionRevision = 0;
const checkpointError = ref("");
let checkpointOperation = null;

function ensureSelection(expected) {
  if (!mounted || !actorKey.value || !expected || selection.value !== expected ||
      expected.learningBinding && !sameLearningBinding(expected.learningBinding)) {
    throw new Error("This lesson presentation is no longer selected. Open its current attempt again.");
  }
}

function exactSelection(input) {
  const expected = selection.value;
  ensureSelection(expected);
  if ((props.attemptId && expected.attemptId !== props.attemptId) ||
      input?.attemptId !== expected.attemptId || input?.visualId !== expected.visualId) {
    throw new Error("Use the exact displayed attempt and visual identity.");
  }
  if (!player.value) throw new Error("The lesson presentation is not ready. Wait for it to open before sending a command.");
  return expected;
}

function observedState(value) {
  if (!mounted || value.attemptId !== selection.value?.attemptId) return;
  if (cue.value && value.playerInstanceId && value.playerInstanceId !== cue.value.playerInstanceId) {
    retireCue("The diagram player changed.", false);
  }
  if (cue.value?.phase === "playing" && value.phase === "accepted") cue.value.visualPhase = "accepted";
  display.value = value;
}

function observedError(error) {
  if (!mounted || !selection.value || display.value.phase !== "loading") return;
  display.value = { ...display.value, phase: "failed", error };
}

function state() {
  return {
    ...(selection.value ? { attemptId: selection.value.attemptId, visualId: selection.value.visualId } : {}),
    playerInstanceId: display.value.playerInstanceId || "",
    phase: mounted ? display.value.phase : "closed",
    state: display.value.state,
    description: display.value.description,
    visible: mounted && visible.value,
    error: display.value.error || "",
    ...(cue.value ? { cue: cueReceipt() } : {})
  };
}

async function ready(expected) {
  await nextTick();
  ensureSelection(expected);
  if (display.value.phase === "failed") throw new Error(display.value.error);
  if (display.value.phase !== "ready") {
    await new Promise((resolve, reject) => {
      const stop = watch([() => display.value.phase, revision], ([phase]) => {
        if (selection.value !== expected || !mounted || phase === "failed" || phase === "ready") {
          stop();
          if (selection.value !== expected || !mounted) {
            reject(new Error("The selected lesson presentation changed before it was ready."));
          } else if (phase === "failed") {
            reject(new Error(display.value.error));
          } else {
            resolve();
          }
        }
      }, { flush: "sync" });
    });
  }
  ensureSelection(expected);
  if (!visible.value) throw new Error("The lesson presentation is hidden. Show it before claiming it opened.");
}

async function open({ attemptId, visualId } = {}) {
  if (!actorKey.value || !props.active || (props.learningBinding && !learningAvailable.value) || (!learningAvailable.value && (!props.appAvailable || !props.projectSlug)) || !props.sessionId ||
      (props.attemptId && props.attemptId !== attemptId) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(attemptId || "") ||
      !/^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u.test(visualId || "")) {
    throw new Error("Open a declared visual for the signed-in learner's exact attempt in its active Preview.");
  }
  mode.value = "presentation";
  collapsed.value = false;
  let expected = selection.value;
  if (expected?.attemptId !== attemptId || expected.visualId !== visualId || !resource.value) {
    expected = { attemptId, visualId, ...(learningAvailable.value ? { learningBinding: Object.freeze(
      Object.fromEntries(["actorKey", "viewerActorKey", "learnerId", "learningAttemptId", "sessionId", "sessionsApiPath",
        ...(props.learningBinding.noExercise === false ? ["noExercise", "sourceProjectSlug"] : [])]
        .map(key => [key, props.learningBinding[key]]))) } : {}) };
    selection.value = expected;
    resource.value = null;
    revision.value++;
    display.value = { phase: "loading", state: "", description: "Loading lesson presentation.", error: "" };
    try {
      const result = await getHttpWebClient().request(resourceUrl(expected), { method: "GET" });
      ensureSelection(expected);
      if (result?.id !== visualId || result.visual?.id !== visualId) {
        throw new Error("The verified lesson visual did not match this request.");
      }
      resource.value = result;
    } catch (error) {
      if (mounted && selection.value === expected) display.value = { ...display.value, phase: "failed", error: error.message };
      throw error;
    }
  }
  await ready(expected);
  return { ok: true, ...state() };
}

function resourceUrl(expected) {
  if (expected.learningBinding) return `${expected.learningBinding.sessionsApiPath}/${encodeURIComponent(expected.learningBinding.sessionId)}/training/visuals/${encodeURIComponent(expected.visualId)}`;
  return resolveStudioRequestUrl(`/api/vibe64/training/attempts/${expected.attemptId}/visuals/${expected.visualId}`);
}

async function saveCheckpoint(expected, transition) {
  ensureSelection(expected);
  if (checkpointOperation) throw new Error("Retry the unconfirmed diagram checkpoint before saving another.");
  const instance = display.value.playerInstanceId;
  const fresh = await getHttpWebClient().request(resourceUrl(expected), { method: "GET" });
  ensureSelection(expected);
  if (transition !== transitionRevision || instance !== display.value.playerInstanceId) return;
  if (fresh.id !== expected.visualId || fresh.lessonHash !== resource.value.lessonHash ||
      JSON.stringify(fresh.pin) !== JSON.stringify(resource.value.pin) || !Number.isSafeInteger(fresh.revision)) {
    throw new Error("The saved diagram pin changed. Reopen this exact lesson before saving.");
  }
  const value = await snapshot(expected);
  ensureSelection(expected);
  if (transition !== transitionRevision || instance !== value.playerInstanceId) return;
  checkpointOperation = { expected, instance, transition, actor: actorKey.value, projectSlug: props.projectSlug,
    body: { requestId: crypto.randomUUID(), expectedRevision: fresh.revision,
      ...(!expected.learningBinding || expected.learningBinding.noExercise === false ? { projectSlug: props.projectSlug } : {}),
      sessionId: props.sessionId, snapshot: value.snapshot } };
  await retryCheckpoint();
}

async function retryCheckpoint() {
  const operation = checkpointOperation;
  if (!operation) {
    try { await saveCheckpoint(selection.value, transitionRevision); }
    catch (error) { checkpointError.value = error.message; }
    return;
  }
  try {
    ensureSelection(operation.expected);
    if (operation.actor !== actorKey.value || operation.instance !== display.value.playerInstanceId ||
        operation.projectSlug !== props.projectSlug || operation.body.sessionId !== props.sessionId) {
      throw new Error("This captured diagram checkpoint belongs to its original player and exercise.");
    }
    const result = await getHttpWebClient().request(resourceUrl(operation.expected), { method: "POST", body: operation.body });
    ensureSelection(operation.expected);
    if (checkpointOperation !== operation || operation.actor !== actorKey.value || operation.instance !== display.value.playerInstanceId) return;
    if (!Number.isSafeInteger(result?.revision)) throw new Error("The diagram save was not confirmed. Retry this exact checkpoint.");
    checkpointOperation = null;
    checkpointError.value = operation.transition === transitionRevision ? ""
      : "The earlier checkpoint is confirmed. Save the current diagram to retain its newer state.";
  } catch (error) {
    if (checkpointOperation !== operation || !mounted || selection.value !== operation.expected || actorKey.value !== operation.actor) return;
    if (error.code === "VIBE64_TRAINING_STATE_REVISION_CONFLICT") checkpointOperation = null;
    checkpointError.value = error.code === "VIBE64_TRAINING_STATE_REVISION_CONFLICT"
      ? "Learning changed before this diagram was saved. Save its current state with a fresh revision."
      : "The diagram checkpoint was not confirmed. Retry this exact save before claiming it can resume.";
    throw error;
  }
}

async function command(input) {
  const expected = exactSelection(input);
  if (!visible.value && input.name !== "pause") throw new Error("Show the lesson presentation before playing a transition.");
  const transition = ++transitionRevision;
  const result = await player.value.command({ commandId: input.commandId, name: input.name, parameters: { ...(input.parameters || {}) } });
  ensureSelection(expected);
  try { await saveCheckpoint(expected, transition); }
  catch (error) { if (mounted && selection.value === expected) checkpointError.value ||= error.message; }
  return {
    ok: true,
    attemptId: expected.attemptId,
    visualId: expected.visualId,
    playerInstanceId: result.playerInstanceId,
    phase: "completed",
    commandId: result.commandId,
    state: result.state,
    description: result.description
  };
}

async function snapshot(input) {
  const expected = exactSelection(input);
  const value = await player.value.snapshot();
  ensureSelection(expected);
  return {
    ok: true,
    attemptId: expected.attemptId,
    visualId: expected.visualId,
    playerInstanceId: display.value.playerInstanceId,
    snapshot: value,
    description: display.value.description
  };
}

function cueReceipt() {
  const { name, parameters, ...receipt } = cue.value;
  return { ...receipt };
}

async function armCue(input) {
  const expected = exactSelection(input);
  await ready(expected);
  for (const key of ["cueId", "commandId", "navigationId", "conversationId", "turnId", "clientId"]) {
    const mainIdentity = key === "conversationId" && expected.learningBinding && sameLearningBinding(expected.learningBinding) &&
      typeof input[key] === "string" && new TextEncoder().encode(input[key]).byteLength <= 256 &&
      input[key] === mainConversationId({ learningAttemptId: expected.attemptId, sessionId: expected.learningBinding.sessionId });
    if (!mainIdentity && (typeof input[key] !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/u.test(input[key]))) {
      throw new Error("A lesson cue requires its exact admitted conversation and command identities.");
    }
  }
  if (cue.value?.cueId === input.cueId) {
    const current = cue.value;
    if (["attemptId", "visualId", "commandId", "conversationId", "turnId", "clientId", "name"]
        .some(key => current[key] !== input[key]) || Object.keys(current.parameters).length !== Object.keys(input.parameters || {}).length ||
        Object.keys(current.parameters).some(key => current.parameters[key] !== input.parameters?.[key]) ||
        current.canonicalFinal) throw new Error("This cue identity belongs to its exact original explanation.");
    current.navigationId = input.navigationId;
    return { ok: true, ...cueReceipt() };
  }
  if (cue.value && !["completed", "interrupted", "failed"].includes(cue.value.phase)) {
    throw new Error("Finish or explicitly interrupt the current lesson cue before arming another.");
  }
  cue.value = {
    attemptId: expected.attemptId, visualId: expected.visualId,
    playerInstanceId: display.value.playerInstanceId,
    cueId: input.cueId, commandId: input.commandId, navigationId: input.navigationId, conversationId: input.conversationId,
    turnId: input.turnId, clientId: input.clientId, name: input.name, parameters: input.parameters || {},
    outputId: "", canonicalFinal: false, phase: "armed", audioPhase: "waiting", visualPhase: "ready",
    state: display.value.state, description: display.value.description, error: ""
  };
  return { ok: true, ...cueReceipt() };
}

function observeCue(value, { readAloud = false } = {}) {
  const current = cue.value;
  if (!current || ["attemptId", "visualId", "playerInstanceId", "cueId", "commandId", "navigationId", "conversationId", "turnId", "clientId"]
    .some(key => value?.[key] !== current[key])) return false;
  if (["interrupted", "failed"].includes(value.phase)) {
    retireCue(value.error || "The lesson explanation stopped.", true, value.phase);
    return true;
  }
  if (["completed", "interrupted", "failed"].includes(current.phase)) return false;
  if (!value.canonicalFinal || typeof value.outputId !== "string" || !value.outputId || value.outputId.length > 256 ||
      current.outputId && current.outputId !== value.outputId) return false;
  if (current.outputId) return true;
  current.outputId = value.outputId;
  current.canonicalFinal = true;
  current.audioPhase = readAloud ? "waiting" : "off";
  current.phase = readAloud ? "awaiting-audio" : "awaiting-continue";
  return true;
}

function finishCue(current) {
  if (cue.value !== current || current.phase !== "playing") return;
  if (current.visualPhase === "completed" && ["completed", "off"].includes(current.audioPhase)) {
    current.phase = "completed";
  }
}

async function playCue(current) {
  if (cue.value !== current || !current.canonicalFinal || !visible.value || current.visualPhase !== "ready") return false;
  current.phase = "playing";
  current.visualPhase = "pending";
  try {
    const result = await command(current);
    if (cue.value !== current || current.phase !== "playing") return false;
    current.visualPhase = "completed";
    current.state = result.state;
    current.description = result.description;
    finishCue(current);
    return true;
  } catch (error) {
    if (cue.value === current && current.phase === "playing") {
      current.phase = "failed";
      current.visualPhase = "failed";
      current.error = error.message;
    }
    return false;
  }
}

function continueCue() {
  const current = cue.value;
  if (!current || !["awaiting-audio", "awaiting-continue"].includes(current.phase)) return;
  current.audioPhase = "off";
  void playCue(current);
}

function playback(event) {
  const current = cue.value;
  if (!current || !current.outputId || event.conversationId !== current.conversationId || event.outputId !== current.outputId ||
      ["completed", "interrupted", "failed"].includes(current.phase)) return false;
  if (event.phase === "started" && current.audioPhase === "waiting") {
    current.audioPhase = "started";
    void playCue(current);
  } else if (event.phase === "completed" && current.audioPhase === "started") {
    current.audioPhase = "completed";
    finishCue(current);
  } else if (["interrupted", "failed"].includes(event.phase)) {
    current.audioPhase = event.phase;
    if (current.visualPhase === "ready") {
      current.phase = "awaiting-continue";
      current.error = "Sound did not finish. Continue explicitly without sound, or repeat the explanation.";
    } else retireCue("The spoken explanation was interrupted.");
  }
  return true;
}

function retireCue(reason = "The lesson presentation stopped.", pause = true, phase = "interrupted") {
  const current = cue.value;
  if (!current || ["completed", "interrupted", "failed"].includes(current.phase)) return;
  current.phase = phase;
  current.error = reason;
  if (pause) void pauseHidden(true);
}

async function pauseHidden(force = false) {
  if (visible.value && !force || pausing === selection.value || !player.value || !selection.value ||
      !["ready", "accepted"].includes(display.value.phase) ||
      !resource.value?.visual.commands.some(value => value.name === "pause")) return;
  const expected = selection.value;
  pausing = expected;
  const hiddenAtStart = hiddenRevision;
  try {
    await command({ ...expected, commandId: crypto.randomUUID(), name: "pause" });
    await snapshot(expected);
  } catch (error) {
    if (mounted && selection.value === expected) display.value = { ...display.value, error: error.message };
  } finally {
    if (pausing === expected) {
      pausing = null;
      if (mounted && selection.value === expected && !visible.value && hiddenRevision !== hiddenAtStart) {
        void pauseHidden();
      }
    }
  }
}

watch([visible, () => display.value.phase], () => {
  if (!visible.value) retireCue("The lesson presentation is hidden.", false);
  void pauseHidden();
}, { flush: "post" });
watch([actorKey, () => props.projectSlug, () => props.sessionId, () => props.attemptId,
  () => props.learningBinding?.actorKey, () => props.learningBinding?.viewerActorKey, () => props.learningBinding?.learnerId,
  () => props.learningBinding?.projectSlug, () => props.learningBinding?.noExercise, () => props.learningBinding?.sourceProjectSlug,
  () => props.learningBinding?.learningAttemptId, () => props.learningBinding?.sessionId,
  () => props.learningBinding?.sessionsApiPath], () => {
  retireCue("The learner or exercise changed.", false);
  cue.value = null;
  checkpointOperation = null;
  checkpointError.value = "";
  transitionRevision++;
  selection.value = null;
  resource.value = null;
  display.value = { phase: "closed", state: "", description: "", error: "" };
  mode.value = props.appAvailable ? "app" : "lessons";
  collapsed.value = false;
  revision.value++;
}, { flush: "sync" });
onBeforeUnmount(() => {
  retireCue("The lesson presentation closed.", false);
  mounted = false;
  revision.value++;
});
const presentation = Object.freeze({ open, command, snapshot, armCue, observeCue, playback, retireCue, get state() { return state(); } });
useTrainingPreviewRegistration({
  get presentation() { return presentation; },
  get projectSlug() { return props.projectSlug; },
  get sessionId() { return props.sessionId; },
  get learningAttemptId() { return props.attemptId; },
  get learnerId() { return props.learningBinding?.learnerId; },
  get noExercise() { return props.learningBinding?.noExercise; },
  get screen() { return undefined; }
}, () => props.active && learningAvailable.value);
defineExpose({ presentation });
</script>

<template>
  <section class="training-preview">
    <div v-if="selection || lessonsAvailable" class="training-preview__choices" aria-label="Preview content">
      <v-btn v-if="appAvailable" min-height="48" :variant="appVisible ? 'tonal' : 'text'" :aria-pressed="appVisible" @click="mode = 'app'; collapsed = false">{{ lessonsAvailable ? 'App' : 'App preview' }}</v-btn>
      <v-btn v-if="lessonsAvailable" min-height="48" :variant="lessonsVisible ? 'tonal' : 'text'" :aria-pressed="lessonsVisible" @click="mode = 'lessons'; collapsed = false">Lessons</v-btn>
      <v-btn min-height="48" :disabled="!selection" :variant="visible ? 'tonal' : 'text'" :aria-pressed="visible" @click="mode = 'presentation'; collapsed = false">{{ lessonsAvailable ? 'Presentation' : 'Colleague presentation' }}</v-btn>
      <v-btn v-if="mode === 'presentation'" min-height="48" variant="text" @click="collapsed = !collapsed">
        {{ collapsed ? 'Restore presentation' : 'Minimise presentation' }}
      </v-btn>
    </div>
    <p v-if="!appAvailable && learningBinding?.noExercise === false" role="status">
      The practice App controls are unavailable in this installation. Keep this lesson and its saved workspace; lesson diagrams use Presentation.
    </p>
    <div v-if="cue && ['awaiting-audio', 'awaiting-continue'].includes(cue.phase)" class="training-preview__choices">
      <p role="status">{{ cue.error || 'The explanation is ready. Continue when you are ready to watch.' }}</p>
      <v-btn min-height="48" variant="tonal" @click="continueCue">{{ cue.phase === 'awaiting-audio' ? 'Play diagram without sound' : 'Continue' }}</v-btn>
    </div>
    <div v-if="checkpointError" role="alert">
      <p>{{ checkpointError }}</p>
      <v-btn min-height="48" variant="tonal" @click="retryCheckpoint().catch(() => {})">
        {{ checkpointOperation ? 'Retry diagram checkpoint' : 'Save current diagram' }}
      </v-btn>
    </div>
    <div v-if="appAvailable" v-show="appVisible" class="training-preview__app">
      <slot :app-visible="appVisible" :presentation="presentation" />
    </div>
    <div v-if="lessonsAvailable" v-show="lessonsVisible" class="training-preview__lessons" aria-label="Lessons">
      <slot name="lessons" />
      <p v-if="!appAvailable && !selection" role="status">This lesson has no App preview. No lesson presentation is open.</p>
    </div>
    <div v-show="lessonsAvailable ? visible : !appVisible" class="training-preview__presentation">
      <TrainingVisualPlayer v-if="resource" ref="player" :resource="resource" :attempt-id="selection.attemptId" :snapshot="resource.snapshot" @state="observedState" @error="observedError" />
      <v-skeleton-loader v-else-if="display.phase === 'loading'" type="image" aria-label="Loading lesson presentation" />
      <div v-if="!resource && display.error">
        <p role="alert">{{ display.error }}</p>
        <v-btn min-height="48" variant="tonal" @click="open(selection).catch(() => {})">Reload presentation</v-btn>
      </div>
    </div>
  </section>
</template>

<style scoped>
.training-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.training-preview__choices {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 4px;
}
.training-preview__app {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.training-preview__lessons,
.training-preview__presentation {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.training-preview__presentation p {
  margin: 8px;
  overflow-wrap: anywhere;
}
</style>
