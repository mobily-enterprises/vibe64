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
  defaultDatabaseEnv
} from "@local/vibe64-adapters/server/adapters/jskit/setupDatabasePolicy";
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
import {
  JSKIT_MARIADB_APP_USER,
  jskitMariaDbAppPassword,
  jskitMariaDbHostPort,
  jskitMariaDbTenantDatabaseGrantPattern,
  jskitManagedMariaDbDevelopmentDatabaseScript,
  stopJskitManagedMariaDbRuntime
} from "@local/vibe64-adapters/server/adapters/jskit/setupMariaDbRuntime";
import {
  managedMariaDbRuntimeRoot,
  managedMariaDbServiceMetadata,
  managedMariaDbServicePaths,
  managedMariaDbServiceStartScript
} from "@local/vibe64-adapters/server/managedDatabases/mariadbRuntime";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

function assertShellScriptSurvivesWhitespaceCollapse(script) {
  const flattened = script.replace(/\s+/gu, " ");
  const result = spawnSync("bash", ["-n", "-c", flattened], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || flattened);
}

function assertShellScriptSyntax(script) {
  const result = spawnSync("bash", ["-n"], {
    encoding: "utf8",
    input: script
  });

  assert.equal(result.status, 0, result.stderr || script);
}

function escapedPattern(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
  const serviceDataRoot = path.join(targetRoot, "tenant-services");
  const otherTargetRoot = path.join(path.dirname(targetRoot), "other-jskit-project");
  let materialized = false;
  let startedTerminal = null;
  const toolkit = createDoctorPluginToolkit({
    runTerminalCommand(input = {}) {
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
    serviceDataRoot,
    targetRoot,
    toolkit
  });
  const actionIds = actions.map((action) => action.actionId);

  assert.deepEqual(actionIds, [
    "terminal-npm-install",
    "terminal-materialize-jskit-runtime-config",
    "terminal-start-managed-mariadb",
    "terminal-create-app-db"
  ]);
  assert.equal(actionIds.includes("terminal-seed-jskit-db-env"), false);
  assert.equal(actionIds.includes("terminal-use-managed-jskit-db-env"), false);

  const startAction = actions.find((action) => action.actionId === "terminal-start-managed-mariadb");
  await startAction.start({
    targetRoot
  });
  assert.equal(startedTerminal.command, "bash");
  assert.equal(startedTerminal.mode, "pty");
  assert.equal(startedTerminal.purpose, "setup");
  assert.equal(startedTerminal.envPolicy, "project");
  assert.deepEqual(startedTerminal.runtimes, ["mariadb"]);
  assert.doesNotMatch(startedTerminal.args.join(" "), /\bnix --extra-experimental-features\b/u);
  assert.doesNotMatch(startedTerminal.args.join(" "), /#mariadb/u);
  assert.match(startedTerminal.terminal.commandPreview, new RegExp(jskitMariaDbHostPort(targetRoot, {
    serviceDataRoot
  }), "u"));
  assert.equal(managedMariaDbRuntimeRoot({
    serviceDataRoot
  }), path.join(serviceDataRoot, "mariadb"));
  assert.equal(
    jskitMariaDbHostPort(otherTargetRoot, {
      serviceDataRoot
    }),
    jskitMariaDbHostPort(targetRoot, {
      serviceDataRoot
    })
  );
  assert.equal(
    jskitMariaDbAppPassword(otherTargetRoot, {
      serviceDataRoot
    }),
    jskitMariaDbAppPassword(targetRoot, {
      serviceDataRoot
    })
  );
  const startScript = managedMariaDbServiceStartScript({
    serviceDataRoot,
    targetRoot
  });
  const developmentDatabaseScript = jskitManagedMariaDbDevelopmentDatabaseScript({
    databaseName: "app_db",
    serviceDataRoot,
    targetRoot
  });
  const tenantGrantPattern = jskitMariaDbTenantDatabaseGrantPattern(targetRoot, {
    serviceDataRoot
  });
  assertShellScriptSyntax(startScript);
  assertShellScriptSyntax(developmentDatabaseScript);
  assert.match(startScript, /mariadb-install-db --no-defaults/u);
  assert.doesNotMatch(startScript, /mysql_install_db --no-defaults/u);
  assert.match(startScript, /mariadbd "\$\{mariadb_start_args\[@\]\}" >\/dev\/null 2>&1 &/u);
  assert.match(startScript, /mariadb --no-defaults --skip-ssl --protocol=TCP/u);
  assert.match(developmentDatabaseScript, /mariadb --no-defaults --skip-ssl --protocol=TCP/u);
  assert.doesNotMatch(startScript, /CREATE USER|GRANT ALL PRIVILEGES|development_app_password/u);
  assert.match(developmentDatabaseScript, new RegExp(`CREATE USER IF NOT EXISTS .*${escapedPattern(JSKIT_MARIADB_APP_USER)}.*localhost`, "u"));
  assert.match(developmentDatabaseScript, new RegExp(`GRANT ALL PRIVILEGES ON \`${escapedPattern(tenantGrantPattern)}\`\\.\\* TO .*${escapedPattern(JSKIT_MARIADB_APP_USER)}.*localhost`, "u"));
  const developmentProvisioningScript = developmentDatabaseScript.slice(
    developmentDatabaseScript.indexOf("development_admin_password_file=")
  );
  assert.match(developmentProvisioningScript, /development_admin_password="\$\(cat "\$development_admin_password_file"\)"/u);
  assert.match(developmentProvisioningScript, /MYSQL_PWD="\$development_admin_password"/u);
  assert.match(developmentProvisioningScript, /--port="\$development_mariadb_port"/u);
  assert.doesNotMatch(developmentProvisioningScript, /\$mariadb_password|\$mariadb_port/u);
  assert.match(startScript, /metadata_file="\$runtime_root\/metadata\.json"/u);
  assert.match(startScript, /admin_password_file="\$runtime_root\/admin-password"/u);
  assert.match(startScript, /od -An -N32 -tx1 \/dev\/urandom/u);
  assert.match(startScript, /stored_mariadb_password.*previous_bootstrap_password/u);
  assert.match(startScript, /mariadb_root_previous_bootstrap --execute="ALTER USER/u);
  assert.match(startScript, /cd "\$runtime_root"/u);
  assert.match(startScript, /chmod 600 "\$admin_password_file"/u);
  assert.match(startScript, /chmod 600 "\$temporary_metadata_file"/u);
  assert.match(startScript, /mv -f "\$temporary_metadata_file" "\$metadata_file"/u);
  assert.equal(defaultDatabaseEnv(targetRoot, {
    serviceDataRoot
  }).DB_USER, JSKIT_MARIADB_APP_USER);
  assert.equal(defaultDatabaseEnv(targetRoot, {
    serviceDataRoot
  }).DB_PASSWORD, jskitMariaDbAppPassword(targetRoot, {
    serviceDataRoot
  }));

  const servicePaths = managedMariaDbServicePaths({
    serviceDataRoot
  });
  assert.equal(servicePaths.metadataFile, path.join(managedMariaDbRuntimeRoot({
    serviceDataRoot
  }), "metadata.json"));
  assert.equal(servicePaths.adminPasswordFile, path.join(managedMariaDbRuntimeRoot({
    serviceDataRoot
  }), "admin-password"));
  const metadata = managedMariaDbServiceMetadata({
    configuredAt: "2026-07-06T00:00:00.000Z",
    serviceDataRoot,
    status: "running",
    targetRoot
  });
  assert.equal(metadata.configuredAt, "2026-07-06T00:00:00.000Z");
  assert.equal(metadata.schema, "vibe64.managed-service.mariadb");
  assert.equal(metadata.service.catalogEntryId, "mariadb");
  assert.equal(metadata.connection.port, jskitMariaDbHostPort(targetRoot, {
    serviceDataRoot
  }));
  assert.equal(metadata.status, "running");
  assert.equal(metadata.database, undefined);
  assert.deepEqual(Object.keys(metadata).includes("admin"), false);
  assert.doesNotMatch(JSON.stringify(metadata), /vibe64_jskit_root|DB_PASSWORD/u);

  const createDatabaseAction = actions.find((action) => action.actionId === "terminal-create-app-db");
  await createDatabaseAction.start({
    input: {
      databaseName: "second_app_db"
    },
    targetRoot
  });
  assert.equal(startedTerminal.command, "bash");
  assert.deepEqual(startedTerminal.runtimes, ["mariadb"]);
  assert.doesNotMatch(startedTerminal.args.join(" "), /\bnix --extra-experimental-features\b/u);
  assert.doesNotMatch(startedTerminal.args.join(" "), /#mariadb/u);
  assert.match(startedTerminal.terminal.commandPreview, new RegExp(`grant tenant development databases .*second_app_db.* to ${escapedPattern(JSKIT_MARIADB_APP_USER)}`, "u"));
  assert.ok(startedTerminal.args.some((arg) => String(arg).includes("second_app_db")));

  await actions.find((action) => action.actionId === "terminal-npm-install").start({
    targetRoot
  });
  assert.equal(startedTerminal.command, "bash");
  assert.deepEqual(startedTerminal.env, {});
  assert.deepEqual(startedTerminal.project.runtimeConfigEnv, {
    DB_CLIENT: "mysql2",
    DB_PASSWORD: "runtime-secret"
  });
  assert.deepEqual(startedTerminal.runtimes, ["node26"]);

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

test("JSKIT managed MariaDB stop waits for the validated project pid to exit before removing the pid file", async () => {
  const targetRoot = "/workspace/jskit-managed-mariadb-stop";
  const serviceDataRoot = "/var/lib/vibe64/unit-owner/services";
  const paths = managedMariaDbServicePaths({
    serviceDataRoot
  });
  const output = [];
  const signals = [];
  const removed = [];
  let alive = true;
  let termSent = false;

  const result = await stopJskitManagedMariaDbRuntime({
    delayImpl: async () => {
      if (termSent) {
        alive = false;
      }
    },
    intervalMs: 1,
    killImpl(pid, signal) {
      assert.equal(pid, 12345);
      if (signal === 0) {
        if (alive) {
          return true;
        }
        const error = new Error("not running");
        error.code = "ESRCH";
        throw error;
      }
      signals.push(signal);
      if (signal === "SIGTERM") {
        termSent = true;
      }
      return true;
    },
    async readFileImpl(filePath) {
      if (filePath === paths.pidFile) {
        return "12345\n";
      }
      if (filePath === "/proc/12345/cmdline") {
        return `mariadbd\0--no-defaults\0--datadir=${paths.dataDir}\0--port=3307\0`;
      }
      throw new Error(`unexpected read ${filePath}`);
      },
      async rmImpl(filePath, options) {
        removed.push([filePath, options]);
      },
      serviceDataRoot,
      stdout: {
        write(value) {
          output.push(String(value));
        }
      },
    targetRoot,
    timeoutMs: 20
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "stopped");
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.deepEqual(removed, [[paths.pidFile, { force: true }]]);
  assert.match(output.join(""), /Stopped managed MariaDB pid 12345/u);
});

test("JSKIT managed MariaDB stop escalates when the process ignores SIGTERM", async () => {
  const targetRoot = "/workspace/jskit-managed-mariadb-escalate";
  const serviceDataRoot = "/var/lib/vibe64/unit-owner/services";
  const paths = managedMariaDbServicePaths({
    serviceDataRoot
  });
  const signals = [];
  let alive = true;

  const result = await stopJskitManagedMariaDbRuntime({
    delayImpl: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    intervalMs: 1,
    killImpl(pid, signal) {
      assert.equal(pid, 23456);
      if (signal === 0) {
        if (alive) {
          return true;
        }
        const error = new Error("not running");
        error.code = "ESRCH";
        throw error;
      }
      signals.push(signal);
      if (signal === "SIGKILL") {
        alive = false;
      }
      return true;
    },
    async readFileImpl(filePath) {
      if (filePath === paths.pidFile) {
        return "23456\n";
      }
      if (filePath === "/proc/23456/cmdline") {
        return `mariadbd\0--no-defaults\0--datadir=${paths.dataDir}\0`;
      }
        throw new Error(`unexpected read ${filePath}`);
      },
      async rmImpl() {},
      serviceDataRoot,
      stdout: {
        write() {}
      },
    targetRoot,
    timeoutMs: 5
  });

  assert.equal(result.ok, true);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("JSKIT managed MariaDB stop refuses a pid that is not this project's mariadbd", async () => {
  const targetRoot = "/workspace/jskit-managed-mariadb-wrong-pid";
  const serviceDataRoot = "/var/lib/vibe64/unit-owner/services";
  const paths = managedMariaDbServicePaths({
    serviceDataRoot
  });
  const signals = [];
  const removed = [];

  const result = await stopJskitManagedMariaDbRuntime({
    killImpl(pid, signal) {
      assert.equal(pid, 34567);
      if (signal === 0) {
        return true;
      }
      signals.push(signal);
      return true;
    },
    async readFileImpl(filePath) {
      if (filePath === paths.pidFile) {
        return "34567\n";
      }
      if (filePath === "/proc/34567/cmdline") {
        return "node\0server.js\0";
      }
      throw new Error(`unexpected read ${filePath}`);
      },
      async rmImpl(filePath) {
        removed.push(filePath);
      },
      serviceDataRoot,
      stdout: {
        write() {}
      },
    targetRoot,
    timeoutMs: 5
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "pid-mismatch");
  assert.deepEqual(signals, []);
  assert.deepEqual(removed, []);
});

test("JSKIT seed command defaults tenancy because seed workflow now chooses it", () => {
  const preview = scaffoldCommandPreview();
  const script = scaffoldScript();

  assert.match(preview, /npx @jskit-ai\/create-app /u);
  assert.doesNotMatch(preview, /@jskit-ai\/create-app@/u);
  assert.match(preview, /--playwright-version "\$VIBE64_PLAYWRIGHT_VERSION"/u);
  assert.match(preview, /--tenancy-mode none/u);
  assert.match(script, /--tenancy-mode none/u);
  assert.doesNotMatch(script, /--tenancy-mode single/u);
  assert.doesNotMatch(script, /--tenancy-mode multi/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("JSKIT scaffold check lets an empty target reach the seed workflow after source-contract classification", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-gitignore-"));
  const toolkit = createDoctorPluginToolkit({
    targetRoot
  });
  await writeFile(path.join(targetRoot, ".gitignore"), ".vibe64/\n", "utf8");

  const result = await checkJskitScaffold(targetRoot, {
    nonGitEntries: []
  }, toolkit);

  assert.equal(result.status, "pass");
  assert.match(result.observed, /No scaffold files/u);
  assert.match(result.explanation, /seed workflow/u);
});

test("JSKIT scaffold check allows adapter-specific node_modules clutter", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-node-modules-"));
  const toolkit = createDoctorPluginToolkit({
    targetRoot
  });
  await mkdir(path.join(targetRoot, "node_modules"), {
    recursive: true
  });

  const result = await checkJskitScaffold(targetRoot, {
    nonGitEntries: [
      "node_modules"
    ]
  }, toolkit);

  assert.equal(result.status, "pass");
  assert.match(result.observed, /No scaffold files/u);
  assert.match(result.explanation, /seed workflow/u);
});

test("JSKIT scaffold check does not re-admit broad source-tree .vibe64", async () => {
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

  assert.equal(result.status, "hard-stop");
  assert.match(result.observed, /\.vibe64/u);
  assert.match(result.explanation, /will not run/u);
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
