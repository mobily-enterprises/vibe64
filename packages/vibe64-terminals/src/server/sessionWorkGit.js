// Session repository context, the managed Git command bridge, operation refs
// and the tree helpers shared by Save, Update and Incoming changes.
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
  sessionRepositoryProject
} from "@local/vibe64-core/server/projectRepository";
import { vibe64Host, writeGitWorktreeTree } from "@local/vibe64-execution/server";
import { parseGitNameStatusZ } from "./gitRecords.js";

const SAVE_TIMEOUT_MS = 120_000;
const SESSION_WORK_COMMAND_SCOPE = Symbol("vibe64-session-work-command-scope");
const SESSION_WORK_OPERATION_COMMAND_PATH = fileURLToPath(new URL(
  "./sessionWorkOperationCommand.js",
  import.meta.url
));

// A full SHA-1 or SHA-256 Git object id.
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
// Review diffs are bounded before they cross into the browser.
const MAX_REVIEW_DIFF_CHARACTERS = 100_000;

function isGitObjectId(value = "") {
  return GIT_OBJECT_ID.test(String(value ?? ""));
}

function boundedReviewDiff(content = "") {
  return { content: content.slice(0, MAX_REVIEW_DIFF_CHARACTERS), truncated: content.length > MAX_REVIEW_DIFF_CHARACTERS };
}

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
  return Object.freeze({
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
  });
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
        // The child process starts without this process's host profile.
        hostProfile: vibe64Host(),
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

// A session that rewrote and published the saved history itself (HEAD contains
// the new saved tip and no longer contains its old base) has nothing to replay.
async function savedHistoryRewritten(runCommand, context, canonicalCommit, sessionHead, options = {}) {
  if (await commitIsAncestor(runCommand, context, context.baseCommit, canonicalCommit, options)) {
    return false;
  }
  const [canonicalInSession, baseInSession] = await Promise.all([
    commitIsAncestor(runCommand, context, canonicalCommit, sessionHead, options),
    commitIsAncestor(runCommand, context, context.baseCommit, sessionHead, options)
  ]);
  return !canonicalInSession || baseInSession;
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

async function mergeTrees(runCommand, context, {
  baseCommit,
  canonicalCommit,
  checkpointTree,
  commandOptions,
  project,
  virtualCommit = "",
  explicitBase = false
}) {
  const mergeInputCommit = virtualCommit || await createVirtualCommit(runCommand, context, {
    baseCommit,
    commandOptions,
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
  if (!isGitObjectId(mergedTree)) {
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
  message,
  project,
  tree
}) {
  return gitOutput(runCommand, context, [
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
      const match = /^(\d+)\s+\S+\s+([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)\0$/u.exec(String(result.stdout || ""));
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

export {
  assertBranch,
  boundedReviewDiff,
  canonicalRef,
  changedPathsBetween,
  commandProject,
  commitIsAncestor,
  commitTree,
  conflictWorktreeTree,
  countCommitsBetween,
  createVirtualCommit,
  deleteOperationRef,
  git,
  gitOutput,
  isGitObjectId,
  mergeTrees,
  normalizedDerivedArtifactPaths,
  observedCanonicalCommit,
  optionalGitOutput,
  output,
  regenerateDerivedArtifactTree,
  rememberCanonicalCommit,
  repositoryContext,
  runSessionWorkOperation,
  SAVE_TIMEOUT_MS,
  saveCommand,
  savedHistoryRewritten,
  saveError,
  saveRef,
  scopedSessionWorkCommand,
  sessionWorkComparison,
  text,
  treeWithDerivedArtifactsFromCommit
};
