import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runStateUpgrades } from "../../packages/vibe64-core/src/server/stateUpgrades.js";
import { upgradeAssistantRoles } from "../../packages/vibe64-accounts/src/server/assistantRoleUpgrade.js";
import { upgradeAssistantRouting } from "../../packages/vibe64-accounts/src/server/assistantRoutingUpgrade.js";
import { readCodexLoginId } from "../../packages/vibe64-core/src/server/codexAuthState.js";
import { CodexAppServerAgentProvider } from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { buildNodeBundle } from "../../tooling/release/server-build.mjs";
import { RUNTIME_ENTRIES } from "../../tooling/release/runtime-package.mjs";

const exec = promisify(execFile);
const id = "20260923-codex-login-id";
const routingId = "20260923-routing-v2";
const upgradeIds = [id, routingId, "20260925-native-conversation-lifecycle", "20260926-assistant-role-names"];
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const legacyMarker = { connected: true, updatedAt: "2026-09-23T03:15:44.821Z", version: 1 };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-upgrade-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const markerPath = path.join(systemRoot, "auth/codex/status.json");
  const ledgerPath = path.join(systemRoot, "upgrades/applied.json");
  const messages = [];
  return {
    root, systemRoot, markerPath, ledgerPath, messages,
    async marker(value = legacyMarker) {
      await mkdir(path.dirname(markerPath), { recursive: true });
      await writeFile(markerPath, typeof value === "string" ? value : JSON.stringify(value));
    },
    run: (apply = false) => runStateUpgrades({ systemRoot, apply, upgradeAssistantRouting, upgradeAssistantRoles, report: (level, message) => messages.push({ level, message }) })
  };
}

test("check is read-only, including on an installation that has never created state", async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.run()).pending, upgradeIds);
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" });
  await f.marker();
  const original = await readFile(f.markerPath, "utf8");
  await f.run();
  assert.equal(await readFile(f.markerPath, "utf8"), original);
  await assert.rejects(stat(path.dirname(f.ledgerPath)), { code: "ENOENT" });
  assert.equal(f.messages.some(entry => entry.level === "warning"), true);
});

test("apply backs up and upgrades the connection without changing credentials or auth transitions", async t => {
  const f = await fixture(t);
  await f.marker({ ...legacyMarker, extra: "preserved" });
  const original = await readFile(f.markerPath, "utf8");
  const nativeAuth = path.join(f.root, "auth.json");
  const transition = path.join(f.systemRoot, "auth/codex/auth-status.json");
  const credentials = '{"tokens":{"account_id":null,"access_token":"DO-NOT-LOG"}}';
  await writeFile(nativeAuth, credentials);
  await writeFile(transition, '{"status":"reconnect_required"}');
  assert.deepEqual((await f.run(true)).applied, upgradeIds);
  assert.ok(await readCodexLoginId(f.systemRoot));
  const { loginId, ...remaining } = JSON.parse(await readFile(f.markerPath, "utf8"));
  assert.equal(typeof loginId, "string");
  assert.deepEqual(remaining, JSON.parse(original));
  const backup = path.join(f.systemRoot, "upgrades/backups", id, "codex-status.json");
  assert.equal(await readFile(backup, "utf8"), original);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  assert.equal((await stat(f.markerPath)).mode & 0o777, 0o600);
  assert.equal((await stat(f.ledgerPath)).mode & 0o777, 0o600);
  assert.equal(await readFile(nativeAuth, "utf8"), credentials);
  assert.equal(await readFile(transition, "utf8"), '{"status":"reconnect_required"}');
  assert.equal(JSON.stringify(f.messages).includes("DO-NOT-LOG"), false);
  const ledger = JSON.parse(await readFile(f.ledgerPath, "utf8"));
  assert.equal(ledger.applied[0].id, id);
});

test("completed upgrades never run again, and interrupted ledger recording preserves the new identity", async t => {
  const f = await fixture(t);
  await f.marker();
  await f.run(true);
  const marker = await readFile(f.markerPath, "utf8");
  const ledger = await readFile(f.ledgerPath, "utf8");
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.equal(await readFile(f.ledgerPath, "utf8"), ledger);
  // A crash after the marker rename but before the ledger rename must be retryable.
  const interrupted = await fixture(t);
  await interrupted.marker(marker);
  await interrupted.run(true);
  assert.equal(await readFile(interrupted.markerPath, "utf8"), marker);
});

test("upgrading a legacy connection restores the AI controls identity lookup with a null native account ID", async t => {
  const f = await fixture(t);
  await f.marker();
  const toolHomeSource = path.join(f.root, "daemon");
  const authPath = path.join(toolHomeSource, ".codex/auth.json");
  const credentials = JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: null } });
  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(authPath, credentials);
  const options = { systemRoot: f.systemRoot, toolHomeSource };
  const beforeUpgrade = new CodexAppServerAgentProvider(options);
  await assert.rejects(beforeUpgrade.currentRuntimeInfo(), { code: "vibe64_codex_login_identity_unavailable" });
  await f.run();
  assert.equal(await readCodexLoginId(f.systemRoot), "", "deployment preflight does not modify the marker");
  await f.run(true);
  const afterRestart = new CodexAppServerAgentProvider(options);
  const identity = (await afterRestart.currentRuntimeInfo()).accountIdentitySignature;
  assert.match(identity, /^sha256:[a-f0-9]{64}$/u);
  assert.equal((await afterRestart.currentRuntimeInfo()).accountIdentitySignature, identity);
  assert.equal(await readFile(authPath, "utf8"), credentials, "native account_id remains null and credentials are untouched");
});

test("fresh and disconnected installations preserve login state and record the ordered upgrades", async t => {
  for (const disconnected of [false, true]) {
    const f = await fixture(t);
    if (disconnected) await f.marker({ ...legacyMarker, connected: false });
    await f.run(true);
    assert.equal(await readCodexLoginId(f.systemRoot), "");
    assert.equal(JSON.parse(await readFile(f.ledgerPath, "utf8")).applied.length, upgradeIds.length);
  }
});

test("malformed or unsupported metadata blocks upgrades without replacing it or recording success", async t => {
  for (const marker of ['{"secret":"DO-NOT-LOG",', {}, { ...legacyMarker, version: 2 }, { ...legacyMarker, loginId: null }]) {
    const f = await fixture(t);
    await f.marker(marker);
    const original = await readFile(f.markerPath, "utf8");
    await assert.rejects(f.run(true), error => error.message.includes(id) && !error.message.includes("DO-NOT-LOG"));
    assert.equal(await readFile(f.markerPath, "utf8"), original);
    await assert.rejects(stat(f.ledgerPath), { code: "ENOENT" });
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  }
});

test("unsupported ledger histories prevent state writes", async t => {
  for (const ledger of ["{", { version: 2, applied: [] }, { version: 1, applied: [{ id: "future", completedAt: new Date().toISOString() }] },
    { version: 1, applied: [{ id, completedAt: "invalid" }] },
    { version: 1, applied: [{ id, completedAt: new Date().toISOString() }, { completedAt: new Date().toISOString() }] }]) {
    const f = await fixture(t);
    await f.marker();
    await mkdir(path.dirname(f.ledgerPath));
    await writeFile(f.ledgerPath, typeof ledger === "string" ? ledger : JSON.stringify(ledger));
    await assert.rejects(f.run(true), /ledger/);
    assert.equal(await readCodexLoginId(f.systemRoot), "");
  }
});

test("an existing apply lock is never stolen or removed", async t => {
  const f = await fixture(t);
  await f.marker();
  const lockPath = path.join(f.systemRoot, "upgrades/apply.lock");
  await mkdir(path.dirname(lockPath));
  await writeFile(lockPath, "other process");
  await assert.rejects(f.run(true), /lock exists/);
  assert.equal(await readFile(lockPath, "utf8"), "other process");
  assert.equal(await readCodexLoginId(f.systemRoot), "");
});

test("conflicting backups block repair instead of silently replacing the recovery copy", async t => {
  const f = await fixture(t);
  await f.marker();
  const backup = path.join(f.systemRoot, "upgrades/backups", id, "codex-status.json");
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, "earlier state");
  await assert.rejects(f.run(true), /saved upgrade backup/);
  assert.equal(await readFile(backup, "utf8"), "earlier state");
  assert.equal(await readCodexLoginId(f.systemRoot), "");
});

test("the packaged standalone CLI checks, applies and reports failure without source dependencies", async t => {
  const f = await fixture(t);
  await f.marker();
  const routingPath = path.join(f.systemRoot, "ai-connections/routing.json");
  await mkdir(path.dirname(routingPath), { recursive: true });
  await writeFile(routingPath, JSON.stringify({ schemaVersion: 1, revision: 4, orchestrators: {} }));
  const store = createVibe64SessionStore({ projectContextRoot: f.root, projectRuntimeRoot: path.join(f.systemRoot, "projects/example") });
  await store.createSession({ runtimeKind: "genesis", sessionId: "archived" });
  await store.writeMetadataValue("archived", "assistant_selection", JSON.stringify({ schema: "vibe64.assistant-selection.v1",
    engineId: "opencode", agentId: "build", modelProviderId: "opencode", modelId: "big-pickle", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}` }));
  await store.writeStatus("archived", "archived");
  await store.publishSessionArchive("archived");
  const archivePath = path.join(store.paths().archivedSessionsRoot, "archived.tar.gz");
  const originalArchive = await readFile(archivePath);
  const entry = "bin/upgrade-state.js";
  assert.ok(RUNTIME_ENTRIES.includes(entry));
  const outfile = path.join(f.root, "release/upgrade-state.mjs");
  await buildNodeBundle({ appRoot: repoRoot, entryPoint: path.join(repoRoot, entry), outfile });
  const args = [outfile, `--system-root=${f.systemRoot}`];
  await exec(process.execPath, [...args, "--check"], { cwd: f.root });
  assert.equal(await readCodexLoginId(f.systemRoot), "");
  assert.equal(JSON.parse(await readFile(routingPath, "utf8")).schemaVersion, 1);
  assert.deepEqual(await readFile(archivePath), originalArchive);
  await exec(process.execPath, [...args, "--apply"], { cwd: f.root });
  assert.ok(await readCodexLoginId(f.systemRoot));
  const routing = JSON.parse(await readFile(routingPath, "utf8"));
  assert.equal(routing.schemaVersion, 3);
  assert.equal(routing.orchestrators.opencode.junior.modelId, "big-pickle");
  assert.equal(JSON.parse(await store.readMetadataValue("archived", "assistant_routing")).workflowEngineId, "opencode");
  await assert.rejects(exec(process.execPath, args), error => error.code === 1 && error.stderr.includes("Usage:"));
  await writeFile(f.ledgerPath, "{invalid");
  await assert.rejects(exec(process.execPath, [...args, "--apply"]), error => error.code === 1 && error.stderr.includes("ERROR:"));
});

test("routing preflight failure blocks earlier identity writes as well", async t => {
  const f = await fixture(t);
  await f.marker();
  const routingPath = path.join(f.systemRoot, "ai-connections/routing.json");
  await mkdir(path.dirname(routingPath), { recursive: true });
  await writeFile(routingPath, "broken");
  await assert.rejects(f.run(true), /Model routing is invalid/u);
  assert.equal(await readCodexLoginId(f.systemRoot), "");
  await assert.rejects(stat(f.ledgerPath), { code: "ENOENT" });
});

test("a crash after routing publication but before its ledger entry resumes the same upgrade", async t => {
  const f = await fixture(t);
  await f.marker();
  const routingPath = path.join(f.systemRoot, "ai-connections/routing.json");
  await mkdir(path.dirname(routingPath), { recursive: true });
  const original = JSON.stringify({ schemaVersion: 1, revision: 4, orchestrators: {} });
  await writeFile(routingPath, original);
  await assert.rejects(runStateUpgrades({ systemRoot: f.systemRoot, apply: true, upgradeAssistantRoles, report: () => {},
    upgradeAssistantRouting: (context) => upgradeAssistantRouting({ ...context, report: (_level, message) => {
      if (message.startsWith("Published routing state:")) throw new Error("lost before ledger commit");
    } })
  }), /lost before ledger commit/u);
  assert.deepEqual(JSON.parse(await readFile(f.ledgerPath, "utf8")).applied.map((entry) => entry.id), [id]);
  const published = await readFile(routingPath, "utf8");
  assert.deepEqual((await f.run(true)).applied, upgradeIds.slice(1));
  assert.equal(JSON.parse(await readFile(routingPath, "utf8")).schemaVersion, 3);
  assert.equal(JSON.parse(await readFile(routingPath, "utf8")).revision, JSON.parse(published).revision);
  assert.equal(await readFile(path.join(f.systemRoot, "upgrades/backups", routingId, "before/ai-connections/routing.json"), "utf8"), original);
  assert.equal(JSON.parse(published).revision, 5);
});
