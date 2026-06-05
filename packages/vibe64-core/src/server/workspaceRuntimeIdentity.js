import path from "node:path";
import process from "node:process";

import {
  currentWorkspaceRequestContext
} from "./workspaceRequestContext.js";
import {
  normalizeWorkspaceSlug,
  pathInsideOrEqual,
  resolveStudioProjectsRoot
} from "./studioProjectContext.js";

function workspaceRuntimeIdentity(slug = "") {
  return `workspace:${normalizeWorkspaceSlug(slug)}`;
}

function managedWorkspaceSlugFromTargetRoot(targetRoot = "", {
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
    return normalizeWorkspaceSlug(candidateSlug);
  } catch {
    return "";
  }
}

function targetRuntimeIdentity(targetRoot = "") {
  const resolvedTargetRoot = path.resolve(String(targetRoot || "").trim() || process.cwd());
  const workspaceContext = currentWorkspaceRequestContext();
  const contextSlug = String(workspaceContext?.slug || "").trim();
  const contextTargetRoot = String(workspaceContext?.targetRoot || "").trim();
  if (
    contextSlug &&
    (!contextTargetRoot || pathInsideOrEqual(contextTargetRoot, resolvedTargetRoot))
  ) {
    return workspaceRuntimeIdentity(contextSlug);
  }

  const managedSlug = managedWorkspaceSlugFromTargetRoot(resolvedTargetRoot);
  if (managedSlug) {
    return workspaceRuntimeIdentity(managedSlug);
  }

  return `path:${resolvedTargetRoot}`;
}

export {
  managedWorkspaceSlugFromTargetRoot,
  targetRuntimeIdentity,
  workspaceRuntimeIdentity
};
