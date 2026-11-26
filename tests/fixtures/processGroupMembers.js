import { readdirSync, readFileSync } from "node:fs";

import { linuxProcessStat, processEnded } from "../../packages/vibe64-execution/src/server/runtime/processEnded.js";

// PF_EXITING in the flags of a /proc stat (include/linux/sched.h): the task has started to exit.
const PF_EXITING = 0x4;

/**
 * The members of a process group that have not exited, from Linux's process table: each one's pid, parent, state,
 * flags (hexadecimal), whether it is exiting (PF_EXITING) and command. A member that has exited (processEnded) stays in
 * its group until its parent reaps it (a test's own child on that process's next turn, an orphan once init gets to it)
 * and holds nothing, so it is left out, as a stop leaves it out (the server's processGroupHasLiveMember, JSKIT's process
 * identity scan). A zombie leader whose process still has other threads has not exited: it is exiting only while each
 * of those threads is. A process gone, or another user's, is not a member. Elsewhere than Linux the kernel's answer
 * for the group, which counts exited members too, decides.
 * @param {number} groupId
 * @returns {{ pid: number, parent?: number, state?: string, exiting?: boolean, flags?: string, command?: string }[]}
 */
export function liveProcessGroupMembers(groupId) {
  if (process.platform !== "linux") {
    try {
      process.kill(-groupId, 0);
      return [{ pid: groupId }];
    } catch (error) {
      if (error?.code === "ESRCH") return [];
      throw error;
    }
  }
  const members = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/u.test(name)) continue;
    const text = readStat(name);
    const stat = linuxProcessStat(text);
    if (stat?.groupId !== groupId || processEnded(stat)) continue;
    members.push({
      pid: Number(name),
      parent: stat.parentId,
      state: stat.state,
      // A zombie (the state processEnded reads as ended on a last thread) that has not ended leads other threads.
      exiting: processEnded({ state: stat.state }) ? otherThreadsExiting(name) : (stat.flags & PF_EXITING) !== 0,
      flags: stat.flags.toString(16),
      command: text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"))
    });
  }
  return members;
}

/**
 * Whether a process still runs: false once it is gone or has exited (processEnded). An exited process stays a zombie
 * until its parent reaps it, and an orphan's parent is init or the nearest subreaper, which a busy host can take
 * seconds to get to, so a drain counts a zombie as ended and so does this. Elsewhere than Linux the kernel's answer
 * for the pid, which counts a zombie too, decides.
 * @param {number} pid
 */
export function processRuns(pid) {
  if (process.platform === "linux") {
    const text = readStat(String(pid));
    return Boolean(text) && !processEnded(linuxProcessStat(text));
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

/**
 * What of a stopped process group still runs: [] once every member has exited. A member with PF_EXITING runs none of
 * its own code again: the kernel sets the flag as the member starts to exit, and releases its memory only after that,
 * so all that is left is the kernel's own exit work before it is a zombie (0.6 to 4.9 ms in 42 exits watched on a
 * loaded test host). A stop can let such a member go, so it is followed until it is a zombie or gone, for up to a
 * second, and named if it is not by then. So is a zombie leader whose other threads are all on their way out. Any
 * other member (running, sleeping or waiting on a disk, without PF_EXITING, or a zombie leader with a thread that
 * runs on) is named at once.
 * @param {number} groupId
 * @param {{ members?: (groupId: number) => ReturnType<typeof liveProcessGroupMembers>, exitingForMs?: number }} [options]
 */
export async function processGroupMembersLeftRunning(groupId, { members = liveProcessGroupMembers, exitingForMs = 1_000 } = {}) {
  const deadline = Date.now() + exitingForMs;
  for (;;) {
    const left = members(groupId);
    if (!left.length || left.some(({ exiting }) => !exiting) || Date.now() >= deadline) return left;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Each member as a failure names it: pid, command, state and flags. */
export function describeProcessGroupMembers(members) {
  return members.map(({ pid, command, state, flags, exiting }) => [
    `pid ${pid}`,
    command,
    state && `state ${state}`,
    flags && `flags 0x${flags}${exiting ? " (exiting)" : ""}`
  ].filter(Boolean).join(" ")).join(", ");
}

/**
 * Whether every thread of a process but its zombie leader is on its way out: ended, exiting (PF_EXITING) or with
 * SIGKILL pending, as each is once the process exits as a whole and its leader can be a zombie a moment before the
 * others. A thread that is none of these runs on after its leader's pthread_exit. A thread gone since the listing has
 * ended.
 * @param {string} pid
 */
function otherThreadsExiting(pid) {
  let threads;
  try {
    threads = readdirSync(`/proc/${pid}/task`).filter((thread) => thread !== pid);
  } catch {
    return true;
  }
  return threads.every((thread) => {
    let stat;
    let status;
    try {
      stat = linuxProcessStat(readFileSync(`/proc/${pid}/task/${thread}/stat`, "utf8"));
      status = readFileSync(`/proc/${pid}/task/${thread}/status`, "utf8");
    } catch {
      return true;
    }
    const killPending = [...status.matchAll(/^(?:SigPnd|ShdPnd):\s*([0-9a-f]+)$/gmu)]
      .some(([, mask]) => (BigInt(`0x${mask}`) & (1n << 8n)) !== 0n);
    return !stat || processEnded({ state: stat.state }) || (stat.flags & PF_EXITING) !== 0 || killPending;
  });
}

function readStat(name) {
  try {
    return readFileSync(`/proc/${name}/stat`, "utf8");
  } catch (error) {
    if (["EACCES", "ENOENT", "EPERM", "ESRCH"].includes(error?.code)) return "";
    throw error;
  }
}
