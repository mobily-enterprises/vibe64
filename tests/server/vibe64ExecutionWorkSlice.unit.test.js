import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DAEMON_USERNAME_PREFIX,
  configureManagedExecutionWorkSlice,
  ensureWorkspaceRuntimeBase,
  managedExecutionSliceCgroup,
  managedExecutionTargetUser
} from "../../packages/vibe64-execution/src/host/execHelper.js";

// v64-mercmobily's work slice on 2026-10-29: every execution's payload asked
// for these limits, and the slice's cgroup already enforced them.
const MEMORY_MAX = 18369105920;
const TASKS_MAX = 2048;
// The workspace daemon account the helper serves, as the helper names it.
const DAEMON = `${DAEMON_USERNAME_PREFIX}test`;
const owner = { gid: 1001, home: `/home/${DAEMON}`, uid: 1001, username: DAEMON };
const sliceGroup = "/sys/fs/cgroup/vibe64.slice/vibe64-test.slice/vibe64-test-work.slice";

function slice(files = {}) {
  const values = {
    [`${sliceGroup}/cgroup.controllers`]: "cpuset cpu io memory hugetlb pids rdma misc\n",
    [`${sliceGroup}/memory.max`]: `${MEMORY_MAX}\n`,
    [`${sliceGroup}/pids.max`]: `${TASKS_MAX}\n`,
    ...files
  };
  const commands = [];
  return {
    commands,
    deps: {
      read(file) {
        if (typeof values[file] !== "string") {
          throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
        }
        return values[file];
      },
      run(command, args) {
        commands.push([command, ...args].join(" "));
        return "";
      },
      runAllowFailure(command, args) {
        commands.push([command, ...args].join(" "));
        return { status: 0 };
      }
    }
  };
}

const configured = (host, limits = {}) => configureManagedExecutionWorkSlice(owner, {
  memoryMaxBytes: MEMORY_MAX,
  tasksMax: TASKS_MAX,
  ...limits
}, host.deps);

test("a work slice already enforcing the requested limits starts no systemctl", () => {
  const host = slice();
  configured(host);
  assert.deepEqual(host.commands, []);
  // The kernel keeps memory.max rounded down to a page.
  configured(host, { memoryMaxBytes: MEMORY_MAX + 4095 });
  assert.deepEqual(host.commands, []);
});

test("a missing, stopped or differently limited work slice is configured through systemd", () => {
  const setProperty = "systemctl set-property --runtime vibe64-test-work.slice " +
    `MemoryMax=${MEMORY_MAX} TasksMax=${TASKS_MAX} MemoryAccounting=yes IOAccounting=yes TasksAccounting=yes`;
  const expected = ["systemctl is-active --quiet vibe64-test-work.slice", setProperty];
  for (const files of [
    { [`${sliceGroup}/cgroup.controllers`]: undefined, [`${sliceGroup}/memory.max`]: undefined,
      [`${sliceGroup}/pids.max`]: undefined },
    { [`${sliceGroup}/memory.max`]: "max\n" },
    { [`${sliceGroup}/memory.max`]: `${MEMORY_MAX - 4096}\n` },
    { [`${sliceGroup}/memory.max`]: `${MEMORY_MAX + 4096}\n` },
    { [`${sliceGroup}/pids.max`]: "1024\n" },
    { [`${sliceGroup}/cgroup.controllers`]: "cpu memory pids\n" }
  ]) {
    const host = slice(files);
    configured(host);
    assert.deepEqual(host.commands, expected, JSON.stringify(files));
  }
  const host = slice({ [`${sliceGroup}/pids.max`]: "1024\n" });
  host.deps.runAllowFailure = (command, args) => {
    host.commands.push([command, ...args].join(" "));
    return { status: 3 };
  };
  configured(host);
  assert.deepEqual(host.commands, [expected[0], "systemctl start vibe64-test-work.slice", setProperty]);
});

test("a work slice's cgroup follows systemd's dash hierarchy for every workspace name", () => {
  assert.equal(managedExecutionSliceCgroup("vibe64-test-work.slice"), sliceGroup);
  assert.equal(managedExecutionSliceCgroup("vibe64-team-a2-work.slice"),
    "/sys/fs/cgroup/vibe64.slice/vibe64-team.slice/vibe64-team-a2.slice/vibe64-team-a2-work.slice");
});

test("an execution run as the workspace daemon reuses the daemon already resolved", () => {
  const lookups = [];
  const groupChecks = [];
  const target = managedExecutionTargetUser({ gid: owner.gid, uid: owner.uid, username: owner.username }, owner, {
    assertInGroup: (username, group) => groupChecks.push([username, group]),
    resolveUser: (username) => {
      lookups.push(username);
      return owner;
    }
  });
  assert.equal(target, owner);
  assert.deepEqual(lookups, []);
  assert.deepEqual(groupChecks, [[owner.username, "vibe64"]]);
  assert.throws(() => managedExecutionTargetUser({ uid: owner.uid + 1 }, owner, {
    assertInGroup() {},
    resolveUser: () => owner
  }), /uid/u);
});

test("creating an execution's receipt keeps the daemon's runtime directory with no process", async () => {
  const source = await readFile(new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url), "utf8");
  const opening = source.slice(source.indexOf("function openWorkspaceExecutionReceipts"),
    source.indexOf("const NO_EXECUTION_RECEIPTS"));
  assert.doesNotMatch(opening, /runRootCommand|spawnSync|ensureGroup/u);
  // The managed execution start reads the shared group once and passes it on.
  const start = source.slice(source.indexOf("function handleManagedExecutionOperation"),
    source.indexOf("function consumeManagedExecutionRequestPayload"));
  assert.equal(start.match(/ensureGroup\(VIBE64_GROUP\)/gu)?.length, 1);
  assert.match(start, /openWorkspaceExecutionReceipts\(owner, \{ create: true, gid: groupId \}\)/u);
});

test("the daemon's runtime directory is made or kept its own, mode 2750, never through a link", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-runtime-base-"));
  try {
    const identity = { gid: process.getgid(), uid: process.getuid() };
    const base = path.join(root, "vibe64-test");
    ensureWorkspaceRuntimeBase(base, identity);
    let stats = await stat(base);
    assert.equal(stats.isDirectory(), true);
    assert.equal(stats.mode & 0o7777, 0o2750);
    assert.deepEqual([stats.uid, stats.gid], [identity.uid, identity.gid]);
    await chmod(base, 0o700);
    ensureWorkspaceRuntimeBase(base, identity);
    stats = await stat(base);
    assert.equal(stats.mode & 0o7777, 0o2750);
    const elsewhere = path.join(root, "elsewhere");
    await mkdir(elsewhere, { mode: 0o700 });
    await symlink(elsewhere, path.join(root, "linked"));
    assert.throws(() => ensureWorkspaceRuntimeBase(path.join(root, "linked"), identity),
      (error) => ["ELOOP", "ENOTDIR"].includes(error.code));
    assert.equal((await stat(elsewhere)).mode & 0o7777, 0o700);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
