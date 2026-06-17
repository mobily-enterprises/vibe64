function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function projectSlugFromPathname(pathname = "") {
  const match = /^\/app\/([^/?#]+)/u.exec(String(pathname || ""));
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
  currentProjectSlugFromLocation,
  vibe64ProjectScopedStorageKey,
  vibe64ProjectQueryScope,
  projectSlugFromPathname,
  projectSlugFromRoute
};
