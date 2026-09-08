import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  checkSessionUpdates,
  inspectSessionChangeDiff,
  inspectSessionChanges,
  inspectSessionWork,
  prepareSessionWorkSaveMessage,
  recoverSessionWorkUpdate,
  recoverSessionWorkSave,
  safeChangePath,
  saveSessionWork as saveManagedSessionWorkImplementation,
  saveSessionWorkDirect as saveSessionWorkImplementation,
  updateSessionWork
} from "../../packages/vibe64-terminals/src/server/sessionWorkSave.js";
import {
  canonicalRepositoryBackupPath,
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript
} from "../../packages/vibe64-execution/src/server/repositoryStorage.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args, input = undefined) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "vibe64@example.test",
      GIT_AUTHOR_NAME: "Vibe64 Test",
      GIT_COMMITTER_EMAIL: "vibe64@example.test",
      GIT_COMMITTER_NAME: "Vibe64 Test"
    },
    input
  });
  return String(result.stdout || "").trim();
}

async function commandRunner(request = {}) {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args || [], {
      cwd: request.cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: "vibe64@example.test",
        GIT_AUTHOR_NAME: "Vibe64 Test",
        GIT_COMMITTER_EMAIL: "vibe64@example.test",
        GIT_COMMITTER_NAME: "Vibe64 Test",
        ...(request.env || {})
      }
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", (error) => resolve({
      code: "git_failed",
      error: error.message,
      ok: false,
      output: `${stdout}${stderr}`,
      stderr,
      stdout
    }));
    child.once("close", (code) => resolve({
      ...(code === 0 ? {} : { code: "git_failed" }),
      ok: code === 0,
      output: stdout,
      stderr,
      stdout
    }));
    if (request.input !== undefined && request.input !== null) {
      child.stdin.end(request.input);
    } else {
      child.stdin.end();
    }
  });
}

function saveSessionWork(input = {}) {
  return saveSessionWorkImplementation({
    message: "Improve tested project behavior",
    ...input
  });
}

async function createRemoteFixture(root) {
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  await git(root, ["init", "--bare", "--initial-branch=main", remote]);
  await git(root, ["clone", remote, seed]);
  await writeFile(path.join(seed, "shared.txt"), "initial\n", "utf8");
  await git(seed, ["add", "shared.txt"]);
  await git(seed, ["commit", "-m", "initial"]);
  await git(seed, ["push", "origin", "main"]);
  return {
    baseCommit: await git(seed, ["rev-parse", "HEAD"]),
    remote,
    seed
  };
}

async function sessionForRemote(root, fixture, id = "session-1") {
  const source = path.join(root, id);
  await git(root, ["clone", "--branch", "main", fixture.remote, source]);
  await git(source, ["checkout", "-b", `vibe64/${id}`]);
  return {
    metadata: {
      base_branch: "main",
      base_commit: fixture.baseCommit,
      branch: `vibe64/${id}`,
      source_path: source,
      source_remote_url: fixture.remote
    },
    sessionId: id,
    sourcePath: source
  };
}

function githubProject(root, remote) {
  const projectRuntimeRoot = path.join(root, "project-runtime");
  return {
    githubMirrorPath: path.join(projectRuntimeRoot, "github-mirror", "repository.git"),
    githubRepository: {
      cloneUrl: remote
    },
    path: path.join(root, "project-cache"),
    projectRuntimeRoot,
    repository: {
      defaultBranch: "main",
      mode: "github"
    },
    repositoryMode: "github",
    slug: "test-project"
  };
}

function runScript(script = "", cwd = "") {
  return execFileAsync("bash", ["-lc", script], {
    cwd,
    encoding: "utf8"
  });
}

function managedGitProject(root, canonicalRepositoryPath) {
  return {
    canonicalRepositoryPath,
    path: path.join(root, "project-cache"),
    repository: {
      defaultBranch: "main",
      mode: "managed_git"
    },
    repositoryMode: "managed_git"
  };
}

test("Save uses two foreground managed jobs and defers disposable cache maintenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-stages-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    const requests = [];
    const progressStages = [];
    await writeFile(path.join(session.sourcePath, "saved.txt"), "saved\n", "utf8");

    const saveMessageInput = await prepareSessionWorkSaveMessage({
      derivedArtifactPaths: [],
      limit: 40,
      operationId: "save-managed-stages",
      project,
      runCommand: async (request) => {
        requests.push(request);
        return commandRunner(request);
      },
      session
    });
    let finishMaintenance;
    const maintenanceFinished = new Promise((resolve) => {
      finishMaintenance = resolve;
    });

    const result = await saveManagedSessionWorkImplementation({
      checkpoint: saveMessageInput.checkpoint,
      derivedArtifactPaths: [],
      identity: {
        email: "vibe64@example.test",
        name: "Vibe64 Test"
      },
      message: "Save through bounded managed stages",
      onCacheMaintenance: finishMaintenance,
      onProgress: async ({ stage }) => {
        progressStages.push(stage);
      },
      operationId: "save-managed-stages",
      project,
      runCommand: async (request) => {
        requests.push(request);
        return commandRunner(request);
      },
      session
    });
    const cacheMaintenance = await maintenanceFinished;

    const payloads = requests.map((request) => JSON.parse(String(request.input || "{}")));
    assert.equal(result.status, "saved");
    assert.equal(result.cacheMaintenance.status, "deferred");
    assert.equal(cacheMaintenance.status, "current", JSON.stringify(cacheMaintenance));
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), result.saveCommit);
    assert.equal(requests.length, 3);
    assert.ok(requests.every((request) => request.command === "node"));
    assert.deepEqual(payloads.map((payload) => payload.operation), [
      "save-message",
      "save",
      "save-maintenance"
    ]);
    assert.deepEqual(progressStages, ["publishing"]);
    assert.deepEqual(saveMessageInput.changes.files.map((file) => file.path), ["saved.txt"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed Save publishes its named checkpoint and preserves work added during naming", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-naming-race-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "named checkpoint\n", "utf8");
    const saveMessageInput = await prepareSessionWorkSaveMessage({
      operationId: "save-naming-race",
      project,
      runCommand: commandRunner,
      session
    });
    await writeFile(path.join(session.sourcePath, "shared.txt"), "later work\n", "utf8");

    const result = await saveManagedSessionWorkImplementation({
      checkpoint: saveMessageInput.checkpoint,
      message: "Save the named work",
      operationId: "save-naming-race",
      project,
      runCommand: commandRunner,
      session
    });
    assert.equal(result.status, "saved");
    assert.equal(result.reconciled, true);
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), result.saveCommit);
    assert.equal(await git(fixture.remote, ["show", "main:shared.txt"]), "named checkpoint");
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), result.saveCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "later work\n");
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /shared\.txt/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("work inspection compares the complete session tree with its verified canonical base", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    const hostileMarker = path.join(project.path, ".git", "HOSTILE");
    const requests = [];
    let activeCommands = 0;
    let peakActiveCommands = 0;
    await mkdir(path.dirname(hostileMarker), { recursive: true });
    await writeFile(hostileMarker, "must remain untouched\n", "utf8");
    await writeFile(path.join(session.sourcePath, "committed-locally.txt"), "session work\n", "utf8");
    await git(session.sourcePath, ["add", "committed-locally.txt"]);
    await git(session.sourcePath, ["commit", "-m", "local session commit"]);

    const result = await inspectSessionWork({
      project,
      runCommand: async (request) => {
        requests.push(request);
        activeCommands += 1;
        peakActiveCommands = Math.max(peakActiveCommands, activeCommands);
        try {
          return await commandRunner(request);
        } finally {
          activeCommands -= 1;
        }
      },
      session
    });

    assert.equal(result.ok, true);
    assert.equal(result.repositoryMode, "github");
    assert.equal(result.canonicalCommit, fixture.baseCommit);
    assert.equal(result.sessionHead, await git(session.sourcePath, ["rev-parse", "HEAD"]));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].command, "node");
    assert.deepEqual(requests[0].runtimes, ["node26", "git"]);
    assert.ok(requests.every((request) => path.resolve(request.cwd) !== path.resolve(project.path)));
    assert.ok(requests.every((request) => !(request.allowedRoots || [])
      .some((rootPath) => path.resolve(rootPath) === path.resolve(project.path))));
    assert.ok(requests.every((request) => request.execution?.label === "Inspecting session work"));
    assert.ok(requests.every((request) => request.execution?.projectSlug === "test-project"));
    assert.ok(requests.every((request) => request.execution?.sessionId === session.sessionId));
    assert.equal(new Set(requests.map((request) => request.execution?.operationId)).size, 1);
    assert.equal(peakActiveCommands, 1);
    assert.equal(await readFile(hostileMarker, "utf8"), "must remain untouched\n");
    assert.equal(result.dirty, false, "the working tree itself is clean");
    assert.equal(result.unsaved, true, "the complete session tree still differs from canonical");
    assert.equal(result.ahead, 1);
    assert.equal(result.behind, 0);
    assert.equal(result.updateAvailable, false);
    assert.equal(result.worktreeClean, true);
    assert.equal(path.resolve(result.worktreeTopLevel), path.resolve(session.sourcePath));
    assert.deepEqual(result.changedPaths, ["committed-locally.txt"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("current changes returns a bounded canonical file list and one selected-file diff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "changed\n", "utf8");
    await writeFile(path.join(session.sourcePath, "new file.txt"), "new\n", "utf8");

    const requests = [];
    const changes = await inspectSessionChanges({
      limit: 1,
      project: githubProject(root, fixture.remote),
      runCommand: async (request) => {
        requests.push(request);
        return commandRunner(request);
      },
      session
    });

    assert.equal(changes.unsaved, true);
    assert.equal(changes.totalCount, 2);
    assert.equal(changes.files.length, 1);
    assert.equal(changes.truncated, true);
    assert.deepEqual(changes.files[0], {
      added: 1,
      deleted: 0,
      path: "new file.txt",
      status: "A"
    });
    assert.equal(changes.initialDiff.path, "new file.txt");
    assert.match(changes.initialDiff.diff, /\+new/u);
    assert.equal(changes.initialDiff.worktreeTree, changes.worktreeTree);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].command, "node");

    const fileDiff = await inspectSessionChangeDiff({
      path: "shared.txt",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(fileDiff.path, "shared.txt");
    assert.match(fileDiff.diff, /-initial/u);
    assert.match(fileDiff.diff, /\+changed/u);
    assert.equal(fileDiff.truncated, false);

    await assert.rejects(inspectSessionChangeDiff({
      path: "../outside.txt",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), (error) => error.code === "vibe64_session_change_path_invalid");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("current changes isolates a deleted file from its replacement directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-change-file-directory-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    await git(session.sourcePath, ["rm", "shared.txt"]);
    await mkdir(path.join(session.sourcePath, "shared.txt"));
    await writeFile(path.join(session.sourcePath, "shared.txt", "child.txt"), "replacement child\n", "utf8");
    const requests = [];
    const changes = await inspectSessionChanges({
      project,
      runCommand: async (request) => {
        requests.push(request);
        return commandRunner(request);
      },
      session
    });
    assert.deepEqual(changes.files, [
      { added: 0, deleted: 1, path: "shared.txt", status: "D" },
      { added: 1, deleted: 0, path: "shared.txt/child.txt", status: "A" }
    ]);
    assert.equal(changes.totalCount, 2);
    assert.deepEqual(new Set(changes.changedPaths), new Set(["shared.txt", "shared.txt/child.txt"]));

    await t.test("initialDiff contains only the selected deleted file from the same snapshot", () => {
      assert.equal(requests.length, 1);
      assert.equal(requests[0].command, "node");
      assert.equal(changes.initialDiff.path, changes.files[0].path);
      assert.equal(changes.initialDiff.worktreeTree, changes.worktreeTree);
      assert.ok(changes.initialDiff.diff.split("\n").includes("-initial"));
      assert.equal(changes.initialDiff.diff.includes("replacement child"), false, changes.initialDiff.diff);
      assert.equal(changes.initialDiff.diff.split("\n").filter((line) => line.startsWith("diff --git ")).length, 1);
    });

    for (const [filePath, expectedLine, excludedLine] of [
      ["shared.txt", "-initial", "+replacement child"],
      ["shared.txt/child.txt", "+replacement child", "-initial"]
    ]) {
      await t.test(`explicit diff for ${filePath} stays within that exact entry in one job`, async () => {
        const selectedRequests = [];
        const diff = await inspectSessionChangeDiff({
          path: filePath,
          project,
          runCommand: async (request) => {
            selectedRequests.push(request);
            return commandRunner(request);
          },
          session
        });
        assert.equal(selectedRequests.length, 1);
        assert.equal(selectedRequests[0].command, "node");
        assert.equal(diff.path, filePath);
        assert.equal(diff.canonicalCommit, fixture.baseCommit);
        assert.equal(diff.worktreeTree, changes.worktreeTree);
        const lines = diff.diff.split("\n");
        assert.ok(lines.includes(expectedLine), diff.diff);
        assert.equal(lines.includes(excludedLine), false, diff.diff);
        assert.equal(lines.filter((line) => line.startsWith("diff --git ")).length, 1);
      });
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

for (const entry of [
  { label: "wildcard", path: "[ab].txt", otherPath: "a.txt" },
  { label: "leading-colon", path: ":literal.txt", otherPath: "literal.txt" },
  { label: "whitespace", path: " report.txt ", otherPath: "report.txt" },
  { label: "tab-bearing", path: "tab\tname.txt", otherPath: "tab-name.txt" },
  { label: "backslash", path: "nested\\file.txt", otherPath: "nested/file.txt" }
]) {
  test(`current changes treats a ${entry.label} filename literally`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-change-literal-path-"));
    try {
      const fixture = await createRemoteFixture(root);
      const session = await sessionForRemote(root, fixture);
      const project = githubProject(root, fixture.remote);
      await mkdir(path.dirname(path.join(session.sourcePath, entry.path)), { recursive: true });
      await mkdir(path.dirname(path.join(session.sourcePath, entry.otherPath)), { recursive: true });
      await writeFile(path.join(session.sourcePath, entry.path), "selected literal filename\n", "utf8");
      await writeFile(path.join(session.sourcePath, entry.otherPath), "unrelated matching filename\n", "utf8");

      const initialRequests = [];
      const changes = await inspectSessionChanges({
        project,
        runCommand: async (request) => {
          initialRequests.push(request);
          return commandRunner(request);
        },
        session
      });
      assert.equal(changes.canonicalCommit, fixture.baseCommit);
      assert.equal(initialRequests.length, 1);
      assert.equal(initialRequests[0].command, "node");
      assert.equal(initialRequests[0].execution.sessionId, session.sessionId);

      await t.test("retains both exact file identities and their nonzero counts", () => {
        assert.equal(changes.totalCount, 2);
        assert.equal(changes.files.length, 2);
        assert.equal(changes.truncated, false);
        assert.deepEqual(new Set(changes.changedPaths), new Set([entry.path, entry.otherPath]));
        assert.deepEqual(new Set(changes.files.map((file) => file.path)), new Set([entry.path, entry.otherPath]));
        for (const filePath of [entry.path, entry.otherPath]) {
          assert.deepEqual(
            changes.files.find((file) => file.path === filePath),
            { added: 1, deleted: 0, path: filePath, status: "A" }
          );
        }
      });

      await t.test("initialDiff contains only the selected file from the same snapshot", () => {
        assert.equal(changes.initialDiff.path, changes.files[0].path);
        assert.equal(changes.initialDiff.worktreeTree, changes.worktreeTree);
        const firstIsSelected = changes.files[0].path === entry.path;
        const expectedText = firstIsSelected ? "selected literal filename" : "unrelated matching filename";
        const excludedText = firstIsSelected ? "unrelated matching filename" : "selected literal filename";
        assert.ok(changes.initialDiff.diff.split("\n").includes(`+${expectedText}`), changes.initialDiff.diff);
        assert.equal(changes.initialDiff.diff.includes(excludedText), false, changes.initialDiff.diff);
      });

      await t.test("explicit selected-file diff contains only that file in one job", async () => {
        const selectedRequests = [];
        const fileDiff = await inspectSessionChangeDiff({
          path: entry.path,
          project,
          runCommand: async (request) => {
            selectedRequests.push(request);
            return commandRunner(request);
          },
          session
        });
        assert.equal(selectedRequests.length, 1);
        assert.equal(selectedRequests[0].command, "node");
        assert.equal(selectedRequests[0].execution.sessionId, session.sessionId);
        assert.equal(fileDiff.path, entry.path);
        assert.equal(fileDiff.canonicalCommit, fixture.baseCommit);
        assert.equal(fileDiff.worktreeTree, changes.worktreeTree);
        assert.ok(fileDiff.diff.split("\n").includes("+selected literal filename"), fileDiff.diff);
        assert.equal(fileDiff.diff.includes("unrelated matching filename"), false, fileDiff.diff);
      });

      await t.test("unchanged files and traversal remain rejected", async () => {
        await assert.rejects(inspectSessionChangeDiff({
          path: "shared.txt",
          project,
          runCommand: commandRunner,
          session
        }), (error) => error.code === "vibe64_session_change_not_found");
        await assert.rejects(inspectSessionChangeDiff({
          path: "../outside.txt",
          project,
          runCommand: commandRunner,
          session
        }), (error) => error.code === "vibe64_session_change_path_invalid");
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
}

test("changed-file path validation rejects absolute paths, traversal and NUL", () => {
  assert.equal(safeChangePath("nested/file.txt"), "nested/file.txt");
  for (const invalidPath of [
    "", "/outside.txt", "..", "../outside.txt", "nested/../../outside.txt", "file\0name.txt",
    "./nested/file.txt", "nested//file.txt", "nested/../file.txt"
  ]) {
    assert.throws(() => safeChangePath(invalidPath), { code: "vibe64_session_change_path_invalid" });
  }
});

test("current changes preserves renamed filenames and binary statistics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-change-rename-binary-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const renamedPath = " renamed\tfile.txt ";
    const binaryPath = "binary\tdata.bin";
    await git(session.sourcePath, ["mv", "--", "shared.txt", renamedPath]);
    await writeFile(path.join(session.sourcePath, binaryPath), Buffer.from([0, 1, 2, 3]));
    const requests = [];
    const changes = await inspectSessionChanges({
      project: githubProject(root, fixture.remote),
      runCommand: async (request) => {
        requests.push(request);
        return commandRunner(request);
      },
      session
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].command, "node");
    assert.equal(changes.totalCount, 2);
    assert.equal(changes.files.length, 2);
    assert.deepEqual(changes.files.find((file) => file.path === renamedPath), {
      added: 0,
      deleted: 0,
      path: renamedPath,
      previousPath: "shared.txt",
      status: "R"
    });
    assert.deepEqual(changes.files.find((file) => file.path === binaryPath), {
      added: null,
      deleted: null,
      path: binaryPath,
      status: "A"
    });
    assert.equal(changes.initialDiff.path, changes.files[0].path);
    assert.equal(changes.initialDiff.worktreeTree, changes.worktreeTree);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local-source current changes reuses one snapshot for its initial file diff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const baseline = path.join(root, "baseline");
    await git(root, ["init", "--initial-branch=main", baseline]);
    await writeFile(path.join(baseline, "app.txt"), "initial\n", "utf8");
    await git(baseline, ["add", "app.txt"]);
    await git(baseline, ["commit", "-m", "initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    const source = path.join(root, "session-local");
    await git(root, ["clone", "--branch", "main", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-local"]);
    await writeFile(path.join(source, "app.txt"), "changed locally\n", "utf8");

    const changes = await inspectSessionChanges({
      project: {
        sourceRoot: baseline,
        repository: { defaultBranch: "main", mode: "local_source" }
      },
      runCommand: commandRunner,
      session: {
        metadata: {
          base_branch: "main",
          base_commit: baseCommit,
          branch: "vibe64/session-local",
          source_path: source
        },
        sessionId: "session-local",
        sourcePath: source
      }
    });

    assert.equal(changes.repositoryMode, "local_source");
    assert.equal(changes.canonicalCommit, baseCommit);
    assert.deepEqual(changes.files.map(({ path: filePath }) => filePath), ["app.txt"]);
    assert.equal(changes.initialDiff.path, "app.txt");
    assert.match(changes.initialDiff.diff, /-initial/u);
    assert.match(changes.initialDiff.diff, /\+changed locally/u);
    assert.equal(changes.initialDiff.worktreeTree, changes.worktreeTree);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Update preserves unsaved session work while advancing to newer GitHub work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "local.txt"), "local\n", "utf8");

    const checkRequests = [];
    const check = await checkSessionUpdates({
      operationId: "check-github-update",
      project: githubProject(root, fixture.remote),
      runCommand: async (request) => {
        checkRequests.push(request);
        return commandRunner(request);
      },
      session
    });
    assert.equal(check.behind, 1);
    assert.equal(check.ahead, 0);
    assert.equal(check.relationship, "behind");
    assert.equal(check.updateStrategy, "rebase");
    assert.equal(check.updateAvailable, true);
    assert.equal(check.incomingVersions.length, 1);
    assert.equal(check.incomingVersions[0].commit, canonicalCommit);
    assert.equal(check.incomingVersions[0].message, "remote advance");
    assert.equal(check.incomingVersionsTruncated, false);
    assert.equal(checkRequests.length, 1);
    assert.equal(checkRequests[0].command, "node");
    assert.deepEqual(checkRequests[0].runtimes, ["node26", "git"]);
    assert.ok(checkRequests.every((request) => (
      request.execution?.label === "Checking repository for updates" &&
      request.execution?.operationId === "check-github-update" &&
      request.execution?.ownerId === session.sessionId &&
      request.execution?.projectSlug === "test-project" &&
      request.execution?.sessionId === session.sessionId
    )));

    const result = await updateSessionWork({
      operationId: "apply-github-update",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(result.status, "updated");
    assert.equal(result.canonicalCommit, canonicalCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "remote.txt"), "utf8"), "remote\n");
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /local\.txt/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

for (const localEdits of [false, true]) {
  test(`Update invalidates preparation before replacing source (local edits: ${localEdits})`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-preparation-"));
    try {
      const fixture = await createRemoteFixture(root);
      const session = await sessionForRemote(root, fixture);
      const canonicalWriter = path.join(root, "canonical-writer");
      await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
      const manifest = '{"devDependencies":{"genesis-compiler":"1.5.0"}}\n';
      await writeFile(path.join(canonicalWriter, "package.json"), manifest);
      await git(canonicalWriter, ["add", "package.json"]);
      await git(canonicalWriter, ["commit", "-m", "Declare project dependencies"]);
      await git(canonicalWriter, ["push", "origin", "main"]);
      if (localEdits) await writeFile(path.join(session.sourcePath, "local.txt"), "Keep local work.\n");
      const input = { project: githubProject(root, fixture.remote), runCommand: commandRunner, session };
      await assert.rejects(updateSessionWork({
        ...input,
        beforeSourceChange: async () => { throw new Error("Preparation state could not be persisted."); }
      }), /Preparation state could not be persisted/u);
      assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), fixture.baseCommit);
      await assert.rejects(readFile(path.join(session.sourcePath, "package.json")), { code: "ENOENT" });

      let invalidations = 0;
      const beforeSourceChange = async () => {
        assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), fixture.baseCommit);
        await assert.rejects(readFile(path.join(session.sourcePath, "package.json")), { code: "ENOENT" });
        invalidations += 1;
      };
      assert.equal((await updateSessionWork({ ...input, beforeSourceChange })).status, "updated");
      assert.equal(invalidations, 1);
      assert.equal(await readFile(path.join(session.sourcePath, "package.json"), "utf8"), manifest);
      assert.equal((await updateSessionWork({ ...input, beforeSourceChange })).status, "already_current");
      assert.equal(invalidations, 1, "A no-op Update must retain preparation.");
      if (localEdits) assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "Keep local work.\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
}

test("Update resolves Genesis-derived overlap by regenerating from the merged authored source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer-derived");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    for (const worktreePath of [session.sourcePath, canonicalWriter]) {
      await mkdir(path.join(worktreePath, ".genesis"), { recursive: true });
    }
    await writeFile(path.join(canonicalWriter, "remote.txt"), "remote\n", "utf8");
    await writeFile(path.join(canonicalWriter, ".genesis", "machine-city.json"), "{\"remote\":true}\n", "utf8");
    await git(canonicalWriter, ["add", "remote.txt", ".genesis/machine-city.json"]);
    await git(canonicalWriter, ["commit", "-m", "remote authored advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "local.txt"), "local\n", "utf8");
    await writeFile(path.join(session.sourcePath, ".genesis", "machine-city.json"), "{\"local\":true}\n", "utf8");

    const result = await updateSessionWork({
      derivedArtifactPaths: [".genesis/machine-city.json", ".genesis/program-city.json"],
      operationId: "update-derived-overlap",
      project: githubProject(root, fixture.remote),
      refreshDerivedArtifacts: async ({ projectRoot }) => {
        await mkdir(path.join(projectRoot, ".genesis"), { recursive: true });
        const local = await readFile(path.join(projectRoot, "local.txt"), "utf8");
        const remote = await readFile(path.join(projectRoot, "remote.txt"), "utf8");
        const content = JSON.stringify({ local: local.trim(), remote: remote.trim() }) + "\n";
        await writeFile(path.join(projectRoot, ".genesis", "machine-city.json"), content, "utf8");
        await writeFile(path.join(projectRoot, ".genesis", "program-city.json"), content, "utf8");
      },
      runCommand: commandRunner,
      session
    });

    assert.equal(result.status, "updated");
    assert.equal(result.canonicalCommit, canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.equal(await readFile(path.join(session.sourcePath, "remote.txt"), "utf8"), "remote\n");
    assert.equal(
      await readFile(path.join(session.sourcePath, ".genesis", "machine-city.json"), "utf8"),
      '{"local":"local","remote":"remote"}\n'
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("repeated update checks retain only the stable canonical cache ref", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-check-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);

    await checkSessionUpdates({
      operationId: "check-one",
      project,
      runCommand: commandRunner,
      session
    });
    await checkSessionUpdates({
      operationId: "check-two",
      project,
      runCommand: commandRunner,
      session
    });

    assert.equal(
      await git(session.sourcePath, [
        "for-each-ref",
        "--format=%(refname)",
        "refs/vibe64/save"
      ]),
      ""
    );
    assert.equal(
      (await git(session.sourcePath, [
        "for-each-ref",
        "--format=%(refname)",
        "refs/vibe64/canonical"
      ])).split("\n").filter(Boolean).length,
      1
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Update check distinguishes diverged history from a normal fast-forward", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "session-commit.txt"), "session\n", "utf8");
    await git(session.sourcePath, ["add", "session-commit.txt"]);
    await git(session.sourcePath, ["commit", "-m", "session commit"]);

    const canonicalWriter = path.join(root, "canonical-writer-diverged");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote-commit.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote-commit.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote commit"]);
    await git(canonicalWriter, ["push", "origin", "main"]);

    const check = await checkSessionUpdates({
      operationId: "check-diverged-update",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(check.ahead, 1);
    assert.equal(check.behind, 1);
    assert.equal(check.relationship, "diverged");
    assert.equal(check.updateAvailable, true);
    assert.equal(check.updateStrategy, "rebase");
    assert.equal(check.incomingVersions.length, 1);
    assert.equal(check.incomingVersions[0].message, "remote commit");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Update leaves HEAD, index, and worktree untouched when newer work conflicts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "shared.txt"), "remote\n", "utf8");
    await writeFile(path.join(canonicalWriter, "remote-only.txt"), "remote only\n", "utf8");
    await git(canonicalWriter, ["add", "shared.txt", "remote-only.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote conflict"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "local\n", "utf8");
    await writeFile(path.join(session.sourcePath, "local-only.txt"), "local only\n", "utf8");
    const beforeHead = await git(session.sourcePath, ["rev-parse", "HEAD"]);
    const beforeIndex = await git(session.sourcePath, ["write-tree"]);
    const beforeStatus = await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]);
    let conflictRecovery = null;

    await assert.rejects(updateSessionWork({
      operationId: "apply-conflicting-update",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), (error) => {
      conflictRecovery = error.details?.conflictRecovery || null;
      assert.equal(error.code, "vibe64_session_update_conflict");
      assert.deepEqual(error.details?.conflictPaths, ["shared.txt"]);
      assert.ok(conflictRecovery);
      return true;
    });
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), beforeHead);
    assert.equal(await git(session.sourcePath, ["write-tree"]), beforeIndex);
    assert.equal(await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]), beforeStatus);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "local\n");

    await assert.rejects(updateSessionWork({
      conflictRecovery,
      operationId: "retry-unreviewed-conflict",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), (error) => {
      assert.equal(error.code, "vibe64_session_update_conflict");
      assert.match(error.message, /has not changed since the failed update/u);
      return true;
    });
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), beforeHead);
    assert.equal(await git(session.sourcePath, ["write-tree"]), beforeIndex);

    await writeFile(path.join(session.sourcePath, "shared.txt"), "remote\nlocal\n", "utf8");
    const updated = await updateSessionWork({
      conflictRecovery,
      operationId: "retry-reviewed-conflict",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(updated.status, "updated");
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), updated.canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "remote\nlocal\n");
    assert.equal(await readFile(path.join(session.sourcePath, "remote-only.txt"), "utf8"), "remote only\n");
    assert.equal(await readFile(path.join(session.sourcePath, "local-only.txt"), "utf8"), "local only\n");
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /shared\.txt/u);
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /local-only\.txt/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Update verifies a repaired document while preserving edits made after the conflict", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-repair-"));
  try {
    const fixture = await createRemoteFixture(root);
    const body = Array.from({ length: 20 }, (_, index) => `Record ${index}.`).join("\n");
    await writeFile(path.join(fixture.seed, "shared.txt"), `Old heading\n${body}\n`);
    await git(fixture.seed, ["add", "shared.txt"]);
    await git(fixture.seed, ["commit", "-m", "document baseline"]);
    await git(fixture.seed, ["push", "origin", "main"]);
    fixture.baseCommit = await git(fixture.seed, ["rev-parse", "HEAD"]);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(fixture.seed, "shared.txt"), `Corrected heading\n${body}\n`);
    await git(fixture.seed, ["add", "shared.txt"]);
    await git(fixture.seed, ["commit", "-m", "correct heading"]);
    await git(fixture.seed, ["push", "origin", "main"]);
    await writeFile(path.join(session.sourcePath, "shared.txt"), `Session heading\n${body}\nSession decisions.\n`);
    const input = { project: githubProject(root, fixture.remote), runCommand: commandRunner, session };
    let conflictRecovery;
    await assert.rejects(updateSessionWork({ ...input, operationId: "before-repair" }), (error) => {
      assert.equal(error.code, "vibe64_session_update_conflict");
      conflictRecovery = error.details.conflictRecovery;
      return true;
    });
    const corrected = `Corrected heading\n${body}\nSession decisions.\n`;
    await writeFile(path.join(session.sourcePath, "shared.txt"), corrected);
    await writeFile(path.join(session.sourcePath, "ongoing-work.txt"), "Keep these newer edits.\n");
    const updated = await updateSessionWork({ ...input, conflictRecovery, operationId: "after-repair" });
    assert.equal(updated.status, "updated");
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), updated.canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), corrected);
    assert.equal(await readFile(path.join(session.sourcePath, "ongoing-work.txt"), "utf8"), "Keep these newer edits.\n");
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /shared\.txt/u);
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /ongoing-work\.txt/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupted Update recovery applies the prepared result exactly once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    await writeFile(path.join(session.sourcePath, "local.txt"), "local\n", "utf8");
    let recovery = {};

    await assert.rejects(updateSessionWork({
      onProgress: async (progress) => {
        recovery = { ...recovery, ...progress };
        if (progress.stage === "mutating") {
          throw new Error("simulated restart");
        }
      },
      operationId: "recover-update",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), /simulated restart/u);

    let invalidated = false;
    const result = await recoverSessionWorkUpdate({
      beforeSourceChange: async () => {
        assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), recovery.oldHead);
        invalidated = true;
      },
      project: githubProject(root, fixture.remote),
      recovery,
      runCommand: commandRunner,
      session
    });
    assert.equal(result.recovered, true);
    assert.equal(invalidated, true);
    assert.equal(result.status, "updated");
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), recovery.canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.equal(await readFile(path.join(session.sourcePath, "remote.txt"), "utf8"), "remote\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local-source Update imports the clean project baseline as canonical authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const baseline = path.join(root, "baseline");
    await git(root, ["init", "--initial-branch=main", baseline]);
    await writeFile(path.join(baseline, "base.txt"), "initial\n", "utf8");
    await git(baseline, ["add", "base.txt"]);
    await git(baseline, ["commit", "-m", "initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    const source = path.join(root, "session-local");
    await git(root, ["clone", "--branch", "main", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-local"]);
    await writeFile(path.join(source, "local.txt"), "local\n", "utf8");
    await writeFile(path.join(baseline, "remote.txt"), "baseline\n", "utf8");
    await git(baseline, ["add", "remote.txt"]);
    await git(baseline, ["commit", "-m", "baseline advance"]);
    const canonicalCommit = await git(baseline, ["rev-parse", "HEAD"]);
    const project = {
      sourceRoot: baseline,
      repository: { defaultBranch: "main", mode: "local_source" }
    };
    const session = {
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/session-local",
        source_path: source
      },
      sessionId: "session-local",
      sourcePath: source
    };

    const result = await updateSessionWork({
      operationId: "local-update",
      project,
      runCommand: commandRunner,
      session
    });
    assert.equal(result.canonicalCommit, canonicalCommit);
    assert.equal(await git(source, ["rev-parse", "HEAD"]), canonicalCommit);
    assert.equal(await readFile(path.join(source, "remote.txt"), "utf8"), "baseline\n");
    assert.equal(await readFile(path.join(source, "local.txt"), "utf8"), "local\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save refuses canonical advances until explicit Update rebases the session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "local.txt"), "local\n", "utf8");

    const project = githubProject(root, fixture.remote);
    await assert.rejects(saveSessionWork({
      operationId: "save-before-rebase",
      project,
      runCommand: commandRunner,
      session
    }), (error) => error.code === "vibe64_session_save_update_required");
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");

    const updated = await updateSessionWork({
      operationId: "rebase-before-save",
      project,
      runCommand: commandRunner,
      session
    });
    session.metadata.base_commit = updated.canonicalCommit;
    const result = await saveSessionWork({
      identity: {
        email: "person@example.test",
        name: "Person"
      },
      operationId: "save-1",
      project,
      runCommand: commandRunner,
      session
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "saved");
    assert.equal(result.reconciled, true);
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), result.saveCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), result.saveCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", `${result.saveCommit}^`]), canonicalCommit);
    assert.equal(
      await git(session.sourcePath, ["log", "-1", "--format=%s"]),
      "Improve tested project behavior"
    );
    assert.equal(await readFile(path.join(session.sourcePath, "remote.txt"), "utf8"), "remote\n");
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("verified GitHub Saves refresh cold, warm, and stale mirrors only after remote verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-mirror-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    const requests = [];
    const token = "save-private-token";
    const runCommand = async (request) => {
      requests.push(request);
      return commandRunner(request);
    };
    const save = async (operationId, filename) => {
      await writeFile(path.join(session.sourcePath, filename), `${operationId}\n`, "utf8");
      const requestOffset = requests.length;
      const result = await saveSessionWork({
        commandOptions: {
          gitAuthToken: token,
          gitTransport: "github-token"
        },
        operationId,
        project,
        runCommand,
        session
      });
      const operationRequests = requests.slice(requestOffset);
      const verificationIndex = operationRequests.findIndex((request) => (
        request.command === "git" && request.args?.[0] === "ls-remote"
      ));
      const refreshIndex = operationRequests.findIndex((request) => (
        request.command === "bash" && request.args?.includes("vibe64-github-mirror-refresh")
      ));
      assert.ok(verificationIndex >= 0);
      assert.ok(refreshIndex > verificationIndex);
      const refreshRequest = operationRequests[refreshIndex];
      assert.equal(refreshRequest.gitAuthToken, token);
      assert.equal(refreshRequest.gitTransport, "github-token");
      assert.ok(refreshRequest.args.includes(fixture.remote));
      assert.ok(refreshRequest.args.includes(project.githubMirrorPath));
      assert.equal(JSON.stringify(refreshRequest.args).includes(token), false);
      assert.equal(JSON.stringify(result).includes(token), false);
      assert.deepEqual(result.cacheMaintenance, {
        attempted: true,
        branch: "main",
        kind: "github_mirror",
        mirrorCommit: result.saveCommit,
        retryable: false,
        status: "current",
        verifiedCommit: result.saveCommit
      });
      assert.equal(
        await git(root, ["--git-dir", project.githubMirrorPath, "rev-parse", "refs/heads/main"]),
        result.saveCommit
      );
      assert.equal(
        await git(root, ["--git-dir", project.githubMirrorPath, "remote", "get-url", "origin"]),
        fixture.remote
      );
      session.metadata.base_commit = result.saveCommit;
      session.metadata.canonical_commit = result.saveCommit;
      return result;
    };

    const cold = await save("save-cold-mirror", "cold.txt");
    const warm = await save("save-warm-mirror", "warm.txt");
    assert.notEqual(cold.saveCommit, warm.saveCommit);

    const canonicalWriter = path.join(root, "external-canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "external.txt"), "external canonical advance\n", "utf8");
    await git(canonicalWriter, ["add", "external.txt"]);
    await git(canonicalWriter, ["commit", "-m", "external canonical advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const externalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    assert.equal(
      await git(root, ["--git-dir", project.githubMirrorPath, "rev-parse", "refs/heads/main"]),
      warm.saveCommit,
      "the mirror is stale before the next verified Save"
    );

    const updated = await updateSessionWork({
      operationId: "update-before-stale-mirror-save",
      project,
      runCommand,
      session
    });
    assert.equal(updated.canonicalCommit, externalCommit);
    session.metadata.base_commit = updated.canonicalCommit;
    session.metadata.canonical_commit = updated.canonicalCommit;
    const stale = await save("save-stale-mirror", "after-external.txt");
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), stale.saveCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", `${stale.saveCommit}^`]), externalCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a GitHub mirror failure remains a visible retryable warning after successful publication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-mirror-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    const progress = [];
    let rejectedRefresh = false;
    await writeFile(path.join(session.sourcePath, "published-despite-cache.txt"), "saved\n", "utf8");

    const first = await saveSessionWork({
      onProgress: async (event) => {
        progress.push(event);
      },
      operationId: "save-cache-refresh-failure",
      project,
      runCommand: async (request) => {
        if (
          !rejectedRefresh &&
          request.command === "bash" &&
          request.args?.includes("vibe64-github-mirror-refresh")
        ) {
          rejectedRefresh = true;
          return {
            code: "vibe64_test_cache_refresh_failed",
            ok: false,
            stderr: "simulated disposable cache failure"
          };
        }
        return commandRunner(request);
      },
      session
    });

    assert.equal(first.status, "saved");
    assert.equal(first.reconciled, true);
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), first.saveCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), first.saveCommit);
    assert.equal(first.cacheMaintenance.status, "retryable");
    assert.equal(first.cacheMaintenance.retryable, true);
    assert.equal(first.cacheMaintenance.reason, "refresh_failed");
    assert.equal(first.cacheMaintenance.code, "vibe64_test_cache_refresh_failed");
    assert.match(first.cacheMaintenance.message, /work was saved/u);
    assert.equal(progress.at(-1).kind, "cache-warning");
    assert.equal(progress.at(-1).cacheMaintenance.status, "retryable");

    session.metadata.base_commit = first.saveCommit;
    session.metadata.canonical_commit = first.saveCommit;
    await writeFile(path.join(session.sourcePath, "cache-retry.txt"), "retry\n", "utf8");
    const retry = await saveSessionWork({
      operationId: "save-cache-refresh-retry",
      project,
      runCommand: commandRunner,
      session
    });
    assert.equal(retry.cacheMaintenance.status, "current");
    assert.equal(retry.cacheMaintenance.retryable, false);
    assert.equal(
      await git(root, ["--git-dir", project.githubMirrorPath, "rev-parse", "refs/heads/main"]),
      retry.saveCommit
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("GitHub Saves never refresh the mirror before a publish is accepted and verified", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-no-mirror-"));
  try {
    const runCase = async (name, operation) => {
      const caseRoot = path.join(root, name);
      await mkdir(caseRoot, { recursive: true });
      const fixture = await createRemoteFixture(caseRoot);
      const session = await sessionForRemote(caseRoot, fixture);
      const project = githubProject(caseRoot, fixture.remote);
      const requests = [];
      await operation({
        fixture,
        project,
        requests,
        runCommand: async (request) => {
          requests.push(request);
          return commandRunner(request);
        },
        session
      });
      assert.equal(
        requests.some((request) => (
          request.command === "bash" &&
          request.args?.includes("vibe64-github-mirror-refresh")
        )),
        false,
        name
      );
      await assert.rejects(
        () => git(caseRoot, ["--git-dir", project.githubMirrorPath, "rev-parse", "refs/heads/main"]),
        undefined,
        name
      );
    };

    await runCase("no-changes", async ({ project, runCommand, session }) => {
      await assert.rejects(saveSessionWork({
        operationId: "save-no-changes",
        project,
        runCommand,
        session
      }), (error) => error.code === "vibe64_session_save_no_changes");
    });

    await runCase("canonical-conflict", async ({ fixture, project, runCommand, session }) => {
      const writer = path.join(path.dirname(fixture.remote), "conflict-writer");
      await git(path.dirname(fixture.remote), ["clone", "--branch", "main", fixture.remote, writer]);
      await writeFile(path.join(writer, "shared.txt"), "canonical conflict\n", "utf8");
      await git(writer, ["add", "shared.txt"]);
      await git(writer, ["commit", "-m", "canonical conflict"]);
      await git(writer, ["push", "origin", "main"]);
      await writeFile(path.join(session.sourcePath, "shared.txt"), "session conflict\n", "utf8");
      await assert.rejects(saveSessionWork({
        operationId: "save-canonical-conflict",
        project,
        runCommand,
        session
      }), (error) => error.code === "vibe64_session_save_update_required");
    });

    await runCase("push-rejected", async ({ project, requests, session }) => {
      await writeFile(path.join(session.sourcePath, "push-rejected.txt"), "local\n", "utf8");
      await assert.rejects(saveSessionWork({
        operationId: "save-push-rejected",
        project,
        runCommand: async (request) => {
          requests.push(request);
          if (request.command === "git" && request.args?.[0] === "push") {
            return {
              code: "vibe64_test_push_rejected",
              ok: false,
              stderr: "simulated push rejection"
            };
          }
          return commandRunner(request);
        },
        session
      }), (error) => error.code === "vibe64_test_push_rejected");
    });

    await runCase("verification-mismatch", async ({ fixture, project, requests, session }) => {
      let pushed = false;
      await writeFile(path.join(session.sourcePath, "verification-mismatch.txt"), "local\n", "utf8");
      await assert.rejects(saveSessionWork({
        operationId: "save-verification-mismatch",
        project,
        runCommand: async (request) => {
          requests.push(request);
          if (request.command === "git" && request.args?.[0] === "push") {
            const result = await commandRunner(request);
            pushed = result.ok === true;
            return result;
          }
          if (pushed && request.command === "git" && request.args?.[0] === "ls-remote") {
            return {
              ok: true,
              stdout: `${fixture.baseCommit}\trefs/heads/main\n`
            };
          }
          return commandRunner(request);
        },
        session
      }), (error) => error.code === "vibe64_session_save_verification_failed");
      assert.equal(pushed, true);
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a second Save also requires explicit Update after a later canonical advance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    await writeFile(path.join(session.sourcePath, "first.txt"), "first\n", "utf8");
    const first = await saveSessionWork({
      operationId: "save-first",
      project,
      runCommand: commandRunner,
      session
    });
    session.metadata.base_commit = first.saveCommit;

    const canonicalWriter = path.join(root, "canonical-writer-second");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "canonical-second.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "canonical-second.txt"]);
    await git(canonicalWriter, ["commit", "-m", "later canonical advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalSecond = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "second.txt"), "second\n", "utf8");

    await assert.rejects(saveSessionWork({
      operationId: "save-second-before-rebase",
      project,
      runCommand: commandRunner,
      session
    }), (error) => error.code === "vibe64_session_save_update_required");

    const updated = await updateSessionWork({
      operationId: "rebase-second-save",
      project,
      runCommand: commandRunner,
      session
    });
    session.metadata.base_commit = updated.canonicalCommit;
    const second = await saveSessionWork({
      operationId: "save-second",
      project,
      runCommand: commandRunner,
      session
    });

    assert.equal(second.status, "saved");
    assert.equal(await git(session.sourcePath, ["rev-parse", `${second.saveCommit}^`]), canonicalSecond);
    assert.equal(await readFile(path.join(session.sourcePath, "first.txt"), "utf8"), "first\n");
    assert.equal(await readFile(path.join(session.sourcePath, "second.txt"), "utf8"), "second\n");
    assert.equal(await readFile(path.join(session.sourcePath, "canonical-second.txt"), "utf8"), "canonical\n");
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("concurrent GitHub Saves serialize, then the losing session updates and saves with an exact mirror", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-concurrent-"));
  try {
    const fixture = await createRemoteFixture(root);
    const firstSession = await sessionForRemote(root, fixture, "session-first");
    const secondSession = await sessionForRemote(root, fixture, "session-second");
    const project = githubProject(root, fixture.remote);
    await writeFile(path.join(firstSession.sourcePath, "first-session.txt"), "first\n", "utf8");
    await writeFile(path.join(secondSession.sourcePath, "second-session.txt"), "second\n", "utf8");
    let releasePrevious = Promise.resolve();
    const runProjectSourceExclusive = async (operation) => {
      const previous = releasePrevious;
      let release;
      releasePrevious = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    };

    const attempts = await Promise.allSettled([
      saveSessionWork({
        operationId: "concurrent-save-first",
        project,
        runCommand: commandRunner,
        runProjectSourceExclusive,
        session: firstSession
      }),
      saveSessionWork({
        operationId: "concurrent-save-second",
        project,
        runCommand: commandRunner,
        runProjectSourceExclusive,
        session: secondSession
      })
    ]);
    const successes = attempts.filter((attempt) => attempt.status === "fulfilled");
    const failures = attempts.filter((attempt) => attempt.status === "rejected");
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].reason.code, "vibe64_session_save_update_required");
    const firstPublished = successes[0].value;
    assert.equal(firstPublished.cacheMaintenance.status, "current");
    assert.equal(
      await git(root, ["--git-dir", project.githubMirrorPath, "rev-parse", "refs/heads/main"]),
      firstPublished.saveCommit
    );

    const losingSession = attempts[0].status === "rejected" ? firstSession : secondSession;
    const updated = await updateSessionWork({
      operationId: "update-concurrent-loser",
      project,
      runCommand: commandRunner,
      runProjectSourceExclusive,
      session: losingSession
    });
    losingSession.metadata.base_commit = updated.canonicalCommit;
    losingSession.metadata.canonical_commit = updated.canonicalCommit;
    const secondPublished = await saveSessionWork({
      operationId: "save-concurrent-loser-after-update",
      project,
      runCommand: commandRunner,
      runProjectSourceExclusive,
      session: losingSession
    });
    assert.equal(secondPublished.cacheMaintenance.status, "current");
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), secondPublished.saveCommit);
    assert.equal(
      await git(root, ["--git-dir", project.githubMirrorPath, "rev-parse", "refs/heads/main"]),
      secondPublished.saveCommit
    );
    assert.equal(await git(losingSession.sourcePath, ["show", "HEAD:first-session.txt"]), "first");
    assert.equal(await git(losingSession.sourcePath, ["show", "HEAD:second-session.txt"]), "second");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save advances the session baseline while preserving work added during publication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "saved.txt"), "saved\n", "utf8");
    let changedDuringSave = false;

    const result = await saveSessionWork({
      onProgress: async ({ stage }) => {
        if (stage === "prepared" && !changedDuringSave) {
          changedDuringSave = true;
          await writeFile(path.join(session.sourcePath, "late.txt"), "late\n", "utf8");
        }
      },
      operationId: "save-concurrent-worktree",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(result.status, "saved");
    assert.equal(result.reconciled, true);
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), result.saveCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), result.saveCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "late.txt"), "utf8"), "late\n");
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /late\.txt/u);
    await assert.rejects(readFile(path.join(fixture.seed, "late.txt"), "utf8"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed-Git Save uses the guarded canonical push and preserves its backup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const requests = [];
    const fixture = await createRemoteFixture(root);
    const canonicalRepositoryPath = path.join(root, "canonical-repository", "repository.git");
    await runScript(canonicalRepositoryInitializeScript({
      defaultBranch: "main",
      repositoryPath: canonicalRepositoryPath
    }), root);
    await runScript(canonicalRepositoryInstallRefScript({
      repositoryPath: canonicalRepositoryPath,
      sourceRef: "refs/heads/main",
      sourceRepository: fixture.seed,
      targetRef: "refs/heads/main"
    }), root);
    const session = await sessionForRemote(root, {
      ...fixture,
      remote: canonicalRepositoryPath
    }, "managed-session");
    await writeFile(path.join(session.sourcePath, "managed.txt"), "managed\n", "utf8");

    const result = await saveSessionWork({
      operationId: "save-managed",
      project: managedGitProject(root, canonicalRepositoryPath),
      runCommand: async (request) => {
        requests.push(request);
        return commandRunner(request);
      },
      session
    });

    assert.equal(result.mode, "managed_git");
    assert.equal(result.status, "saved");
    assert.deepEqual(result.cacheMaintenance, {
      attempted: false,
      kind: "none",
      retryable: false,
      status: "not_applicable"
    });
    assert.equal(requests.some((request) => request.command === "bash"), false);
    assert.equal(
      await git(root, ["--git-dir", canonicalRepositoryPath, "rev-parse", "refs/heads/main"]),
      result.saveCommit
    );
    assert.equal(
      await git(root, [
        "--git-dir",
        canonicalRepositoryBackupPath(canonicalRepositoryPath),
        "for-each-ref",
        "--format=%(objectname)",
        "refs/vibe64/backups/heads/main"
      ]),
      fixture.baseCommit
    );
    assert.equal(await readFile(path.join(session.sourcePath, "managed.txt"), "utf8"), "managed\n");
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed-Git Update reads the guarded canonical authority without publishing session work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const canonicalRepositoryPath = path.join(root, "canonical-repository", "repository.git");
    await runScript(canonicalRepositoryInitializeScript({
      defaultBranch: "main",
      repositoryPath: canonicalRepositoryPath
    }), root);
    await runScript(canonicalRepositoryInstallRefScript({
      repositoryPath: canonicalRepositoryPath,
      sourceRef: "refs/heads/main",
      sourceRepository: fixture.seed,
      targetRef: "refs/heads/main"
    }), root);
    const session = await sessionForRemote(root, {
      ...fixture,
      remote: canonicalRepositoryPath
    }, "managed-update");
    await writeFile(path.join(session.sourcePath, "local.txt"), "local\n", "utf8");

    await writeFile(path.join(fixture.seed, "canonical.txt"), "canonical\n", "utf8");
    await git(fixture.seed, ["add", "canonical.txt"]);
    await git(fixture.seed, ["commit", "-m", "managed canonical advance"]);
    await git(fixture.seed, ["remote", "add", "canonical", canonicalRepositoryPath]);
    await git(fixture.seed, [
      "push",
      "--push-option=vibe64-atomic",
      "canonical",
      "HEAD:refs/heads/main"
    ]);
    const canonicalCommit = await git(fixture.seed, ["rev-parse", "HEAD"]);

    const result = await updateSessionWork({
      operationId: "managed-update",
      project: managedGitProject(root, canonicalRepositoryPath),
      runCommand: commandRunner,
      session
    });

    assert.equal(result.mode, "managed_git");
    assert.equal(result.canonicalCommit, canonicalCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "canonical.txt"), "utf8"), "canonical\n");
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /local\.txt/u);
    assert.equal(
      await git(root, ["--git-dir", canonicalRepositoryPath, "rev-parse", "refs/heads/main"]),
      canonicalCommit,
      "Update must not publish session work"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("explicit Update reports a real three-way conflict without changing canonical authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "shared.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "shared.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical change"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "session\n", "utf8");

    await assert.rejects(
      updateSessionWork({
        operationId: "update-conflict",
        project: githubProject(root, fixture.remote),
        runCommand: commandRunner,
        session
      }),
      (error) => error.code === "vibe64_session_update_conflict"
    );
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "session\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save does not inspect sibling work before canonical publication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const sibling = await sessionForRemote(root, fixture, "session-2");
    await writeFile(path.join(session.sourcePath, "shared.txt"), "current\n", "utf8");
    await writeFile(path.join(sibling.sourcePath, "shared.txt"), "sibling\n", "utf8");
    let inspectedSibling = false;

    const project = githubProject(root, fixture.remote);
    const result = await saveSessionWork({
      operationId: "save-without-sibling-scan",
      project,
      runCommand: commandRunner,
      session,
      siblingWork: async () => {
        inspectedSibling = true;
        return [];
      }
    });

    assert.equal(result.status, "saved");
    assert.equal(inspectedSibling, false);
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), result.saveCommit);
    assert.equal(await readFile(path.join(sibling.sourcePath, "shared.txt"), "utf8"), "sibling\n");
    assert.equal(
      await git(session.sourcePath, ["for-each-ref", "--format=%(refname)", "refs/vibe64/save"]),
      ""
    );
    assert.equal(
      await git(sibling.sourcePath, ["for-each-ref", "--format=%(refname)", "refs/vibe64/save"]),
      ""
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save regenerates Genesis-derived artifacts from captured authored work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await mkdir(path.join(session.sourcePath, ".genesis"), { recursive: true });
    await writeFile(path.join(session.sourcePath, "authored.txt"), "authored\n", "utf8");
    await writeFile(path.join(session.sourcePath, ".genesis", "machine-city.json"), "{\"session\":true}\n", "utf8");
    const project = githubProject(root, fixture.remote);

    const result = await saveSessionWork({
      derivedArtifactPaths: [".genesis/machine-city.json", ".genesis/program-city.json"],
      operationId: "save-derived-artifact",
      project,
      refreshDerivedArtifacts: async ({ projectRoot }) => {
        await mkdir(path.join(projectRoot, ".genesis"), { recursive: true });
        const authored = await readFile(path.join(projectRoot, "authored.txt"), "utf8");
        await writeFile(
          path.join(projectRoot, ".genesis", "machine-city.json"),
          JSON.stringify({ authored: authored.trim() }) + "\n",
          "utf8"
        );
        await writeFile(
          path.join(projectRoot, ".genesis", "program-city.json"),
          JSON.stringify({ authored: authored.trim() }) + "\n",
          "utf8"
        );
      },
      runCommand: commandRunner,
      session
    });

    assert.equal(result.status, "saved");
    assert.deepEqual(result.changedPaths, ["authored.txt"]);
    assert.equal(
      await git(fixture.remote, ["show", "main:.genesis/machine-city.json"]),
      '{"authored":"authored"}'
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save leaves canonical and session source untouched when derived-artifact regeneration fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "authored.txt"), "important\n", "utf8");
    const beforeCanonical = await git(fixture.remote, ["rev-parse", "refs/heads/main"]);
    const beforeHead = await git(session.sourcePath, ["rev-parse", "HEAD"]);
    const beforeStatus = await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]);

    await assert.rejects(saveSessionWork({
      derivedArtifactPaths: [".genesis/machine-city.json", ".genesis/program-city.json"],
      operationId: "save-derived-refresh-failure",
      project: githubProject(root, fixture.remote),
      refreshDerivedArtifacts: async () => {
        throw new Error("derived refresh failed");
      },
      runCommand: commandRunner,
      session
    }), /derived refresh failed/u);

    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), beforeCanonical);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), beforeHead);
    assert.equal(await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]), beforeStatus);
    assert.equal(await readFile(path.join(session.sourcePath, "authored.txt"), "utf8"), "important\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("work inspection trusts only the platform-verified canonical snapshot, not mutable tracking refs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "published.txt"), "published\n", "utf8");
    await git(session.sourcePath, ["add", "published.txt"]);
    await git(session.sourcePath, ["commit", "-m", "published work"]);
    await git(session.sourcePath, ["push", "origin", "HEAD:main"]);

    const publishedCommit = await git(session.sourcePath, ["rev-parse", "HEAD"]);
    await mkdir(path.join(session.sourcePath, "node_modules", "ignored-package"), { recursive: true });
    await writeFile(path.join(session.sourcePath, ".git", "info", "exclude"), "node_modules/\n", "utf8");
    await writeFile(path.join(session.sourcePath, "node_modules", "ignored-package", "index.js"), "ignored\n", "utf8");

    const beforeCheck = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(beforeCheck.canonicalCommit, fixture.baseCommit);
    assert.equal(beforeCheck.unsaved, true);

    const checked = await checkSessionUpdates({
      operationId: "check-pulled-canonical",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(checked.behind, 0);
    assert.equal(checked.reconciled, true);
    assert.equal(checked.sessionCurrent, true);
    assert.equal(checked.updateAvailable, false);

    const inspected = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(inspected.unsaved, false);
    assert.deepEqual(inspected.changedPaths, []);
    assert.equal(inspected.canonicalCommit, publishedCommit);
    assert.equal(inspected.changeBaseCommit, publishedCommit);
    assert.equal(inspected.sessionMatchesCanonical, true);

    const updated = await updateSessionWork({
      operationId: "update-pulled-canonical",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(updated.status, "already_current");
    assert.equal(updated.canonicalCommit, publishedCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), publishedCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save publishes only session-authored work after the session incorporates canonical updates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer-pulled");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "canonical.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "canonical.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical update"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);

    await git(session.sourcePath, ["pull", "--ff-only", "origin", "main"]);
    await writeFile(path.join(session.sourcePath, "session-only.txt"), "session\n", "utf8");

    const result = await saveSessionWork({
      operationId: "save-after-pull",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(result.changeBaseCommit, canonicalCommit);
    assert.deepEqual(result.changedPaths, ["session-only.txt"]);
    assert.equal(await git(session.sourcePath, ["rev-parse", `${result.saveCommit}^`]), canonicalCommit);
    assert.equal(
      await git(session.sourcePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", result.saveCommit]),
      "session-only.txt"
    );
    assert.equal(await readFile(path.join(session.sourcePath, "canonical.txt"), "utf8"), "canonical\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("work inspection reports a canonical advance as an update instead of local changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer-observed");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await git(session.sourcePath, ["fetch", "origin", "main"]);

    await checkSessionUpdates({
      operationId: "check-observed-canonical",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    const inspected = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(inspected.unsaved, false);
    assert.deepEqual(inspected.changedPaths, []);
    assert.equal(inspected.canonicalCommit, canonicalCommit);
    assert.equal(inspected.changeBaseCommit, fixture.baseCommit);
    assert.equal(inspected.behind, 1);
    assert.equal(inspected.updateAvailable, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("work inspection does not resurrect saved work when canonical advances beyond the session head", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "already-saved.txt"), "saved\n", "utf8");
    await git(session.sourcePath, ["add", "already-saved.txt"]);
    await git(session.sourcePath, ["commit", "-m", "already saved"]);
    await git(session.sourcePath, ["push", "origin", "HEAD:main"]);
    const sessionHead = await git(session.sourcePath, ["rev-parse", "HEAD"]);

    const canonicalWriter = path.join(root, "canonical-writer-after-session");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "canonical-only.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "canonical-only.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await git(session.sourcePath, ["fetch", "origin", "main"]);

    await checkSessionUpdates({
      operationId: "check-canonical-after-session",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    const inspected = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(inspected.sessionHead, sessionHead);
    assert.equal(inspected.canonicalCommit, canonicalCommit);
    assert.equal(inspected.changeBaseCommit, sessionHead);
    assert.equal(inspected.unsaved, false);
    assert.deepEqual(inspected.changedPaths, []);
    assert.equal(inspected.behind, 1);
    assert.equal(inspected.updateAvailable, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("work inspection reports only new session edits when canonical advances beyond the session head", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "already-saved.txt"), "saved\n", "utf8");
    await git(session.sourcePath, ["add", "already-saved.txt"]);
    await git(session.sourcePath, ["commit", "-m", "already saved"]);
    await git(session.sourcePath, ["push", "origin", "HEAD:main"]);
    const sessionHead = await git(session.sourcePath, ["rev-parse", "HEAD"]);

    const canonicalWriter = path.join(root, "canonical-writer-with-session-edit");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "canonical-only.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "canonical-only.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    await git(session.sourcePath, ["fetch", "origin", "main"]);

    await checkSessionUpdates({
      operationId: "check-canonical-with-session-edit",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    await writeFile(path.join(session.sourcePath, "session-only.txt"), "session\n", "utf8");

    const inspected = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(inspected.changeBaseCommit, sessionHead);
    assert.equal(inspected.unsaved, true);
    assert.deepEqual(inspected.changedPaths, ["session-only.txt"]);
    assert.equal(inspected.behind, 1);
    assert.equal(inspected.updateAvailable, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local-source Save advances the clean configured baseline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const requests = [];
    const baseline = path.join(root, "baseline");
    await git(root, ["init", "--initial-branch=main", baseline]);
    await writeFile(path.join(baseline, "app.txt"), "initial\n", "utf8");
    await git(baseline, ["add", "app.txt"]);
    await git(baseline, ["commit", "-m", "initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    const source = path.join(root, "session-local");
    await git(root, ["clone", "--branch", "main", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-local"]);
    await writeFile(path.join(source, "app.txt"), "saved\n", "utf8");
    const session = {
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/session-local",
        source_path: source
      },
      sessionId: "session-local",
      sourcePath: source
    };
    const result = await saveSessionWork({
      operationId: "save-local",
      project: {
        sourceRoot: baseline,
        repository: {
          defaultBranch: "main",
          mode: "local_source"
        }
      },
      runCommand: async (request) => {
        requests.push(request);
        return commandRunner(request);
      },
      session
    });
    assert.equal(result.status, "saved");
    assert.deepEqual(result.cacheMaintenance, {
      attempted: false,
      kind: "none",
      retryable: false,
      status: "not_applicable"
    });
    assert.equal(requests.some((request) => request.command === "bash"), false);
    assert.equal(await git(baseline, ["rev-parse", "HEAD"]), result.saveCommit);
    assert.equal(await readFile(path.join(baseline, "app.txt"), "utf8"), "saved\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local-source Save rejects a baseline checked out on the wrong branch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const baseline = path.join(root, "baseline");
    await git(root, ["init", "--initial-branch=main", baseline]);
    await writeFile(path.join(baseline, "app.txt"), "initial\n", "utf8");
    await git(baseline, ["add", "app.txt"]);
    await git(baseline, ["commit", "-m", "initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    await git(baseline, ["checkout", "-b", "other"]);
    const source = path.join(root, "session-local");
    await git(root, ["clone", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-local", baseCommit]);
    await writeFile(path.join(source, "app.txt"), "session\n", "utf8");

    await assert.rejects(saveSessionWork({
      operationId: "save-local-wrong-branch",
      project: {
        sourceRoot: baseline,
        repository: {
          defaultBranch: "main",
          mode: "local_source"
        }
      },
      runCommand: commandRunner,
      session: {
        metadata: {
          base_branch: "main",
          base_commit: baseCommit,
          source_path: source
        },
        sessionId: "session-local",
        sourcePath: source
      }
    }), (error) => error.code === "vibe64_session_save_local_branch_mismatch");
    assert.equal(await git(baseline, ["rev-parse", "HEAD"]), baseCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local-source interrupted Save recovery verifies the clean baseline before reconciling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const baseline = path.join(root, "baseline");
    await git(root, ["init", "--initial-branch=main", baseline]);
    await writeFile(path.join(baseline, "app.txt"), "initial\n", "utf8");
    await git(baseline, ["add", "app.txt"]);
    await git(baseline, ["commit", "-m", "initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    const source = path.join(root, "session-local");
    await git(root, ["clone", "--branch", "main", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-local"]);
    await writeFile(path.join(source, "app.txt"), "saved\n", "utf8");
    const session = {
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/session-local",
        source_path: source
      },
      sessionId: "session-local",
      sourcePath: source
    };
    const project = {
      sourceRoot: baseline,
      repository: {
        defaultBranch: "main",
        mode: "local_source"
      }
    };
    let recovery = {};
    await assert.rejects(saveSessionWork({
      onProgress: async (progress) => {
        recovery = { ...recovery, ...progress };
        if (progress.stage === "published") {
          throw new Error("simulated service restart");
        }
      },
      operationId: "save-local-recovery",
      project,
      runCommand: commandRunner,
      session
    }), /simulated service restart/u);

    const result = await recoverSessionWorkSave({
      project,
      recovery,
      runCommand: commandRunner,
      session
    });

    assert.equal(result.recovered, true);
    assert.equal(result.reconciled, true);
    assert.equal(await git(baseline, ["status", "--porcelain"]), "");
    assert.equal(await git(baseline, ["rev-parse", "HEAD"]), recovery.proposedCommit);
    assert.equal(await git(source, ["rev-parse", "HEAD"]), recovery.proposedCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("restart recovery recognizes a transaction that already reconciled before its result was stored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-recovery-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    await writeFile(path.join(session.sourcePath, "reconciled.txt"), "reconciled\n", "utf8");
    const saved = await saveSessionWork({
      deferCacheMaintenance: true,
      operationId: "save-recover-reconciled",
      project,
      runCommand: commandRunner,
      session
    });

    const recovered = await recoverSessionWorkSave({
      project,
      recovery: {
        operationId: "save-recover-reconciled"
      },
      runCommand: commandRunner,
      session
    });

    assert.equal(recovered.reconciled, true);
    assert.equal(recovered.saveCommit, saved.saveCommit);
    assert.equal(recovered.status, "saved");
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), saved.saveCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupted Save recovery verifies published authority and reconciles without republishing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    await writeFile(path.join(session.sourcePath, "recovered.txt"), "recovered\n", "utf8");
    let recovery = {};
    await assert.rejects(saveSessionWork({
      operationId: "save-recover-published",
      onProgress: async (progress) => {
        recovery = { ...recovery, ...progress };
        if (progress.stage === "published") {
          throw new Error("simulated service restart");
        }
      },
      project,
      runCommand: commandRunner,
      session
    }), /simulated service restart/u);
    const publishedCommit = await git(fixture.remote, ["rev-parse", "refs/heads/main"]);
    assert.equal(publishedCommit, recovery.proposedCommit);
    assert.notEqual(await git(session.sourcePath, ["rev-parse", "HEAD"]), publishedCommit);

    const result = await recoverSessionWorkSave({
      project,
      recovery: {
        operationId: "save-recover-published"
      },
      runCommand: commandRunner,
      session
    });

    assert.equal(result.recovered, true);
    assert.equal(result.reconciled, true);
    assert.equal(result.saveCommit, publishedCommit);
    assert.equal(result.cacheMaintenance.status, "current");
    assert.equal(result.cacheMaintenance.mirrorCommit, publishedCommit);
    assert.equal(
      await git(root, ["--git-dir", project.githubMirrorPath, "rev-parse", "refs/heads/main"]),
      publishedCommit
    );
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), publishedCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "recovered.txt"), "utf8"), "recovered\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupted Save recovery never republishes when authority is still unchanged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "not-published.txt"), "local\n", "utf8");
    await assert.rejects(saveSessionWork({
      operationId: "save-recover-unpublished",
      onProgress: async (progress) => {
        if (progress.stage === "publishing") {
          throw new Error("simulated service restart");
        }
      },
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), /simulated service restart/u);

    await assert.rejects(recoverSessionWorkSave({
      project: githubProject(root, fixture.remote),
      recovery: {
        operationId: "save-recover-unpublished"
      },
      runCommand: commandRunner,
      session
    }), (error) => {
      assert.equal(error.code, "vibe64_session_save_interrupted_retryable");
      assert.equal(error.retryable, true);
      return true;
    });
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), fixture.baseCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
