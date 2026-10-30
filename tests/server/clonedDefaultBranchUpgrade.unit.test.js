import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261030-cloned-default-branch.js";
import { removeSessionClonedDefaultBranches } from "../../packages/vibe64-terminals/src/server/clonedDefaultBranchUpgrade.js";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { managedSessionSourcePath, SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";

const exec = promisify(execFile);
const OUTCOME = "source_default_branch_local";

async function git(cwd, args) {
  return (await exec("git", args, { cwd, encoding: "utf8" })).stdout.trim();
}

function commit(cwd, message) {
  return git(cwd, ["-c", "user.name=Vibe64 Test", "-c", "user.email=vibe64@example.test",
    "commit", "--quiet", "--allow-empty", "-m", message]);
}

// Exit status 1 means no matching configuration.
function branchConfig(cwd, branch = "main") {
  return git(cwd, ["config", "--local", "--get-regexp", `^branch\\.${branch}\\.`]).catch((error) => {
    if (error.code === 1) return "";
    throw error;
  });
}

// Session checkouts live outside the state directory, where source_path says.
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-cloned-branch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const projectRuntimeRoot = path.join(systemRoot, "projects", "example");
  const sourcesRoot = path.join(root, "sources");
  const origin = path.join(root, "origin");
  await mkdir(origin, { recursive: true });
  await git(origin, ["init", "--quiet", "--initial-branch=main"]);
  await commit(origin, "initial");
  const base = await git(origin, ["rev-parse", "HEAD"]);
  const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
  const backupRoot = path.join(systemRoot, "upgrades", "backups", upgrade.id);
  const messages = [];

  // A session clone as source creation made it before it removed the copy.
  async function session(sessionId, { clone = true, metadata = {} } = {}) {
    await store.createSession({ runtimeKind: "genesis", sessionId });
    const sourcePath = managedSessionSourcePath(sourcesRoot, sessionId);
    if (clone) {
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await git(root, ["clone", "--quiet", "--single-branch", "--branch", "main", origin, sourcePath]);
      await git(sourcePath, ["checkout", "--quiet", "-B", `vibe64/${sessionId}`, base]);
    }
    const values = {
      base_commit: base,
      branch: `vibe64/${sessionId}`,
      canonical_commit: base,
      source_default_branch: "main",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      ...metadata
    };
    for (const [name, value] of Object.entries(values)) {
      if (value !== null) await store.writeMetadataValue(sessionId, name, value);
    }
    return sourcePath;
  }

  // Every state the proof distinguishes, plus sessions it must not touch.
  async function scenarios() {
    const s = {};
    s.stale = await session("stale");
    for (const message of ["second", "third", "fourth"]) await commit(origin, message);
    await git(s.stale, ["fetch", "--quiet", "origin"]);
    await commit(s.stale, "session work");
    s.onMain = await session("on-main");
    await git(s.onMain, ["checkout", "--quiet", "main"]);
    s.detached = await session("detached");
    await git(s.detached, ["checkout", "--quiet", "--detach", base]);
    s.other = await session("other");
    await git(s.other, ["checkout", "--quiet", "-B", "other", base]);
    s.unpublished = await session("unpublished");
    const localOnly = await git(s.unpublished, ["-c", "user.name=Vibe64 Test", "-c", "user.email=vibe64@example.test",
      "commit-tree", `${base}^{tree}`, "-p", base, "-m", "Local-only work"]);
    await git(s.unpublished, ["update-ref", "refs/heads/main", localOnly]);
    s.absent = await session("absent");
    await git(s.absent, ["branch", "--quiet", "-D", "main"]);
    // Git cannot open this checkout at all.
    s.broken = await session("broken");
    await rm(path.join(s.broken, ".git"), { recursive: true });
    await writeFile(path.join(s.broken, ".git"), `gitdir: ${path.join(root, "missing-git-dir")}\n`);
    s.recorded = await session("recorded", { metadata: { [OUTCOME]: "git_failed" } });
    s.pullRequest = await session("pull-request", { metadata: { github_pull_request: JSON.stringify({ number: 7 }) } });
    s.missing = await session("missing", { clone: false });
    await store.createSession({ runtimeKind: "genesis", sessionId: "sourceless" });
    return { s, localOnly };
  }

  const run = (apply, options = {}) => upgrade.run({
    apply,
    backupRoot,
    removeSessionClonedDefaultBranches: (context) => removeSessionClonedDefaultBranches({ ...context, ...options }),
    report: (level, message) => messages.push({ level, message }),
    systemRoot
  });
  return { backupRoot, base, messages, origin, root, run, scenarios, session, store, systemRoot };
}

async function snapshot(f, sources) {
  const result = {};
  for (const [name, sourcePath] of Object.entries(sources)) {
    const repository = name === "broken" || name === "missing" ? null : {
      config: await git(sourcePath, ["config", "--local", "--list"]),
      refs: await git(sourcePath, ["for-each-ref", "--format=%(refname) %(objectname)"])
    };
    result[name] = { repository };
  }
  for (const sessionId of ["stale", "on-main", "detached", "other", "unpublished", "absent", "broken", "recorded", "pull-request", "missing", "sourceless"]) {
    result[`metadata:${sessionId}`] = await f.store.readMetadata(sessionId);
  }
  return result;
}

const outcome = (f, sessionId) => f.store.readMetadataValue(sessionId, OUTCOME);
const missing = (file) => stat(file).then(() => false, (error) => error.code === "ENOENT");

test("check reports what each session would do and changes nothing", async (t) => {
  const f = await fixture(t);
  const { s } = await f.scenarios();
  const before = await snapshot(f, s);
  await f.run(false);
  assert.deepEqual(await snapshot(f, s), before);
  assert.equal(await missing(f.backupRoot), true);
  const reported = f.messages.map(({ message }) => message).join("\n");
  assert.match(reported, /example\/stale: would remove its local copy of main/u);
  assert.match(reported, /example\/unpublished: keeps its local copy of main \(kept_unpublished_commits\)/u);
  assert.match(reported, /example\/on-main: keeps its local copy of main \(kept_head_on_default\)/u);
  assert.match(reported, /example\/absent: has no local copy of main/u);
  assert.ok(f.messages.some(({ level, message }) => level === "warning" && message.startsWith("example/broken: Git could not")),
    reported);
  assert.match(reported, /example\/recorded: skipped, already recorded \(git_failed\)/u);
  assert.match(reported, /example\/sourceless: skipped, not a session clone/u);
  assert.match(reported, /example\/pull-request: skipped, it has a pull request/u);
  assert.ok(f.messages.some(({ level, message }) => level === "warning" && message.startsWith("example/missing: skipped, its checkout is missing")),
    reported);
});

test("apply removes a stale copy only under Git's proof, records why others stay, and continues past a Git failure", async (t) => {
  const f = await fixture(t);
  const { s, localOnly } = await f.scenarios();
  const advanced = await git(f.origin, ["rev-parse", "HEAD"]);
  await f.run(true);

  // Removed: only the session branch is left; the remote-tracking ref stays.
  assert.equal(await outcome(f, "stale"), "removed");
  assert.equal(await git(s.stale, ["for-each-ref", "--format=%(refname)", "refs/heads"]), "refs/heads/vibe64/stale");
  assert.equal(await branchConfig(s.stale), "");
  assert.equal(await git(s.stale, ["rev-parse", "refs/remotes/origin/main"]), advanced);

  // Kept, with the same reasons source creation records.
  for (const [sessionId, reason] of [["on-main", "kept_head_on_default"], ["detached", "kept_head_detached"],
    ["other", "kept_session_branch_not_checked_out"], ["unpublished", "kept_unpublished_commits"]]) {
    assert.equal(await outcome(f, sessionId), reason, sessionId);
  }
  // These were cloned after origin advanced.
  for (const sourcePath of [s.onMain, s.detached, s.other]) {
    assert.equal(await git(sourcePath, ["rev-parse", "refs/heads/main"]), advanced);
    assert.equal(await git(sourcePath, ["config", "--local", "branch.main.merge"]), "refs/heads/main");
  }
  assert.equal(await git(s.unpublished, ["rev-parse", "refs/heads/main"]), localOnly);
  assert.equal(await outcome(f, "absent"), "absent");

  // A Git failure is recorded for that session and the others still ran.
  assert.equal(await outcome(f, "broken"), "git_failed");
  assert.ok(f.messages.some(({ level, message }) => level === "warning" && message.startsWith("example/broken: Git could not")));

  // Not touched: an outcome already recorded, a missing checkout, no source.
  assert.equal(await outcome(f, "recorded"), "git_failed");
  assert.equal(await git(s.recorded, ["rev-parse", "refs/heads/main"]), advanced);
  assert.equal(await outcome(f, "missing"), "");
  assert.equal(await outcome(f, "sourceless"), "");
  assert.equal(await outcome(f, "pull-request"), "");
  assert.equal(await git(s.pullRequest, ["rev-parse", "refs/heads/main"]), advanced);

  // Only the removed ref has a backup, and it is enough to recreate it.
  const backupPath = path.join(f.backupRoot, "example", "stale.json");
  assert.deepEqual(JSON.parse(await readFile(backupPath, "utf8")), {
    schemaVersion: 1,
    project: "example",
    sessionId: "stale",
    sourcePath: s.stale,
    branch: "main",
    objectId: f.base,
    config: [{ key: "branch.main.remote", value: "origin" }, { key: "branch.main.merge", value: "refs/heads/main" }]
  });
  assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(backupPath))).mode & 0o777, 0o700);
  assert.deepEqual(await exec("ls", [path.join(f.backupRoot, "example")]).then(({ stdout }) => stdout.trim()), "stale.json");
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  await git(backup.sourcePath, ["update-ref", `refs/heads/${backup.branch}`, backup.objectId]);
  for (const { key, value } of backup.config) await git(backup.sourcePath, ["config", "--add", key, value]);
  assert.equal(await git(s.stale, ["rev-parse", "refs/heads/main"]), f.base);
  assert.equal(await git(s.stale, ["rev-parse", "--abbrev-ref", "main@{upstream}"]), "origin/main");
});

test("the backup is written and verified before Git deletes the copy", async (t) => {
  const f = await fixture(t);
  const sourcePath = await f.session("stale");
  const backupPath = path.join(f.backupRoot, "example", "stale.json");
  const deletions = [];
  await f.run(true, {
    runCommand: async (request) => {
      if (request.command === "git" && request.args?.[0] === "branch" && request.args[1] === "-d") {
        deletions.push(JSON.parse(await readFile(backupPath, "utf8")).objectId);
      }
      return runVibe64Command(request);
    }
  });
  assert.deepEqual(deletions, [f.base]);
  assert.equal(await outcome(f, "stale"), "removed");
  assert.equal(await git(sourcePath, ["for-each-ref", "--format=%(refname)", "refs/heads/main"]), "");
});

test("a conflicting earlier backup stops the upgrade and keeps the copy; a matching one is reused", async (t) => {
  const f = await fixture(t);
  const sourcePath = await f.session("stale");
  const backupPath = path.join(f.backupRoot, "example", "stale.json");
  await mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  await writeFile(backupPath, `${JSON.stringify({ schemaVersion: 1, objectId: "0".repeat(40) })}\n`, { mode: 0o600 });
  await assert.rejects(f.run(true), /backup .* differs/u);
  assert.equal(await git(sourcePath, ["rev-parse", "refs/heads/main"]), f.base);
  assert.equal(await outcome(f, "stale"), "");

  // An apply interrupted after its backup, before Git removed the copy.
  await writeFile(backupPath, `${JSON.stringify({
    schemaVersion: 1, project: "example", sessionId: "stale", sourcePath, branch: "main", objectId: f.base,
    config: [{ key: "branch.main.remote", value: "origin" }, { key: "branch.main.merge", value: "refs/heads/main" }]
  }, null, 2)}\n`, { mode: 0o600 });
  await f.run(true);
  assert.equal(await outcome(f, "stale"), "removed");
  assert.equal(await git(sourcePath, ["for-each-ref", "--format=%(refname)", "refs/heads/main"]), "");
});

test("a re-run changes nothing, and a run interrupted after removal records it from its backup", async (t) => {
  const f = await fixture(t);
  const { s } = await f.scenarios();
  await f.run(true);
  const applied = await snapshot(f, s);
  const backup = await readFile(path.join(f.backupRoot, "example", "stale.json"));
  f.messages.length = 0;
  await f.run(true);
  assert.deepEqual(await snapshot(f, s), applied);
  assert.match(f.messages.map(({ message }) => message).join("\n"), /example\/stale: skipped, already recorded \(removed\)/u);

  await f.store.deleteMetadataValue("stale", OUTCOME);
  await f.run(true);
  assert.equal(await outcome(f, "stale"), "removed");
  assert.deepEqual(await readFile(path.join(f.backupRoot, "example", "stale.json")), backup);
  assert.deepEqual(await snapshot(f, s), applied);
});

test("installations without projects pass, and the script requires the session source owner", async (t) => {
  const f = await fixture(t);
  await f.run(true);
  assert.deepEqual(f.messages, [{ level: "info", message: "No session checkouts to inspect." }]);
  await assert.rejects(upgrade.run({ systemRoot: f.systemRoot, apply: false, report() {} }), /session source owner is required/u);
});
