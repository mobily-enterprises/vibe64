// Draining a registered Preview browser process group: proving it gone, and
// signalling it only once it is identified alive.

import { setTimeout as delay } from "node:timers/promises";
import { processGroupHasLiveMember, readProcessStart } from "@local/vibe64-execution/server";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// "alive", "gone" or "unknown". A registration names its group by the
// leader's start identity: a leader that has exited, or whose id another
// process now holds, ends what it can identify. A leader that could not be
// read proves nothing.
async function registeredProcessGroupState(entry, {
  readStart = readProcessStart,
  hasLiveMember = processGroupHasLiveMember
} = {}) {
  const groupId = Number(entry?.groupId);
  const leader = await readStart(groupId);
  if (leader.status === "ambiguous") {
    return "unknown";
  }
  if (
    leader.status !== "exact" ||
    leader.groupId !== groupId ||
    leader.startTimeTicks !== normalizeText(entry?.startTimeTicks)
  ) {
    return "gone";
  }
  return await hasLiveMember(groupId) ? "alive" : "gone";
}

// True once the group is proven gone. Only a group identified alive is
// signalled; an unknown answer is asked again until the deadline, and a group
// never proven gone is reported, never counted as drained.
async function drainRegisteredProcessGroup(entry = {}, {
  readStart = readProcessStart,
  hasLiveMember = processGroupHasLiveMember,
  signal = (groupId, name) => process.kill(-groupId, name),
  wait = delay
} = {}) {
  const groupState = () => registeredProcessGroupState(entry, { readStart, hasLiveMember });
  const send = (name) => {
    try {
      signal(Number(entry.groupId), name);
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
  };
  const settle = async (state, attempts, until) => {
    for (let attempt = 0; attempt < attempts && !until(state); attempt += 1) {
      await wait(50);
      state = await groupState();
    }
    return state;
  };
  let state = await settle(await groupState(), 60, (current) => current !== "unknown");
  if (state === "alive") {
    send("SIGTERM");
    // The worker stops its browser between commands; a stopped process acts
    // on SIGTERM only once continued.
    send("SIGCONT");
    state = await settle(state, 60, (current) => current === "gone");
  }
  if (state === "alive") {
    send("SIGKILL");
  }
  state = await settle(state, 20, (current) => current === "gone");
  return state === "gone";
}

export {
  drainRegisteredProcessGroup
};
