const VIBE64_CODEX_APP_SERVER_TASK_ID = "codex_app_server";

const CODEX_BACKGROUND_TASK_ATTENTION_STATUSES = new Set([
  "error",
  "failed"
]);
const CODEX_TERMINAL_ATTENTION_STATUSES = new Set([
  "error",
  "failed"
]);
const CODEX_TURN_ATTENTION_STATUSES = new Set([
  "error",
  "failed"
]);

function terminalSessionMissingError(message = "") {
  return /terminal session not found/iu.test(String(message || ""));
}

function normalizedText(value = "") {
  return String(value || "").trim();
}

function objectValue(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sessionBackgroundTasks(session = {}) {
  return [
    ...(Array.isArray(session?.backgroundTasks) ? session.backgroundTasks : []),
    ...(Array.isArray(session?.presentation?.backgroundTasks) ? session.presentation.backgroundTasks : [])
  ].filter((task) => task && typeof task === "object" && !Array.isArray(task));
}

function codexBackgroundTaskAttentionSignature(session = {}) {
  const task = sessionBackgroundTasks(session).find((entry) => (
    normalizedText(entry.id) === VIBE64_CODEX_APP_SERVER_TASK_ID &&
    CODEX_BACKGROUND_TASK_ATTENTION_STATUSES.has(normalizedText(entry.status))
  ));
  if (!task) {
    return "";
  }
  return [
    normalizedText(session?.sessionId),
    "background-task",
    normalizedText(task.id),
    normalizedText(task.status),
    normalizedText(task.updatedAt),
    normalizedText(task.terminalSessionId),
    normalizedText(task.error),
    normalizedText(task.message)
  ].join("|");
}

function codexTerminalAttentionSignature(session = {}) {
  const terminals = [
    objectValue(session?.codexTerminal),
    objectValue(session?.presentation?.terminal?.codex)
  ];
  for (const terminal of terminals) {
    const terminalId = normalizedText(terminal.id || terminal.terminalSessionId);
    const terminalStatus = normalizedText(terminal.status);
    const terminalError = normalizedText(terminal.closeError || terminal.error || terminal.terminalError);
    if (!terminalId && !terminalStatus && !terminalError) {
      continue;
    }
    if (terminalSessionMissingError(terminalError)) {
      continue;
    }
    if (!terminalError && !CODEX_TERMINAL_ATTENTION_STATUSES.has(terminalStatus)) {
      continue;
    }
    return [
      normalizedText(session?.sessionId),
      "terminal",
      terminalId,
      terminalStatus,
      normalizedText(terminal.outputVersion),
      terminalError
    ].join("|");
  }
  return "";
}

function codexAgentTurnAttentionSignature(session = {}) {
  const turn = objectValue(session?.codexAgentTurn);
  const status = normalizedText(turn.status);
  const error = normalizedText(turn.error);
  if (session?.codexAgentTurnActive === true || turn.active === true) {
    return "";
  }
  if (status === "interrupted") {
    return "";
  }
  if (!error && !CODEX_TURN_ATTENTION_STATUSES.has(status)) {
    return "";
  }
  return [
    normalizedText(session?.sessionId),
    "agent-turn",
    normalizedText(turn.threadId),
    normalizedText(turn.turnId),
    normalizedText(turn.state),
    status,
    normalizedText(turn.updatedAt),
    error
  ].join("|");
}

function vibe64CodexTerminalAttentionSignature(session = {}) {
  return codexTerminalAttentionSignature(session) ||
    codexBackgroundTaskAttentionSignature(session) ||
    codexAgentTurnAttentionSignature(session);
}

function vibe64SessionNeedsCodexTerminalAttention(session = {}) {
  return Boolean(vibe64CodexTerminalAttentionSignature(session));
}

export {
  VIBE64_CODEX_APP_SERVER_TASK_ID,
  vibe64CodexTerminalAttentionSignature,
  vibe64SessionNeedsCodexTerminalAttention
};
