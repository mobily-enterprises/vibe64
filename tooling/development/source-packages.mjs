import { cp, glob, lstat, mkdir, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
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

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function declaredNodePackages(root, { legacyJskit = false, legacyGenesis = false } = {}) {
  const rootManifest = await readJson(path.join(root, "package.json"));
  const workspaces = rootManifest.workspaces?.packages ?? rootManifest.workspaces ??
    (legacyJskit ? ["packages/*", "packages/*/*", "tooling/*"] : []);
  if (!Array.isArray(workspaces)) throw new Error(`Expected an array of declared workspaces at ${root}.`);
  const candidates = [root, ...(legacyGenesis ? [path.join(root, "packages/genesis-stack")] : [])];
  for (const pattern of workspaces) {
    if (typeof pattern !== "string" || !pattern || pattern.startsWith("!") || path.isAbsolute(pattern) ||
        pattern.includes("\\") || pattern.split("/").some(part => ["..", "node_modules", ".git"].includes(part))) {
      throw new Error(`Unsupported or escaping workspace pattern ${JSON.stringify(pattern)} at ${root}. Use project-relative positive workspace patterns for source development.`);
    }
    for await (const directory of glob(pattern, { cwd: root, exclude: ["**/node_modules/**", "**/.git/**"] })) {
      const candidate = path.resolve(root, directory);
      if (!inside(root, candidate)) throw new Error(`Declared source package escapes ${root}: ${candidate}.`);
      if (await pathExists(path.join(candidate, "package.json"))) candidates.push(candidate);
    }
  }
  const packages = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = await realpath(candidates[index]);
    if (!inside(root, candidate)) throw new Error(`Declared source package escapes ${root}: ${candidate}.`);
    if (packages.has(candidate)) continue;
    const manifest = await readJson(path.join(candidate, "package.json"));
    packages.set(candidate, { root: candidate, manifest });
    // A repository may declare local packages without npm workspaces. Follow
    // only its explicit directory references, never another repository's tree.
    for (const value of Object.values({ ...manifest.dependencies, ...manifest.devDependencies,
      ...manifest.optionalDependencies })) {
      if (typeof value !== "string" || !value.startsWith("file:")) continue;
      const local = path.resolve(candidate, value.slice(5));
      if (!inside(root, local)) throw new Error(`Declared source package escapes ${root}: ${value}.`);
      const actual = await realpath(local);
      if (!inside(root, actual)) throw new Error(`Declared source package escapes ${root}: ${value}.`);
      if ((await lstat(actual)).isDirectory()) candidates.push(actual);
    }
  }
  // Module-scope package.json files (for example test utilities declaring only
  // type: module) are not installable source packages.
  return [...packages.values()].filter(entry => entry.manifest.name);
}

async function selectLocalDevelopmentPackages({ jskitRoot = "", genesisRoot = "", sourceRoots = [], consumerDependencies = {}, installedRoots = [] }) {
  if (!Array.isArray(sourceRoots)) throw new Error("Development sourceRoots must be an array of absolute directories.");
  const available = new Map();
  const roots = new Set();
  const requiredSources = [];
  const add = (root, manifest) => {
    if (!manifest.name || available.has(manifest.name)) throw new Error(`Duplicate or unnamed local package at ${root}.`);
    if (typeof manifest.name !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(manifest.name)) {
      throw new Error(`Unexpected local package name ${manifest.name} at ${root}.`);
    }
    available.set(manifest.name, { packageId: manifest.name, root, manifest });
  };
  const discover = async (source, options = {}) => {
    const root = await realpath(source);
    if (!(await lstat(root)).isDirectory()) throw new Error(`Development source root must be a directory: ${root}.`);
    if (roots.has(root)) throw new Error(`Duplicate development source root: ${root}.`);
    roots.add(root);
    const packages = await declaredNodePackages(root, options);
    for (const entry of packages) add(entry.root, entry.manifest);
    return { root, packages: packages.map(entry => entry.manifest.name) };
  };
  if (jskitRoot) {
    const root = await realpath(jskitRoot);
    if ((await readJson(path.join(root, "package.json"))).name !== "jskit-monorepo") throw new Error(`Expected JSKIT checkout at ${root}.`);
    await discover(root, { legacyJskit: true });
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
    await discover(root, { legacyGenesis: true });
  }
  for (const root of sourceRoots) {
    if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("Development sourceRoots must contain only absolute directories.");
    requiredSources.push(await discover(root));
  }
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
  for (const source of requiredSources) {
    if (!source.packages.some(name => selected.has(name))) {
      throw new Error(`Connected npm source ${source.root} contributes no declared application dependency. Declare the package you consume in the application's package.json before preparing its source.`);
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
