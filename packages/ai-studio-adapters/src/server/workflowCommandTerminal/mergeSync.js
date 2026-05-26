import process from "node:process";

import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  normalizeText
} from "@local/ai-studio-core/server/core";
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
  const mergeFlag = {
    merge: "--merge",
    rebase: "--rebase",
    squash: "--squash"
  }[normalizeText(mergeMethod)] || "--merge";
  return [
    "set -e",
    beforeMergeScript,
    `printf '[studio] Merging pull request %s\\n' ${shellQuote(prUrl)}`,
    `gh pr merge ${shellQuote(prUrl)} ${mergeFlag}`
  ].filter(Boolean).join("\n");
}

function syncMainCheckoutScript(session = {}, targetRoot = "") {
  const baseBranch = normalizeText(session.metadata?.base_branch) || "main";
  return [
    "set -e",
    `printf '[studio] Syncing main checkout %s to %s\\n' ${shellQuote(targetRoot)} ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} fetch origin ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} checkout ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} pull --ff-only origin ${shellQuote(baseBranch)}`
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
      mergeMethod: values.github_pr_merge_method,
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
    script: syncMainCheckoutScript(session, syncRoot)
  });
}

export {
  mergePrTerminalSpec,
  syncMainCheckoutTerminalSpec
};
