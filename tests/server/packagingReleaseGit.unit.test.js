// Release Git (tags, exports, baseline reads, clones and pushes) and the Python
// publishing tools run through Vibe64's command gateway, never a bare process
// with the server's whole environment.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { releaseGit } from "../../packages/vibe64-packaging/src/server/git.js";
import { createPublishingService } from "../../packages/vibe64-publishing/src/server/service.js";

const ROOT = path.join(os.tmpdir(), "vibe64-release-git-project");

test("release Git runs as the daemon with the project policy and the repository marked safe", async () => {
  const requests = [];
  const ok = async (request) => { requests.push(request); return { ok: true, stdout: " abc \n" }; };
  assert.equal(await releaseGit(ROOT, ["rev-parse", "HEAD"], { runCommand: ok, env: { GIT_INDEX_FILE: "/tmp/index" }, stdin: "start\n" }), "abc");
  assert.deepEqual(
    (({ actor, command, args, cwd, allowedRoots, envPolicy, gitSafeDirectories, mode, purpose, env, input }) => ({ actor, command, args, cwd, allowedRoots, envPolicy, gitSafeDirectories, mode, purpose, env, input }))(requests[0]),
    { actor: "daemon", command: "git", args: ["rev-parse", "HEAD"], cwd: ROOT, allowedRoots: [ROOT], envPolicy: "project", gitSafeDirectories: [ROOT], mode: "capture", purpose: "source", env: { GIT_INDEX_FILE: "/tmp/index" }, input: "start\n" }
  );

  const refused = async () => ({ ok: false, stderr: "fatal: unable to access 'https://ada:secret@github.com/ada/notes.git/'" });
  assert.equal(await releaseGit(ROOT, ["rev-parse", "missing"], { runCommand: refused, optional: true }), null);
  await assert.rejects(releaseGit(ROOT, ["push"], { runCommand: refused, code: "VIBE64_PUBLISH_TAG_FAILED" }), (error) =>
    error.code === "VIBE64_PUBLISH_TAG_FAILED" && /\[credentials\]@github\.com/u.test(error.message) && !/secret/u.test(error.message));
  const missing = async () => ({ ok: false, error: "spawn git ENOENT" });
  await assert.rejects(releaseGit(ROOT, ["status"], { runCommand: missing, optional: true }), { code: "vibe64_git_missing" }, "a missing Git is said, even for an optional read");
});

test("no release module starts Git or Python outside the gateway", async () => {
  for (const file of [
    "packages/vibe64-packaging/src/server/release/exportCommit.js",
    "packages/vibe64-packaging/src/server/tagSavedCommit.js",
    "packages/vibe64-publishing/src/server/projectRepository.js",
    "packages/vibe64-publishing/src/server/service.js"
  ]) {
    assert.doesNotMatch(await readFile(path.join(import.meta.dirname, "../..", file), "utf8"), /node:child_process/u, file);
  }
});

test("the Python publishing tools install through the gateway", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vibe64-python-tools-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const roots = { personalRoot: path.join(base, "personal"), toolchainsRoot: path.join(base, "toolchains"), cacheRoot: path.join(base, "cache") };
  const requests = [];
  const publishing = createPublishingService({
    project: { readCurrentProject: async () => ({}) },
    roots,
    runCommand: async (request) => { requests.push(request); return { ok: true, stdout: "" }; }
  });
  const result = await publishing.installPythonTools();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(requests.map(({ actor, command, args, cwd, runtimes }) => [actor, path.basename(command), args.slice(0, 3), cwd, runtimes]), [
    ["daemon", "python3", ["-m", "venv", path.join(roots.toolchainsRoot, "python-publish")], roots.toolchainsRoot, ["python"]],
    ["daemon", "python", ["-m", "pip", "install"], roots.toolchainsRoot, ["python"]]
  ]);
  assert.ok(requests[1].args.includes("twine==6.1.0"));
});
