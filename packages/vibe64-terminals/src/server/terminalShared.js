import { stat } from "node:fs/promises";
import path from "node:path";
import { sessionClosingReason } from "@local/vibe64-runtime/server/sessionLifecycle";

import {
  vibe64Result as sharedVibe64Result,
  normalizePlainObject
} from "@local/vibe64-core/server/serverResponses";
import {
  sessionSourcePath as sharedSessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
import {
  ensureSessionSourceGitAlternatesDissociated
} from "@local/vibe64-runtime/server/sessionSourceGit";
import {
  shellQuote,
  stableHash
} from "@local/vibe64-execution/server";

const CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE = "vibe64_session_worktree_unavailable";

const CODEX_TERMINAL_NAMESPACE = "vibe64-codex";
const GLOBAL_CODEX_TERMINAL_NAMESPACE = "vibe64-global-codex";
const OPENCODE_TERMINAL_NAMESPACE = "vibe64-opencode";
const OUTPUT_TARGET_TERMINAL_NAMESPACE = "vibe64-output-target";

function retryableTerminalFailure(result = {}) {
  return {
    ...result,
    retryable: false
  };
}

function codexSessionWorktreeWasRemoved(session = {}) {
  return String(session.metadata?.source_removed || "").trim() === "yes";
}

function codexSessionWorktreeUnavailableFailure({
  session = {},
  workdir = ""
} = {}) {
  const removed = codexSessionWorktreeWasRemoved(session);
  const closingReason = sessionClosingReason(session);
  return retryableTerminalFailure({
    code: CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE,
    ok: false,
    error: removed
      ? "Session clone was removed. Recover this session before continuing with Codex."
      : closingReason
        ? `Session is ${closingReason}. Codex cannot start while the worktree is being archived.`
      : `Session clone directory does not exist: ${workdir}`,
    workdir: String(workdir || "").trim()
  });
}

function codexSessionWorkdirAllowed({
  session = {},
  workdir = ""
} = {}) {
  if (!workdir) {
    return false;
  }
  const sessionWorktree = terminalWorktreePath(session);
  return Boolean(sessionWorktree) && path.resolve(sessionWorktree) === path.resolve(workdir);
}

function openCodeError(code, message, details = {}, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details };
  error.statusCode = statusCode;
  return error;
}

function openCodeRuntimeFailure(error) {
  if (error.code === "assistant_opencode_stop_unverified") error.code = "vibe64_opencode_stop_unverified";
  if (error.code === "assistant_opencode_interrupt_unconfirmed") error.code = "vibe64_opencode_interrupt_unconfirmed";
  if (error.code === "assistant_opencode_interrupt_timeout") error.code = "vibe64_opencode_interrupt_timeout";
  if (error.code === "assistant_opencode_conversation_busy") error.code = "vibe64_opencode_conversation_busy";
  throw error;
}

function openCodeSessionId(value = "") {
  const sessionId = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(sessionId)) {
    throw new TypeError("OpenCode operations require a valid Vibe64 session id.");
  }
  return sessionId;
}

function claudeConversationError(message, code = "vibe64_claude_operation_failed") {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

function vibe64Result(operation) {
  return sharedVibe64Result(operation, {
    fallbackCode: "vibe64_terminal_request_failed",
    fallbackMessage: "Vibe64 terminal request failed."
  });
}

function terminalProjectScopeKey() {
  return currentProjectScopeKey();
}

function terminalNamespace(base = "", ...parts) {
  return [
    String(base || "").trim(),
    terminalProjectScopeKey(),
    ...parts.map((part) => String(part || "").trim())
  ].join(":");
}

function codexTerminalNamespace(sessionId) {
  return terminalNamespace(CODEX_TERMINAL_NAMESPACE, sessionId);
}

function globalCodexTerminalNamespace() {
  return terminalNamespace(GLOBAL_CODEX_TERMINAL_NAMESPACE);
}

function outputTargetTerminalNamespace(sessionId) {
  return terminalNamespace(OUTPUT_TARGET_TERMINAL_NAMESPACE, sessionId);
}

function claudeTerminalNamespace(sessionId) {
  return terminalNamespace("vibe64-claude", sessionId);
}

function opencodeTerminalNamespace(sessionId) {
  return terminalNamespace(OPENCODE_TERMINAL_NAMESPACE, sessionId);
}

function commandInvocation({
  args = [],
  command = ""
} = {}) {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    return "";
  }
  const normalizedArgs = Array.isArray(args) ? args : [];
  return [
    normalizedCommand,
    ...normalizedArgs.map((arg) => String(arg))
  ].map(shellQuote).join(" ");
}

async function directoryExists(filePath = "") {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

function normalizedTerminalPath(value = "") {
  const normalizedValue = String(value || "").trim();
  return normalizedValue ? path.resolve(normalizedValue) : "";
}

function pathInsideOrEqual(rootPath = "", candidatePath = "") {
  if (!rootPath || !candidatePath) {
    return false;
  }
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function sessionTerminalCwd(session = {}) {
  return String(sharedSessionSourcePath(session)).trim();
}

function terminalSessionSourceRoot(session = {}) {
  return normalizedTerminalPath(sharedSessionSourcePath(session));
}

function terminalWorktreePath(session = {}) {
  return sharedSessionSourcePath(session);
}

async function ensureTerminalSessionSourceGitSelfContained({
  runExclusive = null,
  session = {},
  workdir = ""
} = {}) {
  const worktreePath = terminalWorktreePath(session);
  if (!worktreePath || !workdir || path.resolve(worktreePath) !== path.resolve(workdir)) {
    return {
      ok: true,
      repaired: false,
      skipped: true
    };
  }
  return ensureSessionSourceGitAlternatesDissociated(worktreePath, { runExclusive });
}

export {
  CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE,
  claudeConversationError,
  codexSessionWorktreeWasRemoved,
  codexSessionWorktreeUnavailableFailure,
  codexSessionWorkdirAllowed,
  openCodeError,
  openCodeRuntimeFailure,
  openCodeSessionId,
  retryableTerminalFailure,
  vibe64Result,
  claudeTerminalNamespace,
  codexTerminalNamespace,
  commandInvocation,
  directoryExists,
  globalCodexTerminalNamespace,
  opencodeTerminalNamespace,
  outputTargetTerminalNamespace,
  pathInsideOrEqual,
  sessionTerminalCwd,
  ensureTerminalSessionSourceGitSelfContained,
  terminalNamespace,
  terminalSessionSourceRoot,
  terminalWorktreePath,
  terminalProjectScopeKey,
  normalizePlainObject,
  shellQuote,
  stableHash
};
