import {
  isPlainObject,
  normalizeText
} from "./core.js";
import {
  PROJECT_CANONICAL_REPOSITORY_DIR,
  PROJECT_GITHUB_MIRROR_DIR,
  resolveProjectCanonicalRepositoryPath,
  resolveProjectGithubMirrorPath
} from "./projectState.js";

const PROJECT_REPOSITORY_MODE_GITHUB = "github";
const PROJECT_REPOSITORY_MODE_MANAGED_GIT = "managed_git";
const PROJECT_REPOSITORY_MODE_LOCAL_SOURCE = "local_source";
const PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH = "main";

const PROJECT_REPOSITORY_MODES = Object.freeze({
  GITHUB: PROJECT_REPOSITORY_MODE_GITHUB,
  MANAGED_GIT: PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  LOCAL_SOURCE: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
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

function projectRepositoryStorageRole({
  mode = "",
  projectRuntimeRoot = ""
} = {}) {
  const repositoryMode = normalizeRepositoryMode(mode);
  if (repositoryMode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    return {
      directory: PROJECT_CANONICAL_REPOSITORY_DIR,
      durable: true,
      inactivePath: resolveProjectGithubMirrorPath({
        projectRuntimeRoot
      }),
      inactivePathField: "githubMirrorPath",
      label: "Canonical repository",
      path: resolveProjectCanonicalRepositoryPath({
        projectRuntimeRoot
      }),
      pathField: "canonicalRepositoryPath"
    };
  }
  if (repositoryMode === PROJECT_REPOSITORY_MODE_GITHUB) {
    return {
      directory: PROJECT_GITHUB_MIRROR_DIR,
      durable: false,
      inactivePath: resolveProjectCanonicalRepositoryPath({
        projectRuntimeRoot
      }),
      inactivePathField: "canonicalRepositoryPath",
      label: "GitHub mirror",
      path: resolveProjectGithubMirrorPath({
        projectRuntimeRoot
      }),
      pathField: "githubMirrorPath"
    };
  }
  return null;
}

function projectRequiresGithubConnection(project = {}) {
  const repositoryMode = normalizeRepositoryMode(project.repositoryMode || project.repository?.mode);
  if (repositoryMode) {
    return repositoryMode === PROJECT_REPOSITORY_MODE_GITHUB;
  }
  return Boolean(project.githubRepository || project.repository?.github);
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
    fullName: normalizedFullName,
    isPrivate: input.isPrivate === true,
    name: name || normalizedFullName.split("/").pop() || "",
    owner: owner || normalizedFullName.split("/")[0] || "",
    url: normalizeText(input.url),
    viewerPermission: normalizeText(input.viewerPermission).toUpperCase(),
    visibility: normalizeText(input.visibility).toLowerCase()
  };
}

function normalizeProjectRepository(value = {}, {
  fallbackDefaultBranch = "",
  fallbackMode = ""
} = {}) {
  const input = isPlainObject(value) ? value : {};
  const repositoryGithub = normalizeProjectGithubRepository(input.github);
  const github = repositoryGithub;
  const mode = normalizeRepositoryMode(input.mode) ||
    (github ? PROJECT_REPOSITORY_MODE_GITHUB : normalizeRepositoryMode(fallbackMode));
  if (!mode) {
    return null;
  }

  const defaultBranch = normalizeText(
    input.defaultBranch ||
    fallbackDefaultBranch ||
    (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE ? PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH : "")
  );
  if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    if (!github) {
      return null;
    }
    return {
      mode,
      defaultBranch,
      github
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
    fallbackMode
  });
  const repositoryMode = repository?.mode || "";
  const githubRepository = repositoryMode === PROJECT_REPOSITORY_MODE_GITHUB
    ? {
        ...normalizeProjectGithubRepository(repository.github),
        defaultBranch: repository.defaultBranch
      }
    : null;
  return {
    ...(repository ? { repository } : {}),
    ...(repositoryMode ? { repositoryMode } : {}),
    ...(githubRepository ? { githubRepository } : {})
  };
}

function projectRepositoryMetadataFromInput(input = {}, {
  defaultBranch = "",
  defaultMode = ""
} = {}) {
  const source = isPlainObject(input) ? input : {};
  if (
    Object.hasOwn(source.repository?.github || {}, "defaultBranch") ||
    Object.hasOwn(source.repository?.github || {}, "source")
  ) {
    throw projectRepositoryMetadataError(
      "vibe64_project_metadata_field_unsupported",
      "GitHub project metadata must not duplicate the repository branch or store creation provenance."
    );
  }
  const repository = normalizeProjectRepository(source.repository, {
    fallbackDefaultBranch: defaultBranch,
    fallbackMode: defaultMode
  });
  if (!repository) {
    throw projectRepositoryMetadataError(
      "vibe64_project_repository_missing",
      "Vibe64 projects must have repository metadata."
    );
  }
  if (!repository.defaultBranch) {
    throw projectRepositoryMetadataError(
      "vibe64_project_repository_default_branch_missing",
      "Vibe64 project repositories must have an explicit default branch."
    );
  }
  return {
    repository
  };
}

function projectRepositoryMetadataError(code = "", message = "") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sessionRepositoryProject(project = {}, session = {}) {
  const serialized = session?.metadata?.github_pull_request;
  if (!serialized) {
    return project;
  }
  let source;
  try {
    source = JSON.parse(serialized);
  } catch {
    // Invalid authority must never fall back to the project branch.
  }
  const fullName = normalizeText(project.githubRepository?.fullName || project.repository?.github?.fullName);
  if (
    !source || source.baseRepository !== fullName ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(source.headRepository || "") ||
    !source.headBranch || typeof source.headBranch !== "string" ||
    /[\s~^:?*[\\]/u.test(source.headBranch) ||
    [...source.headBranch].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    source.headBranch.startsWith("-") || source.headBranch.includes("..") || source.headBranch.includes("@{") ||
    project.repositoryMode === PROJECT_REPOSITORY_MODE_MANAGED_GIT
  ) {
    throw projectRepositoryMetadataError("vibe64_pull_request_authority_invalid", "This session's pull request source is invalid. Its Save destination could not be verified.");
  }
  const github = { fullName: source.headRepository, cloneUrl: `https://github.com/${source.headRepository}.git` };
  return {
    ...project,
    // A fork must never reuse or refresh the base repository's mirror.
    githubMirrorPath: source.headRepository === fullName ? project.githubMirrorPath : "",
    githubRepository: github,
    repositoryMode: PROJECT_REPOSITORY_MODE_GITHUB,
    repository: { mode: PROJECT_REPOSITORY_MODE_GITHUB, defaultBranch: source.headBranch, github }
  };
}

export {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_LOCAL_SOURCE_BRANCH,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODES,
  normalizeProjectGithubRepository,
  normalizeProjectRepository,
  normalizeRepositoryMode,
  projectRepositoryStorageRole,
  projectRequiresGithubConnection,
  projectRepositoryMetadataFromInput,
  sessionRepositoryProject,
  projectRepositoryView
};
