<template>
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
    @open-page="showOpenedPage"
    @integration-action="runIntegrationRequest"
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
          <v-icon icon="$circleFilled" size="7" color="primary" />
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
                <template #default="{ close: closeChatMode }">
                  <div
                    v-if="composerAccessHint"
                    class="studio-autopilot__settings-access"
                  >
                    <div class="text-body-small" role="status">
                      {{ composerAccessHint }}
                      <v-btn
                        v-if="agentObservationLost && !agentActive" size="small" variant="text"
                        :disabled="composerDisabled || composerSending" @click="closeChatMode(); continueConversation()"
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
                    icon="$add" size="small" variant="text" class="studio-autopilot__composer-action"
                  />
                </template>
                <v-card class="studio-autopilot__composer-menu pa-2" aria-label="Add to message">
                  <v-btn
                    v-if="composerAttachmentsSupported"
                    aria-label="Attach files"
                    class="studio-autopilot__composer-action justify-start"
                    :disabled="!composerAttachmentsEnabled || !attachmentState.canAddFiles"
                    prepend-icon="$attachFile"
                    size="small"
                    title="Attach files"
                    type="button"
                    variant="text"
                    @click="composerInput?.openFilePicker()"
                  >
                    Attach files
                  </v-btn>
                  <v-btn
                    v-if="composerAttachmentsSupported && previewAttachmentState.captureAvailable"
                    aria-label="Attach visible preview"
                    class="studio-autopilot__composer-action justify-start"
                    :aria-busy="previewAttachmentState.captureBusy ? 'true' : undefined"
                    :disabled="!composerAttachmentsEnabled || !attachmentState.canAddFiles || previewAttachmentState.captureBusy"
                    prepend-icon="$preview"
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
                    prepend-icon="$lan"
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
              <Vibe64StarredMenu :bookmarks="fileBookmarks" :project-slug="projectSlug" @open-file="openSourceEditorFile" @open-page="showOpenedPage" />
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
                @saved="props.refreshSessionData(); reloadAssistantAccess()"
              />
              <v-btn
                v-if="approvalMode" ref="composerSendButton"
                class="studio-autopilot__approval-send"
                color="primary" variant="flat" size="small"
                :aria-label="composerSubmitAriaLabel" :title="composerSubmitTitle"
                :disabled="!composerCanSubmit || composerBlocked"
                :loading="composerSubmitMode === 'approval-sending'"
                append-icon="$send"
                @click="sendComposerMessage"
              >
                Send for approval
              </v-btn>
              <Vibe64ComposerDelivery
                v-else ref="composerSendButton"
                :stop-visible="agentStopVisible" :stop-enabled="agentStopEnabled" :stopping="interrupting"
                :can-submit="composerCanSubmit && !composerBlocked && attachmentState.canSubmit"
                :sending="composerSending" :submit-mode="composerSubmitMode"
                :submit-aria-label="composerSubmitAriaLabel" :submit-title="composerSubmitTitle"
                @stop="requestAgentInterrupt" @submit="sendComposerMessage"
              />
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
    :open-file="openWorkingFile"
    :send-lesson-message="sendLessonMessage"
    @select-main-chat="showMainChat"
  />
</template>

<script setup>
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { computed, nextTick, ref, useId, watch } from "vue";
import Vibe64AgentPlanUsage from "@/components/studio/vibe64-session/Vibe64AgentPlanUsage.vue";
import Vibe64RoutingNotice from "./Vibe64RoutingNotice.vue";
import Vibe64WorkPlan from "./Vibe64WorkPlan.vue";
import Vibe64ChatModeControls from "./Vibe64ChatModeControls.vue";
import Vibe64SessionAssistantMenu from "@/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";
import Vibe64StarredMenu from "@/components/studio/vibe64-session/Vibe64StarredMenu.vue";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import { AssistantQuestionInputs, AssistantComposerSupport } from "@jskit-ai/assistant-core/client/conversation";
import Vibe64ConversationLog from "@/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import Vibe64ComposerDelivery from "./Vibe64ComposerDelivery.vue";
import Vibe64MainChatApprovals from "./Vibe64MainChatApprovals.vue";
import Vibe64TemporaryAiWorkspace from "@/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { useVibe64MainChatPromptHints } from "@/composables/useVibe64MainChatPromptHints.js";
import {
  useVibe64SessionTypingPresence
} from "@/composables/useVibe64SessionTypingPresence.js";

// Main chat and its composer, with the temporary AI conversations that can
// take its place.
const { view } = defineProps({
  // The Autopilot view's state and actions. It is never replaced, so its
  // members are read once.
  view: { type: Object, required: true }
});
/** @type {import("@/composables/useVibe64AutopilotView.js").Vibe64AutopilotViewParts} */
const {
  agentActive, agentObservationLost, agentStopEnabled, agentStopVisible, agentWorking, answerChoices,
  approvalMode, assistantAccessError, assistantAccessLoading, assistantCanConfigureRouting,
  assistantPurposes, assistantRestrictionMessage, attachPreviewDiagnostics, cancelOptimisticMessage,
  captureVisiblePreview, chatCollapsed, chatReloading, chatTurns, composerAttachments,
  composerAttachmentsEnabled, composerAttachmentsSupported, composerCanSubmit, composerDisabled,
  composerDraft, composerHint, composerInput, composerKey, composerSending, composerSubmitAriaLabel,
  composerSubmitMode, composerSubmitTitle, connectionRecoveryVisible, conversationFollowLatestKey,
  conversationLogVisible, conversationScrollKey, dismissNumberedQuestions, editOptimisticMessage,
  emptyConversationWelcome, fileBookmarks, interrupting, loadMoreChatTurns, mainChat, mainChatApprovals,
  numberedQuestions, numberedQuestionSelectItems, openIntegrationRequest, openSourceEditorFile,
  openWorkingFile, phoneLayout, previewAttachmentState, projectSlug, props, questionAnswers,
  reasoningActive, reloadAssistantAccess, reloadChatPane, requestAgentInterrupt, resendOptimisticMessage,
  routingRequest, runIntegrationRequest, saveWorkOperationActive, saveWorkSending, selectedAnswerChoice,
  sendLessonMessage, sessionId, sessionSourceRoot, showOpenedPage, sourceOperationsSuspended, submitComposerMessage,
  temporaryAiWorkspace, testApproval, thinkingLabel, thinkingVisible, updateComposerAttachments
} = view;
const conversationView = ref(null);
const composerSendButton = ref(null);
const composerSettingsOpen = ref(false);
const composerSettingsButton = ref(null);
const workPlanViewer = ref(null);
const thinkingStatusId = `studio-autopilot-thinking-${useId()}`;
const composerAttachmentState = ref({
  count: 0,
  hasUnresolved: false,
  uploading: false
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
function showApprovedMessage(entry) {
  mainChat.value?.querySelector(`.vibe64-conversation-log [data-approval-id="${CSS.escape(entry.id)}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
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

const {
  blurPromptHints, composerPromptHintPlaceholder, composerPromptHintPreview, dismissPromptHints, focusPromptHints,
  previewPromptHint, promptHintSuggestions, promptHintsLoading, promptHintsVisible, selectPromptHint
} = useVibe64MainChatPromptHints(view, { composerAttachmentState, onSelect: applyPromptHint });
const composerSupportStatusVisible = computed(() => Boolean(
  composerAssistantLabel.value || promptHintsVisible.value
));

async function sendComposerMessage() {
  if (conversationView.value?.composerBlocked || composerInput.value?.attachmentsCanSubmit() === false) {
    return false;
  }
  stopTypingOnSubmit();
  return submitComposerMessage();
}

async function continueConversation() {
  composerInput.value?.focus();
  if (composerDraft.value.trim() || composerAttachments.value.length) return;
  composerDraft.value = "Continue.";
  await nextTick();
  if (composerCanSubmit.value) await sendComposerMessage();
}

// The send button is Vuetify's button while messages wait for approval, and the delivery footer otherwise.
function focusComposerSendButton() {
  if (approvalMode.value) {
    composerSendButton.value?.$el.focus();
    return;
  }
  composerSendButton.value?.focus();
}

function updateComposerAttachmentState(state) {
  composerAttachmentState.value = {
    count: Number(state.count || 0),
    hasUnresolved: state.hasUnresolved === true,
    uploading: state.uploading === true
  };
}

function focusTargetInside(target, selector) {
  return Boolean(target?.closest(selector));
}

function handleComposerBlur(event) {
  stopTypingOnBlur();
  if (focusTargetInside(
    event.relatedTarget,
    "[data-assistant-composer-support], .studio-autopilot__composer"
  )) {
    return;
  }
  blurPromptHints();
}

function handleComposerRegionFocusOut(event) {
  if (
    event.currentTarget.contains(event.relatedTarget) ||
    focusTargetInside(event.relatedTarget, "[data-assistant-composer-support]")
  ) {
    return;
  }
  blurPromptHints();
}

function handlePromptHintsFocusOut(event) {
  if (
    event.currentTarget.contains(event.relatedTarget) ||
    focusTargetInside(event.relatedTarget, ".studio-autopilot-prompt-textarea")
  ) {
    return;
  }
  blurPromptHints();
}

function dismissPromptHintsAndFocus() {
  composerInput.value?.focus({ preventScroll: true });
  dismissPromptHints();
}

function applyPromptHint(text = "") {
  const suggestion = String(text || "").trim();
  if (!suggestion) {
    return false;
  }
  if (composerDraft.value !== suggestion) {
    composerInput.value?.preserveHeightForNextModelValue();
    composerDraft.value = suggestion;
  }
  void nextTick(() => {
    composerInput.value?.focus({ preventScroll: true });
  });
  return true;
}

async function showMainChat() {
  temporaryAiWorkspace.value?.closeWorkspace();
  await nextTick();
  mainChat.value?.focus({ preventScroll: true });
}
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
.studio-autopilot__conversation {
  grid-row: 3;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__composer {
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
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

@media (pointer: coarse) {
  .studio-autopilot__composer-actions .studio-autopilot__composer-action {
    min-height: 3rem;
    min-width: 3rem;
  }
}
.studio-autopilot__voice-feedback { flex: 1 1 100%; min-width: 0; }
</style>
