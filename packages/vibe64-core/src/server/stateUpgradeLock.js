import { randomUUID } from "node:crypto";
import { link, readFile, rename, rm } from "node:fs/promises";

import { linuxProcessStat, processEnded } from "@local/vibe64-execution/server/processEnded";

import { writeFileAtomic } from "./atomicFile.js";

// upgrades/apply.lock names the process that holds it: its pid and, on Linux, the boot it runs in and its start time
// (/proc), so a lock whose holder is provably gone is taken over instead of refusing every later apply. A power cut
// during an apply leaves a lock from an earlier boot, and a start step killed at its time limit leaves one whose pid
// names no process, or a later process that reused it. A lock that names no process this code can check (an older
// release's empty lock, or a damaged one) is never taken over.

const BOOT_ID_FILE = "/proc/sys/kernel/random/boot_id";

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}

/**
 * A process's state, thread count and start time in clock ticks after boot, from /proc/<pid>/stat; null where there is
 * no /proc or no such process.
 */
async function processStart(pid) {
  const stat = linuxProcessStat(await readOptionalText(`/proc/${pid}/stat`));
  return stat && { state: stat.state, started: stat.startTimeTicks, threads: stat.threads };
}

async function currentHolder() {
  const bootId = (await readOptionalText(BOOT_ID_FILE))?.trim() || null;
  return { pid: process.pid, bootId, started: bootId ? (await processStart(process.pid))?.started ?? null : null };
}

function parseHolder(text) {
  try {
    const holder = JSON.parse(text);
    if (Number.isSafeInteger(holder?.pid) && holder.pid > 0 &&
        [holder.bootId, holder.started].every((value) => value === null || typeof value === "string")) return holder;
  } catch {
    // Not a lock this code wrote.
  }
  return null;
}

/** Whether the process a lock names is provably gone: another boot's, exited, or its pid reused by a later process. */
async function holderGone(holder) {
  const bootId = (await readOptionalText(BOOT_ID_FILE))?.trim() || null;
  if (holder.bootId && bootId) {
    if (holder.bootId !== bootId) return true;
    const running = await processStart(holder.pid);
    return !running || processEnded(running) || running.started !== holder.started;
  }
  // Without boot ids only a pid that names no process proves its holder gone.
  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

/**
 * Takes a lock whose holder is gone out of the way; false while it is held. It moves aside exactly the lock it read
 * (the same holder), and gives back one another process took in between.
 */
async function removeGoneLock(lockPath) {
  let text;
  try {
    text = await readFile(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
  const holder = parseHolder(text);
  if (!holder || !await holderGone(holder)) return false;
  const aside = `${lockPath}.${randomUUID()}.gone`;
  try {
    await rename(lockPath, aside);
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
  if (await readFile(aside, "utf8") !== text) {
    try {
      await link(aside, lockPath);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw new Error(`Two processes took over the state upgrade lock at once; the one moved aside is ${aside}. ` +
        "Stop every upgrade, then remove both before retrying.", { cause: error });
    }
    await rm(aside);
    return false;
  }
  await rm(aside);
  return true;
}

/**
 * Creates upgrades/apply.lock naming this process, taking over one whose holder is gone. Returns its release, or null
 * while another process holds it.
 * @param {string} lockPath
 * @returns {Promise<null | (() => Promise<void>)>}
 */
async function acquireUpgradeLock(lockPath) {
  const contents = `${JSON.stringify(await currentHolder())}\n`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Written whole first and linked into place only where no lock is, so the lock never exists without its holder.
      await writeFileAtomic(lockPath, contents, { createDirectory: false, exclusive: true, createMode: 0o600 });
      return async () => {
        // Only this process's lock is removed.
        if (await readOptionalText(lockPath) === contents) await rm(lockPath);
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (!await removeGoneLock(lockPath)) return null;
  }
  return null;
}

export { acquireUpgradeLock };
