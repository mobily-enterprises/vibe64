import { rm } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROJECT_REPOSITORY_MODE_MANAGED_GIT } from "@local/vibe64-core/server/projectRepository";
import { pathExists } from "@local/vibe64-core/server/core";
import { normalizeProjectSlug, resolveProjectContextRoot, projectSlugFromName } from "@local/vibe64-core/server/studioProjectContext";
import { assertProjectEffectAdmission } from "@local/vibe64-core/server/projectRequestContext";
import { initializeManagedProject as initializePublicManagedProject, verifyManagedProjectSource } from "./managedProject.js";

const DEFAULT_MANAGED_GIT_BRANCH = "main";

function createManagedProjectRepositoryService({ initializeManagedProject = initializePublicManagedProject,
  projectContext, projectService = null, configureProject = null } = {}) {
  // Internal preparation options are separate from action and HTTP input.
  async function createManagedGitProject(input = {}, { initializeProject } = {}) {
    assertProjectEffectAdmission();
    const slug = normalizeProjectSlug(input?.slug || projectSlugFromName(input?.name || "New Project"));
    const scope = projectContext.currentPracticeProjectScope?.();
    const projectContextRoot = scope
      ? (await projectContext.readWorkspaceProjectState({ slug })).projectContextRoot
      : resolveProjectContextRoot({
        projectsRoot: projectContext.projectsRoot,
        slug
      });
    const projectDefaults = configureProject
      ? await configureProject({ projectContextRoot, projectService, slug })
      : {};
    const removeProjectContextRootOnFailure = !await pathExists(projectContextRoot);
    let created = null;
    try {
      created = await projectContext.createWorkspaceProjectRecord({
        ...(input || {}),
        ...projectDefaults,
        repository: {
          ...(input?.repository || {}),
          defaultBranch: input?.repository?.defaultBranch || input?.defaultBranch || DEFAULT_MANAGED_GIT_BRANCH,
          mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
        },
        slug
      }, {
        prepare: ({ projectContextRoot: preparedProjectContextRoot, projectRuntimeRoot }) => initializeManagedProject({
          defaultBranch: input?.repository?.defaultBranch || input?.defaultBranch || DEFAULT_MANAGED_GIT_BRANCH,
          initializeProject,
          projectContextRoot: preparedProjectContextRoot,
          projectName: slug,
          projectRuntimeRoot
        })
      });
      return {
        ok: true,
        project: created.project,
        projectsRoot: created.projectsRoot,
        repository: created.project?.repository || {
          defaultBranch: DEFAULT_MANAGED_GIT_BRANCH,
          mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
        }
      };
    } catch (error) {
      if (created && typeof projectContext.discardWorkspaceProjectRecord === "function") {
        await projectContext.discardWorkspaceProjectRecord({
          slug
        });
      } else if (removeProjectContextRootOnFailure) {
        await cleanupPreparedProjectDirectory(scope?.projectsRoot || projectContext.projectsRoot, projectContextRoot);
      }
      throw error;
    }
  }

  // Internal preparation: callers supply verified exercise bytes, not paths.
  // Release this source lock before session creation acquires policy/source locks.
  async function verifyTrainingProjectSource({ slug, training }, { files } = {}) {
    assertProjectSessionAuthority(projectService, { requireSourceLock: true });
    return projectService.runInProjectContext(slug, () => projectService.runProjectSourceExclusive(async () => {
      const record = await projectContext.readWorkspaceProjectState({ slug });
      const project = await readProjectForService(projectContext, { slug });
      assertProjectRepositoryMode(project, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
      if (record.metadata.deletion || !isDeepStrictEqual(record.metadata.training, training)) {
        throw repositoryServiceError("VIBE64_TRAINING_PROJECT_CONFLICT", "Practice project ownership changed. Keep it intact and ask the owner to inspect it.", 409);
      }
      return verifyManagedProjectSource({
        branch: project.repository.defaultBranch,
        files,
        projectRuntimeRoot: projectContext.projectRuntimeRootForSlug(slug)
      });
    }, { operation: "verify-training-source" }));
  }

  return Object.freeze({ createManagedGitProject, verifyTrainingProjectSource });
}

async function cleanupPreparedProjectDirectory(projectsRoot = "", projectContextRoot = "") {
  if (!projectsRoot || !projectContextRoot) {
    return;
  }
  const resolvedProjectsRoot = path.resolve(projectsRoot);
  const resolvedProjectContextRoot = path.resolve(projectContextRoot);
  const relativeProject = path.relative(resolvedProjectsRoot, resolvedProjectContextRoot);
  if (!relativeProject || relativeProject.startsWith("..") || path.isAbsolute(relativeProject)) {
    return;
  }
  await rm(resolvedProjectContextRoot, {
    force: true,
    recursive: true
  });
}

async function readProjectForService(projectContext = {}, input = {}) {
  if (typeof projectContext?.readWorkspaceProject !== "function") {
    throw repositoryServiceError(
      "vibe64_project_context_unavailable",
      "Project context is not available.",
      500
    );
  }
  const result = await projectContext.readWorkspaceProject({
    slug: input.slug || input.projectSlug || input.name
  });
  return result.project;
}

function assertProjectRepositoryMode(project = {}, mode = "", message = "Project repository mode is not valid for this operation.") {
  if (project.repositoryMode !== mode && project.repository?.mode !== mode) {
    throw repositoryServiceError(
      "vibe64_project_repository_mode_mismatch",
      message,
      409
    );
  }
}

function assertProjectSessionAuthority(projectService = null, {
  requireSourceLock = false
} = {}) {
  if (
    typeof projectService?.runInProjectContext !== "function" ||
    typeof projectService?.createRuntime !== "function" ||
    (requireSourceLock && typeof projectService?.runProjectSourceExclusive !== "function")
  ) {
    throw repositoryServiceError(
      "vibe64_project_session_authority_unavailable",
      "Repository changes require the canonical Vibe64 session authority and source lock.",
      500
    );
  }
}

function repositoryServiceError(code = "", message = "", statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export { createManagedProjectRepositoryService, readProjectForService, assertProjectRepositoryMode,
  assertProjectSessionAuthority, repositoryServiceError };
