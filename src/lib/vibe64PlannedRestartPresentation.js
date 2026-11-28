// The words people read about the host's planned restart: the banner's countdown and reason, the "Paused until HH:MM"
// on the controls it pauses, and after the restart what it stopped. Times are in the viewer's own zone.

import { localClockText } from "./vibe64CrashPresentation.js";

/** "07:40" in the viewer's zone, or "" for a time that does not parse. */
function plannedRestartClock(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : localClockText(at);
}

/** "in 4 minutes", "in 1 minute", "in under a minute" or "now". */
function plannedRestartCountdown(iso, nowMs) {
  const leftMs = Date.parse(iso) - nowMs;
  if (!(leftMs > 0)) return "now";
  const minutes = Math.ceil(leftMs / 60_000);
  if (leftMs < 60_000) return "in under a minute";
  return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
}

/**
 * The banner's sentence while a notice is in force.
 * @param {{ restartAt: string, reason: string }} active
 * @param {number} nowMs
 */
function plannedRestartHeadline(active, nowMs) {
  const reason = String(active.reason || "").trim();
  return `This workspace restarts at ${plannedRestartClock(active.restartAt)} (${plannedRestartCountdown(active.restartAt, nowMs)})` +
    `${reason ? `: ${reason.replace(/[.\s]+$/u, "")}` : ""}. Save, Update, Preview starts and deploys are paused until then; ` +
    "everything running then stops, and the AI picks up where it left off afterwards.";
}

/** What the paused controls say. */
function plannedRestartPausedLabel(active) {
  return `Paused until ${plannedRestartClock(active.restartAt)}: this workspace restarts then`;
}

/**
 * The calm message once after the restart: when, that nothing was lost, the AI that picked up where it left off, what
 * else the restart stopped, and, when the update changed the page's code, that Reload gets it.
 * @param {{ restartedAt: string, sessions: number, stopped: Array<{ label: string, sessionName: string }> }} restarted
 * @param {{ updated?: boolean }} [options] `updated`: the server serves another client build than the page runs
 */
function plannedRestartAfterText(restarted, { updated = false } = {}) {
  const stopped = restarted.stopped.map(({ label, sessionName }) => (sessionName ? `${label} (${sessionName})` : label));
  const resumed = restarted.sessions === 1 ? "The AI that was working picked up where it left off."
    : restarted.sessions > 1 ? `The AI in the ${restarted.sessions} sessions that were working picked up where it left off.` : "";
  return [
    `Restarted for an update at ${plannedRestartClock(restarted.restartedAt)}. Nothing was lost.`,
    resumed,
    stopped.length ? `Stopped then: ${stopped.join("; ")}.` : "",
    updated ? "Reload to get the latest version." : ""
  ].filter(Boolean).join(" ");
}

export {
  plannedRestartAfterText,
  plannedRestartClock,
  plannedRestartCountdown,
  plannedRestartHeadline,
  plannedRestartPausedLabel
};
