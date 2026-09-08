import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";

import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_PROVIDER_ID
} from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV
} from "../../packages/vibe64-runtime/src/server/codexAttachmentPaths.js";
import {
  runVibe64AgentWriteExclusive,
  runVibe64RenewalAgentWriteExclusive
} from "../../packages/vibe64-runtime/src/server/agentWriteLock.js";
import {
  createVibe64SessionStore
} from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import {
  createService as createTerminalService
} from "../../packages/vibe64-terminals/src/server/service.js";

const execFileAsync = promisify(execFile);

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function agentWriteLockHarness({ holdFirst = false, secondValue = null } = {}) {
  let active = false;
  let attemptNumber = 0;
  const attempts = [];
  const firstEntered = deferred();
  const firstFinished = deferred();
  const releaseFirst = deferred();

  async function runSessionExclusive(sessionId, operationName, operation, options = {}) {
    attemptNumber += 1;
    const currentAttempt = attemptNumber;
    attempts.push({
      operationName,
      sessionId,
      ...(Number(options.waitMs) > 0 ? { waitMs: Number(options.waitMs) } : {})
    });
    if (active) {
      if (Number(options.waitMs) > 0) {
        await firstFinished.promise;
      } else {
        return {
          acquired: false,
          value: null
        };
      }
    }
    active = true;
    if (currentAttempt === 1) {
      firstEntered.resolve();
      if (holdFirst) {
        await releaseFirst.promise;
      }
    }
    try {
      return {
        acquired: true,
        value: currentAttempt === 2 && secondValue !== null
          ? secondValue
          : await operation()
      };
    } finally {
      active = false;
      if (currentAttempt === 1) {
        firstFinished.resolve();
      }
    }
  }

  return {
    attempts,
    firstEntered: firstEntered.promise,
    releaseFirst: releaseFirst.resolve,
    store: {
      runSessionExclusive,
      runSessionExclusiveForRenewal: runSessionExclusive
    }
  };
}

async function terminalServiceFixture(t, lock, {
  logger = null,
  publishSessionChanged = {}
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-work-admission-"));
  const sourcePath = path.join(root, "managed", "sessions", "active", "session-1", "source");
  const projectContextRoot = path.join(root, "authority");
  const projectRuntimeRoot = path.join(root, "runtime");
  const attachmentRoot = path.join(root, "attachments");
  await Promise.all([
    mkdir(sourcePath, { recursive: true }),
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true })
  ]);
  const session = {
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionId: "session-1",
    sessionRoot: path.join(projectRuntimeRoot, "sessions", "active", "session-1"),
    status: "active",
    workspaceSetup: {
      status: "unconfigured"
    }
  };
  const sessionStore = createVibe64SessionStore({
    logger,
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot: path.join(root, "managed", "sessions")
  });
  await sessionStore.createSession({
    metadata: session.metadata,
    runtimeKind: "genesis",
    sessionId: session.sessionId
  });
  const runtime = {
    async getSession() {
      return session;
    },
    projectContextRoot,
    async resolvePromptEnvironment() { return {}; },
    stateRoot: projectRuntimeRoot,
    store: {
      ...sessionStore,
      ...lock.store,
      async writeMetadataValue(_sessionId, name, value) {
        session.metadata[name] = value;
        if (name === "workspace_setup") {
          session.workspaceSetup = JSON.parse(value);
        }
      }
    }
  };
  const projectService = {
    createSessionStore() {
      return {};
    },
    createRuntime() {
      return runtime;
    },
    currentTargetRoot() {
      return projectContextRoot;
    },
    async projectExecutionEnvironment() {
      return {};
    },
    async readCurrentProject() {
      return {
        projectContextRoot,
        slug: "test-project"
      };
    },
    async readEnv() {
      return { ok: true, records: [] };
    },
    async runInProjectContext(_context, operation) {
      return operation();
    },
    async saveEnvUserValues() {
      return { ok: true };
    }
  };
  const service = createTerminalService({
    logger,
    codexTerminalController: {
      codexToolHomeRequired: false
    },
    env: {
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot,
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService,
    publishSessionChanged
  });
  t.after(async () => {
    await service.close();
    await rm(root, { force: true, recursive: true });
  });
  return {
    attachmentRoot,
    root,
    runtime,
    service,
    session
  };
}

test("output attempts invalidate output state in other clients", async (t) => {
  const published = [];
  const lock = agentWriteLockHarness();
  const { service, session } = await terminalServiceFixture(t, lock, {
    publishSessionChanged: {
      async outputTarget(sessionId, payload) {
        published.push({ payload, sessionId });
      }
    }
  });

  const result = await service.startOutputTargetTerminal(session.sessionId, {
    outputTargetId: "missing",
    originId: "tab:preview-a"
  });

  assert.equal(result.ok, false);
  assert.deepEqual(published, [{
    payload: {
      originId: "tab:preview-a",
      reason: "output-target-started"
    },
    sessionId: session.sessionId
  }]);
});

test("workspace setup admission uses the session agent-write lock", async (t) => {
  const lock = agentWriteLockHarness({ holdFirst: true });
  const { service, session } = await terminalServiceFixture(t, lock);

  const preparing = service.prepareWorkspaceSetup(session.sessionId, {
    retry: true
  });
  await lock.firstEntered;
  const competing = await service.prepareWorkspaceSetup(session.sessionId, {
    retry: true
  });

  assert.deepEqual(competing, {
    code: "vibe64_agent_write_mode_busy",
    error: "Another assistant operation is starting. Try again in a moment.",
    ok: false,
    retryable: true
  });
  lock.releaseFirst();
  const prepared = await preparing;
  assert.equal(typeof prepared.state.status, "string");
  assert.deepEqual(lock.attempts, [
    { operationName: "agent-write-mode", sessionId: session.sessionId },
    { operationName: "agent-write-mode", sessionId: session.sessionId }
  ]);
});

test("foreground chat waits for workspace setup admission instead of failing", async (t) => {
  const lock = agentWriteLockHarness({
    holdFirst: true,
    secondValue: {
      delivered: true,
      ok: true
    }
  });
  const { service, session } = await terminalServiceFixture(t, lock);

  const preparing = service.prepareWorkspaceSetup(session.sessionId, {
    retry: true
  });
  await lock.firstEntered;
  let sendSettled = false;
  const sending = service.sendAgentMessage(session.sessionId, {
    message: "Send this after setup.",
    messageId: "message-after-workspace-setup"
  }).finally(() => {
    sendSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sendSettled, false);
  lock.releaseFirst();
  await preparing;
  const result = await sending;

  assert.notEqual(result.code, "vibe64_agent_write_mode_busy");
  assert.deepEqual(lock.attempts, [
    { operationName: "agent-write-mode", sessionId: session.sessionId },
    {
      operationName: "agent-write-mode",
      sessionId: session.sessionId,
      waitMs: 60_000
    }
  ]);
});

test("assistant preparation waits for overlapping admission instead of reporting unknown status", async (t) => {
  const lock = agentWriteLockHarness({
    holdFirst: true,
    secondValue: { ok: true }
  });
  const { service, session } = await terminalServiceFixture(t, lock);
  const preparing = service.prepareWorkspaceSetup(session.sessionId, { retry: true });
  await lock.firstEntered;
  let settled = false;
  const checking = service.ensureAgentSession(session.sessionId).finally(() => {
    settled = true;
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
  } finally {
    lock.releaseFirst();
    await preparing;
  }
  assert.equal((await checking).ok, true);
  assert.equal(lock.attempts[1].waitMs, 10_000);
});

test("assistant reconciliation retains structured failure diagnostics", async (t) => {
  const warnings = [];
  const lock = agentWriteLockHarness();
  const { service, runtime, session } = await terminalServiceFixture(t, lock, {
    logger: { warn(fields) { warnings.push(fields); } }
  });
  runtime.store.runSessionExclusive = async () => ({ acquired: false });
  const busy = await service.ensureAgentSession(session.sessionId);
  assert.equal(busy.code, "vibe64_agent_write_mode_busy");
  assert.equal(warnings[0].event, "vibe64.agent_session.reconciliation_failed");
  assert.equal(warnings[0].code, busy.code);
  assert.equal(warnings[0].sessionId, session.sessionId);
  assert.equal(typeof warnings[0].durationMs, "number");

  const failure = Object.assign(new Error("Provider connection failed"), { code: "provider_unavailable" });
  runtime.store.runSessionExclusive = async () => { throw failure; };
  const failed = await service.ensureAgentSession(session.sessionId);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, failure.code);
  assert.equal(failed.error, failure.message);
  assert.equal(warnings[1].code, failure.code);
  assert.equal(warnings[1].event, "vibe64.agent_session.reconciliation_failed");
});

for (const method of ["saveSessionWork", "updateSessionWork"]) {
  test(`${method} waits behind preparation and admits repository work exactly once`, { timeout: 15_000 }, async (t) => {
    const contended = deferred();
    const { runtime, service, session } = await terminalServiceFixture(t, { store: {} }, {
      logger: {
        info() {},
        warn(event) { if (event.event === "vibe64.session_lock.contended") contended.resolve(event); }
      }
    });
    const entered = deferred();
    const release = deferred();
    const preparing = runVibe64AgentWriteExclusive(runtime, session.sessionId, async () => {
      entered.resolve();
      await release.promise;
    }, { operation: "prepare-agent-session" });
    await entered.promise;
    const admitted = new Error("Repository admission reached; no Git or AI work needed for this test");
    let acquisitions = 0;
    const requested = service[method](session.sessionId, {
      onRepositoryWriteAcquired() { acquisitions += 1; throw admitted; }
    }).catch((error) => error);
    try {
      const contention = await contended.promise;
      assert.equal(contention.waitMs, 10_000);
      assert.equal(contention.owner.operation, "prepare-agent-session");
      assert.equal(acquisitions, 0);
    } finally {
      release.resolve();
      await preparing;
    }
    assert.equal(await requested, admitted);
    assert.equal(acquisitions, 1);
  });
}

test("Save rechecks active assistant work after waiting for preparation", { timeout: 15_000 }, async (t) => {
  const contended = deferred();
  const { runtime, service, session } = await terminalServiceFixture(t, { store: {} }, {
    logger: { info() {}, warn(event) { if (event.event.endsWith(".contended")) contended.resolve(); } }
  });
  const entered = deferred();
  const release = deferred();
  const preparing = runVibe64AgentWriteExclusive(runtime, session.sessionId, async () => {
    entered.resolve();
    await release.promise;
  }, { operation: "prepare-agent-session" });
  await entered.promise;
  const requested = service.saveSessionWork(session.sessionId, {
    onRepositoryWriteAcquired() { assert.fail("Active assistant must prevent repository work"); }
  }).catch((error) => error);
  try {
    await contended.promise;
    session.agentRuns = [{ active: true, state: "active", runId: "started-during-wait" }];
  } finally {
    release.resolve();
    await preparing;
  }
  assert.equal((await requested).code, "vibe64_session_save_agent_active");
});

test("Save preparation timeout returns an actionable retry without starting repository work", async (t) => {
  const { runtime, service, session } = await terminalServiceFixture(t, { store: {} });
  runtime.store.runSessionExclusive = async (_sessionId, _lockName, _operation, options) => {
    assert.equal(options.waitMs, 10_000);
    return { acquired: false, value: null, blockingOperation: "prepare-agent-session" };
  };
  await assert.rejects(service.saveSessionWork(session.sessionId, {
    onRepositoryWriteAcquired() { assert.fail("Timed out Save must not start"); }
  }), {
    code: "vibe64_agent_write_mode_busy",
    message: "The assistant is still reconnecting. Wait until it is ready, then try again.",
    details: { blockingOperation: "prepare-agent-session" },
    retryable: true
  });
});

test("rebase, assistant preparation and temporary repair identify their lock requests", async (t) => {
  const lock = agentWriteLockHarness();
  const { service, runtime, session } = await terminalServiceFixture(t, lock);
  const operations = [];
  runtime.store.runSessionExclusive = async (_sessionId, _lockName, _operation, options) => {
    operations.push(options.operation);
    return { acquired: false };
  };
  await assert.rejects(service.updateSessionWork(session.sessionId), {
    code: "vibe64_agent_write_mode_busy"
  });
  assert.equal((await service.ensureAgentSession(session.sessionId)).code, "vibe64_agent_write_mode_busy");
  assert.equal((await service.streamDetachedAgentChatTurn(session.sessionId)).code, "vibe64_agent_write_mode_busy");
  assert.deepEqual(operations, ["update-session-work", "prepare-agent-session", "stream-temporary-chat"]);
});

test("workspace setup reuses an already-held session agent-write lock", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-workspace-nested-lock-"));
  const sourcePath = path.join(root, "managed", "session-1", "source");
  const projectContextRoot = path.join(root, "authority");
  const projectRuntimeRoot = path.join(root, "runtime");
  await Promise.all([
    mkdir(sourcePath, { recursive: true }),
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true })
  ]);
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot
  });
  await store.createSession({
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    runtimeKind: "genesis",
    sessionId: "session-1"
  });
  const runtime = {
    getSession(sessionId) {
      return store.readSession(sessionId);
    },
    projectContextRoot,
    async resolvePromptEnvironment() { return {}; },
    stateRoot: projectRuntimeRoot,
    store
  };
  const projectService = {
    createSessionStore() {
      return store;
    },
    createRuntime() {
      return runtime;
    },
    currentTargetRoot() {
      return projectContextRoot;
    },
    async projectExecutionEnvironment() {
      return {};
    },
    async readCurrentProject() {
      return { projectContextRoot, slug: "test-project" };
    },
    async readEnv() {
      return { ok: true, records: [] };
    },
    async runInProjectContext(_context, operation) {
      return operation();
    },
    async saveEnvUserValues() {
      return { ok: true };
    }
  };
  const service = createTerminalService({
    codexTerminalController: { codexToolHomeRequired: false },
    env: {
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: path.join(root, "attachments"),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService
  });
  t.after(async () => {
    await service.close();
    await rm(root, { force: true, recursive: true });
  });

  const nested = await runVibe64AgentWriteExclusive(
    runtime,
    "session-1",
    () => service.prepareWorkspaceSetup("session-1", {
      retry: true,
      runtime
    })
  );

  assert.equal(nested.acquired, true);
  assert.equal(typeof nested.value.state.status, "string");
  assert.notEqual(nested.value.code, "vibe64_agent_write_mode_busy");
});

test("repository update checks do not occupy assistant-write admission", async (t) => {
  const lock = agentWriteLockHarness({ holdFirst: true });
  const { runtime, service, session } = await terminalServiceFixture(t, lock);
  const activeAgent = runVibe64AgentWriteExclusive(
    runtime,
    session.sessionId,
    async () => null
  );
  await lock.firstEntered;
  session.metadata.source_path = "";

  await assert.rejects(
    () => service.checkSessionUpdates(session.sessionId),
    { code: "vibe64_codex_git_command_source_missing" }
  );
  assert.equal(lock.attempts.length, 1);

  lock.releaseFirst();
  assert.equal((await activeAgent).acquired, true);
});

test("renewal workspace setup privately resumes a pending successor while public setup rejects it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-renewal-workspace-setup-"));
  const projectContextRoot = path.join(root, "authority");
  const projectRuntimeRoot = path.join(root, "runtime");
  const sourcePath = path.join(root, "managed", "sessions", "active", "renewal-successor", "source");
  await Promise.all([
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(sourcePath, { recursive: true })
  ]);
  await execFileAsync("git", ["init", "--quiet", sourcePath]);
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot
  });
  await store.createSession({
    runtimeKind: "genesis",
    sessionId: "renewal-source"
  });
  await store.quiesceSessionForRenewal({
    renewalId: "workspace-setup-renewal",
    sourceSessionId: "renewal-source"
  });
  await store.createRenewalPendingSession({
    actorDisplayName: "Ada",
    actorId: "ada-owner",
    confirmedAt: "2026-08-24T01:01:00.000Z",
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      workspace_setup: JSON.stringify({
        startedAt: "2026-08-24T01:02:00.000Z",
        status: "running",
        updatedAt: "2026-08-24T01:02:00.000Z"
      })
    },
    renewalId: "workspace-setup-renewal",
    renewedFrom: "renewal-source",
    runtimeKind: "genesis",
    sessionId: "renewal-successor"
  });
  const runtime = {
    async getSession(sessionId) {
      const session = await store.readSession(sessionId);
      return {
        ...session,
        workspaceSetup: JSON.parse(session.metadata.workspace_setup)
      };
    },
    async getSessionForRenewal(sessionId) {
      const session = await store.readSessionForRenewal(sessionId);
      return {
        ...session,
        workspaceSetup: JSON.parse(session.metadata.workspace_setup)
      };
    },
    projectContextRoot,
    async resolvePromptEnvironment() { return {}; },
    stateRoot: projectRuntimeRoot,
    store
  };
  const projectService = {
    createSessionStore() {
      return store;
    },
    createRuntime() {
      return runtime;
    },
    currentTargetRoot() {
      return projectContextRoot;
    },
    async projectExecutionEnvironment() {
      return {};
    },
    async readCurrentProject() {
      return { projectContextRoot, slug: "test-project" };
    },
    async readEnv() {
      return { ok: true, records: [] };
    },
    async runInProjectContext(_context, operation) {
      return operation();
    },
    async saveEnvUserValues() {
      return { ok: true };
    }
  };
  const service = createTerminalService({
    codexTerminalController: { codexToolHomeRequired: false },
    env: {
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: path.join(root, "attachments"),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService
  });
  t.after(async () => {
    await service.close();
    await rm(root, { force: true, recursive: true });
  });

  await assert.rejects(
    () => service.prepareWorkspaceSetup("renewal-successor", {
      retry: true,
      runtime
    }),
    { code: "vibe64_session_renewal_private" }
  );

  const privateAttempt = await service.prepareRenewalWorkspaceSetup("renewal-successor", {
    retry: true,
    runtime
  });
  assert.equal(privateAttempt.state.status, "unconfigured");
  const successor = await store.readSessionForRenewal("renewal-successor");
  assert.equal(
    JSON.parse(successor.metadata.workspace_setup).status,
    "unconfigured"
  );
  await assert.rejects(
    () => store.readSession("renewal-successor"),
    { code: "vibe64_session_renewal_private" }
  );
});

test("renewal terminal cleanup accepts a restored active predecessor for a later renewal", async (t) => {
  const lock = agentWriteLockHarness();
  const { root, runtime, service, session } = await terminalServiceFixture(t, lock);
  const transitionStore = createVibe64SessionStore({
    projectContextRoot: path.join(root, "renewal-authority"),
    projectRuntimeRoot: path.join(root, "renewal-runtime")
  });
  await transitionStore.createSession({
    runtimeKind: "genesis",
    sessionId: session.sessionId
  });
  await transitionStore.quiesceSessionForRenewal({
    renewalId: "finished-renewal",
    sourceSessionId: session.sessionId
  });
  const restored = await transitionStore.restoreSessionAfterRenewalCancellation({
    renewalId: "finished-renewal",
    restoredAt: "2026-08-25T01:00:00.000Z",
    sourceSessionId: session.sessionId
  });
  const runtimeDir = path.join(root, "codex-app-server-restored-renewal");
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(
    path.join(runtimeDir, "runtime.json"),
    `${JSON.stringify({
      pid: 99_999_999,
      processExitVerifiedAt: "2026-08-25T01:00:01.000Z",
      processIdentity: {
        commandHash: "0123456789ab",
        platform: "linux-proc",
        runtimeToken: "11111111-1111-4111-8111-111111111111",
        startTimeTicks: "1",
        version: 1
      },
      processState: "stopped",
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      runtimeDir,
      schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
      transport: "unix"
    }, null, 2)}\n`,
    "utf8"
  );
  session.metadata.agent_transport_runtime_dir = runtimeDir;
  Object.assign(session.metadata, restored.metadata);
  session.status = restored.status;
  assert.equal(session.metadata.renewal_restored_id, "finished-renewal");
  assert.equal(session.metadata.renewal_quiesced_id, undefined);

  const closed = await service.closeRenewalPredecessorSessionTerminals(session, {
    renewalId: "later-renewal",
    runtime
  });

  assert.equal(closed.ok, true);
  const requiesced = await transitionStore.quiesceSessionForRenewal({
    renewalId: "later-renewal",
    sourceSessionId: session.sessionId
  });
  assert.equal(requiesced.metadata.renewal_quiesced_id, "later-renewal");
  assert.equal(requiesced.metadata.renewal_restored_id, undefined);
});

test("renewal terminal cleanup rejects foreign quiescence and already-renewed predecessors", async (t) => {
  const lock = agentWriteLockHarness();
  const { runtime, service, session } = await terminalServiceFixture(t, lock);

  session.metadata.renewal_quiesced_id = "foreign-renewal";
  await assert.rejects(
    () => service.closeRenewalPredecessorSessionTerminals(session, {
      renewalId: "requested-renewal",
      runtime
    }),
    { name: "TypeError" }
  );

  session.status = "renewal_quiesced";
  await assert.rejects(
    () => service.closeRenewalPredecessorSessionTerminals(session, {
      renewalId: "requested-renewal",
      runtime
    }),
    { name: "TypeError" }
  );

  session.status = "active";
  delete session.metadata.renewal_quiesced_id;
  session.metadata.renewed_to = "renewal-successor";
  await assert.rejects(
    () => service.closeRenewalPredecessorSessionTerminals(session, {
      renewalId: "requested-renewal",
      runtime
    }),
    { name: "TypeError" }
  );
});

test("an active attachment upload finishes before renewal can freeze and cleanup the session", async (t) => {
  const lock = agentWriteLockHarness();
  const { runtime, service, session } = await terminalServiceFixture(t, lock);
  const streamStarted = deferred();
  const releaseStream = deferred();
  const events = [];
  const stream = Readable.from((async function *attachmentBytes() {
    events.push("upload-stream-started");
    streamStarted.resolve();
    yield "partial";
    await releaseStream.promise;
    yield "-complete";
  })());

  const uploading = service.uploadAgentAttachment(session.sessionId, {
    fileName: "renewal-race.txt",
    stream
  }).then((result) => {
    events.push("upload-completed");
    return result;
  });
  await streamStarted.promise;

  const prematureRenewal = await runVibe64RenewalAgentWriteExclusive(
    runtime,
    session.sessionId,
    async () => {
      events.push("renewal-entered-too-early");
    }
  );
  assert.equal(prematureRenewal.acquired, false);
  assert.equal(prematureRenewal.value.code, "vibe64_agent_write_mode_busy");

  releaseStream.resolve();
  const uploaded = await uploading;
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
  assert.equal(await readFile(uploaded.path, "utf8"), "partial-complete");

  const releaseRenewal = deferred();
  const renewalEntered = deferred();
  const renewal = runVibe64RenewalAgentWriteExclusive(
    runtime,
    session.sessionId,
    async () => {
      events.push("renewal-entered");
      renewalEntered.resolve();
      await releaseRenewal.promise;
      events.push("renewal-finished");
    }
  );
  await renewalEntered.promise;

  const blockedDelete = await service.deleteAgentAttachment(session.sessionId, {
    attachmentId: uploaded.attachmentId
  });
  assert.equal(blockedDelete.ok, false);
  assert.equal(blockedDelete.code, "vibe64_agent_write_mode_busy");
  assert.equal(await readFile(uploaded.path, "utf8"), "partial-complete");

  releaseRenewal.resolve();
  assert.equal((await renewal).acquired, true);
  const deleted = await service.deleteAgentAttachment(session.sessionId, {
    attachmentId: uploaded.attachmentId
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  await assert.rejects(() => access(uploaded.path), { code: "ENOENT" });
  assert.deepEqual(events, [
    "upload-stream-started",
    "upload-completed",
    "renewal-entered",
    "renewal-finished"
  ]);
});
