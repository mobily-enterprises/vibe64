import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
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

async function readProjectRepositoryWorkflow(projectRuntimeRoot) {
  if (!path.isAbsolute(projectRuntimeRoot || "")) throw new Error("Repository workflow requires a project runtime root.");
  try {
    const settings = JSON.parse(await readFile(path.join(projectRuntimeRoot, "settings", "repository-workflow.json"), "utf8"));
    if (Object.keys(settings).length !== 1 || typeof settings.requirePullRequest !== "boolean") {
      throw new Error("Repository workflow settings are invalid.");
    }
    return settings;
  } catch (error) {
    if (error.code === "ENOENT") return { requirePullRequest: false };
    throw error;
  }
}

async function saveProjectRepositoryWorkflow(projectRuntimeRoot, requirePullRequest) {
  if (!path.isAbsolute(projectRuntimeRoot || "") || typeof requirePullRequest !== "boolean") {
    throw new Error("Choose whether to require pull requests.");
  }
  const directory = path.join(projectRuntimeRoot, "settings");
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.repository-workflow.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ requirePullRequest }) + "\n", { flag: "wx", mode: 0o660 });
    await rename(temporary, path.join(directory, "repository-workflow.json"));
  } finally {
    await rm(temporary, { force: true });
  }
  return { requirePullRequest };
}

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
    const branch = session?.metadata?.repository_branch;
    if (branch && normalizeRepositoryMode(project.repositoryMode || project.repository?.mode) !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
      if (!validRepositoryBranch(branch)) {
        throw projectRepositoryMetadataError("vibe64_session_branch_invalid", "This session's repository branch is invalid.");
      }
      return { ...project, repository: { ...project.repository, defaultBranch: branch } };
    }
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
    !validRepositoryBranch(source.headBranch) ||
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

function validRepositoryBranch(branch) {
  return typeof branch === "string" && branch.length > 0 && branch.length <= 255 &&
    !["@", "HEAD"].includes(branch) && !branch.startsWith("-") && !branch.endsWith(".") &&
    !/[\s~^:?*[\\]/u.test(branch) && !branch.includes("..") && !branch.includes("@{") &&
    ![...branch].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    branch.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"));
}

function sessionRepositoryDestination(project = {}, session = {}) {
  const resolved = sessionRepositoryProject(project, session);
  const mode = normalizeRepositoryMode(resolved.repositoryMode || resolved.repository?.mode);
  let repository = resolved.slug || resolved.projectSlug;
  let branch = resolved.repository?.defaultBranch;
  if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    repository = resolved.githubRepository?.fullName || resolved.repository?.github?.fullName;
  } else if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    repository = resolved.sourceRoot;
    branch = session?.metadata?.local_source_branch || branch;
  }
  return {
    sessionId: normalizeText(session.sessionId || session.id),
    mode,
    repository: normalizeText(repository),
    branch: normalizeText(branch)
  };
}

function assertSessionRepositoryReview(project, session, review) {
  const destination = sessionRepositoryDestination(project, session);
  if (!review || Object.entries(destination).some(([key, value]) => !value || review[key] !== value)) {
    throw projectRepositoryMetadataError(
      "vibe64_session_repository_review_changed",
      "Review this session's repository and branch again before publishing. Its destination is missing or has changed."
    );
  }
  return destination;
}

export {
  readProjectRepositoryWorkflow,
  saveProjectRepositoryWorkflow,
  validRepositoryBranch,
  assertSessionRepositoryReview,
  sessionRepositoryDestination,
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
