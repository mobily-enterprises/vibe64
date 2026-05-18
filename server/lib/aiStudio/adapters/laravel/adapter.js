import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dockerCommand,
  hostUserDockerArgs,
  shellQuote
} from "../../../shellCommands.js";
import {
  normalizeText
} from "../../core.js";
import {
  configValues,
  selectedConfigValue
} from "../../configValues.js";
import {
  createAdapterBlueprintReader
} from "../../adapterBlueprints.js";
import { deepFreeze } from "../../deepFreeze.js";
import {
  AiStudioDescribedWorkflowTargetAdapter,
  inspectDescribedProject
} from "../../workflowAdapter.js";
import {
  commandLineScript,
  nodePackageManagerInspectionExtra
} from "../../nodeWebProject.js";
import {
  detectPackageManager,
  installCommand,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  buildDoctorToolchainArgs
} from "../../../doctorToolchain.js";
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
  LARAVEL_BOOST_CONFIG,
  LARAVEL_CUSTOM_STARTER_CONFIG,
  LARAVEL_DATABASE_RUNTIME_CONFIG,
  LARAVEL_PACKAGE_MANAGER_CONFIG,
  LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  LARAVEL_STARTER_KIT_CONFIG,
  LARAVEL_TESTING_CONFIG
} from "./constants.js";
import {
  createLaravelTargetScriptTerminalSpec,
  inspectLaravelCurrentApp,
  inspectLaravelTargetScripts
} from "./currentApp.js";
import {
  laravelRuntimeDockerArgs,
  selectedLaravelDatabaseRuntime
} from "./databaseRuntime.js";
import {
  createLaravelSetupDoctorPlugin
} from "./setupDoctorPlugin.js";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const LARAVEL_BLUEPRINT_ROOT = fileURLToPath(new URL("./blueprints", import.meta.url));
const LARAVEL_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));
const LARAVEL_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const LARAVEL_STARTER_KITS = new Set(["none", "react", "vue", "svelte", "livewire", "custom"]);
const LARAVEL_TESTING_FRAMEWORKS = new Set(["pest", "phpunit"]);
const LARAVEL_BOOST_OPTIONS = new Set(["none", "boost"]);
const blueprintFile = createAdapterBlueprintReader(LARAVEL_BLUEPRINT_ROOT);

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

const LARAVEL_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: "npm",
    description: "Node package manager used when Studio seeds Laravel frontend assets.",
    id: LARAVEL_PACKAGE_MANAGER_CONFIG,
    label: "Frontend package manager",
    options: [
      {
        label: "npm",
        value: "npm"
      },
      {
        label: "pnpm",
        value: "pnpm"
      },
      {
        label: "Yarn",
        value: "yarn"
      },
      {
        label: "Bun",
        value: "bun"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "sqlite",
    description: "Database runtime used by seeded Laravel .env values and setup checks.",
    id: LARAVEL_DATABASE_RUNTIME_CONFIG,
    label: "Database runtime",
    options: [
      {
        label: "SQLite",
        value: "sqlite"
      },
      {
        label: "PostgreSQL",
        value: "postgres"
      },
      {
        label: "MySQL",
        value: "mysql"
      },
      {
        label: "MariaDB",
        value: "mariadb"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "none",
    description: "Starter kit passed to the Laravel installer when Studio seeds a new app.",
    id: LARAVEL_STARTER_KIT_CONFIG,
    label: "Starter kit",
    options: [
      {
        label: "None",
        value: "none"
      },
      {
        label: "React",
        value: "react"
      },
      {
        label: "Vue",
        value: "vue"
      },
      {
        label: "Svelte",
        value: "svelte"
      },
      {
        label: "Livewire",
        value: "livewire"
      },
      {
        label: "Custom package",
        value: "custom"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "",
    description: "Packagist package or repository passed to laravel new --using when the custom starter kit is selected.",
    id: LARAVEL_CUSTOM_STARTER_CONFIG,
    label: "Custom starter",
    type: "string"
  },
  {
    defaultValue: "pest",
    description: "Testing framework selected when Studio seeds a Laravel app.",
    id: LARAVEL_TESTING_CONFIG,
    label: "Testing",
    options: [
      {
        label: "Pest",
        value: "pest"
      },
      {
        label: "PHPUnit",
        value: "phpunit"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "none",
    description: "Whether Studio asks the Laravel installer to add Laravel Boost during seeding.",
    id: LARAVEL_BOOST_CONFIG,
    label: "Laravel Boost",
    options: [
      {
        label: "None",
        value: "none"
      },
      {
        label: "Install Boost",
        value: "boost"
      }
    ],
    type: "select"
  }
]);

function selectedPackageManager(config = {}) {
  return selectedConfigValue(config, LARAVEL_PACKAGE_MANAGER_CONFIG, LARAVEL_PACKAGE_MANAGERS, "npm");
}

function selectedStarterKit(config = {}) {
  return selectedConfigValue(config, LARAVEL_STARTER_KIT_CONFIG, LARAVEL_STARTER_KITS, "none");
}

function selectedTestingFramework(config = {}) {
  return selectedConfigValue(config, LARAVEL_TESTING_CONFIG, LARAVEL_TESTING_FRAMEWORKS, "pest");
}

function selectedBoostOption(config = {}) {
  return selectedConfigValue(config, LARAVEL_BOOST_CONFIG, LARAVEL_BOOST_OPTIONS, "none");
}

function selectedCustomStarter(config = {}) {
  return normalizeText(configValues(config)[LARAVEL_CUSTOM_STARTER_CONFIG]);
}

async function laravelBlueprintSections(config = {}) {
  const starterKit = selectedStarterKit(config);
  const customStarter = selectedCustomStarter(config);
  return [
    await blueprintFile("database-runtime", selectedLaravelDatabaseRuntime(config)),
    await blueprintFile("starter-kit", starterKit),
    await blueprintFile("testing", selectedTestingFramework(config)),
    await blueprintFile("boost", selectedBoostOption(config)),
    [
      "Frontend package manager",
      "",
      `Use ${selectedPackageManager(config)} for JavaScript dependency install, Vite scripts, and Laravel installer frontend setup.`,
      "Keep Composer dependencies and Node dependencies in their own manifests.",
      starterKit === "custom" && customStarter
        ? `Custom starter package: ${customStarter}`
        : ""
    ].filter(Boolean).join("\n")
  ];
}

async function laravelEnvironmentBlueprint(config = {}) {
  return (await laravelBlueprintSections(config))
    .map((section) => String(section || "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
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
      invalidJsonCode: "ai_studio_invalid_laravel_package_json",
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
    boost: selectedBoostOption(config),
    composer_dependencies: composerDependencyNames(composerJson || {}).join(", "),
    composer_name: composerProjectName(composerJson || {}),
    composer_scripts: composerScriptNames(composerJson || {}).join(", "),
    database_env_file: ".env",
    database_runtime: databaseRuntime,
    environment_blueprint: await laravelEnvironmentBlueprint(config),
    frontend_package_manager: normalizeText(packageManager.name || selectedPackageManager(config)),
    laravel_dependency: String(hasComposerDependency(composerJson || {}, "laravel/framework")),
    package_name: composerProjectName(composerJson || {}) || normalizeText(packageJson?.name),
    project_knowledge_path: knowledgePath,
    project_knowledge_relative_path: LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH,
    seed_boost: selectedBoostOption(config),
    seed_custom_starter: selectedCustomStarter(config),
    seed_database_runtime: databaseRuntime,
    seed_package_manager: selectedPackageManager(config),
    seed_starter_kit: selectedStarterKit(config),
    seed_testing: selectedTestingFramework(config),
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
  config = {},
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  const promptContext = await laravelPromptContext({
    composerJson,
    config,
    markers,
    packageJson,
    packageManager,
    targetRoot
  });
  return {
    capabilities: adapter?.workflowCapabilities() || {},
    commands,
    promptContext,
    summary: setupSummary({
      composerJson,
      markers
    })
  };
}

function dockerToolchainScript(command = "", {
  config = {},
  targetRoot = ""
} = {}) {
  return dockerCommand(buildDoctorToolchainArgs(["bash", "-lc", command], {
    extraArgs: [
      ...hostUserDockerArgs(),
      "-e",
      "HOME=/tmp/studio-home",
      "-e",
      "COMPOSER_CACHE_DIR=/tmp/composer-cache",
      "-e",
      "npm_config_cache=/tmp/npm-cache",
      ...laravelRuntimeDockerArgs({
        config,
        targetRoot
      })
    ],
    image: LARAVEL_TOOLCHAIN_IMAGE,
    targetRoot
  }));
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
  const phpCommand = composerScript(composerJson || {}, "test")
    ? composerRunCommand("test")
    : phpArtisanCommand(["test"]);
  const frontendBuild = packageScript(packageJson || {}, "build")
    ? runScriptCommand(packageManager.name, "build")
    : "";
  const command = [
    frontendBuild,
    phpCommand
  ].filter(Boolean).join(" && ");
  return {
    command,
    commandPreview: command,
    metadata: {
      automated_checks_package_manager: packageManager.name
    },
    script: commandLineScript([
      "printf '[studio] Running Laravel checks.\\n'",
      `printf '[studio] $ %s\\n\\n' ${shellQuote(command)}`,
      dockerToolchainScript(command, {
        config: context.config || {},
        targetRoot: worktreePath
      })
    ])
  };
}

class LaravelTargetAdapter extends AiStudioDescribedWorkflowTargetAdapter {
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
      defaultConfig: {
        [LARAVEL_BOOST_CONFIG]: "none",
        [LARAVEL_CUSTOM_STARTER_CONFIG]: "",
        [LARAVEL_DATABASE_RUNTIME_CONFIG]: "sqlite",
        [LARAVEL_PACKAGE_MANAGER_CONFIG]: "npm",
        [LARAVEL_STARTER_KIT_CONFIG]: "none",
        [LARAVEL_TESTING_CONFIG]: "pest"
      },
      id: "laravel",
      label: "Laravel target adapter",
      projectFacts: laravelFacts,
      projectInspection: inspectLaravelProject,
      promptContext: laravelPromptContext,
      promptPackRoot: LARAVEL_PROMPT_PACK_ROOT,
      setupDoctorPlugins: (context) => [
        createLaravelSetupDoctorPlugin(context)
      ],
      launchTargetTerminalSpecFactory,
      launchTargets,
      targetScriptTerminalSpecFactory: createLaravelTargetScriptTerminalSpec,
      targetScriptsInspector: inspectLaravelTargetScripts,
      workflowCommandHooks: {
        automatedChecks: laravelAutomatedChecksHook,
        installDependencies: laravelInstallWorkflowHook
      }
    });
  }
}

export {
  LARAVEL_CONFIG_FIELDS,
  LARAVEL_MARKERS,
  LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  LARAVEL_PROMPT_PACK_ROOT,
  LaravelTargetAdapter,
  inspectLaravelProject,
  laravelPromptContext,
  setupSummary
};
