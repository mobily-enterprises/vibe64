import {
  createGithubProjectAccessService
} from "./githubProjectAccessService.js";
import {
  createGithubProjectService
} from "./githubProjectService.js";

const PROJECT_API_BASE = "/api/vibe64/projects";
const GITHUB_API_BASE = "/api/vibe64/github";

function registerVibe64ProjectRoutes(app, projectContext, options = {}) {
  const githubProjectService = createGithubProjectService({
    dataRoot: options.dataRoot,
    env: options.env,
    projectContext,
    providerHomesRoot: options.providerHomesRoot,
    runToolchain: options.runGithubToolchain
  });
  const githubProjectAccessService = createGithubProjectAccessService({
    auth: options.auth || null,
    dataRoot: options.dataRoot,
    env: options.env,
    projectContext,
    providerHomesRoot: options.providerHomesRoot,
    runToolchain: options.runGithubToolchain
  });

  app.get(PROJECT_API_BASE, async () => {
    if (options.auth?.runtimeProfile?.local === true) {
      return projectContext.listProjects();
    }
    return projectContext.listManagedProjects();
  });

  app.post(PROJECT_API_BASE, async (request, reply) => {
    if (options.auth?.runtimeProfile?.local === true) {
      return localManagedProjectsUnavailable(reply);
    }
    const ownerBlock = ownerRequired(request, reply);
    if (ownerBlock) {
      return ownerBlock;
    }
    return projectRouteResult(
      () => projectContext.createManagedProjectRecord(request.body || {}),
      reply
    );
  });

  app.get(`${PROJECT_API_BASE}/:slug/access`, async (request, reply) => {
    if (options.auth?.runtimeProfile?.local === true) {
      return localManagedProjectsUnavailable(reply);
    }
    const ownerBlock = ownerRequired(request, reply, "Only owners can manage GitHub project access.");
    if (ownerBlock) {
      return ownerBlock;
    }
    return projectRouteResult(
      () => githubProjectAccessService.projectAccessStatus({
        slug: request.params?.slug || "",
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });

  app.post(`${PROJECT_API_BASE}/:slug/access/invite`, async (request, reply) => {
    if (options.auth?.runtimeProfile?.local === true) {
      return localManagedProjectsUnavailable(reply);
    }
    const ownerBlock = ownerRequired(request, reply, "Only owners can manage GitHub project access.");
    if (ownerBlock) {
      return ownerBlock;
    }
    return projectRouteResult(
      () => githubProjectAccessService.inviteTenantUser({
        ...(request.body || {}),
        slug: request.params?.slug || "",
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });

  app.get(`${GITHUB_API_BASE}/repository-owners`, async (request, reply) => {
    return projectRouteResult(
      () => githubProjectService.repositoryOwners({
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });

  app.post(`${GITHUB_API_BASE}/identity/sync`, async (request, reply) => {
    return projectRouteResult(
      async () => {
        const user = await githubProjectAccessService.syncCurrentGithubIdentity(request.vibe64User || null);
        return {
          ok: true,
          user: user && options.auth?.users
            ? options.auth.users.publicUser(user)
            : null
        };
      },
      reply
    );
  });

  app.get(`${GITHUB_API_BASE}/repositories/search`, async (request, reply) => {
    return projectRouteResult(
      () => githubProjectService.searchRepositories({
        owner: request.query?.owner || "",
        query: request.query?.q || "",
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });

  app.get(`${GITHUB_API_BASE}/repositories/resolve`, async (request, reply) => {
    return projectRouteResult(
      () => githubProjectService.repositoryDetails({
        repository: request.query?.repository || "",
        vibe64User: request.vibe64User || null
      }).then((repository) => ({
        ok: true,
        repository
      })),
      reply
    );
  });

  app.post(`${PROJECT_API_BASE}/from-repository`, async (request, reply) => {
    if (options.auth?.runtimeProfile?.local === true) {
      return localManagedProjectsUnavailable(reply);
    }
    const ownerBlock = ownerRequired(request, reply);
    if (ownerBlock) {
      return ownerBlock;
    }
    return projectRouteResult(
      () => githubProjectService.openRepositoryProject({
        ...(request.body || {}),
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });

  app.post(`${PROJECT_API_BASE}/create-repository`, async (request, reply) => {
    if (options.auth?.runtimeProfile?.local === true) {
      return localManagedProjectsUnavailable(reply);
    }
    const ownerBlock = ownerRequired(request, reply);
    if (ownerBlock) {
      return ownerBlock;
    }
    return projectRouteResult(
      () => githubProjectService.createRepositoryProject({
        ...(request.body || {}),
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });
}

function localManagedProjectsUnavailable(reply) {
  return reply.code(404).send({
    ok: false,
    errors: [
      {
        code: "vibe64_managed_projects_unavailable",
        message: "Managed project operations are not available in local editor mode."
      }
    ]
  });
}

async function projectRouteResult(operation, reply) {
  try {
    return await operation();
  } catch (error) {
    return reply.code(projectErrorStatusCode(error)).send({
      ok: false,
      errors: [
        {
          code: error?.code || "vibe64_project_request_failed",
          message: String(error?.message || error || "Vibe64 project request failed.")
        }
      ]
    });
  }
}

function projectErrorStatusCode(error = {}) {
  if (typeof error?.statusCode === "number") {
    return error.statusCode;
  }
  if (error?.code === "vibe64_invalid_project_slug") {
    return 422;
  }
  if (
    error?.code === "vibe64_project_path_not_accessible" ||
    error?.code === "vibe64_project_path_not_directory" ||
    error?.code === "vibe64_project_path_symlink" ||
    error?.code === "vibe64_github_identity_required"
  ) {
    return 409;
  }
  if (error?.code === "vibe64_project_not_github_backed") {
    return 404;
  }
  if (error?.code === "vibe64_user_not_found") {
    return 404;
  }
  if (
    error?.code === "vibe64_github_access_manage_forbidden" ||
    error?.code === "vibe64_owner_required"
  ) {
    return 403;
  }
  return 400;
}

function ownerRequired(request, reply, message = "Only owners can add Vibe64 projects.") {
  if (request.vibe64User?.role === "owner") {
    return null;
  }
  return reply.code(403).send({
    ok: false,
    errors: [
      {
        code: "vibe64_owner_required",
        message
      }
    ]
  });
}

export {
  GITHUB_API_BASE,
  PROJECT_API_BASE,
  registerVibe64ProjectRoutes
};
