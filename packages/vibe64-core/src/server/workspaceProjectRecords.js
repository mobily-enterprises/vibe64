import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { pathExists } from "./core.js";
import { normalizeProjectTraining } from "./learningSpace.js";
import { assertProjectEffectAdmission } from "./practiceContext.js";
import { normalizeProjectDeletion } from "./projectDeletion.js";
import { updateProjectRecordMetadata } from "./projectRecordMetadata.js";
import { PROJECT_REPOSITORY_MODE_MANAGED_GIT, projectRepositoryView } from "./projectRepository.js";
import { normalizeProjectSlug, EXTERNAL_PROJECT_LOCAL_ROOTS_DIR, resolveProjectRecordPath } from "./projectState.js";
import {
  DEFAULT_HOSTED_REPOSITORY_BRANCH,
  assertCatalogueSlugAllowed,
  assertDirectoryUsable,
  assertHostedRepositoryMetadata,
  normalizeProjectMetadata,
  practiceOwnershipDiffers,
  projectCatalogUnavailableError,
  projectDeletingError,
  projectMetadataFromInput,
  projectSlugExistsError,
  projectSlugFromInput,
  projectStateMissingError,
  readProjectMetadata,
  workspaceProjectRecordForPath,
  writeProjectMetadata
} from "./studioProjectRecords.js";

// Sessions registers how many main-chat messages wait for the owner's approval.
let approvalCountReader = null;

// readable-check: allow module-registry - cycle: vibe64.sessions requires vibe64.project, whose project list shows the count
function registerApprovalCountReader(reader) {
  if (typeof reader !== "function") throw new TypeError("An approval count reader must be a function.");
  approvalCountReader = reader;
  return () => { if (approvalCountReader === reader) approvalCountReader = null; };
}

/**
 * Workspace project records: created, read, updated, deleted step by step,
 * listed, and swept of runtime folders no record owns.
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./learningSpaceProjects.js").createLearningSpaceProjects>} dependencies.learningProjects
 * @param {ReturnType<typeof import("./projectPaths.js").createProjectPaths>} dependencies.paths
 * @param {boolean} dependencies.projectCatalogEnabled
 * @param {string} dependencies.projectsRoot
 * @param {string} dependencies.systemRoot
 */
function createWorkspaceProjectRecords({
  learningProjects,
  paths,
  projectCatalogEnabled,
  projectsRoot,
  systemRoot
}) {
  async function listWorkspaceProjects() {
    const scope = paths.practiceScope();
    if (scope) {
      const result = await readWorkspaceProject({ slug: scope.slug });
      return { ...result, projects: [result.project] };
    }
    if (!projectCatalogEnabled) {
      return {
        ok: true,
        projects: [],
        projectsRoot
      };
    }

    await mkdir(projectsRoot, {
      recursive: true
    });
    const entries = await readdir(projectsRoot, {
      withFileTypes: true
    });
    const projectPaths = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectsRoot, entry.name))
      .filter((entry) => {
        try {
          normalizeProjectSlug(path.basename(entry));
          return true;
        } catch {
          return false;
        }
      });
    const projects = (await Promise.all(projectPaths.map((projectPath) => workspaceProjectRecordForPath({
      projectRecordPath: paths.projectRecordPathForTarget(projectPath),
      path: projectPath,
      projectRuntimeRoot: paths.projectRuntimeRootForTarget(projectPath),
      projectSessionSourceRoot: paths.projectSessionSourceRootForTarget(projectPath),
      projectsRoot
    }).catch((error) => {
      // A catalogue entry with a retired training marker (an old hosted
      // practice project awaiting the scrap upgrade) is not a project of the
      // catalogue; it never takes the other projects' listing down with it.
      if (error?.code === "vibe64_project_training_invalid") {
        return learningProjects.skipLearningSpaceEntry(path.basename(projectPath), "catalogue entry with an invalid training marker");
      }
      throw error;
    }))))
      .filter((project) => project?.repository)
      .sort((left, right) => left.slug.localeCompare(right.slug));
    return {
      ok: true,
      projects: approvalCountReader ? await Promise.all(projects.map(async (project) => ({
        ...project,
        approvalsWaiting: await approvalCountReader(project)
      }))) : projects,
      projectsRoot
    };
  }

  /**
   * Startup maintenance, never a read: removes the runtime root of every
   * catalogue project whose record survives but whose project directory is
   * gone (a removal that stopped part-way). Practice runtimes of the learning
   * space are kept. Returns the removed slugs, one at a time, for the caller's log.
   */
  async function sweepOrphanProjectRuntimeRoots() {
    if (!projectCatalogEnabled) {
      return [];
    }
    const runtimeEntries = await readdir(path.join(systemRoot, EXTERNAL_PROJECT_LOCAL_ROOTS_DIR), {
      withFileTypes: true
    }).catch((error) => {
      if (error?.code === "ENOENT") {
        return [];
      }
      throw error;
    });
    const removed = [];
    for (const entry of runtimeEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        normalizeProjectSlug(entry.name);
      } catch {
        continue;
      }
      const runtimeRoot = paths.projectRuntimeRootForSlug(entry.name);
      if (
        await pathExists(paths.projectContextRootForSlug(entry.name)) ||
        !await pathExists(resolveProjectRecordPath({ projectRuntimeRoot: runtimeRoot })) ||
        await learningProjects.isLearningSpaceRuntime(entry.name, runtimeRoot)
      ) {
        continue;
      }
      await rm(runtimeRoot, {
        force: true,
        recursive: true
      });
      removed.push(entry.name);
    }
    return removed;
  }

  /**
   * The catalogue serves its own projects; without it only practice access does.
   */
  function catalogueOrPracticeScope() {
    const scope = paths.practiceScope();
    if (!projectCatalogEnabled && !scope) {
      throw projectCatalogUnavailableError();
    }
    return scope;
  }

  function workspaceProjectRecordForSlug(slug, scope) {
    return workspaceProjectRecordForPath({
      projectRecordPath: paths.projectRecordPathForSlug(slug),
      path: paths.projectContextRootForSlug(slug),
      projectRuntimeRoot: paths.projectRuntimeRootForSlug(slug),
      projectSessionSourceRoot: paths.projectSessionSourceRootForSlug(slug),
      projectsRoot: scope?.projectsRoot || projectsRoot
    });
  }

  async function createWorkspaceProjectRecord(input = {}, {
    prepare = null
  } = {}) {
    const scope = catalogueOrPracticeScope();

    const slug = projectSlugFromInput(input);
    if (!scope) assertCatalogueSlugAllowed(slug);
    const projectContextRoot = paths.projectContextRootForSlug(slug);
    const projectRuntimeRoot = paths.projectRuntimeRootForSlug(slug);
    if (scope && (scope.access !== "create" || !isDeepStrictEqual(normalizeProjectTraining(input.training), scope.training))) {
      throw Object.assign(
        new Error("Practice creation requires its exact saved training marker."),
        { code: "vibe64_practice_scope_mismatch" }
      );
    }
    if (await pathExists(projectContextRoot) || await pathExists(projectRuntimeRoot)) {
      throw projectSlugExistsError();
    }
    const metadata = assertHostedRepositoryMetadata(projectMetadataFromInput(input, {
      defaultRepositoryBranch: DEFAULT_HOSTED_REPOSITORY_BRANCH,
      defaultRepositoryMode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
    }));
    if (scope && projectRepositoryView(metadata).repositoryMode !== PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
      throw Object.assign(new Error("Practice creation requires its managed Git authority."), { code: "vibe64_practice_scope_mismatch" });
    }
    let project = null;
    let sourceCreated = false;
    let runtimeCreated = false;
    try {
      await Promise.all([
        mkdir(path.dirname(projectContextRoot), {
          recursive: true
        }),
        mkdir(path.dirname(projectRuntimeRoot), {
          recursive: true,
          ...(scope ? { mode: 0o700 } : {})
        })
      ]);
      await mkdir(projectRuntimeRoot, scope ? { mode: 0o700 } : undefined);
      runtimeCreated = true;
      await mkdir(projectContextRoot);
      sourceCreated = true;
      if (typeof prepare === "function") {
        // The trusted initializer may adjust repository metadata, but gets its own marker copy.
        await prepare({
          metadata: metadata.training
            ? { ...metadata, training: normalizeProjectTraining(metadata.training) }
            : metadata,
          projectContextRoot,
          projectRuntimeRoot,
          slug
        });
      }
      await writeProjectMetadata(paths.projectRecordPathForSlug(slug), metadata);
      project = await workspaceProjectRecordForSlug(slug, scope);
    } catch (error) {
      await Promise.all([
        ...(sourceCreated ? [rm(projectContextRoot, {
          force: true,
          recursive: true
        })] : []),
        ...(runtimeCreated ? [rm(projectRuntimeRoot, {
          force: true,
          recursive: true
        })] : [])
      ]);
      if (error?.code === "EEXIST") {
        throw projectSlugExistsError();
      }
      throw error;
    }
    return {
      ok: true,
      project,
      projectsRoot: scope?.projectsRoot || projectsRoot
    };
  }

  async function assertWorkspaceProjectAvailable(input = {}) {
    const slug = projectSlugFromInput(input);
    assertCatalogueSlugAllowed(slug);
    if (
      await pathExists(paths.projectContextRootForSlug(slug)) ||
      await pathExists(paths.projectRuntimeRootForSlug(slug))
    ) {
      throw projectSlugExistsError();
    }
    return {
      projectContextRoot: paths.projectContextRootForSlug(slug),
      slug
    };
  }

  async function readWorkspaceProject(input = {}) {
    const scope = catalogueOrPracticeScope();

    const slug = projectSlugFromInput(input);
    const projectContextRoot = paths.projectContextRootForSlug(slug);
    if (scope) await readWorkspaceProjectState({ slug });
    await assertDirectoryUsable(projectContextRoot);
    const project = await workspaceProjectRecordForSlug(slug, scope);
    if (project.deletion && input.allowDeleting !== true) {
      throw projectDeletingError();
    }
    if (!project.repository) {
      const error = new Error("Vibe64 projects must have repository metadata.");
      error.code = "vibe64_project_repository_missing";
      throw error;
    }
    return {
      ok: true,
      project,
      projectsRoot: scope?.projectsRoot || projectsRoot
    };
  }

  async function updateWorkspaceProjectMetadata(input = {}) {
    const scope = catalogueOrPracticeScope();

    assertProjectEffectAdmission();
    const slug = projectSlugFromInput(input);
    const projectContextRoot = paths.projectContextRootForSlug(slug);
    await assertDirectoryUsable(projectContextRoot);
    await updateWorkspaceProjectState({ slug }, async (currentMetadata) => {
      const metadata = assertHostedRepositoryMetadata({
        ...currentMetadata,
        ...projectMetadataFromInput({
          ...input,
          repository: input.repository || currentMetadata.repository
        })
      });
      return metadata;
    });
    const project = await workspaceProjectRecordForSlug(slug, scope);
    return {
      ok: true,
      project,
      projectsRoot: scope?.projectsRoot || projectsRoot
    };
  }

  async function readWorkspaceProjectState(input = {}) {
    const scope = catalogueOrPracticeScope();
    const slug = projectSlugFromInput(input);
    if (scope) {
      for (const directory of [scope.targetRoot, scope.projectRuntimeRoot, scope.projectSessionSourceRoot]) {
        await learningProjects.practiceDirectoryExists(directory);
      }
    }
    const metadata = assertHostedRepositoryMetadata(await readProjectMetadata({
      projectRecordPath: paths.projectRecordPathForSlug(slug)
    }));
    if (scope && (Object.keys(metadata).length || await pathExists(scope.targetRoot) || await pathExists(scope.projectRuntimeRoot)) &&
        practiceOwnershipDiffers(metadata, scope.training, scope.allowDeleting === true)) {
      throw Object.assign(
        new Error("Practice project ownership changed. Keep it intact and ask the owner to inspect it."),
        { code: "vibe64_practice_scope_mismatch" }
      );
    }
    return {
      metadata,
      projectContextRoot: paths.projectContextRootForSlug(slug),
      projectRecordPath: paths.projectRecordPathForSlug(slug),
      projectRuntimeRoot: paths.projectRuntimeRootForSlug(slug),
      slug
    };
  }

  async function updateWorkspaceProjectState(input, update, options = {}) {
    const {
      allowDeleting = false
    } = options;
    if (!projectCatalogEnabled && !paths.practiceScope()) {
      throw projectCatalogUnavailableError();
    }
    assertProjectEffectAdmission();
    if (typeof update !== "function") {
      throw new TypeError("updateWorkspaceProjectState requires an update function.");
    }
    const slug = projectSlugFromInput(input);
    const state = {
      projectContextRoot: paths.projectContextRootForSlug(slug),
      projectRecordPath: paths.projectRecordPathForSlug(slug),
      projectRuntimeRoot: paths.projectRuntimeRootForSlug(slug),
      slug
    };
    const metadata = await updateProjectRecordMetadata(state.projectRecordPath, async (current) => {
      const currentMetadata = assertHostedRepositoryMetadata(normalizeProjectMetadata(current));
      if (!Object.keys(currentMetadata).length) {
        throw projectStateMissingError(state.slug);
      }
      if (currentMetadata.deletion && !allowDeleting) {
        throw projectDeletingError();
      }
      // Snapshot the immutable marker before invoking the existing updater.
      const training = currentMetadata.training
        ? normalizeProjectTraining(currentMetadata.training)
        : undefined;
      const nextMetadata = assertHostedRepositoryMetadata(normalizeProjectMetadata(await update(currentMetadata, {
        ...state,
        metadata: currentMetadata
      })));
      if (!isDeepStrictEqual(training, nextMetadata.training)) {
        const error = new Error("Project training provenance is fixed at creation and cannot be added, changed or removed by an update.");
        error.code = "vibe64_project_training_immutable";
        throw error;
      }
      return nextMetadata;
    });
    return {
      ...state,
      metadata
    };
  }

  async function beginWorkspaceProjectDeletion(input = {}) {
    return updateWorkspaceProjectState(input, (metadata) => ({
      ...metadata,
      deletion: metadata.deletion || normalizeProjectDeletion({
        startedAt: input.startedAt || new Date().toISOString(),
        steps: {}
      })
    }), {
      allowDeleting: true
    });
  }

  async function completeWorkspaceProjectDeletionStep(input = {}) {
    const step = String(input.step || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(step)) {
      const error = new Error("Project deletion step is invalid.");
      error.code = "vibe64_project_deletion_step_invalid";
      throw error;
    }
    return updateWorkspaceProjectState(input, (metadata) => ({
      ...metadata,
      deletion: normalizeProjectDeletion({
        ...metadata.deletion,
        steps: {
          ...metadata.deletion?.steps,
          [step]: input.completedAt || new Date().toISOString()
        }
      })
    }), {
      allowDeleting: true
    });
  }

  async function discardWorkspaceProjectRecord(input = {}) {
    assertProjectEffectAdmission();
    const state = await readWorkspaceProjectState(input);
    if (!Object.keys(state.metadata).length) {
      throw projectStateMissingError(state.slug);
    }
    if (state.metadata.deletion) {
      const error = new Error("Project creation cleanup cannot remove a project being deleted.");
      error.code = "vibe64_project_deleting";
      throw error;
    }
    await Promise.all([
      rm(state.projectContextRoot, {
        force: true,
        recursive: true
      }),
      rm(state.projectRuntimeRoot, {
        force: true,
        recursive: true
      })
    ]);
  }

  return Object.freeze({
    listWorkspaceProjects,
    sweepOrphanProjectRuntimeRoots,
    createWorkspaceProjectRecord,
    assertWorkspaceProjectAvailable,
    readWorkspaceProject,
    updateWorkspaceProjectMetadata,
    readWorkspaceProjectState,
    beginWorkspaceProjectDeletion,
    completeWorkspaceProjectDeletionStep,
    discardWorkspaceProjectRecord
  });
}

export { createWorkspaceProjectRecords, registerApprovalCountReader };
