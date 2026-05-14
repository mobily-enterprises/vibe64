<template>
  <section class="studio-archived-sessions d-flex flex-column ga-3">
    <div class="studio-archived-sessions__header">
      <div>
        <h1 class="studio-archived-sessions__title">{{ title }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">{{ description }}</p>
      </div>
      <v-btn
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
              </div>
            </div>
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

          <v-expansion-panels
            v-if="hasDetails(session)"
            class="studio-archived-sessions__details"
            multiple
            variant="accordion"
          >
            <v-expansion-panel v-if="session.finalReportText">
              <v-expansion-panel-title>Final Report</v-expansion-panel-title>
              <v-expansion-panel-text>
                <pre>{{ session.finalReportText }}</pre>
              </v-expansion-panel-text>
            </v-expansion-panel>
            <v-expansion-panel v-if="session.agentDecisionsLatest">
              <v-expansion-panel-title>Agent Decisions</v-expansion-panel-title>
              <v-expansion-panel-text>
                <pre>{{ session.agentDecisionsLatest }}</pre>
              </v-expansion-panel-text>
            </v-expansion-panel>
            <v-expansion-panel v-if="session.issueDetails">
              <v-expansion-panel-title>Issue Details</v-expansion-panel-title>
              <v-expansion-panel-text>
                <pre>{{ session.issueDetails }}</pre>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </v-card-text>
      </v-card>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import {
  mdiArchiveCancelOutline,
  mdiCheckCircle,
  mdiGithub,
  mdiRefresh,
  mdiSourceBranch
} from "@mdi/js";
import { listIssueSessions } from "@/lib/studioApi.js";
import {
  issueSessionStatusColor,
  issueSessionStatusLabel,
  parseGithubSessionLink,
  shortIssueSessionId
} from "@/lib/issueSessionViewModel.js";

const props = defineProps({
  archive: {
    required: true,
    type: String
  },
  description: {
    default: "",
    type: String
  },
  emptyText: {
    default: "",
    type: String
  },
  emptyTitle: {
    default: "No sessions",
    type: String
  },
  title: {
    required: true,
    type: String
  }
});

const sessions = ref([]);
const loading = ref(false);
const error = ref("");

const archiveIcon = computed(() => {
  return props.archive === "completed" ? mdiCheckCircle : mdiArchiveCancelOutline;
});

function completedStepCount(session = {}) {
  return Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
}

function shortSessionId(sessionId) {
  return shortIssueSessionId(sessionId);
}

function statusLabel(status) {
  return issueSessionStatusLabel(status);
}

function statusColor(status) {
  return issueSessionStatusColor(status);
}

function githubLabel(url, fallback) {
  return parseGithubSessionLink(url, fallback === "PR" ? "pr" : "issue").label;
}

function hasDetails(session = {}) {
  return Boolean(session.finalReportText || session.agentDecisionsLatest || session.issueDetails);
}

async function loadSessions() {
  loading.value = true;
  error.value = "";
  try {
    const response = await listIssueSessions({
      archive: props.archive
    });
    sessions.value = Array.isArray(response?.sessions) ? response.sessions : [];
  } catch (loadError) {
    error.value = String(loadError?.message || loadError || "Archived sessions could not be loaded.");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadSessions();
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

.studio-archived-sessions__title {
  font-size: clamp(1.2rem, 1.7vw, 1.55rem);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.1;
  margin: 0 0 0.1rem;
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
}

.studio-archived-sessions__quick-link:hover,
.studio-archived-sessions__quick-link:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.42);
  text-decoration: underline;
}

.studio-archived-sessions__details {
  border-top: 1px solid rgba(var(--v-border-color), 0.24);
  padding-top: 0.2rem;
}

.studio-archived-sessions__details pre {
  background: rgba(var(--v-theme-surface-variant), 0.46);
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.42;
  margin: 0;
  max-height: 28rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .studio-archived-sessions {
    max-width: 100%;
  }

  .studio-archived-sessions__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
