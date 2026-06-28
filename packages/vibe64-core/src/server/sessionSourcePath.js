import path from "node:path";

import {
  normalizeText
} from "./core.js";

function normalizedSessionPath(value = "") {
  const normalizedValue = normalizeText(value);
  return normalizedValue ? path.resolve(normalizedValue) : "";
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

function explicitSessionSourcePath(session = {}) {
  if (normalizeText(session?.metadata?.source_removed).toLowerCase() === "yes") {
    return "";
  }
  return normalizedSessionPath(
    session.metadata?.source_path ||
    session.metadata?.source ||
    session.source ||
    session.sourcePath
  );
}

function sessionSourcePath(session = {}) {
  return explicitSessionSourcePath(session) ||
    canonicalSessionSourcePath(session);
}

function sessionHasSource(session = {}) {
  return Boolean(
    sessionSourcePath(session) ||
    sessionHasCreatedSource(session)
  );
}

export {
  canonicalSessionSourcePath,
  explicitSessionSourcePath,
  sessionHasCreatedSource,
  sessionHasSource,
  sessionSourcePath
};
