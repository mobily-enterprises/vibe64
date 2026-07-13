import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  metadataFilePath,
  recordCommandFactScript
} from "../workflowCommandFacts.js";
import {
  commitChangesSuccessMetadataFromFacts
} from "./factMetadata.js";
import {
  repositoryCommandProfileForSession
} from "./repositoryCommandProfile.js";
import {
  gitWorktreeCommandSpec
} from "./shellHelpers.js";

function localSourceCommitAcceptanceScript() {
  return [
    "if [ -z \"$MAIN_CHECKOUT_ROOT\" ]; then",
    "  printf '[studio] Cannot apply the local commit because the main checkout path is unknown.\\n' >&2",
    "  exit 1",
    "fi",
    "LOCAL_BASE_REF=\"$(resolve_local_base_ref)\"",
    "COMMITS_AHEAD=\"$(git rev-list --count \"$LOCAL_BASE_REF\"..HEAD)\"",
    "if [ \"$COMMITS_AHEAD\" = \"0\" ]; then",
    "  printf '[studio] No local commits exist between %s and %s. Nothing to apply.\\n' \"$LOCAL_BASE_REF\" \"$CURRENT_BRANCH\" >&2",
    "  exit 1",
    "fi",
    "ACCEPTED_COMMIT=\"$(git rev-parse --verify HEAD)\"",
    "printf '[studio] Applying accepted local-source commit %s to %s.\\n' \"$ACCEPTED_COMMIT\" \"$MAIN_CHECKOUT_ROOT\"",
    "git -C \"$MAIN_CHECKOUT_ROOT\" checkout \"$BASE_BRANCH\"",
    "git -C \"$MAIN_CHECKOUT_ROOT\" fetch \"$PWD\" HEAD",
    "git -C \"$MAIN_CHECKOUT_ROOT\" merge --ff-only FETCH_HEAD",
    recordCommandFactScript("accepted_commit", "\"$ACCEPTED_COMMIT\""),
    recordCommandFactScript("local_commit_only", "yes"),
    recordCommandFactScript("main_checkout_synced", "yes"),
    "printf '[studio] Local editor checkout updated to %s.\\n' \"$ACCEPTED_COMMIT\""
  ];
}

function canonicalGitCommitAcceptanceScript() {
  return [
    "if [ -z \"$CANONICAL_REPOSITORY_PATH\" ]; then",
    "  printf '[studio] Cannot save to Vibe64 Git because the canonical repository path is unknown.\\n' >&2",
    "  exit 1",
    "fi",
    "mkdir -p \"$(dirname \"$CANONICAL_REPOSITORY_PATH\")\"",
    "if [ ! -d \"$CANONICAL_REPOSITORY_PATH\" ]; then",
    "  printf '[studio] Initializing Vibe64 Git repository at %s.\\n' \"$CANONICAL_REPOSITORY_PATH\"",
    "  git init --bare \"$CANONICAL_REPOSITORY_PATH\"",
    "fi",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" symbolic-ref HEAD \"refs/heads/$BASE_BRANCH\" >/dev/null 2>&1 || true",
    "if git remote get-url origin >/dev/null 2>&1; then",
    "  git remote set-url origin \"$CANONICAL_REPOSITORY_PATH\"",
    "else",
    "  git remote add origin \"$CANONICAL_REPOSITORY_PATH\"",
    "fi",
    "if git ls-remote --exit-code origin \"refs/heads/$BASE_BRANCH\" >/dev/null 2>&1; then",
    "  git fetch origin \"$BASE_BRANCH\"",
    "  BASE_REF=\"origin/$BASE_BRANCH\"",
    "else",
    "  BASE_REF=\"$(resolve_local_base_ref)\"",
    "fi",
    "COMMITS_AHEAD=\"$(git rev-list --count \"$BASE_REF\"..HEAD)\"",
    "if [ \"$COMMITS_AHEAD\" = \"0\" ]; then",
    "  printf '[studio] No commits exist between %s and %s. Nothing to save.\\n' \"$BASE_REF\" \"$CURRENT_BRANCH\" >&2",
    "  exit 1",
    "fi",
    "ACCEPTED_COMMIT=\"$(git rev-parse --verify HEAD)\"",
    "printf '[studio] Saving accepted commit %s to Vibe64 Git branch %s.\\n' \"$ACCEPTED_COMMIT\" \"$BASE_BRANCH\"",
    "git push origin \"HEAD:refs/heads/$BASE_BRANCH\"",
    recordCommandFactScript("accepted_commit", "\"$ACCEPTED_COMMIT\""),
    recordCommandFactScript("canonical_git_saved", "yes"),
    recordCommandFactScript("main_checkout_synced", "yes"),
    "printf '[studio] Vibe64 Git repository updated to %s.\\n' \"$ACCEPTED_COMMIT\""
  ];
}

function githubPrCommitAcceptanceScript() {
  return [
    "ALLOW_LOCAL_ONLY_COMMIT=",
    "case \"$WORK_SOURCE\" in",
    "  seed|description)",
    "    ALLOW_LOCAL_ONLY_COMMIT=yes",
    "    ;;",
    "esac",
    "if ! git remote get-url origin >/dev/null 2>&1; then",
    "  if [ \"$ALLOW_LOCAL_ONLY_COMMIT\" != \"yes\" ]; then",
    "    printf '[studio] No origin remote is configured. Connect a GitHub repository before finishing GitHub-backed work.\\n' >&2",
    "    exit 1",
    "  fi",
    "  if [ -z \"$MAIN_CHECKOUT_ROOT\" ]; then",
    "    printf '[studio] Cannot apply the local commit because the main checkout path is unknown.\\n' >&2",
    "    exit 1",
    "  fi",
    "  LOCAL_BASE_REF=\"$(resolve_local_base_ref)\"",
    "  COMMITS_AHEAD=\"$(git rev-list --count \"$LOCAL_BASE_REF\"..HEAD)\"",
    "  if [ \"$COMMITS_AHEAD\" = \"0\" ]; then",
    "    printf '[studio] No local commits exist between %s and %s. Nothing to apply.\\n' \"$LOCAL_BASE_REF\" \"$CURRENT_BRANCH\" >&2",
    "    exit 1",
    "  fi",
    "  ACCEPTED_COMMIT=\"$(git rev-parse --verify HEAD)\"",
    "  printf '[studio] No GitHub remote is configured; applying local commit %s to %s.\\n' \"$ACCEPTED_COMMIT\" \"$MAIN_CHECKOUT_ROOT\"",
    "  git -C \"$MAIN_CHECKOUT_ROOT\" checkout \"$BASE_BRANCH\"",
    "  git -C \"$MAIN_CHECKOUT_ROOT\" fetch \"$PWD\" HEAD",
    "  git -C \"$MAIN_CHECKOUT_ROOT\" merge --ff-only FETCH_HEAD",
    recordCommandFactScript("accepted_commit", "\"$ACCEPTED_COMMIT\""),
    recordCommandFactScript("local_commit_only", "yes"),
    recordCommandFactScript("main_checkout_synced", "yes"),
    "  printf '[studio] Local editor checkout updated to %s.\\n' \"$ACCEPTED_COMMIT\"",
    "  exit 0",
    "fi",
    "PUBLISH_BASE_BRANCH=",
    "REMOTE_BASE_FETCH_OUTPUT=",
    "if REMOTE_BASE_FETCH_OUTPUT=\"$(git fetch origin \"$BASE_BRANCH\" 2>&1)\"; then",
    "  BASE_REF=\"origin/$BASE_BRANCH\"",
    "else",
    "  if ! printf '%s\\n' \"$REMOTE_BASE_FETCH_OUTPUT\" | grep -q \"couldn't find remote ref\"; then",
    "    printf '%s\\n' \"$REMOTE_BASE_FETCH_OUTPUT\" >&2",
    "    printf '[studio] Could not fetch origin/%s.\\n' \"$BASE_BRANCH\" >&2",
    "    exit 1",
    "  fi",
    "  if [ \"$ALLOW_LOCAL_ONLY_COMMIT\" != \"yes\" ]; then",
    "    printf '%s\\n' \"$REMOTE_BASE_FETCH_OUTPUT\" >&2",
    "    printf '[studio] origin/%s is missing. Publish the base branch before pushing non-seed work.\\n' \"$BASE_BRANCH\" >&2",
    "    exit 1",
    "  fi",
    "  LOCAL_BASE_REF=\"$(resolve_local_base_ref)\"",
    "  BASE_REF=\"$LOCAL_BASE_REF\"",
    "  PUBLISH_BASE_BRANCH=yes",
    "  printf '[studio] origin/%s is missing; using local base %s.\\n' \"$BASE_BRANCH\" \"$LOCAL_BASE_REF\"",
    "fi",
    "COMMITS_AHEAD=\"$(git rev-list --count \"$BASE_REF\"..HEAD)\"",
    "if [ \"$COMMITS_AHEAD\" = \"0\" ]; then",
    "  printf '[studio] No commits exist between %s and %s. Nothing to push.\\n' \"$BASE_REF\" \"$CURRENT_BRANCH\" >&2",
    "  exit 1",
    "fi",
    "ACCEPTED_COMMIT=\"$(git rev-parse --verify HEAD)\"",
    "if [ \"$PUBLISH_BASE_BRANCH\" = \"yes\" ]; then",
    "  printf '[studio] Publishing base branch %s to origin.\\n' \"$BASE_BRANCH\"",
    "  git push origin \"$LOCAL_BASE_REF:refs/heads/$BASE_BRANCH\"",
    "fi",
    "printf '[studio] Pushing branch %s\\n' \"$CURRENT_BRANCH\"",
    "PUSH_REMOTE=origin",
    "PR_HEAD_OWNER=",
    "PR_HEAD_REPOSITORY=",
    "if ! git push -u origin \"$CURRENT_BRANCH\"; then",
    "  printf '[studio] Origin push failed; trying a GitHub fork for this user.\\n'",
    "  UPSTREAM_REPOSITORY=\"$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')\"",
    "  GITHUB_LOGIN=\"$(gh api user --jq '.login' 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')\"",
    "  if [ -z \"$UPSTREAM_REPOSITORY\" ] || [ -z \"$GITHUB_LOGIN\" ]; then",
    "    printf '[studio] Could not identify the GitHub repository or current GitHub user for fork fallback.\\n' >&2",
    "    exit 1",
    "  fi",
    "  UPSTREAM_NAME=\"${UPSTREAM_REPOSITORY##*/}\"",
    "  FORK_REPOSITORY=\"$GITHUB_LOGIN/$UPSTREAM_NAME\"",
    "  if ! gh repo fork \"$UPSTREAM_REPOSITORY\" --clone=false --remote=false; then",
    "    printf '[studio] GitHub fork fallback failed. Ask a repository administrator for write access or to allow private forks.\\n' >&2",
    "    exit 1",
    "  fi",
    "  FORK_URL=\"$(gh repo view \"$FORK_REPOSITORY\" --json url --jq '.url + \".git\"' 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')\"",
    "  if [ -z \"$FORK_URL\" ]; then",
    "    printf '[studio] Could not resolve the fork repository URL for %s.\\n' \"$FORK_REPOSITORY\" >&2",
    "    exit 1",
    "  fi",
    "  if git remote get-url vibe64-fork >/dev/null 2>&1; then",
    "    git remote set-url vibe64-fork \"$FORK_URL\"",
    "  else",
    "    git remote add vibe64-fork \"$FORK_URL\"",
    "  fi",
    "  git push -u vibe64-fork \"$CURRENT_BRANCH\"",
    "  PUSH_REMOTE=vibe64-fork",
    "  PR_HEAD_OWNER=\"$GITHUB_LOGIN\"",
    "  PR_HEAD_REPOSITORY=\"$FORK_REPOSITORY\"",
    "fi",
    recordCommandFactScript("branch_pushed", "\"$CURRENT_BRANCH\""),
    recordCommandFactScript("branch_push_remote", "\"$PUSH_REMOTE\""),
    "if [ -n \"$PR_HEAD_OWNER\" ]; then",
    `  ${recordCommandFactScript("pr_head_owner", "\"$PR_HEAD_OWNER\"")}`,
    `  ${recordCommandFactScript("pr_head_repository", "\"$PR_HEAD_REPOSITORY\"")}`,
    "fi",
    recordCommandFactScript("accepted_commit", "\"$ACCEPTED_COMMIT\""),
    "printf '[studio] Committed %s\\n' \"$ACCEPTED_COMMIT\""
  ];
}

function repositoryCommitAcceptanceScript(repositoryProfile = {}) {
  if (repositoryProfile.localSource) {
    return localSourceCommitAcceptanceScript();
  }
  if (repositoryProfile.canonicalGit) {
    return canonicalGitCommitAcceptanceScript();
  }
  return githubPrCommitAcceptanceScript();
}

async function canonicalGitRepositoryMounts(repositoryProfile = {}, session = {}) {
  if (!repositoryProfile.canonicalGit) {
    return [];
  }
  const canonicalRepositoryPath = normalizeText(session.metadata?.source_cache_path);
  if (!canonicalRepositoryPath || !path.isAbsolute(canonicalRepositoryPath)) {
    return [];
  }
  const repositoryParent = path.dirname(canonicalRepositoryPath);
  await mkdir(repositoryParent, {
    recursive: true
  });
  return [
    {
      source: repositoryParent,
      target: repositoryParent
    }
  ];
}

function mainCheckoutMounts(repositoryProfile = {}, session = {}) {
  if (!repositoryProfile.localSource) {
    return [];
  }
  const mainCheckoutRoot = normalizeText(session.metadata?.main_checkout_root);
  if (!mainCheckoutRoot || !path.isAbsolute(mainCheckoutRoot)) {
    return [];
  }
  return [
    {
      source: mainCheckoutRoot,
      target: mainCheckoutRoot
    }
  ];
}

async function commitChangesMounts(repositoryProfile = {}, session = {}) {
  return [
    ...await canonicalGitRepositoryMounts(repositoryProfile, session),
    ...mainCheckoutMounts(repositoryProfile, session)
  ];
}

function commitChangesScript(session = {}) {
  const repositoryProfile = repositoryCommandProfileForSession(session);
  const workTitlePath = metadataFilePath(session, "work_title");
  const issueTitlePath = metadataFilePath(session, "issue_title");
  const targetRoot = normalizeText(session.targetRoot);
  const mainCheckoutRoot = normalizeText(session.metadata?.main_checkout_root);
  const workSource = normalizeText(session.metadata?.work_source);
  const canonicalRepositoryPath = normalizeText(session.metadata?.source_cache_path);
  const baseBranch = normalizeText(session.metadata?.base_branch) ||
    normalizeText(session.metadata?.source_pr_head_ref) ||
    normalizeText(session.metadata?.source_pr_base_ref) ||
    "main";
  const baseCommit = normalizeText(session.metadata?.base_commit);
  return [
    "set -e",
    `TARGET_ROOT=${shellQuote(targetRoot)}`,
    `MAIN_CHECKOUT_ROOT=${shellQuote(mainCheckoutRoot)}`,
    `WORK_SOURCE=${shellQuote(workSource)}`,
    `CANONICAL_REPOSITORY_PATH=${shellQuote(canonicalRepositoryPath)}`,
    `COMMIT_TITLE="$(cat ${shellQuote(workTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$COMMIT_TITLE\" ]; then",
    `  COMMIT_TITLE="$(cat ${shellQuote(issueTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "fi",
    "if [ -z \"$COMMIT_TITLE\" ]; then",
    `  COMMIT_TITLE="Vibe64 session ${session.sessionId}"`,
    "fi",
    "if ! GIT_STATUS=\"$(git status --short)\"; then",
    "  printf '[studio] Git could not inspect the working tree. No commit was attempted.\\n' >&2",
    "  exit 1",
    "fi",
    "if [ -n \"$GIT_STATUS\" ]; then",
    "  printf '[studio] Committing changes: %s\\n' \"$COMMIT_TITLE\"",
    "  git add -A",
    "  git commit -m \"$COMMIT_TITLE\"",
    "else",
    "  printf '[studio] No working tree changes to commit; checking existing branch commits.\\n'",
    "fi",
    "CURRENT_BRANCH=\"$(git branch --show-current)\"",
    "if [ -z \"$CURRENT_BRANCH\" ]; then",
    "  printf '[studio] Cannot push from a detached HEAD.\\n' >&2",
    "  exit 1",
    "fi",
    `BASE_BRANCH=${shellQuote(baseBranch)}`,
    `BASE_COMMIT=${shellQuote(baseCommit)}`,
    "resolve_local_base_ref() {",
    "  LOCAL_BASE_REF=\"$BASE_BRANCH\"",
    "  if [ -n \"$BASE_COMMIT\" ] && git rev-parse --verify \"$BASE_COMMIT^{commit}\" >/dev/null 2>&1; then",
    "    LOCAL_BASE_REF=\"$BASE_COMMIT\"",
    "  fi",
    "  if ! git rev-parse --verify \"$LOCAL_BASE_REF^{commit}\" >/dev/null 2>&1; then",
    "    printf '[studio] Cannot resolve local base %s for %s.\\n' \"$LOCAL_BASE_REF\" \"$BASE_BRANCH\" >&2",
    "    return 1",
    "  fi",
    "  printf '%s\\n' \"$LOCAL_BASE_REF\"",
    "}",
    ...repositoryCommitAcceptanceScript(repositoryProfile)
  ].join("\n");
}

async function commitChangesTerminalSpec({ session = {} } = {}) {
  const repositoryProfile = repositoryCommandProfileForSession(session);
  if (repositoryProfile.localSource && !normalizeText(session.metadata?.main_checkout_root)) {
    return {
      ok: false,
      message: "Local source commit requires main_checkout_root metadata."
    };
  }
  return gitWorktreeCommandSpec({
    applySuccessFacts: commitChangesSuccessMetadataFromFacts,
    commandPreview: "git add -A && git commit",
    label: "Commit changes",
    mounts: await commitChangesMounts(repositoryProfile, session),
    requiresHostGithubCredentials: repositoryProfile.githubAuthRequired,
    runtimes: repositoryProfile.githubAuthRequired ? ["gh"] : [],
    script: commitChangesScript(session),
    session
  });
}

export {
  commitChangesTerminalSpec
};
