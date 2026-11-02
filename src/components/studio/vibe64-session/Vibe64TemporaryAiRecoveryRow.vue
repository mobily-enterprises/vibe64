<template>
  <div class="vibe64-temporary-ai__recovery-row">
    <v-alert v-if="props.restoreError" type="error" variant="tonal" density="compact">
      {{ props.restoreError }}
      <v-btn color="error" variant="text" height="48" @click="emit('retry-restore')">Try again</v-btn>
    </v-alert>
    <div
      v-if="props.activeTask?.recoveryNotice && !props.recoveryVerified && !props.connectionUnavailable"
      aria-live="polite"
      class="vibe64-temporary-ai__recovery"
      data-temporary-ai-recovery
      role="status"
    >
      <div class="vibe64-temporary-ai__recovery-summary">
        <strong>{{ activeTaskRecoveryTitle }}</strong>
        <details v-if="activeTaskRecoveryStatus && !props.activeTask.busy">
          <summary>Details</summary>
          <p>{{ activeTaskRecoveryStatus }}</p>
        </details>
      </div>
      <v-btn
        v-if="props.activeTask.recoveryOperation === 'update' && !props.recoveryVerified"
        class="vibe64-temporary-ai__check-update"
        data-temporary-ai-check-update
        :disabled="props.updateDisabled || props.inputDisabled || props.activeTask.busy || props.activeTask.recoveryOutcome === 'unconfirmed'"
        :loading="props.recoveryChecking"
        :title="props.updateDisabled ? props.updateDisabledReason : 'Check whether the repaired session can update'"
        size="small"
        variant="tonal"
        @click="emit('check-update', props.activeTask)"
      >
        Check Update
      </v-btn>
      <v-btn
        v-if="props.activeTask.recoveryOperation === 'update' && !props.recoveryVerified && props.canReviewUpdate"
        class="vibe64-temporary-ai__check-update"
        data-temporary-ai-review-update
        :disabled="props.updateDisabled || props.inputDisabled || props.activeTask.busy || props.activeTask.recoveryOutcome === 'unconfirmed'"
        size="small" variant="tonal"
        @click="emit('review-update')"
      >
        Review resolved conflicts
      </v-btn>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

// The temporary AI workspace's notices above the conversation: a saved-chat
// list that could not be restored, and the active repair's progress with its
// Check Update and review actions.
const emit = defineEmits(["retry-restore", "check-update", "review-update"]);
const props = defineProps({
  activeTask: { type: Object, default: null },
  restoreError: { type: String, default: "" },
  recoveryVerified: Boolean,
  recoveryChecking: Boolean,
  // The active task cannot take input now (busy repository, closing, or no access).
  inputDisabled: Boolean,
  connectionUnavailable: Boolean,
  updateDisabled: Boolean,
  updateDisabledReason: { type: String, default: "" },
  canReviewUpdate: Boolean
});

const activeTaskRecoveryTitle = computed(() => {
  if (props.recoveryChecking) {
    return "Checking Update…";
  }
  const status = String(props.activeTask?.status || "").trim();
  if (["starting", "inProgress"].includes(status)) {
    return "AI repair in progress";
  }
  if (props.activeTask?.recoveryOutcome === "failed") {
    return "Update needs attention";
  }
  if (props.activeTask?.recoveryOutcome === "unconfirmed") {
    return "Update result not confirmed";
  }
  if (props.activeTask?.recoveryOperation === "update") {
    return "Update not yet verified";
  }
  if (props.activeTask?.outcomeKind === "continue") {
    return "Waiting for your reply";
  }
  if (status === "completed") {
    return "AI repair finished";
  }
  if (status === "failed") {
    return "AI repair needs attention";
  }
  if (status === "interrupted") {
    return "AI repair stopped";
  }
  return "AI repair";
});
const activeTaskRecoveryStatus = computed(() => {
  const task = props.activeTask || {};
  if (task.recoveryOutcome === "checking") {
    return "";
  }
  if (task.recoveryOperation === "update" && props.updateDisabled && props.updateDisabledReason) {
    return props.updateDisabledReason;
  }
  if (task.recoveryOutcome === "failed") {
    return task.recoveryAutoPaused
      ? "Automatic repair paused after repeated conflicts. Continue here or check Update again. Main chat has the latest Update diagnostic."
      : "The Update check did not succeed. Continue this repair or check Update again. Main chat has the latest Update diagnostic.";
  }
  if (task.recoveryOutcome === "unconfirmed") {
    return task.recoveryOutcomeMessage || "Vibe64 could not confirm this Update result. Check the current session before trying again.";
  }
  if (task.recoveryOperation === "update" && task.outcomeKind === "continue") {
    return "Reply if a decision is needed, or use Check Update to verify the prepared edits.";
  }
  if (task.outcomeKind === "continue") {
    return "";
  }
  const status = String(task.status || "").trim();
  if (status === "completed") {
    return task.completionMessage || "Temporary AI finished. Review its result below.";
  }
  if (status === "failed") {
    return task.failureMessage || "Temporary AI stopped before it could confirm the repair. Review the error and progress below.";
  }
  if (status === "interrupted") {
    return task.recoveryOperation === "update"
      ? "You stopped this repair. Partial edits remain and Update still needs to succeed. You can continue the repair here."
      : "You stopped this repair. You can continue in this temporary chat or return to Main chat.";
  }
  return task.nextStepMessage || "Follow progress here and reply below if Temporary AI needs a decision.";
});
</script>

<style scoped>
.vibe64-temporary-ai__recovery {
  align-items: start;
  display: flex;
  flex-wrap: wrap;
  font-size: 0.85rem;
  gap: 0.5rem;
  overflow-wrap: anywhere;
  padding: 0.4rem;
}

.vibe64-temporary-ai__recovery-row:not(:empty) {
  max-height: min(20dvh, 8rem);
  overflow-y: auto;
  padding: 0.35rem 0.55rem 0;
}

.vibe64-temporary-ai__recovery-summary {
  flex: 1;
  min-width: 0;
}

.vibe64-temporary-ai__recovery strong {
  font-size: 0.95rem;
  line-height: 1.4;
}

.vibe64-temporary-ai__recovery summary {
  cursor: pointer;
}

.vibe64-temporary-ai__check-update {
  flex: 0 0 auto;
}

.vibe64-temporary-ai__recovery p {
  margin: 0;
}

.vibe64-temporary-ai__recovery p + p {
  margin-top: 0.3rem;
}

@media (pointer: coarse) {
  .vibe64-temporary-ai__check-update {
    min-height: 3rem !important;
    min-width: 3rem !important;
  }
}
</style>
