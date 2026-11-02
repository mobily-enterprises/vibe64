// What a person's command runs with: its allowed folders, its environment and PATH, the usage recorder
// preload, and environment files.

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";
import path from "node:path";
import process from "node:process";

import { HOST_SETTINGS_ROOT, safeUsername, workspaceFromDaemonUsername, workspaceTempRoot } from "./hostAccounts.js";
import { canonicalPath, openRootOwnedDirectory, readOwnedFile, relativePathParts } from "./hostFiles.js";

const ALLOWED_COMMANDS = new Set([
  "bash",
  "gh",
  "git"
]);
const SAFE_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const BLOCKED_ENV_NAMES = new Set([
  "BASH_ENV",
  "ENV",
  "GCONV_PATH",
  "GETCONF_DIR",
  "GLIBC_TUNABLES",
  "HOSTALIASES",
  "LOCALDOMAIN",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "LOCPATH",
  "MALLOC_TRACE",
  "NIS_PATH",
  "NLSPATH",
  "NODE_OPTIONS",
  "RESOLV_HOST_CONF",
  "RES_OPTIONS",
  "TZDIR"
]);
// The system folders root's own steps run with, and the PATH a person's command or service starts with when
// neither its caller nor the host's helper settings name one.
const SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
// The host's settings for this helper, in EnvironmentFile syntax and in a file only root can change: PATH, the
// folders commands and services start with when their caller names none, and VIBE64_APPLICATION_AREA_ROOT, the
// folder application accounts have their areas below. A missing file names neither.
const HELPER_SETTINGS_FILE = path.join(HOST_SETTINGS_ROOT, "exec-helper.env");
const HELPER_SETTINGS_LIMIT_BYTES = 16384;

function runUserCommand(targetUser, command, args, options) {
  // The caller's command PATH must only take effect after runuser drops root.
  // No new privileges: sudo, su and other setuid programs cannot raise the
  // person's command back above that person.
  return spawnSync("/usr/bin/setpriv", [
    "--no-new-privs", "--", "/usr/sbin/runuser",
    "-u", targetUser.username, "--", "/usr/bin/env", "--",
    `PATH=${options.env.PATH}`, command, ...args
  ], {
    ...options,
    env: { ...options.env, PATH: SYSTEM_PATH }
  });
}

function managedExecutionRuntimeBase(owner = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  return `/run/vibe64-${workspace}`;
}

function readEnvironmentFile(file = "") {
  return parseEnvironmentFile(readFileSync(file, "utf8"));
}

/**
 * The host's settings for this helper, or none when it has no settings file.
 * @param {string} [file]
 * @param {number} [ownerUid] the only account that may own the file and its folder
 * @returns {Record<string, string>}
 */
function helperSettings(file = HELPER_SETTINGS_FILE, ownerUid = 0) {
  let directory;
  try {
    directory = openRootOwnedDirectory(path.dirname(file), ownerUid);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  try {
    return parseEnvironmentFile(readOwnedFile(directory, path.basename(file), {
      maxBytes: HELPER_SETTINGS_LIMIT_BYTES, othersMayWrite: false, uid: ownerUid
    }));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  } finally {
    closeSync(directory);
  }
}

/**
 * The PATH commands and services start with when their caller names none: the host's, else the system folders.
 * @param {Record<string, string>} [settings]
 */
function helperCommandPath(settings = helperSettings()) {
  const configured = String(settings.PATH || "").trim();
  if (!configured) return SYSTEM_PATH;
  if (configured.split(":").some((folder) => !path.isAbsolute(folder))) {
    throw new Error("Vibe64 exec helper settings name a PATH folder that is not absolute.");
  }
  return configured;
}

// Release environment files keep systemd's EnvironmentFile= syntax: comment
// lines, NAME=value with surrounding blanks trimmed, single quotes taken
// literally, double quotes in which a backslash escapes only " \ ` $ and a line
// end, and outside quotes a backslash escaping the next character. Quoted and
// unquoted parts join, and an assignment whose name is not a valid environment
// name is skipped.
function parseEnvironmentFile(text = "") {
  const environment = {};
  const blank = (character) => " \t\n\r".includes(character);
  const lineEnd = (character) => character === "\n" || character === "\r";
  let state = "pre-key";
  let key = "";
  let value = "";
  let valueEnd = 0;
  const keep = (characters) => {
    value += characters;
    valueEnd = value.length;
  };
  const assign = () => {
    const name = key.trim();
    if (SAFE_ENV_NAME_PATTERN.test(name)) environment[name] = value.slice(0, valueEnd);
    key = "";
    value = "";
    valueEnd = 0;
    state = "pre-key";
  };
  for (const character of String(text)) {
    if (state === "pre-key") {
      if (character === "#" || character === ";") state = "comment";
      else if (!blank(character)) {
        key = character;
        state = "key";
      }
    } else if (state === "key") {
      if (lineEnd(character)) {
        key = "";
        state = "pre-key";
      } else if (character === "=") state = "pre-value";
      else key += character;
    } else if (state === "pre-value" || state === "value") {
      if (lineEnd(character)) assign();
      else if (character === "\\") state = "value-escape";
      else if (state === "pre-value" && character === "'") state = "single";
      else if (state === "pre-value" && character === "\"") state = "double";
      else if (!blank(character)) {
        keep(character);
        state = "value";
      } else if (state === "value") value += character;
    } else if (state === "value-escape") {
      if (!lineEnd(character)) keep(character);
      state = "value";
    } else if (state === "single") {
      if (character === "'") state = "pre-value";
      else keep(character);
    } else if (state === "double") {
      if (character === "\"") state = "pre-value";
      else if (character === "\\") state = "double-escape";
      else keep(character);
    } else if (state === "double-escape") {
      if ("\"\\`$".includes(character)) keep(character);
      else if (!lineEnd(character)) keep(`\\${character}`);
      state = "double";
    } else if (state === "comment") {
      if (character === "\\") state = "comment-escape";
      else if (lineEnd(character)) state = "pre-key";
    } else {
      state = "comment";
    }
  }
  if (state !== "pre-key" && state !== "key" && state !== "comment" && state !== "comment-escape") assign();
  return environment;
}

function resolveAllowedCwd(cwd = "", ownerUsername = "", {
  operation = "",
  targetUser = {}
} = {}) {
  if (operation === "health-status") {
    return workspaceTempRoot(ownerUsername);
  }
  if (operation === "workspace-cache-command") {
    const root = path.join(targetUser.home, ".local/state/vibe64/cache-maintenance");
    const resolved = canonicalPath(cwd);
    const parts = relativePathParts(root, resolved);
    if (targetUser.username !== ownerUsername || canonicalPath(root) !== root || resolved !== cwd ||
        parts.length !== 1 || !/^[a-z][a-z0-9-]*-[A-Za-z0-9]{6}$/u.test(parts[0])) {
      throw new Error("Cache maintenance requires an owned workspace scratch directory.");
    }
    return resolved;
  }
  const normalized = String(cwd || "").trim();
  if (!normalized) {
    return "/";
  }
  if (
    operation === "account-auth-terminal" ||
    operation === "account-status" ||
    operation === "github-api-command"
  ) {
    return resolveAllowedUserHomePath(normalized, targetUser);
  }
  if (
    operation === "vibe64-command" &&
    targetUser.username === ownerUsername
  ) {
    const resolved = canonicalPath(normalized);
    const ownerProjectStateRoot = path.join(
      targetUser.home,
      ".local",
      "state",
      "vibe64",
      "projects"
    );
    if (existsSync(ownerProjectStateRoot)) {
      const stateRoot = canonicalPath(ownerProjectStateRoot);
      if (resolved === stateRoot || resolved.startsWith(`${stateRoot}${path.sep}`)) {
        return resolved;
      }
    }
    const ownerColleagueRoot = path.join(targetUser.home, ".local", "state", "vibe64", "colleague");
    if (existsSync(ownerColleagueRoot)) {
      const parts = relativePathParts(canonicalPath(ownerColleagueRoot), resolved);
      const scope = parts.at(-1) || "";
      const learnThread = parts.length === 4 && parts[1] === "learn" &&
        /^(lobby|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u.test(parts[2]);
      // Develop: <learner>/<scope>. Learn threads keep their runtime beside
      // their file: <learner>/learn/<attemptId|lobby>/<scope>.
      if ((parts.length === 2 || learnThread) && /^[A-Za-z0-9_-]+$/u.test(parts[0]) && /^colleague_[a-f0-9]{32}$/u.test(scope)) {
        return resolved;
      }
    }
    // Official Learning catalogue/topic sources are fetched into one exact
    // private scratch directory beside the training namespace, then verified.
    const ownerTrainingSourcesRoot = path.join(targetUser.home, ".local", "state", "vibe64", "training-sources");
    if (existsSync(ownerTrainingSourcesRoot)) {
      const parts = relativePathParts(canonicalPath(ownerTrainingSourcesRoot), resolved);
      if (parts.length === 1 && /^(catalogue|topic)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(parts[0])) {
        return resolved;
      }
    }
  }
  if (operation === "codex-app-server" || operation === "opencode-app-server") {
    const resolved = canonicalPath(normalized);
    const targetUid = Number(targetUser.uid);
    const runtimeBases = [managedExecutionRuntimeBase({ username: ownerUsername })];
    if (Number.isSafeInteger(targetUid) && targetUid >= 0) {
      runtimeBases.push(path.join("/run/user", String(targetUid)));
    }
    for (const runtimeBase of runtimeBases) {
      const runtimeRootPath = path.join(runtimeBase, "vibe64", "agent-providers");
      if (!existsSync(runtimeRootPath)) continue;
      const runtimeRoot = canonicalPath(runtimeRootPath);
      const parts = relativePathParts(runtimeRoot, resolved);
      const providerRoot = parts[0];
      const allowedProviderRoot = operation === "opencode-app-server"
        ? providerRoot === "opencode"
        : providerRoot === "codex-app-server" ||
          /^codex-app-server-[a-f0-9]{12}$/u.test(providerRoot);
      const exactCodexRoot = operation === "codex-app-server" && parts.length === 1;
      const exactProviderWorkspace = parts.length === 2 && parts[1] === "workspace";
      if (allowedProviderRoot && (exactCodexRoot || exactProviderWorkspace)) {
        return resolved;
      }
    }
  }
  return resolveAllowedProjectPath(normalized, ownerUsername);
}

function resolveAllowedProjectPath(candidatePath = "", ownerUsername = "") {
  const normalized = String(candidatePath || "").trim();
  if (!normalized) {
    throw new Error("Vibe64 exec helper rejected an empty managed project path.");
  }
  const resolved = canonicalPath(normalized);
  const allowedProjectsRoot = canonicalPath(path.join("/var/lib/vibe64", workspaceFromDaemonUsername(ownerUsername), "projects"));
  if (resolved.startsWith(`${allowedProjectsRoot}${path.sep}`)) {
    return resolved;
  }
  throw new Error("Vibe64 exec helper rejected a command path outside the owner project root.");
}

function resolveAllowedUserHomePath(candidatePath = "", targetUser = {}) {
  const normalized = String(candidatePath || "").trim();
  const home = String(targetUser.home || "").trim();
  if (!normalized || !home) {
    throw new Error("Vibe64 exec helper rejected an empty user command path.");
  }
  const resolved = canonicalPath(normalized);
  const allowedHome = canonicalPath(home);
  if (resolved === allowedHome || resolved.startsWith(`${allowedHome}${path.sep}`)) {
    return resolved;
  }
  throw new Error("Vibe64 exec helper rejected a command path outside the target user home.");
}

// The only NODE_OPTIONS this helper sets: a usage recording launch's preload,
// accepted as a regular file reached through no symbolic link inside the
// recorder runtime of the installation this helper belongs to: the usage
// recording package beside the helper's own package, or in a node_modules
// folder above the helper's real location.
function usageRecordingNodeOptions(preload = "", helperPath = process.argv[1]) {
  const requested = String(preload);
  try {
    const helper = realpathSync(helperPath);
    const candidates = [path.resolve(path.dirname(helper), "../../../vibe64-usage-recording/runtime/node")];
    for (let directory = path.dirname(helper); ; directory = path.dirname(directory)) {
      candidates.push(path.join(directory, "node_modules/@local/vibe64-usage-recording/runtime/node"));
      if (path.dirname(directory) === directory) break;
    }
    const roots = candidates.filter((candidate) => existsSync(candidate)).map((candidate) => realpathSync(candidate));
    if (path.isAbsolute(requested) && !/[\s"'\\]/u.test(requested) && path.resolve(requested) === requested &&
        realpathSync(requested) === requested && statSync(requested).isFile() &&
        roots.some((root) => requested.startsWith(`${root}${path.sep}`))) {
      return `--import=${requested}`;
    }
  } catch {
    // Refused below like any other path.
  }
  throw new Error("Vibe64 exec helper rejected a usage recording preload outside its runtime.");
}

function helperChildEnv(input = {}, targetUser = {}, ownerUsername = "", operation = "") {
  const env = {
    TERM: process.env.TERM || "xterm-256color"
  };
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_ENV_NAME_PATTERN.test(key) || BLOCKED_ENV_NAMES.has(key) || key.startsWith("LD_") || key.startsWith("DYLD_")) {
      continue;
    }
    env[key] = String(value);
  }
  // Read only when the caller names no PATH: a release runner, inside its sandbox, cannot read the settings.
  env.PATH ||= helperCommandPath();
  if (operation === "opencode-app-server") {
    const providerRoot = path.join(
      managedExecutionRuntimeBase({ username: ownerUsername }),
      "vibe64",
      "agent-providers",
      "opencode"
    );
    for (const name of [
      "HOME",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME"
    ]) {
      const requested = String(input[name] || "").trim();
      if (!path.isAbsolute(requested) || relativePathParts(providerRoot, requested).length === 0) {
        throw new Error(`Vibe64 exec helper rejected OpenCode ${name} outside its provider runtime.`);
      }
      env[name] = path.resolve(requested);
    }
  } else {
    env.HOME = targetUser.home;
    env.XDG_CACHE_HOME = path.join(targetUser.home, ".cache");
    env.XDG_CONFIG_HOME = path.join(targetUser.home, ".config");
    env.XDG_DATA_HOME = path.join(targetUser.home, ".local", "share");
  }
  env.LOGNAME = targetUser.username;
  env.USER = targetUser.username;
  // An application has its own private temporary directory, and no access to
  // the workspace's.
  env.TMPDIR = targetUser.application ? "/tmp" : workspaceTempRoot(ownerUsername);
  return env;
}

export {
  ALLOWED_COMMANDS,
  helperChildEnv,
  helperCommandPath,
  helperSettings,
  managedExecutionRuntimeBase,
  parseEnvironmentFile,
  readEnvironmentFile,
  resolveAllowedCwd,
  resolveAllowedUserHomePath,
  runUserCommand,
  usageRecordingNodeOptions
};
