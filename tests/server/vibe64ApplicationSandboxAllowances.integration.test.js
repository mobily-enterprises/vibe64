// A Deployment's `Sandbox allows:` on a real host: the exact lines the exec
// helper gives an application's commands (accountUnitLines), run as transient
// systemd units through sudo, as managed execution runs them. Without an
// allowance an application makes no namespace, opens no /dev/fuse and starts
// no gVisor; `fuse` lets it mount a FUSE file system in a user and mount
// namespace of its own, seen nowhere else; `gvisor` lets it run gVisor's
// rootless runsc; and every namespace, system call group and device each one
// adds is needed: without any one of them, what it allows fails again.
//
// Opt-in, because it needs root through sudo and a gVisor binary:
//   VIBE64_TEST_APPLICATION_SANDBOX=1
//   VIBE64_TEST_RUNSC=<gVisor's runsc binary, with its gvisor-bin folder beside it>
// It also needs passwordless sudo, systemd, util-linux's unshare and mount,
// /dev/fuse, a group named like the user running it, and a host that lets
// unprivileged users make user namespaces, as Vibe64's hosts do. Units can't see
// /home (ProtectHome=yes), so its application area is a folder under /srv,
// made and removed through sudo.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HOST_SETTINGS_ROOT } from "../../packages/vibe64-execution/src/host/hostAccounts.js";
import { accountUnitLines } from "../../packages/vibe64-execution/src/host/systemdUnits.js";

const RUNSC = process.env.VIBE64_TEST_RUNSC || "";
const USER = os.userInfo().username;
const PATH_LINE = "Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function skipReason() {
  if (process.env.VIBE64_TEST_APPLICATION_SANDBOX !== "1") {
    return "set VIBE64_TEST_APPLICATION_SANDBOX=1 and VIBE64_TEST_RUNSC to prove sandbox allowances on this host";
  }
  if (!RUNSC || !existsSync(RUNSC)) return "VIBE64_TEST_RUNSC must name gVisor's runsc binary";
  if (spawnSync("sudo", ["-n", "true"]).status !== 0) return "it needs passwordless sudo to start systemd units";
  let restricted = "0";
  try {
    restricted = readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim();
  } catch {
    // No AppArmor restriction on this kernel.
  }
  return restricted === "1"
    ? "this host restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1); Vibe64's hosts allow them"
    : false;
}

// Each probe prints one line: `<name>=ok`, or `<name>=refused <why>`.
const PROBES = String.raw`
probe() { name=$1; shift; if out=$("$@" 2>&1); then echo "$name=ok"; else echo "$name=refused $(printf '%s' "$out" | tr '\n' ' ' | head -c 300)"; fi; }
probe namespace unshare --user --map-root-user --mount true
probe fuse bash -c 'exec 3<>/dev/fuse'
probe fuse-mount unshare --user --map-root-user --mount bash -c '
  exec 3<>/dev/fuse || exit 1
  mount -i -t fuse -o fd=3,rootmode=40000,user_id=0,group_id=0 vibe64proof "$1" || exit 1
  grep -q " vibe64proof " /proc/self/mountinfo' _ "$APP/fuse"
id="proof-$$-$RANDOM"
probe gvisor bash -c '
  out=$("$1" --rootless --network=none --ignore-cgroups --overlay2=root:memory --root "$2/runsc-state" run --bundle "$2/bundle" "$3" 2>&1)
  printf "%s\n" "$out" | grep -qx gvisor-ok || { printf "%s" "$out" | tail -c 300; exit 1; }' _ "$APP/runsc" "$APP" "$id"
"$APP/runsc" --root "$APP/runsc-state" delete -force "$id" >/dev/null 2>&1 || true
`;

test("a Deployment's sandbox allowances on a real host", { skip: skipReason() }, async (t) => {
  const root = `/srv/vibe64-sandbox-proof-${randomBytes(6).toString("hex")}`;
  const identity = { appRoot: path.join(root, "app"), databaseRoot: path.join(root, "database") };
  const receiptRoot = path.join(root, "receipt");
  const app = identity.appRoot;
  assert.equal(spawnSync("sudo", ["-n", "install", "-d", "-m", "0700", "-o", USER, "-g", USER, root]).status, 0);
  t.after(() => {
    spawnSync("sudo", ["-n", "rm", "-rf", "--one-file-system", root]);
  });
  for (const folder of [app, identity.databaseRoot, receiptRoot, path.join(app, "fuse"), path.join(app, "runsc-state")]) {
    await mkdir(folder, { recursive: true });
  }
  // runsc and, in newer releases, the gvisor-bin folder of helpers it starts from beside itself.
  await copyFile(RUNSC, path.join(app, "runsc"));
  await chmod(path.join(app, "runsc"), 0o755);
  const helpers = path.join(path.dirname(RUNSC), "gvisor-bin");
  if (existsSync(helpers)) await cp(helpers, path.join(app, "gvisor-bin"), { recursive: true });
  // gVisor runs the host's own system, read-only, as a bot's command line would run its toolbox.
  await mkdir(path.join(app, "bundle"));
  await writeFile(path.join(app, "bundle", "config.json"), JSON.stringify({
    ociVersion: "1.0.0",
    process: { user: { uid: 0, gid: 0 }, args: ["/bin/sh", "-c", "echo gvisor-ok"], env: ["PATH=/usr/bin:/bin"], cwd: "/", noNewPrivileges: true },
    root: { path: "/", readonly: true },
    hostname: "proof",
    mounts: [
      { destination: "/proc", type: "proc", source: "proc" },
      { destination: "/dev", type: "tmpfs", source: "tmpfs" },
      { destination: "/tmp", type: "tmpfs", source: "tmpfs", options: ["size=64m", "mode=1777"] }
    ],
    linux: { namespaces: [{ type: "pid" }, { type: "network" }, { type: "ipc" }, { type: "uts" }, { type: "mount" }] }
  }));

  /**
   * Runs `script` as the application, under the helper's lines for `allowances`,
   * changed by `change` (a line in, a line or null out); `onLine` hears each
   * line it prints as it prints it.
   */
  function inUnit(allowances, script, { change = (line) => line, onLine = () => {} } = {}) {
    const lines = accountUnitLines({ username: USER, application: identity }, { receiptRoot, sandboxAllowances: allowances })
      // A test host has no Vibe64 settings folder to hide; systemd refuses to hide a missing path.
      .map((line) => (line === `InaccessiblePaths=${HOST_SETTINGS_ROOT}` && !existsSync(HOST_SETTINGS_ROOT) ? `InaccessiblePaths=-${HOST_SETTINGS_ROOT}` : line))
      .map(change)
      .filter(Boolean);
    const args = [
      "-n", "systemd-run", "--quiet", "--wait", "--pipe", "--collect", "--service-type=exec",
      `--unit=vibe64-sandbox-proof-${randomBytes(4).toString("hex")}`,
      ...[...lines, `WorkingDirectory=${app}`, PATH_LINE, `Environment=APP=${app}`].map((line) => `--property=${line}`),
      "/usr/bin/setpriv", "--no-new-privs", "--", "/bin/bash", "-c", script
    ];
    return new Promise((resolve) => {
      const child = spawn("sudo", args, { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let pending = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        pending += chunk;
        const parts = pending.split("\n");
        pending = parts.pop();
        parts.forEach(onLine);
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("close", (status) => resolve({ status, output }));
    });
  }

  async function probes(allowances, change) {
    const { output } = await inUnit(allowances, PROBES, { change });
    const results = Object.fromEntries(output.split("\n").map((line) => line.match(/^([a-z-]+)=(ok|refused)/u)).filter(Boolean).map((match) => [match[1], match[2]]));
    return { results, output };
  }

  const expected = {
    none: { allowances: [], ok: [] },
    fuse: { allowances: ["fuse"], ok: ["namespace", "fuse", "fuse-mount"] },
    gvisor: { allowances: ["gvisor"], ok: ["namespace", "gvisor"] },
    both: { allowances: ["fuse", "gvisor"], ok: ["namespace", "fuse", "fuse-mount", "gvisor"] }
  };
  for (const [label, { allowances, ok }] of Object.entries(expected)) {
    await t.test(`${label}: allows ${ok.join(", ") || "nothing"} and nothing else`, async () => {
      const { results, output } = await probes(allowances);
      for (const name of ["namespace", "fuse", "fuse-mount", "gvisor"]) {
        assert.equal(results[name], ok.includes(name) ? "ok" : "refused", `${name}\n${output}`);
      }
    });
  }

  await t.test("a FUSE mount in the application's own namespace is seen nowhere else", async () => {
    let seenByHost = null;
    const { status, output } = await inUnit(["fuse"], String.raw`
unshare --user --map-root-user --mount bash -c '
  exec 3<>/dev/fuse && mount -i -t fuse -o fd=3,rootmode=40000,user_id=0,group_id=0 vibe64proof "$1" || exit 1
  echo inside=$(grep -c " vibe64proof " /proc/self/mountinfo); touch "$2"; sleep 3' _ "$APP/fuse" "$APP/mounted" &
for i in $(seq 100); do [ -e "$APP/mounted" ] && break; sleep 0.05; done
echo unit=$(grep -c " vibe64proof " /proc/self/mountinfo)
echo HOLDING
wait $!`, {
      onLine: (line) => {
        if (line === "HOLDING") seenByHost = readFileSync("/proc/self/mountinfo", "utf8").includes(" vibe64proof ");
      }
    });
    assert.equal(status, 0, output);
    assert.match(output, /^inside=1$/mu, "the namespace sees its mount");
    assert.match(output, /^unit=0$/mu, "the rest of the application's own unit doesn't");
    assert.equal(seenByHost, false, "the host doesn't");
  });

  // Each part of an allowance is needed: without it, what the allowance gives fails again.
  const namespaces = (line, without) => (line.startsWith("RestrictNamespaces=")
    ? `RestrictNamespaces=${line.slice("RestrictNamespaces=".length).split(" ").filter((name) => name !== without).join(" ")}`
    : line);
  const systemCalls = (line, without) => (line.startsWith("SystemCallFilter=")
    ? line.split(" ").filter((group) => group !== without).join(" ")
    : line);
  const parts = [
    ...["user", "mnt", "pid", "ipc", "uts", "net"].map((name) => ["gvisor", `namespace ${name}`, (line) => namespaces(line, name)]),
    ["gvisor", "system calls @mount", (line) => systemCalls(line, "@mount")],
    ["gvisor", "system call ptrace", (line) => systemCalls(line, "ptrace")],
    ...["user", "mnt"].map((name) => ["fuse-mount", `namespace ${name}`, (line) => namespaces(line, name)]),
    ["fuse-mount", "system calls @mount", (line) => systemCalls(line, "@mount")],
    ["fuse-mount", "the /dev/fuse device", (line) => (line.startsWith("DeviceAllow=/dev/fuse") || line === "BindPaths=/dev/fuse" ? null : line)]
  ];
  for (const [probe, part, change] of parts) {
    await t.test(`${probe === "gvisor" ? "gvisor" : "fuse"} needs ${part}`, async () => {
      const allowance = probe === "gvisor" ? ["gvisor"] : ["fuse"];
      const { results, output } = await probes(allowance, change);
      assert.equal(results[probe], "refused", output);
    });
  }
});
