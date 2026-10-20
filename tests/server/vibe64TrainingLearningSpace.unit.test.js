import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { createProjectArchiveService } from "@local/vibe64-project/server/project-archive";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingLearningSpace, MAX_ARCHIVES } from "../../packages/vibe64-training/src/server/learningSpace.js";

// The training learning-space owner (Rev 3 R6) over the real learner store,
// core learning space and shared project archive service. Only the runtime
// close is a stub.
const fixtureTopic = new URL("../fixtures/training/code-practical/", import.meta.url);
const ALICE = { uid: 42, username: "alice", role: "member" };
const BOB = { uid: 43, username: "bob", role: "member" };
const key = actor => Buffer.from(String(actor.uid)).toString("base64url");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-learning-space-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "topic");
  await cp(fixtureTopic, source, { recursive: true });
  const systemRoot = path.join(root, "system");
  const commit = "d".repeat(40), snapshotRoot = path.join(systemRoot, "training/content/code", commit);
  await mkdir(path.dirname(snapshotRoot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshotRoot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshotRoot, "bundle.json"), "utf8"));
  const topic = { schemaVersion: 1, topicId: "code", release: "0.1.0", repository: "examples/learn-code-fixture", commit, topicHash: bundle.topicHash };
  await writeFile(path.join(snapshotRoot, "pin.json"), JSON.stringify(topic));
  const pin = { course: { courseId: "intro", release: "0.1.0" }, topic, lesson: { code: "CODE-ONE", hash: bundle.lessons[0].hash } };
  const content = createInstalledTrainingContent({ systemRoot });
  const store = createTrainingLearnerState({ systemRoot, content });
  const forgotten = [];
  const learners = { ...store, async forgetPracticeLedger(input) { forgotten.push(input.practiceId); return store.forgetPracticeLedger(input); } };
  const working = path.join(root, "working");
  await mkdir(working);
  const projectContext = createStudioProjectContext({ explicitTargetRoot: working, explicitSystemRoot: systemRoot,
    explicitManagedSourceRoot: path.join(root, "managed-source"), home: root, runtimeProfile: { local: true } });
  const closed = [];
  const projectArchive = createProjectArchiveService({ projectContext,
    async closeProjectRuntime({ slug }) { closed.push(slug); return { ok: true }; } });
  const space = createTrainingLearningSpace({ learners, content, projectContext, projectArchive });
  const revisions = new Map();

  // A reserved lesson with its practice project, as preparation leaves it.
  async function start(actor, requestId = "start") {
    const reserved = await store.reserveAttempt({ actor, expectedRevision: revisions.get(actor.uid) || 0, requestId, pin });
    const { attemptId } = reserved.attempt;
    const begun = await store.beginPreparation({ actor, attemptId, expectedRevision: reserved.revision });
    revisions.set(actor.uid, begun.revision);
    await createPractice(actor, attemptId);
    return { attemptId, practiceId: attemptId, slug: reserved.attempt.projectSlug };
  }

  async function createPractice(actor, practiceId) {
    const training = { schemaVersion: 2, learnerKey: key(actor), practiceId, pin,
      exercise: { kind: "bundled", sourcePath: "app" } };
    const slug = `training-${practiceId.replaceAll("-", "")}`;
    await projectContext.runWithPracticeProjectScope({ actor, training, access: "create" }, () =>
      projectContext.createWorkspaceProjectRecord({ slug, name: "Practice: CODE-ONE", training }, {
        prepare: async ({ projectContextRoot }) => {
          await mkdir(path.join(projectContextRoot, "node_modules", "left-out"), { recursive: true });
          await writeFile(path.join(projectContextRoot, "notes.mjs"), "export const title = 'mine';\n");
        }
      }));
    return slug;
  }

  const active = async actor => (await store.readState({ actor })).progress;
  return { root, systemRoot, pin, store, space, projectContext, start, createPractice, active, forgotten, closed,
    title: (await content.readLesson({ ...topic, lessonCode: "CODE-ONE", lessonHash: pin.lesson.hash })).lesson.title };
}

test("the Practice list shows only the learner's own practice projects with lesson and status", async t => {
  const f = await fixture(t);
  const lesson = await f.start(ALICE);
  const listed = await f.space.list(ALICE);
  assert.deepEqual(listed.archived, []);
  assert.equal(listed.projects.length, 1);
  assert.deepEqual({ ...listed.projects[0], createdAt: undefined }, { practiceId: lesson.practiceId, slug: lesson.slug,
    lesson: { code: "CODE-ONE", title: f.title }, status: "in-progress", createdAt: undefined });
  assert.deepEqual(await f.space.list(BOB), { projects: [], archived: [] }, "another learner's practice project is not listed");
  assert.equal(await f.space.exists({ actor: ALICE, practiceId: lesson.practiceId }), true);
  assert.equal(await f.space.exists({ actor: BOB, practiceId: lesson.practiceId }), false);
  await assert.rejects(f.space.remove({ actor: BOB, practiceId: lesson.practiceId }), { code: "VIBE64_TRAINING_PRACTICE_MISSING", statusCode: 404 });
  assert.equal((await f.active(ALICE)).activeAttemptId, lesson.attemptId, "a refused delete ends nothing");
});

// Moved from Online projectArchiveService.unit ("the Online practice facility
// ends the learner's own attempt and tolerates a project with no saved attempt").
test("delete ends the learner's own attempt, forgets its ledger and tolerates a project with no saved attempt", async t => {
  const f = await fixture(t);
  const lesson = await f.start(ALICE);
  const removed = await f.space.remove({ actor: ALICE, practiceId: lesson.practiceId });
  assert.deepEqual(removed, { ok: true, practiceId: lesson.practiceId, slug: lesson.slug, removed: true, ended: true });
  const progress = await f.active(ALICE);
  assert.equal(progress.activeAttemptId, null);
  assert.equal(progress.attempts[0].ended.reason, "discard");
  assert.deepEqual(f.forgotten, [lesson.practiceId]);
  assert.deepEqual(f.closed, [lesson.slug]);
  assert.equal(await f.space.exists({ actor: ALICE, practiceId: lesson.practiceId }), false, "learning.read leaves the deleted project out");
  assert.deepEqual((await f.space.list(ALICE)).projects, []);

  // A practice project whose learner has no saved attempt is still deleted.
  const orphanId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const slug = await f.createPractice(BOB, orphanId);
  assert.deepEqual(await f.space.remove({ actor: BOB, practiceId: orphanId }),
    { ok: true, practiceId: orphanId, slug, removed: true, ended: false });
  await assert.rejects(f.space.remove({ actor: BOB, practiceId: orphanId }), { code: "VIBE64_TRAINING_PRACTICE_MISSING" });
});

test("archive ends the attempt, forgets its ledger and keeps a bundle the Archived list shows until it is deleted", async t => {
  const f = await fixture(t);
  const lesson = await f.start(ALICE);
  const archived = await f.space.archive({ actor: ALICE, practiceId: lesson.practiceId });
  assert.equal(archived.ok, true);
  assert.equal(archived.ended, true);
  assert.equal((await f.active(ALICE)).attempts[0].ended.reason, "discard");
  assert.deepEqual(f.forgotten, [lesson.practiceId]);
  const projectArchiveRoot = path.join(f.systemRoot, "training/practice-archives", key(ALICE), lesson.slug);
  const practice = JSON.parse(await readFile(path.join(projectArchiveRoot, "practice.json"), "utf8"));
  assert.deepEqual({ ...practice, archivedAt: undefined }, { practiceId: lesson.practiceId, learnerKey: key(ALICE), pin: f.pin, archivedAt: undefined });
  assert.ok((await stat(path.join(projectArchiveRoot, archived.archiveId))).isDirectory());
  const listed = await f.space.list(ALICE);
  assert.deepEqual(listed.projects, []);
  assert.deepEqual(listed.archived, [{ practiceId: lesson.practiceId, archiveId: archived.archiveId,
    lesson: { code: "CODE-ONE", title: f.title }, archivedAt: practice.archivedAt }]);
  assert.deepEqual((await f.space.list(BOB)).archived, [], "archives are per learner");
  await assert.rejects(f.space.deleteArchive({ actor: BOB, practiceId: lesson.practiceId, archiveId: archived.archiveId }),
    { code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_MISSING" });
  await assert.rejects(f.space.deleteArchive({ actor: ALICE, practiceId: lesson.practiceId, archiveId: "../escape" }),
    { code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_MISSING" });
  assert.deepEqual(await f.space.deleteArchive({ actor: ALICE, practiceId: lesson.practiceId, archiveId: archived.archiveId }),
    { ok: true, practiceId: lesson.practiceId, archiveId: archived.archiveId, removed: true });
  assert.deepEqual((await f.space.list(ALICE)).archived, []);
  assert.deepEqual(await readdir(path.dirname(projectArchiveRoot)), []);
});

test(`a learner keeps at most ${MAX_ARCHIVES} archives; the refusal changes nothing`, async t => {
  const f = await fixture(t);
  const lesson = await f.start(ALICE);
  const learnerArchives = path.join(f.systemRoot, "training/practice-archives", key(ALICE));
  for (let index = 0; index < MAX_ARCHIVES; index++) await mkdir(path.join(learnerArchives, `training-${String(index).padStart(32, "0")}`), { recursive: true });
  await assert.rejects(f.space.archive({ actor: ALICE, practiceId: lesson.practiceId }), { code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_LIMIT", statusCode: 409 });
  assert.equal((await f.active(ALICE)).activeAttemptId, lesson.attemptId);
  assert.deepEqual(f.forgotten, []);
  assert.equal((await f.space.list(ALICE)).projects[0].status, "in-progress");
  await rm(path.join(learnerArchives, `training-${"0".repeat(32)}`), { recursive: true });
  assert.equal((await f.space.archive({ actor: ALICE, practiceId: lesson.practiceId })).ok, true);
});
