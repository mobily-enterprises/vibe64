import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { helperSystemdUnitRoot as exportedSystemdUnitRoot } from "@local/vibe64-execution/server/hostSettings";
import { helperSettings } from "../../packages/vibe64-execution/src/host/commandEnvironment.js";
import { addUserToGroup, createPerson, hostSettingsRoot } from "../../packages/vibe64-execution/src/host/hostAccounts.js";
import {
  helperAccountDatabase,
  helperAccountNumberOptions,
  helperCommand,
  helperPersonShell,
  helperRuntimePackRoot,
  helperStagingKeysRoot,
  helperSudoersRoot,
  helperSystemdUnitRoot
} from "../../packages/vibe64-execution/src/host/hostSettings.js";
import { installSystemdUnit, relinkSystemdUnits } from "../../packages/vibe64-execution/src/host/serviceOperations.js";
import { execHelperSource } from "../fixtures/execHelperSource.js";
import { assertDurablyReplaced, traceDurableWrites } from "./durableWriteTrace.js";

const EXEC_HELPER = fileURLToPath(new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url));
const UID = process.getuid();
const RELEASE_UNIT = "vibe64-staging-test-blog-0123456789ab.service";
const MANAGED_UNIT = "vibe64-managed-test-db.service";

async function temporaryFolder(t, prefix) {
  const folder = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(folder, { force: true, recursive: true }));
  return folder;
}

test("the host's helper settings name the account database and the unit, sudo rule and staging key folders; without them the system's own", async (t) => {
  assert.equal(helperAccountDatabase({}), "files");
  assert.equal(helperSystemdUnitRoot({}), "/etc/systemd/system");
  assert.equal(helperSudoersRoot({}), "/etc/sudoers.d");
  // The one host setup's SSH policy names for application accounts' keys.
  assert.equal(helperStagingKeysRoot({}), "/etc/vibe64/staging-ssh");

  const file = path.join(await temporaryFolder(t, "v64-host-settings-"), "exec-helper.env");
  await writeFile(file, "VIBE64_ACCOUNT_DATABASE=extrausers\nVIBE64_SYSTEM_ID_BAND=400-899\n" +
    "VIBE64_SYSTEMD_UNIT_ROOT=/srv/host/units\nVIBE64_SUDOERS_ROOT=/srv/host/sudoers\n" +
    "VIBE64_STAGING_KEYS_ROOT=/srv/host/ssh-keys\n", { mode: 0o600 });
  const settings = helperSettings(file, UID);
  assert.equal(helperAccountDatabase(settings), "extrausers");
  assert.deepEqual(helperAccountNumberOptions(settings).slice(0, 2), ["-K", "SYS_UID_MIN=400"]);
  assert.equal(helperSystemdUnitRoot(settings), "/srv/host/units");
  assert.equal(helperSudoersRoot(settings), "/srv/host/sudoers");
  assert.equal(helperStagingKeysRoot(settings), "/srv/host/ssh-keys");
  assert.equal(helperAccountDatabase({ VIBE64_ACCOUNT_DATABASE: "files" }), "files");

  for (const database of ["ldap", "Files", "files extrausers"]) {
    assert.throws(() => helperAccountDatabase({ VIBE64_ACCOUNT_DATABASE: database }),
      /unknown account database \(VIBE64_ACCOUNT_DATABASE\)/u, database);
  }
  for (const folder of ["/", "units", "/srv/../units", "/srv/units/"]) {
    assert.throws(() => helperSystemdUnitRoot({ VIBE64_SYSTEMD_UNIT_ROOT: folder }),
      /folder \(VIBE64_SYSTEMD_UNIT_ROOT\) that is not an absolute path other than \//u, folder);
    assert.throws(() => helperSudoersRoot({ VIBE64_SUDOERS_ROOT: folder }),
      /folder \(VIBE64_SUDOERS_ROOT\) that is not an absolute path other than \//u, folder);
    assert.throws(() => helperStagingKeysRoot({ VIBE64_STAGING_KEYS_ROOT: folder }),
      /folder \(VIBE64_STAGING_KEYS_ROOT\) that is not an absolute path other than \//u, folder);
  }
  // A host's own server reads the unit folder through the package.
  assert.equal(exportedSystemdUnitRoot, helperSystemdUnitRoot);
});

// A host whose runtime packs are not in the folder their tool wrappers default to names it, so the units the helper
// writes with its PATH can name it too: without it a wrapper (policy-bin's npm) looks for its pack where there is none.
test("the host's helper settings may name the runtime pack folder of its PATH's tools; without it the helper names none", async (t) => {
  assert.equal(helperRuntimePackRoot({}), "");
  assert.equal(helperRuntimePackRoot({ VIBE64_RUNTIME_PACK_ROOT: " " }), "");
  const file = path.join(await temporaryFolder(t, "v64-host-pack-root-"), "exec-helper.env");
  await writeFile(file, "PATH=/srv/apps/editor/runtime-packs/policy-bin:/usr/bin\n" +
    "VIBE64_RUNTIME_PACK_ROOT=/srv/apps/editor/runtime-packs\n", { mode: 0o600 });
  assert.equal(helperRuntimePackRoot(helperSettings(file, UID)), "/srv/apps/editor/runtime-packs");
  // It is written into a unit as it is.
  for (const folder of ["/", "runtime-packs", "/srv/../packs", "/srv/packs/", "/srv/run time/packs", "/srv/packs\"x"]) {
    assert.throws(() => helperRuntimePackRoot({ VIBE64_RUNTIME_PACK_ROOT: folder }),
      /runtime pack folder \(VIBE64_RUNTIME_PACK_ROOT\) that is not an absolute, normalized path/u, folder);
  }
});

test("the helper's settings folder is /etc/vibe64 unless VIBE64_HOST_SETTINGS_ROOT names another absolute, normalized path", () => {
  assert.equal(hostSettingsRoot({}), "/etc/vibe64");
  assert.equal(hostSettingsRoot({ VIBE64_HOST_SETTINGS_ROOT: "" }), "/etc/vibe64");
  assert.equal(hostSettingsRoot({ VIBE64_HOST_SETTINGS_ROOT: "/srv/host/vibe64" }), "/srv/host/vibe64");
  for (const folder of ["vibe64", "./vibe64", "/", "/srv/../vibe64", "/srv//vibe64", "/srv/vibe64/", "/srv/./vibe64", " /srv/vibe64"]) {
    assert.throws(() => hostSettingsRoot({ VIBE64_HOST_SETTINGS_ROOT: folder }),
      /refused its settings folder VIBE64_HOST_SETTINGS_ROOT=.*: it is not an absolute, normalized path other than \//u, folder);
  }
});

// What the helper's modules make of the variable as they load, in a process of their own: the folder, the settings
// file and people's sudo commands read from it, and the staging sandbox that hides it.
function loadedSettingsFolder(value) {
  const env = { ...process.env };
  delete env.VIBE64_HOST_SETTINGS_ROOT;
  if (value !== undefined) env.VIBE64_HOST_SETTINGS_ROOT = value;
  const modules = Object.fromEntries(["hostAccounts", "commandEnvironment", "personRegistry", "systemdUnits"]
    .map((name) => [name, new URL(`../../packages/vibe64-execution/src/host/${name}.js`, import.meta.url).href]));
  const script = `
    const modules = ${JSON.stringify(modules)};
    const { HOST_SETTINGS_ROOT } = await import(modules.hostAccounts);
    const { helperSettings } = await import(modules.commandEnvironment);
    const { personSudoCommands } = await import(modules.personRegistry);
    const { stagingSandboxLines } = await import(modules.systemdUnits);
    const uid = process.getuid();
    process.stdout.write(JSON.stringify({
      root: HOST_SETTINGS_ROOT,
      settings: HOST_SETTINGS_ROOT === "/etc/vibe64" ? null : helperSettings(undefined, uid),
      sudoCommands: HOST_SETTINGS_ROOT === "/etc/vibe64" ? null : personSudoCommands(undefined, uid),
      hidden: stagingSandboxLines({ appRoot: "/area/app", databaseRoot: "/area/database" })
        .filter((line) => line.startsWith("InaccessiblePaths="))
    }));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", env });
}

test("every path the helper keeps in its settings folder derives from the folder it read as it loaded", async (t) => {
  const folder = await temporaryFolder(t, "v64-host-settings-root-");
  await chmod(folder, 0o755);
  await writeFile(path.join(folder, "exec-helper.env"), "VIBE64_ACCOUNT_DATABASE=extrausers\n", { mode: 0o644 });
  await writeFile(path.join(folder, "person-sudo-commands"), "/usr/bin/true\n", { mode: 0o644 });

  const moved = loadedSettingsFolder(folder);
  assert.equal(moved.status, 0, moved.stderr);
  assert.deepEqual(JSON.parse(moved.stdout), {
    hidden: [`InaccessiblePaths=${folder}`],
    root: folder,
    settings: { VIBE64_ACCOUNT_DATABASE: "extrausers" },
    sudoCommands: ["/usr/bin/true"]
  });
  const unset = loadedSettingsFolder(undefined);
  assert.equal(unset.status, 0, unset.stderr);
  assert.deepEqual(JSON.parse(unset.stdout), {
    hidden: ["InaccessiblePaths=/etc/vibe64"], root: "/etc/vibe64", settings: null, sudoCommands: null
  });
  // A folder that is not an absolute, normalized path stops the helper before it does anything.
  const refused = loadedSettingsFolder(`${folder}/`);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /refused its settings folder VIBE64_HOST_SETTINGS_ROOT=/u);
  assert.equal(refused.stdout, "");

  // No other module names the default folder: each takes its paths from the one it was read into.
  const source = await execHelperSource();
  assert.equal(source.match(/"\/etc\/vibe64[/"]/gu)?.length, 1);
});

test("later runs start the helper by the command the host's settings name, else by the file it runs from", () => {
  assert.equal(helperCommand({}, "/usr/lib/vibe64/../vibe64/vibe64-exec-helper"), "/usr/lib/vibe64/vibe64-exec-helper");
  assert.equal(helperCommand({ VIBE64_EXEC_HELPER_COMMAND: " " }, "/usr/lib/vibe64/vibe64-exec-helper"),
    "/usr/lib/vibe64/vibe64-exec-helper");
  assert.equal(helperCommand({ VIBE64_EXEC_HELPER_COMMAND: "/srv/host/helpers/vibe64-exec-helper" },
    "/srv/host/helpers/exec-helper.mjs"), "/srv/host/helpers/vibe64-exec-helper");
  // A sudo rule, a unit's ExecStart and a shell function each name it, so it is one plain path.
  for (const command of ["vibe64-exec-helper", "./vibe64-exec-helper", "/", "/srv/../helper", "/srv//helper",
    "/srv/helper/", "/srv/./helper", "/srv/exec helper", "/srv/helper execute", "/srv/a,b", "/srv/a:b", "/srv/a=b",
    "/srv/$HOME", "/srv/a\"b", "/srv/a\\b", "/srv/a*", "/srv/a;b", "/srv/a`b`", "/srv/a\nb"]) {
    assert.throws(() => helperCommand({ VIBE64_EXEC_HELPER_COMMAND: command }, "/usr/lib/vibe64/vibe64-exec-helper"),
      /helper command \(VIBE64_EXEC_HELPER_COMMAND\) that is not an absolute, normalized path/u, JSON.stringify(command));
  }
});

// A host that keeps the settings folder elsewhere starts the helper through a launcher that names the folder. The
// helper's later runs go through that launcher too, once the settings it reads there name it; started by the file
// the helper runs from, they would read the system's own folder.
test("a helper started through a launcher names that launcher for its later runs when its settings say so", async (t) => {
  const folder = await temporaryFolder(t, "v64-helper-command-");
  const settingsRoot = path.join(folder, "settings");
  await mkdir(settingsRoot);
  await chmod(settingsRoot, 0o755);
  const bundle = path.join(folder, "exec-helper.mjs");
  const launcher = path.join(folder, "vibe64-exec-helper");
  const modules = Object.fromEntries(["commandEnvironment", "hostSettings"]
    .map((name) => [name, new URL(`../../packages/vibe64-execution/src/host/${name}.js`, import.meta.url).href]));
  await writeFile(bundle, `
    const { helperSettings } = await import(${JSON.stringify(modules.commandEnvironment)});
    const { helperCommand } = await import(${JSON.stringify(modules.hostSettings)});
    process.stdout.write(helperCommand(helperSettings(undefined, process.getuid())));
  `, { mode: 0o644 });
  await writeFile(launcher, `#!/bin/sh\nVIBE64_HOST_SETTINGS_ROOT=${settingsRoot}\nexport VIBE64_HOST_SETTINGS_ROOT\n` +
    `exec "${process.execPath}" "${bundle}" "$@"\n`, { mode: 0o755 });
  const command = () => {
    const ran = spawnSync(launcher, [], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    return ran.stdout;
  };

  assert.equal(command(), bundle, "a host whose settings name no command, as before");
  await writeFile(path.join(settingsRoot, "exec-helper.env"), `VIBE64_EXEC_HELPER_COMMAND=${launcher}\n`, { mode: 0o644 });
  assert.equal(command(), launcher);
});

test("every later run of the helper starts it by the command the host's settings name", async () => {
  const source = await execHelperSource();
  // The file the helper runs from is read twice: as that command's default, and by the usage recorder, which loads
  // from beside it.
  assert.equal(source.match(/process\.argv\[1\]/gu)?.length, 2);
  for (const [later, pattern] of [
    ["the staging sudo rule", /installStagingAccess\(registeredStagingAccount\(owner, identity\.username\), publicKey, helperCommand\(\)\);/u],
    ["the staging shell's commands", /function runStagingShell\(\{ env = process\.env, helperPath = helperCommand\(\) \} = \{\}\)/u],
    ["staging-enter", /stagingEnterCommand\(\{ command, env, helperPath: helperCommand\(\), mountNamespace/u],
    ["a staging unit's ExecStart", /helperPath: helperCommand\(\),\n\s*loopbackPort,/u],
    ["a managed run", /const helperPath = helperCommand\(\);\n\s*const systemdArgs = \[/u],
    ["registering a person, as the refusal says", /registers an existing account with: sudo \$\{helperCommand\(\)\} `/u]
  ]) {
    assert.match(source, pattern, later);
  }
});

test("the helper numbers new accounts in the bands the host's settings name; without them by the system's ranges", () => {
  assert.deepEqual(helperAccountNumberOptions({}), []);
  assert.deepEqual(helperAccountNumberOptions({ VIBE64_SYSTEM_ID_BAND: "400-899" }), [
    "-K", "SYS_UID_MIN=400", "-K", "SYS_UID_MAX=899", "-K", "SYS_GID_MIN=400", "-K", "SYS_GID_MAX=899"
  ]);
  assert.deepEqual(helperAccountNumberOptions({ VIBE64_SYSTEM_ID_BAND: "400-400" }),
    ["-K", "SYS_UID_MIN=400", "-K", "SYS_UID_MAX=400", "-K", "SYS_GID_MIN=400", "-K", "SYS_GID_MAX=400"]);
  assert.deepEqual(helperAccountNumberOptions({ VIBE64_SYSTEM_ID_BAND: "400-899", VIBE64_PERSON_ID_BAND: "20000-29999" }), [
    "-K", "SYS_UID_MIN=400", "-K", "SYS_UID_MAX=899", "-K", "SYS_GID_MIN=400", "-K", "SYS_GID_MAX=899",
    "-K", "UID_MIN=20000", "-K", "UID_MAX=29999", "-K", "GID_MIN=20000", "-K", "GID_MAX=29999"
  ]);
  assert.deepEqual(helperAccountNumberOptions({ VIBE64_PERSON_ID_BAND: "20000-20000" }),
    ["-K", "UID_MIN=20000", "-K", "UID_MAX=20000", "-K", "GID_MIN=20000", "-K", "GID_MAX=20000"]);
  for (const band of ["899-400", "0-899", "400", "400-", "-400-899", "400-65534", "04-899", "400-899x", "400–899"]) {
    assert.throws(() => helperAccountNumberOptions({ VIBE64_SYSTEM_ID_BAND: band }),
      /band of account numbers \(VIBE64_SYSTEM_ID_BAND\)/u, band);
    assert.throws(() => helperAccountNumberOptions({ VIBE64_PERSON_ID_BAND: band }),
      /band of account numbers \(VIBE64_PERSON_ID_BAND\)/u, band);
  }
});

test("people and memberships go to the account database the host names, people without a password", async (t) => {
  const bin = await temporaryFolder(t, "v64-account-tools-");
  const homes = await temporaryFolder(t, "v64-person-homes-");
  const log = path.join(bin, "calls.log");
  for (const tool of ["useradd", "usermod", "gpasswd", "chpasswd", "passwd"]) {
    await writeFile(path.join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> "${log}"\n`, { mode: 0o755 });
  }
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  // The mode a home is made with is the one asked for, whatever the umask.
  const previousUmask = process.umask(0o077);
  t.after(() => {
    process.env.PATH = previousPath;
    process.umask(previousUmask);
  });
  const username = "v64hostsettingsprobe";
  const person = { gid: process.getgid(), home: path.join(homes, username), uid: UID, username };
  const resolveUser = (name) => (name === username ? person : assert.fail(`resolved ${name}`));

  assert.equal(createPerson(username, { homeRoot: homes, numberOptions: ["-K", "UID_MIN=20000"], resolveUser }), person);
  addUserToGroup(username, "vibe64", "files");
  const home = await stat(person.home);
  assert.ok(home.isDirectory());
  assert.equal(home.mode & 0o7777, 0o750, "an empty home of the person's own, 0750");
  assert.equal(home.uid, UID);
  assert.deepEqual(await readdir(person.home), []);
  // A home already there is the person's data and stays as it is.
  await chmod(person.home, 0o700);
  await writeFile(path.join(person.home, "notes.txt"), "mine");
  createPerson(username, { database: "extrausers", homeRoot: homes, shell: "/usr/lib/host/shell", resolveUser });
  addUserToGroup(username, "vibe64", "extrausers");
  assert.equal((await stat(person.home)).mode & 0o7777, 0o700);
  assert.deepEqual(await readdir(person.home), ["notes.txt"]);

  assert.deepEqual((await readFile(log, "utf8")).trim().split("\n"), [
    `useradd -K UID_MIN=20000 --user-group --no-create-home --home-dir ${person.home} --shell /bin/bash ${username}`,
    `usermod -a -G vibe64 ${username}`,
    // No password is set: no chpasswd or passwd ran.
    `useradd --extrausers --user-group --no-create-home --home-dir ${person.home} --shell /usr/lib/host/shell ${username}`,
    // usermod has no --extrausers and its -a -G leaves such a group unchanged.
    `gpasswd --extrausers -a ${username} vibe64`
  ]);
});

test("the host's helper settings may name a person's login shell; without it /bin/bash", () => {
  assert.equal(helperPersonShell({}), "/bin/bash");
  assert.equal(helperPersonShell({ VIBE64_PERSON_SHELL: "/usr/lib/host/login-shell" }), "/usr/lib/host/login-shell");
  // A setting's surrounding blanks are not part of it, as for every other setting.
  assert.equal(helperPersonShell({ VIBE64_PERSON_SHELL: " /bin/zsh " }), "/bin/zsh");
  for (const shell of ["bash", "/bin/../bin/bash", "/bin/ba sh", "/bin/bash\n/bin/sh", "/bin/bash/", "/"]) {
    assert.throws(() => helperPersonShell({ VIBE64_PERSON_SHELL: shell }),
      /a person's login shell \(VIBE64_PERSON_SHELL\) that is not an absolute, normalized path/u, shell);
  }
});

test("the helper's people, memberships, staging accounts, unit readers and sudo rules all follow the host's settings", async () => {
  const source = await execHelperSource();

  assert.match(source, /create = \(name\) => createPerson\(name, \{\n\s*database: helperAccountDatabase\(\),\n\s*numberOptions: helperAccountNumberOptions\(\),\n\s*shell: helperPersonShell\(\)\n\s*\}\),/u);
  assert.equal(source.match(/addToGroup = \(name\) => addUserToGroup\(name, VIBE64_GROUP, helperAccountDatabase\(\)\),/gu)?.length,
    1, "registering a person");
  assert.equal(source.match(/addToGroup = \(name, group\) => addUserToGroup\(name, group, helperAccountDatabase\(\)\),/gu)?.length,
    1, "adding a person");
  assert.match(source,
    /runRootCommand\("useradd", \[\.\.\.accountDatabaseOptions\(helperAccountDatabase\(\)\),\n\s*\.\.\.helperAccountNumberOptions\(\), "--system",/u);
  assert.match(source, /runRootCommand\("userdel", \[\.\.\.accountDatabaseOptions\(helperAccountDatabase\(\)\), username\]\)/u);
  assert.equal(source.match(/accountDatabase = helperAccountDatabase\(\),/gu)?.length, 2, "granting and revoking staging access");
  // Only the settings reader names systemd's and sudo's own folders; every reader and writer asks it.
  assert.equal(source.match(/"\/etc\/systemd\/system"/gu)?.length, 1);
  assert.equal(source.match(/"\/etc\/sudoers\.d"/gu)?.length, 1);
  assert.equal(source.match(/sudoersRoot = helperSudoersRoot\(\)/gu)?.length, 3, "the rule's path, grant and revoke");
  // Only the settings reader names the staging key folder; the key's path, the check that access is granted, the
  // folder's own check, grant and revoke ask it.
  assert.equal(source.match(/"staging-ssh"/gu)?.length, 1);
  assert.equal(source.match(/keysRoot = helperStagingKeysRoot\(\)/gu)?.length, 5,
    "the key's path, the granted check, the folder check, grant and revoke");
  for (const reader of ["function installedStagingUnits", "function assertStagingUnitClaim", "function retireStagingAccount"]) {
    const start = source.indexOf(reader);
    assert.match(source.slice(start, source.indexOf(") {\n", start)), /unitRoot = helperSystemdUnitRoot\(\)/u, reader);
  }
  assert.match(source, /assertStagingUnitClaim\(\{ loopbackPort, owner, unitName, unitRoot, user \}\);\n\s*const unitPath = systemdUnitPath\(unitName, owner, unitRoot\);/u);
  // Removing a staging unit outside systemd's own folder takes its runtime link and boot target away.
  assert.match(source, /"disable",\n\s*\.\.\.\(unitRoot === SYSTEMD_UNIT_ROOT \? \[\] : \["--runtime"\]\),\n\s*unitName/u);
  assert.match(source, /unlinkSync\(systemdUnitPath\(unitName, owner, unitRoot\)\)/u);
});

// systemd's own folder stands in through its name; any other unit folder is a temporary one whose owner, the
// test's uid, stands in for root.
function unitHost() {
  const commands = [];
  const failing = new Set();
  return {
    commands,
    failing,
    run: (command, args) => {
      commands.push([command, ...args].join(" "));
      if (command === "mv") renameSync(args[0], args[1]);
      return "";
    },
    runAllowFailure: (command, args) => {
      const line = [command, ...args].join(" ");
      commands.push(line);
      return failing.has(line) ? { status: 1, stderr: "Unit file is masked.\n", stdout: "" } : { status: 0, stderr: "", stdout: "" };
    }
  };
}

test("a unit in systemd's own folder is enabled by name; one in another folder is linked into systemd's runtime folder", async (t) => {
  const folder = await temporaryFolder(t, "v64-units-");
  const install = (host, options) => installSystemdUnit({
    rootUid: UID, run: host.run, runAllowFailure: host.runAllowFailure, unit: "[Service]\n", ...options
  });

  let host = unitHost();
  install(host, { activation: "restart", unitName: RELEASE_UNIT, unitPath: path.join(folder, RELEASE_UNIT), unitRoot: "/etc/systemd/system" });
  assert.deepEqual(host.commands.slice(1), [
    "systemctl daemon-reload",
    `systemctl enable ${RELEASE_UNIT}`,
    `systemctl reset-failed ${RELEASE_UNIT}`,
    `systemctl restart ${RELEASE_UNIT}`
  ]);
  host = unitHost();
  install(host, { enable: false, unitName: MANAGED_UNIT, unitPath: path.join(folder, MANAGED_UNIT), unitRoot: "/etc/systemd/system" });
  assert.deepEqual(host.commands.slice(1), ["systemctl daemon-reload", `systemctl reset-failed ${MANAGED_UNIT}`, `systemctl start ${MANAGED_UNIT}`]);

  host = unitHost();
  // Every account reads a unit, whatever umask sudo gave the helper (sudo-rs merges the caller's 0007 with its 0022).
  const umask = process.umask(0o027);
  try {
    install(host, { activation: "restart", unitName: RELEASE_UNIT, unitPath: path.join(folder, RELEASE_UNIT), unitRoot: folder });
  } finally {
    process.umask(umask);
  }
  assert.match(host.commands[0], new RegExp(`^mv \\S+\\.tmp-\\d+ ${path.join(folder, RELEASE_UNIT)}$`, "u"));
  assert.deepEqual(host.commands.slice(1), [
    `systemctl enable --runtime ${path.join(folder, RELEASE_UNIT)}`,
    "systemctl daemon-reload",
    `systemctl reset-failed ${RELEASE_UNIT}`,
    `systemctl restart ${RELEASE_UNIT}`
  ]);
  assert.equal(await readFile(path.join(folder, RELEASE_UNIT), "utf8"), "[Service]\n");
  assert.equal((await stat(path.join(folder, RELEASE_UNIT))).mode & 0o777, 0o644);
  // A unit installed without its boot target stays without one.
  host = unitHost();
  install(host, { enable: false, unitName: MANAGED_UNIT, unitPath: path.join(folder, MANAGED_UNIT), unitRoot: folder });
  assert.deepEqual(host.commands.slice(1), [
    `systemctl link --runtime ${path.join(folder, MANAGED_UNIT)}`,
    "systemctl daemon-reload",
    `systemctl reset-failed ${MANAGED_UNIT}`,
    `systemctl start ${MANAGED_UNIT}`
  ]);

  // systemd runs what a unit says as root, so a folder anyone but root may change takes none.
  for (const [mode, rootUid] of [[0o777, UID], [0o700, UID + 1]]) {
    await chmod(folder, mode);
    host = unitHost();
    assert.throws(() => installSystemdUnit({ rootUid, run: host.run, runAllowFailure: host.runAllowFailure, unit: "[Service]\n",
      unitName: "vibe64-staging-test-shop-111111111111.service", unitPath: path.join(folder, "vibe64-staging-test-shop-111111111111.service"),
      unitRoot: folder }), /refused unit folder .* only root can change/u);
    assert.deepEqual(host.commands, []);
  }
  await chmod(folder, 0o700);
  assert.deepEqual((await readdir(folder)).sort(), [MANAGED_UNIT, RELEASE_UNIT]);
});

test("a unit reaches the disk before it is moved into place, and its folder after", async (t) => {
  const folder = await temporaryFolder(t, "v64-units-durable-");
  const host = unitHost();
  const events = await traceDurableWrites(t);
  installSystemdUnit({ activation: "restart", rootUid: UID, run: host.run, runAllowFailure: host.runAllowFailure,
    unit: "[Service]\n", unitName: RELEASE_UNIT, unitPath: path.join(folder, RELEASE_UNIT), unitRoot: folder });
  assertDurablyReplaced(events, path.join(folder, RELEASE_UNIT));
});

test("relink-units links every unit root wrote outside systemd's folder again as it was installed and starts the staging units", async (t) => {
  const folder = await temporaryFolder(t, "v64-relink-");
  const unrelated = path.join(await temporaryFolder(t, "v64-relink-other-"), "other.service");
  await writeFile(path.join(folder, RELEASE_UNIT), "[Service]\n[Install]\nWantedBy=multi-user.target\n", { mode: 0o644 });
  // Written by a helper whose umask took others' read away: relinked, it is every account's to read again.
  await writeFile(path.join(folder, MANAGED_UNIT), "[Service]\n", { mode: 0o640 });
  await chmod(path.join(folder, MANAGED_UNIT), 0o640);
  await writeFile(path.join(folder, "vibe64-staging-test-shop-111111111111.service"), "[Service]\n", { mode: 0o644 });
  await chmod(path.join(folder, "vibe64-staging-test-shop-111111111111.service"), 0o666);
  await writeFile(unrelated, "[Service]\n", { mode: 0o640 });
  await chmod(unrelated, 0o640);
  await symlink(unrelated, path.join(folder, "vibe64-managed-test-cache.service"));
  await writeFile(path.join(folder, "unrelated.service"), "[Service]\n", { mode: 0o644 });
  await writeFile(path.join(folder, `${RELEASE_UNIT}.tmp-123`), "[Service]\n", { mode: 0o644 });

  let host = unitHost();
  assert.throws(() => relinkSystemdUnits({ rootUid: UID, runAllowFailure: host.runAllowFailure, unitRoot: folder }), (error) => {
    assert.match(error.message, /could not relink every unit/u);
    assert.match(error.message, /vibe64-managed-test-cache\.service: not a unit file root wrote \(ELOOP\)/u);
    assert.match(error.message, /vibe64-staging-test-shop-111111111111\.service: not a unit file root wrote/u);
    assert.doesNotMatch(error.message, /unrelated|blog|test-db/u);
    return true;
  });
  assert.equal((await stat(path.join(folder, MANAGED_UNIT))).mode & 0o777, 0o644);
  // A unit others may write, or a link, is left as it is.
  assert.equal((await stat(path.join(folder, "vibe64-staging-test-shop-111111111111.service"))).mode & 0o777, 0o666);
  assert.equal((await stat(unrelated)).mode & 0o777, 0o640);
  // The rest are linked and started all the same.
  assert.deepEqual(host.commands, [
    `systemctl link --runtime ${path.join(folder, MANAGED_UNIT)}`,
    `systemctl enable --runtime ${path.join(folder, RELEASE_UNIT)}`,
    "systemctl daemon-reload",
    `systemctl start --no-block ${RELEASE_UNIT}`
  ]);

  await rm(path.join(folder, "vibe64-managed-test-cache.service"));
  await rename(path.join(folder, "vibe64-staging-test-shop-111111111111.service"), path.join(folder, "shop.removed"));
  host = unitHost();
  relinkSystemdUnits({ rootUid: UID, runAllowFailure: host.runAllowFailure, unitRoot: folder });
  assert.equal(host.commands.length, 4);
  // A unit systemd refuses to link is reported and never started.
  host = unitHost();
  host.failing.add(`systemctl enable --runtime ${path.join(folder, RELEASE_UNIT)}`);
  assert.throws(() => relinkSystemdUnits({ rootUid: UID, runAllowFailure: host.runAllowFailure, unitRoot: folder }),
    new RegExp(`${RELEASE_UNIT.replaceAll(".", "\\.")}: Unit file is masked\\.`, "u"));
  assert.deepEqual(host.commands.slice(-1), ["systemctl daemon-reload"]);

  // systemd's own folder needs nothing; a folder anyone but root may change is refused whole.
  host = unitHost();
  relinkSystemdUnits({ runAllowFailure: host.runAllowFailure, unitRoot: "/etc/systemd/system" });
  await chmod(folder, 0o777);
  assert.throws(() => relinkSystemdUnits({ rootUid: UID, runAllowFailure: host.runAllowFailure, unitRoot: folder }),
    /refused unit folder .* only root can change/u);
  await chmod(folder, 0o700);
  assert.deepEqual(host.commands, []);
});

test("relink-units takes no arguments", () => {
  const result = spawnSync(process.execPath, [EXEC_HELPER, "relink-units", "extra"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "Usage: vibe64-exec-helper relink-units\n");
});
