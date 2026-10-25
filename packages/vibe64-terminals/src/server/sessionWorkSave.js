// Save: inspect session work and changes, then checkpoint, prepare, publish,
// reconcile and recover a Save to the canonical branch.
import crypto from "node:crypto";
import path from "node:path";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  sessionRepositoryDestination
} from "@local/vibe64-core/server/projectRepository";
import { repositoryUpdateRelationship, repositoryUpdateStrategy } from "@local/vibe64-core/shared";
import {
  checkpointRefs,
  createGitTurnCheckpoint,
  githubMirrorRefreshInvocation,
  isFallbackGitIdentityEmail,
  runVibe64Command,
  writeGitWorktreeTree
} from "@local/vibe64-execution/server";
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
  assertBranch,
  commandProject,
  commitIsAncestor,
  commitTree,
  countCommitsBetween,
  deleteOperationRef,
  git,
  gitOutput,
  normalizedDerivedArtifactPaths,
  observedCanonicalCommit,
  optionalGitOutput,
  output,
  regenerateDerivedArtifactTree,
  rememberCanonicalCommit,
  repositoryContext,
  runSessionWorkOperation,
  saveCommand,
  savedHistoryRewritten,
  saveError,
  saveRef,
  scopedSessionWorkCommand,
  sessionWorkComparison,
  text,
  treeWithDerivedArtifactsFromCommit
} from "./sessionWorkGit.js";
import {
  assertConnectedSubmissionsIntegrated,
  assertConnectedWorkSnapshotsUnchanged,
  assertLocalAuthority,
  connectedWorkSnapshots,
  readCanonical,
  readContributionHead
} from "./sessionWorkAuthority.js";

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
    const published = await readContributionHead(runCommand, context, { commandOptions, project }, true);
    publishedCommit = published.head;
    if (!publishedCommit && knownSubmittedCommit) {
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(knownSubmittedCommit)) throw saveError(
        "The saved contribution evidence is invalid.", "vibe64_connected_integration_unknown");
      publishedCommit = knownSubmittedCommit;
    }
    if (published.discarded || (publishedCommit && published.remoteAbsent)) {
      const target = `refs/heads/${context.contribution.integrationBranch}`;
      const observed = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, target], { commandOptions, project });
      const [accepted, ref, extra] = observed.split(/\s+/u);
      if (ref !== target || extra || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(accepted) ||
          !await commitIsAncestor(runCommand, context, publishedCommit, accepted, { commandOptions, project })) {
        throw saveError("The removed contribution has not been proved integrated in this source. Check its receiving target and explicitly Update the connected session.",
          published.discarded ? "vibe64_contribution_discarded" : "vibe64_contribution_branch_missing");
      }
    }
    if (!publishedCommit && context.baseCommit !== context.contribution.baseCommit) throw saveError(
      "The pushed contribution branch is missing and no exact submitted revision is retained. Preserve the source and inspect its Save recovery evidence.",
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

function preparedSaveRef(context, operationId) {
  return saveRef(context, operationId, "prepared");
}

function saveCheckpointRef(context, operationId) {
  return checkpointRefs({
    outerTurnId: `save:${operationId}`,
    sessionId: context.sessionId
  }).turnRef;
}

async function rememberPreparedSaveCommit(runCommand, context, operationId, commit, options = {}) {
  const ref = preparedSaveRef(context, operationId);
  await git(runCommand, context, ["update-ref", ref, commit], options);
  return ref;
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

async function publishSaveCommit(runCommand, context, { canonicalCommit, contributionAuthority, saveCommit }, options) {
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
    ? contributionAuthority.publishedCommit
    : canonicalCommit;
  if (context.contribution) {
    if (contributionAuthority.missingPublished) throw saveError(
      "This contribution branch was removed after it was pushed. Preserve its source and submit further work as a new contribution.",
      "vibe64_contribution_branch_missing");
    const expected = contributionAuthority.remoteAbsent ? "" : contributionAuthority.publishedCommit;
    if ((await readContributionHead(runCommand, context, options)).head !== expected) {
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
    const remote = context.contribution ? (await readContributionHead(runCommand, context, options)).head : await gitOutput(
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
        "The saved branch changed while Save was pushing your changes. Update this session, then save again.",
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
    "Canonical repository verification did not return the commit Vibe64 pushed.",
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
  const [canonical, sessionHead] = await Promise.all([
    readCanonical(runCommand, context, operationId, { commandOptions, project }),
    gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
      commandOptions,
      project
    })
  ]);
  const canonicalCommit = canonical.commit;
  if (await savedHistoryRewritten(runCommand, context, canonicalCommit, sessionHead, { commandOptions, project })) {
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
  // The commit carries the identity the command env resolved; say so when it
  // was the stand-in, so the person can give Git their own name.
  const authorEmail = await gitOutput(runCommand, context, ["show", "-s", "--format=%ae", saveCommit], {
    commandOptions,
    project
  });
  return {
    canonicalCommit,
    changeBaseCommit: comparison.changeBaseCommit,
    changedPaths,
    contributionAuthority: canonical.contribution,
    mergedTree,
    preparedRef,
    saveCommit,
    standInIdentity: isFallbackGitIdentityEmail(authorEmail)
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
    {
      canonicalCommit: text(prepared.canonicalCommit),
      contributionAuthority: prepared.contributionAuthority,
      saveCommit: text(prepared.saveCommit)
    },
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
    standInIdentity: prepared.standInIdentity === true,
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
      await onProgress({ kind: "publish", message: "Pushing the Save commit.", stage: "publishing" });
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
      message: "Sending your changes.",
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
      "The interrupted Save stopped before a commit was durably prepared for pushing. Retry Save.",
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
    let canonical;
    try {
      canonical = await readCanonical(runCommand, context, operationId, { commandOptions, project });
    } catch (error) {
      if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) throw error;
      throw saveError(
        `Save publication is still unknown. Restore repository access and inspect work again. ${text(error.message)}`,
        "vibe64_session_save_publication_unknown"
      );
    }
    let authorityCommit = canonical.commit;
    if (authorityCommit === expectedCanonicalCommit && canonical.contribution?.publishedCommit !== proposedCommit) {
      throw saveError(
        "The interrupted Save did not push your changes. Retry Save when ready.",
        "vibe64_session_save_interrupted_retryable",
        { retryable: true }
      );
    }
    if (context.contribution) authorityCommit = canonical.contribution.publishedCommit;
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
  inspectSessionChangeDiff,
  inspectSessionChangeDiffDirect,
  inspectSessionChanges,
  inspectSessionChangesDirect,
  inspectSessionWork,
  inspectSessionWorkDirect,
  prepareSessionPullRequestBranch,
  prepareSessionWorkSaveMessage,
  prepareSessionWorkSaveMessageDirect,
  recoverSessionWorkSave,
  refreshSessionWorkSaveCacheDirect,
  saveSessionWork,
  saveSessionWorkDirect
};
