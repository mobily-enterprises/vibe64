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
  readPackageJson,
  scriptUsesVinext
} from "./packageManager.js";

const DEFAULT_TARGET_SCRIPT_NAMES = Object.freeze([
  "dev:vinext",
  "build:vinext",
  "start:vinext",
  "vinext:check",
  "vinext:build",
  "vinext:dev"
]);

const VINEXT_CURRENT_APP_MARKERS = Object.freeze([
  { id: "packageJson", label: "package.json", relativePath: "package.json", kind: "file" },
  { id: "appRouter", label: "app/", relativePath: "app", kind: "directory" },
  { id: "srcAppRouter", label: "src/app/", relativePath: "src/app", kind: "directory" },
  { id: "pagesRouter", label: "pages/", relativePath: "pages", kind: "directory" },
  { id: "srcPagesRouter", label: "src/pages/", relativePath: "src/pages", kind: "directory" },
  { id: "viteConfig", label: "vite.config.ts", relativePath: "vite.config.ts", kind: "file" },
  { id: "nextConfig", label: "next.config.ts", relativePath: "next.config.ts", kind: "file" },
  { id: "wranglerConfig", label: "wrangler.jsonc", relativePath: "wrangler.jsonc", kind: "file" }
]);

const VINEXT_PROJECT_DIRECTORIES = Object.freeze([
  { id: "app", label: "app", relativePath: "app" },
  { id: "src", label: "src", relativePath: "src" },
  { id: "pages", label: "pages", relativePath: "pages" },
  { id: "public", label: "public", relativePath: "public" }
]);

const VINEXT_ROUTER_MARKER_IDS = Object.freeze([
  "appRouter",
  "srcAppRouter",
  "pagesRouter",
  "srcPagesRouter"
]);

function vinextMarkersReady(markers = []) {
  return nodeMarkersReady(markers, VINEXT_ROUTER_MARKER_IDS);
}

function syntheticVinextScripts(packageJson, packageManager) {
  return missingSyntheticPackageScripts({
    defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES,
    definitions: [
      ["vinext:check", packageBinCommand(packageManager.name, "vinext", ["check"])],
      ["vinext:build", packageBinCommand(packageManager.name, "vinext", ["build"])],
      ["vinext:dev", packageBinCommand(packageManager.name, "vinext", ["dev", "--hostname", "0.0.0.0"])],
      ["vinext:start", packageBinCommand(packageManager.name, "vinext", ["start", "--hostname", "0.0.0.0"])],
      ["vinext:deploy:dry-run", packageBinCommand(packageManager.name, "vinext", ["deploy", "--dry-run"])]
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
    buildScript: packageScript(packageJson, "build:vinext") || packageScript(packageJson, "build"),
    cloudflare: markers.some((marker) => ["wranglerConfig"].includes(marker.id) && marker.exists),
    dependencies: packageDependencyNames(packageJson),
    devScript: packageScript(packageJson, "dev:vinext") || packageScript(packageJson, "dev"),
    packageManager,
    routerMode: routerModeFromMarkers(markers),
    startScript: packageScript(packageJson, "start:vinext") || packageScript(packageJson, "start"),
    vinextScript: Object.values(packageJson.scripts || {}).some(scriptUsesVinext)
  };
}

async function inspectVinextCurrentApp(targetRoot, {
  includeGit = true
} = {}) {
  return inspectNodeCurrentApp(targetRoot, {
    adapter: "vinext",
    appPath: "/",
    config: (appRoot, { markers = [] } = {}) => inspectConfig(appRoot, markers),
    directories: VINEXT_PROJECT_DIRECTORIES,
    includeGit,
    localPackages: async (appRoot) => {
      const packageJson = await readPackageJson(appRoot) || {};
      return {
        appPackageName: String(packageJson.name || ""),
        packages: []
      };
    },
    markers: VINEXT_CURRENT_APP_MARKERS,
    ready: vinextMarkersReady
  });
}

async function inspectVinextTargetScripts(appRoot) {
  return inspectNodeTargetScripts(appRoot, {
    defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES,
    syntheticScripts: syntheticVinextScripts
  });
}

async function createVinextTargetScriptTerminalSpec(targetRoot, input = {}) {
  return createNodeTargetScriptTerminalSpec(targetRoot, input, {
    adapterId: "vinext",
    defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES,
    syntheticScripts: syntheticVinextScripts
  });
}

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createVinextTargetScriptTerminalSpec,
  inspectVinextCurrentApp,
  inspectVinextTargetScripts,
  targetScriptCommandPreview
};
