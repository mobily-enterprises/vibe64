// A planned restart's notice, as the host writes it and the editor reads it: one small JSON file whose path the host
// gives in VIBE64_PLANNED_RESTART_NOTICE_FILE, under a memory-only folder so a reboot removes it. The editor obeys a
// notice only while it is valid: the schema below, written during this machine's boot, and not yet expired. Anything
// else is ignored. The editor never writes the notice and nothing waits for a reply: the host cancels a restart by
// removing the file.
//
// The crucial operations are the ones a restart must not cut: they change lasting state in several parts. While a
// notice is in force none of them starts; what already runs is left to finish. Reads, status and a target's Run steps
// stay allowed.

import { readFileSync } from "node:fs";

const PLANNED_RESTART_SCHEMA = "vibe64.planned-restart.v1";
// The host's setting: the notice file's path. Without it the editor never reads a notice.
const PLANNED_RESTART_NOTICE_FILE_SETTING = "VIBE64_PLANNED_RESTART_NOTICE_FILE";
const PLANNED_RESTART_REFUSAL_CODE = "vibe64_planned_restart";
// A notice expires this long after its restart time at the latest, whatever it says: the lock never outlives it.
const PLANNED_RESTART_EXPIRY_MS = 3 * 60_000;
const NOTICE_FIELDS = Object.freeze(["schema", "id", "restartAt", "expiresAt", "reason", "bootId"]);
const NOTICE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const REASON_MAX = 200;
const BOOT_ID_FILE = "/proc/sys/kernel/random/boot_id";

/**
 * The one list of crucial operations, by id, each with the words a refusal starts with. A host's own operation that
 * changes lasting state (Publish to staging, Deploy to production, a backup) uses its id here, or joins the list with
 * its own id and label when it refuses (plannedRestartRefusal's `label`).
 */
const CRUCIAL_OPERATIONS = Object.freeze({
  save: "Save",
  update: "Update this session",
  "staging-publish": "Publish to staging",
  "production-deploy": "Deploy to production",
  "workspace-preparation": "Workspace preparation",
  "output-prepare": "Starting Preview or Run (its Prepare steps)",
  "project-import": "Adding a project",
  "project-archive": "Archiving a project",
  "project-restore": "Restoring a project",
  "session-create": "Creating a session",
  "session-delete": "Archiving a session",
  "env-save": "Saving Env",
  "plan-handoff": "Handing the plan to Senior",
  "automatic-review": "Starting Senior's review or a plan's pass",
  "git-write": "A Git commit, push or rebase"
});

/** This machine's boot id, or "" where there is none (not Linux): no notice is obeyed then. */
function readBootId() {
  try {
    return readFileSync(BOOT_ID_FILE, "utf8").trim().toLowerCase();
  } catch {
    return "";
  }
}

const isoTimeMs = value => (typeof value === "string" && ISO_TIME.test(value) ? Date.parse(value) : Number.NaN);

/**
 * The notice the file's text holds, or why it is ignored.
 * @param {string} text the file's contents
 * @param {{ bootId: string, nowMs: number }} context
 * @returns {{ notice: { id: string, restartAt: string, expiresAt: string, reason: string, bootId: string,
 *   restartAtMs: number, expiresAtMs: number } } | { ignored: string }}
 */
function plannedRestartNoticeFrom(text, { bootId, nowMs }) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ignored: "it is not JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ignored: "it is not a JSON object" };
  const keys = Object.keys(value);
  if (keys.length !== NOTICE_FIELDS.length || !NOTICE_FIELDS.every(field => keys.includes(field))) {
    return { ignored: `it must have exactly these fields: ${NOTICE_FIELDS.join(", ")}` };
  }
  if (value.schema !== PLANNED_RESTART_SCHEMA) return { ignored: `its schema is not ${PLANNED_RESTART_SCHEMA}` };
  if (typeof value.id !== "string" || !NOTICE_ID.test(value.id)) return { ignored: "its id is not a short plain name" };
  const restartAtMs = isoTimeMs(value.restartAt);
  const expiresAtMs = isoTimeMs(value.expiresAt);
  if (!Number.isFinite(restartAtMs) || !Number.isFinite(expiresAtMs)) {
    return { ignored: "restartAt and expiresAt must be ISO times" };
  }
  if (expiresAtMs <= restartAtMs || expiresAtMs - restartAtMs > PLANNED_RESTART_EXPIRY_MS) {
    return { ignored: "expiresAt must be after restartAt and at most 3 minutes after it" };
  }
  if (typeof value.reason !== "string" || value.reason.length > REASON_MAX) {
    return { ignored: `its reason must be text of at most ${REASON_MAX} characters` };
  }
  if (typeof value.bootId !== "string" || !bootId || value.bootId.trim().toLowerCase() !== bootId) {
    return { ignored: "it was written during another boot of this machine" };
  }
  if (nowMs >= expiresAtMs) return { ignored: "it has expired" };
  return {
    notice: Object.freeze({
      id: value.id,
      restartAt: new Date(restartAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      reason: value.reason.trim(),
      bootId,
      restartAtMs,
      expiresAtMs
    })
  };
}

/** "07:40 UTC" for a time in ms. */
function restartClock(ms) {
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

/** "in 5 minutes", "in 1 minute" or "in under a minute", until a time. */
function restartIn(ms, nowMs) {
  const minutes = Math.ceil((ms - nowMs) / 60_000);
  if (minutes >= 2) return `in ${minutes} minutes`;
  return minutes === 1 ? "in 1 minute" : "in under a minute";
}

/**
 * The words that open a refusal of a crucial operation.
 * @param {string} operation an id from CRUCIAL_OPERATIONS, or a host's own
 * @param {string} [label] a host's own operation's words
 */
function crucialOperationLabel(operation, label = "") {
  return String(label || CRUCIAL_OPERATIONS[operation] || operation || "This").trim();
}

/**
 * A crucial operation's refusal: one plain sentence naming the restart time.
 * @param {{ restartAtMs: number }} notice
 * @param {string} operation
 * @param {{ label?: string, after?: string }} [options] after: what to do then, by default trying again
 */
function plannedRestartRefusalMessage(notice, operation, { label = "", after = "" } = {}) {
  return `${crucialOperationLabel(operation, label)} is paused: this workspace restarts at ${restartClock(notice.restartAtMs)}. ` +
    `${after || "Try again after the restart."}`;
}

/**
 * The note every AI turn running at notice time is steered with, and that leads every turn starting in the window.
 * @param {{ restartAtMs: number }} notice
 * @param {number} nowMs
 */
function plannedRestartWarning(notice, nowMs) {
  const at = restartClock(notice.restartAtMs);
  const minuteBefore = restartClock(notice.restartAtMs - 60_000);
  return `Vibe64: this workspace restarts at ${at} (${restartIn(notice.restartAtMs, nowMs)}). Everything running then ` +
    "stops, including your commands and subagents. Don't start new subagents, tests, builds, installs or migrations. " +
    "Saves, Updates, Preview starts and deploys are paused. Let short commands finish; stop long ones at a safe point " +
    `and tell your subagents to wrap up. Before ${minuteBefore}, write where you are and what's next in your plan.`;
}

/** The note a steered AI gets when the restart did not happen. */
const PLANNED_RESTART_CANCELLED_NOTE = "Vibe64: the planned restart didn't happen; carry on.";

/**
 * The note that leads a turn Vibe64 resumes after the restart.
 * @param {number} restartedAtMs
 * @param {string[]} stopped what was running, in words
 */
function plannedRestartResumeMessage(restartedAtMs, stopped) {
  const list = stopped.length ? stopped.join("; ") : "your turn";
  return `Vibe64: Restarted at ${restartClock(restartedAtMs)}. This was stopped: ${list}. Continue from your notes.`;
}

export {
  CRUCIAL_OPERATIONS,
  PLANNED_RESTART_CANCELLED_NOTE,
  PLANNED_RESTART_EXPIRY_MS,
  PLANNED_RESTART_NOTICE_FILE_SETTING,
  PLANNED_RESTART_REFUSAL_CODE,
  PLANNED_RESTART_SCHEMA,
  crucialOperationLabel,
  plannedRestartNoticeFrom,
  plannedRestartRefusalMessage,
  plannedRestartResumeMessage,
  plannedRestartWarning,
  readBootId,
  restartClock
};
