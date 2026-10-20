import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createTrainingActions } from "../../packages/vibe64-training/src/server/actions.js";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createCourseLock } from "../../packages/vibe64-training/src/server/catalogue.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createInstalledTrainingCatalogue } from "../../packages/vibe64-training/src/server/installedCatalogue.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";

async function fixture(t, { presentation = false, released = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-actions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "system");
  const source = path.join(root, "source");
  await mkdir(systemRoot);
  async function write(base, filename, value) {
    const destination = path.join(base, filename);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  await write(source, "package.json", { name: "learn-action-fixture", version: "0.1.0", repository: { type: "git", url: "https://github.com/examples/learn-action-fixture.git" },
    vibe64Training: { schemaVersion: 1, topicId: "action-fixture", domainId: "vibe64", title: "Action fixture", status: released ? "released" : "preview", outline: "training/outline.md", prerequisites: [],
      lessons: [{ code: "USE-ONE", descriptor: "training/lessons/USE-ONE/lesson.json", status: "published", required: true }] } });
  await write(source, "training/outline.md", "# One lesson\nTry the application.\n");
  await write(source, "training/lessons/USE-ONE/lesson.json", { schemaVersion: 1, code: "USE-ONE", title: "Try the application", document: "lesson.md", prerequisites: [], estimatedMinutes: 5,
    visuals: [{ id: "request", descriptor: "../../visuals/request/visual.json" }], assessments: [{ id: "explain", kind: "answer", required: true, rubric: "lesson.md#explain" }] });
  await write(source, "training/lessons/USE-ONE/lesson.md", '# Try the app\n<a id="explain"></a>\nExplain what you tried in your own words.\n');
  await write(source, "training/visuals/request/visual.json", { schemaVersion: 1, id: "request", title: "One request", svg: "diagram.svg", controller: "controller.js",
    initialState: "overview", states: ["overview"], description: "A display-only request.", commands: presentation
      ? [{ name: "show", description: "Show one request.", completionState: "overview", parameters: [{ name: "label", required: true, maxLength: 16 }] }] : [] });
  await write(source, "training/visuals/request/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>SVG_SOURCE_ONLY</title></svg>');
  await write(source, "training/visuals/request/controller.js", 'throw new Error("CONTROLLER_SOURCE_MUST_NOT_RUN");\n');
  const commit = "a".repeat(40);
  const snapshot = path.join(systemRoot, "training/content/action-fixture", commit);
  await mkdir(path.dirname(snapshot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshot, "bundle.json")));
  const topic = { schemaVersion: 1, topicId: "action-fixture", release: "0.1.0", repository: "examples/learn-action-fixture", commit, topicHash: bundle.topicHash };
  await write(snapshot, "pin.json", topic);
  const content = createInstalledTrainingContent({ systemRoot });
  const installed = await content.readTopic(topic);
  const course = { schemaVersion: 1, courseId: "introduction", title: "One introduction", release: "0.1.0", status: released ? "released" : "preview", topics: [{ topicId: topic.topicId, release: topic.release }] };
  const lock = createCourseLock(course, [{ topicId: topic.topicId, release: topic.release, repository: topic.repository, commit,
    topicManifest: installed.topicManifest, topicHash: installed.topicHash }]);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot });
  await catalogue.enableCourse({ course, lock, expectedRevision: 0 });
  const learners = createTrainingLearnerState({ systemRoot });
  const pin = { course: { courseId: course.courseId, release: course.release }, topic, lesson: { code: "USE-ONE", hash: bundle.lessons[0].hash } };
  const auth = { user: { uid: 42, username: "member", role: "member" } };
  const reserve = () => learners.reserveAttempt({ actor: auth.user, requestId: "start-one", expectedRevision: 0, pin });
  const input = { courseId: "introduction", release: "0.1.0", lessonCode: "USE-ONE", requestId: "start-one", expectedRevision: 0 };
  const calls = [];
  const exercises = {
    async startLesson(value) {
      calls.push({ operation: "start", value });
      return { ...await learners.reserveAttempt({ actor: value.actor, requestId: value.requestId, expectedRevision: value.expectedRevision, pin }), sourceRoot: "/PRIVATE_SOURCE", previewReady: true };
    },
    async prepareLesson(value) {
      calls.push({ operation: "resume", value });
      return { ...await learners.resumeAttempt(value), sourceRoot: "/PRIVATE_SOURCE", setup: { status: "pending", command: "PRIVATE_SHELL" }, previewReady: true };
    },
    async endLesson(value) {
      calls.push({ operation: "end", value });
      const state = await learners.readState({ actor: value.actor, includeCompletion: true });
      const previous = state.progress.attempts.find(attempt => attempt.attemptId === value.attemptId);
      if (previous?.ended) return learners.endAttempt(value);
      return learners.runPreparationExclusive(value, () => learners.endAttempt(value));
    }
  };
  function register(host = null, replacements = {}) {
    const actions = createActionCatalogue();
    const definitions = createTrainingActions({ catalogue, learners, exercises: host, ...replacements });
    actions.register({ contributorId: "training", domain: "training", actions: definitions.map(definition => ({ ...definition, channels: ["api", "automation"], surfaces: ["app"] })) });
    registerVibe64ActionContext(actions, { resolveUser: async () => auth.user,
      authorizeProject() { throw new Error("Learning actions must not require a selected project."); } });
    const tools = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = tools.resolveToolSet(context);
    const execute = (name, value = {}, channel = "api", extra = {}) => actions.execute({ actionId: `vibe64.training.${name}`, input: value,
      context: { channel, surface: "app", ...extra } });
    const tool = (name, value = {}) => {
      const definition = toolSet.tools.find(item => item.actionId === `vibe64.training.${name}`);
      assert.ok(definition);
      assert.doesNotThrow(() => tools.toOpenAiToolSchema(definition));
      return tools.executeToolCall({ toolName: definition.name, toolSet, context, argumentsText: JSON.stringify(value) });
    };
    return { actions, definitions, toolSet, execute, tool };
  }
  return { root, systemRoot, snapshot, auth, catalogue, content, learners, pin, reserve, input, calls, exercises, register };
}

async function inventory(root) {
  const records = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else records.push({ path: path.relative(root, filename), hash: createHash("sha256").update(await readFile(filename)).digest("hex") });
    }
  }
  await visit(root);
  return records;
}

const excluded = /PRIVATE_SOURCE|PRIVATE_SHELL|SVG_SOURCE_ONLY|CONTROLLER_SOURCE_MUST_NOT_RUN|sourceRoot|repository|controller\.js|diagram\.svg|lesson\.md#|learnerId/u;

test("training queries share API/tool catalogue contracts and fresh member authority without project or writes", async t => {
  const f = await fixture(t);
  const c = f.register();
  assert.deepEqual(c.toolSet.tools.map(value => value.actionId).sort(), ["courses.list", "courses.create", "available.list", "course.install", "learning.read", "lesson.start", "lesson.resume", "lesson.end", "lesson.continue"].map(value => `vibe64.training.${value}`).sort());
  let before = await inventory(f.systemRoot);
  for (const name of ["courses.list", "learning.read"]) {
    const api = await c.execute(name);
    const tool = await c.tool(name);
    assert.equal(tool.ok, true, JSON.stringify(tool));
    assert.deepEqual(tool.result, api);
    assert.doesNotMatch(JSON.stringify(api), excluded);
  }
  assert.deepEqual(await inventory(f.systemRoot), before);
  const reserved = await f.reserve();
  await rm(path.join(f.systemRoot, "training/users/NDI/active-lesson.json"));
  before = await inventory(f.systemRoot);
  const input = { attemptId: reserved.attempt.attemptId };
  const current = await c.execute("learning.read");
  assert.equal(current.activeSummaryCurrent, false);
  assert.equal(current.active.attemptId, input.attemptId);
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("standalone missing exercise host reports unavailable without reservation or claiming Preview readiness", async t => {
  const f = await fixture(t);
  const c = f.register();
  const before = await inventory(f.systemRoot);
  const start = await c.execute("lesson.start", f.input);
  assert.equal(start.ok, false);
  assert.equal(start.available, false);
  assert.match(start.error, /unavailable/u);
  const resume = await c.tool("lesson.resume", { attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  assert.equal(resume.ok, true);
  assert.equal(resume.result.ok, false);
  assert.equal(resume.result.available, false);
  assert.deepEqual(await inventory(f.systemRoot), before);
  assert.equal((await f.learners.readState({ actor: f.auth.user })).active, null);
});

test("host start and resume receive exact admitted IDs and same actor while projections exclude private preparation fields", async t => {
  const f = await fixture(t);
  const c = f.register(f.exercises);
  const api = await c.execute("lesson.start", f.input);
  const viaTool = await c.tool("lesson.start", f.input);
  assert.equal(viaTool.ok, true, JSON.stringify(viaTool));
  assert.deepEqual(viaTool.result, api);
  assert.equal(api.previewReady, false);
  assert.equal(api.active.preparation.phase, "reserved");
  assert.equal(api.active.learning.submissions.length, 0);
  assert.deepEqual(f.calls[0].value, { actor: f.auth.user, ...f.input });
  assert.equal(f.calls[0].value.actor, f.auth.user);
  assert.equal(f.calls[1].value.actor, f.auth.user);
  const request = { attemptId: api.active.attemptId };
  const resumed = await c.tool("lesson.resume", request);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.result.setupStatus, "pending");
  assert.equal(resumed.result.previewReady, false);
  assert.deepEqual(f.calls.at(-1).value, { actor: f.auth.user, ...request });
  assert.doesNotMatch(JSON.stringify(resumed), excluded);
  assert.equal((await f.learners.readState({ actor: f.auth.user })).progress.attempts.length, 1);
});

test("all training actions reject spoofed actor/paths and re-resolve login for retained native tools", async t => {
  const f = await fixture(t);
  const c = f.register(f.exercises);
  const reserved = await f.reserve();
  const inputs = { "courses.list": {}, "learning.read": {},
    "lesson.start": f.input, "lesson.resume": { attemptId: reserved.attempt.attemptId },
    "lesson.end": { attemptId: reserved.attempt.attemptId, requestId: "end-one", expectedRevision: reserved.revision, reason: "discard" } };
  for (const [name, input] of Object.entries(inputs)) {
    for (const extra of [{ vibe64User: { role: "owner" } }, { actor: { uid: 42 } }, { userId: 42 }, { path: "/tmp/source" }, { projectSlug: "arbitrary" }, { command: "node" }]) {
      await assert.rejects(() => c.execute(name, { ...input, ...extra }), { code: "ACTION_VALIDATION_FAILED" });
    }
    await assert.rejects(() => c.execute(name, input, "api", { vibe64Action: { user: { uid: 42 } } }), { code: "vibe64_action_context_reserved" });
  }
  assert.equal(f.calls.length, 0);
  f.auth.user = { uid: 43, username: "another-member", role: "member" };
  assert.equal((await c.tool("learning.read")).result.active, null);
  f.auth.user = null;
  for (const [name, input] of Object.entries(inputs)) assert.equal((await c.tool(name, input)).ok, false);
  assert.equal(f.calls.length, 0);
  for (const definition of c.definitions) {
    // Owner-only creation refuses before resolving any login.
    await assert.rejects(() => definition.execute({ vibe64User: { uid: 42 }, ...inputs[definition.id.replace("vibe64.training.", "")] }, { actor: { id: "42" } }),
      { statusCode: definition.extensions.vibe64.ownerRequired ? 403 : 401 });
  }
});

test("invalid exact identities and revisions fail before exercise admission", async t => {
  const f = await fixture(t);
  const c = f.register(f.exercises);
  for (const change of [{ courseId: "../course" }, { release: "latest" }, { lessonCode: "../USE-ONE" }, { requestId: "x".repeat(65) },
    { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
    await assert.rejects(() => c.execute("lesson.start", { ...f.input, ...change }), { code: "ACTION_VALIDATION_FAILED" });
  }
  for (const attemptId of ["", "../attempt", "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa", "x".repeat(37)]) {
    await assert.rejects(() => c.execute("lesson.resume", { attemptId }), { code: "ACTION_VALIDATION_FAILED" });
  }
  assert.equal(f.calls.length, 0);
});

test("a refused preview start reports its owner-only admission message", async t => {
  const f = await fixture(t);
  const refusal = "This preview course can be tried only by the workspace owner until it is released.";
  const c = f.register({ async startLesson() {
    throw Object.assign(new Error(refusal), { code: "VIBE64_TRAINING_COURSE_PREVIEW", statusCode: 403 });
  } });
  await assert.rejects(() => c.execute("lesson.start", f.input), { code: "VIBE64_TRAINING_COURSE_PREVIEW", statusCode: 403, message: refusal });
});

test("oversized projections and native failures remain bounded, truthful and source-free", async t => {
  const f = await fixture(t);
  const saved = await f.reserve();
  // The retired teaching brief was this bound's largest reader; an oversized
  // catalogue projection now proves the same shared result bound.
  const large = f.register(null, { catalogue: { ...f.catalogue, async readCatalogue() {
    return { revision: 1, courses: [{ enabled: true, lock: { topics: [] },
      course: { courseId: "large", release: "0.1.0", title: "x".repeat(128 * 1024), status: "released" } }] };
  } } });
  await assert.rejects(() => large.execute("courses.list"), { code: "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE" });
  const failure = f.register({ async startLesson() {
    throw Object.assign(new Error("Cannot rename /PRIVATE_SOURCE/progress.json"), { code: "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", statusCode: 409 });
  }, async prepareLesson() { return { ok: false, error: "PRIVATE_SOURCE" }; } });
  const result = await failure.tool("lesson.start", f.input);
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), excluded);
  await assert.rejects(() => failure.execute("lesson.start", f.input), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED" && error.statusCode === 409 && /same request\/attempt/u.test(error.message) && error.cause.message.includes("PRIVATE_SOURCE"));
  const resumed = await failure.tool("lesson.resume", { attemptId: saved.attempt.attemptId });
  assert.equal(resumed.ok, false);
  assert.doesNotMatch(JSON.stringify(resumed), excluded);
});

test("known preparation contention retains the same attempt and gives a safe specific retry instruction", async t => {
  const f = await fixture(t);
  const saved = await f.reserve();
  const c = f.register({ async prepareLesson() {
    throw Object.assign(new Error("busy /PRIVATE_SOURCE"), { code: "VIBE64_TRAINING_PREPARATION_BUSY", statusCode: 409 });
  } });
  await assert.rejects(() => c.execute("lesson.resume", { attemptId: saved.attempt.attemptId }), error => {
    assert.equal(error.code, "VIBE64_TRAINING_PREPARATION_BUSY");
    assert.equal(error.statusCode, 409);
    assert.match(error.message, /retry the same attempt/u);
    assert.doesNotMatch(error.message, excluded);
    return true;
  });
});

test("native lesson end and ended-start replay expose the original target and actual active state without project effects", async t => {
  const f = await fixture(t);
  const c = f.register(f.exercises);
  const first = await c.execute("lesson.start", f.input);
  const input = { attemptId: first.active.attemptId, requestId: "end-first", expectedRevision: first.revision, reason: "restart" };
  const api = await c.execute("lesson.end", input);
  assert.equal(api.ok, true);
  assert.equal(api.active, null);
  assert.equal(api.attempt.attemptId, input.attemptId);
  assert.deepEqual(api.attempt.ended, { requestId: input.requestId, revision: api.revision, reason: input.reason });
  assert.equal(api.replayed, false);
  assert.equal(api.previewReady, false);
  assert.deepEqual(f.calls.at(-1), { operation: "end", value: { actor: f.auth.user, ...input } });
  assert.equal(f.calls.at(-1).value.actor, f.auth.user);
  const definition = c.definitions.find(value => value.id === "vibe64.training.lesson.end");
  assert.equal(definition.idempotency, "domain_native");
  assert.match(definition.extensions.assistant.description, /the project's ordinary sessions, step results and history remain readable and usable/u);
  assert.match(definition.extensions.assistant.description, /does not close, archive or delete anything/u);
  const beforeReplay = await inventory(f.systemRoot);
  const replay = await c.tool("lesson.end", input);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.deepEqual(replay.result, { ...api, replayed: true });
  assert.deepEqual(await inventory(f.systemRoot), beforeReplay);
  const start = await c.execute("lesson.start", { ...f.input, requestId: "start-second", expectedRevision: api.revision });
  assert.notEqual(start.active.attemptId, input.attemptId);
  const before = await inventory(f.systemRoot);
  const oldStart = await c.tool("lesson.start", f.input);
  assert.equal(oldStart.ok, true);
  assert.equal(oldStart.result.attempt.attemptId, input.attemptId);
  assert.equal(oldStart.result.attempt.ended.reason, "restart");
  assert.equal(oldStart.result.active.attemptId, start.active.attemptId);
  assert.equal(oldStart.result.completion, null);
  assert.equal(oldStart.result.previewReady, false);
  assert.equal(oldStart.result.replayed, true);
  const oldEnd = await c.execute("lesson.end", input);
  assert.equal(oldEnd.attempt.attemptId, input.attemptId);
  assert.equal(oldEnd.active.attemptId, start.active.attemptId);
  assert.equal(oldEnd.replayed, true);
  assert.doesNotMatch(JSON.stringify([api, oldStart.result, oldEnd]), excluded);
  assert.deepEqual(await inventory(f.systemRoot), before);
  assert.equal((await f.learners.readState({ actor: f.auth.user })).active.attemptId, start.active.attemptId);
  await assert.rejects(readFile(path.join(f.systemRoot, "projects")), { code: "ENOENT" });
});

test("end tool is unavailable without its host and rejects malformed, unauthorized or conflicting retirement before effects", async t => {
  const f = await fixture(t);
  const saved = await f.reserve();
  const input = { attemptId: saved.attempt.attemptId, requestId: "end-one", expectedRevision: saved.revision, reason: "discard" };
  const absent = f.register();
  const before = await inventory(f.systemRoot);
  const unavailable = await absent.tool("lesson.end", input);
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.result.ok, false);
  assert.equal(unavailable.result.available, false);
  assert.match(unavailable.result.error, /retirement is unavailable/u);
  assert.deepEqual(await inventory(f.systemRoot), before);
  const c = f.register(f.exercises);
  for (const change of [{ attemptId: "../attempt" }, { requestId: " " }, { expectedRevision: -1 }, { reason: "delete" }, { confirmation: true }]) {
    await assert.rejects(() => c.execute("lesson.end", { ...input, ...change }), { code: "ACTION_VALIDATION_FAILED" });
  }
  assert.equal(f.calls.length, 0);
  await assert.rejects(() => c.execute("lesson.end", { ...input, expectedRevision: 0 }), { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  assert.equal((await f.learners.readState({ actor: f.auth.user })).active.attemptId, input.attemptId);
  const actualBefore = await inventory(f.systemRoot);
  f.auth.user = { uid: 43, username: "other", role: "member" };
  assert.equal((await c.tool("lesson.end", input)).ok, false);
  assert.equal((await c.tool("learning.read")).result.history.length, 0);
  f.auth.user = null;
  const calls = f.calls.length;
  assert.equal((await c.tool("lesson.end", input)).ok, false);
  assert.equal(f.calls.length, calls);
  // A failed other-actor admission may create its explicit state lock, but never
  // changes the first actor's reservation or ends an exercise.
  assert.deepEqual((await inventory(f.systemRoot)).filter(value => value.path.startsWith("training/users/NDI/")),
    actualBefore.filter(value => value.path.startsWith("training/users/NDI/")));
  f.auth.user = { uid: 42, username: "member", role: "member" };
  const failed = f.register({ async endLesson() {
    throw Object.assign(new Error("Cannot write /PRIVATE_SOURCE"), { code: "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", statusCode: 409 });
  } });
  const result = await failed.tool("lesson.end", input);
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), excluded);
  await assert.rejects(() => failed.execute("lesson.end", input), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED" &&
    error.statusCode === 409 && /same request\/attempt/u.test(error.message));
  const falseResult = f.register({ async endLesson() { return { ok: false, error: "PRIVATE_SOURCE" }; } });
  assert.equal((await falseResult.tool("lesson.end", input)).ok, false);
  assert.equal((await f.learners.readState({ actor: f.auth.user })).active.attemptId, input.attemptId);
});

test("history and retained-pass tool projections preserve original provenance without leaking identities or executable sources", async t => {
  const f = await fixture(t);
  const c = f.register(f.exercises);
  const reserved = await f.reserve();
  const { attemptId } = reserved.attempt;
  const checkpoint = await f.learners.saveLessonResume({ actor: f.auth.user, attemptId, expectedRevision: reserved.revision, requestId: "question-one",
    resume: { stage: "question", pendingQuestion: { id: "question-one", assessmentId: "explain", text: "Where do you try the application?" }, visuals: [], summary: "Waiting for the learner." } });
  const recorded = await f.learners.recordAssessment({ actor: f.auth.user, attemptId, expectedRevision: checkpoint.revision,
    submissionId: "answer-one", assessmentId: "explain", outcome: "passed", assistance: "none", explanation: "The learner identifies Preview.",
    evidence: { kind: "answer", learnerId: "42", attemptId, messageId: "message-one", questionId: "question-one", text: "I try the application in Preview." } });
  const ended = await c.execute("lesson.end", { attemptId, requestId: "retire-one", expectedRevision: recorded.revision, reason: "discard" });
  const next = await c.execute("lesson.start", { ...f.input, requestId: "start-two", expectedRevision: ended.revision });
  const before = await inventory(f.systemRoot);
  const read = await c.execute("learning.read");
  const toolRead = await c.tool("learning.read");
  assert.deepEqual(toolRead.result, read);
  assert.equal(read.history.length, 1);
  assert.equal(read.history[0].attemptId, attemptId);
  assert.equal(read.history[0].learning.submissions[0].submissionId, "answer-one");
  assert.equal(read.history[0].learning.submissions[0].evidence.attemptId, attemptId);
  assert.equal(read.completion.passed, 1);
  assert.deepEqual(read.lessonProgress, [{ lessonCode: "USE-ONE", lessonHash: f.pin.lesson.hash, required: 1, passed: 1, completed: true, open: true }],
    "one per-lesson summary joins the ended pass and the open successor");
  assert.equal(read.active.learning.submissions.length, 0);
  assert.equal(read.active.attemptId, next.active.attemptId);
  assert.doesNotMatch(JSON.stringify(read), excluded);
  assert.deepEqual(await inventory(f.systemRoot), before);
  f.auth.user = { uid: 43, username: "other", role: "member" };
  assert.equal((await c.tool("learning.read")).result.history.length, 0);
});



test("retained continuation uses fresh member authority and bounded native input on API and tools", async t => {
  const f = await fixture(t);
  const saved = await f.reserve();
  const input = { attemptId: saved.attempt.attemptId, requestId: "continue-one", expectedRevision: saved.revision };
  const calls = [];
  const c = f.register({ async continueLesson(value) {
    calls.push(value);
    return { ...saved, sourceRoot: "/PRIVATE_SOURCE", setup: { status: "pending", command: "PRIVATE_SHELL" }, previewReady: true };
  } });
  const before = await inventory(f.systemRoot);
  const api = await c.execute("lesson.continue", input);
  const tool = await c.tool("lesson.continue", input);
  assert.equal(tool.ok, true, JSON.stringify(tool));
  assert.deepEqual(tool.result, api);
  assert.equal(api.active.attemptId, saved.attempt.attemptId);
  assert.equal(api.previewReady, false);
  assert.equal(api.setupStatus, "pending");
  assert.doesNotMatch(JSON.stringify(api), excluded);
  assert.deepEqual(calls, [{ actor: f.auth.user, ...input }, { actor: f.auth.user, ...input }]);
  for (const change of [{ requestId: "x".repeat(19) }, { requestId: "bad/path" }, { requestId: "" },
    { attemptId: "../attempt" }, { expectedRevision: -1 }, { pin: f.pin }, { actor: f.auth.user }, { path: "/PRIVATE_SOURCE" }]) {
    await assert.rejects(c.execute("lesson.continue", { ...input, ...change }), { code: "ACTION_VALIDATION_FAILED" });
  }
  f.auth.user = { uid: 43, username: "another-member", role: "member" };
  await c.tool("lesson.continue", input);
  assert.deepEqual(calls.at(-1), { actor: f.auth.user, ...input });
  f.auth.user = null;
  assert.equal((await c.tool("lesson.continue", input)).ok, false);
  assert.equal(calls.length, 3);
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("continuation unavailability and native save failure retain state without leaking source", async t => {
  const f = await fixture(t);
  const saved = await f.reserve();
  const input = { attemptId: saved.attempt.attemptId, requestId: "continue-one", expectedRevision: saved.revision };
  const before = await inventory(f.systemRoot);
  const unavailable = await f.register().tool("lesson.continue", input);
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.result.available, false);
  assert.equal(unavailable.result.ok, false);
  assert.match(unavailable.result.error, /original progress/u);
  const c = f.register({ async continueLesson() {
    throw Object.assign(new Error("Cannot rename /PRIVATE_SOURCE/progress.json"), { code: "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", statusCode: 409 });
  } });
  const failure = await c.tool("lesson.continue", input);
  assert.equal(failure.ok, false);
  assert.doesNotMatch(JSON.stringify(failure), excluded);
  await assert.rejects(c.execute("lesson.continue", input), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED" && error.statusCode === 409);
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("ended continuation replay projects its own history and actual successor without claiming preparation", async t => {
  const f = await fixture(t);
  const saved = await f.reserve();
  const ended = await f.learners.endAttempt({ actor: f.auth.user, attemptId: saved.attempt.attemptId,
    requestId: "end-one", expectedRevision: saved.revision, reason: "discard" });
  const successor = await f.learners.reserveAttempt({ actor: f.auth.user, requestId: "start-two", expectedRevision: ended.revision, pin: f.pin });
  const c = f.register({ async continueLesson() { return { ...ended, active: successor.attempt, replayed: true, previewReady: true }; } });
  const result = await c.tool("lesson.continue", { attemptId: saved.attempt.attemptId, requestId: "continue-one", expectedRevision: saved.revision });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.attempt.attemptId, ended.attempt.attemptId);
  assert.equal(result.result.active.attemptId, successor.attempt.attemptId);
  assert.equal(result.result.replayed, true);
  assert.equal(result.result.previewReady, false);
  assert.equal(result.result.completion, null);
  assert.doesNotMatch(JSON.stringify(result), excluded);
});


import { createTrainingAuthorPreviewActions } from "../../packages/vibe64-training/src/server/actions.js";

test("author preview API/tools retain bounded original projections and fresh owner/source authority", async t => {
  const f = await fixture(t);
  f.auth.user.role = "owner";
  const calls = [];
  let projectAllowed = true;
  const preview = {
    async readState(input) { calls.push({ kind: "read", input }); return f.learners.readState({ ...input, includeCompletion: true }); },
    async startLesson(input) {
      calls.push({ kind: "start", input });
      return { ...await f.learners.reserveAttempt({ actor: input.actor, requestId: input.requestId,
        expectedRevision: input.expectedRevision, pin: f.pin }), sourceRoot: "/PRIVATE_SOURCE", previewReady: true,
        setup: { status: "pending", command: "PRIVATE_SHELL" } };
    }
  };
  const actions = createActionCatalogue();
  const definitions = createTrainingAuthorPreviewActions({ preview });
  actions.register({ contributorId: "preview", domain: "training", actions: definitions.map(value => ({ ...value,
    channels: ["api", "automation"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => f.auth.user,
    projectContext: { projectsRoot: "/test/projects", async readWorkspaceProject({ slug }) {
      return { project: { slug, path: `/test/projects/${slug}` } };
    } },
    authorizeProject({ slug }) {
      assert.equal(slug, "author-source");
      if (!projectAllowed) throw Object.assign(new Error("Source access revoked"), { statusCode: 403 });
    } });
  const execute = (name, input = {}, extra = {}) => actions.execute({ actionId: `vibe64.training.author-preview.${name}`,
    input, context: { channel: "api", surface: "app", ...extra } });
  const input = { projectSlug: "author-source", sessionId: "requested-author", lessonCode: "USE-ONE",
    expectedCommit: f.pin.topic.commit, requestId: "preview-one", expectedRevision: 0 };
  const initial = await execute("read");
  assert.equal(initial.active, null);
  assert.equal(initial.authorPreview, true);
  const started = await execute("start", input);
  assert.equal(started.active.pin.lesson.code, "USE-ONE");
  assert.equal(started.previewReady, false);
  assert.equal(started.authorPreview, true);
  assert.doesNotMatch(JSON.stringify(started), excluded);
  assert.deepEqual(calls.at(-1).input, { actor: f.auth.user, ...input });
  const tools = createServiceToolCatalog(actions, { maxDirectTools: 100 });
  const context = { channel: "automation", surface: "app" };
  const toolSet = tools.resolveToolSet(context);
  const tool = toolSet.tools.find(value => value.actionId === "vibe64.training.author-preview.start");
  assert.ok(tool);
  assert.doesNotThrow(() => tools.toOpenAiToolSchema(tool));
  const replay = await tools.executeToolCall({ toolName: tool.name, toolSet, context, argumentsText: JSON.stringify(input) });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.result.active.attemptId, started.active.attemptId);
  assert.equal(replay.result.replayed, undefined, "original prepared projection does not invent reservation readiness");
  assert.doesNotMatch(JSON.stringify(replay), excluded);
  const before = calls.length;
  await assert.rejects(execute("start", input, { requestMeta: { request: { params: { slug: "different-source" } } } }),
    { code: "vibe64_action_project_mismatch" });
  await assert.rejects(execute("start", { ...input, vibe64User: { uid: 999, role: "owner" } }));
  await assert.rejects(execute("start", { ...input, sourceRoot: "/forged/source" }));
  await assert.rejects(execute("start", { ...input, requestId: "request-id-is-too-long" }));
  projectAllowed = false;
  await assert.rejects(execute("start", input), { statusCode: 403 });
  assert.equal(calls.length, before);
  f.auth.user.role = "member";
  await assert.rejects(execute("read"), { code: "vibe64_owner_required" });
  await assert.rejects(execute("start", input), { code: "vibe64_owner_required" });
  f.auth.user = null;
  await assert.rejects(execute("read"), { statusCode: 401 });
  assert.equal(calls.length, before, "revocation cannot reach the preview owner");
});


// These appended cases compose the real original installed/learning/preparation
// owners. They do not launch a native teacher, provision an exercise or prove UI.
test("standalone Training Feature uses actual OS-owner authority only for trusted learning transports", async t => {
  const f = await fixture(t);
  const [{ Vibe64TrainingProvider }, { configureStudioProjectContext }, { currentOsUser },
    { withVibe64ActionContext }, { createSchema }, { default: Fastify }] = await Promise.all([
    import("../../packages/vibe64-training/src/server/Vibe64TrainingProvider.js"),
    import("@local/vibe64-core/server/studioProjectContext"), import("@local/vibe64-core/server/osUserIdentity"),
    import("@local/vibe64-core/server/actionContext"), import("@jskit-ai/kernel/shared/validators"), import("fastify")
  ]);
  configureStudioProjectContext({ explicitSystemRoot: f.systemRoot, explicitTargetRoot: f.root });
  t.after(() => configureStudioProjectContext());
  const actions = createActionCatalogue();
  const server = Fastify();
  t.after(() => server.close());
  server.decorateRequest("executeAction", function ({ actionId, input }) {
    return actions.execute({ actionId, input, context: { channel: "api", surface: this.routeOptions.config.surface,
      requestMeta: { request: this } } });
  });
  const registered = [];
  const http = { router: { register(method, url, options, handler) {
    registered.push({ method, url });
    server.route({ method, url, config: { surface: options.surface }, handler });
  } } };
  const unexpected = () => assert.fail("no-exercise preparation must not invoke source, setup or native session effects");
  const { training } = await Vibe64TrainingProvider.setup({ actionCatalogue: actions, http,
    project: { createRuntime: unexpected, runInProjectContext: unexpected },
    sessions: { createSession: unexpected, inspectSession: unexpected }, terminals: { outputTargetStatus: unexpected, closeProjectRuntime: unexpected }, trainingHost: null });
  // Learning v2 publishes learner-scoped realtime notices through the optional runtime events.
  assert.deepEqual(Vibe64TrainingProvider.optional, { trainingHost: "vibe64.training.host", sourceEditor: "vibe64.source-editor", events: "runtime.events" });
  assert.equal(typeof training.checks.runOrientationCheck, "function");
  assert.equal(typeof training.checks.runCodeCheck, "function");
  assert.deepEqual(Object.keys(training).filter(key => key !== "checks").sort(), ["catalogue", "codeAuthorship", "content", "courseInstaller", "exercises", "learners",
    "practiceProjects", "publishLearnerChanged", "steps"]);
  // Learning v2 (C5): the standalone practice facility offers delete and its read-only preflight.
  assert.deepEqual(Object.keys(training.practiceProjects).sort(), ["canRemove", "remove"]);
  // Learning v2 phase 2 retired the source-less Main teacher and its lesson-scoped routes.
  assert.equal(registered.some(route => route.url.startsWith("/api/learning/")), false);
  assert.equal(new Set(registered.map(route => `${route.method} ${route.url}`)).size, registered.length);
  const observed = [];
  actions.register({ contributorId: "original-local-scopes", domain: "test", actions: ["vibe64.working.fixture", "vibe64.colleague.fixture"].map(id =>
    withVibe64ActionContext({ id, kind: "query", channels: ["api"], surfaces: ["app"],
      input: { mode: "create", schema: createSchema({}) }, execute(input, context) {
        observed.push({ input, context }); return { ok: true };
      } }, { projectScoped: false })) });
  const courses = await server.inject({ method: "GET", url: "/api/vibe64/training/courses" });
  assert.equal(courses.statusCode, 200, courses.body);
  assert.equal(courses.json().courses[0].lessons[0].code, f.input.lessonCode);
  const initial = await server.inject({ method: "GET", url: "/api/vibe64/training/learning" });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().revision, 0);
  const started = await server.inject({ method: "POST", url: "/api/vibe64/training/lessons/start", payload: {
    ...f.input, actor: { uid: 999, username: "forged" }, vibe64User: { uid: 999, role: "owner" }
  } });
  assert.equal(started.statusCode, 200, started.body);
  const id = started.json().active.attemptId;
  const osActor = currentOsUser();
  const state = await training.learners.readState({ actor: osActor });
  assert.equal(state.progress.learnerId, String(osActor.uid));
  assert.equal(state.active.attemptId, id);
  assert.equal(state.active.preparation.phase, "reserved");
  assert.equal((await training.learners.readState({ actor: { uid: 999, username: "forged" } })).progress.attempts.length, 0);
  const resumed = await server.inject({ method: "POST", url: `/api/vibe64/training/attempts/${id}/resume`, payload: {
    attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  } });
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal(resumed.json().active.attemptId, id, "the saved path attempt wins over a conflicting body");
  const ended = await server.inject({ method: "POST", url: `/api/vibe64/training/attempts/${id}/end`, payload: {
    requestId: "local-end", expectedRevision: state.revision, reason: "restart"
  } });
  assert.equal(ended.statusCode, 200, ended.body);
  assert.ok(ended.json().attempt.ended);
  const continued = await server.inject({ method: "POST", url: `/api/vibe64/training/attempts/${id}/continue`, payload: {
    requestId: "local-next", expectedRevision: ended.json().revision
  } });
  assert.equal(continued.statusCode, 200, continued.body);
  assert.notEqual(continued.json().active.attemptId, id);
  const inheritedRemoteRequest = Object.create({
    get ip() { return "198.51.100.7"; }, get headers() { return { host: "untrusted.example" }; },
    vibe64User: { uid: osActor.uid, username: osActor.username, role: "owner" }
  });
  for (const request of [undefined, inheritedRemoteRequest, { ip: "198.51.100.7", headers: { host: "untrusted.example" },
    vibe64User: { uid: osActor.uid, username: osActor.username, role: "owner" } }]) {
    await assert.rejects(actions.execute({ actionId: "vibe64.training.learning.read", input: {},
      context: { channel: "internal", surface: "app", requestMeta: { request } } }), { code: "vibe64_auth_required" });
  }
  for (const actionId of ["vibe64.working.fixture", "vibe64.colleague.fixture"]) {
    await actions.execute({ actionId, input: {}, context: { channel: "api", surface: "app",
      requestMeta: { request: { ip: "127.0.0.1", headers: { host: "localhost" } } } } });
  }
  assert.equal(observed.length, 2);
  for (const result of observed) {
    assert.equal(result.input.vibe64User, undefined);
    assert.equal(result.context.vibe64Action, undefined, "Working/Colleague do not acquire OS-owner authority");
  }
});

test("hosted Training Feature retains exact supplied owners and registers no second actions, authority or lesson routes", async t => {
  const f = await fixture(t);
  const { Vibe64TrainingProvider } = await import("../../packages/vibe64-training/src/server/Vibe64TrainingProvider.js");
  const registered = [];
  const trainingHost = Object.freeze({ catalogue: f.catalogue, content: f.content, learners: f.learners,
    exercises: f.exercises });
  const outputs = await Vibe64TrainingProvider.setup({ actionCatalogue: {
    register() { assert.fail("the hosted original action catalogue must not be registered twice"); },
    registerContextContributor() { assert.fail("the hosted original authority must not be registered twice"); }
  }, http: { router: { register(method, url, options, handler) { registered.push({ method, url, options, handler }); } } },
    project: {}, sessions: {}, terminals: {}, trainingHost });
  assert.equal(outputs.training, trainingHost);
  // Learning v2 phase 2 retired the Main teacher's presentation, practical,
  // brief, visual checkpoint and lesson-scoped visual routes.
  const originalRoutes = registered;
  // Learning v2 adds the lesson reader, step, reader-position and practice routes,
  // and the learner's own teacher notes (contract C7).
  assert.equal(originalRoutes.length, 21);
  assert.equal(registered.every(route => route.options.surface === "app"), true);
  assert.equal(registered.some(route => route.url.startsWith("/api/learning/")), false);
  assert.equal(new Set(registered.map(route => `${route.method} ${route.url}`)).size, registered.length);
  assert.deepEqual(originalRoutes.map(route => [route.method, route.url]), [
    ["GET", "/api/vibe64/training/courses"], ["POST", "/api/vibe64/training/courses"],
    ["GET", "/api/vibe64/training/available"], ["POST", "/api/vibe64/training/courses/install"], ["GET", "/api/vibe64/training/learning"],
    ["POST", "/api/vibe64/training/lessons/start"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/resume"], ["POST", "/api/vibe64/training/attempts/:attemptId/end"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/continue"],
    ["GET", "/api/vibe64/training/lesson"], ["GET", "/api/vibe64/training/attempts/:attemptId/lesson"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/steps/observe"], ["POST", "/api/vibe64/training/attempts/:attemptId/steps/check"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/steps/answer"], ["POST", "/api/vibe64/training/attempts/:attemptId/steps/done"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/reader"], ["POST", "/api/vibe64/training/attempts/:attemptId/practice/delete"],
    ["GET", "/api/vibe64/training/teacher-notes"], ["POST", "/api/vibe64/training/teacher-notes"],
    ["POST", "/api/vibe64/training/teacher-notes/clear"],
    ["GET", "/api/vibe64/training/attempts/:attemptId/visuals/:visualId"]
  ]);
});


// Approved role change: actual original contracts refuse supervisor authority
// before saved-question, grading Helper or navigation effects. These refusals
// do not substitute for actual Main practical/native acceptance.

// Preserve actual Main facility error rather than falling through to a legacy
// constructor or dereferencing an undefined grading coordinator.



// Optional HTTP read uses the original owner action, not a new snapshot service.
test("saved author-trial HTTP read retains fresh owner/actor isolation and performs no source or start effects", async t => {
  const f = await fixture(t);
  const [{ registerTrainingAuthorPreviewRoutes }, { default: Fastify }] = await Promise.all([
    import("../../packages/vibe64-training/src/server/registerRoutes.js"), import("fastify")
  ]);
  const actions = createActionCatalogue(); const server = Fastify(); t.after(() => server.close());
  let user = { ...f.auth.user, role: "owner" }; const seen = [];
  actions.register({ contributorId: "saved-author-preview", domain: "training", actions: createTrainingAuthorPreviewActions({ preview: {
    async readState({ actor }) { seen.push(actor); return f.learners.readState({ actor, includeCompletion: true }); },
    startLesson() { assert.fail("read must not capture source, reserve or prepare"); }
  } }).map(value => ({ ...value, channels: ["api"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { resolveUser: () => user, authorizeProject() { assert.fail("saved read needs no project/source"); } });
  server.decorateRequest("executeAction", function ({ actionId, input }) {
    return actions.execute({ actionId, input, context: { channel: "api", surface: this.routeOptions.config.surface, requestMeta: { request: this } } });
  });
  const registered = [];
  registerTrainingAuthorPreviewRoutes({ router: { register(method, url, options, handler) {
    registered.push([method, url]); server.route({ method, url, config: { surface: options.surface }, handler });
  } } });
  assert.deepEqual(registered, [["GET", "/api/vibe64/training/author-preview"]]);
  const ownerState = await f.learners.reserveAttempt({ actor: user, requestId: "saved-trial", expectedRevision: 0, pin: f.pin });
  const ownerRead = await server.inject({ method: "GET", url: "/api/vibe64/training/author-preview?sourceRoot=/forged&actor=forged" });
  assert.equal(ownerRead.statusCode, 200); assert.equal(ownerRead.json().active.attemptId, ownerState.attempt.attemptId);
  assert.equal(ownerRead.json().authorPreview, true); assert.doesNotMatch(ownerRead.body, excluded);
  const foreign = { uid: 999, username: "other-owner", role: "owner" }; user = foreign;
  const ownEmpty = await server.inject({ method: "GET", url: "/api/vibe64/training/author-preview" });
  assert.equal(ownEmpty.statusCode, 200); assert.equal(ownEmpty.json().active, null);
  assert.equal(seen.at(-1).uid, foreign.uid, "a different owner reads only their own saved state");
  const before = seen.length; user = { ...foreign, role: "member" };
  assert.equal((await server.inject({ method: "GET", url: "/api/vibe64/training/author-preview" })).statusCode, 403);
  user = null;
  assert.equal((await server.inject({ method: "GET", url: "/api/vibe64/training/author-preview" })).statusCode, 401);
  assert.equal(seen.length, before, "member/sign-out refuses before original preview read");
});



test("owner custom course pins installed released topics through the original catalogue owner", async t => {
  const f = await fixture(t, { released: true });
  const c = f.register();
  const listed = await c.execute("courses.list");
  assert.equal(listed.canCreateCourses, false);
  assert.equal(listed.canTryPreviews, false);
  assert.deepEqual(listed.courses[0].topics, [{ topicId: "action-fixture", release: "0.1.0", title: "Action fixture" }]);
  const input = { title: " My path ", topics: [{ topicId: "action-fixture", release: "0.1.0" }], expectedRevision: listed.revision };
  const before = await inventory(f.systemRoot);
  await assert.rejects(c.execute("courses.create", input), { code: "vibe64_owner_required" });
  assert.deepEqual(await inventory(f.systemRoot), before, "a member cannot change the catalogue");
  f.auth.user = { ...f.auth.user, role: "owner" };
  assert.equal((await c.execute("courses.list")).canCreateCourses, true);
  assert.equal((await c.execute("courses.list")).canTryPreviews, true);
  const created = await c.execute("courses.create", input);
  assert.deepEqual(created.course, { courseId: "custom-my-path", release: "1.0.0", title: "My path", status: "released", enabled: true });
  const catalogue = await f.catalogue.readCatalogue();
  const [original, custom] = catalogue.courses;
  assert.equal(custom.enabled, true);
  assert.deepEqual(custom.lock.topics, original.lock.topics, "the custom course reuses the exact installed topic pins");
  const courses = (await c.execute("courses.list")).courses;
  assert.deepEqual(courses[1].lessons, courses[0].lessons, "lesson identities are shared, so saved progress counts in both");
  for (const extra of [{ vibe64User: { role: "owner" } }, { courseId: "introduction" }, { path: "/tmp/source" }]) {
    await assert.rejects(() => c.execute("courses.create", { ...input, ...extra }), { code: "ACTION_VALIDATION_FAILED" });
  }
  const replay = await c.execute("courses.create", { ...input, expectedRevision: created.revision });
  assert.equal(replay.revision, created.revision, "an identical retry changes nothing");
  await assert.rejects(c.execute("courses.create", { ...input, title: "My path!", expectedRevision: created.revision }), { code: "VIBE64_TRAINING_COURSE_EXISTS" });
  await assert.rejects(c.execute("courses.create", { ...input, title: "Twice", topics: [...input.topics, ...input.topics], expectedRevision: created.revision }),
    { code: "VIBE64_TRAINING_COURSE_INVALID" });
  await assert.rejects(c.execute("courses.create", { ...input, title: "Missing", topics: [{ topicId: "missing", release: "0.1.0" }], expectedRevision: created.revision }),
    { code: "VIBE64_TRAINING_COURSE_TOPIC_UNAVAILABLE" });
  await assert.rejects(c.execute("courses.create", { ...input, title: "Stale", expectedRevision: 0 }), { code: "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT" });
  await f.catalogue.disableCourse({ courseId: "introduction", release: "0.1.0", expectedRevision: created.revision });
  await f.catalogue.disableCourse({ courseId: "custom-my-path", release: "1.0.0", expectedRevision: created.revision + 1 });
  await assert.rejects(c.execute("courses.create", { ...input, title: "Disabled source", expectedRevision: created.revision + 2 }),
    { code: "VIBE64_TRAINING_COURSE_TOPIC_UNAVAILABLE" }, "custom courses use only topics from enabled released courses");
  assert.equal((await f.catalogue.readCatalogue()).courses.length, 2);
});
