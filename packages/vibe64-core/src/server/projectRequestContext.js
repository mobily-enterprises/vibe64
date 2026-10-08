import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";

import {
  assertProjectDirectoryUsable,
  getStudioProjectContext,
  normalizeProjectSlug,
  resolveStudioProjectsRoot,
  resolveProjectContextRoot
} from "./studioProjectContext.js";

const VIBE64_PROJECT_ROUTE_BASE = "/app/:slug";
const projectContextStorage = new AsyncLocalStorage();
const practiceScopeKey = Symbol("Vibe64 server practice scope");

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
  const vibe64User = request?.vibe64User || null;
  const practice = resolvedProjectContext.currentPracticeProjectScope?.();
  if (practice) {
    if (slug !== practice.slug) {
      throw Object.assign(new Error("Practice access belongs to the exact saved project."), { code: "vibe64_practice_scope_mismatch" });
    }
    const { project } = await resolvedProjectContext.readWorkspaceProject({ slug });
    return Object.freeze({
      projectRecordPath: project.projectRecordPath,
      projectRuntimeRoot: project.projectRuntimeRoot,
      projectSessionSourceRoot: project.projectSessionSourceRoot,
      projectsRoot: practice.projectsRoot,
      slug,
      sourceConfigRoot: "",
      sourceRoot: "",
      systemRoot: practice.systemRoot,
      targetRoot: project.projectRoot,
      vibe64User: practice.vibe64User,
      [practiceScopeKey]: currentProjectRequestContext()[practiceScopeKey]
    });
  }
  const explicitContext = explicitProjectRequestContextForSlug(resolvedProjectContext, slug, projectsRoot);
  if (explicitContext) {
    await assertProjectDirectoryUsable(explicitContext.targetRoot);
    if (explicitContext.projectRuntimeRoot) {
      await mkdir(explicitContext.projectRuntimeRoot, {
        recursive: true
      });
    }
    return Object.freeze({
      ...explicitContext,
      vibe64User
    });
  }
  if (resolvedProjectContext?.projectCatalogEnabled === false) {
    const error = new Error("Local editor mode only serves the selected project.");
    error.code = "vibe64_project_route_unavailable";
    throw error;
  }
  const result = await resolvedProjectContext.readWorkspaceProject({
    allowDeleting: request.allowDeleting === true,
    slug
  });
  const project = result.project || {};
  const targetRoot = project.projectRoot || project.path || resolveProjectContextRoot({
    projectsRoot,
    slug
  });
  const projectRuntimeRoot = project.projectRuntimeRoot || "";
  const projectSessionSourceRoot = project.projectSessionSourceRoot || "";
  const sourceRoot = project.sourceRoot || "";
  const sourceConfigRoot = project.sourceConfigRoot || "";
  const projectRecordPath = project.projectRecordPath || "";
  return Object.freeze({
    projectRecordPath,
    projectRuntimeRoot,
    projectSessionSourceRoot,
    projectsRoot,
    slug,
    sourceConfigRoot,
    sourceRoot,
    systemRoot: String(resolvedProjectContext?.systemRoot || "").trim(),
    targetRoot,
    vibe64User
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
  const projectRuntimeRoot = typeof projectContext.projectRuntimeRootForTarget === "function"
    ? projectContext.projectRuntimeRootForTarget(targetRoot)
    : "";
  const projectSessionSourceRoot = typeof projectContext.projectSessionSourceRootForTarget === "function"
    ? projectContext.projectSessionSourceRootForTarget(targetRoot)
    : "";
  const sourceRoot = typeof projectContext.sourceRootForTarget === "function"
    ? projectContext.sourceRootForTarget(targetRoot)
    : "";
  const sourceConfigRoot = typeof projectContext.sourceConfigRootForTarget === "function"
    ? projectContext.sourceConfigRootForTarget(targetRoot)
    : "";
  const projectRecordPath = typeof projectContext.projectRecordPathForTarget === "function"
    ? projectContext.projectRecordPathForTarget(targetRoot)
    : "";
  return Object.freeze({
    projectRecordPath,
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
  const context = projectContextStorage.getStore() || null;
  if (context?.[practiceScopeKey] && !context[practiceScopeKey].active()) {
    throw Object.assign(new Error("Practice access ended with its owning callback. Read the saved lesson again."), { code: "vibe64_practice_scope_expired" });
  }
  return context;
}

function currentPracticeProjectScope(owner) {
  const grant = currentProjectRequestContext()?.[practiceScopeKey];
  if (!grant) return null;
  if (grant.owner !== owner) {
    throw Object.assign(new Error("Practice access belongs to its original Project context."), { code: "vibe64_practice_context_mismatch" });
  }
  return grant.scope;
}

// Core calls this with its exact derived scope. The private token survives only
// inside the original ALS callback; ordinary request/context fields cannot grant it.
async function runWithPracticeProjectContext(owner, scope, operation) {
  if (typeof operation !== "function") throw new TypeError("Practice access requires an owning callback.");
  let active = true;
  const context = Object.freeze({ ...scope,
    [practiceScopeKey]: { owner, scope, active: () => active }
  });
  try {
    return await projectContextStorage.run(context, () => operation());
  } finally {
    active = false;
  }
}

function currentProjectTargetRoot() {
  return String(currentProjectRequestContext()?.targetRoot || "").trim();
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

function currentProjectVibe64User() {
  return currentProjectRequestContext()?.vibe64User || null;
}

function currentProjectScopeKey({
  fallback = "global"
} = {}) {
  const context = currentProjectRequestContext();
  if (context?.learningScope) {
    return `learning:${JSON.stringify([context.learningScope.learnerId, context.learningScope.attemptId])}`;
  }
  const slug = String(context?.slug || "").trim();
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
  currentPracticeProjectScope,
  runWithPracticeProjectContext,
  currentProjectRecordPath,
  currentProjectRequestContext,
  currentProjectRuntimeRoot,
  currentProjectSessionSourceRoot,
  currentProjectScopeKey,
  currentProjectSourceConfigRoot,
  currentProjectSourceRoot,
  currentProjectTargetRoot,
  currentProjectVibe64User,
  resolveProjectRequestContext,
  runWithResolvedProjectRequestContext,
  runWithProjectRequestContext,
  projectRequestErrorStatusCode,
  projectSlugFromRequest
};
