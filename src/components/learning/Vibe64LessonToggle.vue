<script setup>
import { computed } from "vue";
import { mdiCheck, mdiSchoolOutline } from "@mdi/js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// The Lesson toggle: the lesson's own on/off switch, apart from the project's
// Preview | Dash choice. Off it is an outlined pill with its little switch
// off; on it is filled Learning yellow with the switch on (a check), and
// pressing it again hides the lesson (the Preview or Dash it covered is still
// there, as it was). It sits beside Preview | Dash on a practice project and
// on the step bar of a studio page or a phone.
const learning = useVibe64Learning();
const shown = computed(() => Boolean(learning?.lessonShown));
const action = computed(() => shown.value ? "Hide lesson" : "Show lesson");
</script>

<template>
  <v-tooltip v-if="learning" :text="action" location="bottom">
    <template #activator="{ props: tooltipProps }">
      <button
        v-bind="tooltipProps"
        class="vibe64-lesson-toggle"
        :class="{ 'is-on': shown }"
        type="button"
        aria-label="Lesson"
        :aria-pressed="shown ? 'true' : 'false'"
        :aria-description="action"
        data-test="lesson-toggle"
        data-vibe64-guide="lesson"
        @click="learning.toggleLesson()"
      >
        <v-icon class="vibe64-lesson-toggle__icon" :icon="mdiSchoolOutline" size="18" />
        <span class="vibe64-lesson-toggle__label">Lesson</span>
        <span class="vibe64-lesson-toggle__switch" aria-hidden="true">
          <span class="vibe64-lesson-toggle__thumb"><v-icon v-if="shown" :icon="mdiCheck" size="10" /></span>
        </span>
      </button>
    </template>
  </v-tooltip>
</template>

<style scoped>
/* A Material 3 toggle (filter-chip shape): outlined off, filled with a check
   on. Learning yellow keeps "on" obvious in light and dark. */
.vibe64-lesson-toggle {
  align-items: center;
  background: transparent;
  border: 1px solid var(--v64-outline, rgba(127, 127, 127, 0.6));
  border-radius: var(--v64-shape-full, 999px);
  color: var(--v64-on-surface, inherit);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  gap: 6px;
  height: 32px;
  padding: 0 10px 0 8px;
  position: relative;
  transition: background-color 120ms ease, border-color 120ms ease;
  white-space: nowrap;
}
.vibe64-lesson-toggle::before {
  background: currentColor;
  border-radius: inherit;
  content: "";
  inset: 0;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  transition: opacity 120ms ease;
}
.vibe64-lesson-toggle:hover::before { opacity: 0.08; }
.vibe64-lesson-toggle:focus-visible { outline: 2px solid var(--v64-primary, currentColor); outline-offset: 2px; }
.vibe64-lesson-toggle.is-on {
  background: var(--v64-learning, #f5c518);
  border-color: var(--v64-learning-strong, #f5c518);
  color: var(--v64-on-learning, #2b2100);
  font-weight: 700;
}
/* The little Material switch: track and thumb, off left, on right with a check. */
.vibe64-lesson-toggle__switch {
  background: color-mix(in srgb, currentColor 14%, transparent);
  border: 1.5px solid currentColor;
  border-radius: 999px;
  box-sizing: border-box;
  display: inline-block;
  flex: 0 0 auto;
  height: 16px;
  opacity: 0.75;
  position: relative;
  width: 28px;
}
.vibe64-lesson-toggle__thumb {
  align-items: center;
  background: currentColor;
  border-radius: 50%;
  display: flex;
  height: 8px;
  justify-content: center;
  left: 2.5px;
  position: absolute;
  top: 2.5px;
  transition: left 120ms ease, width 120ms ease, height 120ms ease, top 120ms ease;
  width: 8px;
}
.vibe64-lesson-toggle.is-on .vibe64-lesson-toggle__switch {
  background: var(--v64-on-learning, #2b2100);
  border-color: var(--v64-on-learning, #2b2100);
  opacity: 1;
}
.vibe64-lesson-toggle.is-on .vibe64-lesson-toggle__thumb {
  background: var(--v64-learning, #f5c518);
  color: var(--v64-on-learning, #2b2100);
  height: 11px;
  left: 13px;
  top: 1px;
  width: 11px;
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-lesson-toggle, .vibe64-lesson-toggle::before, .vibe64-lesson-toggle__thumb { transition: none; }
}
</style>
