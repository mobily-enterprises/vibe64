function normalizeRoutePath(pathValue = "") {
  const path = String(pathValue || "").trim();
  if (!path || path === "/") {
    return path || "/";
  }
  return path.replace(/\/+$/u, "");
}

function routePathContainsSection(routePathValue = "", sectionPathValue = "") {
  const routePath = normalizeRoutePath(routePathValue);
  const sectionPath = normalizeRoutePath(sectionPathValue);
  return Boolean(
    sectionPath &&
    sectionPath !== "/" &&
    (
      routePath === sectionPath ||
      routePath.startsWith(`${sectionPath}/`)
    )
  );
}

export {
  normalizeRoutePath,
  routePathContainsSection
};
