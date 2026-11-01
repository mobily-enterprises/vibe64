import path from "node:path";

import { relativePathInside } from "./core.js";
import { currentPracticeProjectScope } from "./practiceContext.js";
import {
  normalizeProjectSlug,
  EXTERNAL_PROJECT_LOCAL_ROOTS_DIR,
  resolveProjectRecordPath,
  resolveProjectRuntimeRoot,
  resolveSourceConfigRoot
} from "./projectState.js";
import {
  localProjectKeyFromTargetRoot,
  normalizeRoot,
  resolveCatalogProjectRuntimeRoot,
  resolveProjectContextRoot
} from "./studioProjectRecords.js";

/**
 * Where each project's context, record, runtime and sources live, by slug or
 * by target folder, inside a learner's practice scope when one is active.
 * @param {object} dependencies
 * @param {string} dependencies.managedSourceRoot
 * @param {object} dependencies.practiceOwner
 * @param {boolean} dependencies.projectCatalogEnabled
 * @param {string} dependencies.projectsRoot
 * @param {string} dependencies.systemRoot
 */
function createProjectPaths({
  managedSourceRoot,
  practiceOwner,
  projectCatalogEnabled,
  projectsRoot,
  systemRoot
}) {
  function practiceScope(slug) {
    const scope = currentPracticeProjectScope(practiceOwner);
    if (scope && slug !== undefined && normalizeProjectSlug(slug) !== scope.slug) {
      throw Object.assign(new Error("Practice access cannot select another project."), { code: "vibe64_practice_scope_mismatch" });
    }
    return scope;
  }

  function targetIsCatalogProjectHome(targetRoot = "") {
    if (!projectCatalogEnabled || !projectsRoot) {
      return false;
    }
    const relativePath = relativePathInside(normalizeRoot(projectsRoot), normalizeRoot(targetRoot));
    if (!relativePath) {
      return false;
    }
    if (relativePath.includes(path.sep)) {
      return false;
    }
    try {
      return normalizeProjectSlug(relativePath) === relativePath;
    } catch {
      return false;
    }
  }

  function externalProjectRuntimeRootForTarget(targetRoot = "") {
    return path.join(
      systemRoot,
      EXTERNAL_PROJECT_LOCAL_ROOTS_DIR,
      localProjectKeyFromTargetRoot(targetRoot)
    );
  }

  function externalProjectSessionSourceRootForTarget(targetRoot = "") {
    return path.join(
      managedSourceRoot,
      localProjectKeyFromTargetRoot(targetRoot)
    );
  }

  function projectContextRootForSlug(slug = "") {
    const scope = practiceScope(slug);
    if (scope) return scope.targetRoot;
    return resolveProjectContextRoot({
      projectsRoot,
      slug: normalizeProjectSlug(slug)
    });
  }

  function projectRecordPathForSlug(slug = "") {
    return resolveProjectRecordPath({
      projectRuntimeRoot: projectRuntimeRootForSlug(slug)
    });
  }

  function projectRecordPathForTarget(targetRoot = "") {
    const scope = practiceScope();
    if (scope && normalizeRoot(targetRoot) === scope.targetRoot) return scope.projectRecordPath;
    return targetIsCatalogProjectHome(targetRoot)
      ? resolveProjectRecordPath({
          projectRuntimeRoot: projectRuntimeRootForTarget(targetRoot)
        })
      : "";
  }

  function projectRuntimeRootForSlug(slug = "") {
    const scope = practiceScope(slug);
    if (scope) return scope.projectRuntimeRoot;
    if (!projectCatalogEnabled) {
      return resolveProjectRuntimeRoot({
        projectRuntimeRoot: projectContextRootForSlug(slug)
      });
    }
    return resolveCatalogProjectRuntimeRoot({
      slug,
      systemRoot
    });
  }

  function projectRuntimeRootForTarget(targetRoot = "") {
    const scope = practiceScope();
    if (scope && normalizeRoot(targetRoot) === scope.targetRoot) return scope.projectRuntimeRoot;
    return targetIsCatalogProjectHome(targetRoot)
      ? resolveCatalogProjectRuntimeRoot({
          slug: path.basename(normalizeRoot(targetRoot)),
          systemRoot
        })
      : externalProjectRuntimeRootForTarget(targetRoot);
  }

  function projectSessionSourceRootForSlug(slug = "") {
    const scope = practiceScope(slug);
    if (scope) return scope.projectSessionSourceRoot;
    return projectContextRootForSlug(slug);
  }

  function projectSessionSourceRootForTarget(targetRoot = "") {
    const scope = practiceScope();
    if (scope && normalizeRoot(targetRoot) === scope.targetRoot) return scope.projectSessionSourceRoot;
    return targetIsCatalogProjectHome(targetRoot)
      ? projectContextRootForSlug(path.basename(normalizeRoot(targetRoot)))
      : externalProjectSessionSourceRootForTarget(targetRoot);
  }

  function sourceRootForTarget(targetRoot = "") {
    const scope = practiceScope();
    if (scope && normalizeRoot(targetRoot) === scope.targetRoot) return "";
    return targetIsCatalogProjectHome(targetRoot) ? "" : normalizeRoot(targetRoot);
  }

  function sourceConfigRootForTarget(targetRoot = "") {
    const sourceRoot = sourceRootForTarget(targetRoot);
    return sourceRoot
      ? resolveSourceConfigRoot({
          sourceRoot
        })
      : "";
  }

  return Object.freeze({
    practiceScope,
    targetIsCatalogProjectHome,
    projectContextRootForSlug,
    projectRecordPathForSlug,
    projectRecordPathForTarget,
    projectRuntimeRootForSlug,
    projectRuntimeRootForTarget,
    projectSessionSourceRootForSlug,
    projectSessionSourceRootForTarget,
    sourceRootForTarget,
    sourceConfigRootForTarget
  });
}

export { createProjectPaths };
