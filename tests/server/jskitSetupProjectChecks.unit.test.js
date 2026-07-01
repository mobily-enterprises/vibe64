import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configImportProblems,
  configImportSpecifiersFromText,
  directDependencyNames,
  missingDirectDependencies
} from "@local/vibe64-adapters/server/adapters/jskit/setupDependencyChecks";
import {
  createJskitProjectSetupTerminalActions,
  createJskitProjectSetupChecks,
  npmInstallScript
} from "@local/vibe64-adapters/server/adapters/jskit/setupProjectChecks";
import {
  checkJskitScaffold,
  scaffoldCommandPreview,
  scaffoldScript
} from "@local/vibe64-adapters/server/adapters/jskit/setupScaffold";
import {
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-tenant";

function assertShellScriptSurvivesWhitespaceCollapse(script) {
  const flattened = script.replace(/\s+/gu, " ");
  const result = spawnSync("bash", ["-n", "-c", flattened], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || flattened);
}

test("JSKIT setup dependency gate catches partial node_modules installs", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-deps-"));
  const toolkit = createDoctorPluginToolkit({
    targetRoot
  });
  const packageJson = {
    dependencies: {
      "@jskit-ai/kernel": "0.x"
    },
    devDependencies: {
      "@jskit-ai/config-eslint": "0.x",
      "@jskit-ai/jskit-cli": "0.x"
    },
    optionalDependencies: {
      "optional-tool": "1.x"
    }
  };
  await writeFile(path.join(targetRoot, "package.json"), JSON.stringify(packageJson, null, 2), "utf8");
  await mkdir(path.join(targetRoot, "node_modules", "@jskit-ai", "jskit-cli"), {
    recursive: true
  });
  await writeFile(
    path.join(targetRoot, "node_modules", "@jskit-ai", "jskit-cli", "package.json"),
    "{}",
    "utf8"
  );

  assert.deepEqual(directDependencyNames(packageJson), [
    "@jskit-ai/config-eslint",
    "@jskit-ai/jskit-cli",
    "@jskit-ai/kernel"
  ]);

  const missing = await missingDirectDependencies(targetRoot, packageJson, toolkit);

  assert.deepEqual(missing, [
    "@jskit-ai/config-eslint",
    "@jskit-ai/kernel"
  ]);
});

test("JSKIT setup dependency repair uses package-manager commands only", () => {
  const script = npmInstallScript();

  assert.match(script, /npm install/u);
  assert.match(script, /npm update \$jskit_deps/u);
  assert.doesNotMatch(script, /@latest/u);
  assert.doesNotMatch(script, /--save-exact/u);
  assert.doesNotMatch(script, /jskit app/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("JSKIT setup actions use Runtime Config instead of .env seed writers", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-runtime-actions-"));
  let materialized = false;
  let startedTerminal = null;
  const toolkit = createDoctorPluginToolkit({
    startTerminalSession(input = {}) {
      startedTerminal = input;
      return {
        id: "terminal-1",
        ok: true
      };
    },
    targetRoot
  });

  const actions = createJskitProjectSetupTerminalActions({
    materializeRuntimeConfig: async () => {
      materialized = true;
      return {
        ok: true
      };
    },
    runtimeConfigEnvironment: async () => ({
      DB_CLIENT: "mysql2",
      DB_PASSWORD: "runtime-secret"
    }),
    targetRoot,
    toolkit
  });
  const actionIds = actions.map((action) => action.actionId);

  assert.deepEqual(actionIds, [
    "terminal-npm-install",
    "terminal-materialize-jskit-runtime-config",
    "terminal-create-app-db"
  ]);
  assert.equal(actionIds.includes("terminal-seed-jskit-db-env"), false);
  assert.equal(actionIds.includes("terminal-use-managed-jskit-db-env"), false);

  await actions.find((action) => action.actionId === "terminal-npm-install").start({
    targetRoot
  });
  assert.equal(startedTerminal.command, "docker");
  assert.ok(startedTerminal.args.includes("DB_CLIENT=mysql2"));
  assert.ok(startedTerminal.args.includes("DB_PASSWORD=runtime-secret"));

  await actions.find((action) => action.actionId === "terminal-materialize-jskit-runtime-config").start({
    targetRoot
  });
  assert.equal(materialized, true);
});

test("JSKIT setup runtime service checks resolve Runtime Config without materializing files", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-runtime-checks-"));
  const toolkit = createDoctorPluginToolkit({
    targetRoot
  });
  await writeFile(path.join(targetRoot, "package.json"), JSON.stringify({
    dependencies: {
      "@jskit-ai/database-runtime-mysql": "0.x"
    }
  }, null, 2), "utf8");
  const runtimeConfigEnvironmentCalls = [];
  const checks = createJskitProjectSetupChecks(toolkit, {
    materializeRuntimeConfig: async () => ({
      ok: true
    }),
    runtimeConfigEnvironment: async (input = {}) => {
      runtimeConfigEnvironmentCalls.push(input);
      throw new Error("Missing test runtime config.");
    }
  });

  const result = await checks.runtimeServices.run({
    targetRoot
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(runtimeConfigEnvironmentCalls, [
    {
      materialize: false,
      phases: [
        "migrate",
        "server"
      ],
      target: "checks",
      targetRoot
    }
  ]);
});

test("JSKIT seed command defaults tenancy because seed workflow now chooses it", () => {
  const preview = scaffoldCommandPreview();
  const script = scaffoldScript();

  assert.match(preview, /npx @jskit-ai\/create-app/u);
  assert.match(preview, /--tenancy-mode none/u);
  assert.match(script, /--tenancy-mode none/u);
  assert.doesNotMatch(script, /--tenancy-mode single/u);
  assert.doesNotMatch(script, /--tenancy-mode multi/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("JSKIT scaffold check lets an empty target with root .gitignore reach the seed workflow", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-gitignore-"));
  const toolkit = createDoctorPluginToolkit({
    targetRoot
  });
  await writeFile(path.join(targetRoot, ".gitignore"), ".vibe64/\n", "utf8");

  const result = await checkJskitScaffold(targetRoot, {
    nonGitEntries: [
      ".gitignore"
    ]
  }, toolkit);

  assert.equal(result.status, "pass");
  assert.match(result.observed, /No scaffold files/u);
  assert.match(result.explanation, /seed workflow/u);
});

test("JSKIT scaffold check treats source-owned Vibe64 config as bootstrap state", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-state-"));
  const toolkit = createDoctorPluginToolkit({
    targetRoot
  });
  await mkdir(path.join(targetRoot, ".vibe64"), {
    recursive: true
  });

  const result = await checkJskitScaffold(targetRoot, {
    nonGitEntries: [
      ".vibe64"
    ]
  }, toolkit);

  assert.equal(result.status, "pass");
  assert.match(result.observed, /No scaffold files/u);
  assert.match(result.explanation, /seed workflow/u);
});

test("JSKIT setup parses config package imports", () => {
  assert.deepEqual(configImportSpecifiersFromText(`
    import "node:test";
    import "./local.js";
    import { baseConfig } from "@jskit-ai/config-eslint/server";
    const plugin = await import("@vitejs/plugin-vue");
  `), [
    "@jskit-ai/config-eslint/server",
    "@vitejs/plugin-vue"
  ]);
});

test("JSKIT setup catches stale config package subpath exports", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-config-imports-"));
  const toolkit = createDoctorPluginToolkit({
    targetRoot
  });
  await writeFile(
    path.join(targetRoot, "eslint.config.mjs"),
    "import { baseConfig } from '@jskit-ai/config-eslint/server';\nexport default baseConfig;\n",
    "utf8"
  );
  await mkdir(path.join(targetRoot, "node_modules", "@jskit-ai", "config-eslint"), {
    recursive: true
  });
  await writeFile(
    path.join(targetRoot, "node_modules", "@jskit-ai", "config-eslint", "package.json"),
    JSON.stringify({
      description: "Retired",
      name: "@jskit-ai/config-eslint",
      type: "module",
      version: "0.1.3"
    }),
    "utf8"
  );

  assert.deepEqual(await configImportProblems(targetRoot, toolkit), [
    "eslint.config.mjs: @jskit-ai/config-eslint/server is not present in @jskit-ai/config-eslint@0.1.3."
  ]);
});
