import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  installProductionAccess,
  productionAccessGranted,
  removeProductionAccess
} from "../../packages/vibe64-execution/src/host/productionAccess.js";
import {
  liveReleaseUnit,
  productionActivity,
  productionEnterArgv,
  productionEnterCommand,
  productionLogWindow,
  productionShellCommand,
  productionShellFunctions,
  serviceUserNamespace,
  START_SCRIPT_RUNS_ARGUMENTS
} from "../../packages/vibe64-execution/src/host/productionLogin.js";
import { deploymentServiceUnit } from "../../packages/vibe64-execution/src/host/systemdUnits.js";

const EXEC_HELPER = fileURLToPath(new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url));
const UID = process.getuid();
const ACCOUNT = "v64a_0123456789ab";
const PUBLIC_KEY = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${"A".repeat(43)}`;
const HELPER = "/usr/lib/vibe64/vibe64-exec-helper";

// Root's folders as the helper writes them, in a temporary directory: the test's uid stands in for root.
async function productionHost(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-production-access-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const calls = [];
  const options = {
    keysRoot: path.join(root, "etc", "vibe64", "production-ssh"),
    rootUid: UID,
    runRoot: (command, args) => {
      calls.push([command, ...args]);
      return "";
    },
    runRootAllowFailure: (command, args) => {
      calls.push([command, ...args]);
      return { status: 1, stderr: "not logged in", stdout: "" };
    },
    sudoersRoot: path.join(root, "etc", "sudoers.d")
  };
  await mkdir(options.sudoersRoot, { recursive: true });
  return { calls, options, root };
}

test("granting production access installs the key as root's file, the account's own sudo rule and a login shell", async (t) => {
  const host = await productionHost(t);
  installProductionAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);

  const keys = path.join(host.options.keysRoot, ACCOUNT);
  assert.equal(await readFile(keys, "utf8"), `from="127.0.0.1,::1",restrict,pty ${PUBLIC_KEY} vibe64-production\n`);
  assert.equal((await stat(keys)).mode & 0o777, 0o644);
  assert.equal((await stat(host.options.keysRoot)).mode & 0o777, 0o755);
  const rule = path.join(host.options.sudoersRoot, `vibe64-production-${ACCOUNT}`);
  assert.equal(await readFile(rule, "utf8"), `${ACCOUNT} ALL=(root) NOPASSWD: ${HELPER} production-service *\n`);
  assert.equal((await stat(rule)).mode & 0o777, 0o440);
  // visudo checks the candidate before it is renamed into place; then the account gets its login shell.
  assert.equal(host.calls[0][0], "visudo");
  assert.match(host.calls[0][2], new RegExp(`/\\.vibe64-production-${ACCOUNT}\\.\\d+$`, "u"));
  assert.deepEqual(host.calls[1], ["usermod", "--shell", "/bin/bash", ACCOUNT]);
  assert.equal(productionAccessGranted(ACCOUNT, host.options), true);

  // Granting again replaces the key and leaves an account that already has its shell alone.
  host.calls.length = 0;
  installProductionAccess({ shell: "/bin/bash", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);
  assert.deepEqual(host.calls.map(([command]) => command), ["visudo"]);
  assert.deepEqual((await readdir(host.options.keysRoot)).sort(), [ACCOUNT]);
});

test("a sudo rule visudo refuses is never installed", async (t) => {
  const host = await productionHost(t);
  const refusing = {
    ...host.options,
    runRoot: (command) => {
      if (command === "visudo") throw new Error("parse error");
      return "";
    }
  };
  assert.throws(() => installProductionAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, refusing),
    /parse error/u);
  assert.deepEqual(await readdir(host.options.sudoersRoot), []);
});

test("a key file anyone but root may change, or one root did not write, grants nothing", async (t) => {
  const host = await productionHost(t);
  installProductionAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);
  assert.equal(productionAccessGranted(ACCOUNT, { ...host.options, rootUid: UID + 1 }), false);
  await chmod(path.join(host.options.keysRoot, ACCOUNT), 0o664);
  assert.equal(productionAccessGranted(ACCOUNT, host.options), false);
  assert.equal(productionAccessGranted("v64a_ffffffffffff", host.options), false);
});

test("revoking production access removes the key, the rule and the login shell, and ends the open logins", async (t) => {
  const host = await productionHost(t);
  installProductionAccess({ shell: "/usr/sbin/nologin", username: ACCOUNT }, PUBLIC_KEY, HELPER, host.options);
  host.calls.length = 0;

  assert.equal(removeProductionAccess({ shell: "/bin/bash", username: ACCOUNT }, ACCOUNT, host.options), true);
  assert.deepEqual(await readdir(host.options.keysRoot), []);
  assert.deepEqual(await readdir(host.options.sudoersRoot), []);
  assert.deepEqual(host.calls, [
    ["usermod", "--shell", "/usr/sbin/nologin", ACCOUNT],
    ["loginctl", "terminate-user", ACCOUNT]
  ]);
  assert.equal(productionAccessGranted(ACCOUNT, host.options), false);

  // Nothing left to remove is no error, and an account that no longer exists has no login to end.
  host.calls.length = 0;
  assert.equal(removeProductionAccess(null, ACCOUNT, host.options), false);
  assert.deepEqual(host.calls, []);
});

function releaseUnitLines({ user = ACCOUNT, release = "20261111_080000z-ab12cd34", name = "vibe64-release-test-shop-0123456789ab.service" } = {}) {
  const handover = `/var/lib/vibe64-apps/test/shop/handover/${release}`;
  return {
    lines: deploymentServiceUnit({
      environmentFile: `${handover}/environment`,
      helperPath: HELPER,
      loopbackPort: 41000,
      owner: { username: "v64d_test" },
      startScript: `${handover}/start.sh`,
      servicePath: "/opt/vibe64/runtime-packs/node26/bin:/usr/bin:/bin",
      unitName: name,
      user: { application: { appRoot: "/var/lib/vibe64-apps/test/shop/app", databaseRoot: "/var/lib/vibe64-apps/test/shop/database" }, username: user },
      workingDirectory: `/var/lib/vibe64-apps/test/shop/app/releases/${release}/workspace`
    }).split("\n"),
    name
  };
}

test("a production login finds the account's own release unit as root installed it, the running one first", () => {
  const older = releaseUnitLines({ name: "vibe64-release-test-shop-aaaaaaaaaaaa.service", release: "r1" });
  const live = releaseUnitLines({ name: "vibe64-release-test-shop-bbbbbbbbbbbb.service", release: "r2" });
  const another = releaseUnitLines({ name: "vibe64-release-test-blog-cccccccccccc.service", user: "v64a_ffffffffffff" });
  const units = () => [older, live, another];

  assert.deepEqual(liveReleaseUnit(ACCOUNT, { isActive: (name) => name === live.name, units }), {
    environmentFile: "/var/lib/vibe64-apps/test/shop/handover/r2/environment",
    name: live.name,
    path: "/opt/vibe64/runtime-packs/node26/bin:/usr/bin:/bin",
    startScript: "/var/lib/vibe64-apps/test/shop/handover/r2/start.sh",
    workingDirectory: "/var/lib/vibe64-apps/test/shop/app/releases/r2/workspace"
  });
  // With none running, the last of its own; another account's unit is never its.
  assert.equal(liveReleaseUnit(ACCOUNT, { isActive: () => false, units }).name, live.name);
  assert.equal(liveReleaseUnit("v64a_ffffffffffff", { isActive: () => true, units }).name, another.name);
  assert.equal(liveReleaseUnit("v64a_eeeeeeeeeeee", { isActive: () => true, units }), null);
  const odd = { lines: [`User=${ACCOUNT}`, "ExecStart=/bin/sh -c true"], name: "vibe64-release-test-shop-dddddddddddd.service" };
  assert.throws(() => liveReleaseUnit(ACCOUNT, { isActive: () => true, units: () => [odd] }),
    /does not start a Vibe64 release service/u);
});

test("a production login runs the account's shell, the client's command or an SFTP server", () => {
  assert.deepEqual(productionShellCommand("", "/usr/lib/openssh/sftp-server"), { argv: ["/bin/bash", "--norc"], sftp: false });
  assert.deepEqual(productionShellCommand("ls -la 'a b'", "/usr/lib/openssh/sftp-server"),
    { argv: ["/bin/bash", "-c", "ls -la 'a b'"], sftp: false });
  // As sshd hands over the sftp subsystem scp and sftp ask for: its configured command and a space.
  for (const subsystem of ["internal-sftp ", "internal-sftp", "/usr/lib/openssh/sftp-server -l INFO"]) {
    assert.deepEqual(productionShellCommand(subsystem, "/usr/lib/openssh/sftp-server"),
      { argv: ["/usr/lib/openssh/sftp-server"], sftp: true }, subsystem);
  }
  assert.throws(() => productionShellCommand("internal-sftp", ""), /no SFTP server/u);
  // The start script a publishing host writes for a release runs the command it is given instead of Serve.
  assert.equal(START_SCRIPT_RUNS_ARGUMENTS, "[ \"$#\" -eq 0 ] || exec \"$@\"");
  assert.deepEqual(productionShellFunctions(HELPER), {
    "BASH_FUNC_production-enter%%": `() {  sudo -n ${HELPER} production-service enter "$@"\n}`,
    "BASH_FUNC_production-logs%%": `() {  sudo -n ${HELPER} production-service logs "$@"\n}`,
    "BASH_FUNC_production-restart%%": `() {  sudo -n ${HELPER} production-service restart "$@"\n}`,
    "BASH_FUNC_production-status%%": `() {  sudo -n ${HELPER} production-service status "$@"\n}`
  });
});

test("production-enter becomes the application account before anything in the service's mount namespace runs", () => {
  const unit = {
    environmentFile: "/var/lib/vibe64-apps/test/shop/handover/r2/environment",
    name: "vibe64-release-test-shop-bbbbbbbbbbbb.service",
    path: "/opt/vibe64/runtime-packs/node26/bin:/usr/bin:/bin",
    startScript: "/var/lib/vibe64-apps/test/shop/handover/r2/start.sh",
    workingDirectory: "/var/lib/vibe64-apps/test/shop/app/releases/r2/workspace"
  };
  const user = { gid: 990, home: "/var/lib/vibe64-apps/test/shop/app/home", uid: 991, username: ACCOUNT };
  // Root's own environment (sudo's) gives the terminal and language, nothing else.
  const entered = productionEnterCommand({ command: ["ls", "-la"], env: { SECRET: "no", TERM: "xterm" }, helperPath: HELPER, pid: 4242, unit, user });
  assert.equal(entered.file, "/usr/bin/nsenter");
  assert.deepEqual(entered.args, ["/usr/bin/nsenter", "--target=4242", "--mount", "--setgid=990", "--setuid=991", "--",
    HELPER, "production-enter", unit.environmentFile, unit.startScript, unit.workingDirectory, "ls", "-la"]);
  assert.deepEqual(entered.env, {
    HOME: user.home,
    LANG: "C.UTF-8",
    LOGNAME: ACCOUNT,
    PATH: unit.path,
    SHELL: "/bin/bash",
    TERM: "xterm",
    USER: ACCOUNT,
    VIBE64_RELEASE_UNIT: unit.name
  });
  // A main process in a user namespace the application made itself (its FUSE volume) is joined there too, as
  // the ids the account has in it; one in the host's is not.
  const inOwn = productionEnterCommand({ command: [], env: {}, helperPath: HELPER, pid: 4242, unit, user,
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
    /does not include its account, so production-enter cannot join it/u);
  // There it runs the command, or the shell, through the release's start script as the login does; a release
  // whose start script runs only Serve gets the command, found on its PATH, or the shell directly.
  assert.deepEqual(productionEnterArgv(["ls", "-la"], unit.startScript), [unit.startScript, "ls", "-la"]);
  assert.deepEqual(productionEnterArgv([], unit.startScript), [unit.startScript, "/bin/bash", "--norc"]);
  assert.deepEqual(productionEnterArgv(["ls", "-la"], ""), ["/bin/bash", "-c", "exec \"$@\"", "production-enter", "ls", "-la"]);
  assert.deepEqual(productionEnterArgv([], ""), ["/bin/bash", "--norc"]);
});

test("production-logs reads 200 lines unless told, from a time journalctl takes as one argument", () => {
  assert.deepEqual(productionLogWindow([]), { lines: 200, since: "" });
  assert.deepEqual(productionLogWindow(["--lines", "50", "--since=1 hour ago"]), { lines: 50, since: "1 hour ago" });
  assert.deepEqual(productionLogWindow(["--since", "2026-11-11 08:00", "--lines=5000"]), { lines: 5000, since: "2026-11-11 08:00" });
  for (const args of [["--lines", "0"], ["--lines", "5001"], ["--lines", "x"], ["--since", "--output=json"],
    ["--lines", "5", "--lines", "6"], ["--follow"], ["--lines"]]) {
    assert.throws(() => productionLogWindow(args), undefined, args.join(" "));
  }
});

test("production activity is what the account itself logged under Vibe64's tag, oldest first", () => {
  let asked = [];
  const entries = productionActivity({ uid: 991 }, {
    runRootAllowFailure: (command, args) => {
      asked = [command, ...args];
      return {
        stdout: [
          JSON.stringify({ MESSAGE: "{\"event\":\"start\",\"command\":\"ls\"}", __REALTIME_TIMESTAMP: "1762848000000000" }),
          JSON.stringify({ MESSAGE: [104, 105], __REALTIME_TIMESTAMP: "1762848001000000" }),
          "not json",
          ""
        ].join("\n")
      };
    }
  });
  assert.deepEqual(asked, ["journalctl", "--no-pager", "--output=json", "--lines=500", "SYSLOG_IDENTIFIER=vibe64-production", "_UID=991"]);
  assert.deepEqual(entries, [{ at: "2025-11-11T08:00:00.000Z", message: "{\"event\":\"start\",\"command\":\"ls\"}" }]);
  assert.deepEqual(productionActivity(null), []);
});

test("only an application account's own production login reaches production-shell, production-service and production-enter", async () => {
  const run = (args, env) => promisify(execFile)(process.execPath, [EXEC_HELPER, ...args], { env }).then(
    () => ({ code: 0, stderr: "" }),
    (error) => ({ code: error.code, stderr: error.stderr })
  );
  const shell = await run(["production-shell"], { ...process.env, SSH_ORIGINAL_COMMAND: "id" });
  assert.equal(shell.code, 2);
  assert.match(shell.stderr, /Only an application account's production login starts here\./u);
  for (const action of ["restart", "enter"]) {
    const service = await run(["production-service", action], { ...process.env, SUDO_UID: String(UID), SUDO_USER: os.userInfo().username });
    assert.equal(service.code, 2);
    assert.match(service.stderr, /Only an application account's production login may use production-service\./u);
  }
  const enter = await run(["production-enter", "environment", "start.sh", "release", "id"], process.env);
  assert.equal(enter.code, 2);
  assert.match(enter.stderr, /Only production-enter, in an application account's production login, starts here\./u);
});
