import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createJskitBuiltLaunchDescriptor,
  createJskitDevLaunchDescriptor
} from "../../packages/vibe64-adapters/src/server/adapters/jskit/launchTargets.js";

test("JSKIT launch descriptors leave preview identity to the Vibe64 project contract", async (t) => {
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-preview-identity-"));
  t.after(() => rm(worktreePath, {
    force: true,
    recursive: true
  }));
  const built = await createJskitBuiltLaunchDescriptor({
    config: {
      buildCommand: "",
      migrationCommand: "",
      serverCommand: "",
      testrunCommand: "npm run testrun"
    },
    worktreePath
  });
  const dev = await createJskitDevLaunchDescriptor({
    config: {
      backendCommand: "npm run server",
      backendPort: 3000,
      frontendCommand: "npm run dev",
      migrationCommand: ""
    },
    worktreePath
  });

  assert.equal(Object.hasOwn(built, "previewIdentity"), false);
  assert.equal(Object.hasOwn(dev, "previewIdentity"), false);
  assert.equal(Object.hasOwn(built, "previewAuth"), false);
  assert.equal(Object.hasOwn(dev, "previewAuth"), false);
});
