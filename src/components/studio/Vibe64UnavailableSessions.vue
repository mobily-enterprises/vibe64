<template>
  <v-expansion-panels v-if="sessions.length" v-model="expanded" variant="accordion" class="studio-unavailable-sessions">
    <v-expansion-panel>
      <v-expansion-panel-title>
        <v-icon :icon="mdiAlertCircleOutline" color="warning" class="mr-2" />
        {{ sessions.length === 1 ? "1 session needs attention" : `${sessions.length} sessions need attention` }}
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <div class="studio-unavailable-sessions__entries">
          <div v-for="session in sessions" :key="session.sessionId" class="mb-3">
            <strong>{{ session.sessionName || session.sessionId }}</strong>
            <p class="text-body-medium mb-1">{{ session.unavailable.message }}</p>
            <v-btn variant="text" height="48" @click="copyDetails(session)">Copy recovery details</v-btn>
          </div>
          <v-btn variant="tonal" height="48" :disabled="loading" @click="$emit('recheck')">
            {{ loading ? "Checking…" : "Check again" }}
          </v-btn>
        </div>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script setup>
import { ref } from "vue";
import { mdiAlertCircleOutline } from "@mdi/js";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { writeClipboardText } from "@/lib/clipboard.js";

defineProps({
  sessions: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
});
defineEmits(["recheck"]);

const expanded = ref(0);
const projectSlug = useVibe64ProjectSlug();
const feedback = useUiFeedback({ source: "vibe64.sessions.recovery" });

async function copyDetails(session) {
  try {
    await writeClipboardText(JSON.stringify({
      project: projectSlug.value,
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      code: session.unavailable.code,
      message: session.unavailable.message,
      sessionRoot: session.sessionRoot,
      archivePath: session.archivePath,
      sourcePath: session.sourcePath
    }, null, 2));
    feedback.success("Recovery details copied.");
  } catch (error) {
    feedback.error(error, "Recovery details could not be copied.");
  }
}
</script>

<style scoped>
.studio-unavailable-sessions__entries {
  max-height: 30vh;
  overflow: auto;
  overflow-wrap: anywhere;
}
</style>
