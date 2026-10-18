<script setup>
import { mainConversationId } from "@local/vibe64-sessions/shared/conversation";
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, unref, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_TRAINING_LEARNER_GESTURE_KEY } from "/src/lib/vibe64AssistantHost.js";
import { resolveStudioRequestUrl } from "/src/lib/studioUrls.js";
import TrainingVisualPlayer from "./TrainingVisualPlayer.vue";
import { useTrainingPreviewRegistration } from "./useTrainingPreviewRegistration.js";

const props = defineProps({
  active: Boolean,
  agentConnectionStatus: { type: String, default: "" },
  lessonsAvailable: Boolean,
  appAvailable: { type: Boolean, default: true },
  attemptId: { type: String, default: "" },
  learningBinding: { type: Object, default: null },
  learningPaneActive: { type: Boolean, default: null },
  projectSlug: { type: String, required: true },
  sessionId: { type: String, required: true },
  workspaceActive: { type: Boolean, default: null }
});
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
const learnerGestures = inject(VIBE64_TRAINING_LEARNER_GESTURE_KEY, null);
async function showApp(event) {
  if (appOpening.value || !props.active || !props.appAvailable) return;
  const practice = props.learningBinding?.noExercise === false;
  if (practice && !learningAvailable.value) return;
  const expected = practice ? Object.freeze({ ...props.learningBinding }) : null;
  const generation = appOpenGeneration;
  const owner = learnerGestures?.value;
  const ticket = props.active && props.appAvailable ? owner?.begin(event, "preview-select", {
    projectSlug: props.projectSlug, sessionId: props.sessionId }) : null;
  appError.value = "";
  try {
    if (practice) {
      appOpening.value = true;
      const result = await openAppCommand.run({ path: expected.sessionsApiPath });
      if (!mounted || generation !== appOpenGeneration || !props.active || !sameLearningBinding(expected)) {
        if (ticket) owner.discard(ticket);
        return;
      }
      if (result?.ok !== true || result.sessionId !== expected.sessionId) {
        throw new Error("The saved practice conversation did not confirm opening. Keep this lesson and choose App again.");
      }
      appOpened.value = true;
    }
    if (!splitPaneMode.value) mode.value = "app";
    collapsed.value = false;
    if (ticket) void owner.finish(ticket);
  } catch (error) {
    if (ticket) owner.discard(ticket);
    if (mounted && generation === appOpenGeneration && (!expected || sameLearningBinding(expected))) {
      appError.value = String(error?.message || "The practice App could not open. Keep this lesson and choose App again.");
    }
  } finally {
    if (generation === appOpenGeneration) appOpening.value = false;
  }
}
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
const appOpened = ref(false);
const appOpening = ref(false);
const appError = ref("");
let appOpenGeneration = 0;
let mounted = true;
const openAppCommand = useCommand({
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: "app", access: "never",
  apiSuffix: "/vibe64/sessions", placementSource: "vibe64.sessions.create",
  suppressSuccessMessage: true,
  buildRawPayload: () => ({}),
  buildCommandOptions: (_model, { context }) => ({ method: "POST", path: context.path }),
  fallbackRunError: "The saved practice App could not open. Keep this lesson and choose App again."
});
const splitPaneMode = computed(() => props.learningPaneActive !== null || props.workspaceActive !== null);
const visible = computed(() => props.active && (!splitPaneMode.value || props.learningPaneActive) && mode.value === "presentation" && !collapsed.value);
const appVisible = computed(() => props.active && props.appAvailable &&
  (props.learningBinding?.noExercise !== false || appOpened.value) &&
  (splitPaneMode.value ? props.workspaceActive : mode.value === "app" || collapsed.value));
const lessonsVisible = computed(() => props.active && props.lessonsAvailable &&
  (!splitPaneMode.value || props.learningPaneActive) && (mode.value === "lessons" || !props.appAvailable && collapsed.value));
watch(() => [actorKey.value, props.projectSlug, props.attemptId, props.sessionId, ...["actorKey", "viewerActorKey", "learnerId", "projectSlug",
  "learningAttemptId", "sessionId", "sessionsApiPath", "noExercise", "sourceProjectSlug"]
  .map(key => props.learningBinding?.[key])], () => {
  appOpenGeneration++;
  appOpened.value = false;
  appOpening.value = false;
  appError.value = "";
}, { flush: "sync" });
watch(() => props.active, () => {
  appOpenGeneration++;
  appOpening.value = false;
}, { flush: "sync" });
watch(() => props.lessonsAvailable, enabled => {
  if (!enabled && mode.value === "lessons" && props.appAvailable) mode.value = "app";
});
watch(() => [splitPaneMode.value, props.workspaceActive, props.active, props.sessionId,
  props.learningBinding?.sessionId, props.agentConnectionStatus], ([split, workspace, active]) => {
  if (split && workspace && active && props.appAvailable && props.learningBinding?.noExercise === false &&
      !["initializing", "reconciling"].includes(props.agentConnectionStatus) &&
      !appOpened.value && !appOpening.value) void showApp(null);
}, { immediate: true });
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
      ...(!expected.learningBinding ? { projectSlug: props.projectSlug } : {}),
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
  get appVisible() { return props.active && appVisible.value; },
  get screen() { return undefined; }
}, () => props.active && learningAvailable.value);
defineExpose({ presentation });
</script>

<template>
  <section class="training-preview">
    <div v-if="(selection || lessonsAvailable) && (!splitPaneMode || learningPaneActive)" class="training-preview__choices" aria-label="Learning content">
      <div class="training-preview__segmented" role="group" aria-label="Learning view">
        <v-btn v-if="appAvailable && !splitPaneMode" class="training-preview__segment" :class="{ 'is-selected': appVisible }" min-height="40" :disabled="appOpening" variant="text" :aria-pressed="appVisible" @click="showApp($event)">
          <svg v-if="appVisible" class="training-preview__segment-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>{{ lessonsAvailable ? 'App' : 'App preview' }}
        </v-btn>
        <v-btn v-if="lessonsAvailable" class="training-preview__segment" :class="{ 'is-selected': lessonsVisible }" min-height="40" variant="text" :aria-pressed="lessonsVisible" @click="mode = 'lessons'; collapsed = false">
          <svg v-if="lessonsVisible" class="training-preview__segment-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>Courses
        </v-btn>
        <v-btn class="training-preview__segment" :class="{ 'is-selected': visible }" min-height="40" :disabled="!selection" variant="text" :aria-pressed="visible" @click="mode = 'presentation'; collapsed = false">
          <svg v-if="visible" class="training-preview__segment-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>{{ lessonsAvailable ? 'Presentation' : 'Colleague presentation' }}
        </v-btn>
      </div>
      <v-btn v-if="mode === 'presentation'" class="training-preview__collapse" min-height="40" rounded="pill" variant="tonal" @click="collapsed = !collapsed">
        <svg class="training-preview__collapse-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="collapsed ? 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z' : 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z'" /></svg>{{ collapsed ? 'Restore presentation' : 'Minimise presentation' }}
      </v-btn>
    </div>
    <div v-if="appError" class="training-preview__notice is-error" role="alert">
      <svg class="training-preview__notice-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 13h-2V7h2m0 10h-2v-2h2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" /></svg>
      <p>{{ appError }}</p>
      <v-btn v-if="splitPaneMode && workspaceActive" min-height="48" rounded="pill" variant="tonal" @click="showApp($event)">Retry workspace</v-btn>
    </div>
    <p v-if="!appAvailable && learningBinding?.noExercise === false" class="training-preview__note" role="status">
      The practice App controls are unavailable in this installation. Keep this lesson and its saved workspace; lesson diagrams use Presentation.
    </p>
    <p v-else-if="!appAvailable && lessonsAvailable" class="training-preview__note" role="status">
      This lesson has no project workspace. Use Learning for its lesson content and presentation.
    </p>
    <div v-if="cue && ['awaiting-audio', 'awaiting-continue'].includes(cue.phase)" class="training-preview__choices training-preview__cue" :class="{ 'is-error': cue.error }">
      <span class="training-preview__cue-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path :d="cue.phase === 'awaiting-audio' ? 'M3 9v6h4l5 5V4L7 9H3m13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Z' : 'M8 5.14v14l11-7-11-7Z'" /></svg>
      </span>
      <p role="status">{{ cue.error || 'The explanation is ready. Continue when you are ready to watch.' }}</p>
      <v-btn min-height="48" rounded="pill" color="primary" variant="flat" @click="continueCue">{{ cue.phase === 'awaiting-audio' ? 'Play diagram without sound' : 'Continue' }}</v-btn>
    </div>
    <div v-if="checkpointError" class="training-preview__notice is-error" role="alert">
      <svg class="training-preview__notice-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 13h-2V7h2m0 10h-2v-2h2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" /></svg>
      <p>{{ checkpointError }}</p>
      <v-btn min-height="48" rounded="pill" variant="tonal" @click="retryCheckpoint().catch(() => {})">
        {{ checkpointOperation ? 'Retry diagram checkpoint' : 'Save current diagram' }}
      </v-btn>
    </div>
    <div v-if="appAvailable" v-show="appVisible" class="training-preview__app">
      <slot v-if="learningBinding?.noExercise !== false || appOpened" :app-visible="appVisible" :presentation="presentation" />
    </div>
    <div v-if="lessonsAvailable" v-show="lessonsVisible" class="training-preview__lessons" aria-label="Courses">
      <slot name="lessons" />
      <div v-if="!appAvailable && !selection" class="training-preview__empty">
        <svg class="training-preview__empty-art" viewBox="0 0 120 80" aria-hidden="true" focusable="false">
          <rect x="14" y="10" width="92" height="56" rx="10" class="frame" />
          <path d="M30 50l14-16 12 10 10-8 18 14" class="line" />
          <circle cx="86" cy="26" r="6" class="sun" />
        </svg>
        <p role="status">This lesson has no App preview. No lesson presentation is open.</p>
      </div>
    </div>
    <div v-show="lessonsAvailable ? visible : !appVisible" class="training-preview__presentation">
      <TrainingVisualPlayer v-if="resource" ref="player" :resource="resource" :attempt-id="selection.attemptId" :snapshot="resource.snapshot" @state="observedState" @error="observedError" />
      <v-skeleton-loader v-else-if="display.phase === 'loading'" class="training-preview__loading" type="image, paragraph" aria-label="Loading lesson presentation" />
      <div v-if="!resource && display.error" class="training-preview__notice is-error">
        <svg class="training-preview__notice-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 13h-2V7h2m0 10h-2v-2h2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" /></svg>
        <p role="alert">{{ display.error }}</p>
        <v-btn min-height="48" rounded="pill" variant="tonal" @click="open(selection).catch(() => {})">Reload presentation</v-btn>
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
  align-items: center;
  gap: var(--v64-space-2, 8px);
}
.training-preview > .training-preview__choices:first-child { padding: var(--v64-space-3, 12px) var(--v64-space-3, 12px) var(--v64-space-1, 4px); }

/* Material 3 segmented button: one outlined pill, selected segment tonal with a check. */
.training-preview__segmented {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--v64-outline, rgba(var(--v-theme-on-surface), 0.24));
  border-radius: var(--v64-shape-full, 999px);
  overflow: hidden;
}
.training-preview__segmented > .training-preview__segment {
  flex: 1 1 auto;
  min-width: 0;
  border-radius: 0;
  padding-inline: 16px;
  letter-spacing: 0;
  text-transform: none;
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  color: var(--v64-on-surface, rgb(var(--v-theme-on-surface)));
  transition: background-color var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease);
}
.training-preview__segmented > .training-preview__segment + .training-preview__segment { border-inline-start: 1px solid var(--v64-outline, rgba(var(--v-theme-on-surface), 0.24)); }
.training-preview__segmented > .training-preview__segment.is-selected {
  background: var(--v64-learning-container, rgba(245, 197, 24, 0.22));
  color: var(--v64-on-learning-container, rgb(var(--v-theme-on-surface)));
}
.training-preview__segment-check { width: 18px; height: 18px; margin-inline-end: 6px; fill: currentColor; animation: training-preview-pop var(--v64-duration-medium, 300ms) var(--v64-ease-emphasized-decelerate, ease-out); }
.training-preview__collapse { margin-inline-start: auto; letter-spacing: 0; text-transform: none; }
.training-preview__collapse-icon { width: 18px; height: 18px; margin-inline-end: var(--v64-space-1, 4px); fill: currentColor; }

.training-preview__note {
  margin: var(--v64-space-2, 8px) var(--v64-space-3, 12px);
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
  border-radius: var(--v64-shape-md, 12px);
  background: var(--v64-surface-container-high, rgba(var(--v-theme-on-surface), 0.06));
  color: var(--v64-on-surface-variant, inherit);
  font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif);
}
.training-preview__notice,
.training-preview__cue {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--v64-space-3, 12px);
  margin: var(--v64-space-2, 8px) var(--v64-space-3, 12px);
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
  border-radius: var(--v64-shape-lg, 16px);
  animation: training-preview-rise var(--v64-duration-medium, 300ms) var(--v64-ease-emphasized-decelerate, ease-out);
}
.training-preview__notice p, .training-preview__cue p { flex: 1 1 12rem; min-width: 0; margin: 0; overflow-wrap: anywhere; font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif); }
.training-preview__notice.is-error { background: var(--v64-error-container, rgba(var(--v-theme-error), 0.12)); color: rgb(var(--v-theme-on-surface)); }
.training-preview__notice-icon { flex: 0 0 auto; width: 24px; height: 24px; fill: rgb(var(--v-theme-error)); }
.training-preview__cue {
  background: var(--v64-primary-container, rgba(var(--v-theme-primary), 0.14));
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  box-shadow: var(--v64-elevation-1, 0 1px 3px rgba(0, 0, 0, 0.12));
}
.training-preview__cue.is-error { background: var(--v64-learning-container, rgba(245, 197, 24, 0.22)); border-color: rgba(245, 197, 24, 0.6); }
.training-preview__cue p { font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif); }
.training-preview__cue-icon {
  position: relative;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.training-preview__cue-icon::after {
  content: "";
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  border: 2px solid rgba(var(--v-theme-primary), 0.4);
  animation: training-preview-pulse 2.2s var(--v64-ease-standard, ease) infinite;
}
.training-preview__cue-icon svg { width: 24px; height: 24px; fill: currentColor; }
.training-preview__notice .v-btn, .training-preview__cue .v-btn { letter-spacing: 0; text-transform: none; padding-inline: 20px; }

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
.training-preview__presentation { padding: var(--v64-space-2, 8px) var(--v64-space-3, 12px) var(--v64-space-3, 12px); }
.training-preview__presentation p {
  overflow-wrap: anywhere;
}
.training-preview__loading { border-radius: var(--v64-shape-lg, 16px); overflow: hidden; }
.training-preview__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--v64-space-3, 12px);
  margin: var(--v64-space-4, 16px);
  padding: var(--v64-space-6, 32px) var(--v64-space-4, 16px);
  border: 1px dashed var(--v64-outline, rgba(var(--v-theme-on-surface), 0.24));
  border-radius: var(--v64-shape-xl, 28px);
  text-align: center;
  color: var(--v64-on-surface-variant, inherit);
}
.training-preview__empty p { margin: 0; max-width: 28rem; font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif); }
.training-preview__empty-art { width: 120px; height: 80px; }
.training-preview__empty-art .frame { fill: var(--v64-surface-container-high, rgba(var(--v-theme-primary), 0.08)); stroke: var(--v64-outline, rgba(var(--v-theme-on-surface), 0.24)); stroke-width: 2; }
.training-preview__empty-art .line { fill: none; stroke: rgba(var(--v-theme-primary), 0.55); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.training-preview__empty-art .sun { fill: var(--v64-learning, #f5c518); }

@keyframes training-preview-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes training-preview-pop { from { transform: scale(0.4); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes training-preview-pulse { 0% { transform: scale(0.94); opacity: 0.9; } 70% { transform: scale(1.2); opacity: 0; } 100% { opacity: 0; } }
@media (max-width: 599px) {
  .training-preview__segmented { flex: 1 1 100%; }
  .training-preview__segmented > .training-preview__segment { min-height: 44px !important; padding-inline: 10px; }
  .training-preview__cue .v-btn, .training-preview__notice .v-btn { flex: 1 1 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .training-preview__notice, .training-preview__cue, .training-preview__segment-check, .training-preview__cue-icon::after { animation: none; }
}
</style>
