import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  normalizeText,
  pathExists
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 30_000;
const GIT_OUTPUT_BUFFER_BYTES = 1024 * 1024;

function commandOutput(error = {}) {
  return normalizeText(`${error.stdout || ""}\n${error.stderr || ""}`) ||
    normalizeText(error.message);
}

async function gitOutput(cwd, args, {
  timeout = GIT_COMMAND_TIMEOUT_MS
} = {}) {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
    timeout
  });
  return normalizeText(result.stdout);
}

async function gitResult(cwd, args, {
  timeout = GIT_COMMAND_TIMEOUT_MS
} = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
      timeout
    });
    return {
      ok: true,
      output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`)
    };
  } catch (error) {
    return {
      ok: false,
      output: commandOutput(error)
    };
  }
}

async function readCurrentBranch(targetRoot) {
  return gitOutput(targetRoot, ["branch", "--show-current"], {
    timeout: 15_000
  });
}

async function readCurrentBranchIfPresent(targetRoot) {
  const result = await gitResult(targetRoot, ["branch", "--show-current"], {
    timeout: 15_000
  });
  return result.ok ? result.output : "";
}

async function readCurrentCommit(targetRoot) {
  return gitOutput(targetRoot, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
}

async function readCurrentCommitIfPresent(targetRoot) {
  const result = await gitResult(targetRoot, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
  return result.ok ? result.output : "";
}

async function readCurrentRemoteUrlIfPresent(targetRoot, remote = "origin") {
  const result = await gitResult(targetRoot, ["remote", "get-url", remote], {
    timeout: 15_000
  });
  return result.ok ? result.output : "";
}

async function isGitWorktree(worktreePath) {
  if (!await pathExists(worktreePath)) {
    return false;
  }
  const result = await gitResult(worktreePath, ["rev-parse", "--show-toplevel"]);
  return result.ok && path.resolve(result.output) === path.resolve(worktreePath);
}

function completedMetadataSpec({
  applySuccessFacts = null,
  commandPreview = "",
  cwd = "",
  label = "",
  metadata = {},
  mounts = [],
  requiresHostGithubCredentials = false,
  runtimeConfigPhases = [],
  script = ""
} = {}) {
  return {
    args: ["-lc", script],
    command: "bash",
    commandPreview,
    cwd,
    ok: true,
    ...(typeof applySuccessFacts === "function" ? { applySuccessFacts } : {}),
    ...(Array.isArray(mounts) && mounts.length ? { mounts } : {}),
    ...(requiresHostGithubCredentials ? { requiresHostGithubCredentials: true } : {}),
    ...(Array.isArray(runtimeConfigPhases) && runtimeConfigPhases.length ? { runtimeConfigPhases } : {}),
    successMessage: `${label} completed.`,
    successMetadata: metadata
  };
}

async function worktreeCommandSpec({
  applySuccessFacts = null,
  commandPreview = "",
  label = "",
  metadata = {},
  mounts = [],
  requiresHostGithubCredentials = false,
  runtimeConfigPhases = [],
  script = "",
  session = {}
} = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the session clone before running this command."
    };
  }
  if (!await isGitWorktree(worktreePath)) {
    return {
      ok: false,
      message: `Session clone is not ready: ${worktreePath}`
    };
  }
  return completedMetadataSpec({
    commandPreview,
    cwd: worktreePath,
    label,
    metadata,
    mounts,
    applySuccessFacts,
    requiresHostGithubCredentials,
    runtimeConfigPhases,
    script
  });
}

function normalizeMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata || {}).map(([key, value]) => [
    normalizeText(key),
    normalizeText(value)
  ]));
}

function commandScript(command = "", {
  intro = ""
} = {}) {
  const normalizedCommand = normalizeText(command);
  return [
    "set -e",
    intro ? `printf '[studio] ${intro}\\n'` : "",
    `printf '[studio] $ %s\\n\\n' ${shellQuote(normalizedCommand)}`,
    normalizedCommand
  ].filter(Boolean).join("\n");
}

function normalizeHookCommandResult(result = {}, fallback = {}) {
  if (typeof result === "string") {
    return normalizeHookCommandResult({
      command: result
    }, fallback);
  }
  const command = normalizeText(result.command || fallback.command);
  const explicitScript = normalizeText(result.script);
  const script = explicitScript || (command ? commandScript(command, {
    intro: result.intro || fallback.intro
  }) : "");
  return {
    command,
    commandPreview: normalizeText(result.commandPreview || fallback.commandPreview || command),
    metadata: normalizeMetadata({
      ...(fallback.metadata || {}),
      ...(result.metadata || {})
    }),
    script
  };
}

async function requiredHookCommand({
  hookContext = {},
  hookName = "",
  hooks = {},
  missingMessage = ""
} = {}) {
  const hook = hooks?.[hookName];
  if (typeof hook !== "function") {
    return {
      ok: false,
      message: missingMessage || `Adapter command hook ${hookName} is not configured.`
    };
  }
  const command = normalizeHookCommandResult(await hook(hookContext));
  if (!command.script) {
    return {
      ok: false,
      message: `Adapter command hook ${hookName} did not provide a command.`
    };
  }
  return {
    command,
    ok: true
  };
}

export {
  completedMetadataSpec,
  isGitWorktree,
  normalizeHookCommandResult,
  readCurrentBranch,
  readCurrentBranchIfPresent,
  readCurrentCommit,
  readCurrentCommitIfPresent,
  readCurrentRemoteUrlIfPresent,
  requiredHookCommand,
  worktreeCommandSpec
};
