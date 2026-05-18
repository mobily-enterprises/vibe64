import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  shellQuote
} from "../../../shellCommands.js";
import {
  normalizeText
} from "../../core.js";
import {
  AiStudioDescribedWorkflowTargetAdapter,
  inspectDescribedProject
} from "../../workflowAdapter.js";
import { deepFreeze } from "../../deepFreeze.js";
import {
  dependencyNames,
  hasDependency,
  packageBinCommand,
  packageScript,
  readPackageJson,
  runScriptCommand,
  scriptNames
} from "../../nodePackage.js";
import {
  commandLineScript,
  createNodeWebProjectReadiness,
  nodeWebAdapterFacts,
  nodeWebPromptContextBase,
  nodeInstallWorkflowHook,
  nodePackageManagerInspectionExtra,
  projectMarkerExists
} from "../../nodeWebProject.js";
import {
  NEXTJS_DATABASE_RUNTIME_CONFIG,
  NEXTJS_DATA_LAYER_CONFIG,
  NEXTJS_PACKAGE_MANAGER_CONFIG,
  NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  NEXTJS_REVIEW_MODE_CONFIG,
  NEXTJS_SEED_BUNDLER_CONFIG,
  NEXTJS_SEED_IMPORT_ALIAS_CONFIG,
  NEXTJS_SEED_LANGUAGE_CONFIG,
  NEXTJS_SEED_LINTER_CONFIG,
  NEXTJS_SEED_SOURCE_LAYOUT_CONFIG,
  NEXTJS_SEED_STYLING_CONFIG
} from "./constants.js";
import {
  createNextjsTargetScriptTerminalSpec,
  inspectNextjsCurrentApp,
  inspectNextjsTargetScripts
} from "./currentApp.js";
import {
  createNextjsSetupDoctorPlugin
} from "./setupDoctorPlugin.js";
import {
  selectedNextjsDatabaseRuntime
} from "./databaseRuntime.js";

const NEXTJS_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));
const NEXTJS_DATA_LAYER_BLUEPRINT_ROOT = fileURLToPath(new URL("./blueprints/data-layer", import.meta.url));
const NEXTJS_DATA_LAYERS = new Set(["none", "prisma", "drizzle"]);
const dataLayerBlueprintCache = new Map();

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

const NEXTJS_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: "production",
    description: "Use production build/start for app review by default; development mode uses next dev.",
    id: NEXTJS_REVIEW_MODE_CONFIG,
    label: "Next.js review mode",
    options: [
      {
        label: "Production",
        value: "production"
      },
      {
        label: "Development",
        value: "development"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "npm",
    description: "Package manager to use when Studio seeds a new Next.js app.",
    id: NEXTJS_PACKAGE_MANAGER_CONFIG,
    label: "Seed package manager",
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
    defaultValue: "typescript",
    description: "Language mode used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_LANGUAGE_CONFIG,
    label: "Seed language",
    options: [
      {
        label: "TypeScript",
        value: "typescript"
      },
      {
        label: "JavaScript",
        value: "javascript"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "tailwind",
    description: "Styling scaffold used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_STYLING_CONFIG,
    label: "Seed styling",
    options: [
      {
        label: "Tailwind CSS",
        value: "tailwind"
      },
      {
        label: "None",
        value: "none"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "eslint",
    description: "Linter scaffold used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_LINTER_CONFIG,
    label: "Seed linter",
    options: [
      {
        label: "ESLint",
        value: "eslint"
      },
      {
        label: "Biome",
        value: "biome"
      },
      {
        label: "None",
        value: "none"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "src",
    description: "Project source layout used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_SOURCE_LAYOUT_CONFIG,
    label: "Seed source layout",
    options: [
      {
        label: "src/app",
        value: "src"
      },
      {
        label: "app at root",
        value: "root"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "turbopack",
    description: "Bundler preference used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_BUNDLER_CONFIG,
    label: "Seed bundler",
    options: [
      {
        label: "Turbopack",
        value: "turbopack"
      },
      {
        label: "Webpack",
        value: "webpack"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "@/*",
    description: "Import alias passed to create-next-app when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_IMPORT_ALIAS_CONFIG,
    label: "Seed import alias",
    type: "string"
  },
  {
    defaultValue: "postgres",
    description: "Optional AI Studio-managed database runtime for local setup, target scripts, and app review.",
    id: NEXTJS_DATABASE_RUNTIME_CONFIG,
    label: "Database runtime",
    options: [
      {
        label: "None",
        value: "none"
      },
      {
        label: "PostgreSQL",
        value: "postgres"
      },
      {
        label: "MySQL",
        value: "mysql"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "prisma",
    description: "Application data-access convention included in Next.js prompts.",
    id: NEXTJS_DATA_LAYER_CONFIG,
    label: "Data layer",
    options: [
      {
        label: "None",
        value: "none"
      },
      {
        label: "Prisma",
        value: "prisma"
      },
      {
        label: "Drizzle",
        value: "drizzle"
      }
    ],
    type: "select"
  }
]);

function configValues(config = {}) {
  return config?.values && typeof config.values === "object" ? config.values : config;
}

function selectedDataLayer(config = {}) {
  const dataLayer = normalizeText(configValues(config)[NEXTJS_DATA_LAYER_CONFIG] || "prisma");
  return NEXTJS_DATA_LAYERS.has(dataLayer) ? dataLayer : "prisma";
}

async function dataLayerBlueprint(dataLayer = "none") {
  const selected = NEXTJS_DATA_LAYERS.has(dataLayer) ? dataLayer : "none";
  if (!dataLayerBlueprintCache.has(selected)) {
    dataLayerBlueprintCache.set(
      selected,
      readFile(path.join(NEXTJS_DATA_LAYER_BLUEPRINT_ROOT, `${selected}.txt`), "utf8")
    );
  }
  return dataLayerBlueprintCache.get(selected);
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
  const values = configValues(config);
  const databaseRuntime = selectedNextjsDatabaseRuntime(config);
  const dataLayer = selectedDataLayer(config);
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
    data_layer_blueprint: await dataLayerBlueprint(dataLayer),
    next_config_exists: String(nextConfigExists(markers)),
    next_dependency: String(hasDependency(packageJson || {}, "next")),
    seed_bundler: normalizeText(values[NEXTJS_SEED_BUNDLER_CONFIG] || "turbopack"),
    seed_import_alias: normalizeText(values[NEXTJS_SEED_IMPORT_ALIAS_CONFIG] || "@/*"),
    seed_language: normalizeText(values[NEXTJS_SEED_LANGUAGE_CONFIG] || "typescript"),
    seed_linter: normalizeText(values[NEXTJS_SEED_LINTER_CONFIG] || "eslint"),
    seed_source_layout: normalizeText(values[NEXTJS_SEED_SOURCE_LAYOUT_CONFIG] || "src"),
    seed_styling: normalizeText(values[NEXTJS_SEED_STYLING_CONFIG] || "tailwind"),
    start_script: packageScript(packageJson || {}, "start")
  };
}

async function nextjsFacts({
  adapter = null,
  commands = [],
  config = {},
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  return nodeWebAdapterFacts({
    adapter,
    commands,
    promptContext: await nextjsPromptContext({
      config,
      markers,
      packageJson,
      packageManager,
      targetRoot
    }),
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
      invalidJsonCode: "ai_studio_invalid_nextjs_json",
      invalidJsonMessage: (filePath) => `Invalid JSON in Next.js project file: ${filePath}`
    }
  });
}

async function nextjsAutomatedChecksHook({ worktreePath = "" } = {}) {
  const { packageManager } = await nodePackageManagerInspectionExtra({
    targetRoot: worktreePath
  });
  const packageJson = await readPackageJson(worktreePath);
  const buildCommand = packageScript(packageJson || {}, "build")
    ? runScriptCommand(packageManager.name, "build")
    : packageBinCommand(packageManager.name, "next", ["build"]);
  return {
    commandPreview: buildCommand,
    metadata: {
      automated_checks_package_manager: packageManager.name
    },
    script: commandLineScript([
      "printf '[studio] Running Next.js production build.\\n'",
      `printf '[studio] $ %s\\n\\n' ${shellQuote(buildCommand)}`,
      buildCommand
    ])
  };
}

class NextjsTargetAdapter extends AiStudioDescribedWorkflowTargetAdapter {
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
      defaultConfig: {
        [NEXTJS_DATABASE_RUNTIME_CONFIG]: "postgres",
        [NEXTJS_DATA_LAYER_CONFIG]: "prisma",
        [NEXTJS_PACKAGE_MANAGER_CONFIG]: "npm",
        [NEXTJS_REVIEW_MODE_CONFIG]: "production",
        [NEXTJS_SEED_BUNDLER_CONFIG]: "turbopack",
        [NEXTJS_SEED_IMPORT_ALIAS_CONFIG]: "@/*",
        [NEXTJS_SEED_LANGUAGE_CONFIG]: "typescript",
        [NEXTJS_SEED_LINTER_CONFIG]: "eslint",
        [NEXTJS_SEED_SOURCE_LAYOUT_CONFIG]: "src",
        [NEXTJS_SEED_STYLING_CONFIG]: "tailwind"
      },
      id: "nextjs",
      label: "Next.js target adapter",
      projectFacts: nextjsFacts,
      projectInspection: inspectNextjsProject,
      promptContext: nextjsPromptContext,
      promptPackRoot: NEXTJS_PROMPT_PACK_ROOT,
      setupDoctorPlugins: (context) => [
        createNextjsSetupDoctorPlugin(context)
      ],
      launchTargetTerminalSpecFactory,
      launchTargets,
      targetScriptTerminalSpecFactory: createNextjsTargetScriptTerminalSpec,
      targetScriptsInspector: inspectNextjsTargetScripts,
      workflowCommandHooks: {
        automatedChecks: nextjsAutomatedChecksHook,
        installDependencies: nodeInstallWorkflowHook
      }
    });
  }
}

export {
  NEXTJS_CONFIG_FIELDS,
  NEXTJS_MARKERS,
  NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  NEXTJS_PROMPT_PACK_ROOT,
  NEXTJS_REVIEW_MODE_CONFIG,
  NextjsTargetAdapter,
  inspectNextjsProject,
  routerMode,
  setupSummary,
  nextjsPromptContext
};
