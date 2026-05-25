<template>
  <section class="studio-autopilot">
    <AiStudioAutopilotNavigation
      :busy="navigationBusy"
      layout="rail"
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
          <template v-if="commandTerminalFailed">
            <span>{{ commandFailureSummary }}</span>
            <div class="studio-autopilot__actions">
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

      <div v-if="mainStatusVisible" class="studio-autopilot__status-bar">
        <v-progress-circular
          v-if="displayRunning"
          class="studio-autopilot__cog"
          color="primary"
          indeterminate
          :size="48"
          :width="3"
        >
          <v-icon :icon="mdiCog" size="24" />
        </v-progress-circular>

        <v-icon
          v-else-if="screenState.icon === 'warning'"
          color="warning"
          :icon="mdiAlertCircleOutline"
          size="34"
        />

        <v-icon
          v-else-if="screenState.icon === 'success'"
          color="success"
          :icon="mdiCheckCircleOutline"
          size="36"
        />

        <v-icon
          v-else
          color="primary"
          :icon="mdiCog"
          size="34"
        />

        <div
          v-if="headerScreenMessageVisible"
          class="studio-autopilot__screen-message studio-autopilot__screen-message--inline"
          :class="{
            'studio-autopilot__screen-message--warning': standaloneFailureVisible
          }"
        >
          <v-icon
            :icon="standaloneFailureVisible ? mdiAlertCircleOutline : mdiInformationOutline"
            size="19"
          />
          <span>{{ screenMessage }}</span>
        </div>

        <div v-else-if="statusTitleVisible" class="studio-autopilot__status">
          <h2>{{ displayStatusText }}</h2>
          <div
            v-if="screenStopAction || stuckRecoveryAvailable"
            class="studio-autopilot__status-actions"
          >
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
        </div>
      </div>

      <AiStudioBackgroundTasks
        v-if="visibleBackgroundTasks.length || backgroundTaskError"
        :error="backgroundTaskError"
        :retrying-task-id="retryingBackgroundTaskId"
        :tasks="visibleBackgroundTasks"
        @retry="retryBackgroundTask"
      />

      <form
        v-if="stepInput.visible && !displayRunning && !commandTerminalVisible"
        class="studio-autopilot__input-form"
        @submit.prevent="submitStepInput"
      >
        <p
          v-if="stepInput.prompt"
          class="text-body-2 text-medium-emphasis mb-0"
        >
          {{ stepInput.prompt }}
        </p>

        <template
          v-for="field in stepInput.fields"
          :key="field.name"
        >
          <v-textarea
            v-if="field.kind === 'textarea'"
            auto-grow
            class="studio-autopilot__input"
            :disabled="page.busy || stepInput.saving"
            :label="field.label"
            :model-value="stepInput.values[field.name] || ''"
            :placeholder="field.placeholder"
            :rows="field.rows || 8"
            variant="outlined"
            @update:model-value="stepInput.updateValue(field.name, $event)"
          />
          <v-text-field
            v-else
            class="studio-autopilot__input"
            :disabled="page.busy || stepInput.saving"
            :label="field.label"
            :model-value="stepInput.values[field.name] || ''"
            :placeholder="field.placeholder"
            variant="outlined"
            @update:model-value="stepInput.updateValue(field.name, $event)"
          />
        </template>

        <v-alert
          v-if="stepInput.error"
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ stepInput.error }}
        </v-alert>

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            variant="flat"
            :disabled="page.busy || !stepInput.canSubmit"
            :loading="stepInput.saving"
            :prepend-icon="mdiCheck"
            type="submit"
          >
            {{ stepInput.interaction?.submitLabel || "Submit" }}
          </v-btn>
        </div>
      </form>

      <div
        v-else-if="serverScreenVisible"
        class="studio-autopilot__server-screen"
        :class="{
          'studio-autopilot__server-screen--with-response': responseContentVisible
        }"
      >
        <div
          v-if="screenMessage && !headerScreenMessageVisible"
          class="studio-autopilot__screen-message"
          :class="{
            'studio-autopilot__screen-message--warning': standaloneFailureVisible
          }"
        >
          <v-icon
            :icon="standaloneFailureVisible ? mdiAlertCircleOutline : mdiInformationOutline"
            size="19"
          />
          <span>{{ screenMessage }}</span>
        </div>

        <AiStudioLaunchControls
          v-if="launchControlsVisible"
          button-label="Try it!"
          button-size="default"
          button-variant="flat"
          :busy="running"
          :session="session"
          :window-displayed="props.active"
          workflow-command
        />

        <AiStudioReportPreview
          v-if="reportPreviewVisible"
          :error="reportPreview.error"
          :loading="reportPreview.loading"
          :text="reportPreview.text"
        />

        <AiStudioConversationLog
          v-if="conversationLogVisible"
          class="studio-autopilot__response-content"
          :error="conversationLog.error"
          :loading="conversationLog.loading"
          :scroll-key="conversationScrollKey"
          :turns="conversationLog.turns"
          :visible="conversationLog.visible"
        />

        <AiStudioReportPreview
          v-if="responsePreviewVisible"
          class="studio-autopilot__response-content studio-autopilot__response-preview"
          empty-text="Codex response is not ready yet."
          :error="responsePreviewError"
          :loading="responsePreviewLoading"
          :text="responsePreviewText"
          :title-icon="mdiRobotOutline"
          title="Codex"
        />

        <form
          v-if="selectedControl"
          class="studio-autopilot__control-form"
          @submit.prevent="submitSelectedControl"
        >
          <template
            v-for="field in selectedControlFields"
            :key="field.name"
          >
            <AiStudioAutopilotPromptTextarea
              v-if="field.kind === 'textarea'"
              :model-value="selectedControlValues[field.name] || ''"
              class="studio-autopilot__input"
              :disabled="running"
              :label="field.label"
              :rows="field.rows || 3"
              :session-id="sessionId"
              variant="outlined"
              @update:model-value="updateSelectedControlValue(field.name, $event)"
            />
            <v-text-field
              v-else
              class="studio-autopilot__input"
              :disabled="running"
              :label="field.label"
              :model-value="selectedControlValues[field.name] || ''"
              :placeholder="field.placeholder"
              variant="outlined"
              @update:model-value="updateSelectedControlValue(field.name, $event)"
            />
          </template>

          <div class="studio-autopilot__composer-actions-row">
            <div class="studio-autopilot__actions studio-autopilot__composer-submit-actions">
              <v-btn
                color="primary"
                :disabled="!canSubmitSelectedControl"
                :loading="running"
                :prepend-icon="mdiSend"
                type="submit"
                variant="flat"
              >
                {{ selectedControl.label }}
              </v-btn>

              <v-btn
                v-if="!selectedControlIsPrimary"
                :disabled="running"
                :prepend-icon="mdiClose"
                type="button"
                variant="tonal"
                @click="clearSelectedControl"
              >
                Cancel
              </v-btn>
            </div>

            <div
              v-if="screenControls.length"
              class="studio-autopilot__actions studio-autopilot__screen-actions studio-autopilot__screen-actions--composer"
            >
              <v-btn
                v-for="control in screenControls"
                :key="control.id"
                :color="control.style === 'primary' ? 'primary' : undefined"
                :disabled="controlDisabled(control)"
                :loading="controlLoading(control)"
                :prepend-icon="controlIcon(control)"
                type="button"
                :variant="control.style === 'primary' ? 'flat' : 'tonal'"
                @click="activateControl(control)"
              >
                {{ control.label }}
              </v-btn>
            </div>
          </div>
        </form>

        <div
          v-if="screenControls.length && !selectedControl"
          class="studio-autopilot__actions studio-autopilot__screen-actions"
        >
          <v-btn
            v-for="control in screenControls"
            :key="control.id"
            :color="control.style === 'primary' ? 'primary' : undefined"
            :disabled="controlDisabled(control)"
            :loading="controlLoading(control)"
            :prepend-icon="controlIcon(control)"
            type="button"
            :variant="control.style === 'primary' ? 'flat' : 'tonal'"
            @click="activateControl(control)"
          >
            {{ control.label }}
          </v-btn>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, proxyRefs, ref, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiClose,
  mdiCog,
  mdiFileCompare,
  mdiInformationOutline,
  mdiRefresh,
  mdiRobotOutline,
  mdiSend,
  mdiStopCircleOutline
} from "@mdi/js";
import AiStudioLaunchControls from "@/components/studio/AiStudioLaunchControls.vue";
import AiStudioBackgroundTasks from "@/components/studio/ai-studio-session/AiStudioBackgroundTasks.vue";
import AiStudioAutopilotNavigation from "@/components/studio/ai-studio-session/AiStudioAutopilotNavigation.vue";
import AiStudioAutopilotPromptTextarea from "@/components/studio/ai-studio-session/AiStudioAutopilotPromptTextarea.vue";
import AiStudioConversationLog from "@/components/studio/ai-studio-session/AiStudioConversationLog.vue";
import AiStudioHeadlessCommandOutput from "@/components/studio/ai-studio-session/AiStudioHeadlessCommandOutput.vue";
import AiStudioReportPreview from "@/components/studio/ai-studio-session/AiStudioReportPreview.vue";
import {
  useAiStudioAutopilotController
} from "@/composables/useAiStudioAutopilotController.js";
import {
  useAiStudioBackgroundTasks
} from "@/composables/useAiStudioBackgroundTasks.js";
import { useAiStudioStepInputForm } from "@/composables/useAiStudioStepInputForm.js";
import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import {
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  parseNumberedQuestionPrompt
} from "@/lib/aiStudioNumberedQuestionSugar.js";

// Autopilot workflow meaning belongs to the server. This component renders the
// current presentation and dispatches the server-provided intents.
const emit = defineEmits(["busy-change"]);

const props = defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  active: {
    default: true,
    type: Boolean
  },
  automationEnabled: {
    default: true,
    type: Boolean
  },
  autopilotSteps: {
    default: () => [],
    type: Array
  },
  commandRunner: {
    default: null,
    type: Object
  },
  conversationLog: {
    default: () => ({}),
    type: Object
  },
  diff: {
    default: () => ({}),
    type: Object
  },
  humanInputResponsePreview: {
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
  canDispatchNextOperation,
  clearFailure,
  commandOutput,
  commandPreview,
  commandResult,
  commandRunning,
  failure,
  nextOperationKey,
  recoverStuckStep,
  retry,
  runNextOperation,
  runPresentedIntent,
  running,
  screenState,
  stop,
  stopCommandAction,
  stuckRecoveryAvailable,
  stuckRecoveryRunning
} = useAiStudioAutopilotController({
  actions: props.actions,
  commandRunner: props.commandRunner || undefined,
  enabled: computed(() => props.automationEnabled),
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
});

const selectedControl = ref(null);
const selectedControlValues = ref({});
const {
  backgroundTaskError,
  retryBackgroundTask,
  retryingBackgroundTaskId,
  visibleBackgroundTasks
} = useAiStudioBackgroundTasks({
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
});

const stepInput = proxyRefs(useAiStudioStepInputForm({
  onSaved: async () => {
    await props.refreshSessionData();
    await nextTick();
    await runNextOperation();
  },
  session: computed(() => props.session)
}));

const screenKind = computed(() => screenState.value.kind);
const sessionId = computed(() => String(props.session?.sessionId || ""));
const screenMessage = computed(() => String(screenState.value.message || ""));
const screenSections = computed(() => Array.isArray(screenState.value.sections) ? screenState.value.sections : []);
const primaryIntentId = computed(() => String(screenState.value.primaryIntentId || ""));
const displayStatusText = computed(() => {
  if (stepInput.visible) {
    return stepInput.interaction?.title || screenState.value.title;
  }
  return screenState.value.title;
});
const statusTitleIsCodexChat = computed(() => String(displayStatusText.value || "").trim() === "Talk to Codex");
const statusTitleVisible = computed(() => !statusTitleIsCodexChat.value);
const displayRunning = computed(() => Boolean(screenState.value.showProgress));
const commandTerminalFailed = computed(() => commandResult.value?.ok === false);
const commandTerminalVisible = computed(() => Boolean(screenKind.value === "command" && !stepInput.visible));
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
const commandOverlayTitle = computed(() => {
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
  screenState.value.showProgress === true ||
  stepInput.saving
)));
const navigationBusy = computed(() => Boolean(props.page?.busy || autopilotBusy.value || props.rewindBusy));
const mainStatusVisible = computed(() => !commandTerminalVisible.value);
const standaloneFailureVisible = computed(() => screenKind.value === "failure");
const screenStopAction = computed(() => String(screenState.value.stopAction || ""));
const serverScreenVisible = computed(() => Boolean(
  !displayRunning.value &&
  !commandTerminalVisible.value
));
const headerScreenMessageVisible = computed(() => Boolean(
  serverScreenVisible.value &&
  screenMessage.value &&
  statusTitleIsCodexChat.value
));
const responsePreviewText = computed(() => String(props.humanInputResponsePreview?.text || ""));
const responsePreviewError = computed(() => String(props.humanInputResponsePreview?.error || ""));
const responsePreviewLoading = computed(() => Boolean(props.humanInputResponsePreview?.loading));
const launchControlsVisible = computed(() => sectionVisible("launch_controls"));
const reportPreviewVisible = computed(() => Boolean(sectionVisible("report_preview") && props.reportPreview?.visible));
const conversationLogVisible = computed(() => Boolean(
  sectionVisible("response_preview") &&
  props.conversationLog?.visible
));
const responsePreviewVisible = computed(() => Boolean(
  sectionVisible("response_preview") &&
  !conversationLogVisible.value &&
  (
    responsePreviewText.value.trim() ||
    responsePreviewError.value ||
    responsePreviewLoading.value
  )
));
const responseContentVisible = computed(() => Boolean(
  conversationLogVisible.value ||
  responsePreviewVisible.value
));
const conversationScrollKey = computed(() => [
  sessionId.value,
  conversationLogVisible.value ? "conversation-visible" : "conversation-hidden",
  selectedControl.value?.id || "",
  selectedControlFields.value.map((field) => field.name).join("|")
].join(":"));
const allScreenControls = computed(() => {
  return (Array.isArray(props.session?.intents) ? props.session.intents : [])
    .filter((intent) => intent && intent.id && intent.label);
});
const primaryScreenControl = computed(() => {
  if (!primaryIntentId.value) {
    return null;
  }
  return allScreenControls.value.find((control) => control.id === primaryIntentId.value) || null;
});
const screenControls = computed(() => {
  const selectedId = String(selectedControl.value?.id || "");
  return allScreenControls.value.filter((control) => control.id !== selectedId);
});
const selectedControlOriginalFields = computed(() => {
  return selectedControl.value && Array.isArray(selectedControl.value.inputFields)
    ? selectedControl.value.inputFields
    : [];
});
const latestAssistantMessageText = computed(() => {
  const turns = Array.isArray(props.conversationLog?.turns) ? props.conversationLog.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = String(turns[index]?.assistant?.text || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
});
const selectedControlQuestionInput = computed(() => {
  const fields = selectedControlOriginalFields.value;
  if (
    selectedControl.value?.id !== "talk_to_codex" ||
    props.session?.stepMachine?.status !== "waiting_for_input" ||
    fields.length !== 1 ||
    fields[0]?.name !== "conversationRequest" ||
    fields[0]?.kind !== "textarea"
  ) {
    return {
      intro: "",
      questions: []
    };
  }
  return parseNumberedQuestionPrompt(latestAssistantMessageText.value);
});
const selectedControlFields = computed(() => {
  return selectedControlQuestionInput.value.questions.length
    ? numberedQuestionInputFields(selectedControlQuestionInput.value.questions)
    : selectedControlOriginalFields.value;
});
const selectedControlIsPrimary = computed(() => Boolean(
  selectedControl.value?.id &&
  selectedControl.value.id === primaryIntentId.value
));
const canSubmitSelectedControl = computed(() => Boolean(
  selectedControl.value &&
  !running.value &&
  !selectedControlFields.value.some((field) => field.required !== false && !String(selectedControlValues.value[field.name] || "").trim())
));

function sectionVisible(kind = "") {
  return screenSections.value.some((section) => section?.kind === kind);
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

async function submitStepInput() {
  await stepInput.submit();
}

function retryFromCommandFailure() {
  void retry();
}

function stopScreenAction() {
  stop();
}

async function rewindToAutopilotStep(step = {}) {
  if (navigationBusy.value || step.canRewind !== true || typeof props.rewindToStep !== "function") {
    return;
  }
  clearFailure();
  clearSelectedControl();
  await props.rewindToStep(step);
}

function controlDisabled(control = {}) {
  if (control.clientAction === "open_diff") {
    return Boolean(running.value || props.review?.diffDisabled);
  }
  return Boolean(running.value || control.enabled !== true);
}

function controlLoading(control = {}) {
  return control.clientAction === "open_diff"
    ? Boolean(props.diff?.loading)
    : running.value;
}

function controlIcon(control = {}) {
  if (control.clientAction === "open_diff") {
    return mdiFileCompare;
  }
  if (control.style === "primary") {
    return mdiCheck;
  }
  return mdiRefresh;
}

function initialControlValues(control = {}) {
  return Object.fromEntries((Array.isArray(control.inputFields) ? control.inputFields : [])
    .map((field) => [field.name, String(field.value ?? "")]));
}

function controlHasInputFields(control = {}) {
  return Array.isArray(control.inputFields) && control.inputFields.length > 0;
}

async function activateControl(control = {}) {
  if (controlDisabled(control)) {
    return;
  }
  if (control.clientAction === "open_diff") {
    props.diff?.openDialog?.();
    return;
  }
  if (controlHasInputFields(control)) {
    selectedControl.value = control;
    selectedControlValues.value = initialControlValues(control);
    return;
  }
  await runPresentedIntent(control);
}

function updateSelectedControlValue(name = "", value = "") {
  selectedControlValues.value = {
    ...selectedControlValues.value,
    [String(name || "")]: String(value || "")
  };
}

function clearSelectedControl() {
  selectedControl.value = null;
  selectedControlValues.value = {};
}

async function submitSelectedControl() {
  if (!canSubmitSelectedControl.value) {
    return;
  }
  const control = selectedControl.value;
  const accepted = await runPresentedIntent(control, {
    fields: selectedControlSubmissionFields()
  });
  if (accepted) {
    if (control?.id && control.id === primaryIntentId.value) {
      selectedControl.value = primaryScreenControl.value || control;
      selectedControlValues.value = initialControlValues(selectedControl.value);
    } else {
      clearSelectedControl();
    }
  }
}

function selectedControlSubmissionFields() {
  const questions = selectedControlQuestionInput.value.questions;
  if (!questions.length) {
    return selectedControlValues.value;
  }
  return numberedQuestionSubmissionFields(questions, selectedControlValues.value, "conversationRequest");
}

onMounted(emitBusyState);

watch(autopilotBusy, () => {
  emitBusyState();
}, {
  flush: "post"
});

watch(() => props.active, () => {
  emitBusyState();
}, {
  flush: "post"
});

watch(() => [
  props.active ? "active" : "inactive",
  canDispatchNextOperation.value ? "dispatchable" : "idle",
  nextOperationKey.value
].join(":"), () => {
  if (props.active && canDispatchNextOperation.value) {
    void runNextOperation();
  }
}, {
  flush: "post",
  immediate: true
});

watch(primaryScreenControl, (control) => {
  if (!control || control.enabled !== true || !controlHasInputFields(control)) {
    return;
  }
  if (!selectedControl.value || selectedControl.value.id === primaryIntentId.value) {
    selectedControl.value = control;
    selectedControlValues.value = initialControlValues(control);
  }
}, {
  flush: "post",
  immediate: true
});

watch(allScreenControls, (controls) => {
  if (!selectedControl.value) {
    return;
  }
  const updatedControl = controls.find((control) => control.id === selectedControl.value.id) || null;
  if (!updatedControl || !controlHasInputFields(updatedControl)) {
    clearSelectedControl();
    return;
  }
  selectedControl.value = updatedControl;
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
  gap: 0.5rem;
  justify-items: center;
  min-height: 18rem;
  padding: 0.2rem 1rem 1rem;
  text-align: left;
}

.studio-autopilot__stage--failure {
  align-content: start;
  padding-top: clamp(1.25rem, 7vh, 4rem);
}

.studio-autopilot__cog :deep(.v-icon) {
  animation: studio-autopilot-cog-spin 1.7s linear infinite;
}

.studio-autopilot__status-bar {
  align-items: center;
  display: flex;
  gap: 0.65rem;
  justify-content: center;
  max-width: 54rem;
  min-height: 2.5rem;
  text-align: left;
  width: 100%;
}

.studio-autopilot__status {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.65rem;
  min-width: 0;
}

.studio-autopilot__status h2 {
  font-size: 1.05rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.15;
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
  max-width: min(34rem, calc(100% - 2rem));
  padding: 1rem 1.25rem;
  pointer-events: auto;
  position: absolute;
  text-align: center;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(34rem, calc(100% - 2rem));
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

.studio-autopilot__command-terminal-overlay strong {
  font-size: 1.1rem;
}

.studio-autopilot__command-fix-note {
  text-align: left;
  width: 100%;
}

.studio-autopilot__stop-button {
  margin-top: 0;
}

.studio-autopilot__status-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.studio-autopilot__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.studio-autopilot__input-form,
.studio-autopilot__server-screen,
.studio-autopilot__control-form {
  display: grid;
  gap: 0.6rem;
  max-width: 52rem;
  width: 100%;
}

.studio-autopilot__server-screen {
  align-items: center;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.studio-autopilot__server-screen--with-response {
  padding-bottom: 0.45rem;
}

.studio-autopilot__control-form {
  gap: 0.45rem;
  margin-top: 0.1rem;
}

.studio-autopilot__screen-message {
  align-items: center;
  background: rgba(var(--v-theme-info), 0.1);
  border: 1px solid rgba(var(--v-theme-info), 0.24);
  border-radius: 8px;
  color: rgb(var(--v-theme-info));
  display: flex;
  font-size: 0.9rem;
  gap: 0.55rem;
  justify-self: stretch;
  line-height: 1.35;
  min-height: 2.25rem;
  padding: 0.42rem 0.65rem;
}

.studio-autopilot__screen-message--inline {
  flex: 1 1 auto;
  width: auto;
}

.studio-autopilot__screen-message span {
  color: rgb(var(--v-theme-on-surface));
  min-width: 0;
}

.studio-autopilot__screen-message--warning {
  background: rgba(var(--v-theme-warning), 0.1);
  border-color: rgba(var(--v-theme-warning), 0.28);
  color: rgb(var(--v-theme-warning));
}

.studio-autopilot__response-content {
  align-self: stretch;
  min-height: 0;
}

.studio-autopilot__response-preview :deep(.studio-report-preview__body) {
  max-height: min(34rem, max(14rem, calc(100dvh - 25rem)));
}

.studio-autopilot__server-screen--with-response .studio-autopilot__response-content {
  align-self: stretch;
  display: grid;
  flex: 1 1 auto;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.studio-autopilot__server-screen--with-response .studio-autopilot__response-content :deep(.studio-conversation-log__body) {
  min-height: 0;
}

.studio-autopilot__server-screen--with-response .studio-autopilot__response-preview :deep(.studio-report-preview__body) {
  max-height: none;
  min-height: 0;
}

.studio-autopilot__server-screen--with-response .studio-autopilot__control-form {
  align-self: end;
  flex: 0 0 auto;
  min-height: max-content;
  padding-bottom: 0.15rem;
}

.studio-autopilot__server-screen--with-response .studio-autopilot__screen-actions {
  align-self: end;
  flex: 0 0 auto;
  margin-top: 0;
}

.studio-autopilot__input {
  text-align: left;
  width: 100%;
}

.studio-autopilot__control-form :deep(.studio-autopilot-prompt-textarea) {
  gap: 0.35rem;
}

.studio-autopilot__control-form :deep(.v-input),
.studio-autopilot__control-form :deep(.v-field) {
  overflow: visible;
}

.studio-autopilot__control-form :deep(.v-field__input textarea) {
  min-height: 5.4rem;
}

.studio-autopilot__composer-actions-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: space-between;
  width: 100%;
}

.studio-autopilot__composer-submit-actions {
  justify-content: flex-end;
  margin-left: auto;
  order: 2;
}

.studio-autopilot__screen-actions {
  justify-content: flex-end;
  margin-top: auto;
  width: 100%;
}

.studio-autopilot__screen-actions.studio-autopilot__screen-actions--composer {
  align-self: center;
  flex: 1 1 auto;
  justify-content: flex-start;
  margin-top: 0;
  order: 1;
  width: auto;
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
    grid-template-columns: minmax(12rem, 15rem) minmax(0, 1fr);
    height: 100%;
    overflow: hidden;
    padding-right: 0.25rem;
  }

  .studio-autopilot__stage {
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
}
</style>
