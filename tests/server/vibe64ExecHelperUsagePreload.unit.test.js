import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { helperChildEnv, usageRecordingNodeOptions as helperNodeOptions } from "../../packages/vibe64-execution/src/host/execHelper.js";
import { normalizeVibe64CommandRequest } from "../../packages/vibe64-execution/src/server/request.js";
import { usageRecordingNodeOptions as localNodeOptions } from "../../packages/vibe64-execution/src/server/runVibe64Command.js";

// An installation laid out like the source tree and a release: the helper and
// the recorder runtime are siblings below one packages directory.
async function installation(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-preload-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const helper = path.join(root, "install/vibe64-execution/src/host/execHelper.js");
  const runtime = path.join(root, "install/vibe64-usage-recording/runtime/node");
  await mkdir(path.dirname(helper), { recursive: true });
  await mkdir(path.join(runtime, "directory.mjs"), { recursive: true });
  await mkdir(path.join(root, "other"), { recursive: true });
  await writeFile(helper, "");
  await writeFile(path.join(runtime, "preload.mjs"), "");
  await writeFile(path.join(root, "other/preload.mjs"), "");
  await symlink(path.join(runtime, "preload.mjs"), path.join(runtime, "alias.mjs"));
  await symlink(path.join(root, "other/preload.mjs"), path.join(runtime, "outside.mjs"));
  await symlink(path.join(root, "install"), path.join(root, "linked"));
  const allowed = path.join(runtime, "preload.mjs");
  return {
    allowed,
    helper,
    runtime,
    refused: [
      path.join(root, "other/preload.mjs"),
      path.join(root, "linked/vibe64-usage-recording/runtime/node/preload.mjs"),
      path.join(runtime, "alias.mjs"),
      path.join(runtime, "outside.mjs"),
      path.join(runtime, "directory.mjs"),
      path.join(runtime, "missing.mjs"),
      `${runtime}/../node/preload.mjs`,
      "install/vibe64-usage-recording/runtime/node/preload.mjs",
      `${allowed} --require=/x`,
      ""
    ]
  };
}

test("the exec helper sets NODE_OPTIONS only for the recorder preload of its own installation", async (t) => {
  const { allowed, helper, refused } = await installation(t);
  assert.equal(helperNodeOptions(allowed, helper), `--import=${allowed}`);
  for (const preload of refused) {
    assert.throws(() => helperNodeOptions(preload, helper), /usage recording preload outside its runtime/u, preload);
  }
  // A caller's own NODE_OPTIONS never reaches the child.
  const env = helperChildEnv({ NODE_OPTIONS: `--import=${allowed}`, KEEP: "yes" },
    { home: "/home/member", username: "member" }, "v64d_workspace");
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.KEEP, "yes");
});

test("an unmanaged launch applies the same preload check before setting NODE_OPTIONS", async (t) => {
  const { allowed, refused, runtime } = await installation(t);
  assert.equal(localNodeOptions(allowed, runtime), `--import=${allowed}`);
  for (const preload of refused) {
    assert.throws(() => localNodeOptions(preload, runtime), { code: "vibe64_usage_recording_preload_invalid" }, preload);
  }
});

test("only a Preview or Output launch may name a recorder preload", () => {
  const request = { command: "node", cwd: "/", usageRecordingPreload: "/opt/preload.mjs" };
  for (const purpose of ["preview", "output"]) {
    assert.equal(normalizeVibe64CommandRequest({ ...request, purpose }).usageRecordingPreload, "/opt/preload.mjs");
  }
  assert.equal(normalizeVibe64CommandRequest({ command: "node", cwd: "/" }).usageRecordingPreload, "");
  for (const invalid of [
    { purpose: "terminal" },
    { purpose: "assistant" },
    { purpose: "preview", usageRecordingPreload: "relative/preload.mjs" },
    { purpose: "preview", usageRecordingPreload: "/opt/pre load.mjs" },
    { purpose: "preview", usageRecordingPreload: "/opt/\"preload.mjs" },
    { purpose: "preview", usageRecordingPreload: ["/opt/preload.mjs"] },
    { purpose: "output", actor: "app" }
  ]) {
    assert.throws(() => normalizeVibe64CommandRequest({ ...request, ...invalid }),
      { code: "vibe64_command_usage_recording_preload_invalid" }, JSON.stringify(invalid));
  }
});
