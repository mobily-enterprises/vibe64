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
  attemptedCommand = "",
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
    optionalContextLine("Attempted command", attemptedCommand),
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

function sessionTerminalFailureFixPrompt(input = {}) {
  const outputTail = terminalFailureOutputTail(input.output);
  const subject = describeTerminalFailureSubject({
    actionId: input.actionId,
    actionLabel: input.actionLabel,
    launchTargetId: input.launchTargetId,
    launchTargetLabel: input.launchTargetLabel,
    shellTarget: input.shellTarget,
    terminalKind: input.terminalKind
  });
  const contextLines = [
    optionalContextLine("Scope", "session"),
    optionalContextLine("Session", input.sessionId),
    optionalContextLine("Current step", input.currentStep),
    optionalContextLine("Step status", input.stepStatus),
    optionalContextLine("Target root", input.targetRoot),
    optionalContextLine("Worktree", input.worktreePath),
    optionalContextLine("Terminal kind", input.terminalKind),
    optionalContextLine("Terminal session", input.terminalSessionId),
    optionalContextLine("Subject", subject),
    optionalContextLine("Action id", input.actionId),
    optionalContextLine("Launch target id", input.launchTargetId),
    optionalContextLine("Shell target", input.shellTarget),
    optionalContextLine("Status", input.terminalStatus),
    optionalContextLine("Exit code", input.exitCode),
    optionalContextLine("Error", input.closeError),
    optionalContextLine("Attempted command", input.attemptedCommand),
    optionalContextLine("Command", input.commandPreview)
  ].filter(Boolean).join("\n");

  return [
    "A Vibe64 session terminal failed. Diagnose the failure from the repository and terminal output, then attempt to fix the underlying cause in the session worktree.",
    "This is an ephemeral repair job, not a chat. Do not use the session Codex terminal or global Codex terminal for this repair.",
    "Leave any code/config changes in the session worktree. When the repair is complete or blocked, report through the Fix Codex callback helper.",
    "Before editing, inspect the session diff against its base branch. Only repair failures that are plausibly caused by this session's requested work or existing session diff.",
    "If the failed command exposes an unrelated baseline repository failure, missing external dependency, broken local service, or broad issue outside the session diff, do not repair unrelated files. Report `blocked` through the callback with the retry blocker and the exact command that failed.",
    "",
    "Terminal context:",
    contextLines || "- No terminal metadata was available.",
    "",
    "User note:",
    normalizeText(input.userMessage) || "(No extra note was provided.)",
    "",
    `Last ${DEFAULT_TERMINAL_FAILURE_TAIL_LINES} terminal lines:`,
    "~~~text",
    outputTail || "(No terminal output was captured.)",
    "~~~"
  ].join("\n");
}

function projectToolFailureFixPrompt(input = {}, {
  reportInstructions = ""
} = {}) {
  const toolId = input.toolId || input.actionId;
  const outputTail = terminalFailureOutputTail(input.output);
  const subject = describeTerminalFailureSubject({
    actionId: toolId,
    actionLabel: input.toolLabel || input.actionLabel,
    terminalKind: "project_tool"
  });
  const contextLines = [
    optionalContextLine("Scope", "project"),
    optionalContextLine("Target root", input.targetRoot),
    optionalContextLine("Tool id", input.toolId || input.actionId),
    optionalContextLine("Tool label", input.toolLabel || input.actionLabel),
    optionalContextLine("Subject", subject),
    optionalContextLine("Terminal session", input.terminalSessionId),
    optionalContextLine("Status", input.terminalStatus),
    optionalContextLine("Exit code", input.exitCode),
    optionalContextLine("Error", input.closeError),
    optionalContextLine("Attempted command", input.attemptedCommand),
    optionalContextLine("Command", input.commandPreview)
  ].filter(Boolean).join("\n");

  return [
    "A project-level Vibe64 tool failed. Diagnose the failure from the repository and terminal output, then attempt to fix the underlying cause in the main project checkout.",
    "This is an ephemeral repair job, not a chat. Do not use or modify Vibe64 session state unless the failure itself requires a repository code/config change.",
    "The Terminal context includes the exact Attempted command. Start from that command, not from the tool label alone.",
    "If the exact Attempted command is itself invalid, intentionally failing, or depends on missing external/user configuration, do not guess a replacement command. Report `blocked` with the command and the reason.",
    "",
    reportInstructions,
    "",
    "Terminal context:",
    contextLines || "- No terminal metadata was available.",
    "",
    "User note:",
    normalizeText(input.userMessage) || "(No extra note was provided.)",
    "",
    `Last ${DEFAULT_TERMINAL_FAILURE_TAIL_LINES} terminal lines:`,
    "~~~text",
    outputTail || "(No terminal output was captured.)",
    "~~~"
  ].filter((line) => line !== "").join("\n");
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
  projectToolFailureFixPrompt,
  sessionTerminalFailureFixPrompt,
  terminalFailureFixPrompt,
  terminalFailureFixRequest,
  terminalFailureFixRequestForSession,
  terminalFailureOutputTail
};
