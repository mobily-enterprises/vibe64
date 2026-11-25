// The npm adapter: a connected npm repository's packages take the place of every installed copy
// of them in the session's trees. Each copy becomes exactly the files `npm pack` would publish from
// the connected package, in place, so the package keeps resolving its own dependencies from the
// tree it is installed in: one Vue, one knex. A link would resolve them from the checkout instead.
// The published copy is kept aside, with any dependency npm nested in it for its own pins that the
// connected package does not accept, and put back when the connection goes. package.json and
// lockfiles are never written; npm installs a dependency the tree lacks without saving it.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import semver from "semver";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import { notUsed } from "./adapterResults.js";
import { connectedNpmPackages, existingEntry, installedCopies, readJsonFile, resolveFromCopy } from "./npmPackages.js";

const STATE_DIRECTORY = ".vibe64-connected";
const STATE_FILE = "npm-swaps.json";
const STATE_SCHEMA = "vibe64.connected-npm-swaps.v1";
const NPM_TIMEOUT_MS = 10 * 60_000;

function stateDirectory(tree) {
  return path.join(tree, "node_modules", STATE_DIRECTORY);
}

async function readState(tree) {
  const value = await readJsonFile(path.join(stateDirectory(tree), STATE_FILE)).catch(() => null);
  return value?.schema === STATE_SCHEMA && Array.isArray(value.copies)
    ? { ...value, installedDependencies: value.installedDependencies || {} }
    : { schema: STATE_SCHEMA, copies: [], installedDependencies: {} };
}

async function writeState(tree, state) {
  const modes = vibe64SharedModes();
  await writeJsonFileAtomic(path.join(stateDirectory(tree), STATE_FILE), state, {
    directoryMode: modes.inheritingDirectory, fileMode: modes.file, durable: false
  });
}

async function fileDigest(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

/** A file's record: what it holds and when it last changed, so a later check hashes only what changed. */
async function fileRecord(filePath) {
  const info = await stat(filePath);
  return { size: info.size, mtimeMs: info.mtimeMs, sha256: await fileDigest(filePath) };
}

async function unchanged(filePath, record) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size !== record.size) return false;
  if (info.mtimeMs === record.mtimeMs) return true;
  return await fileDigest(filePath) === record.sha256;
}

/** Every file below `dir`, relative to it, except node_modules and Git metadata. */
async function listFiles(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => [])) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) files.push(...await listFiles(dir, relative));
    else files.push(relative);
  }
  return files;
}

/** The packlist of each package: the files `npm pack` would publish, by npm's own rules. */
async function npmPacklists(connection, packages, runCommand) {
  if (!packages.length) return new Map();
  const result = await runCommand({
    command: "npm",
    args: ["pack", "--dry-run", "--json", "--ignore-scripts", ...packages.map(entry => entry.dir)],
    cwd: connection.sourceRoot,
    timeout: NPM_TIMEOUT_MS
  });
  let packed;
  try {
    packed = JSON.parse(String(result?.stdout || ""));
  } catch {
    packed = null;
  }
  if (result?.ok !== true || !Array.isArray(packed)) {
    throw vibe64Error(
      `Connected ${connection.name}: npm could not list the files its packages publish. ${String(result?.stderr || result?.error || "").trim()}`.trim(),
      "vibe64_connected_npm_packlist_failed"
    );
  }
  const lists = new Map();
  for (const entry of packed) {
    // Bundled dependencies stay as npm installed them, in the copy's own node_modules.
    lists.set(entry.name, (entry.files || []).map(file => file.path).filter(file => !file.startsWith("node_modules/")).sort());
  }
  for (const entry of packages) {
    if (!lists.has(entry.name)) throw vibe64Error(`Connected ${connection.name}: npm listed no files for ${entry.name}.`, "vibe64_connected_npm_packlist_failed");
  }
  return lists;
}

/** The installed copies of this connection's packages in every tree, by package. */
async function copiesByPackage(packages, trees) {
  const names = new Set(packages.map(entry => entry.name));
  const copies = [];
  for (const tree of trees) copies.push(...await installedCopies(tree, names));
  return copies;
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

/**
 * What each swap moves aside with the published copy: a dependency the connected package needs
 * that npm installed in the copy's own node_modules at a version the package does not accept. npm
 * nested it there for the published version's own pin, so it belongs to that copy, and the
 * connected package resolves past it. A connected package there is swapped instead, and a link has
 * no node_modules of its own. Copies installed inside what goes aside go with it.
 * @returns {Promise<{ copies: Array<object>, aside: Map<string, string[]>, gone: Set<string> }>}
 */
async function swapPlan({ connectedVersions, copies, packages }) {
  const aside = new Map();
  for (const copy of copies.filter(candidate => !candidate.link)) {
    const names = [];
    for (const [name, range] of registryDependencies(packages.find(entry => entry.name === copy.name).manifest)) {
      if (connectedVersions.has(name)) continue;
      const nested = await readJsonFile(path.join(copy.dir, "node_modules", name, "package.json")).catch(() => null);
      if (nested && !accepts(String(nested.version || ""), range)) names.push(name);
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

function dependencyText(needs) {
  return needs.map(need => `${need.from} needs ${need.name}@${need.range}, ${need.found ? `found ${need.found}` : "not installed"}`).join("; ");
}

/** Installs what the trees lack, without saving: package.json and lockfiles stay as they are. */
async function installDependencies({ connection, needs, runCommand }) {
  const lines = [];
  for (const tree of [...new Set(needs.map(need => need.tree))]) {
    const state = await readState(tree);
    // npm removes what it did not save, so every dependency installed this way goes in each install.
    const wanted = { ...state.installedDependencies };
    for (const need of needs.filter(candidate => candidate.tree === tree)) wanted[need.name] = need.range;
    const result = await runCommand({
      command: "npm",
      args: ["install", "--no-save", "--no-audit", "--no-fund", ...Object.entries(wanted).map(([name, range]) => `${name}@${range}`)],
      cwd: tree,
      timeout: NPM_TIMEOUT_MS
    });
    if (result?.ok !== true) {
      throw vibe64Error(
        `Connected ${connection.name}: ${dependencyText(needs.filter(need => need.tree === tree))}, and npm could not install ${Object.keys(wanted).join(", ")} without saving. ${String(result?.stderr || result?.error || "").trim().slice(-800)}`.trim(),
        "vibe64_connected_npm_dependency_failed"
      );
    }
    await writeState(tree, { ...await readState(tree), installedDependencies: wanted });
    lines.push(`[Connected] ${connection.name}: installed ${Object.entries(wanted).map(([name, range]) => `${name}@${range}`).join(", ")} in ${tree} without saving.`);
  }
  return lines;
}

/** Writes `source` to `target` in one step, with the session's file mode. */
async function publishFile(source, target) {
  const modes = vibe64SharedModes();
  await mkdir(path.dirname(target), { recursive: true, mode: modes.inheritingDirectory });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.vibe64-swap`);
  try {
    await copyFile(source, temporary);
    const executable = Boolean((await stat(source)).mode & 0o111);
    await chmod(temporary, executable ? modes.directory : modes.file);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Makes one installed copy hold exactly `files` from `sourceDir`. The first swap moves the published
 * copy aside (its nested node_modules stays where npm installed it, except the dependencies in
 * `aside`, which go with it); a later one copies only what changed. A copy that is no longer this
 * swap (npm put a published copy back) is swapped afresh.
 * Returns the copy's record: each file's state in the copy and in the source when it was copied.
 */
async function swapCopy({ copy, files, sourceDir, record, tree, aside = [] }) {
  const modes = vibe64SharedModes();
  const ours = Boolean(record) && !copy.link && Boolean(record.files?.["package.json"]) &&
    await unchanged(path.join(copy.dir, "package.json"), record.files["package.json"]);
  const copied = {};
  const sources = {};
  let changed = !ours;
  // The source's state is read before its copy: a save in between leaves the source newer than its
  // record, which the next proof and sync see.
  const copyFrom = async (file, target) => {
    sources[file] = await fileRecord(path.join(sourceDir, file));
    await publishFile(path.join(sourceDir, file), target);
    const info = await stat(target);
    copied[file] = { size: info.size, mtimeMs: info.mtimeMs, sha256: sources[file].sha256 };
  };
  let backup = record?.backup || "";
  if (!ours) {
    backup = `originals/${createHash("sha256").update(path.relative(tree, copy.dir)).digest("hex").slice(0, 24)}`;
    const backupDir = path.join(stateDirectory(tree), backup);
    const staging = `${copy.dir}.${randomUUID()}.vibe64-swap`;
    await rm(backupDir, { recursive: true, force: true });
    await mkdir(path.dirname(backupDir), { recursive: true, mode: modes.inheritingDirectory });
    await mkdir(staging, { recursive: true, mode: modes.inheritingDirectory });
    try {
      for (const file of files) await copyFrom(file, path.join(staging, file));
      if (!copy.link && (await existingEntry(path.join(copy.dir, "node_modules")))) {
        await rename(path.join(copy.dir, "node_modules"), path.join(staging, "node_modules"));
      }
      await rename(copy.dir, backupDir);
      await rename(staging, copy.dir);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  } else {
    const wanted = new Set(files);
    for (const file of await listFiles(copy.dir)) {
      if (!wanted.has(file)) {
        await unlink(path.join(copy.dir, file));
        changed = true;
      }
    }
    for (const file of files) {
      const target = path.join(copy.dir, file);
      const previousSource = record.sources?.[file];
      const previousCopy = record.files?.[file];
      if (previousSource && previousCopy && await unchanged(path.join(sourceDir, file), previousSource) &&
          await unchanged(target, previousCopy)) {
        sources[file] = previousSource;
        copied[file] = previousCopy;
        continue;
      }
      await copyFrom(file, target);
      changed = true;
    }
  }
  for (const name of backup ? aside : []) {
    const nested = path.join(copy.dir, "node_modules", name);
    if (!(await existingEntry(nested))) continue;
    const kept = path.join(stateDirectory(tree), backup, "node_modules", name);
    if (await existingEntry(kept)) {
      // The published copy already keeps its own.
      await rm(nested, { recursive: true, force: true });
    } else {
      await mkdir(path.dirname(kept), { recursive: true, mode: modes.inheritingDirectory });
      await rename(nested, kept);
    }
    changed = true;
  }
  return {
    changed,
    record: {
      path: path.relative(tree, copy.dir),
      name: copy.name,
      backup,
      source: sourceDir,
      files: copied,
      sources,
      sourceFiles: (await listFiles(sourceDir)).sort()
    }
  };
}

/**
 * Vite keeps the packages it bundled ahead in node_modules/.vite and checks only the lockfile to
 * reuse them, so a swap would not reach the browser. Without its metadata the next start bundles
 * them again (a running one keeps serving what it has).
 */
async function forgetViteDependencies(tree) {
  const cache = path.join(tree, "node_modules", ".vite");
  for (const entry of await readdir(cache, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) await rm(path.join(cache, entry.name, "_metadata.json"), { force: true });
  }
}

/**
 * Puts a published copy back where a swap replaced it. A copy npm has replaced since is left as npm
 * installed it. Resolves to whether that place holds a published copy now.
 */
async function restoreCopy(tree, record) {
  const dir = path.join(tree, record.path);
  const backupDir = path.join(stateDirectory(tree), record.backup);
  const ours = Boolean(record.files?.["package.json"]) && await unchanged(path.join(dir, "package.json"), record.files["package.json"]);
  if (!ours) {
    await rm(backupDir, { recursive: true, force: true });
    return Boolean(await existingEntry(dir));
  }
  if (!(await existingEntry(backupDir))) {
    await rm(dir, { recursive: true, force: true });
    return false;
  }
  const nested = path.join(dir, "node_modules");
  if (await existingEntry(nested)) await moveAbsentEntries(nested, path.join(backupDir, "node_modules"));
  await rm(dir, { recursive: true, force: true });
  await rename(backupDir, dir);
  return true;
}

/**
 * Gives the published copy back the nested node_modules the swap kept, beside the dependencies it
 * moved aside with that copy: each entry `to` lacks moves into it, inside a scope too.
 */
async function moveAbsentEntries(from, to) {
  if (!(await existingEntry(to))) {
    await rename(from, to);
    return;
  }
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const target = path.join(to, entry.name);
    if (!(await existingEntry(target))) await rename(path.join(from, entry.name), target);
    else if (entry.name.startsWith("@") && entry.isDirectory()) await moveAbsentEntries(path.join(from, entry.name), target);
  }
}

/** Refuses a tracked copy, and keeps an untracked one out of Git. */
async function keepCopiesOutOfGit({ connection, copies, runCommand, writeGitExcludes }) {
  for (const tree of [...new Set(copies.map(copy => copy.tree))]) {
    const relative = copies.filter(copy => copy.tree === tree).map(copy => path.relative(tree, copy.dir));
    const tracked = await runCommand({ command: "git", args: ["ls-files", "-z", "--", ...relative], cwd: tree, timeout: 60_000 });
    if (tracked?.ok !== true) {
      throw vibe64Error(`Connected ${connection.name}: Git could not say whether ${tree} tracks its installed packages.`, "vibe64_connected_npm_git_unavailable");
    }
    if (String(tracked.stdout || "").trim()) {
      throw vibe64Error(
        `Connected ${connection.name}: ${tree} tracks ${String(tracked.stdout).split("\0")[0]} in Git, so Vibe64 will not swap it. Stop tracking node_modules.`,
        "vibe64_connected_npm_tracked"
      );
    }
    // `-z` needs --stdin; installed package paths hold no newline. Exit 1 means none is ignored.
    const ignored = await runCommand({ command: "git", args: ["check-ignore", "--", ...relative], cwd: tree, timeout: 60_000 });
    const ignoredPaths = new Set(String(ignored?.stdout || "").split("\n").filter(Boolean));
    // A tree that does not ignore its installed packages would commit the swapped files with its work.
    if (relative.some(entry => !ignoredPaths.has(entry))) await writeGitExcludes(tree, ["node_modules"]);
  }
}

/**
 * The adapter's context: this connection, every typed npm dependency (for the versions they
 * install), the session's trees and its managed command runner.
 * @typedef {object} NpmAdapterContext
 * @property {{ name: string, repository: string, sourceRoot: string }} connection
 * @property {Array<{ name: string, repository: string, sourceRoot: string }>} npmConnections
 * @property {string[]} trees
 * @property {(request: object) => Promise<object>} runCommand
 * @property {(tree: string, paths: string[]) => Promise<void>} writeGitExcludes
 */

async function connectedVersionsOf(npmConnections) {
  const versions = new Map();
  for (const other of npmConnections) {
    for (const entry of await connectedNpmPackages(other).catch(() => [])) versions.set(entry.name, entry.version);
  }
  return versions;
}

/** Why a connection nothing installs is unused: what a tree would have to install. */
function unusedReason(packages) {
  return `No tree of this session installs any of its packages (${packages.map(entry => entry.name).join(", ")}).`;
}

/**
 * Puts the connection's packages in effect in every tree, idempotently; a connection no tree
 * installs is unused.
 * @param {NpmAdapterContext} context
 */
async function applyNpm({ connection, npmConnections, trees, runCommand, writeGitExcludes }) {
  const packages = await connectedNpmPackages(connection);
  const found = await copiesByPackage(packages, trees);
  if (!found.length) return { lines: [], unused: unusedReason(packages) };
  const lines = [];
  const connectedVersions = await connectedVersionsOf(npmConnections);
  // Dependencies are judged as they resolve after the swap, which moves aside what it plans to.
  let plan = await swapPlan({ connectedVersions, copies: found, packages });
  const needs = await missingDependencies({ connectedVersions, packages, ...plan });
  if (needs.length) {
    lines.push(...await installDependencies({ connection, needs, runCommand }));
    // npm put the lockfile's published copies back (nesting what their own pins need); find them again.
    plan = await swapPlan({ connectedVersions, copies: await copiesByPackage(packages, trees), packages });
    const still = await missingDependencies({ connectedVersions, packages, ...plan });
    if (still.length) {
      throw vibe64Error(
        `Connected ${connection.name}: ${dependencyText(still)}. npm installed it without saving, but the copy still cannot reach a compatible version; align the versions in the connected repository or the application.`,
        "vibe64_connected_npm_dependency_incompatible"
      );
    }
  }
  const { copies, aside } = plan;
  await keepCopiesOutOfGit({ connection, copies, runCommand, writeGitExcludes });
  const used = packages.filter(entry => copies.some(copy => copy.name === entry.name));
  const packlists = await npmPacklists(connection, used, runCommand);
  for (const tree of trees) {
    const state = await readState(tree);
    const records = [];
    let treeChanged = false;
    for (const copy of copies.filter(candidate => candidate.tree === tree)) {
      const entry = packages.find(candidate => candidate.name === copy.name);
      const relative = path.relative(tree, copy.dir);
      const previous = state.copies.find(record => record.path === relative && record.repository === connection.repository);
      const { changed, record } = await swapCopy({
        copy, files: packlists.get(copy.name), sourceDir: entry.dir, record: previous, tree, aside: aside.get(copy.dir)
      });
      if (changed) treeChanged = true;
      records.push({ ...record, repository: connection.repository, version: entry.version });
    }
    // A copy this connection swapped before and no longer installs (its package left the repository)
    // gets its published copy back.
    for (const record of state.copies.filter(candidate => candidate.repository === connection.repository &&
        !records.some(current => current.path === candidate.path))) {
      if (await existingEntry(path.join(tree, record.path))) {
        await restoreCopy(tree, record);
        treeChanged = true;
      }
    }
    if (treeChanged) await forgetViteDependencies(tree);
    const others = state.copies.filter(record => record.repository !== connection.repository);
    if (records.length || others.length !== state.copies.length) {
      await writeState(tree, { ...await readState(tree), copies: [...others, ...records].sort((a, b) => a.path.localeCompare(b.path)) });
    }
  }
  for (const entry of used) {
    const count = copies.filter(copy => copy.name === entry.name).length;
    lines.push(`[Connected] ${connection.name}: ${entry.name} ${entry.version} in effect in ${count} installed ${count === 1 ? "copy" : "copies"}.`);
  }
  return { lines };
}

/**
 * Whether the connection's packages are in effect: every installed copy is the connected package's
 * packlist as last swapped, the connected source has not changed since, and each dependency it
 * needs resolves from where it is installed. Reads files only; cheap enough for status.
 * @param {Omit<NpmAdapterContext, "runCommand" | "writeGitExcludes">} context
 */
async function proveNpm({ connection, npmConnections, trees }) {
  const packages = await connectedNpmPackages(connection);
  const copies = await copiesByPackage(packages, trees);
  if (!copies.length) return notUsed(unusedReason(packages));
  const states = new Map();
  for (const tree of trees) states.set(tree, await readState(tree));
  for (const copy of copies) {
    const relative = path.relative(copy.tree, copy.dir);
    const record = states.get(copy.tree).copies
      .find(candidate => candidate.path === relative && candidate.repository === connection.repository);
    const where = path.join(copy.tree, relative);
    if (!record || copy.link) {
      const installed = await readJsonFile(path.join(copy.dir, "package.json")).catch(() => ({}));
      return { inEffect: false, reason: `${where} is ${copy.link ? "a link, not a copy of the connected source" : `the published ${copy.name} ${installed.version || ""}`.trim()}; prepare the workspace to swap it.` };
    }
    const entry = packages.find(candidate => candidate.name === copy.name);
    if (path.resolve(record.source) !== path.resolve(entry.dir)) {
      return { inEffect: false, reason: `${where} was swapped from another checkout; prepare the workspace again.` };
    }
    const files = Object.keys(record.files);
    const present = new Set(await listFiles(copy.dir));
    for (const file of files) {
      if (!(await unchanged(path.join(copy.dir, file), record.files[file]))) {
        return { inEffect: false, reason: `${where}/${file} no longer holds the connected source.` };
      }
      present.delete(file);
    }
    if (present.size) return { inEffect: false, reason: `${where} holds ${[...present][0]}, which the connected package does not publish.` };
    for (const file of files) {
      if (!(await unchanged(path.join(entry.dir, file), record.sources[file]))) {
        return { inEffect: false, reason: `${entry.name}'s ${file} changed in the connected copy and is not synced yet.` };
      }
    }
    const sourceFiles = (await listFiles(entry.dir)).sort();
    if (JSON.stringify(sourceFiles) !== JSON.stringify(record.sourceFiles)) {
      return { inEffect: false, reason: `Files were added to or removed from ${entry.name} in the connected copy and are not synced yet.` };
    }
  }
  const needs = await missingDependencies({ connectedVersions: await connectedVersionsOf(npmConnections), copies, packages });
  if (needs.length) return { inEffect: false, reason: `${dependencyText(needs)}.` };
  const used = [...new Set(copies.map(copy => copy.name))];
  return { inEffect: true, reason: "", packages: used, copies: copies.length };
}

/**
 * Puts the published copy back wherever a swap belongs to a repository that is no longer a typed npm
 * dependency of this session.
 * @param {{ keep: string[], trees: string[] }} input repositories whose swaps stay
 */
async function restoreNpm({ keep, trees }) {
  const lines = [];
  for (const tree of trees) {
    const state = await readState(tree);
    const gone = state.copies.filter(record => !keep.includes(record.repository));
    if (!gone.length) continue;
    for (const record of gone) {
      const restored = await restoreCopy(tree, record);
      lines.push(`[Connected] ${record.name} at ${path.join(tree, record.path)} ${restored ? "is the published copy again" : "was removed; install the project's dependencies again"}.`);
    }
    await writeState(tree, { ...state, copies: state.copies.filter(record => keep.includes(record.repository)) });
    await forgetViteDependencies(tree);
  }
  return lines;
}

/**
 * Copies the files that changed in a swapped package's source into each of its copies; null when
 * the change needs a new packlist (a file added or removed, or package.json changed), which only a
 * whole apply gives, and when npm has put a published copy back since: only a whole apply judges
 * the dependencies a swap of it would resolve.
 * @param {{ tree: string, repository: string, sourceDir: string }} input
 */
async function syncNpmCopies({ repository, sourceDir, trees }) {
  let synced = 0;
  for (const tree of trees) {
    const state = await readState(tree);
    const records = state.copies
      .filter(record => record.repository === repository && path.resolve(record.source) === path.resolve(sourceDir));
    if (!records.length) continue;
    const sourceFiles = (await listFiles(sourceDir)).sort();
    for (const record of records) {
      if (JSON.stringify(sourceFiles) !== JSON.stringify(record.sourceFiles)) return null;
      if (record.files["package.json"] && !(await unchanged(path.join(sourceDir, "package.json"), record.sources["package.json"]))) return null;
      if (!record.files["package.json"] || !(await unchanged(path.join(tree, record.path, "package.json"), record.files["package.json"]))) return null;
    }
    const updated = [];
    let treeChanged = false;
    for (const record of records) {
      const files = Object.keys(record.files);
      const copy = { dir: path.join(tree, record.path), name: record.name, link: false };
      const next = await swapCopy({ copy, files, sourceDir, record, tree });
      updated.push({ ...record, ...next.record });
      if (next.changed) {
        treeChanged = true;
        synced += 1;
      }
    }
    if (treeChanged) await forgetViteDependencies(tree);
    const latest = await readState(tree);
    await writeState(tree, { ...latest, copies: latest.copies.map(record => updated.find(next => next.path === record.path) || record) });
  }
  return synced;
}

/** The swapped package directories of a session's trees, for its watcher. */
async function swappedNpmSources(trees) {
  const sources = new Map();
  for (const tree of trees) {
    for (const record of (await readState(tree)).copies) sources.set(path.resolve(record.source), record.repository);
  }
  return sources;
}

/** A file the project may not have: null when it does not. */
async function optionalJson(filePath) {
  return readJsonFile(filePath).catch(error => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

/** The project's own declaration of a package (`dependencies` first), or "". */
function declaredSpec(manifest, name) {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (manifest?.[field] && Object.hasOwn(manifest[field], name)) return String(manifest[field][name]);
  }
  return "";
}

/**
 * The versions behind the gap Vibe64 shows: each package of the connection the project declares,
 * with the version the connected copy carries and the one the project's tracked lockfile installs
 * (what Staging and Production install). Files only.
 */
/**
 * Whether the session runs other files than the registry published at the locked version: the swap
 * keeps the published copy it replaced (what `npm ci` installed from the lockfile), so the session
 * tree's own copy is compared file by file with it. Null when the tree holds no swapped copy of it.
 */
async function npmUnreleased(sessionSourceRoot, name, locked) {
  const record = (await readState(sessionSourceRoot)).copies.find(copy => copy.path === path.join("node_modules", name));
  if (!record?.backup || !record.files) return null;
  const backupDir = path.join(stateDirectory(sessionSourceRoot), record.backup);
  // The copy kept aside must be the version the lockfile names.
  if ((await optionalJson(path.join(backupDir, "package.json")))?.version !== locked) return null;
  const published = (await listFiles(backupDir)).sort();
  // A bundled dependency stays in the copy's node_modules, which neither side lists.
  const running = Object.keys(record.files).filter(file => !file.startsWith("node_modules/")).sort();
  if (!published.length) return null;
  if (published.join("\0") !== running.join("\0")) return true;
  for (const file of published) {
    if (await fileDigest(path.join(backupDir, file)) !== record.files[file].sha256) return true;
  }
  return false;
}

async function lockedNpm({ connection, sessionSourceRoot }) {
  const manifest = await optionalJson(path.join(sessionSourceRoot, "package.json"));
  if (!manifest) return [];
  const lock = await optionalJson(path.join(sessionSourceRoot, "package-lock.json"));
  const entries = [];
  for (const entry of await connectedNpmPackages(connection)) {
    if (!declaredSpec(manifest, entry.name)) continue;
    const versions = {
      package: entry.name,
      connected: entry.version || null,
      locked: lock?.packages?.[`node_modules/${entry.name}`]?.version || null
    };
    const unreleased = versions.locked && versions.connected === versions.locked
      ? await npmUnreleased(sessionSourceRoot, entry.name, versions.locked)
      : null;
    entries.push(unreleased === null ? versions : { ...versions, unreleased });
  }
  return entries;
}

/**
 * On Save: when the connected copy carries a version the registry has published and the project's
 * lockfile names another, the project's package.json and lockfile move to it. `--package-lock-only`
 * leaves node_modules (and so the swap) as it is. An unpublished version changes nothing.
 */
async function bumpNpm(context) {
  const { connection, sessionSourceRoot, runCommand } = context;
  const lines = [];
  const bumped = [];
  const manifest = await optionalJson(path.join(sessionSourceRoot, "package.json"));
  for (const entry of await lockedNpm(context)) {
    if (!entry.connected || entry.connected === entry.locked) continue;
    const wanted = `${entry.package}@${entry.connected}`;
    const view = await runCommand({
      command: "npm",
      // A publish check asks the registry, never a cached answer.
      args: ["view", wanted, "version", "--json", "--prefer-online"],
      cwd: sessionSourceRoot,
      timeout: NPM_TIMEOUT_MS
    });
    const said = `${String(view?.stderr || "")} ${String(view?.error || "")}`;
    if (view?.ok !== true && !/\bE404\b/u.test(said)) {
      lines.push(`[Connected] ${connection.name}: could not check whether ${wanted} is published: ${said.trim().slice(-300)}`);
      continue;
    }
    let published = null;
    try {
      published = JSON.parse(String(view?.stdout || "").trim() || "null");
    } catch {
      published = null;
    }
    if ((Array.isArray(published) ? published : [published]).includes(entry.connected) !== true) continue;
    const exact = Boolean(semver.valid(declaredSpec(manifest, entry.package)));
    const installed = await runCommand({
      command: "npm",
      args: [
        "install",
        "--package-lock-only",
        "--prefer-online",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...(exact ? ["--save-exact"] : []),
        wanted
      ],
      cwd: sessionSourceRoot,
      timeout: NPM_TIMEOUT_MS
    });
    if (installed?.ok !== true) {
      lines.push(`[Connected] ${connection.name}: could not move this project to the published ${wanted}: ${String(installed?.stderr || installed?.error || "").trim().slice(-300)}`);
      continue;
    }
    bumped.push({ package: entry.package, from: entry.locked, to: entry.connected });
    lines.push(`[Connected] ${connection.name}: Staging and Production now use the published ${entry.package} ${entry.connected}.`);
    const kept = await keepPublishedCopy({ sessionSourceRoot, name: entry.package, spec: wanted, runCommand });
    if (kept) lines.push(`[Connected] ${connection.name}: ${kept}`);
  }
  return { bumped, lines };
}

/**
 * After Save moved the lockfile, the published copy the swap keeps aside is the one the lockfile
 * now names, downloaded from the registry: what a disconnection puts back, and what the session's
 * copy is compared with for unreleased changes at the same version. Resolves to a line on failure.
 */
async function keepPublishedCopy({ sessionSourceRoot, name, spec, runCommand }) {
  const state = await readState(sessionSourceRoot);
  const record = state.copies.find(copy => copy.path === path.join("node_modules", name));
  if (!record?.backup) return "";
  const backupDir = path.join(stateDirectory(sessionSourceRoot), record.backup);
  const download = `${backupDir}.${randomUUID()}.download`;
  const failed = result => `could not keep the published ${spec} aside: ${String(result?.stderr || result?.error || "").trim().slice(-300)}`;
  try {
    await mkdir(download, { recursive: true, mode: vibe64SharedModes().inheritingDirectory });
    const packed = await runCommand({
      command: "npm",
      args: ["pack", spec, "--json", "--pack-destination", download],
      cwd: sessionSourceRoot,
      timeout: NPM_TIMEOUT_MS
    });
    const filename = packed?.ok === true ? JSON.parse(String(packed.stdout || "[]"))[0]?.filename : "";
    if (!filename) return failed(packed);
    const extracted = await runCommand({ command: "tar", args: ["-xzf", path.join(download, filename), "-C", download], cwd: download, timeout: NPM_TIMEOUT_MS });
    if (extracted?.ok !== true) return failed(extracted);
    await rm(backupDir, { recursive: true, force: true });
    // npm's tarballs hold the package below `package/`.
    await rename(path.join(download, "package"), backupDir);
    return "";
  } finally {
    await rm(download, { recursive: true, force: true });
  }
}

const npmAdapter = Object.freeze({
  type: "npm",
  runtimeRequirements: Object.freeze(["nodejs", "git"]),
  apply: applyNpm,
  proof: proveNpm,
  locked: lockedNpm,
  bump: bumpNpm,
  // The installed copies are copies, so a save reaches them only through the watcher.
  watch: Object.freeze({
    sources: ({ trees }) => swappedNpmSources(trees),
    sync: ({ repository, sourceDir, trees }) => syncNpmCopies({ repository, sourceDir, trees })
  }),
  restore: ({ connections, trees }) => restoreNpm({ keep: connections.map(entry => entry.repository), trees })
});

export { npmAdapter, restoreNpm, swappedNpmSources, syncNpmCopies, STATE_DIRECTORY as NPM_STATE_DIRECTORY };
