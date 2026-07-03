<template>
  <section class="studio-archived-sessions d-flex flex-column ga-3">
    <div
      v-if="title || description || showRefresh"
      class="studio-archived-sessions__header"
      :class="{ 'studio-archived-sessions__header--actions-only': !title && !description }"
    >
      <div v-if="title || description" class="studio-archived-sessions__copy">
        <h2 class="studio-archived-sessions__title">{{ title }}</h2>
        <p v-if="description" class="text-body-2 text-medium-emphasis mb-0">{{ description }}</p>
      </div>
      <v-btn
        v-if="showRefresh"
        class="studio-archived-sessions__refresh"
        :loading="loading"
        :prepend-icon="mdiRefresh"
        size="small"
        variant="tonal"
        @click="loadSessions"
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

    <v-sheet v-if="!loading && sessions.length < 1 && !error" rounded="lg" border class="studio-archived-sessions__empty">
      <h2 class="text-subtitle-1 mb-1">{{ emptyTitle }}</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">{{ emptyText }}</p>
    </v-sheet>

    <div v-if="sessions.length" class="studio-archived-sessions__grid">
      <v-card
        v-for="session in sessions"
        :key="session.sessionId"
        class="studio-archived-sessions__card"
        rounded="lg"
        variant="outlined"
      >
        <v-card-text class="studio-archived-sessions__card-body">
          <div class="studio-archived-sessions__card-heading">
            <div class="studio-archived-sessions__icon">
              <v-icon :icon="archiveIcon" size="22" />
            </div>
            <div class="studio-archived-sessions__identity">
              <div class="studio-archived-sessions__session-id">{{ shortSessionId(session.sessionId) }}</div>
              <div class="studio-archived-sessions__meta">
                <v-chip :color="statusColor(session.status)" size="x-small" variant="tonal">
                  {{ statusLabel(session.status || archive) }}
                </v-chip>
                <v-chip size="x-small" variant="tonal">
                  {{ completedStepCount(session) }} steps
                </v-chip>
                <v-chip v-if="session.sourceRemoved" color="warning" size="x-small" variant="tonal">
                  source removed
                </v-chip>
                <v-chip v-else-if="session.sourceReady" color="success" size="x-small" variant="tonal">
                  source available
                </v-chip>
              </div>
            </div>
            <v-btn
              class="studio-archived-sessions__view"
              :prepend-icon="mdiEyeOutline"
              size="small"
              :to="sessionRoute(session)"
              variant="tonal"
            >
              View
            </v-btn>
          </div>

          <div class="studio-archived-sessions__quick-facts">
            <div v-if="session.branch" class="studio-archived-sessions__quick-fact">
              <v-icon :icon="mdiSourceBranch" size="16" />
              <span>{{ session.branch }}</span>
            </div>
            <a
              v-if="session.issueUrl"
              class="studio-archived-sessions__quick-fact studio-archived-sessions__quick-link"
              :href="session.issueUrl"
              target="_blank"
              rel="noreferrer"
            >
              <v-icon :icon="mdiGithub" size="16" />
              <span>{{ githubLabel(session.issueUrl, "Issue") }}</span>
            </a>
            <a
              v-if="session.prUrl"
              class="studio-archived-sessions__quick-fact studio-archived-sessions__quick-link"
              :href="session.prUrl"
              target="_blank"
              rel="noreferrer"
            >
              <v-icon :icon="mdiGithub" size="16" />
              <span>{{ githubLabel(session.prUrl, "PR") }}</span>
            </a>
          </div>
        </v-card-text>
      </v-card>
    </div>
  </section>
</template>

<script setup>
import {
  archivedVibe64SessionsEmits,
  archivedVibe64SessionsProps,
  useArchivedVibe64Sessions
} from "@/composables/useArchivedVibe64Sessions.js";

const props = defineProps(archivedVibe64SessionsProps);
const emit = defineEmits(archivedVibe64SessionsEmits);

const {
  archiveIcon,
  completedStepCount,
  error,
  githubLabel,
  loadSessions,
  loading,
  mdiEyeOutline,
  mdiGithub,
  mdiRefresh,
  mdiSourceBranch,
  sessionRoute,
  sessions,
  shortSessionId,
  statusColor,
  statusLabel
} = useArchivedVibe64Sessions(props, emit);

defineExpose({
  refresh: loadSessions
});
</script>

<style scoped>
.studio-archived-sessions {
  margin-inline: auto;
  max-width: min(82rem, calc(100vw - 2rem));
  width: 100%;
}

.studio-archived-sessions__header {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-archived-sessions__header--actions-only {
  justify-content: flex-end;
}

.studio-archived-sessions__copy {
  min-width: 0;
}

.studio-archived-sessions__title {
  font-size: clamp(1.2rem, 1.7vw, 1.55rem);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.1;
  margin: 0 0 0.1rem;
}

.studio-archived-sessions__refresh {
  min-height: 48px;
}

.studio-archived-sessions__empty {
  padding: 1rem;
}

.studio-archived-sessions__grid {
  display: grid;
  gap: 0.7rem;
}

.studio-archived-sessions__card {
  background: rgb(var(--v-theme-surface));
}

.studio-archived-sessions__card-body {
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem;
}

.studio-archived-sessions__card-heading {
  align-items: flex-start;
  display: flex;
  gap: 0.7rem;
  min-width: 0;
}

.studio-archived-sessions__icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.12);
  border-radius: 999px;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  flex: 0 0 auto;
  height: 2rem;
  justify-content: center;
  width: 2rem;
}

.studio-archived-sessions__identity {
  display: grid;
  flex: 1 1 auto;
  gap: 0.35rem;
  min-width: 0;
}

.studio-archived-sessions__session-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.92rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.studio-archived-sessions__meta,
.studio-archived-sessions__quick-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.55rem;
}

.studio-archived-sessions__quick-fact {
  align-items: center;
  background: rgba(var(--v-theme-surface-variant), 0.42);
  border: 1px solid rgba(var(--v-border-color), 0.26);
  border-radius: 999px;
  color: rgba(var(--v-theme-on-surface), 0.78);
  display: inline-flex;
  font-size: 0.8rem;
  gap: 0.3rem;
  min-width: 0;
  padding: 0.26rem 0.5rem;
  text-decoration: none;
}

.studio-archived-sessions__quick-fact span {
  overflow-wrap: anywhere;
}

.studio-archived-sessions__quick-link {
  color: rgb(var(--v-theme-primary));
  min-height: 48px;
  padding-inline: 0.75rem;
}

.studio-archived-sessions__quick-link:hover,
.studio-archived-sessions__quick-link:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.42);
  text-decoration: underline;
}

.studio-archived-sessions__view {
  flex: 0 0 auto;
  min-height: 40px;
}

@media (max-width: 640px) {
  .studio-archived-sessions {
    max-width: 100%;
  }

  .studio-archived-sessions__header,
  .studio-archived-sessions__card-heading {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
