// Where the helper keeps what it makes outside its own folders: the accounts it adds and how they are numbered,
// the service units it installs and the staging sudo rules it writes. Each goes to the system's own place unless
// the host's helper settings (exec-helper.env) name another, for a host whose system files are not where it keeps
// them or cannot be written.

import path from "node:path";

import { helperSettings } from "./commandEnvironment.js";

const ACCOUNT_DATABASES = Object.freeze(["files", "extrausers"]);
// systemd's folder for the system's own units, and sudo's for added rules.
const SYSTEMD_UNIT_ROOT = "/etc/systemd/system";
const SUDOERS_ROOT = "/etc/sudoers.d";

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

function settingsFolder(settings, name, fallback) {
  const configured = String(settings[name] || "").trim();
  if (!configured) return fallback;
  if (!path.isAbsolute(configured) || path.resolve(configured) !== configured || configured === "/") {
    throw new Error(`This host's Vibe64 exec helper settings name a folder (${name}) that is not an absolute ` +
      "path other than /.");
  }
  return configured;
}

/**
 * The folder the helper writes release and managed service units to: systemd's own, unless the host's helper
 * settings name another (`VIBE64_SYSTEMD_UNIT_ROOT`). systemd does not look there, so the helper links each unit
 * it installs into systemd's runtime folder, and `relink-units` links them all again after a restart.
 * @param {Record<string, string>} [settings] the host's helper settings
 */
function helperSystemdUnitRoot(settings = helperSettings()) {
  return settingsFolder(settings, "VIBE64_SYSTEMD_UNIT_ROOT", SYSTEMD_UNIT_ROOT);
}

/**
 * The folder the helper writes staging sudo rules to: sudo's own, unless the host's helper settings name another
 * (`VIBE64_SUDOERS_ROOT`), which the host's sudo configuration then includes.
 * @param {Record<string, string>} [settings] the host's helper settings
 */
function helperSudoersRoot(settings = helperSettings()) {
  return settingsFolder(settings, "VIBE64_SUDOERS_ROOT", SUDOERS_ROOT);
}

export {
  helperAccountDatabase,
  helperAccountNumberOptions,
  helperSudoersRoot,
  helperSystemdUnitRoot,
  SYSTEMD_UNIT_ROOT
};
