import process from "node:process";

import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  configValues
} from "../configValues.js";
import {
  completedMetadataSpec,
  normalizeHookCommandResult,
  worktreeCommandSpec
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
  targetRoot = ""
} = {}) {
  const normalizedBaseBranch = normalizeText(baseBranch) || "main";
  return [
    "set -e",
    `printf '[studio] Syncing main checkout %s to %s\\n' ${shellQuote(targetRoot)} ${shellQuote(normalizedBaseBranch)}`,
    `git -C ${shellQuote(targetRoot)} fetch origin ${shellQuote(normalizedBaseBranch)}`,
    `git -C ${shellQuote(targetRoot)} checkout ${shellQuote(normalizedBaseBranch)}`,
    `git -C ${shellQuote(targetRoot)} pull --ff-only origin ${shellQuote(normalizedBaseBranch)}`
  ].join("\n");
}

async function mergePrTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
} = {}) {
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
        worktreePath: normalizeText(session.metadata?.worktree_path)
      }))
    : null;
  const beforeMergeScript = normalizeText(hookResult?.script);
  const values = configValues(config);
  return worktreeCommandSpec({
    commandPreview: "gh pr merge",
    label: "Merge PR",
    metadata: {
      pr_merged: "yes"
    },
    script: mergePrScript({
      beforeMergeScript,
      mergeMethod: values.github_pr_merge_method || "merge",
      session
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
    metadata: {
      main_checkout_synced: "yes"
    },
    script: syncMainCheckoutScript({
      baseBranch: session.metadata?.base_branch,
      targetRoot: syncRoot
    })
  });
}

async function projectSyncMainCheckoutTerminalSpec({
  baseBranch = "main",
  targetRoot = ""
} = {}) {
  const syncRoot = targetRoot || process.cwd();
  return completedMetadataSpec({
    commandPreview: "git fetch && git pull --ff-only",
    cwd: syncRoot,
    label: "Sync main checkout",
    metadata: {
      main_checkout_synced: "yes"
    },
    script: syncMainCheckoutScript({
      baseBranch,
      targetRoot: syncRoot
    })
  });
}

export {
  mergePrTerminalSpec,
  projectSyncMainCheckoutTerminalSpec,
  syncMainCheckoutScript,
  syncMainCheckoutTerminalSpec
};
