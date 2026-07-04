import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
  explicitPathIsLocalSourceRoot,
  explicitPathIsManagedSessionSource,
  explicitSessionSourcePath,
  sessionHasSource,
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";

test("session source path rejects explicit source metadata under private session state", () => {
  const sessionRoot = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1";
  const sourcePath = path.join(sessionRoot, "source");
  const session = {
    completedSteps: ["session_created", "source_created"],
    metadata: {
      source_path: sourcePath
    },
    sessionRoot
  };

  assert.equal(explicitSessionSourcePath(session), "");
  assert.equal(sessionSourcePath(session), "");
  assert.equal(sessionHasSource(session), false);
});

test("session source path does not synthesize private-state source paths from creation flags", () => {
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
  assert.equal(sessionSourcePath(session), "");
  assert.equal(sessionHasSource(session), false);
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
  const targetRoot = "/var/lib/vibe64/merc/projects/app";
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
  assert.equal(sessionSourcePath(session), "");
});

test("session source path rejects targetRoot metadata when the target root is inside private session state", () => {
  const sessionRoot = "/home/user/.local/state/vibe64/projects/app-test/sessions/active/session-1";
  const targetRoot = path.join(sessionRoot, "source");
  const session = {
    completedSteps: ["session_created", "source_created"],
    metadata: {
      source_path: targetRoot
    },
    sessionRoot,
    targetRoot
  };

  assert.equal(explicitPathIsLocalSourceRoot(session, targetRoot), false);
  assert.equal(explicitSessionSourcePath(session), "");
  assert.equal(sessionSourcePath(session), "");
});

test("session source path accepts marked managed session source metadata outside private state", () => {
  const sessionRoot = "/home/user/.local/state/vibe64/projects/app-test/sessions/active/session-1";
  const sourcePath = "/var/lib/vibe64/user/projects/app-test/sessions/active/session-1/source";
  const session = {
    completedSteps: ["session_created", "source_created"],
    id: "session-1",
    metadata: {
      source_path: sourcePath,
      source_kind: "session_clone",
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionRoot,
    targetRoot: "/home/user/code/app"
  };

  assert.equal(explicitPathIsManagedSessionSource(session, sourcePath), true);
  assert.equal(explicitSessionSourcePath(session), sourcePath);
  assert.equal(sessionSourcePath(session), sourcePath);
  assert.equal(sessionHasSource(session), true);
});

test("session source path rejects unmarked managed-looking source metadata outside private state", () => {
  const sessionRoot = "/home/user/.local/state/vibe64/projects/app-test/sessions/active/session-1";
  const sourcePath = "/var/lib/vibe64/user/projects/app-test/sessions/active/session-1/source";
  const session = {
    completedSteps: ["session_created", "source_created"],
    id: "session-1",
    metadata: {
      source_path: sourcePath
    },
    sessionRoot,
    targetRoot: "/home/user/code/app"
  };

  assert.equal(explicitPathIsManagedSessionSource(session, sourcePath), false);
  assert.equal(explicitSessionSourcePath(session), "");
  assert.equal(sessionSourcePath(session), "");
});

test("session source path requires source metadata after source creation", () => {
  const sessionRoot = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1";
  const session = {
    completedSteps: ["session_created", "source_created"],
    metadata: {},
    sessionRoot
  };

  assert.equal(sessionSourcePath(session), "");
  assert.equal(sessionHasSource(session), false);
});

test("session source path rejects private-state explicit metadata before creation state exists", () => {
  const metadataPath = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1/source";
  const session = {
    metadata: {
      source_path: metadataPath
    },
    sessionRoot: "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1"
  };

  assert.equal(explicitSessionSourcePath(session), "");
  assert.equal(sessionSourcePath(session), "");
  assert.equal(sessionHasSource(session), false);
});

test("session source path rejects unqualified explicit metadata when no session root is available", () => {
  const metadataPath = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1/source";
  const session = {
    metadata: {
      source_path: metadataPath
    }
  };

  assert.equal(explicitSessionSourcePath(session), "");
  assert.equal(sessionSourcePath(session), "");
  assert.equal(sessionHasSource(session), false);
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
  assert.equal(sessionSourcePath(session), "");
  assert.equal(sessionHasSource(session), false);
});
