// The installed course catalogue a learner store reads: its exact immutable course releases, their enabling and
// disabling, its locks and bounds.

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { createCourseLock, readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";
import { createTrainingContentInstaller } from "../../packages/vibe64-training/src/server/contentInstaller.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createInstalledTrainingCatalogue } from "@local/vibe64-training/server/installed-catalogue";
import { failCleanupAfterRename, fixture, treeState } from "./vibe64TrainingLearnerStateTestHelpers.js";

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
  const descriptor = path.join(snapshot, "files/training/lessons/INTRO-01/steps/try.md");
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
  const cleanupFailure = failCleanupAfterRename(t, filename, "Fixture cleanup failure after catalogue rename");
  try {
    await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 0 }), error => error.code === "VIBE64_TRAINING_CATALOGUE_SAVE_UNCONFIRMED" && /may already have succeeded/u.test(error.message));
  } finally {
    cleanupFailure.restore();
  }
  const saved = await catalogue.readCatalogue();
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.courses, [{ ...input, enabled: true }]);
  await assert.rejects(() => catalogue.enableCourse({ ...input, expectedRevision: 0 }), error => error.code === "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT");
  assert.deepEqual(await catalogue.enableCourse({ ...input, expectedRevision: 1 }), { revision: 1, entry: saved.courses[0], changed: false });
  assert.deepEqual((await fs.readdir(path.join(f.systemRoot, "training"))).sort(), [".install-locks", "catalogue.json", "catalogue.lock", "content"]);
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
