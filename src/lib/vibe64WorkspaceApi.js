const WORKSPACE_API_BASE = "/api/vibe64/workspaces";
const GITHUB_API_BASE = "/api/vibe64/github";

async function readWorkspaces() {
  return workspaceRequest(WORKSPACE_API_BASE);
}

async function createWorkspace(input = {}) {
  return workspaceRequest(WORKSPACE_API_BASE, {
    body: input,
    method: "POST"
  });
}

async function createRepositoryWorkspace(input = {}) {
  return workspaceRequest(`${WORKSPACE_API_BASE}/create-repository`, {
    body: input,
    method: "POST"
  });
}

async function openRepositoryWorkspace(input = {}) {
  return workspaceRequest(`${WORKSPACE_API_BASE}/from-repository`, {
    body: input,
    method: "POST"
  });
}

async function readGithubRepositoryOwners() {
  return workspaceRequest(`${GITHUB_API_BASE}/repository-owners`);
}

async function resolveGithubRepository(repository = "") {
  const params = new URLSearchParams({
    repository
  });
  return workspaceRequest(`${GITHUB_API_BASE}/repositories/resolve?${params.toString()}`);
}

async function searchGithubRepositories(query = "", {
  owner = ""
} = {}) {
  const params = new URLSearchParams({
    q: query
  });
  if (owner) {
    params.set("owner", owner);
  }
  return workspaceRequest(`${GITHUB_API_BASE}/repositories/search?${params.toString()}`);
}

async function syncGithubIdentity() {
  return workspaceRequest(`${GITHUB_API_BASE}/identity/sync`, {
    method: "POST"
  });
}

async function readProjectAccess(slug = "") {
  return workspaceRequest(`${WORKSPACE_API_BASE}/${encodeURIComponent(slug)}/access`);
}

async function inviteProjectAccess(slug = "", input = {}) {
  return workspaceRequest(`${WORKSPACE_API_BASE}/${encodeURIComponent(slug)}/access/invite`, {
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
  createRepositoryWorkspace,
  createWorkspace,
  inviteProjectAccess,
  openRepositoryWorkspace,
  readGithubRepositoryOwners,
  readProjectAccess,
  resolveGithubRepository,
  searchGithubRepositories,
  syncGithubIdentity,
  readWorkspaces
};
