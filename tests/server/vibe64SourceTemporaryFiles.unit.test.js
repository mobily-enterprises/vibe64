import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeDerivedFiles } from "../../packages/vibe64-project/src/server/connectedAdapters/derivedFiles.js";
import { saveConnectedProjects } from "../../packages/vibe64-project/src/server/connectedProjects.js";
import { writeConnectionsLock } from "../../packages/vibe64-project/src/server/connectionsLock.js";
import {
  materializeProjectEnvironmentFiles,
  writeManagedGitExcludes
} from "../../packages/vibe64-project/src/server/projectEnvironmentFiles.js";

function git(root, ...args) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

async function runCommand({ command, args, cwd }) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout };
}

// Each writer Vibe64 runs inside a person's Git source, with the folder it writes in.
const writers = [
  [".env file", "", (root) => materializeProjectEnvironmentFiles({
    environment: { VALUE: "1" }, files: [{ format: "dotenv", path: ".env" }], sourceRoot: root
  })],
  ["connections file", "", (root) => saveConnectedProjects(root, {
    repositories: [{ name: "Library", repository: "https://github.com/example/library", relationship: "dependency" }]
  }, "")],
  ["connections lock", "", (root) => writeConnectionsLock(root, [{
    name: "Library", repository: "https://github.com/example/library", commit: "a".repeat(40), tree: "b".repeat(40)
  }])],
  ["connected-package file", "derived", (root) => writeDerivedFiles({
    connection: { name: "Library" },
    tree: root,
    files: { "derived/go.work": "go 1.22\n" },
    runCommand,
    writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: "connected test packages" })
  })]
];

for (const [name, folder, write] of writers) {
  test(`a temporary file a killed ${name} write leaves is never committed, and its next write removes it once stale`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-source-temporary-"));
    t.after(() => rm(root, { force: true, recursive: true }));
    assert.equal(git(root, "init", "-q").status, 0);
    const directory = path.join(root, folder);
    await mkdir(directory, { recursive: true });
    const stale = path.join(directory, ".vibe64-write-11111111-1111-4111-8111-111111111111.tmp");
    const live = path.join(directory, ".vibe64-write-22222222-2222-4222-8222-222222222222.tmp");
    for (const file of [stale, live]) await writeFile(file, "partial");
    const minutesAgo = new Date(Date.now() - 2 * 60_000);
    await utimes(stale, minutesAgo, minutesAgo);

    await write(root);

    const staged = git(root, "add", "-A", "--dry-run", "--", ".");
    assert.equal(staged.status, 0, staged.stderr);
    assert.doesNotMatch(staged.stdout, /\.vibe64-write-/u, staged.stdout);
    await assert.rejects(lstat(stale), { code: "ENOENT" });
    assert.ok(await lstat(live), "a temporary file a live write may still hold stays");
  });
}
