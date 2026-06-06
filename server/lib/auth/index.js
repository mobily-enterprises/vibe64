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
const VIBE64_SUPABASE_URL_ENV = "VIBE64_SUPABASE_URL";
const VIBE64_SUPABASE_PUBLISHABLE_KEY_ENV = "VIBE64_SUPABASE_PUBLISHABLE_KEY";
const DEFAULT_SUPABASE_URL = "https://zfszwwusouczybrsxxyh.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_bh4HEW-6pWSCpAyP7hOBVQ_0q2YQBPR";

function createVibe64Auth({
  dataRoot = "",
  env = process.env,
  supabasePublishableKey = "",
  supabaseUrl = "",
  verifySupabaseAccessToken = null
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
  const supabase = resolveSupabaseConfig({
    env,
    publishableKey: supabasePublishableKey,
    url: supabaseUrl
  });
  const verifyAccessToken = typeof verifySupabaseAccessToken === "function"
    ? verifySupabaseAccessToken
    : (accessToken) => verifySupabaseUser(accessToken, supabase);

  async function stateForRequest(request = {}) {
    const user = await userForRequest(request);
    return {
      ok: true,
      authenticated: Boolean(user),
      authProvider: "supabase",
      dataRoot: root,
      ownerInvitePending: await users.ownerInvitePending(),
      setupRequired: await users.setupRequired(),
      supabase: publicSupabaseConfig(supabase),
      user: user ? users.publicUser(user) : null
    };
  }

  async function userForRequest(request = {}) {
    const session = await sessions.readSession(authCookieValue(request));
    if (!session?.supabaseUserId) {
      return null;
    }
    return users.userForSession(session);
  }

  async function startUserSession(reply, user = {}, {
    request = {}
  } = {}) {
    const session = await sessions.createSession(user);
    reply.header("Set-Cookie", serializeAuthCookie(session.cookieValue, {
      maxAge: session.maxAge,
      secure: requestIsSecure(request)
    }));
    return session;
  }

  async function clearUserSession(request, reply) {
    const session = await sessions.readSession(authCookieValue(request));
    if (session?.id) {
      await sessions.destroySession(session.id);
    }
    reply.header("Set-Cookie", serializeClearedAuthCookie({
      secure: requestIsSecure(request)
    }));
  }

  async function authenticateSupabaseSession(input = {}) {
    const identity = await verifyAccessToken(String(input.accessToken || "").trim());
    return users.acceptSupabaseIdentity(identity);
  }

  return Object.freeze({
    authenticateSupabaseSession,
    clearUserSession,
    dataRoot: root,
    sessions,
    startUserSession,
    stateForRequest,
    supabase,
    userForRequest,
    users
  });
}

function registerVibe64AuthRoutes(app, auth) {
  app.get(`${API_AUTH_BASE}/state`, async (request) => {
    return auth.stateForRequest(request);
  });

  app.get(`${API_AUTH_BASE}/supabase-config`, async () => {
    return {
      ok: true,
      supabase: publicSupabaseConfig(auth.supabase)
    };
  });

  app.post(`${API_AUTH_BASE}/supabase-session`, async (request, reply) => {
    return authRouteResult(async () => {
      const user = await auth.authenticateSupabaseSession(request.body || {});
      await auth.startUserSession(reply, user, {
        request
      });
      return {
        ok: true,
        user: auth.users.publicUser(user)
      };
    }, reply);
  });

  app.post(`${API_AUTH_BASE}/setup-owner`, async (_request, reply) => {
    return reply.code(410).send({
      ok: false,
      code: "vibe64_local_password_auth_removed",
      error: "Create the owner by signing in with Supabase."
    });
  });

  app.post(`${API_AUTH_BASE}/login`, async (_request, reply) => {
    return reply.code(410).send({
      ok: false,
      code: "vibe64_local_password_auth_removed",
      error: "Log in with Supabase."
    });
  });

  app.post(`${API_AUTH_BASE}/claim`, async (_request, reply) => {
    return reply.code(410).send({
      ok: false,
      code: "vibe64_local_password_auth_removed",
      error: "Accept invites by signing in with Supabase using the invited email."
    });
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
    return requireOwnerResult(auth, request, reply, async () => {
      const user = await auth.users.inviteUser(request.body || {});
      return {
        ok: true,
        user: auth.users.publicUser(user)
      };
    });
  });

  app.post(`${API_AUTH_BASE}/invite/cancel`, async (request, reply) => {
    return requireOwnerResult(auth, request, reply, async () => {
      const user = await auth.users.cancelInvite(request.body || {});
      return {
        ok: true,
        user: auth.users.publicUser(user)
      };
    });
  });

  app.post(`${API_AUTH_BASE}/users/revoke`, async (request, reply) => {
    return requireOwnerResult(auth, request, reply, async (currentUser) => {
      const user = await auth.users.revokeUser(request.body || {}, currentUser);
      await auth.sessions.destroySessionsForUser({
        email: user.email,
        supabaseUserId: user.supabaseUserId
      });
      return {
        ok: true,
        user: auth.users.publicUser(user)
      };
    });
  });

  app.post(`${API_AUTH_BASE}/password`, async (_request, reply) => {
    return reply.code(410).send({
      ok: false,
      code: "vibe64_password_managed_by_supabase",
      error: "Password changes are handled by Supabase."
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

function resolveSupabaseConfig({
  env = process.env,
  publishableKey = "",
  url = ""
} = {}) {
  const resolvedUrl = String(url || env[VIBE64_SUPABASE_URL_ENV] || DEFAULT_SUPABASE_URL || "").trim().replace(/\/+$/u, "");
  const resolvedPublishableKey = String(publishableKey || env[VIBE64_SUPABASE_PUBLISHABLE_KEY_ENV] || DEFAULT_SUPABASE_PUBLISHABLE_KEY || "").trim();
  return Object.freeze({
    configured: Boolean(resolvedUrl && resolvedPublishableKey),
    publishableKey: resolvedPublishableKey,
    url: resolvedUrl
  });
}

function publicSupabaseConfig(config = {}) {
  return {
    configured: config.configured === true,
    publishableKey: String(config.publishableKey || ""),
    url: String(config.url || "")
  };
}

async function verifySupabaseUser(accessToken = "", supabase = {}) {
  const token = String(accessToken || "").trim();
  if (!token) {
    const error = new Error("Supabase access token is missing.");
    error.code = "vibe64_supabase_token_missing";
    throw error;
  }
  if (supabase.configured !== true) {
    const error = new Error("Supabase auth is not configured.");
    error.code = "vibe64_supabase_not_configured";
    throw error;
  }

  const response = await fetch(`${supabase.url}/auth/v1/user`, {
    headers: {
      apikey: supabase.publishableKey,
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload.msg || payload.message || payload.error_description || "Supabase user verification failed."));
    error.code = "vibe64_supabase_user_verification_failed";
    throw error;
  }
  return {
    email: payload.email,
    id: payload.id
  };
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

async function requireOwnerResult(auth, request, reply, handler) {
  const user = await auth.userForRequest(request);
  if (!user) {
    return reply.code(401).send({
      ok: false,
      code: "vibe64_auth_required",
      error: "Log in to Vibe64."
    });
  }
  if (user.role !== "owner") {
    return reply.code(403).send({
      ok: false,
      code: "vibe64_owner_required",
      error: "Only owners can manage Vibe64 users."
    });
  }
  return authRouteResult(() => handler(user), reply);
}

async function authRouteResult(operation, reply) {
  try {
    const response = await operation();
    if (response?.ok === false) {
      return reply.code(400).send(response);
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
  if (
    error?.code === "vibe64_invalid_user_email" ||
    error?.code === "vibe64_supabase_token_missing" ||
    error?.code === "vibe64_invalid_supabase_user"
  ) {
    return 422;
  }
  if (
    error?.code === "vibe64_user_not_invited" ||
    error?.code === "vibe64_user_revoked" ||
    error?.code === "vibe64_invite_canceled" ||
    error?.code === "vibe64_cannot_revoke_self" ||
    error?.code === "vibe64_cannot_revoke_last_owner"
  ) {
    return 403;
  }
  if (error?.code === "vibe64_user_not_found") {
    return 404;
  }
  if (
    error?.code === "vibe64_supabase_user_mismatch" ||
    error?.code === "vibe64_supabase_email_mismatch" ||
    error?.code === "vibe64_invite_not_pending"
  ) {
    return 409;
  }
  if (error?.code === "vibe64_supabase_user_verification_failed") {
    return 401;
  }
  return 400;
}

function requestIsSecure(request = {}) {
  const forwardedProto = String(request.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwardedProto === "https" ||
    request.protocol === "https" ||
    request.socket?.encrypted === true;
}

export {
  VIBE64_DATA_ROOT_ENV,
  VIBE64_SUPABASE_PUBLISHABLE_KEY_ENV,
  VIBE64_SUPABASE_URL_ENV,
  createVibe64Auth,
  registerVibe64AuthGate,
  registerVibe64AuthRoutes,
  resolveSupabaseConfig,
  resolveVibe64DataRoot
};
