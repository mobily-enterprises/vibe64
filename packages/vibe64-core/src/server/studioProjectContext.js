import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  VIBE64_PROJECTS_ROOT_ENV,
  resolveExplicitStudioTargetRoot
} from "./studioRoots.js";

const PROJECT_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

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
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeProjectSlug(value = "") {
  const slug = String(value || "").trim();
  if (!PROJECT_SLUG_PATTERN.test(slug) || slug === "." || slug === "..") {
    const error = new Error("Project folder name must start with a letter or number and contain only letters, numbers, dots, underscores, or dashes.");
    error.code = "vibe64_invalid_project_slug";
    throw error;
  }
  return slug;
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
    await mkdir(projectsRoot, {
      recursive: true
    });
    const entries = await readdir(projectsRoot, {
      withFileTypes: true
    });
    const projects = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => projectRecord({
        path: path.join(projectsRoot, entry.name),
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
      projectsRoot,
      targetRoot: selectedTargetRoot
    };
  }

  async function selectManagedProject(input = {}) {
    const slug = normalizeProjectSlug(input?.slug || input?.projectSlug || input?.name);
    const targetRoot = path.join(projectsRoot, slug);
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
    const slug = normalizeProjectSlug(projectSlugFromName(input?.slug || input?.name));
    const targetRoot = path.join(projectsRoot, slug);
    if (!pathInsideOrEqual(projectsRoot, targetRoot)) {
      const error = new Error("Project folder must be inside the Studio projects root.");
      error.code = "vibe64_project_outside_projects_root";
      throw error;
    }
    if (await directoryExists(targetRoot)) {
      await assertDirectoryUsable(targetRoot);
      selectedTargetRoot = targetRoot;
      selectionSource = "managed";
      return listProjects();
    }
    await mkdir(targetRoot, {
      recursive: true
    });
    selectedTargetRoot = targetRoot;
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
    requireSelectedTargetRoot,
    selectManagedProject
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
  projectSlugFromName,
  resolveStudioProjectsRoot
};
