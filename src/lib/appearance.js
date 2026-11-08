import { readLocalStorageJson, writeLocalStorageJson } from "./browserLocalStorage.js";

// The colour theme is a per-browser convenience: "system" (the default) follows
// the device setting; "light" or "dark" keeps one scheme.
const APPEARANCE_STORAGE_KEY = "vibe64.appearance";
const APPEARANCE_CHOICES = Object.freeze(["light", "dark", "system"]);

function readAppearance() {
  const value = readLocalStorageJson(APPEARANCE_STORAGE_KEY, "system");
  return APPEARANCE_CHOICES.includes(value) ? value : "system";
}

function writeAppearance(value) {
  if (APPEARANCE_CHOICES.includes(value)) writeLocalStorageJson(APPEARANCE_STORAGE_KEY, value);
}

export { APPEARANCE_CHOICES, readAppearance, writeAppearance };
