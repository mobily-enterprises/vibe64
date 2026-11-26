import assert from "node:assert/strict";
import fsPromises, { mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectDirectoryChain } from "../../packages/vibe64-training/src/server/learnerRecords.js";

// The lstat and realpath calls the learner records make while `operation` runs.
async function pathChecks(t, operation) {
  let count = 0;
  for (const name of ["lstat", "realpath"]) {
    const original = fsPromises[name];
    t.mock.method(fsPromises, name, (...args) => {
      count += 1;
      return original(...args);
    });
  }
  syncBuiltinESMExports();
  try {
    const result = await operation();
    return { count, result };
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
}

test("a learner folder chain checked once is checked again with one lstat, however deep it is, and a replaced part is checked whole", async (t) => {
  const root = await fsPromises.realpath(await mkdtemp(path.join(os.tmpdir(), "vibe64-learner-chain-")));
  try {
    const repeatChecks = async (depth) => {
      const directory = path.join(root, `depth-${depth}`, ...Array.from({ length: depth }, (_value, index) => `part-${index}`));
      await mkdir(directory, { recursive: true });
      const first = await pathChecks(t, () => inspectDirectoryChain(directory));
      assert.ok(first.result.isDirectory());
      const again = await pathChecks(t, () => inspectDirectoryChain(directory));
      assert.equal(again.result.ino, first.result.ino);
      return { again: again.count, directory, first: first.count };
    };
    const shallow = await repeatChecks(3);
    const deep = await repeatChecks(20);
    assert.ok(deep.first > shallow.first, "the first check walks every part");
    assert.deepEqual([shallow.again, deep.again], [1, 1]);

    // The last folder replaced by another: one lstat finds a different folder, then the whole chain is walked.
    await rename(deep.directory, `${deep.directory}-old`);
    await mkdir(deep.directory);
    const replaced = await pathChecks(t, () => inspectDirectoryChain(deep.directory));
    assert.equal(replaced.count, deep.first + 1);

    // A part of the chain replaced by a symlink to another folder: the path leads elsewhere and the walk refuses it.
    await mkdir(path.join(root, "elsewhere", "part-1", "part-2"), { recursive: true });
    await rename(path.join(root, "depth-3", "part-0", "part-1"), path.join(root, "moved-part-1"));
    await symlink(path.join(root, "elsewhere", "part-1"), path.join(root, "depth-3", "part-0", "part-1"));
    await assert.rejects(inspectDirectoryChain(shallow.directory), /canonical regular paths/u);

    // A folder no longer there is reported missing, as before.
    await rm(deep.directory, { recursive: true });
    assert.equal(await inspectDirectoryChain(deep.directory), null);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
