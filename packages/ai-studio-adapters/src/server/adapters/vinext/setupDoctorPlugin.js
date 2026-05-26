import {
  createDoctorRepair,
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "@local/ai-studio-core/server/doctorCheckItems";
import {
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  readTargetPackageJson
} from "../../adapterHelpers/setupNodePackages.js";
import {
  checkNodePackageManager,
  checkNodeWebRouterMarkers,
  nodePackageUsesNext,
  packageDependencySummary
} from "../../adapterHelpers/setupNodeWebChecks.js";
import {
  hasDependency,
  hasVinextScript,
  initVinextCommand
} from "./packageManager.js";

function vinextInitRepair() {
  return createDoctorRepair({
    actionId: "terminal-vinext-init",
    autoRun: true,
    command: initVinextCommand({
      port: 3001
    }),
    kind: "terminal",
    label: "Run vinext init"
  });
}

function vinextInitScript() {
  return [
    "set -e",
    initVinextCommand({
      port: 3001
    })
  ].join("\n");
}

function packageUsesVinext(packageJson = {}) {
  return hasDependency(packageJson, "vinext") || hasVinextScript(packageJson);
}

async function checkPackageJson(toolkit, targetRoot) {
  const result = await toolkit.readTargetJson("package.json", {
    targetRoot
  });
  if (!result.ok) {
    return failCheck({
      id: "vinext-package-json",
      label: "package.json",
      expected: "A readable package.json exists in the target project.",
      observed: result.missing ? "package.json is missing." : result.error,
      explanation: "Vinext projects are Node package projects; create or migrate a Next.js app before selecting this adapter."
    });
  }
  return passCheck({
    id: "vinext-package-json",
    label: "package.json",
    expected: "A readable package.json exists in the target project.",
    observed: result.path,
    explanation: "The target has package metadata for Vinext setup."
  });
}

async function checkVinextMigration(toolkit, targetRoot) {
  const packageJson = await readTargetPackageJson(targetRoot, toolkit);
  if (!packageJson) {
    return failCheck({
      id: "vinext-migration",
      label: "Vinext migration",
      expected: "package.json declares Vinext or a Vinext package script.",
      observed: "package.json is missing.",
      explanation: "Run project setup on a Node package before Vinext migration."
    });
  }
  if (packageUsesVinext(packageJson)) {
    return passCheck({
      id: "vinext-migration",
      label: "Vinext migration",
      expected: "package.json declares Vinext or a Vinext package script.",
      observed: "Vinext dependency or script is present.",
      explanation: "The target is configured for Vinext commands."
    });
  }
  const isMigrationCandidate = nodePackageUsesNext(packageJson);
  return failCheck({
    id: "vinext-migration",
    label: "Vinext migration",
    expected: "package.json declares Vinext or a Vinext package script.",
    observed: isMigrationCandidate
      ? "Next.js project detected; Vinext migration has not run."
      : `Dependencies: ${packageDependencySummary(packageJson)}`,
    explanation: isMigrationCandidate
      ? "Run vinext init to add Vinext dependencies, scripts, and Vite config without removing the existing Next.js setup."
      : "This package is not recognisable as a Vinext or Next.js project.",
    repair: isMigrationCandidate ? vinextInitRepair() : null
  });
}

function createVinextSetupDoctorPlugin({
  configEnvironment = {},
  startTerminalSession,
  studioRoot = "",
  targetRoot = "",
  terminalNamespace = ""
} = {}) {
  const toolkit = createDoctorPluginToolkit({
    startTerminalSession,
    studioRoot,
    targetRoot,
    terminalEnv: configEnvironment,
    terminalNamespace
  });
  const initTerminal = toolkit.shellTerminalAction({
    actionId: "terminal-vinext-init",
    autoRun: true,
    commandPreview: () => vinextInitRepair().commandPreview,
    cwd: ({ targetRoot = "" } = {}) => targetRoot,
    env: configEnvironment,
    label: "Run vinext init",
    script: vinextInitScript
  });

  return toolkit.plugin({
    id: "vinext-target-runtime",
    label: "Vinext target runtime",
    checks(context = {}) {
      const checkTargetRoot = context.targetRoot || targetRoot;
      return [
        {
          expected: "A readable package.json exists in the target project.",
          id: "vinext-package-json",
          label: "package.json",
          run: () => checkPackageJson(toolkit, checkTargetRoot)
        },
        {
          expected: "An app/, src/app/, pages/, or src/pages/ router directory exists.",
          id: "vinext-router",
          label: "Router files",
          run: () => checkNodeWebRouterMarkers(toolkit, checkTargetRoot, {
            explanation: "Vinext runs Next-compatible App Router and Pages Router projects.",
            id: "vinext-router",
            label: "Router files",
            missingObserved: "No Vinext-compatible router directory was found."
          })
        },
        {
          expected: "package.json declares Vinext or a Vinext package script.",
          id: "vinext-migration",
          label: "Vinext migration",
          run: () => checkVinextMigration(toolkit, checkTargetRoot)
        },
        {
          expected: "Studio can identify the package manager used by the target.",
          id: "vinext-package-manager",
          label: "Package manager",
          run: () => checkNodePackageManager(toolkit, checkTargetRoot, {
            explanation: "Vinext workflow commands will use this package manager for install and CLI execution.",
            id: "vinext-package-manager",
            label: "Package manager"
          })
        }
      ];
    },
    terminalActions: [
      initTerminal
    ]
  });
}

export {
  createVinextSetupDoctorPlugin,
  vinextInitRepair
};
