import { AsyncLocalStorage } from "node:async_hooks";

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
  const projectsRoot = String(resolvedProjectContext?.projectsRoot || resolveStudioProjectsRoot()).trim();
  const targetRoot = resolveProjectRoot({
    projectsRoot,
    slug
  });
  await assertProjectDirectoryUsable(targetRoot);
  if (typeof resolvedProjectContext.ensureProjectStateForSlug === "function") {
    await resolvedProjectContext.ensureProjectStateForSlug(slug);
  }
  const projectStateRoot = typeof resolvedProjectContext.projectStateRootForSlug === "function"
    ? resolvedProjectContext.projectStateRootForSlug(slug)
    : "";
  return Object.freeze({
    dataRoot: String(resolvedProjectContext?.dataRoot || "").trim(),
    projectStateRoot,
    projectsRoot,
    slug,
    targetRoot
  });
}

function currentProjectRequestContext() {
  return projectContextStorage.getStore() || null;
}

function currentProjectTargetRoot() {
  return String(currentProjectRequestContext()?.targetRoot || "").trim();
}

function currentProjectStateRoot() {
  return String(currentProjectRequestContext()?.projectStateRoot || "").trim();
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
  currentProjectRequestContext,
  currentProjectScopeKey,
  currentProjectTargetRoot,
  currentProjectStateRoot,
  resolveProjectRequestContext,
  runWithResolvedProjectRequestContext,
  runWithProjectRequestContext,
  projectRequestErrorStatusCode,
  projectSlugFromRequest
};
