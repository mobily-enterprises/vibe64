import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingStepChecks } from "../../packages/vibe64-training/src/server/stepChecks.js";
import { v2Content } from "./vibe64TrainingV2LessonStub.js";

// Version 2 learner state: step-progress.json, reader.json and the pass rules.
// Lesson content is the real bundled code-practical fixture projected through
// the contract C1 readLesson shape (stub); checks and actions are explicit
// fixtures here. The real check gateway is covered by DeclaredCheck and
// CodePracticals.
const fixtureTopic = new URL("../fixtures/training/code-practical/", import.meta.url);
const steps = [
  { id: "read-intro", title: "Read", body: "steps/read.md", check: { kind: "none" }, required: false },
  { id: "pick-answer", title: "Pick", body: "steps/pick.md", required: true,
    check: { kind: "choice", question: "Which one?", options: ["a", "b", "c"], answer: [1] } },
  { id: "try-it", title: "Try it", body: "steps/try.md", check: { kind: "self" }, required: true },
  { id: "press-app", title: "Press", body: "steps/press.md", check: { kind: "auto", check: "press-response", files: [] }, required: true }
];

async function fixture(t, { lessonVersion = 2 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-step-progress-"));
  t.after(() => rm(root, { recursive: true, force: true }));
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
  const installed = createInstalledTrainingContent({ systemRoot });
  const content = lessonVersion === 2 ? v2Content(installed, { steps,
    checks: [...(await installed.readLesson({ ...topic, lessonCode: "CODE-ONE", lessonHash: pin.lesson.hash })).lesson.checks,
      { id: "press-response", file: "checks/notes/title.mjs", kind: "response" }] }) : installed;
  const learners = createTrainingLearnerState({ systemRoot, content });
  const actor = { uid: 42, username: "alice" };
  let revision = 0;
  async function start(requestId = "start", { practiceId } = {}) {
    const reserved = await learners.reserveAttempt({ actor, expectedRevision: revision, requestId, pin, practiceId });
    const attemptId = reserved.attempt.attemptId;
    const begun = await learners.beginPreparation({ actor, attemptId, expectedRevision: reserved.revision });
    const sessionId = begun.attempt.preparation.initialSessionId;
    const ready = await learners.recordPreparationReady({ actor, attemptId, initialSessionId: sessionId, expectedRevision: begun.revision });
    revision = ready.revision;
    return { attemptId, projectSlug: reserved.attempt.projectSlug, sessionId };
  }
  async function end(attemptId, requestId = "end") {
    revision = (await learners.endAttempt({ actor, attemptId, requestId, expectedRevision: revision, reason: "left" })).revision;
  }
  const checkCalls = [];
  const actionCalls = [];
  let outcome = "passed";
  const checks = {
    async runOrientationCheck(input) { checkCalls.push(input); return { checkResult: { check: "press-response", observationId: input.observationId, outcome } }; },
    async runCodeCheck() { throw new Error("no code step in this fixture"); }
  };
  const actions = { async execute({ actionId, input }) {
    actionCalls.push({ actionId, input });
    return actionId === "vibe64.terminals.outputs.read" ? { ok: true, activeTerminal: { id: "terminal-1" } } : { ok: true };
  } };
  const owner = createTrainingStepChecks({ learners, content, checks, actions });
  const userRoot = path.join(systemRoot, "training/users/NDI");
  const files = { stepProgress: path.join(userRoot, "step-progress.json"), reader: path.join(userRoot, "reader.json"),
    progress: path.join(userRoot, "progress.json"), stepLock: path.join(userRoot, "step-progress.lock") };
  return { systemRoot, actor, learners, content, owner, start, end, files, checkCalls, actionCalls,
    set outcome(value) { outcome = value; } };
}

// The admitted action channels: the learner's browser (api) and Colleague's
// tools (automation).
const api = { context: { channel: "api" } };
const automation = { context: { channel: "automation" } };

const observation = (attempt, exercise = {}) => ({ control: "exercise-response",
  exercise: { instanceId: randomUUID(), interactionId: randomUUID(), requestId: randomUUID(), ...exercise },
  workspace: { projectSlug: attempt.projectSlug, sessionId: attempt.sessionId, projectVisible: true, pane: "preview", ready: true } });

test("choice and self steps record learner-origin results that replay by request ID and never reveal the answer", async t => {
  const f = await fixture(t);
  const attempt = await f.start();
  const progressBefore = await readFile(f.files.progress);
  const wrong = await f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [0], requestId: "answer-1" });
  assert.deepEqual(wrong, { ok: true, stepId: "pick-answer", outcome: "not-yet-passed", recorded: true, replayed: false });
  const replay = await f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [0], requestId: "answer-1" });
  assert.equal(replay.replayed, true);
  await assert.rejects(f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [1], requestId: "answer-1" }),
    { code: "VIBE64_TRAINING_REQUEST_CONFLICT" });
  for (const selected of [[], [3], [1, 1], ["1"], [0, 1, 2, 0]]) {
    await assert.rejects(f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected, requestId: "answer-bad" }),
      { code: "ACTION_VALIDATION_FAILED" });
  }
  assert.equal((await f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [1], requestId: "answer-2" })).outcome, "passed");
  const after = await f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [2], requestId: "answer-3" });
  assert.deepEqual({ outcome: after.outcome, recorded: after.recorded, alreadyPassed: after.alreadyPassed }, { outcome: "passed", recorded: false, alreadyPassed: true });
  await assert.rejects(f.owner.done({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", requestId: "done-x" }), { code: "VIBE64_TRAINING_CHECK_UNDECLARED" });
  await assert.rejects(f.owner.done({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "read-intro", requestId: "done-x" }), { code: "VIBE64_TRAINING_CHECK_UNDECLARED" });
  assert.equal((await f.owner.done({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "try-it", requestId: "done-1" })).outcome, "passed");
  const saved = JSON.parse(await readFile(f.files.stepProgress, "utf8"));
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.learnerId, "42");
  assert.equal(saved.revision, 3);
  assert.deepEqual(saved.lessons[0].lesson, (await f.learners.readState({ actor: f.actor })).progress.attempts[0].pin.lesson,
    "results are kept per lesson content");
  assert.deepEqual(saved.lessons[0].results.map(value => [value.stepId, value.kind, value.outcome, value.origin, value.requestId]), [
    ["pick-answer", "choice", "not-yet-passed", "learner", "answer-1"], ["pick-answer", "choice", "passed", "learner", "answer-2"],
    ["try-it", "self", "passed", "learner", "done-1"]]);
  assert.deepEqual(saved.lessons[0].results[1].evidence, { selected: [1] });
  assert.deepEqual(saved.lessons[0].results[2].evidence, {});
  assert.deepEqual(await readFile(f.files.progress), progressBefore, "step results never advance progress.json");
  const read = await f.owner.read({ actor: f.actor, attemptId: attempt.attemptId });
  assert.deepEqual(read.passedStepIds, ["pick-answer", "try-it"]);
  assert.deepEqual({ required: read.completion.required, passed: read.completion.passed, completed: read.completion.completed }, { required: 3, passed: 2, completed: false });
});

test("assistant-triggered checks never write a pass; learner-origin App receipts and the learner's own Check do", async t => {
  const f = await fixture(t);
  const attempt = await f.start();
  const base = { actor: f.actor, attemptId: attempt.attemptId, stepId: "press-app", ...api };
  const none = await f.owner.runCheck({ ...base, requestId: "check-0", ...api });
  assert.deepEqual({ outcome: none.outcome, recorded: none.recorded }, { outcome: "not-yet-passed", recorded: false });
  assert.equal(f.checkCalls.length, 0, "no learner interaction means nothing to verify");
  await assert.rejects(f.owner.runCheck({ ...base, requestId: "check x" }), { code: "ACTION_VALIDATION_FAILED" });
  await assert.rejects(f.owner.observe({ ...base, ...automation, observation: observation(attempt) }), { code: "VIBE64_TRAINING_LEARNER_ONLY" },
    "only the learner's own browser records an App interaction");
  for (const workspace of [{ pane: "files" }, { projectVisible: false }, { ready: false }, { sessionId: "training-other" }]) {
    const input = observation(attempt);
    await assert.rejects(f.owner.observe({ ...base, observation: { ...input, workspace: { ...input.workspace, ...workspace } } }));
  }
  await assert.rejects(f.owner.observe({ ...base, observation: { ...observation(attempt), control: "code-submit" } }));
  f.outcome = "not-yet-passed";
  const first = observation(attempt);
  assert.equal((await f.owner.observe({ ...base, observation: first })).outcome, "not-yet-passed");
  assert.deepEqual(f.actionCalls.map(call => call.actionId), ["vibe64.sessions.inspect", "vibe64.terminals.outputs.read"]);
  assert.deepEqual(f.actionCalls[0].input, { projectSlug: attempt.projectSlug, sessionId: attempt.sessionId });
  assert.equal(f.checkCalls[0].stepId, "press-app");
  assert.equal(f.checkCalls[0].requestId, first.exercise.requestId);
  assert.equal((await f.owner.observe({ ...base, observation: first })).replayed, true, "the same App interaction replays");
  assert.equal(f.checkCalls.length, 1);
  f.outcome = "passed";
  const byAssistant = await f.owner.runCheck({ ...base, ...automation, requestId: "colleague-1", trigger: "learner" });
  assert.deepEqual({ outcome: byAssistant.outcome, recorded: byAssistant.recorded }, { outcome: "passed", recorded: false });
  assert.match(byAssistant.diagnostic, /Only the learner's own Check/u, "a caller-supplied trigger never overrides the admitted channel");
  for (const context of [{}, { channel: "internal" }, { channel: "automation", trigger: "learner" }]) {
    assert.equal((await f.owner.runCheck({ ...base, context, requestId: "colleague-x" })).recorded, false, "only the api channel is the learner");
  }
  assert.equal(f.checkCalls.at(-1).interactionId, first.exercise.interactionId, "a re-check verifies the saved learner receipt");
  assert.notEqual(f.checkCalls.at(-1).observationId, f.checkCalls[0].observationId);
  f.outcome = "not-yet-passed";
  const failedByAssistant = await f.owner.runCheck({ ...base, ...automation, requestId: "colleague-2" });
  assert.deepEqual({ outcome: failedByAssistant.outcome, recorded: failedByAssistant.recorded }, { outcome: "not-yet-passed", recorded: false },
    "an assistant-triggered check is a diagnostic only and never uses the learner's result budget");
  f.outcome = "passed";
  assert.equal((await f.learners.readState({ actor: f.actor, includeCompletion: true })).completion.passed, 0);
  const byLearner = await f.owner.runCheck({ ...base, requestId: "learner-1", ...api });
  assert.deepEqual({ outcome: byLearner.outcome, recorded: byLearner.recorded }, { outcome: "passed", recorded: true });
  const saved = JSON.parse(await readFile(f.files.stepProgress, "utf8")).lessons[0];
  assert.deepEqual(saved.results.map(value => [value.requestId, value.outcome, value.origin]), [
    [first.exercise.requestId, "not-yet-passed", "check"], ["learner-1", "passed", "check"]]);
  assert.deepEqual(Object.keys(saved.results[1].evidence).sort(), ["checkId", "observationId"]);
  assert.equal(saved.receipts.length, 1);
  assert.equal(saved.receipts[0].requestId, first.exercise.requestId);
  await assert.rejects(f.owner.observe({ ...base, stepId: "try-it", observation: observation(attempt) }), { code: "VIBE64_TRAINING_CHECK_UNDECLARED" });
});

test("the choice answer never reaches readLesson; only the server comparator reads it", async t => {
  const f = await fixture(t);
  const attempt = await f.start();
  const state = await f.learners.readState({ actor: f.actor });
  const pin = state.progress.attempts[0].pin;
  const lesson = await f.content.readLesson({ ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash });
  const projected = lesson.lesson.steps.find(step => step.id === "pick-answer");
  assert.equal(Object.hasOwn(projected.check, "answer"), false, "readLesson must not contain the answer (contract C1)");
  assert.equal(JSON.stringify(lesson).includes("\"answer\""), false);
  const reads = [];
  const content = { ...f.content, async readChoiceAnswer(input) { reads.push(input); return f.content.readChoiceAnswer(input); } };
  const owner = createTrainingStepChecks({ learners: f.learners, content, checks: {}, actions: {} });
  assert.equal((await owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [1], requestId: "answer-1" })).outcome, "passed");
  assert.deepEqual(reads, [{ ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash, stepId: "pick-answer" }]);
  await assert.rejects(owner.answer({ ...automation, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [1], requestId: "answer-2" }),
    { code: "VIBE64_TRAINING_LEARNER_ONLY" });
  await assert.rejects(owner.done({ ...automation, actor: f.actor, attemptId: attempt.attemptId, stepId: "try-it", requestId: "done-2" }),
    { code: "VIBE64_TRAINING_LEARNER_ONLY" });
  const { readChoiceAnswer: _read, ...withoutComparator } = f.content;
  const unsupported = createTrainingStepChecks({ learners: f.learners, content: withoutComparator, checks: {}, actions: {} });
  await assert.rejects(unsupported.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [2], requestId: "answer-3" }),
    { code: "VIBE64_TRAINING_CHECK_UNDECLARED" });
});

test("saved App receipts bound only the session ID format, so practice-session naming can change", async t => {
  const f = await fixture(t);
  const attempt = await f.start();
  await f.owner.observe({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "press-app", observation: observation(attempt) });
  const saved = JSON.parse(await readFile(f.files.stepProgress, "utf8"));
  saved.lessons[0].receipts[0].sessionId = "ordinary-session-1";
  await writeFile(f.files.stepProgress, `${JSON.stringify(saved)}\n`);
  assert.equal((await f.learners.readState({ actor: f.actor, includeCompletion: true })).completion.required, 3, "the record stays readable");
  const stale = await f.owner.runCheck({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "press-app", requestId: "check-1" });
  assert.deepEqual({ outcome: stale.outcome, recorded: stale.recorded }, { outcome: "not-yet-passed", recorded: false },
    "a receipt from another session is never verified against this attempt");
  saved.lessons[0].receipts[0].sessionId = "../escape";
  await writeFile(f.files.stepProgress, `${JSON.stringify(saved)}\n`);
  await assert.rejects(f.learners.readState({ actor: f.actor, includeCompletion: true }), { code: "VIBE64_TRAINING_STATE_INVALID" });
});

test("v2 completion counts passes of the same lesson content in every attempt and ended attempts stay read-only", async t => {
  const f = await fixture(t);
  const first = await f.start();
  for (const [stepId, call] of [["pick-answer", "answer"], ["try-it", "done"]]) {
    await f.owner[call]({ ...api, actor: f.actor, attemptId: first.attemptId, stepId, selected: [1], requestId: `${stepId}-1` });
  }
  await f.end(first.attemptId);
  await assert.rejects(f.owner.done({ ...api, actor: f.actor, attemptId: first.attemptId, stepId: "try-it", requestId: "late" }),
    { code: "VIBE64_TRAINING_ATTEMPT_INACTIVE" });
  assert.equal((await f.owner.read({ actor: f.actor, attemptId: first.attemptId })).results.length, 2);
  const second = await f.start("start-2");
  await f.owner.observe({ ...api, actor: f.actor, attemptId: second.attemptId, stepId: "press-app", observation: observation(second) });
  const state = await f.learners.readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual({ required: state.completion.required, passed: state.completion.passed, completed: state.completion.completed },
    { required: 3, passed: 3, completed: true });
  assert.equal(state.lessonCompletions.length, 1);
  assert.equal(state.lessonCompletions[0].completed, true);
  assert.equal((await f.learners.resumeAttempt({ actor: f.actor, attemptId: second.attemptId })).completion.completed, true);
  assert.deepEqual((await f.owner.read({ actor: f.actor, attemptId: second.attemptId })).passedStepIds, ["pick-answer", "try-it", "press-app"]);
});

test("Continue lesson in the same practice project keeps its passes, App receipt and session", async t => {
  const f = await fixture(t);
  const first = await f.start();
  await f.owner.done({ ...api, actor: f.actor, attemptId: first.attemptId, stepId: "try-it", requestId: "done-1" });
  await f.owner.observe({ ...api, actor: f.actor, attemptId: first.attemptId, stepId: "press-app", observation: observation(first) });
  await f.end(first.attemptId);
  const continued = await f.start("continue-1", { practiceId: first.attemptId });
  assert.notEqual(continued.attemptId, first.attemptId);
  assert.deepEqual({ projectSlug: continued.projectSlug, sessionId: continued.sessionId }, { projectSlug: first.projectSlug, sessionId: first.sessionId });
  const read = await f.owner.read({ actor: f.actor, attemptId: continued.attemptId });
  assert.deepEqual(read.passedStepIds, ["try-it", "press-app"], "the lesson opens at its first unpassed step");
  assert.equal((await f.owner.done({ ...api, actor: f.actor, attemptId: continued.attemptId, stepId: "try-it", requestId: "done-2" })).alreadyPassed, true);
  const calls = f.checkCalls.length;
  const recheck = await f.owner.runCheck({ ...api, actor: f.actor, attemptId: continued.attemptId, stepId: "press-app", requestId: "check-2" });
  assert.equal(recheck.alreadyPassed, true);
  assert.equal(f.checkCalls.length, calls + 1, "the earlier App receipt belongs to the same practice session, so it is re-verified");
});

test("reader.json keeps the last position for any retained attempt and refuses undeclared steps", async t => {
  const f = await fixture(t);
  const first = await f.start();
  assert.equal(await f.learners.readReader({ actor: f.actor }), null);
  await f.owner.saveReader({ actor: f.actor, attemptId: first.attemptId, stepId: "read-intro", scroll: 120.5 });
  const saved = await f.owner.saveReader({ actor: f.actor, attemptId: first.attemptId, stepId: "pick-answer", scroll: 0 });
  assert.deepEqual(saved.reader, { attemptId: first.attemptId, stepId: "pick-answer", scroll: 0 });
  assert.deepEqual(saved.baseline, { recorded: false }, "no code step, no baseline");
  assert.deepEqual(await f.learners.readReader({ actor: f.actor }), saved.reader);
  assert.deepEqual(JSON.parse(await readFile(f.files.reader, "utf8")),
    { schemaVersion: 1, learnerId: "42", attemptId: first.attemptId, stepId: "pick-answer", scroll: 0 });
  await f.end(first.attemptId);
  assert.equal((await f.owner.saveReader({ actor: f.actor, attemptId: first.attemptId, stepId: "try-it", scroll: 3 })).reader.stepId, "try-it",
    "an ended attempt can still be read again");
  await assert.rejects(f.learners.saveReader({ actor: f.actor, attemptId: first.attemptId, stepId: "not-a-step", scroll: 0 }), { code: "VIBE64_TRAINING_STEP_MISSING" });
  await assert.rejects(f.learners.saveReader({ actor: f.actor, attemptId: randomUUID(), stepId: "try-it", scroll: 0 }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  for (const scroll of [-1, Number.NaN, Infinity, "1", 10_000_001]) {
    await assert.rejects(f.learners.saveReader({ actor: f.actor, attemptId: first.attemptId, stepId: "try-it", scroll }));
  }
  assert.equal(await f.learners.readReader({ actor: { uid: 43 } }), null, "another learner has its own reader record");
});

test("invalid, cross-attempt or full step records fail closed without writes; a held lock reports busy", async t => {
  const f = await fixture(t);
  const attempt = await f.start();
  await f.owner.done({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "try-it", requestId: "done-1" });
  const valid = JSON.parse(await readFile(f.files.stepProgress, "utf8"));
  const entry = valid.lessons[0];
  const recordedAt = entry.results[0].recordedAt;
  const invalids = [
    { ...valid, learnerId: "43" },
    { ...valid, lessons: [entry, entry] },
    { ...valid, lessons: [{ ...entry, lesson: { ...entry.lesson, hash: "not-a-hash" } }] },
    { ...valid, lessons: [{ ...entry, results: [{ ...entry.results[0], origin: "check" }] }] },
    { ...valid, lessons: [{ ...entry, results: [{ ...entry.results[0], stepId: "pick-answer" }] }] },
    { ...valid, lessons: [{ ...entry, results: [{ ...entry.results[0], evidence: { selected: [1] } }] }] },
    { ...valid, lessons: [{ ...entry, results: [entry.results[0], entry.results[0]] }] },
    { ...valid, schemaVersion: 1 }
  ];
  for (const record of invalids) {
    await writeFile(f.files.stepProgress, `${JSON.stringify(record)}\n`);
    const before = await readFile(f.files.stepProgress);
    await assert.rejects(f.learners.readState({ actor: f.actor, includeCompletion: true }), { code: "VIBE64_TRAINING_STATE_INVALID" });
    await assert.rejects(f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [1], requestId: "answer-1" }),
      { code: "VIBE64_TRAINING_STATE_INVALID" });
    assert.deepEqual(await readFile(f.files.stepProgress), before);
  }
  assert.equal((await f.learners.readState({ actor: f.actor })).progress.attempts.length, 1, "progress reads stay content- and step-independent");
  const full = { ...valid, lessons: [{ lesson: entry.lesson, results: Array.from({ length: 64 }, (_, index) => ({
    stepId: "pick-answer", kind: "choice", outcome: "not-yet-passed", evidence: { selected: [0] }, origin: "learner",
    requestId: `answer-${index}`, recordedAt })) }] };
  await writeFile(f.files.stepProgress, `${JSON.stringify(full)}\n`);
  // A record already at the bound (never produced now that passes are reserved) still fails closed.
  await assert.rejects(f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [1], requestId: "answer-65" }),
    { code: "VIBE64_TRAINING_STEP_RESULTS_FULL" });
  assert.equal((await f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [0], requestId: "answer-3" })).replayed, true);
  await writeFile(f.files.stepProgress, `${JSON.stringify(valid)}\n`);
  // Capacity for one pass of every checkable step not yet passed is reserved.
  const nearlyFull = { ...valid, lessons: [{ lesson: entry.lesson, results: Array.from({ length: 62 }, (_, index) => ({
    stepId: "pick-answer", kind: "choice", outcome: "not-yet-passed", evidence: { selected: [0] }, origin: "learner",
    requestId: `retry-${index}`, recordedAt })) }] };
  await writeFile(f.files.stepProgress, `${JSON.stringify(nearlyFull)}\n`);
  const unsaved = await f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [2], requestId: "retry-62" });
  assert.deepEqual({ outcome: unsaved.outcome, recorded: unsaved.recorded }, { outcome: "not-yet-passed", recorded: false },
    "a retry that would use a reserved slot is returned but not saved");
  assert.match(unsaved.diagnostic, /keeps its remaining history for passes/u);
  for (const [call, stepId, extra] of [["answer", "pick-answer", { selected: [1] }], ["done", "try-it", {}]]) {
    const passed = await f.owner[call]({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId, requestId: `final-${stepId}`, ...extra });
    assert.deepEqual({ outcome: passed.outcome, recorded: passed.recorded }, { outcome: "passed", recorded: true }, "a full budget still accepts the learner's passes");
  }
  assert.equal(JSON.parse(await readFile(f.files.stepProgress, "utf8")).lessons[0].results.length, 64);
  await writeFile(f.files.stepProgress, `${JSON.stringify(valid)}\n`);
  const release = await tryAcquireExclusiveFileLock(f.files.stepLock);
  try {
    await assert.rejects(f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [1], requestId: "answer-1" }),
      { code: "VIBE64_TRAINING_STEP_PROGRESS_BUSY" });
  } finally { await release(); }
  assert.equal((await stat(f.files.stepLock)).size, 0);
  assert.equal((await f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [1], requestId: "answer-1" })).outcome, "passed");
});

test("results of lesson content no retained attempt names stay readable and unvalidated against content", async t => {
  const f = await fixture(t);
  const attempt = await f.start();
  await f.owner.done({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "try-it", requestId: "done-1" });
  const saved = JSON.parse(await readFile(f.files.stepProgress, "utf8"));
  const pruned = { ...saved.lessons[0], lesson: { code: "PRUNED-ONE", hash: "e".repeat(64) },
    results: [{ ...saved.lessons[0].results[0], stepId: "only-in-pruned-lesson" }] };
  await writeFile(f.files.stepProgress, `${JSON.stringify({ ...saved, lessons: [pruned, ...saved.lessons] })}\n`);
  assert.equal((await f.learners.readState({ actor: f.actor, includeCompletion: true })).completion.passed, 1);
  assert.equal((await f.owner.read({ actor: f.actor, attemptId: attempt.attemptId })).results.length, 1);
});

test("at the lesson bound a new lesson's results drop the oldest results no retained attempt pins", async t => {
  const f = await fixture(t);
  const attempt = await f.start();
  await f.owner.done({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "try-it", requestId: "done-1" });
  const saved = JSON.parse(await readFile(f.files.stepProgress, "utf8"));
  const current = saved.lessons[0];
  const unpinned = Array.from({ length: 128 }, (_, index) => ({ ...current,
    lesson: { code: `OLD-${index}`, hash: createHash("sha256").update(String(index)).digest("hex") } }));
  // The current lesson's entry is the most recently written; 127 older ones
  // fill the bound with it, then a full bound of unpinned ones without it.
  await writeFile(f.files.stepProgress, `${JSON.stringify({ ...saved, lessons: [...unpinned.slice(1), current] })}\n`);
  await f.owner.answer({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "pick-answer", selected: [1], requestId: "answer-1" });
  let kept = JSON.parse(await readFile(f.files.stepProgress, "utf8")).lessons;
  assert.equal(kept.length, 128, "an existing entry is replaced in place of the bound");
  await writeFile(f.files.stepProgress, `${JSON.stringify({ ...saved, lessons: unpinned })}\n`);
  await f.owner.done({ ...api, actor: f.actor, attemptId: attempt.attemptId, stepId: "try-it", requestId: "done-2" });
  kept = JSON.parse(await readFile(f.files.stepProgress, "utf8")).lessons;
  assert.equal(kept.length, 128);
  assert.deepEqual(kept.slice(0, 127).map(entry => entry.lesson.code), unpinned.slice(1).map(entry => entry.lesson.code),
    "only the oldest unpinned lesson content made room");
  assert.deepEqual(kept.at(-1).lesson, current.lesson);
  assert.equal((await f.learners.readState({ actor: f.actor, includeCompletion: true })).completion.passed, 1);
});

test("v1 lessons refuse step writes and keep their assessment completion read", async t => {
  const v1 = await fixture(t, { lessonVersion: 1 });
  const attempt = await v1.start();
  await assert.rejects(v1.learners.updateStepProgress({ actor: v1.actor, attemptId: attempt.attemptId }, async () => null),
    { code: "VIBE64_TRAINING_LESSON_VERSION" });
  await assert.rejects(v1.owner.done({ ...api, actor: v1.actor, attemptId: attempt.attemptId, stepId: "try-it", requestId: "done-1" }),
    { code: "VIBE64_TRAINING_LESSON_VERSION" });
  assert.equal((await v1.learners.readState({ actor: v1.actor, includeCompletion: true })).completion.required, 1, "v1 keeps its assessment path");
});
