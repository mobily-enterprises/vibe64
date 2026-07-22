import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ProgSyncError } from "./errors.js";
import { runGit } from "./git.js";
import { pairDigest } from "./state.js";

const STALE_LOCK_MS = 30 * 60 * 1000;

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

async function existingLockIsStale(lockPath) {
  let source = null;
  let stat = null;
  try {
    [source, stat] = await Promise.all([
      fs.readFile(lockPath, "utf8"),
      fs.stat(lockPath)
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }
  let owner = null;
  try {
    owner = JSON.parse(source);
  } catch {
    // Age decides whether a damaged lock can be recovered safely.
  }
  if (owner?.hostname === os.hostname() && processIsAlive(Number(owner.pid))) {
    return false;
  }
  return Date.now() - stat.mtimeMs > STALE_LOCK_MS || owner?.hostname === os.hostname();
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
      const handle = await fs.open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
          if (current.nonce === owner.nonce) {
            await fs.rm(lockPath, { force: true });
          }
        } catch (error) {
          // Lock cleanup must never hide the synchronization result. A stale lock
          // is recoverable on the next invocation.
          if (error?.code !== "ENOENT") {
            return;
          }
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (attempt === 1) {
        const cleanupPath = `${lockPath}.cleanup`;
        let ownsCleanup = false;
        try {
          await fs.mkdir(cleanupPath);
          ownsCleanup = true;
        } catch (cleanupError) {
          if (cleanupError?.code !== "EEXIST") {
            throw cleanupError;
          }
        }
        if (ownsCleanup) {
          try {
            if (await existingLockIsStale(lockPath)) {
              await fs.rm(lockPath, { force: true });
              continue;
            }
          } finally {
            await fs.rmdir(cleanupPath).catch(() => {});
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
