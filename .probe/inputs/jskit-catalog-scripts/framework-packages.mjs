import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "./files.mjs";

const BUILTIN_SINGLETON_PACKAGE_IDS = Object.freeze(["@jskit-ai/kernel"]);

// The JSKIT framework packages are the direct children of packagesRoot whose
// package.json declares `jskit` metadata. The catalog builder and the package
// verifier both read this one set.
async function discoverFrameworkPackages(packagesRoot) {
  const packages = [];
  for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageRoot = path.join(packagesRoot, entry.name);
    const manifestPath = path.join(packageRoot, "package.json");
    if (!(await fileExists(manifestPath))) {
      continue;
    }
    const packageJson = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!packageJson.jskit) {
      continue;
    }
    packages.push({ packageRoot, manifestPath, packageJson });
  }
  return packages.sort((left, right) => String(left.packageJson.name || "").localeCompare(String(right.packageJson.name || "")));
}

// Packages that own shared client runtime state: the kernel plus every package
// marked `jskit.metadata.client.singleton`.
function collectSingletonPackageIds(packageJsons) {
  return [...new Set([
    ...BUILTIN_SINGLETON_PACKAGE_IDS,
    ...packageJsons
      .filter((packageJson) => packageJson?.jskit?.metadata?.client?.singleton === true)
      .map((packageJson) => packageJson.name)
  ])].sort((left, right) => left.localeCompare(right));
}

export {
  collectSingletonPackageIds,
  discoverFrameworkPackages
};
