import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  dependencyNames,
  detectPackageManager,
  directDependencyNames,
  fileExists,
  hasDependency,
  installCommand,
  packageBinCommand,
  packageManagerAvailabilityScript,
  packageScript,
  packageScripts,
  readPackageJson,
  runScriptCommand,
  scriptNames
} from "../../nodePackage.js";

function scriptUsesVinext(value = "") {
  return /\bvinext\b/u.test(String(value || ""));
}

function hasVinextScript(packageJson = {}) {
  return Object.values(packageScripts(packageJson)).some(scriptUsesVinext);
}

function initVinextCommand({
  port = 3001,
  version = "latest"
} = {}) {
  return `npx --yes vinext@${shellQuote(version)} init --skip-check --port ${shellQuote(String(port))}`;
}

export {
  dependencyNames,
  detectPackageManager,
  directDependencyNames,
  fileExists,
  hasDependency,
  hasVinextScript,
  initVinextCommand,
  installCommand,
  packageBinCommand,
  packageManagerAvailabilityScript,
  packageScript,
  readPackageJson,
  runScriptCommand,
  scriptNames,
  scriptUsesVinext
};
