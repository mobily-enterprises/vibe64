import {
  normalizeText
} from "@local/vibe64-core/server/core";

function sessionWorktreePath(session = {}) {
  return normalizeText(
    session.metadata?.worktree_path ||
    session.metadata?.worktree ||
    session.worktree ||
    session.worktreePath
  );
}

function sessionHasWorktree(session = {}) {
  return Boolean(
    sessionWorktreePath(session) ||
    session.worktreeReady === true ||
    (Array.isArray(session.completedSteps) && session.completedSteps.includes("worktree_created"))
  );
}

export {
  sessionHasWorktree,
  sessionWorktreePath
};
