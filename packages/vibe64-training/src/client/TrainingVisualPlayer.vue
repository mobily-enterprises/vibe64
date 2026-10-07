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
  <section class="vibe64-training-visual" :aria-label="title">
    <div class="vibe64-training-visual__canvas">
      <iframe ref="frame" :title="title" sandbox="allow-scripts" referrerpolicy="no-referrer" />
      <v-skeleton-loader v-if="state.phase === 'loading'" type="image" class="vibe64-training-visual__loading" />
    </div>
    <p class="text-body-medium" role="status">{{ state.description }}</p>
    <div v-if="state.error" class="vibe64-training-visual__error" role="alert">
      <p class="text-body-medium">{{ state.error }}</p>
      <v-btn min-height="48" variant="tonal" @click="reload">Reload diagram</v-btn>
    </div>
  </section>
</template>

<style scoped>
.vibe64-training-visual { min-width: 0; }
.vibe64-training-visual__canvas { position: relative; }
.vibe64-training-visual iframe { display: block; width: 100%; height: min(60vh, 32rem); min-height: 16rem; border: 0; }
.vibe64-training-visual__loading { position: absolute; inset: 0; }
.vibe64-training-visual p { margin: 8px 0; overflow-wrap: anywhere; }
.vibe64-training-visual__error { color: rgb(var(--v-theme-error)); }
</style>
