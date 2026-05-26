import path from "node:path";
import process from "node:process";

import {
  inspectDescribedCurrentApp,
  packageScriptEntries,
  readJsonFile
} from "./currentAppInspection.js";
import {
  createAiStudioTargetScriptTerminalSpec,
  targetScriptCommandPreview,
  targetScriptError
} from "@local/studio-terminal-core/server/targetScriptTerminal";
import {
  detectPackageManager,
  readPackageJson,
  runScriptCommand
} from "./nodePackage.js";

const DEFAULT_APP_ROUTER_MARKER_IDS = Object.freeze([
  "appRouter",
  "srcAppRouter"
]);

const DEFAULT_PAGES_ROUTER_MARKER_IDS = Object.freeze([
  "pagesRouter",
  "srcPagesRouter"
]);

function existingMarkerIds(markers = []) {
  return new Set(markers
    .filter((marker) => marker.exists)
    .map((marker) => marker.id));
}

function nodeMarkersReady(markers = [], markerIds = []) {
  const readyIds = new Set(markerIds);
  return markers.some((marker) => readyIds.has(marker.id) && marker.exists);
}

function nodeRouterModeFromMarkers(markers = [], {
  appRouterMarkerIds = DEFAULT_APP_ROUTER_MARKER_IDS,
  pagesRouterMarkerIds = DEFAULT_PAGES_ROUTER_MARKER_IDS
} = {}) {
  const ids = existingMarkerIds(markers);
  const hasApp = appRouterMarkerIds.some((id) => ids.has(id));
  const hasPages = pagesRouterMarkerIds.some((id) => ids.has(id));
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

function missingSyntheticPackageScripts({
  defaultScriptNames = [],
  definitions = [],
  packageJson = {}
} = {}) {
  const existing = new Set(Object.keys(packageJson?.scripts || {}));
  return definitions
    .filter(([name]) => !existing.has(name))
    .map(([name, command]) => ({
      command,
      id: `adapter:${name}`,
      label: name,
      name,
      source: "adapter",
      starredByDefault: defaultScriptNames.includes(name)
    }));
}

async function readNodeTargetScripts(appRoot, {
  defaultScriptNames = [],
  syntheticScripts = () => []
} = {}) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = await readJsonFile(packageJsonPath);
  if (!packageJson) {
    return targetScriptError("package_json_missing", `Cannot find ${packageJsonPath}.`, {
      scripts: []
    });
  }
  const packageManager = await detectPackageManager(appRoot, packageJson);
  const scripts = [
    ...packageScriptEntries(packageJson, {
      defaultScriptNames
    }),
    ...syntheticScripts(packageJson, packageManager)
  ].sort((left, right) => left.name.localeCompare(right.name));
  return {
    ok: true,
    packageJson,
    packageJsonPath,
    packageManager,
    scripts
  };
}

async function inspectNodeCurrentApp(targetRoot, {
  adapter = "",
  appPath = "/",
  config = null,
  directories = [],
  includeGit = true,
  localPackages = null,
  markers = [],
  ready = null
} = {}) {
  return inspectDescribedCurrentApp(targetRoot, {
    adapter,
    appPath,
    config,
    directories,
    includeGit,
    localPackages: localPackages || (async (appRoot) => {
      const packageJson = await readPackageJson(appRoot) || {};
      return {
        appPackageName: String(packageJson.name || ""),
        packages: []
      };
    }),
    markers,
    ready
  });
}

async function inspectNodeTargetScripts(appRoot, options = {}) {
  const result = await readNodeTargetScripts(path.resolve(appRoot || process.cwd()), options);
  if (result.ok === false) {
    return result;
  }
  return {
    ok: true,
    packageJsonPath: result.packageJsonPath,
    scriptCount: result.scripts.length,
    scripts: result.scripts
  };
}

function scriptsWithRunnableCommands(scripts = [], packageJson = {}, packageManagerName = "npm") {
  const packageScripts = new Set(Object.keys(packageJson?.scripts || {}));
  return scripts.map((script) => {
    if (!packageScripts.has(script.name)) {
      return {
        ...script,
        commandPreview: targetScriptCommandPreview(script.command)
      };
    }
    const command = runScriptCommand(packageManagerName, script.name);
    return {
      ...script,
      command,
      commandPreview: command
    };
  });
}

async function createNodeTargetScriptTerminalSpec(targetRoot, input = {}, {
  adapterId = "node",
  defaultScriptNames = [],
  extraDockerArgs = [],
  metadata = {},
  syntheticScripts = () => []
} = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const scriptsResult = await readNodeTargetScripts(normalizedTargetRoot, {
    defaultScriptNames,
    syntheticScripts
  });
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  return createAiStudioTargetScriptTerminalSpec({
    adapterId,
    extraDockerArgs,
    input,
    metadata,
    packageManager: scriptsResult.packageManager.name,
    scripts: scriptsWithRunnableCommands(
      scriptsResult.scripts,
      scriptsResult.packageJson,
      scriptsResult.packageManager.name
    ),
    targetRoot: normalizedTargetRoot
  });
}

export {
  missingSyntheticPackageScripts,
  nodeMarkersReady,
  nodeRouterModeFromMarkers,
  readNodeTargetScripts,
  inspectNodeCurrentApp,
  inspectNodeTargetScripts,
  createNodeTargetScriptTerminalSpec,
  targetScriptCommandPreview
};
