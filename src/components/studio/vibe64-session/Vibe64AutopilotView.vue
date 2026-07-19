<template>
  <section
    class="studio-autopilot"
    :class="{
      'studio-autopilot--chat-collapsed': chatCollapsed,
      'studio-autopilot--task': agentTaskActive
    }"
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

        <div
          v-if="agentTaskActive"
          class="studio-autopilot__task-header"
        >
          <div class="studio-autopilot__task-title">
            <span>Focused task</span>
            <strong>{{ agentTask.label }}</strong>
            <small>{{ agentTaskStatusLabel }}</small>
          </div>
          <div class="studio-autopilot__task-actions">
            <v-btn
              v-if="agentTaskWaiting"
              :disabled="agentTaskRequestBusy"
              :prepend-icon="mdiCheck"
              size="x-small"
              type="button"
              variant="tonal"
              @click="finishAgentTask"
            >
              Finish
            </v-btn>
            <v-btn
              color="error"
              :disabled="agentTaskRequestBusy"
              :loading="agentTask.state === 'stopping'"
              :prepend-icon="mdiStopCircleOutline"
              size="x-small"
              type="button"
              variant="tonal"
              @click="stopAgentTask"
            >
              Stop
            </v-btn>
          </div>
        </div>

        <Vibe64AutopilotNavigation
          v-else
          class="studio-autopilot__nav"
          :busy="navigationBusy"
          :executing="workflowExecuting"
          layout="summary"
          :steps="autopilotSteps"
          @rewind="rewindToAutopilotStep"
        >
          <template #actions>
            <Vibe64SessionSourceSafetyButton
              :session-label="dashboardSessionContext.activeSessionNav.label"
              :source-safety="props.sourceSafety"
              @view-changes="dashboardSessionContext.activeSessionNav.selectTool('diff')"
            />
            <v-menu location="bottom end">
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  :icon="mdiDotsHorizontal"
                  size="small"
                  title="Session menu"
                  type="button"
                  variant="text"
                />
              </template>
              <v-list density="compact" nav>
                <v-list-item
                  v-for="tool in sessionHeaderTools"
                  :key="tool.id"
                  :disabled="tool.disabled"
                  :prepend-icon="tool.icon"
                  :subtitle="tool.disabled ? tool.title : ''"
                  :title="tool.label"
                  @click="openSessionHeaderTool(tool)"
                />
                <v-divider />
                <v-list-item
                  :disabled="sessionAbandonDisabled"
                  :prepend-icon="mdiClose"
                  title="Abandon session"
                  @click="requestSessionAbandon"
                />
              </v-list>
            </v-menu>
          </template>
        </Vibe64AutopilotNavigation>
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
          :assistant-label="agentTaskActive ? 'Task assistant' : 'Codex'"
          :error="agentTaskActive ? '' : conversationLog.error"
          :has-more-before="agentTaskActive ? false : conversationLog.hasMoreBefore"
          :loading="agentTaskActive ? false : conversationLog.loading"
          :loading-more="agentTaskActive ? false : conversationLog.loadingMore"
          :load-more-error="agentTaskActive ? '' : conversationLog.loadMoreError"
          :reloadable="chatReloadAvailable"
          :reloading="chatReloading"
          :scroll-key="conversationScrollKey"
          :source-root="sessionSourceRoot"
          :turns="chatTurns"
          :variant="agentTaskActive ? 'task' : 'main'"
          :visible="conversationLogVisible"
          @cancel-turn="cancelOptimisticComposerTurnAndFocus"
          @edit-turn="editOptimisticComposerTurnAndFocus"
          @load-more="loadMoreChatTurns"
          @open-source-file="openSourceEditorFile"
          @reload="reloadChatPane"
          @resend-turn="resendOptimisticComposerTurnAndFocus"
        />

        <template v-if="!agentTaskActive && reportPreviewVisible">
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

        <template v-else-if="!agentTaskActive">
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
                v-if="commandFailureResponseVisible"
                class="studio-autopilot__actions studio-autopilot__step-actions"
              >
                <v-btn
                  v-if="commandFailureChatMode"
                  :prepend-icon="mdiRefresh"
                  size="small"
                  type="button"
                  variant="tonal"
                  @click="returnToCommandFailureRecovery"
                >
                  Return to recovery
                </v-btn>
                <v-btn
                  :loading="commandFailureHelpSending"
                  :prepend-icon="mdiRobotOutline"
                  size="small"
                  type="button"
                  variant="tonal"
                  @click="askCodexAboutCommandFailure"
                >
                  Ask Codex for help
                </v-btn>
                <v-btn
                  :prepend-icon="mdiRobotOutline"
                  size="small"
                  type="button"
                  variant="tonal"
                  @click="requestCommandAiFix"
                >
                  Fix it with Codex
                </v-btn>
                <v-btn
                  v-if="!commandFailureChatMode"
                  :prepend-icon="mdiClose"
                  size="small"
                  type="button"
                  variant="text"
                  @click="backToChatFromCommandFailure"
                >
                  Back to chat
                </v-btn>
              </div>

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
          v-if="!agentTaskActive && conversationTimelineControlVisible"
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
      </div>

      <Vibe64SessionRecoveryNotice
        v-if="sessionRecovery"
        :error="sessionRecoveryError"
        :recovery="sessionRecovery"
        :resolving-key="sessionRecoveryResolvingKey"
        @resolve="resolveSessionRecovery"
      />

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
          v-if="!agentTaskActive && statusActionsVisible && !passiveComposerSteeringModeActive"
          class="studio-autopilot__status-actions"
        >
          <v-btn
            v-if="statusAgentStopVisible"
            class="studio-autopilot__stop-button studio-autopilot__stop-button--agent"
            color="error"
            :disabled="!agentStopEnabled"
            :prepend-icon="mdiStopCircleOutline"
            size="small"
            type="button"
            variant="tonal"
            @click="requestAgentInterruptAndFocus"
          >
            Stop assistant
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
          v-if="!agentTaskActive && composerControlComposerFormVisible"
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
          :preview-capture-busy="previewAttachmentState.captureBusy"
          :preview-capture-visible="previewAttachmentState.captureAvailable"
          :preview-diagnostics-available="previewAttachmentState.diagnosticsAvailable"
          :preview-diagnostics-busy="previewAttachmentState.diagnosticsBusy"
          :preview-diagnostics-visible="composerControlAttachmentsEnabled"
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
          @attach-preview-diagnostics="attachPreviewDiagnostics"
          @cancel="clearSelectedControl"
          @capture-preview="captureVisiblePreview"
          @composer-menu-item="activateComposerMenuItem"
          @composer-menu-item-text="insertComposerMenuItemText"
          @interrupt="requestAgentInterruptAndFocus"
          @submit="submitComposerControlAndFocus"
          @update-agent-setting="updateAgentSetting"
          @update-value="updateComposerControlValue"
        />

        <Vibe64WorkflowControlForm
          v-if="agentTaskActive"
          :key="agentTask.id"
          as-form
          attach-textarea
          :attachments-enabled="false"
          :can-submit-selected-control="agentTaskCanSubmit"
          :cancel-visible="false"
          class="studio-autopilot__control-form studio-autopilot__task-form"
          inline-submit
          :input-disabled="agentTaskRunning"
          :input-disabled-reason="agentTaskRunning ? 'Focused task is working…' : ''"
          :running="agentTaskRequestBusy"
          :selected-control="agentTaskControl"
          :selected-control-fields="agentTaskControl.inputFields"
          :selected-control-values="agentTaskValues"
          :session-id="sessionId"
          @submit="submitAgentTaskMessage"
          @update-value="updateAgentTaskDraft"
        />

        <div
          v-if="!agentTaskActive && bottomWorkflowActionsVisible"
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
        <div
          v-if="commandSpyVisible && commandTerminal"
          class="studio-autopilot__command-spy"
          :class="{ 'studio-autopilot__command-spy--expanded': commandSpyExpanded }"
        >
          <Vibe64Terminal
            :command-preview="commandPreview"
            :error="commandTerminalError"
            :expanded="commandSpyExpanded"
            :fill="commandSpyExpanded"
            :height="commandSpyExpanded ? '100%' : '0'"
            :output="commandTerminalText"
            :retryable="commandTerminalFailed && !commandFailureResponseVisible"
            :show-close="commandTerminalFailed"
            :show-copy="true"
            :show-interrupt="false"
            :status="commandStatus || (commandTerminalFailed ? 'failed' : '')"
            :subtitle="commandTerminalFailed ? commandFailureSummary : commandTerminalSummary"
            :terminal="commandTerminal"
            :title="commandOverlayTitle"
            :visible="commandSpyVisible"
            @close="dismissCommandFailureTerminal"
            @retry="retryFromCommandFailure"
            @update:expanded="commandSpyExpanded = $event"
          >
            <template #actions-before>
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
                :prepend-icon="mdiRobotOutline"
                size="small"
                type="button"
                variant="tonal"
                @click="requestCommandAiFix"
              >
                Fix
              </v-btn>
            </template>
          </Vibe64Terminal>
        </div>

        <Vibe64DashboardShell
          v-if="props.projectPane === 'dashboard'"
          v-show="dashboardShellVisible"
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
              error="Create the session source before editing project config."
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

        <Teleport to="body">
          <div
            v-if="immersivePortalFlightVisible"
            aria-hidden="true"
            class="studio-autopilot__file-portal-carrier"
            :class="`studio-autopilot__file-portal-carrier--${immersivePortalFlightPhase}`"
            :style="immersivePortalFlightStyle"
          >
            <div class="studio-autopilot__file-portal-carrier-halo" />
            <div class="studio-autopilot__file-portal-carrier-plate">
              <div class="studio-autopilot__file-portal-carrier-chrome">
                <span>FILE</span>
                <code>{{ immersiveEditorFile.path }}</code>
                <i />
              </div>
              <div class="studio-autopilot__file-portal-carrier-code">
                <span v-for="index in 14" :key="index" />
              </div>
              <div class="studio-autopilot__file-portal-carrier-scan" />
            </div>
            <div class="studio-autopilot__file-portal-carrier-sparks">
              <i v-for="index in 8" :key="index" />
            </div>
          </div>
        </Teleport>

        <section
          v-show="props.projectPane === 'dashboard' && (rightPaneTab === 'editor' || immersiveEditorOpen)"
          ref="immersiveEditorElement"
          :aria-label="immersiveEditorEngaged ? 'File City immersive source editor' : undefined"
          class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane studio-autopilot__editor-pane"
          :class="{
            'studio-autopilot__editor-pane--immersive': immersiveEditorEngaged,
            [`studio-autopilot__editor-pane--portal-${immersiveEditorPhase}`]: immersiveEditorEngaged
          }"
          :role="immersiveEditorEngaged ? 'dialog' : 'tabpanel'"
          @keydown.esc.stop="closeImmersiveSourceEditor()"
        >
          <div
            v-if="immersiveEditorEngaged"
            aria-hidden="true"
            class="studio-autopilot__file-portal-facade"
          >
            <span v-for="index in 12" :key="index" />
          </div>
          <v-btn
            v-if="immersiveEditorEngaged"
            aria-keyshortcuts="Escape"
            aria-label="Close file and return to File City"
            class="studio-autopilot__file-portal-close"
            :disabled="immersiveEditorTransitionBusy"
            :icon="mdiClose"
            size="large"
            title="Close file and return to File City (Esc)"
            type="button"
            variant="flat"
            @click="closeImmersiveSourceEditor()"
          />
          <header class="studio-autopilot__session-tool-header">
            <v-btn
              v-if="immersiveEditorEngaged"
              :prepend-icon="mdiClose"
              size="x-small"
              title="Close the source portal"
              type="button"
              variant="tonal"
              @click="closeImmersiveSourceEditor()"
            >
              Return to File City
            </v-btn>
            <span
              v-if="immersiveEditorEngaged"
              class="studio-autopilot__file-portal-path"
              :title="immersiveEditorFile.path"
            >
              {{ immersiveEditorFile.path }}
            </span>
            <v-btn
              v-if="!immersiveEditorEngaged && systemBackAvailable"
              :prepend-icon="mdiArrowLeft"
              size="x-small"
              title="Return to the System world"
              type="button"
              variant="tonal"
              @click="backToSystemFromEditor"
            >
              Back to System
            </v-btn>
            <v-btn
              v-if="!immersiveEditorEngaged"
              :prepend-icon="mdiArrowLeft"
              size="x-small"
              title="Back to dashboard"
              type="button"
              variant="tonal"
              @click="backToDashboard"
            >
              Back to dashboard
            </v-btn>
          </header>
          <Vibe64SessionSourceEditor
            v-if="rightPaneTabMounted('editor') || immersiveEditorMounted"
            :active="props.projectPane === 'dashboard' && (rightPaneTab === 'editor' || immersiveEditorEngaged)"
            :ask-codex-available="sourceEditorAskCodexAvailable"
            class="studio-autopilot__session-tool-content"
            :code-focus-mode="immersiveEditorEngaged"
            :navigate-referenced-source="navigateImmersiveSourceReference"
            :open-request="immersiveEditorEngaged ? immersiveEditorOpenRequest : sourceEditorOpenRequest"
            :open-sync-state="props.session?.uiSync?.sourceEditor || null"
            :project-slug="projectSlug"
            :session-id="sessionId"
            :sessions-api-path="props.sessionsApiPath"
            :source-path-click-without-modifier="immersiveEditorEngaged"
            @ask-codex-about-file="askCodexAboutSourceEditorFile"
          />
        </section>

        <section
          v-show="props.projectPane === 'dashboard' && rightPaneTab === 'system'"
          class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane studio-autopilot__system-pane"
          role="tabpanel"
        >
          <header class="studio-autopilot__session-tool-header">
            <v-btn
              :prepend-icon="mdiArrowLeft"
              size="x-small"
              title="Back to dashboard"
              type="button"
              variant="tonal"
              @click="backToDashboard"
            >
              Back to dashboard
            </v-btn>
          </header>
          <Vibe64SystemWorldView
            v-if="rightPaneTabMounted('system')"
            ref="systemWorldView"
            :active="props.projectPane === 'dashboard' && rightPaneTab === 'system'"
            :ask-chat-available="sourceEditorAskCodexAvailable"
            class="studio-autopilot__session-tool-content"
            :resolve-request-url="resolveStudioRequestUrl"
            :restore-request="systemRestoreRequest"
            :session-id="sessionId"
            @ask-in-chat="askSystemContextAndFocus"
            @open-source-file-immersive="openImmersiveSourceEditor"
            @open-source-file="openSourceEditorFile"
          />
        </section>

        <section
          v-show="props.projectPane === 'dashboard' && rightPaneTab === 'diff'"
          class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane studio-autopilot__diff-pane"
          role="tabpanel"
        >
          <header class="studio-autopilot__session-tool-header">
            <v-btn
              :prepend-icon="mdiArrowLeft"
              size="x-small"
              title="Back to dashboard"
              type="button"
              variant="tonal"
              @click="backToDashboard"
            >
              Back to dashboard
            </v-btn>
          </header>
          <Vibe64SessionDiffPanel
            v-if="rightPaneTabMounted('diff')"
            v-memo="[rightPaneTab, diff.payload, diff.error, diff.loading, review.diffDisabled, review.diffTitle]"
            :active="props.projectPane === 'dashboard' && rightPaneTab === 'diff'"
            class="studio-autopilot__session-tool-content"
            :diff="diff"
            :review="review"
            @open-source-file="openSourceEditorFile"
          />
        </section>

        <div
          v-show="props.projectPane !== 'dashboard'"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <Vibe64LaunchControls
            :attach-preview-file="attachPreviewFile"
            :auto-start-managed-preview="!props.sessionSelectionClosed"
            button-label="Run"
            button-size="small"
            button-variant="tonal"
            :busy="page.busy || page.launchBusy"
            class="studio-autopilot__preview-launch"
            embedded-preview
            :preview-displayed="rightPaneTab === 'preview' && props.projectPane === 'preview'"
            :session="session"
            :toolbar-teleport-target="rightPaneTab === 'preview' && props.projectPane === 'preview' ? props.previewToolbarTeleportTarget : ''"
            :window-displayed="props.active"
            @preview-attachment-state="updatePreviewAttachmentState"
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
import { computed, defineAsyncComponent, nextTick, onBeforeUpdate, onUpdated, ref, watch } from "vue";
import { mdiDotsHorizontal } from "@mdi/js";
import Vibe64BackgroundTasks from "@/components/studio/vibe64-session/Vibe64BackgroundTasks.vue";
import Vibe64AutopilotNavigation from "@/components/studio/vibe64-session/Vibe64AutopilotNavigation.vue";
import Vibe64ConversationLog from "@/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import Vibe64Terminal from "@/components/studio/Vibe64Terminal.vue";
import Vibe64ReportPreview from "@/components/studio/vibe64-session/Vibe64ReportPreview.vue";
import Vibe64SessionActionButton from "@/components/studio/vibe64-session/Vibe64SessionActionButton.vue";
import Vibe64SessionDetailsPane from "@/components/studio/vibe64-session/Vibe64SessionDetailsPane.vue";
import Vibe64SessionRecoveryNotice from "@/components/studio/vibe64-session/Vibe64SessionRecoveryNotice.vue";
import Vibe64SessionSourceEditor from "@/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue";
import Vibe64SessionSourceSafetyButton from "@/components/studio/vibe64-session/Vibe64SessionSourceSafetyButton.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64StepInputDisplayFields from "@/components/studio/vibe64-session/Vibe64StepInputDisplayFields.vue";
import Vibe64WorkflowControlForm from "@/components/studio/vibe64-session/Vibe64WorkflowControlForm.vue";
import ProjectConfigSetup from "@/components/studio/ProjectConfigSetup.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import {
  useVibe64AutopilotView,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
} from "@/composables/useVibe64AutopilotView.js";

const emit = defineEmits(vibe64AutopilotViewEmits);
const props = defineProps(vibe64AutopilotViewProps);
const Vibe64SystemWorldView = defineAsyncComponent(() => (
  import("@local/vibe64-system-graph/client").then((module) => module.loadVibe64SystemWorldView())
));

const {
  Vibe64FixCodexDialog,
  TargetScriptsPanel,
  Vibe64LaunchControls,
  Vibe64SessionDiffPanel,
  activateComposerMenuItem,
  activateWorkflowButtonControl,
  agentTask,
  agentTaskActive,
  agentTaskCanSubmit,
  agentTaskControl,
  agentTaskRequestBusy,
  agentTaskRunning,
  agentTaskStatusLabel,
  agentTaskValues,
  agentTaskWaiting,
  askCodexAboutCommandFailure,
  askCodexAboutSystemContext,
  askCodexAboutSourceEditorFile,
  artifactControlFormVisible,
  artifactWorkflowActionsVisible,
  backToChatFromCommandFailure,
  backToDashboard,
  backToSystemFromEditor,
  backgroundTaskError,
  bottomComposerVisible,
  bottomWorkflowActionsVisible,
  canSubmitSelectedControl,
  chatCollapsed,
  chatReloadAvailable,
  chatReloading,
  chatTakeoverVisible,
  chatTurns,
  clearSelectedControl,
  agentStopEnabled,
  commandFailureChatMode,
  commandFailureHelpSending,
  commandFailureResponseVisible,
  commandFailureSummary,
  commandOverlayTitle,
  commandPreview,
  commandRunning,
  commandSpyExpanded,
  commandSpyVisible,
  commandStatus,
  commandTerminalError,
  commandTerminalFailed,
  commandTerminal,
  commandTerminalSummary,
  commandTerminalText,
  dismissCommandFailureTerminal,
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
  cancelOptimisticComposerTurn,
  dashboardShellVisible,
  dashboardSessionContext,
  editOptimisticComposerTurn,
  fixDialogOpen,
  fixJob,
  fixTerminal,
  finishAgentTask,
  insertComposerMenuItemText,
  mdiArrowLeft,
  mdiCheck,
  mdiClose,
  mdiGithub,
  mdiRefresh,
  mdiRobotOutline,
  mdiStopCircleOutline,
  navigationBusy,
  openSourceEditorFile,
  projectSlug,
  recoverStuckStep,
  reportPreviewVisible,
  returnToCommandFailureRecovery,
  requestAgentInterrupt,
  requestCommandAiFix,
  resolveSessionRecovery,
  resendOptimisticComposerTurn,
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
  screenControlFormRef,
  screenStopAction,
  selectedComposerControl,
  selectedControlFields,
  selectedControlValues,
  selectedWorkflowButtonControls,
  sessionId,
  sessionRecovery,
  sessionRecoveryError,
  sessionRecoveryResolvingKey,
  sessionConfigEditable,
  sessionSourceRoot,
  sessionGithubActor,
  sessionGithubActorHeaderVisible,
  sessionToolbarVisible,
  sourceEditorAskCodexAvailable,
  sourceEditorOpenRequest,
  systemBackAvailable,
  systemRestoreRequest,
  statusAgentStopVisible,
  statusActionsVisible,
  stepInput,
  stepInputActionHandlers,
  stepInputFallbackActionsVisible,
  stepInputFormVisible,
  stepInputTimelineDisplayFields,
  stopCommandAction,
  stopAgentTask,
  stopScreenAction,
  stuckRecoveryAvailable,
  stuckRecoveryRunning,
  submitComposerControl,
  submitAgentTaskMessage,
  submitSelectedAnswerChoice,
  submitScreenComposerControl,
  thinkingLabel,
  thinkingVisible,
  updateAgentSetting,
  updateAgentTaskDraft,
  updateComposerControlValue,
  updateSelectedControlValue,
  useFreeTextForAnswerChoice,
  visibleBackgroundTasks,
  workflowButtonControls,
  workflowExecuting
} = useVibe64AutopilotView(props, emit);

const sessionHeaderTools = computed(() => [
  "editor",
  "diff",
  "session-details"
].map((toolId) => dashboardSessionContext.value.activeSessionNav.tools.find((tool) => tool.id === toolId))
  .filter(Boolean));
const sessionAbandonDisabled = computed(() => Boolean(
  props.sessionSelectionClosed ||
  props.sessionAbandon?.command?.isRunning
));

function openSessionHeaderTool(tool = {}) {
  if (!tool.disabled) {
    dashboardSessionContext.value.activeSessionNav.selectTool?.(tool.id);
  }
}

function requestSessionAbandon() {
  if (!sessionAbandonDisabled.value) {
    props.sessionAbandon?.request?.();
  }
}

function saveSessionProjectConfig(values = {}) {
  if (typeof props.saveProjectConfig === "function") {
    props.saveProjectConfig(values, {
      sessionId: props.session?.sessionId || props.session?.id || ""
    });
  }
}

const previewAttachmentState = ref({
  attachDiagnostics: null,
  capture: null,
  captureAvailable: false,
  captureBusy: false,
  diagnosticsAvailable: false,
  diagnosticsBusy: false
});

function updatePreviewAttachmentState(state = {}) {
  previewAttachmentState.value = {
    attachDiagnostics: typeof state.attachDiagnostics === "function" ? state.attachDiagnostics : null,
    capture: typeof state.capture === "function" ? state.capture : null,
    captureAvailable: state.captureAvailable === true,
    captureBusy: state.captureBusy === true,
    diagnosticsAvailable: state.diagnosticsAvailable === true,
    diagnosticsBusy: state.diagnosticsBusy === true
  };
}

function captureVisiblePreview() {
  return previewAttachmentState.value.capture?.();
}

function attachPreviewDiagnostics() {
  return previewAttachmentState.value.attachDiagnostics?.();
}

async function attachPreviewFile(file) {
  const uploaded = await screenControlFormRef.value?.attachFiles?.([file]);
  if (!Array.isArray(uploaded) || uploaded.length < 1) {
    throw new Error("Open the chat composer before attaching a preview file.");
  }
  return uploaded[0];
}

const IMMERSIVE_EDITOR_REVEAL_MS = 140;
const IMMERSIVE_PORTAL_FLIGHT_MS = 490;
const immersiveEditorElement = ref(null);
const immersiveEditorEngaged = ref(false);
const immersiveEditorFile = ref({});
const immersiveEditorMounted = ref(false);
const immersiveEditorOpen = ref(false);
const immersiveEditorOpenRequest = ref(null);
const immersiveEditorPhase = ref("closed");
const immersiveEditorReturnView = ref(null);
const immersiveEditorTransitionBusy = ref(false);
const immersivePortalFlightPhase = ref("idle");
const immersivePortalFlightStyle = ref({});
const immersivePortalFlightVisible = ref(false);
const systemWorldView = ref(null);
let immersiveEditorOpenSequence = 0;
let immersiveEditorTransitionGeneration = 0;

function immersivePortalFlightDuration() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
    ? 0
    : IMMERSIVE_PORTAL_FLIGHT_MS;
}

function waitForImmersiveEditorFrame() {
  return new Promise((resolve) => {
    const requestFrame = globalThis.requestAnimationFrame || (
      (callback) => globalThis.setTimeout(callback, 16)
    );
    requestFrame(() => resolve());
  });
}

function waitForImmersiveEditorTransition(duration) {
  return duration > 0
    ? new Promise((resolve) => globalThis.setTimeout(resolve, duration))
    : Promise.resolve();
}

function setImmersiveEditorRequest(target = {}) {
  const path = String(target.path || "").trim();
  if (!path) {
    return false;
  }
  immersiveEditorOpenSequence += 1;
  immersiveEditorOpenRequest.value = {
    column: Number(target.column || 0) || 0,
    line: Number(target.line || 0) || 0,
    path,
    sequence: immersiveEditorOpenSequence
  };
  return true;
}

function clearImmersivePortalFlight() {
  immersivePortalFlightPhase.value = "idle";
  immersivePortalFlightStyle.value = {};
  immersivePortalFlightVisible.value = false;
}

function portalClipPercentage(value) {
  return Number.isFinite(value)
    ? Math.max(-12, Math.min(112, value))
    : 0;
}

function measureImmersivePortalFlight(anchor = null) {
  const element = immersiveEditorElement.value;
  if (!element) {
    immersivePortalFlightStyle.value = {};
    return false;
  }
  const target = element.getBoundingClientRect();
  if (target.width <= 0 || target.height <= 0) {
    immersivePortalFlightStyle.value = {};
    return false;
  }
  const surface = anchor?.surface || anchor || {};
  const sourceWidth = Math.max(2, Number(surface.width) || 28);
  const sourceHeight = Math.max(2, Number(surface.height) || 20);
  const sourceX = Number.isFinite(Number(surface.x))
    ? Number(surface.x)
    : target.left + target.width / 2 - sourceWidth / 2;
  const sourceY = Number.isFinite(Number(surface.y))
    ? Number(surface.y)
    : target.top + target.height / 2 - sourceHeight / 2;
  const shiftX = sourceX + sourceWidth / 2 - (target.left + target.width / 2);
  const shiftY = sourceY + sourceHeight / 2 - (target.top + target.height / 2);
  const scaleX = Math.max(0.006, Math.min(1.1, sourceWidth / target.width));
  const scaleY = Math.max(0.006, Math.min(1.1, sourceHeight / target.height));
  const distance = Math.hypot(shiftX, shiftY);
  const arc = Math.max(34, Math.min(110, distance * 0.18));
  const liftScaleX = Math.min(1.15, scaleX * 1.16);
  const liftScaleY = Math.min(1.15, scaleY * 1.16);
  const midScaleX = Math.max(0.38, Math.min(0.82, (scaleX + 1) * 0.48));
  const midScaleY = Math.max(0.38, Math.min(0.82, (scaleY + 1) * 0.48));
  const surfacePoints = Array.isArray(surface.points) ? surface.points : [];
  const sourceClip = surfacePoints.length === 4
    ? `polygon(${surfacePoints.map((point) => {
      const x = portalClipPercentage((Number(point?.x) - sourceX) / sourceWidth * 100);
      const y = portalClipPercentage((Number(point?.y) - sourceY) / sourceHeight * 100);
      return `${x.toFixed(2)}% ${y.toFixed(2)}%`;
    }).join(", ")})`
    : "polygon(0 0, 100% 0, 100% 100%, 0 100%)";
  immersivePortalFlightStyle.value = {
    "--file-portal-carrier-absorb-transform": `translate3d(${shiftX}px, ${shiftY}px, 0) scale(${scaleX * 0.72}, ${scaleY * 0.72})`,
    "--file-portal-carrier-duration": `${IMMERSIVE_PORTAL_FLIGHT_MS}ms`,
    "--file-portal-carrier-lift-transform": `translate3d(${shiftX}px, ${shiftY - Math.min(28, arc * 0.32)}px, 0) scale(${liftScaleX}, ${liftScaleY})`,
    "--file-portal-carrier-mid-transform": `translate3d(${shiftX * 0.44}px, ${shiftY * 0.44 - arc}px, 0) scale(${midScaleX}, ${midScaleY})`,
    "--file-portal-carrier-origin-transform": `translate3d(${shiftX}px, ${shiftY}px, 0) scale(${scaleX}, ${scaleY})`,
    "--file-portal-carrier-source-clip": sourceClip,
    height: `${target.height}px`,
    left: `${target.left}px`,
    top: `${target.top}px`,
    width: `${target.width}px`
  };
  return true;
}

async function enterImmersiveEditor(anchor = null, generation = immersiveEditorTransitionGeneration) {
  immersiveEditorOpen.value = true;
  immersiveEditorPhase.value = "measuring";
  clearImmersivePortalFlight();
  await nextTick();
  if (generation !== immersiveEditorTransitionGeneration) {
    return false;
  }
  const duration = immersivePortalFlightDuration();
  if (duration === 0 || !measureImmersivePortalFlight(anchor)) {
    immersiveEditorPhase.value = "open";
    return true;
  }
  immersivePortalFlightVisible.value = true;
  immersivePortalFlightPhase.value = "origin";
  await nextTick();
  await waitForImmersiveEditorFrame();
  if (generation !== immersiveEditorTransitionGeneration) {
    return false;
  }
  immersivePortalFlightPhase.value = "flying";
  await waitForImmersiveEditorTransition(duration * 0.68);
  if (generation !== immersiveEditorTransitionGeneration) {
    return false;
  }
  immersiveEditorPhase.value = "landing";
  await waitForImmersiveEditorTransition(duration * 0.32);
  if (generation !== immersiveEditorTransitionGeneration) {
    return false;
  }
  immersiveEditorPhase.value = "open";
  immersivePortalFlightPhase.value = "dissolving";
  await waitForImmersiveEditorTransition(IMMERSIVE_EDITOR_REVEAL_MS);
  if (generation === immersiveEditorTransitionGeneration) {
    clearImmersivePortalFlight();
  }
  return generation === immersiveEditorTransitionGeneration;
}

async function exitImmersiveEditorToAnchor(anchor, generation) {
  const duration = immersivePortalFlightDuration();
  if (duration === 0 || !measureImmersivePortalFlight(anchor)) {
    immersiveEditorPhase.value = "closing";
    systemWorldView.value?.closeImmersiveFilePortal?.({ immediate: duration === 0 });
    await waitForImmersiveEditorTransition(duration === 0 ? 0 : IMMERSIVE_EDITOR_REVEAL_MS);
    return generation === immersiveEditorTransitionGeneration;
  }
  immersivePortalFlightVisible.value = true;
  immersivePortalFlightPhase.value = "destination";
  await nextTick();
  await waitForImmersiveEditorFrame();
  if (generation !== immersiveEditorTransitionGeneration) {
    return false;
  }
  immersiveEditorPhase.value = "closing";
  immersivePortalFlightPhase.value = "returning";
  await waitForImmersiveEditorTransition(duration);
  if (generation !== immersiveEditorTransitionGeneration) {
    return false;
  }
  systemWorldView.value?.closeImmersiveFilePortal?.();
  immersivePortalFlightPhase.value = "absorbing";
  await waitForImmersiveEditorTransition(IMMERSIVE_EDITOR_REVEAL_MS * 0.82);
  if (generation === immersiveEditorTransitionGeneration) {
    clearImmersivePortalFlight();
  }
  return generation === immersiveEditorTransitionGeneration;
}

async function openImmersiveSourceEditor(target = {}) {
  if (immersiveEditorTransitionBusy.value || !setImmersiveEditorRequest(target)) {
    return false;
  }
  const generation = ++immersiveEditorTransitionGeneration;
  immersiveEditorTransitionBusy.value = true;
  immersiveEditorMounted.value = true;
  immersiveEditorEngaged.value = true;
  immersiveEditorReturnView.value = target.returnView || target.systemContext?.camera || null;
  immersiveEditorFile.value = {
    fileId: String(target.fileId || ""),
    fileKey: String(target.fileKey || ""),
    path: String(target.path || "")
  };
  try {
    return await enterImmersiveEditor(target.anchor || null, generation);
  } finally {
    if (generation === immersiveEditorTransitionGeneration) {
      immersiveEditorTransitionBusy.value = false;
    }
  }
}

function resetImmersiveSourceEditor() {
  immersiveEditorTransitionGeneration += 1;
  clearImmersivePortalFlight();
  systemWorldView.value?.closeImmersiveFilePortal?.({ immediate: true });
  if (immersiveEditorReturnView.value) {
    void systemWorldView.value?.restoreImmersiveView?.(
      immersiveEditorReturnView.value,
      { immediate: true }
    );
  }
  immersiveEditorEngaged.value = false;
  immersiveEditorOpen.value = false;
  immersiveEditorPhase.value = "closed";
  immersiveEditorReturnView.value = null;
  immersiveEditorTransitionBusy.value = false;
}

async function closeImmersiveSourceEditor({ immediate = false } = {}) {
  if (!immersiveEditorEngaged.value || immersiveEditorTransitionBusy.value) {
    return false;
  }
  if (immediate) {
    resetImmersiveSourceEditor();
    return true;
  }
  const generation = ++immersiveEditorTransitionGeneration;
  immersiveEditorTransitionBusy.value = true;
  const returnView = immersiveEditorReturnView.value;
  const anchor = systemWorldView.value?.immersiveFileAnchor?.(immersiveEditorFile.value.path) || null;
  if (!await exitImmersiveEditorToAnchor(anchor, generation)) {
    return false;
  }
  immersiveEditorEngaged.value = false;
  immersiveEditorOpen.value = false;
  immersiveEditorPhase.value = "closed";
  try {
    await systemWorldView.value?.restoreImmersiveView?.(returnView);
  } catch {
    await systemWorldView.value?.restoreImmersiveView?.(returnView, { immediate: true });
  }
  if (generation !== immersiveEditorTransitionGeneration) {
    return false;
  }
  immersiveEditorReturnView.value = null;
  immersiveEditorTransitionBusy.value = false;
  return true;
}

async function navigateImmersiveSourceReference(navigation = {}) {
  const path = String(navigation.path || "").trim();
  if (
    !immersiveEditorEngaged.value ||
    immersiveEditorTransitionBusy.value ||
    !path ||
    path === immersiveEditorFile.value.path
  ) {
    return false;
  }
  if (!systemWorldView.value?.hasImmersiveFile?.(path)) {
    immersiveEditorFile.value = {
      fileId: "",
      fileKey: "",
      path
    };
    return false;
  }

  const generation = ++immersiveEditorTransitionGeneration;
  immersiveEditorTransitionBusy.value = true;
  const sourceAnchor = systemWorldView.value?.immersiveFileAnchor?.(immersiveEditorFile.value.path) || null;
  if (!await exitImmersiveEditorToAnchor(sourceAnchor, generation)) {
    return true;
  }
  immersiveEditorOpen.value = false;
  immersiveEditorPhase.value = "traveling";
  setImmersiveEditorRequest(navigation);

  try {
    const destination = await systemWorldView.value?.travelImmersiveFile?.(path);
    if (generation !== immersiveEditorTransitionGeneration) {
      systemWorldView.value?.closeImmersiveFilePortal?.({ immediate: true });
      return true;
    }
    immersiveEditorFile.value = {
      fileId: String(destination?.fileId || ""),
      fileKey: String(destination?.fileKey || ""),
      path
    };
    await enterImmersiveEditor(destination?.anchor || null, generation);
    return true;
  } catch {
    if (generation === immersiveEditorTransitionGeneration) {
      await enterImmersiveEditor(null, generation);
    }
    return true;
  } finally {
    if (generation === immersiveEditorTransitionGeneration) {
      immersiveEditorTransitionBusy.value = false;
    }
  }
}

watch([() => props.projectPane, rightPaneTab, sessionId], ([projectPane, pane, nextSessionId], previous = []) => {
  if (!immersiveEditorEngaged.value) {
    return;
  }
  const sessionChanged = previous.length > 0 && nextSessionId !== previous[2];
  if (projectPane !== "dashboard" || pane !== "system" || sessionChanged) {
    resetImmersiveSourceEditor();
  }
});

const timelineControlElement = ref(null);
const chatBodyElement = ref(null);
const chatBottomElement = ref(null);
let pendingComposerFocus = null;

function focusBottomComposer() {
  pendingComposerFocus = {
    direction: "none",
    end: 0,
    start: 0
  };
  void nextTick(() => {
    if (screenControlFormRef.value?.focusComposer?.({
      cursor: "end"
    })) {
      pendingComposerFocus = null;
    }
  });
}

function askSystemContextAndFocus(input = {}) {
  const added = askCodexAboutSystemContext(input);
  if (added) {
    focusBottomComposer();
  }
  return added;
}

function submitComposerControlAndFocus(options = {}) {
  const submission = submitComposerControl(options);
  focusBottomComposer();
  return submission;
}

function requestAgentInterruptAndFocus(reason = "user_interrupt") {
  const interruption = requestAgentInterrupt(reason);
  focusBottomComposer();
  return interruption;
}

function cancelOptimisticComposerTurnAndFocus(submissionId = "") {
  const cancellation = cancelOptimisticComposerTurn(submissionId);
  focusBottomComposer();
  return cancellation;
}

function editOptimisticComposerTurnAndFocus(submissionId = "") {
  const edited = editOptimisticComposerTurn(submissionId);
  focusBottomComposer();
  return edited;
}

function resendOptimisticComposerTurnAndFocus(submissionId = "") {
  const resend = resendOptimisticComposerTurn(submissionId);
  focusBottomComposer();
  return resend;
}

onBeforeUpdate(() => {
  pendingComposerFocus = screenControlFormRef.value?.composerFocusSnapshot?.() || pendingComposerFocus;
});

onUpdated(() => {
  if (!pendingComposerFocus) {
    return;
  }
  const focus = pendingComposerFocus;
  void nextTick(() => {
    if (screenControlFormRef.value?.restoreComposerFocus?.(focus)) {
      pendingComposerFocus = null;
    }
  });
});

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
  gap: var(--studio-home-project-gap, 0.75rem);
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
  padding: 0.04rem 0.12rem 0;
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

.studio-autopilot--task .studio-autopilot__chat-panel {
  border-color: rgba(126, 87, 194, 0.42);
  box-shadow: 0 0.75rem 2rem rgba(74, 42, 126, 0.12);
}

.studio-autopilot__task-header {
  align-items: center;
  background: linear-gradient(135deg, rgba(126, 87, 194, 0.16), rgba(94, 53, 177, 0.07));
  border: 1px solid rgba(126, 87, 194, 0.24);
  border-radius: 10px;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.55rem 0.65rem;
}

.studio-autopilot__task-title {
  display: grid;
  min-width: 0;
}

.studio-autopilot__task-title span,
.studio-autopilot__task-title small {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.68rem;
  line-height: 1.2;
}

.studio-autopilot__task-title strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.86rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-autopilot__task-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.3rem;
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
.studio-autopilot__actions :deep(.v-btn) {
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
.studio-autopilot__actions :deep(.v-btn:hover) {
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

.studio-autopilot__status-actions :deep(.studio-autopilot__stop-button--agent) {
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

.studio-autopilot__task-form {
  border-top: 1px solid rgba(126, 87, 194, 0.2);
  padding-top: 0.2rem;
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

.studio-autopilot__session-tool-pane {
  background: rgb(var(--v-theme-surface));
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.studio-autopilot__session-tool-header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: flex;
  gap: 0.55rem;
  min-width: 0;
  padding: 0.18rem 0.45rem;
}

.studio-autopilot__session-tool-header :deep(.v-btn) {
  block-size: 1.85rem;
  min-block-size: 1.85rem;
  min-inline-size: 0;
  padding-inline: 0.5rem 0.62rem;
  text-transform: none;
}

.studio-autopilot__session-tool-content {
  block-size: 100%;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__editor-pane--immersive {
  background:
    radial-gradient(circle at 50% 0%, rgba(89, 227, 255, 0.12), transparent 42%),
    rgb(var(--v-theme-surface));
  border: 1px solid rgba(117, 243, 255, 0.42);
  border-radius: 1rem;
  box-shadow:
    0 1.5rem 5rem rgba(0, 0, 0, 0.62),
    0 0 2.4rem rgba(89, 227, 255, 0.18),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  height: calc(100% - 1.2rem) !important;
  margin: 0.6rem;
  overflow: hidden;
  transform-origin: center;
  will-change: filter, opacity, transform;
  z-index: 20;
}

.studio-autopilot__editor-pane--portal-measuring {
  opacity: 0;
  transform: scale(0.985);
  transition: none;
}

.studio-autopilot__editor-pane--portal-landing {
  filter: brightness(1.32) saturate(1.22);
  opacity: 0.3;
  transform: scale(0.992);
  transition:
    filter 110ms ease-out,
    opacity 110ms ease-out,
    transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
}

.studio-autopilot__editor-pane--portal-open {
  filter: none;
  opacity: 1;
  transform: none;
  transition:
    filter 160ms ease-out,
    opacity 160ms ease-out,
    transform 210ms cubic-bezier(0.16, 1, 0.3, 1);
}

.studio-autopilot__editor-pane--portal-closing {
  filter: brightness(1.22) saturate(1.12);
  opacity: 0;
  transform: scale(0.992);
  transition:
    filter 110ms ease-in,
    opacity 120ms ease-in,
    transform 130ms ease-in;
}

.studio-autopilot__editor-pane--immersive > .studio-autopilot__session-tool-header,
.studio-autopilot__editor-pane--immersive > .studio-autopilot__session-tool-content {
  position: relative;
  z-index: 2;
}

.studio-autopilot__editor-pane--portal-landing > .studio-autopilot__session-tool-header,
.studio-autopilot__editor-pane--portal-landing > .studio-autopilot__session-tool-content,
.studio-autopilot__editor-pane--portal-measuring > .studio-autopilot__session-tool-header,
.studio-autopilot__editor-pane--portal-measuring > .studio-autopilot__session-tool-content,
.studio-autopilot__editor-pane--portal-closing > .studio-autopilot__session-tool-header,
.studio-autopilot__editor-pane--portal-closing > .studio-autopilot__session-tool-content {
  opacity: 0;
}

.studio-autopilot__editor-pane--portal-open > .studio-autopilot__session-tool-header,
.studio-autopilot__editor-pane--portal-open > .studio-autopilot__session-tool-content {
  opacity: 1;
  transition: opacity 130ms ease-out 90ms;
}

.studio-autopilot__file-portal-carrier {
  filter: drop-shadow(0 1.4rem 2.8rem rgba(0, 0, 0, 0.58));
  isolation: isolate;
  pointer-events: none;
  position: fixed;
  transform-origin: center;
  will-change: filter, opacity, transform;
  z-index: 2700;
}

.studio-autopilot__file-portal-carrier-halo {
  background:
    radial-gradient(ellipse at center, rgba(102, 240, 255, 0.3), transparent 68%),
    linear-gradient(135deg, rgba(109, 224, 255, 0.24), rgba(174, 111, 255, 0.22));
  border: 1px solid rgba(185, 250, 255, 0.68);
  border-radius: 1.35rem;
  box-shadow:
    0 0 1.4rem rgba(92, 231, 255, 0.48),
    0 0 4rem rgba(135, 105, 255, 0.26),
    inset 0 0 2rem rgba(146, 242, 255, 0.18);
  inset: -0.65rem;
  opacity: 0.72;
  position: absolute;
}

.studio-autopilot__file-portal-carrier-plate {
  background:
    radial-gradient(circle at 68% 12%, rgba(151, 105, 255, 0.28), transparent 32%),
    linear-gradient(145deg, rgba(7, 21, 42, 0.99), rgba(8, 39, 56, 0.98) 48%, rgba(13, 18, 45, 0.99));
  border: 1px solid rgba(151, 246, 255, 0.86);
  border-radius: 1rem;
  box-shadow:
    0 0 0 1px rgba(85, 196, 255, 0.18),
    0 0 2.2rem rgba(77, 226, 255, 0.26),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06),
    inset 0 -4rem 8rem rgba(22, 8, 70, 0.18);
  clip-path: inset(0 round 1rem);
  inset: 0;
  overflow: hidden;
  position: absolute;
}

.studio-autopilot__file-portal-carrier-plate::before,
.studio-autopilot__file-portal-carrier-plate::after {
  content: "";
  inset: 0;
  pointer-events: none;
  position: absolute;
}

.studio-autopilot__file-portal-carrier-plate::before {
  background:
    linear-gradient(90deg, transparent 0 49.8%, rgba(129, 238, 255, 0.15) 50%, transparent 50.2%),
    linear-gradient(transparent 0 49.8%, rgba(129, 238, 255, 0.12) 50%, transparent 50.2%),
    repeating-linear-gradient(90deg, transparent 0 6.4rem, rgba(109, 225, 255, 0.04) 6.4rem 6.5rem),
    repeating-linear-gradient(0deg, transparent 0 4.2rem, rgba(109, 225, 255, 0.035) 4.2rem 4.3rem);
  mix-blend-mode: screen;
  opacity: 0.66;
}

.studio-autopilot__file-portal-carrier-plate::after {
  background: linear-gradient(110deg, transparent 30%, rgba(198, 251, 255, 0.14) 46%, transparent 62%);
  transform: translateX(-92%);
}

.studio-autopilot__file-portal-carrier-chrome {
  align-items: center;
  border-bottom: 1px solid rgba(130, 238, 255, 0.24);
  color: rgba(221, 251, 255, 0.78);
  display: grid;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.67rem;
  gap: 0.7rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  height: 2.5rem;
  letter-spacing: 0.08em;
  padding: 0 1rem;
  position: relative;
  text-transform: uppercase;
  z-index: 2;
}

.studio-autopilot__file-portal-carrier-chrome span {
  color: rgb(126, 238, 255);
  font-size: 0.56rem;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.studio-autopilot__file-portal-carrier-chrome code {
  font: inherit;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-autopilot__file-portal-carrier-chrome i {
  background: rgb(130, 241, 255);
  border-radius: 50%;
  box-shadow:
    0 0 0.55rem rgba(104, 235, 255, 0.9),
    0 0 1.5rem rgba(104, 235, 255, 0.54);
  height: 0.42rem;
  width: 0.42rem;
}

.studio-autopilot__file-portal-carrier-code {
  align-content: center;
  display: grid;
  gap: clamp(0.26rem, 1.3vh, 0.72rem);
  inset: 2.5rem 0 0;
  overflow: hidden;
  padding: clamp(1rem, 5%, 2.8rem) clamp(1.2rem, 7%, 4.4rem);
  position: absolute;
  z-index: 2;
}

.studio-autopilot__file-portal-carrier-code span {
  background: linear-gradient(90deg, rgba(109, 232, 255, 0.2), rgba(223, 252, 255, 0.88) 16%, rgba(177, 129, 255, 0.56) 62%, transparent);
  border-radius: 999px;
  box-shadow: 0 0 0.65rem rgba(95, 225, 255, 0.14);
  height: clamp(2px, 0.34vh, 4px);
  opacity: 0.74;
  transform-origin: left;
  width: 82%;
}

.studio-autopilot__file-portal-carrier-code span:nth-child(4n + 1) { margin-left: 4%; width: 64%; }
.studio-autopilot__file-portal-carrier-code span:nth-child(4n + 2) { margin-left: 10%; width: 76%; }
.studio-autopilot__file-portal-carrier-code span:nth-child(4n + 3) { margin-left: 10%; width: 51%; }
.studio-autopilot__file-portal-carrier-code span:nth-child(4n) { width: 88%; }

.studio-autopilot__file-portal-carrier-scan {
  background: linear-gradient(180deg, transparent, rgba(129, 240, 255, 0.55), transparent);
  height: 18%;
  left: 0;
  opacity: 0.58;
  position: absolute;
  right: 0;
  top: -20%;
  z-index: 3;
}

.studio-autopilot__file-portal-carrier-sparks {
  inset: -1.2rem;
  position: absolute;
}

.studio-autopilot__file-portal-carrier-sparks i {
  background: rgb(150, 245, 255);
  border-radius: 999px;
  box-shadow: 0 0 0.8rem rgba(104, 235, 255, 0.95);
  height: 0.18rem;
  left: 50%;
  opacity: 0;
  position: absolute;
  top: 50%;
  transform-origin: 0 0;
  width: clamp(1.4rem, 8vw, 5rem);
}

.studio-autopilot__file-portal-carrier-sparks i:nth-child(1) { transform: rotate(0deg) translateX(42%); }
.studio-autopilot__file-portal-carrier-sparks i:nth-child(2) { transform: rotate(45deg) translateX(42%); }
.studio-autopilot__file-portal-carrier-sparks i:nth-child(3) { transform: rotate(90deg) translateX(42%); }
.studio-autopilot__file-portal-carrier-sparks i:nth-child(4) { transform: rotate(135deg) translateX(42%); }
.studio-autopilot__file-portal-carrier-sparks i:nth-child(5) { transform: rotate(180deg) translateX(42%); }
.studio-autopilot__file-portal-carrier-sparks i:nth-child(6) { transform: rotate(225deg) translateX(42%); }
.studio-autopilot__file-portal-carrier-sparks i:nth-child(7) { transform: rotate(270deg) translateX(42%); }
.studio-autopilot__file-portal-carrier-sparks i:nth-child(8) { transform: rotate(315deg) translateX(42%); }

.studio-autopilot__file-portal-carrier--origin,
.studio-autopilot__file-portal-carrier--absorbing {
  transform: var(--file-portal-carrier-origin-transform);
}

.studio-autopilot__file-portal-carrier--origin .studio-autopilot__file-portal-carrier-halo,
.studio-autopilot__file-portal-carrier--origin .studio-autopilot__file-portal-carrier-plate,
.studio-autopilot__file-portal-carrier--absorbing .studio-autopilot__file-portal-carrier-halo,
.studio-autopilot__file-portal-carrier--absorbing .studio-autopilot__file-portal-carrier-plate {
  border-radius: 0.08rem;
  clip-path: var(--file-portal-carrier-source-clip);
}

.studio-autopilot__file-portal-carrier--destination {
  transform: none;
}

.studio-autopilot__file-portal-carrier--flying {
  animation: studio-autopilot-file-carrier-arrive var(--file-portal-carrier-duration) cubic-bezier(0.18, 0.78, 0.2, 1) both;
}

.studio-autopilot__file-portal-carrier--flying .studio-autopilot__file-portal-carrier-halo,
.studio-autopilot__file-portal-carrier--flying .studio-autopilot__file-portal-carrier-plate {
  animation: studio-autopilot-file-plate-arrive var(--file-portal-carrier-duration) cubic-bezier(0.18, 0.78, 0.2, 1) both;
}

.studio-autopilot__file-portal-carrier--flying .studio-autopilot__file-portal-carrier-plate::after,
.studio-autopilot__file-portal-carrier--returning .studio-autopilot__file-portal-carrier-plate::after {
  animation: studio-autopilot-file-carrier-shine 310ms ease-out 75ms both;
}

.studio-autopilot__file-portal-carrier--flying .studio-autopilot__file-portal-carrier-scan,
.studio-autopilot__file-portal-carrier--returning .studio-autopilot__file-portal-carrier-scan {
  animation: studio-autopilot-file-carrier-scan 380ms ease-in-out 60ms both;
}

.studio-autopilot__file-portal-carrier--flying .studio-autopilot__file-portal-carrier-sparks i,
.studio-autopilot__file-portal-carrier--returning .studio-autopilot__file-portal-carrier-sparks i {
  animation: studio-autopilot-file-carrier-spark 280ms ease-out 135ms both;
}

.studio-autopilot__file-portal-carrier--returning {
  animation: studio-autopilot-file-carrier-return var(--file-portal-carrier-duration) cubic-bezier(0.55, 0, 0.76, 0.18) both;
}

.studio-autopilot__file-portal-carrier--returning .studio-autopilot__file-portal-carrier-halo,
.studio-autopilot__file-portal-carrier--returning .studio-autopilot__file-portal-carrier-plate {
  animation: studio-autopilot-file-plate-return var(--file-portal-carrier-duration) cubic-bezier(0.55, 0, 0.76, 0.18) both;
}

.studio-autopilot__file-portal-carrier--dissolving {
  filter: brightness(1.65) drop-shadow(0 0 2.4rem rgba(109, 236, 255, 0.72));
  opacity: 0;
  transform: scale(1.018);
  transition:
    filter 140ms ease-out,
    opacity 140ms ease-out,
    transform 140ms ease-out;
}

.studio-autopilot__file-portal-carrier--absorbing {
  filter: brightness(1.9) drop-shadow(0 0 1.5rem rgba(109, 236, 255, 0.9));
  opacity: 0;
  transform: var(--file-portal-carrier-absorb-transform);
  transition:
    filter 110ms ease-in,
    opacity 110ms ease-in,
    transform 115ms cubic-bezier(0.7, 0, 1, 1);
}

.studio-autopilot__editor-pane--immersive > .studio-autopilot__session-tool-header {
  background: rgba(4, 12, 25, 0.94);
  border-bottom-color: rgba(117, 243, 255, 0.2);
  padding-right: 4.5rem;
}

.studio-autopilot__file-portal-close {
  border: 1px solid rgba(147, 244, 255, 0.52);
  box-shadow:
    0 0.65rem 1.8rem rgba(0, 0, 0, 0.5),
    0 0 1.2rem rgba(89, 227, 255, 0.26);
  position: absolute;
  right: 0.72rem;
  top: 0.58rem;
  z-index: 30;
}

.studio-autopilot__file-portal-path {
  color: rgba(220, 248, 255, 0.74);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.68rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-autopilot__file-portal-facade {
  background:
    linear-gradient(90deg, rgba(5, 15, 31, 0.96), rgba(21, 62, 83, 0.94), rgba(7, 18, 38, 0.97)),
    repeating-linear-gradient(90deg, transparent 0 8%, rgba(117, 243, 255, 0.12) 8% 9%);
  display: grid;
  gap: 0.28rem;
  grid-template-rows: repeat(12, minmax(0, 1fr));
  inset: 0;
  opacity: 0;
  padding: 4%;
  pointer-events: none;
  position: absolute;
  transition: opacity 90ms ease-out;
  z-index: 5;
}

.studio-autopilot__file-portal-facade span {
  background:
    linear-gradient(90deg, rgba(89, 227, 255, 0.12), rgba(255, 255, 255, 0.64), rgba(181, 156, 255, 0.18));
  border-block: 1px solid rgba(117, 243, 255, 0.46);
  box-shadow: 0 0 0.8rem rgba(89, 227, 255, 0.2);
  transform: scaleX(0.82);
}

.studio-autopilot__file-portal-facade span:nth-child(3n + 1) { transform: scaleX(0.72); }
.studio-autopilot__file-portal-facade span:nth-child(3n + 2) { transform: scaleX(0.9); }
.studio-autopilot__file-portal-facade span:nth-child(3n) { transform: scaleX(0.8); }

.studio-autopilot__editor-pane--portal-landing .studio-autopilot__file-portal-facade,
.studio-autopilot__editor-pane--portal-closing .studio-autopilot__file-portal-facade {
  opacity: 0.94;
}

.studio-autopilot__composer :deep(.studio-autopilot-prompt-textarea) {
  padding-bottom: 0;
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
  left: 0.75rem;
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  z-index: 4;
}

.studio-autopilot__command-spy--expanded {
  bottom: 0.75rem;
}

.studio-autopilot__command-spy :deep(.vibe64-terminal-surface) {
  height: 100%;
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

@keyframes studio-autopilot-file-carrier-arrive {
  0% {
    filter: brightness(1.8) drop-shadow(0 0 1.6rem rgba(103, 237, 255, 0.9));
    transform: var(--file-portal-carrier-origin-transform);
  }

  14% {
    filter: brightness(1.35) drop-shadow(0 1rem 2.2rem rgba(0, 0, 0, 0.46));
    transform: var(--file-portal-carrier-lift-transform);
  }

  56% {
    filter: brightness(1.1) drop-shadow(0 1.6rem 3.4rem rgba(0, 0, 0, 0.64));
    transform: var(--file-portal-carrier-mid-transform) rotateZ(-1.2deg);
  }

  84% {
    filter: brightness(1.14) drop-shadow(0 1.2rem 2.8rem rgba(0, 0, 0, 0.58));
    transform: scale(1.018);
  }

  100% {
    filter: drop-shadow(0 1.4rem 2.8rem rgba(0, 0, 0, 0.58));
    transform: none;
  }
}

@keyframes studio-autopilot-file-carrier-return {
  0% {
    filter: drop-shadow(0 1.4rem 2.8rem rgba(0, 0, 0, 0.58));
    transform: none;
  }

  16% {
    filter: brightness(1.14) drop-shadow(0 1.2rem 2.8rem rgba(0, 0, 0, 0.58));
    transform: scale(1.018);
  }

  56% {
    filter: brightness(1.1) drop-shadow(0 1.6rem 3.4rem rgba(0, 0, 0, 0.64));
    transform: var(--file-portal-carrier-mid-transform) rotateZ(1.2deg);
  }

  86% {
    filter: brightness(1.35) drop-shadow(0 1rem 2.2rem rgba(0, 0, 0, 0.46));
    transform: var(--file-portal-carrier-lift-transform);
  }

  100% {
    filter: brightness(1.8) drop-shadow(0 0 1.6rem rgba(103, 237, 255, 0.9));
    transform: var(--file-portal-carrier-origin-transform);
  }
}

@keyframes studio-autopilot-file-plate-arrive {
  0%,
  16% {
    border-radius: 0.08rem;
    clip-path: var(--file-portal-carrier-source-clip);
  }

  46% {
    border-radius: 0.5rem;
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
  }

  100% {
    border-radius: 1rem;
    clip-path: inset(0 round 1rem);
  }
}

@keyframes studio-autopilot-file-plate-return {
  0% {
    border-radius: 1rem;
    clip-path: inset(0 round 1rem);
  }

  54% {
    border-radius: 0.5rem;
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
  }

  84%,
  100% {
    border-radius: 0.08rem;
    clip-path: var(--file-portal-carrier-source-clip);
  }
}

@keyframes studio-autopilot-file-carrier-shine {
  0% { transform: translateX(-92%); }
  100% { transform: translateX(108%); }
}

@keyframes studio-autopilot-file-carrier-scan {
  0% { opacity: 0; top: -20%; }
  22% { opacity: 0.7; }
  100% { opacity: 0; top: 104%; }
}

@keyframes studio-autopilot-file-carrier-spark {
  0% { opacity: 0; width: 0; }
  32% { opacity: 0.9; }
  100% { opacity: 0; width: clamp(2.8rem, 15vw, 10rem); }
}

@media (prefers-reduced-motion: reduce) {
  .studio-autopilot__file-portal-carrier,
  .studio-autopilot__file-portal-carrier *,
  .studio-autopilot__editor-pane--portal-closing,
  .studio-autopilot__editor-pane--portal-landing,
  .studio-autopilot__editor-pane--portal-open {
    animation: none !important;
    transition: none;
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
