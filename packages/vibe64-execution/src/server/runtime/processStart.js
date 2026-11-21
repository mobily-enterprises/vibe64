import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/**
 * The fields after the command name in /proc/<pid>/stat: state, ppid, pgrp, ...
 * and the start time in clock ticks at index 19. Any state letter is accepted
 * (tracing stop is lower-case "t"); callers decide which states they trust.
 */
function parseLinuxProcessStat(statText = "") {
  const text = String(statText || "").trim();
  const commandEnd = text.lastIndexOf(")");
  if (commandEnd < 0) {
    return null;
  }
  const fields = text.slice(commandEnd + 1).trim().split(/\s+/u);
  const state = String(fields[0] || "");
  const startTimeTicks = String(fields[19] || "");
  if (!/^[A-Za-z]$/u.test(state) || !/^\d+$/u.test(startTimeTicks)) {
    return null;
  }
  return {
    groupId: Number(fields[2]),
    startTimeTicks,
    state
  };
}

/**
 * One `ps -o pgid=,stat=,lstart=` line. lstart ("Tue Oct 21 10:00:00 2026")
 * becomes whole seconds since the epoch, so it compares like Linux ticks.
 */
function parsePsProcessLine(line = "") {
  const match = /^\s*(\d+)\s+(\S+)\s+(\S.*\S)\s*$/u.exec(String(line || ""));
  const startedAt = match ? Date.parse(match[3]) : Number.NaN;
  if (!Number.isFinite(startedAt)) {
    return null;
  }
  return {
    groupId: Number(match[1]),
    startTimeTicks: String(Math.floor(startedAt / 1000)),
    state: match[2].slice(0, 1)
  };
}

function psEnv() {
  return { ...process.env, LC_ALL: "C" };
}

/**
 * Reads a process's start identity: { status: "exact" | "absent" | "ambiguous",
 * groupId, state, startTimeTicks }. Linux reads /proc; macOS asks ps.
 */
async function readProcessStart(pid, {
  execFileFn = execFile,
  platform = process.platform,
  readFileFn = readFile
} = {}) {
  const normalizedPid = Number(pid);
  const ambiguous = { status: "ambiguous", groupId: 0, state: "", startTimeTicks: "" };
  if (!Number.isSafeInteger(normalizedPid) || normalizedPid <= 0) {
    return ambiguous;
  }
  if (platform === "linux") {
    try {
      const identity = parseLinuxProcessStat(await readFileFn(`/proc/${normalizedPid}/stat`, "utf8"));
      return identity ? { status: "exact", ...identity } : ambiguous;
    } catch (error) {
      return ["ENOENT", "ENOTDIR"].includes(error?.code) ? { ...ambiguous, status: "absent" } : ambiguous;
    }
  }
  if (platform !== "darwin") {
    return ambiguous;
  }
  try {
    const { stdout } = await execFileFn("ps", ["-o", "pgid=,stat=,lstart=", "-p", String(normalizedPid)], {
      encoding: "utf8",
      env: psEnv()
    });
    const identity = parsePsProcessLine(String(stdout || "").split(/\r?\n/u)[0]);
    return identity ? { status: "exact", ...identity } : ambiguous;
  } catch (error) {
    // ps exits 1 with no output when the process does not exist.
    return error?.code === 1 && !String(error?.stdout || "").trim()
      ? { ...ambiguous, status: "absent" }
      : ambiguous;
  }
}

/**
 * The kernel's answer for a process group: true while it has any member, a zombie included. EPERM means
 * the group exists but belongs to another user.
 */
function processGroupExists(groupId) {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * /proc/<name>/stat, or "" for a process that has gone (ENOENT before the open, ESRCH once reaped after it)
 * or that hidepid hides from this user (EACCES, EPERM). Any other failure throws.
 */
async function readLinuxProcessStatText(name, readFileFn) {
  try {
    return await readFileFn(`/proc/${name}/stat`, "utf8");
  } catch (error) {
    if (["EACCES", "ENOENT", "EPERM", "ESRCH"].includes(error?.code)) {
      return "";
    }
    throw error;
  }
}

/**
 * True when any non-zombie process still belongs to the process group. A process table that could not be read
 * proves nothing, so the kernel's answer for the group, which counts zombies, decides then.
 */
async function processGroupHasLiveMember(groupId, {
  execFileFn = execFile,
  platform = process.platform,
  readFileFn = readFile,
  readdirFn = readdir
} = {}) {
  const normalizedGroupId = Number(groupId);
  if (!Number.isSafeInteger(normalizedGroupId) || normalizedGroupId <= 1) {
    return false;
  }
  if (platform === "linux") {
    try {
      // Names only, as every numeric entry is a process directory. Listed with entry types, /proc gives a process
      // being reaped mid-listing no type, Node then lstat's that entry, and once the process has gone the lstat's
      // ENOENT rejects the whole listing, which read as a group with no live member.
      for (const name of await readdirFn("/proc")) {
        if (!/^\d+$/u.test(name)) {
          continue;
        }
        const identity = parseLinuxProcessStat(await readLinuxProcessStatText(name, readFileFn));
        if (identity?.groupId === normalizedGroupId && identity.state !== "Z") {
          return true;
        }
      }
      return false;
    } catch {
      return processGroupExists(normalizedGroupId);
    }
  }
  try {
    const { stdout } = await execFileFn("ps", ["-ax", "-o", "pgid=,stat="], {
      encoding: "utf8",
      env: psEnv()
    });
    return String(stdout || "").split(/\r?\n/u).some((line) => {
      const [group, state = ""] = line.trim().split(/\s+/u);
      return Number(group) === normalizedGroupId && !state.startsWith("Z");
    });
  } catch {
    return processGroupExists(normalizedGroupId);
  }
}

/**
 * The tag stored next to a start identity, so a reader compares like with like.
 */
function processStartIdentityPlatform(platform = process.platform) {
  if (platform === "linux") return "linux-proc";
  if (platform === "darwin") return "darwin-ps";
  return "";
}

export {
  processGroupHasLiveMember,
  processStartIdentityPlatform,
  readProcessStart
};
