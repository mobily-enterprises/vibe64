const FILE_CITY_PLACEMENT_ROLES = Object.freeze([
  "boundary",
  "primary",
  "supporting"
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
  fileCityPathInside,
  isSafeFileCityPath,
  normalizeFileCityPath
};
