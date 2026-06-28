import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  canonicalSessionSourcePath,
  explicitSessionSourcePath,
  sessionHasSource,
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";

test("session source path prefers explicit source metadata", () => {
  const sessionRoot = "/workspace/vibe64-local-editor/state/projects/app-test/sessions/active/session-1";
  const sourcePath = path.join(sessionRoot, "source");
  const session = {
    completedSteps: ["session_created", "source_created"],
    metadata: {
      source_path: sourcePath
    },
    sessionRoot
  };

  assert.equal(explicitSessionSourcePath(session), sourcePath);
  assert.equal(canonicalSessionSourcePath(session), sourcePath);
  assert.equal(sessionSourcePath(session), sourcePath);
  assert.equal(sessionHasSource(session), true);
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
