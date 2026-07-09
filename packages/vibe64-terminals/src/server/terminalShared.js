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
import {
  repairManagedSourcePermissions
} from "@local/vibe64-execution/server";

const CODEX_TERMINAL_NAMESPACE = "vibe64-codex";
const GLOBAL_CODEX_TERMINAL_NAMESPACE = "vibe64-global-codex";
const COMMAND_TERMINAL_NAMESPACE = "vibe64-command";
const LAUNCH_TARGET_TERMINAL_NAMESPACE = "vibe64-launch-target";
const TOOL_TERMINAL_NAMESPACE = "vibe64-tool";
const FIX_CODEX_TERMINAL_NAMESPACE = "vibe64-fix-codex";

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

function fixCodexTerminalNamespace(jobId) {
  return terminalNamespace(FIX_CODEX_TERMINAL_NAMESPACE, jobId);
}

function commandTerminalNamespace(sessionId) {
  return terminalNamespace(COMMAND_TERMINAL_NAMESPACE, sessionId);
}

function toolTerminalNamespace(toolId) {
  return terminalNamespace(TOOL_TERMINAL_NAMESPACE, toolId);
}

function launchTargetTerminalNamespace(sessionId) {
  return terminalNamespace(LAUNCH_TARGET_TERMINAL_NAMESPACE, sessionId);
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
  return String(sharedSessionSourcePath(session) || session.targetRoot || projectServiceTargetRoot(projectService)).trim();
}

function terminalTargetRoot(session = {}, projectService = {}) {
  return normalizedTerminalPath(sharedSessionSourcePath(session) || session.targetRoot || projectServiceTargetRoot(projectService));
}

function terminalWorktreePath(session = {}) {
  return sharedSessionSourcePath(session);
}

async function ensureTerminalSessionSourceGitSelfContained({
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
  const permissionRepair = await repairManagedSourcePermissions([worktreePath]);
  if (permissionRepair?.ok === false) {
    throw new Error(permissionRepair.error || `Could not repair managed source permissions: ${worktreePath}`);
  }
  return ensureSessionSourceGitAlternatesDissociated(worktreePath);
}

export {
  vibe64Result,
  codexTerminalNamespace,
  commandInvocation,
  commandTerminalNamespace,
  directoryExists,
  fixCodexTerminalNamespace,
  globalCodexTerminalNamespace,
  launchTargetTerminalNamespace,
  pathInsideOrEqual,
  sessionTerminalCwd,
  ensureTerminalSessionSourceGitSelfContained,
  terminalNamespace,
  terminalTargetRoot,
  terminalWorktreePath,
  terminalProjectScopeKey,
  toolTerminalNamespace,
  normalizePlainObject,
  shellQuote,
  stableHash
};
