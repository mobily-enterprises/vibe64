<template>
  <v-dialog
    :model-value="modelValue"
    max-width="min(94vw, 72rem)"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="studio-issue-session-diff">
      <v-card-title class="studio-issue-session-diff__title">
        <span>Review changes</span>
        <v-chip
          v-if="payload"
          :color="payload.hasChanges ? 'primary' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ payload.hasChanges ? "Changes found" : "No changes" }}
        </v-chip>
      </v-card-title>
      <v-card-text
        ref="bodyElement"
        class="studio-issue-session-diff__body"
        @click="emit('body-click', $event)"
      >
        <StudioErrorNotice
          v-if="error"
          title="Diff inspection failed"
          :error="error"
          compact
          class="mb-3"
        />
        <v-progress-linear v-if="loading" color="primary" indeterminate class="mb-3" />
        <pre v-if="payload?.gitStatus" class="studio-issue-session-diff__status">{{ payload.gitStatus }}</pre>
        <!-- eslint-disable-next-line vue/no-v-html -- Diff2Html escapes git diff content before rendering. -->
        <div v-if="renderedDiff" class="studio-issue-session-diff__rendered" v-html="renderedDiff" />
        <v-alert v-else-if="!loading && !error" type="info" variant="tonal">
          No diff is available for this session worktree.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('close')">Close</v-btn>
        <v-btn
          v-if="showAccept"
          color="primary"
          variant="flat"
          :disabled="!payload?.hasChanges || loading"
          :loading="busy"
          @click="emit('accept')"
        >
          {{ acceptLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref } from "vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";

defineProps({
  acceptLabel: {
    default: "Accept changes",
    type: String
  },
  busy: {
    default: false,
    type: Boolean
  },
  error: {
    default: "",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  modelValue: {
    default: false,
    type: Boolean
  },
  payload: {
    default: null,
    type: Object
  },
  renderedDiff: {
    default: "",
    type: String
  },
  showAccept: {
    default: false,
    type: Boolean
  }
});

const emit = defineEmits(["accept", "body-click", "close", "update:modelValue"]);
const bodyElement = ref(null);

defineExpose({
  bodyElement
});
</script>

<style scoped>
.studio-issue-session-diff {
  max-height: 90vh;
}

.studio-issue-session-diff__title {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.studio-issue-session-diff__body {
  max-height: 72vh;
  overflow-x: hidden;
  overflow-y: auto;
}

.studio-issue-session-diff__status {
  background: rgba(var(--v-theme-surface-variant), 0.55);
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.35;
  margin: 0 0 0.75rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}

.studio-issue-session-diff__rendered {
  min-width: 0;
  overflow-x: hidden;
}

.studio-issue-session-diff__rendered :deep(.d2h-wrapper) {
  color: #1f2937;
}

.studio-issue-session-diff__rendered :deep(.d2h-file-wrapper) {
  border-color: rgba(var(--v-border-color), 0.34);
  border-radius: 8px;
  margin-bottom: 0.75rem;
}

.studio-issue-session-diff__rendered :deep(.d2h-file-header) {
  border-radius: 8px 8px 0 0;
}

.studio-issue-session-diff__rendered :deep(.d2h-files-diff),
.studio-issue-session-diff__rendered :deep(.d2h-file-side-diff) {
  min-width: 0;
}

.studio-issue-session-diff__rendered :deep(.d2h-file-side-diff) {
  overflow-x: auto;
}
</style>
