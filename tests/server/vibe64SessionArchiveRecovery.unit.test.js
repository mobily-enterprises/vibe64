import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";

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
      async writeMetadataValue(_id, key, value) { session.metadata[key] = value; },
      async recoverSessionArchives() { return []; },
      async runSessionExclusive(_id, _name, run) {
        if (busy) return { acquired: false };
        busy = true;
        try { return { acquired: true, value: await run() }; }
        finally { busy = false; }
      }
    },
    async getSession() { return structuredClone(session); },
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
    async releaseSessionResources() { calls.push("resources"); return { ok: true }; }
  };
  const service = () => createService({
    project, terminals,
    publishSessionChanged: async (_id, event) => { events.push(event); }
  });
  return { calls, events, project, runtime, service, session, terminals };
}

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
    assert.deepEqual(f.events.map(e => e.reason), ["session-archiving", "session-archived"]);
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
  assert.equal((await f.service().archiveSession("session-a")).ok, true);
  assert.deepEqual(f.calls, ["stop", "resources", "source"]);
});

test("structured cleanup refusal never removes source", async () => {
  const f = fixture();
  f.project.releaseSessionResources = async () => ({ ok: false, error: "Cleanup refused" });
  const response = await f.service().archiveSession("session-a");
  assert.equal(response.ok, false);
  assert.deepEqual(f.calls, ["stop"]);
  assert.equal(f.session.status, "active");
});

test("an interrupted archive publication announces completion after recovery", async () => {
  const f = fixture();
  f.runtime.store.recoverSessionArchives = async () => ["already-detached"];
  await f.service().resumeSessionArchives();
  assert.deepEqual(f.events.map(e => e.reason), ["session-archived"]);
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
      project: { createRuntime: async () => runtime },
      terminals: { closeSessionTerminals: async () => ({ ok: true }) },
      publishSessionChanged: async (_id, event) => { events.push(event.reason); }
    });
    const recovered = await service.resumeSessionArchives();
    assert.deepEqual(recovered.failures, []);
    assert.equal((await runtime.getSession("interrupted")).archived, true);
    assert.deepEqual(events, ["session-archiving", "session-archived"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
