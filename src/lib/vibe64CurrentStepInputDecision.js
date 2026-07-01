function arrayHasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function currentStepInputHasDecisionControls(session = {}, interaction = {}) {
  return arrayHasItems(interaction?.intents) ||
    arrayHasItems(session?.intents) ||
    arrayHasItems(session?.presentation?.intents);
}

function currentStepInputSuppressesActionFallback(interaction = {}) {
  return String(interaction?.kind || "").trim() === "command_failure_response";
}

function controlSavesCurrentStepInputBeforeRun(control = {}) {
  return control?.saveCurrentStepInputBeforeRun === true;
}

export {
  controlSavesCurrentStepInputBeforeRun,
  currentStepInputHasDecisionControls,
  currentStepInputSuppressesActionFallback
};
