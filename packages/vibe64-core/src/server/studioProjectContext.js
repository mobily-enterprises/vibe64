import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { access, lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  VIBE64_PROJECTS_ROOT_ENV,
  resolveVibe64DataRoot,
  resolveExplicitStudioTargetRoot
} from "./studioRoots.js";
import {
  resolveExternalProjectStateRoot,
  resolveProjectStateRoot
} from "./projectState.js";

const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const PROJECT_METADATA_FILE = "project.json";
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
  const insideProjectsRoot = pathInsideOrEqual(projectsRoot, resolvedPath);
  return {
    external: !insideProjectsRoot,
    name: path.basename(resolvedPath),
    path: resolvedPath,
    selected: selectedPath ? normalizeRoot(selectedPath) === resolvedPath : false,
    slug: path.basename(resolvedPath),
    source
  };
}

function managedProjectRecord({
  metadata = {},
  path: projectPath = "",
  projectsRoot = ""
} = {}) {
  const resolvedPath = normalizeRoot(projectPath);
  return {
    githubRepository: normalizeProjectGithubRepository(metadata?.githubRepository),
    path: resolvedPath,
    projectRoot: resolvedPath,
    projectRootRelative: path.relative(normalizeRoot(projectsRoot), resolvedPath),
    slug: path.basename(resolvedPath)
  };
}

function projectMetadataPath(projectStateRoot = "") {
  return path.join(normalizeRoot(projectStateRoot), PROJECT_METADATA_FILE);
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
  return githubRepository
    ? {
        githubRepository
      }
    : {};
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
  projectStateRoot = ""
} = {}) {
  if (!projectStateRoot) {
    return {};
  }
  return readJsonFile(projectMetadataPath(projectStateRoot));
}

async function writeProjectMetadata(projectStateRoot = "", metadata = {}) {
  if (!projectStateRoot) {
    throw new Error("writeProjectMetadata requires projectStateRoot.");
  }
  const normalizedMetadata = projectMetadataFromInput(metadata);
  await mkdir(path.dirname(projectMetadataPath(projectStateRoot)), {
    recursive: true
  });
  await writeFile(
    projectMetadataPath(projectStateRoot),
    `${JSON.stringify(normalizedMetadata, null, 2)}\n`,
    "utf8"
  );
  return normalizedMetadata;
}

async function managedProjectRecordForPath({
  path: projectPath = "",
  projectsRoot = "",
  projectStateRoot = "",
  writeDerivedMetadata = false
} = {}) {
  const metadata = await projectMetadataWithGitRemote(projectPath, {
    projectStateRoot,
    writeDerivedMetadata
  });
  return managedProjectRecord({
    metadata,
    path: projectPath,
    projectsRoot
  });
}

async function projectMetadataWithGitRemote(projectPath = "", {
  projectStateRoot = "",
  writeDerivedMetadata = false
} = {}) {
  const metadata = await readProjectMetadata({
    projectStateRoot
  });
  if (normalizeProjectGithubRepository(metadata?.githubRepository)) {
    return metadata;
  }
  const githubRepository = await githubRepositoryFromOrigin(projectPath);
  if (!githubRepository) {
    return metadata;
  }
  const derivedMetadata = {
    ...metadata,
    githubRepository
  };
  if (writeDerivedMetadata) {
    await writeProjectMetadata(projectStateRoot, derivedMetadata);
  }
  return derivedMetadata;
}

async function githubRepositoryFromOrigin(projectPath = "") {
  const insideGit = await runGit(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  if (insideGit !== "true") {
    return null;
  }
  const originUrl = await runGit(projectPath, ["remote", "get-url", "origin"]);
  const parsed = parseGithubRemote(originUrl);
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
    source: "git-remote",
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
  explicitDataRoot = "",
  env = process.env,
  explicitProjectsRoot = "",
  explicitTargetRoot = "",
  home = os.homedir()
} = {}) {
  const dataRoot = resolveVibe64DataRoot({
    env,
    explicitRoot: explicitDataRoot,
    home
  });
  const projectsRoot = resolveStudioProjectsRoot({
    env,
    explicitRoot: explicitProjectsRoot,
    home
  });
  let selectedTargetRoot = resolveExplicitStudioTargetRoot({
    cwd,
    env,
    explicitRoot: explicitTargetRoot
  });
  let selectionSource = selectedTargetRoot ? "explicit" : "";

  function projectStateRootForSlug(slug = "") {
    return resolveProjectStateRoot({
      dataRoot,
      env,
      home,
      slug
    });
  }

  function projectStateRootForTarget(targetRoot = "") {
    const normalizedTargetRoot = normalizeRoot(targetRoot);
    if (pathInsideOrEqual(projectsRoot, normalizedTargetRoot)) {
      try {
        return projectStateRootForSlug(path.basename(normalizedTargetRoot));
      } catch {
        // Explicit/dev targets inside the projects root can still have non-project names.
      }
    }
    return resolveExternalProjectStateRoot({
      dataRoot,
      env,
      home,
      targetRoot: normalizedTargetRoot
    });
  }

  async function ensureProjectStateForSlug(slug = "") {
    const normalizedSlug = normalizeProjectSlug(slug);
    const targetRoot = resolveProjectRoot({
      projectsRoot,
      slug: normalizedSlug
    });
    const projectStateRoot = projectStateRootForSlug(normalizedSlug);
    await mkdir(projectStateRoot, {
      recursive: true
    });
    return {
      projectStateRoot,
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

  async function listProjects() {
    const listed = await listManagedProjects();
    const projects = listed.projects
      .map((entry) => {
        const selectionRecord = projectRecord({
          path: entry.projectRoot,
          projectsRoot,
          selectedPath: selectedTargetRoot,
          source: "managed"
        });
        return {
          ...selectionRecord,
          ...entry,
          external: selectionRecord.external,
          name: selectionRecord.name,
          selected: selectionRecord.selected,
          source: "managed"
        };
      })
      .sort((left, right) => left.slug.localeCompare(right.slug));
    const selected = projects.find((project) => project.selected) || selectedProject();
    return {
      ok: true,
      currentProject: selected,
      hasSelection: Boolean(selected),
      projects,
      projectsRoot: listed.projectsRoot,
      targetRoot: selectedTargetRoot
    };
  }

  async function listManagedProjects() {
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
    const projects = (await Promise.all(projectPaths.map((projectPath) => managedProjectRecordForPath({
      path: projectPath,
      projectsRoot,
      projectStateRoot: projectStateRootForTarget(projectPath)
    }))))
      .filter((project) => project.githubRepository)
      .sort((left, right) => left.slug.localeCompare(right.slug));
    return {
      ok: true,
      projects,
      projectsRoot
    };
  }

  async function createManagedProjectRecord(input = {}) {
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
      await writeProjectMetadata(projectStateRootForSlug(slug), metadata);
    }
    const project = await managedProjectRecordForPath({
      path: targetRoot,
      projectsRoot,
      projectStateRoot: projectStateRootForSlug(slug)
    });
    return {
      ok: true,
      project,
      projectsRoot
    };
  }

  async function readManagedProject(input = {}) {
    const slug = projectSlugFromInput(input);
    const targetRoot = resolveProjectRoot({
      projectsRoot,
      slug
    });
    await assertDirectoryUsable(targetRoot);
    const project = await managedProjectRecordForPath({
      path: targetRoot,
      projectsRoot,
      projectStateRoot: projectStateRootForSlug(slug)
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

  async function updateManagedProjectMetadata(input = {}) {
    const slug = projectSlugFromInput(input);
    const targetRoot = resolveProjectRoot({
      projectsRoot,
      slug
    });
    await assertDirectoryUsable(targetRoot);
    await writeProjectMetadata(projectStateRootForSlug(slug), input);
    const project = await managedProjectRecordForPath({
      path: targetRoot,
      projectsRoot,
      projectStateRoot: projectStateRootForSlug(slug)
    });
    return {
      ok: true,
      project,
      projectsRoot
    };
  }

  async function selectManagedProject(input = {}) {
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
    selectionSource = "managed";
    return listProjects();
  }

  async function createManagedProject(input = {}) {
    const created = await createManagedProjectRecord(input);
    selectedTargetRoot = created.project.projectRoot;
    selectionSource = "managed";
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
    createManagedProject,
    createManagedProjectRecord,
    get dataRoot() {
      return dataRoot;
    },
    get projectsRoot() {
      return projectsRoot;
    },
    ensureProjectStateForSlug,
    get selectedProject() {
      return selectedProject();
    },
    get targetRoot() {
      return selectedTargetRoot;
    },
    hasSelection() {
      return Boolean(selectedTargetRoot);
    },
    listProjects,
    listManagedProjects,
    readManagedProject,
    requireSelectedTargetRoot,
    selectManagedProject,
    updateManagedProjectMetadata,
    projectStateRootForSlug,
    projectStateRootForTarget
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
