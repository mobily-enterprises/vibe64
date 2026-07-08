import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  normalizeText,
  pathExists
} from "./core.js";
import {
  readProjectRecordMetadata
} from "./projectBootstrapConfig.js";
import {
  resolveProjectGitCacheRoot
} from "./projectState.js";
import {
  VIBE64_PROJECT_MANIFEST_FILE,
  normalizeProjectManifest
} from "./projectManifest.js";

const execFileAsync = promisify(execFile);

const COMMITTED_PROJECT_TYPE_FIELD = "projectType";
const COMMITTED_PROJECT_CONFIG_VALUES_DIR = VIBE64_PROJECT_MANIFEST_FILE;
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
    projectType: normalizeText(configValues[COMMITTED_PROJECT_TYPE_FIELD]),
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

  const manifestPath = gitObjectPath(VIBE64_PROJECT_MANIFEST_FILE);
  const manifestText = await readGitFile({
    cwd,
    filePath: manifestPath,
    gitDir,
    ref
  });
  if (!manifestText) {
    return committedConfigUnavailable(
      "vibe64_committed_project_type_missing",
      "Committed vibe64.project.json is missing. Finish setup in a source session and commit the config.",
      {
        commit,
        gitDir,
        ref,
        sourceRoot,
        sourceType
      }
    );
  }
  const manifest = normalizeProjectManifest(JSON.parse(manifestText));
  if (!manifest.projectType) {
    return committedConfigUnavailable(
      "vibe64_committed_project_type_missing",
      "Committed vibe64.project.json is missing projectType. Finish setup in a source session and commit the config.",
      {
        commit,
        gitDir,
        ref,
        sourceRoot,
        sourceType
      }
    );
  }
  const configValues = Object.fromEntries([
    [COMMITTED_PROJECT_TYPE_FIELD, manifest.projectType],
    ...Object.entries(manifest.config || {})
  ].sort(([left], [right]) => left.localeCompare(right)));

  return committedConfigAvailable({
    commit,
    configRoot: manifestPath,
    configValues,
    gitDir,
    ref,
    sourceRoot,
    sourceType
  });
}

async function readCommittedProjectConfigFromSource({
  ref = "HEAD",
  readMode = "git",
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
  if (normalizeText(readMode) === "filesystem") {
    const manifestPath = path.join(resolvedSourceRoot, VIBE64_PROJECT_MANIFEST_FILE);
    if (!await pathExists(manifestPath)) {
      return committedConfigUnavailable(
        "vibe64_committed_project_type_missing",
        "Committed vibe64.project.json is missing. Finish setup in a source session and commit the config.",
        {
          configRoot: VIBE64_PROJECT_MANIFEST_FILE,
          ref: "",
          sourceRoot: resolvedSourceRoot,
          sourceType: "source-tree"
        }
      );
    }
    const manifest = normalizeProjectManifest(JSON.parse(await readFile(manifestPath, "utf8")));
    if (!manifest.projectType) {
      return committedConfigUnavailable(
        "vibe64_committed_project_type_missing",
        "Committed vibe64.project.json is missing projectType. Finish setup in a source session and commit the config.",
        {
          configRoot: VIBE64_PROJECT_MANIFEST_FILE,
          ref: "",
          sourceRoot: resolvedSourceRoot,
          sourceType: "source-tree"
        }
      );
    }
    const configValues = Object.fromEntries([
      [COMMITTED_PROJECT_TYPE_FIELD, manifest.projectType],
      ...Object.entries(manifest.config || {})
    ].sort(([left], [right]) => left.localeCompare(right)));
    return committedConfigAvailable({
      commit: "",
      configRoot: VIBE64_PROJECT_MANIFEST_FILE,
      configValues,
      ref: "",
      sourceRoot: resolvedSourceRoot,
      sourceType: "source-tree"
    });
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
  const defaultBranch = normalizeText(metadata?.repository?.defaultBranch || metadata?.repository?.github?.defaultBranch);
  return defaultBranch ? `refs/heads/${defaultBranch}` : "HEAD";
}

async function readCommittedProjectConfigFromGitCache({
  projectRecordPath = "",
  projectRuntimeRoot = "",
  ref = "",
  targetRoot = ""
} = {}) {
  const resolvedRuntimeRoot = normalizeText(projectRuntimeRoot)
    ? path.resolve(projectRuntimeRoot)
    : "";
  const resolvedTargetRoot = normalizeText(targetRoot)
    ? path.resolve(targetRoot)
    : "";
  const gitCacheRoot = normalizeText(projectRecordPath) && resolvedTargetRoot
    ? resolvedTargetRoot
    : resolvedRuntimeRoot;
  const gitCacheRepository = gitCacheRoot
    ? path.join(resolveProjectGitCacheRoot({
        projectRuntimeRoot: gitCacheRoot
      }), COMMITTED_PROJECT_CONFIG_GIT_CACHE_REPOSITORY)
    : "";
  if (!gitCacheRepository || !await pathExists(gitCacheRepository)) {
    return committedConfigUnavailable(
      "vibe64_committed_project_git_cache_missing",
      "Committed project config is unavailable because the project Git cache is missing.",
      {
        gitDir: gitCacheRepository,
        projectRuntimeRoot: resolvedRuntimeRoot,
        targetRoot: resolvedTargetRoot,
        sourceType: "git-cache"
      }
    );
  }
  const metadata = await readProjectRecordMetadata(projectRecordPath);
  const resolvedRef = normalizeText(ref) || committedProjectConfigRefFromMetadata(metadata);
  return readCommittedConfigFromGit({
    gitDir: gitCacheRepository,
    ref: resolvedRef,
    sourceType: "git-cache"
  });
}

async function readCommittedProjectConfig({
  projectRecordPath = "",
  projectRuntimeRoot = "",
  ref = "",
  sourceReadMode = "git",
  sourceRoot = "",
  targetRoot = ""
} = {}) {
  const resolvedSourceRoot = normalizeText(sourceRoot);
  if (resolvedSourceRoot) {
    return readCommittedProjectConfigFromSource({
      ref: ref || "HEAD",
      readMode: sourceReadMode,
      sourceRoot: resolvedSourceRoot
    });
  }
  return readCommittedProjectConfigFromGitCache({
    projectRecordPath,
    projectRuntimeRoot,
    ref,
    targetRoot
  });
}

export {
  COMMITTED_PROJECT_CONFIG_GIT_CACHE_REPOSITORY,
  COMMITTED_PROJECT_CONFIG_VALUES_DIR,
  COMMITTED_PROJECT_TYPE_FIELD,
  committedProjectConfigRefFromMetadata,
  readCommittedProjectConfig,
  readCommittedProjectConfigFromGitCache,
  readCommittedProjectConfigFromSource
};
