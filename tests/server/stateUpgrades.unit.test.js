import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runStateUpgrades } from "../../packages/vibe64-core/src/server/stateUpgrades.js";
import { readCodexLoginId } from "../../packages/vibe64-core/src/server/codexAuthState.js";
import { CodexAppServerAgentProvider } from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import { buildNodeBundle } from "../../tooling/release/server-build.mjs";
import { RUNTIME_ENTRIES } from "../../tooling/release/runtime-package.mjs";

const exec = promisify(execFile);
const id = "20260923-codex-login-id";
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
    run: (apply = false) => runStateUpgrades({ systemRoot, apply, report: (level, message) => messages.push({ level, message }) })
  };
}

test("check is read-only, including on an installation that has never created state", async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.run()).pending, [id]);
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
  assert.deepEqual((await f.run(true)).applied, [id]);
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
  await rm(f.ledgerPath);
  await f.run(true);
  assert.equal(await readFile(f.markerPath, "utf8"), marker);
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

test("fresh and disconnected installations record a successful no-op", async t => {
  for (const disconnected of [false, true]) {
    const f = await fixture(t);
    if (disconnected) await f.marker({ ...legacyMarker, connected: false });
    await f.run(true);
    assert.equal(await readCodexLoginId(f.systemRoot), "");
    assert.equal(JSON.parse(await readFile(f.ledgerPath, "utf8")).applied.length, 1);
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
  const entry = "bin/upgrade-state.js";
  assert.ok(RUNTIME_ENTRIES.includes(entry));
  const outfile = path.join(f.root, "release/upgrade-state.mjs");
  await buildNodeBundle({ appRoot: repoRoot, entryPoint: path.join(repoRoot, entry), outfile });
  const args = [outfile, `--system-root=${f.systemRoot}`];
  await exec(process.execPath, [...args, "--check"], { cwd: f.root });
  assert.equal(await readCodexLoginId(f.systemRoot), "");
  await exec(process.execPath, [...args, "--apply"], { cwd: f.root });
  assert.ok(await readCodexLoginId(f.systemRoot));
  await assert.rejects(exec(process.execPath, args), error => error.code === 1 && error.stderr.includes("Usage:"));
  await writeFile(f.ledgerPath, "{invalid");
  await assert.rejects(exec(process.execPath, [...args, "--apply"]), error => error.code === 1 && error.stderr.includes("ERROR:"));
});
