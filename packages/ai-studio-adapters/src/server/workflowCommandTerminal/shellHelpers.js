import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  normalizeText,
  pathExists
} from "@local/ai-studio-core/server/core";

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

async function gitCommandSucceeds(cwd, args) {
  const result = await gitResult(cwd, args);
  return result.ok;
}

async function readCurrentBranch(targetRoot) {
  return gitOutput(targetRoot, ["branch", "--show-current"], {
    timeout: 15_000
  });
}

async function readCurrentCommit(targetRoot) {
  return gitOutput(targetRoot, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
}

async function isGitWorktree(worktreePath) {
  if (!await pathExists(worktreePath)) {
    return false;
  }
  return gitCommandSucceeds(worktreePath, ["rev-parse", "--is-inside-work-tree"]);
}

function completedMetadataSpec({
  applySuccessFacts = null,
  commandPreview = "",
  cwd = "",
  label = "",
  metadata = {},
  script = ""
} = {}) {
  return {
    args: ["-lc", script],
    command: "bash",
    commandPreview,
    cwd,
    ok: true,
    ...(typeof applySuccessFacts === "function" ? { applySuccessFacts } : {}),
    successMessage: `${label} completed.`,
    successMetadata: metadata
  };
}

async function worktreeCommandSpec({
  applySuccessFacts = null,
  commandPreview = "",
  label = "",
  metadata = {},
  script = "",
  session = {}
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before running this command."
    };
  }
  if (!await isGitWorktree(worktreePath)) {
    return {
      ok: false,
      message: `Session worktree is not ready: ${worktreePath}`
    };
  }
  return completedMetadataSpec({
    commandPreview,
    cwd: worktreePath,
    label,
    metadata,
    applySuccessFacts,
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
  readCurrentCommit,
  requiredHookCommand,
  worktreeCommandSpec
};
