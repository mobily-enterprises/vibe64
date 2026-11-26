// The words people read about the host's planned restart: the banner's countdown and reason, the "Paused until HH:MM"
// on the controls it pauses, and after the restart what it stopped. Times are in the viewer's own zone.

const pad = (value) => String(value).padStart(2, "0");

/** "07:40" in the viewer's zone, or "" for a time that does not parse. */
function plannedRestartClock(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : `${pad(at.getHours())}:${pad(at.getMinutes())}`;
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
 * The banner's sentence once after the restart.
 * @param {{ restartedAt: string, reason: string, sessions: number, stopped: Array<{ label: string, sessionName: string }> }} restarted
 */
function plannedRestartAfterText(restarted) {
  const reason = String(restarted.reason || "").trim().replace(/[.\s]+$/u, "");
  const stopped = restarted.stopped.map(({ label, sessionName }) => (sessionName ? `${label} (${sessionName})` : label));
  const resumed = restarted.sessions === 1 ? "The AI that was working picks up where it left off."
    : restarted.sessions > 1 ? `The ${restarted.sessions} sessions whose AI was working pick up where they left off.` : "";
  return [
    `This workspace restarted at ${plannedRestartClock(restarted.restartedAt)}${reason ? ` (${reason})` : ""}.`,
    stopped.length ? `Stopped: ${stopped.join("; ")}.` : "Nothing else was running.",
    resumed
  ].filter(Boolean).join(" ");
}

export {
  plannedRestartAfterText,
  plannedRestartClock,
  plannedRestartCountdown,
  plannedRestartHeadline,
  plannedRestartPausedLabel
};
