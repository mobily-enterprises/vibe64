import assert from "node:assert/strict";
import test from "node:test";
import { createSessionsService as createService } from "./vibe64SessionsTestHelpers.js";

function fixture(operation = null) {
  const events = [];
  const calls = [];
  const session = { sessionId: "session-a", sourceReady: true, status: "active", metadata: {} };
  if (operation) {
    session.metadata.session_archive_operation = JSON.stringify(operation);
    session.metadata.session_closing_reason = "archived";
  }
  let busy = false;
  const runtime = {
    store: {
      async assertSessionNotPinned(sessionId) { assert.equal(sessionId, session.sessionId); },
      async listSessionsForRenewal() { return [structuredClone(session)]; },
      async listSessionConversations() { return []; },
      async writeMetadataValue(_id, key, value) { session.metadata[key] = value; },
      async recoverSessionArchives() { return { failures: [], recovered: [] }; },
      async runSessionExclusive(_id, _name, run) {
        if (busy) return { acquired: false };
        busy = true;
        try { return { acquired: true, value: await run() }; }
        finally { busy = false; }
      }
    },
    async getSession() { return structuredClone(session); },
    getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    async listSessionSummaries() { return [structuredClone(session)]; },
    async markSessionClosing() {
      session.metadata.session_closing_reason = "archived";
      return structuredClone(session);
    },
    async clearSessionClosing() {
      delete session.metadata.session_closing_reason;
      return structuredClone(session);
    },
    async archiveSession() { calls.push("source"); session.status = "archived"; return structuredClone(session); }
  };
  const terminals = { async closeSessionTerminals() { calls.push("stop"); } };
  const project = {
    async createRuntime() { return runtime; },
    createRuntimeWithoutSource(options) { return this.createRuntime(options); },
    async releaseSessionResources() { calls.push("resources"); return { ok: true }; }
  };
  const service = () => createService({
    project, terminals,
    publishSessionChanged: async (_id, event) => { events.push(event); }
  });
  return { calls, events, project, runtime, service, session, terminals };
}

test("ordinary archive preserves the visible predecessor of a failed renewal", async () => {
  const f = fixture();
  const successor = {
    sessionId: "renewal-successor", status: "renewal_pending",
    metadata: { renewal_id: "renewal-1", renewed_from: "session-a" }
  };
  f.runtime.store.listSessionsForRenewal = async () => [f.session, successor];
  const blocked = await f.service().archiveSession("session-a", {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "vibe64_session_renewal_blocks_archive");
  assert.match(blocked.error, /Retry/u);
  assert.match(blocked.error, /Cancel renewal/u);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.events, []);
  assert.equal(f.session.status, "active");
  assert.deepEqual(f.session.metadata, {});
  assert.equal(successor.status, "renewal_pending");

  // Cancelling the renewal discards its private successor.
  f.runtime.store.listSessionsForRenewal = async () => [f.session];
  assert.equal((await f.service().archiveSession("session-a", {})).ok, true);
});

for (const [phase, expected] of [
  ["stopping", ["stop", "resources", "source"]],
  ["resources", ["resources", "source"]],
  ["source", ["source"]]
]) {
  test(`a fresh service resumes a persisted archive at ${phase}`, async () => {
    const f = fixture({ status: "running", phase, startedAt: "2026-09-11T00:00:00Z" });
    const result = await f.service().resumeSessionArchives();
    assert.deepEqual(result.failures, []);
    assert.deepEqual(f.calls, expected);
    assert.deepEqual(f.events.map(e => e.reason), ["session-archiving", ...expected.slice(1).map(() => "session-archive-progress"), "session-archived"]);
    assert.ok(f.events.every(e => e.payload.clientRefresh.includeList));
  });
}

test("failure is durable, announced, and not repeatedly retried at startup", async () => {
  const f = fixture({ status: "running", phase: "resources" });
  f.project.releaseSessionResources = async () => { throw new Error("Database dump failed"); };
  const report = await f.service().resumeSessionArchives();
  assert.equal(report.failures.length, 1);
  const operation = JSON.parse(f.session.metadata.session_archive_operation);
  assert.equal(operation.status, "failed");
  assert.equal(operation.error, "Database dump failed");
  assert.equal(f.session.metadata.session_closing_reason, undefined);
  assert.equal(f.events.at(-1).reason, "session-archive-failed");
  assert.equal(f.events.at(-1).payload.archiveError, "Database dump failed");
  f.events.length = 0;
  await f.service().resumeSessionArchives();
  assert.deepEqual(f.events, []);
  f.project.releaseSessionResources = async () => { f.calls.push("resources"); return { ok: true }; };
  assert.equal((await f.service().archiveSession("session-a", {})).ok, true);
  assert.deepEqual(f.calls, ["stop", "resources", "source"]);
});

test("an unreadable archive marker is reported per session and recovery continues", async () => {
  const f = fixture({ status: "running", phase: "source" });
  const corrupt = { sessionId: "session-corrupt", sourceReady: true, status: "active",
    metadata: { session_archive_operation: "{not json", session_closing_reason: "archived" } };
  f.runtime.listSessionSummaries = async () => [structuredClone(corrupt), structuredClone(f.session)];
  const report = await f.service().resumeSessionArchives();
  assert.deepEqual(report.failures.map(({ sessionId, code }) => ({ sessionId, code })),
    [{ sessionId: "session-corrupt", code: "vibe64_session_archive_state_invalid" }]);
  assert.deepEqual(f.calls, ["source"]);
  assert.equal(f.session.status, "archived");
});

test("archiving refuses an archive marker with an unknown phase and keeps it", async () => {
  const f = fixture({ status: "running", phase: "elsewhere" });
  const marker = f.session.metadata.session_archive_operation;
  const result = await f.service().archiveSession("session-a", {});
  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_session_archive_state_invalid");
  assert.match(result.error, /recovery evidence was preserved/u);
  assert.equal(f.session.metadata.session_archive_operation, marker);
  assert.deepEqual(f.calls, []);
});

test("structured cleanup refusal never removes source", async () => {
  const f = fixture();
  f.project.releaseSessionResources = async () => ({ ok: false, error: "Cleanup refused" });
  const response = await f.service().archiveSession("session-a", {});
  assert.equal(response.ok, false);
  assert.deepEqual(f.calls, ["stop"]);
  assert.equal(f.session.status, "active");
});

test("an interrupted archive publication announces completion after recovery", async () => {
  const f = fixture();
  f.runtime.store.recoverSessionArchives = async () => ({ failures: [], recovered: ["already-detached"] });
  await f.service().resumeSessionArchives();
  assert.deepEqual(f.events.map(e => e.reason), ["session-archived"]);
});

test("a closed session that cannot be published is reported while open sessions still resume", async () => {
  const f = fixture({ status: "running", phase: "source" });
  const unpublished = { code: "vibe64_session_archive_write_failed", error: "Cannot archive Vibe64 session closed-a: tar failed",
    ok: false, sessionId: "closed-a" };
  f.runtime.store.recoverSessionArchives = async () => ({ failures: [unpublished], recovered: ["closed-b"] });
  const report = await f.service().resumeSessionArchives();
  assert.deepEqual(report.failures, [unpublished]);
  assert.deepEqual(f.calls, ["source"]);
  assert.equal(f.session.status, "archived");
  assert.equal(f.events[0].reason, "session-archived");
  assert.equal(f.events.at(-1).reason, "session-archived");
});

test("stale archive markers from before stage recording are resumed", async () => {
  const f = fixture();
  f.session.metadata.session_closing_reason = "archived";
  await f.service().resumeSessionArchives();
  assert.deepEqual(f.calls, ["stop", "resources", "source"]);
});

test("SIGKILL leaves durable progress and a fresh runtime recovers through the stale writer lock", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { Vibe64SessionRuntime } = await import("../../packages/vibe64-runtime/src/server/runtime.js");
  const root = await mkdtemp(join(tmpdir(), "vibe64-archive-crash-"));
  const options = { projectContextRoot: root, projectRuntimeRoot: join(root, "state"), inspectSourceByDefault: false };
  try {
    const killed = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { Vibe64SessionRuntime } from ${JSON.stringify(new URL("../../packages/vibe64-runtime/src/server/runtime.js", import.meta.url).href)};
      const runtime = new Vibe64SessionRuntime(${JSON.stringify(options)});
      await runtime.store.createSession({ sessionId: "interrupted", runtimeKind: "genesis", metadata: { source_creation_failed: "yes" } });
      await runtime.store.runSessionExclusive("interrupted", "agent-write-mode", async () => {
        await runtime.store.writeMetadataValue("interrupted", "session_archive_operation", JSON.stringify({ status: "running", phase: "stopping" }));
        await runtime.markSessionClosing("interrupted", { reason: "archived" });
        process.kill(process.pid, "SIGKILL");
      });
    `], { encoding: "utf8" });
    assert.equal(killed.signal, "SIGKILL", killed.stderr);
    const runtime = new Vibe64SessionRuntime(options);
    const events = [];
    const service = createService({
      project: { createRuntime: async () => runtime, createRuntimeWithoutSource(options) { return this.createRuntime(options); } },
      terminals: { closeSessionTerminals: async () => ({ ok: true }) },
      publishSessionChanged: async (_id, event) => { events.push(event.reason); }
    });
    const recovered = await service.resumeSessionArchives();
    assert.deepEqual(recovered.failures, []);
    assert.equal((await runtime.getSession("interrupted")).archived, true);
    assert.deepEqual(events, ["session-archiving", "session-archive-progress", "session-archive-progress", "session-archived"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("phase announcements follow durable progress before the next slow operation", async () => {
  const f = fixture();
  f.project.releaseSessionResources = async () => {
    assert.equal(JSON.parse(f.session.metadata.session_archive_operation).phase, "resources");
    assert.equal(f.events.at(-1).reason, "session-archive-progress");
    return { ok: true };
  };
  f.runtime.archiveSession = async () => {
    assert.equal(JSON.parse(f.session.metadata.session_archive_operation).phase, "source");
    assert.equal(f.events.filter(e => e.reason === "session-archive-progress").length, 2);
    return f.session;
  };
  assert.equal((await f.service().archiveSession("session-a", {})).ok, true);
});

test("the archive's stopping phase removes the session's command helpers with its runtime", async () => {
  const f = fixture();
  f.terminals.removeSessionCommandHelpers = async (sessionId, { runtime }) => {
    assert.equal(sessionId, "session-a");
    assert.equal(runtime, f.runtime);
    f.calls.push("helpers");
  };
  assert.equal((await f.service().archiveSession("session-a", {})).ok, true);
  assert.deepEqual(f.calls, ["stop", "helpers", "resources", "source"]);
});

// A chat whose Close was interrupted (the person's, or an old repair chat a state upgrade handed to
// Close), beside an open chat that the archive keeps with the session.
function withClosingChat(f) {
  const chats = { records: [{ conversationId: "closing-chat", state: "closing" }, { conversationId: "open-chat" }] };
  f.runtime.store.listSessionConversations = async () => structuredClone(chats.records);
  return chats;
}

test("archive finishes an interrupted Close through its engine before the session's work stops", async () => {
  const f = fixture();
  const chats = withClosingChat(f);
  f.terminals.finishInterruptedClosesBeforeArchive = async (sessionId, { runtime }) => {
    assert.equal(sessionId, "session-a");
    assert.equal(runtime, f.runtime);
    // The session is not closing yet, so Close can still start the chat's engine.
    assert.equal(f.session.metadata.session_closing_reason, undefined);
    f.calls.push("finish-closes");
    chats.records = chats.records.filter(record => record.state !== "closing");
    return { finished: 1, ok: true };
  };
  assert.equal((await f.service().archiveSession("session-a", {})).ok, true);
  assert.deepEqual(f.calls, ["finish-closes", "stop", "resources", "source"]);
  assert.equal(f.session.status, "archived");
});

test("a Close that cannot finish keeps the session open and unmarked for Archive's retry", async () => {
  const f = fixture();
  withClosingChat(f);
  f.terminals.finishInterruptedClosesBeforeArchive = async () => {
    f.calls.push("finish-closes");
    throw Object.assign(new Error("A chat in this session could not finish closing: Codex is not signed in. Resolve that, then try again."),
      { code: "vibe64_conversation_close_unfinished", retryable: true });
  };
  const failed = await f.service().archiveSession("session-a", {});
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "vibe64_conversation_close_unfinished");
  assert.match(failed.error, /Codex is not signed in/u);
  assert.deepEqual(f.calls, ["finish-closes"]);
  assert.equal(f.session.status, "active");
  assert.equal(f.session.metadata.session_archive_operation, undefined);
  assert.equal(f.session.metadata.session_closing_reason, undefined);
  assert.deepEqual(f.events, []);

  // A chat that is closing again after its Close finished is never packed into the archive either.
  f.terminals.finishInterruptedClosesBeforeArchive = async () => { f.calls.push("finish-closes"); return { finished: 1, ok: true }; };
  const raced = await f.service().archiveSession("session-a", {});
  assert.equal(raced.ok, false);
  assert.equal(raced.code, "vibe64_conversation_close_unfinished");
  assert.match(raced.error, /Retry Archive session/u);
  assert.equal(f.session.status, "active");
  assert.equal(f.session.metadata.session_archive_operation, undefined);
});
