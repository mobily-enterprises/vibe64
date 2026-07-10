import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";

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

function arrayValue(value = []) {
  return Array.isArray(value) ? value : [];
}

function sessionBackgroundTasks(session = {}) {
  return [
    ...arrayValue(session?.backgroundTasks),
    ...arrayValue(session?.presentation?.backgroundTasks)
  ].filter((task) => task && typeof task === "object" && !Array.isArray(task));
}

function codexReconnectRequiredText(value = "") {
  const text = normalizedText(value);
  return Boolean(text) && (
    text.includes(CODEX_RECONNECT_REQUIRED_CODE) ||
    text.includes(CODEX_RECONNECT_REQUIRED_MESSAGE)
  );
}

function codexReconnectRequiredResult(result = {}) {
  const source = objectValue(result);
  return normalizedText(source.code) === CODEX_RECONNECT_REQUIRED_CODE ||
    codexReconnectRequiredText(source.error) ||
    codexReconnectRequiredText(source.message) ||
    codexReconnectRequiredText(source.observed) ||
    arrayValue(source.errors).some((error) => (
      normalizedText(error?.code) === CODEX_RECONNECT_REQUIRED_CODE ||
      codexReconnectRequiredText(error?.message)
    ));
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

function codexReconnectRequiredSignature(session = {}) {
  const sessionId = normalizedText(session?.sessionId);
  const backgroundTask = sessionBackgroundTasks(session).find((task) => (
    normalizedText(task.id) === VIBE64_CODEX_APP_SERVER_TASK_ID &&
    codexReconnectRequiredResult(task)
  ));
  if (backgroundTask) {
    return [
      sessionId,
      "background-task",
      normalizedText(backgroundTask.id),
      normalizedText(backgroundTask.status),
      normalizedText(backgroundTask.updatedAt),
      normalizedText(backgroundTask.error),
      normalizedText(backgroundTask.message)
    ].join("|");
  }

  const terminal = [
    objectValue(session?.agentSession?.terminal),
    objectValue(session?.presentation?.terminal?.agent)
  ].find(codexReconnectRequiredResult);
  if (terminal) {
    return [
      sessionId,
      "terminal",
      normalizedText(terminal.id || terminal.terminalSessionId),
      normalizedText(terminal.status),
      normalizedText(terminal.outputVersion),
      normalizedText(terminal.error || terminal.closeError || terminal.terminalError)
    ].join("|");
  }

  const turn = objectValue(session?.agentSession?.turn);
  if (codexReconnectRequiredResult(turn)) {
    return [
      sessionId,
      "agent-turn",
      normalizedText(session?.agentSession?.thread?.id),
      normalizedText(turn.id),
      normalizedText(turn.status),
      normalizedText(turn.updatedAt),
      normalizedText(turn.error || turn.message)
    ].join("|");
  }

  return "";
}

function codexTerminalAttentionSignature(session = {}) {
  const terminals = [
    objectValue(session?.agentSession?.terminal),
    objectValue(session?.presentation?.terminal?.agent)
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
  const turn = objectValue(session?.agentSession?.turn);
  const status = normalizedText(turn.status);
  const error = normalizedText(turn.error);
  if (turn.active === true) {
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
    normalizedText(session?.agentSession?.thread?.id),
    normalizedText(turn.id),
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

function vibe64SessionNeedsCodexReconnect(session = {}) {
  return Boolean(codexReconnectRequiredSignature(session));
}

export {
  VIBE64_CODEX_APP_SERVER_TASK_ID,
  codexReconnectRequiredResult,
  codexReconnectRequiredSignature,
  vibe64CodexTerminalAttentionSignature,
  vibe64SessionNeedsCodexReconnect,
  vibe64SessionNeedsCodexTerminalAttention
};
