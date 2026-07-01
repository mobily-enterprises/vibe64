<template>
  <section
    class="studio-autopilot"
    :class="{ 'studio-autopilot--chat-collapsed': chatCollapsed }"
  >
    <section
      class="studio-autopilot__chat-panel"
      aria-label="Session chat"
    >
      <div class="studio-autopilot__session-header">
        <div class="studio-autopilot__session-tabs-row">
          <Vibe64SessionToolbar
            v-if="sessionToolbarVisible"
            :abandon="sessionAbandon"
            compact
            :max-visible-sessions="3"
            :selected-session-id="sessionId"
            :selection-closed="sessionSelectionClosed"
            :toolbar="sessionToolbar"
          />
        </div>

        <Vibe64AutopilotNavigation
          class="studio-autopilot__nav"
          :busy="navigationBusy"
          :executing="workflowExecuting"
          layout="icons"
          :steps="autopilotSteps"
          @rewind="rewindToAutopilotStep"
        />
      </div>

      <Teleport
        v-if="sessionGithubActorHeaderVisible"
        :to="props.githubActorTeleportTarget"
      >
        <div
          class="studio-home-shell-session-github-actor"
          :class="{ 'studio-home-shell-session-github-actor--inactive': !sessionGithubActor.active }"
          :title="sessionGithubActor.title"
          role="status"
        >
          <v-icon
            :icon="mdiGithub"
            size="14"
          />
          <span>{{ sessionGithubActor.displayLabel }}</span>
        </div>
      </Teleport>

      <div
        ref="chatBodyElement"
        class="studio-autopilot__chat-body"
        :class="{
          'studio-autopilot__chat-body--artifact': chatTakeoverVisible,
          'studio-autopilot__chat-body--timeline-control': stepInputFormVisible || composerControlTimelineFormVisible
        }"
      >
        <Vibe64ConversationLog
          class="studio-autopilot__conversation"
          :error="conversationLog.error"
          :has-more-before="conversationLog.hasMoreBefore"
          :loading="conversationLog.loading"
          :loading-more="conversationLog.loadingMore"
          :load-more-error="conversationLog.loadMoreError"
          :reloadable="chatReloadAvailable"
          :reloading="chatReloading"
          :scroll-key="conversationScrollKey"
          :source-root="sessionSourceRoot"
          :turns="chatTurns"
          :visible="conversationLogVisible"
          @edit-turn="editOptimisticComposerTurn"
          @load-more="loadMoreChatTurns"
          @open-source-file="openSourceEditorFile"
          @reload="reloadChatPane"
          @resend-turn="resendOptimisticComposerTurn"
        />

        <template v-if="reportPreviewVisible">
          <Vibe64ReportPreview
            class="studio-autopilot__artifact"
            :error="reportPreview.error"
            :loading="reportPreview.loading"
            :text="reportPreview.text"
          />

          <article
            v-if="artifactControlFormVisible && !composerControlTimelineFormVisible"
            class="studio-autopilot__timeline-control studio-autopilot__artifact-control"
          >
            <Vibe64WorkflowControlForm
              class="studio-autopilot__inline-control"
              :can-submit-selected-control="canSubmitSelectedControl"
              :input-disabled="composerInputLocked"
              layout="start"
              :running="composerInputLocked"
              :selected-control="selectedComposerControl"
              :selected-control-fields="selectedControlFields"
              :selected-control-values="selectedControlValues"
              :workflow-controls="selectedWorkflowButtonControls"
              workflow-controls-with-open-form
              @answer-choice="submitSelectedAnswerChoice"
              @answer-choice-other="useFreeTextForAnswerChoice"
              @activate-control="activateWorkflowButtonControl"
              @cancel="clearSelectedControl"
              @submit="submitScreenComposerControl"
              @update-value="updateSelectedControlValue"
            />
          </article>

          <article
            v-if="composerControlTimelineFormVisible"
            class="studio-autopilot__timeline-control studio-autopilot__artifact-control"
          >
            <Vibe64WorkflowControlForm
              class="studio-autopilot__inline-control"
              :cancel-visible="composerControlCancelVisible"
              :can-submit-selected-control="composerControlCanSubmit"
              :input-disabled="composerControlInputDisabled"
              :input-disabled-reason="composerInlineInputDisabledReason"
              :layout="composerControlLayout"
              :running="composerControlRunning"
              :selected-control="composerControlSelectedControl"
              :selected-control-fields="composerControlFields"
              :selected-control-values="composerControlValues"
              :textarea-rows="composerControlTextareaRows"
              :workflow-controls="composerControlWorkflowControls"
              workflow-controls-with-open-form
              @answer-choice="submitSelectedAnswerChoice"
              @answer-choice-other="useFreeTextForAnswerChoice"
              @activate-control="activateWorkflowButtonControl"
              @cancel="clearSelectedControl"
              @submit="submitComposerControl"
              @update-value="updateComposerControlValue"
            />
          </article>

          <div
            v-if="artifactWorkflowActionsVisible && !composerControlTimelineFormVisible"
            class="studio-autopilot__actions studio-autopilot__screen-actions studio-autopilot__artifact-actions"
          >
            <v-btn
              v-for="control in workflowButtonControls"
              :key="control.id"
              :color="control.buttonColor"
              :disabled="control.disabled"
              :loading="control.loading"
              :prepend-icon="control.icon"
              size="small"
              :title="control.disabledReason || control.label"
              type="button"
              :variant="control.buttonVariant"
              @click="activateWorkflowButtonControl(control.sourceControl || control)"
            >
              {{ control.label }}
            </v-btn>
          </div>
        </template>

        <template v-else>
          <article
            v-if="stepInputFormVisible"
            ref="timelineControlElement"
            class="studio-autopilot__timeline-control"
          >
            <div class="studio-autopilot__timeline-control-form">
              <h2
                v-if="screenContentTitle"
                class="studio-autopilot__screen-title"
              >
                {{ screenContentTitle }}
              </h2>

              <p
                v-if="stepInput.prompt"
                class="studio-autopilot__timeline-control-prompt"
              >
                {{ stepInput.prompt }}
              </p>

              <Vibe64StepInputDisplayFields
                v-if="stepInputTimelineDisplayFields.length"
                :fields="stepInputTimelineDisplayFields"
                :values="stepInput.values"
              />

              <v-alert
                v-if="stepInput.error"
                type="warning"
                variant="tonal"
                density="compact"
              >
                {{ stepInput.error }}
              </v-alert>

              <div
                v-if="stepInputFallbackActionsVisible && !composerControlTimelineFormVisible"
                class="studio-autopilot__actions studio-autopilot__step-actions"
              >
                <Vibe64SessionActionButton
                  v-for="action in actions.currentActions"
                  :key="action.id"
                  :action="action"
                  :actions="stepInputActionHandlers"
                  :before-run="runActionFromStepInput"
                  :busy="page.busy || stepInput.saving"
                  variant="tonal"
                />
              </div>

              <Vibe64WorkflowControlForm
                v-if="composerControlTimelineFormVisible"
                class="studio-autopilot__inline-control studio-autopilot__timeline-decision-control"
                :cancel-visible="composerControlCancelVisible"
                :can-submit-selected-control="composerControlCanSubmit"
                :input-disabled="composerControlInputDisabled"
                :input-disabled-reason="composerInlineInputDisabledReason"
                :layout="composerControlLayout"
                :running="composerControlRunning"
                :selected-control="composerControlSelectedControl"
                :selected-control-fields="composerControlFields"
                :selected-control-values="composerControlValues"
                :textarea-rows="composerControlTextareaRows"
                :workflow-controls="composerControlWorkflowControls"
                workflow-controls-with-open-form
                @answer-choice="submitSelectedAnswerChoice"
                @answer-choice-other="useFreeTextForAnswerChoice"
                @activate-control="activateWorkflowButtonControl"
                @cancel="clearSelectedControl"
                @submit="submitComposerControl"
                @update-value="updateComposerControlValue"
              />
            </div>
          </article>
        </template>

        <article
          v-if="conversationTimelineControlVisible"
          ref="timelineControlElement"
          class="studio-autopilot__timeline-control studio-autopilot__conversation-control"
        >
          <Vibe64WorkflowControlForm
            class="studio-autopilot__inline-control"
            :cancel-visible="composerControlCancelVisible"
            :can-submit-selected-control="composerControlCanSubmit"
            :input-disabled="composerControlInputDisabled"
            :input-disabled-reason="composerInlineInputDisabledReason"
            :layout="composerControlLayout"
            :running="composerControlRunning"
            :selected-control="composerControlSelectedControl"
            :selected-control-fields="composerControlFields"
            :selected-control-values="composerControlValues"
            :textarea-rows="composerControlTextareaRows"
            :workflow-controls="composerControlWorkflowControls"
            workflow-controls-with-open-form
            @answer-choice="submitSelectedAnswerChoice"
            @answer-choice-other="useFreeTextForAnswerChoice"
            @activate-control="activateWorkflowButtonControl"
            @cancel="clearSelectedControl"
            @submit="submitComposerControl"
            @update-value="updateComposerControlValue"
          />
        </article>
        <div
          ref="chatBottomElement"
          class="studio-autopilot__chat-bottom"
          aria-hidden="true"
        />
      </div>

      <div
        class="studio-autopilot__thinking"
        :class="{ 'studio-autopilot__thinking--empty': !thinkingVisible }"
        role="status"
        :aria-hidden="thinkingVisible ? undefined : 'true'"
        aria-live="polite"
      >
        <span class="studio-autopilot__thinking-mark" />
        <span>{{ thinkingLabel }}</span>
        <button
          v-if="codexHandoffCancelVisible"
          class="studio-autopilot__handoff-cancel"
          type="button"
          @click="cancelCodexHandoff"
        >
          (cancel)
        </button>
      </div>

      <div
        class="studio-autopilot__runtime-status"
        :class="{ 'studio-autopilot__runtime-status--empty': !runtimeStatusVisible }"
        :aria-hidden="runtimeStatusVisible ? undefined : 'true'"
        aria-live="polite"
      >
        <Vibe64BackgroundTasks
          v-if="visibleBackgroundTasks.length || backgroundTaskError"
          compact
          :error="backgroundTaskError"
          :retrying-task-id="retryingBackgroundTaskId"
          :tasks="visibleBackgroundTasks"
          @retry="retryBackgroundTask"
        />

        <div
          v-for="message in runtimeNoticeMessages"
          :key="message.id"
          class="studio-autopilot__runtime-notice"
          :class="`studio-autopilot__runtime-notice--${message.tone}`"
        >
          <v-icon :icon="message.icon" size="15" />
          <span>{{ message.text }}</span>
        </div>
      </div>

      <div
        v-if="bottomComposerVisible"
        class="studio-autopilot__composer"
      >
        <div
          v-if="statusActionsVisible && !passiveComposerSteeringModeActive"
          class="studio-autopilot__status-actions"
        >
          <v-btn
            v-if="statusCodexStopVisible"
            class="studio-autopilot__stop-button studio-autopilot__stop-button--codex"
            color="error"
            :disabled="!codexStopEnabled"
            :prepend-icon="mdiStopCircleOutline"
            size="small"
            type="button"
            variant="tonal"
            @click="requestCodexInterrupt"
          >
            Stop Codex
          </v-btn>
          <v-btn
            v-if="screenStopAction"
            class="studio-autopilot__stop-button"
            :prepend-icon="mdiClose"
            size="small"
            type="button"
            variant="tonal"
            @click="stopScreenAction"
          >
            Stop Autopilot
          </v-btn>
          <v-btn
            v-if="stuckRecoveryAvailable"
            class="studio-autopilot__stop-button"
            :loading="stuckRecoveryRunning"
            :prepend-icon="mdiRefresh"
            size="small"
            type="button"
            variant="tonal"
            @click="recoverStuckStep"
          >
            Recover step
          </v-btn>
        </div>

        <Vibe64WorkflowControlForm
          v-if="composerControlComposerFormVisible"
          :key="composerControlFormKey"
          ref="screenControlFormRef"
          :agent-controls-visible="composerControlAgentControlsVisible"
          :agent-settings="currentAgentSettings"
          as-form
          :attach-textarea="composerControlAttachTextarea"
          :attachments-enabled="composerControlAttachmentsEnabled"
          class="studio-autopilot__control-form"
          :cancel-visible="composerControlCancelVisible"
          :can-submit-selected-control="composerControlCanSubmit"
          :composer-menu-items="composerMenuItems"
          :inline-submit="composerControlInlineSubmit"
          :inline-submit-label-visible="composerControlInlineSubmitLabelVisible"
          :input-disabled="composerControlInputDisabled"
          :input-disabled-reason="composerInlineInputDisabledReason"
          :interrupt-disabled="composerControlInterruptDisabled"
          :interrupt-visible="composerControlInterruptVisible"
          :layout="composerControlLayout"
          :running="composerControlRunning"
          :selected-control="composerControlSelectedControl"
          :selected-control-fields="composerControlFields"
          :selected-control-values="composerControlValues"
          :session-id="sessionId"
          :textarea-rows="composerControlTextareaRows"
          :workflow-controls="composerControlWorkflowControls"
          @answer-choice="submitSelectedAnswerChoice"
          @answer-choice-other="useFreeTextForAnswerChoice"
          @activate-control="activateWorkflowButtonControl"
          @cancel="clearSelectedControl"
          @composer-menu-item="activateComposerMenuItem"
          @interrupt="requestCodexInterrupt"
          @submit="submitComposerControl"
          @update-agent-setting="updateAgentSetting"
          @update-value="updateComposerControlValue"
        />

        <div
          v-if="bottomWorkflowActionsVisible"
          class="studio-autopilot__actions studio-autopilot__screen-actions"
        >
          <v-btn
            v-for="control in workflowButtonControls"
            :key="control.id"
            :color="control.buttonColor"
            :disabled="control.disabled"
            :loading="control.loading"
            :prepend-icon="control.icon"
            size="small"
            :title="control.disabledReason || control.label"
            type="button"
            :variant="control.buttonVariant"
            @click="activateWorkflowButtonControl(control.sourceControl || control)"
          >
            {{ control.label }}
          </v-btn>
        </div>
      </div>
    </section>

    <section class="studio-autopilot__project-panel" aria-label="Project">
      <section class="studio-autopilot__preview-panel">
        <v-btn
          v-if="activeSessionTool"
          aria-label="Close session tool"
          class="studio-autopilot__right-pane-close"
          :icon="mdiClose"
          size="small"
          title="Close session tool"
          type="button"
          variant="flat"
          @click="closeSessionTool"
        />
        <v-btn
          v-if="sourceEditorRestoreVisible"
          aria-label="Show editor"
          class="studio-autopilot__source-editor-restore"
          :icon="mdiEyeOutline"
          size="small"
          title="Show editor"
          type="button"
          variant="flat"
          @click="restoreSourceEditor"
        />

        <div
          v-if="commandSpyVisible"
          class="studio-autopilot__command-spy"
          :class="{ 'studio-autopilot__command-spy--expanded': commandSpyExpanded }"
        >
          <div class="studio-autopilot__command-spy-header">
            <div class="studio-autopilot__command-spy-title">
              <v-icon :icon="mdiConsoleLine" size="18" />
              <span>{{ commandOverlayTitle }}</span>
            </div>
            <div class="studio-autopilot__command-spy-actions">
              <v-btn
                v-if="commandRunning"
                :prepend-icon="mdiStopCircleOutline"
                size="small"
                type="button"
                variant="tonal"
                @click="stopCommandAction"
              >
                Stop
              </v-btn>
              <v-btn
                v-if="commandTerminalFailed"
                :prepend-icon="mdiRefresh"
                size="small"
                type="button"
                variant="tonal"
                @click="retryFromCommandFailure"
              >
                Retry
              </v-btn>
              <v-btn
                v-if="commandTerminalFailed"
                :prepend-icon="mdiRobotOutline"
                size="small"
                type="button"
                variant="tonal"
                @click="requestCommandAiFix"
              >
                Fix
              </v-btn>
              <v-btn
                :icon="commandSpyExpanded ? mdiChevronUp : mdiChevronDown"
                size="small"
                :title="commandSpyExpanded ? 'Collapse command output' : 'Expand command output'"
                type="button"
                variant="text"
                @click="commandSpyExpanded = !commandSpyExpanded"
              />
            </div>
          </div>
          <p v-if="!commandSpyExpanded" class="studio-autopilot__command-spy-summary">
            {{ commandTerminalFailed ? commandFailureSummary : commandTerminalSummary }}
          </p>
          <Vibe64HeadlessCommandOutput
            v-else
            class="studio-autopilot__command-terminal-output"
            :action-id="commandResult?.actionId || ''"
            :action-label="commandResult?.actionLabel || ''"
            :attempted-command="commandResult?.attemptedCommand || ''"
            :command-preview="commandPreview"
            compact
            :error="commandTerminalError"
            :exit-code="commandResult?.exitCode ?? null"
            :failed="commandTerminalFailed"
            :output="commandTerminalText"
            :running="commandRunning"
            :session-id="sessionId"
            :status="commandStatus"
            :terminal-session-id="commandResult?.terminalSessionId || ''"
            title="Autopilot command"
            @fix-requested="openFixCodexDialog"
          />
        </div>

        <Vibe64DashboardShell
          v-if="props.projectPane === 'dashboard'"
          class="studio-autopilot__dashboard-shell"
          :dashboard-context="dashboardSessionContext"
        >
          <div
            v-show="rightPaneTab === 'run'"
            class="studio-autopilot__right-pane-page"
            role="tabpanel"
          >
            <TargetScriptsPanel
              v-if="rightPaneTabMounted('run')"
              class="studio-autopilot__run-panel"
              mode="inspect"
              :session="session"
            />
          </div>

          <div
            v-show="rightPaneTab === 'editor'"
            class="studio-autopilot__right-pane-page studio-autopilot__editor-pane"
            role="tabpanel"
          >
            <Vibe64SessionSourceEditor
              v-if="rightPaneTabMounted('editor')"
              :active="rightPaneTab === 'editor'"
              :open-request="sourceEditorOpenRequest"
              :session-id="sessionId"
              :sessions-api-path="props.sessionsApiPath"
              @hide="hideSourceEditor"
            />
          </div>

          <div
            v-show="rightPaneTab === 'config'"
            class="studio-autopilot__right-pane-page studio-autopilot__config-pane"
            role="tabpanel"
          >
            <ProjectConfigSetup
              v-if="rightPaneTabMounted('config') && sessionConfigEditable"
              :saving="props.savingProjectConfig"
              :state="props.projectContext?.projectConfig || {}"
              @save="saveSessionProjectConfig"
            />
            <StudioErrorNotice
              v-else-if="rightPaneTabMounted('config')"
              title="Config unavailable"
              error="Create the session source before editing .vibe64 config."
              compact
            />
          </div>

          <div
            v-show="rightPaneTab === 'dashboard'"
            class="studio-autopilot__right-pane-page studio-autopilot__dashboard-pane"
            role="tabpanel"
          >
            <slot
              v-if="rightPaneTabMounted('dashboard')"
              name="dashboard"
              :dashboard-context="dashboardSessionContext"
            />
          </div>

          <div
            v-show="rightPaneTab === 'session-details'"
            class="studio-autopilot__right-pane-page"
            role="tabpanel"
          >
            <Vibe64SessionDetailsPane
              v-if="rightPaneTabMounted('session-details')"
              :context="dashboardSessionContext"
            />
          </div>

          <div
            v-show="rightPaneTab === 'diff'"
            class="studio-autopilot__right-pane-page studio-autopilot__diff-pane"
            role="tabpanel"
          >
            <Vibe64SessionDiffPanel
              v-if="rightPaneTabMounted('diff')"
              v-memo="[rightPaneTab, diff.payload, diff.error, diff.loading, review.diffDisabled, review.diffTitle]"
              :active="rightPaneTab === 'diff'"
              :diff="diff"
              :review="review"
            />
          </div>

          <div
            v-show="rightPaneTab === 'shell'"
            class="studio-autopilot__right-pane-page"
            role="tabpanel"
          >
            <slot
              v-if="rightPaneTabMounted('shell')"
              name="shell-terminal"
              :active="rightPaneTab === 'shell'"
            />
          </div>

          <div
            v-show="rightPaneTab === 'ai-terminal'"
            class="studio-autopilot__right-pane-page studio-autopilot__ai-terminal-pane"
            role="tabpanel"
          >
            <slot
              v-if="rightPaneTabMounted('ai-terminal')"
              name="ai-terminal"
              :active="rightPaneTab === 'ai-terminal'"
            />
          </div>
        </Vibe64DashboardShell>

        <div
          v-else
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <Vibe64LaunchControls
            auto-start-target-id="dev"
            button-label="Run"
            button-size="small"
            button-variant="tonal"
            :busy="page.busy || page.launchBusy"
            class="studio-autopilot__preview-launch"
            embedded-preview
            :preview-displayed="rightPaneTab === 'preview'"
            :session="session"
            :toolbar-teleport-target="rightPaneTab === 'preview' && props.projectPane === 'preview' ? props.previewToolbarTeleportTarget : ''"
            :window-displayed="props.active"
          />
        </div>
      </section>
    </section>

    <Vibe64FixCodexDialog
      v-if="fixDialogOpen || fixJob || fixTerminal"
      v-model="fixDialogOpen"
      :job="fixJob"
      :terminal="fixTerminal"
    />
  </section>
</template>

<script setup>
import { nextTick, ref, watch } from "vue";
import Vibe64BackgroundTasks from "@/components/studio/vibe64-session/Vibe64BackgroundTasks.vue";
import Vibe64AutopilotNavigation from "@/components/studio/vibe64-session/Vibe64AutopilotNavigation.vue";
import Vibe64ConversationLog from "@/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import Vibe64HeadlessCommandOutput from "@/components/studio/vibe64-session/Vibe64HeadlessCommandOutput.vue";
import Vibe64ReportPreview from "@/components/studio/vibe64-session/Vibe64ReportPreview.vue";
import Vibe64SessionActionButton from "@/components/studio/vibe64-session/Vibe64SessionActionButton.vue";
import Vibe64SessionDetailsPane from "@/components/studio/vibe64-session/Vibe64SessionDetailsPane.vue";
import Vibe64SessionSourceEditor from "@/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64StepInputDisplayFields from "@/components/studio/vibe64-session/Vibe64StepInputDisplayFields.vue";
import Vibe64WorkflowControlForm from "@/components/studio/vibe64-session/Vibe64WorkflowControlForm.vue";
import ProjectConfigSetup from "@/components/studio/ProjectConfigSetup.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import {
  useVibe64AutopilotView,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
} from "@/composables/useVibe64AutopilotView.js";

const emit = defineEmits(vibe64AutopilotViewEmits);
const props = defineProps(vibe64AutopilotViewProps);

const {
  Vibe64FixCodexDialog,
  TargetScriptsPanel,
  Vibe64LaunchControls,
  Vibe64SessionDiffPanel,
  activateComposerMenuItem,
  activateWorkflowButtonControl,
  activeSessionTool,
  artifactControlFormVisible,
  artifactWorkflowActionsVisible,
  backgroundTaskError,
  bottomComposerVisible,
  bottomWorkflowActionsVisible,
  canSubmitSelectedControl,
  chatCollapsed,
  chatReloadAvailable,
  chatReloading,
  chatTakeoverVisible,
  chatTurns,
  cancelCodexHandoff,
  clearSelectedControl,
  closeSessionTool,
  codexHandoffCancelVisible,
  codexStopEnabled,
  commandFailureSummary,
  commandOverlayTitle,
  commandPreview,
  commandResult,
  commandRunning,
  commandSpyExpanded,
  commandSpyVisible,
  commandStatus,
  commandTerminalError,
  commandTerminalFailed,
  commandTerminalSummary,
  commandTerminalText,
  composerControlAgentControlsVisible,
  composerControlAttachTextarea,
  composerControlAttachmentsEnabled,
  composerControlCancelVisible,
  composerControlCanSubmit,
  composerControlComposerFormVisible,
  composerControlFields,
  composerControlFormKey,
  composerControlInlineSubmit,
  composerControlInlineSubmitLabelVisible,
  composerControlInputDisabled,
  composerInlineInputDisabledReason,
  composerControlInterruptDisabled,
  composerControlInterruptVisible,
  composerControlLayout,
  composerControlRunning,
  composerControlSelectedControl,
  composerControlTextareaRows,
  composerControlTimelineFormVisible,
  composerControlValues,
  composerControlWorkflowControls,
  composerInputLocked,
  composerMenuItems,
  conversationTimelineControlVisible,
  conversationLogVisible,
  conversationScrollKey,
  currentAgentSettings,
  dashboardSessionContext,
  editOptimisticComposerTurn,
  fixDialogOpen,
  fixJob,
  fixTerminal,
  hideSourceEditor,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiConsoleLine,
  mdiEyeOutline,
  mdiGithub,
  mdiRefresh,
  mdiRobotOutline,
  mdiStopCircleOutline,
  navigationBusy,
  openFixCodexDialog,
  openSourceEditorFile,
  recoverStuckStep,
  reportPreviewVisible,
  requestCodexInterrupt,
  requestCommandAiFix,
  resendOptimisticComposerTurn,
  restoreSourceEditor,
  loadMoreChatTurns,
  reloadChatPane,
  retryBackgroundTask,
  retryFromCommandFailure,
  retryingBackgroundTaskId,
  rewindToAutopilotStep,
  rightPaneTab,
  rightPaneTabMounted,
  runActionFromStepInput,
  runtimeNoticeMessages,
  runtimeStatusVisible,
  screenContentTitle,
  screenStopAction,
  selectedComposerControl,
  selectedControlFields,
  selectedControlValues,
  selectedWorkflowButtonControls,
  sessionId,
  sessionConfigEditable,
  sessionSourceRoot,
  sessionGithubActor,
  sessionGithubActorHeaderVisible,
  sessionToolbarVisible,
  sourceEditorOpenRequest,
  sourceEditorRestoreVisible,
  statusCodexStopVisible,
  statusActionsVisible,
  stepInput,
  stepInputActionHandlers,
  stepInputFallbackActionsVisible,
  stepInputFormVisible,
  stepInputTimelineDisplayFields,
  stopCommandAction,
  stopScreenAction,
  stuckRecoveryAvailable,
  stuckRecoveryRunning,
  submitComposerControl,
  submitSelectedAnswerChoice,
  submitScreenComposerControl,
  thinkingLabel,
  thinkingVisible,
  updateAgentSetting,
  updateComposerControlValue,
  updateSelectedControlValue,
  useFreeTextForAnswerChoice,
  visibleBackgroundTasks,
  workflowButtonControls,
  workflowExecuting
} = useVibe64AutopilotView(props, emit);

function saveSessionProjectConfig(values = {}) {
  if (typeof props.saveProjectConfig === "function") {
    props.saveProjectConfig(values);
  }
}

const timelineControlElement = ref(null);
const chatBodyElement = ref(null);
const chatBottomElement = ref(null);

function scrollChatBodyToEnd() {
  const element = chatBodyElement.value;
  if (!element) {
    return;
  }
  element.scrollTop = element.scrollHeight;
  chatBottomElement.value?.scrollIntoView?.({
    block: "end"
  });
  element.scrollTop = element.scrollHeight;
}

async function scrollChatBodyToEndAfterLayout() {
  await nextTick();
  scrollChatBodyToEnd();
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(scrollChatBodyToEnd);
  }
}

function chatBodyScrollContainerActive() {
  return Boolean(
    chatTakeoverVisible.value ||
    conversationTimelineControlVisible.value ||
    stepInputFormVisible.value
  );
}

function scrollTimelineControlIntoView() {
  timelineControlElement.value?.scrollIntoView?.({
    block: "start"
  });
}

watch([
  stepInputFormVisible,
  conversationTimelineControlVisible
], async ([stepInputVisible, conversationControlVisible]) => {
  const visible = stepInputVisible || conversationControlVisible;
  if (!visible) {
    return;
  }
  await nextTick();
  scrollTimelineControlIntoView();
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(scrollTimelineControlIntoView);
  }
}, {
  flush: "post"
});

watch([
  conversationScrollKey,
  conversationTimelineControlVisible,
  reportPreviewVisible,
  stepInputFormVisible,
  () => props.active
], () => {
  if (!props.active || !chatBodyScrollContainerActive()) {
    return;
  }
  void scrollChatBodyToEndAfterLayout();
}, {
  flush: "post",
  immediate: true
});
</script>

<style scoped>
.studio-autopilot {
  background: rgb(var(--v-theme-background));
  display: grid;
  gap: 0.75rem;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__chat-panel,
.studio-autopilot__project-panel {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 14px;
  box-shadow: 0 0.75rem 2rem rgba(15, 23, 42, 0.06);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-autopilot__chat-panel {
  display: grid;
  gap: 0.1rem;
  grid-template-rows: auto minmax(0, 1fr) auto auto minmax(0, auto);
  overflow: hidden;
  padding: 0.04rem 0.12rem 0.04rem;
}

.studio-autopilot__project-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
}

.studio-autopilot__session-header {
  display: grid;
  gap: 0.28rem;
  min-width: 0;
}

.studio-autopilot__session-tabs-row {
  align-items: center;
  display: flex;
  gap: 0.34rem;
  min-width: 0;
  width: 100%;
}

.studio-autopilot__session-tabs-row :deep(.studio-ai-sessions__toolbar) {
  flex: 1 1 auto;
  min-width: 0;
}

.studio-home-shell-session-github-actor {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 650;
  gap: 0.24rem;
  line-height: 1;
  max-width: 100%;
  min-width: 0;
  padding: 0 0.36rem;
  white-space: nowrap;
}

.studio-home-shell-session-github-actor span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.studio-home-shell-session-github-actor--inactive {
  color: rgba(var(--v-theme-on-surface), 0.46);
}

.studio-autopilot__chat-body {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-height: 0;
  overflow: hidden;
  padding-right: 0.1rem;
  scrollbar-gutter: stable;
}

.studio-autopilot__chat-body--artifact {
  align-content: stretch;
  overflow-y: auto;
}

.studio-autopilot__chat-body--timeline-control {
  gap: 0.55rem;
  overflow-y: auto;
}

.studio-autopilot__conversation,
.studio-autopilot__artifact {
  min-height: 0;
}

.studio-autopilot__conversation {
  align-self: stretch;
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
}

.studio-autopilot__chat-body--timeline-control .studio-autopilot__conversation {
  align-self: stretch;
  display: block;
  flex: 0 0 auto;
  overflow: visible;
}

.studio-autopilot__chat-body--artifact .studio-autopilot__conversation {
  align-self: stretch;
  display: block;
  flex: 0 0 auto;
  overflow: visible;
}

.studio-autopilot__chat-body--artifact .studio-autopilot__artifact {
  flex: 0 0 auto;
}

.studio-autopilot__chat-body--artifact .studio-autopilot__conversation :deep(.studio-conversation-log__body) {
  overflow: visible;
}

.studio-autopilot__chat-body--timeline-control .studio-autopilot__conversation :deep(.studio-conversation-log__body) {
  overflow: visible;
}

.studio-autopilot__chat-body--timeline-control .studio-autopilot__conversation :deep(.studio-conversation-log__body > .studio-conversation-log__turn:first-child) {
  margin-top: 0;
}

.studio-autopilot__chat-bottom {
  flex: 0 0 auto;
  height: 1px;
}

.studio-autopilot__artifact :deep(.studio-report-preview__body) {
  max-height: none;
  min-height: 0;
}

.studio-autopilot__status-actions,
.studio-autopilot__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.32rem;
}

.studio-autopilot__status-actions {
  justify-content: flex-end;
}

.studio-autopilot__actions {
  justify-content: flex-end;
}

.studio-autopilot__step-actions,
.studio-autopilot__screen-actions {
  justify-content: flex-start;
}

.studio-autopilot__status-actions :deep(.v-btn),
.studio-autopilot__actions :deep(.v-btn),
.studio-autopilot__command-spy-actions :deep(.v-btn:not(.v-btn--icon)) {
  background: var(--studio-control-bg, #fff) !important;
  border: 1px solid var(--studio-control-border, rgba(17, 24, 39, 0.12));
  border-radius: var(--studio-control-radius, 7px);
  box-shadow: none !important;
  color: var(--studio-control-text, #202124) !important;
  font-weight: 500;
  letter-spacing: 0;
  min-height: 2rem;
}

.studio-autopilot__status-actions :deep(.v-btn:hover),
.studio-autopilot__actions :deep(.v-btn:hover),
.studio-autopilot__command-spy-actions :deep(.v-btn:not(.v-btn--icon):hover) {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
}

.studio-autopilot__actions :deep(.v-btn--variant-flat) {
  background: var(--studio-control-active-bg, #e7e7e7) !important;
  border-color: transparent;
}

.studio-autopilot__step-actions :deep(.v-btn--variant-flat),
.studio-autopilot__screen-actions :deep(.v-btn--variant-flat) {
  background: rgb(var(--v-theme-primary)) !important;
  border-color: rgb(var(--v-theme-primary)) !important;
  color: rgb(var(--v-theme-on-primary)) !important;
}

.studio-autopilot__step-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):hover),
.studio-autopilot__step-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):focus-visible),
.studio-autopilot__screen-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):hover),
.studio-autopilot__screen-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):focus-visible) {
  background: rgb(var(--v-theme-primary)) !important;
  border-color: rgb(var(--v-theme-primary)) !important;
  color: rgb(var(--v-theme-on-primary)) !important;
}

.studio-autopilot__step-actions :deep(.v-btn--variant-tonal),
.studio-autopilot__screen-actions :deep(.v-btn--variant-tonal) {
  background: rgba(var(--v-theme-primary), 0.1) !important;
  border-color: rgba(var(--v-theme-primary), 0.32) !important;
  color: rgb(var(--v-theme-primary)) !important;
}

.studio-autopilot__step-actions :deep(.v-btn--variant-outlined),
.studio-autopilot__screen-actions :deep(.v-btn--variant-outlined) {
  background: rgba(var(--v-theme-primary), 0.1) !important;
  border-color: rgba(var(--v-theme-primary), 0.32) !important;
  color: rgb(var(--v-theme-primary)) !important;
}

.studio-autopilot__status-actions :deep(.studio-autopilot__stop-button--codex) {
  background: rgba(var(--v-theme-error), 0.12) !important;
  border-color: rgba(var(--v-theme-error), 0.44) !important;
  color: rgb(var(--v-theme-error)) !important;
}

.studio-autopilot__composer {
  align-content: end;
  display: grid;
  gap: 0.14rem;
  max-height: min(46vh, 24rem);
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: 0.18rem 0 0;
  scrollbar-gutter: stable;
}

.studio-autopilot__control-form {
  display: grid;
  gap: 0.62rem;
  min-width: 0;
  width: 100%;
}

.studio-autopilot__screen-title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.02rem;
  font-weight: 680;
  line-height: 1.24;
  margin: 0;
  overflow-wrap: anywhere;
}

.studio-autopilot__timeline-control {
  display: grid;
  flex: 0 0 auto;
  min-width: 0;
  width: 100%;
}

.studio-autopilot__timeline-control-form {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
  width: 100%;
}

.studio-autopilot__timeline-control-prompt {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  line-height: 1.35;
  margin: 0;
}

.studio-autopilot__screen-actions {
  justify-content: flex-end;
}

.studio-autopilot__thinking {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: flex;
  font-size: 0.86rem;
  gap: 0.38rem;
  min-height: 1.35rem;
}

.studio-autopilot__handoff-cancel {
  appearance: none;
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-error));
  cursor: pointer;
  font: inherit;
  font-weight: 650;
  margin: 0;
  padding: 0 0.08rem;
}

.studio-autopilot__handoff-cancel:hover {
  text-decoration: underline;
}

.studio-autopilot__thinking--empty {
  display: none;
}

.studio-autopilot__runtime-status {
  display: grid;
  gap: 0.18rem;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-autopilot__runtime-status--empty {
  display: none;
}

.studio-autopilot__runtime-notice {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.68);
  display: flex;
  font-size: 0.78rem;
  gap: 0.35rem;
  line-height: 1.2;
  min-height: 1.35rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-autopilot__runtime-notice--success {
  color: rgb(var(--v-theme-success));
}

.studio-autopilot__runtime-notice--warning {
  color: rgb(var(--v-theme-warning));
}

.studio-autopilot__runtime-notice--error {
  color: rgb(var(--v-theme-error));
}

.studio-autopilot__runtime-notice span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.studio-autopilot__thinking-mark {
  animation: studio-autopilot-thinking-pulse 1.3s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  contain: paint;
  height: 0.48rem;
  transform: translateZ(0);
  will-change: opacity, transform;
  width: 0.48rem;
}

.studio-autopilot__preview-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  position: relative;
}

.studio-autopilot__right-pane-page {
  display: grid;
  grid-area: 1 / 1;
  min-height: 0;
  min-width: 0;
  position: relative;
  z-index: 1;
}

.studio-autopilot__dashboard-shell {
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__dashboard-shell :deep(.section-container-shell__content) {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.studio-autopilot__dashboard-shell .studio-autopilot__right-pane-page {
  height: 100%;
}

.studio-autopilot__right-pane-page--hidden {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  z-index: 0;
}

.studio-autopilot__diff-pane {
  contain: layout paint;
}

.studio-autopilot__right-pane-close {
  backdrop-filter: blur(4px);
  background: rgba(var(--v-theme-surface), 0.68) !important;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 999px;
  box-shadow: 0 0.25rem 0.7rem rgba(15, 23, 42, 0.08) !important;
  color: var(--studio-control-text, #202124) !important;
  left: -0.35rem;
  opacity: 0.6;
  position: absolute;
  top: -0.85rem;
  z-index: 5;
}

.studio-autopilot__right-pane-close:focus-visible,
.studio-autopilot__right-pane-close:hover {
  background: rgba(var(--v-theme-surface), 0.92) !important;
  opacity: 1;
}

.studio-autopilot__source-editor-restore {
  backdrop-filter: blur(4px);
  background: rgba(var(--v-theme-surface), 0.78) !important;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 999px;
  box-shadow: 0 0.25rem 0.7rem rgba(15, 23, 42, 0.08) !important;
  color: var(--studio-control-text, #202124) !important;
  left: 0.7rem;
  opacity: 0.76;
  position: absolute;
  top: 0.7rem;
  z-index: 6;
}

.studio-autopilot__source-editor-restore:focus-visible,
.studio-autopilot__source-editor-restore:hover {
  background: rgba(var(--v-theme-surface), 0.95) !important;
  opacity: 1;
}

.studio-autopilot__dashboard-pane {
  align-content: start;
  gap: 0.75rem;
  overflow-y: auto;
  padding: 0.85rem;
  scrollbar-gutter: stable;
}

.studio-autopilot__ai-terminal-pane :deep(.studio-ai-sessions__terminals) {
  transform: translateY(30px);
}

.studio-autopilot__preview-launch {
  height: 100%;
  min-height: 0;
}

.studio-autopilot__run-panel {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 0.85rem;
  scrollbar-gutter: stable;
}

.studio-autopilot__command-spy {
  background: rgba(var(--v-theme-surface), 0.96);
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 12px;
  box-shadow: 0 0.5rem 1.4rem rgba(15, 23, 42, 0.12);
  left: 0.75rem;
  padding: 0.55rem 0.65rem;
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  z-index: 4;
}

.studio-autopilot__command-spy--expanded {
  bottom: 0.75rem;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.studio-autopilot__command-spy-header {
  align-items: center;
  display: flex;
  gap: 0.65rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-autopilot__command-spy-title,
.studio-autopilot__command-spy-actions {
  align-items: center;
  display: flex;
  gap: 0.4rem;
  min-width: 0;
}

.studio-autopilot__command-spy-title {
  color: rgb(var(--v-theme-primary));
  font-weight: 720;
}

.studio-autopilot__command-spy-summary {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.82rem;
  line-height: 1.3;
  margin: 0.35rem 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-autopilot__command-terminal-output {
  height: 100%;
  margin-top: 0.5rem;
  min-height: 0;
  text-align: left;
}

.studio-autopilot__command-terminal-output :deep(.studio-headless-command-output__text) {
  border: 0;
  border-radius: 10px;
  min-height: 0;
}

@keyframes studio-autopilot-thinking-pulse {
  0%,
  100% {
    opacity: 0.5;
    transform: scale(0.9) translateZ(0);
  }

  50% {
    opacity: 1;
    transform: scale(1.1) translateZ(0);
  }
}

@media (min-width: 981px) {
  .studio-autopilot {
    grid-template-columns:
      minmax(
        var(--studio-home-chat-column-min-width, 24rem),
        var(--studio-home-chat-column-width, 30rem)
      )
      minmax(0, 1fr);
    height: 100%;
    overflow: hidden;
  }

  .studio-autopilot--chat-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-autopilot--chat-collapsed .studio-autopilot__chat-panel {
    display: none;
  }
}

@media (max-width: 980px) {
  .studio-autopilot {
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    overflow: hidden;
  }

  .studio-autopilot__project-panel {
    display: none;
  }

  .studio-autopilot--chat-collapsed .studio-autopilot__chat-panel {
    display: none;
  }

  .studio-autopilot--chat-collapsed .studio-autopilot__project-panel {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
  }
}
</style>
