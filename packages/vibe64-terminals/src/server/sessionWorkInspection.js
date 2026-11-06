// Reads what a session has changed: its changed files, their diff and the state of its work.

import { sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import { repositoryUpdateRelationship, repositoryUpdateStrategy } from "@local/vibe64-core/shared";
import { runVibe64Command, writeGitWorktreeTree } from "@local/vibe64-execution/server";
import {
  DEFAULT_CHANGE_DIFF_LINE_LIMIT,
  DEFAULT_CHANGE_FILE_LIMIT,
  MAX_CHANGE_FILE_LIMIT,
  boundedDiff,
  changedFileRecords,
  exactFileDiffPathspecs,
  pageRecords,
  safeChangePath
} from "./gitRecords.js";
import {
  commandProject,
  countCommitsBetween,
  git,
  gitOutput,
  observedCanonicalCommit,
  repositoryContext,
  runSessionWorkOperation,
  saveError,
  scopedSessionWorkCommand,
  sessionWorkComparison
} from "./sessionWorkGit.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

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
  return changedFileRecords(statusResult.stdout || statusResult.output, statResult.stdout || statResult.output);
}

async function sessionChangeDiff(runCommand, context, work, requestedPath, options = {}) {
  const {
    commandOptions = {},
    lineLimit = DEFAULT_CHANGE_DIFF_LINE_LIMIT,
    project = {}
  } = options;
  const filePath = safeChangePath(requestedPath);
  if (!work.changedPaths.includes(filePath)) {
    throw saveError("That file is not part of the current saved-work difference.", "vibe64_session_change_not_found", {}, { status: 404 });
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
  return {
    canonicalCommit: work.canonicalCommit,
    changeBaseCommit: work.changeBaseCommit,
    ...boundedDiff(result.stdout || result.output, lineLimit),
    ok: true,
    path: filePath,
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
  const { items: pageFiles, ...page } = pageRecords(files, {
    defaultLimit: DEFAULT_CHANGE_FILE_LIMIT,
    limit,
    maxLimit: MAX_CHANGE_FILE_LIMIT,
    offset
  });
  const initialDiff = includeInitialDiff && page.offset === 0 && pageFiles.length > 0
    ? await sessionChangeDiff(runCommand, context, work, pageFiles[0].path, {
      commandOptions,
      project
    })
    : null;
  return {
    ...work,
    files: pageFiles,
    initialDiff,
    ...page
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
  project = {},
  runCommand = runVibe64Command,
  session = {},
  worktreeTree = ""
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Inspecting session work"
  });
  const tree = normalizeText(worktreeTree) || await writeGitWorktreeTree({
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
    .map(normalizeText)
    .filter(Boolean));
  const changedPaths = comparison.changedPaths.filter((filePath) => !derivedPathSet.has(filePath));
  const relationship = repositoryUpdateRelationship(ahead, behind);
  const worktreeClean = worktreePorcelain.length === 0;
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
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: { derivedArtifactPaths },
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

export {
  inspectSessionChangeDiff,
  inspectSessionChangeDiffDirect,
  inspectSessionChanges,
  inspectSessionChangesDirect,
  inspectSessionWork,
  inspectSessionWorkDirect
};
