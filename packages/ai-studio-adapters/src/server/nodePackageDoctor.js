import {
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "@local/ai-studio-core/server/doctorCheckItems";
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

async function checkNodePackageManagerToolchain(toolkit, {
  image = "",
  id = "node-package-manager-toolchain",
  label = "Package manager command",
  packageManager = "npm",
  targetRoot = ""
} = {}) {
  const name = normalizePackageManager(packageManager);
  const displayName = packageManagerDisplayName(name);
  const toolchainLabel = image || "the managed base toolchain image";
  const result = await toolkit.runToolchain([
    "bash",
    "-lc",
    packageManagerAvailabilityScript(name)
  ], {
    ...(image ? { image } : {}),
    targetRoot,
    timeout: 30_000
  });

  if (!result.ok) {
    return failCheck({
      id,
      label,
      expected: `${displayName} is available inside ${toolchainLabel}.`,
      observed: result.output || `${displayName} did not run.`,
      explanation: `AI Studio runs Node project setup, install, scripts, and launch-target commands inside ${toolchainLabel}.`
    });
  }

  return passCheck({
    id,
    label,
    expected: `${displayName} is available inside ${toolchainLabel}.`,
    observed: result.output,
    explanation: "The selected Node package manager is available where Studio runs target commands."
  });
}

export {
  checkNodePackageManagerToolchain,
  normalizePackageManager,
  packageManagerDisplayName
};
