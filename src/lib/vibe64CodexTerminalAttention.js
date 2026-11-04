import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { terminalSessionMissingError } from "@/lib/vibe64TerminalErrors.js";

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

function arrayValue(value = []) {
  return Array.isArray(value) ? value : [];
}

function sessionBackgroundTasks(session = {}) {
  return arrayValue(session.backgroundTasks)
    .filter((task) => task && typeof task === "object" && !Array.isArray(task));
}

function codexReconnectRequiredText(value = "") {
  const text = normalizeText(value);
  return Boolean(text) && (
    text.includes(CODEX_RECONNECT_REQUIRED_CODE) ||
    text.includes(CODEX_RECONNECT_REQUIRED_MESSAGE)
  );
}

function codexReconnectRequiredResult(result = {}) {
  const source = normalizeObject(result);
  return normalizeText(source.code) === CODEX_RECONNECT_REQUIRED_CODE ||
    codexReconnectRequiredText(source.error) ||
    codexReconnectRequiredText(source.message) ||
    codexReconnectRequiredText(source.observed) ||
    arrayValue(source.errors).some((error) => (
      normalizeText(error?.code) === CODEX_RECONNECT_REQUIRED_CODE ||
      codexReconnectRequiredText(error?.message)
    ));
}

function codexBackgroundTaskAttentionSignature(session = {}) {
  const task = sessionBackgroundTasks(session).find((entry) => (
    normalizeText(entry.id) === VIBE64_CODEX_APP_SERVER_TASK_ID &&
    CODEX_BACKGROUND_TASK_ATTENTION_STATUSES.has(normalizeText(entry.status))
  ));
  if (!task) {
    return "";
  }
  return [
    normalizeText(session.sessionId),
    "background-task",
    normalizeText(task.id),
    normalizeText(task.status),
    normalizeText(task.updatedAt),
    normalizeText(task.terminalSessionId),
    normalizeText(task.error),
    normalizeText(task.message)
  ].join("|");
}

function codexReconnectRequiredSignature(session = {}) {
  const sessionId = normalizeText(session.sessionId);
  const backgroundTask = sessionBackgroundTasks(session).find((task) => (
    normalizeText(task.id) === VIBE64_CODEX_APP_SERVER_TASK_ID &&
    codexReconnectRequiredResult(task)
  ));
  if (backgroundTask) {
    return [
      sessionId,
      "background-task",
      normalizeText(backgroundTask.id),
      normalizeText(backgroundTask.status),
      normalizeText(backgroundTask.updatedAt),
      normalizeText(backgroundTask.error),
      normalizeText(backgroundTask.message)
    ].join("|");
  }

  const terminal = normalizeObject(session.agentSession?.terminal);
  if (codexReconnectRequiredResult(terminal)) {
    return [
      sessionId,
      "terminal",
      normalizeText(terminal.id || terminal.terminalSessionId),
      normalizeText(terminal.status),
      normalizeText(terminal.outputVersion),
      normalizeText(terminal.error || terminal.closeError || terminal.terminalError)
    ].join("|");
  }

  const turn = normalizeObject(session.agentSession?.turn);
  if (codexReconnectRequiredResult(turn)) {
    return [
      sessionId,
      "agent-turn",
      normalizeText(session.agentSession?.thread?.id),
      normalizeText(turn.id),
      normalizeText(turn.status),
      normalizeText(turn.updatedAt),
      normalizeText(turn.error || turn.message)
    ].join("|");
  }

  return "";
}

function codexTerminalAttentionSignature(session = {}) {
  const terminal = normalizeObject(session.agentSession?.terminal);
  const terminalId = normalizeText(terminal.id || terminal.terminalSessionId);
  const terminalStatus = normalizeText(terminal.status);
  const terminalError = normalizeText(terminal.closeError || terminal.error || terminal.terminalError);
  if (
    (!terminalId && !terminalStatus && !terminalError) ||
    terminalSessionMissingError(terminalError) ||
    (!terminalError && !CODEX_TERMINAL_ATTENTION_STATUSES.has(terminalStatus))
  ) {
    return "";
  }
  return [
    normalizeText(session.sessionId),
    "terminal",
    terminalId,
    terminalStatus,
    normalizeText(terminal.outputVersion),
    terminalError
  ].join("|");
}

function codexAgentTurnAttentionSignature(session = {}) {
  const turn = normalizeObject(session.agentSession?.turn);
  const status = normalizeText(turn.status);
  const error = normalizeText(turn.error);
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
    normalizeText(session.sessionId),
    "agent-turn",
    normalizeText(session.agentSession?.thread?.id),
    normalizeText(turn.id),
    normalizeText(turn.state),
    status,
    normalizeText(turn.updatedAt),
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
