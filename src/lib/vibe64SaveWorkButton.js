// What a press of the session header's Save button does. While Save and Update cannot act the button stays
// reachable, marked unavailable, and a press shows why beside it: a disabled button takes no tap, hover or focus,
// so a reason kept in its hover title never shows on a phone, nor to a pointer.

/**
 * @param {{ checking: boolean, checkAvailable: boolean, disabled: boolean }} state the header's Save state: a
 * check for updates running, a check offered in place of Save (nothing to save), and Save or Update unavailable
 * @returns {"wait" | "check" | "explain" | "save"}
 */
function saveWorkButtonPress({ checking, checkAvailable, disabled }) {
  if (checking) return "wait";
  if (checkAvailable) return "check";
  return disabled ? "explain" : "save";
}

// Why the Save or Update notice's Review resolved conflicts or Create draft PR waits, shown as text beside them, or ""
// when the buttons shown can act. A session renewal holds every source operation; otherwise Save's own reason
// (saveWorkTitle) says what holds Save and Update, as the header's Save shows it.
/**
 * @param {{ held: boolean, renewing: boolean, saveWorkTitle: string }} state
 * @returns {string}
 */
function saveWorkNoticeHeldReason({ held, renewing, saveWorkTitle }) {
  if (!held) return "";
  return renewing ? "Wait for the session renewal to finish before saving or updating." : String(saveWorkTitle || "");
}

export { saveWorkButtonPress, saveWorkNoticeHeldReason };
