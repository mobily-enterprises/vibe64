import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertActablePerson, enablePerson, loginUidRange, personAccountProblem, readPersonRegistration,
  registerPerson, upgradePersonRegistry
} from "../../packages/vibe64-execution/src/host/execHelper.js";

const UID = process.getuid();
const LOGIN_UIDS = { max: 60000, min: 1000 };
const ACCOUNTS = {
  alice: { gid: 1001, home: "/home/alice", uid: 1001, username: "alice" },
  bob: { gid: 1002, home: "/home/bob", uid: 1002, username: "bob" },
  merc: { gid: 1000, home: "/home/merc", uid: 1000, username: "merc" },
  sshd: { gid: 65534, home: "/nonexistent", uid: 104, username: "sshd" },
  ubuntu: { gid: 1003, home: "/home/ubuntu", uid: 1003, username: "ubuntu" },
  v64d_test: { gid: 983, home: "", uid: 998, username: "v64d_test" }
};
const notAllowed = (username) => `User ${username} is not allowed to run sudo on host.\n`;
const mayRunAll = (username) => `User ${username} may run the following commands on host:\n    (ALL) NOPASSWD: ALL\n`;
// The host as sas has it: merc and ubuntu hold sudo, the others are people.
const HOST_FACTS = {
  alice: { groups: ["alice", "vibe64"], loginUids: LOGIN_UIDS, sudoListing: notAllowed("alice") },
  bob: { groups: ["bob"], loginUids: LOGIN_UIDS, sudoListing: notAllowed("bob") },
  merc: { groups: ["merc", "sudo", "vibe64"], loginUids: LOGIN_UIDS, sudoListing: mayRunAll("merc") },
  sshd: { groups: ["nogroup", "vibe64"], loginUids: LOGIN_UIDS, sudoListing: notAllowed("sshd") },
  ubuntu: { groups: ["ubuntu", "adm", "sudo", "lxd", "vibe64"], loginUids: LOGIN_UIDS, sudoListing: mayRunAll("ubuntu") }
};

async function workspaceHost(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-person-registry-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const daemonHome = path.join(root, "home", "v64d_test");
  const users = path.join(daemonHome, ".local", "state", "vibe64", "users");
  await mkdir(users, { recursive: true });
  const owner = { home: daemonHome, uid: UID, username: "v64d_test" };
  const accounts = { ...ACCOUNTS, v64d_test: { ...ACCOUNTS.v64d_test, home: daemonHome, uid: UID } };
  const facts = { ...HOST_FACTS };
  const added = [];
  const registry = {
    facts: (username) => facts[username],
    registryRoot: path.join(root, "etc", "vibe64", "people"),
    registryUid: UID
  };
  return {
    accounts, added, facts, owner, registry, root, users,
    // What the daemon itself can write: its own membership records.
    member: (username, status = "active") => writeFile(path.join(users, `${username}.json`),
      JSON.stringify({ role: "member", status, username })),
    register: (username) => registerPerson("test", username, {
      ...registry, addToGroup: (name) => added.push(name), resolveUser: (name) => {
        if (!accounts[name]) throw new Error(`OS user was not found: ${name}`);
        return accounts[name];
      }
    })
  };
}

test("an account the daemon merely names is never a person it can enable or act as", async (t) => {
  const host = await workspaceHost(t);
  // The escalation: the daemon writes ubuntu's membership itself, then asks
  // the helper to enable ubuntu and to run bash as ubuntu.
  await host.member("ubuntu");
  await host.member("bob");
  for (const username of ["ubuntu", "bob"]) {
    assert.throws(() => enablePerson("test", username, {
      ...host.registry, addToGroup: (name) => host.added.push(name), resolveUser: (name) => host.accounts[name]
    }), (error) => error.exitCode === 3 && /not registered as a Vibe64 person of workspace test/u.test(error.message) &&
      new RegExp(`register-person test ${username}$`, "u").test(error.message));
    assert.throws(() => assertActablePerson(host.owner, host.accounts[username], host.registry), /not registered/u);
  }
  assert.deepEqual(host.added, [], "no account joined the shared group");
});

test("the helper acts as a person root registered for the daemon's own workspace", async (t) => {
  const host = await workspaceHost(t);
  await host.member("alice");
  host.register("alice");
  assert.doesNotThrow(() => assertActablePerson(host.owner, host.accounts.alice, host.registry));
  assert.doesNotThrow(() => enablePerson("test", "alice", {
    ...host.registry, addToGroup: (name) => host.added.push(name), resolveUser: (name) => host.accounts[name]
  }));
  assert.deepEqual(host.added, ["alice", "alice"]);

  // Another workspace's daemon cannot act as this workspace's person.
  assert.throws(() => assertActablePerson({ ...host.owner, username: "v64d_other" }, host.accounts.alice, host.registry),
    /not registered as a Vibe64 person of workspace other/u);
  // Only a workspace daemon acts as people at all.
  assert.throws(() => assertActablePerson({ ...host.owner, username: "merc" }, host.accounts.alice, host.registry),
    /Only a workspace daemon/u);
  // An account later recreated under the same name is a different account.
  assert.throws(() => assertActablePerson(host.owner, { ...host.accounts.alice, uid: 1005 }, host.registry), /not registered/u);
  // The daemon's own state still decides whom of its people it enables.
  await host.member("alice", "disabled");
  assert.throws(() => assertActablePerson(host.owner, host.accounts.alice, host.registry), /not enabled for Vibe64/u);
  await host.member("alice");
  // A person removed from the shared group is not acted as.
  host.facts.alice = { ...host.facts.alice, groups: ["alice"] };
  assert.throws(() => assertActablePerson(host.owner, host.accounts.alice, host.registry), /shared Vibe64 group/u);
});

test("system accounts are refused", () => {
  const person = { uid: 1001, username: "alice" };
  const facts = { groups: ["alice", "vibe64"], loginUids: LOGIN_UIDS };
  assert.equal(personAccountProblem(person, facts), "");
  for (const uid of [0, 104, 999, 60001, 65534, undefined, "1001"]) {
    assert.match(personAccountProblem({ ...person, uid }, facts), /is a system account/u, String(uid));
  }
  // Another host's login range is honored.
  assert.match(personAccountProblem(person, { ...facts, loginUids: { max: 60000, min: 2000 } }), /system account/u);
});

test("the login range is read from login.defs, with useradd's defaults", () => {
  assert.deepEqual(loginUidRange(""), { max: 60000, min: 1000 });
  assert.deepEqual(loginUidRange("# UID_MIN 5\nUID_MIN\t\t\t 2000\nSYS_UID_MIN 100\nUID_MAX 30000\n"), { max: 30000, min: 2000 });
});

test("registration refuses system accounts and records only people", async (t) => {
  const host = await workspaceHost(t);
  assert.throws(() => host.register("sshd"), (error) => error.exitCode === 3 &&
    /never runs commands as a system account: sshd is a system account \(uid 104\)/u.test(error.message));
  assert.equal(readPersonRegistration("test", "sshd", host.registry), null);
  assert.throws(() => host.register("root"), /Privileged Unix accounts/u);
  assert.throws(() => host.register("v64d_test"), /daemon Unix accounts/u);
  assert.throws(() => registerPerson("Bad/Name", "alice", host.registry), /invalid workspace name/u);
  assert.deepEqual(host.added, []);

  host.register("alice");
  assert.deepEqual(host.added, ["alice"]);
  const file = path.join(host.registry.registryRoot, "test", "alice.json");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")),
    { schema: "vibe64.person-registration", schemaVersion: 1, uid: 1001, username: "alice" });
  assert.equal((await stat(file)).mode & 0o777, 0o644);
  assert.deepEqual(readPersonRegistration("test", "alice", host.registry), { uid: 1001, username: "alice" });
});

test("a registration only root could have written is the only registration", async (t) => {
  const host = await workspaceHost(t);
  await host.member("alice");
  host.register("alice");
  const workspaceRegistry = path.join(host.registry.registryRoot, "test");
  const file = path.join(workspaceRegistry, "alice.json");
  const actable = () => assertActablePerson(host.owner, host.accounts.alice, host.registry);
  assert.doesNotThrow(actable);

  // Not root's: the registry as another user would own it.
  assert.throws(() => assertActablePerson(host.owner, host.accounts.alice, { ...host.registry, registryUid: UID + 1 }), /not registered/u);
  for (const target of [file, workspaceRegistry, host.registry.registryRoot]) {
    await chmod(target, target === file ? 0o666 : 0o777);
    assert.throws(actable, /not registered/u, `${target} writable by others`);
    await chmod(target, target === file ? 0o644 : 0o755);
    assert.doesNotThrow(actable);
  }
  // A link in place of the workspace's registry or of the registration.
  const elsewhere = path.join(host.root, "elsewhere");
  await rename(workspaceRegistry, elsewhere);
  await symlink(elsewhere, workspaceRegistry);
  assert.throws(actable, /not registered/u);
  await rm(workspaceRegistry);
  await rename(elsewhere, workspaceRegistry);
  await rename(file, path.join(host.root, "alice.json"));
  await symlink(path.join(host.root, "alice.json"), file);
  assert.throws(actable, /not registered/u);
  await rm(file);
  for (const record of ["", "{", JSON.stringify({ uid: 1001, username: "alice" }),
    JSON.stringify({ schema: "vibe64.person-registration", schemaVersion: 1, uid: 1001, username: "bob" })]) {
    await writeFile(file, record, { mode: 0o644 });
    assert.throws(actable, /not registered/u);
    await rm(file);
  }
});

test("the existing people of a workspace are registered once, without system accounts", async (t) => {
  const host = await workspaceHost(t);
  // As sas has them: the owner, two members, a system account in the shared
  // group, and a membership the daemon wrote for an account no root setup ever
  // put in the shared group.
  await host.member("merc");
  await host.member("alice", "disabled");
  await host.member("ubuntu");
  await host.member("bob");
  await host.member("sshd");
  await writeFile(path.join(host.users, "zed.json"), JSON.stringify({ status: "active", username: "someone" }));
  await writeFile(path.join(host.users, "notes.txt"), "not a membership");
  await mkdir(host.registry.registryRoot, { mode: 0o755, recursive: true });
  await chmod(host.registry.registryRoot, 0o755);
  await mkdir(path.join(host.registry.registryRoot, ".test.upgrading"));
  await writeFile(path.join(host.registry.registryRoot, ".test.upgrading", "bob.json"), "left by an interrupted run");
  const lines = [];
  const upgrade = () => upgradePersonRegistry("test", {
    ...host.registry, report: (line) => lines.push(line), resolveUser: (name) => {
      if (!host.accounts[name]) throw new Error(`OS user was not found: ${name}`);
      return host.accounts[name];
    }
  });

  assert.deepEqual(upgrade(), { imported: ["alice", "merc", "ubuntu"], refused: ["sshd"] });
  assert.deepEqual(await readdir(host.registry.registryRoot), ["test"]);
  assert.deepEqual(await readdir(path.join(host.registry.registryRoot, "test")), ["alice.json", "merc.json", "ubuntu.json"]);
  assert.deepEqual(lines, [
    "[vibe64-exec-helper] Registered alice as a Vibe64 person of test.",
    "[vibe64-exec-helper] Registered merc as a Vibe64 person of test.",
    "[vibe64-exec-helper] Not registering sshd as a Vibe64 person of test: sshd is a system account (uid 104), not a person's login.",
    "[vibe64-exec-helper] Registered ubuntu as a Vibe64 person of test."
  ]);

  // Once the workspace has its registry, a later membership registers no one.
  host.facts.bob = { ...HOST_FACTS.bob, groups: ["bob", "vibe64"] };
  assert.deepEqual(upgrade(), { imported: [], refused: [] });
  assert.deepEqual(await readdir(path.join(host.registry.registryRoot, "test")), ["alice.json", "merc.json", "ubuntu.json"]);
});

test("a workspace without memberships still receives its empty registry", async (t) => {
  const host = await workspaceHost(t);
  await rm(host.users, { recursive: true });
  assert.deepEqual(upgradePersonRegistry("test", {
    ...host.registry, report: () => {}, resolveUser: (name) => host.accounts[name]
  }), { imported: [], refused: [] });
  assert.deepEqual(await readdir(path.join(host.registry.registryRoot, "test")), []);
  // A registry root anyone may change is refused rather than used.
  await rm(path.join(host.registry.registryRoot, "test"), { recursive: true });
  await chmod(host.registry.registryRoot, 0o777);
  assert.throws(() => upgradePersonRegistry("test", { ...host.registry, report: () => {},
    resolveUser: (name) => host.accounts[name] }), /only root can change/u);
});
