import {
  normalizedDraftFields
} from "@/composables/vibe64-session/composer/composerDraftFields.js";
import {
  createRemoteComposerOptimisticTurn
} from "@/lib/vibe64ComposerOptimisticTurn.js";
import {
  createComposerSubmissionId,
  optimisticComposerTurnIsLocalPending
} from "@/lib/vibe64ComposerSubmissionState.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function canonicalHandoffAcknowledgesOptimisticTurn(handoff = {}, optimistic = {}) {
  const submissionId = String(handoff?.submissionId || "").trim();
  return Boolean(
    handoff?.canonical === true &&
    submissionId &&
    submissionId === String(optimistic?.id || "").trim()
  );
}

function useVibe64ComposerHandoffState({
  actionsClear = () => null,
  clearSelectedComposerDraft = () => false,
  composerHandoff = null,
  composerDraftSync = () => null,
  composerDraftSyncFieldName = () => "",
  composerDraftSyncFields = (fields) => fields,
  controlForComposerPayload = () => null,
  conversationComposerDraft = "",
  conversationComposerDraftTextFromFields = () => "",
  conversationComposerFallbackDraft,
  optimisticComposerTurn,
  optimisticTextFromSubmission = () => "",
  payloadUsesConversationComposer = () => false,
  primaryIntentId = "",
  remoteComposerSubmission,
  restoreControlDraft = () => null,
  runWorkflowControl = async () => false,
  selectedComposerDraftText = () => "",
  setConversationComposerDraft = () => false
} = {}) {
  let optimisticComposerTurnCounter = 0;

  function activeDraftSync() {
    return readRefOrGetterValue(composerDraftSync);
  }

  function projectPendingRemoteSubmission() {
    const remote = remoteComposerSubmission.value;
    if (remote?.status !== "pending" || !remote.optimisticTurn) {
      return false;
    }
    const current = optimisticComposerTurn.value;
    if (current && current.remote !== true) {
      return false;
    }
    optimisticComposerTurn.value = remote.optimisticTurn;
    return true;
  }

  function clearRemoteComposerSubmissionIfCanonical() {
    const submission = remoteComposerSubmission.value;
    if (submission?.status !== "pending") {
      return false;
    }
    if (!canonicalHandoffAcknowledgesOptimisticTurn(
      readRefOrGetterValue(composerHandoff) || {},
      submission
    )) {
      return false;
    }
    remoteComposerSubmission.value = null;
    if (
      optimisticComposerTurn.value?.remote === true &&
      optimisticComposerTurn.value.id === submission.id
    ) {
      optimisticComposerTurn.value = null;
    }
    return true;
  }

  function clearLocalComposerSubmissionIfCanonical() {
    const optimistic = optimisticComposerTurn.value;
    if (optimistic?.remote === true) {
      return false;
    }
    if (canonicalHandoffAcknowledgesOptimisticTurn(
      readRefOrGetterValue(composerHandoff) || {},
      optimistic
    )) {
      optimisticComposerTurn.value = null;
      projectPendingRemoteSubmission();
      return true;
    }
    return false;
  }

  function applyRemoteComposerSubmissionStart(fields = {}, payload = {}) {
    const text = String(payload?.text || "").trim();
    const submissionId = String(payload?.submissionId || "").trim();
    if (!text || !submissionId) {
      return false;
    }
    const control = controlForComposerPayload(payload);
    const submissionFields = normalizedDraftFields(fields);
    const optimisticTurn = createRemoteComposerOptimisticTurn({
      control,
      fields: submissionFields,
      id: submissionId,
      payload,
      text
    });
    remoteComposerSubmission.value = {
      controlId: String(payload?.controlId || control?.id || ""),
      fields: submissionFields,
      id: submissionId,
      optimisticTurn,
      status: "pending",
      text,
      updatedAt: String(payload?.updatedAt || "")
    };
    if (payloadUsesConversationComposer(payload)) {
      if (text && String(readRefOrGetterValue(conversationComposerDraft) || "").trim() === text) {
        setConversationComposerDraft("");
      }
    } else if (text && selectedComposerDraftText() === text) {
      clearSelectedComposerDraft(control);
    }
    projectPendingRemoteSubmission();
    return true;
  }

  function applyRemoteComposerSubmissionRejected(fields = {}, payload = {}) {
    const submissionId = String(payload?.submissionId || "").trim();
    if (!submissionId || remoteComposerSubmission.value?.id !== submissionId) {
      return false;
    }
    const control = controlForComposerPayload(payload);
    const text = String(payload?.text || "").trim();
    if (
      optimisticComposerTurn.value?.remote === true &&
      optimisticComposerTurn.value.id === submissionId
    ) {
      optimisticComposerTurn.value = null;
    }
    remoteComposerSubmission.value = null;
    if (payloadUsesConversationComposer(payload)) {
      setConversationComposerDraft(conversationComposerDraftTextFromFields(fields) || text);
      return true;
    }
    if (control?.id && Array.isArray(control.inputFields)) {
      restoreControlDraft(control, fields);
      if (String(control.id || "") === String(readRefOrGetterValue(primaryIntentId) || "")) {
        conversationComposerFallbackDraft.value = "";
      }
    }
    return true;
  }

  function startOptimisticComposerTurn({
    control = {},
    options = {},
    values = {}
  } = {}) {
    const text = optimisticTextFromSubmission(options);
    if (!text) {
      return null;
    }
    const syncedFields = composerDraftSyncFields(values);
    optimisticComposerTurnCounter += 1;
    const id = createComposerSubmissionId({
      sequence: optimisticComposerTurnCounter
    });
    activeDraftSync()?.publishSubmissionStart?.(
      composerDraftSyncFieldName(syncedFields),
      syncedFields,
      {
        submissionId: id,
        text
      }
    );
    const sourceOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    optimisticComposerTurn.value = {
      control,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      error: "",
      id,
      options: {
        ...sourceOptions,
        composerSubmissionId: id,
        displayFields: normalizedDraftFields(sourceOptions.displayFields),
        fields: normalizedDraftFields(sourceOptions.fields)
      },
      status: "pending",
      text,
      values: normalizedDraftFields(values)
    };
    return id;
  }

  function markOptimisticComposerTurnFailed(submissionId = "", {
    error = null
  } = {}) {
    if (!submissionId || optimisticComposerTurn.value?.id !== submissionId) {
      return;
    }
    const optimistic = optimisticComposerTurn.value;
    optimisticComposerTurn.value = {
      ...optimistic,
      error: String(error?.message || error || "Message could not be sent."),
      status: "failed"
    };
    const syncedFields = composerDraftSyncFields(optimistic.values);
    activeDraftSync()?.publishSubmissionRejected?.(
      composerDraftSyncFieldName(syncedFields),
      syncedFields,
      {
        submissionId,
        text: optimistic.text
      }
    );
    restoreControlDraft(optimistic.control, optimistic.values);
    if (String(optimistic.control?.id || "") === String(readRefOrGetterValue(primaryIntentId) || "")) {
      conversationComposerFallbackDraft.value = "";
    }
  }

  function failLocalComposerSubmissionForLifecycleDisconnect() {
    const optimistic = optimisticComposerTurn.value;
    if (optimisticComposerTurnIsLocalPending(optimistic)) {
      markOptimisticComposerTurnFailed(optimistic.id, {
        error: "Vibe64 restarted before this message reached the assistant. Use Resend when the server is back."
      });
    }
    actionsClear();
  }

  function clearOptimisticComposerTurn(submissionId = "") {
    if (!submissionId || optimisticComposerTurn.value?.id !== submissionId) {
      return false;
    }
    optimisticComposerTurn.value = null;
    projectPendingRemoteSubmission();
    return true;
  }

  async function resendOptimisticComposerTurn(submissionId = "") {
    const optimistic = optimisticComposerTurn.value;
    if (!optimistic || optimistic.id !== submissionId || optimistic.status !== "failed") {
      return false;
    }
    optimisticComposerTurn.value = {
      ...optimistic,
      error: "",
      status: "pending"
    };
    let accepted = false;
    try {
      accepted = await runWorkflowControl(optimistic.control, optimistic.options);
    } catch (error) {
      markOptimisticComposerTurnFailed(submissionId, {
        error
      });
      return false;
    }
    if (accepted === false) {
      markOptimisticComposerTurnFailed(submissionId);
      return false;
    }
    return true;
  }

  function editOptimisticComposerTurn(submissionId = "") {
    const optimistic = optimisticComposerTurn.value;
    if (!optimistic || optimistic.id !== submissionId) {
      return false;
    }
    restoreControlDraft(optimistic.control, optimistic.values);
    optimisticComposerTurn.value = null;
    projectPendingRemoteSubmission();
    return true;
  }

  return {
    applyRemoteComposerSubmissionRejected,
    applyRemoteComposerSubmissionStart,
    clearLocalComposerSubmissionIfCanonical,
    clearOptimisticComposerTurn,
    clearRemoteComposerSubmissionIfCanonical,
    editOptimisticComposerTurn,
    failLocalComposerSubmissionForLifecycleDisconnect,
    markOptimisticComposerTurnFailed,
    resendOptimisticComposerTurn,
    startOptimisticComposerTurn
  };
}

export {
  canonicalHandoffAcknowledgesOptimisticTurn,
  useVibe64ComposerHandoffState
};
