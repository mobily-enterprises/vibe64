<template>
  <button
    :aria-label="`${tasks.task.title}: ${tasks.projection.tray}`"
    class="vibe64-ai-task-tray"
    :class="`vibe64-ai-task-tray--${tasks.projection.glyph}`"
    data-vibe64-ai-task-tray
    :title="tasks.projection.tray"
    type="button"
    @click="tasks.show($event.currentTarget)"
  >
    <v-progress-circular v-if="tasks.projection.glyph === 'working'" indeterminate size="16" width="2" aria-hidden="true" />
    <v-icon v-else :icon="glyphIcons[tasks.projection.glyph]" size="18" aria-hidden="true" />
    <span class="vibe64-ai-task-tray__label">{{ tasks.projection.tray }}</span>
  </button>
</template>

<script setup>
import { inject } from "vue";
import { VIBE64_AI_TASKS_KEY } from "./aiTaskKey.js";

const tasks = /** @type {import("./useAiTaskHost.js").AiTaskHost} */ (inject(VIBE64_AI_TASKS_KEY));
const glyphIcons = {
  attention: "$errorFilled",
  done: "$checkCircleFilled",
  "not-done": "$cancel",
  turn: "$circle"
};
</script>

<style scoped>
.vibe64-ai-task-tray {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.12);
  border: 0;
  border-radius: 999px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: inline-flex;
  flex: 0 1 auto;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  gap: 0.375rem;
  height: 2rem;
  margin-inline-end: 0.25rem;
  max-width: 12rem;
  min-width: 0;
  padding-inline: 0.625rem 0.75rem;
}

.vibe64-ai-task-tray:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.vibe64-ai-task-tray__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-ai-task-tray--working .v-progress-circular { color: rgb(var(--v-theme-primary)); }
.vibe64-ai-task-tray--attention { background: rgba(var(--v-theme-warning), 0.2); }
.vibe64-ai-task-tray--attention .v-icon { color: rgb(var(--v-theme-warning)); }
.vibe64-ai-task-tray--done { background: rgba(var(--v-theme-success), 0.16); }
.vibe64-ai-task-tray--done .v-icon { color: rgb(var(--v-theme-success)); }
.vibe64-ai-task-tray--not-done { background: rgba(var(--v-theme-error), 0.14); }
.vibe64-ai-task-tray--not-done .v-icon { color: rgb(var(--v-theme-error)); }

/* A phone's app bar has no room for words: the same colours, on a full touch target. */
@media (max-width: 599px) {
  .vibe64-ai-task-tray {
    height: 3rem;
    justify-content: center;
    margin-inline-end: 0;
    padding-inline: 0;
    width: 3rem;
  }

  .vibe64-ai-task-tray__label { display: none; }
}

@media (pointer: coarse) {
  .vibe64-ai-task-tray { min-height: 3rem; }
}
</style>
