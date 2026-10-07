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
import { createTrainingPresentationActions } from "../../packages/vibe64-training/src/server/presentationActions.js";
import { createTrainingTeachingActions } from "../../packages/vibe64-training/src/server/teachingActions.js";
import { createTrainingAssessmentActions } from "../../packages/vibe64-training/src/server/assessmentActions.js";
import { createTrainingTeachingOwner } from "../../packages/vibe64-training/src/server/teaching.js";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createCourseLock } from "../../packages/vibe64-training/src/server/catalogue.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createInstalledTrainingCatalogue } from "../../packages/vibe64-training/src/server/installedCatalogue.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingTeachingBrief } from "../../packages/vibe64-training/src/server/teachingBrief.js";

async function fixture(t, { presentation = false } = {}) {
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
    vibe64Training: { schemaVersion: 1, topicId: "action-fixture", domainId: "vibe64", title: "Action fixture", status: "preview", outline: "training/outline.md", prerequisites: [],
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
  const course = { schemaVersion: 1, courseId: "introduction", title: "One introduction", release: "0.1.0", status: "preview", topics: [{ topicId: topic.topicId, release: topic.release }] };
  const lock = createCourseLock(course, [{ topicId: topic.topicId, release: topic.release, repository: topic.repository, commit,
    topicManifest: installed.topicManifest, topicHash: installed.topicHash }]);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot });
  await catalogue.enableCourse({ course, lock, expectedRevision: 0 });
  const learners = createTrainingLearnerState({ systemRoot });
  const teachingBrief = createTrainingTeachingBrief({ systemRoot });
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
  function register(host = null, replacements = {}, colleague = null) {
    const actions = createActionCatalogue();
    const definitions = [...createTrainingActions({ catalogue, learners, teachingBrief, exercises: host, ...replacements }),
      ...(colleague ? createTrainingTeachingActions({ colleague }) : []),
      ...(colleague?.evaluateTrainingAnswer ? createTrainingAssessmentActions({ colleague }) : [])];
    actions.register({ contributorId: "training", domain: "training", actions: definitions.map(definition => ({ ...definition, channels: ["api", "automation"], surfaces: ["app"] })) });
    registerVibe64ActionContext(actions, { resolveUser: async () => auth.user,
      authorizeProject() { throw new Error("Learning actions must not require a selected project."); } });
    if (colleague) actions.registerContextContributor({ id: "training.teaching-owner", contribute() {
      return { trainingTeaching: createTrainingTeachingOwner({ learners, content }) };
    } });
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
  return { root, systemRoot, snapshot, auth, catalogue, content, learners, teachingBrief, pin, reserve, input, calls, exercises, register };
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

test("answer evaluation shares the native API/tool contract and projects only the saved result", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { attemptId: reserved.attempt.attemptId, expectedRevision: 4, submissionId: "answer-one", messageId: "canonical-answer-one" };
  const calls = [];
  const colleague = { requireTrainingQuestionTurn() {}, stageTrainingQuestion() {},
    evaluateTrainingPractical() { assert.fail("An answer action cannot invoke practical grading."); },
    async evaluateTrainingAnswer(value, context) {
      calls.push({ value, actor: context.vibe64Action.user });
      return { revision: 5, replayed: calls.length > 1,
        attempt: { learning: { submissions: [{ submissionId: "answer-one", assessmentId: "explain", outcome: "passed",
          explanation: "You identified the place to try the app.", evidence: { text: "PRIVATE_SOURCE", learnerId: "42" }, rubric: "lesson.md#explain" }] } },
        completion: { lessonCode: "USE-ONE", lessonHash: f.pin.lesson.hash, required: 1, passed: 1, completed: true } };
    } };
  const c = f.register(null, {}, colleague);
  const definition = c.definitions.find(value => value.id === "vibe64.training.answer.evaluate");
  assert.equal(definition.idempotency, "domain_native");
  assert.equal(definition.extensions.vibe64.projectScoped, false);
  const api = await c.execute("answer.evaluate", input);
  assert.equal(api.outcome, "passed");
  assert.equal(api.revision, 5);
  assert.equal(api.completion.completed, true);
  assert.doesNotMatch(JSON.stringify(api), excluded);
  assert.deepEqual(calls[0], { value: input, actor: f.auth.user });
  const tool = await c.tool("answer.evaluate", input);
  assert.equal(tool.ok, true, JSON.stringify(tool));
  assert.deepEqual(tool.result, { ...api, replayed: true });
  assert.deepEqual(calls[1], { value: input, actor: f.auth.user });
});

test("answer evaluation admits no caller words, question or outcome and preserves native recovery errors", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { attemptId: reserved.attempt.attemptId, expectedRevision: 4, submissionId: "answer-one", messageId: "canonical-answer-one" };
  let calls = 0;
  const c = f.register(null, {}, { requireTrainingQuestionTurn() {}, stageTrainingQuestion() {},
    evaluateTrainingPractical() { assert.fail("An answer action cannot invoke practical grading."); },
    async evaluateTrainingAnswer() {
      calls++;
      throw Object.assign(new Error("Cannot confirm save at /PRIVATE_SOURCE/progress.json"), {
        code: "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", statusCode: 409 });
    } });
  for (const extra of [{ text: "My invented answer" }, { question: {} }, { outcome: "passed" }, { assistance: "none" }, { actor: { uid: 1 } }]) {
    await assert.rejects(c.execute("answer.evaluate", { ...input, ...extra }), { code: "ACTION_VALIDATION_FAILED" });
  }
  f.auth.user = null;
  await assert.rejects(c.execute("answer.evaluate", input), { code: "vibe64_auth_required" });
  assert.equal(calls, 0);
  f.auth.user = { uid: 42, username: "member", role: "member" };
  await assert.rejects(c.execute("answer.evaluate", input), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED" && error.cause.message.includes("PRIVATE_SOURCE"));
  const tool = await c.tool("answer.evaluate", input);
  assert.equal(tool.ok, false);
  assert.doesNotMatch(JSON.stringify(tool), excluded);
  assert.equal(calls, 2);
});

async function questionFixture(t) {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  await f.learners.beginPreparation({ actor: f.auth.user, attemptId, expectedRevision: 1 });
  await f.learners.recordPreparationReady({ actor: f.auth.user, attemptId,
    initialSessionId: `training-${attemptId}`, expectedRevision: 2 });
  const calls = [];
  let preflightFailure = null, stageFailure = null;
  // The native current-turn/transaction guards remain the original Colleague
  // suite's evidence. This transport seam proves action ordering and real
  // checkpoint/capture effects without inventing another conversation runtime.
  const colleague = {
    async requireTrainingQuestionTurn(context) {
      calls.push({ operation: "preflight", actor: context.vibe64Action.user });
      if (preflightFailure) throw preflightFailure;
      return { conversationId: "original-scope", turnId: "accepted-turn", generation: 1 };
    },
    async stageTrainingQuestion(reference, context) {
      calls.push({ operation: "stage", reference, actor: context.vibe64Action.user });
      if (stageFailure) throw stageFailure;
      const captured = await context.trainingTeaching.captureQuestion({ actor: context.vibe64Action.user, reference });
      assert.equal(captured.question.id, reference.questionId);
      return { schemaVersion: 1, reference, conversationId: "original-scope", turnId: "accepted-turn", phase: "prepared" };
    }
  };
  const c = f.register(null, {}, colleague);
  return { ...f, c, questionCalls: calls,
    questionInput: { attemptId, expectedRevision: 3, requestId: "question-one", assessmentId: "explain",
      text: "What did you try in Preview?", assistance: "hint" },
    setPreflightFailure(error) { preflightFailure = error; }, setStageFailure(error) { stageFailure = error; } };
}

test("question preparation shares native API/tool schema and only returns prepared after checkpoint then staging", async t => {
  const f = await questionFixture(t);
  const definition = f.c.definitions.find(value => value.id === "vibe64.training.question.prepare");
  assert.equal(definition.idempotency, "domain_native");
  assert.equal(definition.extensions.vibe64.projectScoped, false);
  const api = await f.c.execute("question.prepare", f.questionInput);
  assert.equal(api.delivery, "prepared");
  assert.equal(api.questionText, f.questionInput.text);
  assert.equal(api.assessmentId, "explain");
  assert.equal(api.revision, 4);
  assert.equal(api.replayed, false);
  assert.deepEqual(f.questionCalls.map(value => value.operation), ["preflight", "stage"]);
  assert.deepEqual(api.reference, f.questionCalls.at(-1).reference);
  assert.equal(f.questionCalls.at(-1).actor, f.auth.user);
  assert.doesNotMatch(JSON.stringify(api), excluded);
  assert.equal(Object.hasOwn(api, "outcome"), false);
  const before = await inventory(f.systemRoot);
  const tool = await f.c.tool("question.prepare", f.questionInput);
  assert.equal(tool.ok, true, JSON.stringify(tool));
  assert.deepEqual(tool.result, { ...api, replayed: true });
  assert.deepEqual(await inventory(f.systemRoot), before);
  assert.deepEqual((await f.learners.readState({ actor: f.auth.user })).active.learning.submissions, []);
});

test("question action rejects invalid fields, stale actor and native turn/cue ineligibility before checkpoint effects", async t => {
  const f = await questionFixture(t);
  const before = await inventory(f.systemRoot);
  for (const change of [{ attemptId: "../attempt" }, { requestId: " " }, { expectedRevision: -1 }, { assistance: "inferred" },
    { text: "x".repeat(2049) }, { reference: {} }, { outcome: "passed" }, { vibe64User: { uid: 42 } }]) {
    await assert.rejects(f.c.execute("question.prepare", { ...f.questionInput, ...change }), { code: "ACTION_VALIDATION_FAILED" });
  }
  assert.equal(f.questionCalls.length, 0);
  f.setPreflightFailure(Object.assign(new Error("Finish the current explanation cue."), { code: "ACTION_VALIDATION_FAILED", statusCode: 400 }));
  await assert.rejects(f.c.execute("question.prepare", f.questionInput), { code: "ACTION_VALIDATION_FAILED" });
  assert.deepEqual(f.questionCalls.map(value => value.operation), ["preflight"]);
  assert.deepEqual(await inventory(f.systemRoot), before);
  f.setPreflightFailure(null);
  f.auth.user = { uid: 43, username: "other", role: "member" };
  await assert.rejects(f.c.execute("question.prepare", f.questionInput), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  assert.equal(f.questionCalls.at(-1).actor, f.auth.user);
  assert.equal(f.questionCalls.some(value => value.operation === "stage"), false);
  f.auth.user = null;
  const calls = f.questionCalls.length;
  assert.equal((await f.c.tool("question.prepare", f.questionInput)).ok, false);
  assert.equal(f.questionCalls.length, calls);
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("saved question with failed native staging remains undelivered and same preparation retry stages without rewriting it", async t => {
  const f = await questionFixture(t);
  f.setStageFailure(Object.assign(new Error("Current native turn retired."), { code: "ACTION_VALIDATION_FAILED", statusCode: 400 }));
  await assert.rejects(f.c.execute("question.prepare", f.questionInput), error =>
    error.code === "ACTION_VALIDATION_FAILED" && error.questionPrepared === true && error.revision === 4 && /not confirmed delivered/.test(error.message));
  const saved = await f.learners.readState({ actor: f.auth.user });
  assert.equal(saved.active.learning.resume.pendingQuestion.text, f.questionInput.text);
  assert.deepEqual(saved.active.learning.submissions, []);
  const before = await inventory(f.systemRoot);
  f.setStageFailure(null);
  const retried = await f.c.execute("question.prepare", f.questionInput);
  assert.equal(retried.revision, 4);
  assert.equal(retried.replayed, true);
  assert.equal(retried.delivery, "prepared");
  assert.deepEqual(await inventory(f.systemRoot), before);
  const changed = { ...f.questionInput, text: "Another question" };
  const stages = f.questionCalls.filter(value => value.operation === "stage").length;
  await assert.rejects(f.c.execute("question.prepare", changed), { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  assert.equal(f.questionCalls.filter(value => value.operation === "stage").length, stages);
});

test("unconfirmed checkpoint and unavailable teaching preserve native causes and never stage or claim question delivery", async t => {
  const f = await questionFixture(t);
  const save = f.learners.saveLessonResume;
  const before = await inventory(f.systemRoot);
  f.learners.saveLessonResume = async () => { throw Object.assign(new Error("Atomic checkpoint save uncertain /PRIVATE_SOURCE"), {
    code: "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED" }); };
  try {
    const tool = await f.c.tool("question.prepare", f.questionInput);
    assert.equal(tool.ok, false);
    assert.doesNotMatch(JSON.stringify(tool), excluded);
    assert.equal(f.questionCalls.some(value => value.operation === "stage"), false);
    await assert.rejects(f.c.execute("question.prepare", f.questionInput), error =>
      error.code === "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED" && /retry the same/.test(error.message));
    assert.deepEqual(await inventory(f.systemRoot), before);
  } finally { f.learners.saveLessonResume = save; }
  const action = createTrainingTeachingActions({ colleague: {
    requireTrainingQuestionTurn() { throw new Error("Unavailable teaching must not reach native preflight."); },
    stageTrainingQuestion() { throw new Error("Unavailable teaching must not stage."); }
  } })[0];
  await assert.rejects(action.execute(f.questionInput, { requestMeta: { request: { vibe64User: f.auth.user } } }),
    { code: "VIBE64_TRAINING_TEACHING_UNAVAILABLE" });
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("training queries share API/tool catalogue contracts and fresh member authority without project or writes", async t => {
  const f = await fixture(t);
  const c = f.register();
  assert.deepEqual(c.toolSet.tools.map(value => value.actionId).sort(), ["courses.list", "learning.read", "teaching-brief.read", "lesson.start", "lesson.resume", "lesson.end", "lesson.continue"].map(value => `vibe64.training.${value}`).sort());
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
  const api = await c.execute("teaching-brief.read", input);
  const tool = await c.tool("teaching-brief.read", input);
  assert.equal(tool.ok, true, JSON.stringify(tool));
  assert.deepEqual(tool.result, api);
  assert.match(api.brief.lesson.teachingText, /your own words/u);
  assert.equal(api.brief.lesson.exerciseRequired, false);
  assert.equal(tool.result.brief.lesson.exerciseRequired, false);
  assert.match(api.brief.lesson.assessments[0].rubric.text, /your own words/u);
  assert.equal(api.brief.learning.completion.required, 1);
  assert.equal(api.brief.learning.completion.completed, false);
  assert.equal(api.brief.activeSummaryCurrent, false);
  assert.doesNotMatch(JSON.stringify(api), excluded);
  assert.deepEqual(await inventory(f.systemRoot), before);
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
  const inputs = { "courses.list": {}, "learning.read": {}, "teaching-brief.read": { attemptId: reserved.attempt.attemptId },
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
  assert.equal((await c.tool("teaching-brief.read", inputs["teaching-brief.read"])).ok, false);
  f.auth.user = null;
  for (const [name, input] of Object.entries(inputs)) assert.equal((await c.tool(name, input)).ok, false);
  assert.equal(f.calls.length, 0);
  for (const definition of c.definitions) {
    await assert.rejects(() => definition.execute({ vibe64User: { uid: 42 }, ...inputs[definition.id.replace("vibe64.training.", "")] }, { actor: { id: "42" } }), { statusCode: 401 });
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
    for (const name of ["teaching-brief.read", "lesson.resume"]) await assert.rejects(() => c.execute(name, { attemptId }), { code: "ACTION_VALIDATION_FAILED" });
  }
  assert.equal(f.calls.length, 0);
});

test("oversized projections and native failures remain bounded, truthful and source-free", async t => {
  const f = await fixture(t);
  const saved = await f.reserve();
  const original = await f.teachingBrief.readBrief({ actor: f.auth.user, attemptId: saved.attempt.attemptId });
  const large = f.register(null, { teachingBrief: { async readBrief() { return { ...original, lesson: { ...original.lesson, teachingText: "x".repeat(128 * 1024) } }; } } });
  await assert.rejects(() => large.execute("teaching-brief.read", { attemptId: saved.attempt.attemptId }), { code: "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE" });
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

test("lesson presentation tools use exact pinned commands and native browser receipts with fresh project authority", async t => {
  const f = await fixture(t, { presentation: true });
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const preparing = await f.learners.beginPreparation({ actor: f.auth.user, attemptId, expectedRevision: reserved.revision });
  const saved = await f.learners.recordPreparationReady({ actor: f.auth.user, attemptId,
    expectedRevision: preparing.revision, initialSessionId: preparing.attempt.preparation.initialSessionId });
  const calls = [];
  const colleague = { async navigate(input, context) {
    calls.push(structuredClone(input));
    assert.equal(context.vibe64Action.user.uid, 42);
    assert.equal(context.vibe64Action.project.slug, saved.attempt.projectSlug);
    const command = input.presentation;
    return { ok: true, focus: { projectSlug: input.projectSlug, sessionId: input.sessionId, pane: "preview" },
      presentation: { attemptId, visualId: command.visualId, playerInstanceId: "player-1",
        ...(command.operation === "snapshot" ? { snapshot: { state: "overview", paused: true, labels: {} } }
          : { phase: command.operation === "open" ? "ready" : command.operation === "cue" ? "armed" : "completed", state: "overview",
            ...(command.cueId ? { cueId: command.cueId } : {}),
            ...(command.commandId ? { commandId: command.commandId } : {}) }) } };
  }, async readCue(input) {
    return { ok: true, presentation: { ...input, phase: "completed", outputId: "actual-output", canonicalFinal: true,
      audioPhase: "completed", visualPhase: "completed" } };
  } };
  const definitions = createTrainingPresentationActions({ learners: f.learners, content: f.content, colleague });
  const actions = createActionCatalogue();
  actions.register({ contributorId: "presentations", domain: "training", actions: definitions.map(definition => ({ ...definition,
    channels: ["api", "automation"], surfaces: ["app"] })) });
  let allowProject = true;
  registerVibe64ActionContext(actions, { resolveUser: async () => f.auth.user,
    projectContext: { projectsRoot: f.root, async readWorkspaceProject({ slug }) { return { project: { path: path.join(f.root, slug) } }; } },
    authorizeProject() { if (!allowProject) throw Object.assign(new Error("Project access denied."), { statusCode: 403 }); } });
  const tools = createServiceToolCatalog(actions, { maxDirectTools: 100 });
  const context = { channel: "automation", surface: "app", colleague: { clientId: "tab-a" } };
  const toolSet = tools.resolveToolSet(context);
  const common = { projectSlug: saved.attempt.projectSlug, attemptId, visualId: "request" };
  const execute = (name, input = {}) => actions.execute({ actionId: `vibe64.training.visual.${name}`, input: { ...common, ...input }, context });
  const before = await inventory(f.systemRoot);
  for (const name of ["open", "command", "snapshot", "cue", "cue.read"]) {
    const input = ["command", "cue"].includes(name) ? { commandId: "command-1", name: "show", parameters: { label: "One request" },
      ...(name === "cue" ? { cueId: "cue-one" } : {}) } : name === "cue.read" ? { cueId: "cue-one" } : {};
    const api = await execute(name, input);
    const tool = toolSet.tools.find(item => item.actionId === `vibe64.training.visual.${name}`);
    assert.ok(tool);
    assert.doesNotThrow(() => tools.toOpenAiToolSchema(tool));
    const result = await tools.executeToolCall({ toolName: tool.name, toolSet, context, argumentsText: JSON.stringify({ ...common, ...input }) });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.result, api);
    assert.doesNotMatch(JSON.stringify(result.result), excluded);
    assert.equal(calls.at(-1).sessionId, saved.attempt.preparation.initialSessionId);
    assert.equal(calls.at(-1).pane, "preview");
  }
  assert.deepEqual(await inventory(f.systemRoot), before);
  const called = calls.length;
  for (const input of [{ name: "eval", parameters: {} }, { name: "show", parameters: {} },
    { name: "show", parameters: { label: "x".repeat(17) } }, { name: "show", parameters: { label: "ok", code: "run" } }]) {
    await assert.rejects(() => execute("command", { commandId: "command-invalid", ...input }), { code: "VIBE64_TRAINING_PRESENTATION_COMMAND_INVALID" });
  }
  await assert.rejects(() => execute("open", { projectSlug: "other" }), { code: "VIBE64_TRAINING_PRESENTATION_ATTEMPT_MISMATCH" });
  allowProject = false;
  await assert.rejects(() => execute("open"), { statusCode: 403 });
  allowProject = true;
  f.auth.user = { uid: 43, username: "another-member", role: "member" };
  await assert.rejects(() => execute("open"), { code: "VIBE64_TRAINING_PRESENTATION_ATTEMPT_MISMATCH" });
  f.auth.user = null;
  await assert.rejects(() => execute("open"), { statusCode: 401 });
  assert.equal(calls.length, called, "invalid or revoked commands cannot reach the browser");
  f.auth.user = { uid: 42, username: "member", role: "member" };
  const readState = f.learners.readState;
  f.learners.readState = async () => { throw Object.assign(new Error("Could not read /PRIVATE_SOURCE/attempt.json"), { code: "PIN_MISSING", statusCode: 409 }); };
  try {
    await assert.rejects(() => execute("open"), error => error.code === "PIN_MISSING" && error.statusCode === 409 &&
      !error.message.includes("PRIVATE_SOURCE") && error.cause.message.includes("PRIVATE_SOURCE"));
    const tool = toolSet.tools.find(item => item.actionId === "vibe64.training.visual.cue");
    const result = await tools.executeToolCall({ toolName: tool.name, toolSet, context,
      argumentsText: JSON.stringify({ ...common, cueId: "cue-one", commandId: "command-1", name: "show", parameters: { label: "One request" } }) });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), excluded);
  } finally { f.learners.readState = readState; }
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
  assert.match(definition.extensions.assistant.description, /does not Stop, close, archive or delete/u);
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
  assert.equal(read.active.learning.submissions.length, 0);
  const brief = await c.tool("teaching-brief.read", { attemptId: next.active.attemptId });
  assert.equal(brief.ok, true, JSON.stringify(brief));
  const retained = brief.result.brief.learning.retainedPasses;
  assert.equal(retained.length, 1);
  assert.equal(retained[0].attemptId, attemptId);
  assert.equal(retained[0].submission.submissionId, "answer-one");
  assert.equal(retained[0].submission.evidence.messageId, "message-one");
  assert.equal(retained[0].submission.evidence.attemptId, attemptId);
  assert.equal(retained[0].pin.lesson.hash, f.pin.lesson.hash);
  assert.deepEqual(brief.result.brief.learning.submissions, []);
  assert.equal(brief.result.brief.learning.completion.completed, true);
  assert.doesNotMatch(JSON.stringify([read, brief.result]), excluded);
  assert.deepEqual(await inventory(f.systemRoot), before);
  f.auth.user = { uid: 43, username: "other", role: "member" };
  assert.equal((await c.tool("learning.read")).result.history.length, 0);
  assert.equal((await c.tool("teaching-brief.read", { attemptId: next.active.attemptId })).ok, false);
});


test("practical evaluation forwards only native identities and retains API/tool feedback parity", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { attemptId: reserved.attempt.attemptId, expectedRevision: 4, submissionId: "practical-one",
    messageId: "canonical-explanation", observationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  const calls = [];
  const c = f.register(null, {}, { requireTrainingQuestionTurn() {}, stageTrainingQuestion() {},
    evaluateTrainingAnswer() { assert.fail("A practical cannot be graded as a quiz answer."); },
    async evaluateTrainingPractical(value, context) {
      calls.push({ value, actor: context.vibe64Action.user });
      return { revision: 5, replayed: calls.length > 1, attempt: { learning: { submissions: [{
        submissionId: "practical-one", assessmentId: "try-the-application", outcome: "passed",
        explanation: "You tried the application and explained its response.", evidence: { text: "PRIVATE_SOURCE", learnerId: "42" }
      }] } }, completion: { lessonCode: "USE-ONE", lessonHash: f.pin.lesson.hash, required: 1, passed: 1, completed: true } };
    } });
  const definition = c.definitions.find(value => value.id === "vibe64.training.practical.evaluate");
  assert.equal(definition.idempotency, "domain_native");
  assert.equal(definition.extensions.vibe64.projectScoped, false);
  const api = await c.execute("practical.evaluate", input);
  const tool = await c.tool("practical.evaluate", input);
  assert.equal(tool.ok, true, JSON.stringify(tool));
  assert.deepEqual(tool.result, { ...api, replayed: true });
  assert.deepEqual(calls, [{ value: input, actor: f.auth.user }, { value: input, actor: f.auth.user }]);
  assert.doesNotMatch(JSON.stringify(api), excluded);
  assert.doesNotMatch(JSON.stringify(tool), excluded);
});

test("practical evaluation rejects fabricated proof and sanitizes unconfirmed saving", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const input = { attemptId: reserved.attempt.attemptId, expectedRevision: 4, submissionId: "practical-one",
    messageId: "canonical-explanation", observationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  let calls = 0;
  const c = f.register(null, {}, { requireTrainingQuestionTurn() {}, stageTrainingQuestion() {},
    evaluateTrainingAnswer() { assert.fail("A practical cannot invoke answer grading."); },
    async evaluateTrainingPractical() {
      calls++;
      throw Object.assign(new Error("Cannot confirm save at /PRIVATE_SOURCE/progress.json"), {
        code: "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", statusCode: 409 });
    } });
  for (const extra of [{ observation: {} }, { origin: "learner" }, { checkResult: { outcome: "passed" } },
    { text: "Invented explanation" }, { assistance: "none" }, { outcome: "passed" }, { actor: { uid: 1 } }]) {
    await assert.rejects(c.execute("practical.evaluate", { ...input, ...extra }), { code: "ACTION_VALIDATION_FAILED" });
  }
  await assert.rejects(c.execute("practical.evaluate", { ...input, observationId: "not-a-native-uuid" }), { code: "ACTION_VALIDATION_FAILED" });
  f.auth.user = null;
  await assert.rejects(c.execute("practical.evaluate", input), { code: "vibe64_auth_required" });
  assert.equal(calls, 0);
  f.auth.user = { uid: 42, username: "member", role: "member" };
  await assert.rejects(c.execute("practical.evaluate", input), error => error.code === "VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED");
  const tool = await c.tool("practical.evaluate", input);
  assert.equal(tool.ok, false);
  assert.doesNotMatch(JSON.stringify(tool), excluded);
  assert.equal(calls, 2);
});

test("resumed lesson brief projects remaining coverage while retaining the passed checkpoint through API and native tools", async t => {
  const f = await fixture(t);
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const pendingQuestion = { id: "question-old", assessmentId: "explain", text: "What did you try?", assistance: "hint", issuedRevision: 2 };
  const saved = await f.learners.saveLessonResume({ actor: f.auth.user, attemptId, expectedRevision: reserved.revision,
    requestId: "question-old", resume: { stage: "question", pendingQuestion, visuals: [], summary: "The learner tried Preview." } });
  const recorded = await f.learners.recordAssessment({ actor: f.auth.user, attemptId, expectedRevision: saved.revision,
    submissionId: "answer-old", assessmentId: "explain", outcome: "passed", assistance: "hint",
    explanation: "The learner identified Preview.", evidence: { kind: "answer", learnerId: "42", attemptId,
      messageId: "accepted-answer-old", questionId: pendingQuestion.id, text: "I tried Preview." } });
  const c = f.register(f.exercises);
  const resumed = await c.execute("lesson.resume", { attemptId });
  assert.equal(resumed.revision, recorded.revision);
  assert.equal(resumed.completion.passed, 1);
  assert.deepEqual(resumed.active.learning.resume.pendingQuestion, { id: pendingQuestion.id, assessmentId: "explain", text: pendingQuestion.text });
  const before = await inventory(f.systemRoot);
  const api = await c.execute("teaching-brief.read", { attemptId });
  const tool = await c.tool("teaching-brief.read", { attemptId });
  assert.equal(tool.ok, true, JSON.stringify(tool));
  assert.deepEqual(tool.result, api);
  assert.deepEqual(api.brief.learning.passedAssessmentIds, ["explain"]);
  assert.deepEqual(api.brief.learning.remainingAssessmentIds, []);
  assert.deepEqual(api.brief.learning.resume.pendingQuestion, resumed.active.learning.resume.pendingQuestion);
  assert.equal(api.brief.learning.completion.passed, 1);
  assert.match(api.brief.pacing.join("\n"), /last checkpoint/u);
  assert.match(api.brief.pacing.join("\n"), /control request, not a learner answer/u);
  assert.match(c.definitions.find(value => value.id === "vibe64.training.lesson.resume").extensions.assistant.description,
    /After success, read teaching-brief.read/u);
  assert.doesNotMatch(JSON.stringify(api), excluded);
  assert.deepEqual(await inventory(f.systemRoot), before);
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


test("presentation supplies its exact captured attempt ID to the configured original learner reader", async t => {
  const f = await fixture(t, { presentation: true });
  const reserved = await f.reserve();
  const attemptId = reserved.attempt.attemptId;
  const preparing = await f.learners.beginPreparation({ actor: f.auth.user, attemptId, expectedRevision: reserved.revision });
  const ready = await f.learners.recordPreparationReady({ actor: f.auth.user, attemptId,
    expectedRevision: preparing.revision, initialSessionId: preparing.attempt.preparation.initialSessionId });
  const reads = [];
  const learners = { async readState(input) { reads.push(input); return f.learners.readState(input); } };
  const colleague = { async navigate() { return { ok: true }; } };
  const definition = createTrainingPresentationActions({ learners, content: f.content, colleague })
    .find(value => value.id === "vibe64.training.visual.open");
  const result = await definition.execute({ projectSlug: ready.attempt.projectSlug, attemptId, visualId: "request" },
    { vibe64Action: { user: f.auth.user, project: { slug: ready.attempt.projectSlug } } });
  assert.equal(result.ok, true);
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0], { actor: f.auth.user, attemptId, includeCompletion: true });
});
