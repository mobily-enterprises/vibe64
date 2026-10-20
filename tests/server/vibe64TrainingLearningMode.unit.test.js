import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { registerVibe64ActionContext, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import {
  LEARNING_MODE_PROJECT_CODE,
  learningModeProjectBlock,
  learningModeProjects,
  readLearningModeFor,
  registerLearningModeReader
} from "@local/vibe64-core/server/learningMode";
import { projectRequestErrorStatusCode, resolveProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingActions } from "../../packages/vibe64-training/src/server/actions.js";
import { createTrainingLearnerChangedPublisher } from "../../packages/vibe64-training/src/server/learnerEvents.js";

// Learning mode (Learning v2 product decision 8) over the real learner store:
// a lesson in progress is learning mode unless the learner left that exact
// attempt; its projects are that lesson's practice projects only.
const fixtureTopic = new URL("../fixtures/training/code-practical/", import.meta.url);
const ALICE = { uid: 42, username: "alice", role: "member" };
const BOB = { uid: 43, username: "bob", role: "member" };
const OWNER = { uid: 1, username: "owner", role: "owner" };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-learning-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => registerLearningModeReader(null));
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
  const learners = createTrainingLearnerState({ systemRoot, content });
  const revisions = new Map();
  async function start(actor, requestId = "start", { prepared = true } = {}) {
    const reserved = await learners.reserveAttempt({ actor, expectedRevision: revisions.get(actor.uid) || 0, requestId, pin });
    const attemptId = reserved.attempt.attemptId;
    revisions.set(actor.uid, reserved.revision);
    if (prepared) {
      await learners.beginPreparation({ actor, attemptId, expectedRevision: reserved.revision });
      const ready = await learners.recordPreparationReady({ actor, attemptId, initialSessionId: `training-${attemptId}`, expectedRevision: reserved.revision + 1 });
      revisions.set(actor.uid, ready.revision);
    }
    return { attemptId, projectSlug: reserved.attempt.projectSlug };
  }
  async function end(actor, attemptId, requestId = `end-${attemptId.slice(0, 8)}`) {
    const result = await learners.endAttempt({ actor, attemptId, requestId, expectedRevision: revisions.get(actor.uid), reason: "restart" });
    revisions.set(actor.uid, result.revision);
    return result;
  }
  const modeFile = actor => path.join(systemRoot, "training/users", Buffer.from(String(actor.uid)).toString("base64url"), "learning-mode.json");
  return { systemRoot, learners, start, end, modeFile, pin, title: (await content.readLesson({ ...topic, lessonCode: "CODE-ONE", lessonHash: pin.lesson.hash })).lesson.title };
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

test("a lesson in progress is learning mode limited to that lesson's practice projects; leave pauses and resume re-enters", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.learners.readLearningMode({ actor: ALICE }), { on: false, paused: false }, "no lesson, no learning mode");
  const first = await f.start(ALICE);
  const mode = await f.learners.readLearningMode({ actor: ALICE, includeTitle: true });
  assert.deepEqual(mode, { on: true, paused: false, attemptId: first.attemptId, lessonCode: "CODE-ONE", practiceSlug: first.projectSlug,
    projectSlugs: [first.projectSlug], lessonTitle: f.title });
  assert.deepEqual(await f.learners.readLearningMode({ actor: BOB }), { on: false, paused: false }, "another learner is unaffected");

  const left = await f.learners.setLearningModePaused({ actor: ALICE, attemptId: first.attemptId, paused: true });
  assert.equal(left.changed, true);
  assert.equal(left.learningMode.on, false);
  assert.equal(left.learningMode.paused, true);
  const saved = JSON.parse(await readFile(f.modeFile(ALICE), "utf8"));
  assert.deepEqual(Object.keys(saved).sort(), ["learnerId", "pausedAttemptId", "schemaVersion", "updatedAt"]);
  assert.equal(saved.pausedAttemptId, first.attemptId);
  assert.equal((await f.learners.setLearningModePaused({ actor: ALICE, attemptId: first.attemptId, paused: true })).changed, false, "leaving twice changes nothing");
  assert.equal((await f.learners.readState({ actor: ALICE })).progress.activeAttemptId, first.attemptId, "leaving keeps the lesson in progress");

  const resumed = await f.learners.setLearningModePaused({ actor: ALICE, attemptId: first.attemptId, paused: false });
  assert.equal(resumed.learningMode.on, true);
  assert.equal(JSON.parse(await readFile(f.modeFile(ALICE), "utf8")).pausedAttemptId, undefined);

  // Leaving then ending: the ended attempt is no lesson in progress.
  await f.learners.setLearningModePaused({ actor: ALICE, attemptId: first.attemptId, paused: true });
  await f.end(ALICE, first.attemptId);
  assert.deepEqual(await f.learners.readLearningMode({ actor: ALICE }), { on: false, paused: false }, "ending ends learning mode");
  assert.equal((await f.learners.setLearningModePaused({ actor: ALICE, attemptId: first.attemptId, paused: true })).changed, false,
    "an ended attempt cannot be left again");

  // A new attempt of the same lesson is learning mode again; both of the
  // lesson's practice projects are open, the current one is the redirect target.
  const second = await f.start(ALICE, "start-2");
  const again = await f.learners.readLearningMode({ actor: ALICE });
  assert.equal(again.on, true);
  assert.equal(again.practiceSlug, second.projectSlug);
  assert.deepEqual([...again.projectSlugs].sort(), [first.projectSlug, second.projectSlug].sort());
});

test("a lesson whose practice project is not prepared yet opens no project and redirects nowhere", async t => {
  const f = await fixture(t);
  const reserved = await f.start(ALICE, "start", { prepared: false });
  const mode = await f.learners.readLearningMode({ actor: ALICE });
  assert.equal(mode.on, true);
  assert.equal(mode.practiceSlug, "");
  registerLearningModeReader(({ actor }) => f.learners.readLearningMode({ actor }));
  const read = await readLearningModeFor(ALICE);
  assert.ok(learningModeProjectBlock(read, "my-shop"), "normal projects are refused");
  assert.equal(learningModeProjectBlock(read, reserved.projectSlug), null, "its own (future) practice project is not refused");
});

test("an invalid learning mode record is refused by the store and projects stay open (fail open, never locked out)", async t => {
  const f = await fixture(t);
  const attempt = await f.start(ALICE);
  await f.learners.setLearningModePaused({ actor: ALICE, attemptId: attempt.attemptId, paused: true });
  await writeFile(f.modeFile(ALICE), JSON.stringify({ schemaVersion: 1, learnerId: "43", updatedAt: new Date().toISOString() }));
  await assert.rejects(f.learners.readLearningMode({ actor: ALICE }), { code: "VIBE64_TRAINING_STATE_INVALID" });
  const failures = [];
  registerLearningModeReader(({ actor }) => f.learners.readLearningMode({ actor }), { onReadFailure: error => failures.push(error.code) });
  assert.equal(await readLearningModeFor(ALICE), null);
  assert.deepEqual(failures, ["VIBE64_TRAINING_STATE_INVALID"]);
});

test("learning-mode actions read, leave and re-enter for the signed-in learner and notify every tab", async t => {
  const f = await fixture(t);
  const a = actionsFixture(f);
  const attempt = await f.start(ALICE);
  const read = await a.execute("learning-mode.read");
  assert.equal(read.ok, true);
  assert.equal(read.learningMode.on, true);
  assert.equal(read.learningMode.lessonTitle, f.title);
  assert.deepEqual(read.learningMode.projectSlugs, [attempt.projectSlug]);
  const learning = await a.execute("learning.read");
  assert.equal(learning.learningMode.on, true, "learning.read carries the mode for L");

  const left = await a.execute("learning-mode.leave", { attemptId: attempt.attemptId });
  assert.deepEqual({ on: left.learningMode.on, paused: left.learningMode.paused, changed: left.changed }, { on: false, paused: true, changed: true });
  assert.deepEqual(a.published, [{ learnerId: "42", attemptId: attempt.attemptId, reason: "learning-mode" }]);
  assert.equal((await a.execute("learning-mode.leave", { attemptId: attempt.attemptId })).changed, false);
  assert.equal(a.published.length, 1, "an unchanged mode publishes nothing");

  a.auth.user = BOB;
  const bob = await a.execute("learning-mode.enter", { attemptId: attempt.attemptId });
  assert.equal(bob.learningMode.on, false, "another learner cannot resume Alice's lesson");
  assert.equal((await f.learners.readLearningMode({ actor: ALICE })).paused, true);

  a.auth.user = ALICE;
  const entered = await a.execute("learning-mode.enter", { attemptId: attempt.attemptId });
  assert.equal(entered.learningMode.on, true);
  assert.equal(a.published.length, 2);

  for (const name of ["learning-mode.read", "learning-mode.leave", "learning-mode.enter"]) {
    const definition = a.definitions.find(value => value.id === `vibe64.training.${name}`);
    assert.equal(definition.extensions.vibe64.projectScoped, false, `${name} works on every page, so leaving is never locked`);
    assert.equal(definition.extensions.vibe64.ownerRequired, false, `${name} is the same for members and owners`);
  }
});

test("lesson.resume re-enters learning mode and lesson.end notifies every tab that it ended", async t => {
  const f = await fixture(t);
  const attempt = await f.start(OWNER);
  const exercises = {
    async prepareLesson({ actor, attemptId }) {
      const state = await f.learners.readState({ actor });
      return { ok: true, revision: state.revision, attempt: state.progress.attempts.find(value => value.attemptId === attemptId) };
    },
    async endLesson(input) { return f.end(input.actor, input.attemptId, input.requestId); }
  };
  const a = actionsFixture(f, { exercises });
  a.auth.user = OWNER;
  await a.execute("learning-mode.leave", { attemptId: attempt.attemptId });
  assert.equal((await f.learners.readLearningMode({ actor: OWNER })).on, false, "an owner leaves like any learner");
  const resumed = await a.execute("lesson.resume", { attemptId: attempt.attemptId });
  assert.equal(resumed.active.attemptId, attempt.attemptId);
  assert.equal((await f.learners.readLearningMode({ actor: OWNER })).on, true, "Resume re-enters learning mode");
  const state = await f.learners.readState({ actor: OWNER });
  await a.execute("lesson.end", { attemptId: attempt.attemptId, requestId: "end-1", expectedRevision: state.revision, reason: "restart" });
  assert.equal((await f.learners.readLearningMode({ actor: OWNER })).on, false, "ending the lesson ends learning mode");
  assert.deepEqual(a.published.map(value => value.reason), ["learning-mode", "learning-mode", "learning-mode"]);
});

test("project pages and sessions opened by the person refuse other projects in learning mode; internal work is unaffected", async t => {
  t.after(() => registerLearningModeReader(null));
  const lesson = { on: true, attemptId: "a", lessonCode: "CODE-ONE", practiceSlug: "training-abc", projectSlugs: ["training-abc"] };
  const reads = [];
  registerLearningModeReader(({ actor }) => { reads.push(actor?.username || null); return lesson; });
  const projectContext = { projectCatalogEnabled: true, projectsRoot: "/nonexistent-projects",
    async readWorkspaceProject() { throw Object.assign(new Error("This project is unavailable."), { code: "vibe64_project_route_unavailable" }); } };
  const request = { headers: {}, params: { slug: "my-shop" }, vibe64User: ALICE };
  const refused = await resolveProjectRequestContext({ projectContext, request }).catch(error => error);
  assert.equal(refused.code, LEARNING_MODE_PROJECT_CODE);
  assert.equal(refused.message, "You're in a lesson. Leave lesson to get back to your projects.");
  assert.equal(projectRequestErrorStatusCode(refused), 403);
  assert.deepEqual(refused.details, { practiceSlug: "training-abc" });
  // The lesson's practice project passes learning mode (it then fails here
  // only because this stub has no projects).
  const allowed = await resolveProjectRequestContext({ projectContext, request: { headers: {}, params: { slug: "training-abc" }, vibe64User: ALICE } })
    .catch(error => error);
  assert.equal(allowed.code, "vibe64_project_route_unavailable");
  // Internal resolution (no request headers) is never limited.
  const internal = await resolveProjectRequestContext({ projectContext, request: { params: { slug: "my-shop" } } }).catch(error => error);
  assert.equal(internal.code, "vibe64_project_route_unavailable");
  // One read per request.
  await resolveProjectRequestContext({ projectContext, request }).catch(() => null);
  assert.deepEqual(reads, ["alice", "alice"], "one read per request: the repeated request reused its read");

  // Not in learning mode: nothing is refused.
  registerLearningModeReader(() => ({ on: false, paused: true }));
  const open = await resolveProjectRequestContext({ projectContext, request: { headers: {}, params: { slug: "my-shop" }, vibe64User: ALICE } })
    .catch(error => error);
  assert.equal(open.code, "vibe64_project_route_unavailable");
});

test("Colleague cannot run project operations on another project for a learner in learning mode (Lesson 0: none at all)", async t => {
  t.after(() => registerLearningModeReader(null));
  let mode = { on: true, attemptId: "a", lessonCode: "V64-START-00", practiceSlug: "", projectSlugs: [] };
  registerLearningModeReader(() => mode);
  const actions = createActionCatalogue();
  let ran = 0;
  actions.register({ contributorId: "test", domain: "test", actions: [withVibe64ActionContext({
    id: "test.project.read", version: 1, kind: "query", idempotency: "none", channels: ["automation"], surfaces: ["app"],
    input: { mode: "create", schema: createSchema({}) }, output: null,
    async execute() { ran += 1; return { ok: true }; }
  })] });
  const context = { channel: "automation", surface: "app", projectSlug: "my-shop", colleague: { userKey: "alice", focus: null } };
  await assert.rejects(actions.execute({ actionId: "test.project.read", input: { projectSlug: "my-shop" }, context }),
    { code: LEARNING_MODE_PROJECT_CODE });
  assert.equal(ran, 0);
  // Background work without Colleague is never limited by learning mode.
  const background = await actions.execute({ actionId: "test.project.read", input: { projectSlug: "my-shop" },
    context: { channel: "automation", surface: "app", projectSlug: "my-shop" } }).catch(error => error);
  assert.notEqual(background?.code, LEARNING_MODE_PROJECT_CODE);
  mode = { on: false, paused: false };
  const left = await actions.execute({ actionId: "test.project.read", input: { projectSlug: "my-shop" }, context }).catch(error => error);
  assert.notEqual(left?.code, LEARNING_MODE_PROJECT_CODE, "after Leave lesson Colleague works on every project again");
});

test("listings in learning mode show only the lesson's practice projects; Lesson 0 shows none", () => {
  const projects = [{ slug: "my-shop" }, { slug: "training-abc", practice: { mine: true } }, { slug: "training-def", practice: { mine: true } }];
  assert.deepEqual(learningModeProjects(projects, null), projects);
  assert.deepEqual(learningModeProjects(projects, { projectSlugs: ["training-abc"] }).map(value => value.slug), ["training-abc"]);
  assert.deepEqual(learningModeProjects(projects, { projectSlugs: [] }), []);
});
