// A published application's own account: its identity, registration, area and database files, its retirement,
// and the release files its service may use.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fchownSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  APPLICATION_USERNAME_PREFIX,
  DAEMON_USERNAME_PREFIX,
  HOST_SETTINGS_ROOT,
  MANAGED_ROOT,
  osGroupNames,
  resolveOsUser,
  resolveOwnerUser,
  runRootCommand,
  safeUsername,
  tryResolveOsUser,
  workspaceFromDaemonUsername
} from "./hostAccounts.js";
import {
  canonicalPath,
  DIRECTORY_NO_FOLLOW,
  directoryEntryName,
  makeDirectory,
  openDirectoryBelow,
  openedPath,
  openRootOwnedDirectory,
  readOwnedFile,
  relativePathParts
} from "./hostFiles.js";
import { helperSettings } from "./commandEnvironment.js";
import {
  hostLoginUids,
  openRegistry,
  personWorkspaceName,
  REGISTRATION_LIMIT_BYTES,
  writeRegistration
} from "./personRegistry.js";
import { SYSTEMD_UNIT_ROOT } from "./systemdUnits.js";

const APPLICATION_USERNAME_PATTERN = new RegExp(`^${APPLICATION_USERNAME_PREFIX}[a-f0-9]{12}$`, "u");
const APPLICATION_REGISTRY_ROOT = path.join(HOST_SETTINGS_ROOT, "applications");
const APPLICATION_REGISTRATION_SCHEMA = "vibe64.application-account";
const APPLICATION_SHELL = "/usr/sbin/nologin";
const APPLICATION_PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
// A learner's practice project lives below the workspace's projects at
// .learning/<learner>/<practice>/training-<practice id without dashes>
// (vibe64-core learningSpace.js). Catalogue projects may not take such a
// slug, so a practice slug, like a catalogue one, is unique in its workspace.
const PRACTICE_LEARNER_PATTERN = /^[A-Za-z0-9_-]{1,171}$/u;
const PRACTICE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
// Each registration holds a system uid for as long as it lasts, and the host's
// system uid range is small (100-999 by default).
const APPLICATION_LIMIT_PER_WORKSPACE = 100;

/**
 * The folder application accounts have their areas below, which only the host's helper settings name.
 * @param {Record<string, string>} [settings] the host's helper settings
 */
function applicationAreaRoot(settings = helperSettings()) {
  const configured = String(settings.VIBE64_APPLICATION_AREA_ROOT || "").trim();
  if (!path.isAbsolute(configured) || path.resolve(configured) !== configured || configured === "/") {
    throw new Error("This host's Vibe64 exec helper settings name no application area (VIBE64_APPLICATION_AREA_ROOT).");
  }
  return configured;
}

// Each published project runs as its own application account: a system
// account with only its own group, no login and no Vibe64 group. Root
// registers it for the daemon's workspace like the workspace's people, in a
// registry of its own, so an operation as a person never acts as an
// application nor the reverse. The helper derives the account and its area
// from the calling daemon's workspace and the project; the daemon names only
// the project.
function handleApplicationAccountOperation(payload = {}) {
  const owner = resolveOwnerUser();
  const action = String(payload.action || "").trim();
  if (action !== "ensure" && action !== "retire") {
    throw new Error("Vibe64 exec helper rejected an unknown application account action.");
  }
  const result = action === "ensure"
    ? { account: ensureApplicationAccount(owner, payload.project) }
    : retireApplicationAccount(owner, payload.project);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

function applicationWorkspace(owner = {}) {
  const daemon = String(owner.username || "");
  if (!daemon.startsWith(DAEMON_USERNAME_PREFIX)) {
    throw new Error("Only a workspace daemon has application accounts.");
  }
  return personWorkspaceName(daemon.slice(DAEMON_USERNAME_PREFIX.length));
}

// The area below `areaRoot`: root's directories down to the project's, the
// daemon's handover directory its application's group may read, the
// application's own directory with its home, and its production databases.
// The daemon names the project by its folder below the workspace's projects,
// a catalogue project's own or a learner's practice project's; its
// application, area and units are named by the project's slug either way.
function applicationIdentity(owner = {}, project = "", { areaRoot = applicationAreaRoot() } = {}) {
  const workspace = applicationWorkspace(owner);
  const folder = String(project || "").split("/");
  const name = folder.at(-1);
  const practice = folder.length === 4 && folder[0] === ".learning" && PRACTICE_LEARNER_PATTERN.test(folder[1]) &&
    PRACTICE_ID_PATTERN.test(folder[2]) && name === `training-${folder[2].replaceAll("-", "")}`;
  if (!APPLICATION_PROJECT_PATTERN.test(name) || (folder.length > 1 && !practice)) {
    throw new Error("Vibe64 exec helper rejected an invalid project name.");
  }
  const projectRoot = path.join(areaRoot, workspace, name);
  return {
    appRoot: path.join(projectRoot, "app"),
    areaRoot,
    databaseRoot: path.join(projectRoot, "database"),
    folder,
    handoverRoot: path.join(projectRoot, "handover"),
    home: path.join(projectRoot, "app", "home"),
    project: name,
    projectRoot,
    username: `${APPLICATION_USERNAME_PREFIX}${createHash("sha256").update(`${workspace}\0${name}`).digest("hex").slice(0, 12)}`,
    workspace
  };
}

function hostApplicationFacts(username = "") {
  const loginUids = hostLoginUids();
  const group = spawnSync("getent", ["group", username], { encoding: "utf8" });
  let groups = [];
  try {
    groups = osGroupNames(username);
  } catch {
    // An account whose groups cannot be read is no application account.
  }
  return {
    groupGid: group.status === 0 ? Number(String(group.stdout).split(":")[2]) : -1,
    groups,
    loginUids
  };
}

// Why this account is not the application account the helper makes, or "".
function applicationAccountProblem(user = {}, identity = {}, facts = {}) {
  if (user.username !== identity.username || !Number.isSafeInteger(user.uid) || user.uid <= 0 ||
      user.uid >= facts.loginUids.min) {
    return `${user.username} is not a system account.`;
  }
  if (user.home !== identity.home || user.shell !== APPLICATION_SHELL) {
    return `${user.username} does not have its application's home and no login.`;
  }
  if (facts.groupGid !== user.gid || facts.groups.length !== 1 || facts.groups[0] !== user.username) {
    return `${user.username} is in a group other than its own.`;
  }
  return "";
}

function readApplicationRegistration(workspace = "", username = "", {
  registryRoot = APPLICATION_REGISTRY_ROOT,
  registryUid = 0
} = {}) {
  // Only an application's name is ever an application's registration.
  if (!APPLICATION_USERNAME_PATTERN.test(String(username))) return null;
  let directory;
  try {
    directory = openRegistry(workspace, { registryRoot, registryUid });
  } catch {
    return null;
  }
  try {
    const record = JSON.parse(readOwnedFile(directory, `${directoryEntryName(username)}.json`, {
      maxBytes: REGISTRATION_LIMIT_BYTES,
      othersMayWrite: false,
      uid: registryUid
    }));
    return record?.schema === APPLICATION_REGISTRATION_SCHEMA && record.schemaVersion === 1 &&
      record.username === username && Number.isSafeInteger(record.uid) && Number.isSafeInteger(record.gid) &&
      APPLICATION_PROJECT_PATTERN.test(String(record.project))
      ? { gid: record.gid, project: record.project, uid: record.uid, username }
      : null;
  } catch {
    return null;
  } finally {
    closeSync(directory);
  }
}

function writeApplicationRegistration(identity = {}, user = {}, { registryRoot = APPLICATION_REGISTRY_ROOT, registryUid = 0 } = {}) {
  const directory = openRegistry(identity.workspace, { create: true, registryRoot, registryUid });
  try {
    writeRegistration(directory, {
      gid: user.gid,
      project: identity.project,
      schema: APPLICATION_REGISTRATION_SCHEMA,
      schemaVersion: 1,
      uid: user.uid,
      username: identity.username
    });
  } finally {
    closeSync(directory);
  }
}

// One directory of the area, made by root through a directory it holds open
// and handed to its owner. One that already exists must still have that owner
// and group, and when root's, be writable by no one else; nothing is repaired.
function openAreaDirectory(parent, name = "", { gid, mode, uid }, { verify = true } = {}) {
  const entry = openedPath(parent, directoryEntryName(name));
  const created = makeDirectory(entry, 0o700);
  if (!created && !verify) return { created, descriptor: -1 };
  const descriptor = openSync(entry, DIRECTORY_NO_FOLLOW);
  try {
    if (created) {
      fchownSync(descriptor, uid, gid);
      fchmodSync(descriptor, mode);
    } else if (verify) {
      const stats = fstatSync(descriptor);
      if (stats.uid !== uid || stats.gid !== gid || (mode === 0o711 && (stats.mode & 0o022) !== 0)) {
        throw new Error(`The application area's ${name} directory is not the one the helper made.`);
      }
    }
    return { created, descriptor };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function openApplicationProjectRoot(identity = {}, { areaGid = 0, areaUid = 0, create = true } = {}) {
  let descriptor = openSync(path.dirname(identity.areaRoot), fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    for (const name of [path.basename(identity.areaRoot), identity.workspace, identity.project]) {
      let next;
      if (create) {
        next = openAreaDirectory(descriptor, name, { gid: areaGid, mode: 0o711, uid: areaUid }).descriptor;
      } else {
        next = openRootOwnedDirectory(openedPath(descriptor, directoryEntryName(name)), areaUid);
      }
      closeSync(descriptor);
      descriptor = next;
    }
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function ensureApplicationArea(identity = {}, owner = {}, user = {}, {
  areaGid = 0,
  areaUid = 0,
  grantDaemonSearch = (descriptor) => runRootCommand("setfacl", ["-m", `u:${safeUsername(owner.username)}:x`,
    `/proc/${process.pid}/fd/${descriptor}`])
} = {}) {
  const project = openApplicationProjectRoot(identity, { areaGid, areaUid });
  const opened = [project];
  try {
    const application = { gid: user.gid, mode: 0o700, uid: user.uid };
    opened.push(openAreaDirectory(project, "handover", { gid: user.gid, mode: 0o2750, uid: owner.uid }).descriptor);
    const app = openAreaDirectory(project, "app", application).descriptor;
    opened.push(app);
    // The application's own home may be anything it made of it.
    opened.push(openAreaDirectory(app, "home", application, { verify: false }).descriptor);
    const database = openAreaDirectory(project, "database", application);
    opened.push(database.descriptor);
    // The daemon may look up a database there by name, never list or read it.
    if (database.created) grantDaemonSearch(database.descriptor);
  } finally {
    for (const descriptor of opened) if (descriptor >= 0) closeSync(descriptor);
  }
}

// A new application needs a project of its workspace, its folder reached
// below the workspace's projects through real folders, never a link, and room
// under the workspace's limit.
function assertNewApplication(identity = {}, { applicationLimit, managedRoot, registryRoot, registryUid }) {
  try {
    closeSync(openDirectoryBelow(path.join(managedRoot, identity.workspace), ["projects", ...identity.folder]));
  } catch (error) {
    if (!["ELOOP", "ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    throw new Error(`Vibe64 exec helper refused an application account: ${identity.workspace} has no project ` +
      `${identity.folder.join("/")}.`);
  }
  let registered = 0;
  try {
    const directory = openRegistry(identity.workspace, { registryRoot, registryUid });
    try {
      registered = readdirSync(openedPath(directory)).filter((name) => name.endsWith(".json") &&
        APPLICATION_USERNAME_PATTERN.test(name.slice(0, -".json".length))).length;
    } finally {
      closeSync(directory);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (registered >= applicationLimit) {
    throw new Error(`Vibe64 exec helper refused an application account: ${identity.workspace} already has ` +
      `${applicationLimit}, its limit. Retire unused ones first.`);
  }
}

function ensureApplicationAccount(owner = {}, project = "", {
  applicationLimit = APPLICATION_LIMIT_PER_WORKSPACE,
  areaRoot = applicationAreaRoot(),
  createUser = (identity) => runRootCommand("useradd", ["--system", "--user-group", "--no-create-home",
    "--home-dir", identity.home, "--shell", APPLICATION_SHELL, identity.username]),
  facts = hostApplicationFacts,
  managedRoot = MANAGED_ROOT,
  registryRoot = APPLICATION_REGISTRY_ROOT,
  registryUid = 0,
  resolveUser = tryResolveOsUser,
  ...area
} = {}) {
  const identity = applicationIdentity(owner, project, { areaRoot });
  const registry = { registryRoot, registryUid };
  const registration = readApplicationRegistration(identity.workspace, identity.username, registry);
  let user = resolveUser(identity.username);
  if (registration) {
    if (!user || user.uid !== registration.uid || user.gid !== registration.gid || registration.project !== identity.project) {
      throw new Error(`The registered application account ${identity.username} is not the account on this host.`);
    }
  } else {
    assertNewApplication(identity, { applicationLimit, managedRoot, ...registry });
    if (!user) {
      createUser(identity);
      user = resolveUser(identity.username);
    }
  }
  // An account left unregistered by an interrupted ensure is adopted only when
  // it is exactly the one the helper makes.
  const problem = user ? applicationAccountProblem(user, identity, facts(identity.username)) : "it was not created.";
  if (problem) {
    throw new Error(`Vibe64 exec helper refused application account ${identity.username}: ${problem}`);
  }
  if (!registration) writeApplicationRegistration(identity, user, registry);
  ensureApplicationArea(identity, owner, user, area);
  return {
    appRoot: identity.appRoot,
    databaseRoot: identity.databaseRoot,
    handoverRoot: identity.handoverRoot,
    home: identity.home,
    username: identity.username
  };
}

// What the application's database directory still holds, if its area exists.
function applicationDatabaseEntries(identity = {}, { areaUid = 0 } = {}) {
  let projectRoot;
  try {
    projectRoot = openApplicationProjectRoot(identity, { areaUid, create: false });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    let database;
    try {
      database = openSync(openedPath(projectRoot, "database"), DIRECTORY_NO_FOLLOW);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    try {
      return readdirSync(openedPath(database)).sort();
    } finally {
      closeSync(database);
    }
  } finally {
    closeSync(projectRoot);
  }
}

// A retired project's application goes whole: its account, registration and
// area. The editor gives a production database back before it retires the
// application, so the database outlives the project as other production
// databases do; root never removes one, so it refuses while the application's
// database directory holds anything. The account's uid and its place under the
// workspace's limit are then free again. Nothing of it may still run: no
// release unit of it may remain installed, since one could restart it, and it
// is unregistered before the check for its processes, so no new execution can
// start as it meanwhile. A refused retire registers it again.
function retireApplicationAccount(owner = {}, project = "", {
  areaRoot = applicationAreaRoot(),
  areaUid = 0,
  deleteUser = (username) => runRootCommand("userdel", [username]),
  facts = hostApplicationFacts,
  registryRoot = APPLICATION_REGISTRY_ROOT,
  registryUid = 0,
  resolveUser = tryResolveOsUser,
  running = (uid) => spawnSync("pgrep", ["-U", String(uid)]).status !== 1,
  unitRoot = SYSTEMD_UNIT_ROOT,
  unitUid = 0
} = {}) {
  const identity = applicationIdentity(owner, project, { areaRoot });
  const registry = { registryRoot, registryUid };
  const registration = readApplicationRegistration(identity.workspace, identity.username, registry);
  const user = resolveUser(identity.username);
  if (user) {
    const problem = registration && registration.uid !== user.uid
      ? "it is not the registered account."
      : applicationAccountProblem(user, identity, facts(identity.username));
    if (problem) {
      throw new Error(`Vibe64 exec helper refused to retire application account ${identity.username}: ${problem}`);
    }
    const installed = installedReleaseUnits({ unitRoot, unitUid, workspace: identity.workspace })
      .find(({ lines }) => lines.includes(`User=${identity.username}`));
    if (installed) {
      throw new Error(`The application's release service ${installed.name} is still installed. Remove it before retiring the application.`);
    }
  }
  const held = applicationDatabaseEntries(identity, { areaUid });
  if (held.length > 0) {
    throw new Error(`The application's database directory still holds ${held.slice(0, 5).join(", ")}` +
      `${held.length > 5 ? ` and ${held.length - 5} more` : ""}. Give its production database back to the editor before retiring the application.`);
  }
  const unregister = () => {
    const directory = openRegistry(identity.workspace, registry);
    try {
      unlinkSync(openedPath(directory, `${identity.username}.json`));
    } finally {
      closeSync(directory);
    }
  };
  const unregistered = Boolean(registration && user);
  if (unregistered) unregister();
  if (user && running(user.uid)) {
    if (unregistered) writeApplicationRegistration(identity, user, registry);
    throw new Error("The application still runs. Stop its release service before retiring it.");
  }
  let projectRoot = -1;
  try {
    projectRoot = openApplicationProjectRoot(identity, { areaUid, create: false });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (projectRoot >= 0) {
    closeSync(projectRoot);
    const workspaceRoot = openRootOwnedDirectory(path.join(areaRoot, identity.workspace), areaUid);
    try {
      rmSync(openedPath(workspaceRoot, identity.project), { force: true, recursive: true });
    } finally {
      closeSync(workspaceRoot);
    }
  }
  // Unregistered first: an account an interrupted retire leaves behind is one
  // the next ensure adopts or the next retire removes.
  if (registration && !unregistered) unregister();
  if (user) deleteUser(identity.username);
  return { retired: Boolean(user || registration || projectRoot >= 0) };
}

// A set-user-ID or set-group-ID file an application makes must do nothing,
// for every process on the host, sandboxed or not: the mount its area, or the
// folder in it a release service works in, lies on is nosuid. That is the
// mount, in mountinfo, with the longest mount point that holds it, the last
// listed of those sharing it, since a later mount covers an earlier one. Host
// setup mounts the area so; until then no application code runs.
function assertApplicationAreaNosuid(areaRoot = "", mountInfo = () => readFileSync("/proc/self/mountinfo", "utf8")) {
  const area = canonicalPath(areaRoot);
  let covering = { mountPoint: "", options: [] };
  for (const line of String(mountInfo()).split("\n")) {
    const [, , , , escaped = "", options = ""] = line.split(" ");
    const mountPoint = escaped.replace(/\\([0-7]{3})/gu, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
    if ((mountPoint === area || relativePathParts(mountPoint, area).length > 0) &&
        mountPoint.length >= covering.mountPoint.length) {
      covering = { mountPoint, options: options.split(",") };
    }
  }
  if (!covering.options.includes("nosuid")) {
    throw new Error(`Vibe64 exec helper refused to run application code: this host's application area is not ` +
      `mounted nosuid at ${area}, so a set-user-ID or set-group-ID file there would take effect. Host setup mounts it so.`);
  }
}

// The application account an execution or release service runs as: one root
// registered for the calling daemon's workspace, still exactly the account the
// helper made, its area mounted nosuid. Never a person, nor another
// workspace's application.
function registeredApplicationUser(owner = {}, username = "", {
  areaRoot = applicationAreaRoot(),
  facts = hostApplicationFacts,
  mountInfo,
  resolveUser = resolveOsUser,
  ...registry
} = {}) {
  const name = safeUsername(username);
  const registration = readApplicationRegistration(applicationWorkspace(owner), name, registry);
  if (!registration) {
    throw new Error(`${name} is not an application account of this workspace.`);
  }
  const identity = applicationIdentity(owner, registration.project, { areaRoot });
  const user = resolveUser(name);
  const problem = identity.username !== name || registration.uid !== user.uid || registration.gid !== user.gid
    ? "it is not the registered account."
    : applicationAccountProblem(user, identity, facts(name));
  if (problem) {
    throw new Error(`Vibe64 exec helper refused application account ${name}: ${problem}`);
  }
  assertApplicationAreaNosuid(areaRoot, mountInfo);
  return { ...user, application: identity };
}

// An application's command starts in its own area, by default its home. A
// link it planted there is resolved, never trusted.
function resolveApplicationCwd(cwd = "", identity = {}) {
  const resolved = canonicalPath(String(cwd || "").trim() || identity.home);
  for (const root of [identity.appRoot, identity.databaseRoot]) {
    const allowed = canonicalPath(root);
    if (resolved === allowed || relativePathParts(allowed, resolved).length > 0) return resolved;
  }
  throw new Error("Vibe64 exec helper rejected an application command path outside its area.");
}

// An application's release environment is the daemon's file in that release's
// handover directory, readable by the application's group alone, and the
// command runs in that release's build or workspace. Root never reads it.
function applicationReleaseEnvironmentFile(candidate = "", identity = {}, { cwd = "", daemonUid = -1, gid = -1 } = {}) {
  const file = String(candidate || "");
  const [releaseId = "", name = "", ...rest] = relativePathParts(identity.handoverRoot, file);
  const stats = lstatSync(file);
  const releaseRoots = [
    path.join(identity.appRoot, "sources", releaseId),
    path.join(identity.appRoot, "releases", releaseId, "workspace")
  ];
  if (!releaseId || name !== "environment" || rest.length > 0 || canonicalPath(file) !== file || !stats.isFile() ||
      stats.uid !== daemonUid || stats.gid !== gid || (stats.mode & 0o027) !== 0 ||
      !releaseRoots.some((root) => cwd === root || relativePathParts(root, cwd).length > 0)) {
    throw new Error("Release environment must belong to the application's selected release.");
  }
  return file;
}

// A release service's files: its workspace in the application's area, or the
// folder inside it its release names (its Workdir), and the daemon's
// environment file and start script for that same release in its handover
// directory, which the application's group may read but not change. The
// folder is reached through real directories, never a link the application
// planted in its own area.
function applicationReleaseServiceFiles(payload = {}, identity = {}, { daemonUid = -1, gid = -1 } = {}) {
  const workingDirectory = String(payload.workingDirectory || "");
  const environmentFile = applicationReleaseEnvironmentFile(payload.environmentFile, identity,
    { cwd: workingDirectory, daemonUid, gid });
  const releaseId = path.basename(path.dirname(environmentFile));
  const workspace = path.join(identity.appRoot, "releases", releaseId, "workspace");
  const inside = relativePathParts(workspace, workingDirectory);
  const startScript = String(payload.startScript || "");
  const stats = lstatSync(startScript);
  if (path.resolve(workingDirectory) !== workingDirectory || (workingDirectory !== workspace && inside.length === 0) ||
      startScript !== path.join(path.dirname(environmentFile), "start.sh") || !stats.isFile() ||
      stats.uid !== daemonUid || stats.gid !== gid || (stats.mode & 0o022) !== 0 || (stats.mode & 0o010) === 0) {
    throw new Error("A release service must run its own release's workspace and start script.");
  }
  try {
    closeSync(openDirectoryBelow(identity.appRoot, ["releases", releaseId, "workspace", ...inside]));
  } catch (error) {
    throw new Error(`A release service's working directory must be a real folder of its release's workspace: ${error.code || error.message}`);
  }
  return { environmentFile, startScript, workingDirectory };
}

// The installed release units, read as root's own files: name and lines. A
// unit of the calling workspace that is no unit file root wrote (a link or
// mask, another owner's, one others may change or an oversized one) is
// refused by name; another workspace's is that workspace's to sort out, claims
// nothing and never stops this one.
function installedReleaseUnits({ unitRoot = SYSTEMD_UNIT_ROOT, unitUid = 0, workspace = "" } = {}) {
  const own = `vibe64-release-${workspace}-`;
  const directory = openSync(unitRoot, DIRECTORY_NO_FOLLOW);
  try {
    const units = [];
    for (const name of readdirSync(openedPath(directory))) {
      if (!name.startsWith("vibe64-release-") || !name.endsWith(".service")) continue;
      try {
        units.push({
          lines: readOwnedFile(directory, name, { maxBytes: 64 * 1024, othersMayWrite: false, uid: unitUid }).split("\n"),
          name
        });
      } catch (error) {
        if (!name.startsWith(own)) continue;
        throw Object.assign(new Error(`Release unit ${name} of workspace ${workspace} is not a unit file root wrote: ` +
          `${error.message}`), { code: error.code });
      }
    }
    return units;
  } finally {
    closeSync(directory);
  }
}

// A release unit `user` may install: one named for its application's project
// in the daemon's workspace that is new or already its own, on a port no other
// release service unit claims. Root wrote every unit file it reads here.
function assertReleaseServiceClaim({ loopbackPort = 0, owner = {}, unitName = "", unitRoot = SYSTEMD_UNIT_ROOT, unitUid = 0, user = {} } = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  const project = String(user.application?.project || "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!project || !new RegExp(`^vibe64-release-${workspace}-${project}-[a-f0-9]{12}\\.service$`, "u").test(unitName)) {
    throw new Error(`Release service ${unitName} is not named for application ${user.username}'s project.`);
  }
  for (const { lines, name } of installedReleaseUnits({ unitRoot, unitUid, workspace })) {
    if (name === unitName) {
      if (!lines.includes(`User=${user.username}`)) {
        throw new Error(`Release service ${unitName} belongs to another account.`);
      }
    } else if (lines.includes(`SocketBindAllow=tcp:${loopbackPort}`)) {
      throw new Error(`Port ${loopbackPort} belongs to another release service.`);
    }
  }
}

export {
  APPLICATION_LIMIT_PER_WORKSPACE,
  applicationAreaRoot,
  applicationIdentity,
  applicationReleaseEnvironmentFile,
  applicationReleaseServiceFiles,
  assertApplicationAreaNosuid,
  assertReleaseServiceClaim,
  ensureApplicationAccount,
  handleApplicationAccountOperation,
  readApplicationRegistration,
  registeredApplicationUser,
  resolveApplicationCwd,
  retireApplicationAccount
};
