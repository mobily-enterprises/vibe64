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


test("original Codex completion queue restores the source-less learning context for its Main checkpoint", async t => {
  const { runtime, learningScope } = await learningNativeFixture(t);
  const { createCodexSessionTurnCheckpoint } = await import("../../packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js");
  const { runWithCodexAppServerProjectContext } = await import("../../packages/vibe64-terminals/src/server/codexSessionProviderHost.js");
  const { currentProjectRequestContext, runWithProjectRequestContext } = await import("../../packages/vibe64-core/src/server/projectRequestContext.js");
  const core = import.meta.resolve("@jskit-ai/assistant-core/server/conversation");
  const { createCodexAppServerNotificationQueue } = await import(new URL("./codexNotificationQueue.js", core));
  const id = "learning-completion-context";
  await runtime.createSession({ sessionId: id });
  const threadId = "11111111-1111-4111-8111-111111111111";
  const turnId = "22222222-2222-4222-8222-222222222222";
  const outerTurnId = "33333333-3333-4333-8333-333333333333";
  await runtime.store.writeAgentRunEvent(id, "codex_app_server", { patch: {
    provider: "codex", providerInterface: "codex_app_server", providerThreadId: threadId,
    providerTurnId: turnId, outerTurnId, state: "completed", providerStatus: "completed"
  } });
  const context = Object.freeze({ learningScope, projectRuntimeRoot: runtime.stateRoot,
    vibe64User: { userId: "42" }, learningInstructions: async () => "Exact saved lesson" });
  const failures = [];
  const queue = createCodexAppServerNotificationQueue({ runInContext: runWithCodexAppServerProjectContext,
    reportError: error => failures.push(error) });
  const checkpoint = createCodexSessionTurnCheckpoint({ projectService: {
    createRuntime: async () => {
      assert.deepEqual(currentProjectRequestContext(), context);
      return runtime;
    }, readCurrentProject: () => assert.fail("Learning completion must not read a Working project")
  }, publishSessionChanged: () => assert.fail("Learning completion has no Git success task") });
  const before = await runtime.store.readSession(id);
  let result;
  // The original asynchronous native notification queue owns completion order;
  // its checkpoint callback must restore its admitted context after Send returns.
  await runWithProjectRequestContext({ targetRoot: "/other/working/project", vibe64User: { userId: "other" } }, async () => {
    queue.run({ sessionId: id, projectContext: context }, async () => {
      result = await checkpoint(id, { status: "completed", threadId, turnId });
    });
    await queue.drain(id);
    assert.equal(currentProjectRequestContext().targetRoot, "/other/working/project");
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(result, { ok: true, processed: false, reason: "learning_session_no_git_checkpoint",
    checkpoint: { applicable: false, outerTurnId, outcome: "completed" } });
  assert.deepEqual(await runtime.store.readSession(id), before);
  assert.equal(currentProjectRequestContext(), null);
});

test("original Codex context restoration preserves Working and unscoped callback behavior", async () => {
  const { runWithCodexAppServerProjectContext } = await import("../../packages/vibe64-terminals/src/server/codexSessionProviderHost.js");
  const { currentProjectRequestContext, runWithProjectRequestContext } = await import("../../packages/vibe64-core/src/server/projectRequestContext.js");
  const working = { targetRoot: "/working/project", vibe64User: { userId: "working-owner" } };
  await runWithProjectRequestContext({ targetRoot: "/outer/project" }, async () => {
    await runWithCodexAppServerProjectContext(working, async () => assert.deepEqual(currentProjectRequestContext(), working));
    await runWithCodexAppServerProjectContext({ vibe64User: { userId: "unscoped" } }, async () => {
      assert.equal(currentProjectRequestContext().targetRoot, "/outer/project");
      assert.equal(currentProjectRequestContext().vibe64User, undefined);
    });
    assert.equal(currentProjectRequestContext().targetRoot, "/outer/project");
  });
  assert.equal(currentProjectRequestContext(), null);
});


test("source-bearing Learning retains the original native source and Git checkpoint paths", async t => {
  const { learningScope } = await learningNativeFixture(t);
  const { mkdir, rm, access } = await import("node:fs/promises");
  const path = await import("node:path");
  const { Vibe64SessionRuntime } = await import("@local/vibe64-runtime/server");
  const { managedSessionSourceRoot, projectRuntimeRoot, sourceMetadata, sourcePath, withTemporaryRoot } =
    await import("./vibe64TestHelpers.js");
  const { learningSessionExecutionRoot, readSessionConversationContext } =
    await import("../../packages/vibe64-terminals/src/server/mainConversationBinding.js");
  await withTemporaryRoot(async root => {
    const completions = [], checkpoints = [], publications = [];
    const runtime = new Vibe64SessionRuntime({ projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root),
      projectSessionSourceRoot: managedSessionSourceRoot(root), learningScope: { ...learningScope, noExercise: false },
      inspectSourceByDefault: false,
      learningTeaching: { bindConversation: () => assert.fail("Context reads do not bind teaching"),
        completeConversation: async input => { completions.push(input); } },
      createSessionSource: async ({ session, store }) => {
        const metadata = sourceMetadata(root, session.sessionId);
        await mkdir(metadata.source_path, { recursive: true });
        for (const [name, value] of Object.entries(metadata)) await store.writeMetadataValue(session.sessionId, name, value);
      } });
    for (const engine of ["codex", "claude", "opencode"]) {
      const id = `source-bearing-${engine}`;
      const selection = { engineId: engine, agentId: engine === "opencode" ? "build" : engine,
        modelProviderId: engine === "claude" ? "anthropic" : engine === "opencode" ? "opencode" : "openai",
        modelId: engine === "claude" ? "sonnet" : engine === "opencode" ? "big-pickle" : "gpt-6.1-sol",
        variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
      const session = await runtime.createSession({ sessionId: id, metadata: { assistant_selection: JSON.stringify(selection) } });
      const nativeRoot = await runtime.getNativeExecutionRoot(id);
      assert.equal(nativeRoot, sourcePath(root, id));
      assert.equal(session.sourcePath, nativeRoot);
      await assert.rejects(access(path.join(session.sessionRoot, "native")), { code: "ENOENT" });
      assert.equal(await learningSessionExecutionRoot(runtime, id), "", "Only no-exercise learning opts out of the source path");
      const host = { toolHome: async () => ({ ok: true, toolHomeSource: "/authorized/account" }),
        unavailableWorktree: async (_runtime, receivedId, failure) => { assert.equal(receivedId, id); return failure; } };
      const context = await readSessionConversationContext(engine, { createRuntime: async () => runtime }, id, {}, host);
      assert.equal(context.workdir, nativeRoot);
      assert.equal(context.session.sourcePath, nativeRoot);
      if (engine === "codex") {
        assert.equal(context.ok, true);
        assert.equal(context.executionRoot, nativeRoot);
        await runtime.store.writeMetadataValue(id, "source_removed", "yes");
        const removed = await readSessionConversationContext(engine, { createRuntime: async () => runtime }, id, {}, host);
        assert.equal(removed.ok, false);
        assert.equal(removed.code, "vibe64_session_worktree_unavailable");
        await runtime.store.writeMetadataValue(id, "source_removed", "");
        await rm(nativeRoot, { recursive: true });
        const missing = await readSessionConversationContext(engine, { createRuntime: async () => runtime }, id, {}, host);
        assert.equal(missing.ok, false);
        assert.equal(missing.code, "vibe64_session_worktree_unavailable");
        await mkdir(nativeRoot, { recursive: true });
      }
      const project = Object.freeze({ slug: "actual-practice" });
      const nativeTurn = Object.freeze({ threadId: "native-thread", turnId: `native-${engine}`,
        outerTurnId: `outer-${engine}`, active: false });
      const input = { runtime, sessionId: id, outerTurnId: `outer-${engine}`, outcome: "completed", nativeTurn,
        projectService: { readCurrentProject: async () => project },
        createCheckpoint: async value => {
          assert.equal(completions.at(-1).outerTurnId, value.outerTurnId, "Teaching completion precedes the original Git checkpoint");
          checkpoints.push(value); return { created: true, commit: "d".repeat(40) };
        },
        publishSessionChanged: async (receivedId, event) => publications.push({ id: receivedId, event }) };
      const result = await checkpointSessionTurn(input);
      assert.equal(result.ok, true);
      assert.equal(result.processed, true);
      assert.equal(result.task.status, "ready");
      assert.equal(checkpoints.at(-1).worktreePath, nativeRoot);
      assert.equal(checkpoints.at(-1).project, project);
      assert.equal(checkpoints.at(-1).outerTurnId, input.outerTurnId);
      assert.equal(completions.at(-1).runtime, runtime);
      assert.equal(completions.at(-1).sessionId, id);
      assert.equal(completions.at(-1).nativeTurn, nativeTurn);
      assert.equal(completions.at(-1).outerTurnId, input.outerTurnId);
      assert.equal(completions.at(-1).outcome, "completed");
      assert.equal(publications.at(-1).event.reason, "session-turn-checkpoint-updated");
      const failed = await checkpointSessionTurn({ ...input, outerTurnId: `failed-${engine}`,
        createCheckpoint: async () => { throw new Error("Original practice checkpoint failure"); } });
      assert.equal(failed.ok, false);
      assert.equal(failed.task.status, "failed");
      assert.match(failed.error, /Original practice checkpoint failure/u);
      assert.equal(publications.at(-1).event.reason, "session-turn-checkpoint-failed");
      await runtime.markSessionClosing(id);
      await assert.rejects(() => learningSessionExecutionRoot(runtime, id), { code: "vibe64_learning_session_inactive" });
      await assert.rejects(() => learningSessionExecutionRoot(runtime, id, { allowClosing: "true" }),
        { code: "vibe64_learning_session_inactive" });
      assert.equal(await learningSessionExecutionRoot(runtime, id, { allowClosing: true }), "");
      const control = await readSessionConversationContext(engine, { createRuntime: async () => runtime }, id,
        { allowClosing: true }, host);
      assert.equal(control.workdir, nativeRoot);
      const interrupted = await checkpointSessionTurn({ ...input, outerTurnId: `closing-${engine}`, outcome: "interrupted" });
      assert.equal(interrupted.processed, true);
      assert.equal(checkpoints.at(-1).outcome, "interrupted");
      assert.equal(completions.at(-1).outcome, "interrupted");
    }
    assert.equal(checkpoints.length, 6);
    assert.equal(completions.length, 9);
    assert.equal(publications.length, 9);
  });
});

test("source-less Learning still completes teaching before its truthful no-Git result", async t => {
  const { runtime } = await learningNativeFixture(t);
  const calls = [];
  runtime.learningTeaching = { completeConversation: async input => calls.push(input) };
  const id = "source-less-teaching-checkpoint";
  await runtime.createSession({ sessionId: id });
  const before = await runtime.store.readSession(id);
  const nativeTurn = Object.freeze({ threadId: "native-thread", turnId: "native-turn",
    outerTurnId: "native-outer", active: false });
  const result = await checkpointSessionTurn({ runtime, sessionId: id, outerTurnId: "native-outer", nativeTurn,
    projectService: { readCurrentProject: () => assert.fail("No source-less project lookup") },
    createCheckpoint: () => assert.fail("No source-less Git checkpoint"),
    publishSessionChanged: () => assert.fail("No source-less checkpoint task") });
  assert.equal(result.reason, "learning_session_no_git_checkpoint");
  assert.equal(result.checkpoint.applicable, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runtime, runtime);
  assert.equal(calls[0].sessionId, id);
  assert.equal(calls[0].nativeTurn, nativeTurn);
  assert.equal(calls[0].outerTurnId, "native-outer");
  assert.deepEqual(await runtime.store.readSession(id), before);
});
