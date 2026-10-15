import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeRepositoryMode,
  sessionConnectedContribution,
  sessionConnectedSubmissions,
  sessionRepositoryDestination,
  sessionRepositoryProject
} from "@local/vibe64-core/server/projectRepository";
import {
  repositoryUpdateRelationship,
  repositoryUpdateStrategy
} from "@local/vibe64-core/shared";
import {
  checkpointRefs,
  createGitTurnCheckpoint,
  githubMirrorRefreshInvocation,
  runVibe64Command,
  writeGitWorktreeTree
} from "@local/vibe64-execution/server";
import {
  GIT_HISTORY_RECORD_FORMAT,
  parseGitHistoryRecords
} from "./gitHistoryRecords.js";

const SAVE_TIMEOUT_MS = 120_000;
const DEFAULT_CHANGE_FILE_LIMIT = 200;
const MAX_CHANGE_FILE_LIMIT = 500;
const DEFAULT_CHANGE_DIFF_LINE_LIMIT = 800;
const MAX_CHANGE_DIFF_LINE_LIMIT = 5000;
const INCOMING_VERSION_LIMIT = 5;
const SESSION_WORK_COMMAND_SCOPE = Symbol("vibe64-session-work-command-scope");
const SESSION_WORK_OPERATION_COMMAND_PATH = fileURLToPath(new URL(
  "./sessionWorkOperationCommand.js",
  import.meta.url
));

function text(value = "") {
  return String(value || "").trim();
}

function normalizedDerivedArtifactPaths(paths = []) {
  return [...new Set((Array.isArray(paths) ? paths : [])
    .map(text)
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function metadata(session = {}) {
  return session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
}

function saveError(message, code = "vibe64_session_save_failed", details = {}) {
  const error = new Error(message || "Vibe64 could not save this session.");
  error.code = code;
  error.details = details && typeof details === "object" && !Array.isArray(details)
    ? { ...details }
    : {};
  Object.assign(error, details);
  return error;
}

function repositoryContext(session = {}, project = {}) {
  project = sessionRepositoryProject(project, session);
  const sessionMetadata = metadata(session);
  const mode = normalizeRepositoryMode(project.repositoryMode || project.repository?.mode);
  const branch = text(project.repository?.defaultBranch);
  if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE && sessionMetadata.local_source_branch &&
      text(sessionMetadata.local_source_branch) !== branch) {
    throw saveError(
      `This session belongs to ${text(sessionMetadata.local_source_branch)}. Switch the project folder back to that branch before saving or updating it.`,
      "vibe64_session_local_branch_changed"
    );
  }
  const worktreePath = text(session.sourcePath || sessionMetadata.source_path);
  const sessionId = text(session.sessionId || session.id);
  const baseCommit = text(sessionMetadata.base_commit);
  const lastCanonicalCommit = text(sessionMetadata.canonical_commit) || baseCommit;
  const standaloneSourceRoot = mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    ? text(project.sourceRoot)
    : "";
  if (
    !mode ||
    !branch ||
    !worktreePath ||
    !sessionId ||
    !baseCommit ||
    (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE && !standaloneSourceRoot)
  ) {
    throw saveError(
      "Session Save requires a complete repository mode, branch, session source, base commit, and authority.",
      "vibe64_session_save_context_incomplete"
    );
  }
  const remoteUrl = mode === PROJECT_REPOSITORY_MODE_GITHUB
    ? text(project.githubRepository?.cloneUrl || project.repository?.github?.cloneUrl)
    : mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT
      ? text(project.canonicalRepositoryPath)
      : standaloneSourceRoot;
  if (!remoteUrl) {
    throw saveError(
      "Session Save cannot find the canonical repository authority.",
      "vibe64_session_save_authority_missing"
    );
  }
  return {
    baseCommit,
    branch,
    contribution: sessionConnectedContribution(session),
    connectedSubmissions: sessionConnectedSubmissions(session),
    lastCanonicalCommit,
    mode,
    githubMirrorPath: text(project.githubMirrorPath),
    repositoryFullName: text(project.githubRepository?.fullName || project.repository?.github?.fullName),
    githubMirrorOptional: Boolean(sessionMetadata.github_pull_request) || project.githubMirrorOptional === true,
    remoteUrl,
    sessionId,
    standaloneSourceRoot,
    worktreePath
  };
}

function commandProject(context = {}, project = {}) {
  return {
    ownerUserKey: text(project.ownerUserKey || project.githubRepository?.owner),
    projectRoot: context.worktreePath,
    repositoryMode: context.mode,
    sessionId: context.sessionId
  };
}

function scopedSessionWorkCommand(runCommand, context = {}, project = {}, {
  label = "Session repository work",
  operationId = crypto.randomUUID()
} = {}) {
  if (runCommand?.[SESSION_WORK_COMMAND_SCOPE]) {
    return runCommand;
  }
  const projectSlug = text(project.slug || project.projectSlug);
  let commandTail = Promise.resolve();
  const scoped = (request = {}) => {
    const command = commandTail.then(() => runCommand({
      ...request,
      execution: {
        ...(request.execution || {}),
        kind: "job",
        label,
        lifecycle: "finite",
        operationId: text(operationId),
        ownerId: context.sessionId,
        projectSlug,
        sessionId: context.sessionId
      },
      project: {
        ...(request.project || {}),
        ...(projectSlug ? { slug: projectSlug } : {})
      },
      session: {
        ...(request.session || {}),
        sessionId: context.sessionId
      }
    }));
    commandTail = command.then(() => undefined, () => undefined);
    return command;
  };
  Object.defineProperty(scoped, SESSION_WORK_COMMAND_SCOPE, { value: true });
  return scoped;
}

async function saveCommand(runCommand, context, command, args, {
  additionalAllowedRoots = [],
  commandOptions = {},
  cwd = context.worktreePath,
  env = {},
  input,
  project = {}
} = {}) {
  const allowedRoots = [
    context.worktreePath,
    path.dirname(context.worktreePath),
    ...(context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      ? [context.standaloneSourceRoot, path.dirname(context.standaloneSourceRoot)]
      : []),
    ...(path.isAbsolute(context.remoteUrl) ? [context.remoteUrl, path.dirname(context.remoteUrl)] : []),
    ...additionalAllowedRoots.flatMap((root) => {
      const normalized = text(root);
      return normalized ? [normalized, path.dirname(normalized)] : [];
    })
  ];
  return runCommand({
    actor: "daemon",
    allowedRoots,
    args,
    command,
    cwd,
    env,
    envPolicy: "session",
    gitSafeDirectories: allowedRoots,
    input,
    mode: "capture",
    project: commandProject(context, project),
    purpose: commandOptions.gitTransport?.startsWith("github") ? "github" : "source",
    runtimes: commandOptions.gitTransport === "github-https" ? ["git", "gh"] : ["git"],
    timeout: SAVE_TIMEOUT_MS,
    ...commandOptions
  });
}

function sessionWorkOperationProject(context, project = {}) {
  const projectSlug = text(project.slug || project.projectSlug);
  return {
    ...(context.mode === PROJECT_REPOSITORY_MODE_GITHUB
      ? {
          githubMirrorPath: context.githubMirrorPath,
          githubMirrorOptional: context.githubMirrorOptional,
          githubRepository: { cloneUrl: context.remoteUrl, fullName: context.repositoryFullName }
        }
      : {}),
    ...(context.mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT
      ? { canonicalRepositoryPath: context.remoteUrl }
      : {}),
    ...(context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      ? { sourceRoot: context.standaloneSourceRoot }
      : {}),
    ownerUserKey: text(project.ownerUserKey || project.githubRepository?.owner),
    projectSlug,
    repository: {
      defaultBranch: context.contribution?.integrationBranch || context.branch,
      mode: context.mode,
      ...(context.mode === PROJECT_REPOSITORY_MODE_GITHUB
        ? { github: { cloneUrl: context.remoteUrl, fullName: context.repositoryFullName } }
        : {})
    },
    repositoryMode: context.mode,
    slug: projectSlug
  };
}

function sessionWorkOperationSession(context) {
  return {
    metadata: {
      ...(context.contribution ? { connected_contribution: JSON.stringify(context.contribution) } : {}),
      ...(context.connectedSubmissions.length ? { connected_submissions: JSON.stringify({
        schemaVersion: 1, submissions: context.connectedSubmissions
      }) } : {}),
      base_branch: context.branch,
      base_commit: context.baseCommit,
      canonical_commit: context.lastCanonicalCommit,
      source_path: context.worktreePath,
      source_remote_url: context.remoteUrl
    },
    sessionId: context.sessionId,
    sourcePath: context.worktreePath
  };
}

async function runSessionWorkOperation({
  additionalAllowedRoots = [],
  commandOptions = {},
  context,
  input = {},
  label,
  operation,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand,
  timeout = SAVE_TIMEOUT_MS
}) {
  const scopedRunCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label,
    operationId
  });
  const result = await saveCommand(
    scopedRunCommand,
    context,
    "node",
    [SESSION_WORK_OPERATION_COMMAND_PATH],
    {
      additionalAllowedRoots: [path.dirname(SESSION_WORK_OPERATION_COMMAND_PATH), ...additionalAllowedRoots],
      commandOptions: {
        ...commandOptions,
        timeout,
        runtimes: [
          "node26",
          "git",
          ...(commandOptions.gitTransport === "github-https" ? ["gh"] : [])
        ]
      },
      input: JSON.stringify({
        input: {
          ...input,
          operationId,
          project: sessionWorkOperationProject(context, project),
          session: sessionWorkOperationSession(context)
        },
        operation
      }),
      project
    }
  );
  const serialized = String(result?.stdout || result?.output || "").trim();
  let response = null;
  try {
    response = JSON.parse(serialized);
  } catch {
    // The managed command result below carries the useful execution failure.
  }
  if (response?.ok === true) {
    return response.value;
  }
  if (response?.error) {
    throw saveError(
      response.error.message,
      response.error.code || "vibe64_session_work_operation_failed",
      response.error.details
    );
  }
  throw saveError(
    text(result?.stderr || result?.error || result?.output) || "Session repository inspection failed.",
    text(result?.code) || "vibe64_session_work_operation_failed"
  );
}

async function git(runCommand, context, args, {
  required = true,
  ...options
} = {}) {
  const result = await saveCommand(runCommand, context, "git", args, options);
  if (required && result?.ok !== true) {
    throw saveError(
      text(result?.stderr || result?.stdout || result?.output || result?.error) || "Git Save command failed.",
      text(result?.code) || "vibe64_session_save_git_failed",
      { gitArgs: args }
    );
  }
  return result;
}

function output(result = {}) {
  return text(result.stdout || result.output);
}

async function gitOutput(runCommand, context, args, options = {}) {
  return output(await git(runCommand, context, args, options));
}

async function changedPathsBetween(runCommand, context, baseCommit, tree, options = {}) {
  const result = await git(runCommand, context, [
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-z",
    baseCommit,
    tree
  ], options);
  return [...parseGitNameStatusZ(result.stdout || result.output).keys()]
    .sort((left, right) => left.localeCompare(right));
}

async function countCommitsBetween(runCommand, context, fromCommit, toCommit, options = {}) {
  const count = Number(await gitOutput(runCommand, context, [
    "rev-list",
    "--count",
    `${fromCommit}..${toCommit}`
  ], options));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

async function incomingVersionsBetween(
  runCommand,
  context,
  fromCommit,
  toCommit,
  options = {}
) {
  const result = await git(runCommand, context, [
    "log",
    "--topo-order",
    `--max-count=${INCOMING_VERSION_LIMIT + 1}`,
    "-z",
    `--format=${GIT_HISTORY_RECORD_FORMAT}`,
    `${fromCommit}..${toCommit}`
  ], options);
  const records = parseGitHistoryRecords(String(result.stdout || result.output || ""));
  return {
    incomingVersions: records.slice(0, INCOMING_VERSION_LIMIT),
    incomingVersionsTruncated: records.length > INCOMING_VERSION_LIMIT
  };
}

async function prepareSessionPullRequestBranch({ project, session, connectedWorkSnapshots: suppliedSnapshots = [],
  commandOptions = {}, runCommand = runVibe64Command }) {
  const context = repositoryContext(session, project);
  const ref = `refs/heads/${context.branch}`;
  const options = { commandOptions, project, connectedWorkSnapshots: connectedWorkSnapshots(suppliedSnapshots) };
  const existing = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, ref], options);
  if (!existing) {
    await assertConnectedSubmissionsIntegrated(runCommand, context, options);
    await assertConnectedWorkSnapshotsUnchanged(runCommand, options.connectedWorkSnapshots, options);
    // An empty lease creates only an absent ref, including for locally committed baselines.
    await git(runCommand, context, ["push", `--force-with-lease=${ref}:`, context.remoteUrl, `${context.baseCommit}:${ref}`], options);
  }
  await git(runCommand, context, ["remote", "set-url", "origin", context.remoteUrl], options);
}

function incomingRepositoryContext(project, session) {
  // Incoming belongs to the receiving project, independently of the selected
  // session's Save branch. Its source supplies Git storage, never its destination.
  const context = repositoryContext({ sessionId: session.sessionId,
    sourcePath: session.sourcePath || session.metadata?.source_path,
    metadata: { base_commit: session.metadata?.base_commit } }, project);
  if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB || context.branch.startsWith("vibe64-incoming/")) {
    throw saveError("Incoming changes require the receiving GitHub repository's authority.", "vibe64_incoming_repository_required");
  }
  return context;
}

async function inspectIncomingContributionsDirect({ project = {}, session = {}, offset = 0, limit = 25,
  id = "", state = "all", includeDiff = false, commandOptions = {}, operationId = crypto.randomUUID(), runCommand = runVibe64Command } = {}) {
  const context = incomingRepositoryContext(project, session);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, { label: "Reading incoming contributions", operationId });
  const options = { commandOptions, project };
  const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
  if ((id && !idPattern.test(id)) || !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (includeDiff && !id) ||
      !["all", "pending", "merged", "discarded", "unresolved"].includes(state)) {
    throw saveError("Choose an exact incoming contribution or a valid page.", "vibe64_incoming_input_invalid");
  }
  if (await gitOutput(runCommand, context, ["rev-parse", "--is-shallow-repository"], options) !== "false") {
    throw saveError("Incoming changes require complete Git history. Prepare a full receiving checkout before retrying.", "vibe64_incoming_history_incomplete");
  }
  const targetRef = `refs/heads/${context.branch}`;
  const output = await gitOutput(runCommand, context,
    ["ls-remote", "--heads", context.remoteUrl, targetRef, "refs/heads/vibe64-incoming/*"], options);
  const entries = new Map();
  let targetHead = "";
  for (const line of output.split("\n").filter(Boolean)) {
    const [head, ref] = line.split(/\s+/u);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head)) {
      throw saveError("The receiving repository returned invalid ref evidence.", "vibe64_incoming_refs_invalid");
    }
    if (ref === targetRef) { targetHead = head; continue; }
    const match = /^refs\/heads\/vibe64-incoming\/(.+?)(_discarded)?$/u.exec(ref);
    if (!match || !idPattern.test(match[1])) continue;
    const entry = entries.get(match[1]) || { id: match[1], activeHead: "", discardedHead: "" };
    entry[match[2] ? "discardedHead" : "activeHead"] = head;
    entries.set(entry.id, entry);
  }
  if (!targetHead) throw saveError("The receiving integration branch is unavailable.", "vibe64_incoming_target_missing");
  const all = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidates = id ? all.filter(entry => entry.id === id) : all;
  if (id && !candidates.length) throw saveError("This incoming contribution is no longer present. Refresh the list and inspect its history.", "vibe64_incoming_missing");
  const refs = [{ remote: targetRef, head: targetHead }];
  for (const entry of candidates) {
    if (entry.activeHead) refs.push({ remote: `refs/heads/vibe64-incoming/${entry.id}`, head: entry.activeHead });
    if (entry.discardedHead) refs.push({ remote: `refs/heads/vibe64-incoming/${entry.id}_discarded`, head: entry.discardedHead });
  }
  refs.forEach((ref, index) => { ref.local = saveRef(context, operationId, `incoming-${index}`); });
  try {
    await git(runCommand, context, ["fetch", "--no-tags", "--no-write-fetch-head", context.remoteUrl,
      ...refs.map(ref => `+${ref.remote}:${ref.local}`)], options);
    for (const ref of refs) {
      if (await gitOutput(runCommand, context, ["rev-parse", "--verify", `${ref.local}^{commit}`], options) !== ref.head) {
        throw saveError("Incoming branches changed while being read. Refresh before reviewing them.", "vibe64_incoming_review_changed");
      }
    }
    for (const entry of candidates) {
      const head = entry.activeHead || entry.discardedHead;
      const count = await gitOutput(runCommand, context, ["rev-list", "--count", `${targetHead}..${head}`], options);
      if (!/^\d+$/u.test(count)) throw saveError("Contribution ancestry could not be established.", "vibe64_incoming_history_incomplete");
      entry.status = entry.activeHead && entry.discardedHead ? "unresolved"
        : count === "0" ? "merged" : entry.activeHead ? "pending" : "discarded";
    }
    const filtered = candidates.filter(entry => id || state === "all" || entry.status === state);
    const page = id ? filtered : filtered.slice(offset, offset + limit);
    const contributions = [];
    for (const entry of page) {
      const head = entry.activeHead || entry.discardedHead;
      const title = await gitOutput(runCommand, context, ["log", "-1", "--format=%s", head], options);
      const changed = await git(runCommand, context, ["diff", "--name-only", "-z", `${targetHead}...${head}`], options);
      const files = String(changed.stdout || changed.output || "").split("\0").filter(Boolean);
      let diff;
      if (includeDiff) {
        const result = await git(runCommand, context, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3", `${targetHead}...${head}`], options);
        const content = String(result.stdout || result.output || "");
        diff = { content: content.slice(0, 100_000), truncated: content.length > 100_000 };
      }
      contributions.push({ ...entry, branch: `vibe64-incoming/${entry.id}`, head, title,
        review: { repository: context.repositoryFullName, targetBranch: context.branch, targetHead,
          id: entry.id, activeHead: entry.activeHead, discardedHead: entry.discardedHead },
        files: files.slice(0, 50), fileCount: files.length, filesTruncated: files.length > 50, ...(diff ? { diff } : {}) });
    }
    return { ok: true, repository: context.repositoryFullName, targetBranch: context.branch, targetHead,
      contributions, pendingCount: candidates.filter(entry => entry.status === "pending").length,
      unresolvedCount: candidates.filter(entry => entry.status === "unresolved").length,
      totalCount: filtered.length, offset: id ? 0 : offset,
      nextOffset: !id && offset + limit < filtered.length ? offset + limit : null };
  } finally {
    for (const ref of refs) await deleteOperationRef(runCommand, context, ref.local, options);
  }
}

async function inspectIncomingContributions({ project = {}, session = {}, offset = 0, limit = 25,
  id = "", state = "all", includeDiff = false, commandOptions = {}, runCommand = runVibe64Command } = {}) {
  const context = incomingRepositoryContext(project, session);
  return runSessionWorkOperation({ context, project, commandOptions, runCommand,
    input: { offset, limit, id, state, includeDiff }, label: "Reading incoming contributions", operation: "incoming" });
}

async function changeIncomingContributionDirect({ project = {}, session = {}, action = "", id = "", review = {}, repairReview = null,
  identity = {}, derivedArtifactPaths = [], refreshDerivedArtifacts, commandOptions = {},
  operationId = crypto.randomUUID(), runCommand = runVibe64Command } = {}) {
  if (!["merge", "discard", "review-repair"].includes(action) || !id) {
    throw saveError("Choose Merge or Discard for an exact contribution.", "vibe64_incoming_input_invalid");
  }
  const context = incomingRepositoryContext(project, session);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, { label: "Updating incoming contribution", operationId });
  const options = { commandOptions, project };
  const current = await inspectIncomingContributionsDirect({ project, session, id, commandOptions, operationId, runCommand });
  const entry = current.contributions[0];
  const expected = { repository: current.repository, targetBranch: current.targetBranch, targetHead: current.targetHead,
    id, activeHead: entry.activeHead, discardedHead: entry.discardedHead };
  if (Object.entries(expected).some(([key, value]) => review?.[key] !== value)) {
    throw saveError("This contribution or its target changed. Review the current heads before acting.", "vibe64_incoming_review_changed");
  }
  const activeRef = `refs/heads/${entry.branch}`;
  const discardedRef = `${activeRef}_discarded`;
  const targetRef = `refs/heads/${context.branch}`;
  if (action === "merge" || action === "review-repair") {
    if (entry.status === "merged") return { ok: true, status: "merged", head: entry.head, targetHead: current.targetHead };
    if (entry.status !== "pending") {
      throw saveError("Only a pending contribution can be merged. Resolve its discard state first.", "vibe64_incoming_not_pending");
    }
    let mergedCommit = entry.head;
    let repairedTree = "";
    const targetAhead = await gitOutput(runCommand, context, ["rev-list", "--count", `${entry.head}..${current.targetHead}`], options);
    if (!/^\d+$/u.test(targetAhead)) throw saveError("Integration ancestry is unavailable.", "vibe64_incoming_history_incomplete");
    if (targetAhead === "0" && (repairReview || action === "review-repair")) {
      throw saveError("These heads do not need conflict repair. Refresh and review the contribution normally.", "vibe64_incoming_review_changed");
    }
    if (targetAhead !== "0") {
      // Generated artifacts belong to their recreator, not conflict repair.
      // Normalize them to the reviewed target before merging authored source.
      const contributionTree = await gitOutput(runCommand, context, ["rev-parse", `${entry.head}^{tree}`], options);
      const sourceTree = await treeWithDerivedArtifactsFromCommit(runCommand, context, {
        commandOptions, derivedArtifactPaths, project, sourceCommit: current.targetHead, tree: contributionTree
      });
      const mergeInput = sourceTree === contributionTree ? entry.head : await createVirtualCommit(runCommand, context, {
        baseCommit: entry.head, commandOptions, identity, message: "Vibe64 incoming authored source", project, tree: sourceTree
      });
      const merged = await mergeTrees(runCommand, context, { canonicalCommit: current.targetHead,
        virtualCommit: mergeInput, commandOptions, project });
      if (merged.conflictPaths.length) {
        // Preserve the receiving source before offering Temporary AI. This is
        // the same private checkpoint owner as Update; files/index/HEAD stay put.
        const checkpoint = await captureSessionWorkUpdateCheckpointDirect({
          project, session, commandOptions, operationId: `incoming:${operationId}`, runCommand
        });
        if (action === "merge" && !repairReview) {
          throw saveError("This contribution conflicts with the integration branch. Use Fix it with AI or repair the listed files in this receiving session, then Review resolved conflicts before merging.",
            "vibe64_incoming_merge_conflict", { conflictPaths: merged.conflictPaths,
              checkpointCommit: checkpoint.checkpointCommit, review: expected });
        }
        repairedTree = await conflictWorktreeTree(runCommand, context, { conflictTree: merged.conflictTree,
          conflictPaths: merged.conflictPaths, project });
        repairedTree = await regenerateDerivedArtifactTree(runCommand, context, {
          baseCommit: current.targetHead, commandOptions, derivedArtifactPaths, identity, project,
          refreshDerivedArtifacts, tree: repairedTree
        });
        const currentRepair = { tree: repairedTree, worktreeTree: checkpoint.checkpointTree,
          head: checkpoint.oldHead, indexTree: checkpoint.oldIndexTree };
        if (action === "review-repair") {
          const result = await git(runCommand, context, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3",
            current.targetHead, repairedTree], options);
          const content = String(result.stdout || result.output || "");
          return { ok: true, status: "repair-review", review: expected, repairReview: currentRepair,
            conflictPaths: merged.conflictPaths, diff: { content: content.slice(0, 100_000), truncated: content.length > 100_000 } };
        }
        if (Object.keys(currentRepair).some(key => repairReview?.[key] !== currentRepair[key])) {
          throw saveError("The receiving source changed after repair review. Review resolved conflicts again before merging.",
            "vibe64_incoming_repair_changed");
        }
      } else if (repairReview || action === "review-repair") {
        throw saveError("These heads no longer need conflict repair. Refresh and review the contribution normally.", "vibe64_incoming_review_changed");
      }
      const mergedTree = repairedTree || await regenerateDerivedArtifactTree(runCommand, context, {
        baseCommit: current.targetHead, commandOptions, derivedArtifactPaths, identity, project,
        refreshDerivedArtifacts, tree: merged.mergedTree
      });
      mergedCommit = await gitOutput(runCommand, context, ["-c", `user.name=${text(identity.name) || "Vibe64 Merge"}`,
        "-c", `user.email=${text(identity.email) || "vibe64@localhost"}`, "commit-tree", mergedTree,
        "-p", current.targetHead, "-p", entry.head], { ...options, input: `Merge contribution ${id}\n` });
    }
    // Recheck the contribution as well as using an exact target lease. Its ref
    // is retained after integration; no squash, rebase or branch deletion occurs.
    const refreshed = await inspectIncomingContributionsDirect({ project, session, id, commandOptions, operationId, runCommand });
    const refreshedEntry = refreshed.contributions[0];
    if (refreshed.targetHead !== current.targetHead || refreshedEntry.activeHead !== entry.activeHead || refreshedEntry.discardedHead) {
      throw saveError("The contribution changed while its merge was prepared. Review it again.", "vibe64_incoming_review_changed");
    }
    if (repairedTree) {
      const head = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], options);
      const indexTree = await gitOutput(runCommand, context, ["write-tree"], options);
      const worktreeTree = await writeGitWorktreeTree({ worktreePath: context.worktreePath,
        project: commandProject(context, project), runCommand });
      if (head !== repairReview.head || indexTree !== repairReview.indexTree || worktreeTree !== repairReview.worktreeTree) {
        throw saveError("The receiving source changed while the merge was prepared. Review resolved conflicts again.", "vibe64_incoming_repair_changed");
      }
    }
    await git(runCommand, context, ["push", `--force-with-lease=${targetRef}:${current.targetHead}`,
      context.remoteUrl, `${mergedCommit}:${targetRef}`], options);
    const verified = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, targetRef], options);
    if (verified.split(/\s+/u)[0] !== mergedCommit) {
      throw saveError("The merge result is uncertain. Refresh Incoming changes before retrying.", "vibe64_incoming_verification_failed");
    }
    return { ok: true, status: "merged", head: entry.head, targetHead: mergedCommit };
  }
  if (!entry.activeHead || (entry.discardedHead && entry.discardedHead !== entry.activeHead)) {
    throw saveError("This discard cannot replace a different or missing contribution head. Inspect the current branches.", "vibe64_incoming_review_changed");
  }
  const createDiscarded = `${entry.head}:${discardedRef}`;
  const deleteActive = `:${activeRef}`;
  const activeLease = `--force-with-lease=${activeRef}:${entry.activeHead}`;
  const discardedLease = `--force-with-lease=${discardedRef}:${entry.discardedHead}`;
  const atomic = await git(runCommand, context, ["push", "--atomic", activeLease, discardedLease,
    context.remoteUrl, createDiscarded, deleteActive], { ...options, required: false });
  if (!atomic.ok) {
    const reason = text(atomic.stderr || atomic.output || atomic.error);
    if (!/does not support --atomic push/iu.test(reason)) {
      throw saveError(reason || "Discard was not confirmed. Refresh Incoming changes before retrying.", "vibe64_incoming_discard_unconfirmed");
    }
    // Without atomic support, preserve the destination before deleting the
    // exact reviewed source. Both refs remain recoverable after interruption.
    if (!entry.discardedHead) {
      await git(runCommand, context, ["push", discardedLease, context.remoteUrl, createDiscarded], options);
    }
    const copied = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, discardedRef], options);
    if (copied.split(/\s+/u)[0] !== entry.head) {
      throw saveError("The discarded branch was not verified; the active branch was retained.", "vibe64_incoming_verification_failed");
    }
    await git(runCommand, context, ["push", activeLease, context.remoteUrl, deleteActive], options);
  }
  const verified = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, activeRef, discardedRef], options);
  if (verified !== `${entry.head}\t${discardedRef}`) {
    throw saveError("Discard is not fully confirmed. Refresh Incoming changes to inspect both branches.", "vibe64_incoming_discard_unconfirmed");
  }
  return { ok: true, status: entry.status === "merged" ? "merged" : "discarded", head: entry.head };
}

async function changeIncomingContribution({ project = {}, session = {}, action = "", id = "", review = {}, repairReview = null, identity = {},
  derivedArtifactPaths = [], commandOptions = {}, runCommand = runVibe64Command, runProjectSourceExclusive = async operation => operation() } = {}) {
  const context = incomingRepositoryContext(project, session);
  return runProjectSourceExclusive(() => runSessionWorkOperation({ context, project, commandOptions, runCommand,
    input: { action, id, review, repairReview, identity, derivedArtifactPaths }, label: "Updating incoming contribution", operation: "incoming-change" }),
  { operation: `incoming-${action}:${id}` });
}

async function optionalGitOutput(runCommand, context, args, options = {}) {
  const result = await git(runCommand, context, args, {
    ...options,
    required: false
  });
  return result?.ok === true ? output(result) : "";
}

async function commitTree(runCommand, context, commit, options = {}) {
  return gitOutput(runCommand, context, [
    "rev-parse",
    "--verify",
    `${commit}^{tree}`
  ], options);
}

async function commitIsAncestor(runCommand, context, ancestor, descendant, options = {}) {
  if (ancestor === descendant) {
    return true;
  }
  const result = await git(runCommand, context, [
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant
  ], {
    ...options,
    required: false
  });
  return result?.ok === true;
}

async function observedCanonicalCommit(runCommand, context, options = {}) {
  const [stable, recorded, base] = await Promise.all([
    optionalGitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      `${canonicalRef(context)}^{commit}`
    ], options),
    context.lastCanonicalCommit
    ? await optionalGitOutput(runCommand, context, [
        "rev-parse",
        "--verify",
        `${context.lastCanonicalCommit}^{commit}`
      ], options)
      : "",
    gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      `${context.baseCommit}^{commit}`
    ], options)
  ]);
  let observed = stable || recorded || base;
  for (const candidate of [recorded, base].filter(Boolean)) {
    if (candidate === observed) {
      continue;
    }
    if (await commitIsAncestor(runCommand, context, observed, candidate, options)) {
      observed = candidate;
    }
  }
  return observed;
}

async function sessionWorkComparison(runCommand, context, {
  baseCommit,
  canonicalCommit,
  sessionHead,
  worktreeTree,
  reconcileHistory = false
}, options = {}) {
  const [baseTree, canonicalTree] = await Promise.all([
    commitTree(runCommand, context, baseCommit, options),
    commitTree(runCommand, context, canonicalCommit, options)
  ]);
  if (worktreeTree === canonicalTree) {
    return {
      baseTree,
      canonicalTree,
      changeBaseCommit: canonicalCommit,
      changeBaseTree: canonicalTree,
      changedPaths: [],
      sessionMatchesCanonical: true
    };
  }
  const changeBaseCommit = reconcileHistory ? baseCommit : await gitOutput(runCommand, context, [
    "merge-base",
    canonicalCommit,
    sessionHead
  ], options);
  const changeBaseTree = changeBaseCommit === canonicalCommit
    ? canonicalTree
    : await commitTree(runCommand, context, changeBaseCommit, options);
  const changedPaths = worktreeTree === changeBaseTree
    ? []
    : await changedPathsBetween(
        runCommand,
        context,
        changeBaseCommit,
        worktreeTree,
        options
      );
  return {
    baseTree,
    canonicalTree,
    changeBaseCommit,
    changeBaseTree,
    changedPaths,
    sessionMatchesCanonical: worktreeTree === canonicalTree
  };
}

function boundedInteger(value, fallback, maximum) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, maximum)
    : fallback;
}

function parseGitNameStatusZ(value = "") {
  const fields = String(value || "").split("\0");
  const files = new Map();
  for (let index = 0; index < fields.length;) {
    const status = text(fields[index++]);
    if (!status) {
      continue;
    }
    const previousPath = /^[CR]/u.test(status) ? fields[index++] : "";
    const filePath = fields[index++];
    if (!filePath) {
      continue;
    }
    files.set(filePath, {
      path: filePath,
      ...(previousPath ? { previousPath } : {}),
      status: status.slice(0, 1)
    });
  }
  return files;
}

function numericStat(value = "") {
  const normalized = text(value);
  if (normalized === "-") {
    return null;
  }
  const number = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function parseGitNumstatZ(value = "") {
  const fields = String(value || "").split("\0");
  const stats = new Map();
  for (let index = 0; index < fields.length;) {
    const record = fields[index++];
    if (!record) {
      continue;
    }
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    const filePath = record.slice(secondTab + 1);
    const renamed = !filePath;
    if (renamed) {
      index += 1;
    }
    const targetPath = renamed ? fields[index++] : filePath;
    if (!targetPath) {
      continue;
    }
    stats.set(targetPath, {
      added: numericStat(record.slice(0, firstTab)),
      deleted: numericStat(record.slice(firstTab + 1, secondTab))
    });
  }
  return stats;
}

async function sessionChangeFiles(runCommand, context, canonicalCommit, worktreeTree, options = {}) {
  const [statusResult, statResult] = await Promise.all([
    git(runCommand, context, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      "-M",
      "--name-status",
      "-z",
      canonicalCommit,
      worktreeTree
    ], options),
    git(runCommand, context, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      "-M",
      "--numstat",
      "-z",
      canonicalCommit,
      worktreeTree
    ], options)
  ]);
  const files = parseGitNameStatusZ(statusResult.stdout || statusResult.output);
  const stats = parseGitNumstatZ(statResult.stdout || statResult.output);
  return [...files.values()]
    .map((file) => ({
      ...file,
      ...(stats.get(file.path) || { added: 0, deleted: 0 })
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function safeChangePath(value = "") {
  const filePath = String(value || "");
  if (
    !filePath ||
    filePath.includes("\0") ||
    path.posix.isAbsolute(filePath) ||
    path.posix.normalize(filePath) !== filePath ||
    filePath === ".." ||
    filePath.startsWith("../")
  ) {
    throw saveError("Choose a changed project file.", "vibe64_session_change_path_invalid");
  }
  return filePath;
}

function exactFileDiffPathspecs(filePath) {
  // Literal pathspecs still include descendants; exclude those, not the entry itself.
  const escapedPath = filePath.replace(/[*?[\]\\]/gu, "\\$&");
  return [`:(literal)${filePath}`, `:(glob,exclude)${escapedPath}/**`];
}

async function sessionChangeDiff(runCommand, context, work, requestedPath, {
  commandOptions = {},
  lineLimit = DEFAULT_CHANGE_DIFF_LINE_LIMIT,
  project = {}
} = {}) {
  const filePath = safeChangePath(requestedPath);
  if (!work.changedPaths.includes(filePath)) {
    throw saveError("That file is not part of the current saved-work difference.", "vibe64_session_change_not_found");
  }
  const result = await git(runCommand, context, [
    "--no-literal-pathspecs",
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--unified=3",
    work.changeBaseCommit,
    work.worktreeTree,
    "--",
    ...exactFileDiffPathspecs(filePath)
  ], {
    commandOptions,
    project
  });
  const lines = String(result.stdout || result.output || "").replaceAll("\r\n", "\n").split("\n");
  const boundedLimit = boundedInteger(lineLimit, DEFAULT_CHANGE_DIFF_LINE_LIMIT, MAX_CHANGE_DIFF_LINE_LIMIT);
  return {
    canonicalCommit: work.canonicalCommit,
    changeBaseCommit: work.changeBaseCommit,
    diff: lines.slice(0, boundedLimit).join("\n"),
    lineLimit: boundedLimit,
    ok: true,
    path: filePath,
    shownLines: Math.min(lines.length, boundedLimit),
    totalLines: lines.length,
    truncated: lines.length > boundedLimit,
    worktreeTree: work.worktreeTree
  };
}

async function inspectSessionChangesDirect({
  commandOptions = {},
  derivedArtifactPaths = [],
  includeInitialDiff = true,
  limit = DEFAULT_CHANGE_FILE_LIMIT,
  offset = 0,
  project = {},
  runCommand = runVibe64Command,
  session = {},
  worktreeTree = ""
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Inspecting session changes"
  });
  const work = await inspectSessionWorkDirect({
    commandOptions,
    derivedArtifactPaths,
    project,
    runCommand,
    session,
    worktreeTree
  });
  const changedPathSet = new Set(work.changedPaths);
  const files = work.unsaved
    ? await sessionChangeFiles(runCommand, context, work.changeBaseCommit, work.worktreeTree, {
        commandOptions,
        project
      }).then((items) => items.filter((item) => changedPathSet.has(item.path)))
    : [];
  const boundedLimit = boundedInteger(limit, DEFAULT_CHANGE_FILE_LIMIT, MAX_CHANGE_FILE_LIMIT);
  const boundedOffset = Math.max(0, Number.parseInt(String(offset ?? ""), 10) || 0);
  const pageFiles = files.slice(boundedOffset, boundedOffset + boundedLimit);
  const initialDiff = includeInitialDiff && boundedOffset === 0 && pageFiles.length > 0
    ? await sessionChangeDiff(runCommand, context, work, pageFiles[0].path, {
        commandOptions,
        project
      })
    : null;
  return {
    ...work,
    files: pageFiles,
    initialDiff,
    limit: boundedLimit,
    offset: boundedOffset,
    totalCount: files.length,
    truncated: boundedOffset + boundedLimit < files.length
  };
}

async function inspectSessionChangeDiffDirect({
  commandOptions = {},
  derivedArtifactPaths = [],
  lineLimit = DEFAULT_CHANGE_DIFF_LINE_LIMIT,
  path: requestedPath = "",
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const filePath = safeChangePath(requestedPath);
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Inspecting a session change"
  });
  const work = await inspectSessionWorkDirect({
    commandOptions,
    derivedArtifactPaths,
    project,
    runCommand,
    session
  });
  return sessionChangeDiff(runCommand, context, work, filePath, {
    commandOptions,
    lineLimit,
    project
  });
}

async function inspectSessionWorkDirect({
  commandOptions = {},
  derivedArtifactPaths = [],
  inspectContributionPublication = false,
  knownSubmittedCommit = "",
  project = {},
  runCommand = runVibe64Command,
  session = {},
  worktreeTree = ""
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Inspecting session work"
  });
  const tree = text(worktreeTree) || await writeGitWorktreeTree({
    baseCommit: "HEAD",
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
  const [canonicalCommit, sessionHead, worktreePorcelain, worktreeTopLevel] = await Promise.all([
    observedCanonicalCommit(runCommand, context, { commandOptions, project }),
    gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}"
    ], {
      commandOptions,
      project
    }),
    gitOutput(runCommand, context, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=none",
      "-z"
    ], {
      commandOptions,
      project
    }),
    gitOutput(runCommand, context, [
      "rev-parse",
      "--show-toplevel"
    ], {
      commandOptions,
      project
    })
  ]);
  const [headTree, ahead, behind, comparison] = await Promise.all([
    gitOutput(runCommand, context, [
      "rev-parse",
      `${sessionHead}^{tree}`
    ], {
      commandOptions,
      project
    }),
    countCommitsBetween(runCommand, context, canonicalCommit, sessionHead, {
      commandOptions,
      project
    }),
    countCommitsBetween(runCommand, context, sessionHead, canonicalCommit, {
      commandOptions,
      project
    }),
    sessionWorkComparison(runCommand, context, {
      baseCommit: context.baseCommit,
      canonicalCommit,
      sessionHead,
      worktreeTree: tree
    }, { commandOptions, project })
  ]);
  const derivedPathSet = new Set((Array.isArray(derivedArtifactPaths) ? derivedArtifactPaths : [])
    .map(text)
    .filter(Boolean));
  const changedPaths = comparison.changedPaths.filter((filePath) => !derivedPathSet.has(filePath));
  const relationship = repositoryUpdateRelationship(ahead, behind);
  const worktreeClean = worktreePorcelain.length === 0;
  let publishedCommit;
  if (inspectContributionPublication) {
    if (!context.contribution) throw saveError("Publication inspection requires a bound contribution.",
      "vibe64_contribution_authority_changed");
    publishedCommit = await readContributionHead(runCommand, context, { commandOptions, project }, true);
    if (!publishedCommit && knownSubmittedCommit) {
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(knownSubmittedCommit)) throw saveError(
        "The saved contribution evidence is invalid.", "vibe64_connected_integration_unknown");
      publishedCommit = knownSubmittedCommit;
    }
    if (context.contributionDiscarded || (publishedCommit && context.contributionRemoteAbsent)) {
      const target = `refs/heads/${context.contribution.integrationBranch}`;
      const observed = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, target], { commandOptions, project });
      const [accepted, ref, extra] = observed.split(/\s+/u);
      if (ref !== target || extra || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(accepted) ||
          !await commitIsAncestor(runCommand, context, publishedCommit, accepted, { commandOptions, project })) {
        throw saveError("The removed contribution has not been proved integrated in this source. Check its receiving target and explicitly Update the connected session.",
          context.contributionDiscarded ? "vibe64_contribution_discarded" : "vibe64_contribution_branch_missing");
      }
    }
    if (!publishedCommit && context.baseCommit !== context.contribution.baseCommit) throw saveError(
      "The published contribution branch is missing and no exact submitted revision is retained. Preserve the source and inspect its Save recovery evidence.",
      "vibe64_contribution_branch_missing");
    if (publishedCommit && !await commitIsAncestor(runCommand, context, publishedCommit, sessionHead, { commandOptions, project })) {
      throw saveError("The contribution branch contains work this source has not incorporated. Update its receiving session before saving the main project.",
        "vibe64_connected_source_update_required", { repository: context.contribution.repository, sessionId: context.sessionId });
    }
  }
  return {
    ahead,
    baseCommit: context.baseCommit,
    behind,
    branch: context.branch,
    canonicalCommit,
    canonicalTree: comparison.canonicalTree,
    changeBaseCommit: comparison.changeBaseCommit,
    changeBaseTree: comparison.changeBaseTree,
    changedPaths,
    destination: sessionRepositoryDestination(project, session),
    dirty: tree !== headTree || !worktreeClean,
    mode: context.mode,
    ok: true,
    ...(inspectContributionPublication ? { publishedCommit } : {}),
    repositoryMode: context.mode,
    relationship,
    sessionMatchesCanonical: changedPaths.length === 0,
    sessionHead,
    sessionId: context.sessionId,
    tree,
    updateAvailable: behind > 0,
    updateStrategy: repositoryUpdateStrategy(relationship),
    unsaved: changedPaths.length > 0,
    worktreeClean,
    worktreeTree: tree,
    worktreeTopLevel,
    worktreePath: context.worktreePath
  };
}

async function inspectSessionWork({
  commandOptions = {},
  derivedArtifactPaths = [],
  inspectContributionPublication = false,
  knownSubmittedCommit = "",
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: { derivedArtifactPaths, inspectContributionPublication, knownSubmittedCommit },
    label: "Inspecting session work",
    operation: "work",
    project,
    runCommand
  });
}

async function inspectSessionChanges({
  commandOptions = {},
  derivedArtifactPaths = [],
  limit = DEFAULT_CHANGE_FILE_LIMIT,
  offset = 0,
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: { derivedArtifactPaths, limit, offset },
    label: "Inspecting session changes",
    operation: "changes",
    project,
    runCommand
  });
}

async function inspectSessionChangeDiff({
  commandOptions = {},
  derivedArtifactPaths = [],
  lineLimit = DEFAULT_CHANGE_DIFF_LINE_LIMIT,
  path: requestedPath = "",
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: {
      derivedArtifactPaths,
      lineLimit,
      path: safeChangePath(requestedPath)
    },
    label: "Inspecting a session change",
    operation: "change-diff",
    project,
    runCommand
  });
}

async function assertBranch(runCommand, context, options) {
  await git(runCommand, context, ["check-ref-format", "--branch", context.branch], options);
}

function saveRef(context, operationId, label) {
  const digest = crypto.createHash("sha256")
    .update(`${context.sessionId}\0${operationId}`)
    .digest("hex")
    .slice(0, 32);
  return `refs/vibe64/save/${digest}/${label}`;
}

function preparedSaveRef(context, operationId) {
  return saveRef(context, operationId, "prepared");
}

function saveCheckpointRef(context, operationId) {
  return checkpointRefs({
    outerTurnId: `save:${operationId}`,
    sessionId: context.sessionId
  }).turnRef;
}

function canonicalRef(context) {
  const digest = crypto.createHash("sha256")
    .update(context.branch)
    .digest("hex")
    .slice(0, 32);
  return `refs/vibe64/canonical/${digest}`;
}

async function deleteOperationRef(runCommand, context, ref, options = {}) {
  if (!text(ref)) {
    return;
  }
  await git(runCommand, context, ["update-ref", "-d", ref], {
    ...options,
    required: false
  });
}

async function rememberPreparedSaveCommit(runCommand, context, operationId, commit, options = {}) {
  const ref = preparedSaveRef(context, operationId);
  await git(runCommand, context, ["update-ref", ref, commit], options);
  return ref;
}

async function rememberCanonicalCommit(runCommand, context, commit, options = {}) {
  const verified = await gitOutput(runCommand, context, [
    "rev-parse",
    "--verify",
    `${commit}^{commit}`
  ], options);
  await git(runCommand, context, [
    "update-ref",
    canonicalRef(context),
    verified
  ], options);
  return verified;
}

async function readRemoteCanonical(runCommand, context, operationId, options) {
  await git(runCommand, context, ["remote", "set-url", "origin", context.remoteUrl], options);
  if (context.contribution) {
    context.contributionPublishedCommit = await readContributionHead(runCommand, context, options, true);
    context.contributionRemoteAbsent = !context.contributionPublishedCommit;
    if (context.contributionRemoteAbsent) {
      const observed = await optionalGitOutput(runCommand, context,
        ["rev-parse", "--verify", `${canonicalRef(context)}^{commit}`], options);
      const prepared = await gitOutput(runCommand, context,
        ["for-each-ref", "--format=%(refname)", "refs/vibe64/save/"], options);
      if (prepared.split("\n").some(ref => ref.endsWith("/prepared"))) {
        throw saveError("This contribution branch is missing after a publication attempt. Inspect its saved work and integration history before resubmitting it.",
          "vibe64_contribution_branch_missing");
      }
      if (context.lastCanonicalCommit === context.contribution.baseCommit &&
          (!observed || observed === context.contribution.baseCommit)) {
        context.canonicalBranch = context.contribution.replaces
          ? `vibe64-incoming/${context.contribution.replaces}_discarded`
          : context.contribution.integrationBranch;
        return context.contribution.baseCommit;
      }
      context.contributionMissingPublished = true;
    }
  }
  const operationRef = saveRef(context, operationId, "canonical");
  const integrationRef = context.contribution ? saveRef(context, operationId, "integration") : "";
  try {
    await git(runCommand, context, [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${context.contributionMissingPublished ? context.contribution.integrationBranch :
        context.contributionDiscarded ? `${context.branch}_discarded` : context.branch}:${operationRef}`,
      ...(integrationRef ? [`+refs/heads/${context.contribution.integrationBranch}:${integrationRef}`] : [])
    ], options);
    let commit = await gitOutput(runCommand, context, ["rev-parse", "--verify", operationRef], options);
    if (integrationRef) {
      if (!context.contributionMissingPublished && commit !== context.contributionPublishedCommit) throw saveError(
        "The contribution branch changed during its authority check. Retry Update or Save.", "vibe64_session_save_update_required");
      const accepted = await gitOutput(runCommand, context, ["rev-parse", "--verify", integrationRef], options);
      // Once the exact published head is integrated, ordinary explicit Update
      // consumes the accepted target. Save still publishes only the incoming ref.
      const integrated = await commitIsAncestor(runCommand, context,
        context.contributionMissingPublished ? context.baseCommit : commit, accepted, options);
      if ((context.contributionDiscarded || context.contributionMissingPublished) &&
          (!integrated || context.baseCommit === context.contribution.baseCommit && context.contributionMissingPublished)) {
        throw saveError("This removed contribution has not been integrated. Preserve its source and inspect its saved work.",
          context.contributionDiscarded ? "vibe64_contribution_discarded" : "vibe64_contribution_branch_missing");
      }
      if (integrated) {
        commit = accepted;
        context.canonicalBranch = context.contribution.integrationBranch;
      }
    }
    return rememberCanonicalCommit(runCommand, context, commit, options);
  } finally {
    await deleteOperationRef(runCommand, context, operationRef, options);
    await deleteOperationRef(runCommand, context, integrationRef, options);
  }
}

async function readContributionHead(runCommand, context, options, allowDiscarded = false) {
  const active = `refs/heads/${context.branch}`;
  const discarded = `${active}_discarded`;
  const output = await gitOutput(runCommand, context,
    ["ls-remote", "--heads", context.remoteUrl, active, discarded], options);
  const refs = new Map(output.split("\n").filter(Boolean).map(line => {
    const [commit, ref] = line.split(/\s+/u);
    if (![active, discarded].includes(ref) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commit)) {
      throw saveError("The contribution's remote branches could not be verified.", "vibe64_contribution_refs_invalid");
    }
    return [ref, commit];
  }));
  context.contributionDiscarded = refs.has(discarded) && !refs.has(active);
  context.contributionRemoteAbsent = !refs.has(active) && !refs.has(discarded);
  if (refs.has(discarded) && (!allowDiscarded || refs.has(active))) {
    throw saveError(refs.has(active)
      ? "Both contribution branches exist after an interrupted discard. Resolve that operation before publishing."
      : "This contribution was discarded. Preserve its source and submit further work as a new contribution.",
    refs.has(active) ? "vibe64_contribution_discard_incomplete" : "vibe64_contribution_discarded");
  }
  return refs.get(active) || (allowDiscarded ? refs.get(discarded) : "") || "";
}

async function assertLocalAuthority(runCommand, context, options) {
  const branch = await gitOutput(runCommand, context, ["branch", "--show-current"], {
    ...options,
    cwd: context.standaloneSourceRoot
  });
  if (branch !== context.branch) {
    throw saveError(
      `The project baseline must have ${context.branch} checked out before Save.`,
      "vibe64_session_save_local_branch_mismatch"
    );
  }
  const status = await gitOutput(runCommand, context, ["status", "--porcelain", "--untracked-files=all"], {
    ...options,
    cwd: context.standaloneSourceRoot
  });
  if (status) {
    throw saveError(
      "The local project baseline has unsaved work. Save cannot overwrite it.",
      "vibe64_session_save_local_authority_dirty"
    );
  }
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"]) {
    const markerResult = await git(runCommand, context, ["rev-parse", "--verify", "-q", marker], {
      ...options,
      cwd: context.standaloneSourceRoot,
      required: false
    });
    if (markerResult?.ok === true) {
      throw saveError(
        "The local project baseline has an unfinished Git operation.",
        "vibe64_session_save_local_operation_in_progress"
      );
    }
  }
  return gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD"], {
    ...options,
    cwd: context.standaloneSourceRoot
  });
}

async function readCanonical(runCommand, context, operationId, options) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return readRemoteCanonical(runCommand, context, operationId, options);
  }
  const authorityCommit = await assertLocalAuthority(runCommand, context, options);
  const operationRef = saveRef(context, operationId, "canonical");
  try {
    await git(runCommand, context, [
      "fetch",
      "--no-tags",
      context.standaloneSourceRoot,
      `+refs/heads/${context.branch}:${operationRef}`
    ], options);
    const importedCommit = await gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      operationRef
    ], options);
    if (importedCommit !== authorityCommit) {
      throw saveError(
        "The local project baseline changed while Vibe64 was reading it.",
        "vibe64_session_save_authority_advanced"
      );
    }
    return rememberCanonicalCommit(runCommand, context, importedCommit, options);
  } finally {
    await deleteOperationRef(runCommand, context, operationRef, options);
  }
}

async function mergeTrees(runCommand, context, {
  baseCommit,
  canonicalCommit,
  checkpointTree,
  commandOptions,
  identity,
  project,
  virtualCommit = "",
  explicitBase = false
}) {
  const mergeInputCommit = virtualCommit || await createVirtualCommit(runCommand, context, {
    baseCommit,
    commandOptions,
    identity,
    message: "Vibe64 session rebase input",
    project,
    tree: checkpointTree
  });
  const merged = await git(runCommand, context, [
    "merge-tree",
    "--write-tree",
    ...(explicitBase ? [`--merge-base=${baseCommit}`] : []),
    "--messages",
    "--name-only",
    "-z",
    canonicalCommit,
    mergeInputCommit
  ], {
    commandOptions,
    project,
    required: false
  });
  const tokens = String(merged?.stdout || merged?.output || "").split("\0");
  const mergedTree = text(tokens.shift());
  if (!/^[0-9a-f]{40,64}$/u.test(mergedTree)) {
    throw saveError(
      merged?.ok === true
        ? "Git did not produce a valid rebased tree."
        : "Vibe64 could not prepare the conflicting files for review.",
      "vibe64_session_update_merge_invalid"
    );
  }
  if (merged?.ok !== true) {
    const conflictPaths = [];
    while (tokens.length > 0) {
      const value = tokens.shift();
      if (!value) {
        break;
      }
      conflictPaths.push(value);
    }
    if (!conflictPaths.length) {
      throw saveError(
        "Vibe64 could not identify which files conflict with the latest saved version.",
        "vibe64_session_update_merge_invalid"
      );
    }
    return {
      conflictPaths: [...new Set(conflictPaths)].sort((left, right) => left.localeCompare(right)),
      conflictTree: mergedTree,
      mergedTree: "",
      virtualCommit: mergeInputCommit
    };
  }
  return {
    conflictPaths: [],
    conflictTree: "",
    mergedTree,
    virtualCommit: mergeInputCommit
  };
}

function normalizedConflictRecovery(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const conflictPaths = Array.isArray(value.conflictPaths)
    ? [...new Set(value.conflictPaths.map(String).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
    : [];
  const recovery = {
    baseCommit: text(value.baseCommit),
    canonicalCommit: text(value.canonicalCommit),
    checkpointTree: text(value.checkpointTree),
    conflictPaths,
    conflictTree: text(value.conflictTree),
    reviewId: text(value.reviewId),
    oldHead: text(value.oldHead),
    oldIndexTree: text(value.oldIndexTree)
  };
  return Object.values(recovery).some((entry) => Array.isArray(entry) ? entry.length === 0 : !entry)
    ? null
    : recovery;
}

function conflictMessage(conflictPaths = []) {
  const count = conflictPaths.length;
  const files = conflictPaths.slice(0, 3).join(", ");
  const suffix = count > 3 ? ` and ${count - 3} more` : "";
  return `${count} ${count === 1 ? "file needs" : "files need"} review before this session can update: ${files}${suffix}. Resolve ${count === 1 ? "it" : "them"} manually or with AI, then use Review resolved conflicts to apply Update. Fix it with AI can help with the repair.`;
}

function conflictRecoveryError(recovery) {
  return saveError(
    conflictMessage(recovery.conflictPaths),
    "vibe64_session_update_conflict",
    {
      conflictPaths: recovery.conflictPaths,
      conflictRecovery: recovery
    }
  );
}

async function resolvedConflictTree(runCommand, context, {
  currentRecovery,
  previousRecovery,
  reviewedConflictId,
  project
}) {
  const previous = reviewedConflictId ? normalizedConflictRecovery(previousRecovery) : null;
  if (!previous) {
    throw conflictRecoveryError(currentRecovery);
  }
  const originalConflictPaths = new Set(previous.conflictPaths);
  const stable = [
    "baseCommit",
    "canonicalCommit",
    "oldHead",
    "oldIndexTree"
  ].every((key) => previous[key] === currentRecovery[key]) &&
    currentRecovery.conflictPaths.every((entry) => originalConflictPaths.has(entry));
  if (!stable || reviewedConflictId !== previous.reviewId) {
    throw conflictRecoveryError(currentRecovery);
  }
  return conflictWorktreeTree(runCommand, context, { ...currentRecovery, project });
}

function conflictWorktreeTree(runCommand, context, { conflictTree, conflictPaths, project }) {
  return writeGitWorktreeTree({
    baseCommit: conflictTree,
    paths: conflictPaths,
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
}

async function createVirtualCommit(runCommand, context, {
  baseCommit,
  commandOptions,
  identity,
  message,
  project,
  tree
}) {
  return gitOutput(runCommand, context, [
    "-c", `user.name=${identity.name}`,
    "-c", `user.email=${identity.email}`,
    "commit-tree",
    tree,
    "-p",
    baseCommit
  ], {
    commandOptions,
    input: `${text(message) || "Vibe64 virtual commit"}\n`,
    project
  });
}

async function treeWithDerivedArtifactsFromCommit(runCommand, context, {
  commandOptions,
  derivedArtifactPaths = [],
  project,
  sourceCommit,
  tree
}) {
  const paths = normalizedDerivedArtifactPaths(derivedArtifactPaths);
  if (!paths.length) {
    return tree;
  }
  const temporaryRoot = await mkdtemp(path.join(path.dirname(context.worktreePath), ".vibe64-derived-index-"));
  const indexFile = path.join(temporaryRoot, "index");
  const env = { GIT_INDEX_FILE: indexFile };
  const options = {
    additionalAllowedRoots: [temporaryRoot],
    commandOptions,
    env,
    project
  };
  try {
    await git(runCommand, context, ["read-tree", tree], options);
    for (const filePath of paths) {
      const result = await git(runCommand, context, [
        "ls-tree",
        "-z",
        sourceCommit,
        "--",
        filePath
      ], {
        commandOptions,
        project
      });
      const match = /^(\d+)\s+\S+\s+([0-9a-f]{40,64})\t([^\0]+)\0$/u.exec(String(result.stdout || ""));
      if (match && match[3] === filePath) {
        await git(runCommand, context, [
          "update-index",
          "--add",
          "--cacheinfo",
          match[1],
          match[2],
          filePath
        ], options);
      } else {
        await git(runCommand, context, [
          "update-index",
          "--force-remove",
          "--",
          filePath
        ], {
          ...options,
          required: false
        });
      }
    }
    return await gitOutput(runCommand, context, ["write-tree"], options);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function regenerateDerivedArtifactTree(runCommand, context, {
  baseCommit,
  commandOptions,
  derivedArtifactPaths = [],
  identity,
  project,
  refreshDerivedArtifacts,
  tree
}) {
  const paths = normalizedDerivedArtifactPaths(derivedArtifactPaths);
  if (!paths.length) {
    return tree;
  }
  if (typeof refreshDerivedArtifacts !== "function") {
    throw saveError(
      "The project declares generated artifacts but their owning tool is unavailable.",
      "vibe64_session_derived_artifact_refresh_unavailable"
    );
  }
  const sourceCommit = await createVirtualCommit(runCommand, context, {
    baseCommit,
    commandOptions,
    identity,
    message: "Vibe64 derived artifact input",
    project,
    tree
  });
  const temporaryRoot = await mkdtemp(path.join(path.dirname(context.worktreePath), ".vibe64-derived-worktree-"));
  const temporaryWorktree = path.join(temporaryRoot, "source");
  const options = {
    additionalAllowedRoots: [temporaryRoot, temporaryWorktree],
    commandOptions,
    project
  };
  let registered = false;
  try {
    await git(runCommand, context, [
      "worktree",
      "add",
      "--detach",
      temporaryWorktree,
      sourceCommit
    ], options);
    registered = true;
    await refreshDerivedArtifacts({ projectRoot: temporaryWorktree });
    return await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: temporaryWorktree
    });
  } finally {
    if (registered) {
      await git(runCommand, context, [
        "worktree",
        "remove",
        "--force",
        temporaryWorktree
      ], {
        ...options,
        required: false
      });
    }
    await rm(temporaryRoot, { force: true, recursive: true });
    await git(runCommand, context, ["worktree", "prune"], {
      commandOptions,
      project,
      required: false
    });
  }
}

async function createSaveCommit(runCommand, context, {
  canonicalCommit,
  commandOptions,
  identity,
  mergedTree,
  message,
  project
}) {
  const subject = text(message);
  if (!subject) {
    throw saveError(
      "Save requires an assistant-generated commit subject.",
      "vibe64_session_save_message_required"
    );
  }
  return gitOutput(runCommand, context, [
    "-c", `user.name=${identity.name}`,
    "-c", `user.email=${identity.email}`,
    "commit-tree",
    mergedTree,
    "-p",
    canonicalCommit
  ], {
    commandOptions,
    input: `${subject}\n`,
    project
  });
}

async function assertConnectedSubmissionsIntegrated(runCommand, context, options) {
  if (!context.connectedSubmissions.length) return;
  if (await gitOutput(runCommand, context, ["rev-parse", "--is-shallow-repository"], options) !== "false") {
    throw saveError("Connected integration requires complete Git history. Prepare a full checkout before saving.",
      "vibe64_connected_integration_unknown");
  }
  for (const { contribution, submittedCommit } of context.connectedSubmissions) {
    const { repository, integrationBranch, id } = contribution;
    const remote = `https://github.com/${repository}.git`;
    const target = `refs/heads/${integrationBranch}`;
    const active = `refs/heads/vibe64-incoming/${id}`;
    const discarded = `${active}_discarded`;
    const details = { repository, integrationBranch, id, submittedCommit };
    const refs = [];
    try {
      const observed = await gitOutput(runCommand, context, ["ls-remote", "--heads", remote, target, active, discarded], options);
      const heads = new Map();
      for (const line of observed.split("\n").filter(Boolean)) {
        const [head, ref] = line.split(/\s+/u);
        if (![target, active, discarded].includes(ref) || heads.has(ref) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head)) {
          throw saveError("The receiving repository returned invalid ref evidence.");
        }
        heads.set(ref, head);
      }
      if (!heads.has(target)) throw saveError("The receiving integration branch is unavailable.");
      if (heads.has(active) && heads.has(discarded)) {
        throw saveError(`${repository} has an interrupted discard. Resolve it in Incoming changes before saving this project.`,
          "vibe64_connected_integration_unresolved", details);
      }
      for (const [remoteRef, head] of heads) {
        refs.push({ remote: remoteRef, head, local: saveRef(context, crypto.randomUUID(), "connected-integration") });
      }
      await git(runCommand, context, ["fetch", "--no-tags", "--no-write-fetch-head", remote,
        ...refs.map(ref => `+${ref.remote}:${ref.local}`)], options);
      if (await gitOutput(runCommand, context, ["rev-parse", "--is-shallow-repository"], options) !== "false") {
        throw saveError("The receiving history is incomplete.");
      }
      for (const ref of refs) {
        if (await gitOutput(runCommand, context, ["rev-parse", "--verify", `${ref.local}^{commit}`], options) !== ref.head) {
          throw saveError("The receiving branches changed during the integration check. Retry Save.");
        }
      }
      // The required revision is retained independently of the branch's current
      // head. Deleted refs and later branch commits cannot substitute for it.
      const remaining = await gitOutput(runCommand, context,
        ["rev-list", "--count", `${heads.get(target)}..${submittedCommit}`], options);
      if (!/^\d+$/u.test(remaining)) throw saveError("The required revision's ancestry is unknown.");
      if (remaining !== "0") {
        const wasDiscarded = heads.has(discarded);
        throw saveError(`${repository} has ${wasDiscarded ? "discarded" : "not merged"} contribution ${id} at ${submittedCommit.slice(0, 12)}. Integrate that revision into ${integrationBranch} before saving this project.`,
          wasDiscarded ? "vibe64_connected_integration_discarded" : "vibe64_connected_integration_pending", details);
      }
      // A deliberate replacement changes the selected source, not the required
      // submitted revision. Prove acceptance against that repository's current
      // authorized source after checking every retained submission above.
      const snapshot = (options.connectedWorkSnapshots || []).find(item =>
        item.contribution.repository === repository && item.contribution.integrationBranch === integrationBranch);
      if (!snapshot || !await commitIsAncestor(runCommand, context, heads.get(target), snapshot.sessionHead, options)) {
        throw saveError(`Update the connected session for ${repository} to incorporate its accepted ${integrationBranch} source before saving this project.`,
          "vibe64_connected_integration_source_update_required", details);
      }
    } catch (error) {
      if (error.code?.startsWith("vibe64_connected_integration_")) throw error;
      throw saveError(`Could not verify contribution ${id} in ${repository}/${integrationBranch}. Check repository access and complete history, then retry Save.`,
        "vibe64_connected_integration_unknown", details);
    } finally {
      for (const ref of refs) await deleteOperationRef(runCommand, context, ref.local, options);
    }
  }
}

function connectedWorkSnapshots(value = []) {
  if (!Array.isArray(value)) throw saveError("Connected source snapshots are unavailable.", "vibe64_connected_source_unavailable");
  return value.map(snapshot => {
    const contribution = sessionConnectedContribution({ metadata: {
      connected_contribution: JSON.stringify(snapshot?.contribution)
    } });
    if (!contribution || typeof snapshot.sessionId !== "string" || !text(snapshot.sessionId) ||
        !path.isAbsolute(text(snapshot.worktreePath)) ||
        [snapshot.baseCommit, snapshot.canonicalCommit, snapshot.sessionHead, snapshot.worktreeTree]
          .some(commit => !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(text(commit)))) {
      throw saveError("The connected source could not be captured. Inspect connected work before saving.",
        "vibe64_connected_source_unavailable");
    }
    return { contribution, sessionId: snapshot.sessionId, worktreePath: text(snapshot.worktreePath),
      baseCommit: snapshot.baseCommit, canonicalCommit: snapshot.canonicalCommit,
      sessionHead: snapshot.sessionHead, worktreeTree: snapshot.worktreeTree };
  });
}

async function assertConnectedWorkSnapshotsUnchanged(runCommand, snapshots, options) {
  for (const snapshot of snapshots) {
    const { contribution } = snapshot;
    const context = repositoryContext({ sessionId: snapshot.sessionId, sourcePath: snapshot.worktreePath, metadata: {
      base_commit: snapshot.baseCommit, canonical_commit: snapshot.canonicalCommit,
      connected_contribution: JSON.stringify(contribution)
    } }, { repositoryMode: PROJECT_REPOSITORY_MODE_GITHUB,
      repository: { defaultBranch: contribution.integrationBranch },
      githubRepository: { fullName: contribution.repository, cloneUrl: `https://github.com/${contribution.repository}.git` }
    });
    try {
      const tree = await writeGitWorktreeTree({ baseCommit: "HEAD", project: commandProject(context, options.project),
        runCommand, worktreePath: context.worktreePath });
      const [head, canonical] = await Promise.all([
        gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], options),
        observedCanonicalCommit(runCommand, context, options)
      ]);
      if (tree !== snapshot.worktreeTree || head !== snapshot.sessionHead || canonical !== snapshot.canonicalCommit) {
        throw saveError(`Connected work in ${contribution.repository} changed during Save. Inspect and save it before retrying Main Save.`,
          "vibe64_connected_save_required", { repository: contribution.repository, sessionId: contribution.id });
      }
    } catch (error) {
      if (error.code === "vibe64_connected_save_required") throw error;
      throw saveError(`Connected work in ${contribution.repository} could not be rechecked. Restore source access and retry Save.`,
        "vibe64_connected_source_unavailable", { repository: contribution.repository, sessionId: contribution.id });
    }
  }
}

async function publishSaveCommit(runCommand, context, saveCommit, canonicalCommit, options) {
  await assertConnectedSubmissionsIntegrated(runCommand, context, options);
  if (context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    const current = await assertLocalAuthority(runCommand, context, options);
    if (current !== canonicalCommit) {
      throw saveError(
        "The local project baseline advanced during Save.",
        "vibe64_session_save_authority_advanced"
      );
    }
    await git(runCommand, context, ["fetch", context.worktreePath, saveCommit], {
      ...options,
      cwd: context.standaloneSourceRoot
    });
    await assertConnectedWorkSnapshotsUnchanged(runCommand, options.connectedWorkSnapshots || [], options);
    options.onPublicationAttempt?.();
    await git(runCommand, context, ["merge", "--ff-only", saveCommit], {
      ...options,
      cwd: context.standaloneSourceRoot
    });
    const verified = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      ...options,
      cwd: context.standaloneSourceRoot
    });
    await rememberCanonicalCommit(runCommand, context, verified, options);
    return verified;
  }
  const pushArgs = ["push"];
  const expectedRemoteCommit = context.contribution
    ? context.contributionPublishedCommit
    : canonicalCommit;
  if (context.contribution) {
    if (context.contributionMissingPublished) throw saveError(
      "This contribution branch was removed after publication. Preserve its source and submit further work as a new contribution.",
      "vibe64_contribution_branch_missing");
    const expected = context.contributionRemoteAbsent ? "" : context.contributionPublishedCommit;
    if (await readContributionHead(runCommand, context, options) !== expected) {
      throw saveError("The contribution branch changed while Save was preparing. Inspect it before trying again.",
        "vibe64_session_save_update_required");
    }
    // The prepared commit descends from the observed head. The exact lease also
    // prevents ordinary push from recreating a ref removed by a racing discard.
    pushArgs.push(`--force-with-lease=refs/heads/${context.branch}:${expected}`);
  }
  if (context.mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    pushArgs.push("--push-option=vibe64-atomic");
  }
  pushArgs.push("origin", `${saveCommit}:refs/heads/${context.branch}`);
  let pushed;
  // This is a final read, not a lock on receiving repositories. It catches
  // changes during preparation without claiming exclusion after this check.
  await assertConnectedWorkSnapshotsUnchanged(runCommand, options.connectedWorkSnapshots || [], options);
  options.onPublicationAttempt?.();
  try {
    pushed = await git(runCommand, context, pushArgs, { ...options, required: false });
  } catch (error) {
    // A transport exception does not establish whether the remote accepted it.
    pushed = { ok: false, code: error.code, error: error.message };
  }
  let verified;
  try {
    const remote = context.contribution ? await readContributionHead(runCommand, context, options) : await gitOutput(
      runCommand, context, ["ls-remote", "--heads", "origin", `refs/heads/${context.branch}`], options
    );
    verified = remote.split(/\s+/u)[0] || "";
  } catch (error) {
    if (["vibe64_contribution_discarded", "vibe64_contribution_discard_incomplete"].includes(error.code)) throw error;
    throw saveError(
      `Save publication could not be confirmed. Inspect work to recover the prepared commit before retrying. ${text(error.message)}`,
      "vibe64_session_save_publication_unknown"
    );
  }
  if (verified === saveCommit) {
    // Exact remote evidence also confirms a push whose acknowledgement was lost.
    // Continue through the original reconciliation path without publishing again.
    await rememberCanonicalCommit(runCommand, context, verified, options);
    return verified;
  }
  if (pushed?.ok !== true) {
    if (verified && verified !== expectedRemoteCommit) {
      throw saveError(
        "The saved branch changed while Save was publishing. Update this session, then save again.",
        "vibe64_session_save_update_required",
        {
          canonicalCommit: verified,
          reconciledCommit: canonicalCommit,
          updateRequired: true
        }
      );
    }
    const reason = text(pushed?.stderr || pushed?.stdout || pushed?.output || pushed?.error) || "Git Save publication failed.";
    if (context.mode === PROJECT_REPOSITORY_MODE_GITHUB && /changes must be made through a pull request/iu.test(reason)) {
      throw saveError(
        `GitHub requires a pull request to update ${context.branch}. Your work remains in this session.\n\n${reason}`,
        "vibe64_pull_request_required"
      );
    }
    throw saveError(
      reason,
      text(pushed?.code) || "vibe64_session_save_git_failed"
    );
  }
  throw saveError(
    "Canonical repository verification did not return the commit Vibe64 published.",
    "vibe64_session_save_verification_failed"
  );
}

async function refreshVerifiedGithubMirror(
  runCommand,
  context,
  verifiedCommit,
  { commandOptions = {}, project = {} } = {}
) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return {
      attempted: false,
      kind: "none",
      retryable: false,
      status: "not_applicable"
    };
  }
  const mirrorPath = context.githubMirrorPath;
  const retryable = (code, reason) => ({
    attempted: Boolean(mirrorPath),
    branch: context.branch,
    code,
    kind: "github_mirror",
    message: "Your work was saved, but Vibe64 could not refresh its local clone cache. A later session or Save will retry it.",
    reason,
    retryable: true,
    status: "retryable",
    verifiedCommit
  });
  if (!mirrorPath && context.githubMirrorOptional) {
    return { attempted: false, kind: "none", retryable: false, status: "not_applicable" };
  }
  if (!mirrorPath || !path.isAbsolute(mirrorPath)) {
    return retryable(
      "vibe64_session_save_github_mirror_missing",
      "configuration_missing"
    );
  }

  try {
    const [command, ...args] = githubMirrorRefreshInvocation({
      mirrorPath,
      remoteUrl: context.remoteUrl
    });
    const refresh = await saveCommand(runCommand, context, command, args, {
      additionalAllowedRoots: [mirrorPath],
      commandOptions,
      project
    });
    if (refresh?.ok !== true) {
      return retryable(
        text(refresh?.code) || "vibe64_session_save_github_mirror_refresh_failed",
        "refresh_failed"
      );
    }
    const localOptions = {
      additionalAllowedRoots: [mirrorPath],
      commandOptions,
      project,
      required: false
    };
    const [mirrorCommitResult, mirrorOriginResult] = await Promise.all([
      git(runCommand, context, [
        "--git-dir", mirrorPath,
        "rev-parse", "--verify", `refs/heads/${context.branch}^{commit}`
      ], localOptions),
      git(runCommand, context, [
        "--git-dir", mirrorPath,
        "remote", "get-url", "origin"
      ], localOptions)
    ]);
    const mirrorCommit = mirrorCommitResult?.ok === true ? output(mirrorCommitResult) : "";
    const mirrorOrigin = mirrorOriginResult?.ok === true ? output(mirrorOriginResult) : "";
    if (mirrorCommit !== verifiedCommit || mirrorOrigin !== context.remoteUrl) {
      return {
        ...retryable(
          "vibe64_session_save_github_mirror_verification_failed",
          "verification_failed"
        ),
        mirrorCommit
      };
    }
    return {
      attempted: true,
      branch: context.branch,
      kind: "github_mirror",
      mirrorCommit,
      retryable: false,
      status: "current",
      verifiedCommit
    };
  } catch {
    return retryable(
      "vibe64_session_save_github_mirror_refresh_failed",
      "refresh_interrupted"
    );
  }
}

async function currentCanonicalCommit(runCommand, context, operationId, options) {
  return readCanonical(runCommand, context, operationId, options);
}

async function checkSessionUpdatesDirect({
  commandOptions = {},
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Checking repository for updates",
    operationId
  });
  await assertBranch(runCommand, context, { commandOptions, project });
  const canonicalCommit = await currentCanonicalCommit(
    runCommand,
    context,
    operationId,
    { commandOptions, project }
  );
  const [sessionHead, worktreeTree] = await Promise.all([
    gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
      commandOptions,
      project
    }),
    writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    })
  ]);
  const ancestor = await git(runCommand, context, [
    "merge-base",
    "--is-ancestor",
    context.baseCommit,
    canonicalCommit
  ], {
    commandOptions,
    project,
    required: false
  });
  const historyRewritten = ancestor?.ok !== true;
  if (historyRewritten && context.mode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    throw saveError(
      "The saved project history no longer descends from this session's starting version.",
      "vibe64_session_update_history_diverged"
    );
  }
  const historyReview = historyRewritten ? {
    baseCommit: context.baseCommit, canonicalCommit, sessionHead, worktreeTree,
    changedPaths: (await changedPathsBetween(runCommand, context, context.baseCommit, worktreeTree,
      { commandOptions, project })).slice(0, 100)
  } : null;
  const [ahead, behind, canonicalInSession, canonicalTree] = await Promise.all([
    countCommitsBetween(runCommand, context, canonicalCommit, sessionHead, {
      commandOptions,
      project
    }),
    countCommitsBetween(runCommand, context, sessionHead, canonicalCommit, {
      commandOptions,
      project
    }),
    commitIsAncestor(runCommand, context, canonicalCommit, sessionHead, {
      commandOptions,
      project
    }),
    commitTree(runCommand, context, canonicalCommit, { commandOptions, project })
  ]);
  const relationship = repositoryUpdateRelationship(ahead, behind);
  const incoming = behind > 0
    ? await incomingVersionsBetween(runCommand, context, sessionHead, canonicalCommit, {
        commandOptions,
        project
      })
    : { incomingVersions: [], incomingVersionsTruncated: false };
  return {
    ahead,
    baseCommit: context.baseCommit,
    behind,
    canonicalCommit,
    canonicalSource: {
      authority: context.mode,
      commit: canonicalCommit,
      ref: `refs/heads/${context.canonicalBranch || context.branch}`,
      ...(context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
        ? {}
        : { repository: context.remoteUrl })
    },
    ...incoming,
    ok: true,
    operationId,
    reconciled: !historyRewritten && canonicalInSession,
    ...(historyReview ? { historyReview } : {}),
    repositoryMode: context.mode,
    relationship,
    sessionCurrent: canonicalInSession,
    sessionHead,
    sessionMatchesCanonical: worktreeTree === canonicalTree,
    updateAvailable: historyRewritten || !canonicalInSession,
    updateStrategy: repositoryUpdateStrategy(relationship)
  };
}

async function checkSessionUpdates({
  commandOptions = {},
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runProjectSourceExclusive(() => runSessionWorkOperation({
    commandOptions,
    context,
    label: "Checking repository for updates",
    operation: "check-updates",
    operationId,
    project,
    runCommand
  }), {
    operation: `check-session-updates:${context.sessionId}`
  });
}

async function applySessionUpdate(runCommand, context, {
  canonicalCommit,
  checkpointCommit,
  checkpointTree,
  commandOptions,
  mergedCommit,
  mergedTree,
  oldHead,
  oldIndexTree,
  project
}) {
  const currentTree = await writeGitWorktreeTree({
    baseCommit: "HEAD",
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
  if (currentTree !== checkpointTree) {
    throw saveError(
      "This session changed while its update was being prepared. Retry when the assistant is idle.",
      "vibe64_session_update_worktree_changed"
    );
  }
  try {
    await git(runCommand, context, ["read-tree", "--reset", "-u", mergedCommit], {
      commandOptions,
      project
    });
    await git(runCommand, context, ["update-ref", "HEAD", canonicalCommit, oldHead], {
      commandOptions,
      project
    });
    await git(runCommand, context, ["read-tree", canonicalCommit], {
      commandOptions,
      project
    });
    const updatedTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    if (updatedTree !== mergedTree) {
      throw saveError(
        "The updated session did not match the prepared merged work.",
        "vibe64_session_update_verification_failed"
      );
    }
    await rememberCanonicalCommit(runCommand, context, canonicalCommit, {
      commandOptions,
      project
    });
    return { currentTree: updatedTree, reconciled: true, status: "updated" };
  } catch (error) {
    const currentHead = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    }).catch(() => "");
    await git(runCommand, context, ["read-tree", "--reset", "-u", checkpointCommit], {
      commandOptions,
      project,
      required: false
    });
    if (currentHead && currentHead !== oldHead) {
      await git(runCommand, context, ["update-ref", "HEAD", oldHead, currentHead], {
        commandOptions,
        project,
        required: false
      });
    }
    await git(runCommand, context, ["read-tree", oldIndexTree], {
      commandOptions,
      project,
      required: false
    });
    throw error;
  }
}

async function captureSessionWorkUpdateCheckpointDirect({
  commandOptions = {}, operationId, project = {}, runCommand = runVibe64Command, session = {}
} = {}) {
  const context = repositoryContext(session, project);
  await assertBranch(runCommand, context, { commandOptions, project });
  const checkpoint = await createGitTurnCheckpoint({
    outerTurnId: `update:${operationId}`,
    outcome: "completed",
    project: commandProject(context, project),
    runCommand,
    sessionId: context.sessionId,
    timestamp: new Date().toISOString(),
    worktreePath: context.worktreePath
  });
  const [oldHead, oldIndexTree] = await Promise.all([
    gitOutput(runCommand, context, ["rev-parse", "HEAD"], { commandOptions, project }),
    gitOutput(runCommand, context, ["write-tree"], { commandOptions, project })
  ]);
  return { checkpointCommit: checkpoint.commit, checkpointTree: checkpoint.tree, oldHead, oldIndexTree };
}

async function prepareSessionWorkUpdateDirect({
  checkpoint = {}, commandOptions = {}, conflictRecovery = null, derivedArtifactPaths = [],
  historyReview = null, identity = {}, operationId, project = {}, reviewedConflictId = "",
  runCommand = runVibe64Command, session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const { checkpointCommit, checkpointTree, oldHead, oldIndexTree } = checkpoint;
  const author = { email: text(identity.email) || "vibe64@localhost", name: text(identity.name) || "Vibe64 Update" };
  const canonicalCommit = await currentCanonicalCommit(
    runCommand,
    context,
    operationId,
    { commandOptions, project }
  );
  const ancestor = await git(runCommand, context, [
    "merge-base",
    "--is-ancestor",
    context.baseCommit,
    canonicalCommit
  ], {
    commandOptions,
    project,
    required: false
  });
  const historyRewritten = ancestor?.ok !== true;
  if (historyRewritten || historyReview) {
    if (context.mode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
      throw saveError("The saved project history no longer descends from this session's starting version.",
        "vibe64_session_update_history_diverged");
    }
    const expected = { baseCommit: context.baseCommit, canonicalCommit, sessionHead: oldHead, worktreeTree: checkpointTree };
    const reviewedRepair = reviewedConflictId && conflictRecovery?.reviewId === reviewedConflictId &&
      conflictRecovery.baseCommit === context.baseCommit && conflictRecovery.canonicalCommit === canonicalCommit &&
      conflictRecovery.oldHead === oldHead && conflictRecovery.oldIndexTree === oldIndexTree;
    if (!reviewedRepair && (!historyReview || Object.entries(expected).some(([key, value]) => historyReview[key] !== value))) {
      throw saveError("The project history was rewritten. Open Repository, check for updates, then review and reconcile this session.",
        "vibe64_session_history_review_required");
    }
  }
  const comparison = await sessionWorkComparison(runCommand, context, {
    baseCommit: context.baseCommit,
    canonicalCommit,
    sessionHead: oldHead,
    worktreeTree: checkpointTree,
    reconcileHistory: historyRewritten
  }, { commandOptions, project });
  const derivedPathSet = new Set(normalizedDerivedArtifactPaths(derivedArtifactPaths));
  const authoredChangedPaths = comparison.changedPaths
    .filter((filePath) => !derivedPathSet.has(filePath));
  const canonicalInSession = await commitIsAncestor(
    runCommand,
    context,
    canonicalCommit,
    oldHead,
    { commandOptions, project }
  );
  if (canonicalInSession && !historyRewritten) {
    return {
      baseCommit: context.baseCommit,
      canonicalCommit,
      canonicalTree: comparison.canonicalTree,
      changeBaseCommit: comparison.changeBaseCommit,
      checkpointCommit,
      checkpointTree,
      currentTree: checkpointTree,
      ok: true,
      operationId,
      mode: context.mode,
      reconciled: true,
      repositoryMode: context.mode,
      sessionCurrent: canonicalInSession,
      sessionMatchesCanonical: comparison.sessionMatchesCanonical,
      status: "already_current"
    };
  }

  let mergedSourceTree = comparison.canonicalTree;
  if (authoredChangedPaths.length) {
    const checkpointTreeForMerge = await treeWithDerivedArtifactsFromCommit(runCommand, context, {
      commandOptions,
      derivedArtifactPaths,
      project,
      sourceCommit: canonicalCommit,
      tree: checkpointTree
    });
    const mergeResult = await mergeTrees(runCommand, context, {
      baseCommit: comparison.changeBaseCommit,
      explicitBase: historyRewritten,
      canonicalCommit,
      checkpointTree: checkpointTreeForMerge,
      commandOptions,
      identity: author,
      project
    });
    const currentRecovery = mergeResult.conflictPaths.length > 0
      ? {
          baseCommit: comparison.changeBaseCommit,
          canonicalCommit,
          checkpointTree,
          conflictPaths: mergeResult.conflictPaths,
          conflictTree: mergeResult.conflictTree,
          oldHead,
          oldIndexTree,
          reviewId: crypto.randomUUID()
        }
      : null;
    mergedSourceTree = currentRecovery
      ? await resolvedConflictTree(runCommand, context, {
          currentRecovery,
          previousRecovery: conflictRecovery,
          reviewedConflictId,
          project
        })
      : mergeResult.mergedTree;
  }
  return {
    ...checkpoint,
    baseCommit: context.baseCommit,
    canonicalCommit,
    canonicalTree: comparison.canonicalTree,
    changeBaseCommit: comparison.changeBaseCommit,
    mergedSourceTree,
    mode: context.mode,
    operationId,
    repositoryMode: context.mode,
    sessionCurrent: true,
    ...(!authoredChangedPaths.length ? { sessionMatchesCanonical: true } : {}),
    status: "prepared"
  };
}

async function regenerateSessionWorkUpdateDirect({
  commandOptions = {}, derivedArtifactPaths = [], identity = {}, prepared = {}, project = {},
  refreshDerivedArtifacts = null, runCommand = runVibe64Command, session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const author = { email: text(identity.email) || "vibe64@localhost", name: text(identity.name) || "Vibe64 Update" };
  const mergedTree = await regenerateDerivedArtifactTree(runCommand, context, {
    baseCommit: prepared.canonicalCommit,
    commandOptions, derivedArtifactPaths, identity: author, project, refreshDerivedArtifacts,
    tree: prepared.mergedSourceTree
  });
  const mergedCommit = mergedTree === prepared.canonicalTree
    ? prepared.canonicalCommit
    : await createVirtualCommit(runCommand, context, {
        baseCommit: prepared.canonicalCommit, commandOptions, identity: author,
        message: "Vibe64 session update result", project, tree: mergedTree
      });
  return { ...prepared, mergedCommit, mergedTree };
}

async function applySessionWorkUpdateDirect({
  commandOptions = {}, prepared = {}, project = {}, runCommand = runVibe64Command, session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const reconciliation = await applySessionUpdate(runCommand, context, {
    ...prepared, commandOptions, project
  });
  return { ...prepared, ok: true, ...reconciliation };
}

async function runSessionUpdateStages({
  beforeSourceChange = async () => {}, derivedArtifactPaths = [], onProgress = async () => null,
  operationId = crypto.randomUUID(), project = {}, runProjectSourceExclusive = async (operation) => operation(),
  session = {}, ...input
}, runStage) {
  const context = repositoryContext(session, project);
  const stage = (operation, values = {}) => runStage(operation, {
    ...input, derivedArtifactPaths, operationId, project, session, ...values
  });
  await onProgress({ kind: "lock", message: "Waiting for exclusive repository access.", stage: "repository-lock" });
  return runProjectSourceExclusive(async () => {
    await onProgress({ kind: "checkpoint", message: "Capturing this session's complete worktree.", stage: "checkpointing" });
    const checkpoint = await stage("update-checkpoint");
    await onProgress({ ...checkpoint, kind: "checkpoint", message: "Session checkpoint captured.", stage: "checkpointed" });
    await onProgress({ kind: "update", message: "Fetching the latest saved version and merging session changes.", stage: "merging" });
    let prepared = await stage("update-prepare", { checkpoint });
    if (prepared.status === "already_current") return prepared;
    await onProgress({ kind: "update", message: derivedArtifactPaths.length
      ? "Regenerating project diagrams from the merged source."
      : "Preparing the merged session worktree.", stage: "regenerating" });
    prepared = await stage("update-derived", { prepared });
    await onProgress({ ...prepared, kind: "update", message: "A conflict-free session update is ready.", stage: "prepared" });
    await onProgress({ kind: "update", message: "Applying and verifying the session update.", stage: "mutating" });
    await beforeSourceChange();
    return stage("update-apply", { prepared });
  }, { operation: `update-session:${context.sessionId}` });
}

const UPDATE_STAGE_IMPLEMENTATIONS = {
  "update-checkpoint": captureSessionWorkUpdateCheckpointDirect,
  "update-prepare": prepareSessionWorkUpdateDirect,
  "update-derived": regenerateSessionWorkUpdateDirect,
  "update-apply": applySessionWorkUpdateDirect
};

async function updateSessionWorkDirect(input = {}) {
  return runSessionUpdateStages(input, (operation, values) => UPDATE_STAGE_IMPLEMENTATIONS[operation](values));
}

async function updateSessionWork(input = {}) {
  const { commandOptions = {}, runCommand = runVibe64Command, ...options } = input;
  return runSessionUpdateStages(options, (operation, values) => {
    const { project, session, operationId, ...stageInput } = values;
    return runSessionWorkOperation({
      commandOptions,
      context: repositoryContext(session, project),
      input: stageInput,
      label: "Updating session from repository",
      operation,
      operationId,
      project,
      runCommand,
      timeout: operation === "update-derived" ? 10 * 60_000 : SAVE_TIMEOUT_MS
    });
  });
}

async function recoverSessionWorkUpdate({
  beforeSourceChange = async () => {},
  commandOptions = {},
  project = {},
  recovery = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Recovering session update",
    operationId: text(recovery.operationId) || crypto.randomUUID()
  });
  const required = [
    "canonicalCommit",
    "checkpointCommit",
    "checkpointTree",
    "mergedCommit",
    "mergedTree",
    "oldHead",
    "oldIndexTree"
  ];
  if (required.some((key) => !text(recovery[key]))) {
    throw saveError(
      "The interrupted session update stopped before mutation and can be retried.",
      "vibe64_session_update_interrupted_retryable",
      { retryable: true }
    );
  }
  return runProjectSourceExclusive(async () => {
    const head = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    });
    const tree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    const headIsOld = head === recovery.oldHead;
    const headIsCanonical = head === recovery.canonicalCommit;
    const treeIsCheckpoint = tree === recovery.checkpointTree;
    const treeIsMerged = tree === recovery.mergedTree;
    if ((!headIsOld && !headIsCanonical) || (!treeIsCheckpoint && !treeIsMerged)) {
      throw saveError(
        "The interrupted session update cannot be recovered automatically because the worktree changed.",
        "vibe64_session_update_recovery_changed"
      );
    }
    await beforeSourceChange();
    if (treeIsCheckpoint) {
      await git(runCommand, context, ["read-tree", "--reset", "-u", recovery.mergedCommit], {
        commandOptions,
        project
      });
    }
    if (headIsOld) {
      await git(runCommand, context, [
        "update-ref",
        "HEAD",
        recovery.canonicalCommit,
        recovery.oldHead
      ], {
        commandOptions,
        project
      });
    }
    await git(runCommand, context, ["read-tree", recovery.canonicalCommit], {
      commandOptions,
      project
    });
    const recoveredTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    if (recoveredTree !== recovery.mergedTree) {
      throw saveError(
        "The interrupted session update could not reproduce its prepared worktree.",
        "vibe64_session_update_verification_failed"
      );
    }
    await rememberCanonicalCommit(runCommand, context, recovery.canonicalCommit, {
      commandOptions,
      project
    });
    return {
      ...recovery,
      currentTree: recoveredTree,
      ok: true,
      reconciled: true,
      recovered: true,
      status: "updated"
    };
  }, {
    operation: `recover-update-session:${context.sessionId}`
  });
}

async function reconcileSession(runCommand, context, {
  checkpointCommit,
  checkpointTree,
  commandOptions,
  project,
  saveCommit,
  sessionHead = ""
}) {
  const [currentTree, oldHead, saveTree] = await Promise.all([
    writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    }),
    gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    }),
    commitTree(runCommand, context, saveCommit, {
      commandOptions,
      project
    })
  ]);
  if (oldHead === saveCommit) {
    return {
      currentTree,
      reconciled: true,
      status: "saved"
    };
  }
  if (sessionHead && oldHead !== sessionHead) {
    return {
      currentTree,
      reconciled: false,
      status: "published_needs_reconcile"
    };
  }
  const preserveLaterWork = currentTree !== checkpointTree && currentTree !== saveTree;
  const oldIndexTree = await gitOutput(runCommand, context, ["write-tree"], {
    commandOptions,
    project
  });
  try {
    if (preserveLaterWork) {
      await git(runCommand, context, ["read-tree", checkpointCommit], {
        commandOptions,
        project
      });
      await git(runCommand, context, ["read-tree", "-m", "-u", checkpointCommit, saveCommit], {
        commandOptions,
        project
      });
    } else {
      await git(runCommand, context, ["read-tree", "--reset", "-u", saveCommit], {
        commandOptions,
        project
      });
    }
    await git(runCommand, context, ["update-ref", "HEAD", saveCommit, oldHead], {
      commandOptions,
      project
    });
    return {
      currentTree,
      reconciled: true,
      status: "saved"
    };
  } catch (error) {
    if (!preserveLaterWork) {
      await git(runCommand, context, ["read-tree", "--reset", "-u", checkpointCommit], {
        commandOptions,
        project,
        required: false
      });
    }
    await git(runCommand, context, ["read-tree", oldIndexTree], {
      commandOptions,
      project,
      required: false
    });
    return {
      currentTree,
      error: text(error?.message || error),
      reconciled: false,
      status: "published_needs_reconcile"
    };
  }
}

async function captureSessionWorkSaveCheckpoint(runCommand, context, {
  commandOptions = {},
  operationId,
  project = {}
} = {}) {
  await assertBranch(runCommand, context, { commandOptions, project });
  const checkpoint = await createGitTurnCheckpoint({
    outerTurnId: `save:${operationId}`,
    outcome: "completed",
    project: commandProject(context, project),
    runCommand,
    sessionId: context.sessionId,
    timestamp: new Date().toISOString(),
    worktreePath: context.worktreePath
  });
  const sessionHead = await gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
    commandOptions,
    project
  });
  return {
    baseCommit: context.baseCommit,
    branch: context.branch,
    checkpointCommit: checkpoint.commit,
    checkpointTree: checkpoint.tree,
    mode: context.mode,
    operationId,
    sessionHead
  };
}

async function prepareSessionWorkSaveMessageDirect({
  commandOptions = {},
  connectedWorkSnapshots: suppliedConnectedSnapshots = [],
  derivedArtifactPaths = [],
  limit = 40,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Capturing work for Save",
    operationId
  });
  const checkpoint = await captureSessionWorkSaveCheckpoint(runCommand, context, {
    commandOptions,
    operationId,
    project
  });
  const changes = await inspectSessionChangesDirect({
    commandOptions,
    derivedArtifactPaths,
    includeInitialDiff: false,
    limit,
    project,
    runCommand,
    session,
    worktreeTree: checkpoint.checkpointTree
  });
  if (!changes.totalCount) {
    await assertConnectedSubmissionsIntegrated(runCommand, context, {
      commandOptions, connectedWorkSnapshots: connectedWorkSnapshots(suppliedConnectedSnapshots), project
    });
    throw saveError(
      "This session has no work to save.",
      "vibe64_session_save_no_changes"
    );
  }
  return {
    changes,
    checkpoint
  };
}

async function assertSessionWorkSaveCheckpoint(runCommand, context, checkpoint, {
  commandOptions = {},
  operationId,
  project = {}
} = {}) {
  const checkpointCommit = text(checkpoint?.checkpointCommit);
  const checkpointTree = text(checkpoint?.checkpointTree);
  if (
    !checkpointCommit ||
    !checkpointTree ||
    text(checkpoint?.operationId) !== text(operationId) ||
    text(checkpoint?.baseCommit) !== context.baseCommit ||
    text(checkpoint?.branch) !== context.branch ||
    text(checkpoint?.mode) !== context.mode
  ) {
    throw saveError(
      "Save cannot verify the captured worktree. Capture and name the work again.",
      "vibe64_session_save_checkpoint_invalid"
    );
  }
  const recordedTree = await commitTree(runCommand, context, checkpointCommit, {
    commandOptions,
    project
  });
  if (recordedTree !== checkpointTree) {
    throw saveError(
      "Save cannot verify the captured worktree. Capture and name the work again.",
      "vibe64_session_save_checkpoint_invalid"
    );
  }
  const checkpointSessionHead = text(checkpoint?.sessionHead);
  const currentSessionHead = checkpointSessionHead
    ? await gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
        commandOptions,
        project
      })
    : "";
  if (checkpointSessionHead && currentSessionHead !== checkpointSessionHead) {
    throw saveError(
      "The session history changed while Vibe64 was naming this work. Save was not started; try again.",
      "vibe64_session_save_message_stale"
    );
  }
  return checkpoint;
}

async function prepareSessionWorkSave(runCommand, context, {
  checkpoint = {},
  commandOptions = {},
  connectedWorkSnapshots = [],
  derivedArtifactPaths = [],
  identity = {},
  message = "",
  operationId,
  project = {},
  refreshDerivedArtifacts = null
} = {}) {
  const checkpointTree = text(checkpoint.checkpointTree);
  const [canonicalCommit, sessionHead] = await Promise.all([
    readCanonical(runCommand, context, operationId, { commandOptions, project }),
    gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
      commandOptions,
      project
    })
  ]);
  const ancestor = await git(runCommand, context, [
    "merge-base",
    "--is-ancestor",
    context.baseCommit,
    canonicalCommit
  ], {
    commandOptions,
    project,
    required: false
  });
  if (ancestor?.ok !== true) {
    throw saveError(
      "Canonical history no longer descends from this session's saved base.",
      "vibe64_session_save_history_diverged"
    );
  }
  const canonicalInSession = await commitIsAncestor(
    runCommand,
    context,
    canonicalCommit,
    sessionHead,
    { commandOptions, project }
  );
  if (canonicalCommit !== context.baseCommit && !canonicalInSession) {
    throw saveError(
      "The saved branch has changed. Update this session before saving its work.",
      "vibe64_session_save_update_required",
      {
        canonicalCommit,
        reconciledCommit: context.baseCommit,
        updateRequired: true
      }
    );
  }
  const comparison = await sessionWorkComparison(runCommand, context, {
    baseCommit: context.baseCommit,
    canonicalCommit,
    sessionHead,
    worktreeTree: checkpointTree
  }, { commandOptions, project });
  const derivedPathSet = new Set(normalizedDerivedArtifactPaths(derivedArtifactPaths));
  const changedPaths = comparison.changedPaths.filter((filePath) => !derivedPathSet.has(filePath));
  if (!changedPaths.length) {
    await assertConnectedSubmissionsIntegrated(runCommand, context, { commandOptions, connectedWorkSnapshots, project });
    throw saveError(
      "This session has no work to save.",
      "vibe64_session_save_no_changes"
    );
  }
  const author = {
    email: text(identity.email) || "vibe64@localhost",
    name: text(identity.name) || "Vibe64 Save"
  };
  const sourceTree = await treeWithDerivedArtifactsFromCommit(runCommand, context, {
    commandOptions,
    derivedArtifactPaths,
    project,
    sourceCommit: canonicalCommit,
    tree: checkpointTree
  });
  const mergedTree = await regenerateDerivedArtifactTree(runCommand, context, {
    baseCommit: canonicalCommit,
    commandOptions,
    derivedArtifactPaths,
    identity: author,
    project,
    refreshDerivedArtifacts,
    tree: sourceTree
  });
  const saveCommit = await createSaveCommit(runCommand, context, {
    canonicalCommit,
    commandOptions,
    identity: author,
    mergedTree,
    message,
    project
  });
  const preparedRef = await rememberPreparedSaveCommit(
    runCommand,
    context,
    operationId,
    saveCommit,
    { commandOptions, project }
  );
  return {
    canonicalCommit,
    changeBaseCommit: comparison.changeBaseCommit,
    changedPaths,
    mergedTree,
    preparedRef,
    saveCommit
  };
}

async function publishPreparedSessionWorkSave(runCommand, context, {
  commandOptions = {},
  connectedWorkSnapshots = [],
  onPublicationAttempt,
  prepared = {},
  project = {}
} = {}) {
  return publishSaveCommit(
    runCommand,
    context,
    text(prepared.saveCommit),
    text(prepared.canonicalCommit),
    { commandOptions, connectedWorkSnapshots, onPublicationAttempt, project }
  );
}

function completedSessionWorkSave(context, checkpoint, prepared, verifiedCommit, finalized) {
  return {
    baseCommit: context.baseCommit,
    cacheMaintenance: finalized.cacheMaintenance,
    canonicalCommit: prepared.canonicalCommit,
    changeBaseCommit: prepared.changeBaseCommit,
    changedPaths: prepared.changedPaths,
    checkpointCommit: checkpoint.checkpointCommit,
    checkpointTree: checkpoint.checkpointTree,
    mergedTree: prepared.mergedTree,
    mode: context.mode,
    ok: true,
    operationId: checkpoint.operationId,
    preparedRef: prepared.preparedRef,
    saveCommit: prepared.saveCommit,
    sessionHead: checkpoint.sessionHead,
    status: finalized.status,
    verifiedCommit,
    ...finalized
  };
}

function deferredCacheMaintenance(context, verifiedCommit) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return {
      attempted: false,
      kind: "none",
      retryable: false,
      status: "not_applicable"
    };
  }
  return {
    attempted: false,
    branch: context.branch,
    kind: "github_mirror",
    retryable: false,
    status: "deferred",
    verifiedCommit
  };
}

function failedCacheMaintenance(context, verifiedCommit, error) {
  return {
    attempted: false,
    branch: context.branch,
    code: text(error?.code) || "vibe64_session_save_github_mirror_refresh_failed",
    kind: "github_mirror",
    message: "Your work was saved, but Vibe64 could not refresh its local clone cache. A later session or Save will retry it.",
    reason: "refresh_interrupted",
    retryable: true,
    status: "retryable",
    verifiedCommit
  };
}

async function refreshSessionWorkSaveCacheDirect({
  commandOptions = {},
  operationId = "",
  project = {},
  runCommand = runVibe64Command,
  session = {},
  verifiedCommit = ""
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Maintaining saved repository cache",
    operationId
  });
  return refreshVerifiedGithubMirror(
    runCommand,
    context,
    text(verifiedCommit),
    { commandOptions, project }
  );
}

async function deletePreparedSaveRef(runCommand, context, operationId, options = {}) {
  if (text(operationId)) {
    await deleteOperationRef(
      runCommand,
      context,
      preparedSaveRef(context, operationId),
      options
    );
  }
}

async function saveSessionWorkDirect({
  checkpoint: suppliedCheckpoint = null,
  commandOptions = {},
  connectedWorkSnapshots: suppliedConnectedSnapshots = [],
  deferCacheMaintenance = false,
  derivedArtifactPaths = [],
  identity = {},
  message = "",
  operationId = crypto.randomUUID(),
  project = {},
  refreshDerivedArtifacts = null,
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  onProgress = async () => null,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const snapshots = connectedWorkSnapshots(suppliedConnectedSnapshots);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Saving session work",
    operationId
  });
  await onProgress({
    kind: "lock",
    message: "Waiting for exclusive repository access.",
    stage: "repository-lock"
  });
  return runProjectSourceExclusive(async () => {
    await onProgress({
      baseCommit: context.baseCommit,
      branch: context.branch,
      kind: "checkpoint",
      message: "Capturing the complete session worktree.",
      mode: context.mode,
      operationId,
      stage: "checkpointing"
    });
    let checkpoint;
    if (suppliedCheckpoint) {
      await assertBranch(runCommand, context, { commandOptions, project });
      checkpoint = await assertSessionWorkSaveCheckpoint(runCommand, context, suppliedCheckpoint, {
        commandOptions,
        operationId,
        project
      });
    } else {
      checkpoint = await captureSessionWorkSaveCheckpoint(runCommand, context, {
        commandOptions,
        operationId,
        project
      });
    }
    await onProgress({
      checkpointCommit: checkpoint.checkpointCommit,
      checkpointTree: checkpoint.checkpointTree,
      kind: "checkpoint",
      message: "Session checkpoint captured.",
      stage: "checkpointed"
    });
    await onProgress({ kind: "canonical", message: "Reading the current canonical branch.", stage: "canonical-reading" });
    const prepared = await prepareSessionWorkSave(runCommand, context, {
      checkpoint,
      commandOptions,
      connectedWorkSnapshots: snapshots,
      derivedArtifactPaths,
      identity,
      message,
      operationId,
      project,
      refreshDerivedArtifacts
    });
    let publicationAttempted = false;
    let verifiedCommit;
    try {
      await onProgress({
        expectedCanonicalCommit: prepared.canonicalCommit,
        kind: "canonical",
        message: "Canonical branch read.",
        stage: "canonical-read"
      });
      await onProgress({
        expectedCanonicalCommit: prepared.canonicalCommit,
        kind: "publish",
        mergedTree: prepared.mergedTree,
        message: "Save commit prepared.",
        proposedCommit: prepared.saveCommit,
        stage: "prepared"
      });
      await onProgress({ kind: "publish", message: "Publishing one ordinary Save commit.", stage: "publishing" });
      verifiedCommit = await publishPreparedSessionWorkSave(runCommand, context, {
        commandOptions,
        connectedWorkSnapshots: snapshots,
        onPublicationAttempt() { publicationAttempted = true; },
        prepared,
        project
      });
    } catch (error) {
      if (!publicationAttempted) {
        // No publication command ran. Retire only this prepared proposal;
        // leaving it behind would make a first contribution's absent ref look
        // like a lost publication forever. The source checkpoint remains.
        await git(runCommand, context, ["update-ref", "-d", prepared.preparedRef, prepared.saveCommit], {
          commandOptions, project
        });
      }
      throw error;
    }
    await onProgress({
      kind: "publish",
      message: "Canonical Save commit verified.",
      stage: "published",
      verifiedCommit
    });
    await onProgress({ kind: "reconcile", message: "Reconciling the session onto the saved commit.", stage: "reconciling" });
    const reconciliation = await reconcileSession(runCommand, context, {
      checkpointCommit: checkpoint.checkpointCommit,
      checkpointTree: checkpoint.checkpointTree,
      commandOptions,
      project,
      saveCommit: prepared.saveCommit,
      sessionHead: checkpoint.sessionHead
    });
    const cacheMaintenance = deferCacheMaintenance
      ? deferredCacheMaintenance(context, verifiedCommit)
      : await refreshSessionWorkSaveCacheDirect({
          commandOptions,
          operationId,
          project,
          runCommand,
          session,
          verifiedCommit
        });
    if (cacheMaintenance.retryable === true) {
      await onProgress({
        cacheMaintenance,
        kind: "cache-warning",
        message: cacheMaintenance.message,
        stage: "cache-maintenance-warning"
      });
    }
    if (!deferCacheMaintenance) {
      await deletePreparedSaveRef(runCommand, context, operationId, {
        commandOptions,
        project
      });
    }
    return completedSessionWorkSave(
      context,
      checkpoint,
      prepared,
      verifiedCommit,
      { cacheMaintenance, ...reconciliation }
    );
  }, {
    operation: `save-session:${context.sessionId}`
  });
}

async function prepareSessionWorkSaveMessage({
  commandOptions = {},
  connectedWorkSnapshots: suppliedConnectedSnapshots = [],
  derivedArtifactPaths = [],
  limit = 40,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: { connectedWorkSnapshots: connectedWorkSnapshots(suppliedConnectedSnapshots), derivedArtifactPaths, limit },
    label: "Capturing work for Save",
    operation: "save-message",
    operationId,
    project,
    runCommand
  });
}

async function saveSessionWork({
  checkpoint = {},
  commandOptions = {},
  derivedArtifactPaths = [],
  identity = {},
  message = "",
  onCacheMaintenance = async () => null,
  operationId = crypto.randomUUID(),
  project = {},
  readConnectedWorkSnapshots = async () => [],
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  onProgress = async () => null,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const saved = await runProjectSourceExclusive(async () => {
    await onProgress({
      checkpointCommit: text(checkpoint.checkpointCommit),
      checkpointTree: text(checkpoint.checkpointTree),
      kind: "publish",
      message: "Publishing the captured work.",
      operationId,
      sessionHead: text(checkpoint.sessionHead),
      stage: "publishing"
    });
    const snapshots = connectedWorkSnapshots(await readConnectedWorkSnapshots());
    return runSessionWorkOperation({
      additionalAllowedRoots: snapshots.map(snapshot => snapshot.worktreePath),
      commandOptions,
      context,
      input: {
        checkpoint,
        connectedWorkSnapshots: snapshots,
        derivedArtifactPaths,
        identity,
        message
      },
      label: "Saving session work",
      operation: "save",
      operationId,
      project,
      runCommand
    });
  }, {
    operation: `save-session:${context.sessionId}`
  });
  if (context.mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    queueMicrotask(() => {
      void runSessionWorkOperation({
        commandOptions,
        context,
        input: {
          operationId,
          verifiedCommit: saved.verifiedCommit
        },
        label: "Maintaining saved repository cache",
        operation: "save-maintenance",
        operationId,
        project,
        runCommand
      }).then(onCacheMaintenance).catch((error) => (
        onCacheMaintenance(failedCacheMaintenance(context, saved.verifiedCommit, error))
      )).catch(() => {});
    });
  }
  return saved;
}

async function recoverSessionWorkSave({
  commandOptions = {},
  project = {},
  recovery = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const operationId = text(recovery.operationId);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Recovering session save",
    operationId: operationId || crypto.randomUUID()
  });
  const preparedRef = operationId ? preparedSaveRef(context, operationId) : "";
  const recordedProposedCommit = preparedRef
    ? await optionalGitOutput(runCommand, context, ["rev-parse", "--verify", `${preparedRef}^{commit}`], {
        commandOptions,
        project
      })
    : "";
  const proposedCommit = text(recovery.proposedCommit) || recordedProposedCommit;
  if (
    text(recovery.proposedCommit) &&
    recordedProposedCommit &&
    text(recovery.proposedCommit) !== recordedProposedCommit
  ) {
    throw saveError(
      "The interrupted Save has inconsistent prepared-commit evidence.",
      "vibe64_session_save_recovery_evidence_invalid"
    );
  }
  const expectedCanonicalCommit = text(recovery.expectedCanonicalCommit) || (
    proposedCommit
      ? await optionalGitOutput(runCommand, context, ["rev-parse", "--verify", `${proposedCommit}^`], {
          commandOptions,
          project
        })
      : ""
  );
  const recordedCheckpointCommit = operationId
    ? await optionalGitOutput(runCommand, context, [
        "rev-parse",
        "--verify",
        `${saveCheckpointRef(context, operationId)}^{commit}`
      ], { commandOptions, project })
    : "";
  const checkpointCommit = text(recovery.checkpointCommit) || recordedCheckpointCommit;
  const checkpointTree = text(recovery.checkpointTree) || (
    checkpointCommit
      ? await optionalGitOutput(runCommand, context, ["rev-parse", "--verify", `${checkpointCommit}^{tree}`], {
          commandOptions,
          project
        })
      : ""
  );
  if (!operationId || !expectedCanonicalCommit || !proposedCommit || !checkpointCommit || !checkpointTree) {
    throw saveError(
      "The interrupted Save stopped before a publishable commit was durably prepared. Retry Save.",
      "vibe64_session_save_interrupted_retryable",
      { retryable: true }
    );
  }
  if (await commitTree(runCommand, context, checkpointCommit, { commandOptions, project }) !== checkpointTree) {
    throw saveError(
      "The interrupted Save has inconsistent checkpoint evidence.",
      "vibe64_session_save_recovery_evidence_invalid"
    );
  }
  return runProjectSourceExclusive(async () => {
    let authorityCommit;
    try {
      authorityCommit = await currentCanonicalCommit(runCommand, context, operationId, { commandOptions, project });
    } catch (error) {
      if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) throw error;
      throw saveError(
        `Save publication is still unknown. Restore repository access and inspect work again. ${text(error.message)}`,
        "vibe64_session_save_publication_unknown"
      );
    }
    if (authorityCommit === expectedCanonicalCommit && context.contributionPublishedCommit !== proposedCommit) {
      throw saveError(
        "The interrupted Save did not publish. Retry Save when ready.",
        "vibe64_session_save_interrupted_retryable",
        { retryable: true }
      );
    }
    if (context.contribution) authorityCommit = context.contributionPublishedCommit;
    if (authorityCommit !== proposedCommit) {
      throw saveError(
        "Canonical history advanced while the interrupted Save was being recovered.",
        "vibe64_session_save_authority_advanced",
        { authorityCommit, expectedCanonicalCommit, proposedCommit }
      );
    }
    const cacheMaintenance = await refreshVerifiedGithubMirror(
      runCommand,
      context,
      proposedCommit,
      { commandOptions, project }
    );
    const reconciliation = await reconcileSession(runCommand, context, {
      checkpointCommit,
      checkpointTree,
      commandOptions,
      project,
      saveCommit: proposedCommit,
      sessionHead: text(recovery.sessionHead)
    });
    return {
      ...recovery,
      authorityCommit,
      cacheMaintenance,
      ok: true,
      recovered: true,
      preparedRef,
      saveCommit: proposedCommit,
      status: reconciliation.status,
      verifiedCommit: proposedCommit,
      ...reconciliation
    };
  }, {
    operation: `recover-save-session:${context.sessionId}`
  });
}

export {
  changeIncomingContribution,
  changeIncomingContributionDirect,
  inspectIncomingContributions,
  inspectIncomingContributionsDirect,
  checkSessionUpdates,
  checkSessionUpdatesDirect,
  exactFileDiffPathspecs,
  inspectSessionChangeDiff,
  inspectSessionChangeDiffDirect,
  inspectSessionChanges,
  inspectSessionChangesDirect,
  inspectSessionWork,
  inspectSessionWorkDirect,
  parseGitNameStatusZ,
  parseGitNumstatZ,
  prepareSessionPullRequestBranch,
  prepareSessionWorkSaveMessage,
  prepareSessionWorkSaveMessageDirect,
  repositoryUpdateRelationship,
  repositoryUpdateStrategy,
  recoverSessionWorkSave,
  recoverSessionWorkUpdate,
  refreshSessionWorkSaveCacheDirect,
  repositoryContext,
  safeChangePath,
  saveSessionWork,
  saveSessionWorkDirect,
  updateSessionWork,
  updateSessionWorkDirect,
  captureSessionWorkUpdateCheckpointDirect,
  prepareSessionWorkUpdateDirect,
  regenerateSessionWorkUpdateDirect,
  applySessionWorkUpdateDirect
};
