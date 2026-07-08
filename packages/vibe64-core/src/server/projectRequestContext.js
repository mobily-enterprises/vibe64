import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";

import {
  assertProjectDirectoryUsable,
  getStudioProjectContext,
  normalizeProjectSlug,
  resolveStudioProjectsRoot,
  resolveProjectRoot
} from "./studioProjectContext.js";

const VIBE64_PROJECT_ROUTE_BASE = "/app/:slug";
const projectContextStorage = new AsyncLocalStorage();

function projectSlugFromRequest(request = {}) {
  return normalizeProjectSlug(request.params?.slug);
}

async function resolveProjectRequestContext({
  projectContext = getStudioProjectContext(),
  request = {}
} = {}) {
  const slug = projectSlugFromRequest(request);
  const resolvedProjectContext = projectContext || getStudioProjectContext();
  const projectsRoot = String(
    resolvedProjectContext?.projectsRoot ||
    (resolvedProjectContext?.projectCatalogEnabled === false ? "" : resolveStudioProjectsRoot())
  ).trim();
  const explicitContext = explicitProjectRequestContextForSlug(resolvedProjectContext, slug, projectsRoot);
  if (explicitContext) {
    await assertProjectDirectoryUsable(explicitContext.targetRoot);
    if (explicitContext.projectRuntimeRoot) {
      await mkdir(explicitContext.projectRuntimeRoot, {
        recursive: true
      });
    }
    return explicitContext;
  }
  if (resolvedProjectContext?.projectCatalogEnabled === false) {
    const error = new Error("Local editor mode only serves the selected project.");
    error.code = "vibe64_project_route_unavailable";
    throw error;
  }
  const targetRoot = resolveProjectRoot({
    projectsRoot,
    slug
  });
  await assertProjectDirectoryUsable(targetRoot);
  if (typeof resolvedProjectContext.ensureProjectStateForSlug === "function") {
    await resolvedProjectContext.ensureProjectStateForSlug(slug);
  }
  const projectLocalRoot = typeof resolvedProjectContext.projectLocalRootForSlug === "function"
    ? resolvedProjectContext.projectLocalRootForSlug(slug)
    : "";
  const projectRuntimeRoot = typeof resolvedProjectContext.projectRuntimeRootForSlug === "function"
    ? resolvedProjectContext.projectRuntimeRootForSlug(slug)
    : projectLocalRoot;
  const projectSessionSourceRoot = typeof resolvedProjectContext.projectSessionSourceRootForSlug === "function"
    ? resolvedProjectContext.projectSessionSourceRootForSlug(slug)
    : targetRoot;
  const sourceRoot = typeof resolvedProjectContext.sourceRootForSlug === "function"
    ? resolvedProjectContext.sourceRootForSlug(slug)
    : "";
  const sourceConfigRoot = typeof resolvedProjectContext.sourceConfigRootForSlug === "function"
    ? resolvedProjectContext.sourceConfigRootForSlug(slug)
    : "";
  const projectRecordPath = typeof resolvedProjectContext.projectRecordPathForSlug === "function"
    ? resolvedProjectContext.projectRecordPathForSlug(slug)
    : "";
  return Object.freeze({
    projectRecordPath,
    projectLocalRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot,
    projectsRoot,
    slug,
    sourceConfigRoot,
    sourceRoot,
    systemRoot: String(resolvedProjectContext?.systemRoot || "").trim(),
    targetRoot
  });
}

function explicitProjectRequestContextForSlug(projectContext = {}, slug = "", projectsRoot = "") {
  const selectedProject = projectContext?.selectedProject || null;
  const targetRoot = String(projectContext?.targetRoot || "").trim();
  if (
    !targetRoot ||
    projectContext?.selectionSource !== "explicit" ||
    selectedProject?.slug !== slug
  ) {
    return null;
  }
  const projectLocalRoot = typeof projectContext.projectLocalRootForTarget === "function"
    ? projectContext.projectLocalRootForTarget(targetRoot)
    : "";
  const projectRuntimeRoot = typeof projectContext.projectRuntimeRootForTarget === "function"
    ? projectContext.projectRuntimeRootForTarget(targetRoot)
    : projectLocalRoot;
  const projectSessionSourceRoot = typeof projectContext.projectSessionSourceRootForTarget === "function"
    ? projectContext.projectSessionSourceRootForTarget(targetRoot)
    : targetRoot;
  const sourceRoot = typeof projectContext.sourceRootForTarget === "function"
    ? projectContext.sourceRootForTarget(targetRoot)
    : targetRoot;
  const sourceConfigRoot = typeof projectContext.sourceConfigRootForTarget === "function"
    ? projectContext.sourceConfigRootForTarget(targetRoot)
    : "";
  const projectRecordPath = typeof projectContext.projectRecordPathForTarget === "function"
    ? projectContext.projectRecordPathForTarget(targetRoot)
    : "";
  return Object.freeze({
    projectRecordPath,
    projectLocalRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot,
    projectsRoot,
    slug,
    sourceConfigRoot,
    sourceRoot,
    systemRoot: String(projectContext?.systemRoot || "").trim(),
    targetRoot
  });
}

function currentProjectRequestContext() {
  return projectContextStorage.getStore() || null;
}

function currentProjectTargetRoot() {
  return String(currentProjectRequestContext()?.targetRoot || "").trim();
}

function currentProjectLocalRoot() {
  return String(currentProjectRequestContext()?.projectLocalRoot || "").trim();
}

function currentProjectRuntimeRoot() {
  return String(currentProjectRequestContext()?.projectRuntimeRoot || "").trim();
}

function currentProjectSessionSourceRoot() {
  return String(currentProjectRequestContext()?.projectSessionSourceRoot || "").trim();
}

function currentProjectSourceRoot() {
  return String(currentProjectRequestContext()?.sourceRoot || "").trim();
}

function currentProjectSourceConfigRoot() {
  return String(currentProjectRequestContext()?.sourceConfigRoot || "").trim();
}

function currentProjectRecordPath() {
  return String(currentProjectRequestContext()?.projectRecordPath || "").trim();
}

function currentProjectScopeKey({
  fallback = "global"
} = {}) {
  const slug = String(currentProjectRequestContext()?.slug || "").trim();
  if (slug) {
    return `project:${slug}`;
  }
  return String(fallback || "global").trim() || "global";
}

async function runWithProjectRequestContext(context = {}, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("runWithProjectRequestContext requires operation().");
  }
  return projectContextStorage.run(Object.freeze({ ...context }), operation);
}

async function runWithResolvedProjectRequestContext(options = {}, operation) {
  const context = await resolveProjectRequestContext(options);
  return runWithProjectRequestContext(context, operation);
}

function projectRequestErrorStatusCode(error = {}) {
  if (error?.code === "vibe64_invalid_project_slug") {
    return 422;
  }
  if (error?.code === "vibe64_project_route_unavailable") {
    return 404;
  }
  if (error?.code === "vibe64_project_path_not_accessible") {
    return 404;
  }
  if (
    error?.code === "vibe64_project_path_not_directory" ||
    error?.code === "vibe64_project_path_symlink"
  ) {
    return 409;
  }
  return 400;
}

export {
  VIBE64_PROJECT_ROUTE_BASE,
  currentProjectRecordPath,
  currentProjectLocalRoot,
  currentProjectRequestContext,
  currentProjectRuntimeRoot,
  currentProjectSessionSourceRoot,
  currentProjectScopeKey,
  currentProjectSourceConfigRoot,
  currentProjectSourceRoot,
  currentProjectTargetRoot,
  resolveProjectRequestContext,
  runWithResolvedProjectRequestContext,
  runWithProjectRequestContext,
  projectRequestErrorStatusCode,
  projectSlugFromRequest
};
