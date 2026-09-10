import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  managedWorkflowCounters,
  managedWorkflowIdentity
} from "../../packages/vibe64-execution/src/host/execHelper.js";
import {
  finishVibe64Workflow, installVibe64ManagedExecutionProvider,
  setVibe64WorkflowPhase, startVibe64Workflow
} from "../../packages/vibe64-execution/src/server/managedExecution.js";
import { normalizeExecutionDescriptor } from "../../packages/vibe64-execution/src/server/request.js";

const MIB = 1024 * 1024;
const HELPER = new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url).pathname;
const owner = { username: "v64d_test" };

function workflowInput() {
  return { id: randomUUID(), projectKey: "a".repeat(64), sessionKey: "b".repeat(64) };
}

test("workflow unit identities are derived beneath the authenticated workspace, never caller paths", () => {
  const input = workflowInput();
  const workflow = managedWorkflowIdentity({ ...input, unitName: "system.slice", workspace: "foreign" }, owner);
  assert.equal(workflow.workspace, "test");
  assert.equal(workflow.projectUnit, `vibe64-test-work-p${input.projectKey}.slice`);
  assert.equal(workflow.sessionUnit, `vibe64-test-work-p${input.projectKey}-s${input.sessionKey}.slice`);
  assert.equal(workflow.unitName, `vibe64-test-work-p${input.projectKey}-s${input.sessionKey}-w${input.id.replaceAll("-", "")}.slice`);
  assert.ok(managedWorkflowIdentity(input, { username: `v64d_a${"b".repeat(61)}` }).unitName.length < 256);
});

test("invalid workflow keys, UUIDs and non-workspace owners cannot select systemd units", () => {
  for (const changed of [
    { id: "../../root" }, { projectKey: "a" }, { projectKey: "a".repeat(63) + "/" },
    { sessionKey: "0".repeat(65) }, { sessionKey: "system.slice" }, { sessionKey: null }
  ]) assert.throws(() => managedWorkflowIdentity({ ...workflowInput(), ...changed }, owner));
  assert.throws(() => managedWorkflowIdentity(workflowInput(), { username: "root" }));
});

test("workflow counters distinguish lifetime peaks, quality and descendant emptiness", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-workflow-counters-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries({
    "memory.current": "512\n", "memory.peak": "2048\n", "memory.swap.current": "128\n",
    "memory.stat": "anon 256\nfile 128\nkernel 128\npswpin 2\npswpout 3\n", "pids.current": "3\n",
    "memory.pressure": "some avg10=0.00 avg60=0.00 avg300=0.00 total=12345\n",
    "memory.events": "low 0\nhigh 4\nmax 5\noom 2\noom_kill 1\n",
    "cgroup.events": "populated 1\nfrozen 0\n", "cgroup.procs": ""
  })) await writeFile(path.join(root, name), text);
  const counters = managedWorkflowCounters(root);
  assert.equal(counters.scopeEmpty, false, "an empty parent cgroup.procs does not prove descendants empty");
  assert.equal(counters.memoryPeakBytes, 2048);
  assert.equal(counters.memoryCurrentBytes, 512);
  assert.equal(counters.memorySwapCurrentBytes, 128);
  assert.equal(counters.peakScope, "workflow-lifetime");
  assert.equal(counters.oomCount, 2);
  assert.equal(counters.oomKillCount, 1);
  assert.equal(counters.limitHitCount, 5);
  assert.equal(counters.reclaimCount, 4);
  assert.equal(counters.memoryAnonBytes, 256);
  assert.equal(counters.memoryFileBytes, 128);
  assert.equal(counters.memoryKernelBytes, 128);
  assert.equal(counters.swapInPages, 2);
  assert.equal(counters.swapOutPages, 3);
  assert.equal(counters.memoryPressureSomeTotalUsec, 12345);
  assert.ok(Number.isSafeInteger(counters.sampledMonotonicMs));
  assert.equal(counters.tasksCurrent, 3);
  await writeFile(path.join(root, "cgroup.events"), "populated 0\n");
  assert.equal(managedWorkflowCounters(root).scopeEmpty, true);
});

test("missing, malformed and unsupported counters remain unknown, not reassuring zeroes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-workflow-unknown-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "memory.current"), "max\n");
  await writeFile(path.join(root, "memory.events"), "oom banana\n");
  const counters = managedWorkflowCounters(root);
  for (const field of ["memoryCurrentBytes", "memoryPeakBytes", "oomCount", "oomKillCount", "scopeEmpty", "tasksCurrent", "swapInPages", "swapOutPages", "memoryPressureSomeTotalUsec"]) {
    assert.equal(counters[field], null);
  }
  assert.equal(managedWorkflowCounters("").memoryPeakBytes, null);
});

test("the helper still rejects a non-normalized CLI request", () => {
  const response = spawnSync(process.execPath, [HELPER, "execute"], { input: "{}\n", encoding: "utf8" });
  assert.equal(response.status, 2);
  assert.match(response.stderr, /non-normalized/u);
});

test("execution metadata carries only a valid workflow id, not caller-selected systemd policy", () => {
  const workflowId = randomUUID();
  const descriptor = normalizeExecutionDescriptor({ workflowId, workflow: { unitName: "system.slice" } }, { mode: "capture" });
  assert.equal(descriptor.workflowId, workflowId);
  assert.equal(descriptor.workflow, undefined);
  for (const invalid of [0, 12, false, {}, "../group", "not-a-uuid"]) {
    assert.throws(() => normalizeExecutionDescriptor({ workflowId: invalid }, { mode: "capture" }), /workflow id/u);
  }
});

test("workflow lifecycle delegates to the same installed execution owner", async (t) => {
  const calls = [];
  const id = randomUUID();
  const release = installVibe64ManagedExecutionProvider({
    runCommand() {}, stopExecution() {},
    startWorkflow(input) { calls.push(["start", input]); return { ok: true, workflow: { id } }; },
    setWorkflowPhase(...args) { calls.push(["phase", ...args]); },
    finishWorkflow(...args) { calls.push(["finish", ...args]); return { ok: true }; }
  });
  t.after(release);
  const input = { projectSlug: "example", sessionId: "session", operation: { kind: "output", targetId: "app" } };
  assert.equal((await startVibe64Workflow(input)).workflow.id, id);
  await setVibe64WorkflowPhase(id, "running");
  await finishVibe64Workflow(id, { outcome: "stopped" });
  assert.deepEqual(calls, [["start", input], ["phase", id, "running"], ["finish", id, { outcome: "stopped" }]]);
});

test("an installed provider without workflow support cannot silently bypass accounting", async (t) => {
  const release = installVibe64ManagedExecutionProvider({ runCommand() {}, stopExecution() {} });
  t.after(release);
  await assert.rejects(startVibe64Workflow({}), /does not support workflows/u);
  await assert.rejects(setVibe64WorkflowPhase(randomUUID(), "running"), /unavailable/u);
  await assert.rejects(finishVibe64Workflow(randomUUID()), /unavailable/u);
});

test("standalone execution remains usable but required hosted accounting fails closed", async (t) => {
  const previous = process.env.VIBE64_MANAGED_EXECUTION_REQUIRED;
  t.after(() => {
    if (previous === undefined) delete process.env.VIBE64_MANAGED_EXECUTION_REQUIRED;
    else process.env.VIBE64_MANAGED_EXECUTION_REQUIRED = previous;
  });
  delete process.env.VIBE64_MANAGED_EXECUTION_REQUIRED;
  assert.deepEqual(await startVibe64Workflow({}), { ok: true, workflow: null });
  await setVibe64WorkflowPhase(null, "running");
  await finishVibe64Workflow(null);
  process.env.VIBE64_MANAGED_EXECUTION_REQUIRED = "1";
  await assert.rejects(startVibe64Workflow({}), /unavailable/u);
});

const hostOwner = process.env.VIBE64_WORKFLOW_TEST_OWNER;
test("real helper retains simultaneous workflow peak and refuses to finish populated descendants", {
  skip: !hostOwner && "Set VIBE64_WORKFLOW_TEST_OWNER for the bounded local systemd proof."
}, async (t) => {
  assert.match(hostOwner, /^v64d_[a-z][a-z0-9-]+$/u);
  const unique = randomUUID();
  const input = {
    id: unique,
    projectKey: createHash("sha256").update(`workflow-test-project-${unique}`).digest("hex"),
    sessionKey: createHash("sha256").update(`workflow-test-session-${unique}`).digest("hex")
  };
  const identity = managedWorkflowIdentity(input, { username: hostOwner });
  const executionIds = [randomUUID(), randomUUID()];
  const units = executionIds.map((id) => `vibe64-exec-${identity.workspace}-${id.replaceAll("-", "")}.service`);
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-workflow-host-proof-"));
  const ready = units.map((_, index) => path.join(root, `${index}.ready`));
  const release = path.join(root, "release");
  function helper(action, extra = {}, commandPath = "") {
    const response = spawnSync("sudo", ["-n", "env", `SUDO_USER=${hostOwner}`,
      ...(commandPath ? [`PATH=${commandPath}:${process.env.PATH}`] : []), process.execPath, HELPER, "execute"], {
      input: JSON.stringify({
        schema: "vibe64.exec-helper.payload", schemaVersion: 1,
        operation: "managed-execution", action, workflow: input, ...extra
      }), encoding: "utf8", timeout: 30_000
    });
    assert.ok(response.stdout?.trim(), response.stderr || response.error?.message);
    return { ...JSON.parse(response.stdout), exitCode: response.status };
  }
  t.after(async () => {
    for (const unit of units) spawnSync("sudo", ["-n", "systemctl", "stop", unit]);
    // Exact test-only UUID-derived groups; never stop the workspace work slice.
    spawnSync("sudo", ["-n", "systemctl", "stop", identity.unitName, identity.sessionUnit, identity.projectUnit]);
    try { helper("workflow-finish"); helper("workflow-forget"); } catch { /* Failed proofs keep any receipt for diagnosis. */ }
    for (const unit of units) spawnSync("sudo", ["-n", "systemctl", "reset-failed", unit]);
    await rm(root, { recursive: true, force: true });
  });
  const created = helper("workflow-create", { memoryMaxBytes: 768 * MIB, tasksMax: 64 });
  assert.equal(created.ok, true);
  assert.equal(created.memoryMaxBytes, 768 * MIB);
  assert.equal(created.scopeEmpty, true);
  assert.equal(helper("workflow-create", { memoryMaxBytes: 768 * MIB, tasksMax: 64 }).ok, true);
  const script = `
    const fs = require('node:fs');
    const memory = Buffer.alloc(96 * 1024 * 1024, 1);
    fs.writeFileSync(process.argv[1], 'ready');
    const timer = setInterval(() => {
      if (fs.existsSync(process.argv[2])) {
        if (memory[0] !== 1) process.exitCode = 1;
        clearInterval(timer);
      }
    }, 25);
    setTimeout(() => { clearInterval(timer); }, 60000).unref();
  `;
  const children = units.map((unit, index) => {
    const child = spawn("sudo", ["-n", "systemd-run", "--quiet", "--wait", "--pipe", `--unit=${unit}`,
      `--slice=${identity.unitName}`, "--property=MemoryMax=268435456", "--property=RuntimeMaxSec=65",
      process.execPath, "-e", script, ready[index], release], { stdio: ["ignore", "pipe", "pipe"] });
    let errorText = "";
    child.stderr.on("data", (data) => { errorText += data; });
    child.stdout.resume();
    return new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(errorText || `Child exited ${code}`)));
    });
  });
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if ((await Promise.all(ready.map((file) => readFile(file, "utf8").catch(() => "")))).every(Boolean)) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.deepEqual(await Promise.all(ready.map((file) => readFile(file, "utf8"))), ["ready", "ready"]);
  const active = helper("workflow-inspect");
  assert.equal(active.scopeEmpty, false);
  assert.ok(active.memoryCurrentBytes >= 192 * MIB);
  function growth(memoryMaxBytes, expectedMemoryMaxBytes, executions = []) {
    return { memoryMaxBytes: memoryMaxBytes * MIB, expectedMemoryMaxBytes: expectedMemoryMaxBytes * MIB,
      executions: executions.map(([index, before, after]) => ({
        id: executionIds[index], expectedMemoryMaxBytes: before * MIB, memoryMaxBytes: after * MIB
      })) };
  }
  function unitValue(unit, property) {
    const result = spawnSync("systemctl", ["show", unit, `--property=${property}`, "--value"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  const pids = units.map((unit) => unitValue(unit, "MainPID"));
  const taskLimits = units.map((unit) => unitValue(unit, "TasksMax"));
  await t.test("live growth raises the parent and requested child without restarting or changing sibling/task limits", () => {
    const changed = helper("workflow-grow", growth(896, 768, [[0, 256, 384]]));
    assert.equal(changed.ok, true, changed.error);
    assert.equal(changed.changeState, "applied");
    assert.deepEqual(changed.before.map((item) => item.memoryMaxBytes), [768 * MIB, 256 * MIB]);
    assert.deepEqual(changed.after.map((item) => item.memoryMaxBytes), [896 * MIB, 384 * MIB]);
    assert.ok(changed.ancestors.some((item) => item.controlGroup.endsWith(`/vibe64-${identity.workspace}-work.slice`)));
    assert.equal(Number(unitValue(units[1], "MemoryMax")), 256 * MIB);
    assert.deepEqual(units.map((unit) => unitValue(unit, "MainPID")), pids);
    assert.deepEqual(units.map((unit) => unitValue(unit, "TasksMax")), taskLimits);
    assert.equal(helper("workflow-grow", growth(896, 896, [[0, 384, 384]])).changeState, "unchanged");
  });
  await t.test("all stale, decreasing, duplicate and foreign targets are rejected before any write", () => {
    const foreign = { id: randomUUID(), expectedMemoryMaxBytes: 256 * MIB, memoryMaxBytes: 384 * MIB };
    for (const request of [
      growth(768, 896), growth(1024, 768), growth(1024, 896, [[0, 384, 256]]),
      growth(1024, 896, [[0, 256, 512]]), growth(1024, 896, [[0, 384, 512], [0, 384, 512]]),
      { ...growth(1024, 896), executions: null },
      { ...growth(1024, 896), executions: Array.from({ length: 129 }, () => foreign) },
      { ...growth(1024, 896, [[0, 384, 512]]), executions: [...growth(1024, 896, [[0, 384, 512]]).executions, foreign] },
      { ...growth(1024, 896), executions: [{ ...foreign, id: "../../system.slice" }] }
    ]) {
      const refused = helper("workflow-grow", request);
      assert.equal(refused.ok, false);
      assert.equal(refused.changeState, "unchanged", refused.error);
      assert.equal(helper("workflow-inspect").memoryMaxBytes, 896 * MIB);
      assert.equal(Number(unitValue(units[0], "MemoryMax")), 384 * MIB);
    }
  });
  await t.test("an explicit child throttle is preserved instead of silently bypassed", () => {
    assert.equal(spawnSync("sudo", ["-n", "systemctl", "set-property", "--runtime", units[0], "MemoryHigh=402653184"]).status, 0);
    try {
      const refused = helper("workflow-grow", growth(1024, 896, [[0, 384, 512]]));
      assert.equal(refused.ok, false);
      assert.equal(refused.changeState, "unchanged");
      assert.match(refused.error, /target's memory.high/u);
      assert.equal(refused.limitingGroup.maximumBytes, 384 * MIB);
      assert.equal(refused.limitingGroup.requestedBytes, 512 * MIB);
      assert.ok(refused.limitingGroup.controlGroup.endsWith(`/${units[0]}`));
      assert.equal(helper("workflow-inspect").memoryMaxBytes, 896 * MIB);
      assert.equal(Number(unitValue(units[0], "MemoryHigh")), 384 * MIB);
      const readback = helper("workflow-limits", growth(1024, 896, [[0, 384, 512]]));
      assert.equal(readback.ok, true, readback.error);
      assert.deepEqual(readback.after.map((limit) => limit.memoryMaxBytes), [896 * MIB, 384 * MIB],
        "reading limits does not request growth or override a deliberate throttle");
    } finally {
      assert.equal(spawnSync("sudo", ["-n", "systemctl", "set-property", "--runtime", units[0], "MemoryHigh=infinity"]).status, 0);
    }
  });
  await t.test("a finite project ancestor blocks growth without changing the workspace or any child", () => {
    const result = spawnSync("sudo", ["-n", "systemctl", "set-property", "--runtime", identity.projectUnit, "MemoryMax=939524096"]);
    assert.equal(result.status, 0);
    try {
      const refused = helper("workflow-grow", growth(1024, 896, [[0, 384, 512]]));
      assert.equal(refused.changeState, "unchanged");
      assert.match(refused.error, /ancestor memory.max/u);
      assert.equal(refused.limitingGroup.maximumBytes, 896 * MIB);
      assert.equal(refused.limitingGroup.requestedBytes, 1024 * MIB);
      assert.ok(refused.limitingGroup.controlGroup.endsWith(`/${identity.projectUnit}`));
      assert.equal(helper("workflow-inspect").memoryMaxBytes, 896 * MIB);
    } finally {
      assert.equal(spawnSync("sudo", ["-n", "systemctl", "set-property", "--runtime", identity.projectUnit, "MemoryMax=infinity"]).status, 0);
    }
  });
  await t.test("an existing execution from a different workflow is not an eligible growth target", () => {
    const other = { ...input, id: randomUUID() };
    const created = helper("workflow-create", { workflow: other, memoryMaxBytes: 768 * MIB, tasksMax: 64 });
    assert.equal(created.ok, true);
    try {
      const refused = helper("workflow-grow", { ...growth(896, 768, [[0, 384, 512]]), workflow: other });
      assert.equal(refused.ok, false);
      assert.equal(refused.changeState, "unchanged");
      assert.match(refused.error, /same active, owned accounting group/u);
      assert.equal(helper("workflow-inspect", { workflow: other }).memoryMaxBytes, 768 * MIB);
      assert.equal(Number(unitValue(units[0], "MemoryMax")), 384 * MIB);
    } finally {
      assert.equal(helper("workflow-finish", { workflow: other }).ok, true);
      assert.equal(helper("workflow-forget", { workflow: other }).ok, true);
    }
  });
  await t.test("a failed child write reports the partial parent increase and never shrinks it back", async () => {
    await writeFile(path.join(root, "systemctl"), `#!/bin/sh
if [ "$1" = "set-property" ] && [ "$3" = "${units[0]}" ]; then
  echo 'Injected child-limit failure' >&2
  exit 42
fi
exec /usr/bin/systemctl "$@"
`, { mode: 0o700 });
    const failed = helper("workflow-grow", growth(1024, 896, [[0, 384, 512]]), root);
    assert.equal(failed.ok, false);
    assert.equal(failed.changeState, "partial");
    assert.match(failed.error, /Injected child-limit failure/u);
    assert.deepEqual(failed.after.map((item) => item.memoryMaxBytes), [1024 * MIB, 384 * MIB]);
    assert.equal(helper("workflow-inspect").memoryMaxBytes, 1024 * MIB);
    assert.deepEqual(units.map((unit) => unitValue(unit, "MainPID")), pids);
    const completed = helper("workflow-grow", growth(1024, 1024, [[0, 384, 512]]));
    assert.equal(completed.ok, true, completed.error);
    assert.equal(completed.after[1].memoryMaxBytes, 512 * MIB);
  });
  await t.test("a failed first write proves unchanged limits; failed readback remains unknown", async () => {
    await writeFile(path.join(root, "systemctl"), `#!/bin/sh
if [ "$1" = "set-property" ]; then exit 42; fi
exec /usr/bin/systemctl "$@"
`, { mode: 0o700 });
    const unchanged = helper("workflow-grow", growth(1152, 1024, [[0, 512, 640]]), root);
    assert.equal(unchanged.ok, false);
    assert.equal(unchanged.changeState, "unchanged");
    assert.deepEqual(unchanged.after, unchanged.before);
    const marker = path.join(root, "partial-limit-write");
    await writeFile(path.join(root, "systemctl"), `#!/bin/sh
if [ "$1" = "set-property" ] && [ "$3" = "${units[0]}" ]; then
  : > '${marker}'
  exit 42
fi
if [ "$1" = "show" ] && [ "$2" = "${units[0]}" ] && [ -e '${marker}' ]; then exit 42; fi
exec /usr/bin/systemctl "$@"
`, { mode: 0o700 });
    const unknown = helper("workflow-grow", growth(1152, 1024, [[0, 512, 640]]), root);
    assert.equal(unknown.ok, false);
    assert.equal(unknown.changeState, "unknown");
    assert.equal(unknown.after[0].memoryMaxBytes, 1152 * MIB);
    assert.equal(unknown.after[1], null);
    const readback = helper("workflow-limits", growth(1152, 1024, [[0, 512, 640]]));
    assert.equal(readback.ok, true, readback.error);
    assert.deepEqual(readback.after.map((limit) => limit.memoryMaxBytes), [1152 * MIB, 512 * MIB],
      "pending recovery reads current limits without applying the unfinished child change");
    const completed = helper("workflow-grow", growth(1152, 1152, [[0, 512, 640]]));
    assert.equal(completed.ok, true, completed.error);
    assert.deepEqual(units.map((unit) => unitValue(unit, "MainPID")), pids);
  });
  await t.test("non-page-aligned growth stays within the byte budget and reports exact kernel limits", () => {
    const request = growth(1280, 1152, [[0, 640, 768]]);
    request.memoryMaxBytes += 1;
    request.executions[0].memoryMaxBytes += 1;
    const changed = helper("workflow-grow", request);
    assert.equal(changed.ok, true, changed.error);
    assert.ok(changed.pageSizeBytes > 0);
    assert.equal(changed.after[0].effectiveMemoryMaxBytes, 1280 * MIB);
    assert.equal(changed.after[1].effectiveMemoryMaxBytes, 768 * MIB);
    assert.ok(changed.after[0].effectiveMemoryMaxBytes <= request.memoryMaxBytes);
    assert.deepEqual(units.map((unit) => unitValue(unit, "MainPID")), pids);
    const unaligned = 768 * MIB + 1;
    assert.equal(spawnSync("sudo", ["-n", "systemctl", "set-property", "--runtime", units[0], `MemoryMax=${unaligned}`]).status, 0);
    const next = growth(1408, 1280, [[0, 768, 896]]);
    next.executions[0].expectedMemoryMaxBytes = unaligned;
    const normalized = helper("workflow-grow", next);
    assert.equal(normalized.ok, true, normalized.error);
    assert.equal(normalized.before[1].memoryMaxBytes, unaligned);
    assert.equal(normalized.before[1].effectiveMemoryMaxBytes, Math.floor(unaligned / normalized.pageSizeBytes) * normalized.pageSizeBytes);
    assert.equal(normalized.after[1].effectiveMemoryMaxBytes, 896 * MIB);
  });
  const refused = helper("workflow-finish");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "workflow_not_empty");
  await writeFile(release, "done");
  await Promise.all(children);
  const finished = helper("workflow-finish");
  assert.equal(finished.ok, true);
  assert.equal(finished.scopeEmpty, true);
  assert.ok(finished.memoryPeakBytes >= 192 * MIB, "kernel retained both children's simultaneous peak");
  assert.equal(helper("workflow-inspect").memoryPeakBytes, finished.memoryPeakBytes);
  assert.equal(helper("workflow-finish").finishedAt, finished.finishedAt, "lost acknowledgements are idempotent");
  await writeFile(path.join(root, "systemctl"), `#!/bin/sh
if [ "$1" = "stop" ]; then
  echo 'Unit not loaded' >&2
  exit 5
fi
exec /usr/bin/systemctl "$@"
`, { mode: 0o700 });
  assert.equal(helper("workflow-finish", {}, root).finishedAt, finished.finishedAt,
    "a failed repeated stop does not discard proven inactive state and its final receipt");
  assert.equal(helper("workflow-forget").ok, true);
});
