import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { helperChildEnv, usageRecordingNodeOptions as helperNodeOptions } from "../../packages/vibe64-execution/src/host/execHelper.js";
import { normalizeVibe64CommandRequest } from "../../packages/vibe64-execution/src/server/request.js";
import { usageRecordingNodeOptions as localNodeOptions } from "../../packages/vibe64-execution/src/server/runVibe64Command.js";
import nodejs from "../../packages/vibe64-usage-recording/src/server/tracers/nodejs.js";

// Where the checking code and the recorder runtime may sit: the source tree's
// sibling packages, an application's node_modules, and a helper installed on
// its own with the runtime in a node_modules folder above it.
const LAYOUTS = Object.freeze({
  source: ["packages/vibe64-execution/src/host/execHelper.js", "packages/vibe64-usage-recording/runtime/node"],
  application: ["app/node_modules/@local/vibe64-execution/src/host/execHelper.js", "app/node_modules/@local/vibe64-usage-recording/runtime/node"],
  installed: ["lib/vibe64/vibe64-exec-helper", "lib/vibe64/node_modules/@local/vibe64-usage-recording/runtime/node"]
});

async function installation(t, layout) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-preload-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const helper = path.join(root, LAYOUTS[layout][0]);
  const runtime = path.join(root, LAYOUTS[layout][1]);
  await mkdir(path.dirname(helper), { recursive: true });
  await mkdir(path.join(runtime, "directory.mjs"), { recursive: true });
  await mkdir(path.join(root, "other/vibe64-usage-recording/runtime/node"), { recursive: true });
  await writeFile(helper, "");
  await writeFile(path.join(runtime, "preload.mjs"), "");
  await writeFile(path.join(root, "other/vibe64-usage-recording/runtime/node/preload.mjs"), "");
  await symlink(path.join(runtime, "preload.mjs"), path.join(runtime, "alias.mjs"));
  await symlink(path.join(root, "other/vibe64-usage-recording/runtime/node/preload.mjs"), path.join(runtime, "outside.mjs"));
  await symlink(path.dirname(runtime), path.join(root, "linked"));
  const allowed = path.join(runtime, "preload.mjs");
  return {
    allowed,
    helper,
    refused: [
      path.join(root, "other/vibe64-usage-recording/runtime/node/preload.mjs"),
      path.join(root, "linked/node/preload.mjs"),
      path.join(runtime, "alias.mjs"),
      path.join(runtime, "outside.mjs"),
      path.join(runtime, "directory.mjs"),
      path.join(runtime, "missing.mjs"),
      `${runtime}/../node/preload.mjs`,
      path.relative(root, allowed),
      `${allowed} --require=/x`,
      ""
    ]
  };
}

test("the exec helper sets NODE_OPTIONS only for the recorder preload of its own installation", async (t) => {
  for (const layout of Object.keys(LAYOUTS)) {
    const { allowed, helper, refused } = await installation(t, layout);
    assert.equal(helperNodeOptions(allowed, helper), `--import=${allowed}`, layout);
    for (const preload of refused) {
      assert.throws(() => helperNodeOptions(preload, helper), /usage recording preload outside its runtime/u, `${layout}: ${preload}`);
    }
  }
  // A caller's own NODE_OPTIONS never reaches the child.
  const env = helperChildEnv({ NODE_OPTIONS: "--import=/x/preload.mjs", KEEP: "yes" },
    { home: "/home/member", username: "member" }, "v64d_workspace");
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.KEEP, "yes");
});

test("an unmanaged launch applies the same preload check before setting NODE_OPTIONS", async (t) => {
  // This checkout's own Node.js recorder, as its tracer hands it over.
  const preload = await realpath(nodejs.prepare({}).nodePreload);
  assert.equal(localNodeOptions(preload), `--import=${preload}`);
  for (const layout of ["source", "application"]) {
    const { allowed, helper, refused } = await installation(t, layout);
    const checker = path.join(path.dirname(path.dirname(helper)), "server/runVibe64Command.js");
    assert.equal(localNodeOptions(allowed, checker), `--import=${allowed}`, layout);
    for (const preload of refused) {
      assert.throws(() => localNodeOptions(preload, checker), { code: "vibe64_usage_recording_preload_invalid" }, `${layout}: ${preload}`);
    }
  }
});

test("only a Preview or Output launch may name a recorder preload", () => {
  const request = { command: "node", cwd: "/", usageRecordingPreload: "/recorder/preload.mjs" };
  for (const purpose of ["preview", "output"]) {
    assert.equal(normalizeVibe64CommandRequest({ ...request, purpose }).usageRecordingPreload, "/recorder/preload.mjs");
  }
  assert.equal(normalizeVibe64CommandRequest({ command: "node", cwd: "/" }).usageRecordingPreload, "");
  for (const invalid of [
    { purpose: "terminal" },
    { purpose: "assistant" },
    { purpose: "preview", usageRecordingPreload: "relative/preload.mjs" },
    { purpose: "preview", usageRecordingPreload: "/recorder/pre load.mjs" },
    { purpose: "preview", usageRecordingPreload: "/recorder/\"preload.mjs" },
    { purpose: "preview", usageRecordingPreload: ["/recorder/preload.mjs"] },
    { purpose: "output", actor: "app" }
  ]) {
    assert.throws(() => normalizeVibe64CommandRequest({ ...request, ...invalid }),
      { code: "vibe64_command_usage_recording_preload_invalid" }, JSON.stringify(invalid));
  }
});
