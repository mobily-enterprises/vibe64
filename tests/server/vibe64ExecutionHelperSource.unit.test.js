import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { managedExecutionOomBoundary, managedExecutionTaskLimitCounters,
  managedExecutionTaskLimitJournal } from "../../packages/vibe64-execution/src/host/execHelper.js";

const HELPER_SOURCE_URL = new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url);

const oomUnit = `vibe64-exec-test-${"c".repeat(32)}.service`;
const oomWork = "/vibe64.slice/vibe64-test.slice/vibe64-test-work.slice";
const oomProject = `${oomWork}/vibe64-test-work-p${"a".repeat(64)}.slice`;
const oomSession = `${oomProject}/vibe64-test-work-p${"a".repeat(64)}-s${"b".repeat(64)}.slice`;
const oomWorkflow = `${oomSession}/vibe64-test-work-p${"a".repeat(64)}-s${"b".repeat(64)}-w${"d".repeat(32)}.slice`;
const oomExecution = `${oomWorkflow}/${oomUnit}`;
const oomQuery = { unitName: oomUnit, workspace: "test", startedAt: 1000, until: 3000 };

test("task denial counters prove only the boundary their mount semantics identify", () => {
  const mount = "37 28 0:31 / /sys/fs/cgroup rw - cgroup2 cgroup2 rw,nsdelegate";
  const values = { "/proc/self/mountinfo": mount,
    "/group/pids.events.local": "max 3\n", "/group/pids.events": "max 5\n" };
  const read = (name) => { if (!(name in values)) throw new Error("missing"); return values[name]; };
  assert.deepEqual(managedExecutionTaskLimitCounters("/group", read),
    { source: "cgroup-pids-events", scope: "execution", count: 3 });
  values["/proc/self/mountinfo"] += ",pids_localevents";
  assert.equal(managedExecutionTaskLimitCounters("/group", read).scope, "unknown");
  values["/proc/self/mountinfo"] = mount;
  values["/group/pids.events.local"] = "max 0\n";
  assert.deepEqual(managedExecutionTaskLimitCounters("/group", read),
    { source: "cgroup-pids-events", scope: "unknown", count: 5 });
  values["/group/pids.events"] = "max 0\n";
  assert.equal(managedExecutionTaskLimitCounters("/group", read), null);
  values["/group/pids.events"] = "max 9007199254740992\n";
  assert.equal(managedExecutionTaskLimitCounters("/group", read), null);
  assert.equal(managedExecutionTaskLimitCounters("/missing", read), null);
});

test("kernel fork-denial records identify the owned activity, never invent the binding ancestor or denial count", () => {
  const line = (group = oomExecution, time = "2000000") => JSON.stringify({ __REALTIME_TIMESTAMP: time,
    MESSAGE: `cgroup: fork rejected by pids controller in ${group}` });
  assert.deepEqual(managedExecutionTaskLimitJournal(line(), oomQuery), {
    source: "kernel-journal", scope: "unknown", count: null, recordedAt: "1970-01-01T00:00:02.000Z"
  });
  for (const text of [line(oomExecution.replace(oomUnit, `other-${oomUnit}`)),
    line(oomExecution.replaceAll("vibe64-test", "vibe64-foreign")), line(`${oomExecution}/..`),
    line(oomExecution, "999000"), line(oomExecution, "3001000"), line(oomExecution, "NaN"),
    "invalid", "", Array(65).fill(line()).join("\n"), "x".repeat(128 * 1024 + 1)
  ]) assert.equal(managedExecutionTaskLimitJournal(text, oomQuery), null);
});
function oomLine(group, { taskGroup = oomExecution, time = "2000000", constraint = "CONSTRAINT_MEMCG" } = {}) {
  return JSON.stringify({ __REALTIME_TIMESTAMP: time,
    MESSAGE: `oom-kill:constraint=${constraint},nodemask=(null),cpuset=/,mems_allowed=0,${group ? `oom_memcg=${group}` : "global_oom"},task_memcg=${taskGroup},task=node,pid=123,uid=1000` });
}

test("kernel OOM attribution distinguishes the exceeded group from the victim's group", () => {
  for (const [group, scope] of [
    [oomExecution, "execution"], [oomWorkflow, "workflow"], [oomSession, "session"],
    [oomProject, "project"], [oomWork, "workspace_work"], ["/vibe64.slice/vibe64-test.slice", "workspace"],
    ["/vibe64.slice", "platform"]
  ]) {
    assert.deepEqual(managedExecutionOomBoundary(oomLine(group), oomQuery), {
      source: "kernel-journal", scope, cgroup: group, recordedAt: "1970-01-01T00:00:02.000Z"
    });
  }
  assert.equal(managedExecutionOomBoundary(oomLine("", { constraint: "CONSTRAINT_NONE" }), oomQuery).scope, "host");
});

test("kernel OOM evidence excludes other executions, workspaces, times and placement constraints", () => {
  for (const line of [
    oomLine(oomWork, { taskGroup: oomExecution.replace(oomUnit, `other-${oomUnit}`) }),
    oomLine(oomWork, { taskGroup: oomExecution.replaceAll("vibe64-test", "vibe64-foreign") }),
    oomLine(oomWork, { time: "999000" }), oomLine(oomWork, { time: "3001000" }),
    oomLine(oomWork, { time: "NaN" }), oomLine(`${oomWork}/sibling.slice`),
    oomLine("", { constraint: "CONSTRAINT_CPUSET" }),
    oomLine("", { constraint: "CONSTRAINT_MEMORY_POLICY" }),
    JSON.stringify({ MESSAGE: "Killed process 123 (node)" }), "invalid", ""
  ]) assert.equal(managedExecutionOomBoundary(line, oomQuery), null, line);
});

test("conflicting or truncated kernel evidence stays unknown and repeated evidence is bounded", () => {
  assert.equal(managedExecutionOomBoundary([oomLine(oomWork), oomLine(oomExecution)].join("\n"), oomQuery), null);
  assert.equal(managedExecutionOomBoundary(Array(65).fill(oomLine(oomWork)).join("\n"), oomQuery), null);
  assert.equal(managedExecutionOomBoundary("x".repeat(128 * 1024 + 1), oomQuery), null);
  const result = managedExecutionOomBoundary([oomLine(oomWork, { time: "2100000" }), oomLine(oomWork)].join("\n"), oomQuery);
  assert.equal(result.recordedAt, "1970-01-01T00:00:02.100Z");
  assert.deepEqual(Object.keys(result).sort(), ["cgroup", "recordedAt", "scope", "source"]);
});

test("long kernel OOM records require an adjacent same-boot continuation, not timestamp proximity alone", () => {
  const full = JSON.parse(oomLine(oomWorkflow));
  const [prefix, suffix] = full.MESSAGE.split(",task_memcg=");
  const first = { ...full, MESSAGE: `${prefix},task_memcg=`, __SEQNUM_ID: "1".repeat(32),
    _BOOT_ID: "2".repeat(32), __SEQNUM: "17", _SOURCE_MONOTONIC_TIMESTAMP: "1000" };
  const second = { ...first, MESSAGE: suffix, __SEQNUM: "18", _SOURCE_MONOTONIC_TIMESTAMP: "1020" };
  const text = (next) => [next, first].map((entry) => JSON.stringify(entry)).join("\n");
  assert.equal(managedExecutionOomBoundary(text(second), oomQuery)?.scope, "workflow");
  for (const change of [{ __SEQNUM: "19" }, { __SEQNUM_ID: "3".repeat(32) }, { _BOOT_ID: "3".repeat(32) },
    { _SOURCE_MONOTONIC_TIMESTAMP: "900" }, { _SOURCE_MONOTONIC_TIMESTAMP: "1001001" },
    { MESSAGE: suffix.replace(oomUnit, "foreign.service") }, { MESSAGE: suffix.replace(/,task=.*/u, "") }
  ]) assert.equal(managedExecutionOomBoundary(text({ ...second, ...change }), oomQuery), null);
});

async function helperSource() {
  return readFile(HELPER_SOURCE_URL, "utf8");
}

test("execution helper waits for a delayed nonblocking stdin payload", async () => {
  const child = spawn(process.execPath, [
    new URL(HELPER_SOURCE_URL).pathname,
    "execute"
  ], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk || "");
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  child.stdin.end("{}\n");
  const exitCode = await new Promise((resolve) => child.once("close", resolve));

  assert.equal(exitCode, 2);
  assert.match(stderr, /rejected a non-normalized execution payload/u);
  assert.doesNotMatch(stderr, /EAGAIN|resource temporarily unavailable/u);
});

test("execution helper source is the real host helper, not the package stub", async () => {
  const source = await helperSource();

  assert.match(source, /const ALLOWED_OPERATIONS = new Set/u);
  assert.match(source, /"github-api-command"/u);
  assert.match(source, /"github-workflow-command"/u);
  assert.match(source, /"health-status"/u);
  assert.match(source, /"vibe64-command"/u);
  assert.doesNotMatch(source, /has not been installed from this source package/u);
});

test("execution helper preserves operation and command allowlists", async () => {
  const source = await helperSource();

  assert.match(source, /if \(!ALLOWED_OPERATIONS\.has\(operation\)\)/u);
  assert.match(source, /"account-status"/u);
  assert.match(source, /if \(!ALLOWED_COMMANDS\.has\(command\)\)/u);
  assert.match(source, /Vibe64 exec helper rejected an unknown operation/u);
  assert.match(source, /Vibe64 exec helper rejected an unknown command/u);
});

test("execution helper default PATH includes every first-class runtime pack", async () => {
  const source = await helperSource();

  assert.match(source, /\/opt\/vibe64\/runtime-packs\/operator-clis\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/node26\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/git\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/gh\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/mariadb\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/postgresql\/bin/u);
  assert.match(source, /PATH: DEFAULT_PATH/u);
});

test("execution helper gives release services the shared runtime PATH", async () => {
  const source = await helperSource();

  assert.match(source, /Environment=PATH=\$\{systemdUnitSafeValue\(DEFAULT_PATH\)\}/u);
  assert.match(source, /`ExecStart=\$\{systemdUnitSafeValue\(startScript\)\}`/u);
  assert.match(source, /StartLimitIntervalSec=60/u);
  assert.match(source, /StartLimitBurst=5/u);
  assert.match(source, /runRootCommandAllowFailure\("systemctl", \[\s*"reset-failed",\s*unitName/u);
});

test("execution helper gives daemon-owned services the shared primary group", async () => {
  const source = await helperSource();

  assert.match(source, /function serviceAccountUnitLines\(owner = \{\}\)/u);
  assert.equal(source.match(/\.\.\.serviceAccountUnitLines\(owner\)/gu)?.length, 2);
  assert.match(source, /`Group=\$\{VIBE64_GROUP\}`/u);
  assert.match(source, /"SupplementaryGroups=nix-users"/u);
  assert.match(source, /"UMask=0007"/u);
  assert.doesNotMatch(source, /`Group=\$\{systemdUnitSafeValue\(owner\.username\)\}`/u);
});

test("execution helper reports bounded release service diagnostics", async () => {
  const source = await helperSource();

  assert.match(source, /action === "inspect"/u);
  assert.match(source, /function inspectDeploymentServiceUnit/u);
  assert.match(source, /ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,NRestarts/u);
  assert.match(source, /runRootCommandAllowFailure\("journalctl"/u);
  assert.match(source, /"--lines=80"/u);
});

test("execution helper gives release services explicit managed-service dependencies", async () => {
  const source = await helperSource();

  assert.match(source, /assertValidManagedServiceUnitName\(requiredUnit, owner\)/u);
  assert.match(source, /`After=\$\{\["network-online\.target", \.\.\.dependencies\]\.join\(" "\)\}`/u);
  assert.match(source, /`Requires=\$\{dependencies\.join\(" "\)\}`/u);
});

test("execution helper manages provider-neutral simple and forking services", async () => {
  const source = await helperSource();

  assert.match(source, /"managed-service"/u);
  assert.match(source, /function handleManagedServiceOperation/u);
  assert.match(source, /function assertValidManagedServiceProcessModel/u);
  assert.match(source, /function installSystemdUnit/u);
  assert.match(source, /const workspace = workspaceFromDaemonUsername\(username\)/u);
  assert.match(source, /processModel !== "forking" && processModel !== "simple"/u);
  assert.match(source, /normalizedProcessModel === "forking" \? \[`PIDFile=/u);
  assert.match(source, /Restart=on-failure/u);
  assert.match(source, /function ensureManagedServiceProcessOwnership/u);
  assert.match(source, /processUid !== owner\.uid/u);
  assert.match(source, /processBelongsToSystemdUnit\(pid, unitName\)/u);
  assert.match(source, /runRootCommandAllowFailure\("systemctl", \[\s*"stop",\s*unitName/u);
  assert.doesNotMatch(source, /function handleMariaDb|function handlePostgres|function handleRedis/u);
});

test("execution helper rejects payloads that did not pass gateway normalization", async () => {
  const source = await helperSource();

  assert.match(source, /const EXEC_HELPER_PAYLOAD_SCHEMA = "vibe64\.exec-helper\.payload"/u);
  assert.match(source, /function assertNormalizedPayload/u);
  assert.match(source, /Vibe64 exec helper rejected a non-normalized execution payload/u);
});

test("execution helper lets account and GitHub API commands run from the target user home", async () => {
  const source = await helperSource();

  assert.match(source, /operation === "account-auth-terminal" \|\|\s+operation === "account-status" \|\|\s+operation === "github-api-command"/u);
  assert.match(source, /return resolveAllowedUserHomePath\(normalized, targetUser\)/u);
});

test("execution helper admits hosted project state only for the daemon's own generic commands", async () => {
  const source = await helperSource();

  assert.match(source, /operation === "vibe64-command" &&\s+targetUser\.username === ownerUsername/u);
  assert.match(source, /const ownerProjectStateRoot = path\.join\(\s+targetUser\.home,\s+"\.local",\s+"state",\s+"vibe64",\s+"projects"/u);
  assert.match(source, /resolved === ownerProjectStateRoot \|\|\s+resolved\.startsWith\(`\$\{ownerProjectStateRoot\}\$\{path\.sep\}`\)/u);
});

test("execution helper runs platform health checks from the workspace temp root", async () => {
  const source = await helperSource();

  assert.match(source, /operation === "health-status"/u);
  assert.match(source, /return workspaceTempRoot\(ownerUsername\)/u);
});

test("execution helper limits assistant services outside projects to their exact private workspaces", async () => {
  const source = await helperSource();

  assert.match(source, /"codex-app-server"/u);
  assert.match(source, /"opencode-app-server"/u);
  assert.match(source, /operation === "codex-app-server"/u);
  assert.match(source, /operation === "opencode-app-server"/u);
  assert.match(source, /const runtimeBases = \[managedExecutionRuntimeBase\(\{ username: ownerUsername \}\)\]/u);
  assert.match(source, /runtimeBases\.push\(path\.join\("\/run\/user", String\(targetUid\)\)\)/u);
  assert.match(source, /for \(const runtimeBase of runtimeBases\)/u);
  assert.match(source, /path\.join\(runtimeBase, "vibe64", "agent-providers"\)/u);
  assert.match(source, /providerRoot === "codex-app-server"/u);
  assert.match(source, /providerRoot === "opencode"/u);
  assert.match(source, /\^codex-app-server-\[a-f0-9\]\{12\}\$/u);
  assert.match(source, /operation === "codex-app-server" && parts\.length === 1/u);
  assert.match(source, /parts\.length === 2/u);
  assert.match(source, /parts\[1\] === "workspace"/u);
});

test("execution helper limits release service paths to deployment release state", async () => {
  const source = await helperSource();

  assert.match(source, /assertSafeDeploymentServicePath\(payload\.workingDirectory, owner, "workingDirectory"\)/u);
  assert.match(source, /function pathIsDeploymentReleasePath/u);
  assert.match(source, /parts\[1\] === "deployments"/u);
  assert.match(source, /parts\[2\] === "releases"/u);
  assert.match(source, /parts\[4\] === "artifact" \|\| parts\[4\] === "service"/u);
  assert.doesNotMatch(source, /resolveAllowedProjectPath\(candidatePath, ownerUsername\)/u);
});

test("execution helper uses runuser instead of direct initgroups setuid flow", async () => {
  const source = await helperSource();

  assert.match(source, /spawnSync\("runuser"/u);
  assert.doesNotMatch(source, /process\.initgroups/u);
  assert.doesNotMatch(source, /process\.setuid/u);
  assert.doesNotMatch(source, /process\.setgid/u);
});

test("execution helper creates collaborative files instead of repairing them later", async () => {
  const source = await helperSource();

  assert.match(source, /assertUserInGroup\(targetUser\.username, VIBE64_GROUP\)/u);
  assert.match(source, /process\.umask\(0o007\)/u);
  assert.doesNotMatch(source, /repair-managed-project-permissions/u);
  assert.doesNotMatch(source, /handleManagedProjectPermissionRepair/u);
});

test("execution helper centrally assigns the shared workspace TMPDIR", async () => {
  const source = await helperSource();

  assert.match(source, /const MANAGED_ROOT = "\/var\/lib\/vibe64"/u);
  assert.match(source, /helperChildEnv\(payload\.env \|\| \{\}, targetUser, owner\.username, operation\)/u);
  assert.match(source, /helperChildEnv\(payload\.env \|\| \{\}, targetUser, owner\.username, commandOperation\)/u);
  assert.match(source, /env\.TMPDIR = workspaceTempRoot\(ownerUsername\)/u);
  assert.equal(
    source.match(/Environment=TMPDIR=\$\{systemdUnitSafeValue\(workspaceTempRoot\(owner\.username\)\)\}/gu)?.length,
    2
  );
  assert.doesNotMatch(source, /actorTemp|FLOCK_PATH|mkdtemp/u);
});

test("execution helper preserves only OpenCode private environment roots", async () => {
  const source = await helperSource();

  assert.match(source, /operation === "opencode-app-server"/u);
  assert.match(source, /managedExecutionRuntimeBase\(\{ username: ownerUsername \}\)[\s\S]+"agent-providers",[\s\S]+"opencode"/u);
  for (const name of [
    "HOME",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME"
  ]) {
    assert.match(source, new RegExp(`"${name}"`, "u"));
  }
  assert.match(source, /!path\.isAbsolute\(requested\) \|\| relativePathParts\(providerRoot, requested\)\.length === 0/u);
  assert.match(source, /rejected OpenCode \$\{name\} outside its provider runtime/u);
});

test("managed executions can traverse their private workspace runtime directory", async () => {
  const source = await helperSource();

  assert.match(source, /ensureManagedExecutionRuntimeParents\(owner\)/u);
  assert.match(source, /function managedExecutionRuntimeBase\(owner = \{\}\)/u);
  assert.match(source, /runRootCommand\("install", \[/u);
  assert.match(source, /"2750",\s+runtimeBase,\s+path\.join\(runtimeBase, "executions"\)/u);
});
