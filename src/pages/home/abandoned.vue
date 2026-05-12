<template>
  <section class="studio-abandoned-sessions d-flex flex-column ga-3">
    <div class="studio-abandoned-sessions__header">
      <div>
        <h1 class="studio-abandoned-sessions__title">Abandoned Sessions</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Worktrees are removed; session branches remain recoverable in Git.
        </p>
      </div>
      <v-btn
        :loading="loading"
        :prepend-icon="mdiRefresh"
        size="small"
        variant="tonal"
        @click="loadAbandonedSessions"
      >
        Refresh
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="comfortable">
      {{ error }}
    </v-alert>

    <v-progress-linear
      v-if="loading && sessions.length < 1"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <v-sheet v-if="!loading && sessions.length < 1 && !error" rounded="lg" border class="studio-abandoned-sessions__empty">
      <h2 class="text-subtitle-1 mb-1">No abandoned sessions</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Abandoned sessions will appear here after their worktrees are removed.
      </p>
    </v-sheet>

    <v-list v-if="sessions.length" class="studio-abandoned-sessions__list" lines="three" density="compact">
      <v-list-item
        v-for="session in sessions"
        :key="session.sessionId"
        rounded="lg"
        class="studio-abandoned-sessions__item"
      >
        <template #prepend>
          <v-icon :icon="mdiArchiveCancelOutline" color="warning" />
        </template>

        <v-list-item-title class="studio-abandoned-sessions__item-title">
          {{ session.sessionId }}
        </v-list-item-title>
        <v-list-item-subtitle>
          <span class="studio-abandoned-sessions__meta">
            <span>Status: {{ session.status || "abandoned" }}</span>
            <span>Branch: {{ session.branch || "none" }}</span>
            <span>Steps: {{ completedStepCount(session) }}</span>
          </span>
        </v-list-item-subtitle>
        <v-list-item-subtitle v-if="session.issueUrl || session.prUrl">
          <span class="studio-abandoned-sessions__links">
            <a v-if="session.issueUrl" :href="session.issueUrl" target="_blank" rel="noreferrer">Issue</a>
            <a v-if="session.prUrl" :href="session.prUrl" target="_blank" rel="noreferrer">PR</a>
          </span>
        </v-list-item-subtitle>
      </v-list-item>
    </v-list>
  </section>
</template>

<script setup>
import { onMounted, ref } from "vue";
import {
  mdiArchiveCancelOutline,
  mdiRefresh
} from "@mdi/js";
import {
  listIssueSessions
} from "@/lib/studioApi.js";

const sessions = ref([]);
const loading = ref(false);
const error = ref("");

function completedStepCount(session = {}) {
  return Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
}

async function loadAbandonedSessions() {
  loading.value = true;
  error.value = "";
  try {
    const response = await listIssueSessions({
      archive: "abandoned"
    });
    sessions.value = Array.isArray(response?.sessions) ? response.sessions : [];
  } catch (loadError) {
    error.value = String(loadError?.message || loadError || "Abandoned sessions could not be loaded.");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadAbandonedSessions();
});
</script>

<style scoped>
.studio-abandoned-sessions {
  margin-inline: auto;
  max-width: min(76rem, calc(100vw - 2rem));
  width: 100%;
}

.studio-abandoned-sessions__header {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-abandoned-sessions__title {
  font-size: clamp(1.2rem, 1.7vw, 1.55rem);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.1;
  margin: 0 0 0.1rem;
}

.studio-abandoned-sessions__empty {
  padding: 1rem;
}

.studio-abandoned-sessions__list {
  background: transparent;
  display: grid;
  gap: 0.5rem;
  padding: 0;
}

.studio-abandoned-sessions__item {
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
}

.studio-abandoned-sessions__item-title {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.9rem;
}

.studio-abandoned-sessions__meta,
.studio-abandoned-sessions__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.8rem;
}

@media (max-width: 640px) {
  .studio-abandoned-sessions {
    max-width: 100%;
  }

  .studio-abandoned-sessions__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
