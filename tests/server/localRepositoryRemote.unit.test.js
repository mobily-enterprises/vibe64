import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { localRepositoryRemote } from "../../packages/vibe64-project/src/server/localRepositoryRemote.js";
import { checkSessionUpdatesDirect, updateSessionWork, saveSessionWorkDirect } from "../../packages/vibe64-terminals/src/server/sessionWorkSave.js";
import { runCaptureCommand } from "../../packages/vibe64-execution/src/server/engines/capture.js";

const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Remote Test", GIT_AUTHOR_EMAIL: "remote@example.test",
  GIT_COMMITTER_NAME: "Remote Test", GIT_COMMITTER_EMAIL: "remote@example.test" };
async function git(cwd, ...args) { return (await exec("git", args, { cwd, env })).stdout.trim(); }
const runCommand = (request) => runCaptureCommand(request.command, request.args, {
  cwd: request.cwd, env: { ...env, ...(request.env || {}) }, input: request.input,
  timeout: 10_000, maxBuffer: 2 * 1024 * 1024
});
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-remote-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const remote = path.join(root, "upstream.git");
  const source = path.join(root, "project");
  const peer = path.join(root, "peer");
  await git(root, "init", "--bare", "--initial-branch=trunk", remote);
  await git(root, "clone", remote, source);
  await writeFile(path.join(source, "base.txt"), "base\n");
  await git(source, "add", "."); await git(source, "commit", "-m", "base");
  await git(source, "push", "-u", "origin", "trunk");
  await git(source, "remote", "rename", "origin", "company");
  await git(root, "clone", remote, peer);
  const project = { sourceRoot: source, projectRuntimeRoot: path.join(root, "runtime"),
    repositoryMode: "local_source", repository: { mode: "local_source", defaultBranch: "trunk" }, slug: "test" };
  const events = [];
  const options = { runCommand, logger: { info: (event) => events.push(event), warn: (event) => events.push(event) } };
  const call = (input = {}) => localRepositoryRemote(project, input, options);
  async function commit(cwd, file, value) {
    await writeFile(path.join(cwd, file), value);
    await git(cwd, "add", file); await git(cwd, "commit", "-m", file);
    return git(cwd, "rev-parse", "HEAD");
  }
  return { root, remote, source, peer, project, events, options, call, commit };
}

test("uses the original folder's upstream, fetches without moving files, and pulls with a reviewed destination", async (t) => {
  const f = await fixture(t);
  const before = await git(f.source, "rev-parse", "HEAD");
  await f.commit(f.peer, "incoming.txt", "remote\n"); await git(f.peer, "push");
  const state = await f.call({ action: "fetch" });
  assert.equal(state.branch, "trunk"); assert.equal(state.upstream.remote, "company");
  assert.equal(state.push.branch, "trunk"); assert.equal(state.incoming, 1);
  assert.equal(await git(f.source, "rev-parse", "HEAD"), before);
  await assert.rejects(readFile(path.join(f.source, "incoming.txt")), { code: "ENOENT" });
  const pulled = await f.call({ action: "pull", review: state.review });
  assert.equal(pulled.incoming, 0); assert.equal(await readFile(path.join(f.source, "incoming.txt"), "utf8"), "remote\n");
  assert.ok(f.events.some((event) => event.event === "vibe64.remote.completed"));
});

test("pushes local saves and honors a fork, custom branch mapping and separate push URL", async (t) => {
  const f = await fixture(t);
  const fork = path.join(f.root, "fork.git");
  await git(f.root, "init", "--bare", fork);
  await git(f.source, "remote", "add", "fork", f.remote);
  await git(f.source, "remote", "set-url", "--push", "fork", fork);
  let state = await f.call();
  state = await f.call({ action: "configure", review: state.review,
    settings: { remote: "company", branch: "trunk", pushRemote: "fork", pushBranch: "feature/demo" } });
  assert.equal(state.push.branch, "feature/demo");
  assert.equal(await git(f.source, "config", "branch.trunk.remote"), "company");
  await f.commit(f.source, "local.txt", "local\n");
  state = await f.call({ action: "fetch" });
  assert.equal(state.outgoing, 2); assert.equal(state.incoming, 0);
  const original = await git(f.peer, "rev-parse", "HEAD");
  await f.call({ action: "push", review: state.review });
  assert.equal(await git(f.root, "--git-dir", fork, "rev-parse", "refs/heads/feature/demo"), state.head);
  assert.equal(await git(f.root, "--git-dir", f.remote, "rev-parse", "refs/heads/trunk"), original);
});

test("stale reviews, dirty folders, divergent pushes and merge conflicts preserve work", async (t) => {
  const f = await fixture(t);
  let state = await f.call({ action: "fetch" });
  await f.commit(f.peer, "base.txt", "theirs\n"); await git(f.peer, "push");
  await assert.rejects(f.call({ action: "pull", review: state.review }), { code: "vibe64_remote_review_changed" });
  state = await f.call({ action: "fetch" });
  await writeFile(path.join(f.source, "dirty.txt"), "keep\n");
  await assert.rejects(f.call({ action: "pull", review: state.review }), { code: "vibe64_remote_dirty" });
  await rm(path.join(f.source, "dirty.txt"));
  await f.commit(f.source, "base.txt", "ours\n"); state = await f.call({ action: "fetch" });
  await assert.rejects(f.call({ action: "push", review: state.review }), { code: "vibe64_remote_push_rejected" });
  await assert.rejects(f.call({ action: "pull", review: state.review }), { code: "vibe64_remote_merge_required" });
  await assert.rejects(f.call({ action: "pull", review: state.review, merge: true }), { code: "vibe64_remote_merge_conflict" });
  assert.equal(await readFile(path.join(f.source, "base.txt"), "utf8"), "ours\n");
  assert.equal(await git(f.source, "status", "--porcelain"), "");
});

test("explicit non-conflicting merge keeps local history and permits a normal push", async (t) => {
  const f = await fixture(t);
  const local = await f.commit(f.source, "local.txt", "ours\n");
  await f.commit(f.peer, "remote.txt", "theirs\n"); await git(f.peer, "push");
  const state = await f.call({ action: "fetch" });
  const merged = await f.call({ action: "pull", review: state.review, merge: true });
  await git(f.source, "merge-base", "--is-ancestor", local, merged.head);
  assert.equal((await git(f.source, "show", "-s", "--format=%P", "HEAD")).split(" ").length, 2);
  await f.call({ action: "push", review: merged.review });
});

test("terminal configuration changes invalidate review; offline failures do not become current", async (t) => {
  const f = await fixture(t);
  const state = await f.call({ action: "fetch" });
  await git(f.source, "remote", "set-url", "company", path.join(f.root, "missing.git"));
  await assert.rejects(f.call({ action: "push", review: state.review }), { code: "vibe64_remote_review_changed" });
  const failed = await f.call({ action: "fetch" });
  assert.ok(failed.error); assert.equal(failed.incoming, null); assert.equal(failed.outgoing, null);
  await git(f.source, "checkout", "--detach");
  assert.equal((await f.call()).branch, "");
});

test("hosted GitHub and managed repositories never invoke standalone Git controls", async () => {
  for (const mode of ["github", "managed_git"]) {
    const project = { repositoryMode: mode, sourceRoot: "/must-not-run" };
    const options = { runCommand: () => { throw new Error("Unexpected Git execution"); } };
    assert.deepEqual(await localRepositoryRemote(project, {}, options), { ok: true, supported: false });
    for (const action of ["fetch", "pull", "push", "configure"]) {
      await assert.rejects(localRepositoryRemote(project, { action }, options), { code: "vibe64_remote_local_only" });
    }
  }
});

test("terminal rebase: review replays only session changes, preserves session work, then Save and Push work", async (t) => {
  const f = await fixture(t);
  const oldBase = await f.commit(f.source, "local.txt", "saved locally\n");
  const sourcePath = path.join(f.root, "session");
  await git(f.root, "clone", f.source, sourcePath); await git(sourcePath, "checkout", "-b", "vibe64/session");
  const session = { sessionId: "session", sourcePath, metadata: { source_path: sourcePath,
    branch: "vibe64/session", base_branch: "trunk", base_commit: oldBase } };
  await writeFile(path.join(sourcePath, "session.txt"), "ongoing session work\n");
  await f.commit(f.peer, "remote.txt", "upstream\n"); await git(f.peer, "push");
  await git(f.source, "pull", "--rebase");
  const input = { project: f.project, session, runCommand };
  const check = await checkSessionUpdatesDirect(input);
  assert.ok(check.historyReview); assert.deepEqual(check.historyReview.changedPaths, ["session.txt"]);
  await assert.rejects(updateSessionWork(input), { code: "vibe64_session_history_review_required" });
  const updated = await updateSessionWork({ ...input, historyReview: check.historyReview });
  assert.equal(updated.reconciled, true);
  assert.equal(await readFile(path.join(sourcePath, "session.txt"), "utf8"), "ongoing session work\n");
  assert.equal(await readFile(path.join(sourcePath, "remote.txt"), "utf8"), "upstream\n");
  session.metadata.base_commit = updated.canonicalCommit;
  session.metadata.canonical_commit = updated.canonicalCommit;
  const saved = await saveSessionWorkDirect({ ...input, message: "Save preserved session work" });
  assert.equal(saved.reconciled, true);
  const state = await f.call({ action: "fetch" });
  await f.call({ action: "push", review: state.review });
  assert.equal(await git(f.root, "--git-dir", f.remote, "show", "trunk:session.txt"), "ongoing session work");
});

test("history recovery refuses changed reviews and leaves hosted history-rewrite behavior unchanged", async (t) => {
  const f = await fixture(t);
  const oldBase = await f.commit(f.source, "local.txt", "saved\n");
  const sourcePath = path.join(f.root, "session");
  await git(f.root, "clone", f.source, sourcePath); await git(sourcePath, "checkout", "-b", "vibe64/session");
  const session = { sessionId: "session", sourcePath, metadata: { branch: "vibe64/session", base_branch: "trunk", base_commit: oldBase } };
  await git(f.source, "reset", "--hard", "HEAD~1");
  const input = { project: f.project, session, runCommand };
  const check = await checkSessionUpdatesDirect(input);
  await writeFile(path.join(sourcePath, "after-review.txt"), "new work\n");
  await assert.rejects(updateSessionWork({ ...input, historyReview: check.historyReview }), { code: "vibe64_session_history_review_required" });
  assert.equal(await git(sourcePath, "rev-parse", "HEAD"), oldBase);
  const project = { ...f.project, repositoryMode: "github", repository: { defaultBranch: "trunk", mode: "github", github: { cloneUrl: f.remote } }, githubRepository: { cloneUrl: f.remote } };
  await assert.rejects(checkSessionUpdatesDirect({ ...input, project }), { code: "vibe64_session_update_history_diverged" });
});

test("unconfigured branches require an explicit upstream, and ambiguous Git settings are not guessed", async (t) => {
  const f = await fixture(t);
  await git(f.source, "branch", "--unset-upstream");
  let state = await f.call({ action: "fetch" });
  assert.equal(state.upstream, null);
  assert.equal(state.push, null);
  state = await f.call({ action: "configure", review: state.review,
    settings: { remote: "company", branch: "trunk", pushRemote: "company", pushBranch: "new-branch" } });
  state = await f.call({ action: "fetch" });
  assert.equal(state.outgoing, 1);
  await f.call({ action: "push", review: state.review });
  assert.equal(await git(f.root, "--git-dir", f.remote, "rev-parse", "new-branch"), state.head);
  await git(f.source, "config", "--add", "branch.trunk.merge", "refs/heads/another");
  assert.equal((await f.call()).upstream, null);
  await git(f.source, "remote", "set-url", "--add", "--push", "company", f.remote);
  await git(f.source, "remote", "set-url", "--add", "--push", "company", f.peer);
  assert.equal((await f.call()).push, null);
});

test("background refresh is throttled; manual fetch and failed refresh remain observable", async (t) => {
  const f = await fixture(t);
  const before = await f.call({ action: "fetch", background: true });
  await f.commit(f.peer, "later.txt", "later\n"); await git(f.peer, "push");
  const throttled = await f.call({ action: "fetch", background: true });
  assert.equal(throttled.checkedAt, before.checkedAt); assert.equal(throttled.incoming, 0);
  assert.equal((await f.call({ action: "fetch" })).incoming, 1);
  await rm(f.remote, { recursive: true });
  const failed = await f.call({ action: "fetch" });
  assert.ok(failed.checkedAt); assert.ok(failed.error); assert.equal(failed.incoming, null);
  assert.equal(f.events.at(-1).event, "vibe64.remote.failed");
});

test("reviewed history recovery uses the ordinary conflict repair and rejects a changed baseline", async (t) => {
  const f = await fixture(t);
  const oldBase = await f.commit(f.source, "local.txt", "old\n");
  const sourcePath = path.join(f.root, "session");
  await git(f.root, "clone", f.source, sourcePath); await git(sourcePath, "checkout", "-b", "vibe64/session");
  const session = { sessionId: "session", sourcePath, metadata: { branch: "vibe64/session", base_commit: oldBase } };
  await writeFile(path.join(sourcePath, "base.txt"), "session change\n");
  await git(f.source, "reset", "--hard", "HEAD~1");
  await f.commit(f.source, "base.txt", "new baseline\n");
  const input = { project: f.project, session, runCommand };
  const check = await checkSessionUpdatesDirect(input);
  let conflictRecovery;
  await assert.rejects(updateSessionWork({ ...input, historyReview: check.historyReview }), (error) => {
    assert.equal(error.code, "vibe64_session_update_conflict");
    conflictRecovery = error.details.conflictRecovery;
    return true;
  });
  assert.equal(await readFile(path.join(sourcePath, "base.txt"), "utf8"), "session change\n");
  assert.equal(await git(sourcePath, "rev-parse", "HEAD"), oldBase);
  await writeFile(path.join(sourcePath, "base.txt"), "resolved by user\n");
  const result = await updateSessionWork({ ...input, conflictRecovery, reviewedConflictId: conflictRecovery.reviewId });
  assert.equal(result.reconciled, true);
  assert.equal(await readFile(path.join(sourcePath, "base.txt"), "utf8"), "resolved by user\n");
  await assert.rejects(readFile(path.join(sourcePath, "local.txt")), { code: "ENOENT" });
  await f.commit(f.source, "more.txt", "changed baseline\n");
  await assert.rejects(updateSessionWork({ ...input, conflictRecovery, reviewedConflictId: conflictRecovery.reviewId }),
    { code: "vibe64_session_history_review_required" });
});

test("new local sessions refuse to follow a different project branch", async (t) => {
  const f = await fixture(t);
  const sourcePath = path.join(f.root, "session");
  await git(f.root, "clone", f.source, sourcePath); await git(sourcePath, "checkout", "-b", "vibe64/session");
  const session = { sessionId: "session", sourcePath, metadata: { branch: "vibe64/session",
    base_commit: await git(sourcePath, "rev-parse", "HEAD"), local_source_branch: "trunk" } };
  const project = { ...f.project, repository: { ...f.project.repository, defaultBranch: "different" } };
  await assert.rejects(checkSessionUpdatesDirect({ project, session, runCommand }), { code: "vibe64_session_local_branch_changed" });
});
