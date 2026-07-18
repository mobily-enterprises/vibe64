import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createCommittedGitSourceReader
} from "../../packages/vibe64-core/src/server/committedProjectConfig.js";

const execFileAsync = promisify(execFile);

test("committed Git source reader preserves binary files and exposes their blob IDs", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-committed-source-"));
  try {
    const coverPath = path.join(sourceRoot, ".vibe64", "launcher", "cover.webp");
    const cover = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff, 0x00, 0x80, 0x57, 0x45, 0x42, 0x50]);
    await mkdir(path.dirname(coverPath), {
      recursive: true
    });
    await writeFile(coverPath, cover);
    await runGit(sourceRoot, ["init", "--initial-branch=main"]);
    await runGit(sourceRoot, ["add", ".vibe64/launcher/cover.webp"]);
    await runGit(sourceRoot, [
      "-c",
      "user.name=Vibe64 Test",
      "-c",
      "user.email=vibe64@example.test",
      "commit",
      "-m",
      "Add launcher cover"
    ]);
    const commit = await gitOutput(sourceRoot, ["rev-parse", "HEAD"]);
    const expectedObjectId = await gitOutput(sourceRoot, ["rev-parse", "HEAD:.vibe64/launcher/cover.webp"]);

    const reader = await createCommittedGitSourceReader({
      committedConfig: {
        commit,
        sourceRoot
      }
    });

    assert.equal(reader.exists(".vibe64/launcher/cover.webp"), true);
    assert.equal(reader.objectId(".vibe64/launcher/cover.webp"), expectedObjectId);
    assert.deepEqual(await reader.readBuffer(".vibe64/launcher/cover.webp"), cover);
    await assert.rejects(
      () => reader.readBuffer(".vibe64/launcher/cover.webp", {
        maxBytes: cover.length - 1
      }),
      {
        code: "vibe64_committed_project_source_file_too_large"
      }
    );
    assert.equal(await reader.readBuffer(".vibe64/launcher/missing.webp"), null);
  } finally {
    await rm(sourceRoot, {
      force: true,
      recursive: true
    });
  }
});

async function runGit(cwd = "", args = []) {
  await execFileAsync("git", args, {
    cwd
  });
}

async function gitOutput(cwd = "", args = []) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8"
  });
  return String(result.stdout || "").trim();
}
