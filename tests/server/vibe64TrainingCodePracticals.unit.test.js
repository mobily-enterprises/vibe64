import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { validateTopic } from "../../packages/vibe64-training/src/server/content.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingDeclaredCheckOwner } from "../../packages/vibe64-training/src/server/declaredCheck.js";
import { createTrainingCodeAuthorship } from "../../packages/vibe64-training/src/server/codeAuthorship.js";
import { createTrainingStepChecks } from "../../packages/vibe64-training/src/server/stepChecks.js";
import { v2Content } from "./vibe64TrainingV2LessonStub.js";
import { createTrainingCodeSaveOwner } from "../../packages/vibe64-training/src/server/codeEditorActions.js";
import { runWithProjectRequestContext } from "../../packages/vibe64-core/src/server/projectRequestContext.js";

// A fixture code lesson executed through the actual bounded native gateway.
// Project/session seams are explicit fixtures; the learner and agent writes are
// simulated file writes, and no real persisted Vibe64 state is touched.
const fixtureTopic = new URL("../fixtures/training/code-practical/", import.meta.url);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const solved = "export function isValidTitle(title) {\n  return title.trim().length > 0;\n}\n";

async function writeTopic(root, change) {
  const source = path.join(root, "topic");
  await cp(fixtureTopic, source, { recursive: true });
  if (change) await change(source);
  return source;
}

const codeStep = { id: "refuse-empty", title: "Refuse empty titles", body: "steps/refuse-empty.md",
  check: { kind: "auto", check: "notes-title-required", files: ["notes.mjs"] }, required: true };

// enter: start on the first step, as the learner's reader does, so its
// starting files are recorded (the retired teacher's v1 code question did this).
async function fixture(t, { check, timeoutSeconds, lessonVersion = 1, steps = [codeStep], enter = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-code-practical-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await writeTopic(root, async topic => {
    if (check) await writeFile(path.join(topic, "checks/notes/title.mjs"), check);
    if (timeoutSeconds) {
      const lesson = JSON.parse(await readFile(path.join(topic, "lesson.json"), "utf8"));
      lesson.checks[0].timeoutSeconds = timeoutSeconds;
      await writeFile(path.join(topic, "lesson.json"), JSON.stringify(lesson));
    }
  });
  const systemRoot = path.join(root, "system");
  const commit = "c".repeat(40), snapshotRoot = path.join(systemRoot, "training/content/code", commit);
  await mkdir(path.dirname(snapshotRoot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshotRoot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshotRoot, "bundle.json"), "utf8"));
  const topic = { schemaVersion: 1, topicId: "code", release: "0.1.0", repository: "examples/learn-code-fixture", commit, topicHash: bundle.topicHash };
  await writeFile(path.join(snapshotRoot, "pin.json"), JSON.stringify(topic));
  const pin = { course: { courseId: "intro", release: "0.1.0" }, topic, lesson: { code: "CODE-ONE", hash: bundle.lessons[0].hash } };
  const installed = createInstalledTrainingContent({ systemRoot });
  const content = lessonVersion === 2 ? v2Content(installed, { steps }) : installed;
  const learners = createTrainingLearnerState({ systemRoot, content });
  const actor = { uid: 42, username: "alice" };
  const reserved = await learners.reserveAttempt({ actor, expectedRevision: 0, requestId: "start", pin });
  const attemptId = reserved.attempt.attemptId, sessionId = `training-${attemptId}`;
  await learners.beginPreparation({ actor, attemptId, expectedRevision: 1 });
  await learners.recordPreparationReady({ actor, attemptId, initialSessionId: sessionId, expectedRevision: 2 });
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime"),
    projectSessionSourceRoot: path.join(root, "managed") });
  const paths = store.paths(sessionId);
  const sourcePath = path.join(root, "managed/sessions/active", sessionId, "source");
  await mkdir(paths.sessionRoot, { recursive: true });
  await cp(path.join(source, "app"), sourcePath, { recursive: true });
  const session = { sessionId, sessionRoot: paths.sessionRoot,
    metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source", source_path: sourcePath } };
  const project = { async runInProjectContext(slug, operation) { assert.equal(slug, reserved.attempt.projectSlug); return operation(); },
    async createRuntime() { return { store, async getSession(id) { assert.equal(id, sessionId); return session; } }; } };
  const calls = [];
  const checks = runCommand => createTrainingDeclaredCheckOwner({ learners, content, project, terminals: { async outputTargetStatus() {} },
    runCommand: async command => { calls.push(command); return (runCommand || runVibe64Command)(command); } });
  const authorship = createTrainingCodeAuthorship({ learners, content, project });
  const learnerFile = path.join(sourcePath, "notes.mjs");
  if (enter) {
    await createTrainingStepChecks({ learners, content, checks: checks(), authorship })
      .enterStep({ actor, attemptId, stepId: steps[0].id });
  }
  // The lesson Code tab's save path with a stand-in for the generic editor's
  // baseHash-checked write; the real wrapper records the ledger entry.
  async function learnerSave(text, { baseHash } = {}) {
    const current = sha256(await readFile(learnerFile));
    const input = { sessionId, path: "notes.mjs", baseHash: baseHash || current, text };
    return authorship.saveLearnerFile({ actor, attemptId, input, async save() {
      if (sha256(await readFile(learnerFile)) !== input.baseHash) return { ok: false, code: "vibe64_source_editor_conflict" };
      await writeFile(learnerFile, text);
      return { ok: true, file: { path: "notes.mjs", hash: sha256(await readFile(learnerFile)) } };
    } });
  }
  const input = { actor, attemptId, sessionId, observationId: randomUUID(), ...(enter ? { stepId: steps[0].id } : {}) };
  return { root, systemRoot, paths, actor, attemptId, sessionId, learners, content, checks, calls, authorship,
    learnerFile, learnerSave, input, project, projectSlug: reserved.attempt.projectSlug };
}

const entered = { lessonVersion: 2, enter: true };

test("an entered code step records its starting files and only the learner's own chained saves verify", async t => {
  const f = await fixture(t, entered);
  const ledger = await f.learners.readCodeLedger({ actor: f.actor, attemptId: f.attemptId });
  assert.deepEqual(ledger.steps[0].baseline, [{ path: "notes.mjs", sha256: sha256(await readFile(f.learnerFile)) }]);
  assert.equal(ledger.steps[0].stepId, "refuse-empty");
  await f.learnerSave("export function isValidTitle(title) {\n  return title.length > 0;\n}\n");
  await f.learnerSave(solved);
  const saved = await f.learners.readCodeLedger({ actor: f.actor, attemptId: f.attemptId });
  assert.equal(saved.entries.length, 1, "consecutive clean saves form one chain link");
  assert.equal(saved.entries[0].saves, 2);
  assert.equal(saved.entries[0].actorId, "42");
  const progress = await readFile(path.join(f.systemRoot, "training/users/NDI/progress.json"));
  const result = await f.checks().runCodeCheck(f.input);
  assert.deepEqual(result.checkResult, { check: "notes-title-required", observationId: f.input.observationId, outcome: "passed" });
  assert.equal(result.authorship, "learner");
  assert.deepEqual(result.files, [{ path: "notes.mjs", sha256: sha256(Buffer.from(solved)) }]);
  assert.deepEqual(await readFile(path.join(f.systemRoot, "training/users/NDI/progress.json")), progress, "checking never writes progress");
  const command = f.calls[0];
  assert.equal(command.execution.operationId, "training-code-check");
  assert.equal(command.timeout, 15000); assert.equal(command.maxBuffer, 4096);
  assert.equal(command.inheritProcessEnv, false); assert.deepEqual(command.baseEnv, {});
  assert.deepEqual(command.allowedRoots.length, 1);
  assert.equal(command.allowedRoots[0].startsWith(`${f.paths.artifactsRoot}/training-code-check-`), true);
  assert.equal(command.cwd, path.join(command.allowedRoots[0], "app"), "the check runs on a private copy, never the live source");
  assert.deepEqual(await readdir(f.paths.artifactsRoot), [], "scope-empty completion removes the scratch copy");
});

test("an incomplete learner attempt reports the check's own reason", async t => {
  const f = await fixture(t, entered);
  await f.learnerSave("export function isValidTitle(title) {\n  return title !== \"\";\n}\n");
  const result = await f.checks().runCodeCheck(f.input);
  assert.equal(result.checkResult.outcome, "not-yet-passed");
  assert.equal(result.authorship, "learner");
  assert.equal(result.reason, "Empty or blank titles are still accepted.");
});

test("another writer in a declared file breaks the chain: automatic not passed without running the check", async t => {
  for (const scenario of ["agent-only", "learner-after-agent", "agent-after-learner", "foreign-write-during-save"]) {
    const f = await fixture(t, entered);
    if (scenario === "agent-after-learner") await f.learnerSave(solved.replace("> 0", ">= 1"));
    if (scenario !== "foreign-write-during-save") await writeFile(f.learnerFile, solved);
    if (scenario === "learner-after-agent") await f.learnerSave(`${solved}\n`);
    if (scenario === "foreign-write-during-save") {
      await f.authorship.saveLearnerFile({ actor: f.actor, attemptId: f.attemptId,
        input: { sessionId: f.sessionId, path: "notes.mjs", baseHash: sha256(await readFile(f.learnerFile)), text: "export const x = 1;\n" },
        async save() { await writeFile(f.learnerFile, solved); return { ok: true, file: { path: "notes.mjs", hash: sha256(Buffer.from(solved)) } }; } });
    }
    const result = await f.checks().runCodeCheck(f.input);
    assert.equal(result.checkResult.outcome, "not-yet-passed", scenario);
    assert.equal(result.authorship, "other", scenario);
    assert.equal(result.reason, "needs an independent attempt: other edits detected in notes.mjs", scenario);
    assert.equal(f.calls.length, 0, `${scenario}: a broken chain never executes code`);
  }
});

test("a check result for other files is rejected", async t => {
  const f = await fixture(t, { ...entered, check: 'import { readFileSync } from "node:fs";\nconst input = JSON.parse(readFileSync(0, "utf8"));\n' +
    'console.log(JSON.stringify({ check: input.check, filesHash: "0".repeat(64), outcome: "verified" }));\n' });
  await f.learnerSave(solved);
  await assert.rejects(f.checks().runCodeCheck(f.input), { code: "VIBE64_TRAINING_CHECK_RESULT_INVALID" });
  assert.deepEqual(await readdir(f.paths.artifactsRoot), []);
});

test("a check that never finishes is not yet passed after its declared timeout", async t => {
  const f = await fixture(t, { ...entered, timeoutSeconds: 1 });
  await f.learnerSave("export function isValidTitle(title) {\n  for (;;) {}\n}\n");
  const result = await f.checks().runCodeCheck(f.input);
  assert.equal(f.calls[0].timeout, 1000);
  assert.equal(result.checkResult.outcome, "not-yet-passed");
  assert.match(result.reason, /stopped after 1 seconds/u);
  assert.deepEqual(await readdir(f.paths.artifactsRoot), []);
});

test("learner code that crashes the check is not yet passed, never an error pass", async t => {
  const f = await fixture(t, entered);
  await f.learnerSave("export function isValidTitle(title) {\n  throw new Error(\"boom\");\n}\n");
  const result = await f.checks().runCodeCheck(f.input);
  assert.equal(result.checkResult.outcome, "not-yet-passed");
  assert.match(result.reason, /stopped with an error/u);
});

test("bundling validates code questions, their files, check kind and timeout", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-code-schema-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal((await validateTopic(await writeTopic(path.join(root, "valid")))).bundles.length, 1);
  const needs = /Code assessment require-note-title needs its declared exercise, files and a code check/u;
  const outside = /names a file outside its bundled exercise/u;
  const invalid = {
    "missing files": [lesson => { delete lesson.assessments[0].evidence.files; }, needs],
    "file outside exercise": [lesson => { lesson.assessments[0].evidence.files = ["../lesson.md"]; }, outside],
    "unbundled file": [lesson => { lesson.assessments[0].evidence.files = ["missing.mjs"]; }, outside],
    "repeated file": [lesson => { lesson.assessments[0].evidence.files = ["notes.mjs", "notes.mjs"]; }, /repeats a declared file/u],
    "response check": [lesson => { delete lesson.checks[0].kind; }, needs],
    "timeout too long": [lesson => { lesson.checks[0].timeoutSeconds = 61; }, /Schema validation failed/u],
    "timeout on response check": [lesson => { lesson.checks.push({ id: "other", file: "checks/notes/title.mjs", timeoutSeconds: 5 }); },
      /Only a code check declares a timeout/u],
    "files on another producer": [lesson => { lesson.assessments[0].evidence.producer = "exercise"; },
      /Only code evidence names edited files or runs a code check/u],
    "no exercise": [lesson => { delete lesson.exercise; }, needs]
  };
  for (const [name, [change, message]] of Object.entries(invalid)) {
    const topic = await writeTopic(path.join(root, name.replaceAll(" ", "-")), async source => {
      const lesson = JSON.parse(await readFile(path.join(source, "lesson.json"), "utf8"));
      change(lesson);
      await writeFile(path.join(source, "lesson.json"), JSON.stringify(lesson));
    });
    await assert.rejects(validateTopic(topic), { message }, name);
  }
});

test("the ordinary Files editor save in the learner's own active practice project is ledgered; every other save is plain", async t => {
  const f = await fixture(t, entered);
  const owner = createTrainingCodeSaveOwner({ authorship: f.authorship, learners: f.learners });
  let plainSaves = 0;
  const save = async text => {
    const current = sha256(await readFile(f.learnerFile));
    const input = { sessionId: f.sessionId, path: "notes.mjs", baseHash: current, text };
    return owner({ input, async save() {
      plainSaves++;
      await writeFile(f.learnerFile, text);
      return { ok: true, file: { path: "notes.mjs", hash: sha256(await readFile(f.learnerFile)) } };
    } });
  };
  const entries = async () => (await f.learners.readCodeLedger({ actor: f.actor, attemptId: f.attemptId })).entries.length;
  const inProject = (slug, actor, operation) => runWithProjectRequestContext({ slug, vibe64User: actor }, operation);
  await inProject("alpha", f.actor, () => save("// another project\n"));
  await inProject(f.projectSlug, { uid: 43, username: "bob" }, () => save("// another person\n"));
  await save("// no project\n");
  assert.equal(plainSaves, 3);
  assert.equal(await entries(), 0, "saves outside the learner's own practice project are not lesson code");
  await inProject(f.projectSlug, f.actor, () => save(solved));
  assert.equal(plainSaves, 4, "the ledgered save still performs the editor's exact save");
  assert.equal(await entries(), 1, "the learner's own practice save records authorship");
  const current = await f.learners.resumeAttempt({ actor: f.actor, attemptId: f.attemptId });
  await f.learners.endAttempt({ actor: f.actor, attemptId: f.attemptId, expectedRevision: current.revision,
    requestId: "end-code-lesson", reason: "restart" });
  await inProject(f.projectSlug, f.actor, () => save("// after the lesson\n"));
  assert.equal(plainSaves, 5, "the ended lesson's project keeps ordinary saves");
  assert.throws(() => createTrainingCodeSaveOwner({ authorship: {}, learners: f.learners }), TypeError);
});

test("a host with several learner stores selects the store holding the practice project's attempt for each save", async t => {
  const f = await fixture(t, entered);
  const selections = [];
  let selected = null;
  const owner = createTrainingCodeSaveOwner({ async selectOwners(input) { selections.push(input); return selected; } });
  let plainSaves = 0;
  const save = async text => owner({ input: { sessionId: f.sessionId, path: "notes.mjs", baseHash: sha256(await readFile(f.learnerFile)), text },
    async save() {
      plainSaves++;
      await writeFile(f.learnerFile, text);
      return { ok: true, file: { path: "notes.mjs", hash: sha256(await readFile(f.learnerFile)) } };
    } });
  const entries = async () => (await f.learners.readCodeLedger({ actor: f.actor, attemptId: f.attemptId })).entries.length;
  const inPractice = operation => runWithProjectRequestContext({ slug: f.projectSlug, vibe64User: f.actor }, operation);
  await runWithProjectRequestContext({ slug: "alpha", vibe64User: f.actor }, () => save("// another project\n"));
  assert.deepEqual(selections, [], "only a practice project selects a learner store");
  await inPractice(() => save("// no store holds this attempt\n"));
  assert.equal(plainSaves, 2);
  assert.equal(await entries(), 0, "no selected store is a plain save");
  assert.deepEqual(selections.map(value => value.attemptId), [f.attemptId]);
  selected = { authorship: f.authorship, learners: f.learners };
  await inPractice(() => save(solved));
  assert.equal(plainSaves, 3);
  assert.equal(await entries(), 1, "the selected store's ledger records the learner's save");
  selected = { authorship: {}, learners: f.learners };
  await assert.rejects(inPractice(() => save("// invalid store\n")), TypeError);
  assert.equal(plainSaves, 3, "an invalid selected store never saves");
  assert.throws(() => createTrainingCodeSaveOwner({ selectOwners: "normal" }), TypeError);
});

test("a v2 code step keys its ledger by the entered step and only the learner's own Check records the pass", async t => {
  const f = await fixture(t, { lessonVersion: 2 });
  assert.equal(await f.learners.readCodeLedger({ actor: f.actor, attemptId: f.attemptId }), null, "no baseline before the step is entered");
  const steps = createTrainingStepChecks({ learners: f.learners, content: f.content, checks: f.checks(), authorship: f.authorship });
  const entered = await steps.saveReader({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty", scroll: 0 });
  assert.deepEqual(entered.baseline.step, { stepId: "refuse-empty", enteredRevision: 0 });
  const ledger = await f.learners.readCodeLedger({ actor: f.actor, attemptId: f.attemptId });
  assert.equal(ledger.question, undefined);
  assert.deepEqual(ledger.steps, [{ stepId: "refuse-empty", enteredRevision: 0, entryStart: 0,
    baseline: [{ path: "notes.mjs", sha256: sha256(await readFile(f.learnerFile)) }] }]);
  await f.learnerSave(solved);
  await steps.enterStep({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty" });
  assert.equal((await f.learners.readCodeLedger({ actor: f.actor, attemptId: f.attemptId })).entries.length, 1,
    "re-entering the same step keeps its baseline and the learner's saves");
  await assert.rejects(f.checks().runCodeCheck(f.input), { code: "VIBE64_TRAINING_CHECK_UNDECLARED" }, "a v2 lesson needs the step");
  const direct = await f.checks().runCodeCheck({ ...f.input, stepId: "refuse-empty" });
  assert.deepEqual(direct.checkResult, { check: "notes-title-required", observationId: f.input.observationId, outcome: "passed" });
  assert.equal(direct.authorship, "learner");
  const stepProgress = path.join(f.systemRoot, "training/users/NDI/step-progress.json");
  const byAssistant = await steps.runCheck({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty", requestId: "colleague-check",
    context: { channel: "automation" } });
  assert.equal(byAssistant.outcome, "passed");
  assert.equal(byAssistant.recorded, false, "an assistant-triggered check never writes a pass");
  await assert.rejects(readFile(stepProgress), { code: "ENOENT" });
  assert.equal((await f.learners.readState({ actor: f.actor, includeCompletion: true })).completion.completed, false);
  const byLearner = await steps.runCheck({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty", requestId: "learner-check", context: { channel: "api" } });
  assert.deepEqual({ outcome: byLearner.outcome, recorded: byLearner.recorded }, { outcome: "passed", recorded: true });
  const saved = JSON.parse(await readFile(stepProgress, "utf8")).attempts[0].results[0];
  assert.equal(saved.origin, "check");
  assert.equal(saved.evidence.checkId, "notes-title-required");
  assert.equal(saved.evidence.filesHash, sha256(JSON.stringify([{ path: "notes.mjs", sha256: sha256(Buffer.from(solved)) }])));
  const completed = await f.learners.readState({ actor: f.actor, includeCompletion: true });
  assert.deepEqual(completed.completion, { lessonCode: "CODE-ONE", lessonHash: completed.progress.attempts[0].pin.lesson.hash,
    required: 1, passed: 1, completed: true });
});

test("another writer in a v2 step's file breaks its chain: an automatic not passed without running the check", async t => {
  const f = await fixture(t, { lessonVersion: 2 });
  const steps = createTrainingStepChecks({ learners: f.learners, content: f.content, checks: f.checks(), authorship: f.authorship });
  const missing = await f.checks().runCodeCheck({ ...f.input, stepId: "refuse-empty" });
  assert.equal(missing.checkResult.outcome, "not-yet-passed");
  assert.match(missing.reason, /this step has no recorded starting files/u);
  await steps.enterStep({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty" });
  await writeFile(f.learnerFile, solved);
  const result = await steps.runCheck({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty", requestId: "learner-check", context: { channel: "api" } });
  assert.deepEqual({ outcome: result.outcome, recorded: result.recorded }, { outcome: "not-yet-passed", recorded: true });
  assert.equal(result.reason, "needs an independent attempt: other edits detected in notes.mjs");
  assert.equal(f.calls.length, 0, "a broken chain never executes code");
});

// Code already present when a code step is first entered (written by the
// coding agent, Colleague, Git or an earlier step) is the step's starting
// point, never the learner's work for it.
test("a v2 code step never passes on code written before it was entered; the learner must change each declared file", async t => {
  const f = await fixture(t, { lessonVersion: 2 });
  const steps = createTrainingStepChecks({ learners: f.learners, content: f.content, checks: f.checks(), authorship: f.authorship });
  await writeFile(f.learnerFile, solved);
  await steps.enterStep({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty" });
  const untouched = await steps.runCheck({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty", requestId: "learner-check-1",
    context: { channel: "api" } });
  assert.deepEqual({ outcome: untouched.outcome, recorded: untouched.recorded }, { outcome: "not-yet-passed", recorded: true });
  assert.equal(untouched.reason, "needs your own change: edit notes.mjs yourself in Dashboard → Files during this step, then press Check now");
  assert.equal(f.calls.length, 0, "an unchanged file never executes code");
  await f.learnerSave(`${solved}// mine\n`);
  const changed = await steps.runCheck({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty", requestId: "learner-check-2",
    context: { channel: "api" } });
  assert.deepEqual({ outcome: changed.outcome, recorded: changed.recorded }, { outcome: "passed", recorded: true });
});

test("each v2 code step keeps the baseline of its first entry when the learner moves between code steps", async t => {
  const second = { ...codeStep, id: "refuse-empty-again", title: "Again" };
  const f = await fixture(t, { lessonVersion: 2, steps: [codeStep, second] });
  const steps = createTrainingStepChecks({ learners: f.learners, content: f.content, checks: f.checks(), authorship: f.authorship });
  const start = sha256(await readFile(f.learnerFile));
  await steps.enterStep({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty" });
  await steps.enterStep({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty-again" });
  await writeFile(f.learnerFile, solved);
  await steps.enterStep({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty" });
  await steps.enterStep({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty-again" });
  const ledger = await f.learners.readCodeLedger({ actor: f.actor, attemptId: f.attemptId });
  assert.deepEqual(ledger.steps.map(step => [step.stepId, step.baseline[0].sha256]), [["refuse-empty", start], ["refuse-empty-again", start]],
    "switching steps never adopts the intervening edit as a new start");
  for (const stepId of ["refuse-empty", "refuse-empty-again"]) {
    const result = await steps.runCheck({ actor: f.actor, attemptId: f.attemptId, stepId, requestId: `check-${stepId}`, context: { channel: "api" } });
    assert.equal(result.outcome, "not-yet-passed");
    assert.equal(result.reason, "needs an independent attempt: other edits detected in notes.mjs");
  }
  assert.equal(f.calls.length, 0);
});

test("a v2 step entered after earlier learner saves starts at that point and counts only later saves", async t => {
  const second = { ...codeStep, id: "refuse-empty-again", title: "Again" };
  const f = await fixture(t, { lessonVersion: 2, steps: [codeStep, second] });
  const steps = createTrainingStepChecks({ learners: f.learners, content: f.content, checks: f.checks(), authorship: f.authorship });
  await steps.enterStep({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty" });
  await f.learnerSave(solved);
  await steps.enterStep({ actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty-again" });
  const learner = { context: { channel: "api" } };
  assert.equal((await steps.runCheck({ ...learner, actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty", requestId: "first" })).outcome, "passed");
  const again = await steps.runCheck({ ...learner, actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty-again", requestId: "second-1" });
  assert.match(again.reason, /needs your own change/u, "the first step's save is the second step's starting point");
  await f.learnerSave(`${solved}// again\n`);
  const ledger = await f.learners.readCodeLedger({ actor: f.actor, attemptId: f.attemptId });
  assert.equal(ledger.entries.length, 2, "a save after a later step entry never collapses into an earlier link");
  assert.equal((await steps.runCheck({ ...learner, actor: f.actor, attemptId: f.attemptId, stepId: "refuse-empty-again", requestId: "second-2" })).outcome, "passed");
});
