import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCourseLock, readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";
import { createTrainingContentInstaller } from "../../packages/vibe64-training/src/server/contentInstaller.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createPracticeHistoryReader } from "../../packages/vibe64-training/src/server/practiceHistoryReader.js";
import { upgradeLearningPracticeHistory } from "../../packages/vibe64-training/src/server/practiceHistoryUpgrade.js";

// The frozen reader of version 1 learner progress (vibe64 0.1.35 to Learning
// v2 Rev 3), used only by the published 20261008-learning-practice-history
// upgrade. Its records are written here as that release saved them; the live
// learner state no longer writes this format. Moved from the learner-state
// suite with the read paths themselves.
async function fixture(t, { noExercise = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibe64-practice-history-reader-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "system");
  const sourceRoot = path.join(root, "source");
  await fs.mkdir(systemRoot, { mode: 0o700 });
  async function write(filename, value, base = sourceRoot) {
    const destination = path.join(base, filename);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  await write("package.json", { name: "learn-history-fixture", version: "0.1.0",
    repository: { type: "git", url: "https://github.com/examples/learn-history-fixture.git" },
    vibe64Training: { schemaVersion: 1, topicId: "intro-topic", domainId: "vibe64", title: "One introduction", status: "preview",
      outline: "training/outline.md", prerequisites: [],
      lessons: [{ code: "INTRO-01", descriptor: "training/lessons/INTRO-01/lesson.json", status: "published", required: true }] } });
  await write("training/outline.md", "# One introduction\n");
  await write("training/lessons/INTRO-01/lesson.json", { schemaVersion: 1, code: "INTRO-01", title: "Try the practice app", document: "lesson.md",
    prerequisites: [], estimatedMinutes: 10, visuals: [],
    ...(noExercise ? {} : { exercise: { kind: "bundled", source: "../../exercises/app", reuse: "attempt" } }),
    assessments: [{ id: "explain", kind: "answer", required: true, rubric: "lesson.md#explain" }] });
  await write("training/lessons/INTRO-01/lesson.md", '# Try the app\n<a id="explain"></a>\nExplain what you tried.\n');
  await write("training/exercises/app/package.json", { name: "history-practice-app", private: true, type: "module" });
  await write("training/exercises/app/server.mjs", "export {};\n");
  execFileSync("git", ["-C", sourceRoot, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", sourceRoot, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", sourceRoot, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Training fixture",
    "-c", "user.email=training@example.invalid", "commit", "-m", "Pinned introduction"], { stdio: "ignore" });
  const sourcePin = await readPinnedTopic(sourceRoot);
  const topicPin = { schemaVersion: 1, topicId: sourcePin.topicId, release: sourcePin.release, repository: sourcePin.repository,
    commit: sourcePin.commit, topicHash: sourcePin.topicHash };
  await createTrainingContentInstaller({ systemRoot }).installTopic({ sourceRoot, pin: topicPin });
  const lock = createCourseLock({ schemaVersion: 1, courseId: "intro-course", title: "Introduction", release: "0.1.0", status: "preview",
    topics: [{ topicId: topicPin.topicId, release: topicPin.release }] }, [sourcePin]);
  const pin = { course: { courseId: lock.courseId, release: lock.release }, topic: topicPin,
    lesson: { code: lock.topics[0].lessons[0].code, hash: lock.topics[0].lessons[0].hash } };
  const actor = { uid: 42 };
  const userRoot = path.join(systemRoot, "training/users", Buffer.from("42").toString("base64url"));
  const installed = createInstalledTrainingContent({ systemRoot });
  const reader = createPracticeHistoryReader({ systemRoot, content: installed });

  // Saves version 1 progress and its derived summary as vibe64 0.1.35 did:
  // each attempt is one reservation, each end one more revision.
  async function saveV1(attempts) {
    let revision = 0;
    const saved = attempts.map(({ attemptId = randomUUID(), preparation = noExercise ? undefined : { phase: "reserved" }, reason, learning, practiceId }) => {
      revision++;
      const attempt = { attemptId, ...(practiceId ? { practiceId } : {}), requestIds: [`start-${revision}`], createdAt: "2026-10-01T00:00:00.000Z", pin,
        ...(preparation ? { projectSlug: `training-${(practiceId || attemptId).replaceAll("-", "")}`,
          preparation: typeof preparation === "function" ? preparation(attemptId) : preparation } : {}),
        ...(learning ? { learning: learning(attemptId) } : {}) };
      if (reason) attempt.ended = { requestId: `end-${revision}`, revision: ++revision, reason };
      return attempt;
    });
    const active = saved.find(attempt => !attempt.ended) || null;
    await write("progress.json", { schemaVersion: 1, learnerId: "42", revision, activeAttemptId: active?.attemptId ?? null, attempts: saved }, userRoot);
    await write("active-lesson.json", active
      ? { schemaVersion: 1, learnerId: "42", progressRevision: revision, attemptId: active.attemptId, ...(active.practiceId ? { practiceId: active.practiceId } : {}),
        pin, ...(active.preparation ? { projectSlug: active.projectSlug, preparation: active.preparation } : {}), ...(active.learning ? { learning: active.learning } : {}) }
      : { schemaVersion: 1, learnerId: "42", progressRevision: revision, attemptId: null }, userRoot);
    return saved;
  }
  return { root, systemRoot, pin, actor, userRoot, installed, reader, saveV1, write };
}

async function treeState(directory) {
  const result = [];
  async function visit(filename) {
    const stat = await fs.lstat(filename);
    const relative = path.relative(directory, filename);
    if (stat.isDirectory()) {
      result.push({ path: relative, directory: true, mode: stat.mode, mtime: stat.mtimeMs });
      for (const name of (await fs.readdir(filename)).sort()) await visit(path.join(filename, name));
    } else result.push({ path: relative, mode: stat.mode, mtime: stat.mtimeMs, hash: createHash("sha256").update(await fs.readFile(filename)).digest("hex") });
  }
  await visit(directory);
  return result;
}

const answered = attemptId => ({ submissions: [{ submissionId: "saved-answer", assessmentId: "explain", kind: "answer", rubric: "lesson.md#explain",
  rubricRevision: "", outcome: "passed", assistance: "none", explanation: "The saved answer met the rubric.",
  recordedAt: "2026-10-06T01:00:00.000Z", evidence: { kind: "answer", learnerId: "42", attemptId, messageId: "message-1",
    questionId: "question-1", text: "The browser asks and the server answers." } }] });

test("the frozen reader reads vibe64 0.1.35 progress, its retired learning records and exercise scopes without writes", async t => {
  const f = await fixture(t);
  const learning = attemptId => {
    const value = answered(attemptId);
    value.submissions[0].rubricRevision = f.pin.lesson.hash;
    return value;
  };
  const preparing = attemptId => ({ phase: "preparing", initialSessionId: `training-${attemptId}` });
  const [ended, active] = await f.saveV1([{ reason: "restart", preparation: preparing, learning }, { preparation: preparing }]);
  const before = await treeState(f.systemRoot);
  const state = await f.reader.readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual(state.progress.attempts, [ended, active]);
  assert.equal(state.activeSummaryCurrent, true);
  assert.deepEqual(state.lessonCompletions, [{ lessonCode: "INTRO-01", lessonHash: f.pin.lesson.hash, required: 1, passed: 1,
    completed: true, open: true }], "a retired format-1 pass counts toward completion at its exact pin");
  assert.equal(state.completion.completed, true);
  const scope = await f.reader.readExerciseProjectScope({ actor: f.actor, attemptId: active.attemptId, access: "create" });
  assert.deepEqual(scope, { scope: { learnerId: "42", attemptId: active.attemptId, pin: f.pin, noExercise: false }, systemRoot: f.systemRoot,
    training: { schemaVersion: 1, learnerKey: "NDI", attemptId: active.attemptId, pin: f.pin,
      exercise: { kind: "bundled", sourcePath: "training/exercises/app" } },
    projectSlug: active.projectSlug, initialSessionId: `training-${active.attemptId}`, active: true, activeSummaryCurrent: true });
  const historical = await f.reader.readExerciseProjectScope({ actor: f.actor, attemptId: ended.attemptId, access: "control" });
  assert.equal(historical.active, false);
  for (const access of ["write", "create"]) {
    await assert.rejects(() => f.reader.readExerciseProjectScope({ actor: f.actor, attemptId: ended.attemptId, access }),
      { code: "VIBE64_TRAINING_ATTEMPT_INACTIVE" });
  }
  await assert.rejects(() => f.reader.readExerciseProjectScope({ actor: { uid: 43 }, attemptId: active.attemptId }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  await assert.rejects(() => f.reader.readExerciseProjectScope({ actor: f.actor, attemptId: "../attempt" }));
  await assert.rejects(() => f.reader.readExerciseProjectScope({ actor: f.actor, attemptId: active.attemptId, access: "all" }));
  assert.deepEqual(await treeState(f.systemRoot), before);
  assert.equal(Object.hasOwn(f.reader, "reserveAttempt"), false, "the reader has no writer");
});

test("the frozen reader keeps its refusals: invalid records, continued practice, changed content and missing exercises", async t => {
  const f = await fixture(t);
  const [first, continued] = await f.saveV1([{ reason: "left" }, { practiceId: undefined }]);
  const progressFile = path.join(f.userRoot, "progress.json");
  const progress = JSON.parse(await fs.readFile(progressFile, "utf8"));
  for (const invalid of [{ ...progress, schemaVersion: 2 }, { ...progress, learnerId: "43" },
    { ...progress, attempts: [{ ...first, ended: { ...first.ended, reason: "archived" } }, continued] }]) {
    await f.write("progress.json", invalid, f.userRoot);
    await assert.rejects(() => f.reader.readState({ actor: f.actor }), { code: "VIBE64_TRAINING_STATE_INVALID" });
  }
  // Rev 3 Continue lesson: an attempt in an earlier attempt's practice project.
  const [, inPractice] = await f.saveV1([{ reason: "left", attemptId: first.attemptId }, { practiceId: first.attemptId }]);
  await assert.rejects(() => f.reader.readExerciseProjectScope({ actor: f.actor, attemptId: inPractice.attemptId }),
    { code: "VIBE64_TRAINING_ATTEMPT_CONFLICT" });
  const [active] = await f.saveV1([{}]);
  const input = { actor: f.actor, attemptId: active.attemptId, access: "create" };
  for (const changed of [{ pin: { ...f.pin.topic, release: "9.9.9" } }, { lessonCode: "OTHER" }, { lessonHash: "f".repeat(64) }]) {
    const mismatched = createPracticeHistoryReader({ systemRoot: f.systemRoot, content: { readLesson: f.installed.readLesson,
      async readExercise(value) { return { ...await f.installed.readExercise(value), ...changed }; } } });
    await assert.rejects(() => mismatched.readExerciseProjectScope(input), /installed topic differs from the admitted reservation pin/u);
  }
  const unavailable = createPracticeHistoryReader({ systemRoot: f.systemRoot, content: { readLesson: f.installed.readLesson } });
  await assert.rejects(() => unavailable.readExerciseProjectScope(input), { code: "VIBE64_TRAINING_EXERCISE_UNAVAILABLE" });
  assert.throws(() => createPracticeHistoryReader({ systemRoot: f.systemRoot, content: {} }), /configured installed-content reader/u);
  const learning = answered(active.attemptId);
  learning.submissions[0].rubricRevision = f.pin.lesson.hash;
  learning.submissions[0].rubric = "lesson.md#other";
  await f.saveV1([{ attemptId: active.attemptId, learning: () => learning }]);
  await assert.rejects(() => f.reader.readState({ actor: f.actor, includeCompletion: true }), /exact pinned assessment/u);

  const absent = await fixture(t, { noExercise: true });
  const [lesson] = await absent.saveV1([{}]);
  await assert.rejects(() => absent.reader.readExerciseProjectScope({ actor: absent.actor, attemptId: lesson.attemptId }), {
    code: "VIBE64_TRAINING_EXERCISE_MISSING", statusCode: 409 });
});

test("the published practice-history upgrade checks 0.1.35 progress through the frozen reader", async t => {
  const f = await fixture(t);
  const backupRoot = path.join(f.systemRoot, "upgrades/backups/20261008-learning-practice-history");
  const run = async () => {
    const reports = [];
    await upgradeLearningPracticeHistory({ systemRoot: f.systemRoot, backupRoot, apply: false,
      report: (level, message) => reports.push({ level, message }) });
    return reports;
  };
  const preparing = attemptId => ({ phase: "preparing", initialSessionId: `training-${attemptId}` });
  const [, unprepared] = await f.saveV1([{ reason: "restart" }, { preparation: preparing }]);
  const before = await treeState(path.join(f.systemRoot, "training"));
  const reports = await run();
  assert.ok(reports.some(value => value.level === "warning" &&
    value.message === `Practice ${unprepared.projectSlug} has no initial project yet; preparing progress remains unchanged.`), JSON.stringify(reports));
  assert.deepEqual(await treeState(path.join(f.systemRoot, "training")), before, "checking changes no learner state");
  const ready = attemptId => ({ phase: "ready", initialSessionId: `training-${attemptId}`, observedAt: "2026-10-01T00:00:01.000Z" });
  const [prepared] = await f.saveV1([{ preparation: ready }]);
  await assert.rejects(run, new RegExp(`Prepared practice ${prepared.projectSlug} has no original runtime`, "u"));
});
