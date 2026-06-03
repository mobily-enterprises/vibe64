<template>
  <section
    class="studio-autopilot"
    :class="{ 'studio-autopilot--chat-collapsed': chatCollapsed }"
  >
    <section
      class="studio-autopilot__chat-panel"
      aria-label="Session chat"
    >
      <div class="studio-autopilot__session-header">
        <Vibe64SessionToolbar
          v-if="sessionToolbarVisible"
          :abandon="sessionAbandon"
          compact
          :max-visible-sessions="3"
          :selected-session-id="sessionId"
          :selection-closed="sessionSelectionClosed"
          :toolbar="sessionToolbar"
        >
          <template #after-sessions>
            <v-menu
              v-if="sessionToolsVisible"
              v-model="sessionToolsMenuOpen"
              location="bottom end"
              transition="scale-transition"
            >
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  aria-label="Session tools"
                  class="studio-autopilot__session-tools-button"
                  :color="activeSessionTool ? 'primary' : undefined"
                  density="comfortable"
                  :icon="activeSessionTool?.icon || mdiInformationOutline"
                  size="small"
                  title="Session tools"
                  type="button"
                  :variant="activeSessionTool ? 'flat' : 'tonal'"
                />
              </template>

              <div
                class="studio-autopilot__session-tools-menu"
                aria-label="Active session tools"
              >
                <v-btn
                  v-for="tool in sessionToolControls"
                  :key="tool.id"
                  class="studio-autopilot__session-tool"
                  :color="rightPaneTab === tool.id ? 'primary' : undefined"
                  :disabled="tool.disabled"
                  :prepend-icon="tool.icon"
                  size="large"
                  :title="tool.title"
                  type="button"
                  :variant="rightPaneTab === tool.id ? 'flat' : 'tonal'"
                  @click="selectSessionToolFromMenu(tool.id)"
                >
                  {{ tool.label }}
                </v-btn>
              </div>
            </v-menu>
          </template>
        </Vibe64SessionToolbar>

        <Vibe64AutopilotNavigation
          class="studio-autopilot__nav"
          :busy="navigationBusy"
          :executing="workflowExecuting"
          layout="icons"
          :steps="autopilotSteps"
          @rewind="rewindToAutopilotStep"
        />
      </div>

      <div
        class="studio-autopilot__chat-body"
        :class="{ 'studio-autopilot__chat-body--artifact': chatTakeoverVisible }"
      >
        <Vibe64ReportPreview
          v-if="reportPreviewVisible"
          class="studio-autopilot__artifact"
          :error="reportPreview.error"
          :loading="reportPreview.loading"
          :text="reportPreview.text"
        />

        <template v-else>
          <Vibe64ConversationLog
            class="studio-autopilot__conversation"
            :activity-messages="chatActivityMessages"
            :error="conversationLog.error"
            :loading="conversationLog.loading"
            :scroll-key="conversationScrollKey"
            :turns="conversationLog.turns"
            :visible="chatTimelineVisible"
          />
        </template>
      </div>

      <div
        class="studio-autopilot__thinking"
        :class="{ 'studio-autopilot__thinking--empty': !thinkingVisible }"
        role="status"
        :aria-hidden="thinkingVisible ? undefined : 'true'"
        aria-live="polite"
      >
        <span class="studio-autopilot__thinking-mark" />
        <span>Thinking...</span>
      </div>

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
        v-if="composerVisible"
        class="studio-autopilot__composer"
      >
        <form
          v-if="stepInputFormVisible"
          class="studio-autopilot__input-form"
          @submit.prevent="submitStepInputForm"
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
              hide-details="auto"
              :label="field.label"
              :model-value="stepInput.values[field.name] || ''"
              :placeholder="field.placeholder"
              :rows="field.rows || 2"
              variant="outlined"
              @update:model-value="stepInput.updateValue(field.name, $event)"
            />
            <v-text-field
              v-else
              class="studio-autopilot__input"
              :disabled="page.busy || stepInput.saving"
              hide-details="auto"
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

          <div
            v-if="statusActionsVisible"
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

          <Vibe64WorkflowControlForm
            v-if="selectedStepInputControlVisible"
            class="studio-autopilot__inline-control"
            :can-submit-selected-control="canSubmitSelectedControl"
            layout="center"
            :running="composerInputLocked"
            :selected-control="selectedControl"
            :selected-control-fields="selectedControlFields"
            :selected-control-values="selectedControlValues"
            sticky-actions
            :workflow-controls="activeComposerWorkflowControls"
            @activate-control="activateWorkflowButtonControl"
            @cancel="clearSelectedControl"
            @submit="submitSelectedWorkflowControl"
            @update-value="updateSelectedControlValue"
          />

          <div
            v-else
            class="studio-autopilot__actions"
          >
            <v-btn
              v-if="!stepInputHasWorkflowIntents"
              color="primary"
              :variant="stepInputHasWorkflowIntents ? 'tonal' : 'flat'"
              :disabled="page.busy || !stepInput.canSubmit"
              :loading="stepInput.saving"
              :prepend-icon="mdiCheck"
              size="small"
              type="submit"
            >
              {{ stepInput.interaction?.submitLabel || "Submit" }}
            </v-btn>

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

            <template
              v-if="!stepInputHasWorkflowIntents && !workflowButtonControls.length"
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
            </template>
          </div>
        </form>

        <template v-else>
          <div
            v-if="statusActionsVisible"
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

          <Vibe64WorkflowControlForm
            v-if="selectedScreenControlVisible"
            as-form
            attach-textarea
            class="studio-autopilot__control-form"
            :cancel-visible="!composerInputLocked && !selectedControlIsPrimary"
            :can-submit-selected-control="canSubmitSelectedControl"
            inline-submit
            :interrupt-visible="codexInterruptVisible"
            layout="split"
            :running="composerInputLocked"
            :selected-control="selectedControl"
            :selected-control-fields="selectedControlFields"
            :selected-control-values="selectedControlValues"
            :session-id="sessionId"
            :textarea-rows="2"
            :workflow-controls="activeComposerWorkflowControls"
            @activate-control="activateControl"
            @cancel="clearSelectedControl"
            @interrupt="requestCodexInterrupt"
            @submit="submitSelectedControl"
            @update-value="updateSelectedControlValue"
          />

          <Vibe64WorkflowControlForm
            v-else-if="passiveComposerVisible"
            as-form
            attach-textarea
            :attachments-enabled="false"
            class="studio-autopilot__control-form"
            :cancel-visible="false"
            :can-submit-selected-control="false"
            inline-submit
            input-disabled
            :interrupt-visible="codexInterruptVisible"
            layout="split"
            :running="passiveComposerBusy"
            :selected-control="passiveComposerControl"
            :selected-control-fields="passiveComposerFields"
            :selected-control-values="passiveComposerValues"
            :session-id="sessionId"
            :textarea-rows="2"
            :workflow-controls="activeComposerWorkflowControls"
            @activate-control="activateControl"
            @interrupt="requestCodexInterrupt"
            @submit="submitPassiveComposer"
            @update-value="updatePassiveComposer"
          />

          <div
            v-if="workflowButtonControls.length && !selectedControl && !passiveComposerVisible"
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
              @click="activateControl(control.sourceControl || control)"
            >
              {{ control.label }}
            </v-btn>
          </div>
        </template>
      </div>
    </section>

    <section class="studio-autopilot__workspace-panel" aria-label="Workspace">
      <section class="studio-autopilot__preview-panel">
        <div
          v-show="rightPaneTab === 'preview'"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <div
            v-if="commandSpyVisible"
            class="studio-autopilot__command-spy"
            :class="{ 'studio-autopilot__command-spy--expanded': commandSpyExpanded }"
          >
            <div class="studio-autopilot__command-spy-header">
              <div class="studio-autopilot__command-spy-title">
                <v-icon :icon="mdiConsoleLine" size="18" />
                <span>{{ commandOverlayTitle }}</span>
              </div>
              <div class="studio-autopilot__command-spy-actions">
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
                  :prepend-icon="mdiRefresh"
                  size="small"
                  type="button"
                  variant="tonal"
                  @click="retryFromCommandFailure"
                >
                  Retry
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
                <v-btn
                  :icon="commandSpyExpanded ? mdiChevronUp : mdiChevronDown"
                  size="small"
                  :title="commandSpyExpanded ? 'Collapse command output' : 'Expand command output'"
                  type="button"
                  variant="text"
                  @click="commandSpyExpanded = !commandSpyExpanded"
                />
              </div>
            </div>
            <p v-if="!commandSpyExpanded" class="studio-autopilot__command-spy-summary">
              {{ commandTerminalFailed ? commandFailureSummary : commandTerminalSummary }}
            </p>
            <Vibe64HeadlessCommandOutput
              v-else
              class="studio-autopilot__command-terminal-output"
              :action-id="commandResult?.actionId || ''"
              :action-label="commandResult?.actionLabel || ''"
              :attempted-command="commandResult?.attemptedCommand || ''"
              :command-preview="commandPreview"
              compact
              :error="commandTerminalError"
              :exit-code="commandResult?.exitCode ?? null"
              :failed="commandTerminalFailed"
              :output="commandTerminalText"
              :running="commandRunning"
              :session-id="sessionId"
              :status="commandStatus"
              :terminal-session-id="commandResult?.terminalSessionId || ''"
              title="Autopilot command"
              @fix-requested="openFixCodexDialog"
            />
          </div>

          <Vibe64LaunchControls
            auto-start-target-id="dev"
            button-label="Run"
            button-size="small"
            button-variant="tonal"
            :busy="false"
            class="studio-autopilot__preview-launch"
            embedded-preview
            :session="session"
            :window-displayed="props.active"
          />
        </div>

        <div
          v-show="rightPaneTab === 'dashboard'"
          class="studio-autopilot__right-pane-page studio-autopilot__dashboard-pane"
          role="tabpanel"
        >
          <slot name="dashboard" :dashboard-context="dashboardSessionContext" />
        </div>

        <div
          v-show="rightPaneTab === 'session-details'"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <Vibe64SessionDetailsPane :context="dashboardSessionContext" />
        </div>

        <div
          v-show="rightPaneTab === 'diff'"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <Vibe64SessionDiffPanel
            :active="rightPaneTab === 'diff'"
            :diff="diff"
            :review="review"
          />
        </div>

        <div
          v-show="rightPaneTab === 'shell'"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <slot name="shell-terminal" :active="rightPaneTab === 'shell'" />
        </div>

        <div
          v-show="rightPaneTab === 'ai-terminal'"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <slot name="ai-terminal" :active="rightPaneTab === 'ai-terminal'" />
        </div>
      </section>
    </section>

    <Vibe64FixCodexDialog
      v-model="fixDialogOpen"
      :job="fixJob"
      :terminal="fixTerminal"
    />
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, proxyRefs, ref, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiConsoleLine,
  mdiFileCompare,
  mdiInformationOutline,
  mdiRefresh,
  mdiRobotOutline,
  mdiStopCircleOutline
} from "@mdi/js";
import {
  VIBE64_ACTION_DISPATCH_ROUTES as ACTION_DISPATCH_ROUTES
} from "@local/vibe64-core/shared";
import Vibe64FixCodexDialog from "@/components/studio/Vibe64FixCodexDialog.vue";
import Vibe64LaunchControls from "@/components/studio/Vibe64LaunchControls.vue";
import Vibe64BackgroundTasks from "@/components/studio/vibe64-session/Vibe64BackgroundTasks.vue";
import Vibe64AutopilotNavigation from "@/components/studio/vibe64-session/Vibe64AutopilotNavigation.vue";
import Vibe64ConversationLog from "@/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import Vibe64HeadlessCommandOutput from "@/components/studio/vibe64-session/Vibe64HeadlessCommandOutput.vue";
import Vibe64ReportPreview from "@/components/studio/vibe64-session/Vibe64ReportPreview.vue";
import Vibe64SessionActionButton from "@/components/studio/vibe64-session/Vibe64SessionActionButton.vue";
import Vibe64SessionDetailsPane from "@/components/studio/vibe64-session/Vibe64SessionDetailsPane.vue";
import Vibe64SessionDiffPanel from "@/components/studio/vibe64-session/Vibe64SessionDiffPanel.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64WorkflowControlForm from "@/components/studio/vibe64-session/Vibe64WorkflowControlForm.vue";
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
  useVibe64FixCodexDialog
} from "@/composables/useVibe64FixCodexDialog.js";
import {
  terminalFailureFixRequest
} from "@/lib/vibe64TerminalFailurePrompt.js";
import {
  controlSavesCurrentStepInputBeforeRun,
  currentStepInputHasDecisionControls
} from "@/lib/vibe64CurrentStepInputDecision.js";
import {
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  controlIconToken,
  controlStateActive as presentationControlStateActive
} from "@/lib/vibe64PresentationControls.js";
import {
  currentStepWorkflowControls,
  workflowControlSourceAction
} from "@/lib/vibe64WorkflowControlModel.js";
import {
  vibe64SessionFacts
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";

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
  codexThinking: {
    default: false,
    type: Boolean
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  codexTerminalAttention: {
    default: false,
    type: Boolean
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
  interruptCodexTurn: {
    default: async () => false,
    type: Function
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
  sessionAbandon: {
    default: () => ({}),
    type: Object
  },
  session: {
    default: null,
    type: Object
  },
  sessionSelectionClosed: {
    default: false,
    type: Boolean
  },
  sessionToolbar: {
    default: () => ({}),
    type: Object
  },
  workspacePane: {
    default: "preview",
    type: String
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
  runCommandAction,
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
const {
  fixDialogOpen,
  fixJob,
  fixTerminal,
  openFixCodexDialog
} = useVibe64FixCodexDialog();
const commandSpyExpanded = ref(false);
const sessionToolsMenuOpen = ref(false);
const rightPaneTab = ref("preview");
const workspacePaneIds = Object.freeze(["preview", "dashboard"]);
const sessionPaneIds = Object.freeze([
  "session-details",
  "diff",
  "shell",
  "ai-terminal"
]);

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
const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
const workspacePaneValue = computed(() => normalizeWorkspacePane(props.workspacePane));
const dashboardSessionContext = computed(() => ({
  copyText: typeof props.page?.copyText === "function" ? props.page.copyText : null,
  facts: vibe64SessionFacts(props.session || {}),
  session: props.session || null,
  sessionId: sessionId.value,
  statusColor: vibe64SessionStatusColor(props.session?.status),
  statusLabel: vibe64SessionStatusLabel(props.session?.status)
}));
const screenMessage = computed(() => String(screenState.value.message || ""));
const screenSections = computed(() => Array.isArray(screenState.value.sections) ? screenState.value.sections : []);
const primaryIntentId = computed(() => props.active ? String(screenState.value.primaryIntentId || "") : "");
const displayStatusText = computed(() => {
  if (stepInput.visible) {
    return stepInput.interaction?.title || screenState.value.title;
  }
  return screenState.value.title;
});
const displayRunning = computed(() => Boolean(
  screenState.value.showProgress &&
  screenKind.value !== "codex_running"
));
const commandTerminalFailed = computed(() => commandResult.value?.ok === false);
const commandTerminalVisible = computed(() => Boolean(screenKind.value === "command"));
const stepInputFormVisible = computed(() => Boolean(
  stepInput.visible &&
  !displayRunning.value
));
const stepInputHasWorkflowIntents = computed(() => Boolean(
  currentStepInputHasDecisionControls(props.session, stepInput.interaction)
));
const selectedStepInputControlVisible = computed(() => Boolean(
  props.active &&
  stepInputFormVisible.value &&
  selectedControl.value &&
  selectedControlFields.value.length
));
const selectedScreenControlVisible = computed(() => Boolean(
  props.active &&
  selectedControl.value
));
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
const commandTerminalSummary = computed(() => commandPreview.value || displayStatusText.value || "Running command.");
const commandTerminalText = computed(() => {
  const output = stripTerminalControlSequences(commandOutput.value);
  const resultOutput = stripTerminalControlSequences(commandResult.value?.output || "");
  const preview = stripTerminalControlSequences(commandPreview.value);
  return tailCommandText(output || resultOutput || preview || "Starting command...");
});
const autopilotBusy = computed(() => Boolean(props.active && (
  running.value ||
  displayRunning.value ||
  commandRunning.value ||
  stepInput.saving
)));
const navigationBusy = computed(() => Boolean(props.page?.busy || autopilotBusy.value || props.rewindBusy));
const workflowExecuting = computed(() => Boolean(
  props.codexThinking ||
  autopilotBusy.value ||
  commandRunning.value
));
const composerInputLocked = computed(() => Boolean(
  props.codexThinking ||
  running.value ||
  displayRunning.value ||
  commandRunning.value ||
  stepInput.saving ||
  props.page?.busy
));
const codexInterruptVisible = computed(() => Boolean(props.codexThinking));
const thinkingVisible = computed(() => Boolean(
  props.codexThinking ||
  running.value ||
  displayRunning.value ||
  commandRunning.value ||
  stepInput.saving
));
const sessionToolbarVisible = computed(() => Boolean(
  Array.isArray(props.sessionToolbar?.sessions) &&
  props.sessionToolbar.sessions.length
));
const sessionToolsVisible = computed(() => Boolean(props.session));
const sessionToolControls = computed(() => [
  {
    icon: mdiInformationOutline,
    id: "session-details",
    label: "Session",
    title: "Show active session details"
  },
  {
    disabled: props.review?.diffDisabled === true,
    icon: mdiFileCompare,
    id: "diff",
    label: "Diff",
    title: props.review?.diffTitle || "Review changes in the session worktree"
  },
  {
    icon: mdiConsoleLine,
    id: "shell",
    label: "Shell",
    title: "Open the session worktree terminal"
  },
  {
    icon: mdiRobotOutline,
    id: "ai-terminal",
    label: "AI Terminal",
    title: "Open the active session Codex terminal"
  }
]);
const activeSessionTool = computed(() => {
  return sessionToolControls.value.find((tool) => tool.id === rightPaneTab.value) || null;
});
const commandSpyVisible = computed(() => Boolean(
  commandTerminalVisible.value ||
  commandRunning.value ||
  commandTerminalFailed.value
));
const screenStopAction = computed(() => String(screenState.value.stopAction || ""));
const responsePreviewText = computed(() => String(props.humanInputResponsePreview?.text || ""));
const responsePreviewError = computed(() => String(props.humanInputResponsePreview?.error || ""));
const responsePreviewLoading = computed(() => Boolean(props.humanInputResponsePreview?.loading));
const reportPreviewVisible = computed(() => Boolean(sectionVisible("report_preview") && props.reportPreview?.visible));
const conversationLogVisible = computed(() => Boolean(
  sectionVisible("response_preview") &&
  props.conversationLog?.visible
));
const responsePreviewVisible = computed(() => Boolean(
  sectionVisible("response_preview") &&
  (
    responsePreviewText.value.trim() ||
    responsePreviewError.value ||
    responsePreviewLoading.value
  )
));
const chatTakeoverVisible = computed(() => Boolean(reportPreviewVisible.value));
const conversationLogReady = computed(() => Boolean(
  !props.conversationLog?.loading
));
const conversationHasTurns = computed(() => Boolean(
  Array.isArray(props.conversationLog?.turns) &&
  props.conversationLog.turns.length
));
const screenMessageIsGuidance = computed(() => String(screenState.value.variant || "") === "guide");
const guidanceScreenVisible = computed(() => Boolean(
  !chatTakeoverVisible.value &&
  screenMessageIsGuidance.value &&
  conversationLogReady.value &&
  !conversationHasTurns.value &&
  screenMessage.value &&
  !commandTerminalVisible.value
));
const guidanceActivityMessage = computed(() => {
  if (!guidanceScreenVisible.value) {
    return null;
  }
  if (screenKind.value === "work_source") {
    return activityMessage({
      appearance: "assistant",
      icon: mdiInformationOutline,
      id: "screen-guidance",
      label: "Vibe64",
      text: screenMessage.value
    });
  }
  return activityMessage({
    appearance: "assistant",
    icon: mdiRobotOutline,
    id: "screen-guidance",
    label: "Codex",
    text: screenMessage.value
  });
});
const responsePreviewActivityMessage = computed(() => {
  if (!responsePreviewVisible.value || conversationLogVisible.value) {
    return null;
  }
  return activityMessage({
    icon: mdiRobotOutline,
    id: "codex-response-preview",
    label: "Codex",
    loading: responsePreviewLoading.value,
    text: responsePreviewError.value || responsePreviewText.value || "Codex response is not ready yet.",
    tone: responsePreviewError.value ? "warning" : "info"
  });
});
const actionResultNoticeVisible = computed(() => Boolean(
  props.actions?.actionResultMessage
));
const actionResultType = computed(() => String(props.actions?.actionResultType || "info"));
const clientControlError = ref("");
const clientControlErrorVisible = computed(() => Boolean(clientControlError.value));
const statusActionsVisible = computed(() => Boolean(
  !chatTakeoverVisible.value &&
  (
    screenStopAction.value ||
    stuckRecoveryAvailable.value
  )
));
const composerVisible = computed(() => Boolean(
  !chatTakeoverVisible.value &&
  props.active &&
  props.session
));
const passiveComposerVisible = computed(() => Boolean(
  !stepInputFormVisible.value &&
  !selectedScreenControlVisible.value
));
const passiveComposerBusy = computed(() => Boolean(
  composerInputLocked.value ||
  thinkingVisible.value
));
const passiveComposerFields = computed(() => [
  {
    kind: "textarea",
    label: "What would you like to do?",
    name: "message",
    required: false,
    value: ""
  }
]);
const passiveComposerControl = computed(() => ({
  id: "passive_composer",
  inputFields: passiveComposerFields.value,
  label: "Send",
  style: "primary"
}));
const passiveComposerValues = computed(() => ({
  message: ""
}));
const chatActivityMessages = computed(() => [
  guidanceActivityMessage.value,
  responsePreviewActivityMessage.value
].filter(Boolean));
const chatTimelineVisible = computed(() => Boolean(!chatTakeoverVisible.value));
const runtimeNoticeMessages = computed(() => [
  actionResultNoticeVisible.value
    ? {
        icon: actionResultType.value === "success" ? mdiCheckCircleOutline : mdiAlertCircleOutline,
        id: "action-result",
        text: String(props.actions.actionResultMessage || ""),
        tone: ["success", "warning", "error"].includes(actionResultType.value) ? actionResultType.value : "info"
      }
    : null,
  clientControlErrorVisible.value
    ? {
        icon: mdiAlertCircleOutline,
        id: "client-control-error",
        text: clientControlError.value,
        tone: "warning"
      }
    : null
].filter(Boolean));
const runtimeStatusVisible = computed(() => Boolean(
  visibleBackgroundTasks.value.length ||
  backgroundTaskError.value ||
  runtimeNoticeMessages.value.length
));
const conversationScrollKey = computed(() => [
  sessionId.value,
  chatTimelineVisible.value ? "conversation-visible" : "conversation-hidden",
  selectedControl.value?.id || "",
  selectedControlFields.value.map((field) => field.name).join("|"),
  chatActivityMessages.value.map((message) => [
    message.id,
    message.appearance,
    message.loading ? "loading" : "ready",
    message.text,
    message.title
  ].join(":")).join("|")
].join(":"));
const allScreenControls = computed(() => {
  return currentStepWorkflowControls({
    actions: props.actions?.currentActions || [],
    interaction: stepInput.interaction,
    session: props.session
  });
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
  onRunControl: runWorkflowControl,
  primaryIntentId,
  running: composerInputLocked
});
const workflowButtonControls = computed(() => {
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
const activeComposerWorkflowControls = computed(() => (
  workflowButtonControls.value
));
const stepInputActionHandlers = computed(() => ({
  ...props.actions,
  runAction: runActionAfterStepInput
}));

function sectionVisible(kind = "") {
  return screenSections.value.some((section) => section?.kind === kind);
}

function activityMessage({
  appearance = "activity",
  icon = "",
  id = "",
  label = "Vibe64",
  loading = false,
  text = "",
  title = "",
  tone = "info"
} = {}) {
  const messageText = String(text || "").trim();
  const messageTitle = String(title || "").trim();
  if (!messageText && !messageTitle && loading !== true) {
    return null;
  }
  return {
    appearance,
    icon,
    id,
    label,
    loading: loading === true,
    text: messageText,
    title: messageTitle,
    tone
  };
}

function normalizeWorkspacePane(value = "") {
  return ["configure", "dashboard", "history", "preview", "run", "setup"].includes(value)
    ? value
    : "preview";
}

function rightPaneExists(tabId = "") {
  return workspacePaneIds.includes(tabId) || sessionPaneIds.includes(tabId);
}

function selectRightPaneTab(tabId = "") {
  if (!rightPaneExists(tabId)) {
    return;
  }
  rightPaneTab.value = tabId;
}

function selectSessionTool(tabId = "") {
  if (!sessionPaneIds.includes(tabId)) {
    return false;
  }
  rightPaneTab.value = tabId;
  if (tabId === "diff" && !props.diff?.payload && !props.diff?.loading && typeof props.diff?.load === "function") {
    void props.diff.load();
  }
  return true;
}

function selectSessionToolFromMenu(tabId = "") {
  if (selectSessionTool(tabId)) {
    sessionToolsMenuOpen.value = false;
  }
}

function emitBusyState() {
  emit("busy-change", autopilotBusy.value);
}

function submitStepInputForm() {
  if (selectedStepInputControlVisible.value) {
    submitSelectedWorkflowControl();
    return;
  }
  if (stepInputHasWorkflowIntents.value) {
    return;
  }
  submitStepInput();
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

async function saveCurrentStepInputForControl(control = {}) {
  if (
    !stepInputFormVisible.value ||
    !controlSavesCurrentStepInputBeforeRun(control)
  ) {
    return true;
  }
  return await stepInput.submit();
}

async function activateWorkflowButtonControl(control = {}) {
  if (await saveCurrentStepInputForControl(control) === false) {
    return false;
  }
  return activateControl(control);
}

async function submitSelectedWorkflowControl() {
  if (await saveCurrentStepInputForControl(selectedControl.value) === false) {
    return false;
  }
  return submitSelectedControl();
}

function submitPassiveComposer() {
  return false;
}

function updatePassiveComposer() {
  return false;
}

async function requestCodexInterrupt() {
  if (!codexInterruptVisible.value) {
    return false;
  }
  return await props.interruptCodexTurn();
}

async function runActionFromStepInput(action = {}) {
  return saveCurrentStepInputForControl(action);
}

async function runActionAfterStepInput(action = {}) {
  if (String(action.dispatchRoute || "") === ACTION_DISPATCH_ROUTES.COMMAND_TERMINAL) {
    return runCommandAction(action);
  }
  return props.actions.runAction(action);
}

async function runWorkflowControl(control = {}, options = {}) {
  const sourceAction = workflowControlSourceAction(control);
  if (!sourceAction) {
    return runPresentedIntent(control, options);
  }
  if (String(sourceAction.dispatchRoute || "") === ACTION_DISPATCH_ROUTES.COMMAND_TERMINAL) {
    return runCommandAction(sourceAction);
  }
  const fields = options?.fields && typeof options.fields === "object" && !Array.isArray(options.fields)
    ? options.fields
    : {};
  const response = await props.actions.runAction(sourceAction, {
    input: fields
  });
  await props.refreshSessionData();
  await nextTick();
  await runNextOperation();
  return response !== false;
}

async function retryFromCommandFailure() {
  if (stepInput.interaction?.kind === "command_failure_response" && stepInput.visible) {
    clearFailure({
      clearCommandResult: true
    });
    await stepInput.submit();
    return;
  }
  await retry();
}

async function requestCommandAiFix() {
  if (!commandTerminalFailed.value) {
    return;
  }
  openFixCodexDialog(await terminalFailureFixRequest({
    actionId: commandResult.value?.actionId || "",
    actionLabel: commandResult.value?.actionLabel || "",
    attemptedCommand: commandResult.value?.attemptedCommand || "",
    closeError: commandTerminalError.value,
    commandPreview: commandPreview.value,
    exitCode: commandResult.value?.exitCode ?? "",
    output: commandTerminalText.value,
    sessionId: sessionId.value,
    terminalKind: "command",
    terminalSessionId: commandResult.value?.terminalSessionId || "",
    terminalStatus: commandStatus.value
  }));
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
      openDiffPane: () => selectSessionTool("diff"),
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
    props.page.busy ||
    props.codexThinking ||
    running.value ||
    stepInput.saving ||
    control.enabled !== true ||
    controlStateActive(control, "disabledWhen")
  );
}

function controlLoading(control = {}) {
  const sourceAction = workflowControlSourceAction(control);
  if (sourceAction) {
    return Boolean(
      props.actions.runActionCommand?.isRunning &&
      props.actions.activeActionId === sourceAction.id
    );
  }
  return Boolean(running.value || stepInput.saving || controlStateActive(control, "loadingWhen"));
}

function controlIcon(control = {}) {
  const sourceAction = workflowControlSourceAction(control);
  if (sourceAction && typeof props.actions.actionIcon === "function") {
    return props.actions.actionIcon(sourceAction);
  }
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

watch(() => props.codexTerminalAttention, (needsAttention) => {
  if (needsAttention) {
    selectRightPaneTab("ai-terminal");
  }
}, {
  immediate: true
});

watch(workspacePaneValue, (pane) => {
  if (pane === "preview") {
    selectRightPaneTab("preview");
    return;
  }
  selectRightPaneTab("dashboard");
}, {
  immediate: true
});

</script>

<style scoped>
.studio-autopilot {
  background: rgb(var(--v-theme-background));
  display: grid;
  gap: 0.75rem;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__chat-panel,
.studio-autopilot__workspace-panel {
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
  gap: 0.16rem;
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
  overflow: visible;
  padding: 0.05rem 0.65rem 0.18rem;
}

.studio-autopilot__workspace-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
}

.studio-autopilot__session-header {
  display: grid;
  gap: 0.28rem;
  min-width: 0;
}

.studio-autopilot__chat-body {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-height: 0;
  overflow: hidden;
  padding-right: 0.1rem;
  scrollbar-gutter: stable;
}

.studio-autopilot__chat-body--artifact {
  align-content: stretch;
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
  min-height: min(16rem, 40vh);
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

.studio-autopilot__session-tools-button {
  height: 2rem;
  letter-spacing: 0;
  margin-left: auto;
  min-height: 2rem;
  min-width: 2rem;
  width: 2rem;
}

.studio-autopilot__session-tools-menu {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 8px;
  box-shadow: 0 0.75rem 1.5rem rgba(15, 23, 42, 0.14);
  display: grid;
  gap: 0.42rem;
  min-width: 13rem;
  padding: 0.55rem;
}

.studio-autopilot__session-tools-menu .studio-autopilot__session-tool {
  font-size: 0.96rem;
  min-height: 2.65rem;
  justify-content: start;
  width: 100%;
}

.studio-autopilot__session-tool {
  letter-spacing: 0;
  min-width: 0;
}

.studio-autopilot__actions {
  justify-content: flex-end;
}

.studio-autopilot__composer {
  align-content: end;
  display: grid;
  gap: 0.24rem;
  min-width: 0;
}

.studio-autopilot__input-form,
.studio-autopilot__control-form {
  display: grid;
  gap: 0.24rem;
  min-width: 0;
  width: 100%;
}

.studio-autopilot__input-form > .studio-autopilot__actions {
  background: rgb(var(--v-theme-surface));
  padding-block: 0.1rem 0;
}

.studio-autopilot__input {
  text-align: left;
  width: 100%;
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
  visibility: hidden;
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
  animation: studio-autopilot-thinking-pulse 1s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  box-shadow: 0 0 0 0.24rem rgba(var(--v-theme-primary), 0.12);
  height: 0.48rem;
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
  min-height: 0;
  min-width: 0;
  position: relative;
}

.studio-autopilot__dashboard-pane {
  align-content: start;
  gap: 0.75rem;
  overflow-y: auto;
  padding: 0.85rem;
  scrollbar-gutter: stable;
}

.studio-autopilot__preview-launch {
  height: 100%;
  min-height: 0;
}

.studio-autopilot__command-spy {
  background: rgba(var(--v-theme-surface), 0.96);
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 12px;
  box-shadow: 0 0.5rem 1.4rem rgba(15, 23, 42, 0.12);
  left: 0.75rem;
  padding: 0.55rem 0.65rem;
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  z-index: 4;
}

.studio-autopilot__command-spy--expanded {
  bottom: 0.75rem;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.studio-autopilot__command-spy-header {
  align-items: center;
  display: flex;
  gap: 0.65rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-autopilot__command-spy-title,
.studio-autopilot__command-spy-actions {
  align-items: center;
  display: flex;
  gap: 0.4rem;
  min-width: 0;
}

.studio-autopilot__command-spy-title {
  color: rgb(var(--v-theme-primary));
  font-weight: 720;
}

.studio-autopilot__command-spy-summary {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.82rem;
  line-height: 1.3;
  margin: 0.35rem 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-autopilot__command-terminal-output {
  height: 100%;
  margin-top: 0.5rem;
  min-height: 0;
  text-align: left;
}

.studio-autopilot__command-terminal-output :deep(.studio-headless-command-output__text) {
  border: 0;
  border-radius: 10px;
  min-height: 0;
}

@keyframes studio-autopilot-thinking-pulse {
  0%,
  100% {
    opacity: 0.46;
    transform: scale(0.88);
  }

  50% {
    opacity: 1;
    transform: scale(1.08);
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
  }

  .studio-autopilot__workspace-panel {
    display: none;
  }
}
</style>
