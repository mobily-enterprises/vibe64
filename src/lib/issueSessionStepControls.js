function buildActiveStepControls({
  actionKind = "",
  automationMode = "manual",
  busy = false,
  codexPromptAlreadyRequested = false,
  codexPromptInjectionReady = false,
  codexWorking = false,
  canRunAction = false,
  hasChoiceForm = false,
  hasExclusiveTextAlternateAction = false,
  hasTextForm = false,
  isTerminalSession = false,
  selectedSessionId = "",
  selectedSessionNeedsSetupTerminal = false,
  selectedStepInputType = "none",
  terminalBlocked = false
} = {}) {
  const hasForm = Boolean(
    hasChoiceForm ||
    hasTextForm ||
    hasExclusiveTextAlternateAction
  );
  const blocked = Boolean(
    !selectedSessionId ||
    isTerminalSession
  );
  const terminalStepPending = selectedSessionNeedsSetupTerminal || automationMode === "terminal";
  const canClick = !blocked && !busy && !terminalBlocked && !codexWorking;
  const isCodexPromptStep = actionKind === "codex_prompt";
  const codexPromptInjectionPending = codexPromptInjectionReady && !codexPromptAlreadyRequested;
  const codexPromptPending = automationMode === "codex_prompt" && !codexPromptAlreadyRequested;
  const automaticStepPending = automationMode === "immediate";
  const manualNoInputStepPending = Boolean(actionKind) &&
    automationMode === "manual" &&
    selectedStepInputType === "none" &&
    actionKind !== "user_check";
  const showExecuteStep = !hasForm &&
    !blocked &&
    (
      codexPromptInjectionPending ||
      codexPromptPending ||
      terminalStepPending ||
      automaticStepPending ||
      manualNoInputStepPending
    );
  const showGoNext = !hasForm &&
    !blocked &&
    !showExecuteStep &&
    (
      isCodexPromptStep ||
      (actionKind === "user_check" && selectedStepInputType === "none")
    );
  const showFormSubmit = hasForm && !hasChoiceForm && !hasExclusiveTextAlternateAction;

  return {
    canExecuteStep: showExecuteStep && canClick,
    canGoNext: showGoNext && canClick,
    canSubmitForm: showFormSubmit && canRunAction,
    hasForm,
    showExecuteStep,
    showFormSubmit,
    showGoNext
  };
}

export {
  buildActiveStepControls
};
