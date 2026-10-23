// The Release dialog pushes the saved work when the plan needs it on the remote:
// the saved commit goes to the upstream branch, fast-forward only, and the
// baseline then reads as pushed. A diverged remote is never overwritten.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProjectRepository } from "../../packages/vibe64-publishing/src/server/projectRepository.js";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=Ada", "-c", "user.email=ada@example.invalid", "-c", "commit.gpgSign=false", ...args], { stdio: "pipe" }).toString().trim();

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), "vibe64-publishing-push-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const remote = path.join(base, "remote.git");
  const root = path.join(base, "project");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  await writeFile(path.join(root, "README.md"), "one\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "One");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "-u", "origin", "main");
  const repository = createProjectRepository({
    readProject: async () => ({ repositoryMode: "local_source", sourceRoot: root, repository: { defaultBranch: "main" } })
  });
  return { base, remote, root, repository };
}

test("pushing the saved work fast-forwards the upstream branch and reads as pushed", async (t) => {
  const { remote, root, repository } = await fixture(t);
  await writeFile(path.join(root, "README.md"), "two\n");
  git(root, "commit", "-qam", "Two");
  const before = await repository.baseline();
  assert.equal(before.pushed, false);
  const result = await repository.pushSaved(before);
  assert.deepEqual(result, { pushed: true, remote: "origin", branch: "main" });
  assert.equal(git(remote, "rev-parse", "main"), before.commit);
  const after = await repository.baseline();
  assert.equal(after.pushed, true);
  assert.deepEqual(await repository.pushSaved(after), { pushed: false }, "nothing to push twice");
});

test("a remote that moved on is never overwritten", async (t) => {
  const { base, root, remote, repository } = await fixture(t);
  const other = path.join(base, "other");
  execFileSync("git", ["clone", "-q", remote, other]);
  await writeFile(path.join(other, "README.md"), "theirs\n");
  git(other, "commit", "-qam", "Theirs");
  git(other, "push", "-q", "origin", "main");
  await writeFile(path.join(root, "README.md"), "mine\n");
  git(root, "commit", "-qam", "Mine");
  const theirs = git(remote, "rev-parse", "main");
  await assert.rejects(repository.pushSaved(await repository.baseline()), { code: "vibe64_publishing_git_failed" });
  assert.equal(git(remote, "rev-parse", "main"), theirs);
  assert.equal((await repository.baseline()).pushed, false);
});
