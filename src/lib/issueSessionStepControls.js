function buildActiveStepControls({
  actionKind = "",
  automationMode = "manual",
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
  requiredCompletionMissing = false,
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
  const codexPromptPending = automationMode === "codex_prompt" && !codexPromptAlreadyRequested;
  const codexOutputPromptPending = (
    (automationMode === "codex_output_prompt" && selectedStepNeedsCodexOutputPrompt) ||
    (isCodexOutputStep && codexPromptInjectionReady && !codexOutputFormVisible)
  ) && !codexPromptAlreadyRequested;
  const automaticStepPending = automationMode === "immediate";
  const showExecuteStep = !hasForm &&
    !blocked &&
    (codexPromptPending || codexOutputPromptPending || automaticStepPending);
  const showGoNext = !hasForm &&
    !blocked &&
    !showExecuteStep &&
    !requiredCompletionMissing &&
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
