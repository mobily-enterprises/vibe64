import path from "node:path";
import process from "node:process";

import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  recordCommandFactScript
} from "../workflowCommandFacts.js";
import {
  createWorktreeSuccessMetadataFromFacts,
  worktreeMetadata
} from "./factMetadata.js";
import {
  isGitWorktree,
  readCurrentBranchIfPresent,
  readCurrentCommitIfPresent,
  requiredHookCommand,
  worktreeCommandSpec
} from "./shellHelpers.js";

function createWorktreePath(session = {}) {
  return session.sessionRoot ? path.join(session.sessionRoot, "worktree") : "";
}

function createWorktreeBranch(session = {}) {
  return `vibe64/${session.sessionId}`;
}

function prepareWorktreeScriptMount(prepareWorktreeScriptPath = "") {
  const scriptPath = normalizeText(prepareWorktreeScriptPath);
  if (!scriptPath) {
    return [];
  }
  const scriptDirectory = path.dirname(scriptPath);
  return [
    {
      readOnly: true,
      source: scriptDirectory,
      target: scriptDirectory
    }
  ];
}

function createWorktreeScript({
  branch = "",
  prepareWorktreeScriptPath = "",
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const quotedBranch = shellQuote(branch);
  const quotedBranchRef = shellQuote(`refs/heads/${branch}`);
  const quotedPrepareWorktreeScriptPath = shellQuote(normalizeText(prepareWorktreeScriptPath));
  const quotedTargetRoot = shellQuote(targetRoot);
  const quotedWorktreePath = shellQuote(worktreePath);
  const workSource = normalizeText(session.metadata?.work_source) || "new_issue";
  const sourcePrNumber = normalizeText(session.metadata?.source_pr_number);
  const sourcePrHeadRef = normalizeText(session.metadata?.source_pr_head_ref);
  const sourcePrHeadRepo = normalizeText(session.metadata?.source_pr_head_repo);
  const sourcePrHeadSha = normalizeText(session.metadata?.source_pr_head_sha);
  return [
    "set -e",
    `export VIBE64_TARGET_ROOT=${quotedTargetRoot}`,
    `export VIBE64_WORKTREE_PATH=${quotedWorktreePath}`,
    `VIBE64_PREPARE_WORKTREE_SCRIPT=${quotedPrepareWorktreeScriptPath}`,
    "prepare_vibe64_worktree() {",
    "  if [ -n \"$VIBE64_PREPARE_WORKTREE_SCRIPT\" ]; then",
    "    \"$VIBE64_PREPARE_WORKTREE_SCRIPT\"",
    "  fi",
    "}",
    `printf '[studio] Preparing worktree %s\\n' ${quotedWorktreePath}`,
    `if [ -e ${quotedWorktreePath} ]; then`,
    `  existing_worktree_top_level="$(git -C ${quotedWorktreePath} rev-parse --show-toplevel 2>/dev/null || true)"`,
    `  if [ "$existing_worktree_top_level" = ${quotedWorktreePath} ]; then`,
    "    printf '[studio] Reusing existing worktree.\\n'",
    "    prepare_vibe64_worktree",
    "    exit 0",
    "  fi",
    `  if [ -d ${quotedWorktreePath} ] && [ -z "$(find ${quotedWorktreePath} -mindepth 1 -maxdepth 1 -print -quit)" ]; then`,
    `    rmdir ${quotedWorktreePath}`,
    "  else",
    "    printf '[studio] Worktree path exists but is not a Git worktree.\\n' >&2",
    "    exit 1",
    "  fi",
    "fi",
    ...(workSource === "existing_pr" ? [
      `SOURCE_PR_NUMBER=${shellQuote(sourcePrNumber)}`,
      `SOURCE_PR_HEAD_REF=${shellQuote(sourcePrHeadRef)}`,
      `SOURCE_PR_HEAD_REPO=${shellQuote(sourcePrHeadRepo)}`,
      `SOURCE_PR_HEAD_SHA=${shellQuote(sourcePrHeadSha)}`,
      "if [ -z \"$SOURCE_PR_NUMBER\" ]; then",
      "  printf '[studio] Existing PR metadata is incomplete. Abandon this session and start again.\\n' >&2",
      "  exit 1",
      "fi",
      "PR_FETCH_REF=\"refs/remotes/vibe64/pr/$SOURCE_PR_NUMBER\"",
      "printf '[studio] Fetching PR #%s\\n' \"$SOURCE_PR_NUMBER\"",
      `git -C ${quotedTargetRoot} fetch origin "pull/$SOURCE_PR_NUMBER/head:$PR_FETCH_REF"`,
      "FETCHED_PR_SHA=\"$(git -C " + quotedTargetRoot + " rev-parse --verify \"$PR_FETCH_REF\")\"",
      "if [ -n \"$SOURCE_PR_HEAD_SHA\" ] && [ \"$FETCHED_PR_SHA\" != \"$SOURCE_PR_HEAD_SHA\" ]; then",
      "  printf '[studio] Existing PR #%s moved from %s to %s. Start a new session from the updated PR.\\n' \"$SOURCE_PR_NUMBER\" \"$SOURCE_PR_HEAD_SHA\" \"$FETCHED_PR_SHA\" >&2",
      "  exit 1",
      "fi",
      `mkdir -p "$(dirname ${quotedWorktreePath})"`,
      `if git -C ${quotedTargetRoot} show-ref --verify --quiet ${quotedBranchRef}; then`,
      `  git -C ${quotedTargetRoot} worktree add ${quotedWorktreePath} ${quotedBranch}`,
      "else",
      `  git -C ${quotedTargetRoot} worktree add -b ${quotedBranch} ${quotedWorktreePath} "$PR_FETCH_REF"`,
      "fi",
      "prepare_vibe64_worktree",
      "printf '[studio] Session branch will stack on existing PR branch %s/%s.\\n' \"$SOURCE_PR_HEAD_REPO\" \"$SOURCE_PR_HEAD_REF\"",
      recordCommandFactScript("source_pr_update_mode", "stacked"),
      "exit 0"
    ] : []),
    "if ! git -C " + quotedTargetRoot + " rev-parse --git-dir >/dev/null 2>&1; then",
    "  printf '[studio] Initializing Git repository for local project.\\n'",
    `  git -C ${quotedTargetRoot} init -b main`,
    "fi",
    `if ! git -C ${quotedTargetRoot} rev-parse --verify HEAD >/dev/null 2>&1; then`,
    "  printf '[studio] Creating initial commit for seeded repository.\\n'",
    `  git -C ${quotedTargetRoot} add -A`,
    `  git -C ${quotedTargetRoot} commit --allow-empty -m "Initial commit"`,
    "fi",
    "BASE_BRANCH=\"$(git -C " + quotedTargetRoot + " branch --show-current)\"",
    "BASE_COMMIT=\"$(git -C " + quotedTargetRoot + " rev-parse --verify HEAD)\"",
    recordCommandFactScript("base_branch", "\"$BASE_BRANCH\""),
    recordCommandFactScript("base_commit", "\"$BASE_COMMIT\""),
    `mkdir -p "$(dirname ${quotedWorktreePath})"`,
    `if git -C ${quotedTargetRoot} show-ref --verify --quiet ${quotedBranchRef}; then`,
    `  git -C ${quotedTargetRoot} worktree add ${quotedWorktreePath} ${quotedBranch}`,
    "else",
    `  git -C ${quotedTargetRoot} worktree add -b ${quotedBranch} ${quotedWorktreePath} HEAD`,
    "fi",
    "prepare_vibe64_worktree"
  ].join("\n");
}

async function createWorktreeTerminalSpec({
  prepareWorktreeScriptPath = "",
  session = {},
  targetRoot = ""
} = {}) {
  const resolvedTargetRoot = path.resolve(targetRoot || session.targetRoot || process.cwd());
  const worktreePath = normalizeText(session.metadata?.worktree_path) || createWorktreePath(session);
  const branch = normalizeText(session.metadata?.branch) || createWorktreeBranch(session);
  if (!worktreePath || !branch) {
    return {
      ok: false,
      message: "Cannot create a worktree before the Vibe64 session has a root path."
    };
  }
  const [baseBranch, baseCommit] = await Promise.all([
    readCurrentBranchIfPresent(resolvedTargetRoot),
    readCurrentCommitIfPresent(resolvedTargetRoot)
  ]);
  const workSource = normalizeText(session.metadata?.work_source) || "new_issue";
  const metadataBaseBranch = workSource === "existing_pr"
    ? normalizeText(session.metadata?.source_pr_head_ref) || baseBranch
    : baseBranch;
  const metadataBaseCommit = workSource === "existing_pr"
    ? normalizeText(session.metadata?.source_pr_head_sha) || baseCommit
    : baseCommit;
  return {
    args: ["-lc", createWorktreeScript({
      branch,
      prepareWorktreeScriptPath,
      session,
      targetRoot: resolvedTargetRoot,
      worktreePath
    })],
    command: "bash",
    commandPreview: `git worktree add ${worktreePath}`,
    cwd: resolvedTargetRoot,
    mounts: prepareWorktreeScriptMount(prepareWorktreeScriptPath),
    ok: true,
    applySuccessFacts: createWorktreeSuccessMetadataFromFacts,
    successMessage: `Created worktree ${worktreePath} on branch ${branch}.`,
    successMetadata: worktreeMetadata({
      baseBranch: metadataBaseBranch,
      baseCommit: metadataBaseCommit,
      branch,
      worktreePath
    })
  };
}

async function installDependenciesTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
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
  const hookResult = await requiredHookCommand({
    hookContext: {
      context,
      session,
      targetRoot,
      worktreePath
    },
    hookName: "installDependencies",
    hooks,
    missingMessage: "The selected adapter does not provide a dependency install command."
  });
  if (!hookResult.ok) {
    return hookResult;
  }
  const command = hookResult.command;
  return {
    args: ["-lc", command.script],
    command: "bash",
    commandPreview: command.commandPreview,
    cwd: worktreePath,
    ok: true,
    successMessage: `Installed dependencies in ${worktreePath}.`,
    successMetadata: {
      dependencies_installed: "yes",
      dependencies_path: worktreePath,
      ...command.metadata
    }
  };
}

async function runAutomatedChecksTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  const hookResult = await requiredHookCommand({
    hookContext: {
      context,
      session,
      targetRoot,
      worktreePath
    },
    hookName: "automatedChecks",
    hooks,
    missingMessage: "The selected adapter does not provide an automated checks command."
  });
  if (!hookResult.ok) {
    return hookResult;
  }
  const command = hookResult.command;
  return worktreeCommandSpec({
    commandPreview: command.commandPreview,
    label: "Run automated checks",
    metadata: {
      automated_checks_passed: "yes",
      ...command.metadata
    },
    script: command.script,
    session
  });
}

async function updateCodeIndexTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  const hookResult = await requiredHookCommand({
    hookContext: {
      context,
      session,
      targetRoot,
      worktreePath
    },
    hookName: "updateCodeIndex",
    hooks,
    missingMessage: "The selected adapter does not provide a code index command."
  });
  if (!hookResult.ok) {
    return hookResult;
  }
  const command = hookResult.command;
  return worktreeCommandSpec({
    commandPreview: command.commandPreview,
    label: "Update code index",
    metadata: {
      code_index_updated: "yes",
      ...command.metadata
    },
    script: command.script,
    session
  });
}

export {
  createWorktreeBranch,
  createWorktreePath,
  prepareWorktreeScriptMount,
  createWorktreeTerminalSpec,
  installDependenciesTerminalSpec,
  runAutomatedChecksTerminalSpec,
  updateCodeIndexTerminalSpec
};
