import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { maintainProjectBackups, withProjectBackupsLock } from "../../packages/vibe64-runtime/src/server/projectBackups.js";
import { maintainStateUpgradeBackups } from "../../packages/vibe64-core/src/server/stateUpgrades.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "backup-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("project retention previews without mutation, expires old files, and retains fresh writes and links", async (t) => {
  const stateRoot = await fixture(t);
  const root = path.join(stateRoot, "backups");
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "nested/old.txt"), "old backup");
  await writeFile(path.join(root, "recent.txt"), "recent backup");
  await writeFile(path.join(stateRoot, "outside.txt"), "protected");
  await symlink(path.join(stateRoot, "outside.txt"), path.join(root, "link"));
  const now = Date.now() + 15 * 86400000;
  await utimes(path.join(root, "recent.txt"), now / 1000, now / 1000);
  const dry = await maintainProjectBackups({ stateRoot, now, dryRun: true });
  assert.ok(dry.eligibleBytes > 0);
  assert.equal(dry.reclaimedBytes, 0);
  assert.equal(await readFile(path.join(root, "nested/old.txt"), "utf8"), "old backup");
  await assert.rejects(readdir(path.join(stateRoot, "locks")), { code: "ENOENT" });
  await withProjectBackupsLock(stateRoot, async () => {
    await assert.rejects(maintainProjectBackups({ stateRoot, now }), { code: "project_backups_busy" });
  });
  const applied = await maintainProjectBackups({ stateRoot, now });
  assert.equal(applied.reclaimedBytes, dry.eligibleBytes);
  assert.deepEqual(await readdir(path.join(root, "nested")), []);
  assert.equal(await readFile(path.join(root, "recent.txt"), "utf8"), "recent backup");
  assert.equal(await readFile(path.join(stateRoot, "outside.txt"), "utf8"), "protected");
  assert.equal(applied.issues[0].code, "project_backups_entry_unverified");
});

test("copied old timestamps get a fresh retention window and symlink roots are refused", async (t) => {
  const stateRoot = await fixture(t);
  const root = path.join(stateRoot, "backups");
  await mkdir(root);
  await writeFile(path.join(root, "copy.txt"), "old source, new backup");
  await utimes(path.join(root, "copy.txt"), 1, 1);
  assert.equal((await maintainProjectBackups({ stateRoot })).reclaimedBytes, 0);
  await rm(root, { recursive: true });
  await symlink(stateRoot, root);
  assert.equal((await maintainProjectBackups({ stateRoot })).issues[0].code, "project_backups_path_unverified");
});

test("upgrade retention requires a valid completion ledger, age and an idle upgrade lock", async (t) => {
  const systemRoot = await fixture(t);
  const root = path.join(systemRoot, "upgrades");
  const id = "20260923-codex-login-id";
  for (const name of [id, "20260923-routing-v2", "manual-recovery"]) {
    await mkdir(path.join(root, "backups", name), { recursive: true });
    await writeFile(path.join(root, "backups", name, "copy.json"), "sensitive recovery bytes");
  }
  const ledger = JSON.stringify({ version: 1, applied: [{ id, completedAt: new Date().toISOString() }] });
  await writeFile(path.join(root, "applied.json"), ledger);
  assert.equal((await maintainStateUpgradeBackups({ systemRoot })).reclaimedBytes, 0);
  const now = Date.now() + 15 * 86400000;
  const dry = await maintainStateUpgradeBackups({ systemRoot, now, dryRun: true });
  assert.ok(dry.eligibleBytes > 0);
  assert.equal((await readdir(path.join(root, "backups"))).length, 3);
  await writeFile(path.join(root, "apply.lock"), "running");
  assert.equal((await maintainStateUpgradeBackups({ systemRoot, now })).status, "busy");
  assert.equal((await maintainStateUpgradeBackups({ systemRoot, now, dryRun: true })).status, "busy");
  await rm(path.join(root, "apply.lock"));
  const applied = await maintainStateUpgradeBackups({ systemRoot, now });
  assert.equal(applied.reclaimedBytes, dry.eligibleBytes);
  assert.deepEqual((await readdir(path.join(root, "backups"))).sort(), ["20260923-routing-v2", "manual-recovery"]);
  assert.equal(await readFile(path.join(root, "applied.json"), "utf8"), ledger);
  await writeFile(path.join(root, "applied.json"), "invalid");
  await assert.rejects(maintainStateUpgradeBackups({ systemRoot, now }), /not valid JSON/);
  await assert.rejects(readFile(path.join(root, "apply.lock")), { code: "ENOENT" });
});
