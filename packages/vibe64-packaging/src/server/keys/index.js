// Publishing keys locked with the person's passphrase: the age file format, the
// key store its caller places in a private folder, and the preflight check that
// a release has them unlocked. The caller owns where the store lives and who
// may unlock it.
import { definePreflightCheck } from "../preflight/index.js";

export { DEFAULT_WORK_FACTOR, MIN_PASSPHRASE, ageDecrypt, ageEncrypt } from "./age.js";
export { createAgeStore } from "./ageStore.js";

// The keys' own status ({ exists, unlocked }) arrives as `keys`.
export const publishingKeysUnlocked = definePreflightCheck({
  id: "publishing-keys-unlocked",
  label: "Publishing keys",
  severity: "block",
  applies: ({ plan }) => (plan?.targets || []).length > 0,
  run: ({ keys }) => keys?.unlocked
    ? { ok: true, message: "Unlocked for this release." }
    : { ok: false, message: keys?.exists ? "Unlock your publishing keys to check sign-ins and sign." : "Create your publishing keys first." }
});
