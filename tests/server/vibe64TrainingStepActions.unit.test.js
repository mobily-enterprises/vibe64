import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingStepChecks } from "../../packages/vibe64-training/src/server/stepChecks.js";
import { createTrainingStepActions } from "../../packages/vibe64-training/src/server/stepActions.js";
import { createTrainingLearnerChangedPublisher } from "../../packages/vibe64-training/src/server/learnerEvents.js";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "../../packages/vibe64-training/src/shared/learnerEvents.js";
import { registerTrainingRoutes } from "../../packages/vibe64-training/src/server/registerRoutes.js";
import { createTrainingActions } from "../../packages/vibe64-training/src/server/actions.js";
import { createTrainingService } from "../../packages/vibe64-training/src/server/preparation.js";

// Learning v2 actions (contract C3) over the real installed v2 fixture
// (contract C1), the real learner store and step owner (contract C2). Only the
// App check runner, inner session actions and the practice facility are stubs.
const fixtureTopic = new URL("../fixtures/training/steps-v2/", import.meta.url);
const BROWSER_ONLY = ["step.observe", "step.answer", "step.done", "reader.save"];
const ASSISTANT = ["lesson.read", "step.check.run", "practice.list", "lesson.delete", "practice.archived.delete"];

async function fixture(t, { contentWrapper = value => value, practice = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-step-actions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "topic");
  await cp(fixtureTopic, source, { recursive: true });
  const systemRoot = path.join(root, "system");
  const commit = "e".repeat(40), snapshotRoot = path.join(systemRoot, "training/content/steps", commit);
  await mkdir(path.dirname(snapshotRoot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshotRoot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshotRoot, "bundle.json"), "utf8"));
  const topic = { schemaVersion: 1, topicId: "steps", release: "0.1.0", repository: "examples/learn-steps-fixture", commit, topicHash: bundle.topicHash };
  await writeFile(path.join(snapshotRoot, "pin.json"), JSON.stringify(topic));
  const pin = { course: { courseId: "intro", release: "0.1.0" }, topic, lesson: { code: "STEPS-ONE", hash: bundle.lessons[0].hash } };
  const content = contentWrapper(createInstalledTrainingContent({ systemRoot }));
  const learners = createTrainingLearnerState({ systemRoot, content });
  const auth = { user: { uid: 42, username: "alice", role: "member" } };
  let revision = 0;
  async function start(requestId = "start") {
    const reserved = await learners.reserveAttempt({ actor: auth.user, expectedRevision: revision, requestId, pin });
    const attemptId = reserved.attempt.attemptId;
    await learners.beginPreparation({ actor: auth.user, attemptId, expectedRevision: reserved.revision });
    const ready = await learners.recordPreparationReady({ actor: auth.user, attemptId, initialSessionId: `training-${attemptId}`,
      expectedRevision: reserved.revision + 1 });
    revision = ready.revision;
    return { attemptId, projectSlug: reserved.attempt.projectSlug, sessionId: `training-${attemptId}` };
  }
  const checkCalls = [], innerCalls = [], published = [], removed = [];
  let outcome = "passed";
  const checks = {
    async runOrientationCheck(input) {
      checkCalls.push(input);
      return { checkResult: { check: "app-response", observationId: input.observationId, outcome } };
    },
    async runCodeCheck() { throw new Error("no code check in these tests"); }
  };
  const inner = { async execute({ actionId, input, context }) {
    innerCalls.push({ actionId, input, context });
    return actionId === "vibe64.terminals.outputs.read" ? { ok: true, activeTerminal: { id: "terminal-1" } } : { ok: true };
  } };
  const steps = createTrainingStepChecks({ learners, content, checks, actions: inner });
  const exercises = practice ? { async deleteLesson(value) { removed.push(value); return { ok: true, attemptId: value.attemptId, closed: true }; },
    ...(typeof practice === "object" ? practice : {}) } : null;
  const practiceCalls = [];
  const learningSpace = practice ? {
    async list(actor) { practiceCalls.push(["list", actor]); return { current: null, archived: [] }; },
    async exists() { return true; },
    async deleteArchive(value) { practiceCalls.push(["deleteArchive", value]); return { ok: true, ...value, removed: true }; },
    ...(typeof practice === "object" ? practice : {}) } : null;
  const publishLearnerChanged = createTrainingLearnerChangedPublisher({ async publish(event) { published.push(event); } });
  const actions = createActionCatalogue();
  const definitions = createTrainingStepActions({ learners, content, steps, exercises, learningSpace, publishLearnerChanged });
  actions.register({ contributorId: "training", domain: "training", actions: definitions.map(definition => ({
    channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => auth.user,
    authorizeProject() { throw new Error("Learning actions must not require a selected project."); } });
  const tools = createServiceToolCatalog(actions, { maxDirectTools: 100 });
  const toolContext = { channel: "automation", surface: "app" };
  const toolSet = tools.resolveToolSet(toolContext);
  const execute = (name, input = {}, channel = "api") => actions.execute({ actionId: `vibe64.training.${name}`, input,
    context: { channel, surface: "app" } });
  const tool = (name, input = {}) => {
    const definition = toolSet.tools.find(item => item.actionId === `vibe64.training.${name}`);
    assert.ok(definition, name);
    assert.doesNotThrow(() => tools.toOpenAiToolSchema(definition));
    return tools.executeToolCall({ toolName: definition.name, toolSet, context: toolContext, argumentsText: JSON.stringify(input) });
  };
  return { root, pin, auth, learners, content, definitions, toolSet, execute, tool, start, checkCalls, innerCalls, published, removed, practiceCalls,
    set outcome(value) { outcome = value; } };
}

const observation = (attempt) => ({ control: "exercise-response",
  exercise: { instanceId: randomUUID(), interactionId: randomUUID(), requestId: randomUUID() },
  workspace: { projectSlug: attempt.projectSlug, sessionId: attempt.sessionId, projectVisible: true, pane: "preview", ready: true } });
const changed = f => f.published.map(event => [event.realtime.event, event.realtime.audience, event.realtime.payload]);

test("browser-only step actions are api-only and absent from Colleague's tools; reader and check tools carry output schemas", async t => {
  const f = await fixture(t);
  assert.deepEqual(f.toolSet.tools.map(value => value.actionId).sort(), ASSISTANT.map(value => `vibe64.training.${value}`).sort());
  for (const name of BROWSER_ONLY) {
    const definition = f.definitions.find(value => value.id === `vibe64.training.${name}`);
    assert.deepEqual(definition.channels, ["api"], name);
    assert.equal(definition.extensions.assistant.exclude, true, name);
  }
  for (const name of ASSISTANT) {
    const definition = f.definitions.find(value => value.id === `vibe64.training.${name}`);
    assert.equal(definition.channels, undefined, `${name} uses the provider's default channels`);
    assert.equal(definition.extensions.assistant.alwaysAvailable, true);
    assert.equal(typeof definition.extensions.assistant.output.schema.getFieldDefinitions, "function");
    assert.doesNotMatch(definition.extensions.assistant.description, /teaching-brief|Main teacher|supervisor/u);
  }
  const attempt = await f.start();
  const inputs = { "step.observe": { observation: observation(attempt) }, "step.answer": { selected: [1], requestId: "r1" },
    "step.done": { requestId: "r1" }, "reader.save": { scroll: 0 } };
  for (const name of BROWSER_ONLY) {
    const stepId = { "step.observe": "open-preview", "step.answer": "which-side" }[name] || "reflect";
    await assert.rejects(f.execute(name, { attemptId: attempt.attemptId, stepId, ...inputs[name] }, "automation"),
      { code: "ACTION_CHANNEL_FORBIDDEN" }, name);
  }
  assert.deepEqual(f.published, []);
});

test("lesson.read projects steps, notes, visuals and results without the choice answer through API and tool alike", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.execute("lesson.read"), { ok: true, available: true, attempt: null, lesson: null });
  const attempt = await f.start();
  const api = await f.execute("lesson.read", { attemptId: attempt.attemptId });
  const tool = await f.tool("lesson.read", { attemptId: attempt.attemptId });
  assert.equal(tool.ok, true, JSON.stringify(tool));
  assert.deepEqual(tool.result, api);
  assert.deepEqual(await f.execute("lesson.read"), api, "omitting attemptId reads the active attempt");
  assert.doesNotMatch(JSON.stringify(api), /"answer"|descriptorPath|controller\.js|diagram\.svg|requestId/u);
  assert.equal(api.attempt.attemptId, attempt.attemptId);
  assert.equal(api.attempt.practiceSlug, attempt.projectSlug);
  assert.equal(api.lesson.schemaVersion, 2);
  assert.equal(api.lesson.exercise, true);
  assert.match(api.lesson.notesText, /\S/u);
  assert.deepEqual(api.lesson.steps.map(step => [step.id, step.check.kind, step.required]), [
    ["open-preview", "auto", true], ["which-side", "choice", true], ["require-title", "auto", true],
    ["reflect", "self", false], ["read-more", "none", false]]);
  const choice = api.lesson.steps[1];
  assert.deepEqual(choice.check, { kind: "choice", question: "Which part produced the greeting?", options: ["The browser", "The server", "The database"] });
  assert.deepEqual(api.lesson.steps[0].visual, { id: "flow", play: [{ name: "send", parameters: { label: "GET /" } }] });
  assert.deepEqual(api.lesson.steps[0].guide, { target: "preview", navigate: true, caption: "Your app runs here" });
  assert.deepEqual(api.lesson.steps[2].check, { kind: "auto", check: "notes-title-required", files: ["notes.mjs"] });
  assert.ok(api.lesson.steps.every(step => typeof step.bodyText === "string" && step.bodyPage === 0));
  assert.deepEqual(api.lesson.visuals.map(visual => [visual.id, visual.commands.map(command => command.name)]), [["flow", ["send"]]]);
  assert.deepEqual(api.results, []);
  assert.deepEqual(api.completion, { lessonCode: "STEPS-ONE", lessonHash: api.lesson.hash, required: 3, passed: 0, completed: false });
  assert.equal(api.reader, null);
  assert.deepEqual(api.page, { index: 0, count: 1 });
  await assert.rejects(f.execute("lesson.read", { attemptId: attempt.attemptId, page: 1 }), { code: "ACTION_VALIDATION_FAILED" });
  await assert.rejects(f.execute("lesson.read", { attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  f.auth.user = { uid: 43, username: "bob", role: "member" };
  await assert.rejects(f.execute("lesson.read", { attemptId: attempt.attemptId }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" },
    "another learner never reads this attempt");
});

test("choice, self-check and reader saves record learner results and notify only that learner's attempt", async t => {
  const f = await fixture(t);
  const attempt = await f.start();
  const base = { attemptId: attempt.attemptId };
  const wrong = await f.execute("step.answer", { ...base, stepId: "which-side", selected: [0], requestId: "answer-1" });
  assert.deepEqual(wrong, { ok: true, stepId: "which-side", outcome: "not-yet-passed", recorded: true, replayed: false });
  assert.equal((await f.execute("step.answer", { ...base, stepId: "which-side", selected: [0], requestId: "answer-1" })).replayed, true);
  assert.equal((await f.execute("step.answer", { ...base, stepId: "which-side", selected: [1], requestId: "answer-2" })).outcome, "passed");
  await assert.rejects(f.execute("step.answer", { ...base, stepId: "which-side", selected: [], requestId: "answer-3" }), { code: "ACTION_VALIDATION_FAILED" });
  await assert.rejects(f.execute("step.done", { ...base, stepId: "which-side", requestId: "done-x" }), { code: "VIBE64_TRAINING_CHECK_UNDECLARED" });
  assert.equal((await f.execute("step.done", { ...base, stepId: "reflect", requestId: "done-1" })).outcome, "passed");
  const saved = await f.execute("reader.save", { ...base, stepId: "reflect", scroll: 120 });
  assert.deepEqual(saved.reader, { attemptId: attempt.attemptId, stepId: "reflect", scroll: 120 });
  const read = await f.execute("lesson.read", base);
  assert.deepEqual(read.results.map(value => [value.stepId, value.kind, value.outcome, value.origin]), [
    ["which-side", "choice", "not-yet-passed", "learner"], ["which-side", "choice", "passed", "learner"], ["reflect", "self", "passed", "learner"]]);
  assert.deepEqual(read.results[1].evidence, { selected: [1] }, "the learner's own reader keeps the selection");
  const told = await f.tool("lesson.read", base);
  assert.equal(told.ok, true, JSON.stringify(told));
  assert.deepEqual(told.result.results.map(value => [value.stepId, value.kind, value.outcome]),
    read.results.map(value => [value.stepId, value.kind, value.outcome]), "Colleague still sees every outcome");
  assert.ok(told.result.results.filter(value => value.kind === "choice").every(value => !Object.hasOwn(value, "evidence")));
  assert.doesNotMatch(JSON.stringify(told.result), /"selected"|"answer"/u, "Colleague never sees a chosen, correct or rejected option set");
  assert.deepEqual(read.passedStepIds, ["which-side", "reflect"]);
  assert.deepEqual(read.reader, { attemptId: attempt.attemptId, stepId: "reflect", scroll: 120 });
  const payload = reason => ({ learnerId: "42", attemptId: attempt.attemptId, reason });
  assert.deepEqual(changed(f), [
    [VIBE64_TRAINING_LEARNER_CHANGED_EVENT, "all_clients", payload("steps")],
    [VIBE64_TRAINING_LEARNER_CHANGED_EVENT, "all_clients", payload("steps")],
    [VIBE64_TRAINING_LEARNER_CHANGED_EVENT, "all_clients", payload("steps")],
    [VIBE64_TRAINING_LEARNER_CHANGED_EVENT, "all_clients", payload("steps")]], "replays and refusals publish nothing");
});

test("Colleague's step check is a diagnostic only; the learner's App press and own Check record the result", async t => {
  const f = await fixture(t);
  const attempt = await f.start();
  const base = { attemptId: attempt.attemptId, stepId: "open-preview" };
  const before = await f.tool("step.check.run", { ...base, requestId: "colleague-0" });
  assert.equal(before.ok, true, JSON.stringify(before));
  assert.deepEqual({ outcome: before.result.outcome, recorded: before.result.recorded }, { outcome: "not-yet-passed", recorded: false });
  assert.equal(f.checkCalls.length, 0);
  await assert.rejects(f.execute("step.observe", { ...base, observation: observation(attempt) }, "automation"), { code: "ACTION_CHANNEL_FORBIDDEN" });
  f.outcome = "not-yet-passed";
  const observed = await f.execute("step.observe", { ...base, observation: observation(attempt) });
  assert.deepEqual({ outcome: observed.outcome, recorded: observed.recorded }, { outcome: "not-yet-passed", recorded: true });
  assert.deepEqual(f.innerCalls.map(call => [call.actionId, call.input]), [
    ["vibe64.sessions.inspect", { projectSlug: attempt.projectSlug, sessionId: attempt.sessionId }],
    ["vibe64.terminals.outputs.read", { projectSlug: attempt.projectSlug, sessionId: attempt.sessionId }]]);
  assert.ok(f.innerCalls.every(call => call.context.channel === "api" && !Object.hasOwn(call.context, "vibe64Action")),
    "inner actions are re-admitted with the learner's own request, never the outer admission");
  f.outcome = "passed";
  const diagnostic = await f.tool("step.check.run", { ...base, requestId: "colleague-1" });
  assert.deepEqual({ outcome: diagnostic.result.outcome, recorded: diagnostic.result.recorded }, { outcome: "passed", recorded: false });
  assert.match(diagnostic.result.diagnostic, /Only the learner's own Check/u);
  assert.equal(f.published.length, 1, "a diagnostic changes nothing and notifies nobody");
  const learner = await f.execute("step.check.run", { ...base, requestId: "learner-1" });
  assert.deepEqual({ outcome: learner.outcome, recorded: learner.recorded }, { outcome: "passed", recorded: true });
  assert.equal(f.published.length, 2);
  const read = await f.execute("lesson.read", { attemptId: attempt.attemptId });
  assert.deepEqual(read.passedStepIds, ["open-preview"]);
  assert.ok(read.results.every(value => value.origin === "check"));
});

test("deletions are the learner's one click and need the person's confirmation from Colleague; each notifies the learner", async t => {
  const f = await fixture(t);
  const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const unconfirmed = await f.tool("lesson.delete", { attemptId });
  assert.equal(unconfirmed.ok, false);
  await assert.rejects(f.execute("practice.archived.delete", { attemptId }, "automation"), { code: "VIBE64_TRAINING_PRACTICE_UNCONFIRMED" });
  assert.deepEqual([f.removed.length, f.practiceCalls.length, f.published.length], [0, 0, 0]);
  const deleted = await f.tool("lesson.delete", { attemptId, confirmed: true });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.deepEqual(deleted.result, { ok: true, available: true, attemptId, changed: true });
  assert.deepEqual(f.removed, [{ actor: f.auth.user, attemptId }]);
  assert.deepEqual(await f.execute("practice.archived.delete", { attemptId }), { ok: true, available: true, attemptId, removed: true });
  assert.deepEqual(f.practiceCalls, [["deleteArchive", { actor: f.auth.user, attemptId }]]);
  assert.deepEqual(changed(f).map(([, , payload]) => payload), [{ learnerId: "42", attemptId, reason: "lesson" },
    { learnerId: "42", attemptId, reason: "practice" }], "every tab of this learner rereads its lessons");
  assert.deepEqual(await f.execute("practice.list"), { ok: true, available: true, current: null, archived: [] });
});

test("a refused deletion (a pinned session, not this learner's) changes nothing and is reported", async t => {
  const refusal = (code, message) => async () => { throw Object.assign(new Error(message), { code, statusCode: /MISSING/u.test(code) ? 404 : 409 }); };
  const f = await fixture(t, { practice: {
    deleteLesson: refusal("vibe64_project_pinned", "Unpin session Practice before deleting this project."),
    deleteArchive: refusal("VIBE64_TRAINING_PRACTICE_ARCHIVE_MISSING", "This archived lesson is not in your archive.")
  } });
  const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.deepEqual(await f.execute("lesson.delete", { attemptId }), { ok: false, available: true, attemptId,
    error: "Unpin session Practice before deleting this project." });
  assert.equal((await f.execute("practice.archived.delete", { attemptId })).error, "This archived lesson is not in your archive.");
  const failed = await fixture(t, { practice: { async deleteLesson() {
    throw Object.assign(new Error("Project runtime could not be closed."), { code: "vibe64_project_runtime_close_failed" }); } } });
  await assert.rejects(failed.execute("lesson.delete", { attemptId }), { code: "vibe64_project_runtime_close_failed" },
    "a delete that stopped part-way is an error the learner retries");
  assert.deepEqual([f.published, failed.published], [[], []]);
});

test("a practice presence check that fails keeps that project listed without failing learning.read", async t => {
  const learningSpace = { async exists() { throw Object.assign(new Error("Practice storage must contain only real directories."), { code: "vibe64_practice_path_unsafe" }); } };
  const f = await fixture(t, { practice: learningSpace });
  const attempt = await f.start();
  const actions = createActionCatalogue();
  actions.register({ contributorId: "training", domain: "training", actions: createTrainingActions({
    catalogue: { async readCatalogue() { throw new Error("not read by learning.read"); } }, learners: f.learners, learningSpace
  }).map(definition => ({ ...definition, channels: ["api"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => f.auth.user,
    authorizeProject() { throw new Error("Learning actions must not require a selected project."); } });
  const read = await actions.execute({ actionId: "vibe64.training.learning.read", input: {}, context: { channel: "api", surface: "app" } });
  assert.equal(read.active.attemptId, attempt.attemptId);
  assert.equal(read.attempts.find(item => item.attemptId === attempt.attemptId).practiceSlug, attempt.projectSlug,
    "an unreadable practice project stays listed so delete can retry or report it");
  assert.ok(Array.isArray(read.lessonProgress), "progress is still returned");
  assert.equal((await f.execute("lesson.read", { attemptId: attempt.attemptId })).attempt.practiceSlug, attempt.projectSlug);
});

test("a practice project no longer in the learning space is no longer offered for opening", async t => {
  const gone = new Set();
  const f = await fixture(t, { practice: { async exists({ attemptId }) { return !gone.has(attemptId); } } });
  const attempt = await f.start();
  assert.equal((await f.execute("lesson.read", { attemptId: attempt.attemptId })).attempt.practiceSlug, attempt.projectSlug);
  gone.add(attempt.attemptId);
  assert.equal((await f.execute("lesson.read", { attemptId: attempt.attemptId })).attempt.practiceSlug, undefined);
});

test("practice actions without the learning space report unavailable and change nothing", async t => {
  const f = await fixture(t, { practice: false });
  const practiceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const [name, input] of [["practice.list", {}], ["lesson.delete", { attemptId: practiceId }],
    ["practice.archived.delete", { attemptId: practiceId }]]) {
    const result = await f.execute(name, input);
    assert.deepEqual([result.ok, result.available], [false, false], name);
  }
  assert.deepEqual(f.published, []);
});

test("long step text is paged at 64 KiB", async t => {
  const long = "x".repeat(40 * 1024);
  const f = await fixture(t, { contentWrapper: content => ({ ...content,
    async readLesson(input) {
      const lesson = await content.readLesson(input);
      return { ...lesson, steps: lesson.steps.map(step => ({ ...step, bodyText: `${step.id}\n${long}` })) };
    } }) });
  const attempt = await f.start();
  const first = await f.execute("lesson.read", { attemptId: attempt.attemptId });
  assert.ok(first.page.count > 1);
  assert.equal(first.page.index, 0);
  const pages = [first];
  for (let page = 1; page < first.page.count; page += 1) pages.push(await f.execute("lesson.read", { attemptId: attempt.attemptId, page }));
  for (const step of first.lesson.steps) {
    const owner = pages[step.bodyPage];
    assert.match(owner.lesson.steps.find(value => value.id === step.id).bodyText, new RegExp(`^${step.id}\n`, "u"));
  }
  assert.ok(pages.slice(1).every(page => page.lesson.notesText === undefined), "notes come with the first page");
  assert.ok(pages.every(page => Buffer.byteLength(JSON.stringify(page)) < 128 * 1024));
});

// A v2 lesson whose v1 assessment fields fail the test when any reader touches
// them. The getters are not enumerable, so ordinary projections never see them.
function withoutV1Readers(content, touched) {
  const poison = (value, fields) => {
    for (const field of fields) Object.defineProperty(value, field, { enumerable: false, configurable: true,
      get() { touched.push(field); throw new Error(`A v1 reader touched ${field} of a version 2 lesson.`); } });
    return value;
  };
  return { ...content, async readLesson(input) {
    const lesson = await content.readLesson(input);
    if (lesson.lesson.schemaVersion !== 2) return lesson;
    return poison({ ...lesson, lesson: poison({ ...lesson.lesson }, ["document", "assessments"]) }, ["document", "rubrics"]);
  } };
}

test("a v2 lesson passes start, resume, learning.read, completion, finish and delete without reaching a v1 assessment reader", async t => {
  const touched = [];
  const f = await fixture(t, { contentWrapper: content => withoutV1Readers(content, touched) });
  const projectRoot = path.join(f.root, "practice-project");
  let metadata = {}, session = null;
  const exercises = createTrainingService({
    catalogue: { async readCatalogue() { return { revision: 1, courses: [{ enabled: true, course: { ...f.pin.course, status: "released" },
      lock: { topics: [{ ...f.pin.topic, manifestHash: f.pin.topic.topicHash, lessons: [{ ...f.pin.lesson, status: "published" }] }] } }] }; } },
    content: f.content, learners: f.learners,
    // The learner store's end stands in for the learning space's close.
    learningSpace: { async closeAttempt({ actor, attemptId, reason }) {
      const { revision } = await f.learners.readState({ actor });
      await f.learners.runPreparationExclusive({ actor, attemptId }, () =>
        f.learners.endAttempt({ actor, attemptId, requestId: `close-${attemptId}`, expectedRevision: revision, reason }));
      return { ok: true, attemptId, closed: true };
    } },
    projectContext: { async readWorkspaceProjectState() { return { projectContextRoot: projectRoot, metadata }; },
      async runWithPracticeProjectScope(_input, operation) { return operation(); } },
    projectRepositoryService: {
      async verifyTrainingProjectSource() { return { commit: "d".repeat(40), branch: "main" }; },
      async createManagedGitProject(input, { initializeProject }) {
        const source = path.join(f.root, "practice-source");
        await mkdir(source);
        await initializeProject({ projectRoot: source });
        await mkdir(projectRoot);
        metadata = { training: input.training, repository: { mode: "managed_git" } };
        return { ok: true };
      }
    },
    project: { async runInProjectContext(_slug, operation) { return operation(); },
      async createRuntime() { return { async getSession() {
        if (!session) throw Object.assign(new Error("Missing session"), { code: "vibe64_session_not_found" });
        return session;
      } }; } },
    sessions: { async createSession(_input, { sessionId }) { session = { sessionId, status: "open", workspaceSetup: { status: "succeeded" } }; return session; } },
    terminals: { async workspaceSetupIsPrepared() { return true; } }
  });
  const actions = createActionCatalogue();
  actions.register({ contributorId: "training", domain: "training", actions: [...createTrainingActions({
    catalogue: { async readCatalogue() { throw new Error("not read by these lifecycle actions"); } },
    learners: f.learners, exercises
  }), ...createTrainingStepActions({ learners: f.learners, content: f.content, steps: { read() {} }, exercises })]
    .filter(definition => definition.id !== "vibe64.training.lesson.read" && !/step\.|reader\./u.test(definition.id))
    .map(definition => ({ ...definition, channels: ["api"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => f.auth.user,
    authorizeProject() { throw new Error("Learning actions must not require a selected project."); } });
  const run = (name, input = {}) => actions.execute({ actionId: `vibe64.training.${name}`, input, context: { channel: "api", surface: "app" } });

  const started = await run("lesson.start", { ...f.pin.course, lessonCode: f.pin.lesson.code, requestId: "start-v2", expectedRevision: 0 });
  assert.equal(started.ok, true);
  assert.equal(started.active.preparation.phase, "ready");
  const attemptId = started.active.attemptId;
  const resumed = await run("lesson.resume", { attemptId });
  assert.equal(resumed.active.attemptId, attemptId);
  assert.equal(resumed.active.preparation.phase, "ready");
  assert.equal((await f.execute("step.answer", { attemptId, stepId: "which-side", selected: [1], requestId: "answer-v2" })).outcome, "passed");
  assert.equal((await f.execute("step.done", { attemptId, stepId: "reflect", requestId: "done-v2" })).outcome, "passed");

  const read = await run("learning.read");
  assert.equal(read.active.attemptId, attemptId);
  const progress = { lessonCode: "STEPS-ONE", lessonHash: f.pin.lesson.hash, required: 3, passed: 1, completed: false };
  assert.deepEqual(read.completion, progress, "only required steps count: the self step is optional");
  assert.deepEqual(read.lessonProgress, [{ ...progress, open: true }]);
  assert.equal(read.attempts[0].practiceSlug, started.active.projectSlug);

  await assert.rejects(run("lesson.finish", { attemptId, requestId: "finish-v2", expectedRevision: read.revision }),
    { code: "VIBE64_TRAINING_LESSON_INCOMPLETE" }, "an unfinished lesson cannot be finished");
  const deleted = await run("lesson.delete", { attemptId });
  assert.equal(deleted.ok, true);
  const after = await run("learning.read");
  assert.equal(after.active, null);
  assert.equal(after.completion, null);
  assert.ok(after.lessonProgress.every(value => !value.completed && !value.open), "a deleted attempt completed nothing");
  assert.deepEqual(after.history.map(value => [value.attemptId, value.ended.reason]), [[attemptId, "deleted"]]);
  assert.deepEqual(touched, [], "no reader touched a v1 document, assessment or rubric field");
});

test("HTTP routes map each v2 action to its attempt path without accepting a caller identity", async () => {
  const registered = [];
  registerTrainingRoutes({ router: { register(method, url, options, handler) { registered.push({ method, url, options, handler }); } } });
  const v2 = registered.filter(route => /\/(lesson|steps|reader|practice|restart|finish|delete)(\/|$)/u.test(route.url));
  assert.deepEqual(v2.map(route => [route.method, route.url]), [
    ["POST", "/api/vibe64/training/attempts/:attemptId/restart"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/finish"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/delete"],
    ["GET", "/api/vibe64/training/lesson"],
    ["GET", "/api/vibe64/training/attempts/:attemptId/lesson"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/steps/observe"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/steps/check"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/steps/answer"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/steps/done"],
    ["POST", "/api/vibe64/training/attempts/:attemptId/reader"],
    ["GET", "/api/vibe64/training/practice"],
    ["POST", "/api/vibe64/training/archives/:attemptId/delete"]
  ]);
  const executed = [];
  const reply = { code() { return this; }, send(value) { return value; }, header() { return this; } };
  const request = (route, extra) => ({ ip: "127.0.0.1", headers: { host: "localhost" }, params: { attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", practiceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, query: { page: "2" },
    body: { stepId: "reflect", requestId: "done-1", actor: { uid: 1 }, vibe64User: { role: "owner" } },
    executeAction(value) { executed.push([route.url, value]); return { ok: true }; }, ...extra });
  for (const route of v2) await route.handler(request(route), reply);
  const inputs = Object.fromEntries(executed.map(([url, value]) => [url, value]));
  assert.deepEqual(inputs["/api/vibe64/training/attempts/:attemptId/lesson"].input, { page: 2, attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  assert.equal(inputs["/api/vibe64/training/attempts/:attemptId/lesson"].actionId, "vibe64.training.lesson.read");
  assert.deepEqual(inputs["/api/vibe64/training/attempts/:attemptId/steps/done"].input,
    { stepId: "reflect", requestId: "done-1", attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  assert.deepEqual(Object.fromEntries(executed.filter(([url]) => /restart|finish|delete$/u.test(url))
    .map(([url, value]) => [url.replace("/api/vibe64/training", ""), value.actionId])), {
    "/attempts/:attemptId/restart": "vibe64.training.lesson.restart", "/attempts/:attemptId/finish": "vibe64.training.lesson.finish",
    "/attempts/:attemptId/delete": "vibe64.training.lesson.delete", "/archives/:attemptId/delete": "vibe64.training.practice.archived.delete" });
  assert.deepEqual(inputs["/api/vibe64/training/archives/:attemptId/delete"].input,
    { stepId: "reflect", requestId: "done-1", attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    "only the route's own identity is taken from the path; no caller identity");
  assert.deepEqual(inputs["/api/vibe64/training/practice"].input, {});
});

test("the plain visual route reads a diagram of any retained attempt, including an ended one", async t => {
  const { createTrainingVisualResourceActions, TRAINING_VISUAL_RESOURCE_ACTION } =
    await import("../../packages/vibe64-training/src/server/visualResourceActions.js");
  const f = await fixture(t);
  const attempt = await f.start();
  const { revision } = await f.learners.readState({ actor: f.auth.user });
  await f.learners.endAttempt({ actor: f.auth.user, attemptId: attempt.attemptId, requestId: "leave-one", expectedRevision: revision, reason: "deleted" });
  assert.ok((await f.learners.readState({ actor: f.auth.user })).progress.attempts[0].ended);
  const actions = createActionCatalogue();
  actions.register({ contributorId: "visuals", domain: "training", actions: createTrainingVisualResourceActions({
    learners: f.learners, content: f.content }) });
  registerVibe64ActionContext(actions, { resolveUser: async () => f.auth.user,
    authorizeProject() { throw new Error("no project"); } });
  const read = await actions.execute({ actionId: TRAINING_VISUAL_RESOURCE_ACTION, input: { attemptId: attempt.attemptId, visualId: "flow" },
    context: { channel: "api", surface: "app" } });
  assert.equal(read.id, "flow");
  assert.equal(read.lessonCode, "STEPS-ONE");
  f.auth.user = { uid: 43, username: "bob", role: "member" };
  await assert.rejects(actions.execute({ actionId: TRAINING_VISUAL_RESOURCE_ACTION, input: { attemptId: attempt.attemptId, visualId: "flow" },
    context: { channel: "api", surface: "app" } }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
});
