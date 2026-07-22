import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkpointPair,
  readPairSnapshot,
  receiptPathForPair,
  resolveModulePair,
  statusFile,
  syncChanged,
  syncFile
} from "../src/index.js";
import { runProgSyncCommand } from "../src/command.js";
import { PROGSYNC_STATE_REF } from "../src/constants.js";
import {
  createGitProject,
  readContext,
  synchronizationReport,
  writeFiles,
  writeWorkspace
} from "./helpers.js";

const PROGRAM = `# Greeting

Returns the configured greeting.

## Uses

- Nothing outside this file.

## Provides

### \`greet()\`

The function returns \`hello\`.
`;

const IMPLEMENTATION = "function greet() { return \"hello\"; }\n\nexport { greet };\n";

async function git(root, args, options = {}) {
  const result = await runProgSyncCommand("git", args, {
    cwd: root,
    outputEncoding: "base64",
    reject: options.reject ?? true
  });
  return options.result ? result : result.stdout.trim();
}

test("stores accepted pairs in one private ref without touching project Git state", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": IMPLEMENTATION
  });
  const pair = resolveModulePair(root, "src/greet.js");
  const before = {
    branch: await git(root, ["branch", "--show-current"]),
    head: await git(root, ["rev-parse", "HEAD"]),
    indexTree: await git(root, ["write-tree"]),
    status: await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])
  };

  const checkpoint = await checkpointPair({
    mode: "NO_CHANGE",
    pair,
    runnerProfile: {
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh"
    }
  });

  assert.equal(await git(root, ["rev-parse", PROGSYNC_STATE_REF]), checkpoint.commit);
  assert.notEqual(checkpoint.commit, before.head);
  assert.equal(
    await git(root, ["show", `${checkpoint.commit}:program/src/greet.js.md`]),
    PROGRAM.trimEnd()
  );
  assert.equal(
    await git(root, ["show", `${checkpoint.commit}:src/greet.js`]),
    IMPLEMENTATION.trimEnd()
  );
  const receipt = JSON.parse(await git(root, [
    "show",
    `${checkpoint.commit}:${receiptPathForPair(pair)}`
  ]));
  assert.equal(receipt.programPath, pair.programPath);
  assert.equal(receipt.implementationPath, pair.implementationPath);
  assert.deepEqual(receipt.runnerProfile, {
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh"
  });
  assert.deepEqual({
    branch: await git(root, ["branch", "--show-current"]),
    head: await git(root, ["rev-parse", "HEAD"]),
    indexTree: await git(root, ["write-tree"]),
    status: await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])
  }, before);
});

test("updating one pair retains other pairs and links private checkpoint history", async (t) => {
  const root = await createGitProject(t, {
    "program/src/first.js.md": PROGRAM.replaceAll("greet", "first"),
    "program/src/second.js.md": PROGRAM.replaceAll("greet", "second"),
    "src/first.js": IMPLEMENTATION.replaceAll("greet", "first"),
    "src/second.js": IMPLEMENTATION.replaceAll("greet", "second")
  });
  const firstPair = resolveModulePair(root, "src/first.js");
  const secondPair = resolveModulePair(root, "src/second.js");
  const first = await checkpointPair({ mode: "NO_CHANGE", pair: firstPair });
  const second = await checkpointPair({ mode: "NO_CHANGE", pair: secondPair });

  assert.equal(await git(root, ["rev-parse", `${second.commit}^`]), first.commit);
  assert.match(
    await git(root, ["show", `${second.commit}:${firstPair.programPath}`]),
    /first\(\)/u
  );
  assert.match(
    await git(root, ["show", `${second.commit}:${secondPair.programPath}`]),
    /second\(\)/u
  );
});

test("concurrent pair checkpoints preserve every update through ref retries", async (t) => {
  const files = {};
  for (const name of ["alpha", "beta", "gamma", "delta"]) {
    files[`program/src/${name}.js.md`] = PROGRAM.replaceAll("greet", name);
    files[`src/${name}.js`] = IMPLEMENTATION.replaceAll("greet", name);
  }
  const root = await createGitProject(t, files);
  const pairs = ["alpha", "beta", "gamma", "delta"]
    .map((name) => resolveModulePair(root, `src/${name}.js`));

  await Promise.all(pairs.map((pair) => checkpointPair({ mode: "NO_CHANGE", pair })));

  const finalCommit = await git(root, ["rev-parse", PROGSYNC_STATE_REF]);
  for (const pair of pairs) {
    assert.match(
      await git(root, ["show", `${finalCommit}:${pair.programPath}`]),
      new RegExp(pair.implementationPath.match(/([^/]+)\.js$/u)[1], "u")
    );
  }
});

test("uses the accepted checkpoint after a sync even while both files remain dirty", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": IMPLEMENTATION
  });
  await writeFiles(root, {
    "program/src/greet.js.md": PROGRAM.replace("returns `hello`", "returns `hello world`")
  });
  let runnerCalls = 0;
  const runner = async ({ mode, workspaceRoot }) => {
    runnerCalls += 1;
    const context = await readContext(workspaceRoot);
    await writeWorkspace(
      workspaceRoot,
      context.target.implementationPath,
      IMPLEMENTATION.replace("hello", "hello world")
    );
    return synchronizationReport(mode);
  };

  const first = await syncFile({ inputPath: "src/greet.js", projectRoot: root, runner });
  assert.equal(first.mode, "PROGRAM_TO_IMPLEMENTATION");
  assert.equal(first.checkpointed, true);
  assert.deepEqual(first.checkpoint.receipt.runnerProfile, {
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh"
  });
  assert.equal(runnerCalls, 1);
  const dirtyPaths = await git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  assert.match(dirtyPaths, /program\/src\/greet\.js\.md/u);
  assert.match(dirtyPaths, /src\/greet\.js/u);

  const second = await syncFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root,
    runner: async () => {
      throw new Error("runner must not be called for an accepted pair");
    }
  });
  assert.equal(second.mode, "NO_CHANGE");
  assert.equal(second.status, "unchanged");
  assert.equal(second.checkpointed, false);
  assert.equal(runnerCalls, 1);

  const changed = await syncChanged({
    projectRoot: root,
    runner: async () => {
      throw new Error("sync --changed must reuse accepted pair state");
    }
  });
  assert.equal(changed.results.length, 1);
  assert.equal(changed.results[0].mode, "NO_CHANGE");
});

test("accepts realization-only implementation changes as the next baseline", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": IMPLEMENTATION
  });
  await syncFile({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner: async () => {
      throw new Error("initial Git-matching pair must not invoke the runner");
    }
  });
  await writeFiles(root, {
    "src/greet.js": `// Preserve this optimization.\n${IMPLEMENTATION}`
  });
  const accepted = await syncFile({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner: async ({ mode }) => synchronizationReport(
      mode,
      "unchanged",
      "Only implementation realization changed."
    )
  });
  assert.equal(accepted.mode, "IMPLEMENTATION_TO_PROGRAM");
  assert.equal(accepted.checkpointed, true);

  const status = await statusFile({ inputPath: "src/greet.js", projectRoot: root });
  assert.equal(status.mode, "NO_CHANGE");
  assert.equal(status.reconciled, true);
  assert.equal(status.gitChanges.implementation, "modified");
  assert.equal(status.progsyncChanges.implementation, "unchanged");
});

test("dry runs and blocked synchronizations never create accepted state", async (t) => {
  const root = await createGitProject(t, {
    "src/greet.js": IMPLEMENTATION
  });
  const proposalRunner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    await writeWorkspace(workspaceRoot, context.target.programPath, PROGRAM);
    return synchronizationReport(mode);
  };
  await syncFile({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner: proposalRunner,
    write: false
  });
  let state = await git(root, ["rev-parse", "--verify", "--quiet", PROGSYNC_STATE_REF], {
    reject: false,
    result: true
  });
  assert.equal(state.ok, false);

  await syncFile({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner: async ({ mode }) => synchronizationReport(mode, "blocked", "Needs a type."),
    write: true
  });
  state = await git(root, ["rev-parse", "--verify", "--quiet", PROGSYNC_STATE_REF], {
    reject: false,
    result: true
  });
  assert.equal(state.ok, false);
});

test("an explicit Git base bypasses an otherwise applicable checkpoint", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": IMPLEMENTATION
  });
  const pair = resolveModulePair(root, "src/greet.js");
  await checkpointPair({ mode: "NO_CHANGE", pair });
  await writeFiles(root, {
    "program/src/greet.js.md": PROGRAM.replace("returns `hello`", "returns `hello world`"),
    "src/greet.js": IMPLEMENTATION.replace("hello", "hello world")
  });
  await checkpointPair({ mode: "RECONCILE_BOTH", pair });

  const accepted = await readPairSnapshot({ pair, projectRoot: root });
  const explicit = await readPairSnapshot({ base: "HEAD", pair, projectRoot: root });
  assert.equal(accepted.baselineKind, "checkpoint");
  assert.equal(accepted.acceptedChanges.program, "unchanged");
  assert.equal(explicit.baselineKind, "git");
  assert.equal(explicit.acceptedChanges.program, "modified");
  assert.equal(explicit.acceptedChanges.implementation, "modified");
});

test("keeps private accepted state isolated between linked worktrees", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": IMPLEMENTATION
  });
  const linked = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-linked-"));
  await fs.rmdir(linked);
  t.after(async () => {
    await runProgSyncCommand("git", ["worktree", "remove", "--force", linked], {
      cwd: root,
      reject: false
    });
    await fs.rm(linked, { force: true, recursive: true });
  });
  await runProgSyncCommand(
    "git",
    ["worktree", "add", "--quiet", "-b", "progsync-linked-test", linked],
    { allowedRoots: [root, path.dirname(linked)], cwd: root }
  );
  const pair = resolveModulePair(root, "src/greet.js");
  const checkpoint = await checkpointPair({ mode: "NO_CHANGE", pair });
  assert.equal(await git(root, ["rev-parse", PROGSYNC_STATE_REF]), checkpoint.commit);
  const linkedState = await git(
    linked,
    ["rev-parse", "--verify", "--quiet", PROGSYNC_STATE_REF],
    { reject: false, result: true }
  );
  assert.equal(linkedState.ok, false);
});

test("uses a same-branch checkpoint across descendant project commits", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": IMPLEMENTATION
  });
  const pair = resolveModulePair(root, "src/greet.js");
  await checkpointPair({ mode: "NO_CHANGE", pair });
  await writeFiles(root, { "notes.txt": "unrelated\n" });
  await git(root, ["add", "notes.txt"]);
  await git(root, ["commit", "--quiet", "-m", "unrelated descendant"]);
  await writeFiles(root, {
    "program/src/greet.js.md": PROGRAM.replace("returns `hello`", "returns a friendly `hello`")
  });

  const snapshot = await readPairSnapshot({ pair, projectRoot: root });
  assert.equal(snapshot.baselineKind, "checkpoint");
  assert.equal(snapshot.checkpoint.reason, "same-branch-history-continues");
  assert.equal(snapshot.acceptedChanges.program, "modified");
  assert.equal(snapshot.acceptedChanges.implementation, "unchanged");
});

test("falls back to Git after a branch change when the pair also changed", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": IMPLEMENTATION
  });
  const pair = resolveModulePair(root, "src/greet.js");
  await checkpointPair({ mode: "NO_CHANGE", pair });
  await git(root, ["switch", "--quiet", "-c", "other-progsync-branch"]);
  await writeFiles(root, {
    "program/src/greet.js.md": PROGRAM.replace("returns `hello`", "returns another `hello`")
  });

  const snapshot = await readPairSnapshot({ pair, projectRoot: root });
  assert.equal(snapshot.baselineKind, "git");
  assert.equal(snapshot.checkpoint.reason, "branch-changed");
  assert.equal(snapshot.acceptedChanges.program, "modified");
  assert.equal(snapshot.acceptedChanges.implementation, "unchanged");
});

test("recognizes an exact accepted pair across a harmless branch switch", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": IMPLEMENTATION
  });
  const pair = resolveModulePair(root, "src/greet.js");
  await checkpointPair({ mode: "NO_CHANGE", pair });
  await git(root, ["switch", "--quiet", "-c", "exact-pair-branch"]);

  const snapshot = await readPairSnapshot({ pair, projectRoot: root });
  assert.equal(snapshot.baselineKind, "checkpoint");
  assert.equal(snapshot.checkpoint.reason, "exact-pair-match");
  assert.equal(snapshot.acceptedChanges.program, "unchanged");
  assert.equal(snapshot.acceptedChanges.implementation, "unchanged");
});
