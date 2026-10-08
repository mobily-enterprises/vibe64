import assert from "node:assert/strict";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { trainingTeachingFixture as fixture } from "../fixtures/trainingTeachingFixture.js";
import { createTrainingTeachingOwner } from "../../packages/vibe64-training/src/server/teaching.js";
import { createTrainingAnswerAssessment } from "../../packages/vibe64-training/src/server/answerAssessment.js";


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

test("source-less visual checkpoint uses exact saved learning scope and original writer without fabricating exercise preparation", async t => {
  const f = await fixture(t, { ready: false, exercise: false });
  const issued = await f.owner.prepareQuestion(f.input);
  const savedScope = await f.learners.readLearningSessionScope({ actor: f.actor, attemptId: f.attemptId });
  let refreshes = 0;
  const facilities = { learningScope: savedScope.scope, async requireCurrent() {
    refreshes++;
    const current = await f.learners.readLearningSessionScope({ actor: f.actor, attemptId: f.attemptId });
    assert.equal(current.active, true);
    assert.equal(current.activeSummaryCurrent, true);
    assert.deepEqual(current.scope, savedScope.scope);
  } };
  const input = { actor: f.actor, attemptId: f.attemptId, expectedRevision: 2,
    requestId: "learning-diagram", visualId: "request", snapshot: { state: "overview", paused: true, labels: {} } };
  assert.deepEqual(await f.owner.saveVisualCheckpoint(input, facilities), { revision: 3, replayed: false, unchanged: false });
  assert.deepEqual((await f.read()).active.preparation, { phase: "reserved" });
  assert.deepEqual(await f.owner.readQuestionReference({ actor: f.actor }), issued.reference);
  const before = await storedFiles(f.paths);
  assert.deepEqual(await f.owner.saveVisualCheckpoint({ ...input, expectedRevision: 0 }, facilities),
    { revision: 3, replayed: true, unchanged: false });
  assert.equal(refreshes, 4, "save and exact replay each refresh at Teaching admission and after the original Learner writer awaits");
  assert.deepEqual(await storedFiles(f.paths), before);
  await assert.rejects(f.owner.capturePractical({ actor: f.actor, reference: issued.reference }),
    { code: "VIBE64_TRAINING_PRACTICAL_UNAVAILABLE" });
  await assert.rejects(f.owner.saveVisualCheckpoint(input), { code: "VIBE64_TRAINING_PREPARATION_REQUIRED" });
});

test("source-less checkpoint refuses wrong trusted owner attempt pin and exercise scope without writes", async t => {
  const f = await fixture(t, { ready: false, exercise: false });
  const { scope } = await f.learners.readLearningSessionScope({ actor: f.actor, attemptId: f.attemptId });
  const input = { actor: f.actor, attemptId: f.attemptId, expectedRevision: 1,
    requestId: "learning-diagram", visualId: "request", snapshot: { state: "overview", paused: true, labels: {} } };
  const before = await storedFiles(f.paths);
  for (const learningScope of [{ ...scope, learnerId: "43" }, { ...scope, attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { ...scope, noExercise: false }, { ...scope, pin: { ...scope.pin, lesson: { ...scope.pin.lesson, hash: "b".repeat(64) } } }]) {
    await assert.rejects(f.owner.saveVisualCheckpoint(input, { learningScope, async requireCurrent() {} }),
      { code: "VIBE64_TRAINING_PREPARATION_REQUIRED" });
  }
  await assert.rejects(f.owner.saveVisualCheckpoint(input, { learningScope: scope }), /fresh exact session authority/);
  assert.deepEqual(await storedFiles(f.paths), before);
  const exercise = await fixture(t);
  const exerciseBefore = await storedFiles(exercise.paths);
  await assert.rejects(exercise.owner.saveVisualCheckpoint({ ...input, actor: exercise.actor, attemptId: exercise.attemptId,
    expectedRevision: 3 }, { learningScope: { learnerId: "42", attemptId: exercise.attemptId,
      pin: exercise.pin, noExercise: true }, async requireCurrent() {} }), { code: "VIBE64_TRAINING_PREPARATION_REQUIRED" });
  assert.deepEqual(await storedFiles(exercise.paths), exerciseBefore);
});

test("source-less checkpoint rechecks exact authority after pinned content and aborts before the original resume writer", async t => {
  const f = await fixture(t, { ready: false, exercise: false });
  const { scope } = await f.learners.readLearningSessionScope({ actor: f.actor, attemptId: f.attemptId });
  const input = { actor: f.actor, attemptId: f.attemptId, expectedRevision: 1,
    requestId: "learning-diagram", visualId: "request", snapshot: { state: "overview", paused: true, labels: {} } };
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let current = true, writes = 0;
  const owner = createTrainingTeachingOwner({ learners: { ...f.learners,
    async saveLessonResume(...args) { writes++; return f.learners.saveLessonResume(...args); }
  }, content: { ...f.content, async readLesson(...args) {
    const value = await f.content.readLesson(...args); entered.resolve(); await release.promise; return value;
  } } });
  const before = await storedFiles(f.paths);
  const pending = owner.saveVisualCheckpoint(input, { learningScope: scope, async requireCurrent() {
    if (!current) throw new Error("The saved learning session changed during content read");
  } });
  await entered.promise; current = false; release.resolve();
  await assert.rejects(pending, /saved learning session changed/);
  const controller = new AbortController();
  await assert.rejects(f.owner.saveVisualCheckpoint(input, { learningScope: scope, signal: controller.signal,
    async requireCurrent() { controller.abort(new Error("The checkpoint request was stopped")); }
  }), /checkpoint request was stopped/);
  assert.equal(writes, 0);
  assert.deepEqual(await storedFiles(f.paths), before);
});

test("actual source-less visual HTTP routes reuse saved learner Main scope and original checkpoint authority without a project", async t => {
  const f = await fixture(t, { ready: false, exercise: false });
  const [{ createTrainingLearningSessions }, { createTrainingTeachingBrief }, { Vibe64SessionRuntime },
    { currentProjectRequestContext }, { createActionCatalogue }, { registerVibe64ActionContext },
    { createTrainingVisualResourceActions, TRAINING_VISUAL_RESOURCE_ACTION },
    { registerTrainingVisualResourceRoutes }, { default: Fastify }] = await Promise.all([
    import("../../packages/vibe64-training/src/server/learningSessions.js"),
    import("../../packages/vibe64-training/src/server/teachingBrief.js"),
    import("../../packages/vibe64-runtime/src/server/runtime.js"),
    import("@local/vibe64-core/server/projectRequestContext"), import("@jskit-ai/kernel/server/actions"),
    import("@local/vibe64-core/server/actionContext"),
    import("../../packages/vibe64-training/src/server/visualResourceActions.js"),
    import("../../packages/vibe64-training/src/server/visualResourceRoutes.js"), import("fastify")
  ]);
  const saved = await f.learners.readLearningSessionScope({ actor: f.actor, attemptId: f.attemptId });
  const makeRuntime = context => new Vibe64SessionRuntime({ projectContextRoot: saved.systemRoot,
    projectRuntimeRoot: context.projectRuntimeRoot, learningScope: context.learningScope,
    inspectSourceByDefault: false });
  const own = makeRuntime({ projectRuntimeRoot: saved.projectRuntimeRoot, learningScope: saved.scope });
  const sessionId = `learning-${f.attemptId}`;
  await own.createSession({ sessionId });
  const learningSessions = createTrainingLearningSessions({ learners: f.learners,
    teachingBrief: createTrainingTeachingBrief({ learners: f.learners, content: f.content }),
    project: { createRuntime: async () => makeRuntime(currentProjectRequestContext()) },
    sessions: { createSession() { assert.fail("visual access never creates a conversation"); },
      inspectSession() { assert.fail("visual access never opens a teacher"); } } });
  let user = f.actor, projectAdmissions = 0;
  const contentGate = { entered: null, release: null };
  const checkpointTeaching = createTrainingTeachingOwner({ learners: f.learners, content: { ...f.content,
    async readLesson(input) {
      const result = await f.content.readLesson(input);
      contentGate.entered?.resolve();
      if (contentGate.release) await contentGate.release.promise;
      return result;
    } } });
  const actions = createActionCatalogue();
  actions.register({ contributorId: "visuals", domain: "training", actions: createTrainingVisualResourceActions({
    learners: f.learners, content: f.content, teaching: checkpointTeaching, actions }) });
  const { createLearningTeachingContextActions } = await import("../../packages/vibe64-sessions/src/server/actions.js");
  actions.register({ contributorId: "original-teaching-authority", domain: "sessions",
    actions: createLearningTeachingContextActions().map(action => ({ ...action, surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => user,
    resolveLearningContext: learningSessions.resolveContext,
    authorizeProject() { projectAdmissions++; throw Object.assign(new Error("Working project access refused."), { statusCode: 403 }); } });
  const server = Fastify(); t.after(() => server.close());
  server.decorateRequest("executeAction", function ({ actionId, input }) {
    return actions.execute({ actionId, input, context: { channel: "api", surface: this.routeOptions.config.surface,
      requestMeta: { request: this } } });
  });
  const registered = [];
  registerTrainingVisualResourceRoutes({ router: { register(method, url, options, handler) {
    registered.push({ method, url }); server.route({ method, url, config: { surface: options.surface }, handler });
  } } }, { learningScoped: true });
  registerTrainingVisualResourceRoutes({ router: { register(method, url, options, handler) {
    registered.push({ method, url }); server.route({ method, url, config: { surface: options.surface }, handler });
  } } });
  assert.deepEqual(registered.map(route => route.method), ["POST", "GET", "POST", "GET"]);
  const url = `/api/learning/${f.attemptId}/vibe64/sessions/${sessionId}/training/visuals/request`;
  const originalSession = await own.store.readSession(sessionId);
  const before = await storedFiles(f.paths);
  const resource = await server.inject({ method: "GET", url });
  assert.equal(resource.statusCode, 200, resource.body);
  assert.equal(resource.headers["cache-control"], "private, no-store");
  assert.equal(resource.json().lessonHash, f.pin.lesson.hash);
  assert.equal(Buffer.from(resource.json().controller.bytes, "base64").toString(), 'throw new Error("VISUAL_MUST_NOT_EXECUTE");');
  assert.deepEqual(await storedFiles(f.paths), before);
  const payload = { expectedRevision: 1, requestId: "actual-learning-checkpoint",
    attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sessionId: "forged-session", visualId: "forged-visual",
    snapshot: { state: "overview", paused: true, labels: {} } };
  const checkpoint = await server.inject({ method: "POST", url, payload });
  assert.equal(checkpoint.statusCode, 200, checkpoint.body);
  assert.deepEqual(checkpoint.json(), { revision: 2, replayed: false, unchanged: false });
  const after = await storedFiles(f.paths);
  const replay = await server.inject({ method: "POST", url, payload });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), { revision: 2, replayed: true, unchanged: false });
  assert.deepEqual(await storedFiles(f.paths), after);
  assert.deepEqual((await f.read()).active.preparation, { phase: "reserved" });
  assert.deepEqual((await server.inject({ method: "GET", url })).json().snapshot, payload.snapshot);
  const conflict = await server.inject({ method: "POST", url, payload: { ...payload, snapshot: { ...payload.snapshot, paused: false } } });
  assert.equal(conflict.statusCode, 409, conflict.body);
  const stale = await server.inject({ method: "POST", url, payload: { ...payload, requestId: "stale-learning-checkpoint",
    snapshot: { ...payload.snapshot, state: "arrived" } } });
  assert.equal(stale.json().code, "VIBE64_TRAINING_STATE_REVISION_CONFLICT");
  assert.notEqual((await server.inject({ method: "POST", url, payload: { ...payload, projectSlug: "working" } })).statusCode, 200);
  assert.notEqual((await server.inject({ method: "GET", url: url.replace(sessionId, "unknown-session") })).statusCode, 200);
  assert.notEqual((await server.inject({ method: "GET", url: url.replace("/visuals/request", "/visuals/missing") })).statusCode, 200);
  await assert.rejects(actions.execute({ actionId: TRAINING_VISUAL_RESOURCE_ACTION,
    input: { learningAttemptId: f.attemptId, attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sessionId, visualId: "request" },
    context: { channel: "api", surface: "app", requestMeta: { request: {} } } }));
  user = { uid: 43, username: "bob" };
  assert.notEqual((await server.inject({ method: "GET", url })).statusCode, 200);
  assert.notEqual((await server.inject({ method: "POST", url, payload })).statusCode, 200);
  user = null;
  assert.equal((await server.inject({ method: "GET", url })).statusCode, 401);
  user = f.actor;
  assert.deepEqual(await storedFiles(f.paths), after);
  assert.deepEqual(await own.store.readSession(sessionId), originalSession, "resource/checkpoint access does not rewrite native session or source facts");
  assert.equal(projectAdmissions, 0);
  for (const changedActor of [null, { uid: 43, username: "bob" }]) {
    contentGate.entered = Promise.withResolvers(); contentGate.release = Promise.withResolvers();
    const saving = server.inject({ method: "POST", url, payload: { ...payload, expectedRevision: 2,
      requestId: changedActor ? "account-switched-during-read" : "logged-out-during-read",
      snapshot: { ...payload.snapshot, state: "arrived" } } });
    await contentGate.entered.promise;
    user = changedActor; contentGate.release.resolve();
    const refused = await saving;
    assert.notEqual(refused.statusCode, 200, refused.body);
    if (!changedActor) assert.equal(refused.statusCode, 401, refused.body);
    assert.deepEqual(await storedFiles(f.paths), after, "fresh original account contributor refuses a write after held content");
    user = f.actor; contentGate.entered = null; contentGate.release = null;
  }
  const legacySpoof = await server.inject({ method: "POST", url: `/api/vibe64/training/attempts/${f.attemptId}/visuals/request`,
    payload: { ...payload, learningAttemptId: f.attemptId, sessionId, projectSlug: "working" } });
  assert.equal(legacySpoof.statusCode, 403, legacySpoof.body);
  assert.equal(projectAdmissions, 1, "a legacy URL retains Working authority instead of accepting a body learning scope");
  assert.deepEqual(await storedFiles(f.paths), after);
  await f.learners.endAttempt({ actor: f.actor, attemptId: f.attemptId, expectedRevision: 2, requestId: "end-after-visual", reason: "restart" });
  assert.notEqual((await server.inject({ method: "POST", url, payload })).statusCode, 200);
});

// Main consumes the original installed-content, learner and question fixture.
// Native/Helper responses here are controlled owner contracts, not logged-in model acceptance.
async function mainTeachingFixture(t) {
  const f = await fixture(t, { ready: false, exercise: false });
  const { createActionCatalogue } = await import("@jskit-ai/kernel/server/actions");
  const { createServiceToolCatalog } = await import("@jskit-ai/assistant-core/server");
  const { registerVibe64ActionContext } = await import("@local/vibe64-core/server/actionContext");
  const { Vibe64SessionRuntime } = await import("@local/vibe64-runtime/server");
  const { createTrainingLearningSessions } = await import("../../packages/vibe64-training/src/server/learningSessions.js");
  const { createTrainingTeachingBrief } = await import("../../packages/vibe64-training/src/server/teachingBrief.js");
  const { createTrainingMainTeaching } = await import("../../packages/vibe64-training/src/server/mainTeaching.js");
  const { createTrainingActions } = await import("../../packages/vibe64-training/src/server/actions.js");
  const { createTrainingTeachingActions } = await import("../../packages/vibe64-training/src/server/teachingActions.js");
  const { createTrainingAssessmentActions } = await import("../../packages/vibe64-training/src/server/assessmentActions.js");
  const { createSessionActions, createLearningTeachingContextActions } = await import("../../packages/vibe64-sessions/src/server/actions.js");
  const { defineVibe64AgentExecutionProfileResolution, VIBE64_AGENT_HELPER_WORKLOAD_LIMITS } = await import("@local/vibe64-runtime/shared");
  const saved = await f.learners.readLearningSessionScope({ actor: f.actor, attemptId: f.attemptId });
  const assessment = createTrainingAnswerAssessment({ learners: f.learners, content: f.content, teaching: f.owner });
  const main = createTrainingMainTeaching({ teaching: f.owner, assessment });
  const runtime = new Vibe64SessionRuntime({ projectContextRoot: path.resolve(f.snapshotRoot, "../../../../.."),
    projectRuntimeRoot: saved.projectRuntimeRoot, learningScope: saved.scope, learningTeaching: main,
    learningInstructions: async () => "Teach the pinned lesson.",
    promptRenderer: () => assert.fail("Main teaching does not manufacture a source project") });
  const sessionId = `learning-${f.attemptId}`;
  const selection = { engineId: "codex", agentId: "codex", modelProviderId: "openai", modelId: "gpt-5.5",
    variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
  await runtime.createSession({ sessionId, metadata: { assistant_selection: JSON.stringify(selection) } });
  const brief = createTrainingTeachingBrief({ learners: f.learners, content: f.content });
  const learningSessions = createTrainingLearningSessions({ learners: f.learners, teachingBrief: brief, learningTeaching: main,
    project: { createRuntime: async () => runtime }, sessions: { createSession() {}, inspectSession() {} } });
  const auth = { user: f.actor, afterResolve: null };
  const actions = createActionCatalogue();
  const definitions = [...createTrainingActions({ catalogue: { readCatalogue() {} }, learners: f.learners, teachingBrief: brief }),
    ...createTrainingTeachingActions({ mainTeaching: main }),
    ...createTrainingAssessmentActions({ mainTeaching: main }).filter(action => action.id === "vibe64.training.answer.evaluate"),
    createSessionActions({ sessions: {} }).find(action => action.id === "vibe64.sessions.conversation.context.read"),
    ...createLearningTeachingContextActions()];
  actions.register({ contributorId: "actual-training-main", domain: "training", actions: definitions.map(action => ({
    ...action, channels: action.channels || ["api", "automation", "internal"], surfaces: ["app"]
  })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => auth.user,
    authorizeProject: () => assert.fail("No-exercise teaching must not borrow a project ACL"),
    async resolveLearningContext(input) {
      const context = await learningSessions.resolveContext(input);
      auth.afterResolve?.(input);
      return context;
    } });
  const requestContext = { channel: "internal", surface: "app",
    requestMeta: { request: { params: { learningAttemptId: f.attemptId }, vibe64User: f.actor } } };
  const controller = new AbortController();
  const current = { runtime, sessionId, assistantSelection: selection, signal: controller.signal,
    browserAuthority: { sessionId, learningAttemptId: f.attemptId, actorId: "42", requestContext } };
  const helperCalls = [], controls = { failCleanup: false, helperWait: null, onHelper: null, current: true };
  const terminals = {
    async requireAssistantSelectionAccess(value, options) {
      assert.deepEqual(value, selection);
      assert.equal(options.vibe64User.uid, 42);
    },
    async resolveAssistantPurpose(input, options) {
      assert.equal(input.purpose, "training_assessment");
      assert.equal(input.workflowEngineId, "codex");
      assert.equal(options.vibe64User.uid, 42);
      return { available: true, effectiveSelection: selection, connectionIdentity: "configured-helper-account" };
    },
    async resolveEphemeralAgentExecutionProfile(_scope, input, options) {
      assert.equal(options.expectedConnectionIdentity, "configured-helper-account");
      return defineVibe64AgentExecutionProfileResolution({ ...input, providerId: "codex", revision: "helper-v1", model: "helper", thinking: "low",
        limits: VIBE64_AGENT_HELPER_WORKLOAD_LIMITS.training_assessment,
        policy: { tools: "none", environmentAccess: false, networkAccess: false, repositoryWrite: false },
        request: { allowProviderModelFallback: false, reasoning: true, summary: false } });
    },
    async runEphemeralAgentChatTurn(scope, input, options) {
      helperCalls.push({ scope, input, options });
      const log = await runtime.store.readConversationLog(sessionId);
      assert.equal(log.at(-1).metadata.trainingHelper.scope.id, scope.id, "new Helper receipt belongs to this exact admitted answer turn");
      controls.onHelper?.();
      await controls.helperWait;
      for (const event of [{ type: "thread", threadId: "helper-thread" }, { type: "turn", turnId: "helper-turn" },
        { type: "helper-execution", executionId: "helper-execution" }]) await options.onEvent(event);
      return { ok: true, status: "completed", text: JSON.stringify({ outcome: "passed", explanation: "Identifies Preview." }) };
    },
    async deleteEphemeralAgentConversation(_scope, input) {
      assert.equal(input.executionProfile.policy.tools, "none");
      return controls.failCleanup ? { ok: false, error: "Helper cleanup uncertain." } : { ok: true };
    }
  };
  const target = { threadId: "main-native-thread", turnId: "native-question-turn", outerTurnId: "ask-question",
    active: true, assistantSelection: selection };
  const bound = main.bindConversation({ runtime, sessionId, actions, terminals, native: { readTurn: async () => ({ ...target }) } });
  const tools = createServiceToolCatalog(actions, { isActionAvailable: ({ actionId, context }) => Boolean(context.runtime?.learningScope &&
    context.runtime.learningTeaching?.actionIds.includes(actionId)) });
  async function admit(messageId, text, data) {
    const row = await runtime.store.writeConversationUserMessage(sessionId, { messageId, text, data });
    return Object.freeze({ conversationId: sessionId, turnId: row.turnId, messageId, nativeTurnId: target.turnId,
      nativeThreadId: target.threadId, origin: "user", assertCurrent() {
        if (!controls.current) throw new Error("The original accepted request retired.");
        controller.signal.throwIfAborted();
      } });
  }
  async function execute(admitted, actionId, input) {
    const mapped = await bound.applicationTools.prepareContext(current, admitted);
    const context = { ...mapped, signal: controller.signal };
    return actions.execute({ actionId, input, context });
  }
  const admitted = await admit("ask-question", "Teach this lesson.");
  return { ...f, main, runtime, sessionId, target, current, bound, actions, auth, controls, controller, helperCalls, tools, admit, execute, admitted };
}

async function deliveredMainQuestion(f) {
  const { actor: _actor, ...input } = f.input;
  const prepared = await f.execute(f.admitted, "vibe64.training.question.prepare", input);
  assert.equal(prepared.delivery, "prepared");
  assert.equal(await f.main.readQuestion({ runtime: f.runtime, sessionId: f.sessionId, context: f.current, actions: f.actions }), null);
  await f.runtime.store.writeConversationAssistantMessage(f.sessionId, { text: prepared.questionText, outputId: "actual-question-output" });
  f.target.active = false;
  await f.main.completeConversation({ runtime: f.runtime, sessionId: f.sessionId, outerTurnId: f.target.outerTurnId,
    nativeTurn: f.target, outcome: "completed" });
  assert.deepEqual(await f.main.readQuestion({ runtime: f.runtime, sessionId: f.sessionId, context: f.current, actions: f.actions }), prepared.reference);
  return prepared;
}

test("Main teaching composes the exact original four-action discovery and stages only its accepted native tuple", async t => {
  const f = await mainTeachingFixture(t);
  const mapped = await f.bound.applicationTools.prepareContext(f.current, f.admitted);
  const set = f.tools.resolveToolSet(mapped, { discoveryOnly: true });
  const search = await f.tools.executeToolCall({ toolName: "assistant_action_search", toolSet: set, context: mapped, argumentsText: "{}" });
  assert.equal(search.ok, true, JSON.stringify(search));
  assert.deepEqual(search.result.items.map(item => item.actionId).sort(), [...f.main.actionIds].sort());
  assert.equal(f.tools.resolveToolSet({ channel: "internal", surface: "app" }).tools.length, 0);
  await assert.rejects(f.execute(f.admitted, "vibe64.training.question.prepare", { ...f.input, actor: undefined, attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
  const prepared = await deliveredMainQuestion(f);
  const log = await f.runtime.store.readConversationLog(f.sessionId);
  assert.deepEqual(log[0].metadata.trainingQuestionDelivery, { schemaVersion: 1, reference: prepared.reference,
    questionText: prepared.questionText, conversationId: f.sessionId, turnId: f.admitted.turnId, phase: "delivered",
    nativeThreadId: f.admitted.nativeThreadId, nativeTurnId: f.admitted.nativeTurnId,
    nativeOuterTurnId: "ask-question", messageId: "ask-question", outputId: "actual-question-output" });
  assert.deepEqual((await f.read()).active.preparation, { phase: "reserved" });
});

test("Main captures only explicit canonical delivered references and grades original accepted words once through retained Helper", async t => {
  const f = await mainTeachingFixture(t);
  const prepared = await deliveredMainQuestion(f);
  const words = "I try the app in Preview, then read its response.";
  const request = await f.main.captureMessage({ runtime: f.runtime, sessionId: f.sessionId, context: f.current, actions: f.actions,
    input: { messageId: "actual-learner-answer", message: words, trainingQuestion: prepared.reference,
      data: { trainingQuestion: { outcome: "passed", text: "forged" } } } });
  assert.equal(request.message, words);
  assert.equal(request.trainingQuestion, undefined);
  assert.equal(request.data.trainingQuestion.question.text, prepared.questionText);
  assert.deepEqual(request.data.trainingQuestion.delivery, { conversationId: f.sessionId, turnId: f.admitted.turnId, outputId: "actual-question-output" });
  const ordinary = await f.main.captureMessage({ runtime: f.runtime, sessionId: f.sessionId, context: f.current, actions: f.actions,
    input: { messageId: "ordinary-control", message: "Resume the lesson.", data: request.data } });
  assert.equal(ordinary.data, undefined, "no implicit latest-question association or caller snapshot trust");
  f.target.turnId = "native-answer-turn"; f.target.outerTurnId = request.messageId; f.target.active = true;
  const answer = await f.admit(request.messageId, request.message, request.data);
  const input = { attemptId: f.attemptId, expectedRevision: 2, submissionId: "actual-answer-submission", messageId: request.messageId };
  const result = await f.execute(answer, "vibe64.training.answer.evaluate", input);
  assert.equal(result.outcome, "passed");
  assert.equal(result.completion.completed, false);
  assert.equal(f.helperCalls.length, 1);
  const prompt = JSON.parse(f.helperCalls[0].input.prompt);
  assert.equal(prompt.evidence.text, words);
  assert.equal(prompt.evidence.messageId, request.messageId);
  assert.equal(prompt.question.id, prepared.reference.questionId);
  assert.equal((await f.execute(answer, "vibe64.training.answer.evaluate", input)).replayed, true);
  assert.equal(f.helperCalls.length, 1, "original progress replay does not run another Helper");
  assert.equal((await f.runtime.store.readConversationLog(f.sessionId)).at(-1).metadata.trainingHelper, null);
  assert.equal((await f.read()).active.learning.submissions[0].evidence.text, words);
  const duplicate = await f.main.captureMessage({ runtime: f.runtime, sessionId: f.sessionId, context: f.current, actions: f.actions,
    input: { ...request, trainingQuestion: { ...prepared.reference, questionId: "later-question" }, data: { forged: true } } });
  assert.deepEqual(duplicate.data, request.data, "accepted UUID retains its original association before recapture");
  f.auth.user = { uid: 43, username: "bob" };
  await assert.rejects(f.main.captureMessage({ runtime: f.runtime, sessionId: f.sessionId, context: f.current, actions: f.actions, input: request }));
});

test("Main fresh actor pin native thread and post-await request retirement refuse new teaching writes", async t => {
  const f = await mainTeachingFixture(t);
  const before = await storedFiles(f.paths);
  const original = { ...f.target };
  for (const change of [{ threadId: "foreign-thread" }, { turnId: "retired-native-turn" },
    { assistantSelection: { ...f.target.assistantSelection, modelId: "different-account-selection" } }, { active: false }]) {
    Object.assign(f.target, original, change);
    await assert.rejects(f.bound.applicationTools.prepareContext(f.current, f.admitted), { code: "VIBE64_TRAINING_MAIN_UNADMITTED" });
  }
  Object.assign(f.target, original);
  let resolves = 0;
  f.auth.afterResolve = () => { if (++resolves === 2) f.controls.current = false; };
  await assert.rejects(f.bound.applicationTools.prepareContext(f.current, f.admitted), /accepted request retired/u);
  assert.deepEqual(await storedFiles(f.paths), before);
  f.auth.afterResolve = null; f.controls.current = true; f.auth.user = null;
  await assert.rejects(f.bound.applicationTools.prepareContext(f.current, f.admitted), { code: "vibe64_auth_required" });
  assert.deepEqual(await storedFiles(f.paths), before);
});

test("Main Helper interruption retains accepted answer and drains cleanup without awarding progress", async t => {
  const f = await mainTeachingFixture(t);
  const prepared = await deliveredMainQuestion(f);
  const request = await f.main.captureMessage({ runtime: f.runtime, sessionId: f.sessionId, context: f.current, actions: f.actions,
    input: { messageId: "interrupted-answer", message: "I use Preview.", trainingQuestion: prepared.reference } });
  f.target.turnId = "native-interrupted-answer"; f.target.outerTurnId = request.messageId; f.target.active = true;
  const admitted = await f.admit(request.messageId, request.message, request.data);
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  f.controls.onHelper = () => started.resolve(); f.controls.helperWait = release.promise;
  const grading = f.execute(admitted, "vibe64.training.answer.evaluate", { attemptId: f.attemptId, expectedRevision: 2,
    submissionId: "interrupted-submission", messageId: request.messageId });
  const refused = assert.rejects(grading);
  await started.promise;
  f.controller.abort(new Error("Original Main Stop")); release.resolve();
  await refused;
  await f.main.cleanupConversation({ runtime: f.runtime, sessionId: f.sessionId, terminals: {}, context: f.current });
  const log = await f.runtime.store.readConversationLog(f.sessionId);
  assert.equal(log.at(-1).user.text, request.message);
  assert.equal(log.at(-1).metadata.trainingHelper, null);
  assert.deepEqual((await f.read()).active.learning.submissions, []);
});

test("Main question delivery requires matching completed native owner exact final output and latest accepted message", async t => {
  for (const boundary of ["active", "foreign-thread", "foreign-turn", "foreign-outer", "commentary", "wrong-final", "cancelled", "successor"]) {
    const f = await mainTeachingFixture(t);
    const { actor: _actor, ...input } = f.input;
    const prepared = await f.execute(f.admitted, "vibe64.training.question.prepare", input);
    if (boundary === "commentary") await f.runtime.store.writeConversationCommentaryMessage(f.sessionId, { text: prepared.questionText, outputId: "commentary" });
    else await f.runtime.store.writeConversationAssistantMessage(f.sessionId, { text: boundary === "wrong-final" ? "Not the exact question." : prepared.questionText,
      outputId: "native-final-output" });
    const target = { ...f.target, active: boundary === "active" };
    if (boundary === "foreign-thread") target.threadId = "different-thread";
    if (boundary === "foreign-turn") target.turnId = "different-turn";
    if (boundary === "foreign-outer") target.outerTurnId = "different-outer";
    if (boundary === "successor") await f.runtime.store.writeConversationUserMessage(f.sessionId, { messageId: "newer-user", text: "Stop that question." });
    await f.main.completeConversation({ runtime: f.runtime, sessionId: f.sessionId, outerTurnId: f.target.outerTurnId, nativeTurn: target,
      outcome: boundary === "cancelled" ? "cancelled" : "completed" });
    const log = await f.runtime.store.readConversationLog(f.sessionId);
    assert.equal(log[0].metadata.trainingQuestionDelivery.phase, "prepared", boundary);
    assert.equal(await f.main.readQuestion({ runtime: f.runtime, sessionId: f.sessionId, context: f.current, actions: f.actions }), null, boundary);
  }
});
