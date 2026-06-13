import {
  VIBE64_AUTH_COOKIE_NAME as AUTH_COOKIE_NAME,
  scopedVibe64AuthCookieName
} from "@local/vibe64-core/server/authCookies";

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    cookies[name] = decodeCookieValue(value);
  }
  return cookies;
}

function decodeCookieValue(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function serializeCookie(name, value, {
  httpOnly = true,
  maxAge = null,
  path = "/",
  sameSite = "Lax",
  secure = false
} = {}) {
  const parts = [
    `${name}=${encodeURIComponent(String(value || ""))}`,
    `Path=${path}`,
    `SameSite=${sameSite}`
  ];
  if (Number.isInteger(maxAge)) {
    parts.push(`Max-Age=${maxAge}`);
  }
  if (httpOnly) {
    parts.push("HttpOnly");
  }
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function scopedAuthCookieName(scope = "") {
  return scopedVibe64AuthCookieName(scope);
}

function serializeAuthCookie(value, options = {}) {
  return serializeCookie(authCookieName(options), value, options);
}

function serializeClearedAuthCookie(options = {}) {
  return serializeAuthCookie("", {
    ...options,
    maxAge: 0
  });
}

function authCookieName(options = {}) {
  return String(options.cookieName || "").trim() || AUTH_COOKIE_NAME;
}

function authCookieValue(request = {}, options = {}) {
  const cookies = parseCookies(request.headers?.cookie || "");
  return cookies[authCookieName(options)] || "";
}

export {
  AUTH_COOKIE_NAME,
  authCookieValue,
  scopedAuthCookieName,
  parseCookies,
  serializeAuthCookie,
  serializeClearedAuthCookie,
  serializeCookie
};
