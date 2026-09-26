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
              height="48"
              icon
              :title="saveWorkHeaderHint"
              type="button"
              variant="tonal"
              width="48"
              @click="requestSessionSaveWork"
            >
              <v-icon v-if="saveWorkRequiresUpdate" :icon="mdiSourcePull" />
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
                :disabled="rewindDisabled" :prepend-icon="mdiUndo" title="Undo last turn"
                :subtitle="rewindHint" min-height="48" @click="openConversationRewind"
              />
              <v-list-item
                v-if="githubProject && !sessionPullRequest?.number" min-height="48"
                :prepend-icon="mdiSourcePull" title="Create pull request" subtitle="Publish this session on a new branch"
                :disabled="sourceOperationsSuspended" @click="createPullRequestOpen = true"
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
            aria-label="Undo last turn" :title="rewindHint" :disabled="rewindDisabled"
            :icon="mdiUndo" size="48" variant="text" @click="openConversationRewind"
          />
          <v-btn
            v-if="githubProject && !sessionPullRequest?.number" :icon="mdiSourcePull" size="48" variant="text"
            aria-label="Create pull request" title="Create pull request" :disabled="sourceOperationsSuspended"
            @click="createPullRequestOpen = true"
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
              height="48"
              :icon="mdiAutorenew"
              :title="sessionRenewalActionPresentation.reason"
              type="button"
              variant="text"
              width="48"
              @click="requestSessionRenewal($event.currentTarget)"
            />
          </v-badge>
          <v-badge color="primary" dot :model-value="temporaryAiHasUnreadMessages" offset-x="5" offset-y="5">
            <v-btn
              :aria-label="temporaryAiHasUnreadMessages ? 'Open temporary AI: unread messages' : 'Open temporary AI'"
              :disabled="!sessionId || props.sessionSelectionArchived"
              height="48"
              :icon="mdiIncognito"
              :title="temporaryAiHasUnreadMessages ? 'New messages in Temporary AI' : 'Open a temporary AI conversation'"
              type="button"
              variant="text"
              width="48"
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
          <template v-if="saveWorkError && saveWorkCanResolveWithTemporaryAi" #error-actions>
            <Vibe64TemporaryAiFixAction
              :disabled="repositoryRecoverySending || !assistantJuniorAllowed"
              :pending="repositoryRecoverySending"
              :title="assistantJuniorAllowed ? 'Open temporary AI to resolve this repository problem' : assistantJuniorRestrictionMessage"
              @click="fixRepositoryActionError"
            />
          </template>
        </Vibe64TemporaryActionTerminal>

        <v-sheet
          v-if="savedCommitDeslop"
          border
          class="studio-autopilot__deslop-offer"
          color="surface"
          rounded="lg"
        >
          <div class="studio-autopilot__deslop-copy">
            <strong>Work saved</strong>
            <span>Run a behavior-preserving cleanup of this commit?</span>
          </div>
          <v-btn
            :disabled="savedCommitDeslopSending"
            size="small"
            type="button"
            variant="text"
            @click="dismissSavedCommitDeslop"
          >
            Not now
          </v-btn>
          <v-btn
            :aria-busy="savedCommitDeslopSending ? 'true' : undefined"
            class="studio-autopilot__deslop-action"
            color="primary"
            :disabled="savedCommitDeslopSending || agentActive || composerSending"
            :prepend-icon="mdiBroom"
            size="small"
            type="button"
            variant="flat"
            @click="startSavedCommitDeslop"
          >
            {{ savedCommitDeslopSending ? "Starting…" : "Deslop" }}
          </v-btn>
        </v-sheet>

        <Vibe64TemporaryActionTerminal
          :active="workspaceSetupRunning || workspaceSetupRetrying"
          :dismissed="workspaceSetupDismissed"
          :error="workspaceSetupNeedsAttention ? workspaceSetupDiagnostic : ''"
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
        ref="conversationElement"
        :working="agentStopVisible"
        :integration-action-pending="props.conversationLog?.integrationActionPending"
        :integration-connections="props.conversationLog?.integrationConnections"
        :integration-action-error="props.conversationLog?.integrationActionError"
        :integration-requests-enabled="props.active && !props.sessionSelectionArchived"
        :session-id="sessionId"
        :assistant-label="conversationAssistantLabel"
        class="studio-autopilot__conversation"
        :error="props.conversationLog?.error"
        :follow-latest-key="conversationFollowLatestKey"
        :has-more-before="props.conversationLog?.hasMoreBefore"
        :loading="props.conversationLog?.loading"
        :loading-more="props.conversationLog?.loadingMore"
        :load-more-error="props.conversationLog?.loadMoreError"
        :reloadable="chatReloadAvailable"
        :reloading="chatReloading"
        :scroll-key="conversationScrollKey"
        :source-root="sessionSourceRoot"
        :turns="chatTurns"
        :visible="conversationLogVisible"
        :welcome-message="emptyConversationWelcome"
        @cancel-turn="cancelOptimisticMessage"
        @edit-turn="editOptimisticMessage"
        @load-more="loadMoreChatTurns"
        @open-source-file="openSourceEditorFile"
        @open-integration="openIntegrationRequest"
        @skip-integration="skipIntegrationRequest"
        @resume-integration="resumeIntegrationRequest"
        @connect-integration="connectIntegrationRequest"
        @check-integration="checkIntegrationRequest"
        @cancel-integration="cancelIntegrationRequest"
        @reload="reloadChatPane"
        @resend-turn="resendOptimisticMessage"
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
          />
        </template>
        <template #composer>
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
              @implement="implementWorkingPlan"
              @retry="retryAutomaticReview"
              @skip="props.interruptAgentTurn({ reason: 'skip-review' })"
            />
            <Vibe64AssistantAccessPanel
              :access-error="assistantAccessError"
              :assistant-busy="agentActive"
              :action-is-pending="assistantActionIsPending"
              :can-manage="assistantSuggestionsCanManage"
              :pending-action="assistantPendingAction"
              :recent-suggestions="assistantRecentSuggestions"
              :session-id="sessionId"
              :pending-suggestions="assistantPendingSuggestions"
              :suggestions-error="assistantSuggestionsError"
              @approve="approveAssistantSuggestion"
              @discard="discardAssistantSuggestion"
              @reload="reloadAssistantAccess"
              @withdraw="withdrawAssistantSuggestion"
            />
            <div v-if="assistantCanRequestMessage" class="studio-autopilot__request-intro">
              <strong>Send a request to the owner</strong>
              <span>{{ assistantRestrictionMessage }}</span>
            </div>
            <Vibe64AutopilotPromptTextarea
              ref="composerInput"
              :key="composerKey"
              :saved-attachments="composerAttachments"
              v-model="composerDraft"
              :aria-label="assistantCanRequestMessage ? 'Message for owner approval' : 'Message AI assistant'"
              :attachments-enabled="composerAttachmentsEnabled"
              :described-by="composerSupportStatusVisible ? thinkingStatusId : ''"
              :disabled="composerDisabled"
              density="compact"
              :placeholder="composerPromptHintPlaceholder"
              :placeholder-affects-height="!composerPromptHintPreview"
              :rows="1"
              :session-id="sessionId"
              :submit-enabled="composerCanSubmit"
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
                <div class="studio-autopilot__composer-actions" :class="{ 'studio-autopilot__composer-actions--request': assistantCanRequestMessage }">
                  <Vibe64ChatModeControls
                    v-if="!props.sessionSelectionArchived" :session="props.session" :sessions-api-path="props.sessionsApiPath"
                    :purposes="assistantPurposes" :disabled="sourceOperationsSuspended || composerSending" :active="agentActive" :can-configure="assistantCanConfigureRouting"
                    @saved="reloadAssistantAccess"
                  />
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
                  <div ref="composerToolsTarget" class="studio-autopilot__composer-tools" />
                  <Vibe64StarredFilesMenu :bookmarks="fileBookmarks" @open-file="openSourceEditorFile" />
                  <Vibe64AgentPlanUsage
                    :active="props.active && !props.sessionSelectionArchived"
                    :session="props.session"
                    :sessions-api-path="props.sessionsApiPath"
                  />
                  <v-btn
                    ref="composerSettingsButton"
                    :aria-label="`Chat settings for ${conversationAssistantLabel}${composerAccessHint && !assistantCanRequestMessage ? ': attention required' : ''}`"
                    aria-haspopup="menu" :aria-expanded="composerSettingsOpen"
                    icon size="small" variant="text"
                    class="studio-autopilot__composer-action overflow-visible"
                    @click="composerSettingsOpen = !composerSettingsOpen"
                  >
                    <span class="studio-autopilot__assistant-button">
                      <v-badge :model-value="Boolean(composerAccessHint) && !assistantCanRequestMessage" color="warning" dot floating>
                        <v-icon :icon="mdiCogOutline" size="20" />
                      </v-badge>
                      <span class="studio-autopilot__assistant-button-label">{{ conversationAssistantLabel }}</span>
                    </span>
                  </v-btn>
                  <Vibe64SessionAssistantMenu
                    v-model="composerSettingsOpen"
                    :target="composerSettingsButton?.$el"
                    :access-label="assistantAccessLabel"
                    :access-loading="assistantAccessLoading"
                    :can-configure="assistantCanConfigureRouting"
                    :changes-disabled="composerSending || agentActive"
                    :session="props.session"
                    :sessions-api-path="props.sessionsApiPath"
                  >
                    <template #access>
                      <div
                        v-if="composerAccessHint && !assistantCanRequestMessage"
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
                  </Vibe64SessionAssistantMenu>
                  <div class="studio-autopilot__composer-delivery">
                    <v-btn
                      v-if="agentStopVisible" aria-label="Stop" title="Stop assistant"
                      :disabled="!agentStopEnabled" :aria-busy="interrupting ? 'true' : undefined"
                      :icon="mdiStop" size="small" variant="text" class="studio-autopilot__composer-action"
                      @click="requestAgentInterrupt"
                    />
                    <v-btn
                      ref="composerSendButton" :aria-label="composerSubmitActionAriaLabel"
                      :title="composerSubmitActionTitle" :disabled="!composerCanSubmit || !attachmentState.canSubmit"
                      :aria-busy="composerSending && !composerCanSubmit ? 'true' : undefined" color="primary" size="small" variant="flat"
                      :icon="composerSuggesting ? undefined : (composerSubmitMode === 'send' ? mdiSend : mdiArrowTopRight)"
                      :prepend-icon="composerSuggesting ? mdiAccountArrowRightOutline : undefined"
                      :text="composerSuggesting ? 'Send for approval' : undefined"
                      class="studio-autopilot__composer-action" @click="sendComposerMessage"
                    />
                  </div>
                </div>
              </template>
            </Vibe64AutopilotPromptTextarea>
          </div>
        </template>
      </Vibe64ConversationLog>

      <Vibe64TemporaryAiWorkspace
        ref="temporaryAiWorkspace"
        :active="props.active && !chatCollapsed"
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
        v-if="sourceToolLoading"
        class="studio-autopilot__right-pane-page"
        label="session source"
        loading
      />
      <Vibe64DashboardShell
        v-if="props.projectPane === 'dashboard'"
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
            v-if="rightPaneTabMounted('ai-terminal')"
            name="ai-terminal"
            :active="rightPaneTab === 'ai-terminal'"
          />
        </div>
      </Vibe64DashboardShell>

      <section
        v-if="props.projectPane === 'dashboard' && rightPaneTab === 'changes'"
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
        v-show="props.projectPane === 'dashboard' && rightPaneTab === 'editor'"
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
          v-if="rightPaneTabMounted('editor')"
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
        v-show="props.projectPane === 'dashboard' && rightPaneTab === 'database'"
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
          v-if="rightPaneTabMounted('database')"
          :active="props.active && props.projectPane === 'dashboard' && rightPaneTab === 'database'"
          :assistant-available="assistantCanUsePurpose('junior')"
          :assistant-request-available="assistantCanRequestMessage"
          :assistant-unavailable-message="assistantRestrictionMessage"
          class="studio-autopilot__session-tool-content"
          :project-slug="projectSlug"
          :session-id="sessionId"
          :sessions-api-path="props.sessionsApiPath"
          @request-overview-assistant="assistantCanUsePurpose('junior') ? startTemporaryAiTask($event) : prefillComposer($event.message, { append: true })"
          @request-message="prefillComposer($event, { append: true })"
        />
      </section>

      <section
        v-show="props.projectPane === 'dashboard' && rightPaneTab === 'system'"
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
          v-if="rightPaneTabMounted('system')"
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
        v-show="props.projectPane !== 'dashboard'"
        class="studio-autopilot__right-pane-page"
        role="tabpanel"
      >
        <Vibe64ProjectOnboarding
          :active="props.active && props.projectPane === 'preview'"
          :archived="props.sessionSelectionArchived"
          :busy="sourceOperationsSuspended || agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"
          :can-ask="assistantJuniorAllowed"
          :request-temporary-ai="startTemporaryAiTask"
          :session-id="selectedAssistantSessionId"
        >
          <Vibe64OutputControls
            :ask-codex-to-fix-preview-identity="assistantJuniorAllowed ? askCodexToFixPreviewIdentity : null"
            :attach-preview-file="attachPreviewFile"
            :prepare-preview-file="attachPreviewFileProducer"
            :auto-start-managed-preview="!props.sessionSelectionArchived"
            button-label="Run"
            button-size="small"
            button-variant="tonal"
            :busy="agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"
            class="studio-autopilot__preview-launch"
            embedded-preview
            :preview-displayed="props.projectPane === 'preview'"
            :session="props.session"
            :source-operations-suspended="sourceOperationsSuspended"
            :toolbar-teleport-target="props.projectPane === 'preview' ? props.previewToolbarTeleportTarget : ''"
            :window-displayed="props.active"
            @preview-attachment-state="updatePreviewAttachmentState"
            @test-approval="updateTestApproval"
          />
        </Vibe64ProjectOnboarding>
      </div>
    </section>

    <v-dialog :model-value="Boolean(rewindTarget)" :persistent="rewindCommand.isRunning" max-width="34rem" @update:model-value="!$event && (rewindTarget = null)">
      <v-card title="Undo last turn?">
        <v-card-text>
          Remove your last message and the AI’s replies from the conversation. Project files and databases stay as they are.
          <p class="mt-3 text-body-medium" style="white-space: pre-wrap; overflow-wrap: anywhere">{{ rewindTarget?.text }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="rewindCommand.isRunning" @click="rewindTarget = null">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="rewindDisabled" :aria-busy="rewindCommand.isRunning" @click="confirmConversationRewind">
            {{ rewindCommand.isRunning ? 'Undoing…' : 'Undo last turn' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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
            variant="flat"
            :disabled="saveWorkDisabled || !saveWorkReview"
            @click="cancelSaveWork(); createPullRequestOpen = true"
          >
            Create draft PR
          </v-btn>
          <v-btn
            :aria-busy="saveWorkSending ? 'true' : undefined"
            color="primary"
            min-height="48"
            :disabled="saveWorkDisabled || !saveWorkReview || (props.workState?.publicationRequiresPullRequest && !sessionPullRequest?.number)"
            type="button"
            :variant="githubProject && !sessionPullRequest?.number ? 'outlined' : 'flat'"
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
import { computed, defineAsyncComponent, inject, nextTick, onBeforeUnmount, reactive, ref, useId, watch, watchEffect } from "vue";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import {
  createAssistantTextSubmission,
  LongTextPreviewBlocks
} from "@jskit-ai/assistant-core/client/conversation";
import { VIBE64_ASSISTANT_HOST_KEY } from "@/lib/vibe64AssistantHost.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import { VIBE64_RESOURCE_RECOVERY_KEY } from "@/lib/vibe64ResourceRecovery.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  mdiAccountArrowRightOutline,
  mdiArrowLeft,
  mdiArrowTopRight,
  mdiAutorenew,
  mdiBroom,
  mdiCogOutline,
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
  mdiUndo,
} from "@mdi/js";
import { vibe64SessionPullRequest } from "@/lib/vibe64SessionViewModel.js";
import Vibe64CreatePullRequestDialog from "@/components/studio/vibe64-session/Vibe64CreatePullRequestDialog.vue";
import Vibe64AssistantAccessPanel from "@/components/studio/vibe64-session/Vibe64AssistantAccessPanel.vue";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import Vibe64ProjectOnboarding from "@/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue";
import Vibe64AgentPlanUsage from "@/components/studio/vibe64-session/Vibe64AgentPlanUsage.vue";
import Vibe64RoutingNotice from "./Vibe64RoutingNotice.vue";
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
  useVibe64AssistantAccess
} from "@/composables/useVibe64AssistantAccess.js";
import {
  VIBE64_SESSION_CHANGED_EVENT, VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID, vibe64SessionPath
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
const composerSendButton = ref(null);
const composerSettingsOpen = ref(false);
const composerSettingsButton = ref(null);
const mainChat = ref(null);
const sessionActionsTrigger = ref(null);
const temporaryAiWorkspace = ref(null);
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
  enabled: computed(() => props.active && !props.sessionSelectionArchived && Boolean(selectedAssistantSessionId.value))
});
const assistantCanConfigureRouting = computed(() => modelRoutingResource.data.value?.canConfigure === true);
const {
  accessError: assistantAccessError,
  accessLabel: assistantAccessLabel,
  actionIsPending: assistantActionIsPending,
  approveSuggestion: approveAssistantSuggestion,
  canManage: assistantSuggestionsCanManage,
  canRequestMessage: assistantCanRequestMessage,
  canUseChat: assistantCanUseAiState,
  canRouteChat: assistantCanRouteChat,
  canUseNative: assistantCanUseNative,
  canUsePurpose: assistantCanUsePurpose,
  purposes: assistantPurposes,
  scopeKey: assistantAccessScopeKey,
  discardSuggestion: discardAssistantSuggestion,
  initialAccessLoading: assistantAccessLoading,
  pendingAction: assistantPendingAction,
  pendingSuggestions: assistantPendingSuggestions,
  recentSuggestions: assistantRecentSuggestions,
  reload: reloadAssistantAccess,
  restrictionMessage: assistantRestrictionMessage,
  suggestMessage: suggestAssistantMessage,
  suggestionsError: assistantSuggestionsError,
  withdrawSuggestion: withdrawAssistantSuggestion
} = useVibe64AssistantAccess({
  active: computed(() => props.active && !props.sessionSelectionArchived),
  messageSuggestionsEnabled: computed(() => props.projectContext?.repositoryMode !== "local_source"),
  sessionId: selectedAssistantSessionId,
  sessionsApiPath: computed(() => readRefOrGetterValue(props.sessionsApiPath))
});

async function sendMainChatMessage(input = {}) {
  if (assistantCanRequestMessage.value) {
    return suggestAssistantMessage(input);
  }
  if (assistantCanUseAiState.value) {
    return props.sendAgentMessage(input);
  }
  throw new Error(assistantRestrictionMessage.value);
}

const {
  Vibe64OutputControls,
  assistantDirectAllowed,
  assistantJuniorAllowed,
  agentActive,
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
  chatReloadAvailable,
  chatReloading,
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
  dismissSavedCommitDeslop,
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
  reloadChatPane,
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
  savedCommitDeslop,
  savedCommitDeslopSending,
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
  startSavedCommitDeslop,
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
  workspaceSetupDiagnostic,
  workspaceSetupDismissed,
  workspaceSetupFixSending,
  workspaceSetupNeedsAttention,
  workspaceSetupOutput,
  workspaceSetupRetryDisabled,
  workspaceSetupRetrying,
  workspaceSetupRunning,
  workspaceSetupStatus,
  workspaceSetupTitle
} = useVibe64AutopilotView(props, emit, {
  assistantAccessLoading,
  assistantCanRequestMessage,
  assistantCanUseAi: assistantCanUseAiState,
  assistantCanRouteChat,
  assistantCanUseJunior: computed(() => assistantCanUsePurpose("junior")),
  assistantCanUseNative,
  assistantProgressLabel: openCodeProgressLabel,
  onAttachmentsAccepted: (attachmentIds) => composerInput.value?.clearAttachments?.({ attachmentIds }),
  requestTemporaryAi: startTemporaryAiTask,
  sendMainChatMessage
});
const fileBookmarks = useVibe64StarredFiles({
  projectSlug,
  sessionId,
  sessionsApiPath: () => props.sessionsApiPath
});
const composerSuggesting = computed(() => assistantCanRequestMessage.value && [
  "retry",
  "send",
  "sending",
  "steer",
  "steering"
].includes(composerSubmitMode.value));
const composerSubmitActionAriaLabel = computed(() => (
  composerSuggesting.value ? "Send for approval" : composerSubmitAriaLabel.value
));
const composerSubmitActionTitle = computed(() => (
  composerSuggesting.value ? assistantRestrictionMessage.value : composerSubmitTitle.value
));
const composerAccessHint = computed(() => (
  assistantCanRequestMessage.value ? assistantRestrictionMessage.value : composerHint.value
));

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
const composerAssistantLabel = computed(() => (
  (testApproval.value?.state === "waiting" ? "Waiting for memory approval" : "") ||
  (thinkingVisible.value ? thinkingLabel.value : typingLabel.value)
));
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
async function implementWorkingPlan(planRevision) {
  if (routingReviewRetrying.value || agentActive.value) return;
  routingReviewRetrying.value = true;
  try {
    await props.sendAgentMessage({ messageId: crypto.randomUUID(), submissionKind: "send", planRevision,
      message: "Implement the plan I have approved." });
  } finally { routingReviewRetrying.value = false; }
}
const conversationAssistantLabel = computed(() => (
  `${props.session?.assistantSelection?.engineId === "opencode" ? "OpenCode" :
    props.session?.assistantSelection?.engineId === "claude" ? "Claude" : "Codex"} · ${props.session?.assistantSelection?.modelId || ""}`
));
const rewindTarget = ref(null);
const rewindCommand = useCommand({
  access: "never", ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: VIBE64_SURFACE_ID,
  apiSuffix: VIBE64_SESSIONS_API_SUFFIX, placementSource: "vibe64.sessions.conversation-rewind",
  buildCommandOptions: (_model, { context }) => ({ method: "POST", path: context.path }),
  buildRawPayload: (_model, { context }) => vibe64RealtimeOriginPayload({ turnId: context.turnId }),
  onRunSuccess: (response) => {
    if (response?.ok === false) throw vibe64ApiError(response, "The turn could not be undone.");
  },
  fallbackRunError: "The turn could not be undone. Retry Undo last turn to check it.",
  suppressSuccessMessage: true
});
const rewindLastTurn = computed(() => props.conversationLog?.rewind || null);
const rewindDisabled = computed(() => !(rewindTarget.value || rewindLastTurn.value) || !assistantDirectAllowed.value ||
  agentActive.value || composerSending.value || interrupting.value || rewindCommand.isRunning ||
  props.conversationLog?.loading || props.sessionSelectionArchived || sourceOperationsSuspended.value);
const rewindHint = computed(() => agentActive.value ? "Stop the assistant before undoing a turn" :
  !rewindLastTurn.value ? "Undo stops at the last AI switch" : "Undo the last conversation turn; keep project files");
function openConversationRewind() {
  if (rewindDisabled.value) return;
  rewindTarget.value = { sessionId: sessionId.value, turnId: rewindLastTurn.value.turnId, text: rewindLastTurn.value.text };
}
async function confirmConversationRewind() {
  if (rewindDisabled.value || !rewindTarget.value) return;
  const target = rewindTarget.value;
  try {
    const response = await rewindCommand.run({ turnId: target.turnId,
      path: vibe64SessionPath(readRefOrGetterValue(props.sessionsApiPath), target.sessionId, "/conversation-rewind") });
    if (sessionId.value !== target.sessionId) return;
    rewindTarget.value = null;
    if (!composerDraft.value.trim()) prefillComposer(response.text);
    await props.conversationLog?.reload?.();
  } catch {
    // The command owns error feedback; retain this exact target for a retry.
  }
}
watch([sessionId, () => props.session?.assistantSelection?.engineId], () => { rewindTarget.value = null; });
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
  (
    promptHintsBlankConversation.value || (
      (assistantCanUsePurpose("prompt_hint") || assistantCanRequestMessage.value)
    )
  ) &&
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
  sharedOnly: computed(() => !assistantCanUsePurpose("prompt_hint")),
  projectSlug,
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
  composerPromptHintPreview.value || (assistantCanRequestMessage.value
    ? "What would you like the AI to help with?" : composerPlaceholder.value)
));
const composerSupportStatusVisible = computed(() => Boolean(
  composerAssistantLabel.value || promptHintsVisible.value
));

const createPullRequestOpen = ref(false);
const checkpointFailure = computed(() => (props.session?.backgroundTasks || [])
  .find((task) => task.id === "codex_turn_checkpoint" && task.status === "failed")?.error || "");
const sessionPullRequest = computed(() => vibe64SessionPullRequest(props.session));
const githubProject = computed(() => githubProjectAvailable(props.projectContext));
const assistantJuniorRestrictionMessage = computed(() => assistantPurposes.value.junior?.message || "Junior is unavailable. Review model routing.");
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
  if (composerInput.value?.attachmentsCanSubmit?.() === false) {
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
  if (!sessionId.value || props.sessionSelectionArchived) {
    return false;
  }
  temporaryAiWorkspace.value?.showWorkspace?.();
  return true;
}

async function startTemporaryAiTask(options = {}) {
  if (!assistantCanUsePurpose("junior") || props.sessionSelectionArchived) {
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
const composerToolsTarget = ref(null);
const conversationElement = ref(null);
let assistantLayerMounted = true;
const assistantLayerSelected = computed(() => props.active && !props.sessionSelectionArchived && !temporaryAiWorkspace.value?.visible);
const assistantLayer = reactive({
  get sessionId() { return sessionId.value; },
  get turns() { return chatTurns.value; },
  get loading() { return Boolean(props.conversationLog?.loading); },
  get turnActive() { return agentActive.value; },
  get submitting() { return composerSending.value; },
  get toolsTarget() { return composerToolsTarget.value; },
  get conversationTarget() { return conversationElement.value?.$el || null; },
  submitText: createAssistantTextSubmission({
    getState: () => ({
      id: sessionId.value,
      draft: composerDraft.value,
      active: assistantLayerMounted && assistantLayerSelected.value,
      canSend: composerCanSubmit.value,
      turnActive: agentActive.value
    }),
    setDraft: (value) => {
      composerDraft.value = value;
      composerInput.value?.focus?.();
    },
    submit: sendComposerMessage,
    afterDraftChange: nextTick
  })
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
  assistantLayerMounted = false;
  if (assistantHost?.value === assistantLayer) {
    assistantHost.value = null;
  }
});

</script>

<style scoped>
.studio-autopilot__checkpoint-notice summary {
  cursor: pointer;
}
.studio-autopilot__checkpoint-details {
  max-height: 8rem;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.studio-autopilot__request-intro {
  display: grid;
  gap: 0.25rem;
  padding: 0.2rem 0.2rem 0.65rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.studio-autopilot__request-intro strong { color: rgb(var(--v-theme-on-surface)); }
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
}

.studio-autopilot__header-actions--compact {
  display: none;
}

@container studio-chat-pane (max-width: 32rem) {
  .studio-autopilot__composer-actions--request {
    flex-wrap: wrap;
    row-gap: 0.4rem;
  }

  .studio-autopilot__composer-actions--request .studio-autopilot__composer-delivery {
    flex-basis: 100%;
    justify-content: flex-end;
  }

  .studio-autopilot__composer-actions--request .studio-autopilot__composer-delivery .studio-autopilot__composer-action {
    width: auto;
    padding-inline: 0.75rem;
  }

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

.studio-autopilot__deslop-offer {
  align-items: center;
  display: grid;
  gap: 0.35rem;
  grid-template-columns: minmax(0, 1fr) auto auto;
  padding: 0.45rem 0.5rem 0.45rem 0.75rem;
}

.studio-autopilot__deslop-copy {
  display: grid;
  font-size: 0.82rem;
  line-height: 1.3;
  min-width: 0;
}

.studio-autopilot__deslop-action {
  min-inline-size: 5.75rem;
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
</style>
