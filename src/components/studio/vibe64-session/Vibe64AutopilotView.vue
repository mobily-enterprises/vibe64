<template>
  <section class="studio-autopilot">
    <Vibe64AutopilotNavigation
      class="studio-autopilot__nav"
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
        <Vibe64HeadlessCommandOutput
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

      <Vibe64BackgroundTasks
        v-if="visibleBackgroundTasks.length || backgroundTaskError"
        :error="backgroundTaskError"
        :retrying-task-id="retryingBackgroundTaskId"
        :tasks="visibleBackgroundTasks"
        @retry="retryBackgroundTask"
      />

      <v-alert
        v-if="actionResultNoticeVisible"
        class="studio-autopilot__notice"
        :type="props.actions.actionResultType"
        variant="tonal"
        density="compact"
      >
        {{ props.actions.actionResultMessage }}
      </v-alert>

      <v-alert
        v-if="clientControlErrorVisible"
        class="studio-autopilot__notice"
        type="warning"
        variant="tonal"
        density="compact"
      >
        {{ clientControlError }}
      </v-alert>

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

        <Vibe64LaunchControls
          v-if="launchControlsVisible"
          button-label="Try it!"
          button-size="default"
          button-variant="flat"
          :busy="running"
          :session="session"
          :window-displayed="props.active"
          workflow-command
        />

        <Vibe64ReportPreview
          v-if="reportPreviewVisible"
          :error="reportPreview.error"
          :loading="reportPreview.loading"
          :text="reportPreview.text"
        />

        <Vibe64ConversationLog
          v-if="conversationLogVisible"
          class="studio-autopilot__response-content"
          :error="conversationLog.error"
          :loading="conversationLog.loading"
          :scroll-key="conversationScrollKey"
          :turns="conversationLog.turns"
          :visible="conversationLog.visible"
        />

        <Vibe64ReportPreview
          v-if="responsePreviewVisible"
          class="studio-autopilot__response-content studio-autopilot__response-preview"
          empty-text="Codex response is not ready yet."
          :error="responsePreviewError"
          :loading="responsePreviewLoading"
          :text="responsePreviewText"
          :title-icon="mdiRobotOutline"
          title="Codex"
        />

        <Vibe64AutopilotComposer
          v-if="selectedControl"
          :can-submit-selected-control="canSubmitSelectedControl"
          :running="running"
          :selected-control="selectedControl"
          :selected-control-fields="selectedControlFields"
          :selected-control-is-primary="selectedControlIsPrimary"
          :selected-control-values="selectedControlValues"
          :session-id="sessionId"
          :workflow-controls="composerWorkflowControls"
          @activate-control="activateControl"
          @cancel="clearSelectedControl"
          @submit="submitSelectedControl"
          @update-value="updateSelectedControlValue"
        />

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
  mdiStopCircleOutline
} from "@mdi/js";
import Vibe64LaunchControls from "@/components/studio/Vibe64LaunchControls.vue";
import Vibe64BackgroundTasks from "@/components/studio/vibe64-session/Vibe64BackgroundTasks.vue";
import Vibe64AutopilotComposer from "@/components/studio/vibe64-session/Vibe64AutopilotComposer.vue";
import Vibe64AutopilotNavigation from "@/components/studio/vibe64-session/Vibe64AutopilotNavigation.vue";
import Vibe64ConversationLog from "@/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import Vibe64HeadlessCommandOutput from "@/components/studio/vibe64-session/Vibe64HeadlessCommandOutput.vue";
import Vibe64ReportPreview from "@/components/studio/vibe64-session/Vibe64ReportPreview.vue";
import {
  useVibe64AutopilotComposer
} from "@/composables/useVibe64AutopilotComposer.js";
import {
  useVibe64AutopilotController
} from "@/composables/useVibe64AutopilotController.js";
import {
  useVibe64BackgroundTasks
} from "@/composables/useVibe64BackgroundTasks.js";
import { useVibe64StepInputForm } from "@/composables/useVibe64StepInputForm.js";
import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import {
  runVibe64ClientControl
} from "@/lib/vibe64ClientControlDispatcher.js";
import {
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  controlIconToken,
  controlStateActive as presentationControlStateActive
} from "@/lib/vibe64PresentationControls.js";

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
} = useVibe64AutopilotController({
  actions: props.actions,
  commandRunner: props.commandRunner || undefined,
  enabled: computed(() => props.automationEnabled),
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
});

const {
  backgroundTaskError,
  retryBackgroundTask,
  retryingBackgroundTaskId,
  visibleBackgroundTasks
} = useVibe64BackgroundTasks({
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
});

const stepInput = proxyRefs(useVibe64StepInputForm({
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
const mainStatusVisible = computed(() => !commandTerminalVisible.value && !conversationLogVisible.value);
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
const actionResultNoticeVisible = computed(() => Boolean(
  props.actions?.actionResultMessage &&
  !commandTerminalVisible.value
));
const clientControlError = ref("");
const clientControlErrorVisible = computed(() => Boolean(clientControlError.value && !commandTerminalVisible.value));
const conversationScrollKey = computed(() => [
  sessionId.value,
  conversationLogVisible.value ? "conversation-visible" : "conversation-hidden",
  selectedControl.value?.id || "",
  selectedControlFields.value.map((field) => field.name).join("|")
].join(":"));
const allScreenControls = computed(() => {
  const sessionIntents = Array.isArray(props.session?.intents) ? props.session.intents : null;
  const presentationIntents = Array.isArray(props.session?.presentation?.intents)
    ? props.session.presentation.intents
    : [];
  return (sessionIntents || presentationIntents)
    .filter((intent) => intent && intent.id && intent.label);
});
const {
  activateControl,
  canSubmitSelectedControl,
  clearSelectedControl,
  screenControls,
  selectedControl,
  selectedControlFields,
  selectedControlIsPrimary,
  selectedControlValues,
  submitSelectedControl,
  updateSelectedControlValue
} = useVibe64AutopilotComposer({
  conversationLog: computed(() => props.conversationLog),
  controls: allScreenControls,
  isControlDisabled: controlDisabled,
  onRunClientControl: runClientControl,
  onRunControl: (control, options) => runPresentedIntent(control, options),
  primaryIntentId,
  running
});
const composerWorkflowControls = computed(() => {
  return screenControls.value.map((control) => ({
    ...control,
    buttonColor: control.style === "primary" ? "primary" : undefined,
    buttonVariant: control.style === "primary" ? "flat" : "tonal",
    disabled: controlDisabled(control),
    icon: controlIcon(control),
    loading: controlLoading(control),
    sourceControl: control
  }));
});

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

function controlStateActive(control = {}, field = "") {
  return presentationControlStateActive(control, field, {
    diff: props.diff,
    review: props.review
  });
}

async function runClientControl(control = {}) {
  clientControlError.value = "";
  try {
    const result = await runVibe64ClientControl(control, {
      diff: props.diff,
      refreshSessionData: props.refreshSessionData,
      session: props.session,
      sessionId: sessionId.value
    });
    if (result?.ok === false) {
      clientControlError.value = String(result.error || "The requested control could not run.");
      return false;
    }
    return result;
  } catch (error) {
    clientControlError.value = String(error?.message || error || "The requested control could not run.");
    return false;
  }
}

function controlDisabled(control = {}) {
  return Boolean(
    running.value ||
    control.enabled !== true ||
    controlStateActive(control, "disabledWhen")
  );
}

function controlLoading(control = {}) {
  return Boolean(running.value || controlStateActive(control, "loadingWhen"));
}

function controlIcon(control = {}) {
  if (controlIconToken(control) === VIBE64_CLIENT_CONTROL_ICON_TOKENS.DIFF) {
    return mdiFileCompare;
  }
  if (control.style === "primary") {
    return mdiCheck;
  }
  return mdiRefresh;
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
.studio-autopilot__server-screen {
  display: grid;
  gap: 0.6rem;
  max-width: 52rem;
  width: 100%;
}

.studio-autopilot__notice {
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

.studio-autopilot__screen-actions {
  justify-content: flex-end;
  margin-top: auto;
  width: 100%;
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
    column-gap: var(--studio-ai-sessions-layout-gap, 0.9rem);
    grid-template-columns:
      var(--studio-ai-sessions-inspect-main-column, minmax(18rem, 0.78fr))
      var(--studio-ai-sessions-codex-terminal-column, minmax(30rem, 1.22fr));
    height: 100%;
    overflow: hidden;
  }

  .studio-autopilot__nav {
    justify-self: start;
    width: min(15rem, 100%);
  }

  .studio-autopilot__stage {
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
}
</style>
