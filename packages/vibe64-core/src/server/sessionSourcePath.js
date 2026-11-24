import { createHash } from "node:crypto";
import os from "node:os";
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

// A session's temporary folder is `v64s-` and 12 hex digits of its session
// folder's path, in the editor's own temporary folder: short whatever the
// workspace, project and session are named, so a Unix socket a command makes
// below it fits the 107 bytes a socket's path holds. The host helper accepts
// only this name, directly in the workspace's temporary folder.
const SESSION_TEMP_FOLDER_PREFIX = "v64s-";
const SESSION_TEMP_FOLDER_KEY_LENGTH = 12;

/** The folder that holds sessions' temporary folders: the editor's own TMPDIR. */
function sessionTempRoot() {
  return path.resolve(os.tmpdir());
}

/**
 * The session's own temporary folder (`<TMPDIR>/v64s-<key>`, the key from its
 * session folder, `sessions/active/<id>`): the TMPDIR of its AI's commands,
 * where the AI's Git runs plain local Git. Archive and renewal remove it.
 * @param {string} sourcePath the session's managed source
 */
function sessionTempPath(sourcePath = "") {
  const normalizedSourcePath = normalizedSessionPath(sourcePath);
  if (!normalizedSourcePath) return "";
  const key = createHash("sha256").update(path.dirname(normalizedSourcePath)).digest("hex")
    .slice(0, SESSION_TEMP_FOLDER_KEY_LENGTH);
  return path.join(sessionTempRoot(), `${SESSION_TEMP_FOLDER_PREFIX}${key}`);
}

const __testables = Object.freeze({ explicitSessionSourcePath });

export {
  explicitPathIsManagedSessionSource,
  managedSessionSourcePath,
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
  SESSION_TEMP_FOLDER_KEY_LENGTH,
  SESSION_TEMP_FOLDER_PREFIX,
  sessionHasSource,
  sessionSourcePath,
  sessionTempPath,
  sessionTempRoot,
  __testables
};
