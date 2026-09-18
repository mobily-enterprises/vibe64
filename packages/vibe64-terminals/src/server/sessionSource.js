import path from "node:path";
import {
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm
} from "node:fs/promises";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeRepositoryMode,
  sessionRepositoryProject
} from "@local/vibe64-core/server/projectRepository";
import {
  managedSessionSourcePath,
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  githubMirrorRefreshInvocation,
  githubCredentialContext,
  normalizeGithubAccountMode,
  runVibe64Command
} from "@local/vibe64-execution/server";

const SESSION_BRANCH_PREFIX = "vibe64/";

function sourceError(message = "", code = "vibe64_session_source_failed") {
  return vibe64Error(message || "Vibe64 could not create the session source.", code);
}

async function runSourceCommand(command = "", args = [], {
  actor = "daemon",
  allowedRoots = [],
  credentialHome = null,
  cwd = "",
  gitAuthToken = "",
  gitTransport = "none",
  runCommand = runVibe64Command,
  userKey = ""
} = {}) {
  const githubTransport = gitTransport === "github-https" || gitTransport === "github-token";
  const result = await runCommand({
    actor,
    allowedRoots,
    args,
    command,
    ...(credentialHome ? { credentialHome } : {}),
    cwd,
    envPolicy: "project",
    ...(gitAuthToken ? { gitAuthToken } : {}),
    gitSafeDirectories: allowedRoots,
    gitTransport,
    mode: "capture",
    purpose: githubTransport ? "github" : "source",
    runtimes: gitTransport === "github-https" ? ["git", "gh"] : ["git"],
    timeout: 60_000,
    ...(userKey ? { userKey } : {})
  });
  if (result?.ok !== true) {
    throw sourceError(
      normalizeText(result?.stderr || result?.output || result?.error) || "A source command failed while creating the session source.",
      normalizeText(result?.code) || "vibe64_session_source_git_failed"
    );
  }
  return normalizeText(result.stdout || result.output);
}

function runGit(cwd = "", args = [], allowedRoots = [], options = {}) {
  return runSourceCommand("git", args, {
    ...options,
    allowedRoots,
    cwd
  });
}

async function githubSourceCommandOptions(vibe64User = null, env = process.env, {
  runCommand = runVibe64Command
} = {}) {
  const accountMode = normalizeGithubAccountMode(
    env?.[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  const context = githubCredentialContext({
    vibe64User
  }, {
    accountMode
  });
  if (context?.ok === false) {
    throw sourceError(
      context.error || "Connect GitHub before creating a session from this project.",
      context.code || "vibe64_session_source_github_credentials_required"
    );
  }
  if (accountMode === GITHUB_ACCOUNT_MODE_LOCAL) {
    return {
      actor: "daemon",
      credentialHome: {
        gid: context.gid,
        home: context.home,
        scope: context.scope,
        uid: context.uid,
        username: context.username
      },
      gitTransport: "github-https"
    };
  }
  const tokenResult = await runCommand({
    actor: "named-user",
    allowedRoots: [context.home],
    args: ["auth", "token"],
    command: "gh",
    cwd: context.home,
    envPolicy: "auth",
    gitTransport: "none",
    mode: "capture",
    project: {
      ownerUserKey: context.username
    },
    purpose: "github-api",
    runtimes: ["gh"],
    timeout: 60_000,
    userKey: context.username
  });
  const token = tokenResult?.ok === true ? normalizeText(tokenResult.stdout) : "";
  if (!token) {
    throw sourceError(
      normalizeText(tokenResult?.stderr || tokenResult?.error) ||
        "GitHub authentication is not ready for this Vibe64 account.",
      "vibe64_session_source_github_credentials_required"
    );
  }
  return {
    actor: "daemon",
    gitAuthToken: token,
    gitTransport: "github-token"
  };
}

async function optionalGitOutput(cwd = "", args = [], allowedRoots = [], options = {}) {
  try {
    return await runGit(cwd, args, allowedRoots, options);
  } catch {
    return "";
  }
}

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
    await runGit(standaloneSourceRoot, [
      "-c", "user.name=Vibe64",
      "-c", "user.email=vibe64@localhost",
      "commit", "--allow-empty", "-m", "Initial commit"
    ], roots, commandOptions);
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
  const repository = project?.repository && typeof project.repository === "object"
    ? project.repository
    : {};
  const mode = normalizeRepositoryMode(project.repositoryMode || repository.mode);
  const branch = normalizeText(repository.defaultBranch);
  if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    const github = project.githubRepository || repository.github || {};
    const remoteUrl = normalizeText(github.cloneUrl);
    if (!remoteUrl || !branch) {
      throw sourceError(
        "The GitHub project does not declare a complete canonical repository and default branch.",
        "vibe64_session_source_canonical_repository_missing"
      );
    }
    return {
      branch,
      mirrorPath: normalizeText(project.githubMirrorPath),
      mode,
      remoteUrl,
      source: remoteUrl
    };
  }
  if (mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    const repositoryPath = normalizeText(project.canonicalRepositoryPath);
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
  const resolvedMirrorPath = normalizeText(mirrorPath);
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
    .map(normalizeText)
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
  const expected = normalizeText(expectedCommit).toLowerCase();
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

async function attachSessionSource(store, sessionId = "", metadata = {}) {
  const write = async () => {
    await Promise.all(Object.entries(metadata).map(([name, value]) => (
      store.writeMetadataValue(sessionId, name, value)
    )));
  };
  return typeof store.mutateSession === "function"
    ? store.mutateSession(sessionId, write)
    : write();
}

async function createSessionSource({
  env = process.env,
  expectedCommit = "",
  project = {},
  runCommand = runVibe64Command,
  runtime,
  session = {},
  store,
  vibe64User = null
} = {}) {
  project = sessionRepositoryProject(project, session);
  const sessionId = normalizeText(session.sessionId || session.id);
  const projectContextRoot = normalizeText(runtime?.projectContextRoot);
  const managedSessionSourceRoot = normalizeText(runtime?.projectSessionSourceRoot);
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
    ? normalizeText(project.sourceRoot)
    : "";
  if (repositoryMode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE && !standaloneSourceRoot) {
    throw sourceError(
      "Standalone session creation requires the explicitly selected local source.",
      "vibe64_session_local_source_missing"
    );
  }
  const sourcePath = managedSessionSourcePath(managedSessionSourceRoot, sessionId);
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
  let baseline = canonical.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    ? await ensureLocalProjectBaseline(standaloneSourceRoot, {
        runCommand
      })
    : null;
  await mkdir(sourceParent, {
    recursive: true
  });

  const sourceRoots = [standaloneSourceRoot, canonical.source, sourceParent, sourcePath]
    .map(normalizeText)
    .filter((value) => path.isAbsolute(value));
  const existingTopLevel = await optionalGitOutput(sourcePath, ["rev-parse", "--show-toplevel"], sourceRoots, {
    runCommand
  });
  if (existingTopLevel && path.resolve(existingTopLevel) !== path.resolve(sourcePath)) {
    throw sourceError(
      `Session source path is already owned by another Git repository: ${sourcePath}`,
      "vibe64_session_source_path_conflict"
    );
  }
  if (!existingTopLevel) {
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
    } else {
      baseline = await cloneCanonicalSource({
        branch: canonical.branch,
        commandOptions: githubCommandOptions,
        expectedCommit,
        referenceRoot: cache.referenceRoot,
        source: canonical.source,
        sourceParent,
        sourcePath
      });
    }
  }
  const resolvedBaseline = baseline || {
    branch: canonical.branch,
    cacheReferenceUsed: false,
    commit: await runGit(sourcePath, ["rev-parse", "--verify", "HEAD"], sourceRoots, {
      runCommand
    }),
    remoteUrl: canonical.remoteUrl
  };
  resolvedBaseline.commit = await resolveExpectedSourceCommit({
    allowedRoots: sourceRoots,
    baselineCommit: resolvedBaseline.commit,
    commandOptions: {
      runCommand
    },
    expectedCommit,
    sourcePath
  });
  await runGit(sourcePath, ["checkout", "-B", branch, resolvedBaseline.commit], sourceRoots, {
    runCommand
  });
  if (normalizeText(expectedCommit)) {
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
  createSessionSource,
  githubSourceCommandOptions
};
