// Where the helper keeps the accounts it adds: the system's own account files, unless the host's helper settings
// (exec-helper.env) name the extra users database, for a host whose system files cannot be written.

import { helperSettings } from "./commandEnvironment.js";

const ACCOUNT_DATABASES = Object.freeze(["files", "extrausers"]);

/**
 * The account database the helper adds accounts and group memberships to: the system's own files, or the extra users
 * database (libnss-extrausers) when the host's helper settings say `VIBE64_ACCOUNT_DATABASE=extrausers`.
 * @param {Record<string, string>} [settings] the host's helper settings
 * @returns {"files" | "extrausers"}
 */
function helperAccountDatabase(settings = helperSettings()) {
  const configured = String(settings.VIBE64_ACCOUNT_DATABASE || "").trim() || "files";
  if (!ACCOUNT_DATABASES.includes(configured)) {
    throw new Error("This host's Vibe64 exec helper settings name an unknown account database " +
      "(VIBE64_ACCOUNT_DATABASE): it is files or extrausers.");
  }
  return configured;
}

/**
 * How the helper numbers the system accounts and groups it adds, as useradd options: by the system's own range,
 * unless the host's helper settings name a band, `FIRST-LAST` (`VIBE64_SYSTEM_ID_BAND`). A host names one when its
 * system's own accounts can change without seeing the helper's (an image-based system updated by replacing its
 * image), so the two never share a number.
 * @param {Record<string, string>} [settings] the host's helper settings
 * @returns {string[]}
 */
function helperAccountNumberOptions(settings = helperSettings()) {
  const configured = String(settings.VIBE64_SYSTEM_ID_BAND || "").trim();
  if (!configured) return [];
  const match = /^([1-9][0-9]{0,4})-([1-9][0-9]{0,4})$/u.exec(configured);
  const [first, last] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (!match || first > last || last >= 65534) {
    throw new Error("This host's Vibe64 exec helper settings name a band of account numbers (VIBE64_SYSTEM_ID_BAND) " +
      "that is not FIRST-LAST with FIRST no greater than LAST and both below 65534.");
  }
  // login.defs' keys for useradd's system accounts and the group each gets.
  return ["-K", `SYS_UID_MIN=${first}`, "-K", `SYS_UID_MAX=${last}`,
    "-K", `SYS_GID_MIN=${first}`, "-K", `SYS_GID_MAX=${last}`];
}

export {
  helperAccountDatabase,
  helperAccountNumberOptions
};
