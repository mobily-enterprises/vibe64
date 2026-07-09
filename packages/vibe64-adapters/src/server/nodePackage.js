import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  runtimeRequirement,
  runtimeShellCommandArgs
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  isPlainObject,
} from "@local/vibe64-core/server/core";
import {
  DEFAULT_NODE_PACKAGE_MANAGER,
  normalizeNodePackageManagerSpec
} from "./nodePackageManagers.js";

const LOCKFILE_PACKAGE_MANAGERS = Object.freeze([
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"]
]);
const NODE_RUNTIME_DISPOSABLE_PATHS = Object.freeze([
  "node_modules"
]);

function normalizePackageManagerName(value = "") {
  return normalizeNodePackageManagerSpec(value);
}

async function fileExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(root = "") {
  const packageJsonPath = path.join(root, "package.json");
  try {
    return JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function dependencyBuckets(packageJson = {}) {
  return [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies
  ].filter(isPlainObject);
}

function dependencyNames(packageJson = {}) {
  return [...new Set(dependencyBuckets(packageJson).flatMap((bucket) => Object.keys(bucket)))]
    .sort((left, right) => left.localeCompare(right));
}

function directDependencyNames(packageJson = {}) {
  return [...new Set([
    ...Object.keys(isPlainObject(packageJson.dependencies) ? packageJson.dependencies : {}),
    ...Object.keys(isPlainObject(packageJson.devDependencies) ? packageJson.devDependencies : {})
  ])].sort((left, right) => left.localeCompare(right));
}

function hasDependency(packageJson = {}, name = "") {
  return dependencyBuckets(packageJson).some((bucket) => Object.hasOwn(bucket, name));
}

function packageScripts(packageJson = {}) {
  return isPlainObject(packageJson.scripts) ? packageJson.scripts : {};
}

function scriptNames(packageJson = {}) {
  return Object.keys(packageScripts(packageJson))
    .sort((left, right) => left.localeCompare(right));
}

function packageScript(packageJson = {}, scriptName = "") {
  const value = packageScripts(packageJson)[scriptName];
  return typeof value === "string" ? value.trim() : "";
}

async function detectPackageManager(root = "", packageJson = null) {
  const resolvedRoot = path.resolve(root || process.cwd());
  for (const [lockfile, packageManager] of LOCKFILE_PACKAGE_MANAGERS) {
    if (await fileExists(path.join(resolvedRoot, lockfile))) {
      return {
        lockfile,
        name: packageManager,
        source: "lockfile"
      };
    }
  }
  const packageManager = normalizePackageManagerName(packageJson?.packageManager);
  if (packageManager) {
    return {
      lockfile: "",
      name: packageManager,
      source: "package.json"
    };
  }
  return {
    lockfile: "",
    name: DEFAULT_NODE_PACKAGE_MANAGER,
    source: "default"
  };
}

function nodeRuntimePackageIds(packageManager = DEFAULT_NODE_PACKAGE_MANAGER) {
  return normalizePackageManagerName(packageManager) === "bun"
    ? ["nodejs-22", "bun"]
    : ["nodejs-22"];
}

function nodeRuntimeRequirements({
  packageManager = DEFAULT_NODE_PACKAGE_MANAGER
} = {}) {
  return nodeRuntimePackageIds(packageManager).map((packageId) => runtimeRequirement(packageId, {
    tool: packageId === "bun" ? "bun" : "node"
  }));
}

async function nodeRuntimeRequirementsForTarget({
  packageJson = null,
  packageManager = "",
  targetRoot = ""
} = {}) {
  const selectedPackageManager = normalizePackageManagerName(packageManager);
  if (selectedPackageManager) {
    return nodeRuntimeRequirements({
      packageManager: selectedPackageManager
    });
  }
  if (!targetRoot) {
    return nodeRuntimeRequirements();
  }
  const detectedPackageJson = packageJson || await readPackageJson(targetRoot);
  const detectedPackageManager = await detectPackageManager(targetRoot, detectedPackageJson);
  return nodeRuntimeRequirements({
    packageManager: detectedPackageManager.name
  });
}

function runtimeShellCommand(packageIds = [], script = "") {
  return runtimeShellCommandArgs(packageIds, script, {
    preferSharedRuntimePacks: true
  }).map(shellQuote).join(" ");
}

function nodeRuntimeShellCommand(script = "", packageManager = DEFAULT_NODE_PACKAGE_MANAGER) {
  return runtimeShellCommand(nodeRuntimePackageIds(packageManager), script);
}

function packageManagerInstallCommand(packageManager = DEFAULT_NODE_PACKAGE_MANAGER) {
  if (packageManager === "pnpm") {
    return "corepack pnpm install";
  }
  if (packageManager === "yarn") {
    return "corepack yarn install";
  }
  if (packageManager === "bun") {
    return "bun install";
  }
  return "npm install --foreground-scripts --no-audit --no-fund";
}

function installCommand(packageManager = DEFAULT_NODE_PACKAGE_MANAGER) {
  const normalizedPackageManager = normalizePackageManagerName(packageManager) || DEFAULT_NODE_PACKAGE_MANAGER;
  return nodeRuntimeShellCommand(packageManagerInstallCommand(normalizedPackageManager), normalizedPackageManager);
}

function packageManagerRunScriptCommand(packageManager = DEFAULT_NODE_PACKAGE_MANAGER, scriptName = "", extraArgs = []) {
  const quotedScript = shellQuote(scriptName);
  const quotedExtra = extraArgs.map(shellQuote).join(" ");
  if (packageManager === "pnpm") {
    return ["corepack pnpm run", quotedScript, quotedExtra ? `-- ${quotedExtra}` : ""].filter(Boolean).join(" ");
  }
  if (packageManager === "yarn") {
    return ["corepack yarn run", quotedScript, quotedExtra].filter(Boolean).join(" ");
  }
  if (packageManager === "bun") {
    return ["bun run", quotedScript, quotedExtra].filter(Boolean).join(" ");
  }
  return ["npm run", quotedScript, quotedExtra ? `-- ${quotedExtra}` : ""].filter(Boolean).join(" ");
}

function runScriptCommand(packageManager = DEFAULT_NODE_PACKAGE_MANAGER, scriptName = "", extraArgs = []) {
  const normalizedPackageManager = normalizePackageManagerName(packageManager) || DEFAULT_NODE_PACKAGE_MANAGER;
  return nodeRuntimeShellCommand(
    packageManagerRunScriptCommand(normalizedPackageManager, scriptName, extraArgs),
    normalizedPackageManager
  );
}

function packageManagerBinCommand(packageManager = DEFAULT_NODE_PACKAGE_MANAGER, bin = "", args = []) {
  const quotedBin = shellQuote(bin);
  const quotedArgs = args.map(shellQuote).join(" ");
  if (packageManager === "pnpm") {
    return ["corepack pnpm exec", quotedBin, quotedArgs].filter(Boolean).join(" ");
  }
  if (packageManager === "yarn") {
    return ["corepack yarn", quotedBin, quotedArgs].filter(Boolean).join(" ");
  }
  if (packageManager === "bun") {
    return ["bunx", quotedBin, quotedArgs].filter(Boolean).join(" ");
  }
  return ["npx --no-install", quotedBin, quotedArgs].filter(Boolean).join(" ");
}

function packageBinCommand(packageManager = DEFAULT_NODE_PACKAGE_MANAGER, bin = "", args = []) {
  const normalizedPackageManager = normalizePackageManagerName(packageManager) || DEFAULT_NODE_PACKAGE_MANAGER;
  return nodeRuntimeShellCommand(
    packageManagerBinCommand(normalizedPackageManager, bin, args),
    normalizedPackageManager
  );
}

function packageManagerAvailabilityCommand(packageManager = DEFAULT_NODE_PACKAGE_MANAGER) {
  if (packageManager === "pnpm") {
    return "command -v corepack >/dev/null 2>&1 && corepack pnpm --version";
  }
  if (packageManager === "yarn") {
    return "command -v corepack >/dev/null 2>&1 && corepack yarn --version";
  }
  if (packageManager === "bun") {
    return "command -v bun >/dev/null 2>&1 && bun --version";
  }
  return "npm --version";
}

function packageManagerAvailabilityScript(packageManager = DEFAULT_NODE_PACKAGE_MANAGER) {
  const normalizedPackageManager = normalizePackageManagerName(packageManager) || DEFAULT_NODE_PACKAGE_MANAGER;
  return nodeRuntimeShellCommand(
    packageManagerAvailabilityCommand(normalizedPackageManager),
    normalizedPackageManager
  );
}

export {
  dependencyNames,
  detectPackageManager,
  directDependencyNames,
  fileExists,
  hasDependency,
  installCommand,
  NODE_RUNTIME_DISPOSABLE_PATHS,
  nodeRuntimePackageIds,
  nodeRuntimeRequirements,
  nodeRuntimeRequirementsForTarget,
  nodeRuntimeShellCommand,
  packageBinCommand,
  packageManagerInstallCommand,
  packageManagerAvailabilityScript,
  packageManagerRunScriptCommand,
  packageScript,
  packageScripts,
  readPackageJson,
  runScriptCommand,
  scriptNames
};
