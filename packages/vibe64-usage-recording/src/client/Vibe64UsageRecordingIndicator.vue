<script setup>
import { useVibe64UsageRecording } from "./useVibe64UsageRecording.js";

// Rendered into the project header for the selected session. Emits
// open-usage { recordingId } when the person opens the results.
const props = defineProps({
  sessionId: { type: String, required: true }
});
defineEmits(["open-usage"]);

// Placeholder: shows nothing until the recorder lands.
const { recording } = useVibe64UsageRecording({ sessionId: () => props.sessionId });
</script>

<template>
  <div v-if="recording" class="vibe64-usage-recording-indicator" role="status" aria-live="polite" />
</template>
