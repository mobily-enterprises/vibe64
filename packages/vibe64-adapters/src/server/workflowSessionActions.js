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
const WORK_BODY_ARTIFACT = "work.md";
const WORK_TITLE_ARTIFACT = "work_title";
const WORK_WORD_ARTIFACT = "work_word";

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

function prCanUseStackedBase(pr = {}) {
  return normalizeText(pr.state).toUpperCase() === "OPEN" &&
    normalizeText(pr.headRefName) &&
    normalizeText(pr.headRefOid) &&
    pr.isCrossRepository === false;
}

async function useNewIssueSessionAction() {
  return adapterActionResult({
    message: "Starting fresh with a new GitHub issue.",
    metadata: {
      github_issue_mode: "create",
      issue_source: "new",
      work_anchor_type: "issue",
      work_source: "new_issue"
    }
  });
}

async function useDescriptionSessionAction() {
  return adapterActionResult({
    message: "Starting from a plain work description.",
    metadata: {
      github_issue_mode: "skip",
      issue_source: "none",
      work_anchor_type: "description",
      work_source: "description"
    }
  });
}

async function useNewPrSessionAction() {
  return adapterActionResult({
    message: "Vibe64 will create a new pull request after the work is committed.",
    metadata: {
      pr_source: "new"
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
      [ISSUE_WORD_ARTIFACT]: artifactText(word),
      [WORK_BODY_ARTIFACT]: artifactText(body),
      [WORK_TITLE_ARTIFACT]: artifactText(title),
      [WORK_WORD_ARTIFACT]: artifactText(word)
    },
    message: `Selected GitHub issue #${issue.number}: ${title}`,
    metadata: {
      github_issue_mode: "reuse",
      issue_number: String(issue.number || ""),
      issue_source: "existing",
      issue_title: title,
      issue_url: normalizeText(issue.url),
      work_title: title,
      work_word: word,
      work_anchor_number: String(issue.number || ""),
      work_anchor_title: title,
      work_anchor_type: "issue",
      work_anchor_url: normalizeText(issue.url),
      work_source: "existing_issue",
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
  if (!prCanUseStackedBase(pr)) {
    return adapterActionResult({
      message: `GitHub PR #${pr.number || prRef} cannot be used as a stacked PR base because its head branch is not in this repository.`,
      status: "blocked"
    });
  }
  const title = normalizeText(pr.title);
  return adapterActionResult({
    message: `Selected GitHub PR #${pr.number}: ${title}`,
    metadata: {
      pr_source: "existing",
      source_pr_base_ref: normalizeText(pr.baseRefName),
      source_pr_head_ref: normalizeText(pr.headRefName),
      source_pr_head_repo: repositoryNameWithOwner(pr.headRepository),
      source_pr_head_sha: normalizeText(pr.headRefOid),
      source_pr_is_cross_repo: pr.isCrossRepository === true ? "yes" : "no",
      source_pr_maintainer_can_modify: pr.maintainerCanModify === true ? "yes" : "no",
      source_pr_number: String(pr.number || ""),
      source_pr_state: normalizeText(pr.state),
      source_pr_title: title,
      source_pr_update_mode: "stacked",
      source_pr_url: normalizeText(pr.url)
    }
  });
}

const VIBE64_WORKFLOW_SESSION_ACTIONS = Object.freeze({
  skip_merge: skipMergeSessionAction,
  use_description: useDescriptionSessionAction,
  use_existing_issue: useExistingIssueSessionAction,
  use_existing_pr: useExistingPrSessionAction,
  use_new_issue: useNewIssueSessionAction,
  use_new_pr: useNewPrSessionAction
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
