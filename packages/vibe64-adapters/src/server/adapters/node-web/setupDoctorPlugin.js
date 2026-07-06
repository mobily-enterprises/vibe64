import {
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  checkNodePackageManagerHostCommand
} from "../../nodePackageDoctor.js";
import {
  readTargetPackageJson
} from "../../adapterHelpers/setupNodePackages.js";
import {
  checkNodePackageManager,
  selectedNodePackageManager
} from "../../adapterHelpers/setupNodeWebChecks.js";
import {
  selectedGenericNodeWebClientLibrary
} from "./config.js";
import {
  definitionList,
  detectClientLibraries,
  preferredAutomatedCheckScriptName
} from "./projectDetection.js";

async function checkPackageJson(toolkit, targetRoot) {
  const result = await toolkit.readTargetJson("package.json", {
    targetRoot
  });
  if (!result.ok) {
    return failCheck({
      id: "node-web-package-json",
      label: "package.json",
      expected: "A readable package.json exists in the target project root.",
      observed: result.missing ? "package.json is missing." : result.error,
      explanation: "The generic Node web adapter uses package metadata as its source of truth. Create or restore package.json before Project Setup continues."
    });
  }
  return passCheck({
    id: "node-web-package-json",
    label: "package.json",
    expected: "A readable package.json exists in the target project root.",
    observed: result.path,
    explanation: "The target has package metadata for generic Node web inspection."
  });
}

async function setupPackageManager(toolkit, targetRoot) {
  return selectedNodePackageManager(toolkit, targetRoot, {
    fallback: "npm"
  });
}

async function checkPackageManagerHostCommand(toolkit, targetRoot) {
  return checkNodePackageManagerHostCommand(toolkit, {
    id: "node-web-package-manager-host-command",
    label: "Package manager command",
    packageManager: await setupPackageManager(toolkit, targetRoot),
    targetRoot
  });
}

async function checkClientLibrary(toolkit, targetRoot, config = {}) {
  const packageJson = await readTargetPackageJson(targetRoot, toolkit);
  const configured = selectedGenericNodeWebClientLibrary(config);
  const detected = detectClientLibraries({
    packageJson: packageJson || {}
  });
  const detectedLabel = definitionList(detected) || "none detected";
  return passCheck({
    id: "node-web-client-library",
    label: "Client library",
    expected: "Client library preference is explicit or auto-detected from package metadata.",
    observed: configured === "auto"
      ? `Auto-detect; detected: ${detectedLabel}`
      : `Configured: ${configured}; detected: ${detectedLabel}`,
    explanation: "Generic Node web prompts use this value to avoid assuming the wrong frontend library."
  });
}

async function checkPackageScripts(toolkit, targetRoot) {
  const packageJson = await readTargetPackageJson(targetRoot, toolkit);
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object"
    ? Object.keys(packageJson.scripts).sort((left, right) => left.localeCompare(right))
    : [];
  if (!scripts.length) {
    return failCheck({
      id: "node-web-package-scripts",
      label: "Package scripts",
      expected: "package.json declares scripts Studio can show as target commands.",
      observed: "No package scripts were found.",
      explanation: "This does not block setup, but target-script and automated-check workflows are more useful when package scripts exist.",
      required: false
    });
  }
  const preferredCheck = preferredAutomatedCheckScriptName(packageJson || {});
  return passCheck({
    id: "node-web-package-scripts",
    label: "Package scripts",
    expected: "package.json declares scripts Studio can show as target commands.",
    observed: [
      `Scripts: ${scripts.join(", ")}`,
      preferredCheck ? `Preferred automated check: ${preferredCheck}` : "Preferred automated check: none"
    ].join("\n"),
    explanation: "Studio exposes package scripts as adapter target commands."
  });
}

function createGenericNodeWebSetupDoctorPlugin({
  runCommand,
  startTerminalSession = null,
  studioRoot = "",
  targetRoot = "",
  terminalEnv = {},
  terminalNamespace = ""
} = {}) {
  const toolkit = createDoctorPluginToolkit({
    runCommand,
    startTerminalSession,
    studioRoot,
    targetRoot,
    terminalEnv,
    terminalNamespace
  });

  return toolkit.plugin({
    id: "generic-node-web",
    label: "Generic Node web",
    checks: (context = {}) => [
      {
        id: "node-web-package-json",
        label: "package.json",
        run: () => checkPackageJson(toolkit, context.targetRoot || targetRoot)
      },
      {
        id: "node-web-package-manager",
        label: "Package manager",
        run: () => checkNodePackageManager(toolkit, context.targetRoot || targetRoot, {
          explanation: "Studio uses the detected package manager for install, script, launch, and verification commands.",
          id: "node-web-package-manager",
          label: "Package manager"
        })
      },
      {
        id: "node-web-package-manager-host-command",
        label: "Package manager command",
        run: () => checkPackageManagerHostCommand(toolkit, context.targetRoot || targetRoot)
      },
      {
        id: "node-web-client-library",
        label: "Client library",
        run: () => checkClientLibrary(toolkit, context.targetRoot || targetRoot, context.config || {})
      },
      {
        id: "node-web-package-scripts",
        label: "Package scripts",
        run: () => checkPackageScripts(toolkit, context.targetRoot || targetRoot)
      }
    ]
  });
}

export {
  createGenericNodeWebSetupDoctorPlugin
};
