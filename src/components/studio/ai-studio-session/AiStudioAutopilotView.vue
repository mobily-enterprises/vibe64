<template>
  <section class="studio-autopilot">
    <div class="studio-autopilot__stage">
      <div
        v-show="codexWaiting"
        class="studio-autopilot__codex-terminal-stage"
      >
        <div
          :id="codexTerminalHostId"
          class="studio-autopilot__codex-terminal-host"
        />
        <div class="studio-autopilot__codex-terminal-overlay">
          <strong>Prompt injected into Codex.</strong>
          <span>{{ codexOverlayText }}</span>
          <v-btn
            class="studio-autopilot__stop-button"
            :prepend-icon="mdiClose"
            size="small"
            type="button"
            variant="tonal"
            @click="stop"
          >
            Stop Autopilot
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
          <span>{{ displayStatusText }}</span>
        </div>
      </div>

      <v-progress-circular
        v-if="!codexWaiting && !commandTerminalVisible && displayRunning"
        class="studio-autopilot__cog"
        color="primary"
        indeterminate
        :size="148"
        :width="8"
      >
        <v-icon :icon="mdiCog" size="64" />
      </v-progress-circular>

      <v-icon
        v-else-if="!codexWaiting && !commandTerminalVisible && failure"
        color="warning"
        :icon="mdiAlertCircleOutline"
        size="72"
      />

      <v-icon
        v-else-if="!codexWaiting && !commandTerminalVisible"
        color="primary"
        :icon="mdiCog"
        size="72"
      />

      <div class="studio-autopilot__status">
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

      <form
        v-else-if="readyForIssue && issueDiscussion.questioning"
        class="studio-autopilot__issue-form"
        @submit.prevent="issueDiscussion.submitQuestionAnswers"
      >
        <div class="studio-autopilot__questions">
          <div
            v-for="question in issueDiscussion.questions"
            :key="question.id"
            class="studio-autopilot__question"
          >
            <p>{{ question.text }}</p>
            <v-textarea
              v-model="question.answer"
              auto-grow
              class="studio-autopilot__issue-input"
              :disabled="page.busy"
              label="Your answer"
              rows="2"
              variant="outlined"
            />
          </div>
        </div>

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
            :disabled="!issueDiscussion.canSubmitAnswers"
            :loading="issueDiscussion.waiting"
            :prepend-icon="mdiSend"
            type="submit"
            variant="flat"
          >
            Continue
          </v-btn>

          <v-btn
            :disabled="issueDiscussion.waiting"
            :prepend-icon="mdiClose"
            type="button"
            variant="tonal"
            @click="issueDiscussion.cancelQuestions"
          >
            Cancel
          </v-btn>
        </div>
      </form>

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

      <div v-else-if="failure" class="studio-autopilot__failure">
        <v-alert
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ failure.error }}
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
          v-if="!running && !readyForIssue && !readyForDeepUiCheck && !readyForReview"
          class="studio-autopilot__start-button"
          color="primary"
          :disabled="!canStart"
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
import { computed, onMounted, proxyRefs, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiArrowRight,
  mdiCheck,
  mdiClose,
  mdiCog,
  mdiPlay,
  mdiRefresh,
  mdiSend
} from "@mdi/js";
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

const emit = defineEmits(["busy-change", "codex-waiting-change"]);

const props = defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  active: {
    default: true,
    type: Boolean
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
  page: {
    default: () => ({}),
    type: Object
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  session: {
    default: null,
    type: Object
  }
});

const {
  canStart,
  canResume,
  commandOutput,
  commandPreview,
  commandResult,
  commandRunning,
  failure,
  readyForDeepUiCheck,
  readyForIssue,
  readyForReview,
  retry,
  resume,
  runDeepUiCheck,
  running,
  skipDeepUiCheck,
  start,
  stop,
  statusText,
  waitingForCodex
} = useAiStudioAutopilotController({
  actions: props.actions,
  codexTerminal: props.codexTerminal,
  commandRunner: props.commandRunner || undefined,
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
});

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
  issueDiscussion.saving
));
const codexWaiting = computed(() => Boolean(
  issueDiscussion.waiting ||
  waitingForCodex.value
));
const commandTerminalFailed = computed(() => commandResult.value?.ok === false);
const commandTerminalVisible = computed(() => Boolean(
  !codexWaiting.value &&
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
const codexOverlayText = computed(() => issueDiscussion.waiting
  ? "Asking Codex to define the issue..."
  : displayStatusText.value);
const commandTerminalText = computed(() => {
  const output = stripTerminalControlSequences(commandOutput.value);
  const resultOutput = stripTerminalControlSequences(commandResult.value?.output || "");
  const preview = stripTerminalControlSequences(commandPreview.value);
  return tailCommandText(output || resultOutput || preview || "Starting command...");
});
const autopilotBusy = computed(() => Boolean(
  running.value ||
  issueDiscussion.waiting ||
  issueDiscussion.saving
));

function emitCodexWaitingState() {
  emit("codex-waiting-change", codexWaiting.value);
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

function emitAutopilotState() {
  emitCodexWaitingState();
  emitBusyState();
}

function resumeWhenActive() {
  if (props.active && canResume.value) {
    void resume();
  }
}

onMounted(emitAutopilotState);

onMounted(resumeWhenActive);

watch(codexWaiting, () => {
  emitCodexWaitingState();
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
  justify-self: center;
  max-width: min(64rem, 100%);
  min-height: 30rem;
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

.studio-autopilot__codex-terminal-host :deep(.studio-ai-sessions__terminals) {
  opacity: 0.3;
  text-align: left;
  transform: scale(0.5);
  transform-origin: center center;
}

.studio-autopilot__codex-terminal-host :deep(.codex-terminal),
.studio-autopilot__codex-terminal-host :deep(.codex-terminal__stage),
.studio-autopilot__codex-terminal-host :deep(.codex-terminal__host),
.studio-autopilot__codex-terminal-host :deep(.xterm) {
  text-align: left;
}

.studio-autopilot__codex-terminal-overlay,
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

.studio-autopilot__codex-terminal-overlay {
  pointer-events: auto;
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
  pointer-events: none;
}

.studio-autopilot__codex-terminal-overlay strong,
.studio-autopilot__command-terminal-overlay strong {
  font-size: 1.1rem;
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
.studio-autopilot__failure {
  display: grid;
  gap: 0.75rem;
  max-width: 44rem;
  width: 100%;
}

.studio-autopilot__issue-input {
  text-align: left;
}

.studio-autopilot__questions {
  display: grid;
  gap: 0.9rem;
}

.studio-autopilot__question {
  display: grid;
  gap: 0.45rem;
  text-align: left;
}

.studio-autopilot__question p {
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.35;
  margin: 0;
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
