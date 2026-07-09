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

test("execution helper rejects payloads that did not pass gateway normalization", async () => {
  const source = await helperSource();

  assert.match(source, /const EXEC_HELPER_PAYLOAD_SCHEMA = "vibe64\.exec-helper\.payload"/u);
  assert.match(source, /function assertNormalizedPayload/u);
  assert.match(source, /Vibe64 exec helper rejected a non-normalized execution payload/u);
});

test("execution helper lets account status commands run from the target user home", async () => {
  const source = await helperSource();

  assert.match(source, /operation === "account-auth-terminal" \|\| operation === "account-status"/u);
  assert.match(source, /return resolveAllowedUserHomePath\(normalized, targetUser\)/u);
});

test("execution helper uses runuser instead of direct initgroups setuid flow", async () => {
  const source = await helperSource();

  assert.match(source, /spawnSync\("runuser"/u);
  assert.doesNotMatch(source, /process\.initgroups/u);
  assert.doesNotMatch(source, /process\.setuid/u);
  assert.doesNotMatch(source, /process\.setgid/u);
});
