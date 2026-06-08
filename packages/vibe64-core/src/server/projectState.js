import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

import {
  normalizeTargetRoot,
  normalizeText
} from "./core.js";
import {
  resolveVibe64DataRoot
} from "./studioRoots.js";

const PROJECTS_STATE_DIR = "projects";
const EXTERNAL_PROJECTS_STATE_DIR = "external-projects";
const PROJECT_STATE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;

function normalizeProjectStateSlug(value = "") {
  const slug = normalizeText(value);
  if (!PROJECT_STATE_SLUG_PATTERN.test(slug)) {
    const error = new Error(`Invalid Vibe64 project state slug: ${slug || "(empty)"}`);
    error.code = "vibe64_invalid_project_state_slug";
    throw error;
  }
  return slug;
}

function projectStateSlugFromTargetRoot(targetRoot = process.cwd()) {
  return normalizeProjectStateSlug(path.basename(normalizeTargetRoot(targetRoot)));
}

function externalProjectStateKeyFromTargetRoot(targetRoot = process.cwd()) {
  const normalizedTargetRoot = normalizeTargetRoot(targetRoot);
  const readableName = normalizeText(path.basename(normalizedTargetRoot))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "target";
  const digest = createHash("sha256")
    .update(normalizedTargetRoot)
    .digest("hex")
    .slice(0, 16);
  return `${readableName}-${digest}`;
}

function resolveProjectStateRoot({
  dataRoot = "",
  env = process.env,
  home = undefined,
  slug = "",
  targetRoot = process.cwd()
} = {}) {
  const projectSlug = normalizeProjectStateSlug(slug || projectStateSlugFromTargetRoot(targetRoot));
  return path.join(resolveVibe64DataRoot({
    env,
    explicitRoot: dataRoot,
    ...(home === undefined ? {} : { home })
  }), PROJECTS_STATE_DIR, projectSlug);
}

function resolveExternalProjectStateRoot({
  dataRoot = "",
  env = process.env,
  home = undefined,
  targetRoot = process.cwd()
} = {}) {
  return path.join(resolveVibe64DataRoot({
    env,
    explicitRoot: dataRoot,
    ...(home === undefined ? {} : { home })
  }), EXTERNAL_PROJECTS_STATE_DIR, externalProjectStateKeyFromTargetRoot(targetRoot));
}

export {
  EXTERNAL_PROJECTS_STATE_DIR,
  PROJECTS_STATE_DIR,
  externalProjectStateKeyFromTargetRoot,
  normalizeProjectStateSlug,
  projectStateSlugFromTargetRoot,
  resolveExternalProjectStateRoot,
  resolveProjectStateRoot
};
