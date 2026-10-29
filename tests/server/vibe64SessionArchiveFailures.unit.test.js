import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  installVibe64ManagedExecutionProvider,
  vibe64CapacityRejectedResult
} from "@local/vibe64-execution/server";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

function createStore(root) {
  return createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "state") });
}

// An archived session whose publish failed stays archived but unpublished, so
// each archived listing tries to publish it again.
async function archivedUnpublished(store, sessionId, { unreadable = false } = {}) {
  await store.createSession({ sessionId, runtimeKind: "genesis" });
  await store.writeArtifact(sessionId, "notes.txt", "Keep this");
  if (unreadable) {
    const blocked = path.join(store.paths(sessionId).sessionRoot, "unreadable");
    await mkdir(blocked, { recursive: true });
    await writeFile(path.join(blocked, "file.txt"), "tar cannot read this");
    await chmod(path.join(blocked, "file.txt"), 0o000);
  }
  await store.writeStatus(sessionId, "archived");
}

test("one archived session that cannot be published hides neither the others nor itself from recovery", {
  skip: process.getuid?.() === 0 ? "root reads every file" : false
}, async () => {
  await withTemporaryRoot(async (root) => {
    const store = createStore(root);
    await store.createSession({ sessionId: "c-published", runtimeKind: "genesis" });
    await store.writeStatus("c-published", "archived");
    await store.publishSessionArchive("c-published");
    await archivedUnpublished(store, "a-broken", { unreadable: true });
    await archivedUnpublished(store, "b-healthy");

    const listed = await store.listSessionSummaries({ statusGroup: "archived" });
    assert.deepEqual(listed.map(({ sessionId }) => sessionId), ["b-healthy", "c-published"]);
    assert.equal((await store.readSession("b-healthy")).archived, true);

    const recovery = await store.recoverSessionArchives();
    assert.deepEqual(recovery.recovered, []);
    assert.deepEqual(recovery.failures.map(({ sessionId, code }) => ({ sessionId, code })),
      [{ sessionId: "a-broken", code: "vibe64_session_archive_write_failed" }]);
    assert.match(recovery.failures[0].error, /a-broken/u);
  });
});

// A provider that refuses each tar command `refuses` matches, as a server under
// memory pressure does, and runs every other command.
function installTarRefusal(refuses) {
  return installVibe64ManagedExecutionProvider({
    async runCommand(request, context) {
      if (request.command === "tar" && refuses(request.args)) {
        return vibe64CapacityRejectedResult(request.execution, {
          code: "vibe64_capacity_rejected",
          message: "This task cannot start because the server is already under heavy memory pressure.",
          retryable: true
        });
      }
      return context.runLocal();
    },
    async stopExecution() { return { ok: true, scopeEmpty: true }; }
  });
}

for (const { name, refuses, message } of [
  { name: "a refused archive check keeps the refusal instead of calling a healthy archive invalid",
    refuses: () => true, message: /could not check session archive/u },
  // The check is admitted; only the extraction meets the refusal.
  { name: "a refused archive extraction keeps the refusal instead of reporting an unreadable archive",
    refuses: (args) => args[0] === "-xzf", message: /Cannot read Vibe64 session archive/u }
]) {
  test(name, async () => {
    await withTemporaryRoot(async (root) => {
      const store = createStore(root);
      await store.createSession({ sessionId: "session-a", runtimeKind: "genesis" });
      await store.writeStatus("session-a", "archived");
      await store.publishSessionArchive("session-a");
      const release = installTarRefusal(refuses);
      try {
        await assert.rejects(store.withArchivedSession("session-a", () => "opened"), (error) => {
          assert.equal(error.code, "vibe64_capacity_rejected");
          assert.equal(error.retryable, true);
          assert.match(error.message, message);
          assert.match(error.message, /heavy memory pressure/u);
          return true;
        });
      } finally {
        release();
      }
      assert.equal(await store.withArchivedSession("session-a", () => "opened"), "opened");
    });
  });
}
