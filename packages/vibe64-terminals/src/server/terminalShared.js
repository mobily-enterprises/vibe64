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
  targetRuntimeProjectSlug
} from "@local/vibe64-core/server/projectRuntimeIdentity";
import {
  ensureSessionSourceGitAlternatesDissociated
} from "@local/vibe64-runtime/server/sessionSourceGit";
import {
  dockerCommand,
  shellQuote,
  stableHash
} from "@local/studio-terminal-core/server/shellCommands";
import {
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const CODEX_TERMINAL_NAMESPACE = "vibe64-codex";
const GLOBAL_CODEX_TERMINAL_NAMESPACE = "vibe64-global-codex";
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

function shellTerminalNamespace(sessionId) {
  return terminalNamespace(SHELL_TERMINAL_NAMESPACE, sessionId);
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

function dockerNamePart(value = "", fallback = "item") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || fallback;
}

function terminalRuntimeNamespacePart() {
  const namespace = runtimeNamespace();
  return namespace ? dockerNamePart(namespace, "") : "";
}

function terminalContainerName({
  kind = "terminal",
  parts = [],
  targetRoot = ""
} = {}) {
  return [
    "vibe64",
    terminalRuntimeNamespacePart(),
    targetRuntimeProjectSlug(targetRoot),
    dockerNamePart(kind, "terminal"),
    ...parts.map((part, index) => dockerNamePart(part, `part-${index + 1}`))
  ].filter(Boolean).join("-");
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
  shellTerminalNamespace,
  sessionTerminalCwd,
  ensureTerminalSessionSourceGitSelfContained,
  terminalNamespace,
  terminalContainerName,
  terminalTargetRoot,
  terminalWorktreePath,
  terminalProjectScopeKey,
  toolTerminalNamespace,
  dockerCommand,
  normalizePlainObject,
  shellQuote,
  stableHash
};
