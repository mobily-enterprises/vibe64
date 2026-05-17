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
          <v-btn
            v-if="session.sessionId === selectedSessionId"
            class="studio-ai-sessions__tab-abandon"
            density="compact"
            :disabled="commandBusy || isSelectedSessionClosed"
            :icon="mdiClose"
            :loading="abandonCommand.isRunning"
            size="x-small"
            title="Abandon session"
            variant="text"
            aria-label="Abandon session"
            @click.stop="abandonSelectedSession"
          />
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
            :color="aiStudioSessionStatusColor(selectedSession.status)"
            variant="tonal"
          >
            {{ aiStudioSessionStatusLabel(selectedSession.status) }}
          </v-chip>
        </div>

        <AiStudioSessionTimeline
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
              v-if="actionResultMessage"
              :type="actionResultType"
              variant="tonal"
              density="compact"
              class="studio-ai-sessions__notice"
            >
              {{ actionResultMessage }}
            </v-alert>

            <v-alert
              v-if="currentStepDisabledReason"
              type="info"
              variant="tonal"
              density="compact"
              class="studio-ai-sessions__notice"
            >
              {{ currentStepDisabledReason }}
            </v-alert>

            <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-0">
              {{ copyStatus }}
            </p>
          </template>
        </AiStudioSessionTimeline>
      </section>

      <aside class="studio-ai-sessions__side">
        <AiStudioSessionFacts
          :facts="sessionFacts"
          :status-color="aiStudioSessionStatusColor(selectedSession.status)"
          :status-label="aiStudioSessionStatusLabel(selectedSession.status)"
          @copy="copyText"
        />
      </aside>

      <section class="studio-ai-sessions__terminals">
        <AiStudioCommandTerminal
          :action="commandTerminalAction"
          :session="selectedSession"
          :start-request-key="commandTerminalStartKey"
          @finished="handleCommandTerminalFinished"
          @running-changed="commandTerminalRunning = $event"
        />

        <CodexSessionTerminal
          :prompt-injection-request-key="codexPromptInjectionKey"
          :prompt-override="codexPromptOverride"
          :session="selectedSession"
          @prompt-injected="handleCodexPromptInjected"
          @prompt-injection-failed="handleCodexPromptInjectionFailed"
          @session-update="handleCodexSessionUpdate"
        />
      </section>
    </div>

    <AiStudioDraftEditorDialog
      v-model="draftEditorOpen"
      v-model:body-text="draftEditorBody"
      v-model:issue-title="draftEditorIssueTitle"
      :error="draftEditorError"
      :kind="draftEditorKind"
      :loading="draftEditorLoading"
      :saving="draftEditorSaving"
      @save="saveDraftEditor"
    />
  </v-sheet>
</template>

<script setup>
import {
  mdiArrowRight,
  mdiClose,
  mdiPlus
} from "@mdi/js";
import AiStudioCommandTerminal from "@/components/studio/AiStudioCommandTerminal.vue";
import AiStudioDraftEditorDialog from "@/components/studio/AiStudioDraftEditorDialog.vue";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";
import AiStudioSessionFacts from "@/components/studio/ai-studio-session/AiStudioSessionFacts.vue";
import AiStudioSessionTimeline from "@/components/studio/ai-studio-session/AiStudioSessionTimeline.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  useAiStudioSessions
} from "@/composables/useAiStudioSessions.js";

const emit = defineEmits(["title-change"]);

const {
  abandonCommand,
  abandonSelectedSession,
  actionIcon,
  actionResultMessage,
  actionResultType,
  activeActionId,
  advanceCommand,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel,
  canCreateSession,
  codexPromptInjectionKey,
  codexPromptOverride,
  commandBusy,
  commandTerminalAction,
  commandTerminalRunning,
  commandTerminalStartKey,
  copyStatus,
  copyText,
  createSessionCommand,
  createSessionTitle,
  currentActions,
  currentNext,
  currentStepDisabledReason,
  draftEditorBody,
  draftEditorError,
  draftEditorIssueTitle,
  draftEditorKind,
  draftEditorLoading,
  draftEditorOpen,
  draftEditorSaving,
  goNext,
  handleCodexPromptInjected,
  handleCodexPromptInjectionFailed,
  handleCodexSessionUpdate,
  handleCommandTerminalFinished,
  isSelectedSessionClosed,
  pageError,
  pageLoading,
  runAction,
  runActionCommand,
  saveDraftEditor,
  selectSession,
  selectedSession,
  selectedSessionId,
  selectedSessionTitle,
  sessionFacts,
  sessions,
  shortSessionId,
  timelineSteps
} = useAiStudioSessions({
  onTitleChange(title) {
    emit("title-change", title);
  }
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
  align-items: center;
  max-width: 18rem;
}

.studio-ai-sessions__tab-abandon {
  margin-left: 0.3rem;
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

.studio-ai-sessions__terminals {
  display: grid;
  gap: 0.75rem;
  grid-column: 1 / -1;
  min-width: 0;
}

@media (max-width: 980px) {
  .studio-ai-sessions__layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar,
  .studio-ai-sessions__heading {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
