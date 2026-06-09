import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const JSKIT_PREVIEW_AUTH_KIND = "jskit-dev";
const JSKIT_DEV_AUTH_TOKEN_PREFIX = "jskit-dev.";
const JSKIT_DEV_AUTH_ISSUER = "jskit:dev-auth";
const JSKIT_DEV_AUTH_AUDIENCE = "authenticated";
const JSKIT_DEV_AUTH_ACCESS_TTL_SECONDS = 60 * 60;
const JSKIT_DEV_AUTH_REFRESH_TTL_SECONDS = 60 * 60 * 12;
const JSKIT_DEV_ACCESS_COOKIE = "sb_access_token";
const JSKIT_DEV_REFRESH_COOKIE = "sb_refresh_token";
const PREVIEW_AUTH_PROFILE = Object.freeze({
  id: "9007199254740991",
  email: "preview@vibe64.local",
  username: "vibe64-preview",
  displayName: "Vibe64 Preview",
  authProvider: "vibe64-preview",
  authProviderUserSid: "vibe64-preview"
});

function normalizePreviewAuthKind(value = "") {
  return String(value || "").trim() === JSKIT_PREVIEW_AUTH_KIND
    ? JSKIT_PREVIEW_AUTH_KIND
    : "";
}

function previewAuthSecret({
  projectScope = "",
  sessionId = "",
  targetHref = "",
  targetRoot = "",
  terminalSessionId = ""
} = {}) {
  return crypto
    .createHash("sha256")
    .update("vibe64:preview-auth:v1")
    .update("\0")
    .update(String(projectScope || ""))
    .update("\0")
    .update(String(sessionId || ""))
    .update("\0")
    .update(String(terminalSessionId || ""))
    .update("\0")
    .update(String(targetHref || ""))
    .update("\0")
    .update(String(targetRoot || ""))
    .digest("hex");
}

function previewAuthEnvironment({
  kind = "",
  projectScope = "",
  sessionId = "",
  targetHref = "",
  targetRoot = "",
  terminalSessionId = ""
} = {}) {
  if (normalizePreviewAuthKind(kind) !== JSKIT_PREVIEW_AUTH_KIND) {
    return {};
  }
  return {
    AUTH_DEV_BYPASS_ENABLED: "true",
    AUTH_DEV_BYPASS_SECRET: previewAuthSecret({
      projectScope,
      sessionId,
      targetHref,
      targetRoot,
      terminalSessionId
    }),
    AUTH_DEV_ACCESS_TTL_SECONDS: String(JSKIT_DEV_AUTH_ACCESS_TTL_SECONDS),
    AUTH_DEV_REFRESH_TTL_SECONDS: String(JSKIT_DEV_AUTH_REFRESH_TTL_SECONDS)
  };
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
  if (normalizePreviewAuthKind(kind) !== JSKIT_PREVIEW_AUTH_KIND) {
    return "";
  }
  const secret = previewAuthSecret({
    projectScope,
    sessionId,
    targetHref,
    targetRoot,
    terminalSessionId
  });
  const session = createJskitDevAuthSession({
    profile: readPreviewAuthProfile(profilePath) || PREVIEW_AUTH_PROFILE,
    secret
  });
  return [
    `${JSKIT_DEV_ACCESS_COOKIE}=${encodeURIComponent(session.accessToken)}`,
    `${JSKIT_DEV_REFRESH_COOKIE}=${encodeURIComponent(session.refreshToken)}`
  ].join("; ");
}

function createJskitDevAuthSession({
  nowSeconds = Math.floor(Date.now() / 1000),
  profile = PREVIEW_AUTH_PROFILE,
  secret = ""
} = {}) {
  return {
    accessToken: signJskitDevAuthToken("access", profile, {
      expiresAtSeconds: nowSeconds + JSKIT_DEV_AUTH_ACCESS_TTL_SECONDS,
      issuedAtSeconds: nowSeconds,
      secret
    }),
    refreshToken: signJskitDevAuthToken("refresh", profile, {
      expiresAtSeconds: nowSeconds + JSKIT_DEV_AUTH_REFRESH_TTL_SECONDS,
      issuedAtSeconds: nowSeconds,
      secret
    })
  };
}

function signJskitDevAuthToken(kind, profile, {
  expiresAtSeconds,
  issuedAtSeconds,
  secret = ""
} = {}) {
  const header = base64urlJson({
    alg: "HS256",
    typ: "JWT"
  });
  const payload = base64urlJson({
    kind,
    email: String(profile.email || "").trim().toLowerCase(),
    displayName: String(profile.displayName || "").trim(),
    username: String(profile.username || "").trim().toLowerCase(),
    authProvider: String(profile.authProvider || "dev").trim().toLowerCase(),
    authProviderUserSid: String(profile.authProviderUserSid || profile.id || "").trim(),
    iss: JSKIT_DEV_AUTH_ISSUER,
    aud: JSKIT_DEV_AUTH_AUDIENCE,
    sub: String(profile.id || "").trim(),
    iat: issuedAtSeconds,
    exp: expiresAtSeconds
  });
  const body = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", String(secret || ""))
    .update(body)
    .digest("base64url");
  return `${JSKIT_DEV_AUTH_TOKEN_PREFIX}${body}.${signature}`;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function previewAuthProfilePath({
  sessionRoot = "",
  targetRoot = "",
  sessionId = "",
  terminalSessionId = ""
} = {}) {
  const normalizedTerminalSessionId = String(terminalSessionId || "").trim();
  if (!normalizedTerminalSessionId) {
    return "";
  }
  const normalizedSessionRoot = String(sessionRoot || "").trim();
  const normalizedTargetRoot = String(targetRoot || "").trim();
  const normalizedSessionId = String(sessionId || "").trim();
  const root = normalizedSessionRoot || (normalizedTargetRoot && normalizedSessionId
    ? path.join(normalizedTargetRoot, ".vibe64", "sessions", "active", normalizedSessionId)
    : "");
  if (!root) {
    return "";
  }
  return path.join(root, "runtime", "preview-auth", normalizedTerminalSessionId, "profile.json");
}

function readPreviewAuthProfile(profilePath = "") {
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
    throw new Error(`Cannot read preview auth profile: ${String(error?.message || error)}`);
  }
  return normalizePreviewAuthProfile(payload);
}

function normalizePreviewAuthProfile(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Preview auth profile must be an object.");
  }
  const profile = {
    id: String(value.id || "").trim(),
    email: String(value.email || "").trim().toLowerCase(),
    username: String(value.username || PREVIEW_AUTH_PROFILE.username).trim().toLowerCase(),
    displayName: String(value.displayName || value.display_name || PREVIEW_AUTH_PROFILE.displayName).trim(),
    authProvider: String(value.authProvider || value.auth_provider || PREVIEW_AUTH_PROFILE.authProvider).trim().toLowerCase(),
    authProviderUserSid: String(
      value.authProviderUserSid ||
      value.auth_provider_user_sid ||
      PREVIEW_AUTH_PROFILE.authProviderUserSid
    ).trim()
  };
  if (!profile.id || !profile.email) {
    throw new Error("Preview auth profile requires id and email.");
  }
  return profile;
}

export {
  JSKIT_PREVIEW_AUTH_KIND,
  PREVIEW_AUTH_PROFILE,
  normalizePreviewAuthKind,
  previewAuthCookieHeader,
  previewAuthEnvironment,
  previewAuthProfilePath,
  previewAuthSecret
};
