import process from "node:process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  configValues
} from "../configValues.js";
import {
  repositoryCommandProfileForSession
} from "./repositoryCommandProfile.js";
import {
  gitCompletedMetadataSpec,
  gitWorktreeCommandSpec,
  normalizeHookCommandResult
} from "./shellHelpers.js";

function mergePrScript({
  beforeMergeScript = "",
  mergeMethod = "merge",
  session = {}
} = {}) {
  const prUrl = normalizeText(session.metadata?.pr_url);
  const mergePreparationSummary = normalizeText(session.metadata?.merge_preparation_summary);
  const mergeFlag = {
    merge: "--merge",
    rebase: "--rebase",
    squash: "--squash"
  }[normalizeText(mergeMethod)] || "--merge";
  return [
    "set -e",
    beforeMergeScript,
    `printf '[studio] Merging pull request %s\\n' ${shellQuote(prUrl)}`,
    `gh pr merge ${shellQuote(prUrl)} ${mergeFlag}`,
    mergePreparationCommentScript({
      prUrl,
      summary: mergePreparationSummary
    })
  ].filter(Boolean).join("\n");
}

function mergePreparationCommentScript({
  prUrl = "",
  summary = ""
} = {}) {
  const normalizedSummary = normalizeText(summary);
  if (!normalizedSummary) {
    return "";
  }
  const comment = [
    "## Vibe64 merge preparation",
    "",
    "Additional merge-preparation work was performed after this pull request was created and before it was merged.",
    "",
    normalizedSummary
  ].join("\n");
  return [
    `MERGE_PREPARATION_COMMENT_FILE="$(mktemp)"`,
    `printf '%s\\n' ${shellQuote(comment)} > "$MERGE_PREPARATION_COMMENT_FILE"`,
    `if ! gh pr comment ${shellQuote(prUrl)} --body-file "$MERGE_PREPARATION_COMMENT_FILE"; then`,
    `  printf '[studio] Merge-preparation comment failed; pull request was already merged.\\n' >&2`,
    "fi",
    `rm -f "$MERGE_PREPARATION_COMMENT_FILE"`
  ].join("\n");
}

function syncMainCheckoutScript({
  baseBranch = "main",
  cachePath = "",
  remoteUrl = "",
  targetRoot = ""
} = {}) {
  const normalizedBaseBranch = normalizeText(baseBranch) || "main";
  const normalizedCachePath = normalizeText(cachePath);
  const normalizedRemoteUrl = normalizeText(remoteUrl);
  return [
    "set -e",
    `TARGET_ROOT=${shellQuote(targetRoot)}`,
    `BASE_BRANCH=${shellQuote(normalizedBaseBranch)}`,
    `VIBE64_GIT_CACHE_PATH=${shellQuote(normalizedCachePath)}`,
    `VIBE64_GIT_REMOTE_URL=${shellQuote(normalizedRemoteUrl)}`,
    "if [ -z \"$VIBE64_GIT_REMOTE_URL\" ]; then",
    "  VIBE64_GIT_REMOTE_URL=\"$(git -C \"$TARGET_ROOT\" remote get-url origin 2>/dev/null || true)\"",
    "fi",
    "if [ -z \"$VIBE64_GIT_REMOTE_URL\" ]; then",
    "  printf '[studio] No GitHub remote is configured; no shared checkout sync is needed for local sessions.\\n'",
    "  exit 0",
    "fi",
    "if [ -z \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    "  printf '[studio] Cannot refresh Git cache because no project runtime root is configured.\\n' >&2",
    "  exit 1",
    "fi",
    "mkdir -p \"$(dirname \"$VIBE64_GIT_CACHE_PATH\")\"",
    "if [ ! -d \"$VIBE64_GIT_CACHE_PATH\" ]; then",
    "  printf '[studio] Creating Git cache for %s.\\n' \"$VIBE64_GIT_REMOTE_URL\"",
    "  git clone --bare \"$VIBE64_GIT_REMOTE_URL\" \"$VIBE64_GIT_CACHE_PATH\"",
    "else",
    "  printf '[studio] Refreshing Git cache for %s.\\n' \"$VIBE64_GIT_REMOTE_URL\"",
    "  git -C \"$VIBE64_GIT_CACHE_PATH\" remote set-url origin \"$VIBE64_GIT_REMOTE_URL\"",
    "  git -C \"$VIBE64_GIT_CACHE_PATH\" fetch --prune origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'",
    "fi",
    "printf '[studio] Git cache is current for %s.\\n' \"$BASE_BRANCH\""
  ].join("\n");
}

async function projectGithubRepository({
  projectRecordPath = ""
} = {}) {
  const metadataPath = normalizeText(projectRecordPath);
  if (!metadataPath) {
    return null;
  }
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    return metadata?.repository?.github || null;
  } catch {
    return null;
  }
}

function projectGitCachePath(context = {}, targetRoot = "") {
  const projectSourceRoot = normalizeText(context.projectRecordPath)
    ? normalizeText(targetRoot || context.targetRoot)
    : "";
  const normalizedRoot = projectSourceRoot ||
    normalizeText(context.projectRuntimeRoot) ||
    normalizeText(context.projectLocalRoot);
  return normalizedRoot
    ? path.join(normalizedRoot, "git-cache", "repository.git")
    : "";
}

function projectRuntimeRootFromContext(context = {}) {
  return normalizeText(context.projectRuntimeRoot) ||
    normalizeText(context.projectLocalRoot);
}

function projectRuntimeMounts(projectRuntimeRoot = "") {
  const normalizedRuntimeRoot = normalizeText(projectRuntimeRoot);
  return normalizedRuntimeRoot
    ? [
        {
          source: normalizedRuntimeRoot,
          target: normalizedRuntimeRoot
        }
      ]
    : [];
}

async function mergePrTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
} = {}) {
  if (!repositoryCommandProfileForSession(session).githubPr) {
    return {
      ok: false,
      message: "GitHub pull request merge is only available for GitHub projects."
    };
  }
  if (!normalizeText(session.metadata?.pr_url)) {
    return {
      ok: false,
      message: "Create the pull request before merging."
    };
  }
  const config = context.config || session.config || {};
  const hook = hooks?.beforeMerge;
  const hookResult = typeof hook === "function"
    ? normalizeHookCommandResult(await hook({
        context,
        session,
        targetRoot,
        worktreePath: sessionSourcePath(session)
      }))
    : null;
  const beforeMergeScript = normalizeText(hookResult?.script);
  const values = configValues(config);
  return gitWorktreeCommandSpec({
    commandPreview: "gh pr merge",
    label: "Merge PR",
    metadata: {
      pr_merged: "yes"
    },
    requiresHostGithubCredentials: true,
    runtimes: ["gh", ...(hookResult?.runtimes || [])],
    script: mergePrScript({
      beforeMergeScript,
      mergeMethod: values.github_pr_merge_method || "merge",
      session
    }),
    session
  });
}

async function syncMainCheckoutTerminalSpec({
  context = {},
  session = {},
  targetRoot = ""
} = {}) {
  if (!repositoryCommandProfileForSession(session).githubPr) {
    return {
      ok: false,
      message: "GitHub cache refresh is only available for GitHub projects."
    };
  }
  if (!normalizeText(session.metadata?.pr_merged)) {
    return {
      ok: false,
      message: "Merge the pull request before refreshing the Git cache."
    };
  }
  const syncRoot = targetRoot || session.targetRoot || process.cwd();
  const projectRuntimeRoot = projectRuntimeRootFromContext(context);
  const repository = await projectGithubRepository({
    projectRecordPath: context.projectRecordPath
  });
  const remoteUrl = normalizeText(session.metadata?.source_remote_url) ||
    normalizeText(repository?.cloneUrl) ||
    (normalizeText(repository?.fullName) ? `https://github.com/${normalizeText(repository.fullName)}.git` : "");
  const cachePath = normalizeText(session.metadata?.source_cache_path) ||
    projectGitCachePath(context, syncRoot);
  return {
    ...gitCompletedMetadataSpec({
      commandPreview: "git fetch --prune origin",
      cwd: syncRoot,
      label: "Refresh Git cache",
      metadata: {
        main_checkout_synced: "yes",
        source_cache_path: cachePath
      },
      requiresHostGithubCredentials: true,
      script: syncMainCheckoutScript({
        baseBranch: session.metadata?.base_branch,
        cachePath,
        remoteUrl,
        targetRoot: syncRoot
      })
    }),
    mounts: projectRuntimeMounts(projectRuntimeRoot)
  };
}

async function projectSyncMainCheckoutTerminalSpec({
  baseBranch = "main",
  context = {},
  targetRoot = ""
} = {}) {
  const syncRoot = targetRoot || process.cwd();
  const projectRuntimeRoot = projectRuntimeRootFromContext(context);
  const repository = await projectGithubRepository({
    projectRecordPath: context.projectRecordPath
  });
  const remoteUrl = normalizeText(repository?.cloneUrl) ||
    (normalizeText(repository?.fullName) ? `https://github.com/${normalizeText(repository.fullName)}.git` : "");
  const cachePath = projectGitCachePath(context, syncRoot);
  return {
    ...gitCompletedMetadataSpec({
      commandPreview: "git fetch --prune origin",
      cwd: syncRoot,
      label: "Refresh Git cache",
      metadata: {
        main_checkout_synced: "yes",
        source_cache_path: cachePath
      },
      requiresHostGithubCredentials: true,
      script: syncMainCheckoutScript({
        baseBranch,
        cachePath,
        remoteUrl,
        targetRoot: syncRoot
      })
    }),
    mounts: projectRuntimeMounts(projectRuntimeRoot)
  };
}

export {
  mergePrTerminalSpec,
  projectSyncMainCheckoutTerminalSpec,
  syncMainCheckoutScript,
  syncMainCheckoutTerminalSpec
};
