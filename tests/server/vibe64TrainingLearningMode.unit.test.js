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
  learningModeAllowsProject,
  readLearningModeFor,
  registerLearningModeReader
} from "@local/vibe64-core/server/learningMode";
import { projectRequestErrorStatusCode, resolveProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingActions } from "../../packages/vibe64-training/src/server/actions.js";
import { createTrainingLearnerChangedPublisher } from "../../packages/vibe64-training/src/server/learnerEvents.js";

// Learning mode (Rev 3 R3) over the real learner store: a lesson in progress
// is learning mode; its only project is that lesson's practice project. Leave
// lesson ends the attempt (reason left).
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
  async function end(actor, attemptId, requestId = `end-${attemptId.slice(0, 8)}`, reason = "finished") {
    const { revision } = await learners.readState({ actor });
    const result = await learners.endAttempt({ actor, attemptId, requestId, expectedRevision: revision, reason });
    revisions.set(actor.uid, result.revision);
    return result;
  }
  return { systemRoot, learners, start, end, pin, title: (await content.readLesson({ ...topic, lessonCode: "CODE-ONE", lessonHash: pin.lesson.hash })).lesson.title };
}

function actionsFixture(f, { exercises = { endLesson: input => f.end(input.actor, input.attemptId, input.requestId, input.reason) } } = {}) {
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

test("a lesson in progress is learning mode limited to its practice project; ending it ends learning mode", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.learners.readLearningMode({ actor: ALICE }), { on: false }, "no lesson, no learning mode");
  const first = await f.start(ALICE);
  const mode = await f.learners.readLearningMode({ actor: ALICE, includeTitle: true });
  assert.deepEqual(mode, { on: true, attemptId: first.attemptId, lessonCode: "CODE-ONE", practiceSlug: first.projectSlug,
    projectSlugs: [first.projectSlug], lessonTitle: f.title });
  assert.deepEqual(await f.learners.readLearningMode({ actor: BOB }), { on: false }, "another learner is unaffected");
  await f.end(ALICE, first.attemptId);
  assert.deepEqual(await f.learners.readLearningMode({ actor: ALICE }), { on: false }, "ending ends learning mode");
  const second = await f.start(ALICE, "start-2");
  assert.deepEqual((await f.learners.readLearningMode({ actor: ALICE })).projectSlugs, [second.projectSlug],
    "only the lesson in progress's own practice project");
});

test("a lesson whose practice project is not prepared yet opens no project", async t => {
  const f = await fixture(t);
  const reserved = await f.start(ALICE, "start", { prepared: false });
  const mode = await f.learners.readLearningMode({ actor: ALICE });
  assert.equal(mode.on, true);
  assert.equal(mode.practiceSlug, "");
  registerLearningModeReader(({ actor }) => f.learners.readLearningMode({ actor }));
  const read = await readLearningModeFor(ALICE);
  assert.ok(learningModeProjectBlock(read, "my-shop"), "normal projects are refused");
  assert.ok(learningModeProjectBlock(read, reserved.projectSlug), "nor its future practice project until it is prepared");
});

test("a learning mode read that fails leaves projects open (fail open, never locked out)", async t => {
  t.after(() => registerLearningModeReader(null));
  const failures = [];
  registerLearningModeReader(async () => { throw Object.assign(new Error("unreadable"), { code: "VIBE64_TRAINING_STATE_INVALID" }); },
    { onReadFailure: error => failures.push(error.code) });
  assert.equal(await readLearningModeFor(ALICE), null);
  assert.deepEqual(failures, ["VIBE64_TRAINING_STATE_INVALID"]);
});

test("Leave lesson ends the signed-in learner's lesson (results and practice project kept) and notifies every tab", async t => {
  const f = await fixture(t);
  const a = actionsFixture(f);
  const attempt = await f.start(ALICE);
  const read = await a.execute("learning-mode.read");
  assert.equal(read.ok, true);
  assert.equal(read.learningMode.on, true);
  assert.equal(read.learningMode.lessonTitle, f.title);
  assert.deepEqual(read.learningMode.projectSlugs, [attempt.projectSlug]);
  assert.equal((await a.execute("learning.read")).learningMode.on, true, "learning.read carries the mode for L");

  a.auth.user = BOB;
  const bob = await a.execute("learning-mode.leave", { attemptId: attempt.attemptId });
  assert.deepEqual([bob.changed, bob.learningMode.on], [false, false], "another learner cannot end Alice's lesson");
  assert.equal((await f.learners.readLearningMode({ actor: ALICE })).on, true);

  a.auth.user = ALICE;
  const left = await a.execute("learning-mode.leave", { attemptId: attempt.attemptId });
  assert.deepEqual({ on: left.learningMode.on, changed: left.changed }, { on: false, changed: true });
  const saved = (await f.learners.readState({ actor: ALICE })).progress.attempts[0];
  assert.equal(saved.ended.reason, "left");
  assert.equal(saved.projectSlug, attempt.projectSlug, "the practice project stays the attempt's");
  assert.deepEqual(a.published, [{ learnerId: "42", attemptId: attempt.attemptId, reason: "learning-mode" }]);
  assert.equal((await a.execute("learning-mode.leave", { attemptId: attempt.attemptId })).changed, false);
  assert.equal(a.published.length, 1, "leaving twice changes and publishes nothing");

  for (const name of ["learning-mode.read", "learning-mode.leave"]) {
    const definition = a.definitions.find(value => value.id === `vibe64.training.${name}`);
    assert.equal(definition.extensions.vibe64.projectScoped, false, `${name} works on every page, so leaving is never locked`);
    assert.equal(definition.extensions.vibe64.ownerRequired, false, `${name} is the same for members and owners`);
  }
  assert.equal(a.definitions.some(value => value.id === "vibe64.training.learning-mode.enter"), false, "there is no paused lesson to re-enter");
});

test("lesson.resume and lesson.end notify every tab that learning mode changed", async t => {
  const f = await fixture(t);
  const attempt = await f.start(OWNER);
  const exercises = {
    async prepareLesson({ actor, attemptId }) {
      const state = await f.learners.readState({ actor });
      return { ok: true, revision: state.revision, attempt: state.progress.attempts.find(value => value.attemptId === attemptId) };
    },
    async endLesson(input) { return f.end(input.actor, input.attemptId, input.requestId, input.reason); }
  };
  const a = actionsFixture(f, { exercises });
  a.auth.user = OWNER;
  const resumed = await a.execute("lesson.resume", { attemptId: attempt.attemptId });
  assert.equal(resumed.active.attemptId, attempt.attemptId);
  const state = await f.learners.readState({ actor: OWNER });
  await a.execute("lesson.end", { attemptId: attempt.attemptId, requestId: "end-1", expectedRevision: state.revision, reason: "finished" });
  assert.equal((await f.learners.readLearningMode({ actor: OWNER })).on, false, "ending the lesson ends learning mode");
  assert.deepEqual(a.published.map(value => value.reason), ["learning-mode", "learning-mode"]);
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
  registerLearningModeReader(() => ({ on: false }));
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
  mode = { on: false };
  const left = await actions.execute({ actionId: "test.project.read", input: { projectSlug: "my-shop" }, context }).catch(error => error);
  assert.notEqual(left?.code, LEARNING_MODE_PROJECT_CODE, "after Leave lesson Colleague works on every project again");
});

test("listings in learning mode show only the lesson's practice project; Lesson 0 shows none", () => {
  const projects = [{ slug: "my-shop" }, { slug: "training-abc" }, { slug: "training-def" }];
  const listed = mode => projects.filter(project => learningModeAllowsProject(mode, project.slug)).map(project => project.slug);
  assert.deepEqual(listed(null), ["my-shop", "training-abc", "training-def"]);
  assert.deepEqual(listed({ on: true, practiceSlug: "training-abc", projectSlugs: ["training-abc"] }), ["training-abc"]);
  assert.deepEqual(listed({ on: true, practiceSlug: "", projectSlugs: [] }), []);
});
