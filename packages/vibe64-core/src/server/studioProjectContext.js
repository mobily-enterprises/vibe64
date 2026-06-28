import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  VIBE64_PROJECTS_ROOT_ENV,
  resolveDefaultLocalEditorProjectsRoot,
  resolveVibe64Roots,
  resolveExplicitStudioTargetRoot
} from "./studioRoots.js";
import {
  resolveOnlineProjectRecordPath,
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
  normalizeProjectBootstrapConfig
} from "./projectBootstrapConfig.js";

const PROJECT_SLUG_MAX_LENGTH = 48;
const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const EXTERNAL_PROJECT_LOCAL_ROOTS_DIR = "projects";
const execFileAsync = promisify(execFile);

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

async function directoryExists(directoryPath = "") {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
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
  onlineProjectRecordPath = "",
  projectRuntimeRoot = "",
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
    onlineProjectRecordPath,
    writeDerivedMetadata: false
  });
  const runtime = publicProjectRuntimeOpenState(await readProjectRuntimeOpenState({
    projectLocalRoot: projectRuntimeRoot || resolvedPath
  }));
  const githubRepository = normalizeProjectGithubRepository(metadata?.githubRepository);
  return {
    ...selectionRecord,
    ...(githubRepository ? { githubRepository } : {}),
    onlineProjectRecordPath,
    projectLocalRoot: projectRuntimeRoot,
    projectRuntimeRoot,
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
  onlineProjectRecordPath = "",
  path: projectPath = "",
  projectRuntimeRoot = "",
  projectsRoot = "",
  runtime = {}
} = {}) {
  const resolvedPath = normalizeRoot(projectPath);
  return {
    ...(normalizeProjectBootstrapConfig(metadata?.bootstrapConfig)
      ? { bootstrapConfig: normalizeProjectBootstrapConfig(metadata.bootstrapConfig) }
      : {}),
    githubRepository: normalizeProjectGithubRepository(metadata?.githubRepository),
    gitCacheRoot: projectRuntimeRoot
      ? resolveProjectGitCacheRoot({
          projectRuntimeRoot
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
    onlineProjectRecordPath,
    projectRuntimeRoot,
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
    sessionsRoot: projectRuntimeRoot
      ? resolveProjectSessionsRoot({
          projectRuntimeRoot
        })
      : "",
    slug: path.basename(resolvedPath)
  };
}

function projectMetadataPath(onlineProjectRecordPath = "") {
  const normalizedRecordPath = String(onlineProjectRecordPath || "").trim();
  return normalizedRecordPath ? path.resolve(normalizedRecordPath) : "";
}

function normalizeProjectGithubRepository(value = {}) {
  const fullName = String(value?.fullName || "").trim();
  const owner = String(value?.owner || "").trim();
  const name = String(value?.name || "").trim();
  if (!fullName && (!owner || !name)) {
    return null;
  }
  const normalizedFullName = fullName || `${owner}/${name}`;
  return {
    canPush: value?.canPush === true,
    cloneUrl: String(value?.cloneUrl || "").trim(),
    defaultBranch: String(value?.defaultBranch || "").trim(),
    fullName: normalizedFullName,
    isPrivate: value?.isPrivate === true,
    name: name || normalizedFullName.split("/").pop() || "",
    owner: owner || normalizedFullName.split("/")[0] || "",
    source: String(value?.source || "").trim(),
    url: String(value?.url || "").trim(),
    viewerPermission: String(value?.viewerPermission || "").trim().toUpperCase(),
    visibility: String(value?.visibility || "").trim().toLowerCase()
  };
}

function projectMetadataFromInput(input = {}) {
  const githubRepository = normalizeProjectGithubRepository(input?.githubRepository);
  const bootstrapConfig = normalizeProjectBootstrapConfig(input?.bootstrapConfig);
  return {
    ...(githubRepository ? { githubRepository } : {}),
    ...(bootstrapConfig ? { bootstrapConfig } : {})
  };
}

async function readJsonFile(filePath = "") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      return {};
    }
    throw error;
  }
}

async function readProjectMetadata({
  onlineProjectRecordPath = ""
} = {}) {
  const metadataPath = projectMetadataPath(onlineProjectRecordPath);
  if (!metadataPath) {
    return {};
  }
  return readJsonFile(metadataPath);
}

async function writeProjectMetadata(onlineProjectRecordPath = "", metadata = {}) {
  const metadataPath = projectMetadataPath(onlineProjectRecordPath);
  if (!metadataPath) {
    throw new Error("writeProjectMetadata requires onlineProjectRecordPath.");
  }
  const normalizedMetadata = projectMetadataFromInput(metadata);
  await mkdir(path.dirname(metadataPath), {
    recursive: true
  });
  await writeFile(
    metadataPath,
    `${JSON.stringify(normalizedMetadata, null, 2)}\n`,
    "utf8"
  );
  return normalizedMetadata;
}

async function workspaceProjectRecordForPath({
  onlineProjectRecordPath = "",
  path: projectPath = "",
  projectRuntimeRoot = "",
  projectsRoot = "",
  writeDerivedMetadata = false
} = {}) {
  const resolvedPath = normalizeRoot(projectPath);
  const metadata = await projectMetadataWithGitRemote(resolvedPath, {
    onlineProjectRecordPath,
    writeDerivedMetadata
  });
  const runtime = await readProjectRuntimeOpenState({
    projectLocalRoot: projectRuntimeRoot || resolvedPath
  });
  return workspaceProjectRecord({
    metadata,
    onlineProjectRecordPath,
    path: resolvedPath,
    projectRuntimeRoot: projectRuntimeRoot || resolvedPath,
    projectsRoot,
    runtime
  });
}

async function projectMetadataWithGitRemote(projectPath = "", {
  onlineProjectRecordPath = "",
  writeDerivedMetadata = false
} = {}) {
  const metadata = await readProjectMetadata({
    onlineProjectRecordPath
  });
  if (normalizeProjectGithubRepository(metadata?.githubRepository)) {
    return metadata;
  }
  const githubRepository = await githubRepositoryFromGitRemotes(projectPath);
  if (!githubRepository) {
    return metadata;
  }
  const derivedMetadata = {
    ...metadata,
    githubRepository
  };
  if (writeDerivedMetadata) {
    await writeProjectMetadata(onlineProjectRecordPath, derivedMetadata);
  }
  return derivedMetadata;
}

async function githubRepositoryFromGitRemotes(projectPath = "") {
  const insideGit = await runGit(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  if (insideGit !== "true") {
    return null;
  }

  const originUrl = await runGit(projectPath, ["remote", "get-url", "origin"]);
  const originRepository = githubRepositoryFromRemoteUrl(originUrl, {
    remoteName: "origin"
  });
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
    const repository = githubRepositoryFromRemoteUrl(await runGit(projectPath, ["remote", "get-url", remoteName]), {
      remoteName
    });
    if (repository && !githubRepositories.some((existing) => existing.fullName === repository.fullName)) {
      githubRepositories.push(repository);
    }
  }
  return githubRepositories.length === 1 ? githubRepositories[0] : null;
}

function githubRepositoryFromRemoteUrl(remoteUrl = "", {
  remoteName = ""
} = {}) {
  const parsed = parseGithubRemote(remoteUrl);
  if (!parsed) {
    return null;
  }
  return {
    canPush: false,
    cloneUrl: `https://github.com/${parsed.fullName}.git`,
    defaultBranch: "",
    fullName: parsed.fullName,
    isPrivate: false,
    name: parsed.name,
    owner: parsed.owner,
    source: remoteName ? `git-remote:${remoteName}` : "git-remote",
    url: `https://github.com/${parsed.fullName}`,
    viewerPermission: "",
    visibility: ""
  };
}

async function runGit(cwd = "", args = []) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: normalizeRoot(cwd),
      timeout: 5000
    });
    return String(result.stdout || "").trim();
  } catch {
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

function createStudioProjectContext({
  cwd = process.cwd(),
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
  const systemRoot = resolveVibe64Roots({
    env,
    explicitSystemRoot,
    home,
    projectsRoot,
    runtimeProfile
  }).systemRoot;
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

  function projectRootForSlug(slug = "") {
    return resolveProjectRoot({
      projectsRoot,
      slug: normalizeProjectSlug(slug)
    });
  }

  function onlineProjectRecordPathForSlug(slug = "") {
    return resolveOnlineProjectRecordPath({
      projectRoot: projectRootForSlug(slug)
    });
  }

  function onlineProjectRecordPathForTarget(targetRoot = "") {
    return targetIsCatalogProjectHome(targetRoot)
      ? resolveOnlineProjectRecordPath({
          projectRoot: normalizeRoot(targetRoot)
        })
      : "";
  }

  function projectRuntimeRootForSlug(slug = "") {
    return resolveProjectRuntimeRoot({
      projectRoot: projectRootForSlug(slug)
    });
  }

  function projectRuntimeRootForTarget(targetRoot = "") {
    return targetIsCatalogProjectHome(targetRoot)
      ? resolveProjectRuntimeRoot({
          projectRoot: normalizeRoot(targetRoot)
        })
      : externalProjectRuntimeRootForTarget(targetRoot);
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

  function projectStateRootForSlug(slug = "") {
    return sourceConfigRootForSlug(slug);
  }

  function projectLocalRootForSlug(slug = "") {
    return projectRuntimeRootForSlug(slug);
  }

  function projectStateRootForTarget(targetRoot = "") {
    return sourceConfigRootForTarget(targetRoot);
  }

  function projectLocalRootForTarget(targetRoot = "") {
    return projectRuntimeRootForTarget(targetRoot);
  }

  async function ensureProjectStateForSlug(slug = "") {
    const normalizedSlug = normalizeProjectSlug(slug);
    const targetRoot = projectRootForSlug(normalizedSlug);
    const projectRuntimeRoot = projectRuntimeRootForSlug(normalizedSlug);
    await mkdir(projectRuntimeRoot, {
      recursive: true
    });
    return {
      onlineProjectRecordPath: onlineProjectRecordPathForSlug(normalizedSlug),
      projectLocalRoot: projectRuntimeRoot,
      projectRuntimeRoot,
      projectStateRoot: "",
      sourceConfigRoot: "",
      sourceRoot: "",
      targetRoot
    };
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
        onlineProjectRecordPath: onlineProjectRecordPathForTarget(selectedTargetRoot),
        projectRuntimeRoot: projectRuntimeRootForTarget(selectedTargetRoot),
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
      onlineProjectRecordPath: onlineProjectRecordPathForTarget(projectPath),
      path: projectPath,
      projectRuntimeRoot: projectRuntimeRootForTarget(projectPath),
      projectsRoot
    }))))
      .filter((project) => project.githubRepository)
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
    if (await directoryExists(targetRoot)) {
      await assertDirectoryUsable(targetRoot);
    } else {
      await mkdir(targetRoot, {
        recursive: true
      });
    }
    const metadata = projectMetadataFromInput(input);
    if (Object.keys(metadata).length > 0) {
      await writeProjectMetadata(onlineProjectRecordPathForSlug(slug), metadata);
    }
    await ensureProjectStateForSlug(slug);
    const project = await workspaceProjectRecordForPath({
      onlineProjectRecordPath: onlineProjectRecordPathForSlug(slug),
      path: targetRoot,
      projectRuntimeRoot: projectRuntimeRootForSlug(slug),
      projectsRoot
    });
    return {
      ok: true,
      project,
      projectsRoot
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
      onlineProjectRecordPath: onlineProjectRecordPathForSlug(slug),
      path: targetRoot,
      projectRuntimeRoot: projectRuntimeRootForSlug(slug),
      projectsRoot
    });
    if (!project.githubRepository) {
      const error = new Error("Vibe64 projects must be linked to a GitHub repository.");
      error.code = "vibe64_project_not_github_backed";
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
    await writeProjectMetadata(onlineProjectRecordPathForSlug(slug), input);
    const project = await workspaceProjectRecordForPath({
      onlineProjectRecordPath: onlineProjectRecordPathForSlug(slug),
      path: targetRoot,
      projectRuntimeRoot: projectRuntimeRootForSlug(slug),
      projectsRoot
    });
    return {
      ok: true,
      project,
      projectsRoot
    };
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

    const created = await createWorkspaceProjectRecord(input);
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
    createWorkspaceProject,
    createWorkspaceProjectRecord,
    get projectsRoot() {
      return projectsRoot;
    },
    get projectCatalogEnabled() {
      return projectCatalogEnabled;
    },
    get systemRoot() {
      return systemRoot;
    },
    ensureProjectStateForSlug,
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
    requireSelectedTargetRoot,
    selectWorkspaceProject,
    updateWorkspaceProjectMetadata,
    onlineProjectRecordPathForSlug,
    onlineProjectRecordPathForTarget,
    projectLocalRootForSlug,
    projectLocalRootForTarget,
    projectRuntimeRootForSlug,
    projectRuntimeRootForTarget,
    projectStateRootForSlug,
    projectStateRootForTarget,
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
