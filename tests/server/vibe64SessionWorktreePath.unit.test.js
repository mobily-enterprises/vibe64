import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  canonicalSessionWorktreePath,
  explicitSessionWorktreePath,
  sessionHasWorktree,
  sessionWorktreePath
} from "@local/vibe64-core/server/sessionWorktreePath";

test("session worktree path prefers the canonical session-root worktree after creation", () => {
  const sessionRoot = "/workspace/app/.vibe64/sessions/active/session-1";
  const staleMetadataPath = "/old/app/.vibe64/sessions/active/session-1/worktree";
  const session = {
    completedSteps: ["session_created", "worktree_created"],
    metadata: {
      worktree_path: staleMetadataPath
    },
    sessionRoot
  };

  assert.equal(explicitSessionWorktreePath(session), staleMetadataPath);
  assert.equal(canonicalSessionWorktreePath(session), path.join(sessionRoot, "worktree"));
  assert.equal(sessionWorktreePath(session), path.join(sessionRoot, "worktree"));
  assert.equal(sessionHasWorktree(session), true);
});

test("session worktree path keeps explicit metadata before canonical creation state exists", () => {
  const metadataPath = "/workspace/app/.vibe64/sessions/active/session-1/worktree";
  const session = {
    metadata: {
      worktree_path: metadataPath
    },
    sessionRoot: "/workspace/app/.vibe64/sessions/active/session-1"
  };

  assert.equal(sessionWorktreePath(session), metadataPath);
  assert.equal(sessionHasWorktree(session), true);
});
