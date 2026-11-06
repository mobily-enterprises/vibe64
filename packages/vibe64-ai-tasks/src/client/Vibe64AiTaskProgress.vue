<template>
  <div class="ai-task-progress">
    <ol class="ai-task-progress__steps">
      <li
        v-for="step in projection.steps"
        :key="step.label"
        class="ai-task-progress__step"
        :class="`ai-task-progress__step--${step.state}`"
      >
        <v-icon :icon="stepIcons[step.state]" size="18" aria-hidden="true" />
        <span class="ai-task-progress__label">{{ step.label }}</span>
        <span v-if="step.attempt" class="ai-task-progress__attempt">{{ step.attempt }}</span>
      </li>
    </ol>

    <p v-if="projection.note" class="ai-task-progress__note">{{ projection.note }}</p>

    <details v-if="$slots['check-output'] && output" class="ai-task-progress__output">
      <summary>{{ task.check.output }}</summary>
      <slot name="check-output" />
    </details>

    <section class="ai-task-progress__activity" :aria-label="WORDS.progress.activity">
      <h3 class="ai-task-progress__heading">{{ WORDS.progress.activity }}</h3>
      <ol>
        <li v-for="entry in activity" :key="`${entry.at}:${entry.text}`">
          <time :datetime="entry.at">{{ aiTaskTime(entry.at) }}</time>
          <span>{{ entry.text }}</span>
        </li>
      </ol>
    </section>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { AI_TASK_MESSAGES as WORDS } from "./aiTaskMessages.js";
import { aiTaskTime } from "./aiTaskProjection.js";

const props = defineProps({
  task: {
    required: true,
    type: /** @type {import("vue").PropType<import("./types.js").AiTask>} */ (Object)
  },
  projection: {
    required: true,
    type: /** @type {import("vue").PropType<import("./types.js").AiTaskProjection>} */ (Object)
  },
  output: {
    required: true,
    type: Boolean
  },
  // What the AI has said about its work, beside what Vibe64 recorded.
  commentary: {
    required: true,
    type: /** @type {import("vue").PropType<{ at: string, text: string }[]>} */ (Array)
  }
});

const stepIcons = {
  active: "$radioOn",
  done: "$checkCircleFilled",
  failed: "$cancel",
  pending: "$circle"
};
// The newest line sits at the bottom, where the eye is when watching a run.
const activity = computed(() => [...props.task.log, ...props.commentary].sort((a, b) => a.at.localeCompare(b.at)));
</script>

<style scoped>
.ai-task-progress {
  display: grid;
  gap: 1rem;
  align-content: start;
  height: 100%;
  overflow-y: auto;
  padding: 1rem 1.25rem;
  overscroll-behavior: contain;
}

.ai-task-progress__steps {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.ai-task-progress__step {
  align-items: center;
  column-gap: 0.625rem;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.ai-task-progress__step--pending { color: rgba(var(--v-theme-on-surface), 0.6); }
.ai-task-progress__step--active { color: rgb(var(--v-theme-primary)); font-weight: 600; }
.ai-task-progress__step--done .v-icon { color: rgb(var(--v-theme-success)); }
.ai-task-progress__step--failed .v-icon { color: rgb(var(--v-theme-error)); }

.ai-task-progress__label {
  color: rgb(var(--v-theme-on-surface));
  overflow-wrap: anywhere;
}

.ai-task-progress__step--pending .ai-task-progress__label { color: inherit; }

.ai-task-progress__attempt {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.8125rem;
  font-weight: 400;
  white-space: nowrap;
}

.ai-task-progress__note {
  margin: 0;
  overflow-wrap: anywhere;
}

.ai-task-progress__output summary {
  align-items: center;
  cursor: pointer;
  display: flex;
  font-weight: 600;
  min-height: var(--ai-task-target, 2.5rem);
}

.ai-task-progress__heading {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  margin: 0 0 0.375rem;
}

.ai-task-progress__activity ol {
  display: grid;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.ai-task-progress__activity li {
  column-gap: 0.75rem;
  display: grid;
  font-size: 0.875rem;
  grid-template-columns: auto minmax(0, 1fr);
}

.ai-task-progress__activity time {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-variant-numeric: tabular-nums;
}

.ai-task-progress__activity span {
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  display: -webkit-box;
  line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;
}

@container ai-task (max-width: 30rem) {
  .ai-task-progress { padding: 0.75rem 1rem; }

  .ai-task-progress__step { grid-template-columns: auto minmax(0, 1fr); }

  .ai-task-progress__attempt {
    grid-column: 2;
    white-space: normal;
  }
}
</style>
