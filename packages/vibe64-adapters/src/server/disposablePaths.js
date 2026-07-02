import {
  normalizeText
} from "@local/vibe64-core/server/core";

function normalizeDisposablePath(value = "") {
  return normalizeText(value).replaceAll("\\", "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
}

function normalizeDisposablePaths(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(normalizeDisposablePath)
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function wildcardPatternMatches(pattern = "", value = "") {
  if (!pattern.includes("*")) {
    return false;
  }
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "u").test(value);
}

function relativePathIsDisposable(relativePath = "", disposablePaths = []) {
  const normalizedPath = normalizeDisposablePath(relativePath);
  if (!normalizedPath) {
    return true;
  }
  const segments = normalizedPath.split("/");
  return disposablePaths.some((entry) => {
    const pattern = normalizeDisposablePath(entry);
    if (!pattern) {
      return false;
    }
    if (wildcardPatternMatches(pattern, normalizedPath)) {
      return true;
    }
    if (!pattern.includes("/") && segments.some((segment) => {
      return segment === pattern || wildcardPatternMatches(pattern, segment);
    })) {
      return true;
    }
    return normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`);
  });
}

export {
  normalizeDisposablePath,
  normalizeDisposablePaths,
  relativePathIsDisposable,
  wildcardPatternMatches
};
