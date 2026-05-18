import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AiStudioSessionRuntime
} from "../../server/lib/aiStudio/index.js";
import {
  createAiStudioAdapterRegistry
} from "../../server/lib/aiStudio/adapters/registry.js";
import {
  LARAVEL_AI_STUDIO_COMMANDS,
  createLaravelLaunchDescriptor,
  createLaravelLaunchTargetTerminalSpec,
  createLaravelTargetAdapter
} from "../../server/lib/aiStudio/adapters/laravel/index.js";
import {
  LARAVEL_MARIADB_HOST_PORT,
  LARAVEL_MYSQL_HOST_PORT,
  LARAVEL_POSTGRES_HOST_PORT,
  createLaravelRuntimeContainers,
  laravelDatabaseEnvLines,
  laravelDatabaseEnvWriteScript
} from "../../server/lib/aiStudio/adapters/laravel/databaseRuntime.js";
import {
  createLaravelSetupDoctorPlugin,
  laravelNewCommand
} from "../../server/lib/aiStudio/adapters/laravel/setupDoctorPlugin.js";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "../../server/lib/aiStudio/adapters/laravel/toolchainIdentity.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createLaravelProject(root, {
  composer = {},
  packageJson = {}
} = {}) {
  await Promise.all([
    writeProjectFile(root, "composer.json", JSON.stringify({
      name: "example/laravel-app",
      require: {
        "laravel/framework": "^13.0",
        php: "^8.4",
        ...(composer.require || {})
      },
      scripts: {
        dev: "php artisan serve",
        test: "php artisan test",
        ...(composer.scripts || {})
      },
      ...composer
    }, null, 2)),
    writeProjectFile(root, "package.json", JSON.stringify({
      name: "example-laravel-app",
      scripts: {
        build: "vite build",
        dev: "vite dev",
        ...(packageJson.scripts || {})
      },
      ...packageJson
    }, null, 2)),
    writeProjectFile(root, "artisan", "#!/usr/bin/env php\n<?php\n"),
    writeProjectFile(root, "bootstrap/app.php", "<?php\n"),
    writeProjectFile(root, "public/index.php", "<?php\n"),
    writeProjectFile(root, "routes/web.php", "<?php\n")
  ]);
}

function commandIds() {
  return LARAVEL_AI_STUDIO_COMMANDS
    .map((command) => command.id)
    .sort((left, right) => left.localeCompare(right));
}

test("laravel adapter is registered as an implemented project type", async () => {
  const registry = createAiStudioAdapterRegistry();
  const projectTypes = registry.availableProjectTypes();
  const laravelProjectType = projectTypes.find((type) => type.id === "laravel");

  assert.equal(laravelProjectType.disabledReason, "");
  assert.equal(laravelProjectType.enabled, true);
  assert.equal(laravelProjectType.id, "laravel");
  assert.equal(laravelProjectType.label, "Laravel");
  assert.match(laravelProjectType.description, /PHP web application framework/u);
  assert.match(laravelProjectType.outcome, /SQLite, PostgreSQL, MySQL, or MariaDB/u);
  assert.equal(laravelProjectType.projectUrl, "https://laravel.com");
  assert.ok(laravelProjectType.techStack.includes("Laravel"));
  assert.equal((await registry.createAdapter("laravel")).id, "laravel");
});

test("laravel adapter exposes project facts, commands, defaults, and prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);
    const adapter = createLaravelTargetAdapter();

    const facts = await adapter.inspect({
      targetRoot
    });

    assert.equal(facts.summary, "Laravel project type selected.");
    assert.equal(facts.promptContext.adapter, "laravel");
    assert.equal(facts.promptContext.package_name, "example/laravel-app");
    assert.equal(facts.promptContext.frontend_package_manager, "npm");
    assert.equal(facts.promptContext.database_runtime, "sqlite");
    assert.equal(facts.promptContext.laravel_dependency, "true");
    assert.equal(facts.promptContext.valid_laravel_markers, "true");
    assert.match(facts.promptContext.environment_blueprint, /Database runtime: SQLite/u);
    assert.match(facts.promptContext.environment_blueprint, /Starter kit: none/u);
    assert.match(facts.promptContext.environment_blueprint, /Testing: Pest/u);
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
    assert.equal(facts.capabilities.create_worktree, true);
    assert.equal(facts.capabilities.run_automated_checks, true);

    const defaults = await adapter.getDefaultConfig();
    assert.equal(defaults.laravel_database_runtime, "sqlite");
    assert.equal(defaults.laravel_package_manager, "npm");
    assert.equal(defaults.laravel_starter_kit, "none");
    assert.equal(defaults.laravel_testing, "pest");
  });
});

test("laravel adapter composes prompt blueprints from independent config choices", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);
    const adapter = createLaravelTargetAdapter();

    const facts = await adapter.inspect({
      config: {
        values: {
          laravel_boost: "boost",
          laravel_database_runtime: "postgres",
          laravel_package_manager: "bun",
          laravel_starter_kit: "react",
          laravel_testing: "phpunit"
        }
      },
      targetRoot
    });

    assert.equal(facts.promptContext.database_runtime, "postgres");
    assert.equal(facts.promptContext.seed_package_manager, "bun");
    assert.equal(facts.promptContext.seed_starter_kit, "react");
    assert.match(facts.promptContext.environment_blueprint, /Database runtime: PostgreSQL/u);
    assert.match(facts.promptContext.environment_blueprint, /Starter kit: React/u);
    assert.match(facts.promptContext.environment_blueprint, /Testing: PHPUnit/u);
    assert.match(facts.promptContext.environment_blueprint, /Laravel Boost: installed/u);
  });
});

test("laravel prompt actions use the Laravel prompt pack", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: createLaravelTargetAdapter(),
      projectConfig: {
        values: {
          laravel_database_runtime: "mariadb",
          laravel_starter_kit: "livewire"
        }
      },
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_made",
      sessionId: "laravel_prompt"
    });

    const afterPrompt = await runtime.runAction("laravel_prompt", "make_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "laravel");
    assert.match(afterPrompt.actionResult.prompt, /AI Studio standard planning instructions/u);
    assert.match(afterPrompt.actionResult.prompt, /Create the implementation plan for this Laravel project/u);
    assert.match(afterPrompt.actionResult.prompt, /Database runtime: MariaDB/u);
    assert.match(afterPrompt.actionResult.prompt, /Starter kit: Livewire/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /adapter\.promptContext\.environment_blueprint/u);
    assert.match(afterPrompt.actionResult.prompt, /example\/laravel-app/u);
  });
});

test("laravel current-app scripts describe Composer and Artisan commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);
    const adapter = createLaravelTargetAdapter();

    const scripts = await adapter.listCurrentAppTargetScripts({
      targetRoot
    });
    const scriptNames = scripts.scripts.map((script) => script.name);
    assert.equal(scripts.ok, true);
    assert.ok(scriptNames.includes("dev"));
    assert.ok(scriptNames.includes("artisan:migrate"));

    const spec = await adapter.createCurrentAppTargetScriptTerminalSpec({
      input: {
        scriptId: "adapter:dev"
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "docker");
    assert.equal(spec.commandPreview, "composer run dev");
    assert.equal(spec.metadata.command, "composer run dev");
    assert.ok(spec.args({
      id: "laravel-script"
    }).includes(LARAVEL_TOOLCHAIN_IMAGE));
  });
});

test("laravel launch target describes Artisan serve and uses the Laravel toolchain", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);

    const descriptor = await createLaravelLaunchDescriptor({
      mode: "built",
      port: 4199,
      targetRoot,
      worktreePath: targetRoot
    });

    assert.deepEqual(descriptor.commands.map((command) => command.command), [
      "npm run build",
      "php artisan serve --host=0.0.0.0 --port 4199"
    ]);
    assert.equal(descriptor.metadata.mode, "built");

    const spec = await createLaravelLaunchTargetTerminalSpec({
      launchTargetId: "built",
      session: {
        metadata: {
          worktree_path: targetRoot
        },
        sessionId: "laravel_launch",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "docker");
    assert.equal(spec.metadata.adapterId, "laravel");
    assert.equal(spec.metadata.launchTargetId, "built");
    assert.match(spec.metadata.targetUrl, /^http:\/\/127\.0\.0\.1:\d+\//u);
    assert.ok(spec.args({
      id: "laravel-launch"
    }).includes(LARAVEL_TOOLCHAIN_IMAGE));
  });
});

test("laravel setup checks selected package manager inside the Laravel toolchain", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const dockerCalls = [];
    const config = {
      values: {
        laravel_package_manager: "bun"
      }
    };
    const plugin = createLaravelSetupDoctorPlugin({
      runCommand: async (command, args) => {
        dockerCalls.push({
          args,
          command
        });
        return {
          ok: true,
          output: args.includes("{{.Id}}") ? "sha256:toolchain" : "1.3.14",
          stdout: args.includes("{{.Id}}") ? "sha256:toolchain" : "1.3.14"
        };
      },
      targetRoot
    });
    const checks = plugin.checks({
      config,
      targetRoot
    });

    const toolchainResult = await checks.find((check) => check.id === "laravel-toolchain-image").run({
      config,
      targetRoot
    });
    const packageManagerResult = await checks.find((check) => check.id === "laravel-package-manager-toolchain").run({
      config,
      targetRoot
    });

    assert.equal(toolchainResult.status, "pass");
    assert.equal(packageManagerResult.status, "pass");
    assert.equal(dockerCalls[1].command, "docker");
    assert.match(dockerCalls[1].args.join(" "), /bun --version/u);
    assert.ok(dockerCalls[1].args.includes(LARAVEL_TOOLCHAIN_IMAGE));
  });
});

test("laravel setup seeds empty targets and selected database environment", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const config = {
      values: {
        laravel_boost: "none",
        laravel_database_runtime: "postgres",
        laravel_package_manager: "pnpm",
        laravel_starter_kit: "react",
        laravel_testing: "phpunit"
      }
    };
    const command = laravelNewCommand({
      config
    });

    assert.match(command, /laravel new "\$app_dir"/u);
    assert.match(command, /--no-ansi/u);
    assert.match(command, /--database=sqlite/u);
    assert.match(command, /--phpunit/u);
    assert.match(command, /--pnpm/u);
    assert.match(command, /--no-boost/u);
    assert.match(command, /--react/u);
    assert.match(laravelNewCommand({
      config: {
        values: {
          laravel_custom_starter: "acme/laravel-starter",
          laravel_starter_kit: "custom"
        }
      }
    }), /--using acme\/laravel-starter/u);
    assert.match(laravelNewCommand({
      config: {
        values: {
          laravel_starter_kit: "custom"
        }
      }
    }), /laravel_custom_starter must be set/u);
    assert.deepEqual(laravelDatabaseEnvLines({
      config,
      targetRoot
    }), [
      "DB_CONNECTION=pgsql",
      "DB_HOST=laravel-postgres",
      "DB_PORT=5432",
      `DB_DATABASE=${path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_")}`,
      "DB_USERNAME=laravel",
      "DB_PASSWORD=laravel_password"
    ]);
  });
});

test("laravel setup validates custom starter before seeding", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const plugin = createLaravelSetupDoctorPlugin({
      targetRoot
    });
    const config = {
      values: {
        laravel_starter_kit: "custom"
      }
    };
    const customStarterCheck = plugin.checks({
      config,
      targetRoot
    }).find((check) => check.id === "laravel-custom-starter");

    const result = await customStarterCheck.run({
      config,
      targetRoot
    });

    assert.equal(result.status, "fail");
    assert.match(result.observed, /laravel_custom_starter is blank/u);
  });
});

test("laravel setup provisions the selected managed database runtime", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);
    const plugin = createLaravelSetupDoctorPlugin({
      targetRoot
    });

    const mariadbConfig = {
      values: {
        laravel_database_runtime: "mariadb"
      }
    };
    const mariadbChecks = plugin.checks({
      config: mariadbConfig,
      targetRoot
    });
    assert.ok(mariadbChecks.some((check) => check.id === "laravel-mariadb"));
    assert.ok(!mariadbChecks.some((check) => check.id === "laravel-postgres"));
    assert.ok(!mariadbChecks.some((check) => check.id === "laravel-mysql"));
    assert.deepEqual(createLaravelRuntimeContainers({
      config: mariadbConfig,
      targetRoot
    })[0].ports, [
      {
        container: 3306,
        host: "127.0.0.1",
        hostPort: LARAVEL_MARIADB_HOST_PORT
      }
    ]);
    assert.deepEqual(createLaravelRuntimeContainers({
      config: {
        values: {
          laravel_database_runtime: "postgres"
        }
      },
      targetRoot
    })[0].ports, [
      {
        container: 5432,
        host: "127.0.0.1",
        hostPort: LARAVEL_POSTGRES_HOST_PORT
      }
    ]);
    assert.deepEqual(createLaravelRuntimeContainers({
      config: {
        values: {
          laravel_database_runtime: "mysql"
        }
      },
      targetRoot
    })[0].ports, [
      {
        container: 3306,
        host: "127.0.0.1",
        hostPort: LARAVEL_MYSQL_HOST_PORT
      }
    ]);

    const envCheck = mariadbChecks.find((check) => check.id === "laravel-database-env");
    const envResult = await envCheck.run({
      config: mariadbConfig,
      targetRoot
    });
    assert.equal(envResult.status, "blocked");
    assert.equal(envResult.repairs[1].actionId, "start-runtime-container-laravel-mariadb");

    const sqliteConfig = {
      values: {
        laravel_database_runtime: "sqlite"
      }
    };
    const sqliteChecks = plugin.checks({
      config: sqliteConfig,
      targetRoot
    });
    assert.ok(!sqliteChecks.some((check) => check.id === "laravel-mariadb"));
    assert.ok(!sqliteChecks.some((check) => check.id === "laravel-postgres"));
    assert.ok(!sqliteChecks.some((check) => check.id === "laravel-mysql"));
    assert.match(laravelDatabaseEnvWriteScript({
      config: sqliteConfig,
      targetRoot
    }), /touch database\/database\.sqlite/u);

    const sqliteMigrationCheck = sqliteChecks.find((check) => check.id === "laravel-database-migrations");
    const missingSqliteResult = await sqliteMigrationCheck.run({
      config: sqliteConfig,
      targetRoot
    });
    assert.equal(missingSqliteResult.status, "blocked");
    assert.equal(missingSqliteResult.repair.actionId, "terminal-seed-laravel-db-env");

    await writeProjectFile(targetRoot, "database/database.sqlite", "");
    const readySqliteResult = await sqliteMigrationCheck.run({
      config: sqliteConfig,
      targetRoot
    });
    assert.equal(readySqliteResult.status, "pass");
  });
});
