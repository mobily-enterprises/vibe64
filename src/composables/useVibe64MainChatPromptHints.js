import { computed } from "vue";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import {
  promptHintConversationFingerprint,
  useVibe64PromptHints
} from "@/composables/useVibe64PromptHints.js";

/**
 * The main chat's prompt hints: when the composer may ask for them, what they
 * are asked about, and the hint the empty composer previews as its placeholder.
 * @param {import("@/composables/useVibe64AutopilotView.js").Vibe64AutopilotViewParts} view The Autopilot view's state and actions.
 * @param {object} options
 * @param {import("vue").Ref<{ count: number, hasUnresolved: boolean, uploading: boolean }>} options.composerAttachmentState The composer's attachments.
 * @param {(text: string) => boolean} options.onSelect Puts a chosen hint in the composer.
 */
function useVibe64MainChatPromptHints(view, { composerAttachmentState, onSelect }) {
  const {
    agentActive, assistantAccessScopeKey, assistantCanUsePurpose, assistantPurposes, chatTurns, composerDraft,
    composerPlaceholder, composerSending, interrupting, previewAttachmentState, props, repositoryOperationActive,
    saveWorkSending, sessionId, sessionSourceRoot, sourceOperationsSuspended, structuredQuestionActive,
    workspaceSetupRetrying, workspaceSetupRunning, workspaceSetupStatus
  } = view;
  const promptHintsBlankConversation = computed(() => chatTurns.value.length < 1);
  const promptHintsCanRequest = computed(() => Boolean(
    props.active &&
    props.conversationRuntime?.canSubmit.value &&
    !props.conversationLog?.loading &&
    !props.conversationLog?.error &&
    !props.sessionSelectionArchived &&
    sessionId.value &&
    sessionSourceRoot.value &&
    !agentActive.value &&
    !composerSending.value &&
    !interrupting.value &&
    !repositoryOperationActive.value &&
    !saveWorkSending.value &&
    !workspaceSetupRunning.value &&
    !workspaceSetupRetrying.value &&
    !sourceOperationsSuspended.value &&
    (promptHintsBlankConversation.value || assistantCanUsePurpose("prompt_hint")) &&
    !structuredQuestionActive.value &&
    composerAttachmentState.value.count < 1 &&
    !composerAttachmentState.value.uploading &&
    !composerAttachmentState.value.hasUnresolved &&
    !previewAttachmentState.value.captureBusy &&
    !previewAttachmentState.value.diagnosticsBusy
  ));
  const promptHintsConversationKey = computed(() => (
    JSON.stringify([promptHintConversationFingerprint(chatTurns.value), assistantAccessScopeKey.value, assistantPurposes.value.prompt_hint])
  ));
  const promptHintsExistingProject = computed(() => workspaceSetupStatus.value !== "unconfigured");
  const {
    blurComposer: blurPromptHints,
    dismissPromptHints,
    focusComposer: focusPromptHints,
    loading: promptHintsLoading,
    preview: promptHintPreview,
    previewPromptHint,
    selectPromptHint,
    suggestions: promptHintSuggestions,
    visible: promptHintsVisible
  } = useVibe64PromptHints({
    active: computed(() => props.active),
    blankConversation: promptHintsBlankConversation,
    canRequest: promptHintsCanRequest,
    conversationKey: promptHintsConversationKey,
    draft: composerDraft,
    existingProject: promptHintsExistingProject,
    onSelect,
    policy: computed(() => props.promptHintPolicy),
    sessionId,
    sessionsApiPath: computed(() => readRefOrGetterValue(props.sessionsApiPath))
  });
  const composerPromptHintPreview = computed(() => (
    promptHintsVisible.value &&
    !String(composerDraft.value || "").trim() &&
    promptHintPreview.value
      ? promptHintPreview.value
      : ""
  ));
  const composerPromptHintPlaceholder = computed(() => (
    composerPromptHintPreview.value || composerPlaceholder.value
  ));

  return {
    blurPromptHints,
    composerPromptHintPlaceholder,
    composerPromptHintPreview,
    dismissPromptHints,
    focusPromptHints,
    previewPromptHint,
    promptHintSuggestions,
    promptHintsLoading,
    promptHintsVisible,
    selectPromptHint
  };
}

export {
  useVibe64MainChatPromptHints
};
