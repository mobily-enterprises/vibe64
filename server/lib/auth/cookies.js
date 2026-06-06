const AUTH_COOKIE_NAME = "vibe64_session";

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

function serializeAuthCookie(value, options = {}) {
  return serializeCookie(AUTH_COOKIE_NAME, value, options);
}

function serializeClearedAuthCookie(options = {}) {
  return serializeAuthCookie("", {
    ...options,
    maxAge: 0
  });
}

function authCookieValue(request = {}) {
  return parseCookies(request.headers?.cookie || "")[AUTH_COOKIE_NAME] || "";
}

export {
  AUTH_COOKIE_NAME,
  authCookieValue,
  parseCookies,
  serializeAuthCookie,
  serializeClearedAuthCookie,
  serializeCookie
};
