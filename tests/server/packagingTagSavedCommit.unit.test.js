import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { tagSavedCommit } from "../../packages/vibe64-packaging/src/server/tagSavedCommit.js";
import { runProjectSourceExclusive } from "../../packages/vibe64-project/src/server/projectSourceMutationLock.js";
import { runCaptureCommand } from "../../packages/vibe64-execution/src/server/engines/capture.js";

const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Tag Test", GIT_AUTHOR_EMAIL: "tag@example.test",
  GIT_COMMITTER_NAME: "Tag Test", GIT_COMMITTER_EMAIL: "tag@example.test" };
async function git(cwd, ...args) { return (await exec("git", args, { cwd, env })).stdout.trim(); }
const runCommand = (request) => runCaptureCommand(request.command, request.args, {
  cwd: request.cwd, env: { ...env, ...(request.env || {}) }, input: request.input,
  timeout: 10_000, maxBuffer: 2 * 1024 * 1024
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-release-tag-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const remote = path.join(root, "upstream.git");
  const source = path.join(root, "project");
  await git(root, "init", "--bare", "--initial-branch=main", remote);
  await git(root, "clone", remote, source);
  async function commit(file, value, { push = true } = {}) {
    await writeFile(path.join(source, file), value);
    await git(source, "add", file);
    await git(source, "commit", "-m", file);
    if (push) await git(source, "push", "origin", "main");
    return git(source, "rev-parse", "HEAD");
  }
  const saved = await commit("package.json", "{\"version\":\"1.5.0\"}\n");
  await git(source, "branch", "--set-upstream-to=origin/main");
  const locks = [];
  const runtimeRoot = path.join(root, "runtime");
  const options = {
    runCommand,
    runExclusive: (projectRuntimeRoot, operation) => {
      locks.push(projectRuntimeRoot);
      return runProjectSourceExclusive(projectRuntimeRoot, operation);
    }
  };
  const tag = (input = {}, overrides = {}) => tagSavedCommit({
    repositoryRoot: source,
    projectRuntimeRoot: runtimeRoot,
    baselineRef: "refs/heads/main",
    upstreamRef: "refs/remotes/origin/main",
    expectedCommit: saved,
    tags: ["v1.5.0"],
    ...input
  }, { ...options, ...overrides });
  const tagCommit = (name) => git(source, "rev-parse", "--verify", "--quiet", `refs/tags/${name}^{commit}`).catch(() => "");
  return { root, remote, source, saved, commit, tag, tagCommit, locks, runtimeRoot };
}

test("tags the saved, pushed commit under the project source lock, and re-running is idempotent", async (t) => {
  const f = await fixture(t);
  const result = await f.tag({ tags: ["app@1.5.0", "sdk@0.9.0"] });
  assert.deepEqual(result, { commit: f.saved, created: ["app@1.5.0", "sdk@0.9.0"], existing: [] });
  assert.equal(await f.tagCommit("app@1.5.0"), f.saved);
  assert.equal(await f.tagCommit("sdk@0.9.0"), f.saved);
  assert.deepEqual(f.locks, [f.runtimeRoot]);

  const again = await f.tag({ tags: ["app@1.5.0", "sdk@0.9.0"] });
  assert.deepEqual(again, { commit: f.saved, created: [], existing: ["app@1.5.0", "sdk@0.9.0"] });
  assert.equal(await git(f.source, "rev-parse", "HEAD"), f.saved, "Release never commits");
});

test("refuses a baseline that moved since the plan, and a tag on another commit", async (t) => {
  const f = await fixture(t);
  const newer = await f.commit("CHANGELOG.md", "## 1.5.1\n");
  await assert.rejects(f.tag(), (error) => error.code === "VIBE64_PUBLISH_BASELINE_MOVED" && error.details.actual === newer);
  assert.equal(await f.tagCommit("v1.5.0"), "");

  await git(f.source, "tag", "v1.5.1", f.saved);
  await assert.rejects(
    f.tag({ expectedCommit: newer, tags: ["v1.5.1"] }),
    (error) => error.code === "VIBE64_PUBLISH_TAG_CONFLICT" && error.details.commit === f.saved
  );
});

test("the tag transaction itself refuses a baseline that moves after the checks", async (t) => {
  const f = await fixture(t);
  const racing = async (request) => {
    if (request.args[0] === "update-ref") await f.commit("race.txt", "moved\n");
    return runCommand(request);
  };
  await assert.rejects(f.tag({}, { runCommand: racing }), (error) => error.code === "VIBE64_PUBLISH_TAG_FAILED");
  assert.equal(await f.tagCommit("v1.5.0"), "", "no tag is created when the compare-and-swap fails");
});

test("refuses unsaved and unpushed work", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.source, "draft.txt"), "not saved");
  await assert.rejects(f.tag(), (error) => error.code === "VIBE64_PUBLISH_UNSAVED_WORK");
  await rm(path.join(f.source, "draft.txt"));

  const local = await f.commit("local.txt", "not pushed\n", { push: false });
  await assert.rejects(f.tag({ expectedCommit: local }), (error) => error.code === "VIBE64_PUBLISH_UNPUSHED");
  assert.equal(await f.tagCommit("v1.5.0"), "");
});

test("tags a canonical bare repository, where the baseline is its own upstream", async (t) => {
  const f = await fixture(t);
  const result = await f.tag({ repositoryRoot: f.remote, upstreamRef: "refs/heads/main" });
  assert.deepEqual(result.created, ["v1.5.0"]);
  assert.equal(await git(f.root, "--git-dir", f.remote, "rev-parse", "refs/tags/v1.5.0^{commit}"), f.saved);
});

test("refuses malformed release tags and inputs before touching Git", async (t) => {
  const f = await fixture(t);
  const never = async () => assert.fail("Git must not run");
  for (const tags of [[], ["1.5.0"], ["v1.5"], ["App@1.5.0"], ["v1.5.0", "v1.5.0"], ["v1.5.0;rm"]]) {
    await assert.rejects(f.tag({ tags }, { runCommand: never }), (error) => error.code === "VIBE64_PUBLISH_TAG_INVALID", JSON.stringify(tags));
  }
  await assert.rejects(f.tag({ expectedCommit: "abc" }, { runCommand: never }), (error) => error.code === "VIBE64_PUBLISH_TAG_INVALID");
  await assert.rejects(f.tag({ repositoryRoot: "relative" }, { runCommand: never }), (error) => error.code === "VIBE64_PUBLISH_TAG_INVALID");
});
