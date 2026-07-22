import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";

import {
  VIBE64_PROJECTS_ROOT_ENV,
  resolveDefaultLocalEditorProjectsRoot,
  resolveVibe64Roots,
  resolveExplicitStudioTargetRoot
} from "./studioRoots.js";
import {
  resolveProjectRecordPath,
  resolveProjectRuntimeRoot,
  resolveProjectSessionsRoot,
  resolveProjectDeploymentsRoot,
  resolveProjectGitCacheRoot,
  resolveProjectRuntimeFilesRoot,
  resolveProjectRuntimeConfigRoot,
  resolveSourceConfigRoot
} from "./projectState.js";
import {
  publicProjectRuntimeOpenState,
  readProjectRuntimeOpenState
} from "./projectRuntimeOpenState.js";
import {
  normalizeProjectBootstrapConfig,
  readProjectRecordMetadata,
  updateProjectRecordMetadata
} from "./projectBootstrapConfig.js";
import {
  pathExists
} from "./core.js";
import {
  completedProjectBootstrap,
  createProjectBootstrap,
  normalizeProjectBootstrap,
  normalizeProjectDeletion,
  projectBootstrapApplicationMode,
  projectBootstrapWithTemplate
} from "./projectLifecycle.js";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeProjectGithubRepository,
  projectRepositoryMetadataFromInput,
  projectRepositoryView
} from "./projectRepository.js";
import {
  PROJECT_APPLICATION_MODE_NEW,
  requireProjectApplicationMode
} from "./projectApplication.js";

const PROJECT_SLUG_MAX_LENGTH = 48;
const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const EXTERNAL_PROJECT_LOCAL_ROOTS_DIR = "projects";

let configuredContext = null;

function normalizeRoot(value, fallbackRoot = process.cwd()) {
  return path.resolve(String(value || "").trim() || fallbackRoot);
}

function resolveStudioProjectsRoot({
  env = process.env,
  explicitRoot = "",
  home = os.homedir()
} = {}) {
  return normalizeRoot(
    explicitRoot || env[VIBE64_PROJECTS_ROOT_ENV],
    path.join(home || process.cwd(), "vibe64")
  );
}

function projectCatalogEnabledForRuntimeProfile(runtimeProfile = null) {
  if (runtimeProfile?.projectCatalogEnabled === false) {
    return false;
  }
  if (runtimeProfile?.local === true) {
    return false;
  }
  const mode = String(runtimeProfile?.mode || "").trim().toLowerCase();
  if (mode === "local" || mode === "local-editor") {
    return false;
  }
  return true;
}

function projectCatalogUnavailableError() {
  const error = new Error("Project catalog operations are not available in local editor mode.");
  error.code = "vibe64_project_catalog_unavailable";
  return error;
}

function projectSlugExistsError() {
  const error = new Error("Project name already has local source or runtime state. Choose a different project name.");
  error.code = "vibe64_project_slug_exists";
  error.statusCode = 409;
  return error;
}

function projectDeletingError() {
  const error = new Error("Project deletion is in progress. Retry deletion before using this project.");
  error.code = "vibe64_project_deleting";
  error.statusCode = 409;
  return error;
}

function projectStateMissingError(slug = "") {
  const error = new Error(`Project state is missing for ${slug}.`);
  error.code = "vibe64_project_state_missing";
  return error;
}

function pathInsideOrEqual(parentPath = "", childPath = "") {
  const parent = normalizeRoot(parentPath);
  const child = normalizeRoot(childPath, parent);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function projectSlugFromName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

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

function projectSlugFromInput(input = {}) {
  const explicitSlug = String(input?.slug || input?.projectSlug || "").trim();
  if (explicitSlug) {
    return normalizeProjectSlug(explicitSlug);
  }
  return normalizeProjectSlug(projectSlugFromName(input?.name));
}

function resolveProjectRoot({
  projectsRoot = "",
  slug = ""
} = {}) {
  const normalizedProjectsRoot = normalizeRoot(projectsRoot || resolveStudioProjectsRoot());
  const normalizedSlug = normalizeProjectSlug(slug);
  const projectRoot = path.resolve(normalizedProjectsRoot, normalizedSlug);
  if (!pathInsideOrEqual(normalizedProjectsRoot, projectRoot)) {
    const error = new Error("Project root must be inside the Vibe64 projects root.");
    error.code = "vibe64_project_outside_root";
    throw error;
  }
  return projectRoot;
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
    const wrapped = new Error(`Project path is not readable and writable: ${directoryPath}`);
    wrapped.code = "vibe64_project_path_not_accessible";
    throw wrapped;
  }
}

async function assertProjectDirectoryUsable(directoryPath = "") {
  return assertDirectoryUsable(directoryPath);
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
    projectLocalRoot: projectRuntimeRoot || resolvedPath
  }));
  const repositoryFields = projectRepositoryView(metadata, {
    fallbackMode: sourceRoot ? PROJECT_REPOSITORY_MODE_LOCAL_SOURCE : ""
  });
  const githubRepository = repositoryFields.githubRepository ||
    normalizeProjectGithubRepository(metadata?.derivedGithubRepository);
  return {
    ...selectionRecord,
    ...repositoryFields,
    ...(githubRepository ? { githubRepository } : {}),
    projectRecordPath,
    projectLocalRoot: projectRuntimeRoot,
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
  const bootstrap = Object.keys(metadata).length
    ? normalizeProjectBootstrap(metadata.bootstrap)
    : null;
  const applicationMode = bootstrap ? projectBootstrapApplicationMode(bootstrap) : "";
  const deletion = normalizeProjectDeletion(metadata.deletion);
  return {
    ...(applicationMode
      ? { applicationMode }
      : {}),
    ...(normalizeProjectBootstrapConfig(metadata?.bootstrapConfig)
      ? { bootstrapConfig: normalizeProjectBootstrapConfig(metadata.bootstrapConfig) }
      : {}),
    ...repositoryFields,
    gitCacheRoot: resolvedPath
      ? resolveProjectGitCacheRoot({
          projectRuntimeRoot: resolvedPath
        })
      : "",
    deploymentsRoot: projectRuntimeRoot
      ? resolveProjectDeploymentsRoot({
          projectRuntimeRoot
        })
      : "",
    path: resolvedPath,
    projectLocalRoot: projectRuntimeRoot,
    projectRoot: resolvedPath,
    projectRootRelative: path.relative(normalizeRoot(projectsRoot), resolvedPath),
    projectRecordPath,
    projectRuntimeRoot,
    projectSessionSourceRoot,
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

function projectMetadataFromInput(input = {}, {
  defaultRepositoryBranch = "",
  defaultRepositoryMode = ""
} = {}) {
  const repositoryMetadata = projectRepositoryMetadataFromInput(input, {
    defaultBranch: defaultRepositoryBranch,
    defaultMode: defaultRepositoryMode
  });
  const bootstrapConfig = normalizeProjectBootstrapConfig(input?.bootstrapConfig);
  return {
    ...repositoryMetadata,
    ...(input?.bootstrap ? { bootstrap: normalizeProjectBootstrap(input.bootstrap) } : {}),
    ...(bootstrapConfig ? { bootstrapConfig } : {}),
    ...(input?.deletion ? { deletion: normalizeProjectDeletion(input.deletion) } : {})
  };
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
      "bootstrap",
      "bootstrapConfig",
      "deletion",
      "repository"
    ].includes(field));
  if (unsupportedFields.length > 0) {
    const error = new Error(`Project metadata contains unsupported fields: ${unsupportedFields.join(", ")}.`);
    error.code = "vibe64_project_metadata_field_unsupported";
    throw error;
  }
  const normalized = projectMetadataFromInput(metadata);
  normalizeProjectBootstrap(normalized.bootstrap);
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
  normalizeProjectBootstrap(normalizedMetadata.bootstrap);
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
  const metadata = await readProjectMetadata({
    projectRecordPath
  });
  const runtime = await readProjectRuntimeOpenState({
    projectLocalRoot: projectRuntimeRoot || resolvedPath
  });
  return workspaceProjectRecord({
    metadata,
    projectRecordPath,
    path: resolvedPath,
    projectRuntimeRoot: projectRuntimeRoot || resolvedPath,
    projectSessionSourceRoot: projectSessionSourceRoot || resolvedPath,
    projectsRoot,
    runtime
  });
}

async function projectMetadataWithGitRemote(projectPath = "", {
  projectRecordPath = "",
  repositoryModeFallback = "",
  writeDerivedMetadata = false
} = {}) {
  const metadata = await readProjectMetadata({
    projectRecordPath
  });
  if (projectRepositoryView(metadata).repository) {
    return metadata;
  }
  const githubRepository = await githubRepositoryFromGitRemotes(projectPath);
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

async function githubRepositoryFromGitRemotes(projectPath = "") {
  const insideGit = await runGit(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  if (insideGit !== "true") {
    return null;
  }

  const originUrl = await runGit(projectPath, ["remote", "get-url", "origin"]);
  const originRepository = githubRepositoryFromRemoteUrl(originUrl);
  if (originRepository) {
    return originRepository;
  }

  const remoteNames = (await runGit(projectPath, ["remote"]))
    .split(/\r?\n/u)
    .map((remoteName) => remoteName.trim())
    .filter(Boolean)
    .filter((remoteName) => remoteName !== "origin");
  const githubRepositories = [];
  for (const remoteName of remoteNames) {
    const repository = githubRepositoryFromRemoteUrl(await runGit(projectPath, ["remote", "get-url", remoteName]));
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

async function runGitCommand(cwd = "", args = [], {
  timeout = 5000
} = {}) {
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

async function runGit(cwd = "", args = []) {
  try {
    const result = await runGitCommand(cwd, args);
    return result.ok ? gitCommandOutput(result) : "";
  } catch {
    return "";
  }
}

async function runRequiredGit(cwd = "", args = [], options = {}) {
  const result = await runGitCommand(cwd, args, options);
  if (result.ok) {
    return gitCommandOutput(result);
  }
  const error = new Error(String(result.stderr || result.stdout || result.output || result.error || "Git command failed.").trim());
  error.code = result.code || "vibe64_project_git_command_failed";
  throw error;
}

async function gitCommandSucceeds(cwd = "", args = []) {
  const result = await runGitCommand(cwd, args);
  return result.ok === true;
}

async function ensureLocalSourceMainBranch(projectPath = "") {
  const targetRoot = normalizeRoot(projectPath);
  const mainBranch = PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH;
  const insideWorkTree = (await runGit(targetRoot, ["rev-parse", "--is-inside-work-tree"])) === "true";
  if (!insideWorkTree) {
    await runRequiredGit(targetRoot, ["init", `--initial-branch=${mainBranch}`], {
      timeout: 30_000
    });
    await runRequiredGit(targetRoot, ["add", "-A"], {
      timeout: 30_000
    });
    await runRequiredGit(targetRoot, ["commit", "--allow-empty", "-m", "Initial commit"], {
      timeout: 30_000
    });
    return;
  }

  if (await gitCommandSucceeds(targetRoot, ["rev-parse", "--verify", `refs/heads/${mainBranch}^{commit}`])) {
    return;
  }

  if (!await gitCommandSucceeds(targetRoot, ["rev-parse", "--verify", "HEAD^{commit}"])) {
    await runRequiredGit(targetRoot, ["symbolic-ref", "HEAD", `refs/heads/${mainBranch}`]);
    await runRequiredGit(targetRoot, ["add", "-A"], {
      timeout: 30_000
    });
    await runRequiredGit(targetRoot, ["commit", "--allow-empty", "-m", "Initial commit"], {
      timeout: 30_000
    });
    return;
  }

  await runRequiredGit(targetRoot, ["checkout", "-B", mainBranch, "HEAD"], {
    timeout: 30_000
  });
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

function createStudioProjectContext({
  cwd = process.cwd(),
  explicitManagedSourceRoot = "",
  explicitSystemRoot = "",
  env = process.env,
  explicitProjectsRoot = "",
  explicitTargetRoot = "",
  home = os.homedir(),
  runtimeProfile = null
} = {}) {
  const projectCatalogEnabled = projectCatalogEnabledForRuntimeProfile(runtimeProfile);
  const projectsRoot = projectCatalogEnabled
    ? resolveStudioProjectsRoot({
        env,
        explicitRoot: explicitProjectsRoot,
        home
      })
    : String(explicitProjectsRoot || "").trim()
      ? normalizeRoot(explicitProjectsRoot)
      : resolveDefaultLocalEditorProjectsRoot(home);
  const roots = resolveVibe64Roots({
    env,
    explicitManagedSourceRoot,
    explicitSystemRoot,
    home,
    projectsRoot,
    runtimeProfile
  });
  const managedSourceRoot = roots.managedSourceRoot;
  const systemRoot = roots.systemRoot;
  let selectedTargetRoot = resolveExplicitStudioTargetRoot({
    cwd,
    env,
    explicitRoot: explicitTargetRoot
  });
  let selectionSource = selectedTargetRoot ? "explicit" : "";

  function targetIsCatalogProjectHome(targetRoot = "") {
    if (!projectCatalogEnabled || !projectsRoot) {
      return false;
    }
    const relativePath = path.relative(normalizeRoot(projectsRoot), normalizeRoot(targetRoot));
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return false;
    }
    if (relativePath.includes(path.sep)) {
      return false;
    }
    try {
      return normalizeProjectSlug(relativePath) === relativePath;
    } catch {
      return false;
    }
  }

  function externalProjectRuntimeRootForTarget(targetRoot = "") {
    return path.join(
      systemRoot,
      EXTERNAL_PROJECT_LOCAL_ROOTS_DIR,
      localProjectKeyFromTargetRoot(targetRoot)
    );
  }

  function externalProjectSessionSourceRootForTarget(targetRoot = "") {
    return path.join(
      managedSourceRoot,
      localProjectKeyFromTargetRoot(targetRoot)
    );
  }

  function projectRootForSlug(slug = "") {
    return resolveProjectRoot({
      projectsRoot,
      slug: normalizeProjectSlug(slug)
    });
  }

  function projectRecordPathForSlug(slug = "") {
    return resolveProjectRecordPath({
      projectRoot: projectRuntimeRootForSlug(slug)
    });
  }

  function projectRecordPathForTarget(targetRoot = "") {
    return targetIsCatalogProjectHome(targetRoot)
      ? resolveProjectRecordPath({
          projectRoot: projectRuntimeRootForTarget(targetRoot)
        })
      : "";
  }

  function projectRuntimeRootForSlug(slug = "") {
    if (!projectCatalogEnabled) {
      return resolveProjectRuntimeRoot({
        projectRoot: projectRootForSlug(slug)
      });
    }
    return resolveCatalogProjectRuntimeRoot({
      slug,
      systemRoot
    });
  }

  function projectRuntimeRootForTarget(targetRoot = "") {
    return targetIsCatalogProjectHome(targetRoot)
      ? resolveCatalogProjectRuntimeRoot({
          slug: path.basename(normalizeRoot(targetRoot)),
          systemRoot
        })
      : externalProjectRuntimeRootForTarget(targetRoot);
  }

  function projectSessionSourceRootForSlug(slug = "") {
    return projectRootForSlug(slug);
  }

  function projectSessionSourceRootForTarget(targetRoot = "") {
    return targetIsCatalogProjectHome(targetRoot)
      ? projectRootForSlug(path.basename(normalizeRoot(targetRoot)))
      : externalProjectSessionSourceRootForTarget(targetRoot);
  }

  function sourceRootForSlug() {
    return "";
  }

  function sourceRootForTarget(targetRoot = "") {
    return targetIsCatalogProjectHome(targetRoot) ? "" : normalizeRoot(targetRoot);
  }

  function sourceConfigRootForSlug(slug = "") {
    void slug;
    return "";
  }

  function sourceConfigRootForTarget(targetRoot = "") {
    const sourceRoot = sourceRootForTarget(targetRoot);
    return sourceRoot
      ? resolveSourceConfigRoot({
          sourceRoot
        })
      : "";
  }

  function projectLocalRootForSlug(slug = "") {
    return projectRuntimeRootForSlug(slug);
  }

  function projectLocalRootForTarget(targetRoot = "") {
    return projectRuntimeRootForTarget(targetRoot);
  }

  function selectedProject() {
    return selectedTargetRoot
      ? projectRecord({
        path: selectedTargetRoot,
        projectsRoot,
        selectedPath: selectedTargetRoot,
        source: selectionSource
      })
      : null;
  }

  function requestContextMatchesSelectedProject(context = {}) {
    if (selectionSource !== "explicit" || !selectedTargetRoot) {
      return false;
    }
    const contextTargetRoot = String(context?.targetRoot || "").trim();
    const contextSlug = String(context?.slug || "").trim();
    const selected = selectedProject();
    return Boolean(
      selected?.slug &&
      contextSlug === selected.slug &&
      (!contextTargetRoot || normalizeRoot(contextTargetRoot) === normalizeRoot(selectedTargetRoot))
    );
  }

  async function currentProjectRecord() {
    return selectedTargetRoot
      ? selectedProjectRecord({
        path: selectedTargetRoot,
        projectRecordPath: projectRecordPathForTarget(selectedTargetRoot),
        projectRuntimeRoot: projectRuntimeRootForTarget(selectedTargetRoot),
        projectSessionSourceRoot: projectSessionSourceRootForTarget(selectedTargetRoot),
        projectsRoot,
        selectedPath: selectedTargetRoot,
        sourceConfigRoot: sourceConfigRootForTarget(selectedTargetRoot),
        sourceRoot: sourceRootForTarget(selectedTargetRoot),
        source: selectionSource
      })
      : null;
  }

  async function listProjects() {
    if (!projectCatalogEnabled) {
      const selected = await currentProjectRecord();
      return {
        ok: true,
        currentProject: selected,
        hasSelection: Boolean(selected),
        projects: selected ? [selected] : [],
        projectsRoot,
        targetRoot: selectedTargetRoot
      };
    }

    const listed = await listWorkspaceProjects();
    const projects = listed.projects
      .map((entry) => {
        const selectionRecord = projectRecord({
          path: entry.projectRoot,
          projectsRoot,
          selectedPath: selectedTargetRoot,
          source: "workspace"
        });
        return {
          ...selectionRecord,
          ...entry,
          external: selectionRecord.external,
          name: selectionRecord.name,
          selected: selectionRecord.selected,
          source: "workspace"
        };
      })
      .sort((left, right) => left.slug.localeCompare(right.slug));
    const selected = projects.find((project) => project.selected) || await currentProjectRecord();
    return {
      ok: true,
      currentProject: selected,
      hasSelection: Boolean(selected),
      projects,
      projectsRoot: listed.projectsRoot,
      targetRoot: selectedTargetRoot
    };
  }

  async function listWorkspaceProjects() {
    if (!projectCatalogEnabled) {
      return {
        ok: true,
        projects: [],
        projectsRoot
      };
    }

    await mkdir(projectsRoot, {
      recursive: true
    });
    const entries = await readdir(projectsRoot, {
      withFileTypes: true
    });
    const projectPaths = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectsRoot, entry.name))
      .filter((entry) => {
        try {
          normalizeProjectSlug(path.basename(entry));
          return true;
        } catch {
          return false;
        }
      });
    const projects = (await Promise.all(projectPaths.map((projectPath) => workspaceProjectRecordForPath({
      projectRecordPath: projectRecordPathForTarget(projectPath),
      path: projectPath,
      projectRuntimeRoot: projectRuntimeRootForTarget(projectPath),
      projectSessionSourceRoot: projectSessionSourceRootForTarget(projectPath),
      projectsRoot
    }))))
      .filter((project) => project.repository)
      .sort((left, right) => left.slug.localeCompare(right.slug));
    return {
      ok: true,
      projects,
      projectsRoot
    };
  }

  async function createWorkspaceProjectRecord(input = {}) {
    if (!projectCatalogEnabled) {
      throw projectCatalogUnavailableError();
    }

    const slug = projectSlugFromInput(input);
    const targetRoot = resolveProjectRoot({
      projectsRoot,
      slug
    });
    const projectRuntimeRoot = projectRuntimeRootForSlug(slug);
    if (await pathExists(targetRoot) || await pathExists(projectRuntimeRoot)) {
      throw projectSlugExistsError();
    }
    const applicationMode = requireProjectApplicationMode(
      input.applicationMode || PROJECT_APPLICATION_MODE_NEW
    );
    const metadataInput = {
      ...input
    };
    delete metadataInput.applicationMode;
    const metadata = projectMetadataFromInput({
      ...metadataInput,
      bootstrap: createProjectBootstrap(applicationMode)
    }, {
      defaultRepositoryBranch: PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH,
      defaultRepositoryMode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
    });
    let project = null;
    let sourceCreated = false;
    let runtimeCreated = false;
    try {
      await Promise.all([
        mkdir(projectsRoot, {
          recursive: true
        }),
        mkdir(path.dirname(projectRuntimeRoot), {
          recursive: true
        })
      ]);
      await mkdir(projectRuntimeRoot);
      runtimeCreated = true;
      await mkdir(targetRoot);
      sourceCreated = true;
      await writeProjectMetadata(projectRecordPathForSlug(slug), metadata);
      if (projectRepositoryView(metadata).repositoryMode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
        await ensureLocalSourceMainBranch(targetRoot);
      }
      project = await workspaceProjectRecordForPath({
        projectRecordPath: projectRecordPathForSlug(slug),
        path: targetRoot,
        projectRuntimeRoot: projectRuntimeRootForSlug(slug),
        projectSessionSourceRoot: projectSessionSourceRootForSlug(slug),
        projectsRoot
      });
    } catch (error) {
      await Promise.all([
        ...(sourceCreated ? [rm(targetRoot, {
          force: true,
          recursive: true
        })] : []),
        ...(runtimeCreated ? [rm(projectRuntimeRoot, {
          force: true,
          recursive: true
        })] : [])
      ]);
      if (error?.code === "EEXIST") {
        throw projectSlugExistsError();
      }
      throw error;
    }
    return {
      ok: true,
      project,
      projectsRoot
    };
  }

  async function assertWorkspaceProjectAvailable(input = {}) {
    const slug = projectSlugFromInput(input);
    if (
      await pathExists(projectRootForSlug(slug)) ||
      await pathExists(projectRuntimeRootForSlug(slug))
    ) {
      throw projectSlugExistsError();
    }
    return {
      slug,
      targetRoot: projectRootForSlug(slug)
    };
  }

  async function readWorkspaceProject(input = {}) {
    if (!projectCatalogEnabled) {
      throw projectCatalogUnavailableError();
    }

    const slug = projectSlugFromInput(input);
    const targetRoot = resolveProjectRoot({
      projectsRoot,
      slug
    });
    await assertDirectoryUsable(targetRoot);
    const project = await workspaceProjectRecordForPath({
      projectRecordPath: projectRecordPathForSlug(slug),
      path: targetRoot,
      projectRuntimeRoot: projectRuntimeRootForSlug(slug),
      projectSessionSourceRoot: projectSessionSourceRootForSlug(slug),
      projectsRoot
    });
    if (project.deletion && input.allowDeleting !== true) {
      throw projectDeletingError();
    }
    if (!project.repository) {
      const error = new Error("Vibe64 projects must have repository metadata.");
      error.code = "vibe64_project_repository_missing";
      throw error;
    }
    return {
      ok: true,
      project,
      projectsRoot
    };
  }

  async function updateWorkspaceProjectMetadata(input = {}) {
    if (!projectCatalogEnabled) {
      throw projectCatalogUnavailableError();
    }

    const slug = projectSlugFromInput(input);
    const targetRoot = resolveProjectRoot({
      projectsRoot,
      slug
    });
    await assertDirectoryUsable(targetRoot);
    await updateWorkspaceProjectState({ slug }, async (currentMetadata) => {
      const metadata = {
        ...currentMetadata,
        ...projectMetadataFromInput(input)
      };
      if (projectRepositoryView(metadata).repositoryMode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
        await ensureLocalSourceMainBranch(targetRoot);
      }
      return metadata;
    });
    const project = await workspaceProjectRecordForPath({
      projectRecordPath: projectRecordPathForSlug(slug),
      path: targetRoot,
      projectRuntimeRoot: projectRuntimeRootForSlug(slug),
      projectSessionSourceRoot: projectSessionSourceRootForSlug(slug),
      projectsRoot
    });
    return {
      ok: true,
      project,
      projectsRoot
    };
  }

  async function readWorkspaceProjectState(input = {}) {
    if (!projectCatalogEnabled) {
      throw projectCatalogUnavailableError();
    }
    const slug = projectSlugFromInput(input);
    return {
      metadata: await readProjectMetadata({
        projectRecordPath: projectRecordPathForSlug(slug)
      }),
      projectRecordPath: projectRecordPathForSlug(slug),
      projectRuntimeRoot: projectRuntimeRootForSlug(slug),
      projectStateRoot: projectRuntimeRootForSlug(slug),
      slug,
      targetRoot: projectRootForSlug(slug)
    };
  }

  async function updateWorkspaceProjectState(input = {}, update, {
    allowDeleting = false
  } = {}) {
    if (!projectCatalogEnabled) {
      throw projectCatalogUnavailableError();
    }
    if (typeof update !== "function") {
      throw new TypeError("updateWorkspaceProjectState requires an update function.");
    }
    const slug = projectSlugFromInput(input);
    const state = {
      projectRecordPath: projectRecordPathForSlug(slug),
      projectRuntimeRoot: projectRuntimeRootForSlug(slug),
      projectStateRoot: projectRuntimeRootForSlug(slug),
      slug,
      targetRoot: projectRootForSlug(slug)
    };
    const metadata = await updateProjectRecordMetadata(state.projectRecordPath, async (current) => {
      const currentMetadata = normalizeProjectMetadata(current);
      if (!Object.keys(currentMetadata).length) {
        throw projectStateMissingError(state.slug);
      }
      if (currentMetadata.deletion && !allowDeleting) {
        throw projectDeletingError();
      }
      return normalizeProjectMetadata(await update(currentMetadata, {
        ...state,
        metadata: currentMetadata
      }));
    });
    return {
      ...state,
      metadata
    };
  }

  async function recordWorkspaceProjectTemplate(input = {}) {
    return updateWorkspaceProjectState(input, (metadata) => ({
      ...metadata,
      bootstrap: projectBootstrapWithTemplate(metadata.bootstrap, {
        commit: input.commit
      })
    }));
  }

  async function completeWorkspaceProjectBootstrap(input = {}) {
    return updateWorkspaceProjectState(input, (metadata) => ({
      ...metadata,
      bootstrap: completedProjectBootstrap(metadata.bootstrap)
    }));
  }

  async function beginWorkspaceProjectDeletion(input = {}) {
    return updateWorkspaceProjectState(input, (metadata) => ({
      ...metadata,
      deletion: metadata.deletion || normalizeProjectDeletion({
        startedAt: input.startedAt || new Date().toISOString(),
        steps: {}
      })
    }), {
      allowDeleting: true
    });
  }

  async function completeWorkspaceProjectDeletionStep(input = {}) {
    const step = String(input.step || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(step)) {
      const error = new Error("Project deletion step is invalid.");
      error.code = "vibe64_project_deletion_step_invalid";
      throw error;
    }
    return updateWorkspaceProjectState(input, (metadata) => ({
      ...metadata,
      deletion: normalizeProjectDeletion({
        ...metadata.deletion,
        steps: {
          ...metadata.deletion?.steps,
          [step]: input.completedAt || new Date().toISOString()
        }
      })
    }), {
      allowDeleting: true
    });
  }

  async function discardWorkspaceProjectRecord(input = {}) {
    const state = await readWorkspaceProjectState(input);
    if (!Object.keys(state.metadata).length) {
      throw projectStateMissingError(state.slug);
    }
    if (state.metadata.deletion) {
      const error = new Error("Project creation cleanup cannot remove a project being deleted.");
      error.code = "vibe64_project_deleting";
      throw error;
    }
    await Promise.all([
      rm(state.targetRoot, {
        force: true,
        recursive: true
      }),
      rm(state.projectStateRoot, {
        force: true,
        recursive: true
      })
    ]);
  }

  async function selectWorkspaceProject(input = {}) {
    if (!projectCatalogEnabled) {
      throw projectCatalogUnavailableError();
    }

    const slug = normalizeProjectSlug(input?.slug || input?.projectSlug || input?.name);
    const targetRoot = resolveProjectRoot({
      projectsRoot,
      slug
    });
    if (!pathInsideOrEqual(projectsRoot, targetRoot)) {
      const error = new Error("Project folder must be inside the Studio projects root.");
      error.code = "vibe64_project_outside_projects_root";
      throw error;
    }
    await assertDirectoryUsable(targetRoot);
    selectedTargetRoot = targetRoot;
    selectionSource = "workspace";
    return listProjects();
  }

  async function createWorkspaceProject(input = {}) {
    if (!projectCatalogEnabled) {
      throw projectCatalogUnavailableError();
    }

    const created = await createWorkspaceProjectRecord({
      ...input,
      applicationMode: PROJECT_APPLICATION_MODE_NEW
    });
    selectedTargetRoot = created.project.projectRoot;
    selectionSource = "workspace";
    return listProjects();
  }

  function requireSelectedTargetRoot() {
    if (!selectedTargetRoot) {
      const error = new Error("Choose a project before using project tools.");
      error.code = "vibe64_project_not_selected";
      throw error;
    }
    return selectedTargetRoot;
  }

  return Object.freeze({
    assertWorkspaceProjectAvailable,
    beginWorkspaceProjectDeletion,
    completeWorkspaceProjectBootstrap,
    completeWorkspaceProjectDeletionStep,
    createWorkspaceProject,
    createWorkspaceProjectRecord,
    discardWorkspaceProjectRecord,
    get projectsRoot() {
      return projectsRoot;
    },
    get projectCatalogEnabled() {
      return projectCatalogEnabled;
    },
    get systemRoot() {
      return systemRoot;
    },
    get serviceDataRoot() {
      return roots.serviceDataRoot;
    },
    get managedSourceRoot() {
      return managedSourceRoot;
    },
    get selectedProject() {
      return selectedProject();
    },
    get selectionSource() {
      return selectionSource;
    },
    get runtimeProfile() {
      return runtimeProfile;
    },
    requestContextMatchesSelectedProject,
    get targetRoot() {
      return selectedTargetRoot;
    },
    hasSelection() {
      return Boolean(selectedTargetRoot);
    },
    listProjects,
    listWorkspaceProjects,
    readWorkspaceProject,
    readWorkspaceProjectState,
    recordWorkspaceProjectTemplate,
    requireSelectedTargetRoot,
    selectWorkspaceProject,
    updateWorkspaceProjectMetadata,
    projectRecordPathForSlug,
    projectRecordPathForTarget,
    projectLocalRootForSlug,
    projectLocalRootForTarget,
    projectRuntimeRootForSlug,
    projectRuntimeRootForTarget,
    projectSessionSourceRootForSlug,
    projectSessionSourceRootForTarget,
    sourceConfigRootForSlug,
    sourceConfigRootForTarget,
    sourceRootForSlug,
    sourceRootForTarget
  });
}

function configureStudioProjectContext(options = {}) {
  configuredContext = createStudioProjectContext(options);
  return configuredContext;
}

function getStudioProjectContext() {
  if (!configuredContext) {
    configuredContext = createStudioProjectContext();
  }
  return configuredContext;
}

export {
  PROJECT_SLUG_MAX_LENGTH,
  configureStudioProjectContext,
  createStudioProjectContext,
  getStudioProjectContext,
  normalizeProjectSlug,
  pathInsideOrEqual,
  projectSlugFromName,
  resolveStudioProjectsRoot,
  resolveProjectRoot,
  assertProjectDirectoryUsable
};
