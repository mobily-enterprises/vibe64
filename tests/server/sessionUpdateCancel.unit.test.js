import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runCaptureCommand } from "../../packages/vibe64-execution/src/server/engines/capture.js";
import { regenerateDerivedArtifactTree, repositoryContext } from "../../packages/vibe64-terminals/src/server/sessionWorkGit.js";
import { updateSessionWork } from "../../packages/vibe64-terminals/src/server/sessionWorkUpdate.js";

const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Cancel Test", GIT_AUTHOR_EMAIL: "cancel@example.test",
  GIT_COMMITTER_NAME: "Cancel Test", GIT_COMMITTER_EMAIL: "cancel@example.test" };
const STOPPED_PREFIX = ".vibe64-derived-worktree-";

async function git(cwd, ...args) {
  return (await exec("git", args, { cwd, env })).stdout.trim();
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(read) {
  for (let i = 0; i < 1000; i += 1) {
    const value = await read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("The condition never held.");
}

/**
 * A local project whose saved version moved on after a session started and changed a file of its own, so its
 * Update fetches, merges and applies. Commands find `git` on a PATH whose stand-in hangs on the subcommand
 * named in `hang.on`, writing its pid to `hang.pidFile`, and runs real Git otherwise.
 */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-cancel-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const remote = path.join(root, "upstream.git");
  const source = path.join(root, "project");
  await git(root, "init", "--bare", "--initial-branch=trunk", remote);
  await git(root, "clone", remote, source);
  await writeFile(path.join(source, "base.txt"), "base\n");
  await git(source, "add", ".");
  await git(source, "commit", "-m", "base");
  await git(source, "push", "-u", "origin", "trunk");
  const sourcePath = path.join(root, "sessions", "one", "source");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await git(root, "clone", source, sourcePath);
  await git(sourcePath, "checkout", "-b", "vibe64/session");
  const baseCommit = await git(sourcePath, "rev-parse", "HEAD");
  await writeFile(path.join(sourcePath, "session.txt"), "session work\n");
  await writeFile(path.join(source, "saved.txt"), "saved later\n");
  await git(source, "add", "saved.txt");
  await git(source, "commit", "-m", "saved later");

  const shimDir = path.join(root, "bin");
  await mkdir(shimDir);
  await writeFile(path.join(shimDir, "git"), [
    "#!/bin/sh",
    "for argument in \"$@\"; do",
    "  if [ -n \"$HANG_ON\" ] && [ \"$argument\" = \"$HANG_ON\" ]; then echo $$ > \"$HANG_PID_FILE\"; exec sleep 600; fi",
    "done",
    "exec \"$REAL_GIT\" \"$@\"",
    ""
  ].join("\n"));
  await chmod(path.join(shimDir, "git"), 0o755);
  const realGit = (await exec("sh", ["-c", "command -v git"], { env })).stdout.trim();
  const hang = { on: "", pidFile: path.join(root, "hang.pid") };
  const runCommand = request => runCaptureCommand(request.command, request.args, {
    cwd: request.cwd,
    env: { ...env, HANG_ON: hang.on, HANG_PID_FILE: hang.pidFile, PATH: `${shimDir}:${env.PATH}`, REAL_GIT: realGit,
      ...(request.env || {}) },
    input: request.input,
    maxBuffer: 2 * 1024 * 1024,
    signal: request.signal,
    timeout: 60_000
  });
  const project = { sourceRoot: source, projectRuntimeRoot: path.join(root, "runtime"),
    repositoryMode: "local_source", repository: { mode: "local_source", defaultBranch: "trunk" }, slug: "test" };
  const session = { sessionId: "one", sourcePath, metadata: { base_branch: "trunk", base_commit: baseCommit, source_path: sourcePath } };
  const state = async () => ({
    head: await git(sourcePath, "rev-parse", "HEAD"),
    status: await git(sourcePath, "status", "--porcelain"),
    work: await readFile(path.join(sourcePath, "session.txt"), "utf8")
  });
  return { hang, input: { project, runCommand, session }, project, runCommand, session, sourcePath, state };
}

test("Cancel stops the Git command an Update stage is running, leaves the session as it was, and the next Update applies", async (t) => {
  const f = await fixture(t);
  const before = await f.state();
  f.hang.on = "merge-tree";
  const cancel = new AbortController();
  const updating = updateSessionWork({ ...f.input, signal: cancel.signal });
  const pid = Number(await waitFor(() => readFile(f.hang.pidFile, "utf8").catch(() => "")));
  assert.equal(alive(pid), true);
  cancel.abort();
  await assert.rejects(updating, { code: "vibe64_session_update_cancelled", message: "Update was cancelled before it changed this session." });
  assert.equal(alive(pid), false, "the stage's own Git command, in its own process group, was stopped with the stage");
  assert.deepEqual(await f.state(), before);

  f.hang.on = "";
  const updated = await updateSessionWork(f.input);
  assert.equal(updated.status, "updated");
  assert.equal(await readFile(path.join(f.sourcePath, "saved.txt"), "utf8"), "saved later\n");
  assert.equal(await readFile(path.join(f.sourcePath, "session.txt"), "utf8"), "session work\n");
});

test("a Cancel before Update's first stage runs nothing, and one once Update applies its result lets it finish", async (t) => {
  const f = await fixture(t);
  const before = await f.state();
  const commands = [];
  const early = new AbortController();
  await assert.rejects(updateSessionWork({
    ...f.input,
    runCommand: request => {
      commands.push(request.args);
      return f.runCommand(request);
    },
    async runProjectSourceExclusive(operation) {
      early.abort();
      return operation();
    },
    signal: early.signal
  }), { code: "vibe64_session_update_cancelled" });
  assert.deepEqual(commands, []);
  assert.deepEqual(await f.state(), before);

  const late = new AbortController();
  const updated = await updateSessionWork({
    ...f.input,
    onProgress({ stage }) {
      if (stage === "mutating") late.abort();
    },
    signal: late.signal
  });
  assert.equal(updated.status, "updated", "changing the session's files is never stopped part way");
  assert.equal(await readFile(path.join(f.sourcePath, "saved.txt"), "utf8"), "saved later\n");
});

test("a regeneration stopped part way leaves its temporary checkout, and the next one removes it first", async (t) => {
  const f = await fixture(t);
  const parent = path.dirname(f.sourcePath);
  const stopped = path.join(parent, `${STOPPED_PREFIX}stopped`, "source");
  await mkdir(path.dirname(stopped), { recursive: true });
  await git(f.sourcePath, "worktree", "add", "--detach", stopped, "HEAD");
  const head = await git(f.sourcePath, "rev-parse", "HEAD");
  const seen = [];
  const tree = await regenerateDerivedArtifactTree(f.runCommand, repositoryContext(f.session, f.project), {
    baseCommit: head,
    commandOptions: {},
    derivedArtifactPaths: ["diagram.txt"],
    project: f.project,
    async refreshDerivedArtifacts({ projectRoot }) {
      seen.push(...(await readdir(parent)).filter(name => name.startsWith(STOPPED_PREFIX) && !projectRoot.includes(name)));
      await writeFile(path.join(projectRoot, "diagram.txt"), "regenerated\n");
    },
    tree: await git(f.sourcePath, "rev-parse", "HEAD^{tree}")
  });
  assert.deepEqual(seen, [], "the stopped checkout was gone before the new regeneration ran");
  assert.equal(await git(f.sourcePath, "show", `${tree}:diagram.txt`), "regenerated");
  assert.deepEqual((await readdir(parent)).filter(name => name.startsWith(STOPPED_PREFIX)), []);
  assert.doesNotMatch(await git(f.sourcePath, "worktree", "list", "--porcelain"), new RegExp(STOPPED_PREFIX), "Git forgot its worktree");
});
