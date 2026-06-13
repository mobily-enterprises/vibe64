import crypto from "node:crypto";
import path from "node:path";

const VIBE64_AUTH_COOKIE_NAME = "vibe64_session";
const VIBE64_AUTH_COOKIE_NAME_PREFIX = "vibe64_session_";

function normalizeVibe64RuntimeNamespace(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function scopedVibe64AuthCookieName(scope = "") {
  const normalizedScope = String(scope || "").trim();
  if (!normalizedScope) {
    return VIBE64_AUTH_COOKIE_NAME;
  }
  const digest = crypto
    .createHash("sha256")
    .update(normalizedScope)
    .digest("hex")
    .slice(0, 16);
  return `${VIBE64_AUTH_COOKIE_NAME_PREFIX}${digest}`;
}

function vibe64AuthCookieNameForRuntime({
  runtimeNamespace = "",
  systemRoot = ""
} = {}) {
  const namespace = normalizeVibe64RuntimeNamespace(runtimeNamespace);
  return namespace
    ? scopedVibe64AuthCookieName(`${namespace}:${path.resolve(systemRoot || "")}`)
    : scopedVibe64AuthCookieName("");
}

export {
  VIBE64_AUTH_COOKIE_NAME,
  VIBE64_AUTH_COOKIE_NAME_PREFIX,
  normalizeVibe64RuntimeNamespace,
  scopedVibe64AuthCookieName,
  vibe64AuthCookieNameForRuntime
};
