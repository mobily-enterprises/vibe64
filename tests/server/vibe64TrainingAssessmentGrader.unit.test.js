import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingAssessmentGrader } from "../../packages/vibe64-training/src/server/assessmentGrader.js";
import { createTrainingAnswerAssessment } from "../../packages/vibe64-training/src/server/answerAssessment.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingTeachingOwner } from "../../packages/vibe64-training/src/server/teaching.js";
import { createConversationSummary } from "../../packages/vibe64-colleague/src/server/conversationSummary.js";
import { writeJsonFileAtomic } from "../../packages/vibe64-core/src/server/projectRecordMetadata.js";
import { defineVibe64AgentExecutionProfileResolution, VIBE64_AGENT_HELPER_WORKLOAD_LIMITS } from "../../packages/vibe64-runtime/src/shared/agentExecutionProfiles.js";
import { codexAppServerHelperTurnSettings } from "../../packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-assessment-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), systemRoot = path.join(root, "system");
  await mkdir(source);
  const lesson = { schemaVersion: 1, code: "USE-ONE", title: "Try an application", document: "lesson.md",
    prerequisites: [], estimatedMinutes: 5, visuals: [], exercise: { kind: "bundled", source: "app", reuse: "attempt" },
    checks: [{ id: "response", file: "check.mjs" }], assessments: [
      { id: "explain", kind: "answer", required: true, rubric: "lesson.md#explain" },
      { id: "try", kind: "practical", required: true, rubric: "lesson.md#try", evidence: {
        producer: "exercise", operation: "use-button", check: "response", explanationRequired: true } }
    ] };
  const document = "# Try an application\n<a id=\"explain\"></a>\nExplain using Preview to try the running app.\n<a id=\"try\"></a>\nPress the actual button and explain the displayed response.\n";
  await writeFile(path.join(source, "package.json"), JSON.stringify({ name: "learn-grading", version: "0.1.0",
    repository: { type: "git", url: "https://github.com/examples/learn-grading.git" }, vibe64Training: { schemaVersion: 1, topicId: "grading",
      domainId: "vibe64", title: "Grading", status: "preview", outline: "outline.md", prerequisites: [], lessons: [
        { code: lesson.code, descriptor: "lesson.json", status: "published", required: true }
      ] } }));
  await writeFile(path.join(source, "outline.md"), "# One introduction\n");
  await writeFile(path.join(source, "lesson.json"), JSON.stringify(lesson));
  await writeFile(path.join(source, "lesson.md"), document);
  await mkdir(path.join(source, "app"));
  await writeFile(path.join(source, "app/server.mjs"), 'throw new Error("EXERCISE_MUST_NOT_EXECUTE");');
  await writeFile(path.join(source, "check.mjs"), 'throw new Error("CHECK_MUST_NOT_EXECUTE");');
  const commit = "a".repeat(40), snapshot = path.join(systemRoot, "training/content/grading", commit);
  await mkdir(path.dirname(snapshot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshot, "bundle.json"), "utf8"));
  const topic = { schemaVersion: 1, topicId: "grading", release: "0.1.0", repository: "examples/learn-grading", commit, topicHash: bundle.topicHash };
  await writeFile(path.join(snapshot, "pin.json"), JSON.stringify(topic));
  const pin = { course: { courseId: "intro", release: "0.1.0" }, topic, lesson: { code: lesson.code, hash: bundle.lessons[0].hash } };
  const user = { uid: 42, username: "alice", role: "member" };
  const context = { requestMeta: { request: { vibe64User: user } } };
  const state = { root: path.join(root, "colleague"), record: { summaryHelper: null }, summaryAbort: new AbortController() };
  await mkdir(state.root);
  const saved = path.join(state.root, "record.json"), calls = [];
  let answer = JSON.stringify({ outcome: "passed", explanation: "The learner identified Preview as the place to try the app." });
  let available = true, cleanupFails = false, runFailure = false;
  const selection = { engineId: "codex", modelProviderId: "openai", modelId: "helper" };
  const terminals = {
    async resolveAssistantPurpose(input, options) {
      calls.push({ purpose: input });
      assert.equal(options.vibe64User, user);
      return { available, effectiveSelection: selection, connectionIdentity: "account-42" };
    },
    async resolveEphemeralAgentExecutionProfile(scope, input, options) {
      assert.equal(input.workloadId, "training_assessment");
      assert.equal(options.expectedConnectionIdentity, "account-42");
      assert.deepEqual(options.assistantSelection, selection);
      return defineVibe64AgentExecutionProfileResolution({ ...input, providerId: "codex", revision: "helper-v1", model: "helper", thinking: "low",
        limits: VIBE64_AGENT_HELPER_WORKLOAD_LIMITS.training_assessment,
        policy: { tools: "none", environmentAccess: false, networkAccess: false, repositoryWrite: false },
        request: { allowProviderModelFallback: false, reasoning: true, summary: false } });
    },
    async runEphemeralAgentChatTurn(scope, input, options) {
      calls.push({ run: { scope, input } });
      assert.deepEqual(JSON.parse(await readFile(saved, "utf8")).summaryHelper.scope, scope);
      codexAppServerHelperTurnSettings({ cwd: scope.workdir, executionProfile: input.executionProfile, outputSchema: input.outputSchema });
      for (const event of [{ type: "thread", threadId: "thread-42" }, { type: "turn", turnId: "turn-42" }, { type: "helper-execution", executionId: "execution-42" }]) await options.onEvent(event);
      assert.equal(JSON.parse(await readFile(saved, "utf8")).summaryHelper.executionId, "execution-42");
      if (runFailure) throw new Error("Provider failed.");
      return { ok: true, status: "completed", text: answer };
    },
    async deleteEphemeralAgentConversation(scope, input, options) {
      calls.push({ cleanup: { scope, input, options } });
      assert.deepEqual(options.assistantSelection, selection);
      return cleanupFails ? { ok: false, error: "Cleanup uncertain." } : { ok: true };
    }
  };
  const helper = createConversationSummary({ terminals, workflowEngineId: async () => "codex",
    persist: async value => writeJsonFileAtomic(saved, value.record) });
  const grader = createTrainingAssessmentGrader({ content: createInstalledTrainingContent({ systemRoot }), helper });
  const input = { pin, assessmentId: "explain", question: { id: "q-one", assessmentId: "explain", text: "Where do you try the app?" },
    evidence: { kind: "answer", learnerId: "42", attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", messageId: "actual-admitted-42", questionId: "q-one", text: "I use Preview." } };
  return { root, snapshot, saved, state, calls, grader, helper, context, input,
    setAnswer(value) { answer = value; }, setAvailable(value) { available = value; }, setCleanupFails(value) { cleanupFails = value; }, setRunFailure(value) { runFailure = value; } };
}

test("grading uses installed rubric and original retained tool-free Helper account/profile/cleanup", async t => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.snapshot, "bundle.json"));
  assert.equal((await f.grader.grade(f.state, f.input, f.context)).outcome, "passed");
  const run = f.calls.find(value => value.run).run;
  const prompt = JSON.parse(run.input.prompt);
  assert.equal(prompt.evidence.messageId, "actual-admitted-42");
  assert.equal(prompt.question.id, "q-one");
  assert.match(prompt.assessment.rubric, /using Preview/);
  assert.doesNotMatch(prompt.assessment.rubric, /actual button/);
  assert.equal(f.state.record.summaryHelper, null);
  assert.equal(JSON.parse(await readFile(f.saved, "utf8")).summaryHelper, null);
  const cleanup = f.calls.find(value => value.cleanup).cleanup;
  assert.equal(cleanup.input.conversationId, "thread-42");
  assert.equal(cleanup.input.cleanupExecutionId, "execution-42");
  await assert.rejects(access(path.dirname(run.scope.workdir)), { code: "ENOENT" });
  assert.deepEqual(await readFile(path.join(f.snapshot, "bundle.json")), before);
  assert.equal(Object.hasOwn(f.state.record, "learning"), false);
});

test("grading refuses stale pin, undeclared assessment and mismatched admitted question before Helper inference", async t => {
  const f = await fixture(t);
  await assert.rejects(f.grader.grade(f.state, { ...f.input, pin: { ...f.input.pin, lesson: { ...f.input.pin.lesson, hash: "b".repeat(64) } } }, f.context), /hash changed/);
  await assert.rejects(f.grader.grade(f.state, { ...f.input, assessmentId: "invented" }, f.context), /exact installed lesson/);
  await assert.rejects(f.grader.grade(f.state, { ...f.input, question: { ...f.input.question, id: "q-other" } }, f.context), /saved question/);
  await assert.rejects(f.grader.grade(f.state, { ...f.input, evidence: { ...f.input.evidence, origin: "demonstration" } }, f.context), /saved question/);
  await assert.rejects(f.grader.grade(f.state, { ...f.input, evidence: { ...f.input.evidence, text: "x".repeat(2049) } }, f.context));
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.record.summaryHelper, null);
});

test("practical grades require declared exact check result and cannot pass demonstrations or failed checks", async t => {
  const f = await fixture(t);
  const observation = { pin: f.input.pin, assessmentId: "try", evidence: { kind: "observation", learnerId: "42", attemptId: f.input.evidence.attemptId,
    text: "The button displayed a greeting.", observationId: "observed-42", observedAt: new Date().toISOString(),
    projectSlug: "practice", sessionId: "2026-10-07_00-00-00", producer: "exercise", operation: "use-button", origin: "learner", check: "response" },
    checkResult: { check: "response", observationId: "observed-42", outcome: "passed" } };
  await assert.rejects(f.grader.grade(f.state, { ...observation, checkResult: undefined }, f.context), /check owner/);
  await assert.rejects(f.grader.grade(f.state, { ...observation, checkResult: { ...observation.checkResult, observationId: "other" } }, f.context), /check owner/);
  await assert.rejects(f.grader.grade(f.state, { ...observation, evidence: { ...observation.evidence, operation: "invented" } }, f.context), /installed practical/);
  assert.equal((await f.grader.grade(f.state, { ...observation, evidence: { ...observation.evidence, origin: "demonstration" } }, f.context)).outcome, "not-yet-passed");
  assert.equal((await f.grader.grade(f.state, { ...observation, checkResult: { ...observation.checkResult, outcome: "not-yet-passed" } }, f.context)).outcome, "not-yet-passed");
  assert.equal(f.calls.length, 0);
  assert.equal((await f.grader.grade(f.state, observation, f.context)).outcome, "passed");
});

test("invalid or oversized model output and substantial assistance never return a pass", async t => {
  const f = await fixture(t);
  for (const response of ["not JSON", '{}', '{"outcome":"passed","explanation":" "}', '{"outcome":"passed","explanation":"yes","extra":true}', JSON.stringify({ outcome: "passed", explanation: "x".repeat(1025) }), "x".repeat(8193)]) {
    f.setAnswer(response);
    await assert.rejects(f.grader.grade(f.state, f.input, f.context));
    assert.equal(f.state.record.summaryHelper, null);
  }
  f.setAnswer(JSON.stringify({ outcome: "passed", explanation: "The supplied answer meets the rubric." }));
  assert.equal((await f.grader.grade(f.state, { ...f.input, assistance: "substantial" }, f.context)).outcome, "needs-review");
  assert.equal((await f.grader.grade(f.state, { ...f.input, assistance: "hint" }, f.context)).outcome, "passed");
});

test("unavailable Helper and uncertain cleanup retain native recovery ownership and no grading result", async t => {
  const f = await fixture(t);
  f.setAvailable(false);
  await assert.rejects(f.grader.grade(f.state, f.input, f.context), { code: "vibe64_colleague_helper_unavailable" });
  assert.equal(f.calls.some(value => value.run), false);
  f.setAvailable(true);
  f.setRunFailure(true);
  f.setCleanupFails(true);
  await assert.rejects(f.grader.grade(f.state, f.input, f.context), /Cleanup uncertain/);
  const retained = structuredClone(f.state.record.summaryHelper);
  assert.equal(JSON.parse(await readFile(f.saved, "utf8")).summaryHelper.executionId, "execution-42");
  const runs = f.calls.filter(value => value.run).length;
  await assert.rejects(f.grader.grade(f.state, f.input, f.context), /Cleanup uncertain/);
  assert.equal(f.calls.filter(value => value.run).length, runs, "retained cleanup blocks another Helper");
  assert.deepEqual(f.state.record.summaryHelper, retained);
  f.setCleanupFails(false);
  f.setRunFailure(false);
  assert.equal((await f.grader.grade(f.state, f.input, f.context)).outcome, "passed");
  assert.equal(f.state.record.summaryHelper, null);
});

async function answerFixture(t) {
  const f = await fixture(t);
  const actor = f.context.requestMeta.request.vibe64User;
  const learners = createTrainingLearnerState({ systemRoot: path.join(f.root, "system") });
  const content = createInstalledTrainingContent({ systemRoot: path.join(f.root, "system") });
  const teaching = createTrainingTeachingOwner({ learners, content });
  const reserved = await learners.reserveAttempt({ actor, requestId: "start", expectedRevision: 0, pin: f.input.pin });
  const attemptId = reserved.attempt.attemptId;
  await learners.beginPreparation({ actor, attemptId, expectedRevision: 1 });
  await learners.recordPreparationReady({ actor, attemptId, initialSessionId: `training-${attemptId}`, expectedRevision: 2 });
  const prepared = await teaching.prepareQuestion({ actor, attemptId, expectedRevision: 3, requestId: "q-one",
    assessmentId: "explain", text: f.input.question.text, assistance: "none" });
  // The native Colleague suite proves delivery and message admission. This fixture
  // supplies its explicit server transport result, not browser/model provenance.
  const message = { role: "user", receipt: true, messageId: f.input.evidence.messageId,
    text: f.input.evidence.text, data: { trainingQuestion: { ...structuredClone(prepared.snapshot),
      delivery: { conversationId: "native-colleague", turnId: "native-question-turn", outputId: "native-final-output" } } } };
  const owner = createTrainingAnswerAssessment({ learners, content, teaching });
  const input = { actor, attemptId, expectedRevision: 4, submissionId: "answer-one", message };
  const facilities = { state: f.state, context: f.context, helper: f.helper };
  return { ...f, actor, learners, teaching, owner, input, facilities,
    read: () => learners.readState({ actor, includeCompletion: true }) };
}

test("native answer grading records actual words once and replays without inference after the next question", async t => {
  const f = await answerFixture(t);
  const result = await f.owner.evaluateAnswer(f.input, f.facilities);
  assert.equal(result.revision, 5);
  assert.equal(result.attempt.learning.submissions[0].outcome, "passed");
  assert.equal(result.attempt.learning.submissions[0].evidence.messageId, f.input.message.messageId);
  assert.equal(result.attempt.learning.submissions[0].evidence.text, "I use Preview.");
  assert.equal(f.state.record.summaryHelper, null);
  await f.teaching.prepareQuestion({ actor: f.actor, attemptId: f.input.attemptId, expectedRevision: 5,
    requestId: "q-two", assessmentId: "explain", text: "What would you do next?", assistance: "hint" });
  const runs = f.calls.filter(value => value.run).length;
  const replay = await f.owner.evaluateAnswer({ ...f.input, expectedRevision: 0 }, f.facilities);
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, 6);
  assert.equal(replay.attempt.learning.resume.pendingQuestion.id, "q-two");
  assert.equal(f.calls.filter(value => value.run).length, runs);
  await assert.rejects(f.owner.evaluateAnswer({ ...f.input, message: { ...f.input.message, text: "Changed answer." } }, f.facilities),
    { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  await assert.rejects(f.owner.evaluateAnswer({ ...f.input, submissionId: "another-submission", expectedRevision: 6 }, f.facilities),
    { code: "VIBE64_TRAINING_EVIDENCE_CONFLICT" });
  assert.equal(f.calls.filter(value => value.run).length, runs);
});

test("missing delivery, wrong learner/pin, stale question and stale CAS cannot start answer grading", async t => {
  const f = await answerFixture(t);
  const original = await f.read();
  for (const changes of [
    { role: "assistant" }, { receipt: false }, { data: {} },
    { data: { trainingQuestion: { ...f.input.message.data.trainingQuestion, learnerId: "another" } } },
    { data: { trainingQuestion: { ...f.input.message.data.trainingQuestion, delivery: { ...f.input.message.data.trainingQuestion.delivery, pass: true } } } },
    { data: { trainingQuestion: { ...f.input.message.data.trainingQuestion,
      pin: { ...f.input.message.data.trainingQuestion.pin, lesson: { code: "USE-ONE", hash: "0".repeat(64) } } } } }
  ]) {
    await assert.rejects(f.owner.evaluateAnswer({ ...f.input, message: { ...f.input.message, ...changes } }, f.facilities),
      { code: "VIBE64_TRAINING_ANSWER_UNADMITTED" });
  }
  await assert.rejects(f.owner.evaluateAnswer({ ...f.input, expectedRevision: 3 }, f.facilities),
    { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  await assert.rejects(f.owner.evaluateAnswer({ ...f.input, message: { ...f.input.message, data: { trainingQuestion: {
    ...f.input.message.data.trainingQuestion, question: { ...f.input.message.data.trainingQuestion.question, text: "Another question." }
  } } } }, f.facilities), { code: "VIBE64_TRAINING_QUESTION_STALE" });
  assert.equal(f.calls.some(value => value.run), false);
  assert.deepEqual(await f.read(), original);
});

test("failed Helper, cancellation and changed checkpoint retain the answer without saving an invented result", async t => {
  const f = await answerFixture(t);
  f.setRunFailure(true);
  await assert.rejects(f.owner.evaluateAnswer(f.input, f.facilities), /Provider failed/);
  assert.equal((await f.read()).active.learning.submissions.length, 0);
  assert.equal(f.state.record.summaryHelper, null);
  f.setRunFailure(false);
  const stopped = { ...f.facilities, helper: { async runHelper(...args) {
    const result = await f.helper.runHelper(...args);
    f.state.summaryAbort.abort();
    return result;
  } } };
  await assert.rejects(f.owner.evaluateAnswer(f.input, stopped), { name: "AbortError" });
  assert.equal((await f.read()).active.learning.submissions.length, 0);
  f.state.summaryAbort = new AbortController();
  const changed = { ...f.facilities, helper: { async runHelper(...args) {
    const result = await f.helper.runHelper(...args);
    const current = await f.read();
    const { revision, requestId, ...resume } = current.active.learning.resume;
    await f.learners.saveLessonResume({ actor: f.actor, attemptId: f.input.attemptId,
      expectedRevision: current.revision, requestId: "visual-checkpoint", resume });
    return result;
  } } };
  await assert.rejects(f.owner.evaluateAnswer(f.input, changed), { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  assert.equal((await f.read()).active.learning.submissions.length, 0);
  assert.equal(f.state.record.summaryHelper, null);
});

async function practicalFixture(t, assistance = "none") {
  const f = await answerFixture(t);
  const prepared = await f.teaching.prepareQuestion({ actor: f.actor, attemptId: f.input.attemptId,
    expectedRevision: 4, requestId: "q-practical", assessmentId: "try",
    text: "Press the app button and explain its response.", assistance });
  const current = await f.read();
  const observation = { kind: "observation", observationId: "native-button-observation", observedAt: "2026-10-07T01:00:00.000Z",
    learnerId: current.progress.learnerId, attemptId: f.input.attemptId, questionId: prepared.reference.questionId,
    projectSlug: current.active.projectSlug, sessionId: current.active.preparation.initialSessionId,
    producer: "exercise", operation: "use-button", operationId: "native-button-operation", assistance,
    origin: assistance === "demonstration" ? "teacher" : "learner", text: "The native app button returned its correlated response." };
  const message = { ...f.input.message, text: "The button showed a response from this app.", data: {
    trainingQuestion: { ...structuredClone(prepared.snapshot), delivery: f.input.message.data.trainingQuestion.delivery }
  } };
  return { ...f, input: { ...f.input, expectedRevision: 5, submissionId: "practical-one", message, observation,
    checkResult: { check: "response", observationId: observation.observationId, outcome: "passed" } } };
}

test("native practical grading shares retained Helper and progress replay with canonical learner words", async t => {
  const f = await practicalFixture(t);
  const result = await f.owner.evaluatePractical(f.input, f.facilities);
  const submission = result.attempt.learning.submissions[0];
  assert.equal(result.revision, 6);
  assert.equal(submission.outcome, "passed");
  assert.deepEqual(submission.evidence, { kind: "observation", learnerId: f.input.observation.learnerId,
    attemptId: f.input.attemptId, text: f.input.message.text, observationId: f.input.observation.observationId,
    observedAt: f.input.observation.observedAt, projectSlug: f.input.observation.projectSlug,
    sessionId: f.input.observation.sessionId, producer: "exercise", operation: "use-button", origin: "learner", check: "response" });
  const prompt = JSON.parse(f.calls.find(value => value.run).run.input.prompt);
  assert.equal(prompt.question, null);
  assert.equal(prompt.evidence.text, f.input.message.text);
  assert.match(prompt.assessment.rubric, /actual button/);
  assert.equal(f.state.record.summaryHelper, null);
  await f.teaching.prepareQuestion({ actor: f.actor, attemptId: f.input.attemptId, expectedRevision: 6,
    requestId: "after-practical", assessmentId: "explain", text: "What next?", assistance: "hint" });
  const runs = f.calls.filter(value => value.run).length;
  assert.equal((await f.owner.evaluatePractical({ ...f.input, expectedRevision: 0 }, f.facilities)).replayed, true);
  assert.equal(f.calls.filter(value => value.run).length, runs);
  await assert.rejects(f.owner.evaluatePractical({ ...f.input, submissionId: "another-practical", expectedRevision: 7 }, f.facilities),
    { code: "VIBE64_TRAINING_EVIDENCE_CONFLICT" });
  await assert.rejects(f.owner.evaluatePractical({ ...f.input, message: { ...f.input.message, text: "Different explanation." } }, f.facilities),
    { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  assert.equal(f.calls.filter(value => value.run).length, runs);
});

test("native practical observations require exact learner question exercise and authoritative assistance before inference", async t => {
  const f = await practicalFixture(t);
  const original = await f.read();
  for (const changes of [
    { kind: "answer" }, { learnerId: "another" }, { attemptId: "another" }, { questionId: "another" },
    { projectSlug: "another" }, { sessionId: "another" }, { assistance: "hint" }, { origin: "demonstration" },
    { operationId: "" }, { text: "" }
  ]) {
    await assert.rejects(f.owner.evaluatePractical({ ...f.input, observation: { ...f.input.observation, ...changes } }, f.facilities),
      { code: "VIBE64_TRAINING_PRACTICAL_UNADMITTED" });
  }
  for (const changes of [{ observedAt: "invalid" }, { observationId: "" }, { producer: "workspace" }, { operation: "another" }]) {
    await assert.rejects(f.owner.evaluatePractical({ ...f.input, observation: { ...f.input.observation, ...changes } }, f.facilities));
  }
  await assert.rejects(f.owner.evaluatePractical({ ...f.input, message: { ...f.input.message, text: " " } }, f.facilities));
  await assert.rejects(f.owner.evaluatePractical({ ...f.input, message: { ...f.input.message, data: {} } }, f.facilities),
    { code: "VIBE64_TRAINING_ANSWER_UNADMITTED" });
  await assert.rejects(f.owner.evaluatePractical({ ...f.input, expectedRevision: 4 }, f.facilities),
    { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  assert.equal(f.calls.some(value => value.run), false);
  assert.deepEqual(await f.read(), original);
});

test("native practical check failures and teacher demonstrations cannot record a learner pass", async t => {
  const f = await practicalFixture(t);
  for (const checkResult of [undefined, { ...f.input.checkResult, observationId: "another" },
    { ...f.input.checkResult, check: "another" }, { ...f.input.checkResult, outcome: "passed", invented: true }]) {
    await assert.rejects(f.owner.evaluatePractical({ ...f.input, checkResult }, f.facilities));
  }
  assert.equal(f.calls.some(value => value.run), false);
  assert.equal((await f.read()).active.learning.submissions.length, 0);
  const failed = await f.owner.evaluatePractical({ ...f.input, checkResult: { ...f.input.checkResult, outcome: "not-yet-passed" } }, f.facilities);
  assert.equal(failed.attempt.learning.submissions[0].outcome, "not-yet-passed");
  const teacher = await practicalFixture(t, "demonstration");
  const demonstrated = await teacher.owner.evaluatePractical(teacher.input, teacher.facilities);
  assert.equal(demonstrated.attempt.learning.submissions[0].outcome, "not-yet-passed");
  assert.equal(demonstrated.attempt.learning.submissions[0].evidence.origin, "demonstration");
  assert.equal(teacher.calls.some(value => value.run), false);
});

test("native practical cancellation stale questions and concurrent checkpoints preserve original write fences", async t => {
  const f = await practicalFixture(t);
  const stopped = { ...f.facilities, helper: { async runHelper(...args) {
    const result = await f.helper.runHelper(...args);
    f.state.summaryAbort.abort();
    return result;
  } } };
  await assert.rejects(f.owner.evaluatePractical(f.input, stopped), { name: "AbortError" });
  assert.equal((await f.read()).active.learning.submissions.length, 0);
  f.state.summaryAbort = new AbortController();
  const changed = { ...f.facilities, helper: { async runHelper(...args) {
    const result = await f.helper.runHelper(...args);
    const current = await f.read();
    const { revision, requestId, ...resume } = current.active.learning.resume;
    await f.learners.saveLessonResume({ actor: f.actor, attemptId: f.input.attemptId,
      expectedRevision: current.revision, requestId: "practical-visual-checkpoint", resume });
    return result;
  } } };
  await assert.rejects(f.owner.evaluatePractical(f.input, changed), { code: "VIBE64_TRAINING_STATE_REVISION_CONFLICT" });
  await f.teaching.prepareQuestion({ actor: f.actor, attemptId: f.input.attemptId, expectedRevision: 6,
    requestId: "replacement-practical", assessmentId: "try", text: "Repeat independently.", assistance: "hint" });
  const runs = f.calls.filter(value => value.run).length;
  await assert.rejects(f.owner.evaluatePractical({ ...f.input, expectedRevision: 7 }, f.facilities),
    { code: "VIBE64_TRAINING_QUESTION_STALE" });
  assert.equal(f.calls.filter(value => value.run).length, runs);
  assert.equal((await f.read()).active.learning.submissions.length, 0);
  assert.equal(f.state.record.summaryHelper, null);
});

test("the original admitted assessment accepts a supplied native lifetime without a Colleague state", async t => {
  const f = await answerFixture(t);
  const { evaluateAdmittedTrainingAssessment } = await import("../../packages/vibe64-training/src/server/conversationAssessment.js");
  const controller = new AbortController();
  let checks = 0;
  const helper = { async runHelper(state, context, input) {
    assert.equal(state, undefined, "the native domain caller supplies no fabricated Colleague state");
    assert.equal(context, f.context);
    return f.helper.runHelper(f.state, context, input);
  } };
  const facilities = { assessment: f.owner, helper, signal: controller.signal, async requireCurrent() { checks++; } };
  const result = await evaluateAdmittedTrainingAssessment("answer", f.input, f.context, facilities);
  assert.equal(result.attempt.learning.submissions[0].evidence.text, f.input.message.text);
  assert.equal(result.attempt.learning.submissions[0].outcome, "passed");
  assert.equal(f.state.record.summaryHelper, null, "the original retained Helper cleaned its receipt");
  assert.equal(checks, 4);
  const before = await f.read();
  const runs = f.calls.filter(value => value.run).length;
  controller.abort(new Error("The admitted native tool was stopped before replay"));
  await assert.rejects(evaluateAdmittedTrainingAssessment("answer", f.input, f.context, facilities), /stopped before replay/);
  assert.deepEqual(await f.read(), before);
  assert.equal(f.calls.filter(value => value.run).length, runs);
});

test("the original assessment checks supplied native cancellation after its final awaited authority refresh", async t => {
  const f = await answerFixture(t);
  const { evaluateAdmittedTrainingAssessment } = await import("../../packages/vibe64-training/src/server/conversationAssessment.js");
  const controller = new AbortController();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let checks = 0, writes = 0;
  const owner = createTrainingAnswerAssessment({
    content: createInstalledTrainingContent({ systemRoot: path.join(f.root, "system") }), teaching: f.teaching,
    learners: { ...f.learners, async recordAssessment(...args) {
      writes++; return f.learners.recordAssessment(...args);
    } } });
  const before = await f.read();
  const pending = evaluateAdmittedTrainingAssessment("answer", f.input, f.context, {
    assessment: owner, state: f.state, helper: f.helper, signal: controller.signal,
    async requireCurrent() { if (++checks === 3) { entered.resolve(); await release.promise; } }
  });
  await entered.promise;
  controller.abort(new Error("The native turn was stopped during final authority refresh"));
  release.resolve();
  await assert.rejects(pending, /stopped during final authority refresh/);
  assert.equal(writes, 0);
  assert.deepEqual(await f.read(), before);
  assert.equal(f.state.record.summaryHelper, null);
});
