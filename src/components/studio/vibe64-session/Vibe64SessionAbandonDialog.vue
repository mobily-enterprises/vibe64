<template>
  <v-dialog
    aria-labelledby="vibe64-session-abandon-dialog-title"
    :model-value="abandon.open"
    max-width="620"
    persistent
    @update:model-value="updateOpen"
  >
    <v-card class="studio-ai-session-abandon-dialog">
      <v-card-title
        id="vibe64-session-abandon-dialog-title"
        class="studio-ai-session-abandon-dialog__title"
      >
        <v-icon
          :icon="unsafeWork ? mdiAlertOctagonOutline : mdiAlertCircleOutline"
          :color="unsafeWork ? 'error' : 'warning'"
        />
        Abandon session?
      </v-card-title>
      <v-card-text>
        <section
          v-if="unsafeWork"
          class="studio-ai-session-abandon-dialog__danger mb-4"
          role="alert"
        >
          <v-icon :icon="mdiAlertOctagonOutline" size="34" />
          <div>
            <strong>{{ unsafeWorkTitle }}</strong>
            <p>{{ unsafeWorkMessage }}</p>
            <v-btn
              class="mt-3"
              color="error"
              :disabled="sourceSafety.prompting || sourceSafety.promptSent"
              :loading="sourceSafety.prompting"
              :prepend-icon="mdiSourceCommit"
              size="small"
              variant="flat"
              @click="protectWork"
            >
              {{ protectWorkLabel }} instead
            </v-btn>
            <p
              v-if="sourceSafety.promptError"
              class="studio-ai-session-abandon-dialog__prompt-error mt-2"
            >
              {{ sourceSafety.promptError }}
            </p>
          </div>
        </section>

        <v-alert
          v-else-if="sourceSafety.error"
          class="mb-4"
          color="warning"
          density="compact"
          :icon="mdiAlertCircleOutline"
          variant="tonal"
        >
          Vibe64 could not verify whether this session's work is safely stored:
          {{ sourceSafety.error }}
        </v-alert>

        <div
          v-else-if="sourceSafety.loading"
          class="studio-ai-session-abandon-dialog__checking mb-4"
          role="status"
        >
          <v-progress-circular indeterminate size="18" width="2" />
          Checking whether this session has uncommitted or unpushed work…
        </div>

        <p class="text-body-2 mb-2">
          This will mark the session as abandoned and close its terminals.
        </p>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Session:
          <strong>{{ abandon.sessionTitle || shortSessionId(abandon.sessionId) }}</strong>
        </p>
      </v-card-text>
      <v-card-actions class="studio-ai-session-abandon-dialog__actions">
        <v-btn
          variant="text"
          :disabled="abandon.command.isRunning || sourceSafety.prompting"
          @click="abandon.cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          :color="unsafeWork ? 'error' : 'warning'"
          :disabled="sourceSafety.loading || sourceSafety.prompting"
          variant="flat"
          :loading="abandon.command.isRunning"
          @click="abandon.confirm"
        >
          {{ unsafeWork ? "Abandon anyway" : "Abandon session" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiAlertCircleOutline,
  mdiAlertOctagonOutline,
  mdiSourceCommit
} from "@mdi/js";
import {
  sourceSafetyButtonLabel,
  sourceSafetyDialogMessage,
  sourceSafetyDialogTitle,
  sourceSafetyIsUnsafe
} from "@/lib/vibe64SessionSourceSafety.js";

const props = defineProps({
  abandon: {
    default: () => ({}),
    type: Object
  },
  shortSessionId: {
    default: (sessionId) => String(sessionId || ""),
    type: Function
  }
});

function updateOpen(open) {
  if (open !== true) {
    props.abandon.cancel();
  }
}

const sourceSafety = computed(() => props.abandon.sourceSafety || {});
const unsafeWork = computed(() => sourceSafetyIsUnsafe(sourceSafety.value));
const unsafeWorkTitle = computed(() => sourceSafetyDialogTitle(sourceSafety.value));
const unsafeWorkMessage = computed(() => sourceSafetyDialogMessage(sourceSafety.value));
const protectWorkLabel = computed(() => sourceSafetyButtonLabel(sourceSafety.value));
async function protectWork() {
  const accepted = await sourceSafety.value.prompt?.();
  if (accepted) {
    props.abandon.cancel();
  }
}
</script>

<style scoped>
.studio-ai-session-abandon-dialog {
  border: 1px solid rgba(var(--v-theme-warning), 0.32);
}

.studio-ai-session-abandon-dialog__title,
.studio-ai-session-abandon-dialog__actions {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.studio-ai-session-abandon-dialog__danger {
  align-items: flex-start;
  background:
    linear-gradient(135deg, rgba(var(--v-theme-error), 0.2), rgba(var(--v-theme-error), 0.08));
  border: 2px solid rgb(var(--v-theme-error));
  border-radius: 12px;
  box-shadow: 0 0.45rem 1.3rem rgba(var(--v-theme-error), 0.18);
  color: rgb(var(--v-theme-error));
  display: grid;
  gap: 0.85rem;
  grid-template-columns: auto minmax(0, 1fr);
  padding: 1rem;
}

.studio-ai-session-abandon-dialog__danger strong {
  display: block;
  font-size: 1.08rem;
  line-height: 1.25;
}

.studio-ai-session-abandon-dialog__danger p {
  color: rgb(var(--v-theme-on-surface));
  line-height: 1.45;
  margin: 0.4rem 0 0;
}

.studio-ai-session-abandon-dialog__danger .studio-ai-session-abandon-dialog__prompt-error {
  color: rgb(var(--v-theme-error));
  font-size: 0.78rem;
  font-weight: 650;
}

.studio-ai-session-abandon-dialog__checking {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: flex;
  font-size: 0.86rem;
  gap: 0.55rem;
}

.studio-ai-session-abandon-dialog__actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}
</style>
