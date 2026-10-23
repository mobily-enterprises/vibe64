import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingActions } from "../../packages/vibe64-training/src/server/actions.js";
import { createTrainingLearnerChangedPublisher } from "../../packages/vibe64-training/src/server/learnerEvents.js";

// Learn mode (Rev 4 H1) over the real learner store: a saved per-learner flag,
// separate from any lesson. L switches between Learn and Develop; switching
// never ends, archives or changes the lesson in progress. The core
// Learn/Develop project rule (C4) is tested with its owner.
const fixtureTopic = new URL("../fixtures/training/steps-v3/", import.meta.url);
const ALICE = { uid: 42, username: "alice", role: "member" };
const BOB = { uid: 43, username: "bob", role: "member" };
const OWNER = { uid: 1, username: "owner", role: "owner" };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-learning-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "topic");
  await cp(fixtureTopic, source, { recursive: true });
  const systemRoot = path.join(root, "system");
  const commit = "d".repeat(40), snapshotRoot = path.join(systemRoot, "training/content/steps", commit);
  await mkdir(path.dirname(snapshotRoot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshotRoot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshotRoot, "bundle.json"), "utf8"));
  const topic = { schemaVersion: 1, topicId: "steps", release: "0.1.0", repository: "examples/learn-steps-fixture", commit, topicHash: bundle.topicHash };
  await writeFile(path.join(snapshotRoot, "pin.json"), JSON.stringify(topic));
  const pin = { course: { courseId: "intro", release: "0.1.0" }, topic, lesson: { code: "STEPS-ONE", hash: bundle.lessons[0].hash } };
  const content = createInstalledTrainingContent({ systemRoot });
  const learners = createTrainingLearnerState({ systemRoot, content });
  async function start(actor, requestId = "start", { prepared = true } = {}) {
    const reserved = await learners.reserveAttempt({ actor, expectedRevision: (await learners.readState({ actor })).revision, requestId, pin });
    const attemptId = reserved.attempt.attemptId;
    if (prepared) {
      await learners.beginPreparation({ actor, attemptId, expectedRevision: reserved.revision });
      await learners.recordPreparationReady({ actor, attemptId, initialSessionId: `training-${attemptId}`, expectedRevision: reserved.revision + 1 });
    }
    return { attemptId, projectSlug: reserved.attempt.projectSlug };
  }
  return { systemRoot, learners, start, pin, title: (await content.readLesson({ ...topic, lessonCode: "STEPS-ONE", lessonHash: pin.lesson.hash })).lesson.title };
}

function actionsFixture(f, { exercises = null } = {}) {
  const published = [];
  const auth = { user: ALICE };
  const actions = createActionCatalogue();
  const definitions = createTrainingActions({ catalogue: { readCatalogue() { throw new Error("unused"); } }, learners: f.learners, exercises,
    publishLearnerChanged: createTrainingLearnerChangedPublisher({ async publish(event) { published.push(event.realtime.payload); } }) });
  actions.register({ contributorId: "training", domain: "training", actions: definitions.map(definition => ({
    channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => auth.user,
    authorizeProject() { throw new Error("Learning mode must not require a project."); } });
  const execute = (name, input = {}) => actions.execute({ actionId: `vibe64.training.${name}`, input, context: { channel: "api", surface: "app" } });
  return { execute, published, auth, definitions };
}

test("Learn mode is a saved flag of its own: off by default, on with no lesson, and per learner", async t => {
  const f = await fixture(t);
  const off = { on: false, currentAttemptId: "", lessonCode: "", lessonTitle: "", lessonStage: "", practiceSlug: "" };
  assert.deepEqual(await f.learners.readLearningMode({ actor: ALICE, includeTitle: true }), off, "absent means Develop");
  await f.learners.setLearningMode({ actor: ALICE, on: true });
  assert.deepEqual(await f.learners.readLearningMode({ actor: ALICE, includeTitle: true }), { ...off, on: true },
    "Learn mode with no lesson is normal");
  assert.deepEqual(await f.learners.readLearningMode({ actor: BOB, includeTitle: true }), off, "another learner is unaffected");
  const lesson = await f.start(ALICE);
  assert.deepEqual(await f.learners.readLearningMode({ actor: ALICE, includeTitle: true }), { on: true,
    currentAttemptId: lesson.attemptId, lessonCode: "STEPS-ONE", lessonTitle: f.title, lessonStage: "project", practiceSlug: lesson.projectSlug });
});

test("a lesson whose practice project is not prepared yet has no practice slug", async t => {
  const f = await fixture(t);
  const reserved = await f.start(ALICE, "start", { prepared: false });
  const mode = await f.learners.readLearningMode({ actor: ALICE });
  assert.equal(mode.currentAttemptId, reserved.attemptId);
  assert.equal(mode.practiceSlug, "");
});

test("L switches Learn and Develop for the signed-in learner, notifies every tab and never ends the lesson", async t => {
  const f = await fixture(t);
  const a = actionsFixture(f);
  const attempt = await f.start(ALICE);
  await f.learners.setLearningMode({ actor: ALICE, on: true });
  const read = await a.execute("learning-mode.read");
  assert.deepEqual(read, { ok: true, available: true, learningMode: { on: true, currentAttemptId: attempt.attemptId,
    lessonCode: "STEPS-ONE", lessonTitle: f.title, lessonStage: "project", practiceSlug: attempt.projectSlug } });
  assert.equal((await a.execute("learning.read")).learningMode.on, true, "learning.read carries the mode for L");
  const before = await f.learners.readState({ actor: ALICE });

  const develop = await a.execute("learning-mode.set", { on: false });
  assert.deepEqual([develop.changed, develop.learningMode.on, develop.learningMode.currentAttemptId], [true, false, attempt.attemptId],
    "the lesson stays in progress, paused");
  const after = await f.learners.readState({ actor: ALICE });
  assert.equal(after.progress.activeAttemptId, attempt.attemptId);
  assert.deepEqual(after.progress.attempts, before.progress.attempts, "switching changes no attempt");
  assert.equal((await a.execute("learning-mode.set", { on: false })).changed, false);
  assert.deepEqual(a.published, [{ learnerId: "42", reason: "learning-mode" }], "setting the same mode publishes nothing");

  a.auth.user = BOB;
  assert.equal((await a.execute("learning-mode.set", { on: true })).learningMode.currentAttemptId, "", "Bob's mode is his own");
  assert.equal((await f.learners.readLearningMode({ actor: ALICE })).on, false);
  a.auth.user = ALICE;
  const learn = await a.execute("learning-mode.set", { on: true });
  assert.deepEqual([learn.learningMode.on, learn.learningMode.currentAttemptId], [true, attempt.attemptId], "back to the same lesson");

  for (const name of ["learning-mode.read", "learning-mode.set"]) {
    const definition = a.definitions.find(value => value.id === `vibe64.training.${name}`);
    assert.equal(definition.extensions.vibe64.projectScoped, false, `${name} works on every page, so switching is never locked`);
    assert.equal(definition.extensions.vibe64.ownerRequired, false, `${name} is the same for members and owners`);
  }
  assert.equal(a.definitions.some(value => value.id === "vibe64.training.learning-mode.leave"), false, "Leave lesson is deleted");
});

test("lesson.resume notifies every tab that the lesson changed", async t => {
  const f = await fixture(t);
  const attempt = await f.start(OWNER);
  const exercises = {
    async prepareLesson({ actor, attemptId }) {
      const state = await f.learners.readState({ actor });
      return { ok: true, revision: state.revision, attempt: state.progress.attempts.find(value => value.attemptId === attemptId) };
    }
  };
  const a = actionsFixture(f, { exercises });
  a.auth.user = OWNER;
  const resumed = await a.execute("lesson.resume", { attemptId: attempt.attemptId });
  assert.equal(resumed.active.attemptId, attempt.attemptId);
  assert.deepEqual(a.published, [{ learnerId: "1", attemptId: attempt.attemptId, reason: "lesson" }]);
});
