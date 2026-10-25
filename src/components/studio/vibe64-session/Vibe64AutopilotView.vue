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
      <header ref="sessionHeader" class="studio-autopilot__session-header">
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
              data-vibe64-guide="save"
              :color="saveWorkRequiresUpdate ? 'warning' : (saveWorkUnsaved ? 'error' : undefined)"
              :disabled="saveWorkChecking || (saveWorkDisabled && !saveWorkCheckAvailable) || temporaryAiWorkspace?.updateRepairTask?.busy"
              height="var(--session-action-size, 36px)"
              icon
              :title="saveWorkHeaderHint"
              type="button"
              variant="text"
              width="var(--session-action-size, 36px)"
              @click="requestSessionSaveWork"
            >
              <v-icon v-if="saveConnectedFirst" :icon="mdiSourceBranch" />
              <v-icon v-else-if="saveWorkRequiresUpdate" :icon="mdiSourceCommit" />
              <span v-else-if="props.workState?.destination?.mode === 'github'" class="studio-autopilot__save-symbol" aria-hidden="true">
                <v-icon :icon="mdiContentSaveOutline" size="18" class="studio-autopilot__save-symbol-disk" />
                <v-icon :icon="mdiSourceCommit" size="16" class="studio-autopilot__save-symbol-commit" />
              </span>
              <v-icon v-else :icon="mdiContentSaveOutline" />
            </v-btn>
          </template>
          <span role="status">Checking…</span>
        </v-tooltip>
        <v-chip
          v-if="mainChatApprovals.isOwner && mainChatApprovals.waitingCount"
          class="studio-autopilot__approvals-chip studio-autopilot__header-fixed"
          color="secondary"
          variant="tonal"
          size="small"
          :prepend-icon="mdiClockOutline"
          :aria-label="`${mainChatApprovals.waitingCount} ${mainChatApprovals.waitingCount === 1 ? 'message' : 'messages'} waiting for your approval`"
          @click="revealApprovals"
        >
          {{ mainChatApprovals.waitingCount }} waiting
        </v-chip>
        <!-- After Save, actions keep the header in priority order; the lowest move into Session actions first. -->
        <div class="studio-autopilot__header-actions">
          <v-badge
            v-if="headerActions.inline.includes('temporary-ai')"
            color="primary" dot :model-value="temporaryAiHasUnreadMessages" offset-x="4" offset-y="4"
          >
            <v-btn
              :aria-label="temporaryAiHasUnreadMessages ? 'Open temporary AI: unread messages' : 'Open temporary AI'"
              class="studio-autopilot__header-action"
              data-vibe64-temporary-ai-action
              data-vibe64-header-action="temporary-ai"
              :disabled="!sessionId || props.sessionSelectionArchived"
              height="var(--session-action-size, 36px)"
              :icon="mdiIncognito"
              :title="temporaryAiHasUnreadMessages ? 'New messages in Temporary AI' : 'Open a temporary AI conversation'"
              type="button"
              variant="text"
              width="var(--session-action-size, 36px)"
              @click="openTemporaryAi"
            />
          </v-badge>
          <v-badge
            v-if="headerActions.inline.includes('renew')"
            :color="sessionRenewalActionPresentation.color || 'primary'"
            dot
            :model-value="sessionRenewalActionPresentation.attention === true"
            offset-x="4"
            offset-y="4"
          >
            <v-btn
              :aria-label="sessionRenewalActionPresentation.label"
              class="studio-autopilot__header-action"
              data-vibe64-session-renew-action
              data-vibe64-header-action="renew"
              height="var(--session-action-size, 36px)"
              :icon="mdiAutorenew"
              :title="sessionRenewalActionPresentation.reason"
              type="button"
              variant="text"
              width="var(--session-action-size, 36px)"
              @click="requestSessionRenewal($event.currentTarget)"
            />
          </v-badge>
          <Vibe64SessionPin
            v-if="headerActions.inline.includes('pin')"
            data-vibe64-header-action="pin"
            :key="`${readRefOrGetterValue(props.sessionsApiPath)}:${sessionId}`"
            :session="props.session"
            :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
            :refresh="props.refreshSessionData"
          />
          <v-btn
            v-if="headerActions.inline.includes('pull-request')"
            data-vibe64-header-action="pull-request"
            class="studio-autopilot__header-action"
            :icon="mdiSourcePull" height="var(--session-action-size, 36px)" width="var(--session-action-size, 36px)" variant="text"
            :aria-label="sessionPullRequest?.number ? 'View pull request' : 'Create pull request'"
            :title="sessionPullRequest?.number ? `View pull request #${sessionPullRequest.number}` : 'Create pull request'"
            :to="sessionPullRequestTarget" :disabled="!sessionPullRequest?.number && sourceOperationsSuspended"
            @click="!sessionPullRequest?.number && (createPullRequestOpen = true)"
          />
          <v-btn
            v-if="headerActions.inline.includes('prepare-workspace')"
            aria-label="Prepare workspace"
            class="studio-autopilot__header-action"
            data-vibe64-prepare-workspace
            data-vibe64-header-action="prepare-workspace"
            :disabled="workspaceSetupRetryDisabled"
            height="var(--session-action-size, 36px)"
            :icon="mdiWrenchOutline"
            title="Prepare workspace: run all declared setup steps again"
            type="button"
            variant="text"
            width="var(--session-action-size, 36px)"
            @click="retryWorkspaceSetup"
          />
          <v-menu
            v-if="sessionActionsMenuVisible"
            location="bottom end"
          >
            <template #activator="{ props: menuProps }">
              <v-badge
                :color="(sessionRenewalActionPresentation.attention && sessionRenewalActionPresentation.color) || 'primary'"
                dot
                :model-value="sessionActionsAttention"
                offset-x="4"
                offset-y="4"
              >
                <v-btn
                  ref="sessionActionsTrigger"
                  v-bind="menuProps"
                  :aria-label="sessionActionsLabel"
                  class="studio-autopilot__header-action"
                  data-vibe64-session-actions
                  height="var(--session-action-size, 36px)"
                  :icon="mdiDotsVertical"
                  title="Session actions"
                  type="button"
                  variant="text"
                  width="var(--session-action-size, 36px)"
                />
              </v-badge>
            </template>
            <v-list aria-label="Session actions" density="compact" min-width="17rem">
              <v-list-item
                v-if="headerActions.overflow.includes('temporary-ai')"
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
              <v-list-item
                v-if="headerActions.overflow.includes('renew')"
                class="studio-autopilot__session-action-item"
                data-vibe64-session-renew-action
                :prepend-icon="mdiAutorenew"
                :subtitle="sessionRenewalActionPresentation.reason"
                :title="sessionRenewalActionPresentation.label"
                @click="requestSessionRenewal(sessionActionsTrigger)"
              />
              <Vibe64SessionPin
                v-if="headerActions.overflow.includes('pin')"
                :key="`${readRefOrGetterValue(props.sessionsApiPath)}:${sessionId}:menu`"
                list-item
                :session="props.session"
                :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
                :refresh="props.refreshSessionData"
              />
              <v-list-item
                v-if="headerActions.overflow.includes('pull-request')" min-height="48"
                :prepend-icon="mdiSourcePull" :title="sessionPullRequest?.number ? 'View pull request' : 'Create pull request'"
                :subtitle="sessionPullRequest?.number ? `PR #${sessionPullRequest.number}` : 'Propose this work for merging'"
                :to="sessionPullRequestTarget" :disabled="!sessionPullRequest?.number && sourceOperationsSuspended"
                @click="!sessionPullRequest?.number && (createPullRequestOpen = true)"
              />
              <v-list-item
                v-if="headerActions.overflow.includes('prepare-workspace')"
                data-vibe64-prepare-workspace
                min-height="48"
                :disabled="workspaceSetupRetryDisabled"
                :prepend-icon="mdiWrenchOutline"
                subtitle="Run all declared setup steps again"
                title="Prepare workspace"
                @click="retryWorkspaceSetup"
              />
              <v-list-item
                v-if="connectedUpdateActionVisible"
                data-vibe64-update-connected
                min-height="48"
                :disabled="workspaceSetupRetryDisabled"
                :prepend-icon="mdiSourceBranchSync"
                subtitle="Bring connected checkouts up to their branches, then prepare"
                title="Update connected repositories"
                @click="retryWorkspaceSetup"
              />
            </v-list>
          </v-menu>
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
          rounded="lg"
          role="status"
          data-vibe64-connection-recovery
        >
          <div class="studio-autopilot__connection-actions">
            <v-btn
              v-if="assistantAccountUnavailable"
              color="primary"
              variant="flat"
              min-height="32"
              size="small"
              @click="requestVibe64AccountConnectionsDialog({ section: 'ai' })"
            >
              Open AI Accounts
            </v-btn>
            <v-btn
              v-if="!assistantAccountUnavailable || props.sessionSelectionArchived"
              variant="tonal"
              min-height="32"
              size="small"
              :disabled="props.agentConnectionStatus === 'reconciling'"
              @click="props.retryAgentConnection()"
            >
              {{ props.agentConnectionStatus === 'disconnected' ? 'Reconnect' : 'Retry connection' }}
            </v-btn>
            <v-btn
              v-if="props.agentConnectionStatus === 'failed' && props.sessionRenewal?.visible"
              variant="tonal"
              min-height="32"
              size="small"
              @click="requestSessionRenewal($event.currentTarget)"
            >
              Renew session
            </v-btn>
          </div>
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
        <v-alert v-if="checkpointFailureVisible" class="studio-autopilot__checkpoint-notice" type="warning" variant="tonal" density="compact">
          <div class="d-flex flex-wrap align-center ga-2">
            <div class="flex-grow-1">
              <strong class="text-body-medium">Recovery snapshot not saved</strong>
              <p class="text-body-small mb-0">{{ checkpointFailureReason }} Your files remain in this session. You can keep chatting.</p>
            </div>
            <v-btn variant="text" min-height="48" aria-label="Dismiss recovery snapshot warning" @click="dismissCheckpointFailure">Dismiss</v-btn>
          </div>
          <details :key="checkpointFailure">
            <summary class="text-body-small">Technical details</summary>
            <p class="text-body-small mt-2 mb-2">Vibe64 tries again after the next assistant turn finishes. A successful snapshot clears this warning. Dismiss hides this failure only; a new failure will appear again.</p>
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
        <GitStandInIdentityNotice v-if="saveWorkStandInIdentity" @close="saveWorkStandInIdentity = false" />
        <v-alert v-if="saveWorkConnectedResults.length" type="info" variant="tonal" closable @click:close="saveWorkConnectedResults = []">
          <p class="mb-2">Connected contributions pushed. The main project was not pushed.</p>
          <ul>
            <li v-for="result in saveWorkConnectedResults" :key="result.sessionId">
              {{ result.repository }} · <code>{{ result.saveCommit?.slice(0, 12) }}</code>
              <span v-if="result.recorded === false"> — retry Save to record this confirmed commit.</span>
              <span v-else-if="result.reconciled === false"> — open its session to finish reconciliation.</span>
            </li>
          </ul>
          <p class="mt-2 mb-0">Review these contributions in the receiving projects’ Incoming changes.</p>
        </v-alert>
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
            <v-btn
              v-if="updateConflictRecovery" variant="tonal" height="48"
              :disabled="updateWorkDisabled || sourceOperationsSuspended || temporaryAiWorkspace?.updateRepairTask?.busy"
              @click="reviewResolvedUpdate"
            >
              Review resolved conflicts
            </v-btn>
            <Vibe64TemporaryAiFixAction
              v-if="saveWorkCanResolveWithTemporaryAi"
              :disabled="repositoryRecoverySending || !assistantFixAllowed"
              :pending="repositoryRecoverySending"
              :title="assistantFixAllowed ? 'Open temporary AI to resolve this repository problem' : assistantFixRestrictionMessage"
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
        <Vibe64ConnectedReplacement :project-slug="projectSlug" :session-id="sessionId" :failure="saveWorkFailure"
          :disabled="saveWorkSending || saveWorkOperationActive || sourceOperationsSuspended || agentActive"
          @replaced="props.refreshSessionData?.(); props.refreshSessionWork?.()" />

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
              :title="assistantFixAllowed ? 'Open temporary AI to resolve workspace preparation' : assistantFixRestrictionMessage"
              @click="askCodexToFixWorkspaceSetup"
            />
          </template>
        </Vibe64TemporaryActionTerminal>
        <WorkspaceSetupToolRows
          v-if="workspaceSetupStatus === 'failed' && !workspaceSetupDismissed"
          :active="workspaceSetupStatus === 'failed'"
          :runtimes="props.session?.workspaceSetup?.runtimes || []"
          @missing="workspaceSetupToolsMissing = $event > 0"
        />
        <LocalDatabaseServer
          v-if="workspaceSetupStatus === 'failed' && !workspaceSetupDismissed && !workspaceSetupToolsMissing && sessionId"
          :active="workspaceSetupStatus === 'failed'"
          :session-id="sessionId"
          @retry="retryWorkspaceSetup"
        />
      </div>

      <Vibe64ConversationLog
        ref="conversationView"
        :voice-runtime="props.active && !props.sessionSelectionArchived ? props.conversationRuntime : null"
        :working="agentWorking"
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
            data-vibe64-guide="chat"
            @focusout="handleComposerRegionFocusOut"
          >
            <Vibe64MainChatApprovals
              ref="approvalsPanel"
              :approvals="mainChatApprovals"
              :phone="phoneLayout"
              @show-in-chat="showApprovedMessage"
            />
            <Vibe64RoutingNotice
              :request="routingRequest"
              :selection="props.session?.assistantSelection"
              :mode="assistantRoutingFromMetadata(props.session?.metadata)?.mode || ''"
              :active="props.active && conversationLogVisible"
              :pending-action="routingActionSending"
              :action-error="routingActionError"
              :busy="agentActive || composerSending || composerBlocked"
              @retry="sendRoutingAction('continue')"
              @implement="sendRoutingAction('implement')"
              @view-plan="workPlanViewer?.showPlan('current')"
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
                    :goal="readRefOrGetterValue(props.conversationRuntime?.goalState)?.goal" :purposes="assistantPurposes" :disabled="sourceOperationsSuspended" :active="agentActive" :can-configure="assistantCanConfigureRouting"
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
                    :changes-disabled="sourceOperationsSuspended"
                    :session="props.session"
                    :sessions-api-path="props.sessionsApiPath"
                    @saved="props.refreshSessionData?.(); reloadAssistantAccess()"
                  />
                  <v-btn
                    v-if="approvalMode" ref="composerSendButton"
                    class="studio-autopilot__approval-send"
                    color="primary" variant="flat" size="small"
                    :aria-label="composerSubmitAriaLabel" :title="composerSubmitTitle"
                    :disabled="!composerCanSubmit || composerBlocked"
                    :loading="composerSubmitMode === 'approval-sending'"
                    :append-icon="mdiSend"
                    @click="sendComposerMessage"
                  >
                    Send for approval
                  </v-btn>
                  <Vibe64ComposerDelivery v-else ref="composerSendButton"
                    :stop-visible="agentStopVisible" :stop-enabled="agentStopEnabled" :stopping="interrupting"
                    :can-submit="composerCanSubmit && !composerBlocked && attachmentState.canSubmit"
                    :sending="composerSending" :submit-mode="composerSubmitMode"
                    :submit-aria-label="composerSubmitAriaLabel" :submit-title="composerSubmitTitle"
                    @stop="requestAgentInterrupt" @submit="sendComposerMessage" />
                </div>
                <div :ref="setVoiceFeedbackTarget" class="studio-autopilot__voice-feedback" />
              </template>
            </Vibe64AutopilotPromptTextarea>
          </div>
        </template>
      </Vibe64ConversationLog>

      <Vibe64TemporaryAiWorkspace
        ref="temporaryAiWorkspace"
        :active="props.active && !chatCollapsed"
        :session-selected="props.active"
        :assistant-selection="props.session?.assistantSelection"
        :assistant-ready="Boolean(sessionId) && !props.sessionSelectionArchived"
        :connection-unavailable="connectionRecoveryVisible"
        :can-configure-routing="assistantCanConfigureRouting"
        :preview-attachment-state="previewAttachmentState"
        :project-slug="projectSlug"
        :session-id="sessionId"
        :main-has-messages="chatTurns.length > 0"
        :sessions-api-path="props.sessionsApiPath"
        :repository-busy="saveWorkOperationActive || saveWorkSending"
        :update-disabled="updateWorkDisabled"
        :update-disabled-reason="saveWorkTitle"
        :can-review-update="Boolean(updateConflictRecovery)"
        :workspace-setup-status="workspaceSetupStatus"
        :open-file="openWorkingFile"
        :send-lesson-message="sendLessonMessage"
        @check-update="checkTemporaryAiUpdate"
        @review-update="reviewResolvedUpdate"
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
          :data-vibe64-guide-pane="vibe64SessionToolGuideId(rightPaneTab)"
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
        :data-vibe64-guide-pane="vibe64SessionToolGuideId('changes')"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
        role="tabpanel"
      >
        <header class="studio-autopilot__session-tool-header">
          <Vibe64DashboardBackButton data-vibe64-guide-pane="dashboard" @click="backToDashboard" />
        </header>
        <div class="studio-autopilot__right-pane-page">
          <slot name="dashboard" :dashboard-context="dashboardContext" />
        </div>
      </section>

      <section
        v-show="props.projectPane === 'dashboard' && rightPaneTab === 'editor'"
        :data-vibe64-guide-pane="vibe64SessionToolGuideId('editor')"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
        role="tabpanel"
      >
        <header class="studio-autopilot__session-tool-header">
          <Vibe64DashboardBackButton data-vibe64-guide-pane="dashboard" @click="systemBackAvailable ? backToSystemFromEditor() : backToDashboard()">
            {{ systemBackAvailable ? "Back to Architecture" : "Back to dashboard" }}
          </Vibe64DashboardBackButton>
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
          @open-program="architectureProgramRequest = { id: $event }; selectSessionTool('system')"
        />
      </section>

      <section
        v-show="props.projectPane === 'dashboard' && rightPaneTab === 'database'"
        :data-vibe64-guide-pane="vibe64SessionToolGuideId('database')"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
        role="tabpanel"
      >
        <header class="studio-autopilot__session-tool-header">
          <Vibe64DashboardBackButton data-vibe64-guide-pane="dashboard" @click="systemBackAvailable ? backToSystemFromEditor() : backToDashboard()">
            {{ systemBackAvailable ? "Back to Architecture" : "Back to dashboard" }}
          </Vibe64DashboardBackButton>
        </header>
        <Vibe64DatabaseWorkspace
          :key="assistantAccessScopeKey"
          :open-request="databaseOpenRequest"
          v-if="rightPaneTabMounted('database')"
          :active="props.active && props.projectPane === 'dashboard' && rightPaneTab === 'database'"
          :assistant-available="assistantCanUsePurpose('fix')"
          class="studio-autopilot__session-tool-content"
          :project-slug="projectSlug"
          :session-id="sessionId"
          @request-overview-assistant="assistantCanUsePurpose('fix') ? startTemporaryAiTask($event) : prefillComposer($event.message, { append: true })"
        />
      </section>

      <section
        v-show="props.projectPane === 'dashboard' && rightPaneTab === 'system'"
        :data-vibe64-guide-pane="vibe64SessionToolGuideId('system')"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane studio-autopilot__architecture-pane"
        role="tabpanel"
      >
        <Vibe64ArchitectureView
          :assistant-available="assistantFixAllowed && !repositoryOperationActive && !props.sessionSelectionArchived"
          v-if="rightPaneTabMounted('system')"
          :active="props.active && props.projectPane === 'dashboard' && rightPaneTab === 'system'"
          class="studio-autopilot__session-tool-content"
          :resolve-request-url="resolveStudioRequestUrl"
          :restore-request="systemRestoreRequest"
          :open-program-request="architectureProgramRequest"
          :reload-version="systemReloadVersion"
          :project-slug="projectSlug"
          @open-table="openSubsystemTable"
          @describe-subsystems="describeSubsystems"
          :session-id="sessionId"
          @inspect-file="architectureFileRequest = { ...$event, presentation: 'interface' }"
          @open-source-file-immersive="openSourceEditorFile"
          @open-source-file="openSourceEditorFile"
        >
          <template #navigation>
            <Vibe64DashboardBackButton data-vibe64-guide-pane="dashboard" @click="backToDashboard" />
          </template>
          <template #text="{ text, sourcePath, openSource }"><LongTextPreviewBlocks :blocks="parseLongTextReviewBlocks(text || '')" @open-link="openSubsystemTextLink($event, sourcePath, openSource)" /></template>
          <template #file-interface="{ request, active, architecture, openFile, updateLocation, openProgram }">
            <Vibe64SessionSourceEditor single-file :active="props.active && active" :agent-active="agentActive"
              :architecture-facts="architecture"
              :file-bookmarks="fileBookmarks"
              :ask-codex-available="sourceEditorAskCodexAvailable"
              @ask-codex-about-file="askCodexAboutSourceEditorFile"
              @open-program="openProgram"
              :open-request="request" :project-slug="projectSlug" :session-id="sessionId"
              :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
              @open-source-file="openFile"
              @interface-location="updateLocation"
              :assistant-available="assistantCanUsePurpose('source_explanation')"
              :assistant-unavailable-message="assistantPurposes.source_explanation?.message || 'Source explanations are unavailable.'" />
          </template>
        </Vibe64ArchitectureView>
        <v-dialog :model-value="Boolean(architectureFileRequest)" max-width="1100" @update:model-value="!$event && (architectureFileRequest = null)">
          <section class="studio-autopilot__architecture-file" aria-label="Architecture file viewer">
            <header><strong>{{ architectureFileRequest?.path }}</strong><v-btn variant="text" aria-label="Close file viewer" @click="architectureFileRequest = null">Close</v-btn></header>
            <Vibe64SessionSourceEditor v-if="architectureFileRequest" single-file
              :key="architectureFileRequest.path" :active="props.active" :agent-active="agentActive"
              :open-request="architectureFileRequest" :project-slug="projectSlug" :session-id="sessionId"
              :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
              @open-source-file="openSourceEditorFile"
              :assistant-available="assistantCanUsePurpose('source_explanation')"
              :assistant-unavailable-message="assistantPurposes.source_explanation?.message || 'Source explanations are unavailable.'" />
          </section>
        </v-dialog>
      </section>

      <!-- Learn mode's lesson, its toggle on: a sheet over Preview or Dash, which stay mounted (and running) under it. -->
      <Vibe64LessonSheet v-if="lessonShown && props.active" />
      <div
        v-show="props.projectPane === 'preview'"
        class="studio-autopilot__right-pane-page"
        data-vibe64-guide-pane="preview"
        role="tabpanel"
      >
        <Vibe64ProjectOnboarding
          :active="props.active && props.projectPane === 'preview'"
          :archived="props.sessionSelectionArchived"
          :busy="sourceOperationsSuspended || agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"
          :can-ask="assistantFixAllowed"
          :request-temporary-ai="startTemporaryAiTask"
          :session-id="selectedAssistantSessionId"
        >
          <Vibe64OutputControls
            :ask-codex-to-fix-preview-identity="assistantFixAllowed ? askCodexToFixPreviewIdentity : null"
            :attach-preview-file="attachPreviewFile"
            :prepare-preview-file="attachPreviewFileProducer"
            :auto-start-managed-preview="!props.sessionSelectionArchived"
            button-label="Run"
            button-size="small"
            button-variant="tonal"
            :busy="agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"
            :preview-goal-state="props.conversationRuntime?.goalState"
            class="studio-autopilot__preview-launch"
            embedded-preview
            :preview-displayed="props.projectPane === 'preview' && !lessonShown"
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

    <v-dialog
      :model-value="Boolean(resolvedUpdateReview)" max-width="36rem"
      aria-label="Apply resolved Update" scrollable
      @update:model-value="!$event && (resolvedUpdateReview = null)"
    >
      <v-card v-if="resolvedUpdateReview">
        <v-card-title class="text-wrap">Apply resolved Update</v-card-title>
        <v-card-text>
          <p>Confirm that these files preserve the intended changes from both this session and the latest saved version.</p>
          <ul class="my-3 pl-5" style="overflow-wrap: anywhere">
            <li v-for="file in resolvedUpdateReview.conflictPaths" :key="file">{{ file }}</li>
          </ul>
          <p>Repairs may be made manually or in any coding chat. Vibe64 will check the repository state and apply Update. Nothing is pushed.</p>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn @click="resolvedUpdateReview = null">Cancel</v-btn>
          <v-btn
            color="primary" variant="flat" height="auto" min-height="48" style="max-width: 100%"
            :disabled="updateWorkDisabled || sourceOperationsSuspended || temporaryAiWorkspace?.updateRepairTask?.busy"
            @click="applyResolvedUpdate(temporaryAiWorkspace?.updateRepairTask, reportTemporaryRecovery)"
          >
            <span class="text-wrap">I've resolved these conflicts — apply Update</span>
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      :model-value="Boolean(contextFullFailure)" max-width="30rem" aria-label="Not enough room"
      @update:model-value="!$event && (contextFullFailure = null)"
    >
      <v-card v-if="contextFullFailure" rounded="xl">
        <v-card-title class="text-wrap">Not enough room</v-card-title>
        <v-card-text>
          <p>{{ contextFullFailure.message }}</p>
          <p class="text-body-small mt-3 mb-0">Your message was not sent and nothing was lost. Try again to summarise the assistant's memory and send it, or choose another assistant.</p>
        </v-card-text>
        <v-card-actions class="flex-wrap ga-2 px-6 pb-5">
          <v-spacer />
          <v-btn height="48" variant="text" @click="contextFullFailure = null">Close</v-btn>
          <v-btn color="primary" variant="flat" height="48" @click="retryContextFull">Summarise and continue</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="saveWorkConfirmOpen" max-width="30rem" :aria-label="saveWorkConnectedReview ? 'Save connected first' : 'Save changes'" scrollable>
      <v-card rounded="xl">
        <v-card-title>{{ saveWorkConnectedReview ? 'Save connected first' : 'Save changes' }}</v-card-title>
        <v-card-text>
          <template v-if="saveWorkConnectedReview">
            <p>Commit and push changed connected sources to these contribution branches, one repository at a time.</p>
            <v-sheet v-for="item in saveWorkConnectedReview" :key="item.destination.sessionId"
              color="surface-light" rounded="lg" class="pa-3 mb-2" style="overflow-wrap: anywhere">
              <strong>{{ item.destination.repository }}:{{ item.destination.branch }}</strong>
            </v-sheet>
            <p>The main project’s changes stay local. Each receiving project can merge or discard its contribution in Incoming changes.</p>
          </template>
          <div v-if="!saveWorkConnectedReview" class="d-flex align-center justify-space-between ga-2 mb-2">
            <span>{{ props.workState?.changedPaths?.length || 0 }} changed {{ props.workState?.changedPaths?.length === 1 ? 'file' : 'files' }}</span>
            <v-btn height="48" variant="text" @click="cancelSaveWork(); selectSessionTool('changes')">View diff</v-btn>
          </div>
          <v-sheet v-if="saveWorkReview && !saveWorkConnectedReview" color="surface-light" rounded="lg" class="pa-3" style="overflow-wrap: anywhere">
            <div class="text-label-small text-medium-emphasis">{{ saveWorkReview.mode === 'github' ? 'GitHub' : saveWorkReview.mode === 'local_source' ? 'Local project' : 'Project version' }}</div>
            <strong>{{ saveWorkReview.repository }}:{{ saveWorkReview.branch }}</strong>
            <p v-if="sessionPullRequest" class="text-body-small mt-1 mb-0">PR #{{ sessionPullRequest.number }} · {{ sessionPullRequest.headBranch }} → {{ sessionPullRequest.baseBranch }}</p>
          </v-sheet>
          <p v-else-if="!saveWorkReview" role="status">Refresh repository status to review the destination.</p>
          <p class="text-body-small mt-3 mb-0">Save open file edits first.</p>
          <p v-if="saveWorkNeedsPullRequest" role="status" class="text-body-small mt-2">A pull request is required.</p>
          <p v-if="saveWorkDisabled" role="status" class="mt-3">{{ saveWorkTitle }}</p>
        </v-card-text>
        <v-card-actions class="flex-wrap ga-2 px-6 pb-5">
          <v-spacer />
          <v-btn :disabled="saveWorkSending" height="48" type="button" variant="text" @click="cancelSaveWork">
            Cancel
          </v-btn>
          <v-btn
            v-if="!saveWorkConnectedReview && githubProject && !sessionPullRequest?.number"
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
import Vibe64DashboardBackButton from "../Vibe64DashboardBackButton.vue";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { computed, defineAsyncComponent, inject, nextTick, onBeforeUnmount, reactive, ref, useId, watch, watchEffect } from "vue";
import {
  LongTextPreviewBlocks
} from "@jskit-ai/assistant-core/client/conversation";
import { VIBE64_ASSISTANT_HOST_KEY } from "@/lib/vibe64AssistantHost.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import { VIBE64_RESOURCE_RECOVERY_KEY } from "@/lib/vibe64ResourceRecovery.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  mdiAutorenew,
  mdiCircle,
  mdiConsoleNetworkOutline,
  mdiContentSaveOutline,
  mdiSourceCommit,
  mdiSourceBranch,
  mdiDotsVertical,
  mdiEyePlusOutline,
  mdiGithub,
  mdiIncognito,
  mdiPaperclip,
  mdiPlus,
  mdiSourcePull,
  mdiSourceBranchSync,
  mdiWrenchOutline,
  mdiClockOutline,
  mdiSend,
} from "@mdi/js";
import { vibe64SessionPullRequest } from "@/lib/vibe64SessionViewModel.js";
import { splitVibe64SessionHeaderActions, vibe64SessionNameStripWidth } from "@/lib/vibe64SessionToolbarVisibility.js";
import Vibe64CreatePullRequestDialog from "@/components/studio/vibe64-session/Vibe64CreatePullRequestDialog.vue";
import GitStandInIdentityNotice from "@/components/studio/repository/GitStandInIdentityNotice.vue";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import Vibe64ProjectOnboarding from "@/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue";
import Vibe64AgentPlanUsage from "@/components/studio/vibe64-session/Vibe64AgentPlanUsage.vue";
import Vibe64SessionPin from "./Vibe64SessionPin.vue";
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
import WorkspaceSetupToolRows from "@/components/studio/vibe64-session/WorkspaceSetupToolRows.vue";
import Vibe64TemporaryActionTerminal from "@/components/studio/Vibe64TemporaryActionTerminal.vue";
import Vibe64TemporaryAiFixAction from "@/components/studio/Vibe64TemporaryAiFixAction.vue";
import Vibe64ConnectedReplacement from "@/components/studio/vibe64-session/Vibe64ConnectedReplacement.vue";
import Vibe64SessionSourceEditor from "@/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue";
import Vibe64SessionFiles from "@/components/studio/vibe64-session/Vibe64SessionFiles.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64ComposerDelivery from "./Vibe64ComposerDelivery.vue";
import Vibe64MainChatApprovals from "./Vibe64MainChatApprovals.vue";
import { useVibe64MainChatApprovals } from "@/composables/useVibe64MainChatApprovals.js";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { useDisplay } from "vuetify";
import Vibe64TemporaryAiWorkspace from "@/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import Vibe64LessonSheet from "@/components/learning/Vibe64LessonSheet.vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { vibe64SessionToolGuideId } from "@/lib/vibe64SessionToolDefinitions.js";
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
const learning = useVibe64Learning();
const lessonShown = computed(() => Boolean(learning?.lessonShown));
const resourceRecoveryControl = inject(VIBE64_RESOURCE_RECOVERY_KEY, null);
const architectureFileRequest = ref(null);
const architectureProgramRequest = ref(null);
watch(() => props.session?.sessionId, () => { architectureFileRequest.value = null; architectureProgramRequest.value = null; });
const resourceRetryBusy = ref(false);
// A missing Stack tool is fixed first; the database panel waits for it.
const workspaceSetupToolsMissing = ref(false);
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
const Vibe64ArchitectureView = defineAsyncComponent(() => (
  import("@local/vibe64-system-graph/client").then((module) => module.loadVibe64ArchitectureView())
));
const Vibe64DatabaseWorkspace = defineAsyncComponent(() => (
  import("@local/vibe64-database-tools/client").then((module) => module.loadVibe64DatabaseWorkspace())
));
const LocalDatabaseServer = defineAsyncComponent(() => (
  import("@local/vibe64-database-tools/client").then((module) => module.loadLocalDatabaseServer())
));
const composerInput = ref(null);
const conversationView = ref(null);
const composerSendButton = ref(null);
const composerSettingsOpen = ref(false);
const composerSettingsButton = ref(null);
const mainChat = ref(null);
const approvalsPanel = ref(null);
const { xs: phoneLayout } = useDisplay();
const sessionActionsTrigger = ref(null);
const temporaryAiWorkspace = ref(null);
const workPlanViewer = ref(null);
const temporaryAiHasUnreadMessages = computed(() => temporaryAiWorkspace.value?.hasUnreadMessages === true);
// Session names get the header's room first, then Save, then these actions in
// priority order; whatever does not fit moves into Session actions.
const sessionHeader = ref(null);
const headerActionRoom = ref(Infinity);
const SESSION_NAME_MAX_WIDTH = 240; // the compact chip's max-width
function measureHeaderActionRoom() {
  const header = sessionHeader.value;
  if (!header) return;
  const style = getComputedStyle(header);
  const names = vibe64SessionNameStripWidth(header.querySelector(".studio-ai-sessions__tabs")?.children, SESSION_NAME_MAX_WIDTH);
  const fixed = [...header.querySelectorAll(".studio-autopilot__save-work, .studio-autopilot__header-fixed")]
    .reduce((total, element) => total + element.offsetWidth + 2, 0);
  const actionSize = (parseFloat(style.getPropertyValue("--session-action-size")) || 36) + 2;
  const room = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - names - fixed - 8;
  headerActionRoom.value = Math.floor(room / actionSize);
}
watch(sessionHeader, (header, _previous, onCleanup) => {
  if (!header || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => measureHeaderActionRoom());
  observer.observe(header);
  const toolbar = header.querySelector(".studio-ai-sessions__tabs");
  if (toolbar) observer.observe(toolbar);
  onCleanup(() => observer.disconnect());
});
const headerActionsAvailable = computed(() => [
  "temporary-ai",
  props.sessionRenewal?.visible && "renew",
  props.session?.sourceReady && !props.sessionSelectionArchived && "pin",
  githubProject.value && "pull-request",
  workspaceSetupActionVisible.value && "prepare-workspace"
].filter(Boolean));
const headerActions = computed(() => {
  const available = headerActionsAvailable.value;
  const room = headerActionRoom.value;
  // Everything fits without the menu, or one slot goes to Session actions.
  const slots = room >= available.length && !connectedUpdateActionVisible.value ? room : room - 1;
  return splitVibe64SessionHeaderActions(available, slots);
});
const sessionActionsMenuVisible = computed(() => headerActions.value.overflow.length > 0 || connectedUpdateActionVisible.value);
const sessionActionsAttention = computed(() =>
  (headerActions.value.overflow.includes("renew") && sessionRenewalActionPresentation.value.attention === true) ||
  (headerActions.value.overflow.includes("temporary-ai") && temporaryAiHasUnreadMessages.value));
const sessionActionsLabel = computed(() => [
  "Session actions",
  headerActions.value.overflow.includes("renew") && sessionRenewalActionPresentation.value.attention ? sessionRenewalActionPresentation.value.label : "",
  headerActions.value.overflow.includes("temporary-ai") && temporaryAiHasUnreadMessages.value ? "Unread temporary AI messages" : ""
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
// A team member's main-chat restriction is the approval queue, which the composer hint explains.
const assistantRestrictionMessage = computed(() => mainChatApprovals.memberMode ? ""
  : props.conversationRuntime.access.restrictionMessage.value);
const assistantCanUsePurpose = purpose => props.conversationRuntime.access.canUsePurpose(purpose);
const reloadAssistantAccess = () => props.conversationRuntime.access.reload();

// A team member's main-chat messages go to the owner for approval.
const mainChatApprovals = reactive(useVibe64MainChatApprovals({
  active: () => props.active && !props.sessionSelectionArchived,
  projectSlug: useVibe64ProjectSlug(),
  sessionId: selectedAssistantSessionId,
  sessionsApiPath: () => readRefOrGetterValue(props.sessionsApiPath),
  onReview(reviewedSessionId) {
    if (reviewedSessionId && reviewedSessionId !== selectedAssistantSessionId.value) {
      props.sessionToolbar?.selectSession?.(reviewedSessionId);
    }
    void nextTick(revealApprovals);
  }
}));

const {
  Vibe64OutputControls,
  assistantDirectAllowed,
  assistantFixAllowed,
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
  checkpointFailure,
  checkpointFailureReason,
  checkpointFailureVisible,
  dismissCheckpointFailure,
  approvalMode,
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
  updateConflictRecovery,
  resolvedUpdateReview,
  reviewResolvedUpdate,
  applyResolvedUpdate,
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
  contextFullFailure,
  retryContextFull,
  saveWorkReview,
  saveConnectedFirst,
  saveWorkConnectedReview,
  saveWorkConnectedResults,
  saveWorkStandInIdentity,
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
  sendLessonMessage,
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
  agentWorking,
  assistantAccountMessage,
  assistantAccountUnavailable,
  connectionRecoveryVisible,
  updateComposerAttachments,
  updatePreviewAttachmentState,
  workspaceSetupActionVisible,
  connectedUpdateActionVisible,
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
  assistantCanUseFix: computed(() => assistantCanUsePurpose("fix")),
  assistantCanUseNative,
  assistantProgressLabel: openCodeProgressLabel,
  mainChatApprovals,
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
function revealApprovals() {
  if (phoneLayout.value) {
    approvalsPanel.value?.open();
    return;
  }
  mainChat.value?.querySelector(".vibe64-approvals")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function showApprovedMessage(entry) {
  mainChat.value?.querySelector(`.vibe64-conversation-log [data-approval-id="${CSS.escape(entry.id)}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
watch(agentActive, (active) => {
  if (!active) {
    openCodeProgressLabel.value = "";
  }
}, { flush: "sync", immediate: true });
const routingActionSending = ref("");
const routingActionError = ref("");
watch(() => [routingRequest.value?.messageId, routingRequest.value?.stage, routingRequest.value?.status, routingRequest.value?.delivery],
  () => { routingActionError.value = ""; });
async function sendRoutingAction(action) {
  const request = routingRequest.value;
  if (routingActionSending.value || !request) return;
  routingActionSending.value = action;
  routingActionError.value = "";
  try {
    const result = action === "implement"
      ? await props.sendAgentMessage({ message: "Implement the saved plan. I authorize implementation within its agreed scope.",
        planRevision: request.workPlan.revision, submissionKind: "send" })
      : await props.conversationRuntime.continueWorkflow(request);
    if (result === false || result?.ok === false) {
      throw new Error(result?.error || "The workflow action did not start. Check the conversation and try again.");
    }
    return result;
  }
  catch (error) { routingActionError.value = error?.message || "The workflow action did not start."; return false; }
  finally { routingActionSending.value = ""; }
}
const conversationAssistantLabel = computed(() => props.session?.assistantSelection
  ? vibe64AssistantSelectionLabel(props.session.assistantSelection) : "Assistant");
const updateHandledInRepair = computed(() => Boolean(
  (saveWorkActivityIsUpdate.value || saveWorkError.value) && temporaryAiWorkspace.value?.updateRepairVisible
));

const promptHintsBlankConversation = computed(() => chatTurns.value.length < 1);
const promptHintsCanRequest = computed(() => Boolean(
  props.active &&
  props.conversationRuntime?.canSubmit.value &&
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
const sessionPullRequest = computed(() => vibe64SessionPullRequest(props.session));
const sessionPullRequestTarget = computed(() => sessionPullRequest.value?.number ? {
  path: projectAppPath(projectSlug.value, '/dashboard/pull-requests'),
  query: { pr: String(sessionPullRequest.value.number) }
} : undefined);
const githubProject = computed(() => githubProjectAvailable(props.projectContext));
const saveWorkNeedsPullRequest = computed(() => !saveWorkConnectedReview.value && githubProject.value &&
  props.workState?.publicationRequiresPullRequest === true && !sessionPullRequest.value?.number);
const saveWorkCanCreatePullRequest = computed(() => githubProject.value && !sessionPullRequest.value?.number &&
  saveWorkFailure.value?.code === "vibe64_pull_request_required");
const assistantFixRestrictionMessage = computed(() => assistantPurposes.value.fix?.message || "Fix it with AI is unavailable. Review AI setup.");
const publicationLabel = computed(() => {
  if (saveWorkConnectedReview.value) return "Push connected contributions";
  const destination = saveWorkReview.value;
  if (destination?.mode === "github") return "Commit & push";
  return "Save";
});
const dashboardContext = computed(() => ({
  ...(dashboardSessionContext.value || {}),
  assistantDirectAllowed: assistantDirectAllowed.value,
  assistantDraftAvailable: sourceEditorAskCodexAvailable.value,
  assistantFixAllowed: assistantFixAllowed.value,
  assistantFixRestrictionMessage: assistantFixRestrictionMessage.value,
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
  composerSendButton.value?.focus?.() ?? composerSendButton.value?.$el?.focus?.();
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
  if (!assistantCanUsePurpose("fix") || props.sessionSelectionArchived) {
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

function reportTemporaryRecovery(taskId, outcome) {
  if (!temporaryAiWorkspace.value) return false;
  return outcome.status === "checking"
    ? temporaryAiWorkspace.value.persistTaskRecovery?.(taskId, outcome) ?? false
    : temporaryAiWorkspace.value.reportTaskRecovery?.(taskId, outcome) ?? false;
}

watch(() => [props.workState?.updateOperation, temporaryAiWorkspace.value?.updateRepairTask], ([operation, task]) => {
  if (!task || task.sessionId !== sessionId.value || !task.recoveryRequestId ||
      operation?.requestId !== task.recoveryRequestId ||
      !["checking", "unconfirmed"].includes(task.recoveryOutcome)) return;
  if (operation.status === "ready") {
    reportTemporaryRecovery(task.id, { status: "succeeded",
      message: "Session updated. Your changes were preserved. Nothing was pushed." });
  } else if (operation.status === "failed") {
    reportTemporaryRecovery(task.id, { status: "failed",
      message: `Update still needs attention: ${operation.error || "The operation failed."}`,
      recoveryConflictId: operation.conflictRecovery?.reviewId || "" });
  }
}, { flush: "post" });

async function finishTemporaryAiTask(task = {}) {
  const recovery = await handleTemporaryAiTaskFinished(task, reportTemporaryRecovery);
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
  return handleTemporaryAiTaskFinished(task, reportTemporaryRecovery, { force: true });
}

const saveWorkChecking = ref(false);
const saveWorkCheckAvailable = computed(() => Boolean(
  saveWorkDisabled.value && !saveWorkRequiresUpdate.value &&
  !saveWorkSending.value && !repositoryOperationActive.value &&
  !sourceOperationsSuspended.value && !props.sessionSelectionArchived &&
  typeof props.sessionToolbar?.refreshRepositoryState === "function"
));
const saveWorkHeaderHint = computed(() => {
  if (saveConnectedFirst.value) return saveWorkTitle.value;
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
// Session names, Save and the available actions change the header's room.
watch(() => [
  (props.sessionToolbar?.sessions || []).map((session) => session?.sessionName || session?.sessionId).join("\n"),
  headerActionsAvailable.value.join(),
  saveWorkHeaderVisible.value,
  mainChatApprovals.waitingCount
].join("|"), () => nextTick(measureHeaderActionRoom));

const assistantHost = inject(VIBE64_ASSISTANT_HOST_KEY, null);
// A Learning environment "Show me" for one file opens it in this session's
// ordinary Dashboard -> Files editor, as a source link does.
function openWorkingFile(path) {
  if (typeof path !== "string" || !path) return false;
  openSourceEditorFile({ path, presentation: "code" });
  return sourceEditorOpenRequest.value?.path === path;
}
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
  gap: 0.125rem;
  margin-inline-start: auto;
}

/* Light, compact address-bar style: thin icons, no filled discs. */
.studio-autopilot__header-action,
.studio-autopilot__save-work {
  border-radius: 8px;
}

/* Save keeps its unsaved (error) or update (warning) colour. */
.studio-autopilot__header-action,
.studio-autopilot__save-work:not(.text-error):not(.text-warning) {
  color: rgba(var(--v-theme-on-surface), 0.66);
}

.studio-autopilot__header-action :deep(.v-icon),
.studio-autopilot__save-work :deep(.v-btn__content > .v-icon) {
  font-size: 18px;
  height: 18px;
  width: 18px;
}

.studio-autopilot__header-action:hover,
.studio-autopilot__save-work:not(.text-error):not(.text-warning):hover {
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.studio-autopilot__save-work.text-error,
.studio-autopilot__save-work.text-warning {
  background: color-mix(in srgb, currentColor 9%, transparent);
}

.studio-autopilot__header-action :deep(.v-btn__overlay),
.studio-autopilot__save-work :deep(.v-btn__overlay) {
  border-radius: inherit;
}

@media (pointer: coarse) {
  .studio-autopilot__session-header {
    --session-action-size: 44px;
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

/* A database server that isn't connected needs room for its settings and commands. */
.studio-autopilot__activity:has(.db-server--attention) {
  max-height: min(80dvh, 52rem);
}

/* A missing tool's row needs room for its command and Check again. */
.studio-autopilot__activity:has(.setup-tools:not(.setup-tools--quiet)) {
  max-height: min(60dvh, 34rem);
}

/* The stand-in Git name notice shows both commands in full, never cut off. */
.studio-autopilot__activity:has(.git-stand-in) {
  max-height: min(60dvh, 26rem);
}

.studio-autopilot__activity:empty {
  display: none;
  padding: 0;
}

.studio-autopilot__connection-recovery {
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
  color: rgb(var(--v-theme-on-surface));
  align-items: center;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
}

.studio-autopilot__connection-recovery > span {
  overflow-wrap: anywhere;
  min-width: 0;
}

.studio-autopilot__connection-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
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

.studio-autopilot__composer-actions {
  align-items: center;
  display: flex;
  gap: 0.25rem;
  min-width: 0;
}

.studio-autopilot__composer-actions {
  column-gap: clamp(0rem, calc(4% - 1.25rem), 0.5rem);
  width: 100%;
}

.studio-autopilot__approval-send {
  flex-shrink: 0;
  margin-inline-start: auto;
}

@media (pointer: coarse) {
  .studio-autopilot__approval-send { min-height: 3rem; }
}

.studio-autopilot__approvals-chip {
  align-self: center;
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
  .studio-autopilot__composer-actions {
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
  width: 24px;
  height: 22px;
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

.studio-autopilot__architecture-pane {
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.studio-autopilot__session-tool-header {
  background: var(--v64-surface-container-low);
  border-bottom: 1px solid var(--v64-outline-variant);
  min-height: 3rem;
  padding: var(--v64-space-1) var(--v64-space-2);
}

/* Current changes renders a Dashboard page inside the tool pane: give it the page gutter. */
.studio-autopilot__session-tool-pane > .studio-autopilot__right-pane-page {
  padding: var(--v64-space-3) var(--v64-space-4) var(--v64-space-4);
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

<style scoped>
.studio-autopilot__architecture-file { height: min(84dvh, 850px); min-height: 0; display: flex; flex-direction: column; background: rgb(var(--v-theme-surface)); border-radius: 12px; overflow: hidden; }
.studio-autopilot__architecture-file > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .12); }
.studio-autopilot__architecture-file > header strong { overflow-wrap: anywhere; font-size: 14px; }
.studio-autopilot__architecture-file > .vibe64-source-editor { flex: 1; min-height: 0; }
</style>
