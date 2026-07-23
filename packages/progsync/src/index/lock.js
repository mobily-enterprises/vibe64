import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ProgSyncError } from "./errors.js";
import { runGit } from "./git.js";
import { pairDigest } from "./state.js";

const STALE_LOCK_MS = 2 * 60 * 60 * 1000;

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function existingClaimIsStale(claimPath) {
  let stat = null;
  try {
    stat = await fs.stat(claimPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }
  let owner = null;
  if (stat.isFile()) {
    try {
      owner = JSON.parse(await fs.readFile(claimPath, "utf8"));
    } catch {
      // Age decides whether a damaged claim can be recovered safely.
    }
  }
  if (owner?.hostname === os.hostname() && processIsAlive(Number(owner.pid))) {
    return false;
  }
  return Date.now() - stat.mtimeMs > STALE_LOCK_MS || owner?.hostname === os.hostname();
}

async function createOwnedClaim(claimPath, owner) {
  const handle = await fs.open(claimPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
  } catch (error) {
    await fs.rm(claimPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await handle.close();
  }
}

async function releaseOwnedClaim(claimPath, nonce) {
  try {
    const current = JSON.parse(await fs.readFile(claimPath, "utf8"));
    if (current.nonce === nonce) {
      await fs.rm(claimPath, { force: true });
    }
  } catch (error) {
    // Claim cleanup must never hide the synchronization result. A damaged or
    // abandoned claim becomes recoverable after its bounded stale interval.
    if (error?.code !== "ENOENT") {
      return;
    }
  }
}

async function retireStaleClaim(claimPath, nonce) {
  if (!(await existingClaimIsStale(claimPath))) {
    return false;
  }
  const retiredPath = `${claimPath}.stale-${nonce}`;
  try {
    await fs.rename(claimPath, retiredPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }
  await fs.rm(retiredPath, { force: true, recursive: true });
  return true;
}

async function acquireCleanupClaim(cleanupPath, owner) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await createOwnedClaim(cleanupPath, owner);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (attempt === 1 && await retireStaleClaim(cleanupPath, owner.nonce)) {
        continue;
      }
      return false;
    }
  }
  return false;
}

async function acquirePairLock(pair) {
  const gitPath = (await runGit(pair.projectRoot, [
    "rev-parse",
    "--git-path",
    `progsync/locks/${pairDigest(pair)}.lock`
  ])).trim();
  const lockPath = path.isAbsolute(gitPath)
    ? gitPath
    : path.resolve(pair.projectRoot, gitPath);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const owner = {
    createdAt: new Date().toISOString(),
    hostname: os.hostname(),
    nonce: crypto.randomUUID(),
    pid: process.pid,
    programPath: pair.programPath
  };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await createOwnedClaim(lockPath, owner);
      return () => releaseOwnedClaim(lockPath, owner.nonce);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (attempt === 1) {
        const cleanupPath = `${lockPath}.cleanup`;
        const cleanupOwner = {
          ...owner,
          claim: "stale-lock-cleanup",
          nonce: crypto.randomUUID()
        };
        const ownsCleanup = await acquireCleanupClaim(cleanupPath, cleanupOwner);
        if (ownsCleanup) {
          try {
            if (await existingClaimIsStale(lockPath)) {
              await fs.rm(lockPath, { force: true, recursive: true });
              continue;
            }
          } finally {
            await releaseOwnedClaim(cleanupPath, cleanupOwner.nonce);
          }
        }
      }
      throw new ProgSyncError(
        "PAIR_BUSY",
        `Another ProgSync process is already synchronizing ${pair.programPath}.`,
        { lockPath }
      );
    }
  }
  throw new ProgSyncError("PAIR_BUSY", `Cannot acquire the pair lock for ${pair.programPath}.`);
}

export {
  acquirePairLock
};
