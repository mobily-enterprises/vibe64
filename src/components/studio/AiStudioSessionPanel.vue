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
            @click.stop="requestAbandonSelectedSession"
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
          @rewind="rewindToStep"
        >
          <template #current-step>
            <form
              v-if="issueRequestFormVisible"
              class="studio-ai-sessions__issue-request"
              @submit.prevent="sendIssueRequestPrompt"
            >
              <v-textarea
                v-model="issueRequestText"
                auto-grow
                class="studio-ai-sessions__issue-request-input"
                :disabled="commandBusy"
                :error-messages="issueRequestError ? [issueRequestError] : []"
                label="Issue request"
                rows="5"
                variant="outlined"
              />

              <div class="studio-ai-sessions__actions">
                <v-btn
                  color="primary"
                  variant="flat"
                  :disabled="!issueRequestCanSubmit"
                  :loading="issueRequestSubmitting"
                  :prepend-icon="mdiSend"
                  :title="issueRequestSubmitTitle"
                  type="submit"
                >
                  Send prompt
                </v-btn>
              </div>
            </form>

            <div v-else class="studio-ai-sessions__actions">
              <template v-if="acceptChangesUtilitiesVisible">
                <v-btn
                  color="primary"
                  variant="flat"
                  :disabled="reviewDiffDisabled"
                  :loading="diffLoading"
                  :prepend-icon="mdiFileCompare"
                  :title="reviewDiffTitle"
                  @click="openDiffDialog"
                >
                  Review diff
                </v-btn>

                <v-btn
                  color="primary"
                  variant="flat"
                  :disabled="runAppReviewDisabled"
                  :prepend-icon="mdiPlayCircleOutline"
                  :title="runAppReviewTitle"
                  @click="runAppReview"
                >
                  Run app
                </v-btn>

                <v-btn
                  color="primary"
                  variant="tonal"
                  :disabled="openAppReviewDisabled"
                  :prepend-icon="mdiOpenInNew"
                  :title="openAppReviewTitle"
                  @click="openAppReview"
                >
                  Open app
                </v-btn>
              </template>

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

        <AiStudioSessionFacts
          class="studio-ai-sessions__facts"
          :facts="sessionFacts"
          :status-color="aiStudioSessionStatusColor(selectedSession.status)"
          :status-label="aiStudioSessionStatusLabel(selectedSession.status)"
          @copy="copyText"
        />
      </section>

      <section class="studio-ai-sessions__terminals">
        <CodexSessionTerminal
          :prompt-injection-request-key="codexPromptInjectionKey"
          :prompt-override="codexPromptOverride"
          :session="selectedSession"
          @busy-changed="handleCodexTerminalBusyChanged"
          @prompt-injected="handleCodexPromptInjected"
          @prompt-injection-failed="handleCodexPromptInjectionFailed"
          @session-update="handleCodexSessionUpdate"
        />

        <div
          v-if="commandTerminalVisible"
          class="studio-ai-sessions__command-overlay"
        >
          <AiStudioCommandTerminal
            class="studio-ai-sessions__command-terminal"
            :action="commandTerminalAction"
            :session="selectedSession"
            :start-request-key="commandTerminalStartKey"
            @closed="handleCommandTerminalClosed"
            @finished="handleCommandTerminalFinished"
            @running-changed="handleCommandTerminalRunningChanged"
          />
        </div>

        <div
          v-if="appReviewTerminalVisible"
          class="studio-ai-sessions__command-overlay"
        >
          <AiStudioCommandTerminal
            class="studio-ai-sessions__command-terminal"
            terminal-kind="app-review"
            title="App review terminal"
            :session="selectedSession"
            :start-request-key="appReviewTerminalStartKey"
            @closed="handleAppReviewTerminalClosed"
            @started="handleAppReviewTerminalStarted"
          />
        </div>
      </section>
    </div>

    <AiStudioDraftEditorDialog
      v-model="draftEditorOpen"
      v-model:values="draftEditorValues"
      :error="draftEditorError"
      :fields="draftEditorFields"
      :loading="draftEditorLoading"
      :saving="draftEditorSaving"
      :title="draftEditorTitle"
      @save="saveDraftEditor"
    />

    <v-dialog v-model="diffDialogOpen" max-width="min(94vw, 72rem)">
      <v-card class="studio-ai-sessions__diff-dialog">
        <v-card-title class="studio-ai-sessions__diff-title">
          <span>Review changes</span>
          <v-chip
            v-if="diffPayload"
            :color="diffPayload.hasChanges ? 'primary' : 'default'"
            size="small"
            variant="tonal"
          >
            {{ diffPayload.hasChanges ? "Changes found" : "No changes" }}
          </v-chip>
        </v-card-title>

        <v-card-text
          ref="diffBodyElement"
          class="studio-ai-sessions__diff-body"
          @click="handleDiffBodyClick"
        >
          <StudioErrorNotice
            v-if="diffError"
            title="Diff could not load"
            :error="diffError"
            compact
            class="mb-3"
          />

          <v-progress-linear
            v-if="diffLoading"
            color="primary"
            indeterminate
            class="mb-3"
          />

          <pre
            v-if="diffPayload?.gitStatus"
            class="studio-ai-sessions__diff-status"
          >{{ diffPayload.gitStatus }}</pre>

          <!-- eslint-disable-next-line vue/no-v-html -- Diff2Html escapes git diff content before rendering. -->
          <div
            v-if="renderedDiff"
            class="studio-ai-sessions__diff-rendered"
            v-html="renderedDiff"
          />

          <v-alert
            v-else-if="!diffLoading && !diffError"
            type="info"
            variant="tonal"
          >
            No diff is available for this session worktree.
          </v-alert>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeDiffDialog">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="abandonDialogOpen"
      max-width="520"
      persistent
    >
      <v-card class="studio-ai-sessions__abandon-dialog">
        <v-card-title class="studio-ai-sessions__abandon-title">
          <v-icon :icon="mdiAlertCircleOutline" color="warning" />
          Abandon session?
        </v-card-title>
        <v-card-text>
          <p class="text-body-2 mb-2">
            This will mark the session as abandoned and close its terminals.
          </p>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Session: <strong>{{ abandonDialogSessionTitle || shortSessionId(abandonDialogSessionId) }}</strong>
          </p>
        </v-card-text>
        <v-card-actions class="studio-ai-sessions__abandon-actions">
          <v-btn
            variant="text"
            :disabled="abandonCommand.isRunning"
            @click="cancelAbandonSession"
          >
            Cancel
          </v-btn>
          <v-btn
            color="warning"
            variant="flat"
            :loading="abandonCommand.isRunning"
            @click="confirmAbandonSession"
          >
            Abandon session
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-sheet>
</template>

<script setup>
import { computed, ref } from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import {
  mdiAlertCircleOutline,
  mdiArrowRight,
  mdiClose,
  mdiFileCompare,
  mdiOpenInNew,
  mdiPlayCircleOutline,
  mdiPlus,
  mdiSend
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
  abandonDialogOpen,
  abandonDialogSessionId,
  abandonDialogSessionTitle,
  actionIcon,
  actionResultMessage,
  actionResultType,
  activeActionId,
  advanceCommand,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel,
  acceptChangesUtilitiesVisible,
  appReviewTerminalStartKey,
  appReviewTerminalVisible,
  canCreateSession,
  cancelAbandonSession,
  closeDiffDialog,
  codexPromptInjectionKey,
  codexPromptOverride,
  commandBusy,
  commandTerminalAction,
  commandTerminalStartKey,
  commandTerminalVisible,
  confirmAbandonSession,
  copyStatus,
  copyText,
  createSessionCommand,
  createSessionTitle,
  currentActions,
  currentNext,
  currentStepDisabledReason,
  diffDialogOpen,
  diffError,
  diffLoading,
  diffPayload,
  draftEditorError,
  draftEditorFields,
  draftEditorLoading,
  draftEditorOpen,
  draftEditorSaving,
  draftEditorTitle,
  draftEditorValues,
  goNext,
  handleCodexPromptInjected,
  handleCodexPromptInjectionFailed,
  handleCodexTerminalBusyChanged,
  handleCodexSessionUpdate,
  handleCommandTerminalClosed,
  handleCommandTerminalFinished,
  handleCommandTerminalRunningChanged,
  handleAppReviewTerminalClosed,
  handleAppReviewTerminalStarted,
  issueRequestCanSubmit,
  issueRequestError,
  issueRequestFormVisible,
  issueRequestSubmitting,
  issueRequestSubmitTitle,
  issueRequestText,
  isSelectedSessionClosed,
  openAppReview,
  openAppReviewDisabled,
  openAppReviewTitle,
  openDiffDialog,
  pageError,
  pageLoading,
  requestAbandonSelectedSession,
  reviewDiffDisabled,
  reviewDiffTitle,
  rewindToStep,
  runAppReview,
  runAppReviewDisabled,
  runAppReviewTitle,
  runAction,
  runActionCommand,
  saveDraftEditor,
  sendIssueRequestPrompt,
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

const diffBodyElement = ref(null);

const combinedDiff = computed(() => {
  const payload = diffPayload.value || {};
  return [payload.stagedDiff, payload.unstagedDiff, payload.untrackedDiff]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join("\n");
});

const renderedDiff = computed(() => {
  if (!combinedDiff.value) {
    return "";
  }
  return renderDiffHtml(combinedDiff.value, {
    drawFileList: true,
    matching: "lines",
    outputFormat: "side-by-side"
  });
});

function handleDiffBodyClick(event) {
  const clickedElement = event.target instanceof Element ? event.target : null;
  const link = clickedElement?.closest("a");
  const diffBody = diffBodyElement.value?.$el || diffBodyElement.value;
  if (!link || !diffBody?.contains(link)) {
    return;
  }

  const href = String(link.getAttribute("href") || "");
  if (!href.startsWith("#")) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const target = document.getElementById(href.slice(1));
  if (target && diffBody.contains(target)) {
    target.scrollIntoView({
      block: "start",
      behavior: "smooth"
    });
  }
}
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
  grid-template-columns: minmax(18rem, 0.7fr) minmax(30rem, 1.3fr);
  min-height: 0;
}

.studio-ai-sessions__main,
.studio-ai-sessions__terminals {
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__facts {
  margin-top: 0.9rem;
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

.studio-ai-sessions__issue-request {
  display: grid;
  gap: 0.45rem;
}

.studio-ai-sessions__issue-request-input {
  max-width: 100%;
}

.studio-ai-sessions__notice {
  margin-top: 0.35rem;
}

.studio-ai-sessions__diff-dialog {
  max-height: 90vh;
}

.studio-ai-sessions__diff-title {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.studio-ai-sessions__diff-body {
  max-height: 72vh;
  overflow-x: hidden;
  overflow-y: auto;
}

.studio-ai-sessions__diff-status {
  background: rgba(var(--v-theme-surface-variant), 0.55);
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.35;
  margin: 0 0 0.75rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}

.studio-ai-sessions__diff-rendered {
  min-width: 0;
  overflow-x: hidden;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-wrapper) {
  color: #1f2937;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-file-wrapper) {
  border-color: rgba(var(--v-border-color), 0.34);
  border-radius: 8px;
  margin-bottom: 0.75rem;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-file-header) {
  border-radius: 8px 8px 0 0;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-files-diff),
.studio-ai-sessions__diff-rendered :deep(.d2h-file-side-diff) {
  min-width: 0;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-file-side-diff) {
  overflow-x: auto;
}

.studio-ai-sessions__abandon-dialog {
  border: 1px solid rgba(var(--v-theme-warning), 0.32);
}

.studio-ai-sessions__abandon-title,
.studio-ai-sessions__abandon-actions {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.studio-ai-sessions__abandon-actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}

.studio-ai-sessions__terminals {
  position: relative;
}

.studio-ai-sessions__command-overlay {
  background: rgba(var(--v-theme-surface), 0.94);
  border-radius: 8px;
  display: flex;
  inset: 0;
  padding: 0.5rem;
  position: absolute;
  z-index: 2;
}

.studio-ai-sessions__command-terminal {
  flex: 1 1 auto;
  box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.28);
  height: 100%;
}

@media (max-width: 980px) {
  .studio-ai-sessions__layout {
    grid-template-columns: 1fr;
  }

  .studio-ai-sessions__terminals {
    position: relative;
    top: auto;
  }
}

@media (min-width: 981px) {
  .studio-ai-sessions {
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    overflow: hidden;
  }

  .studio-ai-sessions__layout {
    align-items: stretch;
    height: 100%;
  }

  .studio-ai-sessions__main {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 0.25rem;
    scrollbar-gutter: stable;
  }

  .studio-ai-sessions__terminals {
    align-self: stretch;
    display: grid;
    overflow: hidden;
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
