import { readLocalStorageJson, writeLocalStorageJson } from "./browserLocalStorage.js";

// The colour theme is a per-browser convenience: "light" (the default),
// "dark", or "system" to follow the device setting.
const APPEARANCE_STORAGE_KEY = "vibe64.appearance";
const APPEARANCE_CHOICES = Object.freeze(["light", "dark", "system"]);

function readAppearance() {
  const value = readLocalStorageJson(APPEARANCE_STORAGE_KEY, "light");
  return APPEARANCE_CHOICES.includes(value) ? value : "light";
}

function writeAppearance(value) {
  if (APPEARANCE_CHOICES.includes(value)) writeLocalStorageJson(APPEARANCE_STORAGE_KEY, value);
}

export { APPEARANCE_CHOICES, readAppearance, writeAppearance };
