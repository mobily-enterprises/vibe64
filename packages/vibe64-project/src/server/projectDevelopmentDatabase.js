import path from "node:path";
import { vibe64Error } from "@local/vibe64-core/server/core";
import {
  normalizeDevelopmentDatabaseName,
  normalizeDevelopmentDatabaseScope
} from "@local/vibe64-core/server/studioProjectContext";
import { developmentDatabasePolicy } from "./developmentDatabasePolicy.js";
import {
  runProjectSessionPolicyExclusive
} from "./projectSourceMutationLock.js";

/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */
/** @typedef {import("./types.js").ProjectSelection} ProjectSelection */
/** @typedef {import("./types.js").ProjectSessionWork} ProjectSessionWork */
/** @typedef {import("./types.js").ProjectResourceEnvironment} ProjectResourceEnvironment */

/**
 * The selected project's development database: whether a host manages it, the managed
 * project database's name, the policy open sessions allow, and saving its scope.
 * @param {object} dependencies
 * @param {StudioProjectContext} dependencies.projectContext
 * @param {ProjectResourceEnvironment} dependencies.resourceEnvironmentProvider
 * @param {ProjectSelection} dependencies.selection
 * @param {ProjectSessionWork} dependencies.sessionWork
 */
function createProjectDevelopmentDatabase({
  projectContext,
  resourceEnvironmentProvider,
  selection,
  sessionWork
}) {
  async function currentDevelopmentDatabaseScope() {
    return (await selection.currentDevelopmentDatabaseConfiguration()).developmentDatabaseScope;
  }

  function managedDevelopmentDatabaseAvailable() {
    return resourceEnvironmentProvider.managedDevelopmentDatabase === true;
  }

  async function managedProjectDatabaseName({ projectContextRoot, slug }) {
    // readable-check: allow method-probe - optional operation: a host that does not name managed project databases refuses
    if (typeof resourceEnvironmentProvider.developmentDatabaseNameForProject !== "function") {
      throw vibe64Error(
        "This Vibe64 installation cannot name a managed project database.",
        "vibe64_managed_development_database_name_unavailable"
      );
    }
    const developmentDatabaseName = normalizeDevelopmentDatabaseName(
      await resourceEnvironmentProvider.developmentDatabaseNameForProject({
        projectContextRoot,
        serviceDataRoot: selection.serviceDataRoot(),
        slug
      })
    );
    if (!developmentDatabaseName) {
      throw vibe64Error(
        "The managed project database name is empty.",
        "vibe64_managed_development_database_name_unavailable"
      );
    }
    return developmentDatabaseName;
  }

  async function managedDevelopmentDatabaseDefaults(input = {}) {
    if (!managedDevelopmentDatabaseAvailable()) {
      return {};
    }
    const projectContextRoot = String(input.projectContextRoot || "").trim();
    if (!path.isAbsolute(projectContextRoot)) {
      throw vibe64Error(
        "Managed project database defaults require an absolute project context root.",
        "vibe64_managed_development_database_project_root_invalid"
      );
    }
    return {
      developmentDatabaseName: await managedProjectDatabaseName({
        projectContextRoot,
        slug: String(input.slug || path.basename(projectContextRoot)).trim()
      }),
      developmentDatabaseScope: "project"
    };
  }

  async function currentDevelopmentDatabasePolicy(input = {}) {
    const openSessions = Array.isArray(input.openSessions)
      ? input.openSessions
      : await (await sessionWork.createRuntimeWithoutSource()).listSessionSummaries({
          statusGroup: "open"
        });
    return developmentDatabasePolicy({
      managed: managedDevelopmentDatabaseAvailable(),
      openSessions,
      scope: await currentDevelopmentDatabaseScope(),
      allowSharedDatabaseSessions: (await selection.currentProjectState())?.allowSharedDatabaseSessions === true
    });
  }

  async function developmentDatabaseState() {
    return (await currentDevelopmentDatabasePolicy()).developmentDatabase;
  }

  async function saveDevelopmentDatabaseScopeState(input = {}) {
    if (!managedDevelopmentDatabaseAvailable()) {
      throw vibe64Error(
        "This Vibe64 installation does not manage development databases.",
        "vibe64_managed_development_database_unavailable"
      );
    }
    return runProjectSessionPolicyExclusive(
      selection.selectedProjectRuntimeRoot(),
      async () => {
        const policy = await currentDevelopmentDatabasePolicy();
        const scope = normalizeDevelopmentDatabaseScope(input.scope);
        if (scope !== policy.developmentDatabase.scope && !policy.developmentDatabase.canChange) {
          throw vibe64Error(
            policy.developmentDatabase.disabledReason,
            "vibe64_development_database_scope_busy"
          );
        }
        const slug = selection.currentProjectSlug();
        const currentProject = await selection.currentProjectState();
        let developmentDatabaseName = normalizeDevelopmentDatabaseName(
          currentProject?.developmentDatabaseName
        );
        if (scope === "project" && !developmentDatabaseName) {
          developmentDatabaseName = await managedProjectDatabaseName({
            projectContextRoot: selection.requireSelectedTargetRoot(),
            slug
          });
        }
        await projectContext.updateWorkspaceProjectMetadata({
          ...(developmentDatabaseName ? { developmentDatabaseName } : {}),
          developmentDatabaseScope: scope,
          ...(Object.hasOwn(input, "allowSharedDatabaseSessions")
            ? { allowSharedDatabaseSessions: input.allowSharedDatabaseSessions } : {}),
          slug
        });
        return {
          ...(await currentDevelopmentDatabasePolicy()).developmentDatabase,
          ok: true
        };
      },
      {
        operation: "save-development-database-scope"
      }
    );
  }

  return Object.freeze({
    managedDevelopmentDatabaseDefaults,
    currentDevelopmentDatabasePolicy,
    developmentDatabaseState,
    saveDevelopmentDatabaseScopeState
  });
}

export {
  createProjectDevelopmentDatabase
};
