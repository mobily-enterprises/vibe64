import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingTeachingBrief } from "../../packages/vibe64-training/src/server/teachingBrief.js";

async function fixture(t, extraText = "") {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-teaching-brief-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const systemRoot = path.join(root, "system");
  await mkdir(source);
  await mkdir(systemRoot);
  async function write(base, filename, value) {
    const destination = path.join(base, filename);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  const lesson = {
    schemaVersion: 1, code: "USE-ALPHA", title: "Try a practice app", document: "lesson.md",
    prerequisites: [], estimatedMinutes: 10,
    visuals: [{ id: "greeting-flow", descriptor: "../../visuals/flow/visual.json" }],
    exercise: { kind: "bundled", source: "../../exercises/app", reuse: "attempt" },
    checks: [{ id: "reply", file: "../../checks/reply.mjs" }],
    assessments: [
      { id: "explain", kind: "answer", required: true, rubric: "lesson.md#explain" },
      { id: "try-app", kind: "practical", required: true, rubric: "lesson.md#try-app",
        evidence: { producer: "exercise", operation: "use-button", check: "reply", explanationRequired: true } }
    ]
  };
  const teachingText = `# Try a practice app\nTry the real app, then describe what happened.\n${extraText}\n<a id="explain"></a>\nExplain where to try the application. Give a hint, then a fresh question.\n<a id="try-app"></a>\nUse the real button and explain the reply; a teacher's click cannot pass.\n`;
  const visual = {
    schemaVersion: 1, id: "greeting-flow", title: "A greeting returns", svg: "diagram.svg", controller: "controller.js",
    initialState: "overview", states: ["overview", "reply-arrived"], description: "The app replies to the page.",
    commands: [{ name: "showReply", parameters: [{ name: "label", required: true, maxLength: 32 }], completionState: "reply-arrived", description: "The greeting arrives." }]
  };
  await write(source, "package.json", {
    name: "learn-teaching-fixture", version: "0.1.0", repository: { type: "git", url: "https://github.com/examples/learn-teaching-fixture.git" },
    vibe64Training: { schemaVersion: 1, topicId: "teaching-fixture", domainId: "vibe64", title: "Teaching fixture", status: "preview",
      outline: "training/outline.md", prerequisites: [], lessons: [{ code: lesson.code, descriptor: "training/lessons/USE-ALPHA/lesson.json", status: "published", required: true }] }
  });
  await write(source, "training/outline.md", "# Teaching fixture\nOne introduction.\n");
  await write(source, "training/lessons/USE-ALPHA/lesson.json", lesson);
  await write(source, "training/lessons/USE-ALPHA/lesson.md", teachingText);
  await write(source, "training/visuals/flow/visual.json", visual);
  await write(source, "training/visuals/flow/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>SVG_SOURCE_ONLY</title><circle id="packet" cx="10" cy="10" r="5"/></svg>');
  await write(source, "training/visuals/flow/controller.js", 'throw new Error("CONTROLLER_SOURCE_MUST_NOT_RUN");\n');
  await write(source, "training/exercises/app/server.mjs", 'import { createServer } from "node:http";\ncreateServer((request, response) => response.end("EXERCISE_SOURCE_ONLY")).listen(8080, "127.0.0.1");\n');
  await write(source, "training/checks/reply.mjs", 'throw new Error("CHECK_SOURCE_MUST_NOT_RUN");\n');
  const commit = "a".repeat(40);
  const snapshotRoot = path.join(systemRoot, "training/content/teaching-fixture", commit);
  await mkdir(path.dirname(snapshotRoot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshotRoot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshotRoot, "bundle.json"), "utf8"));
  const topic = { schemaVersion: 1, topicId: "teaching-fixture", release: "0.1.0", repository: "examples/learn-teaching-fixture", commit, topicHash: bundle.topicHash };
  await write(snapshotRoot, "pin.json", topic);
  const actor = { uid: "alice" };
  const learners = createTrainingLearnerState({ systemRoot });
  const reservation = await learners.reserveAttempt({ actor, requestId: "start-one", expectedRevision: 0,
    pin: { course: { courseId: "introduction", release: "0.1.0" }, topic, lesson: { code: lesson.code, hash: bundle.lessons[0].hash } } });
  const brief = createTrainingTeachingBrief({ systemRoot });
  return { systemRoot, snapshotRoot, actor, learners, brief, reservation, lesson, visual, teachingText, write };
}

async function inventory(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else files.push({ path: path.relative(root, filename), hash: createHash("sha256").update(await readFile(filename)).digest("hex") });
    }
  }
  await visit(root);
  return files;
}

test("fresh brief preserves generic pinned text, rubrics and evidence without executable content or writes", async t => {
  const f = await fixture(t);
  const before = await inventory(f.systemRoot);
  const result = await f.brief.readBrief({ actor: f.actor, attemptId: f.reservation.attempt.attemptId });
  assert.deepEqual(result.pin, f.reservation.attempt.pin);
  assert.equal(result.lesson.code, "USE-ALPHA");
  assert.equal(result.lesson.teachingText, f.teachingText);
  assert.equal(result.lesson.assessments[0].rubric.reference, "lesson.md#explain");
  assert.match(result.lesson.assessments[0].rubric.text, /fresh question/u);
  assert.doesNotMatch(result.lesson.assessments[0].rubric.text, /real button/u);
  assert.deepEqual(result.lesson.assessments[1].evidence, f.lesson.assessments[1].evidence);
  assert.deepEqual(result.lesson.visuals[0].commands, f.visual.commands);
  assert.deepEqual(result.preparation, { phase: "reserved" });
  assert.deepEqual(result.learning.completion, { lessonCode: "USE-ALPHA", lessonHash: f.reservation.attempt.pin.lesson.hash, required: 2, passed: 0, completed: false });
  assert.deepEqual(result.learning.submissions, []);
  assert.deepEqual(result.learning.passedAssessmentIds, []);
  assert.deepEqual(result.learning.remainingAssessmentIds, ["explain", "try-app"]);
  assert.equal(result.learning.resume, null);
  assert.match(result.pacing.join("\n"), /one short question at a time/u);
  assert.match(result.pacing.join("\n"), /acceptance is pending/u);
  assert.doesNotMatch(JSON.stringify(result), /SVG_SOURCE_ONLY|CONTROLLER_SOURCE_MUST_NOT_RUN|EXERCISE_SOURCE_ONLY|CHECK_SOURCE_MUST_NOT_RUN|descriptorPath|controller\.js|server\.mjs/u);
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("brief retains authoritative results, assistance and saved question/visual state without pretending playback completed", async t => {
  const f = await fixture(t);
  const { attemptId } = f.reservation.attempt;
  const pendingQuestion = { id: "question-one", assessmentId: "explain", text: "Where would you try the app?" };
  const snapshot = { state: "reply-arrived", paused: true, labels: { port: "Running app", request: "Ask", work: "Prepare greeting", response: "Hello" } };
  const saved = await f.learners.saveLessonResume({ actor: f.actor, attemptId, expectedRevision: f.reservation.revision, requestId: "resume-one",
    resume: { stage: "question", pendingQuestion, visuals: [{ visualId: "greeting-flow", snapshot }], summary: "The learner tried Preview and is considering where to check a change." } });
  const recorded = await f.learners.recordAssessment({ actor: f.actor, attemptId, expectedRevision: saved.revision, submissionId: "answer-one",
    assessmentId: "explain", outcome: "passed", evidence: { kind: "answer", learnerId: "alice", attemptId, text: "I would use Preview and try the app.", messageId: "learner-message-one", questionId: pendingQuestion.id },
    explanation: "Identifies trying the application in Preview.", assistance: "hint" });
  const before = await inventory(f.systemRoot);
  const result = await f.brief.readBrief({ actor: f.actor, attemptId });
  assert.equal(result.revision, recorded.revision);
  assert.deepEqual(result.learning.completion, recorded.completion);
  assert.equal(result.learning.completion.passed, 1);
  assert.equal(result.learning.completion.completed, false);
  assert.deepEqual(result.learning.submissions, recorded.attempt.learning.submissions);
  assert.deepEqual(result.learning.resume.pendingQuestion, pendingQuestion);
  assert.deepEqual(result.learning.passedAssessmentIds, ["explain"]);
  assert.deepEqual(result.learning.remainingAssessmentIds, ["try-app"]);
  assert.match(result.pacing.join("\n"), /pendingQuestion may belong to an already-passed assessment/u);
  assert.match(result.pacing.join("\n"), /control request, not a learner answer/u);
  assert.deepEqual(result.learning.resume.visuals, [{ visualId: "greeting-flow", snapshot }]);
  assert.match(result.pacing.join("\n"), /not live playback receipts/u);
  assert.match(result.pacing.join("\n"), /not current Preview readiness/u);
  assert.equal(Object.hasOwn(result.lesson.visuals[0], "completed"), false);
  result.learning.resume.visuals[0].snapshot.labels.response = "Caller changed this";
  assert.deepEqual((await f.brief.readBrief({ actor: f.actor, attemptId })).learning.resume.visuals[0].snapshot, snapshot);
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("brief reads newer durable progress with a missing summary without repairing it", async t => {
  const f = await fixture(t);
  const key = Buffer.from("alice").toString("base64url");
  await rm(path.join(f.systemRoot, "training/users", key, "active-lesson.json"));
  const before = await inventory(f.systemRoot);
  const result = await f.brief.readBrief({ actor: f.actor, attemptId: f.reservation.attempt.attemptId });
  assert.equal(result.activeSummaryCurrent, false);
  assert.equal(result.learning.completion.completed, false);
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("other actors and wrong attempt identities cannot obtain a saved teaching brief or create state", async t => {
  const f = await fixture(t);
  const before = await inventory(f.systemRoot);
  await assert.rejects(() => f.brief.readBrief({ actor: { uid: "bob" }, attemptId: f.reservation.attempt.attemptId }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await assert.rejects(() => f.brief.readBrief({ actor: f.actor, attemptId: "another-attempt" }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await assert.rejects(() => f.brief.readBrief({ attemptId: f.reservation.attempt.attemptId }), /actor/u);
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("missing or changed pinned content retains the installed owner's errors before a brief is returned", async t => {
  const f = await fixture(t);
  const documentPath = "files/training/lessons/USE-ALPHA/lesson.md";
  await f.write(f.snapshotRoot, documentPath, `${f.teachingText}\nUnexpected edit.\n`);
  const changed = await inventory(f.systemRoot);
  await assert.rejects(() => f.brief.readBrief({ actor: f.actor, attemptId: f.reservation.attempt.attemptId }), { code: "VIBE64_TRAINING_CONTENT_INVALID" });
  assert.deepEqual(await inventory(f.systemRoot), changed);
  await rm(path.join(f.snapshotRoot, documentPath));
  const missing = await inventory(f.systemRoot);
  await assert.rejects(() => f.brief.readBrief({ actor: f.actor, attemptId: f.reservation.attempt.attemptId }), { code: "VIBE64_TRAINING_CONTENT_MISSING" });
  assert.deepEqual(await inventory(f.systemRoot), missing);
});

test("oversized canonical teaching material fails explicitly rather than truncating a rubric", async t => {
  const f = await fixture(t, "A".repeat(132 * 1024));
  const before = await inventory(f.systemRoot);
  await assert.rejects(() => f.brief.readBrief({ actor: f.actor, attemptId: f.reservation.attempt.attemptId }), {
    code: "VIBE64_TRAINING_BRIEF_TOO_LARGE"
  });
  assert.deepEqual(await inventory(f.systemRoot), before);
});

test("brief distinguishes retained exact-pin answer and practical passes from the new exercise without copying their receipts", async t => {
  const f = await fixture(t);
  const oldId = f.reservation.attempt.attemptId;
  const preparing = await f.learners.beginPreparation({ actor: f.actor, attemptId: oldId, expectedRevision: f.reservation.revision });
  const ready = await f.learners.recordPreparationReady({ actor: f.actor, attemptId: oldId, expectedRevision: preparing.revision,
    initialSessionId: preparing.attempt.preparation.initialSessionId });
  const saved = await f.learners.saveLessonResume({ actor: f.actor, attemptId: oldId, expectedRevision: ready.revision, requestId: "question-old",
    resume: { stage: "question", pendingQuestion: { id: "question-old", assessmentId: "explain", text: "Where would you try it?" }, visuals: [], summary: "The old attempt's question." } });
  const answer = await f.learners.recordAssessment({ actor: f.actor, attemptId: oldId, expectedRevision: saved.revision,
    submissionId: "answer-old", assessmentId: "explain", outcome: "passed", assistance: "hint", explanation: "The learner independently identifies Preview.",
    evidence: { kind: "answer", learnerId: "alice", attemptId: oldId, messageId: "message-old", questionId: "question-old", text: "I use Preview." } });
  const observed = await f.learners.recordAssessment({ actor: f.actor, attemptId: oldId, expectedRevision: answer.revision,
    submissionId: "practice-old", assessmentId: "try-app", outcome: "passed", assistance: "none", explanation: "The actual exercise observation satisfies the rubric.",
    evidence: { kind: "observation", learnerId: "alice", attemptId: oldId, observationId: "observation-old", observedAt: "2026-10-07T00:00:00.000Z",
      projectSlug: f.reservation.attempt.projectSlug, sessionId: ready.attempt.preparation.initialSessionId, producer: "exercise", operation: "use-button", check: "reply", origin: "learner", text: "I used the button and explained the displayed reply." } });
  const ended = await f.learners.endAttempt({ actor: f.actor, attemptId: oldId, requestId: "end-old", expectedRevision: observed.revision, reason: "restart" });
  const fresh = await f.learners.reserveAttempt({ actor: f.actor, requestId: "start-new", expectedRevision: ended.revision, pin: f.reservation.attempt.pin });
  const before = await inventory(f.systemRoot);
  const result = await f.brief.readBrief({ actor: f.actor, attemptId: fresh.attempt.attemptId });
  assert.equal(result.learning.completion.completed, true);
  assert.equal(result.learning.completion.passed, 2);
  assert.deepEqual(result.learning.passedAssessmentIds, ["explain", "try-app"]);
  assert.deepEqual(result.learning.remainingAssessmentIds, []);
  assert.deepEqual(result.learning.submissions, []);
  assert.equal(result.learning.resume, null);
  assert.deepEqual(result.preparation, { phase: "reserved" });
  assert.deepEqual(result.learning.retainedPasses, observed.attempt.learning.submissions.map(submission => ({
    attemptId: oldId, pin: f.reservation.attempt.pin, submission
  })));
  assert.equal(result.learning.retainedPasses[1].submission.evidence.projectSlug, f.reservation.attempt.projectSlug);
  assert.notEqual(result.projectSlug, f.reservation.attempt.projectSlug);
  assert.match(result.pacing.join("\n"), /historical practical evidence is not a new exercise observation/u);
  await assert.rejects(() => f.brief.readBrief({ actor: f.actor, attemptId: oldId }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  assert.deepEqual(await inventory(f.systemRoot), before);
  result.learning.retainedPasses[0].submission.evidence.text = "Caller mutation";
  assert.equal((await f.brief.readBrief({ actor: f.actor, attemptId: fresh.attempt.attemptId })).learning.retainedPasses[0].submission.evidence.text, "I use Preview.");
  assert.deepEqual(await inventory(f.systemRoot), before);
});
