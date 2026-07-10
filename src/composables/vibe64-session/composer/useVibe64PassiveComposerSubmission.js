import {
  COMPOSER_CONTROL_TARGETS
} from "@/lib/vibe64AutopilotComposerControlModel.js";
import {
  passiveComposerSteerPayload
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
  runWorkflowControl = async () => false,
  setDraft = () => false,
  startOptimisticTurn = () => null,
  steerAgentTurn = async () => false,
  steeringActive = false,
  submitControl = () => null,
  submittedForm = () => null
} = {}) {
  async function submitPassiveComposer(options = {}) {
    const form = readRefOrGetterValue(submittedForm);
    const submittedDraft = String(readRefOrGetterValue(draft) || "");
    const rawPayload = passiveComposerSteerPayload(submittedDraft, options);
    if (!rawPayload) {
      return false;
    }
    const payload = expandSubmissionOptions(rawPayload);
    if (!readRefOrGetterValue(steeringActive)) {
      const currentControl = readRefOrGetterValue(submitControl);
      if (!currentControl) {
        return false;
      }
      const draftSubmission = startOptimisticTurn({
        control: currentControl,
        options: {
          displayFields: payload.displayFields,
          fields: payload.fields
        },
        values: {
          [readRefOrGetterValue(fieldName)]: submittedDraft
        }
      });
      setDraft("");
      try {
        const accepted = await runWorkflowControl(currentControl, {
          ...payload,
          composerSubmissionId: draftSubmission
        });
        if (!accepted) {
          rejectOptimisticTurn(draftSubmission);
          if (!readRefOrGetterValue(draft)) {
            setDraft(submittedDraft);
          }
          return false;
        }
        clearAcceptedSubmission(form);
        return true;
      } catch (error) {
        rejectOptimisticTurn(draftSubmission, {
          error
        });
        if (!readRefOrGetterValue(draft)) {
          setDraft(submittedDraft);
        }
        return false;
      }
    }

    const targetSubmissionId = String(readRefOrGetterValue(afterSubmissionId) || "").trim();
    const draftSubmission = startOptimisticTurn({
      afterSubmissionId: targetSubmissionId,
      control: readRefOrGetterValue(control),
      options: {
        displayFields: payload.displayFields,
        fields: payload.fields,
        message: payload.message
      },
      steering: true,
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
      const steered = await steerAgentTurn({
        ...payload,
        ...(targetSubmissionId ? { afterSubmissionId: targetSubmissionId } : {}),
        composerSubmissionId: draftSubmission
      }) !== false;
      if (!steered) {
        rejectOptimisticTurn(draftSubmission, {
          restoreDraft: false
        });
        restoreSubmittedDraft();
      } else {
        clearAcceptedSubmission(form);
      }
      return steered;
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
