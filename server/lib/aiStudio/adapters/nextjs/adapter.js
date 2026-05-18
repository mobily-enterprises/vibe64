import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  shellQuote
} from "../../../shellCommands.js";
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
  NEXTJS_PACKAGE_MANAGER_CONFIG,
  NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  NEXTJS_REVIEW_MODE_CONFIG
} from "./constants.js";
import {
  createNextjsTargetScriptTerminalSpec,
  inspectNextjsCurrentApp,
  inspectNextjsTargetScripts
} from "./currentApp.js";
import {
  createNextjsSetupDoctorPlugin
} from "./setupDoctorPlugin.js";

const NEXTJS_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));

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
    defaultValue: "none",
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
  }
]);

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

function nextjsPromptContext({
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  const knowledgePath = targetRoot
    ? path.join(targetRoot, NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH)
    : NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH;
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
    next_config_exists: String(nextConfigExists(markers)),
    next_dependency: String(hasDependency(packageJson || {}, "next")),
    start_script: packageScript(packageJson || {}, "start")
  };
}

function nextjsFacts({
  adapter = null,
  commands = [],
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  return nodeWebAdapterFacts({
    adapter,
    commands,
    promptContext: nextjsPromptContext({
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
  const buildCommand = packageBinCommand(packageManager.name, "next", ["build"]);
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
    appReviewTerminalSpecFactory = null,
    commandTerminalSpecFactory = null,
    commands = []
  } = {}) {
    super({
      appReviewTerminalSpecFactory,
      commandTerminalSpecFactory,
      commands,
      configFields: NEXTJS_CONFIG_FIELDS,
      currentAppInspector: inspectNextjsCurrentApp,
      defaultConfig: {
        [NEXTJS_DATABASE_RUNTIME_CONFIG]: "none",
        [NEXTJS_PACKAGE_MANAGER_CONFIG]: "npm",
        [NEXTJS_REVIEW_MODE_CONFIG]: "production"
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
