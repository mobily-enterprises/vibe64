import os from "node:os";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import {
  CRASH_RECORDS_LIMIT,
  acknowledgeVibe64Crashes,
  readVibe64CrashRecords
} from "@local/vibe64-core/server/crashRecords";

// The editor's view of its crash records (@local/vibe64-core/server/crashRecords): the banner's summary for every
// person, the whole records and their acknowledgement only for those who can act on them. The workspace owner can,
// and so can the person at their own computer (a request with no signed-in person is a local one: the route wrapper
// admits no other).

/** @param {any} user */
function canActOnCrashes(user) {
  return !user || user.role === "owner";
}

function ownerRequired() {
  return new AppError(403, "Only the workspace owner can see and acknowledge crashes.", { code: "vibe64_owner_required" });
}

const counted = (record) => record.kind !== "unreadable" && !record.acknowledged;

/**
 * What the banner shows of the newest crash: the whole record (its Copy for a bug report copies it) for those who
 * can act, and only when and what became of the AI work for the others.
 */
function bannerCrash(record, full) {
  if (full) return record;
  return {
    id: record.id,
    at: record.at,
    kind: record.kind,
    lastHeartbeatAt: record.lastHeartbeatAt ?? null,
    activeTurns: record.activeTurns ?? null,
    resumed: record.resumed ?? null
  };
}

/** Who acknowledged: the signed-in person, or this computer's account for the person at it. */
function acknowledger(user) {
  if (user) return { username: String(user.username || ""), displayName: String(user.displayName || user.username || "") };
  let username = "";
  try {
    username = os.userInfo().username;
  } catch {
    // A computer without a passwd entry for this account still records the acknowledgement.
  }
  return { username, displayName: username || "This computer's user" };
}

/**
 * @param {object} dependencies
 * @param {string} dependencies.systemRoot
 */
function createCrashService({ systemRoot }) {
  /** The banner's crashes not yet acknowledged, for every person. */
  async function summary({ vibe64User = null } = {}) {
    const { records, unacknowledged } = await readVibe64CrashRecords({ systemRoot });
    const latest = records.find(counted);
    const full = canActOnCrashes(vibe64User);
    return {
      ok: true,
      canAcknowledge: full,
      unacknowledged,
      latest: latest ? bannerCrash(latest, full) : null
    };
  }

  /** Every record, newest first, for the Crashes page. */
  async function list({ vibe64User = null } = {}) {
    if (!canActOnCrashes(vibe64User)) throw ownerRequired();
    const { records, unacknowledged, removed } = await readVibe64CrashRecords({ systemRoot });
    return { ok: true, limit: CRASH_RECORDS_LIMIT, records, unacknowledged, removed };
  }

  /** Records who acknowledged the crashes up to the newest they were shown, and when. */
  async function acknowledge({ vibe64User = null, through } = {}) {
    if (!canActOnCrashes(vibe64User)) throw ownerRequired();
    const { acknowledged } = await acknowledgeVibe64Crashes({ systemRoot, through, by: acknowledger(vibe64User) });
    return { ok: true, acknowledged };
  }

  return Object.freeze({
    acknowledge,
    list,
    summary
  });
}

export { canActOnCrashes, createCrashService };
