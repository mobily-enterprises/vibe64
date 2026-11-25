import assert from "node:assert/strict";
import test from "node:test";
import { drainRegisteredProcessGroup } from "../../packages/vibe64-terminals/src/server/agentPreviewBrowserWorker.js";
import { WORKER_STATE_SOURCE } from "../../packages/vibe64-execution/src/server/runtime/agentPreviewBrowserWorkerState.js";

const GROUP = { groupId: 4242, startTimeTicks: "777" };
const exact = { status: "exact", groupId: GROUP.groupId, startTimeTicks: GROUP.startTimeTicks, state: "S" };
const ambiguous = { status: "ambiguous", groupId: 0, startTimeTicks: "", state: "" };

// A registered browser group whose leader the server reads through `leader()`.
function registeredGroup(leader) {
  const signals = [];
  let waited = 0;
  return {
    signals,
    waited: () => waited,
    options: {
      readStart: async () => leader(),
      hasLiveMember: async () => true,
      signal: (groupId, name) => signals.push(`${name} ${groupId}`),
      wait: async (milliseconds) => { waited += milliseconds; }
    }
  };
}

// A leader whose /proc entry could not be read (hidepid, a failed read, a
// failed ps) says nothing about its group. The drain once read it as a group
// that had gone: it skipped SIGTERM and SIGKILL and reported the group empty.
test("a registered browser group whose leader cannot be read is never drained", async () => {
  const unknown = registeredGroup(() => ambiguous);
  assert.equal(await drainRegisteredProcessGroup(GROUP, unknown.options), false, "an unknown group is not proven empty");
  assert.deepEqual(unknown.signals, [], "a group it cannot identify is not signalled");
  assert.ok(unknown.waited() >= 3000, `it kept asking until its deadline (${unknown.waited()} ms)`);

  // An unreadable moment is asked again: once the leader reads, the group is
  // signalled and drained as usual.
  let reads = 0;
  let killed = false;
  const recovers = registeredGroup(() => (reads++ < 3 ? ambiguous : killed ? { ...ambiguous, status: "absent" } : exact));
  recovers.options.signal = (groupId, name) => {
    recovers.signals.push(`${name} ${groupId}`);
    if (name === "SIGTERM") killed = true;
  };
  assert.equal(await drainRegisteredProcessGroup(GROUP, recovers.options), true);
  assert.deepEqual(recovers.signals, ["SIGTERM 4242", "SIGCONT 4242"]);

  // A group that stays alive but becomes unreadable after SIGTERM is not
  // reported empty either.
  let term = false;
  const hides = registeredGroup(() => (term ? ambiguous : exact));
  hides.options.signal = (groupId, name) => {
    hides.signals.push(`${name} ${groupId}`);
    if (name === "SIGTERM") term = true;
  };
  assert.equal(await drainRegisteredProcessGroup(GROUP, hides.options), false);
});

test("a registered browser group whose leader has gone or is another process is already drained", async () => {
  for (const leader of [{ ...ambiguous, status: "absent" }, { ...exact, startTimeTicks: "778" }, { ...exact, groupId: 1 }]) {
    const gone = registeredGroup(() => leader);
    assert.equal(await drainRegisteredProcessGroup(GROUP, gone.options), true);
    assert.deepEqual(gone.signals, []);
    assert.equal(gone.waited(), 0);
  }
});

// The worker program's own group handling, run with a process table this test
// answers. Its text is a template the worker writes, so it is evaluated here.
// `leader(pid)` answers as runtime/processStart.js does: exact, absent or ambiguous.
function workerGroups({ platform = "linux", leader, table, kill }) {
  const from = (start, end) => WORKER_STATE_SOURCE.slice(
    WORKER_STATE_SOURCE.indexOf(start),
    WORKER_STATE_SOURCE.indexOf(end)
  );
  const body = [
    "let browserProcessGroups = deps.groups;",
    "const { processIdentity, leaderIdentity, processTable, writeWorkerMetadata } = deps;",
    "const process = deps.process;",
    "const setTimeout = (resolve) => { deps.waited.push(50); resolve(); };",
    from("function processGroupAlive(", "function metadataSignature("),
    from("function trackedProcessGroup", "function statusPayload("),
    "return { terminateBrowserProcessGroups, groups: () => browserProcessGroups };"
  ].join("\n");
  const waited = [];
  const signals = [];
  const metadata = [];
  const worker = new Function("deps", body)({
    groups: [{ ...GROUP }],
    waited,
    process: {
      platform,
      pid: 1000,
      kill: (pid, signal) => {
        signals.push(`${signal} ${pid}`);
        kill?.(pid, signal);
      }
    },
    processIdentity: (pid) => {
      const { status, ...identity } = leader(pid);
      return status === "exact" ? identity : null;
    },
    leaderIdentity: leader,
    processTable: table,
    writeWorkerMetadata: async () => { metadata.push(worker.groups()); return true; }
  });
  return { metadata, signals, waited, worker };
}

// The worker ends its browser's groups when it closes the browser, then
// records which remain in its metadata, which the server drains on Stop. A
// leader or process table it could not read once counted as a group that had
// gone: the worker skipped the kill and dropped the group from its metadata,
// so nothing ever checked it again.
test("the browser worker keeps a group it could not prove gone registered for the server to drain", async () => {
  const unreadable = workerGroups({ leader: () => ({ status: "ambiguous" }), table: () => null });
  await unreadable.worker.terminateBrowserProcessGroups();
  assert.deepEqual(unreadable.worker.groups(), [GROUP], "an unproven group stays registered");
  assert.deepEqual(unreadable.metadata.at(-1), [GROUP]);
  assert.deepEqual(unreadable.signals.filter((entry) => !entry.startsWith("0 ")), [], "an unidentified group is not signalled");

  // macOS reads the whole table through ps: a failed ps proves nothing either.
  const noPs = workerGroups({ platform: "darwin", leader: () => ({ status: "ambiguous" }), table: () => null });
  await noPs.worker.terminateBrowserProcessGroups();
  assert.deepEqual(noPs.worker.groups(), [GROUP]);

  // The kernel's answer for the group, the fallback when the table cannot be
  // read, counts EPERM (a group this user cannot signal) as present.
  const denied = workerGroups({
    leader: (pid) => ({ status: "exact", groupId: pid, parentId: 1, startTimeTicks: GROUP.startTimeTicks, state: "S" }),
    table: () => null,
    kill: (pid, signal) => {
      if (signal === 0) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    }
  });
  await denied.worker.terminateBrowserProcessGroups();
  assert.ok(denied.signals.includes("SIGTERM -4242"), "a present group is signalled");
  assert.deepEqual(denied.worker.groups(), [GROUP], "a group still present is not dropped");
});

test("the browser worker drops a group once it is proven gone", async () => {
  let alive = true;
  const ends = workerGroups({
    leader: (pid) => (alive
      ? { status: "exact", groupId: pid, parentId: 1, startTimeTicks: GROUP.startTimeTicks, state: "S" }
      : { status: "absent" }),
    table: () => (alive ? [{ pid: GROUP.groupId, groupId: GROUP.groupId, parentId: 1, startTimeTicks: "777", state: "S" }] : []),
    kill: (pid, signal) => {
      if (signal === "SIGTERM") alive = false;
      if (signal === 0 && !alive) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    }
  });
  await ends.worker.terminateBrowserProcessGroups();
  assert.ok(ends.signals.includes("SIGTERM -4242"));
  assert.ok(!ends.signals.includes("SIGKILL -4242"));
  assert.deepEqual(ends.worker.groups(), []);
  assert.deepEqual(ends.metadata.at(-1), []);
});
