import path from "node:path";
import process from "node:process";

import {
  normalizeTargetRoot,
  normalizeText
} from "./core.js";
import {
  VIBE64_PROJECT_SHARED_DIR
} from "./studioRoots.js";

const PROJECT_STATE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const PROJECT_RECORD_FILE = "project.json";
const PROJECT_SESSIONS_DIR = "sessions";
const PROJECT_DEPLOYMENTS_DIR = "deployments";
const PROJECT_GIT_CACHE_DIR = "git-cache";
const PROJECT_RUNTIME_DIR = "runtime";
const PROJECT_RUNTIME_CONFIG_DIR = "runtime-config";
const PROJECT_INFO_CACHE_FILE = "projectInfoCache.json";

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
  return resolveSourceConfigRoot({
    sourceRoot: targetRoot
  });
}

function resolveProjectHomeStateRoot({
  projectHome = "",
  targetRoot = process.cwd()
} = {}) {
  return resolveProjectRuntimeRoot({
    projectRoot: projectHome || targetRoot
  });
}

function resolveProjectLocalRoot({
  targetRoot = process.cwd()
} = {}) {
  return resolveProjectRuntimeRoot({
    projectRoot: targetRoot
  });
}

function resolveProjectHomeLocalRoot({
  projectHome = "",
  targetRoot = process.cwd()
} = {}) {
  return resolveProjectRuntimeRoot({
    projectRoot: projectHome || targetRoot
  });
}

function resolveSourceConfigRoot({
  sourceRoot = process.cwd()
} = {}) {
  return path.join(normalizeTargetRoot(sourceRoot), VIBE64_PROJECT_SHARED_DIR);
}

function resolveProjectRuntimeRoot({
  projectRoot = process.cwd()
} = {}) {
  return normalizeTargetRoot(projectRoot);
}

function resolveOnlineProjectRecordPath({
  projectRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot
  }), PROJECT_RECORD_FILE);
}

function resolveProjectSessionsRoot({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_SESSIONS_DIR);
}

function resolveProjectDeploymentsRoot({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_DEPLOYMENTS_DIR);
}

function resolveProjectGitCacheRoot({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_GIT_CACHE_DIR);
}

function resolveProjectRuntimeFilesRoot({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_RUNTIME_DIR);
}

function resolveProjectRuntimeConfigRoot({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_RUNTIME_CONFIG_DIR);
}

function resolveProjectInfoCachePath({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_INFO_CACHE_FILE);
}

export {
  PROJECT_DEPLOYMENTS_DIR,
  PROJECT_GIT_CACHE_DIR,
  PROJECT_INFO_CACHE_FILE,
  PROJECT_RECORD_FILE,
  PROJECT_RUNTIME_CONFIG_DIR,
  PROJECT_RUNTIME_DIR,
  PROJECT_SESSIONS_DIR,
  normalizeProjectStateSlug,
  projectStateSlugFromTargetRoot,
  resolveOnlineProjectRecordPath,
  resolveProjectDeploymentsRoot,
  resolveProjectGitCacheRoot,
  resolveProjectHomeLocalRoot,
  resolveProjectHomeStateRoot,
  resolveProjectInfoCachePath,
  resolveProjectLocalRoot,
  resolveProjectRuntimeConfigRoot,
  resolveProjectRuntimeFilesRoot,
  resolveProjectRuntimeRoot,
  resolveProjectSessionsRoot,
  resolveProjectStateRoot,
  resolveSourceConfigRoot
};
