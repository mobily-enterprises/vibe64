<template>
  <section
    class="studio-autopilot"
    :class="{ 'studio-autopilot--chat-collapsed': chatCollapsed }"
  >
    <Teleport
      v-if="sessionGithubActorHeaderVisible"
      :to="props.githubActorTeleportTarget"
    >
      <div
        class="studio-home-shell-session-github-actor"
        :class="{ 'studio-home-shell-session-github-actor--inactive': !sessionGithubActor.active }"
        role="status"
        :title="sessionGithubActor.title"
      >
        <v-icon :icon="mdiGithub" size="14" />
        <span>{{ sessionGithubActor.displayLabel }}</span>
      </div>
    </Teleport>
    <Vibe64CreatePullRequestDialog v-if="githubProject" v-model="createPullRequestOpen" :dashboard-context="dashboardContext" />
    <section
      ref="mainChat"
      class="studio-autopilot__chat-panel"
      aria-label="Session chat"
      tabindex="-1"
    >
      <header class="studio-autopilot__session-header">
        <Vibe64SessionToolbar
          v-if="sessionToolbarVisible"
          :active="props.active"
          :archive="props.sessionArchive"
          compact
          :create-visible="props.sessionToolbar.createSessionVisible === true"
          :create-teleport-target="props.createSessionTeleportTarget"
          :max-visible-sessions="3"
          :selected-session-id="sessionId"
          :selection-archived="sessionArchiveDisabled"
          :toolbar="props.sessionToolbar"
        />

        <v-tooltip
          v-if="saveWorkHeaderVisible"
          :model-value="saveWorkChecking"
          location="bottom"
          :open-on-click="false"
          :open-on-focus="false"
          :open-on-hover="false"
        >
          <template #activator="{ props: checkingProps }">
            <v-btn
              v-bind="checkingProps"
              :aria-busy="saveWorkSending || saveWorkChecking ? 'true' : undefined"
              :aria-label="saveWorkChecking ? 'Checking repository status' : saveWorkCheckAvailable ? 'Check for updates' : saveWorkHeaderAriaLabel"
              class="studio-autopilot__save-work"
              :class="{ 'studio-autopilot__save-work--check': saveWorkCheckAvailable }"
              :color="saveWorkRequiresUpdate ? 'warning' : (saveWorkUnsaved ? 'primary' : undefined)"
              :disabled="saveWorkChecking || (saveWorkDisabled && !saveWorkCheckAvailable) || temporaryAiWorkspace?.updateRepairTask?.busy"
              height="var(--session-action-size, 48px)"
              icon
              :title="saveWorkHeaderHint"
              type="button"
              variant="tonal"
              width="var(--session-action-size, 48px)"
              @click="requestSessionSaveWork"
            >
              <v-icon v-if="saveWorkRequiresUpdate" :icon="mdiSourceCommit" />
              <span v-else-if="props.workState?.destination?.mode === 'github'" class="studio-autopilot__save-symbol" aria-hidden="true">
                <v-icon :icon="mdiContentSaveOutline" size="26" class="studio-autopilot__save-symbol-disk" />
                <v-icon :icon="mdiSourceCommit" size="24" class="studio-autopilot__save-symbol-commit" />
              </span>
              <v-icon v-else :icon="mdiContentSaveOutline" />
            </v-btn>
          </template>
          <span role="status">Checking…</span>
        </v-tooltip>
        <div class="studio-autopilot__header-actions studio-autopilot__header-actions--compact">
          <v-menu
            v-if="props.sourceWorkspaceAvailable || props.sessionRenewal?.visible"
            location="bottom end"
          >
            <template #activator="{ props: menuProps }">
              <v-badge
                :color="(sessionRenewalActionPresentation.attention && sessionRenewalActionPresentation.color) || 'primary'"
                dot
                :model-value="sessionRenewalActionPresentation.attention === true || temporaryAiHasUnreadMessages"
                offset-x="5"
                offset-y="5"
              >
                <v-btn
                  ref="sessionActionsTrigger"
                  v-bind="menuProps"
                  :aria-label="sessionActionsLabel"
                  data-vibe64-session-actions
                  height="48"
                  :icon="mdiDotsVertical"
                  title="Session actions"
                  type="button"
                  variant="text"
                  width="48"
                />
              </v-badge>
            </template>
            <v-list aria-label="Session actions" density="compact" min-width="17rem">
              <v-list-item
                v-if="githubProject" min-height="48"
                :prepend-icon="mdiSourcePull" :title="sessionPullRequest?.number ? 'View pull request' : 'Create pull request'"
                :subtitle="sessionPullRequest?.number ? `PR #${sessionPullRequest.number}` : 'Propose this work for merging'"
                :to="sessionPullRequestTarget" :disabled="!sessionPullRequest?.number && sourceOperationsSuspended"
                @click="!sessionPullRequest?.number && (createPullRequestOpen = true)"
              />
              <v-list-item
                v-if="props.sessionRenewal?.visible"
                class="studio-autopilot__session-action-item"
                data-vibe64-session-renew-action
                :prepend-icon="mdiAutorenew"
                :subtitle="sessionRenewalActionPresentation.reason"
                :title="sessionRenewalActionPresentation.label"
                @click="requestSessionRenewal(sessionActionsTrigger)"
              />
              <v-list-item
                v-if="props.sourceWorkspaceAvailable"
                class="studio-autopilot__session-action-item"
                data-vibe64-temporary-ai-action
                :disabled="!sessionId || props.sessionSelectionArchived"
                :subtitle="temporaryAiHasUnreadMessages ? 'New messages in Temporary AI' : 'Open a separate short-lived conversation'"
                title="Temporary AI"
                @click="openTemporaryAi"
              >
                <template #prepend>
                  <v-badge color="primary" dot :model-value="temporaryAiHasUnreadMessages">
                    <v-icon :icon="mdiIncognito" />
                  </v-badge>
                </template>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
        <div class="studio-autopilot__header-actions studio-autopilot__header-actions--expanded">
          <v-btn
            v-if="githubProject" :icon="mdiSourcePull" height="var(--session-action-size, 48px)" width="var(--session-action-size, 48px)" variant="text"
            :aria-label="sessionPullRequest?.number ? 'View pull request' : 'Create pull request'"
            :title="sessionPullRequest?.number ? `View pull request #${sessionPullRequest.number}` : 'Create pull request'"
            :to="sessionPullRequestTarget" :disabled="!sessionPullRequest?.number && sourceOperationsSuspended"
            @click="!sessionPullRequest?.number && (createPullRequestOpen = true)"
          />
          <v-badge
            v-if="props.sessionRenewal?.visible"
            :color="sessionRenewalActionPresentation.color || 'primary'"
            dot
            :model-value="sessionRenewalActionPresentation.attention === true"
            offset-x="5"
            offset-y="5"
          >
            <v-btn
              :aria-label="sessionRenewalActionPresentation.label"
              :color="sessionRenewalActionPresentation.color"
              data-vibe64-session-renew-action
              height="var(--session-action-size, 48px)"
              :icon="mdiAutorenew"
              :title="sessionRenewalActionPresentation.reason"
              type="button"
              variant="text"
              width="var(--session-action-size, 48px)"
              @click="requestSessionRenewal($event.currentTarget)"
            />
          </v-badge>
          <v-badge v-if="props.sourceWorkspaceAvailable" color="primary" dot :model-value="temporaryAiHasUnreadMessages" offset-x="5" offset-y="5">
            <v-btn
              :aria-label="temporaryAiHasUnreadMessages ? 'Open temporary AI: unread messages' : 'Open temporary AI'"
              :disabled="!sessionId || props.sessionSelectionArchived"
              height="var(--session-action-size, 48px)"
              :icon="mdiIncognito"
              :title="temporaryAiHasUnreadMessages ? 'New messages in Temporary AI' : 'Open a temporary AI conversation'"
              type="button"
              variant="text"
              width="var(--session-action-size, 48px)"
              @click="openTemporaryAi"
            />
          </v-badge>
        </div>
      </header>

      <div class="studio-autopilot__activity" aria-label="Session activity">
        <v-sheet v-if="githubProject && sessionPullRequest" color="surface-light" rounded="lg" class="pa-2 text-body-small" style="overflow-wrap: anywhere">
          <strong>{{ sessionPullRequest.number ? `PR #${sessionPullRequest.number}` : 'Pull request branch' }}</strong>
          · Commit &amp; push to {{ sessionPullRequest.headRepository }}:{{ sessionPullRequest.headBranch }}
        </v-sheet>
        <v-sheet
          v-if="connectionRecoveryVisible"
          class="studio-autopilot__connection-recovery"
          color="surface-variant"
          rounded="lg"
          role="status"
          data-vibe64-connection-recovery
        >
          <v-btn
            v-if="assistantAccountUnavailable"
            color="primary"
            variant="flat"
            min-height="48"
            @click="requestVibe64AccountConnectionsDialog({ section: 'ai' })"
          >
            Open AI Accounts
          </v-btn>
          <v-btn
            v-else
            variant="tonal"
            min-height="48"
            :disabled="props.agentConnectionStatus === 'reconciling'"
            @click="props.retryAgentConnection()"
          >
            {{ props.agentConnectionStatus === 'disconnected' ? 'Reconnect' : 'Retry connection' }}
          </v-btn>
          <v-btn
            v-if="props.agentConnectionStatus === 'failed' && props.sessionRenewal?.visible"
            variant="tonal"
            min-height="48"
            @click="requestSessionRenewal($event.currentTarget)"
          >
            Renew session
          </v-btn>
          <span v-if="assistantAccountUnavailable" class="text-body-small">
            {{ assistantAccountMessage }} Your draft is kept.
          </span>
          <span v-else class="text-body-small">
            {{ props.agentConnectionStatus === 'disconnected'
              ? 'Connection lost. Reconnecting automatically.'
              : props.agentConnectionError || 'Checking the assistant connection.' }}
            Your draft is kept.
          </span>
        </v-sheet>
        <v-alert v-if="checkpointFailure" class="studio-autopilot__checkpoint-notice" type="warning" variant="tonal" density="compact">
          <details :key="checkpointFailure">
            <summary class="text-body-medium">Recovery checkpoint unavailable · Details</summary>
            <p class="text-body-small mt-2 mb-2">Your files remain in this session. The last assistant turn has no confirmed recovery checkpoint.</p>
            <pre class="studio-autopilot__checkpoint-details text-body-small">{{ checkpointFailure }}</pre>
          </details>
        </v-alert>
        <v-sheet v-if="testApproval && resourceRecoveryControl" class="d-flex flex-wrap align-center justify-space-between ga-2 pa-2" color="surface-variant" rounded="lg">
          <span class="text-body-small">{{ testApproval.state === 'waiting' ? 'Tests need memory approval' : 'Resuming the original test…' }}</span>
          <component
            :is="resourceRecoveryControl"
            :key="`${sessionId}:${testApproval.admissionId}`"
            :admission-id="testApproval.admissionId"
            :session-id="sessionId"
            :disabled="testApproval.state !== 'waiting'"
            @retry-result="props.refreshSessionData?.()"
            @recheck="props.refreshSessionData?.()"
          />
        </v-sheet>
        <Vibe64TemporaryActionTerminal
          :active="saveWorkOperationActive || saveWorkSending"
          :dismissed="saveWorkActivityDismissed || updateHandledInRepair"
          :error="saveWorkError"
          :error-title="`${saveWorkActivityLabel} needs attention`"
          height="clamp(8rem, 22vh, 14rem)"
          :operation-key="saveWorkActivityKey"
          :output="saveWorkOutput"
          :retryable="saveWorkRetryable"
          :stage="saveWorkStage"
          :starting="saveWorkSending"
          :status="saveWorkStatus"
          :subtitle="saveWorkActivityIsUpdate ? 'Replay current work on the latest saved version' : 'Canonical project Save'"
          :title="saveWorkActivityLabel"
          @copy="copyActivityOutput(saveWorkOutput)"
          @dismiss="dismissSaveWorkActivity"
          @retry="retrySaveWork"
        >
          <template v-if="saveWorkError && (saveWorkCanResolveWithTemporaryAi || saveWorkCanCreatePullRequest)" #error-actions>
            <Vibe64TemporaryAiFixAction
              v-if="saveWorkCanResolveWithTemporaryAi"
              :disabled="repositoryRecoverySending || !(saveWorkActivityIsUpdate ? assistantSeniorAllowed : assistantJuniorAllowed)"
              :pending="repositoryRecoverySending"
              :title="(saveWorkActivityIsUpdate ? assistantSeniorAllowed : assistantJuniorAllowed) ? 'Open temporary AI to resolve this repository problem' : saveWorkActivityIsUpdate ? assistantSeniorRestrictionMessage : assistantJuniorRestrictionMessage"
              @click="fixRepositoryActionError"
            />
            <v-btn
              v-if="saveWorkCanCreatePullRequest" color="primary" variant="flat" height="48"
              :disabled="saveWorkDisabled || sourceOperationsSuspended" @click="createPullRequestOpen = true"
            >
              Create draft PR
            </v-btn>
          </template>
        </Vibe64TemporaryActionTerminal>

        <Vibe64TemporaryActionTerminal
          :active="workspaceSetupRunning || workspaceSetupRetrying"
          :dismissed="workspaceSetupDismissed"
          :error="workspaceSetupError"
          error-title="Workspace preparation needs attention"
          height="clamp(8rem, 22vh, 14rem)"
          :operation-key="workspaceSetupActivityKey"
          :output="workspaceSetupOutput"
          :retryable="workspaceSetupNeedsAttention && workspaceSetupStatus !== 'required' && !workspaceSetupRetryDisabled && !resourceRetryBusy"
          :stage="workspaceSetupCurrentLabel"
          :starting="workspaceSetupRunning || workspaceSetupRetrying"
          :status="workspaceSetupStatus"
          subtitle="Project dependency preparation"
          :title="workspaceSetupTitle"
          @copy="copyActivityOutput(workspaceSetupOutput)"
          @dismiss="dismissWorkspaceSetupActivity"
          @retry="retryWorkspaceSetup"
        >
          <template v-if="workspaceSetupNeedsAttention" #error-actions>
            <component
              :is="resourceRecoveryControl"
              v-if="resourceRecoveryControl && props.session?.workspaceSetup?.resourceAdmissionId"
              :key="`${sessionId}:${props.session.workspaceSetup.resourceAdmissionId}`"
              :admission-id="props.session.workspaceSetup.resourceAdmissionId"
              :session-id="sessionId"
              :disabled="workspaceSetupRetryDisabled && !resourceRetryBusy"
              @busy="resourceRetryBusy = $event"
              @retry-result="props.refreshSessionData?.()"
              @recheck="retryWorkspaceSetup"
            />
            <v-btn
              v-else-if="workspaceSetupStatus === 'required'"
              :disabled="workspaceSetupRetryDisabled"
              :loading="workspaceSetupRetrying"
              size="small"
              title="Run all declared workspace setup steps, including any database preparation"
              variant="tonal"
              @click="retryWorkspaceSetup"
            >
              Prepare workspace
            </v-btn>
            <Vibe64TemporaryAiFixAction
              v-else
              :disabled="workspaceSetupAskDisabled"
              :pending="workspaceSetupFixSending"
              :title="assistantJuniorAllowed ? 'Open temporary AI to resolve workspace preparation' : assistantJuniorRestrictionMessage"
              @click="askCodexToFixWorkspaceSetup"
            />
          </template>
        </Vibe64TemporaryActionTerminal>
      </div>

      <Vibe64ConversationLog
        ref="conversationView"
        :voice-runtime="props.active && !props.sessionSelectionArchived ? props.conversationRuntime : null"
        :working="agentStopVisible"
        :integration-action-pending="props.conversationLog?.integrationActionPending"
        :integration-connections="props.conversationLog?.integrationConnections"
        :integration-action-error="props.conversationLog?.integrationActionError"
        :integration-requests-enabled="props.active && !props.sessionSelectionArchived"
        :session-id="sessionId"
        :assistant-label="conversationAssistantLabel"
        class="studio-autopilot__conversation"
        :error="props.conversationLog?.error"
        :error-reloadable="props.conversationLog?.errorReloadable"
        :follow-latest-key="conversationFollowLatestKey"
        :has-more-before="props.conversationLog?.hasMoreBefore"
        :loading="props.conversationLog?.loading"
        :loading-more="props.conversationLog?.loadingMore"
        :load-more-error="props.conversationLog?.loadMoreError"
        :reloading="chatReloading"
        :scroll-key="conversationScrollKey"
        :source-root="sessionSourceRoot"
        :turns="chatTurns"
        :visible="conversationLogVisible && !chatCollapsed && !temporaryAiWorkspace?.visible"
        :welcome-message="emptyConversationWelcome"
        @cancel-turn="cancelOptimisticMessage"
        @edit-turn="editOptimisticMessage"
        @load-more="loadMoreChatTurns"
        @open-source-file="openSourceEditorFile"
        @open-plan-history="workPlanViewer?.showPlan('history')"
        @open-integration="openIntegrationRequest"
        @skip-integration="skipIntegrationRequest"
        @resume-integration="resumeIntegrationRequest"
        @connect-integration="connectIntegrationRequest"
        @check-integration="checkIntegrationRequest"
        @cancel-integration="cancelIntegrationRequest"
        @resend-turn="resendOptimisticMessage"
        @reload="reloadChatPane"
      >
        <template #hints>
          <AssistantComposerSupport
            :activity="{ label: composerAssistantLabel }"
            :loading="!composerAssistantLabel && promptHintsVisible && promptHintsLoading"
            :status-id="thinkingStatusId"
            :suggestions="!composerAssistantLabel && promptHintsVisible ? promptHintSuggestions : []"
            @dismiss="dismissPromptHintsAndFocus"
            @focusout="handlePromptHintsFocusOut"
            @preview="previewPromptHint"
            @select="selectPromptHint"
          >
            <template v-if="reasoningActive && composerAssistantLabel === 'Assistant is working...'" #activity>
              <v-icon :icon="mdiCircle" size="7" color="primary" />
              <span>Assistant is working<span class="studio-autopilot__reasoning-dots">...</span></span>
            </template>
          </AssistantComposerSupport>
        </template>
        <template #composer="{ composerBlocked, setVoiceFeedbackTarget }">
          <div
            class="studio-autopilot__composer"
            @focusout="handleComposerRegionFocusOut"
          >
            <Vibe64RoutingNotice
              :request="routingRequest"
              :mode="assistantRoutingFromMetadata(props.session?.metadata)?.mode || ''"
              :active="props.active && conversationLogVisible"
              :retrying="routingReviewRetrying"
              :busy="agentActive"
              @retry="retryAutomaticReview"
              @skip="props.interruptAgentTurn({ reason: 'skip-review' })"
            />
            <Vibe64AutopilotPromptTextarea
              ref="composerInput"
              :key="composerKey"
              :saved-attachments="composerAttachments"
              v-model="composerDraft"
              aria-label="Message AI assistant"
              :attachments-enabled="composerAttachmentsEnabled"
              :described-by="composerSupportStatusVisible ? thinkingStatusId : ''"
              :disabled="composerDisabled"
              density="compact"
              :placeholder="composerPromptHintPlaceholder"
              :placeholder-affects-height="!composerPromptHintPreview"
              :rows="1"
              :session-id="sessionId"
              :submit-enabled="composerCanSubmit && !composerBlocked"
              tab-to-submit
              @attachment-state-change="updateComposerAttachmentState"
              @attachments-change="updateComposerAttachments"
              @blur="handleComposerBlur"
              @escape="dismissPromptHints"
              @focus="focusPromptHints"
              @input-activity="noteTypingActivity"
              @submit="sendComposerMessage"
              @tab-to-submit="focusComposerSendButton"
            >
              <template #input-start>
                <AssistantQuestionInputs
                  v-model:answers="questionAnswers" v-model:choice="selectedAnswerChoice"
                  :questions="numberedQuestions" :select-items="numberedQuestionSelectItems" :choices="answerChoices"
                  @dismiss="dismissNumberedQuestions"
                />
              </template>
              <template #footer="{ attachmentState }">
                <div class="studio-autopilot__composer-actions">
                  <Vibe64ChatModeControls
                    v-if="!props.sessionSelectionArchived" :session="props.session" :sessions-api-path="props.sessionsApiPath"
                    :purposes="assistantPurposes" :disabled="sourceOperationsSuspended || composerSending" :active="agentActive" :can-configure="assistantCanConfigureRouting"
                    :connecting="['initializing', 'reconciling'].includes(props.agentConnectionStatus)"
                    :loading="assistantAccessLoading" :load-error="assistantAccessError" @reload="reloadAssistantAccess"
                    @saved="reloadAssistantAccess"
                    @custom="composerSettingsButton = $event; composerSettingsOpen = true"
                  >
                    <template #default>
                      <div
                        v-if="composerAccessHint"
                        class="studio-autopilot__settings-access"
                      >
                        <div class="text-body-small" role="status">
                          {{ composerAccessHint }}
                          <v-btn
                            v-if="agentObservationLost && !agentActive" size="small" variant="text"
                            :disabled="composerDisabled || composerSending" @click="continueConversation"
                          >
                            Continue
                          </v-btn>
                        </div>
                      </div>
                    </template>
                  </Vibe64ChatModeControls>
                  <v-menu eager location="top start" :close-on-content-click="false">
                    <template #activator="{ props: menuProps }">
                      <v-btn
                        v-bind="menuProps" aria-label="Add to message" title="Add to message"
                        :icon="mdiPlus" size="small" variant="text" class="studio-autopilot__composer-action"
                      />
                    </template>
                    <v-card class="studio-autopilot__composer-menu pa-2" aria-label="Add to message">
                      <v-btn
                        v-if="composerAttachmentsSupported"
                        aria-label="Attach files"
                        class="studio-autopilot__composer-action justify-start"
                        :disabled="!composerAttachmentsEnabled || !attachmentState.canAddFiles"
                        :prepend-icon="mdiPaperclip"
                        size="small"
                        title="Attach files"
                        type="button"
                        variant="text"
                        @click="composerInput?.openFilePicker?.()"
                      >
                        Attach files
                      </v-btn>
                      <v-btn
                        v-if="composerAttachmentsSupported && previewAttachmentState.captureAvailable"
                        aria-label="Attach visible preview"
                        class="studio-autopilot__composer-action justify-start"
                        :aria-busy="previewAttachmentState.captureBusy ? 'true' : undefined"
                        :disabled="!composerAttachmentsEnabled || !attachmentState.canAddFiles || previewAttachmentState.captureBusy"
                        :prepend-icon="mdiEyePlusOutline"
                        size="small"
                        title="Attach visible preview"
                        type="button"
                        variant="text"
                        @click="captureVisiblePreview"
                      >
                        Attach visible preview
                      </v-btn>
                      <v-btn
                        v-if="composerAttachmentsSupported && previewAttachmentState.diagnosticsAvailable"
                        aria-label="Attach console & network"
                        class="studio-autopilot__composer-action justify-start"
                        :aria-busy="previewAttachmentState.diagnosticsBusy ? 'true' : undefined"
                        :disabled="!composerAttachmentsEnabled || !attachmentState.canAddFiles || previewAttachmentState.diagnosticsBusy"
                        :prepend-icon="mdiConsoleNetworkOutline"
                        size="small"
                        title="Attach console and network diagnostics"
                        type="button"
                        variant="text"
                        @click="attachPreviewDiagnostics"
                      >
                        Attach console &amp; network
                      </v-btn>
                    </v-card>
                  </v-menu>
                  <Vibe64StarredFilesMenu :bookmarks="fileBookmarks" @open-file="openSourceEditorFile" />
                  <Vibe64AgentPlanUsage
                    :active="props.active && !props.sessionSelectionArchived"
                    :session="props.session"
                    :conversation-runtime="props.conversationRuntime"
                    :sessions-api-path="props.sessionsApiPath"
                  />
                  <Vibe64WorkPlan ref="workPlanViewer" :session="props.session" :sessions-api-path="props.sessionsApiPath" :active="props.active && conversationLogVisible" :busy="agentActive" />
                  <Vibe64SessionAssistantMenu
                    v-model="composerSettingsOpen"
                    :target="composerSettingsButton"
                    :can-configure="assistantCanConfigureRouting"
                    :changes-disabled="composerSending || agentActive"
                    :session="props.session"
                    :sessions-api-path="props.sessionsApiPath"
                    @saved="props.refreshSessionData?.(); reloadAssistantAccess()"
                  />
                  <div class="studio-autopilot__composer-delivery">
                    <v-btn
                      v-if="agentStopVisible" aria-label="Stop" title="Stop assistant"
                      :disabled="!agentStopEnabled" :aria-busy="interrupting ? 'true' : undefined"
                      :icon="mdiStop" size="small" variant="text" class="studio-autopilot__composer-action"
                      @click="requestAgentInterrupt"
                    />
                    <v-btn
                      ref="composerSendButton" :aria-label="composerSubmitAriaLabel"
                      :title="composerSubmitTitle" :disabled="!composerCanSubmit || composerBlocked || !attachmentState.canSubmit"
                      :aria-busy="composerSending && !composerCanSubmit ? 'true' : undefined" color="primary" size="small" variant="flat"
                      :icon="composerSubmitMode === 'send' ? mdiSend : mdiArrowTopRight"
                      class="studio-autopilot__composer-action" @click="sendComposerMessage"
                    />
                  </div>
                </div>
                <div :ref="setVoiceFeedbackTarget" class="studio-autopilot__voice-feedback" />
              </template>
            </Vibe64AutopilotPromptTextarea>
          </div>
        </template>
      </Vibe64ConversationLog>

      <Vibe64TemporaryAiWorkspace
        v-if="props.sourceWorkspaceAvailable"
        ref="temporaryAiWorkspace"
        :active="props.active && !chatCollapsed"
        :session-selected="props.active"
        :assistant-selection="props.session?.assistantSelection"
        :assistant-ready="Boolean(sessionId) && !props.sessionSelectionArchived"
        :can-configure-routing="assistantCanConfigureRouting"
        :preview-attachment-state="previewAttachmentState"
        :project-slug="projectSlug"
        :session-id="sessionId"
        :sessions-api-path="props.sessionsApiPath"
        :repository-busy="saveWorkOperationActive || saveWorkSending"
        :update-disabled="updateWorkDisabled"
        :update-disabled-reason="saveWorkTitle"
        :workspace-setup-status="workspaceSetupStatus"
        @check-update="checkTemporaryAiUpdate"
        @select-main-chat="showMainChat"
        @task-finished="finishTemporaryAiTask"
      />
    </section>

    <section class="studio-autopilot__project-panel" aria-label="Project">
      <Vibe64AsyncModuleState
        v-if="props.sourceWorkspaceAvailable && sourceToolLoading"
        class="studio-autopilot__right-pane-page"
        label="session source"
        loading
      />
      <Vibe64DashboardShell
        v-if="props.sourceWorkspaceAvailable && !props.lessonsAvailable && props.projectPane === 'dashboard'"
        v-show="dashboardShellVisible"
        class="studio-autopilot__dashboard-shell"
        :dashboard-context="dashboardContext"
      >
        <div
          v-show="dashboardRouteVisible"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <slot
            v-if="dashboardRouteVisible"
            name="dashboard"
            :dashboard-context="dashboardContext"
          />
        </div>

        <div
          v-show="rightPaneTab === 'ai-terminal'"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <slot
            v-if="props.sourceWorkspaceAvailable && rightPaneTabMounted('ai-terminal')"
            name="ai-terminal"
            :active="rightPaneTab === 'ai-terminal'"
          />
        </div>
      </Vibe64DashboardShell>

      <section
        v-if="props.sourceWorkspaceAvailable && props.projectPane === 'dashboard' && rightPaneTab === 'changes'"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
        role="tabpanel"
      >
        <header class="studio-autopilot__session-tool-header">
          <v-btn
            :prepend-icon="mdiArrowLeft"
            size="x-small"
            type="button"
            variant="tonal"
            @click="backToDashboard"
          >
            Back to dashboard
          </v-btn>
        </header>
        <div class="studio-autopilot__right-pane-page">
          <slot name="dashboard" :dashboard-context="dashboardContext" />
        </div>
      </section>

      <section
        v-show="props.sourceWorkspaceAvailable && props.projectPane === 'dashboard' && rightPaneTab === 'editor'"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
        role="tabpanel"
      >
        <header class="studio-autopilot__session-tool-header">
          <v-btn
            v-if="systemBackAvailable"
            :prepend-icon="mdiArrowLeft"
            size="x-small"
            type="button"
            variant="tonal"
            @click="backToSystemFromEditor"
          >
            Back to Subsystems
          </v-btn>
          <v-btn
            v-else
            :prepend-icon="mdiArrowLeft"
            size="x-small"
            type="button"
            variant="tonal"
            @click="backToDashboard"
          >
            Back to dashboard
          </v-btn>
        </header>
        <Vibe64SessionFiles
          :key="assistantAccessScopeKey"
          :repo-available="Boolean(sessionSourceRoot)"
          v-if="props.sourceWorkspaceAvailable && rightPaneTabMounted('editor')"
          :active="props.active && props.projectPane === 'dashboard' && rightPaneTab === 'editor'"
          :agent-active="agentActive"
          :file-bookmarks="fileBookmarks"
          :assistant-available="assistantCanUsePurpose('source_explanation')"
          :assistant-unavailable-message="assistantPurposes.source_explanation?.message || 'Source explanations are unavailable.'"
          :ask-codex-available="sourceEditorAskCodexAvailable"
          class="studio-autopilot__session-tool-content"
          :open-request="sourceEditorOpenRequest"
          :project-slug="projectSlug"
          :session-id="sessionId"
          :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
          @ask-codex-about-file="askCodexAboutSourceEditorFile"
        />
      </section>

      <section
        v-show="props.sourceWorkspaceAvailable && props.projectPane === 'dashboard' && rightPaneTab === 'database'"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
        role="tabpanel"
      >
        <header class="studio-autopilot__session-tool-header">
          <v-btn
            :prepend-icon="mdiArrowLeft"
            size="x-small"
            type="button"
            variant="tonal"
            @click="systemBackAvailable ? backToSystemFromEditor() : backToDashboard()"
          >
            {{ systemBackAvailable ? "Back to Subsystems" : "Back to dashboard" }}
          </v-btn>
        </header>
        <Vibe64DatabaseWorkspace
          :key="assistantAccessScopeKey"
          :open-request="databaseOpenRequest"
          v-if="props.sourceWorkspaceAvailable && rightPaneTabMounted('database')"
          :active="props.active && props.projectPane === 'dashboard' && rightPaneTab === 'database'"
          :assistant-available="assistantCanUsePurpose('junior')"
          :assistant-unavailable-message="assistantJuniorRestrictionMessage"
          class="studio-autopilot__session-tool-content"
          :project-slug="projectSlug"
          :session-id="sessionId"
          :sessions-api-path="props.sessionsApiPath"
          @request-overview-assistant="assistantCanUsePurpose('junior') ? startTemporaryAiTask($event) : prefillComposer($event.message, { append: true })"
        />
      </section>

      <section
        v-show="props.sourceWorkspaceAvailable && props.projectPane === 'dashboard' && rightPaneTab === 'system'"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
        role="tabpanel"
      >
        <header class="studio-autopilot__session-tool-header">
          <v-btn
            :prepend-icon="mdiArrowLeft"
            size="x-small"
            type="button"
            variant="tonal"
            @click="backToDashboard"
          >
            Back to dashboard
          </v-btn>
        </header>
        <Vibe64SubsystemsView
          :assistant-available="assistantJuniorAllowed && !repositoryOperationActive && !props.sessionSelectionArchived"
          v-if="props.sourceWorkspaceAvailable && rightPaneTabMounted('system')"
          :active="props.active && props.projectPane === 'dashboard' && rightPaneTab === 'system'"
          class="studio-autopilot__session-tool-content"
          :resolve-request-url="resolveStudioRequestUrl"
          :restore-request="systemRestoreRequest"
          :reload-version="systemReloadVersion"
          :project-slug="projectSlug"
          @open-table="openSubsystemTable"
          @describe-subsystems="describeSubsystems"
          :session-id="sessionId"
          @open-source-file-immersive="openSourceEditorFile"
          @open-source-file="openSourceEditorFile"
        >
          <template #text="{ text, sourcePath, openSource }">
            <LongTextPreviewBlocks
              style="gap: 1em"
              :blocks="parseLongTextReviewBlocks(text)"
              @link-click="openSubsystemTextLink($event, sourcePath, openSource)"
            />
          </template>
        </Vibe64SubsystemsView>
      </section>

      <div
        v-show="!props.sourceWorkspaceAvailable || props.projectPane !== 'dashboard' || props.lessonsAvailable"
        class="studio-autopilot__right-pane-page"
        role="tabpanel"
      >
        <TrainingPreviewPresentation
          :lessons-available="props.lessonsAvailable"
          :app-available="props.outputWorkspaceAvailable ?? props.sourceWorkspaceAvailable"
          :attempt-id="props.learningAttemptId"
          :learning-binding="props.sourceWorkspaceAvailable ? null : props.conversationRuntime?.identity"
          :active="props.active && (props.lessonsAvailable || props.projectPane === 'preview') && !props.sessionSelectionArchived"
          :project-slug="props.conversationRuntime?.identity?.noExercise === false ? props.conversationRuntime.identity.sourceProjectSlug : projectSlug"
          :session-id="selectedAssistantSessionId"
        >
          <template #lessons><slot name="dashboard" :dashboard-context="dashboardContext" /></template>
          <template #default="{ appVisible, presentation }">
            <Vibe64ProjectOnboarding
              v-if="props.outputWorkspaceAvailable ?? props.sourceWorkspaceAvailable"
              :learning-binding="props.sourceWorkspaceAvailable ? null : props.conversationRuntime?.identity"
              :active="props.active && (props.lessonsAvailable ? appVisible : props.projectPane === 'preview')"
              :presentation-active="props.active && props.lessonsAvailable && !props.sessionSelectionArchived"
              :archived="props.sessionSelectionArchived"
              :busy="sourceOperationsSuspended || agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"
              :can-ask="assistantJuniorAllowed"
              :request-temporary-ai="startTemporaryAiTask"
              :session-id="selectedAssistantSessionId"
              :presentation="presentation"
            >
              <Vibe64OutputControls
                :learning-binding="props.sourceWorkspaceAvailable ? null : props.conversationRuntime?.identity"
                :ask-codex-to-fix-preview-identity="props.sourceWorkspaceAvailable && assistantJuniorAllowed ? askCodexToFixPreviewIdentity : null"
                :attach-preview-file="props.sourceWorkspaceAvailable ? attachPreviewFile : null"
                :prepare-preview-file="props.sourceWorkspaceAvailable ? attachPreviewFileProducer : null"
                :auto-start-managed-preview="!props.sessionSelectionArchived"
                button-label="Run"
                button-size="small"
                button-variant="tonal"
                :busy="agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"
                :preview-goal-state="props.conversationRuntime?.goalState"
                class="studio-autopilot__preview-launch"
                embedded-preview
                :preview-displayed="(props.lessonsAvailable || props.projectPane === 'preview') && appVisible"
                :session="props.session"
                :source-operations-suspended="props.sourceWorkspaceAvailable ? sourceOperationsSuspended : agentActive"
                :toolbar-teleport-target="(props.lessonsAvailable || props.projectPane === 'preview') && appVisible ? props.previewToolbarTeleportTarget : ''"
                :window-displayed="props.active"
                @preview-attachment-state="updatePreviewAttachmentState"
                @test-approval="updateTestApproval"
              />
            </Vibe64ProjectOnboarding>
          </template>
        </TrainingPreviewPresentation>
      </div>
    </section>

    <v-dialog v-model="saveWorkConfirmOpen" max-width="30rem" aria-label="Save changes" scrollable>
      <v-card rounded="xl">
        <v-card-title>Save changes</v-card-title>
        <v-card-text>
          <div class="d-flex align-center justify-space-between ga-2 mb-2">
            <span>{{ props.workState?.changedPaths?.length || 0 }} changed {{ props.workState?.changedPaths?.length === 1 ? 'file' : 'files' }}</span>
            <v-btn height="48" variant="text" @click="cancelSaveWork(); selectSessionTool('changes')">View diff</v-btn>
          </div>
          <v-sheet v-if="saveWorkReview" color="surface-light" rounded="lg" class="pa-3" style="overflow-wrap: anywhere">
            <div class="text-label-small text-medium-emphasis">{{ saveWorkReview.mode === 'github' ? 'GitHub' : saveWorkReview.mode === 'local_source' ? 'Local project' : 'Project version' }}</div>
            <strong>{{ saveWorkReview.repository }}:{{ saveWorkReview.branch }}</strong>
            <p v-if="sessionPullRequest" class="text-body-small mt-1 mb-0">PR #{{ sessionPullRequest.number }} · {{ sessionPullRequest.headBranch }} → {{ sessionPullRequest.baseBranch }}</p>
          </v-sheet>
          <p v-else role="status">Refresh repository status to review the destination.</p>
          <p class="text-body-small mt-3 mb-0">Save open file edits first.</p>
          <p v-if="props.workState?.publicationRequiresPullRequest && !sessionPullRequest?.number" role="status" class="text-body-small mt-2">A pull request is required.</p>
          <p v-if="saveWorkDisabled" role="status" class="mt-3">{{ saveWorkTitle }}</p>
        </v-card-text>
        <v-card-actions class="flex-wrap ga-2 px-6 pb-5">
          <v-spacer />
          <v-btn :disabled="saveWorkSending" height="48" type="button" variant="text" @click="cancelSaveWork">
            Cancel
          </v-btn>
          <v-btn
            v-if="githubProject && !sessionPullRequest?.number"
            color="primary"
            height="48"
            :variant="saveWorkNeedsPullRequest ? 'flat' : 'outlined'"
            :disabled="saveWorkDisabled || !saveWorkReview"
            @click="cancelSaveWork(); createPullRequestOpen = true"
          >
            Create draft PR
          </v-btn>
          <v-btn
            :aria-busy="saveWorkSending ? 'true' : undefined"
            color="primary"
            min-height="48"
            :disabled="saveWorkDisabled || !saveWorkReview || saveWorkNeedsPullRequest"
            type="button"
            :variant="saveWorkNeedsPullRequest ? 'outlined' : 'flat'"
            @click="confirmSaveWork"
          >
            <span class="text-wrap" style="overflow-wrap: anywhere">{{ saveWorkSending ? "Committing…" : publicationLabel }}</span>
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { computed, defineAsyncComponent, inject, nextTick, onBeforeUnmount, reactive, ref, useId, watch, watchEffect } from "vue";
import {
  LongTextPreviewBlocks
} from "@jskit-ai/assistant-core/client/conversation";
import { VIBE64_ASSISTANT_HOST_KEY, VIBE64_COLLEAGUE_VIEW_KEY, VIBE64_COLLEAGUE_LAYOUT_KEY, VIBE64_COLLEAGUE_PREVIEW_KEY } from "@/lib/vibe64AssistantHost.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import { VIBE64_RESOURCE_RECOVERY_KEY } from "@/lib/vibe64ResourceRecovery.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  mdiArrowLeft,
  mdiArrowTopRight,
  mdiAutorenew,
  mdiCircle,
  mdiConsoleNetworkOutline,
  mdiContentSaveOutline,
  mdiSourceCommit,
  mdiDotsVertical,
  mdiEyePlusOutline,
  mdiGithub,
  mdiIncognito,
  mdiPaperclip,
  mdiPlus,
  mdiSend,
  mdiSourcePull,
  mdiStop,
} from "@mdi/js";
import { vibe64SessionPullRequest } from "@/lib/vibe64SessionViewModel.js";
import Vibe64CreatePullRequestDialog from "@/components/studio/vibe64-session/Vibe64CreatePullRequestDialog.vue";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import Vibe64ProjectOnboarding from "@/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue";
import TrainingPreviewPresentation from "@local/vibe64-training/client/preview-presentation";
import Vibe64AgentPlanUsage from "@/components/studio/vibe64-session/Vibe64AgentPlanUsage.vue";
import Vibe64RoutingNotice from "./Vibe64RoutingNotice.vue";
import Vibe64WorkPlan from "./Vibe64WorkPlan.vue";
import Vibe64ChatModeControls from "./Vibe64ChatModeControls.vue";
import { useModelRouting } from "@local/vibe64-accounts/client";
import Vibe64SessionAssistantMenu from "@/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";
import Vibe64StarredFilesMenu from "@/components/studio/vibe64-session/Vibe64StarredFilesMenu.vue";
import { useVibe64StarredFiles } from "@/composables/useVibe64StarredFiles.js";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import { AssistantQuestionInputs, AssistantComposerSupport } from "@jskit-ai/assistant-core/client/conversation";
import Vibe64ConversationLog from "@/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import Vibe64TemporaryActionTerminal from "@/components/studio/Vibe64TemporaryActionTerminal.vue";
import Vibe64TemporaryAiFixAction from "@/components/studio/Vibe64TemporaryAiFixAction.vue";
import Vibe64SessionFiles from "@/components/studio/vibe64-session/Vibe64SessionFiles.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64TemporaryAiWorkspace from "@/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import { writeClipboardText } from "@/lib/clipboard.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { parseLongTextReviewBlocks } from "@jskit-ai/assistant-core/shared/conversation";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { githubProjectAvailable } from "@/lib/vibe64GithubProject.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import {
  useVibe64AutopilotView,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
} from "@/composables/useVibe64AutopilotView.js";
import {
  promptHintConversationFingerprint,
  useVibe64PromptHints
} from "@/composables/useVibe64PromptHints.js";
import {
  useVibe64SessionTypingPresence
} from "@/composables/useVibe64SessionTypingPresence.js";
import {
  VIBE64_SESSION_CHANGED_EVENT
} from "@/lib/vibe64SessionRequestConfig.js";

const emit = defineEmits(vibe64AutopilotViewEmits);
const props = defineProps(vibe64AutopilotViewProps);
const resourceRecoveryControl = inject(VIBE64_RESOURCE_RECOVERY_KEY, null);
const resourceRetryBusy = ref(false);
function openSubsystemTextLink({ event, href }, sourcePath, openSource) {
  // Markdown links are relative to their declaration, not the dashboard URL.
  const relative = href && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(href);
  const target = sourceEditorLinkTarget({
    href: relative
      ? new URL(href, `https://source.invalid/${sourcePath}`).pathname.slice(1)
      : href
  });
  if (!target) return;
  event?.preventDefault();
  openSource(target);
}
const sessionRenewalActionPresentation = computed(() => (
  props.sessionRenewal?.actionPresentation ||
  props.sessionRenewal?.advisoryPresentation || {
    attention: false,
    color: undefined,
    label: "Renew session",
    reason: "Renew this session with a reviewed handover."
  }
));
const sourceOperationsSuspended = computed(() => (
  props.sessionRenewal?.sourceOperationsSuspended === true
));
const Vibe64SubsystemsView = defineAsyncComponent(() => (
  import("@local/vibe64-system-graph/client").then((module) => module.loadVibe64SubsystemsView())
));
const Vibe64DatabaseWorkspace = defineAsyncComponent(() => (
  import("@local/vibe64-database-tools/client").then((module) => module.loadVibe64DatabaseWorkspace())
));
const composerInput = ref(null);
const conversationView = ref(null);
const composerSendButton = ref(null);
const composerSettingsOpen = ref(false);
const composerSettingsButton = ref(null);
const mainChat = ref(null);
const sessionActionsTrigger = ref(null);
const temporaryAiWorkspace = ref(null);
const workPlanViewer = ref(null);
const temporaryAiHasUnreadMessages = computed(() => temporaryAiWorkspace.value?.hasUnreadMessages === true);
const sessionActionsLabel = computed(() => [
  "Session actions",
  sessionRenewalActionPresentation.value.attention ? sessionRenewalActionPresentation.value.label : "",
  temporaryAiHasUnreadMessages.value ? "Unread temporary AI messages" : ""
].filter(Boolean).join(": "));
const workspaceRecoveryTaskId = ref("");
const thinkingStatusId = `studio-autopilot-thinking-${useId()}`;
const testApproval = ref(null);
function updateTestApproval(value) {
  if (value.sessionId === props.session?.sessionId) testApproval.value = value.approval;
}
watch(() => props.session?.sessionId, () => { testApproval.value = null; });
const composerAttachmentState = ref({
  count: 0,
  hasUnresolved: false,
  uploading: false
});
const selectedAssistantSessionId = computed(() => String(
  props.session?.sessionId || ""
).trim());
const openCodeProgressLabel = ref("");
const openCodeProviderLabel = computed(() => ({
  deepseek: "DeepSeek",
  "zai-coding-plan": "Z.AI"
})[String(props.session?.assistantSelection?.modelProviderId || "").trim()] || "OpenCode");

function visibleOpenCodeProgressLabel(progress = {}) {
  if (String(progress.tool || "").trim()) {
    return `${openCodeProviderLabel.value} is using a tool…`;
  }
  if (
    String(progress.partType || "").trim() === "reasoning" ||
    String(progress.type || "").includes("reasoning")
  ) {
    return `${openCodeProviderLabel.value} is reasoning…`;
  }
  if (String(progress.text || "").trim()) {
    return `${openCodeProviderLabel.value} is writing…`;
  }
  return `${openCodeProviderLabel.value} is working…`;
}

useRealtimeEvent({
  enabled: computed(() => Boolean(
    props.active &&
    !props.sessionSelectionArchived &&
    selectedAssistantSessionId.value &&
    props.session?.assistantSelection?.engineId === "opencode"
  )),
  event: VIBE64_SESSION_CHANGED_EVENT,
  matches: ({ payload = {} } = {}) => Boolean(
    String(payload.sessionId || payload.entityId || "").trim() === selectedAssistantSessionId.value &&
    (
      payload.assistantProgress ||
      [
        "opencode-server-message-delivered",
        "opencode-server-turn-active",
        "opencode-server-turn-idle"
      ].includes(payload.reason)
    )
  ),
  onEvent: ({ payload = {} } = {}) => {
    openCodeProgressLabel.value = payload.reason === "opencode-server-turn-idle"
      ? ""
      : visibleOpenCodeProgressLabel(payload.assistantProgress || {});
  }
});

watch([
  selectedAssistantSessionId,
  () => props.session?.assistantSelection?.engineId
], () => {
  openCodeProgressLabel.value = "";
}, { immediate: true });
const { resource: modelRoutingResource } = useModelRouting({
  workflowsOnly: true,
  enabled: computed(() => !props.sessionSelectionArchived && Boolean(selectedAssistantSessionId.value))
});
const assistantCanConfigureRouting = computed(() => modelRoutingResource.data.value?.canConfigure === true);
const assistantAccessError = computed(() => props.conversationRuntime.access.accessError.value);
const assistantCanUseAiState = computed(() => props.conversationRuntime.access.canUseChat.value);
const assistantCanRouteChat = computed(() => props.conversationRuntime.access.canRouteChat.value);
const assistantCanUseNative = computed(() => props.conversationRuntime.access.canUseNative.value);
const assistantPurposes = computed(() => props.conversationRuntime.access.purposes.value);
const assistantAccessScopeKey = computed(() => props.conversationRuntime.access.scopeKey.value);
const assistantAccessLoading = computed(() => props.conversationRuntime.access.initialAccessLoading.value);
const assistantRestrictionMessage = computed(() => props.conversationRuntime.access.restrictionMessage.value);
const assistantCanUsePurpose = purpose => props.conversationRuntime.access.canUsePurpose(purpose);
const reloadAssistantAccess = () => props.conversationRuntime.access.reload();


const {
  Vibe64OutputControls,
  assistantDirectAllowed,
  assistantJuniorAllowed,
  assistantSeniorAllowed,
  agentActive,
  reasoningActive,
  agentObservationLost,
  agentStopEnabled,
  agentStopVisible,
  answerChoices,
  prefillComposer,
  askCodexAboutSourceEditorFile,
  askCodexToFixPreviewIdentity,
  askCodexToFixWorkspaceSetup,
  attachPreviewDiagnostics,
  backToDashboard,
  backToSystemFromEditor,
  cancelOptimisticMessage,
  cancelSaveWork,
  captureVisiblePreview,
  chatCollapsed,
  chatReloading,
  reloadChatPane,
  chatTurns,
  composerKey,
  composerAttachments,
  composerAttachmentsEnabled,
  composerAttachmentsSupported,
  composerCanSubmit,
  composerDisabled,
  composerDraft,
  composerHint,
  composerPlaceholder,
  composerSending,
  routingRequest,
  composerSubmitAriaLabel,
  composerSubmitMode,
  composerSubmitTitle,
  conversationLogVisible,
  conversationFollowLatestKey,
  conversationScrollKey,
  dashboardSessionContext,
  dashboardRouteVisible,
  dashboardShellVisible,
  sourceToolLoading,
  dismissSaveWorkActivity,
  dismissNumberedQuestions,
  dismissWorkspaceSetupActivity,
  confirmSaveWork,
  editOptimisticMessage,
  emptyConversationWelcome,
  fixRepositoryActionError,
  fixRepositoryError,
  handleTemporaryAiTaskFinished,
  interrupting,
  loadMoreChatTurns,
  numberedQuestionSelectItems,
  numberedQuestions,
  openIntegrationRequest,
  skipIntegrationRequest,
  resumeIntegrationRequest,
  connectIntegrationRequest,
  checkIntegrationRequest,
  cancelIntegrationRequest,
  openSourceEditorFile,
  openSubsystemTable,
  describeSubsystems,
  databaseOpenRequest,
  previewAttachmentState,
  projectSlug,
  questionAnswers,
  repositoryRecoverySending,
  repositoryOperationActive,
  retrySaveWork,
  retryWorkspaceSetup,
  requestSaveWork,
  resendOptimisticMessage,
  requestAgentInterrupt,
  rightPaneTab,
  rightPaneTabMounted,
  saveWorkConfirmOpen,
  saveWorkReview,
  saveWorkActivityDismissed,
  saveWorkActivityKey,
  saveWorkActivityIsUpdate,
  saveWorkActivityLabel,
  saveWorkDisabled,
  updateWorkDisabled,
  saveWorkError,
  saveWorkFailure,
  saveWorkHeaderAriaLabel,
  saveWorkHeaderVisible,
  saveWorkCanResolveWithTemporaryAi,
  saveWorkOperationActive,
  saveWorkOutput,
  saveWorkRetryable,
  saveWorkSending,
  saveWorkStage,
  saveWorkStatus,
  saveWorkTitle,
  saveWorkRequiresUpdate,
  saveWorkUnsaved,
  selectSessionTool,
  sessionId,
  sessionGithubActor,
  sessionGithubActorHeaderVisible,
  sessionSourceRoot,
  sessionToolbarVisible,
  selectedAnswerChoice,
  sourceEditorAskCodexAvailable,
  sourceEditorOpenRequest,
  structuredQuestionActive,
  submitComposerMessage,
  systemBackAvailable,
  systemRestoreRequest,
  systemReloadVersion,
  thinkingLabel,
  thinkingVisible,
  assistantAccountMessage,
  assistantAccountUnavailable,
  connectionRecoveryVisible,
  updateComposerAttachments,
  updatePreviewAttachmentState,
  workspaceSetupAskDisabled,
  workspaceSetupActivityKey,
  workspaceSetupCurrentLabel,
  workspaceSetupDismissed,
  workspaceSetupFixSending,
  workspaceSetupNeedsAttention,
  workspaceSetupError,
  workspaceSetupOutput,
  workspaceSetupRetryDisabled,
  workspaceSetupRetrying,
  workspaceSetupRunning,
  workspaceSetupStatus,
  workspaceSetupTitle
} = useVibe64AutopilotView(props, emit, {
  assistantAccessLoading,
  assistantCanUseAi: assistantCanUseAiState,
  assistantCanRouteChat,
  assistantCanUseJunior: computed(() => assistantCanUsePurpose("junior")),
  assistantCanUseSenior: computed(() => assistantCanUsePurpose("senior")),
  assistantCanUseNative,
  assistantProgressLabel: openCodeProgressLabel,
  onAttachmentsAccepted: (attachmentIds) => composerInput.value?.clearAttachments?.({ attachmentIds }),
  requestTemporaryAi: startTemporaryAiTask
});
const fileBookmarks = useVibe64StarredFiles({
  projectSlug,
  sessionId,
  sessionsApiPath: () => props.sessionsApiPath
});
const {
  blur: stopTypingOnBlur,
  noteInputActivity: noteTypingActivity,
  submit: stopTypingOnSubmit,
  typingLabel
} = useVibe64SessionTypingPresence({
  active: computed(() => props.active && !props.sessionSelectionArchived),
  projectSlug,
  sessionId,
  sessionsApiPath: computed(() => readRefOrGetterValue(props.sessionsApiPath))
});
const composerAccessHint = computed(() => assistantRestrictionMessage.value || composerHint.value);
const composerAssistantLabel = computed(() => {
  if (testApproval.value?.state === "waiting") return "Waiting for memory approval";
  if (!thinkingVisible.value) return typingLabel.value;
  if (props.conversationLog?.error) return "";
  return assistantRestrictionMessage.value || thinkingLabel.value;
});
watch(agentActive, (active) => {
  if (!active) {
    openCodeProgressLabel.value = "";
  }
}, { flush: "sync", immediate: true });
const routingReviewRetrying = ref(false);
async function retryAutomaticReview() {
  if (routingReviewRetrying.value || !routingRequest.value) return;
  routingReviewRetrying.value = true;
  try { await props.sendAgentMessage({ messageId: routingRequest.value.messageId, message: routingRequest.value.input.message, reviewAction: "retry" }); }
  finally { routingReviewRetrying.value = false; }
}
const conversationAssistantLabel = computed(() => props.session?.assistantSelection
  ? vibe64AssistantSelectionLabel(props.session.assistantSelection) : "Assistant");
const updateHandledInRepair = computed(() => Boolean(
  (saveWorkActivityIsUpdate.value || saveWorkError.value) && temporaryAiWorkspace.value?.updateRepairVisible
));

const promptHintsBlankConversation = computed(() => chatTurns.value.length < 1);
const promptHintsCanRequest = computed(() => Boolean(
  props.active &&
  !props.conversationLog?.loading &&
  !props.conversationLog?.error &&
  !props.sessionSelectionArchived &&
  sessionId.value &&
  sessionSourceRoot.value &&
  !agentActive.value &&
  !composerSending.value &&
  !interrupting.value &&
  !repositoryOperationActive.value &&
  !repositoryRecoverySending.value &&
  !saveWorkSending.value &&
  !workspaceSetupRunning.value &&
  !workspaceSetupRetrying.value &&
  !sourceOperationsSuspended.value &&
  (promptHintsBlankConversation.value || assistantCanUsePurpose("prompt_hint")) &&
  !structuredQuestionActive.value &&
  composerAttachmentState.value.count < 1 &&
  !composerAttachmentState.value.uploading &&
  !composerAttachmentState.value.hasUnresolved &&
  !previewAttachmentState.value.captureBusy &&
  !previewAttachmentState.value.diagnosticsBusy
));
const promptHintsConversationKey = computed(() => (
  JSON.stringify([promptHintConversationFingerprint(chatTurns.value), assistantAccessScopeKey.value, assistantPurposes.value.prompt_hint])
));
const promptHintsExistingProject = computed(() => workspaceSetupStatus.value !== "unconfigured");
const {
  blurComposer: blurPromptHints,
  dismissPromptHints,
  focusComposer: focusPromptHints,
  loading: promptHintsLoading,
  preview: promptHintPreview,
  previewPromptHint,
  selectPromptHint,
  suggestions: promptHintSuggestions,
  visible: promptHintsVisible
} = useVibe64PromptHints({
  active: computed(() => props.active),
  blankConversation: promptHintsBlankConversation,
  canRequest: promptHintsCanRequest,
  conversationKey: promptHintsConversationKey,
  draft: composerDraft,
  existingProject: promptHintsExistingProject,
  onSelect: applyPromptHint,
  policy: computed(() => props.promptHintPolicy),
  sessionId,
  sessionsApiPath: computed(() => readRefOrGetterValue(props.sessionsApiPath))
});
const composerPromptHintPreview = computed(() => (
  promptHintsVisible.value &&
  !String(composerDraft.value || "").trim() &&
  promptHintPreview.value
    ? promptHintPreview.value
    : ""
));
const composerPromptHintPlaceholder = computed(() => (
  composerPromptHintPreview.value || composerPlaceholder.value
));
const composerSupportStatusVisible = computed(() => Boolean(
  composerAssistantLabel.value || promptHintsVisible.value
));

const createPullRequestOpen = ref(false);
const checkpointFailure = computed(() => (props.session?.backgroundTasks || [])
  .find((task) => task.id === "codex_turn_checkpoint" && task.status === "failed")?.error || "");
const sessionPullRequest = computed(() => vibe64SessionPullRequest(props.session));
const sessionPullRequestTarget = computed(() => sessionPullRequest.value?.number ? {
  path: projectAppPath(projectSlug.value, '/dashboard/pull-requests'),
  query: { pr: String(sessionPullRequest.value.number) }
} : undefined);
const githubProject = computed(() => githubProjectAvailable(props.projectContext));
const saveWorkNeedsPullRequest = computed(() => githubProject.value &&
  props.workState?.publicationRequiresPullRequest === true && !sessionPullRequest.value?.number);
const saveWorkCanCreatePullRequest = computed(() => githubProject.value && !sessionPullRequest.value?.number &&
  saveWorkFailure.value?.code === "vibe64_pull_request_required");
const assistantJuniorRestrictionMessage = computed(() => assistantPurposes.value.junior?.message || "Junior is unavailable. Review model routing.");
const assistantSeniorRestrictionMessage = computed(() => assistantPurposes.value.senior?.message || "Senior is unavailable. Review model routing.");
const publicationLabel = computed(() => {
  const destination = saveWorkReview.value;
  if (destination?.mode === "github") return "Commit & push";
  return "Save";
});
const dashboardContext = computed(() => ({
  ...(dashboardSessionContext.value || {}),
  assistantDirectAllowed: assistantDirectAllowed.value,
  assistantDraftAvailable: sourceEditorAskCodexAvailable.value,
  assistantJuniorAllowed: assistantJuniorAllowed.value,
  assistantJuniorRestrictionMessage: assistantJuniorRestrictionMessage.value,
  assistantSeniorAllowed: assistantSeniorAllowed.value,
  assistantSeniorRestrictionMessage: assistantSeniorRestrictionMessage.value,
  assistantRestrictionMessage: assistantRestrictionMessage.value,
  requestAssistantDraft: (text) => prefillComposer(text, { append: true }),
  requestUpdateWork: props.updateSessionWork,
  requestTemporaryAi: fixRepositoryError,
  sourceOperationsSuspended: sourceOperationsSuspended.value
}));

const sessionArchiveDisabled = computed(() => Boolean(
  props.sessionSelectionArchived ||
  props.sessionArchive?.command?.isRunning ||
  workspaceSetupRunning.value ||
  workspaceSetupRetrying.value
));

async function sendComposerMessage() {
  if (conversationView.value?.composerBlocked || composerInput.value?.attachmentsCanSubmit?.() === false) {
    return false;
  }
  stopTypingOnSubmit();
  return submitComposerMessage();
}

async function continueConversation() {
  composerSettingsOpen.value = false;
  composerInput.value?.focus?.();
  if (composerDraft.value.trim() || composerAttachments.value.length) return;
  composerDraft.value = "Continue.";
  await nextTick();
  if (composerCanSubmit.value) await sendComposerMessage();
}

function focusComposerSendButton() {
  composerSendButton.value?.$el?.focus();
}

function updateComposerAttachmentState(state = {}) {
  composerAttachmentState.value = {
    count: Number(state?.count || 0),
    hasUnresolved: state?.hasUnresolved === true,
    uploading: state?.uploading === true
  };
}

function focusTargetInside(target, selector) {
  return Boolean(target?.closest?.(selector));
}

function handleComposerBlur(event = {}) {
  stopTypingOnBlur();
  if (focusTargetInside(
    event.relatedTarget,
    "[data-assistant-composer-support], .studio-autopilot__composer"
  )) {
    return;
  }
  blurPromptHints();
}

function handleComposerRegionFocusOut(event = {}) {
  if (
    event.currentTarget?.contains?.(event.relatedTarget) ||
    focusTargetInside(event.relatedTarget, "[data-assistant-composer-support]")
  ) {
    return;
  }
  blurPromptHints();
}

function handlePromptHintsFocusOut(event = {}) {
  if (
    event.currentTarget?.contains?.(event.relatedTarget) ||
    focusTargetInside(event.relatedTarget, ".studio-autopilot-prompt-textarea")
  ) {
    return;
  }
  blurPromptHints();
}

function dismissPromptHintsAndFocus() {
  composerInput.value?.focus?.({ preventScroll: true });
  dismissPromptHints();
}

function applyPromptHint(text = "") {
  const suggestion = String(text || "").trim();
  if (!suggestion) {
    return false;
  }
  if (composerDraft.value !== suggestion) {
    composerInput.value?.preserveHeightForNextModelValue?.();
    composerDraft.value = suggestion;
  }
  void nextTick(() => {
    composerInput.value?.focus?.({ preventScroll: true });
  });
  return true;
}

function copyActivityOutput(output = "") {
  return writeClipboardText(output);
}

function openTemporaryAi() {
  if (!props.sourceWorkspaceAvailable) return;
  if (!sessionId.value || props.sessionSelectionArchived) {
    return false;
  }
  temporaryAiWorkspace.value?.showWorkspace?.();
  return true;
}

async function startTemporaryAiTask(options = {}) {
  if (!assistantCanUsePurpose(options.recoveryOperation === "update" ? "senior" : "junior") || props.sessionSelectionArchived) {
    return false;
  }
  emit("chat-attention");
  const workspace = temporaryAiWorkspace.value;
  if (typeof workspace?.startTask !== "function") {
    return false;
  }
  return workspace.startTask(options);
}

function reportVerifiedWorkspaceRecovery() {
  if (!workspaceRecoveryTaskId.value || workspaceSetupStatus.value !== "succeeded") {
    return false;
  }
  const reported = temporaryAiWorkspace.value?.reportTaskRecovery?.(
    workspaceRecoveryTaskId.value,
    {
      message: "Workspace preparation succeeded. Vibe64 independently verified the AI repair.",
      status: "succeeded"
    }
  );
  if (reported) {
    workspaceRecoveryTaskId.value = "";
  }
  return Boolean(reported);
}

async function finishTemporaryAiTask(task = {}) {
  const recovery = await handleTemporaryAiTaskFinished(task, (taskId, outcome) => (
    temporaryAiWorkspace.value?.reportTaskRecovery?.(taskId, outcome)
  ));
  if (!recovery) {
    return false;
  }
  if (recovery === "workspace-setup") {
    workspaceRecoveryTaskId.value = String(task.id || "").trim();
    reportVerifiedWorkspaceRecovery();
  }
  return true;
}

function checkTemporaryAiUpdate(task) {
  if (updateWorkDisabled.value) return false;
  return handleTemporaryAiTaskFinished(task, (taskId, outcome) => (
    temporaryAiWorkspace.value?.reportTaskRecovery?.(taskId, outcome)
  ), { force: true });
}

const saveWorkChecking = ref(false);
const saveWorkCheckAvailable = computed(() => Boolean(
  saveWorkDisabled.value && !saveWorkRequiresUpdate.value &&
  !saveWorkSending.value && !repositoryOperationActive.value &&
  !sourceOperationsSuspended.value && !props.sessionSelectionArchived &&
  typeof props.sessionToolbar?.refreshRepositoryState === "function"
));
const saveWorkHeaderHint = computed(() => {
  const status = saveWorkChecking.value ? "Checking for updates…"
    : saveWorkCheckAvailable.value ? `${saveWorkTitle.value}. Click to check for updates.`
      : saveWorkTitle.value;
  const destination = props.workState?.destination;
  if (!destination) return status;
  if (saveWorkRequiresUpdate.value || saveWorkDisabled.value || saveWorkChecking.value) {
    return `${status}\n${destination.repository}:${destination.branch}`;
  }
  const action = destination.mode === "local_source" ? "Local commit"
    : destination.mode === "github" ? "Commit & push" : "Project version";
  return `${action} · ${destination.repository}:${destination.branch}\n${status}`;
});

async function requestSessionSaveWork() {
  if (saveWorkChecking.value) return;
  if (saveWorkCheckAvailable.value) {
    saveWorkChecking.value = true;
    try {
      await props.sessionToolbar.refreshRepositoryState(sessionId.value);
    } finally {
      saveWorkChecking.value = false;
    }
    return;
  }
  const repair = temporaryAiWorkspace.value?.updateRepairTask;
  if (saveWorkRequiresUpdate.value && repair) {
    temporaryAiWorkspace.value?.selectTask?.(repair.id);
    return checkTemporaryAiUpdate(repair);
  }
  return requestSaveWork();
}

async function showMainChat() {
  temporaryAiWorkspace.value?.closeWorkspace?.();
  await nextTick();
  mainChat.value?.focus?.({ preventScroll: true });
}

watch(workspaceSetupStatus, () => {
  reportVerifiedWorkspaceRecovery();
});

watch(selectedAssistantSessionId, () => {
  workspaceRecoveryTaskId.value = "";
});

async function attachPreviewFile(file) {
  const composer = temporaryAiWorkspace.value?.composer || composerInput.value;
  const uploaded = await composer?.attachFiles?.([file]);
  if (!Array.isArray(uploaded) || uploaded.length < 1) {
    throw new Error("Open the chat composer before attaching a preview file.");
  }
  return uploaded[0];
}

async function attachPreviewFileProducer(options = {}) {
  const composer = temporaryAiWorkspace.value?.composer || composerInput.value;
  const uploaded = await composer?.attachFileProducer?.(options);
  return Array.isArray(uploaded) && uploaded.length > 0 ? uploaded[0] : null;
}

function requestSessionRenewal(returnFocusTarget = null) {
  props.sessionRenewal?.request?.({
    returnFocusTarget: returnFocusTarget?.$el || returnFocusTarget
  });
  return true;
}

// The selected app layer is shared with host-owned companions; retained sessions cannot claim it.
const assistantHost = inject(VIBE64_ASSISTANT_HOST_KEY, null);
const learningViewRef = inject(VIBE64_COLLEAGUE_VIEW_KEY, null);
const learningLayoutRef = inject(VIBE64_COLLEAGUE_LAYOUT_KEY, null);
const learningPreviewRef = inject(VIBE64_COLLEAGUE_PREVIEW_KEY, null);
const learningIdentity = computed(() => props.conversationRuntime?.identity?.learningAttemptId ? props.conversationRuntime.identity : null);
const learningSelected = computed(() => Boolean(learningIdentity.value && props.active && !props.sessionSelectionArchived &&
  props.conversationRuntime?.available?.value));
const learningLayout = Object.freeze({
  get projectSlug() { return learningIdentity.value?.sourceProjectSlug || ""; },
  get learningAttemptId() { return learningIdentity.value?.learningAttemptId; },
  get learnerId() { return learningIdentity.value?.learnerId; },
  get ready() { return learningSelected.value && Boolean(props.conversationRuntime?.conversationReady?.value); },
  get projectVisible() { return true; },
  get chatVisible() { return !chatCollapsed.value; }
});
const learningView = Object.freeze({
  get projectSlug() { return learningLayout.projectSlug; }, get sessionId() { return learningIdentity.value?.sessionId || ""; },
  get learningBinding() { return learningIdentity.value; }, get ready() { return learningLayout.ready; },
  get hostConversationSelected() { return false; }, get temporarySelected() { return false; },
  get conversationId() { return ""; },
  get pane() {
    if (!learningLayout.projectVisible) return "chat";
    const preview = learningPreviewRef?.value;
    const binding = learningIdentity.value;
    return binding && preview?.sessionId === binding.sessionId && preview.learningAttemptId === binding.learningAttemptId &&
      preview.learnerId === binding.learnerId && (preview.projectSlug || "") === (binding.sourceProjectSlug || "") &&
      (preview.appVisible === true || preview.presentation?.state?.visible === true) ? "preview" : "lessons";
  }
});
watchEffect(() => {
  if (learningSelected.value) {
    if (learningLayoutRef) learningLayoutRef.value = learningLayout;
    if (learningViewRef) learningViewRef.value = learningView;
  } else {
    if (learningViewRef?.value === learningView) learningViewRef.value = null;
    if (learningLayoutRef?.value === learningLayout) learningLayoutRef.value = null;
  }
}, { flush: "sync" });
onBeforeUnmount(() => {
  if (learningViewRef?.value === learningView) learningViewRef.value = null;
  if (learningLayoutRef?.value === learningLayout) learningLayoutRef.value = null;
});
const assistantLayerSelected = computed(() => props.active && !props.sessionSelectionArchived && !temporaryAiWorkspace.value?.visible);
const assistantLayer = reactive({
  get sessionId() { return sessionId.value; },

});
watchEffect(() => {
  if (!assistantHost) {
    return;
  }
  if (assistantLayerSelected.value) {
    assistantHost.value = assistantLayer;
  } else if (assistantHost.value === assistantLayer) {
    assistantHost.value = null;
  }
}, { flush: "sync" });
onBeforeUnmount(() => {
  if (assistantHost?.value === assistantLayer) {
    assistantHost.value = null;
  }
});

</script>

<style scoped>
.studio-autopilot__reasoning-dots {
  display: inline-block;
  clip-path: inset(0 66.666% 0 0);
  animation: reasoning-dots 1.5s step-end infinite;
}
@keyframes reasoning-dots {
  33% { clip-path: inset(0 33.333% 0 0); }
  66% { clip-path: inset(0 0 0 0); }
}
@media (prefers-reduced-motion: reduce) {
  .studio-autopilot__reasoning-dots { animation: none; clip-path: none; }
}
.studio-autopilot__checkpoint-notice summary {
  cursor: pointer;
}
.studio-autopilot__checkpoint-details {
  max-height: 8rem;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.studio-autopilot {
  background: rgb(var(--v-theme-background));
  display: grid;
  grid-template-columns: minmax(20rem, 38%) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
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

.studio-autopilot--chat-collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}

.studio-autopilot__chat-panel {
  background: rgb(var(--v-theme-surface));
  border-right: 1px solid rgba(var(--v-theme-outline), 0.14);
  container-name: studio-chat-pane;
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.studio-autopilot--chat-collapsed .studio-autopilot__chat-panel {
  visibility: hidden;
}

.studio-autopilot__session-header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  box-sizing: border-box;
  display: flex;
  gap: 0;
  grid-row: 1;
  justify-content: space-between;
  min-height: 3rem;
  min-width: 0;
  overflow: hidden;
  padding: 0.4rem 0.25rem;
  width: 100%;
}

.studio-autopilot__session-header :deep(.studio-ai-sessions__toolbar) {
  flex: 1 1 auto;
  margin-inline-end: 0.35rem;
  min-width: 0;
  overflow: hidden;
}

.studio-autopilot__session-header :deep(.studio-ai-sessions__tabs) {
  min-width: 0;
  overflow: hidden;
}

.studio-autopilot__header-actions,
.studio-autopilot__session-tool-header {
  align-items: center;
  display: flex;
  gap: 0.4rem;
}

.studio-autopilot__header-actions {
  flex: 0 0 auto;
  margin-inline-start: auto;
}

.studio-autopilot__header-actions--compact {
  display: none;
}

@container studio-chat-pane (min-width: 32.01rem) and (max-width: 40rem) {
  .studio-autopilot__session-header {
    --session-action-size: 44px;
  }
  .studio-autopilot__header-actions {
    gap: 0;
  }
  .studio-autopilot__header-actions :deep(.v-icon),
  .studio-autopilot__save-work :deep(.v-btn__content > .v-icon) {
    font-size: 20px;
    height: 20px;
    width: 20px;
  }
  .studio-autopilot__save-symbol {
    transform: scale(0.85);
  }
}

@container studio-chat-pane (max-width: 32rem) {
  .studio-autopilot__header-actions--compact {
    display: flex;
  }

  .studio-autopilot__header-actions--expanded {
    display: none;
  }
}

.studio-autopilot__session-action-item {
  min-height: 3rem;
}

.studio-autopilot__conversation {
  grid-row: 3;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__activity {
  display: grid;
  gap: 0.3rem;
  grid-auto-rows: max-content;
  grid-row: 2;
  max-height: min(24dvh, 12rem);
  min-width: 0;
  overflow: auto;
  padding: 0.35rem 0.5rem;
}

.studio-autopilot__activity:empty {
  display: none;
  padding: 0;
}

.studio-autopilot__connection-recovery {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
}

.studio-autopilot__connection-recovery > span {
  flex: 1 1 100%;
  min-width: 0;
}

.studio-autopilot__connection-recovery > .v-btn {
  flex: 0 0 auto;
}

.studio-autopilot__composer {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.1);
  box-sizing: border-box;
  flex: 0 0 auto;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 4px;
  width: 100%;
}

.studio-autopilot__composer-actions,
.studio-autopilot__composer-delivery {
  align-items: center;
  display: flex;
  gap: 0.25rem;
  min-width: 0;
}

.studio-autopilot__composer-actions {
  column-gap: clamp(0rem, calc(4% - 1.25rem), 0.5rem);
  width: 100%;
}

.studio-autopilot__composer-delivery {
  margin-inline-start: auto;
  flex-shrink: 0;
}

.studio-autopilot__settings-access {
  grid-column: 1 / -1;
}

.studio-autopilot__composer-action {
  flex-shrink: 0;
}

.studio-autopilot__assistant-button {
  position: relative;
  display: flex;
  align-items: center;
}

.studio-autopilot__assistant-button-label {
  position: absolute;
  z-index: 1;
  top: 100%;
  left: 50%;
  transform: translateX(max(-50%, -2.5rem));
  padding: 0 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 3px;
  background: rgb(var(--v-theme-surface-light));
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 11px;
  text-transform: none;
}

.studio-autopilot__composer-tools {
  display: flex;
  flex-shrink: 0;
}

.studio-autopilot__composer-tools:empty {
  display: none;
}

@container studio-chat-pane (max-width: 32rem) {
  .studio-autopilot__composer-actions,
  .studio-autopilot__composer-delivery {
    gap: 0;
  }

  .studio-autopilot__composer-actions .studio-autopilot__composer-action {
    width: clamp(2rem, 10cqi, 2.5rem);
  }

  .studio-autopilot__composer-actions :deep(button) {
    flex-shrink: 1;
    min-width: min-content;
    padding-inline: 0.25rem;
  }
}

.studio-autopilot__composer-menu {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-width: calc(100vw - 24px);
}

.studio-autopilot__save-work {
  flex: 0 0 auto;
}

.studio-autopilot__save-work--check {
  opacity: var(--v-disabled-opacity);
}

.studio-autopilot__save-symbol {
  position: relative;
  width: 34px;
  height: 32px;
}

.studio-autopilot__save-symbol-disk,
.studio-autopilot__save-symbol-commit {
  position: absolute;
  opacity: 0.72;
}

.studio-autopilot__save-symbol-disk { left: 0; bottom: 0; }
.studio-autopilot__save-symbol-commit { right: 0; top: 0; }

.studio-autopilot__project-panel,
.studio-autopilot__dashboard-shell,
.studio-autopilot__right-pane-page,
.studio-autopilot__session-tool-pane,
.studio-autopilot__session-tool-content {
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__project-panel {
  contain: strict;
  overflow: hidden;
  position: relative;
}

.studio-autopilot__right-pane-page {
  overflow: auto;
}

.studio-autopilot__session-tool-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.studio-autopilot__session-tool-header {
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  min-height: 2.7rem;
  padding: 0.42rem 0.7rem;
}

.studio-autopilot__session-tool-content {
  overflow: hidden;
}

.studio-autopilot__preview-launch {
  height: 100%;
}

@media (min-width: 981px) {
  .studio-autopilot {
    gap: var(--studio-home-project-gap, 0.75rem);
    grid-template-columns:
      var(--studio-home-chat-column-width, 32rem)
      minmax(0, 1fr);
  }

  .studio-autopilot--chat-collapsed {
    gap: 0;
    grid-template-columns: 0 minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .studio-autopilot:not(.studio-autopilot--chat-collapsed) {
    grid-template-columns: minmax(0, 1fr) 0;
  }

  .studio-autopilot:not(.studio-autopilot--chat-collapsed) .studio-autopilot__project-panel {
    visibility: hidden;
  }
}

@media (pointer: coarse) {
  .studio-autopilot__composer-actions .studio-autopilot__composer-action {
    min-height: 3rem;
    min-width: 3rem;
  }
}
.studio-autopilot__voice-feedback { flex: 1 1 100%; min-width: 0; }
</style>
