import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkProgram,
  importProgram,
  syncFile
} from "../src/index.js";
import { installStagedWrite } from "../src/candidate.js";
import { runProgSyncCommand } from "../src/command.js";
import { PROGSYNC_STATE_REF } from "../src/constants.js";
import { acquirePairLock } from "../src/lock.js";
import { resolveModulePair } from "../src/paths.js";
import { pairDigest } from "../src/state.js";
import {
  createGitProject,
  readContext,
  synchronizationReport,
  writeFiles,
  writeWorkspace
} from "./helpers.js";

const PROGRAM = `# Greeting

Returns a greeting.

## Uses

- Nothing outside this file.

## Provides

### \`greet()\`

The function returns \`hello\`.
`;

const IMPLEMENTATION = "function greet() { return \"hello\"; }\n\nexport { greet };\n";

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

test("rejects non-Git projects before invoking a synchronizer", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-no-git-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/greet.js": IMPLEMENTATION });
  let runnerCalled = false;

  await assert.rejects(
    importProgram({
      inputPath: "src/greet.js",
      projectRoot: root,
      runner: async () => {
        runnerCalled = true;
      },
      write: true
    }),
    (error) => error.code === "GIT_REPOSITORY_REQUIRED"
  );
  assert.equal(runnerCalled, false);
  await assert.rejects(fs.stat(path.join(root, "program/src/greet.js.md")), /ENOENT/u);
});

test("does not read a pair through a project-internal symbolic link", async (t) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "greet.js"), IMPLEMENTATION, "utf8");
  const root = await createGitProject(t);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.symlink(path.join(outside, "greet.js"), path.join(root, "src/greet.js"));

  await assert.rejects(
    importProgram({ inputPath: "src/greet.js", projectRoot: root, write: false }),
    (error) => error.code === "SYMLINKED_PROJECT_PATH"
  );
});

test("does not traverse a symbolic-link projection tree while checking", async (t) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-index-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const victim = path.join(outside, "orphan.js.md.json");
  await fs.writeFile(victim, "do not delete\n", "utf8");
  const root = await createGitProject(t, {
    "program/types.md": `# Types

## Uses

- Nothing outside this file.

## Provides

### \`Record\`

A structured record.
`
  });
  await fs.mkdir(path.join(root, ".program"), { recursive: true });
  await fs.symlink(outside, path.join(root, ".program/index"));

  await assert.rejects(
    checkProgram({ projectRoot: root }),
    (error) => error.code === "SYMLINKED_PROJECT_PATH"
  );
  assert.equal(await fs.readFile(victim, "utf8"), "do not delete\n");
});

test("serializes synchronization of the same pair", async (t) => {
  const root = await createGitProject(t, { "src/greet.js": IMPLEMENTATION });
  const entered = deferred();
  const release = deferred();
  const first = importProgram({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      entered.resolve();
      await release.promise;
      const context = await readContext(workspaceRoot);
      await writeWorkspace(workspaceRoot, context.target.programPath, PROGRAM);
      return synchronizationReport(mode);
    },
    write: true
  });
  await entered.promise;
  try {
    await assert.rejects(
      importProgram({
        inputPath: "src/greet.js",
        projectRoot: root,
        runner: async () => {
          throw new Error("the second runner must not start");
        },
        write: true
      }),
      (error) => error.code === "PAIR_BUSY"
    );
  } finally {
    release.resolve();
  }
  const result = await first;
  assert.equal(result.status, "updated");
});

test("allows only one contender to recover and acquire a stale pair lock", async (t) => {
  const root = await createGitProject(t, { "src/greet.js": IMPLEMENTATION });
  const pair = resolveModulePair(root, "src/greet.js");
  const gitPath = (await runProgSyncCommand("git", [
    "rev-parse",
    "--git-path",
    `progsync/locks/${pairDigest(pair)}.lock`
  ], { cwd: root })).stdout.trim();
  const lockPath = path.isAbsolute(gitPath) ? gitPath : path.resolve(root, gitPath);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, `${JSON.stringify({
    hostname: os.hostname(),
    nonce: "stale",
    pid: 2147483647
  })}\n`, "utf8");

  const contenders = await Promise.allSettled([
    acquirePairLock(pair),
    acquirePairLock(pair)
  ]);
  const acquired = contenders.filter(({ status }) => status === "fulfilled");
  const rejected = contenders.filter(({ status }) => status === "rejected");
  assert.equal(acquired.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "PAIR_BUSY");
  await acquired[0].value();
});

test("does not overwrite a file changed at candidate installation time", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-install-race-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const targetPath = path.join(root, "module.js");
  const stagedPath = path.join(root, ".module.js.candidate");
  await fs.writeFile(targetPath, "manual edit\n", "utf8");
  await fs.writeFile(stagedPath, "generated edit\n", "utf8");

  await assert.rejects(
    installStagedWrite({
      original: {
        exists: true,
        mode: 0o644,
        permissions: 0o644,
        source: "accepted source\n"
      },
      stagedPath,
      targetPath
    }),
    (error) => error.code === "PAIR_CHANGED_DURING_SYNCHRONIZATION"
  );
  assert.equal(await fs.readFile(targetPath, "utf8"), "manual edit\n");
});

test("preserves a manual edit made while a candidate is running", async (t) => {
  const root = await createGitProject(t, { "src/greet.js": IMPLEMENTATION });
  const manualSource = `// Manual concurrent edit.\n${IMPLEMENTATION}`;
  const runner = async ({ mode, workspaceRoot }) => {
    await writeFiles(root, { "src/greet.js": manualSource });
    const context = await readContext(workspaceRoot);
    await writeWorkspace(workspaceRoot, context.target.programPath, PROGRAM);
    return synchronizationReport(mode);
  };

  await assert.rejects(
    importProgram({
      inputPath: "src/greet.js",
      projectRoot: root,
      runner,
      write: true
    }),
    (error) => error.code === "PAIR_CHANGED_DURING_SYNCHRONIZATION"
  );
  assert.equal(await fs.readFile(path.join(root, "src/greet.js"), "utf8"), manualSource);
  await assert.rejects(fs.stat(path.join(root, "program/src/greet.js.md")), /ENOENT/u);
});

test("does not overwrite shared types changed while a candidate is running", async (t) => {
  const initialTypes = `# Project types

## Uses

- Nothing outside this file.

## Provides

### \`Existing type\`

An existing public structure.
`;
  const externallyEditedTypes = `${initialTypes}
### \`External type\`

A type added by another process.
`;
  const candidateTypes = `${initialTypes}
### \`Line item\`

A \`Line item\` contains \`amount\`, its numeric amount.
`;
  const amountProgram = `# Amount

## Uses

- Nothing outside this file.

## Provides

### \`amount()\`

The function takes \`line\`, a [Line item], and returns its numeric amount.
`;
  const root = await createGitProject(t, {
    "program/types.md": initialTypes,
    "src/amount.js": "export function amount(line) { return line.amount; }\n"
  });
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    assert.equal(context.sharedTypes.source, initialTypes);
    await writeFiles(root, { "program/types.md": externallyEditedTypes });
    await writeWorkspace(workspaceRoot, context.target.programPath, amountProgram);
    await writeWorkspace(workspaceRoot, "program/types.md", candidateTypes);
    return synchronizationReport(mode);
  };

  await assert.rejects(
    importProgram({
      inputPath: "src/amount.js",
      projectRoot: root,
      runner,
      write: true
    }),
    (error) => error.code === "PAIR_CHANGED_DURING_SYNCHRONIZATION"
  );
  assert.equal(
    await fs.readFile(path.join(root, "program/types.md"), "utf8"),
    externallyEditedTypes
  );
  await assert.rejects(fs.stat(path.join(root, "program/src/amount.js.md")), /ENOENT/u);
});

test("preserves executable mode through an implementation patch and checkpoint", async (t) => {
  const root = await createGitProject(t, {
    "program/bin/greet.mjs.md": PROGRAM,
    "bin/greet.mjs": IMPLEMENTATION
  });
  await fs.chmod(path.join(root, "bin/greet.mjs"), 0o755);
  await runProgSyncCommand("git", ["add", "bin/greet.mjs"], { cwd: root });
  await runProgSyncCommand("git", ["commit", "--quiet", "-m", "executable"], { cwd: root });
  await writeFiles(root, {
    "program/bin/greet.mjs.md": PROGRAM.replace("returns `hello`", "returns `hello world`")
  });
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    await writeWorkspace(
      workspaceRoot,
      context.target.implementationPath,
      IMPLEMENTATION.replace("hello", "hello world")
    );
    return synchronizationReport(mode);
  };

  await syncFile({ inputPath: "bin/greet.mjs", projectRoot: root, runner });
  const stat = await fs.stat(path.join(root, "bin/greet.mjs"));
  assert.notEqual(stat.mode & 0o111, 0);
  const tree = await runProgSyncCommand("git", [
    "ls-tree",
    PROGSYNC_STATE_REF,
    "--",
    "bin/greet.mjs"
  ], { cwd: root });
  assert.match(tree.stdout, /^100755\s/u);
});
