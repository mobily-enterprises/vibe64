import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  pathExists
} from "@local/vibe64-core/server/core";
import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  checkpointRefs,
  createGitTurnCheckpoint,
  installVibe64ManagedExecutionProvider
} from "@local/vibe64-execution/server";
import {
  projectRuntimeRoot,
  sourceMetadata,
  sourcePath as testSessionSourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

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

test("archives all dirty worktree files without adapter exclusions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    await git(targetRoot, ["checkout", "-b", "vibe64/stale-session"]);
    await writeProjectFile(targetRoot, "stale.txt", "old session branch\n");
    await git(targetRoot, ["add", "stale.txt"]);
    await git(targetRoot, ["commit", "-m", "stale session branch"]);
    await git(targetRoot, ["checkout", "main"]);
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    const sessionId = "archive_test";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/archive_test",
        label: "Recoverable Session",
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

    await writeProjectFile(worktreePath, "app.txt", "changed\n");
    await writeProjectFile(worktreePath, "notes.md", "keep me\n");
    await writeProjectFile(worktreePath, "node_modules/huge.js", "discard me\n");

    const archiveSession = await runtime.getSession("archive_test");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "archived"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);

    const archivedMetadata = await runtime.store.readMetadata("archive_test");
    assert.equal(archivedMetadata.source_removed, "yes");
    assert.equal(archivedMetadata.source_recovery_branch, "vibe64/archive_test");
    assert.equal(archivedMetadata.source_recovery_session_name, "Recoverable Session");
    assert.equal(archivedMetadata.source_recovery_dirty, "yes");
    assert.equal(archivedMetadata.source_recovery_patch_artifact, "recovery/worktree.patch");
    assert.equal(archivedMetadata.source_recovery_untracked_artifact, "recovery/untracked-files.tar.gz");
    const savedFiles = await execFileAsync("tar", [
      "-tzf",
      path.join(runtime.store.paths(sessionId).artifactsRoot, "recovery/untracked-files.tar.gz")
    ]);
    assert.match(savedFiles.stdout, /node_modules\/huge\.js/u);
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
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
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

    await writeProjectFile(worktreePath, "src/typed-router.d.ts", "declare module 'typed-router';\n");

    const archiveSession = await runtime.getSession("ignored_generated_file");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "archived"
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
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
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

    const archiveSession = await runtime.getSession("ordinary_directory");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "archived"
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
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
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
    await git(worktreePath, ["rev-parse", "--git-dir"]);
    await rm(worktreePath, {
      force: true,
      recursive: true
    });
    await writeProjectFile(worktreePath, ".env", "GENERATED=yes\n");

    const archiveSession = await runtime.getSession("half_removed");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "archived"
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
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
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

    const archiveSession = await runtime.getSession("unregistered_git_directory");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "archived"
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

test("archives session clone commits into a saved bundle", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    const githubMirrorPath = path.join(path.dirname(targetRoot), "github-mirror", "repository.git");
    await mkdir(path.dirname(githubMirrorPath), {
      recursive: true
    });
    await git(path.dirname(targetRoot), ["clone", "--bare", targetRoot, githubMirrorPath]);
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    const sessionId = "session_clone_bundle";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/session_clone_bundle",
        github_mirror_path: githubMirrorPath,
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

    const archiveSession = await runtime.getSession("session_clone_bundle");
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "archived"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);

    const archivedMetadata = await runtime.store.readMetadata("session_clone_bundle");
    assert.equal(archivedMetadata.source_recovery_kind, "session_clone");
    assert.equal(archivedMetadata.source_recovery_bundle_artifact, "recovery/branch.bundle");
    assert.equal(archivedMetadata.source_recovery_untracked_artifact, "recovery/untracked-files.tar.gz");
  });
});

test("archives and proves restoration of hidden turn checkpoint refs before removing source", async (t) => {
  const commandRequests = [];
  const releaseManagedExecution = installVibe64ManagedExecutionProvider({
    async runCommand(request, { runLocal }) {
      commandRequests.push(request);
      return runLocal();
    },
    async stopExecution() {
      return { ok: true, stopped: false };
    }
  });
  t.after(releaseManagedExecution);

  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    const sessionId = "checkpoint_archive";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: `vibe64/${sessionId}`,
        source_default_branch: "main",
        source_remote_url: targetRoot,
        ...sourceMetadata(targetRoot, sessionId)
      },
      sessionId
    });
    await createSessionClone({
      baseCommit,
      branch: `vibe64/${sessionId}`,
      sourcePath: worktreePath,
      targetRoot
    });
    await writeProjectFile(worktreePath, "app.txt", "checkpointed only\n");
    const checkpoint = await createGitTurnCheckpoint({
      outerTurnId: "client-message-archive",
      outcome: "completed",
      sessionId,
      timestamp: "2026-08-18T09:00:00.000Z",
      worktreePath
    });

    const archiveSession = await runtime.getSession(sessionId);
    const archiveResult = await runtime.archiveSessionSource(archiveSession, {
      reason: "archived"
    });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);
    const archivedMetadata = await runtime.store.readMetadata(sessionId);
    assert.equal(
      archivedMetadata.source_recovery_checkpoint_bundle_artifact,
      "recovery/checkpoints.bundle"
    );

    const restoreRoot = path.join(targetRoot, "checkpoint-restore.git");
    await mkdir(restoreRoot, { recursive: true });
    await git(restoreRoot, ["init", "--bare"]);
    const artifact = path.join(
      runtime.store.paths(sessionId).artifactsRoot,
      archivedMetadata.source_recovery_checkpoint_bundle_artifact
    );
    const refs = checkpointRefs({
      outerTurnId: "client-message-archive",
      sessionId
    });
    await git(restoreRoot, [
      "fetch",
      artifact,
      `${refs.turnRef}:${refs.turnRef}`,
      `${refs.latestRef}:${refs.latestRef}`
    ]);
    assert.equal(await git(restoreRoot, ["rev-parse", refs.turnRef]), checkpoint.commit);
    assert.equal(await git(restoreRoot, ["rev-parse", refs.latestRef]), checkpoint.commit);
    assert.equal(await git(restoreRoot, ["show", `${checkpoint.commit}:app.txt`]), "checkpointed only");

    const restoreVerificationCommands = commandRequests.filter(({ args = [] }) => (
      args.includes("--git-dir") || (args[0] === "init" && args[1] === "--bare")
    ));
    assert.equal(restoreVerificationCommands.length, 3);
    assert.equal(restoreVerificationCommands.filter(({ args }) => args.includes("for-each-ref")).length, 1);
    assert.ok(restoreVerificationCommands.every(({ cwd }) => cwd === worktreePath));
    assert.ok(restoreVerificationCommands.every(({ cwd }) => !cwd.startsWith(
      runtime.store.paths(sessionId).artifactsRoot
    )));
  });
});

test("checkpoint restore verification failures preserve the original source", async (t) => {
  for (const failure of ["changed_ref", "interrupted_command"]) {
    await t.test(failure, async (t) => {
      await withTemporaryRoot(async (targetRoot) => {
        const baseCommit = await createGitProject(targetRoot);
        const runtime = new Vibe64SessionRuntime({
          projectContextRoot: targetRoot,
          projectRuntimeRoot: projectRuntimeRoot(targetRoot)
        });
        const sessionId = `checkpoint_${failure}`;
        const worktreePath = testSessionSourcePath(targetRoot, sessionId);
        await runtime.createSession({
          metadata: {
            base_branch: "main",
            base_commit: baseCommit,
            branch: `vibe64/${sessionId}`,
            ...sourceMetadata(targetRoot, sessionId)
          },
          sessionId
        });
        await createSessionClone({
          baseCommit,
          branch: `vibe64/${sessionId}`,
          sourcePath: worktreePath,
          targetRoot
        });
        await writeProjectFile(worktreePath, "app.txt", "checkpointed only\n");
        const outerTurnId = "client-message-archive";
        const checkpoint = await createGitTurnCheckpoint({
          outerTurnId,
          outcome: "completed",
          sessionId,
          timestamp: "2026-08-18T09:00:00.000Z",
          worktreePath
        });
        const refs = checkpointRefs({ outerTurnId, sessionId });
        let failureInjected = false;
        const releaseManagedExecution = installVibe64ManagedExecutionProvider({
          async runCommand(request, { runLocal }) {
            const args = request.args || [];
            if (args[0] === "--git-dir" && args.includes("for-each-ref")) {
              failureInjected = true;
              if (failure === "interrupted_command") {
                return { ok: false, stderr: "simulated managed command interruption" };
              }
              await git(args[1], ["update-ref", refs.turnRef, baseCommit]);
            }
            return runLocal();
          },
          async stopExecution() {
            return { ok: true, stopped: false };
          }
        });
        t.after(releaseManagedExecution);

        const session = await runtime.getSession(sessionId);
        await assert.rejects(runtime.archiveSessionSource(session, { reason: "archived" }), {
          code: failure === "changed_ref"
            ? "vibe64_worktree_archive_checkpoint_restore_mismatch"
            : "vibe64_worktree_archive_checkpoint_restore_verify_failed",
          message: failure === "changed_ref"
            ? /did not restore the exact checkpoint refs/u
            : /simulated managed command interruption/u
        });
        assert.equal(failureInjected, true);
        assert.equal(await pathExists(worktreePath), true);
        assert.equal(await git(worktreePath, ["rev-parse", refs.turnRef]), checkpoint.commit);
        assert.equal(await git(worktreePath, ["show", `${checkpoint.commit}:app.txt`]), "checkpointed only");
        assert.equal(await git(worktreePath, ["status", "--porcelain"]), "M app.txt");
        assert.notEqual((await runtime.store.readMetadata(sessionId)).source_removed, "yes");
      });
    });
  }
});
