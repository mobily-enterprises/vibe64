import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  normalizeTargetRoot,
  normalizeText
} from "./core.js";

const PROJECT_SLUG_MAX_LENGTH = 48;
const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;

function normalizeProjectSlug(value = "") {
  const slug = String(value || "").trim();
  if (!PROJECT_SLUG_PATTERN.test(slug)) {
    const error = new Error("Project slug must start with a lowercase letter or number and contain only lowercase letters, numbers, underscores, or dashes.");
    error.code = "vibe64_invalid_project_slug";
    throw error;
  }
  if (slug.length > PROJECT_SLUG_MAX_LENGTH) {
    const error = new Error(`Project slug must be ${PROJECT_SLUG_MAX_LENGTH} characters or fewer.`);
    error.code = "vibe64_invalid_project_slug";
    throw error;
  }
  return slug;
}

const EXTERNAL_PROJECT_LOCAL_ROOTS_DIR = "projects";

// Offline maintenance inventories runtime state, including closed/deleting and
// standalone projects, without creating directories or recovering project state.
async function listProjectRuntimeRoots(systemRoot) {
  if (!path.isAbsolute(systemRoot || "") || path.resolve(systemRoot) === path.parse(systemRoot).root) {
    throw new Error("Project state inventory requires an absolute, non-root system directory.");
  }
  const root = path.join(systemRoot, EXTERNAL_PROJECT_LOCAL_ROOTS_DIR);
  let entries;
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error("Project state inventory requires a regular projects directory.");
    entries = await readdir(root, { withFileTypes: true });
  }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (entries.some((entry) => entry.isSymbolicLink())) {
    throw new Error("Project state inventory contains a symbolic link. Inspect it before upgrading.");
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name)).sort();
}

const PROJECT_STATE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const PROJECT_RECORD_FILE = "project.json";
const PROJECT_SESSIONS_DIR = "sessions";
const PROJECT_DEPLOYMENTS_DIR = "deployments";
const PROJECT_CANONICAL_REPOSITORY_DIR = "canonical-repository";
const PROJECT_GITHUB_MIRROR_DIR = "github-mirror";
const PROJECT_REPOSITORY_DIR = "repository.git";
const PROJECT_RUNTIME_DIR = "runtime";
const PROJECT_RUNTIME_CONFIG_DIR = "runtime-config";
const PROJECT_INFO_CACHE_FILE = "projectInfoCache.json";

function normalizeProjectStateSlug(value = "") {
  const slug = normalizeText(value);
  if (!PROJECT_STATE_SLUG_PATTERN.test(slug)) {
    const error = new Error(`Invalid Vibe64 project state slug: ${slug || "(empty)"}`);
    error.code = "vibe64_invalid_project_state_slug";
    throw error;
  }
  return slug;
}

function resolveSourceConfigRoot({
  sourceRoot = process.cwd()
} = {}) {
  return normalizeTargetRoot(sourceRoot);
}

function resolveProjectRuntimeRoot({
  projectRuntimeRoot = ""
} = {}) {
  const normalizedProjectRuntimeRoot = normalizeText(projectRuntimeRoot);
  if (!normalizedProjectRuntimeRoot || !path.isAbsolute(normalizedProjectRuntimeRoot)) {
    const error = new Error("Project state requires an absolute project runtime root.");
    error.code = "vibe64_project_runtime_root_invalid";
    throw error;
  }
  return normalizeTargetRoot(normalizedProjectRuntimeRoot);
}

function resolveProjectRecordPath({
  projectRuntimeRoot = ""
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRuntimeRoot
  }), PROJECT_RECORD_FILE);
}

function resolveProjectSessionsRoot({
  projectRuntimeRoot = ""
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRuntimeRoot
  }), PROJECT_SESSIONS_DIR);
}

function resolveProjectDeploymentsRoot({
  projectRuntimeRoot = ""
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRuntimeRoot
  }), PROJECT_DEPLOYMENTS_DIR);
}

function resolveProjectRepositoryStoragePath(projectRuntimeRoot = "", storageDirectory = "") {
  const normalizedProjectRuntimeRoot = normalizeText(projectRuntimeRoot);
  if (!normalizedProjectRuntimeRoot || !path.isAbsolute(normalizedProjectRuntimeRoot)) {
    const error = new Error("Repository storage requires an absolute project runtime root.");
    error.code = "vibe64_repository_storage_project_runtime_root_invalid";
    throw error;
  }
  return path.join(resolveProjectRuntimeRoot({
    projectRuntimeRoot: normalizedProjectRuntimeRoot
  }), storageDirectory, PROJECT_REPOSITORY_DIR);
}

function resolveProjectCanonicalRepositoryPath({
  projectRuntimeRoot = ""
} = {}) {
  return resolveProjectRepositoryStoragePath(projectRuntimeRoot, PROJECT_CANONICAL_REPOSITORY_DIR);
}

function resolveProjectGithubMirrorPath({
  projectRuntimeRoot = ""
} = {}) {
  return resolveProjectRepositoryStoragePath(projectRuntimeRoot, PROJECT_GITHUB_MIRROR_DIR);
}

function resolveProjectRuntimeFilesRoot({
  projectRuntimeRoot = ""
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRuntimeRoot
  }), PROJECT_RUNTIME_DIR);
}

function resolveProjectRuntimeConfigRoot({
  projectRuntimeRoot = ""
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRuntimeRoot
  }), PROJECT_RUNTIME_CONFIG_DIR);
}

function resolveProjectInfoCachePath({
  projectRuntimeRoot = ""
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRuntimeRoot
  }), PROJECT_INFO_CACHE_FILE);
}

export {
  normalizeProjectSlug,
  PROJECT_SLUG_MAX_LENGTH,
  EXTERNAL_PROJECT_LOCAL_ROOTS_DIR,
  listProjectRuntimeRoots,
  PROJECT_DEPLOYMENTS_DIR,
  PROJECT_CANONICAL_REPOSITORY_DIR,
  PROJECT_GITHUB_MIRROR_DIR,
  PROJECT_INFO_CACHE_FILE,
  PROJECT_REPOSITORY_DIR,
  PROJECT_RECORD_FILE,
  PROJECT_RUNTIME_CONFIG_DIR,
  PROJECT_RUNTIME_DIR,
  PROJECT_SESSIONS_DIR,
  normalizeProjectStateSlug,
  resolveProjectRecordPath,
  resolveProjectDeploymentsRoot,
  resolveProjectCanonicalRepositoryPath,
  resolveProjectGithubMirrorPath,
  resolveProjectInfoCachePath,
  resolveProjectRuntimeConfigRoot,
  resolveProjectRuntimeFilesRoot,
  resolveProjectRuntimeRoot,
  resolveProjectSessionsRoot,
  resolveSourceConfigRoot
};
