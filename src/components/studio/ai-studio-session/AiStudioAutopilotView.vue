<template>
  <section class="studio-autopilot">
    <AiStudioAutopilotNavigation
      :busy="navigationBusy"
      :steps="autopilotSteps"
      @rewind="rewindToAutopilotStep"
    />

    <div
      class="studio-autopilot__stage"
      :class="{
        'studio-autopilot__stage--failure': standaloneFailureVisible
      }"
    >
      <div
        v-if="commandTerminalVisible"
        class="studio-autopilot__command-terminal-stage"
      >
        <AiStudioHeadlessCommandOutput
          class="studio-autopilot__command-terminal-output"
          :command-preview="commandPreview"
          compact
          :error="commandTerminalError"
          :failed="commandTerminalFailed"
          :output="commandTerminalText"
          :running="commandRunning"
          :status="commandStatus"
          title="Autopilot command"
        />
        <div class="studio-autopilot__command-terminal-overlay">
          <strong>{{ commandOverlayTitle }}</strong>
          <template v-if="commandFixActive">
            <span>{{ commandFixStatusText }}</span>
            <div class="studio-autopilot__actions">
              <v-btn
                size="small"
                type="button"
                variant="tonal"
                @click="clearCommandFixState"
              >
                Back to command output
              </v-btn>
            </div>
          </template>
          <template v-else-if="commandTerminalFailed">
            <span>{{ commandFailureSummary }}</span>
            <AiStudioAutopilotPromptTextarea
              v-if="canRequestCommandAiFix"
              v-model="commandFailureNote"
              class="studio-autopilot__command-fix-note"
              :disabled="commandFixSubmitting"
              label="Optional note for Codex"
              rows="3"
              :session-id="sessionId"
              variant="outlined"
            />
            <div class="studio-autopilot__actions">
              <v-btn
                v-if="canRequestCommandAiFix"
                color="primary"
                :disabled="commandFixSubmitting"
                :loading="commandFixSubmitting"
                :prepend-icon="mdiRobotOutline"
                size="small"
                type="button"
                variant="flat"
                @click="requestCommandAiFix"
              >
                Get AI to fix it
              </v-btn>
              <v-btn
                color="primary"
                :prepend-icon="mdiRefresh"
                size="small"
                type="button"
                variant="tonal"
                @click="retryFromCommandFailure"
              >
                Retry
              </v-btn>
            </div>
          </template>
          <template v-else>
            <span>{{ displayStatusText }}</span>
            <v-btn
              v-if="commandRunning"
              class="studio-autopilot__stop-button"
              :prepend-icon="mdiStopCircleOutline"
              size="small"
              type="button"
              variant="tonal"
              @click="stopCommandAction"
            >
              Stop command
            </v-btn>
          </template>
        </div>
      </div>

      <v-progress-circular
        v-if="!commandTerminalVisible && displayRunning"
        class="studio-autopilot__cog"
        color="primary"
        indeterminate
        :size="116"
        :width="7"
      >
        <v-icon :icon="mdiCog" size="50" />
      </v-progress-circular>

      <v-icon
        v-else-if="!commandTerminalVisible && screenState.icon === 'warning'"
        color="warning"
        :icon="mdiAlertCircleOutline"
        size="58"
      />

      <v-icon
        v-else-if="!commandTerminalVisible"
        color="primary"
        :icon="mdiCog"
        size="58"
      />

      <div v-if="mainStatusVisible" class="studio-autopilot__status">
        <h2>{{ displayStatusText }}</h2>
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
      </div>

      <form
        v-if="screenKind === 'issue' && issueDiscussion.inputVisible"
        class="studio-autopilot__issue-form"
        @submit.prevent="issueDiscussion.submitInitialRequest"
      >
        <AiStudioAutopilotPromptTextarea
          v-model="issueDiscussion.requestText"
          class="studio-autopilot__issue-input"
          :disabled="page.busy"
          :error-messages="issueDiscussion.failure ? [issueDiscussion.failure] : []"
          :hint="issueDiscussion.inputHint"
          :label="issueDiscussion.inputLabel"
          persistent-hint
          rows="5"
          :session-id="sessionId"
          variant="outlined"
        />

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            variant="flat"
            :disabled="page.busy || !issueDiscussion.canSubmit"
            :loading="issueDiscussion.waiting"
            :prepend-icon="mdiSend"
            :title="issueDiscussion.submitTitle"
            type="submit"
          >
            {{ issueDiscussion.submitLabel }}
          </v-btn>
        </div>
      </form>

      <AiStudioAutopilotQuestionForm
        v-else-if="screenKind === 'questions'"
        :can-submit="codexQuestionCanSubmit"
        :disabled="page.busy || codexQuestionSubmitting"
        :failure="codexQuestionFailure"
        intro="Codex needs a few answers before it can continue."
        :loading="codexQuestionSubmitting"
        :questions="codexQuestionList"
        :session-id="sessionId"
        @answer-change="codexQuestionExchange.setAnswer"
        @cancel="codexQuestionExchange.cancel"
        @submit="codexQuestionExchange.submitAnswers"
      />

      <form
        v-else-if="screenKind === 'issue' && issueDiscussion.reviewing"
        class="studio-autopilot__issue-form"
        @submit.prevent="acceptIssueDraftAndContinue"
      >
        <v-text-field
          v-model="issueDiscussion.draftTitle"
          class="studio-autopilot__issue-input"
          :disabled="issueDiscussion.saving"
          label="Issue title"
          variant="outlined"
        />

        <v-text-field
          v-model="issueDiscussion.draftWord"
          class="studio-autopilot__issue-input"
          :disabled="issueDiscussion.saving"
          label="Session label"
          variant="outlined"
        />

        <v-textarea
          v-model="issueDiscussion.draftBody"
          auto-grow
          class="studio-autopilot__issue-input"
          :disabled="issueDiscussion.saving"
          label="Issue body"
          rows="8"
          variant="outlined"
        />

        <v-alert
          v-if="issueDiscussion.failure"
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ issueDiscussion.failure }}
        </v-alert>

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            :disabled="!issueDiscussion.canAccept"
            :loading="issueDiscussion.saving"
            :prepend-icon="mdiCheck"
            type="submit"
            variant="flat"
          >
            Accept it
          </v-btn>

          <v-btn
            :disabled="issueDiscussion.saving"
            :prepend-icon="mdiRefresh"
            type="button"
            variant="tonal"
            @click="issueDiscussion.rejectIssueDraft"
          >
            Back to the drawing board
          </v-btn>
        </div>
      </form>

      <v-alert
        v-else-if="screenKind === 'issue' && issueDiscussion.failure"
        class="studio-autopilot__issue-form"
        type="warning"
        variant="tonal"
        density="compact"
      >
        {{ issueDiscussion.failure }}
      </v-alert>

      <div
        v-else-if="screenKind === 'prompt_done'"
        class="studio-autopilot__decision"
      >
        <v-alert
          type="info"
          variant="tonal"
          density="compact"
        >
          {{ screenMessage }}
        </v-alert>

        <div class="studio-autopilot__actions">
          <v-btn
            class="studio-autopilot__start-button"
            color="primary"
            :prepend-icon="mdiPlay"
            variant="flat"
            @click="resume"
          >
            {{ screenButtonLabel }}
          </v-btn>
        </div>
      </div>

      <div
        v-else-if="screenKind === 'prompt_waiting'"
        class="studio-autopilot__decision"
      >
        <v-alert
          type="info"
          variant="tonal"
          density="compact"
        >
          {{ screenMessage }}
        </v-alert>

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            :prepend-icon="mdiPlay"
            variant="flat"
            @click="continuePromptRun"
          >
            Continue
          </v-btn>
        </div>
      </div>

      <div
        v-else-if="screenKind === 'agent_conversation'"
        class="studio-autopilot__agent-conversation"
      >
        <v-alert
          type="info"
          variant="tonal"
          density="compact"
        >
          {{ screenMessage }}
        </v-alert>

        <AiStudioReportPreview
          v-if="humanInputResponsePreviewVisible"
          empty-text="AI response is not ready yet."
          :error="humanInputResponsePreview.error"
          :loading="humanInputResponsePreview.loading"
          :text="humanInputResponsePreview.text"
          title="AI response"
        />

        <form
          class="studio-autopilot__agent-form"
          @submit.prevent="submitAgentConversation"
        >
          <AiStudioAutopilotPromptTextarea
            v-model="agentConversationRequest"
            class="studio-autopilot__issue-input"
            :disabled="running"
            label="What do you want to ask Codex?"
            rows="5"
            :session-id="sessionId"
            variant="outlined"
          />

          <div class="studio-autopilot__actions">
            <v-btn
              color="primary"
              :disabled="!canSubmitAgentConversation"
              :loading="running"
              :prepend-icon="mdiSend"
              type="submit"
              variant="flat"
            >
              Ask Codex
            </v-btn>

            <v-btn
              v-if="canFinishAgentConversation"
              color="primary"
              :disabled="running"
              :prepend-icon="mdiCheck"
              type="button"
              variant="tonal"
              @click="finishAgentConversation"
            >
              Finish
            </v-btn>
          </div>
        </form>
      </div>

      <div
        v-else-if="screenKind === 'deep_ui_decision'"
        class="studio-autopilot__decision"
      >
        <v-alert
          type="info"
          variant="tonal"
          density="compact"
        >
          {{ screenMessage }}
        </v-alert>

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            :loading="running"
            :prepend-icon="mdiPlay"
            variant="flat"
            @click="runDeepUiCheck"
          >
            Run deep UI check
          </v-btn>

          <v-btn
            :disabled="running"
            :prepend-icon="mdiArrowRight"
            type="button"
            variant="tonal"
            @click="skipDeepUiCheck"
          >
            Skip
          </v-btn>
        </div>
      </div>

      <div
        v-else-if="screenKind === 'review'"
        class="studio-autopilot__review"
      >
        <v-alert
          type="info"
          variant="tonal"
          density="compact"
        >
          {{ screenMessage }}
        </v-alert>

        <AiStudioReportPreview
          v-if="reportPreviewVisible"
          :error="reportPreview.error"
          :loading="reportPreview.loading"
          :text="reportPreview.text"
        />

        <AiStudioReportPreview
          v-if="humanInputResponsePreviewVisible"
          empty-text="AI response is not ready yet."
          :error="humanInputResponsePreview.error"
          :loading="humanInputResponsePreview.loading"
          :text="humanInputResponsePreview.text"
          title="AI response"
        />

        <div class="studio-autopilot__actions studio-autopilot__review-actions">
          <AiStudioLaunchControls
            button-label="Try it!"
            button-size="default"
            button-variant="flat"
            :busy="reviewControlsBusy"
            :fix-command-failure="codexTerminal.fixCommandFailure"
            :session="session"
            :window-displayed="active"
            workflow-command
          />

          <v-btn
            :disabled="reviewDiffDisabled"
            :loading="reviewDiffLoading"
            :prepend-icon="mdiFileCompare"
            :title="reviewDiffTitle"
            type="button"
            variant="tonal"
            @click="diff.openDialog"
          >
            Review diff
          </v-btn>

          <v-btn
            color="primary"
            :disabled="!canAcceptReview || reviewControlsBusy"
            :loading="running"
            :prepend-icon="mdiCheck"
            type="button"
            variant="flat"
            @click="acceptChanges"
          >
            {{ reviewAcceptLabel }}
          </v-btn>

          <v-btn
            v-if="implementationReviewVisible || finalReviewVisible"
            :disabled="reviewControlsBusy || (implementationReviewVisible && !canRequestReviewTweak)"
            :prepend-icon="mdiRefresh"
            type="button"
            variant="tonal"
            @click="showReviewFeedback"
          >
            {{ reviewFeedbackButtonLabel }}
          </v-btn>
        </div>

        <form
          v-if="reviewFeedbackVisible"
          class="studio-autopilot__review-feedback"
          @submit.prevent="submitReviewFeedback"
        >
          <AiStudioAutopilotPromptTextarea
            v-model="reviewFeedback"
            class="studio-autopilot__issue-input"
            :disabled="reviewControlsBusy"
            :label="reviewFeedbackInputLabel"
            rows="4"
            :session-id="sessionId"
            variant="outlined"
          />

          <div class="studio-autopilot__actions">
            <v-btn
              color="primary"
              :disabled="!canSubmitReviewFeedback"
              :loading="running"
              :prepend-icon="mdiSend"
              type="submit"
              variant="flat"
            >
              {{ reviewFeedbackSubmitLabel }}
            </v-btn>

            <v-btn
              :disabled="reviewControlsBusy"
              :prepend-icon="mdiClose"
              type="button"
              variant="tonal"
              @click="cancelReviewFeedback"
            >
              Cancel
            </v-btn>
          </div>
        </form>
      </div>

      <div
        v-else-if="screenKind === 'merge'"
        class="studio-autopilot__merge"
      >
        <v-alert
          v-if="failure"
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ failure.error }}
        </v-alert>

        <v-alert
          v-else
          type="info"
          variant="tonal"
          density="compact"
        >
          {{ screenMessage }}
        </v-alert>

        <AiStudioReportPreview
          v-if="reportPreviewVisible"
          :error="reportPreview.error"
          :loading="reportPreview.loading"
          :text="reportPreview.text"
        />

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            :loading="running"
            :prepend-icon="mdiSourceMerge"
            type="button"
            variant="flat"
            @click="mergeAndSyncMainCheckout"
          >
            Merge and update main checkout
          </v-btn>

          <v-btn
            :disabled="running"
            :prepend-icon="mdiArrowRight"
            type="button"
            variant="tonal"
            @click="skipMerge"
          >
            Do not merge
          </v-btn>

          <v-btn
            v-if="failure"
            :disabled="running"
            :prepend-icon="mdiClose"
            type="button"
            variant="tonal"
            @click="cancelMergeFailure"
          >
            Cancel merge
          </v-btn>
        </div>
      </div>

      <div
        v-else-if="screenKind === 'finished'"
        class="studio-autopilot__finished"
      >
        <v-icon
          color="success"
          :icon="mdiCheckCircleOutline"
          size="72"
        />
        <p>{{ screenMessage }}</p>

        <AiStudioReportPreview
          v-if="reportPreviewVisible"
          :error="reportPreview.error"
          :loading="reportPreview.loading"
          :text="reportPreview.text"
        />

        <AiStudioSessionActionButton
          v-if="archiveAction"
          :action="archiveAction"
          :actions="actions"
          :busy="page.busy"
          variant="flat"
        />
      </div>

      <div v-else-if="standaloneFailureVisible" class="studio-autopilot__failure">
        <v-alert
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ screenMessage }}
        </v-alert>
      </div>

      <div v-else class="studio-autopilot__actions">
        <v-btn
          v-if="screenKind === 'start'"
          class="studio-autopilot__start-button"
          color="primary"
          :prepend-icon="mdiPlay"
          variant="flat"
          @click="start"
        >
          {{ screenButtonLabel }}
        </v-btn>
        <v-btn
          v-else-if="screenKind === 'resume'"
          class="studio-autopilot__start-button"
          color="primary"
          :prepend-icon="mdiPlay"
          variant="flat"
          @click="resume"
        >
          {{ screenButtonLabel }}
        </v-btn>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, proxyRefs, ref, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiArrowRight,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiClose,
  mdiCog,
  mdiFileCompare,
  mdiPlay,
  mdiRefresh,
  mdiRobotOutline,
  mdiSend,
  mdiSourceMerge,
  mdiStopCircleOutline
} from "@mdi/js";
import AiStudioLaunchControls from "@/components/studio/AiStudioLaunchControls.vue";
import AiStudioAutopilotNavigation from "@/components/studio/ai-studio-session/AiStudioAutopilotNavigation.vue";
import AiStudioAutopilotPromptTextarea from "@/components/studio/ai-studio-session/AiStudioAutopilotPromptTextarea.vue";
import AiStudioAutopilotQuestionForm from "@/components/studio/ai-studio-session/AiStudioAutopilotQuestionForm.vue";
import AiStudioHeadlessCommandOutput from "@/components/studio/ai-studio-session/AiStudioHeadlessCommandOutput.vue";
import AiStudioReportPreview from "@/components/studio/ai-studio-session/AiStudioReportPreview.vue";
import AiStudioSessionActionButton from "@/components/studio/ai-studio-session/AiStudioSessionActionButton.vue";
import {
  useAiStudioAutopilotController
} from "@/composables/useAiStudioAutopilotController.js";
import {
  useAiStudioAutopilotIssueDiscussion
} from "@/composables/useAiStudioAutopilotIssueDiscussion.js";
import {
  useAiStudioCodexQuestionExchange
} from "@/composables/useAiStudioCodexQuestionExchange.js";
import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import {
  terminalFailureFixRequest
} from "@/lib/aiStudioTerminalFailurePrompt.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const emit = defineEmits(["busy-change"]);
const FINISH_SESSION_ACTION_ID = "finish_session";

const props = defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  active: {
    default: true,
    type: Boolean
  },
  autopilotArtifacts: {
    default: () => ({}),
    type: Object
  },
  autopilotSteps: {
    default: () => [],
    type: Array
  },
  codexTerminal: {
    default: () => ({}),
    type: Object
  },
  commandRunner: {
    default: null,
    type: Object
  },
  diff: {
    default: () => ({}),
    type: Object
  },
  page: {
    default: () => ({}),
    type: Object
  },
  reportPreview: {
    default: () => ({}),
    type: Object
  },
  review: {
    default: () => ({}),
    type: Object
  },
  humanInputResponsePreview: {
    default: () => ({}),
    type: Object
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  rewindBusy: {
    default: false,
    type: Boolean
  },
  rewindToStep: {
    default: null,
    type: Function
  },
  session: {
    default: null,
    type: Object
  }
});

const codexQuestionExchange = useAiStudioCodexQuestionExchange({
  codexTerminal: props.codexTerminal
});
const autopilotArtifactState = computed(() => readRefOrGetterValue(props.autopilotArtifacts?.artifacts) || null);
const clearAutopilotArtifacts = async () => props.autopilotArtifacts?.clear?.() || null;
const {
  acceptChanges,
  cancelMergeFailure,
  canAcceptReview,
  canFinishAgentConversation,
  canRequestReviewTweak,
  canSubmitAgentRequest,
  clearFailure,
  commandOutput,
  commandPreview,
  commandResult,
  commandRunning,
  continuePromptRun,
  failure,
  finishAgentConversation,
  mergeAndSyncMainCheckout,
  readyForAgentConversation,
  readyForIssue,
  rejectChanges,
  requestReviewTweak,
  retry,
  resume,
  runDeepUiCheck,
  running,
  screenState,
  skipDeepUiCheck,
  skipMerge,
  start,
  submitAgentRequest,
  syncFromAutopilotArtifacts,
  stop,
  stopCommandAction,
  waitingForCodex
} = useAiStudioAutopilotController({
  actions: props.actions,
  autopilotArtifacts: autopilotArtifactState,
  clearAutopilotArtifacts,
  codexTerminal: props.codexTerminal,
  commandRunner: props.commandRunner || undefined,
  enabled: computed(() => props.active),
  questionExchange: codexQuestionExchange,
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
});
const reviewFeedback = ref("");
const agentConversationRequest = ref("");
const reviewFeedbackVisible = ref(false);
const commandFixActive = ref(false);
const commandFixInjectionError = ref("");
const commandFixSubmitting = ref(false);
const commandFailureNote = ref("");
const archiveAction = computed(() => {
  const currentActions = readRefOrGetterValue(props.actions?.currentActions);
  return Array.isArray(currentActions)
    ? currentActions.find((action) => action.id === FINISH_SESSION_ACTION_ID) || null
    : null;
});

const issueDiscussion = proxyRefs(useAiStudioAutopilotIssueDiscussion({
  actions: props.actions,
  autopilotArtifacts: autopilotArtifactState,
  clearAutopilotArtifacts,
  codexTerminal: props.codexTerminal,
  enabled: computed(() => props.active),
  questionExchange: codexQuestionExchange,
  readyForIssue,
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
}));
const codexQuestionCanSubmit = computed(() => codexQuestionExchange.canSubmit.value);
const codexQuestionFailure = computed(() => codexQuestionExchange.failure.value);
const codexQuestionList = computed(() => codexQuestionExchange.questions.value);
const codexQuestionSubmitting = computed(() => codexQuestionExchange.submitting.value);
const screenKind = computed(() => screenState.value.kind);
const sessionId = computed(() => String(props.session?.sessionId || ""));
const screenMessage = computed(() => String(screenState.value.message || ""));
const screenButtonLabel = computed(() => String(screenState.value.buttonLabel || ""));
const reportScreenVisible = computed(() => ["review", "merge", "finished"].includes(screenKind.value));
const reviewKind = computed(() => String(screenState.value.reviewKind || ""));
const implementationReviewVisible = computed(() => screenKind.value === "review" && reviewKind.value === "implementation");
const finalReviewVisible = computed(() => screenKind.value === "review" && reviewKind.value === "final");
const displayStatusText = computed(() => {
  if (issueDiscussionWaiting.value) {
    return issueDiscussion.statusText;
  }
  return screenKind.value === "issue"
    ? issueDiscussion.statusText
    : screenState.value.title;
});
const issueDiscussionWaiting = computed(() => Boolean(readyForIssue.value && issueDiscussion.waiting));
const codexWaiting = computed(() => Boolean(
  issueDiscussionWaiting.value ||
  waitingForCodex.value
));
const displayRunning = computed(() => Boolean(
  screenState.value.showProgress ||
  issueDiscussionWaiting.value ||
  (readyForIssue.value && issueDiscussion.saving)
));
const commandTerminalFailed = computed(() => commandResult.value?.ok === false);
const commandTerminalVisible = computed(() => screenKind.value === "command");
const commandStatus = computed(() => commandRunning.value ? "running" : "");
const commandTerminalError = computed(() => {
  if (commandResult.value?.ok === false) {
    return String(commandResult.value.error || "");
  }
  return "";
});
const commandFailureSummary = computed(() => (
  commandTerminalError.value ||
  failure.value?.error ||
  "The command did not finish properly."
));
const commandTerminalFailureEvidence = computed(() => (
  commandOutput.value ||
  commandResult.value?.output ||
  commandPreview.value ||
  commandTerminalError.value
));
const canRequestCommandAiFix = computed(() => Boolean(
  commandTerminalFailed.value &&
  typeof props.codexTerminal.fixCommandFailure === "function" &&
  commandTerminalFailureEvidence.value
));
const commandFixStatusText = computed(() => (
  commandFixInjectionError.value ||
  "Asking Codex to solve the issue..."
));
const commandOverlayTitle = computed(() => {
  if (commandFixActive.value && commandFixInjectionError.value) {
    return "Codex prompt could not be sent.";
  }
  if (commandFixActive.value) {
    return commandFixSubmitting.value ? "Preparing Codex..." : "Codex is working...";
  }
  return commandTerminalFailed.value
    ? "Command needs attention."
    : "Command running.";
});
const commandTerminalText = computed(() => {
  const output = stripTerminalControlSequences(commandOutput.value);
  const resultOutput = stripTerminalControlSequences(commandResult.value?.output || "");
  const preview = stripTerminalControlSequences(commandPreview.value);
  return tailCommandText(output || resultOutput || preview || "Starting command...");
});
const autopilotBusy = computed(() => Boolean(props.active && (
  running.value ||
  codexWaiting.value ||
  codexQuestionSubmitting.value ||
  commandFixSubmitting.value ||
  issueDiscussionWaiting.value ||
  (readyForIssue.value && issueDiscussion.saving)
)));
const reviewControlsBusy = computed(() => Boolean(running.value));
const reviewDiffDisabled = computed(() => Boolean(reviewControlsBusy.value || props.review?.diffDisabled));
const reviewDiffLoading = computed(() => Boolean(props.diff?.loading));
const reviewDiffTitle = computed(() => String(props.review?.diffTitle || "Review changes in the session worktree."));
const canSubmitReviewFeedback = computed(() => Boolean(
  reviewFeedback.value.trim() &&
  !reviewControlsBusy.value &&
  (!implementationReviewVisible.value || canRequestReviewTweak.value)
));
const reviewFeedbackButtonLabel = computed(() => implementationReviewVisible.value
  ? "Ask AI for tweaks"
  : "Reject, give more instructions");
const reviewFeedbackInputLabel = computed(() => implementationReviewVisible.value
  ? "What would you like changed?"
  : "What should change?");
const reviewFeedbackSubmitLabel = computed(() => implementationReviewVisible.value
  ? "Ask AI for tweaks"
  : "Send to Codex");
const reviewAcceptLabel = computed(() => implementationReviewVisible.value
  ? "Looks good, continue"
  : "Accept and finalize");
const navigationBusy = computed(() => Boolean(props.page?.busy || autopilotBusy.value || props.rewindBusy));
const mainStatusVisible = computed(() => !commandTerminalVisible.value);
const standaloneFailureVisible = computed(() => screenKind.value === "failure");
const reportPreviewVisible = computed(() => Boolean(
  reportScreenVisible.value &&
  props.reportPreview?.visible
));
const humanInputResponsePreviewVisible = computed(() => Boolean(
  (implementationReviewVisible.value || readyForAgentConversation.value) &&
  props.humanInputResponsePreview?.visible
));
const canSubmitAgentConversation = computed(() => Boolean(
  canSubmitAgentRequest.value &&
  agentConversationRequest.value.trim()
));
const screenStopAction = computed(() => {
  if (issueDiscussionWaiting.value) {
    return "issue";
  }
  return String(screenState.value.stopAction || "");
});

function emitBusyState() {
  emit("busy-change", autopilotBusy.value);
}

function tailCommandText(value = "") {
  const text = String(value || "");
  const maxLength = 12000;
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(text.length - maxLength);
}

function clearCommandFixState() {
  commandFixActive.value = false;
  commandFixInjectionError.value = "";
  commandFixSubmitting.value = false;
}

async function requestCommandAiFix() {
  if (!canRequestCommandAiFix.value || commandFixSubmitting.value) {
    return;
  }
  const result = commandResult.value || {};
  commandFixActive.value = true;
  commandFixInjectionError.value = "";
  commandFixSubmitting.value = true;
  try {
    const injected = await props.codexTerminal.fixCommandFailure(terminalFailureFixRequest({
      actionId: result.actionId,
      actionLabel: result.actionLabel,
      closeError: commandTerminalError.value,
      commandPreview: commandPreview.value || result.commandPreview,
      exitCode: result.exitCode,
      output: commandTerminalFailureEvidence.value || commandTerminalText.value,
      sessionId: props.session?.sessionId || "",
      terminalKind: "command",
      terminalSessionId: result.terminalSessionId,
      terminalStatus: commandStatus.value,
      userMessage: commandFailureNote.value
    }));
    if (injected === false) {
      commandFixInjectionError.value = "Codex did not accept the prompt. Switch to Inspect and check the Codex terminal.";
    }
  } catch (error) {
    commandFixInjectionError.value = String(error?.message || error || "Codex prompt could not be sent.");
  } finally {
    commandFixSubmitting.value = false;
  }
}

function retryFromCommandFailure() {
  clearCommandFixState();
  void retry();
}

function stopScreenAction() {
  if (screenStopAction.value === "issue") {
    issueDiscussion.cancelWaiting();
    return;
  }
  stop();
}

async function rewindToAutopilotStep(step = {}) {
  if (navigationBusy.value || step.canRewind !== true || typeof props.rewindToStep !== "function") {
    return;
  }
  clearFailure();
  clearCommandFixState();
  commandFailureNote.value = "";
  reviewFeedback.value = "";
  reviewFeedbackVisible.value = false;
  await props.rewindToStep(step);
}

function showReviewFeedback() {
  reviewFeedbackVisible.value = true;
}

function cancelReviewFeedback() {
  reviewFeedback.value = "";
  reviewFeedbackVisible.value = false;
}

async function submitReviewFeedback() {
  if (!canSubmitReviewFeedback.value) {
    return;
  }
  const accepted = implementationReviewVisible.value
    ? await requestReviewTweak(reviewFeedback.value)
    : await rejectChanges(reviewFeedback.value);
  if (accepted) {
    cancelReviewFeedback();
  }
}

async function submitAgentConversation() {
  if (!canSubmitAgentConversation.value) {
    return;
  }
  const accepted = await submitAgentRequest(agentConversationRequest.value);
  if (accepted) {
    agentConversationRequest.value = "";
  }
}

async function acceptIssueDraftAndContinue() {
  const accepted = await issueDiscussion.acceptIssueDraft();
  if (accepted && props.active) {
    await nextTick();
    await resume();
  }
}

onMounted(emitBusyState);

onMounted(() => {
  if (props.active) {
    void syncFromAutopilotArtifacts();
  }
});

watch(autopilotBusy, () => {
  emitBusyState();
}, {
  flush: "post"
});

watch(() => props.active, (active) => {
  if (active) {
    void syncFromAutopilotArtifacts();
  }
  emitBusyState();
}, {
  flush: "post"
});

watch(() => props.session?.currentStep || "", () => {
  if (props.active) {
    void syncFromAutopilotArtifacts();
  }
}, {
  flush: "post"
});

watch(commandTerminalFailed, (failed) => {
  if (!failed) {
    clearCommandFixState();
  }
}, {
  flush: "post"
});

</script>

<style scoped>
.studio-autopilot {
  align-items: stretch;
  display: grid;
  gap: 1rem;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__stage {
  align-content: start;
  align-items: start;
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 8px;
  display: grid;
  gap: 0.65rem;
  justify-items: center;
  min-height: 18rem;
  padding: 0.85rem 1rem 1rem;
  text-align: center;
}

.studio-autopilot__stage--failure {
  align-content: start;
  padding-top: clamp(1.25rem, 7vh, 4rem);
}

.studio-autopilot__cog :deep(.v-icon) {
  animation: studio-autopilot-cog-spin 1.7s linear infinite;
}

.studio-autopilot__status {
  display: grid;
  gap: 0.15rem;
}

.studio-autopilot__status h2 {
  font-size: 1.2rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0;
}

.studio-autopilot__status p {
  color: rgb(var(--v-theme-on-surface-variant));
  margin: 0;
}

.studio-autopilot__command-terminal-stage {
  display: grid;
  height: min(30rem, 58vh);
  justify-self: center;
  max-width: min(64rem, 100%);
  min-height: 18rem;
  place-items: stretch;
  position: relative;
  text-align: left;
  width: 100%;
}

.studio-autopilot__command-terminal-overlay {
  align-items: center;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(20, 30, 46, 0.16);
  border-radius: 8px;
  box-shadow: 0 1rem 2.5rem rgba(13, 24, 42, 0.18);
  color: #182235;
  display: flex;
  flex-direction: column;
  font-size: 1rem;
  gap: 0.35rem;
  justify-content: center;
  left: 50%;
  line-height: 1.35;
  max-width: min(26rem, calc(100% - 2rem));
  padding: 1rem 1.25rem;
  pointer-events: auto;
  position: absolute;
  text-align: center;
  top: 50%;
  transform: translate(-50%, -50%);
  width: max-content;
}

.studio-autopilot__command-terminal-output {
  height: 100%;
  opacity: 0.34;
  text-align: left;
}

.studio-autopilot__command-terminal-output :deep(.studio-headless-command-output__text) {
  border: 0;
  border-radius: 8px;
  font-size: 0.78rem;
  line-height: 1.42;
  padding: 0.85rem;
}

.studio-autopilot__command-terminal-overlay {
  pointer-events: auto;
  width: min(34rem, calc(100% - 2rem));
}

.studio-autopilot__command-terminal-overlay strong {
  font-size: 1.1rem;
}

.studio-autopilot__command-fix-note {
  text-align: left;
  width: 100%;
}

.studio-autopilot__stop-button {
  margin-top: 0.3rem;
}

.studio-autopilot__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.studio-autopilot__start-button {
  font-size: 1.65rem;
  font-weight: 760;
  min-height: 5.75rem;
  min-width: min(30rem, 100%);
  padding-inline: 3.5rem;
}

.studio-autopilot__issue-form,
.studio-autopilot__agent-conversation,
.studio-autopilot__decision,
.studio-autopilot__review,
.studio-autopilot__merge,
.studio-autopilot__finished,
.studio-autopilot__failure {
  display: grid;
  gap: 0.6rem;
  max-width: 44rem;
  width: 100%;
}

.studio-autopilot__finished {
  justify-items: center;
}

.studio-autopilot__finished p {
  color: rgb(var(--v-theme-on-surface-variant));
  margin: 0;
}

.studio-autopilot__review-actions {
  align-items: stretch;
}

.studio-autopilot__review {
  order: -1;
}

.studio-autopilot__review-feedback {
  display: grid;
  gap: 0.65rem;
}

.studio-autopilot__agent-form {
  display: grid;
  gap: 0.5rem;
}

.studio-autopilot__issue-input {
  text-align: left;
}

@keyframes studio-autopilot-cog-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 981px) {
  .studio-autopilot {
    align-content: start;
    overflow-y: auto;
    padding-right: 0.25rem;
    scrollbar-gutter: stable;
  }
}
</style>
