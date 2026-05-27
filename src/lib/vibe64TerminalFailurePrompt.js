import {
  buildVibe64TerminalFailureFixRequest
} from "@/lib/vibe64SessionApi.js";

function terminalFailureFixContext(input = {}) {
  return {
    actionId: String(input.actionId || ""),
    actionLabel: String(input.actionLabel || ""),
    closeError: String(input.closeError || ""),
    commandPreview: String(input.commandPreview || ""),
    currentStep: String(input.currentStep || ""),
    exitCode: input.exitCode == null ? "" : String(input.exitCode),
    launchTargetId: String(input.launchTargetId || ""),
    launchTargetLabel: String(input.launchTargetLabel || ""),
    output: String(input.output || ""),
    sessionId: String(input.sessionId || ""),
    shellTarget: String(input.shellTarget || ""),
    stepStatus: String(input.stepStatus || ""),
    terminalKind: String(input.terminalKind || ""),
    terminalSessionId: String(input.terminalSessionId || ""),
    terminalStatus: String(input.terminalStatus || ""),
    userMessage: String(input.userMessage || "")
  };
}

async function terminalFailureFixRequest(input = {}) {
  const context = terminalFailureFixContext(input);
  return buildVibe64TerminalFailureFixRequest(context.sessionId, context);
}

export {
  terminalFailureFixContext,
  terminalFailureFixRequest
};
