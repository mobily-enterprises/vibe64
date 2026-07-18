<template>
  <v-dialog
    :aria-labelledby="titleId"
    :model-value="open"
    max-width="480"
    persistent
    @update:model-value="updateOpen"
  >
    <v-card class="studio-ai-source-safety-dialog">
      <v-card-title :id="titleId" class="studio-ai-source-safety-dialog__title">
        <v-icon :icon="mdiSourceCommit" color="warning" />
        {{ title }}
      </v-card-title>

      <v-card-text>
        <p class="text-body-2 mb-3">
          {{ sourceSafetyStatusSummary(sourceSafety) }}.
        </p>
        <p class="text-body-2 mb-2">
          Vibe64 will send an independent prompt asking the assistant to {{ action }} all current
          session work.
        </p>
        <p class="text-body-2 text-medium-emphasis mb-3">
          This will not advance or otherwise change the workflow.
        </p>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Session: <strong>{{ sessionLabel }}</strong>
        </p>

        <v-alert
          v-if="sourceSafety.promptError"
          class="mt-4"
          density="compact"
          type="error"
          variant="tonal"
        >
          {{ sourceSafety.promptError }}
        </v-alert>
      </v-card-text>

      <v-card-actions class="studio-ai-source-safety-dialog__actions">
        <v-btn
          :disabled="sourceSafety.prompting"
          variant="text"
          @click="emit('cancel')"
        >
          Cancel
        </v-btn>
        <v-btn
          v-if="hasUncommittedChanges"
          :disabled="sourceSafety.prompting"
          variant="text"
          @click="emit('view-changes')"
        >
          View changes
        </v-btn>
        <v-btn
          color="warning"
          :disabled="sourceSafety.prompting || sourceSafety.promptSent"
          :loading="sourceSafety.prompting"
          variant="flat"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, useId } from "vue";
import { mdiSourceCommit } from "@mdi/js";
import {
  sourceSafetyHasUncommittedChanges,
  sourceSafetyRequiresPush,
  sourceSafetyStatusSummary
} from "@/lib/vibe64SessionSourceSafety.js";

const props = defineProps({
  open: {
    default: false,
    type: Boolean
  },
  sessionLabel: {
    default: "",
    type: String
  },
  sourceSafety: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits(["cancel", "confirm", "view-changes"]);
const titleId = `vibe64-source-safety-dialog-${useId()}`;
const hasUncommittedChanges = computed(() => sourceSafetyHasUncommittedChanges(props.sourceSafety));
const requiresPush = computed(() => sourceSafetyRequiresPush(props.sourceSafety));
const action = computed(() => requiresPush.value ? "commit and push" : "commit");
const title = computed(() => requiresPush.value ? "Commit and push this work?" : "Commit this work?");
const confirmLabel = computed(() => requiresPush.value ? "Commit and push" : "Commit");

function updateOpen(open) {
  if (open !== true) {
    emit("cancel");
  }
}
</script>

<style scoped>
.studio-ai-source-safety-dialog {
  border: 1px solid rgba(var(--v-theme-warning), 0.34);
}

.studio-ai-source-safety-dialog__title,
.studio-ai-source-safety-dialog__actions {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.studio-ai-source-safety-dialog__actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}
</style>
