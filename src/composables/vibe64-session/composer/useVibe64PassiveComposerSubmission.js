import {
  COMPOSER_CONTROL_TARGETS
} from "@/lib/vibe64AutopilotComposerControlModel.js";
import {
  passiveComposerMessagePayload
} from "@/lib/vibe64PassiveComposerSteer.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function useVibe64PassiveComposerSubmission({
  afterSubmissionId = "",
  clearAcceptedSubmission = () => null,
  control = () => null,
  draft = () => "",
  expandSubmissionOptions = (options) => options,
  fieldName = () => "",
  logInputChanged = () => null,
  rejectOptimisticTurn = () => null,
  sendAgentMessage = async () => false,
  setDraft = () => false,
  startOptimisticTurn = () => null,
  submittedForm = () => null
} = {}) {
  async function submitPassiveComposer(options = {}) {
    const form = readRefOrGetterValue(submittedForm);
    const submittedDraft = String(readRefOrGetterValue(draft) || "");
    const rawPayload = passiveComposerMessagePayload(submittedDraft, options);
    if (!rawPayload) {
      return false;
    }
    const payload = expandSubmissionOptions(rawPayload);
    const targetSubmissionId = String(readRefOrGetterValue(afterSubmissionId) || "").trim();
    const draftSubmission = startOptimisticTurn({
      afterSubmissionId: targetSubmissionId,
      control: readRefOrGetterValue(control),
      messageDelivery: true,
      options: {
        displayFields: payload.displayFields,
        fields: payload.fields,
        message: payload.message
      },
      values: {
        [readRefOrGetterValue(fieldName)]: submittedDraft
      }
    });
    setDraft("");
    function restoreSubmittedDraft() {
      if (!readRefOrGetterValue(draft)) {
        setDraft(submittedDraft);
      }
    }
    try {
      const accepted = await sendAgentMessage({
        ...payload,
        ...(targetSubmissionId ? { afterSubmissionId: targetSubmissionId } : {}),
        composerSubmissionId: draftSubmission
      }) !== false;
      if (!accepted) {
        rejectOptimisticTurn(draftSubmission, {
          restoreDraft: false
        });
        restoreSubmittedDraft();
      } else {
        clearAcceptedSubmission(form);
      }
      return accepted;
    } catch (error) {
      rejectOptimisticTurn(draftSubmission, {
        error,
        restoreDraft: false
      });
      restoreSubmittedDraft();
      return false;
    }
  }

  function updatePassiveComposer(name = "", value = "", options = {}) {
    const currentFieldName = String(readRefOrGetterValue(fieldName) || "").trim();
    const valueBefore = String(readRefOrGetterValue(draft) || "");
    if (String(name || "").trim() !== currentFieldName) {
      logInputChanged({
        accepted: false,
        name,
        source: options?.source || COMPOSER_CONTROL_TARGETS.PASSIVE_COMPOSER,
        valueAfter: readRefOrGetterValue(draft),
        valueBefore,
        valueRequested: value
      });
      return false;
    }
    const accepted = setDraft(value, {
      publishDraft: true
    });
    logInputChanged({
      accepted,
      name,
      source: options?.source || COMPOSER_CONTROL_TARGETS.PASSIVE_COMPOSER,
      valueAfter: readRefOrGetterValue(draft),
      valueBefore,
      valueRequested: value
    });
    return accepted;
  }

  return {
    submitPassiveComposer,
    updatePassiveComposer
  };
}

export {
  useVibe64PassiveComposerSubmission
};
