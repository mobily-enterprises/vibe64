import { AsyncLocalStorage } from "node:async_hooks";

import {
  assertWorkspaceDirectoryUsable,
  getStudioProjectContext,
  normalizeWorkspaceSlug,
  resolveStudioProjectsRoot,
  resolveWorkspaceRoot
} from "./studioProjectContext.js";

const VIBE64_WORKSPACE_ROUTE_BASE = "/app/:slug";
const workspaceContextStorage = new AsyncLocalStorage();

function workspaceSlugFromRequest(request = {}) {
  return normalizeWorkspaceSlug(request.params?.slug);
}

async function resolveWorkspaceRequestContext({
  projectContext = getStudioProjectContext(),
  request = {}
} = {}) {
  const slug = workspaceSlugFromRequest(request);
  const resolvedProjectContext = projectContext || getStudioProjectContext();
  const projectsRoot = String(resolvedProjectContext?.projectsRoot || resolveStudioProjectsRoot()).trim();
  const targetRoot = resolveWorkspaceRoot({
    projectsRoot,
    slug
  });
  await assertWorkspaceDirectoryUsable(targetRoot);
  return Object.freeze({
    projectsRoot,
    slug,
    targetRoot
  });
}

function currentWorkspaceRequestContext() {
  return workspaceContextStorage.getStore() || null;
}

function currentWorkspaceTargetRoot() {
  return String(currentWorkspaceRequestContext()?.targetRoot || "").trim();
}

function currentWorkspaceScopeKey({
  fallback = "global"
} = {}) {
  const slug = String(currentWorkspaceRequestContext()?.slug || "").trim();
  if (slug) {
    return `workspace:${slug}`;
  }
  return String(fallback || "global").trim() || "global";
}

async function runWithWorkspaceRequestContext(context = {}, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("runWithWorkspaceRequestContext requires operation().");
  }
  return workspaceContextStorage.run(Object.freeze({ ...context }), operation);
}

async function runWithResolvedWorkspaceRequestContext(options = {}, operation) {
  const context = await resolveWorkspaceRequestContext(options);
  return runWithWorkspaceRequestContext(context, operation);
}

function workspaceRequestErrorStatusCode(error = {}) {
  if (error?.code === "vibe64_invalid_workspace_slug") {
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
  VIBE64_WORKSPACE_ROUTE_BASE,
  currentWorkspaceRequestContext,
  currentWorkspaceScopeKey,
  currentWorkspaceTargetRoot,
  resolveWorkspaceRequestContext,
  runWithResolvedWorkspaceRequestContext,
  runWithWorkspaceRequestContext,
  workspaceRequestErrorStatusCode,
  workspaceSlugFromRequest
};
