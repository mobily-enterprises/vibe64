import stripAnsi from "strip-ansi";
import {
  questionPromptInstructions
} from "@local/vibe64-adapters/server/promptQuestionPolicy";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

const DEFAULT_TERMINAL_FAILURE_TAIL_LINES = 200;

function terminalFailureOutputTail(output = "", {
  maxLines = DEFAULT_TERMINAL_FAILURE_TAIL_LINES
} = {}) {
  const normalizedMaxLines = Math.max(1, Number(maxLines) || DEFAULT_TERMINAL_FAILURE_TAIL_LINES);
  const text = stripAnsi(String(output || ""))
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n");
  return text.split("\n").slice(-normalizedMaxLines).join("\n").trimEnd();
}

function describeTerminalFailureSubject({
  actionId = "",
  actionLabel = "",
  launchTargetId = "",
  launchTargetLabel = "",
  shellTarget = "",
  terminalKind = ""
} = {}) {
  if (terminalKind === "launch") {
    return launchTargetLabel || launchTargetId || "Launch target";
  }
  if (terminalKind === "shell") {
    return shellTarget ? `Shell target: ${shellTarget}` : "Shell command";
  }
  return actionLabel || actionId || "Command action";
}

function optionalContextLine(label, value) {
  const normalizedValue = normalizeText(value);
  return normalizedValue ? `- ${label}: ${normalizedValue}` : "";
}

function terminalFailureFixPrompt({
  actionId = "",
  actionLabel = "",
  closeError = "",
  commandPreview = "",
  currentStep = "",
  exitCode = null,
  launchTargetId = "",
  launchTargetLabel = "",
  output = "",
  sessionId = "",
  shellTarget = "",
  stepStatus = "",
  terminalKind = "",
  terminalSessionId = "",
  terminalStatus = "",
  userMessage = ""
} = {}) {
  const outputTail = terminalFailureOutputTail(output);
  const normalizedUserMessage = normalizeText(userMessage);
  const subject = describeTerminalFailureSubject({
    actionId,
    actionLabel,
    launchTargetId,
    launchTargetLabel,
    shellTarget,
    terminalKind
  });
  const contextLines = [
    optionalContextLine("Session", sessionId),
    optionalContextLine("Terminal kind", terminalKind),
    optionalContextLine("Terminal session", terminalSessionId),
    optionalContextLine("Subject", subject),
    optionalContextLine("Action id", actionId),
    optionalContextLine("Launch target id", launchTargetId),
    optionalContextLine("Shell target", shellTarget),
    optionalContextLine("Status", terminalStatus),
    optionalContextLine("Exit code", exitCode),
    optionalContextLine("Error", closeError),
    optionalContextLine("Command", commandPreview)
  ].filter(Boolean).join("\n");

  return [
    "A terminal script failed in Vibe64. Diagnose the failure from the repository and the terminal output, then attempt to fix the underlying cause in the current worktree.",
    "",
    "When you believe the failed command should be retried, call the Vibe64 current-step input helper with:",
    JSON.stringify({
      kind: "consider_resolved",
      stepId: currentStep || "{{session.currentStep}}",
      stepStatus: stepStatus || "{{session.stepMachine.status}}",
      text: "Briefly describe what you fixed or why retrying is now reasonable."
    }, null, 2),
    "",
    "If you need user input before the command can be retried, call the helper with:",
    JSON.stringify({
      kind: "waiting_for_input",
      stepId: currentStep || "{{session.currentStep}}",
      stepStatus: stepStatus || "{{session.stepMachine.status}}",
      message: "The question or blocker for the user"
    }, null, 2),
    "Before calling that helper, write the same question or blocker in normal Codex response text so Inspect users can read it directly in the terminal.",
    ...questionPromptInstructions(),
    "",
    "Terminal context:",
    contextLines || "- No terminal metadata was available.",
    "",
    "User note:",
    normalizedUserMessage || "(No extra note was provided.)",
    "",
    `Last ${DEFAULT_TERMINAL_FAILURE_TAIL_LINES} terminal lines:`,
    "~~~text",
    outputTail || "(No terminal output was captured.)",
    "~~~"
  ].join("\n");
}

function terminalFailureFixRequest(input = {}) {
  return {
    ...input,
    ok: true,
    outputTail: terminalFailureOutputTail(input.output),
    prompt: terminalFailureFixPrompt(input)
  };
}

function terminalFailureFixRequestForSession(session = {}, input = {}) {
  return terminalFailureFixRequest({
    ...input,
    currentStep: input.currentStep || session.currentStep || "",
    sessionId: session.sessionId || input.sessionId || "",
    stepStatus: input.stepStatus || session.stepMachine?.status || ""
  });
}

export {
  DEFAULT_TERMINAL_FAILURE_TAIL_LINES,
  terminalFailureFixPrompt,
  terminalFailureFixRequest,
  terminalFailureFixRequestForSession,
  terminalFailureOutputTail
};
