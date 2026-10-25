import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { learnThreadFile, registerLearnThreadReleaser } from "@local/vibe64-core/server/learnThreads";
import { createStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { createProjectArchiveService } from "@local/vibe64-project/server/project-archive";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingLearningSpace, KEPT_ARCHIVED_PROJECTS, MAX_ARCHIVES } from "../../packages/vibe64-training/src/server/learningSpace.js";

// The attempt lifecycle in the learning space (Rev 4 C2) over the real
// learner store, core learning space and shared project archive service.
// Only the runtime close and Colleague's thread releaser are stubs.
const fixtureTopic = new URL("../fixtures/training/steps-v3/", import.meta.url);
const ALICE = { uid: 42, username: "alice", role: "member" };
const BOB = { uid: 43, username: "bob", role: "member" };
const key = actor => Buffer.from(String(actor.uid)).toString("base64url");

// One installed topic with two lessons: STEPS-ONE has a practice project,
// STEPS-ZERO (like Lesson 0) has none.
async function installTopic(root, systemRoot) {
  const source = path.join(root, "topic");
  await cp(fixtureTopic, source, { recursive: true });
  const descriptor = JSON.parse(await readFile(path.join(source, "lesson.json"), "utf8"));
  await writeFile(path.join(source, "zero.json"), JSON.stringify({ ...descriptor, code: "STEPS-ZERO", title: "Set yourself up", stage: "studio",
    visuals: [], exercise: undefined, checks: [], steps: descriptor.steps.filter(step => ["reflect", "read-more"].includes(step.id))
      .map(step => ({ ...step, required: step.id === "reflect" })) }));
  const manifest = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
  manifest.vibe64Training.lessons.push({ code: "STEPS-ZERO", descriptor: "zero.json", status: "published", required: true });
  await writeFile(path.join(source, "package.json"), JSON.stringify(manifest));
  const commit = "d".repeat(40), snapshotRoot = path.join(systemRoot, "training/content/steps", commit);
  await mkdir(path.dirname(snapshotRoot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshotRoot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshotRoot, "bundle.json"), "utf8"));
  const topic = { schemaVersion: 1, topicId: "steps", release: "0.1.0", repository: "examples/learn-steps-fixture", commit, topicHash: bundle.topicHash };
  await writeFile(path.join(snapshotRoot, "pin.json"), JSON.stringify(topic));
  const pin = code => ({ course: { courseId: "intro", release: "0.1.0" }, topic,
    lesson: { code, hash: bundle.lessons.find(value => value.code === code).hash } });
  return { practice: pin("STEPS-ONE"), zero: pin("STEPS-ZERO") };
}

async function fixture(t, { headroom = async () => {}, release = async () => {}, keptArchivedProjects } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-learning-space-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const released = [];
  t.after(registerLearnThreadReleaser(async input => { await release(input); released.push(input); }));
  const systemRoot = path.join(root, "system");
  const pins = await installTopic(root, systemRoot);
  const content = createInstalledTrainingContent({ systemRoot });
  const store = createTrainingLearnerState({ systemRoot, content });
  const working = path.join(root, "working");
  await mkdir(working);
  const projectContext = createStudioProjectContext({ explicitTargetRoot: working, explicitSystemRoot: systemRoot,
    explicitManagedSourceRoot: path.join(root, "managed-source"), home: root, runtimeProfile: { local: true } });
  const closed = [];
  const failClose = { next: false };
  const duringClose = { next: null };
  const projectArchive = createProjectArchiveService({ projectContext, assertArchiveHeadroom: headroom,
    async closeProjectRuntime({ slug }) {
      if (duringClose.next) { const check = duringClose.next; duringClose.next = null; await check(); }
      if (failClose.next) { failClose.next = false; return { ok: false }; }
      closed.push(slug);
      return { ok: true };
    } });
  const space = createTrainingLearningSpace({ learners: store, content, projectContext, projectArchive, keptArchivedProjects });

  let starts = 0;
  // A lesson in progress as preparation leaves it: with its practice project
  // when the lesson has one, and a teacher thread the person talked in.
  async function start(actor, { pin = pins.practice, requestId = `start-${++starts}` } = {}) {
    const { revision } = await store.readState({ actor });
    const reserved = await store.reserveAttempt({ actor, expectedRevision: revision, requestId, pin });
    const { attemptId } = reserved.attempt;
    let slug = "";
    if (reserved.attempt.projectSlug) {
      await store.beginPreparation({ actor, attemptId, expectedRevision: reserved.revision });
      slug = await createPractice(actor, attemptId, pin);
    }
    const thread = learnThreadFile({ systemRoot, learnerKey: key(actor), attemptId });
    await mkdir(path.dirname(thread), { recursive: true });
    await writeFile(thread, JSON.stringify({ conversation: attemptId }));
    return { attemptId, slug, thread };
  }

  async function createPractice(actor, attemptId, pin) {
    const training = { schemaVersion: 2, learnerKey: key(actor), practiceId: attemptId, pin,
      exercise: { kind: "bundled", sourcePath: "app" } };
    const slug = `training-${attemptId.replaceAll("-", "")}`;
    await projectContext.runWithPracticeProjectScope({ actor, training, access: "create" }, () =>
      projectContext.createWorkspaceProjectRecord({ slug, name: "Practice: STEPS-ONE", training }, {
        prepare: async ({ projectContextRoot }) => {
          await mkdir(path.join(projectContextRoot, "node_modules", "left-out"), { recursive: true });
          await writeFile(path.join(projectContextRoot, "notes.mjs"), "export const title = 'mine';\n");
        }
      }));
    return slug;
  }

  const progress = async actor => (await store.readState({ actor })).progress;
  const bundle = (actor, attemptId) => path.join(systemRoot, "training/practice-archives", key(actor), attemptId);
  return { root, systemRoot, pins, store, space, projectContext, start, progress, bundle, released, closed, failClose, duringClose,
    title: code => content.readLesson({ ...pins.practice.topic, lessonCode: code,
      lessonHash: (code === "STEPS-ZERO" ? pins.zero : pins.practice).lesson.hash }).then(value => value.lesson.title) };
}

test("the list shows the one lesson in progress with its practice project, only to its learner", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.space.list(ALICE), { current: null, archived: [] });
  const lesson = await f.start(ALICE);
  assert.deepEqual(await f.space.list(ALICE), { archived: [], current: { attemptId: lesson.attemptId,
    lesson: { code: "STEPS-ONE", title: await f.title("STEPS-ONE") }, slug: lesson.slug, status: "in-progress" } });
  assert.deepEqual(await f.space.list(BOB), { current: null, archived: [] }, "another learner sees nothing");
  assert.equal(await f.space.exists({ actor: ALICE, attemptId: lesson.attemptId }), true);
  assert.equal(await f.space.exists({ actor: BOB, attemptId: lesson.attemptId }), false);
  await assert.rejects(f.space.closeAttempt({ actor: BOB, attemptId: lesson.attemptId, archive: false, reason: "deleted" }),
    { code: "VIBE64_TRAINING_ATTEMPT_MISSING", statusCode: 404 });
  assert.equal((await f.progress(ALICE)).activeAttemptId, lesson.attemptId, "a refused close ends nothing");
});

test("archiving keeps one bundle per attempt: its record, its teacher conversation and its project", async t => {
  const f = await fixture(t);
  const lesson = await f.start(ALICE);
  const record = await f.store.readAttemptRecord({ actor: ALICE, attemptId: lesson.attemptId });
  assert.deepEqual(await f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" }),
    { ok: true, attemptId: lesson.attemptId, closed: true });
  const progress = await f.progress(ALICE);
  assert.equal(progress.activeAttemptId, null);
  assert.equal(progress.attempts[0].ended.reason, "archived");
  assert.deepEqual(f.released, [{ learnerKey: key(ALICE), attemptId: lesson.attemptId }], "Colleague released the thread");
  assert.deepEqual(f.closed, [lesson.slug]);
  assert.equal(await f.space.exists({ actor: ALICE, attemptId: lesson.attemptId }), false, "the project left the learning space");

  const directory = f.bundle(ALICE, lesson.attemptId);
  const saved = JSON.parse(await readFile(path.join(directory, "attempt.json"), "utf8"));
  assert.deepEqual({ ...saved, archivedAt: undefined }, { schemaVersion: 1, attemptId: lesson.attemptId, learnerKey: key(ALICE),
    pin: f.pins.practice, lessonTitle: await f.title("STEPS-ONE"), reason: "archived", createdAt: record.attempt.createdAt,
    archivedAt: undefined, stepProgress: record.stepProgress });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "conversation.json"), "utf8")), { conversation: lesson.attemptId });
  await assert.rejects(stat(lesson.thread), { code: "ENOENT" }, "the thread moved into the bundle");
  const [projectBundle] = await readdir(path.join(directory, "project", lesson.slug));
  assert.ok((await stat(path.join(directory, "project", lesson.slug, projectBundle))).isDirectory());

  assert.deepEqual(await f.space.list(ALICE), { current: null, archived: [{ attemptId: lesson.attemptId,
    lesson: { code: "STEPS-ONE", title: await f.title("STEPS-ONE") }, reason: "archived", archivedAt: saved.archivedAt, hasProject: true }] });
  assert.deepEqual((await f.space.list(BOB)).archived, [], "archives are per learner");
  assert.deepEqual(await f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" }),
    { ok: true, attemptId: lesson.attemptId, closed: false }, "closing again is done");

  await assert.rejects(f.space.deleteArchive({ actor: BOB, attemptId: lesson.attemptId }), { code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_MISSING" });
  await assert.rejects(f.space.deleteArchive({ actor: ALICE, attemptId: "../escape" }), { code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_MISSING" });
  assert.deepEqual(await f.space.deleteArchive({ actor: ALICE, attemptId: lesson.attemptId }),
    { ok: true, attemptId: lesson.attemptId, removed: true });
  assert.deepEqual(await f.space.list(ALICE), { current: null, archived: [] });
});

test("a lesson without a practice project (Lesson 0) archives its record and conversation only", async t => {
  const f = await fixture(t);
  const lesson = await f.start(ALICE, { pin: f.pins.zero });
  assert.equal(lesson.slug, "");
  assert.deepEqual((await f.space.list(ALICE)).current, { attemptId: lesson.attemptId,
    lesson: { code: "STEPS-ZERO", title: "Set yourself up" }, status: "in-progress" });
  await f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" });
  assert.deepEqual((await readdir(f.bundle(ALICE, lesson.attemptId))).sort(), ["attempt.json", "conversation.json"]);
  assert.equal((await f.progress(ALICE)).attempts[0].ended.reason, "archived");
  assert.deepEqual(f.closed, []);
  const [archived] = (await f.space.list(ALICE)).archived;
  assert.deepEqual({ reason: archived.reason, hasProject: archived.hasProject }, { reason: "archived", hasProject: false });
});

test("delete removes the project and the conversation with no archive", async t => {
  const f = await fixture(t);
  const lesson = await f.start(ALICE);
  assert.deepEqual(await f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: false, reason: "deleted" }),
    { ok: true, attemptId: lesson.attemptId, closed: true });
  assert.equal((await f.progress(ALICE)).attempts[0].ended.reason, "deleted");
  assert.deepEqual(f.closed, [lesson.slug]);
  assert.deepEqual(f.released, [{ learnerKey: key(ALICE), attemptId: lesson.attemptId }]);
  await assert.rejects(stat(lesson.thread), { code: "ENOENT" });
  await assert.rejects(stat(f.bundle(ALICE, lesson.attemptId)), { code: "ENOENT" });
  assert.deepEqual(await f.space.list(ALICE), { current: null, archived: [] });
  await assert.rejects(f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "deleted" }),
    TypeError, "only finished and archived keep a bundle");
});

test(`a learner keeps at most ${MAX_ARCHIVES} archives; the refusal changes nothing`, async t => {
  const f = await fixture(t);
  const learnerArchives = path.join(f.systemRoot, "training/practice-archives", key(ALICE));
  // A folder without a valid record (a close that stopped first) is not an archive.
  await mkdir(path.join(learnerArchives, "ffffffff-ffff-4fff-8fff-ffffffffffff"), { recursive: true });
  for (let index = 0; index < MAX_ARCHIVES; index++) {
    const attemptId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    await mkdir(path.join(learnerArchives, attemptId), { recursive: true });
    await writeFile(path.join(learnerArchives, attemptId, "attempt.json"), JSON.stringify({ schemaVersion: 1, attemptId,
      pin: f.pins.zero, lessonTitle: "Old", reason: "finished", archivedAt: new Date(index * 1000).toISOString() }));
  }
  const lesson = await f.start(ALICE);
  await assert.rejects(f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" }),
    { code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_LIMIT", statusCode: 409 });
  assert.equal((await f.progress(ALICE)).activeAttemptId, lesson.attemptId);
  assert.deepEqual([f.closed, f.released], [[], []]);
  assert.equal((await stat(lesson.thread)).isFile(), true);
  assert.equal((await f.space.list(ALICE)).archived.length, MAX_ARCHIVES);
  await f.space.deleteArchive({ actor: ALICE, attemptId: "00000000-0000-4000-8000-000000000000" });
  assert.equal((await f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" })).closed, true);
});

test("only the newest archives keep their practice project; records, conversations and the lesson in progress stay", async t => {
  assert.equal(KEPT_ARCHIVED_PROJECTS, 3);
  const f = await fixture(t, { keptArchivedProjects: 1 });
  // Another learner's archived project is never this learner's to remove.
  const bobProject = path.join(f.bundle(BOB, "ffffffff-ffff-4fff-8fff-ffffffffffff"), "project", "kept");
  await mkdir(bobProject, { recursive: true });
  const archive = lesson => f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" });
  const projects = async () => (await f.space.list(ALICE)).archived.map(value => [value.attemptId, value.hasProject]);

  const first = await f.start(ALICE);
  await archive(first);
  const zero = await f.start(ALICE, { pin: f.pins.zero });
  await archive(zero);
  assert.deepEqual(await projects(), [[zero.attemptId, false], [first.attemptId, true]], "an archive without a project takes no place");

  const second = await f.start(ALICE);
  await archive(second);
  assert.deepEqual(await projects(), [[second.attemptId, true], [zero.attemptId, false], [first.attemptId, false]]);
  assert.deepEqual((await readdir(f.bundle(ALICE, first.attemptId))).sort(), ["attempt.json", "conversation.json"],
    "the oldest archive keeps its record and conversation");

  const current = await f.start(ALICE);
  assert.equal(await f.space.exists({ actor: ALICE, attemptId: current.attemptId }), true, "the lesson in progress keeps its project");
  assert.equal((await stat(bobProject)).isDirectory(), true);
  assert.throws(() => createTrainingLearningSpace({ learners: f.store, content: { readLesson() {} }, projectContext: f.projectContext,
    projectArchive: { archiveProject() {}, removeProject() {} }, keptArchivedProjects: -1 }), TypeError);
});

test("a storage refusal comes before anything changes", async t => {
  const refuse = { next: true };
  const f = await fixture(t, { async headroom() {
    if (refuse.next) throw Object.assign(new Error("Not enough storage to archive. Nothing was archived."), { code: "VIBE64_TRAINING_PRACTICE_STORAGE", statusCode: 507 });
  } });
  const lesson = await f.start(ALICE);
  await assert.rejects(f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" }), /storage/u);
  assert.equal((await f.progress(ALICE)).activeAttemptId, lesson.attemptId, "the lesson in progress keeps going");
  await assert.rejects(stat(f.bundle(ALICE, lesson.attemptId)), { code: "ENOENT" });
  assert.deepEqual(f.released, []);
  refuse.next = false;
  assert.equal((await f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" })).closed, true);
});

test("a close that stops part-way keeps the lesson in progress and resumes, by archive or by delete", async t => {
  const f = await fixture(t);
  const lesson = await f.start(ALICE);
  f.failClose.next = true;
  await assert.rejects(f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" }),
    { code: "vibe64_project_runtime_close_failed" });
  assert.equal((await f.progress(ALICE)).activeAttemptId, lesson.attemptId);
  const listed = await f.space.list(ALICE);
  assert.equal(listed.current.status, "deleting");
  assert.deepEqual(listed.archived, [], "a partial bundle of the lesson in progress is not archived");
  assert.equal((await stat(lesson.thread)).isFile(), true, "the conversation stays until the project is gone");
  // Resuming the same close finishes the archive.
  assert.equal((await f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" })).closed, true);
  assert.equal((await f.space.list(ALICE)).archived[0].attemptId, lesson.attemptId);

  // A delete finishes a stopped archive with its partial bundle.
  const second = await f.start(ALICE);
  f.failClose.next = true;
  await assert.rejects(f.space.closeAttempt({ actor: ALICE, attemptId: second.attemptId, archive: true, reason: "archived" }));
  assert.equal((await f.space.closeAttempt({ actor: ALICE, attemptId: second.attemptId, archive: false, reason: "deleted" })).closed, true);
  await assert.rejects(stat(f.bundle(ALICE, second.attemptId)), { code: "ENOENT" });
  assert.deepEqual((await f.space.list(ALICE)).archived.map(value => value.attemptId), [lesson.attemptId]);
});

test("the close holds the preparation barrier and releases the thread only once the attempt has ended", async t => {
  const failRelease = { next: true };
  let f;
  f = await fixture(t, { async release() {
    assert.equal((await f.progress(ALICE)).activeAttemptId, null, "Colleague can no longer resolve the attempt's thread");
    if (failRelease.next) { failRelease.next = false; throw new Error("Stopped before the thread moved."); }
  } });
  const lesson = await f.start(ALICE);
  let preparation;
  f.duringClose.next = async () => {
    preparation = await f.store.runPreparationExclusive({ actor: ALICE, attemptId: lesson.attemptId }, async () => "prepared")
      .catch(error => error.code);
  };
  await assert.rejects(f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" }),
    /Stopped before the thread moved/u);
  assert.equal(preparation, "VIBE64_TRAINING_PREPARATION_BUSY", "no preparation runs while the project is archived");
  assert.equal((await f.progress(ALICE)).attempts[0].ended.reason, "archived");
  assert.equal((await stat(lesson.thread)).isFile(), true);
  // Repeating the close for the ended attempt finishes its thread step.
  assert.deepEqual(await f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" }),
    { ok: true, attemptId: lesson.attemptId, closed: false });
  await assert.rejects(stat(lesson.thread), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.bundle(ALICE, lesson.attemptId), "conversation.json"), "utf8")),
    { conversation: lesson.attemptId });
});

test("a damaged attempt.json leaves that archive out, never the whole list", async t => {
  const f = await fixture(t);
  const lesson = await f.start(ALICE, { pin: f.pins.zero });
  await f.space.closeAttempt({ actor: ALICE, attemptId: lesson.attemptId, archive: true, reason: "archived" });
  const damaged = path.join(f.systemRoot, "training/practice-archives", key(ALICE), "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  await mkdir(damaged, { recursive: true });
  await writeFile(path.join(damaged, "attempt.json"), "{");
  assert.deepEqual((await f.space.list(ALICE)).archived.map(value => value.attemptId), [lesson.attemptId]);
});
