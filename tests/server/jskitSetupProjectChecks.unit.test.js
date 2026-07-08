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
  jskitManagedMysqlServiceMetadata,
  jskitManagedMysqlServicePaths,
  jskitManagedMysqlServiceSecrets,
  jskitManagedMysqlRuntimeRoot,
  jskitManagedMysqlStartScript,
  stopJskitManagedMysqlRuntime
} from "@local/vibe64-adapters/server/adapters/jskit/setupMariaDbRuntime";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

function assertShellScriptSurvivesWhitespaceCollapse(script) {
  const flattened = script.replace(/\s+/gu, " ");
  const result = spawnSync("bash", ["-n", "-c", flattened], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || flattened);
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
    serviceDataRoot,
    targetRoot,
    toolkit
  });
  const actionIds = actions.map((action) => action.actionId);

  assert.deepEqual(actionIds, [
    "terminal-npm-install",
    "terminal-materialize-jskit-runtime-config",
    "terminal-start-managed-mysql",
    "terminal-create-app-db"
  ]);
  assert.equal(actionIds.includes("terminal-seed-jskit-db-env"), false);
  assert.equal(actionIds.includes("terminal-use-managed-jskit-db-env"), false);

  const startAction = actions.find((action) => action.actionId === "terminal-start-managed-mysql");
  await startAction.start({
    targetRoot
  });
  assert.equal(startedTerminal.command, "nix");
  assert.ok(startedTerminal.args.includes("shell"));
  assert.ok(startedTerminal.args.some((arg) => arg.includes("#mysql80")));
  assert.match(startedTerminal.commandPreview, new RegExp(jskitMariaDbHostPort(targetRoot, {
    serviceDataRoot
  }), "u"));
  assert.equal(jskitManagedMysqlRuntimeRoot({
    serviceDataRoot
  }), path.join(serviceDataRoot, "mysql-8.0"));
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
  const startScript = jskitManagedMysqlStartScript({
    serviceDataRoot,
    targetRoot
  });
  const tenantGrantPattern = jskitMariaDbTenantDatabaseGrantPattern(targetRoot, {
    serviceDataRoot
  });
  assert.match(startScript, /mysqld --no-defaults --initialize-insecure/u);
  assert.match(startScript, /mariadb-install-db --no-defaults/u);
  assert.match(startScript, /mysql_install_db --no-defaults/u);
  assert.match(startScript, /mysql_server_supports_option '--mysqlx'/u);
  assert.match(startScript, /mysql_server_supports_option '--daemonize'/u);
  assert.match(startScript, /mysqld "\$\{mysql_start_args\[@\]\}" >\/dev\/null 2>&1 &/u);
  assert.match(startScript, /mysql --no-defaults --protocol=TCP/u);
  assert.match(startScript, new RegExp(`CREATE USER IF NOT EXISTS .*${escapedPattern(JSKIT_MARIADB_APP_USER)}.*localhost`, "u"));
  assert.match(startScript, new RegExp(`GRANT ALL PRIVILEGES ON \`${escapedPattern(tenantGrantPattern)}\`\\.\\* TO .*${escapedPattern(JSKIT_MARIADB_APP_USER)}.*localhost`, "u"));
  assert.match(startScript, /metadata_file="\$runtime_root\/metadata\.json"/u);
  assert.match(startScript, /secrets_file="\$runtime_root\/secrets\.json"/u);
  assert.match(startScript, /cd "\$runtime_root"/u);
  assert.match(startScript, /chmod 600 "\$metadata_file" "\$secrets_file"/u);
  assert.equal(defaultDatabaseEnv(targetRoot, {
    serviceDataRoot
  }).DB_USER, JSKIT_MARIADB_APP_USER);
  assert.equal(defaultDatabaseEnv(targetRoot, {
    serviceDataRoot
  }).DB_PASSWORD, jskitMariaDbAppPassword(targetRoot, {
    serviceDataRoot
  }));

  const servicePaths = jskitManagedMysqlServicePaths(targetRoot, {
    serviceDataRoot
  });
  assert.equal(servicePaths.metadataFile, path.join(jskitManagedMysqlRuntimeRoot({
    serviceDataRoot
  }), "metadata.json"));
  assert.equal(servicePaths.secretsFile, path.join(jskitManagedMysqlRuntimeRoot({
    serviceDataRoot
  }), "secrets.json"));
  const metadata = jskitManagedMysqlServiceMetadata({
    databaseName: "app_db",
    recordedAt: "2026-07-06T00:00:00.000Z",
    serviceDataRoot,
    status: "running",
    targetRoot
  });
  assert.equal(metadata.schema, "vibe64.jskit-managed-mysql-service");
  assert.equal(metadata.service.catalogEntryId, "mysql-8.0");
  assert.equal(metadata.connection.port, jskitMariaDbHostPort(targetRoot, {
    serviceDataRoot
  }));
  assert.equal(metadata.database.name, "app_db");
  assert.equal(metadata.status, "running");
  assert.deepEqual(Object.keys(metadata).includes("admin"), false);
  assert.doesNotMatch(JSON.stringify(metadata), /vibe64_jskit_root|DB_PASSWORD/u);
  const secrets = jskitManagedMysqlServiceSecrets({
    databaseName: "app_db",
    serviceDataRoot,
    targetRoot
  });
  assert.equal(secrets.admin.username, "root");
  assert.equal(secrets.app.username, JSKIT_MARIADB_APP_USER);
  assert.equal(secrets.app.password, jskitMariaDbAppPassword(targetRoot, {
    serviceDataRoot
  }));

  const createDatabaseAction = actions.find((action) => action.actionId === "terminal-create-app-db");
  await createDatabaseAction.start({
    input: {
      databaseName: "second_app_db"
    },
    targetRoot
  });
  assert.equal(startedTerminal.command, "nix");
  assert.match(startedTerminal.commandPreview, new RegExp(`grant tenant development databases .*second_app_db.* to ${escapedPattern(JSKIT_MARIADB_APP_USER)}`, "u"));
  assert.ok(startedTerminal.args.some((arg) => String(arg).includes("second_app_db")));

  await actions.find((action) => action.actionId === "terminal-npm-install").start({
    targetRoot
  });
  assert.equal(startedTerminal.command, "bash");
  assert.deepEqual(startedTerminal.env, {
    DB_CLIENT: "mysql2",
    DB_PASSWORD: "runtime-secret"
  });

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

test("JSKIT managed MySQL stop waits for the validated project pid to exit before removing the pid file", async () => {
  const targetRoot = "/workspace/jskit-managed-mysql-stop";
  const serviceDataRoot = "/var/lib/vibe64/unit-owner/services";
  const paths = jskitManagedMysqlServicePaths(targetRoot, {
    serviceDataRoot
  });
  const output = [];
  const signals = [];
  const removed = [];
  let alive = true;
  let termSent = false;

  const result = await stopJskitManagedMysqlRuntime({
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
        return `mysqld\0--no-defaults\0--datadir=${paths.dataDir}\0--port=3307\0`;
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
  assert.match(output.join(""), /Stopped managed MySQL pid 12345/u);
});

test("JSKIT managed MySQL stop escalates when the process ignores SIGTERM", async () => {
  const targetRoot = "/workspace/jskit-managed-mysql-escalate";
  const serviceDataRoot = "/var/lib/vibe64/unit-owner/services";
  const paths = jskitManagedMysqlServicePaths(targetRoot, {
    serviceDataRoot
  });
  const signals = [];
  let alive = true;

  const result = await stopJskitManagedMysqlRuntime({
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
        return `mysqld\0--no-defaults\0--datadir=${paths.dataDir}\0`;
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

test("JSKIT managed MySQL stop refuses a pid that is not this project's mysqld", async () => {
  const targetRoot = "/workspace/jskit-managed-mysql-wrong-pid";
  const serviceDataRoot = "/var/lib/vibe64/unit-owner/services";
  const paths = jskitManagedMysqlServicePaths(targetRoot, {
    serviceDataRoot
  });
  const signals = [];
  const removed = [];

  const result = await stopJskitManagedMysqlRuntime({
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
