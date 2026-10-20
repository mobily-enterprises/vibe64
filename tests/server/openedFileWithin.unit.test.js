import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openedFileWithin } from "../../packages/vibe64-terminals/src/server/openedFileWithin.js";

function inside(root) {
  return (candidate) => candidate.startsWith(`${root}${path.sep}`);
}

async function withFiles(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-opened-file-"));
  try {
    const source = path.join(root, "source");
    const outside = path.join(root, "outside");
    await mkdir(source);
    await mkdir(outside);
    await writeFile(path.join(source, "result.txt"), "inside");
    await writeFile(path.join(outside, "secret.txt"), "outside");
    await run({ outside, source });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const platform of ["linux", "darwin"]) {
  test(`${platform}: an opened file inside the root is accepted`, async (t) => {
    if (platform === "linux" && process.platform !== "linux") t.skip("needs /proc");
    await withFiles(async ({ source }) => {
      const filePath = path.join(source, "result.txt");
      const handle = await open(filePath, "r");
      try {
        assert.equal(await openedFileWithin(handle, filePath, inside(source), { platform }), true);
      } finally {
        await handle.close();
      }
    });
  });

  test(`${platform}: a path whose directory resolves outside the root is refused`, async (t) => {
    if (platform === "linux" && process.platform !== "linux") t.skip("needs /proc");
    await withFiles(async ({ outside, source }) => {
      await symlink(outside, path.join(source, "linked"));
      const filePath = path.join(source, "linked", "secret.txt");
      const handle = await open(filePath, "r");
      try {
        assert.equal(await openedFileWithin(handle, filePath, inside(source), { platform }), false);
      } finally {
        await handle.close();
      }
    });
  });
}

test("darwin: a file swapped after opening is refused", async () => {
  await withFiles(async ({ outside, source }) => {
    const filePath = path.join(source, "result.txt");
    const handle = await open(path.join(outside, "secret.txt"), "r");
    try {
      // The handle is an outside file while the path names an inside file.
      assert.equal(await openedFileWithin(handle, filePath, inside(source), { platform: "darwin" }), false);
      await rename(filePath, `${filePath}.gone`);
      assert.equal(await openedFileWithin(handle, filePath, inside(source), { platform: "darwin" }), false);
    } finally {
      await handle.close();
    }
  });
});
