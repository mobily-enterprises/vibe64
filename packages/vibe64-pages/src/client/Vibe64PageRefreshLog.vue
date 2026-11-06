<script setup>
// A page's last refreshes, newest first: how each ended, why, and its log. An
// AI refresh that did not refresh the page links to its AI task, which stays in
// its session until the next task there; one that did is closed.
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDisplay } from "vuetify";
import { pageTime, readRefreshRuns } from "./pagesRequests.js";

const OUTCOMES = Object.freeze({ refreshed: "Refreshed", failed: "Failed", cancelled: "Cancelled", skipped: "Skipped" });

const props = defineProps({
  page: { type: Object, default: null },
  projectSlug: { type: String, required: true }
});
const emit = defineEmits(["close"]);

const route = useRoute();
const router = useRouter();
const { xs } = useDisplay();
const runs = ref([]);
const loading = ref(false);
const error = ref("");

async function load() {
  if (!props.page) return;
  loading.value = true;
  runs.value = [];
  try {
    runs.value = (await readRefreshRuns(props.projectSlug, props.page.id)).runs || [];
    error.value = "";
  } catch (cause) {
    error.value = cause?.message || "The refresh log could not load.";
  } finally {
    loading.value = false;
  }
}

function openTask(run) {
  emit("close");
  void router.push({ path: route.path, query: { ...route.query, session: run.sessionId, aiTask: run.taskId } });
}

watch(() => props.page?.id, load, { immediate: true });
</script>

<template>
  <v-dialog :model-value="Boolean(page)" :fullscreen="xs" max-width="640" scrollable @update:model-value="!$event && emit('close')">
    <v-card v-if="page" :title="`Refreshes of “${page.title}”`" data-test="page-refresh-log">
      <v-card-subtitle v-if="page.refresh">
        {{ page.refresh.schedule }} · {{ page.refresh.kind === "command" ? "a script, no AI" : "an AI task" }} · runs as
        {{ page.refresh.scheduledBy?.name || page.refresh.scheduledBy?.id }}
      </v-card-subtitle>
      <v-card-text class="vibe64-page-refresh-log__body">
        <v-progress-linear v-if="loading" indeterminate color="primary" />
        <v-alert v-if="error" density="compact" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
        <p v-if="!loading && !error && !runs.length" class="text-body-medium">No refresh has run yet.</p>
        <article v-for="run in runs" :key="run.id" class="vibe64-page-refresh-log__run" data-test="page-refresh-run">
          <div class="vibe64-page-refresh-log__head">
            <v-chip :color="run.outcome === 'failed' ? 'error' : run.outcome === 'refreshed' ? 'success' : undefined" size="small" variant="tonal">
              {{ OUTCOMES[run.outcome] || run.outcome }}
            </v-chip>
            <span class="text-body-small">{{ pageTime(run.startedAt) }}</span>
          </div>
          <p class="text-body-medium vibe64-page-refresh-log__message">{{ run.message }}</p>
          <pre v-if="run.log" class="vibe64-page-refresh-log__output" data-test="page-refresh-run-log">{{ run.log }}</pre>
          <v-btn v-if="run.taskId && run.outcome !== 'refreshed'" size="small" variant="text" @click="openTask(run)">Open its AI task</v-btn>
        </article>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('close')">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.vibe64-page-refresh-log__body {
  align-content: start;
  display: grid;
  gap: 0.75rem;
}

.vibe64-page-refresh-log__run {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: grid;
  gap: 0.25rem;
  padding-top: 0.75rem;
}

.vibe64-page-refresh-log__head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.vibe64-page-refresh-log__message {
  margin: 0;
  overflow-wrap: anywhere;
}

.vibe64-page-refresh-log__output {
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 8px;
  font-size: 0.8125rem;
  margin: 0;
  max-height: 14rem;
  overflow: auto;
  padding: 0.5rem 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
