import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { inspectSessionSourceMergeState } from "../../packages/vibe64-runtime/src/server/sessionSourceGit.js";

const execFileAsync = promisify(execFile);
const REAL_GIT = (await execFileAsync("sh", ["-c", "command -v git"])).stdout.trim();

async function git(cwd, args = []) {
  return (await execFileAsync(REAL_GIT, args, { cwd, encoding: "utf8" }).catch((error) => error)).stdout?.trim();
}

// A session source whose main and `other` branches change the same line.
async function conflictingSource(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-merge-state-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const source = path.join(root, "source");
  await mkdir(source);
  await git(source, ["init", "--initial-branch=main"]);
  await git(source, ["config", "user.name", "Vibe64 Test"]);
  await git(source, ["config", "user.email", "vibe64@example.test"]);
  const commit = async (text) => {
    await writeFile(path.join(source, "app.txt"), `${text}\n`, "utf8");
    await git(source, ["add", "app.txt"]);
    await git(source, ["commit", "-m", text]);
  };
  await commit("initial");
  await git(source, ["checkout", "-b", "other"]);
  await commit("theirs");
  await git(source, ["checkout", "main"]);
  await commit("ours");
  return source;
}

// Counts the conflict listings the inspection asks Git for.
async function countedConflictChecks(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-merge-state-git-"));
  const log = path.join(root, "calls");
  await mkdir(path.join(root, "bin"));
  await writeFile(path.join(root, "bin", "git"), [
    "#!/bin/sh",
    `case "$*" in *--diff-filter=U*) echo check >> '${log}' ;; esac`,
    `exec '${REAL_GIT}' "$@"`,
    ""
  ].join("\n"), { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${path.join(root, "bin")}:${previousPath}`;
  t.after(async () => {
    process.env.PATH = previousPath;
    await rm(root, { force: true, recursive: true });
  });
  return async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).length;
}

test("a session's conflicts are listed again only after its Git index changes", async (t) => {
  const source = await conflictingSource(t);
  const checks = await countedConflictChecks(t);

  assert.deepEqual(await inspectSessionSourceMergeState(source), { conflictedFiles: [], hasConflicts: false });
  assert.deepEqual(await inspectSessionSourceMergeState(source), { conflictedFiles: [], hasConflicts: false });
  assert.equal(await checks(), 1, "an unchanged index is not inspected again");

  await git(source, ["merge", "other"]);
  const conflicted = await inspectSessionSourceMergeState(source);
  assert.deepEqual(conflicted, { conflictedFiles: ["app.txt"], hasConflicts: true });
  assert.equal(await checks(), 2, "the merge rewrote the index");
  conflicted.conflictedFiles.push("caller-edit.txt");
  assert.deepEqual(await inspectSessionSourceMergeState(source), { conflictedFiles: ["app.txt"], hasConflicts: true });
  assert.equal(await checks(), 2);

  await writeFile(path.join(source, "app.txt"), "resolved\n", "utf8");
  await git(source, ["add", "app.txt"]);
  assert.deepEqual(await inspectSessionSourceMergeState(source), { conflictedFiles: [], hasConflicts: false });
  assert.equal(await checks(), 3, "resolving the conflict rewrote the index");
});
