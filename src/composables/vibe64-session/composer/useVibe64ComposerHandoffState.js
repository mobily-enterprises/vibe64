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

function optimisticComposerSteerFromControl(control = {}, {
  fallbackAfterSubmissionId = "",
  newTurnControl = null
} = {}) {
  const id = String(control?.id || "").trim();
  const message = String(control?.message || "").trim();
  const state = String(control?.state || "").trim();
  if (
    control?.kind !== "steer" ||
    !id ||
    !message ||
    !["accepted", "failed"].includes(state)
  ) {
    return null;
  }
  const displayMessage = String(control?.displayMessage || message).trim();
  const createdAt = String(control?.submittedAt || "").trim() || new Date().toISOString();
  const parsedCreatedAtMs = Date.parse(createdAt);
  return {
    afterSubmissionId: String(control?.afterSubmissionId || fallbackAfterSubmissionId).trim(),
    control: newTurnControl || {},
    createdAt,
    createdAtMs: Number.isNaN(parsedCreatedAtMs) ? Date.now() : parsedCreatedAtMs,
    error: state === "failed"
      ? String(control?.error || "Message could not be sent.")
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
    steering: true,
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
  newTurnControl = null,
  optimisticComposerTurn,
  optimisticComposerSteers = { value: [] },
  optimisticTextFromSubmission = () => "",
  payloadUsesConversationComposer = () => false,
  primaryIntentId = "",
  remoteComposerSubmission,
  restoreControlDraft = () => null,
  runWorkflowControl = async () => false,
  selectedComposerDraftText = () => "",
  setConversationComposerDraft = () => false,
  steerAgentTurn = async () => false,
  steeringActive = false
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
    options = {},
    steering = false,
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
      steering: steering === true,
      status: "pending",
      text,
      values: normalizedDraftFields(values)
    };
    if (optimisticTurn.steering) {
      optimisticComposerSteers.value = [
        ...optimisticComposerSteers.value,
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
    const steerIndex = optimisticComposerSteers.value
      .findIndex((turn) => turn.id === submissionId);
    const optimistic = optimisticComposerTurn.value?.id === submissionId
      ? optimisticComposerTurn.value
      : optimisticComposerSteers.value[steerIndex];
    if (!submissionId || !optimistic) {
      return;
    }
    const failed = {
      ...optimistic,
      error: String(error?.message || error || "Message could not be sent."),
      status: "failed"
    };
    if (steerIndex >= 0) {
      optimisticComposerSteers.value = optimisticComposerSteers.value.map((turn, index) => (
        index === steerIndex ? failed : turn
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
      if (optimistic.steering) {
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
    for (const steer of optimisticComposerSteers.value.filter((turn) => turn.status === "pending")) {
      markOptimisticComposerTurnFailed(steer.id, {
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
    const previousLength = optimisticComposerSteers.value.length;
    optimisticComposerSteers.value = optimisticComposerSteers.value
      .filter((turn) => turn.id !== submissionId);
    return optimisticComposerSteers.value.length !== previousLength;
  }

  async function resendOptimisticComposerTurn(submissionId = "") {
    const steerIndex = optimisticComposerSteers.value
      .findIndex((turn) => turn.id === submissionId);
    const optimistic = optimisticComposerTurn.value?.id === submissionId
      ? optimisticComposerTurn.value
      : optimisticComposerSteers.value[steerIndex];
    if (!optimistic || optimistic.id !== submissionId || optimistic.status !== "failed") {
      return false;
    }
    const continueSteering = optimistic.steering === true && readRefOrGetterValue(steeringActive) === true;
    const pending = {
      ...optimistic,
      error: "",
      steering: continueSteering,
      status: "pending"
    };
    if (steerIndex >= 0 && continueSteering) {
      optimisticComposerSteers.value = optimisticComposerSteers.value.map((turn, index) => (
        index === steerIndex ? pending : turn
      ));
    } else if (steerIndex >= 0) {
      optimisticComposerSteers.value = optimisticComposerSteers.value
        .filter((turn) => turn.id !== submissionId);
      optimisticComposerTurn.value = pending;
    } else {
      optimisticComposerTurn.value = pending;
    }
    let accepted = false;
    try {
      accepted = continueSteering
        ? await steerAgentTurn({
            ...optimistic.options,
            ...(optimistic.afterSubmissionId
              ? { afterSubmissionId: optimistic.afterSubmissionId }
              : {}),
            composerSubmissionId: optimistic.id
          })
        : await runWorkflowControl(
            readRefOrGetterValue(newTurnControl) || optimistic.control,
            optimistic.options
          );
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

  function reconcileComposerControlOutcomes(controls = []) {
    let changed = false;
    for (const control of Array.isArray(controls) ? controls : []) {
      const submissionId = String(control?.id || "").trim();
      const steerIndex = optimisticComposerSteers.value
        .findIndex((turn) => turn.id === submissionId);
      const optimistic = optimisticComposerTurn.value?.id === submissionId
        ? optimisticComposerTurn.value
        : optimisticComposerSteers.value[steerIndex];
      if (!optimistic) {
        const recovered = optimisticComposerSteerFromControl(control, {
          fallbackAfterSubmissionId: readRefOrGetterValue(composerHandoff)?.submissionId,
          newTurnControl: readRefOrGetterValue(newTurnControl)
        });
        if (recovered) {
          optimisticComposerSteers.value = [
            ...optimisticComposerSteers.value,
            recovered
          ];
          changed = true;
        }
        continue;
      }
      const state = String(control?.state || "").trim();
      if (state === "failed" && optimistic.status !== "failed") {
        const failed = {
          ...optimistic,
          error: String(control?.error || "Message could not be sent."),
          status: "failed"
        };
        if (steerIndex >= 0) {
          optimisticComposerSteers.value = optimisticComposerSteers.value.map((turn, index) => (
            index === steerIndex ? failed : turn
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
        if (steerIndex >= 0) {
          optimisticComposerSteers.value = optimisticComposerSteers.value.map((turn, index) => (
            index === steerIndex ? pending : turn
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
      : optimisticComposerSteers.value.find((turn) => turn.id === submissionId);
    if (!optimistic || optimistic.id !== submissionId) {
      return false;
    }
    if (optimistic.steering) {
      setConversationComposerDraft(optimistic.text);
    } else {
      restoreControlDraft(optimistic.control, optimistic.values);
    }
    clearOptimisticComposerTurn(submissionId);
    return true;
  }

  function reconcileOptimisticComposerSteers(turns = []) {
    const optimisticTurns = [
      ...(optimisticComposerTurn.value ? [optimisticComposerTurn.value] : []),
      ...optimisticComposerSteers.value
    ];
    const unmatchedIds = new Set(
      unmatchedOptimisticComposerTurns(turns, optimisticTurns)
        .map((turn) => turn.id)
    );
    const pending = optimisticComposerSteers.value
      .filter((optimistic) => unmatchedIds.has(optimistic.id));
    if (pending.length === optimisticComposerSteers.value.length) {
      return false;
    }
    optimisticComposerSteers.value = pending;
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
    reconcileComposerControlOutcomes,
    reconcileOptimisticComposerSteers,
    resendOptimisticComposerTurn,
    startOptimisticComposerTurn
  };
}

export {
  canonicalHandoffAcknowledgesOptimisticTurn,
  useVibe64ComposerHandoffState
};
