<template>
  <div
    class="studio-session-renewal__progress-copy"
    :aria-live="refreshError ? 'off' : 'polite'"
    role="status"
  >
    <strong class="text-title-small">{{ stageLabel }}</strong>
    <span class="text-body-small">You can close this window. Progress is saved and will resume safely.</span>
  </div>
  <v-progress-linear
    aria-label="Session renewal in progress"
    class="studio-session-renewal__progress-line"
    color="primary"
    :indeterminate="!refreshError"
    :model-value="refreshError ? renewalProgress : undefined"
    rounded
  />
  <ol aria-label="Session renewal progress" class="studio-session-renewal__steps text-body-medium">
    <li
      v-for="step in steps"
      :key="step.id"
      :aria-current="step.state === 'active' ? 'step' : undefined"
      :class="[
        `studio-session-renewal__step--${step.state}`,
        { 'font-weight-medium': step.state === 'active' }
      ]"
    >
      <span class="studio-session-renewal__step-icon" aria-hidden="true">
        <v-icon
          :icon="step.state === 'complete' ? '$check' : step.state === 'active' ? '$clockLoaderHalf' : '$circle'"
          size="18"
        />
      </span>
      <span>{{ step.label }}</span>
      <span class="d-sr-only">{{ stepStateLabel(step.state) }}</span>
    </li>
  </ol>
</template>

<script setup>
// A running renewal's stage and steps. A stale snapshot shows a fixed progress bar instead of motion.
import { computed } from "vue";

const props = defineProps({
  refreshError: {
    default: "",
    type: String
  },
  stageLabel: {
    default: "",
    type: String
  },
  steps: {
    default: () => [],
    type: Array
  }
});

const renewalProgress = computed(() => {
  const steps = Array.isArray(props.steps) ? props.steps : [];
  if (!steps.length) {
    return 0;
  }
  const completed = steps.reduce((value, step) => (
    value + (step.state === "complete" ? 1 : step.state === "active" ? 0.5 : 0)
  ), 0);
  return Math.round((completed / steps.length) * 100);
});

function stepStateLabel(state = "") {
  return ({
    active: "Current step",
    complete: "Complete",
    pending: "Not started"
  })[String(state || "")] || "";
}
</script>

<style scoped>
.studio-session-renewal__progress-copy {
  align-items: flex-start;
  display: grid;
  gap: 0.25rem;
}

.studio-session-renewal__progress-copy span {
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.studio-session-renewal__progress-line {
  margin-block: 0.1rem 0.25rem;
}

.studio-session-renewal__steps {
  display: grid;
  gap: 0.35rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.studio-session-renewal__steps li {
  align-items: center;
  border-radius: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.58);
  display: flex;
  gap: 0.7rem;
  min-height: 2.75rem;
  padding: 0.55rem 0.7rem;
}

.studio-session-renewal__step--active {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-on-surface));
}

.studio-session-renewal__step--complete {
  color: rgb(var(--v-theme-primary));
}

.studio-session-renewal__step-icon {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
  width: 1.25rem;
}

@media (prefers-reduced-motion: reduce) {
  .studio-session-renewal__progress-line {
    display: none;
  }
}
</style>
