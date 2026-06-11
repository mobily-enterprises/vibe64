import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dockerCommand,
  hostUserDockerArgs
} from "@local/studio-terminal-core/server/shellCommands";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  Vibe64DescribedWorkflowTargetAdapter,
  inspectDescribedProject
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
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  targetRuntimeNetworkEnsureCommand
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  composerDependencyNames,
  composerProjectName,
  composerRunCommand,
  composerScript,
  composerScriptNames,
  hasComposerDependency,
  phpArtisanCommand,
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
  createLaravelRuntimeContainers,
  listLaravelDatabaseProjectTools,
  selectedLaravelDatabaseRuntime
} from "./databaseRuntime.js";
import {
  createLaravelSetupDoctorPlugin
} from "./setupDoctorPlugin.js";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

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
    mysql: "MySQL",
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

function dockerToolchainScript(command = "", {
  targetRoot = ""
} = {}) {
  const dockerRun = dockerCommand(buildDoctorToolchainArgs(["bash", "-lc", command], {
    extraArgs: [
      ...hostUserDockerArgs(),
      "-e",
      "HOME=/tmp/studio-home",
      "-e",
      "COMPOSER_CACHE_DIR=/tmp/composer-cache",
      "-e",
      "npm_config_cache=/tmp/npm-cache"
    ],
    image: LARAVEL_TOOLCHAIN_IMAGE,
    targetRoot
  }));
  return targetRoot
    ? `${targetRuntimeNetworkEnsureCommand(targetRoot)}\n${dockerRun}`
    : dockerRun;
}

async function laravelInstallWorkflowHook({ worktreePath = "" } = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const nodeInstall = packageJson ? installCommand(packageManager.name) : "";
  const command = [
    "composer install --no-interaction --no-ansi",
    nodeInstall
  ].filter(Boolean).join(" && ");
  return {
    command,
    commandPreview: command,
    metadata: {
      dependencies_package_manager: packageManager.name
    },
    script: dockerToolchainScript(command, {
      targetRoot: worktreePath
    })
  };
}

async function laravelAutomatedChecksHook({ context = {}, worktreePath = "" } = {}) {
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
  return {
    command,
    commandPreview: command,
    metadata: {
      automated_checks_package_manager: packageManager.name
    },
    script: studioCommandScript({
      command: dockerToolchainScript(command, {
        config: context.config || {},
        targetRoot: worktreePath
      }),
      commandPreview: command,
      intro: "Running Laravel checks."
    })
  };
}

async function laravelCodeIndexHook({ context = {}, worktreePath = "" } = {}) {
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
    script: studioCommandScript({
      command: dockerToolchainScript(command, {
        config: context.config || {},
        targetRoot: worktreePath
      }),
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
      terminalToolchain: {
        image: LARAVEL_TOOLCHAIN_IMAGE,
        label: "Laravel toolchain"
      },
      label: "Laravel target adapter",
      prepareWorktreeScriptPath: LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
      projectFacts: laravelFacts,
      projectInspection: inspectLaravelProject,
      promptContext: laravelPromptContext,
      promptPackRoot: LARAVEL_PROMPT_PACK_ROOT,
      runtimeContainers: ({ config = {}, targetRoot = "" } = {}) => createLaravelRuntimeContainers({
        config,
        targetRoot
      }),
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

  async listProjectTools(context = {}) {
    return listLaravelDatabaseProjectTools(context);
  }

  async worktreeArchiveExclusions() {
    return [
      "node_modules",
      "vendor"
    ];
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
