function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function workspaceSlugFromPathname(pathname = "") {
  const match = /^\/app\/([^/?#]+)/u.exec(String(pathname || ""));
  const slug = decodeURIComponent(match?.[1] || "").trim();
  return slug && slug !== "manage" ? slug : "";
}

function currentWorkspaceSlugFromLocation(browserWindow = globalThis.window) {
  return workspaceSlugFromPathname(browserWindow?.location?.pathname || "");
}

function workspaceSlugFromRoute(route = {}) {
  return firstRouteParam(route?.params?.slug) || currentWorkspaceSlugFromLocation();
}

function workspaceScopeValue(slug = currentWorkspaceSlugFromLocation()) {
  return String(slug || "").trim() || "unscoped";
}

function vibe64WorkspaceQueryScope(slug = currentWorkspaceSlugFromLocation()) {
  return [
    "workspace",
    workspaceScopeValue(slug)
  ];
}

function vibe64ScopedStorageKey(baseKey = "", slug = currentWorkspaceSlugFromLocation()) {
  const normalizedBaseKey = String(baseKey || "").trim();
  if (!normalizedBaseKey) {
    return "";
  }
  return `${normalizedBaseKey}:workspace:${encodeURIComponent(workspaceScopeValue(slug))}`;
}

export {
  currentWorkspaceSlugFromLocation,
  vibe64ScopedStorageKey,
  vibe64WorkspaceQueryScope,
  workspaceSlugFromPathname,
  workspaceSlugFromRoute
};
