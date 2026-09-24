import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { repositoryBranches } from "../../packages/vibe64-project/src/server/repositoryBranches.js";

import {
  CANONICAL_REPOSITORY_PUSH_OPTION,
  canonicalRepositoryBackupPath,
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript,
  githubMirrorRefreshInvocation
} from "../../packages/vibe64-execution/src/server/repositoryStorage.js";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function run(command, args = [], cwd = "") {
  const result = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8"
  });
  return String(result.stdout || "").trim();
}

function runScript(script = "", cwd = "") {
  return run("bash", ["-lc", script], cwd);
}

async function createRepositoryWithCommit(repositoryRoot, contents = "one\n") {
  await mkdir(repositoryRoot, {
    recursive: true
  });
  await run("git", ["init", "--initial-branch=main"], repositoryRoot);
  await run("git", ["config", "user.name", "Vibe64 Test"], repositoryRoot);
  await run("git", ["config", "user.email", "test@vibe64.invalid"], repositoryRoot);
  await writeFile(path.join(repositoryRoot, "value.txt"), contents, "utf8");
  await run("git", ["add", "value.txt"], repositoryRoot);
  await run("git", ["commit", "-m", "Initial value"], repositoryRoot);
  return run("git", ["rev-parse", "HEAD"], repositoryRoot);
}

test("canonical repository pushes are guarded and copy the old ref to backup storage", async () => {
  await withTemporaryRoot(async (root) => {
    const sourceRoot = path.join(root, "source");
    const canonicalPath = path.join(root, "canonical-repository", "repository.git");
    const backupPath = canonicalRepositoryBackupPath(canonicalPath);
    const firstCommit = await createRepositoryWithCommit(sourceRoot);

    await runScript(canonicalRepositoryInitializeScript({
      defaultBranch: "main",
      repositoryPath: canonicalPath
    }), root);
    await runScript(canonicalRepositoryInstallRefScript({
      repositoryPath: canonicalPath,
      sourceRef: "refs/heads/main",
      sourceRepository: sourceRoot,
      targetRef: "refs/heads/main"
    }), root);
    const project = { slug: "test", projectRuntimeRoot: root, canonicalRepositoryPath: canonicalPath,
      repository: { mode: "managed_git", defaultBranch: "main" } };
    const options = { runCommand: async (request) => {
      try { return { ok: true, stdout: await run(request.command, request.args, request.cwd) }; }
      catch (error) { return { ok: false, stderr: error.stderr || error.message }; }
    } };
    const listed = await repositoryBranches(project, {}, options);
    assert.deepEqual(listed.branches, [{ name: "main", commit: firstCommit }]);
    const selection = { name: "feature/search", fromBranch: "main", expectedCommit: firstCommit };
    await repositoryBranches(project, { selection }, options);
    assert.equal(await run("git", ["--git-dir", canonicalPath, "rev-parse", "refs/heads/feature/search"], root), firstCommit);
    await assert.rejects(repositoryBranches(project, { selection }, options), /already exists/u);
    await assert.rejects(repositoryBranches(project, { selection: { name: "main", expectedCommit: "b".repeat(40) } }, options), /changed/u);

    const worktreeRoot = path.join(root, "worktree");
    await run("git", ["clone", canonicalPath, worktreeRoot], root);
    await run("git", ["config", "user.name", "Vibe64 Test"], worktreeRoot);
    await run("git", ["config", "user.email", "test@vibe64.invalid"], worktreeRoot);
    await writeFile(path.join(worktreeRoot, "value.txt"), "two\n", "utf8");
    await run("git", ["add", "value.txt"], worktreeRoot);
    await run("git", ["commit", "-m", "Second value"], worktreeRoot);
    await run("git", [
      "push",
      "--atomic",
      `--push-option=${CANONICAL_REPOSITORY_PUSH_OPTION}`,
      "origin",
      "HEAD:refs/heads/main"
    ], worktreeRoot);

    const backups = (await run("git", [
      "--git-dir",
      backupPath,
      "for-each-ref",
      "--format=%(objectname)",
      "refs/vibe64/backups"
    ], root)).split("\n").filter(Boolean);
    assert.deepEqual(backups, [firstCommit]);
    await assert.rejects(() => run("git", [
      "push",
      "origin",
      "HEAD:refs/heads/unguarded"
    ], worktreeRoot));
    await assert.rejects(() => run("git", [
      "push",
      "--atomic",
      `--push-option=${CANONICAL_REPOSITORY_PUSH_OPTION}`,
      "origin",
      "HEAD:refs/heads/one",
      "HEAD:refs/heads/two"
    ], worktreeRoot));
    assert.equal(await run("git", [
      "--git-dir",
      canonicalPath,
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads/one",
      "refs/heads/two"
    ], root), "");
  });
});

test("canonical administrative installs back up old refs and require fast-forwards by default", async () => {
  await withTemporaryRoot(async (root) => {
    const sourceRoot = path.join(root, "source");
    const canonicalPath = path.join(root, "canonical-repository", "repository.git");
    const backupPath = canonicalRepositoryBackupPath(canonicalPath);
    const firstCommit = await createRepositoryWithCommit(sourceRoot);
    await runScript(canonicalRepositoryInitializeScript({
      repositoryPath: canonicalPath
    }), root);
    await runScript(canonicalRepositoryInstallRefScript({
      repositoryPath: canonicalPath,
      sourceRef: "refs/heads/main",
      sourceRepository: sourceRoot,
      targetRef: "refs/heads/main"
    }), root);

    await writeFile(path.join(sourceRoot, "value.txt"), "two\n", "utf8");
    await run("git", ["add", "value.txt"], sourceRoot);
    await run("git", ["commit", "-m", "Second value"], sourceRoot);
    const secondCommit = await run("git", ["rev-parse", "HEAD"], sourceRoot);
    await runScript(canonicalRepositoryInstallRefScript({
      repositoryPath: canonicalPath,
      sourceRef: "refs/heads/main",
      sourceRepository: sourceRoot,
      targetRef: "refs/heads/main"
    }), root);

    const internalBackups = await run("git", [
      "--git-dir",
      canonicalPath,
      "for-each-ref",
      "--format=%(objectname)",
      "refs/vibe64/backups"
    ], root);
    const durableBackups = await run("git", [
      "--git-dir",
      backupPath,
      "for-each-ref",
      "--format=%(objectname)",
      "refs/vibe64/backups"
    ], root);
    assert.equal(internalBackups, "");
    assert.equal(durableBackups, firstCommit);
    assert.equal(await run("git", ["--git-dir", canonicalPath, "rev-parse", "refs/heads/main"], root), secondCommit);

    await run("git", ["reset", "--hard", firstCommit], sourceRoot);
    await writeFile(path.join(sourceRoot, "value.txt"), "diverged\n", "utf8");
    await run("git", ["add", "value.txt"], sourceRoot);
    await run("git", ["commit", "-m", "Diverged value"], sourceRoot);
    await assert.rejects(() => runScript(canonicalRepositoryInstallRefScript({
      repositoryPath: canonicalPath,
      sourceRef: "refs/heads/main",
      sourceRepository: sourceRoot,
      targetRef: "refs/heads/main"
    }), root));
    assert.equal(await run("git", ["--git-dir", canonicalPath, "rev-parse", "refs/heads/main"], root), secondCommit);
  });
});

test("GitHub mirror refresh creates and advances a disposable bare mirror", async () => {
  await withTemporaryRoot(async (root) => {
    const remotePath = path.join(root, "remote.git");
    const sourceRoot = path.join(root, "source");
    const mirrorPath = path.join(root, "github-mirror", "repository.git");
    await run("git", ["init", "--bare", "--initial-branch=trunk", remotePath], root);
    await createRepositoryWithCommit(sourceRoot);
    await run("git", ["remote", "add", "origin", remotePath], sourceRoot);
    await run("git", ["push", "origin", "HEAD:refs/heads/trunk"], sourceRoot);

    let [command, ...args] = githubMirrorRefreshInvocation({
      mirrorPath,
      remoteUrl: remotePath
    });
    await Promise.all([
      run(command, args, root),
      run(command, args, root)
    ]);
    const firstMirrorCommit = await run("git", ["--git-dir", mirrorPath, "rev-parse", "refs/heads/trunk"], root);

    await writeFile(path.join(sourceRoot, "value.txt"), "updated\n", "utf8");
    await run("git", ["add", "value.txt"], sourceRoot);
    await run("git", ["commit", "-m", "Update value"], sourceRoot);
    await run("git", ["push", "origin", "HEAD:refs/heads/trunk"], sourceRoot);
    [command, ...args] = githubMirrorRefreshInvocation({
      mirrorPath,
      remoteUrl: remotePath
    });
    await run(command, args, root);

    assert.notEqual(await run("git", ["--git-dir", mirrorPath, "rev-parse", "refs/heads/trunk"], root), firstMirrorCommit);
    assert.equal(await run("git", ["--git-dir", mirrorPath, "symbolic-ref", "HEAD"], root), "refs/heads/trunk");
  });
});

test("GitHub mirror refresh rejects paths outside the dedicated mirror directory", async () => {
  await withTemporaryRoot(async (root) => {
    const unsafePath = path.join(root, "repository.git");
    await mkdir(unsafePath, {
      recursive: true
    });
    const [command, ...args] = githubMirrorRefreshInvocation({
      mirrorPath: unsafePath,
      remoteUrl: path.join(root, "remote.git")
    });

    await assert.rejects(() => run(command, args, root));
    await access(unsafePath);
  });
});

test("canonical repository initialization rejects a symlinked storage role", async () => {
  await withTemporaryRoot(async (root) => {
    const externalRoot = path.join(root, "external-canonical-storage");
    const canonicalRoot = path.join(root, "canonical-repository");
    await mkdir(externalRoot, {
      recursive: true
    });
    await symlink(externalRoot, canonicalRoot, "dir");

    await assert.rejects(() => runScript(canonicalRepositoryInitializeScript({
      repositoryPath: path.join(canonicalRoot, "repository.git")
    }), root));
    await assert.rejects(() => access(path.join(externalRoot, "repository.git")));
  });
});

test("GitHub mirror refresh rejects a symlinked storage role", async () => {
  await withTemporaryRoot(async (root) => {
    const remotePath = path.join(root, "remote.git");
    const externalRoot = path.join(root, "external-mirror-storage");
    const mirrorRoot = path.join(root, "github-mirror");
    await run("git", ["init", "--bare", remotePath], root);
    await mkdir(externalRoot, {
      recursive: true
    });
    await symlink(externalRoot, mirrorRoot, "dir");
    const [command, ...args] = githubMirrorRefreshInvocation({
      mirrorPath: path.join(mirrorRoot, "repository.git"),
      remoteUrl: remotePath
    });

    await assert.rejects(() => run(command, args, root));
    await assert.rejects(() => access(path.join(externalRoot, "repository.git")));
  });
});
