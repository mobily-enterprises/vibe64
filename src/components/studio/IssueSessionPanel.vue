<template>
  <v-sheet rounded="lg" class="studio-issue-sessions studio-screen__panel">
    <StudioErrorNotice
      v-if="issueSessionsError"
      title="Issue sessions could not load"
      :error="issueSessionsError"
      compact
      class="mb-3"
    />

    <div v-if="issueSessions.length || canCreateIssueSession" class="studio-issue-sessions__strip">
      <div class="studio-issue-sessions__strip-tabs">
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
      <div
        v-if="canReviewSelectedSessionDiff || canTestSelectedSessionWorktree"
        class="studio-issue-sessions__strip-actions"
      >
        <v-btn
          v-if="canReviewSelectedSessionDiff"
          color="primary"
          variant="flat"
          :prepend-icon="mdiFileCompare"
          :disabled="diffLoading"
          @click="openDiffDialog"
        >
          Review diff
        </v-btn>
        <v-btn
          v-if="canTestSelectedSessionWorktree"
          color="primary"
          variant="flat"
          :prepend-icon="mdiPlayCircleOutline"
          @click="launchSessionAppTest"
        >
          Test worktree
        </v-btn>
      </div>
    </div>

    <v-sheet v-else-if="!issueSessionsLoading" rounded="lg" border class="studio-issue-sessions__empty">
      <p class="text-body-2 text-medium-emphasis mb-0">No sessions yet.</p>
    </v-sheet>

    <IssueSessionConfirmDialog
      v-model="abandonDialogOpen"
      title="Abandon session?"
      body="This will abandon the selected session and close its Codex terminal."
      confirm-label="Abandon"
      :loading="issueSessionBusy"
      @cancel="cancelAbandonSession"
      @confirm="confirmAbandonSession"
    />

    <IssueSessionConfirmDialog
      v-model="rewindDialogOpen"
      title="Rewind session?"
      :body="rewindDialogBody"
      confirm-label="Rewind"
      max-width="34rem"
      :loading="issueSessionBusy"
      @cancel="cancelRewindSession"
      @confirm="confirmRewindSession"
    />

    <IssueSessionDiffDialog
      ref="diffBodyElement"
      v-model="diffDialogOpen"
      :accept-label="selectedStepAction?.buttonLabel || 'Accept changes'"
      :busy="issueSessionBusy"
      :error="diffError"
      :loading="diffLoading"
      :payload="diffPayload"
      :rendered-diff="renderedDiff"
      :show-accept="Boolean(diffUtilityAction)"
      @accept="acceptReviewedChanges"
      @body-click="handleDiffBodyClick"
      @close="closeDiffDialog"
    />

    <div v-if="selectedSession" class="studio-issue-sessions__workspace">
      <section class="studio-issue-sessions__main">
        <IssueSessionTimeline
          :steps="timelineSteps"
          :busy="issueSessionBusy"
          @rewind="requestRewindTimelineStep"
        >
          <template #current-step>
            <v-alert
              v-if="currentStepActionNotice"
              :type="currentStepActionNotice.type"
              density="compact"
              variant="tonal"
            >
              {{ currentStepActionNotice.text }}
            </v-alert>

            <StudioErrorNotice
              v-for="error in selectedSession.errors || []"
              :key="error.code || error.message"
              :error="error"
            />

            <v-alert
              v-for="warning in selectedSession.warnings || []"
              :key="warning.code || warning.message"
              type="warning"
              density="compact"
              variant="tonal"
            >
              {{ warning.message || warning }}
            </v-alert>

            <v-textarea
              v-if="selectedSession.prompt && !isCodexPromptInjection"
              :model-value="selectedSession.prompt"
              label="Prompt"
              variant="outlined"
              density="compact"
              hide-details="auto"
              readonly
              auto-grow
              rows="7"
              class="studio-issue-sessions__monospace"
            />

            <StudioLongTextReview
              v-else-if="isTextStep && selectedTextInputUsesLongTextReview"
              v-model="stepInputValues[selectedStepInput.name]"
              :label="selectedStepInput.label"
              :content-label="longTextContentLabel(selectedStepInput)"
              :placeholder="longTextPlaceholder(selectedStepInput)"
              :review-button-label="longTextReviewButtonLabel(selectedStepInput)"
              :show-submit="activeStepControls.showFormSubmit"
              :submit-disabled="!activeStepControls.canSubmitForm"
              :submit-label="currentActionButtonLabel"
              :submit-loading="issueSessionBusy"
              @submit="submitCurrentForm($event)"
            />

            <v-textarea
              v-else-if="isTextStep && selectedStepInput.multiline"
              v-model="stepInputValues[selectedStepInput.name]"
              :label="selectedStepInput.label"
              :placeholder="selectedStepInput.placeholder || ''"
              variant="outlined"
              density="compact"
              hide-details="auto"
              auto-grow
              rows="4"
            />

            <v-text-field
              v-else-if="isTextStep"
              v-model="stepInputValues[selectedStepInput.name]"
              :label="selectedStepInput.label"
              :placeholder="selectedStepInput.placeholder || ''"
              variant="outlined"
              density="compact"
              hide-details="auto"
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
                  density="compact"
                  hide-details="auto"
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

            <div v-if="isChoiceStep" class="studio-issue-sessions__choice-row">
              <div
                v-if="showUserCheckWorktreeActions"
                class="studio-issue-sessions__user-check-actions"
              >
                <v-btn
                  color="primary"
                  variant="flat"
                  :prepend-icon="mdiFileCompare"
                  :disabled="diffLoading"
                  @click="openDiffDialog"
                >
                  Review diff
                </v-btn>
                <v-btn
                  color="primary"
                  variant="flat"
                  :prepend-icon="mdiPlayCircleOutline"
                  @click="launchSessionAppTest"
                >
                  Test worktree
                </v-btn>
              </div>
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
                  v-for="utilityAction in codexPromptUtilityActions"
                  :key="utilityAction.id || utilityAction.label"
                  color="primary"
                  variant="tonal"
                  :disabled="codexPromptUtilityActionDisabled"
                  :loading="issueSessionBusy"
                  :prepend-icon="mdiRobotOutline"
                  @click="runCodexPromptUtilityAction(utilityAction)"
                >
                  {{ utilityAction.label || "Ask Codex" }}
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
                  @click="submitCurrentForm($event)"
                >
                  {{ currentActionButtonLabel }}
                </v-btn>
                <v-btn
                  v-for="alternateAction in buttonAlternateActions"
                  :key="alternateActionKey(alternateAction)"
                  color="primary"
                  variant="tonal"
                  :disabled="alternateActionDisabled(alternateAction)"
                  :loading="issueSessionBusy"
                  :prepend-icon="mdiClose"
                  @click="runAlternateAction(alternateAction)"
                >
                  {{ alternateActionButtonLabel(alternateAction) }}
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
                    density="compact"
                    hide-details="auto"
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
          </template>
        </IssueSessionTimeline>
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

        <div v-if="showSessionTerminalSwitcher" class="studio-issue-sessions__terminal-toolbar">
          <span>Terminal</span>
          <v-btn-toggle
            v-model="activeSessionTerminalView"
            mandatory
            density="compact"
            variant="tonal"
          >
            <v-btn
              value="codex"
              size="small"
              :prepend-icon="mdiRobotOutline"
            >
              Codex
            </v-btn>
            <v-btn
              value="app_test"
              size="small"
              :prepend-icon="mdiPlayCircleOutline"
            >
              App test
            </v-btn>
          </v-btn-toggle>
        </div>

        <div class="studio-issue-sessions__terminal-stack">
          <IssueSessionStepTerminal
            v-if="selectedSessionSetupTerminalVisible"
            ref="setupTerminalRef"
            :session="selectedSession"
            :visible="true"
            @finished="handleSessionStepTerminalFinished"
          />
          <CodexSessionTerminal
            v-for="terminalSession in terminalSessions"
            v-show="terminalSession.sessionId === selectedSessionId && activeSessionTerminalView === 'codex'"
            :key="terminalSession.sessionId"
            :session="terminalSession"
            :prompt-override="codexPromptOverrideForSession(terminalSession)"
            :prompt-injection-request-key="promptInjectionRequestKeyFor(terminalSession)"
            :visible="terminalSession.sessionId === selectedSessionId && activeSessionTerminalView === 'codex'"
            @input="recordCodexTerminalInput(terminalSession.sessionId, $event)"
            @output="recordCodexTerminalOutput(terminalSession.sessionId, $event)"
            @prompt-injected="recordCodexPromptInjected(terminalSession.sessionId, $event)"
            @prompt-injection-failed="recordCodexPromptInjectionFailed(terminalSession.sessionId, $event)"
            @session-update="applyIssueSessionUpdate"
          />
          <AppTestTerminal
            v-if="sessionAppTestVisible"
            v-show="activeSessionTerminalView === 'app_test'"
            ref="sessionAppTestTerminalRef"
            scope="session"
            title="Test session app"
            :session="selectedSession"
            :visible="sessionAppTestVisible && activeSessionTerminalView === 'app_test'"
            @closed="handleSessionAppTestClosed"
          />
        </div>

        <IssueSessionFacts
          :facts="sessionFactItems"
          :status-color="issueSessionStatusColor(selectedSession.status)"
          :status-label="issueSessionStatusLabel(selectedSession.status)"
          @copy="copyText"
        />
      </aside>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import {
  mdiClose,
  mdiFileDocumentOutline,
  mdiFileCompare,
  mdiFolderOutline,
  mdiGithub,
  mdiIdentifier,
  mdiPlay,
  mdiPlayCircleOutline,
  mdiPlus,
  mdiProgressCheck,
  mdiRobotOutline,
  mdiSend,
  mdiSourceBranch,
} from "@mdi/js";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";
import AppTestTerminal from "@/components/studio/AppTestTerminal.vue";
import IssueSessionStepTerminal from "@/components/studio/IssueSessionStepTerminal.vue";
import IssueSessionConfirmDialog from "@/components/studio/issue-session/IssueSessionConfirmDialog.vue";
import IssueSessionDiffDialog from "@/components/studio/issue-session/IssueSessionDiffDialog.vue";
import IssueSessionFacts from "@/components/studio/issue-session/IssueSessionFacts.vue";
import IssueSessionTimeline from "@/components/studio/issue-session/IssueSessionTimeline.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import StudioLongTextReview from "@/components/studio/StudioLongTextReview.vue";
import { useIssueSessions } from "@/composables/useIssueSessions.js";
import {
  readIssueSessionDiff,
  saveIssueSessionCodexPromptHandoff
} from "@/lib/studioApi.js";
import {
  canUseIssueSessionTerminal,
  isAbandonedIssueSession,
  isClosedIssueSession,
  isOpenIssueSession,
  issueSessionCodexPromptActionLabel,
  issueSessionDisplayTitle,
  issueSessionFacts,
  issueSessionStatusColor,
  issueSessionStatusLabel,
  shouldUseManualIssueSessionCodexPrompt,
  shortIssueSessionId
} from "@/lib/issueSessionViewModel.js";
import {
  groupedIssueSessionSteps,
  issueSessionCurrentStepActionNotice,
  issueSessionDisplayStepId,
  issueSessionTimelineSteps
} from "@/lib/issueSessionTimelineModel.js";
import { buildActiveStepControls } from "@/lib/issueSessionStepControls.js";
import { buildIssueSessionCodexPromptSignature } from "@/lib/issueSessionPromptIdentity.js";

const emit = defineEmits(["title-change"]);

const copyStatus = ref("");
const codexTerminalOutputBySessionId = ref({});
const abandonDialogOpen = ref(false);
const abandonSessionId = ref("");
const rewindDialogOpen = ref(false);
const rewindStepId = ref("");
const rewindStepLabel = ref("");
const diffDialogOpen = ref(false);
const diffError = ref("");
const diffLoading = ref(false);
const diffPayload = ref(null);
const diffBodyElement = ref(null);
const setupTerminalRef = ref(null);
const setupTerminalSessionId = ref("");
const sessionAppTestTerminalRef = ref(null);
const sessionAppTestVisible = ref(false);
const activeSessionTerminalView = ref("codex");
const terminalSessionById = ref({});
const promptInjectionRequestBySessionId = ref({});
const promptInjectionRequestSignatureBySessionId = ref({});
const promptInjectionSignatureBySessionId = ref({});
const promptInjectionOutputStartBySignature = ref({});
const codexPromptOverrideBySessionId = ref({});
const alternateActionInputValues = ref({});

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
  rewindSelectedSession,
  selectSession,
  selectedSession,
  selectedSessionId,
  selectedStepAction,
  selectedStepInput,
  stepDefinitions,
  stepInputValues
} = useIssueSessions();

const INITIAL_ISSUE_PROMPT_STEP_ID = "issue_prompt_rendered";

const orderedStepDefinitions = computed(() => {
  return groupedIssueSessionSteps(stepDefinitions.value || []);
});

const timelineSteps = computed(() => {
  return issueSessionTimelineSteps({
    currentAction: selectedStepAction.value || {},
    currentStepId: displayCurrentStepId.value,
    isOpen: Boolean(selectedSession.value && isOpenIssueSession(selectedSession.value)),
    session: selectedSession.value || {},
    stepDefinitions: stepDefinitions.value || []
  });
});

const sessionFactItems = computed(() => {
  return issueSessionFacts(selectedSession.value || {}, orderedStepDefinitions.value)
    .map((fact) => ({
      ...fact,
      icon: sessionFactIcon(fact.icon)
    }));
});

const selectedSessionTitle = computed(() => {
  return issueSessionDisplayTitle(selectedSession.value || {});
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

const selectedStepAutomationMode = computed(() => {
  return String(selectedStepAction.value?.automation?.mode || "manual").trim() || "manual";
});

const selectedTextInputUsesLongTextReview = computed(() => {
  return selectedSession.value?.currentStep !== INITIAL_ISSUE_PROMPT_STEP_ID &&
    fieldUsesLongTextReview(selectedStepInput.value || {});
});

const selectedSessionNeedsSetupTerminal = computed(() => {
  return selectedStepAutomationMode.value === "terminal";
});

const selectedSessionSetupTerminalVisible = computed(() => {
  return Boolean(
    selectedSessionNeedsSetupTerminal.value &&
    selectedSessionId.value &&
    setupTerminalSessionId.value === selectedSessionId.value
  );
});

const displayCurrentStepId = computed(() => {
  return issueSessionDisplayStepId(selectedSession.value?.currentStep || "", orderedStepDefinitions.value);
});

const hasCodexPromptHandoff = computed(() => {
  return selectedSession.value?.codex?.mode === "inject_prompt";
});

const isCodexPromptInjection = computed(() => {
  return hasCodexPromptHandoff.value && Boolean(selectedSession.value?.prompt);
});

const hasManualCodexPromptAction = computed(() => {
  return shouldUseManualIssueSessionCodexPrompt(selectedSession.value || {}) &&
    !selectedCodexPromptAlreadyRequested.value;
});

const manualCodexPromptButtonLabel = computed(() => {
  return issueSessionCodexPromptActionLabel(selectedSession.value || {});
});

const isReviewDeslopStep = computed(() => {
  return ["review_prompt_rendered", "review_changes_accepted"].includes(selectedSession.value?.currentStep);
});

const activeStepCodexWorking = computed(() => {
  return sessionPromptInjectionPending(selectedSession.value || {});
});

const codexPromptStatusMessage = computed(() => {
  if (!selectedCodexPromptAlreadyRequested.value) {
    return "";
  }
  return "Review the Codex terminal output, then continue when ready.";
});

const showCodexPromptResendButton = computed(() => {
  return false;
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
  if (isReviewDeslopStep.value) {
    return null;
  }
  const actions = selectedStepAction.value?.utilityActions || [];
  return actions.find((action) => action?.kind === "diff") || null;
});

const canReviewSelectedSessionDiff = computed(() => {
  const session = selectedSession.value || {};
  return Boolean(session.sessionId && session.worktreeReady === true && !isClosedIssueSession(session));
});

const canTestSelectedSessionWorktree = computed(() => {
  const session = selectedSession.value || {};
  return Boolean(session.sessionId && session.worktreeReady === true && !isClosedIssueSession(session));
});

const showUserCheckWorktreeActions = computed(() => {
  return selectedStepAction.value?.kind === "user_check" &&
    (canReviewSelectedSessionDiff.value || canTestSelectedSessionWorktree.value);
});

const showSessionTerminalSwitcher = computed(() => {
  return Boolean(sessionAppTestVisible.value && canTestSelectedSessionWorktree.value);
});

const codexPromptUtilityActions = computed(() => {
  const actions = selectedStepAction.value?.utilityActions || [];
  return actions.filter((action) => action?.kind === "codex_prompt");
});

const codexPromptUtilityActionDisabled = computed(() => {
  return selectedSessionTerminalBlocked.value || issueSessionBusy.value || activeStepCodexWorking.value;
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
    return action.presentation !== "exclusive";
  });
});

const buttonAlternateActions = computed(() => {
  return activeAlternateActions.value.filter((action) => {
    const inputType = String(action?.input?.type || "none").trim();
    return inputType === "none";
  });
});

function utilityActionPayload(action = {}) {
  const submitOptions = action.submitOptions && typeof action.submitOptions === "object"
    ? action.submitOptions
    : {};
  return { ...submitOptions };
}

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

const rewindDialogBody = computed(() => {
  return `Rewind to ${rewindStepLabel.value} and delete that step plus later JSKIT step state and artifacts.`;
});

function persistedPromptHandoffSignature(session = {}) {
  return String(session.codexPromptHandoffSignature || "").trim();
}

function sessionHasPersistedPromptHandoff(session = {}) {
  const signature = codexPromptRequestSignature(session);
  return Boolean(signature && persistedPromptHandoffSignature(session) === signature);
}

function sessionPromptAlreadyInjected(session = {}) {
  const sessionId = session.sessionId || "";
  const signature = codexPromptRequestSignature(session);
  return Boolean(
    sessionId &&
    signature &&
    (
      promptInjectionSignatureBySessionId.value[sessionId] === signature ||
      persistedPromptHandoffSignature(session) === signature
    )
  );
}

function sessionPromptInjectionPending(session = {}) {
  const sessionId = session.sessionId || "";
  const signature = codexPromptRequestSignature(session);
  return Boolean(
    sessionId &&
    signature &&
    promptInjectionRequestBySessionId.value[sessionId] &&
    promptInjectionRequestSignatureBySessionId.value[sessionId] === signature
  );
}

function sessionPromptAlreadyRequested(session = {}) {
  return sessionPromptAlreadyInjected(session) || sessionPromptInjectionPending(session);
}

const selectedCodexPromptAlreadyRequested = computed(() => {
  return sessionPromptAlreadyRequested(selectedSession.value || {});
});

const codexPromptRequestedMessage = computed(() => {
  if (!selectedCodexPromptAlreadyRequested.value) {
    return "";
  }
  if (selectedSession.value?.codex?.promptWaitingText) {
    return "";
  }
  return `${manualCodexPromptButtonLabel.value} requested.`;
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
    automationMode: selectedStepAutomationMode.value,
    busy: issueSessionBusy.value || selectedSessionSetupTerminalVisible.value,
    canRunAction: canRunAction.value,
    codexPromptAlreadyRequested: selectedCodexPromptAlreadyRequested.value,
    codexPromptInjectionReady: isCodexPromptInjection.value,
    codexWorking: activeStepCodexWorking.value,
    hasChoiceForm: isChoiceStep.value,
    hasExclusiveTextAlternateAction: exclusiveTextAlternateActions.value.length > 0,
    hasTextForm: isTextStep.value,
    isTerminalSession: isTerminalSession.value,
    selectedSessionId: selectedSession.value?.sessionId || "",
    selectedSessionNeedsSetupTerminal: selectedSessionNeedsSetupTerminal.value,
    selectedStepInputType: selectedStepInput.value?.type || "none",
    terminalBlocked: selectedSessionNeedsSetupTerminal.value ? false : selectedSessionTerminalBlocked.value
  });
});

const currentActionButtonLabel = computed(() => {
  return selectedStepAction.value?.label || selectedStepAction.value?.buttonLabel || "Run Step";
});

const executeStepButtonLabel = computed(() => {
  if (
    selectedStepAction.value?.kind === "codex_prompt" &&
    selectedStepAutomationMode.value === "codex_prompt" &&
    !selectedCodexPromptAlreadyRequested.value
  ) {
    return "Start task";
  }
  return currentActionButtonLabel.value || "Execute step";
});

function shortSessionId(sessionId) {
  return shortIssueSessionId(sessionId);
}

function sessionFactIcon(icon) {
  return {
    blueprint: mdiFileDocumentOutline,
    branch: mdiSourceBranch,
    codex: mdiRobotOutline,
    github: mdiGithub,
    report: mdiFileDocumentOutline,
    session: mdiIdentifier,
    step: mdiProgressCheck,
    worktree: mdiFolderOutline
  }[icon] || mdiIdentifier;
}

function fieldUsesLongTextReview(field = {}) {
  return field.multiline === true || field.formatHint === "markdown";
}

function longTextContentLabel(field = {}) {
  const extract = String(field.extract || "").trim();
  if (extract === "issue_text") {
    return "issue body";
  }
  const label = String(field.label || field.field || field.name || "text").trim()
    .replace(/^approved\s+/iu, "")
    .replace(/\s+from\s+codex$/iu, "");
  return label || "text";
}

function longTextPlaceholder(field = {}) {
  if (field.placeholder) {
    return field.placeholder;
  }
  return `Paste or edit the approved ${longTextContentLabel(field)}.`;
}

function longTextReviewButtonLabel(field = {}) {
  return `Review full ${longTextContentLabel(field)}`;
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
  return String(action.title || action.label || "Optional path").trim();
}

function alternateActionHelp(action = {}) {
  return String(action.helpText || "Provide the extra context required for this alternate path.").trim();
}

function alternateActionPlaceholder(action = {}) {
  return String(action.input?.placeholder || "").trim();
}

function alternateActionButtonLabel(action = {}) {
  return String(action.label || action.buttonLabel || "Run action").trim();
}

function alternateActionDisabled(action = {}) {
  const inputType = String(action?.input?.type || "none").trim();
  if (inputType === "none") {
    return issueSessionBusy.value || activeStepCodexWorking.value;
  }
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

function defaultStepPayload() {
  const submitOptions = selectedStepAction.value?.submitOptions;
  return submitOptions && typeof submitOptions === "object" && !Array.isArray(submitOptions)
    ? { ...submitOptions }
    : {};
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

function codexPromptRequestSignature(session = {}) {
  const prompt = codexPromptTextForSession(session);
  return buildIssueSessionCodexPromptSignature({
    activeCycle: session?.activeCycle || "",
    currentReviewPass: session?.currentReviewPass || "",
    prompt,
    sessionId: session?.sessionId || ""
  });
}

function trackCodexPromptInjection(session = {}, event = {}) {
  const sessionId = session.sessionId || "";
  const signature = codexPromptRequestSignature(session);
  if (!sessionId || !signature) {
    return "";
  }
  const currentOutput = String(codexTerminalOutputBySessionId.value[sessionId] || "");
  const eventHasSnapshot = Object.prototype.hasOwnProperty.call(event, "outputSnapshot");
  const outputSnapshot = eventHasSnapshot ? String(event.outputSnapshot || "") : currentOutput;
  const eventOutputStart = Number(event.outputStart);
  const outputStart = Number.isInteger(eventOutputStart) && eventOutputStart >= 0
    ? eventOutputStart
    : outputSnapshot.length;
  promptInjectionSignatureBySessionId.value = {
    ...promptInjectionSignatureBySessionId.value,
    [sessionId]: signature
  };
  promptInjectionOutputStartBySignature.value = {
    ...promptInjectionOutputStartBySignature.value,
    [signature]: outputStart
  };
  return signature;
}

function hydratePersistedCodexPromptInjection(session = {}, {
  output = null
} = {}) {
  const sessionId = session.sessionId || "";
  const signature = codexPromptRequestSignature(session);
  const currentOutput = String(output ?? codexTerminalOutputBySessionId.value[sessionId] ?? "");
  if (
    !sessionId ||
    !signature ||
    promptInjectionSignatureBySessionId.value[sessionId] === signature ||
    !sessionHasPersistedPromptHandoff(session)
  ) {
    return "";
  }

  const persistedOutputStart = Number(session.codexPromptHandoffOutputStart);
  const outputStart = Number.isSafeInteger(persistedOutputStart) &&
    persistedOutputStart >= 0 &&
    persistedOutputStart <= currentOutput.length
    ? persistedOutputStart
    : 0;
  promptInjectionSignatureBySessionId.value = {
    ...promptInjectionSignatureBySessionId.value,
    [sessionId]: signature
  };
  promptInjectionOutputStartBySignature.value = {
    ...promptInjectionOutputStartBySignature.value,
    [signature]: outputStart
  };
  return signature;
}

function disposeCodexCompletionWatchersForSession(sessionId) {
  void sessionId;
}

function canAbandonSessionFromChip(session = {}) {
  return session.sessionId === selectedSessionId.value && !isClosedIssueSession(session);
}

const currentStepActionNotice = computed(() => {
  return issueSessionCurrentStepActionNotice(selectedStepAction.value || {});
});

async function copyText(value, label) {
  try {
    await navigator.clipboard.writeText(String(value || ""));
    copyStatus.value = `${label} copied.`;
  } catch (copyError) {
    copyStatus.value = String(copyError?.message || copyError || "Copy failed.");
  }
}

async function launchSessionAppTest() {
  if (!canTestSelectedSessionWorktree.value) {
    return;
  }
  activeSessionTerminalView.value = "app_test";
  sessionAppTestVisible.value = true;
  await nextTick();
  await sessionAppTestTerminalRef.value?.start?.();
}

function handleSessionAppTestClosed() {
  sessionAppTestVisible.value = false;
  activeSessionTerminalView.value = "codex";
}

function runChoiceStep(value) {
  const inputName = selectedStepInput.value?.name;
  if (!inputName) {
    return;
  }
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
    [sessionId]: _promptInjectionRequestSignature,
    ...remainingPromptInjectionRequestSignatures
  } = promptInjectionRequestSignatureBySessionId.value;
  const {
    [sessionId]: _promptInjectionSignature,
    ...remainingPromptInjectionSignatures
  } = promptInjectionSignatureBySessionId.value;
  const {
    [sessionId]: _codexPromptOverride,
    ...remainingCodexPromptOverrides
  } = codexPromptOverrideBySessionId.value;
  terminalSessionById.value = remainingTerminalSessions;
  codexTerminalOutputBySessionId.value = remainingTerminalOutputs;
  promptInjectionRequestBySessionId.value = remainingPromptInjectionRequests;
  promptInjectionRequestSignatureBySessionId.value = remainingPromptInjectionRequestSignatures;
  promptInjectionSignatureBySessionId.value = remainingPromptInjectionSignatures;
  promptInjectionOutputStartBySignature.value = Object.fromEntries(
    Object.entries(promptInjectionOutputStartBySignature.value)
      .filter(([key]) => !key.startsWith(`${sessionId}:`))
  );
  codexPromptOverrideBySessionId.value = remainingCodexPromptOverrides;
  alternateActionInputValues.value = Object.fromEntries(
    Object.entries(alternateActionInputValues.value)
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
  promptInjectionRequestSignatureBySessionId.value = Object.fromEntries(
    Object.entries(promptInjectionRequestSignatureBySessionId.value).filter(([sessionId]) => sessionIds.has(sessionId))
  );
  promptInjectionSignatureBySessionId.value = Object.fromEntries(
    Object.entries(promptInjectionSignatureBySessionId.value).filter(([sessionId]) => sessionIds.has(sessionId))
  );
  promptInjectionOutputStartBySignature.value = Object.fromEntries(
    Object.entries(promptInjectionOutputStartBySignature.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
  codexPromptOverrideBySessionId.value = Object.fromEntries(
    Object.entries(codexPromptOverrideBySessionId.value).filter(([sessionId]) => sessionIds.has(sessionId))
  );
  alternateActionInputValues.value = Object.fromEntries(
    Object.entries(alternateActionInputValues.value)
      .filter(([key]) => sessionIds.has(key.split(":")[0]))
  );
}

function recordCodexTerminalOutput(sessionId, output) {
  const nextOutput = String(output || "");
  codexTerminalOutputBySessionId.value = {
    ...codexTerminalOutputBySessionId.value,
    [sessionId]: nextOutput
  };
}

function recordCodexTerminalInput(sessionId) {
  void sessionId;
}

function recordCodexPromptInjected(sessionId, event = {}) {
  const existingSession = sessionId === selectedSessionId.value && selectedSession.value?.sessionId === sessionId
    ? selectedSession.value
    : terminalSessionById.value[sessionId] || {};
  const eventPrompt = String(event?.prompt || "");
  const currentSessionPrompt = codexPromptTextForSession(existingSession);
  const trackedSession = {
    ...existingSession,
    sessionId,
    ...(eventPrompt
      ? {
        codex: {
          ...(existingSession.codex || {}),
          promptField: "prompt"
        },
        prompt: eventPrompt
      }
      : {})
  };
  const signature = trackCodexPromptInjection(trackedSession, event);
  if (signature && (!eventPrompt || eventPrompt === currentSessionPrompt)) {
    void saveIssueSessionCodexPromptHandoff(sessionId, {
      outputStart: promptInjectionOutputStartBySignature.value[signature] || 0,
      signature
    }).then((response) => {
      if (response?.ok === false) {
        copyStatus.value = response.error || "Codex prompt handoff could not be saved for reload recovery.";
      }
    }).catch((error) => {
      copyStatus.value = String(error?.message || error || "Codex prompt handoff could not be saved for reload recovery.");
    });
    applyIssueSessionUpdate({
      codexPromptHandoffOutputStart: promptInjectionOutputStartBySignature.value[signature] || 0,
      codexPromptHandoffSignature: signature,
      sessionId
    });
  }
  clearPromptInjectionRequest(sessionId);
  if (codexPromptOverrideBySessionId.value[sessionId]) {
    const {
      [sessionId]: _sentOverride,
      ...remainingOverrides
    } = codexPromptOverrideBySessionId.value;
    codexPromptOverrideBySessionId.value = remainingOverrides;
  }
}

function clearPromptInjectionRequest(sessionId) {
  if (!sessionId) {
    return;
  }
  const {
    [sessionId]: _request,
    ...remainingRequests
  } = promptInjectionRequestBySessionId.value;
  const {
    [sessionId]: _requestSignature,
    ...remainingRequestSignatures
  } = promptInjectionRequestSignatureBySessionId.value;
  promptInjectionRequestBySessionId.value = remainingRequests;
  promptInjectionRequestSignatureBySessionId.value = remainingRequestSignatures;
}

function recordCodexPromptInjectionFailed(sessionId, event = {}) {
  const requestKey = promptInjectionRequestBySessionId.value[sessionId] || "";
  if (event?.requestKey && event.requestKey !== requestKey) {
    return;
  }
  clearPromptInjectionRequest(sessionId);
  copyStatus.value = String(event?.error || "Codex prompt injection failed.");
}

function applyIssueSessionUpdate(patch = {}) {
  const patchedSession = patchIssueSession(patch);
  rememberTerminalSession(patchedSession || {
    ...(terminalSessionById.value[patch?.sessionId] || {}),
    ...patch
  });
}

async function resendCurrentCodexPromptRequest() {
  const session = selectedSession.value || {};
  const sessionId = session.sessionId || "";
  const prompt = codexPromptTextForSession(session);
  if (!sessionId || !prompt || selectedSessionTerminalBlocked.value || issueSessionBusy.value) {
    return;
  }
  await injectCodexPromptText(session, prompt);
}

async function handleStepResponse(response, {
  forcePromptInjection = false
} = {}) {
  rememberTerminalSession(response);
  if (
    response?.prompt &&
    (
      forcePromptInjection ||
      (response?.ok === false && response?.codex?.autoInject === true)
    )
  ) {
    await requestCodexPromptInjection(response);
  }
  return response;
}

async function runAlternateAction(action = {}) {
  if (alternateActionDisabled(action)) {
    return;
  }
  const response = await runSelectedStep(alternateActionPayload(action));
  clearAlternateActionDraft(action);
  await handleStepResponse(response);
}

async function runCodexPromptUtilityAction(action = {}) {
  if (codexPromptUtilityActionDisabled.value) {
    return;
  }
  const response = await runSelectedStep(utilityActionPayload(action));
  await handleStepResponse(response, {
    forcePromptInjection: true
  });
}

async function goToNextStep() {
  if (!activeStepControls.value.canGoNext) {
    return;
  }
  const response = await runSelectedStep(defaultStepPayload());
  await handleStepResponse(response);
}

async function executeCurrentStep() {
  if (!activeStepControls.value.canExecuteStep) {
    return;
  }
  if (selectedSessionNeedsSetupTerminal.value) {
    setupTerminalSessionId.value = selectedSessionId.value;
    await nextTick();
    await setupTerminalRef.value?.start?.();
    return;
  }
  if (
    isCodexPromptInjection.value &&
    !selectedCodexPromptAlreadyRequested.value &&
    selectedSession.value?.prompt &&
    selectedStepAction.value?.kind === "codex_prompt"
  ) {
    await requestCodexPromptInjection();
    return;
  }
  const response = await runSelectedStep(defaultStepPayload());
  await handleStepResponse(response, {
    forcePromptInjection: Boolean(
      selectedStepAction.value?.kind === "codex_prompt" &&
      response?.prompt &&
      response?.codex?.autoInject === true
    ),
    runAutomaticFollowUps: false
  });
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

function requestRewindStep(timelineStep = {}) {
  const targetStepId = timelineStep.rewindStepId || "";
  if (!targetStepId) {
    return;
  }
  rewindStepId.value = targetStepId;
  rewindStepLabel.value = timelineStep.rewindLabel || targetStepId;
  rewindDialogOpen.value = true;
}

function requestRewindTimelineStep(timelineStep = {}) {
  if (timelineStep?.rewindStepId) {
    requestRewindStep(timelineStep);
  }
}

function cancelRewindSession() {
  rewindDialogOpen.value = false;
  rewindStepId.value = "";
  rewindStepLabel.value = "";
}

async function confirmRewindSession() {
  const rewoundSessionId = selectedSessionId.value;
  const targetStepId = rewindStepId.value;
  if (!rewoundSessionId || !targetStepId) {
    cancelRewindSession();
    return;
  }
  const response = await rewindSelectedSession(targetStepId);
  if (response?.ok === false) {
    return;
  }
  forgetTerminalSession(rewoundSessionId);
  cancelRewindSession();
}

async function handleSessionStepTerminalFinished(event = {}) {
  if (!event.sessionId || event.sessionId !== selectedSessionId.value) {
    return;
  }
  await selectSession(event.sessionId, { preserveList: true });
  await loadIssueSessions();
  if (Number(event.exitCode) === 0) {
    setupTerminalSessionId.value = "";
  }
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
  const exposedBody = diffBodyElement.value?.bodyElement;
  const diffBody = exposedBody?.$el || exposedBody || diffBodyElement.value?.$el || diffBodyElement.value;
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
  const response = await runSelectedStep();
  await handleStepResponse(response);
  if (response?.ok !== false) {
    closeDiffDialog();
  }
}

async function requestCodexPromptInjection(sessionOverride = null) {
  const session = sessionOverride?.sessionId ? sessionOverride : selectedSession.value || {};
  const sessionId = session.sessionId || "";
  const signature = codexPromptRequestSignature(session);
  if (!sessionId || selectedSessionTerminalBlocked.value) {
    copyStatus.value = selectedSessionTerminalBlocked.value
      ? "Open terminal limit reached."
      : "No active session is selected.";
    return;
  }
  if (!signature) {
    copyStatus.value = "No Codex prompt is ready for this step.";
    return;
  }
  activeSessionTerminalView.value = "codex";
  rememberTerminalSession(session);
  await nextTick();
  const requestKey = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  promptInjectionRequestBySessionId.value = {
    ...promptInjectionRequestBySessionId.value,
    [sessionId]: requestKey
  };
  promptInjectionRequestSignatureBySessionId.value = {
    ...promptInjectionRequestSignatureBySessionId.value,
    [sessionId]: signature
  };
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

function submitCurrentForm(event = null) {
  if (event?.isTrusted !== true) {
    return;
  }
  void runSelectedStep().then((response) => handleStepResponse(response));
}

watch(selectedSession, (session) => {
  rememberTerminalSession(session);
  hydratePersistedCodexPromptInjection(session || {});
}, {
  immediate: true
});

watch(selectedSessionTitle, (title) => {
  emit("title-change", title);
}, {
  immediate: true
});

watch(selectedSessionId, () => {
  if (!sessionAppTestVisible.value) {
    activeSessionTerminalView.value = "codex";
    return;
  }
  void sessionAppTestTerminalRef.value?.closeTerminal?.();
  sessionAppTestVisible.value = false;
  activeSessionTerminalView.value = "codex";
});

watch(issueSessions, () => {
  pruneTerminalSessions();
});

onMounted(() => {
  void loadIssueSessions();
});

onBeforeUnmount(() => {
  emit("title-change", "");
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

.studio-issue-sessions__codex-output-wait {
  display: grid;
  gap: 0.38rem;
}

.studio-issue-sessions__action-stack {
  display: grid;
  gap: 0.38rem;
}

.studio-issue-sessions__alternate-actions {
  display: grid;
  gap: 0.45rem;
}

.studio-issue-sessions__alternate-action {
  background: rgba(var(--v-theme-surface-variant), 0.34);
  border: 1px solid rgba(var(--v-border-color), 0.34);
  border-radius: 8px;
  display: grid;
  gap: 0.4rem;
  padding: 0.5rem;
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
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  min-width: 0;
}

.studio-issue-sessions__strip-tabs {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  gap: 0.5rem;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 0.125rem;
}

.studio-issue-sessions__strip-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-height: 2.5rem;
}

.studio-issue-sessions__strip-actions :deep(.v-btn),
.studio-issue-sessions__user-check-actions :deep(.v-btn) {
  min-height: 2.35rem;
}

.studio-issue-sessions__user-check-actions {
  align-items: center;
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 0.5rem;
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
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.studio-issue-sessions__terminal-toolbar {
  align-items: center;
  display: flex;
  gap: 0.65rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-issue-sessions__terminal-toolbar > span {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.studio-issue-sessions__action-buttons,
.studio-issue-sessions__choice-row {
  margin-top: 0.05rem;
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
