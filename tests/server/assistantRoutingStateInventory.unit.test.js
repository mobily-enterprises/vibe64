import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { listProjectRuntimeRoots } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { createVibe64SessionStore, VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server";
import { projectRuntimeRoot, withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);
const createStore = (targetRoot) => createVibe64SessionStore({
  projectContextRoot: targetRoot, projectRuntimeRoot: projectRuntimeRoot(targetRoot)
});
const scratchRoot = (targetRoot) => path.join(targetRoot, "upgrade-scratch");

test("offline project inventory includes dormant and standalone roots without initializing state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const systemRoot = path.join(targetRoot, "system");
    assert.deepEqual(await listProjectRuntimeRoots(systemRoot), []);
    await assert.rejects(readdir(systemRoot), { code: "ENOENT" });
    for (const name of ["closed", "deleting", "source-3ac928"]) {
      await mkdir(path.join(systemRoot, "projects", name), { recursive: true });
    }
    await writeFile(path.join(systemRoot, "projects", "README"), "not a project");
    assert.deepEqual(await listProjectRuntimeRoots(systemRoot),
      ["closed", "deleting", "source-3ac928"].map((name) => path.join(systemRoot, "projects", name)));
    await symlink(targetRoot, path.join(systemRoot, "projects", "linked"));
    await assert.rejects(listProjectRuntimeRoots(systemRoot), /symbolic link/u);
  });
});

test("routing upgrade inventory on an empty project does not create session state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    assert.deepEqual(await store.prepareAssistantRoutingStateUpgrade({
      temporaryRoot: scratchRoot(targetRoot), transform: () => ({})
    }), []);
    await assert.rejects(readdir(store.paths().sessionsRoot), { code: "ENOENT" });
    await assert.rejects(readdir(scratchRoot(targetRoot)), { code: "ENOENT" });
  });
});

test("routing upgrade stages active, closing, temporary and prepared/archive records without changing originals", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const before = new Map();
    for (const sessionId of ["active", "closing", "archived"]) {
      await store.createSession({ runtimeKind: "genesis", sessionId });
      await store.writeMetadataValue(sessionId, "assistant_routing", '{"mode":"auto"}');
      await store.writeMetadataValue(sessionId, "agent_conversation_id", `native-${sessionId}`);
      await store.writeConversationUserMessage(sessionId, { text: "Keep the full history" });
      await store.writeConversationAssistantMessage(sessionId, { text: "Detailed answer" });
      const conversation = await store.writeSessionConversation(sessionId, "temporary-1", {
        providerConversationId: "native-temporary", assistantRouting: { mode: "code" },
        assistantChangeover: { deliveryCursor: 7 }
      });
      before.set(sessionId, { conversation, log: await store.readConversationLog(sessionId) });
    }
    await mkdir(store.paths().closingSessionsRoot, { recursive: true });
    const closingRoot = path.join(store.paths().closingSessionsRoot, "closing");
    await rename(store.paths("closing").sessionRoot, closingRoot);
    await store.writeStatus("archived", VIBE64_SESSION_STATUS.ARCHIVED);
    await store.publishSessionArchive("archived");
    const archivePath = path.join(store.paths().archivedSessionsRoot, "archived.tar.gz");
    const archiveBefore = await readFile(archivePath);
    const preparedRoot = path.join(store.paths().archivedSessionsRoot, ".renewals", "renewal-1");
    await mkdir(preparedRoot, { recursive: true });
    for (const suffix of [".tar.gz", ".json"]) {
      await copyFile(path.join(store.paths().archivedSessionsRoot, `archived${suffix}`), path.join(preparedRoot, `archived${suffix}`));
    }
    const seen = [];
    const updates = await store.prepareAssistantRoutingStateUpgrade({
      temporaryRoot: scratchRoot(targetRoot),
      transform: ({ sessionId, metadata, conversations }) => {
        seen.push(sessionId);
        assert.equal(metadata.agent_conversation_id, `native-${sessionId}`);
        return {
          metadata: { assistant_routing: '{"mode":"auto","workflowEngineId":"codex"}' },
          conversations: conversations.map((record) => ({ ...record,
            assistantRouting: { ...record.assistantRouting, workflowEngineId: "codex" }
          }))
        };
      }
    });
    assert.deepEqual(seen.sort(), ["active", "archived", "archived", "closing"]);
    assert.equal(updates.length, 6);
    for (const root of [store.paths("active").sessionRoot, closingRoot]) {
      assert.equal((await readFile(path.join(root, "metadata", "assistant_routing"), "utf8")).trim(), '{"mode":"auto"}');
      const originalConversation = JSON.parse(await readFile(path.join(root, "conversations", "temporary-1", "conversation.json"), "utf8"));
      assert.equal(originalConversation.assistantRouting.workflowEngineId, undefined);
    }
    assert.deepEqual(await readFile(archivePath), archiveBefore);
    assert.deepEqual(await readFile(path.join(preparedRoot, "archived.tar.gz")), archiveBefore);
    for (const update of updates.filter((entry) => entry.replacementPath)) {
      const extractionRoot = path.join(scratchRoot(targetRoot), "proof");
      await mkdir(extractionRoot, { recursive: true });
      await execFileAsync("tar", ["-xzf", update.replacementPath, "-C", extractionRoot]);
      const stagedRoot = path.join(extractionRoot, "archived");
      assert.equal(JSON.parse(await readFile(path.join(stagedRoot, "metadata", "assistant_routing"), "utf8")).workflowEngineId, "codex");
      const conversation = JSON.parse(await readFile(path.join(stagedRoot, "conversations", "temporary-1", "conversation.json"), "utf8"));
      assert.deepEqual(conversation, { ...before.get("archived").conversation,
        assistantRouting: { mode: "code", workflowEngineId: "codex" }
      });
      // Reading the replacement through the native owner proves the transcript survived repacking.
      await copyFile(update.replacementPath, archivePath);
      assert.deepEqual(await store.readConversationLog("archived"), before.get("archived").log);
      await writeFile(archivePath, archiveBefore);
      await rm(extractionRoot, { recursive: true });
    }
    assert.deepEqual(await store.readConversationLog("active"), before.get("active").log);
  });
});

test("routing upgrade rejects corrupt owned state and unrelated metadata changes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({ runtimeKind: "genesis", sessionId: "test" });
    const prepare = (transform, temporaryRoot = scratchRoot(targetRoot)) =>
      store.prepareAssistantRoutingStateUpgrade({ temporaryRoot, transform });
    await assert.rejects(prepare(() => ({}), store.paths().sessionsRoot), /outside project state/u);
    await assert.rejects(prepare(() => ({ metadata: { agent_conversation_id: "replacement" } })), /unrelated session metadata/u);
    await store.writeSessionConversation("test", "temporary-1", { providerConversationId: "preserve" });
    const conversationPath = path.join(store.paths("test").conversationsRoot, "temporary-1", "conversation.json");
    await writeFile(conversationPath, "corrupt JSON");
    await assert.rejects(prepare(() => ({})), /Invalid temporary conversation record/u);
    await rm(conversationPath);
    await symlink(path.join(store.paths("test").sessionRoot, "session.json"), conversationPath);
    await assert.rejects(prepare(() => ({})), /regular file/u);
  });
});

test("routing upgrade reports incomplete prepared archives without performing recovery", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const stagingRoot = path.join(store.paths().archivedSessionsRoot, ".staging");
    await mkdir(stagingRoot, { recursive: true });
    const archivePath = path.join(stagingRoot, "pending.tar.gz");
    await writeFile(archivePath, "unfinished archive");
    await assert.rejects(store.prepareAssistantRoutingStateUpgrade({
      temporaryRoot: scratchRoot(targetRoot), transform: () => ({})
    }), /Finish archive recovery/u);
    assert.equal(await readFile(archivePath, "utf8"), "unfinished archive");
    assert.deepEqual(await readdir(stagingRoot), ["pending.tar.gz"]);
  });
});
