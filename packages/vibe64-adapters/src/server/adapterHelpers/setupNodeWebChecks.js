import {
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  detectPackageManager,
  hasDependency
} from "../nodePackage.js";
import {
  readTargetPackageJson
} from "./setupNodePackages.js";

const NODE_WEB_ROUTER_MARKERS = Object.freeze([
  "app",
  "src/app",
  "pages",
  "src/pages"
]);

async function existingNodeWebRouterMarkers(toolkit, targetRoot, {
  markers = NODE_WEB_ROUTER_MARKERS
} = {}) {
  const found = await Promise.all(markers.map(async (relativePath) => {
    return await toolkit.targetFileExists(relativePath, {
      targetRoot
    }) ? relativePath : "";
  }));
  return found.filter(Boolean).sort((left, right) => left.localeCompare(right));
}

async function checkNodeWebRouterMarkers(toolkit, targetRoot, {
  explanation = "",
  id = "",
  label = "Router files",
  missingObserved = "No router directory was found."
} = {}) {
  const markers = await existingNodeWebRouterMarkers(toolkit, targetRoot);
  const expected = "An app/, src/app/, pages/, or src/pages/ router directory exists.";
  if (markers.length === 0) {
    return failCheck({
      id,
      label,
      expected,
      observed: missingObserved,
      explanation
    });
  }
  return passCheck({
    id,
    label,
    expected,
    observed: markers.join(", "),
    explanation
  });
}

function nodePackageUses(packageJson = {}, {
  dependencyName = "",
  scriptPattern = null
} = {}) {
  return hasDependency(packageJson, dependencyName) ||
    Object.values(packageJson?.scripts || {}).some((script) => scriptPattern?.test(String(script || "")));
}

function nodePackageUsesNext(packageJson = {}) {
  return nodePackageUses(packageJson, {
    dependencyName: "next",
    scriptPattern: /\bnext\b/u
  });
}

function packageDependencySummary(packageJson = {}) {
  return Object.keys(packageJson.dependencies || {}).join(", ") || "none";
}

async function checkNodePackageManager(toolkit, targetRoot, {
  explanation = "",
  id = "",
  label = "Package manager"
} = {}) {
  const packageJson = await readTargetPackageJson(targetRoot, toolkit) || {};
  const packageManager = await detectPackageManager(targetRoot, packageJson);
  return passCheck({
    id,
    label,
    expected: "Studio can identify the package manager used by the target.",
    observed: packageManager.lockfile
      ? `${packageManager.name} via ${packageManager.lockfile}`
      : `${packageManager.name} via ${packageManager.source}`,
    explanation
  });
}

async function selectedNodePackageManager(toolkit, targetRoot, {
  fallback = "npm"
} = {}) {
  const packageJson = await readTargetPackageJson(targetRoot, toolkit);
  if (!packageJson) {
    return fallback;
  }
  return (await detectPackageManager(targetRoot, packageJson)).name;
}

export {
  NODE_WEB_ROUTER_MARKERS,
  checkNodePackageManager,
  checkNodeWebRouterMarkers,
  existingNodeWebRouterMarkers,
  nodePackageUsesNext,
  nodePackageUses,
  packageDependencySummary,
  selectedNodePackageManager
};
