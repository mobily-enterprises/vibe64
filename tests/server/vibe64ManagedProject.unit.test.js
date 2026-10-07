import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  initializeManagedProject,
  materializeInitialProject,
  verifyManagedProjectSource
} from "@local/vibe64-project/server/managedProject";

const execFileAsync = promisify(execFile);

async function directCommand({ args = [], command = "", cwd = "", input, maxBuffer, outputEncoding } = {}) {
  try {
    const execution = execFileAsync(command, args, {
      cwd,
      env: process.env,
      maxBuffer: maxBuffer ?? 4 * 1024 * 1024,
      ...(outputEncoding === "base64" ? { encoding: "buffer" } : {})
    });
    if (input !== undefined) execution.child.stdin.end(input);
    const result = await execution;
    return {
      exitCode: 0,
      ok: true,
      stderr: String(result.stderr || ""),
      stdout: outputEncoding === "base64"
        ? result.stdout.toString("base64")
        : String(result.stdout || "")
    };
  } catch (error) {
    return {
      code: error.code,
      exitCode: Number(error.code) || 1,
      ok: false,
      stderr: String(error.stderr || error.message || ""),
      stdout: String(error.stdout || "")
    };
  }
}

test("initial project materialization publishes one authoritative commit through explicit callbacks", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-initial-project-"));
  t.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  const projectRuntimeRoot = path.join(root, "runtime");
  await mkdir(projectRuntimeRoot);
  const calls = [];

  const result = await materializeInitialProject({
    afterAuthorityVerification: ({ commit }) => {
      calls.push(["after", commit]);
    },
    beforeAuthorityMutation: ({ commit }) => {
      calls.push(["before", commit]);
    },
    projectRuntimeRoot,
    publish: async ({ branch, commit, sourceRoot }) => {
      calls.push(["publish", commit]);
      assert.equal(branch, "main");
      assert.equal((await execFileAsync("git", [
        "-C", sourceRoot, "rev-list", "--count", "HEAD"
      ])).stdout.trim(), "1");
      return {
        branch: "untrusted-branch",
        commit: "untrusted-commit",
        published: true
      };
    },
    runCommand: directCommand
  });

  assert.match(result.materialization.commit, /^[0-9a-f]{40}$/u);
  assert.equal(result.materialization.branch, "main");
  assert.equal(result.materialization.published, true);
  assert.deepEqual(calls.map(([stage]) => stage), ["before", "publish", "after"]);
  assert.deepEqual(new Set(calls.map(([, commit]) => commit)), new Set([
    result.materialization.commit
  ]));
  assert.deepEqual(await readdir(path.join(projectRuntimeRoot, "tmp")), []);
});

test("managed projects begin as one canonical technology-neutral Genesis commit", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-managed-genesis-project-"));
  t.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  const namespaceRoot = path.join(root, "namespace");
  const projectRuntimeRoot = path.join(root, "runtime");
  await Promise.all([
    mkdir(namespaceRoot),
    mkdir(projectRuntimeRoot)
  ]);

  const initialized = await initializeManagedProject({
    projectContextRoot: namespaceRoot,
    projectRuntimeRoot,
    runCommand: directCommand
  });
  const files = (await execFileAsync("git", [
    "--git-dir", initialized.repositoryPath, "ls-tree", "-r", "--name-only", "main"
  ])).stdout.trim().split("\n");
  const stack = (await execFileAsync("git", [
    "--git-dir", initialized.repositoryPath, "show", "main:genesis/stack.md"
  ])).stdout;

  assert.equal((await execFileAsync("git", [
    "--git-dir", initialized.repositoryPath, "rev-list", "--count", "main"
  ])).stdout.trim(), "1");
  assert.equal((await execFileAsync("git", [
    "--git-dir", initialized.repositoryPath, "show", "main:genesis/version"
  ])).stdout, "3\n");
  assert.match(stack, /## Components/u);
  assert.doesNotMatch(stack, /- `jskit`/u);
  assert.equal(files.includes("genesis/engineering.md"), true);
  assert.equal(files.includes(".opencode/plugins/genesis-project-guidance.js"), true);
  assert.equal(files.includes("package.json"), false);
  assert.deepEqual(await readdir(namespaceRoot), []);
  assert.deepEqual(await readdir(path.join(projectRuntimeRoot, "tmp")), []);
});


test("managed project initialization removes its temporary checkout after every failure stage", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-managed-project-failures-"));
  t.after(() => rm(root, {
    force: true,
    recursive: true
  }));

  for (const stage of ["genesis", "commit", "canonical-init", "canonical-install", "verification"]) {
    const caseRoot = path.join(root, stage);
    const namespaceRoot = path.join(caseRoot, "namespace");
    const projectRuntimeRoot = path.join(caseRoot, "runtime");
    await Promise.all([
      mkdir(namespaceRoot, { recursive: true }),
      mkdir(projectRuntimeRoot, { recursive: true })
    ]);
    const runCommand = async (request) => {
      const script = String(request.args?.at(-1) || "");
      const shouldFail = (
        stage === "commit" &&
        request.command === "git" &&
        request.args?.includes("commit")
      ) || (
        stage === "canonical-init" &&
        request.command === "bash" &&
        script.includes("Canonical repository is ready at")
      ) || (
        stage === "canonical-install" &&
        request.command === "bash" &&
        script.includes("CANONICAL_INCOMING_REF")
      ) || (
        stage === "verification" &&
        request.command === "git" &&
        request.args?.includes("refs/heads/main^{commit}")
      );
      return shouldFail
        ? {
            code: `vibe64_test_${stage}_failed`,
            ok: false,
            stderr: `simulated ${stage} failure`
          }
        : directCommand(request);
    };

    await assert.rejects(
      () => initializeManagedProject({
        ...(stage === "genesis" ? {
          initializeProject: async () => {
            throw new Error("simulated Genesis failure");
          }
        } : {}),
        projectContextRoot: namespaceRoot,
        projectRuntimeRoot,
        runCommand,
      }),
      undefined,
      stage
    );

    assert.deepEqual(await readdir(namespaceRoot), [], stage);
    assert.deepEqual(await readdir(path.join(projectRuntimeRoot, "tmp")), [], stage);
  }
});

async function pinnedSourceFixture(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-managed-source-proof-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const namespaceRoot = path.join(root, "namespace");
  const projectRuntimeRoot = path.join(root, "runtime");
  await Promise.all([mkdir(namespaceRoot), mkdir(projectRuntimeRoot)]);
  const initialized = await initializeManagedProject({
    projectContextRoot: namespaceRoot,
    projectRuntimeRoot,
    runCommand: directCommand,
    initializeProject: async ({ projectRoot }) => {
      for (const file of files) {
        const filename = path.join(projectRoot, file.path);
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, file.bytes, { mode: 0o644 });
      }
    }
  });
  return { ...initialized, root, namespaceRoot, projectRuntimeRoot, files };
}

async function repositorySnapshot(directory) {
  const records = [];
  async function visit(filename) {
    const info = await lstat(filename);
    const record = { path: path.relative(directory, filename), mode: info.mode,
      inode: info.ino, mtime: info.mtimeMs };
    if (info.isSymbolicLink()) record.link = await readlink(filename);
    else if (info.isFile()) record.bytes = (await readFile(filename)).toString("base64");
    records.push(record);
    if (info.isDirectory()) {
      for (const name of (await readdir(filename)).sort()) await visit(path.join(filename, name));
    }
  }
  await visit(directory);
  return records;
}

async function installFixtureTree(fixture, entry) {
  const gitArgs = ["--git-dir", fixture.repositoryPath];
  const tree = await directCommand({ command: "git", args: [...gitArgs, "mktree", "-z"], input: entry });
  assert.equal(tree.ok, true, tree.stderr);
  const commit = await directCommand({ command: "git", args: [
    ...gitArgs, "-c", "user.name=Vibe64", "-c", "user.email=vibe64@localhost",
    "commit-tree", tree.stdout.trim(), "-p", fixture.commit, "-m", "Source proof fixture"
  ] });
  assert.equal(commit.ok, true, commit.stderr);
  const update = await directCommand({ command: "git", args: [
    ...gitArgs, "update-ref", "refs/heads/main", commit.stdout.trim()
  ] });
  assert.equal(update.ok, true, update.stderr);
  return commit.stdout.trim();
}

test("managed source proof verifies every ordinary file including binary, empty and whitespace paths without writes", async (t) => {
  const files = [
    { path: "README.md", bytes: Buffer.from("Pinned greeting\n\n") },
    { path: "empty", bytes: Buffer.alloc(0) },
    { path: "nested/binary", bytes: Buffer.from([0, 255, 128, 13, 10, 32]) },
    { path: "nested/tab\tand\nnewline ", bytes: Buffer.from(" final whitespace \n") },
    { path: "unicode-\uFFFD", bytes: Buffer.from("UTF-8 filename") }
  ];
  const fixture = await pinnedSourceFixture(t, files);
  const before = await repositorySnapshot(fixture.repositoryPath);
  const requests = [];
  const proof = await verifyManagedProjectSource({
    ...fixture,
    runCommand: async (request) => {
      requests.push(request);
      return directCommand(request);
    }
  });
  assert.deepEqual(proof, { branch: "main", commit: fixture.commit });
  assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), before);
  assert.deepEqual(await readdir(fixture.namespaceRoot), []);
  assert.deepEqual(await readdir(path.join(fixture.projectRuntimeRoot, "tmp")), []);
  assert.equal(requests.find(request => request.args.includes("ls-tree")).outputEncoding, "base64");
  const hashes = requests.filter(request => request.args.includes("hash-object"));
  assert.equal(hashes.length, files.length);
  assert.equal(hashes.every(request => Buffer.isBuffer(request.input) && request.args.includes("--no-filters") && !request.args.includes("-w")), true);
});

test("managed source proof refuses missing, extra and changed canonical bytes without filtering or repair", async (t) => {
  const files = [{ path: "app.txt", bytes: Buffer.from("hello") },
    { path: "node_modules/declared.txt", bytes: Buffer.from("declared") }];
  const fixture = await pinnedSourceFixture(t, files);
  const before = await repositorySnapshot(fixture.repositoryPath);
  for (const expected of [
    files.slice(0, 1),
    [...files, { path: "missing.txt", bytes: Buffer.from("missing") }],
    [{ ...files[0], bytes: Buffer.from("HELLO") }, files[1]],
    [{ ...files[0], path: "other.txt" }, files[1]]
  ]) {
    await assert.rejects(() => verifyManagedProjectSource({ ...fixture, files: expected, runCommand: directCommand }),
      { code: "vibe64_managed_project_source_mismatch" });
    assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), before);
  }
  // The generic proof excludes nothing. The installed reader, rather than this
  // Git owner, determines whether a directory belongs in the admitted exercise.
  assert.deepEqual(await verifyManagedProjectSource({ ...fixture, runCommand: directCommand }),
    { branch: "main", commit: fixture.commit });
});

test("managed source proof refuses executable, symlink, gitlink, non-UTF-8 and extra empty-tree entries", async (t) => {
  const fixture = await pinnedSourceFixture(t, [{ path: "app.txt", bytes: Buffer.from("hello") }]);
  const blob = (await execFileAsync("git", ["--git-dir", fixture.repositoryPath, "rev-parse", "main:app.txt"])).stdout.trim();
  for (const [mode, type, objectId] of [
    ["100755", "blob", blob], ["120000", "blob", blob], ["160000", "commit", fixture.commit]
  ]) {
    await installFixtureTree(fixture, Buffer.from(`${mode} ${type} ${objectId}\tapp.txt\0`));
    const before = await repositorySnapshot(fixture.repositoryPath);
    await assert.rejects(() => verifyManagedProjectSource({ ...fixture, runCommand: directCommand }),
      { code: "vibe64_managed_project_source_mismatch" });
    assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), before);
  }
  await installFixtureTree(fixture, Buffer.concat([
    Buffer.from(`100644 blob ${blob}\t`), Buffer.from([255]), Buffer.from("\0")
  ]));
  const before = await repositorySnapshot(fixture.repositoryPath);
  await assert.rejects(() => verifyManagedProjectSource({ ...fixture,
    files: [{ path: "\uFFFD", bytes: Buffer.from("hello") }], runCommand: directCommand }),
  { code: "vibe64_managed_project_source_mismatch" });
  assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), before);
  const emptyTree = await directCommand({ command: "git", args: [
    "--git-dir", fixture.repositoryPath, "mktree", "-z"
  ], input: Buffer.alloc(0) });
  assert.equal(emptyTree.ok, true, emptyTree.stderr);
  await installFixtureTree(fixture, Buffer.from(
    `100644 blob ${blob}\tapp.txt\0` +
    `040000 tree ${emptyTree.stdout.trim()}\tempty-unexpected\0`
  ));
  const emptyTreeBefore = await repositorySnapshot(fixture.repositoryPath);
  await assert.rejects(() => verifyManagedProjectSource({ ...fixture, runCommand: directCommand }),
    { code: "vibe64_managed_project_source_mismatch" });
  assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), emptyTreeBefore);
});

test("managed source proof enforces installed-source bounds and exact path inputs before Git reads", async (t) => {
  const oneMiB = Buffer.alloc(1024 * 1024, 65);
  const files = Array.from({ length: 512 }, (_, index) => ({
    path: `file-${String(index).padStart(3, "0")}`,
    bytes: index < 32 ? oneMiB : Buffer.alloc(0)
  }));
  const fixture = await pinnedSourceFixture(t, files);
  assert.deepEqual(await verifyManagedProjectSource({ ...fixture, runCommand: directCommand }),
    { branch: "main", commit: fixture.commit });
  const before = await repositorySnapshot(fixture.repositoryPath);
  const invalid = [
    { files: [...files, { path: "excess", bytes: Buffer.alloc(0) }] },
    { files: [{ path: "large", bytes: Buffer.alloc(oneMiB.length + 1) }] },
    { files: Array.from({ length: 33 }, (_, index) => ({ path: `large-${index}`, bytes: oneMiB })) },
    { files: [{ path: "duplicate", bytes: oneMiB }, { path: "duplicate", bytes: oneMiB }] },
    { files: [{ path: "string", bytes: "hello" }] },
    { branch: " main " },
    { projectRuntimeRoot: `${fixture.projectRuntimeRoot}/../runtime` },
    ...["/absolute", "../escape", "nested/../escape", "nested//file", "./file", "nested\\file", "nul\0file"].map(filename => ({
      files: [{ path: filename, bytes: Buffer.alloc(0) }]
    }))
  ];
  for (const change of invalid) {
    await assert.rejects(() => verifyManagedProjectSource({ ...fixture, ...change,
      runCommand: () => { throw new Error("Invalid input reached Git."); } }),
    { code: "vibe64_managed_project_source_invalid" });
    assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), before);
  }
});

test("managed source proof refuses canonical storage aliases, non-bare repositories and unsafe refs", async (t) => {
  const fixture = await pinnedSourceFixture(t, [{ path: "app.txt", bytes: Buffer.from("hello") }]);
  const before = await repositorySnapshot(fixture.repositoryPath);
  const alias = path.join(fixture.root, "runtime-alias");
  await symlink(fixture.projectRuntimeRoot, alias);
  await assert.rejects(() => verifyManagedProjectSource({ ...fixture, projectRuntimeRoot: alias, runCommand: directCommand }),
    { code: "vibe64_managed_project_source_unsafe" });
  for (const original of [path.dirname(fixture.repositoryPath), fixture.repositoryPath]) {
    const moved = `${original}-actual`;
    await rename(original, moved);
    await symlink(moved, original);
    try {
      await assert.rejects(() => verifyManagedProjectSource({ ...fixture, runCommand: directCommand }),
        { code: "vibe64_managed_project_source_unsafe" });
    } finally {
      await rm(original);
      await rename(moved, original);
    }
  }
  assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), before);
  for (const branch of ["../escape", "main\nother", "main^{tree}", "missing"]) {
    await assert.rejects(() => verifyManagedProjectSource({ ...fixture, branch, runCommand: directCommand }));
    assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), before);
  }
  const preserved = `${fixture.repositoryPath}-preserved`;
  await rename(fixture.repositoryPath, preserved);
  await execFileAsync("git", ["init", "--bare", "--template=", fixture.repositoryPath]);
  await execFileAsync("git", ["--git-dir", fixture.repositoryPath, "config", "core.bare", "false"]);
  const nonBareBefore = await repositorySnapshot(fixture.repositoryPath);
  await assert.rejects(() => verifyManagedProjectSource({ ...fixture, runCommand: directCommand }),
    { code: "vibe64_managed_project_source_unsafe" });
  assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), nonBareBefore);
  assert.deepEqual(await repositorySnapshot(preserved), before);
});

test("managed source proof returns the resolved immutable commit when canonical authority advances during inspection", async (t) => {
  const fixture = await pinnedSourceFixture(t, [{ path: "app.txt", bytes: Buffer.from("hello") }]);
  const blob = await directCommand({ command: "git", args: [
    "--git-dir", fixture.repositoryPath, "hash-object", "-w", "--stdin"
  ], input: Buffer.from("later learner work") });
  assert.equal(blob.ok, true, blob.stderr);
  let laterCommit;
  const proof = await verifyManagedProjectSource({ ...fixture,
    runCommand: async (request) => {
      if (request.args.includes("ls-tree")) {
        assert.equal(request.args.at(-1), fixture.commit);
        laterCommit = await installFixtureTree(fixture,
          Buffer.from(`100644 blob ${blob.stdout.trim()}\tapp.txt\0`));
      }
      return directCommand(request);
    }
  });
  assert.notEqual(laterCommit, fixture.commit);
  assert.deepEqual(proof, { branch: "main", commit: fixture.commit });
  assert.equal((await execFileAsync("git", ["--git-dir", fixture.repositoryPath,
    "rev-parse", "refs/heads/main"])).stdout.trim(), laterCommit);
  const before = await repositorySnapshot(fixture.repositoryPath);
  await assert.rejects(() => verifyManagedProjectSource({ ...fixture, runCommand: directCommand }),
    { code: "vibe64_managed_project_source_mismatch" });
  assert.deepEqual(await repositorySnapshot(fixture.repositoryPath), before);
});
