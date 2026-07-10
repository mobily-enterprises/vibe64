import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  mariaDbCreateDatabaseHostCommandArgs
} from "../../packages/vibe64-adapters/src/server/adapterHelpers/setupMariaDbChecks.js";
import {
  jskitManagedMariaDbDevelopmentDatabaseCommandArgs
} from "../../packages/vibe64-adapters/src/server/adapters/jskit/setupMariaDbRuntime.js";
import {
  managedMariaDbServiceStartCommandArgs
} from "../../packages/vibe64-adapters/src/server/managedDatabases/mariadbRuntime.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");

const adapterRuntimeFiles = Object.freeze([
  "packages/vibe64-adapters/src/server/adapters/jskit/setupMariaDbRuntime.js",
  "packages/vibe64-adapters/src/server/adapterHelpers/setupMariaDbChecks.js",
  "packages/vibe64-adapters/src/server/nodePackage.js",
  "packages/vibe64-adapters/src/server/codeIndexCommands.js",
  "packages/vibe64-adapters/src/server/adapters/laravel/composerPackage.js"
]);

test("adapters delegate package-backed command assembly to runtimeToolchain", async () => {
  for (const relativePath of adapterRuntimeFiles) {
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /\bnixShellArgs\b/u, `${relativePath} must not assemble Nix shell commands directly`);
    assert.doesNotMatch(source, /\bVIBE64_NIX_COMMAND\b/u, `${relativePath} must not reference the Nix command directly`);
  }
});

test("JSKIT MariaDB commands honor hosted shared runtime pack policy", () => {
  const previous = process.env.VIBE64_SKIP_BASE_TOOLCHAIN_REALIZE;
  process.env.VIBE64_SKIP_BASE_TOOLCHAIN_REALIZE = "1";
  try {
    for (const commandArgs of [
      managedMariaDbServiceStartCommandArgs({
        serviceDataRoot: "/tmp/vibe64-services",
        targetRoot: "/tmp/vibe64-target"
      }),
      jskitManagedMariaDbDevelopmentDatabaseCommandArgs({
        databaseName: "example",
        serviceDataRoot: "/tmp/vibe64-services",
        targetRoot: "/tmp/vibe64-target"
      }),
      mariaDbCreateDatabaseHostCommandArgs()
    ]) {
      assert.equal(commandArgs[0], "bash");
      assert.equal(commandArgs[1], "-lc");
      assert.equal(commandArgs.includes("nix"), false);
    }
  } finally {
    if (previous === undefined) {
      delete process.env.VIBE64_SKIP_BASE_TOOLCHAIN_REALIZE;
    } else {
      process.env.VIBE64_SKIP_BASE_TOOLCHAIN_REALIZE = previous;
    }
  }
});
