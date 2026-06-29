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
  return `${sessionRoot}/source`;
}

function expectedSessionSourcePath(session = {}) {
  const sessionRoot = String(session?.sessionRoot || "").trim().replace(/\/+$/u, "");
  return sessionRoot ? `${sessionRoot}/source` : "";
}

function pathInsideOrEqual(parentPath = "", childPath = "") {
  const parent = String(parentPath || "").trim().replace(/\/+$/u, "");
  const child = String(childPath || "").trim().replace(/\/+$/u, "");
  return Boolean(parent && child && (child === parent || child.startsWith(`${parent}/`)));
}

function explicitPathIsLocalSourceRoot(session = {}, explicitPath = "") {
  const targetRoot = String(session?.targetRoot || "").trim().replace(/\/+$/u, "");
  if (!targetRoot || explicitPath !== targetRoot) {
    return false;
  }
  const sessionRoot = String(session?.sessionRoot || "").trim().replace(/\/+$/u, "");
  return !sessionRoot || !pathInsideOrEqual(targetRoot, sessionRoot);
}

function explicitSessionSourcePath(session = {}) {
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
  ).trim().replace(/\/+$/u, "");
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

function vibe64SessionSourcePath(session = {}) {
  return explicitSessionSourcePath(session) || canonicalSessionSourcePath(session);
}

export {
  canonicalSessionSourcePath,
  expectedSessionSourcePath,
  explicitPathIsLocalSourceRoot,
  explicitSessionSourcePath,
  vibe64SessionSourcePath
};
