import { readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists, toPosixPath } from "./files.mjs";
import { readOptionalFile, restoreProjectFiles, runNpmInstall, writeManifestUpdates } from "./project-install.mjs";
import { discoverProjectManifests, readJsonRecord, serializePackageJson } from "./project-manifests.mjs";

const JSKIT_SCOPE_PREFIX = "@jskit-ai/";
const CATALOG_PACKAGE_ID = "@jskit-ai/jskit-catalog";
const DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
]);
const UPDATE_SCRIPT = "npx --yes @jskit-ai/jskit-catalog@latest update";
// JSKIT packages a release retired, each with what replaced it. The updater removes their declarations itself, and
// refuses while the application's own code still imports one, naming the import to use instead.
const RETIRED_PACKAGES = Object.freeze({
  "@jskit-ai/json-rest-api-core": Object.freeze({
    packageId: "@jskit-ai/resource-runtime",
    importFrom: "@jskit-ai/resource-runtime/server (its types from @jskit-ai/resource-runtime/server/types)"
  })
});
// JSKIT packages with an install script, which the update approves in the root's allowScripts so that npm runs it and a
// strict install (npm's strict-allow-scripts) accepts it: material-web's patches Vuetify's idle loaders
// (vuetifyjs/vuetify#23393; its README, Upstream workarounds).
const INSTALL_SCRIPT_PACKAGES = Object.freeze(["@jskit-ai/material-web"]);
const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]s|vue)$/u;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage"]);
const CHECK_SCRIPT = "jskit check";
// Dependencies JSKIT's packages require at one exact version, of which an application must install one copy.
// json-rest-api knows its transactions by identity: beside a second copy (an app pinning another version than
// resource-runtime's), every write the app's api.transaction reaches inside JSKIT fails with "transaction must be an
// active transaction from api.transaction".
const SINGLE_COPY_DEPENDENCIES = Object.freeze(["json-rest-api"]);

function normalizeCatalog(catalog = {}) {
  const releasePackages = catalog?.release?.packages;
  if (!releasePackages || typeof releasePackages !== "object" || Array.isArray(releasePackages)) {
    throw new Error("JSKIT catalog does not contain release.packages; install a catalog that supports project updates.");
  }
  const versions = new Map();
  for (const [packageId, version] of Object.entries(releasePackages)) {
    const normalizedPackageId = String(packageId || "").trim();
    const normalizedVersion = String(version || "").trim();
    if (!normalizedPackageId.startsWith(JSKIT_SCOPE_PREFIX) || !/^\d+\.\d+\.\d+$/u.test(normalizedVersion)) {
      throw new Error(`JSKIT catalog contains an invalid release entry: ${packageId}@${version}`);
    }
    versions.set(normalizedPackageId, normalizedVersion);
  }
  const singletonPackages = new Set(
    (Array.isArray(catalog?.release?.singletonPackages) ? catalog.release.singletonPackages : [])
      .map((entry) => String(entry || "").trim())
      .filter((entry) => versions.has(entry))
  );
  return Object.freeze({ versions, singletonPackages, singleCopyDependencies: singleCopyDependencies(catalog?.packages) });
}

// Each single-copy dependency the catalog's packages require: its one version, and every catalog package that needs it,
// directly or through another JSKIT package it depends on.
function singleCopyDependencies(catalogPackages) {
  const entries = Array.isArray(catalogPackages) ? catalogPackages : [];
  const result = new Map();
  for (const name of SINGLE_COPY_DEPENDENCIES) {
    const versions = new Set();
    const requiredBy = new Set();
    for (const entry of entries) {
      const version = entry?.packageJson?.dependencies?.[name];
      if (!version) continue;
      versions.add(version);
      requiredBy.add(entry.packageId);
    }
    if (versions.size > 1) {
      throw new Error(`JSKIT catalog requires ${name} at several versions: ${[...versions].sort().join(", ")}.`);
    }
    if (versions.size < 1) continue;
    for (let grew = true; grew;) {
      grew = false;
      for (const entry of entries) {
        const dependencies = Object.keys({ ...entry?.packageJson?.dependencies, ...entry?.packageJson?.peerDependencies });
        if (!requiredBy.has(entry?.packageId) && dependencies.some((dependency) => requiredBy.has(dependency))) {
          requiredBy.add(entry.packageId);
          grew = true;
        }
      }
    }
    result.set(name, Object.freeze({ version: [...versions][0], requiredBy }));
  }
  return result;
}

// The single-copy dependencies that some of these JSKIT packages need.
function requiredSingleCopies(normalizedCatalog, packageIds) {
  return [...normalizedCatalog.singleCopyDependencies]
    .filter(([, { requiredBy }]) => [...requiredBy].some((packageId) => packageIds.has(packageId)));
}

function collectManifestDeclarations(manifests, projectRoot) {
  const declarations = [];
  for (const manifest of manifests) {
    const source = toPosixPath(path.relative(projectRoot, manifest.absolutePath)) || "package.json";
    for (const field of DEPENDENCY_FIELDS) {
      for (const [packageId, declaredVersion] of Object.entries(manifest.value?.[field] || {})) {
        if (!packageId.startsWith(JSKIT_SCOPE_PREFIX)) {
          continue;
        }
        declarations.push(Object.freeze({
          manifest,
          source,
          field,
          packageId,
          declaredVersion: String(declaredVersion || "")
        }));
      }
    }
  }
  return Object.freeze(declarations);
}

function collectLocalPackageNames(manifests) {
  return new Set(
    manifests
      .map((manifest) => String(manifest.value?.name || "").trim())
      .filter(Boolean)
  );
}

function resolveLockPackageName(packagePath = "", record = {}) {
  const explicitName = String(record?.name || "").trim();
  if (explicitName.startsWith(JSKIT_SCOPE_PREFIX)) {
    return explicitName;
  }
  const normalizedPath = toPosixPath(packagePath);
  const match = /(?:^|\/)node_modules\/(@jskit-ai\/[^/]+)$/u.exec(normalizedPath);
  return match?.[1] || "";
}

function collectLockInstallations(packageLock = {}) {
  const installations = [];
  if (packageLock?.packages && typeof packageLock.packages === "object") {
    for (const [packagePath, record] of Object.entries(packageLock.packages)) {
      if (!record || typeof record !== "object" || record.link === true) {
        continue;
      }
      const packageId = resolveLockPackageName(packagePath, record);
      if (!packageId) {
        continue;
      }
      installations.push(Object.freeze({
        packageId,
        version: String(record.version || "").trim(),
        path: toPosixPath(packagePath)
      }));
    }
    return Object.freeze(installations);
  }

  function visitDependencies(dependencies = {}, parentPath = "") {
    for (const [packageId, record] of Object.entries(dependencies || {})) {
      const packagePath = parentPath ? `${parentPath}/node_modules/${packageId}` : `node_modules/${packageId}`;
      if (packageId.startsWith(JSKIT_SCOPE_PREFIX)) {
        installations.push(Object.freeze({
          packageId,
          version: String(record?.version || "").trim(),
          path: packagePath
        }));
      }
      visitDependencies(record?.dependencies, packagePath);
    }
  }
  visitDependencies(packageLock?.dependencies);
  return Object.freeze(installations);
}

function collectJskitOverridePaths(value, currentPath = "overrides", results = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return results;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${currentPath}.${key}`;
    if (key.startsWith(JSKIT_SCOPE_PREFIX)) {
      results.push(nextPath);
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      collectJskitOverridePaths(child, nextPath, results);
    }
  }
  return results;
}

async function checkProject({ projectRoot = process.cwd(), catalog, additionalManifests = [], checkInstalled = false, sourcePackages = {} } = {}) {
  const root = path.resolve(projectRoot);
  const normalizedCatalog = normalizeCatalog(catalog);
  const manifests = await discoverProjectManifests(root, additionalManifests);
  const localPackageNames = collectLocalPackageNames(manifests);
  const declarations = collectManifestDeclarations(manifests, root)
    .filter((entry) => !localPackageNames.has(entry.packageId) && !Object.hasOwn(sourcePackages, entry.packageId));
  const issues = [];

  for (const declaration of declarations) {
    const expectedVersion = normalizedCatalog.versions.get(declaration.packageId);
    if (!expectedVersion) {
      issues.push(`${declaration.source}#${declaration.field}.${declaration.packageId} is not in the coordinated catalog.`);
      continue;
    }
    if (declaration.declaredVersion !== expectedVersion) {
      issues.push(
        `${declaration.source}#${declaration.field}.${declaration.packageId} is ${declaration.declaredVersion}; ` +
        `expected ${expectedVersion}.`
      );
    }
  }

  for (const manifest of manifests) {
    const source = toPosixPath(path.relative(root, manifest.absolutePath)) || "package.json";
    for (const overridePath of collectJskitOverridePaths(manifest.value?.overrides)) {
      issues.push(`${source}#${overridePath} must be removed; coordinated JSKIT versions cannot be overridden privately.`);
    }
  }

  const packageLockPath = path.join(root, "package-lock.json");
  let installations = [];
  let lockPackages = {};
  if (!(await fileExists(packageLockPath))) {
    issues.push("package-lock.json is missing; run npm install after aligning the JSKIT release cohort.");
  } else {
    const packageLock = (await readJsonRecord(packageLockPath)).value;
    lockPackages = packageLock.packages || {};
    installations = collectLockInstallations(packageLock);
    if (checkInstalled) {
      for (const [packagePath, record] of Object.entries(packageLock.packages || {})) {
        if (!packagePath || record.link || !packagePath.includes("node_modules/")) continue;
        if (Object.hasOwn(sourcePackages, resolveLockPackageName(packagePath, record))) continue;
        const installedPath = path.join(root, packagePath, "package.json");
        if (!(await fileExists(installedPath))) {
          if (!record.optional) issues.push(`${packagePath} is missing; lockfile requires ${record.version}. Run npm ci.`);
          continue;
        }
        const installed = (await readJsonRecord(installedPath)).value;
        if (installed.version !== record.version) {
          issues.push(`${packagePath} installed ${installed.version}; lockfile requires ${record.version}. Run npm ci.`);
        }
      }
      for (const manifest of manifests) {
        const directory = toPosixPath(path.relative(root, path.dirname(manifest.absolutePath)));
        const record = packageLock.packages?.[directory];
        // Separately composed manifests deliberately have no entry in this root lockfile.
        if (!record && additionalManifests.some((file) => path.resolve(root, file) === manifest.absolutePath)) continue;
        for (const field of DEPENDENCY_FIELDS) {
          const declared = manifest.value[field] || {};
          const locked = record?.[field] || {};
          for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) {
            if (Object.hasOwn(sourcePackages, name)) continue;
            if (declared[name] !== locked[name]) issues.push(`${manifest.absolutePath}#${field}.${name} is ${declared[name] || "absent"}; lockfile records ${locked[name] || "absent"}. Run npm install and commit the lockfile.`);
          }
        }
      }
    }
    const byPackageId = new Map();
    for (const installation of installations) {
      // Selected sources replace these installations in the composed graph,
      // where their exact paths and singleton identity are checked separately.
      if (Object.hasOwn(sourcePackages, installation.packageId)) continue;
      const expectedVersion = normalizedCatalog.versions.get(installation.packageId);
      if (!expectedVersion) {
        issues.push(`${installation.path} resolves unknown JSKIT package ${installation.packageId}@${installation.version}.`);
        continue;
      }
      if (installation.version !== expectedVersion) {
        issues.push(
          `${installation.path} resolves ${installation.packageId}@${installation.version}; expected ${expectedVersion}.`
        );
      }
      const entries = byPackageId.get(installation.packageId) || [];
      entries.push(installation);
      byPackageId.set(installation.packageId, entries);
    }

    for (const [packageId, entries] of byPackageId) {
      const versions = [...new Set(entries.map((entry) => entry.version))].sort();
      if (versions.length > 1) {
        issues.push(`${packageId} resolves multiple release versions: ${versions.join(", ")}.`);
      }
      if (normalizedCatalog.singletonPackages.has(packageId) && entries.length > 1) {
        issues.push(
          `${packageId} is a singleton client runtime but resolves at ${entries.length} private install paths: ` +
          `${entries.map((entry) => entry.path).join(", ")}.`
        );
      }
    }

    const resolvedPackageIds = new Set(installations.map((entry) => entry.packageId));
    for (const packageId of new Set(declarations
      .filter((entry) => !additionalManifests.some((file) => path.resolve(root, file) === entry.manifest.absolutePath))
      .map((entry) => entry.packageId))) {
      if (!resolvedPackageIds.has(packageId)) {
        issues.push(`${packageId} is declared but has no resolved package-lock installation.`);
      }
    }
  }

  const appPackageIds = new Set([...declarations, ...installations].map((entry) => entry.packageId));
  for (const [name, { version }] of requiredSingleCopies(normalizedCatalog, appPackageIds)) {
    const fix = `Pin ${name} to ${version}`;
    for (const manifest of manifests) {
      const source = toPosixPath(path.relative(root, manifest.absolutePath)) || "package.json";
      for (const field of DEPENDENCY_FIELDS) {
        const declared = manifest.value?.[field]?.[name];
        if (declared !== undefined && declared !== version) {
          issues.push(
            `${source}#${field}.${name} is ${declared}; JSKIT's packages require ${name} ${version}, and beside a second ` +
            `copy every write an api.transaction reaches inside them fails. ${fix} (npm run jskit:update does it).`
          );
        }
      }
    }
    const copies = Object.entries(lockPackages)
      .filter(([packagePath, record]) => record && !record.link &&
        (packagePath === `node_modules/${name}` || packagePath.endsWith(`/node_modules/${name}`)));
    if (copies.length > 1) {
      issues.push(
        `${name} is installed ${copies.length} times (${copies.map(([packagePath, record]) => `${record.version} at ${packagePath}`)
          .join(", ")}); JSKIT's packages need the one copy an app's api.transaction comes from. ${fix} and run npm install.`
      );
    }
  }

  return Object.freeze({
    ok: issues.length < 1,
    issues: Object.freeze(issues),
    manifests,
    declarations,
    installations: Object.freeze(installations)
  });
}

// Resolve package manifests without relying on a package exporting package.json.
// Following real paths matches Node's normal symlink resolution.
async function resolveInstalledPackage(consumerDirectory, packageId) {
  let directory = await realpath(consumerDirectory);
  while (true) {
    const candidate = path.join(directory, "node_modules", packageId, "package.json");
    if (await fileExists(candidate)) return realpath(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function checkInstalledGraph({ catalog, manifestPaths = [], sourcePackages = {} } = {}) {
  const { versions, singletonPackages } = normalizeCatalog(catalog);
  const issues = [];
  const installations = new Map();
  const visited = new Set();
  const pending = [...manifestPaths];
  const sourceManifests = new Map();
  for (const [name, directory] of Object.entries(sourcePackages)) {
    const file = await realpath(path.join(directory, "package.json"));
    const manifest = (await readJsonRecord(file)).value;
    if (manifest.name !== name) throw new Error(`Selected source ${directory} must provide ${name}.`);
    sourceManifests.set(name, file);
    pending.push(file);
  }
  while (pending.length) {
    const manifestPath = await realpath(pending.pop());
    if (visited.has(manifestPath)) continue;
    visited.add(manifestPath);
    const manifest = (await readJsonRecord(manifestPath)).value;
    const selectedSource = sourceManifests.get(manifest.name);
    if (selectedSource && manifestPath !== selectedSource) {
      issues.push(`${manifest.name} resolves at ${manifestPath}, not its selected source ${selectedSource}.`);
    }
    if (manifest.name?.startsWith(JSKIT_SCOPE_PREFIX)) {
      const expected = versions.get(manifest.name);
      if (!selectedSource && manifest.version !== expected) issues.push(`${manifestPath} provides ${manifest.name}@${manifest.version}; catalog requires ${expected || "no such package"}.`);
      const paths = installations.get(manifest.name) || new Map();
      paths.set(manifestPath, manifest.version);
      installations.set(manifest.name, paths);
    }
    for (const [name, required] of Object.entries({ ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.optionalDependencies })) {
      const resolved = await resolveInstalledPackage(path.dirname(manifestPath), name);
      const optional = Object.hasOwn(manifest.optionalDependencies || {}, name)
        || (manifest.peerDependenciesMeta?.[name]?.optional === true && !Object.hasOwn(manifest.dependencies || {}, name));
      if (!resolved) {
        if (!optional) issues.push(`${manifestPath} requires ${name}@${required}, but it is unavailable from that consumer.`);
        continue;
      }
      if (sourceManifests.has(name) && resolved !== sourceManifests.get(name)) {
        issues.push(`${manifestPath} requires ${name}, but resolves ${resolved}, not its selected source ${sourceManifests.get(name)}.`);
      }
      // Check the consumer's JSKIT contract as well as the installed version.
      if (!sourceManifests.has(name) && name.startsWith(JSKIT_SCOPE_PREFIX) && !String(required).startsWith("file:") && required !== versions.get(name)) {
        issues.push(`${manifestPath} requires ${name}@${required}; catalog requires ${versions.get(name) || "no such package"}.`);
      }
      pending.push(resolved);
    }
  }
  for (const [name, paths] of installations) {
    const distinctVersions = new Set(paths.values());
    if (distinctVersions.size > 1 || (singletonPackages.has(name) && paths.size > 1)) {
      issues.push(`${name} has ${singletonPackages.has(name) ? "duplicate singleton" : "conflicting"} installations: ${[...paths].map(([file, version]) => `${version} at ${file}`).join(", ")}.`);
    }
  }
  return { ok: issues.length === 0, issues, installations };
}

function removeJskitDependencyRecords(dependencies = {}, localPackageNames = new Set()) {
  for (const [packageId, record] of Object.entries(dependencies || {})) {
    if (packageId.startsWith(JSKIT_SCOPE_PREFIX) && !localPackageNames.has(packageId)) {
      delete dependencies[packageId];
      continue;
    }
    if (record && typeof record === "object" && !Array.isArray(record)) {
      removeJskitDependencyRecords(record.dependencies, localPackageNames);
    }
  }
}

function alignLockManifestRecord(lockRecord, manifest, localPackageNames) {
  if (!lockRecord || typeof lockRecord !== "object" || Array.isArray(lockRecord)) {
    return;
  }
  for (const field of DEPENDENCY_FIELDS) {
    const nextDeclarations = {
      ...(lockRecord[field] && typeof lockRecord[field] === "object" ? lockRecord[field] : {})
    };
    for (const packageId of Object.keys(nextDeclarations)) {
      if (packageId.startsWith(JSKIT_SCOPE_PREFIX) && !localPackageNames.has(packageId)) {
        delete nextDeclarations[packageId];
      }
    }
    for (const [packageId, version] of Object.entries(manifest.value?.[field] || {})) {
      if (packageId.startsWith(JSKIT_SCOPE_PREFIX) && !localPackageNames.has(packageId)) {
        nextDeclarations[packageId] = version;
      }
    }
    if (Object.keys(nextDeclarations).length > 0) {
      lockRecord[field] = nextDeclarations;
    } else {
      delete lockRecord[field];
    }
  }
}

async function preparePackageLockForInstall(projectRoot, manifests, packageLockPath) {
  if (!(await fileExists(packageLockPath))) {
    return;
  }
  const packageLock = await readJsonRecord(packageLockPath);
  const next = structuredClone(packageLock.value);
  const localPackageNames = collectLocalPackageNames(manifests);
  if (next.packages && typeof next.packages === "object" && !Array.isArray(next.packages)) {
    const removedPaths = Object.entries(next.packages)
      .filter(([packagePath, record]) => {
        const packageId = resolveLockPackageName(packagePath, record);
        return packageId && record?.link !== true && !localPackageNames.has(packageId);
      })
      .map(([packagePath]) => packagePath);
    // A removed package's nested dependencies go with it. Left behind without
    // their parent, npm install drops them from the lock it writes while the
    // new version still needs them nested, and npm ci then refuses that lock.
    for (const packagePath of Object.keys(next.packages)) {
      if (removedPaths.some((removed) => packagePath === removed || packagePath.startsWith(`${removed}/`))) {
        delete next.packages[packagePath];
      }
    }
    for (const manifest of manifests) {
      const relativeDirectory = toPosixPath(
        path.relative(projectRoot, path.dirname(manifest.absolutePath))
      );
      alignLockManifestRecord(next.packages[relativeDirectory], manifest, localPackageNames);
    }
  }
  removeJskitDependencyRecords(next.dependencies, localPackageNames);
  const temporaryPath = `${packageLockPath}.jskit-${process.pid}-install.tmp`;
  try {
    await writeFile(temporaryPath, serializePackageJson(next, packageLock.contents), "utf8");
    await rename(temporaryPath, packageLockPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/**
 * The application's files, outside node_modules and build output, that import one of the packages.
 * @param {string} root
 * @param {string[]} packageIds
 * @returns {Promise<Map<string, string[]>>} The importing files, relative to root, by package.
 */
async function findImports(root, packageIds) {
  const imports = new Map();
  const patterns = packageIds.map((packageId) => {
    const name = packageId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return [packageId, new RegExp(`["']${name}(?:/[^"']*)?["']`, "u")];
  });
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath);
        }
      } else if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
        const source = await readFile(absolutePath, "utf8");
        for (const [packageId, pattern] of patterns) {
          if (pattern.test(source)) {
            imports.set(packageId, [...(imports.get(packageId) || []), toPosixPath(path.relative(root, absolutePath))]);
          }
        }
      }
    }
  };
  await visit(root);
  return imports;
}

// The migration files the installed @jskit-ai packages ship (jskit.migrations.directories and their constraints/),
// each "<package>: <path in the package>", as the app's migrations read them from node_modules.
async function installedPackageMigrations(root) {
  const scope = path.join(root, "node_modules", JSKIT_SCOPE_PREFIX);
  const names = await readdir(scope).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const migrations = new Set();
  for (const name of names) {
    const packageRoot = path.join(scope, name);
    const manifestPath = path.join(packageRoot, "package.json");
    if (!(await fileExists(manifestPath))) continue;
    const directories = (await readJsonRecord(manifestPath)).value.jskit?.migrations?.directories;
    for (const directory of Array.isArray(directories) ? directories : []) {
      for (const folder of [directory, path.join(directory, "constraints")]) {
        const files = await readdir(path.join(packageRoot, folder)).catch(() => []);
        for (const file of files.filter((entry) => entry.endsWith(".cjs"))) {
          migrations.add(`${JSKIT_SCOPE_PREFIX}${name}: ${toPosixPath(path.join(folder, file))}`);
        }
      }
    }
  }
  return migrations;
}

/**
 * Approves, in the root manifest's allowScripts, the install script of each JSKIT package in `declared` that has one,
 * unless the app already allows it by name or denies it in any entry.
 * @param {Record<string, any>} manifest the root manifest, changed in place
 * @param {Set<string>} declared
 * @returns {boolean} whether it changed
 */
function approveInstallScripts(manifest, declared) {
  const allowScripts = manifest.allowScripts && typeof manifest.allowScripts === "object" ? manifest.allowScripts : {};
  const denied = (packageId) => Object.entries(allowScripts)
    .some(([entry, allowed]) => allowed === false && (entry === packageId || entry.startsWith(`${packageId}@`)));
  const approve = INSTALL_SCRIPT_PACKAGES.filter((packageId) => declared.has(packageId) && allowScripts[packageId] !== true &&
    !denied(packageId));
  for (const packageId of approve) allowScripts[packageId] = true;
  if (approve.length > 0) manifest.allowScripts = allowScripts;
  return approve.length > 0;
}

/**
 * Pins a project's JSKIT dependencies to the catalog and installs them; a
 * failed install or check restores the manifests, lockfile and node_modules.
 * @param {object} options
 * @param {typeof runNpmInstall} [options.installProject] installs the project and returns the transaction that commits or rolls back its node_modules
 */
async function updateProject({
  projectRoot = process.cwd(),
  catalog,
  install = true,
  installProject = runNpmInstall,
  additionalManifests = []
} = {}) {
  const root = path.resolve(projectRoot);
  const normalizedCatalog = normalizeCatalog(catalog);
  const manifests = await discoverProjectManifests(root, additionalManifests);
  const localPackageNames = collectLocalPackageNames(manifests);
  const declarations = collectManifestDeclarations(manifests, root)
    .filter((entry) => !localPackageNames.has(entry.packageId));
  const retiredPackageIds = [...new Set(
    declarations.map((entry) => entry.packageId).filter((packageId) => Object.hasOwn(RETIRED_PACKAGES, packageId))
  )].sort();
  const retiredImports = retiredPackageIds.length > 0 ? await findImports(root, retiredPackageIds) : new Map();
  if (retiredImports.size > 0) {
    throw new Error(`Cannot update while the application imports retired JSKIT packages:\n${[...retiredImports]
      .map(([packageId, files]) => `- ${packageId} (in ${files.sort().join(", ")}): ${RETIRED_PACKAGES[packageId].packageId} ` +
        `replaced it; import from ${RETIRED_PACKAGES[packageId].importFrom} instead.`)
      .join("\n")}`);
  }
  const unknownPackageIds = [...new Set(
    declarations
      .map((entry) => entry.packageId)
      .filter((packageId) => !normalizedCatalog.versions.has(packageId) && !retiredPackageIds.includes(packageId))
  )].sort();
  if (unknownPackageIds.length > 0) {
    throw new Error(`Cannot update JSKIT packages missing from the coordinated catalog: ${unknownPackageIds.join(", ")}.`);
  }

  const overrideLocations = manifests.flatMap((manifest) => {
    const source = toPosixPath(path.relative(root, manifest.absolutePath)) || "package.json";
    return collectJskitOverridePaths(manifest.value?.overrides)
      .map((overridePath) => `${source}#${overridePath}`);
  });
  if (overrideLocations.length > 0) {
    throw new Error(
      "Cannot update while private JSKIT overrides are present; remove these entries first: " +
      `${overrideLocations.sort().join(", ")}.`
    );
  }

  const declaredPackageIds = new Set(
    declarations.map((entry) => entry.packageId).filter((packageId) => !retiredPackageIds.includes(packageId))
  );
  const catalogVersion = normalizedCatalog.versions.get(CATALOG_PACKAGE_ID);
  if (!catalogVersion) {
    throw new Error(`Coordinated catalog is missing ${CATALOG_PACKAGE_ID}.`);
  }
  // A direct pin of a dependency the declared JSKIT packages need as one copy moves with the catalog.
  const singleCopies = requiredSingleCopies(normalizedCatalog, declaredPackageIds);

  const updates = [];
  for (const [index, manifest] of manifests.entries()) {
    const next = structuredClone(manifest.value);
    let changed = false;
    for (const field of DEPENDENCY_FIELDS) {
      for (const packageId of Object.keys(next?.[field] || {})) {
        if (!packageId.startsWith(JSKIT_SCOPE_PREFIX) || localPackageNames.has(packageId)) {
          continue;
        }
        if (retiredPackageIds.includes(packageId)) {
          delete next[field][packageId];
          changed = true;
          continue;
        }
        const expectedVersion = normalizedCatalog.versions.get(packageId);
        if (next[field][packageId] !== expectedVersion) {
          next[field][packageId] = expectedVersion;
          changed = true;
        }
      }
      for (const [name, { version }] of singleCopies) {
        if (Object.hasOwn(next?.[field] || {}, name) && next[field][name] !== version) {
          next[field][name] = version;
          changed = true;
        }
      }
    }

    if (index === 0) {
      next.devDependencies = next.devDependencies && typeof next.devDependencies === "object"
        ? next.devDependencies
        : {};
      if (next.devDependencies[CATALOG_PACKAGE_ID] !== catalogVersion) {
        next.devDependencies[CATALOG_PACKAGE_ID] = catalogVersion;
        changed = true;
      }
      next.scripts = next.scripts && typeof next.scripts === "object" ? next.scripts : {};
      if (!next.scripts["jskit:update"]) {
        next.scripts["jskit:update"] = UPDATE_SCRIPT;
        changed = true;
      }
      if (!next.scripts["jskit:check"]) {
        next.scripts["jskit:check"] = CHECK_SCRIPT;
        changed = true;
      }
      if (approveInstallScripts(next, declaredPackageIds)) {
        changed = true;
      }
    }

    if (changed) {
      updates.push(Object.freeze({
        manifest,
        contents: serializePackageJson(next, manifest.contents)
      }));
    }
  }

  const packageLockPath = path.join(root, "package-lock.json");
  const packageLockSnapshot = install ? await readOptionalFile(packageLockPath) : null;
  // npm install replaces node_modules, so the migrations the packages shipped are read before it.
  const migrationsBefore = install ? await installedPackageMigrations(root) : new Set();
  await writeManifestUpdates(updates);
  let installTransaction = null;
  let addedMigrations = [];
  try {
    if (install) {
      const updatedManifests = await discoverProjectManifests(root, additionalManifests);
      await preparePackageLockForInstall(root, updatedManifests, packageLockPath);
      installTransaction = await installProject(root);
      const result = await checkProject({ projectRoot: root, catalog, additionalManifests });
      if (!result.ok) {
        throw new Error(`JSKIT graph remains inconsistent after npm install:\n- ${result.issues.join("\n- ")}`);
      }
      addedMigrations = [...await installedPackageMigrations(root)].filter((entry) => !migrationsBefore.has(entry)).sort();
      await installTransaction.commit();
    }
  } catch (error) {
    const rollbackErrors = [];
    try {
      if (installTransaction) {
        await installTransaction.rollback();
      }
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    try {
      await restoreProjectFiles(updates, packageLockPath, packageLockSnapshot);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "JSKIT update failed and its previous project state could not be fully restored.\n" +
        rollbackErrors.map((rollbackError) => rollbackError.message).join("\n")
      );
    }
    throw error;
  }

  return Object.freeze({
    changedFiles: Object.freeze(
      updates.map((update) => toPosixPath(path.relative(root, update.manifest.absolutePath)))
    ),
    catalogVersion,
    addedMigrations: Object.freeze(addedMigrations),
    retiredPackages: Object.freeze(retiredPackageIds.map((packageId) => Object.freeze({
      packageId,
      replacedBy: RETIRED_PACKAGES[packageId].packageId
    })))
  });
}

export {
  CATALOG_PACKAGE_ID,
  CHECK_SCRIPT,
  DEPENDENCY_FIELDS,
  UPDATE_SCRIPT,
  checkProject,
  checkInstalledGraph,
  resolveInstalledPackage,
  collectLockInstallations,
  discoverProjectManifests,
  normalizeCatalog,
  updateProject
};
