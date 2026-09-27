import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upgradeAssistantHelpers, upgradeAssistantHelperSession, upgradeAssistantHelperTurn } from "../../packages/vibe64-accounts/src/server/assistantHelperUpgrade.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";

import { codexHelperThreadRecordId, createCodexHelperThreadLedger, defineCodexHelperThreadRecord }
  from "../../packages/vibe64-terminals/src/server/codexHelperThreadLedger.js";

const selection = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex",
  modelProviderId: "deepseek", modelId: "deepseek-flash", variantId: "max",
  catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "explicit" };
const configuration = { schemaVersion: 3, revision: 17, orchestrators: { codex: {
  senior: selection, junior: { ...selection, variantId: "high" }, intern: selection,
  router: { ...selection, variantId: "low" }, sharedBackup: selection
} } };
const profile = { profileId: "economy", workloadId: "prompt_hint", model: selection.modelId, thinking: "low",
  providerId: "codex", revision: "recorded-profile", limits: { maxInputCharacters: 24000, maxOutputCharacters: 2500, timeoutMs: 120000 },
  policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
  request: { allowProviderModelFallback: false, reasoning: true, summary: false } };
const metadata = {
  assistant_routing: JSON.stringify({ mode: "intern", workflowEngineId: "codex", review: true, override: selection }),
  assistant_routing_request: JSON.stringify({ schemaVersion: 3, mode: "auto", status: "failed", messageId: "one",
    submittedBy: { username: "member", role: "member" }, input: { message: "intern and economy are my words" },
    configuration, helper: { executionId: "cleanup-one", executionProfile: profile }, assignments: { router: selection } })
};

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-helper-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const backupRoot = path.join(systemRoot, "upgrades/backups/20260927-assistant-helper");
  const file = path.join(systemRoot, "ai-connections/routing.json");
  const projectRoot = path.join(systemRoot, "projects/example");
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: projectRoot });
  return { root, systemRoot, backupRoot, file, projectRoot, store,
    async config(value = configuration) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)); },
    run: (apply = false, report = () => {}) => upgradeAssistantHelpers({ systemRoot, backupRoot, apply, report })
  };
}
async function populate(f, id) {
  await f.store.createSession({ sessionId: id, runtimeKind: "genesis" });
  for (const [key, value] of Object.entries(metadata)) await f.store.writeMetadataValue(id, key, value);
  await f.store.writeSessionConversation(id, "temporary", { routingMetadata: metadata, providerConversationId: "native-temp" });
  await f.store.writeConversationUserMessage(id, { messageId: "one", text: "intern and economy are my words" });
  await writeFile(path.join(f.store.paths(id).conversationLogRoot, "000001/metadata.json"), JSON.stringify({ messageId: "one",
    assistantRouting: { requestedMode: "intern", resolvedMode: "intern", destination: selection } }));
  await f.store.writeJsonArtifact(id, "assistant/prompt-hint-tasks/one.json", { executionProfile: profile, executionId: "retained" });
  await f.store.writeBackgroundTaskEvent(id, "save-work", { patch: { status: "ready", commitTitleExecutionProfile: profile } });
}

test("Helper upgrade preserves user choices and authored content while removing the direct-chat role", async t => {
  const f = await fixture(t); await f.config(); await populate(f, "active");
  const source = await readFile(f.file, "utf8");
  await f.run();
  assert.equal(await readFile(f.file, "utf8"), source);
  assert.equal(await f.store.readMetadataValue("active", "assistant_routing"), metadata.assistant_routing);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await f.run(true);
  const saved = await createAssistantRoutingStore({ systemRoot: f.systemRoot }).read();
  assert.equal(saved.schemaVersion, 4);
  assert.equal(saved.revision, 17);
  assert.deepEqual(saved.orchestrators.codex.helper, selection);
  assert.equal(Object.hasOwn(saved.orchestrators.codex, "intern"), false);
  assert.deepEqual(saved.orchestrators.codex.router, configuration.orchestrators.codex.router);
  assert.deepEqual(JSON.parse(await f.store.readMetadataValue("active", "assistant_routing")), { mode: "junior", workflowEngineId: "codex", review: false });
  const request = JSON.parse(await f.store.readMetadataValue("active", "assistant_routing_request"));
  assert.equal(request.helper.executionProfile.profileId, "helper");
  assert.equal(request.helper.executionId, "cleanup-one");
  assert.deepEqual((await f.store.readBackgroundTask("active", "save-work")).commitTitleExecutionProfile,
    { ...profile, profileId: "helper" });
  assert.equal(request.input.message, "intern and economy are my words");
  assert.equal(request.submittedBy.username, "member");
  const history = await f.store.readConversationTail("active");
  assert.equal(history[0].user.text, "intern and economy are my words");
  assert.equal(history[0].metadata.assistantRouting.resolvedMode, "helper");
  assert.equal(JSON.parse(await f.store.readArtifact("active", "assistant/prompt-hint-tasks/one.json")).executionProfile.profileId, "helper");
  assert.equal(await readFile(path.join(f.backupRoot, "before/ai-connections/routing.json"), "utf8"), source);
  const published = await readFile(f.file, "utf8");
  await f.run(); await f.run(true);
  assert.equal(await readFile(f.file, "utf8"), published);
});

test("Helper upgrade includes closing and archived histories", async t => {
  const f = await fixture(t); await f.config();
  await populate(f, "closing");
  await mkdir(f.store.paths().closingSessionsRoot, { recursive: true });
  const closingRoot = path.join(f.store.paths().closingSessionsRoot, "closing");
  await rename(f.store.paths("closing").sessionRoot, closingRoot);
  await populate(f, "archived");
  await f.store.writeStatus("archived", "archived");
  await f.store.publishSessionArchive("archived");
  await f.run(true);
  assert.equal(JSON.parse(await readFile(path.join(closingRoot, "metadata/assistant_routing"), "utf8")).mode, "junior");
  assert.equal((await f.store.readConversationTail("archived"))[0].metadata.assistantRouting.resolvedMode, "helper");
});

test("interrupted publication resumes from verified backups without selecting a new model", async t => {
  const f = await fixture(t); await f.config(); await populate(f, "active");
  await assert.rejects(f.run(true, (_level, message) => { if (message.startsWith("Published routing state:")) throw new Error("power loss"); }), /power loss/);
  assert.equal(JSON.parse(await readFile(f.file, "utf8")).schemaVersion, 4);
  assert.equal(JSON.parse(await f.store.readMetadataValue("active", "assistant_routing")).mode, "intern");
  await f.run(true);
  assert.equal(JSON.parse(await f.store.readMetadataValue("active", "assistant_routing")).mode, "junior");
});

test("ownership moves to the Helper ledger before the original is retired", async t => {
  const f = await fixture(t); await f.config();
  const now = new Date().toISOString();
  const current = defineCodexHelperThreadRecord({
    schemaVersion: 1, revision: 1, createdAt: now, updatedAt: now, lifecycle: "ready",
    projectRuntimeRoot: f.projectRoot, projectContextRoot: f.root, sessionId: "active", threadId: "native-one",
    turnId: "", workdir: path.join(f.root, "source"), ownershipId: "same-owner",
    executionProfile: { ...profile, profileId: "helper" },
    identity: { providerId: "codex", providerKeyFingerprint: `sha256:${"c".repeat(64)}`,
      transportId: "codex_app_server", server: { userAgent: "vibe64/0.149.0" },
      runtime: { accountIdentitySignature: `sha256:${"a".repeat(64)}`, authStateSignature: `v1:${"b".repeat(24)}`,
        executionMode: "helper", executionContextHash: "c".repeat(12), provider: "codex_app_server",
        runtimeDir: path.join(f.root, "native-runtime"), endpoint: `unix://${f.root}/native.sock`,
        runtimesHash: "d".repeat(12), terminalEnvHash: "e".repeat(12), toolHomeSource: "", transport: "unix" }
    }
  });
  const previous = { ...current, executionProfile: profile,
    identity: { ...current.identity, runtime: { ...current.identity.runtime, executionMode: "economy" } } };
  const name = `${codexHelperThreadRecordId(current)}.json`;
  const oldRoot = path.join(f.projectRoot, "codex-economy-thread-ownership");
  const target = path.join(f.projectRoot, "codex-helper-thread-ownership", name);
  await mkdir(oldRoot, { recursive: true });
  await writeFile(path.join(oldRoot, name), JSON.stringify(previous));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "");
  await assert.rejects(f.run(true), /Conflicting Helper ownership/);
  assert.deepEqual(JSON.parse(await readFile(path.join(oldRoot, name))), previous);
  await rm(target);
  await f.run(true);
  assert.deepEqual(await createCodexHelperThreadLedger({ projectRuntimeRoot: f.projectRoot }).readAll(), {
    failures: [], records: [current]
  });
  assert.deepEqual(await readdir(oldRoot), []);
  assert.equal(JSON.parse(await readFile(path.join(f.backupRoot, "before/projects/example/codex-economy-thread-ownership", name), "utf8")).threadId, "native-one");
});

test("accepted third-role work retains its model, actor and unconfirmed receipt", () => {
  const request = { schemaVersion: 3, mode: "intern", resolvedMode: "intern", status: "uncertain", attemptedMessageId: "one",
    assignments: { intern: selection }, configuration, submittedBy: { username: "member" },
    decision: { role: "intern", purpose: "intern", instructionPurpose: "intern", effectiveSelection: selection, connectionIdentity: "original" } };
  const result = upgradeAssistantHelperSession({ metadata: { assistant_routing_request: JSON.stringify(request) }, conversations: [] });
  const next = JSON.parse(result.metadata.assistant_routing_request);
  assert.equal(next.mode, "junior");
  assert.equal(next.attemptedMessageId, "one");
  assert.equal(next.status, "uncertain");
  assert.deepEqual(next.assignments.junior, selection);
  assert.equal(next.decision.seniorJuniorPair.junior.connectionIdentity, "original");
  assert.deepEqual(next.submittedBy, request.submittedBy);
  assert.equal(upgradeAssistantHelperTurn({ assistantRouting: { requestedMode: "intern", resolvedMode: "intern" } }).assistantRouting.resolvedMode, "helper");
});

test("conflicting settings, corrupt JSON and symlinks stop before changing state", async t => {
  for (const source of ["{broken", JSON.stringify({ ...configuration, schemaVersion: 9 }), JSON.stringify({ ...configuration,
    orchestrators: { codex: { intern: selection, helper: selection } } })]) {
    const f = await fixture(t); await f.config(); await writeFile(f.file, source);
    await assert.rejects(f.run(true));
    assert.equal(await readFile(f.file, "utf8"), source);
    await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  }
  const f = await fixture(t); await f.config(); await populate(f, "active");
  const file = path.join(f.store.paths("active").artifactsRoot, "assistant/prompt-hint-tasks/one.json");
  await rm(file); await symlink(f.file, file);
  await assert.rejects(f.run(true), /symbolic link/);
  assert.deepEqual(JSON.parse(await readFile(f.file, "utf8")), configuration);
});

test("provider defaults are renamed without changing the Helper assignment or connection credentials", async t => {
  const f = await fixture(t); await f.config();
  const file = path.join(f.systemRoot, "ai-connections/connections.json");
  const connection = { apiKey: "keep-private", economyModelId: "provider-default", label: "Connection" };
  await writeFile(file, JSON.stringify({ version: 5, connections: { custom: connection } }));
  await f.run(true);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved.connections.custom, { apiKey: "keep-private", defaultModelId: "provider-default", label: "Connection" });
  assert.deepEqual((await createAssistantRoutingStore({ systemRoot: f.systemRoot }).read()).orchestrators.codex.helper, selection);
});
