import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  VIBE64_DATA_ROOT_ENV,
  resolveVibe64DataRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  VIBE64_RUNTIME_MODE_LOCAL,
  createVibe64RuntimeProfile,
  publicRuntimeProfile
} from "../runtimeProfile.js";
import {
  authCookieValue,
  serializeAuthCookie,
  serializeClearedAuthCookie
} from "./cookies.js";
import {
  createFileSessionStore
} from "./sessionStore.js";
import {
  createFileSetupStore
} from "./setupStore.js";
import {
  createFileUserStore
} from "./userStore.js";

const API_AUTH_BASE = "/api/auth";
const API_VIBE64_ACCOUNTS_BASE = "/api/vibe64/accounts";
const PUBLIC_AUTH_PATHS = Object.freeze(new Set([
  `${API_AUTH_BASE}/state`,
  `${API_AUTH_BASE}/supabase-config`,
  `${API_AUTH_BASE}/supabase-session`,
  `${API_AUTH_BASE}/setup-owner`,
  `${API_AUTH_BASE}/login`,
  `${API_AUTH_BASE}/claim`,
  `${API_AUTH_BASE}/logout`,
  `${API_AUTH_BASE}/setup/codex-complete`,
  `${API_AUTH_BASE}/password`
]));
const VIBE64_SUPABASE_URL_ENV = "VIBE64_SUPABASE_URL";
const VIBE64_SUPABASE_PUBLISHABLE_KEY_ENV = "VIBE64_SUPABASE_PUBLISHABLE_KEY";
const VIBE64_SUPABASE_SECRET_KEY_ENV = "VIBE64_SUPABASE_SECRET_KEY";

function createVibe64Auth({
  codexConnectedVerifier = null,
  dataRoot = "",
  env = process.env,
  sendSupabaseInviteEmail = null,
  supabasePublishableKey = "",
  supabaseSecretKey = "",
  supabaseUrl = "",
  runtimeProfile = null,
  verifySupabaseAccessToken = null
} = {}) {
  const profile = createVibe64RuntimeProfile(runtimeProfile || {});
  const root = resolveVibe64DataRoot({
    env,
    explicitRoot: dataRoot
  });
  const users = createFileUserStore({
    usersRoot: path.join(root, "users")
  });
  const setup = createFileSetupStore({
    setupPath: path.join(root, "setup.json")
  });
  const sessions = createFileSessionStore({
    sessionsRoot: path.join(root, "auth-sessions")
  });
  const supabase = resolveSupabaseConfig({
    env,
    publishableKey: supabasePublishableKey,
    secretKey: supabaseSecretKey,
    url: supabaseUrl
  });
  const verifyAccessToken = typeof verifySupabaseAccessToken === "function"
    ? verifySupabaseAccessToken
    : (accessToken) => verifySupabaseUser(accessToken, supabase);
  const verifyCodexConnected = typeof codexConnectedVerifier === "function"
    ? codexConnectedVerifier
    : null;
  const sendInviteEmail = createInviteEmailSender({
    sendSupabaseInviteEmail,
    supabase
  });

  async function stateForRequest(request = {}) {
    const user = await userForRequest(request);
    return {
      ok: true,
      authenticated: Boolean(user),
      authProvider: profile.mode === VIBE64_RUNTIME_MODE_LOCAL ? "local" : "supabase",
      dataRoot: root,
      firstLoginCodexSetupPending: profile.mode === VIBE64_RUNTIME_MODE_LOCAL ? false : await setup.firstLoginCodexSetupPending(),
      ownerInvitePending: profile.mode === VIBE64_RUNTIME_MODE_LOCAL ? false : await users.ownerInvitePending(),
      runtime: publicRuntimeProfile(profile),
      setupRequired: profile.mode === VIBE64_RUNTIME_MODE_LOCAL ? false : await users.setupRequired(),
      supabase: publicSupabaseConfig(supabase),
      user: user ? users.publicUser(user) : null
    };
  }

  async function userForRequest(request = {}) {
    if (profile.mode === VIBE64_RUNTIME_MODE_LOCAL) {
      return localOwnerUser();
    }
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

  async function codexConnectedForSetup() {
    if (!verifyCodexConnected) {
      return {
        ok: false,
        code: "vibe64_accounts_service_unavailable",
        error: "Vibe64 account service is unavailable."
      };
    }
    const result = await verifyCodexConnected();
    if (result === true) {
      return {
        connected: true,
        ok: true
      };
    }
    if (result?.ok === false) {
      return result;
    }
    return {
      connected: result?.connected === true,
      ok: true
    };
  }

  return Object.freeze({
    authenticateSupabaseSession,
    clearUserSession,
    codexConnectedForSetup,
    dataRoot: root,
    sessions,
    setup,
    sendInviteEmail,
    startUserSession,
    stateForRequest,
    supabase,
    runtimeProfile: profile,
    userForRequest,
    users
  });
}

function localOwnerUser() {
  const now = "1970-01-01T00:00:00.000Z";
  return {
    acceptedAt: now,
    createdAt: now,
    email: "local@vibe64.local",
    role: "owner",
    status: "active",
    supabaseUserId: "local:vibe64",
    updatedAt: now
  };
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
    if (auth.runtimeProfile?.mode === VIBE64_RUNTIME_MODE_LOCAL) {
      return localTenantUsersUnavailable(reply);
    }
    return requireAuthResult(auth, request, reply, async () => {
      const users = await auth.users.listUsers();
      return {
        ok: true,
        users: users.map(auth.users.publicUser)
      };
    });
  });

  app.post(`${API_AUTH_BASE}/invite`, async (request, reply) => {
    if (auth.runtimeProfile?.mode === VIBE64_RUNTIME_MODE_LOCAL) {
      return localTenantUsersUnavailable(reply);
    }
    return requireOwnerResult(auth, request, reply, async (currentUser) => {
      const user = await auth.users.inviteUser(request.body || {});
      const inviteEmail = await auth.sendInviteEmail(user, {
        invitedBy: currentUser,
        request
      });
      return {
        inviteEmail,
        ok: true,
        user: auth.users.publicUser(user)
      };
    });
  });

  app.post(`${API_AUTH_BASE}/invite/cancel`, async (request, reply) => {
    if (auth.runtimeProfile?.mode === VIBE64_RUNTIME_MODE_LOCAL) {
      return localTenantUsersUnavailable(reply);
    }
    return requireOwnerResult(auth, request, reply, async () => {
      const user = await auth.users.cancelInvite(request.body || {});
      return {
        ok: true,
        user: auth.users.publicUser(user)
      };
    });
  });

  app.post(`${API_AUTH_BASE}/users/revoke`, async (request, reply) => {
    if (auth.runtimeProfile?.mode === VIBE64_RUNTIME_MODE_LOCAL) {
      return localTenantUsersUnavailable(reply);
    }
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

  app.post(`${API_AUTH_BASE}/setup/codex-complete`, async (request, reply) => {
    return requireOwnerResult(auth, request, reply, async () => {
      await assertCodexConnectedForSetup(auth);
      const setup = await auth.setup.markFirstLoginCodexSetupComplete();
      return {
        ok: true,
        firstLoginCodexSetupPending: false,
        setup
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

function localTenantUsersUnavailable(reply) {
  return reply.code(404).send({
    ok: false,
    code: "vibe64_tenant_users_unavailable",
    error: "Tenant users are not available in local editor mode."
  });
}

async function assertCodexConnectedForSetup(auth) {
  const status = await auth.codexConnectedForSetup();
  if (status?.ok === false) {
    throw authError(
      status.code || "vibe64_codex_status_failed",
      status.error || "Codex status could not be verified."
    );
  }
  if (status?.connected !== true) {
    throw authError(
      "vibe64_codex_setup_incomplete",
      "Connect Codex before completing first-login setup."
    );
  }
}

function registerVibe64AuthGate(app, auth, {
  accountService = null
} = {}) {
  app.addHook("preHandler", async (request, reply) => {
    if (isAuthPublicRequest(request)) {
      return;
    }
    const user = await auth.userForRequest(request);
    if (user) {
      request.vibe64User = auth.users.publicUser(user);
      if (isGithubPrerequisiteRequest(request)) {
        return;
      }
      const githubGateResponse = await requireGithubReadyForRequest(accountService, request.vibe64User);
      if (githubGateResponse) {
        return reply.code(githubGateResponse.statusCode).send(githubGateResponse.body);
      }
      return;
    }
    return reply.code(401).send({
      ok: false,
      code: "vibe64_auth_required",
      error: "Log in to Vibe64."
    });
  });
}

async function requireGithubReadyForRequest(accountService, vibe64User = {}) {
  if (!accountService || typeof accountService.getStatus !== "function") {
    return {
      body: {
        ok: false,
        code: "vibe64_accounts_service_unavailable",
        error: "Vibe64 account service is unavailable."
      },
      statusCode: 503
    };
  }

  try {
    const status = await accountService.getStatus({
      vibe64User
    });
    if (status?.ok === false) {
      return {
        body: {
          ok: false,
          code: status.code || "vibe64_accounts_status_failed",
          error: status.error || "GitHub account status could not be verified."
        },
        statusCode: 503
      };
    }

    const github = githubAccountFromStatus(status);
    if (github?.connected === true) {
      return null;
    }
    return {
      body: {
        ok: false,
        code: "vibe64_github_required",
        error: github?.message || "Connect GitHub before using Vibe64."
      },
      statusCode: 403
    };
  } catch (error) {
    return {
      body: {
        ok: false,
        code: error?.code || "vibe64_accounts_status_failed",
        error: String(error?.message || error || "GitHub account status could not be verified.")
      },
      statusCode: 503
    };
  }
}

function githubAccountFromStatus(status = {}) {
  const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
  return accounts.find((account) => account?.id === "github") || null;
}

function resolveSupabaseConfig({
  env = process.env,
  publishableKey = "",
  secretKey = "",
  url = ""
} = {}) {
  const resolvedUrl = String(url || env[VIBE64_SUPABASE_URL_ENV] || "").trim().replace(/\/+$/u, "");
  const resolvedPublishableKey = String(publishableKey || env[VIBE64_SUPABASE_PUBLISHABLE_KEY_ENV] || "").trim();
  const resolvedSecretKey = String(secretKey || env[VIBE64_SUPABASE_SECRET_KEY_ENV] || "").trim();
  return Object.freeze({
    adminConfigured: Boolean(resolvedUrl && resolvedSecretKey),
    configured: Boolean(resolvedUrl && resolvedPublishableKey),
    publishableKey: resolvedPublishableKey,
    secretKey: resolvedSecretKey,
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

function createInviteEmailSender({
  sendSupabaseInviteEmail = null,
  supabase = {}
} = {}) {
  const customSender = typeof sendSupabaseInviteEmail === "function"
    ? sendSupabaseInviteEmail
    : null;
  return async function sendInviteEmail(user = {}, {
    invitedBy = {},
    request = {}
  } = {}) {
    if (user.status !== "invited") {
      return {
        attempted: false,
        code: "vibe64_invite_email_not_needed",
        ok: true,
        provider: "supabase"
      };
    }
    if (supabase.adminConfigured !== true) {
      return {
        attempted: false,
        code: "vibe64_supabase_admin_not_configured",
        error: "Supabase Admin invite email is not configured.",
        ok: false,
        provider: "supabase"
      };
    }
    const redirectTo = inviteRedirectToForRequest(request);
    if (!redirectTo) {
      return {
        attempted: false,
        code: "vibe64_invite_redirect_unavailable",
        error: "Vibe64 could not determine an invite redirect URL.",
        ok: false,
        provider: "supabase"
      };
    }
    const payload = {
      data: inviteEmailData({
        invitedBy,
        redirectTo,
        request
      }),
      email: String(user.email || "").trim().toLowerCase(),
      redirectTo
    };
    try {
      const response = customSender
        ? await customSender({
          ...payload,
          type: "invite"
        })
        : await sendDefaultSupabaseInviteEmail(payload, {
          supabase
        });
      return {
        attempted: true,
        mode: "invite",
        ok: true,
        provider: "supabase",
        redirectTo,
        supabaseUserId: String(response?.supabaseUserId || response?.data?.user?.id || "")
      };
    } catch (error) {
      if (supabaseInviteUserAlreadyExists(error)) {
        return sendExistingSupabaseUserInviteEmail(payload, {
          customSender,
          supabase
        });
      }
      return {
        attempted: true,
        code: error?.code || "vibe64_supabase_invite_email_failed",
        error: String(error?.message || error || "Supabase invite email failed."),
        ok: false,
        provider: "supabase",
        redirectTo
      };
    }
  };
}

async function sendExistingSupabaseUserInviteEmail(payload = {}, {
  customSender = null,
  supabase = {}
} = {}) {
  try {
    const response = customSender
      ? await customSender({
        ...payload,
        type: "magiclink"
      })
      : await sendDefaultSupabaseMagicLinkEmail(payload, {
        supabase
      });
    return {
      attempted: true,
      mode: "magiclink",
      ok: true,
      provider: "supabase",
      redirectTo: payload.redirectTo,
      supabaseUserId: String(response?.supabaseUserId || response?.data?.user?.id || "")
    };
  } catch (error) {
    return {
      attempted: true,
      code: error?.code || "vibe64_supabase_existing_user_email_failed",
      error: String(error?.message || error || "Supabase existing-user invite email failed."),
      mode: "magiclink",
      ok: false,
      provider: "supabase",
      redirectTo: payload.redirectTo
    };
  }
}

async function sendDefaultSupabaseInviteEmail({
  data = {},
  email = "",
  redirectTo = ""
} = {}, {
  supabase = {}
} = {}) {
  const client = createClient(supabase.url, supabase.secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  const result = await client.auth.admin.inviteUserByEmail(email, {
    data,
    redirectTo
  });
  if (result.error) {
    throw result.error;
  }
  return {
    data: result.data,
    supabaseUserId: String(result.data?.user?.id || "")
  };
}

async function sendDefaultSupabaseMagicLinkEmail({
  data = {},
  email = "",
  redirectTo = ""
} = {}, {
  supabase = {}
} = {}) {
  if (supabase.configured !== true) {
    const error = new Error("Supabase publishable key is required to email existing users.");
    error.code = "vibe64_supabase_not_configured";
    throw error;
  }
  const client = createClient(supabase.url, supabase.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  const result = await client.auth.signInWithOtp({
    email,
    options: {
      data,
      emailRedirectTo: redirectTo,
      shouldCreateUser: false
    }
  });
  if (result.error) {
    throw result.error;
  }
  return {
    data: result.data
  };
}

function supabaseInviteUserAlreadyExists(error = {}) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  return code === "email_exists" ||
    message.includes("already been registered") ||
    message.includes("already registered");
}

function inviteEmailData({
  invitedBy = {},
  redirectTo = "",
  request = {}
} = {}) {
  const origin = requestPublicOrigin(request);
  const tenantName = tenantNameForOrigin(origin);
  const invitedByEmail = String(invitedBy.email || "");
  return {
    app: "Vibe64",
    host: origin,
    host_label: tenantName,
    hostLabel: tenantName,
    host_url: origin,
    invite_url: redirectTo,
    invite_message: invitedByEmail
      ? `${invitedByEmail} invited you to ${tenantName || "this host"} on Vibe64.`
      : `You were invited to ${tenantName || "this host"} on Vibe64.`,
    invited_by: invitedByEmail,
    invitedBy: invitedByEmail,
    redirect_to: redirectTo,
    redirectTo,
    sign_in_url: redirectTo,
    signInUrl: redirectTo,
    tenant_name: tenantName,
    tenantName
  };
}

function tenantNameForOrigin(origin = "") {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (!hostname) {
      return "";
    }
    if (hostname.endsWith(".vibe64.dev")) {
      return hostname.slice(0, -".vibe64.dev".length);
    }
    return hostname;
  } catch {
    return "";
  }
}

function inviteRedirectToForRequest(request = {}) {
  const origin = requestPublicOrigin(request);
  if (!origin) {
    return "";
  }
  try {
    return new URL("/account?mode=signup", origin).href;
  } catch {
    return "";
  }
}

function requestPublicOrigin(request = {}) {
  const headers = request.headers || {};
  const host = firstForwardedHeader(headers["x-forwarded-host"]) ||
    String(headers.host || request.hostname || "").trim();
  if (!host) {
    return "";
  }
  const protocol = firstForwardedHeader(headers["x-forwarded-proto"]) ||
    String(request.protocol || (requestIsSecure(request) ? "https" : "http") || "http").trim();
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return "";
  }
}

function firstForwardedHeader(value = "") {
  return String(value || "").split(",")[0].trim();
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
    PUBLIC_AUTH_PATHS.has(pathname) ||
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

function isGithubPrerequisiteRequest(request = {}) {
  const pathname = requestPathname(request);
  return pathname === API_VIBE64_ACCOUNTS_BASE ||
    pathname.startsWith(`${API_VIBE64_ACCOUNTS_BASE}/`);
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

function authError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
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
    error?.code === "vibe64_invite_not_pending" ||
    error?.code === "vibe64_tenant_user_limit_reached" ||
    error?.code === "vibe64_codex_setup_incomplete"
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
  VIBE64_SUPABASE_SECRET_KEY_ENV,
  VIBE64_SUPABASE_URL_ENV,
  createVibe64Auth,
  registerVibe64AuthGate,
  registerVibe64AuthRoutes,
  resolveSupabaseConfig,
  resolveVibe64DataRoot
};
