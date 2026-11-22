// Vibe64's own treatment of each connected package type. Every `dependency` connection of a type
// other than custom gets two workspace preparation steps: its adapter puts the session's copy of
// the repository in effect after every Prepare step, and proves it after every Verify step. Neither
// runs a project command; the runner hands both to the adapter here.
//
// The contract every adapter implements (one module per type):
//   type                 the package type it treats
//   runtimeRequirements  the Stack runtime ids its commands need
//   apply(context)       puts the connection in effect, idempotently; resolves to { lines }
//   proof(context)       whether it is in effect; resolves to { inEffect, reason }. It reads files
//                        only when context.runCommand is null (session status); in preparation it
//                        may also ask the toolchain
//   restore(input)       optional: takes back what it generated for connections that are gone;
//                        input { connections (those of its type that remain), trees }, resolves to lines
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
 * The preparation steps of the typed dependencies: one apply and one proof each. Their argv only
 * identifies them (resource accounting keys by it); the runner hands them to the adapter.
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
      step("apply", "prepare", `Put connected ${connection.name} in effect (${connection.type})`, adapter.runtimeRequirements),
      step("proof", "verify", `Check connected ${connection.name} is in effect (${connection.type})`, [])
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

/**
 * Runs one adapter step for the runner, with a command-shaped result: `output` for the
 * preparation's transcript, `error` its failure.
 * @param {object} input
 * @param {"apply" | "proof"} input.action
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
    if (action === "apply") {
      // A sync of the same trees waits for the swap, and the swap for it.
      const { lines = [] } = await serializeForTrees(sessionSourceRoot, () => adapter.apply(context));
      return { ok: true, output: lines.join("\n") };
    }
    const proof = await adapter.proof(context);
    return proof.inEffect
      ? { ok: true, output: `[Connected] ${connection.name} is in effect.` }
      : { ok: false, error: `Connected ${connection.name} is not in effect: ${proof.reason}` };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), code: error?.code };
  }
}

/**
 * Whether each typed dependency is in effect now, read from the trees without running anything.
 * @param {{ repositories: Array<object>, sessionSourceRoot: string }} input
 * @returns {Promise<Array<{ name: string, repository: string, type: string, sourceRoot: string, inEffect: boolean, reason: string }>>}
 */
async function inspectConnectedAdapters({ repositories, sessionSourceRoot }) {
  const results = [];
  for (const connection of typedDependencies(repositories)) {
    let proof;
    try {
      proof = await connectedAdapterFor(connection.type).proof(adapterContext({ connection, repositories, sessionSourceRoot }));
    } catch (error) {
      proof = { inEffect: false, reason: String(error?.message || error) };
    }
    results.push({
      name: connection.name,
      repository: connection.repository,
      type: connection.type,
      sourceRoot: connection.sourceRoot,
      inEffect: proof.inEffect === true,
      reason: proof.inEffect === true ? "" : String(proof.reason || "")
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
        trees: sessionTrees(sessionSourceRoot, repositories)
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
  if (!typedDependencies(repositories, "npm").length) {
    await stopConnectedSync(sessionId);
    return null;
  }
  return startConnectedSync({
    sessionId,
    sessionSourceRoot,
    trees: sessionTrees(sessionSourceRoot, repositories),
    // Already inside the trees' queue.
    reapply: async (repository) => {
      const connection = typedDependencies(repositories, "npm").find(entry => entry.repository === repository);
      if (connection) await npmAdapter.apply(adapterContext({ connection, repositories, sessionSourceRoot, runCommand }));
    },
    onEvent
  });
}

export {
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
