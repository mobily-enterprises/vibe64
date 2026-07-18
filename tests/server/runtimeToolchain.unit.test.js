import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_NIXPKGS_PIN,
  VIBE64_RUNTIME_CATALOG_VERSION,
  VIBE64_RUNTIME_LOCK_FILE,
  VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
  VIBE64_RUNTIME_PACKAGE_PROVIDER_SYSTEM,
  buildRuntimeLock,
  nixShellArgs,
  readRuntimeLock,
  runtimeLockNixPackageIds,
  runtimeLockShellCommandArgs,
  runtimePackage,
  runtimeShellCommandArgs,
  runtimeToolCommandArgs,
  runtimeToolVersionMatches,
  stableRuntimeJson,
  validateRuntimeLock,
  writeRuntimeLock
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  createJskitTargetAdapter
} from "../../packages/vibe64-adapters/src/server/adapters/jskit/index.js";

test("runtime toolchain catalog pins Nix-provided runtime packages", () => {
  assert.equal(VIBE64_NIXPKGS_PIN.rev, "293d6abedf0478e681a4dfcfcb35b30fc796a32f");
  assert.equal(runtimePackage("nodejs-26").provider, VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX);
  assert.equal(runtimePackage("nodejs-26").nix.attr, "nodejs_26");
  assert.deepEqual(runtimePackage("nodejs-26").nix.companionAttrs, ["corepack"]);
  assert.equal(runtimePackage("mariadb").version, "11.4.12");
  assert.equal(runtimePackage("postgresql").version, "16.14");
  assert.equal(runtimePackage("codex").provider, VIBE64_RUNTIME_PACKAGE_PROVIDER_SYSTEM);
});

test("runtime toolchain builds Nix shell command args from the catalog", () => {
  assert.deepEqual(runtimeToolCommandArgs("nodejs-26", "node"), [
    "nix",
    "--extra-experimental-features",
    "nix-command flakes",
    "shell",
    `${VIBE64_NIXPKGS_PIN.flakeRef}#nodejs_26`,
    `${VIBE64_NIXPKGS_PIN.flakeRef}#corepack`,
    "-c",
    "node",
    "--version"
  ]);

  assert.deepEqual(nixShellArgs(["git", "ripgrep"], ["bash", "-lc", "git --version && rg --version"]), [
    "--extra-experimental-features",
    "nix-command flakes",
    "shell",
    `${VIBE64_NIXPKGS_PIN.flakeRef}#git`,
    `${VIBE64_NIXPKGS_PIN.flakeRef}#ripgrep`,
    "-c",
    "bash",
    "-lc",
    "git --version && rg --version"
  ]);
});

test("runtime toolchain builds project-scoped runtime shell argv", async () => {
  assert.deepEqual(runtimeShellCommandArgs(["nodejs-26"], "npm run build"), [
    "nix",
    "--extra-experimental-features",
    "nix-command flakes",
    "shell",
    `${VIBE64_NIXPKGS_PIN.flakeRef}#nodejs_26`,
    `${VIBE64_NIXPKGS_PIN.flakeRef}#corepack`,
    "-c",
    "bash",
    "-lc",
    "npm run build"
  ]);

  const adapter = createJskitTargetAdapter();
  const lock = buildRuntimeLock({
    adapterId: adapter.id,
    createdAt: "2026-07-06T00:00:00.000Z",
    projectType: "jskit",
    runtimeRequirements: await adapter.getRuntimeRequirements({
      config: {
        values: {
          jskit_database_runtime: "mariadb"
        }
      }
    })
  });

  assert.deepEqual(runtimeLockNixPackageIds(lock), ["mariadb", "nodejs-26"]);
  assert.deepEqual(runtimeLockNixPackageIds(lock, {
    includeServices: false
  }), ["nodejs-26"]);
  assert.deepEqual(runtimeLockShellCommandArgs(lock, "npm run verify"), [
    "nix",
    "--extra-experimental-features",
    "nix-command flakes",
    "shell",
    `${VIBE64_NIXPKGS_PIN.flakeRef}#mariadb`,
    `${VIBE64_NIXPKGS_PIN.flakeRef}#nodejs_26`,
    `${VIBE64_NIXPKGS_PIN.flakeRef}#corepack`,
    "-c",
    "bash",
    "-lc",
    "npm run verify"
  ]);
});

test("runtime toolchain skips Nix shell when shared runtime packs are active", async () => {
  assert.deepEqual(runtimeToolCommandArgs("nodejs-26", "node", {
    preferSharedRuntimePacks: true
  }), [
    "node",
    "--version"
  ]);
  assert.deepEqual(runtimeShellCommandArgs(["nodejs-26"], "npm install --foreground-scripts --no-audit --no-fund", {
    preferSharedRuntimePacks: true
  }), [
    "bash",
    "-lc",
    "npm install --foreground-scripts --no-audit --no-fund"
  ]);

  const adapter = createJskitTargetAdapter();
  const lock = buildRuntimeLock({
    adapterId: adapter.id,
    createdAt: "2026-07-06T00:00:00.000Z",
    projectType: "jskit",
    runtimeRequirements: await adapter.getRuntimeRequirements({
      config: {
        values: {
          jskit_database_runtime: "mariadb"
        }
      }
    })
  });

  assert.deepEqual(runtimeLockShellCommandArgs(lock, "npm run verify", {
    preferSharedRuntimePacks: true
  }), [
    "bash",
    "-lc",
    "npm run verify"
  ]);
});

test("runtime toolchain validates observed command versions", () => {
  assert.equal(runtimeToolVersionMatches("v26.5.0", "nodejs-26", "node"), true);
  assert.equal(runtimeToolVersionMatches("v24.18.0", "nodejs-26", "node"), false);
  assert.equal(runtimeToolVersionMatches("mariadb  Ver 15.1 Distrib 11.4.12-MariaDB, for Linux (x86_64)", "mariadb", "mariadb"), true);
  assert.equal(runtimeToolVersionMatches("mariadb  Ver 15.1 Distrib 10.11.11-MariaDB, for Linux (x86_64)", "mariadb", "mariadb"), false);
});

test("jskit adapter declares Vibe64-owned runtime requirements", async () => {
  const adapter = createJskitTargetAdapter();

  assert.deepEqual((await adapter.getRuntimeRequirements({
    config: {
      values: {
        jskit_database_runtime: "mariadb"
      }
    }
  })).map((requirement) => requirement.id), [
    "nodejs-26",
    "mariadb"
  ]);

  assert.deepEqual((await adapter.getRuntimeRequirements({
    config: {
      values: {
        jskit_database_runtime: "none"
      }
    }
  })).map((requirement) => requirement.id), [
    "nodejs-26"
  ]);
});

test("runtime lock is source-owned catalog resolution without secrets or host paths", async () => {
  const adapter = createJskitTargetAdapter();
  const runtimeRequirements = await adapter.getRuntimeRequirements({
    config: {
      values: {
        jskit_database_runtime: "mariadb"
      }
    }
  });
  const lock = buildRuntimeLock({
    adapterId: adapter.id,
    createdAt: "2026-07-06T00:00:00.000Z",
    projectType: "jskit",
    runtimeRequirements
  });

  assert.equal(lock.schema, "vibe64.runtime-lock");
  assert.equal(lock.catalog.version, VIBE64_RUNTIME_CATALOG_VERSION);
  assert.deepEqual(lock.selected.tools.map((entry) => entry.id), ["nodejs-26"]);
  assert.deepEqual(lock.selected.tools[0].nix.companionAttrs, ["corepack"]);
  assert.deepEqual(lock.selected.services.map((entry) => entry.id), ["mariadb"]);
  assert.equal(lock.selected.services[0].nix.attr, "mariadb");
  const serialized = stableRuntimeJson(lock);
  assert.doesNotMatch(serialized, /vibe64_jskit_root|DB_PASSWORD|MYSQL_PWD/u);
  assert.doesNotMatch(serialized, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "v64-runtime-lock-"));
  try {
    const sourceContractRoot = tempRoot;
    await writeRuntimeLock({
      lock,
      sourceContractRoot
    });
    assert.deepEqual(await readRuntimeLock({
      sourceContractRoot
    }), lock);
    assert.equal(await readRuntimeLock({
      sourceContractRoot: path.join(tempRoot, "missing")
    }), null);
    assert.equal(path.basename(path.join(sourceContractRoot, VIBE64_RUNTIME_LOCK_FILE)), "vibe64.runtime-lock.json");
  } finally {
    await rm(tempRoot, {
      force: true,
      recursive: true
    });
  }
});

test("runtime lock validation catches stale project selections", async () => {
  const adapter = createJskitTargetAdapter();
  const mysqlRequirements = await adapter.getRuntimeRequirements({
    config: {
      values: {
        jskit_database_runtime: "mariadb"
      }
    }
  });
  const noneRequirements = await adapter.getRuntimeRequirements({
    config: {
      values: {
        jskit_database_runtime: "none"
      }
    }
  });
  const lock = buildRuntimeLock({
    adapterId: adapter.id,
    createdAt: "2026-07-06T00:00:00.000Z",
    projectType: "jskit",
    runtimeRequirements: mysqlRequirements
  });

  assert.equal(validateRuntimeLock(lock, {
    adapterId: adapter.id,
    projectType: "jskit",
    runtimeRequirements: mysqlRequirements
  }).ok, true);
  const mismatch = validateRuntimeLock(lock, {
    adapterId: adapter.id,
    projectType: "jskit",
    runtimeRequirements: noneRequirements
  });
  assert.equal(mismatch.ok, false);
  assert.deepEqual(mismatch.observedPackageIds, ["mariadb", "nodejs-26"]);
  assert.deepEqual(mismatch.expectedPackageIds, ["nodejs-26"]);
});

test("jskit postgres runtime is an explicit unsupported requirement", async () => {
  const adapter = createJskitTargetAdapter();

  await assert.rejects(
    () => adapter.getRuntimeRequirements({
      config: {
        values: {
          jskit_database_runtime: "postgres"
        }
      }
    }),
    {
      code: "vibe64_runtime_requirement_unsupported"
    }
  );
});
