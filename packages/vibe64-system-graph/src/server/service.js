import {
  inspectVibe64ArchitectureInspection,
  inspectVibe64ArchitectureLayout,
  mergeArchitectureObservations,
  refreshGenesisCities
} from "@local/vibe64-genesis/server";
import { randomUUID } from "node:crypto";
import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { vibe64RuntimePacks } from "@local/vibe64-terminals/server/vibe64OutputTargets";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";

import {
  readGenesisCity,
  requireGenesisCity,
  validateGenesisCity
} from "./genesisCities.js";

function systemResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_system_graph_failed",
    fallbackMessage: "Vibe64 architecture operation failed."
  });
}

function systemError(message, code, details = {}) {
  const error = vibe64Error(message, code);
  error.details = details;
  return error;
}

function cityStatus(record, error = null) {
  if (error) {
    return {
      available: false,
      error: {
        code: String(error.code || "vibe64_invalid_genesis_city"),
        message: String(error.message || error)
      },
      path: error.details?.path || record?.path || "",
      state: "invalid"
    };
  }
  if (!record?.exists) {
    return {
      available: false,
      error: null,
      path: record?.path || "",
      state: "missing"
    };
  }
  return {
    available: true,
    error: null,
    path: record.path,
    schema: record.city.schema,
    schemaVersion: record.city.schemaVersion,
    state: "ready",
    status: record.city.status
  };
}

function combinedStatus(cities) {
  const states = Object.values(cities).map((city) => city.state);
  if (states.includes("invalid")) {
    return "invalid";
  }
  if (states.includes("missing")) {
    return "missing";
  }
  return "ready";
}

function settledCityStatus(result, kind) {
  if (result.status === "fulfilled") {
    return cityStatus(result.value);
  }
  return cityStatus({ kind }, result.reason);
}

function architectureCancelled() {
  return systemError("Architecture analysis was cancelled.", "vibe64_architecture_cancelled");
}

function inspectorRuntime(inspector, runtimeReader) {
  const runtime = runtimeReader(inspector.runtimeRequirements);
  if (!runtime.available) throw systemError(runtime.disabledReason, "vibe64_architecture_runtime_unavailable");
  return runtime;
}

// The inspector's workdir and each ancestor must be a real project directory.
async function assertInspectorWorkdir(sourceRoot, inspector) {
  const ancestors = inspector.workdir === "." ? [] : inspector.workdir.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"));
  for (const directory of ["", ...ancestors]) {
    const info = await lstat(path.join(sourceRoot, directory));
    if (!info.isDirectory() || info.isSymbolicLink()) throw systemError("An architecture inspector directory must be a real project directory.", "vibe64_architecture_directory_invalid");
  }
}

// Prerequisites are explicit consumer facts, not command/language guesses.
async function assertInspectorPrerequisites(sourceRoot, realSourceRoot, inspector, runtimeReader) {
  inspectorRuntime(inspector, runtimeReader);
  await assertInspectorWorkdir(sourceRoot, inspector);
  for (const file of inspector.requiredFiles || []) {
    try {
      const resolved = await realpath(path.join(sourceRoot, file));
      const relative = path.relative(realSourceRoot, resolved);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) throw new Error("Invalid required file");
    } catch {
      throw systemError(`${inspector.title} needs ${file}. Prepare this project's dependencies, then retry.`, "vibe64_architecture_prerequisite_missing");
    }
  }
}

function architectureInspectionRequest(architecture, inspection) {
  const request = `${JSON.stringify({
    schema: "vibe64.architecture-inspection-input.v1",
    files: architecture.files.map(file => ({ path: file.path, hash: file.hash })),
    packages: (architecture.packages || []).map(({ id, name, manifest, declarations, root, opaque, entryPoints }) => ({
      id, name, manifest, declarations, root, opaque,
      entryPoints: entryPoints.map(({ importPath, file }) => ({ importPath, file }))
    })),
    packageIdentity: architecture.packageIdentity,
    uiDiscovery: architecture.uiDiscovery,
    stackHash: inspection.stackHash
  })}\n`;
  if (Buffer.byteLength(request) > 4 * 1024 * 1024) throw systemError("Architecture inspection inputs exceed the supported bound.", "vibe64_architecture_input_too_large");
  return request;
}

// Runs one declared inspector and returns its parsed observation document.
async function runArchitectureInspector({ inspector, request, current, signal, progress, runCommand, projectService, runtimeReader }) {
  if (signal.aborted) throw architectureCancelled();
  const runtime = inspectorRuntime(inspector, runtimeReader);
  await assertInspectorWorkdir(current.sourceRoot, inspector);
  const [command, ...args] = inspector.argv;
  await progress(`Running ${inspector.title}…`);
  const execution = await runCommand({
    actor: "app",
    allowedRoots: [current.sourceRoot],
    command,
    args,
    cwd: path.resolve(current.sourceRoot, inspector.workdir),
    mode: "capture",
    purpose: "source",
    envPolicy: "project",
    env: await projectService.projectInspectionEnvironment({ sessionId: current.sessionId }),
    project: await projectService.readCurrentProject(),
    session: current.session,
    runtimes: runtime.runtimes,
    input: request,
    maxBuffer: inspector.maxBuffer,
    timeout: inspector.timeout,
    signal
  });
  if (signal.aborted) throw architectureCancelled();
  if (!execution?.ok) throw systemError(execution?.timedOut ? `${inspector.title} timed out.` : `${inspector.title} failed${Number.isInteger(execution?.exitCode) ? ` (exit ${execution.exitCode})` : ''}.`, "vibe64_architecture_inspector_failed", { inspectorId: inspector.id, commandOutput: String(execution?.stderr || execution?.error || '').slice(-2000) });
  if (typeof execution.stdout !== "string" || Buffer.byteLength(execution.stdout) > inspector.maxBuffer) throw systemError(`${inspector.title} returned oversized output.`, "vibe64_architecture_output_too_large");
  try { return JSON.parse(execution.stdout); } catch { throw systemError(`${inspector.title} must return one JSON observation document.`, "vibe64_architecture_output_invalid"); }
}

// readArchitecture's view needs file ownership, public interfaces and source edges.
function fileView(file, sourceMetrics) {
  const metrics = sourceMetrics.get(file.id);
  const lines = metrics?.hash === file.hash && Number.isSafeInteger(metrics.lines) && metrics.lines >= 0 ? metrics.lines : null;
  return {
    id: file.id,
    path: file.path,
    title: file.title,
    language: file.language,
    hash: file.hash,
    lines: file.lines,
    sourceLines: lines,
    analysis: file.analysis,
    subsystemId: file.subsystemId
  };
}

function publicSymbolView(symbol) {
  return {
    id: symbol.id,
    fileId: symbol.fileId,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    visibility: symbol.visibility,
    visibilityScope: symbol.visibilityScope,
    parameters: symbol.parameters,
    returnType: symbol.returnType,
    start: symbol.start,
    end: symbol.end,
    rangeAvailable: symbol.rangeAvailable
  };
}

function relationView(relation) {
  return {
    id: relation.id,
    fromFileId: relation.fromFileId,
    targetFileId: relation.targetFileId,
    targetPackageId: relation.targetPackageId,
    importPath: relation.importPath,
    kind: relation.kind,
    typeOnly: relation.typeOnly,
    specifier: relation.specifier,
    resolution: relation.resolution,
    reason: relation.reason,
    evidence: relation.evidence,
    importedNames: relation.importedNames,
    importedSymbolIds: relation.importedSymbolIds
  };
}

function createService({
  cityReader = readGenesisCity,
  inspectorReader = inspectVibe64ArchitectureInspection,
  layoutReader = inspectVibe64ArchitectureLayout,
  runCommand = runVibe64Command,
  runtimeReader = vibe64RuntimePacks,
  projectService,
  publishSessionChanged = async () => null,
  logger = console,
  refresher = refreshGenesisCities
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires the Vibe64 Project API.");
  }
  if (typeof cityReader !== "function" || typeof refresher !== "function") {
    throw new TypeError("createService requires Genesis City reader and refresher functions.");
  }
  const refreshes = new Map();

  function refreshSnapshot(pending) {
    if (!pending) return null;
    const progress = pending.progress;
    return { ...progress, elapsedSeconds: Math.floor(((progress.finishedAt || Date.now()) - progress.startedAt) / 1000) };
  }

  async function publishRefresh(context) {
    try {
      await publishSessionChanged(context.sessionId, { reason: "architecture-refresh", session: context.session });
    } catch (error) {
      // A notification failure must not turn a successful scan into a failure.
      // Readers reconcile from the same authoritative status after reconnect.
      logger.warn("Architecture progress notification failed.", { sessionId: context.sessionId, error });
    }
  }

  async function systemContext(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw systemError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const runtime = await projectService.createRuntime({
      sessionId: normalizedSessionId
    });
    const session = await runtime.getSession(normalizedSessionId);
    const sourceRoot = sessionSourcePath(session);
    if (!sourceRoot || !await pathExists(sourceRoot)) {
      throw systemError(
        "Create the active session source before opening Architecture.",
        "vibe64_system_source_unavailable",
        { sessionId: normalizedSessionId }
      );
    }
    return {
      sessionId: normalizedSessionId,
      session,
      runtime,
      sourceRoot
    };
  }

  return Object.freeze({
    async readStatus(input = {}) {
      return systemResult(async () => {
        const context = await systemContext(input.sessionId);
        const [machineResult, programResult] = await Promise.allSettled([
          cityReader(context.sourceRoot, "machine"),
          cityReader(context.sourceRoot, "program")
        ]);
        const cities = {
          machine: settledCityStatus(machineResult, "machine"),
          program: settledCityStatus(programResult, "program")
        };
        return {
          cities,
          ok: true,
          status: combinedStatus(cities)
        };
      });
    },

    async readArchitecture(input = {}) {
      return systemResult(async () => {
        const context = await systemContext(input.sessionId);
        const record = await cityReader(context.sourceRoot, "machine");
        const machine = requireGenesisCity(record, "machine");
        const native = machine.architecture;
        const sourceMetrics = new Map((machine.buildings || []).filter(file => file.role === 'source').map(file => [file.id, file]));
        // Stack supplies application entry identity; the renderer never guesses
        // server/main filenames. Reading declarations executes no inspector.
        let inspection = null;
        let layout = null;
        let layoutDiagnostic = '';
        let entryPointDiagnostic = '';
        if (native) {
          try { inspection = await inspectorReader({ projectRoot: context.sourceRoot }); }
          catch (error) { entryPointDiagnostic = `Entry point declarations need attention: ${error.message}`; }
          try { layout = await layoutReader({ projectRoot: context.sourceRoot }); }
          catch (error) { layoutDiagnostic = `Architecture layout needs attention: ${error.message}`; }
        }
        const entryPaths = [...new Set((inspection?.inspectors || []).flatMap(inspector => inspector.entryFiles || []))];
        const entryPoints = entryPaths.map(file => {
          const source = native.files.find(candidate => candidate.path === file);
          return { file, fileId: source?.id || null, subsystemId: source?.subsystemId || null, resolution: source ? 'resolved' : 'unresolved' };
        });
        const architecture = native ? {
          ...native,
          layout,
          layoutDiagnostic,
          entryPoints,
          entryPointStatus: inspection?.status || 'unconfigured',
          entryPointDiagnostic,
          files: native.files.map(file => fileView(file, sourceMetrics)),
          symbols: native.symbols.filter(symbol => symbol.visibility === 'public').map(publicSymbolView),
          relations: native.relations.map(relationView),
        } : null;
        return { ok: true, architecture };
      });
    },

    async readRefreshStatus(input = {}) {
      return systemResult(async () => {
        const context = await systemContext(input.sessionId);
        return { ok: true, refresh: refreshSnapshot(refreshes.get(context.sourceRoot)) };
      });
    },

    async cancelRefresh(input = {}) {
      return systemResult(async () => {
        const context = await systemContext(input.sessionId);
        const pending = refreshes.get(context.sourceRoot);
        if (pending?.progress.status !== "running") return { ok: true, cancelled: false, completed: pending?.progress.status === "complete" };
        pending.progress = { ...pending.progress, message: "Stopping analysis…", updatedAt: Date.now() };
        pending.controller.abort();
        await publishRefresh(context);
        await pending.done;
        return { ok: true, cancelled: pending.cancelled === true, completed: !pending.cancelled };
      });
    },

    async refresh(input = {}) {
      return systemResult(async () => {
        const context = await systemContext(input.sessionId);
        const existing = refreshes.get(context.sourceRoot);
        if (existing?.progress.status === "running") return { ok: true, alreadyRunning: true, refresh: refreshSnapshot(existing) };
        const controller = new AbortController();
        let complete;
        const pending = { controller, cancelled: false, progress: { id: randomUUID(), status: "running", startedAt: Date.now(), updatedAt: Date.now(), message: "Checking analysis prerequisites…" }, done: new Promise(resolve => { complete = resolve; }) };
        const progress = async message => {
          pending.progress = { ...pending.progress, message, updatedAt: Date.now() };
          await publishRefresh(context);
        };
        refreshes.set(context.sourceRoot, pending);
        try {
          await publishRefresh(context);
          const exclusive = await runVibe64AgentWriteExclusive(context.runtime, context.sessionId, async () => {
            const current = await systemContext(context.sessionId);
            const inspection = await inspectorReader({ projectRoot: current.sourceRoot });
            if (inspection.status === "blocked") throw systemError("Architecture inspection declarations need attention.", "vibe64_architecture_inspection_blocked", { diagnostics: inspection.diagnostics });
            const realSourceRoot = await realpath(current.sourceRoot);
            for (const inspector of inspection.inspectors || []) {
              await assertInspectorPrerequisites(current.sourceRoot, realSourceRoot, inspector, runtimeReader);
            }
            await progress("Scanning project source and existing Genesis documents…");
            const observations = inspection.inspectors?.length ? async architecture => {
              const request = architectureInspectionRequest(architecture, inspection);
              const documents = [];
              for (const inspector of inspection.inspectors) {
                documents.push(await runArchitectureInspector({ inspector, request, current, signal: controller.signal, progress, runCommand, projectService, runtimeReader }));
              }
              await progress("Validating UI observations…");
              const merged = mergeArchitectureObservations(documents, { files: architecture.files, packages: architecture.packages || [] });
              const finalInspection = await inspectorReader({ projectRoot: current.sourceRoot });
              if (finalInspection.stackHash !== inspection.stackHash) throw systemError("Stack changed during architecture inspection. Retry after changes settle.", "vibe64_architecture_stack_changed");
              await progress("Updating the browsing index…");
              return merged;
            } : null;
            if (controller.signal.aborted) throw architectureCancelled();
            return refresher({ projectRoot: current.sourceRoot, write: true, ...(observations ? { observations } : {}), signal: controller.signal });
          }, { operation: "architecture-refresh" });
          if (!exclusive.acquired) throw systemError(exclusive.value?.error || "Source work is busy.", exclusive.value?.code || "vibe64_architecture_refresh_busy");
          const result = exclusive.value;
          const machine = validateGenesisCity(result?.machine, "machine");
          const program = validateGenesisCity(result?.program, "program");
          pending.progress = { ...pending.progress, status: "complete", message: "Analysis complete." };
          return {
            changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles : [],
            cities: {
              machine,
              program
            },
            diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics : [],
            ok: true,
            status: normalizeText(result.status) || "ready",
            summary: normalizeText(result.summary)
          };
        } catch (error) {
          pending.cancelled = controller.signal.aborted;
          const failure = pending.cancelled ? architectureCancelled() : error;
          pending.progress = { ...pending.progress, status: pending.cancelled ? "cancelled" : "failed", message: String(failure.message), code: String(failure.code || "vibe64_system_graph_failed"), commandOutput: String(failure.details?.commandOutput || "") };
          throw failure;
        } finally {
          pending.progress = { ...pending.progress, finishedAt: Date.now(), updatedAt: Date.now() };
          // Keep only the last small status for this source, never the City results.
          // A returning view can observe completion or failure without replaying work.
          pending.controller = null;
          complete();
          await publishRefresh(context);
        }
      });
    }
  });
}

export {
  createService
};
