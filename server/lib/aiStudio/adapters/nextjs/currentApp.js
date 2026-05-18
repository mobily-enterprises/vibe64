import {
  createNodeTargetScriptTerminalSpec,
  inspectNodeCurrentApp,
  inspectNodeTargetScripts,
  missingSyntheticPackageScripts,
  nodeMarkersReady,
  nodeRouterModeFromMarkers,
  targetScriptCommandPreview
} from "../../nodeCurrentApp.js";
import {
  dependencyNames as packageDependencyNames,
  detectPackageManager,
  packageBinCommand,
  packageScript,
  readPackageJson
} from "../../nodePackage.js";
import {
  nextjsRuntimeDockerArgs
} from "./databaseRuntime.js";

const DEFAULT_TARGET_SCRIPT_NAMES = Object.freeze([
  "dev",
  "build",
  "start",
  "next:build",
  "next:dev",
  "next:start"
]);

const NEXTJS_CURRENT_APP_MARKERS = Object.freeze([
  { id: "packageJson", label: "package.json", relativePath: "package.json", kind: "file" },
  { id: "appRouter", label: "app/", relativePath: "app", kind: "directory" },
  { id: "srcAppRouter", label: "src/app/", relativePath: "src/app", kind: "directory" },
  { id: "pagesRouter", label: "pages/", relativePath: "pages", kind: "directory" },
  { id: "srcPagesRouter", label: "src/pages/", relativePath: "src/pages", kind: "directory" },
  { id: "nextConfigJs", label: "next.config.js", relativePath: "next.config.js", kind: "file" },
  { id: "nextConfigMjs", label: "next.config.mjs", relativePath: "next.config.mjs", kind: "file" },
  { id: "nextConfigTs", label: "next.config.ts", relativePath: "next.config.ts", kind: "file" }
]);

const NEXTJS_PROJECT_DIRECTORIES = Object.freeze([
  { id: "app", label: "app", relativePath: "app" },
  { id: "src", label: "src", relativePath: "src" },
  { id: "pages", label: "pages", relativePath: "pages" },
  { id: "public", label: "public", relativePath: "public" }
]);

const NEXTJS_ROUTER_MARKER_IDS = Object.freeze([
  "appRouter",
  "srcAppRouter",
  "pagesRouter",
  "srcPagesRouter"
]);

function nextjsMarkersReady(markers = []) {
  return nodeMarkersReady(markers, NEXTJS_ROUTER_MARKER_IDS);
}

function syntheticNextjsScripts(packageJson, packageManager) {
  return missingSyntheticPackageScripts({
    defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES,
    definitions: [
      ["next:dev", packageBinCommand(packageManager.name, "next", ["dev", "-H", "0.0.0.0"])],
      ["next:build", packageBinCommand(packageManager.name, "next", ["build"])],
      ["next:start", packageBinCommand(packageManager.name, "next", ["start", "-H", "0.0.0.0"])],
      ["next:info", packageBinCommand(packageManager.name, "next", ["info"])]
    ],
    packageJson
  });
}

function routerModeFromMarkers(markers = []) {
  return nodeRouterModeFromMarkers(markers);
}

async function inspectConfig(appRoot, markers) {
  const packageJson = await readPackageJson(appRoot) || {};
  const packageManager = await detectPackageManager(appRoot, packageJson);
  return {
    buildScript: packageScript(packageJson, "build"),
    dependencies: packageDependencyNames(packageJson),
    devScript: packageScript(packageJson, "dev"),
    nextConfig: markers.some((marker) => marker.id.startsWith("nextConfig") && marker.exists),
    packageManager,
    routerMode: routerModeFromMarkers(markers),
    startScript: packageScript(packageJson, "start")
  };
}

async function inspectNextjsCurrentApp(targetRoot, {
  includeGit = true
} = {}) {
  return inspectNodeCurrentApp(targetRoot, {
    adapter: "nextjs",
    appPath: "/",
    config: (appRoot, { markers = [] } = {}) => inspectConfig(appRoot, markers),
    directories: NEXTJS_PROJECT_DIRECTORIES,
    includeGit,
    localPackages: async (appRoot) => {
      const packageJson = await readPackageJson(appRoot) || {};
      return {
        appPackageName: String(packageJson.name || ""),
        packages: []
      };
    },
    markers: NEXTJS_CURRENT_APP_MARKERS,
    ready: nextjsMarkersReady
  });
}

async function inspectNextjsTargetScripts(appRoot) {
  return inspectNodeTargetScripts(appRoot, {
    defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES,
    syntheticScripts: syntheticNextjsScripts
  });
}

async function createNextjsTargetScriptTerminalSpec(targetRoot, input = {}, {
  config = {}
} = {}) {
  return createNodeTargetScriptTerminalSpec(targetRoot, input, {
    adapterId: "nextjs",
    defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES,
    extraDockerArgs: nextjsRuntimeDockerArgs({
      config,
      targetRoot
    }),
    syntheticScripts: syntheticNextjsScripts
  });
}

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createNextjsTargetScriptTerminalSpec,
  inspectNextjsCurrentApp,
  inspectNextjsTargetScripts,
  targetScriptCommandPreview
};
