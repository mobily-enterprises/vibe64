<template>
  <section class="studio-archived-sessions d-flex flex-column ga-3">
    <div
      v-if="title || $slots.title || description || showRefresh"
      class="studio-archived-sessions__header"
      :class="{ 'studio-archived-sessions__header--actions-only': !title && !$slots.title && !description }"
    >
      <div v-if="title || $slots.title || description" class="studio-archived-sessions__copy">
        <slot name="title"><h2 class="text-headline-small font-weight-bold ma-0">{{ title }}</h2></slot>
        <p v-if="description" class="text-body-2 text-medium-emphasis mb-0">{{ description }}</p>
      </div>
      <v-btn
        v-if="showRefresh"
        class="studio-archived-sessions__refresh"
        :disabled="loading"
        :prepend-icon="mdiRefresh"
        size="small"
        variant="tonal"
        @click="loadSessions"
      >
        {{ loading ? "Refreshing…" : "Refresh" }}
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="comfortable">
      {{ error }}
    </v-alert>

    <div
      v-if="loading && sessions.length < 1"
      aria-label="Loading archived sessions"
      class="studio-archived-sessions__grid"
      role="status"
    >
      <v-card
        v-for="index in 4"
        :key="`archived-session-skeleton-${index}`"
        class="studio-archived-sessions__card"
        rounded="lg"
        variant="outlined"
      >
        <v-card-text class="studio-archived-sessions__card-body">
          <div class="studio-archived-sessions__card-heading">
            <v-skeleton-loader class="studio-archived-sessions__skeleton-icon" type="avatar" />
            <div class="studio-archived-sessions__identity">
              <v-skeleton-loader type="text" />
              <v-skeleton-loader type="chip@2" />
            </div>
            <v-skeleton-loader class="studio-archived-sessions__skeleton-button" type="button" />
          </div>
        </v-card-text>
      </v-card>
    </div>

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
              <div class="studio-archived-sessions__session-id">
                {{ session.sessionName || shortSessionId(session.sessionId) }}
              </div>
              <div class="studio-archived-sessions__meta">
                <v-chip :color="statusColor(session.status)" size="x-small" variant="tonal">
                  {{ statusLabel(session.status || "archived") }}
                </v-chip>
                <v-chip v-if="session.sourceReady" color="success" size="x-small" variant="tonal">
                  source available
                </v-chip>
              </div>
              <time
                class="studio-archived-sessions__archived-at text-caption text-medium-emphasis"
                :datetime="session.archivedAt || undefined"
              >
                Archived {{ formatArchivedAt(session.archivedAt) }}
              </time>
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

defineProps(archivedVibe64SessionsProps);
const emit = defineEmits(archivedVibe64SessionsEmits);

const {
  archiveIcon,
  error,
  formatArchivedAt,
  loadSessions,
  loading,
  mdiEyeOutline,
  mdiRefresh,
  sessionRoute,
  sessions,
  shortSessionId,
  statusColor,
  statusLabel
} = useArchivedVibe64Sessions(emit);

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

.studio-archived-sessions__refresh {
  min-height: 48px;
  min-width: 8.5rem;
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

.studio-archived-sessions__archived-at {
  display: block;
}

.studio-archived-sessions__skeleton-icon,
.studio-archived-sessions__skeleton-button {
  flex: 0 0 auto;
}

.studio-archived-sessions__skeleton-icon {
  width: 2rem;
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

  .studio-archived-sessions__card-heading {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
