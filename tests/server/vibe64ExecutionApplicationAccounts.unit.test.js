import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  APPLICATION_USERNAME_PREFIX, DAEMON_USERNAME_PREFIX, HOST_SETTINGS_ROOT, accountUnitLines, applicationIdentity, applicationReleaseEnvironmentFile, applicationReleaseServiceFiles,
  assertReleaseServiceClaim, assertValidDeploymentUnitName,
  assertActablePerson, deploymentServiceUnit, ensureApplicationAccount, helperChildEnv, openManagedExecutionReceipts, readApplicationRegistration, registeredApplicationUser,
  registerPerson, resolveApplicationCwd, retireApplicationAccount
} from "../../packages/vibe64-execution/src/host/execHelper.js";

const EXEC_HELPER = fileURLToPath(new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url));

const daemonUser = (workspace) => `${DAEMON_USERNAME_PREFIX}${workspace}`;
const applicationUser = (suffix) => `${APPLICATION_USERNAME_PREFIX}${suffix}`;

const UID = process.getuid();
const GID = process.getgid();
// The test's uid stands in for the system account the helper makes.
const LOGIN_UIDS = { max: 60000, min: UID + 1 };

// A host as root sees it, in a temporary directory: the test's own uid stands
// in for root, the daemon and the application alike.
async function applicationHost(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-application-accounts-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, "var", "lib"), { recursive: true });
  const managedRoot = path.join(root, "var", "lib", "managed");
  const unitRoot = path.join(root, "etc", "systemd", "system");
  await mkdir(unitRoot, { recursive: true });
  for (const project of ["shop", "blog"]) await mkdir(path.join(managedRoot, "test", "projects", project), { recursive: true });
  const owner = { gid: GID, home: path.join(root, "home", daemonUser("test")), uid: UID, username: daemonUser("test") };
  const accounts = new Map();
  const created = [];
  const deleted = [];
  const grants = [];
  const options = {
    areaGid: GID,
    areaRoot: path.join(root, "var", "lib", "vibe64-apps"),
    areaUid: UID,
    createUser(identity) {
      created.push(identity.username);
      accounts.set(identity.username, {
        gid: GID, home: identity.home, shell: "/usr/sbin/nologin", uid: UID, username: identity.username
      });
    },
    deleteUser(username) {
      deleted.push(username);
      accounts.delete(username);
    },
    facts: (username) => ({ groupGid: GID, groups: [username], loginUids: LOGIN_UIDS }),
    grantDaemonSearch: (descriptor) => grants.push(descriptor),
    managedRoot,
    registryRoot: path.join(root, "etc", "vibe64", "applications"),
    registryUid: UID,
    resolveUser: (username) => accounts.get(username) || null,
    running: () => false,
    unitRoot,
    unitUid: UID
  };
  return {
    accounts, created, deleted, grants, options, owner, root,
    ensure: (project, overrides = {}) => ensureApplicationAccount(owner, project, { ...options, ...overrides }),
    retire: (project, overrides = {}) => retireApplicationAccount(owner, project, { ...options, ...overrides })
  };
}

async function directory(target) {
  const stats = await lstat(target);
  return { directory: stats.isDirectory(), gid: stats.gid, mode: stats.mode & 0o7777, uid: stats.uid };
}

test("each project of a workspace gets its own registered account and area", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const identity = applicationIdentity(host.owner, "shop", host.options);
  assert.match(account.username, new RegExp(`^${APPLICATION_USERNAME_PREFIX}[a-f0-9]{12}$`, "u"));
  assert.deepEqual(account, {
    appRoot: path.join(host.options.areaRoot, "test", "shop", "app"),
    databaseRoot: path.join(host.options.areaRoot, "test", "shop", "database"),
    handoverRoot: path.join(host.options.areaRoot, "test", "shop", "handover"),
    home: path.join(host.options.areaRoot, "test", "shop", "app", "home"),
    username: identity.username
  });
  assert.deepEqual(host.created, [account.username]);
  assert.deepEqual(readApplicationRegistration("test", account.username, host.options),
    { gid: GID, project: "shop", uid: UID, username: account.username });
  const registration = path.join(host.options.registryRoot, "test", `${account.username}.json`);
  assert.equal((await stat(registration)).mode & 0o777, 0o644);

  for (const level of [host.options.areaRoot, path.join(host.options.areaRoot, "test"), path.dirname(account.appRoot)]) {
    assert.deepEqual(await directory(level), { directory: true, gid: GID, mode: 0o711, uid: UID }, level);
  }
  assert.deepEqual(await directory(account.handoverRoot), { directory: true, gid: GID, mode: 0o2750, uid: UID });
  for (const own of [account.appRoot, account.home, account.databaseRoot]) {
    assert.deepEqual(await directory(own), { directory: true, gid: GID, mode: 0o700, uid: UID }, own);
  }
  assert.equal(host.grants.length, 1, "the daemon may search the database directory");

  // The same project again is the same account, checked, not made again.
  assert.deepEqual(host.ensure("shop"), account);
  assert.deepEqual(host.created, [account.username]);
  assert.equal(host.grants.length, 1);

  // Another project, or the same project of another workspace, is another account.
  const other = host.ensure("blog");
  assert.notEqual(other.username, account.username);
  assert.notEqual(applicationIdentity({ username: daemonUser("other") }, "shop").username, account.username);
  assert.equal(applicationIdentity({ username: daemonUser("test") }, "shop").username, account.username);
});

test("the daemon names only a project of its own workspace", async (t) => {
  const host = await applicationHost(t);
  for (const project of ["", "../shop", "Shop", "shop/app", ".", "a".repeat(49)]) {
    assert.throws(() => host.ensure(project), /invalid project name/u, project);
  }
  for (const username of ["merc", applicationUser("0123456789ab"), "root"]) {
    assert.throws(() => ensureApplicationAccount({ ...host.owner, username }, "shop", host.options),
      /Only a workspace daemon/u);
  }
  assert.deepEqual(host.created, []);
});

test("a new application account needs a real project of the workspace, and room under its limit", async (t) => {
  const host = await applicationHost(t);
  const projects = path.join(host.options.managedRoot, "test", "projects");
  assert.throws(() => host.ensure("missing"), /test has no project missing/u);
  await writeFile(path.join(projects, "file"), "not a project");
  assert.throws(() => host.ensure("file"), /test has no project file/u);
  await mkdir(path.join(host.root, "elsewhere"));
  await symlink(path.join(host.root, "elsewhere"), path.join(projects, "linked"));
  assert.throws(() => host.ensure("linked"), /test has no project linked/u, "a link is never followed to a project");
  assert.deepEqual(host.created, []);

  host.ensure("shop");
  assert.throws(() => host.ensure("blog", { applicationLimit: 1 }), /test already has 1, its limit/u);
  assert.deepEqual(host.created, [applicationIdentity(host.owner, "shop").username]);
  // A registered account is the same account, limit or not, and so is one
  // whose project went while its production database stays.
  assert.equal(host.ensure("shop", { applicationLimit: 1 }).username, applicationIdentity(host.owner, "shop").username);
  host.ensure("blog");
  const shop = host.ensure("shop");
  await writeFile(path.join(shop.databaseRoot, "app.sqlite"), "data");
  host.retire("shop");
  await rm(path.join(projects, "shop"), { recursive: true });
  assert.equal(host.ensure("shop").username, shop.username);
  // An account kept for its production database still holds its uid.
  host.retire("shop");
  await mkdir(path.join(projects, "news"));
  assert.throws(() => host.ensure("news", { applicationLimit: 2 }), /test already has 2, its limit/u);
  host.ensure("news", { applicationLimit: 3 });
});

test("a learner's practice project has its account, found by its folder below the workspace's projects", async (t) => {
  const host = await applicationHost(t);
  const projects = path.join(host.options.managedRoot, "test", "projects");
  const practice = (practiceId, learner = Buffer.from("1001").toString("base64url")) =>
    `.learning/${learner}/${practiceId}/training-${practiceId.replaceAll("-", "")}`;
  const folder = practice("0b6c0a37-0f4f-4b61-9d5c-3f3f8a1d2e4f");
  const slug = path.basename(folder);
  await mkdir(path.join(projects, folder), { recursive: true });

  const account = host.ensure(folder);

  // Its account and area are its slug's, as every project's are, and its
  // registration names it by that slug.
  assert.equal(account.username, applicationIdentity(host.owner, slug).username);
  assert.equal(account.home, path.join(host.options.areaRoot, "test", slug, "app", "home"));
  assert.equal(host.ensure(slug).username, account.username);
  for (const wrong of [
    `${path.dirname(folder)}/training-${"0".repeat(32)}`, folder.replace("0b6c0a37-0f4f-4b61-9d5c-3f3f8a1d2e4f", "not-a-practice"),
    `${folder}/app`, `.learning/../${path.basename(path.dirname(folder))}/${slug}`, folder.replace(".learning", ".other"),
    path.dirname(folder)
  ]) {
    assert.throws(() => host.ensure(wrong), /invalid project name/u, wrong);
  }
  // A practice folder is reached through real folders, never a link.
  const linked = practice("1b6c0a37-0f4f-4b61-9d5c-3f3f8a1d2e4f", "bGlua2Vk");
  await mkdir(path.join(host.root, "elsewhere", path.basename(path.dirname(linked)), path.basename(linked)), { recursive: true });
  await symlink(path.join(host.root, "elsewhere"), path.join(projects, ".learning", "bGlua2Vk"));
  assert.throws(() => host.ensure(linked), /test has no project \.learning\/bGlua2Vk\//u);
  assert.deepEqual(host.created, [account.username]);

  assert.equal(host.retire(folder).retired, true);
  assert.deepEqual(host.deleted, [account.username]);
});

test("an account the helper did not make is never adopted as an application", async (t) => {
  const host = await applicationHost(t);
  const { home, username } = applicationIdentity(host.owner, "shop", host.options);
  const exact = { gid: GID, home, shell: "/usr/sbin/nologin", uid: UID, username };
  for (const [account, facts, problem] of [
    [{ ...exact, uid: UID + 1 }, {}, /not a system account/u],
    [{ ...exact, uid: 0 }, {}, /not a system account/u],
    [{ ...exact, shell: "/bin/bash" }, {}, /no login/u],
    [{ ...exact, home: "/home/alice" }, {}, /no login/u],
    [exact, { groups: [username, "vibe64"] }, /group other than its own/u],
    [exact, { groups: [username, "nix-users"] }, /group other than its own/u],
    [exact, { groupGid: GID + 1 }, /group other than its own/u]
  ]) {
    host.accounts.set(username, account);
    assert.throws(() => host.ensure("shop", {
      facts: (name) => ({ groupGid: GID, groups: [name], loginUids: LOGIN_UIDS, ...facts })
    }), problem);
    assert.equal(readApplicationRegistration("test", username, host.options), null);
  }
  // The account an interrupted ensure left unregistered is exactly the one the
  // helper makes, so the next ensure registers it rather than making another.
  host.accounts.set(username, exact);
  assert.equal(host.ensure("shop").username, username);
  assert.deepEqual(host.created, []);
  assert.equal(readApplicationRegistration("test", username, host.options).uid, UID);

  // A registered account later replaced under the same name is refused.
  host.accounts.set(username, { ...exact, uid: UID - 1 });
  assert.throws(() => host.ensure("shop"), /is not the account on this host/u);
  host.accounts.delete(username);
  assert.throws(() => host.ensure("shop"), /is not the account on this host/u);
  assert.deepEqual(host.created, []);
});

test("application accounts and people never stand in for each other", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const appUser = host.accounts.get(account.username);
  const people = path.join(host.root, "etc", "vibe64", "people");
  // Not even root's own registration makes an application account a person.
  assert.throws(() => registerPerson("test", account.username, {
    addToGroup: () => assert.fail("joined the shared group"),
    facts: () => ({ groups: [account.username], loginUids: LOGIN_UIDS }),
    registryRoot: people,
    registryUid: UID,
    resolveUser: (name) => (name === daemonUser("test") ? host.owner : { ...appUser, uid: UID + 500 })
  }), /application accounts are never people/u);
  assert.throws(() => assertActablePerson(host.owner, appUser, {
    facts: () => ({ groups: [account.username, "vibe64"], loginUids: LOGIN_UIDS }),
    registryRoot: people,
    registryUid: UID
  }), /application accounts are never people/u);

  // A person's registration is no application's, even in the application registry.
  const registry = path.join(host.options.registryRoot, "test");
  await writeFile(path.join(registry, "alice.json"),
    JSON.stringify({ schema: "vibe64.person-registration", schemaVersion: 1, uid: 1001, username: "alice" }), { mode: 0o644 });
  assert.equal(readApplicationRegistration("test", "alice", host.options), null);
  // Nor is any record for a name that is not an application's.
  for (const username of ["alice", daemonUser("test"), "root", applicationUser("short")]) {
    await writeFile(path.join(registry, `${username}.json`), JSON.stringify({
      gid: GID, project: "shop", schema: "vibe64.application-account", schemaVersion: 1, uid: UID, username
    }), { mode: 0o644 });
    assert.equal(readApplicationRegistration("test", username, host.options), null, username);
  }
  assert.equal(readApplicationRegistration("test", account.username, { ...host.options, registryRoot: people }), null);
});

test("an area entry the helper did not make is refused, never followed or repaired", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const elsewhere = path.join(host.root, "elsewhere");
  await mkdir(elsewhere);
  for (const entry of [account.handoverRoot, account.appRoot, account.databaseRoot, path.dirname(account.appRoot)]) {
    await rename(entry, `${entry}.moved`);
    await symlink(elsewhere, entry);
    // A link opened as a directory without following it.
    assert.throws(() => host.ensure("shop"), (error) => ["ELOOP", "ENOTDIR"].includes(error.code), entry);
    await rm(entry);
    await rename(`${entry}.moved`, entry);
  }
  assert.deepEqual(await readdir(elsewhere), []);
  // The application may make its own home whatever it likes.
  await rm(account.home, { recursive: true });
  await symlink(elsewhere, account.home);
  assert.doesNotThrow(() => host.ensure("shop"));
  assert.deepEqual(await readdir(elsewhere), []);
});

test("retiring a project removes its application unless a production database remains", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  await writeFile(path.join(account.handoverRoot, "environment"), "A=1\n");
  await mkdir(path.join(account.appRoot, "releases", "r1", "workspace"), { recursive: true });
  await writeFile(path.join(account.databaseRoot, "app.sqlite"), "data");

  assert.throws(() => host.retire("shop", { running: () => true }), /still runs/u);
  assert.deepEqual(host.retire("shop"), { databaseKept: true, retired: true });
  assert.deepEqual(await readdir(path.dirname(account.appRoot)), ["database"]);
  assert.equal(await readFile(path.join(account.databaseRoot, "app.sqlite"), "utf8"), "data");
  assert.deepEqual(host.deleted, []);
  assert.notEqual(readApplicationRegistration("test", account.username, host.options), null);

  // The project made again finds its account and production database.
  assert.deepEqual(host.ensure("shop"), account);
  assert.deepEqual(host.created, [account.username]);
  assert.equal(await readFile(path.join(account.databaseRoot, "app.sqlite"), "utf8"), "data");

  await rm(path.join(account.databaseRoot, "app.sqlite"));
  assert.deepEqual(host.retire("shop"), { databaseKept: false, retired: true });
  assert.deepEqual(await readdir(path.join(host.options.areaRoot, "test")), []);
  assert.equal(readApplicationRegistration("test", account.username, host.options), null);
  assert.deepEqual(host.deleted, [account.username]);
  assert.deepEqual(host.retire("shop"), { databaseKept: false, retired: false });
});

test("retiring waits for every release unit of the application to go, and admits no new execution meanwhile", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const unitName = "vibe64-release-test-shop-0123456789ab.service";
  await writeFile(path.join(host.options.unitRoot, unitName), `[Service]\nUser=${account.username}\nRestart=always\n`, { mode: 0o644 });
  await writeFile(path.join(host.options.unitRoot, "vibe64-release-test-blog-0123456789ab.service"),
    `[Service]\nUser=${applicationUser("ba9876543210")}\n`, { mode: 0o644 });
  assert.throws(() => host.retire("shop"), new RegExp(`release service ${unitName} is still installed`, "u"),
    "an installed unit could start it again after the check");
  assert.notEqual(readApplicationRegistration("test", account.username, host.options), null);
  assert.equal((await stat(account.appRoot)).isDirectory(), true);
  await rm(path.join(host.options.unitRoot, unitName));

  // While its processes are checked it is no registered application, so no
  // execution can start as it; a refused retire registers it again.
  const registeredWhileChecked = [];
  const running = () => {
    registeredWhileChecked.push(readApplicationRegistration("test", account.username, host.options));
    return true;
  };
  assert.throws(() => host.retire("shop", { running }), /still runs/u);
  assert.deepEqual(registeredWhileChecked, [null]);
  assert.deepEqual(readApplicationRegistration("test", account.username, host.options),
    { gid: GID, project: "shop", uid: UID, username: account.username });
  assert.deepEqual(host.deleted, []);

  // Kept with a production database, it is registered again once its files go.
  await writeFile(path.join(account.databaseRoot, "app.sqlite"), "data");
  registeredWhileChecked.length = 0;
  assert.deepEqual(host.retire("shop", { running: (uid) => running(uid) && false }), { databaseKept: true, retired: true });
  assert.deepEqual(registeredWhileChecked, [null]);
  assert.notEqual(readApplicationRegistration("test", account.username, host.options), null);
});

test("an application command runs only as a registered application of the daemon's own workspace", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const options = { ...host.options, resolveUser: (name) => host.accounts.get(name) };
  const user = registeredApplicationUser(host.owner, account.username, options);
  assert.equal(user.uid, UID);
  assert.equal(user.home, account.home);
  assert.equal(user.application.appRoot, account.appRoot);

  // A person, the daemon or root named as an application is no application.
  for (const username of ["alice", daemonUser("test"), "root", applicationUser("000000000000")]) {
    assert.throws(() => registeredApplicationUser(host.owner, username, options), /not an application account of this workspace/u);
  }
  // Another workspace's daemon cannot run as this workspace's application.
  assert.throws(() => registeredApplicationUser({ ...host.owner, username: daemonUser("other") }, account.username, options),
    /not an application account of this workspace/u);
  // The account changed since root registered it.
  host.accounts.set(account.username, { ...host.accounts.get(account.username), uid: UID - 1 });
  assert.throws(() => registeredApplicationUser(host.owner, account.username, options), /not the registered account/u);
  host.accounts.set(account.username, { ...host.accounts.get(account.username), uid: UID });
  assert.throws(() => registeredApplicationUser(host.owner, account.username, {
    ...options, facts: (name) => ({ groupGid: GID, groups: [name, "vibe64"], loginUids: LOGIN_UIDS })
  }), /group other than its own/u);
});

test("an application command starts in its own area, whatever links it planted", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const other = host.ensure("blog");
  const identity = applicationIdentity(host.owner, "shop", host.options);
  const build = path.join(account.appRoot, "sources", "r1");
  await mkdir(build, { recursive: true });
  assert.equal(resolveApplicationCwd("", identity), account.home);
  assert.equal(resolveApplicationCwd(build, identity), build);
  assert.equal(resolveApplicationCwd(account.databaseRoot, identity), account.databaseRoot);
  await symlink(other.appRoot, path.join(account.appRoot, "other"));
  await symlink(host.root, path.join(account.appRoot, "up"));
  for (const cwd of [path.join(account.appRoot, "other"), path.join(account.appRoot, "up"), account.handoverRoot,
    other.appRoot, host.root, "/"]) {
    assert.throws(() => resolveApplicationCwd(cwd, identity), /outside its area/u, cwd);
  }
});

test("an application's release environment is the daemon's file for the release it builds or runs", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const identity = applicationIdentity(host.owner, "shop", host.options);
  const environment = path.join(account.handoverRoot, "r1", "environment");
  await mkdir(path.dirname(environment));
  await writeFile(environment, "KEY=value\n", { mode: 0o640 });
  await chmod(environment, 0o640);
  const build = path.join(account.appRoot, "sources", "r1");
  const workspace = path.join(account.appRoot, "releases", "r1", "workspace");
  const otherBuild = path.join(account.appRoot, "sources", "r2");
  for (const directory of [build, workspace, otherBuild]) await mkdir(directory, { recursive: true });
  const check = (file, cwd, ids = {}) => applicationReleaseEnvironmentFile(file, identity,
    { cwd, daemonUid: UID, gid: GID, ...ids });
  assert.equal(check(environment, build), environment);
  assert.equal(check(environment, path.join(workspace)), environment);

  const refused = /must belong to the application's selected release/u;
  assert.throws(() => check(environment, otherBuild), refused, "another release's build");
  assert.throws(() => check(environment, account.home), refused, "outside a release");
  assert.throws(() => check(environment, build, { daemonUid: UID + 1 }), refused, "not the daemon's file");
  assert.throws(() => check(environment, build, { gid: GID + 1 }), refused, "not the application's group");
  for (const mode of [0o644, 0o660, 0o641]) {
    await chmod(environment, mode);
    assert.throws(() => check(environment, build), refused, mode.toString(8));
  }
  await chmod(environment, 0o640);
  const linked = path.join(account.handoverRoot, "r1", "linked");
  await symlink(environment, linked);
  assert.throws(() => check(linked, build), refused, "a link");
  const nested = path.join(account.handoverRoot, "r1", "deeper", "environment");
  await mkdir(path.dirname(nested));
  await writeFile(nested, "KEY=value\n", { mode: 0o640 });
  assert.throws(() => check(nested, build), refused, "not the release's own file");
  const elsewhere = path.join(host.root, "environment");
  await writeFile(elsewhere, "KEY=value\n", { mode: 0o640 });
  assert.throws(() => check(elsewhere, build), refused, "outside the handover");
});

test("an application's execution runs as itself in its sandbox, with its own temporary directory", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const user = registeredApplicationUser(host.owner, account.username, host.options);
  const receiptRoot = "/receipts/test/0b6c0a37-0f4f-4b61-9d5c-3f3f8a1d2e4f";
  const lines = accountUnitLines(user, { receiptRoot });
  assert.deepEqual(lines.slice(0, 3), [`User=${account.username}`, `Group=${account.username}`, "UMask=0077"]);
  assert.equal(lines.some((line) => /^(SupplementaryGroups=|Group=vibe64$)/u.test(line)), false);
  for (const line of ["NoNewPrivileges=yes", "PrivateTmp=yes", "ProtectSystem=strict", "ProtectHome=yes",
    "ProtectProc=invisible", "RestrictSUIDSGID=yes", "RestrictNamespaces=yes", "CapabilityBoundingSet=",
    `InaccessiblePaths=${HOST_SETTINGS_ROOT}`, `ReadWritePaths=${account.appRoot} ${account.databaseRoot} ${receiptRoot}`,
    "PrivateDevices=yes", "PrivateIPC=yes", "TemporaryFileSystem=/dev/shm:mode=1777,nosuid,nodev",
    "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK",
    "SystemCallArchitectures=native", "SystemCallFilter=@system-service", "SystemCallErrorNumber=EPERM"]) {
    assert.ok(lines.includes(line), line);
  }
  assert.equal(lines.some((line) => line.startsWith("SocketBind")), false, "a finite command may bind, as builds and tests do");
  assert.deepEqual(accountUnitLines({ username: "alice" }),
    ["User=alice", "Group=vibe64", "SupplementaryGroups=nix-users", "UMask=0007"]);

  const env = helperChildEnv({ HOME: "/elsewhere", TMPDIR: "/elsewhere" }, user, daemonUser("test"), "vibe64-command");
  assert.equal(env.HOME, account.home);
  assert.equal(env.TMPDIR, "/tmp");

  // The runner loads the release environment as the application, keeping its
  // private temporary directory.
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-application-runner-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const environmentFile = path.join(root, "environment");
  await writeFile(environmentFile, "RELEASE_KEY=from-file\nTMPDIR=/from-file\n", { mode: 0o640 });
  const payloadPath = path.join(root, "command.json");
  await writeFile(payloadPath, JSON.stringify({
    application: true,
    args: ["-e", "process.stdout.write(JSON.stringify({key:process.env.RELEASE_KEY,tmp:process.env.TMPDIR,umask:process.umask()}))"],
    command: process.execPath,
    cwd: root,
    env: { HOME: account.home, PATH: "/usr/bin:/bin", USER: account.username },
    executionId: randomUUID(),
    releaseEnvironmentFile: environmentFile,
    schema: "vibe64.managed-execution.command",
    schemaVersion: 1
  }));
  const { stdout } = await promisify(execFile)(process.execPath, [EXEC_HELPER, "run-managed", payloadPath], {
    cwd: root, env: {}, timeout: 5000
  });
  // Its files are its own alone, as its unit's UMask= says.
  assert.deepEqual(JSON.parse(stdout), { key: "from-file", tmp: "/tmp", umask: 0o077 });
});

test("an application's execution is finite, and its receipt sits where only root adds receipts", async (t) => {
  const source = await readFile(EXEC_HELPER, "utf8");
  const operation = source.slice(source.indexOf("function handleManagedExecutionOperation("),
    source.indexOf("function consumeManagedExecutionRequestPayload("));
  assert.match(operation, /if \(application && mode !== "capture"\) \{\n {4}throw new Error\("An application account runs only finite commands\."\);/u);
  assert.match(operation, /if \(!application\) \{\n {6}throw new Error\("Release environment requires an application's own execution\."\);/u);
  assert.match(operation, /\? openApplicationExecutionReceipts\(owner, \{ create: true \}\)/u);
  assert.match(operation, /\.\.\.accountUnitLines\(targetUser, \{ receiptRoot \}\)\.map/u);
  // Inspecting, stopping and releasing find an application's receipt too.
  assert.equal(source.match(/openAllExecutionReceipts\(owner\)/gu).length, 3);

  // Root's receipt directory for applications: they traverse it, never list it.
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-application-receipts-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const directory = path.join(root, "test");
  openManagedExecutionReceipts(directory, { create: true, gid: GID, mode: 0o711, uid: UID }).close();
  assert.equal((await stat(directory)).mode & 0o7777, 0o711);
});

async function releaseFiles(host, account, releaseId) {
  const handover = path.join(account.handoverRoot, releaseId);
  const workspace = path.join(account.appRoot, "releases", releaseId, "workspace");
  await mkdir(handover, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(handover, "environment"), "PORT=4100\n", { mode: 0o640 });
  await chmod(path.join(handover, "environment"), 0o640);
  await writeFile(path.join(handover, "start.sh"), "#!/bin/sh\nexec node server.js\n", { mode: 0o750 });
  await chmod(path.join(handover, "start.sh"), 0o750);
  return {
    environmentFile: path.join(handover, "environment"),
    startScript: path.join(handover, "start.sh"),
    workingDirectory: workspace
  };
}

test("a release service runs its own release's workspace and the daemon's files for that release", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const identity = applicationIdentity(host.owner, "shop", host.options);
  const r1 = await releaseFiles(host, account, "r1");
  const r2 = await releaseFiles(host, account, "r2");
  const check = (payload, ids = {}) => applicationReleaseServiceFiles(payload, identity, { daemonUid: UID, gid: GID, ...ids });
  assert.deepEqual(check(r1), r1);

  const refused = /must (run its own release's workspace and start script|belong to the application's selected release)/u;
  assert.throws(() => check({ ...r1, workingDirectory: r2.workingDirectory }), refused, "another release's workspace");
  assert.throws(() => check({ ...r1, startScript: r2.startScript }), refused, "another release's start script");
  await mkdir(path.join(account.appRoot, "sources", "r1"), { recursive: true });
  assert.throws(() => check({ ...r1, workingDirectory: path.join(account.appRoot, "sources", "r1") }), refused, "a build");
  assert.throws(() => check(r1, { daemonUid: UID + 1 }), refused, "files the daemon does not own");
  assert.throws(() => check(r1, { gid: GID + 1 }), refused, "files of another group");
  for (const mode of [0o770, 0o752, 0o740]) {
    await chmod(r1.startScript, mode);
    assert.throws(() => check(r1), refused, mode.toString(8));
  }
  await chmod(r1.startScript, 0o750);
  await symlink(r1.workingDirectory, path.join(account.appRoot, "current"));
  assert.throws(() => check({ ...r1, workingDirectory: path.join(account.appRoot, "current") }), refused, "a link");
  assert.throws(() => check({ ...r1, workingDirectory: path.join(account.appRoot, "releases", "r3", "workspace") }), refused);
});

test("a release service may run in a real folder inside its release's workspace, its Workdir", async (t) => {
  const host = await applicationHost(t);
  const account = host.ensure("shop");
  const identity = applicationIdentity(host.owner, "shop", host.options);
  const r1 = await releaseFiles(host, account, "r1");
  const check = (workingDirectory) => applicationReleaseServiceFiles({ ...r1, workingDirectory }, identity,
    { daemonUid: UID, gid: GID });
  const web = path.join(r1.workingDirectory, "apps", "web");
  await mkdir(web, { recursive: true });
  assert.deepEqual(check(web), { ...r1, workingDirectory: web });

  // The application's own links and files are never its service's folder.
  const outside = await mkdtemp(path.join(os.tmpdir(), "v64-outside-"));
  t.after(() => rm(outside, { force: true, recursive: true }));
  await symlink(outside, path.join(r1.workingDirectory, "apps", "elsewhere"));
  await symlink(r1.workingDirectory, path.join(r1.workingDirectory, "apps", "self"));
  await writeFile(path.join(r1.workingDirectory, "apps", "file"), "not a folder\n");
  const real = /must be a real folder of its release's workspace/u;
  assert.throws(() => check(path.join(r1.workingDirectory, "apps", "elsewhere")), real);
  assert.throws(() => check(path.join(r1.workingDirectory, "apps", "self", "apps", "web")), real);
  assert.throws(() => check(path.join(r1.workingDirectory, "apps", "file")), real);
  assert.throws(() => check(path.join(r1.workingDirectory, "apps", "missing")), real);
  const refused = /must (run its own release's workspace and start script|belong to the application's selected release)/u;
  assert.throws(() => check(`${web}/../../..`), refused, "not a normal path");
  assert.throws(() => check(`${web}/`), refused, "not a normal path");
  assert.throws(() => check("apps/web"), refused, "relative");
});

test("a release service unit runs as its application in its sandbox, listening only on its own port", () => {
  const user = { application: { appRoot: "/area/app", databaseRoot: "/area/database" }, username: applicationUser("0123456789ab") };
  const unit = (loopbackPort) => deploymentServiceUnit({
    environmentFile: "/area/handover/r1/environment", helperPath: "/helper/vibe64-exec-helper", loopbackPort,
    owner: { username: daemonUser("test") }, requiredUnits: ["vibe64-managed-test-mariadb.service"],
    startScript: "/area/handover/r1/start.sh", unitName: "vibe64-release-test-shop-1.service", user,
    workingDirectory: "/area/app/releases/r1/workspace"
  });
  const lines = unit(4100).split("\n");
  for (const line of [
    `User=${applicationUser("0123456789ab")}`, `Group=${applicationUser("0123456789ab")}`, "UMask=0077", "Slice=vibe64-test-work.slice",
    "NoNewPrivileges=yes", "PrivateTmp=yes", "ProtectSystem=strict", "ReadWritePaths=/area/app /area/database",
    "ProtectHome=yes", "ProtectProc=invisible", "RestrictSUIDSGID=yes", "RestrictNamespaces=yes", "CapabilityBoundingSet=",
    `InaccessiblePaths=${HOST_SETTINGS_ROOT}`, "SocketBindAllow=tcp:4100", "SocketBindAllow=udp", "SocketBindDeny=any",
    "Environment=TMPDIR=/tmp", "PrivateDevices=yes", "PrivateIPC=yes", "TemporaryFileSystem=/dev/shm:mode=1777,nosuid,nodev",
    "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK", "SystemCallArchitectures=native",
    "SystemCallFilter=@system-service", "SystemCallErrorNumber=EPERM",
    "WorkingDirectory=/area/app/releases/r1/workspace", "Requires=vibe64-managed-test-mariadb.service",
    "WantedBy=multi-user.target",
    'ExecStart=/usr/bin/setpriv --no-new-privs -- /helper/vibe64-exec-helper run-release-service "/area/handover/r1/environment" "/area/handover/r1/start.sh"'
  ]) {
    assert.ok(lines.includes(line), line);
  }
  assert.equal(lines.some((line) => /^(SupplementaryGroups=|Group=vibe64$|EnvironmentFile=)/u.test(line)), false);
  for (const port of [0, 80, 1023, 65536, "4100; rm", undefined]) {
    assert.throws(() => unit(port), /release service port/u, String(port));
  }
});

test("a daemon names, stops, removes and reads only its own workspace's release units", () => {
  const owner = { username: daemonUser("test") };
  assert.equal(assertValidDeploymentUnitName("vibe64-release-test-shop-0123456789ab.service", owner),
    "vibe64-release-test-shop-0123456789ab.service");
  for (const unitName of ["vibe64-release-other-shop-0123456789ab.service", "vibe64-release-testx-shop-0123456789ab.service",
    "vibe64-release-test.service", "vibe64-release-test-../x.service", "ssh.service"]) {
    assert.throws(() => assertValidDeploymentUnitName(unitName, owner), /unsafe deployment service unit name/u, unitName);
  }
  assert.throws(() => assertValidDeploymentUnitName("vibe64-release-test-shop-0123456789ab.service", { username: "test" }),
    /unsafe deployment service unit name/u, "only a workspace daemon has release units");
});

test("a release unit is its application's own, named for its project, on a port no other release unit claims", async (t) => {
  const unitRoot = await mkdtemp(path.join(os.tmpdir(), "v64-release-units-"));
  t.after(() => rm(unitRoot, { force: true, recursive: true }));
  const owner = { username: daemonUser("test") };
  const shop = { application: { project: "my_shop" }, username: applicationUser("0123456789ab") };
  const books = { application: { project: "books" }, username: applicationUser("ba9876543210") };
  const unitFor = (user, port) => `[Service]\nUser=${user.username}\nSocketBindAllow=tcp:${port}\nSocketBindDeny=any\n`;
  await writeFile(path.join(unitRoot, "vibe64-release-test-books-111111111111.service"), unitFor(books, 4100), { mode: 0o644 });
  await writeFile(path.join(unitRoot, "vibe64-release-other-cafe-222222222222.service"), unitFor({ username: "v64a_other" }, 4200),
    { mode: 0o644 });
  await writeFile(path.join(unitRoot, "unrelated.service"), "SocketBindAllow=tcp:4300\n", { mode: 0o644 });
  const claim = (user, unitName, loopbackPort) => assertReleaseServiceClaim({ loopbackPort, owner, unitName, unitRoot,
    unitUid: UID, user });
  const shopUnit = "vibe64-release-test-my-shop-333333333333.service";

  claim(shop, shopUnit, 4101);
  claim(shop, shopUnit, 4300);
  assert.throws(() => claim(shop, shopUnit, 4100), /Port 4100 belongs to another release service/u, "another application's");
  assert.throws(() => claim(shop, shopUnit, 4200), /Port 4200 belongs to another release service/u, "another workspace's");
  assert.throws(() => claim(shop, "vibe64-release-test-books-444444444444.service", 4101), /not named for application/u);
  assert.throws(() => claim(shop, "vibe64-release-other-my-shop-444444444444.service", 4101), /not named for application/u);
  // An installed unit is replaced only by its own application.
  assert.throws(() => claim(shop, "vibe64-release-test-books-111111111111.service", 4100), /not named for application/u);
  await writeFile(path.join(unitRoot, shopUnit), unitFor(books, 4101), { mode: 0o644 });
  assert.throws(() => claim(shop, shopUnit, 4101), /belongs to another account/u);
  await writeFile(path.join(unitRoot, shopUnit), unitFor(shop, 4101), { mode: 0o644 });
  claim(shop, shopUnit, 4101);
  // Only unit files root alone may change count.
  await chmod(path.join(unitRoot, shopUnit), 0o666);
  assert.throws(() => claim(shop, shopUnit, 4101), { code: "EVIBE64UNSAFEFILE" });
});

test("only an application's registered account installs a release service", async () => {
  const source = await readFile(EXEC_HELPER, "utf8");
  const operation = source.slice(source.indexOf("function handleDeploymentServiceOperation("),
    source.indexOf("function inspectDeploymentServiceUnit("));
  assert.match(operation, /const user = registeredApplicationUser\(owner, payload\.applicationAccount\);/u);
  assert.match(operation, /applicationReleaseServiceFiles\(payload, user\.application, \{ daemonUid: owner\.uid, gid: user\.gid \}\)/u);
  assert.match(operation, /assertReleaseServiceClaim\(\{ loopbackPort, owner, unitName, user \}\);/u);
  assert.doesNotMatch(source, /upgrade-release-units|resolveAllowedDeploymentServicePath/u);
});
