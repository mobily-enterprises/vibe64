import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const NON_LOGIN_SHELLS = new Set([
  "/bin/false",
  "/sbin/nologin",
  "/usr/bin/false",
  "/usr/sbin/nologin"
]);

const OBVIOUS_SERVICE_ACCOUNT_PATTERN =
  /^(?:_|adm|bin|daemon|games|lp|mail|man|messagebus|news|nobody|proxy|sync|sys|systemd-|uucp|www-data$|_apt$|backup$|list$|irc$|gnats$)/u;

function normalizeOsUsername(value = "") {
  return String(value || "").trim();
}

function assertSafeOsUsername(username = "") {
  const normalized = normalizeOsUsername(username);
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

// macOS has no getent: `dscacheutil -q user` prints "key: value" lines for
// each user, with a blank line between users.
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
  const result = await execFileFn(command, args, {
    encoding: "utf8"
  });
  return String((typeof result === "string" ? result : result?.stdout) || "");
}

function currentOsUser({
  homedir = os.homedir,
  userInfo = os.userInfo
} = {}) {
  const info = typeof userInfo === "function" ? userInfo() : {};
  const username = normalizeOsUsername(info?.username || process.env.USER || process.env.LOGNAME);
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

async function resolveOsUser(username = "", {
  execFileFn = execFile,
  platform = process.platform,
  readFileFn = readFile,
  userInfo = os.userInfo
} = {}) {
  const safeUsername = assertSafeOsUsername(username);
  if (platform === "linux" && !/^\d+$/u.test(safeUsername)) {
    // A successful first-source files lookup is authoritative under NSS's
    // default return rule. Read it asynchronously instead of forking the server.
    // Other source orders/actions and missing users still go through NSS.
    const config = await readFileFn("/etc/nsswitch.conf", "utf8").catch(() => "");
    const rules = [...config.matchAll(/^[\t ]*passwd[\t ]*:[\t ]*([^#\r\n]*)/gmu)];
    const sources = rules.length === 1 ? rules[0][1].trim().split(/\s+/u) : [];
    if (sources[0] === "files" && (sources.length === 1 || /^[a-z_][a-z0-9_-]*$/iu.test(sources[1]))) {
      const passwd = await readFileFn("/etc/passwd", "utf8").catch(() => "");
      const localUser = passwd.split(/\r?\n/u).map(parsePasswdLine).find((user) => user?.username === safeUsername);
      if (localUser) return localUser;
    }
  }
  let record;
  if (platform === "darwin") {
    const current = currentOsUser({ userInfo });
    if (current.username === safeUsername) return current;
    [record] = parseDscacheutilUsers(
      await commandOutput(execFileFn, "dscacheutil", ["-q", "user", "-a", "name", safeUsername])
    );
  } else {
    record = parsePasswdLine((await commandOutput(execFileFn, "getent", ["passwd", safeUsername])).split(/\r?\n/u)[0]);
  }
  if (!record || record.username !== safeUsername) {
    const error = new Error(`OS user was not found: ${safeUsername}`);
    error.code = "vibe64_os_user_not_found";
    throw error;
  }
  return record;
}

async function listOsUsers({
  execFileFn = execFile,
  platform = process.platform
} = {}) {
  const users = platform === "darwin"
    ? parseDscacheutilUsers(await commandOutput(execFileFn, "dscacheutil", ["-q", "user"]))
    : (await commandOutput(execFileFn, "getent", ["passwd"])).split(/\r?\n/u).map(parsePasswdLine).filter(Boolean);
  return users.sort((left, right) => left.username.localeCompare(right.username));
}

function osUserEligibility(user = {}, {
  extraServiceNames = []
} = {}) {
  const reasons = [];
  const username = normalizeOsUsername(user.username);
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
  if (extraServiceNames.map(normalizeOsUsername).includes(username)) {
    reasons.push("configured_service_account");
  }

  return {
    eligible: reasons.length === 0,
    reasons
  };
}

export {
  NON_LOGIN_SHELLS,
  assertSafeOsUsername,
  currentOsUser,
  listOsUsers,
  normalizeOsUsername,
  osUserEligibility,
  parsePasswdLine,
  resolveOsUser
};
