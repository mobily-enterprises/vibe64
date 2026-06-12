import path from "node:path";
import process from "node:process";

import {
  VIBE64_STATE_DIR,
  normalizeTargetRoot,
  normalizeText
} from "./core.js";
import {
  VIBE64_PROJECT_LOCAL_DIR
} from "./studioRoots.js";

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

function resolveProjectStateRoot({
  targetRoot = process.cwd()
} = {}) {
  return path.join(normalizeTargetRoot(targetRoot), VIBE64_STATE_DIR);
}

function resolveProjectLocalRoot({
  targetRoot = process.cwd()
} = {}) {
  return path.join(normalizeTargetRoot(targetRoot), VIBE64_PROJECT_LOCAL_DIR);
}

export {
  normalizeProjectStateSlug,
  projectStateSlugFromTargetRoot,
  resolveProjectLocalRoot,
  resolveProjectStateRoot
};
