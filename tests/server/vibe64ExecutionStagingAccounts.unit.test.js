import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  stagingAccountIdentity,
  checkedStagingEnvironmentFile,
  stagingUnitFiles,
  stagingSandboxAllowances,
  assertStagingAreaNosuid,
  assertStagingUnitClaim,
  ensureStagingAccount,
  readStagingAccountRegistration,
  registeredStagingAccount,
  resolveStagingAccountCwd,
  retireStagingAccount
} from "../../packages/vibe64-execution/src/host/stagingAccounts.js";
import { helperChildEnv, helperSettings } from "../../packages/vibe64-execution/src/host/commandEnvironment.js";
import { openManagedExecutionReceipts } from "../../packages/vibe64-execution/src/host/executionReceipts.js";
import {
  STAGING_ACCOUNT_USERNAME_PREFIX,
  DAEMON_USERNAME_PREFIX,
  HOST_SETTINGS_ROOT
} from "../../packages/vibe64-execution/src/host/hostAccounts.js";
import { assertActablePerson, registerPerson } from "../../packages/vibe64-execution/src/host/personRegistry.js";
import {
  accountUnitLines,
  stagingSandboxLines,
  assertValidStagingUnitName,
  stagingUnitFile
} from "../../packages/vibe64-execution/src/host/systemdUnits.js";
import { execHelperSource } from "../fixtures/execHelperSource.js";

const EXEC_HELPER = fileURLToPath(new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url));

const daemonUser = (workspace) => `${DAEMON_USERNAME_PREFIX}${workspace}`;
const stagingAccountUser = (suffix) => `${STAGING_ACCOUNT_USERNAME_PREFIX}${suffix}`;

const UID = process.getuid();
const GID = process.getgid();
// The test's uid stands in for the system account the helper makes.
const LOGIN_UIDS = { max: 60000, min: UID + 1 };

// One /proc/self/mountinfo line: a mount at mountPoint with those per-mount options.
const mountLine = (id, mountPoint, options) => `${id} 1 8:1 / ${mountPoint} ${options} shared:1 - ext4 /dev/vda1 rw`;

// A host as root sees it, in a temporary directory: the test's own uid stands
// in for root, the daemon and the application alike. Its staging area
// lies on a nosuid mount, as host setup mounts it.
async function stagingAccountHost(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-staging-accounts-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const mountInfo = [mountLine(1, "/", "rw,relatime"), mountLine(2, await realpath(root), "rw,nosuid,nodev,relatime")].join("\n");
  await mkdir(path.join(root, "var", "lib"), { recursive: true });
  const managedRoot = path.join(root, "var", "lib", "managed");
  const unitRoot = path.join(root, "etc", "systemd", "system");
  await mkdir(unitRoot, { recursive: true });
  for (const project of ["shop", "blog"]) await mkdir(path.join(managedRoot, "test", "projects", project), { recursive: true });
  const owner = { gid: GID, home: path.join(root, "home", daemonUser("test")), uid: UID, username: daemonUser("test") };
  const accounts = new Map();
  const created = [];
  const deleted = [];
  const ended = [];
  const grants = [];
  const options = {
    areaGid: GID,
    areaRoot: path.join(root, "var", "lib", "staging"),
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
    // Revoke's own end of a login shell: the account's shell is no login again.
    endStagingAccess: (_user, username) => {
      ended.push(username);
      if (accounts.has(username)) accounts.get(username).shell = "/usr/sbin/nologin";
    },
    facts: (username) => ({ groupGid: GID, groups: [username], loginUids: LOGIN_UIDS }),
    grantDaemonSearch: (descriptor) => grants.push(descriptor),
    managedRoot,
    mountInfo: () => mountInfo,
    registryRoot: path.join(root, "etc", "vibe64", "staging-accounts"),
    registryUid: UID,
    resolveUser: (username) => accounts.get(username) || null,
    running: () => false,
    unitRoot,
    unitUid: UID
  };
  return {
    accounts, created, deleted, ended, grants, options, owner, root,
    ensure: (project, overrides = {}) => ensureStagingAccount(owner, project, { ...options, ...overrides }),
    retire: (project, overrides = {}) => retireStagingAccount(owner, project, { ...options, ...overrides })
  };
}

async function directory(target) {
  const stats = await lstat(target);
  return { directory: stats.isDirectory(), gid: stats.gid, mode: stats.mode & 0o7777, uid: stats.uid };
}

test("each project of a workspace gets its own registered account and area", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const identity = stagingAccountIdentity(host.owner, "shop", host.options);
  assert.match(account.username, new RegExp(`^${STAGING_ACCOUNT_USERNAME_PREFIX}[a-f0-9]{12}$`, "u"));
  assert.deepEqual(account, {
    appRoot: path.join(host.options.areaRoot, "test", "shop", "app"),
    databaseRoot: path.join(host.options.areaRoot, "test", "shop", "database"),
    handoverRoot: path.join(host.options.areaRoot, "test", "shop", "handover"),
    home: path.join(host.options.areaRoot, "test", "shop", "app", "home"),
    username: identity.username
  });
  assert.deepEqual(host.created, [account.username]);
  assert.deepEqual(readStagingAccountRegistration("test", account.username, host.options),
    { gid: GID, project: "shop", uid: UID, username: account.username });
  const registration = path.join(host.options.registryRoot, "test", `${account.username}.json`);
  assert.equal((await stat(registration)).mode & 0o777, 0o644);

  for (const level of [host.options.areaRoot, path.join(host.options.areaRoot, "test"), path.dirname(account.appRoot)]) {
    assert.deepEqual(await directory(level), { directory: true, gid: GID, mode: 0o711, uid: UID }, level);
  }
  assert.deepEqual(await directory(account.handoverRoot), { directory: true, gid: GID, mode: 0o2750, uid: UID });
  // Its temporary folder, its TMPDIR, is its own too, beside its home in its area, where programs may start.
  for (const own of [account.appRoot, account.home, path.join(account.appRoot, "tmp"), account.databaseRoot]) {
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
  assert.notEqual(stagingAccountIdentity({ username: daemonUser("other") }, "shop", host.options).username, account.username);
  assert.equal(stagingAccountIdentity({ username: daemonUser("test") }, "shop", host.options).username, account.username);
});

test("a staging account has a login shell only while root holds its staging key", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const user = host.accounts.get(account.username);
  const withAccess = (stagingAccess) => ({
    ...host.options,
    facts: (username) => ({ ...host.options.facts(username), stagingAccess })
  });
  user.shell = "/bin/sh";
  assert.equal(registeredStagingAccount(host.owner, account.username, withAccess(true)).username, account.username);
  user.shell = "/bin/bash";
  for (const stagingAccess of [true, false]) {
    assert.throws(() => registeredStagingAccount(host.owner, account.username, withAccess(stagingAccess)),
      /does not have its application's home and no login/u);
  }
  assert.deepEqual(host.ended, [], "a shell the helper never gives is refused, never changed");
});

// A boot can take the staging key away while the account keeps its login shell: a mobilynet machine keeps keys and sudo
// rules on tmpfs, and its accounts build gives every login shell, /bin/sh included, its own (/usr/lib/mobilynet/shell)
// at boot. The helper then refused the account for every use: FINAL3's activation on mercmobily (28 Nov) could not
// install daniela's unit, and the editor's grant at the first staging login after a boot was refused the same way.
const MOBILYNET_SHELL = "/usr/lib/mobilynet/shell";

test("a login shell whose staging key a boot took away is access the boot ended: the helper ends it as revoke does, then " +
  "uses the account; the host's own form of the login shell is a login shell too", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const user = host.accounts.get(account.username);
  const onHost = (stagingAccess) => ({
    ...host.options,
    facts: (username) => ({ ...host.options.facts(username), loginShells: ["/bin/sh", MOBILYNET_SHELL], stagingAccess })
  });
  // While root holds the key, either form is the login it allows, and nothing changes.
  for (const shell of ["/bin/sh", MOBILYNET_SHELL]) {
    user.shell = shell;
    assert.equal(registeredStagingAccount(host.owner, account.username, onHost(true)).shell, shell);
  }
  assert.deepEqual(host.ended, []);
  // Without the key, each is ended (revoke's end: no login shell, no linger, logins, crontab or at jobs) and the account
  // is used as the one the helper makes.
  for (const shell of ["/bin/sh", MOBILYNET_SHELL]) {
    user.shell = shell;
    assert.equal(registeredStagingAccount(host.owner, account.username, onHost(false)).shell, "/usr/sbin/nologin", shell);
  }
  assert.deepEqual(host.ended, [account.username, account.username]);
  // ensure (Publish to staging) and retire take it the same way.
  user.shell = MOBILYNET_SHELL;
  assert.deepEqual(host.ensure("shop", onHost(false)), account);
  assert.equal(user.shell, "/usr/sbin/nologin");
  user.shell = MOBILYNET_SHELL;
  assert.equal(host.retire("shop", onHost(false)).retired, true);
  // An account that is not the helper's otherwise (another home) is refused with its login shell as it was.
  const blog = host.ensure("blog");
  const other = host.accounts.get(blog.username);
  Object.assign(other, { home: path.join(host.root, "elsewhere"), shell: "/bin/sh" });
  const ended = host.ended.length;
  assert.throws(() => registeredStagingAccount(host.owner, blog.username, onHost(false)),
    /does not have its application's home and no login/u);
  assert.equal(other.shell, "/bin/sh");
  assert.equal(host.ended.length, ended);
});

test("the host's own login shell is a staging login shell where its helper settings name one (VIBE64_PERSON_SHELL, a " +
  "mobilynet machine's)", async () => {
  const { stagingLoginShells } = await import("../../packages/vibe64-execution/src/host/stagingAccess.js");
  assert.equal(typeof stagingLoginShells, "function", "stagingAccess.js names the staging login shells");
  assert.deepEqual(stagingLoginShells({}), ["/bin/sh"]);
  assert.deepEqual(stagingLoginShells({ VIBE64_PERSON_SHELL: MOBILYNET_SHELL }), ["/bin/sh", MOBILYNET_SHELL]);
  assert.throws(() => stagingLoginShells({ VIBE64_PERSON_SHELL: "relative/shell" }), /VIBE64_PERSON_SHELL/u);
});

test("the daemon names only a project of its own workspace", async (t) => {
  const host = await stagingAccountHost(t);
  for (const project of ["", "../shop", "Shop", "shop/app", ".", "a".repeat(49)]) {
    assert.throws(() => host.ensure(project), /invalid project name/u, project);
  }
  for (const username of ["merc", stagingAccountUser("0123456789ab"), "root"]) {
    assert.throws(() => ensureStagingAccount({ ...host.owner, username }, "shop", host.options),
      /Only a workspace daemon/u);
  }
  assert.deepEqual(host.created, []);
});

test("a new staging account needs a real project of the workspace, and room under its limit", async (t) => {
  const host = await stagingAccountHost(t);
  const projects = path.join(host.options.managedRoot, "test", "projects");
  assert.throws(() => host.ensure("missing"), /test has no project missing/u);
  await writeFile(path.join(projects, "file"), "not a project");
  assert.throws(() => host.ensure("file"), /test has no project file/u);
  await mkdir(path.join(host.root, "elsewhere"));
  await symlink(path.join(host.root, "elsewhere"), path.join(projects, "linked"));
  assert.throws(() => host.ensure("linked"), /test has no project linked/u, "a link is never followed to a project");
  assert.deepEqual(host.created, []);

  host.ensure("shop");
  assert.throws(() => host.ensure("blog", { stagingAccountLimit: 1 }), /test already has 1, its limit/u);
  assert.deepEqual(host.created, [stagingAccountIdentity(host.owner, "shop", host.options).username]);
  // A registered account is the same account, limit or not.
  assert.equal(host.ensure("shop", { stagingAccountLimit: 1 }).username, stagingAccountIdentity(host.owner, "shop", host.options).username);
  host.ensure("blog");
  await mkdir(path.join(projects, "news"));
  assert.throws(() => host.ensure("news", { stagingAccountLimit: 2 }), /test already has 2, its limit/u);
  // A retired application, its staging database taken back, frees its place.
  host.retire("shop");
  host.ensure("news", { stagingAccountLimit: 2 });
});

test("a learner's practice project has its account, found by its folder below the workspace's projects", async (t) => {
  const host = await stagingAccountHost(t);
  const projects = path.join(host.options.managedRoot, "test", "projects");
  const practice = (practiceId, learner = Buffer.from("1001").toString("base64url")) =>
    `.learning/${learner}/${practiceId}/training-${practiceId.replaceAll("-", "")}`;
  const folder = practice("0b6c0a37-0f4f-4b61-9d5c-3f3f8a1d2e4f");
  const slug = path.basename(folder);
  await mkdir(path.join(projects, folder), { recursive: true });

  const account = host.ensure(folder);

  // Its account and area are its slug's, as every project's are, and its
  // registration names it by that slug.
  assert.equal(account.username, stagingAccountIdentity(host.owner, slug, host.options).username);
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
  const host = await stagingAccountHost(t);
  const { home, username } = stagingAccountIdentity(host.owner, "shop", host.options);
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
    assert.equal(readStagingAccountRegistration("test", username, host.options), null);
  }
  // The account an interrupted ensure left unregistered is exactly the one the
  // helper makes, so the next ensure registers it rather than making another.
  host.accounts.set(username, exact);
  assert.equal(host.ensure("shop").username, username);
  assert.deepEqual(host.created, []);
  assert.equal(readStagingAccountRegistration("test", username, host.options).uid, UID);

  // A registered account later replaced under the same name is refused.
  host.accounts.set(username, { ...exact, uid: UID - 1 });
  assert.throws(() => host.ensure("shop"), /is not the account on this host/u);
  host.accounts.delete(username);
  assert.throws(() => host.ensure("shop"), /is not the account on this host/u);
  assert.deepEqual(host.created, []);
});

test("staging accounts and people never stand in for each other", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const appUser = host.accounts.get(account.username);
  const people = path.join(host.root, "etc", "vibe64", "people");
  // Not even root's own registration makes a staging account a person.
  assert.throws(() => registerPerson("test", account.username, {
    addToGroup: () => assert.fail("joined the shared group"),
    facts: () => ({ groups: [account.username], loginUids: LOGIN_UIDS }),
    registryRoot: people,
    registryUid: UID,
    resolveUser: (name) => (name === daemonUser("test") ? host.owner : { ...appUser, uid: UID + 500 })
  }), /staging accounts are never people/u);
  assert.throws(() => assertActablePerson(host.owner, appUser, {
    facts: () => ({ groups: [account.username, "vibe64"], loginUids: LOGIN_UIDS }),
    registryRoot: people,
    registryUid: UID
  }), /staging accounts are never people/u);

  // A person's registration is no application's, even in the application registry.
  const registry = path.join(host.options.registryRoot, "test");
  await writeFile(path.join(registry, "alice.json"),
    JSON.stringify({ schema: "vibe64.person-registration", schemaVersion: 1, uid: 1001, username: "alice" }), { mode: 0o644 });
  assert.equal(readStagingAccountRegistration("test", "alice", host.options), null);
  // Nor is any record for a name that is not an application's.
  for (const username of ["alice", daemonUser("test"), "root", stagingAccountUser("short")]) {
    await writeFile(path.join(registry, `${username}.json`), JSON.stringify({
      gid: GID, project: "shop", schema: "vibe64.staging-account", schemaVersion: 1, uid: UID, username
    }), { mode: 0o644 });
    assert.equal(readStagingAccountRegistration("test", username, host.options), null, username);
  }
  assert.equal(readStagingAccountRegistration("test", account.username, { ...host.options, registryRoot: people }), null);
});

test("an area entry the helper did not make is refused, never followed or repaired", async (t) => {
  const host = await stagingAccountHost(t);
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
  // The application may make its own home and temporary folder whatever it likes.
  for (const own of [account.home, path.join(account.appRoot, "tmp")]) {
    await rm(own, { recursive: true });
    await symlink(elsewhere, own);
    assert.doesNotThrow(() => host.ensure("shop"), own);
    assert.deepEqual(await readdir(elsewhere), [], own);
  }
});

test("retiring a project removes its application, its registration and its whole area", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  await writeFile(path.join(account.handoverRoot, "environment"), "A=1\n");
  await mkdir(path.join(account.appRoot, "releases", "r1", "workspace"), { recursive: true });
  // The editor gives the staging database back before it retires the
  // application; root never removes a database left in its directory.
  const left = path.join(account.databaseRoot, "v64_test_shop_staging.sqlite");
  await writeFile(left, "data");
  assert.throws(() => host.retire("shop"),
    /database directory still holds v64_test_shop_staging\.sqlite\. Give its staging database back/u);
  assert.equal(await readFile(left, "utf8"), "data");
  assert.equal(readStagingAccountRegistration("test", account.username, host.options).username, account.username);
  assert.deepEqual(host.deleted, []);
  await rm(left);

  // A refused retire leaves its AI sessions' staging access as it was.
  assert.throws(() => host.retire("shop", { running: () => true }),
    /still runs: its staging service, or a staging login of its AI sessions/u);
  assert.deepEqual(host.ended, []);
  assert.deepEqual(host.retire("shop"), { retired: true });
  // Its AI sessions' way into staging ends before it goes.
  assert.deepEqual(host.ended, [account.username]);
  assert.deepEqual(await readdir(path.join(host.options.areaRoot, "test")), []);
  assert.equal(readStagingAccountRegistration("test", account.username, host.options), null);
  assert.deepEqual(host.deleted, [account.username]);
  assert.deepEqual(host.retire("shop"), { retired: false });

  // The project made again gets a new account and an empty area.
  const again = host.ensure("shop");
  assert.equal(again.username, account.username);
  assert.deepEqual(await readdir(again.databaseRoot), []);
  assert.deepEqual(host.created, [account.username, account.username]);
});

test("retiring waits for every staging unit of the application to go, and admits no new execution meanwhile", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const unitName = "vibe64-staging-test-shop-0123456789ab.service";
  await writeFile(path.join(host.options.unitRoot, unitName), `[Service]\nUser=${account.username}\nRestart=always\n`, { mode: 0o644 });
  await writeFile(path.join(host.options.unitRoot, "vibe64-staging-test-blog-0123456789ab.service"),
    `[Service]\nUser=${stagingAccountUser("ba9876543210")}\n`, { mode: 0o644 });
  assert.throws(() => host.retire("shop"), new RegExp(`staging service ${unitName} is still installed`, "u"),
    "an installed unit could start it again after the check");
  assert.notEqual(readStagingAccountRegistration("test", account.username, host.options), null);
  assert.equal((await stat(account.appRoot)).isDirectory(), true);
  await rm(path.join(host.options.unitRoot, unitName));

  // While its processes are checked it is no registered application, so no
  // execution can start as it; a refused retire registers it again.
  const registeredWhileChecked = [];
  const running = () => {
    registeredWhileChecked.push(readStagingAccountRegistration("test", account.username, host.options));
    return true;
  };
  assert.throws(() => host.retire("shop", { running }), /still runs/u);
  assert.deepEqual(registeredWhileChecked, [null]);
  assert.deepEqual(readStagingAccountRegistration("test", account.username, host.options),
    { gid: GID, project: "shop", uid: UID, username: account.username });
  assert.deepEqual(host.deleted, []);
});

test("an application command runs only as a registered application of the daemon's own workspace", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const options = { ...host.options, resolveUser: (name) => host.accounts.get(name) };
  const user = registeredStagingAccount(host.owner, account.username, options);
  assert.equal(user.uid, UID);
  assert.equal(user.home, account.home);
  assert.equal(user.stagingAccount.appRoot, account.appRoot);

  // A person, the daemon or root named as an application is no application.
  for (const username of ["alice", daemonUser("test"), "root", stagingAccountUser("000000000000")]) {
    assert.throws(() => registeredStagingAccount(host.owner, username, options), /not a staging account of this workspace/u);
  }
  // Another workspace's daemon cannot run as this workspace's application.
  assert.throws(() => registeredStagingAccount({ ...host.owner, username: daemonUser("other") }, account.username, options),
    /not a staging account of this workspace/u);
  // The account changed since root registered it.
  host.accounts.set(account.username, { ...host.accounts.get(account.username), uid: UID - 1 });
  assert.throws(() => registeredStagingAccount(host.owner, account.username, options), /not the registered account/u);
  host.accounts.set(account.username, { ...host.accounts.get(account.username), uid: UID });
  assert.throws(() => registeredStagingAccount(host.owner, account.username, {
    ...options, facts: (name) => ({ groupGid: GID, groups: [name, "vibe64"], loginUids: LOGIN_UIDS })
  }), /group other than its own/u);
});

test("an application runs only while its area lies on a nosuid mount", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const area = await realpath(host.options.areaRoot);
  const run = (...lines) => registeredStagingAccount(host.owner, account.username,
    { ...host.options, mountInfo: () => `${lines.join("\n")}\n` });
  const refused = /refused to run application code: this host's staging area is not mounted nosuid at \//u;

  assert.equal(run(mountLine(1, "/", "rw,relatime"), mountLine(2, area, "rw,nosuid,nodev,relatime")).username, account.username);
  // The host's own file system is the area's mount until host setup mounts it.
  assert.throws(() => run(mountLine(1, "/", "rw,relatime")), refused);
  // A nosuid parent mount covers the area; one beside it, sharing its name's start, does not.
  run(mountLine(1, "/", "rw,relatime"), mountLine(2, path.dirname(area), "rw,nosuid,relatime"));
  assert.throws(() => run(mountLine(1, "/", "rw,relatime"), mountLine(2, `${area}-old`, "rw,nosuid,nodev,relatime")), refused);
  // A mount below the area is not the area's.
  assert.throws(() => run(mountLine(1, "/", "rw,relatime"), mountLine(2, path.join(area, "test"), "rw,nosuid,relatime")), refused);
  // The last mount listed at the same place covers those before it.
  assert.throws(() => run(mountLine(1, "/", "rw,relatime"), mountLine(2, area, "rw,nosuid,nodev,relatime"),
    mountLine(3, area, "rw,nodev,relatime")), refused);
  run(mountLine(1, "/", "rw,relatime"), mountLine(2, area, "rw,relatime"), mountLine(3, area, "rw,nosuid,nodev,relatime"));
  // An option that only contains the word is not nosuid.
  assert.throws(() => run(mountLine(1, "/", "rw,relatime"), mountLine(2, area, "rw,nosuidx,relatime")), refused);

  // mountinfo escapes a space in a mount point as \040, and the area is found by its real path.
  const spaced = path.join(host.root, "app area");
  await mkdir(spaced);
  await symlink(spaced, path.join(host.root, "linked"));
  const realRoot = await realpath(host.root);
  const spacedMount = (options) => () => [mountLine(1, "/", "rw"), mountLine(2, `${realRoot}/app\\040area`, options)].join("\n");
  assertStagingAreaNosuid(spaced, spacedMount("rw,nosuid"));
  assertStagingAreaNosuid(path.join(host.root, "linked"), spacedMount("rw,nosuid"));
  assert.throws(() => assertStagingAreaNosuid(spaced, spacedMount("rw")), refused);
});

test("an application command starts in its own area, whatever links it planted", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const other = host.ensure("blog");
  const identity = stagingAccountIdentity(host.owner, "shop", host.options);
  const build = path.join(account.appRoot, "sources", "r1");
  await mkdir(build, { recursive: true });
  assert.equal(resolveStagingAccountCwd("", identity), account.home);
  assert.equal(resolveStagingAccountCwd(build, identity), build);
  assert.equal(resolveStagingAccountCwd(account.databaseRoot, identity), account.databaseRoot);
  await symlink(other.appRoot, path.join(account.appRoot, "other"));
  await symlink(host.root, path.join(account.appRoot, "up"));
  for (const cwd of [path.join(account.appRoot, "other"), path.join(account.appRoot, "up"), account.handoverRoot,
    other.appRoot, host.root, "/"]) {
    assert.throws(() => resolveStagingAccountCwd(cwd, identity), /outside its area/u, cwd);
  }
});

test("an application's staging environment is the daemon's file for the release it builds or runs", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const identity = stagingAccountIdentity(host.owner, "shop", host.options);
  const environment = path.join(account.handoverRoot, "r1", "environment");
  await mkdir(path.dirname(environment));
  await writeFile(environment, "KEY=value\n", { mode: 0o640 });
  await chmod(environment, 0o640);
  const build = path.join(account.appRoot, "sources", "r1");
  const workspace = path.join(account.appRoot, "releases", "r1", "workspace");
  const otherBuild = path.join(account.appRoot, "sources", "r2");
  for (const directory of [build, workspace, otherBuild]) await mkdir(directory, { recursive: true });
  const check = (file, cwd, ids = {}) => checkedStagingEnvironmentFile(file, identity,
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
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const user = registeredStagingAccount(host.owner, account.username, host.options);
  const receiptRoot = "/receipts/test/0b6c0a37-0f4f-4b61-9d5c-3f3f8a1d2e4f";
  const lines = accountUnitLines(user, { receiptRoot });
  assert.deepEqual(lines.slice(0, 3), [`User=${account.username}`, `Group=${account.username}`, "UMask=0077"]);
  assert.equal(lines.some((line) => /^(SupplementaryGroups=|Group=vibe64$)/u.test(line)), false);
  for (const line of ["NoNewPrivileges=yes", "PrivateTmp=yes", "ProtectSystem=strict", "ProtectHome=yes",
    "ProtectProc=invisible", "RestrictNamespaces=yes", "CapabilityBoundingSet=",
    `InaccessiblePaths=${HOST_SETTINGS_ROOT}`, `ReadWritePaths=${account.appRoot} ${account.databaseRoot} ${receiptRoot}`,
    "PrivateDevices=yes", "PrivateIPC=yes", "TemporaryFileSystem=/dev/shm:mode=1777,nosuid,nodev",
    "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK",
    "SystemCallArchitectures=native", "SystemCallFilter=@system-service", "SystemCallErrorNumber=EPERM"]) {
    assert.ok(lines.includes(line), line);
  }
  assert.equal(lines.some((line) => line.startsWith("SocketBind")), false, "a finite command may bind, as builds and tests do");
  // Under RestrictSUIDSGID= systemd refuses openat2(), with which GNU tar unpacks; the nosuid area takes its place.
  assert.equal(lines.some((line) => line.startsWith("RestrictSUIDSGID")), false, "tar and dpkg-deb unpack folders");
  assert.deepEqual(accountUnitLines({ username: "alice" }),
    ["User=alice", "Group=vibe64", "SupplementaryGroups=nix-users", "UMask=0007"]);

  // Its temporary folder is its own, in its area beside its home, where programs may start: /tmp, its private one
  // included, may be noexec (mobilynet's is), and so may the folder a JVM unpacks native libraries to by default.
  const temporaryFolder = path.join(account.appRoot, "tmp");
  const env = helperChildEnv({ HOME: "/elsewhere", TMPDIR: "/elsewhere", JAVA_TOOL_OPTIONS: "-Xmx256m" }, user,
    daemonUser("test"), "vibe64-command");
  assert.equal(env.HOME, account.home);
  assert.equal(env.TMPDIR, temporaryFolder);
  assert.equal(env.JAVA_TOOL_OPTIONS, `-Djava.io.tmpdir=${temporaryFolder} -Djna.tmpdir=${temporaryFolder} -Xmx256m`);

  // The runner loads the staging environment as the application, keeping its
  // own temporary folder over one its Env file names, and the Env file's own JVM options after the folder's, once.
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-application-runner-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const environmentFile = path.join(root, "environment");
  await writeFile(environmentFile, "RELEASE_KEY=from-file\nTMPDIR=/from-file\nJAVA_TOOL_OPTIONS=-Xmx64m\n", { mode: 0o640 });
  const payloadPath = path.join(root, "command.json");
  await writeFile(payloadPath, JSON.stringify({
    stagingAccount: true,
    args: ["-e", "process.stdout.write(JSON.stringify({java:process.env.JAVA_TOOL_OPTIONS,key:process.env.RELEASE_KEY," +
      "tmp:process.env.TMPDIR,umask:process.umask()}))"],
    command: process.execPath,
    cwd: root,
    // As root hands it over.
    env: helperChildEnv({ PATH: "/usr/bin:/bin" }, user, daemonUser("test"), "vibe64-command"),
    executionId: randomUUID(),
    stagingEnvironmentFile: environmentFile,
    schema: "vibe64.managed-execution.command",
    schemaVersion: 1
  }));
  const { stdout } = await promisify(execFile)(process.execPath, [EXEC_HELPER, "run-managed", payloadPath], {
    cwd: root, env: {}, timeout: 5000
  });
  // Its files are its own alone, as its unit's UMask= says.
  assert.deepEqual(JSON.parse(stdout), { java: `-Djava.io.tmpdir=${temporaryFolder} -Djna.tmpdir=${temporaryFolder} -Xmx64m`,
    key: "from-file", tmp: temporaryFolder, umask: 0o077 });
});

test("a staging account's execution is finite, and its receipt sits where only root adds receipts", async (t) => {
  const source = await execHelperSource();
  const operation = source.slice(source.indexOf("function handleManagedExecutionOperation("),
    source.indexOf("function runManagedExecutionPayload("));
  assert.match(operation, /if \(stagingAccount && mode !== "capture"\) \{\n {4}throw new Error\("A staging account runs only finite commands\."\);/u);
  assert.match(operation, /if \(!stagingAccount\) \{\n {6}throw new Error\("Staging environment requires a staging account's own execution\."\);/u);
  assert.match(operation, /\? openStagingExecutionReceipts\(owner, \{ create: true \}\)/u);
  assert.match(operation, /\.\.\.accountUnitLines\(targetUser, \{ receiptRoot, sandboxAllowances \}\)\.map/u);
  // Inspecting, stopping and releasing find an application's receipt too.
  assert.equal(source.match(/openAllExecutionReceipts\(owner\)/gu).length, 3);

  // Root's receipt directory for applications: they traverse it, never list it.
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-application-receipts-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const directory = path.join(root, "test");
  openManagedExecutionReceipts(directory, { create: true, gid: GID, mode: 0o711, uid: UID }).close();
  assert.equal((await stat(directory)).mode & 0o7777, 0o711);
});

// A staging service refused for its files or for its environment file.
const releaseRefused = /must (run its own release's workspace and start script|belong to the application's selected release)/u;

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

test("a staging service runs its own release's workspace and the daemon's files for that release", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const identity = stagingAccountIdentity(host.owner, "shop", host.options);
  const r1 = await releaseFiles(host, account, "r1");
  const r2 = await releaseFiles(host, account, "r2");
  const check = (payload, ids = {}) => stagingUnitFiles(payload, identity, { daemonUid: UID, gid: GID, ...ids });
  assert.deepEqual(check(r1), r1);

  assert.throws(() => check({ ...r1, workingDirectory: r2.workingDirectory }), releaseRefused, "another release's workspace");
  assert.throws(() => check({ ...r1, startScript: r2.startScript }), releaseRefused, "another release's start script");
  await mkdir(path.join(account.appRoot, "sources", "r1"), { recursive: true });
  assert.throws(() => check({ ...r1, workingDirectory: path.join(account.appRoot, "sources", "r1") }), releaseRefused, "a build");
  assert.throws(() => check(r1, { daemonUid: UID + 1 }), releaseRefused, "files the daemon does not own");
  assert.throws(() => check(r1, { gid: GID + 1 }), releaseRefused, "files of another group");
  for (const mode of [0o770, 0o752, 0o740]) {
    await chmod(r1.startScript, mode);
    assert.throws(() => check(r1), releaseRefused, mode.toString(8));
  }
  await chmod(r1.startScript, 0o750);
  await symlink(r1.workingDirectory, path.join(account.appRoot, "current"));
  assert.throws(() => check({ ...r1, workingDirectory: path.join(account.appRoot, "current") }), releaseRefused, "a link");
  assert.throws(() => check({ ...r1, workingDirectory: path.join(account.appRoot, "releases", "r3", "workspace") }), releaseRefused);
});

test("a staging service may run in a real folder inside its release's workspace, its Workdir", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const identity = stagingAccountIdentity(host.owner, "shop", host.options);
  const r1 = await releaseFiles(host, account, "r1");
  const check = (workingDirectory) => stagingUnitFiles({ ...r1, workingDirectory }, identity,
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
  assert.throws(() => check(`${web}/../../..`), releaseRefused, "not a normal path");
  assert.throws(() => check(`${web}/`), releaseRefused, "not a normal path");
  assert.throws(() => check("apps/web"), releaseRefused, "relative");
});

test("a staging service unit runs as its application in its sandbox, listening only on its own port", () => {
  const user = { stagingAccount: { appRoot: "/area/app", databaseRoot: "/area/database" }, username: stagingAccountUser("0123456789ab") };
  const unit = (loopbackPort) => stagingUnitFile({
    environmentFile: "/area/handover/r1/environment", helperPath: "/helper/vibe64-exec-helper", loopbackPort,
    owner: { username: daemonUser("test") }, requiredUnits: ["vibe64-managed-test-mariadb.service"], servicePath: "/packs/bin:/usr/bin",
    startScript: "/area/handover/r1/start.sh", unitName: "vibe64-staging-test-shop-1.service", user,
    workingDirectory: "/area/app/releases/r1/workspace"
  });
  const lines = unit(4100).split("\n");
  for (const line of [
    `User=${stagingAccountUser("0123456789ab")}`, `Group=${stagingAccountUser("0123456789ab")}`, "UMask=0077", "Slice=vibe64-test-work.slice",
    "NoNewPrivileges=yes", "PrivateTmp=yes", "ProtectSystem=strict", "ReadWritePaths=/area/app /area/database",
    "ProtectHome=yes", "ProtectProc=invisible", "RestrictNamespaces=yes", "CapabilityBoundingSet=",
    `InaccessiblePaths=${HOST_SETTINGS_ROOT}`, "SocketBindAllow=tcp:4100", "SocketBindAllow=udp", "SocketBindDeny=any",
    "Environment=PATH=/packs/bin:/usr/bin", "Environment=TMPDIR=/area/app/tmp", "PrivateDevices=yes", "PrivateIPC=yes", "TemporaryFileSystem=/dev/shm:mode=1777,nosuid,nodev",
    "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK", "SystemCallArchitectures=native",
    "SystemCallFilter=@system-service", "SystemCallErrorNumber=EPERM",
    "WorkingDirectory=/area/app/releases/r1/workspace", "Requires=vibe64-managed-test-mariadb.service",
    "WantedBy=multi-user.target",
    'ExecStart=/usr/bin/setpriv --no-new-privs -- /helper/vibe64-exec-helper run-staging-unit "/area/handover/r1/environment" "/area/handover/r1/start.sh"'
  ]) {
    assert.ok(lines.includes(line), line);
  }
  assert.equal(lines.some((line) => /^(SupplementaryGroups=|Group=vibe64$|EnvironmentFile=|RestrictSUIDSGID=)/u.test(line)), false);
  for (const port of [0, 80, 1023, 65536, "4100; rm", undefined]) {
    assert.throws(() => unit(port), /staging service port/u, String(port));
  }
});

test("a release's sandbox allowances add only what each names to its application's sandbox", () => {
  const identity = { appRoot: "/area/app", databaseRoot: "/area/database" };
  const plain = stagingSandboxLines(identity, ["/receipt"]);
  const changed = (allowances) => {
    const lines = stagingSandboxLines(identity, ["/receipt"], allowances);
    return {
      added: lines.filter((line) => !plain.includes(line)),
      removed: plain.filter((line) => !lines.includes(line))
    };
  };
  assert.deepEqual(stagingSandboxLines(identity, ["/receipt"], []), plain);
  assert.ok(plain.includes("RestrictNamespaces=yes") && plain.includes("SystemCallFilter=@system-service"));
  assert.equal(plain.some((line) => /^(DeviceAllow|BindPaths)=/u.test(line)), false);
  // gVisor's rootless runsc: its own namespaces (never a cgroup or time one),
  // its mounts inside them and tracing its own subprocesses.
  assert.deepEqual(changed(["gvisor"]), {
    added: ["RestrictNamespaces=user mnt pid ipc uts net", "SystemCallFilter=@system-service @mount ptrace"],
    removed: ["RestrictNamespaces=yes", "SystemCallFilter=@system-service"]
  });
  // FUSE inside a user and mount namespace of its own, through the host's /dev/fuse.
  assert.deepEqual(changed(["fuse"]), {
    added: ["DeviceAllow=/dev/fuse rw", "BindPaths=/dev/fuse", "RestrictNamespaces=user mnt",
      "SystemCallFilter=@system-service @mount"],
    removed: ["RestrictNamespaces=yes", "SystemCallFilter=@system-service"]
  });
  // Both: beyond gvisor, fuse adds only the device.
  const both = changed(["fuse", "gvisor"]);
  assert.deepEqual(both.added.filter((line) => !changed(["gvisor"]).added.includes(line)),
    ["DeviceAllow=/dev/fuse rw", "BindPaths=/dev/fuse"]);
  assert.deepEqual(stagingSandboxLines(identity, ["/receipt"], ["gvisor", "fuse"]),
    stagingSandboxLines(identity, ["/receipt"], ["fuse", "gvisor"]));
  // Everything else holds: no privileges, no capabilities, the same writable
  // paths, closed devices but for /dev/fuse, the same files out of reach.
  for (const line of ["NoNewPrivileges=yes", "CapabilityBoundingSet=", "PrivateDevices=yes", "ProtectSystem=strict",
    "ReadWritePaths=/area/app /area/database /receipt", `InaccessiblePaths=${HOST_SETTINGS_ROOT}`, "ProtectHome=yes",
    "ProtectProc=invisible", "ProtectKernelTunables=yes", "ProtectKernelModules=yes", "ProtectControlGroups=yes",
    "SystemCallErrorNumber=EPERM", "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK"]) {
    assert.ok(stagingSandboxLines(identity, ["/receipt"], ["fuse", "gvisor"]).includes(line), line);
  }
  assert.throws(() => stagingSandboxLines(identity, [], ["docker"]), /unknown staging sandbox allowance/u);

  // The staging unit and an execution's properties carry them.
  const user = { stagingAccount: identity, username: stagingAccountUser("0123456789ab") };
  const unit = stagingUnitFile({
    environmentFile: "/area/handover/r1/environment", helperPath: "/helper/vibe64-exec-helper", loopbackPort: 4100,
    owner: { username: daemonUser("test") }, sandboxAllowances: ["fuse", "gvisor"], servicePath: "/usr/bin",
    startScript: "/area/handover/r1/start.sh", unitName: "vibe64-staging-test-shop-1.service", user,
    workingDirectory: "/area/app/releases/r1/workspace"
  }).split("\n");
  for (const line of ["DeviceAllow=/dev/fuse rw", "BindPaths=/dev/fuse", "RestrictNamespaces=user mnt pid ipc uts net",
    "SystemCallFilter=@system-service @mount ptrace", "SocketBindAllow=tcp:4100", "SocketBindDeny=any"]) {
    assert.ok(unit.includes(line), line);
  }
  assert.deepEqual(accountUnitLines(user, { receiptRoot: "/receipt", sandboxAllowances: ["gvisor"] }).slice(3),
    stagingSandboxLines(identity, ["/receipt"], ["gvisor"]));
  // A person's or the daemon's execution has no staging sandbox to widen.
  assert.deepEqual(accountUnitLines({ username: "alice" }, { sandboxAllowances: ["gvisor"] }),
    ["User=alice", "Group=vibe64", "SupplementaryGroups=nix-users", "UMask=0007"]);
});

test("the helper grants a sandbox allowance only where the host's owner lists it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-sandbox-allowances-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const file = path.join(root, "exec-helper.env");
  const settingsWith = async (text) => {
    await writeFile(file, text, { mode: 0o644 });
    return helperSettings(file, UID);
  };
  const refused = /does not permit it \(VIBE64_STAGING_SANDBOX_ALLOWANCES\)/u;
  const unknown = /sandbox allowance it does not know/u;

  // A host whose owner lists nothing grants nothing, though a release with no
  // allowances runs as ever.
  const none = await settingsWith("VIBE64_STAGING_AREA_ROOT=/srv/staging\n");
  assert.deepEqual(stagingSandboxAllowances(undefined, none), []);
  assert.deepEqual(stagingSandboxAllowances([], none), []);
  assert.throws(() => stagingSandboxAllowances(["gvisor"], none), refused);

  const gvisorOnly = await settingsWith("VIBE64_STAGING_SANDBOX_ALLOWANCES=gvisor\n");
  assert.deepEqual(stagingSandboxAllowances(["gvisor"], gvisorOnly), ["gvisor"]);
  assert.throws(() => stagingSandboxAllowances(["fuse"], gvisorOnly), /refused staging sandbox allowance fuse:/u);
  assert.throws(() => stagingSandboxAllowances(["fuse", "gvisor"], gvisorOnly), refused);

  const both = await settingsWith("VIBE64_STAGING_SANDBOX_ALLOWANCES=\"gvisor fuse\"\n");
  assert.deepEqual(stagingSandboxAllowances(["gvisor", "fuse"], both), ["fuse", "gvisor"]);
  for (const value of [["docker"], ["gvisor", "gvisor"], "gvisor", [1], { gvisor: true }, ["GVISOR"]]) {
    assert.throws(() => stagingSandboxAllowances(value, both), unknown, JSON.stringify(value));
  }
  // A setting that names an allowance the helper does not know is refused,
  // never read as a narrower or wider list.
  const odd = await settingsWith("VIBE64_STAGING_SANDBOX_ALLOWANCES=gvisor docker\n");
  assert.throws(() => stagingSandboxAllowances([], odd), /settings name an unknown staging sandbox allowance/u);
});

test("only the daemon's request for a staging account's own execution or staging unit carries sandbox allowances", async () => {
  const source = await execHelperSource();
  const execution = source.slice(source.indexOf("function handleManagedExecutionOperation("),
    source.indexOf("function runManagedExecutionPayload("));
  assert.match(execution, /if \(payload\.sandboxAllowances !== undefined && !stagingAccount\) \{\n {4}throw new Error\("Sandbox allowances require a staging account's own execution\."\);/u);
  assert.match(execution, /const sandboxAllowances = stagingAccount \? stagingSandboxAllowances\(payload\.sandboxAllowances\) : \[\];/u);
  const service = source.slice(source.indexOf("function handleStagingUnitOperation("),
    source.indexOf("function inspectStagingUnit("));
  assert.ok(service.indexOf("registeredStagingAccount(owner, payload.stagingAccount)") <
    service.indexOf("stagingSandboxAllowances(payload.sandboxAllowances)"));
  // The host gate is read from root's settings alone: the default argument,
  // never a value from the payload.
  assert.equal(source.match(/stagingSandboxAllowances\(/gu).length, 3, "the definition and its two callers");
  assert.match(source, /function stagingSandboxAllowances\(value, settings = helperSettings\(\)\)/u);
  // Both operations act for the calling daemon: SUDO_USER, which only sudo
  // sets, names it, and only a workspace daemon has staging units.
  assert.match(source, /function resolveOwnerUser\(\) \{\n {2}const sudoUser = safeUsername\(process\.env\.SUDO_USER \|\| ""\);/u);
});

test("a daemon names, stops, removes and reads only its own workspace's staging units", () => {
  const owner = { username: daemonUser("test") };
  assert.equal(assertValidStagingUnitName("vibe64-staging-test-shop-0123456789ab.service", owner),
    "vibe64-staging-test-shop-0123456789ab.service");
  for (const unitName of ["vibe64-staging-other-shop-0123456789ab.service", "vibe64-staging-testx-shop-0123456789ab.service",
    "vibe64-staging-test.service", "vibe64-staging-test-../x.service", "ssh.service"]) {
    assert.throws(() => assertValidStagingUnitName(unitName, owner), /unsafe staging unit name/u, unitName);
  }
  assert.throws(() => assertValidStagingUnitName("vibe64-staging-test-shop-0123456789ab.service", { username: "test" }),
    /unsafe staging unit name/u, "only a workspace daemon has staging units");
});

test("a staging unit is its application's own, named for its project, on a port no other staging unit claims", async (t) => {
  const unitRoot = await mkdtemp(path.join(os.tmpdir(), "v64-release-units-"));
  t.after(() => rm(unitRoot, { force: true, recursive: true }));
  const owner = { username: daemonUser("test") };
  const shop = { stagingAccount: { project: "my_shop" }, username: stagingAccountUser("0123456789ab") };
  const books = { stagingAccount: { project: "books" }, username: stagingAccountUser("ba9876543210") };
  const unitFor = (user, port) => `[Service]\nUser=${user.username}\nSocketBindAllow=tcp:${port}\nSocketBindDeny=any\n`;
  await writeFile(path.join(unitRoot, "vibe64-staging-test-books-111111111111.service"), unitFor(books, 4100), { mode: 0o644 });
  await writeFile(path.join(unitRoot, "vibe64-staging-other-cafe-222222222222.service"), unitFor({ username: "v64s_other" }, 4200),
    { mode: 0o644 });
  await writeFile(path.join(unitRoot, "unrelated.service"), "SocketBindAllow=tcp:4300\n", { mode: 0o644 });
  const claim = (user, unitName, loopbackPort) => assertStagingUnitClaim({ loopbackPort, owner, unitName, unitRoot,
    unitUid: UID, user });
  const shopUnit = "vibe64-staging-test-my-shop-333333333333.service";

  claim(shop, shopUnit, 4101);
  claim(shop, shopUnit, 4300);
  assert.throws(() => claim(shop, shopUnit, 4100), /Port 4100 belongs to another staging service/u, "another application's");
  assert.throws(() => claim(shop, shopUnit, 4200), /Port 4200 belongs to another staging service/u, "another workspace's");
  assert.throws(() => claim(shop, "vibe64-staging-test-books-444444444444.service", 4101), /not named for application/u);
  assert.throws(() => claim(shop, "vibe64-staging-other-my-shop-444444444444.service", 4101), /not named for application/u);
  // An installed unit is replaced only by its own application.
  assert.throws(() => claim(shop, "vibe64-staging-test-books-111111111111.service", 4100), /not named for application/u);
  await writeFile(path.join(unitRoot, shopUnit), unitFor(books, 4101), { mode: 0o644 });
  assert.throws(() => claim(shop, shopUnit, 4101), /belongs to another account/u);
  await writeFile(path.join(unitRoot, shopUnit), unitFor(shop, 4101), { mode: 0o644 });
  claim(shop, shopUnit, 4101);
  // Only unit files root alone may change count.
  await chmod(path.join(unitRoot, shopUnit), 0o666);
  assert.throws(() => claim(shop, shopUnit, 4101), { code: "EVIBE64UNSAFEFILE" });
});

test("another workspace's odd staging unit never stops this one, and its own odd unit is refused by name", async (t) => {
  const host = await stagingAccountHost(t);
  const account = host.ensure("shop");
  const unitRoot = host.options.unitRoot;
  const shopUnit = "vibe64-staging-test-shop-333333333333.service";
  const claim = (loopbackPort) => assertStagingUnitClaim({ loopbackPort, owner: host.owner, unitName: shopUnit, unitRoot,
    unitUid: UID, user: { stagingAccount: { project: "shop" }, username: account.username } });
  // Another workspace's units that are no unit root wrote: a mask, an
  // oversized file and one others may change. None claims its port.
  await symlink("/dev/null", path.join(unitRoot, "vibe64-staging-other-cafe-111111111111.service"));
  await writeFile(path.join(unitRoot, "vibe64-staging-other-cafe-222222222222.service"), "x".repeat(65 * 1024), { mode: 0o644 });
  await writeFile(path.join(unitRoot, "vibe64-staging-other-cafe-333333333333.service"), "SocketBindAllow=tcp:4102\n");
  await chmod(path.join(unitRoot, "vibe64-staging-other-cafe-333333333333.service"), 0o666);
  claim(4101);
  claim(4102);

  // One of this workspace's own is refused, by name, as is retiring past it.
  await symlink("/dev/null", path.join(unitRoot, "vibe64-staging-test-blog-444444444444.service"));
  const refused = /Staging unit vibe64-staging-test-blog-444444444444\.service of workspace test is not a unit file root wrote/u;
  assert.throws(() => claim(4101), refused);
  assert.throws(() => host.retire("shop"), refused);
  await rm(path.join(unitRoot, "vibe64-staging-test-blog-444444444444.service"));
  assert.equal(host.retire("shop").retired, true);
});

test("only an application's registered account installs a staging service", async () => {
  const source = await execHelperSource();
  const operation = source.slice(source.indexOf("function handleStagingUnitOperation("),
    source.indexOf("function inspectStagingUnit("));
  assert.match(operation, /const user = registeredStagingAccount\(owner, payload\.stagingAccount\);/u);
  assert.match(operation, /stagingUnitFiles\(payload, user\.stagingAccount, \{ daemonUid: owner\.uid, gid: user\.gid \}\)/u);
  // The claim reads the same unit folder the unit then goes to.
  assert.match(operation, /assertStagingUnitClaim\(\{ loopbackPort, owner, unitName, unitRoot, user \}\);/u);
  assert.doesNotMatch(source, /upgrade-release-units|resolveAllowedDeploymentServicePath/u);
});
