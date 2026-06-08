import {
  createGithubWorkspaceService
} from "./githubWorkspaceService.js";

const WORKSPACE_API_BASE = "/api/vibe64/workspaces";
const GITHUB_API_BASE = "/api/vibe64/github";

function registerVibe64WorkspaceRoutes(app, projectContext, options = {}) {
  const githubWorkspaceService = createGithubWorkspaceService({
    dataRoot: options.dataRoot,
    env: options.env,
    projectContext,
    providerHomesRoot: options.providerHomesRoot,
    runToolchain: options.runGithubToolchain
  });

  app.get(WORKSPACE_API_BASE, async () => {
    return projectContext.listManagedWorkspaces();
  });

  app.post(WORKSPACE_API_BASE, async (request, reply) => {
    const ownerBlock = ownerRequired(request, reply);
    if (ownerBlock) {
      return ownerBlock;
    }
    return workspaceRouteResult(
      () => projectContext.createManagedWorkspace(request.body || {}),
      reply
    );
  });

  app.get(`${GITHUB_API_BASE}/repository-owners`, async (request, reply) => {
    return workspaceRouteResult(
      () => githubWorkspaceService.repositoryOwners({
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });

  app.get(`${GITHUB_API_BASE}/repositories/search`, async (request, reply) => {
    return workspaceRouteResult(
      () => githubWorkspaceService.searchRepositories({
        owner: request.query?.owner || "",
        query: request.query?.q || "",
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });

  app.get(`${GITHUB_API_BASE}/repositories/resolve`, async (request, reply) => {
    return workspaceRouteResult(
      () => githubWorkspaceService.repositoryDetails({
        repository: request.query?.repository || "",
        vibe64User: request.vibe64User || null
      }).then((repository) => ({
        ok: true,
        repository
      })),
      reply
    );
  });

  app.post(`${WORKSPACE_API_BASE}/from-repository`, async (request, reply) => {
    const ownerBlock = ownerRequired(request, reply);
    if (ownerBlock) {
      return ownerBlock;
    }
    return workspaceRouteResult(
      () => githubWorkspaceService.openRepositoryWorkspace({
        ...(request.body || {}),
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });

  app.post(`${WORKSPACE_API_BASE}/create-repository`, async (request, reply) => {
    const ownerBlock = ownerRequired(request, reply);
    if (ownerBlock) {
      return ownerBlock;
    }
    return workspaceRouteResult(
      () => githubWorkspaceService.createRepositoryWorkspace({
        ...(request.body || {}),
        vibe64User: request.vibe64User || null
      }),
      reply
    );
  });
}

async function workspaceRouteResult(operation, reply) {
  try {
    return await operation();
  } catch (error) {
    return reply.code(workspaceErrorStatusCode(error)).send({
      ok: false,
      errors: [
        {
          code: error?.code || "vibe64_workspace_request_failed",
          message: String(error?.message || error || "Vibe64 workspace request failed.")
        }
      ]
    });
  }
}

function workspaceErrorStatusCode(error = {}) {
  if (typeof error?.statusCode === "number") {
    return error.statusCode;
  }
  if (error?.code === "vibe64_invalid_workspace_slug") {
    return 422;
  }
  if (
    error?.code === "vibe64_project_path_not_accessible" ||
    error?.code === "vibe64_project_path_not_directory" ||
    error?.code === "vibe64_project_path_symlink"
  ) {
    return 409;
  }
  return 400;
}

function ownerRequired(request, reply) {
  if (request.vibe64User?.role === "owner") {
    return null;
  }
  return reply.code(403).send({
    ok: false,
    errors: [
      {
        code: "vibe64_owner_required",
        message: "Only owners can add Vibe64 projects."
      }
    ]
  });
}

export {
  GITHUB_API_BASE,
  WORKSPACE_API_BASE,
  registerVibe64WorkspaceRoutes
};
