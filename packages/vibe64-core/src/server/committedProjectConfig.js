import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  normalizeText,
  pathExists
} from "./core.js";
import {
  readOnlineProjectMetadata
} from "./projectBootstrapConfig.js";
import {
  resolveProjectGitCacheRoot
} from "./projectState.js";
import {
  VIBE64_PROJECT_SHARED_DIR
} from "./studioRoots.js";

const execFileAsync = promisify(execFile);

const COMMITTED_PROJECT_CONFIG_FILE = "project_type";
const COMMITTED_PROJECT_CONFIG_VALUES_DIR = "config";
const COMMITTED_PROJECT_CONFIG_GIT_CACHE_REPOSITORY = "repository.git";

function committedConfigUnavailable(code, message, extra = {}) {
  return Object.freeze({
    available: false,
    code,
    configValues: {},
    message,
    ok: false,
    projectType: "",
    ...extra
  });
}

function committedConfigAvailable({
  commit = "",
  configRoot = "",
  configValues = {},
  gitDir = "",
  ref = "",
  sourceRoot = "",
  sourceType = ""
} = {}) {
  return Object.freeze({
    available: true,
    code: "",
    commit,
    configRoot,
    configValues,
    gitDir,
    message: "",
    ok: true,
    projectType: normalizeText(configValues[COMMITTED_PROJECT_CONFIG_FILE]),
    ref,
    sourceRoot,
    sourceType
  });
}

function gitObjectPath(relativePath = "") {
  return String(relativePath || "")
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join("/");
}

function gitArgs(args = [], {
  gitDir = ""
} = {}) {
  return gitDir
    ? [`--git-dir=${path.resolve(gitDir)}`, ...args]
    : args;
}

async function runGit(args = [], {
  cwd = "",
  gitDir = ""
} = {}) {
  const result = await execFileAsync("git", gitArgs(args, {
    gitDir
  }), {
    cwd: cwd || process.cwd(),
    maxBuffer: 16 * 1024 * 1024
  });
  return result.stdout;
}

async function resolveGitCommit({
  cwd = "",
  gitDir = "",
  ref = "HEAD"
} = {}) {
  const normalizedRef = normalizeText(ref) || "HEAD";
  return normalizeText(await runGit(["rev-parse", "--verify", `${normalizedRef}^{commit}`], {
    cwd,
    gitDir
  }));
}

async function readGitFile({
  cwd = "",
  filePath = "",
  gitDir = "",
  ref = "HEAD"
} = {}) {
  try {
    return await runGit(["show", `${ref}:${gitObjectPath(filePath)}`], {
      cwd,
      gitDir
    });
  } catch {
    return null;
  }
}

async function listGitFiles({
  cwd = "",
  gitDir = "",
  pathspec = "",
  ref = "HEAD"
} = {}) {
  const output = await runGit(["ls-tree", "-r", "-z", "--name-only", ref, "--", gitObjectPath(pathspec)], {
    cwd,
    gitDir
  });
  return output.split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

async function readCommittedConfigFromGit({
  cwd = "",
  gitDir = "",
  ref = "HEAD",
  sourceRoot = "",
  sourceType = ""
} = {}) {
  let commit = "";
  try {
    commit = await resolveGitCommit({
      cwd,
      gitDir,
      ref
    });
  } catch {
    return committedConfigUnavailable(
      "vibe64_committed_project_git_ref_unavailable",
      "Committed project config could not be read because the configured Git ref is unavailable.",
      {
        gitDir,
        ref,
        sourceRoot,
        sourceType
      }
    );
  }

  const projectTypePath = gitObjectPath(path.join(
    VIBE64_PROJECT_SHARED_DIR,
    COMMITTED_PROJECT_CONFIG_FILE
  ));
  const projectType = normalizeText(await readGitFile({
    cwd,
    filePath: projectTypePath,
    gitDir,
    ref
  }));
  if (!projectType) {
    return committedConfigUnavailable(
      "vibe64_committed_project_type_missing",
      "Committed .vibe64/project_type is missing. Finish setup in a source session and commit the config.",
      {
        commit,
        gitDir,
        ref,
        sourceRoot,
        sourceType
      }
    );
  }

  const configRoot = gitObjectPath(path.join(
    VIBE64_PROJECT_SHARED_DIR,
    COMMITTED_PROJECT_CONFIG_VALUES_DIR
  ));
  const configFiles = await listGitFiles({
    cwd,
    gitDir,
    pathspec: configRoot,
    ref
  });
  const configEntries = await Promise.all(configFiles.map(async (filePath) => {
    const relative = path.posix.relative(configRoot, gitObjectPath(filePath));
    if (!relative || relative.startsWith("../") || relative.includes("/")) {
      return null;
    }
    const value = await readGitFile({
      cwd,
      filePath,
      gitDir,
      ref
    });
    return [relative, normalizeText(value)];
  }));
  const configValues = Object.fromEntries([
    [COMMITTED_PROJECT_CONFIG_FILE, projectType],
    ...configEntries.filter(Boolean)
  ].sort(([left], [right]) => left.localeCompare(right)));

  return committedConfigAvailable({
    commit,
    configRoot,
    configValues,
    gitDir,
    ref,
    sourceRoot,
    sourceType
  });
}

async function readCommittedProjectConfigFromSource({
  ref = "HEAD",
  sourceRoot = ""
} = {}) {
  const resolvedSourceRoot = normalizeText(sourceRoot)
    ? path.resolve(sourceRoot)
    : "";
  if (!resolvedSourceRoot || !await pathExists(resolvedSourceRoot)) {
    return committedConfigUnavailable(
      "vibe64_committed_project_source_missing",
      "Committed project config requires an existing source root.",
      {
        ref,
        sourceRoot: resolvedSourceRoot,
        sourceType: "source"
      }
    );
  }
  return readCommittedConfigFromGit({
    cwd: resolvedSourceRoot,
    ref,
    sourceRoot: resolvedSourceRoot,
    sourceType: "source"
  });
}

function committedProjectConfigRefFromMetadata(metadata = {}) {
  const explicitRef = normalizeText(metadata?.committedConfigRef || metadata?.sourceRef || metadata?.gitRef);
  if (explicitRef) {
    return explicitRef;
  }
  const defaultBranch = normalizeText(metadata?.githubRepository?.defaultBranch);
  return defaultBranch ? `refs/heads/${defaultBranch}` : "HEAD";
}

async function readCommittedProjectConfigFromGitCache({
  onlineProjectRecordPath = "",
  projectRuntimeRoot = "",
  ref = ""
} = {}) {
  const resolvedRuntimeRoot = normalizeText(projectRuntimeRoot)
    ? path.resolve(projectRuntimeRoot)
    : "";
  const gitCacheRepository = resolvedRuntimeRoot
    ? path.join(resolveProjectGitCacheRoot({
        projectRuntimeRoot: resolvedRuntimeRoot
      }), COMMITTED_PROJECT_CONFIG_GIT_CACHE_REPOSITORY)
    : "";
  if (!gitCacheRepository || !await pathExists(gitCacheRepository)) {
    return committedConfigUnavailable(
      "vibe64_committed_project_git_cache_missing",
      "Committed project config is unavailable because the project Git cache is missing.",
      {
        gitDir: gitCacheRepository,
        projectRuntimeRoot: resolvedRuntimeRoot,
        sourceType: "git-cache"
      }
    );
  }
  const metadata = await readOnlineProjectMetadata(onlineProjectRecordPath);
  const resolvedRef = normalizeText(ref) || committedProjectConfigRefFromMetadata(metadata);
  return readCommittedConfigFromGit({
    gitDir: gitCacheRepository,
    ref: resolvedRef,
    sourceType: "git-cache"
  });
}

async function readCommittedProjectConfig({
  onlineProjectRecordPath = "",
  projectRuntimeRoot = "",
  ref = "",
  sourceRoot = ""
} = {}) {
  const resolvedSourceRoot = normalizeText(sourceRoot);
  if (resolvedSourceRoot) {
    return readCommittedProjectConfigFromSource({
      ref: ref || "HEAD",
      sourceRoot: resolvedSourceRoot
    });
  }
  return readCommittedProjectConfigFromGitCache({
    onlineProjectRecordPath,
    projectRuntimeRoot,
    ref
  });
}

export {
  COMMITTED_PROJECT_CONFIG_FILE,
  COMMITTED_PROJECT_CONFIG_GIT_CACHE_REPOSITORY,
  COMMITTED_PROJECT_CONFIG_VALUES_DIR,
  committedProjectConfigRefFromMetadata,
  readCommittedProjectConfig,
  readCommittedProjectConfigFromGitCache,
  readCommittedProjectConfigFromSource
};
