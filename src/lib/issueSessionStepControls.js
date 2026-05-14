function buildActiveStepControls({
  actionKind = "",
  busy = false,
  codexOutputFormVisible = false,
  codexPromptAlreadyRequested = false,
  codexPromptInjectionReady = false,
  codexWorking = false,
  canRunAction = false,
  hasChoiceForm = false,
  hasExclusiveTextAlternateAction = false,
  hasTextForm = false,
  isCodexOutputStep = false,
  isTerminalSession = false,
  selectedSessionId = "",
  selectedSessionNeedsSetupTerminal = false,
  selectedStepInputType = "none",
  selectedStepNeedsCodexOutputPrompt = false,
  terminalBlocked = false
} = {}) {
  const hasForm = Boolean(
    hasChoiceForm ||
    hasTextForm ||
    codexOutputFormVisible ||
    hasExclusiveTextAlternateAction
  );
  const blocked = Boolean(
    !selectedSessionId ||
    isTerminalSession ||
    selectedSessionNeedsSetupTerminal
  );
  const canClick = !blocked && !busy && !terminalBlocked && !codexWorking;
  const isCodexPromptStep = actionKind === "codex_prompt";
  const codexPromptPending = isCodexPromptStep && !codexPromptAlreadyRequested;
  const codexOutputPromptPending = (
    selectedStepNeedsCodexOutputPrompt ||
    (isCodexOutputStep && codexPromptInjectionReady && !codexOutputFormVisible)
  ) && !codexPromptAlreadyRequested;
  const automaticStepPending = actionKind === "automatic";
  const showExecuteStep = !hasForm &&
    !blocked &&
    (codexPromptPending || codexOutputPromptPending || automaticStepPending);
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
