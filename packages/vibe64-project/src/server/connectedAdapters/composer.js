// The Composer adapter: the session source's Composer install takes each connected package from its
// connected copy. Vibe64 writes an untracked derived manifest, composer.connected.json: the tracked
// composer.json with a `path` repository (a link, at the version the tracked lock holds) first for
// every connected package, and starts its lock, composer.connected.lock, from the tracked
// composer.lock. `COMPOSER=composer.connected.json composer update <connected packages>` then
// re-resolves only those, so vendor/<package> links to the connected copy while every other
// dependency keeps its locked version. composer.json and composer.lock are never written by the
// swap; an ordinary `composer install` puts the published packages back. The link reads the
// connected copy in place, so a saved file is live with no watcher.
//
// Staging and Production install what the tracked composer.json and composer.lock name, from the
// registries they name. On Save, `bump` moves both to the version the connected copy declares once
// that version is published there (`composer require <package>:<version> --no-install`).
import { realpath } from "node:fs/promises";
import path from "node:path";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { connectionError, notInEffect } from "./adapterResults.js";
import { readDerivedFile, refuseTracked, removeDerivedFiles, writeDerivedFiles } from "./derivedFiles.js";
import { copyDiffersFromRevision } from "./publishedSource.js";
import { existingEntry, readJsonFile } from "./npmPackages.js";

const DERIVED_MANIFEST = "composer.connected.json";
const DERIVED_LOCK = "composer.connected.lock";
const COMPOSER_TIMEOUT_MS = 15 * 60_000;
// Run from the session source: loads its autoloader and prints where PHP finds the package.
const INSTALL_PATH_PROBE = [
  "require $argv[1];",
  "if (!\\Composer\\InstalledVersions::isInstalled($argv[2])) { exit(3); }",
  "echo \\Composer\\InstalledVersions::getInstallPath($argv[2]);"
].join(" ");

async function optionalJson(filePath) {
  if (!(await existingEntry(filePath))) return null;
  return readJsonFile(filePath).catch(() => {
    throw vibe64Error(`${filePath} is not valid JSON.`, "vibe64_connected_composer_manifest_invalid");
  });
}

function lockedPackages(lock) {
  return [...(lock?.packages || []), ...(lock?.["packages-dev"] || [])];
}

/** The tracked manifest's repositories as Composer's array form (it also accepts an object keyed by name). */
function trackedRepositories(manifest) {
  const repositories = manifest.repositories || [];
  if (Array.isArray(repositories)) return repositories;
  return Object.entries(repositories).map(([name, repository]) => (repository === false ? { [name]: false } : repository));
}

async function realRoot(connection) {
  return realpath(connection.sourceRoot).catch(() => {
    throw connectionError(connection, `its connected copy ${connection.sourceRoot} is missing.`, "vibe64_connected_composer_copy_missing");
  });
}

/**
 * What the session's Composer install must look like for every connected Composer dependency.
 * @param {{ connections: Array<object>, sessionSourceRoot: string }} input
 */
async function composerPlan({ connections, sessionSourceRoot }) {
  const manifestPath = path.join(sessionSourceRoot, "composer.json");
  const manifest = await optionalJson(manifestPath);
  if (!manifest) {
    throw connectionError(
      connections[0],
      "the session source has no composer.json, so no Composer install uses it.",
      "vibe64_connected_composer_unused"
    );
  }
  const lockText = await readDerivedFile(sessionSourceRoot, "composer.lock");
  const lock = lockText === null ? null : JSON.parse(lockText);
  const locked = new Map(lockedPackages(lock).map(entry => [entry.name, entry.version]));
  const required = new Set([...Object.keys(manifest.require || {}), ...Object.keys(manifest["require-dev"] || {})]);
  const packages = [];
  for (const connection of connections) {
    const root = await realRoot(connection);
    const own = await optionalJson(path.join(root, "composer.json"));
    if (typeof own?.name !== "string" || !own.name) {
      throw connectionError(
        connection,
        "its connected copy has no composer.json naming its package.",
        "vibe64_connected_composer_manifest_invalid"
      );
    }
    if (!locked.has(own.name) && !required.has(own.name)) {
      throw connectionError(
        connection,
        `the session's composer.json and composer.lock do not use ${own.name}, so nothing would take it from the connected copy.`,
        "vibe64_connected_composer_unused"
      );
    }
    // A checkout on a branch would be dev-<branch>: present it as the version the app locked.
    const version = locked.get(own.name) || (typeof own.version === "string" ? own.version : "");
    packages.push({
      connection,
      name: own.name,
      root,
      version
    });
  }
  const derived = {
    ...manifest,
    // Path repositories listed first win over Packagist and the tracked repositories.
    repositories: [
      ...packages.map(entry => ({
        type: "path",
        url: entry.root,
        options: {
          symlink: true,
          ...(entry.version ? { versions: { [entry.name]: entry.version } } : {})
        }
      })),
      ...trackedRepositories(manifest)
    ]
  };
  return {
    lockText,
    manifestText: `${JSON.stringify(derived, null, 4)}\n`,
    packages,
    vendorDir: String(manifest.config?.["vendor-dir"] || "vendor").replace(/\/+$/u, "")
  };
}

function planEntry(plan, connection) {
  return plan.packages.find(entry => entry.connection.repository === connection.repository);
}

/** Puts every connected Composer dependency in effect in the session source. */
async function applyComposer({ connection, connections, sessionSourceRoot, runCommand, writeGitExcludes }) {
  const plan = await composerPlan({ connections, sessionSourceRoot });
  const installed = plan.packages.map(entry => `${plan.vendorDir}/${entry.name}`);
  // Composer writes the derived lock itself when there is no tracked one to start it from.
  await refuseTracked({
    connection,
    tree: sessionSourceRoot,
    paths: [...installed, ...(plan.lockText === null ? [DERIVED_LOCK] : [])],
    runCommand
  });
  await writeDerivedFiles({
    connection,
    tree: sessionSourceRoot,
    files: {
      [DERIVED_MANIFEST]: plan.manifestText,
      ...(plan.lockText === null ? {} : { [DERIVED_LOCK]: plan.lockText })
    },
    runCommand,
    writeGitExcludes
  });
  // The installed packages change too: vendor/ must never reach a commit with the links in it.
  await writeGitExcludes(sessionSourceRoot, [DERIVED_MANIFEST, DERIVED_LOCK, plan.vendorDir]);
  const result = await runCommand({
    command: "composer",
    args: ["update", "--no-interaction", "--no-progress", ...(plan.lockText === null ? [] : plan.packages.map(entry => entry.name))],
    cwd: sessionSourceRoot,
    timeout: COMPOSER_TIMEOUT_MS,
    env: {
      COMPOSER: DERIVED_MANIFEST,
      COMPOSER_NO_AUDIT: "1"
    }
  });
  if (result?.ok !== true) {
    const detail = String(result?.stderr || result?.error || "").trim().split("\n").slice(-8).join("\n");
    throw connectionError(
      connection,
      `composer update could not take the connected packages. ${detail}`.trim(),
      "vibe64_connected_composer_update_failed"
    );
  }
  const own = planEntry(plan, connection);
  const version = own.version ? ` ${own.version}` : "";
  return { lines: [`[Connected] ${connection.name}: ${own.name}${version} in effect from its connected copy.`] };
}

async function linkTarget(filePath) {
  const entry = await existingEntry(filePath);
  if (!entry?.isSymbolicLink()) return "";
  return realpath(filePath).catch(() => "");
}

/** Whether this connection's package is installed from its connected copy. */
async function proveComposer({ connection, connections, sessionSourceRoot, runCommand }) {
  const plan = await composerPlan({ connections, sessionSourceRoot });
  const own = planEntry(plan, connection);
  const manifest = await readDerivedFile(sessionSourceRoot, DERIVED_MANIFEST);
  if (manifest === null) {
    return notInEffect(`${DERIVED_MANIFEST} is missing; prepare the workspace to take ${own.name} from the connected copy.`);
  }
  if (manifest !== plan.manifestText) {
    return notInEffect(`${DERIVED_MANIFEST} no longer matches composer.json and the connected copies; prepare the workspace again.`);
  }
  const lockText = await readDerivedFile(sessionSourceRoot, DERIVED_LOCK);
  const lockEntry = lockedPackages(lockText === null ? null : JSON.parse(lockText)).find(entry => entry.name === own.name);
  const lockedRoot = lockEntry?.dist?.type === "path" ? await realpath(String(lockEntry.dist.url || "")).catch(() => "") : "";
  if (lockedRoot !== own.root) {
    return notInEffect(`${DERIVED_LOCK} does not lock ${own.name} to the connected copy; prepare the workspace again.`);
  }
  const vendorPath = `${plan.vendorDir}/${own.name}`;
  if (await linkTarget(path.join(sessionSourceRoot, vendorPath)) !== own.root) {
    return notInEffect(`${vendorPath} is not a link to the connected copy (an ordinary composer install puts the published package back); `
      + "prepare the workspace again.");
  }
  if (!runCommand) return { inEffect: true, reason: "" };
  const probe = await runCommand({
    command: "php",
    args: ["-r", INSTALL_PATH_PROBE, path.join(sessionSourceRoot, plan.vendorDir, "autoload.php"), own.name],
    cwd: sessionSourceRoot,
    timeout: 60_000
  });
  if (probe?.ok !== true) return notInEffect(`PHP's autoloader does not find ${own.name} as installed.`);
  const resolved = await realpath(String(probe.stdout || "").trim()).catch(() => String(probe.stdout || "").trim());
  if (resolved !== own.root) return notInEffect(`PHP's autoloader finds ${own.name} at ${resolved}, not the connected copy ${own.root}.`);
  return { inEffect: true, reason: "" };
}

/** Removes the derived manifest, its lock and the links it installed once no Composer connection remains. */
async function restoreComposer({ connections, sessionSourceRoot, writeGitExcludes }) {
  if (connections.length) return [];
  const lockText = await readDerivedFile(sessionSourceRoot, DERIVED_LOCK);
  const manifest = await optionalJson(path.join(sessionSourceRoot, "composer.json")).catch(() => null);
  const vendorDir = String(manifest?.config?.["vendor-dir"] || "vendor").replace(/\/+$/u, "");
  const paths = [];
  for (const relative of [DERIVED_MANIFEST, DERIVED_LOCK]) {
    if (await existingEntry(path.join(sessionSourceRoot, relative))) paths.push(relative);
  }
  // The links the derived lock installed; a lock Composer left unreadable has none to name.
  let derivedLock = null;
  try {
    derivedLock = lockText === null ? null : JSON.parse(lockText);
  } catch {
    derivedLock = null;
  }
  for (const entry of lockedPackages(derivedLock)) {
    const relative = `${vendorDir}/${entry.name}`;
    const installed = await existingEntry(path.join(sessionSourceRoot, relative));
    if (entry.dist?.type === "path" && installed?.isSymbolicLink()) paths.push(relative);
  }
  // A session that never had a Composer connection is left exactly as it is.
  if (!paths.length) return [];
  const removed = await removeDerivedFiles({
    tree: sessionSourceRoot,
    paths,
    writeGitExcludes
  });
  return [`[Connected] composer: removed ${removed.join(", ")}; the next composer install puts the published packages back.`];
}

function normalVersion(version) {
  return typeof version === "string" && version ? version.replace(/^v(?=\d)/u, "") : null;
}

/**
 * The version the connected copy declares and the one the tracked composer.lock (what Staging and
 * Production install) holds, for this connection's package when the project uses it. Reads files only.
 */
async function lockedComposer({ connection, sessionSourceRoot, runCommand = null }) {
  const sourceDir = await realRoot(connection);
  const own = await optionalJson(path.join(sourceDir, "composer.json"));
  if (typeof own?.name !== "string" || !own.name) return [];
  const manifest = await optionalJson(path.join(sessionSourceRoot, "composer.json"));
  const lockText = await readDerivedFile(sessionSourceRoot, "composer.lock");
  const entry = lockedPackages(lockText === null ? null : JSON.parse(lockText)).find(candidate => candidate.name === own.name);
  const required = Object.hasOwn(manifest?.require || {}, own.name) || Object.hasOwn(manifest?.["require-dev"] || {}, own.name);
  if (!entry && !required) return [];
  const versions = {
    package: own.name,
    connected: normalVersion(own.version),
    locked: normalVersion(entry?.version)
  };
  // The lock names the commit the registry published at that version; a copy carrying another
  // version is Save's to move to, not a change at the same one.
  const revision = entry?.source?.reference || entry?.dist?.reference || "";
  const unreleased = versions.locked && (!versions.connected || versions.connected === versions.locked)
    ? await copyDiffersFromRevision({ sourceDir, revision: /^[0-9a-f]{7,64}$/u.test(revision) ? revision : "", runCommand })
    : null;
  return [unreleased === null ? versions : { ...versions, unreleased }];
}

/** Composer's own words for a failure: its first message line, past exception names and file locations. */
function composerSaid(result) {
  return `${result?.stderr || ""}\n${result?.stdout || ""}\n${result?.error || ""}`.split("\n")
    .map(line => line.trim())
    .filter(line => line && !/^\[[\w\\]+\]$|^In \S+ line \d+:$/u.test(line))[0] || "";
}

/** Whether the registries the tracked composer.json names publish this version: true, false, or the reason it cannot tell. */
async function composerPublishes({ sessionSourceRoot, runCommand, name, version }) {
  const shown = await runCommand({
    command: "composer",
    args: ["show", "--all", "--format=json", "--no-interaction", name],
    cwd: sessionSourceRoot,
    timeout: COMPOSER_TIMEOUT_MS,
    // The tracked manifest, never the derived one: only what Staging and Production can install.
    env: { COMPOSER: "composer.json" }
  });
  if (shown?.ok !== true) {
    // The package itself is unknown there; a registry answering 404 is a failure to check, not this.
    if (/Package "?[\w./-]+"? not found/iu.test(`${shown?.stderr || ""}\n${shown?.stdout || ""}`)) return false;
    return composerSaid(shown) || "composer show failed";
  }
  let versions;
  try {
    versions = JSON.parse(String(shown.stdout || "")).versions;
  } catch {
    versions = null;
  }
  if (!Array.isArray(versions)) return "composer show listed no versions";
  return versions.some(candidate => normalVersion(candidate) === version);
}

/**
 * On Save: moves the tracked composer.json and composer.lock to the version the connected copy
 * declares once its registry publishes it, then puts the connection in effect again on top.
 */
async function bumpComposer(context) {
  const { connection, sessionSourceRoot, runCommand } = context;
  const bumped = [];
  const lines = [];
  for (const entry of await lockedComposer(context)) {
    if (!entry.connected || entry.connected === entry.locked) continue;
    const manifest = await optionalJson(path.join(sessionSourceRoot, "composer.json"));
    const dev = Object.hasOwn(manifest?.["require-dev"] || {}, entry.package);
    if (!dev && !Object.hasOwn(manifest?.require || {}, entry.package)) {
      lines.push(`[Connected] ${connection.name}: ${entry.package} is not required by composer.json itself, `
        + `so Vibe64 leaves its locked ${entry.locked}.`);
      continue;
    }
    const published = await composerPublishes({ sessionSourceRoot, runCommand, name: entry.package, version: entry.connected });
    if (published === false) continue;
    if (published !== true) {
      lines.push(`[Connected] ${connection.name}: could not check whether ${entry.package} ${entry.connected} is published: `
        + `${published.replace(/\.$/u, "")}.`);
      continue;
    }
    // Composer reverts composer.json and composer.lock itself when the update fails.
    const required = await runCommand({
      command: "composer",
      args: [
        "require",
        ...(dev ? ["--dev"] : []),
        `${entry.package}:${entry.connected}`,
        "--no-install",
        "--no-interaction",
        "--no-progress"
      ],
      cwd: sessionSourceRoot,
      timeout: COMPOSER_TIMEOUT_MS,
      env: {
        COMPOSER: "composer.json",
        COMPOSER_NO_AUDIT: "1"
      }
    });
    if (required?.ok !== true) {
      lines.push(`[Connected] ${connection.name}: could not move ${entry.package} to the published ${entry.connected}: `
        + `${composerSaid(required).replace(/\.$/u, "")}.`);
      continue;
    }
    bumped.push({
      package: entry.package,
      from: entry.locked,
      to: entry.connected
    });
    lines.push(`[Connected] ${connection.name}: Staging and Production now use the published ${entry.package} ${entry.connected}.`);
  }
  // The derived manifest and lock start from the tracked ones, which just moved.
  if (bumped.length) lines.push(...(await applyComposer(context)).lines);
  return { bumped, lines };
}

const composerAdapter = Object.freeze({
  type: "composer",
  runtimeRequirements: Object.freeze(["php", "composer", "git"]),
  apply: applyComposer,
  proof: proveComposer,
  restore: restoreComposer,
  locked: lockedComposer,
  bump: bumpComposer
});

export { composerAdapter };
