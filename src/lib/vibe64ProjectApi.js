import {
  resolveStudioRequestUrl
} from "@/lib/studioHttp.js";

const PROJECT_API_BASE = "/api/vibe64/projects";
const GITHUB_API_BASE = "/api/vibe64/github";

async function readProjects() {
  return projectRequest(PROJECT_API_BASE);
}

async function createProject(input = {}) {
  return projectRequest(PROJECT_API_BASE, {
    body: input,
    method: "POST"
  });
}

async function createRepositoryProject(input = {}) {
  return projectRequest(`${PROJECT_API_BASE}/create-repository`, {
    body: input,
    method: "POST"
  });
}

async function openRepositoryProject(input = {}) {
  return projectRequest(`${PROJECT_API_BASE}/from-repository`, {
    body: input,
    method: "POST"
  });
}

async function readGithubRepositoryOwners() {
  return projectRequest(`${GITHUB_API_BASE}/repository-owners`);
}

async function resolveGithubRepository(repository = "") {
  const params = new URLSearchParams({
    repository
  });
  return projectRequest(`${GITHUB_API_BASE}/repositories/resolve?${params.toString()}`);
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
  return projectRequest(`${GITHUB_API_BASE}/repositories/search?${params.toString()}`);
}

async function syncGithubIdentity() {
  return projectRequest(`${GITHUB_API_BASE}/identity/sync`, {
    method: "POST"
  });
}

async function readProjectAccess(slug = "") {
  return projectRequest(`${PROJECT_API_BASE}/${encodeURIComponent(slug)}/access`);
}

async function inviteProjectAccess(slug = "", input = {}) {
  return projectRequest(`${PROJECT_API_BASE}/${encodeURIComponent(slug)}/access/invite`, {
    body: input,
    method: "POST"
  });
}

async function projectRequest(path, {
  body = null,
  method = "GET"
} = {}) {
  const response = await fetch(resolveStudioRequestUrl(path), {
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
            message: "Vibe64 project response was not JSON."
      }
    ]
  }));
  return {
    ...payload,
    httpStatus: response.status
  };
}

export {
  createProject,
  createRepositoryProject,
  inviteProjectAccess,
  openRepositoryProject,
  readGithubRepositoryOwners,
  readProjectAccess,
  readProjects,
  resolveGithubRepository,
  searchGithubRepositories,
  syncGithubIdentity
};
