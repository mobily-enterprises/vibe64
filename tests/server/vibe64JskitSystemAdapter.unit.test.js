import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  extractJskitFacts
} from "../../packages/vibe64-system-graph/src/server/adapters/jskit/extractJskitFacts.js";
import {
  createSystemAdapterRegistry
} from "../../packages/vibe64-system-graph/src/server/adapters/registry.js";
import {
  buildUpdatedSystemModel
} from "../../packages/vibe64-system-graph/src/server/updateSystem.js";

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeLocalPackage(appRoot, {
  dependsOn = [],
  name,
  packageExports = null,
  runtime,
  sourceFiles = {}
}) {
  const packageRoot = path.join(appRoot, "packages", name);
  const packageId = `@local/${name}`;
  await mkdir(packageRoot, { recursive: true });
  await writeJson(path.join(packageRoot, "package.json"), {
    ...(packageExports ? { exports: packageExports } : {}),
    name: packageId,
    version: "0.1.0",
    type: "module"
  });
  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    [
      "if (globalThis.__vibe64DescriptorExecuted) { throw new Error('descriptor executed'); }",
      `export default Object.freeze(${JSON.stringify({
        packageVersion: 1,
        packageId,
        version: "0.1.0",
        kind: "runtime",
        description: `${name} responsibility`,
        dependsOn,
        capabilities: {
          provides: [`feature.${name}`],
          requires: []
        },
        runtime
      }, null, 2)});`,
      ""
    ].join("\n"),
    "utf8"
  );
  for (const [relativePath, source] of Object.entries(sourceFiles)) {
    const filePath = path.join(packageRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, source, "utf8");
  }
}

async function createFixtureProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-system-adapter-"));
  await mkdir(path.join(root, ".jskit"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeJson(path.join(root, "package.json"), {
    name: "system-adapter-fixture",
    version: "0.1.0",
    private: true,
    type: "module",
    workspaces: ["packages/*"]
  });
  await writeJson(path.join(root, ".jskit", "lock.json"), {
    lockVersion: 1,
    installedPackages: {}
  });
  await writeFile(path.join(root, "src", "unowned.js"), "export const orphan = true;\n", "utf8");
  await writeLocalPackage(root, {
    name: "alpha",
    dependsOn: ["@local/beta"],
    runtime: {
      server: {
        providers: [{
          entrypoint: "src/server/AlphaProvider.js",
          export: "AlphaProvider"
        }]
      },
      client: {
        providers: [{
          entrypoint: "src/client/AlphaClientProvider.js",
          export: "AlphaClientProvider"
        }]
      }
    },
    sourceFiles: {
      "src/client/AlphaClientProvider.js": [
        "import { sharedValue } from '../shared/common.js';",
        "export class AlphaClientProvider { value() { return sharedValue; } }",
        ""
      ].join("\n"),
      "src/server/AlphaProvider.js": [
        "import { BetaProvider } from '@local/beta/server/BetaProvider';",
        "import { sharedValue } from '../shared/common.js';",
        "export class AlphaProvider {",
        "  register(app) { app.get('/api/alpha/:id', async () => sharedValue); }",
        "}",
        ""
      ].join("\n"),
      "src/shared/common.js": "export const sharedValue = 64;\n"
    }
  });
  await writeLocalPackage(root, {
    name: "beta",
    packageExports: {
      "./server/*": "./src/server/*.js"
    },
    runtime: {
      server: {
        providers: [{
          entrypoint: "src/server/BetaProvider.js",
          export: "BetaProvider"
        }]
      },
      client: {
        providers: []
      }
    },
    sourceFiles: {
      "src/server/BetaProvider.js": "export class BetaProvider {}\n"
    }
  });
  return root;
}

test("Vibe64-owned JSKIT adapter extracts deterministic facts without executing descriptors", async () => {
  const root = await createFixtureProject();
  try {
    globalThis.__vibe64DescriptorExecuted = true;
    const first = await extractJskitFacts({ targetRoot: root });
    const second = await extractJskitFacts({ targetRoot: root });
    assert.deepEqual(second, first);
    assert.equal(first.schema, "vibe64.system.jskit-facts.v1");
    assert.equal(first.packages.length, 2);
    assert.equal(first.scope.mode, "full");
    assert.deepEqual(
      first.packages.find((entry) => entry.packageId === "@local/alpha").executionSides,
      ["client", "server", "shared"]
    );
    assert.equal(
      first.files.find((file) => file.path.endsWith("alpha/src/shared/common.js")).executionSide,
      "shared"
    );
    assert.deepEqual(
      first.files.find((file) => file.path.endsWith("AlphaProvider.js")).routes.map((route) => [
        route.method,
        route.path
      ]),
      [["GET", "/api/alpha/:id"]]
    );
    assert.equal(first.relationships[0].kind, "depends_on");
    assert.deepEqual(
      first.files
        .find((file) => file.path.endsWith("AlphaProvider.js"))
        .imports.find((entry) => entry.specifier === "@local/beta/server/BetaProvider"),
      {
        classification: "cross-package",
        kind: "import",
        line: 1,
        specifier: "@local/beta/server/BetaProvider",
        targetFile: "packages/beta/src/server/BetaProvider.js",
        targetPackageId: "@local/beta"
      }
    );
    assert.equal(first.files.find((file) => file.path === "src/unowned.js").executionSide, "unknown");

    const scoped = await extractJskitFacts({
      scopes: ["@local/alpha"],
      targetRoot: root
    });
    assert.equal(scoped.scope.mode, "partial");
    assert.deepEqual(scoped.scope.authoritativePackageIds, ["@local/alpha"]);
    assert.equal(scoped.files.some((file) => file.path === "src/unowned.js"), false);
  } finally {
    delete globalThis.__vibe64DescriptorExecuted;
    await rm(root, { recursive: true, force: true });
  }
});

test("System adapter registry ships JSKIT only and the updater consumes its normalized model", async () => {
  const root = await createFixtureProject();
  try {
    const registry = createSystemAdapterRegistry();
    assert.deepEqual(registry.availableAdapterIds(), ["jskit"]);
    assert.equal(registry.adapterFor("laravel"), null);
    assert.throws(
      () => registry.requireAdapter("laravel"),
      (error) => error.code === "vibe64_system_adapter_unsupported"
    );

    const result = await buildUpdatedSystemModel({
      adapterId: "jskit",
      adapterRegistry: registry,
      snapshot: {
        changedPaths: [],
        digest: "fixture-source-digest",
        head: "fixture-head"
      },
      sourceRoot: root
    });
    assert.equal(result.updateMode, "full");
    assert.equal(result.model.adapter.id, "jskit");
    assert.equal(result.model.entities.filter((entity) => entity.kind === "subsystem").length, 2);
    assert.equal(result.model.input.sourceHead, "fixture-head");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
