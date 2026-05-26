import {
  detectPackageManager,
  installCommand,
  readPackageJson
} from "./nodePackage.js";
import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  adapterProjectFacts
} from "./adapter.js";
import {
  normalizeText
} from "@local/ai-studio-core/server/core";

const DEFAULT_APP_ROUTER_MARKER_IDS = Object.freeze([
  "app_router",
  "src_app_router"
]);

const DEFAULT_PAGES_ROUTER_MARKER_IDS = Object.freeze([
  "pages_router",
  "src_pages_router"
]);

function projectMarkerExists(markers = [], markerId = "") {
  return markers.some((marker) => marker.id === markerId && marker.exists);
}

function projectRouterMode(markers = [], {
  appRouterMarkerIds = DEFAULT_APP_ROUTER_MARKER_IDS,
  pagesRouterMarkerIds = DEFAULT_PAGES_ROUTER_MARKER_IDS
} = {}) {
  const hasApp = appRouterMarkerIds.some((id) => projectMarkerExists(markers, id));
  const hasPages = pagesRouterMarkerIds.some((id) => projectMarkerExists(markers, id));
  if (hasApp && hasPages) {
    return "app+pages";
  }
  if (hasApp) {
    return "app";
  }
  if (hasPages) {
    return "pages";
  }
  return "unknown";
}

function projectRouterIsPresent(markers = [], options = {}) {
  return projectRouterMode(markers, options) !== "unknown";
}

function sortedMissingLabels(labels = []) {
  return labels
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function createNodeWebProjectReadiness({
  label = "Node web",
  packageLabel = "framework dependency or script",
  packageReady = () => false,
  packageReadyMode = null,
  readyMode = "ready",
  readySummary = "",
  routerLabel = "app/ or pages/",
  secondaryModes = []
} = {}) {
  const readyText = readySummary || `${label} project type selected.`;

  function allMarkersReady({
    markers = [],
    packageJson = null
  } = {}) {
    return Boolean(packageJson) &&
      projectRouterIsPresent(markers) &&
      packageReady(packageJson);
  }

  function modeForPackageReady(context = {}) {
    if (typeof packageReadyMode === "function") {
      return packageReadyMode(context);
    }
    return projectRouterIsPresent(context.markers) ? readyMode : `${readyMode}-missing-router`;
  }

  function projectMode(context = {}) {
    const {
      packageJson = null
    } = context;
    if (!packageJson) {
      return "unseeded";
    }
    if (packageReady(packageJson)) {
      return modeForPackageReady(context);
    }
    const secondaryMode = secondaryModes.find((mode) => mode?.when?.(context));
    return secondaryMode?.id || "unrecognized";
  }

  function missingMarkerLabels({
    markers = [],
    packageJson = null
  } = {}) {
    return sortedMissingLabels([
      packageJson ? "" : "package.json",
      projectRouterIsPresent(markers) ? "" : routerLabel,
      packageJson && !packageReady(packageJson) ? packageLabel : ""
    ]);
  }

  function setupSummary(context = {}) {
    if (allMarkersReady(context)) {
      return readyText;
    }
    const mode = projectMode(context);
    const secondaryMode = secondaryModes.find((candidate) => candidate.id === mode);
    if (secondaryMode?.summary) {
      return secondaryMode.summary;
    }
    const missingLabels = missingMarkerLabels(context);
    return missingLabels.length
      ? `${readyText} Missing markers: ${missingLabels.join(", ")}`
      : readyText;
  }

  return Object.freeze({
    allMarkersReady,
    missingMarkerLabels,
    projectMode,
    routerMode: projectRouterMode,
    setupSummary
  });
}

function nodeWebPromptContextBase({
  adapterId = "",
  automatedCheckCommand = "",
  dependencyNames = "",
  packageJson = null,
  packageManager = {},
  projectKnowledgePath = "",
  projectKnowledgeRelativePath = "",
  projectMode = "",
  routerMode = "",
  scriptNames = "",
  targetRoot = "",
  validMarkers = false
} = {}) {
  return {
    adapter: adapterId,
    automated_check_command: automatedCheckCommand,
    dependency_names: dependencyNames,
    package_manager: normalizeText(packageManager.name || "npm"),
    package_manager_source: normalizeText(packageManager.source || "default"),
    package_name: normalizeText(packageJson?.name),
    project_knowledge_path: normalizeText(projectKnowledgePath || projectKnowledgeRelativePath),
    project_knowledge_relative_path: projectKnowledgeRelativePath,
    project_mode: projectMode,
    router_mode: routerMode,
    scripts: scriptNames,
    target_root: normalizeText(targetRoot),
    [`valid_${adapterId}_markers`]: String(validMarkers)
  };
}

function nodeWebAdapterFacts({
  adapter = null,
  commands = [],
  promptContext = {},
  summary = ""
} = {}) {
  return adapterProjectFacts({
    capabilities: adapter?.workflowCapabilities() || {},
    commands,
    promptContext,
    summary
  });
}

async function nodePackageManagerInspectionExtra({
  packageJson = null,
  targetRoot = ""
} = {}) {
  return {
    packageManager: await detectPackageManager(
      targetRoot,
      packageJson || await readPackageJson(targetRoot)
    )
  };
}

function commandLineScript(lines = []) {
  return [
    "set -e",
    ...lines
  ].join("\n");
}

function studioCommandScript({
  command = "",
  commandPreview = "",
  intro = ""
} = {}) {
  const preview = normalizeText(commandPreview || command);
  return commandLineScript([
    intro ? `printf '[studio] %s\\n' ${shellQuote(intro)}` : "",
    preview ? `printf '[studio] $ %s\\n\\n' ${shellQuote(preview)}` : "",
    command
  ].filter(Boolean));
}

async function nodeInstallWorkflowHook({ worktreePath = "" } = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const command = installCommand(packageManager.name);
  return {
    command,
    commandPreview: command,
    metadata: {
      dependencies_package_manager: packageManager.name
    }
  };
}

export {
  commandLineScript,
  createNodeWebProjectReadiness,
  nodeWebAdapterFacts,
  nodeWebPromptContextBase,
  nodeInstallWorkflowHook,
  nodePackageManagerInspectionExtra,
  projectMarkerExists,
  projectRouterIsPresent,
  projectRouterMode,
  studioCommandScript
};
