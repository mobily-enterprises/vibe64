<script setup>
import { computed, onBeforeUnmount, ref, toRaw, watch } from "vue";
import { createTrainingVisualPlayer } from "./visualPlayer.js";

const props = defineProps({
  resource: { type: Object, required: true },
  attemptId: { type: String, required: true },
  snapshot: { type: Object, default: undefined },
  reducedMotion: { type: Boolean, default: undefined }
});
const emit = defineEmits(["state", "error"]);
const frame = ref(null);
const state = ref({ phase: "loading", description: props.resource.visual?.description || "", error: "" });
const title = computed(() => props.resource.visual?.title || "Lesson diagram");
let player;

function mount(iframe) {
  player?.dispose();
  player = undefined;
  if (!iframe) return;
  try {
    player = createTrainingVisualPlayer({
      iframe, resource: toRaw(props.resource), attemptId: props.attemptId,
      snapshot: toRaw(props.snapshot),
      reducedMotion: motionPreference(),
      onState(value) {
        state.value = value;
        emit("state", value);
        if (value.error) emit("error", value.error);
      }
    });
  } catch (cause) {
    state.value = { phase: "failed", description: props.resource.visual?.description || "", error: cause.message };
    emit("error", cause.message);
  }
}

watch([frame, () => props.resource, () => props.attemptId], ([iframe]) => mount(iframe), { immediate: true, flush: "post" });

function motionPreference() {
  return props.reducedMotion ?? frame.value.ownerDocument.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function requirePlayer() {
  if (!player) throw new Error("The diagram has not mounted.");
  return player;
}

function reload() {
  if (!player) return mount(frame.value);
  return player.restore(undefined, motionPreference()).catch(() => {});
}

onBeforeUnmount(() => player?.dispose());
defineExpose({
  command: value => requirePlayer().command(toRaw(value)),
  snapshot: () => requirePlayer().snapshot(),
  restore: value => requirePlayer().restore(toRaw(value), motionPreference()),
  dispose: () => player?.dispose()
});
</script>

<template>
  <section class="vibe64-training-visual" :class="`is-${state.phase}`" :aria-label="title">
    <div class="vibe64-training-visual__frame">
      <div class="vibe64-training-visual__bar">
        <svg class="vibe64-training-visual__bar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m0 16H5V5h14v14M7 15l3-4 2 3 3-4 2 5H7Z" /></svg>
        <span class="vibe64-training-visual__bar-title">{{ title }}</span>
      </div>
      <div class="vibe64-training-visual__canvas">
        <iframe ref="frame" :title="title" sandbox="allow-scripts" referrerpolicy="no-referrer" />
        <v-skeleton-loader v-if="state.phase === 'loading'" type="image" class="vibe64-training-visual__loading" />
      </div>
    </div>
    <p v-show="state.description" class="vibe64-training-visual__caption text-body-medium" role="status">{{ state.description }}</p>
    <div v-if="state.error" class="vibe64-training-visual__error" role="alert">
      <svg class="vibe64-training-visual__error-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 13h-2V7h2m0 10h-2v-2h2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" /></svg>
      <p class="text-body-medium">{{ state.error }}</p>
      <v-btn min-height="48" rounded="pill" variant="tonal" @click="reload">Reload diagram</v-btn>
    </div>
  </section>
</template>

<style scoped>
.vibe64-training-visual { min-width: 0; display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); }
.vibe64-training-visual__frame {
  border: 1px solid var(--v64-outline-variant, rgba(var(--v-theme-on-surface), 0.12));
  border-radius: var(--v64-shape-lg, 16px);
  background: var(--v64-surface-container-lowest, rgb(var(--v-theme-surface)));
  box-shadow: var(--v64-elevation-1, 0 1px 3px rgba(0, 0, 0, 0.12));
  overflow: hidden;
  animation: vibe64-training-visual-rise var(--v64-duration-long, 500ms) var(--v64-ease-emphasized-decelerate, ease-out);
}
.vibe64-training-visual__bar {
  display: flex;
  align-items: center;
  gap: var(--v64-space-2, 8px);
  min-height: 40px;
  padding: 0 var(--v64-space-4, 16px);
  background: var(--v64-surface-container, rgba(var(--v-theme-primary), 0.05));
  border-bottom: 1px solid var(--v64-outline-variant, rgba(var(--v-theme-on-surface), 0.12));
}
.vibe64-training-visual__bar-icon { flex: 0 0 auto; width: 18px; height: 18px; fill: rgb(var(--v-theme-primary)); }
.vibe64-training-visual__bar-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
}
.vibe64-training-visual__canvas { position: relative; }
.vibe64-training-visual iframe { display: block; width: 100%; height: min(60vh, 32rem); min-height: 16rem; border: 0; }
.vibe64-training-visual__loading { position: absolute; inset: 0; }
.vibe64-training-visual p { margin: 0; overflow-wrap: anywhere; }
.vibe64-training-visual__caption {
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
  border-radius: var(--v64-shape-md, 12px);
  border-inline-start: 4px solid var(--v64-learning, #f5c518);
  background: var(--v64-surface-container-low, rgba(var(--v-theme-primary), 0.03));
}
.vibe64-training-visual__error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--v64-space-3, 12px);
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
  border-radius: var(--v64-shape-lg, 16px);
  background: var(--v64-error-container, rgba(var(--v-theme-error), 0.12));
  color: rgb(var(--v-theme-on-surface));
}
.vibe64-training-visual__error p { flex: 1 1 12rem; min-width: 0; }
.vibe64-training-visual__error-icon { flex: 0 0 auto; width: 24px; height: 24px; fill: rgb(var(--v-theme-error)); }
.vibe64-training-visual__error .v-btn { letter-spacing: 0; text-transform: none; }
@keyframes vibe64-training-visual-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .vibe64-training-visual__frame { animation: none; } }
</style>
