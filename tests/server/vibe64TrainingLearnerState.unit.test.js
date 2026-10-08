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
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createInstalledTrainingCatalogue } from "@local/vibe64-training/server/installed-catalogue";
import { createTrainingLearnerState, passedAssessmentIds } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingTeachingBrief } from "../../packages/vibe64-training/src/server/teachingBrief.js";

async function fixture(t, { published = true, learning = false, noExercise = false } = {}) {
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
  const assessments = learning ? [
    ...["answer-one", "answer-two", "answer-three"].map(id => ({ id, kind: "answer", required: true, rubric: `lesson.md#${id}` })),
    ...["workspace", "exercise", "colleague"].map(producer => ({ id: `${producer}-practice`, kind: "practical", required: true,
      rubric: `lesson.md#${producer}-practice`, evidence: { producer, operation: `${producer}-practice`,
        ...(producer === "exercise" ? { check: "response", explanationRequired: true } : {}) } }))
  ] : [{ id: "explain", kind: "answer", required: true, rubric: "lesson.md#explain" }];
  await write("training/lessons/INTRO-01/lesson.json", { schemaVersion: 1, code: "INTRO-01", title: "Try the practice app", document: "lesson.md", prerequisites: [], estimatedMinutes: 10,
    visuals: learning ? [{ id: "request", descriptor: "../../visuals/request/visual.json" }] : [],
    ...(noExercise ? {} : { exercise: { kind: "bundled", source: "../../exercises/app", reuse: "attempt" } }), assessments,
    ...(learning ? { checks: [{ id: "response", file: "../../checks/response.mjs" }] } : {}) });
  await write("training/lessons/INTRO-01/lesson.md", learning
    ? `# Try the app\n${assessments.map(value => `<a id="${value.id}"></a>\nExplain what you tried.\n`).join("")}`
    : '# Try the app\n<a id="explain"></a>\nExplain what you tried.\n');
  if (learning) {
    await write("training/checks/response.mjs", "export default () => true;\n");
    await write("training/visuals/request/visual.json", { schemaVersion: 1, id: "request", title: "A request", svg: "diagram.svg", controller: "controller.js",
      initialState: "overview", states: ["overview", "arrived"], description: "Follow a request.", commands: [] });
    await write("training/visuals/request/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await write("training/visuals/request/controller.js", "export function mountVisual() {}\n");
  }
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

async function catalogueInputs(f, { topicPin = f.pin.topic, release = "0.1.0", title = "Introduction" } = {}) {
  const topic = await createInstalledTrainingContent({ systemRoot: f.systemRoot }).readTopic(topicPin);
  const course = { schemaVersion: 1, courseId: "intro-course", title, release, status: "preview", topics: [{ topicId: topicPin.topicId, release: topicPin.release }] };
  const resolved = { topicId: topic.pin.topicId, release: topic.release, repository: topic.pin.repository, commit: topic.pin.commit, topicManifest: topic.topicManifest, topicHash: topic.topicHash };
  return { course, lock: createCourseLock(course, [resolved]) };
}

test("installed catalogue absent reads and missing disable create no namespace or state", async t => {
  const f = await fixture(t);
  const untouchedRoot = path.join(f.root, "absent-system");
  const absent = createInstalledTrainingCatalogue({ systemRoot: untouchedRoot });
  assert.deepEqual(await absent.readCatalogue(), { schemaVersion: 1, revision: 0, courses: [] });
  await assert.rejects(() => fs.lstat(untouchedRoot), { code: "ENOENT" });
  for (const systemRoot of ["relative", "/", `${f.systemRoot}/../system`, `${f.systemRoot}/`]) {
    assert.throws(() => createInstalledTrainingCatalogue({ systemRoot }), /canonical absolute/u);
  }
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const before = await treeState(f.systemRoot);
  assert.deepEqual(await catalogue.readCatalogue(), { schemaVersion: 1, revision: 0, courses: [] });
  await assert.rejects(() => catalogue.disableCourse({ courseId: "intro-course", release: "0.1.0", expectedRevision: 0 }), error => error.code === "VIBE64_TRAINING_COURSE_MISSING" && error.statusCode === 404);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("installed catalogue toggles exact immutable courses with revisions and leaves admitted or saved attempts independent", async t => {
  const f = await fixture(t);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const input = await catalogueInputs(f);
  const enabled = await catalogue.enableCourse({ ...input, expectedRevision: 0 });
  assert.deepEqual(enabled, { revision: 1, entry: { ...input, enabled: true }, changed: true });
  assert.equal((await fs.lstat(path.join(f.systemRoot, "training/catalogue.json"))).mode & 0o777, 0o600);
  const beforeRead = await treeState(f.systemRoot);
  const admitted = (await catalogue.readCatalogue()).courses.find(entry => entry.enabled);
  assert.deepEqual(admitted, enabled.entry);
  assert.deepEqual(await catalogue.enableCourse({ ...input, expectedRevision: 1 }), { ...enabled, changed: false });
  assert.deepEqual(await treeState(f.systemRoot), beforeRead);
  await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 0 }), error => error.code === "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT" && error.statusCode === 409);
  const disabled = await catalogue.disableCourse({ courseId: input.course.courseId, release: input.course.release, expectedRevision: 1 });
  assert.equal(disabled.revision, 2);
  assert.equal(disabled.entry.enabled, false);
  assert.deepEqual((await catalogue.readCatalogue()).courses.filter(entry => entry.enabled), []);
  const disabledBefore = await treeState(f.systemRoot);
  assert.deepEqual(await catalogue.disableCourse({ courseId: input.course.courseId, release: input.course.release, expectedRevision: 2 }), { ...disabled, changed: false });
  assert.deepEqual(await treeState(f.systemRoot), disabledBefore);
  // This is the approved admission cut line, not an implemented learner action:
  // a fresh enabled read precedes disable; later disable does not revoke it.
  assert.deepEqual(admitted.lock.topics[0].manifestHash, f.pin.topic.topicHash);
  const reserved = await f.reserve();
  assert.equal((await f.state.resumeAttempt({ actor: f.actor, attemptId: reserved.attempt.attemptId })).attempt.attemptId, reserved.attempt.attemptId);
  const reenabled = await catalogue.enableCourse({ ...input, expectedRevision: 2 });
  assert.equal(reenabled.revision, 3);
  assert.deepEqual(reenabled.entry.lock, admitted.lock);
  assert.equal(reenabled.entry.enabled, true);
});

test("installed catalogue rejects incomplete, reordered, extended or changed approved locks before owned writes", async t => {
  const f = await fixture(t);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const input = await catalogueInputs(f);
  const original = await treeState(f.systemRoot);
  const topic = input.lock.topics[0];
  const invalid = [
    { ...input, course: { ...input.course, lessons: ["INTRO-01"] } },
    { ...input, course: { ...input.course, status: "released" } },
    { ...input, lock: { ...input.lock, extra: "Not an approved lock field" } },
    { ...input, lock: { ...input.lock, topics: [] } },
    { ...input, lock: { ...input.lock, topics: [{ ...topic, lessons: [] }] } },
    { ...input, lock: { ...input.lock, topics: [{ ...topic, lessons: [...topic.lessons, ...topic.lessons] }] } },
    { ...input, lock: { ...input.lock, topics: [{ ...topic, lessons: [{ ...topic.lessons[0], hash: "f".repeat(64) }] }] } },
    { ...input, lock: { ...input.lock, topics: [{ ...topic, repository: "examples/learn-other" }] } }
  ];
  for (const value of invalid) {
    await assert.rejects(() => catalogue.enableCourse({ ...value, expectedRevision: 0 }));
    assert.deepEqual(await treeState(f.systemRoot), original);
  }
  // Retain one introductory lesson per topic while making topic order observable.
  const metadata = JSON.parse(await fs.readFile(path.join(f.sourceRoot, "package.json"), "utf8"));
  metadata.vibe64Training.topicId = "another-intro-topic";
  metadata.repository.url = "https://github.com/examples/learn-another-intro.git";
  await f.write("package.json", metadata);
  execFileSync("git", ["-C", f.sourceRoot, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", f.sourceRoot, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Second exact topic fixture"], { stdio: "ignore" });
  const resolved = await readPinnedTopic(f.sourceRoot);
  const pin = { schemaVersion: 1, topicId: resolved.topicId, release: resolved.release, repository: resolved.repository, commit: resolved.commit, topicHash: resolved.topicHash };
  await createTrainingContentInstaller({ systemRoot: f.systemRoot }).installTopic({ sourceRoot: f.sourceRoot, pin });
  const second = await catalogueInputs(f, { topicPin: pin });
  const course = { ...input.course, topics: [...input.course.topics, ...second.course.topics] };
  const lock = { ...input.lock, topics: [...input.lock.topics, ...second.lock.topics] };
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => catalogue.enableCourse({ course, lock: { ...lock, topics: [...lock.topics].reverse() }, expectedRevision: 0 }), /complete installed topic inventory/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
  assert.deepEqual((await catalogue.enableCourse({ course, lock, expectedRevision: 0 })).entry.lock, lock);
});

test("installed catalogue keeps earlier releases immutable while explicitly enabling a second installed pin", async t => {
  const f = await fixture(t);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const first = await catalogueInputs(f);
  await catalogue.enableCourse({ ...first, expectedRevision: 0 });
  const titleChange = { ...first, course: { ...first.course, title: "Changed title under the same release" } };
  const beforeConflict = await treeState(f.systemRoot);
  await assert.rejects(() => catalogue.enableCourse({ ...titleChange, expectedRevision: 1 }), error => error.code === "VIBE64_TRAINING_COURSE_RELEASE_CONFLICT");
  assert.deepEqual(await treeState(f.systemRoot), beforeConflict);
  const metadata = JSON.parse(await fs.readFile(path.join(f.sourceRoot, "package.json"), "utf8"));
  metadata.version = "0.1.1";
  await f.write("package.json", metadata);
  await f.write("training/outline.md", "# Same introduction, reviewed revised topic\n");
  execFileSync("git", ["-C", f.sourceRoot, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", f.sourceRoot, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Next pinned topic release"], { stdio: "ignore" });
  const resolved = await readPinnedTopic(f.sourceRoot);
  const topicPin = { schemaVersion: 1, topicId: resolved.topicId, release: resolved.release, repository: resolved.repository, commit: resolved.commit, topicHash: resolved.topicHash };
  await createTrainingContentInstaller({ systemRoot: f.systemRoot }).installTopic({ sourceRoot: f.sourceRoot, pin: topicPin });
  const replacement = await catalogueInputs(f, { topicPin });
  await assert.rejects(() => catalogue.enableCourse({ ...replacement, expectedRevision: 1 }), error => error.code === "VIBE64_TRAINING_COURSE_RELEASE_CONFLICT");
  const second = await catalogueInputs(f, { topicPin, release: "0.1.1" });
  await catalogue.enableCourse({ ...second, expectedRevision: 1 });
  const read = await catalogue.readCatalogue();
  assert.equal(read.revision, 2);
  assert.deepEqual(read.courses.map(entry => entry.lock), [first.lock, second.lock]);
  assert.notEqual(read.courses[0].lock.topics[0].commit, read.courses[1].lock.topics[0].commit);
});

test("disabled installed snapshots remain verified and catalogue failures do not rewrite learner state", async t => {
  const f = await fixture(t);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const input = await catalogueInputs(f);
  await catalogue.enableCourse({ ...input, expectedRevision: 0 });
  const attempt = await f.reserve();
  await catalogue.disableCourse({ courseId: input.course.courseId, release: input.course.release, expectedRevision: 1 });
  const usersBefore = await treeState(path.dirname(f.paths.root));
  const filename = path.join(f.systemRoot, "training/catalogue.json");
  const bytesBefore = await fs.readFile(filename, "utf8");
  const snapshot = path.join(f.systemRoot, "training/content", f.pin.topic.topicId, f.pin.topic.commit);
  const descriptor = path.join(snapshot, "files/training/lessons/INTRO-01/lesson.md");
  const document = await fs.readFile(descriptor, "utf8");
  await fs.writeFile(descriptor, `${document}Changed cache bytes\n`);
  await assert.rejects(() => catalogue.readCatalogue(), error => error.code === "VIBE64_TRAINING_CATALOGUE_INVALID" && /pinned content/u.test(error.message));
  assert.equal(await fs.readFile(filename, "utf8"), bytesBefore);
  assert.deepEqual(await treeState(path.dirname(f.paths.root)), usersBefore);
  await fs.writeFile(descriptor, document);
  // Resume deliberately ignores even an invalid catalogue, using saved pins.
  await fs.writeFile(filename, "{unavailable catalogue");
  assert.equal((await f.state.resumeAttempt({ actor: f.actor, attemptId: attempt.attempt.attemptId })).attempt.attemptId, attempt.attempt.attemptId);
  assert.deepEqual(await treeState(path.dirname(f.paths.root)), usersBefore);
  await fs.writeFile(filename, bytesBefore);
  await fs.rename(snapshot, `${snapshot}.missing`);
  try {
    await assert.rejects(() => catalogue.readCatalogue(), /Pinned teaching content .* is missing/u);
    await assert.rejects(() => catalogue.disableCourse({ courseId: input.course.courseId, release: input.course.release, expectedRevision: 2 }), /Pinned teaching content .* is missing/u);
    assert.equal(await fs.readFile(filename, "utf8"), bytesBefore);
  } finally {
    await fs.rename(`${snapshot}.missing`, snapshot);
  }
});

test("installed catalogue corruption, unsupported schema, duplicates, aliases and record bounds fail closed", async t => {
  const f = await fixture(t);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const input = await catalogueInputs(f);
  await catalogue.enableCourse({ ...input, expectedRevision: 0 });
  const filename = path.join(f.systemRoot, "training/catalogue.json");
  const lockPath = path.join(f.systemRoot, "training/catalogue.lock");
  const original = await fs.readFile(filename, "utf8");
  const valid = JSON.parse(original);
  for (const invalid of ["null", "{corrupt", JSON.stringify({ ...valid, schemaVersion: 2 }), JSON.stringify({ ...valid, courses: [...valid.courses, ...valid.courses] }), JSON.stringify({ ...valid, actor: "Not authenticated by a record" }), "x".repeat(1024 * 1024 + 1)]) {
    await fs.writeFile(filename, invalid);
    const before = await treeState(f.systemRoot);
    await assert.rejects(() => catalogue.readCatalogue(), error => error.code === "VIBE64_TRAINING_CATALOGUE_INVALID");
    await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 1 }), error => error.code === "VIBE64_TRAINING_CATALOGUE_INVALID");
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
  await fs.writeFile(filename, original);
  for (const target of [f.systemRoot, path.join(f.systemRoot, "training"), filename, lockPath]) {
    const actual = `${target}.retained`;
    const directory = (await fs.lstat(target)).isDirectory();
    await fs.rename(target, actual);
    try {
      await fs.symlink(path.basename(actual), target, directory ? "dir" : "file");
      const before = await treeState(f.systemRoot);
      await assert.rejects(() => catalogue.readCatalogue(), /unaliased regular files/u);
      await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 1 }), /unaliased regular files/u);
      assert.deepEqual(await treeState(f.systemRoot), before);
    } finally {
      await fs.rm(target);
      await fs.rename(actual, target);
    }
  }
  const alias = path.join(f.root, "catalogue-hard-link");
  await fs.link(filename, alias);
  try {
    await assert.rejects(() => catalogue.readCatalogue(), /unaliased regular files/u);
  } finally {
    await fs.rm(alias);
  }
  await fs.writeFile(lockPath, "Unexplained lock evidence");
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => catalogue.readCatalogue(), /lock contains unexplained data/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("installed catalogue real cross-process locking and revision conflicts preserve its persistent inode", async t => {
  const f = await fixture(t);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const input = await catalogueInputs(f);
  await catalogue.enableCourse({ ...input, expectedRevision: 0 });
  const lockPath = path.join(f.systemRoot, "training/catalogue.lock");
  const inode = (await fs.lstat(lockPath)).ino;
  const release = await tryAcquireExclusiveFileLock(lockPath);
  assert.equal(typeof release, "function");
  const before = await treeState(f.systemRoot);
  try {
    const script = 'import { createInstalledTrainingCatalogue } from "@local/vibe64-training/server/installed-catalogue";\nconst catalogue = createInstalledTrainingCatalogue({systemRoot: process.env.FIXTURE_SYSTEM_ROOT});\ntry { await catalogue.disableCourse({courseId:"intro-course",release:"0.1.0",expectedRevision:1}); process.exitCode=2; } catch(error) { if(error.code !== "VIBE64_TRAINING_CATALOGUE_BUSY" || error.statusCode !== 409) throw error; }\n';
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { ...process.env, FIXTURE_SYSTEM_ROOT: f.systemRoot } });
    await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 1 }), error => error.code === "VIBE64_TRAINING_CATALOGUE_BUSY");
    assert.deepEqual(await treeState(f.systemRoot), before);
  } finally {
    await release();
  }
  const other = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  await other.disableCourse({ courseId: input.course.courseId, release: input.course.release, expectedRevision: 1 });
  await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 1 }), error => error.code === "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT");
  assert.equal((await fs.lstat(lockPath)).ino, inode);
});

test("installed catalogue retains bounded immutable inventory and refuses revision overflow without writes", async t => {
  const f = await fixture(t);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const input = await catalogueInputs(f);
  await catalogue.enableCourse({ ...input, expectedRevision: 0 });
  const filename = path.join(f.systemRoot, "training/catalogue.json");
  const courses = Array.from({ length: 16 }, (_, index) => ({ course: { ...input.course, courseId: `retained-course-${index}` }, lock: { ...input.lock, courseId: `retained-course-${index}` }, enabled: false }));
  await fs.writeFile(filename, JSON.stringify({ schemaVersion: 1, revision: 16, courses }));
  const fullBefore = await treeState(f.systemRoot);
  await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 16 }), /16 course-release limit/u);
  assert.deepEqual(await treeState(f.systemRoot), fullBefore);
  await fs.writeFile(filename, JSON.stringify({ schemaVersion: 1, revision: Number.MAX_SAFE_INTEGER, courses: [{ ...input, enabled: true }] }));
  const overflowBefore = await treeState(f.systemRoot);
  await assert.rejects(() => catalogue.disableCourse({ courseId: input.course.courseId, release: input.course.release, expectedRevision: Number.MAX_SAFE_INTEGER }), /revision limit/u);
  assert.deepEqual(await treeState(f.systemRoot), overflowBefore);
});

test("installed catalogue save errors truthfully cover failure before and after atomic publication", async t => {
  const f = await fixture(t);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const input = await catalogueInputs(f);
  const filename = path.join(f.systemRoot, "training/catalogue.json");
  const realRename = fs.rename;
  const renameMock = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === filename) {
      throw Object.assign(new Error("Fixture catalogue disk failure"), { code: "EIO" });
    }
    return realRename(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 0 }), error => error.code === "VIBE64_TRAINING_CATALOGUE_SAVE_UNCONFIRMED");
  } finally {
    renameMock.mock.restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual(await catalogue.readCatalogue(), { schemaVersion: 1, revision: 0, courses: [] });
  const realRemove = fs.rm;
  let interrupted = false;
  const removeMock = t.mock.method(fs, "rm", async (...args) => {
    if (!interrupted && String(args[0]).startsWith(path.join(f.systemRoot, "training/.catalogue.json."))) {
      interrupted = true;
      throw Object.assign(new Error("Fixture cleanup failure after catalogue rename"), { code: "EIO" });
    }
    return realRemove(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 0 }), error => error.code === "VIBE64_TRAINING_CATALOGUE_SAVE_UNCONFIRMED" && /may already have succeeded/u.test(error.message));
  } finally {
    removeMock.mock.restore();
    syncBuiltinESMExports();
  }
  const saved = await catalogue.readCatalogue();
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.courses, [{ ...input, enabled: true }]);
  await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 0 }), error => error.code === "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT");
  assert.deepEqual(await catalogue.enableCourse({ ...input, expectedRevision: 1 }), { revision: 1, entry: saved.courses[0], changed: false });
  assert.deepEqual((await fs.readdir(path.join(f.systemRoot, "training"))).sort(), [".install-locks", "catalogue.json", "catalogue.lock", "content"]);
});

test("stored reservation request inventory accepts 64 identities and refuses 65 before recovery writes", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const progress = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  progress.attempts[0].requestIds = ["start-1", ...Array.from({ length: 63 }, (_, index) => `stored-retry-${index}`)];
  await f.write("progress.json", progress, f.paths.root);
  const allowedBefore = await treeState(f.systemRoot);
  assert.equal((await f.state.readState({ actor: f.actor })).progress.attempts[0].requestIds.length, 64);
  assert.deepEqual(await treeState(f.systemRoot), allowedBefore);

  progress.attempts[0].requestIds.push("stored-over-limit");
  await f.write("progress.json", progress, f.paths.root);
  const before = await treeState(f.systemRoot);
  const invalid = error => error.code === "VIBE64_TRAINING_STATE_INVALID" && /Expected at most 64 items/u.test(JSON.stringify(error.cause?.fieldErrors));
  await assert.rejects(() => f.state.readState({ actor: f.actor }), invalid);
  await assert.rejects(() => f.reserve(), invalid);
  await assert.rejects(() => f.state.resumeAttempt({ actor: f.actor, attemptId: reserved.attempt.attemptId }), invalid);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("stored attempt inventory refuses a second individually valid reservation before any writes", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const progress = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  const attemptId = randomUUID();
  progress.attempts.push({
    ...progress.attempts[0],
    attemptId,
    requestIds: ["independent-stored-request"],
    projectSlug: `training-${attemptId.replaceAll("-", "")}`
  });
  await f.write("progress.json", progress, f.paths.root);
  const before = await treeState(f.systemRoot);
  const invalid = error => error.code === "VIBE64_TRAINING_STATE_INVALID" && /exactly one active attempt/u.test(error.cause?.message);
  await assert.rejects(() => f.state.readState({ actor: f.actor }), invalid);
  await assert.rejects(() => f.reserve(), invalid);
  await assert.rejects(() => f.state.resumeAttempt({ actor: f.actor, attemptId: reserved.attempt.attemptId }), invalid);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("stored catalogue accepts 16 exact course releases and refuses 17 before enablement writes", async t => {
  const f = await fixture(t);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  const input = await catalogueInputs(f);
  await catalogue.enableCourse({ ...input, expectedRevision: 0 });
  const filename = path.join(f.systemRoot, "training/catalogue.json");
  const courses = Array.from({ length: 17 }, (_, index) => ({
    course: { ...input.course, courseId: `stored-course-${index}` },
    lock: { ...input.lock, courseId: `stored-course-${index}` },
    enabled: false
  }));
  await fs.writeFile(filename, JSON.stringify({ schemaVersion: 1, revision: 16, courses: courses.slice(0, 16) }));
  const allowedBefore = await treeState(f.systemRoot);
  assert.equal((await catalogue.readCatalogue()).courses.length, 16);
  assert.deepEqual(await treeState(f.systemRoot), allowedBefore);

  await fs.writeFile(filename, JSON.stringify({ schemaVersion: 1, revision: 17, courses }));
  const before = await treeState(f.systemRoot);
  const invalid = error => error.code === "VIBE64_TRAINING_CATALOGUE_INVALID" && /Expected at most 16 items/u.test(JSON.stringify(error.cause?.fieldErrors));
  await assert.rejects(() => catalogue.readCatalogue(), invalid);
  await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 17 }), invalid);
  await assert.rejects(() => catalogue.disableCourse({ courseId: courses[0].course.courseId, release: courses[0].course.release, expectedRevision: 17 }), invalid);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("preparation explicitly preserves untouched reserved records and saves one exact initial session before effects", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const original = await treeState(f.systemRoot);
  assert.deepEqual((await f.state.readState({ actor: f.actor })).active.preparation, { phase: "reserved" });
  assert.deepEqual(await treeState(f.systemRoot), original);
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, expectedRevision: 1 };
  const prepared = await f.state.beginPreparation(input);
  assert.equal(prepared.revision, 2);
  assert.equal(prepared.replayed, false);
  assert.deepEqual(prepared.attempt.preparation, { phase: "preparing", initialSessionId: `training-${reserved.attempt.attemptId}` });
  assert.deepEqual(prepared.active.preparation, prepared.attempt.preparation);
  assert.deepEqual({ ...prepared.attempt, preparation: reserved.attempt.preparation }, reserved.attempt);
  const fresh = createTrainingLearnerState({ systemRoot: f.systemRoot });
  assert.deepEqual((await fresh.resumeAttempt({ actor: f.actor, attemptId: reserved.attempt.attemptId })).attempt, prepared.attempt);
  const beforeReplay = await treeState(f.systemRoot);
  assert.deepEqual(await fresh.beginPreparation(input), { ...prepared, replayed: true });
  assert.deepEqual(await treeState(f.systemRoot), beforeReplay);
  assert.deepEqual((await fs.readdir(f.systemRoot)).sort(), ["training"]);
  assert.deepEqual((await fs.readdir(path.join(f.systemRoot, "training"))).sort(), [".install-locks", "content", "users"]);
});

test("preparation records bounded failures and observed readiness without changing retry identity or overriding newer observations", async t => {
  const f = await fixture(t);
  const reservation = await f.reserve();
  const attemptId = reservation.attempt.attemptId;
  const initialSessionId = `training-${attemptId}`;
  const input = { actor: f.actor, attemptId, initialSessionId, expectedRevision: 1 };
  await assert.rejects(() => f.state.recordPreparationReady(input), error => error.code === "VIBE64_TRAINING_PREPARATION_CONFLICT");
  const begun = await f.state.beginPreparation(input);
  const failedInput = { ...input, expectedRevision: begun.revision, stage: "setup", code: "fixture_setup_failed", message: "Setup failed. Retry the existing session." };
  const failed = await f.state.recordPreparationFailure(failedInput);
  assert.equal(failed.revision, 3);
  assert.deepEqual(failed.attempt.preparation, { phase: "preparing", initialSessionId, failure: { stage: failedInput.stage, code: failedInput.code, message: failedInput.message } });
  const failureTree = await treeState(f.systemRoot);
  assert.deepEqual(await f.state.recordPreparationFailure(failedInput), { ...failed, replayed: true });
  assert.deepEqual(await f.state.beginPreparation(input), { ...failed, replayed: true });
  assert.deepEqual(await treeState(f.systemRoot), failureTree);
  await assert.rejects(() => f.state.recordPreparationReady({ ...input, expectedRevision: 2 }), error => error.code === "VIBE64_TRAINING_STATE_REVISION_CONFLICT");
  const readyInput = { ...input, expectedRevision: 3 };
  const ready = await f.state.recordPreparationReady(readyInput);
  assert.equal(ready.revision, 4);
  assert.equal(ready.attempt.preparation.phase, "ready");
  assert.equal(ready.attempt.preparation.initialSessionId, initialSessionId);
  assert.equal(new Date(ready.attempt.preparation.observedAt).toISOString(), ready.attempt.preparation.observedAt);
  assert.equal(Object.hasOwn(ready.attempt.preparation, "failure"), false);
  const readyTree = await treeState(f.systemRoot);
  assert.deepEqual(await f.state.recordPreparationReady(readyInput), { ...ready, replayed: true });
  assert.deepEqual(await f.state.beginPreparation(input), { ...ready, replayed: true });
  assert.deepEqual(await treeState(f.systemRoot), readyTree);
  const unavailable = await f.state.recordPreparationFailure({ ...failedInput, expectedRevision: 4, stage: "project", code: "fixture_project_missing", message: "The associated project is missing. Ask the owner to inspect it." });
  assert.equal(unavailable.revision, 5);
  assert.equal(unavailable.attempt.preparation.phase, "preparing");
  assert.equal(Object.hasOwn(unavailable.attempt.preparation, "observedAt"), false);
  const beforeLate = await treeState(f.systemRoot);
  await assert.rejects(() => f.state.recordPreparationReady(readyInput), error => error.code === "VIBE64_TRAINING_STATE_REVISION_CONFLICT");
  await assert.rejects(() => f.state.recordPreparationFailure(failedInput), error => error.code === "VIBE64_TRAINING_STATE_REVISION_CONFLICT");
  assert.deepEqual(await treeState(f.systemRoot), beforeLate);
});

test("preparation rejects wrong actor, attempt, session, revision and unsafe failure reports before writes", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, expectedRevision: 1 };
  const initialSessionId = `training-${input.attemptId}`;
  const before = await treeState(f.systemRoot);
  for (const extra of [{ actor: {} }, { actor: { uid: 7 } }, { attemptId: randomUUID() }, { attemptId: "../session" }, { expectedRevision: -1 }, { expectedRevision: 0 }]) {
    await assert.rejects(() => f.state.beginPreparation({ ...input, ...extra }));
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
  await f.state.beginPreparation(input);
  const preparingTree = await treeState(f.systemRoot);
  for (const session of [undefined, "../session", `training-${randomUUID()}`, `${initialSessionId} `]) {
    await assert.rejects(() => f.state.recordPreparationReady({ ...input, expectedRevision: 2, initialSessionId: session }));
    assert.deepEqual(await treeState(f.systemRoot), preparingTree);
  }
  const failure = { ...input, initialSessionId, expectedRevision: 2, stage: "setup", code: "setup_failed", message: "Retry setup." };
  for (const extra of [{ stage: "grading" }, { code: "../secret" }, { code: "x".repeat(65) }, { message: "x".repeat(513) }, { message: " two spaces " }, { message: "Raw output\nMore output" }]) {
    await assert.rejects(() => f.state.recordPreparationFailure({ ...failure, ...extra }));
    assert.deepEqual(await treeState(f.systemRoot), preparingTree);
  }
  const snapshot = path.join(f.systemRoot, "training/content", f.pin.topic.topicId, f.pin.topic.commit);
  await fs.rename(snapshot, `${snapshot}.missing`);
  try {
    const missingTree = await treeState(f.systemRoot);
    await assert.rejects(() => f.state.beginPreparation(input), /Pinned teaching content .* is missing/u);
    await assert.rejects(() => f.state.recordPreparationReady({ ...input, expectedRevision: 2, initialSessionId }), /Pinned teaching content .* is missing/u);
    assert.deepEqual(await treeState(f.systemRoot), missingTree);
  } finally {
    await fs.rename(`${snapshot}.missing`, snapshot);
  }
});

test("interrupted preparation summary publication preserves progress and explicitly reconciles a valid predecessor", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, expectedRevision: 1 };
  const realRename = fs.rename;
  const renameMock = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === f.paths.active) throw Object.assign(new Error("Fixture preparation summary failure"), { code: "EIO" });
    return realRename(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => f.state.beginPreparation(input), error => error.code === "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED" && error.reservationSaved === true && error.attemptId === input.attemptId && error.revision === 2);
  } finally {
    renameMock.mock.restore();
    syncBuiltinESMExports();
  }
  const beforeRead = await treeState(f.systemRoot);
  const state = await f.state.readState({ actor: f.actor });
  assert.equal(state.revision, 2);
  assert.equal(state.activeSummaryCurrent, false);
  assert.equal(state.active.preparation.initialSessionId, `training-${input.attemptId}`);
  assert.deepEqual(await treeState(f.systemRoot), beforeRead);
  const recovered = await f.state.beginPreparation(input);
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.revision, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(f.paths.active, "utf8")), recovered.active);
});

test("preparation progress failures before and after rename retain one identity and truthful unconfirmed status", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, expectedRevision: 1 };
  const realRename = fs.rename;
  const renameMock = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === f.paths.progress) throw Object.assign(new Error("Fixture preparation progress failure"), { code: "EIO" });
    return realRename(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => f.state.beginPreparation(input), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED" && !error.reservationSaved);
  } finally {
    renameMock.mock.restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual((await f.state.readState({ actor: f.actor })).active.preparation, { phase: "reserved" });
  const realRemove = fs.rm;
  let interrupted = false;
  const removeMock = t.mock.method(fs, "rm", async (...args) => {
    if (!interrupted && String(args[0]).startsWith(path.join(f.paths.root, ".progress.json."))) {
      interrupted = true;
      throw Object.assign(new Error("Fixture preparation cleanup failure after rename"), { code: "EIO" });
    }
    return realRemove(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => f.state.beginPreparation(input), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED" && !error.reservationSaved && /may already have succeeded/u.test(error.message));
  } finally {
    removeMock.mock.restore();
    syncBuiltinESMExports();
  }
  const state = await f.state.readState({ actor: f.actor });
  assert.equal(state.revision, 2);
  assert.equal(state.activeSummaryCurrent, false);
  const retry = await f.state.beginPreparation(input);
  assert.equal(retry.replayed, true);
  assert.equal(retry.attempt.preparation.initialSessionId, `training-${input.attemptId}`);
  assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, true);
});

test("preparation refuses malformed records and newer or incompatible summaries without changing files", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, expectedRevision: 1 };
  const reservedProgress = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  const initialSessionId = `training-${input.attemptId}`;
  for (const preparation of [
    { phase: "reserved", initialSessionId },
    { phase: "preparing" },
    { phase: "preparing", initialSessionId: `training-${randomUUID()}` },
    { phase: "ready", initialSessionId },
    { phase: "ready", initialSessionId, observedAt: "not-a-date" },
    { phase: "ready", initialSessionId, observedAt: new Date().toISOString(), failure: { stage: "setup", code: "failed", message: "Retry." } },
    { phase: "preparing", initialSessionId, observedAt: new Date().toISOString() }
  ]) {
    await f.write("progress.json", { ...reservedProgress, attempts: [{ ...reservedProgress.attempts[0], preparation }] }, f.paths.root);
    const before = await treeState(f.systemRoot);
    await assert.rejects(() => f.state.readState({ actor: f.actor }), error => error.code === "VIBE64_TRAINING_STATE_INVALID");
    await assert.rejects(() => f.state.beginPreparation(input), error => error.code === "VIBE64_TRAINING_STATE_INVALID");
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
  await f.write("progress.json", reservedProgress, f.paths.root);
  const preparing = await f.state.beginPreparation(input);
  const originalSummary = preparing.active;
  for (const summary of [
    { ...originalSummary, progressRevision: 1, preparation: { phase: "ready", initialSessionId, observedAt: new Date().toISOString() } },
    { ...originalSummary, progressRevision: 1, preparation: { phase: "preparing", initialSessionId, failure: { stage: "setup", code: "failed", message: "Retry." } } },
    { ...originalSummary, progressRevision: 1, preparation: { phase: "preparing", initialSessionId: `training-${randomUUID()}` } },
    { ...originalSummary, progressRevision: 3 },
    { ...originalSummary, preparation: { phase: "reserved" } }
  ]) {
    await f.write("active-lesson.json", summary, f.paths.root);
    const before = await treeState(f.systemRoot);
    await assert.rejects(() => f.state.readState({ actor: f.actor }), error => error.code === "VIBE64_TRAINING_STATE_INVALID");
    await assert.rejects(() => f.state.resumeAttempt({ actor: f.actor, attemptId: input.attemptId }), error => error.code === "VIBE64_TRAINING_STATE_INVALID");
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
  await f.write("active-lesson.json", originalSummary, f.paths.root);
  const ready = await f.state.recordPreparationReady({ ...input, initialSessionId, expectedRevision: 2 });
  await f.write("active-lesson.json", originalSummary, f.paths.root);
  const staleBefore = await treeState(f.systemRoot);
  assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, false);
  assert.deepEqual(await treeState(f.systemRoot), staleBefore);
  assert.deepEqual((await f.state.resumeAttempt({ actor: f.actor, attemptId: input.attemptId })).active, ready.active);
  const pending = await f.state.recordPreparationFailure({ ...input, initialSessionId, expectedRevision: 3, stage: "setup", code: "setup_stopped", message: "Setup is unavailable. Retry it." });
  await f.write("active-lesson.json", ready.active, f.paths.root);
  assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, false);
  assert.deepEqual((await f.state.resumeAttempt({ actor: f.actor, attemptId: input.attemptId })).active, pending.active);
});

test("preparation uses the persistent cross-process user lock and refuses revision overflow", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, expectedRevision: 1 };
  const inode = (await fs.lstat(f.paths.lock)).ino;
  const release = await tryAcquireExclusiveFileLock(f.paths.lock);
  const before = await treeState(f.systemRoot);
  try {
    const script = 'import { createTrainingLearnerState } from "@local/vibe64-training/server/learner-state";\nconst state = createTrainingLearnerState({systemRoot:process.env.FIXTURE_SYSTEM_ROOT});\ntry { await state.beginPreparation({actor:{uid:42},attemptId:process.env.FIXTURE_ATTEMPT_ID,expectedRevision:1}); process.exitCode=2; } catch(error) { if(error.code !== "VIBE64_TRAINING_STATE_BUSY" || error.statusCode !== 409) throw error; }\n';
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { ...process.env, FIXTURE_SYSTEM_ROOT: f.systemRoot, FIXTURE_ATTEMPT_ID: input.attemptId } });
    await assert.rejects(() => f.state.beginPreparation(input), error => error.code === "VIBE64_TRAINING_STATE_BUSY");
    assert.deepEqual(await treeState(f.systemRoot), before);
  } finally {
    await release();
  }
  assert.equal((await fs.lstat(f.paths.lock)).ino, inode);
  const progress = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  progress.revision = Number.MAX_SAFE_INTEGER;
  await f.write("progress.json", progress, f.paths.root);
  const overflowBefore = await treeState(f.systemRoot);
  await assert.rejects(() => f.state.beginPreparation({ ...input, expectedRevision: Number.MAX_SAFE_INTEGER }), /revision limit/u);
  assert.deepEqual(await treeState(f.systemRoot), overflowBefore);
});

test("preparation recovers newer ready progress after the wall clock moves backward and summaries fail", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, expectedRevision: 1 };
  const begun = await f.state.beginPreparation(input);
  const initialSessionId = begun.attempt.preparation.initialSessionId;
  const RealDate = globalThis.Date;
  let observationTime = "2031-10-06T10:00:00.000Z";
  // Simulate only the admitted caller's recorded observation time; this does not
  // establish live application readiness or run any project/session effects.
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [observationTime]));
    }
  };
  let renameMock;
  try {
    const firstReady = await f.state.recordPreparationReady({ ...input, initialSessionId, expectedRevision: 2 });
    assert.equal(firstReady.attempt.preparation.observedAt, observationTime);
    const realRename = fs.rename;
    renameMock = t.mock.method(fs, "rename", async (...args) => {
      if (args[1] === f.paths.active) {
        throw Object.assign(new Error("Fixture summary unavailable through failure and recovery"), { code: "EIO" });
      }
      return realRename(...args);
    });
    syncBuiltinESMExports();
    await assert.rejects(() => f.state.recordPreparationFailure({ ...input, initialSessionId, expectedRevision: 3,
      stage: "setup", code: "setup_stopped", message: "Setup stopped. Retry the existing session." }),
    error => error.code === "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED" && error.reservationSaved === true && error.revision === 4);
    observationTime = "2030-10-06T10:00:00.000Z";
    await assert.rejects(() => f.state.recordPreparationReady({ ...input, initialSessionId, expectedRevision: 4 }),
      error => error.code === "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED" && error.reservationSaved === true && error.revision === 5);
    assert.deepEqual(JSON.parse(await fs.readFile(f.paths.active, "utf8")), firstReady.active);
  } finally {
    globalThis.Date = RealDate;
    if (renameMock) {
      renameMock.mock.restore();
      syncBuiltinESMExports();
    }
  }
  const beforeRead = await treeState(f.systemRoot);
  const fresh = createTrainingLearnerState({ systemRoot: f.systemRoot });
  const state = await fresh.readState({ actor: f.actor });
  assert.equal(state.revision, 5);
  assert.equal(state.activeSummaryCurrent, false);
  assert.deepEqual(state.active.preparation, { phase: "ready", initialSessionId, observedAt: "2030-10-06T10:00:00.000Z" });
  assert.deepEqual(await treeState(f.systemRoot), beforeRead);
  const resumed = await fresh.resumeAttempt({ actor: f.actor, attemptId: input.attemptId });
  assert.equal(resumed.revision, 5);
  assert.equal(resumed.attempt.attemptId, input.attemptId);
  assert.equal(resumed.attempt.projectSlug, reserved.attempt.projectSlug);
  assert.deepEqual(resumed.attempt.pin, reserved.attempt.pin);
  assert.deepEqual(resumed.active, state.active);
  assert.deepEqual(JSON.parse(await fs.readFile(f.paths.active, "utf8")), resumed.active);
  assert.equal((await fresh.readState({ actor: f.actor })).activeSummaryCurrent, true);
});

test("preparation recovery rejects impossible one-revision predecessors and accepts actual two-revision transitions", async t => {
  for (const transition of ["reserved-ready", "reserved-failure", "ready-ready"]) {
    const f = await fixture(t);
    const reserved = await f.reserve();
    const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, expectedRevision: 1 };
    const begun = await f.state.beginPreparation(input);
    const initialSessionId = begun.attempt.preparation.initialSessionId;
    let predecessor = reserved.active;
    let current;
    const failureInput = { ...input, initialSessionId, stage: "setup", code: "setup_stopped", message: "Retry the existing session." };
    if (transition === "reserved-failure") {
      current = await f.state.recordPreparationFailure({ ...failureInput, expectedRevision: 2 });
    } else if (transition === "reserved-ready") {
      current = await f.state.recordPreparationReady({ ...input, initialSessionId, expectedRevision: 2 });
    } else {
      const RealDate = globalThis.Date;
      let observationTime = "2031-10-06T10:00:00.000Z";
      // Simulate observation times only, without claiming a live app is ready.
      globalThis.Date = class extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [observationTime]));
        }
      };
      try {
        const firstReady = await f.state.recordPreparationReady({ ...input, initialSessionId, expectedRevision: 2 });
        predecessor = firstReady.active;
        await f.state.recordPreparationFailure({ ...failureInput, expectedRevision: 3 });
        observationTime = "2030-10-06T10:00:00.000Z";
        current = await f.state.recordPreparationReady({ ...input, initialSessionId, expectedRevision: 4 });
        assert.notEqual(current.active.preparation.observedAt, predecessor.preparation.observedAt);
      } finally {
        globalThis.Date = RealDate;
      }
    }
    assert.equal(current.revision - predecessor.progressRevision, 2, transition);
    await f.write("active-lesson.json", { ...predecessor, progressRevision: current.revision - 1 }, f.paths.root);
    const impossibleBefore = await treeState(f.systemRoot);
    await assert.rejects(() => f.state.readState({ actor: f.actor }),
      error => error.code === "VIBE64_TRAINING_STATE_INVALID", transition);
    await assert.rejects(() => f.state.resumeAttempt({ actor: f.actor, attemptId: input.attemptId }),
      error => error.code === "VIBE64_TRAINING_STATE_INVALID", transition);
    assert.deepEqual(await treeState(f.systemRoot), impossibleBefore, transition);

    await f.write("active-lesson.json", predecessor, f.paths.root);
    const genuineBefore = await treeState(f.systemRoot);
    const recovered = await f.state.readState({ actor: f.actor });
    assert.equal(recovered.activeSummaryCurrent, false, transition);
    assert.equal(recovered.revision, current.revision, transition);
    assert.deepEqual(recovered.active, current.active, transition);
    assert.deepEqual(await treeState(f.systemRoot), genuineBefore, transition);
    const resumed = await f.state.resumeAttempt({ actor: f.actor, attemptId: input.attemptId });
    assert.deepEqual(resumed.active, current.active, transition);
    assert.deepEqual(JSON.parse(await fs.readFile(f.paths.active, "utf8")), current.active, transition);
    assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, true, transition);
    if (transition === "ready-ready") {
      const alias = await f.reserve({ requestId: "ready-alias", expectedRevision: current.revision });
      assert.equal(alias.revision - current.revision, 1);
      assert.deepEqual(alias.active.preparation, current.active.preparation);
      await f.write("active-lesson.json", current.active, f.paths.root);
      const aliasBefore = await treeState(f.systemRoot);
      const aliasRead = await f.state.readState({ actor: f.actor });
      assert.equal(aliasRead.activeSummaryCurrent, false);
      assert.deepEqual(aliasRead.active, alias.active);
      assert.deepEqual(await treeState(f.systemRoot), aliasBefore);
      assert.deepEqual((await f.state.resumeAttempt({ actor: f.actor, attemptId: input.attemptId })).active, alias.active);
    }
  }
});

test("preparation exclusion admits only a saved exact actor-owned attempt and pin before creating its lock", async t => {
  const f = await fixture(t);
  let called = false;
  const operation = () => { called = true; };
  const absentBefore = await treeState(f.systemRoot);
  await assert.rejects(() => f.state.runPreparationExclusive({ actor: f.actor, attemptId: randomUUID() }, operation),
    error => error.code === "VIBE64_TRAINING_ATTEMPT_MISSING" && error.statusCode === 404);
  assert.deepEqual(await treeState(f.systemRoot), absentBefore);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId };
  const before = await treeState(f.systemRoot);
  for (const change of [{ actor: {} }, { actor: { uid: 43 } }, { attemptId: randomUUID() }, { attemptId: "../attempt" }]) {
    await assert.rejects(() => f.state.runPreparationExclusive({ ...input, ...change }, operation));
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
  await assert.rejects(() => f.state.runPreparationExclusive(input, null), /admitted server operation/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
  assert.equal(called, false);
  await assert.rejects(() => fs.lstat(path.join(f.paths.root, "preparation.lock")), { code: "ENOENT" });
  const snapshot = path.join(f.systemRoot, "training/content", f.pin.topic.topicId, f.pin.topic.commit);
  await fs.rename(snapshot, `${snapshot}-retained`);
  try {
    const missingBefore = await treeState(f.systemRoot);
    await assert.rejects(() => f.state.runPreparationExclusive(input, operation),
      error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
    assert.deepEqual(await treeState(f.systemRoot), missingBefore);
    assert.equal(called, false);
  } finally {
    await fs.rename(`${snapshot}-retained`, snapshot);
  }
  const exerciseFile = path.join(snapshot, "files/training/exercises/app/server.mjs");
  const savedBytes = await fs.readFile(exerciseFile);
  await fs.writeFile(exerciseFile, "Changed installed exercise bytes");
  try {
    const corruptBefore = await treeState(f.systemRoot);
    await assert.rejects(() => f.state.runPreparationExclusive(input, operation),
      error => error.code === "VIBE64_TRAINING_CONTENT_INVALID");
    assert.deepEqual(await treeState(f.systemRoot), corruptBefore);
    assert.equal(called, false);
  } finally {
    await fs.writeFile(exerciseFile, savedBytes);
  }
});

test("preparation exclusion spans an operation while original typed state writes and read-only projections remain usable", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId };
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const holder = f.state.runPreparationExclusive(input, async () => {
    const resumed = await f.state.resumeAttempt(input);
    const begun = await f.state.beginPreparation({ ...input, expectedRevision: resumed.revision });
    entered.resolve(begun);
    await finish.promise;
    const failed = await f.state.recordPreparationFailure({ ...input,
      initialSessionId: begun.attempt.preparation.initialSessionId, expectedRevision: begun.revision,
      stage: "setup", code: "observed_failure", message: "Retry the same setup." });
    return f.state.recordPreparationReady({ ...input,
      initialSessionId: begun.attempt.preparation.initialSessionId, expectedRevision: failed.revision });
  });
  let result;
  try {
    const begun = await Promise.race([entered.promise, holder]);
    assert.equal(begun.attempt.preparation.initialSessionId, `training-${input.attemptId}`);
    const beforeRead = await treeState(f.systemRoot);
    assert.deepEqual((await f.state.readState({ actor: f.actor })).active, begun.active);
    assert.deepEqual(await treeState(f.systemRoot), beforeRead);
    assert.deepEqual((await f.state.resumeAttempt(input)).attempt, begun.attempt);
  } finally {
    finish.resolve();
    result = await holder;
  }
  assert.equal(result.revision, 4);
  assert.equal(result.attempt.preparation.phase, "ready");
  assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, true);
  assert.deepEqual((await fs.readdir(f.paths.root)).sort(), ["active-lesson.json", "preparation.lock", "progress.json", "state.lock"]);
});

test("preparation exclusion uses a persistent cross-process lock without serializing different learners", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const otherActor = { uid: 43 };
  const other = await f.reserve({ actor: otherActor });
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId };
  const otherInput = { actor: otherActor, attemptId: other.attempt.attemptId };
  const fresh = createTrainingLearnerState({ systemRoot: f.systemRoot });
  await f.state.runPreparationExclusive(input, () => null);
  await f.state.runPreparationExclusive(otherInput, () => null);
  const lock = path.join(f.paths.root, "preparation.lock");
  const inode = (await fs.lstat(lock)).ino;
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const holder = f.state.runPreparationExclusive(input, async () => {
    entered.resolve();
    await finish.promise;
    return "held result";
  });
  try {
    await Promise.race([entered.promise, holder]);
    const before = await treeState(f.systemRoot);
    const script = 'import { createTrainingLearnerState } from "@local/vibe64-training/server/learner-state";\nconst state=createTrainingLearnerState({systemRoot:process.env.FIXTURE_SYSTEM_ROOT});\ntry { await state.runPreparationExclusive({actor:{uid:42},attemptId:process.env.FIXTURE_ATTEMPT_ID},()=>{throw new Error("Competing preparation entered.");}); process.exitCode=2; } catch(error) { if(error.code!=="VIBE64_TRAINING_PREPARATION_BUSY" || error.statusCode!==409) throw error; }\n';
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, FIXTURE_SYSTEM_ROOT: f.systemRoot, FIXTURE_ATTEMPT_ID: input.attemptId }
    });
    let competingCalled = false;
    await assert.rejects(() => fresh.runPreparationExclusive(input, () => { competingCalled = true; }),
      error => error.code === "VIBE64_TRAINING_PREPARATION_BUSY" && error.statusCode === 409);
    assert.equal(competingCalled, false);
    assert.equal(await fresh.runPreparationExclusive(otherInput, () => "other learner"), "other learner");
    assert.deepEqual(await treeState(f.systemRoot), before);
  } finally {
    finish.resolve();
    assert.equal(await holder, "held result");
  }
  assert.equal(await fresh.runPreparationExclusive(input, () => "retry"), "retry");
  assert.equal((await fs.lstat(lock)).ino, inode);
});

test("preparation exclusion preserves callback results and errors and releases after nested or short-state contention", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId };
  const original = await f.state.readState({ actor: f.actor });
  const observedError = new Error("Original owner effect failed.");
  await assert.rejects(() => f.state.runPreparationExclusive(input, () => { throw observedError; }),
    error => error === observedError);
  assert.deepEqual(await f.state.readState({ actor: f.actor }), original);
  const inode = (await fs.lstat(path.join(f.paths.root, "preparation.lock"))).ino;
  const value = { existingOwnerResult: true };
  assert.equal(await f.state.runPreparationExclusive(input, async () => {
    await assert.rejects(() => f.state.runPreparationExclusive(input, () => null),
      error => error.code === "VIBE64_TRAINING_PREPARATION_BUSY" && error.statusCode === 409);
    return value;
  }), value);
  const release = await tryAcquireExclusiveFileLock(f.paths.lock);
  try {
    await assert.rejects(() => f.state.runPreparationExclusive(input, () => f.state.beginPreparation({ ...input, expectedRevision: 1 })),
      error => error.code === "VIBE64_TRAINING_STATE_BUSY" && error.statusCode === 409);
    assert.deepEqual(await f.state.readState({ actor: f.actor }), original);
  } finally {
    await release();
  }
  const begun = await f.state.runPreparationExclusive(input,
    () => f.state.beginPreparation({ ...input, expectedRevision: 1 }));
  assert.equal(begun.attempt.preparation.initialSessionId, `training-${input.attemptId}`);
  assert.equal((await fs.lstat(path.join(f.paths.root, "preparation.lock"))).ino, inode);
});

test("optional preparation lock evidence is validated without read-time creation, alias repair or callback effects", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId };
  const lock = path.join(f.paths.root, "preparation.lock");
  const before = await treeState(f.systemRoot);
  await f.state.readState({ actor: f.actor });
  assert.deepEqual(await treeState(f.systemRoot), before);
  await assert.rejects(() => fs.lstat(lock), { code: "ENOENT" });
  await f.state.runPreparationExclusive(input, () => null);
  for (const kind of ["symlink", "directory", "hardlink", "data"]) {
    const retained = `${lock}-retained`;
    if (kind === "symlink" || kind === "directory") {
      await fs.rename(lock, retained);
      if (kind === "symlink") await fs.symlink(path.basename(retained), lock);
      else await fs.mkdir(lock);
    } else if (kind === "hardlink") {
      await fs.link(lock, retained);
    } else {
      await fs.writeFile(lock, "Unexplained preparation lock evidence");
    }
    try {
      const invalidBefore = await treeState(f.systemRoot);
      let called = false;
      await assert.rejects(() => f.state.readState({ actor: f.actor }), error => error.code === "VIBE64_TRAINING_STATE_INVALID");
      await assert.rejects(() => f.state.runPreparationExclusive(input, () => { called = true; }),
        error => error.code === "VIBE64_TRAINING_STATE_INVALID");
      assert.equal(called, false);
      assert.deepEqual(await treeState(f.systemRoot), invalidBefore);
    } finally {
      if (kind === "symlink" || kind === "directory") {
        await fs.rm(lock, { recursive: true });
        await fs.rename(retained, lock);
      } else if (kind === "hardlink") {
        await fs.rm(retained);
      } else {
        await fs.writeFile(lock, "");
      }
    }
  }
  const retryBefore = await treeState(f.systemRoot);
  await f.state.runPreparationExclusive(input, () => null);
  assert.deepEqual(await treeState(f.systemRoot), retryBefore);
});

test("documented stopped-writer procedure detects real preparation lock contention between state writes", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId };
  await f.state.runPreparationExclusive(input, () => null);
  const procedure = await recoveryProcedure(f);
  const checkpoint = await procedure.copy();
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const holder = f.state.runPreparationExclusive(input, async () => {
    entered.resolve();
    await finish.promise;
  });
  try {
    await Promise.race([entered.promise, holder]);
    const before = await treeState(f.systemRoot);
    const backupsBefore = await treeState(procedure.backupRoot);
    await assert.rejects(() => procedure.copy());
    await assert.rejects(() => procedure.restore(checkpoint));
    assert.deepEqual(await treeState(f.systemRoot), before);
    assert.deepEqual(await treeState(procedure.backupRoot), backupsBefore);
  } finally {
    finish.resolve();
    await holder;
  }
  const result = await procedure.run([procedure.setup, procedure.stage, procedure.validate], { checkpoint });
  assert.match(result.stdout, /Reservation records and installed pins validated/u);
});

async function learningFixture(t) {
  const f = await fixture(t, { learning: true });
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  await f.state.beginPreparation({ actor: f.actor, attemptId, expectedRevision: 1 });
  await f.state.recordPreparationReady({ actor: f.actor, attemptId, initialSessionId: `training-${attemptId}`, expectedRevision: 2 });
  const checkpoint = (question, overrides = {}) => ({ stage: "practice", pendingQuestion: question
    ? { id: `question-${question}`, assessmentId: question, text: "What did you observe?" } : null,
    visuals: [{ visualId: "request", snapshot: { state: "arrived", paused: true, labels: { path: "/" } } }],
    summary: "The learner reached the request diagram.", ...overrides });
  const save = async (requestId, question, overrides = {}) => f.state.saveLessonResume({ actor: f.actor, attemptId,
    expectedRevision: (await f.state.readState({ actor: f.actor })).revision, requestId, resume: checkpoint(question, overrides) });
  const answer = (assessmentId, submissionId, overrides = {}) => ({ actor: f.actor, attemptId, expectedRevision: 0,
    submissionId, assessmentId, outcome: "passed", assistance: "none", explanation: "The actual answer satisfies the declared rubric.",
    evidence: { kind: "answer", learnerId: "42", attemptId, messageId: `message-${submissionId}`,
      questionId: `question-${assessmentId}`, text: "The browser asks and displays the server's response." }, ...overrides });
  const observation = (producer, submissionId, overrides = {}) => ({ actor: f.actor, attemptId, expectedRevision: 0,
    submissionId, assessmentId: `${producer}-practice`, outcome: "passed", assistance: "hint", explanation: "The native observation satisfies the rubric.",
    evidence: { kind: "observation", learnerId: "42", attemptId, observationId: `observation-${submissionId}`,
      observedAt: "2026-10-06T01:00:00.000Z", projectSlug: reserved.attempt.projectSlug, sessionId: `training-${attemptId}`,
      producer, operation: `${producer}-practice`, origin: "learner", text: "I followed the request and inspected its response.",
      ...(producer === "exercise" ? { check: "response" } : {}) }, ...overrides });
  const record = async input => f.state.recordAssessment({ ...input, expectedRevision: (await f.state.readState({ actor: f.actor })).revision });
  return { ...f, attemptId, checkpoint, save, answer, observation, record };
}

test("question provenance is optional for untouched history and explicit bounded new writes retain it", async t => {
  const f = await learningFixture(t);
  await f.save("legacy-question", "answer-one");
  let state = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.equal(Object.hasOwn(state.active.learning.resume.pendingQuestion, "assistance"), false);
  assert.equal(Object.hasOwn(state.active.learning.resume.pendingQuestion, "issuedRevision"), false);
  await f.save("legacy-edited", null, { pendingQuestion: {
    ...state.active.learning.resume.pendingQuestion, text: "Updated legacy question" } });
  state = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.equal(state.active.learning.resume.pendingQuestion.text, "Updated legacy question");
  assert.equal(Object.hasOwn(state.active.learning.resume.pendingQuestion, "issuedRevision"), false);
  const question = { id: "issued-question", assessmentId: "answer-one", text: "What did you observe?",
    assistance: "hint", issuedRevision: state.revision + 1 };
  await f.save("issued-question", null, { pendingQuestion: question });
  state = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual(state.active.learning.resume.pendingQuestion, question);
  const before = await treeState(f.systemRoot);
  for (const change of [{ text: "Changed question" }, { assessmentId: "answer-two" }, { assistance: "none" }]) {
    await assert.rejects(f.save("reinterpret-question", null, { pendingQuestion: { ...question, ...change } }),
      { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  }
  await assert.rejects(f.save("invalid-assistance", null, { pendingQuestion: { ...question, assistance: "inferred" } }));
  await assert.rejects(f.save("future-question", null, { pendingQuestion: { ...question, issuedRevision: state.revision + 2 } }));
  assert.deepEqual(await treeState(f.systemRoot), before);
  const replacement = { ...question, text: "Explicit replacement", issuedRevision: state.revision + 1 };
  await f.save("explicit-question-replacement", null, { pendingQuestion: replacement });
  assert.deepEqual((await f.state.readState({ actor: f.actor, includeCompletion: true })).active.learning.resume.pendingQuestion, replacement);
});

test("lesson completion requires all three admitted answers and three learner practical observations at the saved pin", async t => {
  const f = await learningFixture(t);
  assert.deepEqual((await f.state.resumeAttempt({ actor: f.actor, attemptId: f.attemptId })).completion,
    { lessonCode: "INTRO-01", lessonHash: f.pin.lesson.hash, required: 6, passed: 0, completed: false });
  await f.save("question-1", "answer-one");
  const notPassed = await f.record(f.answer("answer-one", "first-answer", { outcome: "not-yet-passed", assistance: "substantial", explanation: "The learner has not distinguished request from response." }));
  assert.equal(notPassed.completion.completed, false);
  assert.equal(notPassed.completion.passed, 0);
  const corrected = await f.record(f.answer("answer-one", "corrected-answer"));
  assert.equal(corrected.completion.passed, 1);
  for (const id of ["answer-two", "answer-three"]) {
    await f.save(`question-${id}`, id);
    await f.record(f.answer(id, `submission-${id}`));
  }
  await f.record(f.observation("workspace", "workspace"));
  await f.record(f.observation("exercise", "exercise"));
  assert.equal((await f.state.resumeAttempt({ actor: f.actor, attemptId: f.attemptId })).completion.completed, false);
  const finished = await f.record(f.observation("colleague", "colleague"));
  assert.equal(finished.completion.completed, true);
  assert.equal(finished.completion.passed, 6);
  assert.equal(finished.attempt.learning.submissions.length, 7);
  assert.equal(finished.attempt.learning.submissions[0].evidence.text, "The browser asks and displays the server's response.");
  assert.equal(finished.attempt.learning.submissions[0].assistance, "substantial");
  assert.equal(finished.attempt.learning.submissions.every(value => value.rubricRevision === f.pin.lesson.hash), true);
  assert.equal(finished.attempt.learning.submissions.every(value => new Date(value.recordedAt).toISOString() === value.recordedAt), true);
  const resumed = await createTrainingLearnerState({ systemRoot: f.systemRoot }).resumeAttempt({ actor: f.actor, attemptId: f.attemptId });
  assert.deepEqual(resumed.attempt, finished.attempt);
  assert.deepEqual(resumed.completion, finished.completion);
  await assert.rejects(() => fs.lstat(path.join(f.systemRoot, "projects")), { code: "ENOENT" });
});

test("resume preserves question, teaching position and semantic snapshots without requiring content for backup validation", async t => {
  const f = await learningFixture(t);
  const saved = await f.save("checkpoint", "answer-one");
  const before = await treeState(f.paths.root);
  assert.deepEqual(await f.state.saveLessonResume({ actor: f.actor, attemptId: f.attemptId, expectedRevision: 0,
    requestId: "checkpoint", resume: f.checkpoint("answer-one") }), { ...saved, replayed: true });
  assert.deepEqual(await treeState(f.paths.root), before);
  await assert.rejects(() => f.save("checkpoint", "answer-two"), { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  await fs.rename(path.join(f.systemRoot, "training/content"), path.join(f.root, "detached-content"));
  const fresh = createTrainingLearnerState({ systemRoot: f.systemRoot });
  const state = await fresh.readState({ actor: f.actor });
  assert.deepEqual(state.active.learning.resume, saved.attempt.learning.resume);
  assert.equal(state.active.learning.resume.pendingQuestion.text, "What did you observe?");
  assert.deepEqual(state.active.learning.resume.visuals[0].snapshot, { state: "arrived", paused: true, labels: { path: "/" } });
  const noWrite = await treeState(f.paths.root);
  await assert.rejects(() => fresh.resumeAttempt({ actor: f.actor, attemptId: f.attemptId }));
  await assert.rejects(() => fresh.recordAssessment(f.answer("answer-one", "missing-content")));
  assert.deepEqual(await treeState(f.paths.root), noWrite);
});

test("assessment replay retains exact immutable evidence and cannot consume one message or observation twice", async t => {
  const f = await learningFixture(t);
  await f.save("question", "answer-one");
  const input = f.answer("answer-one", "answer");
  const result = await f.record(input);
  await f.save("next-question", "answer-two");
  const before = await treeState(f.paths.root);
  const replay = await f.state.recordAssessment(input);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.attempt.learning.submissions[0], result.attempt.learning.submissions[0]);
  assert.deepEqual(await treeState(f.paths.root), before);
  await assert.rejects(() => f.record({ ...input, explanation: "A changed grading reason" }), { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  const reused = f.answer("answer-two", "other-answer");
  reused.evidence.messageId = input.evidence.messageId;
  await assert.rejects(() => f.record(reused), { code: "VIBE64_TRAINING_EVIDENCE_CONFLICT" });
  const observation = f.observation("workspace", "native");
  await f.record(observation);
  const consumed = f.observation("colleague", "other-native");
  consumed.evidence.observationId = observation.evidence.observationId;
  await assert.rejects(() => f.record(consumed), { code: "VIBE64_TRAINING_EVIDENCE_CONFLICT" });
  const alien = { ...input, actor: { uid: 43 } };
  await assert.rejects(() => f.state.recordAssessment(alien), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  assert.equal((await f.state.readState({ actor: { uid: 43 } })).revision, 0);
});

test("practical writes require exact prepared identity and descriptor evidence; demonstration is not a learner pass", async t => {
  const f = await learningFixture(t);
  const good = f.observation("exercise", "practical");
  const before = await treeState(f.paths.root);
  for (const change of [{ learnerId: "43" }, { attemptId: randomUUID() }, { projectSlug: "other" }, { sessionId: "other" },
    { producer: "workspace" }, { operation: "other" }, { check: "other" }, { observedAt: "yesterday" }, { origin: "demonstration" }, { text: "" }]) {
    await assert.rejects(() => f.record({ ...good, evidence: { ...good.evidence, ...change } }));
  }
  await assert.rejects(() => f.record({ ...good, assessmentId: "not-declared" }));
  assert.deepEqual(await treeState(f.paths.root), before);
  const demo = await f.record({ ...good, outcome: "needs-review", assistance: "demonstration", evidence: { ...good.evidence, origin: "demonstration" } });
  assert.equal(demo.completion.passed, 0);
  await f.save("question", "answer-one");
  const answer = f.answer("answer-one", "wrong-question");
  await assert.rejects(() => f.record({ ...answer, evidence: { ...answer.evidence, questionId: "old-question" } }), /actual admitted learner message/u);
  await assert.rejects(() => f.record({ ...answer, evidence: { ...answer.evidence, text: "", messageId: "" } }));
  const other = f.answer("answer-two", "wrong-assessment");
  await assert.rejects(() => f.record(other), /actual admitted learner message/u);
});

test("learning CAS, semantic bounds and immutable saved results reject conflicts without rewriting authority", async t => {
  const f = await learningFixture(t);
  await f.save("question", "answer-one");
  const input = f.answer("answer-one", "result");
  await assert.rejects(() => f.state.recordAssessment(input), { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  const before = await treeState(f.paths.root);
  for (const overrides of [
    { pendingQuestion: { id: "question", assessmentId: "missing", text: "Question" } },
    { visuals: [{ visualId: "missing", snapshot: { state: "arrived", paused: true, labels: {} } }] },
    { visuals: [{ visualId: "request", snapshot: { state: "missing", paused: true, labels: {} } }] },
    { visuals: [{ visualId: "request", snapshot: { state: "arrived", paused: true, labels: {}, extra: true } }] },
    { visuals: [{ visualId: "request", snapshot: { state: "arrived", paused: true, labels: { oversized: "x".repeat(257) } } }] }
  ]) await assert.rejects(() => f.save("invalid-resume", null, overrides));
  assert.deepEqual(await treeState(f.paths.root), before);
  const revision = (await f.state.readState({ actor: f.actor })).revision;
  const results = await Promise.allSettled([
    f.state.recordAssessment({ ...input, expectedRevision: revision }),
    f.state.saveLessonResume({ actor: f.actor, attemptId: f.attemptId, expectedRevision: revision, requestId: "racing", resume: f.checkpoint("answer-two") })
  ]);
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(results.filter(value => value.status === "rejected").length, 1);
  assert.equal((await f.state.readState({ actor: f.actor })).revision, revision + 1);
  const saved = JSON.parse(await fs.readFile(f.paths.progress));
  saved.attempts[0].learning.resume.visuals[0].snapshot.labels.path = "x".repeat(257);
  await fs.writeFile(f.paths.progress, JSON.stringify(saved));
  const corrupt = await treeState(f.paths.root);
  await assert.rejects(() => f.state.readState({ actor: f.actor }), /bounded semantic visual snapshot/u);
  assert.deepEqual(await treeState(f.paths.root), corrupt);
});

test("learning summary failure and ambiguous progress rename recover by same identity without duplicate passes", async t => {
  const f = await learningFixture(t);
  await f.save("question", "answer-one");
  const input = f.answer("answer-one", "result");
  input.expectedRevision = (await f.state.readState({ actor: f.actor })).revision;
  const rename = fs.rename;
  const mock = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === f.paths.active) throw new Error("Summary unavailable");
    return rename(...args);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(() => f.state.recordAssessment(input), { code: "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED" }); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  const before = await treeState(f.paths.root);
  const observed = await f.state.readState({ actor: f.actor });
  assert.equal(observed.activeSummaryCurrent, false);
  assert.equal(observed.active.learning.submissions.length, 1);
  assert.deepEqual(await treeState(f.paths.root), before);
  const retry = await f.state.recordAssessment(input);
  assert.equal(retry.replayed, true);
  assert.equal(retry.completion.passed, 1);
  await f.save("next", "answer-two");
  const second = f.answer("answer-two", "second");
  second.expectedRevision = (await f.state.readState({ actor: f.actor })).revision;
  const remove = fs.rm;
  let interrupted = false;
  const cleanup = t.mock.method(fs, "rm", async (...args) => {
    if (!interrupted && String(args[0]).startsWith(path.join(f.paths.root, ".progress.json."))) {
      interrupted = true;
      throw new Error("Cleanup interrupted after rename");
    }
    return remove(...args);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(() => f.state.recordAssessment(second), { code: "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED" }); }
  finally { cleanup.mock.restore(); syncBuiltinESMExports(); }
  const replay = await f.state.recordAssessment(second);
  assert.equal(replay.replayed, true);
  assert.equal(replay.completion.passed, 2);
  assert.equal(replay.attempt.learning.submissions.length, 2);
  assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, true);
});

test("learning receipt and serialized record limits refuse new writes without dropping prior evidence", async t => {
  for (const boundary of ["receipts", "bytes"]) {
    const f = await learningFixture(t);
    await f.save("question", "answer-one");
    await f.record(f.answer("answer-one", "seed"));
    const progress = JSON.parse(await fs.readFile(f.paths.progress));
    const template = progress.attempts[0].learning.submissions[0];
    progress.attempts[0].learning.submissions = Array.from({ length: boundary === "receipts" ? 64 : 48 }, (_unused, index) => ({
      ...template, submissionId: `saved-${index}`, evidence: { ...template.evidence, messageId: `message-${index}`, text: "x" }
    }));
    if (boundary === "bytes") {
      const results = progress.attempts[0].learning.submissions;
      while (Buffer.byteLength(`${JSON.stringify(progress, null, 2)}\n`) < 64000) {
        const item = results.find(value => value.evidence.text.length < 2048);
        assert.ok(item);
        const remaining = 64000 - Buffer.byteLength(`${JSON.stringify(progress, null, 2)}\n`);
        item.evidence.text += "x".repeat(Math.min(remaining, 2048 - item.evidence.text.length));
      }
    }
    assert.ok(Buffer.byteLength(`${JSON.stringify(progress, null, 2)}\n`) < 65536);
    const active = JSON.parse(await fs.readFile(f.paths.active));
    active.learning = progress.attempts[0].learning;
    await fs.writeFile(f.paths.progress, `${JSON.stringify(progress, null, 2)}\n`);
    await fs.writeFile(f.paths.active, `${JSON.stringify(active, null, 2)}\n`);
    assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, true);
    const before = await treeState(f.paths.root);
    const input = f.answer("answer-one", "overflow", { explanation: "e".repeat(1024) });
    input.evidence.text = "x".repeat(2048);
    await assert.rejects(() => f.record(input), error => boundary === "receipts"
      ? /at most 64 items/u.test(JSON.stringify(error.fieldErrors))
      : /64 KiB record limit/u.test(error.message));
    assert.deepEqual(await treeState(f.paths.root), before);
  }
});

test("opt-in completion reads verify the saved pin without writes while default backup reads remain content-independent", async t => {
  const f = await learningFixture(t);
  for (const id of ["answer-one", "answer-two", "answer-three"]) {
    await f.save(`question-${id}`, id);
    await f.record(f.answer(id, `submission-${id}`));
  }
  for (const producer of ["workspace", "exercise", "colleague"]) await f.record(f.observation(producer, producer));
  const content = path.join(f.systemRoot, "training/content");
  const detached = path.join(f.root, "detached-content");
  await fs.rename(content, detached);
  const before = await treeState(f.systemRoot);
  const state = await f.state.readState({ actor: f.actor });
  assert.equal(Object.hasOwn(state, "completion"), false);
  assert.equal(state.active.learning.submissions.length, 6);
  await assert.rejects(() => f.state.readState({ actor: f.actor, includeCompletion: true }), { code: "VIBE64_TRAINING_CONTENT_MISSING" });
  assert.equal((await f.state.readState({ actor: { uid: 43 }, includeCompletion: true })).completion, null);
  assert.deepEqual(await treeState(f.systemRoot), before);
  await fs.rename(detached, content);
  // Read-only verification must not reconcile even a reachable stale summary.
  await fs.rm(f.paths.active);
  const restored = await treeState(f.systemRoot);
  const verified = await createTrainingLearnerState({ systemRoot: f.systemRoot }).readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual(verified.completion, { lessonCode: "INTRO-01", lessonHash: f.pin.lesson.hash, required: 6, passed: 6, completed: true });
  assert.equal(verified.activeSummaryCurrent, false);
  assert.deepEqual(verified.active.learning, state.active.learning);
  assert.deepEqual(await treeState(f.systemRoot), restored);
});

test("content-aware learning reads and writes refuse tampered pinned receipts and resume facts before summary repair", async t => {
  const f = await learningFixture(t);
  await f.save("question", "answer-one");
  await f.record(f.answer("answer-one", "answer"));
  await f.record(f.observation("exercise", "exercise"));
  const original = JSON.parse(await fs.readFile(f.paths.progress));
  await fs.rm(f.paths.active);
  const changes = [
    progress => { progress.attempts[0].learning.submissions[0].assessmentId = "missing"; },
    progress => { progress.attempts[0].learning.submissions[0].rubric = "lesson.md#different"; },
    progress => { progress.attempts[0].learning.submissions[0].assessmentId = "workspace-practice"; },
    progress => { progress.attempts[0].learning.submissions[1].evidence.producer = "workspace"; },
    progress => { progress.attempts[0].learning.submissions[1].evidence.operation = "other"; },
    progress => { progress.attempts[0].learning.submissions[1].evidence.check = "other"; },
    progress => { progress.attempts[0].learning.resume.pendingQuestion.assessmentId = "missing"; },
    progress => { progress.attempts[0].learning.resume.visuals[0].visualId = "missing"; },
    progress => { progress.attempts[0].learning.resume.visuals[0].snapshot.state = "missing"; }
  ];
  for (const change of changes) {
    const tampered = structuredClone(original);
    change(tampered);
    await fs.writeFile(f.paths.progress, JSON.stringify(tampered));
    const before = await treeState(f.paths.root);
    const structural = await f.state.readState({ actor: f.actor });
    assert.equal(structural.activeSummaryCurrent, false);
    for (const operation of [
      () => f.state.readState({ actor: f.actor, includeCompletion: true }),
      () => f.state.resumeAttempt({ actor: f.actor, attemptId: f.attemptId }),
      () => f.state.recordAssessment(f.observation("workspace", "new-observation"))
    ]) await assert.rejects(operation, /pinned|pending question|semantic state/u);
    assert.deepEqual(await treeState(f.paths.root), before);
  }
  await fs.writeFile(f.paths.progress, JSON.stringify(original));
  await f.save("different-question", "answer-two");
  const revision = (await f.state.readState({ actor: f.actor })).revision;
  await f.state.recordPreparationFailure({ actor: f.actor, attemptId: f.attemptId, expectedRevision: revision,
    initialSessionId: `training-${f.attemptId}`, stage: "setup", code: "later-unavailable", message: "The earlier prepared environment is unavailable now." });
  const before = await treeState(f.paths.root);
  const legitimate = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.equal(legitimate.active.preparation.phase, "preparing");
  assert.equal(legitimate.active.learning.resume.pendingQuestion.assessmentId, "answer-two");
  assert.equal(legitimate.completion.passed, 2);
  assert.deepEqual(legitimate.active.learning.submissions, original.attempts[0].learning.submissions);
  assert.deepEqual(await treeState(f.paths.root), before);
});

test("documented staged restore validates saved learning against live exact-pin content before publication", async t => {
  const f = await learningFixture(t);
  await f.save("question", "answer-one");
  await f.record(f.answer("answer-one", "answer"));
  await f.record(f.observation("exercise", "exercise"));
  await f.save("next-question", "answer-two");
  await fs.rm(f.paths.active);
  const procedure = await recoveryProcedure(f);
  const checkpoint = await procedure.copy();
  const copiedUsers = path.join(checkpoint, "training/users");
  const copiedProgress = path.join(copiedUsers, path.basename(f.paths.root), "progress.json");
  const originalBytes = await fs.readFile(copiedProgress);
  const original = JSON.parse(originalBytes);
  // A legitimate historical answer need not match the current pending question.
  await f.save("live-question", "answer-three");
  const users = path.dirname(f.paths.root);
  const liveBefore = await treeState(users);
  const contentRoot = path.join(f.systemRoot, "training/content");
  const contentBefore = await treeState(contentRoot);
  const changes = [
    progress => { progress.attempts[0].learning.submissions[0].assessmentId = "missing"; },
    progress => { progress.attempts[0].learning.submissions[0].rubric = "lesson.md#different"; },
    progress => { progress.attempts[0].learning.submissions[0].assessmentId = "workspace-practice"; },
    progress => { progress.attempts[0].learning.submissions[1].evidence.producer = "workspace"; },
    progress => { progress.attempts[0].learning.submissions[1].evidence.operation = "other"; },
    progress => { progress.attempts[0].learning.submissions[1].evidence.check = "other"; },
    progress => { progress.attempts[0].learning.resume.pendingQuestion.assessmentId = "missing"; },
    progress => { progress.attempts[0].learning.resume.visuals[0].visualId = "missing"; },
    progress => { progress.attempts[0].learning.resume.visuals[0].snapshot.state = "missing"; }
  ];
  for (const change of changes) {
    const tampered = structuredClone(original);
    change(tampered);
    await fs.writeFile(copiedProgress, JSON.stringify(tampered));
    const copiedBefore = await treeState(copiedUsers);
    let rejected;
    await assert.rejects(() => procedure.restore(checkpoint), error => {
      rejected = error;
      return /pinned|pending question|semantic state/u.test(error.stderr);
    });
    const stage = procedure.stagePath(rejected);
    assert.ok(stage);
    assert.deepEqual(await treeState(path.join(stage, "training/users")), copiedBefore);
    await assert.rejects(() => fs.lstat(path.join(stage, "previous-users")), { code: "ENOENT" });
    assert.deepEqual(await treeState(copiedUsers), copiedBefore);
    assert.deepEqual(await treeState(users), liveBefore);
    assert.deepEqual(await treeState(contentRoot), contentBefore);
  }
  await fs.writeFile(copiedProgress, originalBytes);
  const checkpointBefore = await treeState(copiedUsers);
  const restored = await procedure.restore(checkpoint);
  assert.deepEqual(await treeState(users), checkpointBefore);
  assert.deepEqual(await treeState(copiedUsers), checkpointBefore);
  assert.deepEqual(await treeState(path.join(procedure.stagePath(restored), "previous-users")), liveBefore);
  assert.deepEqual(await treeState(contentRoot), contentBefore);
  const state = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.equal(state.activeSummaryCurrent, false);
  assert.equal(state.active.attemptId, f.attemptId);
  assert.deepEqual(state.active.pin, f.pin);
  assert.deepEqual(state.active.learning, original.attempts[0].learning);
  assert.equal(state.completion.passed, 2);
  assert.deepEqual(await treeState(users), checkpointBefore);
});

test("explicit end retains the pinned attempt and fresh reserve creates new project/session identities without resurrecting replays", async t => {
  const f = await learningFixture(t);
  await f.save("old-question", "answer-one");
  await f.record(f.answer("answer-one", "old-answer"));
  await f.record(f.observation("exercise", "old-exercise"));
  const previous = await f.state.readState({ actor: f.actor });
  const attempt = previous.progress.attempts[0];
  const input = { actor: f.actor, attemptId: f.attemptId, requestId: "end-first", expectedRevision: previous.revision, reason: "restart" };
  const ended = await f.state.runPreparationExclusive(input, () => f.state.endAttempt(input));
  assert.equal(ended.replayed, false);
  assert.equal(ended.active, null);
  assert.deepEqual(ended.attempt, { ...attempt, ended: { requestId: "end-first", revision: previous.revision + 1, reason: "restart" } });
  assert.deepEqual(JSON.parse(await fs.readFile(f.paths.active, "utf8")), {
    schemaVersion: 1, learnerId: "42", progressRevision: ended.revision, attemptId: null
  });
  assert.equal((await f.state.readState({ actor: f.actor, includeCompletion: true })).completion, null);
  await assert.rejects(() => fs.lstat(path.join(f.systemRoot, "projects")), { code: "ENOENT" });
  const next = await f.reserve({ requestId: "new-exercise", expectedRevision: ended.revision });
  assert.notEqual(next.attempt.attemptId, f.attemptId);
  assert.notEqual(next.attempt.projectSlug, attempt.projectSlug);
  assert.equal(next.attempt.learning, undefined);
  const prepared = await f.state.beginPreparation({ actor: f.actor, attemptId: next.attempt.attemptId, expectedRevision: next.revision });
  assert.notEqual(prepared.attempt.preparation.initialSessionId, attempt.preparation.initialSessionId);
  const current = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual(current.progress.attempts[0], ended.attempt);
  assert.deepEqual(current.active.preparation, prepared.attempt.preparation);
  assert.equal(current.completion.passed, 2);
  assert.equal(current.completion.completed, false);
  const before = await treeState(f.systemRoot);
  assert.deepEqual(await f.state.endAttempt({ ...input, expectedRevision: 0 }), {
    revision: current.revision, attempt: ended.attempt, active: current.active, replayed: true
  });
  assert.equal((await f.reserve()).attempt.attemptId, f.attemptId);
  assert.equal((await f.reserve()).attempt.ended.reason, "restart");
  assert.equal((await f.state.readState({ actor: f.actor })).active.attemptId, next.attempt.attemptId);
  await assert.rejects(() => f.state.endAttempt({ ...input, reason: "discard" }), error => error.code === "VIBE64_TRAINING_REQUEST_CONFLICT");
  await assert.rejects(() => f.state.endAttempt({ ...input, attemptId: next.attempt.attemptId }), error => error.code === "VIBE64_TRAINING_REQUEST_CONFLICT");
  await assert.rejects(() => f.reserve({ requestId: "end-first" }), error => error.code === "VIBE64_TRAINING_REQUEST_CONFLICT");
  await assert.rejects(() => f.state.endAttempt({ ...input, requestId: "start-1" }), error => error.code === "VIBE64_TRAINING_REQUEST_CONFLICT");
  for (const operation of [
    () => f.state.resumeAttempt(input),
    () => f.state.beginPreparation({ ...input, expectedRevision: current.revision }),
    () => f.state.runPreparationExclusive(input, () => assert.fail("Ended attempt must not admit project effects.")),
    () => f.state.recordAssessment(f.answer("answer-one", "old-answer")),
    () => f.state.saveLessonResume({ ...input, requestId: "old-question", resume: f.checkpoint("answer-one") })
  ]) await assert.rejects(operation, error => error.code === "VIBE64_TRAINING_ATTEMPT_MISSING");
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("attempt end refuses malformed, other-actor and stale admissions and composes with the original preparation exclusion", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, requestId: "end-1", expectedRevision: 1, reason: "discard" };
  const before = await treeState(f.systemRoot);
  for (const change of [{ actor: undefined }, { attemptId: "caller" }, { requestId: " " }, { expectedRevision: -1 }, { reason: "delete" }]) {
    await assert.rejects(() => f.state.endAttempt({ ...input, ...change }));
  }
  await assert.rejects(() => f.state.endAttempt({ ...input, expectedRevision: 0 }), error => error.code === "VIBE64_TRAINING_STATE_REVISION_CONFLICT");
  assert.deepEqual(await treeState(f.systemRoot), before);
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const holder = f.state.runPreparationExclusive(input, async () => {
    entered.resolve();
    await finish.promise;
    // This represents the admitted host cut line, not a claim that native
    // Stop/archive/delete ran. It invokes the real typed store under the lock.
    return f.state.endAttempt(input);
  });
  try {
    await Promise.race([entered.promise, holder]);
    await assert.rejects(() => f.state.runPreparationExclusive(input, () => assert.fail("Competing lifecycle entered.")),
      error => error.code === "VIBE64_TRAINING_PREPARATION_BUSY");
    assert.equal((await f.state.readState({ actor: f.actor })).active.attemptId, input.attemptId);
  } finally { finish.resolve(); await holder; }
  assert.equal((await f.state.readState({ actor: f.actor })).active, null);
  const fresh = await f.reserve({ actor: { uid: 43 }, requestId: "other-person", expectedRevision: 0 });
  const otherBefore = await treeState(f.systemRoot);
  await assert.rejects(() => f.state.endAttempt({ ...input, actor: { uid: 43 }, expectedRevision: fresh.revision }),
    error => error.code === "VIBE64_TRAINING_ATTEMPT_MISSING");
  assert.deepEqual(await treeState(f.systemRoot), otherBefore);
});

test("interrupted end and new-start summary publication retain real history and reconcile only on explicit replay", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, requestId: "retire-1", expectedRevision: 1, reason: "discard" };
  const realRename = fs.rename;
  const mock = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === f.paths.active) throw Object.assign(new Error("Summary publication interrupted"), { code: "EIO" });
    return realRename(...args);
  });
  syncBuiltinESMExports();
  let next;
  try {
    await assert.rejects(() => f.state.endAttempt(input), error => error.code === "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED" &&
      error.attemptEndSaved === true && error.reservationSaved === false && error.revision === 2);
    const afterEnd = await treeState(f.systemRoot);
    const ended = await f.state.readState({ actor: f.actor });
    assert.equal(ended.active, null);
    assert.equal(ended.activeSummaryCurrent, false);
    assert.equal(ended.progress.attempts[0].ended.requestId, input.requestId);
    assert.deepEqual(await treeState(f.systemRoot), afterEnd);
    await assert.rejects(() => f.reserve({ requestId: "fresh-1", expectedRevision: 2 }), error => {
      next = error.attemptId;
      return error.code === "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED" && error.reservationSaved === true && error.revision === 3;
    });
    const beforeRead = await treeState(f.systemRoot);
    const read = await f.state.readState({ actor: f.actor });
    assert.equal(read.active.attemptId, next);
    assert.equal(read.progress.attempts.length, 2);
    assert.equal(read.activeSummaryCurrent, false);
    assert.deepEqual(await treeState(f.systemRoot), beforeRead);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  const authorityBytes = await fs.readFile(f.paths.progress, "utf8");
  const replay = await f.state.endAttempt(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.active.attemptId, next);
  assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, true);
  assert.equal(await fs.readFile(f.paths.progress, "utf8"), authorityBytes);
  assert.equal((await f.reserve({ requestId: "fresh-1", expectedRevision: 0 })).attempt.attemptId, next);
});

test("end progress failures before and after atomic rename retry the original request without inventing disposal", async t => {
  for (const afterRename of [false, true]) {
    const f = await fixture(t);
    const reserved = await f.reserve();
    const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, requestId: "end-1", expectedRevision: 1, reason: "restart" };
    const realRename = fs.rename;
    const mock = t.mock.method(fs, "rename", async (...args) => {
      if (args[1] === f.paths.progress) {
        if (afterRename) await realRename(...args);
        throw Object.assign(new Error("Unconfirmed progress publication"), { code: "EIO" });
      }
      return realRename(...args);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(() => f.state.endAttempt(input), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED" &&
        error.attemptEndSaved === undefined && /exact end request/u.test(error.message));
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    const saved = await f.state.readState({ actor: f.actor });
    assert.equal(saved.revision, afterRename ? 2 : 1);
    assert.equal(saved.active === null, afterRename);
    const replay = await f.state.endAttempt(input);
    assert.equal(replay.replayed, afterRename);
    assert.equal(replay.revision, 2);
    assert.equal(replay.active, null);
    assert.equal(replay.attempt.attemptId, input.attemptId);
    assert.equal(replay.attempt.ended.requestId, input.requestId);
    await assert.rejects(() => fs.lstat(path.join(f.systemRoot, "projects")), { code: "ENOENT" });
  }
});

test("eight retained attempts and the total byte bound refuse growth without evicting history or replay identities", async t => {
  const f = await fixture(t, { learning: true });
  let state = await f.state.readState({ actor: f.actor });
  for (let index = 0; index < 8; index++) {
    const reserved = await f.reserve({ requestId: `start-${index}`, expectedRevision: state.revision });
    state = await f.state.endAttempt({ actor: f.actor, attemptId: reserved.attempt.attemptId,
      requestId: `end-${index}`, expectedRevision: reserved.revision, reason: "restart" });
  }
  const valid = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  assert.equal(valid.attempts.length, 8);
  assert.equal(valid.activeAttemptId, null);
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => f.reserve({ requestId: "start-9", expectedRevision: state.revision }), /eight retained-attempt limit/u);
  assert.equal((await f.reserve({ requestId: "start-0", expectedRevision: 0 })).attempt.attemptId, valid.attempts[0].attemptId);
  assert.deepEqual(await treeState(f.systemRoot), before);
  const ninth = randomUUID();
  const oversized = { ...valid, revision: valid.revision + 2, attempts: [...valid.attempts, {
    ...valid.attempts[0], attemptId: ninth, projectSlug: `training-${ninth.replaceAll("-", "")}`,
    requestIds: ["ninth-reservation"], ended: { requestId: "ninth-end", revision: valid.revision + 2, reason: "discard" }
  }] };
  await f.write("progress.json", oversized, f.paths.root);
  const invalidBefore = await treeState(f.systemRoot);
  await assert.rejects(() => f.state.readState({ actor: f.actor }), error => error.code === "VIBE64_TRAINING_STATE_INVALID" &&
    /Expected at most 8 items/u.test(JSON.stringify(error.cause?.fieldErrors)));
  assert.deepEqual(await treeState(f.systemRoot), invalidBefore);
  await f.write("progress.json", valid, f.paths.root);
  // Fill only valid bounded fields until an end's prospective pretty-printed
  // record would exceed the shared byte budget; no receipt is evicted to fit.
  const bytesFull = structuredClone(valid);
  delete bytesFull.attempts[7].ended;
  bytesFull.activeAttemptId = bytesFull.attempts[7].attemptId;
  for (const [index, attempt] of bytesFull.attempts.entries()) {
    attempt.learning = { submissions: [], resume: { requestId: `resume-${index}`, revision: attempt.ended ? attempt.ended.revision - 1 : bytesFull.revision,
      stage: "introduction", summary: index === 7 ? "" : "s".repeat(2048),
      pendingQuestion: { id: `question-${index}`, assessmentId: "answer-one", text: "q".repeat(2048) },
      visuals: [{ visualId: "request", snapshot: { state: "overview", paused: true, labels: {} } }] } };
  }
  const size = () => Buffer.byteLength(`${JSON.stringify(bytesFull, null, 2)}\n`);
  const target = 65536 - 40;
  let labelLength = 1;
  for (; labelLength <= 256; labelLength++) {
    for (const attempt of bytesFull.attempts) {
      attempt.learning.resume.visuals[0].snapshot.labels = Object.fromEntries(Array.from({ length: 12 },
        (_, index) => [`detail-${index}`, "d".repeat(labelLength)]));
    }
    // Each snapshot also remains below its independent 4096-byte cap.
    if (size() + 96 >= target) break;
  }
  assert.ok(labelLength <= 256);
  assert.ok(size() <= target);
  const padding = target - size();
  assert.ok(padding <= 2048);
  bytesFull.attempts[7].learning.resume.summary = "s".repeat(padding);
  assert.equal(size(), target);
  await f.write("progress.json", `${JSON.stringify(bytesFull, null, 2)}\n`, f.paths.root);
  await fs.rm(f.paths.active);
  const beforeEnd = await treeState(f.systemRoot);
  assert.equal((await f.state.readState({ actor: f.actor, includeCompletion: true })).progress.attempts.length, 8);
  await assert.rejects(() => f.state.endAttempt({ actor: f.actor, attemptId: bytesFull.activeAttemptId,
    requestId: "capacity-end", expectedRevision: bytesFull.revision, reason: "discard" }), /64 KiB/u);
  assert.deepEqual(await treeState(f.systemRoot), beforeEnd);
});

test("stale summaries across retirement remain tied to the retained attempt and reject impossible or cross-identity histories without writes", async t => {
  const f = await fixture(t);
  const first = await f.reserve();
  const oldSummary = JSON.parse(await fs.readFile(f.paths.active, "utf8"));
  const ended = await f.state.endAttempt({ actor: f.actor, attemptId: first.attempt.attemptId,
    requestId: "end-1", expectedRevision: first.revision, reason: "restart" });
  const empty = JSON.parse(await fs.readFile(f.paths.active, "utf8"));
  const next = await f.reserve({ requestId: "start-2", expectedRevision: ended.revision });
  const canonical = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  for (const summary of [oldSummary, empty]) {
    await f.write("active-lesson.json", summary, f.paths.root);
    const before = await treeState(f.systemRoot);
    const read = await f.state.readState({ actor: f.actor });
    assert.equal(read.active.attemptId, next.attempt.attemptId);
    assert.equal(read.activeSummaryCurrent, false);
    assert.deepEqual(await treeState(f.systemRoot), before);
    assert.equal((await f.state.resumeAttempt({ actor: f.actor, attemptId: next.attempt.attemptId })).active.attemptId, next.attempt.attemptId);
    assert.equal((await f.state.readState({ actor: f.actor })).activeSummaryCurrent, true);
  }
  const current = JSON.parse(await fs.readFile(f.paths.active, "utf8"));
  for (const summary of [
    { ...oldSummary, progressRevision: ended.revision },
    { ...oldSummary, projectSlug: next.attempt.projectSlug },
    { ...empty, progressRevision: 1 },
    { ...empty, learnerId: "43" },
    { ...empty, progressRevision: next.revision + 1 },
    { ...current, progressRevision: ended.revision }
  ]) {
    await f.write("active-lesson.json", summary, f.paths.root);
    const before = await treeState(f.systemRoot);
    for (const operation of [() => f.state.readState({ actor: f.actor }),
      () => f.state.resumeAttempt({ actor: f.actor, attemptId: next.attempt.attemptId }),
      () => f.state.endAttempt({ actor: f.actor, attemptId: first.attempt.attemptId, requestId: "end-1", expectedRevision: 0, reason: "restart" })]) {
      await assert.rejects(operation, error => error.code === "VIBE64_TRAINING_STATE_INVALID");
    }
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
  await f.write("active-lesson.json", current, f.paths.root);
  for (const change of [
    value => { value.attempts[1].requestIds = ["start-1"]; },
    value => { value.attempts[0].ended.revision = value.revision; },
    value => { value.attempts[0].ended.requestId = "start-2"; },
    value => { value.attempts.reverse(); },
    value => { value.activeAttemptId = first.attempt.attemptId; }
  ]) {
    const invalid = structuredClone(canonical);
    change(invalid);
    await f.write("progress.json", invalid, f.paths.root);
    const before = await treeState(f.systemRoot);
    await assert.rejects(() => f.state.readState({ actor: f.actor }), error => error.code === "VIBE64_TRAINING_STATE_INVALID");
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
  await f.write("progress.json", canonical, f.paths.root);
  assert.deepEqual((await f.state.readState({ actor: f.actor })).active, next.active);
});

test("ended historical assessment contracts and installed pins are verified even without an active attempt", async t => {
  const f = await learningFixture(t);
  await f.save("question-old", "answer-one");
  await f.record(f.answer("answer-one", "historical-answer"));
  const previous = await f.state.readState({ actor: f.actor });
  const input = { actor: f.actor, attemptId: f.attemptId, requestId: "end-old", expectedRevision: previous.revision, reason: "discard" };
  await f.state.endAttempt(input);
  const original = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  const changed = structuredClone(original);
  changed.attempts[0].learning.submissions[0].rubric = "lesson.md#other";
  await f.write("progress.json", changed, f.paths.root);
  const before = await treeState(f.systemRoot);
  assert.equal((await f.state.readState({ actor: f.actor })).active, null);
  for (const operation of [() => f.state.readState({ actor: f.actor, includeCompletion: true }),
    () => f.state.endAttempt(input), () => f.reserve({ requestId: "new-history", expectedRevision: original.revision })]) {
    await assert.rejects(operation, /exact pinned assessment/u);
  }
  assert.deepEqual(await treeState(f.systemRoot), before);
  await f.write("progress.json", original, f.paths.root);
  const content = path.join(f.systemRoot, "training/content", f.pin.topic.topicId, f.pin.topic.commit);
  await fs.rename(content, `${content}-retained`);
  try {
    const missingBefore = await treeState(f.systemRoot);
    assert.equal((await f.state.readState({ actor: f.actor })).progress.attempts.length, 1);
    await assert.rejects(() => f.state.readState({ actor: f.actor, includeCompletion: true }), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
    await assert.rejects(() => f.state.endAttempt(input), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
    assert.deepEqual(await treeState(f.systemRoot), missingBefore);
  } finally { await fs.rename(`${content}-retained`, content); }
  assert.equal((await f.state.readState({ actor: f.actor, includeCompletion: true })).completion, null);
  assert.deepEqual((await f.state.readState({ actor: f.actor })).progress.attempts[0].learning, original.attempts[0].learning);
});

test("exact-pin completion unions historical passes without rebinding receipts and changed installed lesson content inherits none", async t => {
  const f = await learningFixture(t);
  await f.save("question-old", "answer-one");
  await f.record(f.answer("answer-one", "old-pass"));
  await f.record(f.observation("exercise", "old-practical"));
  const old = await f.state.readState({ actor: f.actor });
  const ended = await f.state.endAttempt({ actor: f.actor, attemptId: f.attemptId, requestId: "end-old", expectedRevision: old.revision, reason: "restart" });
  const second = await f.reserve({ requestId: "start-second", expectedRevision: ended.revision });
  const secondId = second.attempt.attemptId;
  const question = f.checkpoint("answer-one");
  await f.state.saveLessonResume({ actor: f.actor, attemptId: secondId, requestId: "question-second", expectedRevision: second.revision, resume: question });
  const input = f.answer("answer-one", "second-pass");
  const recorded = await f.state.recordAssessment({ ...input, attemptId: secondId,
    expectedRevision: (await f.state.readState({ actor: f.actor })).revision,
    evidence: { ...input.evidence, attemptId: secondId } });
  assert.equal(recorded.completion.passed, 2, "Repeated assessment counts once; historical practical pass stays at its old producer identity.");
  const history = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.equal(history.active.learning.submissions.length, 1);
  assert.equal(history.active.learning.submissions[0].evidence.attemptId, secondId);
  assert.equal(history.progress.attempts[0].learning.submissions[1].evidence.attemptId, f.attemptId);
  assert.equal(history.progress.attempts[0].learning.submissions[1].evidence.projectSlug, old.active.projectSlug);
  assert.equal(history.completion.passed, 2);
  const content = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  const lesson = await content.readLesson({ ...f.pin.topic, lessonCode: f.pin.lesson.code, lessonHash: f.pin.lesson.hash });
  assert.deepEqual(passedAssessmentIds(history.active, lesson, history.progress.attempts), ["answer-one", "exercise-practice"]);
  const anotherTopic = { ...history.active, pin: { ...history.active.pin,
    topic: { ...history.active.pin.topic, commit: "b".repeat(40) } } };
  assert.deepEqual(passedAssessmentIds(anotherTopic, lesson, history.progress.attempts), ["answer-one", "exercise-practice"]);
  const anotherLesson = { ...history.active, pin: { ...history.active.pin,
    lesson: { ...history.active.pin.lesson, code: "INTRO-02" } } };
  assert.deepEqual(passedAssessmentIds(anotherLesson, lesson, history.progress.attempts), []);
  const wrongRubric = structuredClone(history.progress.attempts);
  for (const attempt of wrongRubric) {
    for (const submission of attempt.learning?.submissions || []) submission.rubricRevision = "0".repeat(64);
  }
  assert.deepEqual(passedAssessmentIds(history.active, lesson, wrongRubric), []);
  await f.state.endAttempt({ actor: f.actor, attemptId: secondId, requestId: "end-second", expectedRevision: history.revision, reason: "restart" });
  const descriptor = JSON.parse(await fs.readFile(path.join(f.sourceRoot, "package.json"), "utf8"));
  descriptor.version = "0.1.1";
  await f.write("package.json", descriptor);
  const lessonFile = path.join(f.sourceRoot, "training/lessons/INTRO-01/lesson.md");
  await fs.appendFile(lessonFile, "\nAn independently revised introduction.\n");
  execFileSync("git", ["-C", f.sourceRoot, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", f.sourceRoot, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Revised pinned introduction"], { stdio: "ignore" });
  const pinned = await readPinnedTopic(f.sourceRoot);
  const topic = { schemaVersion: 1, topicId: pinned.topicId, release: pinned.release, repository: pinned.repository, commit: pinned.commit, topicHash: pinned.topicHash };
  await createTrainingContentInstaller({ systemRoot: f.systemRoot }).installTopic({ sourceRoot: f.sourceRoot, pin: topic });
  const newPin = { course: { ...f.pin.course }, topic, lesson: { code: f.pin.lesson.code, hash: pinned.topicManifest.lessons[0].hash } };
  assert.notEqual(newPin.lesson.hash, f.pin.lesson.hash);
  const revision = (await f.state.readState({ actor: f.actor })).revision;
  const revised = await f.reserve({ requestId: "start-revised", expectedRevision: revision, pin: newPin });
  const result = await f.state.resumeAttempt({ actor: f.actor, attemptId: revised.attempt.attemptId });
  assert.equal(result.completion.passed, 0);
  assert.equal(result.completion.completed, false);
  const revisedLesson = await content.readLesson({ ...newPin.topic, lessonCode: newPin.lesson.code, lessonHash: newPin.lesson.hash });
  const revisedState = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual(passedAssessmentIds(revisedState.active, revisedLesson, revisedState.progress.attempts), []);
  assert.deepEqual((await f.state.readState({ actor: f.actor })).progress.attempts[0], ended.attempt);
});

test("documented staged restore preserves ended history and its exact pinned receipts rather than manufacturing an active exercise", async t => {
  const f = await learningFixture(t);
  await f.save("question-backup", "answer-one");
  await f.record(f.answer("answer-one", "backup-answer"));
  const old = await f.state.readState({ actor: f.actor });
  await f.state.endAttempt({ actor: f.actor, attemptId: f.attemptId, requestId: "backup-end", expectedRevision: old.revision, reason: "discard" });
  const users = path.dirname(f.paths.root);
  const before = await treeState(users);
  const procedure = await recoveryProcedure(f);
  const checkpoint = await procedure.copy();
  const result = await procedure.restore(checkpoint);
  assert.match(result.stdout, /Reservation records and installed pins validated/u);
  assert.deepEqual(await treeState(users), before);
  const restored = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.equal(restored.active, null);
  assert.equal(restored.activeSummaryCurrent, true);
  assert.equal(restored.completion, null);
  assert.deepEqual(restored.progress.attempts[0].learning, old.active.learning);
  assert.equal(restored.progress.attempts[0].ended.reason, "discard");
});


test("unchanged lesson completion survives a new installed topic and course revision without rebinding evidence", async t => {
  const f = await learningFixture(t);
  await f.save("question-before-topic-update", "answer-one");
  await f.record(f.answer("answer-one", "answer-before-topic-update"));
  await f.record(f.observation("exercise", "practice-before-topic-update"));
  const old = await f.state.readState({ actor: f.actor });
  const ended = await f.state.endAttempt({ actor: f.actor, attemptId: f.attemptId,
    requestId: "end-before-topic-update", expectedRevision: old.revision, reason: "restart" });
  const originalProgress = await fs.readFile(f.paths.progress, "utf8");
  const descriptor = JSON.parse(await fs.readFile(path.join(f.sourceRoot, "package.json"), "utf8"));
  descriptor.version = "0.1.1";
  await f.write("package.json", descriptor);
  await fs.appendFile(path.join(f.sourceRoot, "training/outline.md"), "\nA revised course introduction with the same lesson.\n");
  execFileSync("git", ["-C", f.sourceRoot, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", f.sourceRoot, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
    "-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Revised topic, unchanged lesson"], { stdio: "ignore" });
  const pinned = await readPinnedTopic(f.sourceRoot);
  const topic = { schemaVersion: 1, topicId: pinned.topicId, release: pinned.release,
    repository: pinned.repository, commit: pinned.commit, topicHash: pinned.topicHash };
  const pin = { course: { courseId: "reordered-intro-course", release: "0.2.0" }, topic,
    lesson: { code: f.pin.lesson.code, hash: pinned.topicManifest.lessons[0].hash } };
  assert.notEqual(topic.commit, f.pin.topic.commit);
  assert.notEqual(topic.topicHash, f.pin.topic.topicHash);
  assert.equal(pin.lesson.hash, f.pin.lesson.hash, "Only the topic and course changed; assessment content is identical.");
  await createTrainingContentInstaller({ systemRoot: f.systemRoot }).installTopic({ sourceRoot: f.sourceRoot, pin: topic });
  assert.equal(await fs.readFile(f.paths.progress, "utf8"), originalProgress, "Installing new content cannot migrate learner records.");
  const reserved = await f.reserve({ requestId: "start-new-topic", expectedRevision: ended.revision, pin });
  const current = await f.state.resumeAttempt({ actor: f.actor, attemptId: reserved.attempt.attemptId });
  assert.deepEqual(current.completion, { lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash,
    required: 6, passed: 2, completed: false });
  const saved = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual(saved.progress.attempts[0], ended.attempt, "Earlier pins, rubric and exact answer/practical receipts remain immutable.");
  assert.deepEqual(saved.active.learning?.submissions || [], [], "Historical evidence is counted, never copied to the fresh attempt.");
  assert.notEqual(saved.active.attemptId, f.attemptId);
  assert.notEqual(saved.active.projectSlug, old.active.projectSlug);
  const brief = await createTrainingTeachingBrief({ systemRoot: f.systemRoot }).readBrief({ actor: f.actor, attemptId: saved.active.attemptId });
  assert.deepEqual(brief.learning.passedAssessmentIds, ["answer-one", "exercise-practice"]);
  assert.deepEqual(brief.learning.remainingAssessmentIds, ["answer-two", "answer-three", "workspace-practice", "colleague-practice"]);
  assert.deepEqual(brief.learning.retainedPasses, ended.attempt.learning.submissions.map(submission => ({
    attemptId: f.attemptId, pin: f.pin, submission
  })), "Colleague receives the original provenance for passes counted across topic revisions.");
  const beforeRead = await treeState(f.systemRoot);
  assert.equal((await f.state.readState({ actor: f.actor, includeCompletion: true })).completion.passed, 2);
  assert.deepEqual(await treeState(f.systemRoot), beforeRead, "Completion reads do not rewrite progress.");
  const other = { uid: 43, username: "another-learner" };
  const otherReserved = await f.state.reserveAttempt({ actor: other, requestId: "start-another-learner", expectedRevision: 0, pin });
  const isolated = await f.state.resumeAttempt({ actor: other, attemptId: otherReserved.attempt.attemptId });
  assert.equal(isolated.completion.passed, 0, "Identical content does not transfer another person's evidence.");
});


test("an isolated original store admits drafts only through its configured author-preview content reader", async t => {
  const f = await fixture(t, { published: false });
  const previewRoot = path.join(f.root, "author-preview");
  await fs.mkdir(previewRoot, { mode: 0o700 });
  const content = createInstalledTrainingContent({ systemRoot: f.systemRoot, allowDraftLessons: true });
  const preview = createTrainingLearnerState({ systemRoot: previewRoot, contentSystemRoot: path.join(f.root, "missing-content"), content });
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => f.reserve(), /draft and cannot be taught/u);
  const reserved = await preview.reserveAttempt({ actor: f.actor, requestId: "author-start", expectedRevision: 0, pin: f.pin });
  assert.equal((await preview.readState({ actor: f.actor })).progress.learnerId, "42");
  assert.deepEqual(reserved.attempt.pin, f.pin);
  assert.equal(reserved.revision, 1);
  const replay = await preview.reserveAttempt({ actor: f.actor, requestId: "author-start", expectedRevision: 0, pin: f.pin });
  assert.equal(replay.replayed, true);
  assert.equal(replay.attempt.attemptId, reserved.attempt.attemptId);
  assert.equal((await preview.readState({ actor: f.actor, includeCompletion: true })).completion.passed, 0);
  assert.equal((await f.state.readState({ actor: f.actor })).active, null);
  assert.equal((await preview.readState({ actor: { uid: 43 } })).active, null);
  await assert.rejects(() => f.reserve(), /draft and cannot be taught/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
  await assert.rejects(() => fs.lstat(path.join(f.systemRoot, "training/users")), { code: "ENOENT" });
  for (const content of [null, {}, { readLesson: true }]) {
    assert.throws(() => createTrainingLearnerState({ systemRoot: previewRoot, content }), /configured installed-content reader/u);
  }
});

test("same actor and identical pinned lesson keep preview assessment receipts outside published learner progress", async t => {
  const f = await learningFixture(t);
  await f.save("learner-question", "answer-one");
  await f.record(f.answer("answer-one", "learner-pass"));
  const learnerBefore = await treeState(f.systemRoot);
  const previewRoot = path.join(f.root, "author-preview");
  await fs.mkdir(previewRoot, { mode: 0o700 });
  const content = createInstalledTrainingContent({ systemRoot: f.systemRoot, allowDraftLessons: true });
  const preview = createTrainingLearnerState({ systemRoot: previewRoot, content });
  const reserved = await preview.reserveAttempt({ actor: f.actor, requestId: "preview-start", expectedRevision: 0, pin: f.pin });
  const attemptId = reserved.attempt.attemptId;
  assert.notEqual(attemptId, f.attemptId);
  assert.deepEqual(reserved.attempt.pin, f.pin);
  assert.equal((await preview.readState({ actor: f.actor, includeCompletion: true })).completion.passed, 0);
  const preparing = await preview.beginPreparation({ actor: f.actor, attemptId, expectedRevision: reserved.revision });
  const ready = await preview.recordPreparationReady({ actor: f.actor, attemptId, expectedRevision: preparing.revision,
    initialSessionId: preparing.attempt.preparation.initialSessionId });
  const questioned = await preview.saveLessonResume({ actor: f.actor, attemptId, expectedRevision: ready.revision,
    requestId: "preview-question", resume: { stage: "practice", pendingQuestion: { id: "preview-question", assessmentId: "answer-two", text: "What did you observe?" },
      visuals: [], summary: "A preview-only question." } });
  const result = await preview.recordAssessment({ actor: f.actor, attemptId, expectedRevision: questioned.revision,
    submissionId: "preview-pass", assessmentId: "answer-two", outcome: "passed", assistance: "none", explanation: "Controlled store evidence for preview isolation.",
    evidence: { kind: "answer", learnerId: "42", attemptId, messageId: "preview-message", questionId: "preview-question", text: "The browser displays a response." } });
  assert.equal(result.completion.passed, 1);
  const previewState = await preview.readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual(previewState.active.learning.submissions.map(value => value.submissionId), ["preview-pass"]);
  const learnerState = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.equal(learnerState.active.attemptId, f.attemptId);
  assert.equal(learnerState.completion.passed, 1);
  assert.deepEqual(learnerState.active.learning.submissions.map(value => value.submissionId), ["learner-pass"]);
  const previewBefore = await treeState(previewRoot);
  await assert.rejects(() => preview.recordAssessment({ ...f.answer("answer-one", "foreign-learner-receipt"), expectedRevision: previewState.revision }));
  await assert.rejects(() => f.state.resumeAttempt({ actor: f.actor, attemptId }));
  assert.deepEqual(await treeState(previewRoot), previewBefore);
  assert.deepEqual(await treeState(f.systemRoot), learnerBefore);
  const restored = createTrainingLearnerState({ systemRoot: previewRoot, contentSystemRoot: f.systemRoot });
  assert.deepEqual((await restored.readState({ actor: f.actor, includeCompletion: true })).progress, previewState.progress);
});


test("source-less learning scope comes from the real learner reservation and installed no-exercise pin without writes", async t => {
  const f = await fixture(t, { noExercise: true });
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const before = await treeState(f.systemRoot);
  const scope = await f.state.readLearningSessionScope({ actor: f.actor, attemptId });
  assert.deepEqual(scope, { scope: { learnerId: "42", attemptId, pin: f.pin, noExercise: true },
    projectRuntimeRoot: path.join(f.paths.root, "learning-sessions", attemptId), systemRoot: f.systemRoot,
    active: true, activeSummaryCurrent: true });
  scope.scope.pin.lesson.code = "foreign";
  assert.deepEqual((await f.state.readLearningSessionScope({ actor: f.actor, attemptId })).scope.pin, f.pin);
  assert.deepEqual(await treeState(f.systemRoot), before);
  await assert.rejects(() => fs.lstat(path.join(f.paths.root, "learning-sessions")), { code: "ENOENT" });
  await assert.rejects(() => f.state.readLearningSessionScope({ actor: { uid: 43 }, attemptId }),
    error => error.code === "VIBE64_TRAINING_ATTEMPT_MISSING");
  await assert.rejects(() => f.state.readLearningSessionScope({ actor: {}, attemptId }));
  await assert.rejects(() => f.state.readLearningSessionScope({ actor: f.actor, attemptId: "../attempt" }));
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("learning scope refuses exercise lessons and aliases rather than substituting a private root", async t => {
  const exercise = await fixture(t);
  const reservedExercise = await exercise.reserve();
  await assert.rejects(() => exercise.state.readLearningSessionScope({ actor: exercise.actor, attemptId: reservedExercise.attempt.attemptId }),
    error => error.code === "VIBE64_TRAINING_EXERCISE_REQUIRED");
  const f = await fixture(t, { noExercise: true });
  const reserved = await f.reserve();
  const link = path.join(f.paths.root, "learning-sessions");
  await fs.symlink(f.sourceRoot, link);
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => f.state.readLearningSessionScope({ actor: f.actor, attemptId: reserved.attempt.attemptId }));
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("learning scope reports ended and unconfirmed-summary state truthfully without repairing either", async t => {
  const f = await fixture(t, { noExercise: true });
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  await fs.writeFile(f.paths.active, JSON.stringify({ schemaVersion: 1, learnerId: "42", progressRevision: 0, attemptId: null }));
  const invalidBefore = await treeState(f.systemRoot);
  await assert.rejects(() => f.state.readLearningSessionScope({ actor: f.actor, attemptId }),
    error => error.code === "VIBE64_TRAINING_STATE_INVALID");
  assert.deepEqual(await treeState(f.systemRoot), invalidBefore);
  // Original recovery allows a missing summary; an invented end revision is invalid.
  await fs.rm(f.paths.active);
  const before = await treeState(f.systemRoot);
  const unconfirmed = await f.state.readLearningSessionScope({ actor: f.actor, attemptId });
  assert.equal(unconfirmed.active, true);
  assert.equal(unconfirmed.activeSummaryCurrent, false);
  assert.deepEqual(await treeState(f.systemRoot), before);
  const ended = await f.state.endAttempt({ actor: f.actor, attemptId, expectedRevision: reserved.revision,
    requestId: "end-learning", reason: "restart" });
  const endedBefore = await treeState(f.systemRoot);
  const historical = await f.state.readLearningSessionScope({ actor: f.actor, attemptId });
  assert.equal(historical.active, false);
  assert.equal(historical.activeSummaryCurrent, true);
  assert.deepEqual(historical.scope.pin, ended.attempt.pin);
  assert.deepEqual(await treeState(f.systemRoot), endedBefore);
});


test("exercise project scope reads the exact saved learner and installed exercise without writes or source-less substitution", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const before = await treeState(f.systemRoot);
  const saved = await f.state.readExerciseProjectScope({ actor: f.actor, attemptId, access: "create" });
  assert.deepEqual(saved, { scope: { learnerId: "42", attemptId, pin: f.pin, noExercise: false }, systemRoot: f.systemRoot,
    training: { schemaVersion: 1, learnerKey: "NDI", attemptId, pin: f.pin,
    exercise: { kind: "bundled", sourcePath: "training/exercises/app" } },
    projectSlug: reserved.attempt.projectSlug, active: true, activeSummaryCurrent: true });
  saved.training.pin.lesson.hash = "e".repeat(64);
  assert.deepEqual((await f.state.readExerciseProjectScope({ actor: f.actor, attemptId })).training.pin, f.pin);
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: { uid: 43 }, attemptId }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: f.actor, attemptId: "../attempt" }));
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: f.actor, attemptId, access: "all" }));
  await assert.rejects(() => f.state.readLearningSessionScope({ actor: f.actor, attemptId }), { code: "VIBE64_TRAINING_EXERCISE_REQUIRED" });
  assert.deepEqual(await treeState(f.systemRoot), before);
  const withoutExercise = await fixture(t, { noExercise: true });
  const noExerciseReservation = await withoutExercise.reserve();
  const noExerciseBefore = await treeState(withoutExercise.systemRoot);
  await assert.rejects(() => withoutExercise.state.readExerciseProjectScope({ actor: withoutExercise.actor,
    attemptId: noExerciseReservation.attempt.attemptId }), { code: "VIBE64_TRAINING_EXERCISE_MISSING" });
  assert.deepEqual(await treeState(withoutExercise.systemRoot), noExerciseBefore);
});

test("exercise scope keeps ended history observable but denies fresh work and invalid installed pins without repair", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const begun = await f.state.beginPreparation({ actor: f.actor, attemptId, expectedRevision: reserved.revision });
  assert.equal((await f.state.readExerciseProjectScope({ actor: f.actor, attemptId })).initialSessionId, begun.attempt.preparation.initialSessionId);
  await fs.rm(f.paths.active);
  const unconfirmedBefore = await treeState(f.systemRoot);
  const unconfirmed = await f.state.readExerciseProjectScope({ actor: f.actor, attemptId });
  assert.equal(unconfirmed.activeSummaryCurrent, false);
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: f.actor, attemptId, access: "create" }), { code: "VIBE64_TRAINING_ATTEMPT_INACTIVE" });
  assert.deepEqual(await treeState(f.systemRoot), unconfirmedBefore);
  const resumed = await f.state.resumeAttempt({ actor: f.actor, attemptId });
  await f.state.endAttempt({ actor: f.actor, attemptId, expectedRevision: resumed.revision, requestId: "practice-end", reason: "restart" });
  const endedBefore = await treeState(f.systemRoot);
  const historical = await f.state.readExerciseProjectScope({ actor: f.actor, attemptId, access: "control" });
  assert.equal(historical.active, false);
  assert.deepEqual(historical.training.pin, f.pin);
  for (const access of ["write", "create"]) {
    await assert.rejects(() => f.state.readExerciseProjectScope({ actor: f.actor, attemptId, access }), { code: "VIBE64_TRAINING_ATTEMPT_INACTIVE" });
  }
  assert.deepEqual(await treeState(f.systemRoot), endedBefore);
  const exerciseFile = path.join(f.systemRoot, "training/content", f.pin.topic.topicId, f.pin.topic.commit,
    "files/training/exercises/app/server.mjs");
  await fs.writeFile(exerciseFile, "changed installed source");
  const invalidBefore = await treeState(f.systemRoot);
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: f.actor, attemptId }), { code: "VIBE64_TRAINING_CONTENT_INVALID" });
  assert.deepEqual(await treeState(f.systemRoot), invalidBefore);
});

test("actual saved exercise caller admits only its same original local Project record inside the owning callback", async t => {
  const f = await fixture(t);
  const [{ createStudioProjectContext }, { createService: createProject }, { createService: createSessions },
    { createTrainingLearningSessions }, { currentProjectRequestContext }] = await Promise.all([
    import("../../packages/vibe64-core/src/server/studioProjectContext.js"),
    import("../../packages/vibe64-project/src/server/service.js"),
    import("../../packages/vibe64-sessions/src/server/service.js"),
    import("../../packages/vibe64-training/src/server/learningSessions.js"),
    import("../../packages/vibe64-core/src/server/projectRequestContext.js")
  ]);
  const projectContext = createStudioProjectContext({ explicitTargetRoot: f.sourceRoot, explicitSystemRoot: f.systemRoot,
    explicitManagedSourceRoot: path.join(f.root, "managed-source"), home: f.root, runtimeProfile: { local: true, mode: "local" } });
  const project = createProject({ projectContext });
  const sessions = createSessions({ project, terminals: {} });
  const brief = createTrainingTeachingBrief({ learners: f.state, content: createInstalledTrainingContent({ systemRoot: f.systemRoot }) });
  const learning = createTrainingLearningSessions({ learners: f.state, teachingBrief: brief, project, sessions, projectContext });
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const scope = await f.state.readExerciseProjectScope({ actor: f.actor, attemptId, access: "create" });
  const progressBefore = await fs.readFile(f.paths.progress);
  const activeBefore = await fs.readFile(f.paths.active);
  let captured;
  await learning.resolvePracticeContext({ actor: f.actor, attemptId, access: "create" }, async target => {
    assert.deepEqual(target, { projectSlug: reserved.attempt.projectSlug });
    await projectContext.createWorkspaceProjectRecord({ slug: target.projectSlug, training: scope.training });
    await project.runInProjectContext(target.projectSlug, async () => {
      const actual = await project.readCurrentProject();
      captured = currentProjectRequestContext();
      assert.equal(actual.slug, target.projectSlug);
      assert.equal(actual.repositoryMode, "managed_git");
      assert.equal(actual.sourceRoot, "");
      const runtime = await project.createRuntime({ inspectSource: false });
      assert.equal(runtime.projectContextRoot, actual.projectRoot);
      assert.equal(runtime.stateRoot, actual.projectRuntimeRoot);
      assert.equal(runtime.learningScope, null, "real practice Project is never a source-less learning session");
    });
  });
  assert.equal(projectContext.targetRoot, f.sourceRoot);
  assert.deepEqual(await fs.readFile(f.paths.progress), progressBefore);
  assert.deepEqual(await fs.readFile(f.paths.active), activeBefore);
  await assert.rejects(() => projectContext.readWorkspaceProject({ slug: reserved.attempt.projectSlug }), { code: "vibe64_project_catalog_unavailable" });
  await assert.rejects(() => learning.resolvePracticeContext({ actor: { uid: 43 }, attemptId }, () => assert.fail()), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await assert.rejects(() => learning.resolvePracticeContext({ actor: f.actor, attemptId, sessionId: "foreign" }, () => assert.fail()), { code: "VIBE64_TRAINING_SESSION_MISMATCH" });
  await assert.rejects(() => learning.resolvePracticeContext({ actor: f.actor, attemptId }), /owning callback/u);
  const { runWithProjectRequestContext } = await import("../../packages/vibe64-core/src/server/projectRequestContext.js");
  await assert.rejects(() => runWithProjectRequestContext(captured, () => project.readCurrentProject()), { code: "vibe64_practice_scope_expired" });
  await learning.resolvePracticeContext({ actor: f.actor, attemptId }, async target => {
    const state = await projectContext.readWorkspaceProjectState({ slug: target.projectSlug });
    assert.deepEqual(state.metadata.training, scope.training);
  });
  // Component record admission is not exercise materialization, session creation,
  // setup success, native teaching or Preview acceptance.
});

async function guardedLearningWriterFixture(t) {
  const f = await learningFixture(t);
  await f.save("guarded-original-question", "answer-one");
  const revision = (await f.state.readState({ actor: f.actor })).revision;
  const installed = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  const entered = Promise.withResolvers();
  const continueRead = Promise.withResolvers();
  const state = createTrainingLearnerState({ systemRoot: f.systemRoot, content: {
    async readLesson(input) {
      const lesson = await installed.readLesson(input);
      entered.resolve();
      await continueRead.promise;
      return lesson;
    }
  } });
  const before = { progress: await fs.readFile(f.paths.progress), active: await fs.readFile(f.paths.active) };
  const write = (kind, facilities) => kind === "question"
    ? state.saveLessonResume({ actor: f.actor, attemptId: f.attemptId, expectedRevision: revision,
      requestId: "guarded-next-question", resume: f.checkpoint("answer-two") }, facilities)
    : state.recordAssessment({ ...f.answer("answer-one", "guarded-answer"), expectedRevision: revision }, facilities);
  async function unchanged() {
    assert.deepEqual(await fs.readFile(f.paths.progress), before.progress);
    assert.deepEqual(await fs.readFile(f.paths.active), before.active);
    const release = await tryAcquireExclusiveFileLock(f.paths.lock);
    assert.equal(typeof release, "function", "refused original writer releases its same learner lock");
    await release();
  }
  return { ...f, state, entered, continueRead, write, unchanged };
}

test("original learning writer refuses Stop after held installed verification for question and assessment", { timeout: 15_000 }, async t => {
  for (const kind of ["question", "assessment"]) {
    const f = await guardedLearningWriterFixture(t);
    const abort = new AbortController();
    const reason = new Error(`Stopped admitted ${kind}`);
    const pending = f.write(kind, { signal: abort.signal });
    const rejected = assert.rejects(pending, error => error === reason);
    await f.entered.promise;
    assert.equal(await tryAcquireExclusiveFileLock(f.paths.lock), null, "installed verification is inside the original learner writer lock");
    abort.abort(reason);
    f.continueRead.resolve();
    await rejected;
    await f.unchanged();
  }
});

test("original learning writer refreshes revoked authority after held content and refuses without replay or progress", { timeout: 15_000 }, async t => {
  for (const kind of ["question", "assessment"]) {
    const f = await guardedLearningWriterFixture(t);
    let authorized = true;
    let refreshes = 0;
    const revoked = new Error("Actual originating actor no longer has teaching WRITE authority");
    const pending = f.write(kind, { async requireCurrent() {
      refreshes++;
      if (!authorized) throw revoked;
    } });
    const rejected = assert.rejects(pending, error => error === revoked);
    await f.entered.promise;
    assert.equal(refreshes, 0, "fresh effect admission belongs after the awaited original verification");
    authorized = false;
    f.continueRead.resolve();
    await rejected;
    assert.equal(refreshes, 1);
    await f.unchanged();
  }
});

test("original learning writer checks retired accepted request synchronously after awaited fresh authority", { timeout: 15_000 }, async t => {
  for (const kind of ["question", "assessment"]) {
    const f = await guardedLearningWriterFixture(t);
    const authorityEntered = Promise.withResolvers();
    const continueAuthority = Promise.withResolvers();
    let current = true;
    let checked = 0;
    const retired = new Error("The actual admitted native request was retired while authority refreshed");
    const pending = f.write(kind, { async requireCurrent() {
      authorityEntered.resolve();
      await continueAuthority.promise;
    }, assertCurrent() {
      checked++;
      if (!current) throw retired;
    } });
    const rejected = assert.rejects(pending, error => error === retired);
    await f.entered.promise;
    f.continueRead.resolve();
    await authorityEntered.promise;
    assert.equal(checked, 0);
    current = false;
    continueAuthority.resolve();
    await rejected;
    assert.equal(checked, 1);
    await f.unchanged();
  }
});

test("original learning receipt replay refreshes authority and preserves exact saved question and assessment", async t => {
  const f = await learningFixture(t);
  const saved = await f.save("guarded-replay-question", "answer-one");
  const answerInput = { ...f.answer("answer-one", "guarded-replay-answer"), expectedRevision: saved.revision };
  const assessed = await f.state.recordAssessment(answerInput);
  const before = { progress: await fs.readFile(f.paths.progress), active: await fs.readFile(f.paths.active) };
  const resumeInput = { actor: f.actor, attemptId: f.attemptId, expectedRevision: 0,
    requestId: "guarded-replay-question", resume: f.checkpoint("answer-one") };
  let authorized = false;
  let refreshes = 0;
  let checks = 0;
  const revoked = new Error("Saved receipt does not grant current teaching WRITE authority");
  const facilities = { async requireCurrent() {
    refreshes++;
    if (!authorized) throw revoked;
  }, assertCurrent() { checks++; } };
  await assert.rejects(f.state.saveLessonResume(resumeInput, facilities), error => error === revoked);
  await assert.rejects(f.state.recordAssessment(answerInput, facilities), error => error === revoked);
  assert.equal(checks, 0);
  authorized = true;
  const questionReplay = await f.state.saveLessonResume(resumeInput, facilities);
  const assessmentReplay = await f.state.recordAssessment(answerInput, facilities);
  assert.equal(questionReplay.replayed, true);
  assert.equal(assessmentReplay.replayed, true);
  assert.equal(questionReplay.revision, assessed.revision);
  assert.deepEqual(assessmentReplay.attempt.learning.submissions, assessed.attempt.learning.submissions);
  assert.equal(refreshes, 4);
  assert.equal(checks, 2);
  assert.deepEqual(await fs.readFile(f.paths.progress), before.progress);
  assert.deepEqual(await fs.readFile(f.paths.active), before.active);
});

test("configured practice Learning binds the saved actual initial Main session and re-admits writes without changing the default caller", async t => {
  const f = await fixture(t);
  const [{ createStudioProjectContext }, { createService: createProject }, { createService: createSessions },
    { createManagedProjectRepositoryService }, { createSessionSource }, { createTrainingLearningSessions },
    { assertProjectEffectAdmission, captureProjectRequestContext, runWithProjectRequestContext }] = await Promise.all([
    import("../../packages/vibe64-core/src/server/studioProjectContext.js"),
    import("../../packages/vibe64-project/src/server/service.js"),
    import("../../packages/vibe64-sessions/src/server/service.js"),
    import("../../packages/vibe64-project/src/server/managedRepository.js"),
    import("../../packages/vibe64-terminals/src/server/sessionSource.js"),
    import("../../packages/vibe64-training/src/server/learningSessions.js"),
    import("../../packages/vibe64-core/src/server/projectRequestContext.js")
  ]);
  const core = createStudioProjectContext({ explicitTargetRoot: f.sourceRoot, explicitSystemRoot: f.systemRoot,
    explicitManagedSourceRoot: path.join(f.root, "managed-source"), home: f.root, runtimeProfile: { local: true } });
  const project = createProject({ projectContext: core });
  const repository = createManagedProjectRepositoryService({ projectContext: core, projectService: project });
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const begun = await f.state.beginPreparation({ actor: f.actor, attemptId, expectedRevision: reserved.revision });
  const saved = await f.state.readExerciseProjectScope({ actor: f.actor, attemptId, access: "create" });
  const installed = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  const exercise = await installed.readExercise({ ...f.pin.topic, lessonCode: f.pin.lesson.code, lessonHash: f.pin.lesson.hash });
  const publications = [];
  let sourceCalls = 0;
  let setupCalls = 0;
  let capturedSetup;
  const selection = { agentId: "build", catalogRevision: `sha256:${"a".repeat(64)}`, engineId: "opencode", modelId: "big-pickle",
    modelProviderId: "opencode", schema: "vibe64.assistant-selection.v1", variantId: "" };
  const sessions = createSessions({ project, initializeModelRouting: async () => ({ ok: true }),
    terminals: {
      async resolveAssistantPurpose(input, options) {
        assert.equal(options.vibe64User, f.actor);
        assert.equal(input.purpose, "senior");
        return { available: true, effectiveSelection: selection, connectionIdentity: "controlled-original-account-seam" };
      },
      async requireAssistantSelectionAccess(value, options) {
        assert.deepEqual(value, selection);
        assert.equal(options.vibe64User, f.actor);
        assert.equal(options.expectedConnectionIdentity, "controlled-original-account-seam");
      },
      async createSessionSource(input) {
        sourceCalls++;
        assert.equal(input.vibe64User, f.actor);
        return project.runProjectSourceExclusive(async () => createSessionSource({ ...input,
          project: await project.readCurrentProject() }), { operation: "session-source-create" });
      }
    },
    workspaceSetupRunner: { isRunning: () => false, wait: () => null,
      start({ runtime, session }) {
        setupCalls++;
        capturedSetup = captureProjectRequestContext();
        assert.deepEqual(runtime.learningScope, saved.scope);
        assert.equal(session.sessionId, saved.initialSessionId);
        return { completion: null };
      }
    },
    publishSessionChanged: async (id, value) => publications.push({ id, value })
  });
  const learning = createTrainingLearningSessions({ learners: f.state,
    teachingBrief: createTrainingTeachingBrief({ learners: f.state, content: installed }),
    project, sessions, projectContext: core, practiceSessions: true });
  const progressBefore = await fs.readFile(f.paths.progress);
  const activeBefore = await fs.readFile(f.paths.active);
  let created;
  await core.runWithPracticeProjectScope({ actor: f.actor, training: saved.training, access: "create" }, async () => {
    await repository.createManagedGitProject({ slug: saved.projectSlug, training: saved.training }, {
      initializeProject: async ({ projectRoot }) => {
        for (const file of exercise.files) {
          await fs.mkdir(path.dirname(path.join(projectRoot, file.path)), { recursive: true });
          await fs.writeFile(path.join(projectRoot, file.path), file.bytes, { flag: "wx" });
        }
      }
    });
    const proof = await repository.verifyTrainingProjectSource({ slug: saved.projectSlug, training: saved.training }, { files: exercise.files });
    await project.runInProjectContext(saved.projectSlug, () => learning.runPreparationSessionContext({ actor: f.actor, attemptId,
      sessionId: saved.initialSessionId }, async () => {
      created = await sessions.createSession({ vibe64User: f.actor }, { sessionId: saved.initialSessionId, expectedCommit: proof.commit });
      assert.equal(created.ok, true, created.error);
    }));
  });
  assert.equal(created.purpose, "learning");
  assert.equal(created.learning.noExercise, false);
  assert.equal(created.sourceReady, true);
  assert.ok(created.sourcePath);
  assert.equal(created.learning.conversationId, begun.attempt.preparation.initialSessionId);
  assert.equal(sourceCalls, 1);
  assert.equal(setupCalls, 1, "original source setup entry remains admitted, without fabricating setup success");
  assert.equal(publications.length, 1);
  assert.equal(created.creation.canCreate, true);
  assert.ok(created.limits);
  await runWithProjectRequestContext(capturedSetup, async () => {
    assert.equal(core.currentPracticeProjectScope().access, "control");
    assert.throws(assertProjectEffectAdmission, { code: "vibe64_practice_effect_admission_required" });
    assert.equal((await project.createRuntime({ inspectSource: false })).projectContextRoot, capturedSetup.targetRoot);
  });
  const context = await learning.resolveContext({ actor: f.actor, attemptId, sessionId: created.sessionId, access: "write" });
  await runWithProjectRequestContext(context, () => assert.throws(assertProjectEffectAdmission,
    { code: "vibe64_practice_effect_admission_required" }));
  await context.runLearningOperation(async () => {
    assert.doesNotThrow(assertProjectEffectAdmission);
    const runtime = await project.createRuntime({ inspectSource: false });
    assert.deepEqual(runtime.learningScope, saved.scope);
    assert.equal((await runtime.store.readSession(created.sessionId)).metadata.source_kind, "session_clone");
  });
  const summaries = await learning.readSessions({ actor: f.actor });
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].sessionId, created.sessionId);
  assert.equal(summaries[0].projectSlug, saved.projectSlug);
  assert.equal(summaries[0].noExercise, false);
  assert.equal(JSON.stringify(summaries).includes(created.sourcePath), false);
  assert.equal((await learning.openSession({ actor: f.actor, attemptId })).sessionId, created.sessionId);
  assert.equal(sourceCalls, 1, "open never creates or replaces the practice session");
  const defaultOwner = createTrainingLearningSessions({ learners: f.state,
    teachingBrief: createTrainingTeachingBrief({ learners: f.state, content: installed }), project, sessions, projectContext: core });
  assert.deepEqual(await defaultOwner.readSessions({ actor: f.actor }), [], "default fixture retains original exercise exclusion");
  assert.deepEqual(await fs.readFile(f.paths.progress), progressBefore);
  assert.deepEqual(await fs.readFile(f.paths.active), activeBefore);
  await assert.rejects(() => learning.resolveContext({ actor: { uid: 43 }, attemptId, sessionId: created.sessionId }),
    { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await assert.rejects(() => learning.resolveContext({ actor: f.actor, attemptId, sessionId: "other-practice" }),
    { code: "VIBE64_TRAINING_SESSION_MISMATCH" });
  const current = await f.state.resumeAttempt({ actor: f.actor, attemptId });
  await f.state.endAttempt({ actor: f.actor, attemptId, expectedRevision: current.revision, requestId: "end-bound-practice", reason: "restart" });
  // The original preparation barrier refuses the now-ended reservation first.
  await assert.rejects(() => context.runLearningOperation(() => assert.fail()), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  assert.equal((await learning.readSessions({ actor: f.actor }))[0].sessionId, created.sessionId);
});

// Uses the original installed fixture, Core/Project/Git/Runtime source creator,
// and saved preparation owner. No provider/native work or fabricated setup pass.
async function historicalPracticeFixture(t, { archived = false } = {}) {
  const f = await fixture(t);
  const [{ createStudioProjectContext }, { createService: createProject }, { createManagedProjectRepositoryService },
    { createSessionSource }, { createTrainingLearningSessions }, { upgradeLearningPracticeHistory }, { createService: createSessions }] = await Promise.all([
    import("../../packages/vibe64-core/src/server/studioProjectContext.js"),
    import("../../packages/vibe64-project/src/server/service.js"),
    import("../../packages/vibe64-project/src/server/managedRepository.js"),
    import("../../packages/vibe64-terminals/src/server/sessionSource.js"),
    import("../../packages/vibe64-training/src/server/learningSessions.js"),
    import("../../packages/vibe64-training/src/server/practiceHistoryUpgrade.js"),
    import("../../packages/vibe64-sessions/src/server/service.js")
  ]);
  const core = createStudioProjectContext({ explicitTargetRoot: f.sourceRoot, explicitSystemRoot: f.systemRoot,
    explicitManagedSourceRoot: path.join(f.root, "managed-source"), home: f.root, runtimeProfile: { local: true } });
  const project = createProject({ projectContext: core });
  const repository = createManagedProjectRepositoryService({ projectContext: core, projectService: project });
  const reserved = await f.reserve();
  await f.state.beginPreparation({ actor: f.actor, attemptId: reserved.attempt.attemptId, expectedRevision: reserved.revision });
  const saved = await f.state.readExerciseProjectScope({ actor: f.actor, attemptId: reserved.attempt.attemptId, access: "create" });
  const content = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  const exercise = await content.readExercise({ ...f.pin.topic, lessonCode: f.pin.lesson.code, lessonHash: f.pin.lesson.hash });
  let legacyRuntime, initial, working, projectRecordPath, archiveOperation;
  await core.runWithPracticeProjectScope({ actor: f.actor, training: saved.training, access: "create" }, async () => {
    await repository.createManagedGitProject({ slug: saved.projectSlug, training: saved.training }, {
      async initializeProject({ projectRoot }) {
        for (const file of exercise.files) {
          await fs.mkdir(path.dirname(path.join(projectRoot, file.path)), { recursive: true });
          await fs.writeFile(path.join(projectRoot, file.path), file.bytes, { flag: "wx" });
        }
      }
    });
    const proof = await repository.verifyTrainingProjectSource({ slug: saved.projectSlug, training: saved.training }, { files: exercise.files });
    projectRecordPath = core.projectRecordPathForSlug(saved.projectSlug);
    await project.runInProjectContext(saved.projectSlug, async () => {
      legacyRuntime = await project.createRuntime({ inspectSource: false,
        createSessionSource: input => project.runProjectSourceExclusive(async () => createSessionSource({ ...input,
          project: await project.readCurrentProject() }), { operation: "session-source-create" }) });
      assert.equal(legacyRuntime.learningScope, null, "this is the original unflagged preparation source path");
      initial = await legacyRuntime.createSession({ sessionId: saved.initialSessionId, sourceContext: { expectedCommit: proof.commit, vibe64User: f.actor } });
      working = await legacyRuntime.createSession({ sessionId: "intentional-working", sourceContext: { expectedCommit: proof.commit, vibe64User: f.actor } });
      await legacyRuntime.store.writeMetadataValue(initial.sessionId, "agent_identity_conversation_id", "retain-original-native-identity");
      await legacyRuntime.store.writeConversationUserMessage(initial.sessionId, { text: "Retain these historical words" });
      if (archived) {
        // Actual original Sessions archive phases, original source recovery and
        // original Runtime tar publication. This fixture has no native work.
        let closes = 0;
        const sessions = createSessions({ project, terminals: { async closeSessionTerminals() { closes++; } },
          workspaceSetupRunner: { isRunning: () => false }, publishSessionChanged: async () => {} });
        const result = await sessions.archiveSession(initial.sessionId);
        assert.equal(result.ok, true, result.error);
        assert.equal(closes, 1);
        archiveOperation = (await legacyRuntime.store.readSession(initial.sessionId)).metadata.session_archive_operation;
        assert.equal(JSON.parse(archiveOperation).status, "running");
        assert.equal(JSON.parse(archiveOperation).phase, "source");
      }
    });
  });
  const backupRoot = path.join(f.systemRoot, "upgrades/backups/20261008-learning-practice-history");
  const messages = [];
  const run = (apply = false, report = (level, message) => messages.push({ level, message })) => upgradeLearningPracticeHistory({
    systemRoot: f.systemRoot, backupRoot, apply, report });
  const learning = createTrainingLearningSessions({ learners: f.state,
    teachingBrief: createTrainingTeachingBrief({ learners: f.state, content }), project,
    sessions: { ...createSessions({ project, terminals: { async closeSessionTerminals() {} },
      workspaceSetupRunner: { isRunning: () => false }, publishSessionChanged: async () => {} }),
      createSession() { assert.fail("historical open must not create a session"); } }, projectContext: core, practiceSessions: true });
  return { ...f, core, project, repository, content, saved, legacyRuntime, initial, working, projectRecordPath, archiveOperation, backupRoot, messages, run, learning };
}

test("historical practice adoption validates the original saved initial source session without promoting preparation or rewriting progress", async t => {
  const f = await historicalPracticeFixture(t);
  const { runWithProjectRequestContext } = await import("../../packages/vibe64-core/src/server/projectRequestContext.js");
  const progress = await fs.readFile(f.paths.progress);
  const active = await fs.readFile(f.paths.active);
  const source = await fs.readFile(path.join(f.initial.sourcePath, "server.mjs"));
  const working = await f.legacyRuntime.store.readSession(f.working.sessionId);
  const native = await fs.readFile(path.join(f.legacyRuntime.store.paths(f.initial.sessionId).metadataRoot, "agent_identity_conversation_id"));
  const before = await treeState(f.systemRoot);
  await f.run();
  assert.deepEqual(await treeState(f.systemRoot), before, "check writes no installation state");
  await assert.rejects(f.learning.resolveContext({ actor: f.actor, attemptId: f.saved.scope.attemptId,
    sessionId: f.initial.sessionId, access: "observe" }), { code: "vibe64_learning_session_scope_mismatch" });
  await f.run(true);
  const context = await f.learning.resolveContext({ actor: f.actor, attemptId: f.saved.scope.attemptId,
    sessionId: f.initial.sessionId, access: "observe" });
  await runWithProjectRequestContext(context, async () => {
    const runtime = await f.project.createRuntime({ inspectSource: false });
    assert.deepEqual(runtime.learningScope, f.saved.scope);
    assert.equal((await runtime.store.readSession(f.initial.sessionId)).metadata.agent_identity_conversation_id, "retain-original-native-identity");
  });
  const summaries = await f.learning.readSessions({ actor: f.actor });
  assert.deepEqual(summaries.map(value => value.sessionId), [f.initial.sessionId]);
  assert.equal(summaries[0].noExercise, false);
  assert.deepEqual(await f.legacyRuntime.store.readSession(f.working.sessionId), working);
  assert.deepEqual(await fs.readFile(f.paths.progress), progress);
  assert.deepEqual(await fs.readFile(f.paths.active), active);
  assert.deepEqual(await fs.readFile(path.join(f.initial.sourcePath, "server.mjs")), source);
  assert.deepEqual(await fs.readFile(path.join(f.legacyRuntime.store.paths(f.initial.sessionId).metadataRoot, "agent_identity_conversation_id")), native);
  assert.equal((await f.state.readState({ actor: f.actor })).active.preparation.phase, "preparing", "adoption is not a setup success or lesson proof");
  const manifest = await fs.readFile(path.join(f.backupRoot, "manifest.json"));
  await f.run(true);
  assert.deepEqual(await fs.readFile(path.join(f.backupRoot, "manifest.json")), manifest, "retry preserves original publisher manifest");
});

test("historical archived practice retry revalidates the frozen binding against saved ownership and retains archive history", async t => {
  const f = await historicalPracticeFixture(t, { archived: true });
  const archivePath = path.join(f.legacyRuntime.store.paths().archivedSessionsRoot, `${f.initial.sessionId}.tar.gz`);
  const original = await fs.readFile(archivePath);
  await assert.rejects(f.run(true, (_level, message) => {
    if (message.startsWith("Published state:") && message.endsWith(".tar.gz")) throw new Error("interrupted historical archive publication");
  }), /interrupted historical archive publication/u);
  const manifest = await fs.readFile(path.join(f.backupRoot, "manifest.json"));
  const savedRecord = JSON.parse(await fs.readFile(f.projectRecordPath, "utf8"));
  await updateProjectRecordMetadata(f.projectRecordPath, { ...savedRecord,
    training: { ...savedRecord.training, learnerKey: Buffer.from("other-owner").toString("base64url") } });
  const partial = await fs.readFile(archivePath);
  await assert.rejects(f.run(true), /differs from its saved Training marker/u);
  assert.deepEqual(await fs.readFile(archivePath), partial);
  assert.deepEqual(await fs.readFile(path.join(f.backupRoot, "manifest.json")), manifest);
  await updateProjectRecordMetadata(f.projectRecordPath, savedRecord);
  await f.run(true);
  const recordPath = path.join(f.legacyRuntime.store.paths().archivedSessionsRoot, `${f.initial.sessionId}.json`);
  const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
  assert.deepEqual(JSON.parse(record.index.metadata.learning_session), { schemaVersion: 1, ...f.saved.scope, conversationId: f.initial.sessionId });
  // The successful original archive keeps its running/source marker; migration
  // validates published pair/status, not an invented cleared/completed marker.
  const { createVibe64SessionStore } = await import("@local/vibe64-runtime/server");
  const bound = createVibe64SessionStore({ projectContextRoot: f.legacyRuntime.projectContextRoot,
    projectRuntimeRoot: f.legacyRuntime.stateRoot, projectSessionSourceRoot: f.legacyRuntime.projectSessionSourceRoot, learningScope: f.saved.scope });
  assert.equal((await bound.readSession(f.initial.sessionId)).metadata.session_archive_operation, f.archiveOperation);
  const beforeArchive = path.join(f.backupRoot, "before", path.relative(f.systemRoot, archivePath));
  assert.deepEqual(await fs.readFile(beforeArchive), original);
  assert.deepEqual(await fs.readFile(path.join(f.backupRoot, "manifest.json")), manifest);
  const afterArchive = path.join(f.backupRoot, "after", path.relative(f.systemRoot, archivePath));
  await fs.writeFile(afterArchive, "corrupt frozen archive");
  await assert.rejects(f.run(true), /archive/u);
  assert.deepEqual(await fs.readFile(path.join(f.backupRoot, "manifest.json")), manifest);
});

test("historical practice adoption rejects conflicting normal and author-preview claims and malformed production progress", async t => {
  const f = await historicalPracticeFixture(t);
  const previewRoot = path.join(f.systemRoot, "author-preview");
  const previewUser = path.join(previewRoot, "training/users", Buffer.from("42").toString("base64url"));
  await fs.mkdir(previewUser, { recursive: true, mode: 0o700 });
  await fs.copyFile(f.paths.progress, path.join(previewUser, "progress.json"));
  await fs.copyFile(f.paths.active, path.join(previewUser, "active-lesson.json"));
  const before = await treeState(f.systemRoot);
  await assert.rejects(f.run(true), /multiple saved learner namespaces/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
  await fs.rm(previewRoot, { recursive: true });
  await fs.writeFile(f.paths.progress, '{"schemaVersion":1,"retained":"invalid-original"}\n');
  const invalid = await treeState(f.systemRoot);
  await assert.rejects(f.run(true));
  assert.deepEqual(await treeState(f.systemRoot), invalid);
  await assert.rejects(fs.access(path.join(f.backupRoot, "manifest.json")), { code: "ENOENT" });
});

test("post-upgrade original Preparation resumes the same still-pending initial source session with no new session or pin", async t => {
  const f = await historicalPracticeFixture(t);
  const { createTrainingService } = await import("../../packages/vibe64-training/src/server/preparation.js");
  const beforeManifest = await fs.readFile(f.legacyRuntime.store.paths(f.initial.sessionId).manifestPath);
  const beforeSource = await fs.readFile(path.join(f.initial.sourcePath, "server.mjs"));
  await f.run(true);
  const preparation = createTrainingService({ catalogue: createInstalledTrainingCatalogue({ systemRoot: f.systemRoot }),
    content: f.content, learners: f.state, projectContext: f.core, projectRepositoryService: f.repository,
    project: f.project, learningSessions: f.learning,
    sessions: { createSession() { assert.fail("Resume must retain the already-adopted exact initial session"); } },
    terminals: { workspaceSetupIsPrepared() { assert.fail("this fixture has no successful Workspace setup to claim"); } } });
  const resumed = await preparation.prepareLesson({ actor: f.actor, attemptId: f.saved.scope.attemptId });
  assert.equal(resumed.attempt.preparation.initialSessionId, f.initial.sessionId);
  assert.equal(resumed.attempt.preparation.phase, "preparing");
  assert.equal(resumed.previewReady, false);
  assert.deepEqual(resumed.attempt.pin, f.pin);
  assert.deepEqual(await fs.readFile(f.legacyRuntime.store.paths(f.initial.sessionId).manifestPath), beforeManifest);
  assert.deepEqual(await fs.readFile(path.join(f.initial.sourcePath, "server.mjs")), beforeSource);
  assert.deepEqual((await f.learning.readSessions({ actor: f.actor })).map(value => value.sessionId), [f.initial.sessionId]);
});

test("saved ready historical preparation is adopted only at its original initial session and missing ready state is not replaced", async t => {
  const f = await historicalPracticeFixture(t);
  // Original owner writes a supported saved-ready fixture. This is schema and
  // correlation evidence, not a claim that this fixture ran Workspace setup.
  const current = await f.state.resumeAttempt({ actor: f.actor, attemptId: f.saved.scope.attemptId });
  await f.state.recordPreparationReady({ actor: f.actor, attemptId: f.saved.scope.attemptId,
    initialSessionId: f.initial.sessionId, expectedRevision: current.revision });
  const progress = await fs.readFile(f.paths.progress);
  const active = await fs.readFile(f.paths.active);
  await f.run(true);
  assert.deepEqual(await fs.readFile(f.paths.progress), progress);
  assert.deepEqual(await fs.readFile(f.paths.active), active);
  assert.equal((await f.state.readState({ actor: f.actor })).active.preparation.phase, "ready");
  assert.deepEqual((await f.learning.readSessions({ actor: f.actor })).map(value => value.sessionId), [f.initial.sessionId]);
  await fs.rm(f.legacyRuntime.store.paths(f.initial.sessionId).sessionRoot, { recursive: true });
  const missing = await treeState(f.systemRoot);
  await assert.rejects(f.run(true), /no original state for its frozen replacement/u);
  assert.deepEqual(await treeState(f.systemRoot), missing);
  assert.deepEqual(await fs.readFile(f.paths.progress), progress);
});
