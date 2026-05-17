import path from "node:path";
import process from "node:process";

import {
  isGitWorktree,
  normalizeText,
  readCurrentBranch,
  readCurrentCommit,
  shellQuote
} from "./shared.js";

function worktreeMetadata({
  baseBranch = "",
  baseCommit = "",
  branch = "",
  worktreePath = ""
} = {}) {
  return {
    base_branch: baseBranch,
    base_commit: baseCommit,
    branch,
    worktree_path: worktreePath
  };
}

function createWorktreePath(session = {}) {
  if (!session.sessionRoot) {
    return "";
  }
  return path.join(session.sessionRoot, "worktree");
}

function createWorktreeBranch(session = {}) {
  return `ai-studio/${session.sessionId}`;
}

function createWorktreeScript({
  branch = "",
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const quotedBranch = shellQuote(branch);
  const quotedBranchRef = shellQuote(`refs/heads/${branch}`);
  const quotedTargetRoot = shellQuote(targetRoot);
  const quotedWorktreePath = shellQuote(worktreePath);
  return [
    "set -e",
    `printf '[studio] Preparing worktree %s\\n' ${quotedWorktreePath}`,
    `mkdir -p "$(dirname ${quotedWorktreePath})"`,
    `if [ -e ${quotedWorktreePath} ]; then`,
    `  if git -C ${quotedWorktreePath} rev-parse --is-inside-work-tree >/dev/null 2>&1; then`,
    "    printf '[studio] Reusing existing worktree.\\n'",
    "    exit 0",
    "  fi",
    `  if [ -d ${quotedWorktreePath} ] && [ -z "$(find ${quotedWorktreePath} -mindepth 1 -maxdepth 1 -print -quit)" ]; then`,
    `    rmdir ${quotedWorktreePath}`,
    "  else",
    "    printf '[studio] Worktree path exists but is not a Git worktree.\\n' >&2",
    "    exit 1",
    "  fi",
    "fi",
    `if git -C ${quotedTargetRoot} show-ref --verify --quiet ${quotedBranchRef}; then`,
    `  git -C ${quotedTargetRoot} worktree add ${quotedWorktreePath} ${quotedBranch}`,
    "else",
    `  git -C ${quotedTargetRoot} worktree add -b ${quotedBranch} ${quotedWorktreePath} HEAD`,
    "fi"
  ].join("\n");
}

function npmInstallScript(worktreePath = "") {
  return [
    "set -e",
    `printf '[studio] Installing dependencies in %s\\n' ${shellQuote(worktreePath)}`,
    "printf '[studio] $ npm install --foreground-scripts --no-audit --no-fund\\n\\n'",
    "NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_YES=true npm_config_audit=false npm_config_fund=false npm_config_yes=true npm install --foreground-scripts --no-audit --no-fund"
  ].join("\n");
}

async function createWorktreeTerminalSpec({
  session = {},
  targetRoot = ""
} = {}) {
  const resolvedTargetRoot = path.resolve(targetRoot || session.targetRoot || process.cwd());
  const worktreePath = normalizeText(session.metadata?.worktree_path) || createWorktreePath(session);
  const branch = normalizeText(session.metadata?.branch) || createWorktreeBranch(session);
  if (!worktreePath || !branch) {
    return {
      ok: false,
      message: "Cannot create a worktree before the AI Studio session has a root path."
    };
  }
  const [baseBranch, baseCommit] = await Promise.all([
    readCurrentBranch(resolvedTargetRoot),
    readCurrentCommit(resolvedTargetRoot)
  ]);
  return {
    args: ["-lc", createWorktreeScript({
      branch,
      targetRoot: resolvedTargetRoot,
      worktreePath
    })],
    command: "bash",
    commandPreview: `git worktree add ${worktreePath}`,
    cwd: resolvedTargetRoot,
    ok: true,
    successMessage: `Created worktree ${worktreePath} on branch ${branch}.`,
    successMetadata: worktreeMetadata({
      baseBranch,
      baseCommit,
      branch,
      worktreePath
    })
  };
}

async function installDependenciesTerminalSpec({
  session = {}
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before installing dependencies."
    };
  }
  if (!await isGitWorktree(worktreePath)) {
    return {
      ok: false,
      message: `Session worktree is not ready: ${worktreePath}`
    };
  }
  return {
    args: ["-lc", npmInstallScript(worktreePath)],
    command: "bash",
    commandPreview: "npm install --foreground-scripts --no-audit --no-fund",
    cwd: worktreePath,
    ok: true,
    successMessage: `Installed Node dependencies in ${worktreePath}.`,
    successMetadata: {
      dependencies_installed: "yes",
      dependencies_path: worktreePath
    }
  };
}

export {
  createWorktreeTerminalSpec,
  installDependenciesTerminalSpec
};
