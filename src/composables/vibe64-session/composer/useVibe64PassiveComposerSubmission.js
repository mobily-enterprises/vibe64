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
  clearAcceptedSubmission = () => null,
  clearOptimisticTurn = () => false,
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
  steeringRunning = { value: false },
  submitControl = () => null,
  submittedForm = () => null
} = {}) {
  async function submitPassiveComposer(options = {}) {
    if (steeringRunning.value) {
      return false;
    }
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

    const draftSubmission = startOptimisticTurn({
      control: readRefOrGetterValue(control),
      options: {
        displayFields: payload.displayFields,
        fields: payload.fields
      },
      values: {
        [readRefOrGetterValue(fieldName)]: submittedDraft
      }
    });
    setDraft("");
    steeringRunning.value = true;
    function restoreSubmittedDraft() {
      if (!readRefOrGetterValue(draft)) {
        setDraft(submittedDraft);
      }
    }
    try {
      const steered = await steerAgentTurn(payload) !== false;
      if (!steered) {
        clearOptimisticTurn(draftSubmission);
        restoreSubmittedDraft();
      } else {
        clearOptimisticTurn(draftSubmission);
        clearAcceptedSubmission(form);
      }
      return steered;
    } catch {
      clearOptimisticTurn(draftSubmission);
      restoreSubmittedDraft();
      return false;
    } finally {
      steeringRunning.value = false;
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
