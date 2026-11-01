import path from "node:path";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import {
  normalizeDevelopmentDatabaseName,
  normalizeDevelopmentDatabaseScope
} from "@local/vibe64-core/server/studioProjectContext";
import {
  currentProjectRequestContext,
  currentProjectRuntimeRoot,
  currentProjectSessionSourceRoot,
  currentProjectSourceConfigRoot,
  currentProjectSourceRoot,
  currentProjectTargetRoot,
  runWithResolvedProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { resolveSourceConfigRoot } from "@local/vibe64-core/server/projectState";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

function publicProject(project = {}, options = {}) {
  const {
    context = null,
    selected = false
  } = options;
  const projectRoot = context?.targetRoot || project.projectRoot || project.path || "";
  const slug = context?.slug || project.slug || project.name || path.basename(projectRoot);
  return {
    canonicalRepositoryPath: project.canonicalRepositoryPath || "",
    allowSharedDatabaseSessions: project.allowSharedDatabaseSessions === true,
    developmentDatabaseScope: normalizeDevelopmentDatabaseScope(
      project.developmentDatabaseScope
    ),
    developmentDatabaseName: normalizeDevelopmentDatabaseName(
      project.developmentDatabaseName
    ),
    githubMirrorPath: project.githubMirrorPath || "",
    ...(project.githubRepository ? { githubRepository: project.githubRepository } : {}),
    name: slug,
    path: projectRoot,
    projectRecordPath: context?.projectRecordPath || project.projectRecordPath || "",
    projectRoot,
    projectRuntimeRoot: context?.projectRuntimeRoot || project.projectRuntimeRoot || "",
    projectSessionSourceRoot: context?.projectSessionSourceRoot || project.projectSessionSourceRoot || "",
    ...(project.repository ? { repository: project.repository } : {}),
    repositoryMode: project.repositoryMode || project.repository?.mode || "",
    runtime: project.runtime || null,
    selected: Boolean(selected),
    slug,
    source: project.source || "workspace",
    sourceConfigRoot: context?.sourceConfigRoot || project.sourceConfigRoot || "",
    sourceRoot: context?.sourceRoot || project.sourceRoot || ""
  };
}

/**
 * The selected project: its target, source, runtime and session-source roots for the
 * current request, its session store, the session or source an input names, and the
 * project list with the current project's record.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {StudioProjectContext} dependencies.projectContext
 */
function createProjectSelection({ logger, projectContext }) {
  function selectedTargetRoot() {
    return String(currentProjectTargetRoot() || projectContext.targetRoot || "").trim();
  }

  function requireSelectedTargetRoot() {
    const target = selectedTargetRoot();
    if (target) {
      return target;
    }
    return projectContext.requireSelectedTargetRoot();
  }

  /**
   * The project's address: the request's slug, else the selected project's
   * (a local directory's name normalized, never the raw directory name).
   */
  function currentProjectSlug() {
    return String(currentProjectRequestContext()?.slug || projectContext.selectedProject?.slug || "").trim();
  }

  function serviceDataRoot() {
    return String(projectContext.serviceDataRoot || "").trim();
  }

  function selectedSourceRoot() {
    const requestSource = currentProjectSourceRoot();
    if (requestSource) {
      return requestSource;
    }
    const target = selectedTargetRoot();
    if (!target) {
      return "";
    }
    return projectContext.sourceRootForTarget(target);
  }

  function selectedSourceConfigRoot() {
    const requestRoot = currentProjectSourceConfigRoot();
    if (requestRoot) {
      return requestRoot;
    }
    const sourceRoot = selectedSourceRoot();
    if (!sourceRoot) {
      return "";
    }
    return resolveSourceConfigRoot({
      sourceRoot
    });
  }

  function selectedProjectRuntimeRoot() {
    const requestRoot = currentProjectRuntimeRoot();
    if (requestRoot) {
      return requestRoot;
    }
    const target = selectedTargetRoot();
    if (!target) {
      return "";
    }
    return projectContext.projectRuntimeRootForTarget(target);
  }

  function selectedSessionSourceRoot() {
    const requestRoot = currentProjectSessionSourceRoot();
    if (requestRoot) {
      return requestRoot;
    }
    const target = selectedTargetRoot();
    return target ? projectContext.projectSessionSourceRootForTarget(target) : "";
  }

  function sessionStore() {
    const target = requireSelectedTargetRoot();
    return createVibe64SessionStore({
      logger,
      projectContextRoot: target,
      projectRuntimeRoot: selectedProjectRuntimeRoot(),
      projectSessionSourceRoot: selectedSessionSourceRoot()
    });
  }

  async function sourceForInput(input = {}) {
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
      const sourceRoot = selectedSourceRoot();
      return {
        label: sourceRoot ? "Standalone source" : "Project metadata",
        rootKind: sourceRoot ? "standalone-source" : "metadata-only",
        sessionId: "",
        sourceRoot
      };
    }
    return {
      label: "Session source",
      rootKind: "session-source",
      sessionId,
      sourceRoot: sessionSourcePath(await sessionForInput(input, sessionId))
    };
  }

  /**
   * Internal orchestration may already hold a session record obtained
   * through a narrower capability than the public store reader (for
   * example, a renewal successor before it becomes visible). Reuse only an
   * exact-id record; ordinary callers still cross the public read boundary.
   */
  async function sessionForInput(input = {}, sessionId = "") {
    const providedSessionId = String(input.session?.sessionId || "").trim();
    return providedSessionId === sessionId
      ? input.session
      : sessionStore().readSession(sessionId);
  }

  async function listProjectsState() {
    const requestContext = currentProjectRequestContext();
    if (!requestContext?.targetRoot || projectContext.requestContextMatchesSelectedProject(requestContext)) {
      const listed = await projectContext.listProjects();
      const currentProject = listed.currentProject
        ? publicProject(listed.currentProject, {
            selected: true
          })
        : null;
      const projects = listed.projects.map((project) => publicProject(project, {
        selected: project.selected
      }));
      if (currentProject && !projects.some((project) => project.slug === currentProject.slug)) {
        projects.push(currentProject);
        projects.sort((left, right) => left.slug.localeCompare(right.slug));
      }
      return {
        ...listed,
        currentProject,
        projects
      };
    }
    const listed = await projectContext.listWorkspaceProjects();
    const current = listed.projects.find((project) => project.slug === requestContext.slug) || {};
    const projects = listed.projects.map((project) => publicProject(project, {
      context: project.slug === requestContext.slug ? requestContext : null,
      selected: project.slug === requestContext.slug
    }));
    return {
      currentProject: publicProject(current, {
        context: requestContext,
        selected: true
      }),
      hasSelection: true,
      ok: true,
      projects,
      projectsRoot: requestContext.projectsRoot || listed.projectsRoot,
      targetRoot: requestContext.targetRoot
    };
  }

  async function currentProjectState() {
    const listed = await listProjectsState();
    return listed.currentProject;
  }

  async function currentDevelopmentDatabaseConfiguration() {
    const project = await currentProjectState();
    return {
      developmentDatabaseName: normalizeDevelopmentDatabaseName(project?.developmentDatabaseName),
      developmentDatabaseScope: normalizeDevelopmentDatabaseScope(project?.developmentDatabaseScope)
    };
  }

  /**
   * A settings write without a session or standalone source targets the
   * current session's source.
   */
  async function settingsSourceInput(input = {}) {
    if (String(input.sessionId || "").trim() || selectedSourceRoot()) {
      return input;
    }
    const session = await sessionStore().readCurrentSession();
    return session?.sessionId
      ? { ...input, sessionId: session.sessionId }
      : input;
  }

  async function genesisSettingsSourceForInput(input = {}) {
    const source = await sourceForInput(input);
    if (source.sourceRoot || source.sessionId) {
      return source;
    }
    const session = await sessionStore().readCurrentSession();
    return session
      ? sourceForInput({
          ...input,
          session,
          sessionId: session.sessionId
        })
      : source;
  }

  async function runInProjectContext(slug, operation, options = {}) {
    const {
      allowDeleting = false,
      vibe64User = null
    } = options;
    return runWithResolvedProjectRequestContext({
      projectContext,
      request: {
        allowDeleting,
        vibe64User,
        params: {
          slug
        }
      }
    }, operation);
  }

  return Object.freeze({
    selectedTargetRoot,
    requireSelectedTargetRoot,
    currentProjectSlug,
    serviceDataRoot,
    selectedSourceRoot,
    selectedSourceConfigRoot,
    selectedProjectRuntimeRoot,
    selectedSessionSourceRoot,
    sessionStore,
    sourceForInput,
    sessionForInput,
    listProjectsState,
    currentProjectState,
    currentDevelopmentDatabaseConfiguration,
    settingsSourceInput,
    genesisSettingsSourceForInput,
    runInProjectContext
  });
}

export {
  createProjectSelection
};
