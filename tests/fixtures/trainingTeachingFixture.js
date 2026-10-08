import assert from "node:assert/strict";
import { defineVibe64AgentExecutionProfileResolution, VIBE64_AGENT_HELPER_WORKLOAD_LIMITS } from "@local/vibe64-runtime/shared";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingTeachingOwner } from "../../packages/vibe64-training/src/server/teaching.js";

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


export { fixture as trainingTeachingFixture };

function mainTeachingTerminals({ runtime, sessionId, selection, controls, helperCalls }) {
  return {
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
}

export { mainTeachingTerminals };
