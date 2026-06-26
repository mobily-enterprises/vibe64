const ROUTE_PARAM_PATTERN = /:([A-Za-z][A-Za-z0-9_]*)/gu;

function previewRoutesForTarget(launchTarget = {}) {
  return Array.isArray(launchTarget?.previewRoutes)
    ? launchTarget.previewRoutes.filter((route) => route?.id && route?.pathTemplate)
    : [];
}

function previewRouteParams(route = {}) {
  const declared = new Map(
    (Array.isArray(route.params) ? route.params : [])
      .filter((param) => param?.name)
      .map((param) => [String(param.name), param])
  );
  return [...String(route.pathTemplate || "").matchAll(ROUTE_PARAM_PATTERN)]
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean)
    .map((name) => declared.get(name) || {
      label: routeParamLabel(name),
      name,
      placeholder: name,
      required: true
    });
}

function previewRouteHasParams(route = {}) {
  return previewRouteParams(route).length > 0;
}

function previewRouteInitialFormValues(route = {}) {
  return Object.fromEntries(previewRouteParams(route).map((param) => [
    param.name,
    String(param.defaultValue || "").trim()
  ]));
}

function previewRoutePath(route = {}, values = {}) {
  const pathTemplate = String(route.pathTemplate || "");
  const params = previewRouteParams(route);
  let missingParam = "";
  const path = pathTemplate.replace(ROUTE_PARAM_PATTERN, (match, name) => {
    const param = params.find((candidate) => candidate.name === name);
    const value = String(values?.[name] ?? param?.defaultValue ?? "").trim();
    if (!value && param?.required !== false) {
      missingParam ||= name;
      return match;
    }
    return encodeURIComponent(value);
  });
  return {
    missingParam,
    ok: !missingParam && path.startsWith("/"),
    path
  };
}

function routeParamLabel(name = "") {
  return String(name || "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[-_]+/gu, " ")
    .trim()
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export {
  previewRouteHasParams,
  previewRouteInitialFormValues,
  previewRouteParams,
  previewRoutePath,
  previewRoutesForTarget
};
