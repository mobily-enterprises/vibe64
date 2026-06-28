function sessionHasCreatedSource(session = {}) {
  if (String(session?.metadata?.source_removed || "").trim().toLowerCase() === "yes") {
    return false;
  }
  return session?.sourceReady === true ||
    (Array.isArray(session?.completedSteps) && session.completedSteps.includes("source_created"));
}

function canonicalSessionSourcePath(session = {}) {
  const sessionRoot = String(session?.sessionRoot || "").trim().replace(/\/+$/u, "");
  if (!sessionRoot || !sessionHasCreatedSource(session)) {
    return "";
  }
  if (Array.isArray(session?.completedSteps) && session.completedSteps.includes("source_created")) {
    return `${sessionRoot}/source`;
  }
  return `${sessionRoot}/source`;
}

function vibe64SessionSourcePath(session = {}) {
  const metadata = session?.metadata || {};
  if (String(metadata.source_removed || "").trim().toLowerCase() === "yes") {
    return "";
  }
  const explicitPath = String(
    metadata.source_path ||
    metadata.source ||
    session?.source ||
    session?.sourcePath ||
    ""
  ).trim();
  return explicitPath || canonicalSessionSourcePath(session);
}

export {
  canonicalSessionSourcePath,
  vibe64SessionSourcePath
};
