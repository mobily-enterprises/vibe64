import {
  blockedDoctorCheck as blockedCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  packageScript,
  readTargetPackageJson
} from "./setupNodePackages.js";

async function localPackageBinExists(toolkit, {
  binName = "",
  packageName = "",
  packagePath = "",
  targetRoot = ""
} = {}) {
  if (packagePath && await toolkit.targetFileExists(packagePath, {
    targetRoot
  })) {
    return true;
  }
  if (!packageName) {
    return false;
  }
  const packageJson = await toolkit.readTargetJson(`node_modules/${packageName}/package.json`, {
    targetRoot
  });
  if (!packageJson.ok || !packageJson.value?.bin) {
    return false;
  }
  if (!binName) {
    return true;
  }
  const bin = packageJson.value.bin;
  return typeof bin === "string"
    ? packageName.endsWith(`/${binName}`) || packageName === binName
    : Boolean(bin[binName]);
}

async function checkPackageVerificationCommand(toolkit, {
  binObserved = "",
  expected = "package.json declares a verification script or local verification CLI is installed.",
  id = "verification-command",
  label = "Verification command",
  missingPackageRepair = null,
  missingRepair = null,
  missingScriptObserved = "No package.json verify script or local verification CLI was found.",
  packageBin = null,
  packageJson = null,
  packageMissingObserved = "package.json could not be read.",
  scriptName = "verify",
  scriptObservedPrefix = "",
  targetRoot = ""
} = {}) {
  const manifest = packageJson || await readTargetPackageJson(targetRoot, toolkit);
  if (!manifest) {
    return blockedCheck({
      id,
      label,
      expected,
      observed: packageMissingObserved,
      explanation: "Studio only checks that verification is available for the later workflow stage; it does not run verification during Project Setup.",
      repair: missingPackageRepair
    });
  }

  const verifyScript = packageScript(manifest, scriptName);
  if (verifyScript) {
    return passCheck({
      id,
      label,
      expected,
      observed: [scriptObservedPrefix || `npm run ${scriptName}`, verifyScript].filter(Boolean).join("\n"),
      explanation: "The workflow can run the target verification command later without blocking Project Setup on current lint, test, or policy failures."
    });
  }

  if (packageBin && await localPackageBinExists(toolkit, {
    ...packageBin,
    targetRoot
  })) {
    return passCheck({
      id,
      label,
      expected,
      observed: binObserved || "Local verification CLI is installed.",
      explanation: "The local verification CLI is installed, so the workflow can run verification later."
    });
  }

  return blockedCheck({
    id,
    label,
    expected,
    observed: missingScriptObserved,
    explanation: "Install dependencies or add a package verification script so the later workflow has a concrete verification command.",
    repair: missingRepair
  });
}

export {
  checkPackageVerificationCommand,
  localPackageBinExists
};
