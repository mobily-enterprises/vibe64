import path from "node:path";

import { pathInsideOrEqual } from "./core.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const SESSION_SOURCE_PATH_AUTHORITY_MANAGED = "managed_session_source";

function normalizedSessionPath(value = "") {
  const normalizedValue = toText(value);
  return normalizedValue ? path.resolve(normalizedValue) : "";
}

function managedSessionSourcePath(managedSessionSourceRoot = "", sessionId = "") {
  const normalizedManagedSessionSourceRoot = normalizedSessionPath(managedSessionSourceRoot);
  const normalizedSessionId = toText(sessionId);
  return normalizedManagedSessionSourceRoot && normalizedSessionId
    ? path.join(normalizedManagedSessionSourceRoot, "sessions", "active", normalizedSessionId, "source")
    : "";
}

function explicitPathIsManagedSessionSource(session = {}, explicitPath = "") {
  if (toText(session.metadata?.source_path_authority) !== SESSION_SOURCE_PATH_AUTHORITY_MANAGED) {
    return false;
  }
  if (toText(session.metadata?.source_kind) !== "session_clone") {
    return false;
  }
  const normalizedPath = normalizedSessionPath(explicitPath);
  const sessionId = toText(session.sessionId);
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
  if (toText(session.metadata?.source_removed).toLowerCase() === "yes") {
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
  return explicitPathIsManagedSessionSource(session, explicitPath) ? explicitPath : "";
}

function sessionSourcePath(session = {}) {
  return explicitSessionSourcePath(session);
}

function sessionHasSource(session = {}) {
  return Boolean(sessionSourcePath(session));
}

const __testables = Object.freeze({ explicitSessionSourcePath });

export {
  explicitPathIsManagedSessionSource,
  managedSessionSourcePath,
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
  sessionHasSource,
  sessionSourcePath,
  __testables
};
