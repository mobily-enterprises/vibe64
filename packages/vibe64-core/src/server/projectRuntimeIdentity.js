import path from "node:path";
import process from "node:process";

import {
  currentProjectRequestContext
} from "./projectRequestContext.js";
import {
  normalizeProjectSlug,
  pathInsideOrEqual,
  projectSlugFromName,
  resolveStudioProjectsRoot
} from "./studioProjectContext.js";

function projectRuntimeIdentity(slug = "") {
  return `project:${normalizeProjectSlug(slug)}`;
}

function catalogProjectSlugFromTargetRoot(targetRoot = "", {
  projectsRoot = ""
} = {}) {
  const resolvedTargetRoot = path.resolve(String(targetRoot || "").trim() || process.cwd());
  const resolvedProjectsRoot = path.resolve(String(projectsRoot || "").trim() || resolveStudioProjectsRoot());
  if (!pathInsideOrEqual(resolvedProjectsRoot, resolvedTargetRoot)) {
    return "";
  }

  const relative = path.relative(resolvedProjectsRoot, resolvedTargetRoot);
  const [candidateSlug = ""] = relative.split(path.sep).filter(Boolean);
  if (!candidateSlug) {
    return "";
  }
  try {
    return normalizeProjectSlug(candidateSlug);
  } catch {
    return "";
  }
}

function targetRuntimeIdentity(targetRoot = "") {
  return projectRuntimeIdentity(targetRuntimeProjectSlug(targetRoot));
}

function targetRuntimeProjectSlug(targetRoot = "") {
  const resolvedTargetRoot = path.resolve(String(targetRoot || "").trim() || process.cwd());
  const projectContext = currentProjectRequestContext();
  const contextSlug = String(projectContext?.slug || "").trim();
  const contextTargetRoot = String(projectContext?.targetRoot || "").trim();
  if (
    contextSlug &&
    (!contextTargetRoot || pathInsideOrEqual(contextTargetRoot, resolvedTargetRoot))
  ) {
    return normalizeProjectSlug(contextSlug);
  }

  const catalogSlug = catalogProjectSlugFromTargetRoot(resolvedTargetRoot);
  if (catalogSlug) {
    return catalogSlug;
  }

  return normalizeProjectSlug(projectSlugFromName(path.basename(resolvedTargetRoot)));
}

export {
  catalogProjectSlugFromTargetRoot,
  targetRuntimeProjectSlug,
  targetRuntimeIdentity,
  projectRuntimeIdentity
};
