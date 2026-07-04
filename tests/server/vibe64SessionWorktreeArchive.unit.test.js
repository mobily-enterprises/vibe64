import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
import {
  sourceMetadata,
  sourcePath as testSessionSourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

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

async function createSessionClone({
  baseCommit = "",
  branch = "",
  sourcePath = "",
  targetRoot = ""
} = {}) {
  await mkdir(path.dirname(sourcePath), {
    recursive: true
  });
  await git(path.dirname(sourcePath), ["clone", targetRoot, sourcePath]);
  await git(sourcePath, ["config", "user.email", "vibe64@example.test"]);
  await git(sourcePath, ["config", "user.name", "Vibe64 Test"]);
  await git(sourcePath, ["checkout", "-B", branch, baseCommit || "HEAD"]);
}

test("runtime has no built-in disposable worktree paths", () => {
  assert.equal(relativePathIsDisposable("node_modules/huge.js", []), false);
});

test("archives and removes dirty worktrees with adapter-owned disposable paths", async () => {
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
    const sessionId = "archive_test";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/archive_test",
        issue_word: "Recoverable Session",
        ...sourceMetadata(targetRoot, sessionId)
      },
      sessionId
    });
    await createSessionClone({
      baseCommit,
      branch: "vibe64/archive_test",
      sourcePath: worktreePath,
      targetRoot
    });
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
  });
});

test("archive removes session clones with ignored generated files", async () => {
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
    const sessionId = "ignored_generated_file";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/ignored_generated_file",
        ...sourceMetadata(targetRoot, sessionId)
      },
      sessionId
    });
    await createSessionClone({
      baseCommit,
      branch: "vibe64/ignored_generated_file",
      sourcePath: worktreePath,
      targetRoot
    });
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
    const sessionId = "ordinary_directory";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/ordinary_directory",
        ...sourceMetadata(targetRoot, sessionId)
      },
      sessionId
    });
    await writeProjectFile(worktreePath, "src/typed-router.d.ts", "declare module 'typed-router';\n");
    await runtime.store.writeCompletedStep("ordinary_directory", "source_created", {
      message: "Session clone created."
    });

    const archiveSession = await runtime.getSession("ordinary_directory");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "abandoned"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(archiveResult.recoverable, undefined);
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
    const sessionId = "half_removed";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/half_removed",
        ...sourceMetadata(targetRoot, sessionId)
      },
      sessionId
    });
    await createSessionClone({
      baseCommit,
      branch: "vibe64/half_removed",
      sourcePath: worktreePath,
      targetRoot
    });
    await runtime.store.writeCompletedStep("half_removed", "source_created", {
      message: "Session clone created."
    });
    await git(worktreePath, ["rev-parse", "--git-dir"]);
    await rm(worktreePath, {
      force: true,
      recursive: true
    });
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
    const sessionId = "unregistered_git_directory";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/unregistered_git_directory",
        ...sourceMetadata(targetRoot, sessionId)
      },
      sessionId
    });
    await mkdir(worktreePath, {
      recursive: true
    });
    await createGitProject(worktreePath);
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

test("archive removes a session clone when the runtime target root is the source checkout", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const remoteRoot = path.join(targetRoot, "remote");
    await mkdir(remoteRoot, {
      recursive: true
    });
    const baseCommit = await createGitProject(remoteRoot);
    const sessionId = "source_target_clone";
    const projectLocalRoot = path.join(path.dirname(targetRoot), "state", "runtime-bucket");
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      adapter: new ArchiveTestAdapter(),
      projectLocalRoot,
      targetRoot: worktreePath
    });
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: `vibe64/${sessionId}`,
        source_default_branch: "main",
        source_kind: "session_clone",
        source_path: worktreePath,
        source_path_authority: sourceMetadata(targetRoot, sessionId).source_path_authority,
        source_remote_url: remoteRoot
      },
      sessionId
    });
    await mkdir(path.dirname(worktreePath), {
      recursive: true
    });
    await git(path.dirname(worktreePath), ["clone", "--single-branch", "--branch", "main", remoteRoot, worktreePath]);
    await runtime.store.writeCompletedStep(sessionId, "source_created", {
      message: "Session clone created."
    });

    const archiveSession = await runtime.getSession(sessionId);
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "finished"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);

    const archivedMetadata = await runtime.store.readMetadata(sessionId);
    assert.equal(archivedMetadata.source_removed, "yes");
    assert.equal(archivedMetadata.source_recovery_kind, "session_clone");
    assert.equal(archivedMetadata.source_recovery_remote_url, remoteRoot);
  });
});

test("archives session clone commits into a saved bundle", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    const cachePath = path.join(path.dirname(targetRoot), "repository.git");
    await git(path.dirname(targetRoot), ["clone", "--bare", targetRoot, cachePath]);
    const runtime = new Vibe64SessionRuntime({
      adapter: new ArchiveTestAdapter(),
      targetRoot
    });
    const sessionId = "session_clone_bundle";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/session_clone_bundle",
        source_cache_path: cachePath,
        source_default_branch: "main",
        source_remote_url: targetRoot,
        ...sourceMetadata(targetRoot, sessionId)
      },
      sessionId
    });
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
  });
});
