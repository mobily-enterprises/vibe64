// An agent's commands run as the workspace daemon, whose sudo rule names the exec helper, and the helper took the
// daemon's word for every execution it started. So an agent's command could reach the helper through `sudo -n` and,
// as root's helper starts any execution, start a unit outside its own job: one no Stop, no command end and no session
// close ever reached. Every execution's runner now starts with no new privileges (NO_NEW_PRIVILEGES_COMMAND), so sudo,
// like every setuid program, cannot raise it.
//
// On a host with a user systemd manager and passwordless sudo (the test hosts have both), an agent's command runs in a
// transient unit of its own, started as the helper starts its runner. Its "helper" is a stand-in it runs through
// `sudo -n`, which as root starts a system unit of its own, as the helper's managed execution start does; that unit
// runs as the test's own user, so nothing privileged runs even where the escape succeeds. The same command in a unit
// started as the daemon's executions were before, without the prefix, does reach root and start that unit, which
// outlives the command: the escape the prefix closes, seen on every run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { NO_NEW_PRIVILEGES_COMMAND } from "../../packages/vibe64-execution/src/host/systemdUnits.js";

function skipReason() {
  if (spawnSync("systemd-run", ["--user", "--quiet", "--wait", "--collect", "true"]).status !== 0) {
    return "it needs a user systemd manager (systemd-run --user) to start the agent's unit";
  }
  if (spawnSync("sudo", ["-n", "true"]).status !== 0) {
    return "it needs passwordless sudo, which stands for the daemon's sudo rule";
  }
  return false;
}

// The helper's step that matters here: as root, a unit of its own, outside the caller's.
const HELPER = `[ "$1" = execute ] || exit 64
exec systemd-run --quiet --collect --unit="$2" --uid="$3" sleep 300
`;
// The agent's command: whether it has no new privileges, and whether it reached the helper through sudo.
const COMMAND = `grep '^NoNewPrivs:' /proc/self/status
if sudo -n /bin/sh "$1/helper.sh" execute "$2" "$3" > /dev/null 2>&1; then echo reached; else echo refused; fi
`;

test("an agent's command cannot reach the exec helper through sudo to start a unit outside its job", {
  skip: skipReason()
}, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibe64-no-new-privileges-"));
  const id = randomBytes(4).toString("hex");
  const escapes = [];
  t.after(async () => {
    for (const unit of escapes) spawnSync("sudo", ["-n", "systemctl", "stop", unit]);
    await rm(dir, { force: true, recursive: true });
  });
  await writeFile(path.join(dir, "helper.sh"), HELPER);
  await writeFile(path.join(dir, "command.sh"), COMMAND);
  // The units run as the test's user, which reads its scripts there.
  await chmod(dir, 0o755);

  /** Runs the agent's command in a job unit whose runner starts under `prefix`, and the unit it tried to start. */
  function agentCommand(name, prefix) {
    const escape = `vibe64-nnp-${id}-${name}-escape.service`;
    escapes.push(escape);
    const job = spawnSync("systemd-run", [
      "--user", "--quiet", "--wait", "--pipe", "--collect", "--service-type=exec", `--unit=vibe64-nnp-${id}-${name}`,
      "--property=KillMode=control-group", ...prefix, "/bin/sh", path.join(dir, "command.sh"), dir, escape,
      String(os.userInfo().uid)
    ], { encoding: "utf8", timeout: 60_000 });
    assert.equal(job.status, 0, `${job.stdout}${job.stderr}`);
    const escaped = spawnSync("systemctl", ["show", "--property=ActiveState", "--value", escape], { encoding: "utf8" });
    return { output: job.stdout, escapeState: escaped.stdout.trim() };
  }

  const before = agentCommand("before", []);
  assert.match(before.output, /^NoNewPrivs:\s+0\nreached\n$/u, "without the prefix, a command reaches root through sudo");
  assert.equal(before.escapeState, "active", "and its unit runs on after the command's own job ended");

  const now = agentCommand("now", NO_NEW_PRIVILEGES_COMMAND);
  assert.match(now.output, /^NoNewPrivs:\s+1\nrefused\n$/u, "the runner's prefix leaves sudo powerless");
  assert.notEqual(now.escapeState, "active", "no unit outside the job was started");
});
