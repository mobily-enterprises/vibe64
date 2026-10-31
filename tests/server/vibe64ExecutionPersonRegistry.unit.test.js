import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DAEMON_USERNAME_PREFIX, assertActablePerson, enablePerson, loginUidRange, personAccountProblem, personSudoCommands, readPersonRegistration,
  registerPerson, upgradePersonRegistry
} from "../../packages/vibe64-execution/src/host/execHelper.js";

const UID = process.getuid();
// The workspace daemon account the helper serves, as the helper names it.
const DAEMON = `${DAEMON_USERNAME_PREFIX}test`;
const LOGIN_UIDS = { max: 60000, min: 1000 };
const ACCOUNTS = {
  alice: { gid: 1001, home: "/home/alice", uid: 1001, username: "alice" },
  bob: { gid: 1002, home: "/home/bob", uid: 1002, username: "bob" },
  merc: { gid: 1000, home: "/home/merc", uid: 1000, username: "merc" },
  sshd: { gid: 65534, home: "/nonexistent", uid: 104, username: "sshd" },
  ubuntu: { gid: 1003, home: "/home/ubuntu", uid: 1003, username: "ubuntu" },
  [DAEMON]: { gid: 983, home: "", uid: 998, username: DAEMON }
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
  const daemonHome = path.join(root, "home", DAEMON);
  const users = path.join(daemonHome, ".local", "state", "vibe64", "users");
  await mkdir(users, { recursive: true });
  const owner = { home: daemonHome, uid: UID, username: DAEMON };
  const accounts = { ...ACCOUNTS, [DAEMON]: { ...ACCOUNTS[DAEMON], home: daemonHome, uid: UID } };
  const facts = { ...HOST_FACTS };
  const added = [];
  const registry = {
    facts: (username) => facts[username],
    registryRoot: path.join(root, "etc", "vibe64", "people"),
    registryUid: UID
  };
  const resolveUser = (name) => {
    if (!accounts[name]) throw new Error(`OS user was not found: ${name}`);
    return accounts[name];
  };
  const personOptions = { ...registry, addToGroup: (name) => added.push(name), resolveUser };
  return {
    accounts, added, facts, owner, registry, resolveUser, root, users,
    // What the daemon itself can write: its own membership records.
    member: (username, status = "active") => writeFile(path.join(users, `${username}.json`),
      JSON.stringify({ role: "member", status, username })),
    enable: (username) => enablePerson("test", username, personOptions),
    register: (username) => registerPerson("test", username, personOptions)
  };
}

test("an account the daemon merely names is never a person it can enable or act as", async (t) => {
  const host = await workspaceHost(t);
  // The escalation: the daemon writes ubuntu's membership itself, then asks
  // the helper to enable ubuntu and to run bash as ubuntu.
  await host.member("ubuntu");
  await host.member("bob");
  for (const username of ["ubuntu", "bob"]) {
    assert.throws(() => host.enable(username), (error) => error.exitCode === 3 &&
      /not registered as a Vibe64 person of workspace test/u.test(error.message) &&
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
  assert.doesNotThrow(() => host.enable("alice"));
  assert.deepEqual(host.added, ["alice", "alice"]);

  // Another workspace's daemon cannot act as this workspace's person.
  assert.throws(() => assertActablePerson({ ...host.owner, username: `${DAEMON_USERNAME_PREFIX}other` }, host.accounts.alice, host.registry),
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

test("a registered person who later gains administrator power is refused at the next command", async (t) => {
  const host = await workspaceHost(t);
  await host.member("alice");
  host.register("alice");
  for (const facts of [
    { ...HOST_FACTS.alice, groups: ["alice", "vibe64", "sudo"] },
    { ...HOST_FACTS.alice, groups: ["alice", "vibe64", "docker"] },
    { ...HOST_FACTS.alice, sudoListing: mayRunAll("alice") },
    { ...HOST_FACTS.alice, sudoListing: "User alice may run the following commands on host:\n    (bob) /usr/bin/true\n" },
    // An answer sudo did not give is no proof of no rules.
    { ...HOST_FACTS.alice, sudoListing: "" }
  ]) {
    host.facts.alice = facts;
    assert.throws(() => assertActablePerson(host.owner, host.accounts.alice, host.registry),
      (error) => error.exitCode === 3 && /never runs commands as an administrator/u.test(error.message));
  }
});

test("system accounts and every administrators' group are refused", () => {
  const person = { uid: 1001, username: "alice" };
  const facts = { groups: ["alice", "vibe64"], loginUids: LOGIN_UIDS, sudoListing: notAllowed("alice") };
  assert.equal(personAccountProblem(person, facts), "");
  for (const uid of [0, 104, 999, 60001, 65534, undefined, "1001"]) {
    assert.match(personAccountProblem({ ...person, uid }, facts), /is a system account/u, String(uid));
  }
  for (const group of ["adm", "admin", "disk", "docker", "incus", "incus-admin", "kmem", "libvirt", "lxd", "root",
    "shadow", "staff", "sudo", "wheel"]) {
    assert.match(personAccountProblem(person, { ...facts, groups: [...facts.groups, group] }),
      new RegExp(`administrators' group ${group}`, "u"));
  }
  assert.match(personAccountProblem(person, { ...facts, sudoListing: mayRunAll("alice") }), /has sudo rules/u);
  assert.match(personAccountProblem(person, { ...facts, sudoListing: notAllowed("alicex") }), /has sudo rules/u);
  // Another host's login range is honored.
  assert.match(personAccountProblem(person, { ...facts, loginUids: { max: 60000, min: 2000 } }), /system account/u);
});

test("only the host's exact narrow sudo commands leave an account a person", () => {
  const person = { uid: 1001, username: "merc" };
  const ownerCli = "/srv/tool/node /srv/tool/owner-cli.mjs --read-connections";
  const update = "/srv/tool/local update";
  const facts = { groups: ["merc", "vibe64"], loginUids: LOGIN_UIDS, sudoCommands: [ownerCli, update] };
  const listing = (...rules) => `User merc may run the following commands on host:\n${rules.map((rule) => `    ${rule}\n`).join("")}`;
  for (const sudoListing of [
    listing(`(root) NOPASSWD: ${ownerCli}`),
    // sudo prints one line per rule and joins a rule's commands with ", ".
    listing(`(root) NOPASSWD: ${update}, ${update}`, `(root) NOPASSWD: ${ownerCli}`),
    `Matching Defaults entries for merc on host:\n    env_reset, use_pty\n\n${listing(`(root) NOPASSWD: ${ownerCli}`)}`
  ]) {
    assert.equal(personAccountProblem(person, { ...facts, sudoListing }), "", sudoListing);
  }
  for (const sudoListing of [
    listing("(ALL) NOPASSWD: ALL"),
    listing(`(root) NOPASSWD: ${ownerCli}`, "(ALL : ALL) ALL"),
    listing(`(root) NOPASSWD: ${ownerCli} *`),
    listing(`(root) NOPASSWD: ${ownerCli}, /usr/bin/vim`),
    listing(`(root) ${ownerCli}`),
    listing(`(root) NOPASSWD: SETENV: ${ownerCli}`),
    listing(`(ALL) NOPASSWD: ${ownerCli}`),
    listing(`(bob) NOPASSWD: ${ownerCli}`),
    listing(),
    "",
    `User mercx may run the following commands on host:\n    (root) NOPASSWD: ${ownerCli}\n`
  ]) {
    assert.match(personAccountProblem(person, { ...facts, sudoListing }), /has sudo rules/u, sudoListing);
  }
  // Without the host's list, every rule is administration.
  assert.match(personAccountProblem(person, { ...facts, sudoCommands: [], sudoListing: listing(`(root) NOPASSWD: ${ownerCli}`) }),
    /has sudo rules/u);
});

test("a narrow command is recognised when sudo prints its program with links resolved", () => {
  const person = { uid: 1001, username: "merc" };
  const ownerCli = "/opt/tool/node26/bin/node /srv/tool/owner-cli.mjs --read-connections";
  // node26 links to a wrapper whose bin/node links to the runtime itself.
  const files = new Map([
    ["/opt/tool/node26/bin/node", "/nix/store/slim-node-26/bin/node"],
    ["/nix/store/wrapper-node-26/bin/node", "/nix/store/slim-node-26/bin/node"],
    ["/nix/store/slim-node-26/bin/node", "/nix/store/slim-node-26/bin/node"],
    ["/nix/store/other-node/bin/node", "/nix/store/other-node/bin/node"]
  ]);
  const resolveProgram = (program) => {
    if (!files.has(program)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files.get(program);
  };
  const facts = { groups: ["merc", "vibe64"], loginUids: LOGIN_UIDS, resolveProgram, sudoCommands: [ownerCli] };
  const listing = (command) => `User merc may run the following commands on host:\n    (root) NOPASSWD: ${command}\n`;
  for (const command of [
    ownerCli,
    // As sudo-rs 0.2 lists the owner CLI rule on Ubuntu 26.04.
    "/nix/store/wrapper-node-26/bin/node /srv/tool/owner-cli.mjs --read-connections",
    "/nix/store/slim-node-26/bin/node /srv/tool/owner-cli.mjs --read-connections"
  ]) {
    assert.equal(personAccountProblem(person, { ...facts, sudoListing: listing(command) }), "", command);
  }
  for (const command of [
    "/nix/store/other-node/bin/node /srv/tool/owner-cli.mjs --read-connections",
    "/nix/store/missing/bin/node /srv/tool/owner-cli.mjs --read-connections",
    "/nix/store/wrapper-node-26/bin/node /srv/tool/owner-cli.mjs",
    "/nix/store/wrapper-node-26/bin/node /srv/tool/other.mjs --read-connections"
  ]) {
    assert.match(personAccountProblem(person, { ...facts, sudoListing: listing(command) }), /has sudo rules/u, command);
  }
});

test("application accounts are never people", () => {
  assert.throws(() => registerPerson("shop", "v64a_shop", {
    addToGroup: () => assert.fail("joined the shared group"),
    resolveUser: () => assert.fail("looked up the account")
  }), /application accounts are never people/u);
  const facts = { groups: ["vibe64"], loginUids: LOGIN_UIDS, sudoListing: notAllowed("v64ashop") };
  assert.equal(personAccountProblem({ uid: 1500, username: "v64ashop" }, facts), "");
});

test("the host's narrow sudo commands come only from a file root alone can change", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-person-sudo-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const etc = path.join(root, "etc");
  const file = path.join(etc, "person-sudo-commands");
  assert.deepEqual(personSudoCommands(file, UID), [], "a missing list allows nothing");
  await mkdir(etc, { mode: 0o755 });
  await chmod(etc, 0o755);
  await writeFile(file, "/srv/tool/node /srv/tool/owner-cli.mjs --read-connections\n\n  /srv/tool/local update  \n",
    { mode: 0o644 });
  await chmod(file, 0o644);
  assert.deepEqual(personSudoCommands(file, UID),
    ["/srv/tool/node /srv/tool/owner-cli.mjs --read-connections", "/srv/tool/local update"]);
  await chmod(file, 0o664);
  assert.throws(() => personSudoCommands(file, UID), /not its owner's regular file/u);
  await chmod(file, 0o644);
  await chmod(etc, 0o775);
  assert.throws(() => personSudoCommands(file, UID), /only root can change/u);
  await chmod(etc, 0o755);
  await rm(file);
  await symlink(path.join(root, "elsewhere"), file);
  await writeFile(path.join(root, "elsewhere"), "/usr/bin/vim\n");
  assert.throws(() => personSudoCommands(file, UID));
  assert.throws(() => personSudoCommands(file, UID + 1), /only root can change/u);
});

test("the login range is read from login.defs, with useradd's defaults", () => {
  assert.deepEqual(loginUidRange(""), { max: 60000, min: 1000 });
  assert.deepEqual(loginUidRange("# UID_MIN 5\nUID_MIN\t\t\t 2000\nSYS_UID_MIN 100\nUID_MAX 30000\n"), { max: 30000, min: 2000 });
});

test("registration refuses system and administrator accounts and records only people", async (t) => {
  const host = await workspaceHost(t);
  for (const username of ["merc", "ubuntu", "sshd"]) {
    assert.throws(() => host.register(username), (error) => error.exitCode === 3 &&
      /never runs commands as an administrator or system account/u.test(error.message));
    assert.equal(readPersonRegistration("test", username, host.registry), null);
  }
  assert.throws(() => host.register("root"), /Privileged Unix accounts/u);
  assert.throws(() => host.register(DAEMON), /daemon Unix accounts/u);
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

test("the existing people of a workspace are registered once, without its administrators", async (t) => {
  const host = await workspaceHost(t);
  // As sas has them: the owner and ubuntu hold sudo, two members, a system
  // account in the shared group, and a membership the daemon wrote for an
  // account no root setup ever put in the shared group.
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
    ...host.registry, report: (line) => lines.push(line), resolveUser: host.resolveUser
  });

  assert.deepEqual(upgrade(), { imported: ["alice"], refused: ["merc", "sshd", "ubuntu"] });
  assert.deepEqual(await readdir(host.registry.registryRoot), ["test"]);
  assert.deepEqual(await readdir(path.join(host.registry.registryRoot, "test")), ["alice.json"]);
  assert.deepEqual(lines, [
    "[vibe64-exec-helper] Registered alice as a Vibe64 person of test.",
    "[vibe64-exec-helper] Not registering merc as a Vibe64 person of test: merc is in the administrators' group sudo.",
    "[vibe64-exec-helper] Not registering sshd as a Vibe64 person of test: sshd is a system account (uid 104), not a person's login.",
    "[vibe64-exec-helper] Not registering ubuntu as a Vibe64 person of test: ubuntu is in the administrators' group adm."
  ]);

  // Once the workspace has its registry, a later membership registers no one.
  host.facts.bob = { ...HOST_FACTS.bob, groups: ["bob", "vibe64"] };
  assert.deepEqual(upgrade(), { imported: [], refused: [] });
  assert.deepEqual(await readdir(path.join(host.registry.registryRoot, "test")), ["alice.json"]);
});

test("a workspace without memberships still receives its empty registry", async (t) => {
  const host = await workspaceHost(t);
  await rm(host.users, { recursive: true });
  assert.deepEqual(upgradePersonRegistry("test", { ...host.registry, report: () => {}, resolveUser: host.resolveUser }),
    { imported: [], refused: [] });
  assert.deepEqual(await readdir(path.join(host.registry.registryRoot, "test")), []);
  // A registry root anyone may change is refused rather than used.
  await rm(path.join(host.registry.registryRoot, "test"), { recursive: true });
  await chmod(host.registry.registryRoot, 0o777);
  assert.throws(() => upgradePersonRegistry("test", { ...host.registry, report: () => {}, resolveUser: host.resolveUser }),
    /only root can change/u);
});

test("sudo lists each rule on one line, so a narrow command compares exactly", async () => {
  // Without a terminal, classic sudo wraps its listing at 80 columns; the
  // helper asks for a width no rule reaches.
  const source = await readFile(new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url), "utf8");
  assert.match(source, /spawnSync\("\/usr\/bin\/sudo", \["-n", "-l", "-U", username\], \{\n {4}encoding: "utf8",\n {4}env: \{ COLUMNS: "100000", LANG: "C", LC_ALL: "C", PATH: "[^"]+" \}\n {2}\}\);/u);
  // A rule sudo still wrapped is never taken for a narrow one.
  const wrapped = "User merc may run the following commands on host:\n    (root) NOPASSWD: /srv/tool/node\n        /srv/tool/cli.mjs --read\n";
  assert.match(personAccountProblem(ACCOUNTS.merc, {
    groups: ["merc"], loginUids: LOGIN_UIDS, sudoCommands: ["/srv/tool/node /srv/tool/cli.mjs --read"], sudoListing: wrapped
  }), /has sudo rules/u);
});
