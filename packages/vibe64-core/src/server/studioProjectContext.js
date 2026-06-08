import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  VIBE64_PROJECTS_ROOT_ENV,
  resolveExplicitStudioTargetRoot
} from "./studioRoots.js";

const WORKSPACE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const WORKSPACE_METADATA_PATH = [".vibe64", "workspace.json"];

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

function workspaceSlugFromName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeWorkspaceSlug(value = "") {
  const slug = String(value || "").trim();
  if (!WORKSPACE_SLUG_PATTERN.test(slug)) {
    const error = new Error("Workspace slug must start with a lowercase letter or number and contain only lowercase letters, numbers, underscores, or dashes.");
    error.code = "vibe64_invalid_workspace_slug";
    throw error;
  }
  return slug;
}

function projectSlugFromName(value = "") {
  return workspaceSlugFromName(value);
}

function normalizeProjectSlug(value = "") {
  try {
    return normalizeWorkspaceSlug(value);
  } catch (error) {
    if (error?.code === "vibe64_invalid_workspace_slug") {
      error.code = "vibe64_invalid_project_slug";
    }
    throw error;
  }
}

function workspaceSlugFromInput(input = {}) {
  const explicitSlug = String(input?.slug || input?.projectSlug || "").trim();
  if (explicitSlug) {
    return normalizeWorkspaceSlug(explicitSlug);
  }
  return normalizeWorkspaceSlug(workspaceSlugFromName(input?.name));
}

function resolveWorkspaceRoot({
  projectsRoot = "",
  slug = ""
} = {}) {
  const normalizedProjectsRoot = normalizeRoot(projectsRoot || resolveStudioProjectsRoot());
  const normalizedSlug = normalizeWorkspaceSlug(slug);
  const workspaceRoot = path.resolve(normalizedProjectsRoot, normalizedSlug);
  if (!pathInsideOrEqual(normalizedProjectsRoot, workspaceRoot)) {
    const error = new Error("Workspace root must be inside the Vibe64 workspace root.");
    error.code = "vibe64_workspace_outside_root";
    throw error;
  }
  return workspaceRoot;
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

async function assertWorkspaceDirectoryUsable(directoryPath = "") {
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

function workspaceRecord({
  metadata = {},
  path: workspacePath = "",
  projectsRoot = ""
} = {}) {
  const resolvedPath = normalizeRoot(workspacePath);
  return {
    githubRepository: normalizeWorkspaceGithubRepository(metadata?.githubRepository),
    path: resolvedPath,
    slug: path.basename(resolvedPath),
    workspaceRoot: resolvedPath,
    workspaceRootRelative: path.relative(normalizeRoot(projectsRoot), resolvedPath)
  };
}

function workspaceMetadataPath(workspaceRoot = "") {
  return path.join(normalizeRoot(workspaceRoot), ...WORKSPACE_METADATA_PATH);
}

function normalizeWorkspaceGithubRepository(value = {}) {
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

function workspaceMetadataFromInput(input = {}) {
  const githubRepository = normalizeWorkspaceGithubRepository(input?.githubRepository);
  return githubRepository
    ? {
        githubRepository
      }
    : {};
}

async function readWorkspaceMetadata(workspaceRoot = "") {
  try {
    return JSON.parse(await readFile(workspaceMetadataPath(workspaceRoot), "utf8"));
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

async function writeWorkspaceMetadata(workspaceRoot = "", metadata = {}) {
  const normalizedMetadata = workspaceMetadataFromInput(metadata);
  await mkdir(path.dirname(workspaceMetadataPath(workspaceRoot)), {
    recursive: true
  });
  await writeFile(
    workspaceMetadataPath(workspaceRoot),
    `${JSON.stringify(normalizedMetadata, null, 2)}\n`,
    "utf8"
  );
  return normalizedMetadata;
}

async function workspaceRecordForPath({
  path: workspacePath = "",
  projectsRoot = ""
} = {}) {
  return workspaceRecord({
    metadata: await readWorkspaceMetadata(workspacePath),
    path: workspacePath,
    projectsRoot
  });
}

function createStudioProjectContext({
  cwd = process.cwd(),
  env = process.env,
  explicitProjectsRoot = "",
  explicitTargetRoot = "",
  home = os.homedir()
} = {}) {
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
    const listed = await listManagedWorkspaces();
    const projects = listed.workspaces
      .map((entry) => projectRecord({
        path: entry.workspaceRoot,
        projectsRoot,
        selectedPath: selectedTargetRoot,
        source: "managed"
      }))
      .sort((left, right) => left.slug.localeCompare(right.slug));
    const selected = selectedProject();
    return {
      ok: true,
      currentProject: selected,
      hasSelection: Boolean(selected),
      projects,
      projectsRoot: listed.projectsRoot,
      targetRoot: selectedTargetRoot
    };
  }

  async function listManagedWorkspaces() {
    await mkdir(projectsRoot, {
      recursive: true
    });
    const entries = await readdir(projectsRoot, {
      withFileTypes: true
    });
    const workspacePaths = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectsRoot, entry.name))
      .filter((entry) => {
        try {
          normalizeWorkspaceSlug(path.basename(entry));
          return true;
        } catch {
          return false;
        }
      });
    const workspaces = (await Promise.all(workspacePaths.map((workspacePath) => workspaceRecordForPath({
      path: workspacePath,
      projectsRoot
    }))))
      .sort((left, right) => left.slug.localeCompare(right.slug));
    return {
      ok: true,
      projectsRoot,
      workspaces
    };
  }

  async function createManagedWorkspace(input = {}) {
    const slug = workspaceSlugFromInput(input);
    const targetRoot = resolveWorkspaceRoot({
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
    const metadata = workspaceMetadataFromInput(input);
    if (Object.keys(metadata).length > 0) {
      await writeWorkspaceMetadata(targetRoot, metadata);
    }
    return {
      ok: true,
      projectsRoot,
      workspace: await workspaceRecordForPath({
        path: targetRoot,
        projectsRoot
      })
    };
  }

  async function updateManagedWorkspaceMetadata(input = {}) {
    const slug = workspaceSlugFromInput(input);
    const targetRoot = resolveWorkspaceRoot({
      projectsRoot,
      slug
    });
    await assertDirectoryUsable(targetRoot);
    await writeWorkspaceMetadata(targetRoot, input);
    return {
      ok: true,
      projectsRoot,
      workspace: await workspaceRecordForPath({
        path: targetRoot,
        projectsRoot
      })
    };
  }

  async function selectManagedProject(input = {}) {
    const slug = normalizeProjectSlug(input?.slug || input?.projectSlug || input?.name);
    const targetRoot = resolveWorkspaceRoot({
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
    let created;
    try {
      created = await createManagedWorkspace(input);
    } catch (error) {
      if (error?.code === "vibe64_invalid_workspace_slug") {
        error.code = "vibe64_invalid_project_slug";
      }
      throw error;
    }
    selectedTargetRoot = created.workspace.workspaceRoot;
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
    createManagedWorkspace,
    get projectsRoot() {
      return projectsRoot;
    },
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
    listManagedWorkspaces,
    requireSelectedTargetRoot,
    selectManagedProject,
    updateManagedWorkspaceMetadata
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
  normalizeWorkspaceSlug,
  pathInsideOrEqual,
  projectSlugFromName,
  resolveStudioProjectsRoot,
  resolveWorkspaceRoot,
  assertWorkspaceDirectoryUsable,
  workspaceSlugFromName
};
