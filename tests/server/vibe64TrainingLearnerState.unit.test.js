import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { readProjectRecordMetadata, updateProjectRecordMetadata, writeJsonFileAtomic } from "@local/vibe64-core/server/projectRecordMetadata";
import { createCourseLock, readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";
import { createTrainingContentInstaller } from "../../packages/vibe64-training/src/server/contentInstaller.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";

async function fixture(t, { published = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibe64-learner-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "system");
  const sourceRoot = path.join(root, "source");
  await fs.mkdir(systemRoot, { mode: 0o700 });
  await fs.mkdir(sourceRoot);
  async function write(filename, value, base = sourceRoot) {
    const destination = path.join(base, filename);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  const topic = { schemaVersion: 1, topicId: "intro-topic", domainId: "vibe64", title: "One introduction", status: "preview", outline: "training/outline.md", prerequisites: [],
    lessons: [{ code: "INTRO-01", descriptor: "training/lessons/INTRO-01/lesson.json", status: published ? "published" : "draft", required: true }] };
  await write("package.json", { name: "learn-state-fixture", version: "0.1.0", repository: { type: "git", url: "https://github.com/examples/learn-state-fixture.git" }, vibe64Training: topic });
  await write("training/outline.md", "# One introduction\nTry the practice app.\n");
  await write("training/lessons/INTRO-01/lesson.json", { schemaVersion: 1, code: "INTRO-01", title: "Try the practice app", document: "lesson.md", prerequisites: [], estimatedMinutes: 10, visuals: [],
    exercise: { kind: "bundled", source: "../../exercises/app", reuse: "attempt" }, assessments: [{ id: "explain", kind: "answer", required: true, rubric: "lesson.md#explain" }] });
  await write("training/lessons/INTRO-01/lesson.md", '# Try the app\n<a id="explain"></a>\nExplain what you tried.\n');
  await write("training/exercises/app/package.json", { name: "state-practice-app", private: true, type: "module" });
  await write("training/exercises/app/server.mjs", 'import { createServer } from "node:http";\nconst args = process.argv.slice(2);\ncreateServer((request, response) => response.end("Practice app")).listen(Number(args[args.indexOf("--port") + 1] || 8080), args[args.indexOf("--host") + 1] || "127.0.0.1");\n');
  await write("training/exercises/app/genesis/version", "3\n");
  await write("training/exercises/app/genesis/stack.md", '# Stack\n\n## Workspace setup\n\n- Prepare `Check syntax` with `nodejs`: `node` `--check` `server.mjs`\n\n## Outputs\n\n### Target `app`: Practice app\n\n- Default.\n- Mode: `interactive`\n- Workdir: `.`\n- Runtimes: `nodejs`\n- Run `Start`: `node` `server.mjs` `--host` `{host}` `--port` `{port}`\n\n#### Presentation\n\n- Kind: `web`\n- Preferred port: `8080`\n- URL path: `/`\n- Ready when: `GET` `/` returns `200`\n');
  execFileSync("git", ["-C", sourceRoot, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", sourceRoot, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", sourceRoot, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Pinned introduction"], { stdio: "ignore" });
  const sourcePin = await readPinnedTopic(sourceRoot);
  const topicPin = { schemaVersion: 1, topicId: sourcePin.topicId, release: sourcePin.release, repository: sourcePin.repository, commit: sourcePin.commit, topicHash: sourcePin.topicHash };
  await createTrainingContentInstaller({ systemRoot }).installTopic({ sourceRoot, pin: topicPin });
  const lock = createCourseLock({ schemaVersion: 1, courseId: "intro-course", title: "Introduction", release: "0.1.0", status: "preview", topics: [{ topicId: topicPin.topicId, release: topicPin.release }] }, [sourcePin]);
  const pin = { course: { courseId: lock.courseId, release: lock.release }, topic: topicPin, lesson: { code: lock.topics[0].lessons[0].code, hash: lock.topics[0].lessons[0].hash } };
  const actor = { uid: 42, username: "learner" };
  const state = createTrainingLearnerState({ systemRoot });
  const userRoot = value => path.join(systemRoot, "training", "users", Buffer.from(String(value.uid ?? value.username)).toString("base64url"));
  const paths = { root: userRoot(actor), progress: path.join(userRoot(actor), "progress.json"), active: path.join(userRoot(actor), "active-lesson.json"), lock: path.join(userRoot(actor), "state.lock") };
  const reserve = options => state.reserveAttempt({ actor, requestId: "start-1", expectedRevision: 0, pin, ...options });
  return { root, systemRoot, sourceRoot, pin, actor, state, userRoot, paths, reserve, write };
}

async function treeState(directory) {
  const result = [];
  async function visit(filename) {
    const stat = await fs.lstat(filename);
    const relative = path.relative(directory, filename);
    if (stat.isSymbolicLink()) result.push({ path: relative, link: await fs.readlink(filename) });
    else if (stat.isDirectory()) {
      result.push({ path: relative, directory: true, mode: stat.mode, mtime: stat.mtimeMs });
      for (const name of (await fs.readdir(filename)).sort()) await visit(path.join(filename, name));
    } else result.push({ path: relative, mode: stat.mode, mtime: stat.mtimeMs, hash: createHash("sha256").update(await fs.readFile(filename)).digest("hex") });
  }
  await visit(directory);
  return result;
}

test("readState requires identity and reads absent state without filesystem writes or a local fallback", async t => {
  const f = await fixture(t);
  const before = await treeState(f.systemRoot);
  for (const actor of [undefined, null, {}, { username: "" }, { uid: "", username: "valid-but-not-fallback" }, { uid: NaN }, { uid: -1 }, { uid: false }, { username: " has-space " }, { username: "x".repeat(129) }]) {
    await assert.rejects(() => f.state.readState({ actor }), /identity|actor|fallback/u);
  }
  const empty = await f.state.readState({ actor: f.actor });
  assert.equal(empty.revision, 0);
  assert.equal(empty.active, null);
  assert.equal(empty.activeSummaryCurrent, true);
  assert.deepEqual(empty.progress.attempts, []);
  assert.equal((await f.state.readState({ actor: { uid: 0 } })).progress.learnerId, "0");
  assert.equal((await f.state.readState({ actor: { username: "../../encoded-user" } })).progress.learnerId, "../../encoded-user");
  assert.deepEqual(await treeState(f.systemRoot), before);
  await assert.rejects(() => fs.lstat(path.join(f.systemRoot, "training/users")), { code: "ENOENT" });
});

test("reservation stores exact course/topic/lesson identity and server slug before any project effects", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  assert.equal(reserved.revision, 1);
  assert.equal(reserved.replayed, false);
  assert.deepEqual(reserved.attempt.pin, f.pin);
  assert.match(reserved.attempt.attemptId, /^[a-f0-9-]{36}$/u);
  assert.equal(reserved.attempt.projectSlug, `training-${reserved.attempt.attemptId.replaceAll("-", "")}`);
  assert.deepEqual(reserved.attempt.preparation, { phase: "reserved" });
  assert.equal(reserved.attempt.projectSlug.length, 41);
  const progress = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  const active = JSON.parse(await fs.readFile(f.paths.active, "utf8"));
  assert.deepEqual(progress.attempts, [reserved.attempt]);
  assert.equal(active.progressRevision, progress.revision);
  assert.equal(active.attemptId, progress.activeAttemptId);
  assert.deepEqual(active.pin, f.pin);
  assert.equal((await fs.lstat(f.paths.root)).mode & 0o777, 0o700);
  assert.equal((await fs.lstat(f.paths.progress)).mode & 0o777, 0o600);
  assert.equal((await fs.lstat(f.paths.active)).mode & 0o777, 0o600);
  await assert.rejects(() => fs.lstat(path.join(f.systemRoot, "projects")), { code: "ENOENT" });
  assert.deepEqual((await fs.readdir(f.paths.root)).sort(), ["active-lesson.json", "progress.json", "state.lock"]);
  const before = await treeState(f.systemRoot);
  assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, true);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("request replay precedes revision checks, distinct admitted requests share one active attempt, and conflicts do not rewrite it", async t => {
  const f = await fixture(t);
  const first = await f.reserve();
  const beforeReplay = await treeState(f.systemRoot);
  const replay = await f.reserve();
  assert.equal(replay.replayed, true);
  assert.equal(replay.attempt.attemptId, first.attempt.attemptId);
  assert.equal(replay.revision, 1);
  assert.deepEqual(await treeState(f.systemRoot), beforeReplay);
  await assert.rejects(() => f.reserve({ requestId: "start-2" }), error => error.code === "VIBE64_TRAINING_STATE_REVISION_CONFLICT");
  const second = await f.reserve({ requestId: "start-2", expectedRevision: 1 });
  assert.equal(second.revision, 2);
  assert.equal(second.attempt.attemptId, first.attempt.attemptId);
  assert.equal(second.attempt.projectSlug, first.attempt.projectSlug);
  assert.deepEqual(second.attempt.requestIds, ["start-1", "start-2"]);
  assert.equal((await f.reserve()).replayed, true);
  const differentCourse = { ...f.pin, course: { ...f.pin.course, release: "0.1.1" } };
  const beforeConflict = await treeState(f.systemRoot);
  await assert.rejects(() => f.reserve({ pin: differentCourse }), error => error.code === "VIBE64_TRAINING_REQUEST_CONFLICT");
  await assert.rejects(() => f.reserve({ pin: differentCourse, requestId: "another-start", expectedRevision: 2 }), error => error.code === "VIBE64_TRAINING_ATTEMPT_CONFLICT");
  assert.deepEqual(await treeState(f.systemRoot), beforeConflict);
});

test("actors remain separate and exact installed published pins are checked even on replay", async t => {
  const f = await fixture(t);
  const first = await f.reserve();
  const other = { uid: 43, username: "other" };
  const second = await f.reserve({ actor: other });
  assert.notEqual(first.attempt.attemptId, second.attempt.attemptId);
  assert.notEqual(f.paths.root, f.userRoot(other));
  assert.equal((await f.state.readState({ actor: other })).progress.learnerId, "43");
  await assert.rejects(() => f.state.resumeAttempt({ actor: other, attemptId: first.attempt.attemptId }), error => error.code === "VIBE64_TRAINING_ATTEMPT_MISSING");
  for (const pin of [{ ...f.pin, topic: { ...f.pin.topic, repository: "examples/learn-other" } }, { ...f.pin, lesson: { ...f.pin.lesson, hash: "f".repeat(64) } }]) {
    await assert.rejects(() => f.reserve({ pin }), /installed topic|content hash changed/u);
  }
  const snapshot = path.join(f.systemRoot, "training/content", f.pin.topic.topicId, f.pin.topic.commit);
  await fs.rename(snapshot, `${snapshot}.missing`);
  const before = await treeState(f.paths.root);
  await assert.rejects(() => f.reserve(), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
  await assert.rejects(() => f.state.resumeAttempt({ actor: f.actor, attemptId: first.attempt.attemptId }), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
  assert.deepEqual(await treeState(f.paths.root), before);
  const draft = await fixture(t, { published: false });
  await assert.rejects(() => draft.reserve(), /draft and cannot be taught/u);
  await assert.rejects(() => fs.lstat(path.join(draft.systemRoot, "training/users")), { code: "ENOENT" });
});

test("resume uses the stored pin after catalogue disablement and reconciles only valid missing or stale summaries", async t => {
  const f = await fixture(t);
  const first = await f.reserve();
  const progressBefore = await fs.readFile(f.paths.progress, "utf8");
  await f.write("training/catalogue.json", { enabled: false, newerRelease: "9.9.9" }, f.systemRoot);
  await fs.rm(f.paths.active);
  const beforeRead = await treeState(f.systemRoot);
  const read = await f.state.readState({ actor: f.actor });
  assert.equal(read.activeSummaryCurrent, false);
  assert.equal(read.active.attemptId, first.attempt.attemptId);
  assert.deepEqual(await treeState(f.systemRoot), beforeRead);
  const resumed = await f.state.resumeAttempt({ actor: f.actor, attemptId: first.attempt.attemptId });
  assert.deepEqual(resumed.attempt.pin, f.pin);
  assert.equal(await fs.readFile(f.paths.progress, "utf8"), progressBefore);
  const stale = { ...resumed.active, progressRevision: 0 };
  await fs.writeFile(f.paths.active, JSON.stringify(stale));
  const beforeStaleRead = await treeState(f.systemRoot);
  assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, false);
  assert.deepEqual(await treeState(f.systemRoot), beforeStaleRead);
  await f.reserve();
  assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, true);
  assert.equal(await fs.readFile(f.paths.progress, "utf8"), progressBefore);
});

test("summary save failure reports the saved reservation and retry recovers the same identity", async t => {
  const f = await fixture(t);
  const realRename = fs.rename;
  const renameMock = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === f.paths.active) throw Object.assign(new Error("Fixture summary disk failure"), { code: "EIO" });
    return realRename(...args);
  });
  syncBuiltinESMExports();
  let reported;
  try {
    await assert.rejects(() => f.reserve(), error => {
      reported = error;
      return error.code === "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED" && error.reservationSaved === true && error.revision === 1;
    });
  } finally { renameMock.mock.restore(); syncBuiltinESMExports(); }
  const saved = await f.state.readState({ actor: f.actor });
  assert.equal(saved.progress.activeAttemptId, reported.attemptId);
  assert.equal(saved.activeSummaryCurrent, false);
  assert.deepEqual((await fs.readdir(f.paths.root)).sort(), ["progress.json", "state.lock"]);
  const retry = await f.reserve();
  assert.equal(retry.replayed, true);
  assert.equal(retry.attempt.attemptId, reported.attemptId);
  assert.equal(retry.attempt.projectSlug, saved.active.projectSlug);
  assert.equal(retry.revision, 1);
});

test("progress save failures remain unconfirmed before and after rename, with no fabricated project or duplicate reservation", async t => {
  const f = await fixture(t);
  const realRename = fs.rename;
  const renameMock = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === f.paths.progress) throw Object.assign(new Error("Fixture progress disk failure"), { code: "EIO" });
    return realRename(...args);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(() => f.reserve(), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED"); }
  finally { renameMock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal((await f.state.readState({ actor: f.actor })).revision, 0);
  await assert.rejects(() => fs.lstat(f.paths.progress), { code: "ENOENT" });
  const realRemove = fs.rm;
  let interrupted = false;
  const removeMock = t.mock.method(fs, "rm", async (...args) => {
    if (!interrupted && String(args[0]).startsWith(path.join(f.paths.root, ".progress.json."))) {
      interrupted = true;
      throw Object.assign(new Error("Fixture cleanup failed after progress rename"), { code: "EIO" });
    }
    return realRemove(...args);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(() => f.reserve(), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED" && /may already have saved/u.test(error.message)); }
  finally { removeMock.mock.restore(); syncBuiltinESMExports(); }
  const saved = await f.state.readState({ actor: f.actor });
  assert.equal(saved.revision, 1);
  assert.equal(saved.activeSummaryCurrent, false);
  const retry = await f.reserve();
  assert.equal(retry.attempt.attemptId, saved.active.attemptId);
  assert.equal(retry.replayed, true);
  assert.equal(retry.revision, 1);
  await assert.rejects(() => fs.lstat(path.join(f.systemRoot, "projects")), { code: "ENOENT" });
});

test("persistent per-user lock excludes competing writes and retry identities stay bounded", async t => {
  const f = await fixture(t);
  const first = await f.reserve();
  const inode = (await fs.lstat(f.paths.lock)).ino;
  const release = await tryAcquireExclusiveFileLock(f.paths.lock);
  assert.equal(typeof release, "function");
  t.after(() => release());
  const before = await treeState(f.paths.root);
  await assert.rejects(() => f.reserve(), error => error.code === "VIBE64_TRAINING_STATE_BUSY" && error.statusCode === 409);
  await assert.rejects(() => f.state.resumeAttempt({ actor: f.actor, attemptId: first.attempt.attemptId }), error => error.code === "VIBE64_TRAINING_STATE_BUSY");
  assert.deepEqual(await treeState(f.paths.root), before);
  await release();
  assert.equal((await f.reserve()).attempt.attemptId, first.attempt.attemptId);
  assert.equal((await fs.lstat(f.paths.lock)).ino, inode);
  const progress = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  progress.attempts[0].requestIds = Array.from({ length: 64 }, (_, index) => `start-${index + 1}`);
  progress.revision = 64;
  await fs.writeFile(f.paths.progress, JSON.stringify(progress));
  const active = { ...first.active, progressRevision: 64 };
  await fs.writeFile(f.paths.active, JSON.stringify(active));
  const bounded = await treeState(f.paths.root);
  await assert.rejects(() => f.reserve({ requestId: "start-65", expectedRevision: 64 }), /64 distinct reservation-request limit/u);
  assert.deepEqual(await treeState(f.paths.root), bounded);
  assert.equal((await f.reserve()).replayed, true);
});

test("malformed, unsupported, cross-learner and conflicting records fail closed without repair", async t => {
  const f = await fixture(t);
  const first = await f.reserve();
  const originalProgress = await fs.readFile(f.paths.progress, "utf8");
  const originalActive = await fs.readFile(f.paths.active, "utf8");
  const progress = JSON.parse(originalProgress);
  const active = JSON.parse(originalActive);
  const cases = [
    [f.paths.progress, "null"], [f.paths.progress, "{corrupt"], [f.paths.progress, JSON.stringify({ ...progress, schemaVersion: 2 })],
    [f.paths.progress, JSON.stringify({ ...progress, learnerId: "someone-else" })], [f.paths.progress, JSON.stringify({ ...progress, results: [{ outcome: "passed" }] })],
    [f.paths.progress, JSON.stringify({ ...progress, attempts: [{ ...progress.attempts[0], projectSlug: "caller-chosen" }] })],
    [f.paths.active, "[]"], [f.paths.active, JSON.stringify({ ...active, schemaVersion: 2 })], [f.paths.active, JSON.stringify({ ...active, learnerId: "someone-else" })],
    [f.paths.active, JSON.stringify({ ...active, progressRevision: 999 })], [f.paths.active, JSON.stringify({ ...active, attemptId: randomUUID() })],
    [f.paths.active, JSON.stringify({ ...active, preparation: { phase: "ready" } })]
  ];
  for (const [filename, contents] of cases) {
    await fs.writeFile(f.paths.progress, originalProgress);
    await fs.writeFile(f.paths.active, originalActive);
    await fs.writeFile(filename, contents);
    const before = await treeState(f.paths.root);
    for (const operation of [() => f.state.readState({ actor: f.actor }), () => f.reserve(), () => f.state.resumeAttempt({ actor: f.actor, attemptId: first.attempt.attemptId })]) {
      await assert.rejects(operation, error => error.code === "VIBE64_TRAINING_STATE_INVALID");
    }
    assert.deepEqual(await treeState(f.paths.root), before);
  }
  await fs.writeFile(f.paths.active, originalActive);
  await fs.rm(f.paths.progress);
  const orphaned = await treeState(f.paths.root);
  await assert.rejects(() => f.state.readState({ actor: f.actor }), /conflicts with durable progress/u);
  await assert.rejects(() => f.reserve(), /conflicts with durable progress/u);
  assert.deepEqual(await treeState(f.paths.root), orphaned);
});

test("all state hierarchy aliases and oversized records are rejected without rewriting", async t => {
  const f = await fixture(t);
  await f.reserve();
  for (const target of [f.systemRoot, path.join(f.systemRoot, "training"), path.join(f.systemRoot, "training/users"), f.paths.root, f.paths.progress, f.paths.active, f.paths.lock]) {
    const actual = `${target}.actual`;
    const directory = (await fs.lstat(target)).isDirectory();
    await fs.rename(target, actual);
    try {
      await fs.symlink(path.basename(actual), target, directory ? "dir" : "file");
      const before = await treeState(f.systemRoot);
      await assert.rejects(() => f.state.readState({ actor: f.actor }), /symlink or file aliases/u);
      await assert.rejects(() => f.reserve(), /symlink or file aliases/u);
      assert.deepEqual(await treeState(f.systemRoot), before);
    } finally { await fs.rm(target); await fs.rename(actual, target); }
  }
  await fs.writeFile(f.paths.active, "x".repeat(64 * 1024 + 1));
  const before = await treeState(f.paths.root);
  await assert.rejects(() => f.state.readState({ actor: f.actor }), /64 KiB/u);
  assert.deepEqual(await treeState(f.paths.root), before);
});

test("the original metadata writer retains defaults, bytes, queue semantics and cleanup while supporting private state modes", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibe64-atomic-writer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = path.join(root, "metadata", "project.json");
  await writeJsonFileAtomic(record, { existing: true });
  assert.equal(await fs.readFile(record, "utf8"), `${JSON.stringify({ existing: true }, null, 2)}\n`);
  assert.equal((await fs.lstat(record)).mode & 0o777, 0o666 & ~process.umask());
  assert.equal((await fs.lstat(path.dirname(record))).mode & 0o777, 0o777 & ~process.umask());
  const entered = Promise.withResolvers();
  const continueFirst = Promise.withResolvers();
  const first = updateProjectRecordMetadata(record, async current => {
    entered.resolve();
    await continueFirst.promise;
    return { ...current, first: true };
  });
  await entered.promise;
  let secondEntered = false;
  const second = updateProjectRecordMetadata(record, current => { secondEntered = true; return { ...current, second: true }; });
  try {
    assert.equal(secondEntered, false);
    continueFirst.resolve();
    await first;
    await second;
  } finally {
    continueFirst.resolve();
    await Promise.allSettled([first, second]);
  }
  assert.deepEqual(await readProjectRecordMetadata(record), { existing: true, first: true, second: true });
  assert.deepEqual(await fs.readdir(path.dirname(record)), ["project.json"]);
  const privateRecord = path.join(root, "private", "state.json");
  await writeJsonFileAtomic(privateRecord, { reserved: true }, { directoryMode: 0o700, fileMode: 0o600 });
  assert.equal((await fs.lstat(path.dirname(privateRecord))).mode & 0o777, 0o700);
  assert.equal((await fs.lstat(privateRecord)).mode & 0o777, 0o600);
});

async function recoveryProcedure(f) {
  const guide = await fs.readFile(new URL("../../docs/training-state-recovery.md", import.meta.url), "utf8");
  const blocks = [...guide.matchAll(/^```bash\n([\s\S]*?)^```/gmu)].map(match => match[1]);
  assert.equal(blocks.length, 5, "Execute the guide's actual setup, backup, stage, validation and publication blocks.");
  const [setup, backup, stage, validate, publish] = blocks;
  const backupRoot = path.join(f.root, "private-checkpoints");
  await fs.mkdir(backupRoot, { mode: 0o700 });
  const run = (snippets, extra = {}) => promisify(execFile)(
    "/bin/bash",
    ["--noprofile", "--norc", "-c", [
      'trap \'printf "Fixture stage=%s\\n" "${stage:-}"\' EXIT',
      ...snippets
    ].join("\n")],
    {
      env: {
        ...process.env,
        system_root: f.systemRoot,
        application_root: fileURLToPath(new URL("../../", import.meta.url)),
        backup_root: backupRoot,
        ...extra
      }
    }
  );
  const copy = async () => {
    const result = await run([setup, backup]);
    return /^Copy completed: (.+)$/mu.exec(result.stdout)?.[1];
  };
  const restore = (checkpoint, extra) => run([setup, stage, validate, publish], { checkpoint, ...extra });
  const stagePath = result => /^Fixture stage=(.+)$/mu.exec(result.stdout)?.[1];
  return { backupRoot, setup, backup, stage, validate, publish, run, copy, restore, stagePath };
}

test("documented private checkpoints restore exact bytes, modes and reservation identity including missing and stale summaries", async t => {
  for (const summary of ["current", "missing", "stale"]) {
    const f = await fixture(t);
    const first = await f.reserve();
    if (summary === "missing") {
      await fs.rm(f.paths.active);
    }
    if (summary === "stale") {
      await fs.writeFile(f.paths.active, JSON.stringify({ ...first.active, progressRevision: 0 }));
    }
    const users = path.dirname(f.paths.root);
    const original = await treeState(users);
    const contentRoot = path.join(f.systemRoot, "training/content");
    const contentBefore = await treeState(contentRoot);
    const procedure = await recoveryProcedure(f);
    const checkpoint = await procedure.copy();
    assert.ok(checkpoint);
    assert.equal((await fs.lstat(checkpoint)).mode & 0o777, 0o700);
    assert.deepEqual(await treeState(path.join(checkpoint, "training/users")), original);
    assert.deepEqual(await treeState(users), original, "Backup does not reconcile or change the original.");
    await f.reserve({ requestId: "start-2", expectedRevision: 1 });
    const beforeRestore = await treeState(users);
    const result = await procedure.restore(checkpoint);
    const stage = procedure.stagePath(result);
    assert.ok(stage);
    assert.deepEqual(await treeState(users), original);
    assert.deepEqual(await treeState(path.join(stage, "previous-users")), beforeRestore);
    assert.deepEqual(await treeState(path.join(checkpoint, "training/users")), original);
    assert.deepEqual(await treeState(contentRoot), contentBefore);
    const restored = await f.state.readState({ actor: f.actor });
    assert.equal(restored.revision, 1);
    assert.equal(restored.activeSummaryCurrent, summary === "current");
    assert.deepEqual(restored.progress.attempts, [first.attempt]);
    assert.deepEqual(restored.active.pin, f.pin);
  }
});

test("documented restore accepts lost users without fake progress and refuses alias or non-directory destinations", async t => {
  const f = await fixture(t);
  const procedure = await recoveryProcedure(f);
  const noState = await procedure.run([procedure.setup, procedure.backup]);
  assert.match(noState.stdout, /No learner state to copy; no checkpoint created/u);
  assert.deepEqual(await fs.readdir(procedure.backupRoot), []);
  await assert.rejects(() => fs.lstat(path.join(f.systemRoot, "training/users")), { code: "ENOENT" });
  const first = await f.reserve();
  const checkpoint = await procedure.copy();
  const users = path.dirname(f.paths.root);
  const original = await treeState(users);
  await fs.rename(users, path.join(f.root, "lost-users"));
  const restored = await procedure.restore(checkpoint);
  assert.deepEqual(await treeState(users), original);
  await assert.rejects(() => fs.lstat(path.join(procedure.stagePath(restored), "previous-users")), { code: "ENOENT" });
  assert.deepEqual((await f.state.readState({ actor: f.actor })).progress.attempts, [first.attempt]);
  for (const alias of [true, false]) {
    await fs.rename(users, `${users}.retained`);
    try {
      if (alias) {
        await fs.symlink("users.retained", users, "dir");
      } else {
        await fs.writeFile(users, "Unexplained non-directory evidence");
      }
      const before = await treeState(f.systemRoot);
      await assert.rejects(() => procedure.restore(checkpoint));
      assert.deepEqual(await treeState(f.systemRoot), before);
    } finally {
      await fs.rm(users);
      await fs.rename(`${users}.retained`, users);
    }
  }
});

test("documented maintenance refuses actual user lock contention before backup or restore writes", async t => {
  const f = await fixture(t);
  await f.reserve();
  const procedure = await recoveryProcedure(f);
  const checkpoint = await procedure.copy();
  const before = await treeState(f.systemRoot);
  const backupsBefore = await treeState(procedure.backupRoot);
  const release = await tryAcquireExclusiveFileLock(f.paths.lock);
  assert.equal(typeof release, "function");
  try {
    await assert.rejects(() => procedure.copy());
    await assert.rejects(() => procedure.restore(checkpoint));
    assert.deepEqual(await treeState(f.systemRoot), before);
    assert.deepEqual(await treeState(procedure.backupRoot), backupsBefore);
  } finally {
    await release();
  }
});

test("documented staged validation refuses invalid identity, newer records and missing exact installed pins before live writes", async t => {
  const f = await fixture(t);
  await f.reserve();
  const procedure = await recoveryProcedure(f);
  const checkpoint = await procedure.copy();
  const savedProgress = path.join(checkpoint, "training/users", path.basename(f.paths.root), "progress.json");
  const originalProgress = await fs.readFile(savedProgress, "utf8");
  const progress = JSON.parse(originalProgress);
  const liveBefore = await treeState(path.dirname(f.paths.root));
  const contentRoot = path.join(f.systemRoot, "training/content");
  const contentBefore = await treeState(contentRoot);
  for (const invalid of ["{corrupt", JSON.stringify({ ...progress, learnerId: "another-user" }), JSON.stringify({ ...progress, schemaVersion: 2 })]) {
    await fs.writeFile(savedProgress, invalid);
    await assert.rejects(() => procedure.restore(checkpoint), /Learning state is invalid/u);
    assert.deepEqual(await treeState(path.dirname(f.paths.root)), liveBefore);
    assert.deepEqual(await treeState(contentRoot), contentBefore);
  }
  await fs.writeFile(savedProgress, originalProgress);
  const snapshot = path.join(contentRoot, f.pin.topic.topicId, f.pin.topic.commit);
  await fs.rename(snapshot, `${snapshot}.unavailable`);
  try {
    const missingBefore = await treeState(contentRoot);
    await assert.rejects(() => procedure.restore(checkpoint), /Pinned teaching content .* is missing/u);
    assert.deepEqual(await treeState(path.dirname(f.paths.root)), liveBefore);
    assert.deepEqual(await treeState(contentRoot), missingBefore);
  } finally {
    await fs.rename(`${snapshot}.unavailable`, snapshot);
  }
  // Evidence copies are allowed without claiming their records are restorable.
  await fs.writeFile(f.paths.progress, "{corrupt evidence");
  const evidence = await procedure.copy();
  assert.equal(await fs.readFile(path.join(evidence, "training/users", path.basename(f.paths.root), "progress.json"), "utf8"), "{corrupt evidence");
});

test("documented two-rename interruption retains original and candidate for deliberate recovery", async t => {
  const f = await fixture(t);
  const first = await f.reserve();
  const procedure = await recoveryProcedure(f);
  const checkpoint = await procedure.copy();
  const candidateBefore = await treeState(path.join(checkpoint, "training/users"));
  await f.reserve({ requestId: "start-2", expectedRevision: 1 });
  const originalBefore = await treeState(path.dirname(f.paths.root));
  const commands = path.join(f.root, "interruption-commands");
  await fs.mkdir(commands);
  await fs.writeFile(path.join(commands, "mv"), '#!/bin/bash\nif [ "$4" = "$system_root/training/users" ]; then exit 74; fi\nexec /usr/bin/mv "$@"\n', { mode: 0o700 });
  let interrupted;
  await assert.rejects(() => procedure.restore(checkpoint, { PATH: `${commands}:${process.env.PATH}` }), error => {
    interrupted = error;
    return error.code === 74;
  });
  const stage = procedure.stagePath(interrupted);
  assert.ok(stage);
  await assert.rejects(() => fs.lstat(path.dirname(f.paths.root)), { code: "ENOENT" });
  assert.deepEqual(await treeState(path.join(stage, "previous-users")), originalBefore);
  assert.deepEqual(await treeState(path.join(stage, "training/users")), candidateBefore);
  assert.deepEqual(await treeState(path.join(checkpoint, "training/users")), candidateBefore);
  // Finish with the exact publication/validation lines, excluding its already
  // completed quarantine step. This simulates filesystem interruption only;
  // no real host/systemd stop or activation is claimed by this fixture.
  const finish = procedure.publish.slice(procedure.publish.indexOf('mv -T -- "$stage/training/users"'));
  await procedure.run([procedure.setup, procedure.validate, finish], { stage });
  assert.deepEqual(await treeState(path.dirname(f.paths.root)), candidateBefore);
  assert.equal((await f.state.readState({ actor: f.actor })).active.attemptId, first.attempt.attemptId);
  assert.deepEqual(await treeState(path.join(stage, "previous-users")), originalBefore);
});
