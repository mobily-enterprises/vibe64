import { cp, lstat, mkdir, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";

async function pathExists(pathname = "") {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

async function readJson(pathname = "") {
  return JSON.parse(await readFile(pathname, "utf8"));
}

async function assertCompatiblePackageVersion(consumer, packageId, range, version) {
  // Only source composition needs this dependency; packaged startup imports
  // this module without the repository's development installation.
  const { default: semver } = await import("semver");
  if (!semver.valid(version) || !semver.validRange(range) || !semver.satisfies(version, range)) {
    throw new Error(`${consumer} requires ${packageId}@${range}, but the selected source provides ${version || "no version"}. Align the selected checkout and its declared dependencies before running Preview.`);
  }
}

async function removePath(pathname = "") {
  await rm(pathname, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100
  });
}

async function declaredJskitPackages(jskitRoot) {
  const packages = [];
  for (const parent of ["packages", "tooling"]) {
    for (const entry of await readdir(path.join(jskitRoot, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(jskitRoot, parent, entry.name);
      const candidates = [directory];
      if (parent === "packages") {
        for (const child of await readdir(directory, { withFileTypes: true })) {
          if (child.isDirectory()) candidates.push(path.join(directory, child.name));
        }
      }
      for (const candidate of candidates) {
        if (!(await pathExists(path.join(candidate, "package.json")))) continue;
        const manifest = await readJson(path.join(candidate, "package.json"));
        if (manifest.name) packages.push({ root: candidate, manifest });
      }
    }
  }
  return packages;
}

async function selectLocalDevelopmentPackages({ jskitRoot = "", genesisRoot = "", consumerDependencies = {}, installedRoots = [] }) {
  const available = new Map();
  const add = (root, manifest) => {
    if (!manifest.name || available.has(manifest.name)) throw new Error(`Duplicate or unnamed local package at ${root}.`);
    if (!/^(?:@jskit-ai\/[a-z0-9][a-z0-9._-]*|genesis-(?:compiler|stack))$/u.test(manifest.name)) {
      throw new Error(`Unexpected local package name ${manifest.name} at ${root}.`);
    }
    available.set(manifest.name, { packageId: manifest.name, root, manifest });
  };
  if (jskitRoot) {
    const root = await realpath(jskitRoot);
    if ((await readJson(path.join(root, "package.json"))).name !== "jskit-monorepo") throw new Error(`Expected JSKIT checkout at ${root}.`);
    for (const entry of await declaredJskitPackages(root)) add(entry.root, entry.manifest);
    if (!available.has("@jskit-ai/kernel") || !available.has("@jskit-ai/jskit-catalog")) {
      throw new Error(`JSKIT source at ${root} is missing kernel or catalog workspace packages.`);
    }
  }
  if (genesisRoot) {
    const root = await realpath(genesisRoot);
    const compiler = await readJson(path.join(root, "package.json"));
    const stackRoot = path.join(root, "packages", "genesis-stack");
    const stack = await readJson(path.join(stackRoot, "package.json"));
    if (compiler.name !== "genesis-compiler" || stack.name !== "genesis-stack") throw new Error(`Expected compiler and Stack catalog at ${root}.`);
    add(root, compiler);
    add(stackRoot, stack);
  }
  if (!available.size) return [];
  if (jskitRoot) {
    const missing = Object.keys(consumerDependencies).filter((name) => name.startsWith("@jskit-ai/") && !available.has(name));
    if (missing.length) throw new Error(`Selected JSKIT source is missing required local packages: ${missing.join(", ")}.`);
  }
  const requested = new Set(Object.keys(consumerDependencies).filter((name) => available.has(name)));
  if (jskitRoot) requested.add("@jskit-ai/jskit-catalog");
  if (genesisRoot) {
    requested.add("genesis-compiler");
    requested.add("genesis-stack");
  }
  const selected = new Map();
  const pending = [...requested];
  while (pending.length) {
    const name = pending.pop();
    if (selected.has(name)) continue;
    const entry = available.get(name);
    if (!entry) throw new Error(`Required local package ${name} is missing from its selected checkout.`);
    selected.set(name, entry);
    for (const dependency of Object.keys({ ...entry.manifest.dependencies, ...entry.manifest.optionalDependencies,
      ...entry.manifest.peerDependencies })) {
      const optionalPeer = entry.manifest.peerDependenciesMeta?.[dependency]?.optional === true
        && !Object.hasOwn(entry.manifest.dependencies || {}, dependency)
        && !Object.hasOwn(entry.manifest.optionalDependencies || {}, dependency);
      if (optionalPeer && !requested.has(dependency)
        && !(await Promise.all(installedRoots.map((root) => pathExists(path.join(root, "node_modules", dependency, "package.json"))))).some(Boolean)) continue;
      if (jskitRoot && dependency.startsWith("@jskit-ai/") && !available.has(dependency)) {
        throw new Error(`Local package ${name} requires missing JSKIT package ${dependency}.`);
      }
      if (available.has(dependency)) pending.push(dependency);
    }
  }
  // Explicit source selection replaces published versions, not dependency
  // presence or runtime identity. External versions are checked after copying.
  return [...selected.values()].sort((a, b) => a.packageId.localeCompare(b.packageId));
}

async function copyDevelopmentPackage(sourceRoot, targetRoot) {
  await removePath(targetRoot);
  await mkdir(path.dirname(targetRoot), { recursive: true });
  await cp(sourceRoot, targetRoot, {
    dereference: false,
    recursive: true,
    filter(source) {
      const relative = path.relative(sourceRoot, source);
      return !relative.split(path.sep).some((part) => [".git", ".genesis", "node_modules", "coverage", ".cache"].includes(part) || part.startsWith(".env"));
    }
  });
}

async function materializeLocalDevelopmentPackages({ appRoot, nodeModules, publicRoot, localPackages }) {
  if (!localPackages.length) return [];
  const selectedNames = new Set(localPackages.map(({ packageId }) => packageId));
  // Node follows package symlinks to their real source. Reparent public packages
  // in development mode so their imports resolve this one composed dependency graph.
  const publicScope = path.join(nodeModules, "@local");
  for (const name of await readdir(publicScope)) {
    const link = path.join(publicScope, name);
    const original = await realpath(link);
    if (original !== publicRoot && !original.startsWith(`${publicRoot}${path.sep}`)) continue;
    const relative = path.relative(publicRoot, original);
    const editable = relative.startsWith(`packages${path.sep}`)
      ? path.join(appRoot, relative)
      : path.join(appRoot, "packages", "@local", name);
    await copyDevelopmentPackage(original, editable);
    await removePath(link);
    await symlink(editable, link);
  }
  const copied = [];
  for (const entry of localPackages) {
    const editable = path.join(appRoot, "packages", entry.packageId);
    const link = path.join(nodeModules, entry.packageId);
    await copyDevelopmentPackage(entry.root, editable);
    await removePath(link);
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(editable, link);
    copied.push({ packageId: entry.packageId, sourceRoot: entry.root, targetRoot: editable, version: entry.manifest.version });
  }
  for (const entry of localPackages) {
    const packageRoot = path.join(appRoot, "packages", entry.packageId);
    const inspectExports = async (value, key = "") => {
      if (key === "types") return;
      if (typeof value === "string" && value.startsWith("./")) {
        const prefix = value.split("*")[0];
        const target = path.resolve(packageRoot, prefix);
        const pattern = value.includes("*");
        // Preserve a trailing slash in the static prefix: ./dist/features/*
        // requires features itself, not merely its existing parent dist.
        const check = pattern ? path.resolve(packageRoot, path.dirname(`${prefix}__export__`)) : target;
        const contained = check.startsWith(`${packageRoot}${path.sep}`) || (pattern && check === packageRoot);
        if (!contained || !(await pathExists(check))) {
          throw new Error(`Local package ${entry.packageId} has an unavailable export ${value}. Prepare its declared outputs first.`);
        }
      } else if (Array.isArray(value)) {
        for (const child of value) await inspectExports(child);
      } else if (value && typeof value === "object") {
        for (const [condition, child] of Object.entries(value)) await inspectExports(child, condition);
      }
    };
    await inspectExports(entry.manifest.exports);
    for (const dependency of Object.keys(entry.manifest.dependencies || {})) {
      const installedManifestPath = path.join(nodeModules, dependency, "package.json");
      if (!(await pathExists(installedManifestPath))) {
        throw new Error(`Local package ${entry.packageId} requires ${dependency}, missing from the composed dependency installation.`);
      }
      const installed = await readJson(installedManifestPath);
      if (!selectedNames.has(dependency)) await assertCompatiblePackageVersion(entry.packageId, dependency, entry.manifest.dependencies[dependency], installed.version);
    }
  }
  const bins = path.join(nodeModules, ".bin");
  const installedBins = path.join(publicRoot, "node_modules", ".bin");
  await removePath(bins);
  await mkdir(bins, { recursive: true });
  for (const name of await readdir(installedBins)) {
    await symlink(path.join(installedBins, name), path.join(bins, name));
  }
  for (const entry of localPackages) {
    const bin = typeof entry.manifest.bin === "string"
      ? { [entry.packageId.split("/").at(-1)]: entry.manifest.bin }
      : entry.manifest.bin || {};
    for (const [name, relative] of Object.entries(bin)) {
      const target = path.resolve(appRoot, "packages", entry.packageId, relative);
      const packageRoot = path.join(appRoot, "packages", entry.packageId);
      if (!target.startsWith(`${packageRoot}${path.sep}`) || !(await pathExists(target))) {
        throw new Error(`Local package ${entry.packageId} has an unavailable bin ${name}: ${relative}`);
      }
      await removePath(path.join(bins, name));
      await symlink(target, path.join(bins, name));
    }
  }
  return copied;
}

async function linkNodePackage(sourcePath = "", targetPath = "") {
  if (await pathExists(targetPath)) {
    return false;
  }
  await mkdir(path.dirname(targetPath), {
    recursive: true
  });
  await symlink(sourcePath, targetPath);
  return true;
}

async function linkNodeModulesEntries({
  sourceNodeModules = "",
  targetNodeModules = "",
  copyJskit = false
} = {}) {
  if (!(await pathExists(sourceNodeModules))) {
    return [];
  }
  await mkdir(targetNodeModules, {
    recursive: true
  });
  const linked = [];
  const entries = await readdir(sourceNodeModules, {
    withFileTypes: true
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scopeSource = path.join(sourceNodeModules, entry.name);
      const scopeTarget = path.join(targetNodeModules, entry.name);
      await mkdir(scopeTarget, {
        recursive: true
      });
      const scopedEntries = await readdir(scopeSource, {
        withFileTypes: true
      });
      for (const scopedEntry of scopedEntries.sort((a, b) => a.name.localeCompare(b.name))) {
        const packageName = path.join(entry.name, scopedEntry.name);
        const source = path.join(scopeSource, scopedEntry.name);
        const target = path.join(scopeTarget, scopedEntry.name);
        // Additional JSKIT packages must resolve the composition's shared peers,
        // not return through a symlink to an independent tool installation.
        if (copyJskit && entry.name === "@jskit-ai" && !(await pathExists(target))) {
          await cp(source, target, { recursive: true, dereference: true });
          linked.push(packageName);
          continue;
        }
        const didLink = await linkNodePackage(source, target);
        if (didLink) {
          linked.push(packageName);
        }
      }
      continue;
    }

    const didLink = await linkNodePackage(
      path.join(sourceNodeModules, entry.name),
      path.join(targetNodeModules, entry.name)
    );
    if (didLink) {
      linked.push(entry.name);
    }
  }
  return linked;
}


export { assertCompatiblePackageVersion, copyDevelopmentPackage, linkNodeModulesEntries, materializeLocalDevelopmentPackages, selectLocalDevelopmentPackages };
