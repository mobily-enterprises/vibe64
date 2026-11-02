import path from "node:path";
import {
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm
} from "node:fs/promises";

import { pathExists } from "@local/vibe64-core/server/core";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeRepositoryMode,
  sessionConnectedContribution,
  sessionRepositoryProject
} from "@local/vibe64-core/server/projectRepository";
import {
  managedSessionSourcePath,
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { githubMirrorRefreshInvocation, runVibe64Command } from "@local/vibe64-execution/server";
import {
  githubSourceCommandOptions,
  optionalGitOutput,
  runGit,
  runSourceCommand,
  sourceError
} from "./sessionSourceCommands.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

const SESSION_BRANCH_PREFIX = "vibe64/";

async function ensureLocalProjectBaseline(standaloneSourceRoot = "", commandOptions = {}) {
  const roots = [standaloneSourceRoot];
  const gitDirectory = await optionalGitOutput(standaloneSourceRoot, ["rev-parse", "--git-dir"], roots, commandOptions);
  if (!gitDirectory) {
    await runGit(standaloneSourceRoot, ["init", "--initial-branch=main"], roots, commandOptions);
  }
  let branch = await optionalGitOutput(standaloneSourceRoot, ["branch", "--show-current"], roots, commandOptions) || "main";
  let commit = await optionalGitOutput(standaloneSourceRoot, ["rev-parse", "--verify", "HEAD"], roots, commandOptions);
  if (!commit) {
    await runGit(standaloneSourceRoot, ["add", "-A"], roots, commandOptions);
    await runGit(standaloneSourceRoot, ["commit", "--allow-empty", "-m", "Initial commit"], roots, commandOptions);
    commit = await runGit(standaloneSourceRoot, ["rev-parse", "--verify", "HEAD"], roots, commandOptions);
    branch = await optionalGitOutput(standaloneSourceRoot, ["branch", "--show-current"], roots, commandOptions) || branch;
  }
  const dirty = await runGit(standaloneSourceRoot, ["status", "--porcelain"], roots, commandOptions);
  if (dirty) {
    throw sourceError(
      "The project source has uncommitted changes. Save or discard them before starting a session so its source has an exact Git baseline.",
      "vibe64_session_source_project_dirty"
    );
  }
  return {
    branch,
    commit,
    remoteUrl: await optionalGitOutput(standaloneSourceRoot, ["remote", "get-url", "origin"], roots, commandOptions)
  };
}

function canonicalProjectSource(project = {}, standaloneSourceRoot = "") {
  const repository = project.repository && typeof project.repository === "object"
    ? project.repository
    : {};
  const mode = normalizeRepositoryMode(project.repositoryMode || repository.mode);
  const branch = toText(repository.defaultBranch);
  if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    const github = project.githubRepository || repository.github || {};
    const remoteUrl = toText(github.cloneUrl);
    if (!remoteUrl || !branch) {
      throw sourceError(
        "The GitHub project does not declare a complete canonical repository and default branch.",
        "vibe64_session_source_canonical_repository_missing"
      );
    }
    return {
      branch,
      mirrorPath: toText(project.githubMirrorPath),
      mode,
      remoteUrl,
      source: remoteUrl
    };
  }
  if (mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    const repositoryPath = toText(project.canonicalRepositoryPath);
    if (!repositoryPath || !branch) {
      throw sourceError(
        "The Vibe64 Git project does not declare a complete canonical repository and default branch.",
        "vibe64_session_source_canonical_repository_missing"
      );
    }
    return {
      branch,
      mode,
      remoteUrl: repositoryPath,
      source: repositoryPath
    };
  }
  if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    if (!standaloneSourceRoot) {
      throw sourceError(
        "The standalone project does not declare its local source folder.",
        "vibe64_session_source_local_root_missing"
      );
    }
    return {
      mode,
      source: standaloneSourceRoot
    };
  }
  throw sourceError(
    "The project does not declare whether its canonical source is GitHub, Vibe64 Git, or local source.",
    "vibe64_session_source_repository_mode_missing"
  );
}

async function prepareGithubMirrorReference({
  commandOptions = {},
  mirrorPath = "",
  remoteUrl = ""
} = {}) {
  const resolvedMirrorPath = toText(mirrorPath);
  const outcome = {
    attempted: Boolean(resolvedMirrorPath),
    referenceRoot: "",
    refresh: resolvedMirrorPath ? "failed" : "unavailable"
  };
  if (!resolvedMirrorPath || !path.isAbsolute(resolvedMirrorPath)) {
    return outcome;
  }
  const mirrorParent = path.dirname(resolvedMirrorPath);
  const runtimeRoot = path.dirname(mirrorParent);
  if (
    path.basename(resolvedMirrorPath) !== "repository.git" ||
    path.basename(mirrorParent) !== "github-mirror"
  ) {
    return outcome;
  }

  try {
    await mkdir(runtimeRoot, {
      recursive: true
    });
    const [command, ...args] = githubMirrorRefreshInvocation({
      mirrorPath: resolvedMirrorPath,
      remoteUrl
    });
    await runSourceCommand(command, args, {
      ...commandOptions,
      allowedRoots: [runtimeRoot, mirrorParent, resolvedMirrorPath],
      cwd: runtimeRoot
    });
    outcome.refresh = "refreshed";
  } catch {
    // The mirror is disposable acceleration. Authority remains the remote URL.
  }

  if (await githubMirrorCanReference({
    mirrorPath: resolvedMirrorPath,
    remoteUrl,
    runCommand: commandOptions.runCommand
  })) {
    outcome.referenceRoot = resolvedMirrorPath;
  }
  return outcome;
}

async function githubMirrorCanReference({
  mirrorPath = "",
  remoteUrl = "",
  runCommand = runVibe64Command
} = {}) {
  try {
    const mirrorParent = path.dirname(mirrorPath);
    const [mirrorStat, parentStat] = await Promise.all([
      lstat(mirrorPath),
      lstat(mirrorParent)
    ]);
    if (mirrorStat.isSymbolicLink() || parentStat.isSymbolicLink()) {
      return false;
    }
    const roots = [path.dirname(mirrorParent), mirrorParent, mirrorPath];
    const [bare, origin] = await Promise.all([
      optionalGitOutput(path.dirname(mirrorParent), [
        "--git-dir", mirrorPath,
        "rev-parse", "--is-bare-repository"
      ], roots, { runCommand }),
      optionalGitOutput(path.dirname(mirrorParent), [
        "--git-dir", mirrorPath,
        "remote", "get-url", "origin"
      ], roots, { runCommand })
    ]);
    return bare === "true" && origin === remoteUrl;
  } catch {
    return false;
  }
}

async function cloneCanonicalSource({
  branch = "",
  commandOptions = {},
  expectedCommit = "",
  referenceRoot = "",
  source = "",
  sourceParent = "",
  sourcePath = ""
} = {}) {
  const preparationRoot = await mkdtemp(path.join(sourceParent, ".vibe64-source-preparing-"));
  const preparedSourcePath = path.join(preparationRoot, "source");
  const roots = [referenceRoot, source, sourceParent, sourcePath, preparationRoot, preparedSourcePath]
    .map(toText)
    .filter((value) => path.isAbsolute(value));
  const localCommandOptions = {
    runCommand: commandOptions.runCommand
  };
  let cacheReferenceUsed = Boolean(referenceRoot);
  const clone = (cloneReferenceRoot = "") => runGit(preparationRoot, [
    "clone",
    "--no-hardlinks",
    ...(cloneReferenceRoot ? ["--reference", cloneReferenceRoot] : []),
    "--single-branch",
    "--branch", branch,
    source,
    preparedSourcePath
  ], roots, commandOptions);
  try {
    try {
      await clone(referenceRoot);
      if (referenceRoot) {
        const alternatesPath = path.join(preparedSourcePath, ".git", "objects", "info", "alternates");
        if (!await pathExists(alternatesPath)) {
          cacheReferenceUsed = false;
        } else {
          await runGit(preparedSourcePath, ["repack", "-a", "-d"], roots, localCommandOptions);
          await rm(alternatesPath);
          await runGit(preparedSourcePath, [
            "fsck",
            "--connectivity-only",
            "--no-dangling",
            "--no-progress"
          ], roots, localCommandOptions);
        }
      }
    } catch (error) {
      await rm(preparedSourcePath, {
        force: true,
        recursive: true
      });
      if (!referenceRoot) {
        throw error;
      }
      cacheReferenceUsed = false;
      await clone();
    }

    const alternatesPath = path.join(preparedSourcePath, ".git", "objects", "info", "alternates");
    if (await pathExists(alternatesPath)) {
      throw sourceError(
        "The session checkout retained a dependency on disposable Git object storage.",
        "vibe64_session_source_cache_not_dissociated"
      );
    }
    const canonicalCommit = await runGit(
      preparedSourcePath,
      ["rev-parse", "--verify", "HEAD^{commit}"],
      roots,
      localCommandOptions
    );
    const commit = await resolveExpectedSourceCommit({
      allowedRoots: roots,
      baselineCommit: canonicalCommit,
      commandOptions: localCommandOptions,
      expectedCommit,
      sourcePath: preparedSourcePath
    });
    await rename(preparedSourcePath, sourcePath);
    return {
      branch,
      cacheReferenceUsed,
      commit,
      remoteUrl: source
    };
  } finally {
    await rm(preparationRoot, {
      force: true,
      recursive: true
    });
  }
}

async function resolveExpectedSourceCommit({
  allowedRoots = [],
  baselineCommit = "",
  commandOptions = {},
  expectedCommit = "",
  sourcePath = ""
} = {}) {
  const expected = toText(expectedCommit).toLowerCase();
  if (!expected) {
    return baselineCommit;
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(expected)) {
    throw sourceError(
      "The frozen renewal source commit is not a complete Git object id.",
      "vibe64_session_source_expected_commit_invalid"
    );
  }

  let resolved = "";
  try {
    resolved = await runGit(
      sourcePath,
      ["rev-parse", "--verify", `${expected}^{commit}`],
      allowedRoots,
      commandOptions
    );
    await runGit(
      sourcePath,
      ["merge-base", "--is-ancestor", resolved, baselineCommit],
      allowedRoots,
      commandOptions
    );
  } catch {
    throw sourceError(
      "The frozen renewal source commit is not available from the configured authority branch.",
      "vibe64_session_source_expected_commit_unavailable"
    );
  }
  if (resolved !== expected) {
    throw sourceError(
      "The frozen renewal source commit did not resolve to the exact requested object.",
      "vibe64_session_source_expected_commit_mismatch"
    );
  }
  return resolved;
}

/**
 * The clone leaves a local copy of the branch it cloned. Nothing advances that
 * copy, so it soon trails the authority and misleads people and assistants in
 * the session; session work, Save and Update use the session branch, recorded
 * commits and explicit remote refs instead. Git proves the copy can go only
 * when HEAD is the session branch and every commit on it is also on
 * origin/<branch> or the recorded baseline: then this returns its objectId.
 * Otherwise the outcome says why it stays. Source creation and the one-time
 * upgrade of existing sessions both decide with this proof; git runs one Git
 * command in the session source, and a Git failure throws.
 */
async function clonedDefaultBranchProof(git, options = {}) {
  const {
    baselineCommit = "",
    clonedBranch = "",
    sessionBranch = ""
  } = options;
  const localRef = `refs/heads/${clonedBranch}`;
  const head = await git(["rev-parse", "--symbolic-full-name", "HEAD"]);
  if (head === "HEAD") return { outcome: "kept_head_detached" };
  if (head === localRef) return { outcome: "kept_head_on_default" };
  if (head !== `refs/heads/${sessionBranch}`) return { outcome: "kept_session_branch_not_checked_out" };
  const trackingRef = `refs/remotes/origin/${clonedBranch}`;
  // A pattern also matches refs below it, so only exact names are read.
  const refs = new Map((await git(["for-each-ref", "--format=%(refname) %(objectname)", localRef, trackingRef]))
    .split("\n").filter(Boolean).map((line) => line.split(" ")));
  if (!refs.has(localRef)) return { outcome: "absent" };
  const unpublished = await git([
    "rev-list", "--count", refs.get(localRef),
    "--not", baselineCommit, ...(refs.has(trackingRef) ? [refs.get(trackingRef)] : [])
  ]);
  if (unpublished !== "0") return { outcome: "kept_unpublished_commits" };
  return { objectId: refs.get(localRef) };
}

/**
 * -d makes Git refuse again unless the copy is merged into its upstream (or
 * HEAD); it also removes the copy's branch.<name>.* configuration.
 */
function deleteClonedDefaultBranch(git, clonedBranch = "") {
  return git(["branch", "-d", "--", clonedBranch]);
}

/**
 * The new clone is not attached yet, so nothing else moves its refs. This is
 * local-only and best effort: a failed step leaves the copy, as before, rather
 * than blocking a source that could then not be created again.
 */
async function removeClonedDefaultBranch({
  allowedRoots = [],
  baselineCommit = "",
  clonedBranch = "",
  commandOptions = {},
  sessionBranch = "",
  sourcePath = ""
} = {}) {
  const git = (args) => runGit(sourcePath, args, allowedRoots, commandOptions);
  try {
    const proof = await clonedDefaultBranchProof(git, { baselineCommit, clonedBranch, sessionBranch });
    if (!proof.objectId) return proof.outcome;
    await deleteClonedDefaultBranch(git, clonedBranch);
    return "removed";
  } catch (error) {
    vibe64SessionDebugLog("server.sessionSource.cloned_branch.removal_failed", {
      clonedBranch,
      error: vibe64SessionDebugError(error),
      sessionBranch
    });
    return "git_failed";
  }
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object} [metadata]
 */
async function attachSessionSource(store, sessionId = "", metadata = {}) {
  const write = async () => {
    await Promise.all(Object.entries(metadata).map(([name, value]) => (
      store.writeMetadataValue(sessionId, name, value)
    )));
  };
  return store.mutateSession(sessionId, write);
}

/**
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env
 * @param {string} [dependencies.expectedCommit]
 * @param {string} [dependencies.expectedSourceRef]
 * @param {object} [dependencies.project] the current project's record
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 * @param {Vibe64SessionRuntime} dependencies.runtime
 * @param {object} [dependencies.session]
 * @param {Vibe64SessionStore} dependencies.store
 * @param {object | null} [dependencies.vibe64User]
 */
async function createSessionSource({
  env,
  expectedCommit = "",
  expectedSourceRef = "",
  project = {},
  runCommand = runVibe64Command,
  runtime,
  session = {},
  store,
  vibe64User = null
}) {
  const contribution = sessionConnectedContribution(session);
  if (contribution && !session.metadata?.renewed_from) {
    if (expectedCommit && toText(expectedCommit).toLowerCase() !== contribution.baseCommit) {
      throw sourceError("Contribution source must start at its reserved base commit.", "vibe64_contribution_base_changed");
    }
    expectedCommit = contribution.baseCommit;
  }
  project = sessionRepositoryProject(project, session, { sourcePreparation: true });
  if (contribution && session.metadata?.renewed_from) {
    const allowedRefs = new Set([
      `refs/heads/${contribution.integrationBranch}`,
      `refs/heads/vibe64-incoming/${contribution.id}`,
      ...(contribution.replaces ? [`refs/heads/vibe64-incoming/${contribution.replaces}_discarded`] : [])
    ]);
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(expectedCommit) || !allowedRefs.has(expectedSourceRef)) {
      throw sourceError(
        "Contribution renewal requires its exact confirmed source commit and owned ref.",
        "vibe64_contribution_renewal_source_invalid"
      );
    }
    project = {
      ...project,
      repository: {
        ...project.repository,
        defaultBranch: expectedSourceRef.slice("refs/heads/".length)
      }
    };
  } else if (contribution && expectedSourceRef) {
    throw sourceError(
      "Only a confirmed renewal can select a contribution source ref.",
      "vibe64_contribution_renewal_source_invalid"
    );
  }
  const sessionId = toText(session.sessionId);
  const projectContextRoot = toText(runtime?.projectContextRoot);
  const managedSessionSourceRoot = toText(runtime?.projectSessionSourceRoot);
  if (!sessionId || !projectContextRoot || !managedSessionSourceRoot || !store) {
    throw sourceError(
      "Session source creation requires a session id, project context root, managed source root, and session store.",
      "vibe64_session_source_context_missing"
    );
  }
  if (!path.isAbsolute(projectContextRoot) || !path.isAbsolute(managedSessionSourceRoot)) {
    throw sourceError(
      "Session source creation requires absolute project-context and managed-source paths.",
      "vibe64_session_source_path_invalid"
    );
  }
  if (!await pathExists(projectContextRoot)) {
    throw sourceError(
      `Project context root does not exist: ${projectContextRoot}`,
      "vibe64_session_project_context_missing"
    );
  }

  const repositoryMode = normalizeRepositoryMode(project.repositoryMode || project.repository?.mode);
  const standaloneSourceRoot = repositoryMode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    ? toText(project.sourceRoot)
    : "";
  if (repositoryMode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE && !standaloneSourceRoot) {
    throw sourceError(
      "Standalone session creation requires the explicitly selected local source.",
      "vibe64_session_local_source_missing"
    );
  }
  const sourcePath = managedSessionSourcePath(managedSessionSourceRoot, sessionId);
  // Creation must never double as recovery: even an unattached checkout can
  // contain work left by an interrupted preparation or another writer.
  const existingSource = await lstat(sourcePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existingSource) {
    throw sourceError(
      "This session source already exists. Reopen the existing session, or inspect its recovery details before preparing source again. Existing work has been preserved.",
      "vibe64_session_source_exists"
    );
  }
  const sourceParent = path.dirname(sourcePath);
  const branch = `${SESSION_BRANCH_PREFIX}${sessionId}`;
  const canonical = canonicalProjectSource(project, standaloneSourceRoot);
  const githubCommandOptions = canonical.mode === PROJECT_REPOSITORY_MODE_GITHUB
    ? {
        ...await githubSourceCommandOptions(vibe64User, env, {
          runCommand
        }),
        runCommand
      }
    : {
        runCommand
      };
  const cache = canonical.mode === PROJECT_REPOSITORY_MODE_GITHUB
    ? await prepareGithubMirrorReference({
      commandOptions: githubCommandOptions,
      mirrorPath: canonical.mirrorPath,
      remoteUrl: canonical.source
    })
    : {
        attempted: false,
        referenceRoot: "",
        refresh: "not_applicable"
      };
  const baseline = canonical.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    ? await ensureLocalProjectBaseline(standaloneSourceRoot, {
      runCommand
    })
    : null;
  await mkdir(sourceParent, {
    recursive: true
  });

  const sourceRoots = [standaloneSourceRoot, canonical.source, sourceParent, sourcePath]
    .map(toText)
    .filter((value) => path.isAbsolute(value));
  const existingTopLevel = await optionalGitOutput(sourcePath, ["rev-parse", "--show-toplevel"], sourceRoots, {
    runCommand
  });
  // The path appeared after the lstat check above: never adopt it.
  if (existingTopLevel) {
    throw path.resolve(existingTopLevel) === path.resolve(sourcePath)
      ? sourceError(
        "The session source appeared during creation. Existing work has been preserved; inspect its owner before retrying.",
        "vibe64_session_source_exists"
      )
      : sourceError(
        `Session source path is already owned by another Git repository: ${sourcePath}`,
        "vibe64_session_source_path_conflict"
      );
  }
  let resolvedBaseline;
  if (canonical.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    await runGit(sourceParent, [
      "clone",
      "--no-hardlinks",
      "--single-branch",
      "--branch", baseline.branch,
      standaloneSourceRoot,
      sourcePath
    ], sourceRoots, {
      runCommand
    });
    resolvedBaseline = {
      ...baseline,
      commit: await resolveExpectedSourceCommit({
        allowedRoots: sourceRoots,
        baselineCommit: baseline.commit,
        commandOptions: {
          runCommand
        },
        expectedCommit,
        sourcePath
      })
    };
  } else {
    // The clone already resolved and verified any expected commit.
    resolvedBaseline = await cloneCanonicalSource({
      branch: canonical.branch,
      commandOptions: githubCommandOptions,
      expectedCommit,
      referenceRoot: cache.referenceRoot,
      source: canonical.source,
      sourceParent,
      sourcePath
    });
  }
  await runGit(sourcePath, ["checkout", "-B", branch, resolvedBaseline.commit], sourceRoots, {
    runCommand
  });
  if (toText(expectedCommit)) {
    const checkedOutCommit = await runGit(
      sourcePath,
      ["rev-parse", "--verify", "HEAD^{commit}"],
      sourceRoots,
      { runCommand }
    );
    if (checkedOutCommit !== resolvedBaseline.commit) {
      throw sourceError(
        "The renewal session source did not check out the exact frozen commit.",
        "vibe64_session_source_expected_commit_mismatch"
      );
    }
  }
  const defaultBranchLocal = await removeClonedDefaultBranch({
    allowedRoots: sourceRoots,
    baselineCommit: resolvedBaseline.commit,
    clonedBranch: resolvedBaseline.branch,
    commandOptions: { runCommand },
    sessionBranch: branch,
    sourcePath
  });
  if (resolvedBaseline.remoteUrl) {
    await runGit(sourcePath, ["remote", "set-url", "origin", resolvedBaseline.remoteUrl], sourceRoots, {
      runCommand
    });
  }
  await attachSessionSource(store, sessionId, {
    base_branch: resolvedBaseline.branch,
    ...(canonical.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE ? { local_source_branch: resolvedBaseline.branch } : {}),
    base_commit: resolvedBaseline.commit,
    canonical_commit: resolvedBaseline.commit,
    branch,
    repository_mode: canonical.mode,
    source_default_branch: resolvedBaseline.branch,
    source_default_branch_local: defaultBranchLocal,
    source_kind: "session_clone",
    source_cache_attempted: cache.attempted ? "yes" : "no",
    source_cache_kind: canonical.mode === PROJECT_REPOSITORY_MODE_GITHUB ? "github_mirror" : "none",
    source_cache_reference: resolvedBaseline.cacheReferenceUsed ? "used" : "not_used",
    source_cache_refresh: cache.refresh,
    source_path: sourcePath,
    source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
    source_remote_url: resolvedBaseline.remoteUrl
  });
  return {
    branch,
    commit: resolvedBaseline.commit,
    ok: true,
    sourcePath
  };
}

export {
  canonicalProjectSource,
  clonedDefaultBranchProof,
  createSessionSource,
  deleteClonedDefaultBranch,
  githubSourceCommandOptions,
  prepareGithubMirrorReference,
  runGit
};
