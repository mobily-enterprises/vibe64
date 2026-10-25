import { mkdir } from "node:fs/promises";

import {
  assertProjectDirectoryUsable,
  getStudioProjectContext,
  normalizeProjectSlug,
  resolveStudioProjectsRoot,
  resolveProjectContextRoot
} from "./studioProjectContext.js";
import { pathExists } from "./core.js";
import {
  PRACTICE_PROJECT_DELETED_CODE,
  admitPracticeProject,
  practiceIdFromSlug,
  practiceProjectDeletedError
} from "./learningSpace.js";
import { assertLearningModeAllowsProject, LEARNING_MODE_PROJECT_CODE } from "./learningMode.js";
import { assertTeamAiAllowsProject, TEAM_AI_REQUIRED_CODE } from "./teamAiGate.js";
import {
  actionRequestMetaKey,
  assertProjectEffectAdmission,
  captureProjectRequestContext,
  currentPracticeProjectScope,
  currentProjectRequestContext,
  practiceScopeKey,
  projectContextStorage,
  retainPracticeContext,
  runWithPracticeProjectContext
} from "./practiceContext.js";

const VIBE64_PROJECT_ROUTE_BASE = "/app/:slug";
let practiceRequestActor = null;

// A host whose person requests carry no vibe64User (the local transport)
// supplies the person here: resolve({request}) returns the actor or null.
// Returns the unregister function.
function registerPracticeRequestActor(resolve) {
  if (typeof resolve !== "function") throw new TypeError("Practice request actor requires a resolver.");
  practiceRequestActor = resolve;
  return () => { if (practiceRequestActor === resolve) practiceRequestActor = null; };
}

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
  // A person's own page or session request (HTTP or WebSocket, which carry
  // headers) opens only the projects of their mode, once admission has said
  // whether the slug is one of their practice projects: Learn opens only
  // those, Develop refuses them. A team member also needs the team AI setup.
  // Internal work is never limited.
  const assertMode = async isPractice => {
    if (!request?.headers) return;
    await assertLearningModeAllowsProject({ actor: vibe64User, slug, request, practice: isPractice });
    await assertTeamAiAllowsProject({ actor: vibe64User });
  };
  const practice = resolvedProjectContext.currentPracticeProjectScope?.();
  if (practice) {
    if (slug !== practice.slug) {
      throw Object.assign(new Error("Practice access belongs to the exact saved project."), { code: "vibe64_practice_scope_mismatch" });
    }
    const { project } = await resolvedProjectContext.readWorkspaceProject({
      ...(request.allowDeleting === true ? { allowDeleting: true } : {}), slug });
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
  if (practiceIdFromSlug(slug)) {
    const admitted = await admitPracticeRequest({ projectContext: resolvedProjectContext, request, slug, vibe64User });
    if (admitted) {
      await assertMode(true);
      return admitted;
    }
    // Not in the learning space: only a pre-existing project of that name opens.
    if (!explicitContext && !(resolvedProjectContext.projectCatalogEnabled !== false &&
        await pathExists(resolveProjectContextRoot({ projectsRoot, slug })))) {
      throw practiceProjectDeletedError();
    }
  }
  await assertMode(false);
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
  let result;
  try {
    result = await resolvedProjectContext.readWorkspaceProject({
      allowDeleting: request.allowDeleting === true,
      slug
    });
  } catch (error) {
    // A catalogue entry with a retired training marker is an old practice
    // project awaiting the scrap upgrade: not found, like a deleted one.
    if (practiceIdFromSlug(slug) && error?.code === "vibe64_project_training_invalid") throw practiceProjectDeletedError();
    throw error;
  }
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

// A practice project opens as an ordinary project to its learner, with full
// write, through the one learning-space admission; null when the learning
// space has no such project.
async function admitPracticeRequest({ projectContext, request, slug, vibe64User }) {
  const person = Boolean(request?.headers);
  const actor = vibe64User || (person && practiceRequestActor ? await practiceRequestActor({ request }) : null);
  const admitted = await admitPracticeProject({ projectContext, slug, actor, person });
  return admitted && projectContext.runWithPracticeProjectScope({ ...admitted, access: "write", requireProject: true,
    ...(request.allowDeleting === true ? { allowDeleting: true } : {}) }, async () => retainPracticeContext("write"));
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

// Retained only for fresh action dispatch. This is the original request, not
// the prior action's authorization result, and must never become saved state.
function currentProjectActionRequestMeta() {
  const context = currentProjectRequestContext();
  if (context?.[practiceScopeKey]) return null;
  return context?.[actionRequestMetaKey] || null;
}

// Work in a learner's own practice project. Admission opens one only to its
// learner, so any person acting here is that learner.
function currentRequestIsPracticeProject() {
  return Boolean(currentProjectRequestContext()?.[practiceScopeKey]);
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
  const slug = String(context?.slug || "").trim();
  if (slug) {
    return `project:${slug}`;
  }
  return String(fallback || "global").trim() || "global";
}

async function runWithProjectRequestContext(context = {}, operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("runWithProjectRequestContext requires operation().");
  }
  const scopedContext = { ...context };
  if (scopedContext[practiceScopeKey]) {
    delete scopedContext[actionRequestMetaKey];
  } else if (Object.hasOwn(options, "requestMeta")) {
    if (options.requestMeta?.request) scopedContext[actionRequestMetaKey] = options.requestMeta;
    else delete scopedContext[actionRequestMetaKey];
  }
  return projectContextStorage.run(Object.freeze(scopedContext), operation);
}

async function runWithResolvedProjectRequestContext(options = {}, operation) {
  const context = await resolveProjectRequestContext(options);
  return runWithProjectRequestContext(context, operation);
}

// The project-admission refusals a project route answers itself, with their
// HTTP status; any other error is not a project request error.
const PROJECT_REQUEST_ERROR_STATUS = Object.freeze({
  vibe64_invalid_project_slug: 422,
  vibe64_project_route_unavailable: 404,
  [LEARNING_MODE_PROJECT_CODE]: 403,
  [TEAM_AI_REQUIRED_CODE]: 403,
  vibe64_project_path_not_accessible: 404,
  [PRACTICE_PROJECT_DELETED_CODE]: 404,
  vibe64_project_path_not_directory: 409,
  vibe64_project_path_symlink: 409
});

function isProjectRequestError(error = {}) {
  return Object.hasOwn(PROJECT_REQUEST_ERROR_STATUS, String(error?.code));
}

function projectRequestErrorStatusCode(error = {}) {
  return isProjectRequestError(error) ? PROJECT_REQUEST_ERROR_STATUS[error.code] : 400;
}

export {
  VIBE64_PROJECT_ROUTE_BASE,
  registerPracticeRequestActor,
  currentPracticeProjectScope,
  runWithPracticeProjectContext,
  captureProjectRequestContext,
  assertProjectEffectAdmission,
  currentProjectRecordPath,
  currentProjectActionRequestMeta,
  currentProjectRequestContext,
  currentRequestIsPracticeProject,
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
  isProjectRequestError,
  projectRequestErrorStatusCode,
  projectSlugFromRequest
};
