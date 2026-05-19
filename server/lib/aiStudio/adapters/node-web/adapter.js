import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  adapterProjectFacts
} from "../../adapter.js";
import {
  AI_STUDIO_VERIFY_SCRIPT_NAME,
  javascriptAdapterCodeIndexCommand,
  packageManagerScriptCommand
} from "../../codeIndexCommands.js";
import {
  AiStudioDescribedWorkflowTargetAdapter,
  inspectDescribedProject
} from "../../workflowAdapter.js";
import {
  dependencyNames,
  packageScript,
  readPackageJson,
  runScriptCommand,
  scriptNames
} from "../../nodePackage.js";
import {
  nodeInstallWorkflowHook,
  nodePackageManagerInspectionExtra,
  nodeWebPromptContextBase,
  studioCommandScript
} from "../../nodeWebProject.js";
import {
  GENERIC_NODE_WEB_CONFIG_FIELDS,
  GENERIC_NODE_WEB_DEFAULT_CONFIG,
  selectedGenericNodeWebClientLibrary
} from "./config.js";
import {
  GENERIC_NODE_WEB_PROJECT_KNOWLEDGE_RELATIVE_PATH
} from "./constants.js";
import {
  createGenericNodeWebTargetScriptTerminalSpec,
  inspectGenericNodeWebCurrentApp,
  inspectGenericNodeWebTargetScripts
} from "./currentApp.js";
import {
  createGenericNodeWebSetupDoctorPlugin
} from "./setupDoctorPlugin.js";
import {
  commaList,
  configFiles,
  definitionList,
  detectClientLibraries,
  detectFrameworkHints,
  detectTooling,
  entrypointFiles,
  genericRouterMode,
  genericNodeWebMarkers,
  packageDependencySummary,
  packageJsonExists,
  packageScriptSummary,
  packageWorkspaces,
  preferredAutomatedCheckScriptName,
  resolveClientLibrary,
  sourceLocations,
  testLocations
} from "./projectDetection.js";

const GENERIC_NODE_WEB_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));
const GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH = fileURLToPath(new URL("./prepareWorktree.sh", import.meta.url));
const GENERIC_NODE_WEB_MARKERS = Object.freeze(genericNodeWebMarkers());

function setupSummary({
  markers = [],
  packageJson = null
} = {}) {
  if (packageJson && packageJsonExists(markers)) {
    return "Generic Node web app selected. Studio will use package metadata, scripts, and detected project structure.";
  }
  return "Generic Node web app selected. Missing markers: package.json.";
}

function projectMode({
  markers = [],
  packageJson = null
} = {}) {
  if (!packageJson || !packageJsonExists(markers)) {
    return "unseeded";
  }
  return "node-web";
}

function validMarkers({
  markers = [],
  packageJson = null
} = {}) {
  return Boolean(packageJson) && packageJsonExists(markers);
}

function genericNodeWebCommands(commands = [], {
  packageJson = null
} = {}) {
  const hasPackageJson = Boolean(packageJson);
  const checkScript = preferredAutomatedCheckScriptName(packageJson || {});
  return commands.map((command) => {
    if (command.id === "install_dependencies" && !hasPackageJson) {
      return {
        ...command,
        available: false,
        disabledReason: "package.json is required before installing dependencies."
      };
    }
    if (command.id === "run_automated_checks" && !checkScript) {
      return {
        ...command,
        available: false,
        disabledReason: "No ai-studio:verify, verify, check, test, build, lint, or typecheck package script was found."
      };
    }
    return command;
  });
}

function genericNodeWebCapabilities(adapter, {
  packageJson = null
} = {}) {
  const capabilities = {
    ...adapter.workflowCapabilities()
  };
  if (!packageJson) {
    capabilities.install_dependencies = false;
    capabilities.run_automated_checks = false;
  }
  if (!preferredAutomatedCheckScriptName(packageJson || {})) {
    capabilities.run_automated_checks = false;
  }
  return capabilities;
}

function scriptValue(packageJson = {}, scriptName = "") {
  return scriptName ? packageScript(packageJson || {}, scriptName) : "";
}

function genericNodeWebPromptContext({
  config = {},
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  const detectedClientLibraries = detectClientLibraries({
    markers,
    packageJson: packageJson || {}
  });
  const configuredClientLibrary = selectedGenericNodeWebClientLibrary(config);
  const resolvedClientLibrary = resolveClientLibrary({
    configured: configuredClientLibrary,
    detected: detectedClientLibraries
  });
  const frameworkHints = detectFrameworkHints({
    markers,
    packageJson: packageJson || {}
  });
  const tooling = detectTooling({
    markers,
    packageJson: packageJson || {}
  });
  const knowledgePath = targetRoot
    ? path.join(targetRoot, GENERIC_NODE_WEB_PROJECT_KNOWLEDGE_RELATIVE_PATH)
    : GENERIC_NODE_WEB_PROJECT_KNOWLEDGE_RELATIVE_PATH;
  const automatedCheckScript = preferredAutomatedCheckScriptName(packageJson || {});
  const markersReady = validMarkers({
    markers,
    packageJson
  });

  return {
    ...nodeWebPromptContextBase({
      adapterId: "node-web",
      automatedCheckCommand: automatedCheckScript
        ? runScriptCommand(packageManager.name || "npm", automatedCheckScript)
        : "",
      dependencyNames: dependencyNames(packageJson || {}).join(", "),
      packageJson,
      packageManager,
      projectKnowledgePath: knowledgePath,
      projectKnowledgeRelativePath: GENERIC_NODE_WEB_PROJECT_KNOWLEDGE_RELATIVE_PATH,
      projectMode: projectMode({
        markers,
        packageJson
      }),
      routerMode: genericRouterMode(markers),
      scriptNames: scriptNames(packageJson || {}).join(", "),
      targetRoot,
      validMarkers: markersReady
    }),
    automated_check_script: automatedCheckScript,
    build_script: scriptValue(packageJson || {}, "build"),
    client_library: resolvedClientLibrary.id,
    client_library_config: configuredClientLibrary,
    client_library_label: resolvedClientLibrary.label,
    client_library_source: resolvedClientLibrary.source,
    config_files: commaList(configFiles(markers)),
    dependency_summary: packageDependencySummary(packageJson || {}),
    detected_client_libraries: definitionList(detectedClientLibraries),
    entrypoint_files: commaList(entrypointFiles(markers)),
    framework_hints: definitionList(frameworkHints),
    package_scripts: packageScriptSummary(packageJson || {}),
    package_type: packageJson?.type || "",
    preview_script: scriptValue(packageJson || {}, "preview"),
    source_locations: commaList(sourceLocations(markers)),
    start_script: scriptValue(packageJson || {}, "start"),
    test_locations: commaList(testLocations(markers)),
    test_script: scriptValue(packageJson || {}, "test"),
    tooling: definitionList(tooling),
    valid_node_web_markers: String(markersReady),
    workspaces: commaList(packageWorkspaces(packageJson || {}))
  };
}

function genericNodeWebFacts({
  adapter = null,
  commands = [],
  config = {},
  markers = [],
  packageJson = null,
  packageManager = {},
  targetRoot = ""
} = {}) {
  return adapterProjectFacts({
    capabilities: adapter ? genericNodeWebCapabilities(adapter, {
      packageJson
    }) : {},
    commands: genericNodeWebCommands(commands, {
      packageJson
    }),
    promptContext: genericNodeWebPromptContext({
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

async function inspectGenericNodeWebProject(targetRoot) {
  return inspectDescribedProject(targetRoot, {
    extra: nodePackageManagerInspectionExtra,
    markers: GENERIC_NODE_WEB_MARKERS,
    packageJson: {
      invalidJsonCode: "ai_studio_invalid_node_web_json",
      invalidJsonMessage: (filePath) => `Invalid JSON in generic Node web project file: ${filePath}`
    }
  });
}

async function genericNodeWebAutomatedChecksHook({ worktreePath = "" } = {}) {
  const { packageManager } = await nodePackageManagerInspectionExtra({
    targetRoot: worktreePath
  });
  const packageJson = await readPackageJson(worktreePath);
  const verifyCommand = packageManagerScriptCommand({
    packageJson: packageJson || {},
    packageManager,
    scriptName: AI_STUDIO_VERIFY_SCRIPT_NAME
  });
  const scriptName = verifyCommand ? "" : preferredAutomatedCheckScriptName(packageJson || {});
  const command = verifyCommand || (scriptName ? runScriptCommand(packageManager.name, scriptName) : "");
  return command
    ? {
        commandPreview: command,
        metadata: {
          automated_checks_package_manager: packageManager.name,
          automated_checks_script: verifyCommand ? AI_STUDIO_VERIFY_SCRIPT_NAME : scriptName
        },
        script: studioCommandScript({
          command,
          intro: "Running generic Node web verification."
        })
      }
    : {};
}

async function genericNodeWebCodeIndexHook({ worktreePath = "" } = {}) {
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
      intro: "Updating generic Node web code index."
    })
  };
}

class GenericNodeWebTargetAdapter extends AiStudioDescribedWorkflowTargetAdapter {
  constructor({
    commandTerminalSpecFactory = null,
    commands = [],
    launchTargetTerminalSpecFactory = null,
    launchTargets = () => []
  } = {}) {
    super({
      commandTerminalSpecFactory,
      commands,
      configFields: GENERIC_NODE_WEB_CONFIG_FIELDS,
      currentAppInspector: inspectGenericNodeWebCurrentApp,
      defaultConfig: () => ({ ...GENERIC_NODE_WEB_DEFAULT_CONFIG }),
      id: "node-web",
      label: "Generic Node web app adapter",
      prepareWorktreeScriptPath: GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH,
      projectFacts: genericNodeWebFacts,
      projectInspection: inspectGenericNodeWebProject,
      promptContext: genericNodeWebPromptContext,
      promptPackRoot: GENERIC_NODE_WEB_PROMPT_PACK_ROOT,
      setupDoctorPlugins: (context) => [
        createGenericNodeWebSetupDoctorPlugin(context)
      ],
      launchTargetTerminalSpecFactory,
      launchTargets,
      targetScriptTerminalSpecFactory: createGenericNodeWebTargetScriptTerminalSpec,
      targetScriptsInspector: inspectGenericNodeWebTargetScripts,
      workflowCommandHooks: {
        automatedChecks: genericNodeWebAutomatedChecksHook,
        installDependencies: nodeInstallWorkflowHook,
        updateCodeIndex: genericNodeWebCodeIndexHook
      }
    });
  }
}

export {
  GENERIC_NODE_WEB_CONFIG_FIELDS,
  GENERIC_NODE_WEB_MARKERS,
  GENERIC_NODE_WEB_PROMPT_PACK_ROOT,
  GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH,
  GenericNodeWebTargetAdapter,
  genericNodeWebPromptContext,
  inspectGenericNodeWebProject,
  setupSummary
};
