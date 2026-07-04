import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  inspectSessionDiff
} from "../../packages/vibe64-sessions/src/server/sessionDiff.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args = []) {
  return execFileAsync("git", args, {
    cwd
  });
}

function sourceMetadata(sourceRoot, sessionId) {
  return {
    metadata: {
      source_kind: "session_clone",
      source_path: sourceRoot,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionId
  };
}

test("session diff review omits binary patch bodies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-diff-"));
  const sessionId = "binary-diff";
  const sessionRoot = path.join(root, "state", "sessions", "active", sessionId);
  const sourceRoot = path.join(root, "managed-source", "sessions", "active", sessionId, "source");
  await mkdir(sourceRoot, {
    recursive: true
  });
  await git(sourceRoot, ["init"]);
  await git(sourceRoot, ["config", "user.email", "test@example.com"]);
  await git(sourceRoot, ["config", "user.name", "Test User"]);
  await writeFile(path.join(sourceRoot, "image.bin"), Buffer.from([0, 1, 2, 3, 4, 255]));
  await git(sourceRoot, ["add", "image.bin"]);
  await git(sourceRoot, ["commit", "-m", "baseline"]);

  await writeFile(path.join(sourceRoot, "image.bin"), Buffer.from([0, 1, 88, 89, 90, 255]));

  const result = await inspectSessionDiff({
    completedSteps: ["source_created"],
    sessionRoot,
    ...sourceMetadata(sourceRoot, sessionId)
  });

  assert.equal(result.ok, true);
  assert.match(result.unstagedDiff, /Binary files/u);
  assert.doesNotMatch(result.unstagedDiff, /GIT binary patch/u);
  await rm(root, {
    force: true,
    recursive: true
  });
});

test("session diff review truncates large file patches by default and can load full diff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-diff-"));
  const sessionId = "large-diff";
  const sessionRoot = path.join(root, "state", "sessions", "active", sessionId);
  const sourceRoot = path.join(root, "managed-source", "sessions", "active", sessionId, "source");
  await mkdir(sourceRoot, {
    recursive: true
  });
  await git(sourceRoot, ["init"]);
  await git(sourceRoot, ["config", "user.email", "test@example.com"]);
  await git(sourceRoot, ["config", "user.name", "Test User"]);
  await writeFile(path.join(sourceRoot, "large.txt"), "base\n");
  await git(sourceRoot, ["add", "large.txt"]);
  await git(sourceRoot, ["commit", "-m", "baseline"]);

  await writeFile(path.join(sourceRoot, "large.txt"), [
    "base",
    ...Array.from({ length: 80 }, (_value, index) => `line ${index}`)
  ].join("\n"));

  const limited = await inspectSessionDiff({
    completedSteps: ["source_created"],
    sessionRoot,
    ...sourceMetadata(sourceRoot, sessionId)
  }, {
    lineLimit: 12
  });
  const full = await inspectSessionDiff({
    completedSteps: ["source_created"],
    sessionRoot,
    ...sourceMetadata(sourceRoot, sessionId)
  }, {
    full: true,
    lineLimit: 12
  });

  assert.equal(limited.ok, true);
  assert.equal(limited.diffTruncated, true);
  assert.equal(limited.truncatedFiles.length, 1);
  assert.equal(limited.truncatedFiles[0].path, "large.txt");
  assert.equal(limited.truncatedFiles[0].shownLines, 12);
  assert.ok(limited.diffTotalLines > limited.diffShownLines);
  assert.ok(limited.unstagedDiff.split("\n").length <= 12);

  assert.equal(full.ok, true);
  assert.equal(full.diffTruncated, false);
  assert.ok(full.unstagedDiff.split("\n").length > limited.unstagedDiff.split("\n").length);

  await rm(root, {
    force: true,
    recursive: true
  });
});
