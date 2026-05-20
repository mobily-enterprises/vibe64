import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";

const DEFAULT_TERMINAL_FAILURE_TAIL_LINES = 200;

function terminalFailureOutputTail(output = "", {
  maxLines = DEFAULT_TERMINAL_FAILURE_TAIL_LINES
} = {}) {
  const normalizedMaxLines = Math.max(1, Number(maxLines) || DEFAULT_TERMINAL_FAILURE_TAIL_LINES);
  const text = stripTerminalControlSequences(output)
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
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue ? `- ${label}: ${normalizedValue}` : "";
}

function terminalFailureFixPrompt({
  actionId = "",
  actionLabel = "",
  closeError = "",
  commandPreview = "",
  exitCode = null,
  launchTargetId = "",
  launchTargetLabel = "",
  output = "",
  sessionId = "",
  shellTarget = "",
  terminalKind = "",
  terminalSessionId = "",
  terminalStatus = ""
} = {}) {
  const outputTail = terminalFailureOutputTail(output);
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
    "A terminal script failed in AI Studio. Diagnose the failure from the repository and the terminal output, then attempt to fix the underlying cause in the current worktree.",
    "",
    "Response contract:",
    "- When you are done, start your final response with exactly one of these marker lines:",
    "Fixed it",
    "Not fixed",
    "- Use Fixed it only if you made or verified a concrete fix.",
    "- Under the marker, include a concise explanation and mention any commands or tests you ran.",
    "",
    "Terminal context:",
    contextLines || "- No terminal metadata was available.",
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
    outputTail: terminalFailureOutputTail(input.output),
    prompt: terminalFailureFixPrompt(input)
  };
}

export {
  DEFAULT_TERMINAL_FAILURE_TAIL_LINES,
  terminalFailureFixPrompt,
  terminalFailureFixRequest,
  terminalFailureOutputTail
};
