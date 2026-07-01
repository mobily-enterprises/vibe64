function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

const VIBE64_PROJECT_APP_PATH_PREFIX = "/app/project";

function normalizedProjectRouteSuffix(suffix = "") {
  const normalized = String(suffix || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeProjectRoutePath(path = "") {
  const normalized = String(path || "").trim();
  if (!normalized || normalized === "/") {
    return "/";
  }
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const compacted = withLeadingSlash.replace(/\/{2,}/gu, "/");
  if (compacted === "/") {
    return "/";
  }
  return compacted.replace(/\/+$/u, "") || "/";
}

function projectAppPath(slug = "", suffix = "") {
  const projectSlug = String(slug || "").trim();
  if (!projectSlug) {
    return "/app";
  }
  return `${VIBE64_PROJECT_APP_PATH_PREFIX}/${encodeURIComponent(projectSlug)}${normalizedProjectRouteSuffix(suffix)}`;
}

function projectSlugFromPathname(pathname = "") {
  const match = /^\/app\/project\/([^/?#]+)/u.exec(String(pathname || ""));
  const slug = decodeURIComponent(match?.[1] || "").trim();
  return slug || "";
}

function currentProjectSlugFromLocation(browserWindow = globalThis.window) {
  return projectSlugFromPathname(browserWindow?.location?.pathname || "");
}

function projectSlugFromRoute(route = {}) {
  return firstRouteParam(route?.params?.slug) || currentProjectSlugFromLocation();
}

function projectScopeValue(slug = currentProjectSlugFromLocation()) {
  return String(slug || "").trim() || "unscoped";
}

function vibe64ProjectQueryScope(slug = currentProjectSlugFromLocation()) {
  return [
    "project",
    projectScopeValue(slug)
  ];
}

function vibe64ProjectScopedStorageKey(baseKey = "", slug = currentProjectSlugFromLocation()) {
  const normalizedBaseKey = String(baseKey || "").trim();
  if (!normalizedBaseKey) {
    return "";
  }
  return `${normalizedBaseKey}:project:${encodeURIComponent(projectScopeValue(slug))}`;
}

export {
  VIBE64_PROJECT_APP_PATH_PREFIX,
  currentProjectSlugFromLocation,
  normalizeProjectRoutePath,
  projectAppPath,
  vibe64ProjectScopedStorageKey,
  vibe64ProjectQueryScope,
  projectSlugFromPathname,
  projectSlugFromRoute
};
