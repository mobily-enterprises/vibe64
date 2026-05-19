import path from "node:path";
import process from "node:process";

import {
  shellQuote
} from "../../shellCommands.js";
import {
  normalizeText
} from "../core.js";
import {
  recordCommandFactScript
} from "../workflowCommandFacts.js";
import {
  createWorktreeSuccessMetadataFromFacts,
  worktreeMetadata
} from "./factMetadata.js";
import {
  isGitWorktree,
  readCurrentBranch,
  readCurrentCommit,
  requiredHookCommand,
  worktreeCommandSpec
} from "./shellHelpers.js";

function createWorktreePath(session = {}) {
  return session.sessionRoot ? path.join(session.sessionRoot, "worktree") : "";
}

function createWorktreeBranch(session = {}) {
  return `ai-studio/${session.sessionId}`;
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
  const workSource = normalizeText(session.metadata?.work_source) || "new_branch";
  const sourcePrNumber = normalizeText(session.metadata?.source_pr_number);
  const sourcePrHeadRef = normalizeText(session.metadata?.source_pr_head_ref);
  const sourcePrHeadRepo = normalizeText(session.metadata?.source_pr_head_repo);
  const sourcePrUrl = normalizeText(session.metadata?.source_pr_url);
  const requestedUpdateMode = normalizeText(session.metadata?.source_pr_update_mode);
  return [
    "set -e",
    `export AI_STUDIO_TARGET_ROOT=${quotedTargetRoot}`,
    `export AI_STUDIO_WORKTREE_PATH=${quotedWorktreePath}`,
    `AI_STUDIO_PREPARE_WORKTREE_SCRIPT=${quotedPrepareWorktreeScriptPath}`,
    "prepare_ai_studio_worktree() {",
    "  if [ -n \"$AI_STUDIO_PREPARE_WORKTREE_SCRIPT\" ]; then",
    "    \"$AI_STUDIO_PREPARE_WORKTREE_SCRIPT\"",
    "  fi",
    "}",
    `printf '[studio] Preparing worktree %s\\n' ${quotedWorktreePath}`,
    `mkdir -p "$(dirname ${quotedWorktreePath})"`,
    `if [ -e ${quotedWorktreePath} ]; then`,
    `  if git -C ${quotedWorktreePath} rev-parse --is-inside-work-tree >/dev/null 2>&1; then`,
    "    printf '[studio] Reusing existing worktree.\\n'",
    "    prepare_ai_studio_worktree",
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
      `SOURCE_PR_URL=${shellQuote(sourcePrUrl)}`,
      `REQUESTED_UPDATE_MODE=${shellQuote(requestedUpdateMode)}`,
      "if [ -z \"$SOURCE_PR_NUMBER\" ]; then",
      "  printf '[studio] Existing PR metadata is incomplete. Abandon this session and start again.\\n' >&2",
      "  exit 1",
      "fi",
      "PR_FETCH_REF=\"refs/remotes/ai-studio/pr/$SOURCE_PR_NUMBER\"",
      "printf '[studio] Fetching PR #%s\\n' \"$SOURCE_PR_NUMBER\"",
      `git -C ${quotedTargetRoot} fetch origin "pull/$SOURCE_PR_NUMBER/head:$PR_FETCH_REF"`,
      `if git -C ${quotedTargetRoot} show-ref --verify --quiet ${quotedBranchRef}; then`,
      `  git -C ${quotedTargetRoot} worktree add ${quotedWorktreePath} ${quotedBranch}`,
      "else",
      `  git -C ${quotedTargetRoot} worktree add -b ${quotedBranch} ${quotedWorktreePath} "$PR_FETCH_REF"`,
      "fi",
      "prepare_ai_studio_worktree",
      "if [ \"$REQUESTED_UPDATE_MODE\" = \"direct\" ]; then",
      "  if [ -z \"$SOURCE_PR_HEAD_REF\" ] || [ -z \"$SOURCE_PR_HEAD_REPO\" ]; then",
      "    printf '[studio] Existing PR push target is incomplete; this session will create a replacement PR.\\n'",
      `    ${recordCommandFactScript("source_pr_update_mode", "replacement")}`,
      "    exit 0",
      "  fi",
      "  PR_HEAD_REMOTE=\"ai-studio-pr-head\"",
      `  git -C ${quotedWorktreePath} remote remove "$PR_HEAD_REMOTE" >/dev/null 2>&1 || true`,
      `  git -C ${quotedWorktreePath} remote add "$PR_HEAD_REMOTE" "https://github.com/$SOURCE_PR_HEAD_REPO.git"`,
      `  if git -C ${quotedWorktreePath} push --dry-run "$PR_HEAD_REMOTE" "HEAD:refs/heads/$SOURCE_PR_HEAD_REF"; then`,
      "    printf '[studio] Existing PR can be updated directly.\\n'",
      `    ${recordCommandFactScript("source_pr_update_mode", "direct")}`,
      `    ${recordCommandFactScript("pr_url", "\"$SOURCE_PR_URL\"")}`,
      "  else",
      "    printf '[studio] Existing PR cannot be pushed directly; this session will create a replacement PR.\\n'",
      `    ${recordCommandFactScript("source_pr_update_mode", "replacement")}`,
      "  fi",
      "fi",
      "exit 0"
    ] : []),
    `if git -C ${quotedTargetRoot} show-ref --verify --quiet ${quotedBranchRef}; then`,
    `  git -C ${quotedTargetRoot} worktree add ${quotedWorktreePath} ${quotedBranch}`,
    "else",
    `  git -C ${quotedTargetRoot} worktree add -b ${quotedBranch} ${quotedWorktreePath} HEAD`,
    "fi",
    "prepare_ai_studio_worktree"
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
      message: "Cannot create a worktree before the AI Studio session has a root path."
    };
  }
  const [baseBranch, baseCommit] = await Promise.all([
    readCurrentBranch(resolvedTargetRoot),
    readCurrentCommit(resolvedTargetRoot)
  ]);
  const workSource = normalizeText(session.metadata?.work_source) || "new_branch";
  const metadataBaseBranch = workSource === "existing_pr"
    ? normalizeText(session.metadata?.source_pr_base_ref) || baseBranch
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
  createWorktreeTerminalSpec,
  installDependenciesTerminalSpec,
  runAutomatedChecksTerminalSpec,
  updateCodeIndexTerminalSpec
};
