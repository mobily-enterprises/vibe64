import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { helperSystemdUnitRoot as exportedSystemdUnitRoot } from "@local/vibe64-execution/server/hostSettings";
import { helperSettings } from "../../packages/vibe64-execution/src/host/commandEnvironment.js";
import { addUserToGroup, createSystemUser, hostSettingsRoot } from "../../packages/vibe64-execution/src/host/hostAccounts.js";
import {
  helperAccountDatabase,
  helperAccountNumberOptions,
  helperSudoersRoot,
  helperSystemdUnitRoot
} from "../../packages/vibe64-execution/src/host/hostSettings.js";
import { installSystemdUnit, relinkSystemdUnits } from "../../packages/vibe64-execution/src/host/serviceOperations.js";
import { execHelperSource } from "../fixtures/execHelperSource.js";

const EXEC_HELPER = fileURLToPath(new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url));
const UID = process.getuid();
const RELEASE_UNIT = "vibe64-release-test-blog-0123456789ab.service";
const MANAGED_UNIT = "vibe64-managed-test-db.service";

async function temporaryFolder(t, prefix) {
  const folder = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(folder, { force: true, recursive: true }));
  return folder;
}

test("the host's helper settings name the account database and the unit and sudo rule folders; without them the system's own", async (t) => {
  assert.equal(helperAccountDatabase({}), "files");
  assert.equal(helperSystemdUnitRoot({}), "/etc/systemd/system");
  assert.equal(helperSudoersRoot({}), "/etc/sudoers.d");

  const file = path.join(await temporaryFolder(t, "v64-host-settings-"), "exec-helper.env");
  await writeFile(file, "VIBE64_ACCOUNT_DATABASE=extrausers\nVIBE64_SYSTEM_ID_BAND=400-899\n" +
    "VIBE64_SYSTEMD_UNIT_ROOT=/srv/host/units\nVIBE64_SUDOERS_ROOT=/srv/host/sudoers\n", { mode: 0o600 });
  const settings = helperSettings(file, UID);
  assert.equal(helperAccountDatabase(settings), "extrausers");
  assert.deepEqual(helperAccountNumberOptions(settings).slice(0, 2), ["-K", "SYS_UID_MIN=400"]);
  assert.equal(helperSystemdUnitRoot(settings), "/srv/host/units");
  assert.equal(helperSudoersRoot(settings), "/srv/host/sudoers");
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
  }
  // A host's own server reads the unit folder through the package.
  assert.equal(exportedSystemdUnitRoot, helperSystemdUnitRoot);
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
// file and people's sudo commands read from it, and the application sandbox that hides it.
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
    const { applicationSandboxLines } = await import(modules.systemdUnits);
    const uid = process.getuid();
    process.stdout.write(JSON.stringify({
      root: HOST_SETTINGS_ROOT,
      settings: HOST_SETTINGS_ROOT === "/etc/vibe64" ? null : helperSettings(undefined, uid),
      sudoCommands: HOST_SETTINGS_ROOT === "/etc/vibe64" ? null : personSudoCommands(undefined, uid),
      hidden: applicationSandboxLines({ appRoot: "/area/app", databaseRoot: "/area/database" })
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

test("memberships go to the account database the host names, which gets no person with a password", async (t) => {
  const bin = await temporaryFolder(t, "v64-account-tools-");
  const log = path.join(bin, "calls.log");
  for (const tool of ["useradd", "usermod", "gpasswd"]) {
    await writeFile(path.join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> "${log}"\n`, { mode: 0o755 });
  }
  await writeFile(path.join(bin, "chpasswd"), `#!/bin/sh\ncat > /dev/null\necho chpasswd >> "${log}"\n`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  t.after(() => {
    process.env.PATH = previousPath;
  });
  const username = "v64hostsettingsprobe";

  createSystemUser(username, "initial password", "files", ["-K", "UID_MIN=20000"]);
  addUserToGroup(username, "vibe64", "files");
  // Refused before any account command runs.
  assert.throws(() => createSystemUser(username, "initial password", "extrausers"),
    /extra users database, where people sign in without a password: the helper creates no person with one here/u);
  addUserToGroup(username, "vibe64", "extrausers");

  assert.deepEqual((await readFile(log, "utf8")).trim().split("\n"), [
    `useradd -K UID_MIN=20000 --create-home --user-group --shell /bin/bash ${username}`,
    "chpasswd",
    `usermod -a -G vibe64 ${username}`,
    // usermod has no --extrausers and its -a -G leaves such a group unchanged.
    `gpasswd --extrausers -a ${username} vibe64`
  ]);
});

test("the helper's people, memberships, application accounts, unit readers and sudo rules all follow the host's settings", async () => {
  const source = await execHelperSource();

  assert.match(source,
    /createSystemUser\(username, String\(payload\.password \|\| ""\), helperAccountDatabase\(\), helperAccountNumberOptions\(\)\);/u);
  assert.equal(source.match(/addToGroup = \(name\) => addUserToGroup\(name, VIBE64_GROUP, helperAccountDatabase\(\)\),/gu)?.length,
    2, "registering and re-enabling a person");
  assert.match(source,
    /runRootCommand\("useradd", \[\.\.\.accountDatabaseOptions\(helperAccountDatabase\(\)\),\n\s*\.\.\.helperAccountNumberOptions\(\), "--system",/u);
  assert.match(source, /runRootCommand\("userdel", \[\.\.\.accountDatabaseOptions\(helperAccountDatabase\(\)\), username\]\)/u);
  assert.equal(source.match(/accountDatabase = helperAccountDatabase\(\),/gu)?.length, 2, "granting and revoking staging access");
  // Only the settings reader names systemd's and sudo's own folders; every reader and writer asks it.
  assert.equal(source.match(/"\/etc\/systemd\/system"/gu)?.length, 1);
  assert.equal(source.match(/"\/etc\/sudoers\.d"/gu)?.length, 1);
  assert.equal(source.match(/sudoersRoot = helperSudoersRoot\(\)/gu)?.length, 4,
    "the rule's path, the files from before the rename, grant and revoke");
  for (const reader of ["function installedReleaseUnits", "function assertReleaseServiceClaim", "function retireApplicationAccount"]) {
    const start = source.indexOf(reader);
    assert.match(source.slice(start, source.indexOf(") {\n", start)), /unitRoot = helperSystemdUnitRoot\(\)/u, reader);
  }
  assert.match(source, /assertReleaseServiceClaim\(\{ loopbackPort, owner, unitName, unitRoot, user \}\);\n\s*const unitPath = systemdUnitPath\(unitName, owner, unitRoot\);/u);
  // Removing a release unit outside systemd's own folder takes its runtime link and boot target away.
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
  install(host, { activation: "restart", unitName: RELEASE_UNIT, unitPath: path.join(folder, RELEASE_UNIT), unitRoot: folder });
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
      unitName: "vibe64-release-test-shop-111111111111.service", unitPath: path.join(folder, "vibe64-release-test-shop-111111111111.service"),
      unitRoot: folder }), /refused unit folder .* only root can change/u);
    assert.deepEqual(host.commands, []);
  }
  await chmod(folder, 0o700);
  assert.deepEqual((await readdir(folder)).sort(), [MANAGED_UNIT, RELEASE_UNIT]);
});

test("relink-units links every unit root wrote outside systemd's folder again as it was installed and starts the release units", async (t) => {
  const folder = await temporaryFolder(t, "v64-relink-");
  const unrelated = path.join(await temporaryFolder(t, "v64-relink-other-"), "other.service");
  await writeFile(path.join(folder, RELEASE_UNIT), "[Service]\n[Install]\nWantedBy=multi-user.target\n", { mode: 0o644 });
  await writeFile(path.join(folder, MANAGED_UNIT), "[Service]\n", { mode: 0o644 });
  await writeFile(path.join(folder, "vibe64-release-test-shop-111111111111.service"), "[Service]\n", { mode: 0o644 });
  await chmod(path.join(folder, "vibe64-release-test-shop-111111111111.service"), 0o666);
  await writeFile(unrelated, "[Service]\n", { mode: 0o644 });
  await symlink(unrelated, path.join(folder, "vibe64-managed-test-cache.service"));
  await writeFile(path.join(folder, "unrelated.service"), "[Service]\n", { mode: 0o644 });
  await writeFile(path.join(folder, `${RELEASE_UNIT}.tmp-123`), "[Service]\n", { mode: 0o644 });

  let host = unitHost();
  assert.throws(() => relinkSystemdUnits({ rootUid: UID, runAllowFailure: host.runAllowFailure, unitRoot: folder }), (error) => {
    assert.match(error.message, /could not relink every unit/u);
    assert.match(error.message, /vibe64-managed-test-cache\.service: not a unit file root wrote \(ELOOP\)/u);
    assert.match(error.message, /vibe64-release-test-shop-111111111111\.service: not a unit file root wrote/u);
    assert.doesNotMatch(error.message, /unrelated|blog|test-db/u);
    return true;
  });
  // The rest are linked and started all the same.
  assert.deepEqual(host.commands, [
    `systemctl link --runtime ${path.join(folder, MANAGED_UNIT)}`,
    `systemctl enable --runtime ${path.join(folder, RELEASE_UNIT)}`,
    "systemctl daemon-reload",
    `systemctl start --no-block ${RELEASE_UNIT}`
  ]);

  await rm(path.join(folder, "vibe64-managed-test-cache.service"));
  await rename(path.join(folder, "vibe64-release-test-shop-111111111111.service"), path.join(folder, "shop.removed"));
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
