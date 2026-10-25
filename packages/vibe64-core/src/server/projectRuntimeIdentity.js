import path from "node:path";
import process from "node:process";

import {
  currentProjectRequestContext
} from "./projectRequestContext.js";
import { practiceIdFromSlug } from "./learningSpace.js";
import {
  getStudioProjectContext,
  localProjectKeyFromTargetRoot,
  normalizeProjectSlug,
  projectSlugFromName,
  resolveStudioProjectsRoot
} from "./studioProjectContext.js";
import { pathInsideOrEqual } from "./core.js";

const LOCAL_PROJECT_KEY_PATTERN = /^([a-z0-9][a-z0-9_-]*)-([a-f0-9]{12})$/u;

function projectRuntimeIdentity(slug = "") {
  return `project:${normalizeProjectSlug(slug)}`;
}

// A learning-space path is <root>/<learnerKey>/<practiceId>/<slug>/...
function learningSpaceSlugFromTargetRoot(targetRoot, learningSpaceRoot) {
  if (!pathInsideOrEqual(learningSpaceRoot, targetRoot)) return "";
  const [, practiceId = "", slug = ""] = path.relative(learningSpaceRoot, targetRoot).split(path.sep);
  return practiceId && practiceIdFromSlug(slug) === practiceId ? slug : "";
}

// A caller that names its projectsRoot names its learning space too; only the
// default (no roots) reads the configured context's learning space.
function catalogProjectSlugFromTargetRoot(targetRoot = "", {
  projectsRoot = "",
  learningSpaceRoot = projectsRoot ? "" : getStudioProjectContext()?.learningSpaceRoot
} = {}) {
  const resolvedTargetRoot = path.resolve(String(targetRoot || "").trim() || process.cwd());
  const practiceSlug = String(learningSpaceRoot || "").trim()
    ? learningSpaceSlugFromTargetRoot(resolvedTargetRoot, path.resolve(learningSpaceRoot)) : "";
  if (practiceSlug) return practiceSlug;
  const resolvedProjectsRoot = path.resolve(String(projectsRoot || "").trim() || resolveStudioProjectsRoot());
  if (!pathInsideOrEqual(resolvedProjectsRoot, resolvedTargetRoot)) {
    return "";
  }

  const relative = path.relative(resolvedProjectsRoot, resolvedTargetRoot);
  const [candidateSlug = ""] = relative.split(path.sep).filter(Boolean);
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

  const catalogSlug = catalogProjectSlugFromTargetRoot(resolvedTargetRoot);
  if (catalogSlug) {
    return projectRuntimeIdentity(catalogSlug);
  }

  const localProjectKey = localProjectKeyFromSessionExecutionRoot(resolvedTargetRoot);
  return `local-project:${localProjectKey || localProjectKeyFromTargetRoot(resolvedTargetRoot)}`;
}

function targetRuntimeProjectSlug(targetRoot = "") {
  const resolvedTargetRoot = path.resolve(String(targetRoot || "").trim() || process.cwd());
  const projectContext = currentProjectRequestContext();
  const contextSlug = String(projectContext?.slug || "").trim();
  const contextTargetRoot = String(projectContext?.targetRoot || "").trim();
  if (
    contextSlug &&
    (!contextTargetRoot || pathInsideOrEqual(contextTargetRoot, resolvedTargetRoot))
  ) {
    return normalizeProjectSlug(contextSlug);
  }

  const catalogSlug = catalogProjectSlugFromTargetRoot(resolvedTargetRoot);
  if (catalogSlug) {
    return catalogSlug;
  }

  return normalizeProjectSlug(projectSlugFromName(path.basename(resolvedTargetRoot)));
}

export {
  catalogProjectSlugFromTargetRoot,
  targetRuntimeProjectSlug,
  targetRuntimeIdentity,
  projectRuntimeIdentity
};
