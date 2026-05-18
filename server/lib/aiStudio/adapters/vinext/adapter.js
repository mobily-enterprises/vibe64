import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  adapterProjectFacts
} from "../../adapter.js";
import {
  shellQuote
} from "../../../shellCommands.js";
import {
  AiStudioDescribedWorkflowTargetAdapter,
  inspectDescribedProject
} from "../../workflowAdapter.js";
import {
  normalizeText
} from "../../core.js";
import { deepFreeze } from "../../deepFreeze.js";
import {
  VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  VINEXT_REVIEW_MODE_CONFIG
} from "./constants.js";
import {
  createVinextTargetScriptTerminalSpec,
  inspectVinextCurrentApp,
  inspectVinextTargetScripts
} from "./currentApp.js";
import {
  createVinextSetupDoctorPlugin
} from "./setupDoctorPlugin.js";
import {
  dependencyNames,
  hasDependency,
  hasVinextScript,
  packageScript,
  packageBinCommand,
  scriptNames,
  scriptUsesVinext
} from "./packageManager.js";
import {
  commandLineScript,
  nodeInstallWorkflowHook,
  nodePackageManagerInspectionExtra,
  projectMarkerExists,
  projectRouterMode
} from "../../nodeWebProject.js";

const VINEXT_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));

const VINEXT_MARKERS = deepFreeze([
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
    id: "vite_config_ts",
    label: "vite.config.ts",
    relativePath: "vite.config.ts"
  },
  {
    id: "vite_config_js",
    label: "vite.config.js",
    relativePath: "vite.config.js"
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
    id: "wrangler_config",
    label: "wrangler.jsonc",
    relativePath: "wrangler.jsonc"
  },
  {
    id: "worker_entry",
    label: "worker/index.ts",
    relativePath: "worker/index.ts"
  }
]);

const VINEXT_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: "production",
    description: "Use production build/start for app review by default; development mode uses vinext dev.",
    id: VINEXT_REVIEW_MODE_CONFIG,
    label: "Vinext review mode",
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
  }
]);

function routerMode(markers = []) {
  return projectRouterMode(markers);
}

function viteConfigExists(markers = []) {
  return projectMarkerExists(markers, "vite_config_ts") || projectMarkerExists(markers, "vite_config_js");
}

function nextConfigExists(markers = []) {
  return projectMarkerExists(markers, "next_config_ts") || projectMarkerExists(markers, "next_config_js");
}

function cloudflareConfigExists(markers = []) {
  return projectMarkerExists(markers, "wrangler_config") || projectMarkerExists(markers, "worker_entry");
}

function packageHasVinext(packageJson = {}) {
  return hasDependency(packageJson, "vinext") || hasVinextScript(packageJson);
}

function packageHasNext(packageJson = {}) {
  return hasDependency(packageJson, "next") || Object.values(packageJson?.scripts || {}).some((script) => /\bnext\b/u.test(script));
}

function projectMode({
  markers = [],
  packageJson = null
} = {}) {
  if (!packageJson) {
    return "unseeded";
  }
  if (packageHasVinext(packageJson)) {
    return "vinext";
  }
  if (packageHasNext(packageJson) && routerMode(markers) !== "unknown") {
    return "next-migration-candidate";
  }
  return "unrecognized";
}

function allVinextMarkersReady({
  markers = [],
  packageJson = null
} = {}) {
  return Boolean(packageJson) &&
    routerMode(markers) !== "unknown" &&
    packageHasVinext(packageJson);
}

function missingMarkerLabels({
  markers = [],
  packageJson = null
} = {}) {
  const missing = [];
  if (!packageJson) {
    missing.push("package.json");
  }
  if (routerMode(markers) === "unknown") {
    missing.push("app/ or pages/");
  }
  if (packageJson && !packageHasVinext(packageJson)) {
    missing.push("vinext dependency or script");
  }
  return missing.sort((left, right) => left.localeCompare(right));
}

function setupSummary(inspection = {}) {
  if (allVinextMarkersReady(inspection)) {
    return "Vinext project type selected.";
  }
  if (projectMode(inspection) === "next-migration-candidate") {
    return "Vinext project type selected. Next.js migration candidate; run vinext init.";
  }
  const missingLabels = missingMarkerLabels(inspection);
  return missingLabels.length
    ? `Vinext project type selected. Missing markers: ${missingLabels.join(", ")}`
    : "Vinext project type selected.";
}

function vinextAdapterCapabilities({
  adapter = null
} = {}) {
  return adapter?.workflowCapabilities() || {};
}

function preferredBuildScript(packageJson = {}) {
  if (packageScript(packageJson, "build:vinext")) {
    return "build:vinext";
  }
  return scriptUsesVinext(packageScript(packageJson, "build")) ? "build" : "";
}

function preferredStartScript(packageJson = {}) {
  if (packageScript(packageJson, "start:vinext")) {
    return "start:vinext";
  }
  return scriptUsesVinext(packageScript(packageJson, "start")) ? "start" : "";
}

function preferredDevScript(packageJson = {}) {
  if (packageScript(packageJson, "dev:vinext")) {
    return "dev:vinext";
  }
  return scriptUsesVinext(packageScript(packageJson, "dev")) ? "dev" : "";
}

function vinextPromptContext({
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  const knowledgePath = targetRoot
    ? path.join(targetRoot, VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH)
    : VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH;
  return {
    adapter: "vinext",
    automated_check_command: "vinext check && vinext build",
    build_script: preferredBuildScript(packageJson || {}),
    cloudflare_config_exists: String(cloudflareConfigExists(markers)),
    dependency_names: dependencyNames(packageJson || {}).join(", "),
    dev_script: preferredDevScript(packageJson || {}),
    next_config_exists: String(nextConfigExists(markers)),
    next_dependency: String(packageHasNext(packageJson || {})),
    package_manager: normalizeText(packageManager.name || "npm"),
    package_manager_source: normalizeText(packageManager.source || "default"),
    package_name: normalizeText(packageJson?.name),
    project_knowledge_path: normalizeText(knowledgePath),
    project_knowledge_relative_path: VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH,
    project_mode: projectMode({
      markers,
      packageJson
    }),
    router_mode: routerMode(markers),
    scripts: scriptNames(packageJson || {}).join(", "),
    start_script: preferredStartScript(packageJson || {}),
    target_root: normalizeText(targetRoot),
    valid_vinext_markers: String(allVinextMarkersReady({
      markers,
      packageJson
    })),
    vinext_dependency: String(hasDependency(packageJson || {}, "vinext")),
    vinext_script: String(hasVinextScript(packageJson || {})),
    vite_config_exists: String(viteConfigExists(markers))
  };
}

function vinextFacts({
  adapter = null,
  commands = [],
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  return adapterProjectFacts({
    capabilities: vinextAdapterCapabilities({
      adapter
    }),
    commands,
    promptContext: vinextPromptContext({
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

async function inspectVinextProject(targetRoot) {
  return inspectDescribedProject(targetRoot, {
    extra: nodePackageManagerInspectionExtra,
    markers: VINEXT_MARKERS,
    packageJson: {
      invalidJsonCode: "ai_studio_invalid_vinext_json",
      invalidJsonMessage: (filePath) => `Invalid JSON in Vinext project file: ${filePath}`
    }
  });
}

async function vinextAutomatedChecksHook({ worktreePath = "" } = {}) {
  const { packageManager } = await nodePackageManagerInspectionExtra({
    targetRoot: worktreePath
  });
  const checkCommand = packageBinCommand(packageManager.name, "vinext", ["check"]);
  const buildCommand = packageBinCommand(packageManager.name, "vinext", ["build"]);
  return {
    commandPreview: `${checkCommand} && ${buildCommand}`,
    metadata: {
      automated_checks_package_manager: packageManager.name
    },
    script: commandLineScript([
      "printf '[studio] Running Vinext compatibility check.\\n'",
      `printf '[studio] $ %s\\n\\n' ${shellQuote(checkCommand)}`,
      checkCommand,
      "printf '\\n[studio] Running Vinext production build.\\n'",
      `printf '[studio] $ %s\\n\\n' ${shellQuote(buildCommand)}`,
      buildCommand
    ])
  };
}

class VinextTargetAdapter extends AiStudioDescribedWorkflowTargetAdapter {
  constructor({
    appReviewTerminalSpecFactory = null,
    commandTerminalSpecFactory = null,
    commands = []
  } = {}) {
    super({
      appReviewTerminalSpecFactory,
      commandTerminalSpecFactory,
      commands,
      configFields: VINEXT_CONFIG_FIELDS,
      currentAppInspector: inspectVinextCurrentApp,
      defaultConfig: {
        [VINEXT_REVIEW_MODE_CONFIG]: "production"
      },
      id: "vinext",
      label: "Vinext target adapter",
      projectFacts: vinextFacts,
      projectInspection: inspectVinextProject,
      promptContext: vinextPromptContext,
      promptPackRoot: VINEXT_PROMPT_PACK_ROOT,
      setupDoctorPlugins: (context) => [
        createVinextSetupDoctorPlugin(context)
      ],
      targetScriptTerminalSpecFactory: createVinextTargetScriptTerminalSpec,
      targetScriptsInspector: inspectVinextTargetScripts,
      workflowCommandHooks: {
        automatedChecks: vinextAutomatedChecksHook,
        installDependencies: nodeInstallWorkflowHook
      }
    });
  }
}

export {
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  VINEXT_PROMPT_PACK_ROOT,
  VINEXT_REVIEW_MODE_CONFIG,
  VinextTargetAdapter,
  inspectVinextProject,
  routerMode,
  setupSummary,
  vinextPromptContext
};
