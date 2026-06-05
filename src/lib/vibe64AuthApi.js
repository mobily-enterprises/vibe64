const AUTH_API_BASE = "/api/auth";

async function readAuthState() {
  return authRequest(`${AUTH_API_BASE}/state`);
}

async function setupOwner(input = {}) {
  return authRequest(`${AUTH_API_BASE}/setup-owner`, {
    body: input,
    method: "POST"
  });
}

async function login(input = {}) {
  return authRequest(`${AUTH_API_BASE}/login`, {
    body: input,
    method: "POST"
  });
}

async function claimInvite(input = {}) {
  return authRequest(`${AUTH_API_BASE}/claim`, {
    body: input,
    method: "POST"
  });
}

async function logout() {
  return authRequest(`${AUTH_API_BASE}/logout`, {
    method: "POST"
  });
}

async function readUsers() {
  return authRequest(`${AUTH_API_BASE}/users`);
}

async function inviteUser(input = {}) {
  return authRequest(`${AUTH_API_BASE}/invite`, {
    body: input,
    method: "POST"
  });
}

async function changePassword(input = {}) {
  return authRequest(`${AUTH_API_BASE}/password`, {
    body: input,
    method: "POST"
  });
}

async function authRequest(path, {
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
    error: "Vibe64 auth response was not JSON."
  }));
  return {
    ...payload,
    httpStatus: response.status
  };
}

export {
  changePassword,
  claimInvite,
  inviteUser,
  login,
  logout,
  readAuthState,
  readUsers,
  setupOwner
};
