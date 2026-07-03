<template>
  <section class="vibe64-dashboard-page vibe64-dashboard-page--archive-detail">
    <header class="vibe64-dashboard-page__header">
      <h1>Archived Session</h1>
    </header>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="comfortable"
    >
      {{ error }}
    </v-alert>

    <v-progress-linear
      v-if="loading && !session"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <ArchivedVibe64SessionDetail
      v-if="session"
      :archive="archive"
      :back-to="backTo"
      :conversation-log="conversationLog"
      :session="session"
    />

    <v-sheet
      v-else-if="!loading"
      class="vibe64-dashboard-page__empty"
      rounded="lg"
      border
    >
      <h2>Archived session unavailable</h2>
      <p>Session {{ sessionId || "unknown" }} could not be loaded.</p>
      <div class="vibe64-dashboard-page__empty-actions">
        <v-btn
          :prepend-icon="mdiArrowLeft"
          :to="backTo"
          variant="tonal"
        >
          Back to sessions
        </v-btn>
        <v-btn
          :prepend-icon="mdiRefresh"
          variant="text"
          @click="reload"
        >
          Retry
        </v-btn>
      </div>
    </v-sheet>
  </section>
</template>

<script setup>
import {
  mdiArrowLeft,
  mdiRefresh
} from "@mdi/js";
import ArchivedVibe64SessionDetail from "@/components/studio/ArchivedVibe64SessionDetail.vue";
import {
  useArchivedVibe64SessionDetail
} from "@/composables/useArchivedVibe64Sessions.js";

const {
  archive,
  backTo,
  conversationLog,
  error,
  loading,
  reload,
  session,
  sessionId
} = useArchivedVibe64SessionDetail();
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}

.vibe64-dashboard-page__header {
  min-width: 0;
}

.vibe64-dashboard-page__header h1 {
  color: rgb(var(--v-theme-on-surface));
  font-size: var(--generated-ui-screen-title-size, clamp(1.2rem, 1.7vw, 1.55rem));
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.05;
  margin: 0 0 0.15rem;
}

.vibe64-dashboard-page__empty {
  display: grid;
  gap: 0.65rem;
  padding: 1rem;
}

.vibe64-dashboard-page__empty h2,
.vibe64-dashboard-page__empty p {
  margin: 0;
}

.vibe64-dashboard-page__empty h2 {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0;
}

.vibe64-dashboard-page__empty p {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.86rem;
}

.vibe64-dashboard-page__empty-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
