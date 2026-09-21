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

function parsePasswdLine(line = "") {
  const parts = String(line || "").trim().split(":");
  if (parts.length < 7 || !/^\d+$/u.test(parts[2]) || !/^\d+$/u.test(parts[3])) {
    return null;
  }
  const uid = Number(parts[2]);
  const gid = Number(parts[3]);
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) {
    return null;
  }
  return {
    displayName: String(parts[4] || "").split(",")[0],
    gid,
    home: String(parts[5] || ""),
    shell: String(parts[6] || ""),
    uid,
    username: String(parts[0] || "")
  };
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
  readFileFn = readFile
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
  const result = await execFileFn("getent", ["passwd", safeUsername], {
    encoding: "utf8"
  });
  const stdout = typeof result === "string" ? result : result?.stdout;
  const record = parsePasswdLine(String(stdout || "").split(/\r?\n/u)[0]);
  if (!record || record.username !== safeUsername) {
    const error = new Error(`OS user was not found: ${safeUsername}`);
    error.code = "vibe64_os_user_not_found";
    throw error;
  }
  return record;
}

async function listOsUsers({
  execFileFn = execFile
} = {}) {
  const result = await execFileFn("getent", ["passwd"], {
    encoding: "utf8"
  });
  const stdout = typeof result === "string" ? result : result?.stdout;
  return String(stdout || "")
    .split(/\r?\n/u)
    .map(parsePasswdLine)
    .filter(Boolean)
    .sort((left, right) => left.username.localeCompare(right.username));
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
