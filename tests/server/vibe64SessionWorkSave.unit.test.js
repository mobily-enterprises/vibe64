import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  inspectSessionChangeDiff,
  inspectSessionChanges,
  inspectSessionWork,
  inspectSessionWorkDirect,
  prepareSessionWorkSaveMessage,
  prepareSessionPullRequestBranch,
  recoverSessionWorkSave,
  saveSessionWork as saveManagedSessionWorkImplementation,
  saveSessionWorkDirect as saveSessionWorkImplementation
} from "../../packages/vibe64-terminals/src/server/sessionWorkSave.js";
import {
  checkSessionUpdates,
  recoverSessionWorkUpdate,
  updateSessionWork as updateManagedSessionWork,
  updateSessionWorkDirect as updateSessionWork
} from "../../packages/vibe64-terminals/src/server/sessionWorkUpdate.js";
import {
  changeIncomingContribution,
  changeIncomingContributionDirect,
  inspectIncomingContributions,
  inspectIncomingContributionsDirect
} from "../../packages/vibe64-terminals/src/server/sessionIncomingContributions.js";
import { safeChangePath } from "../../packages/vibe64-terminals/src/server/gitRecords.js";
import {
  canonicalRepositoryBackupPath,
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript
} from "../../packages/vibe64-execution/src/server/repositoryStorage.js";
import { vibe64Host } from "../../packages/vibe64-execution/src/server/hostProfile.js";

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
      fullName: "example/project",
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
    // Each child process receives this process's host profile.
    assert.ok(payloads.every((payload) => JSON.stringify(payload.hostProfile) === JSON.stringify(vibe64Host())));
    assert.deepEqual(progressStages, ["publishing"]);
    assert.deepEqual(saveMessageInput.changes.files.map((file) => file.path), ["saved.txt"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed Save keeps a Stack whose newer section proposal is pending", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-stack-contract-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    const { initializeGenesisProject, addGenesisStack } = await import("@local/vibe64-genesis/server");
    await initializeGenesisProject({ projectRoot: session.sourcePath });
    await addGenesisStack({ projectRoot: session.sourcePath, pieces: ["nodejs"] });
    const stackPath = path.join(session.sourcePath, "genesis/stack.md");
    const complete = await readFile(stackPath, "utf8");
    const incomplete = complete.replace(/\n## Connected development\n[\s\S]*?(?=\n## |$)/u, "");
    assert.notEqual(incomplete, complete);
    await writeFile(stackPath, incomplete);
    const input = { operationId: "pending-stack-proposal", project, session, runCommand: commandRunner,
      derivedArtifactPaths: [".genesis/machine-city.json", ".genesis/program-city.json"] };
    // Genesis reports an unadopted component section as a pending proposal, not
    // an incomplete Stack, so Save neither blocks nor adopts it.
    const prepared = await prepareSessionWorkSaveMessage(input);
    assert.ok(prepared.checkpoint.checkpointCommit);
    assert.equal(await readFile(stackPath, "utf8"), incomplete, "Save cannot rewrite authored source");
    let finishMaintenance;
    const maintenance = new Promise(resolve => { finishMaintenance = resolve; });
    const saved = await saveManagedSessionWorkImplementation({ ...input,
      checkpoint: prepared.checkpoint, message: "Save pending Stack", onCacheMaintenance: finishMaintenance });
    await maintenance;
    assert.equal(saved.status, "saved");
    assert.equal(await git(fixture.remote, ["rev-parse", "main"]), saved.saveCommit);
    assert.equal(await git(fixture.remote, ["show", "main:genesis/stack.md"]), incomplete.trim());
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
    assert.deepEqual(result.destination, { sessionId: session.sessionId, mode: "github", repository: "example/project", branch: "main" });
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
    assert.deepEqual(changes.destination, { sessionId: session.sessionId, mode: "github", repository: "example/project", branch: "main" });
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

test("canonical checks return project-configured source identity despite stale session metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-canonical-source-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    Object.assign(session.metadata, {
      repository_mode: "local_source",
      base_branch: "obsolete",
      source_default_branch: "obsolete",
      source_remote_url: "https://obsolete.example/project.git"
    });
    const check = await checkSessionUpdates({
      project: {
        projectRuntimeRoot: path.join(root, "project-runtime"),
        repository: {
          mode: "github",
          defaultBranch: "main",
          github: { cloneUrl: fixture.remote }
        }
      },
      runCommand: commandRunner,
      session
    });
    assert.equal(check.sessionCurrent, true);
    assert.deepEqual(check.canonicalSource, {
      authority: "github",
      commit: fixture.baseCommit,
      ref: "refs/heads/main",
      repository: fixture.remote
    });
    for (const [repository, code] of [
      [{ mode: "github", github: { cloneUrl: fixture.remote } }, "vibe64_session_save_context_incomplete"],
      [{ mode: "github", defaultBranch: "main" }, "vibe64_session_save_authority_missing"],
      [{ mode: "managed_git", defaultBranch: "main" }, "vibe64_session_save_authority_missing"]
    ]) {
      await assert.rejects(checkSessionUpdates({
        project: { repository },
        runCommand: () => assert.fail("Incomplete project authority must fail before Git runs"),
        session
      }), { code });
    }
    const localCheck = await checkSessionUpdates({
      project: {
        sourceRoot: fixture.seed,
        repository: { mode: "local_source", defaultBranch: "main" }
      },
      runCommand: commandRunner,
      session
    });
    assert.deepEqual(localCheck.canonicalSource, {
      authority: "local_source",
      commit: fixture.baseCommit,
      ref: "refs/heads/main"
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed Update admits four stages and persists recovery before changing source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-stages-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    await writeFile(path.join(session.sourcePath, "mine.txt"), "unsaved work\n");
    await writeFile(path.join(fixture.seed, "incoming.txt"), "saved upstream\n");
    await git(fixture.seed, ["add", "."]);
    await git(fixture.seed, ["commit", "-m", "upstream"]);
    await git(fixture.seed, ["push", "origin", "main"]);
    const canonical = await git(fixture.seed, ["rev-parse", "HEAD"]);
    const requests = [];
    const stages = [];
    let locked = false;
    let recovery;
    let invalidated = false;
    const result = await updateManagedSessionWork({
      project,
      session,
      operationId: "managed-update",
      async runProjectSourceExclusive(operation) {
        assert.equal(locked, false);
        locked = true;
        try { return await operation(); } finally { locked = false; }
      },
      async onProgress(progress) {
        stages.push(progress.stage);
        if (progress.stage === "prepared") {
          recovery = progress;
          assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), fixture.baseCommit);
        }
      },
      async beforeSourceChange() {
        assert.equal(locked, true);
        assert.ok(recovery.checkpointCommit);
        assert.ok(recovery.mergedCommit);
        invalidated = true;
      },
      async runCommand(request) {
        assert.equal(locked, true);
        assert.equal(request.command, "node");
        const operation = JSON.parse(request.input).operation;
        requests.push(operation);
        if (operation === "update-apply") assert.equal(invalidated, true);
        return commandRunner(request);
      }
    });
    assert.equal(result.status, "updated");
    assert.equal(result.reconciled, true);
    assert.deepEqual(requests, ["update-checkpoint", "update-prepare", "update-derived", "update-apply"]);
    assert.deepEqual(stages, ["repository-lock", "checkpointing", "checkpointed", "merging", "regenerating", "prepared", "mutating"]);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), canonical);
    assert.equal(await readFile(path.join(session.sourcePath, "mine.txt"), "utf8"), "unsaved work\n");
    assert.equal(await readFile(path.join(session.sourcePath, "incoming.txt"), "utf8"), "saved upstream\n");
    assert.equal(await git(session.sourcePath, ["diff", "--cached", "--name-only"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed Update leaves source untouched when merge conflicts cross the helper boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-conflict-stage-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "my work\n");
    await writeFile(path.join(fixture.seed, "shared.txt"), "their work\n");
    await git(fixture.seed, ["commit", "-am", "upstream"]);
    await git(fixture.seed, ["push", "origin", "main"]);
    const requests = [];
    await assert.rejects(updateManagedSessionWork({
      project: githubProject(root, fixture.remote),
      session,
      beforeSourceChange() { assert.fail("Conflicts must not invalidate preparation."); },
      runCommand(request) {
        requests.push(JSON.parse(request.input).operation);
        return commandRunner(request);
      }
    }), (error) => {
      assert.equal(error.code, "vibe64_session_update_conflict");
      assert.deepEqual(error.details.conflictPaths, ["shared.txt"]);
      assert.ok(error.details.conflictRecovery.checkpointTree);
      return true;
    });
    assert.deepEqual(requests, ["update-checkpoint", "update-prepare"]);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), fixture.baseCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "my work\n");
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
      assert.match(error.message, /1 file needs review/u);
      assert.notEqual(error.details.conflictRecovery.reviewId, conflictRecovery.reviewId);
      conflictRecovery = error.details.conflictRecovery;
      return true;
    });
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), beforeHead);
    assert.equal(await git(session.sourcePath, ["write-tree"]), beforeIndex);

    await writeFile(path.join(session.sourcePath, "shared.txt"), "remote\nlocal\n", "utf8");
    await assert.rejects(updateSessionWork({
      conflictRecovery,
      operationId: "fresh-attempt-after-edits",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), (error) => {
      assert.equal(error.code, "vibe64_session_update_conflict");
      assert.match(error.message, /1 file needs review/u);
      conflictRecovery = error.details.conflictRecovery;
      return true;
    });
    const updated = await updateSessionWork({
      conflictRecovery,
      reviewedConflictId: conflictRecovery.reviewId,
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

test("Update fetches the latest saved version on a fresh attempt after a conflict", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-fresh-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(fixture.seed, "shared.txt"), "remote\n");
    await git(fixture.seed, ["add", "."]);
    await git(fixture.seed, ["commit", "-m", "conflicting saved version"]);
    await git(fixture.seed, ["push", "origin", "main"]);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "local\n");
    const input = { project: githubProject(root, fixture.remote), runCommand: commandRunner, session };
    let conflictRecovery;
    await assert.rejects(updateSessionWork(input), (error) => {
      conflictRecovery = error.details.conflictRecovery;
      return error.code === "vibe64_session_update_conflict";
    });

    await writeFile(path.join(session.sourcePath, "ongoing-work.txt"), "Keep my new work.\n");
    await writeFile(path.join(fixture.seed, "shared.txt"), "local\n");
    await writeFile(path.join(fixture.seed, "upstream.txt"), "New saved work.\n");
    await git(fixture.seed, ["add", "."]);
    await git(fixture.seed, ["commit", "-m", "resolved saved version"]);
    await git(fixture.seed, ["push", "origin", "main"]);
    const updated = await updateSessionWork({ ...input, conflictRecovery });
    assert.equal(updated.status, "updated");
    assert.equal(updated.canonicalCommit, await git(fixture.seed, ["rev-parse", "HEAD"]));
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), updated.canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "local\n");
    assert.equal(await readFile(path.join(session.sourcePath, "ongoing-work.txt"), "utf8"), "Keep my new work.\n");
    assert.equal(await readFile(path.join(session.sourcePath, "upstream.txt"), "utf8"), "New saved work.\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Update starts fresh after partial repairs and reports only the remaining conflicts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-partial-"));
  try {
    const fixture = await createRemoteFixture(root);
    await writeFile(path.join(fixture.seed, "second.txt"), "initial\n");
    await git(fixture.seed, ["add", "."]);
    await git(fixture.seed, ["commit", "-m", "second baseline"]);
    await git(fixture.seed, ["push", "origin", "main"]);
    fixture.baseCommit = await git(fixture.seed, ["rev-parse", "HEAD"]);
    const session = await sessionForRemote(root, fixture);
    for (const filename of ["shared.txt", "second.txt"]) {
      await writeFile(path.join(fixture.seed, filename), "remote\n");
      await writeFile(path.join(session.sourcePath, filename), "local\n");
    }
    await git(fixture.seed, ["add", "."]);
    await git(fixture.seed, ["commit", "-m", "saved changes"]);
    await git(fixture.seed, ["push", "origin", "main"]);
    const input = { project: githubProject(root, fixture.remote), runCommand: commandRunner, session };
    let recovery;
    await assert.rejects(updateSessionWork(input), (error) => {
      recovery = error.details.conflictRecovery;
      return error.code === "vibe64_session_update_conflict";
    });
    const baseline = recovery.checkpointTree;
    await writeFile(path.join(session.sourcePath, "shared.txt"), "remote\n");
    await writeFile(path.join(session.sourcePath, "ongoing-work.txt"), "New work\n");
    await assert.rejects(updateSessionWork({ ...input, conflictRecovery: recovery }), (error) => {
      assert.match(error.message, /1 file needs review/u);
      assert.deepEqual(error.details.conflictPaths, ["second.txt"]);
      assert.notEqual(error.details.conflictRecovery.reviewId, recovery.reviewId);
      recovery = error.details.conflictRecovery;
      assert.notEqual(recovery.checkpointTree, baseline);
      return true;
    });
    await writeFile(path.join(session.sourcePath, "second.txt"), "remote\nlocal\n");
    assert.equal((await updateSessionWork({
      ...input, conflictRecovery: recovery, reviewedConflictId: recovery.reviewId
    })).status, "updated");
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "remote\n");
    assert.equal(await readFile(path.join(session.sourcePath, "second.txt"), "utf8"), "remote\nlocal\n");
    assert.equal(await readFile(path.join(session.sourcePath, "ongoing-work.txt"), "utf8"), "New work\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

for (const scenario of ["reviewed", "legacy-review", "newer-canonical", "newer-commit-same-files", "new-conflict"]) {
  test(`Update accepts a reviewed document without artificial edits: ${scenario}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-reviewed-"));
    try {
      const fixture = await createRemoteFixture(root);
      await writeFile(path.join(fixture.seed, "data-overview.json"), '{"reference":"old","position":0}\n');
      await git(fixture.seed, ["add", "."]);
      await git(fixture.seed, ["commit", "-m", "overview baseline"]);
      await git(fixture.seed, ["push", "origin", "main"]);
      fixture.baseCommit = await git(fixture.seed, ["rev-parse", "HEAD"]);
      const session = await sessionForRemote(root, fixture);
      await writeFile(path.join(fixture.seed, "data-overview.json"), '{"reference":"portable","position":0}\n');
      await writeFile(path.join(fixture.seed, "shared.txt"), "remote\n");
      await git(fixture.seed, ["add", "."]);
      await git(fixture.seed, ["commit", "-m", "portable references"]);
      await git(fixture.seed, ["push", "origin", "main"]);
      const prepared = '{"reference":"portable","position":42}\n';
      await writeFile(path.join(session.sourcePath, "data-overview.json"), prepared);
      const input = { project: githubProject(root, fixture.remote), runCommand: commandRunner, session };
      let conflictRecovery;
      await assert.rejects(updateSessionWork(input), (error) => {
        conflictRecovery = error.details.conflictRecovery;
        assert.deepEqual(error.details.conflictPaths, ["data-overview.json"]);
        return error.code === "vibe64_session_update_conflict";
      });
      if (scenario === "legacy-review") delete conflictRecovery.reviewId;
      await assert.rejects(updateSessionWork({ ...input, conflictRecovery }), (error) => {
        assert.match(error.message, /1 file needs review/u);
        assert.notEqual(error.details.conflictRecovery.reviewId, conflictRecovery.reviewId);
        conflictRecovery = error.details.conflictRecovery;
        return true;
      });
      const reviewedConflictId = conflictRecovery.reviewId;
      assert.ok(reviewedConflictId);
      await writeFile(path.join(session.sourcePath, "ongoing-work.txt"), "Keep newer work.\n");
      if (scenario === "newer-canonical") {
        await writeFile(path.join(fixture.seed, "later.txt"), "New saved work.\n");
        await git(fixture.seed, ["add", "."]);
        await git(fixture.seed, ["commit", "-m", "newer saved version"]);
        await git(fixture.seed, ["push", "origin", "main"]);
      }
      if (scenario === "newer-commit-same-files") {
        await git(fixture.seed, ["commit", "--allow-empty", "-m", "new saved version, same files"]);
        await git(fixture.seed, ["push", "origin", "main"]);
      }
      if (scenario === "new-conflict") {
        await writeFile(path.join(session.sourcePath, "shared.txt"), "local\n");
      }
      if (!["reviewed", "legacy-review"].includes(scenario)) {
        const head = await git(session.sourcePath, ["rev-parse", "HEAD"]);
        const index = await git(session.sourcePath, ["write-tree"]);
        const status = await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]);
        await assert.rejects(updateSessionWork({ ...input, conflictRecovery, reviewedConflictId }), (error) => {
          assert.equal(error.code, "vibe64_session_update_conflict");
          conflictRecovery = error.details.conflictRecovery;
          assert.notEqual(conflictRecovery.reviewId, reviewedConflictId);
          return true;
        });
        await assert.rejects(updateSessionWork({ ...input, conflictRecovery, reviewedConflictId }), {
          code: "vibe64_session_update_conflict"
        });
        assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), head);
        assert.equal(await git(session.sourcePath, ["write-tree"]), index);
        assert.equal(await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]), status);
        assert.equal(await readFile(path.join(session.sourcePath, "data-overview.json"), "utf8"), prepared);
        return;
      }
      const result = await updateSessionWork({ ...input, conflictRecovery, reviewedConflictId });
      assert.equal(result.status, "updated");
      assert.equal(await readFile(path.join(session.sourcePath, "data-overview.json"), "utf8"), prepared);
      assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "remote\n");
      assert.equal(await readFile(path.join(session.sourcePath, "ongoing-work.txt"), "utf8"), "Keep newer work.\n");
      assert.equal(await git(fixture.seed, ["rev-parse", "HEAD"]), result.canonicalCommit);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
}

for (const scenario of ["repaired", "unreviewed", "unrelated", "derived", "upstream"]) {
  test(`Update retains recovery when the conflict list shrinks: ${scenario}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-shrinking-"));
    try {
      const fixture = await createRemoteFixture(root);
      await writeFile(path.join(fixture.seed, "second.txt"), "initial\n");
      await git(fixture.seed, ["add", "second.txt"]);
      await git(fixture.seed, ["commit", "-m", "second baseline"]);
      await git(fixture.seed, ["push", "origin", "main"]);
      fixture.baseCommit = await git(fixture.seed, ["rev-parse", "HEAD"]);
      const session = await sessionForRemote(root, fixture);
      for (const filename of ["shared.txt", "second.txt"]) {
        await writeFile(path.join(fixture.seed, filename), "remote\n");
        await writeFile(path.join(session.sourcePath, filename), "local\n");
      }
      await git(fixture.seed, ["add", "shared.txt", "second.txt"]);
      await git(fixture.seed, ["commit", "-m", "saved changes"]);
      await git(fixture.seed, ["push", "origin", "main"]);
      const input = { project: githubProject(root, fixture.remote), runCommand: commandRunner, session };
      let conflictRecovery;
      await assert.rejects(updateSessionWork({ ...input, operationId: "initial-conflict" }), (error) => {
        assert.equal(error.code, "vibe64_session_update_conflict");
        assert.deepEqual(error.details.conflictPaths, ["second.txt", "shared.txt"]);
        conflictRecovery = error.details.conflictRecovery;
        return true;
      });
      await writeFile(path.join(session.sourcePath, "shared.txt"), "remote\n");
      if (scenario !== "unreviewed") {
        await writeFile(path.join(session.sourcePath, "second.txt"), "remote\nlocal\n");
      }
      if (scenario === "unrelated") await writeFile(path.join(session.sourcePath, "unrelated.txt"), "New work\n");
      if (scenario === "upstream") {
        await writeFile(path.join(fixture.seed, "later.txt"), "Another saved change\n");
        await git(fixture.seed, ["add", "later.txt"]);
        await git(fixture.seed, ["commit", "-m", "newer saved version"]);
        await git(fixture.seed, ["push", "origin", "main"]);
      }
      if (scenario === "derived") {
        await mkdir(path.join(session.sourcePath, ".genesis"));
        await writeFile(path.join(session.sourcePath, ".genesis/machine-city.json"), "{}\n");
        input.derivedArtifactPaths = [".genesis/machine-city.json"];
        input.refreshDerivedArtifacts = async ({ projectRoot }) => {
          await mkdir(path.join(projectRoot, ".genesis"), { recursive: true });
          await writeFile(path.join(projectRoot, ".genesis/machine-city.json"), '{"regenerated":true}\n');
        };
      }
      const headBefore = await git(session.sourcePath, ["rev-parse", "HEAD"]);
      const indexBefore = await git(session.sourcePath, ["write-tree"]);
      const statusBefore = await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]);
      const updating = updateSessionWork({
        ...input, conflictRecovery, operationId: "check-repair",
        reviewedConflictId: scenario === "unreviewed" ? "" : conflictRecovery.reviewId
      });
      if (["unreviewed", "upstream"].includes(scenario)) {
        await assert.rejects(updating, (error) => {
          assert.equal(error.code, "vibe64_session_update_conflict");
          assert.deepEqual(error.details.conflictPaths, ["second.txt"]);
          assert.match(error.message, /1 file needs review/u);
          return true;
        });
        assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), headBefore);
        assert.equal(await git(session.sourcePath, ["write-tree"]), indexBefore);
        assert.equal(await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]), statusBefore);
      } else {
        const result = await updating;
        assert.equal(result.status, "updated");
        assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "remote\n");
        assert.equal(await readFile(path.join(session.sourcePath, "second.txt"), "utf8"), "remote\nlocal\n");
        assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), result.canonicalCommit);
        if (scenario === "unrelated") {
          assert.equal(await readFile(path.join(session.sourcePath, "unrelated.txt"), "utf8"), "New work\n");
        }
        if (scenario === "derived") {
          assert.equal(await readFile(path.join(session.sourcePath, ".genesis/machine-city.json"), "utf8"), '{"regenerated":true}\n');
        }
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
}

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

test("GitHub PR-required push rejection preserves session work and distinguishes other branch rules", async () => {
  for (const [reason, expectedCode] of [
    ["remote: error: GH006: Protected branch update failed.\nremote: Changes must be made through a pull request.", "vibe64_pull_request_required"],
    ["remote: error: GH013: Repository rule violations found.\nremote: - Changes must be made through a pull request.", "vibe64_pull_request_required"],
    ["remote: error: GH013: Repository rule violations found.\nremote: - Commits must have verified signatures.", "git_failed"]
  ]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-pr-required-"));
    try {
      const fixture = await createRemoteFixture(root);
      const session = await sessionForRemote(root, fixture);
      const project = githubProject(root, fixture.remote);
      await writeFile(path.join(session.sourcePath, "shared.txt"), "keep my changes\n");
      await writeFile(path.join(session.sourcePath, "new.txt"), "keep my new file\n");
      const before = await git(session.sourcePath, ["status", "--porcelain"]);
      let pushes = 0;
      await assert.rejects(saveSessionWork({
        operationId: "save-pr-required", project, session,
        runCommand: async request => {
          if (request.command === "git" && request.args?.[0] === "push") {
            pushes++;
            return { ok: false, code: "git_failed", stderr: reason };
          }
          return commandRunner(request);
        }
      }), error => {
        assert.equal(error.code, expectedCode);
        assert.ok(error.message.includes(reason), "retain GitHub's actual rejection");
        if (expectedCode === "vibe64_pull_request_required") assert.match(error.message, /Your work remains in this session/u);
        return true;
      });
      assert.equal(pushes, 1);
      assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), fixture.baseCommit);
      assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), fixture.baseCommit);
      assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), before);
      assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "keep my changes\n");
      assert.equal(await readFile(path.join(session.sourcePath, "new.txt"), "utf8"), "keep my new file\n");
      if (expectedCode === "vibe64_pull_request_required") {
        session.metadata.github_pull_request = JSON.stringify({ number: null, title: "Recover rejected Save", body: "", url: "",
          baseRepository: "example/project", baseBranch: "main", headRepository: "example/project",
          headBranch: "vibe64/recovered", headCommit: fixture.baseCommit });
        const runCommand = request => commandRunner({ ...request,
          args: request.args.map(arg => arg === "https://github.com/example/project.git" ? fixture.remote : arg) });
        await prepareSessionPullRequestBranch({ project, session, runCommand });
        const saved = await saveSessionWork({ project, session, runCommand, operationId: "save-to-pr" });
        assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), fixture.baseCommit);
        assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/vibe64/recovered"]), saved.saveCommit);
        assert.equal(await git(fixture.remote, ["show", "vibe64/recovered:shared.txt"]), "keep my changes");
        assert.equal(await git(fixture.remote, ["show", "vibe64/recovered:new.txt"]), "keep my new file");
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
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

async function contributionFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-contribution-save-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createRemoteFixture(root);
  const session = await sessionForRemote(root, fixture);
  const contribution = { schemaVersion: 1, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    repository: "example/project", integrationBranch: "main", baseCommit: fixture.baseCommit };
  session.metadata.connected_contribution = JSON.stringify(contribution);
  return { ...fixture, session, project: githubProject(root, fixture.remote), contribution,
    ref: `refs/heads/vibe64-incoming/${contribution.id}` };
}

test("contribution Save creates only its incoming ref and carries authority through managed commands", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  await assert.rejects(saveSessionWork({ project, session, runCommand: commandRunner }), { code: "vibe64_session_save_no_changes" });
  assert.equal(await git(f.remote, ["for-each-ref", "--format=%(refname)", "refs/heads"]), "refs/heads/main");
  await writeFile(path.join(session.sourcePath, "shared.txt"), "staged change\n");
  await git(session.sourcePath, ["add", "shared.txt"]);
  await writeFile(path.join(session.sourcePath, "shared.txt"), "full worktree change\n");
  await writeFile(path.join(session.sourcePath, "new.txt"), "untracked contribution\n");
  const requests = [];
  const runCommand = request => { requests.push(request); return commandRunner(request); };
  const operationId = "contribution-managed-save";
  const { checkpoint } = await prepareSessionWorkSaveMessage({ project, session, runCommand, operationId });
  let maintained;
  const maintenance = new Promise(resolve => { maintained = resolve; });
  const saved = await saveManagedSessionWorkImplementation({ project, session, runCommand, operationId, checkpoint,
    message: "Improve the connected library", onCacheMaintenance: maintained });
  await maintenance;
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), saved.saveCommit);
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
  assert.equal(await git(f.remote, ["show", `${f.ref}:shared.txt`]), "full worktree change");
  assert.equal(await git(f.remote, ["show", `${f.ref}:new.txt`]), "untracked contribution");
  await git(f.remote, ["merge-base", "--is-ancestor", f.baseCommit, saved.saveCommit]);
  for (const request of requests) {
    assert.equal(request.command, "node");
    const payload = JSON.parse(request.input);
    assert.deepEqual(JSON.parse(payload.input.session.metadata.connected_contribution), f.contribution);
    assert.equal(payload.input.project.repository.defaultBranch, "main");
  }
});

test("later contribution Saves retain ancestry and cannot recreate a branch discarded during push", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  await writeFile(path.join(session.sourcePath, "first.txt"), "first\n");
  const first = await saveSessionWork({ project, session, runCommand: commandRunner });
  session.metadata.base_commit = first.saveCommit;
  session.metadata.canonical_commit = first.saveCommit;
  await writeFile(path.join(session.sourcePath, "second.txt"), "second\n");
  const second = await saveSessionWork({ project, session, runCommand: commandRunner });
  await git(f.remote, ["merge-base", "--is-ancestor", first.saveCommit, second.saveCommit]);
  session.metadata.base_commit = second.saveCommit;
  session.metadata.canonical_commit = second.saveCommit;
  await writeFile(path.join(session.sourcePath, "third.txt"), "preserve after discard\n");
  let pushes = 0;
  await assert.rejects(saveSessionWork({ project, session, runCommand: async request => {
    if (request.command === "git" && request.args[0] === "push") {
      pushes++;
      assert.ok(request.args.includes(`--force-with-lease=${f.ref}:${second.saveCommit}`));
      await git(f.remote, ["update-ref", `${f.ref}_discarded`, second.saveCommit]);
      await git(f.remote, ["update-ref", "-d", f.ref, second.saveCommit]);
    }
    return commandRunner(request);
  } }), { code: "vibe64_contribution_discarded" });
  assert.equal(pushes, 1);
  assert.equal(await git(f.remote, ["for-each-ref", "--format=%(refname)", `${f.ref}*`]), `${f.ref}_discarded`);
  assert.equal(await git(f.remote, ["rev-parse", `${f.ref}_discarded`]), second.saveCommit);
  assert.equal(await readFile(path.join(session.sourcePath, "third.txt"), "utf8"), "preserve after discard\n");
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
});

test("accepted contribution source requires explicit Update and keeps publication on its incoming ref", async t => {
  const receiver = await contributionFixture(t);
  receiver.session.sessionId = receiver.contribution.id;
  await writeFile(path.join(receiver.session.sourcePath, "shared.txt"), "submitted source\n");
  const submitted = await saveSessionWork({ ...receiver, runCommand: commandRunner });
  receiver.session.metadata.base_commit = submitted.saveCommit;
  receiver.session.metadata.canonical_commit = submitted.saveCommit;

  await git(receiver.seed, ["fetch", "origin", receiver.ref]);
  await writeFile(path.join(receiver.seed, "shared.txt"), "receiving change\n");
  await git(receiver.seed, ["commit", "-am", "Advance receiving source"]);
  await assert.rejects(git(receiver.seed, ["merge", "--no-ff", submitted.saveCommit]));
  await writeFile(path.join(receiver.seed, "shared.txt"), "accepted conflict repair\n");
  await git(receiver.seed, ["add", "shared.txt"]);
  await git(receiver.seed, ["commit", "-m", "Accept repaired contribution"]);
  const accepted = await git(receiver.seed, ["rev-parse", "HEAD"]);
  await git(receiver.seed, ["push", "origin", "main"]);

  const main = await contributionFixture(t);
  delete main.session.metadata.connected_contribution;
  main.session.metadata.connected_submissions = JSON.stringify({ schemaVersion: 1,
    submissions: [{ contribution: receiver.contribution, submittedCommit: submitted.saveCommit }] });
  await writeFile(path.join(main.session.sourcePath, "consumer.txt"), "uses accepted library\n");
  const runCommand = request => commandRunner({ ...request, env: { ...request.env,
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${receiver.remote}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/example/project.git" } });
  const snapshot = async () => ({ contribution: receiver.contribution,
    ...await inspectSessionWorkDirect({ ...receiver, runCommand: commandRunner }) });
  await assert.rejects(saveSessionWork({ ...main, runCommand, connectedWorkSnapshots: [await snapshot()] }),
    { code: "vibe64_connected_integration_source_update_required" });
  assert.equal(await git(main.remote, ["rev-parse", "main"]), main.baseCommit);
  assert.equal(await readFile(path.join(receiver.session.sourcePath, "shared.txt"), "utf8"), "submitted source\n");

  const checked = await checkSessionUpdates({ ...receiver, runCommand: commandRunner });
  assert.equal(checked.canonicalCommit, accepted);
  assert.equal(checked.canonicalSource.ref, "refs/heads/main");
  assert.equal(checked.updateAvailable, true);
  const updated = await updateSessionWork({ ...receiver, runCommand: commandRunner });
  assert.equal(updated.canonicalCommit, accepted);
  receiver.session.metadata.base_commit = accepted;
  receiver.session.metadata.canonical_commit = accepted;
  assert.equal(await readFile(path.join(receiver.session.sourcePath, "shared.txt"), "utf8"), "accepted conflict repair\n");
  assert.equal(await git(receiver.remote, ["rev-parse", receiver.ref]), submitted.saveCommit);
  const publication = await inspectSessionWork({ ...receiver, runCommand: commandRunner, inspectContributionPublication: true });
  assert.equal(publication.publishedCommit, submitted.saveCommit, "accepted canonical is not a new contribution publication");
  assert.equal(publication.unsaved, false);
  await assert.rejects(saveSessionWork({ ...receiver, runCommand: commandRunner }), { code: "vibe64_session_save_no_changes" });
  assert.equal((await inspectSessionWork({ ...receiver, runCommand: commandRunner,
    inspectContributionPublication: true })).publishedCommit, submitted.saveCommit);

  const saved = await saveSessionWork({ ...main, runCommand, connectedWorkSnapshots: [await snapshot()] });
  assert.equal(await git(main.remote, ["rev-parse", "main"]), saved.saveCommit);
  await writeFile(path.join(receiver.session.sourcePath, "next.txt"), "next contribution\n");
  let observedLease = "";
  const next = await saveSessionWork({ ...receiver, runCommand: request => {
    if (request.command === "git" && request.args[0] === "push") observedLease = request.args.find(arg => arg.startsWith("--force-with-lease="));
    return commandRunner(request);
  } });
  assert.equal(observedLease, `--force-with-lease=${receiver.ref}:${submitted.saveCommit}`);
  assert.equal(await git(receiver.remote, ["rev-parse", `${receiver.ref}^`]), accepted);
  assert.equal(await git(receiver.remote, ["rev-parse", "main"]), accepted);
  assert.equal(await git(receiver.remote, ["rev-parse", receiver.ref]), next.saveCommit);

  // An independent writer cannot be silently recorded as this source's work.
  await git(receiver.seed, ["fetch", "origin", receiver.ref]);
  await git(receiver.seed, ["checkout", "-b", "external", next.saveCommit]);
  await writeFile(path.join(receiver.seed, "external.txt"), "unconsumed work\n");
  await git(receiver.seed, ["add", "."]);
  await git(receiver.seed, ["commit", "-m", "Independent contribution advance"]);
  await git(receiver.seed, ["push", "origin", `HEAD:${receiver.ref}`]);
  await assert.rejects(inspectSessionWork({ ...receiver, runCommand: commandRunner,
    inspectContributionPublication: true }), { code: "vibe64_connected_source_update_required" });
});

test("integrated discarded or deleted contributions retain accepted source and exact publication evidence", async t => {
  for (const disposition of ["discarded", "deleted"]) {
    const receiver = await contributionFixture(t);
    receiver.session.sessionId = receiver.contribution.id;
    await writeFile(path.join(receiver.session.sourcePath, "library.txt"), "submitted library\n");
    const saved = await saveSessionWork({ ...receiver, runCommand: commandRunner });
    receiver.session.metadata.base_commit = saved.saveCommit;
    receiver.session.metadata.canonical_commit = saved.saveCommit;
    if (disposition === "discarded") await git(receiver.remote, ["update-ref", `${receiver.ref}_discarded`, saved.saveCommit]);
    await git(receiver.remote, ["update-ref", "-d", receiver.ref]);
    await assert.rejects(checkSessionUpdates({ ...receiver, runCommand: commandRunner }), {
      code: disposition === "discarded" ? "vibe64_contribution_discarded" : "vibe64_contribution_branch_missing"
    });

    // Acceptance is proved by history, not the disposition of the queue ref.
    await git(receiver.seed, ["fetch", receiver.session.sourcePath, saved.saveCommit]);
    await git(receiver.seed, ["merge", "--ff-only", saved.saveCommit]);
    await writeFile(path.join(receiver.seed, "accepted.txt"), "accepted source change\n");
    await git(receiver.seed, ["add", "."]);
    await git(receiver.seed, ["commit", "-m", "Complete accepted source"]);
    await git(receiver.seed, ["push", "origin", "main"]);
    const accepted = await git(receiver.seed, ["rev-parse", "HEAD"]);
    const updated = await updateSessionWork({ ...receiver, runCommand: commandRunner });
    assert.equal(updated.canonicalCommit, accepted);
    receiver.session.metadata.base_commit = accepted;
    receiver.session.metadata.canonical_commit = accepted;
    const publication = await inspectSessionWork({ ...receiver, runCommand: commandRunner,
      inspectContributionPublication: true, knownSubmittedCommit: saved.saveCommit });
    assert.equal(publication.publishedCommit, saved.saveCommit);
    assert.equal(publication.sessionHead, accepted);
    if (disposition === "deleted") await assert.rejects(inspectSessionWork({ ...receiver,
      runCommand: commandRunner, inspectContributionPublication: true }), { code: "vibe64_contribution_branch_missing" });

    const main = await contributionFixture(t);
    delete main.session.metadata.connected_contribution;
    main.session.metadata.connected_submissions = JSON.stringify({ schemaVersion: 1,
      submissions: [{ contribution: receiver.contribution, submittedCommit: publication.publishedCommit }] });
    await writeFile(path.join(main.session.sourcePath, "consumer.txt"), "uses accepted library\n");
    const runCommand = request => commandRunner({ ...request, env: { ...request.env,
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${receiver.remote}.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/example/project.git" } });
    const result = await saveSessionWork({ ...main, runCommand,
      connectedWorkSnapshots: [{ contribution: receiver.contribution, ...publication }] });
    assert.equal(await git(main.remote, ["rev-parse", "main"]), result.saveCommit);
    await writeFile(path.join(receiver.session.sourcePath, "later.txt"), "requires a new contribution\n");
    await assert.rejects(saveSessionWork({ ...receiver, runCommand: commandRunner }), {
      code: disposition === "discarded" ? "vibe64_contribution_discarded" : "vibe64_contribution_branch_missing"
    });
    assert.equal(await git(receiver.remote, ["for-each-ref", "--format=%(refname)", `${receiver.ref}*`]),
      disposition === "discarded" ? `${receiver.ref}_discarded` : "");
    if (disposition === "discarded") assert.equal(await git(receiver.remote,
      ["rev-parse", `${receiver.ref}_discarded`]), saved.saveCommit);
  }
});

test("discarded, interrupted-discard and missing published contributions refuse further pushes", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  await writeFile(path.join(session.sourcePath, "first.txt"), "first\n");
  const saved = await saveSessionWork({ project, session, runCommand: commandRunner });
  session.metadata.base_commit = saved.saveCommit;
  session.metadata.canonical_commit = saved.saveCommit;
  await writeFile(path.join(session.sourcePath, "next.txt"), "keep this\n");
  const runCommand = request => {
    assert.notEqual(request.args[0], "push", "Refusal must precede remote writes.");
    return commandRunner(request);
  };
  await git(f.remote, ["update-ref", `${f.ref}_discarded`, saved.saveCommit]);
  await assert.rejects(saveSessionWork({ project, session, runCommand }), { code: "vibe64_contribution_discard_incomplete" });
  await git(f.remote, ["update-ref", "-d", f.ref]);
  await assert.rejects(saveSessionWork({ project, session, runCommand }), { code: "vibe64_contribution_discarded" });
  await git(f.remote, ["update-ref", "-d", `${f.ref}_discarded`]);
  await assert.rejects(saveSessionWork({ project, session, runCommand }), { code: "vibe64_contribution_branch_missing" });
  assert.equal(await readFile(path.join(session.sourcePath, "next.txt"), "utf8"), "keep this\n");
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
});

test("first contribution push uses an absent-ref lease and preserves a racing creator", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  await writeFile(path.join(session.sourcePath, "new.txt"), "my work\n");
  await assert.rejects(saveSessionWork({ project, session, runCommand: async request => {
    if (request.command === "git" && request.args[0] === "push") {
      assert.ok(request.args.includes(`--force-with-lease=${f.ref}:`));
      await git(f.remote, ["update-ref", f.ref, f.baseCommit]);
    }
    return commandRunner(request);
  } }));
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), f.baseCommit);
  assert.equal(await readFile(path.join(session.sourcePath, "new.txt"), "utf8"), "my work\n");
});

test("first contribution retries after a prepublication refusal while retaining its source checkpoint", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  const requiredRemote = "https://github.com/example/required.git";
  const requiredContribution = { ...f.contribution, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", repository: "example/required" };
  const requiredSession = await sessionForRemote(path.dirname(f.remote), f, requiredContribution.id);
  requiredSession.metadata.connected_contribution = JSON.stringify(requiredContribution);
  const requiredProject = githubProject(path.dirname(f.remote), f.remote);
  requiredProject.githubRepository.fullName = requiredContribution.repository;
  const connectedWorkSnapshots = [{ contribution: requiredContribution,
    ...await inspectSessionWorkDirect({ project: requiredProject, session: requiredSession, runCommand: commandRunner }) }];
  session.metadata.connected_submissions = JSON.stringify({ schemaVersion: 1, submissions: [{
    contribution: requiredContribution,
    submittedCommit: f.baseCommit
  }] });
  await writeFile(path.join(session.sourcePath, "retry.txt"), "keep my contribution\n");
  let dependencyAvailable = false;
  let pushes = 0;
  let checkpoint;
  const runCommand = request => {
    if (request.args[0] === "push") pushes++;
    if (request.args.includes(requiredRemote)) {
      if (!dependencyAvailable) return { ok: false, stderr: "receiving repository unavailable" };
      request = { ...request, args: request.args.map(value => value === requiredRemote ? f.remote : value) };
    }
    return commandRunner(request);
  };
  await assert.rejects(saveSessionWork({ project, session, runCommand, connectedWorkSnapshots, operationId: "first-refused", onProgress(progress) {
    if (progress.stage === "checkpointed") checkpoint = progress.checkpointCommit;
  } }), { code: "vibe64_connected_integration_unknown" });
  assert.equal(pushes, 0);
  assert.equal(await git(f.remote, ["for-each-ref", "--format=%(refname)", f.ref]), "");
  assert.equal(await git(session.sourcePath, ["for-each-ref", "--format=%(refname)", "refs/vibe64/save"]), "");
  const checkpoints = await git(session.sourcePath, ["for-each-ref", "--format=%(objectname)", "refs/vibe64/checkpoints"]);
  assert.ok(checkpoints.split("\n").includes(checkpoint), "private recovery checkpoint remains reachable");
  assert.equal(await readFile(path.join(session.sourcePath, "retry.txt"), "utf8"), "keep my contribution\n");
  dependencyAvailable = true;
  const saved = await saveSessionWork({ project, session, runCommand, connectedWorkSnapshots, operationId: "first-retry" });
  assert.equal(pushes, 1);
  assert.equal(saved.reconciled, true);
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), saved.saveCommit);
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
});

test("unconfirmed first contribution pushes retain evidence when the remote ref is absent", async t => {
  for (const accepted of [false, true]) {
    const f = await contributionFixture(t);
    const { project, session } = f;
    const operationId = `unknown-first-${accepted}`;
    await writeFile(path.join(session.sourcePath, "unknown.txt"), "preserve uncertain work\n");
    await assert.rejects(saveSessionWork({ project, session, operationId, runCommand: async request => {
      if (request.args[0] === "push") {
        if (accepted) {
          assert.equal((await commandRunner(request)).ok, true);
          await git(f.remote, ["update-ref", "-d", f.ref]);
        }
        return { ok: false, stderr: "connection lost" };
      }
      return commandRunner(request);
    } }));
    assert.match(await git(session.sourcePath, ["for-each-ref", "--format=%(refname)", "refs/vibe64/save"]), /\/prepared/u);
    const noPush = request => {
      assert.notEqual(request.args[0], "push", "absence cannot authorize publishing an uncertain attempt again");
      return commandRunner(request);
    };
    await assert.rejects(recoverSessionWorkSave({ project, session, recovery: { operationId }, runCommand: noPush }),
      { code: "vibe64_session_save_publication_unknown" });
    await assert.rejects(saveSessionWork({ project, session, runCommand: noPush }),
      { code: "vibe64_contribution_branch_missing" });
    assert.equal(await readFile(path.join(session.sourcePath, "unknown.txt"), "utf8"), "preserve uncertain work\n");
    assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
  }
});

test("lost contribution push acknowledgement confirms the exact remote commit and reconciles without republishing", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  await writeFile(path.join(session.sourcePath, "new.txt"), "recover my work\n");
  let pushes = 0;
  const saved = await saveSessionWork({ project, session, runCommand: async request => {
    const result = await commandRunner(request);
    if (request.command === "git" && request.args[0] === "push" && result.ok) {
      pushes++;
      return { ok: false, stderr: "connection lost after remote accepted push" };
    }
    return result;
  } });
  const published = await git(f.remote, ["rev-parse", f.ref]);
  assert.equal(saved.saveCommit, published);
  assert.equal(saved.reconciled, true);
  assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), published);
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
  assert.equal(pushes, 1);
  session.metadata.base_commit = published;
  session.metadata.canonical_commit = published;
  await assert.rejects(saveSessionWork({ project, session, runCommand: request => {
    assert.notEqual(request.args[0], "push", "unchanged retry must not publish another commit");
    return commandRunner(request);
  } }), { code: "vibe64_session_save_no_changes" });
});

test("unknown contribution publication retains its prepared commit across repeated recovery and restart", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  await writeFile(path.join(session.sourcePath, "new.txt"), "recover my work\n");
  let pushes = 0;
  const operationId = "contribution-lost-ack";
  await assert.rejects(saveSessionWork({ project, session, operationId, runCommand: async request => {
    if (pushes && request.args[0] === "ls-remote") return { ok: false, stderr: "remote unavailable" };
    const result = await commandRunner(request);
    if (request.command === "git" && request.args[0] === "push" && result.ok) {
      pushes++;
      return { ok: false, stderr: "connection lost after remote accepted push" };
    }
    return result;
  } }), { code: "vibe64_session_save_publication_unknown" });
  const published = await git(f.remote, ["rev-parse", f.ref]);
  await assert.rejects(recoverSessionWorkSave({ project, session, recovery: { operationId }, runCommand: request => {
    assert.notEqual(request.args[0], "push");
    if (request.args[0] === "ls-remote") return { ok: false, stderr: "remote still unavailable" };
    return commandRunner(request);
  } }), { code: "vibe64_session_save_publication_unknown" });
  assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), f.baseCommit);
  // Only durable operation identity and Git refs are supplied to a fresh recovery.
  const recovered = await recoverSessionWorkSave({ project, session, recovery: { operationId }, runCommand: request => {
    assert.notEqual(request.args[0], "push");
    return commandRunner(request);
  } });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.saveCommit, published);
  assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), published);
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
  assert.equal(pushes, 1);
});

test("contribution publication recovers a failed local canonical write without another push", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  const operationId = "contribution-local-write-failure";
  await writeFile(path.join(session.sourcePath, "new.txt"), "published once\n");
  let pushed = false;
  await assert.rejects(saveSessionWork({ project, session, operationId, runCommand: async request => {
    if (pushed && request.args[0] === "update-ref" && request.args[1]?.startsWith("refs/vibe64/canonical/")) {
      return { ok: false, code: "local_cache_write_failed", stderr: "local canonical write failed" };
    }
    const result = await commandRunner(request);
    if (request.args[0] === "push" && result.ok) pushed = true;
    return result;
  } }), { code: "local_cache_write_failed" });
  assert.equal(pushed, true);
  const published = await git(f.remote, ["rev-parse", f.ref]);
  assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), f.baseCommit);
  const recovered = await recoverSessionWorkSave({ project, session, recovery: { operationId }, runCommand: request => {
    assert.notEqual(request.args[0], "push");
    return commandRunner(request);
  } });
  assert.equal(recovered.saveCommit, published);
  assert.equal(recovered.reconciled, true);
  assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), published);
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
  assert.equal(await readFile(path.join(session.sourcePath, "new.txt"), "utf8"), "published once\n");
});

test("Incoming reconstructs Git-only states and review through the managed boundary without changing source", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  await writeFile(path.join(session.sourcePath, "pending.txt"), "review this change\n");
  const saved = await saveSessionWork({ project, session, runCommand: commandRunner });
  const mergedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const discardedId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const unresolvedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await git(f.remote, ["update-ref", `refs/heads/vibe64-incoming/${mergedId}_discarded`, f.baseCommit]);
  await git(f.remote, ["update-ref", `refs/heads/vibe64-incoming/${discardedId}_discarded`, saved.saveCommit]);
  await git(f.remote, ["update-ref", `refs/heads/vibe64-incoming/${unresolvedId}`, saved.saveCommit]);
  await git(f.remote, ["update-ref", `refs/heads/vibe64-incoming/${unresolvedId}_discarded`, saved.saveCommit]);
  await git(f.remote, ["update-ref", "refs/heads/ordinary-feature", saved.saveCommit]);
  await git(f.remote, ["update-ref", "refs/heads/vibe64-incoming/not-a-contribution", saved.saveCommit]);
  await writeFile(path.join(session.sourcePath, "unsaved.txt"), "preserve local work\n");
  const before = await git(session.sourcePath, ["status", "--porcelain"]);
  const beforeRefs = await git(f.remote, ["for-each-ref", "--format=%(refname):%(objectname)"]);
  // Even a selected contribution session inspects the receiving project's main target.
  const first = await inspectIncomingContributions({ project, session, limit: 2, runCommand: commandRunner });
  assert.equal(first.targetBranch, "main");
  assert.equal(first.targetHead, f.baseCommit);
  assert.equal(first.totalCount, 4);
  assert.equal(first.nextOffset, 2);
  assert.deepEqual(first.contributions.map(entry => entry.status), ["pending", "merged"]);
  const second = await inspectIncomingContributions({ project, session, offset: first.nextOffset, limit: 2, runCommand: commandRunner });
  assert.deepEqual(second.contributions.map(entry => entry.status), ["discarded", "unresolved"]);
  assert.equal(second.nextOffset, null);
  const pending = await inspectIncomingContributions({ project, session, state: "pending", limit: 1, runCommand: commandRunner });
  assert.equal(pending.pendingCount, 1);
  assert.equal(pending.totalCount, 1);
  assert.equal(pending.nextOffset, null);
  assert.equal(pending.contributions[0].review.activeHead, saved.saveCommit);
  const discarded = await inspectIncomingContributions({ project, session, state: "discarded", limit: 1, runCommand: commandRunner });
  assert.equal(discarded.contributions[0].id, discardedId);
  assert.equal(discarded.pendingCount, 1);
  const review = await inspectIncomingContributions({ project, session, id: f.contribution.id, includeDiff: true, runCommand: commandRunner });
  assert.equal(review.contributions[0].head, saved.saveCommit);
  assert.deepEqual(review.contributions[0].files, ["pending.txt"]);
  assert.match(review.contributions[0].title, /Improve tested project behavior/);
  assert.match(review.contributions[0].diff.content, /review this change/);
  assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), before);
  assert.equal(await git(f.remote, ["for-each-ref", "--format=%(refname):%(objectname)"]), beforeRefs);
  assert.equal(await git(session.sourcePath, ["for-each-ref", "--format=%(refname)", "refs/vibe64/save"]), "");
});

test("Incoming refuses stale ref snapshots, unavailable remotes and incomplete history", async t => {
  const f = await contributionFixture(t);
  const { project, session } = f;
  await writeFile(path.join(session.sourcePath, "pending.txt"), "first\n");
  const saved = await saveSessionWork({ project, session, runCommand: commandRunner });
  for (const mode of ["stale", "unreachable", "shallow"]) {
    await git(f.remote, ["update-ref", f.ref, saved.saveCommit]);
    await assert.rejects(inspectIncomingContributionsDirect({ project, session, runCommand: async request => {
      if (mode === "shallow" && request.args.includes("--is-shallow-repository")) return { ok: true, stdout: "true\n" };
      if (mode === "unreachable" && request.args[0] === "ls-remote") return { ok: false, stderr: "remote unavailable" };
      if (mode === "stale" && request.args[0] === "fetch") await git(f.remote, ["update-ref", f.ref, f.baseCommit]);
      return commandRunner(request);
    } }), error => mode === "stale" ? error.code === "vibe64_incoming_review_changed"
      : mode === "shallow" ? error.code === "vibe64_incoming_history_incomplete" : /remote unavailable/.test(error.message));
  }
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
  assert.equal(await git(session.sourcePath, ["for-each-ref", "--format=%(refname)", "refs/vibe64/save"]), "");
});

async function incomingReview(f) {
  const snapshot = await inspectIncomingContributionsDirect({ ...f, id: f.contribution.id, runCommand: commandRunner });
  const { activeHead, discardedHead } = snapshot.contributions[0];
  return { repository: snapshot.repository, targetBranch: snapshot.targetBranch, targetHead: snapshot.targetHead,
    id: f.contribution.id, activeHead, discardedHead };
}

test("Incoming Merge preserves contribution ancestry and dirty source through the managed boundary", async t => {
  for (const diverged of [false, true]) {
    const f = await contributionFixture(t);
    await writeFile(path.join(f.session.sourcePath, "library.txt"), "library contribution\n");
    const saved = await saveSessionWork({ ...f, runCommand: commandRunner });
    if (diverged) {
      await writeFile(path.join(f.seed, "upstream.txt"), "independent upstream work\n");
      await git(f.seed, ["add", "."]);
      await git(f.seed, ["commit", "-m", "Independent upstream work"]);
      await git(f.seed, ["push", "origin", "main"]);
    }
    const review = await incomingReview(f);
    await writeFile(path.join(f.session.sourcePath, "dirty.txt"), "unsaved local work\n");
    const before = await git(f.session.sourcePath, ["status", "--porcelain"]);
    const headBefore = await git(f.session.sourcePath, ["rev-parse", "HEAD"]);
    let locked = false;
    const result = await changeIncomingContribution({ ...f, action: "merge", id: f.contribution.id, review,
      runProjectSourceExclusive: async operation => { locked = true; return operation(); },
      runCommand: request => { assert.equal(locked, true); return commandRunner(request); } });
    assert.equal(result.status, "merged");
    await git(f.remote, ["merge-base", "--is-ancestor", saved.saveCommit, "main"]);
    await git(f.remote, ["merge-base", "--is-ancestor", review.targetHead, "main"]);
    assert.equal(await git(f.remote, ["rev-parse", f.ref]), saved.saveCommit);
    assert.equal(await git(f.session.sourcePath, ["status", "--porcelain"]), before);
    assert.equal(await git(f.session.sourcePath, ["rev-parse", "HEAD"]), headBefore);
    if (diverged) assert.equal((await git(f.remote, ["show", "-s", "--format=%P", "main"])).split(" ").length, 2);
    else assert.equal(result.targetHead, saved.saveCommit);
  }
});

test("Incoming Merge recovers a lost accepted-target response from Git without another push", async t => {
  const f = await contributionFixture(t);
  await writeFile(path.join(f.session.sourcePath, "library.txt"), "library contribution\n");
  const saved = await saveSessionWork({ ...f, runCommand: commandRunner });
  await writeFile(path.join(f.seed, "upstream.txt"), "independent upstream work\n");
  await git(f.seed, ["add", "."]);
  await git(f.seed, ["commit", "-m", "Independent upstream work"]);
  await git(f.seed, ["push", "origin", "main"]);
  const review = await incomingReview(f);
  await writeFile(path.join(f.session.sourcePath, "dirty.txt"), "staged local work\n");
  await git(f.session.sourcePath, ["add", "dirty.txt"]);
  await writeFile(path.join(f.session.sourcePath, "dirty.txt"), "unsaved local work\n");
  const before = await git(f.session.sourcePath, ["status", "--porcelain"]);
  const head = await git(f.session.sourcePath, ["rev-parse", "HEAD"]);
  const index = await git(f.session.sourcePath, ["write-tree"]);
  let pushes = 0;
  await assert.rejects(changeIncomingContributionDirect({ ...f, action: "merge", id: f.contribution.id, review,
    runCommand: async request => {
      const result = await commandRunner(request);
      if (request.command === "git" && request.args[0] === "push" && result.ok) {
        pushes++;
        return { ok: false, stderr: "connection lost after receiving target accepted merge" };
      }
      return result;
    } }), /connection lost after receiving target accepted merge/u);
  const target = await git(f.remote, ["rev-parse", "main"]);
  assert.notEqual(target, review.targetHead);
  assert.deepEqual((await git(f.remote, ["show", "-s", "--format=%P", "main"])).split(" "),
    [review.targetHead, saved.saveCommit]);
  const readOnlyCommand = request => {
    assert.notEqual(request.args[0], "push", "recovery must not publish again");
    return commandRunner(request);
  };
  const refreshed = await inspectIncomingContributionsDirect({ ...f, id: f.contribution.id, runCommand: readOnlyCommand });
  assert.equal(refreshed.pendingCount, 0);
  assert.equal(refreshed.contributions[0].status, "merged");
  assert.equal(refreshed.targetHead, target);
  await assert.rejects(changeIncomingContributionDirect({ ...f, action: "merge", id: f.contribution.id,
    review, runCommand: readOnlyCommand }), { code: "vibe64_incoming_review_changed" });
  const result = await changeIncomingContributionDirect({ ...f, action: "merge", id: f.contribution.id,
    review: refreshed.contributions[0].review, runCommand: readOnlyCommand });
  assert.equal(result.status, "merged");
  assert.equal(result.targetHead, target);
  assert.equal(pushes, 1);
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), saved.saveCommit);
  assert.equal(await git(f.session.sourcePath, ["rev-parse", "HEAD"]), head);
  assert.equal(await git(f.session.sourcePath, ["write-tree"]), index);
  assert.equal(await git(f.session.sourcePath, ["status", "--porcelain"]), before);
  assert.equal(await readFile(path.join(f.session.sourcePath, "dirty.txt"), "utf8"), "unsaved local work\n");
});

test("Incoming Merge refuses conflicts and stale reviews without changing either remote head", async t => {
  const f = await contributionFixture(t);
  await writeFile(path.join(f.session.sourcePath, "shared.txt"), "contribution change\n");
  const saved = await saveSessionWork({ ...f, runCommand: commandRunner });
  const staleReview = await incomingReview(f);
  await writeFile(path.join(f.seed, "shared.txt"), "conflicting upstream change\n");
  await git(f.seed, ["add", "."]);
  await git(f.seed, ["commit", "-m", "Conflicting upstream work"]);
  await git(f.seed, ["push", "origin", "main"]);
  const target = await git(f.remote, ["rev-parse", "main"]);
  await assert.rejects(changeIncomingContributionDirect({ ...f, action: "merge", id: f.contribution.id,
    review: staleReview, runCommand: commandRunner }), { code: "vibe64_incoming_review_changed" });
  await assert.rejects(changeIncomingContributionDirect({ ...f, action: "merge", id: f.contribution.id,
    review: await incomingReview(f), runCommand: commandRunner }), { code: "vibe64_incoming_merge_conflict" });
  assert.equal(await git(f.remote, ["rev-parse", "main"]), target);
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), saved.saveCommit);
});

async function conflictingIncomingFixture(t) {
  const f = await contributionFixture(t);
  await writeFile(path.join(f.session.sourcePath, "shared.txt"), "contribution change\n");
  await writeFile(path.join(f.session.sourcePath, "contribution.txt"), "retain contribution\n");
  f.saved = await saveSessionWork({ ...f, runCommand: commandRunner });
  await writeFile(path.join(f.seed, "shared.txt"), "upstream change\n");
  await writeFile(path.join(f.seed, "upstream.txt"), "retain upstream\n");
  await git(f.seed, ["add", "."]);
  await git(f.seed, ["commit", "-m", "Advance receiving project"]);
  await git(f.seed, ["push", "origin", "main"]);
  f.review = await incomingReview(f);
  return f;
}

test("Incoming repair uses private checkpoints and reviewed conflict paths without publishing unrelated source", async t => {
  const f = await conflictingIncomingFixture(t);
  await writeFile(path.join(f.session.sourcePath, "unrelated.txt"), "staged original\n");
  await git(f.session.sourcePath, ["add", "unrelated.txt"]);
  await writeFile(path.join(f.session.sourcePath, "unrelated.txt"), "unsaved original\n");
  const headBefore = await git(f.session.sourcePath, ["rev-parse", "HEAD"]);
  const indexBefore = await git(f.session.sourcePath, ["write-tree"]);
  let recovery;
  await assert.rejects(changeIncomingContribution({ ...f, action: "merge", id: f.contribution.id,
    runCommand: commandRunner }), error => {
    recovery = error.details;
    return error.code === "vibe64_incoming_merge_conflict";
  });
  assert.deepEqual(recovery.conflictPaths, ["shared.txt"]);
  assert.equal(await git(f.session.sourcePath, ["show", `${recovery.checkpointCommit}:unrelated.txt`]), "unsaved original");
  await writeFile(path.join(f.session.sourcePath, "shared.txt"), "upstream change plus contribution change\n");
  const before = await git(f.session.sourcePath, ["status", "--porcelain"]);
  const repaired = await changeIncomingContribution({ ...f, action: "review-repair", id: f.contribution.id, runCommand: commandRunner });
  assert.equal(repaired.status, "repair-review");
  assert.match(repaired.diff.content, /upstream change plus contribution change/);
  assert.doesNotMatch(repaired.diff.content, /unrelated/);
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.review.targetHead, "review never publishes");
  const result = await changeIncomingContribution({ ...f, action: "merge", id: f.contribution.id,
    repairReview: repaired.repairReview, runCommand: commandRunner });
  assert.equal(result.status, "merged");
  assert.deepEqual((await git(f.remote, ["show", "-s", "--format=%P", "main"])).split(" "),
    [f.review.targetHead, f.saved.saveCommit]);
  assert.equal(await git(f.remote, ["show", "main:shared.txt"]), "upstream change plus contribution change");
  assert.equal(await git(f.remote, ["show", "main:upstream.txt"]), "retain upstream");
  assert.equal(await git(f.remote, ["show", "main:contribution.txt"]), "retain contribution");
  await assert.rejects(git(f.remote, ["show", "main:unrelated.txt"]));
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), f.saved.saveCommit);
  assert.equal(await git(f.session.sourcePath, ["status", "--porcelain"]), before);
  assert.equal(await git(f.session.sourcePath, ["rev-parse", "HEAD"]), headBefore);
  assert.equal(await git(f.session.sourcePath, ["write-tree"]), indexBefore);
});

test("Incoming repair rejects forged candidates and source changes before or during final review", async t => {
  const f = await conflictingIncomingFixture(t);
  await writeFile(path.join(f.session.sourcePath, "shared.txt"), "resolved both sides\n");
  const input = { ...f, id: f.contribution.id, runCommand: commandRunner };
  const repaired = await changeIncomingContributionDirect({ ...input, action: "review-repair" });
  await assert.rejects(changeIncomingContributionDirect({ ...input, action: "merge",
    repairReview: { ...repaired.repairReview, tree: f.baseCommit } }), { code: "vibe64_incoming_repair_changed" });
  await writeFile(path.join(f.session.sourcePath, "shared.txt"), "later edit\n");
  await assert.rejects(changeIncomingContributionDirect({ ...input, action: "merge", repairReview: repaired.repairReview }),
    { code: "vibe64_incoming_repair_changed" });
  const current = await changeIncomingContributionDirect({ ...input, action: "review-repair" });
  let reads = 0;
  await assert.rejects(changeIncomingContributionDirect({ ...input, action: "merge", repairReview: current.repairReview,
    runCommand: async request => {
      if (request.command === "git" && request.args[0] === "ls-remote" && ++reads === 2) {
        await writeFile(path.join(f.session.sourcePath, "newer.txt"), "concurrent local work\n");
      }
      return commandRunner(request);
    } }), { code: "vibe64_incoming_repair_changed" });
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.review.targetHead);
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), f.saved.saveCommit);
  await git(f.remote, ["update-ref", f.ref, f.baseCommit]);
  await assert.rejects(changeIncomingContributionDirect({ ...input, action: "merge", repairReview: current.repairReview }),
    { code: "vibe64_incoming_review_changed" });
});

test("Incoming repair review cannot publish a nonconflicting contribution", async t => {
  const f = await contributionFixture(t);
  await writeFile(path.join(f.session.sourcePath, "library.txt"), "simple contribution\n");
  await saveSessionWork({ ...f, runCommand: commandRunner });
  await assert.rejects(changeIncomingContribution({ ...f, action: "review-repair", id: f.contribution.id,
    review: await incomingReview(f), runCommand: commandRunner }), { code: "vibe64_incoming_review_changed" });
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
});

test("Incoming Discard renames the exact reviewed branch and preserves the receiving target", async t => {
  const f = await contributionFixture(t);
  await writeFile(path.join(f.session.sourcePath, "library.txt"), "discard this contribution\n");
  const saved = await saveSessionWork({ ...f, runCommand: commandRunner });
  const result = await changeIncomingContribution({ ...f, action: "discard", id: f.contribution.id,
    review: await incomingReview(f), runCommand: commandRunner });
  assert.equal(result.status, "discarded");
  assert.equal(await git(f.remote, ["for-each-ref", "--format=%(refname)", `${f.ref}*`]), `${f.ref}_discarded`);
  assert.equal(await git(f.remote, ["rev-parse", `${f.ref}_discarded`]), saved.saveCommit);
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.baseCommit);
});

test("Incoming Discard without atomic support keeps both refs after interruption and can finish on fresh review", async t => {
  const f = await contributionFixture(t);
  await writeFile(path.join(f.session.sourcePath, "library.txt"), "recoverable contribution\n");
  const saved = await saveSessionWork({ ...f, runCommand: commandRunner });
  let interrupt = true;
  const runCommand = request => {
    if (request.args[0] === "push" && request.args.includes("--atomic")) {
      return { ok: false, stderr: "fatal: the receiving end does not support --atomic push" };
    }
    if (interrupt && request.args[0] === "push" && request.args.includes(`:${f.ref}`)) {
      return { ok: false, stderr: "connection interrupted before delete" };
    }
    return commandRunner(request);
  };
  await assert.rejects(changeIncomingContributionDirect({ ...f, action: "discard", id: f.contribution.id,
    review: await incomingReview(f), runCommand }));
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), saved.saveCommit);
  assert.equal(await git(f.remote, ["rev-parse", `${f.ref}_discarded`]), saved.saveCommit);
  interrupt = false;
  const result = await changeIncomingContributionDirect({ ...f, action: "discard", id: f.contribution.id,
    review: await incomingReview(f), runCommand });
  assert.equal(result.status, "discarded");
  assert.equal(await git(f.remote, ["for-each-ref", "--format=%(refname)", `${f.ref}*`]), `${f.ref}_discarded`);
});

test("Incoming Discard refuses a destination collision and preserves a contribution advanced during push", async t => {
  const f = await contributionFixture(t);
  await writeFile(path.join(f.session.sourcePath, "library.txt"), "contribution\n");
  const saved = await saveSessionWork({ ...f, runCommand: commandRunner });
  await git(f.remote, ["update-ref", `${f.ref}_discarded`, f.baseCommit]);
  await assert.rejects(changeIncomingContributionDirect({ ...f, action: "discard", id: f.contribution.id,
    review: await incomingReview(f), runCommand: commandRunner }), { code: "vibe64_incoming_review_changed" });
  await git(f.remote, ["update-ref", "-d", `${f.ref}_discarded`]);
  await writeFile(path.join(f.session.sourcePath, "later.txt"), "later contribution\n");
  await git(f.session.sourcePath, ["add", "."]);
  await git(f.session.sourcePath, ["commit", "-m", "Later contribution"]);
  const later = await git(f.session.sourcePath, ["rev-parse", "HEAD"]);
  await assert.rejects(changeIncomingContributionDirect({ ...f, action: "discard", id: f.contribution.id,
    review: await incomingReview(f), runCommand: async request => {
      if (request.args[0] === "push") await git(f.session.sourcePath, ["push", f.remote, `${later}:${f.ref}`]);
      return commandRunner(request);
    } }), { code: "vibe64_incoming_discard_unconfirmed" });
  assert.notEqual(later, saved.saveCommit);
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), later);
  assert.equal(await git(f.remote, ["for-each-ref", "--format=%(refname)", `${f.ref}_discarded`]), "");
});


test("connected source snapshot recheck refuses tree, HEAD, or canonical changes after main preparation", async t => {
  for (const changed of ["tree", "head", "canonical"]) {
    const receiver = await contributionFixture(t);
    receiver.session.sessionId = receiver.contribution.id;
    const main = await contributionFixture(t);
    delete main.session.metadata.connected_contribution;
    const work = await inspectSessionWorkDirect({ ...receiver, runCommand: commandRunner });
    const snapshot = { contribution: receiver.contribution, sessionId: receiver.session.sessionId,
      worktreePath: receiver.session.sourcePath, baseCommit: work.baseCommit, canonicalCommit: work.canonicalCommit,
      sessionHead: work.sessionHead, worktreeTree: work.worktreeTree };
    await writeFile(path.join(main.session.sourcePath, "consumer.txt"), "main work\n");
    let pushes = 0;
    await assert.rejects(saveSessionWork({ ...main, connectedWorkSnapshots: [snapshot],
      runCommand: request => {
        if (request.args[0] === "push") pushes++;
        return commandRunner(request);
      },
      onProgress: async progress => {
        if (progress.stage !== "prepared") return;
        if (changed === "tree") {
          await writeFile(path.join(receiver.session.sourcePath, "later.txt"), "new receiving work\n");
        } else {
          const commit = await git(receiver.session.sourcePath, ["commit-tree", work.worktreeTree,
            "-p", work.sessionHead, "-m", "Later receiving revision"]);
          const ref = changed === "head" ? "HEAD" : `refs/vibe64/canonical/${createHash("sha256")
            .update(`vibe64-incoming/${receiver.contribution.id}`).digest("hex").slice(0, 32)}`;
          await git(receiver.session.sourcePath, ["update-ref", ref, commit]);
        }
      }
    }), { code: "vibe64_connected_save_required" });
    assert.equal(pushes, 0, `${changed} changed after main preparation; main must not push`);
    assert.equal(await git(main.remote, ["rev-parse", "main"]), main.baseCommit);
    assert.equal(await readFile(path.join(main.session.sourcePath, "consumer.txt"), "utf8"), "main work\n");
  }
});

test("connected source snapshots cross the managed Save boundary with only their authorized source roots", async t => {
  const receiver = await contributionFixture(t);
  receiver.session.sessionId = receiver.contribution.id;
  const main = await contributionFixture(t);
  delete main.session.metadata.connected_contribution;
  const work = await inspectSessionWorkDirect({ ...receiver, runCommand: commandRunner });
  const snapshot = { contribution: receiver.contribution, sessionId: receiver.session.sessionId,
    worktreePath: receiver.session.sourcePath, baseCommit: work.baseCommit, canonicalCommit: work.canonicalCommit,
    sessionHead: work.sessionHead, worktreeTree: work.worktreeTree };
  await writeFile(path.join(main.session.sourcePath, "consumer.txt"), "main work\n");
  const operationId = "connected-snapshot-save";
  const { checkpoint } = await prepareSessionWorkSaveMessage({ ...main, operationId, runCommand: commandRunner });
  let sourceLock = false;
  let captured = false;
  let admitted = false;
  let maintained;
  const maintenance = new Promise(resolve => { maintained = resolve; });
  const result = await saveManagedSessionWorkImplementation({ ...main, checkpoint, operationId, message: "Use unchanged receiving sources",
    runProjectSourceExclusive: async operation => {
      sourceLock = true;
      try { return await operation(); } finally { sourceLock = false; }
    },
    readConnectedWorkSnapshots: async () => {
      assert.equal(sourceLock, true, "capture authorized snapshots inside the existing main source lock");
      captured = true;
      return [snapshot];
    },
    runCommand: request => {
      const payload = request.command === "node" ? JSON.parse(request.input) : null;
      if (payload?.operation === "save") {
        assert.equal(captured, true);
        assert.deepEqual(payload.input.connectedWorkSnapshots, [snapshot]);
        assert.ok(request.allowedRoots.includes(receiver.session.sourcePath));
        admitted = true;
      }
      return commandRunner(request);
    }, onCacheMaintenance: maintained
  });
  await maintenance;
  assert.equal(admitted, true);
  assert.equal(await git(main.remote, ["rev-parse", "main"]), result.saveCommit);
  assert.equal(await git(receiver.remote, ["rev-parse", "main"]), receiver.baseCommit);
});

test("connected integration gate retains exact revisions through the managed Save boundary", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-connected-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mainRoot = path.join(root, "main");
  const dependencyRoot = path.join(root, "dependency");
  await mkdir(mainRoot); await mkdir(dependencyRoot);
  const main = await createRemoteFixture(mainRoot);
  const dependency = await createRemoteFixture(dependencyRoot);
  const session = await sessionForRemote(mainRoot, main);
  const project = githubProject(mainRoot, main.remote);
  const contribution = { schemaVersion: 1, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    repository: "example/library", integrationBranch: "main", baseCommit: dependency.baseCommit };
  const branch = `vibe64-incoming/${contribution.id}`;
  await git(dependency.seed, ["checkout", "-b", branch]);
  await writeFile(path.join(dependency.seed, "library.txt"), "required library change\n");
  await git(dependency.seed, ["add", "."]);
  await git(dependency.seed, ["commit", "-m", "Change the library"]);
  const submittedCommit = await git(dependency.seed, ["rev-parse", "HEAD"]);
  await git(dependency.seed, ["push", "origin", branch]);
  const receiver = await sessionForRemote(dependencyRoot, dependency, contribution.id);
  receiver.metadata.connected_contribution = JSON.stringify(contribution);
  receiver.metadata.base_commit = submittedCommit;
  receiver.metadata.canonical_commit = submittedCommit;
  await git(receiver.sourcePath, ["reset", "--hard", submittedCommit]);
  const receiverProject = githubProject(dependencyRoot, dependency.remote);
  receiverProject.githubRepository.fullName = contribution.repository;
  const snapshots = async () => [{ contribution, sessionId: contribution.id,
    ...await inspectSessionWorkDirect({ project: receiverProject, session: receiver, runCommand: commandRunner }) }];
  const binding = { schemaVersion: 1, submissions: [{ contribution, submittedCommit }] };
  session.metadata.connected_submissions = JSON.stringify(binding);
  const requests = [];
  const runCommand = request => {
    requests.push(request);
    return commandRunner({ ...request, env: { ...request.env,
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${dependency.remote}.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/example/library.git" } });
  };
  const operationId = "connected-gate-save";
  const prepareClean = async () => prepareSessionWorkSaveMessage({ project, session, runCommand,
    connectedWorkSnapshots: await snapshots() });
  const saveClean = async () => saveSessionWork({ project, session, runCommand,
    connectedWorkSnapshots: await snapshots() });
  for (const inspect of [prepareClean, saveClean]) {
    await assert.rejects(inspect(), error => {
      assert.equal(error.code, "vibe64_connected_integration_pending");
      assert.equal(error.details.submittedCommit, submittedCommit);
      assert.equal(error.details.repository, contribution.repository);
      return true;
    });
    assert.equal(await git(main.remote, ["rev-parse", "main"]), main.baseCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), main.baseCommit);
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  }
  await writeFile(path.join(session.sourcePath, "consumer.txt"), "depends on library change\n");
  const { checkpoint } = await prepareSessionWorkSaveMessage({ project, session, runCommand, operationId });
  const save = () => saveManagedSessionWorkImplementation({ project, session, runCommand, operationId,
    checkpoint, readConnectedWorkSnapshots: snapshots, message: "Use the library change" });
  await assert.rejects(save(), { code: "vibe64_connected_integration_pending" });
  assert.equal(await git(main.remote, ["rev-parse", "main"]), main.baseCommit);
  for (const request of requests.filter(request => request.command === "node")) {
    assert.deepEqual(JSON.parse(JSON.parse(request.input).input.session.metadata.connected_submissions), binding);
  }
  assert.equal(await readFile(path.join(session.sourcePath, "consumer.txt"), "utf8"), "depends on library change\n");

  // Discard is not integration. Both refs retain an interrupted operation.
  await git(dependency.remote, ["update-ref", `refs/heads/${branch}_discarded`, submittedCommit]);
  await assert.rejects(save(), { code: "vibe64_connected_integration_unresolved" });
  await git(dependency.remote, ["update-ref", "-d", `refs/heads/${branch}`]);
  await assert.rejects(save(), { code: "vibe64_connected_integration_discarded" });

  // Integration wins over a discarded suffix. A later unrelated branch revision
  // does not invalidate proof of this task's exact submitted commit.
  await git(dependency.remote, ["update-ref", "refs/heads/main", submittedCommit]);
  await git(dependency.remote, ["update-ref", "-d", `refs/heads/${branch}_discarded`]);
  await writeFile(path.join(dependency.seed, "later.txt"), "later work\n");
  await git(dependency.seed, ["add", "."]);
  await git(dependency.seed, ["commit", "-m", "Later unmerged work"]);
  const laterCommit = await git(dependency.seed, ["rev-parse", "HEAD"]);
  await git(dependency.seed, ["push", "origin", branch]);
  let maintained;
  const maintenance = new Promise(resolve => { maintained = resolve; });
  const saved = await saveManagedSessionWorkImplementation({ project, session, runCommand, operationId,
    checkpoint, readConnectedWorkSnapshots: snapshots,
    message: "Use the integrated library", onCacheMaintenance: maintained });
  await maintenance;
  assert.equal(await git(main.remote, ["rev-parse", "main"]), saved.saveCommit);
  session.metadata.base_commit = saved.saveCommit;
  session.metadata.canonical_commit = saved.saveCommit;
  session.metadata.connected_submissions = JSON.stringify({ schemaVersion: 1,
    submissions: [{ contribution, submittedCommit: laterCommit }] });
  await writeFile(path.join(session.sourcePath, "consumer.txt"), "requires the newer revision\n");
  await assert.rejects(saveSessionWork({ project, session, runCommand }), { code: "vibe64_connected_integration_pending" });
  assert.equal(await git(main.remote, ["rev-parse", "main"]), saved.saveCommit);

  // An absent queue branch is not proof. It succeeds only with target ancestry.
  await git(dependency.remote, ["update-ref", "-d", `refs/heads/${branch}`]);
  await assert.rejects(saveSessionWork({ project, session, runCommand }), { code: "vibe64_connected_integration_pending" });
  await git(dependency.remote, ["update-ref", "refs/heads/main", laterCommit]);
  await assert.rejects(saveSessionWork({ project, session, runCommand,
    connectedWorkSnapshots: await snapshots() }), { code: "vibe64_connected_integration_source_update_required" });
  await git(receiver.sourcePath, ["fetch", "origin", "main"]);
  await git(receiver.sourcePath, ["reset", "--hard", laterCommit]);
  receiver.metadata.base_commit = laterCommit;
  receiver.metadata.canonical_commit = laterCommit;
  const afterDeletion = await saveSessionWork({ project, session, runCommand, connectedWorkSnapshots: await snapshots() });
  assert.equal(afterDeletion.reconciled, true);
  assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), afterDeletion.saveCommit);
  assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  assert.equal(await git(main.remote, ["rev-parse", "main"]), afterDeletion.saveCommit);
  session.metadata.base_commit = afterDeletion.saveCommit;
  session.metadata.canonical_commit = afterDeletion.saveCommit;
  for (const inspect of [prepareClean, saveClean]) {
    await assert.rejects(inspect(), { code: "vibe64_session_save_no_changes" });
    assert.equal(await git(main.remote, ["rev-parse", "main"]), afterDeletion.saveCommit);
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  }
  assert.equal((await git(session.sourcePath, ["for-each-ref", "--format=%(refname)", "refs/vibe64/save"]))
    .split("\n").some(ref => ref.endsWith("/connected-integration")), false);
});

test("connected integration gate refuses malformed bindings and feature branch publication", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-connected-gate-refusal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createRemoteFixture(root);
  const session = await sessionForRemote(root, fixture);
  const project = githubProject(root, fixture.remote);
  await writeFile(path.join(session.sourcePath, "changed.txt"), "preserve work\n");
  session.metadata.connected_submissions = "{}";
  await assert.rejects(saveSessionWork({ project, session, runCommand: commandRunner }),
    { code: "vibe64_connected_submissions_invalid" });
  session.metadata.connected_submissions = JSON.stringify({ schemaVersion: 1, submissions: [{
    contribution: { schemaVersion: 1, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      repository: "example/library", integrationBranch: "main", baseCommit: fixture.baseCommit },
    submittedCommit: "f".repeat(40)
  }] });
  session.metadata.repository_branch = "feature/consumer";
  let pushes = 0;
  const runCommand = request => {
    if (request.command === "git" && request.args[0] === "push") pushes++;
    if (request.command === "git" && request.args.includes("https://github.com/example/library.git")) {
      return { ok: false, stderr: "remote inaccessible", code: "git_failed" };
    }
    return commandRunner(request);
  };
  await assert.rejects(prepareSessionPullRequestBranch({ project, session, runCommand }),
    { code: "vibe64_connected_integration_unknown" });
  assert.equal(pushes, 0);
  assert.equal(await git(fixture.remote, ["for-each-ref", "--format=%(refname)", "refs/heads"]), "refs/heads/main");
  assert.equal(await readFile(path.join(session.sourcePath, "changed.txt"), "utf8"), "preserve work\n");
});

test("connected integration permits a reviewed PR branch only with unchanged accepted source snapshots", async t => {
  const receiver = await contributionFixture(t);
  receiver.session.sessionId = receiver.contribution.id;
  await writeFile(path.join(receiver.session.sourcePath, "library.txt"), "accepted library change\n");
  const submitted = await saveSessionWork({ ...receiver, runCommand: commandRunner });
  receiver.session.metadata.base_commit = submitted.saveCommit;
  receiver.session.metadata.canonical_commit = submitted.saveCommit;
  await git(receiver.remote, ["update-ref", "refs/heads/main", submitted.saveCommit]);
  const main = await contributionFixture(t);
  delete main.session.metadata.connected_contribution;
  main.session.metadata.connected_submissions = JSON.stringify({ schemaVersion: 1,
    submissions: [{ contribution: receiver.contribution, submittedCommit: submitted.saveCommit }] });
  main.session.metadata.repository_branch = "feature/consumer";
  const runCommand = request => commandRunner({ ...request,
    args: request.args.map(arg => arg === "https://github.com/example/project.git" ? receiver.remote : arg) });
  const work = await inspectSessionWorkDirect({ ...receiver, runCommand: commandRunner });
  const snapshot = { contribution: receiver.contribution, sessionId: receiver.contribution.id,
    worktreePath: receiver.session.sourcePath, baseCommit: work.baseCommit, canonicalCommit: work.canonicalCommit,
    sessionHead: work.sessionHead, worktreeTree: work.worktreeTree };
  await assert.rejects(prepareSessionPullRequestBranch({ ...main, runCommand }),
    { code: "vibe64_connected_integration_source_update_required" });
  await writeFile(path.join(receiver.session.sourcePath, "unsaved.txt"), "new connected work\n");
  await assert.rejects(prepareSessionPullRequestBranch({ ...main, runCommand, connectedWorkSnapshots: [snapshot] }),
    { code: "vibe64_connected_save_required" });
  assert.equal(await git(main.remote, ["for-each-ref", "--format=%(refname)", "refs/heads"]), "refs/heads/main");
  await rm(path.join(receiver.session.sourcePath, "unsaved.txt"));
  await prepareSessionPullRequestBranch({ ...main, runCommand, connectedWorkSnapshots: [snapshot] });
  assert.equal(await git(main.remote, ["rev-parse", "refs/heads/feature/consumer"]), main.baseCommit);
  assert.equal(await git(main.remote, ["rev-parse", "refs/heads/main"]), main.baseCommit);
  assert.equal(await git(receiver.remote, ["rev-parse", receiver.ref]), submitted.saveCommit);
});


test("replacement contribution preserves discarded ancestry and gates Main Save on accepted replacement source", async t => {
  const receiver = await contributionFixture(t);
  await writeFile(path.join(receiver.session.sourcePath, "library.txt"), "original contribution\n");
  const original = await saveSessionWork({ ...receiver, runCommand: commandRunner });
  await changeIncomingContributionDirect({ ...receiver, action: "discard", id: receiver.contribution.id,
    review: await incomingReview(receiver), runCommand: commandRunner });
  await writeFile(path.join(receiver.session.sourcePath, "unsaved.txt"), "keep this old checkout\n");

  const replacement = { ...receiver.contribution, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    replaces: receiver.contribution.id, baseCommit: original.saveCommit };
  const sourceRoot = path.dirname(receiver.seed);
  const session = await sessionForRemote(sourceRoot, receiver, replacement.id);
  await git(session.sourcePath, ["reset", "--hard", original.saveCommit]);
  Object.assign(session.metadata, { connected_contribution: JSON.stringify(replacement),
    base_commit: original.saveCommit, canonical_commit: original.saveCommit });
  const replaced = { project: receiver.project, session, runCommand: commandRunner };
  const initial = await checkSessionUpdates(replaced);
  assert.equal(initial.canonicalSource.ref, `${receiver.ref}_discarded`, "renewal freezes the real initial authority ref");
  await writeFile(path.join(session.sourcePath, "library.txt"), "revised contribution\n");
  const submitted = await saveSessionWork(replaced);
  assert.equal(await git(receiver.remote, ["rev-parse", `refs/heads/vibe64-incoming/${replacement.id}^`]), original.saveCommit);
  assert.equal(await git(receiver.remote, ["rev-parse", `${receiver.ref}_discarded`]), original.saveCommit);
  assert.equal(await git(receiver.remote, ["for-each-ref", "--format=%(refname)", receiver.ref]), "");
  assert.equal(await readFile(path.join(receiver.session.sourcePath, "unsaved.txt"), "utf8"), "keep this old checkout\n");
  Object.assign(session.metadata, { base_commit: submitted.saveCommit, canonical_commit: submitted.saveCommit });

  const main = await contributionFixture(t);
  delete main.session.metadata.connected_contribution;
  main.session.metadata.connected_submissions = JSON.stringify({ schemaVersion: 1, submissions: [
    { contribution: receiver.contribution, submittedCommit: original.saveCommit },
    { contribution: replacement, submittedCommit: submitted.saveCommit }
  ] });
  await writeFile(path.join(main.session.sourcePath, "consumer.txt"), "use revised library\n");
  const runCommand = request => commandRunner({ ...request, env: { ...request.env,
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${receiver.remote}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/example/project.git" } });
  let selectedSession = session;
  const snapshots = async () => [{ contribution: replacement, sessionId: selectedSession.sessionId,
    ...await inspectSessionWorkDirect({ ...replaced, session: selectedSession }) }];
  await assert.rejects(saveSessionWork({ ...main, runCommand, connectedWorkSnapshots: await snapshots() }),
    { code: "vibe64_connected_integration_discarded" });
  assert.equal(await git(main.remote, ["rev-parse", "main"]), main.baseCommit);

  // Receiving acceptance may include repairs beyond the submitted revision.
  const accepted = await git(session.sourcePath, ["commit-tree", `${submitted.saveCommit}^{tree}`,
    "-p", submitted.saveCommit, "-m", "Accept replacement"]);
  await git(session.sourcePath, ["push", receiver.remote, `${accepted}:refs/heads/main`]);
  await assert.rejects(saveSessionWork({ ...main, runCommand, connectedWorkSnapshots: await snapshots() }),
    { code: "vibe64_connected_integration_source_update_required" });
  await updateSessionWork(replaced);
  Object.assign(session.metadata, { base_commit: accepted, canonical_commit: accepted });
  selectedSession = await sessionForRemote(sourceRoot, { ...receiver, baseCommit: accepted }, "renewed-replacement");
  selectedSession.metadata.connected_contribution = JSON.stringify(replacement);
  selectedSession.metadata.canonical_commit = accepted;
  const saved = await saveSessionWork({ ...main, runCommand, connectedWorkSnapshots: await snapshots() });
  assert.equal(await git(main.remote, ["rev-parse", "main"]), saved.saveCommit);
  assert.equal(await git(receiver.remote, ["rev-parse", `${receiver.ref}_discarded`]), original.saveCommit);
});

async function incomingDerivedFixture(t, { authoredConflict = false } = {}) {
  const f = await contributionFixture(t);
  const mapPath = ".genesis/machine-city.json";
  for (const source of [f.session.sourcePath, f.seed]) {
    await mkdir(path.join(source, ".genesis"), { recursive: true });
    await mkdir(path.join(source, "genesis"), { recursive: true });
    await writeFile(path.join(source, "genesis/stack.md"), "# Stack\n\n## Components\n");
  }
  await writeFile(path.join(f.session.sourcePath, mapPath), '{"side":"contribution"}\n');
  await writeFile(path.join(f.session.sourcePath, "contribution.txt"), "retain contribution\n");
  if (authoredConflict) await writeFile(path.join(f.session.sourcePath, "shared.txt"), "contribution change\n");
  f.saved = await saveSessionWork({ ...f, runCommand: commandRunner });
  await writeFile(path.join(f.seed, mapPath), '{"side":"target"}\n');
  await writeFile(path.join(f.seed, "upstream.txt"), "retain upstream\n");
  if (authoredConflict) await writeFile(path.join(f.seed, "shared.txt"), "upstream change\n");
  await git(f.seed, ["add", "."]);
  await git(f.seed, ["commit", "-m", "Advance target and generated map"]);
  await git(f.seed, ["push", "origin", "main"]);
  f.review = await incomingReview(f);
  return { ...f, id: f.contribution.id, derivedArtifactPaths: [mapPath, ".genesis/program-city.json"],
    runCommand: commandRunner };
}

test("Incoming Merge regenerates derived-only conflicts through the managed boundary without AI", async t => {
  const f = await incomingDerivedFixture(t);
  const localMap = await readFile(path.join(f.session.sourcePath, ".genesis/machine-city.json"), "utf8");
  const head = await git(f.session.sourcePath, ["rev-parse", "HEAD"]);
  const index = await git(f.session.sourcePath, ["write-tree"]);
  const result = await changeIncomingContribution({ ...f, action: "merge" });
  assert.equal(result.status, "merged");
  assert.deepEqual((await git(f.remote, ["show", "-s", "--format=%P", "main"])).split(" "),
    [f.review.targetHead, f.saved.saveCommit]);
  assert.equal(await git(f.remote, ["show", "main:contribution.txt"]), "retain contribution");
  assert.equal(await git(f.remote, ["show", "main:upstream.txt"]), "retain upstream");
  const machine = JSON.parse(await git(f.remote, ["show", "main:.genesis/machine-city.json"]));
  const program = JSON.parse(await git(f.remote, ["show", "main:.genesis/program-city.json"]));
  assert.equal(machine.schema, "genesis.machine-city.v1");
  assert.equal(program.schema, "genesis.program-city.v1");
  assert.equal(machine.side, undefined, "the real Genesis owner replaces the conflicting stale map");
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), f.saved.saveCommit);
  assert.equal(await git(f.session.sourcePath, ["rev-parse", "HEAD"]), head);
  assert.equal(await git(f.session.sourcePath, ["write-tree"]), index);
  assert.equal(await readFile(path.join(f.session.sourcePath, ".genesis/machine-city.json"), "utf8"), localMap);
});

test("Incoming repair reviews regenerated artifacts from only repaired authored conflict paths", async t => {
  const f = await incomingDerivedFixture(t, { authoredConflict: true });
  await writeFile(path.join(f.session.sourcePath, "unrelated.txt"), "staged local\n");
  await git(f.session.sourcePath, ["add", "unrelated.txt"]);
  await writeFile(path.join(f.session.sourcePath, "unrelated.txt"), "unstaged local\n");
  const head = await git(f.session.sourcePath, ["rev-parse", "HEAD"]);
  const index = await git(f.session.sourcePath, ["write-tree"]);
  const localMap = await readFile(path.join(f.session.sourcePath, ".genesis/machine-city.json"), "utf8");
  let regenerated = 0;
  const input = { ...f, refreshDerivedArtifacts: async ({ projectRoot }) => {
    regenerated++;
    assert.notEqual(projectRoot, f.session.sourcePath);
    assert.equal(await readFile(path.join(projectRoot, "shared.txt"), "utf8"), "resolved both changes\n");
    assert.equal(await readFile(path.join(projectRoot, "contribution.txt"), "utf8"), "retain contribution\n");
    assert.equal(await readFile(path.join(projectRoot, "upstream.txt"), "utf8"), "retain upstream\n");
    await assert.rejects(readFile(path.join(projectRoot, "unrelated.txt")), { code: "ENOENT" });
    await writeFile(path.join(projectRoot, ".genesis/machine-city.json"), '{"generated":"resolved both changes"}\n');
  } };
  await assert.rejects(changeIncomingContributionDirect({ ...input, action: "merge" }), error => {
    assert.equal(error.code, "vibe64_incoming_merge_conflict");
    assert.deepEqual(error.details.conflictPaths, ["shared.txt"]);
    return true;
  });
  assert.equal(regenerated, 0, "unresolved authored conflicts are not indexed");
  await writeFile(path.join(f.session.sourcePath, "shared.txt"), "resolved both changes\n");
  const status = await git(f.session.sourcePath, ["status", "--porcelain"]);
  const repaired = await changeIncomingContributionDirect({ ...input, action: "review-repair" });
  assert.deepEqual(repaired.conflictPaths, ["shared.txt"]);
  assert.match(repaired.diff.content, /generated.*resolved both changes/);
  assert.doesNotMatch(repaired.diff.content, /unrelated/);
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.review.targetHead);
  await assert.rejects(changeIncomingContributionDirect({ ...input, action: "merge", repairReview: repaired.repairReview,
    refreshDerivedArtifacts: async ({ projectRoot }) => {
      await writeFile(path.join(projectRoot, ".genesis/machine-city.json"), '{"generated":"different candidate"}\n');
    } }), { code: "vibe64_incoming_repair_changed" });
  const result = await changeIncomingContributionDirect({ ...input, action: "merge", repairReview: repaired.repairReview });
  assert.equal(result.status, "merged");
  assert.equal(regenerated, 2, "Merge recomputes the reviewed generated candidate");
  assert.equal(await git(f.remote, ["rev-parse", "main^{tree}"]), repaired.repairReview.tree);
  assert.deepEqual((await git(f.remote, ["show", "-s", "--format=%P", "main"])).split(" "),
    [f.review.targetHead, f.saved.saveCommit]);
  assert.equal(await git(f.remote, ["show", "main:.genesis/machine-city.json"]), '{"generated":"resolved both changes"}');
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), f.saved.saveCommit);
  assert.equal(await git(f.session.sourcePath, ["rev-parse", "HEAD"]), head);
  assert.equal(await git(f.session.sourcePath, ["write-tree"]), index);
  assert.equal(await git(f.session.sourcePath, ["status", "--porcelain"]), status);
  assert.equal(await readFile(path.join(f.session.sourcePath, ".genesis/machine-city.json"), "utf8"), localMap);
  assert.equal(await readFile(path.join(f.session.sourcePath, "unrelated.txt"), "utf8"), "unstaged local\n");
});

test("Incoming derived regeneration failure preserves remote heads and receiving source", async t => {
  const f = await incomingDerivedFixture(t);
  await writeFile(path.join(f.session.sourcePath, "unrelated.txt"), "retain local\n");
  const before = await git(f.session.sourcePath, ["status", "--porcelain"]);
  const head = await git(f.session.sourcePath, ["rev-parse", "HEAD"]);
  const index = await git(f.session.sourcePath, ["write-tree"]);
  const worktrees = await git(f.session.sourcePath, ["worktree", "list", "--porcelain"]);
  await assert.rejects(changeIncomingContributionDirect({ ...f, action: "merge", refreshDerivedArtifacts: async () => {
    throw new Error("Genesis regeneration failed");
  } }), /Genesis regeneration failed/u);
  assert.equal(await git(f.remote, ["rev-parse", "main"]), f.review.targetHead);
  assert.equal(await git(f.remote, ["rev-parse", f.ref]), f.saved.saveCommit);
  assert.equal(await git(f.session.sourcePath, ["status", "--porcelain"]), before);
  assert.equal(await git(f.session.sourcePath, ["rev-parse", "HEAD"]), head);
  assert.equal(await git(f.session.sourcePath, ["write-tree"]), index);
  assert.equal(await git(f.session.sourcePath, ["worktree", "list", "--porcelain"]), worktrees);
});

test("Save reports when its commit carries the stand-in Git identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-identity-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    const save = async (operationId, filename, env = {}) => {
      await writeFile(path.join(session.sourcePath, filename), `${operationId}\n`, "utf8");
      const result = await saveSessionWork({
        commandOptions: { gitAuthToken: "identity-token", gitTransport: "github-token" },
        operationId,
        project,
        runCommand: (request) => commandRunner({ ...request, env: { ...(request.env || {}), ...env } }),
        session
      });
      session.metadata.base_commit = result.saveCommit;
      session.metadata.canonical_commit = result.saveCommit;
      return result;
    };
    const own = await save("save-own-identity", "own.txt");
    assert.equal(own.standInIdentity, false);
    const standIn = await save("save-stand-in-identity", "stand-in.txt", {
      GIT_AUTHOR_EMAIL: "ana@local.users.vibe64.invalid",
      GIT_AUTHOR_NAME: "ana via Vibe64"
    });
    assert.equal(standIn.standInIdentity, true);
    assert.equal(await git(root, ["--git-dir", fixture.remote, "show", "-s", "--format=%ae", standIn.saveCommit]),
      "ana@local.users.vibe64.invalid");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
