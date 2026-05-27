import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import {
  adapterActionResult
} from "./adapter.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

const execFileAsync = promisify(execFile);
const GITHUB_COMMAND_TIMEOUT_MS = 30_000;
const GITHUB_OUTPUT_BUFFER_BYTES = 1024 * 1024;
const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const ISSUE_WORD_ARTIFACT = "issue_word";

function commandOutput(error = {}) {
  return normalizeText(`${error.stdout || ""}\n${error.stderr || ""}`) ||
    normalizeText(error.message);
}

function normalizeGithubNumberOrUrl(value = "") {
  return normalizeText(value).replace(/^#/u, "");
}

function artifactText(value = "") {
  const text = normalizeText(value);
  return text ? `${text}\n` : "";
}

function issueWordFromGithubIssue(issue = {}, issueRef = "") {
  const candidate = normalizeText(issue.title)
    .split(/\s+/u)
    .map((word) => word.replace(/[^A-Za-z0-9_-]+/gu, ""))
    .find(Boolean);
  const fallback = `issue${normalizeText(issue.number) || normalizeText(issueRef) || "selected"}`;
  return normalizeText(candidate || fallback).slice(0, 24);
}

async function ghJson(targetRoot, args = []) {
  try {
    const result = await execFileAsync("gh", args, {
      cwd: targetRoot,
      maxBuffer: GITHUB_OUTPUT_BUFFER_BYTES,
      timeout: GITHUB_COMMAND_TIMEOUT_MS
    });
    return {
      ok: true,
      value: JSON.parse(String(result.stdout || "{}"))
    };
  } catch (error) {
    return {
      error: commandOutput(error),
      ok: false
    };
  }
}

function repositoryNameWithOwner(repository = {}) {
  return normalizeText(repository.nameWithOwner) ||
    normalizeText(repository.name_with_owner) ||
    normalizeText(repository.fullName) ||
    normalizeText(repository.url).replace(/^https:\/\/github\.com\//u, "");
}

function prCanUseDirectUpdate(pr = {}) {
  if (normalizeText(pr.state).toUpperCase() !== "OPEN") {
    return false;
  }
  if (!normalizeText(pr.headRefName) || !repositoryNameWithOwner(pr.headRepository)) {
    return false;
  }
  return pr.isCrossRepository !== true || pr.maintainerCanModify === true;
}

async function useNewBranchSessionAction() {
  return adapterActionResult({
    message: "Selected a new Vibe64 branch.",
    metadata: {
      work_source: "new_branch"
    }
  });
}

async function skipMergeSessionAction() {
  return adapterActionResult({
    message: "Selected not to merge this pull request from Vibe64.",
    metadata: {
      merge_skipped: "yes"
    }
  });
}

async function useExistingIssueSessionAction({
  input = {},
  targetRoot = ""
} = {}) {
  const issueRef = normalizeGithubNumberOrUrl(input.issueRef);
  if (!issueRef) {
    return adapterActionResult({
      message: "Issue URL or number is required.",
      status: "blocked"
    });
  }

  const result = await ghJson(targetRoot, [
    "issue",
    "view",
    issueRef,
    "--json",
    "number,title,url,state,body"
  ]);
  if (result.ok === false) {
    return adapterActionResult({
      message: `Could not resolve GitHub issue: ${result.error}`,
      status: "blocked"
    });
  }

  const issue = result.value || {};
  if (normalizeText(issue.state).toUpperCase() !== "OPEN") {
    return adapterActionResult({
      message: `GitHub issue #${issue.number || issueRef} is not open.`,
      status: "blocked"
    });
  }
  const title = normalizeText(issue.title);
  const body = normalizeText(issue.body) || title;
  const word = issueWordFromGithubIssue(issue, issueRef);
  return adapterActionResult({
    artifacts: {
      [ISSUE_BODY_ARTIFACT]: artifactText(body),
      [ISSUE_TITLE_ARTIFACT]: artifactText(title),
      [ISSUE_WORD_ARTIFACT]: artifactText(word)
    },
    message: `Selected GitHub issue #${issue.number}: ${title}`,
    metadata: {
      issue_number: String(issue.number || ""),
      issue_source: "existing",
      issue_title: title,
      issue_url: normalizeText(issue.url),
      [ISSUE_WORD_ARTIFACT]: word
    }
  });
}

async function useExistingPrSessionAction({
  input = {},
  targetRoot = ""
} = {}) {
  const prRef = normalizeGithubNumberOrUrl(input.prRef);
  if (!prRef) {
    return adapterActionResult({
      message: "PR URL or number is required.",
      status: "blocked"
    });
  }

  const result = await ghJson(targetRoot, [
    "pr",
    "view",
    prRef,
    "--json",
    [
      "baseRefName",
      "headRefName",
      "headRefOid",
      "headRepository",
      "headRepositoryOwner",
      "isCrossRepository",
      "maintainerCanModify",
      "number",
      "state",
      "title",
      "url"
    ].join(",")
  ]);
  if (result.ok === false) {
    return adapterActionResult({
      message: `Could not resolve GitHub pull request: ${result.error}`,
      status: "blocked"
    });
  }

  const pr = result.value || {};
  if (normalizeText(pr.state).toUpperCase() !== "OPEN") {
    return adapterActionResult({
      message: `GitHub PR #${pr.number || prRef} is not open.`,
      status: "blocked"
    });
  }
  const updateMode = prCanUseDirectUpdate(pr) ? "direct" : "replacement";
  return adapterActionResult({
    message: `Selected GitHub PR #${pr.number}: ${normalizeText(pr.title)}`,
    metadata: {
      source_pr_base_ref: normalizeText(pr.baseRefName),
      source_pr_head_ref: normalizeText(pr.headRefName),
      source_pr_head_repo: repositoryNameWithOwner(pr.headRepository),
      source_pr_head_sha: normalizeText(pr.headRefOid),
      source_pr_is_cross_repo: pr.isCrossRepository === true ? "yes" : "no",
      source_pr_maintainer_can_modify: pr.maintainerCanModify === true ? "yes" : "no",
      source_pr_number: String(pr.number || ""),
      source_pr_state: normalizeText(pr.state),
      source_pr_title: normalizeText(pr.title),
      source_pr_update_mode: updateMode,
      source_pr_url: normalizeText(pr.url),
      work_source: "existing_pr"
    }
  });
}

const VIBE64_WORKFLOW_SESSION_ACTIONS = Object.freeze({
  skip_merge: skipMergeSessionAction,
  use_existing_issue: useExistingIssueSessionAction,
  use_existing_pr: useExistingPrSessionAction,
  use_new_branch: useNewBranchSessionAction
});

async function runVibe64WorkflowSessionAction(actionId, context = {}) {
  const runAction = VIBE64_WORKFLOW_SESSION_ACTIONS[normalizeText(actionId)];
  if (!runAction) {
    return adapterActionResult({
      message: `Vibe64 workflow action is not implemented: ${normalizeText(actionId) || "(unknown)"}`,
      status: "blocked"
    });
  }
  return runAction({
    ...context,
    targetRoot: context.session?.targetRoot || context.targetRoot || process.cwd()
  });
}

export {
  runVibe64WorkflowSessionAction
};
