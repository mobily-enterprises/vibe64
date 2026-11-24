import path from "node:path";
import process from "node:process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { collectSingletonPackageIds, discoverFrameworkPackages } from "./framework-packages.mjs";
import {
  assertUniquePatternIds,
  discoverPackagePatterns
} from "./pattern-assets.mjs";
import { discoverProjectManifests } from "./project-manifests.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");

function parseInlineArg(name) {
  const args = process.argv.slice(2);
  const exactPrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const candidate = String(args[index] || "").trim();
    if (!candidate) {
      continue;
    }
    if (candidate === name) {
      const next = String(args[index + 1] || "").trim();
      return next || "";
    }
    if (candidate.startsWith(exactPrefix)) {
      return candidate.slice(exactPrefix.length).trim();
    }
  }
  return "";
}

async function collectReleasePackageVersions(repoRoot) {
  const rootManifestPath = path.join(repoRoot, "package.json");
  const versions = new Map();
  for (const { absolutePath, value: packageJson } of await discoverProjectManifests(repoRoot)) {
    const packageId = String(packageJson?.name || "").trim();
    const version = String(packageJson?.version || "").trim();
    if (absolutePath === rootManifestPath || !packageId.startsWith("@jskit-ai/") || packageJson.private === true) {
      continue;
    }
    if (!/^\d+\.\d+\.\d+$/u.test(version)) {
      throw new Error(`Published JSKIT workspace ${packageId} requires an exact x.y.z version.`);
    }
    versions.set(packageId, version);
  }

  return Object.fromEntries([...versions].sort(([left], [right]) => left.localeCompare(right)));
}

async function buildCatalog({ repoRoot, packagesRoot, outputPath }) {
  const frameworkPackages = await discoverFrameworkPackages(packagesRoot);
  const entries = [];
  const patterns = [];

  for (const { packageRoot, manifestPath: packageJsonPath, packageJson } of frameworkPackages) {
    const packageId = String(packageJson?.name || "").trim();
    const version = String(packageJson?.version || "").trim();
    const jskit = packageJson?.jskit && typeof packageJson.jskit === "object" && !Array.isArray(packageJson.jskit)
      ? packageJson.jskit
      : null;

    if (!packageId) {
      throw new Error(`Missing package name in ${packageJsonPath}`);
    }
    if (!jskit) {
      throw new Error(`Missing jskit metadata in ${packageJsonPath}`);
    }
    if (!version) {
      throw new Error(`Missing version for ${packageId} in ${packageRoot}`);
    }

    entries.push({
      packageId,
      version,
      ...(String(packageJson.description || "").trim()
        ? { description: String(packageJson.description).trim() }
        : {}),
      jskit,
      packageJson: Object.fromEntries(
        ["dependencies", "optionalDependencies", "peerDependencies"]
          .filter((sectionName) => packageJson[sectionName] && typeof packageJson[sectionName] === "object")
          .map((sectionName) => [sectionName, packageJson[sectionName]])
      )
    });

    patterns.push(...await discoverPackagePatterns({
      packageRoot,
      packageJson
    }));
  }

  assertUniquePatternIds(patterns);

  const catalog = {
    schemaVersion: 3,
    source: {
      kind: "packages-directory"
    },
    release: {
      packages: await collectReleasePackageVersions(repoRoot),
      singletonPackages: collectSingletonPackageIds(frameworkPackages.map(({ packageJson }) => packageJson))
    },
    packages: entries.sort((left, right) => left.packageId.localeCompare(right.packageId)),
    patterns: patterns.sort((left, right) => left.id.localeCompare(right.id))
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

async function main() {
  const repoRootArg = parseInlineArg("--repo-root");
  const packagesRootArg = parseInlineArg("--packages-root");
  const outputArg = parseInlineArg("--output");

  const repoRoot = path.resolve(repoRootArg || process.env.JSKIT_REPO_ROOT || DEFAULT_REPO_ROOT);
  const packagesRoot = path.resolve(packagesRootArg || path.join(repoRoot, "packages"));
  const outputPath = path.resolve(outputArg || path.join(PACKAGE_ROOT, "catalog", "packages.json"));

  await buildCatalog({ repoRoot, packagesRoot, outputPath });
  process.stdout.write(`Catalog written: ${outputPath}\n`);
}

await main();
