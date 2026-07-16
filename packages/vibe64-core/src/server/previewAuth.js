import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const JSKIT_PREVIEW_AUTH_KIND = "jskit-dev";
const COOKIE_PROFILE_PREVIEW_AUTH_KIND = "cookie-profile";
const VIBE64_SELF_PREVIEW_AUTH_KIND = "vibe64-self";
const JSKIT_DEV_AUTH_ACCESS_TTL_SECONDS = 60 * 60;
const JSKIT_DEV_AUTH_REFRESH_TTL_SECONDS = 60 * 60 * 12;
const JSKIT_DEV_AUTH_SECRET_HEADER = "x-jskit-dev-auth-secret";
const PREVIEW_IDENTITY_CONTROL_PATH = "/__vibe64/preview-identity";
const PREVIEW_IDENTITY_GRANT_PREFIX = "vibe64-preview-identity-v1";
const PREVIEW_IDENTITY_GRANT_TTL_SECONDS = 60;
const PREVIEW_IDENTITY_GRANT_SECRET = crypto.randomBytes(32);
const PREVIEW_IDENTITY_LOGIN_OPERATION = "login-as";
const PREVIEW_IDENTITY_LOGOUT_OPERATION = "logout";
const PREVIEW_IDENTITY_GRANT_SCOPE_KEYS = Object.freeze([
  "projectScope",
  "sessionId",
  "targetHref",
  "targetRoot",
  "terminalSessionId"
]);
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const PREVIEW_AUTH_KINDS = new Set([
  JSKIT_PREVIEW_AUTH_KIND,
  COOKIE_PROFILE_PREVIEW_AUTH_KIND,
  VIBE64_SELF_PREVIEW_AUTH_KIND
]);

function normalizePreviewAuthKind(value = "") {
  const text = String(value || "").trim();
  return PREVIEW_AUTH_KINDS.has(text) ? text : "";
}

function createPreviewAuthSecret() {
  return crypto.randomBytes(32).toString("hex");
}

function requirePreviewAuthSecret(secret = "") {
  const normalizedSecret = String(secret || "").trim();
  if (!/^[a-f0-9]{64}$/u.test(normalizedSecret)) {
    throw new Error("Preview auth secret is missing or invalid.");
  }
  return normalizedSecret;
}

function previewAuthEnvironment({
  kind = "",
  projectScope = "",
  secret = "",
  sessionId = "",
  targetHref = "",
  targetRoot = "",
  terminalSessionId = ""
} = {}) {
  return previewAuthProvider(kind)?.environment({
    projectScope,
    secret,
    sessionId,
    targetHref,
    targetRoot,
    terminalSessionId
  }) || {};
}

function previewAuthCookieNames({
  kind = "",
  profilePath = ""
} = {}) {
  return previewAuthProvider(kind)?.cookieNames({
    profilePath
  }) || [];
}

function previewAuthCookieHeader({
  kind = "",
  profilePath = "",
  projectScope = "",
  sessionId = "",
  targetHref = "",
  targetRoot = "",
  terminalSessionId = ""
} = {}) {
  return previewAuthProvider(kind)?.cookieHeader({
    profilePath,
    projectScope,
    sessionId,
    targetHref,
    targetRoot,
    terminalSessionId
  }) || "";
}

function previewAuthIdentityAvailable({ kind = "" } = {}) {
  return typeof previewAuthProvider(kind)?.identityExchange === "function";
}

function previewAuthRequiresIdentitySecret({ kind = "" } = {}) {
  return previewAuthProvider(kind)?.requiresIdentitySecret === true;
}

function previewAuthUsesProfile({ kind = "" } = {}) {
  return previewAuthProvider(kind)?.usesProfile === true;
}

function previewAuthIdentityExchange(previewAuth = {}, selection = {}) {
  const provider = previewAuthProvider(previewAuth.kind);
  if (typeof provider?.identityExchange !== "function") {
    throw previewIdentityError(
      "This preview does not support identity switching.",
      "vibe64_preview_identity_unsupported"
    );
  }
  return provider.identityExchange({
    previewAuth,
    selection: normalizePreviewIdentitySelection(selection)
  });
}

function jskitDevAuthEnvironment({
  secret = ""
} = {}) {
  return {
    AUTH_DEV_BYPASS_ENABLED: "true",
    AUTH_DEV_BYPASS_SECRET: requirePreviewAuthSecret(secret),
    AUTH_DEV_ACCESS_TTL_SECONDS: String(JSKIT_DEV_AUTH_ACCESS_TTL_SECONDS),
    AUTH_DEV_REFRESH_TTL_SECONDS: String(JSKIT_DEV_AUTH_REFRESH_TTL_SECONDS)
  };
}

function emptyPreviewAuthEnvironment() {
  return {};
}

function emptyPreviewAuthCookies() {
  return [];
}

function emptyPreviewAuthCookieHeader() {
  return "";
}

function jskitPreviewIdentityExchange({
  previewAuth = {},
  selection = {}
} = {}) {
  if (selection.operation === PREVIEW_IDENTITY_LOGOUT_OPERATION) {
    return {
      body: {},
      method: "POST",
      path: "/api/logout"
    };
  }
  return {
    before: [
      {
        body: {},
        method: "POST",
        path: "/api/logout"
      }
    ],
    body: {
      ...(selection.email ? { email: selection.email } : {}),
      ...(selection.userId ? { userId: selection.userId } : {})
    },
    headers: {
      [JSKIT_DEV_AUTH_SECRET_HEADER]: requirePreviewAuthSecret(previewAuth.secret)
    },
    method: "POST",
    path: "/api/dev-auth/login-as"
  };
}

function vibe64SelfPreviewAuthCookieNames({
  profilePath = ""
} = {}) {
  const profile = readVibe64SelfPreviewAuthProfile(profilePath);
  return profile ? [profile.cookieName] : [];
}

function vibe64SelfPreviewAuthCookieHeader({
  profilePath = ""
} = {}) {
  const profile = readVibe64SelfPreviewAuthProfile(profilePath);
  return profile
    ? `${profile.cookieName}=${encodeURIComponent(profile.cookieValue)}`
    : "";
}

function cookieProfilePreviewAuthCookieNames({
  profilePath = ""
} = {}) {
  const profile = readCookiePreviewAuthProfile(profilePath);
  return profile ? profile.cookies.map((cookie) => cookie.name) : [];
}

function cookieProfilePreviewAuthCookieHeader({
  profilePath = ""
} = {}) {
  const profile = readCookiePreviewAuthProfile(profilePath);
  return profile
    ? profile.cookies
      .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
      .join("; ")
    : "";
}

const PREVIEW_AUTH_PROVIDERS = Object.freeze({
  [JSKIT_PREVIEW_AUTH_KIND]: Object.freeze({
    cookieHeader: emptyPreviewAuthCookieHeader,
    cookieNames: emptyPreviewAuthCookies,
    environment: jskitDevAuthEnvironment,
    identityExchange: jskitPreviewIdentityExchange,
    requiresIdentitySecret: true
  }),
  [COOKIE_PROFILE_PREVIEW_AUTH_KIND]: Object.freeze({
    cookieHeader: cookieProfilePreviewAuthCookieHeader,
    cookieNames: cookieProfilePreviewAuthCookieNames,
    environment: emptyPreviewAuthEnvironment,
    usesProfile: true
  }),
  [VIBE64_SELF_PREVIEW_AUTH_KIND]: Object.freeze({
    cookieHeader: vibe64SelfPreviewAuthCookieHeader,
    cookieNames: vibe64SelfPreviewAuthCookieNames,
    environment: emptyPreviewAuthEnvironment,
    usesProfile: true
  })
});

function previewAuthProvider(kind = "") {
  return PREVIEW_AUTH_PROVIDERS[normalizePreviewAuthKind(kind)] || null;
}

function normalizePreviewIdentitySelection(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const operation = String(source.operation || PREVIEW_IDENTITY_LOGIN_OPERATION).trim();
  if (![PREVIEW_IDENTITY_LOGIN_OPERATION, PREVIEW_IDENTITY_LOGOUT_OPERATION].includes(operation)) {
    throw previewIdentityError(
      "Preview identity operation is invalid.",
      "vibe64_preview_identity_operation_invalid"
    );
  }
  const email = String(source.email || "").trim().toLowerCase();
  const userId = String(source.userId || "").trim();
  if (operation === PREVIEW_IDENTITY_LOGIN_OPERATION) {
    if (!email && !userId) {
      throw previewIdentityError(
        "Preview identity requires a user id or email.",
        "vibe64_preview_identity_missing"
      );
    }
    if (email && (!email.includes("@") || email.length > 320)) {
      throw previewIdentityError(
        "Preview identity email is invalid.",
        "vibe64_preview_identity_email_invalid"
      );
    }
    if (userId.length > 256) {
      throw previewIdentityError(
        "Preview identity user id is invalid.",
        "vibe64_preview_identity_user_id_invalid"
      );
    }
  }
  return {
    operation,
    ...(operation === PREVIEW_IDENTITY_LOGIN_OPERATION && email ? { email } : {}),
    ...(operation === PREVIEW_IDENTITY_LOGIN_OPERATION && userId ? { userId } : {})
  };
}

function previewIdentityGrantScope(previewAuth = {}) {
  const scope = {
    projectScope: String(previewAuth.projectScope || "").trim(),
    sessionId: String(previewAuth.sessionId || "").trim(),
    targetHref: String(previewAuth.targetHref || "").trim(),
    targetRoot: String(previewAuth.targetRoot || "").trim(),
    terminalSessionId: String(previewAuth.terminalSessionId || "").trim()
  };
  if (PREVIEW_IDENTITY_GRANT_SCOPE_KEYS.some((key) => !scope[key])) {
    throw previewIdentityError(
      "Preview identity authorization scope is incomplete.",
      "vibe64_preview_identity_scope_incomplete"
    );
  }
  return scope;
}

function previewIdentityGrantSignature(payloadText = "") {
  return crypto
    .createHmac("sha256", PREVIEW_IDENTITY_GRANT_SECRET)
    .update(PREVIEW_IDENTITY_GRANT_PREFIX)
    .update("\0")
    .update(payloadText)
    .digest("base64url");
}

function createPreviewIdentityGrant(previewAuth = {}, selection = {}, {
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = PREVIEW_IDENTITY_GRANT_TTL_SECONDS
} = {}) {
  if (!previewAuthIdentityAvailable(previewAuth)) {
    throw previewIdentityError(
      "This preview does not support identity switching.",
      "vibe64_preview_identity_unsupported"
    );
  }
  const normalizedSelection = normalizePreviewIdentitySelection(selection);
  const normalizedTtlSeconds = Math.min(
    PREVIEW_IDENTITY_GRANT_TTL_SECONDS,
    Math.max(1, Math.floor(Number(ttlSeconds) || PREVIEW_IDENTITY_GRANT_TTL_SECONDS))
  );
  const payloadText = Buffer.from(JSON.stringify({
    expiresAt: nowSeconds + normalizedTtlSeconds,
    issuedAt: nowSeconds,
    nonce: crypto.randomBytes(16).toString("base64url"),
    scope: previewIdentityGrantScope(previewAuth),
    selection: normalizedSelection,
    version: 1
  })).toString("base64url");
  return `${PREVIEW_IDENTITY_GRANT_PREFIX}.${payloadText}.${previewIdentityGrantSignature(payloadText)}`;
}

function verifyPreviewIdentityGrant(grant = "", previewAuth = {}, {
  nowSeconds = Math.floor(Date.now() / 1000)
} = {}) {
  const [prefix, payloadText, signature, extra] = String(grant || "").trim().split(".");
  if (prefix !== PREVIEW_IDENTITY_GRANT_PREFIX || !payloadText || !signature || extra) {
    throw invalidPreviewIdentityGrant();
  }
  const expectedSignature = previewIdentityGrantSignature(payloadText);
  if (!timingSafeTextEqual(signature, expectedSignature)) {
    throw invalidPreviewIdentityGrant();
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch {
    throw invalidPreviewIdentityGrant();
  }
  if (
    payload?.version !== 1 ||
    !payload?.nonce ||
    !samePreviewIdentityGrantScope(payload.scope, previewIdentityGrantScope(previewAuth))
  ) {
    throw previewIdentityError(
      "Preview identity grant does not belong to this preview.",
      "vibe64_preview_identity_grant_scope_mismatch"
    );
  }
  if (
    !Number.isInteger(payload.issuedAt) ||
    !Number.isInteger(payload.expiresAt) ||
    payload.issuedAt > nowSeconds + 5 ||
    payload.expiresAt <= nowSeconds
  ) {
    throw previewIdentityError(
      "Preview identity grant has expired.",
      "vibe64_preview_identity_grant_expired"
    );
  }
  return {
    expiresAt: payload.expiresAt,
    nonce: String(payload.nonce),
    selection: normalizePreviewIdentitySelection(payload.selection)
  };
}

function samePreviewIdentityGrantScope(left = {}, right = {}) {
  return PREVIEW_IDENTITY_GRANT_SCOPE_KEYS.every(
    (key) => String(left?.[key] || "") === String(right?.[key] || "")
  );
}

function timingSafeTextEqual(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function previewIdentityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidPreviewIdentityGrant() {
  return previewIdentityError(
    "Preview identity grant is invalid.",
    "vibe64_preview_identity_grant_invalid"
  );
}

function previewAuthProfilePath({
  sessionRoot = "",
  terminalSessionId = ""
} = {}) {
  return previewAuthRuntimePath({
    filename: "profile.json",
    sessionRoot,
    terminalSessionId
  });
}

function readVibe64SelfPreviewAuthProfile(profilePath = "") {
  return normalizeVibe64SelfPreviewAuthProfile(
    readJsonProfile(profilePath, "Vibe64 self preview auth profile")
  );
}

function previewAuthSecretPath({
  sessionRoot = "",
  terminalSessionId = ""
} = {}) {
  return previewAuthRuntimePath({
    filename: "exchange-secret",
    sessionRoot,
    terminalSessionId
  });
}

function previewAuthRuntimePath({
  filename = "",
  sessionRoot = "",
  terminalSessionId = ""
} = {}) {
  const normalizedSessionRoot = String(sessionRoot || "").trim();
  const normalizedTerminalSessionId = String(terminalSessionId || "").trim();
  const normalizedFilename = String(filename || "").trim();
  return normalizedSessionRoot && normalizedTerminalSessionId && normalizedFilename
    ? path.join(normalizedSessionRoot, "runtime", "preview-auth", normalizedTerminalSessionId, normalizedFilename)
    : "";
}

function readPreviewAuthSecret(secretPath = "") {
  const normalizedPath = String(secretPath || "").trim();
  if (!normalizedPath) {
    return "";
  }
  try {
    return requirePreviewAuthSecret(readFileSync(normalizedPath, "utf8").trim());
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw new Error(`Cannot read preview auth secret: ${String(error?.message || error)}`);
  }
}

function readCookiePreviewAuthProfile(profilePath = "") {
  return normalizeCookiePreviewAuthProfile(
    readJsonProfile(profilePath, "cookie preview auth profile")
  );
}

function readJsonProfile(profilePath = "", label = "profile") {
  const normalizedPath = String(profilePath || "").trim();
  if (!normalizedPath) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(normalizedPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw new Error(`Cannot read ${label}: ${String(error?.message || error)}`);
  }
  return payload;
}

function normalizeVibe64SelfPreviewAuthProfile(value = {}) {
  if (!value) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Vibe64 self preview auth profile must be an object.");
  }
  const profile = {
    cookieName: String(value.cookieName || "").trim(),
    cookieValue: String(value.cookieValue || "").trim()
  };
  if (!profile.cookieName || !profile.cookieValue) {
    throw new Error("Vibe64 self preview auth profile requires cookieName and cookieValue.");
  }
  return profile;
}

function normalizeCookiePreviewAuthProfile(value = {}) {
  if (!value) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cookie preview auth profile must be an object.");
  }
  if (!Array.isArray(value.cookies)) {
    throw new Error("Cookie preview auth profile requires a cookies array.");
  }
  const seenNames = new Set();
  const cookies = value.cookies.map((cookie, index) => {
    const normalizedCookie = normalizeCookiePreviewAuthCookie(cookie, index);
    if (seenNames.has(normalizedCookie.name)) {
      throw new Error(`Cookie preview auth profile contains duplicate cookie name ${normalizedCookie.name}.`);
    }
    seenNames.add(normalizedCookie.name);
    return normalizedCookie;
  });
  if (cookies.length === 0) {
    throw new Error("Cookie preview auth profile requires at least one cookie.");
  }
  return {
    cookies
  };
}

function normalizeCookiePreviewAuthCookie(value = {}, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Cookie preview auth profile cookie ${index + 1} must be an object.`);
  }
  const name = String(value.name || "").trim();
  const cookieValue = String(value.value ?? "").trim();
  if (!COOKIE_NAME_PATTERN.test(name)) {
    throw new Error(`Cookie preview auth profile cookie ${index + 1} has an invalid name.`);
  }
  if (!cookieValue) {
    throw new Error(`Cookie preview auth profile cookie ${index + 1} requires a value.`);
  }
  return {
    name,
    value: cookieValue
  };
}

export {
  COOKIE_PROFILE_PREVIEW_AUTH_KIND,
  JSKIT_PREVIEW_AUTH_KIND,
  PREVIEW_IDENTITY_CONTROL_PATH,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  VIBE64_SELF_PREVIEW_AUTH_KIND,
  createPreviewAuthSecret,
  createPreviewIdentityGrant,
  jskitDevAuthEnvironment,
  normalizePreviewAuthKind,
  normalizePreviewIdentitySelection,
  previewAuthCookieNames,
  previewAuthCookieHeader,
  previewAuthEnvironment,
  previewAuthIdentityAvailable,
  previewAuthIdentityExchange,
  previewAuthRequiresIdentitySecret,
  previewAuthProfilePath,
  previewAuthSecretPath,
  previewAuthUsesProfile,
  readPreviewAuthSecret,
  verifyPreviewIdentityGrant
};
