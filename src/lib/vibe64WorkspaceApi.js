const WORKSPACE_API_BASE = "/api/vibe64/workspaces";

async function readWorkspaces() {
  return workspaceRequest(WORKSPACE_API_BASE);
}

async function createWorkspace(input = {}) {
  return workspaceRequest(WORKSPACE_API_BASE, {
    body: input,
    method: "POST"
  });
}

async function workspaceRequest(path, {
  body = null,
  method = "GET"
} = {}) {
  const response = await fetch(path, {
    body: body == null ? null : JSON.stringify(body),
    credentials: "include",
    headers: body == null
      ? {}
      : {
          "Content-Type": "application/json"
        },
    method
  });
  const payload = await response.json().catch(() => ({
    ok: false,
    errors: [
      {
        message: "Vibe64 workspace response was not JSON."
      }
    ]
  }));
  return {
    ...payload,
    httpStatus: response.status
  };
}

export {
  createWorkspace,
  readWorkspaces
};
