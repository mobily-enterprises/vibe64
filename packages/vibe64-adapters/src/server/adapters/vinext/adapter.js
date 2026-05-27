import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  Vibe64DescribedWorkflowTargetAdapter,
  inspectDescribedProject
} from "../../workflowAdapter.js";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH
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
  readPackageJson,
  scriptNames,
  scriptUsesVinext
} from "./packageManager.js";
import {
  commandLineScript,
  createNodeWebProjectReadiness,
  nodeWebAdapterFacts,
  nodeWebPromptContextBase,
  nodeInstallWorkflowHook,
  nodePackageManagerInspectionExtra,
  projectMarkerExists,
  projectRouterIsPresent,
  studioCommandScript
} from "../../nodeWebProject.js";
import {
  VIBE64_VERIFY_SCRIPT_NAME,
  javascriptAdapterCodeIndexCommand,
  packageManagerScriptCommand
} from "../../codeIndexCommands.js";

const VINEXT_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));
const VINEXT_PREPARE_WORKTREE_SCRIPT_PATH = fileURLToPath(new URL("./prepareWorktree.sh", import.meta.url));

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

const VINEXT_CONFIG_FIELDS = deepFreeze([]);

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

const VINEXT_PROJECT_READINESS = createNodeWebProjectReadiness({
  label: "Vinext",
  packageLabel: "vinext dependency or script",
  packageReady: packageHasVinext,
  packageReadyMode: () => "vinext",
  readyMode: "vinext",
  secondaryModes: [
    {
      id: "next-migration-candidate",
      summary: "Vinext project type selected. Next.js migration candidate; run vinext init.",
      when({ markers = [], packageJson = null } = {}) {
        return packageHasNext(packageJson || {}) && projectRouterIsPresent(markers);
      }
    }
  ]
});

const routerMode = VINEXT_PROJECT_READINESS.routerMode;
const projectMode = VINEXT_PROJECT_READINESS.projectMode;

function setupSummary(inspection = {}) {
  return VINEXT_PROJECT_READINESS.setupSummary(inspection);
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
    ...nodeWebPromptContextBase({
      adapterId: "vinext",
      automatedCheckCommand: "vinext check && vinext build",
      dependencyNames: dependencyNames(packageJson || {}).join(", "),
      packageJson,
      packageManager,
      projectKnowledgePath: knowledgePath,
      projectKnowledgeRelativePath: VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH,
      projectMode: projectMode({
        markers,
        packageJson
      }),
      routerMode: routerMode(markers),
      scriptNames: scriptNames(packageJson || {}).join(", "),
      targetRoot,
      validMarkers: VINEXT_PROJECT_READINESS.allMarkersReady({
        markers,
        packageJson
      })
    }),
    build_script: preferredBuildScript(packageJson || {}),
    cloudflare_config_exists: String(cloudflareConfigExists(markers)),
    dev_script: preferredDevScript(packageJson || {}),
    next_config_exists: String(nextConfigExists(markers)),
    next_dependency: String(packageHasNext(packageJson || {})),
    start_script: preferredStartScript(packageJson || {}),
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
  return nodeWebAdapterFacts({
    adapter,
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
      invalidJsonCode: "vibe64_invalid_vinext_json",
      invalidJsonMessage: (filePath) => `Invalid JSON in Vinext project file: ${filePath}`
    }
  });
}

async function vinextAutomatedChecksHook({ worktreePath = "" } = {}) {
  const { packageManager } = await nodePackageManagerInspectionExtra({
    targetRoot: worktreePath
  });
  const packageJson = await readPackageJson(worktreePath);
  const verifyCommand = packageManagerScriptCommand({
    packageJson: packageJson || {},
    packageManager,
    scriptName: VIBE64_VERIFY_SCRIPT_NAME
  });
  if (verifyCommand) {
    return {
      commandPreview: verifyCommand,
      metadata: {
        automated_checks_package_manager: packageManager.name
      },
      script: studioCommandScript({
        command: verifyCommand,
        intro: "Running Vinext verification."
      })
    };
  }
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

async function vinextCodeIndexHook({ worktreePath = "" } = {}) {
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
    script: studioCommandScript({
      command: codeIndexCommand.command,
      commandPreview: codeIndexCommand.commandPreview,
      intro: "Updating Vinext code index."
    })
  };
}

class VinextTargetAdapter extends Vibe64DescribedWorkflowTargetAdapter {
  constructor({
    commandTerminalSpecFactory = null,
    commands = [],
    launchTargetTerminalSpecFactory = null,
    launchTargets = () => []
  } = {}) {
    super({
      commandTerminalSpecFactory,
      commands,
      configFields: VINEXT_CONFIG_FIELDS,
      currentAppInspector: inspectVinextCurrentApp,
      defaultConfig: {},
      id: "vinext",
      label: "Vinext target adapter",
      prepareWorktreeScriptPath: VINEXT_PREPARE_WORKTREE_SCRIPT_PATH,
      projectFacts: vinextFacts,
      projectInspection: inspectVinextProject,
      promptContext: vinextPromptContext,
      promptPackRoot: VINEXT_PROMPT_PACK_ROOT,
      setupDoctorPlugins: (context) => [
        createVinextSetupDoctorPlugin(context)
      ],
      launchTargetTerminalSpecFactory,
      launchTargets,
      targetScriptTerminalSpecFactory: createVinextTargetScriptTerminalSpec,
      targetScriptsInspector: inspectVinextTargetScripts,
      workflowCommandHooks: {
        automatedChecks: vinextAutomatedChecksHook,
        installDependencies: nodeInstallWorkflowHook,
        updateCodeIndex: vinextCodeIndexHook
      }
    });
  }
}

export {
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  VINEXT_PROMPT_PACK_ROOT,
  VINEXT_PREPARE_WORKTREE_SCRIPT_PATH,
  VinextTargetAdapter,
  inspectVinextProject,
  routerMode,
  setupSummary,
  vinextPromptContext
};
