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
  NEXTJS_AI_STUDIO_COMMANDS,
  createNextjsLaunchDescriptor,
  createNextjsLaunchTargetTerminalSpec,
  createNextjsTargetAdapter
} from "../../server/lib/aiStudio/adapters/nextjs/index.js";
import {
  expectedNextjsDatabaseUrl,
  nextjsDatabaseEnvWriteScript
} from "../../server/lib/aiStudio/adapters/nextjs/databaseRuntime.js";
import {
  createNextAppCommand,
  createNextAppScript,
  createNextjsSetupDoctorPlugin
} from "../../server/lib/aiStudio/adapters/nextjs/setupDoctorPlugin.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createNextjsProject(root, packageJson = {}) {
  const {
    dependencies = {},
    scripts = {},
    ...packageOverrides
  } = packageJson;
  await Promise.all([
    writeProjectFile(root, "package.json", JSON.stringify({
      name: "example-nextjs-app",
      dependencies: {
        next: "^16.0.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        ...dependencies
      },
      scripts: {
        build: "next build",
        dev: "next dev",
        start: "next start",
        ...scripts
      },
      ...packageOverrides
    }, null, 2)),
    writeProjectFile(root, "app/page.jsx", "export default function Page() { return <main>Hello</main>; }\n")
  ]);
}

function commandIds() {
  return NEXTJS_AI_STUDIO_COMMANDS
    .map((command) => command.id)
    .sort((left, right) => left.localeCompare(right));
}

test("nextjs adapter is registered as an implemented project type", async () => {
  const registry = createAiStudioAdapterRegistry();
  const projectTypes = registry.availableProjectTypes();
  const nextjsProjectType = projectTypes.find((type) => type.id === "nextjs");

  assert.equal(nextjsProjectType.disabledReason, "");
  assert.equal(nextjsProjectType.enabled, true);
  assert.equal(nextjsProjectType.id, "nextjs");
  assert.equal(nextjsProjectType.label, "Next.js");
  assert.match(nextjsProjectType.description, /React framework/u);
  assert.match(nextjsProjectType.outcome, /seed or inspect/u);
  assert.equal(nextjsProjectType.projectUrl, "https://nextjs.org");
  assert.ok(nextjsProjectType.techStack.includes("React"));
  assert.equal((await registry.createAdapter("nextjs")).id, "nextjs");
});

test("nextjs adapter exposes project facts, commands, and prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createNextjsProject(targetRoot);
    const adapter = createNextjsTargetAdapter();

    const facts = await adapter.inspect({
      targetRoot
    });

    assert.equal(facts.summary, "Next.js project type selected.");
    assert.equal(facts.promptContext.adapter, "nextjs");
    assert.equal(facts.promptContext.package_name, "example-nextjs-app");
    assert.equal(facts.promptContext.router_mode, "app");
    assert.equal(facts.promptContext.package_manager, "npm");
    assert.equal(facts.promptContext.database_runtime, "postgres");
    assert.equal(facts.promptContext.data_layer, "prisma");
    assert.match(facts.promptContext.data_layer_blueprint, /Data layer: Prisma/u);
    assert.match(facts.promptContext.environment_blueprint, /Database runtime: PostgreSQL/u);
    assert.match(facts.promptContext.environment_blueprint, /Data layer: Prisma/u);
    assert.match(facts.promptContext.environment_blueprint, /Seed language: TypeScript/u);
    assert.match(facts.promptContext.environment_blueprint, /Source layout: src\/app/u);
    assert.match(facts.promptContext.environment_blueprint, /Styling: Tailwind CSS/u);
    assert.equal(facts.promptContext.next_dependency, "true");
    assert.equal(facts.promptContext.seed_language, "typescript");
    assert.equal(facts.promptContext.seed_source_layout, "src");
    assert.equal(facts.promptContext.valid_nextjs_markers, "true");
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
    assert.equal(facts.capabilities.create_worktree, true);
    assert.equal(facts.capabilities.update_code_index, true);
    assert.equal(facts.capabilities.run_automated_checks, true);

    const defaults = await adapter.getDefaultConfig();
    assert.equal(defaults.nextjs_database_runtime, "postgres");
    assert.equal(defaults.nextjs_data_layer, "prisma");
    assert.equal(defaults.nextjs_seed_language, "typescript");
    assert.equal(defaults.nextjs_seed_source_layout, "src");
    assert.equal(defaults.nextjs_seed_styling, "tailwind");
  });
});

test("nextjs adapter composes prompt blueprints from independent config choices", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createNextjsProject(targetRoot);
    const adapter = createNextjsTargetAdapter();

    const mysqlPrismaFacts = await adapter.inspect({
      config: {
        values: {
          nextjs_data_layer: "prisma",
          nextjs_database_runtime: "mysql"
        }
      },
      targetRoot
    });

    assert.equal(mysqlPrismaFacts.promptContext.database_runtime, "mysql");
    assert.equal(mysqlPrismaFacts.promptContext.data_layer, "prisma");
    assert.match(mysqlPrismaFacts.promptContext.environment_blueprint, /Database runtime: MySQL/u);
    assert.match(mysqlPrismaFacts.promptContext.environment_blueprint, /Data layer: Prisma/u);
    assert.match(mysqlPrismaFacts.promptContext.environment_blueprint, /provider as mysql/u);

    const postgresDrizzleFacts = await adapter.inspect({
      config: {
        values: {
          nextjs_data_layer: "drizzle",
          nextjs_database_runtime: "postgres",
          nextjs_seed_bundler: "webpack",
          nextjs_seed_linter: "biome",
          nextjs_seed_source_layout: "root",
          nextjs_seed_styling: "none"
        }
      },
      targetRoot
    });

    assert.equal(postgresDrizzleFacts.promptContext.database_runtime, "postgres");
    assert.equal(postgresDrizzleFacts.promptContext.data_layer, "drizzle");
    assert.match(postgresDrizzleFacts.promptContext.environment_blueprint, /Database runtime: PostgreSQL/u);
    assert.match(postgresDrizzleFacts.promptContext.environment_blueprint, /Data layer: Drizzle/u);
    assert.match(postgresDrizzleFacts.promptContext.environment_blueprint, /PostgreSQL dialect/u);
    assert.match(postgresDrizzleFacts.promptContext.environment_blueprint, /Bundler: Webpack/u);
    assert.match(postgresDrizzleFacts.promptContext.environment_blueprint, /Linter: Biome/u);
    assert.match(postgresDrizzleFacts.promptContext.environment_blueprint, /Source layout: root app/u);
    assert.match(postgresDrizzleFacts.promptContext.environment_blueprint, /Styling: none/u);
  });
});

test("nextjs prompt actions use the Next.js prompt pack", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createNextjsProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: createNextjsTargetAdapter(),
      projectConfig: {
        values: {
          nextjs_database_runtime: "postgres"
        }
      },
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_made",
      sessionId: "nextjs_prompt"
    });

    const afterPrompt = await runtime.runAction("nextjs_prompt", "make_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "nextjs");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.promptContext.database_runtime, "postgres");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.promptContext.data_layer, "prisma");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].label, "Next.js PostgreSQL");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].client, "psql");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.host, "$PGHOST");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.password, "$PGPASSWORD");
    assert.match(afterPrompt.actionResult.prompt, /Create the implementation plan for this Next\.js project/u);
    assert.match(afterPrompt.actionResult.prompt, /nextjs_database_runtime/u);
    assert.match(afterPrompt.actionResult.prompt, /DATABASE_URL/u);
    assert.match(afterPrompt.actionResult.prompt, /Managed services/u);
    assert.match(afterPrompt.actionResult.prompt, /Next\.js PostgreSQL/u);
    assert.match(afterPrompt.actionResult.prompt, /psql --host/u);
    assert.match(afterPrompt.actionResult.prompt, /--command/u);
    assert.match(afterPrompt.actionResult.prompt, /<SQL>/u);
    assert.match(afterPrompt.actionResult.prompt, /PGHOST/u);
    assert.match(afterPrompt.actionResult.prompt, /PGPASSWORD/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not inspect Docker/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /Managed runtime containers/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /containerName/u);
    assert.match(afterPrompt.actionResult.prompt, /ask concise questions before planning or implementing/u);
    assert.match(afterPrompt.actionResult.prompt, /Next\.js selected blueprint:\nDatabase runtime: PostgreSQL/u);
    assert.match(afterPrompt.actionResult.prompt, /Data layer: Prisma/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /adapter\.promptContext\.environment_blueprint/u);
    assert.match(afterPrompt.actionResult.prompt, /example-nextjs-app/u);
  });
});

test("nextjs current-app scripts describe commands while Studio owns terminal execution", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createNextjsProject(targetRoot);
    const adapter = createNextjsTargetAdapter();

    const scripts = await adapter.listCurrentAppTargetScripts({
      targetRoot
    });
    const scriptNames = scripts.scripts.map((script) => script.name);
    assert.equal(scripts.ok, true);
    assert.ok(scriptNames.includes("build"));
    assert.ok(scriptNames.includes("next:build"));
    assert.ok(scriptNames.includes("next:dev"));

    const spec = await adapter.createCurrentAppTargetScriptTerminalSpec({
      input: {
        scriptId: "adapter:next:build"
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "docker");
    assert.equal(spec.commandPreview, "npx --no-install next build");
    assert.equal(spec.metadata.command, "npx --no-install next build");
    assert.equal(spec.metadata.packageManager, "npm");
  });
});

test("nextjs launch target describes Next.js commands and uses the shared terminal", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createNextjsProject(targetRoot);

    const descriptor = await createNextjsLaunchDescriptor({
      mode: "production",
      port: 4199,
      targetRoot,
      worktreePath: targetRoot
    });

    assert.deepEqual(descriptor.commands.map((command) => command.command), [
      "npm run build",
      "npm run start -- -H 0.0.0.0 -p 4199"
    ]);
    assert.equal(descriptor.metadata.mode, "production");

    const spec = await createNextjsLaunchTargetTerminalSpec({
      launchTargetId: "built",
      session: {
        metadata: {
          worktree_path: targetRoot
        },
        sessionId: "nextjs_review",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "docker");
    assert.equal(spec.metadata.adapterId, "nextjs");
    assert.equal(spec.metadata.launchTargetId, "built");
    assert.equal(spec.metadata.mode, "production");
    assert.match(spec.metadata.targetUrl, /^http:\/\/127\.0\.0\.1:\d+\//u);
  });
});

test("nextjs setup plugin seeds empty targets without overwriting existing app files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const plugin = createNextjsSetupDoctorPlugin({
      targetRoot
    });
    const packageCheck = plugin.checks({
      config: {
        values: {
          nextjs_package_manager: "pnpm"
        }
      },
      targetRoot
    }).find((check) => check.id === "nextjs-package-json");

    const emptyResult = await packageCheck.run({
      targetRoot
    });
    assert.equal(emptyResult.status, "blocked");
    assert.equal(emptyResult.repair.actionId, "terminal-create-next-app");
    assert.match(emptyResult.repair.commandPreview, /corepack pnpm create next-app/u);
    assert.match(emptyResult.repair.commandPreview, /--use-pnpm/u);

    await writeProjectFile(targetRoot, "README.md", "Existing app file.\n");
    const occupiedPackageCheck = plugin.checks({
      nonGitEntries: [
        "README.md"
      ],
      targetRoot
    }).find((check) => check.id === "nextjs-package-json");
    const occupiedResult = await occupiedPackageCheck.run({
      nonGitEntries: [
        "README.md"
      ],
      targetRoot
    });
    assert.equal(occupiedResult.status, "hard-stop");
    assert.equal(occupiedResult.repair, null);
  });
});

test("nextjs setup checks the selected package manager in the managed toolchain", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const dockerCalls = [];
    const config = {
      values: {
        nextjs_package_manager: "bun"
      }
    };
    const plugin = createNextjsSetupDoctorPlugin({
      runCommand: async (command, args) => {
        dockerCalls.push({
          args,
          command
        });
        return {
          ok: true,
          output: "1.3.14"
        };
      },
      targetRoot
    });
    const checks = plugin.checks({
      config,
      targetRoot
    });
    const packageManagerToolchainCheck = checks.find((check) => check.id === "nextjs-package-manager-toolchain");

    assert.ok(packageManagerToolchainCheck);
    assert.ok(checks.findIndex((check) => check.id === "nextjs-package-manager-toolchain") < checks.findIndex((check) => check.id === "nextjs-package-json"));

    const result = await packageManagerToolchainCheck.run({
      config,
      targetRoot
    });

    assert.equal(result.status, "pass");
    assert.equal(dockerCalls[0].command, "docker");
    assert.match(dockerCalls[0].args.join(" "), /bun --version/u);
  });
});

test("nextjs create-next-app setup script expands the generated app directory variable", () => {
  const command = createNextAppCommand({
    config: {
      values: {
        nextjs_package_manager: "npm"
      }
    }
  });
  const script = createNextAppScript({
    values: {
      nextjs_package_manager: "npm"
    }
  });

  assert.match(command, /npx --yes create-next-app@latest "\$app_dir"/u);
  assert.doesNotMatch(command, /'\$app_dir'/u);
  assert.match(command, /--reset-preferences/u);
  assert.match(command, /--typescript/u);
  assert.match(command, /--tailwind/u);
  assert.match(command, /--eslint/u);
  assert.match(command, /--src-dir/u);
  assert.match(command, /--turbopack/u);
  assert.match(script, /app_dir="\$tmp_dir\/app"/u);
  assert.match(script, /cp -a "\$app_dir\/\." \./u);
});

test("nextjs create-next-app setup script reflects seed options and selected database", () => {
  const config = {
    values: {
      nextjs_database_runtime: "postgres",
      nextjs_package_manager: "bun",
      nextjs_seed_bundler: "webpack",
      nextjs_seed_import_alias: "~/*",
      nextjs_seed_language: "javascript",
      nextjs_seed_linter: "biome",
      nextjs_seed_source_layout: "root",
      nextjs_seed_styling: "none"
    }
  };
  const command = createNextAppCommand({
    config
  });
  const script = createNextAppScript(config, {
    targetRoot: "/tmp/example-next-app"
  });

  assert.match(command, /bunx create-next-app@latest "\$app_dir"/u);
  assert.match(command, /--javascript/u);
  assert.match(command, /--no-tailwind/u);
  assert.match(command, /--biome/u);
  assert.match(command, /--no-src-dir/u);
  assert.match(command, /--webpack/u);
  assert.match(command, /'~\/\*'/u);
  assert.match(command, /--use-bun/u);
  assert.match(script, /DATABASE_URL=postgresql:\/\/nextjs:nextjs_password@nextjs-postgres:5432\/example_next_app/u);
});

test("nextjs adapter declares optional managed database runtime without owning orchestration", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createNextjsProject(targetRoot);
    const config = {
      values: {
        nextjs_database_runtime: "postgres"
      }
    };
    const plugin = createNextjsSetupDoctorPlugin({
      targetRoot
    });
    const dbCheck = plugin.checks({
      config,
      targetRoot
    }).find((check) => check.id === "nextjs-database-env");

    const result = await dbCheck.run({
      config,
      targetRoot
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.repair.actionId, "terminal-seed-nextjs-db-env");
    assert.equal(result.repairs[1].actionId, "start-runtime-container-nextjs-postgres");
    assert.equal(
      expectedNextjsDatabaseUrl("postgres", targetRoot),
      `postgresql://nextjs:nextjs_password@nextjs-postgres:5432/${path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_")}`
    );
  });
});

test("nextjs setup provisions the selected managed database runtime", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createNextjsProject(targetRoot);
    const plugin = createNextjsSetupDoctorPlugin({
      targetRoot
    });

    const mysqlConfig = {
      values: {
        nextjs_database_runtime: "mysql"
      }
    };
    const mysqlChecks = plugin.checks({
      config: mysqlConfig,
      targetRoot
    });
    assert.ok(mysqlChecks.some((check) => check.id === "nextjs-mysql"));
    assert.ok(!mysqlChecks.some((check) => check.id === "nextjs-postgres"));

    const mysqlEnvCheck = mysqlChecks.find((check) => check.id === "nextjs-database-env");
    const mysqlEnvResult = await mysqlEnvCheck.run({
      config: mysqlConfig,
      targetRoot
    });
    assert.equal(mysqlEnvResult.status, "blocked");
    assert.equal(mysqlEnvResult.repairs[1].actionId, "start-runtime-container-nextjs-mysql");
    assert.equal(
      expectedNextjsDatabaseUrl("mysql", targetRoot),
      `mysql://root:nextjs_root_password@nextjs-mysql:3306/${path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_")}`
    );

    const noneConfig = {
      values: {
        nextjs_database_runtime: "none"
      }
    };
    const noneChecks = plugin.checks({
      config: noneConfig,
      targetRoot
    });
    assert.ok(!noneChecks.some((check) => check.id === "nextjs-mysql"));
    assert.ok(!noneChecks.some((check) => check.id === "nextjs-postgres"));
    assert.equal(
      nextjsDatabaseEnvWriteScript({
        config: noneConfig,
        targetRoot
      }).includes("DATABASE_URL="),
      false
    );
  });
});
