import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Vibe64DescribedWorkflowTargetAdapter,
  inspectDescribedProject
} from "../../workflowAdapter.js";
import {
  PUBLISH_RELEASE_PORT_ENV,
  deploymentDatabaseNotRequiredService,
  deploymentEnvironmentResult,
  deploymentManagedDatabaseService,
  deploymentPublishPlanFromLaunchDescriptor,
  managedDatabaseEnvironmentEntry,
  publishRootMissingPlan
} from "../../deployment.js";
import {
  envValuesFromLines
} from "../../adapterHelpers/setupEnvFiles.js";
import {
  createAdapterBlueprintReader
} from "../../adapterBlueprints.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  dependencyNames,
  hasDependency,
  NODE_RUNTIME_DISPOSABLE_PATHS,
  nodeRuntimeRequirements,
  packageBinCommand,
  packageScript,
  readPackageJson,
  runScriptCommand,
  scriptNames
} from "../../nodePackage.js";
import {
  createNodeWebProjectReadiness,
  nodeWebAdapterFacts,
  nodeWebPromptContextBase,
  nodeInstallWorkflowHook,
  nodePackageManagerInspectionExtra,
  projectMarkerExists,
  studioCommandScript
} from "../../nodeWebProject.js";
import {
  VIBE64_VERIFY_SCRIPT_NAME,
  javascriptAdapterCodeIndexCommand,
  packageManagerScriptCommand
} from "../../codeIndexCommands.js";
import {
  NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH
} from "./constants.js";
import {
  NEXTJS_CONFIG_FIELDS,
  NEXTJS_DEFAULT_CONFIG,
  selectedNextjsPackageManager as selectedPackageManager,
  selectedNextjsDataLayer as selectedDataLayer,
  selectedNextjsSeedBundler as selectedSeedBundler,
  selectedNextjsSeedImportAlias as selectedSeedImportAlias,
  selectedNextjsSeedLanguage as selectedSeedLanguage,
  selectedNextjsSeedLinter as selectedSeedLinter,
  selectedNextjsSeedSourceLayout as selectedSeedSourceLayout,
  selectedNextjsSeedStyling as selectedSeedStyling
} from "./config.js";
import {
  createNextjsTargetScriptTerminalSpec,
  inspectNextjsCurrentApp,
  inspectNextjsTargetScripts
} from "./currentApp.js";
import {
  createNextjsSetupDoctorPlugin
} from "./setupDoctorPlugin.js";
import {
  nextjsDatabaseEnvLines,
  nextjsDatabasePromptServiceFacts,
  selectedNextjsDatabaseRuntime
} from "./databaseRuntime.js";
import {
  createNextjsLaunchDescriptor
} from "./launchTargets.js";

const NEXTJS_BLUEPRINT_ROOT = fileURLToPath(new URL("./blueprints", import.meta.url));
const NEXTJS_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));
const NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH = fileURLToPath(new URL("./prepareWorktree.sh", import.meta.url));
const blueprintFile = createAdapterBlueprintReader(NEXTJS_BLUEPRINT_ROOT);

const NEXTJS_MARKERS = deepFreeze([
  {
    id: "package_json",
    label: "package.json",
    relativePath: "package.json"
  },
  {
    id: "app_router",
    label: "app/",
    relativePath: "app"
  },
  {
    id: "src_app_router",
    label: "src/app/",
    relativePath: "src/app"
  },
  {
    id: "pages_router",
    label: "pages/",
    relativePath: "pages"
  },
  {
    id: "src_pages_router",
    label: "src/pages/",
    relativePath: "src/pages"
  },
  {
    id: "next_config_ts",
    label: "next.config.ts",
    relativePath: "next.config.ts"
  },
  {
    id: "next_config_js",
    label: "next.config.js",
    relativePath: "next.config.js"
  },
  {
    id: "next_config_mjs",
    label: "next.config.mjs",
    relativePath: "next.config.mjs"
  },
  {
    id: "tsconfig",
    label: "tsconfig.json",
    relativePath: "tsconfig.json"
  }
]);

async function nextjsBlueprintSections(config = {}) {
  const databaseRuntime = selectedNextjsDatabaseRuntime(config);
  const seedImportAlias = selectedSeedImportAlias(config);
  return [
    await blueprintFile("database-runtime", databaseRuntime),
    await blueprintFile("data-layer", selectedDataLayer(config)),
    await blueprintFile("seed-language", selectedSeedLanguage(config)),
    await blueprintFile("seed-source-layout", selectedSeedSourceLayout(config)),
    await blueprintFile("seed-styling", selectedSeedStyling(config)),
    await blueprintFile("seed-linter", selectedSeedLinter(config)),
    await blueprintFile("seed-bundler", selectedSeedBundler(config)),
    [
      "Import alias",
      "",
      `Use ${seedImportAlias} as the configured import alias when adding new imports or paths.`,
      "Keep tsconfig/jsconfig path aliases and generated imports aligned with this value."
    ].join("\n")
  ];
}

async function nextjsEnvironmentBlueprint(config = {}) {
  return (await nextjsBlueprintSections(config))
    .map((section) => String(section || "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function nextConfigExists(markers = []) {
  return projectMarkerExists(markers, "next_config_ts") ||
    projectMarkerExists(markers, "next_config_js") ||
    projectMarkerExists(markers, "next_config_mjs");
}

function packageHasNext(packageJson = {}) {
  return hasDependency(packageJson, "next") ||
    Object.values(packageJson?.scripts || {}).some((script) => /\bnext\b/u.test(String(script || "")));
}

const NEXTJS_PROJECT_READINESS = createNodeWebProjectReadiness({
  label: "Next.js",
  packageLabel: "next dependency or script",
  packageReady: packageHasNext,
  readyMode: "nextjs"
});

const routerMode = NEXTJS_PROJECT_READINESS.routerMode;
const projectMode = NEXTJS_PROJECT_READINESS.projectMode;

function setupSummary(inspection = {}) {
  return NEXTJS_PROJECT_READINESS.setupSummary(inspection);
}

function nextjsDatabaseRuntimeLabel(runtime = "") {
  return {
    mariadb: "MariaDB",
    postgres: "PostgreSQL"
  }[String(runtime || "").trim()] || "managed";
}

function nextjsDeploymentDatabaseEntries({
  config = {},
  deployment = {},
  targetRoot = ""
} = {}) {
  const values = envValuesFromLines(nextjsDatabaseEnvLines({
    config,
    databaseName: normalizeText(deployment.databaseName),
    targetRoot
  }));
  return Object.entries(values).map(([name, value]) => managedDatabaseEnvironmentEntry({
    name,
    value
  }));
}

async function nextjsPromptContext({
  config = {},
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  const knowledgePath = targetRoot
    ? path.join(targetRoot, NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH)
    : NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH;
  const databaseRuntime = selectedNextjsDatabaseRuntime(config);
  const dataLayer = selectedDataLayer(config);
  const environmentBlueprint = await nextjsEnvironmentBlueprint(config);
  return {
    ...nodeWebPromptContextBase({
      adapterId: "nextjs",
      automatedCheckCommand: "next build",
      dependencyNames: dependencyNames(packageJson || {}).join(", "),
      packageJson,
      packageManager,
      projectKnowledgePath: knowledgePath,
      projectKnowledgeRelativePath: NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH,
      projectMode: projectMode({
        markers,
        packageJson
      }),
      routerMode: routerMode(markers),
      scriptNames: scriptNames(packageJson || {}).join(", "),
      targetRoot,
      validMarkers: NEXTJS_PROJECT_READINESS.allMarkersReady({
        markers,
        packageJson
      })
    }),
    build_script: packageScript(packageJson || {}, "build"),
    dev_script: packageScript(packageJson || {}, "dev"),
    database_env_file: databaseRuntime === "none" ? "" : ".env.local",
    database_runtime: databaseRuntime,
    database_url_variable: databaseRuntime === "none" ? "" : "DATABASE_URL",
    data_layer: dataLayer,
    data_layer_blueprint: await blueprintFile("data-layer", dataLayer),
    environment_blueprint: environmentBlueprint,
    next_config_exists: String(nextConfigExists(markers)),
    next_dependency: String(hasDependency(packageJson || {}, "next")),
    seed_bundler: selectedSeedBundler(config),
    seed_import_alias: selectedSeedImportAlias(config),
    seed_language: selectedSeedLanguage(config),
    seed_linter: selectedSeedLinter(config),
    seed_source_layout: selectedSeedSourceLayout(config),
    seed_styling: selectedSeedStyling(config),
    start_script: packageScript(packageJson || {}, "start")
  };
}

async function nextjsFacts({
  adapter = null,
  commands = [],
  markers = [],
  packageJson = null
} = {}) {
  return nodeWebAdapterFacts({
    adapter,
    commands,
    summary: setupSummary({
      markers,
      packageJson
    })
  });
}

async function inspectNextjsProject(targetRoot) {
  return inspectDescribedProject(targetRoot, {
    extra: nodePackageManagerInspectionExtra,
    markers: NEXTJS_MARKERS,
    packageJson: {
      invalidJsonCode: "vibe64_invalid_nextjs_json",
      invalidJsonMessage: (filePath) => `Invalid JSON in Next.js project file: ${filePath}`
    }
  });
}

async function nextjsAutomatedChecksHook({ worktreePath = "" } = {}) {
  const { packageManager } = await nodePackageManagerInspectionExtra({
    targetRoot: worktreePath
  });
  const packageJson = await readPackageJson(worktreePath);
  const buildCommand = packageManagerScriptCommand({
    packageJson: packageJson || {},
    packageManager,
    scriptName: VIBE64_VERIFY_SCRIPT_NAME
  }) || (packageScript(packageJson || {}, "build")
    ? runScriptCommand(packageManager.name, "build")
    : packageBinCommand(packageManager.name, "next", ["build"]));
  return {
    commandPreview: buildCommand,
    metadata: {
      automated_checks_package_manager: packageManager.name
    },
    runtimes: ["node22"],
    script: studioCommandScript({
      command: buildCommand,
      intro: "Running Next.js production build."
    })
  };
}

async function nextjsCodeIndexHook({ worktreePath = "" } = {}) {
  const { packageManager } = await nodePackageManagerInspectionExtra({
    targetRoot: worktreePath
  });
  const packageJson = await readPackageJson(worktreePath);
  const codeIndexCommand = javascriptAdapterCodeIndexCommand({
    packageJson: packageJson || {},
    packageManager
  });
  return {
    commandPreview: codeIndexCommand.commandPreview,
    metadata: codeIndexCommand.metadata,
    runtimes: ["node22"],
    script: studioCommandScript({
      command: codeIndexCommand.command,
      commandPreview: codeIndexCommand.commandPreview,
      intro: "Updating Next.js code index."
    })
  };
}

function nextjsRuntimeRequirements({
  config = {}
} = {}) {
  return nodeRuntimeRequirements({
    packageManager: selectedPackageManager(config)
  });
}

class NextjsTargetAdapter extends Vibe64DescribedWorkflowTargetAdapter {
  constructor({
    commandTerminalSpecFactory = null,
    commands = [],
    launchTargetTerminalSpecFactory = null,
    launchTargets = () => []
  } = {}) {
    super({
      commandTerminalSpecFactory,
      commands,
      configFields: NEXTJS_CONFIG_FIELDS,
      currentAppInspector: inspectNextjsCurrentApp,
      defaultConfig: () => ({ ...NEXTJS_DEFAULT_CONFIG }),
      id: "nextjs",
      label: "Next.js target adapter",
      managedServices: ({ config = {}, targetRoot = "" } = {}) => [
        nextjsDatabasePromptServiceFacts({
          config,
          targetRoot
        })
      ].filter(Boolean),
      prepareWorktreeScriptPath: NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH,
      projectFacts: nextjsFacts,
      projectInspection: inspectNextjsProject,
      promptContext: nextjsPromptContext,
      promptPackRoot: NEXTJS_PROMPT_PACK_ROOT,
      runtimeRequirements: nextjsRuntimeRequirements,
      setupDoctorPlugins: (context) => [
        createNextjsSetupDoctorPlugin(context)
      ],
      launchTargetTerminalSpecFactory,
      launchTargets,
      targetScriptTerminalSpecFactory: createNextjsTargetScriptTerminalSpec,
      targetScriptsInspector: inspectNextjsTargetScripts,
      workflowCommandHooks: {
        automatedChecks: nextjsAutomatedChecksHook,
        installDependencies: nodeInstallWorkflowHook,
        updateCodeIndex: nextjsCodeIndexHook
      }
    });
  }

  async worktreeArchiveExclusions() {
    return [
      ".next",
      ".turbo",
      "coverage",
      "node_modules",
      "out"
    ];
  }

  async sourceEditorPreloadDirectories() {
    return [
      "app",
      "src/app",
      "pages",
      "src/pages",
      "components",
      "src/components",
      "public",
      "lib",
      "src/lib"
    ];
  }

  async sourceEditorPreexpandedDirectories() {
    return [
      "app",
      "src/app",
      "pages",
      "src/pages"
    ];
  }

  async createDeploymentPublishPlan({
    targetRoot = ""
  } = {}) {
    const publishRoot = normalizeText(targetRoot);
    if (!publishRoot) {
      return publishRootMissingPlan({
        adapterId: this.id,
        label: "Next.js"
      });
    }
    const descriptor = await createNextjsLaunchDescriptor({
      launchInput: {},
      mode: "production",
      port: PUBLISH_RELEASE_PORT_ENV,
      worktreePath: publishRoot
    });
    const artifactPath = ".next";
    return deploymentPublishPlanFromLaunchDescriptor({
      adapterId: this.id,
      artifacts: {
        disposablePaths: NODE_RUNTIME_DISPOSABLE_PATHS,
        kind: "workspace-build",
        path: artifactPath
      },
      buildLabel: "Build Next.js app.",
      descriptor,
      messageReady: "Next.js publish plan is ready.",
      messageServeMissing: "Next.js publish requires a server command.",
      serveLabel: "Start Next.js app server."
    });
  }

  async getDeploymentEnvironment({
    config = {},
    deployment = {},
    targetRoot = ""
  } = {}) {
    const runtime = selectedNextjsDatabaseRuntime(config);
    if (runtime === "none") {
      return deploymentEnvironmentResult({
        services: [
          deploymentDatabaseNotRequiredService()
        ]
      });
    }
    return deploymentEnvironmentResult({
      appEntries: nextjsDeploymentDatabaseEntries({
        config,
        deployment,
        targetRoot
      }),
      services: [
        deploymentManagedDatabaseService({
          runtimeLabel: nextjsDatabaseRuntimeLabel(runtime)
        })
      ]
    });
  }
}

export {
  NEXTJS_CONFIG_FIELDS,
  NEXTJS_MARKERS,
  NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  NEXTJS_PROMPT_PACK_ROOT,
  NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH,
  NextjsTargetAdapter,
  inspectNextjsProject,
  nextjsRuntimeRequirements,
  routerMode,
  setupSummary,
  nextjsPromptContext
};
