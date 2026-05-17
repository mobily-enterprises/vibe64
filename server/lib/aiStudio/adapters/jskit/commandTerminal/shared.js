import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  shellQuote
} from "../../../../shellCommands.js";
import {
  normalizeText,
  pathExists
} from "../../../core.js";

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

function metadataPath(session = {}, name = "") {
  return session.metadataRoot && name ? path.join(session.metadataRoot, name) : "";
}

function artifactPath(session = {}, relativePath = "") {
  return session.artifactsRoot && relativePath ? path.join(session.artifactsRoot, relativePath) : "";
}

function writeMetadataLineScript(name = "", valueExpression = "") {
  return `printf '%s\\n' ${valueExpression} > ${shellQuote(name)}`;
}

function requiredFileScript(filePath = "", label = "file") {
  const quotedFilePath = shellQuote(filePath);
  return [
    `if [ ! -s ${quotedFilePath} ]; then`,
    `  printf '[studio] Missing ${label}: %s\\n' ${quotedFilePath} >&2`,
    "  exit 1",
    "fi"
  ].join("\n");
}

function completedMetadataSpec({
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
    successMessage: `${label} completed.`,
    successMetadata: metadata
  };
}

async function worktreeCommandSpec({
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
    script
  });
}

export {
  artifactPath,
  completedMetadataSpec,
  isGitWorktree,
  metadataPath,
  normalizeText,
  pathExists,
  readCurrentBranch,
  readCurrentCommit,
  requiredFileScript,
  shellQuote,
  worktreeCommandSpec,
  writeMetadataLineScript
};
