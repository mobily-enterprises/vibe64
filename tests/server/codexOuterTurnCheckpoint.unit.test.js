import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkpointSessionTurn, createCodexSessionTurnCheckpoint } from "../../packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js";

import {
  withCodexState
} from "../../packages/vibe64-terminals/src/server/codexConversationStorage.js";

// The service's shutdown tracker; these checkpoints need no shutdown.
const trackShutdownWork = work => work;

test("checkpoint confirmation projects the original outcome after failure cleanup reports interruption", async () => {
  let task;
  const session = { sessionId: "session-1", sourcePath: "/retained/worktree", metadata: {} };
  const runtime = { async getSession() { return session; }, getSessionWithoutSource(sessionId) { return this.getSession(sessionId); }, store: {
    async writeBackgroundTaskEvent(_id, _taskId, value) { task = value.patch; return task; }
  } };
  const tracked = [];
  const checkpointing = checkpointSessionTurn({ runtime, session, sessionId: session.sessionId,
    outerTurnId: "failed-claude-turn", outcome: "interrupted", project: { async readCurrentProject() { return {}; } },
    publishSessionChanged: async () => {},
    trackShutdownWork: work => (tracked.push(work), work),
    createCheckpoint: async () => ({ ok: true, created: false, commit: "a".repeat(40), outcome: "failed" }) });
  assert.deepEqual(tracked, [checkpointing], "shutdown waits for a checkpoint once it has begun");
  const result = await checkpointing;
  assert.equal(result.ok, true);
  assert.equal(task.status, "ready");
  assert.equal(task.error, "");
  assert.equal(task.checkpointOutcome, "failed");
  assert.equal(task.checkpointTurnId, "failed-claude-turn");
});

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
  const driverSource = await readFile(new URL("./providers/codexDriverTurns.js",
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
    getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    store: { writeBackgroundTaskEvent: async (_id, _task, { patch }) => { changes.push(patch); return patch; } }
  };
  const input = { trackShutdownWork, runtime, session, sessionId: session.sessionId, project: { readCurrentProject: async () => ({}) },
    outerTurnId: "claude:conversation:turn", outcome: "interrupted", publishSessionChanged: async () => {} };
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

test("a turn checkpoint also checkpoints each connected copy in its own repository", async () => {
  const source = "/tmp/vibe64-turn/sessions/active/session-1/source";
  const copy = (name) => ({ repository: `example/${name}`, branch: "main", path: `/tmp/vibe64-turn/sessions/active/session-1/connected/${name}`,
    baseCommit: "b".repeat(40), canonicalCommit: "b".repeat(40) });
  const session = { sessionId: "session-1", metadata: {
    connected_copies: JSON.stringify({ library: copy("library"), tools: copy("tools") }),
    source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source"
  } };
  const runtime = {
    getSession: async () => session,
    getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    store: { writeBackgroundTaskEvent: async (_id, _task, { patch }) => patch }
  };
  const received = [];
  const result = await checkpointSessionTurn({ trackShutdownWork, runtime, session, sessionId: session.sessionId, project: { readCurrentProject: async () => ({}) },
    outerTurnId: "claude:conversation:turn", publishSessionChanged: async () => {},
    createCheckpoint: async (value) => {
      received.push([value.worktreePath, value.outerTurnId]);
      return { created: true, commit: "a".repeat(40) };
    } });
  assert.equal(result.ok, true);
  assert.deepEqual(received, [
    [source, "claude:conversation:turn"],
    [copy("library").path, "claude:conversation:turn"],
    [copy("tools").path, "claude:conversation:turn"]
  ]);
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


test("source-bearing Learning retains the original native source and Git checkpoint paths", async () => {
  const learningScope = { learnerId: "42", attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", noExercise: false,
    pin: { course: { courseId: "first-course", release: "0.1.0" }, topic: { schemaVersion: 1, topicId: "getting-started",
      release: "0.1.0", repository: "vibe64/learn-getting-started", commit: "a".repeat(40), topicHash: "b".repeat(64) },
      lesson: { code: "V64-START-00", hash: "c".repeat(64) } } };
  const { mkdir, rm, access } = await import("node:fs/promises");
  const path = await import("node:path");
  const { Vibe64SessionRuntime } = await import("@local/vibe64-runtime/server/runtime");
  const { managedSessionSourceRoot, projectRuntimeRoot, sourceMetadata, sourcePath, withTemporaryRoot } =
    await import("./vibe64TestHelpers.js");
  const { learningSessionExecutionRoot, readSessionConversationContext } =
    await import("../../packages/vibe64-terminals/src/server/mainConversationContext.js");
  await withTemporaryRoot(async root => {
    const checkpoints = [], publications = [];
    const runtime = new Vibe64SessionRuntime({ promptEnvironment: process.env, projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root),
      projectSessionSourceRoot: managedSessionSourceRoot(root), learningScope,
      inspectSourceByDefault: false,
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
      const context = await readSessionConversationContext(engine, { createRuntime: async () => runtime, createRuntimeWithoutSource(options) { return this.createRuntime(options); } }, id, {}, host);
      assert.equal(context.workdir, nativeRoot);
      assert.equal(context.session.sourcePath, nativeRoot);
      if (engine === "codex") {
        assert.equal(context.ok, true);
        assert.equal(context.executionRoot, nativeRoot);
        await runtime.store.writeMetadataValue(id, "source_removed", "yes");
        const removed = await readSessionConversationContext(engine, { createRuntime: async () => runtime, createRuntimeWithoutSource(options) { return this.createRuntime(options); } }, id, {}, host);
        assert.equal(removed.ok, false);
        assert.equal(removed.code, "vibe64_session_worktree_unavailable");
        await runtime.store.writeMetadataValue(id, "source_removed", "");
        await rm(nativeRoot, { recursive: true });
        const missing = await readSessionConversationContext(engine, { createRuntime: async () => runtime, createRuntimeWithoutSource(options) { return this.createRuntime(options); } }, id, {}, host);
        assert.equal(missing.ok, false);
        assert.equal(missing.code, "vibe64_session_worktree_unavailable");
        await mkdir(nativeRoot, { recursive: true });
      }
      const project = Object.freeze({ slug: "actual-practice" });
      const input = { trackShutdownWork, runtime, sessionId: id, outerTurnId: `outer-${engine}`, outcome: "completed",
        project: { readCurrentProject: async () => project },
        createCheckpoint: async value => {
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
      const control = await readSessionConversationContext(engine, { createRuntime: async () => runtime, createRuntimeWithoutSource(options) { return this.createRuntime(options); } }, id,
        { allowClosing: true }, host);
      assert.equal(control.workdir, nativeRoot);
      const interrupted = await checkpointSessionTurn({ ...input, outerTurnId: `closing-${engine}`, outcome: "interrupted" });
      assert.equal(interrupted.processed, true);
      assert.equal(checkpoints.at(-1).outcome, "interrupted");
    }
    assert.equal(checkpoints.length, 6);
    assert.equal(publications.length, 9);
  });
});

test("temporary and Main Codex turns record the same checkpoint outcome for a turn outcome", async () => {
  const patches = [];
  const session = { sessionId: "session-1", sourcePath: "/missing/session-source", metadata: {} };
  const runtime = {
    async getSession() { return session; },
    getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    store: { async writeBackgroundTaskEvent(_id, _task, { patch }) { patches.push(patch); return patch; } }
  };
  const checkpoint = createCodexSessionTurnCheckpoint({
    project: { async createRuntime() { return runtime; }, createRuntimeWithoutSource(options) { return this.createRuntime(options); }, async readCurrentProject() { return {}; } },
    publishSessionChanged: async () => {},
    trackShutdownWork
  });
  for (const [turnOutcome, outcome] of [["user_cancelled", "cancelled"], ["response_delivery_failure", "failed"]]) {
    await checkpoint("session-1", { outerTurnId: `codex:temporary:${turnOutcome}`, status: "completed", turnOutcome });
    assert.equal(patches.at(-1).checkpointOutcome, outcome, turnOutcome);
  }
});
