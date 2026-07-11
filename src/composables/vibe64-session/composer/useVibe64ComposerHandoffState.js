import {
  normalizedDraftFields
} from "@/composables/vibe64-session/composer/composerDraftFields.js";
import {
  createRemoteComposerOptimisticTurn,
  unmatchedOptimisticComposerTurns
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

function optimisticComposerMessageFromDelivery(delivery = {}, {
  fallbackAfterSubmissionId = ""
} = {}) {
  const id = String(delivery?.id || "").trim();
  const message = String(delivery?.message || "").trim();
  const state = String(delivery?.state || "").trim();
  if (
    !id ||
    !message ||
    !["accepted", "failed"].includes(state)
  ) {
    return null;
  }
  const displayMessage = String(delivery?.displayMessage || message).trim();
  const createdAt = String(delivery?.submittedAt || "").trim() || new Date().toISOString();
  const parsedCreatedAtMs = Date.parse(createdAt);
  return {
    afterSubmissionId: String(delivery?.afterSubmissionId || fallbackAfterSubmissionId).trim(),
    control: {},
    createdAt,
    createdAtMs: Number.isNaN(parsedCreatedAtMs) ? Date.now() : parsedCreatedAtMs,
    error: state === "failed"
      ? String(delivery?.error || "Message could not be sent.")
      : "",
    id,
    options: {
      composerSubmissionId: id,
      displayFields: {
        conversationRequest: displayMessage
      },
      fields: {
        conversationRequest: message
      },
      message
    },
    remote: true,
    status: state === "failed" ? "failed" : "pending",
    messageDelivery: true,
    text: displayMessage,
    values: {
      conversationRequest: displayMessage
    }
  };
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
  optimisticComposerMessages = { value: [] },
  optimisticTextFromSubmission = () => "",
  payloadUsesConversationComposer = () => false,
  primaryIntentId = "",
  remoteComposerSubmission,
  restoreControlDraft = () => null,
  runWorkflowControl = async () => false,
  selectedComposerDraftText = () => "",
  sendAgentMessage = async () => false,
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
    afterSubmissionId = "",
    control = {},
    messageDelivery = false,
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
    const optimisticTurn = {
      afterSubmissionId: String(afterSubmissionId || "").trim(),
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
      messageDelivery: messageDelivery === true,
      status: "pending",
      text,
      values: normalizedDraftFields(values)
    };
    if (optimisticTurn.messageDelivery) {
      optimisticComposerMessages.value = [
        ...optimisticComposerMessages.value,
        optimisticTurn
      ];
    } else {
      optimisticComposerTurn.value = optimisticTurn;
    }
    return id;
  }

  function markOptimisticComposerTurnFailed(submissionId = "", {
    error = null,
    restoreDraft = true
  } = {}) {
    const messageIndex = optimisticComposerMessages.value
      .findIndex((turn) => turn.id === submissionId);
    const optimistic = optimisticComposerTurn.value?.id === submissionId
      ? optimisticComposerTurn.value
      : optimisticComposerMessages.value[messageIndex];
    if (!submissionId || !optimistic) {
      return;
    }
    const failed = {
      ...optimistic,
      error: String(error?.message || error || "Message could not be sent."),
      status: "failed"
    };
    if (messageIndex >= 0) {
      optimisticComposerMessages.value = optimisticComposerMessages.value.map((turn, index) => (
        index === messageIndex ? failed : turn
      ));
    } else {
      optimisticComposerTurn.value = failed;
    }
    const syncedFields = composerDraftSyncFields(optimistic.values);
    activeDraftSync()?.publishSubmissionRejected?.(
      composerDraftSyncFieldName(syncedFields),
      syncedFields,
      {
        submissionId,
        text: optimistic.text
      }
    );
    if (restoreDraft) {
      if (optimistic.messageDelivery) {
        if (!String(readRefOrGetterValue(conversationComposerDraft) || "")) {
          setConversationComposerDraft(optimistic.text);
        }
      } else {
        restoreControlDraft(optimistic.control, optimistic.values);
        if (String(optimistic.control?.id || "") === String(readRefOrGetterValue(primaryIntentId) || "")) {
          conversationComposerFallbackDraft.value = "";
        }
      }
    }
  }

  function failLocalComposerSubmissionForLifecycleDisconnect() {
    const optimistic = optimisticComposerTurn.value;
    if (optimisticComposerTurnIsLocalPending(optimistic)) {
      markOptimisticComposerTurnFailed(optimistic.id, {
        error: "Vibe64 restarted before this message reached the assistant. Use Resend when the server is back."
      });
    }
    for (const message of optimisticComposerMessages.value.filter((turn) => turn.status === "pending")) {
      markOptimisticComposerTurnFailed(message.id, {
        error: "Vibe64 restarted before this message reached the assistant. Use Resend when the server is back.",
        restoreDraft: false
      });
    }
    actionsClear();
  }

  function clearOptimisticComposerTurn(submissionId = "") {
    if (!submissionId) {
      return false;
    }
    if (optimisticComposerTurn.value?.id === submissionId) {
      optimisticComposerTurn.value = null;
      projectPendingRemoteSubmission();
      return true;
    }
    const previousLength = optimisticComposerMessages.value.length;
    optimisticComposerMessages.value = optimisticComposerMessages.value
      .filter((turn) => turn.id !== submissionId);
    return optimisticComposerMessages.value.length !== previousLength;
  }

  async function resendOptimisticComposerTurn(submissionId = "") {
    const messageIndex = optimisticComposerMessages.value
      .findIndex((turn) => turn.id === submissionId);
    const optimistic = optimisticComposerTurn.value?.id === submissionId
      ? optimisticComposerTurn.value
      : optimisticComposerMessages.value[messageIndex];
    if (!optimistic || optimistic.id !== submissionId || optimistic.status !== "failed") {
      return false;
    }
    const pending = {
      ...optimistic,
      error: "",
      status: "pending"
    };
    if (messageIndex >= 0) {
      optimisticComposerMessages.value = optimisticComposerMessages.value.map((turn, index) => (
        index === messageIndex ? pending : turn
      ));
    } else {
      optimisticComposerTurn.value = pending;
    }
    let accepted = false;
    try {
      accepted = optimistic.messageDelivery
        ? await sendAgentMessage({
            ...optimistic.options,
            ...(optimistic.afterSubmissionId
              ? { afterSubmissionId: optimistic.afterSubmissionId }
              : {}),
            composerSubmissionId: optimistic.id
          })
        : await runWorkflowControl(optimistic.control, optimistic.options);
    } catch (error) {
      markOptimisticComposerTurnFailed(submissionId, {
        error,
        restoreDraft: false
      });
      return false;
    }
    if (accepted === false) {
      markOptimisticComposerTurnFailed(submissionId, {
        restoreDraft: false
      });
      return false;
    }
    return true;
  }

  function reconcileComposerMessageOutcomes(deliveries = []) {
    let changed = false;
    for (const delivery of Array.isArray(deliveries) ? deliveries : []) {
      const submissionId = String(delivery?.id || "").trim();
      const messageIndex = optimisticComposerMessages.value
        .findIndex((turn) => turn.id === submissionId);
      const optimistic = optimisticComposerTurn.value?.id === submissionId
        ? optimisticComposerTurn.value
        : optimisticComposerMessages.value[messageIndex];
      if (!optimistic) {
        const recovered = optimisticComposerMessageFromDelivery(delivery, {
          fallbackAfterSubmissionId: readRefOrGetterValue(composerHandoff)?.submissionId
        });
        if (recovered) {
          optimisticComposerMessages.value = [
            ...optimisticComposerMessages.value,
            recovered
          ];
          changed = true;
        }
        continue;
      }
      const state = String(delivery?.state || "").trim();
      if (state === "failed" && optimistic.status !== "failed") {
        const failed = {
          ...optimistic,
          error: String(delivery?.error || "Message could not be sent."),
          status: "failed"
        };
        if (messageIndex >= 0) {
          optimisticComposerMessages.value = optimisticComposerMessages.value.map((turn, index) => (
            index === messageIndex ? failed : turn
          ));
        } else {
          optimisticComposerTurn.value = failed;
        }
        changed = true;
      } else if (state === "accepted" && optimistic.status === "failed") {
        const pending = {
          ...optimistic,
          error: "",
          status: "pending"
        };
        if (messageIndex >= 0) {
          optimisticComposerMessages.value = optimisticComposerMessages.value.map((turn, index) => (
            index === messageIndex ? pending : turn
          ));
        } else {
          optimisticComposerTurn.value = pending;
        }
        changed = true;
      }
    }
    return changed;
  }

  function editOptimisticComposerTurn(submissionId = "") {
    const optimistic = optimisticComposerTurn.value?.id === submissionId
      ? optimisticComposerTurn.value
      : optimisticComposerMessages.value.find((turn) => turn.id === submissionId);
    if (!optimistic || optimistic.id !== submissionId) {
      return false;
    }
    if (optimistic.messageDelivery) {
      setConversationComposerDraft(optimistic.text);
    } else {
      restoreControlDraft(optimistic.control, optimistic.values);
    }
    clearOptimisticComposerTurn(submissionId);
    return true;
  }

  function reconcileOptimisticComposerMessages(turns = []) {
    const optimisticTurns = [
      ...(optimisticComposerTurn.value ? [optimisticComposerTurn.value] : []),
      ...optimisticComposerMessages.value
    ];
    const unmatchedIds = new Set(
      unmatchedOptimisticComposerTurns(turns, optimisticTurns)
        .map((turn) => turn.id)
    );
    const pending = optimisticComposerMessages.value
      .filter((optimistic) => unmatchedIds.has(optimistic.id));
    if (pending.length === optimisticComposerMessages.value.length) {
      return false;
    }
    optimisticComposerMessages.value = pending;
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
    reconcileComposerMessageOutcomes,
    reconcileOptimisticComposerMessages,
    resendOptimisticComposerTurn,
    startOptimisticComposerTurn
  };
}

export {
  canonicalHandoffAcknowledgesOptimisticTurn,
  useVibe64ComposerHandoffState
};
