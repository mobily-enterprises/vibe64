import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  pathExists
} from "@local/vibe64-core/server/core";
import { sessionTempPath } from "@local/vibe64-core/server/sessionSourcePath";
import { Vibe64SessionRuntime } from "@local/vibe64-runtime/server/runtime";
import {
  checkpointRefs,
  createGitTurnCheckpoint,
  installVibe64ManagedExecutionProvider,
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  managedSessionSourceRoot,
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

test("archive saves each connected copy's commits and unsaved work, removes the copies and each restores from its recovery", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    const sessionId = "session_clone_copies";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    const connectedRoot = path.join(path.dirname(worktreePath), "connected");
    const copy = (name) => ({ repository: `example/${name}`, branch: "main", path: path.join(connectedRoot, name),
      baseCommit, canonicalCommit: baseCommit });
    await runtime.createSession({
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: `vibe64/${sessionId}`,
        connected_copies: JSON.stringify({ library: copy("library"), tools: copy("tools") }),
        source_default_branch: "main",
        source_remote_url: targetRoot,
        ...sourceMetadata(targetRoot, sessionId)
      },
      sessionId
    });
    await createSessionClone({ baseCommit, branch: `vibe64/${sessionId}`, sourcePath: worktreePath, targetRoot });
    await writeProjectFile(worktreePath, "app.txt", "own unsaved change\n");
    // The library copy has a commit, a changed file and an untracked file; the tools copy is untouched.
    const library = path.join(connectedRoot, "library");
    await createSessionClone({ baseCommit, branch: `vibe64/${sessionId}`, sourcePath: library, targetRoot });
    await writeProjectFile(library, "app.txt", "library commit\n");
    await git(library, ["commit", "-am", "library commit"]);
    const libraryHead = await git(library, ["rev-parse", "HEAD"]);
    await writeProjectFile(library, "app.txt", "library unsaved change\n");
    await writeProjectFile(library, "notes.md", "library notes\n");
    await createSessionClone({ baseCommit, branch: `vibe64/${sessionId}`, sourcePath: path.join(connectedRoot, "tools"), targetRoot });

    const archiveResult = await runtime.archiveSessionSource(await runtime.getSession(sessionId), { reason: "archived" });
    assert.equal(archiveResult.removed, true);
    assert.equal(archiveResult.dirty, true);
    assert.equal(await pathExists(worktreePath), false);
    assert.equal(await pathExists(connectedRoot), false);
    // The session's emptied folder goes too; the folder of all sessions stays.
    assert.equal(await pathExists(path.dirname(worktreePath)), false);
    assert.equal(await pathExists(path.dirname(path.dirname(worktreePath))), true);

    const metadata = await runtime.store.readMetadata(sessionId);
    const recovery = JSON.parse(metadata.connected_copies_recovery);
    assert.deepEqual(Object.keys(recovery).sort(), ["library", "tools"]);
    assert.deepEqual(recovery.library, {
      baseCommit, branch: `vibe64/${sessionId}`, branchBundleArtifact: "recovery/connected/library/branch.bundle",
      checkpointBackup: "", checkpointBackupError: "", dirty: true, head: libraryHead, patchArtifact: "recovery/connected/library/worktree.patch",
      repository: "example/library", sourcePath: library, untrackedArtifact: "recovery/connected/library/untracked-files.tar.gz",
      untrackedCount: 1
    });
    assert.equal(recovery.tools.dirty, false);
    assert.equal(recovery.tools.branchBundleArtifact, "");
    assert.equal(recovery.tools.head, baseCommit);

    const archived = await runtime.archiveSession(sessionId);
    assert.equal(archived.status, "archived");
    await runtime.store.withArchivedSession(sessionId, async (saved) => {
      const artifact = (name) => path.join(saved.artifactsRoot, name);
      const restored = path.join(targetRoot, "restore-library");
      await git(targetRoot, ["clone", targetRoot, restored]);
      await git(restored, ["fetch", artifact(recovery.library.branchBundleArtifact), "HEAD"]);
      await git(restored, ["checkout", "--detach", "FETCH_HEAD"]);
      assert.equal(await git(restored, ["rev-parse", "HEAD"]), libraryHead);
      await git(restored, ["apply", artifact(recovery.library.patchArtifact)]);
      await execFileAsync("tar", ["-xzf", artifact(recovery.library.untrackedArtifact), "-C", restored]);
      assert.equal(await readFile(path.join(restored, "app.txt"), "utf8"), "library unsaved change\n");
      assert.equal(await readFile(path.join(restored, "notes.md"), "utf8"), "library notes\n");
      // The session's own source keeps its own recovery beside the copies'.
      const own = path.join(targetRoot, "restore-own");
      await git(targetRoot, ["clone", targetRoot, own]);
      await git(own, ["apply", artifact("recovery/worktree.patch")]);
      assert.equal(await readFile(path.join(own, "app.txt"), "utf8"), "own unsaved change\n");
    });
  });
});

test("archive removes the session's temporary folder and keeps its folder while anything else is still in it", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createGitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    const sessionId = "folder_with_file";
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
    await createSessionClone({ baseCommit, branch: `vibe64/${sessionId}`, sourcePath: worktreePath, targetRoot });
    const besideSource = path.join(path.dirname(worktreePath), "notes.txt");
    await writeFile(besideSource, "not the archive's\n", "utf8");
    // The session's own temporary folder, in the editor's TMPDIR.
    const temp = sessionTempPath(worktreePath);
    try {
      await writeProjectFile(path.join(temp, "throwaway.git"), "HEAD", "ref: refs/heads/main\n");

      const archiveResult = await runtime.archiveSessionSource(await runtime.getSession(sessionId), { reason: "archived" });
      assert.equal(archiveResult.removed, true);
      assert.equal(await pathExists(worktreePath), false);
      assert.equal(await pathExists(temp), false, "throwaway files end with the session");
      assert.equal(await readFile(besideSource, "utf8"), "not the archive's\n");
    } finally {
      await rm(temp, { force: true, recursive: true });
    }
  });
});

test("archiving a session whose source creation failed removes its emptied folder", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "failed_creation";
    const worktreePath = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      async createSessionSource() {
        await writeProjectFile(worktreePath, "partial.txt", "interrupted clone\n");
        throw new Error("clone failed");
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot: managedSessionSourceRoot(targetRoot)
    });
    await assert.rejects(() => runtime.createSession({ metadata: {}, sessionId }), /clone failed/u);
    assert.equal(await pathExists(worktreePath), true);
    const temp = sessionTempPath(worktreePath);
    try {
      await writeProjectFile(temp, "throwaway.txt", "made before the failure was seen\n");

      await runtime.archiveSession(sessionId);
      assert.equal((await runtime.store.readSession(sessionId)).status, "archived");
      assert.equal(await pathExists(worktreePath), false);
      assert.equal(await pathExists(path.dirname(worktreePath)), false);
      assert.equal(await pathExists(temp), false, "its throwaway files end with it");
    } finally {
      await rm(temp, { force: true, recursive: true });
    }
  });
});

/**
 * A project whose main has `historyLength` more commits, each adding its own file.
 * @returns {Promise<string>} main's commit
 */
async function createProjectWithHistory(root, historyLength) {
  const initial = await createGitProject(root);
  const stream = [];
  for (let index = 1; index <= historyLength; index += 1) {
    const message = `history ${index}\n`;
    const content = `history file ${index}\n`;
    stream.push(
      "commit refs/heads/main",
      `committer Vibe64 Test <vibe64@example.test> ${1_700_000_000 + index} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message,
      ...(index === 1 ? [`from ${initial}`] : []),
      `M 100644 inline history/file-${index}.txt`,
      `data ${Buffer.byteLength(content)}`,
      content
    );
  }
  const streamPath = path.join(path.dirname(root), `history-${historyLength}.fast-import`);
  await writeFile(streamPath, `${stream.join("\n")}\n`, "utf8");
  await execFileAsync("sh", ["-c", "git fast-import --quiet < \"$1\"", "sh", streamPath], { cwd: root });
  await rm(streamPath, { force: true });
  await git(root, ["reset", "--hard", "main"]);
  return git(root, ["rev-parse", "--verify", "HEAD"]);
}

/** The number of objects a bundle's pack holds, from the pack's own header. */
async function bundleObjectCount(bundlePath) {
  const bytes = await readFile(bundlePath);
  const packStart = bytes.indexOf(Buffer.from("\n\nPACK")) + 2;
  assert.ok(packStart > 1, `${bundlePath} holds no pack`);
  return bytes.readUInt32BE(packStart + 8);
}

/** The session's archived turn checkpoints: the Project Backups file its recovery names. */
function recordedCheckpointBundle(runtime, metadata) {
  return metadata.source_recovery_checkpoint_backup
    ? path.join(runtime.store.paths().projectBackupsRoot, metadata.source_recovery_checkpoint_backup)
    : "";
}

/**
 * Archives a session of a project with `historyLength` commits of history and `checkpoints` turn
 * checkpoints, each changing one file, and restores them from the Project Backups bundle into a
 * plain clone of the project.
 */
async function archiveCheckpointedSession({ checkpoints, historyLength }) {
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
  try {
    return await archiveCheckpointedSessionIn({ checkpoints, commandRequests, historyLength });
  } finally {
    releaseManagedExecution();
  }
}

async function archiveCheckpointedSessionIn({ checkpoints, commandRequests, historyLength }) {
  return withTemporaryRoot(async (targetRoot) => {
    const baseCommit = await createProjectWithHistory(targetRoot, historyLength);
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
    await runtime.store.writeSessionLabel(sessionId, "Checkout fixes");
    await createSessionClone({ baseCommit, branch: `vibe64/${sessionId}`, sourcePath: worktreePath, targetRoot });
    const turns = [];
    for (let index = 1; index <= checkpoints; index += 1) {
      await writeProjectFile(worktreePath, "app.txt", `turn ${index}\n`);
      const outerTurnId = `client-message-${index}`;
      const checkpoint = await createGitTurnCheckpoint({
        outerTurnId,
        outcome: "completed",
        sessionId,
        runCommand: runVibe64Command,
        timestamp: `2026-08-18T09:${String(index).padStart(2, "0")}:00.000Z`,
        worktreePath
      });
      turns.push({ commit: checkpoint.commit, ref: checkpointRefs({ outerTurnId, sessionId }).turnRef });
    }
    const latestRef = checkpointRefs({ outerTurnId: "client-message-1", sessionId }).latestRef;
    const archiveResult = await runtime.archiveSessionSource(await runtime.getSession(sessionId), { reason: "archived" });
    assert.equal(archiveResult.removed, true);
    assert.equal(await pathExists(worktreePath), false);
    const metadata = await runtime.store.readMetadata(sessionId);
    const bundlePath = recordedCheckpointBundle(runtime, metadata);
    assert.ok(bundlePath, `no checkpoint backup: ${metadata.source_recovery_checkpoint_backup_error}`);
    const objectCount = await bundleObjectCount(bundlePath);
    const restoreVerificationCommands = commandRequests.filter(({ args = [] }) => (
      args.includes("--git-dir") || (args[0] === "init" && args[1] === "--bare")
    ));
    // The restore proof runs from the worktree, never from the artifacts it writes.
    assert.ok(restoreVerificationCommands.length > 0);
    assert.ok(restoreVerificationCommands.every(({ cwd }) => cwd === worktreePath));

    // Restore: a plain clone of the project has the history the bundle leaves out.
    const restored = path.join(targetRoot, "checkpoint-restore.git");
    await git(targetRoot, ["clone", "--bare", "--quiet", targetRoot, restored]);
    await git(restored, ["fetch", bundlePath, "refs/vibe64/checkpoints/*:refs/vibe64/checkpoints/*"]);
    for (const { commit, ref } of turns) {
      assert.equal(await git(restored, ["rev-parse", ref]), commit);
    }
    assert.equal(await git(restored, ["rev-parse", latestRef]), turns.at(-1).commit);
    assert.equal(await git(restored, ["show", `${turns.at(-1).commit}:app.txt`]), `turn ${checkpoints}`);
    await git(restored, ["fsck", "--connectivity-only", "--no-dangling"]);

    const archived = await runtime.archiveSession(sessionId);
    assert.equal(archived.status, "archived");
    return { metadata, objectCount, turns };
  });
}

test("archive backs up turn checkpoints to Project Backups with only their own objects, whatever the history, and they restore into a clone of the project", async () => {
  const short = await archiveCheckpointedSession({ checkpoints: 6, historyLength: 20 });
  const long = await archiveCheckpointedSession({ checkpoints: 6, historyLength: 400 });
  const moreTurns = await archiveCheckpointedSession({ checkpoints: 12, historyLength: 400 });
  // Each checkpoint adds its commit, its root tree and the one file it changed; the project's
  // history, 20 or 400 commits, adds nothing.
  assert.deepEqual(
    { short: short.objectCount, long: long.objectCount, moreTurns: moreTurns.objectCount },
    { short: 18, long: 18, moreTurns: 36 }
  );
  assert.equal(long.metadata.source_recovery_checkpoint_backup, "session-checkpoints-checkout-fixes-checkpoint_archive.bundle");
  assert.equal(long.metadata.source_recovery_checkpoint_backup_error, "");
});

test("a turn checkpoint backup that fails never fails the archive: it goes on without it and says why", async (t) => {
  for (const failure of ["changed_ref", "interrupted_command", "missing_objects"]) {
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
          runCommand: runVibe64Command,
          timestamp: "2026-08-18T09:00:00.000Z",
          worktreePath
        });
        let failureInjected = false;
        const releaseManagedExecution = installVibe64ManagedExecutionProvider({
          async runCommand(request, { runLocal }) {
            const args = request.args || [];
            if (args[0] !== "--git-dir") return runLocal();
            if (failure === "interrupted_command" && args.includes("unbundle")) {
              failureInjected = true;
              return { ok: false, stderr: "simulated managed command interruption" };
            }
            const result = await runLocal();
            if (failure === "changed_ref" && args.includes("unbundle")) {
              failureInjected = true;
              return { ...result, stdout: String(result.stdout || "").replace(checkpoint.commit, baseCommit) };
            }
            if (failure === "missing_objects" && args.includes("--batch-all-objects")) {
              failureInjected = true;
              return { ...result, stdout: String(result.stdout || "").replace(checkpoint.commit, "") };
            }
            return result;
          },
          async stopExecution() {
            return { ok: true, stopped: false };
          }
        });
        t.after(releaseManagedExecution);

        const archiveResult = await runtime.archiveSessionSource(await runtime.getSession(sessionId), { reason: "archived" });
        assert.equal(failureInjected, true);
        const error = {
          changed_ref: /did not restore the exact checkpoint refs/u,
          interrupted_command: /simulated managed command interruption/u,
          missing_objects: /lacks 1 objects its checkpoints need/u
        }[failure];
        assert.equal(archiveResult.removed, true);
        assert.equal(archiveResult.dirty, true);
        assert.equal(archiveResult.checkpointBackupFailures.length, 1);
        assert.equal(archiveResult.checkpointBackupFailures[0].repository, "source");
        assert.match(archiveResult.checkpointBackupFailures[0].error, error);
        assert.equal(await pathExists(worktreePath), false);
        const metadata = await runtime.store.readMetadata(sessionId);
        assert.equal(metadata.source_removed, "yes");
        assert.equal(metadata.source_recovery_checkpoint_backup, "");
        assert.match(metadata.source_recovery_checkpoint_backup_error, error);
        // An unproven bundle is not left in Project Backups; the unsaved work is still recovered.
        const backupsRoot = runtime.store.paths().projectBackupsRoot;
        assert.deepEqual((await readdir(backupsRoot)).filter((name) => name.endsWith(".bundle")), []);
        assert.equal(metadata.source_recovery_patch_artifact, "recovery/worktree.patch");
        const archived = await runtime.archiveSession(sessionId);
        assert.equal(archived.status, "archived");
      });
    });
  }
});
