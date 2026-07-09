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
  createLaravelTargetAdapter,
  listLaravelLaunchTargets
} from "@local/vibe64-adapters/server/adapters/laravel/index";
import {
  laravelDatabaseHostPort,
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
  startupArgsPreviewOption
} from "@local/vibe64-adapters/server/launchPreviewOptions";
import { withTemporaryRoot, sourceMetadata } from "./vibe64TestHelpers.js";

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

function escapedPattern(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertNodeRuntimeCommand(command = "", innerCommand = "") {
  assert.match(command, /^bash -lc /u);
  assert.doesNotMatch(command, /\bnix --extra-experimental-features\b/u);
  assert.doesNotMatch(command, /#nodejs_22/u);
  assert.match(command, new RegExp(escapedPattern(innerCommand), "u"));
}

function assertLaravelRuntimeCommand(command = "", innerCommand = "") {
  assert.match(command, /^bash -lc /u);
  assert.doesNotMatch(command, /\bnix --extra-experimental-features\b/u);
  assert.doesNotMatch(command, /#php83/u);
  assert.doesNotMatch(command, /#php83Packages\.composer/u);
  assert.doesNotMatch(command, /#nodejs_22/u);
  assert.match(command, new RegExp(escapedPattern(innerCommand), "u"));
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
  assert.match(laravelProjectType.outcome, /SQLite, PostgreSQL or MariaDB/u);
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
    assert.equal(facts.capabilities.create_source, true);
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
      metadata: sourceMetadata(targetRoot, "laravel_prompt"),
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
      metadata: sourceMetadata(targetRoot, "laravel_seed_prompt"),
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
    assert.equal(spec.command, "bash");
    assert.equal(spec.commandPreview, "composer run dev");
    assertLaravelRuntimeCommand(spec.metadata.command, "composer run dev");
    assert.deepEqual(spec.args({
      id: "laravel-script"
    }).slice(0, 1), [
      "-lc"
    ]);
  });
});

test("laravel launch target describes Artisan serve and runs through the Vibe64 runtime", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createLaravelProject(targetRoot);

    const descriptor = await createLaravelLaunchDescriptor({
      launchInput: {
        values: {
          startupArgs: [
            "--profile",
            "preview"
          ]
        }
      },
      mode: "built",
      port: 4199,
      targetRoot,
      worktreePath: targetRoot
    });

    assertNodeRuntimeCommand(descriptor.commands[0].command, "npm run build");
    assertLaravelRuntimeCommand(descriptor.commands[1].command, "php artisan serve --host=0.0.0.0 --port 4199 --profile preview");
    assert.equal(descriptor.commands[1].commandPreview, "php artisan serve --host=0.0.0.0 --port 4199 --profile preview");
    assert.equal(descriptor.metadata.commandSource, "artisan");
    assert.equal(descriptor.metadata.mode, "built");
    assert.deepEqual(descriptor.runtimes, ["node22", "php", "composer"]);

    const launchTargets = await listLaravelLaunchTargets({
      session: {
        metadata: {
          source_path: targetRoot
        },
        targetRoot
      }
    });
    assert.deepEqual(launchTargets.find((target) => target.id === "built").previewOptions, [
      startupArgsPreviewOption()
    ]);

    const spec = await createLaravelLaunchTargetTerminalSpec({
      launchTargetId: "built",
      session: {
        metadata: {
          source_path: targetRoot
        },
        sessionId: "laravel_launch",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "bash");
    assert.equal(spec.metadata.adapterId, "laravel");
    assert.equal(spec.metadata.launchTargetId, "built");
    assert.match(spec.metadata.targetUrl, /^http:\/\/127\.0\.0\.1:\d+\//u);
    assert.deepEqual(spec.args({
      id: "laravel-launch"
    }).slice(0, 1), [
      "-lc"
    ]);
  });
});

test("laravel adapter declares Vibe64-owned runtime requirements", async () => {
  const adapter = createLaravelTargetAdapter();

  assert.deepEqual((await adapter.getRuntimeRequirements({
    config: {
      values: {
        laravel_database_runtime: "mariadb"
      }
    }
  })).map((requirement) => requirement.id), [
    "php-8.3",
    "composer",
    "nodejs-22",
    "mariadb"
  ]);

  assert.deepEqual((await adapter.getRuntimeRequirements({
    config: {
      values: {
        laravel_database_runtime: "sqlite"
      }
    }
  })).map((requirement) => requirement.id), [
    "php-8.3",
    "composer",
    "nodejs-22"
  ]);

  await assert.rejects(
    () => adapter.getRuntimeRequirements({
      config: {
        values: {
          laravel_database_runtime: "postgres"
        }
      }
    }),
    {
      code: "vibe64_runtime_requirement_unsupported"
    }
  );
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
      descriptor.metadata.serverCommand
    ]);
    assertLaravelRuntimeCommand(descriptor.metadata.serverCommand, "composer run serve -- --host=0.0.0.0 --port 4311");
    assert.deepEqual(descriptor.commands.map((command) => command.commandPreview), [
      "composer run serve -- --host=0.0.0.0 --port 4311"
    ]);
    assert.equal(descriptor.metadata.commandSource, "composer");
  });
});

test("laravel setup checks package manager and Vibe64 PHP commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const commandCalls = [];
    const config = {
      values: {}
    };
    const plugin = createLaravelSetupDoctorPlugin({
      runCommand: async (command, args, options = {}) => {
        const joinedArgs = args.join(" ");
        const commandText = [command, joinedArgs].join(" ");
        const output = commandText.includes("composer")
            ? "Composer version 2.8.0"
            : commandText.includes("php")
              ? "PHP 8.3.22"
              : commandText.includes("laravel")
                ? "Laravel Installer 5.15.0"
                : "1.3.14";
        commandCalls.push({
          args,
          command,
          runtimes: options.runtimes
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

    const packageManagerResult = await checks.find((check) => check.id === "laravel-package-manager-host-command").run({
      config,
      targetRoot
    });
    const phpResult = await checks.find((check) => check.id === "laravel-php-host-command").run({
      config,
      targetRoot
    });
    const composerResult = await checks.find((check) => check.id === "laravel-composer-host-command").run({
      config,
      targetRoot
    });
    const installerResult = await checks.find((check) => check.id === "laravel-installer-host-command").run({
      config,
      targetRoot
    });

    assert.equal(packageManagerResult.status, "pass");
    assert.equal(phpResult.status, "pass");
    assert.equal(composerResult.status, "pass");
    assert.equal(installerResult.status, "pass");
    assert.equal(commandCalls[0].command, "bash");
    assert.match(commandCalls[0].args.join(" "), /npm --version/u);
    assert.equal(commandCalls[1].command, "php");
    assert.deepEqual(commandCalls[1].args, ["--version"]);
    assert.deepEqual(commandCalls[1].runtimes, ["php"]);
    assert.equal(commandCalls[2].command, "composer");
    assert.deepEqual(commandCalls[2].args, ["--version"]);
    assert.deepEqual(commandCalls[2].runtimes, ["composer"]);
    assert.equal(commandCalls[3].command, "laravel");
    assert.deepEqual(commandCalls[3].args, [
      "--version"
    ]);
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
      "DB_HOST=127.0.0.1",
      "DB_PORT=5432",
      `DB_DATABASE=${path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_")}`,
      "DB_USERNAME=laravel",
      "DB_PASSWORD=laravel_password"
    ]);
  });
});

test("laravel setup seeds the selected host database environment", async () => {
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
    assert.ok(mariadbChecks.some((check) => check.id === "laravel-database-env"));
    assert.equal(laravelDatabaseHostPort("mariadb"), "3306");
    assert.equal(laravelDatabaseHostPort("postgres"), "5432");
    assert.equal(laravelDatabaseHostPort("mariadb"), "3306");

    const envCheck = mariadbChecks.find((check) => check.id === "laravel-database-env");
    const envResult = await envCheck.run({
      config: mariadbConfig,
      targetRoot
    });
    assert.equal(envResult.status, "blocked");
    assert.deepEqual(envResult.repairs.map((repair) => repair.actionId), [
      "terminal-seed-laravel-db-env"
    ]);

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
    assert.ok(!sqliteChecks.some((check) => check.id === "laravel-mariadb"));
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
