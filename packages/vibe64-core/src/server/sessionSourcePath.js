import path from "node:path";

import {
  normalizeText
} from "./core.js";

const SESSION_SOURCE_PATH_AUTHORITY_MANAGED = "managed_session_source";

function normalizedSessionPath(value = "") {
  const normalizedValue = normalizeText(value);
  return normalizedValue ? path.resolve(normalizedValue) : "";
}

function pathInsideOrEqual(parentPath = "", childPath = "") {
  const parent = normalizedSessionPath(parentPath);
  const child = normalizedSessionPath(childPath);
  if (!parent || !child) {
    return false;
  }
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function targetSessionSourcePath(targetRoot = "", sessionId = "") {
  const normalizedTargetRoot = normalizedSessionPath(targetRoot);
  const normalizedSessionId = normalizeText(sessionId);
  return normalizedTargetRoot && normalizedSessionId
    ? path.join(normalizedTargetRoot, "sessions", "active", normalizedSessionId, "source")
    : "";
}

function explicitPathIsLocalSourceRoot(session = {}, explicitPath = "") {
  const targetRoot = normalizedSessionPath(session.targetRoot);
  if (!targetRoot || explicitPath !== targetRoot) {
    return false;
  }
  const sessionRoot = normalizedSessionPath(session.sessionRoot);
  return !sessionRoot ||
    (!pathInsideOrEqual(targetRoot, sessionRoot) && !pathInsideOrEqual(sessionRoot, targetRoot));
}

function explicitPathIsManagedSessionSource(session = {}, explicitPath = "") {
  if (normalizeText(session?.metadata?.source_path_authority) !== SESSION_SOURCE_PATH_AUTHORITY_MANAGED) {
    return false;
  }
  if (normalizeText(session?.metadata?.source_kind) !== "session_clone") {
    return false;
  }
  const normalizedPath = normalizedSessionPath(explicitPath);
  const sessionId = normalizeText(session.sessionId || session.id);
  if (!normalizedPath || !sessionId) {
    return false;
  }
  const sessionRoot = normalizedSessionPath(session.sessionRoot);
  if (sessionRoot && pathInsideOrEqual(sessionRoot, normalizedPath)) {
    return false;
  }
  return path.basename(normalizedPath) === "source" &&
    path.basename(path.dirname(normalizedPath)) === sessionId &&
    path.basename(path.dirname(path.dirname(normalizedPath))) === "active" &&
    path.basename(path.dirname(path.dirname(path.dirname(normalizedPath)))) === "sessions";
}

function explicitSessionSourcePath(session = {}) {
  if (normalizeText(session?.metadata?.source_removed).toLowerCase() === "yes") {
    return "";
  }
  const explicitPath = normalizedSessionPath(
    session.metadata?.source_path ||
    session.metadata?.source ||
    session.source ||
    session.sourcePath
  );
  if (!explicitPath) {
    return "";
  }
  if (explicitPathIsLocalSourceRoot(session, explicitPath)) {
    return explicitPath;
  }
  if (explicitPathIsManagedSessionSource(session, explicitPath)) {
    return explicitPath;
  }
  return "";
}

function sessionSourcePath(session = {}) {
  return explicitSessionSourcePath(session);
}

function sessionHasSource(session = {}) {
  return Boolean(sessionSourcePath(session));
}

export {
  explicitPathIsLocalSourceRoot,
  explicitPathIsManagedSessionSource,
  explicitSessionSourcePath,
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
  sessionHasSource,
  sessionSourcePath,
  targetSessionSourcePath
};
