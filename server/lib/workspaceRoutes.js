const WORKSPACE_API_BASE = "/api/vibe64/workspaces";

function registerVibe64WorkspaceRoutes(app, projectContext) {
  app.get(WORKSPACE_API_BASE, async () => {
    return projectContext.listManagedWorkspaces();
  });

  app.post(WORKSPACE_API_BASE, async (request, reply) => {
    return workspaceRouteResult(
      () => projectContext.createManagedWorkspace(request.body || {}),
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

export {
  WORKSPACE_API_BASE,
  registerVibe64WorkspaceRoutes
};
