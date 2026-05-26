import { stat } from "node:fs/promises";
import path from "node:path";

import {
  aiStudioResult as sharedAiStudioResult,
  normalizePlainObject
} from "@local/ai-studio-core/server/serverResponses";
import {
  dockerCommand,
  shellQuote,
  stableHash
} from "../../../../server/lib/shellCommands.js";

const CODEX_TERMINAL_NAMESPACE = "ai-studio-codex";
const CODEX_TERMINAL_NAMESPACE_PREFIX = `${CODEX_TERMINAL_NAMESPACE}:`;
const COMMAND_TERMINAL_NAMESPACE = "ai-studio-command";
const LAUNCH_TARGET_TERMINAL_NAMESPACE = "ai-studio-launch-target";
const SHELL_TERMINAL_NAMESPACE = "ai-studio-shell";

function aiStudioResult(operation) {
  return sharedAiStudioResult(operation, {
    fallbackCode: "ai_studio_terminal_request_failed",
    fallbackMessage: "AI Studio terminal request failed."
  });
}

function codexTerminalNamespace(sessionId) {
  return `${CODEX_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function commandTerminalNamespace(sessionId) {
  return `${COMMAND_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function launchTargetTerminalNamespace(sessionId) {
  return `${LAUNCH_TARGET_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function shellTerminalNamespace(sessionId) {
  return `${SHELL_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
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
  return String(session.targetRoot || projectService.targetRoot || "").trim();
}

function terminalTargetRoot(session = {}, projectService = {}) {
  return normalizedTerminalPath(session.targetRoot || projectService.targetRoot);
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
  aiStudioResult,
  codexTerminalNamespace,
  commandTerminalNamespace,
  directoryExists,
  launchTargetTerminalNamespace,
  pathInsideOrEqual,
  shellTerminalNamespace,
  sessionTerminalCwd,
  terminalTargetRoot,
  terminalWorktreePath,
  dockerCommand,
  normalizePlainObject,
  shellQuote,
  stableHash
};
