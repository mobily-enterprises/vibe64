import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  applicationIdentity, assertActablePerson, ensureApplicationAccount, readApplicationRegistration, registerPerson,
  retireApplicationAccount
} from "../../packages/vibe64-execution/src/host/execHelper.js";

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
  const owner = { gid: GID, home: path.join(root, "home", "v64d_test"), uid: UID, username: "v64d_test" };
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
    registryRoot: path.join(root, "etc", "vibe64", "applications"),
    registryUid: UID,
    resolveUser: (username) => accounts.get(username) || null,
    running: () => false
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
  assert.match(account.username, /^v64a_[a-f0-9]{12}$/u);
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
  assert.notEqual(applicationIdentity({ username: "v64d_other" }, "shop").username, account.username);
  assert.equal(applicationIdentity({ username: "v64d_test" }, "shop").username, account.username);
});

test("the daemon names only a project of its own workspace", async (t) => {
  const host = await applicationHost(t);
  for (const project of ["", "../shop", "Shop", "shop/app", ".", "a".repeat(49)]) {
    assert.throws(() => host.ensure(project), /invalid project name/u, project);
  }
  for (const username of ["merc", "v64a_0123456789ab", "root"]) {
    assert.throws(() => ensureApplicationAccount({ ...host.owner, username }, "shop", host.options),
      /Only a workspace daemon/u);
  }
  assert.deepEqual(host.created, []);
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
    resolveUser: (name) => (name === "v64d_test" ? host.owner : { ...appUser, uid: UID + 500 })
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
  for (const username of ["alice", "v64d_test", "root", "v64a_short"]) {
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
