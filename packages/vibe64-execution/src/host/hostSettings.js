// Where the helper keeps what it makes outside its own folders: the accounts it adds and how they are numbered,
// the service units it installs and the staging keys and sudo rules it writes. Each goes to the system's own place unless
// the host's helper settings (exec-helper.env) name another, for a host whose system files are not where it keeps
// them or cannot be written. The same settings may name the command its later runs start it with.

import path from "node:path";
import process from "node:process";

import { helperSettings } from "./commandEnvironment.js";
import { HOST_SETTINGS_ROOT } from "./hostAccounts.js";

const ACCOUNT_DATABASES = Object.freeze(["files", "extrausers"]);
// systemd's folder for the system's own units, and sudo's for added rules.
const SYSTEMD_UNIT_ROOT = "/etc/systemd/system";
const SUDOERS_ROOT = "/etc/sudoers.d";
// The folder host setup's SSH policy names for staging accounts' keys.
const STAGING_KEYS_ROOT = path.join(HOST_SETTINGS_ROOT, "staging-ssh");
// A command a sudo rule, a unit's ExecStart and a shell function each name as it is: an absolute path whose parts
// hold no character any of them would read as more than a name.
const COMMAND_PATH_PATTERN = /^(?:\/[A-Za-z0-9._+-]+)+$/u;

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

// The login.defs keys each band sets for useradd and groupadd: its first and last number for accounts and groups.
const NUMBER_BANDS = Object.freeze([
  ["VIBE64_SYSTEM_ID_BAND", ["SYS_UID_MIN", "SYS_UID_MAX", "SYS_GID_MIN", "SYS_GID_MAX"]],
  ["VIBE64_PERSON_ID_BAND", ["UID_MIN", "UID_MAX", "GID_MIN", "GID_MAX"]]
]);

/**
 * How the helper numbers the accounts it adds, as useradd options: by the system's own ranges, unless the host's
 * helper settings name bands, `FIRST-LAST`, for system accounts and groups (`VIBE64_SYSTEM_ID_BAND`) and for people
 * (`VIBE64_PERSON_ID_BAND`). A host names them when its system's own accounts can change without seeing the
 * helper's (an image-based system updated by replacing its image), so the two never share a number.
 * @param {Record<string, string>} [settings] the host's helper settings
 * @returns {string[]}
 */
function helperAccountNumberOptions(settings = helperSettings()) {
  return NUMBER_BANDS.flatMap(([name, [accountFirst, accountLast, groupFirst, groupLast]]) => {
    const configured = String(settings[name] || "").trim();
    if (!configured) return [];
    const match = /^([1-9][0-9]{0,4})-([1-9][0-9]{0,4})$/u.exec(configured);
    const [first, last] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
    if (!match || first > last || last >= 65534) {
      throw new Error(`This host's Vibe64 exec helper settings name a band of account numbers (${name}) that is not ` +
        "FIRST-LAST with FIRST no greater than LAST and both below 65534.");
    }
    return ["-K", `${accountFirst}=${first}`, "-K", `${accountLast}=${last}`,
      "-K", `${groupFirst}=${first}`, "-K", `${groupLast}=${last}`];
  });
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

/**
 * The folder the helper writes staging accounts' staging keys to, one file per account: the one host setup's
 * SSH policy names, unless the host's helper settings name another (`VIBE64_STAGING_KEYS_ROOT`), one the host's
 * sshd reads each account's keys from by its name.
 * @param {Record<string, string>} [settings] the host's helper settings
 */
function helperStagingKeysRoot(settings = helperSettings()) {
  return settingsFolder(settings, "VIBE64_STAGING_KEYS_ROOT", STAGING_KEYS_ROOT);
}

/**
 * How the helper's later runs start it: the staging sudo rule and the staging shell's commands, staging-enter,
 * staging units' ExecStart and managed runs. It is the file the helper runs from, unless the host's helper settings
 * name the command the host starts it with (`VIBE64_EXEC_HELPER_COMMAND`): a host that starts it through a
 * launcher, which names the settings folder (`VIBE64_HOST_SETTINGS_ROOT`), names that launcher, so a later run
 * reads the same folder.
 * @param {Record<string, string>} [settings] the host's helper settings
 * @param {string} [running] the file the helper runs from
 */
function helperCommand(settings = helperSettings(), running = process.argv[1]) {
  const configured = String(settings.VIBE64_EXEC_HELPER_COMMAND || "").trim();
  if (!configured) return path.resolve(running);
  if (!COMMAND_PATH_PATTERN.test(configured) || path.resolve(configured) !== configured) {
    throw new Error("This host's Vibe64 exec helper settings name a helper command (VIBE64_EXEC_HELPER_COMMAND) that " +
      "is not an absolute, normalized path of letters, digits and . _ + - alone.");
  }
  return configured;
}

export {
  helperAccountDatabase,
  helperAccountNumberOptions,
  helperCommand,
  helperStagingKeysRoot,
  helperSudoersRoot,
  helperSystemdUnitRoot,
  SYSTEMD_UNIT_ROOT
};
