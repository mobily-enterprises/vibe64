import { mkdir, readdir } from "node:fs/promises";
import process from "node:process";

import {
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  githubProviderContext,
  resolveProviderHomesRoot
} from "@local/studio-terminal-core/server/providerHomes";
import {
  normalizeProjectSlug,
  resolveProjectRoot,
  projectSlugFromName
} from "@local/vibe64-core/server/studioProjectContext";

const GITHUB_READ_TIMEOUT_MS = 20_000;
const GITHUB_WRITE_TIMEOUT_MS = 120_000;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GITHUB_REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/u;
const GITHUB_PUSH_PERMISSIONS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);
const REPOSITORY_OWNER_LIST_LIMIT = 1000;
const REPOSITORY_SEARCH_LIMIT = 12;

function createGithubProjectService({
  env = process.env,
  dataRoot = "",
  projectContext,
  providerHomesRoot = "",
  runToolchain = runDefaultGithubToolchain
} = {}) {
  const resolvedProviderHomesRoot = resolveProviderHomesRoot({
    dataRoot,
    env,
    explicitRoot: providerHomesRoot
  });

  async function githubContext(vibe64User = null) {
    const context = githubProviderContext({
      vibe64User
    }, {
      providerHomesRoot: resolvedProviderHomesRoot
    });
    if (!context.ok) {
      throw githubServiceError(
        context.code || "vibe64_user_required",
        context.error || "A logged-in Vibe64 user is required for GitHub operations.",
        401
      );
    }
    await mkdir(context.toolHomeSource, {
      mode: 0o700,
      recursive: true
    });
    return context;
  }

  async function runTool(commandArgs = [], {
    targetRoot = "",
    timeout = GITHUB_READ_TIMEOUT_MS,
    vibe64User = null
  } = {}) {
    const context = await githubContext(vibe64User);
    const result = await runToolchain(commandArgs, {
      targetRoot,
      timeout,
      toolHomeSource: context.toolHomeSource
    });
    if (!result.ok) {
      throw githubServiceError(
        "vibe64_github_command_failed",
        githubCommandFailureMessage(result),
        502
      );
    }
    return result;
  }

  async function runGh(commandArgs = [], options = {}) {
    return runTool(["gh", ...commandArgs], options);
  }

  async function runGhJson(commandArgs = [], options = {}) {
    const result = await runGh(commandArgs, options);
    try {
      return JSON.parse(result.stdout || result.output || "null");
    } catch {
      throw githubServiceError(
        "vibe64_github_json_parse_failed",
        "GitHub returned a response Vibe64 could not read.",
        502
      );
    }
  }

  async function repositoryOwners(input = {}) {
    try {
      return {
        ok: true,
        owners: await repositoryOwnersFromGraphql(input)
      };
    } catch (error) {
      if (error?.code !== "vibe64_github_command_failed") {
        throw error;
      }
      return {
        ok: true,
        owners: await repositoryOwnersFromRest(input)
      };
    }
  }

  async function repositoryOwnersFromGraphql({
    vibe64User = null
  } = {}) {
    const query = [
      "query {",
      "  viewer {",
      "    login",
      "    avatarUrl",
      "    organizations(first: 100) {",
      "      nodes {",
      "        login",
      "        name",
      "        avatarUrl",
      "        viewerCanCreateRepositories",
      "      }",
      "    }",
      "  }",
      "}"
    ].join("\n");
    const payload = await runGhJson(["api", "graphql", "-f", `query=${query}`], {
      vibe64User
    });
    const viewer = payload?.data?.viewer || {};
    const organizations = Array.isArray(viewer.organizations?.nodes)
      ? viewer.organizations.nodes
      : [];
    return [
      ownerRecord({
        avatarUrl: viewer.avatarUrl,
        canCreateRepository: true,
        login: viewer.login,
        type: "user"
      }),
      ...organizations.map((organization) => ownerRecord({
        avatarUrl: organization.avatarUrl,
        canCreateRepository: organization?.viewerCanCreateRepositories === true,
        label: organization.name,
        login: organization.login,
        type: "organization"
      }))
    ].filter((owner) => owner.login);
  }

  async function repositoryOwnersFromRest({
    vibe64User = null
  } = {}) {
    const [viewer, organizations] = await Promise.all([
      runGhJson(["api", "user"], {
        vibe64User
      }),
      runGhJson(["api", "user/orgs"], {
        vibe64User
      })
    ]);
    return [
      ownerRecord({
        avatarUrl: viewer.avatar_url,
        canCreateRepository: true,
        login: viewer.login,
        type: "user"
      }),
      ...(Array.isArray(organizations) ? organizations : []).map((organization) => ownerRecord({
        avatarUrl: organization.avatar_url,
        canCreateRepository: null,
        label: organization.description || "",
        login: organization.login,
        type: "organization"
      }))
    ].filter((owner) => owner.login);
  }

  async function searchRepositories(input = {}) {
    const owner = normalizeOptionalGithubOwner(input?.owner);
    const query = String(input?.query || input?.q || "").trim();

    if (!query && !owner) {
      return {
        ok: true,
        repositories: []
      };
    }

    const parsedRepository = query.includes("/") ? parseRepositoryIdentifier(query) : "";
    if (parsedRepository) {
      try {
        return {
          ok: true,
          repositories: [await repositoryDetails({
            repository: parsedRepository,
            vibe64User: input.vibe64User || null
          })]
        };
      } catch (error) {
        if (error?.code !== "vibe64_github_command_failed") {
          throw error;
        }
      }
    }

    if (owner) {
      try {
        const repositories = await ownerRepositoryMatches({
          owner,
          query,
          vibe64User: input.vibe64User || null
        });
        if (repositories.length > 0 || !query) {
          return {
            ok: true,
            repositories
          };
        }
      } catch (error) {
        if (error?.code !== "vibe64_github_command_failed") {
          throw error;
        }
      }
    }

    if (!query) {
      return {
        ok: true,
        repositories: []
      };
    }

    const directRepository = parseRepositoryIdentifier(owner ? `${owner}/${query}` : query);
    if (directRepository) {
      try {
        return {
          ok: true,
          repositories: [await repositoryDetails({
            repository: directRepository,
            vibe64User: input.vibe64User || null
          })]
        };
      } catch (error) {
        if (error?.code !== "vibe64_github_command_failed") {
          throw error;
        }
      }
    }

    const searchArgs = [
      "search",
      "repos",
      query,
      ...(owner ? ["--owner", owner] : []),
      "--limit",
      String(REPOSITORY_SEARCH_LIMIT),
      "--archived=false",
      "--json",
      "fullName,name,owner,description,visibility,isPrivate,url,defaultBranch,pushedAt"
    ];
    const payload = await runGhJson(searchArgs, {
      vibe64User: input.vibe64User || null
    });
    return {
      ok: true,
      repositories: (Array.isArray(payload) ? payload : []).map(repositorySearchRecord)
    };
  }

  async function ownerRepositoryMatches({
    owner = "",
    query = "",
    vibe64User = null
  } = {}) {
    const payload = await runGhJson([
      "repo",
      "list",
      owner,
      "--limit",
      String(REPOSITORY_OWNER_LIST_LIMIT),
      "--json",
      "name,nameWithOwner,description,isPrivate,isArchived,url,sshUrl,defaultBranchRef,pushedAt,viewerPermission,owner"
    ], {
      vibe64User
    });
    const repositories = (Array.isArray(payload) ? payload : []).map(repositorySearchRecord);
    if (!String(query || "").trim()) {
      return repositories;
    }
    return repositories
      .filter((repository) => repositoryMatchesQuery(repository, owner, query))
      .sort((left, right) => repositoryMatchRank(left, owner, query) - repositoryMatchRank(right, owner, query))
      .slice(0, REPOSITORY_SEARCH_LIMIT);
  }

  async function repositoryDetails(input = {}) {
    const repository = parseRepositoryIdentifier(input?.repository || input?.fullName || "");
    if (!repository) {
      throw githubServiceError(
        "vibe64_invalid_github_repository",
        "Repository must be a GitHub URL or owner/name.",
        422
      );
    }
    const payload = await runGhJson([
      "repo",
      "view",
      repository,
      "--json",
      "name,nameWithOwner,description,visibility,isPrivate,owner,defaultBranchRef,url,sshUrl,viewerPermission,isArchived"
    ], {
      vibe64User: input.vibe64User || null
    });
    return repositoryViewRecord(payload);
  }

  async function openRepositoryProject(input = {}) {
    const repository = await repositoryDetails(input);
    const slug = normalizeProjectSlug(input?.slug || projectSlugFromName(repository.name));
    const targetRoot = await prepareEmptyProjectDirectory(slug);
    await runGh(["repo", "clone", repository.fullName, "."], {
      targetRoot,
      timeout: GITHUB_WRITE_TIMEOUT_MS,
      vibe64User: input.vibe64User || null
    });
    const updated = await projectContext.updateManagedProjectMetadata({
      githubRepository: {
        ...repository,
        source: "github-existing"
      },
      slug
    });
    return {
      ok: true,
      project: updated.project,
      projectsRoot: updated.projectsRoot,
      repository
    };
  }

  async function createRepositoryProject(input = {}) {
    const owner = normalizeGithubOwner(input?.owner);
    const name = normalizeGithubRepositoryName(input?.name);
    const visibility = normalizeRepositoryVisibility(input?.visibility);
    const slug = normalizeProjectSlug(input?.slug || projectSlugFromName(name));
    const targetRoot = await prepareEmptyProjectDirectory(slug);
    await runTool(["git", "init", "-b", "main"], {
      targetRoot,
      timeout: GITHUB_READ_TIMEOUT_MS,
      vibe64User: input.vibe64User || null
    });
    await runGh(["repo", "create", `${owner}/${name}`, `--${visibility}`, "--source=.", "--remote=origin", ...descriptionArgs(input?.description)], {
      targetRoot,
      timeout: GITHUB_WRITE_TIMEOUT_MS,
      vibe64User: input.vibe64User || null
    });
    const repository = await repositoryDetails({
      repository: `${owner}/${name}`,
      vibe64User: input.vibe64User || null
    });
    const updated = await projectContext.updateManagedProjectMetadata({
      githubRepository: {
        ...repository,
        source: "github-created"
      },
      slug
    });
    return {
      ok: true,
      project: updated.project,
      projectsRoot: updated.projectsRoot,
      repository
    };
  }

  async function prepareEmptyProjectDirectory(slug = "") {
    const targetRoot = resolveProjectRoot({
      projectsRoot: projectContext.projectsRoot,
      slug
    });
    let entries = [];
    try {
      entries = await readdir(targetRoot);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    if (entries.length > 0) {
      throw githubServiceError(
        "vibe64_project_slug_exists",
        "Project name already has a local folder. Choose a different project name.",
        409
      );
    }
    await mkdir(targetRoot, {
      recursive: true
    });
    return targetRoot;
  }

  return Object.freeze({
    createRepositoryProject,
    openRepositoryProject,
    repositoryDetails,
    repositoryOwners,
    searchRepositories
  });
}

async function runDefaultGithubToolchain(commandArgs = [], {
  ensureRuntimeNetwork = ensureTargetRuntimeNetwork,
  runCommand = runHostCommand,
  targetRoot = "",
  timeout = GITHUB_READ_TIMEOUT_MS,
  toolHomeSource = ""
} = {}) {
  if (targetRoot) {
    await ensureRuntimeNetwork(targetRoot);
  }
  return runCommand("docker", buildDoctorToolchainArgs(commandArgs, {
    targetRoot,
    toolHomeSource
  }), {
    timeout
  });
}

function ownerRecord({
  avatarUrl = "",
  canCreateRepository = false,
  label = "",
  login = "",
  type = ""
} = {}) {
  return {
    avatarUrl: String(avatarUrl || ""),
    canCreateRepository,
    label: String(label || login || ""),
    login: String(login || ""),
    type: String(type || "")
  };
}

function repositorySearchRecord(value = {}) {
  const fullName = String(value.fullName || value.nameWithOwner || "").trim();
  const owner = String(value.owner?.login || value.owner || fullName.split("/")[0] || "").trim();
  const name = String(value.name || fullName.split("/")[1] || "").trim();
  const viewerPermission = String(value.viewerPermission || "").trim().toUpperCase();
  const visibility = String(value.visibility || (value.isPrivate ? "private" : "public")).trim().toLowerCase();
  return {
    canPush: viewerPermission ? GITHUB_PUSH_PERMISSIONS.has(viewerPermission) : null,
    defaultBranch: String(value.defaultBranch || value.defaultBranchRef?.name || "").trim(),
    description: String(value.description || "").trim(),
    fullName: fullName || `${owner}/${name}`,
    isArchived: value.isArchived === true,
    isPrivate: value.isPrivate === true,
    name,
    owner,
    pushedAt: String(value.pushedAt || ""),
    url: String(value.url || "").trim(),
    viewerPermission,
    visibility
  };
}

function repositoryMatchesQuery(repository = {}, owner = "", query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const normalizedOwner = String(owner || "").trim().toLowerCase();
  const ownerPrefix = normalizedOwner ? `${normalizedOwner}/` : "";
  const repositoryQuery = normalizedQuery.startsWith(ownerPrefix)
    ? normalizedQuery.slice(ownerPrefix.length)
    : normalizedQuery;
  return (
    repository.name.toLowerCase().includes(repositoryQuery) ||
    repository.fullName.toLowerCase().includes(normalizedQuery)
  );
}

function repositoryMatchRank(repository = {}, owner = "", query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return repository.pushedAt ? 20 : 30;
  }
  const normalizedOwner = String(owner || "").trim().toLowerCase();
  const ownerPrefix = normalizedOwner ? `${normalizedOwner}/` : "";
  const repositoryQuery = normalizedQuery.startsWith(ownerPrefix)
    ? normalizedQuery.slice(ownerPrefix.length)
    : normalizedQuery;
  const name = repository.name.toLowerCase();
  const fullName = repository.fullName.toLowerCase();
  if (name === repositoryQuery || fullName === normalizedQuery) {
    return 0;
  }
  if (name.startsWith(repositoryQuery)) {
    return 1;
  }
  if (fullName.startsWith(normalizedQuery)) {
    return 2;
  }
  return 10;
}

function repositoryViewRecord(value = {}) {
  const fullName = String(value.nameWithOwner || "").trim();
  const owner = String(value.owner?.login || fullName.split("/")[0] || "").trim();
  const name = String(value.name || fullName.split("/")[1] || "").trim();
  const viewerPermission = String(value.viewerPermission || "").trim().toUpperCase();
  return {
    canPush: GITHUB_PUSH_PERMISSIONS.has(viewerPermission),
    cloneUrl: value.url ? `${String(value.url).replace(/\/+$/u, "")}.git` : "",
    defaultBranch: String(value.defaultBranchRef?.name || "").trim(),
    description: String(value.description || "").trim(),
    fullName: fullName || `${owner}/${name}`,
    isArchived: value.isArchived === true,
    isPrivate: value.isPrivate === true,
    name,
    owner,
    sshUrl: String(value.sshUrl || "").trim(),
    url: String(value.url || "").trim(),
    viewerPermission,
    visibility: String(value.visibility || "").trim().toLowerCase()
  };
}

function parseRepositoryIdentifier(value = "") {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }
  const sshMatch = rawValue.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/iu);
  if (sshMatch) {
    return normalizeParsedRepository(`${sshMatch[1]}/${sshMatch[2]}`);
  }
  try {
    const url = new URL(rawValue);
    if (url.hostname.toLowerCase() === "github.com") {
      const [owner, repository] = url.pathname
        .replace(/^\/+|\/+$/gu, "")
        .split("/");
      return normalizeParsedRepository(`${owner || ""}/${repository || ""}`);
    }
  } catch {
    // Plain owner/name is handled below.
  }
  return normalizeParsedRepository(rawValue);
}

function normalizeParsedRepository(value = "") {
  const repository = String(value || "")
    .trim()
    .replace(/\.git$/iu, "");
  return GITHUB_REPOSITORY_PATTERN.test(repository) ? repository : "";
}

function normalizeGithubOwner(value = "") {
  const owner = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/u.test(owner)) {
    throw githubServiceError(
      "vibe64_invalid_github_owner",
      "Repository owner must be a GitHub user or organization login.",
      422
    );
  }
  return owner;
}

function normalizeOptionalGithubOwner(value = "") {
  const owner = String(value || "").trim();
  return owner ? normalizeGithubOwner(owner) : "";
}

function normalizeGithubRepositoryName(value = "") {
  const name = String(value || "").trim();
  if (!GITHUB_REPOSITORY_NAME_PATTERN.test(name)) {
    throw githubServiceError(
      "vibe64_invalid_github_repository_name",
      "Repository name can contain letters, numbers, dashes, underscores, and dots.",
      422
    );
  }
  return name;
}

function normalizeRepositoryVisibility(value = "") {
  const visibility = String(value || "private").trim().toLowerCase();
  if (!["private", "public", "internal"].includes(visibility)) {
    throw githubServiceError(
      "vibe64_invalid_github_visibility",
      "Repository visibility must be private, public, or internal.",
      422
    );
  }
  return visibility;
}

function descriptionArgs(value = "") {
  const description = String(value || "").trim();
  return description ? ["--description", description] : [];
}

function githubCommandFailureMessage(result = {}) {
  const output = String(result.output || result.stderr || result.stdout || "").trim();
  return output || "GitHub command failed.";
}

function githubServiceError(code = "", message = "", statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export {
  createGithubProjectService,
  parseRepositoryIdentifier,
  repositoryViewRecord,
  runDefaultGithubToolchain
};
