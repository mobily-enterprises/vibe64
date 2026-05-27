import path from "node:path";

import {
  blockedDoctorCheck as blockedCheck,
  formatDoctorList as formatList,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  allDependencyNames,
  checkNodeDependencies,
  nodeInstallRepair,
  nodeInstallScript,
  nodeInstallTerminalAction,
  readTargetPackageJson
} from "../../adapterHelpers/setupNodePackages.js";
import {
  configImportProblems
} from "../../adapterHelpers/setupPackageImports.js";
import {
  checkPackageVerificationCommand
} from "../../adapterHelpers/setupVerificationChecks.js";
import {
  checkJskitDatabaseRuntime,
  createDatabaseTerminalAction,
  managedDatabaseEnvTerminalAction,
  seedDatabaseEnvTerminalAction
} from "./setupDatabasePolicy.js";
import {
  checkJskitScaffold,
  scaffoldCommandPreview,
  scaffoldScript
} from "./setupScaffold.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

function jskitInstallOptions() {
  return {
    actionId: "terminal-npm-install",
    image: JSKIT_TOOLCHAIN_IMAGE,
    installCommand: "npm install",
    label: "Install dependencies",
    updateDependencyPrefix: "@jskit-ai/",
    updateVariableName: "jskit_deps"
  };
}

function npmInstallScript() {
  return nodeInstallScript(jskitInstallOptions());
}

function npmInstallTerminalAction(targetRoot, toolkit) {
  return nodeInstallTerminalAction(targetRoot, toolkit, jskitInstallOptions());
}

function npmInstallRepair(targetRoot, toolkit) {
  return nodeInstallRepair(targetRoot, toolkit, jskitInstallOptions());
}

function jskitDependencyNames(packageJson, jskitLock) {
  return allDependencyNames(packageJson, jskitLock?.installedPackages || {});
}

function targetUsesJskitDatabase(packageJson, jskitLock) {
  return [...jskitDependencyNames(packageJson, jskitLock)]
    .some((name) => name.includes("database-runtime"));
}

function targetUsesJskitMariaDb(packageJson, jskitLock) {
  return [...jskitDependencyNames(packageJson, jskitLock)]
    .some((name) => name.includes("database-runtime-mysql"));
}

function targetUsesJskitPostgres(packageJson, jskitLock) {
  return [...jskitDependencyNames(packageJson, jskitLock)]
    .some((name) => name.includes("database-runtime-postgres"));
}

async function targetHasJskitCliTooling(targetRoot, toolkit) {
  const hasJskitBin = await toolkit.targetFileExists(path.join("node_modules", ".bin", "jskit"), { targetRoot });
  const hasJskitCli = await toolkit.targetFileExists(path.join("node_modules", "@jskit-ai", "jskit-cli"), { targetRoot });
  return hasJskitBin || hasJskitCli;
}

async function checkDependencies(targetRoot, context, toolkit) {
  const packageJson = await readTargetPackageJson(targetRoot, toolkit);
  context.packageJson = packageJson;
  if (!packageJson) {
    return passCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "Dependencies are installed once a JSKIT app exists.",
      observed: "package.json is not present yet.",
      explanation: "The seed workflow creates the JSKIT app before the session installs dependencies."
    });
  }

  const dependencyResult = await checkNodeDependencies(toolkit, {
    expected: "All direct non-optional package.json dependencies are installed.",
    explanation: "Install dependencies before checking runtime readiness or later workflow commands.",
    id: "dependencies",
    label: "Dependencies runnable",
    packageJson,
    repair: npmInstallRepair(targetRoot, toolkit),
    targetRoot
  });
  if (dependencyResult.status !== "pass") {
    return dependencyResult;
  }

  const importProblems = await configImportProblems(targetRoot, toolkit);
  if (importProblems.length) {
    return blockedCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "Config-file package imports resolve from installed node_modules.",
      observed: formatList(importProblems, 8),
      explanation: "The target lockfile can pin stale JSKIT packages that install successfully but do not provide exports used by generated config files.",
      repair: npmInstallRepair(targetRoot, toolkit)
    });
  }

  if (await targetHasJskitCliTooling(targetRoot, toolkit)) {
    return passCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "JSKIT CLI dependency is installed locally.",
      observed: "node_modules contains JSKIT CLI tooling.",
      explanation: "Local JSKIT commands can run in the target project.",
      repair: npmInstallRepair(targetRoot, toolkit)
    });
  }

  return blockedCheck({
    id: "dependencies",
    label: "Dependencies runnable",
    expected: "Local dependencies are installed.",
    observed: "node_modules does not contain JSKIT CLI tooling.",
    explanation: "Install dependencies before checking runtime readiness or later workflow commands.",
    repair: npmInstallRepair(targetRoot, toolkit)
  });
}

async function checkRuntimeServices(targetRoot, context, toolkit) {
  const packageJson = context.packageJson || await readTargetPackageJson(targetRoot, toolkit);
  if (!packageJson) {
    return passCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "Runtime services are checked once the JSKIT app declares them.",
      observed: "package.json is not present yet.",
      explanation: "The seed workflow creates the app and selects JSKIT database/runtime modules before runtime service checks apply."
    });
  }
  if (!targetUsesJskitDatabase(packageJson, context.jskitLock)) {
    return passCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "No runtime service is required unless the target project asks for one.",
      observed: "No JSKIT database runtime package detected.",
      explanation: "Fresh minimal scaffolds do not require a database."
    });
  }

  if (targetUsesJskitPostgres(packageJson, context.jskitLock) && !targetUsesJskitMariaDb(packageJson, context.jskitLock)) {
    return hardStopCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "This JSKIT setup plugin supports the MariaDB-compatible JSKIT runtime.",
      observed: "Postgres runtime package detected.",
      explanation: "Postgres service orchestration belongs in the JSKIT adapter before this target can be set up automatically."
    });
  }

  return checkJskitDatabaseRuntime(toolkit, {
    targetRoot
  });
}

async function checkJskitVerificationCommand(targetRoot, toolkit) {
  const packageJson = await readTargetPackageJson(targetRoot, toolkit);
  if (!packageJson) {
    return passCheck({
      id: "jskit-verification-command",
      label: "JSKIT verification command",
      expected: "A verification command is available once the JSKIT app exists.",
      observed: "package.json is not present yet.",
      explanation: "The seed workflow creates the app before later workflow validation runs JSKIT verification."
    });
  }
  return checkPackageVerificationCommand(toolkit, {
    binObserved: "npx jskit app verify",
    expected: "package.json declares a verify script or the local JSKIT CLI is installed.",
    id: "jskit-verification-command",
    label: "JSKIT verification command",
    missingPackageRepair: npmInstallRepair(targetRoot, toolkit),
    missingRepair: npmInstallRepair(targetRoot, toolkit),
    missingScriptObserved: "No package.json verify script and no installed @jskit-ai/jskit-cli bin were found.",
    packageBin: {
      binName: "jskit",
      packageName: "@jskit-ai/jskit-cli"
    },
    packageMissingObserved: "package.json could not be read.",
    scriptName: "verify",
    scriptObservedPrefix: "npm run verify",
    targetRoot
  });
}

function createJskitProjectSetupChecks(toolkit) {
  return {
    dependencies: {
      expected: "Node dependencies are installed enough to run JSKIT commands.",
      id: "dependencies",
      label: "Dependencies runnable",
      run: (context = {}) => checkDependencies(context.targetRoot || "", context, toolkit)
    },
    verificationCommand: {
      expected: "A JSKIT verification command is available for later workflow checks.",
      id: "jskit-verification-command",
      label: "JSKIT verification command",
      run: ({ targetRoot = "" } = {}) => checkJskitVerificationCommand(targetRoot, toolkit)
    },
    runtimeServices: {
      expected: "Only runtime services required by the target project are reachable.",
      id: "runtime-services",
      label: "Runtime services",
      run: (context = {}) => checkRuntimeServices(context.targetRoot || "", context, toolkit)
    },
    scaffold: {
      expected: "Minimal JSKIT scaffold markers exist.",
      id: "scaffold",
      label: "Seed JSKIT app",
      run: (context = {}) => checkJskitScaffold(context.targetRoot || "", context, toolkit)
    }
  };
}

function createJskitProjectSetupTerminalActions({
  targetRoot = "",
  toolkit = null
} = {}) {
  if (!toolkit) {
    return [];
  }

  return [
    npmInstallTerminalAction(targetRoot, toolkit),
    seedDatabaseEnvTerminalAction(targetRoot, toolkit),
    managedDatabaseEnvTerminalAction(targetRoot, toolkit),
    createDatabaseTerminalAction(targetRoot, toolkit)
  ];
}

export {
  createJskitProjectSetupChecks,
  createJskitProjectSetupTerminalActions,
  npmInstallScript,
  scaffoldCommandPreview,
  scaffoldScript
};
