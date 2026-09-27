import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { createSessionPromptHintsService } from "../../packages/vibe64-terminals/src/server/sessionPromptHints.js";
import { createService as createDatabaseService } from "../../packages/vibe64-database-tools/src/server/service.js";

for (const kind of ["hints", "database"]) {
  for (const retained of [false, true]) {
    test(`hidden renewal ${kind} cleanup preserves privacy and failed ownership (retained: ${retained})`, async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-renewal-helper-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
      const sessionId = "hidden-successor";
      await store.createSession({ sessionId, runtimeKind: "genesis" });
      const runtime = { stateRoot: root, store, getSession: (id) => store.readSession(id) };
      const artifact = kind === "hints"
        ? `assistant/prompt-hint-tasks/${"a".repeat(64)}.json`
        : `database/assistant-tasks/${"b".repeat(20)}.json`;
      const helperRoot = path.join(root, "assistant-helpers", `${kind}_abc123`);
      const helper = { scope: { id: `${kind}_abc123`, workdir: path.join(helperRoot, "workdir"),
        runtimeRoot: path.join(helperRoot, "runtime") }, conversationId: "retained-thread", executionId: "retained-process",
        selection: { engineId: "codex", modelId: "observed-model" } };
      if (retained) {
        await mkdir(helper.scope.workdir, { recursive: true });
        await store.writeJsonArtifact(sessionId, artifact, helper);
      }
      await store.writeMetadataValue(sessionId, "renewal_id", "exact-renewal");
      await store.writeMetadataValue(sessionId, "renewed_from", "predecessor");
      await writeFile(store.paths(sessionId).statusPath, "renewal_pending\n");
      let cleanupReady = false;
      let deletions = 0;
      const remove = async (scope, input, options) => {
        deletions += 1;
        assert.deepEqual(scope, helper.scope);
        assert.equal(input.conversationId, helper.conversationId);
        assert.equal(input.cleanupExecutionId, helper.executionId);
        assert.deepEqual(options.assistantSelection, helper.selection);
        return cleanupReady ? { ok: true } : { ok: false, code: "cleanup_pending", error: "Native process still owned" };
      };
      const projectService = { createRuntime: async () => runtime, createSessionStore: async () => store,
        sessionDatabaseEnvironment: () => assert.fail("Cleanup must not connect to a database") };
      const service = kind === "hints"
        ? createSessionPromptHintsService({ projectService, agent: { deleteEphemeralConversation: remove,
          resolveAssistantPurpose: () => assert.fail("Cleanup must not resolve a new helper") } })
        : createDatabaseService({ projectService, terminalService: { deleteEphemeralAgentConversation: remove } });
      const close = kind === "hints" ? service.cancelSessionPromptHintsForSession : service.closeAssistantsForSession;
      const context = { runtime, session: await store.readSessionForRenewal(sessionId),
        renewalCleanup: { kind: "successor", renewalId: "exact-renewal", sourceSessionId: "predecessor" } };
      await assert.rejects(close(sessionId), { code: "vibe64_session_renewal_private" });
      if (retained) {
        await assert.rejects(close(sessionId, context), { code: "cleanup_pending" });
        assert.deepEqual(JSON.parse(await store.readArtifactForRenewal(sessionId, artifact)), helper);
        await access(helper.scope.workdir);
      }
      cleanupReady = true;
      assert.equal((await close(sessionId, context)).ok, true);
      assert.equal(deletions, retained ? 2 : 0);
      assert.equal(await store.readArtifactForRenewal(sessionId, artifact), "");
      await assert.rejects(store.readSession(sessionId), { code: "vibe64_session_renewal_private" });
      await assert.rejects(store.readArtifact(sessionId, artifact), { code: "vibe64_session_renewal_private" });
      if (retained) await assert.rejects(access(helper.scope.workdir), { code: "ENOENT" });
    });
  }
}
