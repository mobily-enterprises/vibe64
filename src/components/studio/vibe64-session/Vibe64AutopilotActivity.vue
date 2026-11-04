<template>
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
          Go to AI Accounts
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
      :retryable="saveWorkRetryable && !aiTaskOpen"
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
          v-if="updateConflictRecovery && !aiTaskOpen" variant="tonal" height="48"
          :disabled="updateWorkDisabled || sourceOperationsSuspended || temporaryAiWorkspace?.updateRepairTask?.busy"
          @click="reviewResolvedUpdate"
        >
          Review resolved conflicts
        </v-btn>
        <Vibe64AiTaskButton
          v-if="saveWorkCanResolveWithTemporaryAi && saveWorkActivityIsUpdate"
          :allowed="assistantFixAllowed"
          kind="update"
          :title="assistantFixAllowed ? 'Fix this Update with the AI' : assistantFixRestrictionMessage"
        />
        <Vibe64TemporaryAiFixAction
          v-else-if="saveWorkCanResolveWithTemporaryAi"
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
    <Vibe64ConnectedReplacement
      :project-slug="projectSlug" :session-id="sessionId" :failure="saveWorkFailure"
      :disabled="saveWorkSending || saveWorkOperationActive || sourceOperationsSuspended || agentActive"
      @replaced="props.refreshSessionData?.(); props.refreshSessionWork?.()"
    />

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
          v-else-if="!workspaceSetupConnectedChoice"
          :disabled="workspaceSetupAskDisabled"
          :pending="workspaceSetupFixSending"
          :title="assistantFixAllowed ? 'Open temporary AI to resolve workspace preparation' : assistantFixRestrictionMessage"
          @click="fixWorkspaceSetupWithTemporaryAi"
        />
      </template>
    </Vibe64TemporaryActionTerminal>
    <Vibe64ConnectedSessionPicker
      v-if="workspaceSetupConnectedChoice && !workspaceSetupDismissed"
      :project-slug="projectSlug" :session-id="sessionId" :revision="props.session.workspaceSetup.updatedAt"
      :disabled="workspaceSetupRetryDisabled"
    />
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
</template>

<script setup>
import { computed, defineAsyncComponent, inject, ref } from "vue";
import { Vibe64AiTaskButton, VIBE64_AI_TASKS_KEY } from "@local/vibe64-ai-tasks/client";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import GitStandInIdentityNotice from "@/components/studio/repository/GitStandInIdentityNotice.vue";
import WorkspaceSetupToolRows from "@/components/studio/vibe64-session/WorkspaceSetupToolRows.vue";
import Vibe64TemporaryActionTerminal from "@/components/studio/Vibe64TemporaryActionTerminal.vue";
import Vibe64TemporaryAiFixAction from "@/components/studio/Vibe64TemporaryAiFixAction.vue";
import Vibe64ConnectedReplacement from "@/components/studio/vibe64-session/Vibe64ConnectedReplacement.vue";
import Vibe64ConnectedSessionPicker from "@/components/studio/vibe64-session/Vibe64ConnectedSessionPicker.vue";
import { writeClipboardText } from "@/lib/clipboard.js";

// Session activity above the chat: connection recovery, the recovery
// snapshot warning, Save and Update output and workspace preparation.
const { view } = defineProps({
  // The Autopilot view's state and actions. It is never replaced, so its
  // members are read once.
  view: { type: Object, required: true }
});
/** @type {import("@/composables/useVibe64AutopilotView.js").Vibe64AutopilotViewParts} */
const {
  agentActive, assistantAccountMessage, assistantAccountUnavailable, assistantFixAllowed,
  assistantFixRestrictionMessage, checkpointFailure, checkpointFailureReason, checkpointFailureVisible,
  connectionRecoveryVisible, createPullRequestOpen, dismissCheckpointFailure, dismissSaveWorkActivity,
  dismissWorkspaceSetupActivity, fixRepositoryActionError, fixWorkspaceSetupWithTemporaryAi, githubProject,
  projectSlug, props, repositoryRecoverySending, requestSessionRenewal, resourceRecoveryControl,
  retrySaveWork, retryWorkspaceSetup, reviewResolvedUpdate, saveWorkActivityDismissed,
  saveWorkActivityIsUpdate, saveWorkActivityKey, saveWorkActivityLabel, saveWorkCanResolveWithTemporaryAi,
  saveWorkConnectedResults, saveWorkDisabled, saveWorkError, saveWorkFailure, saveWorkOperationActive,
  saveWorkOutput, saveWorkRetryable, saveWorkSending, saveWorkStage, saveWorkStandInIdentity, saveWorkStatus,
  sessionId, sessionPullRequest, sourceOperationsSuspended, temporaryAiWorkspace, testApproval,
  updateConflictRecovery, updateWorkDisabled, workspaceSetupActivityKey, workspaceSetupAskDisabled,
  workspaceSetupConnectedChoice, workspaceSetupCurrentLabel, workspaceSetupDismissed, workspaceSetupError,
  workspaceSetupFixSending,
  workspaceSetupNeedsAttention, workspaceSetupOutput, workspaceSetupRetryDisabled, workspaceSetupRetrying,
  workspaceSetupRunning, workspaceSetupStatus, workspaceSetupTitle
} = view;
const aiTasks = inject(VIBE64_AI_TASKS_KEY);
// While an AI task owns the problem, Retry and the manual route wait: its window offers them.
const aiTaskOpen = computed(() => Boolean(aiTasks.task) && !aiTasks.projection.ended);
const resourceRetryBusy = ref(false);
// A missing Stack tool is fixed first; the database panel waits for it.
const workspaceSetupToolsMissing = ref(false);
const LocalDatabaseServer = defineAsyncComponent(() => (
  import("@local/vibe64-database-tools/client").then((module) => module.loadLocalDatabaseServer())
));
const updateHandledInRepair = computed(() => Boolean(
  (saveWorkActivityIsUpdate.value || saveWorkError.value) && temporaryAiWorkspace.value?.updateRepairVisible
));
const saveWorkCanCreatePullRequest = computed(() => githubProject.value && !sessionPullRequest.value?.number &&
  saveWorkFailure.value?.code === "vibe64_pull_request_required");

function copyActivityOutput(output = "") {
  return writeClipboardText(output);
}
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
</style>
