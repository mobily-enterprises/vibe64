import {
  createNodeTargetScriptTerminalSpec,
  inspectNodeCurrentApp,
  inspectNodeTargetScripts,
  nodeMarkersReady,
  targetScriptCommandPreview
} from "../../nodeCurrentApp.js";
import {
  dependencyNames as packageDependencyNames,
  detectPackageManager,
  packageScript,
  readPackageJson
} from "../../nodePackage.js";
import {
  configFiles,
  definitionList,
  detectClientLibraries,
  detectFrameworkHints,
  detectTooling,
  entrypointFiles,
  genericNodeWebCurrentAppDirectories,
  genericNodeWebCurrentAppMarkers,
  packageWorkspaces,
  readWorkspacePackages,
  sourceLocations,
  testLocations
} from "./projectDetection.js";

const DEFAULT_TARGET_SCRIPT_NAMES = Object.freeze([
  "vibe64:verify",
  "dev",
  "start",
  "build",
  "preview",
  "serve",
  "test",
  "check",
  "lint",
  "typecheck"
]);

const GENERIC_NODE_WEB_CURRENT_APP_MARKERS = Object.freeze(genericNodeWebCurrentAppMarkers());
const GENERIC_NODE_WEB_PROJECT_DIRECTORIES = Object.freeze(genericNodeWebCurrentAppDirectories());
const GENERIC_NODE_WEB_READY_MARKER_IDS = Object.freeze([
  "packageJson"
]);

function genericNodeWebMarkersReady(markers = []) {
  return nodeMarkersReady(markers, GENERIC_NODE_WEB_READY_MARKER_IDS);
}

async function inspectWorkspacePackages(appRoot, packageJson = {}) {
  const workspaces = packageWorkspaces(packageJson);
  const packageEntries = await readWorkspacePackages(appRoot, workspaces);
  return {
    appPackageName: String(packageJson.name || ""),
    packages: packageEntries
  };
}

async function inspectConfig(appRoot, {
  markers = []
} = {}) {
  const packageJson = await readPackageJson(appRoot) || {};
  const packageManager = await detectPackageManager(appRoot, packageJson);
  const clientLibraries = detectClientLibraries({
    markers,
    packageJson
  });
  const frameworkHints = detectFrameworkHints({
    markers,
    packageJson
  });
  const tooling = detectTooling({
    markers,
    packageJson
  });
  return {
    buildScript: packageScript(packageJson, "build"),
    clientLibraries: definitionList(clientLibraries),
    configFiles: configFiles(markers).join(", "),
    dependencies: packageDependencyNames(packageJson),
    devScript: packageScript(packageJson, "dev") || packageScript(packageJson, "serve"),
    entrypointFiles: entrypointFiles(markers).join(", "),
    frameworkHints: definitionList(frameworkHints),
    packageManager,
    sourceLocations: sourceLocations(markers).join(", "),
    startScript: packageScript(packageJson, "start") || packageScript(packageJson, "preview") || packageScript(packageJson, "serve"),
    testLocations: testLocations(markers).join(", "),
    tooling: definitionList(tooling)
  };
}

async function inspectGenericNodeWebCurrentApp(targetRoot, {
  includeGit = true
} = {}) {
  return inspectNodeCurrentApp(targetRoot, {
    adapter: "node-web",
    appPath: "/",
    config: inspectConfig,
    directories: GENERIC_NODE_WEB_PROJECT_DIRECTORIES,
    includeGit,
    localPackages: async (appRoot) => {
      const packageJson = await readPackageJson(appRoot) || {};
      return inspectWorkspacePackages(appRoot, packageJson);
    },
    markers: GENERIC_NODE_WEB_CURRENT_APP_MARKERS,
    ready: genericNodeWebMarkersReady
  });
}

async function inspectGenericNodeWebTargetScripts(appRoot) {
  return inspectNodeTargetScripts(appRoot, {
    defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES
  });
}

async function createGenericNodeWebTargetScriptTerminalSpec(targetRoot, input = {}) {
  return createNodeTargetScriptTerminalSpec(targetRoot, input, {
    adapterId: "node-web",
    defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES
  });
}

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  GENERIC_NODE_WEB_CURRENT_APP_MARKERS,
  createGenericNodeWebTargetScriptTerminalSpec,
  inspectGenericNodeWebCurrentApp,
  inspectGenericNodeWebTargetScripts,
  targetScriptCommandPreview
};
