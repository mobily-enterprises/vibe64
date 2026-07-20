import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
} from "../../packages/vibe64-core/src/server/projectRepository.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  inspectSessionSourceSafety,
  sourceSafetySeverity
} from "../../packages/vibe64-sessions/src/server/sessionSourceSafety.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args = []) {
  return execFileAsync("git", args, {
    cwd
  });
}

function sourceSession(sourceRoot, sessionId, metadata = {}) {
  return {
    metadata: {
      source_kind: "session_clone",
      source_path: sourceRoot,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      ...metadata
    },
    sessionId
  };
}

async function initializeRepository(sourceRoot) {
  await mkdir(sourceRoot, {
    recursive: true
  });
  await git(sourceRoot, ["init", "-b", "main"]);
  await git(sourceRoot, ["config", "user.email", "test@example.com"]);
  await git(sourceRoot, ["config", "user.name", "Test User"]);
  await writeFile(path.join(sourceRoot, "README.md"), "base\n");
  await git(sourceRoot, ["add", "README.md"]);
  await git(sourceRoot, ["commit", "-m", "baseline"]);
  return String((await git(sourceRoot, ["rev-parse", "HEAD"])).stdout || "").trim();
}

test("local-source safety clears as soon as changes are committed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-source-safety-local-"));
  try {
    const sourceRoot = path.join(root, "managed-source", "sessions", "active", "local-session", "source");
    const baseCommit = await initializeRepository(sourceRoot);
    const session = sourceSession(sourceRoot, "local-session", {
      base_commit: baseCommit,
      workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
    });

    await writeFile(path.join(sourceRoot, "README.md"), "base\nlocal work\n");
    const dirty = await inspectSessionSourceSafety(session);

    assert.equal(dirty.ok, true);
    assert.equal(dirty.requiresPush, false);
    assert.equal(dirty.hasUncommittedChanges, true);
    assert.equal(dirty.hasUnpushedCommits, false);
    assert.equal(dirty.changedFileCount, 1);
    assert.equal(dirty.changedLineCount, 1);
    assert.equal(dirty.unsafe, true);

    await git(sourceRoot, ["add", "README.md"]);
    await git(sourceRoot, ["commit", "-m", "Save local work"]);
    const committed = await inspectSessionSourceSafety(session);

    assert.equal(committed.hasUncommittedChanges, false);
    assert.equal(committed.unpushedCommitCount, 0);
    assert.equal(committed.unsafe, false);
    assert.equal(committed.severity, 0);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("Git-backed safety remains unsafe when only a session branch is pushed and clears on origin/main", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-source-safety-git-"));
  try {
    const sourceRoot = path.join(root, "managed-source", "sessions", "active", "git-session", "source");
    const remoteRoot = path.join(root, "remote.git");
    const baseCommit = await initializeRepository(sourceRoot);
    await git(root, ["init", "--bare", remoteRoot]);
    await git(sourceRoot, ["remote", "add", "origin", remoteRoot]);
    await git(sourceRoot, ["push", "-u", "origin", "main"]);
    await git(sourceRoot, ["checkout", "-b", "vibe64/git-session"]);
    const session = sourceSession(sourceRoot, "git-session", {
      base_commit: baseCommit,
      workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
    });

    await writeFile(path.join(sourceRoot, "README.md"), [
      "base",
      ...Array.from({ length: 80 }, (_value, index) => `work ${index}`),
      ""
    ].join("\n"));
    await git(sourceRoot, ["add", "README.md"]);
    await git(sourceRoot, ["commit", "-m", "Build feature"]);

    const committed = await inspectSessionSourceSafety(session);
    assert.equal(committed.requiresPush, true);
    assert.equal(committed.hasUncommittedChanges, false);
    assert.equal(committed.hasUnpushedCommits, true);
    assert.equal(committed.unpushedCommitCount, 1);
    assert.ok(committed.changedLineCount >= 80);
    assert.ok(committed.severity > 0);
    assert.ok(committed.severity < 50);
    assert.equal(committed.unsafe, true);

    await git(sourceRoot, [
      "push",
      "origin",
      "HEAD:refs/heads/vibe64/git-session"
    ]);
    const sessionBranchPushed = await inspectSessionSourceSafety(session);
    assert.equal(sessionBranchPushed.hasUnpushedCommits, true);
    assert.equal(sessionBranchPushed.unpushedCommitCount, 1);
    assert.equal(sessionBranchPushed.unsafe, true);

    await git(sourceRoot, ["push", "origin", "HEAD:refs/heads/main"]);
    const pushed = await inspectSessionSourceSafety(session);
    assert.equal(pushed.hasUnpushedCommits, false);
    assert.equal(pushed.unpushedCommitCount, 0);
    assert.equal(pushed.unsafe, false);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("source-safety heat uses the full change-unit range before reaching red", () => {
  assert.equal(sourceSafetySeverity(0), 0);
  assert.equal(sourceSafetySeverity(1), 0);
  assert.equal(sourceSafetySeverity(25), 5);
  assert.equal(sourceSafetySeverity(192), 38);
  assert.equal(sourceSafetySeverity(250), 50);
  assert.equal(sourceSafetySeverity(500), 100);
  assert.equal(sourceSafetySeverity(5_000), 100);
});

test("unborn repositories count staged source content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-source-safety-unborn-"));
  try {
    const sourceRoot = path.join(root, "managed-source", "sessions", "active", "unborn-session", "source");
    await mkdir(sourceRoot, {
      recursive: true
    });
    await git(sourceRoot, ["init", "-b", "main"]);
    await writeFile(path.join(sourceRoot, "feature.js"), "one\ntwo\nthree\n");
    await git(sourceRoot, ["add", "feature.js"]);

    const safety = await inspectSessionSourceSafety(sourceSession(sourceRoot, "unborn-session", {
      workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
    }));

    assert.equal(safety.changedFileCount, 1);
    assert.equal(safety.changedLineCount, 3);
    assert.equal(safety.unsafe, true);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("untracked file content contributes to safety heat", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-source-safety-untracked-"));
  try {
    const sourceRoot = path.join(root, "managed-source", "sessions", "active", "untracked-session", "source");
    const baseCommit = await initializeRepository(sourceRoot);
    const session = sourceSession(sourceRoot, "untracked-session", {
      base_commit: baseCommit,
      workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
    });
    await writeFile(path.join(sourceRoot, "large-new-file.txt"), "x".repeat(50_000));

    const safety = await inspectSessionSourceSafety(session);

    assert.equal(safety.untrackedFileCount, 1);
    assert.equal(safety.untrackedByteCount, 50_000);
    assert.equal(safety.severity, 100);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});
