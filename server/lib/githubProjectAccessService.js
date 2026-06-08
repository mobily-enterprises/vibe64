import { mkdir } from "node:fs/promises";
import process from "node:process";

import {
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";
import {
  githubProviderContext,
  resolveProviderHomesRoot
} from "@local/studio-terminal-core/server/providerHomes";

const GITHUB_READ_TIMEOUT_MS = 20_000;
const GITHUB_WRITE_TIMEOUT_MS = 120_000;
const GITHUB_REPO_MANAGE_PERMISSIONS = new Set(["ADMIN", "MAINTAIN"]);
const GITHUB_REPO_PUSH_PERMISSIONS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);
const GITHUB_REPO_READ_PERMISSIONS = new Set(["ADMIN", "MAINTAIN", "WRITE", "TRIAGE", "READ"]);

function createGithubProjectAccessService({
  auth = null,
  dataRoot = "",
  env = process.env,
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
      throw accessServiceError(
        context.code || "vibe64_user_required",
        context.error || "A logged-in Vibe64 user is required for GitHub project access.",
        401
      );
    }
    await mkdir(context.toolHomeSource, {
      mode: 0o700,
      recursive: true
    });
    return context;
  }

  async function runGh(commandArgs = [], {
    timeout = GITHUB_READ_TIMEOUT_MS,
    vibe64User = null
  } = {}) {
    const context = await githubContext(vibe64User);
    return runToolchain(["gh", ...commandArgs], {
      timeout,
      toolHomeSource: context.toolHomeSource
    });
  }

  async function runGhJson(commandArgs = [], options = {}) {
    const result = await runGh(commandArgs, options);
    if (!result.ok) {
      throw accessServiceError(
        "vibe64_github_command_failed",
        githubCommandFailureMessage(result),
        502
      );
    }
    try {
      return JSON.parse(result.stdout || result.output || "null");
    } catch {
      throw accessServiceError(
        "vibe64_github_json_parse_failed",
        "GitHub returned a response Vibe64 could not read.",
        502
      );
    }
  }

  async function syncCurrentGithubIdentity(vibe64User = null) {
    if (!auth?.users || !vibe64User?.email) {
      return null;
    }
    const payload = await runGhJson(["api", "user"], {
      vibe64User
    });
    return auth.users.updateGithubIdentity({
      email: vibe64User.email
    }, {
      avatarUrl: payload.avatar_url,
      connectedAt: new Date().toISOString(),
      id: payload.id,
      login: payload.login
    });
  }

  async function projectAccessStatus({
    slug = "",
    vibe64User = null
  } = {}) {
    await syncCurrentGithubIdentity(vibe64User).catch(() => null);
    const projectResult = await projectContext.readManagedProject({
      slug
    });
    const repository = projectResult.project.githubRepository;
    const repositoryStatus = await currentViewerRepositoryStatus(repository.fullName, {
      vibe64User
    });
    const users = auth?.users ? await auth.users.listUsers() : [];
    const rows = [];
    for (const user of users) {
      rows.push(await tenantUserAccessRow(user, repository.fullName, {
        vibe64User
      }));
    }
    return {
      currentUserCanManageAccess: repositoryStatus.canManageAccess,
      ok: true,
      repository: {
        ...repository,
        currentViewerPermission: repositoryStatus.permission
      },
      project: projectResult.project,
      updatedAt: new Date().toISOString(),
      userLimit: auth?.users?.userLimit || null,
      users: rows
    };
  }

  async function currentViewerRepositoryStatus(repositoryFullName = "", {
    vibe64User = null
  } = {}) {
    const payload = await runGhJson([
      "repo",
      "view",
      repositoryFullName,
      "--json",
      "viewerPermission"
    ], {
      vibe64User
    });
    return permissionCapabilities(payload?.viewerPermission || "");
  }

  async function tenantUserAccessRow(user = {}, repositoryFullName = "", {
    vibe64User = null
  } = {}) {
    const github = user.github || null;
    const baseRow = {
      email: user.email,
      github,
      role: user.role,
      status: user.status
    };
    if (user.status !== "active") {
      return {
        ...baseRow,
        access: accessState("inactive")
      };
    }
    if (!github?.login) {
      return {
        ...baseRow,
        access: accessState("github-not-connected")
      };
    }
    return {
      ...baseRow,
      access: await githubUserRepositoryAccess(repositoryFullName, github.login, {
        vibe64User
      })
    };
  }

  async function githubUserRepositoryAccess(repositoryFullName = "", githubLogin = "", {
    vibe64User = null
  } = {}) {
    const result = await runGh([
      "api",
      `repos/${repositoryFullName}/collaborators/${githubLogin}/permission`
    ], {
      vibe64User
    });
    if (!result.ok) {
      return accessState("no-access", {
        observed: githubCommandFailureMessage(result)
      });
    }
    try {
      const payload = JSON.parse(result.stdout || result.output || "{}");
      return accessState("available", {
        permission: payload.permission || payload.role_name || ""
      });
    } catch {
      return accessState("unknown", {
        observed: "GitHub returned a response Vibe64 could not read."
      });
    }
  }

  async function inviteTenantUser({
    email = "",
    permission = "push",
    slug = "",
    vibe64User = null
  } = {}) {
    const projectResult = await projectContext.readManagedProject({
      slug
    });
    const repository = projectResult.project.githubRepository;
    const viewer = await currentViewerRepositoryStatus(repository.fullName, {
      vibe64User
    });
    if (!viewer.canManageAccess) {
      throw accessServiceError(
        "vibe64_github_access_manage_forbidden",
        "Your GitHub account cannot manage access for this repository.",
        403
      );
    }
    const user = await auth.users.readUser(email);
    if (!user || user.status !== "active") {
      throw accessServiceError(
        "vibe64_user_not_found",
        "Choose an active tenant user.",
        404
      );
    }
    if (!user.github?.login) {
      throw accessServiceError(
        "vibe64_github_identity_required",
        "This tenant user must connect GitHub before repository access can be granted.",
        409
      );
    }
    const normalizedPermission = normalizeCollaboratorPermission(permission);
    const result = await runGh([
      "api",
      "-X",
      "PUT",
      `repos/${repository.fullName}/collaborators/${user.github.login}`,
      "-f",
      `permission=${normalizedPermission}`
    ], {
      timeout: GITHUB_WRITE_TIMEOUT_MS,
      vibe64User
    });
    if (!result.ok) {
      throw accessServiceError(
        "vibe64_github_invite_failed",
        githubCommandFailureMessage(result),
        502
      );
    }
    return {
      ok: true,
      repository,
      user: await tenantUserAccessRow(user, repository.fullName, {
        vibe64User
      })
    };
  }

  return Object.freeze({
    inviteTenantUser,
    projectAccessStatus,
    syncCurrentGithubIdentity
  });
}

async function runDefaultGithubToolchain(commandArgs = [], {
  timeout = GITHUB_READ_TIMEOUT_MS,
  toolHomeSource = ""
} = {}) {
  return runHostCommand("docker", buildDoctorToolchainArgs(commandArgs, {
    toolHomeSource
  }), {
    timeout
  });
}

function accessState(status = "", {
  observed = "",
  permission = ""
} = {}) {
  const capabilities = permissionCapabilities(permission);
  return {
    canManageAccess: capabilities.canManageAccess,
    canPush: capabilities.canPush,
    canRead: capabilities.canRead,
    observed: String(observed || ""),
    permission: capabilities.permission,
    status
  };
}

function permissionCapabilities(value = "") {
  const permission = String(value || "").trim().toUpperCase();
  return {
    canManageAccess: GITHUB_REPO_MANAGE_PERMISSIONS.has(permission),
    canPush: GITHUB_REPO_PUSH_PERMISSIONS.has(permission),
    canRead: GITHUB_REPO_READ_PERMISSIONS.has(permission),
    permission
  };
}

function normalizeCollaboratorPermission(value = "") {
  const permission = String(value || "push").trim().toLowerCase();
  if (["pull", "push", "maintain", "triage"].includes(permission)) {
    return permission;
  }
  return "push";
}

function githubCommandFailureMessage(result = {}) {
  const output = String(result.output || result.stderr || result.stdout || "").trim();
  return output || "GitHub command failed.";
}

function accessServiceError(code = "", message = "", statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export {
  createGithubProjectAccessService
};
