import assert from "node:assert/strict";
import { test } from "node:test";

import {
  configureManagedExecutionWorkSlice,
  managedExecutionSliceCgroup,
  managedExecutionTargetUser
} from "../../packages/vibe64-execution/src/host/execHelper.js";

// v64-mercmobily's work slice on 2026-10-29: every execution's payload asked
// for these limits, and the slice's cgroup already enforced them.
const MEMORY_MAX = 18369105920;
const TASKS_MAX = 2048;
const owner = { gid: 1001, home: "/home/v64d_test", uid: 1001, username: "v64d_test" };
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
