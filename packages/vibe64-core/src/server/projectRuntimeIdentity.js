import path from "node:path";
import process from "node:process";

import {
  currentProjectRequestContext
} from "./projectRequestContext.js";
import { practiceIdFromSlug } from "./learningSpace.js";
import {
  getStudioProjectContext,
  localProjectKeyFromTargetRoot,
  normalizeProjectSlug
} from "./studioProjectContext.js";
import { pathInsideOrEqual } from "./core.js";

const LOCAL_PROJECT_KEY_PATTERN = /^([a-z0-9][a-z0-9_-]*)-([a-f0-9]{12})$/u;

function projectRuntimeIdentity(slug = "") {
  return `project:${normalizeProjectSlug(slug)}`;
}

/**
 * A learning-space path is <root>/<learnerKey>/<practiceId>/<slug>/...
 */
function learningSpaceSlugFromTargetRoot(targetRoot, learningSpaceRoot) {
  if (!pathInsideOrEqual(learningSpaceRoot, targetRoot)) return "";
  const [, practiceId = "", slug = ""] = path.relative(learningSpaceRoot, targetRoot).split(path.sep);
  return practiceId && practiceIdFromSlug(slug) === practiceId ? slug : "";
}

/**
 * The catalogue or practice project a target root belongs to: its practice
 * namespace in the learning space, else its first folder below the projects
 * root; "" for neither. An empty root names no folder.
 * @param {string} targetRoot an absolute path
 * @param {{ projectsRoot: string, learningSpaceRoot: string }} roots
 */
function catalogProjectSlugFromTargetRoot(targetRoot, { projectsRoot, learningSpaceRoot }) {
  const practiceSlug = learningSpaceRoot ? learningSpaceSlugFromTargetRoot(targetRoot, path.resolve(learningSpaceRoot)) : "";
  if (practiceSlug) return practiceSlug;
  if (!projectsRoot || !pathInsideOrEqual(projectsRoot, targetRoot)) return "";
  const [candidateSlug = ""] = path.relative(path.resolve(projectsRoot), targetRoot).split(path.sep).filter(Boolean);
  if (!candidateSlug) {
    return "";
  }
  try {
    return normalizeProjectSlug(candidateSlug);
  } catch {
    return "";
  }
}

function localProjectKeyFromSessionExecutionRoot(targetRoot = "") {
  const sourceRoot = path.resolve(String(targetRoot || "").trim() || process.cwd());
  const sessionRoot = path.dirname(sourceRoot);
  const activeRoot = path.dirname(sessionRoot);
  const sessionsRoot = path.dirname(activeRoot);
  if (
    path.basename(sourceRoot) !== "source" ||
    !path.basename(sessionRoot) ||
    path.basename(activeRoot) !== "active" ||
    path.basename(sessionsRoot) !== "sessions"
  ) {
    return "";
  }

  const candidate = path.basename(path.dirname(sessionsRoot));
  const match = candidate.match(LOCAL_PROJECT_KEY_PATTERN);
  if (!match) {
    return "";
  }
  try {
    return normalizeProjectSlug(match[1]) === match[1] ? candidate : "";
  } catch {
    return "";
  }
}

function targetRuntimeIdentity(targetRoot = "") {
  const resolvedTargetRoot = path.resolve(String(targetRoot || "").trim() || process.cwd());
  const projectContext = currentProjectRequestContext();
  const contextSlug = String(projectContext?.slug || "").trim();
  const contextRoots = [
    projectContext?.targetRoot,
    projectContext?.sourceRoot,
    projectContext?.projectSessionSourceRoot
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const contextMatchesTarget = contextSlug && (
    contextRoots.length < 1 ||
    contextRoots.some((root) => pathInsideOrEqual(root, resolvedTargetRoot))
  );
  if (contextMatchesTarget) {
    const sourceRoot = String(projectContext?.sourceRoot || "").trim();
    return sourceRoot
      ? `local-project:${localProjectKeyFromTargetRoot(sourceRoot)}`
      : projectRuntimeIdentity(contextSlug);
  }

  const { learningSpaceRoot, slugProjectsRoot } = getStudioProjectContext();
  const catalogSlug = catalogProjectSlugFromTargetRoot(resolvedTargetRoot, { learningSpaceRoot, projectsRoot: slugProjectsRoot });
  if (catalogSlug) {
    return projectRuntimeIdentity(catalogSlug);
  }

  const localProjectKey = localProjectKeyFromSessionExecutionRoot(resolvedTargetRoot);
  return `local-project:${localProjectKey || localProjectKeyFromTargetRoot(resolvedTargetRoot)}`;
}

const __testables = Object.freeze({ catalogProjectSlugFromTargetRoot });

export {
  targetRuntimeIdentity,
  projectRuntimeIdentity,
  __testables
};
