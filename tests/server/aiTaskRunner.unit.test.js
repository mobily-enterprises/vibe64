import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { configureStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { resolveVibe64AssistantSelection, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { createAiTasksService } from "../../packages/vibe64-ai-tasks/src/server/service.js";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { createSessionAttachments } from "../../packages/vibe64-terminals/src/server/sessionAttachments.js";
import { createSessionConversations } from "../../packages/vibe64-terminals/src/server/sessionConversations.js";
import { sessionAgentManagerDefaults } from "../fixtures/sessionAgentManagerDefaults.js";
import { NO_ACTIONS } from "../fixtures/terminalsServiceCollaborators.js";
import { projectRuntimeRoot, sourceMetadata, withTemporaryRoot } from "./vibe64TestHelpers.js";

configureStudioProjectContext({ env: process.env });

const SESSION = "one";
const OWNER = { id: "owner", role: "owner", displayName: "Owner" };
const conflictFailure = {
  status: "failed",
  code: "vibe64_session_update_conflict",
  error: "2 files need review before this session can update.",
  conflictPaths: ["a.js", "b.js"],
  conflictRecovery: { reviewId: "review-1", conflictPaths: ["a.js", "b.js"] }
};
const conflictResult = (reviewId = "review-2", paths = ["a.js"]) => ({
  ok: false,
  code: "vibe64_session_update_conflict",
  error: `${paths.length} files need review.`,
  details: { conflictPaths: paths, conflictRecovery: { reviewId, conflictPaths: paths } }
});
const never = () => new Promise(() => {});

const saveFailure = { status: "failed", code: "vibe64_session_save_git_failed", error: "The pre-commit hook failed.", operationId: "save-1" };

async function taskFixture(root, { updateFailure = conflictFailure, saveFailed = null } = {}) {
  const selection = { engineId: "codex", modelProviderId: "openai", agentId: "codex", modelId: "main-model", variantId: "high",
    catalogRevision: `sha256:${"a".repeat(64)}` };
  const capabilities = { engineId: "codex", transportId: "codex_app_server", revision: `sha256:${"b".repeat(64)}`, defaults: selection,
    agents: [{ id: "codex", mode: "primary" }],
    modelProviders: [{ id: "openai", connected: true, models: [{ id: "main-model", status: "available", variants: [{ id: "high" }] }] }] };
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root) });
  await store.createSession({ runtimeKind: "genesis", sessionId: SESSION, metadata: {
    ...sourceMetadata(root, SESSION), assistant_selection: serializeVibe64AssistantSelection(selection)
  } });
  if (updateFailure) await store.writeBackgroundTaskEvent(SESSION, "update-session", { patch: updateFailure });
  if (saveFailed) await store.writeBackgroundTaskEvent(SESSION, "save-work", { patch: saveFailed });
  const runtime = { store, stateRoot: projectRuntimeRoot(root), getSession: id => store.readSession(id),
    getSessionWithoutSource: id => store.readSession(id),
    listSessionSummaries: async () => [{ sessionId: SESSION }] };
  const project = { createRuntime: async () => runtime, createRuntimeWithoutSource: async () => runtime };
  const attachments = createSessionAttachments({ project, env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "uploads") } });
  // The AI outlives any server, as the real one does: restarts keep this state.
  const native = { status: "ready", runId: "", text: "", accepted: new Set(), turns: [], stops: 0, conversations: 0, startError: null };
  const sessionAgent = {
    async inspectAssistantPurposes() { return {}; },
    async assistantAccess() { return { canUse: true }; },
    async requireAssistantAccess() {},
    async requireAssistantAccessForSelection() {},
    async resolveSelection(input) { return resolveVibe64AssistantSelection(capabilities, input); },
    async createConversation() { native.conversations += 1; return { ok: true, conversationId: "native" }; },
    async readConversation(_id, input) {
      return { ok: true, status: native.status, runId: native.runId, text: native.text, admitted: native.accepted.has(input.messageId) };
    },
    async startConversationTurn(_id, input) {
      if (native.startError) throw native.startError;
      await input.onPromptSending?.({ threadId: input.conversationId });
      native.turns.push({ id: input.messageId, message: input.message, schema: input.outputSchema });
      native.accepted.add(input.messageId);
      native.runId = `turn-${native.turns.length}`;
      native.status = "inProgress";
      native.text = "";
      return { ok: true, runId: native.runId, status: "inProgress" };
    },
    async stopConversation() { native.stops += 1; native.status = "interrupted"; return { ok: true }; },
    async deleteConversation() { return { ok: true }; }
  };
  const routingStore = createAssistantRoutingStore({ systemRoot: root });
  const role = { ...resolveVibe64AssistantSelection(capabilities, { ...selection, catalogRevision: capabilities.revision }), selectionSource: "explicit" };
  await routingStore.write({ owner: { senior: role, junior: role, quickHelper: role, router: role, fix: { follows: "junior" } }, nonOwner: {} }, 0);
  const manager = createSessionAgentManager({ ...sessionAgentManagerDefaults,
    providers: [{ id: "codex", transportId: capabilities.transportId, capabilities: async () => capabilities }],
    readRoutingConfiguration: () => routingStore.read(),
    readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "fixture-connection" }) });
  Object.assign(sessionAgent, { resolveAssistantPurpose: (input, options) => manager.resolveAssistantPurpose(input, options) });
  const updates = [];
  const published = [];
  const saves = [];
  const server = {
    update: async () => ({ ok: true }),
    save: async () => ({ ok: true }),
    inspect: async () => ({ ok: true, unsaved: true, destination: { mode: "github", branch: "main" } })
  };

  /** A fresh server over the same store and the same AI. `terminalsWrap` injects a crash. */
  function boot({ terminalsWrap = terminals => terminals } = {}) {
    let conversations;
    const conversationRuntime = createConversationRuntime({
      authorize: async () => true,
      host: { conversation: ({ id, context }) => conversations.conversationBinding(id, context) }
    });
    let aiTasks;
    conversations = createSessionConversations({
      systemRoot: root, sessionAgent, conversationRuntime, attachments, actions: NO_ACTIONS, logger: silentLogger,
      prepareAgentSkills: async () => {},
      prepareSelection: async () => {},
      readSessionContext: async (sessionId, options = {}) => ({ ...options, runtime, session: await runtime.getSession(sessionId) }),
      routingWaitMs: 10_000,
      runAgentWrite: async (sessionId, options, operation, lockOptions) => {
        const result = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const session = await runtime.getSession(sessionId);
          return operation({ ...options, runtime, session });
        }, lockOptions);
        return result.value;
      },
      publishSessionChanged: async () => {},
      publishConversation: async () => {},
      conversationTurns: {
        starting: (sessionId, turn) => aiTasks.onTurnStarting({ sessionId, ...turn }),
        settled: (sessionId, conversationId, failure = null) => aiTasks.onTurnSettled({ sessionId, conversationId, failure })
      }
    });
    aiTasks = createAiTasksService({
      logger: silentLogger,
      project,
      publishSessionChanged: async (_id, event) => { published.push(event); },
      sessions: {
        async updateSessionWork(sessionId, input) {
          updates.push(input);
          return server.update(input);
        },
        async saveSessionWork(sessionId, input) {
          saves.push(input);
          return server.save(input);
        },
        inspectSessionWork: () => server.inspect()
      },
      terminals: terminalsWrap(conversations)
    });
    return { aiTasks, conversations };
  }

  const start = (aiTasks, by = OWNER, kind = "update") => aiTasks.start(SESSION, { kind, input: {}, vibe64User: by });
  const quiet = aiTasks => aiTasks.resumeInterruptedTasks();
  const task = async id => (await store.readSessionConversation(SESSION, id))?.task;

  /** The AI finishes its turn and Vibe64 hears of it, with no browser anywhere. */
  async function finishTurn(running, { kind = "complete", message = "Merged both sides.", report = "Merged both sides." } = {}) {
    Object.assign(native, { status: "completed", text: JSON.stringify({ kind, message, report }) });
    await running.conversations.afterTemporaryTurn(SESSION, { conversationId: "native",
      temporaryRun: { active: false, state: "completed", providerTurnId: native.runId } });
    await quiet(running.aiTasks);
  }

  return { boot, finishTurn, native, published, quiet, saves, server, start, store, task, updates };
}

function withFixture(run, options) {
  return withTemporaryRoot(async (root) => run(await taskFixture(root, options)));
}

test("a started task reaches the AI once, on the Fix route, with the result schema", () => withFixture(async (f) => {
  const { aiTasks } = f.boot();
  const started = await f.start(aiTasks);
  assert.equal(started.task.title, "Fix Update");
  assert.equal(started.task.problem.summary, "Update found conflicts in 2 files.");
  assert.equal(started.task.pending, undefined, "a browser never sees what the task owes");
  await f.quiet(aiTasks);
  const saved = await f.task(started.task.id);
  assert.equal(saved.phase, "working");
  assert.equal(saved.pending, null);
  assert.equal(f.native.turns.length, 1);
  assert.match(f.native.turns[0].message, /Help resolve this Vibe64 Update problem/);
  assert.match(f.native.turns[0].message, /\[Vibe64 saved version\]/);
  assert.deepEqual(f.native.turns[0].schema.properties.kind.enum, ["cannot", "complete", "question"]);
}));

test("a completed repair runs Update on the server with no browser, and the task ends Done", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "done");
  assert.equal(saved.message, "Session updated. Your changes were preserved. Nothing was pushed.");
  assert.equal(saved.report, "Merged both sides.");
  assert.equal(f.updates.length, 1);
  assert.equal(f.updates[0].reviewedConflictId, "review-1");
  assert.equal(f.updates[0].aiTaskId, task.id);
  assert.equal(f.updates[0].vibe64User.id, "owner");
}));

test("a completed Save repair runs Save on the server to the session's destination, and the task ends Done", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "save");
  assert.equal(task.title, "Fix Save");
  assert.equal(task.problem.summary, "The pre-commit hook failed.");
  await f.quiet(running.aiTasks);
  assert.match(f.native.turns[0].message, /Help resolve this Vibe64 Save problem/);
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "done");
  assert.equal(saved.message, "Session saved. Your work was pushed.");
  assert.equal(f.saves.length, 1);
  assert.deepEqual(f.saves[0].destinationReview, { mode: "github", branch: "main" });
  assert.equal(f.saves[0].aiTaskId, task.id);
  assert.equal(f.updates.length, 0);
}, { updateFailure: null, saveFailed: saveFailure }));

test("a Save only a person can settle stops for them without asking the AI again", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "save");
  await f.quiet(running.aiTasks);
  f.server.save = async () => ({ ok: false, code: "vibe64_session_repository_review_changed", error: "The destination changed." });
  await f.finishTurn(running);
  const stuck = await f.task(task.id);
  assert.equal(stuck.phase, "needs_you");
  assert.equal(stuck.reason, "check_stuck");
  assert.equal(stuck.message, "Save needs your review of where it goes. Choose Save, review it, then Check now.");
  assert.equal(f.native.turns.length, 1);
}, { updateFailure: null, saveFailed: saveFailure }));

test("work a person saved meanwhile ends the Save fix Done without saving again", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "save");
  await f.quiet(running.aiTasks);
  await f.store.writeBackgroundTaskEvent(SESSION, "save-work", { patch: { status: "ready", code: "", error: "" } });
  f.server.inspect = async () => ({ ok: true, unsaved: false, destination: { mode: "github", branch: "main" } });
  await f.finishTurn(running);
  assert.equal((await f.task(task.id)).phase, "done");
  assert.equal(f.saves.length, 0);
}, { updateFailure: null, saveFailed: saveFailure }));

test("a failed check goes back to the same conversation as a recorded message, and passes on the next try", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = async () => conflictResult();
  await f.finishTurn(running);
  const retried = await f.task(task.id);
  assert.equal(retried.phase, "working");
  assert.equal(retried.attempt, 2);
  assert.equal(f.native.turns.length, 2);
  assert.equal(f.native.conversations, 1, "the same conversation");
  assert.match(f.native.turns[1].message, /Latest Update diagnostic:\n1 files need review\./);
  assert.ok(retried.log.some(entry => entry.text === "Update still has conflicts in 1 file. Sent back to the AI."));
  f.server.update = async () => ({ ok: true });
  await f.finishTurn(running);
  assert.equal((await f.task(task.id)).phase, "done");
  assert.equal(f.updates[1].reviewedConflictId, "review-2", "the next check repairs the review the failure produced");
}));

test("the same failure twice stops at the person, with nothing sent", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = async () => conflictResult("review-2");
  await f.finishTurn(running);
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "needs_you");
  assert.equal(saved.reason, "check_stuck");
  assert.equal(saved.message, "Update still has conflicts in 1 file.");
  assert.equal(f.native.turns.length, 2);
}));

test("three tries use up the AI's attempts", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  let review = 1;
  f.server.update = async () => conflictResult(`review-${++review}`);
  await f.finishTurn(running);
  await f.finishTurn(running);
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.reason, "check_stuck");
  assert.equal(saved.attempt, 3);
  assert.equal(f.native.turns.length, 3);
}));

test("a failed check waits for an unsent draft instead of talking over it", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  await f.store.writeSessionConversation(SESSION, task.id, { draft: "Keep the newer lodash." });
  f.server.update = async () => conflictResult();
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.reason, "draft_waiting");
  assert.equal(f.native.turns.length, 1);
}));

test("a failure that is not the AI's to repair stops at the person", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = async () => ({ ok: false, code: "vibe64_session_update_verification_failed", error: "The worktree changed." });
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.reason, "check_stuck");
  assert.equal(saved.message, "Update still needs attention: The worktree changed.");
}));

for (const [kind, reason] of [["question", "question"], ["cannot", "ai_stuck"]]) {
  test(`a turn that reports ${kind} waits for the person`, () => withFixture(async (f) => {
    const running = f.boot();
    const { task } = await f.start(running.aiTasks);
    await f.quiet(running.aiTasks);
    await f.finishTurn(running, { kind, message: "Which one should stay?", report: "" });
    const saved = await f.task(task.id);
    assert.equal(saved.reason, reason);
    assert.equal(saved.message, "Which one should stay?");
    assert.equal(f.updates.length, 0);
  }));
}

test("a turn with free text is not trusted as finished", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  Object.assign(f.native, { status: "completed", text: "I think that's it." });
  await running.conversations.afterTemporaryTurn(SESSION, { conversationId: "native", temporaryRun: { active: false, state: "completed" } });
  await f.quiet(running.aiTasks);
  assert.equal((await f.task(task.id)).reason, "no_result");
  assert.equal(f.updates.length, 0);
}));

test("a person's reply in needs_you sends the task back to work with fresh tries", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  await f.finishTurn(running, { kind: "question", message: "Which one?", report: "" });
  await running.conversations.startTemporaryConversationTurn(SESSION, {
    conversationId: task.id, messageId: "person-1", message: "Keep the newer one.", vibe64User: OWNER
  }, { vibe64User: OWNER });
  await f.quiet(running.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "working");
  assert.equal(saved.turnMessageId, "person-1");
  assert.match(f.native.turns[1].message, /User message:\n[\s\S]*Keep the newer one\.$/);
  assert.deepEqual(saved.retryKeys, []);
  await f.finishTurn(running);
  assert.equal((await f.task(task.id)).phase, "done");
}));

test("a message during a check is refused, and nothing reaches the AI", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  let release;
  f.server.update = () => new Promise((resolve) => { release = resolve; });
  const finishing = f.finishTurn(running);
  await waitFor(async () => (await f.task(task.id)).phase === "checking" && Boolean(release));
  await assert.rejects(running.conversations.startTemporaryConversationTurn(SESSION, {
    conversationId: task.id, messageId: "person-1", message: "Wait", vibe64User: OWNER
  }, { vibe64User: OWNER }), /finish checking/);
  release({ ok: true });
  await finishing;
  assert.equal(f.native.turns.length, 1);
}));

test("Stop in the chat ends the turn and leaves the task for the person", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  await running.conversations.stopTemporaryConversation(SESSION, { conversationId: task.id });
  await f.quiet(running.aiTasks);
  assert.equal((await f.task(task.id)).reason, "stopped");
}));

test("Continue sends one recorded message and goes back to work", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  await running.conversations.stopTemporaryConversation(SESSION, { conversationId: task.id });
  await f.quiet(running.aiTasks);
  await running.aiTasks.continueTask(SESSION, { taskId: task.id });
  await f.quiet(running.aiTasks);
  assert.equal((await f.task(task.id)).phase, "working");
  assert.equal(f.native.turns.length, 2);
  assert.equal(f.native.turns[1].message.endsWith("Continue working on this task from where you stopped."), true);
}));

test("a send the AI refuses is an event, never a log line", () => withFixture(async (f) => {
  f.native.startError = Object.assign(new Error("Your Claude account needs signing in again."), { delivery: "not-sent" });
  const { aiTasks } = f.boot();
  const { task } = await f.start(aiTasks);
  await f.quiet(aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.reason, "ai_unavailable");
  assert.equal(saved.message, "Your Claude account needs signing in again.");
  assert.equal(saved.pending, null);
}));

test("an AI account change does nothing to a running task", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  await running.aiTasks.list(SESSION);
  await f.quiet(running.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "working");
  assert.equal(f.native.stops, 0);
}));

// Crash injection: the wrapped call does its work (or not) and then never returns, as if the
// server died there. A new server over the same store and the same AI takes over.
const crashingSend = ({ after }) => terminals => ({ ...terminals,
  async startTemporaryConversationTurn(...args) {
    if (after) await terminals.startTemporaryConversationTurn(...args);
    return never();
  } });

test("crash in starting, before the send: the restart sends the same message once", () => withFixture(async (f) => {
  const crashed = f.boot({ terminalsWrap: crashingSend({ after: false }) });
  const { task } = await f.start(crashed.aiTasks);
  await settle();
  assert.equal(f.native.turns.length, 0);
  const saved = await f.task(task.id);
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  assert.equal(f.native.turns.length, 1);
  assert.equal(f.native.turns[0].id, saved.pending.id);
  assert.equal((await f.task(task.id)).phase, "working");
}));

test("crash in starting, after the send: the restart does not send it twice", () => withFixture(async (f) => {
  const crashed = f.boot({ terminalsWrap: crashingSend({ after: true }) });
  const { task } = await f.start(crashed.aiTasks);
  await waitFor(() => f.native.turns.length === 1);
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  assert.equal(f.native.turns.length, 1);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "working");
  assert.equal(saved.pending, null);
}));

test("crash in working, and the turn finished meanwhile: the restart recovers it and runs the check", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  running.aiTasks.closeRunner();
  Object.assign(f.native, { status: "completed", text: JSON.stringify({ kind: "complete", message: "Done.", report: "Merged." }) });
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  await f.quiet(restarted.aiTasks);
  assert.equal((await f.task(task.id)).phase, "done");
  assert.equal(f.updates.length, 1);
  assert.equal(f.native.turns.length, 1);
}));

test("crash in working, and the turn is lost: it stops at needs_you and does not carry on by itself", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  running.aiTasks.closeRunner();
  Object.assign(f.native, { status: "interrupted", text: "" });
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.reason, "interrupted");
  assert.equal(f.native.turns.length, 1);
  await restarted.aiTasks.continueTask(SESSION, { taskId: task.id });
  await f.quiet(restarted.aiTasks);
  assert.equal(f.native.turns.length, 2);
}));

test("crash in working while the turn still runs: the task keeps waiting for it", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  running.aiTasks.closeRunner();
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  assert.equal((await f.task(task.id)).phase, "working");
  await f.finishTurn(restarted);
  assert.equal((await f.task(task.id)).phase, "done");
}));

test("crash in checking: the restart runs the same check with the same request id", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = never;
  void f.finishTurn(running);
  await waitFor(() => f.updates.length === 1);
  running.aiTasks.closeRunner();
  f.server.update = async () => ({ ok: true });
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  assert.equal((await f.task(task.id)).phase, "done");
  assert.equal(f.updates.length, 2);
  assert.equal(f.updates[1].requestId, f.updates[0].requestId);
}));

test("crash in checking and no answer after the restart: Vibe64 says it couldn't confirm", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = never;
  void f.finishTurn(running);
  await waitFor(() => f.updates.length === 1);
  running.aiTasks.closeRunner();
  f.server.update = async () => { throw new Error("The lock could not be read."); };
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.reason, "unconfirmed");
  assert.equal(saved.message, "Vibe64 couldn't confirm the result");
}));

test("crash right after a failed check is saved, before its retry is sent: the retry is not lost", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  running.aiTasks.closeRunner();
  // The server that recorded the failure dies at its send.
  const crashed = f.boot({ terminalsWrap: crashingSend({ after: false }) });
  f.server.update = async () => conflictResult();
  void f.finishTurn(crashed);
  await waitFor(async () => (await f.task(task.id)).attempt === 2);
  await settle();
  assert.equal(f.native.turns.length, 1, "the retry has not gone out");
  const owed = (await f.task(task.id)).pending;
  assert.equal(owed.effect, "send");
  crashed.aiTasks.closeRunner();
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  assert.equal(f.native.turns.length, 2);
  assert.equal(f.native.turns[1].id, owed.id);
  assert.equal(f.native.conversations, 1);
  assert.equal((await f.task(task.id)).phase, "working");
}));

test("crash right after the retry went out: it is not sent again", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  running.aiTasks.closeRunner();
  const crashed = f.boot({ terminalsWrap: crashingSend({ after: true }) });
  f.server.update = async () => conflictResult();
  void f.finishTurn(crashed);
  await waitFor(() => f.native.turns.length === 2);
  crashed.aiTasks.closeRunner();
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  assert.equal(f.native.turns.length, 2);
  assert.equal((await f.task(task.id)).pending, null);
}));

test("Cancel answers at once during a check that cannot be stopped, and the check's failure ends it Not done", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  let release;
  f.server.update = () => new Promise((resolve) => { release = resolve; });
  const finishing = f.finishTurn(running);
  await waitFor(() => Boolean(release));
  const answer = await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  assert.equal(answer.task.phase, "cancelling");
  release(conflictResult());
  await finishing;
  await f.quiet(running.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "not_done");
  assert.equal(saved.reason, "cancelled");
  assert.equal(f.native.turns.length, 1, "nothing goes back to the AI");
  assert.equal(f.native.stops, 0, "a running check is never interrupted");
}));

test("Cancel during a check that then passes ends Done, and says so", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  let release;
  f.server.update = () => new Promise((resolve) => { release = resolve; });
  const finishing = f.finishTurn(running);
  await waitFor(() => Boolean(release));
  await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  release({ ok: true });
  await finishing;
  await f.quiet(running.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "done");
  assert.equal(saved.message, "This finished before the cancel took effect.");
}));

test("Cancel during a turn stops it and ends Not done, and repeating Cancel is harmless", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  const answer = await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  assert.equal(answer.task.phase, "cancelling");
  await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  await f.quiet(running.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "not_done");
  assert.equal(f.native.stops, 1);
  assert.equal(saved.endedBy.id, "owner");
}));

test("crash in cancelling: the restart finishes cancelling", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  running.aiTasks.closeRunner();
  await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  assert.equal((await f.task(task.id)).phase, "cancelling");
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  assert.equal((await f.task(task.id)).phase, "not_done");
}));

test("crash in cancelling during a check: the restart ends it Not done without running the check again", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = never;
  void f.finishTurn(running);
  await waitFor(() => f.updates.length === 1);
  await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  running.aiTasks.closeRunner();
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  assert.equal((await f.task(task.id)).phase, "not_done");
  assert.equal(f.updates.length, 1);
}));

test("Update refused while the session's assistant works waits, and runs when that turn ends", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = async () => ({ ok: false, code: "vibe64_session_update_agent_active", error: "busy" });
  await f.finishTurn(running);
  const waiting = await f.task(task.id);
  assert.equal(waiting.phase, "checking");
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.message, "Update waits for the session's assistant to finish");
  f.server.update = async () => ({ ok: true });
  await running.aiTasks.onTurnSettled({ sessionId: SESSION, conversationId: "", failure: null });
  await f.quiet(running.aiTasks);
  assert.equal((await f.task(task.id)).phase, "done");
  running.aiTasks.closeRunner();
}));

test("one task at a time: the same problem reopens it, another is refused, an ended one is closed by the next", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  assert.equal((await f.start(running.aiTasks)).task.id, task.id, "the same problem reopens the open task");
  await f.store.writeBackgroundTaskEvent(SESSION, "update-session", { patch: { ...conflictFailure, conflictRecovery: { reviewId: "other", conflictPaths: ["c.js"] } } });
  await assert.rejects(f.start(running.aiTasks), error => error.code === "vibe64_ai_task_open" &&
    error.message === "Update is being fixed. Finish that first." && error.details.taskId === task.id);
  await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  await f.quiet(running.aiTasks);
  const next = await f.start(running.aiTasks);
  assert.notEqual(next.task.id, task.id);
  assert.equal(await f.task(task.id), undefined, "the ended task is closed");
  assert.equal(f.published.some(event => event.payload?.aiTaskClosed?.id === task.id), true);
}));

test("a task can't start without its problem, and Close refuses a task that hasn't ended", () => withFixture(async (f) => {
  const { aiTasks } = f.boot();
  await assert.rejects(f.start(aiTasks), error => error.code === "vibe64_ai_task_no_problem");
  await f.store.writeBackgroundTaskEvent(SESSION, "update-session", { patch: conflictFailure });
  const { task } = await f.start(aiTasks);
  await f.quiet(aiTasks);
  await assert.rejects(aiTasks.close(SESSION, { taskId: task.id, vibe64User: OWNER }), error => error.code === "vibe64_ai_task_running");
  await assert.rejects(aiTasks.start(SESSION, { kind: "nope", vibe64User: OWNER }), error => error.code === "vibe64_ai_task_kind_unknown");
}, { updateFailure: null }));

test("archiving ends an open task before the session goes", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  await running.aiTasks.onSessionArchiving(SESSION);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "not_done");
  assert.equal(saved.reason, "archived");
}));

test("Close removes the task with its conversation, and repeating it is harmless", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  await f.finishTurn(running);
  await running.aiTasks.close(SESSION, { taskId: task.id, vibe64User: OWNER });
  assert.equal(await f.store.readSessionConversation(SESSION, task.id), null);
  assert.deepEqual(await running.aiTasks.close(SESSION, { taskId: task.id, vibe64User: OWNER }), { ok: true, closed: true });
  assert.deepEqual((await running.aiTasks.list(SESSION)).tasks, []);
}));

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 50));
}

async function waitFor(condition) {
  for (let i = 0; i < 400; i += 1) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("The condition never held.");
}
