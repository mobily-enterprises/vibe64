// Vibe64's own treatment of each connected package type. Every `dependency` connection of a type
// other than custom gets its own workspace preparation steps: its adapter keeps the session's copy
// of the repository in effect after each Prepare step but the last (an install puts the published
// package back, and the next step may run the project), puts it in effect after the last, and
// proves it after the Verify steps. None runs a project command; the runner hands each to the
// adapter here.
//
// The contract every adapter implements (one module per type):
//   type                 the package type it treats
//   runtimeRequirements  the Stack runtime ids its commands need
//   apply(context)       puts the connection in effect, idempotently; resolves to { lines }, with
//                        `unused` (why) when nothing in the session installs the connection, which
//                        is no failure: the other connections of its type still apply
//   proof(context)       whether it is in effect; resolves to { inEffect, reason, note? }, or
//                        notUsed(reason) ({ unused: true }) for a connection nothing installs. It reads
//                        files only when context.runCommand is null (session status), and says unused
//                        exactly when preparation's would, from the files or from what preparation
//                        recorded beside them; in preparation it may also ask the toolchain, and
//                        `note` says what that could not check
//   locked(context)      [{ package, connected, locked, unreleased? }], the version the connected copy
//                        carries and the published one the project's tracked lockfile installs (what
//                        Staging and Production use); the gap Vibe64 shows comes from it. `unreleased`,
//                        only from a type that can tell, says whether the copy differs from what was
//                        published at the locked version (npm from files; Go modules and Composer ask
//                        Git, so only with a runCommand, which never runs a toolchain here)
//   bump(context)        on Save, with runCommand: moves the project's tracked manifest and lockfile to
//                        `connected` once its registry has published it, never to an unpublished
//                        commit; resolves to { bumped: [{ package, from, to }], lines }; never throws
//                        for "not published" or "could not check"
//   watch                optional, for a type that is not live by nature (npm copies files):
//                        { sources(context) -> Map<sourceDir, repository>, sync(context + { repository,
//                        sourceDir }) -> changed count, or null to apply again }
//   restore(input)       optional: takes back what it generated for connections that are gone;
//                        input { connections (those of its type that remain), sessionSourceRoot, trees,
//                        writeGitExcludes }, resolves to lines. It runs when the Sources file is written,
//                        with no command runner
// Adapters other than npm write their derived files through ./derivedFiles.js.
// The context: the connection ({ name, repository, relationship, type, sourceRoot }), `connections`
// (every dependency connection of the same type), the session source, its trees (the session source
// and every connected copy), `runCommand({ command, args, cwd, timeout?, env? })` (a managed command
// in the session's trees; null for status) and `writeGitExcludes(tree, paths)`. An adapter never
// writes a tracked file, and keeps what it generates out of Git.
import path from "node:path";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { connectedPackageTypeHasAdapter } from "@local/vibe64-genesis/shared/connectedPackageTypes";
import { writeManagedGitExcludes } from "../projectEnvironmentFiles.js";
import { bundlerAdapter } from "./bundler.js";
import { cargoAdapter } from "./cargo.js";
import { composerAdapter } from "./composer.js";
import { gomodAdapter } from "./gomod.js";
import { gradleAdapter } from "./gradle.js";
import { mavenAdapter } from "./maven.js";
import { npmAdapter } from "./npm.js";
import { nugetAdapter } from "./nuget.js";
import { pipAdapter } from "./pip.js";
import { connectedSyncRunning, serializeForTrees, startConnectedSync, stopConnectedSync } from "./sync.js";

const CONNECTED_ADAPTERS = Object.freeze(Object.fromEntries([
  npmAdapter, composerAdapter, pipAdapter, bundlerAdapter, gomodAdapter, cargoAdapter, mavenAdapter, gradleAdapter, nugetAdapter
].map(adapter => [adapter.type, adapter])));

/** @param {string} type */
function connectedAdapterFor(type) {
  const adapter = CONNECTED_ADAPTERS[type];
  if (!adapter) throw vibe64Error(`Vibe64 has no treatment for connected ${type} packages.`, "vibe64_connected_adapter_missing");
  return adapter;
}

/**
 * The preparation steps of the typed dependencies: a keep, an apply and a proof each. Their argv
 * only identifies them (resource accounting keys by it); the runner hands them to the adapter.
 * @param {Array<{ name: string, repository: string, type: string }>} connections
 */
function connectedAdapterSteps(connections) {
  return connections.flatMap(connection => {
    const adapter = connectedAdapterFor(connection.type);
    const step = (action, phase, label, runtimeRequirements) => ({
      label,
      argv: ["vibe64-connected", connection.type, action, connection.repository],
      workdir: ".",
      runtimeRequirements: [...runtimeRequirements],
      phase,
      connectedAdapter: { action, type: connection.type, repository: connection.repository }
    });
    return [
      step("keep", "prepare", `Keep connected ${connection.name} in effect (${connection.type})`, adapter.runtimeRequirements),
      step("apply", "prepare", `Put connected ${connection.name} in effect (${connection.type})`, adapter.runtimeRequirements),
      // The proof may ask the toolchain how the build resolves the connection.
      step("proof", "verify", `Check connected ${connection.name} is in effect (${connection.type})`, adapter.runtimeRequirements)
    ];
  });
}

/** The session's trees: its source and each connected copy. */
function sessionTrees(sessionSourceRoot, repositories) {
  return [...new Set([sessionSourceRoot, ...repositories.map(entry => entry.sourceRoot)].map(entry => path.resolve(entry)))];
}

function typedDependencies(repositories, type = "") {
  return repositories.filter(entry => entry.relationship === "dependency" && connectedPackageTypeHasAdapter(entry.type) &&
    (!type || entry.type === type));
}

function adapterContext({ connection, repositories, sessionSourceRoot, runCommand = null }) {
  const sameType = typedDependencies(repositories, connection.type);
  return {
    connection,
    connections: sameType,
    npmConnections: typedDependencies(repositories, "npm"),
    repositories,
    sessionSourceRoot,
    trees: sessionTrees(sessionSourceRoot, repositories),
    runCommand,
    // One managed block per type, so each type's paths stay when another type writes its own.
    writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: `connected ${connection.type} packages` })
  };
}

/** What preparation and status say of a connection nothing in the session installs. */
function unusedText(connection, reason) {
  return `${connection.name} is connected, but nothing here installs it: remove it or install it. ${reason}`.trim();
}

/**
 * Runs one adapter step for the runner, with a command-shaped result: `output` for the
 * preparation's transcript, `error` its failure. A connection nothing installs is no failure:
 * preparation goes on, and the output says so.
 * @param {object} input
 * @param {"keep" | "apply" | "proof"} input.action
 * @param {string} input.repository the step's connection
 * @param {Array<object>} input.repositories the session's prepared connections
 * @param {string} input.sessionSourceRoot
 * @param {(request: { command: string, args: string[], cwd: string, timeout?: number }) => Promise<object>} input.runCommand
 */
async function runConnectedAdapterStep({ action, repository, repositories, sessionSourceRoot, runCommand }) {
  const connection = typedDependencies(repositories).find(entry => entry.repository === repository);
  if (!connection) {
    return { ok: false, error: `${repository} is no longer a typed connected dependency of this session. Prepare the workspace again.` };
  }
  const adapter = connectedAdapterFor(connection.type);
  try {
    const context = adapterContext({ connection, repositories, sessionSourceRoot, runCommand });
    if (action === "keep") {
      // Between Prepare steps the adapter applies again only what a step undid, judged as session
      // status judges it, without the toolchain. The apply after the last Prepare step does the whole
      // work, and says when nothing installs the connection.
      const proof = await adapter.proof(adapterContext({ connection, repositories, sessionSourceRoot })).catch(() => null);
      if (proof?.inEffect === true) return { ok: true, output: `[Connected] ${connection.name} is in effect.` };
      if (proof?.unused === true) return { ok: true, output: "" };
    }
    if (action === "apply" || action === "keep") {
      // A sync of the same trees waits for the swap, and the swap for it.
      const { lines = [], unused } = await serializeForTrees(sessionSourceRoot, () => adapter.apply(context));
      return { ok: true, output: [...lines, ...(unused ? [`[Connected] ${unusedText(connection, unused)}`] : [])].join("\n") };
    }
    const proof = await adapter.proof(context);
    if (proof.unused) return { ok: true, output: `[Connected] ${unusedText(connection, proof.reason)}` };
    if (!proof.inEffect) return { ok: false, error: `Connected ${connection.name} is not in effect: ${proof.reason}` };
    const gaps = (await lockedVersions(connection, context)).map(entry => releaseGapLine(connection, entry));
    const note = proof.note ? [`[Connected] ${connection.name}: ${proof.note}`] : [];
    return { ok: true, output: [`[Connected] ${connection.name} is in effect.`, ...note, ...gaps].join("\n") };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), code: error?.code };
  }
}

/**
 * Whether each typed dependency is in effect now, read from the trees without running anything,
 * and what Staging and Production use instead. `runCommand`, when given, is only for the read-only
 * Git questions of `locked` (has the copy changed since the published commit); proofs never get it.
 * @param {{ repositories: Array<object>, sessionSourceRoot: string, runCommand?: Function | null }} input
 * A connection nothing installs is `unused`, its reason the sentence status shows.
 * @returns {Promise<Array<{ name: string, repository: string, type: string, sourceRoot: string, inEffect: boolean, unused: boolean, reason: string, published: Array<object> }>>}
 */
async function inspectConnectedAdapters({ repositories, sessionSourceRoot, runCommand = null }) {
  const results = [];
  for (const connection of typedDependencies(repositories)) {
    let proof;
    try {
      proof = await connectedAdapterFor(connection.type).proof(adapterContext({ connection, repositories, sessionSourceRoot }));
    } catch (error) {
      proof = { inEffect: false, reason: String(error?.message || error) };
    }
    const published = await lockedVersions(connection, adapterContext({ connection, repositories, sessionSourceRoot, runCommand }))
      .catch(() => []);
    results.push({
      name: connection.name,
      repository: connection.repository,
      type: connection.type,
      sourceRoot: connection.sourceRoot,
      inEffect: proof.inEffect === true,
      unused: proof.inEffect !== true && proof.unused === true,
      reason: proof.inEffect === true ? "" : proof.unused === true ? unusedText(connection, String(proof.reason || "")) : String(proof.reason || ""),
      published
    });
  }
  return results;
}

/**
 * Puts back what an adapter changed for a repository that is no longer a typed dependency, before
 * the next preparation runs. Resolves to the preparation's lines.
 * @param {{ repositories: Array<object>, sessionSourceRoot: string }} input
 */
async function restoreDisconnected({ repositories, sessionSourceRoot }) {
  return serializeForTrees(sessionSourceRoot, async () => {
    const lines = [];
    for (const adapter of Object.values(CONNECTED_ADAPTERS)) {
      if (!adapter.restore) continue;
      lines.push(...await adapter.restore({
        connections: typedDependencies(repositories, adapter.type),
        sessionSourceRoot,
        trees: sessionTrees(sessionSourceRoot, repositories),
        writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: `connected ${adapter.type} packages` })
      }));
    }
    return lines;
  });
}

/**
 * Keeps the session's swapped packages in step with its connected copies until stopped: a saved
 * file is copied at once; a change to what npm publishes puts that connection in effect again.
 * @param {object} input
 * @param {string} input.sessionId
 * @param {Array<object>} input.repositories the session's prepared connections
 * @param {string} input.sessionSourceRoot
 * @param {(request: object) => Promise<object>} input.runCommand as for runConnectedAdapterStep
 * @param {(event: object) => void} [input.onEvent]
 */
async function syncConnectedRepositories({ sessionId, repositories, sessionSourceRoot, runCommand, onEvent }) {
  const watching = typedDependencies(repositories).filter(connection => connectedAdapterFor(connection.type).watch);
  if (!watching.length) {
    await stopConnectedSync(sessionId);
    return null;
  }
  const contextFor = connection => adapterContext({ connection, repositories, sessionSourceRoot, runCommand });
  const connectionOf = repository => watching.find(entry => entry.repository === repository);
  return startConnectedSync({
    sessionId,
    sessionSourceRoot,
    watched: async () => {
      const all = new Map();
      for (const connection of watching) {
        for (const [dir, repository] of await connectedAdapterFor(connection.type).watch.sources(contextFor(connection))) {
          if (repository === connection.repository) all.set(dir, repository);
        }
      }
      return all;
    },
    sync: async (repository, sourceDir) => {
      const connection = connectionOf(repository);
      return connection ? connectedAdapterFor(connection.type).watch.sync({ ...contextFor(connection), repository, sourceDir }) : 0;
    },
    // Already inside the trees' queue.
    reapply: async (repository) => {
      const connection = connectionOf(repository);
      if (connection) await connectedAdapterFor(connection.type).apply(contextFor(connection));
    },
    onEvent
  });
}

/** The visible gap between what the session runs and what Staging and Production install. */
function releaseGapLine(connection, entry) {
  const runs = `[Connected] ${connection.name}: this session runs the connected ${entry.package}`;
  if (!entry.locked) return `${runs}; Vibe64 cannot tell which published version Staging and Production use.`;
  if (entry.connected && entry.connected !== entry.locked) {
    return `${runs}; Staging and Production use the published ${entry.locked} until ${entry.connected} is published, which Save then moves this project to.`;
  }
  return entry.unreleased === true
    ? `${runs}; Staging and Production use the published ${entry.locked}, and the connected copy has unreleased changes at the same version: ` +
      "publish a new version, which Save then moves this project to."
    : `${runs}; Staging and Production use the published ${entry.locked}.`;
}

async function lockedVersions(connection, context) {
  const adapter = connectedAdapterFor(connection.type);
  return adapter.locked ? adapter.locked(context) : [];
}

/**
 * Save's part for typed dependencies: they get no pin, they move by published versions. Each
 * adapter's `bump` moves the project's tracked manifest and lockfile to a version the connected copy
 * carries once its registry has published it; the lines then say what Staging and Production use.
 * Never throws: a failure to check is a line, and Save goes on.
 * @param {{ repositories: Array<object>, sessionSourceRoot: string, runCommand: Function }} input
 * @returns {Promise<{ lines: string[], bumped: Array<{ name: string, package: string, from: string | null, to: string }> }>}
 */
async function bumpConnectedDependencies({ repositories, sessionSourceRoot, runCommand }) {
  const lines = [];
  const bumped = [];
  for (const connection of typedDependencies(repositories)) {
    const adapter = connectedAdapterFor(connection.type);
    const context = adapterContext({ connection, repositories, sessionSourceRoot, runCommand });
    try {
      if (adapter.bump) {
        const result = await serializeForTrees(sessionSourceRoot, () => adapter.bump(context));
        lines.push(...result.lines);
        bumped.push(...result.bumped.map(entry => ({ name: connection.name, ...entry })));
      }
      for (const entry of await lockedVersions(connection, context)) lines.push(releaseGapLine(connection, entry));
    } catch (error) {
      lines.push(`[Connected] ${connection.name}: could not check for a published version: ${String(error?.message || error)}`);
    }
  }
  return { bumped, lines };
}

export {
  bumpConnectedDependencies,
  CONNECTED_ADAPTERS,
  connectedAdapterFor,
  connectedSyncRunning,
  connectedAdapterSteps,
  inspectConnectedAdapters,
  restoreDisconnected,
  runConnectedAdapterStep,
  sessionTrees,
  stopConnectedSync,
  syncConnectedRepositories
};
