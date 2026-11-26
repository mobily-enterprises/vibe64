import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { existsSync, readlinkSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  installStagingAccess,
  removeStagingAccess,
  stagingAccessGranted
} from "../../packages/vibe64-execution/src/host/stagingAccess.js";
import {
  enterStagingService,
  runningStagingUnit,
  stagingActivity,
  stagingEnterArgv,
  stagingEnterCommand,
  stagingLoginEnvironment,
  stagingLogWindow,
  stagingShellCommand,
  stagingShellFunctions,
  runStagingEnter,
  serviceUserNamespace,
  START_SCRIPT_RUNS_ARGUMENTS
} from "../../packages/vibe64-execution/src/host/stagingLogin.js";
import { stagingUnitFile } from "../../packages/vibe64-execution/src/host/systemdUnits.js";
import { assertDurablyReplaced, traceDurableWrites } from "./durableWriteTrace.js";

const EXEC_HELPER = fileURLToPath(new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url));
const UID = process.getuid();
const ACCOUNT = "v64s_0123456789ab";
const PUBLIC_KEY = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${"A".repeat(43)}`;
const HELPER = "/usr/lib/vibe64/vibe64-exec-helper";

// Root's folders as the helper writes them, in a temporary directory: the test's uid stands in for root.
async function stagingHost(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-staging-access-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const calls = [];
  const options = {
    accountDatabase: "files",
    keysRoot: path.join(root, "etc", "vibe64", "staging-ssh"),
    rootUid: UID,
    runRoot: (command, args) => {
      calls.push([command, ...args]);
      return "";
    },
    runRootAllowFailure: (command, args) => {
      calls.push([command, ...args]);
      if (command === "atq") {
        return { status: 0, stderr: "", stdout: `7\tWed Nov 11 23:00:00 2026 a ${ACCOUNT}\n8\tWed Nov 11 23:00:00 2026 a v64s_ffffffffffff\n` };
      }
      return { status: 1, stderr: "not logged in", stdout: "" };
    },
    sudoersRoot: path.join(root, "etc", "sudoers.d")
  };
  await mkdir(options.sudoersRoot, { recursive: true });
  return { calls, options, root };
}

// The folders as a read-only file system answers the helper, whose node:fs imports this replaces for the test: a
// write in one fails with EROFS once the folder it writes in is found, before the name it writes is looked up, so
// removing a file that is not there fails too; looking still works. Each refused write is recorded.
function readOnlyFolders(t, folders = []) {
  const refused = [];
  const inside = (file) => folders.some((folder) => {
    const relative = path.relative(folder, path.resolve(String(file)));
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  const originals = {};
  for (const name of ["mkdirSync", "renameSync", "unlinkSync", "writeFileSync"]) {
    const original = fs[name];
    originals[name] = original;
    fs[name] = (file, ...rest) => {
      const target = (name === "renameSync" ? [file, rest[0]] : [file]).find(inside);
      // Answered before the file system's check: a folder that is not there, or one mkdir finds already made.
      if (target === undefined || !existsSync(path.dirname(path.resolve(String(target)))) ||
          (name === "mkdirSync" && existsSync(target))) {
        return original(file, ...rest);
      }
      refused.push([name, String(target)]);
      throw Object.assign(new Error(`EROFS: read-only file system, ${name.replace(/Sync$/u, "")} '${target}'`),
        { code: "EROFS", errno: -30, path: String(target), syscall: name.replace(/Sync$/u, "") });
    };
  }
  syncBuiltinESMExports();
  t.after(() => {
    Object.assign(fs, originals);
    syncBuiltinESMExports();
  });
  return refused;
}

test("the staging key and sudo rule reach the disk before they are renamed into place, and their folders after", async (t) => {
  const host = await stagingHost(t);
  const events = await traceDurableWrites(t);
  installStagingAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);
  assertDurablyReplaced(events, path.join(host.options.keysRoot, ACCOUNT));
  assertDurablyReplaced(events, path.join(host.options.sudoersRoot, `vibe64-staging-${ACCOUNT}`));
});

test("under the managed umask 0007 a granted key is still 0644 in 0755 folders, so sshd, reading it as the account, opens it", async (t) => {
  const previous = process.umask(0o007);
  t.after(() => process.umask(previous));
  const host = await stagingHost(t);
  installStagingAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);
  // The account neither owns the key (root does) nor is in its group: sshd opens it, and enters each folder this
  // made, by the others' bits alone.
  const keys = path.join(host.options.keysRoot, ACCOUNT);
  assert.equal((await stat(keys)).mode & 0o777, 0o644);
  for (const folder of [host.options.keysRoot, path.dirname(host.options.keysRoot)]) {
    assert.equal((await stat(folder)).mode & 0o777, 0o755, folder);
  }
  assert.equal((await stat(path.join(host.options.sudoersRoot, `vibe64-staging-${ACCOUNT}`))).mode & 0o777, 0o440);
});

test("granting staging access installs the key as root's file, the account's own sudo rule and /bin/sh as its login shell", async (t) => {
  const host = await stagingHost(t);
  installStagingAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);

  const keys = path.join(host.options.keysRoot, ACCOUNT);
  // The key names the login's forced command itself, so sshd confines the account where the host has no policy of
  // Vibe64's for application accounts; only from this host's own loopback, with nothing but a terminal.
  assert.equal(await readFile(keys, "utf8"),
    `command="${HELPER} staging-shell",restrict,pty,from="127.0.0.1,::1" ${PUBLIC_KEY} vibe64-staging\n`);
  assert.equal((await stat(keys)).mode & 0o777, 0o644);
  assert.equal((await stat(host.options.keysRoot)).mode & 0o777, 0o755);
  const rule = path.join(host.options.sudoersRoot, `vibe64-staging-${ACCOUNT}`);
  assert.equal(await readFile(rule, "utf8"), `${ACCOUNT} ALL=(root) NOPASSWD: ${HELPER} staging-service *\n`);
  assert.equal((await stat(rule)).mode & 0o777, 0o440);
  // visudo checks the candidate (the atomic writer's temporary file beside the rule, a name with a dot, which sudo's
  // included folder skips) before it is renamed into place; then the account gets its login shell, /bin/sh, which sshd
  // starts the forced command through and which reads no file of the account's own.
  assert.equal(host.calls[0][0], "visudo");
  assert.equal(path.dirname(host.calls[0][2]), host.options.sudoersRoot);
  assert.match(path.basename(host.calls[0][2]), /^\.vibe64-write-[0-9a-f-]{36}\.tmp$/u);
  assert.deepEqual(host.calls[1], ["usermod", "--shell", "/bin/sh", ACCOUNT]);
  assert.equal(stagingAccessGranted(ACCOUNT, host.options), true);

  // Granting again replaces the key and leaves an account that already has its shell alone.
  host.calls.length = 0;
  installStagingAccess({ shell: "/bin/sh", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);
  assert.deepEqual(host.calls.map(([command]) => command), ["visudo"]);
  assert.deepEqual((await readdir(host.options.keysRoot)).sort(), [ACCOUNT]);
});

test("a sudo rule visudo refuses is never installed", async (t) => {
  const host = await stagingHost(t);
  const refusing = {
    ...host.options,
    runRoot: (command) => {
      if (command === "visudo") throw new Error("parse error");
      return "";
    }
  };
  assert.throws(() => installStagingAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, refusing),
    /parse error/u);
  assert.deepEqual(await readdir(host.options.sudoersRoot), []);
});

test("a key file anyone but root may change, or one root did not write, grants nothing", async (t) => {
  const host = await stagingHost(t);
  installStagingAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);
  assert.equal(stagingAccessGranted(ACCOUNT, { ...host.options, rootUid: UID + 1 }), false);
  await chmod(path.join(host.options.keysRoot, ACCOUNT), 0o664);
  assert.equal(stagingAccessGranted(ACCOUNT, host.options), false);
  assert.equal(stagingAccessGranted("v64s_ffffffffffff", host.options), false);
});

test("revoking staging access removes the key, the rule and the login shell, ends the open logins and what they left to run", async (t) => {
  const host = await stagingHost(t);
  installStagingAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);
  host.calls.length = 0;

  assert.equal(removeStagingAccess({ shell: "/bin/sh", username: ACCOUNT }, ACCOUNT, host.options), true);
  assert.deepEqual(await readdir(host.options.keysRoot), []);
  assert.deepEqual(await readdir(host.options.sudoersRoot), []);
  // A crontab, an at job or lingering would run the account's commands later, outside any login; only its own at
  // job goes.
  assert.deepEqual(host.calls, [
    ["usermod", "--shell", "/usr/sbin/nologin", ACCOUNT],
    ["loginctl", "disable-linger", ACCOUNT],
    ["loginctl", "terminate-user", ACCOUNT],
    ["crontab", "-u", ACCOUNT, "-r"],
    ["atq"],
    ["atrm", "7"]
  ]);
  // Any login shell goes back to none, such as bash from an older grant.
  host.calls.length = 0;
  removeStagingAccess({ shell: "/bin/bash", username: ACCOUNT }, ACCOUNT, host.options);
  assert.deepEqual(host.calls[0], ["usermod", "--shell", "/usr/sbin/nologin", ACCOUNT]);
  assert.equal(stagingAccessGranted(ACCOUNT, host.options), false);

  // Nothing left to remove is no error, and an account that no longer exists has no login to end.
  host.calls.length = 0;
  assert.equal(removeStagingAccess(null, ACCOUNT, host.options), false);
  assert.deepEqual(host.calls, []);
});

test("taking back staging access an account never had writes nothing, even where the sudo rule folder is read-only", async (t) => {
  const host = await stagingHost(t);
  // The whole etc folder read-only: its sudo rule folder there, and no staging key folder ever made.
  const refused = readOnlyFolders(t, [path.join(host.root, "etc")]);

  // The revoke still ends what a login could have left behind.
  assert.equal(removeStagingAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, ACCOUNT, host.options), false);
  assert.deepEqual(host.calls, [
    ["loginctl", "disable-linger", ACCOUNT],
    ["loginctl", "terminate-user", ACCOUNT],
    ["crontab", "-u", ACCOUNT, "-r"],
    ["atq"],
    ["atrm", "7"]
  ]);
  assert.equal(removeStagingAccess(null, ACCOUNT, host.options), false);
  assert.deepEqual(refused, []);
  assert.deepEqual(await readdir(host.options.sudoersRoot), []);
});

test("a sudo rule a read-only folder still holds fails its revoke rather than staying silently", async (t) => {
  const host = await stagingHost(t);
  installStagingAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);
  host.calls.length = 0;
  const rule = path.join(host.options.sudoersRoot, `vibe64-staging-${ACCOUNT}`);
  const refused = readOnlyFolders(t, [host.options.sudoersRoot]);

  assert.throws(() => removeStagingAccess({ shell: "/bin/sh", username: ACCOUNT }, ACCOUNT, host.options),
    { code: "EROFS", message: `EROFS: read-only file system, unlink '${rule}'` });
  assert.deepEqual(refused, [["unlinkSync", rule]]);
  assert.deepEqual(await readdir(host.options.sudoersRoot), [`vibe64-staging-${ACCOUNT}`]);
  // Nothing after it ran: the login shell stays and no login was ended.
  assert.deepEqual(host.calls, []);
});

test("on a host keeping accounts in the extra users database, the login shell changes there alone", async (t) => {
  const host = await stagingHost(t);
  const prefixParent = path.join(host.root, "run");
  await mkdir(prefixParent);
  const prefixes = [];
  const options = {
    ...host.options,
    accountDatabase: "extrausers",
    prefixParent,
    runRoot: (command, args) => {
      host.calls.push([command, ...args]);
      if (command === "usermod") prefixes.push({ etc: readlinkSync(path.join(args[1], "etc")), prefix: args[1] });
      return "";
    }
  };
  installStagingAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, options);
  removeStagingAccess({ shell: "/bin/sh", username: ACCOUNT }, ACCOUNT, options);

  // usermod reads and writes the prefix's etc folder, which is the database's, so the system's own account files,
  // which such a host cannot write, stay untouched; the prefix goes after each call.
  const shells = host.calls.filter(([command]) => command === "usermod");
  assert.deepEqual(shells.map((call) => [call[0], call[1], call[3], call[4], call[5]]), [
    ["usermod", "--prefix", "--shell", "/bin/sh", ACCOUNT],
    ["usermod", "--prefix", "--shell", "/usr/sbin/nologin", ACCOUNT]
  ]);
  assert.deepEqual(prefixes.map(({ etc }) => etc), ["/var/lib/extrausers", "/var/lib/extrausers"]);
  for (const { prefix } of prefixes) assert.equal(path.dirname(prefix), prefixParent);
  assert.deepEqual(await readdir(prefixParent), []);
});

function stagingUnitLines({ user = ACCOUNT, release = "20261111_080000z-ab12cd34", name = "vibe64-staging-test-shop-0123456789ab.service",
  runtimePackRoot = "" } = {}) {
  const handover = `/var/lib/vibe64-staging/test/shop/handover/${release}`;
  return {
    lines: stagingUnitFile({
      environmentFile: `${handover}/environment`,
      helperPath: HELPER,
      loopbackPort: 41000,
      owner: { username: "v64d_test" },
      runtimePackRoot,
      startScript: `${handover}/start.sh`,
      servicePath: "/opt/vibe64/runtime-packs/node26/bin:/usr/bin:/bin",
      unitName: name,
      user: { stagingAccount: { appRoot: "/var/lib/vibe64-staging/test/shop/app", databaseRoot: "/var/lib/vibe64-staging/test/shop/database" }, username: user },
      workingDirectory: `/var/lib/vibe64-staging/test/shop/app/releases/${release}/workspace`
    }).split("\n"),
    name
  };
}

test("a staging login finds the account's own staging unit as root installed it, the running one first", () => {
  const older = stagingUnitLines({ name: "vibe64-staging-test-shop-aaaaaaaaaaaa.service", release: "r1" });
  const live = stagingUnitLines({ name: "vibe64-staging-test-shop-bbbbbbbbbbbb.service", release: "r2" });
  const another = stagingUnitLines({ name: "vibe64-staging-test-blog-cccccccccccc.service", user: "v64s_ffffffffffff" });
  const units = () => [older, live, another];

  assert.deepEqual(runningStagingUnit(ACCOUNT, { isActive: (name) => name === live.name, units }), {
    environmentFile: "/var/lib/vibe64-staging/test/shop/handover/r2/environment",
    name: live.name,
    path: "/opt/vibe64/runtime-packs/node26/bin:/usr/bin:/bin",
    runtimePackRoot: "",
    startScript: "/var/lib/vibe64-staging/test/shop/handover/r2/start.sh",
    tmpdir: "/var/lib/vibe64-staging/test/shop/app/tmp",
    workingDirectory: "/var/lib/vibe64-staging/test/shop/app/releases/r2/workspace"
  });
  // With none running, the last of its own; another account's unit is never its.
  assert.equal(runningStagingUnit(ACCOUNT, { isActive: () => false, units }).name, live.name);
  assert.equal(runningStagingUnit("v64s_ffffffffffff", { isActive: () => true, units }).name, another.name);
  assert.equal(runningStagingUnit("v64s_eeeeeeeeeeee", { isActive: () => true, units }), null);
  const odd = { lines: [`User=${ACCOUNT}`, "ExecStart=/bin/sh -c true"], name: "vibe64-staging-test-shop-dddddddddddd.service" };
  assert.throws(() => runningStagingUnit(ACCOUNT, { isActive: () => true, units: () => [odd] }),
    /does not start a Vibe64 staging service/u);
});

// The service's PATH starts with the runtime packs' tool wrappers (policy-bin's npm), which find their pack by the folder
// its unit names; a login or staging-enter that took only the PATH ran a wrapper looking in its default folder.
test("a staging login and staging-enter run with the runtime pack folder the service's unit names beside its PATH", () => {
  const packs = "/srv/apps/editor/runtime-packs";
  const unit = runningStagingUnit(ACCOUNT, { isActive: () => true, units: () => [stagingUnitLines({ runtimePackRoot: packs })] });
  assert.equal(unit.runtimePackRoot, packs);
  const user = { gid: 990, home: "/var/lib/vibe64-staging/test/shop/app/home", uid: 991, username: ACCOUNT };
  const login = stagingLoginEnvironment(unit, { env: { BASH_ENV: "/home/x/.profile", ENV: "/home/x/.env", TERM: "xterm" },
    helperPath: HELPER, readEnvironment: (file) => (file === unit.environmentFile ? { DB_NAME: "shop" } : {}) });
  assert.equal(login.VIBE64_RUNTIME_PACK_ROOT, packs);
  assert.equal(login.PATH, unit.path);
  assert.equal(login.DB_NAME, "shop", "the release's Env");
  assert.equal(login.VIBE64_STAGING_UNIT, unit.name);
  assert.equal(login.TERM, "xterm");
  assert.equal("BASH_ENV" in login || "ENV" in login, false, "no file a shell would read first");
  assert.ok(login["BASH_FUNC_staging-enter%%"]);
  const entered = stagingEnterCommand({ command: [], env: {}, helperPath: HELPER, mountNamespace: "mnt:[4026532800]", pid: 4242,
    unit, user });
  assert.equal(entered.env.VIBE64_RUNTIME_PACK_ROOT, packs);
  // A unit that names none, as a host whose settings name none writes it, gives none: the wrappers keep their default.
  const plain = runningStagingUnit(ACCOUNT, { isActive: () => true, units: () => [stagingUnitLines()] });
  assert.equal(plain.runtimePackRoot, "");
  assert.equal("VIBE64_RUNTIME_PACK_ROOT" in stagingLoginEnvironment(plain, { env: {}, helperPath: HELPER, readEnvironment: () => ({}) }), false);
  assert.equal("VIBE64_RUNTIME_PACK_ROOT" in stagingEnterCommand({ command: [], env: {}, helperPath: HELPER,
    mountNamespace: "mnt:[4026532800]", pid: 4242, unit: plain, user }).env, false);
});

// /tmp may be noexec (mobilynet's is), so the service runs with its own temporary folder in its area, which its unit
// names; a login and staging-enter take it from there as they take its PATH, and tell a JVM, which ignores TMPDIR.
test("a staging login and staging-enter run with the temporary folder the service's unit names", async (t) => {
  const folder = "/var/lib/vibe64-staging/test/shop/app/tmp";
  const jvm = `-Djava.io.tmpdir=${folder} -Djna.tmpdir=${folder}`;
  const unit = runningStagingUnit(ACCOUNT, { isActive: () => true, units: () => [stagingUnitLines()] });
  assert.equal(unit.tmpdir, folder);
  const login = (environment) => stagingLoginEnvironment(unit, { env: { TMPDIR: "/tmp" }, helperPath: HELPER,
    readEnvironment: () => environment });
  assert.equal(login({}).TMPDIR, folder);
  assert.equal(login({}).JAVA_TOOL_OPTIONS, jvm);
  // The release's Env follows, as it does for the service: its own JVM options after these, and a TMPDIR it names wins.
  assert.equal(login({ JAVA_TOOL_OPTIONS: "-Xmx64m" }).JAVA_TOOL_OPTIONS, `${jvm} -Xmx64m`);
  assert.deepEqual([login({ TMPDIR: "/srv/own" }).TMPDIR, login({ TMPDIR: "/srv/own" }).JAVA_TOOL_OPTIONS],
    ["/srv/own", "-Djava.io.tmpdir=/srv/own -Djna.tmpdir=/srv/own"]);
  const user = { gid: 990, home: "/var/lib/vibe64-staging/test/shop/app/home", uid: 991, username: ACCOUNT };
  const entered = stagingEnterCommand({ command: [], env: { TMPDIR: "/tmp" }, helperPath: HELPER,
    mountNamespace: "mnt:[4026532800]", pid: 4242, unit, user });
  assert.equal(entered.env.TMPDIR, folder);

  // Inside the service's namespace, staging-enter reads the release's Env and then tells a JVM.
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-staging-enter-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const environmentFile = path.join(root, "environment");
  const startScript = path.join(root, "start.sh");
  await writeFile(environmentFile, "JAVA_TOOL_OPTIONS=-Xmx64m\n");
  await writeFile(startScript, "#!/bin/sh\n");
  const enter = (env) => {
    let executed = null;
    runStagingEnter(["mnt:[4026532800]", environmentFile, startScript, process.cwd(), "java", "-version"], {
      env, execve: (file, args, environment) => { executed = environment; }, link: () => "mnt:[4026532800]"
    });
    return executed;
  };
  assert.equal(enter(entered.env).JAVA_TOOL_OPTIONS, `${jvm} -Xmx64m`);
  assert.equal(enter(entered.env).TMPDIR, folder);

  // A unit that names none gives none, and its JVM keeps its own options alone.
  const plain = { ...unit, tmpdir: "" };
  assert.equal("TMPDIR" in stagingEnterCommand({ command: [], env: { TMPDIR: "/tmp" }, helperPath: HELPER,
    mountNamespace: "mnt:[4026532800]", pid: 4242, unit: plain, user }).env, false);
  const unnamed = stagingLoginEnvironment(plain, { env: {}, helperPath: HELPER, readEnvironment: () => ({ JAVA_TOOL_OPTIONS: "-Xmx64m" }) });
  assert.deepEqual([unnamed.TMPDIR, unnamed.JAVA_TOOL_OPTIONS], [undefined, "-Xmx64m"]);
  assert.equal(enter({ PATH: "/usr/bin:/bin" }).JAVA_TOOL_OPTIONS, "-Xmx64m");
});

test("a staging login runs bash without profile or rc files, the client's command through it or an SFTP server", () => {
  assert.deepEqual(stagingShellCommand("", "/usr/lib/openssh/sftp-server"),
    { argv: ["/bin/bash", "--noprofile", "--norc"], sftp: false });
  assert.deepEqual(stagingShellCommand("ls -la 'a b'", "/usr/lib/openssh/sftp-server"),
    { argv: ["/bin/bash", "--noprofile", "--norc", "-c", "ls -la 'a b'"], sftp: false });
  // As sshd hands over the sftp subsystem scp and sftp ask for: its configured command and a space.
  for (const subsystem of ["internal-sftp ", "internal-sftp", "/usr/lib/openssh/sftp-server -l INFO"]) {
    assert.deepEqual(stagingShellCommand(subsystem, "/usr/lib/openssh/sftp-server"),
      { argv: ["/usr/lib/openssh/sftp-server"], sftp: true }, subsystem);
  }
  assert.throws(() => stagingShellCommand("internal-sftp", ""), /no SFTP server/u);
  // The start script a publishing host writes for a release runs the command it is given instead of Serve.
  assert.equal(START_SCRIPT_RUNS_ARGUMENTS, "[ \"$#\" -eq 0 ] || exec \"$@\"");
  assert.deepEqual(stagingShellFunctions(HELPER), {
    "BASH_FUNC_staging-enter%%": `() {  sudo -n ${HELPER} staging-service enter "$@"\n}`,
    "BASH_FUNC_staging-logs%%": `() {  sudo -n ${HELPER} staging-service logs "$@"\n}`,
    "BASH_FUNC_staging-restart%%": `() {  sudo -n ${HELPER} staging-service restart "$@"\n}`,
    "BASH_FUNC_staging-status%%": `() {  sudo -n ${HELPER} staging-service status "$@"\n}`
  });
});

test("staging-enter becomes the staging account before anything in the service's mount namespace runs", () => {
  const unit = {
    environmentFile: "/var/lib/vibe64-staging/test/shop/handover/r2/environment",
    name: "vibe64-staging-test-shop-bbbbbbbbbbbb.service",
    path: "/opt/vibe64/runtime-packs/node26/bin:/usr/bin:/bin",
    startScript: "/var/lib/vibe64-staging/test/shop/handover/r2/start.sh",
    workingDirectory: "/var/lib/vibe64-staging/test/shop/app/releases/r2/workspace"
  };
  const user = { gid: 990, home: "/var/lib/vibe64-staging/test/shop/app/home", uid: 991, username: ACCOUNT };
  // Root's own environment (sudo's) gives the terminal and language, nothing else.
  const entered = stagingEnterCommand({ command: ["ls", "-la"], env: { SECRET: "no", TERM: "xterm" }, helperPath: HELPER,
    mountNamespace: "mnt:[4026532800]", pid: 4242, unit, user });
  assert.equal(entered.file, "/usr/bin/nsenter");
  assert.deepEqual(entered.args, ["/usr/bin/nsenter", "--target=4242", "--mount", "--setgid=990", "--setuid=991", "--",
    HELPER, "staging-enter", "mnt:[4026532800]", unit.environmentFile, unit.startScript, unit.workingDirectory, "ls", "-la"]);
  assert.deepEqual(entered.env, {
    HOME: user.home,
    LANG: "C.UTF-8",
    LOGNAME: ACCOUNT,
    PATH: unit.path,
    SHELL: "/bin/bash",
    TERM: "xterm",
    USER: ACCOUNT,
    VIBE64_STAGING_UNIT: unit.name
  });
  // A main process in a user namespace the application made itself (its FUSE volume) is joined there too, as
  // the ids the account has in it; one in the host's is not.
  const inOwn = stagingEnterCommand({ command: [], env: {}, helperPath: HELPER, pid: 4242, unit, user,
    userNamespace: { gid: 0, uid: 0 } });
  assert.deepEqual(inOwn.args.slice(0, 7), ["/usr/bin/nsenter", "--target=4242", "--mount", "--user", "--setgid=0", "--setuid=0", "--"]);
  const proc = (userLink, maps) => ({
    link: (file) => (file === "/proc/self/ns/user" ? "user:[4026531837]" : userLink),
    read: (file) => maps[path.basename(file)]
  });
  assert.equal(serviceUserNamespace(4242, user, proc("user:[4026531837]", {})), null);
  assert.deepEqual(serviceUserNamespace(4242, user, proc("user:[4026532700]", { gid_map: "         0        990          1\n",
    uid_map: "         0        991          1\n" })), { gid: 0, uid: 0 });
  assert.deepEqual(serviceUserNamespace(4242, user, proc("user:[4026532700]", { gid_map: "1000 900 100\n",
    uid_map: "0 5000 1\n2000 950 100\n" })), { gid: 1090, uid: 2041 });
  assert.throws(() => serviceUserNamespace(4242, user, proc("user:[4026532700]", { gid_map: "0 990 1\n", uid_map: "0 5000 1\n" })),
    /does not include its account, so staging-enter cannot join it/u);
  // There it runs the command, or the shell, through the release's start script as the login does; a release
  // whose start script runs only Serve gets the command, found on its PATH, or the shell directly.
  assert.deepEqual(stagingEnterArgv(["ls", "-la"], unit.startScript), [unit.startScript, "ls", "-la"]);
  assert.deepEqual(stagingEnterArgv([], unit.startScript), [unit.startScript, "/bin/bash", "--noprofile", "--norc"]);
  assert.deepEqual(stagingEnterArgv(["ls", "-la"], ""),
    ["/bin/bash", "--noprofile", "--norc", "-c", "exec \"$@\"", "staging-enter", "ls", "-la"]);
  assert.deepEqual(stagingEnterArgv([], ""), ["/bin/bash", "--noprofile", "--norc"]);
});

test("staging-enter enters only a main process that is in the service's own cgroup before and after root reads it", () => {
  const unit = {
    environmentFile: "/var/lib/vibe64-staging/test/shop/handover/r2/environment",
    name: "vibe64-staging-test-shop-bbbbbbbbbbbb.service",
    path: "/usr/bin:/bin",
    startScript: "/var/lib/vibe64-staging/test/shop/handover/r2/start.sh",
    workingDirectory: "/var/lib/vibe64-staging/test/shop/app/releases/r2/workspace"
  };
  const user = { gid: 990, home: "/home/shop", uid: 991, username: ACCOUNT };
  const service = "/system.slice/vibe64-staging-test-shop-bbbbbbbbbbbb.service";
  function enter(cgroups, { mainPid = "4242" } = {}) {
    const read = [];
    let executed = null;
    enterStagingService(unit, user, ["id"], {
      env: {},
      execve: (file, args) => { executed = [file, ...args]; },
      link: (file) => (file.endsWith("/ns/mnt") ? "mnt:[4026532800]" : "user:[4026531837]"),
      read: (file) => {
        read.push(file);
        if (file !== "/proc/4242/cgroup") throw new Error(`unexpected read ${file}`);
        return cgroups.shift();
      },
      runRoot: (command, args) => {
        assert.deepEqual([command, ...args], ["systemctl", "show", unit.name, "--property=MainPID", "--property=ControlGroup"]);
        return `MainPID=${mainPid}\nControlGroup=${service}`;
      }
    });
    return { executed, read };
  }
  const entered = enter([`0::${service}\n`, `0::${service}/app\n`]);
  assert.deepEqual(entered.read, ["/proc/4242/cgroup", "/proc/4242/cgroup"]);
  assert.deepEqual(entered.executed.slice(0, 3), ["/usr/bin/nsenter", "/usr/bin/nsenter", "--target=4242"]);
  assert.ok(entered.executed.includes("mnt:[4026532800]"), "staging-enter checks the namespace root read");
  // A number another process took, before or after root read its namespaces, is refused.
  for (const cgroups of [["0::/user.slice/user-1000.slice/session-3.scope\n", `0::${service}\n`],
    [`0::${service}\n`, "0::/system.slice/cron.service\n"], [`0::${service}-other\n`, `0::${service}\n`]]) {
    assert.throws(() => enter(cgroups), /changed while staging-enter started; try again/u, cgroups.join(" then "));
  }
  assert.throws(() => enter([], { mainPid: "0" }), /is not running, so there is nothing to enter/u);
  // Inside, before anything runs, staging-enter checks it is in the namespace root read for the service.
  assert.throws(() => runStagingEnter(["mnt:[4026532800]", unit.environmentFile, unit.startScript, unit.workingDirectory],
    { link: () => "mnt:[4026531841]" }), /did not reach the running staging service: its main process changed meanwhile/u);
});

test("staging-logs reads 200 lines unless told, from a time journalctl takes as one argument", () => {
  assert.deepEqual(stagingLogWindow([]), { lines: 200, since: "" });
  assert.deepEqual(stagingLogWindow(["--lines", "50", "--since=1 hour ago"]), { lines: 50, since: "1 hour ago" });
  assert.deepEqual(stagingLogWindow(["--since", "2026-11-11 08:00", "--lines=5000"]), { lines: 5000, since: "2026-11-11 08:00" });
  for (const args of [["--lines", "0"], ["--lines", "5001"], ["--lines", "x"], ["--since", "--output=json"],
    ["--lines", "5", "--lines", "6"], ["--follow"], ["--lines"]]) {
    assert.throws(() => stagingLogWindow(args), undefined, args.join(" "));
  }
});

test("staging activity is logind's own record of each login and, apart, what each login reported, oldest first", () => {
  const asked = [];
  const journal = {
    "USER_ID=v64s_0123456789ab": [
      { MESSAGE: "New session 12 of user v64s_0123456789ab.", MESSAGE_ID: "8d45620c1a4348dbb17410da57c60c66", SESSION_ID: "12",
        __REALTIME_TIMESTAMP: "1762848000000000" },
      { MESSAGE: "Removed session 12.", MESSAGE_ID: "3354939424b4456d9802ca8333ed424a", SESSION_ID: "12",
        __REALTIME_TIMESTAMP: "1762848002000000" },
      { MESSAGE: "Session 12 logged out. Waiting for processes to exit.", __REALTIME_TIMESTAMP: "1762848001500000" }
    ],
    "_UID=991": [
      { MESSAGE: "{\"event\":\"start\",\"command\":\"ls\",\"login\":\"12\"}", __REALTIME_TIMESTAMP: "1762848000500000" },
      { MESSAGE: [104, 105], __REALTIME_TIMESTAMP: "1762848001000000" }
    ]
  };
  const runRootAllowFailure = (command, args) => {
    asked.push([command, ...args]);
    const entries = journal[args.at(-1)];
    return { stdout: ["not json", ...entries.map((entry) => JSON.stringify(entry)), ""].join("\n") };
  };
  const activity = stagingActivity({ uid: 991, username: ACCOUNT }, { runRootAllowFailure });
  // Root's logind writes the first; anything the account logs carries its own uid, never root's.
  assert.deepEqual(asked, [
    ["journalctl", "--no-pager", "--output=json", "--lines=501", "_UID=0", "_SYSTEMD_UNIT=systemd-logind.service", `USER_ID=${ACCOUNT}`],
    ["journalctl", "--no-pager", "--output=json", "--lines=501", "SYSLOG_IDENTIFIER=vibe64-staging", "_UID=991"]
  ]);
  assert.deepEqual(activity, {
    entries: [
      { at: "2025-11-11T08:00:00.000Z", event: "opened", login: "12", source: "host" },
      { at: "2025-11-11T08:00:00.500Z", message: "{\"event\":\"start\",\"command\":\"ls\",\"login\":\"12\"}", source: "login" },
      { at: "2025-11-11T08:00:02.000Z", event: "closed", login: "12", source: "host" }
    ],
    olderOmitted: { host: false, login: false }
  });
  // Past 500 of a kind the oldest are left out, and said to be; a login reporting a lot cannot push out the host's.
  journal["_UID=991"] = Array.from({ length: 501 }, (_, index) => ({ MESSAGE: `line ${index}`, __REALTIME_TIMESTAMP: `${1762848003000000 + index}` }));
  const flooded = stagingActivity({ uid: 991, username: ACCOUNT }, { runRootAllowFailure });
  assert.deepEqual(flooded.olderOmitted, { host: false, login: true });
  assert.equal(flooded.entries.filter(({ source }) => source === "login").length, 500);
  assert.equal(flooded.entries.find(({ source }) => source === "login").message, "line 1");
  assert.equal(flooded.entries.filter(({ source }) => source === "host").length, 2);
  assert.deepEqual(stagingActivity(null), { entries: [], olderOmitted: { host: false, login: false } });
});

test("only a staging account's own staging login reaches staging-shell, staging-service and staging-enter", async () => {
  const run = (args, env) => promisify(execFile)(process.execPath, [EXEC_HELPER, ...args], { env }).then(
    () => ({ code: 0, stderr: "" }),
    (error) => ({ code: error.code, stderr: error.stderr })
  );
  const shell = await run(["staging-shell"], { ...process.env, SSH_ORIGINAL_COMMAND: "id" });
  assert.equal(shell.code, 2);
  assert.match(shell.stderr, /Only a staging account's staging login starts here\./u);
  for (const action of ["restart", "enter"]) {
    const service = await run(["staging-service", action], { ...process.env, SUDO_UID: String(UID), SUDO_USER: os.userInfo().username });
    assert.equal(service.code, 2);
    assert.match(service.stderr, /Only a staging account's staging login may use staging-service\./u);
  }
  const enter = await run(["staging-enter", "mnt:[4026531841]", "environment", "start.sh", "release", "id"], process.env);
  assert.equal(enter.code, 2);
  assert.match(enter.stderr, /Only staging-enter, in a staging account's staging login, starts here\./u);
  // Any other name, an old one included, is refused as an unknown command.
  for (const old of ["production-shell", "production-service", "production-enter"]) {
    const refused = await run([old], process.env);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /^Usage: vibe64-exec-helper execute \[payload-json-file\]$/mu);
  }
});
