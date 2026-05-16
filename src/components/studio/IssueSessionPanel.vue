<template>
  <v-sheet rounded="lg" class="studio-ai-sessions studio-screen__panel">
    <StudioErrorNotice
      v-if="pageError"
      title="AI Studio sessions could not load"
      :error="pageError"
      compact
      class="mb-3"
    />

    <div class="studio-ai-sessions__toolbar">
      <div class="studio-ai-sessions__tabs">
        <v-chip
          v-for="session in sessions"
          :key="session.sessionId"
          :color="session.sessionId === selectedSessionId ? 'primary' : 'default'"
          :variant="session.sessionId === selectedSessionId ? 'flat' : 'tonal'"
          class="studio-ai-sessions__tab"
          size="large"
          @click="selectSession(session.sessionId)"
        >
          <span
            class="studio-ai-sessions__status-dot"
            :class="`studio-ai-sessions__status-dot--${session.status}`"
          />
          <span>{{ shortSessionId(session.sessionId) }}</span>
        </v-chip>

        <v-btn
          color="primary"
          variant="tonal"
          :disabled="!canCreateSession || commandBusy"
          :loading="createSessionCommand.isRunning"
          :prepend-icon="mdiPlus"
          :title="createSessionTitle"
          @click="createSessionCommand.run()"
        >
          New Session
        </v-btn>
      </div>

      <v-btn
        v-if="selectedSession"
        color="error"
        variant="text"
        :disabled="commandBusy || isSelectedSessionClosed"
        :loading="abandonCommand.isRunning"
        :prepend-icon="mdiClose"
        @click="abandonSelectedSession"
      >
        Abandon
      </v-btn>
    </div>

    <v-progress-linear
      v-if="pageLoading && !selectedSession"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <v-sheet
      v-else-if="!selectedSession"
      rounded="lg"
      border
      class="studio-ai-sessions__empty"
    >
      <p class="text-body-2 text-medium-emphasis mb-0">No sessions yet.</p>
    </v-sheet>

    <div v-else class="studio-ai-sessions__layout">
      <section class="studio-ai-sessions__main">
        <div class="studio-ai-sessions__heading">
          <div>
            <p class="studio-ai-sessions__eyebrow">AI Studio session</p>
            <h2 class="studio-ai-sessions__title">{{ selectedSessionTitle }}</h2>
          </div>
          <v-chip
            :color="issueSessionStatusColor(selectedSession.status)"
            variant="tonal"
          >
            {{ issueSessionStatusLabel(selectedSession.status) }}
          </v-chip>
        </div>

        <IssueSessionTimeline
          :busy="commandBusy"
          :steps="timelineSteps"
        >
          <template #current-step>
            <div class="studio-ai-sessions__actions">
              <v-btn
                v-for="action in currentActions"
                :key="action.id"
                color="primary"
                variant="flat"
                :disabled="commandBusy || action.enabled !== true"
                :loading="runActionCommand.isRunning && activeActionId === action.id"
                :prepend-icon="actionIcon(action)"
                :title="action.disabledReason || action.label"
                @click="runAction(action)"
              >
                {{ action.label }}
              </v-btn>

              <v-btn
                v-if="currentNext?.visible"
                color="primary"
                variant="tonal"
                :disabled="commandBusy || currentNext.enabled !== true"
                :loading="advanceCommand.isRunning"
                :prepend-icon="mdiArrowRight"
                :title="currentNext.disabledReason || currentNext.label || 'Next'"
                @click="goNext"
              >
                {{ currentNext.label || "Next" }}
              </v-btn>
            </div>

            <v-alert
              v-if="currentStepDisabledReason"
              type="info"
              variant="tonal"
              density="compact"
              class="studio-ai-sessions__notice"
            >
              {{ currentStepDisabledReason }}
            </v-alert>

            <v-sheet
              v-if="activePromptHandoff"
              rounded="lg"
              border
              class="studio-ai-sessions__prompt"
            >
              <div>
                <p class="studio-ai-sessions__prompt-label">Prompt ready</p>
                <p class="studio-ai-sessions__prompt-text">
                  {{ activePromptHandoff.visiblePrompt || "Prompt ready for Codex." }}
                </p>
              </div>
              <v-btn
                color="primary"
                variant="tonal"
                :prepend-icon="mdiContentCopy"
                @click="copyPromptHandoff"
              >
                Copy Prompt
              </v-btn>
            </v-sheet>

            <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-0">
              {{ copyStatus }}
            </p>
          </template>
        </IssueSessionTimeline>
      </section>

      <aside class="studio-ai-sessions__side">
        <IssueSessionFacts
          :facts="sessionFacts"
          :status-color="issueSessionStatusColor(selectedSession.status)"
          :status-label="issueSessionStatusLabel(selectedSession.status)"
          @copy="copyText"
        />
      </aside>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useView } from "@jskit-ai/users-web/client/composables/useView";
import {
  mdiArrowRight,
  mdiClose,
  mdiContentCopy,
  mdiPlus
} from "@mdi/js";
import IssueSessionFacts from "@/components/studio/issue-session/IssueSessionFacts.vue";
import IssueSessionTimeline from "@/components/studio/issue-session/IssueSessionTimeline.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useStoredSelection } from "@/composables/useStoredSelection.js";
import {
  isClosedIssueSession,
  issueSessionDisplayTitle,
  issueSessionStatusColor,
  issueSessionStatusLabel
} from "@/lib/issueSessionViewModel.js";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  SELECTED_SESSION_STORAGE_KEY,
  aiStudioActionPath,
  aiStudioSessionPath,
  aiStudioSessionQueryKey,
  aiStudioSessionsQueryKey,
  commandInputFromContext
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  aiStudioActionIcon as actionIcon,
  aiStudioPromptHandoffFromSession,
  aiStudioSessionFacts,
  aiStudioSessionLimits,
  buildAiStudioTimelineSteps,
  commandMessage,
  currentStepDisabledReason as resolveCurrentStepDisabledReason,
  enrichAiStudioSessionForDisplay,
  shortAiStudioSessionId as shortSessionId,
  visibleAiStudioSessions
} from "@/lib/aiStudioSessionPanelModel.js";

const emit = defineEmits(["title-change"]);

const paths = usePaths();
const sessionSelection = useStoredSelection({
  storageKey: SELECTED_SESSION_STORAGE_KEY
});
const selectedSessionId = sessionSelection.selectedId;
const activeActionId = ref("");
const copyStatus = ref("");
const latestPromptHandoff = ref(null);

const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
  surface: AI_STUDIO_SURFACE_ID
}));

const sessionList = useList({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  fallbackLoadError: "AI Studio sessions could not be loaded.",
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.list",
  queryKeyFactory: aiStudioSessionsQueryKey,
  selectItems: (payload) => Array.isArray(payload?.sessions) ? payload.sessions : [],
  surfaceId: AI_STUDIO_SURFACE_ID
});

const selectedSessionView = useView({
  access: "never",
  apiUrlTemplate: `${AI_STUDIO_SESSIONS_API_SUFFIX}/:recordId`,
  fallbackLoadError: "AI Studio session could not be loaded.",
  includeRecordIdInQueryKey: true,
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.view",
  queryKeyFactory: aiStudioSessionQueryKey,
  readEnabled: computed(() => Boolean(selectedSessionId.value)),
  routeRecordId: selectedSessionId,
  surfaceId: AI_STUDIO_SURFACE_ID
});

const createSessionCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  buildCommandOptions: () => ({
    options: LOCAL_STUDIO_COMMAND_OPTIONS
  }),
  fallbackRunError: "AI Studio session could not be created.",
  messages: {
    error: "AI Studio session could not be created.",
    success: "AI Studio session created."
  },
  onRunSuccess: async (response) => {
    if (response?.sessionId) {
      sessionSelection.select(response.sessionId);
    }
    await refreshSessionData();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.create",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "POST"
});

const runActionCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  buildRawPayload: (_model, { context }) => commandInputFromContext(context),
  buildCommandOptions: (_payload, { context }) => ({
    method: "POST",
    options: LOCAL_STUDIO_COMMAND_OPTIONS,
    path: aiStudioActionPath(sessionsApiPath.value, context?.sessionId, context?.actionId)
  }),
  fallbackRunError: "AI Studio action could not run.",
  messages: {
    error: "AI Studio action could not run.",
    success: "AI Studio action completed."
  },
  onRunSuccess: async (response) => {
    latestPromptHandoff.value = aiStudioPromptHandoffFromSession(response);
    await refreshSessionData();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.action",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "POST"
});

const advanceCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  buildCommandOptions: (_payload, { context }) => ({
    method: "POST",
    options: LOCAL_STUDIO_COMMAND_OPTIONS,
    path: aiStudioSessionPath(sessionsApiPath.value, context?.sessionId, "/advance")
  }),
  fallbackRunError: "AI Studio session could not advance.",
  messages: {
    error: "AI Studio session could not advance.",
    success: "AI Studio session advanced."
  },
  onRunSuccess: async () => {
    latestPromptHandoff.value = null;
    await refreshSessionData();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.advance",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "POST"
});

const abandonCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  buildCommandOptions: (_payload, { context }) => ({
    method: "POST",
    options: LOCAL_STUDIO_COMMAND_OPTIONS,
    path: aiStudioSessionPath(sessionsApiPath.value, context?.sessionId, "/abandon")
  }),
  fallbackRunError: "AI Studio session could not be abandoned.",
  messages: {
    error: "AI Studio session could not be abandoned.",
    success: "AI Studio session abandoned."
  },
  onRunSuccess: async () => {
    sessionSelection.clear();
    latestPromptHandoff.value = null;
    await sessionList.reload();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.abandon",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "POST"
});

const sessions = computed(() => {
  return visibleAiStudioSessions(sessionList.items || []);
});

const selectedListSession = computed(() => {
  return sessions.value.find((session) => session.sessionId === selectedSessionId.value) || null;
});

const selectedSession = computed(() => {
  return enrichAiStudioSessionForDisplay(selectedSessionView.record || selectedListSession.value || null);
});

const currentActions = computed(() => {
  return Array.isArray(selectedSession.value?.actions)
    ? selectedSession.value.actions.filter((action) => action.visible !== false)
    : [];
});

const currentNext = computed(() => selectedSession.value?.next || null);
const isSelectedSessionClosed = computed(() => isClosedIssueSession(selectedSession.value || {}));
const commandBusy = computed(() => Boolean(
  createSessionCommand.isRunning ||
  runActionCommand.isRunning ||
  advanceCommand.isRunning ||
  abandonCommand.isRunning
));

const pageLoading = computed(() => Boolean(sessionList.isLoading || selectedSessionView.isLoading));
const pageError = computed(() => {
  return sessionList.loadError ||
    selectedSessionView.loadError ||
    commandMessage(createSessionCommand, "error") ||
    commandMessage(runActionCommand, "error") ||
    commandMessage(advanceCommand, "error") ||
    commandMessage(abandonCommand, "error") ||
    "";
});

const limits = computed(() => {
  return aiStudioSessionLimits({
    payloadLimits: sessionList.pages?.[0]?.limits || {},
    sessions: sessions.value
  });
});

const canCreateSession = computed(() => limits.value.openSessionCount < limits.value.maxOpenSessions);
const createSessionTitle = computed(() => {
  return canCreateSession.value
    ? "Create a new AI Studio session"
    : `Studio allows up to ${limits.value.maxOpenSessions} active sessions.`;
});

const selectedSessionTitle = computed(() => {
  return issueSessionDisplayTitle(selectedSession.value || {}) ||
    `Session ${shortSessionId(selectedSessionId.value)}`;
});

const timelineSteps = computed(() => {
  return buildAiStudioTimelineSteps(selectedSession.value);
});

const sessionFacts = computed(() => {
  return aiStudioSessionFacts(selectedSession.value || {});
});

const activePromptHandoff = computed(() => {
  return latestPromptHandoff.value || aiStudioPromptHandoffFromSession(selectedSession.value);
});

const currentStepDisabledReason = computed(() => {
  return resolveCurrentStepDisabledReason(currentActions.value, currentNext.value);
});

async function refreshSessionData() {
  await sessionList.reload();
  if (selectedSessionId.value) {
    await selectedSessionView.refresh();
  }
}

function selectSession(sessionId = "") {
  latestPromptHandoff.value = null;
  sessionSelection.select(sessionId);
}

async function runAction(action = {}) {
  if (!selectedSessionId.value || !action.id || commandBusy.value || action.enabled !== true) {
    return;
  }
  activeActionId.value = action.id;
  copyStatus.value = "";
  try {
    await runActionCommand.run({
      actionId: action.id,
      sessionId: selectedSessionId.value
    });
  } finally {
    activeActionId.value = "";
  }
}

async function goNext() {
  if (!selectedSessionId.value || commandBusy.value || currentNext.value?.enabled !== true) {
    return;
  }
  await advanceCommand.run({
    sessionId: selectedSessionId.value
  });
}

async function abandonSelectedSession() {
  if (!selectedSessionId.value || commandBusy.value || isSelectedSessionClosed.value) {
    return;
  }
  await abandonCommand.run({
    sessionId: selectedSessionId.value
  });
}

async function copyText(value, label = "Value") {
  try {
    await navigator.clipboard.writeText(String(value || ""));
    copyStatus.value = `${label} copied.`;
  } catch (error) {
    copyStatus.value = String(error?.message || error || "Copy failed.");
  }
}

async function copyPromptHandoff() {
  const handoff = activePromptHandoff.value || {};
  await copyText(
    handoff.terminalInput || handoff.prompt || "",
    handoff.visiblePrompt || "Prompt"
  );
}

watch(sessions, (nextSessions) => {
  if (sessionList.isInitialLoading) {
    return;
  }
  sessionSelection.selectAvailableId(nextSessions, {
    fallbackId: nextSessions.at(-1)?.sessionId || "",
    getId: (session) => session.sessionId
  });
}, {
  immediate: true
});

watch(selectedSessionTitle, (title) => {
  emit("title-change", title || "");
}, {
  immediate: true
});
</script>

<style scoped>
.studio-ai-sessions {
  display: grid;
  gap: 0.85rem;
  min-height: 0;
}

.studio-ai-sessions__toolbar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-ai-sessions__tabs {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-width: 0;
}

.studio-ai-sessions__tab {
  max-width: 18rem;
}

.studio-ai-sessions__status-dot {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  display: inline-block;
  height: 0.52rem;
  margin-right: 0.42rem;
  width: 0.52rem;
}

.studio-ai-sessions__status-dot--abandoned,
.studio-ai-sessions__status-dot--failed {
  background: rgb(var(--v-theme-error));
}

.studio-ai-sessions__status-dot--finished {
  background: rgb(var(--v-theme-success));
}

.studio-ai-sessions__empty {
  padding: 0.9rem;
}

.studio-ai-sessions__layout {
  align-items: flex-start;
  display: grid;
  gap: 0.9rem;
  grid-template-columns: minmax(0, 1.15fr) minmax(20rem, 0.85fr);
}

.studio-ai-sessions__main,
.studio-ai-sessions__side {
  min-width: 0;
}

.studio-ai-sessions__heading {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  min-width: 0;
}

.studio-ai-sessions__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.02em;
  line-height: 1.1;
  margin: 0 0 0.18rem;
  text-transform: uppercase;
}

.studio-ai-sessions__title {
  font-size: 1.08rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.18;
  margin: 0;
  overflow-wrap: anywhere;
}

.studio-ai-sessions__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.studio-ai-sessions__notice {
  margin-top: 0.35rem;
}

.studio-ai-sessions__prompt {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  margin-top: 0.35rem;
  padding: 0.62rem;
}

.studio-ai-sessions__prompt-label {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.02em;
  line-height: 1.1;
  margin: 0 0 0.15rem;
  text-transform: uppercase;
}

.studio-ai-sessions__prompt-text {
  font-size: 0.86rem;
  font-weight: 620;
  line-height: 1.28;
  margin: 0;
}

@media (max-width: 980px) {
  .studio-ai-sessions__layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar,
  .studio-ai-sessions__heading,
  .studio-ai-sessions__prompt {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
