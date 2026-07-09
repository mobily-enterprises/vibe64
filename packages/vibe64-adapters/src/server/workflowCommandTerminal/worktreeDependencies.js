import path from "node:path";
import process from "node:process";
import { mkdir, readFile } from "node:fs/promises";

import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  pathExists,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  buildRuntimeLock,
  readRuntimeLock,
  writeRuntimeLock
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  readProjectManifest,
  writeProjectManifest
} from "@local/vibe64-core/server/projectManifest";
import {
  consumeProjectBootstrapConfig,
  pendingProjectBootstrapConfig,
  readProjectRecordMetadata
} from "@local/vibe64-core/server/projectBootstrapConfig";
import {
  resolveSourceConfigRoot
} from "@local/vibe64-core/server/projectState";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
  explicitSessionSourcePath,
  sessionSourcePath,
  targetSessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  RUNTIME_CONFIG_PHASES
} from "@local/vibe64-core/server/runtimeConfig";
import {
  recordCommandFactScript
} from "../workflowCommandFacts.js";
import {
  createVibe64ProjectConfigStore
} from "../configStore.js";
import {
  createVibe64ProjectTypeStore
} from "../projectType.js";
import {
  createWorktreeSuccessMetadataFromFacts,
  sourceMetadata
} from "./factMetadata.js";
import {
  repositoryCommandProfileForSession
} from "./repositoryCommandProfile.js";
import {
  gitWorktreeStatus,
  readCurrentBranchIfPresent,
  readCurrentCommitIfPresent,
  readCurrentRemoteUrlIfPresent,
  requiredHookCommand,
  worktreeCommandSpec
} from "./shellHelpers.js";

function createSessionSourcePath(session = {}, context = {}) {
  const projectSessionSourceRoot = normalizeText(context.projectSessionSourceRoot);
  return projectSessionSourceRoot
    ? targetSessionSourcePath(projectSessionSourceRoot, session.sessionId || session.id)
    : "";
}

function createWorktreePath(session = {}, context = {}) {
  return createSessionSourcePath(session, context);
}

function createWorktreeBranch(session = {}) {
  return `vibe64/${session.sessionId}`;
}

function projectRuntimeRootFromSession(session = {}, projectRuntimeRoot = "") {
  const sessionRoot = normalizeText(session.sessionRoot);
  if (sessionRoot) {
    return path.dirname(path.dirname(path.dirname(sessionRoot)));
  }
  const normalizedRuntimeRoot = normalizeText(projectRuntimeRoot);
  return normalizedRuntimeRoot ? path.resolve(normalizedRuntimeRoot) : "";
}

function createGitCachePath(session = {}, context = {}) {
  const repositoryProfile = repositoryCommandProfileForSession(session);
  if (repositoryProfile.localSource) {
    return "";
  }
  const projectSourceRoot = normalizeText(context.targetRoot || session.targetRoot);
  const runtimeRoot = projectSourceRoot || projectRuntimeRootFromSession(session, context.projectLocalRoot);
  return runtimeRoot ? path.join(runtimeRoot, "git-cache", "repository.git") : "";
}

function sourcePathAuthority({
  context = {},
  session = {},
  sourcePath = ""
} = {}) {
  const projectSessionSourceRoot = normalizeText(context.projectSessionSourceRoot);
  const expectedManagedPath = projectSessionSourceRoot
    ? targetSessionSourcePath(projectSessionSourceRoot, session.sessionId || session.id)
    : "";
  if (
    expectedManagedPath &&
    sourcePath &&
    path.resolve(sourcePath) === path.resolve(expectedManagedPath)
  ) {
    return SESSION_SOURCE_PATH_AUTHORITY_MANAGED;
  }
  return "";
}

function normalizeGithubRepository(value = {}) {
  const fullName = normalizeText(value?.fullName);
  const owner = normalizeText(value?.owner);
  const name = normalizeText(value?.name);
  const normalizedFullName = fullName || (owner && name ? `${owner}/${name}` : "");
  if (!normalizedFullName) {
    return null;
  }
  return {
    cloneUrl: normalizeText(value?.cloneUrl) || `https://github.com/${normalizedFullName}.git`,
    defaultBranch: normalizeText(value?.defaultBranch),
    fullName: normalizedFullName
  };
}

async function readProjectGithubRepository({
  projectRecordPath = ""
} = {}) {
  const metadataPath = normalizeText(projectRecordPath)
    ? path.resolve(projectRecordPath)
    : "";
  if (!metadataPath) {
    return null;
  }
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const repository = normalizeGithubRepository(metadata?.repository?.github);
    if (repository) {
      return repository;
    }
  } catch {
    return null;
  }
  return null;
}

async function readOriginUrlIfPresent(targetRoot = "") {
  try {
    return normalizeText(await readCurrentRemoteUrlIfPresent(targetRoot));
  } catch {
    return "";
  }
}

function sessionUsesSourcePullRequest(session = {}) {
  const metadata = session.metadata || {};
  return normalizeText(metadata.source_pr_update_mode) === "stacked" ||
    normalizeText(metadata.pr_source) === "existing" ||
    Boolean(normalizeText(metadata.source_pr_url));
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

function sessionSourceParentMount(sourcePath = "") {
  const normalizedSourcePath = normalizeText(sourcePath);
  if (!normalizedSourcePath) {
    return [];
  }
  const sourceParentPath = path.dirname(path.resolve(normalizedSourcePath));
  return [
    {
      source: sourceParentPath,
      target: sourceParentPath
    }
  ];
}

function createWorktreeScript({
  branch = "",
  cachePath = "",
  defaultBranch = "",
  prepareWorktreeScriptPath = "",
  repositoryProfile = repositoryCommandProfileForSession(session),
  remoteUrl = "",
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const quotedBranch = shellQuote(branch);
  const quotedCachePath = shellQuote(cachePath);
  const quotedDefaultBranch = shellQuote(defaultBranch);
  const quotedPrepareWorktreeScriptPath = shellQuote(normalizeText(prepareWorktreeScriptPath));
  const quotedRemoteUrl = shellQuote(remoteUrl);
  const quotedTargetRoot = shellQuote(targetRoot);
  const quotedWorktreePath = shellQuote(worktreePath);
  const sourcePrNumber = normalizeText(session.metadata?.source_pr_number);
  const sourcePrHeadRef = normalizeText(session.metadata?.source_pr_head_ref);
  const sourcePrHeadRepo = normalizeText(session.metadata?.source_pr_head_repo);
  const sourcePrHeadSha = normalizeText(session.metadata?.source_pr_head_sha);
  return [
    "set -e",
    `export VIBE64_TARGET_ROOT=${quotedTargetRoot}`,
    `export VIBE64_SOURCE_ROOT=${quotedWorktreePath}`,
    `export VIBE64_MAIN_CHECKOUT_ROOT=${quotedTargetRoot}`,
    `VIBE64_GIT_CACHE_PATH=${quotedCachePath}`,
    `VIBE64_GIT_REMOTE_URL=${quotedRemoteUrl}`,
    `VIBE64_GIT_DEFAULT_BRANCH=${quotedDefaultBranch}`,
    `VIBE64_PREPARE_WORKTREE_SCRIPT=${quotedPrepareWorktreeScriptPath}`,
    "prepare_vibe64_worktree() {",
    "  if [ -n \"$VIBE64_PREPARE_WORKTREE_SCRIPT\" ]; then",
    "    \"$VIBE64_PREPARE_WORKTREE_SCRIPT\"",
    "  fi",
    "}",
    "record_session_clone_facts() {",
    recordCommandFactScript("source_kind", "session_clone"),
    recordCommandFactScript("source_path", "\"$VIBE64_SOURCE_ROOT\""),
    recordCommandFactScript("main_checkout_root", "\"$VIBE64_MAIN_CHECKOUT_ROOT\""),
    recordCommandFactScript("source_cache_path", "\"$VIBE64_GIT_CACHE_PATH\""),
    recordCommandFactScript("source_remote_url", "\"$VIBE64_GIT_REMOTE_URL\""),
    recordCommandFactScript("source_default_branch", "\"$BASE_BRANCH\""),
    "}",
    "remove_session_clone_local_branch() {",
    "  branch_name=\"$1\"",
    "  if [ -z \"$branch_name\" ]; then",
    "    return 0",
    "  fi",
    `  current_branch="$(git -C ${quotedWorktreePath} branch --show-current 2>/dev/null || true)"`,
    "  if [ \"$branch_name\" = \"$current_branch\" ]; then",
    "    return 0",
    "  fi",
    `  if git -C ${quotedWorktreePath} show-ref --verify --quiet "refs/heads/$branch_name"; then`,
    `    git -C ${quotedWorktreePath} branch -D "$branch_name"`,
    "  fi",
    "}",
    "ensure_session_clone_self_contained() {",
    "  alternates_file=\"$(git -C \"$VIBE64_SOURCE_ROOT\" rev-parse --git-path objects/info/alternates 2>/dev/null || true)\"",
    "  if [ -z \"$alternates_file\" ] || [ ! -s \"$alternates_file\" ]; then",
    "    return 0",
    "  fi",
    "  printf '[studio] Dissociating session clone from Git cache alternates.\\n'",
    "  git -C \"$VIBE64_SOURCE_ROOT\" repack -a -d",
    "  rm -f \"$alternates_file\"",
    "}",
    "remote_url_from_target() {",
    `  git -C ${quotedTargetRoot} remote get-url origin 2>/dev/null || true`,
    "}",
    "ensure_remote_cache() {",
    "  if [ -z \"$VIBE64_GIT_REMOTE_URL\" ]; then",
    "    return 1",
    "  fi",
    "  if [ -z \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    "    return 1",
    "  fi",
    "  mkdir -p \"$(dirname \"$VIBE64_GIT_CACHE_PATH\")\"",
    "  if [ ! -d \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    "    printf '[studio] Creating Git cache for %s.\\n' \"$VIBE64_GIT_REMOTE_URL\"",
    "    git clone --bare \"$VIBE64_GIT_REMOTE_URL\" \"$VIBE64_GIT_CACHE_PATH\"",
    "    return 0",
    "  fi",
    "  printf '[studio] Refreshing Git cache for %s.\\n' \"$VIBE64_GIT_REMOTE_URL\"",
    "  git -C \"$VIBE64_GIT_CACHE_PATH\" remote set-url origin \"$VIBE64_GIT_REMOTE_URL\"",
    "  git -C \"$VIBE64_GIT_CACHE_PATH\" fetch --prune origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'",
    "}",
    "default_branch_from_cache() {",
    "  if [ -n \"$VIBE64_GIT_DEFAULT_BRANCH\" ]; then",
    "    printf '%s\\n' \"$VIBE64_GIT_DEFAULT_BRANCH\"",
    "    return 0",
    "  fi",
    "  if [ -n \"$VIBE64_GIT_CACHE_PATH\" ] && [ -d \"$VIBE64_GIT_CACHE_PATH\" ] && [ -n \"$(git -C \"$VIBE64_GIT_CACHE_PATH\" for-each-ref --format='%(refname)' refs/heads | head -n 1)\" ]; then",
    "    git -C \"$VIBE64_GIT_CACHE_PATH\" symbolic-ref -q --short HEAD 2>/dev/null | sed 's#^refs/heads/##' || true",
    "  fi",
    "}",
    "remote_cache_has_branch() {",
    "  branch_name=\"$1\"",
    "  if [ -z \"$branch_name\" ] || [ -z \"$VIBE64_GIT_CACHE_PATH\" ] || [ ! -d \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    "    return 1",
    "  fi",
    "  git -C \"$VIBE64_GIT_CACHE_PATH\" rev-parse --verify \"refs/heads/$branch_name^{commit}\" >/dev/null 2>&1",
    "}",
    "remote_cache_has_any_head() {",
    "  if [ -z \"$VIBE64_GIT_CACHE_PATH\" ] || [ ! -d \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    "    return 1",
    "  fi",
    "  test -n \"$(git -C \"$VIBE64_GIT_CACHE_PATH\" for-each-ref --format='%(refname)' refs/heads | head -n 1)\"",
    "}",
    "complete_existing_session_clone() {",
    `  current_branch="$(git -C ${quotedWorktreePath} branch --show-current 2>/dev/null || true)"`,
    `  if [ -n "$current_branch" ] && [ "$current_branch" != ${quotedBranch} ]; then`,
    "    BASE_BRANCH=\"$current_branch\"",
    "  else",
    `    BASE_BRANCH="$(git -C ${quotedWorktreePath} symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"`,
    "  fi",
    "  if [ -z \"$BASE_BRANCH\" ]; then",
    "    BASE_BRANCH=\"$(default_branch_from_cache | head -n 1 | sed 's/[[:space:]]*$//')\"",
    "  fi",
    "  if [ -z \"$BASE_BRANCH\" ]; then",
    "    BASE_BRANCH=main",
    "  fi",
    `  BASE_COMMIT="$(git -C ${quotedWorktreePath} rev-parse --verify "HEAD^{commit}")"`,
    recordCommandFactScript("base_branch", "\"$BASE_BRANCH\""),
    recordCommandFactScript("base_commit", "\"$BASE_COMMIT\""),
    "  record_session_clone_facts",
    `  git -C ${quotedWorktreePath} checkout -B ${quotedBranch} "$BASE_COMMIT"`,
    "  remove_session_clone_local_branch \"$BASE_BRANCH\"",
    "  ensure_session_clone_self_contained",
    "  prepare_vibe64_worktree",
    "}",
    "clone_remote_default_branch() {",
    "  if [ -n \"$VIBE64_GIT_CACHE_PATH\" ] && [ -d \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    `    git clone --reference-if-able "$VIBE64_GIT_CACHE_PATH" --dissociate --single-branch --branch "$BASE_BRANCH" "$VIBE64_GIT_REMOTE_URL" ${quotedWorktreePath}`,
    "  else",
    `    git clone --single-branch --branch "$BASE_BRANCH" "$VIBE64_GIT_REMOTE_URL" ${quotedWorktreePath}`,
    "  fi",
    "}",
    "clone_empty_remote_repository() {",
    "  printf '[studio] Remote repository has no branches; creating local base branch %s.\\n' \"$BASE_BRANCH\"",
    "  if [ -n \"$VIBE64_GIT_CACHE_PATH\" ] && [ -d \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    `    git clone --reference-if-able "$VIBE64_GIT_CACHE_PATH" --dissociate "$VIBE64_GIT_REMOTE_URL" ${quotedWorktreePath}`,
    "  else",
    `    git clone "$VIBE64_GIT_REMOTE_URL" ${quotedWorktreePath}`,
    "  fi",
    `  git -C ${quotedWorktreePath} checkout --orphan "$BASE_BRANCH"`,
    `  git -C ${quotedWorktreePath} commit --allow-empty -m "Initial commit"`,
    `  BASE_COMMIT="$(git -C ${quotedWorktreePath} rev-parse --verify HEAD)"`,
    "}",
    "clone_from_remote() {",
    "  if [ -z \"$VIBE64_GIT_REMOTE_URL\" ]; then",
    "    return 1",
    "  fi",
    "  ensure_remote_cache",
    "  BASE_BRANCH=\"$(default_branch_from_cache | head -n 1 | sed 's/[[:space:]]*$//')\"",
    "  if [ -z \"$BASE_BRANCH\" ]; then",
    "    BASE_BRANCH=main",
    "  fi",
    `  mkdir -p "$(dirname ${quotedWorktreePath})"`,
    "  if remote_cache_has_branch \"$BASE_BRANCH\"; then",
    "    clone_remote_default_branch",
    `    git -C ${quotedWorktreePath} fetch origin "$BASE_BRANCH"`,
    `    BASE_COMMIT="$(git -C ${quotedWorktreePath} rev-parse --verify "origin/$BASE_BRANCH^{commit}")"`,
    "  else",
    "    if remote_cache_has_any_head; then",
    "      printf '[studio] Remote branch %s was not found. Check the repository default branch.\\n' \"$BASE_BRANCH\" >&2",
    "      exit 1",
    "    fi",
    "    clone_empty_remote_repository",
    "  fi",
    recordCommandFactScript("base_branch", "\"$BASE_BRANCH\""),
    recordCommandFactScript("base_commit", "\"$BASE_COMMIT\""),
    "  record_session_clone_facts",
    `  git -C ${quotedWorktreePath} checkout -B ${quotedBranch} "$BASE_COMMIT"`,
    "  remove_session_clone_local_branch \"$BASE_BRANCH\"",
    "  ensure_session_clone_self_contained",
    "  return 0",
    "}",
    "clone_from_canonical_git() {",
    "  if [ -z \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    "    printf '[studio] Cannot clone Vibe64 Git because the canonical repository path is unknown.\\n' >&2",
    "    exit 1",
    "  fi",
    "  mkdir -p \"$(dirname \"$VIBE64_GIT_CACHE_PATH\")\"",
    "  if [ ! -d \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    "    printf '[studio] Initializing Vibe64 Git repository at %s.\\n' \"$VIBE64_GIT_CACHE_PATH\"",
    "    git init --bare \"$VIBE64_GIT_CACHE_PATH\"",
    "  fi",
    "  BASE_BRANCH=\"$(default_branch_from_cache | head -n 1 | sed 's/[[:space:]]*$//')\"",
    "  if [ -z \"$BASE_BRANCH\" ]; then",
    "    BASE_BRANCH=main",
    "  fi",
    "  git --git-dir \"$VIBE64_GIT_CACHE_PATH\" symbolic-ref HEAD \"refs/heads/$BASE_BRANCH\" >/dev/null 2>&1 || true",
    `  mkdir -p "$(dirname ${quotedWorktreePath})"`,
    "  if remote_cache_has_branch \"$BASE_BRANCH\"; then",
    `    git clone --single-branch --branch "$BASE_BRANCH" "$VIBE64_GIT_CACHE_PATH" ${quotedWorktreePath}`,
    `    BASE_COMMIT="$(git -C ${quotedWorktreePath} rev-parse --verify "HEAD^{commit}")"`,
    "  else",
    "    if remote_cache_has_any_head; then",
    "      printf '[studio] Vibe64 Git branch %s was not found. Check the repository default branch.\\n' \"$BASE_BRANCH\" >&2",
    "      exit 1",
    "    fi",
    "    printf '[studio] Vibe64 Git repository has no branches; creating local base branch %s.\\n' \"$BASE_BRANCH\"",
    `    git clone "$VIBE64_GIT_CACHE_PATH" ${quotedWorktreePath}`,
    `    git -C ${quotedWorktreePath} checkout --orphan "$BASE_BRANCH"`,
    `    git -C ${quotedWorktreePath} commit --allow-empty -m "Initial commit"`,
    `    BASE_COMMIT="$(git -C ${quotedWorktreePath} rev-parse --verify HEAD)"`,
    "  fi",
    recordCommandFactScript("base_branch", "\"$BASE_BRANCH\""),
    recordCommandFactScript("base_commit", "\"$BASE_COMMIT\""),
    "  record_session_clone_facts",
    `  git -C ${quotedWorktreePath} remote set-url origin "$VIBE64_GIT_CACHE_PATH"`,
    `  git -C ${quotedWorktreePath} checkout -B ${quotedBranch} "$BASE_COMMIT"`,
    "  remove_session_clone_local_branch \"$BASE_BRANCH\"",
    "  ensure_session_clone_self_contained",
    "}",
    "clone_from_local_target() {",
    "  if ! git -C " + quotedTargetRoot + " rev-parse --git-dir >/dev/null 2>&1; then",
    "    printf '[studio] Initializing Git repository for local project.\\n'",
    `    git -C ${quotedTargetRoot} init -b main`,
    "  fi",
    `  if ! git -C ${quotedTargetRoot} rev-parse --verify HEAD >/dev/null 2>&1; then`,
    "    printf '[studio] Creating initial commit for seeded repository.\\n'",
    `    git -C ${quotedTargetRoot} add -A`,
    `    git -C ${quotedTargetRoot} commit --allow-empty -m "Initial commit"`,
    "  fi",
    "  BASE_BRANCH=\"$(git -C " + quotedTargetRoot + " branch --show-current)\"",
    "  if [ -z \"$BASE_BRANCH\" ]; then",
    "    BASE_BRANCH=main",
    "  fi",
    "  BASE_COMMIT=\"$(git -C " + quotedTargetRoot + " rev-parse --verify HEAD)\"",
    `  mkdir -p "$(dirname ${quotedWorktreePath})"`,
    `  git clone --single-branch --branch "$BASE_BRANCH" ${quotedTargetRoot} ${quotedWorktreePath}`,
    recordCommandFactScript("base_branch", "\"$BASE_BRANCH\""),
    recordCommandFactScript("base_commit", "\"$BASE_COMMIT\""),
    "  record_session_clone_facts",
    `  git -C ${quotedWorktreePath} checkout -B ${quotedBranch} "$BASE_COMMIT"`,
    "  remove_session_clone_local_branch \"$BASE_BRANCH\"",
    "  ensure_session_clone_self_contained",
    "}",
    `printf '[studio] Preparing session clone %s\\n' ${quotedWorktreePath}`,
    `if [ -e ${quotedWorktreePath} ]; then`,
    `  existing_worktree_top_level="$(git -C ${quotedWorktreePath} rev-parse --show-toplevel 2>/dev/null || true)"`,
    `  if [ "$existing_worktree_top_level" = ${quotedWorktreePath} ]; then`,
    "    printf '[studio] Reusing existing session clone.\\n'",
    "    complete_existing_session_clone",
    "    exit 0",
    "  fi",
    `  if [ -d ${quotedWorktreePath} ] && [ -z "$(find ${quotedWorktreePath} -mindepth 1 -maxdepth 1 -print -quit)" ]; then`,
    `    rmdir ${quotedWorktreePath}`,
    "  else",
    "    printf '[studio] Session clone path exists but is not a Git repository.\\n' >&2",
    "    exit 1",
    "  fi",
    "fi",
    ...(repositoryProfile.githubPr ? [
      "if [ -z \"$VIBE64_GIT_REMOTE_URL\" ]; then",
      "  VIBE64_GIT_REMOTE_URL=\"$(remote_url_from_target | head -n 1 | sed 's/[[:space:]]*$//')\"",
      "fi"
    ] : []),
    ...(repositoryProfile.githubPr && sessionUsesSourcePullRequest(session) ? [
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
      "if [ -z \"$VIBE64_GIT_REMOTE_URL\" ]; then",
      "  printf '[studio] Existing PR sessions require a GitHub remote URL.\\n' >&2",
      "  exit 1",
      "fi",
      "ensure_remote_cache",
      "CLONE_BASE_BRANCH=\"$(default_branch_from_cache | head -n 1 | sed 's/[[:space:]]*$//')\"",
      "if [ -z \"$CLONE_BASE_BRANCH\" ]; then",
      "  CLONE_BASE_BRANCH=main",
      "fi",
      `mkdir -p "$(dirname ${quotedWorktreePath})"`,
      "if [ -n \"$VIBE64_GIT_CACHE_PATH\" ] && [ -d \"$VIBE64_GIT_CACHE_PATH\" ]; then",
      `  git clone --reference-if-able "$VIBE64_GIT_CACHE_PATH" --dissociate --single-branch --branch "$CLONE_BASE_BRANCH" "$VIBE64_GIT_REMOTE_URL" ${quotedWorktreePath}`,
      "else",
      `  git clone --single-branch --branch "$CLONE_BASE_BRANCH" "$VIBE64_GIT_REMOTE_URL" ${quotedWorktreePath}`,
      "fi",
      `CLONED_DEFAULT_BRANCH="$(git -C ${quotedWorktreePath} branch --show-current 2>/dev/null || true)"`,
      `git -C ${quotedWorktreePath} fetch origin "pull/$SOURCE_PR_NUMBER/head:$PR_FETCH_REF"`,
      "FETCHED_PR_SHA=\"$(git -C " + quotedWorktreePath + " rev-parse --verify \"$PR_FETCH_REF\")\"",
      "if [ -n \"$SOURCE_PR_HEAD_SHA\" ] && [ \"$FETCHED_PR_SHA\" != \"$SOURCE_PR_HEAD_SHA\" ]; then",
      "  printf '[studio] Existing PR #%s moved from %s to %s. Start a new session from the updated PR.\\n' \"$SOURCE_PR_NUMBER\" \"$SOURCE_PR_HEAD_SHA\" \"$FETCHED_PR_SHA\" >&2",
      "  exit 1",
      "fi",
      "BASE_BRANCH=\"$SOURCE_PR_HEAD_REF\"",
      "BASE_COMMIT=\"$FETCHED_PR_SHA\"",
      recordCommandFactScript("base_branch", "\"$BASE_BRANCH\""),
      recordCommandFactScript("base_commit", "\"$BASE_COMMIT\""),
      "record_session_clone_facts",
      `git -C ${quotedWorktreePath} checkout -B ${quotedBranch} "$PR_FETCH_REF"`,
      "remove_session_clone_local_branch \"$CLONED_DEFAULT_BRANCH\"",
      "ensure_session_clone_self_contained",
      "prepare_vibe64_worktree",
      "printf '[studio] Session branch will stack on existing PR branch %s/%s.\\n' \"$SOURCE_PR_HEAD_REPO\" \"$SOURCE_PR_HEAD_REF\"",
      recordCommandFactScript("source_pr_update_mode", "stacked"),
      "exit 0"
    ] : []),
    ...(repositoryProfile.canonicalGit ? [
      "clone_from_canonical_git"
    ] : repositoryProfile.localSource ? [
      "clone_from_local_target"
    ] : [
      "if [ -n \"$VIBE64_GIT_REMOTE_URL\" ]; then",
      "  clone_from_remote",
      "else",
      "  clone_from_local_target",
      "fi"
    ]),
    "prepare_vibe64_worktree"
  ].join("\n");
}

function createWorktreeSuccessMetadataWithBootstrap({
  context = {},
  facts = {},
  session = {}
} = {}) {
  const result = createWorktreeSuccessMetadataFromFacts({
    facts,
    session
  });
  const authority = sourcePathAuthority({
    context,
    session,
    sourcePath: normalizeText(result.metadata.source_path)
  });
  if (authority && !normalizeText(result.metadata.source_path_authority)) {
    result.metadata.source_path_authority = authority;
  }
  const materialized = materializeProjectConfigInSessionSource({
    context,
    metadata: result.metadata,
    session
  });
  if (materialized && typeof materialized.then === "function") {
    return materialized.then(() => result);
  }
  return result;
}

function materializeProjectConfigInSessionSource({
  context = {},
  metadata = {},
  session = {}
} = {}) {
  const sourceRoot = normalizeText(context.sourceRoot);
  const projectRecordPath = normalizeText(context.projectRecordPath);
  if (!sourceRoot && !projectRecordPath) {
    return null;
  }
  return materializeProjectConfigInSessionSourceAsync({
    context,
    metadata,
    session
  });
}

async function materializeProjectConfigInSessionSourceAsync({
  context = {},
  metadata = {},
  session = {}
} = {}) {
  await copySelectedSourceConfigToSessionSource({
    context,
    metadata,
    session
  });
  return materializeBootstrapConfigInSessionSource({
    context,
    metadata,
    session
  });
}

async function copySelectedSourceConfigToSessionSource({
  context = {},
  metadata = {},
  session = {}
} = {}) {
  const selectedSourceRoot = normalizeText(context.sourceRoot);
  if (!selectedSourceRoot) {
    return false;
  }
  const sourcePath = normalizeText(metadata.source_path);
  const expectedSourcePath = createSessionSourcePath(session, context);
  if (!sourcePath || !expectedSourcePath) {
    return false;
  }
  if (path.resolve(sourcePath) !== path.resolve(expectedSourcePath)) {
    const error = new Error("Source config can only be materialized into the current session source.");
    error.code = "vibe64_project_config_source_outside_session";
    throw error;
  }
  if (!await pathExists(sourcePath)) {
    const error = new Error("Source config cannot be materialized before the session source exists.");
    error.code = "vibe64_project_config_source_missing";
    throw error;
  }

  const selectedSourceContractRoot = resolveSourceConfigRoot({
    sourceRoot: selectedSourceRoot
  });
  const sessionSourceContractRoot = resolveSourceConfigRoot({
    sourceRoot: sourcePath
  });
  const selectedManifest = await readProjectManifest({
    sourceContractRoot: selectedSourceContractRoot
  });
  if (!selectedManifest?.projectType) {
    return false;
  }

  await mkdir(sessionSourceContractRoot, {
    recursive: true
  });
  await writeProjectManifest({
    manifest: selectedManifest,
    sourceContractRoot: sessionSourceContractRoot
  });
  const selectedRuntimeLock = await readRuntimeLock({
    sourceContractRoot: selectedSourceContractRoot
  });
  if (selectedRuntimeLock) {
    await writeRuntimeLock({
      lock: selectedRuntimeLock,
      sourceContractRoot: sessionSourceContractRoot
    });
  }
  return true;
}

function materializeBootstrapConfigInSessionSource({
  context = {},
  metadata = {},
  session = {}
} = {}) {
  const projectRecordPath = normalizeText(context.projectRecordPath);
  if (!projectRecordPath) {
    return null;
  }
  return materializeBootstrapConfigInSessionSourceAsync({
    context,
    metadata,
    projectRecordPath,
    session
  });
}

async function materializeBootstrapConfigInSessionSourceAsync({
  context = {},
  metadata = {},
  projectRecordPath = "",
  session = {}
} = {}) {
  const bootstrapConfig = pendingProjectBootstrapConfig(await readProjectRecordMetadata(projectRecordPath));
  if (!bootstrapConfig) {
    return null;
  }
  const expectedSourcePath = createSessionSourcePath(session, context);
  const sourcePath = normalizeText(metadata.source_path) || expectedSourcePath;
  const projectLocalRoot = normalizeText(context.projectLocalRoot);
  const adapter = context.runtime?.adapter;
  if (!sourcePath || !projectLocalRoot || !adapter) {
    const error = new Error("Cannot materialize pending bootstrap config without a session source, project runtime root, and adapter.");
    error.code = "vibe64_project_bootstrap_context_missing";
    throw error;
  }
  if (!expectedSourcePath || path.resolve(sourcePath) !== path.resolve(expectedSourcePath)) {
    const error = new Error("Pending bootstrap config can only be materialized into the current session source.");
    error.code = "vibe64_project_bootstrap_source_outside_session";
    throw error;
  }
  if (!await pathExists(sourcePath)) {
    const error = new Error("Pending bootstrap config cannot be materialized before the session source exists.");
    error.code = "vibe64_project_bootstrap_source_missing";
    throw error;
  }
  const projectType = {
    projectType: bootstrapConfig.projectType,
    sourceRoot: sourcePath,
    targetRoot: sourcePath
  };
  const configContext = {
    adapter,
    projectType,
    targetRoot: sourcePath
  };
  const sourceContractRoot = resolveSourceConfigRoot({
    sourceRoot: sourcePath
  });
  const projectTypeStore = createVibe64ProjectTypeStore({
    sourceContractRoot,
    targetRoot: sourcePath
  });
  const projectConfigStore = createVibe64ProjectConfigStore({
    projectLocalRoot,
    sourceContractRoot,
    targetRoot: sourcePath
  });
  await projectTypeStore.writeProjectType(bootstrapConfig.projectType);
  const projectConfig = await projectConfigStore.saveConfig({
    definition: {
      adapterFields: await adapter.getConfigFields(configContext),
      adapterLabel: adapter.label,
      defaultValues: await adapter.getDefaultConfig(configContext)
    },
    values: bootstrapConfig.values
  });
  if (typeof adapter.getRuntimeRequirements === "function") {
    await writeRuntimeLock({
      lock: buildRuntimeLock({
        adapterId: adapter.id,
        projectType: bootstrapConfig.projectType,
        runtimeRequirements: await adapter.getRuntimeRequirements({
          config: projectConfig,
          projectType,
          targetRoot: sourcePath
        })
      }),
      sourceContractRoot
    });
  }
  await consumeProjectBootstrapConfig({
    projectRecordPath,
    sessionId: session.sessionId
  });
  return bootstrapConfig;
}

async function createWorktreeTerminalSpec({
  context = {},
  prepareWorktreeScriptPath = "",
  session = {},
  targetRoot = ""
} = {}) {
  const repositoryProfile = repositoryCommandProfileForSession(session);
  const resolvedTargetRoot = path.resolve(targetRoot || session.targetRoot || process.cwd());
  const sourcePath = createSessionSourcePath(session, context) || explicitSessionSourcePath(session);
  const branch = normalizeText(session.metadata?.branch) || createWorktreeBranch(session);
  if (!repositoryProfile.workflowRepositoryProfile) {
    return {
      ok: false,
      message: "Cannot create a session clone before the session has repository profile metadata."
    };
  }
  const projectGithubRepository = repositoryProfile.githubPr
    ? await readProjectGithubRepository({
        projectRecordPath: context.projectRecordPath
      })
    : null;
  const remoteUrl = repositoryProfile.githubPr
    ? normalizeText(session.metadata?.source_remote_url) ||
      normalizeText(projectGithubRepository?.cloneUrl) ||
      await readOriginUrlIfPresent(resolvedTargetRoot)
    : "";
  const defaultBranch = normalizeText(session.metadata?.source_default_branch) ||
    normalizeText(projectGithubRepository?.defaultBranch);
  let cachePath = "";
  if (!repositoryProfile.localSource) {
    cachePath = normalizeText(session.metadata?.source_cache_path) || createGitCachePath(session, {
      ...context,
      targetRoot: resolvedTargetRoot
    });
  }
  if (!sourcePath || !branch) {
    return {
      ok: false,
      message: "Cannot create a session clone before the project has a managed session source root."
    };
  }
  await mkdir(path.dirname(path.resolve(sourcePath)), {
    recursive: true
  });
  const [baseBranch, baseCommit] = await Promise.all([
    readCurrentBranchIfPresent(resolvedTargetRoot),
    readCurrentCommitIfPresent(resolvedTargetRoot)
  ]);
  const metadataBaseBranch = sessionUsesSourcePullRequest(session)
    ? normalizeText(session.metadata?.source_pr_head_ref) || baseBranch
    : baseBranch;
  const metadataBaseCommit = sessionUsesSourcePullRequest(session)
    ? normalizeText(session.metadata?.source_pr_head_sha) || baseCommit
    : baseCommit;
  return {
    args: ["-lc", createWorktreeScript({
      branch,
      cachePath,
      defaultBranch,
      prepareWorktreeScriptPath,
      repositoryProfile,
      remoteUrl,
      session,
      targetRoot: resolvedTargetRoot,
      worktreePath: sourcePath
    })],
    command: "bash",
    commandPreview: `git clone ${repositoryProfile.canonicalGit ? cachePath : remoteUrl || resolvedTargetRoot} ${sourcePath}`,
    cwd: resolvedTargetRoot,
    mounts: [
      ...prepareWorktreeScriptMount(prepareWorktreeScriptPath),
      ...sessionSourceParentMount(sourcePath)
    ],
    ok: true,
    ...(repositoryProfile.githubAuthRequired ? { requiresHostGithubCredentials: true } : {}),
    applySuccessFacts: (successContext = {}) => createWorktreeSuccessMetadataWithBootstrap({
      context,
      session,
      ...successContext
    }),
    runtimeConfigPhases: false,
    successMessage: `Created session clone ${sourcePath} on branch ${branch}.`,
    successMetadata: sourceMetadata({
      baseBranch: metadataBaseBranch,
      baseCommit: metadataBaseCommit,
      branch,
      cachePath,
      defaultBranch,
      mainCheckoutRoot: resolvedTargetRoot,
      remoteUrl,
      sourcePath,
      sourcePathAuthority: sourcePathAuthority({
        context,
        session,
        sourcePath
      })
    })
  };
}

async function installDependenciesTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the session clone before installing dependencies."
    };
  }
  const worktreeStatus = await gitWorktreeStatus(worktreePath);
  if (!worktreeStatus.ok) {
    return {
      ok: false,
      message: worktreeStatus.message
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
    runtimeConfigPhases: [RUNTIME_CONFIG_PHASES.INSTALL],
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
  const worktreePath = sessionSourcePath(session);
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
    runtimeConfigPhases: [
      RUNTIME_CONFIG_PHASES.CLIENT_BUILD,
      RUNTIME_CONFIG_PHASES.SERVER
    ],
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
  const worktreePath = sessionSourcePath(session);
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
    runtimeConfigPhases: [RUNTIME_CONFIG_PHASES.GENERATE],
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
