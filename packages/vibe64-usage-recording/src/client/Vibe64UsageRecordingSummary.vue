<script setup>
import { computed, ref, watch } from "vue";
import { mdiDeleteOutline } from "@mdi/js";
import { usageRecordingEnd } from "./usageRecordingText.js";
import { useVibe64UsageRecording } from "./useVibe64UsageRecording.js";

// One recording's line under a Recording selector: how it ended, and Delete
// after a confirmation. Emits deleted { recordingId } once the server agreed.
const props = defineProps({
  recording: { type: Object, required: true },
  sessionId: { type: String, required: true }
});
const emit = defineEmits(["deleted"]);

const { error, remove } = useVibe64UsageRecording({ sessionId: () => props.sessionId });
const ended = computed(() => usageRecordingEnd(props.recording));
const running = computed(() => ["starting", "recording", "stopping"].includes(props.recording.state));
const confirming = ref(false);
const deleting = ref(false);
const failure = ref("");
watch(() => props.recording.id, () => {
  confirming.value = false;
  failure.value = "";
});

function askToDelete() {
  failure.value = "";
  confirming.value = true;
}

async function deleteRecording() {
  const recordingId = props.recording.id;
  deleting.value = true;
  const result = await remove(recordingId);
  deleting.value = false;
  if (!result) {
    failure.value = error.value;
    return;
  }
  confirming.value = false;
  emit("deleted", { recordingId });
}
</script>

<template>
  <div class="usage-recording-summary">
    <p class="usage-recording-summary__ended">{{ ended }}</p>
    <v-btn
      class="usage-recording-summary__delete"
      :prepend-icon="mdiDeleteOutline"
      variant="text"
      @click="askToDelete"
    >
      Delete
    </v-btn>
    <v-dialog v-model="confirming" max-width="400">
      <v-card class="usage-recording-summary__dialog" rounded="xl">
        <v-card-title class="usage-recording-summary__title">Delete this recording?</v-card-title>
        <v-card-text class="usage-recording-summary__body">
          <p>
            {{ running ? "It stops first. " : "" }}Its requests and results are deleted. This can't be undone.
          </p>
          <v-alert v-if="failure" density="compact" type="error" variant="tonal">{{ failure }}</v-alert>
        </v-card-text>
        <v-card-actions class="usage-recording-summary__actions">
          <v-spacer />
          <v-btn variant="text" @click="confirming = false">Cancel</v-btn>
          <v-btn color="error" :loading="deleting" variant="flat" @click="deleteRecording">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.usage-recording-summary {
  display: flex;
  align-items: center;
  gap: var(--v64-space-2);
  min-height: 40px;
}

.usage-recording-summary__ended {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}

.usage-recording-summary__delete {
  flex: none;
}

/* An M3 dialog: 24 px inside on every side. */
.usage-recording-summary__dialog {
  padding: var(--v64-space-5);
}

.usage-recording-summary__title {
  padding: 0 0 var(--v64-space-4);
  font: var(--v64-type-headline-sm);
  white-space: normal;
}

.usage-recording-summary__body {
  display: grid;
  gap: var(--v64-space-4);
  padding: 0;
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}

.usage-recording-summary__body p {
  margin: 0;
}

.usage-recording-summary__actions {
  gap: var(--v64-space-2);
  min-height: 0;
  padding: var(--v64-space-5) 0 0;
}

@media (pointer: coarse) {
  .usage-recording-summary__delete {
    min-height: 48px;
  }
}
</style>
