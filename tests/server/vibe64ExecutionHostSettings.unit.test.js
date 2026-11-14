import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { helperSettings } from "../../packages/vibe64-execution/src/host/commandEnvironment.js";
import { addUserToGroup, createSystemUser } from "../../packages/vibe64-execution/src/host/hostAccounts.js";
import { helperAccountDatabase, helperAccountNumberOptions } from "../../packages/vibe64-execution/src/host/hostSettings.js";
import { execHelperSource } from "../fixtures/execHelperSource.js";

async function temporaryFolder(t, prefix) {
  const folder = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(folder, { force: true, recursive: true }));
  return folder;
}

test("the host's helper settings name the account database; without them the system's own files", async (t) => {
  assert.equal(helperAccountDatabase({}), "files");

  const file = path.join(await temporaryFolder(t, "v64-host-settings-"), "exec-helper.env");
  await writeFile(file, "VIBE64_ACCOUNT_DATABASE=extrausers\nVIBE64_SYSTEM_ID_BAND=400-899\n", { mode: 0o600 });
  const settings = helperSettings(file, process.getuid());
  assert.equal(helperAccountDatabase(settings), "extrausers");
  assert.deepEqual(helperAccountNumberOptions(settings).slice(0, 2), ["-K", "SYS_UID_MIN=400"]);
  assert.equal(helperAccountDatabase({ VIBE64_ACCOUNT_DATABASE: "files" }), "files");

  for (const database of ["ldap", "Files", "files extrausers"]) {
    assert.throws(() => helperAccountDatabase({ VIBE64_ACCOUNT_DATABASE: database }),
      /unknown account database \(VIBE64_ACCOUNT_DATABASE\)/u, database);
  }
});

test("the helper numbers new system accounts in the band the host's settings name; without one by the system's range", () => {
  assert.deepEqual(helperAccountNumberOptions({}), []);
  assert.deepEqual(helperAccountNumberOptions({ VIBE64_SYSTEM_ID_BAND: "400-899" }), [
    "-K", "SYS_UID_MIN=400", "-K", "SYS_UID_MAX=899", "-K", "SYS_GID_MIN=400", "-K", "SYS_GID_MAX=899"
  ]);
  assert.deepEqual(helperAccountNumberOptions({ VIBE64_SYSTEM_ID_BAND: "400-400" }),
    ["-K", "SYS_UID_MIN=400", "-K", "SYS_UID_MAX=400", "-K", "SYS_GID_MIN=400", "-K", "SYS_GID_MAX=400"]);
  for (const band of ["899-400", "0-899", "400", "400-", "-400-899", "400-65534", "04-899", "400-899x", "400–899"]) {
    assert.throws(() => helperAccountNumberOptions({ VIBE64_SYSTEM_ID_BAND: band }),
      /band of account numbers \(VIBE64_SYSTEM_ID_BAND\)/u, band);
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

  createSystemUser(username, "initial password", "files");
  addUserToGroup(username, "vibe64", "files");
  // Refused before any account command runs.
  assert.throws(() => createSystemUser(username, "initial password", "extrausers"),
    /extra users database, where people sign in without a password: the helper creates no person with one here/u);
  addUserToGroup(username, "vibe64", "extrausers");

  assert.deepEqual((await readFile(log, "utf8")).trim().split("\n"), [
    `useradd --create-home --user-group --shell /bin/bash ${username}`,
    "chpasswd",
    `usermod -a -G vibe64 ${username}`,
    // usermod has no --extrausers and its -a -G leaves such a group unchanged.
    `gpasswd --extrausers -a ${username} vibe64`
  ]);
});

test("the helper's people, memberships and application accounts all follow the host's settings", async () => {
  const source = await execHelperSource();

  assert.match(source, /createSystemUser\(username, String\(payload\.password \|\| ""\), helperAccountDatabase\(\)\);/u);
  assert.equal(source.match(/addToGroup = \(name\) => addUserToGroup\(name, VIBE64_GROUP, helperAccountDatabase\(\)\),/gu)?.length,
    2, "registering and re-enabling a person");
  assert.match(source,
    /runRootCommand\("useradd", \[\.\.\.accountDatabaseOptions\(helperAccountDatabase\(\)\),\n\s*\.\.\.helperAccountNumberOptions\(\), "--system",/u);
  assert.match(source, /runRootCommand\("userdel", \[\.\.\.accountDatabaseOptions\(helperAccountDatabase\(\)\), username\]\)/u);
  assert.equal(source.match(/accountDatabase = helperAccountDatabase\(\),/gu)?.length, 2, "granting and revoking production access");
});
