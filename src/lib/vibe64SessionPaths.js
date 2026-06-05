function sessionHasCreatedWorktree(session = {}) {
  return session?.worktreeReady === true ||
    (Array.isArray(session?.completedSteps) && session.completedSteps.includes("worktree_created"));
}

function canonicalSessionWorktreePath(session = {}) {
  const sessionRoot = String(session?.sessionRoot || "").trim().replace(/\/+$/u, "");
  return sessionRoot && sessionHasCreatedWorktree(session) ? `${sessionRoot}/worktree` : "";
}

function vibe64SessionWorktreePath(session = {}) {
  const metadata = session?.metadata || {};
  const explicitPath = String(
    metadata.worktree_path ||
    metadata.worktree ||
    session?.worktree ||
    session?.worktreePath ||
    ""
  ).trim();
  return canonicalSessionWorktreePath(session) || explicitPath;
}

export {
  canonicalSessionWorktreePath,
  vibe64SessionWorktreePath
};
