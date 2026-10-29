<template>
  <v-dialog
    :aria-labelledby="titleId"
    :model-value="archive.open"
    max-width="620"
    persistent
    @update:model-value="updateOpen"
  >
    <v-card class="studio-ai-session-archive-dialog">
      <v-card-title
        :id="titleId"
        class="studio-ai-session-archive-dialog__title"
      >
        <v-icon
          :icon="mdiArchiveOutline"
          color="primary"
        />
        Archive session?
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-2">
          This stops the assistant and terminals, preserves the session, and removes its active workspace.
        </p>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Session:
          <strong>{{ archive.sessionTitle || shortSessionId(archive.sessionId) }}</strong>
        </p>
        <v-alert
          v-if="workNotice"
          class="mt-3"
          density="compact"
          role="status"
          :type="workNotice.kind === 'unsaved' ? 'warning' : 'info'"
          variant="tonal"
        >
          {{ workNotice.message }}
        </v-alert>
      </v-card-text>
      <v-card-actions class="studio-ai-session-archive-dialog__actions">
        <v-btn
          variant="text"
          :disabled="archive.command.isRunning"
          @click="archive.cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="archive.command.isRunning"
          @click="archive.confirm"
        >
          {{ archive.command.isRunning ? "Archiving…" : (workNotice?.confirmLabel || "Archive session") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, useId } from "vue";
import { mdiArchiveOutline } from "@mdi/js";
import { sessionArchiveWorkNotice } from "@/lib/vibe64SessionRepositoryWorkState.js";

const props = defineProps({
  archive: {
    default: () => ({}),
    type: Object
  },
  shortSessionId: {
    default: (sessionId) => String(sessionId || ""),
    type: Function
  },
  workState: {
    default: null,
    type: Object
  }
});
const workNotice = computed(() => sessionArchiveWorkNotice(props.workState));

function updateOpen(open) {
  if (open !== true) {
    props.archive.cancel();
  }
}

const titleId = `vibe64-session-archive-dialog-${useId()}`;
</script>

<style scoped>
.studio-ai-session-archive-dialog {
  border: 1px solid rgba(var(--v-theme-primary), 0.32);
}

.studio-ai-session-archive-dialog__title,
.studio-ai-session-archive-dialog__actions {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.studio-ai-session-archive-dialog__actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}
</style>
