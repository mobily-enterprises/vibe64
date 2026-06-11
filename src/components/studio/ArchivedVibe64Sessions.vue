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

    <v-alert v-if="recoverMessage" type="success" variant="tonal" density="comfortable">
      {{ recoverMessage }}
    </v-alert>

    <v-alert v-if="recoverError" type="error" variant="tonal" density="comfortable">
      {{ recoverError }}
    </v-alert>

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
                <v-chip v-if="session.worktreeRemoved" color="warning" size="x-small" variant="tonal">
                  worktree removed
                </v-chip>
                <v-chip v-else-if="session.worktreeReady" color="success" size="x-small" variant="tonal">
                  worktree restored
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

          <div v-if="session.worktreeRecoverable || session.worktreeReady" class="studio-archived-sessions__actions">
            <v-btn
              v-if="session.worktreeRecoverable"
              :loading="sessionIsRecovering(session.sessionId)"
              :prepend-icon="mdiRestore"
              size="small"
              variant="tonal"
              @click="recoverWorktree(session)"
            >
              Recover worktree
            </v-btn>
            <span v-else class="studio-archived-sessions__recovered-path">
              {{ session.worktree }}
            </span>
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
          </v-expansion-panels>
        </v-card-text>
      </v-card>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  mdiArchiveCancelOutline,
  mdiCheckCircle,
  mdiGithub,
  mdiRefresh,
  mdiRestore,
  mdiSourceBranch
} from "@mdi/js";
import {
  LOCAL_STUDIO_COMMAND_OPTIONS,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  enrichVibe64SessionForDisplay
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel,
  parseGithubSessionLink,
  shortVibe64SessionId
} from "@/lib/vibe64SessionViewModel.js";

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
  showRefresh: {
    default: true,
    type: Boolean
  },
  title: {
    default: "",
    type: String
  }
});

const emit = defineEmits(["loading-changed"]);
const paths = usePaths();
const projectSlug = useVibe64ProjectSlug();
const recoverError = ref("");
const recoverMessage = ref("");
const recoveringSessionIds = ref(new Set());
const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
  surface: VIBE64_SURFACE_ID
}));

const sessionListResource = useEndpointResource({
  client: studioHttpClient,
  fallbackLoadError: "Archived sessions could not be loaded.",
  path: sessionsApiPath,
  queryKey: computed(() => [
    ...vibe64SessionsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    ),
    "archive",
    props.archive
  ]),
  readQuery: computed(() => ({
    archive: props.archive
  }))
});

const loading = computed(() => Boolean(sessionListResource.isLoading.value));
const error = computed(() => String(sessionListResource.loadError.value || ""));
const sessions = computed(() => {
  const payload = sessionListResource.data.value;
  const items = Array.isArray(payload?.sessions) ? payload.sessions : [];
  return items
    .map(enrichVibe64SessionForDisplay)
    .filter(sessionIsInArchive);
});

const archiveIcon = computed(() => {
  return props.archive === "completed" ? mdiCheckCircle : mdiArchiveCancelOutline;
});

function completedStepCount(session = {}) {
  const count = Number(session.completedStepCount);
  if (Number.isSafeInteger(count) && count >= 0) {
    return count;
  }
  return Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
}

function shortSessionId(sessionId) {
  return shortVibe64SessionId(sessionId);
}

function statusLabel(status) {
  return vibe64SessionStatusLabel(status);
}

function statusColor(status) {
  return vibe64SessionStatusColor(status);
}

function githubLabel(url, fallback) {
  return parseGithubSessionLink(url, fallback === "PR" ? "pr" : "issue").label;
}

function hasDetails(session = {}) {
  return Boolean(session.finalReportText);
}

function sessionIsInArchive(session = {}) {
  const status = String(session.status || "");
  if (props.archive === "abandoned") {
    return status === "abandoned";
  }
  return status === "finished" || status === "completed";
}

async function loadSessions() {
  await sessionListResource.reload();
}

function sessionIsRecovering(sessionId = "") {
  return recoveringSessionIds.value.has(String(sessionId || ""));
}

function setSessionRecovering(sessionId = "", recovering = false) {
  const next = new Set(recoveringSessionIds.value);
  if (recovering) {
    next.add(sessionId);
  } else {
    next.delete(sessionId);
  }
  recoveringSessionIds.value = next;
}

async function recoverWorktree(session = {}) {
  const sessionId = String(session.sessionId || "");
  if (!sessionId || sessionIsRecovering(sessionId)) {
    return;
  }
  recoverError.value = "";
  recoverMessage.value = "";
  setSessionRecovering(sessionId, true);
  try {
    const recovered = await studioHttpClient.post(
      vibe64SessionPath(sessionsApiPath.value, sessionId, "/worktree/recover"),
      {},
      LOCAL_STUDIO_COMMAND_OPTIONS
    );
    const name = recovered?.sessionName || session.worktreeRecoveryName || shortSessionId(sessionId);
    recoverMessage.value = `Recovered worktree for ${name}.`;
    await loadSessions();
  } catch (error) {
    recoverError.value = String(error?.message || error || "Worktree could not be recovered.");
  } finally {
    setSessionRecovering(sessionId, false);
  }
}

defineExpose({
  refresh: loadSessions
});

watch(loading, (isLoading) => {
  emit("loading-changed", isLoading);
}, {
  immediate: true
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

.studio-archived-sessions__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.studio-archived-sessions__recovered-path {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.78rem;
  overflow-wrap: anywhere;
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
