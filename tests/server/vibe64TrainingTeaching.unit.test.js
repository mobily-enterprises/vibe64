import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingTeachingOwner } from "../../packages/vibe64-training/src/server/teaching.js";
import { createTrainingAnswerAssessment } from "../../packages/vibe64-training/src/server/answerAssessment.js";

async function fixture(t, { ready = true, practical = false, evidence = null, exerciseCheck = false, exercise = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-teaching-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), systemRoot = path.join(root, "system");
  await mkdir(source);
  await writeFile(path.join(source, "package.json"), JSON.stringify({ name: "learn-teaching", version: "0.1.0",
    repository: { type: "git", url: "https://github.com/examples/learn-teaching.git" },
    vibe64Training: { schemaVersion: 1, topicId: "teaching", domainId: "vibe64", title: "Try the app",
      status: "preview", outline: "outline.md", prerequisites: [],
      lessons: [{ code: "USE-ONE", descriptor: "lesson.json", status: "published", required: true }] } }));
  await writeFile(path.join(source, "outline.md"), "# One introduction\n");
  await writeFile(path.join(source, "lesson.json"), JSON.stringify({ schemaVersion: 1, code: "USE-ONE",
    title: "Try the app", document: "lesson.md", prerequisites: [], estimatedMinutes: 5,
    visuals: [{ id: "request", descriptor: "visual.json" }],
    ...(exercise ? { exercise: { kind: "bundled", source: "app", reuse: "attempt" } } : {}),
    ...(exerciseCheck ? { checks: [{ id: "orientation-response", file: "check.mjs" }] } : {}), assessments: [
      { id: "explain", kind: "answer", required: true, rubric: "lesson.md#explain" },
      { id: "next", kind: "answer", required: true, rubric: "lesson.md#next" },
      ...(practical ? [
        { id: "workspace-navigation", kind: "practical", required: true, rubric: "lesson.md#workspace-navigation",
          evidence: evidence || { producer: "workspace", operation: "workspace-navigation" } },
        { id: "return-to-colleague", kind: "practical", required: true, rubric: "lesson.md#return-to-colleague",
          evidence: { producer: "colleague", operation: "return-to-colleague" } }
      ] : []),
      ...(exerciseCheck ? [{ id: "try-the-application", kind: "practical", required: true, rubric: "lesson.md#try-the-application",
        evidence: { producer: "exercise", operation: "try-the-application", check: "orientation-response", explanationRequired: true } }] : [])
    ] }));
  if (exerciseCheck) await writeFile(path.join(source, "check.mjs"), 'throw new Error("CHECK_MUST_NOT_EXECUTE");');
  await writeFile(path.join(source, "lesson.md"), '# Try the app\n<a id="explain"></a>\nExplain Preview.\n<a id="next"></a>\nExplain your next step.\n');
  if (practical) await writeFile(path.join(source, "lesson.md"), (await readFile(path.join(source, "lesson.md"), "utf8")) +
    '<a id="workspace-navigation"></a>\nSelect the project, Main and Preview.\n<a id="return-to-colleague"></a>\nLeave and return.\n');
  if (exerciseCheck) await writeFile(path.join(source, "lesson.md"), (await readFile(path.join(source, "lesson.md"), "utf8")) +
    '<a id="try-the-application"></a>\nPress the button, read the response and explain it.\n');
  await writeFile(path.join(source, "visual.json"), JSON.stringify({ schemaVersion: 1, id: "request", title: "Request",
    svg: "diagram.svg", controller: "controller.js", initialState: "overview", states: ["overview", "arrived"],
    description: "Follow the request.", commands: [] }));
  await writeFile(path.join(source, "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(path.join(source, "controller.js"), 'throw new Error("VISUAL_MUST_NOT_EXECUTE");');
  await mkdir(path.join(source, "app"));
  await writeFile(path.join(source, "app/server.mjs"), 'throw new Error("EXERCISE_MUST_NOT_EXECUTE");');
  const commit = "a".repeat(40), snapshotRoot = path.join(systemRoot, "training/content/teaching", commit);
  await mkdir(path.dirname(snapshotRoot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshotRoot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshotRoot, "bundle.json"), "utf8"));
  const topic = { schemaVersion: 1, topicId: "teaching", release: "0.1.0", repository: "examples/learn-teaching",
    commit, topicHash: bundle.topicHash };
  await writeFile(path.join(snapshotRoot, "pin.json"), JSON.stringify(topic));
  const pin = { course: { courseId: "intro", release: "0.1.0" }, topic,
    lesson: { code: "USE-ONE", hash: bundle.lessons[0].hash } };
  const actor = { uid: 42, username: "alice" };
  const learners = createTrainingLearnerState({ systemRoot });
  const content = createInstalledTrainingContent({ systemRoot });
  const owner = createTrainingTeachingOwner({ learners, content });
  const reserved = await learners.reserveAttempt({ actor, requestId: "start", expectedRevision: 0, pin });
  const attemptId = reserved.attempt.attemptId;
  if (ready) {
    await learners.beginPreparation({ actor, attemptId, expectedRevision: 1 });
    await learners.recordPreparationReady({ actor, attemptId, initialSessionId: `training-${attemptId}`, expectedRevision: 2 });
  }
  const input = { actor, attemptId, expectedRevision: ready ? 3 : 1, requestId: "question-one",
    assessmentId: "explain", text: "Where do you try the running app?", assistance: "none" };
  const read = () => learners.readState({ actor, includeCompletion: true });
  const paths = ["progress.json", "active-lesson.json"].map(file => path.join(systemRoot, "training/users/NDI", file));
  async function checkpoint(requestId, changes = {}) {
    const state = await read();
    const { requestId: previousRequest, revision, ...resume } = state.active.learning.resume;
    return learners.saveLessonResume({ actor, attemptId, expectedRevision: state.revision, requestId,
      resume: { ...resume, ...changes } });
  }
  return { owner, learners, content, actor, attemptId, pin, input, read, checkpoint, paths, snapshotRoot };
}

async function storedFiles(paths) {
  return Promise.all(paths.map(async filename => ({ bytes: await readFile(filename), mtime: (await stat(filename)).mtimeMs })));
}

test("a reserved no-exercise lesson admits pinned answers and durable grading without fabricating preparation", async t => {
  const f = await fixture(t, { ready: false, exercise: false });
  const issued = await f.owner.prepareQuestion(f.input);
  assert.equal(issued.revision, 2);
  assert.deepEqual((await f.read()).active.preparation, { phase: "reserved" });
  const before = await storedFiles(f.paths);
  assert.deepEqual(await f.owner.readQuestionReference({ actor: f.actor }), issued.reference);
  assert.deepEqual(await f.owner.captureQuestion({ actor: f.actor, reference: issued.reference }), issued.snapshot);
  assert.deepEqual(await storedFiles(f.paths), before);
  assert.deepEqual(await f.owner.prepareQuestion(f.input), { ...issued, replayed: true });
  await assert.rejects(f.owner.saveVisualCheckpoint({ actor: f.actor, attemptId: f.attemptId,
    expectedRevision: 2, requestId: "visual", visualId: "request", snapshot: { state: "overview", paused: true, labels: {} } }),
  { code: "VIBE64_TRAINING_PREPARATION_REQUIRED" });
  await assert.rejects(f.owner.capturePractical({ actor: f.actor, reference: issued.reference }),
    { code: "VIBE64_TRAINING_PRACTICAL_UNAVAILABLE" });
  const assessment = createTrainingAnswerAssessment({ learners: f.learners, content: f.content, teaching: f.owner });
  let runs = 0;
  const input = { actor: f.actor, attemptId: f.attemptId, expectedRevision: 2, submissionId: "answer-one",
    message: { role: "user", receipt: true, messageId: "accepted-answer", text: "I try the app in Preview.",
      data: { trainingQuestion: { ...issued.snapshot, delivery: { conversationId: "colleague", turnId: "question-turn", outputId: "question-output" } } } } };
  const facilities = { state: { summaryAbort: new AbortController() }, context: {}, helper: { async runHelper(_state, _context, request) {
    runs++;
    assert.equal(request.data.evidence.messageId, "accepted-answer");
    return JSON.stringify({ outcome: "passed", explanation: "Identifies Preview." });
  } } };
  await assert.rejects(assessment.evaluateAnswer({ ...input, message: { ...input.message, receipt: false } }, facilities),
    { code: "VIBE64_TRAINING_ANSWER_UNADMITTED" });
  const saved = await assessment.evaluateAnswer(input, facilities);
  assert.equal(saved.completion.passed, 1);
  assert.equal(saved.completion.completed, false);
  assert.deepEqual(saved.attempt.preparation, { phase: "reserved" });
  assert.equal((await assessment.evaluateAnswer(input, facilities)).replayed, true);
  assert.equal(runs, 1, "same accepted evidence is never graded twice");
  assert.equal((await f.read()).active.learning.submissions[0].evidence.messageId, "accepted-answer");
});

test("question preparation uses original checkpoint identity/replay and capture returns immutable server facts without writes", async t => {
  const f = await fixture(t);
  const issued = await f.owner.prepareQuestion(f.input);
  assert.equal(issued.revision, 4);
  assert.equal(issued.replayed, false);
  assert.deepEqual(issued.snapshot.question, { id: "question-one", assessmentId: "explain",
    text: f.input.text, assistance: "none", issuedRevision: 4 });
  assert.deepEqual(issued.snapshot.pin, f.pin);
  assert.equal(issued.snapshot.learnerId, "42");
  const replay = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 0 });
  assert.deepEqual(replay, { ...issued, replayed: true });
  const before = await storedFiles(f.paths);
  const captured = await f.owner.captureQuestion({ actor: f.actor, reference: issued.reference });
  assert.deepEqual(captured, issued.snapshot);
  for (const object of [captured, captured.question, captured.pin, captured.pin.topic, captured.pin.course, captured.pin.lesson]) {
    assert.equal(Object.isFrozen(object), true);
  }
  assert.throws(() => { captured.question.text = "Forged"; }, TypeError);
  assert.deepEqual(await storedFiles(f.paths), before);
});

test("preparation preserves native stage, visual state and summary; unrelated checkpoints retain issued question authority", async t => {
  const f = await fixture(t);
  await f.learners.saveLessonResume({ actor: f.actor, attemptId: f.attemptId, expectedRevision: 3, requestId: "visual-first",
    resume: { stage: "preview", pendingQuestion: null, visuals: [{ visualId: "request",
      snapshot: { state: "arrived", paused: true, labels: { path: "/" } } }], summary: "Tried the real app." } });
  const issued = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 4 });
  const resume = (await f.read()).active.learning.resume;
  assert.equal(resume.stage, "preview");
  assert.equal(resume.summary, "Tried the real app.");
  assert.deepEqual(resume.visuals, [{ visualId: "request", snapshot: { state: "arrived", paused: true, labels: { path: "/" } } }]);
  await f.checkpoint("paused-diagram", { summary: "Paused for an answer.", visuals: [{ visualId: "request",
    snapshot: { state: "overview", paused: true, labels: {} } }] });
  const before = await storedFiles(f.paths);
  const captured = await f.owner.captureQuestion({ actor: f.actor, reference: issued.reference });
  assert.equal(captured.question.issuedRevision, 5);
  assert.equal(captured.resumeRevision, 6);
  const replay = await f.owner.prepareQuestion(f.input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, 6);
  assert.deepEqual(replay.reference, issued.reference);
  assert.deepEqual(await storedFiles(f.paths), before, "old preparation replay does not overwrite the later visual checkpoint");
});

test("replacement and reused old request identity reject old references instead of substituting a new question", async t => {
  const f = await fixture(t);
  const first = await f.owner.prepareQuestion(f.input);
  const next = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 4, requestId: "question-two", assessmentId: "next", text: "What next?" });
  await assert.rejects(f.owner.captureQuestion({ actor: f.actor, reference: first.reference }), { code: "VIBE64_TRAINING_QUESTION_STALE" });
  const reused = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 5 });
  assert.equal(reused.snapshot.question.issuedRevision, 6);
  await assert.rejects(f.owner.captureQuestion({ actor: f.actor, reference: first.reference }), { code: "VIBE64_TRAINING_QUESTION_STALE" });
  await assert.rejects(f.owner.captureQuestion({ actor: f.actor, reference: next.reference }), { code: "VIBE64_TRAINING_QUESTION_STALE" });
  assert.deepEqual(await f.owner.captureQuestion({ actor: f.actor, reference: reused.reference }), reused.snapshot);
});

test("changed current question payload and stale new preparation fail without overwriting retained native state", async t => {
  const f = await fixture(t);
  await f.owner.prepareQuestion(f.input);
  const before = await storedFiles(f.paths);
  for (const changes of [{ text: "Changed" }, { assessmentId: "next" }, { assistance: "hint" }]) {
    await assert.rejects(f.owner.prepareQuestion({ ...f.input, expectedRevision: 4, ...changes }), { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  }
  await assert.rejects(f.owner.prepareQuestion({ ...f.input, requestId: "question-two" }), { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  assert.deepEqual(await storedFiles(f.paths), before);
});

test("legacy questions without authoritative assistance or issued revision remain readable and ungradable", async t => {
  const f = await fixture(t);
  const reference = { attemptId: f.attemptId, questionId: "legacy", assessmentId: "explain", issuedRevision: 4,
    topicHash: f.pin.topic.topicHash, lessonHash: f.pin.lesson.hash };
  for (const additions of [{}, { assistance: "none" }, { issuedRevision: 4 }]) {
    const state = await f.read();
    await f.learners.saveLessonResume({ actor: f.actor, attemptId: f.attemptId, expectedRevision: state.revision,
      requestId: `legacy-${state.revision}`, resume: { stage: "question", pendingQuestion: { id: "legacy", assessmentId: "explain",
        text: "Old question", ...additions }, visuals: [], summary: "" } });
    const before = await storedFiles(f.paths);
    await assert.rejects(f.owner.captureQuestion({ actor: f.actor, reference }), { code: "VIBE64_TRAINING_QUESTION_PROVENANCE_MISSING" });
    assert.deepEqual(await storedFiles(f.paths), before);
  }
  const issued = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 6 });
  assert.equal(issued.snapshot.question.assistance, "none");
  assert.equal(issued.snapshot.question.issuedRevision, 7);
});

test("preparation/capture require exact ready active learner attempt and validated installed assessment", async t => {
  const f = await fixture(t, { ready: false });
  const before = await storedFiles(f.paths);
  await assert.rejects(f.owner.prepareQuestion(f.input), { code: "VIBE64_TRAINING_PREPARATION_REQUIRED" });
  assert.deepEqual(await storedFiles(f.paths), before);
  await f.learners.beginPreparation({ actor: f.actor, attemptId: f.attemptId, expectedRevision: 1 });
  await f.learners.recordPreparationReady({ actor: f.actor, attemptId: f.attemptId, initialSessionId: `training-${f.attemptId}`, expectedRevision: 2 });
  await assert.rejects(f.owner.prepareQuestion({ ...f.input, expectedRevision: 3, assessmentId: "invented" }), /exact installed lesson/);
  await assert.rejects(f.owner.prepareQuestion({ ...f.input, actor: { uid: 43 }, expectedRevision: 3 }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  const issued = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 3 });
  await assert.rejects(f.owner.captureQuestion({ actor: { uid: 43 }, reference: issued.reference }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await f.learners.endAttempt({ actor: f.actor, attemptId: f.attemptId, expectedRevision: 4, requestId: "end", reason: "discard" });
  await assert.rejects(f.owner.captureQuestion({ actor: f.actor, reference: issued.reference }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
});

test("bounded canonical references and mandatory assistance reject caller fields, coercion and mismatched pins", async t => {
  const f = await fixture(t);
  for (const changes of [{ assistance: undefined }, { assistance: "guessed" }, { text: " " }, { text: "x".repeat(2049) },
    { expectedRevision: "3" }, { requestId: "../path" }, { attemptId: "not-uuid" }, { pin: f.pin }]) {
    await assert.rejects(f.owner.prepareQuestion({ ...f.input, ...changes }));
  }
  const issued = await f.owner.prepareQuestion(f.input);
  const before = await storedFiles(f.paths);
  for (const changes of [{ topicHash: "b".repeat(64) }, { lessonHash: "b".repeat(64) }, { issuedRevision: 3 },
    { questionId: "other" }, { assessmentId: "next" }]) {
    await assert.rejects(f.owner.captureQuestion({ actor: f.actor, reference: { ...issued.reference, ...changes } }), { code: "VIBE64_TRAINING_QUESTION_STALE" });
  }
  for (const changes of [{ issuedRevision: "4" }, { issuedRevision: 0 }, { issuedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { questionId: "x".repeat(65) }, { topicHash: "bad" }, { user: "42" }, { text: "forged answer" }]) {
    await assert.rejects(f.owner.captureQuestion({ actor: f.actor, reference: { ...issued.reference, ...changes } }));
  }
  await assert.rejects(f.owner.captureQuestion({ reference: issued.reference }), /actor|identity/);
  assert.deepEqual(await storedFiles(f.paths), before);
});

test("fresh installed validation refuses tampered content without issuing or capturing a question", async t => {
  const f = await fixture(t);
  const issued = await f.owner.prepareQuestion(f.input);
  await writeFile(path.join(f.snapshotRoot, "files/lesson.md"), "Changed installed lesson.");
  const before = await storedFiles(f.paths);
  await assert.rejects(f.owner.captureQuestion({ actor: f.actor, reference: issued.reference }), /changed|mismatch|hash|invalid/);
  await assert.rejects(f.owner.prepareQuestion({ ...f.input, expectedRevision: 4, requestId: "new-question" }), /changed|mismatch|hash|invalid/);
  assert.deepEqual(await storedFiles(f.paths), before);
});

test("native reference read is write-free, omits absent or legacy authority and propagates corrupt installed content", async t => {
  const f = await fixture(t, { ready: false });
  let before = await storedFiles(f.paths);
  assert.equal(await f.owner.readQuestionReference({ actor: f.actor }), null);
  assert.equal(await f.owner.readQuestionReference({ actor: { uid: 43 } }), null);
  assert.deepEqual(await storedFiles(f.paths), before);
  await f.learners.beginPreparation({ actor: f.actor, attemptId: f.attemptId, expectedRevision: 1 });
  await f.learners.recordPreparationReady({ actor: f.actor, attemptId: f.attemptId, initialSessionId: `training-${f.attemptId}`, expectedRevision: 2 });
  assert.equal(await f.owner.readQuestionReference({ actor: f.actor }), null);
  await f.learners.saveLessonResume({ actor: f.actor, attemptId: f.attemptId, expectedRevision: 3, requestId: "legacy",
    resume: { stage: "question", pendingQuestion: { id: "legacy", assessmentId: "explain", text: "Old question" }, visuals: [], summary: "" } });
  before = await storedFiles(f.paths);
  assert.equal(await f.owner.readQuestionReference({ actor: f.actor }), null);
  assert.deepEqual(await storedFiles(f.paths), before);
  const issued = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 4 });
  before = await storedFiles(f.paths);
  const reference = await f.owner.readQuestionReference({ actor: f.actor });
  assert.deepEqual(reference, issued.reference);
  assert.equal(Object.isFrozen(reference), true);
  assert.deepEqual(await storedFiles(f.paths), before);
  await rm(path.join(f.snapshotRoot, "files/lesson.md"));
  await assert.rejects(f.owner.readQuestionReference({ actor: f.actor }), { code: "VIBE64_TRAINING_CONTENT_MISSING" });
  await writeFile(path.join(f.snapshotRoot, "files/lesson.md"), "Changed installed lesson.");
  await assert.rejects(f.owner.readQuestionReference({ actor: f.actor }), { code: "VIBE64_TRAINING_CONTENT_INVALID" });
  assert.deepEqual(await storedFiles(f.paths), before);
});

test("native practical capture reuses the exact pinned question and ready target without writing or grading", async t => {
  const f = await fixture(t, { practical: true });
  for (const [index, id] of ["workspace-navigation", "return-to-colleague"].entries()) {
    const issued = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 3 + index,
      requestId: `practical-${index}`, assessmentId: id, assistance: index ? "demonstration" : "none" });
    const before = await storedFiles(f.paths);
    const captured = await f.owner.capturePractical({ actor: f.actor, reference: issued.reference });
    assert.deepEqual(captured.snapshot, issued.snapshot);
    assert.deepEqual(captured.target, { projectSlug: (await f.read()).active.projectSlug, sessionId: `training-${f.attemptId}` });
    assert.deepEqual(captured.assessment, { id, evidence: { producer: index ? "colleague" : "workspace", operation: id } });
    assert.equal(captured.snapshot.question.assistance, index ? "demonstration" : "none");
    for (const object of [captured, captured.target, captured.assessment, captured.assessment.evidence]) assert.equal(Object.isFrozen(object), true);
    assert.deepEqual(await storedFiles(f.paths), before);
  }
});

test("native practical capture refuses answers, stale questions, unready targets and wrong installed evidence contracts", async t => {
  const f = await fixture(t, { practical: true });
  const answer = await f.owner.prepareQuestion(f.input);
  let before = await storedFiles(f.paths);
  await assert.rejects(f.owner.capturePractical({ actor: f.actor, reference: answer.reference }), { code: "VIBE64_TRAINING_PRACTICAL_UNAVAILABLE" });
  assert.deepEqual(await storedFiles(f.paths), before);
  const issued = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 4, requestId: "practical", assessmentId: "workspace-navigation" });
  before = await storedFiles(f.paths);
  await assert.rejects(f.owner.capturePractical({ actor: f.actor, reference: { ...issued.reference, issuedRevision: 4 } }), { code: "VIBE64_TRAINING_QUESTION_STALE" });
  await assert.rejects(f.owner.capturePractical({ actor: { uid: 43 }, reference: issued.reference }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  assert.deepEqual(await storedFiles(f.paths), before);
  const unready = await fixture(t, { ready: false });
  await assert.rejects(unready.owner.capturePractical({ actor: unready.actor, reference: { ...issued.reference, attemptId: unready.attemptId } }), { code: "VIBE64_TRAINING_PREPARATION_REQUIRED" });
  for (const evidence of [{ producer: "colleague", operation: "workspace-navigation" }, { producer: "workspace", operation: "other" }]) {
    const other = await fixture(t, { practical: true, evidence });
    const question = await other.owner.prepareQuestion({ ...other.input, assessmentId: "workspace-navigation" });
    before = await storedFiles(other.paths);
    await assert.rejects(other.owner.capturePractical({ actor: other.actor, reference: question.reference }), { code: "VIBE64_TRAINING_PRACTICAL_UNAVAILABLE" });
    assert.deepEqual(await storedFiles(other.paths), before);
  }
});


test("native practical capture admits only the pinned orientation check contract without reading or executing its bytes", async t => {
  const f = await fixture(t, { exerciseCheck: true });
  const issued = await f.owner.prepareQuestion({ ...f.input, assessmentId: "try-the-application" });
  const before = await storedFiles(f.paths);
  const captured = await f.owner.capturePractical({ actor: f.actor, reference: issued.reference });
  assert.deepEqual(captured.assessment, { id: "try-the-application", evidence: { producer: "exercise",
    operation: "try-the-application", check: "orientation-response", explanationRequired: true } });
  assert.equal(captured.snapshot.question.assistance, "none");
  assert.deepEqual(await storedFiles(f.paths), before);
});

test("a retained pass leaves checkpoint references and explicitly prepared reassessment authoritative", async t => {
  const f = await fixture(t);
  const issued = await f.owner.prepareQuestion(f.input);
  const recorded = await f.learners.recordAssessment({ actor: f.actor, attemptId: f.attemptId,
    expectedRevision: issued.revision, submissionId: "answer-one", assessmentId: "explain",
    outcome: "passed", assistance: "none", explanation: "The learner identified Preview.",
    evidence: { kind: "answer", learnerId: "42", attemptId: f.attemptId, messageId: "accepted-answer-one",
      questionId: issued.reference.questionId, text: "I use Preview." } });
  assert.equal(recorded.completion.passed, 1);
  const before = await storedFiles(f.paths);
  assert.deepEqual(await f.owner.readQuestionReference({ actor: f.actor }), issued.reference);
  assert.deepEqual((await f.owner.captureQuestion({ actor: f.actor, reference: issued.reference })).question, issued.snapshot.question);
  assert.deepEqual(await storedFiles(f.paths), before);
  const reassessed = await f.owner.prepareQuestion({ ...f.input, expectedRevision: recorded.revision,
    requestId: "question-again", text: "Where would you try the next change?", assistance: "hint" });
  assert.notDeepEqual(reassessed.reference, issued.reference);
  assert.deepEqual(await f.owner.readQuestionReference({ actor: f.actor }), reassessed.reference);
  assert.deepEqual((await f.owner.captureQuestion({ actor: f.actor, reference: reassessed.reference })).question, reassessed.snapshot.question);
  const state = await f.read();
  assert.equal(state.completion.passed, 1);
  assert.deepEqual(state.active.learning.submissions, recorded.attempt.learning.submissions);
  assert.deepEqual(state.active.learning.resume.pendingQuestion, reassessed.snapshot.question);
});

test("native visual checkpoints preserve the issued question and replay before CAS without another write", async t => {
  const f = await fixture(t);
  const question = await f.owner.prepareQuestion(f.input);
  const snapshot = { state: "arrived", paused: true, labels: { path: "/real" } };
  const input = { actor: f.actor, attemptId: f.attemptId, visualId: "request", requestId: "native-visual",
    expectedRevision: question.revision, snapshot };
  const saved = await f.owner.saveVisualCheckpoint(input);
  assert.equal(saved.revision, 5);
  assert.equal(saved.unchanged, false);
  const before = await storedFiles(f.paths);
  assert.deepEqual(await f.owner.saveVisualCheckpoint({ ...input, expectedRevision: 0 }), { ...saved, replayed: true });
  assert.deepEqual(await storedFiles(f.paths), before);
  assert.deepEqual((await f.owner.captureQuestion({ actor: f.actor, reference: question.reference })).question, question.snapshot.question);
  assert.deepEqual((await f.read()).active.learning.resume.visuals, [{ visualId: "request", snapshot }]);
  await assert.rejects(f.owner.saveVisualCheckpoint({ ...input, snapshot: { ...snapshot, paused: false } }), { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  assert.deepEqual(await storedFiles(f.paths), before);
});

test("fresh visual save preserves newer questions and identical semantics avoid revision churn without inventing old receipts", async t => {
  const f = await fixture(t);
  const snapshot = { state: "arrived", paused: true, labels: { work: "Real result" } };
  const input = { actor: f.actor, attemptId: f.attemptId, visualId: "request", requestId: "visual-first", expectedRevision: 3, snapshot };
  await f.owner.saveVisualCheckpoint(input);
  const issued = await f.owner.prepareQuestion({ ...f.input, expectedRevision: 4 });
  const before = await storedFiles(f.paths);
  assert.deepEqual(await f.owner.saveVisualCheckpoint(input), { revision: 5, replayed: false, unchanged: true });
  assert.deepEqual(await storedFiles(f.paths), before);
  await assert.rejects(f.owner.saveVisualCheckpoint({ ...input, snapshot: { ...snapshot, state: "overview" } }), { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  assert.deepEqual(await storedFiles(f.paths), before);
  await f.owner.saveVisualCheckpoint({ ...input, expectedRevision: 5, requestId: "fresh-capture", snapshot: { ...snapshot, state: "overview" } });
  assert.deepEqual((await f.owner.captureQuestion({ actor: f.actor, reference: issued.reference })).question, issued.snapshot.question);
});

test("visual checkpoint bounds, installed membership and original question-write race remain fail-closed", async t => {
  const f = await fixture(t);
  const input = { actor: f.actor, attemptId: f.attemptId, visualId: "request", requestId: "snapshot", expectedRevision: 3,
    snapshot: { state: "overview", paused: true, labels: {} } };
  const before = await storedFiles(f.paths);
  for (const changes of [{ actor: { uid: 43 } }, { visualId: "missing" },
    { snapshot: { state: "missing", paused: true, labels: {} } },
    { snapshot: { ...input.snapshot, extra: true } }, { snapshot: { ...input.snapshot, labels: { work: "x".repeat(257) } } }]) {
    await assert.rejects(f.owner.saveVisualCheckpoint({ ...input, ...changes }));
  }
  assert.deepEqual(await storedFiles(f.paths), before);
  const results = await Promise.allSettled([f.owner.saveVisualCheckpoint(input), f.owner.prepareQuestion(f.input)]);
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  const rejected = results.findIndex(value => value.status === "rejected");
  assert.ok(["VIBE64_TRAINING_STATE_BUSY", "VIBE64_TRAINING_STATE_REVISION_CONFLICT"].includes(results[rejected].reason.code));
  await assert.rejects(rejected === 0 ? f.owner.saveVisualCheckpoint(input) : f.owner.prepareQuestion(f.input),
    { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  assert.equal((await f.read()).revision, 4);
  assert.equal((await f.read()).active.learning.submissions.length, 0);
});


test("completed practical projection requires exact native correlation and saved pass without retiring question or retries", async t => {
  const f = await fixture(t, { practical: true });
  const issued = await f.owner.prepareQuestion({ ...f.input, assessmentId: "return-to-colleague" });
  const observationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const evidence = { kind: "observation", learnerId: "42", attemptId: f.attemptId, observationId,
    observedAt: "2026-10-07T00:00:00.000Z", projectSlug: (await f.read()).active.projectSlug,
    sessionId: `training-${f.attemptId}`, producer: "colleague", operation: "return-to-colleague", origin: "learner", text: "I returned." };
  const input = { actor: f.actor, attemptId: f.attemptId, expectedRevision: issued.revision,
    submissionId: "native-practical", assessmentId: "return-to-colleague", outcome: "passed", assistance: "none",
    explanation: "The real sequence and learner explanation were confirmed.", evidence };
  const proof = { reference: issued.reference, submissionId: input.submissionId, observationId };
  assert.deepEqual(await f.owner.readQuestionReference({ actor: f.actor, completedPracticals: [proof] }), issued.reference,
    "native tool output alone is not a saved pass");
  const recorded = await f.learners.recordAssessment(input);
  let before = await storedFiles(f.paths);
  assert.equal(await f.owner.readQuestionReference({ actor: f.actor, completedPracticals: [proof] }), null);
  for (const changes of [{ submissionId: "other" }, { observationId: "another" },
    { reference: { ...issued.reference, issuedRevision: issued.reference.issuedRevision + 1 } },
    { reference: { ...issued.reference, lessonHash: "c".repeat(64) } }]) {
    assert.deepEqual(await f.owner.readQuestionReference({ actor: f.actor, completedPracticals: [{ ...proof, ...changes }] }), issued.reference);
  }
  assert.deepEqual(await f.owner.readQuestionReference({ actor: f.actor }), issued.reference,
    "default capture/admission consumers keep immutable question authority");
  assert.deepEqual((await f.owner.capturePractical({ actor: f.actor, reference: issued.reference })).snapshot.question, issued.snapshot.question);
  assert.deepEqual(await storedFiles(f.paths), before);
  assert.equal((await f.learners.recordAssessment({ ...input, expectedRevision: 0 })).replayed, true);
  const repeated = await f.owner.prepareQuestion({ ...f.input, expectedRevision: recorded.revision,
    assessmentId: "return-to-colleague", requestId: "repeat-practical", text: "Please try the sequence again." });
  before = await storedFiles(f.paths);
  assert.deepEqual(await f.owner.readQuestionReference({ actor: f.actor, completedPracticals: [proof] }), repeated.reference,
    "an earlier pass does not answer a newly issued question");
  assert.deepEqual(await storedFiles(f.paths), before);
  assert.equal((await f.read()).active.learning.submissions.length, 1);
});

test("an unpassed practical receipt never suppresses the current native question", async t => {
  const f = await fixture(t, { practical: true });
  const issued = await f.owner.prepareQuestion({ ...f.input, assessmentId: "return-to-colleague" });
  const observationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await f.learners.recordAssessment({ actor: f.actor, attemptId: f.attemptId, expectedRevision: issued.revision,
    submissionId: "needs-practice", assessmentId: "return-to-colleague", outcome: "not-yet-passed", assistance: "none",
    explanation: "Repeat the visible sequence.", evidence: { kind: "observation", learnerId: "42", attemptId: f.attemptId,
      observationId, observedAt: "2026-10-07T00:00:00.000Z", projectSlug: (await f.read()).active.projectSlug,
      sessionId: `training-${f.attemptId}`, producer: "colleague", operation: "return-to-colleague", origin: "learner", text: "I tried." } });
  const before = await storedFiles(f.paths);
  assert.deepEqual(await f.owner.readQuestionReference({ actor: f.actor,
    completedPracticals: [{ reference: issued.reference, submissionId: "needs-practice", observationId }] }), issued.reference);
  assert.deepEqual(await storedFiles(f.paths), before);
});


test("question preparation rechecks supplied current authority after the original pinned lesson read before its writer", async t => {
  const f = await fixture(t);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let current = true, checks = 0, writes = 0;
  const owner = createTrainingTeachingOwner({ learners: { ...f.learners,
    async saveLessonResume(...args) { writes++; return f.learners.saveLessonResume(...args); }
  }, content: { ...f.content, async readLesson(...args) {
    const lesson = await f.content.readLesson(...args);
    entered.resolve(); await release.promise; return lesson;
  } } });
  const before = await storedFiles(f.paths);
  const pending = owner.prepareQuestion(f.input, { async requireCurrent() {
    checks++; if (!current) throw new Error("The actual teaching admission was retired");
  } });
  await entered.promise;
  current = false; release.resolve();
  await assert.rejects(pending, /actual teaching admission was retired/);
  assert.equal(checks, 1);
  assert.equal(writes, 0);
  assert.deepEqual(await storedFiles(f.paths), before);
  const issued = await f.owner.prepareQuestion(f.input);
  assert.equal(issued.replayed, false, "the original unconfigured caller retains its preparation path");
  const replayBefore = await storedFiles(f.paths);
  await assert.rejects(owner.prepareQuestion({ ...f.input, expectedRevision: 0 }, {
    async requireCurrent() { checks++; throw new Error("The replay admission was retired"); }
  }), /replay admission was retired/);
  assert.equal(checks, 2);
  assert.equal(writes, 0);
  assert.deepEqual(await storedFiles(f.paths), replayBefore);
});

test("question preparation checks the actual supplied abort signal after an awaited authority refresh", async t => {
  const f = await fixture(t);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = new AbortController();
  let writes = 0;
  const owner = createTrainingTeachingOwner({ learners: { ...f.learners,
    async saveLessonResume(...args) { writes++; return f.learners.saveLessonResume(...args); }
  }, content: f.content });
  const before = await storedFiles(f.paths);
  const pending = owner.prepareQuestion(f.input, { signal: controller.signal, async requireCurrent() {
    entered.resolve(); await release.promise;
  } });
  const reached = await Promise.race([entered.promise.then(() => true), pending.then(() => false)]);
  assert.equal(reached, true, "the supplied current authority is checked before question persistence");
  controller.abort(new Error("The admitted native tool was stopped")); release.resolve();
  await assert.rejects(pending, /admitted native tool was stopped/);
  assert.equal(writes, 0);
  assert.deepEqual(await storedFiles(f.paths), before);
});
