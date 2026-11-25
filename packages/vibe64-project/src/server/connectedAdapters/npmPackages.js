// What the npm adapter reads: the packages a connected repository declares, every installed copy
// of them across the session's trees (nested duplicates included), how Node would resolve a
// dependency from where a copy is installed, and so what a swap moves aside and leaves unmet.
import { glob, lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { pathInsideOrEqual, vibe64Error } from "@local/vibe64-core/server/core";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function existingEntry(filePath) {
  return lstat(filePath).catch(error => {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return null;
    throw error;
  });
}

function repositoryError(connection, message, code = "vibe64_connected_npm_invalid") {
  return vibe64Error(`Connected ${connection.name}: ${message}`, code, { params: { repository: connection.repository } });
}

/**
 * The npm packages a connected repository declares: its root package, its npm workspaces and the
 * directories its manifests reference with `file:`, each inside the repository.
 * @param {{ name: string, repository: string, sourceRoot: string }} connection
 * @returns {Promise<Array<{ name: string, version: string, dir: string, manifest: object }>>}
 */
async function connectedNpmPackages(connection) {
  const root = await realpath(connection.sourceRoot);
  if (!(await existingEntry(path.join(root, "package.json")))?.isFile()) {
    throw repositoryError(connection, "its copy has no package.json, so it is not an npm package. Choose its real package type.");
  }
  const rootManifest = await readJsonFile(path.join(root, "package.json"));
  // npm's own form: a list of folder patterns.
  const patterns = rootManifest.workspaces ?? [];
  if (!Array.isArray(patterns)) throw repositoryError(connection, "its package.json workspaces must be npm's list of folders.");
  const candidates = [root];
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || !pattern || pattern.startsWith("!") || path.isAbsolute(pattern) ||
        pattern.split("/").some(part => ["..", "node_modules", ".git"].includes(part))) {
      throw repositoryError(connection, `its workspace pattern ${JSON.stringify(pattern)} must be a relative folder inside the repository.`);
    }
    for await (const directory of glob(pattern, { cwd: root, exclude: ["**/node_modules/**", "**/.git/**"] })) {
      candidates.push(path.resolve(root, directory));
    }
  }
  const packages = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const dir = await realpath(candidates[index]).catch(() => "");
    if (!dir || !pathInsideOrEqual(root, dir) || packages.has(dir)) continue;
    if (!(await existingEntry(path.join(dir, "package.json")))?.isFile()) continue;
    const manifest = await readJsonFile(path.join(dir, "package.json"));
    packages.set(dir, manifest);
    for (const spec of Object.values({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies })) {
      if (typeof spec === "string" && spec.startsWith("file:")) candidates.push(path.resolve(dir, spec.slice(5)));
    }
  }
  const named = new Map();
  for (const [dir, manifest] of packages) {
    // A folder package.json that only sets the module type is not a package, and a private one is
    // never published, so no tree installs a copy of it.
    if (typeof manifest.name !== "string" || !manifest.name || manifest.private === true) continue;
    if (!PACKAGE_NAME.test(manifest.name)) throw repositoryError(connection, `it declares an invalid package name ${JSON.stringify(manifest.name)}.`);
    if (named.has(manifest.name)) throw repositoryError(connection, `it declares ${manifest.name} twice, at ${named.get(manifest.name).dir} and ${dir}.`);
    named.set(manifest.name, { name: manifest.name, version: String(manifest.version || ""), dir, manifest });
  }
  return [...named.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every installed copy of the named packages under one tree's node_modules, nested node_modules
 * included. A link is a copy only when it leads outside its own tree (an earlier link to a
 * connected checkout); a tree's links to its own workspace packages are its source, not copies.
 * @param {string} tree an absolute tree root (the session source or a connected copy)
 * @param {Set<string>} names
 * @returns {Promise<Array<{ tree: string, dir: string, name: string, link: boolean }>>}
 */
async function installedCopies(tree, names) {
  const copies = [];
  const treeReal = await realpath(tree);
  async function visit(dir, name) {
    const entry = await existingEntry(dir);
    if (!entry) return;
    if (entry.isSymbolicLink()) {
      const target = await realpath(dir).catch(() => "");
      if (names.has(name) && target && !pathInsideOrEqual(treeReal, target)) copies.push({ tree, dir, name, link: true });
      return;
    }
    if (!entry.isDirectory()) return;
    if (names.has(name)) copies.push({ tree, dir, name, link: false });
    await walk(path.join(dir, "node_modules"));
  }
  async function walk(nodeModules) {
    const entries = await readdir(nodeModules, { withFileTypes: true }).catch(error => {
      if (["ENOENT", "ENOTDIR"].includes(error?.code)) return [];
      throw error;
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(nodeModules, entry.name);
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        const scoped = await readdir(entryPath).catch(() => []);
        for (const child of scoped.sort()) await visit(path.join(entryPath, child), `${entry.name}/${child}`);
      } else {
        await visit(entryPath, entry.name);
      }
    }
  }
  await walk(path.join(tree, "node_modules"));
  return copies;
}

/**
 * Where Node finds `name` from a package installed at `fromDir`: the first node_modules on the way
 * up that holds it, never above `tree`. Null when the tree has none.
 * @param {string} tree
 * @param {string} fromDir
 * @param {string} name
 * @param {Set<string>} [gone] installed package folders a swap is about to move away, passed over
 */
async function resolveFromCopy(tree, fromDir, name, gone = new Set()) {
  let dir = fromDir;
  for (;;) {
    if (path.basename(dir) !== "node_modules") {
      const candidate = path.join(dir, "node_modules", name);
      const manifestPath = path.join(candidate, "package.json");
      if (!gone.has(candidate) && (await existingEntry(manifestPath))) {
        const manifest = await readJsonFile(manifestPath).catch(() => null);
        if (manifest) return { dir: candidate, real: await realpath(candidate), version: String(manifest.version || "") };
      }
    }
    if (path.resolve(dir) === path.resolve(tree)) return null;
    const parent = path.dirname(dir);
    if (parent === dir || !pathInsideOrEqual(tree, parent)) return null;
    dir = parent;
  }
}

/** The registry dependencies a package needs: its dependencies and required peers, by range. */
function registryDependencies(manifest) {
  const required = { ...manifest.dependencies };
  for (const [name, range] of Object.entries(manifest.peerDependencies || {})) {
    if (manifest.peerDependenciesMeta?.[name]?.optional !== true) required[name] ??= range;
  }
  return Object.entries(required)
    .filter(([, range]) => typeof range === "string" && !/^(?:file|link|workspace|git|github|https?):|\//u.test(range));
}

function accepts(version, range) {
  return Boolean(version) && (!semver.validRange(range) || semver.satisfies(version, range, { includePrerelease: true }));
}

/** The manifests of the packages npm installed directly in a copy's own node_modules. */
async function nestedManifests(copyDir) {
  const nodeModules = path.join(copyDir, "node_modules");
  const manifests = [];
  for (const entry of await readdir(nodeModules, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".")) continue;
    const names = entry.name.startsWith("@")
      ? (await readdir(path.join(nodeModules, entry.name)).catch(() => [])).map(child => `${entry.name}/${child}`)
      : [entry.name];
    for (const name of names) {
      const manifest = await readJsonFile(path.join(nodeModules, name, "package.json")).catch(() => null);
      if (manifest) manifests.push(manifest);
    }
  }
  return manifests;
}

/**
 * What each swap moves aside with the published copy: a dependency the connected package needs
 * that npm installed in the copy's own node_modules at a version the package does not accept. npm
 * nested it there for the published version's own pin, so it belongs to that copy, and the
 * connected package resolves past it. It stays when a package nested beside it needs that version
 * and would not get one it accepts past it (the check then refuses), a connected package there is
 * swapped instead, and a link has no node_modules of its own. Copies installed inside what goes
 * aside go with it.
 * @returns {Promise<{ copies: Array<object>, aside: Map<string, string[]>, gone: Set<string> }>}
 */
async function swapPlan({ connectedVersions, copies, packages }) {
  const aside = new Map();
  for (const copy of copies.filter(candidate => !candidate.link)) {
    const names = [];
    let beside = null;
    for (const [name, range] of registryDependencies(packages.find(entry => entry.name === copy.name).manifest)) {
      if (connectedVersions.has(name)) continue;
      const nested = String((await readJsonFile(path.join(copy.dir, "node_modules", name, "package.json")).catch(() => null))?.version ?? "");
      if (!nested || accepts(nested, range)) continue;
      beside ??= await nestedManifests(copy.dir);
      const past = (await resolveFromCopy(copy.tree, path.dirname(copy.dir), name))?.version;
      const stillNeeded = beside.some(manifest => registryDependencies(manifest)
        .some(([dependency, wanted]) => dependency === name && accepts(nested, wanted) && !accepts(past, wanted)));
      if (!stillNeeded) names.push(name);
    }
    if (names.length) aside.set(copy.dir, names);
  }
  const gone = new Set([...aside].flatMap(([dir, names]) => names.map(name => path.join(dir, "node_modules", name))));
  const kept = copies.filter(copy => ![...gone].some(dir => copy.dir.startsWith(`${dir}${path.sep}`)));
  return { copies: kept, aside, gone };
}

/**
 * The dependencies each package needs that a tree cannot give it where its copy is installed, once
 * what the plan moves aside has gone (the proof passes no plan: it judges the trees as they are).
 */
async function missingDependencies({ connectedVersions, copies, packages, gone = new Set() }) {
  const needs = [];
  for (const copy of copies) {
    const entry = packages.find(candidate => candidate.name === copy.name);
    for (const [name, range] of registryDependencies(entry.manifest)) {
      const resolved = await resolveFromCopy(copy.tree, copy.dir, name, gone);
      // A connected package is about to replace whatever is there: its own version counts.
      const version = connectedVersions.get(name) && resolved ? connectedVersions.get(name) : resolved?.version;
      if (!accepts(version, range)) needs.push({ tree: copy.tree, from: copy.name, name, range, found: resolved?.version || "" });
    }
  }
  return needs;
}

export { connectedNpmPackages, existingEntry, installedCopies, missingDependencies, readJsonFile, resolveFromCopy, swapPlan };
