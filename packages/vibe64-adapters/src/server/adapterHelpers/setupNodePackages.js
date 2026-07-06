import path from "node:path";

import {
  blockedDoctorCheck as blockedCheck,
  formatDoctorList as formatList,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_TARGETS
} from "@local/vibe64-core/server/runtimeConfig";
import {
  shellScript
} from "@local/studio-terminal-core/server/shellScript";
import {
  directDependencyNames,
  packageScript
} from "../nodePackage.js";

async function readTargetPackageJson(targetRoot, toolkit) {
  const result = await toolkit.readTargetJson("package.json", {
    targetRoot
  });
  return result.ok ? result.value : null;
}

function allDependencyNames(packageJson = {}, extraDependencies = {}) {
  const names = new Set();
  for (const bucket of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(packageJson?.[bucket] || {})) {
      names.add(name);
    }
  }
  for (const name of Object.keys(extraDependencies || {})) {
    names.add(name);
  }
  return names;
}

function nodeModulePackageJsonPath(targetRoot, packageName) {
  return path.join(targetRoot, "node_modules", ...String(packageName || "").split("/"), "package.json");
}

async function missingDirectDependencies(targetRoot, packageJson, toolkit) {
  const missing = [];
  for (const packageName of directDependencyNames(packageJson)) {
    if (!await toolkit.fileExists(nodeModulePackageJsonPath(targetRoot, packageName))) {
      missing.push(packageName);
    }
  }
  return missing;
}

function nodeInstallScript({
  installCommand = "npm install",
  updateDependencyPrefix = "",
  updateVariableName = "updated_deps"
} = {}) {
  const lines = [
    "set -e",
    "set -x",
    installCommand
  ];
  if (updateDependencyPrefix) {
    lines.push(
      `${updateVariableName}=$(node -e "const p=require('./package.json'); const deps={...(p.dependencies||{}), ...(p.devDependencies||{})}; console.log(Object.keys(deps).filter((name) => name.startsWith('${updateDependencyPrefix}')).join(' '));")`,
      `if [ -n "$${updateVariableName}" ]; then npm update $${updateVariableName}; fi`
    );
  }
  return shellScript(lines);
}

function nodeInstallTerminalAction(targetRoot, toolkit, {
  actionId = "terminal-node-install",
  installCommand = "npm install",
  label = "Install dependencies",
  runtimeConfigEnvironment = null,
  runtimeConfigPhases = [RUNTIME_CONFIG_PHASES.INSTALL],
  updateDependencyPrefix = "",
  updateVariableName = "updated_deps"
} = {}) {
  return toolkit.hostCommandTerminalAction({
    actionId,
    autoRun: true,
    commandArgs: ["bash", "-lc", nodeInstallScript({
      installCommand,
      updateDependencyPrefix,
      updateVariableName
    })],
    commandPreview: installCommand,
    env: async (context = {}) => setupRuntimeConfigEnv({
      context,
      runtimeConfigEnvironment,
      runtimeConfigPhases,
      targetRoot
    }),
    label,
    targetRoot
  });
}

async function setupRuntimeConfigEnv({
  context = {},
  runtimeConfigEnvironment = null,
  runtimeConfigPhases = [],
  targetRoot = ""
} = {}) {
  if (typeof runtimeConfigEnvironment !== "function") {
    return {};
  }
  return runtimeConfigEnvironment({
    phases: runtimeConfigPhases,
    target: RUNTIME_CONFIG_TARGETS.COMMAND,
    targetRoot: context.targetRoot || targetRoot
  });
}

function nodeInstallRepair(targetRoot, toolkit, options = {}) {
  return nodeInstallTerminalAction(targetRoot, toolkit, options).repair({
    targetRoot
  });
}

async function checkNodeDependencies(toolkit, {
  expected = "All direct non-optional package.json dependencies are installed.",
  explanation = "Install dependencies before checking runtime readiness or later workflow commands.",
  id = "dependencies",
  label = "Dependencies runnable",
  packageJson = null,
  repair = null,
  targetRoot = ""
} = {}) {
  const manifest = packageJson || await readTargetPackageJson(targetRoot, toolkit);
  if (!manifest) {
    return blockedCheck({
      id,
      label,
      expected: "package.json exists before dependency installation.",
      observed: "package.json is missing.",
      explanation: "Dependencies can only be installed after the target project exists."
    });
  }

  const missing = await missingDirectDependencies(targetRoot, manifest, toolkit);
  if (missing.length) {
    return blockedCheck({
      id,
      label,
      expected,
      observed: `Missing node_modules packages:\n${formatList(missing)}`,
      explanation,
      repair
    });
  }

  return passCheck({
    id,
    label,
    expected,
    observed: "Direct dependencies are installed.",
    explanation
  });
}

export {
  allDependencyNames,
  checkNodeDependencies,
  directDependencyNames,
  missingDirectDependencies,
  nodeInstallRepair,
  nodeInstallScript,
  nodeInstallTerminalAction,
  packageScript,
  readTargetPackageJson
};
