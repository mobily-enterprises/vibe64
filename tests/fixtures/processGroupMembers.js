/**
 * The members of a process group a stop has left running. RED: the handover test's check as it stood, the kernel's
 * answer for the group, which also counts a member that has exited and waits for its parent to reap it.
 * @param {number} groupId
 * @returns {{ pid: number }[]}
 */
export function liveProcessGroupMembers(groupId) {
  try {
    process.kill(-groupId, 0);
    return [{ pid: groupId }];
  } catch (error) {
    if (error?.code === "ESRCH") return [];
    throw error;
  }
}
