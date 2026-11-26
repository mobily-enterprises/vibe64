import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

import { globalGitConfigPaths, runVibe64Command } from "@local/vibe64-execution/server";

import { pathInsideOrEqual } from "./core.js";
import { PRACTICE_SLUG_PATTERN, normalizeProjectTraining } from "./learningSpace.js";
import { normalizeProjectDeletion } from "./projectDeletion.js";
import { readProjectRecordMetadata, updateProjectRecordMetadata } from "./projectRecordMetadata.js";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeProjectGithubRepository,
  projectRepositoryMetadataFromInput,
  projectRepositoryStorageRole,
  projectRepositoryView
} from "./projectRepository.js";
import { publicProjectRuntimeOpenState, readProjectRuntimeOpenState } from "./projectRuntimeOpenState.js";
import {
  normalizeProjectSlug,
  EXTERNAL_PROJECT_LOCAL_ROOTS_DIR,
  resolveProjectSessionsRoot,
  resolveProjectStagingRoot,
  resolveProjectRuntimeFilesRoot,
  resolveProjectRuntimeConfigRoot
} from "./projectState.js";
import { VIBE64_PROJECTS_ROOT_ENV, resolveDefaultProjectsRoot } from "./studioRoots.js";
import { AppError } from "@jskit-ai/kernel/server/runtime";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

// Project records and their saved metadata: slugs, context and runtime
// roots, metadata files and the GitHub repository read from Git remotes.
const DEFAULT_CATALOGUE_REPOSITORY_BRANCH = "main";

function normalizeRoot(value, fallbackRoot = process.cwd()) {
  return path.resolve(String(value || "").trim() || fallbackRoot);
}

/**
 * The project catalogue's folder.
 * @param {object} options
 * @param {RuntimeEnv} options.env
 * @param {string} [options.explicitRoot]
 * @param {string} [options.home]
 */
function resolveStudioProjectsRoot({
  env,
  explicitRoot = "",
  home = os.homedir()
}) {
  return normalizeRoot(
    explicitRoot || env[VIBE64_PROJECTS_ROOT_ENV],
    resolveDefaultProjectsRoot(home)
  );
}

function projectCatalogUnavailableError() {
  const error = new Error("Project catalog operations are not available in local editor mode.");
  error.code = "vibe64_project_catalog_unavailable";
  return error;
}

function projectSlugExistsError() {
  const error = new AppError(409, "Project name already has local source or runtime state. Choose a different project name.", { code: "vibe64_project_slug_exists" });
  return error;
}

/**
 * training-<hex> names a learning-space practice project on both hosts.
 */
function assertCatalogueSlugAllowed(slug = "") {
  if (PRACTICE_SLUG_PATTERN.test(slug)) {
    throw new AppError(409, "Project names like training-<id> are reserved for practice projects. Choose a different project name.", { code: "vibe64_project_slug_reserved" });
  }
}

function projectDeletingError() {
  const error = new AppError(409, "Project deletion is in progress. Retry deletion before using this project.", { code: "vibe64_project_deleting" });
  return error;
}

function projectStateMissingError(slug = "") {
  const error = new Error(`Project state is missing for ${slug}.`);
  error.code = "vibe64_project_state_missing";
  return error;
}

function assertCatalogueRepositoryMetadata(metadata = {}) {
  if (projectRepositoryView(metadata).repositoryMode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return metadata;
  }
  const error = new AppError(409, "Catalogue projects cannot use a project namespace as local source. Correct this project record explicitly before opening it.", { code: "vibe64_hosted_local_source_unsupported" });
  throw error;
}

function projectSlugFromName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function projectSlugFromInput(input) {
  const explicitSlug = String(input?.slug || input?.projectSlug || "").trim();
  if (explicitSlug) {
    return normalizeProjectSlug(explicitSlug);
  }
  return normalizeProjectSlug(projectSlugFromName(input?.name));
}

/**
 * The folder a slug's project lives in, directly below the projects root.
 * @param {{ projectsRoot: string, slug: string }} options
 */
function resolveProjectContextRoot({ projectsRoot, slug }) {
  const normalizedProjectsRoot = normalizeRoot(projectsRoot);
  const normalizedSlug = normalizeProjectSlug(slug);
  const projectContextRoot = path.resolve(normalizedProjectsRoot, normalizedSlug);
  if (!pathInsideOrEqual(normalizedProjectsRoot, projectContextRoot)) {
    const error = new Error("Project root must be inside the Vibe64 projects root.");
    error.code = "vibe64_project_outside_root";
    throw error;
  }
  return projectContextRoot;
}

function resolveCatalogProjectRuntimeRoot({
  systemRoot = "",
  slug = ""
} = {}) {
  const normalizedSystemRoot = normalizeRoot(systemRoot);
  const normalizedSlug = normalizeProjectSlug(slug);
  const projectRuntimeRoot = path.resolve(normalizedSystemRoot, EXTERNAL_PROJECT_LOCAL_ROOTS_DIR, normalizedSlug);
  if (!pathInsideOrEqual(normalizedSystemRoot, projectRuntimeRoot)) {
    const error = new Error("Project runtime root must be inside the Vibe64 system root.");
    error.code = "vibe64_project_runtime_outside_root";
    throw error;
  }
  return projectRuntimeRoot;
}

async function assertDirectoryUsable(directoryPath = "") {
  try {
    const linkInfo = await lstat(directoryPath);
    if (linkInfo.isSymbolicLink()) {
      const error = new Error(`Project path must not be a symlink: ${directoryPath}`);
      error.code = "vibe64_project_path_symlink";
      throw error;
    }
    const info = await stat(directoryPath);
    if (!info.isDirectory()) {
      const error = new Error(`Project path is not a directory: ${directoryPath}`);
      error.code = "vibe64_project_path_not_directory";
      throw error;
    }
    await access(directoryPath, fsConstants.R_OK | fsConstants.W_OK);
  } catch (error) {
    if (error?.code && error.code.startsWith("vibe64_")) {
      throw error;
    }
    const wrapped = new Error(`Project path is not readable and writable: ${directoryPath}`, { cause: error });
    wrapped.code = "vibe64_project_path_not_accessible";
    throw wrapped;
  }
}

function projectRecord({
  path: projectPath = "",
  projectsRoot = "",
  selectedPath = "",
  source = ""
} = {}) {
  const resolvedPath = normalizeRoot(projectPath);
  const hasProjectsRoot = String(projectsRoot || "").trim() !== "";
  const insideProjectsRoot = hasProjectsRoot && pathInsideOrEqual(projectsRoot, resolvedPath);
  const basename = path.basename(resolvedPath);
  return {
    external: !insideProjectsRoot,
    name: basename,
    path: resolvedPath,
    selected: selectedPath ? normalizeRoot(selectedPath) === resolvedPath : false,
    slug: insideProjectsRoot ? basename : localProjectSlugFromTargetRoot(resolvedPath),
    source
  };
}

async function selectedProjectRecord({
  path: projectPath = "",
  projectRecordPath = "",
  projectRuntimeRoot = "",
  projectSessionSourceRoot = "",
  sourceConfigRoot = "",
  projectsRoot = "",
  selectedPath = "",
  sourceRoot = "",
  source = ""
} = {}) {
  const resolvedPath = normalizeRoot(projectPath);
  const selectionRecord = projectRecord({
    path: resolvedPath,
    projectsRoot,
    selectedPath,
    source
  });
  const metadata = await projectMetadataWithGitRemote(resolvedPath, {
    projectRecordPath,
    repositoryModeFallback: sourceRoot ? PROJECT_REPOSITORY_MODE_LOCAL_SOURCE : "",
    writeDerivedMetadata: false
  });
  const runtime = publicProjectRuntimeOpenState(await readProjectRuntimeOpenState({
    projectRuntimeRoot
  }));
  const repositoryFields = projectRepositoryView(metadata, {
    fallbackMode: sourceRoot ? PROJECT_REPOSITORY_MODE_LOCAL_SOURCE : ""
  });
  if (sourceRoot && repositoryFields.repositoryMode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    const branch = await gitAnswer("branch", sourceRoot, async (git) => {
      const checkedOut = await git(sourceRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      return checkedOut || await git(sourceRoot, ["rev-parse", "--is-inside-work-tree"]) === "true" ? checkedOut : null;
    });
    if (branch !== null) {
      repositoryFields.repository = { ...repositoryFields.repository, defaultBranch: branch };
    }
  }
  const githubRepository = repositoryFields.githubRepository ||
    normalizeProjectGithubRepository(metadata?.derivedGithubRepository);
  return {
    ...selectionRecord,
    ...repositoryFields,
    ...(githubRepository ? { githubRepository } : {}),
    projectRecordPath,
    projectRuntimeRoot,
    projectSessionSourceRoot,
    runtime,
    sourceConfigRoot,
    sourceRoot
  };
}

function localProjectSlugFromTargetRoot(targetRoot = "") {
  const slug = projectSlugFromName(path.basename(normalizeRoot(targetRoot)));
  return slug ? normalizeProjectSlug(slug) : "local-project";
}

function localProjectKeyFromTargetRoot(targetRoot = "") {
  const resolvedTargetRoot = normalizeRoot(targetRoot);
  const hash = createHash("sha256")
    .update(resolvedTargetRoot)
    .digest("hex")
    .slice(0, 12);
  return `${localProjectSlugFromTargetRoot(resolvedTargetRoot)}-${hash}`;
}

/**
 * A saved practice project belongs to its exact training marker, is not being
 * deleted (unless deletion is the operation) and keeps its managed Git authority.
 */
function practiceOwnershipDiffers(metadata, training, allowDeleting) {
  return !isDeepStrictEqual(metadata.training, training) || Boolean(metadata.deletion && !allowDeleting) ||
    projectRepositoryView(metadata).repositoryMode !== PROJECT_REPOSITORY_MODE_MANAGED_GIT;
}

function workspaceProjectRecord({
  metadata = {},
  projectRecordPath = "",
  path: projectPath = "",
  projectRuntimeRoot = "",
  projectSessionSourceRoot = "",
  projectsRoot = "",
  runtime = {}
} = {}) {
  const resolvedPath = normalizeRoot(projectPath);
  const repositoryFields = projectRepositoryView(metadata);
  const repositoryStorage = projectRuntimeRoot
    ? projectRepositoryStorageRole({
      mode: repositoryFields.repositoryMode,
      projectRuntimeRoot
    })
    : null;
  const deletion = normalizeProjectDeletion(metadata.deletion);
  return {
    ...repositoryFields,
    canonicalRepositoryPath: repositoryStorage?.pathField === "canonicalRepositoryPath"
      ? repositoryStorage.path
      : "",
    stagingRoot: projectRuntimeRoot
      ? resolveProjectStagingRoot({
        projectRuntimeRoot
      })
      : "",
    allowSharedDatabaseSessions: metadata.allowSharedDatabaseSessions === true,
    developmentDatabaseScope: normalizeDevelopmentDatabaseScope(
      metadata.developmentDatabaseScope
    ),
    developmentDatabaseName: normalizeDevelopmentDatabaseName(
      metadata.developmentDatabaseName
    ),
    path: resolvedPath,
    projectRoot: resolvedPath,
    projectRootRelative: path.relative(normalizeRoot(projectsRoot), resolvedPath),
    projectRecordPath,
    projectRuntimeRoot,
    projectSessionSourceRoot,
    githubMirrorPath: repositoryStorage?.pathField === "githubMirrorPath"
      ? repositoryStorage.path
      : "",
    runtimeConfigRoot: projectRuntimeRoot
      ? resolveProjectRuntimeConfigRoot({
        projectRuntimeRoot
      })
      : "",
    runtimeRoot: projectRuntimeRoot
      ? resolveProjectRuntimeFilesRoot({
        projectRuntimeRoot
      })
      : "",
    runtime: publicProjectRuntimeOpenState(runtime),
    ...(deletion ? { deletion } : {}),
    sessionsRoot: projectRuntimeRoot
      ? resolveProjectSessionsRoot({
        projectRuntimeRoot
      })
      : "",
    slug: path.basename(resolvedPath)
  };
}

function projectMetadataPath(projectRecordPath = "") {
  const normalizedRecordPath = String(projectRecordPath || "").trim();
  return normalizedRecordPath ? path.resolve(normalizedRecordPath) : "";
}

function projectMetadataFromInput(input = {}, options = {}) {
  const {
    defaultRepositoryBranch = "",
    defaultRepositoryMode = ""
  } = options;
  if (Object.hasOwn(input, "allowSharedDatabaseSessions") && typeof input.allowSharedDatabaseSessions !== "boolean") {
    const error = new Error("Shared database session override must be a boolean.");
    error.code = "vibe64_project_metadata_invalid";
    throw error;
  }
  const repositoryMetadata = projectRepositoryMetadataFromInput(input, {
    defaultBranch: defaultRepositoryBranch,
    defaultMode: defaultRepositoryMode
  });
  return {
    ...repositoryMetadata,
    ...(Object.hasOwn(input, "allowSharedDatabaseSessions")
      ? { allowSharedDatabaseSessions: input.allowSharedDatabaseSessions } : {}),
    ...(Object.hasOwn(input, "training") ? { training: normalizeProjectTraining(input.training) } : {}),
    ...(Object.hasOwn(input, "developmentDatabaseScope")
      ? {
          developmentDatabaseScope: normalizeDevelopmentDatabaseScope(
            input.developmentDatabaseScope
          )
        }
      : {}),
    ...(Object.hasOwn(input, "developmentDatabaseName")
      ? {
          developmentDatabaseName: normalizeDevelopmentDatabaseName(
            input.developmentDatabaseName
          )
        }
      : {}),
    ...(input.deletion ? { deletion: normalizeProjectDeletion(input.deletion) } : {})
  };
}

function normalizeDevelopmentDatabaseScope(value = "session") {
  const scope = String(value || "session").trim();
  if (!["project", "session"].includes(scope)) {
    const error = new Error(`Invalid development database scope: ${scope || "(empty)"}.`);
    error.code = "vibe64_development_database_scope_invalid";
    throw error;
  }
  return scope;
}

function normalizeDevelopmentDatabaseName(value = "") {
  const name = String(value || "").trim();
  if (name && !/^[a-z0-9][a-z0-9_]{0,62}$/u.test(name)) {
    const error = new Error(`Invalid development database name: ${name}.`);
    error.code = "vibe64_development_database_name_invalid";
    throw error;
  }
  return name;
}

function normalizeProjectMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    const error = new Error("Project metadata must be an object.");
    error.code = "vibe64_project_metadata_invalid";
    throw error;
  }
  if (Object.keys(metadata).length === 0) {
    return {};
  }
  const unsupportedFields = Object.keys(metadata)
    .filter((field) => ![
      "deletion",
      "developmentDatabaseName",
      "developmentDatabaseScope",
      "allowSharedDatabaseSessions",
      "repository",
      "training"
    ].includes(field));
  if (unsupportedFields.length > 0) {
    const error = new Error(`Project metadata contains unsupported fields: ${unsupportedFields.join(", ")}.`);
    error.code = "vibe64_project_metadata_field_unsupported";
    throw error;
  }
  const normalized = projectMetadataFromInput(metadata);
  return normalized;
}

async function readProjectMetadata({
  projectRecordPath = ""
} = {}) {
  const metadataPath = projectMetadataPath(projectRecordPath);
  return metadataPath
    ? normalizeProjectMetadata(await readProjectRecordMetadata(metadataPath))
    : {};
}

async function writeProjectMetadata(projectRecordPath = "", metadata = {}, options = {}) {
  const metadataPath = projectMetadataPath(projectRecordPath);
  if (!metadataPath) {
    throw new Error("writeProjectMetadata requires projectRecordPath.");
  }
  const normalizedMetadata = projectMetadataFromInput(metadata, options);
  await updateProjectRecordMetadata(metadataPath, () => normalizedMetadata);
  return normalizedMetadata;
}

async function workspaceProjectRecordForPath({
  projectRecordPath = "",
  path: projectPath = "",
  projectRuntimeRoot = "",
  projectSessionSourceRoot = "",
  projectsRoot = ""
} = {}) {
  const resolvedPath = normalizeRoot(projectPath);
  const metadata = assertCatalogueRepositoryMetadata(await readProjectMetadata({
    projectRecordPath
  }));
  const runtime = await readProjectRuntimeOpenState({
    projectRuntimeRoot
  });
  return workspaceProjectRecord({
    metadata,
    projectRecordPath,
    path: resolvedPath,
    projectRuntimeRoot,
    projectSessionSourceRoot,
    projectsRoot,
    runtime
  });
}

async function projectMetadataWithGitRemote(projectPath = "", options = {}) {
  const {
    projectRecordPath = "",
    repositoryModeFallback = "",
    writeDerivedMetadata = false
  } = options;
  const metadata = await readProjectMetadata({
    projectRecordPath
  });
  if (projectRepositoryView(metadata).repository) {
    return metadata;
  }
  const githubRepository = await gitAnswer("github", projectPath, (git) => githubRepositoryFromGitRemotes(projectPath, git));
  if (!githubRepository) {
    return metadata;
  }
  const derivedMetadata = {
    ...metadata,
    repository: repositoryModeFallback
      ? { mode: repositoryModeFallback }
      : {
          github: githubRepository,
          mode: PROJECT_REPOSITORY_MODE_GITHUB
        },
    derivedGithubRepository: githubRepository
  };
  if (writeDerivedMetadata) {
    await writeProjectMetadata(projectRecordPath, derivedMetadata);
  }
  return derivedMetadata;
}

// Every request reads its project's record, so what Git answers about a local project's folder (its GitHub remote,
// its checked-out branch) is kept while the files Git answers from stay the same: the folder's .git, the repository's
// HEAD and config (a linked worktree's shared one), and the global and system config. Git replaces each of those
// files when it changes it. A folder without its own .git, a config that includes other files, or an answer from a Git
// that did not finish by itself (a timeout, a signal, a refused start) is asked again next time.
const GIT_ANSWER_LIMIT = 64;
const gitAnswers = new Map();

async function gitAnswer(kind, root, ask) {
  const key = `${kind}\0${normalizeRoot(root)}`;
  const files = await gitAnswerFiles(root).catch(() => null);
  const identity = files ? await fileIdentities(files).catch(() => "") : "";
  const cached = gitAnswers.get(key);
  if (identity && cached?.identity === identity) return structuredClone(cached.answer);
  let finished = true;
  const answer = await ask((cwd, args) => runGit(cwd, args, () => { finished = false; }));
  if (identity && finished && !(await configIncludesFiles(files))) {
    gitAnswers.delete(key);
    gitAnswers.set(key, { answer: structuredClone(answer), identity });
    if (gitAnswers.size > GIT_ANSWER_LIMIT) gitAnswers.delete(gitAnswers.keys().next().value);
  }
  return answer;
}

/** The files Git reads to answer about a folder with its own .git, or null for any other folder. */
async function gitAnswerFiles(root) {
  const dotGit = path.join(normalizeRoot(root), ".git");
  const entry = await lstat(dotGit);
  let gitDirectory = dotGit;
  if (entry.isFile()) {
    const pointer = /^gitdir:[\t ]*(.+?)[\t ]*$/mu.exec(await readFile(dotGit, "utf8"));
    if (!pointer) return null;
    gitDirectory = path.resolve(path.dirname(dotGit), pointer[1]);
  } else if (!entry.isDirectory()) {
    return null;
  }
  const commonDirectory = await readFile(path.join(gitDirectory, "commondir"), "utf8").then(
    (text) => path.resolve(gitDirectory, text.trim()),
    (error) => {
      if (error?.code === "ENOENT") return gitDirectory;
      throw error;
    }
  );
  const configs = [path.join(commonDirectory, "config"), ...globalGitConfigPaths(process.env), "/etc/gitconfig"];
  return { configs, others: [dotGit, path.join(gitDirectory, "HEAD")] };
}

// A .git folder changes its own times with every lock file Git writes, so it counts by which folder it is.
async function fileIdentities({ configs, others }) {
  return (await Promise.all([...others, ...configs].map((file) => stat(file, { bigint: true }).then(
    (info) => info.isDirectory()
      ? `${info.dev}:${info.ino}`
      : `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`,
    (error) => {
      if (error?.code === "ENOENT") return "-";
      throw error;
    }
  )))).join("|");
}

async function configIncludesFiles({ configs }) {
  const texts = await Promise.all(configs.map((file) => readFile(file, "utf8").catch(() => "")));
  return texts.some((text) => /^[\t ]*\[[\t ]*include(?:If)?\b/imu.test(text));
}

async function githubRepositoryFromGitRemotes(projectPath = "", git = runGit) {
  const insideGit = await git(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  if (insideGit !== "true") {
    return null;
  }

  const originUrl = await git(projectPath, ["remote", "get-url", "origin"]);
  const originRepository = githubRepositoryFromRemoteUrl(originUrl);
  if (originRepository) {
    return originRepository;
  }

  const remoteNames = (await git(projectPath, ["remote"]))
    .split(/\r?\n/u)
    .map((remoteName) => remoteName.trim())
    .filter(Boolean)
    .filter((remoteName) => remoteName !== "origin");
  const githubRepositories = [];
  for (const remoteName of remoteNames) {
    const repository = githubRepositoryFromRemoteUrl(await git(projectPath, ["remote", "get-url", remoteName]));
    if (repository && !githubRepositories.some((existing) => existing.fullName === repository.fullName)) {
      githubRepositories.push(repository);
    }
  }
  return githubRepositories.length === 1 ? githubRepositories[0] : null;
}

function githubRepositoryFromRemoteUrl(remoteUrl = "") {
  const parsed = parseGithubRemote(remoteUrl);
  if (!parsed) {
    return null;
  }
  return {
    canPush: false,
    cloneUrl: `https://github.com/${parsed.fullName}.git`,
    fullName: parsed.fullName,
    isPrivate: false,
    name: parsed.name,
    owner: parsed.owner,
    url: `https://github.com/${parsed.fullName}`,
    viewerPermission: "",
    visibility: ""
  };
}

async function runGitCommand(cwd = "", args = [], options = {}) {
  const {
    timeout = 5000
  } = options;
  const resolvedCwd = normalizeRoot(cwd);
  return runVibe64Command({
    actor: "daemon",
    allowedRoots: [resolvedCwd],
    args,
    command: "git",
    cwd: resolvedCwd,
    envPolicy: "project",
    gitSafeDirectories: [resolvedCwd],
    mode: "capture",
    purpose: "source-editor",
    runtimes: ["git"],
    timeout
  });
}

function gitCommandOutput(result = {}) {
  return String(result.stdout || result.output || "").trim();
}

/** Git's output, or "" when it failed; `unfinished` hears of a Git that did not end by itself with an exit code. */
async function runGit(cwd = "", args = [], unfinished = () => {}) {
  try {
    const result = await runGitCommand(cwd, args);
    if (result.timedOut || result.signal || result.code) unfinished();
    return result.ok ? gitCommandOutput(result) : "";
  } catch {
    unfinished();
    return "";
  }
}

function parseGithubRemote(value = "") {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return null;
  }
  const sshMatch = rawValue.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/iu);
  if (sshMatch) {
    return githubRemoteRecord(sshMatch[1], sshMatch[2]);
  }
  try {
    const url = new URL(rawValue);
    if (url.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    const [owner, repository] = url.pathname
      .replace(/^\/+|\/+$/gu, "")
      .replace(/\.git$/iu, "")
      .split("/");
    return githubRemoteRecord(owner, repository);
  } catch {
    return null;
  }
}

function githubRemoteRecord(owner = "", repository = "") {
  const normalizedOwner = String(owner || "").trim();
  const normalizedRepository = String(repository || "").trim();
  if (!normalizedOwner || !normalizedRepository) {
    return null;
  }
  return {
    fullName: `${normalizedOwner}/${normalizedRepository}`,
    name: normalizedRepository,
    owner: normalizedOwner
  };
}

export {
  assertCatalogueSlugAllowed,
  assertDirectoryUsable,
  assertCatalogueRepositoryMetadata,
  DEFAULT_CATALOGUE_REPOSITORY_BRANCH,
  localProjectKeyFromTargetRoot,
  normalizeDevelopmentDatabaseName,
  normalizeDevelopmentDatabaseScope,
  normalizeProjectMetadata,
  normalizeRoot,
  practiceOwnershipDiffers,
  projectCatalogUnavailableError,
  projectDeletingError,
  projectMetadataFromInput,
  projectRecord,
  projectSlugExistsError,
  projectSlugFromInput,
  projectSlugFromName,
  projectStateMissingError,
  readProjectMetadata,
  resolveCatalogProjectRuntimeRoot,
  resolveProjectContextRoot,
  resolveStudioProjectsRoot,
  selectedProjectRecord,
  workspaceProjectRecordForPath,
  writeProjectMetadata
};
