import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  runtimeRequirement
} from "@local/vibe64-core/server/runtimeToolchain";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  PUBLISH_RELEASE_PORT_ENV,
  deploymentDatabaseNotRequiredService,
  deploymentEnvironmentResult,
  deploymentManagedDatabaseService,
  deploymentPublishPlanFromLaunchDescriptor,
  managedDatabaseEnvironmentEntry,
  publishRootMissingPlan,
  relationalDatabaseDeploymentRequirement
} from "../../deployment.js";
import {
  deploymentRelationalDatabaseConnection,
  relationalDatabaseConnectionEnvironment
} from "../../managedDatabases/deployment.js";
import {
  Vibe64DescribedWorkflowTargetAdapter,
  inspectDescribedProject,
  inspectProjectSourceMarkers
} from "../../workflowAdapter.js";
import {
  nodePackageManagerInspectionExtra,
  studioCommandScript
} from "../../nodeWebProject.js";
import {
  VIBE64_CODE_INDEX_SCRIPT_NAME,
  VIBE64_VERIFY_SCRIPT_NAME,
  DEFAULT_CODE_INDEX_RELATIVE_PATH,
  packageManagerScriptCommand,
  phpCodeIndexCommand
} from "../../codeIndexCommands.js";
import {
  detectPackageManager,
  installCommand,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  composerDependencyNames,
  composerProjectName,
  composerRunCommand,
  composerScript,
  composerScriptNames,
  hasComposerDependency,
  laravelRuntimeCommand,
  phpArtisanCommand,
  parseComposerJson,
  readComposerJson
} from "./composerPackage.js";
import {
  LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH
} from "./constants.js";
import {
  LARAVEL_CONFIG_FIELDS,
  LARAVEL_DEFAULT_CONFIG,
  selectedLaravelPackageManager as selectedPackageManager
} from "./config.js";
import {
  createLaravelTargetScriptTerminalSpec,
  inspectLaravelCurrentApp,
  inspectLaravelTargetScripts
} from "./currentApp.js";
import {
  laravelDatabaseNameFromTargetRoot,
  laravelDatabasePromptServiceFacts,
  listLaravelDatabaseProjectTools,
  selectedLaravelDatabaseRuntime
} from "./databaseRuntime.js";
import {
  createLaravelLaunchDescriptor
} from "./launchTargets.js";
import {
  createLaravelSetupDoctorPlugin
} from "./setupDoctorPlugin.js";

const LARAVEL_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));
const LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH = fileURLToPath(new URL("./prepareWorktree.sh", import.meta.url));

const LARAVEL_MARKERS = deepFreeze([
  {
    id: "composer_json",
    label: "composer.json",
    relativePath: "composer.json"
  },
  {
    id: "artisan",
    label: "artisan",
    relativePath: "artisan"
  },
  {
    id: "bootstrap_app",
    label: "bootstrap/app.php",
    relativePath: "bootstrap/app.php"
  },
  {
    id: "routes_web",
    label: "routes/web.php",
    relativePath: "routes/web.php"
  },
  {
    id: "routes_api",
    label: "routes/api.php",
    relativePath: "routes/api.php"
  },
  {
    id: "public_index",
    label: "public/index.php",
    relativePath: "public/index.php"
  },
  {
    id: "vite_config",
    label: "vite.config.js",
    relativePath: "vite.config.js"
  },
  {
    id: "package_json",
    label: "package.json",
    relativePath: "package.json"
  }
]);

function laravelEnvironmentBlueprint(config = {}) {
  const databaseRuntime = selectedLaravelDatabaseRuntime(config);
  const databaseLabel = {
    mariadb: "MariaDB",
    postgres: "PostgreSQL",
    sqlite: "SQLite"
  }[databaseRuntime] || databaseRuntime;
  return [
    `Database runtime: ${databaseLabel}.`,
    "Laravel starter kit, authentication, teams, testing, Boost, frontend stack, and local development keys are chosen in the seed workflow.",
    "Do not infer missing seed choices from setup config. Ask the user during seed issue definition."
  ].join("\n");
}

function packageHasLaravel(composerJson = {}) {
  return hasComposerDependency(composerJson, "laravel/framework") ||
    Object.values(composerJson?.scripts || {}).some((script) => /\bartisan\b/u.test(String(script || "")));
}

function markerExists(markers = [], id = "") {
  return markers.some((marker) => marker.id === id && marker.exists);
}

function allMarkersReady({
  composerJson = null,
  markers = []
} = {}) {
  return Boolean(composerJson) &&
    markerExists(markers, "artisan") &&
    markerExists(markers, "bootstrap_app") &&
    packageHasLaravel(composerJson || {});
}

function setupSummary({
  composerJson = null,
  markers = []
} = {}) {
  if (allMarkersReady({
    composerJson,
    markers
  })) {
    return "Laravel project type selected.";
  }
  return "Laravel project type selected. Missing markers or Laravel dependency.";
}

const LARAVEL_PUBLISH_MIGRATION_ARGS = Object.freeze([
  "migrate",
  "--force",
  "--no-interaction",
  "--no-ansi"
]);

function laravelDatabaseRuntimeIsManaged(runtime = "") {
  return ["mariadb", "postgres"].includes(String(runtime || "").trim());
}

function laravelDatabaseRuntimeLabel(runtime = "") {
  return {
    mariadb: "MariaDB",
    postgres: "PostgreSQL"
  }[String(runtime || "").trim()] || "managed";
}

async function laravelDeploymentDatabaseEntries({
  config = {},
  context = {},
  deployment = {},
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const provider = selectedLaravelDatabaseRuntime(config);
  const connection = await deploymentRelationalDatabaseConnection({
    databaseName: normalizeText(deployment.databaseName) || laravelDatabaseNameFromTargetRoot(targetRoot),
    deployment,
    provider,
    serviceDataRoot: normalizeText(serviceDataRoot || context.serviceDataRoot),
    targetRoot
  });
  const values = {
    ...relationalDatabaseConnectionEnvironment(connection),
    DB_CONNECTION: provider === "postgres" ? "pgsql" : "mariadb",
    DB_DATABASE: connection.databaseName,
    DB_USERNAME: connection.user
  };
  return Object.entries(values).map(([name, value]) => managedDatabaseEnvironmentEntry({
    name,
    value
  }));
}

async function inspectLaravelProject(targetRoot) {
  return inspectDescribedProject(targetRoot, {
    extra: async (context) => {
      const [composerJson, nodeExtra] = await Promise.all([
        readComposerJson(context.targetRoot),
        nodePackageManagerInspectionExtra(context)
      ]);
      return {
        composerJson,
        packageManager: nodeExtra.packageManager
      };
    },
    markers: LARAVEL_MARKERS,
    packageJson: {
      invalidJsonCode: "vibe64_invalid_laravel_package_json",
      invalidJsonMessage: (filePath) => `Invalid JSON in Laravel package file: ${filePath}`
    }
  });
}

async function laravelPromptContext({
  composerJson = null,
  config = {},
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  const knowledgePath = targetRoot
    ? path.join(targetRoot, LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH)
    : LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH;
  const databaseRuntime = selectedLaravelDatabaseRuntime(config);
  return {
    adapter: "laravel",
    artisan_exists: String(markerExists(markers, "artisan")),
    automated_check_command: "php artisan test",
    composer_dependencies: composerDependencyNames(composerJson || {}).join(", "),
    composer_name: composerProjectName(composerJson || {}),
    composer_scripts: composerScriptNames(composerJson || {}).join(", "),
    database_env_file: ".env",
    database_runtime: databaseRuntime,
    environment_blueprint: laravelEnvironmentBlueprint(config),
    frontend_package_manager: normalizeText(packageManager.name || selectedPackageManager(config)),
    laravel_dependency: String(hasComposerDependency(composerJson || {}, "laravel/framework")),
    package_name: composerProjectName(composerJson || {}) || normalizeText(packageJson?.name),
    project_knowledge_path: knowledgePath,
    project_knowledge_relative_path: LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH,
    seed_database_runtime: databaseRuntime,
    seed_issue_guidance: [
      "Seed a Laravel application by discovering the installer flags, starter kit, framework packages, and local development environment values needed before product feature work starts.",
      "Ask about Laravel setup choices, not business entities or detailed CRUD screens yet.",
      "Questions should cover: official starter kit or custom starter, frontend stack, authentication provider, teams/workspaces, database runtime, queues/cache/mail/storage, broadcasting/realtime, Laravel Boost, testing framework, API-only needs, and any fake local dev service keys.",
      "Development secrets are allowed in this conversation because they are local fake values for ignored .env files. Ask for them when a selected package needs them.",
      "Create a seed issue whose acceptance criteria include the exact `laravel new ...` command or Composer/Artisan commands Codex should run, followed by dependency install, .env writes, key generation, migrations, and verification.",
      "The seed issue should produce a runnable Laravel foundation app with local .env values, installed dependencies, and a clear project knowledge note."
    ].join("\n"),
    target_root: normalizeText(targetRoot),
    test_script: composerScript(composerJson || {}, "test"),
    valid_laravel_markers: String(allMarkersReady({
      composerJson,
      markers
    }))
  };
}

async function laravelFacts({
  adapter = null,
  commands = [],
  composerJson = null,
  markers = []
} = {}) {
  return {
    capabilities: adapter?.workflowCapabilities() || {},
    commands,
    summary: setupSummary({
      composerJson,
      markers
    }),
    workflow: {
      seedRequired: !allMarkersReady({
        composerJson,
        markers
      })
    }
  };
}

function hostToolScript(command = "") {
  return laravelRuntimeCommand(command);
}

function laravelRuntimeRequirements({
  config = {}
} = {}) {
  const databaseRuntime = selectedLaravelDatabaseRuntime(config);
  if (databaseRuntime === "postgres") {
    throw vibe64Error(
      "Laravel PostgreSQL runtime orchestration is not implemented yet.",
      "vibe64_runtime_requirement_unsupported"
    );
  }
  return [
    runtimeRequirement("php-8.3", {
      tool: "php"
    }),
    runtimeRequirement("composer", {
      tool: "composer"
    }),
    runtimeRequirement("nodejs-26", {
      tool: "node"
    }),
    databaseRuntime === "mariadb"
      ? runtimeRequirement("mariadb", {
          tool: "mariadb"
        })
      : null
  ].filter(Boolean);
}

async function laravelInstallWorkflowHook({ worktreePath = "" } = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const nodeInstall = packageJson ? installCommand(packageManager.name) : "";
  const command = [
    "composer install --no-interaction --no-ansi",
    nodeInstall
  ].filter(Boolean).join(" && ");
  const runtimeCommand = hostToolScript(command);
  return {
    command: runtimeCommand,
    commandPreview: command,
    metadata: {
      dependencies_package_manager: packageManager.name
    },
    runtimes: ["node26", "php", "composer"],
    script: runtimeCommand
  };
}

async function laravelAutomatedChecksHook({ worktreePath = "" } = {}) {
  const [composerJson, packageJson] = await Promise.all([
    readComposerJson(worktreePath),
    readPackageJson(worktreePath)
  ]);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const adapterVerifyCommand = composerScript(composerJson || {}, VIBE64_VERIFY_SCRIPT_NAME)
    ? composerRunCommand(VIBE64_VERIFY_SCRIPT_NAME)
    : packageManagerScriptCommand({
      packageJson: packageJson || {},
      packageManager,
      scriptName: VIBE64_VERIFY_SCRIPT_NAME
    });
  const phpCommand = composerScript(composerJson || {}, "test")
    ? composerRunCommand("test")
    : phpArtisanCommand(["test"]);
  const frontendBuild = packageScript(packageJson || {}, "build")
    ? runScriptCommand(packageManager.name, "build")
    : "";
  const command = adapterVerifyCommand || [
    frontendBuild,
    phpCommand
  ].filter(Boolean).join(" && ");
  const runtimeCommand = hostToolScript(command);
  return {
    command: runtimeCommand,
    commandPreview: command,
    metadata: {
      automated_checks_package_manager: packageManager.name
    },
    runtimes: ["node26", "php", "composer"],
    script: studioCommandScript({
      command: runtimeCommand,
      commandPreview: command,
      intro: "Running Laravel checks."
    })
  };
}

async function laravelCodeIndexHook({ worktreePath = "" } = {}) {
  const [composerJson, packageJson] = await Promise.all([
    readComposerJson(worktreePath),
    readPackageJson(worktreePath)
  ]);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const composerIndexCommand = composerScript(composerJson || {}, VIBE64_CODE_INDEX_SCRIPT_NAME)
    ? composerRunCommand(VIBE64_CODE_INDEX_SCRIPT_NAME)
    : "";
  const packageScriptCommand = composerIndexCommand ? "" : packageManagerScriptCommand({
    packageJson: packageJson || {},
    packageManager,
    scriptName: VIBE64_CODE_INDEX_SCRIPT_NAME
  });
  const command = composerIndexCommand || packageScriptCommand || phpCodeIndexCommand();
  const commandPreview = composerIndexCommand ||
    packageScriptCommand ||
    `php # writes ${DEFAULT_CODE_INDEX_RELATIVE_PATH}`;
  const runtimeCommand = hostToolScript(command);
  return {
    commandPreview,
    metadata: {
      code_index_command_source: composerIndexCommand
        ? "composer-script"
        : packageScriptCommand
          ? "package-script"
          : "php-indexer",
      code_index_package_manager: composerIndexCommand ? "composer" : packageManager.name,
      code_index_path: DEFAULT_CODE_INDEX_RELATIVE_PATH
    },
    runtimes: ["node26", "php", "composer"],
    script: studioCommandScript({
      command: runtimeCommand,
      commandPreview,
      intro: "Updating Laravel/PHP code index."
    })
  };
}

class LaravelTargetAdapter extends Vibe64DescribedWorkflowTargetAdapter {
  constructor({
    commandTerminalSpecFactory = null,
    commands = [],
    launchTargetTerminalSpecFactory = null,
    launchTargets = () => []
  } = {}) {
    super({
      commandTerminalSpecFactory,
      commands,
      configFields: LARAVEL_CONFIG_FIELDS,
      currentAppInspector: inspectLaravelCurrentApp,
      defaultConfig: () => ({ ...LARAVEL_DEFAULT_CONFIG }),
      id: "laravel",
      label: "Laravel target adapter",
      managedServices: ({ config = {}, targetRoot = "" } = {}) => [
        laravelDatabasePromptServiceFacts({
          config,
          targetRoot
        })
      ].filter(Boolean),
      prepareWorktreeScriptPath: LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
      projectFacts: laravelFacts,
      projectInspection: inspectLaravelProject,
      promptContext: laravelPromptContext,
      promptPackRoot: LARAVEL_PROMPT_PACK_ROOT,
      runtimeRequirements: laravelRuntimeRequirements,
      setupDoctorPlugins: (context) => [
        createLaravelSetupDoctorPlugin(context)
      ],
      launchTargetTerminalSpecFactory,
      launchTargets,
      targetScriptTerminalSpecFactory: createLaravelTargetScriptTerminalSpec,
      targetScriptsInspector: inspectLaravelTargetScripts,
      workflowCommandHooks: {
        automatedChecks: laravelAutomatedChecksHook,
        installDependencies: laravelInstallWorkflowHook,
        updateCodeIndex: laravelCodeIndexHook
      }
    });
  }

  async inspectCommittedWorkflow({
    source = {}
  } = {}) {
    const [markers, composerText] = await Promise.all([
      inspectProjectSourceMarkers(source, LARAVEL_MARKERS),
      source.readText("composer.json")
    ]);
    const composerJson = composerText === null
      ? null
      : parseComposerJson(composerText, "composer.json");
    return {
      seedRequired: !allMarkersReady({
        composerJson,
        markers
      })
    };
  }

  async listProjectTools(context = {}) {
    return listLaravelDatabaseProjectTools(context);
  }

  async worktreeArchiveExclusions() {
    return [
      "node_modules",
      "vendor"
    ];
  }

  async sourceEditorPreloadDirectories() {
    return [
      "app",
      "routes",
      "resources",
      "resources/views",
      "database",
      "config",
      "public"
    ];
  }

  async sourceEditorPreexpandedDirectories() {
    return [
      "app",
      "routes",
      "resources/views"
    ];
  }

  async createDeploymentPublishPlan({
    config = {},
    deployment = {},
    targetRoot = ""
  } = {}) {
    const publishRoot = normalizeText(targetRoot);
    if (!publishRoot) {
      return publishRootMissingPlan({
        adapterId: this.id,
        label: "Laravel"
      });
    }
    const descriptor = await createLaravelLaunchDescriptor({
      launchInput: {},
      mode: "built",
      port: PUBLISH_RELEASE_PORT_ENV,
      worktreePath: publishRoot
    });
    const databaseProvider = selectedLaravelDatabaseRuntime(config);
    return deploymentPublishPlanFromLaunchDescriptor({
      adapterId: this.id,
      artifacts: {
        kind: "workspace-build",
        path: "public/build"
      },
      buildLabel: "Build Laravel frontend assets.",
      descriptor,
      messageReady: "Laravel publish plan is ready.",
      messageServeMissing: "Laravel publish requires a server command.",
      migrateCommand: laravelRuntimeCommand(phpArtisanCommand(LARAVEL_PUBLISH_MIGRATION_ARGS)),
      migrateLabel: "Apply Laravel database migrations.",
      requirements: laravelDatabaseRuntimeIsManaged(databaseProvider)
        ? [
            relationalDatabaseDeploymentRequirement({
              databaseName: normalizeText(deployment.databaseName) || laravelDatabaseNameFromTargetRoot(publishRoot),
              provider: databaseProvider
            })
          ]
        : [],
      serveLabel: "Start Laravel app server."
    });
  }

  async getDeploymentEnvironment({
    config = {},
    context = {},
    deployment = {},
    serviceDataRoot = "",
    targetRoot = ""
  } = {}) {
    const runtime = selectedLaravelDatabaseRuntime(config);
    if (!laravelDatabaseRuntimeIsManaged(runtime)) {
      return deploymentEnvironmentResult({
        services: [
          deploymentDatabaseNotRequiredService()
        ]
      });
    }
    return deploymentEnvironmentResult({
      appEntries: await laravelDeploymentDatabaseEntries({
        config,
        context,
        deployment,
        serviceDataRoot,
        targetRoot
      }),
      services: [
        deploymentManagedDatabaseService({
          runtimeLabel: laravelDatabaseRuntimeLabel(runtime)
        })
      ]
    });
  }
}

export {
  LARAVEL_CONFIG_FIELDS,
  LARAVEL_MARKERS,
  LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  LARAVEL_PROMPT_PACK_ROOT,
  LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
  LaravelTargetAdapter,
  inspectLaravelProject,
  laravelPromptContext,
  setupSummary
};
