import process from "node:process";

import {
  optionalSessionPackageHookScript,
  resolveJskitDevelopmentRepoRoot,
  SESSION_FINALIZATION_GUARD_PACKAGE_SCRIPT
} from "../sessionHooks.js";
import {
  artifactPath,
  completedMetadataSpec,
  metadataPath,
  normalizeText,
  requiredFileScript,
  shellQuote,
  worktreeCommandSpec,
  writeMetadataLineScript
} from "./shared.js";

function createIssueOnGhScript(session = {}) {
  const issueTitlePath = artifactPath(session, "issue_title");
  const issueBodyPath = artifactPath(session, "issue.md");
  const issueUrlPath = metadataPath(session, "issue_url");
  const issueNumberPath = metadataPath(session, "issue_number");
  const storedIssueTitlePath = metadataPath(session, "issue_title");
  return [
    "set -e",
    requiredFileScript(issueTitlePath, "issue title artifact"),
    requiredFileScript(issueBodyPath, "issue body artifact"),
    `ISSUE_TITLE="$(head -n 1 ${shellQuote(issueTitlePath)} | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$ISSUE_TITLE\" ]; then",
    "  printf '[studio] Issue title is empty.\\n' >&2",
    "  exit 1",
    "fi",
    "printf '[studio] Creating GitHub issue: %s\\n' \"$ISSUE_TITLE\"",
    `ISSUE_URL="$(gh issue create --title "$ISSUE_TITLE" --body-file ${shellQuote(issueBodyPath)})"`,
    "printf '%s\\n' \"$ISSUE_URL\"",
    writeMetadataLineScript(issueUrlPath, "\"$ISSUE_URL\""),
    writeMetadataLineScript(storedIssueTitlePath, "\"$ISSUE_TITLE\""),
    "ISSUE_NUMBER=\"$(printf '%s\\n' \"$ISSUE_URL\" | sed -n 's#.*/issues/\\([0-9][0-9]*\\).*#\\1#p' | head -n 1)\"",
    "if [ -n \"$ISSUE_NUMBER\" ]; then",
    `  ${writeMetadataLineScript(issueNumberPath, "\"$ISSUE_NUMBER\"")}`,
    "fi"
  ].join("\n");
}

function createPrOnGhScript(session = {}) {
  const prBodyPath = artifactPath(session, "pull_request.md");
  const issueTitlePath = metadataPath(session, "issue_title");
  const prUrlPath = metadataPath(session, "pr_url");
  const branch = normalizeText(session.metadata?.branch);
  const baseBranch = normalizeText(session.metadata?.base_branch) || "main";
  return [
    "set -e",
    requiredFileScript(prBodyPath, "pull request artifact"),
    `PR_TITLE="$(cat ${shellQuote(issueTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$PR_TITLE\" ]; then",
    `  PR_TITLE="$(grep -m 1 -v '^[[:space:]]*$' ${shellQuote(prBodyPath)} | sed 's/^#*[[:space:]]*//' | sed 's/[[:space:]]*$//')"`,
    "fi",
    "if [ -z \"$PR_TITLE\" ]; then",
    `  PR_TITLE="AI Studio session ${session.sessionId}"`,
    "fi",
    "printf '[studio] Creating GitHub pull request: %s\\n' \"$PR_TITLE\"",
    `PR_URL="$(gh pr create --base ${shellQuote(baseBranch)} --head ${shellQuote(branch)} --title "$PR_TITLE" --body-file ${shellQuote(prBodyPath)})"`,
    "printf '%s\\n' \"$PR_URL\"",
    writeMetadataLineScript(prUrlPath, "\"$PR_URL\"")
  ].join("\n");
}

function mergePrScript({
  developmentRepoRoot = "",
  mergeMethod = "merge",
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const prUrl = normalizeText(session.metadata?.pr_url);
  const prMergedPath = metadataPath(session, "pr_merged");
  const mergeFlag = {
    merge: "--merge",
    rebase: "--rebase",
    squash: "--squash"
  }[normalizeText(mergeMethod)] || "--merge";
  return [
    "set -e",
    optionalSessionPackageHookScript({
      developmentRepoRoot,
      scriptName: SESSION_FINALIZATION_GUARD_PACKAGE_SCRIPT,
      session,
      targetRoot,
      worktreePath
    }),
    `printf '[studio] Merging pull request %s\\n' ${shellQuote(prUrl)}`,
    `gh pr merge ${shellQuote(prUrl)} ${mergeFlag}`,
    writeMetadataLineScript(prMergedPath, "yes")
  ].join("\n");
}

function syncMainCheckoutScript(session = {}, targetRoot = "") {
  const baseBranch = normalizeText(session.metadata?.base_branch) || "main";
  const mainCheckoutSyncedPath = metadataPath(session, "main_checkout_synced");
  return [
    "set -e",
    `printf '[studio] Syncing main checkout %s to %s\\n' ${shellQuote(targetRoot)} ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} fetch origin ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} checkout ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} pull --ff-only origin ${shellQuote(baseBranch)}`,
    writeMetadataLineScript(mainCheckoutSyncedPath, "yes")
  ].join("\n");
}

async function createIssueOnGhTerminalSpec({ session = {} } = {}) {
  return completedMetadataSpec({
    commandPreview: "gh issue create",
    cwd: normalizeText(session.metadata?.worktree_path) || session.targetRoot || process.cwd(),
    label: "Create issue on GH",
    script: createIssueOnGhScript(session)
  });
}

async function createPrOnGhTerminalSpec({ session = {} } = {}) {
  const branch = normalizeText(session.metadata?.branch);
  if (!branch) {
    return {
      ok: false,
      message: "Create the worktree before creating the pull request."
    };
  }
  return worktreeCommandSpec({
    commandPreview: "gh pr create",
    label: "Create PR on GH",
    script: createPrOnGhScript(session),
    session
  });
}

async function mergePrTerminalSpec({
  context = {},
  session = {}
} = {}) {
  if (!normalizeText(session.metadata?.pr_url)) {
    return {
      ok: false,
      message: "Create the pull request before merging."
    };
  }
  const targetRoot = session.targetRoot || process.cwd();
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  const config = context.config || session.config || {};
  const configValues = config.values || config;
  const developmentRepoRoot = await resolveJskitDevelopmentRepoRoot({
    config,
    targetRoot
  });
  return worktreeCommandSpec({
    commandPreview: "gh pr merge",
    label: "Merge PR",
    script: mergePrScript({
      developmentRepoRoot,
      mergeMethod: configValues.github_pr_merge_method,
      session,
      targetRoot,
      worktreePath
    }),
    session
  });
}

async function syncMainCheckoutTerminalSpec({
  session = {},
  targetRoot = ""
} = {}) {
  if (!normalizeText(session.metadata?.pr_merged)) {
    return {
      ok: false,
      message: "Merge the pull request before syncing the main checkout."
    };
  }
  const syncRoot = targetRoot || session.targetRoot || process.cwd();
  return completedMetadataSpec({
    commandPreview: "git fetch && git pull --ff-only",
    cwd: syncRoot,
    label: "Sync main checkout",
    script: syncMainCheckoutScript(session, syncRoot)
  });
}

export {
  createIssueOnGhTerminalSpec,
  createPrOnGhTerminalSpec,
  mergePrTerminalSpec,
  syncMainCheckoutTerminalSpec
};
