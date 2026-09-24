import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import codexLoginId from "./stateUpgrades/20260923-codex-login-id.js";
import routingV2 from "./stateUpgrades/20260923-routing-v2.js";

// Published entries are immutable. Append new upgrades in order; never remove one.
const upgrades = [codexLoginId, routingV2];

async function readLedger(ledgerPath) {
  let source;
  try {
    source = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, applied: [] };
    throw error;
  }
  let ledger;
  try { ledger = JSON.parse(source); } catch {
    throw new Error("State upgrade ledger is not valid JSON; inspect it before retrying.");
  }
  if (ledger?.version !== 1 || !Array.isArray(ledger.applied) || ledger.applied.length > upgrades.length ||
      ledger.applied.some((entry, index) => entry?.id !== upgrades[index]?.id ||
        typeof entry?.completedAt !== "string" || !Number.isFinite(Date.parse(entry.completedAt)))) {
    throw new Error("State upgrade ledger has unsupported, unordered, or newer history; refusing to upgrade or downgrade.");
  }
  return ledger;
}

async function runStateUpgrades({ systemRoot, apply = false, upgradeAssistantRouting,
  report = (level, message) => console.log(`[${level}] ${message}`) }) {
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) || path.resolve(systemRoot) === path.parse(systemRoot).root) {
    throw new Error("State upgrades require an absolute, non-root Vibe64 system directory.");
  }
  const upgradeRoot = path.join(systemRoot, "upgrades");
  const ledgerPath = path.join(upgradeRoot, "applied.json");
  const lockPath = path.join(upgradeRoot, "apply.lock");
  let lock;
  if (apply) {
    await mkdir(upgradeRoot, { recursive: true, mode: 0o700 });
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw new Error("State upgrade lock exists. Check for a running upgrade; remove a stale lock only after confirming it has stopped.");
    }
  }
  try {
    const ledger = await readLedger(ledgerPath);
    const pending = upgrades.slice(ledger.applied.length);
    report("info", `${pending.length} pending state upgrade(s).`);
    const run = (upgrade, write) => upgrade.run({
      systemRoot,
      apply: write,
      // The composition root supplies feature-owned migration operations.
      // Core must not depend back on Accounts or Runtime.
      upgradeAssistantRouting,
      backupRoot: path.join(upgradeRoot, "backups", upgrade.id),
      report: (level, message) => report(level, `${upgrade.id}: ${message}`)
    }).catch(error => {
      throw new Error(`${upgrade.id}: ${error.message}`, { cause: error });
    });
    // Check all pending work before the first mutation. Apply re-reads each input.
    for (const upgrade of pending) await run(upgrade, false);
    if (!apply) return { pending: pending.map(upgrade => upgrade.id), applied: [] };
    const applied = [];
    for (const upgrade of pending) {
      await run(upgrade, true);
      ledger.applied.push({ id: upgrade.id, completedAt: new Date().toISOString() });
      const temporaryPath = `${ledgerPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        await rename(temporaryPath, ledgerPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      applied.push(upgrade.id);
      report("info", `${upgrade.id}: completed and recorded.`);
    }
    return { pending: [], applied };
  } finally {
    if (lock) {
      await lock.close();
      await rm(lockPath);
    }
  }
}

export { runStateUpgrades };
