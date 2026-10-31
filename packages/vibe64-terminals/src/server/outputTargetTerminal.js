import crypto from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import stripAnsi from "strip-ansi";

import {
  beginTerminalNamespaceOperation,
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  stopTerminalSessionAndWait,
  subscribeTerminalSession,
  updateTerminalSessionMetadata,
  writeTerminalSession
} from "@local/vibe64-execution/server/terminalSessions";
import {
  finishVibe64Workflow,
  setVibe64WorkflowPhase,
  stopVibe64Execution,
  runVibe64Command,
  stableHash
} from "@local/vibe64-execution/server";
import { startResourceWorkflow } from "./resourceWorkflow.js";
import {
  browserTestNeedsCleanup,
  drainBrowserTestExecutions
} from "./browserTestCleanup.js";
import {
  terminalNoGithubActorMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  managedPreviewTarget
} from "@local/studio-terminal-core/shared";
import { captureProjectRequestContext, runWithProjectRequestContext, currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import { createPreviewIdentityGrant, previewAuthIdentityAvailable } from "@local/vibe64-core/server/previewAuth";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  sessionClosingReason
} from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  activeUsageRecording,
  stopActiveUsageRecording
} from "@local/vibe64-usage-recording/server/activeRecordings";
import {
  runVibe64AgentWriteExclusive
} from "@local/vibe64-runtime/server/agentWriteLock";
import {
  assertSourceInspectionHealthy
} from "@local/vibe64-runtime/server/sessionSourceInspection";
import {
  commandInvocation,
  currentProjectSlug,
  ensureTerminalSessionSourceGitSelfContained,
  vibe64Result,
  outputTargetTerminalNamespace
} from "./terminalShared.js";
import {
  projectExecutionEnvFromRecords,
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  executionEnvFingerprint
} from "./projectExecutionEnv.js";
import { createLaunchPreviewProxyRegistry } from "./launchPreviewProxy.js";
import {
  createVibe64OutputTargetTerminalSpec,
  inspectVibe64OutputsForContext,
  inspectVibe64WorkspaceSetupForContext,
  listVibe64OutputTargets,
  normalizedRuntimeRequirements,
  outputResultsMarkerLineSeen
} from "./vibe64OutputTargets.js";
import {
  previewDiagnosticsSessionRoot,
  previewLastPath,
  previewLogPath
} from "./previewDiagnosticFiles.js";
import {
  listOutputResults,
  readOutputResult,
  removeOutputResults,
  snapshotDeclaredOutputResults
} from "./outputResults.js";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { trimmedText as normalizeOutputTargetId } from "./trimmedText.js";
import { createLaunchRestartBaseline, launchRestartState } from "./launchRestart.js";
import { previewEditorOrigin, previewPublicOriginForLaunch } from "./previewPublicOrigin.js";
import {
  launchExecutionProject,
  previewAuthForLaunchTerminal,
  previewIdentityCommandRunnerForLaunchTerminal,
  previewIdentitySelection
} from "./launchPreviewAuth.js";
import {
  clearLaunchMetadata,
  clearLaunchMetadataForTerminal,
  launchIsReady,
  normalizeOpenTarget,
  OUTPUT_METADATA,
  outputTargetFromMetadata,
  previewStopState,
  writeLaunchMetadata,
  writePreviewStopState
} from "./outputTargetMetadata.js";
import {
  ensureLaunchPreviewProxy,
  launchReadinessMarkerLineSeen,
  launchTerminalIsRunning,
  markLaunchTerminalReady,
  readinessMarkerFromSpec
} from "./launchPreviewReadiness.js";
import {
  latestLaunchTerminal,
  outputStatusResponseFromPreviewStatus,
  resolveLaunchPreviewStatus
} from "./launchPreviewStatus.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {ReturnType<typeof import("./projectServices.js").createProjectServices>} ProjectServices */
/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/sessionRealtimeEvents").createSessionChangedPublisher>} PublishSessionChanged */
/** @typedef {ReturnType<typeof import("@local/vibe64-runtime/server/sessionStore").createVibe64SessionStore>} Vibe64SessionStore */

const MAX_LAUNCH_ACTION_SCAN_LINES = 10;
const PREVIEW_OUTPUT_TAIL_LIMIT = 12000;
function previewRuntimesForSpec(spec = {}) {
  return normalizedRuntimeRequirements([
    "git",
    ...(Array.isArray(spec.runtimes) ? spec.runtimes : [])
  ]);
}

function previewDiagnosticOutputTail(output = "") {
  const text = stripAnsi(String(output || ""));
  return text.length > PREVIEW_OUTPUT_TAIL_LIMIT
    ? text.slice(text.length - PREVIEW_OUTPUT_TAIL_LIMIT)
    : text;
}

function previewDiagnosticError(error = null) {
  if (!error) {
    return null;
  }
  if (typeof error === "string") {
    return {
      message: error
    };
  }
  return {
    message: String(error?.message || error || ""),
    ...(error?.code ? { code: String(error.code) } : {}),
    ...(error?.details?.admission?.id ? { resourceAdmissionId: String(error.details.admission.id).slice(0, 128) } : {}),
    ...(error?.statusCode ? { statusCode: error.statusCode } : {})
  };
}

async function writePreviewDiagnostic(session = {}, record = {}, {
  append = true
} = {}) {
  const sessionRoot = previewDiagnosticsSessionRoot(session);
  if (!sessionRoot) {
    return;
  }
  const normalizedRecord = {
    at: new Date().toISOString(),
    schemaVersion: 1,
    sessionId: String(record.sessionId || session.sessionId || session.id || "").trim(),
    sessionRoot,
    status: String(record.status || "failed").trim() || "failed",
    sessionSourceRoot: String(record.sessionSourceRoot || sessionSourcePath(session) || "").trim(),
    ...(record.reason ? { reason: String(record.reason) } : {}),
    ...(record.outputTargetId ? { outputTargetId: normalizeOutputTargetId(record.outputTargetId) } : {}),
    ...(record.cwd ? { cwd: String(record.cwd) } : {}),
    ...(record.commandPreview ? { commandPreview: String(record.commandPreview) } : {}),
    ...(record.terminalSessionId ? { terminalSessionId: String(record.terminalSessionId) } : {}),
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    ...(record.error ? { error: previewDiagnosticError(record.error) } : {}),
    ...(record.message ? { message: String(record.message) } : {}),
    ...(record.outputTail ? { outputTail: previewDiagnosticOutputTail(record.outputTail) } : {}),
    ...(record.details && typeof record.details === "object" && !Array.isArray(record.details) ? { details: record.details } : {})
  };
  try {
    await writeFile(previewLastPath(session), `${JSON.stringify(normalizedRecord, null, 2)}\n`, "utf8");
    if (append) {
      await appendFile(previewLogPath(session), `${JSON.stringify(normalizedRecord)}\n`, "utf8");
    }
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.previewDiagnostics.error", {
      error: vibe64SessionDebugError(error),
      sessionId: record.sessionId || session.sessionId || session.id || "",
      sessionRoot
    }, {
      level: "warn"
    });
  }
}

/**
 * @param {ProjectService} projectService
 * @param {string} sessionId
 * @param {object} [options]
 * @param {boolean} [options.awaitWorkspacePrepared]
 * @param {((sessionId: string, context: object) => Promise<object>) | null} [options.ensureWorkspacePrepared]
 * @param {boolean} [options.prepareEnvironment]
 * @param {boolean} [options.rerunFailedSetup]
 */
async function createLaunchContext(projectService, sessionId, {
  awaitWorkspacePrepared = false,
  ensureWorkspacePrepared = null,
  prepareEnvironment = false,
  rerunFailedSetup = false
} = {}) {
  const runtime = await projectService.createRuntime();
  let session = await runtime.getSession(sessionId);
  assertSourceInspectionHealthy(session.sourceInspection);
  if (typeof ensureWorkspacePrepared === "function") {
    const setup = await ensureWorkspacePrepared(sessionId, {
      rerunFailedSetup,
      runtime,
      session
    });
    if (setup?.ok === false) {
      throw Object.assign(new Error(setup.error || "Workspace preparation could not start."), setup);
    }
    if (awaitWorkspacePrepared && setup?.completion) {
      await setup.completion;
    }
    session = await runtime.getSession(sessionId);
  }
  const sessionSourceRoot = sessionSourcePath(session);
  const projectEnvironment = await loadProjectExecutionEnv({
    prepare: prepareEnvironment,
    reusePrepared: prepareEnvironment,
    projectService,
    session,
    target: "output-target"
  });
  // readable-check: allow method-probe - optional operation: a project service without a target root reads the session source only
  const projectContextRoot = typeof projectService?.currentTargetRoot === "function"
    ? String(projectService.currentTargetRoot() || "").trim()
    : "";
  // readable-check: allow method-probe - optional operation: a project service without managed app identities offers none
  const previewIdentitySettings = typeof projectService?.readPreviewApplicationIdentities === "function"
    ? await projectService.readPreviewApplicationIdentities({
        sessionId: session.sessionId
      })
    : {
        identities: [],
        ok: true
      };
  if (previewIdentitySettings?.ok === false) {
    const error = new Error(
      previewIdentitySettings.errors?.[0]?.message ||
      previewIdentitySettings.error ||
      "Managed app identities could not be read."
    );
    error.code = previewIdentitySettings.errors?.[0]?.code || previewIdentitySettings.code ||
      "vibe64_preview_application_identities_unavailable";
    throw error;
  }
  return {
    projectService,
    previewApplicationIdentities: previewIdentitySettings.identities || [],
    projectEnvironment,
    projectsRoot: projectService?.selectedProject?.projectsRoot || "",
    projectContextRoot,
    projectSlug: currentProjectSlug(projectService),
    runtime,
    // readable-check: allow method-probe - optional operation: a project service without service data keeps none
    serviceDataRoot: typeof projectService?.currentServiceDataRoot === "function"
      ? projectService.currentServiceDataRoot()
      : "",
    session,
    store: runtime.store,
    sessionSourceRoot
  };
}

async function listOutputTargets(context, {
  inspectOutputs,
  inspectWorkspaceSetup
} = {}) {
  const [targets, setup] = await Promise.all([
    listVibe64OutputTargets(context, inspectOutputs ? { inspect: inspectOutputs } : {}),
    inspectVibe64WorkspaceSetupForContext(
      context,
      inspectWorkspaceSetup ? { inspect: inspectWorkspaceSetup } : {}
    )
  ]);
  const disabledReason = workspaceSetupLaunchDisabledReason(context.session, setup);
  if (!disabledReason) {
    return targets;
  }
  return targets.map((target) => ({
    ...target,
    available: false,
    disabledReason
  }));
}

function workspaceSetupLaunchDisabledReason(session = {}, inspection = null) {
  const stored = session.workspaceSetup || {};
  const storedStatus = String(stored.status || "").trim();
  const inspectionStatus = String(inspection?.status || "").trim();

  if (!inspectionStatus) {
    return ["ambiguous", "failed"].includes(storedStatus)
      ? String(stored.diagnostic || "Workspace preparation must be fixed before managed preview can start.").trim()
      : "";
  }
  if (inspectionStatus === "unconfigured") {
    return "";
  }

  const diagnostic = (Array.isArray(inspection?.diagnostics) ? inspection.diagnostics : [])
    .map((entry) => String(
      typeof entry === "string" ? entry : entry?.message || entry?.code || ""
    ).trim())
    .find(Boolean) || "";
  if (inspectionStatus !== "ready") {
    return diagnostic || "Vibe64 workspace preparation is not ready.";
  }

  const recipeHash = String(inspection?.recipeHash || "").trim();
  const storedRecipeHash = String(stored.recipeHash || "").trim();
  const currentRecipe = Boolean(recipeHash && storedRecipeHash === recipeHash);
  if (currentRecipe && storedStatus === "succeeded") {
    return "";
  }
  if (currentRecipe && storedStatus === "running") {
    return "";
  }
  if (currentRecipe && ["ambiguous", "failed"].includes(storedStatus)) {
    return String(
      stored.diagnostic || "Workspace preparation must be fixed before managed preview can start."
    ).trim();
  }
  // Starting an output target owns running and awaiting the current recipe.
  // A new or changed recipe is therefore pending work, not a disabled target.
  return "";
}

function outputTargetExecutionDescriptor(outputTarget = {}, spec = {}) {
  const presentationKind = String(spec.metadata?.outputPresentationKind || "").trim();
  const outputMode = String(spec.metadata?.outputMode || "").trim();
  return {
    kind: presentationKind === "web"
      ? "preview"
      : outputMode === "finite"
        ? "job"
        : "terminal",
    label: String(outputTarget.label || spec.metadata?.outputTargetLabel || "Output target").trim()
  };
}

function findOutputTarget(targets = [], outputTargetId = "") {
  const normalizedOutputTargetId = normalizeOutputTargetId(outputTargetId);
  return targets.find((target) => target.id === normalizedOutputTargetId) || null;
}

function previewTargetError(target, outputTargetId) {
  if (target && target.available !== false && target.presentation?.kind === "web") {
    return null;
  }
  return Object.assign(new Error(`Preview target ${outputTargetId} must be an available declared web target.`), {
    code: "vibe64_preview_target_unavailable"
  });
}

function managedPreviewUnavailableMessage(outputTargets = []) {
  const reasons = [...new Set(outputTargets
    .map((target) => String(target?.disabledReason || "").trim())
    .filter(Boolean))];
  if (reasons.length > 0) {
    return reasons.join(" ");
  }
  return outputTargets.length > 0
    ? "The managed preview is not currently available."
    : "This project does not currently provide a managed preview.";
}

function managedPreviewLaunchPlan({
  outputTargets = [],
  outputTargetId = "",
  previewStatus = {},
  outputParameters,
  restart = false,
  savedOutputTarget = null
} = {}) {
  const activeTerminal = previewStatus.activeTerminal || null;
  const previewState = String(previewStatus.preview?.state || "").trim();
  const requestedTarget = outputTargetId ? findOutputTarget(outputTargets, outputTargetId) : null;
  const targetError = outputTargetId ? previewTargetError(requestedTarget, outputTargetId) : null;
  if (targetError) {
    return {
      code: targetError.code,
      error: targetError.message,
      ready: false
    };
  }
  const sameTarget = !outputTargetId || activeTerminal?.metadata?.outputTargetId === outputTargetId;
  const sameParameters = outputParameters === undefined || isDeepStrictEqual(
    outputParameters,
    activeTerminal?.metadata?.outputParameters || {}
  );
  if (!restart && sameTarget && sameParameters && (
    previewState === "ready" ||
    (previewState === "starting" && launchTerminalIsRunning(activeTerminal || {}))
  )) {
    return {
      ready: true,
      terminal: activeTerminal || {
        ok: true
      }
    };
  }

  const activeMetadata = activeTerminal?.metadata || {};
  const lastOutputTarget = previewStatus.lastOutputTarget || savedOutputTarget || {};
  const previousTargetId = normalizeOutputTargetId(
    lastOutputTarget.id || activeMetadata.outputTargetId
  );
  if (restart && !previousTargetId) {
    return {
      code: "vibe64_preview_not_started",
      error: "No managed Vibe64 preview has been started for this session.",
      ready: false
    };
  }
  const previousTarget = findOutputTarget(outputTargets, previousTargetId);
  if (restart && (!previousTarget || previousTarget.available === false)) {
    return {
      error: previousTarget?.disabledReason || "The previous managed preview output target is no longer available.",
      ready: false
    };
  }
  const outputTarget = requestedTarget || (
    previousTarget && previousTarget.available !== false
      ? previousTarget
      : null
  ) || (restart ? null : managedPreviewTarget(outputTargets));
  if (!outputTarget) {
    return {
      error: managedPreviewUnavailableMessage(outputTargets),
      ready: false
    };
  }

  return {
    forceRestart: restart || launchTerminalIsRunning(activeTerminal || {}),
    outputTargetId: outputTarget.id,
    ready: false
  };
}

function firstLaunchOutputLines(output = "") {
  return stripAnsi(String(output || ""))
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .slice(0, MAX_LAUNCH_ACTION_SCAN_LINES)
    .map((line) => line.trim())
    .filter(Boolean);
}

function launchActionFromLine(line = "") {
  const match = String(line || "").match(/(?:^|\s)action:(?:url:)?(https?:\/\/\S+)/u);
  if (!match) {
    return null;
  }

  const href = match[1].replace(/[),.;]+$/u, "");
  let label = "Open";
  try {
    const url = new URL(href);
    label = url.host || label;
  } catch {
    return null;
  }

  return {
    href,
    id: `url-${stableHash(href)}`,
    kind: "url",
    label
  };
}

function launchActionsFromOutput(output = "") {
  const actionMap = new Map();
  for (const line of firstLaunchOutputLines(output)) {
    const action = launchActionFromLine(line);
    if (action) {
      actionMap.set(action.id, action);
    }
  }
  return [...actionMap.values()];
}

function launchActionsChanged(currentActions = [], nextActions = []) {
  return JSON.stringify(currentActions || []) !== JSON.stringify(nextActions || []);
}

async function closeStoppedLaunchTerminals(sessionId = "") {
  const namespace = outputTargetTerminalNamespace(sessionId);
  await Promise.all(listTerminalSessions({
    namespace
  }).filter((terminal) => !launchTerminalIsRunning(terminal)).map((terminal) => {
    return closeTerminalSession(terminal.id, {
      namespace
    });
  }));
}

function releaseLaunchSpecReservation(spec = {}) {
  // readable-check: allow method-probe - data: only a spec that reserved a port carries its release
  if (typeof spec.releasePortReservation !== "function") {
    return;
  }
  try {
    spec.releasePortReservation();
  } catch {
    // Reservation release is best-effort cleanup for failed or reused launches.
  }
}

function launchTerminalIsReady(terminalSession = {}, readinessMarker = "") {
  if (!readinessMarker) {
    return true;
  }
  return launchIsReady(terminalSession.metadata || {});
}

function launchTerminalCanBeReused(runningSession = {}, {
  launchEnvHash = "",
  outputTargetId = "",
  spec = {}
} = {}) {
  return spec.reuseRunning !== false &&
    runningSession.metadata?.envHash === launchEnvHash &&
    runningSession.metadata?.outputTargetId === outputTargetId &&
    isDeepStrictEqual(runningSession.metadata?.outputParameters || {}, spec.metadata?.outputParameters || {});
}

function reusableLaunchTerminal(sessionId = "", {
  launchEnvHash = "",
  outputTargetId = "",
  namespace = outputTargetTerminalNamespace(sessionId),
  spec = {}
} = {}) {
  return listTerminalSessions({
    namespace,
    runningOnly: true
  }).find((terminal) => launchTerminalCanBeReused(terminal, {
    launchEnvHash,
    outputTargetId,
    spec
  })) || null;
}

function launchSpecEnvironment(specEnv = {}, input = {}) {
  const value = typeof specEnv === "function"
    ? specEnv(input)
    : specEnv;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function launchSpecAllowedRoots(spec = {}) {
  return (Array.isArray(spec.allowedRoots) ? spec.allowedRoots : [])
    .map((root) => String(root || "").trim())
    .filter(Boolean);
}

function composeLaunchTerminalEnvironment({
  envBase = null,
  hashBase = null,
  terminalEnv = {},
  specEnv = {}
} = {}) {
  const resolvedEnvBase = envBase && typeof envBase === "object" && !Array.isArray(envBase)
    ? envBase
    : terminalEnv;
  const resolvedHashBase = hashBase && typeof hashBase === "object" && !Array.isArray(hashBase)
    ? hashBase
    : terminalEnv;
  const staticSpecEnv = launchSpecEnvironment(specEnv, {
    id: "",
    namespace: "",
    fingerprint: true
  });
  const hashEnv = {
    ...resolvedHashBase,
    ...staticSpecEnv
  };
  const env = typeof specEnv === "function"
    ? (input = {}) => ({
        ...resolvedEnvBase,
        ...launchSpecEnvironment(specEnv, input)
      })
    : {
        ...resolvedEnvBase,
        ...staticSpecEnv
      };
  return {
    env,
    hashEnv
  };
}

async function cleanupSupersededLaunchTerminals({
  launchPreviewProxies = null,
  namespace = "",
  reusableTerminal = null,
  sessionId = ""
} = {}) {
  const preservedTerminalIds = reusableTerminal?.id ? [String(reusableTerminal.id)] : [];
  const preservedTerminalIdSet = new Set(preservedTerminalIds);
  let closed = 0;
  for (const terminal of listTerminalSessions({ namespace })) {
    if (!terminal.id || preservedTerminalIdSet.has(terminal.id)) {
      continue;
    }
    const result = await closeTerminalSession(terminal.id, {
      namespace
    });
    if (result.closed) {
      closed += 1;
    }
  }
  if (!preservedTerminalIds.length) {
    await launchPreviewProxies?.close({
      sessionId
    });
  }
  return {
    closed
  };
}

/**
 * @param {object} dependencies
 * @param {(sessionId: string, context: object) => Promise<object>} dependencies.ensureWorkspacePrepared
 * @param {ProjectServices["ensure"]} dependencies.ensureProjectServices
 * @param {RuntimeEnv} [dependencies.env]
 * @param {ProjectService} dependencies.projectService
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 * @param {typeof startResourceWorkflow} [dependencies.startWorkflow]
 * @param {typeof stopVibe64Execution} [dependencies.stopExecution]
 * @param {(sessionId: string) => Promise<object>} [dependencies.stopPreviewBrowsers]
 * @param {typeof finishVibe64Workflow} [dependencies.finishWorkflow]
 * @param {typeof setVibe64WorkflowPhase} [dependencies.setWorkflowPhase]
 * @param {(sessionId: string) => object | null} dependencies.sessionAdmissionFailure
 */
function createOutputTargetTerminalController({
  ensureWorkspacePrepared,
  ensureProjectServices,
  env = process.env,
  projectService,
  publishSessionChanged,
  runCommand = runVibe64Command,
  startWorkflow = startResourceWorkflow,
  stopExecution = stopVibe64Execution,
  stopPreviewBrowsers = async () => ({ ok: true }),
  finishWorkflow = finishVibe64Workflow,
  setWorkflowPhase = setVibe64WorkflowPhase,
  sessionAdmissionFailure
}) {
  const launchPreviewProxies = createLaunchPreviewProxyRegistry({
    env
  });
  const launchReadyWrites = new Map();
  const launchStartLocks = new Map();
  const previewTestRuns = new Map();
  const outputResultWrites = new Map();

  function publishLaunchCleanup(sessionId, projectSlug, reason = "output-target-stale-cleared") {
    // Process cleanup must not wait for realtime delivery or its access checks.
    void Promise.resolve().then(() => publishSessionChanged(sessionId, {
      projectSlug,
      reason
    })).catch((error) => {
      vibe64SessionDebugLog("server.outputTargetTerminal.cleanupPublication.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      }, { level: "warn" });
    });
  }

  async function ensureReadyLaunchPreviewProxy(context = {}, terminal = {}, {
    source = "ready"
  } = {}) {
    const metadata = terminal?.metadata || {};
    const targetHref = String(
      normalizeOpenTarget(metadata.openTarget || {}).href || metadata.targetUrl || ""
    ).trim();
    const previewPublicOrigin = String(metadata.previewPublicOrigin || "").trim();
    if (
      metadata.outputPresentationKind !== "web" ||
      !targetHref ||
      !previewPublicOrigin
    ) {
      return false;
    }
    try {
      await ensureLaunchPreviewProxy({
        context,
        launchPreviewProxies,
        options: {
          env,
          projectService,
          runCommand
        },
        previewPublicOrigin,
        sessionId: context.session?.sessionId || metadata.sessionId || "",
        targetHref,
        terminal
      });
      return true;
    } catch (error) {
      vibe64SessionDebugLog("server.outputTargetTerminal.previewProxy.eagerEnsureError", {
        error: vibe64SessionDebugError(error),
        sessionId: String(context.session?.sessionId || metadata.sessionId || ""),
        source,
        terminalSessionId: String(terminal?.id || "")
      }, {
        level: "warn"
      });
      return false;
    }
  }

  function captureOutputResults({
    context = {},
    outputTarget = {},
    spec = {},
    terminalSessionId = "",
    updateMetadata = () => null
  } = {}) {
    const downloads = Array.isArray(spec.metadata?.outputDownloads)
      ? spec.metadata.outputDownloads
      : [];
    if (downloads.length === 0 || !terminalSessionId) {
      return Promise.resolve({
        captured: false,
        ok: true,
        results: []
      });
    }
    const key = `${String(context.session?.sessionRoot || "")}:${terminalSessionId}`;
    const existing = outputResultWrites.get(key);
    if (existing) {
      return existing;
    }
    const write = snapshotDeclaredOutputResults({
      downloads,
      outputTargetId: outputTarget.id,
      session: context.session,
      terminalSessionId
    }).then(async (snapshot) => {
      updateMetadata({
        outputResultError: null,
        outputResults: snapshot.results,
        outputResultsReady: true,
        outputRun: snapshot.run
      });
      await publishSessionChanged(context.session?.sessionId || "", {
        projectSlug: context.projectSlug,
        reason: "output-results-ready"
      });
      return {
        ...snapshot,
        ok: true
      };
    }).catch(async (error) => {
      const outputResultFailure = {
        code: String(error?.code || "vibe64_output_result_snapshot_failed"),
        message: String(error?.message || error || "Declared downloads could not be snapshotted.")
      };
      updateMetadata({
        outputResultError: outputResultFailure,
        outputResultsReady: false
      });
      await publishSessionChanged(context.session?.sessionId || "", {
        projectSlug: context.projectSlug,
        reason: "output-results-failed"
      }).catch(() => null);
      vibe64SessionDebugLog("server.outputTargetTerminal.results.error", {
        error: vibe64SessionDebugError(error),
        outputTargetId: outputTarget.id,
        sessionId: context.session?.sessionId || "",
        terminalSessionId
      }, {
        level: "warn"
      });
      return {
        error: outputResultFailure,
        ok: false,
        results: []
      };
    });
    const tracked = write.finally(() => {
      if (outputResultWrites.get(key) === tracked) {
        outputResultWrites.delete(key);
      }
    });
    outputResultWrites.set(key, tracked);
    return tracked;
  }

  function markLaunchReady(input = {}) {
    const terminalSessionId = String(input.terminalSession?.id || "").trim();
    const key = `${String(input.namespace || "")}:${terminalSessionId}`;
    const existing = launchReadyWrites.get(key);
    if (existing) {
      return existing;
    }
    const write = Promise.resolve().then(async () => {
      const result = await markLaunchTerminalReady(input);
      const metadata = input.terminalSession?.metadata;
      if (result?.ready && metadata?.outputMode === "interactive") {
        await setWorkflowPhase(metadata.resourceWorkflowId, "running");
      }
      return result;
    });
    const tracked = write.finally(() => {
      if (launchReadyWrites.get(key) === tracked) {
        launchReadyWrites.delete(key);
      }
    });
    launchReadyWrites.set(key, tracked);
    return tracked;
  }

  async function withLaunchStartLock(sessionId = "", operation = async () => null) {
    const key = String(sessionId || "global");
    const previous = launchStartLocks.get(key) || Promise.resolve();
    const run = previous.catch(() => null).then(operation);
    const tracked = run.catch(() => null).finally(() => {
      if (launchStartLocks.get(key) === tracked) {
        launchStartLocks.delete(key);
      }
    });
    launchStartLocks.set(key, tracked);
    return run;
  }

  function launchAdmissionFailure(sessionId = "", session = null) {
    const frozen = sessionAdmissionFailure(sessionId);
    if (frozen?.ok === false) {
      return frozen;
    }
    const closingReason = sessionClosingReason(session || {});
    if (!closingReason) {
      return null;
    }
    const renewing = String(session?.status || "").trim() === "renewal_quiesced";
    return {
      code: renewing ? "vibe64_session_renewal_quiesced" : "vibe64_session_closing",
      error: renewing
        ? "Session renewal has frozen preview access."
        : `Session is ${closingReason} and preview access is unavailable.`,
      ok: false
    };
  }

  const controller = {
    async close() {
      for (const testRun of previewTestRuns.values()) testRun.closing = true;
      await Promise.allSettled([
        ...launchReadyWrites.values(),
        ...outputResultWrites.values()
      ]);
      await launchPreviewProxies.closeAll();
    },

    async closeAllForSession(sessionId) {
      const testRun = previewTestRuns.get(sessionId);
      if (testRun) testRun.closing = true;
      await stopActiveUsageRecording(currentProjectScopeKey(), sessionId, "session-ended");
      return withLaunchStartLock(sessionId, async () => {
        await launchPreviewProxies.close({
          sessionId
        });
        return closeTerminalSessionsForNamespace(outputTargetTerminalNamespace(sessionId));
      });
    },

    async removeResultsForSession(sessionId) {
      const context = await createLaunchContext(projectService, sessionId);
      await removeOutputResults(context.session);
      return {
        ok: true,
        removed: true,
        sessionId: String(sessionId || "")
      };
    },

    async closeTerminal(sessionId, terminalSessionId) {
      if (previewTestRuns.has(sessionId)) {
        return { ok: false, code: "vibe64_preview_test_busy", error: "Browser tests own this Preview. Stop the test command before closing Preview." };
      }
      await launchPreviewProxies.close({
        sessionId,
        terminalSessionId
      });
      return closeTerminalSession(terminalSessionId, {
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    },

    async launchStatus(sessionId, options = {}) {
      return vibe64Result(async () => withLaunchStartLock(sessionId, async () => {
        const admission = beginTerminalNamespaceOperation(
          outputTargetTerminalNamespace(sessionId)
        );
        if (admission.ok === false) {
          return launchAdmissionFailure(sessionId) || admission;
        }
        try {
          const frozen = launchAdmissionFailure(sessionId);
          if (frozen) {
            return frozen;
          }
          const context = await createLaunchContext(projectService, sessionId);
          const unavailable = launchAdmissionFailure(sessionId, context.session);
          if (unavailable) {
            return unavailable;
          }
          const outputTargets = await listOutputTargets(context);
          const [previewStatus, outputRuns] = await Promise.all([
            resolveLaunchPreviewStatus({
            context,
            launchPreviewProxies,
            outputTargets,
            markReady: markLaunchReady,
            options: {
              ...options,
              env,
              projectService,
              runCommand
            },
            publishSessionChanged,
            sessionId
            }),
            listOutputResults(context.session)
          ]);
          const response = outputStatusResponseFromPreviewStatus({
            outputRuns,
            outputTargets,
            previewStatus,
            previewApplicationIdentities: context.previewApplicationIdentities
          });
          const stopState = previewStopState(context.session.metadata);
          if (stopState.stopped) response.preview.stoppedIntent = true;
          if (stopState.stopped && !launchTerminalIsRunning(previewStatus.activeTerminal || {})) {
            response.preview.state = stopState.error ? "failed" : "stopped";
            response.preview.message = stopState.error || "Preview is stopped. Start it to run the application.";
          }
          const testRun = previewTestRuns.get(sessionId);
          if (testRun) response.previewTestRun = { targetId: testRun.targetId, state: testRun.state };
          if (!["ready", "starting"].includes(response.preview.state) && !launchTerminalIsRunning(previewStatus.activeTerminal || {})) {
            const latestPath = previewLastPath(context.session);
            const diagnostic = latestPath ? await readFile(latestPath, "utf8")
              .then((text) => JSON.parse(text)).catch(() => null) : null;
            if (diagnostic?.sessionId === sessionId && diagnostic.status === "failed" &&
                diagnostic.error?.code === "vibe64_capacity_rejected" &&
                /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(diagnostic.error.resourceAdmissionId || "") &&
                outputTargets.some((target) => target.id === diagnostic.outputTargetId)) {
              response.resourceAdmissionId = diagnostic.error.resourceAdmissionId;
              response.preview.state = "failed";
              response.preview.message = diagnostic.error.message;
            }
          }
          return response;
        } finally {
          admission.release();
        }
      }));
    },

    async selectPreviewIdentity(sessionId, input = {}, options = {}) {
      return vibe64Result(async () => {
        const status = await controller.launchStatus(sessionId, options);
        if (status?.ok === false) {
          const error = new Error(status.error || "Preview identity is unavailable.");
          error.code = status.code || "vibe64_preview_identity_unavailable";
          throw error;
        }
        const unavailable = launchAdmissionFailure(sessionId);
        if (unavailable) {
          return unavailable;
        }
        if (!["ready", "stale"].includes(String(status.preview?.state || ""))) {
          const error = new Error(status.preview?.message || "Run the preview before selecting an identity.");
          error.code = "vibe64_preview_identity_preview_not_ready";
          throw error;
        }
        const previewAuth = previewAuthForLaunchTerminal(status.activeTerminal || {}, {
          sessionId,
          targetHref: status.preview.targetHref
        });
        if (!previewAuthIdentityAvailable(previewAuth || {})) {
          const error = new Error("This preview does not support application identity switching.");
          error.code = "vibe64_preview_identity_unsupported";
          throw error;
        }
        const identity = previewIdentitySelection(input, {
          identities: status.previewIdentity?.identities || []
        });
        return {
          grant: createPreviewIdentityGrant(previewAuth, identity.selection),
          ok: true,
          requestedIdentity: identity.requestedIdentity
        };
      });
    },

    ensurePreview(sessionId, input = {}) {
      return controller.startTerminal(sessionId, {
        outputTargetId: input.outputTargetId,
        ensurePreview: true
      });
    },

    async withPreviewTarget(sessionId, outputTargetId, operation, { waitUntilReady, startTarget = (start) => start(), signal, onState = () => {} }) {
      const testRun = { targetId: outputTargetId, token: crypto.randomUUID(), closing: false };
      function changeState(state) {
        testRun.state = state;
        onState(state);
        publishLaunchCleanup(sessionId, testRun.projectSlug, "preview-test-state-changed");
      }
      const previous = await withLaunchStartLock(sessionId, async () => {
        signal?.throwIfAborted();
        if (previewTestRuns.has(sessionId)) {
          throw Object.assign(new Error("Browser tests already own this session's Preview. Wait for them to finish."), {
            code: "vibe64_preview_test_busy"
          });
        }
        const context = await createLaunchContext(projectService, sessionId);
        testRun.projectSlug = context.projectSlug;
        const unavailable = launchAdmissionFailure(sessionId, context.session);
        if (unavailable) throw Object.assign(new Error(unavailable.error), unavailable);
        const targets = await listOutputTargets(context);
        const status = await resolveLaunchPreviewStatus({
          context, launchPreviewProxies, outputTargets: targets, markReady: markLaunchReady,
          options: { env, projectService, runCommand }, publishSessionChanged, sessionId
        });
        if (!outputTargetId) {
          const plan = managedPreviewLaunchPlan({ outputTargets: targets, previewStatus: status,
            savedOutputTarget: outputTargetFromMetadata(context.session.metadata) });
          if (plan.error) throw Object.assign(new Error(plan.error), { code: plan.code });
          outputTargetId = plan.outputTargetId || plan.terminal?.metadata?.outputTargetId;
          testRun.targetId = outputTargetId;
        }
        const targetError = previewTargetError(findOutputTarget(targets, outputTargetId), outputTargetId);
        if (targetError) throw targetError;
        previewTestRuns.set(sessionId, testRun);
        return {
          running: launchTerminalIsRunning(status.activeTerminal || {}),
          targetId: status.activeTerminal?.metadata?.outputTargetId || "",
          outputParameters: status.activeTerminal?.metadata?.outputParameters || {},
          savedTarget: outputTargetFromMetadata(context.session.metadata),
          store: context.runtime.store
        };
      });
      async function ensureTargetReady(targetId, options) {
        testRun.restoring = options?.restoring === true;
        const start = () => controller.startTerminal(sessionId, {
          ensurePreview: true,
          outputTargetId: targetId,
          ...(options?.restoring ? { outputParameters: previous.outputParameters } : {}),
          previewTestRun: testRun
        });
        if (!testRun.restoring) signal?.throwIfAborted();
        const started = await (testRun.restoring ? start() : startTarget(start));
        if (started?.ok === false) {
          throw Object.assign(new Error(started.error), started);
        }
        await waitUntilReady(started, options);
      }

      let result;
      try {
        changeState("starting");
        await ensureTargetReady(outputTargetId);
        signal?.throwIfAborted();
        if (testRun.closing) {
          throw new Error("The session closed before browser tests could start.");
        }
        changeState("running");
        result = await operation(testRun.token);
      } catch (error) {
        result = { ok: false, exitCode: 1, error: error.message, code: error.code,
          ...(error.execution ? { execution: error.execution } : {}),
          ...(error.details ? { details: error.details } : {}) };
      }
      let cleanupRequired = browserTestNeedsCleanup(result);
      const cleanupExecutionIds = new Set(cleanupRequired ? result.cleanupExecutionIds || [result.execution?.id] : []);
      testRun.finish = async (retry = false) => {
        if (cleanupRequired) {
          changeState("cleanup_required");
          if (retry) {
            await drainBrowserTestExecutions(cleanupExecutionIds, stopExecution);
            cleanupRequired = cleanupExecutionIds.size > 0;
          }
          if (cleanupRequired) return { ...result, previewRecoveryRequired: true };
        }
        try {
          if (testRun.closing) {
            previewTestRuns.delete(sessionId);
            return result;
          }
          changeState("restoring");
          if (previous.running && previous.targetId) {
            await ensureTargetReady(previous.targetId, { restoring: true });
          } else {
            await withLaunchStartLock(sessionId, async () => {
              await launchPreviewProxies.close({ sessionId });
              const closed = await closeTerminalSessionsForNamespace(outputTargetTerminalNamespace(sessionId));
              if (closed?.ok === false) throw new Error(closed.error);
              await clearLaunchMetadata(previous.store, sessionId);
              if (previous.savedTarget) {
                await previous.store.mutateSession(sessionId, async () => {
                  await previous.store.writeMetadataValue(sessionId, OUTPUT_METADATA.id, previous.savedTarget.id);
                  await previous.store.writeMetadataValue(sessionId, OUTPUT_METADATA.label, previous.savedTarget.label);
                  await previous.store.writeMetadataValue(sessionId, OUTPUT_METADATA.parameters, JSON.stringify(previous.savedTarget.outputParameters));
                });
              }
            });
          }
          previewTestRuns.delete(sessionId);
          publishLaunchCleanup(sessionId, testRun.projectSlug, "preview-test-state-changed");
        } catch (error) {
          changeState("restore_failed");
          return {
            ...result, ok: false, exitCode: result?.exitCode || 1,
            code: "vibe64_preview_restore_failed",
            error: [result?.error, `Could not restore Preview: ${error.message}`].filter(Boolean).join("\n"),
            previewRecoveryRequired: true
          };
        }
        return result;
      };
      return testRun.finish();
    },

    async retryPreviewTestCleanup(sessionId) {
      const testRun = previewTestRuns.get(sessionId);
      if (!testRun?.finish) return { ok: false, error: "The browser test has not finished.", previewRecoveryRequired: true };
      testRun.finishing ||= testRun.finish(true).finally(() => { testRun.finishing = null; });
      return testRun.finishing;
    },

    previewTestRunAdmission(sessionId, token = "") {
      const testRun = previewTestRuns.get(sessionId);
      if ((!testRun && token) || (testRun && (testRun.closing || testRun.token !== token))) {
        return { ok: false, code: "vibe64_preview_test_busy", error: "Another browser test owns this Preview, or this test run has ended. Wait for it to finish, then retry." };
      }
      return null;
    },

    restartPreview(sessionId) {
      return controller.startTerminal(sessionId, {
        restartPreview: true
      });
    },

    // The Output targets a usage recording may launch, with their declared
    // runtimes, and which web target a Preview restart runs.
    async usageRecordingTargets(sessionId) {
      return vibe64Result(async () => {
        const context = await createLaunchContext(projectService, sessionId);
        const [outputs, targets] = await Promise.all([
          inspectVibe64OutputsForContext(context),
          listOutputTargets(context)
        ]);
        const declared = new Map((outputs.targets || []).map((target) => [target.id, target]));
        const saved = outputTargetFromMetadata(context.session?.metadata || {});
        const isWeb = (target) => target?.presentation?.kind === "web";
        const previewTarget = targets.find((target) => target.id === saved?.id && isWeb(target) && target.available !== false) ||
          managedPreviewTarget(targets);
        return {
          ok: true,
          previewTargetId: String(previewTarget?.id || ""),
          targets: targets.map((target) => ({
            available: target.available !== false,
            disabledReason: target.disabledReason || "",
            id: target.id,
            label: target.label,
            parameters: (declared.get(target.id)?.parameters || []).map(({ default: defaultValue, id, label, required }) => ({
              ...(defaultValue !== undefined ? { default: defaultValue } : {}), id, label, required: required === true
            })),
            runtimes: normalizedRuntimeRequirements(declared.get(target.id)?.runtimeRequirements),
            web: isWeb(target)
          }))
        };
      });
    },

    async openOutputTarget(sessionId) {
      return vibe64Result(async () => {
        const status = await controller.launchStatus(sessionId);
        if (status?.ok === false) {
          return status;
        }
        const unavailable = launchAdmissionFailure(sessionId);
        if (unavailable) {
          return unavailable;
        }
        if (!status.openTarget.available) {
          return {
            ok: false,
            error: status.openTarget.disabledReason
          };
        }
        return {
          ok: true,
          target: status.openTarget
        };
      });
    },

    async readResult(sessionId, resultId) {
      const context = await createLaunchContext(projectService, sessionId);
      return readOutputResult(context.session, resultId);
    },

    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    },

    async startTerminal(sessionId, input = {}) {
      return vibe64Result(async () => withLaunchStartLock(sessionId, async () => {
        const testRun = previewTestRuns.get(sessionId);
        if (testRun && input.previewTestRun !== testRun) {
          if (input.ensurePreview !== true || (input.outputTargetId && input.outputTargetId !== testRun.targetId)) {
            return { ok: false, code: "vibe64_preview_test_busy", error: "Browser tests own this Preview. Wait for them to finish before changing or restarting its target." };
          }
          input = { ...input, outputTargetId: testRun.targetId };
        }
        const admission = beginTerminalNamespaceOperation(outputTargetTerminalNamespace(sessionId));
        if (admission.ok === false) {
          return launchAdmissionFailure(sessionId) || admission;
        }
        try {
          const frozen = launchAdmissionFailure(sessionId);
          if (frozen) {
            return frozen;
          }
          if (input.automatic === true && !(testRun && input.previewTestRun === testRun)) {
            const runtime = await projectService.createRuntime();
            const session = await runtime.getSession(sessionId);
            if (previewStopState(session.metadata).stopped) {
              return { ok: false, code: "vibe64_preview_stopped", error: "Preview was stopped explicitly. Use Start preview to run it again." };
            }
          }
          const context = await createLaunchContext(projectService, sessionId, {
            awaitWorkspacePrepared: true,
            ensureWorkspacePrepared,
            prepareEnvironment: true,
            // An explicit start runs a failed setup again; an automatic one
            // reports the stored failure instead of rerunning it unasked.
            rerunFailedSetup: input.automatic !== true
          });
          const unavailable = launchAdmissionFailure(sessionId, context.session);
          if (unavailable) {
            return unavailable;
          }
          const stopState = previewStopState(context.session.metadata);
          if (stopState.stopped && !(testRun && input.previewTestRun === testRun)) {
            if (input.automatic === true) {
              return { ok: false, code: "vibe64_preview_stopped", error: "Preview was stopped explicitly. Use Start preview to run it again." };
            }
            if (stopState.error || launchTerminalIsRunning(latestLaunchTerminal(sessionId) || {})) {
              return { ok: false, code: "vibe64_preview_stop_incomplete", error: stopState.error || "Preview cleanup is still running. Retry Stop before starting it." };
            }
          }
          const cwd = context.sessionSourceRoot;
          let forceRestart = input.forceRestart === true;
          let outputTargetId = normalizeOutputTargetId(input.outputTargetId);
          let outputTargets = null;
          const managedPreviewOperation = input.ensurePreview === true || input.restartPreview === true;
          if (managedPreviewOperation) {
            const restartPreview = input.restartPreview === true;
            const savedOutputTarget = outputTargetFromMetadata(context.session?.metadata || {});
            outputTargets = await listOutputTargets(context);
            const previewStatus = await resolveLaunchPreviewStatus({
              context,
              launchPreviewProxies,
              outputTargets,
              markReady: markLaunchReady,
              options: {
                env,
                projectService,
                runCommand
              },
              publishSessionChanged,
              sessionId
            });
            const launchPlan = managedPreviewLaunchPlan({
              outputTargets,
              outputTargetId,
              previewStatus,
              outputParameters: input.outputParameters,
              restart: restartPreview,
              savedOutputTarget
            });
            if (launchPlan.ready) {
              return launchPlan.terminal;
            }
            if (testRun && input.previewTestRun !== testRun) {
              return { ok: false, code: "vibe64_preview_test_not_ready", error: "The browser-test Preview stopped. Tests cannot restart it while using its fixtures." };
            }
            if (launchPlan.error) {
              return {
                ...(launchPlan.code ? { code: launchPlan.code } : {}),
                error: launchPlan.error,
                ok: false
              };
            }
            forceRestart = launchPlan.forceRestart;
            outputTargetId = launchPlan.outputTargetId;
          }
          const diagnosticBase = {
            cwd,
            outputTargetId,
            sessionId
          };
          const closingReason = sessionClosingReason(context.session);
          if (closingReason) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              message: `Session is ${closingReason}. Preview cannot start while the worktree is being archived.`,
              reason: "session_closing",
              status: "failed"
            });
            return {
              ok: false,
              error: `Session is ${closingReason}. Preview cannot start while the worktree is being archived.`
            };
          }
          if (!cwd) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              message: "Vibe64 output target root is not available.",
              reason: "missing_target_root",
              status: "failed"
            });
            return {
              ok: false,
              error: "Vibe64 output target root is not available."
            };
          }
          await ensureTerminalSessionSourceGitSelfContained({
            runExclusive: async (operation) => {
              const result = await runVibe64AgentWriteExclusive(context.runtime, sessionId, operation, {
                operation: "prepare-preview-source"
              });
              if (!result.acquired) {
                throw Object.assign(new Error(result.value.error), result.value);
              }
              return result.value;
            },
            session: context.session,
            workdir: cwd
          });

          outputTargets ||= await listOutputTargets(context);
          const outputTarget = findOutputTarget(outputTargets, outputTargetId);
          if (!outputTarget) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              details: {
                availableOutputTargetIds: outputTargets.map((target) => String(target?.id || "")).filter(Boolean)
              },
              message: "Output target is not available.",
              reason: "output_target_missing",
              status: "failed"
            });
            return {
              ok: false,
              error: "Output target is not available."
            };
          }
          if (outputTarget.available === false) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              outputTargetId: outputTarget.id,
              message: outputTarget.disabledReason || "Output target is disabled.",
              reason: "output_target_disabled",
              status: "failed"
            });
            return {
              ok: false,
              error: outputTarget.disabledReason || "Output target is disabled."
            };
          }

          const savedTarget = outputTargetFromMetadata(context.session.metadata);
          let outputParameters = input.outputParameters;
          if (outputParameters === undefined && savedTarget?.id === outputTarget.id) {
            outputParameters = savedTarget.outputParameters;
          }
          const spec = await createVibe64OutputTargetTerminalSpec({
            context: {
              ...context,
              outputTarget,
              vibe64User: input.vibe64User || null
            },
            outputTargetId: outputTarget.id,
            outputParameters
          });
          if (spec?.ok === false) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              outputTargetId: outputTarget.id,
              message: spec.message || "Output target terminal cannot start.",
              reason: "output_target_spec_failed",
              status: "failed"
            });
            return {
              ok: false,
              error: spec.message || "Output target terminal cannot start."
            };
          }
          await ensureProjectServices(context);
          const commandPreview = commandInvocation(spec);

          const namespace = outputTargetTerminalNamespace(sessionId);
          let terminalSession;
          let resourceWorkflow = null;
          let outputResultsMarker = "";
          let readinessMarker = "";
          try {
            const terminalEnvRecords = await loadProjectExecutionEnvRecords({
              includeResourceConfiguration: true,
              projectService,
              runCommand,
              runtime: context.runtime,
              session: context.session,
              target: "output-target"
            });
            const terminalEnv = projectExecutionEnvFromRecords(terminalEnvRecords);
            const webOutput = String(spec.metadata?.outputPresentationKind || "").trim() === "web";
            // While the session records this target, every launch of it
            // carries the recorder; the recorder's variables also change the
            // fingerprint, so an unrecorded process is never reused.
            const usageLaunch = activeUsageRecording(currentProjectScopeKey(), sessionId)?.launch({
              environment: composeLaunchTerminalEnvironment({ envBase: {}, hashBase: terminalEnv, specEnv: spec.env, terminalEnv }).hashEnv,
              outputTargetId: outputTarget.id,
              web: webOutput
            }) || null;
            const launchEnvironment = composeLaunchTerminalEnvironment({
              envBase: {},
              hashBase: terminalEnv,
              specEnv: usageLaunch
                ? (envInput) => ({ ...launchSpecEnvironment(spec.env, envInput), ...usageLaunch.environment })
                : spec.env,
              terminalEnv
            });
            const commandAllowedRoots = [
              context.sessionSourceRoot,
              spec.cwd,
              cwd,
              ...launchSpecAllowedRoots(spec)
            ].filter(Boolean);
            const commandProject = launchExecutionProject(context, terminalEnvRecords);
            const launchEnvHash = executionEnvFingerprint(launchEnvironment.hashEnv);
            const launchRestartBaseline = await createLaunchRestartBaseline({
              restartOnChange: spec.restartOnChange || spec.metadata?.restartOnChange,
              worktreePath: spec.metadata?.runRoot || spec.cwd || cwd
            });
            readinessMarker = readinessMarkerFromSpec(spec);
            outputResultsMarker = String(spec.metadata?.outputResultsMarker || "").trim();
            const previewPublicOrigin = webOutput
              ? previewPublicOriginForLaunch({
                  env,
                  publicHost: input.publicHost,
                  publicProtocol: input.publicProtocol,
                  sessionId
                })
              : "";
            let launchReadyConfirmed = false;
            await closeStoppedLaunchTerminals(sessionId);
            const existingReusableTerminal = forceRestart
              ? null
              : reusableLaunchTerminal(sessionId, {
                  launchEnvHash,
                  outputTargetId: outputTarget.id,
                  namespace,
                  spec
                });
            await cleanupSupersededLaunchTerminals({
              launchPreviewProxies,
              namespace,
              reusableTerminal: existingReusableTerminal,
              sessionId
            });
            if (existingReusableTerminal) {
              terminalSession = existingReusableTerminal;
            } else {
              const currentOutputs = await inspectVibe64OutputsForContext(context);
              if (currentOutputs.stackHash !== spec.stackHash) {
                throw Object.assign(new Error("The Stack changed while preparing this output. Retry to run the current target."), {
                  code: "VIBE64_STACK_CHANGED"
                });
              }
              const execution = outputTargetExecutionDescriptor(outputTarget, spec);
              resourceWorkflow = await startWorkflow({
                ...spec.resourceWorkflow,
                configuration: {
                  ...spec.resourceWorkflow?.configuration,
                  environmentFingerprint: terminalEnvRecords.resourceConfigurationFingerprint
                },
                session: context.session, sourceRoot: context.sessionSourceRoot,
                environment: testRun && !testRun.restoring && outputTarget.id === testRun.targetId ? "test" : "development",
                kind: execution.kind, label: execution.label, env
              });
              if (resourceWorkflow?.ok === false) {
                throw Object.assign(new Error(resourceWorkflow.error || "This output could not be admitted."), {
                  code: resourceWorkflow.code, details: { admission: resourceWorkflow.admission }
                });
              }
              const admittedOutputs = await inspectVibe64OutputsForContext(context);
              if (admittedOutputs.stackHash !== spec.stackHash) {
                throw Object.assign(new Error("The Stack changed while waiting for resources. Retry to run the current target."), {
                  code: "VIBE64_STACK_CHANGED"
                });
              }
              // The running process outlives this admitted request. Its callbacks
              // observe and control that accepted work through the captured
              // control projection, as practice lessons expire the request grant.
              const callbackContext = captureProjectRequestContext();
              const inCallbackContext = handler => (...args) =>
                runWithProjectRequestContext(callbackContext || {}, () => handler(...args));
              terminalSession = await runCommand({
                actor: "daemon",
                allowedRoots: commandAllowedRoots,
                args: spec.args || [],
                command: spec.command,
                cwd: spec.cwd || cwd,
                env: launchEnvironment.env,
                envPolicy: webOutput ? "preview" : "project",
                execution: { ...execution, ...(resourceWorkflow?.workflow?.id ? { workflowId: resourceWorkflow.workflow.id } : {}) },
                mode: "pty",
                project: commandProject,
                purpose: webOutput ? "preview" : "output",
                runtimes: webOutput ? previewRuntimesForSpec(spec) : normalizedRuntimeRequirements(spec.runtimes),
                ...(usageLaunch?.usageRecordingPreload ? { usageRecordingPreload: usageLaunch.usageRecordingPreload } : {}),
                session: context.session || {},
                terminal: {
                  commandPreview: spec.commandPreview,
                  maxRunning: 1,
                  metadata: {
                    ...(spec.metadata || {}),
                    attemptedCommand: commandPreview,
                    envHash: launchEnvHash,
                    ...(launchRestartBaseline ? { launchRestartBaseline } : {}),
                    outputTargetId: outputTarget.id,
                    outputTargetLabel: outputTarget.label,
                    ...(resourceWorkflow?.workflow?.id ? { resourceWorkflowId: resourceWorkflow.workflow.id } : {}),
                    ...(previewPublicOrigin ? { previewPublicOrigin } : {}),
                    sessionId,
                    ...terminalNoGithubActorMetadata({
                      ownerUserKey: "output-target",
                      reason: "output-target"
                    })
                  },
                  namespace,
                  namespaceLimitPrefix: namespace,
                  onClose: inCallbackContext(async (event) => {
                    usageLaunch?.exited();
                    try {
                      if (event.reason === "exit" && event.exitCode === 0) {
                        await captureOutputResults({
                          context,
                          outputTarget,
                          spec,
                          terminalSessionId: event.id,
                          updateMetadata: (metadata) => updateTerminalSessionMetadata(event.id, metadata, {
                            namespace
                          })
                        });
                      }
                      if (event.reason === "exit") {
                        await writePreviewDiagnostic(context.session, {
                          ...diagnosticBase,
                          commandPreview,
                          exitCode: event.exitCode ?? null,
                          outputTargetId: outputTarget.id,
                          outputTail: event.output,
                          reason: event.exitCode === 0 ? "process_exited" : "process_exited_nonzero",
                          status: event.exitCode === 0 ? "exited" : "failed",
                          terminalSessionId: event.id
                        });
                      }
                      await launchPreviewProxies.close({
                        sessionId,
                        terminalSessionId: event.id
                      });
                      const metadataCleared = await clearLaunchMetadataForTerminal(context.store, sessionId, event.id);
                      if (metadataCleared) {
                        publishLaunchCleanup(sessionId, context.projectSlug);
                      }
                      // readable-check: allow method-probe - data: a terminal spec may carry a close callback
                      if (typeof spec.onClose === "function") {
                        await spec.onClose(event);
                      }
                    } finally {
                      await finishWorkflow(resourceWorkflow?.workflow?.id, {
                        outcome: event.reason !== "exit" ? "stopped" : event.exitCode === 0 ? "succeeded" : "failed",
                        defer: true
                      });
                    }
                  }),
                  onStop: inCallbackContext(async (event) => {
                    usageLaunch?.exited();
                    await writePreviewDiagnostic(context.session, {
                      ...diagnosticBase,
                      commandPreview,
                      exitCode: event.exitCode ?? null,
                      outputTargetId: outputTarget.id,
                      outputTail: event.output,
                      reason: "process_stopped",
                      status: "stopped",
                      terminalSessionId: event.id
                    });
                    await launchPreviewProxies.close({
                      sessionId,
                      terminalSessionId: event.id
                    });
                    const metadataCleared = await clearLaunchMetadataForTerminal(context.store, sessionId, event.id);
                    if (metadataCleared) {
                      publishLaunchCleanup(sessionId, context.projectSlug);
                    }
                    // readable-check: allow method-probe - data: a terminal spec may carry a stop callback
                    if (typeof spec.onStop === "function") {
                      await spec.onStop(event);
                    }
                  }),
                  onOutput: (event) => void inCallbackContext(({ output, session: runningTerminalSession, updateMetadata }) => {
                    const actions = launchActionsFromOutput(output);
                    if (actions.length > 0 && launchActionsChanged(runningTerminalSession.metadata?.actions, actions)) {
                      updateMetadata({
                        actions
                      });
                    }
                    void writePreviewDiagnostic(context.session, {
                      ...diagnosticBase,
                      commandPreview,
                      outputTargetId: outputTarget.id,
                      outputTail: output,
                      reason: "process_output",
                      status: "running",
                      terminalSessionId: runningTerminalSession.id
                    }, {
                      append: false
                    });
                    if (outputResultsMarkerLineSeen(output, outputResultsMarker)) {
                      void captureOutputResults({
                        context,
                        outputTarget,
                        spec,
                        terminalSessionId: runningTerminalSession.id,
                        updateMetadata
                      });
                    }
                    if (!readinessMarker || launchReadyConfirmed || !launchReadinessMarkerLineSeen(output, readinessMarker)) {
                      return;
                    }
                    void markLaunchReady({
                      namespace,
                      projectSlug: context.projectSlug,
                      publishSessionChanged,
                      source: "marker",
                      store: context.store,
                      sessionId,
                      terminalSession: runningTerminalSession,
                      updateMetadata
                    }).then(async (result) => {
                      launchReadyConfirmed = result?.ready === true;
                      if (launchReadyConfirmed) {
                        await ensureReadyLaunchPreviewProxy(
                          context,
                          result.terminal || runningTerminalSession,
                          { source: "marker" }
                        );
                      }
                    }).catch((error) => {
                      vibe64SessionDebugLog("server.outputTargetTerminal.readyMarker.error", {
                        error: vibe64SessionDebugError(error),
                        sessionId,
                        terminalSessionId: runningTerminalSession.id
                      }, {
                        level: "warn"
                      });
                    });
                  })(event).catch((error) => {
                    // The PTY hook only reports synchronous failures.
                    vibe64SessionDebugLog("server.outputTargetTerminal.output.error", {
                      error: vibe64SessionDebugError(error),
                      sessionId
                    }, {
                      level: "warn"
                    });
                  }),
                  reuseRunning: false
                }
              });
            }
          } catch (error) {
            await finishWorkflow(resourceWorkflow?.workflow?.id, { outcome: "failed", defer: true });
            releaseLaunchSpecReservation(spec);
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              commandPreview,
              error,
              outputTargetId: outputTarget.id,
              reason: "terminal_start_failed",
              status: "failed"
            });
            throw error;
          }
          if (
            terminalSession?.ok === false ||
            (spec.metadata?.port && String(terminalSession?.metadata?.port || "") !== String(spec.metadata.port))
          ) {
            releaseLaunchSpecReservation(spec);
          }
          if (terminalSession?.ok === false) {
            await finishWorkflow(resourceWorkflow?.workflow?.id, { outcome: "failed", defer: true });
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              commandPreview,
              error: terminalSession.error || "Output target terminal could not start.",
              outputTargetId: outputTarget.id,
              reason: "terminal_start_rejected",
              status: "failed"
            });
          } else {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              commandPreview,
              outputTargetId: outputTarget.id,
              reason: "terminal_started",
              status: "running",
              terminalSessionId: terminalSession.id
            });
          }
          if (terminalSession?.ok !== false && launchTerminalIsReady(terminalSession, readinessMarker)) {
            if (terminalSession.metadata?.outputMode === "interactive") {
              await setWorkflowPhase(terminalSession.metadata.resourceWorkflowId, "running");
            }
            await writeLaunchMetadata(context.store, sessionId, terminalSession);
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              commandPreview,
              outputTargetId: outputTarget.id,
              reason: "launch_ready",
              status: "ready",
              terminalSessionId: terminalSession.id
            });
            await ensureReadyLaunchPreviewProxy(context, terminalSession, {
              source: "start"
            });
          }
          if (terminalSession?.ok !== false && stopState.stopped && !(testRun && input.previewTestRun === testRun)) {
            await writePreviewStopState(context.store, sessionId, { stopped: false });
          }
          return terminalSession;
        } finally {
          admission.release();
        }
      }));
    },

    async stopTerminal(sessionId, terminalSessionId) {
      return vibe64Result(async () => withLaunchStartLock(sessionId, async () => {
        if (previewTestRuns.has(sessionId)) {
          return { ok: false, code: "vibe64_preview_test_busy", error: "Browser tests own this Preview. Stop the test command before stopping Preview." };
        }
        const active = latestLaunchTerminal(sessionId);
        const requestedId = String(terminalSessionId || "").trim();
        if (requestedId && active?.id && active.id !== requestedId && launchTerminalIsRunning(active)) {
          return { ok: false, code: "vibe64_preview_run_changed", error: "A newer Preview run is active. Refresh its status before stopping it." };
        }
        const runtime = await projectService.createRuntime();
        const projectSlug = currentProjectSlug(projectService);
        await writePreviewStopState(runtime.store, sessionId, { stopped: true });
        const activeId = active?.id && (!requestedId || active.id === requestedId) ? active.id : "";
        let result = { ok: true, id: requestedId, running: false, status: "exited" };
        try {
          if (activeId && launchTerminalIsRunning(active)) {
            result = await stopTerminalSessionAndWait(activeId, {
              namespace: outputTargetTerminalNamespace(sessionId)
            });
            if (result?.ok === false) throw new Error(result.error || "Preview process did not stop.");
          }
          await launchPreviewProxies.close({ sessionId });
          const browserCleanup = await stopPreviewBrowsers(sessionId);
          if (browserCleanup?.ok === false) throw new Error(browserCleanup.error || "Managed Preview browser did not stop.");
          await writePreviewStopState(runtime.store, sessionId, { stopped: true });
          publishLaunchCleanup(sessionId, projectSlug, "preview-stopped");
          return result;
        } catch (error) {
          const message = String(error?.message || error || "Preview cleanup failed.");
          await writePreviewStopState(runtime.store, sessionId, { stopped: true, error: message });
          publishLaunchCleanup(sessionId, projectSlug, "preview-stop-failed");
          return { ok: false, code: "vibe64_preview_stop_incomplete", error: message };
        }
      }));
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    },

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    }
  };
  return Object.freeze(controller);
}

export {
  OUTPUT_METADATA,
  cleanupSupersededLaunchTerminals,
  createLaunchRestartBaseline,
  launchActionsFromOutput,
  launchReadinessMarkerLineSeen,
  launchRestartState,
  listOutputTargets,
  outputTargetExecutionDescriptor,
  previewIdentityCommandRunnerForLaunchTerminal,
  previewEditorOrigin,
  previewPublicOriginForLaunch,
  workspaceSetupLaunchDisabledReason,
  createOutputTargetTerminalController
};
