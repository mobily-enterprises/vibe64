import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  activeSessionSourcePath,
  canonicalSessionSourcePath,
  expectedSessionSourcePath,
  explicitPathIsLocalSourceRoot,
  explicitSessionSourcePath,
  sessionHasSource,
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";

test("active session source path is rooted in the project runtime bucket", () => {
  assert.equal(
    activeSessionSourcePath("/runtime/projects/catalog", "seed-session"),
    "/runtime/projects/catalog/sessions/active/seed-session/source"
  );
});

test("session source path accepts explicit source metadata that matches the session root", () => {
  const sessionRoot = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1";
  const sourcePath = path.join(sessionRoot, "source");
  const session = {
    completedSteps: ["session_created", "source_created"],
    metadata: {
      source_path: sourcePath
    },
    sessionRoot
  };

  assert.equal(expectedSessionSourcePath(session), sourcePath);
  assert.equal(explicitSessionSourcePath(session), sourcePath);
  assert.equal(canonicalSessionSourcePath(session), sourcePath);
  assert.equal(sessionSourcePath(session), sourcePath);
  assert.equal(sessionHasSource(session), true);
});

test("session source path ignores stale explicit metadata outside the session root", () => {
  const sessionRoot = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1";
  const sourcePath = path.join(sessionRoot, "source");
  const session = {
    completedSteps: ["session_created", "source_created"],
    metadata: {
      source_path: "/old-workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1/source"
    },
    sessionRoot
  };

  assert.equal(explicitSessionSourcePath(session), "");
  assert.equal(canonicalSessionSourcePath(session), sourcePath);
  assert.equal(sessionSourcePath(session), sourcePath);
  assert.equal(sessionHasSource(session), true);
});

test("session source path accepts local direct source metadata outside the session runtime bucket", () => {
  const sourceRoot = "/workspace/app";
  const sessionRoot = "/home/user/.local/share/vibe64-local-editor/state/projects/app-test/sessions/active/session-1";
  const session = {
    metadata: {
      source_path: sourceRoot
    },
    sessionRoot,
    targetRoot: sourceRoot
  };

  assert.equal(explicitPathIsLocalSourceRoot(session, sourceRoot), true);
  assert.equal(explicitSessionSourcePath(session), sourceRoot);
  assert.equal(sessionSourcePath(session), sourceRoot);
  assert.equal(sessionHasSource(session), true);
});

test("session source path rejects targetRoot metadata when the session root is inside it", () => {
  const targetRoot = "/srv/vibe64/tenants/merc/projects/app";
  const session = {
    completedSteps: ["session_created", "source_created"],
    metadata: {
      source_path: targetRoot
    },
    sessionRoot: path.join(targetRoot, "sessions", "active", "session-1"),
    targetRoot
  };

  assert.equal(explicitPathIsLocalSourceRoot(session, targetRoot), false);
  assert.equal(explicitSessionSourcePath(session), "");
  assert.equal(sessionSourcePath(session), path.join(targetRoot, "sessions", "active", "session-1", "source"));
});

test("session source path uses source directory after source creation", () => {
  const sessionRoot = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1";
  const session = {
    completedSteps: ["session_created", "source_created"],
    metadata: {},
    sessionRoot
  };

  assert.equal(canonicalSessionSourcePath(session), path.join(sessionRoot, "source"));
  assert.equal(sessionSourcePath(session), path.join(sessionRoot, "source"));
  assert.equal(sessionHasSource(session), true);
});

test("session source path keeps explicit metadata before canonical creation state exists", () => {
  const metadataPath = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1/source";
  const session = {
    metadata: {
      source_path: metadataPath
    },
    sessionRoot: "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1"
  };

  assert.equal(explicitSessionSourcePath(session), metadataPath);
  assert.equal(canonicalSessionSourcePath(session), "");
  assert.equal(sessionSourcePath(session), metadataPath);
  assert.equal(sessionHasSource(session), true);
});

test("session source path keeps explicit metadata when no session root is available", () => {
  const metadataPath = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1/source";
  const session = {
    metadata: {
      source_path: metadataPath
    }
  };

  assert.equal(explicitSessionSourcePath(session), metadataPath);
  assert.equal(canonicalSessionSourcePath(session), "");
  assert.equal(sessionSourcePath(session), metadataPath);
  assert.equal(sessionHasSource(session), true);
});

test("session source path treats removed source metadata as authoritative", () => {
  const sessionRoot = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1";
  const session = {
    completedSteps: ["session_created", "source_created"],
    metadata: {
      source_path: path.join(sessionRoot, "source"),
      source_removed: "yes"
    },
    sessionRoot,
    sourceReady: true
  };

  assert.equal(explicitSessionSourcePath(session), "");
  assert.equal(canonicalSessionSourcePath(session), "");
  assert.equal(sessionSourcePath(session), "");
  assert.equal(sessionHasSource(session), false);
});
