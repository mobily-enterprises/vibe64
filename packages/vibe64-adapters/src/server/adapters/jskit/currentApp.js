import {
  readdir
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";

import {
  inspectDescribedCurrentApp,
  inspectPackageTargetScripts,
  packageScriptEntries,
  readJsonFile
} from "../../currentAppInspection.js";
import {
  createVibe64TargetScriptTerminalSpec
} from "@local/studio-terminal-core/server/targetScriptTerminal";
import {
  normalizePlainObject
} from "@local/vibe64-core/server/serverResponses";
import {
  readDatabaseHostFromDotEnv
} from "./setupMariaDbRuntime.js";

const DEFAULT_TARGET_SCRIPT_NAMES = Object.freeze([
  "jskit:update",
  "build",
  "server",
  "verify"
]);

const JSKIT_CURRENT_APP_MARKERS = Object.freeze([
  { id: "packageJson", label: "package.json", relativePath: "package.json", kind: "file" },
  { id: "publicConfig", label: "config/public.js", relativePath: "config/public.js", kind: "file" },
  { id: "clientEntry", label: "src/main.js", relativePath: "src/main.js", kind: "file" },
  {
    id: "mainDescriptor",
    label: "packages/main/package.descriptor.mjs",
    relativePath: "packages/main/package.descriptor.mjs",
    kind: "file"
  },
  { id: "jskitLock", label: ".jskit/lock.json", relativePath: ".jskit/lock.json", kind: "file" }
]);

const JSKIT_PROJECT_DIRECTORIES = Object.freeze([
  { id: "src", label: "src", relativePath: "src" },
  { id: "packages", label: "packages", relativePath: "packages" },
  { id: "tests", label: "tests", relativePath: "tests" }
]);

async function defaultAppPath(appRoot) {
  try {
    const appConfig = await loadAppConfigFromAppRoot({
      appRoot
    });
    const surfaceDefaultId = String(appConfig?.surfaceDefaultId || "").trim().replace(/^\/+/u, "");
    return surfaceDefaultId ? `/${surfaceDefaultId}` : "/";
  } catch {
    return "/";
  }
}

function targetScriptCommandPreview(scriptName = "") {
  return `npm run ${String(scriptName || "").trim()}`;
}

async function inspectLocalPackages(appRoot) {
  const packagesRoot = path.join(appRoot, "packages");
  const packageJson = await readJsonFile(path.join(appRoot, "package.json")) || {};
  let packageDirectories = [];
  try {
    packageDirectories = await readdir(packagesRoot, {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return {
    appPackageName: String(packageJson.name || ""),
    packages: packageDirectories
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  };
}

async function readPackageScripts(appRoot) {
  return inspectPackageTargetScripts(appRoot, {
    defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES
  });
}

async function inspectJskitTargetScripts(appRoot) {
  const scriptsResult = await readPackageScripts(appRoot);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  return scriptsResult;
}

function normalizePackageNamesFromManifest(packageJson) {
  const dependencies = normalizePlainObject(packageJson?.dependencies);
  const devDependencies = normalizePlainObject(packageJson?.devDependencies);
  return Object.keys({
    ...dependencies,
    ...devDependencies
  }).sort((left, right) => left.localeCompare(right));
}

function normalizeInstalledPackages(lockJson) {
  const packages = normalizePlainObject(lockJson?.packages);
  return Object.keys(packages)
    .map((packagePath) => String(packagePath || "").replace(/^node_modules\//u, ""))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function packageIdMatches(packageId, fragments = []) {
  const normalizedPackageId = String(packageId || "").toLowerCase();
  return fragments.some((fragment) => normalizedPackageId.includes(fragment));
}

function detectRuntimeNeeds({
  installedPackages = [],
  packageNames = []
} = {}) {
  const allPackageNames = [...new Set([...packageNames, ...installedPackages])];
  return {
    needsDatabase: allPackageNames.some((packageId) => {
      return packageIdMatches(packageId, ["mysql", "mariadb", "sequelize", "knex"]);
    }),
    needsRedis: allPackageNames.some((packageId) => {
      return packageIdMatches(packageId, ["redis", "ioredis"]);
    })
  };
}

function normalizeSurfaces(appConfig) {
  const surfaces = normalizePlainObject(appConfig?.surfaces);
  return Object.keys(surfaces).sort((left, right) => left.localeCompare(right));
}

async function inspectConfig(appRoot) {
  const [packageJson, packageLockJson] = await Promise.all([
    readJsonFile(path.join(appRoot, "package.json")),
    readJsonFile(path.join(appRoot, "package-lock.json"))
  ]);
  let appConfig = null;
  try {
    appConfig = await loadAppConfigFromAppRoot({
      appRoot
    });
  } catch {
    appConfig = null;
  }
  const packageNames = normalizePackageNamesFromManifest(packageJson);
  const installedPackages = normalizeInstalledPackages(packageLockJson);
  return {
    appConfigReady: Boolean(appConfig),
    packageNames,
    runtimeNeeds: detectRuntimeNeeds({
      installedPackages,
      packageNames
    }),
    scripts: packageScriptEntries(packageJson, {
      defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES
    }),
    surfaces: normalizeSurfaces(appConfig)
  };
}

async function inspectJskitCurrentApp(targetRoot, {
  includeGit = true
} = {}) {
  return inspectDescribedCurrentApp(targetRoot, {
    adapter: "jskit",
    appPath: defaultAppPath,
    config: inspectConfig,
    directories: JSKIT_PROJECT_DIRECTORIES,
    includeGit,
    localPackages: inspectLocalPackages,
    markers: JSKIT_CURRENT_APP_MARKERS
  });
}

async function createJskitTargetScriptTerminalSpec(targetRoot, input = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const scriptsResult = await readPackageScripts(normalizedTargetRoot);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  const databaseHost = await readDatabaseHostFromDotEnv(normalizedTargetRoot);
  return createVibe64TargetScriptTerminalSpec({
    adapterId: "jskit",
    input,
    metadata: {
      databaseHost
    },
    scripts: scriptsResult.scripts.map((script) => ({
      ...script,
      command: targetScriptCommandPreview(script.name),
      commandPreview: targetScriptCommandPreview(script.name)
    })),
    targetRoot: normalizedTargetRoot,
    workdir: normalizedTargetRoot
  });
}

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createJskitTargetScriptTerminalSpec,
  inspectJskitCurrentApp,
  inspectJskitTargetScripts,
  targetScriptCommandPreview
};
