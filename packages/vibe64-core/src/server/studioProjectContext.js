import os from "node:os";
import path from "node:path";
import process from "node:process";

import { assertProjectEffectAdmission } from "./practiceContext.js";

import {
  resolveVibe64Roots,
  resolveExplicitStudioTargetRoot
} from "./studioRoots.js";
import {
  normalizeProjectSlug,
  PROJECT_SLUG_MAX_LENGTH,
  listProjectRuntimeRoots
} from "./projectState.js";

import { LEARNING_SPACE_DIR } from "./learningSpace.js";

import { createLearningSpaceProjects } from "./learningSpaceProjects.js";
import { createProjectPaths } from "./projectPaths.js";
import { createWorkspaceProjectRecords, registerApprovalCountReader } from "./workspaceProjectRecords.js";
import {
  assertDirectoryUsable,
  localProjectKeyFromTargetRoot,
  normalizeDevelopmentDatabaseName,
  normalizeDevelopmentDatabaseScope,
  normalizeRoot,
  projectCatalogUnavailableError,
  projectRecord,
  projectSlugFromName,
  resolveProjectContextRoot,
  resolveStudioProjectsRoot,
  selectedProjectRecord
} from "./studioProjectRecords.js";

let configuredContext = null;
function projectCatalogEnabledForRuntimeProfile(runtimeProfile = null) {
  if (runtimeProfile?.projectCatalogEnabled === false) {
    return false;
  }
  if (runtimeProfile?.local === true) {
    return false;
  }
  const mode = String(runtimeProfile?.mode || "").trim().toLowerCase();
  if (mode === "local" || mode === "local-editor") {
    return false;
  }
  return true;
}

function createStudioProjectContext({
  cwd = process.cwd(),
  explicitManagedSourceRoot = "",
  explicitSystemRoot = "",
  env = process.env,
  explicitProjectsRoot = "",
  explicitTargetRoot = "",
  home = os.homedir(),
  learningSpace = null,
  runtimeProfile = null
} = {}) {
  const practiceOwner = Object.freeze({});
  const projectCatalogEnabled = projectCatalogEnabledForRuntimeProfile(runtimeProfile);
  const projectsRoot = projectCatalogEnabled
    ? resolveStudioProjectsRoot({
        env,
        explicitRoot: explicitProjectsRoot,
        home
      })
    : String(explicitProjectsRoot || "").trim()
      ? normalizeRoot(explicitProjectsRoot)
      : "";
  const roots = resolveVibe64Roots({
    env,
    explicitManagedSourceRoot,
    explicitSystemRoot,
    home,
    projectsRoot,
    runtimeProfile
  });
  const managedSourceRoot = roots.managedSourceRoot;
  const systemRoot = roots.systemRoot;
  // Inside the managed source root, the space inherits the managed-source
  // permission contract that agents, Preview and Files need.
  const learningSpaceRoot = normalizeRoot(learningSpace?.root, path.join(managedSourceRoot, LEARNING_SPACE_DIR));
  // The default managed source root is a real folder in the person's home,
  // so a test process must name its space explicitly.
  const learningSpaceRootNamed = Boolean(String(learningSpace?.root || explicitManagedSourceRoot || "").trim());
  let selectedTargetRoot = resolveExplicitStudioTargetRoot({
    cwd,
    env,
    explicitRoot: explicitTargetRoot
  });
  let selectionSource = selectedTargetRoot ? "explicit" : "";

  const learningProjects = createLearningSpaceProjects({ learningSpaceRoot, learningSpaceRootNamed, practiceOwner, systemRoot });

  const paths = createProjectPaths({ managedSourceRoot, practiceOwner, projectCatalogEnabled, projectsRoot, systemRoot });

  const workspaceRecords = createWorkspaceProjectRecords({ learningProjects, paths, projectCatalogEnabled, projectsRoot, systemRoot });

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

  function requestContextMatchesSelectedProject(context = {}) {
    if (selectionSource !== "explicit" || !selectedTargetRoot) {
      return false;
    }
    const contextTargetRoot = String(context.targetRoot || "").trim();
    const contextSlug = String(context.slug || "").trim();
    const selected = selectedProject();
    return Boolean(
      selected?.slug &&
      contextSlug === selected.slug &&
      (!contextTargetRoot || normalizeRoot(contextTargetRoot) === normalizeRoot(selectedTargetRoot))
    );
  }

  async function currentProjectRecord() {
    return selectedTargetRoot
      ? selectedProjectRecord({
        path: selectedTargetRoot,
        projectRecordPath: paths.projectRecordPathForTarget(selectedTargetRoot),
        projectRuntimeRoot: paths.projectRuntimeRootForTarget(selectedTargetRoot),
        projectSessionSourceRoot: paths.projectSessionSourceRootForTarget(selectedTargetRoot),
        projectsRoot,
        selectedPath: selectedTargetRoot,
        sourceConfigRoot: paths.sourceConfigRootForTarget(selectedTargetRoot),
        sourceRoot: paths.sourceRootForTarget(selectedTargetRoot),
        source: selectionSource
      })
      : null;
  }

  async function listProjects() {
    if (!projectCatalogEnabled) {
      const selected = await currentProjectRecord();
      return {
        ok: true,
        currentProject: selected,
        hasSelection: Boolean(selected),
        projects: selected ? [selected] : [],
        projectsRoot,
        targetRoot: selectedTargetRoot
      };
    }

    const listingTargetRoot = selectedTargetRoot;
    const listed = await workspaceRecords.listWorkspaceProjects();
    const projects = listed.projects
      .map((entry) => {
        const selectionRecord = projectRecord({
          path: entry.projectRoot,
          projectsRoot,
          selectedPath: selectedTargetRoot,
          source: "workspace"
        });
        return {
          ...selectionRecord,
          ...entry,
          external: selectionRecord.external,
          name: selectionRecord.name,
          selected: selectionRecord.selected,
          source: "workspace"
        };
      })
      .sort((left, right) => left.slug.localeCompare(right.slug));
    const catalogSelection = projects.find((project) => project.selected);
    if (
      !catalogSelection &&
      listingTargetRoot &&
      selectedTargetRoot === listingTargetRoot &&
      paths.targetIsCatalogProjectHome(listingTargetRoot)
    ) {
      selectedTargetRoot = "";
      selectionSource = "";
    }
    const selected = catalogSelection || await currentProjectRecord();
    return {
      ok: true,
      currentProject: selected,
      hasSelection: Boolean(selected),
      projects,
      projectsRoot: listed.projectsRoot,
      targetRoot: selectedTargetRoot
    };
  }

  async function selectWorkspaceProject(input) {
    if (!projectCatalogEnabled) {
      throw projectCatalogUnavailableError();
    }

    assertProjectEffectAdmission();
    const slug = normalizeProjectSlug(input?.slug || input?.projectSlug || input?.name);
    paths.practiceScope(slug);
    const projectContextRoot = resolveProjectContextRoot({
      projectsRoot,
      slug
    });
    await assertDirectoryUsable(projectContextRoot);
    selectedTargetRoot = projectContextRoot;
    selectionSource = "workspace";
    return listProjects();
  }

  async function createWorkspaceProject(input = {}) {
    if (!projectCatalogEnabled) {
      throw projectCatalogUnavailableError();
    }

    const created = await workspaceRecords.createWorkspaceProjectRecord(input);
    selectedTargetRoot = created.project.projectRoot;
    selectionSource = "workspace";
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
    currentPracticeProjectScope: () => paths.practiceScope(),
    runWithPracticeProjectScope: learningProjects.runWithPracticeProjectScope,
    listLearningSpaceProjects: learningProjects.listLearningSpaceProjects,
    readLearningSpaceProject: learningProjects.readLearningSpaceProject,
    get learningSpaceRoot() {
      return learningSpaceRoot;
    },
    assertWorkspaceProjectAvailable: workspaceRecords.assertWorkspaceProjectAvailable,
    beginWorkspaceProjectDeletion: workspaceRecords.beginWorkspaceProjectDeletion,
    completeWorkspaceProjectDeletionStep: workspaceRecords.completeWorkspaceProjectDeletionStep,
    createWorkspaceProject,
    createWorkspaceProjectRecord: workspaceRecords.createWorkspaceProjectRecord,
    discardWorkspaceProjectRecord: workspaceRecords.discardWorkspaceProjectRecord,
    get projectsRoot() {
      return projectsRoot;
    },
    get projectCatalogEnabled() {
      return projectCatalogEnabled;
    },
    get systemRoot() {
      return systemRoot;
    },
    get serviceDataRoot() {
      return roots.serviceDataRoot;
    },
    get managedSourceRoot() {
      return managedSourceRoot;
    },
    get selectedProject() {
      return selectedProject();
    },
    get selectionSource() {
      return selectionSource;
    },
    get runtimeProfile() {
      return runtimeProfile;
    },
    requestContextMatchesSelectedProject,
    get targetRoot() {
      return selectedTargetRoot;
    },
    hasSelection() {
      return Boolean(selectedTargetRoot);
    },
    listProjects,
    listWorkspaceProjects: workspaceRecords.listWorkspaceProjects,
    readWorkspaceProject: workspaceRecords.readWorkspaceProject,
    readWorkspaceProjectState: workspaceRecords.readWorkspaceProjectState,
    requireSelectedTargetRoot,
    selectWorkspaceProject,
    sweepOrphanProjectRuntimeRoots: workspaceRecords.sweepOrphanProjectRuntimeRoots,
    updateWorkspaceProjectMetadata: workspaceRecords.updateWorkspaceProjectMetadata,
    projectRecordPathForSlug: paths.projectRecordPathForSlug,
    projectRecordPathForTarget: paths.projectRecordPathForTarget,
    projectRuntimeRootForSlug: paths.projectRuntimeRootForSlug,
    projectRuntimeRootForTarget: paths.projectRuntimeRootForTarget,
    projectSessionSourceRootForSlug: paths.projectSessionSourceRootForSlug,
    projectSessionSourceRootForTarget: paths.projectSessionSourceRootForTarget,
    sourceConfigRootForTarget: paths.sourceConfigRootForTarget,
    sourceRootForTarget: paths.sourceRootForTarget
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
  PROJECT_SLUG_MAX_LENGTH,
  configureStudioProjectContext,
  createStudioProjectContext,
  getStudioProjectContext,
  localProjectKeyFromTargetRoot,
  listProjectRuntimeRoots,
  normalizeDevelopmentDatabaseName,
  normalizeDevelopmentDatabaseScope,
  normalizeProjectSlug,
  projectSlugFromName,
  registerApprovalCountReader,
  resolveStudioProjectsRoot,
  resolveProjectContextRoot,
  assertDirectoryUsable as assertProjectDirectoryUsable
};
