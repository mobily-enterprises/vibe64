import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkpointSessionTurn } from "../../packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js";

import {
  withCodexState
} from "../../packages/vibe64-terminals/src/server/codexConversationStorage.js";

test("terminal state preserves the stable outer turn independently of provider successor turns", async () => {
  const state = withCodexState({}, {
    sessionId: "session-1",
    metadata: {},
    agentRuns: [{
      id: "codex_app_server",
      outerTurnId: "client-message-1",
      providerThreadId: "provider-thread",
      providerTurnId: "provider-successor-turn",
      state: "active"
    }]
  });
  assert.equal(state.codexAgentTurn.outerTurnId, "client-message-1");
  assert.equal(state.codexAgentTurn.turnId, "provider-successor-turn");
});

test("a new chat turn claims its client message id and stable terminal outcomes checkpoint it", async () => {
  const source = await readFile(new URL(
    "../../packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js",
    import.meta.url
  ), "utf8");
  // Native dispatch lives in the common driver; application checkpoint projection
  // lives in the shared checkpoint owner. Inspect each operation at its current owner.
  const driverSource = await readFile(new URL("./providers/codexDriver.js",
    import.meta.resolve("@jskit-ai/assistant-core/server/conversation")), "utf8");
  assert.match(driverSource, /owner\.dispatchMessage\(sessionId, input/u);
  assert.match(source, /checkpointCodexAppServerTurn\(sessionId/u);
  assert.match(source, /checkpointSessionTurn\(\{/u);
});

test("shared turn checkpoints preserve outcome and expose recovery failures", async () => {
  const session = { sessionId: "session-1", sourcePath: "/tmp/session-source", metadata: {} };
  const changes = [];
  const runtime = {
    getSession: async () => session,
    store: { writeBackgroundTaskEvent: async (_id, _task, { patch }) => { changes.push(patch); return patch; } }
  };
  const input = { runtime, session, sessionId: session.sessionId, projectService: { readCurrentProject: async () => ({}) },
    outerTurnId: "claude:conversation:turn", outcome: "interrupted" };
  let received;
  const created = await checkpointSessionTurn({ ...input, createCheckpoint: async (value) => {
    received = value;
    return { created: true, commit: "a".repeat(40) };
  } });
  assert.equal(created.ok, true);
  assert.equal(received.outerTurnId, input.outerTurnId);
  assert.equal(received.outcome, "interrupted");
  assert.equal(changes.at(-1).status, "ready");
  const failed = await checkpointSessionTurn({ ...input, outerTurnId: "opencode:conversation:turn",
    createCheckpoint: async () => { throw new Error("Disk reserve is too low"); } });
  assert.equal(failed.ok, false);
  assert.equal(changes.at(-1).status, "failed");
  assert.match(changes.at(-1).error, /Disk reserve/u);
});

async function learningNativeFixture(t) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { Vibe64SessionRuntime } = await import("@local/vibe64-runtime/server");
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-learning-native-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const learningScope = { learnerId: "42", attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", noExercise: true,
    pin: { course: { courseId: "first-course", release: "0.1.0" }, topic: { schemaVersion: 1, topicId: "getting-started",
      release: "0.1.0", repository: "vibe64/learn-getting-started", commit: "a".repeat(40), topicHash: "b".repeat(64) },
      lesson: { code: "V64-START-00", hash: "c".repeat(64) } } };
  const runtime = new Vibe64SessionRuntime({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "private"),
    learningScope, learningInstructions: async () => "Teach the exact authorized lesson.",
    promptRenderer: async () => assert.fail("No workspace Genesis rendering"), promptEnvironment: async () => assert.fail("No project Env") });
  return { root, runtime, learningScope };
}

for (const engine of ["codex", "claude", "opencode"]) {
  test(`original ${engine} Main context admits only the validated source-less native root`, async t => {
    const { runtime } = await learningNativeFixture(t);
    const { readSessionConversationContext } = await import("../../packages/vibe64-terminals/src/server/mainConversationBinding.js");
    const selection = { engineId: engine, agentId: engine === "opencode" ? "build" : engine,
      modelProviderId: engine === "claude" ? "anthropic" : engine === "opencode" ? "opencode" : "openai",
      modelId: engine === "claude" ? "sonnet" : engine === "opencode" ? "big-pickle" : "gpt-6.1-sol",
      variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
    const sessionId = `learning-${engine}`;
    const session = await runtime.createSession({ sessionId, metadata: { assistant_selection: JSON.stringify(selection) } });
    const host = { toolHome: async () => ({ ok: true, toolHomeSource: "/authorized/account" }),
      unavailableWorktree: () => assert.fail("Learning cwd is not a missing source worktree") };
    const context = await readSessionConversationContext(engine, { createRuntime: async () => runtime }, sessionId, {}, host);
    assert.equal(context.runtime, runtime);
    assert.equal(context.workdir, await runtime.getNativeExecutionRoot(sessionId));
    assert.equal(context.workdir, session.nativeExecutionRoot);
    assert.equal(context.session.sourcePath, "");
    assert.equal(context.session.metadata.source_path, undefined);
    if (engine === "codex") assert.equal(context.executionRoot, context.workdir);
    await runtime.markSessionClosing(sessionId, { reason: "archived" });
    if (engine === "codex") {
      assert.equal((await readSessionConversationContext(engine, { createRuntime: async () => runtime }, sessionId, {}, host)).ok, false);
    } else await assert.rejects(() => readSessionConversationContext(engine, { createRuntime: async () => runtime }, sessionId, {}, host),
      { code: "vibe64_learning_session_inactive" });
  });
}

test("a learning native turn truthfully skips Git checkpoint without reading project source or writing a success task", async t => {
  const { runtime } = await learningNativeFixture(t);
  const session = await runtime.createSession({ sessionId: "learning-checkpoint" });
  const before = await runtime.store.readSession(session.sessionId);
  let published = false;
  const result = await checkpointSessionTurn({ runtime, session, sessionId: session.sessionId, outerTurnId: "actual-outer-turn",
    outcome: "completed", projectService: { readCurrentProject: async () => assert.fail("No fabricated lesson project") },
    createCheckpoint: async () => assert.fail("Source-less learning cannot checkpoint Git"), publishSessionChanged: async () => { published = true; } });
  assert.deepEqual(result, { ok: true, processed: false, reason: "learning_session_no_git_checkpoint",
    checkpoint: { applicable: false, outerTurnId: "actual-outer-turn", outcome: "completed" } });
  assert.equal(published, false);
  assert.deepEqual(await runtime.store.readSession(session.sessionId), before);
});


test("closing learning contexts retain only the original explicit native control exception", async t => {
  const { runtime } = await learningNativeFixture(t);
  const { readSessionConversationContext } = await import("../../packages/vibe64-terminals/src/server/mainConversationBinding.js");
  for (const engine of ["codex", "claude", "opencode"]) {
    const selection = { engineId: engine, agentId: engine === "opencode" ? "build" : engine,
      modelProviderId: engine === "claude" ? "anthropic" : engine === "opencode" ? "opencode" : "openai",
      modelId: engine === "claude" ? "sonnet" : engine === "opencode" ? "big-pickle" : "gpt-6.1-sol",
      variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
    const id = `closing-${engine}`;
    await runtime.createSession({ sessionId: id, metadata: { assistant_selection: JSON.stringify(selection) } });
    const root = await runtime.getNativeExecutionRoot(id);
    await runtime.markSessionClosing(id, { reason: "archived" });
    const inactive = { code: "vibe64_learning_session_inactive" };
    await assert.rejects(() => runtime.getNativeExecutionRoot(id), inactive);
    await assert.rejects(() => runtime.getNativeExecutionRoot(id, { allowClosing: "true" }), inactive);
    await assert.rejects(() => runtime.getLearningInstructions(id), inactive);
    await assert.rejects(() => runtime.renderPrompt(id, { request: "New work" }), inactive);
    assert.equal(await runtime.getNativeExecutionRoot(id, { allowClosing: true }), root);
    const context = await readSessionConversationContext(engine, { createRuntime: async () => runtime }, id,
      { allowClosing: true }, { toolHome: async () => ({ ok: true, toolHomeSource: "/authorized/account" }),
        unavailableWorktree: () => assert.fail("Control must not fabricate a source workspace") });
    assert.equal(context.workdir, root);
    assert.equal(context.session.sourcePath, "");
    const checkpoint = await checkpointSessionTurn({ runtime, sessionId: id, outerTurnId: `cancel-${engine}`,
      outcome: "interrupted", createCheckpoint: () => assert.fail("Closing learning has no Git source") });
    assert.equal(checkpoint.checkpoint.outcome, "interrupted");
    assert.equal(checkpoint.checkpoint.applicable, false);
  }
});

async function learningCodexControlFixture(t) {
  const { root, runtime } = await learningNativeFixture(t);
  const { createCodexSessionRuntimeHost } = await import("../../packages/vibe64-terminals/src/server/codexRuntimeHost.js");
  const { createCodexLifecyclePreparation } = await import("../../packages/vibe64-terminals/src/server/codexLifecyclePreparation.js");
  const path = await import("node:path");
  const sharedRuntimeDir = path.join(root, "shared-account-runtime");
  const runtimeHost = {
    codexRuntimeForTerminalEnv: () => ({ providerOptions: { runtimeDir: sharedRuntimeDir } }),
    codexAppServerRuntimeOptions: options => ({ ...options, threadWorkdir: options.workdir }),
    codexAppServerRuntimeOptionsFromSessionMetadata: session => ({ runtimeDir: sharedRuntimeDir,
      threadWorkdir: session.metadata.codex_conversation_workdir }),
    codexAppServerPersistedRuntimeHost: () => assert.fail("Shared account process must be retained")
  };
  const projectService = { createRuntime: async () => runtime };
  const sessionRuntimeHost = createCodexSessionRuntimeHost({ runtimeHost, projectService,
    accountPreparation: { codexToolHomeResult: async () => ({ ok: true, toolHomeSource: path.join(root, "account") }) },
    sessionEnvironment: { codexManagedCommandEnv: () => assert.fail("No source command admission during control") },
    runCommand: () => assert.fail("No project environment command during control") });
  const preparation = createCodexLifecyclePreparation({ projectService, runtimeHost, sessionRuntimeHost,
    sessionEnvironment: { codexAttachmentEnv: () => ({}) },
    providerHost: { codexAppServerSessionProviderContext: (_id, options) => options },
    conversationPreparation: {}, helperPreparation: { restoration: () => ({ projectRuntimeRoot: runtime.stateRoot, context: {} }) },
    health: {}, runtimeLifecycle: { sessionClosures: new Map() }, renewalSessionClosures: new Set(), enabled: true });
  return { root, runtime, preparation, sessionRuntimeHost, sharedRuntimeDir };
}

test("original Codex cleanup unsubscribes the closing learning thread and retains the shared account sibling", async t => {
  const { runtime, preparation, sessionRuntimeHost, sharedRuntimeDir } = await learningCodexControlFixture(t);
  const core = import.meta.resolve("@jskit-ai/assistant-core/server/conversation");
  const { createCodexSessionCleanup } = await import(new URL("./codexSessionCleanup.js", core));
  const { createCodexAppServerProviderOwner } = await import(new URL("./codexProviderOwner.js", core));
  const { codexTerminalNamespace } = await import("../../packages/vibe64-terminals/src/server/terminalShared.js");
  const id = "closing-retained-thread";
  await runtime.createSession({ sessionId: id });
  const nativeRoot = await runtime.getNativeExecutionRoot(id);
  const threadId = "11111111-1111-4111-8111-111111111111";
  await runtime.store.writeMetadataValue(id, "codex_conversation_id", threadId);
  await runtime.store.writeMetadataValue(id, "codex_conversation_workdir", nativeRoot);
  await runtime.store.writeMetadataValue(id, "agent_transport_runtime_dir", sharedRuntimeDir);
  const session = await runtime.getSession(id);
  const executionOptions = await sessionRuntimeHost.codexAppServerRuntimeOptionsForSession(session, { runtime });
  const events = [];
  const providerOwner = createCodexAppServerProviderOwner({ runtimeRoot: sharedRuntimeDir });
  providerOwner.createProvider({ providerKey: "learning", providerOptions: { runtimeDir: sharedRuntimeDir },
    owner: { sessionKey: codexTerminalNamespace(id), workdir: nativeRoot }, create: () => ({
      unsubscribeThread: async received => { events.push(["unsubscribe", received]); return { status: "unsubscribed" }; },
      close: () => events.push(["detach-learning"]), stopRuntime: () => assert.fail("Do not stop shared sibling")
    }) });
  providerOwner.createProvider({ providerKey: "sibling", providerOptions: { runtimeDir: sharedRuntimeDir },
    owner: { sessionKey: "sibling", workdir: "/other/admitted/root" }, create: () => ({
      close: () => events.push(["detach-sibling"]), stopRuntime: async () => ({ stopped: true })
    }) });
  t.after(() => providerOwner.stopCachedProvidersForSession("sibling"));
  await runtime.markSessionClosing(id, { reason: "archived" });
  const current = await runtime.getSession(id);
  await assert.rejects(() => sessionRuntimeHost.codexAppServerRuntimeOptionsForSession(current, { runtime }),
    { code: "vibe64_learning_session_inactive" });
  const controlOptions = await sessionRuntimeHost.codexAppServerControlRuntimeOptionsForSession(current, { runtime });
  assert.equal(controlOptions.workdir, executionOptions.workdir);
  assert.equal(controlOptions.runtimeDir, executionOptions.runtimeDir);
  assert.deepEqual(controlOptions.terminalEnv, executionOptions.terminalEnv);
  const unsubscription = await preparation.prepareCodexAppServerThreadUnsubscription(id);
  assert.equal(unsubscription.threadId, threadId);
  assert.equal(unsubscription.workdir, nativeRoot);
  const cleanup = createCodexSessionCleanup({ namespace: codexTerminalNamespace,
    providerSessions: { owner: providerOwner }, runOwner: { notificationQueue: { drain: async () => events.push(["drain-output"]) } },
    journal: { clearSessionRecoveryTimers: () => {} },
    helperLifecycle: { assertRestored: () => {}, restoreThreads: async () => ({}), assertRetired: () => {}, retireAll: async () => ({}) },
    conversations: { closeCodexAppServerConversations: async () => events.push(["close-temporary"]) },
    debugLog: () => {}, debugError: error => error });
  await cleanup.closeSession(id, preparation.prepareCodexSessionCleanup(id));
  assert.deepEqual(events, [["close-temporary"], ["unsubscribe", threadId], ["drain-output"], ["detach-learning"]]);
  assert.equal(providerOwner.providers.get("learning"), undefined);
  assert.ok(providerOwner.providers.get("sibling"));
  const output = await sessionRuntimeHost.codexAppServerOutputContext({ runtime, session: current });
  assert.equal(output.managedIdentity.workdir, nativeRoot);
  assert.equal((await output.providerOptions()).workdir, nativeRoot);
});

test("historical learning Codex storage retains native identity without reopening execution or creating a directory", async t => {
  const { runtime, preparation, sessionRuntimeHost } = await learningCodexControlFixture(t);
  const { access } = await import("node:fs/promises");
  const id = "historical-native-storage";
  await runtime.createSession({ sessionId: id });
  const nativeRoot = await runtime.getNativeExecutionRoot(id);
  await runtime.archiveSession(id);
  const session = await runtime.getSession(id);
  assert.equal(session.nativeExecutionRoot, "");
  await assert.rejects(() => access(nativeRoot), { code: "ENOENT" });
  await assert.rejects(() => runtime.getNativeExecutionRoot(id, { allowClosing: true }), { code: "vibe64_learning_session_inactive" });
  await assert.rejects(() => sessionRuntimeHost.codexAppServerControlRuntimeOptionsForSession(session, { runtime }),
    { code: "vibe64_learning_session_inactive" });
  const storage = await preparation.prepareNativeStorageProvider(id, { modelProviderId: "openai" }, { runtime, session });
  assert.equal(storage.providerContext.workdir, nativeRoot);
  assert.equal(storage.providerContext.executionRoot, nativeRoot);
  await assert.rejects(() => access(nativeRoot), { code: "ENOENT" });
  await assert.rejects(() => preparation.prepareCodexAppServerThreadUnsubscription("other-attempt"),
    { code: "vibe64_session_not_found" });
});


test("the original Main dispatch marks only interruption as closing control before reading native context", async t => {
  const { runtime } = await learningNativeFixture(t);
  const { createSessionAgentManager } = await import("../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js");
  const { readSessionConversationContext } = await import("../../packages/vibe64-terminals/src/server/mainConversationBinding.js");
  for (const engine of ["codex", "claude", "opencode"]) {
    const selection = { engineId: engine, agentId: engine === "opencode" ? "build" : engine,
      modelProviderId: engine === "claude" ? "anthropic" : engine === "opencode" ? "opencode" : "openai",
      modelId: engine === "claude" ? "sonnet" : engine === "opencode" ? "big-pickle" : "gpt-6.1-sol",
      variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
    const id = `dispatch-closing-${engine}`;
    await runtime.createSession({ sessionId: id, metadata: { assistant_selection: JSON.stringify(selection) } });
    await runtime.markSessionClosing(id, { reason: "archived" });
    const session = await runtime.getSession(id);
    const controls = [];
    const manager = createSessionAgentManager({ defaultProviderId: engine,
      providers: [{ id: engine, transportId: `${engine}-controlled`, conversationOperations: ["interruptTurn", "sendMessage"],
        prepareConversationRequest: (_method, _context, input) => ({ input }),
        projectConversationResult: (_method, perform) => perform() }],
      readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "controlled-account" }),
      conversationRuntime: { async open({ context }) {
        const native = await readSessionConversationContext(engine, { createRuntime: async () => runtime }, id, context,
          { toolHome: async () => ({ ok: true, toolHomeSource: "/authorized/account" }), unavailableWorktree: () => assert.fail("No fake source") });
        if (native.ok === false) throw Object.assign(new Error(native.error), { code: native.code });
        controls.push(context.allowClosing);
        return { cancel: async () => ({ ok: true }), send: () => assert.fail("Closing session cannot send") };
      } } });
    assert.equal((await manager.interruptTurn(id, {}, { runtime, session })).ok, true);
    assert.deepEqual(controls, [true]);
    await assert.rejects(() => manager.sendMessage(id, { message: "New work" }, { runtime, session }),
      error => ["vibe64_session_closing", "vibe64_learning_session_inactive"].includes(error.code));
    assert.deepEqual(controls, [true]);
  }
});
