import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { Vibe64SessionRuntime } from "../../packages/vibe64-runtime/src/server/runtime.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";
import { retireNativeConversation } from "../../packages/vibe64-terminals/src/server/nativeConversationRetirement.js";

function archiveFixture(phase = "") {
  const calls = [];
  const session = { sessionId: "session-a", status: "active", sourceReady: true, metadata: {} };
  if (phase) {
    session.metadata.session_closing_reason = "archived";
    session.metadata.session_archive_operation = JSON.stringify({ status: "running", phase });
  }
  let busy = false;
  const runtime = {
    store: {
      async listSessionConversations() { return []; },
      async listSessionsForRenewal() { return []; },
      async writeMetadataValue(_id, key, value) { session.metadata[key] = value; },
      async runSessionExclusive(_id, _name, operation) {
        if (busy) return { acquired: false };
        busy = true;
        try { return { acquired: true, value: await operation() }; }
        finally { busy = false; }
      }
    },
    async getSession() { return structuredClone(session); },
    async markSessionClosing() {
      session.metadata.session_closing_reason = "archived";
      return structuredClone(session);
    },
    async clearSessionClosing() { delete session.metadata.session_closing_reason; },
    async archiveSession() {
      calls.push("archive");
      session.status = "archived";
      return structuredClone(session);
    }
  };
  const service = createService({
    project: {
      async createRuntime() { return runtime; },
      async releaseSessionResources() { calls.push("resources"); return { ok: true }; }
    },
    terminals: {
      async closeSessionTerminals() {
        calls.push("stop");
        session.metadata.final_answer_saved = "yes";
      }
    }
  });
  return { calls, runtime, service, session };
}

test("ordinary archival has no preparation policy unless a host registers it", async () => {
  const f = archiveFixture();
  assert.equal((await f.service.archiveSession("session-a")).ok, true);
  assert.deepEqual(f.calls, ["stop", "resources", "archive"]);
  assert.throws(() => f.service.setArchivePreparation({}), /function or null/u);
});

test("preparation sees stopped, current session state before resource and source removal", async () => {
  const f = archiveFixture();
  f.service.setArchivePreparation(async ({ phase, runtime, session }) => {
    assert.equal(phase, "stopping");
    assert.equal(runtime, f.runtime);
    assert.equal(session.metadata.final_answer_saved, "yes");
    assert.equal(session.metadata.session_closing_reason, "archived");
    f.calls.push("prepare");
    await runtime.store.writeMetadataValue(session.sessionId, "prepared", "yes");
  });
  const result = await f.service.archiveSession("session-a");
  assert.equal(result.ok, true);
  assert.equal(result.metadata.prepared, "yes");
  assert.deepEqual(f.calls, ["stop", "prepare", "resources", "archive"]);
});

for (const failure of ["throw", "result"]) {
  test(`preparation ${failure} preserves source and supports an explicit retry`, async () => {
    const f = archiveFixture();
    f.service.setArchivePreparation(async () => {
      if (failure === "throw") throw new Error("History could not be preserved");
      return { ok: false, error: "History could not be preserved" };
    });
    const failed = await f.service.archiveSession("session-a");
    assert.equal(failed.ok, false);
    assert.match(failed.error, /History could not be preserved/u);
    assert.equal(f.session.status, "active");
    assert.equal(JSON.parse(f.session.metadata.session_archive_operation).status, "failed");
    assert.deepEqual(f.calls, ["stop"]);
    f.service.setArchivePreparation(null);
    assert.equal((await f.service.archiveSession("session-a")).ok, true);
    assert.deepEqual(f.calls, ["stop", "stop", "resources", "archive"]);
  });
}

for (const phase of ["resources", "source"]) {
  test(`preparation is repeatable when an archive resumes at ${phase}`, async () => {
    const f = archiveFixture(phase);
    f.service.setArchivePreparation(async (context) => {
      assert.equal(context.phase, phase);
      f.calls.push("prepare");
    });
    assert.equal((await f.service.archiveSession("session-a")).ok, true);
    assert.deepEqual(f.calls, phase === "resources"
      ? ["prepare", "resources", "archive"] : ["prepare", "archive"]);
  });
}

test("preparation stays inside the session agent-write lock", async () => {
  const f = archiveFixture();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  f.service.setArchivePreparation(async () => {
    f.calls.push("prepare");
    entered.resolve();
    await release.promise;
  });
  const archiving = f.service.archiveSession("session-a");
  await entered.promise;
  try {
    const competing = await f.runtime.store.runSessionExclusive("session-a", "agent-write", () => {
      throw new Error("A competing writer entered preparation");
    });
    assert.equal(competing.acquired, false);
    assert.deepEqual(f.calls, ["stop", "prepare"]);
  } finally {
    release.resolve();
  }
  assert.equal((await archiving).ok, true);
});

async function storedFixture(root, { publish = true } = {}) {
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "state") });
  await store.createSession({ sessionId: "session-a", runtimeKind: "genesis",
    metadata: { codex_conversation_id: "native-thread-a", private_storage_binding: "preserve-me" } });
  await store.writeConversationUserMessage("session-a", { text: "Keep this history", messageId: "message-a" });
  await store.writeArtifact("session-a", "recovery.txt", "Keep this recovery");
  if (publish) {
    await store.writeStatus("session-a", "archived");
    await store.publishSessionArchive("session-a");
  }
  return store;
}

test("preparation writes survive real archive publication without changing the session format", async () => {
  await withTemporaryRoot(async (root) => {
    const runtime = new Vibe64SessionRuntime({ projectContextRoot: root,
      projectRuntimeRoot: path.join(root, "state"), inspectSourceByDefault: false });
    await runtime.store.createSession({ sessionId: "session-a", runtimeKind: "genesis",
      metadata: { source_creation_failed: "yes" } });
    const service = createService({
      project: { async createRuntime() { return runtime; } },
      terminals: { async closeSessionTerminals() {
        await runtime.store.writeConversationUserMessage("session-a", { text: "Preserve final history" });
      } }
    });
    service.setArchivePreparation(async ({ runtime, session }) => {
      await runtime.store.writeArtifact(session.sessionId, "archive-evidence.txt", "preserved");
    });
    const result = await service.archiveSession("session-a");
    assert.equal(result.ok, true, result.error);
    assert.equal(result.status, "archived");
    await runtime.store.withArchivedSession("session-a", async (session) => {
      assert.equal(await readFile(path.join(session.artifactsRoot, "archive-evidence.txt"), "utf8"), "preserved");
    });
    assert.equal((await runtime.store.readConversationLog("session-a"))[0].user.text, "Preserve final history");
  });
});

test("archived access retains complete metadata and recovery while cleaning its temporary extraction", async () => {
  await withTemporaryRoot(async (root) => {
    const store = await storedFixture(root);
    const before = await store.readSession("session-a");
    const archiveBytes = await readFile(before.archivePath);
    let extractedRoot;
    const result = await store.withArchivedSession("session-a", async (session) => {
      assert.equal(session.status, "archived");
      assert.equal(session.metadata.private_storage_binding, "preserve-me");
      assert.equal(session.metadata.codex_conversation_id, "native-thread-a");
      extractedRoot = session.sessionRoot;
      assert.equal(await readFile(path.join(session.artifactsRoot, "recovery.txt"), "utf8"), "Keep this recovery");
      return "inspected";
    });
    assert.equal(result, "inspected");
    await assert.rejects(readdir(extractedRoot), { code: "ENOENT" });
    assert.deepEqual(await readFile(before.archivePath), archiveBytes);
    assert.equal((await store.readConversationLog("session-a"))[0].user.text, "Keep this history");
  });
});

test("attachment expiry atomically replaces a compressed archive while retaining text, descriptions and its archival date", async () => {
  await withTemporaryRoot(async (root) => {
    const store = await storedFixture(root, { publish: false });
    const id = "12345678-1234-4234-8234-123456789abc";
    await store.writeArtifact("session-a", `attachments/${id}/file`, "attachment payload");
    await store.writeArtifact("session-a", `attachments/${id}/attachment.json`, JSON.stringify({ attachmentId: id, fileName: "original.png" }));
    await store.writeStatus("session-a", "archived");
    await store.publishSessionArchive("session-a");
    const archived = await store.readSession("session-a");
    const before = await readFile(archived.archivePath);
    await assert.rejects(store.pruneArchivedSessionAttachments("session-a"), /callback/u);
    for (const beforePrune of [async () => ({ ok: false }), async () => { throw new Error("host failed"); }]) {
      await assert.rejects(store.pruneArchivedSessionAttachments("session-a", { beforePrune }));
      assert.deepEqual(await readFile(archived.archivePath), before);
    }
    const result = await store.pruneArchivedSessionAttachments("session-a", { beforePrune: async ({ session, attachmentIds, candidatePath }) => {
      assert.equal(session.archivedAt, archived.archivedAt);
      assert.deepEqual(attachmentIds, [id]);
      assert.ok((await readFile(candidatePath)).length);
      // Publication has not happened while the host records its receipt.
      assert.deepEqual(await readFile(archived.archivePath), before);
      return { ok: true };
    } });
    assert.deepEqual(result, { ok: true, attachmentIds: [id] });
    assert.equal((await store.readSession("session-a")).archivedAt, archived.archivedAt);
    assert.equal((await store.readConversationLog("session-a"))[0].user.text, "Keep this history");
    await store.withArchivedSession("session-a", async (session) => {
      await assert.rejects(readFile(path.join(session.artifactsRoot, "attachments", id, "file")), { code: "ENOENT" });
      assert.match(await readFile(path.join(session.artifactsRoot, "attachments", id, "attachment.json"), "utf8"), /original.png/u);
      assert.equal(await readFile(path.join(session.artifactsRoot, "recovery.txt"), "utf8"), "Keep this recovery");
    });
    assert.deepEqual(await store.pruneArchivedSessionAttachments("session-a", { beforePrune: () => { throw new Error("already expired"); } }),
      { ok: true, attachmentIds: [] });
  });
});

test("locked archive publication preserves native text before deletion without changing metadata or message history", async () => {
  await withTemporaryRoot(async (root) => {
    const store = await storedFixture(root);
    const before = await store.readSession("session-a");
    const metadata = await readFile(before.archiveMetadataPath);
    const sourcePath = path.join(root, "preserved-chat.jsonl");
    await writeFile(sourcePath, "native-only chat text\n");
    let rows = [{ conversationId: "native" }];
    let savedCapability;
    await store.withArchivedSession("session-a", async (session, { publishArtifacts }) => {
      savedCapability = publishArtifacts;
      await retireNativeConversation({ binding: { conversationId: "native", workdir: root }, inspect: async () => rows,
        beforeDelete: async () => {
          assert.deepEqual(await publishArtifacts([{ relativePath: "native/native.chat.jsonl", sourcePath }]),
            { ok: true, paths: ["native/native.chat.jsonl"] });
          return { preserved: true, exclusive: true };
        }, remove: async () => {
          // A normal readable archive operation observes the published tar here;
          // publication did not recursively acquire the archive mutation lock.
          assert.equal(await store.readArtifact("session-a", "native/native.chat.jsonl"), "native-only chat text\n");
          rows = [];
        } });
      assert.equal(await readFile(path.join(session.artifactsRoot, "native/native.chat.jsonl"), "utf8"), "native-only chat text\n");
    });
    await assert.rejects(savedCapability([{ relativePath: "late.txt", sourcePath }]), /outside/);
    assert.deepEqual(await readFile(before.archiveMetadataPath), metadata);
    assert.equal((await store.readSession("session-a")).archivedAt, before.archivedAt);
    assert.equal((await store.readConversationLog("session-a"))[0].user.text, "Keep this history");
  });
});

test("archive publication rejects unsafe sources and destinations without publishing partial work", async () => {
  await withTemporaryRoot(async (root) => {
    const store = await storedFixture(root);
    const archived = await store.readSession("session-a");
    const original = await readFile(archived.archivePath);
    const sourcePath = path.join(root, "source.txt");
    await writeFile(sourcePath, "preserved");
    const link = path.join(root, "link.txt");
    await symlink(sourcePath, link);
    for (const file of [
      { relativePath: "../outside.txt", sourcePath },
      { relativePath: "native/link.txt", sourcePath: link },
      { relativePath: "native/directory.txt", sourcePath: root }
    ]) {
      await assert.rejects(store.withArchivedSession("session-a", async (_session, { publishArtifacts }) => {
        await publishArtifacts([{ relativePath: "native/first.txt", sourcePath }, file]);
      }));
      assert.deepEqual(await readFile(archived.archivePath), original);
    }
    await assert.rejects(store.withArchivedSession("session-a", async (session, { publishArtifacts }) => {
      await symlink(root, path.join(session.artifactsRoot, "linked"));
      await publishArtifacts([{ relativePath: "linked/outside.txt", sourcePath }]);
    }), /regular directories/);
    assert.deepEqual(await readFile(archived.archivePath), original);
    await assert.rejects(readFile(path.join(root, "outside.txt")), { code: "ENOENT" });
  });
});

test("exact archived artifact expiry keeps permanent text and leaves the original on failed confirmation", async () => {
  await withTemporaryRoot(async (root) => {
    const store = await storedFixture(root);
    const archived = await store.readSession("session-a");
    const original = await readFile(archived.archivePath);
    await assert.rejects(store.pruneArchivedSessionArtifacts("session-a", { relativePaths: ["recovery.txt"], beforePrune: async () => ({ ok: false }) }), /did not confirm/);
    assert.deepEqual(await readFile(archived.archivePath), original);
    assert.deepEqual(await store.pruneArchivedSessionArtifacts("session-a", { relativePaths: ["recovery.txt"], beforePrune: async ({ relativePaths }) => {
      assert.deepEqual(relativePaths, ["recovery.txt"]); return { ok: true };
    } }), { ok: true, paths: ["recovery.txt"] });
    assert.equal(await store.readArtifact("session-a", "recovery.txt"), "");
    assert.equal((await store.readConversationLog("session-a"))[0].user.text, "Keep this history");
    assert.equal((await store.readSession("session-a")).archivedAt, archived.archivedAt);
    assert.deepEqual(await store.pruneArchivedSessionArtifacts("session-a", { relativePaths: ["recovery.txt"], beforePrune: () => assert.fail("already absent") }),
      { ok: true, paths: [] });
  });
});

test("a failed archive operation releases its lock and temporary extraction for retry", async () => {
  await withTemporaryRoot(async (root) => {
    const store = await storedFixture(root);
    let extractedRoot;
    await assert.rejects(store.withArchivedSession("session-a", async (session) => {
      extractedRoot = session.sessionRoot;
      throw new Error("Provider refused cleanup");
    }), /Provider refused cleanup/u);
    await assert.rejects(readdir(extractedRoot), { code: "ENOENT" });
    assert.equal(await store.withArchivedSession("session-a", () => "retried"), "retried");
  });
});

test("open, incomplete and retained-closing sessions cannot enter archived work", async () => {
  await withTemporaryRoot(async (root) => {
    const store = await storedFixture(root, { publish: false });
    const forbidden = () => { throw new Error("Unsafe archive callback was invoked"); };
    await assert.rejects(store.withArchivedSession("session-a", forbidden), { code: "vibe64_session_archive_not_finalized" });
    await assert.rejects(store.withArchivedSession("missing", forbidden), { code: "vibe64_session_archive_incomplete" });
    await store.writeStatus("session-a", "archived");
    await store.publishSessionArchive("session-a");
    const closing = path.join(store.paths().closingSessionsRoot, "session-a");
    await mkdir(closing, { recursive: true });
    await assert.rejects(store.withArchivedSession("session-a", forbidden), { code: "vibe64_session_archive_not_finalized" });
    await rm(closing, { recursive: true });
    const archived = await store.readSession("session-a");
    await writeFile(archived.archivePath, "corrupt gzip data");
    await assert.rejects(store.withArchivedSession("session-a", forbidden), { code: "vibe64_session_archive_invalid" });
  });
});

test("archived operations serialize across store instances", async () => {
  await withTemporaryRoot(async (root) => {
    const first = await storedFixture(root);
    const second = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "state") });
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const calls = [];
    const active = first.withArchivedSession("session-a", async () => {
      calls.push("first");
      entered.resolve();
      await release.promise;
      calls.push("first-finished");
    });
    await entered.promise;
    const queued = second.withArchivedSession("session-a", async () => { calls.push("second"); });
    release.resolve();
    await Promise.all([active, queued]);
    assert.deepEqual(calls, ["first", "first-finished", "second"]);
  });
});

test("archive metadata cannot redirect an operation to another session", async () => {
  await withTemporaryRoot(async (root) => {
    const store = await storedFixture(root);
    const session = await store.readSession("session-a");
    const metadata = JSON.parse(await readFile(session.archiveMetadataPath, "utf8"));
    metadata.sessionId = "session-b";
    metadata.index.sessionId = "session-b";
    await writeFile(session.archiveMetadataPath, JSON.stringify(metadata));
    await assert.rejects(store.withArchivedSession("session-a", () => {
      throw new Error("Mismatched archive was accepted");
    }), { code: "vibe64_invalid_session_archive_metadata" });
  });
});
