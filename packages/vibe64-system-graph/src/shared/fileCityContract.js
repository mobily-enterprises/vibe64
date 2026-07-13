const FILE_CITY_PLACEMENT_ROLES = Object.freeze([
  "boundary",
  "primary",
  "supporting"
]);

const FILE_CITY_ROUTE_SEGMENT_KINDS = Object.freeze([
  "catch-all",
  "dynamic",
  "index",
  "intercepted",
  "optional",
  "optional-catch-all",
  "parallel",
  "pathless",
  "root",
  "static"
]);

const FILE_CITY_ROUTE_URL_EFFECTS = Object.freeze([
  "intercepted",
  "parallel",
  "root",
  "segment",
  "transparent"
]);

function normalizeFileCityPath(value = "") {
  return String(value || "")
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/")
    .replace(/\/+$/u, "");
}

function isSafeFileCityPath(value = "") {
  const normalized = normalizeFileCityPath(value);
  return Boolean(normalized) &&
    !normalized.startsWith("/") &&
    !normalized.split("/").includes("..");
}

function fileCityPathInside(rootPath = "", candidatePath = "") {
  const root = normalizeFileCityPath(rootPath);
  const candidate = normalizeFileCityPath(candidatePath);
  if (!candidate) {
    return false;
  }
  return !root || candidate === root || candidate.startsWith(`${root}/`);
}

export {
  FILE_CITY_PLACEMENT_ROLES,
  FILE_CITY_ROUTE_SEGMENT_KINDS,
  FILE_CITY_ROUTE_URL_EFFECTS,
  fileCityPathInside,
  isSafeFileCityPath,
  normalizeFileCityPath
};
