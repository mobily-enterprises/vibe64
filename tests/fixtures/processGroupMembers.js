import { readdirSync, readFileSync } from "node:fs";

/**
 * The members of a process group still running, from Linux's process table: each one's pid, parent, state and
 * command. A member that has exited stays in its group until its parent reaps it (a test's own child on that
 * process's next turn, an orphan once init gets to it) and holds nothing, so it is left out, as a stop leaves it out
 * (the server's processGroupHasLiveMember, JSKIT's process identity scan). A process gone, or another user's, is not
 * a member. Elsewhere than Linux the kernel's answer for the group, which counts exited members too, decides.
 * @param {number} groupId
 * @returns {{ pid: number, parent?: number, state?: string, command?: string }[]}
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
    const [state, parent, group] = stat.slice(commandEnd + 2).split(" ");
    if (!stat || Number(group) !== groupId || state === "Z") continue;
    members.push({ pid: Number(name), parent: Number(parent), state, command: stat.slice(stat.indexOf("(") + 1, commandEnd) });
  }
  return members;
}

function readStat(name) {
  try {
    return readFileSync(`/proc/${name}/stat`, "utf8");
  } catch (error) {
    if (["EACCES", "ENOENT", "EPERM", "ESRCH"].includes(error?.code)) return "";
    throw error;
  }
}

/**
 * What of a stopped process group still runs: [] once every member has exited. RED: read once.
 * @param {number} groupId
 * @param {{ members?: (groupId: number) => object[], exitingForMs?: number }} [options]
 */
export async function processGroupMembersLeftRunning(groupId, { members = liveProcessGroupMembers } = {}) {
  return members(groupId);
}

/** Each member as a failure names it. RED: as JSON. */
export function describeProcessGroupMembers(members) {
  return JSON.stringify(members);
}
