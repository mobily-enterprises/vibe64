<template>
  <div class="studio-issue-session-timeline">
    <div
      v-for="step in steps"
      :key="step.id"
      class="studio-issue-session-timeline__step"
      :class="`studio-issue-session-timeline__step--${step.state}`"
      :title="step.title || undefined"
    >
      <div class="studio-issue-session-timeline__step-icon">
        <v-icon :icon="stepIcon(step)" size="18" />
      </div>
      <div class="studio-issue-session-timeline__step-copy">
        <div class="studio-issue-session-timeline__step-title">
          <span>
            {{ step.index + 1 }}.
            {{ step.done ? "Done: " : "Goal: " }}{{ step.label }}
          </span>
          <v-btn
            v-if="step.canExpand"
            :icon="stepIsExpanded(step) ? mdiChevronUp : mdiChevronDown"
            :title="stepIsExpanded(step) ? 'Collapse step details' : 'Expand step details'"
            aria-label="Toggle completed step details"
            class="studio-issue-session-timeline__done-toggle"
            density="compact"
            size="x-small"
            variant="text"
            @click.stop="toggleStep(step)"
          />
          <v-chip
            v-for="badge in step.badges"
            :key="badge.label"
            :color="badge.color"
            :prepend-icon="badge.icon || undefined"
            size="x-small"
            :title="badge.title || undefined"
            variant="tonal"
          >
            {{ badge.label }}
          </v-chip>
        </div>
        <p
          v-if="descriptionVisible(step)"
          class="studio-issue-session-timeline__step-description"
        >
          {{ step.description }}
        </p>
        <div
          v-if="stepIsExpanded(step) && step.canRewind"
          class="studio-issue-session-timeline__done-actions"
        >
          <v-btn
            color="error"
            density="compact"
            size="small"
            variant="tonal"
            :disabled="busy"
            :prepend-icon="mdiUndoVariant"
            :title="`Rewind to ${step.rewindLabel}`"
            :aria-label="`Rewind to ${step.rewindLabel}`"
            @click="emit('rewind', step)"
          >
            Rewind here
          </v-btn>
        </div>

        <div v-if="step.current" class="studio-issue-session-timeline__step-action">
          <slot name="current-step" :step="step" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import {
  mdiAlertCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiCheckCircle,
  mdiCircleOutline,
  mdiCircleSlice8,
  mdiUndoVariant
} from "@mdi/js";

defineProps({
  busy: {
    default: false,
    type: Boolean
  },
  steps: {
    default: () => [],
    type: Array
  }
});

const emit = defineEmits(["rewind"]);
const expandedStepIds = ref({});

function stepIsExpanded(step = {}) {
  return Boolean(expandedStepIds.value[step.id]);
}

function toggleStep(step = {}) {
  if (!step.canExpand) {
    return;
  }
  expandedStepIds.value = {
    ...expandedStepIds.value,
    [step.id]: !expandedStepIds.value[step.id]
  };
}

function descriptionVisible(step = {}) {
  return Boolean((step.current || stepIsExpanded(step)) && step.description);
}

function stepIcon(step = {}) {
  if (step.state === "done") {
    return mdiCheckCircle;
  }
  if (step.state === "current") {
    return mdiCircleSlice8;
  }
  if (step.state === "blocked") {
    return mdiAlertCircle;
  }
  return mdiCircleOutline;
}
</script>

<style scoped>
.studio-issue-session-timeline {
  border: 0;
  border-radius: 0;
  overflow: visible;
  padding: 0;
}

.studio-issue-session-timeline__step {
  align-items: flex-start;
  border-radius: 6px;
  display: grid;
  gap: 0.34rem;
  grid-template-columns: 1.25rem minmax(0, 1fr);
  padding: 0.26rem 0.32rem;
  position: relative;
}

.studio-issue-session-timeline__step-icon {
  align-items: center;
  display: flex;
  height: 1.25rem;
  justify-content: center;
  padding-top: 0.02rem;
}

.studio-issue-session-timeline__step--current {
  background: rgba(var(--v-theme-primary), 0.1);
}

.studio-issue-session-timeline__step--done .studio-issue-session-timeline__step-icon {
  color: rgb(var(--v-theme-success));
}

.studio-issue-session-timeline__step--skipped .studio-issue-session-timeline__step-icon {
  color: rgb(var(--v-theme-info));
}

.studio-issue-session-timeline__step--current .studio-issue-session-timeline__step-icon {
  color: rgb(var(--v-theme-primary));
}

.studio-issue-session-timeline__step--blocked .studio-issue-session-timeline__step-icon {
  color: rgb(var(--v-theme-error));
}

.studio-issue-session-timeline__step-title {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  line-height: 1.12;
}

.studio-issue-session-timeline__step-title span {
  font-size: 0.84rem;
  font-weight: 650;
}

.studio-issue-session-timeline__done-toggle {
  color: rgba(var(--v-theme-on-surface), 0.62);
  margin-left: 0.05rem;
}

.studio-issue-session-timeline__done-toggle:hover {
  color: rgb(var(--v-theme-primary));
}

.studio-issue-session-timeline__step-title :deep(.v-chip) {
  font-size: 0.64rem;
  height: 1.15rem;
  padding-inline: 0.32rem;
}

.studio-issue-session-timeline__step-description {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.74rem;
  line-height: 1.32;
  margin: 0.14rem 0 0;
}

.studio-issue-session-timeline__step--current .studio-issue-session-timeline__step-description {
  color: rgba(var(--v-theme-on-surface), 0.82);
}

.studio-issue-session-timeline__done-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.34rem;
}

.studio-issue-session-timeline__step-action {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: grid;
  gap: 0.32rem;
  margin-top: 0.34rem;
  padding-top: 0.38rem;
}
</style>
