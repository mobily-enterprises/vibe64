<template>
  <v-sheet rounded="lg" class="studio-issue-sessions studio-screen__panel">
    <v-alert v-if="issueSessionsError" type="error" variant="tonal" class="mb-3">
      {{ issueSessionsError }}
    </v-alert>

    <div v-if="issueSessions.length || canCreateIssueSession" class="studio-issue-sessions__strip">
      <v-chip
        v-for="session in issueSessions"
        :key="session.sessionId"
        :color="session.sessionId === selectedSessionId ? 'primary' : 'default'"
        :variant="session.sessionId === selectedSessionId ? 'flat' : 'tonal'"
        class="studio-issue-sessions__tab studio-issue-sessions__tab-chip"
        size="large"
        @click="selectSession(session.sessionId)"
      >
        <span class="studio-issue-sessions__status-dot" :class="`studio-issue-sessions__status-dot--${session.status}`" />
        <span>{{ shortSessionId(session.sessionId) }}</span>
        <button
          v-if="canAbandonSessionFromChip(session)"
          aria-label="Abandon selected session"
          class="studio-issue-sessions__tab-close"
          type="button"
          @click.stop="requestAbandonSession(session)"
          @mousedown.stop
          @pointerdown.stop
        >
          <v-icon :icon="mdiClose" size="14" />
        </button>
      </v-chip>
      <v-chip
        v-if="canCreateIssueSession"
        color="primary"
        variant="tonal"
        :prepend-icon="mdiPlus"
        :disabled="issueSessionBusy"
        class="studio-issue-sessions__tab studio-issue-sessions__new-tab"
        :class="{ 'studio-issue-sessions__new-tab--busy': issueSessionBusy }"
        size="large"
        @click="createSession"
      >
        New Session
      </v-chip>
    </div>

    <v-sheet v-else-if="!issueSessionsLoading" rounded="lg" border class="studio-issue-sessions__empty">
      <p class="text-body-2 text-medium-emphasis mb-0">No sessions yet.</p>
    </v-sheet>

    <v-dialog v-model="abandonDialogOpen" max-width="30rem">
      <v-card>
        <v-card-title>Abandon session?</v-card-title>
        <v-card-text>
          This will abandon the selected session and close its Codex terminal.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelAbandonSession">Cancel</v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="issueSessionBusy"
            @click="confirmAbandonSession"
          >
            Abandon
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="diffDialogOpen" max-width="min(94vw, 72rem)">
      <v-card class="studio-issue-sessions__diff-dialog">
        <v-card-title class="studio-issue-sessions__diff-title">
          <span>Review changes</span>
          <v-chip
            v-if="diffPayload"
            :color="diffPayload.hasChanges ? 'primary' : 'default'"
            size="small"
            variant="tonal"
          >
            {{ diffPayload.hasChanges ? "Changes found" : "No changes" }}
          </v-chip>
        </v-card-title>
        <v-card-text
          ref="diffBodyElement"
          class="studio-issue-sessions__diff-body"
          @click="handleDiffBodyClick"
        >
          <v-alert v-if="diffError" type="error" variant="tonal" class="mb-3">
            {{ diffError }}
          </v-alert>
          <v-progress-linear v-if="diffLoading" color="primary" indeterminate class="mb-3" />
          <pre v-if="diffPayload?.gitStatus" class="studio-issue-sessions__diff-status">{{ diffPayload.gitStatus }}</pre>
          <!-- eslint-disable-next-line vue/no-v-html -- Diff2Html escapes git diff content before rendering. -->
          <div v-if="renderedDiff" class="studio-issue-sessions__diff-rendered" v-html="renderedDiff" />
          <v-alert v-else-if="!diffLoading && !diffError" type="info" variant="tonal">
            No diff is available for this session worktree.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeDiffDialog">Close</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!diffPayload?.hasChanges || diffLoading"
            :loading="issueSessionBusy"
            @click="acceptReviewedChanges"
          >
            {{ selectedStepAction?.buttonLabel || "Accept changes" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <div v-if="selectedSession" class="studio-issue-sessions__workspace">
      <section class="studio-issue-sessions__main">
        <div class="studio-issue-sessions__timeline">
          <div
            v-for="step in orderedStepDefinitions"
            :key="step.id"
            class="studio-issue-sessions__step"
            :class="[
              `studio-issue-sessions__step--${stepState(step)}`,
              {
                'studio-issue-sessions__step--repeatable': stepIsRepeatable(step),
                'studio-issue-sessions__step--repeatable-start': stepIsRepeatableGroupStart(step)
              }
            ]"
            :title="stepTitle(step)"
          >
            <div
              v-if="stepIsRepeatableGroupStart(step)"
              class="studio-issue-sessions__cycle-marker"
              :title="step.repeatableGroupLabel || step.repeatableLabel || 'Can repeat in a rework cycle'"
            >
              <v-icon :icon="mdiRepeat" size="12" />
              <span>{{ activeCycleLabel() }}</span>
            </div>
            <div class="studio-issue-sessions__step-icon">
              <v-icon :icon="stepIcon(step)" size="18" />
            </div>
            <div class="studio-issue-sessions__step-copy">
              <div class="studio-issue-sessions__step-title">
                <span>
                  {{ step.index + 1 }}.
                  {{ stepIsDone(step) ? "Done: " : "Goal: " }}{{ step.label }}
                </span>
                <v-btn
                  v-if="canExpandDoneStep(step)"
                  :icon="doneStepExpanded(step) ? mdiChevronUp : mdiChevronDown"
                  :title="doneStepExpanded(step) ? 'Collapse step details' : 'Expand step details'"
                  aria-label="Toggle completed step details"
                  class="studio-issue-sessions__done-toggle"
                  density="compact"
                  size="x-small"
                  variant="text"
                  @click.stop="toggleDoneStep(step)"
                />
                <v-chip
                  v-for="badge in stepBadges(step)"
                  :key="badge.label"
                  :color="badge.color"
                  :prepend-icon="badge.icon || undefined"
                  size="x-small"
                  :title="badge.title || undefined"
                  variant="tonal"
                >
                  {{ badge.label }}
                </v-chip>
              </div>
              <p
                v-if="stepDescriptionVisible(step)"
                class="studio-issue-sessions__step-description"
              >
                {{ activeStepDescription(step) }}
              </p>

              <div v-if="step.id === displayCurrentStepId" class="studio-issue-sessions__step-action">
                <v-alert
                  v-if="currentStepActionNotice"
                  :type="currentStepActionNotice.type"
                  density="compact"
                  variant="tonal"
                >
                  {{ currentStepActionNotice.text }}
                </v-alert>

                <v-textarea
                  v-if="selectedSession.prompt && !isCodexPromptInjection"
                  :model-value="selectedSession.prompt"
                  label="Prompt"
                  variant="outlined"
                  readonly
                  auto-grow
                  rows="7"
                  class="studio-issue-sessions__monospace"
                />

                <template v-if="isCodexOutputStep && codexOutputFormVisible">
                  <template
                    v-for="output in codexEditableOutputs"
                    :key="codexOutputDraftKeyFor(output)"
                  >
                    <v-select
                      v-if="codexOutputHasOptions(output)"
                      :model-value="codexOutputDraftValue(output)"
                      :items="codexOutputSelectItems(output)"
                      item-title="label"
                      item-value="value"
                      :label="codexOutputLabel(output)"
                      variant="outlined"
                      @update:model-value="setCodexOutputDraft(output, $event)"
                    />
                    <v-textarea
                      v-else-if="codexOutputIsMultiline(output)"
                      :model-value="codexOutputDraftValue(output)"
                      :label="codexOutputLabel(output)"
                      variant="outlined"
                      auto-grow
                      rows="7"
                      class="studio-issue-sessions__monospace"
                      @update:model-value="setCodexOutputDraft(output, $event)"
                    />
                    <v-text-field
                      v-else
                      :model-value="codexOutputDraftValue(output)"
                      :label="codexOutputLabel(output)"
                      variant="outlined"
                      @update:model-value="setCodexOutputDraft(output, $event)"
                    />
                  </template>
                </template>

                <p v-else-if="isCodexOutputStep" class="studio-issue-sessions__waiting text-caption mb-0">
                  {{ codexWaitingMessage }}
                </p>

                <v-textarea
                  v-else-if="isTextStep && selectedStepInput.multiline"
                  v-model="stepInputValues[selectedStepInput.name]"
                  :label="selectedStepInput.label"
                  :placeholder="selectedStepInput.placeholder || ''"
                  variant="outlined"
                  auto-grow
                  rows="4"
                />

                <v-text-field
                  v-else-if="isTextStep"
                  v-model="stepInputValues[selectedStepInput.name]"
                  :label="selectedStepInput.label"
                  :placeholder="selectedStepInput.placeholder || ''"
                  variant="outlined"
                />

                <div
                  v-if="exclusiveTextAlternateActions.length"
                  class="studio-issue-sessions__alternate-actions"
                >
                  <div
                    v-for="alternateAction in exclusiveTextAlternateActions"
                    :key="alternateActionKey(alternateAction)"
                    class="studio-issue-sessions__alternate-action"
                  >
                    <v-textarea
                      :model-value="alternateActionDraftValue(alternateAction)"
                      :label="alternateActionLabel(alternateAction)"
                      variant="outlined"
                      auto-grow
                      rows="3"
                      @update:model-value="setAlternateActionDraft(alternateAction, $event)"
                    />
                    <v-btn
                      color="primary"
                      variant="tonal"
                      :disabled="alternateActionDisabled(alternateAction)"
                      :loading="issueSessionBusy"
                      :prepend-icon="mdiSend"
                      @click="runAlternateAction(alternateAction)"
                    >
                      {{ alternateActionButtonLabel(alternateAction) }}
                    </v-btn>
                  </div>
                </div>

                <div v-else-if="isChoiceStep" class="studio-issue-sessions__choice-row">
                  <v-btn
                    v-for="option in selectedStepInput.options || []"
                    :key="option.value"
                    color="primary"
                    :loading="issueSessionBusy"
                    variant="tonal"
                    @click="runChoiceStep(option.value)"
                  >
                    {{ option.label }}
                  </v-btn>
                </div>

                <div v-else class="studio-issue-sessions__action-stack">
                  <div class="studio-issue-sessions__action-buttons">
                    <v-btn
                      v-if="showReviewDeslopResolveButton"
                      color="primary"
                      variant="tonal"
                      :disabled="!canRunReviewDeslopResolve"
                      :loading="issueSessionBusy"
                      :prepend-icon="mdiRobotOutline"
                      @click="resolveReviewDeslopFindings"
                    >
                      Ask to resolve
                    </v-btn>
                    <v-btn
                      v-if="showCodexPromptResendButton"
                      color="warning"
                      variant="tonal"
                      :disabled="selectedSessionTerminalBlocked || issueSessionBusy"
                      :prepend-icon="mdiSend"
                      @click="resendCurrentCodexPromptRequest"
                    >
                      {{ codexPromptResendButtonLabel }}
                    </v-btn>
                    <v-btn
                      v-if="hasManualCodexPromptAction && !activeStepControls.showExecuteStep"
                      color="primary"
                      variant="tonal"
                      :disabled="selectedSessionTerminalBlocked || issueSessionBusy"
                      :prepend-icon="mdiSend"
                      @click="requestCodexPromptInjection()"
                    >
                      {{ manualCodexPromptButtonLabel }}
                    </v-btn>
                    <v-btn
                      v-if="diffUtilityAction"
                      color="primary"
                      variant="tonal"
                      :disabled="issueSessionBusy"
                      :prepend-icon="mdiFileCompare"
                      @click="openDiffDialog"
                    >
                      {{ diffUtilityAction.label || "Review changes" }}
                    </v-btn>
                    <v-btn
                      v-if="activeStepControls.showExecuteStep"
                      color="primary"
                      variant="tonal"
                      :loading="issueSessionBusy"
                      :disabled="!activeStepControls.canExecuteStep"
                      :prepend-icon="mdiPlay"
                      @click="executeCurrentStep"
                    >
                      {{ executeStepButtonLabel }}
                    </v-btn>
                    <v-btn
                      v-if="activeStepControls.showFormSubmit"
                      color="primary"
                      variant="flat"
                      :loading="issueSessionBusy"
                      :disabled="!activeStepControls.canSubmitForm"
                      :prepend-icon="mdiPlay"
                      @click="submitCurrentForm"
                    >
                      {{ currentActionButtonLabel }}
                    </v-btn>
                    <v-btn
                      v-if="activeStepControls.showGoNext"
                      color="primary"
                      variant="flat"
                      :loading="issueSessionBusy"
                      :disabled="!activeStepControls.canGoNext"
                      :prepend-icon="mdiPlay"
                      @click="goToNextStep"
                    >
                      Go to next step
                    </v-btn>
                    <v-btn
                      v-if="selectedSession.prompt && !isCodexPromptInjection"
                      variant="tonal"
                      :prepend-icon="mdiContentCopy"
                      @click="copyText(selectedSession.prompt, 'Prompt')"
                    >
                      Copy Prompt
                    </v-btn>
                  </div>
                  <p
                    v-if="codexPromptStatusMessage"
                    class="text-caption text-medium-emphasis mb-0"
                  >
                    {{ codexPromptStatusMessage }}
                  </p>

                  <div
                    v-if="secondaryTextAlternateActions.length"
                    class="studio-issue-sessions__alternate-actions"
                  >
                    <div
                      v-for="alternateAction in secondaryTextAlternateActions"
                      :key="alternateActionKey(alternateAction)"
                      class="studio-issue-sessions__alternate-action studio-issue-sessions__alternate-action--secondary"
                    >
                      <div class="studio-issue-sessions__alternate-copy">
                        <strong>{{ alternateActionTitle(alternateAction) }}</strong>
                        <span>{{ alternateActionHelp(alternateAction) }}</span>
                      </div>
                      <v-textarea
                        :model-value="alternateActionDraftValue(alternateAction)"
                        :label="alternateActionLabel(alternateAction)"
                        :placeholder="alternateActionPlaceholder(alternateAction)"
                        variant="outlined"
                        auto-grow
                        rows="3"
                        @update:model-value="setAlternateActionDraft(alternateAction, $event)"
                      />
                      <v-btn
                        color="primary"
                        variant="tonal"
                        :disabled="alternateActionDisabled(alternateAction)"
                        :loading="issueSessionBusy"
                        :prepend-icon="mdiSend"
                        @click="runAlternateAction(alternateAction)"
                      >
                        {{ alternateActionButtonLabel(alternateAction) }}
                      </v-btn>
                    </div>
                  </div>
                </div>

                <p v-if="codexPromptRequestedMessage" class="text-caption text-medium-emphasis mb-0">
                  {{ codexPromptRequestedMessage }}
                </p>
                <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-0">{{ copyStatus }}</p>
              </div>
            </div>
          </div>
        </div>

        <v-alert
          v-for="error in selectedSession.errors || []"
          :key="error.code"
          type="error"
          variant="tonal"
          class="mb-2"
        >
          <strong>{{ error.code }}</strong>: {{ error.message }}
          <template v-if="error.repairCommand">
            <br>
            <code>{{ error.repairCommand }}</code>
          </template>
        </v-alert>
      </section>

      <aside class="studio-issue-sessions__side">
        <v-alert
          v-if="selectedSessionTerminalBlocked"
          type="warning"
          variant="tonal"
          density="compact"
        >
          Three active Codex terminals are already open. Finish or abandon one before opening another.
        </v-alert>

        <div class="studio-issue-sessions__terminal-stack">
          <IssueSessionStepTerminal
            v-if="selectedSessionNeedsSetupTerminal"
            :session="selectedSession"
            :visible="true"
            @finished="handleSessionStepTerminalFinished"
          />
          <CodexSessionTerminal
            v-for="terminalSession in terminalSessions"
            v-show="terminalSession.sessionId === selectedSessionId"
            :key="terminalSession.sessionId"
            :session="terminalSession"
            :auto-inject-prompt="shouldAutoInjectIssueSessionCodexPrompt(terminalSession)"
            :prompt-override="codexPromptOverrideForSession(terminalSession)"
            :prompt-injection-request-key="promptInjectionRequestKeyFor(terminalSession)"
            :show-prompt-action="!shouldUseManualIssueSessionCodexPrompt(terminalSession)"
            :visible="terminalSession.sessionId === selectedSessionId"
            @input="recordCodexTerminalInput(terminalSession.sessionId)"
            @output="recordCodexTerminalOutput(terminalSession.sessionId, $event)"
            @prompt-injected="recordCodexPromptInjected(terminalSession.sessionId, $event)"
            @session-update="applyIssueSessionUpdate"
          />
        </div>
      </aside>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import {
  mdiAlertCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiCheckCircle,
  mdiClose,
  mdiCircleOutline,
  mdiCircleSlice8,
  mdiContentCopy,
  mdiFileCompare,
  mdiPlay,
  mdiPlus,
  mdiRepeat,
  mdiRobotOutline,
  mdiSend
} from "@mdi/js";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";
import IssueSessionStepTerminal from "@/components/studio/IssueSessionStepTerminal.vue";
import { useIssueSessions } from "@/composables/useIssueSessions.js";
import {
  extractMarkedOutputDetails,
  outputAfterPromptStart
} from "@/lib/codexOutput.js";
import { createCodexCompletionWatcher } from "@/lib/codexCompletionWatcher.js";
import {
  buildResolveDeslopFindingsPrompt,
  deslopFindingsByPriority,
  parseDeslopResult
} from "@/lib/deslopResult.js";
import { readIssueSessionDiff } from "@/lib/studioApi.js";
import {
  canUseIssueSessionTerminal,
  isAbandonedIssueSession,
  isClosedIssueSession,
  isOpenIssueSession,
  issueSessionCodexExpectedOutputs,
  issueSessionCodexPromptActionLabel,
  shouldAutoInjectIssueSessionCodexPrompt,
  shouldUseManualIssueSessionCodexPrompt,
  shortIssueSessionId
} from "@/lib/issueSessionViewModel.js";
import { buildActiveStepControls } from "@/lib/issueSessionStepControls.js";

const copyStatus = ref("");
const codexTerminalOutputBySessionId = ref({});
const codexOutputDraftByKey = ref({});
const codexOutputSourceByKey = ref({});
const expandedDoneStepIds = ref({});
const abandonDialogOpen = ref(false);
const abandonSessionId = ref("");
const diffDialogOpen = ref(false);
const diffError = ref("");
const diffLoading = ref(false);
const diffPayload = ref(null);
const diffBodyElement = ref(null);
const terminalSessionById = ref({});
const promptInjectionRequestBySessionId = ref({});
const promptInjectionSignatureBySessionId = ref({});
const promptInjectionOutputStartBySignature = ref({});
const promptInjectionOutputSnapshotBySignature = ref({});
const promptInjectionTextBySignature = ref({});
const codexCompletionBySignature = ref({});
const codexPromptOverrideBySessionId = ref({});
const deslopAutomationBySessionId = ref({});
const codexPromptResultBySignature = ref({});
const alternateActionInputValues = ref({});
const autoSkippedStepKeys = ref({});
const autoRanImmediateStepKeys = ref({});
const autoStartedCodexOutputStepKeys = ref({});
const autoStartedCodexPromptStepKeys = ref({});
const autoAdvancedCodexPromptBySignature = ref({});
const autoStepStartSuppressedSessionId = ref("");
const codexCompletionWatchersBySignature = new Map();

const {
  abandonSelectedSession,
  canCreateIssueSession,
  createSession,
  isChoiceStep,
  isTextStep,
  issueSessionBusy,
  issueSessions,
  issueSessionsError,
  issueSessionsLoading,
  loadIssueSessions,
  maxOpenIssueSessions,
  runSelectedStep,
  patchIssueSession,
  selectSession,
  selectedSession,
  selectedSessionId,
  selectedStepAction,
  selectedStepInput,
  stepDefinitions,
  stepInputValues
} = useIssueSessions();

const REVIEW_DESLOP_STEP_IDS = Object.freeze([
  "review_prompt_rendered",
  "review_changes_accepted"
]);
const AUTO_START_CODEX_PROMPT_STEP_IDS = new Set([
  "plan_executed",
  "deep_ui_check_run",
  "review_prompt_rendered",
  "automated_checks_run",
  "blueprint_updated"
]);
const AUTO_ADVANCE_CODEX_PROMPT_STEP_IDS = new Set([
  "plan_executed",
  "deep_ui_check_run",
  "automated_checks_run",
  "blueprint_updated"
]);
const REVIEW_DESLOP_MORE_FINDINGS = "Run another review/deslop pass. Ask the user which important findings they want fixed before editing, then fix only the findings the user selects.";
const ISSUE_DETAILS_CONVERSATION_READY_MARKER = "issue_details_conversation_ready";
const DESLOP_RESULT_MARKER = "deslop_result";

const orderedStepDefinitions = computed(() => {
  return groupedStepDefinitions(stepDefinitions.value || []);
});

const completedStepIds = computed(() => new Set(selectedSession.value?.completedSteps || []));

const displayStepIdBySourceStepId = computed(() => {
  return Object.fromEntries(orderedStepDefinitions.value.flatMap((step) => {
    return stepSourceIds(step).map((stepId) => [stepId, step.id]);
  }));
});

const firstRepeatableStepId = computed(() => {
  return orderedStepDefinitions.value.find((step) => stepIsRepeatable(step))?.id || "";
});

const isTerminalSession = computed(() => {
  return isClosedIssueSession(selectedSession.value);
});

const openTerminalSessionCount = computed(() => {
  return Object.values(terminalSessionById.value).filter(isOpenIssueSession).length;
});

const selectedTerminalIsOpen = computed(() => {
  return Boolean(selectedSessionId.value && terminalSessionById.value[selectedSessionId.value]);
});

const selectedSessionTerminalBlocked = computed(() => {
  return Boolean(
    canUseIssueSessionTerminal(selectedSession.value) &&
    !selectedTerminalIsOpen.value &&
    openTerminalSessionCount.value >= maxOpenIssueSessions.value
  );
});

const selectedSessionNeedsSetupTerminal = computed(() => {
  return selectedSession.value?.currentStep === "dependencies_installed";
});

const displayCurrentStepId = computed(() => {
  return displayStepIdFor(selectedSession.value?.currentStep || "");
});

const hasCodexPromptHandoff = computed(() => {
  return selectedSession.value?.codex?.mode === "inject_prompt";
});

const isCodexPromptInjection = computed(() => {
  return hasCodexPromptHandoff.value && Boolean(selectedSession.value?.prompt);
});

const codexExpectedOutputs = computed(() => {
  return issueSessionCodexExpectedOutputs(selectedSession.value || {});
});

const isCodexOutputStep = computed(() => {
  return selectedStepAction.value?.kind === "codex_output" &&
    hasCodexPromptHandoff.value &&
    codexEditableOutputs.value.length > 0;
});

const hasManualCodexPromptAction = computed(() => {
  return shouldUseManualIssueSessionCodexPrompt(selectedSession.value || {}) &&
    !selectedCodexPromptAlreadyRequested.value &&
    !codexOutputFormVisible.value;
});

const manualCodexPromptButtonLabel = computed(() => {
  if (selectedSession.value?.currentStep === "issue_drafted") {
    return "Get Codex to create issue text";
  }
  if (selectedSession.value?.currentStep === "plan_made") {
    const label = issueSessionCodexPromptActionLabel(selectedSession.value || {});
    return label === "Submit prompt to Codex" ? "Get Codex to create plan" : label;
  }
  return issueSessionCodexPromptActionLabel(selectedSession.value || {});
});

const isReviewDeslopStep = computed(() => {
  return REVIEW_DESLOP_STEP_IDS.includes(selectedSession.value?.currentStep || "");
});

const selectedDeslopAutomation = computed(() => {
  return deslopAutomationBySessionId.value[selectedSessionId.value || ""] || null;
});

const reviewDeslopFindings = computed(() => {
  return Array.isArray(selectedDeslopAutomation.value?.findings)
    ? selectedDeslopAutomation.value.findings
    : [];
});

const reviewDeslopNeedsUserDecision = computed(() => {
  return selectedSession.value?.currentStep === "review_changes_accepted" &&
    selectedDeslopAutomation.value?.status === "awaiting_user";
});

const activeStepCodexWorking = computed(() => {
  return selectedCodexCompletion.value?.status === "waiting";
});

const showReviewDeslopResolveButton = computed(() => {
  if (!isReviewDeslopStep.value || activeStepCodexWorking.value) {
    return false;
  }
  return reviewDeslopNeedsUserDecision.value &&
    reviewDeslopFindings.value.length > 0;
});

const canRunReviewDeslopResolve = computed(() => {
  if (!showReviewDeslopResolveButton.value || issueSessionBusy.value || selectedSessionTerminalBlocked.value) {
    return false;
  }
  return reviewDeslopNeedsUserDecision.value && reviewDeslopFindings.value.length > 0;
});

const reviewDeslopStatusMessage = computed(() => {
  if (!isReviewDeslopStep.value) {
    return "";
  }
  const status = selectedDeslopAutomation.value?.status || "";
  if (activeStepCodexWorking.value) {
    return "Waiting for Codex deslop findings.";
  }
  if (status === "reviewing") {
    return "Codex is idle. Continue the review/deslop loop or go to the next step.";
  }
  if (status === "resolving_auto") {
    return "Codex is resolving high and medium deslop findings.";
  }
  if (status === "resolving_user") {
    return "Codex is resolving the findings you selected.";
  }
  if (status === "waiting_for_summary") {
    return "Codex finished without a parseable deslop summary.";
  }
  if (status === "awaiting_user") {
    if (!reviewDeslopFindings.value.length) {
      return "No deslop findings remain.";
    }
    return "Only low-priority deslop findings remain. Choose whether Codex should resolve them.";
  }
  if (selectedCodexCompletion.value?.status === "interrupted") {
    return "Codex reported Conversation interrupted. Continue in the terminal when ready.";
  }
  return "";
});

const autoAdvancePromptStepStatusMessage = computed(() => {
  if (!selectedCodexPromptAutoAdvances.value) {
    return "";
  }
  if (selectedCodexPromptResult.value?.status === "missing_summary") {
    return "Codex finished without the required step completion block.";
  }
  if (selectedCodexCompletion.value?.status === "interrupted") {
    return "Codex reported Conversation interrupted. Continue in the terminal, or go to the next step manually.";
  }
  if (selectedCodexPromptAlreadyRequested.value) {
    return "Waiting for Codex to finish.";
  }
  return "";
});

const codexPromptStatusMessage = computed(() => {
  return reviewDeslopStatusMessage.value || autoAdvancePromptStepStatusMessage.value;
});

const selectedCodexPromptResult = computed(() => {
  const signature = selectedActivePromptSignature.value || "";
  return signature ? codexPromptResultBySignature.value[signature] || null : null;
});

const showCodexPromptResendButton = computed(() => {
  if (selectedSessionTerminalBlocked.value) {
    return false;
  }
  if (isReviewDeslopStep.value) {
    return selectedDeslopAutomation.value?.status === "waiting_for_summary" ||
      selectedCodexCompletion.value?.status === "interrupted";
  }
  return selectedCodexPromptResult.value?.status === "missing_summary";
});

const codexPromptResendButtonLabel = computed(() => {
  if (isReviewDeslopStep.value) {
    return "Resend deslop request";
  }
  const label = issueSessionCodexPromptActionLabel(selectedSession.value || {});
  const action = label.replace(/^Get Codex to\s+/iu, "").replace(/^Run\s+/iu, "").trim();
  return `Resend ${action || "Codex"} request`;
});

const diffUtilityAction = computed(() => {
  if (isReviewDeslopStep.value || selectedCodexPromptAutoAdvances.value || selectedCodexPromptAutoStarts.value) {
    return null;
  }
  const actions = selectedStepAction.value?.utilityActions || [];
  return actions.find((action) => action?.kind === "diff") || null;
});

const activeAlternateActions = computed(() => {
  const actions = selectedStepAction.value?.alternateActions || [];
  const errorCodes = new Set((selectedSession.value?.errors || []).map((error) => error?.code).filter(Boolean));
  return actions.filter((action) => {
    const requiredErrorCode = String(action?.requiredErrorCode || "").trim();
    return !requiredErrorCode || errorCodes.has(requiredErrorCode);
  });
});

const activeTextAlternateActions = computed(() => {
  return activeAlternateActions.value.filter((action) => {
    return action?.input?.type === "text" && action.input.name;
  });
});

const exclusiveTextAlternateActions = computed(() => {
  return activeTextAlternateActions.value.filter((action) => action.presentation === "exclusive");
});

const secondaryTextAlternateActions = computed(() => {
  return activeTextAlternateActions.value.filter((action) => {
    return action.presentation !== "exclusive" && action.id !== "request_another_review_pass";
  });
});

const combinedDiff = computed(() => {
  const payload = diffPayload.value || {};
  return [payload.stagedDiff, payload.unstagedDiff, payload.untrackedDiff]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join("\n");
});

const renderedDiff = computed(() => {
  if (!combinedDiff.value) {
    return "";
  }
  return renderDiffHtml(combinedDiff.value, {
    drawFileList: true,
    matching: "lines",
    outputFormat: "side-by-side"
  });
});

const codexInputFieldsByName = computed(() => {
  const input = selectedStepInput.value || {};
  const fields = Array.isArray(input.fields) ? input.fields : [];
  return Object.fromEntries(fields.map((field) => [field.name, field]));
});

const codexEditableOutputs = computed(() => {
  return codexExpectedOutputs.value.map((output) => {
    const inputField = codexInputFieldsByName.value[output.field] || {};
    return {
      ...inputField,
      ...output,
      field: output.field,
      required: output.required !== false && inputField.required !== false
    };
  });
});

const hasAnyEditableCodexOutput = computed(() => {
  return codexEditableOutputs.value.some((output) => codexOutputDraftValue(output).trim());
});

const hasCodexOutputDraftEntry = computed(() => {
  return codexEditableOutputs.value.some((output) => {
    const key = codexOutputDraftKeyFor(output);
    return key && Object.prototype.hasOwnProperty.call(codexOutputDraftByKey.value, key);
  });
});

const codexOutputFormVisible = computed(() => {
  return hasAnyEditableCodexOutput.value || hasCodexOutputDraftEntry.value;
});

const selectedCodexPromptRequestSignature = computed(() => {
  return codexPromptRequestSignature(selectedSession.value || {});
});

const selectedCodexPromptAlreadyRequested = computed(() => {
  const sessionId = selectedSessionId.value || "";
  const signature = selectedCodexPromptRequestSignature.value;
  return Boolean(
    sessionId &&
    signature &&
    promptInjectionSignatureBySessionId.value[sessionId] === signature
  );
});

const selectedActivePromptSignature = computed(() => {
  return promptInjectionSignatureBySessionId.value[selectedSessionId.value || ""] ||
    selectedCodexPromptRequestSignature.value;
});

const selectedCodexCompletion = computed(() => {
  const signature = selectedActivePromptSignature.value;
  return signature ? codexCompletionBySignature.value[signature] || null : null;
});

const selectedCodexPromptAutoAdvances = computed(() => {
  return AUTO_ADVANCE_CODEX_PROMPT_STEP_IDS.has(selectedSession.value?.currentStep || "") &&
    selectedStepAction.value?.kind === "codex_prompt" &&
    Boolean(selectedCodexPromptRequestSignature.value);
});

const selectedCodexPromptAutoStarts = computed(() => {
  return AUTO_START_CODEX_PROMPT_STEP_IDS.has(selectedSession.value?.currentStep || "") &&
    selectedStepAction.value?.kind === "codex_prompt" &&
    !selectedSession.value?.prompt;
});

const selectedStepNeedsCodexOutputPrompt = computed(() => {
  return isCodexOutputStep.value &&
    !selectedSession.value?.prompt &&
    !hasAnyEditableCodexOutput.value;
});

const requiredCodexOutputsFilled = computed(() => {
  const requiredOutputs = codexEditableOutputs.value.filter((output) => output.required !== false);
  return requiredOutputs.length > 0 &&
    requiredOutputs.every((output) => Boolean(codexOutputDraftValue(output).trim()));
});

const codexWaitingMessage = computed(() => {
  if (selectedCodexPromptAlreadyRequested.value) {
    if (
      selectedSession.value?.currentStep === "issue_details_gathered" &&
      issueDetailsConversationReady.value
    ) {
      return "Please respond and finalise things with Codex";
    }
    const labels = codexEditableOutputs.value
      .map((output) => String(output.label || output.field || "output").trim().toLowerCase())
      .filter(Boolean);
    return `Waiting for Codex ${labels.length ? labels.join(" and ") : "output"}.`;
  }
  if (selectedStepNeedsCodexOutputPrompt.value && selectedSession.value?.currentStep === "plan_made") {
    if (String(selectedSession.value?.activeCycle || "001") !== "001") {
      return "Codex will create a revised implementation plan based on the rework notes.";
    }
    return "Codex will create an implementation plan based on the issue.";
  }
  if (selectedStepNeedsCodexOutputPrompt.value) {
    if (selectedSession.value?.currentStep === "issue_details_gathered") {
      return "Codex will gather issue details and classify the issue.";
    }
    return "Run this step to ask Codex for the required output.";
  }
  if (selectedSession.value?.currentStep === "issue_drafted") {
    return "Codex will create a comprehensive issue.";
  }
  const labels = codexEditableOutputs.value
    .map((output) => String(output.label || output.field || "output").trim().toLowerCase())
    .filter(Boolean);
  return `Waiting for Codex ${labels.length ? labels.join(" and ") : "output"}.`;
});

const codexPromptRequestedMessage = computed(() => {
  if (!selectedCodexPromptAlreadyRequested.value || codexOutputFormVisible.value) {
    return "";
  }
  if (
    selectedSession.value?.currentStep === "issue_details_gathered" &&
    issueDetailsConversationReady.value
  ) {
    return "";
  }
  if (selectedCodexCompletion.value?.status === "interrupted") {
    return "Codex reported Conversation interrupted. Continue in the terminal when ready.";
  }
  if (selectedCodexCompletion.value?.status === "finished") {
    return `${manualCodexPromptButtonLabel.value} finished.`;
  }
  return `${manualCodexPromptButtonLabel.value} requested.`;
});

const extractedCodexOutputEntries = computed(() => {
  return codexEditableOutputs.value.map((output) => {
    const extracted = extractMarkedOutputDetails(selectedCodexTerminalOutputForExtraction.value, output.extract, {
      formatHint: output.formatHint,
      singleLine: !codexOutputIsMultiline(output)
    });
    const stored = storedCodexOutputDetails(output);
    const source = extracted.value ? extracted : stored;
    return {
      key: codexOutputDraftKeyFor(output),
      signature: source.signature,
      value: source.value
    };
  });
});

const issueDetailsConversationReady = computed(() => {
  if (selectedSession.value?.currentStep !== "issue_details_gathered") {
    return false;
  }
  return Boolean(
    extractMarkedOutputDetails(
      selectedCodexTerminalOutputForExtraction.value,
      ISSUE_DETAILS_CONVERSATION_READY_MARKER,
      {
        formatHint: "text",
        singleLine: true
      }
    ).value.trim()
  );
});

function codexOutputDraftKeyFor(output = {}) {
  const sessionId = selectedSessionId.value || "";
  const stepId = selectedSession.value?.currentStep || "";
  const activeCycle = String(selectedSession.value?.activeCycle || "001").trim() || "001";
  const field = String(output.field || "").trim();
  const extract = String(output.extract || "").trim();
  const promptSignature = codexPromptRequestSignature(selectedSession.value || {}) || "no-prompt";
  return sessionId && stepId && field ? `${sessionId}:${stepId}:${activeCycle}:${field}:${extract}:${promptSignature}` : "";
}

function storedCodexOutputDetails(output = {}) {
  const value = storedCodexOutputValue(output);
  if (!value) {
    return {
      signature: "",
      value: ""
    };
  }
  const stepId = selectedSession.value?.currentStep || "";
  const activeCycle = String(selectedSession.value?.activeCycle || "001").trim() || "001";
  const extract = String(output.extract || "").trim();
  return {
    signature: `stored:${stepId}:${activeCycle}:${extract}:${textHash(value)}`,
    value
  };
}

function storedCodexOutputValue(output = {}) {
  const session = selectedSession.value || {};
  const extract = String(output.extract || "").trim();
  if (session.currentStep === "issue_drafted" && extract === "issue_title") {
    return String(session.issueTitle || "").trim();
  }
  if (session.currentStep === "issue_drafted" && extract === "issue_text") {
    return String(session.issueText || "").trim();
  }
  if (session.currentStep === "issue_details_gathered" && extract === "issue_category") {
    return String(session.issueCategory || "").trim();
  }
  if (session.currentStep === "issue_details_gathered" && extract === "ui_impact") {
    return String(session.uiImpact || "").trim();
  }
  if (session.currentStep === "issue_details_gathered" && extract === "issue_details") {
    return String(session.issueDetails || "").trim();
  }
  if (session.currentStep === "plan_made" && extract === "plan") {
    return String(session.planText || "").trim();
  }
  return "";
}

function codexOutputDraftValue(output = {}) {
  const key = codexOutputDraftKeyFor(output);
  return key ? codexOutputDraftByKey.value[key] || "" : "";
}

function setCodexOutputDraft(output = {}, value = "") {
  const key = codexOutputDraftKeyFor(output);
  if (!key) {
    return;
  }
  codexOutputDraftByKey.value = {
    ...codexOutputDraftByKey.value,
    [key]: String(value || "")
  };
}

const selectedCodexTerminalOutput = computed(() => {
  return codexTerminalOutputBySessionId.value[selectedSessionId.value] || "";
});

const selectedCodexTerminalOutputForExtraction = computed(() => {
  const session = selectedSession.value || {};
  const output = selectedCodexTerminalOutput.value;
  const signature = codexPromptRequestSignature(session);
  if (!output || !signature) {
    return "";
  }

  return outputAfterPromptStart({
    output,
    prompt: codexPromptTextForSession(session),
    promptOutputSnapshot: promptInjectionOutputSnapshotBySignature.value[signature],
    promptStart: promptInjectionOutputStartBySignature.value[signature]
  });
});

const terminalSessions = computed(() => {
  const listedSessionIds = (issueSessions.value || []).map((session) => session.sessionId);
  const orderedSessionIds = [...new Set([
    ...listedSessionIds,
    ...(
      selectedSessionId.value && !listedSessionIds.includes(selectedSessionId.value)
        ? [selectedSessionId.value]
        : []
    ),
    ...Object.keys(terminalSessionById.value).filter((sessionId) => !listedSessionIds.includes(sessionId))
  ])];
  return orderedSessionIds
    .map((sessionId) => {
      if (sessionId === selectedSessionId.value && selectedSession.value?.sessionId === sessionId) {
        return {
          ...(terminalSessionById.value[sessionId] || {}),
          ...selectedSession.value
        };
      }
      return terminalSessionById.value[sessionId];
    })
    .filter(canDisplayTerminalSession);
});

const canRunAction = computed(() => {
  if (!selectedStepAction.value || isTerminalSession.value || issueSessionBusy.value) {
    return false;
  }
  if (selectedSessionNeedsSetupTerminal.value) {
    return false;
  }
  if (isCodexOutputStep.value) {
    if (selectedStepNeedsCodexOutputPrompt.value) {
      return true;
    }
    return requiredCodexOutputsFilled.value;
  }
  const input = selectedStepInput.value || {};
  if (input.required && input.name) {
    return Boolean(String(stepInputValues.value[input.name] || "").trim());
  }
  return true;
});

// One place owns active-step controls: forms submit data, prompt/automatic steps execute, finished non-form steps advance.
const activeStepControls = computed(() => {
  return buildActiveStepControls({
    actionKind: selectedStepAction.value?.kind || "",
    busy: issueSessionBusy.value,
    canRunAction: canRunAction.value,
    codexOutputFormVisible: codexOutputFormVisible.value,
    codexPromptAlreadyRequested: selectedCodexPromptAlreadyRequested.value,
    codexPromptInjectionReady: isCodexPromptInjection.value,
    codexWorking: activeStepCodexWorking.value,
    hasChoiceForm: isChoiceStep.value,
    hasExclusiveTextAlternateAction: exclusiveTextAlternateActions.value.length > 0,
    hasTextForm: isTextStep.value,
    isCodexOutputStep: isCodexOutputStep.value,
    isTerminalSession: isTerminalSession.value,
    selectedSessionId: selectedSession.value?.sessionId || "",
    selectedSessionNeedsSetupTerminal: selectedSessionNeedsSetupTerminal.value,
    selectedStepInputType: selectedStepInput.value?.type || "none",
    selectedStepNeedsCodexOutputPrompt: selectedStepNeedsCodexOutputPrompt.value,
    terminalBlocked: selectedSessionTerminalBlocked.value
  });
});

const currentActionButtonLabel = computed(() => {
  if (selectedSessionNeedsSetupTerminal.value) {
    return "Installing dependencies";
  }
  if (selectedStepNeedsCodexOutputPrompt.value) {
    return manualCodexPromptButtonLabel.value;
  }
  if (isCodexOutputStep.value) {
    return selectedStepAction.value?.label || selectedStepAction.value?.buttonLabel || "Done";
  }
  return selectedStepAction.value?.label || selectedStepAction.value?.buttonLabel || "Run Step";
});

const executeStepButtonLabel = computed(() => {
  if (selectedSession.value?.currentStep === "pr_finalized") {
    return currentActionButtonLabel.value || "Merge PR";
  }
  return "Execute step";
});

function shortSessionId(sessionId) {
  return shortIssueSessionId(sessionId);
}

function codexOutputLabel(output = {}) {
  const label = String(output.label || output.field || "Codex output").trim();
  return `${label} from Codex`;
}

function codexOutputSelectItems(output = {}) {
  const options = Array.isArray(output.options) ? output.options : [];
  return options.map((option) => {
    if (option && typeof option === "object" && !Array.isArray(option)) {
      return {
        label: String(option.label || option.value || "").trim(),
        value: String(option.value || option.label || "").trim()
      };
    }
    const value = String(option || "").trim();
    return {
      label: value,
      value
    };
  }).filter((option) => option.value);
}

function codexOutputHasOptions(output = {}) {
  return codexOutputSelectItems(output).length > 0;
}

function codexOutputIsMultiline(output = {}) {
  return output.multiline === true || output.formatHint === "markdown";
}

function alternateActionKey(action = {}) {
  return [
    selectedSessionId.value || "",
    selectedSession.value?.currentStep || "",
    action.id || "",
    action.input?.name || ""
  ].join(":");
}

function alternateActionDraftValue(action = {}) {
  const key = alternateActionKey(action);
  return key ? alternateActionInputValues.value[key] || "" : "";
}

function setAlternateActionDraft(action = {}, value = "") {
  const key = alternateActionKey(action);
  if (!key) {
    return;
  }
  alternateActionInputValues.value = {
    ...alternateActionInputValues.value,
    [key]: String(value || "")
  };
}

function alternateActionLabel(action = {}) {
  return String(action.input?.label || action.label || "Additional input").trim();
}

function alternateActionTitle(action = {}) {
  if (action.id === "request_another_review_pass") {
    return "Need another review pass?";
  }
  if (action.id === "close_without_merge") {
    return "Finish without merging?";
  }
  return String(action.title || action.label || "Optional path").trim();
}

function alternateActionHelp(action = {}) {
  if (action.id === "request_another_review_pass") {
    return "Use this only when important review findings remain. Studio will record these notes and loop back to Codex review.";
  }
  if (action.id === "close_without_merge") {
    return "Leave the PR open, record the reason, and remove the session worktree without merging.";
  }
  return String(action.helpText || "Provide the extra context required for this alternate path.").trim();
}

function alternateActionPlaceholder(action = {}) {
  if (action.id === "request_another_review_pass") {
    return "List the specific findings Codex still needs to address.";
  }
  return String(action.input?.placeholder || "").trim();
}

function alternateActionButtonLabel(action = {}) {
  return String(action.label || action.buttonLabel || "Run action").trim();
}

function alternateActionDisabled(action = {}) {
  const value = alternateActionDraftValue(action).trim();
  return issueSessionBusy.value || (action.input?.required !== false && !value);
}

function alternateActionPayload(action = {}) {
  const submitOptions = action.submitOptions && typeof action.submitOptions === "object"
    ? action.submitOptions
    : {};
  const inputName = String(action.input?.name || "").trim();
  const value = alternateActionDraftValue(action).trim();
  return {
    ...submitOptions,
    ...(inputName ? { [inputName]: value } : {})
  };
}

function clearAlternateActionDraft(action = {}) {
  const key = alternateActionKey(action);
  if (!key || !Object.prototype.hasOwnProperty.call(alternateActionInputValues.value, key)) {
    return;
  }
  const {
    [key]: _cleared,
    ...remainingValues
  } = alternateActionInputValues.value;
  alternateActionInputValues.value = remainingValues;
}

function terminalLimitReachedFor(sessionId) {
  return !terminalSessionById.value[sessionId] && openTerminalSessionCount.value >= maxOpenIssueSessions.value;
}

function canDisplayTerminalSession(session = {}) {
  const sessionId = session?.sessionId || "";
  if (!sessionId || !canUseIssueSessionTerminal(session)) {
    return false;
  }
  return Boolean(terminalSessionById.value[sessionId]) ||
    (sessionId === selectedSessionId.value && !terminalLimitReachedFor(sessionId));
}

function promptInjectionRequestKeyFor(session = {}) {
  return promptInjectionRequestBySessionId.value[session?.sessionId || ""] || "";
}

function codexPromptOverrideForSession(session = {}) {
  return codexPromptOverrideBySessionId.value[session?.sessionId || ""] || "";
}

function codexPromptTextForSession(session = {}) {
  const promptField = String(session?.codex?.promptField || "");
  return promptField ? String(session?.[promptField] || "") : "";
}

function textHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function codexPromptRequestSignature(session = {}) {
  const prompt = codexPromptTextForSession(session);
  if (!session?.sessionId || !prompt) {
    return "";
  }
  return [
    session.sessionId,
    session.currentStep || "",
    textHash(prompt),
    prompt.length
  ].join(":");
}

function reviewDeslopTerminalWatchSignature(session = {}) {
  if (!session?.sessionId || !REVIEW_DESLOP_STEP_IDS.includes(session.currentStep || "")) {
    return "";
  }
  return [
    session.sessionId,
    session.currentStep || "",
    session.currentReviewPass || "",
    "terminal"
  ].join(":");
}

function rememberCodexCompletionState(signature, state = {}) {
  if (!signature) {
    return;
  }
  codexCompletionBySignature.value = {
    ...codexCompletionBySignature.value,
    [signature]: state
  };
}

function codexCompletionWatcherFor(signature) {
  if (!signature) {
    return null;
  }
  if (!codexCompletionWatchersBySignature.has(signature)) {
    codexCompletionWatchersBySignature.set(signature, createCodexCompletionWatcher({
      onChange: (state) => rememberCodexCompletionState(signature, state)
    }));
  }
  return codexCompletionWatchersBySignature.get(signature);
}

function ensureReviewDeslopTerminalWatch(sessionId, {
  output = null,
  outputStart = null
} = {}) {
  const session = selectedSession.value || {};
  if (
    !sessionId ||
    sessionId !== selectedSessionId.value ||
    session.sessionId !== sessionId ||
    !isReviewDeslopStep.value ||
    promptInjectionSignatureBySessionId.value[sessionId]
  ) {
    return promptInjectionSignatureBySessionId.value[sessionId] || "";
  }

  const signature = reviewDeslopTerminalWatchSignature(session);
  if (!signature) {
    return "";
  }

  const startOutput = String(output ?? codexTerminalOutputBySessionId.value[sessionId] ?? "");
  promptInjectionSignatureBySessionId.value = {
    ...promptInjectionSignatureBySessionId.value,
    [sessionId]: signature
  };
  promptInjectionOutputStartBySignature.value = {
    ...promptInjectionOutputStartBySignature.value,
    [signature]: Math.max(0, Number(outputStart ?? startOutput.length))
  };
  promptInjectionOutputSnapshotBySignature.value = {
    ...promptInjectionOutputSnapshotBySignature.value,
    [signature]: startOutput
  };
  promptInjectionTextBySignature.value = {
    ...promptInjectionTextBySignature.value,
    [signature]: ""
  };
  codexCompletionWatcherFor(signature)?.start({
    output: startOutput,
    watchKey: signature
  });
  return signature;
}

function startCodexCompletionWatch(session = {}) {
  const signature = codexPromptRequestSignature(session);
  if (!signature) {
    return;
  }
  codexCompletionWatcherFor(signature)?.start({
    output: codexTerminalOutputBySessionId.value[session.sessionId] || "",
    watchKey: signature
  });
}

function trackCodexPromptInjection(session = {}) {
  const sessionId = session.sessionId || "";
  const signature = codexPromptRequestSignature(session);
  if (!sessionId || !signature) {
    return;
  }
  promptInjectionSignatureBySessionId.value = {
    ...promptInjectionSignatureBySessionId.value,
    [sessionId]: signature
  };
  promptInjectionOutputStartBySignature.value = {
    ...promptInjectionOutputStartBySignature.value,
    [signature]: String(codexTerminalOutputBySessionId.value[sessionId] || "").length
  };
  promptInjectionOutputSnapshotBySignature.value = {
    ...promptInjectionOutputSnapshotBySignature.value,
    [signature]: String(codexTerminalOutputBySessionId.value[sessionId] || "")
  };
  promptInjectionTextBySignature.value = {
    ...promptInjectionTextBySignature.value,
    [signature]: codexPromptTextForSession(session)
  };
  startCodexCompletionWatch(session);
}

function disposeCodexCompletionWatchersForSession(sessionId) {
  if (!sessionId) {
    return;
  }
  for (const [signature, watcher] of codexCompletionWatchersBySignature) {
    if (!signature.startsWith(`${sessionId}:`)) {
      continue;
    }
    watcher.dispose();
    codexCompletionWatchersBySignature.delete(signature);
  }
  codexCompletionBySignature.value = Object.fromEntries(
    Object.entries(codexCompletionBySignature.value)
      .filter(([signature]) => !signature.startsWith(`${sessionId}:`))
  );
}

function canAbandonSessionFromChip(session = {}) {
  return session.sessionId === selectedSessionId.value && !isClosedIssueSession(session);
}

function groupedStepDefinitions(steps = []) {
  const sortedSteps = [...steps].sort((left, right) => Number(left.index || 0) - Number(right.index || 0));
  const groupedSteps = [];
  for (let index = 0; index < sortedSteps.length; index += 1) {
    const step = sortedSteps[index];
    const groupId = String(step.displayGroupId || "").trim();
    if (!groupId) {
      groupedSteps.push(step);
      continue;
    }
    const members = [step];
    while (
      index + 1 < sortedSteps.length &&
      String(sortedSteps[index + 1].displayGroupId || "").trim() === groupId
    ) {
      index += 1;
      members.push(sortedSteps[index]);
    }
    if (members.length === 1) {
      groupedSteps.push(step);
      continue;
    }
    groupedSteps.push({
      ...step,
      description: members.map((member) => member.description).filter(Boolean).join(" "),
      id: `group:${groupId}`,
      kind: Array.from(new Set(members.map((member) => member.kind).filter(Boolean))).join(" / "),
      label: step.displayGroupLabel || step.label,
      sourceStepIds: members.map((member) => member.id),
      sourceSteps: members
    });
  }
  return groupedSteps;
}

function stepSourceIds(step = {}) {
  return Array.isArray(step.sourceStepIds) && step.sourceStepIds.length ? step.sourceStepIds : [step.id].filter(Boolean);
}

function displayStepIdFor(stepId = "") {
  const normalizedStepId = String(stepId || "").trim();
  return displayStepIdBySourceStepId.value[normalizedStepId] || normalizedStepId;
}

function uiCheckForStep(stepId) {
  const checks = Array.isArray(selectedSession.value?.uiChecks) ? selectedSession.value.uiChecks : [];
  return [...checks].reverse().find((check) => check?.stepId === stepId) || null;
}

function stepIsSkipped(step = {}) {
  return stepSourceIds(step).every((stepId) => String(uiCheckForStep(stepId)?.status || "").trim() === "skipped");
}

function stepIsDone(step = {}) {
  return stepSourceIds(step).every((stepId) => completedStepIds.value.has(stepId));
}

function canExpandDoneStep(step = {}) {
  return stepIsDone(step) && step.id !== displayCurrentStepId.value && Boolean(activeStepDescription(step));
}

function doneStepExpanded(step = {}) {
  return Boolean(expandedDoneStepIds.value[step.id]);
}

function stepDescriptionVisible(step = {}) {
  return (step.id === displayCurrentStepId.value || doneStepExpanded(step)) && Boolean(activeStepDescription(step));
}

function toggleDoneStep(step = {}) {
  if (!canExpandDoneStep(step)) {
    return;
  }
  expandedDoneStepIds.value = {
    ...expandedDoneStepIds.value,
    [step.id]: !expandedDoneStepIds.value[step.id]
  };
}

function activeCycleLabel() {
  const activeCycle = String(selectedSession.value?.activeCycle || "").trim().replace(/^cycle_/u, "");
  const cycleNumber = /^\d+$/u.test(activeCycle) ? activeCycle.padStart(3, "0") : "001";
  return `Cycle ${cycleNumber}`;
}

const activeCycleInfo = computed(() => {
  const activeCycle = activeCycleLabel().replace(/^Cycle\s+/u, "");
  const cycles = Array.isArray(selectedSession.value?.cycles) ? selectedSession.value.cycles : [];
  return cycles.find((cycle) => String(cycle?.cycle || "").trim() === activeCycle) || null;
});

const activeCycleReworkRequestText = computed(() => {
  return String(activeCycleInfo.value?.reworkRequest || "").trim();
});

function stepIsRepeatable(step = {}) {
  return step.repeatable === true ||
    Boolean(String(step.repeatableGroupId || "").trim()) ||
    (Array.isArray(step.sourceSteps) && step.sourceSteps.some((sourceStep) => stepIsRepeatable(sourceStep)));
}

function stepIsRepeatableGroupStart(step = {}) {
  return stepIsRepeatable(step) && step.id === firstRepeatableStepId.value;
}

function stepBadges(step = {}) {
  const badges = [];
  if (stepIsSkipped(step)) {
    badges.push({
      color: "info",
      label: "Skipped"
    });
  }
  if (step.id === displayCurrentStepId.value && selectedStepAction.value?.conditional) {
    badges.push({
      color: "info",
      label: "Conditional"
    });
  }
  if (step.id === displayCurrentStepId.value && selectedStepAction.value?.retryable) {
    badges.push({
      color: "warning",
      label: "Retryable"
    });
  }
  return badges;
}

function stepTitle(step = {}) {
  return activeStepDescription(step) || step.description || undefined;
}

function activeStepDescription(step = {}) {
  if (step.id === displayCurrentStepId.value) {
    return selectedStepAction.value?.description || step.description || "";
  }
  return step.description || "";
}

function stepState(step) {
  if (stepIsSkipped(step)) {
    return "skipped";
  }
  if ((selectedSession.value?.errors || []).length && step.id === displayCurrentStepId.value) {
    return "blocked";
  }
  if (step.id === displayCurrentStepId.value) {
    return "current";
  }
  if (stepIsDone(step)) {
    return "done";
  }
  return "pending";
}

const currentStepActionNotice = computed(() => {
  const action = selectedStepAction.value || {};
  if (
    selectedSession.value?.currentStep === "plan_made" &&
    String(selectedSession.value?.activeCycle || "001") !== "001" &&
    activeCycleReworkRequestText.value
  ) {
    return {
      text: `Rework request: ${activeCycleReworkRequestText.value}`,
      type: "info"
    };
  }
  if (action.retryable) {
    return {
      text: "This blocked step is retryable. Repair the reported issue, then run it again.",
      type: "warning"
    };
  }
  if (action.conditional && action.skipReason) {
    return {
      text: `JSKIT can skip this conditional step: ${action.skipReason}`,
      type: "info"
    };
  }
  if (action.conditional) {
    return {
      text: "This is a conditional step. JSKIT decides whether it runs or records a skip based on session metadata.",
      type: "info"
    };
  }
  return null;
});

function stepIcon(step) {
  const state = stepState(step);
  if (state === "done") {
    return mdiCheckCircle;
  }
  if (state === "current") {
    return mdiCircleSlice8;
  }
  if (state === "blocked") {
    return mdiAlertCircle;
  }
  if (state === "skipped") {
    return mdiCircleOutline;
  }
  return mdiCircleOutline;
}

async function copyText(value, label) {
  try {
    await navigator.clipboard.writeText(String(value || ""));
    copyStatus.value = `${label} copied.`;
  } catch (copyError) {
    copyStatus.value = String(copyError?.message || copyError || "Copy failed.");
  }
}

function runChoiceStep(value) {
  const inputName = selectedStepInput.value?.name;
  if (!inputName) {
    return;
  }
  autoStepStartSuppressedSessionId.value = "";
  void runSelectedStep({
    [inputName]: value
  }).then((response) => handleStepResponse(response));
}

function rememberTerminalSession(session = selectedSession.value) {
  const sessionId = session?.sessionId || "";
  if (!sessionId) {
    return;
  }
  if (isAbandonedIssueSession(session)) {
    forgetTerminalSession(sessionId);
    return;
  }
  if (!canUseIssueSessionTerminal(session)) {
    return;
  }
  if (terminalLimitReachedFor(sessionId)) {
    return;
  }
  terminalSessionById.value = {
    ...terminalSessionById.value,
    [sessionId]: {
      ...(terminalSessionById.value[sessionId] || {}),
      ...session
    }
  };
}

function forgetTerminalSession(sessionId) {
  if (!sessionId) {
    return;
  }
  disposeCodexCompletionWatchersForSession(sessionId);
  const {
    [sessionId]: _terminalSession,
    ...remainingTerminalSessions
  } = terminalSessionById.value;
  const {
    [sessionId]: _terminalOutput,
    ...remainingTerminalOutputs
  } = codexTerminalOutputBySessionId.value;
  const {
    [sessionId]: _promptInjectionRequest,
    ...remainingPromptInjectionRequests
  } = promptInjectionRequestBySessionId.value;
  const {
    [sessionId]: _promptInjectionSignature,
    ...remainingPromptInjectionSignatures
  } = promptInjectionSignatureBySessionId.value;
  const {
    [sessionId]: _codexPromptOverride,
    ...remainingCodexPromptOverrides
  } = codexPromptOverrideBySessionId.value;
  const {
    [sessionId]: _deslopAutomation,
    ...remainingDeslopAutomation
  } = deslopAutomationBySessionId.value;
  terminalSessionById.value = remainingTerminalSessions;
  codexTerminalOutputBySessionId.value = remainingTerminalOutputs;
  promptInjectionRequestBySessionId.value = remainingPromptInjectionRequests;
  promptInjectionSignatureBySessionId.value = remainingPromptInjectionSignatures;
  promptInjectionOutputStartBySignature.value = Object.fromEntries(
    Object.entries(promptInjectionOutputStartBySignature.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  promptInjectionOutputSnapshotBySignature.value = Object.fromEntries(
    Object.entries(promptInjectionOutputSnapshotBySignature.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  promptInjectionTextBySignature.value = Object.fromEntries(
    Object.entries(promptInjectionTextBySignature.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  codexPromptOverrideBySessionId.value = remainingCodexPromptOverrides;
  deslopAutomationBySessionId.value = remainingDeslopAutomation;
  codexPromptResultBySignature.value = Object.fromEntries(
    Object.entries(codexPromptResultBySignature.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  alternateActionInputValues.value = Object.fromEntries(
    Object.entries(alternateActionInputValues.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  autoSkippedStepKeys.value = Object.fromEntries(
    Object.entries(autoSkippedStepKeys.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  autoRanImmediateStepKeys.value = Object.fromEntries(
    Object.entries(autoRanImmediateStepKeys.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  autoStartedCodexOutputStepKeys.value = Object.fromEntries(
    Object.entries(autoStartedCodexOutputStepKeys.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  autoStartedCodexPromptStepKeys.value = Object.fromEntries(
    Object.entries(autoStartedCodexPromptStepKeys.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  autoAdvancedCodexPromptBySignature.value = Object.fromEntries(
    Object.entries(autoAdvancedCodexPromptBySignature.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
}

function pruneTerminalSessions() {
  const sessionIds = new Set((issueSessions.value || []).map((session) => session.sessionId));
  if (selectedSessionId.value && !isAbandonedIssueSession(selectedSession.value)) {
    sessionIds.add(selectedSessionId.value);
  }
  terminalSessionById.value = Object.fromEntries(
    Object.entries(terminalSessionById.value)
      .filter(([sessionId, session]) => sessionIds.has(sessionId) && !isAbandonedIssueSession(session))
  );
  codexTerminalOutputBySessionId.value = Object.fromEntries(
    Object.entries(codexTerminalOutputBySessionId.value).filter(([sessionId]) => sessionIds.has(sessionId))
  );
  promptInjectionRequestBySessionId.value = Object.fromEntries(
    Object.entries(promptInjectionRequestBySessionId.value).filter(([sessionId]) => sessionIds.has(sessionId))
  );
  promptInjectionSignatureBySessionId.value = Object.fromEntries(
    Object.entries(promptInjectionSignatureBySessionId.value).filter(([sessionId]) => sessionIds.has(sessionId))
  );
  promptInjectionOutputStartBySignature.value = Object.fromEntries(
    Object.entries(promptInjectionOutputStartBySignature.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  promptInjectionOutputSnapshotBySignature.value = Object.fromEntries(
    Object.entries(promptInjectionOutputSnapshotBySignature.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  promptInjectionTextBySignature.value = Object.fromEntries(
    Object.entries(promptInjectionTextBySignature.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  codexPromptOverrideBySessionId.value = Object.fromEntries(
    Object.entries(codexPromptOverrideBySessionId.value).filter(([sessionId]) => sessionIds.has(sessionId))
  );
  deslopAutomationBySessionId.value = Object.fromEntries(
    Object.entries(deslopAutomationBySessionId.value).filter(([sessionId]) => sessionIds.has(sessionId))
  );
  codexPromptResultBySignature.value = Object.fromEntries(
    Object.entries(codexPromptResultBySignature.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  for (const [signature, watcher] of codexCompletionWatchersBySignature) {
    if (!sessionIds.has(signature.split(":")[0])) {
      watcher.dispose();
      codexCompletionWatchersBySignature.delete(signature);
    }
  }
  codexCompletionBySignature.value = Object.fromEntries(
    Object.entries(codexCompletionBySignature.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  alternateActionInputValues.value = Object.fromEntries(
    Object.entries(alternateActionInputValues.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  autoSkippedStepKeys.value = Object.fromEntries(
    Object.entries(autoSkippedStepKeys.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  autoRanImmediateStepKeys.value = Object.fromEntries(
    Object.entries(autoRanImmediateStepKeys.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  autoStartedCodexOutputStepKeys.value = Object.fromEntries(
    Object.entries(autoStartedCodexOutputStepKeys.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  autoStartedCodexPromptStepKeys.value = Object.fromEntries(
    Object.entries(autoStartedCodexPromptStepKeys.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  autoAdvancedCodexPromptBySignature.value = Object.fromEntries(
    Object.entries(autoAdvancedCodexPromptBySignature.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
}

function recordCodexTerminalOutput(sessionId, output) {
  const nextOutput = String(output || "");
  const previousOutput = codexTerminalOutputBySessionId.value[sessionId] || "";
  let signature = promptInjectionSignatureBySessionId.value[sessionId] || "";
  if (!signature) {
    signature = ensureReviewDeslopTerminalWatch(sessionId, {
      output: previousOutput,
      outputStart: previousOutput.length
    });
  }
  codexTerminalOutputBySessionId.value = {
    ...codexTerminalOutputBySessionId.value,
    [sessionId]: nextOutput
  };
  codexCompletionWatchersBySignature.get(signature)?.observeOutput(nextOutput);
  if (
    sessionId === selectedSessionId.value &&
    isReviewDeslopStep.value &&
    selectedCodexCompletion.value?.status === "finished"
  ) {
    void handleFinishedDeslopPrompt();
  }
}

function recordCodexTerminalInput(sessionId) {
  const existingOutput = codexTerminalOutputBySessionId.value[sessionId] || "";
  const signature = promptInjectionSignatureBySessionId.value[sessionId] ||
    ensureReviewDeslopTerminalWatch(sessionId, {
      output: existingOutput,
      outputStart: existingOutput.length
    });
  codexCompletionWatchersBySignature.get(signature)?.recordUserInput();
  if (signature && codexPromptResultBySignature.value[signature]?.status === "missing_summary") {
    const {
      [signature]: _missingSummary,
      ...remainingResults
    } = codexPromptResultBySignature.value;
    codexPromptResultBySignature.value = remainingResults;
  }
  const automation = deslopAutomationBySessionId.value[sessionId];
  if (automation && ["awaiting_user", "interrupted", "waiting_for_summary"].includes(automation.status)) {
    setDeslopAutomation(sessionId, {
      ...automation,
      handledSignature: "",
      status: "waiting"
    });
  }
}

function recordCodexPromptInjected(sessionId, event = {}) {
  const existingSession = sessionId === selectedSessionId.value && selectedSession.value?.sessionId === sessionId
    ? selectedSession.value
    : terminalSessionById.value[sessionId] || {};
  trackCodexPromptInjection({
    ...existingSession,
    sessionId,
    ...(event?.prompt
      ? {
        codex: {
          ...(existingSession.codex || {}),
          promptField: "prompt"
        },
        prompt: event.prompt
      }
      : {})
  });
  if (codexPromptOverrideBySessionId.value[sessionId]) {
    const {
      [sessionId]: _sentOverride,
      ...remainingOverrides
    } = codexPromptOverrideBySessionId.value;
    codexPromptOverrideBySessionId.value = remainingOverrides;
  }
}

function applyIssueSessionUpdate(patch = {}) {
  const patchedSession = patchIssueSession(patch);
  rememberTerminalSession(patchedSession || {
    ...(terminalSessionById.value[patch?.sessionId] || {}),
    ...patch
  });
}

function setDeslopAutomation(sessionId, state = {}) {
  if (!sessionId) {
    return;
  }
  deslopAutomationBySessionId.value = {
    ...deslopAutomationBySessionId.value,
    [sessionId]: {
      ...(deslopAutomationBySessionId.value[sessionId] || {}),
      ...state
    }
  };
}

function activePromptOutputForSession(sessionId) {
  const signature = promptInjectionSignatureBySessionId.value[sessionId] || "";
  const output = codexTerminalOutputBySessionId.value[sessionId] || "";
  if (!signature) {
    return output;
  }
  return outputAfterPromptStart({
    output,
    prompt: promptInjectionTextBySignature.value[signature] || "",
    promptOutputSnapshot: promptInjectionOutputSnapshotBySignature.value[signature],
    promptStart: promptInjectionOutputStartBySignature.value[signature]
  });
}

function activePromptHasMarkedBlock(sessionId, marker) {
  return Boolean(extractMarkedOutputDetails(activePromptOutputForSession(sessionId), marker).value.trim());
}

function activePromptMarkerSignature(sessionId, marker) {
  return extractMarkedOutputDetails(activePromptOutputForSession(sessionId), marker).signature;
}

function activePromptHasRequiredCompletion(sessionId, stepId) {
  if (stepId === "review_changes_accepted") {
    return activePromptHasMarkedBlock(sessionId, DESLOP_RESULT_MARKER);
  }
  return activePromptHasMarkedBlock(sessionId, "jskit_step_result");
}

function handledPromptSignature(sessionId, stepId, signature) {
  if (stepId === "review_changes_accepted") {
    const resultSignature = activePromptMarkerSignature(sessionId, DESLOP_RESULT_MARKER) || "missing";
    return [signature, resultSignature].join(":");
  }
  return signature;
}

function sessionNeedsCodexOutputPrompt(session = {}) {
  const action = session.currentStepAction || {};
  const expectedOutputs = Array.isArray(session.codex?.expectedOutputs)
    ? session.codex.expectedOutputs
    : [];
  return Boolean(
    action.kind === "codex_output" &&
    session.codex?.mode === "inject_prompt" &&
    expectedOutputs.some((output) => output?.field) &&
    !session.prompt
  );
}

async function askCodexToResolveDeslopFindings(findings, {
  status = "resolving_user"
} = {}) {
  const session = selectedSession.value || {};
  const sessionId = session.sessionId || "";
  const actionableFindings = Array.isArray(findings) ? findings : [];
  if (!sessionId || !actionableFindings.length) {
    return;
  }
  setDeslopAutomation(sessionId, {
    findings: actionableFindings,
    handledSignature: "",
    status
  });
  await injectCodexPromptText(session, buildResolveDeslopFindingsPrompt(actionableFindings));
}

async function rerunDeslopAfterResolution(sessionId) {
  if (!sessionId || selectedSessionId.value !== sessionId || issueSessionBusy.value) {
    return;
  }
  const acceptedResponse = await runSelectedStep({
    reviewFindings: REVIEW_DESLOP_MORE_FINDINGS,
    reviewFindingsRemaining: true
  });
  await handleStepResponse(acceptedResponse);
  if (acceptedResponse?.ok === false || acceptedResponse?.currentStep !== "review_prompt_rendered") {
    return;
  }
  const promptResponse = await runSelectedStep();
  await handleStepResponse(promptResponse);
  if (promptResponse?.ok !== false) {
    setDeslopAutomation(sessionId, {
      findings: [],
      handledSignature: "",
      signature: promptInjectionSignatureBySessionId.value[sessionId] || "",
      status: "reviewing"
    });
  }
}

async function handleFinishedDeslopPrompt() {
  const session = selectedSession.value || {};
  const sessionId = session.sessionId || "";
  if (!sessionId || !isReviewDeslopStep.value || selectedCodexCompletion.value?.status !== "finished") {
    return;
  }
  const signature = selectedActivePromptSignature.value || "";
  const handledSignature = handledPromptSignature(sessionId, session.currentStep || "", signature);
  const automation = deslopAutomationBySessionId.value[sessionId] || {};
  if (automation.handledSignature === handledSignature) {
    return;
  }
  setDeslopAutomation(sessionId, {
    handledSignature
  });

  if (automation.status === "resolving_auto" || automation.status === "resolving_user") {
    await rerunDeslopAfterResolution(sessionId);
    return;
  }

  if (session.currentStep !== "review_changes_accepted") {
    return;
  }

  const findings = parseDeslopResult(activePromptOutputForSession(sessionId));
  if (!activePromptHasRequiredCompletion(sessionId, "review_changes_accepted")) {
    setDeslopAutomation(sessionId, {
      findings: [],
      status: "waiting_for_summary"
    });
    return;
  }

  const autoFindings = deslopFindingsByPriority(findings);
  if (autoFindings.length) {
    await askCodexToResolveDeslopFindings(autoFindings, {
      status: "resolving_auto"
    });
    return;
  }

  setDeslopAutomation(sessionId, {
    findings,
    status: "awaiting_user"
  });
}

function shouldAutoAdvanceFinishedCodexPrompt() {
  const session = selectedSession.value || {};
  const signature = selectedActivePromptSignature.value || "";
  return Boolean(
    session.sessionId &&
    signature &&
    selectedCodexPromptAutoAdvances.value &&
    selectedCodexPromptAlreadyRequested.value &&
    selectedCodexCompletion.value?.status === "finished" &&
    !issueSessionBusy.value &&
    !autoAdvancedCodexPromptBySignature.value[signature]
  );
}

function autoStartCodexPromptStepKey(session = {}) {
  return [
    session.sessionId || "",
    session.currentStep || "",
    session.activeCycle || "",
    session.currentReviewPass || "",
    Array.isArray(session.reviewPasses) ? session.reviewPasses.length : 0
  ].join(":");
}

function shouldAutoStartCodexPromptStep(session = selectedSession.value) {
  const action = session?.currentStepAction || {};
  return Boolean(
    session?.sessionId &&
    session.sessionId === selectedSessionId.value &&
    AUTO_START_CODEX_PROMPT_STEP_IDS.has(session.currentStep || "") &&
    action.kind === "codex_prompt" &&
    !session.prompt &&
    !selectedSessionTerminalBlocked.value &&
    !issueSessionBusy.value &&
    !isClosedIssueSession(session) &&
    !shouldAutoSkipConditionalStep(session) &&
    !autoStartedCodexPromptStepKeys.value[autoStartCodexPromptStepKey(session)]
  );
}

async function autoStartCodexPromptStep(session = selectedSession.value) {
  if (!shouldAutoStartCodexPromptStep(session)) {
    return;
  }
  const key = autoStartCodexPromptStepKey(session);
  const stepId = session.currentStep || "";
  autoStartedCodexPromptStepKeys.value = {
    ...autoStartedCodexPromptStepKeys.value,
    [key]: true
  };
  const response = await runSelectedStep();
  if (!response || response.ok === false) {
    const {
      [key]: _failedStart,
      ...remainingStarted
    } = autoStartedCodexPromptStepKeys.value;
    autoStartedCodexPromptStepKeys.value = remainingStarted;
    return;
  }
  await handleStepResponse(response);
  if (stepId === "review_prompt_rendered") {
    setDeslopAutomation(response.sessionId || session.sessionId, {
      findings: [],
      handledSignature: "",
      status: "reviewing"
    });
  }
}

function shouldAutoStartCodexOutputStep(session = selectedSession.value) {
  return Boolean(
    session?.sessionId &&
    session.sessionId === selectedSessionId.value &&
    sessionNeedsCodexOutputPrompt(session) &&
    session.codex?.autoInject === true &&
    !selectedSessionTerminalBlocked.value &&
    !issueSessionBusy.value &&
    !isClosedIssueSession(session) &&
    !autoStartedCodexOutputStepKeys.value[autoStartCodexPromptStepKey(session)]
  );
}

async function autoStartCodexOutputStep(session = selectedSession.value) {
  if (!shouldAutoStartCodexOutputStep(session)) {
    return;
  }
  const key = autoStartCodexPromptStepKey(session);
  autoStartedCodexOutputStepKeys.value = {
    ...autoStartedCodexOutputStepKeys.value,
    [key]: true
  };
  const response = await runSelectedStep({}, {
    includeStepInput: false
  });
  if (!response || response.ok === false) {
    const {
      [key]: _failedStart,
      ...remainingStarted
    } = autoStartedCodexOutputStepKeys.value;
    autoStartedCodexOutputStepKeys.value = remainingStarted;
    return;
  }
  await handleStepResponse(response, {
    forcePromptInjection: true
  });
}

async function autoAdvanceFinishedCodexPrompt() {
  if (!shouldAutoAdvanceFinishedCodexPrompt()) {
    return;
  }
  const signature = selectedActivePromptSignature.value || "";
  const sessionId = selectedSessionId.value || "";
  const stepId = selectedSession.value?.currentStep || "";
  if (!activePromptHasRequiredCompletion(sessionId, stepId)) {
    codexPromptResultBySignature.value = {
      ...codexPromptResultBySignature.value,
      [signature]: {
        status: "missing_summary"
      }
    };
    return;
  }
  autoAdvancedCodexPromptBySignature.value = {
    ...autoAdvancedCodexPromptBySignature.value,
    [signature]: true
  };
  const response = await runSelectedStep();
  if (!response || response.ok === false) {
    const {
      [signature]: _failedAdvance,
      ...remainingAdvances
    } = autoAdvancedCodexPromptBySignature.value;
    autoAdvancedCodexPromptBySignature.value = remainingAdvances;
    return;
  }
  await handleStepResponse(response);
}

async function resendCurrentCodexPromptRequest() {
  const session = selectedSession.value || {};
  const sessionId = session.sessionId || "";
  const signature = selectedActivePromptSignature.value || "";
  const prompt = promptInjectionTextBySignature.value[signature] || codexPromptTextForSession(session);
  if (!sessionId || !prompt || selectedSessionTerminalBlocked.value || issueSessionBusy.value) {
    return;
  }
  if (isReviewDeslopStep.value) {
    setDeslopAutomation(sessionId, {
      findings: [],
      handledSignature: "",
      status: "reviewing"
    });
  }
  if (signature) {
    const {
      [signature]: _missingSummary,
      ...remainingResults
    } = codexPromptResultBySignature.value;
    codexPromptResultBySignature.value = remainingResults;
  }
  await injectCodexPromptText(session, prompt);
}

async function handleStepResponse(response, {
  forcePromptInjection = false,
  runAutomaticFollowUps = true
} = {}) {
  rememberTerminalSession(response);
  if (
    response?.ok !== false &&
    response?.prompt &&
    forcePromptInjection
  ) {
    await requestCodexPromptInjection(response);
  }
  if (response?.ok !== false && runAutomaticFollowUps) {
    await runAutomaticStepHandlers(response);
  }
  return response;
}

async function runAutomaticStepHandlers(session = selectedSession.value) {
  if (session?.sessionId && autoStepStartSuppressedSessionId.value === session.sessionId) {
    return;
  }
  await autoSkipConditionalStep(session);
  await autoRunImmediateSessionStep(session);
  await autoStartCodexOutputStep(session);
  await autoStartCodexPromptStep(session);
  await autoAdvanceFinishedCodexPrompt();
}

function autoSkipStepKey(session = {}) {
  const action = session.currentStepAction || {};
  return [
    session.sessionId || "",
    action.stepId || session.currentStep || "",
    action.skipReason || ""
  ].join(":");
}

function shouldAutoSkipConditionalStep(session = selectedSession.value) {
  const action = session?.currentStepAction || {};
  return Boolean(
    session?.sessionId &&
    session.sessionId === selectedSessionId.value &&
    !issueSessionBusy.value &&
    !isClosedIssueSession(session) &&
    action.conditional === true &&
    action.skipReason &&
    (action.stepId || session.currentStep) === session.currentStep
  );
}

async function autoSkipConditionalStep(session = selectedSession.value) {
  if (!shouldAutoSkipConditionalStep(session)) {
    return;
  }
  const key = autoSkipStepKey(session);
  if (autoSkippedStepKeys.value[key]) {
    return;
  }
  autoSkippedStepKeys.value = {
    ...autoSkippedStepKeys.value,
    [key]: true
  };
  const response = await runSelectedStep();
  await handleStepResponse(response);
}

function hasNoInput(action) {
  return !action?.input || action.input.type === "none";
}

function immediateStepKey(session = {}) {
  const action = session.currentStepAction || {};
  return [
    session.sessionId || "",
    action.stepId || session.currentStep || ""
  ].join(":");
}

function shouldAutoRunImmediateSessionStep(session = selectedSession.value) {
  const action = session?.currentStepAction || {};
  const stepId = action.stepId || session?.currentStep || "";
  return Boolean(
    session?.sessionId &&
    session.sessionId === selectedSessionId.value &&
    stepId &&
    stepId !== "dependencies_installed" &&
    !issueSessionBusy.value &&
    !isClosedIssueSession(session) &&
    action.kind === "automatic" &&
    hasNoInput(action) &&
    action.requiresExplicitRun !== true &&
    !session.codex &&
    !autoRanImmediateStepKeys.value[immediateStepKey(session)]
  );
}

async function autoRunImmediateSessionStep(session = selectedSession.value) {
  if (!shouldAutoRunImmediateSessionStep(session)) {
    return;
  }
  const key = immediateStepKey(session);
  autoRanImmediateStepKeys.value = {
    ...autoRanImmediateStepKeys.value,
    [key]: true
  };
  const response = await runSelectedStep();
  if (!response || response.ok === false) {
    const {
      [key]: _failedRun,
      ...remainingRuns
    } = autoRanImmediateStepKeys.value;
    autoRanImmediateStepKeys.value = remainingRuns;
    return;
  }
  await handleStepResponse(response);
}

async function runCodexOutputStep() {
  const shouldRequestGeneratedPrompt = selectedStepNeedsCodexOutputPrompt.value;
  const payload = Object.fromEntries(codexEditableOutputs.value
    .map((output) => [
      String(output.field || "").trim(),
      codexOutputDraftValue(output).trim()
    ])
    .filter(([field, value]) => Boolean(field && value)));
  if (!Object.keys(payload).length) {
    if (!selectedSession.value?.prompt) {
      const response = await runSelectedStep({}, {
        includeStepInput: false
      });
      await handleStepResponse(response, {
        forcePromptInjection: shouldRequestGeneratedPrompt
      });
    }
    return;
  }

  const response = await runSelectedStep(payload);
  await handleStepResponse(response);
}

async function runAlternateAction(action = {}) {
  if (alternateActionDisabled(action)) {
    return;
  }
  autoStepStartSuppressedSessionId.value = "";
  const response = await runSelectedStep(alternateActionPayload(action));
  clearAlternateActionDraft(action);
  await handleStepResponse(response);
}

async function resolveReviewDeslopFindings() {
  if (!canRunReviewDeslopResolve.value) {
    return;
  }
  await askCodexToResolveDeslopFindings(reviewDeslopFindings.value, {
    status: "resolving_user"
  });
}

async function goToNextStep() {
  if (!activeStepControls.value.canGoNext) {
    return;
  }
  const payload = selectedSession.value?.currentStep === "review_changes_accepted"
    ? { reviewFindingsRemaining: false }
    : {};
  autoStepStartSuppressedSessionId.value = selectedSession.value?.sessionId || "";
  const response = await runSelectedStep(payload);
  if (!response) {
    autoStepStartSuppressedSessionId.value = "";
  }
  await handleStepResponse(response, {
    runAutomaticFollowUps: false
  });
}

async function executeCurrentStep() {
  if (!activeStepControls.value.canExecuteStep) {
    return;
  }
  autoStepStartSuppressedSessionId.value = "";
  if (isCodexOutputStep.value) {
    await runCodexOutputStep();
    return;
  }
  if (isCodexPromptInjection.value && !selectedCodexPromptAlreadyRequested.value && selectedSession.value?.prompt) {
    await requestCodexPromptInjection();
    return;
  }
  const stepId = selectedSession.value?.currentStep || "";
  const response = await runSelectedStep(stepId === "pr_finalized" ? { mergePr: true } : {});
  await handleStepResponse(response);
  if (stepId === "review_prompt_rendered" && response?.ok !== false) {
    setDeslopAutomation(response.sessionId || selectedSessionId.value, {
      findings: [],
      handledSignature: "",
      status: "reviewing"
    });
  }
}

function requestAbandonSession(session = {}) {
  abandonSessionId.value = session.sessionId || "";
  abandonDialogOpen.value = Boolean(abandonSessionId.value);
}

function cancelAbandonSession() {
  abandonDialogOpen.value = false;
  abandonSessionId.value = "";
}

async function confirmAbandonSession() {
  const abandonedSessionId = abandonSessionId.value || selectedSessionId.value;
  if (!abandonedSessionId || abandonedSessionId !== selectedSessionId.value) {
    cancelAbandonSession();
    return;
  }
  const response = await abandonSelectedSession();
  if (response?.status === "abandoned") {
    forgetTerminalSession(abandonedSessionId);
  }
  cancelAbandonSession();
}

async function handleSessionStepTerminalFinished(event = {}) {
  if (!event.sessionId || event.sessionId !== selectedSessionId.value) {
    return;
  }
  await selectSession(event.sessionId, { preserveList: true });
  await loadIssueSessions();
}

async function openDiffDialog() {
  if (!selectedSessionId.value) {
    return;
  }
  diffDialogOpen.value = true;
  diffLoading.value = true;
  diffError.value = "";
  diffPayload.value = null;
  try {
    const response = await readIssueSessionDiff(selectedSessionId.value);
    diffPayload.value = response;
    if (response?.ok === false) {
      diffError.value = response.errors?.[0]?.message || "Diff inspection failed.";
    }
  } catch (error) {
    diffError.value = String(error?.message || error || "Diff inspection failed.");
  } finally {
    diffLoading.value = false;
  }
}

function closeDiffDialog() {
  diffDialogOpen.value = false;
}

function handleDiffBodyClick(event) {
  const clickedElement = event.target instanceof Element ? event.target : null;
  const link = clickedElement?.closest("a");
  const diffBody = diffBodyElement.value?.$el || diffBodyElement.value;
  if (!link || !diffBody?.contains(link)) {
    return;
  }

  const href = String(link.getAttribute("href") || "");
  if (!href.startsWith("#")) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const target = document.getElementById(href.slice(1));
  if (target && diffBody.contains(target)) {
    target.scrollIntoView({
      block: "start",
      behavior: "smooth"
    });
  }
}

async function acceptReviewedChanges() {
  autoStepStartSuppressedSessionId.value = "";
  const response = await runSelectedStep();
  await handleStepResponse(response);
  if (response?.ok !== false) {
    closeDiffDialog();
  }
}

async function requestCodexPromptInjection(sessionOverride = null) {
  const session = sessionOverride?.sessionId ? sessionOverride : selectedSession.value || {};
  const sessionId = session.sessionId || "";
  if (!sessionId || selectedSessionTerminalBlocked.value) {
    copyStatus.value = selectedSessionTerminalBlocked.value
      ? "Open terminal limit reached."
      : "No active session is selected.";
    return;
  }
  rememberTerminalSession(session);
  await nextTick();
  promptInjectionRequestBySessionId.value = {
    ...promptInjectionRequestBySessionId.value,
    [sessionId]: `${Date.now()}:${Math.random().toString(36).slice(2)}`
  };
  trackCodexPromptInjection(session);
  copyStatus.value = "";
}

async function injectCodexPromptText(session, promptText) {
  const sessionId = session?.sessionId || "";
  const prompt = String(promptText || "").trim();
  if (!sessionId || !prompt) {
    return false;
  }
  codexPromptOverrideBySessionId.value = {
    ...codexPromptOverrideBySessionId.value,
    [sessionId]: prompt
  };
  await requestCodexPromptInjection({
    ...session,
    __studioPrompt: prompt,
    codex: {
      ...(session.codex || {}),
      mode: "inject_prompt",
      promptField: "__studioPrompt"
    }
  });
  return true;
}

function submitCurrentForm() {
  autoStepStartSuppressedSessionId.value = "";
  if (isCodexOutputStep.value) {
    void runCodexOutputStep();
    return;
  }
  void runSelectedStep().then((response) => handleStepResponse(response));
}

watch(selectedSession, (session) => {
  rememberTerminalSession(session);
  void runAutomaticStepHandlers(session);
}, {
  immediate: true
});

watch(issueSessionBusy, (busy) => {
  if (!busy) {
    void runAutomaticStepHandlers();
  }
});

watch(issueSessions, () => {
  pruneTerminalSessions();
});

watch(extractedCodexOutputEntries, (entries) => {
  let nextDrafts = codexOutputDraftByKey.value;
  let nextSources = codexOutputSourceByKey.value;
  for (const entry of entries) {
    const key = entry.key;
    const nextOutput = String(entry.value || "");
    const nextSource = String(entry.signature || "");
    if (!key || !nextOutput || !nextSource) {
      continue;
    }
    if (nextSources[key] !== nextSource) {
      nextDrafts = {
        ...nextDrafts,
        [key]: nextOutput
      };
      nextSources = {
        ...nextSources,
        [key]: nextSource
      };
    }
  }
  codexOutputDraftByKey.value = nextDrafts;
  codexOutputSourceByKey.value = nextSources;
}, {
  immediate: true
});

watch(selectedCodexCompletion, (completion) => {
  if (!completion) {
    return;
  }
  if (completion.status === "finished") {
    void autoAdvanceFinishedCodexPrompt();
  }
  if (!isReviewDeslopStep.value) {
    return;
  }
  if (completion.status === "interrupted") {
    setDeslopAutomation(selectedSessionId.value, {
      status: "interrupted"
    });
    return;
  }
  if (completion.status === "finished") {
    void handleFinishedDeslopPrompt();
  }
});

onMounted(() => {
  void loadIssueSessions();
});

onBeforeUnmount(() => {
  for (const watcher of codexCompletionWatchersBySignature.values()) {
    watcher.dispose();
  }
  codexCompletionWatchersBySignature.clear();
});

</script>

<style scoped>
.studio-screen__panel {
  padding: 0.75rem;
}

.studio-issue-sessions__action-title {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-issue-sessions__action-buttons,
.studio-issue-sessions__choice-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
}

.studio-issue-sessions__action-buttons :deep(.v-btn),
.studio-issue-sessions__choice-row :deep(.v-btn) {
  flex: 0 1 auto;
  min-width: 0;
  width: auto;
}

.studio-issue-sessions__action-buttons :deep(.v-btn__content),
.studio-issue-sessions__choice-row :deep(.v-btn__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-issue-sessions__action-stack {
  display: grid;
  gap: 0.55rem;
}

.studio-issue-sessions__alternate-actions {
  display: grid;
  gap: 0.65rem;
}

.studio-issue-sessions__alternate-action {
  background: rgba(var(--v-theme-surface-variant), 0.34);
  border: 1px solid rgba(var(--v-border-color), 0.34);
  border-radius: 8px;
  display: grid;
  gap: 0.55rem;
  padding: 0.65rem;
}

.studio-issue-sessions__alternate-action--secondary {
  background: rgba(var(--v-theme-primary), 0.06);
  border-color: rgba(var(--v-theme-primary), 0.18);
}

.studio-issue-sessions__alternate-copy {
  display: grid;
  gap: 0.15rem;
}

.studio-issue-sessions__alternate-copy strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.9rem;
  font-weight: 700;
}

.studio-issue-sessions__alternate-copy span {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.8rem;
  line-height: 1.35;
}

.studio-issue-sessions__alternate-action :deep(.v-btn) {
  justify-self: start;
}

.studio-issue-sessions__strip {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  overflow-x: auto;
  padding-bottom: 0.125rem;
}

.studio-issue-sessions__tab {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
}

.studio-issue-sessions__tab-chip {
  cursor: pointer;
  font-weight: 600;
}

.studio-issue-sessions__new-tab {
  border: 1px solid rgba(var(--v-theme-primary), 0.42);
  cursor: pointer;
  font-weight: 650;
}

.studio-issue-sessions__new-tab--busy {
  opacity: 0.72;
  pointer-events: none;
}

.studio-issue-sessions__tab-close {
  align-items: center;
  background: rgba(var(--v-theme-on-primary), 0.18);
  border: 1px solid rgba(var(--v-theme-on-primary), 0.44);
  border-radius: 999px;
  color: rgb(var(--v-theme-on-primary));
  cursor: pointer;
  display: inline-flex;
  height: 1.25rem;
  margin-inline-start: 0.45rem;
  place-content: center;
  width: 1.25rem;
}

.studio-issue-sessions__tab-close:hover,
.studio-issue-sessions__tab-close:focus-visible {
  background: rgba(var(--v-theme-on-primary), 0.32);
}

.studio-issue-sessions__status-dot {
  border-radius: 999px;
  display: inline-block;
  height: 0.55rem;
  margin-right: 0.45rem;
  width: 0.55rem;
}

.studio-issue-sessions__status-dot--finished {
  background: rgb(var(--v-theme-success));
}

.studio-issue-sessions__status-dot--blocked,
.studio-issue-sessions__status-dot--failed {
  background: rgb(var(--v-theme-error));
}

.studio-issue-sessions__status-dot--waiting_for_user {
  background: rgb(var(--v-theme-warning));
}

.studio-issue-sessions__status-dot--pending,
.studio-issue-sessions__status-dot--running {
  background: rgb(var(--v-theme-primary));
}

.studio-issue-sessions__status-dot--abandoned {
  background: rgb(var(--v-theme-on-surface-variant));
}

.studio-issue-sessions__empty {
  padding: 0.75rem;
}

.studio-issue-sessions__diff-dialog {
  max-height: 90vh;
}

.studio-issue-sessions__diff-title {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.studio-issue-sessions__diff-body {
  max-height: 72vh;
  overflow-x: hidden;
  overflow-y: auto;
}

.studio-issue-sessions__diff-status {
  background: rgba(var(--v-theme-surface-variant), 0.55);
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.35;
  margin: 0 0 0.75rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}

.studio-issue-sessions__diff-rendered {
  min-width: 0;
  overflow-x: hidden;
}

.studio-issue-sessions__diff-rendered :deep(.d2h-wrapper) {
  color: #1f2937;
}

.studio-issue-sessions__diff-rendered :deep(.d2h-file-wrapper) {
  border-color: rgba(var(--v-border-color), 0.34);
  border-radius: 8px;
  margin-bottom: 0.75rem;
}

.studio-issue-sessions__diff-rendered :deep(.d2h-file-header) {
  border-radius: 8px 8px 0 0;
}

.studio-issue-sessions__diff-rendered :deep(.d2h-files-diff),
.studio-issue-sessions__diff-rendered :deep(.d2h-file-side-diff) {
  min-width: 0;
}

.studio-issue-sessions__diff-rendered :deep(.d2h-file-side-diff) {
  overflow-x: auto;
}

.studio-issue-sessions__workspace {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(20rem, 0.72fr) minmax(34rem, 1.28fr);
}

.studio-issue-sessions__main,
.studio-issue-sessions__side {
  min-width: 0;
}

.studio-issue-sessions__main,
.studio-issue-sessions__side {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.studio-issue-sessions__terminal-stack {
  min-width: 0;
}

.studio-issue-sessions__timeline {
  border: 0;
  border-radius: 0;
  overflow: visible;
  padding: 0;
}

.studio-issue-sessions__step {
  align-items: flex-start;
  border-radius: 6px;
  display: grid;
  gap: 0.34rem;
  grid-template-columns: 1.25rem minmax(0, 1fr);
  padding: 0.26rem 0.32rem;
  position: relative;
}

.studio-issue-sessions__step-icon {
  align-items: center;
  display: flex;
  height: 1.25rem;
  justify-content: center;
  padding-top: 0.02rem;
}

.studio-issue-sessions__step--current {
  background: rgba(var(--v-theme-primary), 0.1);
}

.studio-issue-sessions__step--repeatable {
  background: linear-gradient(90deg, rgba(var(--v-theme-primary), 0.055), rgba(var(--v-theme-surface-variant), 0.13));
  border-left: 3px solid rgba(var(--v-theme-primary), 0.42);
  margin-left: 0.34rem;
  padding-left: 0.42rem;
}

.studio-issue-sessions__step--repeatable-start {
  margin-top: 0.62rem;
}

.studio-issue-sessions__step--repeatable.studio-issue-sessions__step--current {
  background: linear-gradient(90deg, rgba(var(--v-theme-primary), 0.14), rgba(var(--v-theme-primary), 0.06));
}

.studio-issue-sessions__cycle-marker {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-primary), 0.34);
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.1);
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  font-size: 0.64rem;
  font-weight: 750;
  gap: 0.16rem;
  left: 0.42rem;
  line-height: 1;
  padding: 0.13rem 0.42rem;
  position: absolute;
  top: -0.58rem;
  z-index: 1;
}

.studio-issue-sessions__step--done .studio-issue-sessions__step-icon {
  color: rgb(var(--v-theme-success));
}

.studio-issue-sessions__step--skipped .studio-issue-sessions__step-icon {
  color: rgb(var(--v-theme-info));
}

.studio-issue-sessions__step--current .studio-issue-sessions__step-icon {
  color: rgb(var(--v-theme-primary));
}

.studio-issue-sessions__step--blocked .studio-issue-sessions__step-icon {
  color: rgb(var(--v-theme-error));
}

.studio-issue-sessions__step-title {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  line-height: 1.12;
}

.studio-issue-sessions__step-title span {
  font-size: 0.84rem;
  font-weight: 650;
}

.studio-issue-sessions__done-toggle {
  color: rgba(var(--v-theme-on-surface), 0.62);
  margin-left: 0.05rem;
}

.studio-issue-sessions__done-toggle:hover {
  color: rgb(var(--v-theme-primary));
}

.studio-issue-sessions__step-title :deep(.v-chip) {
  font-size: 0.64rem;
  height: 1.15rem;
  padding-inline: 0.32rem;
}

.studio-issue-sessions__step-description {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.74rem;
  line-height: 1.32;
  margin: 0.14rem 0 0;
}

.studio-issue-sessions__step--current .studio-issue-sessions__step-description {
  color: rgba(var(--v-theme-on-surface), 0.82);
}

.studio-issue-sessions__step-action {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: grid;
  gap: 0.45rem;
  margin-top: 0.42rem;
  padding-top: 0.5rem;
}

.studio-issue-sessions__action-buttons,
.studio-issue-sessions__choice-row {
  margin-top: 0.15rem;
}

.studio-issue-sessions__waiting {
  color: rgba(var(--v-theme-on-surface), 0.66);
  display: inline-flex;
  font-size: 0.72rem !important;
  font-weight: 520;
  line-height: 1.18;
  padding: 0;
}

.studio-issue-sessions__monospace :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

@media (max-width: 860px) {
  .studio-issue-sessions__workspace {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .studio-issue-sessions__action-title {
    align-items: stretch;
    flex-direction: column;
  }

}
</style>
