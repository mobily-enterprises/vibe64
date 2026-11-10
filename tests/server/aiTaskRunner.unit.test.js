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
import { createAiTaskActions } from "../../packages/vibe64-ai-tasks/src/server/aiTaskActions.js";
import { createAiTaskKinds } from "../../packages/vibe64-ai-tasks/src/server/aiTaskKinds.js";
import { createAiTaskSave } from "../../packages/vibe64-ai-tasks/src/server/hostKinds.js";
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
const setupFailure = { status: "failed", diagnostic: "npm ci failed: ERESOLVE could not resolve.", transcript: "$ npm ci\nnpm error ERESOLVE", updatedAt: "t1" };
const DEVELOPER = { name: "developer", type: "username", value: "developer" };
const onboardingAt = (state, diagnostics = []) => ({ ok: true, available: true, inspection: { state, nextAction: "repair", diagnostics } });
// A Data overview read: present with a definition, and the tables nobody reviewed yet.
const overviewRead = ({ present = true, error = "", unreviewed = [], missing = [] } = {}) => ({ ok: true, valid: !error && !missing.length,
  overview: { present, hash: present ? "h1" : "", error, definition: { version: 1, actors: [] } },
  coverage: { unreviewed, missing, missingRelationships: [], others: [] },
  schema: { tables: [{ qualifiedName: "public.items", reference: "items" }, { qualifiedName: "public.orders", reference: "orders" }] } });

async function taskFixture(root, { updateFailure = conflictFailure, saveFailed = null, setupFailed = null, hostKinds = [] } = {}) {
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
    getSessionWithoutSource: async id => ({ ...await store.readSession(id), workspaceSetup: server.workspaceSetup }),
    listSessionSummaries: async () => [{ sessionId: SESSION }] };
  const project = { createRuntime: async () => runtime, createRuntimeWithoutSource: async () => runtime,
    readOnboarding: input => server.onboarding(input) };
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
  const setups = [];
  const signIns = [];
  const server = {
    update: async () => ({ ok: true }),
    save: async () => ({ ok: true }),
    inspect: async () => ({ ok: true, unsaved: true, destination: { mode: "github", branch: "main" } }),
    setup: async () => ({ ok: true, workspaceSetup: { status: "succeeded" } }),
    signIn: async () => ({ ok: true }),
    onboarding: async () => onboardingAt("ready"),
    overview: async () => overviewRead(),
    // The main chat's turn, as terminals reports it: null while the main chat is idle.
    mainTurn: null,
    workspaceSetup: setupFailed || { status: "succeeded" }
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
    const sessions = {
      async updateSessionWork(sessionId, input) {
        updates.push(input);
        return server.update(input);
      },
      async saveSessionWork(sessionId, input) {
        saves.push(input);
        return server.save(input);
      },
      inspectSessionWork: () => server.inspect(),
      async retryWorkspaceSetup(sessionId, input) {
        setups.push({ input });
        return server.setup(input);
      }
    };
    const terminals = { ...terminalsWrap(conversations), async verifyPreviewIdentity(sessionId, input) {
      signIns.push(input);
      return server.signIn(input);
    }, async agentSessionState(sessionId, { session }) {
      // The engine is chosen from the session's own record, so the caller passes it.
      assert.equal(session?.sessionId, sessionId);
      return { turn: server.mainTurn };
    }, sessionAssistantWorking(session) {
      assert.equal(session?.sessionId, SESSION);
      return server.assistantWorking === true;
    } };
    aiTasks = createAiTasksService({
      databaseTools: { readOverview: input => server.overview(input) },
      // A host's kinds are made from the same owners as public's own.
      hostKinds: hostKinds.map(make => make({ sessions, terminals })),
      logger: silentLogger,
      project,
      publishSessionChanged: async (_id, event) => { published.push(event); },
      sessions,
      terminals
    });
    return { aiTasks, conversations };
  }

  const start = (aiTasks, by = OWNER, kind = "update", input = {}) => aiTasks.start(SESSION, { kind, input, vibe64User: by });
  const quiet = aiTasks => aiTasks.resumeInterruptedTasks();
  const task = async id => (await store.readSessionConversation(SESSION, id))?.task;

  /** The AI finishes its turn and Vibe64 hears of it, with no browser anywhere. */
  async function finishTurn(running, { kind = "complete", message = "Merged both sides.", report = "Merged both sides." } = {}) {
    Object.assign(native, { status: "completed", text: JSON.stringify({ kind, message, report }) });
    await running.conversations.afterTemporaryTurn(SESSION, { conversationId: "native",
      temporaryRun: { active: false, state: "completed", providerTurnId: native.runId } });
    await quiet(running.aiTasks);
  }

  return { boot, finishTurn, native, published, quiet, runtime, saves, server, setups, signIns, start, store, task, updates };
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

test("Fix Save waits while the main chat's AI works, names when it started, and saves when that turn ends", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "save");
  await f.quiet(running.aiTasks);
  f.server.mainTurn = { active: true, startedAt: "2026-11-09T10:15:00.000Z" };
  await f.finishTurn(running);
  const waiting = await f.task(task.id);
  assert.equal(waiting.phase, "checking");
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.message, "Save waits for the main chat's AI to finish");
  assert.equal(waiting.mainChatSince, "2026-11-09T10:15:00.000Z");
  assert.deepEqual(waiting.check.whileAiWorks, {
    action: "Save now",
    note: "Vibe64 saves as soon as it finishes. Save now includes its unfinished changes."
  });
  assert.equal(f.saves.length, 0, "Save waits rather than include the AI's unfinished changes");
  f.server.mainTurn = { active: false };
  await running.aiTasks.onTurnSettled({ sessionId: SESSION, conversationId: "", failure: null });
  await f.quiet(running.aiTasks);
  assert.equal((await f.task(task.id)).phase, "done");
  assert.equal(f.saves.length, 1);
  running.aiTasks.closeRunner();
}, { updateFailure: null, saveFailed: saveFailure }));

test("Fix Save waits while the main chat's AI is between a workflow's turns, offering its choices, and saves once it is done", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "save");
  await f.quiet(running.aiTasks);
  f.server.mainTurn = { active: false };
  f.server.assistantWorking = true;
  await f.finishTurn(running);
  const waiting = await f.task(task.id);
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.message, "Save waits for the main chat's AI to finish");
  assert.ok(!Number.isNaN(Date.parse(waiting.mainChatSince)), "the wait names when it began, so its choices show");
  assert.equal(f.saves.length, 0);
  f.server.assistantWorking = false;
  await running.aiTasks.onTurnSettled({ sessionId: SESSION, conversationId: "", failure: null });
  await f.quiet(running.aiTasks);
  assert.equal((await f.task(task.id)).phase, "done");
  assert.equal(f.saves.length, 1);
  running.aiTasks.closeRunner();
}, { updateFailure: null, saveFailed: saveFailure }));

test("Save now saves a waiting Fix Save at once while the main chat's AI keeps working", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "save");
  await f.quiet(running.aiTasks);
  f.server.mainTurn = { active: true, startedAt: "2026-11-09T10:15:00.000Z" };
  await f.finishTurn(running);
  assert.equal((await f.task(task.id)).waiting, true);
  await running.aiTasks.check(SESSION, { taskId: task.id, whileAiWorks: true, vibe64User: OWNER });
  await f.quiet(running.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "done");
  assert.equal(saved.message, "Session saved. Your work was pushed.");
  assert.equal(f.saves.length, 1);
  running.aiTasks.closeRunner();
}, { updateFailure: null, saveFailed: saveFailure }));

test("Fix Update runs Update while the main chat's AI works: it waits only for its own conversation", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.mainTurn = { active: true, startedAt: "2026-11-09T10:15:00.000Z" };
  await f.finishTurn(running);
  assert.equal((await f.task(task.id)).phase, "done");
  assert.equal(f.updates.length, 1);
}));

test("Fix Update tries Update again when a commit was made in the session while Update ran", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = async () => ({ ok: false, code: "vibe64_session_update_head_moved", error: "A Git commit was made in this session while Update ran." });
  await f.finishTurn(running);
  const waiting = await f.task(task.id);
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.message, "A commit was made in this session while Update ran, so Vibe64 tries again shortly");
  f.server.update = async () => ({ ok: true });
  await running.aiTasks.onTurnSettled({ sessionId: SESSION, conversationId: "", failure: null });
  await f.quiet(running.aiTasks);
  assert.equal((await f.task(task.id)).phase, "done");
  assert.equal(f.updates.length, 2);
  running.aiTasks.closeRunner();
}));

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

/**
 * A host's own kind, as a host adds one: its check saves the AI's repair through public's Save, then runs the
 * host's own step as the person who started the task.
 * @param {string[]} hostRuns who each run of the host's step ran as
 */
function hostStepKind(hostRuns) {
  return ({ sessions, terminals }) => {
    const saveForAiTask = createAiTaskSave({ sessions, terminals });
    return {
      id: "host-step",
      title: "Fix the host step",
      noun: "fix",
      tray: "Fixing the host step…",
      routing: "fix",
      repository: true,
      busy: "The host step is being fixed. Finish that first.",
      opening: "Fix the host step.",
      async problem({ vibe64User }) {
        if (vibe64User?.role !== "owner") throw new Error("Only the workspace owner runs the host step.");
        return { key: "host-step", summary: "The host step failed: exit 3.", details: "", facts: {} };
      },
      brief: problem => `${problem.summary}\nReturn kind=complete once it is fixed.`,
      context: () => "",
      steps: ["The AI fixes the host step", "Vibe64 saves the fix", "The host runs its step"],
      check: {
        by: "vibe64",
        label: "Running the host step…",
        output: "",
        async run(context, task) {
          const saved = await saveForAiTask(context, task, await sessions.inspectSessionWork(context.sessionId, {}));
          if (saved.passed !== true) return saved;
          hostRuns.push(task.startedBy.id);
          return { passed: true, message: "Saved, and the host step ran." };
        },
        retry: { limit: 3, display: "Continue fixing the host step.", message: diagnostic => diagnostic }
      },
      done: "The host step ran."
    };
  };
}

test("a host's own kind runs like public's: only the person it allows starts it, and its check saves before the host's step", async () => {
  const hostRuns = [];
  await withFixture(async (f) => {
    const running = f.boot();
    await assert.rejects(f.start(running.aiTasks, { id: "member", role: "member" }, "host-step"), /Only the workspace owner/u);
    const { task } = await f.start(running.aiTasks, OWNER, "host-step");
    assert.equal(task.title, "Fix the host step");
    await f.quiet(running.aiTasks);
    assert.match(f.native.turns[0].message, /The host step failed: exit 3\./u);
    await f.finishTurn(running);
    const saved = await f.task(task.id);
    assert.equal(saved.phase, "done");
    assert.equal(saved.message, "Saved, and the host step ran.");
    assert.equal(f.saves.length, 1, "the repair was saved through public's Save");
    assert.deepEqual(f.saves[0].destinationReview, { mode: "github", branch: "main" });
    assert.equal(f.saves[0].aiTaskId, task.id);
    assert.deepEqual(hostRuns, ["owner"], "the host's step ran once, as the person who started the task");
  }, { updateFailure: null, hostKinds: [hostStepKind(hostRuns)] });
  assert.throws(() => createAiTaskKinds({
    databaseTools: {}, hostKinds: [{ id: "save" }], pages: {}, project: {}, sessions: {}, terminals: {}
  }), /AI task kind save is defined twice\./u, "a host can't replace one of public's kinds");
});

test("a completed preparation repair runs preparation on the server as a person's Prepare, and the task ends Done", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "workspace-setup");
  assert.equal(task.title, "Fix workspace preparation");
  assert.equal(task.problem.summary, "npm ci failed: ERESOLVE could not resolve.");
  await f.quiet(running.aiTasks);
  assert.match(f.native.turns[0].message, /Recent preparation output:\n\$ npm ci/);
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "done");
  assert.equal(saved.message, "Workspace preparation succeeded.");
  assert.equal(f.setups.length, 1);
  assert.equal(f.setups[0].input.aiTaskId, task.id);
  // The person who started the fix prepares as themselves, so a missing connected copy uses their account.
  assert.equal(f.setups[0].input.vibe64User?.id, "owner");
}, { updateFailure: null, setupFailed: setupFailure }));

test("a preparation fix waits for Update's own fix, which prepares the workspace again", () => withFixture(async (f) => {
  const { aiTasks } = f.boot();
  await assert.rejects(f.start(aiTasks, OWNER, "workspace-setup"), error => error.code === "vibe64_ai_task_update_first");
}, { setupFailed: setupFailure }));

test("a completed sign-in repair signs in as that identity on the server, and the task ends Done", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "preview-identity", { identity: DEVELOPER, error: "Login failed." });
  assert.equal(task.problem.summary, "Preview couldn't sign in as developer.");
  await f.quiet(running.aiTasks);
  assert.match(f.native.turns[0].message, /could not sign in as `developer` \(username: `developer`\)/);
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "done");
  assert.equal(saved.message, "Preview accepts developer now. Choose it again to sign in.");
  assert.deepEqual(f.signIns, [{ identityName: "developer" }]);
}, { updateFailure: null }));

test("a sign-in check with Preview stopped stops at the person, and Check now passes once it runs", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "preview-identity", { identity: DEVELOPER, error: "Login failed." });
  await f.quiet(running.aiTasks);
  f.server.signIn = async () => ({ ok: false, code: "vibe64_preview_identity_preview_not_ready", error: "Preview is stopped." });
  await f.finishTurn(running);
  const stuck = await f.task(task.id);
  assert.equal(stuck.phase, "needs_you");
  assert.equal(stuck.message, "Preview isn't running. Start it, then Check now.");
  f.server.signIn = async () => ({ ok: true });
  await running.aiTasks.check(SESSION, { taskId: task.id });
  await waitFor(async () => (await f.task(task.id)).phase === "done");
  assert.deepEqual(f.signIns.map(input => input.identityName), ["developer", "developer"]);
  assert.equal(f.native.turns.length, 1, "the AI was not asked again");
}, { updateFailure: null }));

test("a project setup repair ends Done once Vibe64's own inspection is ready", () => withFixture(async (f) => {
  f.server.onboarding = async () => onboardingAt("attention", [{ message: "Stack is missing Connected development." }]);
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "project-setup", { mode: "repair" });
  assert.equal(task.title, "Fix project setup");
  assert.equal(task.noun, "fix");
  assert.equal(task.problem.summary, "Stack is missing Connected development.");
  await f.quiet(running.aiTasks);
  assert.match(f.native.turns[0].message, /The opening inspection reports: Stack is missing Connected development\./);
  f.server.onboarding = async () => onboardingAt("ready");
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "done");
  assert.equal(saved.message, "Project setup is ready.");
}, { updateFailure: null }));

test("adopting a project is a task named for the request, and setup waiting for Update refuses a repair", () => withFixture(async (f) => {
  f.server.onboarding = async () => onboardingAt("adoption");
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "project-setup", { mode: "adopt", purpose: "An invoice tool." });
  assert.deepEqual([task.title, task.noun], ["Set up this project", "task"]);
  await f.quiet(running.aiTasks);
  assert.match(f.native.turns[0].message, /What this project is and what I want to run: An invoice tool\./);
  await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  await f.quiet(running.aiTasks);
  f.server.onboarding = async () => ({ ...onboardingAt("attention"), updateFirst: { message: "Update first." } });
  await assert.rejects(f.start(running.aiTasks, OWNER, "project-setup", { mode: "repair" }),
    error => error.code === "vibe64_ai_task_update_first");
}, { updateFailure: null }));

test("setup that can't be read is repaired, and only a repair is offered for it", () => withFixture(async (f) => {
  f.server.onboarding = async () => ({ ok: false, code: "vibe64_onboarding_failed", error: "genesis/stack.md could not be parsed." });
  const running = f.boot();
  await assert.rejects(f.start(running.aiTasks, OWNER, "project-setup", { mode: "inspect" }),
    error => error.code === "vibe64_ai_task_no_problem");
  const { task } = await f.start(running.aiTasks, OWNER, "project-setup", { mode: "repair" });
  assert.equal(task.problem.summary, "genesis/stack.md could not be parsed.");
  await f.quiet(running.aiTasks);
  assert.match(f.native.turns[0].message, /The opening inspection reports: genesis\/stack\.md could not be parsed\./);
}, { updateFailure: null }));

test("creating the Data overview is Done once Vibe64 reads it back valid with every table reviewed", () => withFixture(async (f) => {
  f.server.overview = async () => overviewRead({ present: false });
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "database-overview", { abstraction: "high", scope: "all" });
  assert.deepEqual([task.title, task.noun], ["Create the data overview", "task"]);
  assert.equal(task.problem.summary, "Regenerate the data overview: Very abstract.");
  await f.quiet(running.aiTasks);
  assert.match(f.native.turns[0].message, /Selected abstraction: Very abstract \(high\)/);
  f.server.overview = async () => overviewRead({ unreviewed: ["orders"] });
  await f.finishTurn(running);
  assert.equal((await f.task(task.id)).attempt, 2);
  assert.match(f.native.turns[1].message, /Tables not yet reviewed: orders\./);
  f.server.overview = async () => overviewRead();
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "done");
  assert.equal(saved.message, "The data overview is valid.");
}, { updateFailure: null }));

test("an ungrouped review names its tables, and a database that can't be read stops at needs you", () => withFixture(async (f) => {
  const running = f.boot();
  await assert.rejects(f.start(running.aiTasks, OWNER, "database-overview", { scope: "ungrouped", tables: [] }),
    error => error.code === "vibe64_ai_task_no_problem");
  const { task } = await f.start(running.aiTasks, OWNER, "database-overview", { scope: "ungrouped", tables: ["public.orders"] });
  assert.equal(task.title, "Review the data overview");
  await f.quiet(running.aiTasks);
  assert.match(f.native.turns[0].message, /Review only these currently ungrouped tables: \["orders"\]/);
  f.server.overview = async () => ({ ok: false, code: "vibe64_session_database_unavailable", error: "The database is not running." });
  await f.finishTurn(running);
  const saved = await f.task(task.id);
  assert.deepEqual([saved.phase, saved.reason], ["needs_you", "check_stuck"]);
  assert.equal(f.native.turns.length, 1);
}, { updateFailure: null }));

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

/** Holds the next read of a task's turn until `hold.release`, and resolves `hold.reached` once it is held. */
const heldTurnRead = hold => terminals => ({ ...terminals,
  async readConversationTurn(...args) {
    if (hold.armed) {
      hold.armed = false;
      hold.reached.resolve();
      await hold.release.promise;
    }
    return terminals.readConversationTurn(...args);
  } });

test("a restart during a read of the turn: the old server saves nothing, and the interrupted turn reads as interrupted", () => withFixture(async (f) => {
  const hold = { armed: false, reached: Promise.withResolvers(), release: Promise.withResolvers() };
  const running = f.boot({ terminalsWrap: heldTurnRead(hold) });
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  assert.equal((await f.task(task.id)).phase, "working");
  hold.armed = true;
  const reading = f.quiet(running.aiTasks);
  await hold.reached.promise;
  running.aiTasks.closeRunner();
  Object.assign(f.native, { status: "interrupted", text: "" });
  hold.release.resolve();
  await reading;
  assert.equal((await f.task(task.id)).phase, "working", "the closed server saved nothing");
  const restarted = f.boot();
  await f.quiet(restarted.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "needs_you");
  assert.equal(saved.reason, "interrupted");
}));

test("a restart whose first read of the turn finds the chat busy still reads the interrupted turn as interrupted", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  running.aiTasks.closeRunner();
  Object.assign(f.native, { status: "interrupted", text: "" });
  let busyReads = 1;
  const restarted = f.boot({ terminalsWrap: terminals => ({ ...terminals,
    async readConversationTurn(...args) {
      if (busyReads > 0) {
        busyReads -= 1;
        return { code: "vibe64_agent_write_mode_busy" };
      }
      return terminals.readConversationTurn(...args);
    } }) });
  try {
    await f.quiet(restarted.aiTasks);
    assert.equal((await f.task(task.id)).phase, "working", "a busy read decides nothing");
    await f.quiet(restarted.aiTasks);
    const saved = await f.task(task.id);
    assert.equal(saved.phase, "needs_you");
    assert.equal(saved.reason, "interrupted");
  } finally {
    restarted.aiTasks.closeRunner();
  }
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
  const { task } = await f.start(running.aiTasks, OWNER, "save");
  await f.quiet(running.aiTasks);
  let release;
  f.server.save = () => new Promise((resolve) => { release = resolve; });
  const finishing = f.finishTurn(running);
  await waitFor(() => Boolean(release));
  const answer = await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  assert.equal(answer.task.phase, "cancelling");
  assert.equal(answer.task.check.unstoppable, "Save can't be interrupted. The fix ends as soon as this run finishes.");
  assert.equal("signal" in f.saves[0], false, "Save is never handed a stop");
  release({ ok: false, code: "vibe64_session_save_git_failed", error: "The pre-commit hook failed." });
  await finishing;
  await f.quiet(running.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "not_done");
  assert.equal(saved.reason, "cancelled");
  assert.equal(f.native.turns.length, 1, "nothing goes back to the AI");
  assert.equal(f.native.stops, 0, "a running check is never interrupted");
}, { updateFailure: null, saveFailed: saveFailure }));

/** A fake run that answers only once its stop is used, as a stopped Update or preparation does. */
function stoppedRun(answer) {
  return input => new Promise((resolve) => {
    input.signal.addEventListener("abort", () => resolve(answer), { once: true });
  });
}

const UPDATE_CANCELLED = { ok: false, code: "vibe64_session_update_cancelled", error: "Update was cancelled before it changed this session." };

test("Cancel stops the Update run a fix started, and the task ends Not done once Update answers", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = stoppedRun(UPDATE_CANCELLED);
  const finishing = f.finishTurn(running);
  await waitFor(() => f.updates.length === 1);
  assert.equal(f.updates[0].signal.aborted, false);
  const answer = await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  assert.equal(answer.task.phase, "cancelling");
  assert.equal(answer.task.check.unstoppable, "", "the window says nothing about waiting for a run that stops");
  assert.equal(f.updates[0].signal.aborted, true, "the write that records Cancel stops the run");
  await finishing;
  await f.quiet(running.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "not_done");
  assert.equal(saved.reason, "cancelled");
  assert.equal(f.updates.length, 1, "a cancelled Update is not run again");
  assert.equal(f.native.turns.length, 1, "nothing goes back to the AI");
}));

test("Cancel stops the preparation a fix started, and the task ends Not done once preparation answers", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "workspace-setup");
  await f.quiet(running.aiTasks);
  f.server.setup = stoppedRun({ ok: true, workspaceSetup: { status: "failed",
    diagnostic: "Workspace preparation was cancelled. Prepare workspace runs every step again." } });
  const finishing = f.finishTurn(running);
  await waitFor(() => f.setups.length === 1);
  const answer = await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
  assert.equal(answer.task.phase, "cancelling");
  assert.equal(f.setups[0].input.signal.aborted, true);
  await finishing;
  await f.quiet(running.aiTasks);
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "not_done");
  assert.equal(saved.reason, "cancelled");
  assert.equal(f.setups.length, 1);
}, { updateFailure: null, setupFailed: setupFailure }));

test("a Cancel saved after the runner read a check it owes, before the check runs, still stops it", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = async input => (input.signal.aborted ? UPDATE_CANCELLED : { ok: true });
  // The runner's read of what tasks owe returns before a Cancel is saved, and acts on what it read.
  const store = f.runtime.store;
  let cancelled = false;
  f.runtime.store = { ...store, async listSessionConversations(sessionId) {
    const records = await store.listSessionConversations(sessionId);
    if (!cancelled && records.some(record => record.task?.pending?.effect === "check")) {
      cancelled = true;
      await running.aiTasks.cancel(SESSION, { taskId: task.id, vibe64User: OWNER });
    }
    return records;
  } };
  await f.finishTurn(running);
  await f.quiet(running.aiTasks);
  assert.equal(cancelled, true);
  assert.equal(f.updates.length, 1, "the runner ran the check it read");
  assert.equal(f.updates[0].signal.aborted, true, "the check started already stopped");
  const saved = await f.task(task.id);
  assert.equal(saved.phase, "not_done");
  assert.equal(saved.reason, "cancelled");
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

test("Update refused while another change holds the session waits, and runs when a turn ends", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks);
  await f.quiet(running.aiTasks);
  f.server.update = async () => ({ ok: false, code: "vibe64_agent_write_mode_busy", error: "busy" });
  await f.finishTurn(running);
  const waiting = await f.task(task.id);
  assert.equal(waiting.phase, "checking");
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.message, "Update waits for another change to this session to finish");
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

// The upgrade that removes old repair chats leaves ordinary archived sessions as they were, so their
// records can still carry the client-writable recovery fields AI tasks removed. Every reader must still
// read such a session, and none may take the old chat for a task. (A chat's snapshot passes its stored
// record through, old fields included; no client reads them any more.)
const OLD_RECOVERY_FIELDS = {
  displayMessage: "Fix Update", completionMessage: "Update finished.", dedupeKey: "update:conflict-1",
  failureMessage: "", nextStepMessage: "Run Update again.", recoveryNotice: "Update found conflicts.",
  recoveryOperation: "update", recoveryConflictId: "conflict-1", recoveryContext: "update", recoveryOutcome: "verified",
  recoveryOutcomeMessage: "Session updated.", recoveryRequestId: "request-1", runConflictId: "conflict-1",
  recoveryAutoPaused: true, recoveryRetryKeys: ["update:conflict-1"]
};

test("an archived session whose old repair chat keeps its recovery fields still reads, and no reader takes it for a task", () => withFixture(async (f) => {
  const { aiTasks, conversations } = f.boot();
  await f.store.writeConversationUserMessage(SESSION, { text: "Main question", messageId: "main" });
  await conversations.createTemporaryConversation(SESSION, {
    conversationId: "old-repair", presentation: { title: "Fix Update", draft: "Leftover draft" }, vibe64User: OWNER
  });
  await f.store.writeSessionConversation(SESSION, "old-repair", OLD_RECOVERY_FIELDS);
  const listed = await conversations.listTemporaryConversations(SESSION);
  assert.deepEqual(listed.conversations.map(chat => [chat.conversationId, chat.title, chat.draft]),
    [["old-repair", "Fix Update", "Leftover draft"]]);
  assert.notEqual((await conversations.readTemporaryConversation(SESSION, { conversationId: "old-repair" })).ok, false);

  await f.store.writeStatus(SESSION, "archived");
  await f.store.publishSessionArchive(SESSION);
  assert.equal((await f.store.readConversationLog(SESSION))[0].user.text, "Main question");
  const saved = await f.store.readSessionConversation(SESSION, "old-repair");
  assert.equal(saved.recoveryOperation, "update", "the archive is read back as it was saved");
  assert.deepEqual((await f.store.listSessionConversations(SESSION)).map(record => record.conversationId), ["old-repair"]);
  assert.deepEqual((await aiTasks.list(SESSION, { vibe64User: OWNER })).tasks, [], "an old chat is not a task");
  await assert.rejects(aiTasks.read(SESSION, { taskId: "old-repair" }), error => error.code === "vibe64_ai_task_closed");
  // The chat's own reader refuses an archived session, as it refuses any, before it reads the record.
  await assert.rejects(conversations.listTemporaryConversations(SESSION), error => error.code === "vibe64_session_archived");
}));

test("the temporary chat list holds only the person's chats, and a Fix with AI task reads by its id", () => withFixture(async (f) => {
  const { aiTasks, conversations } = f.boot();
  await conversations.createTemporaryConversation(SESSION, { conversationId: "chat", vibe64User: OWNER });
  const { task } = await f.start(aiTasks);
  await f.quiet(aiTasks);
  const ids = result => result.conversations.map(chat => chat.conversationId).sort();
  assert.deepEqual(ids(await conversations.listTemporaryConversations(SESSION)), ["chat"], "the tabs never list a task");
  const read = await conversations.readTemporaryConversation(SESSION, { conversationId: task.id });
  assert.equal(read.conversationId, task.id);
  assert.equal(read.task.kind, "update", "the task's window binds its conversation through this read");
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

test("Colleague's task sends its request unstructured, stops at your turn and ends with Finish", () => withFixture(async (f) => {
  const running = f.boot();
  await assert.rejects(f.start(running.aiTasks, OWNER, "colleague", { message: "  " }), error => error.code === "vibe64_ai_task_message_missing");
  // A person's own request is a temporary chat; no AI task kind runs it.
  await assert.rejects(f.start(running.aiTasks, OWNER, "free", { message: "Tidy the README." }), error => error.code === "vibe64_ai_task_kind_unknown");
  const { task } = await f.start(running.aiTasks, OWNER, "colleague", { message: "Tidy the README.\nKeep the badges." });
  assert.deepEqual([task.title, task.noun, task.problem.summary], ["Colleague task", "task", "Tidy the README."]);
  await f.quiet(running.aiTasks);
  assert.match(f.native.turns[0].message, /Tidy the README\.\nKeep the badges\.$/);
  assert.ok(!f.native.turns[0].schema, "a request asks for no result schema");
  await f.finishTurn(running);
  const waiting = await f.task(task.id);
  assert.deepEqual([waiting.phase, waiting.reason], ["needs_you", "your_turn"]);
  await running.aiTasks.finish(SESSION, { taskId: task.id, vibe64User: OWNER });
  const saved = await f.task(task.id);
  assert.deepEqual([saved.phase, saved.message], ["done", "You finished this task."]);
}, { updateFailure: null }));

test("a request follows the starter's chat mode and copies recent Main messages only when asked", () => withFixture(async (f) => {
  const running = f.boot();
  const { task } = await f.start(running.aiTasks, OWNER, "colleague", {
    message: "Summarise the open issues.", title: "Issue summary", includeRecentChatContext: true, assistantRouting: { mode: "junior" }
  });
  assert.equal(task.title, "Issue summary");
  const record = await f.store.readSessionConversation(SESSION, task.id);
  assert.equal(JSON.parse(record.routingMetadata.assistant_routing).mode, "junior");
  assert.ok(record.recentChatContext);
}, { updateFailure: null }));

test("a Colleague review waits for its first request, a retry finds the same task, and Colleague's message starts it", () => withFixture(async (f) => {
  const running = f.boot();
  const start = () => running.aiTasks.start(SESSION, { kind: "colleague-review", taskId: "review-1", vibe64User: OWNER });
  const { task } = await start();
  assert.equal(task.id, "review-1");
  assert.deepEqual([task.phase, task.reason, task.title], ["needs_you", "your_turn", "Colleague review"]);
  await f.quiet(running.aiTasks);
  assert.equal(f.native.turns.length, 0);
  assert.equal((await start()).task.id, "review-1");
  await assert.rejects(f.start(running.aiTasks, OWNER, "colleague", { message: "Something else." }), error => error.code === "vibe64_ai_task_open");
  await running.conversations.startTemporaryConversationTurn(SESSION, {
    conversationId: "review-1", messageId: "colleague-1", message: "Review the change without editing.", vibe64User: OWNER
  }, { vibe64User: OWNER });
  await f.quiet(running.aiTasks);
  assert.equal((await f.task("review-1")).phase, "working");
  await f.finishTurn(running);
  assert.equal((await f.task("review-1")).reason, "your_turn");
}, { updateFailure: null }));

test("Colleague can list, read, start, cancel, finish and close tasks, and reads only a bounded summary", () => {
  const tools = new Map(createAiTaskActions({ aiTasks: {} }).filter(action => action.extensions.assistant)
    .map(action => [action.id.replace("vibe64.ai-tasks.", ""), action.extensions.assistant]));
  assert.deepEqual([...tools.keys()], ["list", "read", "start", "cancel", "finish", "close"]);
  const task = { id: "t1", kind: "colleague", title: "Colleague task", phase: "done", reason: "", message: "m".repeat(5000),
    report: "r", problem: { key: "secret key", summary: "Tidy", details: "d" }, log: [{ text: "x" }], startedBy: { id: "owner" } };
  const shown = tools.get("read").transformResult({ ok: true, task });
  assert.deepEqual(Object.keys(shown.task), ["id", "kind", "title", "phase", "reason", "summary", "message", "report"]);
  assert.equal(shown.task.message.length, 2000);
  assert.equal(tools.get("list").transformResult({ ok: true, tasks: Array(12).fill(task) }).tasks.length, 10);
  assert.match(tools.get("start").description, /one AI task at a time/);
});

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
