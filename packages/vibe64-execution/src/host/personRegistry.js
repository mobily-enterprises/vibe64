// The people a workspace may act as: their root-owned registrations, and the account checks that refuse an
// administrator.

import { spawnSync } from "node:child_process";
import {
  closeSync,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  addUserToGroup,
  assertEnabledForVibe64,
  assertHumanUsername,
  createSystemUser,
  DAEMON_USERNAME_PREFIX,
  ensureGroup,
  HOST_SETTINGS_ROOT,
  MANAGED_USERNAME_PATTERN,
  MEMBERSHIP_DIRECTORY,
  MEMBERSHIP_LIMIT_BYTES,
  osGroupNames,
  resolveOsUser,
  resolveOwnerUser,
  VIBE64_GROUP
} from "./hostAccounts.js";
import {
  DIRECTORY_NO_FOLLOW,
  directoryEntryName,
  makeDirectory,
  NEW_FILE_NO_FOLLOW,
  openDirectoryBelow,
  openedPath,
  openRootOwnedDirectory,
  readOwnedFile
} from "./hostFiles.js";

const PERSON_REGISTRY_ROOT = path.join(HOST_SETTINGS_ROOT, "people");
const PERSON_REGISTRATION_SCHEMA = "vibe64.person-registration";
const REGISTRATION_LIMIT_BYTES = 4096;
const PERSON_REFUSED_EXIT_CODE = 3;
// The host's own narrow sudo commands for its people, one per line exactly as
// `sudo -l` prints them, in a file only root can change.
const PERSON_SUDO_COMMANDS_FILE = "/etc/vibe64/person-sudo-commands";
// Members of these groups administer the host or can become root without sudo:
// through the group's own files or devices (disk, kmem, root, shadow, staff's
// /usr/local), a container or VM daemon (docker, incus, libvirt, lxd), or the
// administrators' logs (adm).
const ADMINISTRATOR_GROUPS = new Set([
  "adm",
  "admin",
  "disk",
  "docker",
  "incus",
  "incus-admin",
  "kmem",
  "libvirt",
  "lxd",
  "root",
  "shadow",
  "staff",
  "sudo",
  "wheel"
]);

// The daemon may create a new person, whom the helper then registers, or
// re-enable a person root already registered. It can never make an existing
// account a person merely by naming it.
function handleUserManagementOperation(operation = "", payload = {}, username = "") {
  assertHumanUsername(username);
  const workspace = personWorkspace(resolveOwnerUser());
  ensureGroup(VIBE64_GROUP);
  if (operation === "create-system-user") {
    createSystemUser(username, String(payload.password || ""));
    registerPerson(workspace, username);
    return;
  }
  enablePerson(workspace, username);
}

function enablePerson(workspace = "", username = "", {
  addToGroup = (name) => addUserToGroup(name, VIBE64_GROUP),
  resolveUser = resolveOsUser,
  ...options
} = {}) {
  assertRegisteredPerson(workspace, resolveUser(username), options);
  addToGroup(username);
}

// The people of a workspace are the accounts root registered for it, one file
// each below a root-owned directory its daemon cannot write. Root-side host
// setup and this helper's own account creation register them; the daemon's
// own state only says which of them it currently enables.
function personWorkspace(owner = {}) {
  const username = String(owner.username || "");
  if (!username.startsWith(DAEMON_USERNAME_PREFIX)) {
    throw new Error("Only a workspace daemon acts as its people.");
  }
  return personWorkspaceName(username.slice(DAEMON_USERNAME_PREFIX.length));
}

function personWorkspaceName(workspace = "") {
  if (!/^[a-z][a-z0-9]{0,62}$/u.test(String(workspace))) {
    throw new Error("Vibe64 exec helper rejected an invalid workspace name.");
  }
  return workspace;
}

// Opens one workspace's directory of a registry (its people or its
// applications), never through a link, and only when it and the registry root
// are root's own and writable by no one else.
function openRegistry(workspace = "", {
  create = false,
  registryRoot = "",
  registryUid = 0
} = {}) {
  if (create) {
    mkdirSync(registryRoot, { mode: 0o755, recursive: true });
  }
  const root = openRootOwnedDirectory(registryRoot, registryUid);
  try {
    const name = directoryEntryName(workspace);
    if (create) {
      makeDirectory(openedPath(root, name), 0o755);
    }
    return openRootOwnedDirectory(openedPath(root, name), registryUid);
  } finally {
    closeSync(root);
  }
}

// A registration that cannot be read as root's own private regular file is no
// registration.
function readPersonRegistration(workspace = "", username = "", options = {}) {
  const registryUid = options.registryUid ?? 0;
  let directory;
  try {
    directory = openRegistry(workspace, { registryRoot: PERSON_REGISTRY_ROOT, ...options });
  } catch {
    return null;
  }
  try {
    const record = JSON.parse(readOwnedFile(directory, `${username}.json`, {
      maxBytes: REGISTRATION_LIMIT_BYTES,
      othersMayWrite: false,
      uid: registryUid
    }));
    return record?.schema === PERSON_REGISTRATION_SCHEMA && record.schemaVersion === 1 &&
      record.username === username && Number.isSafeInteger(record.uid)
      ? { uid: record.uid, username }
      : null;
  } catch {
    return null;
  } finally {
    closeSync(directory);
  }
}

// Root writes a registration whole, under its account's name, in a registry
// directory it holds open.
function writeRegistration(directory, record = {}) {
  const name = `${directoryEntryName(record.username)}.json`;
  const temporary = `.${name}.${process.pid}.tmp`;
  const descriptor = openSync(openedPath(directory, temporary), NEW_FILE_NO_FOLLOW, 0o644);
  try {
    fchmodSync(descriptor, 0o644);
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`);
  } finally {
    closeSync(descriptor);
  }
  renameSync(openedPath(directory, temporary), openedPath(directory, name));
}

function writePersonRegistration(directory, user = {}) {
  writeRegistration(directory, {
    schema: PERSON_REGISTRATION_SCHEMA,
    schemaVersion: 1,
    uid: user.uid,
    username: user.username
  });
}

function personRefusal(message = "") {
  return Object.assign(new Error(message), { exitCode: PERSON_REFUSED_EXIT_CODE });
}

// The login range, not system accounts: login.defs' UID_MIN..UID_MAX.
function loginUidRange(loginDefs = "") {
  const value = (name, fallback) => {
    const match = new RegExp(`^[\\t ]*${name}[\\t ]+(\\d+)[\\t ]*$`, "mu").exec(String(loginDefs));
    return match ? Number(match[1]) : fallback;
  };
  return { max: value("UID_MAX", 60000), min: value("UID_MIN", 1000) };
}

// Why the helper must never act as this account, or "" for a person's
// ordinary login. Acting as an administrator would hand the daemon that power
// whatever confines the command itself: the account's own files (its SSH keys,
// shell start-up files and user services) run with all of its rights at its
// next sign-in. sudo's own answer covers every rule source it reads; groups
// cover the administrators sudo knows nothing about.
function personAccountProblem(user = {}, {
  groups = [],
  loginUids = loginUidRange(),
  resolveProgram = (program) => program,
  sudoCommands = [],
  sudoListing = ""
} = {}) {
  const { uid, username } = user;
  if (!Number.isSafeInteger(uid) || uid < loginUids.min || uid > loginUids.max) {
    return `${username} is a system account (uid ${uid}), not a person's login.`;
  }
  const group = groups.find((name) => ADMINISTRATOR_GROUPS.has(name));
  if (group) {
    return `${username} is in the administrators' group ${group}.`;
  }
  return sudoRulesProblem(username, sudoListing, sudoCommands, resolveProgram);
}

// No sudo rules, or only rules running exactly the host's declared commands
// as root without a password. Anything else, or an answer sudo never gives,
// is administration. Programs compare as the files they resolve to: classic
// sudo prints a rule's program as written, sudo-rs with some links resolved.
function sudoRulesProblem(username = "", sudoListing = "", sudoCommands = [], resolveProgram = (program) => program) {
  if (sudoListing.includes(`User ${username} is not allowed to run sudo on `)) {
    return "";
  }
  const lines = sudoListing.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`User ${username} may run the following commands on `));
  const rules = start < 0 ? [] : lines.slice(start + 1).filter((line) => line.trim());
  const resolved = (command) => {
    const [program, ...args] = command.split(" ");
    try {
      return [resolveProgram(program), ...args].join(" ");
    } catch {
      // A program that does not exist compares as written.
      return command;
    }
  };
  const allowed = new Set(sudoCommands.map(resolved));
  const narrow = rules.length > 0 && rules.every((line) => {
    const match = /^ {4}\(root\) NOPASSWD: (.+)$/u.exec(line);
    return Boolean(match) && match[1].split(", ").every((command) => allowed.has(resolved(command)));
  });
  return narrow ? "" : `${username} has sudo rules.`;
}

// A missing list allows no sudo rule at all.
function personSudoCommands(file = PERSON_SUDO_COMMANDS_FILE, ownerUid = 0) {
  let directory;
  try {
    directory = openSync(path.dirname(file), DIRECTORY_NO_FOLLOW);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    const stats = fstatSync(directory);
    if (stats.uid !== ownerUid || (stats.mode & 0o022) !== 0) {
      throw new Error("The Vibe64 person sudo commands are not in a directory only root can change.");
    }
    return readOwnedFile(directory, path.basename(file), { maxBytes: 4096, othersMayWrite: false, uid: ownerUid })
      .split("\n").map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  } finally {
    closeSync(directory);
  }
}

// The host's login range; without login.defs, useradd's own defaults apply.
function hostLoginUids() {
  try {
    return loginUidRange(readFileSync("/etc/login.defs", "utf8"));
  } catch {
    return loginUidRange();
  }
}

function hostPersonFacts(username = "") {
  const loginUids = hostLoginUids();
  // Without a terminal sudo wraps its listing at 80 columns; this width keeps
  // each rule on one line for the exact comparison.
  const sudo = spawnSync("/usr/bin/sudo", ["-n", "-l", "-U", username], {
    encoding: "utf8",
    env: { COLUMNS: "100000", LANG: "C", LC_ALL: "C", PATH: "/usr/sbin:/usr/bin:/sbin:/bin" }
  });
  return {
    groups: osGroupNames(username),
    loginUids,
    resolveProgram: realpathSync,
    sudoCommands: personSudoCommands(),
    sudoListing: sudo.error ? "" : String(sudo.stdout || "")
  };
}

function assertPersonAccount(user = {}, facts = {}) {
  const problem = personAccountProblem(user, facts);
  if (problem) {
    throw personRefusal(`Vibe64 never runs commands as an administrator or system account: ${problem}`);
  }
}

function assertRegisteredPerson(workspace = "", targetUser = {}, {
  facts = hostPersonFacts,
  ...registry
} = {}) {
  assertHumanUsername(targetUser.username);
  const registration = readPersonRegistration(workspace, targetUser.username, registry);
  if (registration?.uid !== targetUser.uid) {
    throw personRefusal(`OS user ${targetUser.username} is not registered as a Vibe64 person of workspace ${workspace}. ` +
      `A server administrator registers an existing account with: sudo ${path.resolve(process.argv[1])} ` +
      `register-person ${workspace} ${targetUser.username}`);
  }
  const hostFacts = facts(targetUser.username);
  assertPersonAccount(targetUser, hostFacts);
  return hostFacts;
}

// Every command the helper runs as a person passes this: a person root
// registered for the daemon's workspace, still without administrator power,
// in the shared group, and enabled in the daemon's own state.
function assertActablePerson(owner = {}, targetUser = {}, options = {}) {
  const facts = assertRegisteredPerson(personWorkspace(owner), targetUser, options);
  if (!facts.groups.includes(VIBE64_GROUP)) {
    throw new Error(`OS user is not enabled for the shared Vibe64 group: ${targetUser.username}`);
  }
  assertEnabledForVibe64(owner, targetUser.username);
}

// Root-side registration of one existing account. Refuses system and
// administrator accounts; the person also joins the shared group.
function registerPerson(workspace = "", username = "", {
  addToGroup = (name) => addUserToGroup(name, VIBE64_GROUP),
  facts = hostPersonFacts,
  resolveUser = resolveOsUser,
  ...registry
} = {}) {
  personWorkspaceName(workspace);
  assertHumanUsername(username);
  resolveUser(`${DAEMON_USERNAME_PREFIX}${workspace}`);
  const user = resolveUser(username);
  assertPersonAccount(user, facts(username));
  const directory = openRegistry(workspace, { registryRoot: PERSON_REGISTRY_ROOT, ...registry, create: true });
  try {
    writePersonRegistration(directory, user);
  } finally {
    closeSync(directory);
  }
  addToGroup(username);
  return user;
}

// One-time registration of the people a workspace had before root kept its
// registry: each membership in the daemon's state whose account is already in
// the shared group, except system and administrator accounts, which it reports.
// A workspace that has a registry keeps it unchanged. The registry appears
// whole, so an interrupted run imports nothing and the next run starts again.
function upgradePersonRegistry(workspace = "", {
  facts = hostPersonFacts,
  registryRoot = PERSON_REGISTRY_ROOT,
  registryUid = 0,
  report = (line) => process.stdout.write(`${line}\n`),
  resolveUser = resolveOsUser
} = {}) {
  personWorkspaceName(workspace);
  const daemon = resolveUser(`${DAEMON_USERNAME_PREFIX}${workspace}`);
  mkdirSync(registryRoot, { mode: 0o755, recursive: true });
  const root = openRootOwnedDirectory(registryRoot, registryUid);
  try {
    try {
      closeSync(openRegistry(workspace, { registryRoot, registryUid }));
      return { imported: [], refused: [] };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const staging = `.${workspace}.upgrading`;
    rmSync(openedPath(root, staging), { force: true, recursive: true });
    mkdirSync(openedPath(root, staging), { mode: 0o755 });
    const directory = openRootOwnedDirectory(openedPath(root, staging), registryUid);
    const imported = [];
    const refused = [];
    try {
      for (const username of daemonMembershipUsernames(daemon)) {
        let user;
        try {
          assertHumanUsername(username);
          user = resolveUser(username);
        } catch {
          continue;
        }
        const userFacts = facts(username);
        if (!userFacts.groups.includes(VIBE64_GROUP)) continue;
        const problem = personAccountProblem(user, userFacts);
        if (problem) {
          refused.push(username);
          report(`[vibe64-exec-helper] Not registering ${username} as a Vibe64 person of ${workspace}: ${problem}`);
          continue;
        }
        writePersonRegistration(directory, user);
        imported.push(username);
        report(`[vibe64-exec-helper] Registered ${username} as a Vibe64 person of ${workspace}.`);
      }
    } finally {
      closeSync(directory);
    }
    renameSync(openedPath(root, staging), openedPath(root, workspace));
    return { imported, refused };
  } finally {
    closeSync(root);
  }
}

// The usernames of the daemon's membership records, read as root only as the
// daemon's own regular files below its state, never through a link.
function daemonMembershipUsernames(daemon = {}) {
  let directory;
  try {
    directory = openDirectoryBelow(daemon.home, MEMBERSHIP_DIRECTORY);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    const usernames = [];
    for (const entry of readdirSync(openedPath(directory)).sort()) {
      const username = entry.endsWith(".json") ? entry.slice(0, -".json".length) : "";
      if (!MANAGED_USERNAME_PATTERN.test(username)) continue;
      try {
        const record = JSON.parse(readOwnedFile(directory, entry, { maxBytes: MEMBERSHIP_LIMIT_BYTES, uid: daemon.uid }));
        if (record?.username === username) usernames.push(username);
      } catch {
        // An unreadable or foreign record names no one.
      }
    }
    return usernames;
  } finally {
    closeSync(directory);
  }
}

export {
  assertActablePerson,
  assertPersonAccount,
  enablePerson,
  handleUserManagementOperation,
  hostLoginUids,
  hostPersonFacts,
  loginUidRange,
  openRegistry,
  PERSON_REFUSED_EXIT_CODE,
  personAccountProblem,
  personSudoCommands,
  personWorkspaceName,
  readPersonRegistration,
  registerPerson,
  REGISTRATION_LIMIT_BYTES,
  upgradePersonRegistry,
  writeRegistration
};
