import path from "node:path";

import {
  normalizeText
} from "./core.js";

function normalizedSessionPath(value = "") {
  const normalizedValue = normalizeText(value);
  return normalizedValue ? path.resolve(normalizedValue) : "";
}

function sessionHasCreatedWorktree(session = {}) {
  return session?.worktreeReady === true ||
    (Array.isArray(session?.completedSteps) && session.completedSteps.includes("worktree_created"));
}

function canonicalSessionWorktreePath(session = {}) {
  const sessionRoot = normalizedSessionPath(session.sessionRoot);
  return sessionRoot && sessionHasCreatedWorktree(session)
    ? path.join(sessionRoot, "worktree")
    : "";
}

function explicitSessionWorktreePath(session = {}) {
  return normalizedSessionPath(
    session.metadata?.worktree_path ||
    session.metadata?.worktree ||
    session.worktree ||
    session.worktreePath
  );
}

function sessionWorktreePath(session = {}) {
  return canonicalSessionWorktreePath(session) || explicitSessionWorktreePath(session);
}

function sessionHasWorktree(session = {}) {
  return Boolean(
    sessionWorktreePath(session) ||
    sessionHasCreatedWorktree(session)
  );
}

export {
  canonicalSessionWorktreePath,
  explicitSessionWorktreePath,
  sessionHasCreatedWorktree,
  sessionHasWorktree,
  sessionWorktreePath
};
