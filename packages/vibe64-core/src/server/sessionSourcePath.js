import path from "node:path";

import {
  normalizeText
} from "./core.js";

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

function activeSessionSourcePath(projectRuntimeRoot = "", sessionId = "") {
  const normalizedRuntimeRoot = normalizedSessionPath(projectRuntimeRoot);
  const normalizedSessionId = normalizeText(sessionId);
  return normalizedRuntimeRoot && normalizedSessionId
    ? path.join(normalizedRuntimeRoot, "sessions", "active", normalizedSessionId, "source")
    : "";
}

function sessionHasCreatedSource(session = {}) {
  if (normalizeText(session?.metadata?.source_removed).toLowerCase() === "yes") {
    return false;
  }
  return session?.sourceReady === true ||
    (Array.isArray(session?.completedSteps) && session.completedSteps.includes("source_created"));
}

function canonicalSessionSourcePath(session = {}) {
  const sessionRoot = normalizedSessionPath(session.sessionRoot);
  if (!sessionRoot || !sessionHasCreatedSource(session)) {
    return "";
  }
  return path.join(sessionRoot, "source");
}

function expectedSessionSourcePath(session = {}) {
  const sessionRoot = normalizedSessionPath(session.sessionRoot);
  return sessionRoot ? path.join(sessionRoot, "source") : "";
}

function explicitPathIsLocalSourceRoot(session = {}, explicitPath = "") {
  const targetRoot = normalizedSessionPath(session.targetRoot);
  if (!targetRoot || explicitPath !== targetRoot) {
    return false;
  }
  const sessionRoot = normalizedSessionPath(session.sessionRoot);
  return !sessionRoot || !pathInsideOrEqual(targetRoot, sessionRoot);
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
  const expectedPath = expectedSessionSourcePath(session);
  if (!expectedPath) {
    return explicitPath;
  }
  if (explicitPath === expectedPath) {
    return explicitPath;
  }
  return explicitPathIsLocalSourceRoot(session, explicitPath) ? explicitPath : "";
}

function sessionSourcePath(session = {}) {
  return explicitSessionSourcePath(session) ||
    canonicalSessionSourcePath(session);
}

function containedSessionSourcePath(session = {}, {
  projectRuntimeRoot = "",
  sessionId = ""
} = {}) {
  const normalizedRuntimeRoot = normalizedSessionPath(projectRuntimeRoot);
  const normalizedSessionId = normalizeText(sessionId || session?.sessionId || session?.id);
  if (!normalizedRuntimeRoot || !normalizedSessionId) {
    return "";
  }
  const expectedSessionRoot = path.join(normalizedRuntimeRoot, "sessions", "active", normalizedSessionId);
  const expectedSourcePath = activeSessionSourcePath(normalizedRuntimeRoot, normalizedSessionId);
  const sessionRoot = normalizedSessionPath(session?.sessionRoot) || expectedSessionRoot;
  if (!pathInsideOrEqual(expectedSessionRoot, sessionRoot) || sessionRoot !== expectedSessionRoot) {
    return "";
  }
  const sourcePath = sessionSourcePath(session) || expectedSourcePath;
  if (sourcePath !== expectedSourcePath) {
    return "";
  }
  return sourcePath;
}

function sessionHasSource(session = {}) {
  return Boolean(
    sessionSourcePath(session) ||
    sessionHasCreatedSource(session)
  );
}

export {
  activeSessionSourcePath,
  canonicalSessionSourcePath,
  containedSessionSourcePath,
  expectedSessionSourcePath,
  explicitPathIsLocalSourceRoot,
  explicitSessionSourcePath,
  sessionHasCreatedSource,
  sessionHasSource,
  sessionSourcePath
};
