import {
  isPlainObject,
  normalizeText
} from "./core.js";

const PROJECT_REPOSITORY_MODE_GITHUB = "github";
const PROJECT_REPOSITORY_MODE_MANAGED_GIT = "managed_git";
const PROJECT_REPOSITORY_MODE_LOCAL_SOURCE = "local_source";

const WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR = "github_pr";
const WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT = "canonical_git";
const WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE = "local_source";

const PROJECT_REPOSITORY_MODES = Object.freeze({
  GITHUB: PROJECT_REPOSITORY_MODE_GITHUB,
  MANAGED_GIT: PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  LOCAL_SOURCE: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
});

const WORKFLOW_REPOSITORY_PROFILES = Object.freeze({
  GITHUB_PR: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  CANONICAL_GIT: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  LOCAL_SOURCE: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
});

function normalizeRepositoryMode(value = "") {
  const mode = normalizeText(value).toLowerCase().replace(/[-\s]+/gu, "_");
  if (
    mode === PROJECT_REPOSITORY_MODE_GITHUB ||
    mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT ||
    mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
  ) {
    return mode;
  }
  return "";
}

function normalizeWorkflowRepositoryProfile(value = "") {
  const profile = normalizeText(value).toLowerCase().replace(/[-\s]+/gu, "_");
  if (
    profile === WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR ||
    profile === WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT ||
    profile === WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
  ) {
    return profile;
  }
  return "";
}

function workflowRepositoryProfileForMode(value = "") {
  const mode = normalizeRepositoryMode(value);
  if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    return WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR;
  }
  if (mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    return WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT;
  }
  if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE;
  }
  return "";
}

function normalizeProjectGithubRepository(value = {}) {
  const input = isPlainObject(value) ? value : {};
  const fullName = normalizeText(input.fullName);
  const owner = normalizeText(input.owner);
  const name = normalizeText(input.name);
  if (!fullName && (!owner || !name)) {
    return null;
  }
  const normalizedFullName = fullName || `${owner}/${name}`;
  return {
    canPush: input.canPush === true,
    cloneUrl: normalizeText(input.cloneUrl),
    defaultBranch: normalizeText(input.defaultBranch),
    fullName: normalizedFullName,
    isPrivate: input.isPrivate === true,
    name: name || normalizedFullName.split("/").pop() || "",
    owner: owner || normalizedFullName.split("/")[0] || "",
    source: normalizeText(input.source),
    url: normalizeText(input.url),
    viewerPermission: normalizeText(input.viewerPermission).toUpperCase(),
    visibility: normalizeText(input.visibility).toLowerCase()
  };
}

function normalizeProjectRepository(value = {}, {
  fallbackMode = "",
  githubRepository = null
} = {}) {
  const input = isPlainObject(value) ? value : {};
  const repositoryGithub = normalizeProjectGithubRepository(input.github);
  const legacyGithub = normalizeProjectGithubRepository(githubRepository);
  const github = repositoryGithub || legacyGithub;
  const mode = normalizeRepositoryMode(input.mode) ||
    (github ? PROJECT_REPOSITORY_MODE_GITHUB : normalizeRepositoryMode(fallbackMode));
  if (!mode) {
    return null;
  }

  const defaultBranch = normalizeText(input.defaultBranch || github?.defaultBranch);
  if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    if (!github) {
      return null;
    }
    return {
      mode,
      defaultBranch,
      github: {
        ...github,
        defaultBranch: github.defaultBranch || defaultBranch
      }
    };
  }

  return {
    mode,
    defaultBranch
  };
}

function projectRepositoryView(metadata = {}, {
  fallbackMode = ""
} = {}) {
  const input = isPlainObject(metadata) ? metadata : {};
  const repository = normalizeProjectRepository(input.repository, {
    fallbackMode,
    githubRepository: input.githubRepository
  });
  const repositoryMode = repository?.mode || "";
  const workflowRepositoryProfile = workflowRepositoryProfileForMode(repositoryMode);
  const githubRepository = repositoryMode === PROJECT_REPOSITORY_MODE_GITHUB
    ? normalizeProjectGithubRepository(repository.github)
    : null;
  return {
    ...(repository ? { repository } : {}),
    ...(repositoryMode ? { repositoryMode } : {}),
    ...(workflowRepositoryProfile ? { workflowRepositoryProfile } : {}),
    ...(githubRepository ? { githubRepository } : {})
  };
}

function projectRepositoryMetadataFromInput(input = {}, {
  defaultMode = ""
} = {}) {
  const source = isPlainObject(input) ? input : {};
  const repository = normalizeProjectRepository(source.repository, {
    fallbackMode: defaultMode,
    githubRepository: source.githubRepository
  });
  if (!repository) {
    return {};
  }
  return {
    repository,
    ...(repository.mode === PROJECT_REPOSITORY_MODE_GITHUB
      ? { githubRepository: normalizeProjectGithubRepository(repository.github) }
      : {})
  };
}

export {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODES,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE,
  WORKFLOW_REPOSITORY_PROFILES,
  normalizeProjectGithubRepository,
  normalizeProjectRepository,
  normalizeRepositoryMode,
  normalizeWorkflowRepositoryProfile,
  projectRepositoryMetadataFromInput,
  projectRepositoryView,
  workflowRepositoryProfileForMode
};
