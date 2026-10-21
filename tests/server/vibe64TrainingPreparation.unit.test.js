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

async function fixture(t, { enabled = true, courseStatus = "released", phase = "reserved", setup = "running", files = [{ path: "genesis/stack.md", bytes: Buffer.from("approved exercise") }] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  const sourceRoot = path.join(root, "source");
  const calls = [];
  let metadata = {};
  let session = null;
  let revision = 1;
  let failure = null;
  const scopes = [];
  const attempt = { attemptId, pin, projectSlug: "training-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa", preparation: { phase,
    ...(phase === "reserved" ? {} : { initialSessionId: `training-${attemptId}` }) } };
  const state = () => structuredClone({ revision, attempt, active: { learnerId: "123" } });
  // The learner's saved progress before a start: no lesson in progress.
  let progress = { revision: 0, progress: { activeAttemptId: null, attempts: [] } };
  const learners = {
    async readState() { return structuredClone(progress); },
    async reserveAttempt(input) { calls.push(["reserve", input]); return state(); },
    async setLearningMode(input) { calls.push(["mode", input.on]); return { on: input.on }; },
    async runPreparationExclusive(input, operation) { calls.push(["lock", input]); return operation(); },
    async resumeAttempt() { return state(); },
    async beginPreparation(input) {
      calls.push(["begin", input.initialSessionId]);
      if (attempt.preparation.phase === "reserved") {
        attempt.preparation = { phase: "preparing", initialSessionId: `training-${attempt.attemptId}` };
        revision++;
      }
      return state();
    },
    async recordPreparationReady() { calls.push(["ready"]); attempt.preparation.phase = "ready"; revision++; return state(); },
    async recordPreparationFailure(input) { failure = input; calls.push(["failure", input]); attempt.preparation.phase = "preparing"; revision++; return state(); }
  };
  const owners = {
    catalogue: { async readCatalogue() { return { courses: [{ enabled, course: { ...pin.course, status: courseStatus }, lock: { topics: [{ ...pin.topic, manifestHash: pin.topic.topicHash, lessons: [{ ...pin.lesson, status: "published" }] }] } }] }; } },
    content: {
      async readLesson(input) { calls.push(["lesson", input]); return { lesson: { exercise: { kind: "bundled" } } }; },
      async readExercise(input) { calls.push(["exercise", input]); return { sourcePath: "training/exercises/orientation-app", files }; }
    },
    learners,
    learningSpace: { async closeAttempt(input) { calls.push(["close", input]); revision++; return { ok: true, attemptId: input.attemptId, closed: true }; } },
    projectContext: {
      async readWorkspaceProjectState() { return { projectContextRoot: projectRoot, metadata }; },
      async runWithPracticeProjectScope(input, operation) { scopes.push(input); return operation(); }
    },
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
  return { root, sourceRoot, projectRoot, owners, calls, attempt, state, scopes, get failure() { return failure; },
    setProgress(value) { progress = value; },
    setMetadata(value) { metadata = value; }, setSession(value) { session = value; }, service: createTrainingService(owners) };
}

test("enabled course reserves exact approved pin before effects and pending setup is not ready", async t => {
  const f = await fixture(t);
  const result = await f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "start-1" });
  assert.deepEqual(f.calls[0], ["reserve", { actor, expectedRevision: 0, requestId: "start-1", pin }]);
  assert.deepEqual(f.calls.slice(0, 6).map(value => value[0]), ["reserve", "mode", "lock", "lesson", "begin", "exercise"]);
  assert.equal(f.calls[1][1], true, "a start switches the learner to Learn mode");
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
  delete f.attempt.projectSlug;
  delete f.attempt.preparation;
  f.owners.content.readLesson = async input => {
    assert.deepEqual(input, { ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash });
    f.calls.push(["lesson", input]);
    return { lesson: { assessments: [{ id: "setup", kind: "answer" }] } };
  };
  const started = await f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "start-one" });
  const resumed = await f.service.prepareLesson({ actor, attemptId });
  assert.deepEqual(resumed, started);
  assert.equal(Object.hasOwn(resumed.attempt, "preparation") || Object.hasOwn(resumed.attempt, "projectSlug"), false);
  assert.equal(resumed.revision, 1);
  assert.equal(resumed.previewReady, false);
  assert.deepEqual(f.calls.map(([name]) => name), ["reserve", "mode", "lock", "lesson", "lock", "lesson"]);
  await assert.rejects(readFile(path.join(f.sourceRoot, "genesis/stack.md")), { code: "ENOENT" });
});

test("failed content cannot begin effects", async t => {
  const f = await fixture(t, { phase: "preparing" });
  const original = new Error("Installed pin changed");
  f.owners.content.readLesson = async () => { throw original; };
  await assert.rejects(f.service.prepareLesson({ actor, attemptId }), error => error === original);
  assert.deepEqual(f.calls.map(([name]) => name), ["lock"]);
});

test("disabled course rejects new reservations without project or session effects", async t => {
  const f = await fixture(t, { enabled: false });
  await assert.rejects(f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code }), { code: "VIBE64_TRAINING_COURSE_UNAVAILABLE" });
  assert.deepEqual(f.calls, []);
});

test("a preview course admits a new start only for the workspace owner; released courses admit every role", async t => {
  for (const role of [undefined, "member", "admin"]) {
    const f = await fixture(t, { courseStatus: "preview" });
    await assert.rejects(f.service.startLesson({ actor: { ...actor, role }, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "try-1" }),
      { code: "VIBE64_TRAINING_COURSE_PREVIEW", statusCode: 403,
        message: "This preview course can be tried only by the workspace owner until it is released." });
    assert.deepEqual(f.calls, []);
  }
  const owner = { ...actor, role: "owner" };
  const tried = await fixture(t, { courseStatus: "preview" });
  const started = await tried.service.startLesson({ actor: owner, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "try-1" });
  assert.deepEqual(tried.calls.find(([name]) => name === "reserve"), ["reserve", { actor: owner, expectedRevision: 0, requestId: "try-1", pin }]);
  assert.equal(started.attempt.preparation.phase, "preparing");
  // The owner's preview attempt is ordinary saved work: resume reads no catalogue.
  tried.owners.catalogue.readCatalogue = () => assert.fail("Resume must not re-admit the course");
  assert.equal((await tried.service.prepareLesson({ actor: owner, attemptId })).attempt.attemptId, attemptId);
  for (const role of ["member", "admin", "owner"]) {
    const f = await fixture(t);
    await f.service.startLesson({ actor: { ...actor, role }, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "start-1" });
    assert.equal(f.calls[0][0], "reserve");
  }
  for (const enabled of [false, true]) {
    const f = await fixture(t, { enabled, courseStatus: "preview" });
    const lessonCode = enabled ? "V64-DRAFT" : pin.lesson.code;
    if (enabled) f.owners.catalogue.readCatalogue = async () => ({ courses: [{ enabled, course: { ...pin.course, status: "preview" },
      lock: { topics: [{ ...pin.topic, manifestHash: pin.topic.topicHash, lessons: [{ code: lessonCode, hash: pin.lesson.hash, status: "draft" }] }] } }] });
    await assert.rejects(f.service.startLesson({ actor: owner, ...pin.course, lessonCode, expectedRevision: 0, requestId: "try-1" }),
      { code: enabled ? "VIBE64_TRAINING_LESSON_UNAVAILABLE" : "VIBE64_TRAINING_COURSE_UNAVAILABLE" });
    assert.deepEqual(f.calls, []);
  }
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

test("a start whose Workspace setup is still running records ready through the original owner when that setup run finishes", async t => {
  const f = await fixture(t);
  const finished = Promise.withResolvers();
  f.owners.terminals.waitForWorkspaceSetup = id => { f.calls.push(["setup-wait", id]); return finished.promise; };
  const service = createTrainingService(f.owners);
  const started = await service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "start-1" });
  assert.equal(started.attempt.preparation.phase, "preparing", "a running setup is not reported ready");
  assert.deepEqual(f.calls.filter(([name]) => name === "setup-wait"), [["setup-wait", `training-${attemptId}`]]);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.attempt.preparation.phase, "preparing", "readiness waits for the actual setup run");
  // The fixture session stands in for the setup runner's own saved result.
  f.setSession({ sessionId: `training-${attemptId}`, status: "open", workspaceSetup: { status: "succeeded" } });
  finished.resolve();
  for (let i = 0; i < 50 && f.attempt.preparation.phase !== "ready"; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.attempt.preparation.phase, "ready");
  assert.equal(f.calls.filter(([name]) => name === "session-create").length, 1, "the follow-up reuses the exact prepared session");
  assert.equal(f.calls.filter(([name]) => name === "lock").length, 2, "the follow-up uses the original preparation barrier");
  assert.equal(f.calls.filter(([name]) => name === "setup-check").length, 1, "the follow-up proves current setup before ready");
});

test("a failed Workspace setup leaves the start preparing without a readiness follow-up", async t => {
  const f = await fixture(t, { setup: "failed" });
  f.owners.terminals.waitForWorkspaceSetup = async () => null;
  const result = await createTrainingService(f.owners).prepareLesson({ actor, attemptId });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(result.attempt.preparation.phase, "preparing");
  assert.equal(f.calls.filter(([name]) => name === "failure").length, 1, "the failure keeps its original diagnosis");
  assert.equal(f.calls.filter(([name]) => name === "lock").length, 1, "no follow-up repeats a finished failure");
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

test("an ended reservation replay is returned without preparing or reactivating its project", async t => {
  const f = await fixture(t);
  f.attempt.ended = { requestId: "end-one", revision: 2, reason: "finished" };
  const result = await f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, requestId: "original-start", expectedRevision: 0 });
  assert.equal(result.attempt.ended.reason, "finished");
  assert.equal(result.previewReady, false);
  assert.deepEqual(f.calls.map(([name]) => name), ["reserve"]);
});

test("missing exercise provisioner refuses before preparation effects while retaining the original reservation", async t => {
  for (const missing of [undefined, {}, { createManagedGitProject() {} }, { verifyTrainingProjectSource() {} }]) {
    const f = await fixture(t);
    f.owners.projectRepositoryService = missing;
    const service = createTrainingService(f.owners);
    await assert.rejects(service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, expectedRevision: 0, requestId: "local-start" }),
      { code: "VIBE64_TRAINING_EXERCISE_UNAVAILABLE", statusCode: 409 });
    assert.deepEqual(f.calls.map(([name]) => name), ["reserve", "mode", "lock", "lesson"]);
    assert.equal(f.attempt.preparation.phase, "reserved");
    assert.equal(f.failure, null);
    assert.equal(f.state().revision, 1);
    await assert.rejects(service.prepareLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_EXERCISE_UNAVAILABLE" });
    assert.deepEqual(f.calls.map(([name]) => name), ["reserve", "mode", "lock", "lesson", "lock", "lesson"]);
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
  assert.deepEqual(f.calls.map(([name]) => name), ["reserve", "mode", "lock", "lock"]);
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
    schemaVersion: 2, learnerKey: Buffer.from("123").toString("base64url"), practiceId: attemptId, pin,
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

// Learning v2 (F1): the initial practice session is an ordinary project
// session. The same preparation barrier and create scope admit its creation,
// but no learning binding is put in its Project context.
test("practice preparation creates an ordinary initial session under exactly its already-held barrier and create scope", async t => {
  const f = await fixture(t);
  const [{ createStudioProjectContext }, { createService: createProject },
    { captureProjectRequestContext, currentProjectRequestContext, runWithProjectRequestContext, assertProjectEffectAdmission }] = await Promise.all([
    import("../../packages/vibe64-core/src/server/studioProjectContext.js"),
    import("../../packages/vibe64-project/src/server/service.js"),
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
    assert.equal(currentProjectRequestContext().learningScope, undefined, "an ordinary session has no learning binding");
    assert.equal(currentProjectRequestContext().slug, f.attempt.projectSlug);
    assert.equal(core.currentPracticeProjectScope().access, "create");
    captured = captureProjectRequestContext();
    return originalCreate(input, options);
  };
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
    assert.equal(currentProjectRequestContext().learningScope, undefined);
    assert.throws(assertProjectEffectAdmission, { code: "vibe64_practice_effect_admission_required" });
    assert.equal((await actualProject.readCurrentProject()).slug, f.attempt.projectSlug);
  });
  assert.equal(core.targetRoot, working);
});

// Rev 4 H4/H5: one lesson in progress; restart, finish and delete close the
// attempt through the learning space (learningSpace.closeAttempt).
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherPin = { ...pin, lesson: { code: "V64-START-02", hash: "e".repeat(64) } };
const inProgress = (f, attempt, revision = 5) => f.setProgress({ revision, completion: null,
  progress: { activeAttemptId: attempt.attemptId, attempts: [attempt] } });

test("another lesson in progress refuses a start once with its title; archiveCurrent archives it first", async t => {
  const f = await fixture(t);
  f.owners.content.readLesson = async input => {
    f.calls.push(["lesson", input]);
    return { lesson: { title: input.lessonCode === "V64-START-02" ? "Your second lesson" : "First", exercise: { kind: "bundled" } } };
  };
  inProgress(f, { attemptId: otherId, pin: otherPin, requestIds: ["other"] });
  const service = createTrainingService(f.owners);
  const start = extra => service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, requestId: "start-1", expectedRevision: 5, ...extra });
  await assert.rejects(start(), error => error.code === "VIBE64_TRAINING_LESSON_IN_PROGRESS" && error.statusCode === 409 &&
    error.details.attemptId === otherId && error.details.lessonTitle === "Your second lesson");
  await assert.rejects(start({ archiveCurrent: true, expectedRevision: 4 }), { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  assert.deepEqual(f.calls.filter(([name]) => ["close", "reserve"].includes(name)), [], "a refusal changes nothing");

  // The confirmed start archives the lesson in progress, then reserves at the
  // revision that archive left.
  f.owners.learners.readState = async () => f.calls.some(([name]) => name === "close")
    ? { revision: 6, progress: { activeAttemptId: null, attempts: [] } }
    : { revision: 5, progress: { activeAttemptId: otherId, attempts: [{ attemptId: otherId, pin: otherPin, requestIds: [] }] } };
  await start({ archiveCurrent: true });
  assert.deepEqual(f.calls.filter(([name]) => ["close", "reserve", "mode"].includes(name)), [
    ["close", { actor, attemptId: otherId, archive: true, reason: "archived" }],
    ["reserve", { actor, requestId: "start-1", expectedRevision: 6, pin }], ["mode", true]]);
});

test("the same lesson in progress, or a replayed start, goes straight to the learner store", async t => {
  const f = await fixture(t);
  inProgress(f, { attemptId, pin, requestIds: ["start-0"] });
  await f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, requestId: "start-1", expectedRevision: 5 });
  inProgress(f, { attemptId: otherId, pin: otherPin, requestIds: ["start-1"] });
  await f.service.startLesson({ actor, ...pin.course, lessonCode: pin.lesson.code, requestId: "start-1", expectedRevision: 5 });
  assert.equal(f.calls.filter(([name]) => name === "reserve").length, 2);
  assert.equal(f.calls.some(([name]) => name === "close"), false);
});

test("restart archives the attempt, then prepares a new attempt of the same lesson with a fresh project and session", async t => {
  const f = await fixture(t, { setup: "succeeded" });
  const old = { attemptId: otherId, pin, projectSlug: "training-bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb", requestIds: ["start-0"] };
  inProgress(f, old);
  f.owners.catalogue.readCatalogue = () => assert.fail("Restart keeps the saved pin; it is not a new course admission.");
  const service = createTrainingService(f.owners);
  await assert.rejects(service.restartLesson({ actor, attemptId: otherId, requestId: "restart-1", expectedRevision: 4 }),
    { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  await assert.rejects(service.restartLesson({ actor, attemptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", requestId: "restart-1", expectedRevision: 5 }),
    { code: "VIBE64_TRAINING_ATTEMPT_MISSING", statusCode: 404 });
  assert.deepEqual(f.calls, []);
  const result = await service.restartLesson({ actor, attemptId: otherId, requestId: "restart-1", expectedRevision: 5 });
  assert.deepEqual(f.calls.slice(0, 3), [["close", { actor, attemptId: otherId, archive: true, reason: "archived" }],
    ["reserve", { actor, requestId: "restart-1", expectedRevision: 5, pin }], ["mode", true]]);
  assert.equal(result.attempt.attemptId, attemptId);
  assert.equal(f.calls.find(([name]) => name === "project")[1].training.practiceId, attemptId, "the marker names the new attempt");
  assert.equal(f.calls.find(([name]) => name === "session-create")[2].sessionId, `training-${attemptId}`);
  assert.equal(f.calls.filter(([name]) => name === "source-proof").length, 1, "the fresh project is proved like any first start");

  // A retry after the archive finishes the restart through the replayed reservation.
  f.setProgress({ revision: 9, progress: { activeAttemptId: null, attempts: [{ ...old, ended: { reason: "archived" } }] } });
  f.calls.length = 0;
  await service.restartLesson({ actor, attemptId: otherId, requestId: "restart-1", expectedRevision: 5 });
  assert.deepEqual(f.calls[0], ["reserve", { actor, requestId: "restart-1", expectedRevision: 9, pin }]);
  f.setProgress({ revision: 9, progress: { activeAttemptId: null, attempts: [{ ...old, ended: { reason: "deleted" } }] } });
  await assert.rejects(service.restartLesson({ actor, attemptId: otherId, requestId: "restart-2", expectedRevision: 9 }),
    { code: "VIBE64_TRAINING_ATTEMPT_MISSING" }, "a deleted lesson is not restarted");
});

test("finish is refused until every required step passed, then archives the attempt as finished; delete keeps no archive", async t => {
  const f = await fixture(t);
  const saved = (passed, revision = 5) => f.setProgress({ revision, completion: { required: 2, passed },
    progress: { activeAttemptId: attemptId, attempts: [{ attemptId, pin }] } });
  saved(1);
  await assert.rejects(f.service.finishLesson({ actor, attemptId, expectedRevision: 5 }), { code: "VIBE64_TRAINING_LESSON_INCOMPLETE" });
  saved(2);
  await assert.rejects(f.service.finishLesson({ actor, attemptId, expectedRevision: 4 }), { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  assert.deepEqual(f.calls, []);
  assert.equal((await f.service.finishLesson({ actor, attemptId, expectedRevision: 5 })).closed, true);
  assert.deepEqual(await f.service.deleteLesson({ actor, attemptId }), { ok: true, attemptId, closed: true });
  assert.deepEqual(f.calls, [["close", { actor, attemptId, archive: true, reason: "finished" }],
    ["close", { actor, attemptId, archive: false, reason: "deleted" }]]);
  const service = createTrainingService({ ...f.owners, learningSpace: null });
  await assert.rejects(service.deleteLesson({ actor, attemptId }), { code: "VIBE64_TRAINING_PRACTICE_UNAVAILABLE" });
});
