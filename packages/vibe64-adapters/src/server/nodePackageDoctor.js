import {
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  packageManagerAvailabilityScript
} from "./nodePackage.js";
import {
  DEFAULT_NODE_PACKAGE_MANAGER,
  nodePackageManagerDisplayName,
  normalizeNodePackageManager
} from "./nodePackageManagers.js";

function normalizePackageManager(value = "") {
  return normalizeNodePackageManager(value, DEFAULT_NODE_PACKAGE_MANAGER);
}

function packageManagerDisplayName(packageManager = DEFAULT_NODE_PACKAGE_MANAGER) {
  return nodePackageManagerDisplayName(packageManager);
}

async function checkNodePackageManagerHostCommand(toolkit, {
  id = "node-package-manager-host-command",
  label = "Package manager command",
  packageManager = "npm",
  targetRoot = ""
} = {}) {
  const name = normalizePackageManager(packageManager);
  const displayName = packageManagerDisplayName(name);
  const result = await toolkit.runHostToolCommand([
    "bash",
    "-lc",
    packageManagerAvailabilityScript(name)
  ], {
    targetRoot,
    timeout: 30_000
  });

  if (!result.ok) {
    return failCheck({
      id,
      label,
      expected: `${displayName} is available on the host.`,
      observed: result.output || `${displayName} did not run.`,
      explanation: "Vibe64 runs Node project setup, installs, scripts, and launch targets through the host package manager."
    });
  }

  return passCheck({
    id,
    label,
    expected: `${displayName} is available on the host.`,
    observed: result.output,
    explanation: "The selected Node package manager is available where Vibe64 runs target commands."
  });
}

export {
  checkNodePackageManagerHostCommand,
  normalizePackageManager,
  packageManagerDisplayName
};
