#!/usr/bin/env node
import { globSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fileExists } from "./files.mjs";
import {
  assertUniquePatternIds,
  discoverPackagePatterns
} from "./pattern-assets.mjs";
import { collectSingletonPackageIds, discoverFrameworkPackages } from "./framework-packages.mjs";
import { discoverProjectManifests, readJsonRecord } from "./project-manifests.mjs";
import { checkTestRuns, formatTestRunsReport } from "./test-runs.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");
const ARCHITECTURE_ID_PATTERN = /^[a-z][a-z0-9_.-]*$/u;
const LOCAL_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const BUILTIN_CAPABILITIES = new Set([
  "client.vue",
  "client.router",
  "client.pinia",
  "client.query",
  "client.env",
  "client.surface",
  "client.surface-mode",
  "client.logger",
  "client.components",
  "runtime.actions",
  "runtime.app-root",
  "runtime.bootstrap",
  "runtime.config",
  "runtime.env",
  "runtime.events",
  "runtime.fastify",
  "runtime.http",
  "runtime.logger"
]);
const ALLOWED_JSKIT_FIELDS = new Set([
  "capabilities",
  "kind",
  "metadata",
  "migrations",
  "runtime",
  "vite"
]);
const FORBIDDEN_AUTHORING_FIELDS = new Set([
  "ci",
  "lifecycle",
  "mutations",
  "optionPolicies",
  "options"
]);

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => !String(item || "").trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  const normalized = value.map((item) => String(item).trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicates.`);
  }
  return normalized;
}

function requireArchitectureId(value, label) {
  const normalized = String(value || "").trim();
  if (!ARCHITECTURE_ID_PATTERN.test(normalized)) {
    throw new Error(`${label} must match ${ARCHITECTURE_ID_PATTERN.toString()}.`);
  }
  return normalized;
}

function validateCapabilityMap(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object mapping local names to capability ids.`);
  }
  const capabilityIds = new Set();
  for (const [localName, capabilityId] of Object.entries(value)) {
    if (!LOCAL_NAME_PATTERN.test(localName)) {
      throw new Error(`${label} local name "${localName}" must be a JavaScript identifier.`);
    }
    const normalizedCapabilityId = requireArchitectureId(capabilityId, `${label}.${localName}`);
    if (capabilityIds.has(normalizedCapabilityId)) {
      throw new Error(`${label} declares capability "${normalizedCapabilityId}" more than once.`);
    }
    capabilityIds.add(normalizedCapabilityId);
  }
}

function validateProviderDefinition(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must export a capability provider definition.`);
  }
  requireArchitectureId(value.id, `${label}.id`);
  validateCapabilityMap(value.requires, `${label}.requires`);
  validateCapabilityMap(value.optional, `${label}.optional`);
  validateCapabilityMap(value.provides, `${label}.provides`);
  // readable-check: allow method-probe - input validation: a package's provider export is checked before the catalog lists it
  if (typeof value.setup !== "function") {
    throw new Error(`${label}.setup must be a function.`);
  }
  for (const lifecycleMethod of ["boot", "shutdown"]) {
    // readable-check: allow method-probe - input validation: a package's provider export is checked before the catalog lists it
    if (value[lifecycleMethod] != null && typeof value[lifecycleMethod] !== "function") {
      throw new Error(`${label}.${lifecycleMethod} must be a function or null.`);
    }
  }
}

function validateProviderExport(value, label) {
  const providers = Array.isArray(value) ? value : [value];
  if (providers.length < 1) {
    throw new Error(`${label} must contain at least one capability provider definition.`);
  }
  providers.forEach((provider, index) => {
    validateProviderDefinition(provider, providers.length === 1 ? label : `${label}[${index}]`);
  });
  return providers.length;
}

async function validateProviderList(packageRecord, side) {
  const { packageJson, packageRoot } = packageRecord;
  const label = `${packageJson.name}#jskit.runtime.${side}.providers`;
  const providers = packageJson.jskit?.runtime?.[side]?.providers || [];
  if (!Array.isArray(providers)) {
    throw new Error(`${label} must be an array.`);
  }
  let providerCount = 0;
  await Promise.all(providers.map(async (provider, index) => {
    const entrypoint = String(provider?.entrypoint || "").trim();
    const exportName = String(provider?.export || "").trim();
    if (!entrypoint || !exportName) {
      throw new Error(`${label}[${index}] requires entrypoint and export.`);
    }
    if (path.isAbsolute(entrypoint) || entrypoint.startsWith("../")) {
      throw new Error(`${label}[${index}].entrypoint must stay inside its package.`);
    }
    const absoluteEntrypoint = path.resolve(packageRoot, entrypoint);
    if (!(await fileExists(absoluteEntrypoint))) {
      throw new Error(`${label}[${index}] points at missing ${entrypoint}.`);
    }

    if (side !== "server") {
      return;
    }

    let namespace;
    try {
      namespace = await import(pathToFileURL(absoluteEntrypoint).href);
    } catch (error) {
      throw new Error(
        `${label}[${index}] could not load ${entrypoint}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    if (!Object.hasOwn(namespace, exportName)) {
      throw new Error(`${label}[${index}] export "${exportName}" was not found in ${entrypoint}.`);
    }
    providerCount += validateProviderExport(namespace[exportName], `${label}[${index}] export "${exportName}"`);
  }));
  return providerCount;
}

async function validateMigrations(packageRecord, migrationOwners) {
  const { packageJson, packageRoot } = packageRecord;
  const directories = packageJson.jskit?.migrations?.directories;
  validateMigrationsAfter(packageJson);
  if (typeof directories === "undefined") {
    return;
  }
  for (const relativeDirectory of requireStringArray(
    directories,
    `${packageJson.name}#jskit.migrations.directories`
  )) {
    if (path.isAbsolute(relativeDirectory) || relativeDirectory === ".." || relativeDirectory.startsWith("../")) {
      throw new Error(`${packageJson.name} migration directory must stay inside its package.`);
    }
    const absoluteDirectory = path.resolve(packageRoot, relativeDirectory);
    const entries = await validateMigrationDirectory(packageJson.name, absoluteDirectory, relativeDirectory, migrationOwners);
    // A constraints/ subdirectory runs after the application's migrations; see knexMigrationConfig.js.
    if (entries.some((entry) => entry.isDirectory() && entry.name === "constraints")) {
      await validateMigrationDirectory(
        packageJson.name,
        path.join(absoluteDirectory, "constraints"),
        path.posix.join(relativeDirectory, "constraints"),
        migrationOwners
      );
    }
  }
}

// jskit.migrations.after names packages whose migrations the package's own follow; see
// knexMigrationConfig.js. A catalog package depends on each of them.
function validateMigrationsAfter(packageJson) {
  const after = packageJson.jskit?.migrations?.after;
  if (typeof after === "undefined") {
    return;
  }
  if (typeof packageJson.jskit.migrations.directories === "undefined") {
    throw new Error(`${packageJson.name}#jskit.migrations.after needs jskit.migrations.directories.`);
  }
  for (const prerequisite of requireStringArray(after, `${packageJson.name}#jskit.migrations.after`)) {
    if (prerequisite === packageJson.name) {
      throw new Error(`${packageJson.name}#jskit.migrations.after names the package itself.`);
    }
    if (!Object.hasOwn(packageJson.dependencies || {}, prerequisite) &&
      !Object.hasOwn(packageJson.peerDependencies || {}, prerequisite)) {
      throw new Error(`${packageJson.name}#jskit.migrations.after names ${prerequisite}, which it does not depend on.`);
    }
  }
}

async function validateMigrationDirectory(packageName, absoluteDirectory, relativeDirectory, migrationOwners) {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    throw new Error(`${packageName} migration directory is missing: ${relativeDirectory}.`);
  }
  const migrations = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".cjs"));
  if (migrations.length < 1) {
    throw new Error(`${packageName} migration directory contains no .cjs migrations.`);
  }
  for (const migration of migrations.sort((left, right) => left.name.localeCompare(right.name))) {
    const previous = migrationOwners.get(migration.name);
    if (previous) {
      throw new Error(`Migration filename ${migration.name} is owned by both ${previous} and ${packageName}.`);
    }
    migrationOwners.set(migration.name, packageName);

    const migrationPath = path.join(absoluteDirectory, migration.name);
    let namespace;
    try {
      namespace = await import(pathToFileURL(migrationPath).href);
    } catch (error) {
      throw new Error(
        `${packageName} migration ${migration.name} could not load: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    const migrationModule = namespace.default && typeof namespace.default === "object"
      ? namespace.default
      : namespace;
    // readable-check: allow method-probe - input validation: a package's migration module is checked before the catalog lists it
    if (typeof migrationModule.up !== "function" || typeof migrationModule.down !== "function") {
      throw new Error(`${packageName} migration ${migration.name} must export up() and down().`);
    }
  }
  return entries;
}

// Each apiSummary surface names an entrypoint the package exports, or a group of them ("./server" for its "./server/..."
// subpaths), so the catalog never describes an import that fails.
function validateApiSummarySurfaces(packageJson) {
  const exported = packageJson.exports && typeof packageJson.exports === "object" ? Object.keys(packageJson.exports) : [];
  for (const { subpath } of packageJson.jskit?.metadata?.apiSummary?.surfaces || []) {
    if (!exported.some((entry) => entry === subpath || entry.startsWith(`${subpath}/`))) {
      throw new Error(`${packageJson.name}#jskit.metadata.apiSummary describes ${subpath}, which the package does not export.`);
    }
  }
}

// Each component that jskit.metadata.ui.removedProps lists is one the package exports as ./client/components/<name>,
// with a hint for each removed prop, so jskit check's ui/removed-prop judges a component an app can import.
function validateRemovedProps(packageJson) {
  const exported = packageJson.exports && typeof packageJson.exports === "object" ? packageJson.exports : {};
  for (const [component, props] of Object.entries(packageJson.jskit?.metadata?.ui?.removedProps || {})) {
    if (!exported[`./client/components/${component}`]) {
      throw new Error(`${packageJson.name}#jskit.metadata.ui.removedProps lists ${component}, which the package does not export as ./client/components/${component}.`);
    }
    for (const [prop, hint] of Object.entries(props || {})) {
      if (typeof hint !== "string" || !hint.trim()) {
        throw new Error(`${packageJson.name}#jskit.metadata.ui.removedProps.${component}.${prop} says nothing; say what to do instead.`);
      }
    }
  }
}

async function validatePackage(packageRecord, localVersions, migrationOwners) {
  const { packageJson, packageRoot, manifestPath } = packageRecord;
  const packageId = String(packageJson.name || "").trim();
  const version = String(packageJson.version || "").trim();
  if (!packageId.startsWith("@jskit-ai/") || !/^0\.\d+\.\d+$/u.test(version)) {
    throw new Error(`${manifestPath} requires an @jskit-ai name and exact version-0 semver.`);
  }
  if (packageJson.jskit.kind !== "runtime") {
    throw new Error(`${packageId}#jskit.kind must be runtime; generator packages do not exist.`);
  }
  for (const field of Object.keys(packageJson.jskit)) {
    if (!ALLOWED_JSKIT_FIELDS.has(field)) {
      throw new Error(`${packageId}#jskit contains unsupported field ${field}.`);
    }
  }
  for (const field of FORBIDDEN_AUTHORING_FIELDS) {
    if (Object.hasOwn(packageJson.jskit, field)) {
      throw new Error(`${packageId} must not declare authoring field jskit.${field}.`);
    }
  }

  const provides = requireStringArray(
    packageJson.jskit.capabilities?.provides || [],
    `${packageId}#jskit.capabilities.provides`
  );
  const requires = requireStringArray(
    packageJson.jskit.capabilities?.requires || [],
    `${packageId}#jskit.capabilities.requires`
  );
  if (provides.some((capability) => requires.includes(capability))) {
    throw new Error(`${packageId} cannot both provide and require the same capability.`);
  }

  validateApiSummarySurfaces(packageJson);
  validateRemovedProps(packageJson);
  const serverProviderCount = await validateProviderList(packageRecord, "server");
  await validateProviderList(packageRecord, "client");
  await validateMigrations(packageRecord, migrationOwners);

  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [dependencyId, declaredVersion] of Object.entries(packageJson[section] || {})) {
      if (localVersions.has(dependencyId) && declaredVersion !== localVersions.get(dependencyId)) {
        throw new Error(
          `${packageId}#${section}.${dependencyId} is ${declaredVersion}; expected ${localVersions.get(dependencyId)}.`
        );
      }
    }
  }

  const patterns = await discoverPackagePatterns({ packageRoot, packageJson });
  return { patterns, serverProviderCount };
}

function validateCapabilityClosure(packages, { builtinCapabilities = BUILTIN_CAPABILITIES } = {}) {
  const providedCapabilities = new Set(builtinCapabilities);
  for (const { packageJson } of packages) {
    for (const capabilityId of packageJson.jskit?.capabilities?.provides || []) {
      providedCapabilities.add(requireArchitectureId(
        capabilityId,
        `${packageJson.name}#jskit.capabilities.provides[]`
      ));
    }
  }

  for (const { packageJson } of packages) {
    const requirements = packageJson.jskit?.capabilities?.requires || [];
    const applicationRequirements = requireStringArray(
      packageJson.jskit?.capabilities?.applicationRequires || [],
      `${packageJson.name}#jskit.capabilities.applicationRequires`
    );
    for (const capabilityId of applicationRequirements) {
      requireArchitectureId(capabilityId, `${packageJson.name}#jskit.capabilities.applicationRequires[]`);
      if (!requirements.includes(capabilityId)) {
        throw new Error(`${packageJson.name} application requirement ${capabilityId} must also appear in requires.`);
      }
    }
    for (const capabilityId of requirements) {
      const normalizedCapabilityId = requireArchitectureId(
        capabilityId,
        `${packageJson.name}#jskit.capabilities.requires[]`
      );
      if (!providedCapabilities.has(normalizedCapabilityId) && !applicationRequirements.includes(normalizedCapabilityId)) {
        throw new Error(
          `${packageJson.name} requires capability ${normalizedCapabilityId}, but neither the kernel nor a framework package provides it.`
        );
      }
    }
  }
}

// The application's one table runtime: a package that takes it as a dependency can install a second copy of it beside
// the application's, with its own tables, transactions and error classes. Every package takes it as a peer.
const TABLE_RUNTIME_PACKAGE_IDS = Object.freeze(["@jskit-ai/database-runtime", "@jskit-ai/resource-runtime"]);

function validateSingletonPeerDependencies(packages) {
  const singletonPackageIds = new Set(collectSingletonPackageIds(packages.map(({ packageJson }) => packageJson)));

  for (const { packageJson } of packages) {
    for (const section of ["dependencies", "optionalDependencies"]) {
      for (const dependencyId of Object.keys(packageJson[section] || {})) {
        if (TABLE_RUNTIME_PACKAGE_IDS.includes(dependencyId)) {
          throw new Error(
            `${packageJson.name}#${section}.${dependencyId} must be declared in peerDependencies because ` +
            `${dependencyId} is the application's one table runtime.`
          );
        }
        if (!singletonPackageIds.has(dependencyId)) {
          continue;
        }
        throw new Error(
          `${packageJson.name}#${section}.${dependencyId} must be declared in peerDependencies because ` +
          `${dependencyId} owns shared client runtime state.`
        );
      }
    }
  }
}

// JSKIT's own package scripts and every pattern example an application copies run tests within the test budget.
async function verifyTestRuns() {
  const examples = globSync("packages/*/patterns/*/example/**/package.json", {
    cwd: REPO_ROOT,
    exclude: (name) => path.basename(name) === "node_modules"
  });
  const manifests = [
    ...await discoverProjectManifests(REPO_ROOT),
    ...await Promise.all(examples.sort().map((file) => readJsonRecord(path.join(REPO_ROOT, file))))
  ];
  const result = await checkTestRuns({ projectRoot: REPO_ROOT, manifests });
  if (!result.ok) {
    throw new Error(formatTestRunsReport(result));
  }
  return result.manifests;
}

async function main() {
  const packages = await discoverFrameworkPackages(PACKAGES_ROOT);
  const localVersions = new Map(packages.map(({ packageJson }) => [packageJson.name, packageJson.version]));
  const migrationOwners = new Map();
  const patterns = [];
  let serverProviderCount = 0;
  validateCapabilityClosure(packages);
  validateSingletonPeerDependencies(packages);
  for (const packageRecord of packages) {
    const packageResult = await validatePackage(packageRecord, localVersions, migrationOwners);
    patterns.push(...packageResult.patterns);
    serverProviderCount += packageResult.serverProviderCount;
  }
  assertUniquePatternIds(patterns);
  const testManifests = await verifyTestRuns();
  process.stdout.write(
    `Verified ${packages.length} JSKIT runtime packages, ${serverProviderCount} loadable server providers, ` +
    `${patterns.length} patterns, ${migrationOwners.size} loadable package migrations, and the test runs of ` +
    `${testManifests} manifests.\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}

export {
  main,
  validateApiSummarySurfaces,
  validateRemovedProps,
  validateCapabilityClosure,
  validateMigrations,
  validateProviderExport,
  validateProviderList,
  validateSingletonPeerDependencies
};
