import { readdirSync, readFileSync } from "node:fs";

// PF_EXITING in the flags of a /proc stat (include/linux/sched.h): the task has started to exit.
const PF_EXITING = 0x4;

/**
 * The members of a process group that have not exited, from Linux's process table: each one's pid, parent, state,
 * flags (hexadecimal), whether it is exiting (PF_EXITING) and command. A member that has exited stays in its group
 * until its parent reaps it (a test's own child on that process's next turn, an orphan once init gets to it) and holds
 * nothing, so it is left out, as a stop leaves it out (the server's processGroupHasLiveMember, JSKIT's process
 * identity scan). A process gone, or another user's, is not a member. Elsewhere than Linux the kernel's answer for the
 * group, which counts exited members too, decides.
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
    const stat = readStat(name);
    const commandEnd = stat.lastIndexOf(")");
    const [state, parent, group, , , , flags] = stat.slice(commandEnd + 2).split(" ");
    if (!stat || Number(group) !== groupId || state === "Z") continue;
    members.push({
      pid: Number(name),
      parent: Number(parent),
      state,
      exiting: (Number(flags) & PF_EXITING) !== 0,
      flags: Number(flags).toString(16),
      command: stat.slice(stat.indexOf("(") + 1, commandEnd)
    });
  }
  return members;
}

/**
 * What of a stopped process group still runs: [] once every member has exited. A member with PF_EXITING runs none of
 * its own code again: the kernel sets the flag as the member starts to exit, and releases its memory only after that,
 * so all that is left is the kernel's own exit work before it is a zombie (0.6 to 4.9 ms in 42 exits watched on a
 * loaded test host). A stop can let such a member go, so it is followed until it is a zombie or gone, for up to a
 * second, and named if it is not by then. Any other member (running, sleeping or waiting on a disk, without
 * PF_EXITING) is named at once.
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

function readStat(name) {
  try {
    return readFileSync(`/proc/${name}/stat`, "utf8");
  } catch (error) {
    if (["EACCES", "ENOENT", "EPERM", "ESRCH"].includes(error?.code)) return "";
    throw error;
  }
}
