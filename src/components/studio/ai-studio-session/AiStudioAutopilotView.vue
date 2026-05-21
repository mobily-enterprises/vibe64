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
        v-show="codexTerminalVisible"
        class="studio-autopilot__codex-terminal-stage"
        :class="{
          'studio-autopilot__codex-terminal-stage--ambient': codexTerminalAmbient,
          'studio-autopilot__codex-terminal-stage--review': reviewCodexChatVisible
        }"
      >
        <div
          :id="codexTerminalHostId"
          class="studio-autopilot__codex-terminal-host"
        />
        <div
          v-if="codexOverlayVisible"
          class="studio-autopilot__codex-terminal-overlay"
        >
          <strong>{{ codexOverlayTitle }}</strong>
          <span>{{ codexOverlayText }}</span>
          <v-btn
            class="studio-autopilot__stop-button"
            :prepend-icon="mdiClose"
            size="small"
            type="button"
            variant="tonal"
            @click="handleCodexOverlayAction"
          >
            {{ codexOverlayActionLabel }}
          </v-btn>
        </div>
      </div>

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
          <template v-if="commandTerminalFailed">
            <span>{{ commandFailureSummary }}</span>
            <v-textarea
              v-if="canRequestCommandAiFix"
              v-model="commandFailureNote"
              auto-grow
              class="studio-autopilot__command-fix-note"
              density="compact"
              hide-details
              label="Optional note for Codex"
              rows="3"
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
        v-if="!codexTerminalVisible && !commandTerminalVisible && displayRunning"
        class="studio-autopilot__cog"
        color="primary"
        indeterminate
        :size="148"
        :width="8"
      >
        <v-icon :icon="mdiCog" size="64" />
      </v-progress-circular>

      <v-icon
        v-else-if="!codexTerminalVisible && !commandTerminalVisible && failure"
        color="warning"
        :icon="mdiAlertCircleOutline"
        size="72"
      />

      <v-icon
        v-else-if="!codexTerminalVisible && !commandTerminalVisible"
        color="primary"
        :icon="mdiCog"
        size="72"
      />

      <div v-if="mainStatusVisible" class="studio-autopilot__status">
        <h2>{{ displayStatusText }}</h2>
      </div>

      <form
        v-if="readyForIssue && issueDiscussion.inputVisible"
        class="studio-autopilot__issue-form"
        @submit.prevent="issueDiscussion.submitInitialRequest"
      >
        <v-textarea
          v-model="issueDiscussion.requestText"
          auto-grow
          class="studio-autopilot__issue-input"
          :disabled="page.busy"
          :error-messages="issueDiscussion.failure ? [issueDiscussion.failure] : []"
          hint="Discuss issue and define scope"
          label="Describe what you would like to do"
          persistent-hint
          rows="5"
          variant="outlined"
        />

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!issueDiscussion.canSubmit"
            :loading="issueDiscussion.waiting"
            :prepend-icon="mdiSend"
            title="Ask Codex to define the issue."
            type="submit"
          >
            Discuss issue
          </v-btn>
        </div>
      </form>

      <AiStudioAutopilotQuestionForm
        v-else-if="readyForIssue && issueDiscussion.questioning"
        :can-submit="issueDiscussion.canSubmitAnswers"
        :disabled="page.busy"
        :failure="issueDiscussion.failure"
        :loading="issueDiscussion.waiting"
        :questions="issueDiscussion.questions"
        @answer-change="issueDiscussion.updateQuestionAnswer"
        @cancel="issueDiscussion.cancelQuestions"
        @submit="issueDiscussion.submitQuestionAnswers"
      />

      <form
        v-else-if="readyForIssue && issueDiscussion.reviewing"
        class="studio-autopilot__issue-form"
        @submit.prevent="issueDiscussion.acceptIssueDraft"
      >
        <v-text-field
          v-model="issueDiscussion.draftTitle"
          class="studio-autopilot__issue-input"
          :disabled="issueDiscussion.saving"
          label="Issue title"
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
        v-else-if="readyForIssue && issueDiscussion.failure"
        class="studio-autopilot__issue-form"
        type="warning"
        variant="tonal"
        density="compact"
      >
        {{ issueDiscussion.failure }}
      </v-alert>

      <AiStudioAutopilotQuestionForm
        v-else-if="autopilotQuestioning"
        :can-submit="canSubmitAutopilotQuestionAnswers"
        :disabled="running"
        :failure="autopilotQuestionFailure"
        intro="Codex needs a few answers before it can continue."
        :loading="running"
        :questions="autopilotQuestions"
        @answer-change="updateAutopilotQuestionAnswer"
        @cancel="cancelAutopilotQuestions"
        @submit="submitAutopilotQuestionAnswers"
      />

      <div
        v-else-if="readyForDeepUiCheck"
        class="studio-autopilot__decision"
      >
        <v-alert
          type="info"
          variant="tonal"
          density="compact"
        >
          The deep UI check can take a long time. Run it now, or skip it and continue to review/deslop.
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
        v-else-if="readyForReview"
        class="studio-autopilot__review"
      >
        <v-alert
          type="info"
          variant="tonal"
          density="compact"
        >
          Review what changed before Autopilot continues.
        </v-alert>

        <div class="studio-autopilot__actions studio-autopilot__review-actions">
          <AiStudioLaunchControls
            :active="active"
            button-label="Try it!"
            button-size="default"
            button-variant="flat"
            :busy="reviewControlsBusy"
            :fix-command-failure="codexTerminal.fixCommandFailure"
            :session="session"
          />

          <v-btn
            :color="reviewCodexChatVisible ? 'primary' : undefined"
            :prepend-icon="mdiRobotOutline"
            type="button"
            variant="tonal"
            @click="toggleReviewCodexChat"
          >
            {{ reviewCodexChatVisible ? "Hide Codex chat" : "Chat with Codex" }}
          </v-btn>

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
            Accept and finalize
          </v-btn>

          <v-btn
            :disabled="reviewControlsBusy"
            :prepend-icon="mdiRefresh"
            type="button"
            variant="tonal"
            @click="showReviewFeedback"
          >
            Reject, give more instructions
          </v-btn>
        </div>

        <form
          v-if="reviewFeedbackVisible"
          class="studio-autopilot__review-feedback"
          @submit.prevent="submitReviewFeedback"
        >
          <v-textarea
            v-model="reviewFeedback"
            auto-grow
            class="studio-autopilot__issue-input"
            :disabled="reviewControlsBusy"
            label="What should change?"
            rows="4"
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
              Send to Codex
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
        v-else-if="readyForMerge"
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
          The pull request is ready. Merge it and update the main checkout, or finish without merging.
        </v-alert>

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
        v-else-if="readyForFinished"
        class="studio-autopilot__finished"
      >
        <v-icon
          color="success"
          :icon="mdiCheckCircleOutline"
          size="72"
        />
        <p>The session is complete.</p>

        <v-btn
          color="primary"
          :disabled="!canArchiveSession"
          :loading="running"
          :prepend-icon="mdiArchiveOutline"
          type="button"
          variant="flat"
          @click="archiveSession"
        >
          Archive
        </v-btn>
      </div>

      <div v-else-if="standaloneFailureVisible" class="studio-autopilot__failure">
        <v-alert
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ failureErrorText }}
        </v-alert>

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            :loading="running"
            :prepend-icon="mdiRefresh"
            variant="flat"
            @click="retry"
          >
            Retry
          </v-btn>
        </div>
      </div>

      <div v-else class="studio-autopilot__actions">
        <v-btn
          v-if="canStart"
          class="studio-autopilot__start-button"
          color="primary"
          :prepend-icon="mdiPlay"
          variant="flat"
          @click="start"
        >
          Let's start
        </v-btn>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, proxyRefs, ref, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiArchiveOutline,
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
import AiStudioAutopilotQuestionForm from "@/components/studio/ai-studio-session/AiStudioAutopilotQuestionForm.vue";
import AiStudioHeadlessCommandOutput from "@/components/studio/ai-studio-session/AiStudioHeadlessCommandOutput.vue";
import {
  useAiStudioAutopilotController
} from "@/composables/useAiStudioAutopilotController.js";
import {
  useAiStudioAutopilotIssueDiscussion
} from "@/composables/useAiStudioAutopilotIssueDiscussion.js";
import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import {
  terminalFailureFixRequest
} from "@/lib/aiStudioTerminalFailurePrompt.js";

const emit = defineEmits(["busy-change", "codex-terminal-dock-change"]);

const props = defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  active: {
    default: true,
    type: Boolean
  },
  autopilotSteps: {
    default: () => [],
    type: Array
  },
  codexTerminal: {
    default: () => ({}),
    type: Object
  },
  codexTerminalHostId: {
    default: "studio-autopilot-codex-terminal-host",
    type: String
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
  review: {
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

const {
  acceptChanges,
  archiveSession,
  cancelMergeFailure,
  cancelAutopilotQuestions,
  canAcceptReview,
  canArchiveSession,
  canStart,
  canResume,
  canSubmitAutopilotQuestionAnswers,
  clearFailure,
  commandOutput,
  commandPreview,
  commandResult,
  commandRunning,
  failure,
  mergeAndSyncMainCheckout,
  autopilotQuestionFailure,
  autopilotQuestioning,
  autopilotQuestions,
  readyForDeepUiCheck,
  readyForFinished,
  readyForIssue,
  readyForMerge,
  readyForReview,
  rejectChanges,
  retry,
  resume,
  runDeepUiCheck,
  running,
  skipDeepUiCheck,
  skipMerge,
  start,
  stop,
  stopCommandAction,
  submitAutopilotQuestionAnswers,
  statusText,
  updateAutopilotQuestionAnswer,
  waitingForCodex
} = useAiStudioAutopilotController({
  actions: props.actions,
  codexTerminal: props.codexTerminal,
  commandRunner: props.commandRunner || undefined,
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
});
const reviewFeedback = ref("");
const reviewFeedbackVisible = ref(false);
const reviewCodexChatVisible = ref(false);
const commandFixActive = ref(false);
const commandFixInjectionError = ref("");
const commandFixSubmitting = ref(false);
const commandFailureNote = ref("");

const issueDiscussion = proxyRefs(useAiStudioAutopilotIssueDiscussion({
  actions: props.actions,
  codexTerminal: props.codexTerminal,
  readyForIssue,
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
}));
const displayStatusText = computed(() => readyForIssue.value
  ? issueDiscussion.statusText
  : statusText.value);
const displayRunning = computed(() => Boolean(
  running.value ||
  (readyForIssue.value && issueDiscussion.saving)
));
const issueDiscussionWaiting = computed(() => Boolean(readyForIssue.value && issueDiscussion.waiting));
const codexWaiting = computed(() => Boolean(
  issueDiscussionWaiting.value ||
  waitingForCodex.value
));
const codexPromptFailed = computed(() => failure.value?.source === "codex");
const codexTerminalVisible = computed(() => Boolean(
  codexWaiting.value ||
  codexPromptFailed.value ||
  commandFixActive.value ||
  (readyForReview.value && reviewCodexChatVisible.value)
));
const codexTerminalDisplayMode = computed(() => readyForReview.value && reviewCodexChatVisible.value
  ? "full"
  : "compact");
const codexTerminalAmbient = computed(() => codexTerminalDisplayMode.value === "compact");
const commandTerminalFailed = computed(() => commandResult.value?.ok === false);
const commandTerminalVisible = computed(() => Boolean(
  !codexTerminalVisible.value &&
  (
    commandRunning.value ||
    commandTerminalFailed.value
  )
));
const commandStatus = computed(() => commandRunning.value ? "running" : "");
const commandTerminalError = computed(() => {
  if (commandResult.value?.ok === false) {
    return String(commandResult.value.error || "");
  }
  return "";
});
const commandOverlayTitle = computed(() => commandTerminalFailed.value
  ? "Command needs attention."
  : "Command running.");
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
const codexOverlayVisible = computed(() => Boolean(
  codexWaiting.value ||
  commandFixActive.value
));
const codexOverlayTitle = computed(() => {
  if (commandFixInjectionError.value) {
    return "Codex prompt could not be sent.";
  }
  if (commandFixActive.value) {
    return commandFixSubmitting.value ? "Preparing Codex..." : "Codex is working...";
  }
  return issueDiscussionWaiting.value ? "Codex is working..." : "Autopilot is waiting for Codex.";
});
const codexOverlayText = computed(() => {
  if (commandFixInjectionError.value) {
    return commandFixInjectionError.value;
  }
  if (commandFixActive.value) {
    return "Asking Codex to solve the issue...";
  }
  return issueDiscussionWaiting.value ? "Asking Codex to solve the issue..." : displayStatusText.value;
});
const codexOverlayActionLabel = computed(() => commandFixActive.value
  ? "Back to command output"
  : "Stop Autopilot");
const commandTerminalText = computed(() => {
  const output = stripTerminalControlSequences(commandOutput.value);
  const resultOutput = stripTerminalControlSequences(commandResult.value?.output || "");
  const preview = stripTerminalControlSequences(commandPreview.value);
  return tailCommandText(output || resultOutput || preview || "Starting command...");
});
const autopilotBusy = computed(() => Boolean(
  running.value ||
  codexWaiting.value ||
  commandFixSubmitting.value ||
  issueDiscussionWaiting.value ||
  (readyForIssue.value && issueDiscussion.saving)
));
const reviewControlsBusy = computed(() => Boolean(running.value));
const reviewDiffDisabled = computed(() => Boolean(reviewControlsBusy.value || props.review?.diffDisabled));
const reviewDiffLoading = computed(() => Boolean(props.diff?.loading));
const reviewDiffTitle = computed(() => String(props.review?.diffTitle || "Review changes in the session worktree."));
const canSubmitReviewFeedback = computed(() => Boolean(
  reviewFeedback.value.trim() && !reviewControlsBusy.value
));
const navigationBusy = computed(() => Boolean(props.page?.busy || autopilotBusy.value || props.rewindBusy));
const mainStatusVisible = computed(() => Boolean(
  !codexTerminalVisible.value &&
  !commandTerminalVisible.value
));
const standaloneFailureVisible = computed(() => Boolean(
  failure.value &&
  !codexTerminalVisible.value &&
  !commandTerminalVisible.value &&
  !commandFixActive.value
));
const failureErrorText = computed(() => String(failure.value?.error || ""));

function emitCodexDockState() {
  emit("codex-terminal-dock-change", {
    displayMode: codexTerminalDisplayMode.value,
    docked: codexTerminalVisible.value
  });
}

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
  await waitForCodexDockToRender();
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

async function waitForCodexDockToRender() {
  // The dock event updates the parent Teleport, so Codex needs one render pass after this view updates.
  await nextTick();
  await nextTick();
}

function retryFromCommandFailure() {
  clearCommandFixState();
  void retry();
}

function stopAutopilot() {
  if (issueDiscussionWaiting.value) {
    issueDiscussion.cancelWaiting();
    return;
  }
  stop();
}

function handleCodexOverlayAction() {
  if (commandFixActive.value) {
    clearCommandFixState();
    return;
  }
  stopAutopilot();
}

function toggleReviewCodexChat() {
  reviewCodexChatVisible.value = !reviewCodexChatVisible.value;
}

async function rewindToAutopilotStep(step = {}) {
  if (navigationBusy.value || step.canRewind !== true || typeof props.rewindToStep !== "function") {
    return;
  }
  clearFailure();
  clearCommandFixState();
  commandFailureNote.value = "";
  reviewCodexChatVisible.value = false;
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
  const accepted = await rejectChanges(reviewFeedback.value);
  if (accepted) {
    cancelReviewFeedback();
  }
}

function emitAutopilotState() {
  emitCodexDockState();
  emitBusyState();
}

function resumeWhenActive() {
  if (props.active && canResume.value) {
    void resume();
  }
}

onMounted(emitAutopilotState);

onMounted(resumeWhenActive);

watch([codexTerminalVisible, codexTerminalDisplayMode], () => {
  emitCodexDockState();
}, {
  flush: "post"
});

watch(autopilotBusy, () => {
  emitBusyState();
}, {
  flush: "post"
});

watch(() => props.active, resumeWhenActive, {
  flush: "post"
});

watch(() => props.session?.currentStep || "", () => {
  resumeWhenActive();
}, {
  flush: "post"
});

watch(readyForReview, (ready) => {
  if (!ready) {
    reviewCodexChatVisible.value = false;
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
  align-items: center;
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 8px;
  display: grid;
  gap: 1rem;
  justify-items: center;
  min-height: 22rem;
  padding: 1.25rem;
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
  gap: 0.25rem;
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

.studio-autopilot__codex-terminal-stage {
  display: grid;
  justify-self: end;
  max-width: min(72rem, 100%);
  min-height: 36rem;
  place-items: stretch;
  position: relative;
  text-align: left;
  width: 100%;
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

.studio-autopilot__codex-terminal-host {
  display: grid;
  min-height: 0;
  text-align: left;
}

.studio-autopilot__codex-terminal-stage--ambient .studio-autopilot__codex-terminal-host :deep(.studio-ai-sessions__terminals) {
  opacity: 0.46;
  text-align: left;
  transform: scale(0.78);
  transform-origin: center center;
}

.studio-autopilot__codex-terminal-stage--review {
  max-width: min(76rem, 100%);
}

.studio-autopilot__codex-terminal-host :deep(.codex-terminal),
.studio-autopilot__codex-terminal-host :deep(.codex-terminal__stage),
.studio-autopilot__codex-terminal-host :deep(.codex-terminal__host),
.studio-autopilot__codex-terminal-host :deep(.xterm) {
  text-align: left;
}

.studio-autopilot__codex-terminal-overlay {
  align-items: center;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(20, 30, 46, 0.16);
  border-radius: 8px;
  box-shadow: 0 0.75rem 2rem rgba(13, 24, 42, 0.14);
  color: #182235;
  display: flex;
  flex-direction: column;
  font-size: 0.95rem;
  gap: 0.25rem;
  left: 50%;
  line-height: 1.35;
  max-width: min(28rem, calc(100% - 2rem));
  padding: 0.7rem 0.95rem;
  pointer-events: auto;
  position: absolute;
  text-align: center;
  top: 0.75rem;
  transform: translateX(-50%);
  width: max-content;
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

.studio-autopilot__codex-terminal-overlay strong,
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
.studio-autopilot__decision,
.studio-autopilot__review,
.studio-autopilot__merge,
.studio-autopilot__finished,
.studio-autopilot__failure {
  display: grid;
  gap: 0.75rem;
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
