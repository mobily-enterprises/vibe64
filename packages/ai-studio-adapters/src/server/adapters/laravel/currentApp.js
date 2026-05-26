import path from "node:path";
import process from "node:process";

import {
  inspectDescribedCurrentApp
} from "../../currentAppInspection.js";
import {
  createAiStudioTargetScriptTerminalSpec,
  targetScriptError
} from "@local/studio-terminal-core/server/targetScriptTerminal";
import {
  detectPackageManager,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  composerDependencyNames,
  composerProjectName,
  composerRunCommand,
  composerScript,
  composerScriptNames,
  hasComposerDependency,
  phpArtisanCommand,
  readComposerJson
} from "./composerPackage.js";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const DEFAULT_TARGET_SCRIPT_NAMES = Object.freeze([
  "dev",
  "test",
  "artisan:serve",
  "artisan:migrate",
  "artisan:test",
  "pint"
]);

const LARAVEL_CURRENT_APP_MARKERS = Object.freeze([
  { id: "composerJson", label: "composer.json", relativePath: "composer.json", kind: "file" },
  { id: "artisan", label: "artisan", relativePath: "artisan", kind: "file" },
  { id: "bootstrapApp", label: "bootstrap/app.php", relativePath: "bootstrap/app.php", kind: "file" },
  { id: "routesWeb", label: "routes/web.php", relativePath: "routes/web.php", kind: "file" },
  { id: "publicIndex", label: "public/index.php", relativePath: "public/index.php", kind: "file" }
]);

const LARAVEL_PROJECT_DIRECTORIES = Object.freeze([
  { id: "app", label: "app", relativePath: "app" },
  { id: "bootstrap", label: "bootstrap", relativePath: "bootstrap" },
  { id: "config", label: "config", relativePath: "config" },
  { id: "database", label: "database", relativePath: "database" },
  { id: "public", label: "public", relativePath: "public" },
  { id: "resources", label: "resources", relativePath: "resources" },
  { id: "routes", label: "routes", relativePath: "routes" },
  { id: "tests", label: "tests", relativePath: "tests" }
]);

function laravelMarkersReady(markers = []) {
  const existing = new Set(markers.filter((marker) => marker.exists).map((marker) => marker.id));
  return existing.has("composerJson") && existing.has("artisan") && existing.has("bootstrapApp");
}

function composerScriptEntries(composerJson = {}) {
  return composerScriptNames(composerJson).map((name) => ({
    command: composerRunCommand(name),
    id: `adapter:${name}`,
    label: name,
    name,
    source: "adapter",
    starredByDefault: DEFAULT_TARGET_SCRIPT_NAMES.includes(name)
  }));
}

function syntheticLaravelScripts(composerJson = {}) {
  const existing = new Set(composerScriptNames(composerJson));
  return [
    ["artisan:serve", phpArtisanCommand(["serve", "--host=0.0.0.0"])],
    ["artisan:migrate", phpArtisanCommand(["migrate"])],
    ["artisan:test", phpArtisanCommand(["test"])],
    ["artisan:route-list", phpArtisanCommand(["route:list"])],
    ["pint", "./vendor/bin/pint"]
  ]
    .filter(([name]) => !existing.has(name))
    .map(([name, command]) => ({
      command,
      id: `adapter:${name}`,
      label: name,
      name,
      source: "adapter",
      starredByDefault: DEFAULT_TARGET_SCRIPT_NAMES.includes(name)
    }));
}

async function inspectConfig(appRoot) {
  const composerJson = await readComposerJson(appRoot) || {};
  const packageJson = await readPackageJson(appRoot) || {};
  const packageManager = await detectPackageManager(appRoot, packageJson);
  return {
    composerName: composerProjectName(composerJson),
    composerScripts: composerScriptNames(composerJson),
    dependencies: composerDependencyNames(composerJson),
    devScript: composerScript(composerJson, "dev"),
    laravelDependency: hasComposerDependency(composerJson, "laravel/framework"),
    nodePackageManager: packageManager,
    packageScripts: Object.keys(packageJson.scripts || {}).sort((left, right) => left.localeCompare(right)),
    testScript: composerScript(composerJson, "test")
  };
}

async function inspectLaravelCurrentApp(targetRoot, {
  includeGit = true
} = {}) {
  return inspectDescribedCurrentApp(targetRoot, {
    adapter: "laravel",
    appPath: "/",
    config: inspectConfig,
    directories: LARAVEL_PROJECT_DIRECTORIES,
    includeGit,
    localPackages: async (appRoot) => {
      const composerJson = await readComposerJson(appRoot) || {};
      return {
        appPackageName: composerProjectName(composerJson),
        packages: []
      };
    },
    markers: LARAVEL_CURRENT_APP_MARKERS,
    ready: laravelMarkersReady
  });
}

async function readLaravelTargetScripts(appRoot) {
  const composerJson = await readComposerJson(appRoot);
  if (!composerJson) {
    return targetScriptError("composer_json_missing", `Cannot find ${path.join(appRoot, "composer.json")}.`, {
      scripts: []
    });
  }
  const scripts = [
    ...composerScriptEntries(composerJson),
    ...syntheticLaravelScripts(composerJson)
  ].sort((left, right) => left.name.localeCompare(right.name));
  return {
    composerJson,
    ok: true,
    scripts
  };
}

async function inspectLaravelTargetScripts(appRoot) {
  const result = await readLaravelTargetScripts(path.resolve(appRoot || process.cwd()));
  if (result.ok === false) {
    return result;
  }
  return {
    ok: true,
    scriptCount: result.scripts.length,
    scripts: result.scripts
  };
}

async function createLaravelTargetScriptTerminalSpec(targetRoot, input = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const scriptsResult = await readLaravelTargetScripts(normalizedTargetRoot);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  return createAiStudioTargetScriptTerminalSpec({
    adapterId: "laravel",
    image: LARAVEL_TOOLCHAIN_IMAGE,
    input,
    scripts: scriptsResult.scripts,
    targetRoot: normalizedTargetRoot
  });
}

function laravelFrontendBuildCommand(packageManagerName = "npm") {
  return runScriptCommand(packageManagerName, "build");
}

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createLaravelTargetScriptTerminalSpec,
  inspectLaravelCurrentApp,
  inspectLaravelTargetScripts,
  laravelFrontendBuildCommand,
  laravelMarkersReady
};
