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
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";

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
  await write("training/exercises/app/genesis/stack.md", '# Stack\n\n## Components\n\n## Workspace setup\n\n- Prepare `Check syntax` with `nodejs`: `node` `--check` `server.mjs`\n\n## Outputs\n\n### Target `app`: Practice app\n\n- Default.\n- Mode: `interactive`\n- Workdir: `.`\n- Runtimes: `nodejs`\n- Run `Start`: `node` `server.mjs` `--host` `{host}` `--port` `{port}`\n\n#### Presentation\n\n- Kind: `web`\n- Preferred port: `8080`\n- URL path: `/`\n- Ready when: `GET` `/` returns `200`\n');
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

test("a lesson without an exercise reserves no practice project, and only that lesson may omit one", async t => {
  const f = await fixture(t, { noExercise: true });
  const reserved = await f.reserve();
  assert.deepEqual(Object.keys(reserved.attempt).sort(), ["attemptId", "createdAt", "pin", "requestIds"]);
  assert.deepEqual(Object.keys(reserved.active).sort(), ["attemptId", "learnerId", "pin", "progressRevision", "schemaVersion"]);
  const { attemptId } = reserved.attempt;
  assert.deepEqual((await f.state.readState({ actor: f.actor, includeCompletion: true })).progress.attempts, [reserved.attempt]);
  assert.deepEqual(await f.state.readLearningMode({ actor: f.actor }), { on: true, attemptId, lessonCode: "INTRO-01", practiceSlug: "", projectSlugs: [] });
  await assert.rejects(() => f.state.beginPreparation({ actor: f.actor, attemptId, expectedRevision: 1 }), { code: "VIBE64_TRAINING_EXERCISE_MISSING" });
  await f.state.endAttempt({ actor: f.actor, attemptId, requestId: "end-1", expectedRevision: 1, reason: "left" });
  await assert.rejects(() => f.reserve({ requestId: "continue-1", expectedRevision: 2, practiceId: attemptId }), /invalid attempt identity/u);

  // vibe64 0.1.35 reserved a slug for every lesson; published upgrades still read that progress.
  const progress = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  const projectSlug = `training-${attemptId.replaceAll("-", "")}`;
  progress.attempts[0] = { ...progress.attempts[0], projectSlug, preparation: { phase: "reserved" } };
  await f.write("progress.json", progress, f.paths.root);
  assert.equal((await f.state.readState({ actor: f.actor, includeCompletion: true })).progress.attempts[0].projectSlug, projectSlug);
  progress.attempts[0].preparation = { phase: "preparing", initialSessionId: `training-${attemptId}` };
  await f.write("progress.json", progress, f.paths.root);
  await assert.rejects(() => f.state.readState({ actor: f.actor, includeCompletion: true }), /exactly when its lesson declares an exercise/u);
  delete progress.attempts[0].preparation;
  await f.write("progress.json", progress, f.paths.root);
  await assert.rejects(() => f.state.readState({ actor: f.actor }), { code: "VIBE64_TRAINING_STATE_INVALID" });

  const withExercise = await fixture(t);
  const exercise = await withExercise.reserve();
  const saved = JSON.parse(await fs.readFile(withExercise.paths.progress, "utf8"));
  delete saved.attempts[0].projectSlug;
  delete saved.attempts[0].preparation;
  await withExercise.write("progress.json", saved, withExercise.paths.root);
  await withExercise.write("active-lesson.json", { schemaVersion: 1, learnerId: "42", progressRevision: 1,
    attemptId: exercise.attempt.attemptId, pin: withExercise.pin }, withExercise.paths.root);
  await assert.rejects(() => withExercise.state.readState({ actor: withExercise.actor, includeCompletion: true }), /exactly when its lesson declares an exercise/u);
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

test("preparation exclusion waits for a short holder instead of refusing a concurrent browser receipt", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId };
  const entered = Promise.withResolvers();
  const order = [];
  // A Preview output start holds the barrier briefly while a presentation ACK arrives.
  const holder = f.state.runPreparationExclusive(input, async () => {
    entered.resolve();
    await new Promise(resolve => setTimeout(resolve, 300));
    order.push("holder");
  });
  await entered.promise;
  const started = Date.now();
  assert.equal(await f.state.runPreparationExclusive(input, () => { order.push("receipt"); return "receipt"; }), "receipt");
  await holder;
  assert.deepEqual(order, ["holder", "receipt"]);
  assert.ok(Date.now() - started < 5000);
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

test("explicit end retains the pinned attempt and fresh reserve creates new project/session identities without resurrecting replays", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const prepared = await f.state.beginPreparation({ actor: f.actor, attemptId, expectedRevision: reserved.revision });
  const previous = await f.state.readState({ actor: f.actor });
  const attempt = previous.progress.attempts[0];
  const input = { actor: f.actor, attemptId, requestId: "end-first", expectedRevision: previous.revision, reason: "left" };
  const ended = await f.state.runPreparationExclusive(input, () => f.state.endAttempt(input));
  assert.equal(ended.replayed, false);
  assert.equal(ended.active, null);
  assert.deepEqual(ended.attempt, { ...attempt, ended: { requestId: "end-first", revision: previous.revision + 1, reason: "left" } });
  assert.deepEqual(JSON.parse(await fs.readFile(f.paths.active, "utf8")), {
    schemaVersion: 1, learnerId: "42", progressRevision: ended.revision, attemptId: null
  });
  await assert.rejects(() => fs.lstat(path.join(f.systemRoot, "projects")), { code: "ENOENT" });
  const next = await f.reserve({ requestId: "new-exercise", expectedRevision: ended.revision });
  assert.notEqual(next.attempt.attemptId, attemptId);
  assert.notEqual(next.attempt.projectSlug, attempt.projectSlug);
  const nextPrepared = await f.state.beginPreparation({ actor: f.actor, attemptId: next.attempt.attemptId, expectedRevision: next.revision });
  assert.notEqual(nextPrepared.attempt.preparation.initialSessionId, prepared.attempt.preparation.initialSessionId);
  const current = await f.state.readState({ actor: f.actor });
  assert.deepEqual(current.progress.attempts[0], ended.attempt);
  const before = await treeState(f.systemRoot);
  assert.deepEqual(await f.state.endAttempt({ ...input, expectedRevision: 0 }), {
    revision: current.revision, attempt: ended.attempt, active: current.active, replayed: true
  });
  assert.equal((await f.reserve()).attempt.attemptId, attemptId);
  assert.equal((await f.reserve()).attempt.ended.reason, "left");
  await assert.rejects(() => f.state.endAttempt({ ...input, reason: "discard" }), error => error.code === "VIBE64_TRAINING_REQUEST_CONFLICT");
  await assert.rejects(() => f.state.endAttempt({ ...input, attemptId: next.attempt.attemptId }), error => error.code === "VIBE64_TRAINING_REQUEST_CONFLICT");
  await assert.rejects(() => f.reserve({ requestId: "end-first" }), error => error.code === "VIBE64_TRAINING_REQUEST_CONFLICT");
  for (const operation of [
    () => f.state.resumeAttempt(input),
    () => f.state.beginPreparation({ ...input, expectedRevision: current.revision }),
    () => f.state.runPreparationExclusive(input, () => assert.fail("Ended attempt must not admit project effects."))
  ]) await assert.rejects(operation, error => error.code === "VIBE64_TRAINING_ATTEMPT_MISSING");
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("continuing a practice project reserves a new attempt in the same practice and learning mode names it", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.state.readLearningMode({ actor: f.actor }), { on: false });
  const first = await f.reserve();
  const practiceId = first.attempt.attemptId;
  assert.equal(first.attempt.practiceId, undefined, "a fresh attempt is its own practice");
  assert.deepEqual(await f.state.readLearningMode({ actor: f.actor }), { on: true, attemptId: practiceId,
    lessonCode: "INTRO-01", practiceSlug: "", projectSlugs: [] });
  const prepared = await f.state.beginPreparation({ actor: f.actor, attemptId: practiceId, expectedRevision: first.revision });
  const mode = await f.state.readLearningMode({ actor: f.actor, includeTitle: true });
  assert.deepEqual(mode, { on: true, attemptId: practiceId, lessonCode: "INTRO-01", practiceSlug: first.attempt.projectSlug,
    projectSlugs: [first.attempt.projectSlug], lessonTitle: "Try the practice app" });
  assert.equal((await f.state.activeAttemptForPractice({ actor: f.actor, practiceId })).attemptId, practiceId);
  const ended = await f.state.endAttempt({ actor: f.actor, attemptId: practiceId, requestId: "leave-1",
    expectedRevision: prepared.revision, reason: "left" });
  assert.equal(await f.state.activeAttemptForPractice({ actor: f.actor, practiceId }), null);
  const otherPin = { ...f.pin, lesson: { ...f.pin.lesson, code: "INTRO-02" } };
  await assert.rejects(() => f.reserve({ requestId: "wrong-lesson", expectedRevision: ended.revision, practiceId, pin: otherPin }));
  const next = await f.reserve({ requestId: "continue-1", expectedRevision: ended.revision, practiceId });
  assert.notEqual(next.attempt.attemptId, practiceId);
  assert.equal(next.attempt.practiceId, practiceId);
  assert.equal(next.attempt.projectSlug, first.attempt.projectSlug, "the same practice project continues");
  await assert.rejects(() => f.reserve({ requestId: "continue-1", expectedRevision: 0 }), { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  await assert.rejects(() => f.reserve({ requestId: "other-practice", expectedRevision: next.revision, practiceId: randomUUID() }),
    { code: "VIBE64_TRAINING_ATTEMPT_CONFLICT" });
  const continued = await f.state.beginPreparation({ actor: f.actor, attemptId: next.attempt.attemptId, expectedRevision: next.revision,
    initialSessionId: prepared.attempt.preparation.initialSessionId });
  assert.equal(continued.attempt.preparation.initialSessionId, `training-${practiceId}`);
  // The practice project resolves to the continued attempt, which admits work
  // there; the attempt-keyed published-upgrade reader refuses it.
  const scope = await f.state.readPracticeProjectScope({ actor: f.actor, practiceId, access: "write" });
  assert.equal(scope.practiceId, practiceId);
  assert.equal(scope.scope.attemptId, next.attempt.attemptId);
  assert.equal(scope.active, true);
  assert.equal(scope.projectSlug, first.attempt.projectSlug);
  assert.equal(scope.initialSessionId, `training-${practiceId}`);
  assert.deepEqual(Object.keys(scope.training).sort(), ["exercise", "learnerKey", "pin", "practiceId", "schemaVersion"]);
  assert.equal(scope.training.schemaVersion, 2);
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: f.actor, attemptId: next.attempt.attemptId }),
    { code: "VIBE64_TRAINING_ATTEMPT_CONFLICT" });
  assert.equal((await f.state.activeAttemptForPractice({ actor: f.actor, practiceId })).attemptId, next.attempt.attemptId);
  const left = await f.state.endAttempt({ actor: f.actor, attemptId: next.attempt.attemptId, requestId: "leave-2",
    expectedRevision: continued.revision, reason: "left" });
  const afterLeave = await f.state.readPracticeProjectScope({ actor: f.actor, practiceId, access: "control" });
  assert.equal(afterLeave.scope.attemptId, next.attempt.attemptId, "the latest retained attempt names the project");
  assert.equal(afterLeave.active, false);
  await assert.rejects(() => f.state.readPracticeProjectScope({ actor: f.actor, practiceId, access: "write" }),
    { code: "VIBE64_TRAINING_ATTEMPT_INACTIVE" });
  await assert.rejects(() => f.state.readPracticeProjectScope({ actor: f.actor, practiceId: randomUUID() }),
    { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await assert.rejects(() => f.state.readPracticeProjectScope({ actor: f.actor, practiceId: "../practice" }));
  assert.equal(left.active, null);
});

test("retired format-1 learning records stay readable and count toward completion at their exact pin", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const ended = await f.state.endAttempt({ actor: f.actor, attemptId: reserved.attempt.attemptId, requestId: "end-v1",
    expectedRevision: reserved.revision, reason: "finished" });
  const progress = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  const attemptId = progress.attempts[0].attemptId;
  progress.attempts[0].learning = { submissions: [{ submissionId: "saved-answer", assessmentId: "explain", kind: "answer", rubric: "lesson.md#explain",
    rubricRevision: f.pin.lesson.hash, outcome: "passed", assistance: "none", explanation: "The saved answer met the rubric.",
    recordedAt: "2026-10-06T01:00:00.000Z", evidence: { kind: "answer", learnerId: "42", attemptId, messageId: "message-1",
      questionId: "question-1", text: "The browser asks and the server answers." } }] };
  await f.write("progress.json", progress, f.paths.root);
  const state = await f.state.readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual(state.progress.attempts[0].learning, progress.attempts[0].learning);
  assert.deepEqual(state.lessonCompletions, [{ lessonCode: "INTRO-01", lessonHash: f.pin.lesson.hash, required: 1, passed: 1,
    completed: true, open: false }]);
  const next = await f.reserve({ requestId: "start-again", expectedRevision: ended.revision });
  assert.equal((await f.state.resumeAttempt({ actor: f.actor, attemptId: next.attempt.attemptId })).completion.completed, true);
  progress.attempts[0].learning.submissions[0].rubric = "lesson.md#other";
  progress.attempts.push(...JSON.parse(await fs.readFile(f.paths.progress, "utf8")).attempts.slice(1));
  Object.assign(progress, { revision: next.revision, activeAttemptId: next.attempt.attemptId });
  await f.write("progress.json", progress, f.paths.root);
  await assert.rejects(() => f.state.readState({ actor: f.actor, includeCompletion: true }), /exact pinned assessment/u);
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
    const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, requestId: "end-1", expectedRevision: 1, reason: "left" };
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

// Step results live with the lesson content and code ledgers with the practice
// project, so a new attempt beyond 32 drops only the oldest ended attempt.
test("a 33rd attempt prunes the oldest ended attempt and the total byte bound still refuses growth", async t => {
  const f = await fixture(t, { learning: true });
  let state = await f.state.readState({ actor: f.actor });
  for (let index = 0; index < 32; index++) {
    const reserved = await f.reserve({ requestId: `start-${index}`, expectedRevision: state.revision });
    state = await f.state.endAttempt({ actor: f.actor, attemptId: reserved.attempt.attemptId,
      requestId: `end-${index}`, expectedRevision: reserved.revision, reason: "left" });
  }
  const valid = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  assert.equal(valid.attempts.length, 32);
  assert.equal(valid.activeAttemptId, null);
  assert.equal((await f.reserve({ requestId: "start-0", expectedRevision: 0 })).attempt.attemptId, valid.attempts[0].attemptId);
  const pruned = await f.reserve({ requestId: "start-33", expectedRevision: state.revision });
  const kept = JSON.parse(await fs.readFile(f.paths.progress, "utf8"));
  assert.equal(kept.attempts.length, 32);
  assert.deepEqual(kept.attempts.map(value => value.attemptId), [...valid.attempts.slice(1).map(value => value.attemptId), pruned.attempt.attemptId]);
  await f.write("reader.json", { schemaVersion: 1, learnerId: "42", attemptId: valid.attempts[0].attemptId, stepId: "explain", scroll: 0 }, f.paths.root);
  assert.equal(await f.state.readReader({ actor: f.actor }), null, "a pruned attempt has no reader position");
  await f.state.endAttempt({ actor: f.actor, attemptId: pruned.attempt.attemptId, requestId: "end-33", expectedRevision: pruned.revision, reason: "discard" });
  const ninth = randomUUID();
  const oversized = { ...valid, revision: valid.revision + 2, attempts: [...valid.attempts, {
    ...valid.attempts[0], attemptId: ninth, projectSlug: `training-${ninth.replaceAll("-", "")}`,
    requestIds: ["ninth-reservation"], ended: { requestId: "ninth-end", revision: valid.revision + 2, reason: "discard" }
  }] };
  await f.write("progress.json", oversized, f.paths.root);
  const invalidBefore = await treeState(f.systemRoot);
  await assert.rejects(() => f.state.readState({ actor: f.actor }), error => error.code === "VIBE64_TRAINING_STATE_INVALID" &&
    /Expected at most 32 items/u.test(JSON.stringify(error.cause?.fieldErrors)));
  assert.deepEqual(await treeState(f.systemRoot), invalidBefore);
  await f.write("progress.json", valid, f.paths.root);
  // Fill only valid bounded fields until an end's prospective pretty-printed
  // record would exceed the shared byte budget; no receipt is evicted to fit.
  // Eight attempts with maximal learning still fill the byte bound exactly.
  const bytesFull = structuredClone({ ...valid, attempts: valid.attempts.slice(0, 8) });
  bytesFull.revision = bytesFull.attempts[7].ended.revision;
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
    requestId: "end-1", expectedRevision: first.revision, reason: "left" });
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
      () => f.state.endAttempt({ actor: f.actor, attemptId: first.attempt.attemptId, requestId: "end-1", expectedRevision: 0, reason: "left" })]) {
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

test("exercise project scope reads the exact saved learner and installed exercise without writes", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const before = await treeState(f.systemRoot);
  const saved = await f.state.readExerciseProjectScope({ actor: f.actor, attemptId, access: "create" });
  // The attempt-keyed reader stays the version 1 marker its published upgrade
  // compares; the practice-keyed reader gives the learning-space marker.
  assert.deepEqual(saved, { scope: { learnerId: "42", attemptId, pin: f.pin, noExercise: false }, systemRoot: f.systemRoot,
    training: { schemaVersion: 1, learnerKey: "NDI", attemptId, pin: f.pin,
    exercise: { kind: "bundled", sourcePath: "training/exercises/app" } },
    projectSlug: reserved.attempt.projectSlug, active: true, activeSummaryCurrent: true });
  assert.deepEqual(await f.state.readPracticeProjectScope({ actor: f.actor, practiceId: attemptId, access: "create" }), {
    scope: { learnerId: "42", attemptId, pin: f.pin, noExercise: false }, systemRoot: f.systemRoot,
    practiceId: attemptId, training: { schemaVersion: 2, learnerKey: "NDI", practiceId: attemptId, pin: f.pin,
    exercise: { kind: "bundled", sourcePath: "training/exercises/app" } },
    projectSlug: reserved.attempt.projectSlug, active: true, activeSummaryCurrent: true });
  saved.training.pin.lesson.hash = "e".repeat(64);
  assert.deepEqual((await f.state.readExerciseProjectScope({ actor: f.actor, attemptId })).training.pin, f.pin);
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: { uid: 43 }, attemptId }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: f.actor, attemptId: "../attempt" }));
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: f.actor, attemptId, access: "all" }));
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
  await f.state.endAttempt({ actor: f.actor, attemptId, expectedRevision: resumed.revision, requestId: "practice-end", reason: "left" });
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
  assert.deepEqual((await f.state.readExerciseProjectScope({ actor: f.actor, attemptId })).scope, historical.scope,
    "damaged exercise bytes do not hide historical chat identity");
  const reader = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  await assert.rejects(() => reader.readExercise({ ...f.pin.topic, lessonCode: f.pin.lesson.code,
    lessonHash: f.pin.lesson.hash }), { code: "VIBE64_TRAINING_CONTENT_INVALID" });
  assert.deepEqual(await treeState(f.systemRoot), invalidBefore);
  const descriptor = path.join(f.systemRoot, "training/content", f.pin.topic.topicId, f.pin.topic.commit,
    "files/training/lessons/INTRO-01/lesson.json");
  await fs.writeFile(descriptor, "{}");
  await assert.rejects(() => f.state.readExerciseProjectScope({ actor: f.actor, attemptId }), { code: "VIBE64_TRAINING_CONTENT_INVALID" });
});

test("actual saved exercise caller admits only its same original local Project record inside the owning callback", async t => {
  const f = await fixture(t);
  const [{ createStudioProjectContext }, { createService: createProject }, { currentProjectRequestContext }] = await Promise.all([
    import("../../packages/vibe64-core/src/server/studioProjectContext.js"),
    import("../../packages/vibe64-project/src/server/service.js"),
    import("../../packages/vibe64-core/src/server/projectRequestContext.js")
  ]);
  const projectContext = createStudioProjectContext({ explicitTargetRoot: f.sourceRoot, explicitSystemRoot: f.systemRoot,
    explicitManagedSourceRoot: path.join(f.root, "managed-source"), home: f.root, runtimeProfile: { local: true, mode: "local" } });
  const project = createProject({ projectContext });
  // Practice projects are ordinary projects: the saved exercise scope is read
  // fresh and the original local practice admission owns the callback.
  const practice = async ({ actor, attemptId: id, access = "observe" }, operation) => {
    const saved = await f.state.readPracticeProjectScope({ actor, practiceId: id, access });
    return projectContext.runWithPracticeProjectScope({ actor, training: saved.training, access },
      operation && (() => operation({ projectSlug: saved.projectSlug })));
  };
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const scope = await f.state.readPracticeProjectScope({ actor: f.actor, practiceId: attemptId, access: "create" });
  const progressBefore = await fs.readFile(f.paths.progress);
  const activeBefore = await fs.readFile(f.paths.active);
  let captured;
  await practice({ actor: f.actor, attemptId, access: "create" }, async target => {
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
  await assert.rejects(() => practice({ actor: { uid: 43 }, attemptId }, () => assert.fail()), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await assert.rejects(() => practice({ actor: f.actor, attemptId }), /owning callback/u);
  const { runWithProjectRequestContext } = await import("../../packages/vibe64-core/src/server/projectRequestContext.js");
  await assert.rejects(() => runWithProjectRequestContext(captured, () => project.readCurrentProject()), { code: "vibe64_practice_scope_expired" });
  await practice({ actor: f.actor, attemptId }, async target => {
    const state = await projectContext.readWorkspaceProjectState({ slug: target.projectSlug });
    assert.deepEqual(state.metadata.training, scope.training);
  });
  // Component record admission is not exercise materialization, session creation,
  // setup success, native teaching or Preview acceptance.
});

test("a practice session is an ordinary local project session that stays the learner's after the lesson ends", async t => {
  const f = await fixture(t);
  const [{ createStudioProjectContext }, { createService: createProject }, { createService: createSessions },
    { createManagedProjectRepositoryService }, { createSessionSource },
    { assertProjectEffectAdmission, captureProjectRequestContext,
      runWithProjectRequestContext, runWithResolvedProjectRequestContext }] = await Promise.all([
    import("../../packages/vibe64-core/src/server/studioProjectContext.js"),
    import("../../packages/vibe64-project/src/server/service.js"),
    import("../../packages/vibe64-sessions/src/server/service.js"),
    import("../../packages/vibe64-project/src/server/managedRepository.js"),
    import("../../packages/vibe64-terminals/src/server/sessionSource.js"),
    import("../../packages/vibe64-core/src/server/projectRequestContext.js")
  ]);
  const core = createStudioProjectContext({ explicitTargetRoot: f.sourceRoot, explicitSystemRoot: f.systemRoot,
    explicitManagedSourceRoot: path.join(f.root, "managed-source"), home: f.root, runtimeProfile: { local: true } });
  const project = createProject({ projectContext: core });
  const repository = createManagedProjectRepositoryService({ projectContext: core, projectService: project });
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  await f.state.beginPreparation({ actor: f.actor, attemptId, expectedRevision: reserved.revision });
  const saved = await f.state.readPracticeProjectScope({ actor: f.actor, practiceId: attemptId, access: "create" });
  const installed = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  const exercise = await installed.readExercise({ ...f.pin.topic, lessonCode: f.pin.lesson.code, lessonHash: f.pin.lesson.hash });
  const selection = { agentId: "build", catalogRevision: `sha256:${"a".repeat(64)}`, engineId: "opencode", modelId: "big-pickle",
    modelProviderId: "opencode", schema: "vibe64.assistant-selection.v1", variantId: "" };
  let setupRuntime;
  const sessions = createSessions({ project, initializeModelRouting: async () => ({ ok: true }),
    readModelRoutingWorkflows: async () => ({ ok: true, workflows: [{ engineId: "opencode", available: true }] }),
    terminals: {
      async resolveAssistantPurpose() {
        return { available: true, effectiveSelection: selection, connectionIdentity: "controlled-original-account-seam" };
      },
      async requireAssistantSelectionAccess() {},
      async createSessionSource(input) {
        return project.runProjectSourceExclusive(async () => createSessionSource({ ...input,
          project: await project.readCurrentProject() }), { operation: "session-source-create" });
      }
    },
    workspaceSetupRunner: { isRunning: () => false, wait: () => null,
      start({ runtime }) { setupRuntime = runtime; return { completion: null }; } },
    publishSessionChanged: async () => {}
  });
  let created;
  // Preparation's own path: the learner's private practice scope with create.
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
    created = await sessions.createSession({ vibe64User: f.actor }, { sessionId: saved.initialSessionId, expectedCommit: proof.commit });
    assert.equal(created.ok, true, created.error);
  });
  assert.notEqual(created.purpose, "learning");
  assert.equal(created.learning, undefined, "no learning_session binding");
  assert.equal(created.sourceReady, true);
  assert.equal(setupRuntime.learningScope, null, "the session runtime is an ordinary project runtime");
  // The ordinary project route admits the learner's own practice slug with write.
  const openProject = (operation, actor = f.actor) => runWithResolvedProjectRequestContext({ projectContext: core,
    request: { params: { slug: saved.projectSlug }, headers: {}, vibe64User: actor } }, operation);
  let retained;
  await openProject(async () => {
    assert.doesNotThrow(assertProjectEffectAdmission);
    const runtime = await project.createRuntime({ inspectSource: false });
    assert.equal(runtime.learningScope, null);
    const listed = await runtime.store.listSessions();
    assert.deepEqual(listed.map(session => session.sessionId), [created.sessionId], "the ordinary store lists it");
    assert.equal(await runtime.store.readMetadataValue(created.sessionId, "learning_session"), "");
    retained = captureProjectRequestContext();
  });
  // Later work captured from that request (agent turns, helpers) keeps write.
  await runWithProjectRequestContext(retained, () => assert.doesNotThrow(assertProjectEffectAdmission));
  const current = await f.state.resumeAttempt({ actor: f.actor, attemptId });
  await f.state.endAttempt({ actor: f.actor, attemptId, expectedRevision: current.revision,
    requestId: "end-ordinary-practice", reason: "left" });
  await openProject(async () => {
    assert.doesNotThrow(assertProjectEffectAdmission, "the project stays writable after its lesson ends");
    const runtime = await project.createRuntime({ inspectSource: false });
    assert.equal((await runtime.store.readSession(created.sessionId)).sessionId, created.sessionId);
  });
  // Another person cannot open this learner's practice slug.
  await assert.rejects(openProject(() => assert.fail(), { uid: 43 }), { code: "vibe64_practice_project_deleted" });
});

test("admitted exercise scope validates once per fresh read and refuses changed content or returned identity", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const reader = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  const calls = [];
  const state = createTrainingLearnerState({ systemRoot: f.systemRoot, content: {
    async readLesson(input) { calls.push("lesson"); return reader.readLesson(input); },
    async readExercise(input) {
      calls.push("exercise");
      assert.equal(input.metadataOnly, true, "scope admission does not request preparation bytes");
      const result = await reader.readExercise(input);
      assert.equal(Object.hasOwn(result, "files"), false);
      return result;
    }
  } });
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, access: "create" };
  const before = await treeState(f.systemRoot);
  const first = await state.readExerciseProjectScope(input);
  assert.deepEqual(await state.readExerciseProjectScope(input), first);
  assert.deepEqual(calls, ["exercise", "exercise"]);
  assert.deepEqual(await treeState(f.systemRoot), before);
  for (const changed of [
    { pin: { ...f.pin.topic, release: "9.9.9" } },
    { lessonCode: "OTHER" },
    { lessonHash: "f".repeat(64) }
  ]) {
    const mismatched = createTrainingLearnerState({ systemRoot: f.systemRoot, content: {
      readLesson: reader.readLesson,
      async readExercise(value) { return { ...await reader.readExercise(value), ...changed }; }
    } });
    await assert.rejects(() => mismatched.readExerciseProjectScope(input), /installed topic differs from the admitted reservation pin/u);
  }
  const readerFailure = new Error("Existing exercise reader failure");
  const failed = createTrainingLearnerState({ systemRoot: f.systemRoot, content: {
    readLesson: reader.readLesson, async readExercise() { throw readerFailure; }
  } });
  await assert.rejects(() => failed.readExerciseProjectScope(input), error => error === readerFailure);
  await fs.writeFile(path.join(f.systemRoot, "training/content", f.pin.topic.topicId, f.pin.topic.commit,
    "files/training/exercises/app/server.mjs"), "changed after fresh admitted read");
  await assert.rejects(() => state.readExerciseProjectScope(input), { code: "VIBE64_TRAINING_CONTENT_INVALID" });
  assert.deepEqual(calls, ["exercise", "exercise", "exercise"]);
});

test("exercise scope preserves no-exercise pin inactive and unavailable-reader refusal precedence", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const reader = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  const calls = [];
  const unavailable = createTrainingLearnerState({ systemRoot: f.systemRoot, content: {
    async readLesson(input) { calls.push("lesson"); return reader.readLesson(input); }
  } });
  const input = { actor: f.actor, attemptId: reserved.attempt.attemptId, access: "create" };
  await assert.rejects(() => unavailable.readExerciseProjectScope(input), { code: "VIBE64_TRAINING_EXERCISE_UNAVAILABLE" });
  assert.deepEqual(calls, ["lesson"]);
  await f.state.endAttempt({ actor: f.actor, attemptId: input.attemptId,
    expectedRevision: reserved.revision, requestId: "validation-end", reason: "left" });
  await assert.rejects(() => unavailable.readExerciseProjectScope(input), { code: "VIBE64_TRAINING_ATTEMPT_INACTIVE" });
  assert.deepEqual(calls, ["lesson", "lesson"]);
  const wrongPin = createTrainingLearnerState({ systemRoot: f.systemRoot, content: {
    async readLesson(value) { const lesson = await reader.readLesson(value); return { ...lesson, pin: { ...lesson.pin, release: "9.9.9" } }; }
  } });
  await assert.rejects(() => wrongPin.readExerciseProjectScope(input), /installed topic differs from the admitted reservation pin/u);
  const absent = await fixture(t, { noExercise: true });
  const noExercise = await absent.reserve();
  const absentReader = createInstalledTrainingContent({ systemRoot: absent.systemRoot });
  const absentInput = { actor: absent.actor, attemptId: noExercise.attempt.attemptId, access: "create" };
  const absentBefore = await treeState(absent.systemRoot);
  await assert.rejects(() => absent.state.readExerciseProjectScope(absentInput), {
    code: "VIBE64_TRAINING_EXERCISE_MISSING", statusCode: 409,
    message: "This saved lesson has no practice project. Use its source-less learning conversation."
  });
  const absentUnavailable = createTrainingLearnerState({ systemRoot: absent.systemRoot, content: { readLesson: absentReader.readLesson } });
  await assert.rejects(() => absentUnavailable.readExerciseProjectScope(absentInput), { code: "VIBE64_TRAINING_EXERCISE_MISSING" });
  assert.deepEqual(await treeState(absent.systemRoot), absentBefore);
  await absent.state.endAttempt({ actor: absent.actor, attemptId: absentInput.attemptId,
    expectedRevision: noExercise.revision, requestId: "absent-validation-end", reason: "left" });
  await assert.rejects(() => absentUnavailable.readExerciseProjectScope(absentInput), { code: "VIBE64_TRAINING_EXERCISE_MISSING" });
  const progress = JSON.parse(await fs.readFile(absent.paths.progress, "utf8"));
  for (const changed of [{ release: "9.9.9" }, { repository: "different/learn-topic" }]) {
    progress.attempts[0].pin.topic = { ...absent.pin.topic, ...changed };
    await fs.writeFile(absent.paths.progress, `${JSON.stringify(progress)}\n`);
    await assert.rejects(() => absent.state.readExerciseProjectScope({ ...absentInput, access: "observe" }),
      /installed topic differs from the admitted reservation pin/u);
  }
});



