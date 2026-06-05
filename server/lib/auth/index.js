import path from "node:path";

import {
  VIBE64_DATA_ROOT_ENV,
  resolveVibe64DataRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  authCookieValue,
  serializeAuthCookie,
  serializeClearedAuthCookie
} from "./cookies.js";
import {
  createFileSessionStore
} from "./sessionStore.js";
import {
  createFileUserStore
} from "./userStore.js";

const API_AUTH_BASE = "/api/auth";

function createVibe64Auth({
  dataRoot = "",
  env = process.env
} = {}) {
  const root = resolveVibe64DataRoot({
    env,
    explicitRoot: dataRoot
  });
  const users = createFileUserStore({
    usersRoot: path.join(root, "users")
  });
  const sessions = createFileSessionStore({
    sessionsRoot: path.join(root, "auth-sessions")
  });

  async function stateForRequest(request = {}) {
    const user = await userForRequest(request);
    const userRecords = await users.listUsers();
    return {
      ok: true,
      authenticated: Boolean(user),
      dataRoot: root,
      setupRequired: userRecords.length === 0,
      user: user ? users.publicUser(user) : null
    };
  }

  async function userForRequest(request = {}) {
    const session = await sessions.readSession(authCookieValue(request));
    if (!session?.email) {
      return null;
    }
    return users.readUser(session.email);
  }

  async function startUserSession(reply, user = {}) {
    const session = await sessions.createSession(user);
    reply.header("Set-Cookie", serializeAuthCookie(session.cookieValue, {
      maxAge: session.maxAge
    }));
    return session;
  }

  async function clearUserSession(request, reply) {
    const session = await sessions.readSession(authCookieValue(request));
    if (session?.id) {
      await sessions.destroySession(session.id);
    }
    reply.header("Set-Cookie", serializeClearedAuthCookie());
  }

  return Object.freeze({
    clearUserSession,
    dataRoot: root,
    sessions,
    startUserSession,
    stateForRequest,
    userForRequest,
    users
  });
}

function registerVibe64AuthRoutes(app, auth) {
  app.get(`${API_AUTH_BASE}/state`, async (request) => {
    return auth.stateForRequest(request);
  });

  app.post(`${API_AUTH_BASE}/setup-owner`, async (request, reply) => {
    return authRouteResult(async () => {
      const user = await auth.users.setupOwner(request.body || {});
      await auth.startUserSession(reply, user);
      return {
        ok: true,
        user: auth.users.publicUser(user)
      };
    }, reply);
  });

  app.post(`${API_AUTH_BASE}/login`, async (request, reply) => {
    return authRouteResult(async () => {
      const result = await auth.users.authenticate(request.body || {});
      if (result.ok === false) {
        return result;
      }
      await auth.startUserSession(reply, result.user);
      return {
        ok: true,
        user: auth.users.publicUser(result.user)
      };
    }, reply);
  });

  app.post(`${API_AUTH_BASE}/claim`, async (request, reply) => {
    return authRouteResult(async () => {
      const user = await auth.users.claimInvite(request.body || {});
      await auth.startUserSession(reply, user);
      return {
        ok: true,
        user: auth.users.publicUser(user)
      };
    }, reply);
  });

  app.post(`${API_AUTH_BASE}/logout`, async (request, reply) => {
    await auth.clearUserSession(request, reply);
    return {
      ok: true
    };
  });

  app.get(`${API_AUTH_BASE}/users`, async (request, reply) => {
    return requireAuthResult(auth, request, reply, async () => {
      const users = await auth.users.listUsers();
      return {
        ok: true,
        users: users.map(auth.users.publicUser)
      };
    });
  });

  app.post(`${API_AUTH_BASE}/invite`, async (request, reply) => {
    return requireAuthResult(auth, request, reply, async () => {
      const user = await auth.users.inviteUser(request.body || {});
      return {
        ok: true,
        user: auth.users.publicUser(user)
      };
    });
  });

  app.post(`${API_AUTH_BASE}/password`, async (request, reply) => {
    return requireAuthResult(auth, request, reply, async (currentUser) => {
      const user = await auth.users.changePassword(currentUser.email, request.body || {});
      return {
        ok: true,
        user: auth.users.publicUser(user)
      };
    });
  });
}

function registerVibe64AuthGate(app, auth) {
  app.addHook("preHandler", async (request, reply) => {
    if (isAuthPublicRequest(request)) {
      return;
    }
    const user = await auth.userForRequest(request);
    if (user) {
      request.vibe64User = auth.users.publicUser(user);
      return;
    }
    return reply.code(401).send({
      ok: false,
      code: "vibe64_auth_required",
      error: "Log in to Vibe64."
    });
  });
}

function isAuthPublicRequest(request = {}) {
  const method = String(request.method || "GET").toUpperCase();
  const pathname = requestPathname(request);
  if (
    pathname === "/api/health" ||
    pathname.startsWith(`${API_AUTH_BASE}/`) ||
    pathname.startsWith("/assets/") ||
    pathname === "/favicon.svg" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/manifest.webmanifest"
  ) {
    return true;
  }
  if (!pathname.startsWith("/api/") && (method === "GET" || method === "HEAD")) {
    return true;
  }
  return false;
}

function requestPathname(request = {}) {
  try {
    return new URL(String(request.url || "/"), "http://vibe64.local").pathname;
  } catch {
    return "/";
  }
}

async function requireAuthResult(auth, request, reply, handler) {
  const user = await auth.userForRequest(request);
  if (!user) {
    return reply.code(401).send({
      ok: false,
      code: "vibe64_auth_required",
      error: "Log in to Vibe64."
    });
  }
  return authRouteResult(() => handler(user), reply);
}

async function authRouteResult(operation, reply) {
  try {
    const response = await operation();
    if (response?.ok === false) {
      return reply.code(response.claimRequired ? 409 : 401).send(response);
    }
    return response;
  } catch (error) {
    const statusCode = authErrorStatusCode(error);
    return reply.code(statusCode).send({
      ok: false,
      code: error?.code || "vibe64_auth_failed",
      error: String(error?.message || error || "Vibe64 auth failed.")
    });
  }
}

function authErrorStatusCode(error = {}) {
  if (error?.code === "vibe64_owner_already_exists") {
    return 409;
  }
  if (error?.code === "vibe64_user_not_found") {
    return 404;
  }
  if (
    error?.code === "vibe64_invalid_user_email" ||
    error?.code === "vibe64_password_mismatch" ||
    error?.code === "vibe64_password_too_short"
  ) {
    return 422;
  }
  if (error?.code === "vibe64_invalid_old_password") {
    return 403;
  }
  return 400;
}

export {
  VIBE64_DATA_ROOT_ENV,
  createVibe64Auth,
  registerVibe64AuthGate,
  registerVibe64AuthRoutes,
  resolveVibe64DataRoot
};
