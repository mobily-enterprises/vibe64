import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTrainingService } from "@local/vibe64-training/server/preparation";

const actor = { uid: 123, username: "learner" };
const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pin = {
  course: { courseId: "getting-started", release: "0.1.1" },
  topic: { schemaVersion: 1, topicId: "getting-started", release: "0.1.1", repository: "mobily-enterprises/learn-vibe64-getting-started", commit: "a".repeat(40), topicHash: "b".repeat(64) },
  lesson: { code: "V64-START-01", hash: "c".repeat(64) }
};

async function fixture(t, { enabled = true, phase = "reserved", setup = "running", files = [{ path: "genesis/stack.md", bytes: Buffer.from("approved exercise") }] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  const sourceRoot = path.join(root, "source");
  const calls = [];
  let metadata = {};
  let session = null;
  let revision = 1;
  let failure = null;
  const attempt = { attemptId, pin, projectSlug: "training-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa", preparation: { phase,
    ...(phase === "reserved" ? {} : { initialSessionId: `training-${attemptId}` }) } };
  const state = () => structuredClone({ revision, attempt, active: { learnerId: "123" } });
  const learners = {
    async reserveAttempt(input) { calls.push(["reserve", input]); return state(); },
    async runPreparationExclusive(input, operation) { calls.push(["lock", input]); return operation(); },
    async resumeAttempt() { return state(); },
    async beginPreparation() {
      calls.push(["begin"]);
      if (attempt.preparation.phase === "reserved") { attempt.preparation = { phase: "preparing", initialSessionId: `training-${attemptId}` }; revision++; }
      return state();
    },
    async recordPreparationReady() { calls.push(["ready"]); attempt.preparation.phase = "ready"; revision++; return state(); },
    async recordPreparationFailure(input) { failure = input; calls.push(["failure", input]); attempt.preparation.phase = "preparing"; revision++; return state(); }
  };
  const owners = {
    catalogue: { async readCatalogue() { return { courses: [{ enabled, course: pin.course, lock: { topics: [{ ...pin.topic, manifestHash: pin.topic.topicHash, lessons: [{ ...pin.lesson, status: "published" }] }] } }] }; } },
    content: {
      async readLesson(input) { calls.push(["lesson", input]); return { lesson: { exercise: { kind: "bundled" } } }; },
      async readExercise(input) { calls.push(["exercise", input]); return { sourcePath: "training/exercises/orientation-app", files }; }
    },
    learners,
    projectContext: { async readWorkspaceProjectState() { return { projectContextRoot: projectRoot, metadata }; } },
    projectRepositoryService: {
      async verifyTrainingProjectSource(input, options) { calls.push(["source-proof", input, options]); return { commit: "d".repeat(40), branch: "main" }; },
      async createManagedGitProject(input, options) {
      calls.push(["project", input]); await mkdir(sourceRoot);
      await options.initializeProject({ projectRoot: sourceRoot });
      await mkdir(projectRoot); metadata = { training: input.training, repository: { mode: "managed_git" } };
      return { ok: true };
    } },
    project: {
      async runInProjectContext(slug, operation) { calls.push(["scope", slug]); return operation(); },
      async createRuntime() { return { async getSession(id) {
        calls.push(["session-read", id]);
        if (!session) throw Object.assign(new Error("Missing session"), { code: "vibe64_session_not_found" });
        return session;
      } }; }
    },
    terminals: { async workspaceSetupIsPrepared(id) { calls.push(["setup-check", id]); return true; } },
    sessions: { async createSession(input, options) { calls.push(["session-create", input, options]); session = { sessionId: options.sessionId, status: "open", workspaceSetup: { status: setup } }; return session; } }
  };
  return { root, sourceRoot, projectRoot, owners, calls, attempt, state, get failure() { return failure; },
    setMetadata(value) { metadata = value; }, setSession(value) { session = value; }, service: createTrainingService(owners) };
}

test("enabled course reserves exact approved pin before effects and pending setup is not ready", async t => {
  const f = await fixture(t);
  const result = await f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "start-1" });
  assert.deepEqual(f.calls[0], ["reserve", { actor, expectedRevision: 0, requestId: "start-1", pin }]);
  assert.deepEqual(f.calls.slice(0, 5).map(value => value[0]), ["reserve", "lock", "lesson", "begin", "exercise"]);
  assert.equal(result.attempt.preparation.phase, "preparing");
  assert.equal(result.previewReady, false);
  assert.equal(f.calls.some(value => value[0] === "ready"), false);
  assert.equal(await readFile(path.join(f.sourceRoot, "genesis/stack.md"), "utf8"), "approved exercise");
  const creation = f.calls.find(value => value[0] === "session-create");
  assert.equal(creation[2].sessionId, `training-${attemptId}`);
  assert.equal(creation[2].expectedCommit, "d".repeat(40));
  assert.deepEqual(creation[1].vibe64User, actor);
});

test("no-exercise start and resume retain their exact reservation without project, session or setup effects", async t => {
  const f = await fixture(t);
  f.owners.content.readLesson = async input => {
    assert.deepEqual(input, { ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash });
    f.calls.push(["lesson", input]);
    return { lesson: { assessments: [{ id: "setup", kind: "answer" }] } };
  };
  const started = await f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "start-one" });
  const resumed = await f.service.prepareLesson({ actor, attemptId });
  assert.deepEqual(resumed, started);
  assert.deepEqual(resumed.attempt.preparation, { phase: "reserved" });
  assert.equal(resumed.revision, 1);
  assert.equal(resumed.previewReady, false);
  assert.deepEqual(f.calls.map(([name]) => name), ["reserve", "lock", "lesson", "lock", "lesson"]);
  await assert.rejects(readFile(path.join(f.sourceRoot, "genesis/stack.md")), { code: "ENOENT" });
});

test("no-exercise pins cannot relabel old preparation and failed content cannot begin effects", async t => {
  const f = await fixture(t, { phase: "preparing" });
  f.owners.content.readLesson = async () => ({ lesson: {} });
  await assert.rejects(f.service.prepareLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_PREPARATION_CONFLICT" });
  assert.equal(f.attempt.preparation.phase, "preparing");
  assert.deepEqual(f.calls.map(([name]) => name), ["lock"]);
  const original = new Error("Installed pin changed");
  f.owners.content.readLesson = async () => { throw original; };
  await assert.rejects(f.service.prepareLesson({ actor, attemptId }), error => error === original);
  assert.deepEqual(f.calls.map(([name]) => name), ["lock", "lock"]);
});

test("disabled course rejects new reservations without project or session effects", async t => {
  const f = await fixture(t, { enabled: false });
  await assert.rejects(f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code }), { code: "VIBE64_TRAINING_COURSE_UNAVAILABLE" });
  assert.deepEqual(f.calls, []);
});

test("resume retains prepared project/session and works after course is disabled", async t => {
  const f = await fixture(t, { setup: "succeeded" });
  await f.service.prepareLesson({ actor, attemptId });
  f.owners.catalogue.readCatalogue = () => { throw new Error("Resume must not require catalogue enablement"); };
  const resumed = await f.service.prepareLesson({ actor, attemptId });
  assert.equal(resumed.attempt.preparation.phase, "ready");
  assert.equal(resumed.previewReady, false);
  assert.equal(f.calls.filter(value => value[0] === "project").length, 1);
  assert.equal(f.calls.filter(value => value[0] === "source-proof").length, 1);
  assert.equal(f.calls.filter(value => value[0] === "session-create").length, 1);
});

test("unmarked existing directory is preserved and never adopted", async t => {
  const f = await fixture(t);
  await mkdir(f.projectRoot);
  await assert.rejects(f.service.prepareLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_PROJECT_CONFLICT" });
  assert.equal(f.calls.some(value => value[0] === "project" || value[0] === "session-create"), false);
  assert.equal(f.failure.stage, "project");
});

test("prepared missing project cannot become a fresh creation on repeated resume", async t => {
  const f = await fixture(t, { phase: "ready" });
  for (let retry = 0; retry < 2; retry++) await assert.rejects(f.service.prepareLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_PROJECT_MISSING" });
  assert.equal(f.attempt.preparation.phase, "ready");
  assert.equal(f.calls.some(value => value[0] === "project" || value[0] === "failure"), false);
});

test("changed repository authority is not adopted using only the training marker", async t => {
  const f = await fixture(t, { setup: "succeeded" });
  await f.service.prepareLesson({ actor, attemptId });
  const training = f.calls.find(value => value[0] === "project")[1].training;
  f.setMetadata({ training, repository: { mode: "github" } });
  await assert.rejects(f.service.prepareLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_PROJECT_CONFLICT" });
  assert.equal(f.calls.filter(value => value[0] === "session-read").length, 1);
  assert.equal(f.attempt.preparation.phase, "ready");
});

test("a missing prepared session never duplicates the session", async t => {
  const f = await fixture(t, { setup: "succeeded" });
  await f.service.prepareLesson({ actor, attemptId });
  f.setSession(null);
  for (let retry = 0; retry < 2; retry++) await assert.rejects(f.service.prepareLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_SESSION_MISSING" });
  assert.equal(f.calls.filter(value => value[0] === "session-create").length, 1);
  assert.equal(f.attempt.preparation.phase, "ready");
});

test("exercise path traversal cannot write outside the original temporary checkout", async t => {
  const f = await fixture(t, { files: [{ path: "../escaped.txt", bytes: Buffer.from("escape") }] });
  await assert.rejects(f.service.prepareLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_EXERCISE_PATH_INVALID" });
  await assert.rejects(readFile(path.join(f.root, "escaped.txt")), { code: "ENOENT" });
  assert.equal(f.calls.some(value => value[0] === "session-create"), false);
});

test("setup failure is recorded without claiming prepared or running", async t => {
  const f = await fixture(t, { setup: "failed" });
  const result = await f.service.prepareLesson({ actor, attemptId });
  assert.equal(f.failure.stage, "setup");
  assert.equal(result.attempt.preparation.phase, "preparing");
  assert.equal(result.previewReady, false);
});

test("session failures retain the same identity and original error when diagnosis save fails", async t => {
  const f = await fixture(t);
  const original = Object.assign(new Error("session failure"), { code: "session_failed" });
  f.owners.sessions.createSession = async () => { throw original; };
  f.owners.learners.recordPreparationFailure = async () => { throw new Error("disk failure"); };
  await assert.rejects(f.service.prepareLesson({ actor, attemptId }), error => error === original);
  assert.equal(f.attempt.preparation.initialSessionId, `training-${attemptId}`);
});

test("changed canonical initial source refuses before session creation", async t => {
  const f = await fixture(t);
  const original = Object.assign(new Error("Changed canonical source"), { code: "vibe64_managed_project_source_mismatch" });
  f.owners.projectRepositoryService.verifyTrainingProjectSource = async () => { throw original; };
  await assert.rejects(f.service.prepareLesson({ actor, attemptId }), error => error === original);
  assert.equal(f.calls.some(value => value[0] === "session-create"), false);
});

test("saved setup success cannot admit a changed current recipe", async t => {
  const f = await fixture(t, { setup: "succeeded" });
  await f.service.prepareLesson({ actor, attemptId });
  f.owners.terminals.workspaceSetupIsPrepared = async () => false;
  await assert.rejects(f.service.prepareLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_SETUP_CHANGED" });
  assert.equal(f.attempt.preparation.phase, "ready");
  assert.equal(f.calls.filter(value => value[0] === "session-create").length, 1);
});

test("ending learning excludes preparation and old end replay cannot acquire a successor lock", async t => {
  const f = await fixture(t);
  const input = { actor, attemptId, requestId: "end-one", expectedRevision: 1, reason: "restart" };
  f.owners.learners.readState = async ({ actor: user, includeCompletion }) => {
    assert.equal(user, actor);
    assert.equal(includeCompletion, true);
    return { progress: { attempts: [f.attempt] } };
  };
  f.owners.learners.endAttempt = async value => {
    assert.deepEqual(value, input);
    f.calls.push(["end", value]);
    f.attempt.ended = { requestId: "end-one", revision: 2, reason: "restart" };
    return { revision: 2, attempt: f.attempt, active: null, replayed: false };
  };
  const service = createTrainingService(f.owners);
  const ended = await service.endLesson(input);
  assert.equal(ended.active, null);
  assert.deepEqual(f.calls.map(([name]) => name), ["lock", "end"]);
  f.owners.learners.runPreparationExclusive = () => assert.fail("Ended replay cannot lock a successor's preparation.");
  f.owners.learners.endAttempt = async value => {
    assert.deepEqual(value, input);
    return { ...ended, active: { attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, replayed: true };
  };
  const replay = await service.endLesson(input);
  assert.equal(replay.replayed, true);
  assert.notEqual(replay.active.attemptId, attemptId);
  assert.deepEqual(f.calls.map(([name]) => name), ["lock", "end"], "no native Stop/archive/delete or source effects");
});

test("an ended reservation replay is returned without preparing or reactivating its project", async t => {
  const f = await fixture(t);
  f.attempt.ended = { requestId: "end-one", revision: 2, reason: "restart" };
  const result = await f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, requestId: "original-start", expectedRevision: 0 });
  assert.equal(result.attempt.ended.reason, "restart");
  assert.equal(result.previewReady, false);
  assert.deepEqual(f.calls.map(([name]) => name), ["reserve"]);
});

test("explicit continuation derives a disabled release pin from ended learner history and reserves before effects", async t => {
  const f = await fixture(t, { enabled: false, setup: "succeeded" });
  const oldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const previous = { ...structuredClone(f.attempt), attemptId: oldId,
    ended: { requestId: "end-old", revision: 8, reason: "discard" } };
  f.owners.learners.readState = async input => {
    assert.deepEqual(input, { actor, includeCompletion: true });
    return { revision: 8, active: null, progress: { attempts: [previous] } };
  };
  f.owners.catalogue.readCatalogue = () => assert.fail("Continuation is bound to retained content, not new course admission.");
  const result = await f.service.continueLesson({ actor, attemptId: oldId, requestId: "continue-one", expectedRevision: 8 });
  assert.deepEqual(f.calls[0], ["reserve", { actor, pin, requestId: `continue_${oldId}_continue-one`, expectedRevision: 8 }]);
  assert.equal(result.attempt.attemptId, attemptId);
  assert.notEqual(result.attempt.attemptId, oldId);
  assert.deepEqual(result.attempt.pin, previous.pin);
  assert.equal(result.attempt.preparation.phase, "ready");
  assert.equal(result.previewReady, false);
  assert.equal(f.calls.filter(([name]) => name === "project").length, 1);
  assert.equal(f.calls.filter(([name]) => name === "session-create").length, 1);
  assert.equal(f.calls.some(([name]) => ["end", "archive", "delete"].includes(name)), false);
});

test("continuation rejects foreign, unended and unrelated active targets before reservation or preparation", async t => {
  const f = await fixture(t, { enabled: false });
  const old = { ...structuredClone(f.attempt), ended: { requestId: "ended", revision: 2, reason: "restart" } };
  for (const saved of [
    { active: null, progress: { attempts: [] } },
    { active: f.attempt, progress: { attempts: [f.attempt] } },
    { active: { ...f.attempt, attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", requestIds: ["independent-start"] }, progress: { attempts: [old] } }
  ]) {
    f.owners.learners.readState = async () => saved;
    await assert.rejects(f.service.continueLesson({ actor, attemptId, requestId: "new-continuation", expectedRevision: 2 }),
      error => ["VIBE64_TRAINING_ATTEMPT_MISSING", "VIBE64_TRAINING_ATTEMPT_CONFLICT"].includes(error.code));
    assert.deepEqual(f.calls, []);
  }
});

test("exact continuation replay returns its ended target without locking an independent successor", async t => {
  const f = await fixture(t);
  const continuedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const previous = { ...structuredClone(f.attempt), ended: { requestId: "end-old", revision: 2, reason: "restart" } };
  const continued = { ...structuredClone(f.attempt), attemptId: continuedId,
    requestIds: [`continue_${attemptId}_retry-one`], ended: { requestId: "end-continued", revision: 4, reason: "restart" } };
  const successor = { ...structuredClone(f.attempt), attemptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", requestIds: ["independent-start"] };
  f.owners.learners.readState = async () => ({ active: successor, progress: { attempts: [previous, continued, successor] } });
  f.owners.learners.reserveAttempt = async input => {
    f.calls.push(["reserve", input]);
    return { revision: 5, attempt: continued, active: successor, replayed: true };
  };
  f.owners.learners.runPreparationExclusive = () => assert.fail("An ended continuation replay cannot lock a successor.");
  const result = await f.service.continueLesson({ actor, attemptId, requestId: "retry-one", expectedRevision: 2 });
  assert.equal(result.attempt.attemptId, continuedId);
  assert.equal(result.active.attemptId, successor.attemptId);
  assert.equal(result.replayed, true);
  assert.equal(result.previewReady, false);
  assert.deepEqual(f.calls.map(([name]) => name), ["reserve"]);
});

test("continuation preserves the original admission revision and bounds its actor-scoped request", async t => {
  const f = await fixture(t);
  const previous = { ...structuredClone(f.attempt), ended: { requestId: "end-old", revision: 2, reason: "restart" } };
  f.owners.learners.readState = async () => ({ revision: 99, active: null, progress: { attempts: [previous] } });
  f.owners.learners.reserveAttempt = () => assert.fail("A stale or future admitted revision must refuse before reservation.");
  for (const expectedRevision of [2, 100]) {
    await assert.rejects(f.service.continueLesson({ actor, attemptId, requestId: "stale", expectedRevision }), { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  }
  assert.deepEqual(f.calls, []);
  for (const requestId of [undefined, "", "a".repeat(19), "bad/request"]) {
    await assert.rejects(f.service.continueLesson({ actor, attemptId, requestId, expectedRevision: 2 }), /continuation request/u);
  }
  assert.deepEqual(f.calls, []);
});

test("ordinary starts cannot preoccupy host-owned continuation identities", async t => {
  const f = await fixture(t);
  f.owners.catalogue.readCatalogue = () => assert.fail("A reserved continuation identity refuses before catalogue or effects.");
  await assert.rejects(f.service.startLesson({ actor, courseId: "intro", release: "0.1.0", lessonCode: "USE-ONE",
    requestId: `continue_${attemptId}_native-continue`, expectedRevision: 0 }), { code: "VIBE64_TRAINING_REQUEST_INVALID" });
  assert.deepEqual(f.calls, []);
});



test("missing exercise provisioner refuses before preparation effects while retaining the original reservation", async t => {
  for (const missing of [undefined, {}, { createManagedGitProject() {} }, { verifyTrainingProjectSource() {} }]) {
    const f = await fixture(t);
    f.owners.projectRepositoryService = missing;
    const service = createTrainingService(f.owners);
    await assert.rejects(service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "local-start" }),
      { code: "VIBE64_TRAINING_EXERCISE_UNAVAILABLE", statusCode: 409 });
    assert.deepEqual(f.calls.map(([name]) => name), ["reserve", "lock", "lesson"]);
    assert.equal(f.attempt.preparation.phase, "reserved");
    assert.equal(f.failure, null);
    assert.equal(f.state().revision, 1);
    await assert.rejects(service.prepareLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_EXERCISE_UNAVAILABLE" });
    assert.deepEqual(f.calls.map(([name]) => name), ["reserve", "lock", "lesson", "lock", "lesson"]);
    await assert.rejects(readFile(path.join(f.sourceRoot, "genesis/stack.md")), { code: "ENOENT" });
  }
});

test("no-exercise preparation does not require an exercise provisioner", async t => {
  const f = await fixture(t);
  f.owners.projectRepositoryService = undefined;
  f.owners.content.readLesson = async () => ({ lesson: {} });
  const service = createTrainingService(f.owners);
  const started = await service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "local-quiz" });
  const resumed = await service.prepareLesson({ actor, attemptId });
  assert.deepEqual(resumed, started);
  assert.equal(resumed.attempt.preparation.phase, "reserved");
  assert.deepEqual(f.calls.map(([name]) => name), ["reserve", "lock", "lock"]);
  assert.equal(f.failure, null);
});


test("local preparation admits the original exercise effects under its existing exclusive barrier", async t => {
  const f = await fixture(t);
  const { createStudioProjectContext } = await import("@local/vibe64-core/server/studioProjectContext");
  const { currentProjectRequestContext } = await import("@local/vibe64-core/server/projectRequestContext");
  const working = path.join(f.root, "working");
  await mkdir(working);
  const core = createStudioProjectContext({ explicitTargetRoot: working, explicitSystemRoot: path.join(f.root, "system"),
    explicitManagedSourceRoot: path.join(f.root, "managed-source"), home: f.root, runtimeProfile: { local: true } });
  let barrierHeld = false;
  let barrierAdmissions = 0;
  const originalBarrier = f.owners.learners.runPreparationExclusive;
  f.owners.learners.runPreparationExclusive = async (input, operation) => {
    assert.equal(barrierHeld, false, "Practice admission must never reacquire the held nonreentrant learner barrier.");
    barrierAdmissions++;
    barrierHeld = true;
    try { return await originalBarrier(input, operation); } finally { barrierHeld = false; }
  };
  f.owners.projectContext = core;
  f.owners.projectRepositoryService.createManagedGitProject = async (input, options) => {
    assert.equal(barrierHeld, true);
    assert.equal(core.currentPracticeProjectScope().access, "create");
    assert.equal(currentProjectRequestContext().vibe64User.uid, actor.uid);
    return core.createWorkspaceProjectRecord(input, { prepare: ({ projectContextRoot }) => options.initializeProject({ projectRoot: projectContextRoot }) });
  };
  const originalProof = f.owners.projectRepositoryService.verifyTrainingProjectSource;
  f.owners.projectRepositoryService.verifyTrainingProjectSource = (input, options) => {
    assert.equal(barrierHeld, true);
    assert.deepEqual(core.currentPracticeProjectScope().training, input.training);
    return originalProof(input, options);
  };
  const originalCreate = f.owners.sessions.createSession;
  f.owners.sessions.createSession = (input, options) => {
    assert.equal(barrierHeld, true);
    assert.equal(core.currentPracticeProjectScope().access, "create");
    return originalCreate(input, options);
  };
  const service = createTrainingService(f.owners);
  const pending = await service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "local-start" });
  assert.equal(pending.attempt.preparation.phase, "preparing");
  assert.equal(pending.previewReady, false);
  assert.equal(barrierAdmissions, 1);
  assert.equal(barrierHeld, false);
  assert.equal(core.currentPracticeProjectScope(), null);
  assert.equal(core.targetRoot, working);
  await core.runWithPracticeProjectScope({ actor, training: {
    schemaVersion: 1, learnerKey: Buffer.from("123").toString("base64url"), attemptId, pin,
    exercise: { kind: "bundled", sourcePath: "training/exercises/orientation-app" }
  } }, async () => {
    const prepared = await core.readWorkspaceProjectState({ slug: f.attempt.projectSlug });
    assert.equal(await readFile(path.join(prepared.projectContextRoot, "genesis/stack.md"), "utf8"), "approved exercise");
    assert.equal(prepared.projectRuntimeRoot, path.join(core.systemRoot, "projects", f.attempt.projectSlug));
  });
  assert.equal(f.calls.filter(([name]) => name === "source-proof").length, 1);
  assert.equal(f.calls.filter(([name]) => name === "session-create").length, 1);
  assert.equal(f.calls.some(([name]) => name === "ready"), false);
});

test("configured practice session context wraps the original preparation session block under exactly its already-held barrier", async t => {
  const f = await fixture(t);
  const [{ createStudioProjectContext }, { createService: createProject }, { createTrainingLearningSessions },
    { captureProjectRequestContext, currentProjectRequestContext, runWithProjectRequestContext, assertProjectEffectAdmission }] = await Promise.all([
    import("../../packages/vibe64-core/src/server/studioProjectContext.js"),
    import("../../packages/vibe64-project/src/server/service.js"),
    import("../../packages/vibe64-training/src/server/learningSessions.js"),
    import("../../packages/vibe64-core/src/server/projectRequestContext.js")
  ]);
  const working = path.join(f.root, "working");
  await mkdir(working);
  const core = createStudioProjectContext({ explicitTargetRoot: working, explicitSystemRoot: path.join(f.root, "system"),
    explicitManagedSourceRoot: path.join(f.root, "managed-source"), home: f.root, runtimeProfile: { local: true } });
  const actualProject = createProject({ projectContext: core });
  const originalRuntime = f.owners.project.createRuntime;
  // Retain this ORIGINAL coordinator fixture's controlled session/setup seams.
  // Actual Runtime/Store/Git binding is proved in the original learner owner file.
  f.owners.project = { ...actualProject, createRuntime: originalRuntime };
  f.owners.projectContext = core;
  const training = { schemaVersion: 1, learnerKey: Buffer.from("123").toString("base64url"), attemptId, pin,
    exercise: { kind: "bundled", sourcePath: "training/exercises/orientation-app" } };
  const scope = { learnerId: "123", attemptId, pin, noExercise: false };
  f.owners.learners.readLearningSessionScope = async () => {
    throw Object.assign(new Error("This original fixture has an exercise"), { code: "VIBE64_TRAINING_EXERCISE_REQUIRED" });
  };
  f.owners.learners.readExerciseProjectScope = async input => {
    assert.equal(input.actor, actor);
    assert.equal(input.attemptId, attemptId);
    return { scope, systemRoot: core.systemRoot, training, projectSlug: f.attempt.projectSlug,
      initialSessionId: f.attempt.preparation.initialSessionId, active: true, activeSummaryCurrent: true };
  };
  let held = false;
  let entries = 0;
  const originalBarrier = f.owners.learners.runPreparationExclusive;
  f.owners.learners.runPreparationExclusive = async (input, operation) => {
    assert.equal(held, false, "the Preparation context cannot reacquire the non-reentrant barrier");
    entries++;
    held = true;
    try { return await originalBarrier(input, operation); } finally { held = false; }
  };
  f.owners.projectRepositoryService.createManagedGitProject = (input, options) =>
    core.createWorkspaceProjectRecord(input, { prepare: ({ projectContextRoot }) => options.initializeProject({ projectRoot: projectContextRoot }) });
  let captured;
  const originalCreate = f.owners.sessions.createSession;
  f.owners.sessions.createSession = (input, options) => {
    assert.equal(held, true);
    assert.deepEqual(currentProjectRequestContext().learningScope, scope);
    assert.equal(currentProjectRequestContext().slug, f.attempt.projectSlug);
    assert.equal(core.currentPracticeProjectScope().access, "create");
    captured = captureProjectRequestContext();
    return originalCreate(input, options);
  };
  f.owners.learningSessions = createTrainingLearningSessions({ learners: f.owners.learners,
    teachingBrief: { readBrief: async () => ({ attemptId, activeSummaryCurrent: true, pin, lesson: { exerciseRequired: true } }) },
    project: f.owners.project, sessions: { ...f.owners.sessions, inspectSession: async () => assert.fail("preparation does not reopen an alternative") },
    projectContext: core, practiceSessions: true });
  const service = createTrainingService(f.owners);
  const result = await service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "bound-practice-start" });
  assert.equal(entries, 1);
  assert.equal(held, false);
  assert.equal(result.attempt.preparation.phase, "preparing");
  assert.equal(result.previewReady, false);
  assert.equal(f.calls.filter(([name]) => name === "source-proof").length, 1);
  const creation = f.calls.find(([name]) => name === "session-create");
  assert.deepEqual(creation[2], { sessionId: `training-${attemptId}`, expectedCommit: "d".repeat(40) });
  await runWithProjectRequestContext(captured, async () => {
    assert.equal(core.currentPracticeProjectScope().access, "control");
    assert.deepEqual(currentProjectRequestContext().learningScope, scope);
    assert.throws(assertProjectEffectAdmission, { code: "vibe64_practice_effect_admission_required" });
    assert.equal((await actualProject.readCurrentProject()).slug, f.attempt.projectSlug);
  });
  assert.equal(core.targetRoot, working);
});
