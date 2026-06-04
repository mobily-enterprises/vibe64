import { stat } from "node:fs/promises";
import path from "node:path";

import {
  vibe64Result as sharedVibe64Result,
  normalizePlainObject
} from "@local/vibe64-core/server/serverResponses";
import {
  projectServiceTargetRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  dockerCommand,
  shellQuote,
  stableHash
} from "@local/studio-terminal-core/server/shellCommands";

const CODEX_TERMINAL_NAMESPACE = "vibe64-codex";
const CODEX_TERMINAL_NAMESPACE_PREFIX = `${CODEX_TERMINAL_NAMESPACE}:`;
const GLOBAL_CODEX_TERMINAL_NAMESPACE = "vibe64-global-codex";
const OPENCODE_TERMINAL_NAMESPACE = "vibe64-opencode";
const COMMAND_TERMINAL_NAMESPACE = "vibe64-command";
const LAUNCH_TARGET_TERMINAL_NAMESPACE = "vibe64-launch-target";
const SHELL_TERMINAL_NAMESPACE = "vibe64-shell";
const TOOL_TERMINAL_NAMESPACE = "vibe64-tool";
const FIX_CODEX_TERMINAL_NAMESPACE = "vibe64-fix-codex";

function vibe64Result(operation) {
  return sharedVibe64Result(operation, {
    fallbackCode: "vibe64_terminal_request_failed",
    fallbackMessage: "Vibe64 terminal request failed."
  });
}

function codexTerminalNamespace(sessionId) {
  return `${CODEX_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function globalCodexTerminalNamespace() {
  return GLOBAL_CODEX_TERMINAL_NAMESPACE;
}

function fixCodexTerminalNamespace(jobId) {
  return `${FIX_CODEX_TERMINAL_NAMESPACE}:${String(jobId || "")}`;
}

function commandTerminalNamespace(sessionId) {
  return `${COMMAND_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function opencodeTerminalNamespace(sessionId) {
  return `${OPENCODE_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function toolTerminalNamespace(toolId) {
  return `${TOOL_TERMINAL_NAMESPACE}:${String(toolId || "")}`;
}

function launchTargetTerminalNamespace(sessionId) {
  return `${LAUNCH_TARGET_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function shellTerminalNamespace(sessionId) {
  return `${SHELL_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
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

function sessionTerminalCwd(session = {}, projectService = {}) {
  return String(session.targetRoot || projectServiceTargetRoot(projectService)).trim();
}

function terminalTargetRoot(session = {}, projectService = {}) {
  return normalizedTerminalPath(session.targetRoot || projectServiceTargetRoot(projectService));
}

function sessionHasCreatedWorktree(session = {}) {
  return session?.worktreeReady === true ||
    (Array.isArray(session?.completedSteps) && session.completedSteps.includes("worktree_created"));
}

function terminalWorktreePath(session = {}) {
  const explicitPath = normalizedTerminalPath(
    session.metadata?.worktree_path ||
    session.metadata?.worktree ||
    session.worktree ||
    session.worktreePath
  );
  if (explicitPath) {
    return explicitPath;
  }
  const sessionRoot = normalizedTerminalPath(session.sessionRoot);
  return sessionRoot && sessionHasCreatedWorktree(session)
    ? normalizedTerminalPath(path.join(sessionRoot, "worktree"))
    : "";
}

export {
  CODEX_TERMINAL_NAMESPACE_PREFIX,
  vibe64Result,
  codexTerminalNamespace,
  commandInvocation,
  commandTerminalNamespace,
  directoryExists,
  fixCodexTerminalNamespace,
  globalCodexTerminalNamespace,
  launchTargetTerminalNamespace,
  opencodeTerminalNamespace,
  pathInsideOrEqual,
  shellTerminalNamespace,
  sessionTerminalCwd,
  terminalTargetRoot,
  terminalWorktreePath,
  toolTerminalNamespace,
  dockerCommand,
  normalizePlainObject,
  shellQuote,
  stableHash
};
