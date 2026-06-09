import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_WORKFLOW_DEFINITION_IDS,
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  createVibe64AdapterRegistry
} from "@local/vibe64-adapters/server/adapters/registry";
import {
  LARAVEL_VIBE64_COMMANDS,
  createLaravelLaunchDescriptor,
  createLaravelLaunchTargetTerminalSpec,
  createLaravelTargetAdapter
} from "@local/vibe64-adapters/server/adapters/laravel/index";
import {
  LARAVEL_MARIADB_HOST_PORT,
  LARAVEL_MYSQL_HOST_PORT,
  LARAVEL_POSTGRES_HOST_PORT,
  createLaravelRuntimeContainers,
  laravelDatabaseEnvLines,
  laravelDatabaseEnvWriteScript
} from "@local/vibe64-adapters/server/adapters/laravel/databaseRuntime";
import {
  readComposerJson
} from "@local/vibe64-adapters/server/adapters/laravel/composerPackage";
import {
  createLaravelSetupDoctorPlugin,
  laravelNewCommand
} from "@local/vibe64-adapters/server/adapters/laravel/setupDoctorPlugin";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "@local/vibe64-adapters/server/adapters/laravel/toolchainIdentity";
import { withTemporaryRoot, worktreeMetadata } from "./vibe64TestHelpers.js";

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
  return LARAVEL_VIBE64_COMMANDS
    .map((command) => command.id)
    .sort((left, right) => left.localeCompare(right));
}

test("laravel adapter is registered as an implemented project type", async () => {
  const registry = createVibe64AdapterRegistry();
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
    const promptContext = await adapter.getPromptContext({
      targetRoot
    });

    assert.equal(facts.summary, "Laravel project type selected.");
    assert.equal(Object.hasOwn(facts, "promptContext"), false);
    assert.equal(promptContext.adapter, "laravel");
    assert.equal(promptContext.package_name, "example/laravel-app");
    assert.equal(promptContext.frontend_package_manager, "npm");
    assert.equal(promptContext.database_runtime, "sqlite");
    assert.equal(promptContext.laravel_dependency, "true");
    assert.equal(promptContext.valid_laravel_markers, "true");
    assert.match(promptContext.environment_blueprint, /Database runtime: SQLite/u);
    assert.match(promptContext.environment_blueprint, /chosen in the seed workflow/u);
    assert.match(promptContext.seed_issue_guidance, /starter kit/u);
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
    assert.equal(facts.capabilities.create_worktree, true);
    assert.equal(facts.capabilities.update_code_index, true);
    assert.equal(facts.capabilities.run_automated_checks, true);

    const defaults = await adapter.getDefaultConfig();
    assert.equal(defaults.laravel_database_runtime, "sqlite");
    assert.deepEqual(Object.keys(defaults), ["laravel_database_runtime"]);
  });
});

test("laravel adapter keeps seed choices in prompt guidance instead of setup config", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);
    const adapter = createLaravelTargetAdapter();

    const promptContext = await adapter.getPromptContext({
      config: {
        values: {
          laravel_database_runtime: "postgres"
        }
      },
      targetRoot
    });

    assert.equal(promptContext.database_runtime, "postgres");
    assert.match(promptContext.environment_blueprint, /Database runtime: PostgreSQL/u);
    assert.match(promptContext.environment_blueprint, /Ask the user during seed issue definition/u);
    assert.match(promptContext.seed_issue_guidance, /authentication provider/u);
    assert.match(promptContext.seed_issue_guidance, /fake local dev service keys/u);
  });
});

test("laravel adapter reports malformed composer.json instead of hiding it", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);
    await writeProjectFile(targetRoot, "composer.json", "{ not json\n");
    const adapter = createLaravelTargetAdapter();

    await assert.rejects(
      () => adapter.inspect({
        targetRoot
      }),
      {
        code: "vibe64_invalid_laravel_composer_json"
      }
    );
  });
});

test("laravel composer reader preserves filesystem read errors", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, "composer.json"));

    await assert.rejects(
      () => readComposerJson(targetRoot),
      {
        code: "EISDIR"
      }
    );
  });
});

test("laravel prompt actions use the Laravel prompt pack", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createLaravelTargetAdapter(),
      projectConfig: {
        values: {
          laravel_database_runtime: "mariadb"
        }
      },
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: worktreeMetadata(targetRoot, "laravel_prompt"),
      sessionId: "laravel_prompt"
    });

    const afterPrompt = await runtime.runAction("laravel_prompt", "make_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "laravel");
    assert.match(afterPrompt.actionResult.prompt, /Vibe64 standard planning instructions/u);
    assert.match(afterPrompt.actionResult.prompt, /Create the implementation plan for this Laravel project/u);
    assert.match(afterPrompt.actionResult.prompt, /Database runtime: MariaDB/u);
    assert.match(afterPrompt.actionResult.prompt, /chosen in the seed workflow/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /\{\{adapter\.promptContext\.environment_blueprint\}\}/u);
    assert.match(afterPrompt.actionResult.prompt, /example\/laravel-app/u);
  });
});

test("laravel seed issue definition uses the current-step input contract before issue creation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: createLaravelTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "seed_application_defined",
      metadata: worktreeMetadata(targetRoot, "laravel_seed_prompt"),
      sessionId: "laravel_seed_prompt",
      workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
    });

    const initialSession = await runtime.getSession("laravel_seed_prompt");

    assert.equal(initialSession.currentStep, "seed_application_defined");
    assert.equal(initialSession.stepMachine.status, "waiting_for_input");
    assert.equal(initialSession.currentStepDefinition.interaction.kind, "conversation");
    assert.equal(initialSession.currentStepDefinition.interaction.actionId, "define_seed_application");

    const afterPrompt = await runtime.runAction("laravel_seed_prompt", "define_seed_application", {
      conversationRequest: "Ask me the Laravel setup choices you need."
    });

    assert.equal(afterPrompt.stepMachine.status, "awaiting_agent_result");
    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptId, "define_seed_application");
    assert.match(afterPrompt.actionResult.prompt, /defining the initial seed work/u);
    assert.match(afterPrompt.actionResult.prompt, /Laravel seed guidance/u);
    assert.match(afterPrompt.actionResult.prompt, /starter kit/u);
    assert.match(afterPrompt.actionResult.prompt, /Ask one simple question at a time/u);
    assert.match(afterPrompt.actionResult.prompt, /normal app owner/u);
    assert.match(afterPrompt.actionResult.prompt, /what the answer changes in the app/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not make the user choose from framework module names/u);
    assert.match(afterPrompt.actionResult.prompt, /Vibe64 agent result contract/u);

    const afterInput = await runtime.submitCurrentStepInput("laravel_seed_prompt", {
      fields: {
        body: "Seed the Laravel app foundation.",
        title: "Seed Laravel application foundation",
        word: "seed"
      },
      kind: "ready",
      source: "codex",
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    });

    assert.equal(afterInput.stepMachine.status, "confirm_files");
    assert.equal(afterInput.next.enabled, true);
    assert.equal(await runtime.store.readArtifact("laravel_seed_prompt", "issue_title"), "Seed Laravel application foundation\n");
    assert.equal(await runtime.store.readArtifact("laravel_seed_prompt", "issue_word"), "seed\n");
    assert.equal(await runtime.store.readArtifact("laravel_seed_prompt", "issue.md"), "Seed the Laravel app foundation.\n");
    assert.equal(await runtime.store.readArtifact("laravel_seed_prompt", "work_title"), "Seed Laravel application foundation\n");
    assert.equal(await runtime.store.readArtifact("laravel_seed_prompt", "work_word"), "seed\n");
    assert.equal(await runtime.store.readArtifact("laravel_seed_prompt", "work.md"), "Seed the Laravel app foundation.\n");
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
    assert.equal(descriptor.metadata.commandSource, "artisan");
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

test("laravel launch target passes Vibe64 port through Composer serve scripts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot, {
      composer: {
        scripts: {
          serve: "php artisan serve"
        }
      }
    });

    const descriptor = await createLaravelLaunchDescriptor({
      mode: "serve",
      port: 4311,
      targetRoot,
      worktreePath: targetRoot
    });

    assert.deepEqual(descriptor.commands.map((command) => command.command), [
      "composer run serve -- --host=0.0.0.0 --port 4311"
    ]);
    assert.equal(descriptor.metadata.commandSource, "composer");
  });
});

test("laravel setup checks npm inside the Laravel toolchain", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const dockerCalls = [];
    const config = {
      values: {}
    };
    const plugin = createLaravelSetupDoctorPlugin({
      runCommand: async (command, args) => {
        const joinedArgs = args.join(" ");
        const output = args.includes("{{.Id}}")
          ? "sha256:toolchain"
          : joinedArgs.includes("php --version")
            ? "PHP 8.4.1"
            : joinedArgs.includes("composer --version")
              ? "Composer version 2.8.0"
              : joinedArgs.includes("laravel --version")
                ? "Laravel Installer 5.15.0"
                : "1.3.14";
        dockerCalls.push({
          args,
          command
        });
        return {
          ok: true,
          output,
          stdout: output
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
    const phpResult = await checks.find((check) => check.id === "laravel-php-toolchain").run({
      config,
      targetRoot
    });
    const composerResult = await checks.find((check) => check.id === "laravel-composer-toolchain").run({
      config,
      targetRoot
    });
    const installerResult = await checks.find((check) => check.id === "laravel-installer-toolchain").run({
      config,
      targetRoot
    });

    assert.equal(toolchainResult.status, "pass");
    assert.equal(packageManagerResult.status, "pass");
    assert.equal(phpResult.status, "pass");
    assert.equal(composerResult.status, "pass");
    assert.equal(installerResult.status, "pass");
    assert.equal(dockerCalls[1].command, "docker");
    assert.match(dockerCalls[1].args.join(" "), /npm --version/u);
    assert.ok(dockerCalls[1].args.includes(LARAVEL_TOOLCHAIN_IMAGE));
    assert.match(dockerCalls[2].args.join(" "), /php --version/u);
    assert.match(dockerCalls[3].args.join(" "), /composer --version/u);
    assert.match(dockerCalls[4].args.join(" "), /laravel --version/u);
  });
});

test("laravel setup leaves empty targets for the seed workflow and can still describe a basic installer command", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const config = {
      values: {
        laravel_database_runtime: "postgres"
      }
    };
    const command = laravelNewCommand({
      config
    });

    assert.match(command, /laravel new "\$app_dir"/u);
    assert.match(command, /--no-ansi/u);
    assert.match(command, /--database=sqlite/u);
    assert.match(command, /--pest/u);
    assert.match(command, /--npm/u);
    assert.match(command, /--no-boost/u);
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
