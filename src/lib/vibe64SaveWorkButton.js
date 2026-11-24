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

export { saveWorkButtonPress };
