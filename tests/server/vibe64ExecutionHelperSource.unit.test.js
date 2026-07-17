import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const HELPER_SOURCE_URL = new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url);

async function helperSource() {
  return readFile(HELPER_SOURCE_URL, "utf8");
}

test("execution helper source is the real host helper, not the package stub", async () => {
  const source = await helperSource();

  assert.match(source, /const ALLOWED_OPERATIONS = new Set/u);
  assert.match(source, /"github-api-command"/u);
  assert.match(source, /"github-workflow-command"/u);
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
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/node22\/bin/u);
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

test("execution helper centrally assigns the shared workspace TMPDIR", async () => {
  const source = await helperSource();

  assert.match(source, /const MANAGED_ROOT = "\/var\/lib\/vibe64"/u);
  assert.match(source, /helperChildEnv\(payload\.env \|\| \{\}, targetUser, owner\.username\)/u);
  assert.match(source, /env\.TMPDIR = workspaceTempRoot\(ownerUsername\)/u);
  assert.equal(
    source.match(/Environment=TMPDIR=\$\{systemdUnitSafeValue\(workspaceTempRoot\(owner\.username\)\)\}/gu)?.length,
    2
  );
  assert.doesNotMatch(source, /actorTemp|FLOCK_PATH|mkdtemp/u);
});
