import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { upgradeAssistantRoles, upgradeAssistantRoleSession, upgradeAssistantRoleTurn } from "../../packages/vibe64-accounts/src/server/assistantRoleUpgrade.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";

const exec = promisify(execFile);
const senior = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex", modelProviderId: "openai", modelId: "gpt-6-astra", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "explicit" };
const junior = { ...senior, modelProviderId: "deepseek", modelId: "deepseek-flash" };
const oldConfiguration = { schemaVersion: 2, revision: 7, orchestrators: { codex: {
  plan: senior, code: junior, economy: junior, router: junior, sharedBackup: junior,
  helperRoutingReview: { reason: "legacy_helpers_differ", previous: [{ engineId: "codex", modelProviderId: "openai", modelId: "gpt-6-luna", selectionSource: "explicit" }], proposed: junior }
} } };
const oldRequest = { schemaVersion: 2, mode: "auto", resolvedMode: "code", status: "planning_pending", continuation: "plan",
  assignments: { plan: senior, code: junior, router: junior }, configuration: oldConfiguration,
  decision: { purpose: "code", role: "code", instructionPurpose: "code", planCodePair: {
    plan: { effectiveSelection: senior, connectionIdentity: "keep-identity" }, code: { effectiveSelection: junior }
  } },
  messageId: "request-1", attemptedMessageId: "request-1", threadId: "native-1", reviewMessageId: "followup-1",
  submittedBy: { username: "member", role: "member" }, input: { message: "plan code economy are user words", attachments: ["keep.png"] },
  workPlan: { revision: "file-revision", status: "blocked", content: "Do not rewrite plan document content" }
};
const oldMetadata = { assistant_routing: JSON.stringify({ mode: "code", workflowEngineId: "codex", review: true, override: junior }),
  assistant_routing_request: JSON.stringify(oldRequest),
  assistant_routing_goal: JSON.stringify({ mode: "plan", status: "paused", selection: senior, configuration: oldConfiguration }) };
const turn = { actorId: "member", actorDisplayName: "Member", createdAt: "2026-09-25T10:00:00Z", messageId: "request-1",
  assistantRouting: { requestedMode: "auto", resolvedMode: "code", reason: "plan_approval", parentMessageId: "previous", destination: junior } };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-role-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const backupRoot = path.join(systemRoot, "upgrades/backups/20260926-assistant-role-names");
  const file = path.join(systemRoot, "ai-connections/routing.json");
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(systemRoot, "projects/example") });
  const messages = [];
  return { root, systemRoot, backupRoot, file, store, messages,
    run: (apply = false, onReport = () => {}) => upgradeAssistantRoles({ systemRoot, backupRoot, apply,
      report: (level, message) => { messages.push({ level, message }); onReport(message); } }),
    config: async (value = oldConfiguration) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)); }
  };
}

async function snapshot(root) {
  const files = {};
  async function visit(directory, prefix = "") {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative);
      else files[relative] = await readFile(path.join(directory, entry.name), "base64");
    }
  }
  await visit(root);
  return files;
}

async function populateSession(f, sessionId, { transcriptOnly = false } = {}) {
  await f.store.createSession({ sessionId, runtimeKind: "genesis" });
  if (!transcriptOnly) for (const [key, value] of Object.entries(oldMetadata)) await f.store.writeMetadataValue(sessionId, key, value);
  await f.store.writeMetadataValue(sessionId, "agent_conversation_id", "native-1");
  await f.store.writeSessionConversation(sessionId, "temporary", { routingMetadata: transcriptOnly ? {} : oldMetadata,
    providerConversationId: "native-temp", assistantSelection: junior, presentation: { draft: "Keep my draft" } });
  for (const conversationId of [null, "temporary"]) {
    const scope = conversationId ? { sessionId, conversationId } : sessionId;
    await f.store.writeConversationUserMessage(scope, { messageId: "request-1", text: "plan code economy are user words" });
    await f.store.writeConversationAssistantMessage(scope, { text: "Detailed answer must stay byte-for-byte" });
    const logRoot = conversationId ? path.join(f.store.paths(sessionId).conversationsRoot, conversationId, "conversation-log") : f.store.paths(sessionId).conversationLogRoot;
    await writeFile(path.join(logRoot, "000001", "metadata.json"), JSON.stringify(turn));
  }
  await writeFile(path.join(f.store.paths(sessionId).sessionRoot, "provider-history.json"), '{"encrypted":"keep-opaque-data"}');
}

test("role transform changes owned identifiers and preserves selections, receipts, document and user text", () => {
  const result = upgradeAssistantRoleSession({ metadata: oldMetadata, conversations: [], renewal: { status: "running", successor: {
    assistantRouting: { mode: "economy", workflowEngineId: "codex", override: junior }
  } } });
  assert.equal(JSON.parse(result.metadata.assistant_routing).mode, "junior");
  assert.equal(JSON.parse(result.metadata.assistant_routing_goal).mode, "senior");
  const request = JSON.parse(result.metadata.assistant_routing_request);
  assert.equal(request.schemaVersion, 3);
  assert.equal(request.resolvedMode, "junior");
  assert.equal(request.continuation, "planning");
  assert.equal(request.decision.purpose, "junior");
  assert.equal(request.decision.role, "junior");
  assert.equal(request.decision.seniorJuniorPair.senior.connectionIdentity, "keep-identity");
  assert.deepEqual(request.assignments, { senior, junior, router: junior });
  assert.deepEqual(request.configuration.orchestrators.codex.senior, senior);
  for (const field of ["messageId", "attemptedMessageId", "threadId", "reviewMessageId", "submittedBy", "input", "workPlan"]) {
    assert.deepEqual(request[field], oldRequest[field]);
  }
  assert.equal(result.renewal.successor.assistantRouting.mode, "intern");
  assert.deepEqual(upgradeAssistantRoleTurn(turn), { ...turn, assistantRouting: { ...turn.assistantRouting, resolvedMode: "junior" } });
});

test("preflight creates no state and changes no bytes; publication preserves routing revision with verified backups", async t => {
  const f = await fixture(t);
  await f.run();
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" });
  await f.config();
  await populateSession(f, "active");
  await f.store.writeSessionRenewalStateRecord("active", { kind: "vibe64.session_renewal", schemaVersion: 1, sessionId: "active",
    status: "running", stage: "successor_creating", approved: { text: "Keep reviewed handover" },
    successor: { assistantSelection: junior, assistantRouting: { mode: "economy", review: false, workflowEngineId: "codex" } } });
  const before = await snapshot(f.systemRoot);
  await f.run();
  assert.deepEqual(await snapshot(f.systemRoot), before);
  await f.run(true);
  const saved = await createAssistantRoutingStore({ systemRoot: f.systemRoot }).read();
  assert.equal(saved.schemaVersion, 3);
  assert.equal(saved.revision, 7);
  assert.deepEqual(saved.orchestrators.codex, { senior, junior, intern: junior, router: junior, sharedBackup: junior,
    helperRoutingReview: { ...oldConfiguration.orchestrators.codex.helperRoutingReview, reason: "helper_choices_differ" } });
  for (const [relative, bytes] of Object.entries(before)) {
    const backup = path.join(f.backupRoot, "before", relative);
    const after = await readFile(path.join(f.systemRoot, relative), "base64");
    if (after !== bytes) {
      assert.match(relative, /(?:routing\.json|metadata\/assistant_routing(?:_request|_goal)?|conversation\.json|renewals\/active\.json|conversation-log\/\d{6}\/metadata\.json)$/u);
      assert.equal(await readFile(backup, "base64"), bytes);
    }
  }
  const log = await f.store.readConversationTail("active");
  assert.equal(log[0].metadata.assistantRouting.resolvedMode, "junior");
  const tempLog = await f.store.readConversationLogPage({ sessionId: "active", conversationId: "temporary" });
  assert.equal(tempLog.conversationLog[0].metadata.assistantRouting.resolvedMode, "junior");
  assert.equal(JSON.parse((await f.store.readSessionConversation("active", "temporary")).routingMetadata.assistant_routing).mode, "junior");
  const renewal = JSON.parse(await f.store.readSessionRenewalStateRecord("active"));
  assert.equal(renewal.successor.assistantRouting.mode, "intern");
  assert.deepEqual(renewal.successor.assistantSelection, junior);
  assert.equal(renewal.approved.text, "Keep reviewed handover");
  const published = await snapshot(f.systemRoot);
  await f.run(); await f.run(true);
  assert.deepEqual(await snapshot(f.systemRoot), published, "retry reuses exact published copies");
});

test("closing, archived and prepared renewal histories are renamed, including archives with only transcript routing", async t => {
  const f = await fixture(t);
  await f.config();
  await populateSession(f, "closing");
  await mkdir(f.store.paths().closingSessionsRoot, { recursive: true });
  const closingRoot = path.join(f.store.paths().closingSessionsRoot, "closing");
  await rename(f.store.paths("closing").sessionRoot, closingRoot);
  await populateSession(f, "archived", { transcriptOnly: true });
  await f.store.writeStatus("archived", "archived");
  await f.store.publishSessionArchive("archived");
  const archiveRoot = f.store.paths().archivedSessionsRoot;
  const prepared = path.join(archiveRoot, ".renewals", "renewal-1");
  await mkdir(prepared, { recursive: true });
  for (const suffix of [".tar.gz", ".json"]) await copyFile(path.join(archiveRoot, `archived${suffix}`), path.join(prepared, `archived${suffix}`));
  await f.run(true);
  assert.equal(JSON.parse(await readFile(path.join(closingRoot, "metadata/assistant_routing"), "utf8")).mode, "junior");
  for (const directory of [archiveRoot, prepared]) {
    const extractRoot = await mkdtemp(path.join(f.root, "inspect-"));
    await exec("tar", ["-xzf", path.join(directory, "archived.tar.gz"), "-C", extractRoot]);
    const main = JSON.parse(await readFile(path.join(extractRoot, "archived/conversation-log/000001/metadata.json"), "utf8"));
    assert.equal(main.assistantRouting.resolvedMode, "junior");
    assert.equal(await readFile(path.join(extractRoot, "archived/provider-history.json"), "utf8"), '{"encrypted":"keep-opaque-data"}');
  }
  assert.equal((await f.store.readConversationTail("archived"))[0].metadata.assistantRouting.resolvedMode, "junior");
});

test("partial publication resumes from saved replacements without recomputing choices", async t => {
  const f = await fixture(t);
  await f.config(); await populateSession(f, "active");
  await assert.rejects(f.run(true, message => { if (message.startsWith("Published routing state:")) throw new Error("power loss"); }), /power loss/);
  assert.equal(JSON.parse(await readFile(f.file, "utf8")).schemaVersion, 3);
  assert.equal(JSON.parse(await f.store.readMetadataValue("active", "assistant_routing")).mode, "code");
  await f.run(); await f.run(true);
  assert.equal(JSON.parse(await f.store.readMetadataValue("active", "assistant_routing")).mode, "junior");
});

test("malformed, conflicting and linked state stops preflight without changing data", async t => {
  for (const corrupt of ["", "{not json", JSON.stringify({ ...oldConfiguration, schemaVersion: 4 })]) {
    const f = await fixture(t); await f.config(); await writeFile(f.file, corrupt);
    await assert.rejects(f.run(true));
    assert.equal(await readFile(f.file, "utf8"), corrupt);
    await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  }
  assert.throws(() => upgradeAssistantRoleTurn({ assistantRouting: { mode: "unknown" } }), /unknown model role/);
  assert.throws(() => upgradeAssistantRoleSession({ metadata: { assistant_routing_request: JSON.stringify({ assignments: { plan: senior, senior } }) }, conversations: [] }), /both old and new/);
  const f = await fixture(t); await f.config(); await populateSession(f, "active");
  const file = path.join(f.store.paths("active").conversationLogRoot, "000001/metadata.json");
  await rm(file); await symlink(f.file, file);
  await assert.rejects(f.run(true), /regular file/);
  assert.deepEqual(JSON.parse(await readFile(f.file, "utf8")), oldConfiguration);
});
