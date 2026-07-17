import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  isPlainObject,
  normalizeText,
  pathExists
} from "./core.js";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  readProjectRecordMetadata
} from "./projectBootstrapConfig.js";
import {
  resolveProjectGitCacheRoot
} from "./projectState.js";
import {
  VIBE64_PROJECT_MANIFEST_FILE,
  parseProjectManifestText
} from "./projectManifest.js";

const COMMITTED_PROJECT_TYPE_FIELD = "projectType";
const COMMITTED_PROJECT_CONFIG_VALUES_DIR = VIBE64_PROJECT_MANIFEST_FILE;
const COMMITTED_PROJECT_CONFIG_GIT_CACHE_REPOSITORY = "repository.git";
const VIBE64_COMMITTED_PROJECT_CONFIG_READER_SERVICE = "feature.vibe64-project.committed-config-reader";

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

function committedSourceRelativePath(relativePath = "") {
  const value = normalizeText(relativePath);
  const parts = value.split(/[\\/]+/u);
  if (
    !value ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    parts.includes("..")
  ) {
    const error = new Error(`Committed project source path must be relative: ${value || "(empty)"}.`);
    error.code = "vibe64_committed_project_source_path_invalid";
    throw error;
  }
  return gitObjectPath(value);
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
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const resolvedGitDir = gitDir ? path.resolve(gitDir) : "";
  const result = await runVibe64Command({
    actor: "daemon",
    allowedRoots: [
      resolvedCwd,
      resolvedGitDir
    ].filter(Boolean),
    args: gitArgs(args, {
      gitDir: resolvedGitDir
    }),
    command: "git",
    cwd: resolvedCwd,
    envPolicy: "project",
    gitSafeDirectories: [
      resolvedCwd,
      resolvedGitDir
    ].filter(Boolean),
    maxBuffer: 16 * 1024 * 1024,
    mode: "capture",
    purpose: "source-editor",
    runtimes: ["git"]
  });
  if (!result.ok) {
    const error = new Error(normalizeText(result.output || result.error) || "git failed.");
    error.code = result.code || "vibe64_committed_project_git_failed";
    error.stdout = result.stdout || "";
    error.stderr = result.stderr || "";
    throw error;
  }
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
  const normalizedPath = gitObjectPath(filePath);
  const treeEntry = normalizeText(await runGit([
    "ls-tree",
    "--name-only",
    ref,
    "--",
    normalizedPath
  ], {
    cwd,
    gitDir
  }));
  if (!treeEntry) {
    return null;
  }
  return runGit(["show", `${ref}:${normalizedPath}`], {
    cwd,
    gitDir
  });
}

function committedProjectManifestInvalid(message = "", extra = {}) {
  return committedConfigUnavailable(
    "vibe64_committed_project_manifest_invalid",
    message || "Committed vibe64.project.json is invalid.",
    extra
  );
}

function readCommittedProjectConfigFromText({
  commit = "",
  gitDir = "",
  manifestText = null,
  ref = "",
  sourceRoot = "",
  sourceType = ""
} = {}) {
  const common = {
    commit,
    configRoot: VIBE64_PROJECT_MANIFEST_FILE,
    gitDir,
    ref,
    sourceRoot,
    sourceType
  };
  if (manifestText === null || manifestText === undefined) {
    return committedConfigUnavailable(
      "vibe64_committed_project_type_missing",
      "Committed vibe64.project.json is missing. Choose the app type to configure this repository.",
      common
    );
  }

  let manifest;
  try {
    manifest = parseProjectManifestText(manifestText);
  } catch (error) {
    if (error?.code === "vibe64_project_manifest_object_required") {
      return committedProjectManifestInvalid(
        "Committed vibe64.project.json must contain a JSON object.",
        common
      );
    }
    if (error?.code === "vibe64_project_manifest_schema_unsupported") {
      return committedProjectManifestInvalid(
        "Committed vibe64.project.json uses an unsupported schema or schema version.",
        common
      );
    }
    return committedProjectManifestInvalid(
      "Committed vibe64.project.json contains invalid JSON. Repair and commit the file before opening this project.",
      common
    );
  }
  if (!manifest.projectType) {
    return committedProjectManifestInvalid(
      "Committed vibe64.project.json is missing projectType. Repair and commit the file before opening this project.",
      common
    );
  }
  const configValues = Object.fromEntries([
    [COMMITTED_PROJECT_TYPE_FIELD, manifest.projectType],
    ...Object.entries(manifest.config || {})
  ].sort(([left], [right]) => left.localeCompare(right)));

  return committedConfigAvailable({
    commit,
    configRoot: VIBE64_PROJECT_MANIFEST_FILE,
    configValues,
    gitDir,
    ref,
    sourceRoot,
    sourceType
  });
}

async function createCommittedGitSourceReader({
  committedConfig = {}
} = {}) {
  const gitDir = normalizeText(committedConfig.gitDir);
  const sourceRoot = normalizeText(committedConfig.sourceRoot);
  if (!gitDir && !sourceRoot) {
    const error = new Error("Committed Git source is unavailable for workflow inspection.");
    error.code = "vibe64_committed_project_source_unavailable";
    throw error;
  }

  const resolvedGitDir = gitDir ? path.resolve(gitDir) : "";
  const cwd = sourceRoot ? path.resolve(sourceRoot) : path.dirname(resolvedGitDir);
  const revision = normalizeText(committedConfig.commit || committedConfig.ref) || "HEAD";
  const treeOutput = await runGit([
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    revision
  ], {
    cwd,
    gitDir: resolvedGitDir
  });
  const paths = new Set(String(treeOutput || "").split("\0").filter(Boolean));
  return Object.freeze({
    exists(relativePath = "") {
      return paths.has(committedSourceRelativePath(relativePath));
    },
    async readText(relativePath = "") {
      const normalizedPath = committedSourceRelativePath(relativePath);
      if (!paths.has(normalizedPath)) {
        return null;
      }
      return runGit(["show", `${revision}:${normalizedPath}`], {
        cwd,
        gitDir: resolvedGitDir
      });
    }
  });
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
    try {
      const firstRef = normalizeText(await runGit([
        "for-each-ref",
        "--count=1",
        "--format=%(refname)"
      ], {
        cwd,
        gitDir
      }));
      if (!firstRef) {
        return readCommittedProjectConfigFromText({
          gitDir,
          manifestText: null,
          ref,
          sourceRoot,
          sourceType
        });
      }
    } catch {
      // The configured-ref error below is the actionable repository result.
    }
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
  let manifestText;
  try {
    manifestText = await readGitFile({
      cwd,
      filePath: manifestPath,
      gitDir,
      ref
    });
  } catch {
    return committedConfigUnavailable(
      "vibe64_committed_project_repository_unreadable",
      "Committed project config could not be read from the configured Git repository.",
      {
        commit,
        gitDir,
        ref,
        sourceRoot,
        sourceType
      }
    );
  }
  return readCommittedProjectConfigFromText({
    commit,
    gitDir,
    manifestText,
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
      return readCommittedProjectConfigFromText({
        manifestText: null,
        sourceRoot: resolvedSourceRoot,
        sourceType: "source-tree"
      });
    }
    return readCommittedProjectConfigFromText({
      manifestText: await readFile(manifestPath, "utf8"),
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
  const defaultBranch = normalizeText(metadata?.repository?.defaultBranch);
  if (!defaultBranch) {
    const error = new Error("Project repository metadata does not define a default branch.");
    error.code = "vibe64_committed_project_repository_metadata_invalid";
    throw error;
  }
  return `refs/heads/${defaultBranch}`;
}

async function readCommittedProjectConfigFromGitCache({
  metadata = null,
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
  const projectMetadata = isPlainObject(metadata)
    ? metadata
    : await readProjectRecordMetadata(projectRecordPath);
  const resolvedRef = normalizeText(ref) || committedProjectConfigRefFromMetadata(projectMetadata);
  return readCommittedConfigFromGit({
    gitDir: gitCacheRepository,
    ref: resolvedRef,
    sourceType: "git-cache"
  });
}

async function readCommittedProjectConfigFromRepositoryReader({
  committedProjectConfigReader = null,
  metadata = {},
  projectRecordPath = "",
  projectRuntimeRoot = "",
  ref = "",
  targetRoot = "",
  vibe64User = null
} = {}) {
  if (typeof committedProjectConfigReader?.readCommittedProjectConfig !== "function") {
    return null;
  }

  let result;
  try {
    result = await committedProjectConfigReader.readCommittedProjectConfig({
      metadata,
      projectRecordPath,
      projectRuntimeRoot,
      ref: normalizeText(ref) || committedProjectConfigRefFromMetadata(metadata),
      targetRoot,
      vibe64User
    });
  } catch (error) {
    if (normalizeText(error?.code).startsWith("vibe64_committed_project_")) {
      throw error;
    }
    const wrapped = new Error(
      `Committed project config could not be read from the repository: ${normalizeText(error?.message || error) || "repository read failed."}`
    );
    wrapped.code = "vibe64_committed_project_repository_unreadable";
    wrapped.cause = error;
    wrapped.details = {
      causeCode: normalizeText(error?.code),
      sourceType: "repository"
    };
    throw wrapped;
  }
  if (!result || result.handled !== true) {
    return null;
  }
  if (result.found !== false && typeof result.manifestText !== "string") {
    const error = new Error("Committed project repository reader returned no manifest contents.");
    error.code = "vibe64_committed_project_repository_unreadable";
    throw error;
  }
  return readCommittedProjectConfigFromText({
    commit: normalizeText(result.commit),
    manifestText: result.found === false ? null : result.manifestText,
    ref: normalizeText(result.ref),
    sourceType: normalizeText(result.sourceType) || "repository"
  });
}

async function readCommittedProjectConfig({
  committedProjectConfigReader = null,
  projectRecordPath = "",
  projectRuntimeRoot = "",
  ref = "",
  sourceReadMode = "git",
  sourceRoot = "",
  targetRoot = "",
  vibe64User = null
} = {}) {
  const resolvedSourceRoot = normalizeText(sourceRoot);
  if (resolvedSourceRoot) {
    return readCommittedProjectConfigFromSource({
      ref: ref || "HEAD",
      readMode: sourceReadMode,
      sourceRoot: resolvedSourceRoot
    });
  }
  const metadata = await readProjectRecordMetadata(projectRecordPath);
  const repositoryConfig = await readCommittedProjectConfigFromRepositoryReader({
    committedProjectConfigReader,
    metadata,
    projectRecordPath,
    projectRuntimeRoot,
    ref,
    targetRoot,
    vibe64User
  });
  if (repositoryConfig) {
    return repositoryConfig;
  }
  return readCommittedProjectConfigFromGitCache({
    metadata,
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
  VIBE64_COMMITTED_PROJECT_CONFIG_READER_SERVICE,
  committedProjectConfigRefFromMetadata,
  createCommittedGitSourceReader,
  readCommittedProjectConfig,
  readCommittedProjectConfigFromGitCache,
  readCommittedProjectConfigFromText,
  readCommittedProjectConfigFromSource
};
