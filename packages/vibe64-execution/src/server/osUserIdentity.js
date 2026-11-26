import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

import { execFileCommand } from "./engines/commandSpawner.js";

const NON_LOGIN_SHELLS = new Set([
  "/bin/false",
  "/sbin/nologin",
  "/usr/bin/false",
  "/usr/sbin/nologin"
]);

const OBVIOUS_SERVICE_ACCOUNT_PATTERN =
  /^(?:_|adm|bin|daemon|games|lp|mail|man|messagebus|news|nobody|proxy|sync|sys|systemd-|uucp|www-data$|_apt$|backup$|list$|irc$|gnats$)/u;

function assertSafeOsUsername(username = "") {
  const normalized = normalizeText(username);
  if (!normalized || normalized.includes("/") || normalized.includes("\\") || normalized.includes(":")) {
    const error = new Error("A valid OS username is required.");
    error.code = "vibe64_invalid_os_username";
    throw error;
  }
  return normalized;
}

function osUserRecord([username, uid, gid, gecos, home, shell] = []) {
  if (!/^\d+$/u.test(uid) || !/^\d+$/u.test(gid)) {
    return null;
  }
  const numericUid = Number(uid);
  const numericGid = Number(gid);
  if (!Number.isSafeInteger(numericUid) || !Number.isSafeInteger(numericGid)) {
    return null;
  }
  return {
    displayName: String(gecos || "").split(",")[0],
    gid: numericGid,
    home: String(home || ""),
    shell: String(shell || ""),
    uid: numericUid,
    username: String(username || "")
  };
}

function parsePasswdLine(line = "") {
  const parts = String(line || "").trim().split(":");
  if (parts.length < 7) {
    return null;
  }
  return osUserRecord([parts[0], parts[2], parts[3], parts[4], parts[5], parts[6]]);
}

/**
 * macOS has no getent: `dscacheutil -q user` prints "key: value" lines for
 * each user, with a blank line between users.
 */
function parseDscacheutilUsers(text = "") {
  return String(text || "")
    .split(/\r?\n[\t ]*\r?\n/u)
    .map((block) => {
      const fields = {};
      for (const line of block.split(/\r?\n/u)) {
        const match = /^\s*([a-z]+):\s?(.*)$/u.exec(line);
        if (match) fields[match[1]] = match[2].trim();
      }
      return osUserRecord([fields.name, fields.uid, fields.gid, fields.gecos, fields.dir, fields.shell]);
    })
    .filter(Boolean);
}

async function commandOutput(execFileFn, command, args) {
  // The account tools run with the server's own environment, as they always have.
  const result = await execFileFn(command, args, {
    encoding: "utf8",
    env: process.env
  });
  return String((typeof result === "string" ? result : result?.stdout) || "");
}

function currentOsUser({
  homedir = os.homedir,
  userInfo = os.userInfo
} = {}) {
  const info = userInfo();
  const username = normalizeText(info?.username || process.env.USER || process.env.LOGNAME);
  const home = path.resolve(String(info?.homedir || homedir() || ""));
  return {
    displayName: String(info?.username || username),
    gid: Number.isSafeInteger(info?.gid) ? info.gid : null,
    home,
    shell: String(info?.shell || ""),
    uid: Number.isSafeInteger(info?.uid) ? info.uid : null,
    username
  };
}

// The NSS passwd sources whose records are a plain passwd file this process can read: the system's files, and the
// extra users database (libnss-extrausers) a host keeps its workspace accounts in.
const PASSWD_SOURCE_FILES = Object.freeze({ files: "/etc/passwd", extrausers: "/var/lib/extrausers/passwd" });
const NSSWITCH_FILE = "/etc/nsswitch.conf";
// Each reader's parsed files, by path, while the file's identity (device, inode, size, change times) stays the same.
const parsedFiles = new WeakMap();

/**
 * A file's parsed contents, read again only when the file changed or was replaced; null when there is no such file.
 * Any other failure to read it rejects.
 */
async function parsedFile(file, parse, { readFileFn, statFn }) {
  let info;
  try {
    info = await statFn(file, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  if (!parsedFiles.has(readFileFn)) parsedFiles.set(readFileFn, new Map());
  const files = parsedFiles.get(readFileFn);
  const cached = files.get(file);
  if (cached?.identity === identity) return cached.value;
  const value = readFileFn(file, "utf8").then(parse);
  files.set(file, { identity, value });
  value.catch(() => {
    if (files.get(file)?.value === value) files.delete(file);
  });
  return value;
}

/** The passwd sources of nsswitch.conf's one passwd line, in order, or null when it has none or several. */
function passwdSources(config = "") {
  const rules = [...String(config).matchAll(/^[\t ]*passwd[\t ]*:[\t ]*([^#\r\n]*)/gmu)];
  return rules.length === 1 ? rules[0][1].trim().split(/\s+/u).filter(Boolean) : null;
}

/** A passwd file's records by username; a name whose record cannot be read is kept as null. */
function passwdUsers(text = "") {
  const users = new Map();
  for (const line of String(text).split(/\r?\n/u)) {
    const name = line.trim().split(":")[0];
    if (!name || users.has(name)) continue;
    users.set(name, parsePasswdLine(line));
  }
  return users;
}

/**
 * The user from the passwd files NSS consults first, as NSS answers by its default actions: the first source with
 * the user returns it, a source without it hands on to the next. Undefined when NSS itself must answer: a source
 * this process cannot read (sss, ldap, systemd, compat, ...) comes before the user is found, a source carries its own
 * action, a record is unreadable, or nsswitch.conf has no single passwd line. Null when every source was read and
 * none has the user.
 */
async function passwdFileUser(username, files) {
  const sources = passwdSources(await parsedFile(NSSWITCH_FILE, (text) => text, files) ?? "");
  if (!sources?.length) return undefined;
  for (const [index, source] of sources.entries()) {
    const file = Object.hasOwn(PASSWD_SOURCE_FILES, source) ? PASSWD_SOURCE_FILES[source] : "";
    if (!file || sources[index + 1]?.startsWith("[")) return undefined;
    const users = await parsedFile(file, passwdUsers, files);
    if (!users?.has(username)) continue;
    return users.get(username) || undefined;
  }
  return null;
}

async function resolveOsUser(username = "", {
  execFileFn = execFileCommand,
  platform = process.platform,
  readFileFn = readFile,
  statFn = stat,
  userInfo = os.userInfo
} = {}) {
  const safeUsername = assertSafeOsUsername(username);
  if (platform === "linux" && !/^\d+$/u.test(safeUsername)) {
    // Every request resolves its person's account, so the passwd files NSS reads are read here, asynchronously
    // and once per change, instead of forking getent for each: on a host whose workspace accounts live in the extra
    // users database, that fork ran about 20 times a second. NSS still answers what these files cannot.
    const localUser = await passwdFileUser(safeUsername, { readFileFn, statFn }).catch(() => undefined);
    if (localUser) return localUser;
    if (localUser === null) throw osUserNotFound(safeUsername);
  }
  let record;
  if (platform === "darwin") {
    const current = currentOsUser({ userInfo });
    if (current.username === safeUsername) return current;
    [record] = parseDscacheutilUsers(
      await commandOutput(execFileFn, "dscacheutil", ["-q", "user", "-a", "name", safeUsername])
    );
  } else {
    // getent exits 2 when the database has no such key: a missing user, not a failure.
    const passwd = await commandOutput(execFileFn, "getent", ["passwd", safeUsername]).catch((error) => {
      if (error?.code === 2) return "";
      throw error;
    });
    record = parsePasswdLine(passwd.split(/\r?\n/u)[0]);
  }
  if (!record || record.username !== safeUsername) throw osUserNotFound(safeUsername);
  return record;
}

function osUserNotFound(username) {
  const error = new Error(`OS user was not found: ${username}`);
  error.code = "vibe64_os_user_not_found";
  return error;
}

async function listOsUsers({
  execFileFn = execFileCommand,
  platform = process.platform
} = {}) {
  const users = platform === "darwin"
    ? parseDscacheutilUsers(await commandOutput(execFileFn, "dscacheutil", ["-q", "user"]))
    : (await commandOutput(execFileFn, "getent", ["passwd"])).split(/\r?\n/u).map(parsePasswdLine).filter(Boolean);
  return users.sort((left, right) => left.username.localeCompare(right.username));
}

function osUserEligibility(user = {}, options = {}) {
  const {
    extraServiceNames = []
  } = options;
  const reasons = [];
  const username = normalizeText(user.username);
  const shell = String(user.shell || "").trim();
  const home = String(user.home || "").trim();

  if (!username) {
    reasons.push("missing_username");
  }
  if (!home || !path.isAbsolute(home)) {
    reasons.push("missing_home");
  }
  if (shell && NON_LOGIN_SHELLS.has(shell)) {
    reasons.push("non_login_shell");
  }
  if (OBVIOUS_SERVICE_ACCOUNT_PATTERN.test(username)) {
    reasons.push("obvious_service_account");
  }
  if (extraServiceNames.map(normalizeText).includes(username)) {
    reasons.push("configured_service_account");
  }

  return {
    eligible: reasons.length === 0,
    reasons
  };
}

const __testables = Object.freeze({ parsePasswdLine });

export {
  assertSafeOsUsername,
  currentOsUser,
  listOsUsers,
  normalizeText as normalizeOsUsername,
  osUserEligibility,
  resolveOsUser,
  __testables
};
