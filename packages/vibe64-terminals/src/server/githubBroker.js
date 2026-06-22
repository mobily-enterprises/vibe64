import path from "node:path";

import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  githubProviderUserKey,
  resolveGithubToolHomeForStoredActor
} from "@local/studio-terminal-core/server/providerHomes";
import {
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";
import {
  logOperationalEvent,
  sanitizeLogText
} from "@local/vibe64-core/server/logging";
import {
  vibe64AgentRunStateIsActive
} from "@local/vibe64-runtime/server";
import {
  pathInsideOrEqual,
  terminalTargetRoot
} from "./terminalShared.js";

const READ_ONLY_GITHUB_BROKER_OPERATIONS = Object.freeze([
  "git_status",
  "git_diff_summary",
  "current_branch",
  "remote_info",
  "current_branch_pr"
]);
const MUTATING_GITHUB_BROKER_OPERATIONS = Object.freeze([
  "commit_changes",
  "push_branch",
  "commit_and_push",
  "create_issue",
  "create_pr",
  "comment_pr",
  "merge_pr",
  "sync_branch"
]);
const GITHUB_BROKER_OPERATIONS = Object.freeze([
  ...READ_ONLY_GITHUB_BROKER_OPERATIONS,
  ...MUTATING_GITHUB_BROKER_OPERATIONS
]);
const RECENT_CODEX_CONTEXT_GRACE_MS = 10 * 60 * 1000;
const SECRET_OUTPUT_PATTERN = /\b(?:gho|ghp|github_pat|sk)-[A-Za-z0-9_:-]{12,}\b/gu;
const HEADER_SECRET_PATTERN = /(authorization:\s*(?:bearer|token)\s+)[^\s]+/giu;
const BROKER_RESULT_SUMMARY_MAX_LENGTH = 500;
const GITHUB_PR_JSON_FIELDS = "number,url,title,state,baseRefName,headRefName,isDraft,mergeable,mergedAt,isCrossRepository";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function redactedBrokerOutput(value = "") {
  return sanitizeLogText(normalizeText(value))
    .replace(HEADER_SECRET_PATTERN, "$1[redacted]")
    .replace(SECRET_OUTPUT_PATTERN, "[redacted]");
}

function brokerError(message, code, extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    ok: false
  };
}

function githubBrokerLogLevel(result = {}) {
  if (result?.ok === true) {
    return "info";
  }
  return result?.code === "vibe64_github_confirmation_required" ? "warn" : "error";
}

function logGithubBrokerResult(logger, result = {}, fields = {}) {
  return logOperationalEvent(logger, githubBrokerLogLevel(result), {
    actorEmail: fields.actorEmail || "",
    actorScope: fields.actorScope || "",
    actorUserKey: fields.actorUserKey || "",
    code: result?.code || "",
    commandCount: Number(result?.commandCount || 0),
    component: "vibe64.github_broker",
    durationMs: Number(fields.durationMs || 0),
    event: result?.code === "vibe64_github_confirmation_required"
      ? "vibe64.github_broker.confirmation_required"
      : "vibe64.github_broker.operation_finished",
    exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
    ok: result?.ok === true,
    operation: fields.operation || result?.operation || "",
    sessionId: fields.sessionId || "",
    targetRoot: fields.targetRoot || "",
    threadId: fields.threadId || "",
    turnId: fields.turnId || "",
    workdir: fields.workdir || ""
  }, "Vibe64 GitHub broker operation finished.");
}

function brokerResultMetadata(result = {}, fields = {}) {
  const code = normalizeText(result?.code);
  const summary = normalizeText(result?.summary || result?.error || result?.outputTail);
  return {
    codex_github_broker_last_at: new Date().toISOString(),
    codex_github_broker_last_code: code,
    codex_github_broker_last_needs_confirmation: code === "vibe64_github_confirmation_required" ? "yes" : "",
    codex_github_broker_last_ok: result?.ok === true ? "yes" : "no",
    codex_github_broker_last_operation: normalizeText(fields.operation || result?.operation),
    codex_github_broker_last_summary: redactedBrokerOutput(summary).slice(0, BROKER_RESULT_SUMMARY_MAX_LENGTH),
    codex_github_broker_last_turn_id: normalizeText(fields.turnId || "")
  };
}

function resultValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "";
  }
  if (typeof value === "boolean") {
    return value;
  }
  return normalizeText(value);
}

function cleanResultFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields)
    .map(([name, value]) => [name, resultValue(value)])
    .filter(([, value]) => value !== ""));
}

function outputText(value = {}) {
  return normalizeText(value?.stdout || value?.output || value?.stderr);
}

function commandOutput(commandResults = []) {
  return commandResults
    .map((entry) => outputText(entry))
    .filter(Boolean)
    .join("\n");
}

function parseJsonObject(value = "") {
  try {
    const parsed = JSON.parse(normalizeText(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function optionalBooleanField(parsed = {}, name = "") {
  return Object.hasOwn(parsed, name) ? parsed[name] === true : "";
}

function prNumberFromUrl(value = "") {
  const match = normalizeText(value).match(/\/pull\/([0-9]+)(?:\b|$)/u);
  if (!match) {
    return "";
  }
  const number = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(number) ? number : "";
}

function prUrlFromText(value = "") {
  const match = normalizeText(value).match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/[0-9]+/u);
  return match?.[0] || "";
}

function prSourceForSession(session = {}) {
  return normalizeText(session.metadata?.source_pr_url) ? "stacked" : "created";
}

function prResultFromJson(value = "", session = {}) {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    return null;
  }
  const prNumber = Number.parseInt(String(parsed.number || ""), 10);
  const result = cleanResultFields({
    base: parsed.baseRefName,
    head: parsed.headRefName,
    isCrossRepository: optionalBooleanField(parsed, "isCrossRepository"),
    isDraft: optionalBooleanField(parsed, "isDraft"),
    mergeable: parsed.mergeable,
    mergedAt: parsed.mergedAt,
    prNumber: Number.isSafeInteger(prNumber) ? prNumber : "",
    prSource: prSourceForSession(session),
    prTitle: parsed.title,
    prUrl: parsed.url,
    state: parsed.state
  });
  return normalizeText(result.prUrl) ? result : null;
}

function latestPrResultFromCommands(commandResults = [], session = {}) {
  for (let index = commandResults.length - 1; index >= 0; index -= 1) {
    const prResult = prResultFromJson(outputText(commandResults[index]), session);
    if (prResult) {
      return prResult;
    }
  }
  return null;
}

function prResultIsMerged(prResult = {}) {
  const data = prResult && typeof prResult === "object" ? prResult : {};
  return normalizeText(data.state).toUpperCase() === "MERGED" || Boolean(normalizeText(data.mergedAt));
}

function mergeBranchDeleteResult(commandResults = []) {
  return commandResults.find((entry) => entry?.brokerCommandRole === "merge_branch_delete") || null;
}

function mergedPrBranchDeletePlan(input = {}, prResult = {}) {
  if (!inputBoolean(input, "deleteBranch")) {
    return {
      requested: false
    };
  }
  if (!prResult || !normalizeText(prResult.prUrl)) {
    return {
      requested: true,
      skipReason: "missing_pull_request"
    };
  }
  if (!prResultIsMerged(prResult)) {
    return {
      requested: true,
      skipReason: "pull_request_not_merged"
    };
  }
  if (prResult.isCrossRepository === true) {
    return {
      requested: true,
      skipReason: "cross_repository"
    };
  }
  const branch = safeGitName(prResult.head, {
    field: "head",
    required: true
  });
  if (branch.ok === false) {
    return {
      requested: true,
      skipReason: "unsafe_head_branch"
    };
  }
  if (branch.value === normalizeText(prResult.base)) {
    return {
      requested: true,
      skipReason: "head_matches_base"
    };
  }
  const remote = safeRemoteName(input.remote);
  if (remote.ok === false) {
    return {
      requested: true,
      skipReason: "unsafe_remote"
    };
  }
  return {
    branch: branch.value,
    command: ["git", ["push", remote.value, "--delete", branch.value]],
    remote: remote.value,
    requested: true
  };
}

function mergeBranchDeleteFields({
  commandResults = [],
  input = {},
  prResult = {}
} = {}) {
  if (!inputBoolean(input, "deleteBranch")) {
    return {};
  }
  const deleteResult = mergeBranchDeleteResult(commandResults);
  if (deleteResult) {
    return cleanResultFields({
      branchDeleteError: deleteResult.ok === true ? "" : redactedBrokerOutput(outputText(deleteResult)).slice(-1000),
      branchDeleted: deleteResult.ok === true,
      branchDeleteBranch: deleteResult.brokerBranchDeleteBranch,
      branchDeleteRemote: deleteResult.brokerBranchDeleteRemote
    });
  }
  const plan = mergedPrBranchDeletePlan(input, prResult);
  return cleanResultFields({
    branchDeleteSkipped: plan.skipReason || ""
  });
}

function structuredBrokerResult({
  commandResults = [],
  input = {},
  operation = "",
  session = {}
} = {}) {
  const output = commandOutput(commandResults);
  if (operation === "current_branch_pr") {
    return latestPrResultFromCommands(commandResults, session) || prResultFromJson(output, session);
  }
  if (operation === "create_pr") {
    const prUrl = prUrlFromText(output);
    if (!prUrl) {
      return null;
    }
    return cleanResultFields({
      base: input.base,
      head: input.head || session.metadata?.branch,
      prNumber: prNumberFromUrl(prUrl),
      prSource: prSourceForSession(session),
      prTitle: input.title,
      prUrl
    });
  }
  if (operation === "push_branch" || operation === "commit_and_push") {
    return cleanResultFields({
      branch: input.branch || session.metadata?.branch,
      pushed: true,
      remote: input.remote || "origin"
    });
  }
  if (operation === "merge_pr") {
    const prResult = latestPrResultFromCommands(commandResults, session);
    const prNumber = prResult?.prNumber || Number.parseInt(normalizeText(input.number), 10);
    return cleanResultFields({
      ...mergeBranchDeleteFields({
        commandResults,
        input,
        prResult
      }),
      deleteBranch: inputBoolean(input, "deleteBranch"),
      merged: prResultIsMerged(prResult),
      method: normalizeText(input.method).toLowerCase() || "merge",
      prNumber,
      prUrl: prResult?.prUrl,
      state: prResult?.state
    });
  }
  return null;
}

function workflowMetadataFromBrokerResult(result = {}, session = {}) {
  if (result?.ok !== true) {
    return {};
  }
  const operation = normalizeBrokerOperation(result.operation);
  const data = result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? result.result
    : {};
  if ((operation === "push_branch" || operation === "commit_and_push") && normalizeText(data.branch)) {
    return {
      branch_pushed: normalizeText(data.branch),
      branch_push_remote: normalizeText(data.remote) || "origin"
    };
  }
  if ((operation === "create_pr" || operation === "current_branch_pr") && normalizeText(data.prUrl)) {
    return cleanResultFields({
      pr_number: data.prNumber,
      pr_source: normalizeText(data.prSource) || prSourceForSession(session),
      pr_title: data.prTitle,
      pr_url: data.prUrl
    });
  }
  if (operation === "merge_pr") {
    return cleanResultFields({
      pr_merged: "yes",
      pr_number: data.prNumber
    });
  }
  return {};
}

async function writeBrokerWorkflowMetadata({
  logger = null,
  result = {},
  runtime = null,
  session = {},
  sessionId = ""
} = {}) {
  if (result?.ok !== true || typeof runtime?.store?.writeMetadataValue !== "function") {
    return;
  }
  const metadata = workflowMetadataFromBrokerResult(result, session);
  const entries = Object.entries(metadata)
    .filter(([, value]) => normalizeText(value) || value === true || value === false)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return;
  }
  try {
    await Promise.all(entries.map(([name, value]) => (
      runtime.store.writeMetadataValue(sessionId, name, String(value))
    )));
  } catch (error) {
    logOperationalEvent(logger, "error", {
      code: error?.code || "",
      component: "vibe64.github_broker",
      error: sanitizeLogText(error?.message || error || "GitHub broker workflow metadata could not be written."),
      event: "vibe64.github_broker.workflow_metadata_failed",
      operation: normalizeText(result.operation),
      sessionId
    }, "Vibe64 GitHub broker workflow metadata could not be written.");
  }
}

async function writeBrokerResultMetadata({
  fields = {},
  logger = null,
  projectService = null,
  result = {},
  runtime = null,
  sessionId = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId || fields.sessionId);
  if (!normalizedSessionId || (!runtime && typeof projectService?.createRuntime !== "function")) {
    return;
  }
  try {
    const activeRuntime = runtime || await projectService.createRuntime();
    if (typeof activeRuntime?.store?.writeMetadataValue !== "function") {
      return;
    }
    const metadata = brokerResultMetadata(result, fields);
    await Promise.all(Object.entries(metadata).map(([name, value]) => (
      activeRuntime.store.writeMetadataValue(normalizedSessionId, name, value)
    )));
  } catch (error) {
    logOperationalEvent(logger, "error", {
      code: error?.code || "",
      component: "vibe64.github_broker",
      error: sanitizeLogText(error?.message || error || "GitHub broker result metadata could not be written."),
      event: "vibe64.github_broker.result_metadata_failed",
      operation: normalizeText(fields.operation || result?.operation),
      sessionId: normalizedSessionId,
      turnId: normalizeText(fields.turnId || "")
    }, "Vibe64 GitHub broker result metadata could not be written.");
  }
}

function normalizeBrokerOperation(value = "") {
  const operation = normalizeText(value).toLowerCase().replace(/-/gu, "_");
  return GITHUB_BROKER_OPERATIONS.includes(operation) ? operation : "";
}

function githubBrokerOperationList() {
  return GITHUB_BROKER_OPERATIONS.map((operation) => ({
    mutating: MUTATING_GITHUB_BROKER_OPERATIONS.includes(operation),
    operation,
    readOnly: READ_ONLY_GITHUB_BROKER_OPERATIONS.includes(operation)
  }));
}

function githubBrokerOperationSchema(operation = "") {
  const normalizedOperation = normalizeBrokerOperation(operation);
  if (!normalizedOperation) {
    return null;
  }
  const fields = {
    operation: "string",
    sessionId: "string",
    turnId: "string"
  };
  if (normalizedOperation === "commit_changes" || normalizedOperation === "commit_and_push") {
    fields.message = "string";
  }
  if (normalizedOperation === "push_branch" || normalizedOperation === "commit_and_push") {
    fields.branch = "string optional";
    fields.remote = "string optional";
  }
  if (normalizedOperation === "create_issue") {
    fields.title = "string";
    fields.body = "string";
  }
  if (normalizedOperation === "create_pr") {
    fields.title = "string";
    fields.body = "string";
    fields.base = "string optional";
    fields.head = "string optional";
  }
  if (normalizedOperation === "comment_pr") {
    fields.body = "string";
    fields.number = "integer";
  }
  if (normalizedOperation === "merge_pr") {
    fields.deleteBranch = "boolean optional";
    fields.method = "string optional: merge, squash, or rebase";
    fields.number = "integer";
    fields.remote = "string optional";
  }
  if (normalizedOperation === "sync_branch") {
    fields.branch = "string optional";
    fields.remote = "string optional";
  }
  return {
    fields,
    mutating: MUTATING_GITHUB_BROKER_OPERATIONS.includes(normalizedOperation),
    operation: normalizedOperation
  };
}

function codexGithubActorFromSession(session = {}, {
  now = Date.now(),
  turnId = ""
} = {}) {
  const metadata = session.metadata || {};
  const actorTurnId = normalizeText(metadata.codex_github_actor_turn_id);
  const requestedTurnId = normalizeText(turnId);
  if (!actorTurnId) {
    return brokerError("This Codex session does not have a GitHub actor binding.", "vibe64_github_actor_missing");
  }
  if (!requestedTurnId) {
    return brokerError("GitHub broker turn id is required.", "vibe64_github_actor_turn_required");
  }
  if (requestedTurnId !== actorTurnId) {
    return brokerError("GitHub broker turn id does not match the recorded Codex actor.", "vibe64_github_actor_turn_mismatch");
  }
  const actorSessionId = normalizeText(metadata.codex_github_actor_session_id);
  const sessionId = normalizeText(session.sessionId);
  if (actorSessionId && sessionId && actorSessionId !== sessionId) {
    return brokerError("GitHub broker session id does not match the recorded Codex actor.", "vibe64_github_actor_session_mismatch");
  }
  const expiresAtMs = Date.parse(normalizeText(metadata.codex_github_actor_expires_at));
  if (Number.isFinite(expiresAtMs) && expiresAtMs > 0 && expiresAtMs < Number(now)) {
    return brokerError("This Codex GitHub actor binding has expired.", "vibe64_github_actor_expired");
  }
  return {
    actorScope: normalizeText(metadata.codex_github_actor_scope),
    actorUserKey: normalizeText(metadata.codex_github_actor_user_key),
    actorEmail: normalizeText(metadata.codex_github_actor_email),
    ok: true,
    sessionId: actorSessionId,
    targetRoot: normalizeText(metadata.codex_github_actor_target_root),
    threadId: normalizeText(metadata.codex_github_actor_thread_id),
    turnId: actorTurnId,
    workdir: normalizeText(metadata.codex_github_actor_workdir)
  };
}

function brokerWorkdir(session = {}, actor = {}, projectService = {}) {
  const targetRoot = terminalTargetRoot({
    targetRoot: actor.targetRoot || session.targetRoot
  }, projectService);
  const workdir = normalizeText(actor.workdir) ? path.resolve(actor.workdir) : targetRoot;
  if (!targetRoot || !workdir || !pathInsideOrEqual(targetRoot, workdir)) {
    return brokerError("GitHub broker workdir is outside the session target root.", "vibe64_github_broker_workdir_invalid");
  }
  return {
    ok: true,
    targetRoot,
    workdir
  };
}

function brokerGitCommand(operation = "") {
  if (operation === "git_status") {
    return ["git", ["status", "--short", "--branch"]];
  }
  if (operation === "git_diff_summary") {
    return ["git", ["diff", "--stat"]];
  }
  if (operation === "current_branch") {
    return ["git", ["branch", "--show-current"]];
  }
  if (operation === "remote_info") {
    return ["git", ["remote", "-v"]];
  }
  if (operation === "current_branch_pr") {
    return ["gh", ["pr", "view", "--json", GITHUB_PR_JSON_FIELDS]];
  }
  return null;
}

function brokerPlanError(message, code, extra = {}) {
  return brokerError(message, code, extra);
}

function inputText(input = {}, name = "", {
  maxLength = 10_000,
  required = false
} = {}) {
  const value = normalizeText(input?.[name]);
  if (required && !value) {
    return brokerPlanError(`GitHub broker field ${name} is required.`, "vibe64_github_broker_field_required", {
      field: name
    });
  }
  if (value.length > maxLength) {
    return brokerPlanError(`GitHub broker field ${name} is too long.`, "vibe64_github_broker_field_too_long", {
      field: name
    });
  }
  return {
    ok: true,
    value
  };
}

function inputPositiveInteger(input = {}, name = "") {
  const value = Number.parseInt(normalizeText(input?.[name]), 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    return brokerPlanError(`GitHub broker field ${name} must be a positive integer.`, "vibe64_github_broker_field_invalid", {
      field: name
    });
  }
  return {
    ok: true,
    value
  };
}

function inputBoolean(input = {}, name = "") {
  const raw = input?.[name];
  if (raw === true || raw === "true" || raw === "1" || raw === 1) {
    return true;
  }
  return false;
}

function safeGitName(value = "", {
  defaultValue = "",
  field = "branch",
  required = false
} = {}) {
  const normalized = normalizeText(value) || normalizeText(defaultValue);
  if (!normalized && !required) {
    return {
      ok: true,
      value: ""
    };
  }
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("@{") ||
    normalized.includes("//") ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.endsWith(".lock") ||
    !/^[A-Za-z0-9._/-]+$/u.test(normalized)
  ) {
    return brokerPlanError(`GitHub broker field ${field} is not a safe git name.`, "vibe64_github_broker_field_invalid", {
      field
    });
  }
  return {
    ok: true,
    value: normalized
  };
}

function safeRemoteName(value = "origin") {
  const normalized = normalizeText(value) || "origin";
  if (!/^[A-Za-z0-9._-]+$/u.test(normalized)) {
    return brokerPlanError("GitHub broker field remote is not a safe remote name.", "vibe64_github_broker_field_invalid", {
      field: "remote"
    });
  }
  return {
    ok: true,
    value: normalized
  };
}

function pushCommands(input = {}) {
  const remote = safeRemoteName(input.remote);
  if (remote.ok === false) {
    return remote;
  }
  const branch = safeGitName(input.branch, {
    field: "branch"
  });
  if (branch.ok === false) {
    return branch;
  }
  return {
    commands: [
      ["git", [
        "push",
        "-u",
        remote.value,
        branch.value ? `HEAD:${branch.value}` : "HEAD"
      ]]
    ],
    ok: true
  };
}

function commitCommands(input = {}) {
  const message = inputText(input, "message", {
    maxLength: 2000,
    required: true
  });
  if (message.ok === false) {
    return message;
  }
  return {
    commands: [
      ["git", ["add", "-A"]],
      ["git", ["commit", "-m", message.value]]
    ],
    ok: true
  };
}

function issueCommands(input = {}) {
  const title = inputText(input, "title", {
    maxLength: 300,
    required: true
  });
  if (title.ok === false) {
    return title;
  }
  const body = inputText(input, "body", {
    required: true
  });
  if (body.ok === false) {
    return body;
  }
  return {
    commands: [
      ["gh", ["issue", "create", "--title", title.value, "--body", body.value]]
    ],
    ok: true
  };
}

function prCommands(input = {}) {
  const title = inputText(input, "title", {
    maxLength: 300,
    required: true
  });
  if (title.ok === false) {
    return title;
  }
  const body = inputText(input, "body", {
    required: true
  });
  if (body.ok === false) {
    return body;
  }
  const base = safeGitName(input.base, {
    field: "base"
  });
  if (base.ok === false) {
    return base;
  }
  const head = safeGitName(input.head, {
    field: "head"
  });
  if (head.ok === false) {
    return head;
  }
  return {
    commands: [
      ["gh", [
        "pr",
        "create",
        ...(base.value ? ["--base", base.value] : []),
        ...(head.value ? ["--head", head.value] : []),
        "--title",
        title.value,
        "--body",
        body.value
      ]]
    ],
    ok: true
  };
}

function commentPrCommands(input = {}) {
  const number = inputPositiveInteger(input, "number");
  if (number.ok === false) {
    return number;
  }
  const body = inputText(input, "body", {
    required: true
  });
  if (body.ok === false) {
    return body;
  }
  return {
    commands: [
      ["gh", ["pr", "comment", String(number.value), "--body", body.value]]
    ],
    ok: true
  };
}

function mergeMethodFlag(value = "") {
  const method = normalizeText(value).toLowerCase() || "merge";
  if (method === "merge" || method === "squash" || method === "rebase") {
    return {
      ok: true,
      value: `--${method}`
    };
  }
  return brokerPlanError("GitHub broker field method must be merge, squash, or rebase.", "vibe64_github_broker_field_invalid", {
    field: "method"
  });
}

function mergePrCommands(input = {}) {
  const number = inputPositiveInteger(input, "number");
  if (number.ok === false) {
    return number;
  }
  const method = mergeMethodFlag(input.method);
  if (method.ok === false) {
    return method;
  }
  return {
    commands: [
      ["gh", [
        "pr",
        "merge",
        String(number.value),
        method.value
      ]],
      ["gh", [
        "pr",
        "view",
        String(number.value),
        "--json",
        GITHUB_PR_JSON_FIELDS
      ]]
    ],
    ok: true
  };
}

function syncBranchCommands(input = {}) {
  const remote = safeRemoteName(input.remote);
  if (remote.ok === false) {
    return remote;
  }
  const branch = safeGitName(input.branch, {
    defaultValue: "main",
    field: "branch",
    required: true
  });
  if (branch.ok === false) {
    return branch;
  }
  return {
    commands: [
      ["git", ["fetch", remote.value, branch.value]],
      ["git", ["merge", "--ff-only", "FETCH_HEAD"]]
    ],
    ok: true
  };
}

function brokerCommandPlan(operation = "", input = {}) {
  const readOnlyCommand = brokerGitCommand(operation);
  if (readOnlyCommand) {
    return {
      commands: [readOnlyCommand],
      ok: true
    };
  }
  if (operation === "commit_changes") {
    return commitCommands(input);
  }
  if (operation === "push_branch") {
    return pushCommands(input);
  }
  if (operation === "commit_and_push") {
    const commit = commitCommands(input);
    if (commit.ok === false) {
      return commit;
    }
    const push = pushCommands(input);
    if (push.ok === false) {
      return push;
    }
    return {
      commands: [
        ...commit.commands,
        ...push.commands
      ],
      ok: true
    };
  }
  if (operation === "create_issue") {
    return issueCommands(input);
  }
  if (operation === "create_pr") {
    return prCommands(input);
  }
  if (operation === "comment_pr") {
    return commentPrCommands(input);
  }
  if (operation === "merge_pr") {
    return mergePrCommands(input);
  }
  if (operation === "sync_branch") {
    return syncBranchCommands(input);
  }
  return brokerPlanError("This GitHub broker operation is not available.", "vibe64_github_broker_operation_unavailable", {
    operation
  });
}

function brokerEnv(toolHomeSource = "") {
  return toolHomeSource
    ? {
        HOME: toolHomeSource,
        XDG_CONFIG_HOME: path.join(toolHomeSource, ".config")
      }
    : {};
}

function mutatingAuthorization(session = {}, operation = "", actor = {}) {
  const authorizedOperation = normalizeText(session.metadata?.codex_github_actor_mutating_authorized_operation);
  const authorizedTurnId = normalizeText(session.metadata?.codex_github_actor_mutating_authorized_turn_id);
  if (!authorizedTurnId || authorizedTurnId !== normalizeText(actor.turnId)) {
    return false;
  }
  return authorizedOperation === operation || authorizedOperation === "*";
}

function requestActorMatchesRecordedActor(requestUser = null, actor = {}) {
  if (!requestUser || actor.actorScope !== "user") {
    return true;
  }
  return githubProviderUserKey(requestUser) === actor.actorUserKey;
}

function timestampMs(value = "") {
  const ms = Date.parse(normalizeText(value));
  return Number.isFinite(ms) ? ms : 0;
}

function codexContextReferenceMs(run = {}) {
  return timestampMs(run.finishedAt) ||
    timestampMs(run.completedAt) ||
    timestampMs(run.updatedAt) ||
    timestampMs(run.startedAt);
}

function codexRunMatchesActor(run = {}, actor = {}) {
  return normalizeText(run.providerThreadId) === actor.threadId &&
    normalizeText(run.providerTurnId) === actor.turnId;
}

function validateCodexTurnContext(session = {}, actor = {}, {
  now = Date.now(),
  recentContextGraceMs = RECENT_CODEX_CONTEXT_GRACE_MS
} = {}) {
  const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
  if (runs.length === 0) {
    return {
      ok: true,
      skipped: true
    };
  }
  const run = runs.find((entry) => codexRunMatchesActor(entry, actor));
  if (!run) {
    return brokerError("GitHub broker turn does not match a Codex agent run.", "vibe64_github_actor_context_missing");
  }
  if (run.active === true || vibe64AgentRunStateIsActive(run.state)) {
    return {
      ok: true
    };
  }
  const referenceMs = codexContextReferenceMs(run);
  if (referenceMs > 0 && Number(now) - referenceMs <= recentContextGraceMs) {
    return {
      ok: true
    };
  }
  return brokerError("GitHub broker turn is no longer active or recent.", "vibe64_github_actor_context_stale");
}

function normalizeGithubRepositoryFullName(value = "") {
  const normalized = normalizeText(value).replace(/^\/+|\/+$/gu, "");
  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return "";
  }
  return `${parts[0]}/${parts[1].replace(/\.git$/iu, "")}`.toLowerCase();
}

function githubRepositoryFromRemoteUrl(remoteUrl = "") {
  const rawValue = normalizeText(remoteUrl);
  if (!rawValue) {
    return "";
  }
  const sshMatch = rawValue.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/iu);
  if (sshMatch) {
    return normalizeGithubRepositoryFullName(`${sshMatch[1]}/${sshMatch[2]}`);
  }
  try {
    const url = new URL(rawValue);
    if (url.hostname.toLowerCase() !== "github.com") {
      return "";
    }
    const [owner, repository] = url.pathname
      .replace(/^\/+|\/+$/gu, "")
      .replace(/\.git$/iu, "")
      .split("/");
    return normalizeGithubRepositoryFullName(`${owner || ""}/${repository || ""}`);
  } catch {
    return "";
  }
}

async function expectedGithubRepositoryFullName(session = {}, projectService = {}) {
  const metadata = session.metadata || {};
  const metadataFullName = normalizeGithubRepositoryFullName(
    metadata.codex_github_actor_repository_full_name ||
    metadata.github_repository_full_name ||
    metadata.githubRepositoryFullName ||
    session.githubRepository?.fullName
  );
  if (metadataFullName) {
    return metadataFullName;
  }
  if (typeof projectService.listProjects !== "function") {
    return "";
  }
  try {
    const listed = await projectService.listProjects();
    return normalizeGithubRepositoryFullName(listed?.currentProject?.githubRepository?.fullName);
  } catch {
    return "";
  }
}

function brokerOperationRemoteName(operation = "", input = {}) {
  if (operation === "push_branch" || operation === "commit_and_push" || operation === "sync_branch" || operation === "merge_pr") {
    return safeRemoteName(input.remote);
  }
  return {
    ok: true,
    value: "origin"
  };
}

async function validateBrokerRepository({
  cwd = "",
  expectedFullName = "",
  input = {},
  operation = "",
  runCommand = runHostCommand,
  toolHomeSource = ""
} = {}) {
  const expected = normalizeGithubRepositoryFullName(expectedFullName);
  if (!expected) {
    return {
      ok: true,
      skipped: true
    };
  }
  const remote = brokerOperationRemoteName(operation, input);
  if (remote.ok === false) {
    return remote;
  }
  const result = await runCommand("git", ["remote", "get-url", remote.value], {
    cwd,
    env: brokerEnv(toolHomeSource),
    timeout: 15_000
  });
  if (result?.ok !== true) {
    return brokerError("GitHub broker could not validate the repository remote.", "vibe64_github_broker_repo_invalid", {
      remote: remote.value
    });
  }
  const observed = githubRepositoryFromRemoteUrl(result.stdout || result.output);
  if (!observed || observed !== expected) {
    return brokerError("GitHub broker repository remote does not match the Vibe64 project.", "vibe64_github_broker_repo_mismatch", {
      expectedRepository: expected,
      observedRepository: observed,
      remote: remote.value
    });
  }
  return {
    ok: true,
    remote: remote.value
  };
}

function sessionBranchPolicy(session = {}) {
  const metadata = session.metadata || {};
  return {
    baseBranch: normalizeText(metadata.base_branch || metadata.baseBranch),
    sessionBranch: normalizeText(metadata.branch || metadata.session_branch || metadata.worktree_recovery_branch)
  };
}

function branchPolicyViolation(field = "", expected = "", observed = "") {
  return brokerError("GitHub broker branch is outside this session policy.", "vibe64_github_broker_branch_policy_violation", {
    expectedBranch: expected,
    field,
    observedBranch: observed
  });
}

function validateBrokerBranchPolicy(operation = "", input = {}, session = {}) {
  const policy = sessionBranchPolicy(session);
  const branch = normalizeText(input.branch);
  const head = normalizeText(input.head);
  const base = normalizeText(input.base);
  if ((operation === "push_branch" || operation === "commit_and_push") && branch && policy.sessionBranch && branch !== policy.sessionBranch) {
    return branchPolicyViolation("branch", policy.sessionBranch, branch);
  }
  if (operation === "create_pr") {
    if (head && policy.sessionBranch && head !== policy.sessionBranch) {
      return branchPolicyViolation("head", policy.sessionBranch, head);
    }
    if (base && policy.baseBranch && base !== policy.baseBranch) {
      return branchPolicyViolation("base", policy.baseBranch, base);
    }
  }
  if (operation === "sync_branch" && branch && policy.baseBranch && branch !== policy.baseBranch) {
    return branchPolicyViolation("branch", policy.baseBranch, branch);
  }
  return {
    ok: true
  };
}

async function validateBrokerActorAccess({
  actor = {},
  authorizeActorAccess = null,
  cwd = {},
  input = {},
  projectService = {},
  session = {}
} = {}) {
  const authorize = typeof authorizeActorAccess === "function"
    ? authorizeActorAccess
    : typeof projectService?.authorizeGithubBrokerActorAccess === "function"
      ? projectService.authorizeGithubBrokerActorAccess.bind(projectService)
      : null;
  if (!authorize) {
    return {
      ok: true,
      skipped: true
    };
  }
  const result = await authorize({
    actor,
    session,
    targetRoot: cwd.targetRoot || "",
    vibe64User: input.vibe64User || null,
    workdir: cwd.workdir || ""
  });
  if (result === false || result?.ok === false) {
    return brokerError(
      result?.error || "This GitHub broker actor no longer has access to this project session.",
      result?.code || "vibe64_github_actor_access_denied",
      {
        statusCode: result?.statusCode || 403
      }
    );
  }
  return {
    ok: true
  };
}

function createGithubBroker({
  authorizeActorAccess = null,
  env = process.env,
  logger = null,
  projectService,
  runCommand = runHostCommand
} = {}) {
  async function currentTurnId(sessionId = "") {
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(normalizeText(sessionId));
    return normalizeText(session?.metadata?.codex_github_actor_turn_id);
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const operation = normalizeBrokerOperation(input.operation);
    const sessionId = normalizeText(input.sessionId);
    let canWriteBrokerResultMetadata = false;
    let sessionSnapshot = null;
    let sessionRuntime = null;
    const auditFields = {
      operation: operation || normalizeText(input.operation),
      sessionId
    };
    const finish = async (result = {}, fields = {}) => {
      const finalFields = {
        ...auditFields,
        ...fields,
        durationMs: Date.now() - startedAtMs
      };
      logGithubBrokerResult(logger, result, {
        ...finalFields
      });
      if (canWriteBrokerResultMetadata) {
        await writeBrokerResultMetadata({
          fields: finalFields,
          logger,
          projectService,
          result,
          runtime: sessionRuntime,
          sessionId
        });
        await writeBrokerWorkflowMetadata({
          logger,
          result,
          runtime: sessionRuntime,
          session: sessionSnapshot,
          sessionId
        });
      }
      return result;
    };
    if (!operation) {
      return await finish(brokerError("Unknown Vibe64 GitHub broker operation.", "vibe64_github_broker_unknown_operation"));
    }
    if (!sessionId) {
      return await finish(brokerError("GitHub broker session id is required.", "vibe64_github_broker_session_required"));
    }
    sessionRuntime = await projectService.createRuntime();
    const session = await sessionRuntime.getSession(sessionId);
    sessionSnapshot = session;
    const actor = codexGithubActorFromSession(session, {
      turnId: input.turnId
    });
    if (actor.ok === false) {
      return await finish(actor);
    }
    const actorFields = {
      actorEmail: actor.actorEmail,
      actorScope: actor.actorScope,
      actorUserKey: actor.actorUserKey,
      threadId: actor.threadId,
      turnId: actor.turnId
    };
    if (!requestActorMatchesRecordedActor(input.vibe64User || null, actor)) {
      return await finish(brokerError("This GitHub broker turn belongs to a different Vibe64 user.", "vibe64_github_actor_user_mismatch"), actorFields);
    }
    const codexContext = validateCodexTurnContext(session, actor);
    if (codexContext.ok === false) {
      return await finish(codexContext, actorFields);
    }
    const toolHome = resolveGithubToolHomeForStoredActor({
      accountMode: actor.actorScope,
      env,
      ownerEmail: actor.actorEmail,
      ownerUserKey: actor.actorUserKey,
      providerHomesRoot: normalizeText(env?.[VIBE64_PROVIDER_HOMES_ROOT_ENV])
    });
    if (toolHome.ok === false) {
      return await finish(toolHome, actorFields);
    }
    const cwd = brokerWorkdir(session, actor, projectService);
    if (cwd.ok === false) {
      return await finish(cwd, actorFields);
    }
    const targetFields = {
      ...actorFields,
      targetRoot: cwd.targetRoot,
      workdir: cwd.workdir
    };
    const actorAccess = await validateBrokerActorAccess({
      actor,
      authorizeActorAccess,
      cwd,
      input,
      projectService,
      session
    });
    if (actorAccess.ok === false) {
      return await finish(actorAccess, targetFields);
    }
    canWriteBrokerResultMetadata = true;
    if (MUTATING_GITHUB_BROKER_OPERATIONS.includes(operation) && !mutatingAuthorization(session, operation, actor)) {
      return await finish(brokerError("This GitHub operation requires explicit user confirmation.", "vibe64_github_confirmation_required", {
        confirmation: {
          operation,
          required: true
        },
        operation
      }), targetFields);
    }
    const plan = brokerCommandPlan(operation, input);
    if (plan.ok === false) {
      return await finish(plan, targetFields);
    }
    const branchPolicy = validateBrokerBranchPolicy(operation, input, session);
    if (branchPolicy.ok === false) {
      return await finish(branchPolicy, targetFields);
    }
    const repository = await validateBrokerRepository({
      cwd: cwd.workdir,
      expectedFullName: await expectedGithubRepositoryFullName(session, projectService),
      input,
      operation,
      runCommand,
      toolHomeSource: toolHome.toolHomeSource
    });
    if (repository.ok === false) {
      return await finish(repository, targetFields);
    }
    const commandResults = [];
    const commandOptions = {
      cwd: cwd.workdir,
      env: brokerEnv(toolHome.toolHomeSource),
      timeout: MUTATING_GITHUB_BROKER_OPERATIONS.includes(operation) ? 60_000 : 15_000
    };
    for (const command of plan.commands) {
      commandResults.push(await runCommand(command[0], command[1], commandOptions));
      if (commandResults.at(-1)?.ok !== true) {
        break;
      }
    }
    let result = commandResults.at(-1) || {
      exitCode: 0,
      ok: true,
      output: "",
      stdout: ""
    };
    if (operation === "merge_pr" && result.ok === true) {
      const verifiedPr = latestPrResultFromCommands(commandResults, session);
      if (prResultIsMerged(verifiedPr)) {
        const deletePlan = mergedPrBranchDeletePlan(input, verifiedPr);
        if (deletePlan.command) {
          const deleteResult = await runCommand(deletePlan.command[0], deletePlan.command[1], commandOptions);
          commandResults.push({
            ...deleteResult,
            brokerBranchDeleteBranch: deletePlan.branch,
            brokerBranchDeleteRemote: deletePlan.remote,
            brokerCommandRole: "merge_branch_delete"
          });
        }
      } else {
        result = {
          exitCode: Number.isInteger(result.exitCode) && result.exitCode !== 0 ? result.exitCode : 1,
          ok: false,
          output: `Pull request ${normalizeText(input.number)} is not merged after merge command.`,
          stdout: `Pull request ${normalizeText(input.number)} is not merged after merge command.`
        };
      }
    }
    const output = commandResults
      .map((entry) => outputText(entry))
      .filter(Boolean)
      .join("\n");
    const structuredResult = result.ok === true
      ? structuredBrokerResult({
          commandResults,
          input,
          operation,
          session
        })
      : null;
    return await finish({
      commandCount: commandResults.length,
      exitCode: result.exitCode,
      ok: result.ok === true,
      operation,
      outputTail: redactedBrokerOutput(output).slice(-4000),
      ...(structuredResult && Object.keys(structuredResult).length > 0 ? { result: structuredResult } : {}),
      summary: redactedBrokerOutput(result.stdout || result.output)
    }, targetFields);
  }

  return Object.freeze({
    currentTurnId,
    listOperations: githubBrokerOperationList,
    operationSchema: githubBrokerOperationSchema,
    run
  });
}

export {
  GITHUB_BROKER_OPERATIONS,
  MUTATING_GITHUB_BROKER_OPERATIONS,
  READ_ONLY_GITHUB_BROKER_OPERATIONS,
  codexGithubActorFromSession,
  createGithubBroker,
  githubBrokerOperationList,
  githubBrokerOperationSchema,
  normalizeBrokerOperation,
  redactedBrokerOutput
};
