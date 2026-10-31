import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  logOperationalEvent,
  sanitizeLogText
} from "@local/vibe64-core/server/logging";
import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "@local/vibe64-core/server/previewAuth";
import { vibe64StatusCode } from "@local/vibe64-core/server/serverResponses";
import {
  readSessionUiSyncStateForSession
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  AGENT_PREVIEW_USAGE,
  agentPlaywrightCommandSource,
  agentPreviewBrowserWorkerSource,
  agentPreviewWrapperSource,
  runVibe64Command,
  runtimePackBinPaths,
  runtimePackRoot,
  stopVibe64Execution,
  stopVibe64OwnedExecutions,
  vibe64ManagedExecutionProvider
} from "@local/vibe64-execution/server";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import {
  browserTestNeedsCleanup,
  drainBrowserTestExecutions
} from "./browserTestCleanup.js";
import { createSessionCommandServers, unixCommandSocketPath } from "./unixJsonCommand.js";
import { trimmedText as normalizeText } from "./trimmedText.js";
import { isRecord } from "./isRecord.js";
import {
  responseError,
  runRegisteredPlaywrightCommand,
  startRegisteredBrowserWorker,
  stopRegisteredBrowserWorker,
  stopRegisteredBrowserWorkerForInput,
  streamPlaywrightRun
} from "./agentPreviewBrowserWorker.js";
import {
  logsStdout,
  parsePreviewCommandArgs,
  previewInspectionUrl,
  previewStartStdout,
  previewStatusSummary,
  previewSummaryLines,
  statusStdout,
  waitForPreviewReady
} from "./agentPreviewStatusText.js";

/** @typedef {ReturnType<typeof import("./outputTargetTerminal.js").createOutputTargetTerminalController>} OutputTargetTerminalController */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/sessionRealtimeEvents").createSessionChangedPublisher>} PublishSessionChanged */

const AGENT_PREVIEW_COMMAND_NAME = "vibe64-preview";
const AGENT_PLAYWRIGHT_COMMAND_NAME = "vibe64-playwright";
const AGENT_PREVIEW_BROWSER_WORKER_NAME = "vibe64-preview-browser-worker";
const AGENT_PREVIEW_BROWSER_SOCKET_NAME = "preview-browser.sock";
const AGENT_PREVIEW_BROWSER_METADATA_NAME = "preview-browser.json";
const AGENT_PREVIEW_COMMAND_SOCKET_NAME = "preview-command.sock";
const AGENT_PREVIEW_COMMAND_CONTRACT_VERSION = "11";
const AGENT_PREVIEW_COMMAND_REQUEST_MAX_BYTES = 1024 * 1024;
const DEFAULT_PREVIEW_BROWSER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PREVIEW_BROWSER_SUSPEND_AFTER_MS = 30 * 1000;
const VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID";
const VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SOCKET";
const VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_TOKEN";
const VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_GENERATION";
const VIBE64_PREVIEW_BROWSER_WORKER_TOKEN_ENV = "VIBE64_PREVIEW_BROWSER_WORKER_TOKEN";

const commandServers = createSessionCommandServers({
  routePrefix: "/agent-preview-command",
  routes: {
    "/agent-preview-command/identity": {
      handle: ({ commandService, input, sessionId }) => commandService.authorizeBrowserIdentity(sessionId, input.identity),
      status: vibe64StatusCode
    },
    "/agent-preview-command/playwright-status": {
      handle: ({ commandService, sessionId }) => commandService.playwrightStatus(sessionId)
    },
    "/agent-preview-command/playwright-cancel": {
      handle: ({ commandService, input, sessionId }) => commandService.cancelPlaywrightRun(sessionId, normalizeText(input.runId)),
      status: vibe64StatusCode
    },
    "/agent-preview-command/browser-start": {
      handle: ({ commandService, input, sessionId }) => commandService.browserStart(sessionId, input),
      status: vibe64StatusCode
    },
    "/agent-preview-command/browser-stop": {
      handle: ({ commandService, input, sessionId }) => commandService.browserStop(sessionId, input),
      status: vibe64StatusCode
    },
    "/agent-preview-command/playwright-run": { handle: streamPlaywrightRun },
    "/agent-preview-command/run": { handle: ({ commandService, input }) => commandService.run(input) }
  },
  label: "preview",
  maxBytes: AGENT_PREVIEW_COMMAND_REQUEST_MAX_BYTES,
  invalidJsonError: { code: "vibe64_agent_preview_command_invalid_json", message: "Vibe64 preview command input must be valid JSON." },
  tooLargeError: { code: "vibe64_agent_preview_command_input_too_large", message: "Vibe64 preview command input is too large." },
  notFound: responseError("Unknown Vibe64 preview command route.", "vibe64_agent_preview_command_route_not_found"),
  rejection: {
    statusCode: 409,
    payload: responseError("Managed preview control generation is no longer current. Reconnect the assistant.", "vibe64_agent_control_unavailable")
  },
  requestFailure: {
    fallbackCode: "vibe64_agent_preview_command_request_failed",
    fallbackMessage: "Vibe64 preview command request failed."
  }
});

function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_COMMAND_NAME);
}

function agentPlaywrightHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PLAYWRIGHT_COMMAND_NAME);
}

function browserWorkerHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_WORKER_NAME);
}

function browserMetadataHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_METADATA_NAME);
}

async function writeWrapper({
  agentPlaywrightSource = "",
  browserWorkerSource = "",
  previewWrapperSource = "",
  wrapperHostDir = ""
} = {}) {
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!normalizedWrapperHostDir) {
    return false;
  }
  await mkdir(normalizedWrapperHostDir, {
    recursive: true
  });
  await Promise.all([
    writeExecutableFileIfChanged(
      wrapperHostPath(normalizedWrapperHostDir),
      previewWrapperSource
    ),
    writeExecutableFileIfChanged(
      browserWorkerHostPath(normalizedWrapperHostDir),
      browserWorkerSource
    ),
    writeExecutableFileIfChanged(
      agentPlaywrightHostPath(normalizedWrapperHostDir),
      agentPlaywrightSource
    )
  ]);
  return true;
}

function logPreviewCommandResult(logger, result = {}, fields = {}) {
  const ok = result?.ok !== false && Number(result?.exitCode || 0) === 0;
  return logOperationalEvent(logger, ok ? "info" : "warn", {
    code: result?.code || "",
    command: normalizeText(fields.command),
    component: "vibe64.agent_preview_command",
    cwd: normalizeText(fields.cwd),
    durationMs: Number(fields.durationMs || 0),
    event: "vibe64.agent_preview_command.finished",
    exitCode: Number(result?.exitCode ?? (ok ? 0 : 1)),
    ok,
    outputTail: ok ? "" : sanitizeLogText(result.stderr || result.error || "").slice(-1000),
    sessionId: normalizeText(fields.sessionId)
  }, "Vibe64 agent preview command finished.");
}

/**
 * @param {object} dependencies
 * @param {OutputTargetTerminalController} dependencies.launchTarget
 * @param {RuntimeLogger | null} [dependencies.logger]
 * @param {ProjectService} dependencies.projectService
 * @param {typeof readSessionUiSyncStateForSession} [dependencies.readSessionUiState]
 * @param {typeof runVibe64Command} [dependencies.runManagedCommand]
 * @param {typeof stopVibe64Execution} [dependencies.stopManagedExecution]
 * @param {typeof stopVibe64OwnedExecutions} [dependencies.stopOwnedExecutions]
 * @param {typeof vibe64ManagedExecutionProvider} [dependencies.resourceProvider]
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 */
function createAgentPreviewCommandService({
  launchTarget,
  logger = null,
  projectService,
  readSessionUiState = readSessionUiSyncStateForSession,
  runManagedCommand = runVibe64Command,
  stopManagedExecution = stopVibe64Execution,
  stopOwnedExecutions = stopVibe64OwnedExecutions,
  resourceProvider = vibe64ManagedExecutionProvider,
  publishSessionChanged
}) {
  const browserWorkers = new Map();
  const browserTestRuns = new Map();

  // The project that prepared the session's assistant commands. A browser
  // test's changes name it, because its command can arrive outside any
  // request, as after a restart.
  function sessionProjectSlug(sessionId) {
    const project = [...(browserWorkers.get(sessionId)?.values() || [])][0]?.project;
    return normalizeText(project?.slug || project?.name);
  }

  async function runBrowserCommand(request) {
    const runtimeConfigEnv = await projectService.runInProjectContext(request.project.slug, () => (
      projectService.projectInspectionEnvironment({
        sessionId: request.session.sessionId,
        target: "preview"
      })
    ));
    return runManagedCommand({
      ...request,
      project: { ...request.project, runtimeConfigEnv }
    });
  }

  function testApprovalStatus(sessionId) {
    const pending = browserTestRuns.get(sessionId);
    return pending?.admissionId ? { admissionId: pending.admissionId, state: pending.state, expiresAt: pending.expiresAt } : null;
  }

  function playwrightStatus(sessionId) {
    const pending = browserTestRuns.get(sessionId);
    return { ok: true, run: pending ? {
      id: pending.id, targetId: pending.targetId, state: pending.state,
      startedAt: pending.startedAt, elapsedMs: Date.now() - Date.parse(pending.startedAt)
    } : null };
  }

  async function cancelPlaywrightRun(sessionId, runId) {
    const pending = browserTestRuns.get(sessionId);
    if (!pending || pending.id !== runId) return responseError(
      "That browser test is no longer active. Check playwright status before cancelling another run.", "vibe64_test_run_unavailable"
    );
    pending.cancelling ||= finishCancellation(sessionId, pending).finally(() => { pending.cancelling = null; });
    return pending.cancelling;
  }

  async function finishCancellation(sessionId, pending) {
    pending.interrupt();
    let result = await pending.completion;
    if (result?.previewRecoveryRequired) {
      if (pending.targetId) {
        result = await launchTarget.retryPreviewTestCleanup(sessionId);
      } else {
        pending.cleanupExecutionIds ||= new Set(result.cleanupExecutionIds || [result.execution?.id]);
        await drainBrowserTestExecutions(pending.cleanupExecutionIds, stopManagedExecution);
        result = { ...result, previewRecoveryRequired: pending.cleanupExecutionIds.size > 0 };
      }
      if (!result.previewRecoveryRequired && browserTestRuns.get(sessionId) === pending) {
        browserTestRuns.delete(sessionId);
        await publishSessionChanged(sessionId, { projectSlug: pending.projectSlug });
      }
    }
    if (result?.previewRecoveryRequired) return result;
    return { ok: true, cancelled: true, runId: pending.id, message: "Browser test finished and Preview cleanup completed." };
  }

  function cancelTestApproval({ projectSlug, sessionId, admissionId }, reason = "cancelled") {
    const pending = browserTestRuns.get(sessionId);
    if (!pending || pending.projectSlug !== projectSlug || pending.admissionId !== admissionId || pending.state !== "waiting") {
      return responseError("This test request is no longer waiting for approval.", "vibe64_test_approval_unavailable");
    }
    pending.cancel(reason);
    return { ok: true, cancelled: true, sessionId };
  }

  async function resumeTestApproval({ projectSlug, sessionId, admissionId }, authorizeStart) {
    const pending = browserTestRuns.get(sessionId);
    if (!pending || pending.projectSlug !== projectSlug || pending.admissionId !== admissionId) {
      return responseError("The original test request has ended. Run the test command again.", "vibe64_test_approval_unavailable");
    }
    if (["resuming", "running"].includes(pending.state)) return { ok: true, accepted: true, replayed: true, sessionId };
    if (pending.state !== "waiting" || Date.now() >= Date.parse(pending.expiresAt) || typeof authorizeStart !== "function") {
      return responseError("This test approval has expired or is no longer available.", "vibe64_test_approval_unavailable");
    }
    // The command's promise remains its result owner. HTTP only acknowledges
    // the handoff; a lost dashboard response never launches a second test.
    pending.resume(authorizeStart);
    await publishSessionChanged(sessionId, { projectSlug });
    return { ok: true, accepted: true, sessionId };
  }

  async function withTestApproval(sessionId, input, options, targetId, operation, validate) {
    const run = (startTarget) => launchTarget.withPreviewTarget(sessionId, targetId, async (token) => {
      const pending = browserTestRuns.get(sessionId);
      if (pending?.admissionId) {
        pending.state = "running";
        await publishSessionChanged(sessionId, { projectSlug: pending.projectSlug });
      }
      options.signal?.throwIfAborted();
      return operation(token);
    }, {
      startTarget: startTarget ? (start) => startTarget(async () => {
        options.signal?.throwIfAborted();
        await validate();
        options.signal?.throwIfAborted();
        return start();
      }) : undefined,
      signal: options.signal,
      onState: (state) => {
        const pending = browserTestRuns.get(sessionId);
        if (pending) pending.state = state;
      },
      waitUntilReady: async (terminal, { restoring = false } = {}) => {
        const waited = await waitForPreviewReady(launchTarget, sessionId, {
          terminalSessionId: terminal.id, signal: restoring ? null : options.signal
        });
        if (!waited.ok) throw new Error(waited.status?.error || (waited.timeout
          ? "Timed out waiting for Preview readiness." : "Preview failed to become ready."));
      }
    });
    const result = await run();
    const admission = result?.details?.admission;
    if (result?.code !== "vibe64_capacity_rejected" || admission?.outcome !== "unavailable" ||
        !admission.actions?.includes("recheck")) return result;
    options.signal?.throwIfAborted();
    const { descriptor } = await validate();
    const provider = resourceProvider();
    const identity = { projectSlug: descriptor.project.slug, sessionId, admissionId: admission.id };
    const wait = await provider.beginWorkflowApprovalWait({
      ...identity, parentExecutionId: input.parentExecutionId, controlGenerationId: descriptor.controlGenerationId
    });
    let outcome = "interrupted";
    let timer;
    const pending = browserTestRuns.get(sessionId);
    Object.assign(pending, identity, { state: "waiting", expiresAt: wait.expiresAt });
    const decision = new Promise((resolve) => {
      pending.cancel = (reason) => {
        if (pending.state !== "waiting") return;
        pending.state = reason;
        outcome = reason;
        resolve(null);
      };
      pending.resume = (authorize) => {
        if (pending.state !== "waiting") return;
        pending.state = "resuming";
        clearTimeout(timer);
        resolve(authorize);
      };
    });
    const abort = () => pending.cancel("interrupted");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    timer = setTimeout(() => pending.cancel("expired"), Math.max(0, Date.parse(wait.expiresAt) - Date.now()));
    try {
      // readable-check: allow optional-call - input validation: a caller's optional output stream for progress text
      options.onOutput?.("Waiting for resources. Normal Preview has been restored. Retry or Cancel in Vibe64 within five minutes; tests have not run.\n");
      await publishSessionChanged(sessionId, { projectSlug: pending.projectSlug });
      const authorizeStart = await decision;
      if (!authorizeStart) return responseError(
        outcome === "expired" ? "The resource wait expired. Tests were not run."
          : outcome === "cancelled" ? "The resource wait was cancelled. Tests were not run."
            : "The original test command ended. Tests were not run.",
        `vibe64_test_approval_${outcome}`, { details: result.details }
      );
      options.signal?.throwIfAborted();
      await validate();
      outcome = "resumed";
      return await run(authorizeStart);
    } catch (error) {
      if (options.signal?.aborted) outcome = "interrupted";
      error.details = { ...error.details, admission };
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      await provider.endWorkflowApprovalWait({ ...identity, outcome });
    }
  }

  async function authorizeBrowserIdentity(sessionId = "", identity = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const requested = normalizeText(identity).toLowerCase();
    if (!normalizedSessionId) {
      return responseError(
        "Vibe64 preview command session id is required.",
        "vibe64_agent_preview_command_session_required"
      );
    }
    if (!requested) {
      return responseError(
        "Choose default, guest, or a configured managed app identity name.",
        "vibe64_agent_preview_identity_required"
      );
    }
    if (requested === "guest") {
      return launchTarget.selectPreviewIdentity(normalizedSessionId, {
        mode: "guest"
      });
    }
    return launchTarget.selectPreviewIdentity(normalizedSessionId, {
      identityName: requested,
      mode: "identity"
    });
  }

  function registerBrowserWorker(sessionId = "", descriptor = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const socketPath = normalizeText(descriptor.socketPath);
    if (!normalizedSessionId || !socketPath) {
      return false;
    }
    const sessionWorkers = browserWorkers.get(normalizedSessionId) || new Map();
    const existing = sessionWorkers.get(socketPath);
    const sameGeneration = normalizeText(existing?.token) === normalizeText(descriptor.token);
    if (existing && !sameGeneration) browserTestRuns.get(normalizedSessionId)?.interrupt();
    sessionWorkers.set(socketPath, {
      ...descriptor,
      executionId: sameGeneration ? normalizeText(existing?.executionId) : "",
      retiredDescriptors: sameGeneration
        ? (existing?.retiredDescriptors || [])
        : [
            ...(existing?.retiredDescriptors || []),
            ...(existing ? [existing] : [])
          ],
      sessionId: normalizedSessionId,
      socketPath
    });
    browserWorkers.set(normalizedSessionId, sessionWorkers);
    return true;
  }

  // Interrupts a pending browser test, stops every registered worker and
  // closes the session's command servers; returns the worker count.
  async function teardownSession(sessionId = "", { forget = false, reason = "" } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const pending = browserTestRuns.get(normalizedSessionId);
    pending?.interrupt();
    await pending?.completion;
    const sessionWorkers = browserWorkers.get(normalizedSessionId) || new Map();
    if (forget) {
      browserWorkers.delete(normalizedSessionId);
    }
    let closed = 0;
    for (const descriptor of sessionWorkers.values()) {
      await stopRegisteredBrowserWorker(descriptor, {
        reason,
        stopExecution: stopManagedExecution,
        stopOwnedExecutions
      });
      closed += 1;
    }
    await commandServers.closeForSession(normalizedSessionId);
    return closed;
  }

  async function closeAllForSession(sessionId = "") {
    const closed = await teardownSession(sessionId, { forget: true, reason: "session-close" });
    return {
      closed,
      ok: true
    };
  }

  async function stopBrowsersForSession(sessionId = "") {
    const sessionWorkers = browserWorkers.get(normalizeText(sessionId));
    if (!sessionWorkers) return { ok: true, closed: 0 };
    let closed = 0;
    for (const descriptor of sessionWorkers.values()) {
      const result = await stopRegisteredBrowserWorker(descriptor, {
        reason: "preview-stop",
        stopExecution: stopManagedExecution,
        stopOwnedExecutions
      });
      if (result?.ok === false) return result;
      closed += 1;
    }
    // Preview owns browser processes, not the assistant's command registration.
    // Keep it usable for the next launch; session closure retires it separately.
    return { ok: true, closed };
  }

  async function releaseControlForSession(sessionId = "") {
    await teardownSession(sessionId, { reason: "control-release" });
    return {
      ok: true
    };
  }

  // Managed app identities belong to the project; the session's bound project
  // and source scope every read and save, never a caller-supplied target.
  async function previewIdentities(sessionId = "", args = [], stdin = "") {
    const words = (Array.isArray(args) ? args : []).map(normalizeText).filter(Boolean);
    const subcommand = words[1] || "";
    if (words[0] !== "identities" || words.length > (subcommand === "save" ? 2 : 1) || (subcommand && subcommand !== "save")) {
      return responseError("Usage: vibe64-helper preview identities [save < identities.json]", "vibe64_agent_preview_identities_usage", { exitCode: 64 });
    }
    const projectSlug = sessionProjectSlug(sessionId);
    if (!projectSlug) {
      return responseError("Managed app identities are not bound to this session's project. Reconnect the assistant.", "vibe64_agent_preview_identities_project_required");
    }
    return projectService.runInProjectContext(projectSlug, async () => {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) return status;
      const identityTypes = [...new Set((status.outputTargets || []).flatMap((target) => target.identityTypes || []))];
      let result;
      if (subcommand === "save") {
        let identities = null;
        try {
          const value = JSON.parse(String(stdin || ""));
          identities = Array.isArray(value) ? value : value?.identities;
        } catch {
          // Invalid JSON is reported with the usage error below.
        }
        if (!Array.isArray(identities)) {
          return responseError("Provide the complete ordered identity list as a JSON array on stdin.", "vibe64_agent_preview_identities_input_invalid", { exitCode: 64 });
        }
        const undeclared = identities.filter((identity) => !identityTypes.includes(normalizeText(identity?.type)));
        if (undeclared.length) {
          return responseError(identityTypes.length
            ? `Identity types must be ones this project's Stack declares in #### Preview identity: ${identityTypes.join(", ")}.`
            : "This project's Stack declares no #### Preview identity types; add the application's Preview identity command first (vibe64-helper spec outputs).",
          "vibe64_agent_preview_identities_type_undeclared");
        }
        result = await projectService.savePreviewApplicationIdentities({ identities, sessionId });
      } else {
        result = await projectService.readPreviewApplicationIdentities({ sessionId });
      }
      return result?.ok === false ? result : {
        exitCode: 0,
        ok: true,
        stdout: `${JSON.stringify({ identities: result.identities, identityTypes }, null, 2)}\n`
      };
    });
  }

  function statusSummary(status = {}, sessionId = "") {
    const uiState = typeof readSessionUiState === "function"
      ? readSessionUiState(sessionId)
      : null;
    return previewStatusSummary(status, {
      previewState: uiState?.preview || null
    });
  }

  function inspectionUrl(status = {}, sessionId = "") {
    const uiState = typeof readSessionUiState === "function"
      ? readSessionUiState(sessionId)
      : null;
    return previewInspectionUrl(status, {
      previewState: uiState?.preview || null
    });
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const parsed = parsePreviewCommandArgs(input.args);
    const sessionId = normalizeText(input.sessionId);
    const baseFields = {
      command: parsed.command,
      cwd: normalizeText(input.cwd),
      sessionId
    };
    const finish = (result = {}) => {
      logPreviewCommandResult(logger, result, {
        ...baseFields,
        durationMs: Date.now() - startedAtMs
      });
      return result;
    };

    if (!sessionId) {
      return finish(responseError("Vibe64 preview command session id is required.", "vibe64_agent_preview_command_session_required"));
    }
    if (parsed.error) return finish(responseError(parsed.error, "vibe64_preview_target_invalid"));
    if (!parsed.command || parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
      return finish({
        exitCode: 0,
        ok: true,
        stdout: AGENT_PREVIEW_USAGE
      });
    }
    if (["status", "targets"].includes(parsed.command)) {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) {
        return finish({
          ...status,
          exitCode: 1,
          stderr: `${status.error || "Vibe64 preview status failed."}\n`
        });
      }
      if (parsed.command === "targets") {
        const targets = (status.outputTargets || []).map((target) => ({
          id: target.id,
          label: target.label,
          default: target.default === true,
          available: target.available !== false,
          presentation: target.presentation?.kind || "",
          disabledReason: target.disabledReason || ""
        }));
        const output = parsed.json
          ? JSON.stringify({ targets }, null, 2)
          : targets.map((target) => {
              const reason = target.disabledReason ? ` — ${target.disabledReason}` : "";
              return `${target.id}: ${target.label} (${target.presentation})${reason}`;
            }).join("\n");
        return finish({
          ok: true,
          exitCode: 0,
          stdout: `${output}\n`
        });
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: statusStdout(statusSummary(status, sessionId), {
          json: parsed.json
        })
      });
    }
    if (parsed.command === "inspect-url") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) {
        return finish({
          ...status,
          exitCode: 1,
          stderr: `${status.error || "Vibe64 preview status failed."}\n`
        });
      }
      const url = inspectionUrl(status, sessionId);
      if (!url) {
        return finish(responseError(
          "Managed preview inspection URL is unavailable. Run vibe64-helper preview ensure --wait --json first.",
          "vibe64_agent_preview_command_inspection_url_unavailable",
          {
            exitCode: 1
          }
        ));
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: `${url}\n`
      });
    }
    if (parsed.command === "logs") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) {
        return finish({
          ...status,
          exitCode: 1,
          stderr: `${status.error || "Vibe64 preview logs failed."}\n`
        });
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: logsStdout(status, {
          json: parsed.json,
          lines: parsed.lines
        })
      });
    }
    if (parsed.command === "stop") {
      const current = await launchTarget.launchStatus(sessionId);
      if (current?.ok === false) return finish({ ...current, exitCode: 1, stderr: `${current.error}\n` });
      const stopped = await launchTarget.stopTerminal(sessionId, current.activeTerminal?.id || "");
      if (stopped?.ok === false) return finish({ ...stopped, exitCode: 1, stderr: `${stopped.error}\n` });
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) return finish({ ...status, exitCode: 1, stderr: `${status.error}\n` });
      const summary = statusSummary(status, sessionId);
      return finish({ ok: true, exitCode: 0, stdout: parsed.json
        ? `${JSON.stringify(summary, null, 2)}\n`
        : `${previewSummaryLines(summary).join("\n")}\n` });
    }
    if (parsed.command === "identities") {
      const result = await previewIdentities(sessionId, input.args, input.stdin);
      return finish(result?.ok === false
        ? { ...result, exitCode: result.exitCode || 1, stderr: `${result.error || "Managed app identities failed."}\n` }
        : result);
    }
    if (!["ensure", "restart"].includes(parsed.command)) {
      return finish(responseError(`Unknown Vibe64 preview command: ${parsed.command}`, "vibe64_agent_preview_command_unknown", {
        exitCode: 2,
        stderr: AGENT_PREVIEW_USAGE
      }));
    }
    const ensuring = parsed.command === "ensure";

    let started;
    if (ensuring) {
      started = parsed.targetId
        ? await launchTarget.ensurePreview(sessionId, { outputTargetId: parsed.targetId })
        : await launchTarget.ensurePreview(sessionId);
    } else {
      started = await launchTarget.restartPreview(sessionId);
    }
    if (started?.ok === false) {
      return finish({
        ...started,
        exitCode: 1,
        stderr: `${started.error || (ensuring ? "Vibe64 managed preview could not start." : "Vibe64 preview restart failed.")}\n`
      });
    }
    let status = await launchTarget.launchStatus(sessionId);
    if (parsed.wait) {
      const waited = await waitForPreviewReady(launchTarget, sessionId, {
        terminalSessionId: started.id,
        timeoutMs: parsed.timeoutMs
      });
      status = waited.status || status;
      if (!waited.ok) {
        const timedOut = waited.timeout === true;
        const summary = statusSummary(status || {}, sessionId);
        return finish(responseError(
          timedOut
            ? "Timed out waiting for Vibe64 preview to become ready."
            : "Vibe64 preview did not become ready.",
          timedOut ? "vibe64_agent_preview_command_wait_timeout" : "vibe64_agent_preview_command_not_ready",
          {
            exitCode: 1,
            stdout: previewStartStdout({
              ...summary,
              timedOut
            }, {
              command: parsed.command,
              json: parsed.json
            })
          }
        ));
      }
    }
    return finish({
      exitCode: 0,
      ok: true,
      stdout: previewStartStdout(statusSummary(status || {}, sessionId), {
        command: parsed.command,
        json: parsed.json
      })
    });
  }

  async function playwrightRun(sessionId, input, options = {}) {
    input = structuredClone(input);
    if (browserTestRuns.has(sessionId) && !input.testRunToken) return responseError(
      "A browser test still owns this session. Use vibe64-helper playwright status, then cancel its run ID or wait for completion.", "vibe64_test_approval_busy"
    );
    const admission = launchTarget.previewTestRunAdmission(sessionId, normalizeText(input.testRunToken));
    if (admission) return admission;
    const parent = input.testRunToken ? browserTestRuns.get(sessionId) : null;
    const cancellation = new AbortController();
    const completion = Promise.withResolvers();
    const pending = !input.testRunToken ? {
      id: crypto.randomUUID(),
      projectSlug: sessionProjectSlug(sessionId),
      targetId: input.targetId || "",
      state: "starting",
      startedAt: new Date().toISOString(),
      completion: completion.promise,
      children: [],
      interrupt: () => cancellation.abort()
    } : null;
    if (pending) {
      browserTestRuns.set(sessionId, pending);
    }
    options = {
      ...options,
      signal: AbortSignal.any([options.signal, cancellation.signal, parent?.signal].filter(Boolean))
    };
    if (pending) pending.signal = options.signal;
    if (parent) parent.children.push(completion.promise);
    const stopping = () => {
      if (pending && ["starting", "running"].includes(pending.state)) pending.state = "stopping";
    };
    options.signal.addEventListener("abort", stopping, { once: true });
    let result;
    try {
      result = await runRegisteredPlaywrightCommand(sessionId, input, {
        browserWorkers,
        onOutput: options.onOutput,
        signal: options.signal,
        runCommand: async (request) => {
          if (pending && !input.targetId) pending.state = "running";
          const commandResult = await runBrowserCommand(request);
          // The scoped wrapper may exit before its independently managed child.
          // Restoration must wait for every registered child to finish draining.
          const children = pending ? await Promise.all(pending.children) : [];
          const incomplete = [...children, commandResult].filter(browserTestNeedsCleanup);
          return incomplete.length ? {
            ...incomplete[0],
            cleanupExecutionIds: [...new Set(incomplete.flatMap(result => result.cleanupExecutionIds || [result.execution?.id]))]
          } : commandResult;
        },
        withTarget: (targetId, operation, validate) => withTestApproval(sessionId, input, options, targetId, operation, validate)
      });
      if (browserTestNeedsCleanup(result)) {
        result = { ...result, previewRecoveryRequired: true };
        if (pending) pending.state = "cleanup_required";
      }
      return result;
    } catch (error) {
      result = responseError(error.message, error.code || "vibe64_managed_playwright_run_failed");
      return result;
    } finally {
      options.signal.removeEventListener("abort", stopping);
      completion.resolve(result);
      if (pending && !result?.previewRecoveryRequired && browserTestRuns.get(sessionId) === pending) {
        browserTestRuns.delete(sessionId);
        await publishSessionChanged(sessionId, { projectSlug: pending.projectSlug });
      }
    }
  }

  return Object.freeze({
    logger,
    authorizeBrowserIdentity,
    testApprovalStatus,
    resumeTestApproval,
    cancelTestApproval,
    browserStart: (sessionId, input) => startRegisteredBrowserWorker(sessionId, input, {
      browserWorkers,
      runCommand: runBrowserCommand,
      stopExecution: stopManagedExecution,
      stopOwnedExecutions
    }),
    browserStop: (sessionId, input) => stopRegisteredBrowserWorkerForInput(sessionId, input, {
      browserWorkers,
      stopExecution: stopManagedExecution,
      stopOwnedExecutions
    }),
    stopBrowsersForSession,
    closeAllForSession,
    playwrightStatus,
    cancelPlaywrightRun,
    playwrightRun,
    registerBrowserWorker,
    releaseControlForSession,
    run
  });
}

function browserWorkerToken({
  commandToken = "",
  generationId = "",
  sessionId = ""
} = {}) {
  return crypto
    .createHash("sha256")
    .update([
      "vibe64-preview-browser",
      normalizeText(sessionId),
      normalizeText(generationId),
      normalizeText(commandToken)
    ].join("\n"))
    .digest("hex");
}

async function prepareAgentPreviewCommand({
  browserIdleTimeoutMs = DEFAULT_PREVIEW_BROWSER_IDLE_TIMEOUT_MS,
  browserSuspendAfterMs = DEFAULT_PREVIEW_BROWSER_SUSPEND_AFTER_MS,
  browserControlHealthFailureLimit = 4,
  browserControlHealthIntervalMs = 15_000,
  commandService,
  env = process.env,
  project = {},
  sessionId = "",
  worktreePath = "",
  wrapperHostDir = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!commandService || !normalizedSessionId || !normalizedWrapperHostDir) {
    return {
      env: {},
      ok: false
    };
  }
  const packRoot = runtimePackRoot();
  // Without runtime packs, the browser runs on this server's Node.js and the
  // project's own Playwright.
  const [nodeBinDir] = packRoot
    ? runtimePackBinPaths("node26")
    : [path.dirname(process.execPath)];
  const managedNodePath = packRoot ? path.join(nodeBinDir, "node") : process.execPath;
  const managedNpmPath = path.join(nodeBinDir, "npm");
  const normalizedWorktreePath = path.resolve(normalizeText(worktreePath) || process.cwd());
  const workerScriptPath = browserWorkerHostPath(normalizedWrapperHostDir);
  const playwrightModulePath = packRoot
    ? path.join(packRoot, "playwright", "runtime", "lib", "node_modules", "playwright")
    : "";
  const browserSocketPath = unixCommandSocketPath(
    path.join(normalizedWrapperHostDir, AGENT_PREVIEW_BROWSER_SOCKET_NAME), { env }
  );
  const controlSocketPath = unixCommandSocketPath(
    path.join(normalizedWrapperHostDir, AGENT_PREVIEW_COMMAND_SOCKET_NAME), { env }
  );
  await writeWrapper({
    agentPlaywrightSource: agentPlaywrightCommandSource({
      managedNodePath,
      managedPreviewPath: wrapperHostPath(normalizedWrapperHostDir),
      runtimeRoot: packRoot
    }),
    browserWorkerSource: agentPreviewBrowserWorkerSource({
      contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      controlHealthFailureLimit: browserControlHealthFailureLimit,
      controlHealthIntervalMs: browserControlHealthIntervalMs,
      identityControlPath: PREVIEW_IDENTITY_CONTROL_PATH,
      idleTimeoutMs: browserIdleTimeoutMs,
      playwrightModulePath,
      playwrightProjectRoot: normalizedWorktreePath,
      suspendAfterMs: browserSuspendAfterMs
    }),
    previewWrapperSource: agentPreviewWrapperSource({
      browserSocketPath,
      contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      managedNodePath,
      workerScriptPath
    }),
    wrapperHostDir: normalizedWrapperHostDir
  });
  const server = await commandServers.ensure({
    commandService,
    sessionId: normalizedSessionId,
    socketPath: controlSocketPath
  });
  const token = browserWorkerToken({
    commandToken: server.token,
    generationId: server.generationId,
    sessionId: normalizedSessionId
  });
  const workerDescriptor = {
    contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
    controlGenerationId: server.generationId,
    controlSocketPath,
    env: {
      [VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV]: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV]: controlSocketPath,
      [VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV]: server.token,
      [VIBE64_PREVIEW_BROWSER_WORKER_TOKEN_ENV]: token
    },
    managedNodePath,
    managedNpmPath,
    playwrightWrapperPath: agentPlaywrightHostPath(normalizedWrapperHostDir),
    metadataPath: browserMetadataHostPath(normalizedWrapperHostDir),
    project: isRecord(project) ? project : {},
    runtimeRoot: packRoot,
    socketPath: browserSocketPath,
    token,
    workerScriptPath,
    worktreePath: normalizedWorktreePath
  };
  commandService.registerBrowserWorker(normalizedSessionId, workerDescriptor);
  return {
    controlGenerationId: server.generationId,
    env: {
      [VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV]: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV]: controlSocketPath,
      [VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV]: server.token
    },
    hostBrowserMetadataPath: workerDescriptor.metadataPath,
    hostBrowserSocketPath: workerDescriptor.socketPath,
    hostBrowserWorkerPath: workerScriptPath,
    hostPlaywrightWrapperPath: agentPlaywrightHostPath(normalizedWrapperHostDir),
    hostSocketPath: controlSocketPath,
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  AGENT_PLAYWRIGHT_COMMAND_NAME,
  AGENT_PREVIEW_COMMAND_NAME,
  VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV,
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
};
