import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  TargetAdapter
} from "@local/vibe64-adapters/server/adapter";
import {
  pathExists
} from "@local/vibe64-core/server/core";
import {
  relativePathIsDisposable,
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

class ArchiveTestAdapter extends TargetAdapter {
  constructor() {
    super({
      id: "archive-test",
      label: "Archive test"
    });
  }

  async worktreeArchiveExclusions() {
    return ["node_modules"];
  }
}

async function git(cwd, args = []) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024,
      timeout: 30_000
    });
    return String(result.stdout || "").trim();
  } catch (error) {
    throw new Error(String(error.stderr || error.stdout || error.message || error));
  }
}

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createGitProject(root) {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "vibe64@example.test"]);
  await git(root, ["config", "user.name", "Vibe64 Test"]);
  await writeProjectFile(root, "app.txt", "initial\n");
  await git(root, ["add", "app.txt"]);
  await git(root, ["commit", "-m", "initial"]);
  await git(root, ["branch", "-M", "main"]);
  return git(root, ["rev-parse", "--verify", "HEAD"]);
}

test("runtime has no built-in disposable worktree paths", () => {
  assert.equal(relativePathIsDisposable("node_modules/huge.js", []), false);
});

test("archives, removes, and reinstates dirty worktrees with adapter-owned disposable paths", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    await git(targetRoot, ["checkout", "-b", "vibe64/stale-session"]);
    await writeProjectFile(targetRoot, "stale.txt", "old session branch\n");
    await git(targetRoot, ["add", "stale.txt"]);
    await git(targetRoot, ["commit", "-m", "stale session branch"]);
    await git(targetRoot, ["checkout", "main"]);
    const runtime = new Vibe64SessionRuntime({
      adapter: new ArchiveTestAdapter(),
      targetRoot
    });
    const session = await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/archive_test",
        issue_word: "Recoverable Session"
      },
      sessionId: "archive_test"
    });
    const worktreePath = path.join(session.sessionRoot, "source");
    await git(targetRoot, ["worktree", "add", "-b", "vibe64/archive_test", worktreePath, "HEAD"]);
    await runtime.store.writeMetadataValue("archive_test", "source_path", worktreePath);
    await runtime.store.writeCompletedStep("archive_test", "source_created", {
      message: "Session clone created."
    });

    await writeProjectFile(worktreePath, "app.txt", "changed\n");
    await writeProjectFile(worktreePath, "notes.md", "keep me\n");
    await writeProjectFile(worktreePath, "node_modules/huge.js", "discard me\n");

    const archiveSession = await runtime.getSession("archive_test");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "abandoned"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);

    const archivedMetadata = await runtime.store.readMetadata("archive_test");
    assert.equal(archivedMetadata.source_removed, "yes");
    assert.equal(archivedMetadata.source_recovery_branch, "vibe64/archive_test");
    assert.equal(archivedMetadata.source_recovery_session_name, "Recoverable");
    assert.equal(archivedMetadata.source_recovery_dirty, "yes");
    assert.equal(archivedMetadata.source_recovery_patch_artifact, "recovery/worktree.patch");
    assert.equal(archivedMetadata.source_recovery_untracked_artifact, "recovery/untracked-files.tar.gz");

    const recoveredSession = await runtime.recoverSessionSource("archive_test");
    assert.equal(recoveredSession.metadata.source_removed, "no");
    assert.equal(await pathExists(worktreePath), true);
    assert.equal(await git(worktreePath, ["branch", "--show-current"]), "vibe64/archive_test");
    assert.equal(await readFile(path.join(worktreePath, "app.txt"), "utf8"), "changed\n");
    assert.equal(await readFile(path.join(worktreePath, "notes.md"), "utf8"), "keep me\n");
    assert.equal(await pathExists(path.join(worktreePath, "node_modules/huge.js")), false);
  });
});

test("archive removes registered worktrees with ignored generated files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitProject(targetRoot);
    await writeProjectFile(targetRoot, ".gitignore", "src/typed-router.d.ts\n");
    await git(targetRoot, ["add", ".gitignore"]);
    await git(targetRoot, ["commit", "-m", "ignore generated router types"]);
    const baseCommit = await git(targetRoot, ["rev-parse", "--verify", "HEAD"]);
    const runtime = new Vibe64SessionRuntime({
      adapter: new ArchiveTestAdapter(),
      targetRoot
    });
    const session = await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/ignored_generated_file"
      },
      sessionId: "ignored_generated_file"
    });
    const worktreePath = path.join(session.sessionRoot, "source");
    await git(targetRoot, ["worktree", "add", "-b", "vibe64/ignored_generated_file", worktreePath, "HEAD"]);
    await runtime.store.writeMetadataValue("ignored_generated_file", "source_path", worktreePath);
    await runtime.store.writeCompletedStep("ignored_generated_file", "source_created", {
      message: "Session clone created."
    });

    await writeProjectFile(worktreePath, "src/typed-router.d.ts", "declare module 'typed-router';\n");

    const archiveSession = await runtime.getSession("ignored_generated_file");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "abandoned"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);

    const archivedMetadata = await runtime.store.readMetadata("ignored_generated_file");
    assert.equal(archivedMetadata.source_removed, "yes");
    assert.equal(archivedMetadata.source_recovery_dirty, "no");
  });
});

test("archive removes a session-owned ordinary worktree directory without reading the parent repo", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: new ArchiveTestAdapter(),
      targetRoot
    });
    const session = await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/ordinary_directory"
      },
      sessionId: "ordinary_directory"
    });
    const worktreePath = path.join(session.sessionRoot, "source");
    await writeProjectFile(worktreePath, "src/typed-router.d.ts", "declare module 'typed-router';\n");
    await runtime.store.writeMetadataValue("ordinary_directory", "source_path", worktreePath);
    await runtime.store.writeCompletedStep("ordinary_directory", "source_created", {
      message: "Session clone created."
    });

    const archiveSession = await runtime.getSession("ordinary_directory");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "abandoned"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(archiveResult.recoverable, false);
    assert.equal(await pathExists(worktreePath), false);

    const archivedMetadata = await runtime.store.readMetadata("ordinary_directory");
    assert.equal(archivedMetadata.source_removed, "yes");
    assert.equal(archivedMetadata.source_recovery_branch, "vibe64/ordinary_directory");
    assert.equal(archivedMetadata.source_recovery_head, "");
    assert.equal(archivedMetadata.source_recovery_dirty, "no");
  });
});

test("archive completes when a previous remove left a session-owned ordinary directory", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: new ArchiveTestAdapter(),
      targetRoot
    });
    const session = await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/half_removed"
      },
      sessionId: "half_removed"
    });
    const worktreePath = path.join(session.sessionRoot, "source");
    await git(targetRoot, ["worktree", "add", "-b", "vibe64/half_removed", worktreePath, "HEAD"]);
    await runtime.store.writeMetadataValue("half_removed", "source_path", worktreePath);
    await runtime.store.writeCompletedStep("half_removed", "source_created", {
      message: "Session clone created."
    });
    await git(targetRoot, ["worktree", "remove", "--force", "--force", worktreePath]);
    await writeProjectFile(worktreePath, ".env", "GENERATED=yes\n");

    const archiveSession = await runtime.getSession("half_removed");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "abandoned"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);

    const archivedMetadata = await runtime.store.readMetadata("half_removed");
    assert.equal(archivedMetadata.source_removed, "yes");
    assert.equal(archivedMetadata.source_recovery_branch, "vibe64/half_removed");
  });
});

test("archive removes a session-owned Git directory that is not registered as a target worktree", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: new ArchiveTestAdapter(),
      targetRoot
    });
    const session = await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/unregistered_git_directory"
      },
      sessionId: "unregistered_git_directory"
    });
    const worktreePath = path.join(session.sessionRoot, "source");
    await mkdir(worktreePath, {
      recursive: true
    });
    await createGitProject(worktreePath);
    await runtime.store.writeMetadataValue("unregistered_git_directory", "source_path", worktreePath);
    await runtime.store.writeCompletedStep("unregistered_git_directory", "source_created", {
      message: "Session clone created."
    });

    const archiveSession = await runtime.getSession("unregistered_git_directory");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "abandoned"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);

    const archivedMetadata = await runtime.store.readMetadata("unregistered_git_directory");
    assert.equal(archivedMetadata.source_removed, "yes");
    assert.equal(await git(targetRoot, ["worktree", "list", "--porcelain"]), `worktree ${targetRoot}
HEAD ${baseCommit}
branch refs/heads/main`);
  });
});

test("archives and recovers session clone commits from a saved bundle", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: new ArchiveTestAdapter(),
      targetRoot
    });
    const session = await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/session_clone_bundle",
        source_default_branch: "main",
        source_kind: "session_clone"
      },
      sessionId: "session_clone_bundle"
    });
    const worktreePath = path.join(session.sessionRoot, "source");
    await mkdir(path.dirname(worktreePath), {
      recursive: true
    });
    await git(path.dirname(worktreePath), ["clone", targetRoot, worktreePath]);
    await git(worktreePath, ["config", "user.email", "vibe64@example.test"]);
    await git(worktreePath, ["config", "user.name", "Vibe64 Test"]);
    await git(worktreePath, ["checkout", "-B", "vibe64/session_clone_bundle", baseCommit]);
    await writeProjectFile(worktreePath, "app.txt", "committed clone change\n");
    await git(worktreePath, ["add", "app.txt"]);
    await git(worktreePath, ["commit", "-m", "clone commit"]);
    await writeProjectFile(worktreePath, "notes.md", "recover me\n");
    await runtime.store.writeMetadataValue("session_clone_bundle", "source_path", worktreePath);
    await runtime.store.writeCompletedStep("session_clone_bundle", "source_created", {
      message: "Session clone created."
    });

    const archiveSession = await runtime.getSession("session_clone_bundle");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "abandoned"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);

    const archivedMetadata = await runtime.store.readMetadata("session_clone_bundle");
    assert.equal(archivedMetadata.source_recovery_kind, "session_clone");
    assert.equal(archivedMetadata.source_recovery_bundle_artifact, "recovery/branch.bundle");
    assert.equal(archivedMetadata.source_recovery_untracked_artifact, "recovery/untracked-files.tar.gz");

    const recoveredSession = await runtime.recoverSessionSource("session_clone_bundle");
    assert.equal(recoveredSession.metadata.source_removed, "no");
    assert.equal(await git(worktreePath, ["branch", "--show-current"]), "vibe64/session_clone_bundle");
    assert.equal(await git(worktreePath, ["branch", "--list", "main"]), "");
    assert.equal(await git(worktreePath, ["branch", "-r", "--list", "origin/vibe64/stale-session"]), "");
    assert.equal(await readFile(path.join(worktreePath, "app.txt"), "utf8"), "committed clone change\n");
    assert.equal(await readFile(path.join(worktreePath, "notes.md"), "utf8"), "recover me\n");
  });
});
