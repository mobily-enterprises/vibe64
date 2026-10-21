<script setup>
import { computed } from "vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

defineOptions({ inheritAttrs: false });

// The L plate: switches between Develop and Learn. It is shown only where a
// host has a signed-in Learning overlay bound to it. In Learn mode the plate
// is solid; the project selector beside it names the lesson and holds Courses.
const learning = useVibe64Learning();
const available = computed(() => Boolean(learning?.state.actorKey));
const learn = computed(() => Boolean(learning?.learnMode));
const switching = computed(() => learning?.state.modeBusy === "set");
const title = computed(() => learn.value ? "Back to Develop (your projects)" : "Switch to Learn");
</script>

<template>
  <v-btn
    v-if="available"
    v-bind="$attrs"
    class="vibe64-learning-button"
    :class="{ 'vibe64-learning-button--active': learn }"
    aria-label="Learn mode"
    :aria-pressed="learn"
    :title="title"
    data-vibe64-guide="learning"
    density="comfortable"
    icon
    size="small"
    :disabled="switching"
    :variant="learn ? 'flat' : 'outlined'"
    @click="learning.toggleMode()"
  >
    <span aria-hidden="true">L</span>
  </v-btn>
</template>

<style scoped>
/* The L plate: a quiet outlined plate that warms up on hover; in Learn mode it
   is a solid yellow learner plate with a crisp ink edge, a soft glow and a small
   pop. Same footprint as the neighbouring header icon buttons. */
.vibe64-learning-button {
  --v64-plate-ink: #1d1600;
  background: var(--v64-surface-container-low) !important;
  border: 1.5px solid var(--v64-outline) !important;
  border-radius: var(--v64-shape-sm);
  color: var(--v64-on-surface-variant) !important;
  flex: 0 0 auto;
  font-family: system-ui, sans-serif;
  font-size: 1.05rem;
  font-weight: 850;
  line-height: 1;
  margin-left: var(--v64-space-3);
  position: relative;
  transition:
    background-color var(--v64-duration-short) var(--v64-ease-standard),
    border-color var(--v64-duration-short) var(--v64-ease-standard),
    box-shadow var(--v64-duration-medium) var(--v64-ease-standard),
    color var(--v64-duration-short) var(--v64-ease-standard),
    transform var(--v64-duration-short) var(--v64-ease-standard);
}

@media (hover: hover) {
  .vibe64-learning-button:hover {
    background: var(--v64-learning-container) !important;
    border-color: var(--v64-learning-strong) !important;
    color: var(--v64-on-learning-container) !important;
  }
}

.vibe64-learning-button:active {
  transform: scale(0.94);
}

.vibe64-learning-button--active,
.vibe64-learning-button--active:hover {
  animation: vibe64-learning-button-pop var(--v64-duration-long) var(--v64-ease-emphasized-decelerate);
  background: linear-gradient(150deg, #ffe680 0%, var(--v64-learning) 55%, #f0b400 100%) !important;
  border-color: var(--v64-plate-ink) !important;
  box-shadow: 0 0 0 3px var(--v64-learning-glow), var(--v64-elevation-1);
  color: var(--v64-plate-ink) !important;
}

.vibe64-learning-button:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: 3px;
}

@keyframes vibe64-learning-button-pop {
  0% { transform: scale(0.82) rotate(-8deg); }
  60% { transform: scale(1.08) rotate(2deg); }
  100% { transform: scale(1) rotate(0); }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-learning-button,
  .vibe64-learning-button--active {
    animation: none;
    transition: none;
  }
}

@media (max-width: 600px) {
  /* 40px touch target on phones. */
  .vibe64-learning-button {
    height: 2.5rem;
    margin-left: var(--v64-space-1);
    width: 2.5rem;
  }
}
</style>
