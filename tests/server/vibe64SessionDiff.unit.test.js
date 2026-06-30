import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  inspectSessionDiff
} from "../../packages/vibe64-sessions/src/server/sessionDiff.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args = []) {
  return execFileAsync("git", args, {
    cwd
  });
}

test("session diff review omits binary patch bodies", async () => {
  const sessionRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-diff-"));
  const sourceRoot = path.join(sessionRoot, "source");
  await mkdir(sourceRoot);
  await git(sourceRoot, ["init"]);
  await git(sourceRoot, ["config", "user.email", "test@example.com"]);
  await git(sourceRoot, ["config", "user.name", "Test User"]);
  await writeFile(path.join(sourceRoot, "image.bin"), Buffer.from([0, 1, 2, 3, 4, 255]));
  await git(sourceRoot, ["add", "image.bin"]);
  await git(sourceRoot, ["commit", "-m", "baseline"]);

  await writeFile(path.join(sourceRoot, "image.bin"), Buffer.from([0, 1, 88, 89, 90, 255]));

  const result = await inspectSessionDiff({
    completedSteps: ["source_created"],
    sessionRoot
  });

  assert.equal(result.ok, true);
  assert.match(result.unstagedDiff, /Binary files/u);
  assert.doesNotMatch(result.unstagedDiff, /GIT binary patch/u);
});
