import { isDeepStrictEqual } from "node:util";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { vibe64Result } from "./terminalShared.js";
import { launchPrepareUnfinished, launchTerminalIsRunning } from "./launchPreviewReadiness.js";
import { latestLaunchTerminal } from "./launchPreviewStatus.js";
import { WEB_LAUNCH_READINESS_TIMEOUT_SECONDS } from "./launchTargetTerminal.js";
import { cleanupSupersededLaunchTerminals, replacedLaunchTerminals } from "./outputTargetLaunchTerminals.js";

/** @typedef {import("./types.js").OutputTargetLaunchCoordination} OutputTargetLaunchCoordination */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

// What a Preview start is asked with, and what it does with the session's running run before it starts its own:
// returns it, waits for its Prepare steps, or replaces it.

// A start's answer, inside the launch lock, that the workspace preparation runs: the start waits for it outside.
const PREPARING = Symbol("preparing");
// A start's answer, inside the launch lock, that the run it would replace is in its target's Prepare steps: the start
// waits for them outside.
const PREPARE_RUNNING = Symbol("prepare-running");
// Prepare steps declare no time limit of their own, so a restart waits for them at most as long as a Preview start may
// already take to become ready, then replaces the run anyway: a restart ends in a run or a clear failure, never parked.
const PREPARE_WAIT_MS = WEB_LAUNCH_READINESS_TIMEOUT_SECONDS * 1000;

/**
 * What a start records of the request that made it: in the workflow it starts, its diagnostics and the log line of
 * each run it replaces. `requestedBy` names who asks: `http`, `assistant-tool`, `agent-preview-command`,
 * `workspace-setup`, `usage-recording` or `preview-test`.
 * @param {object} input the start's input, with the `requestId` and `requestedAt` its start took before the lock
 * @param {boolean} [forceRestart] whether the start replaces a running run of its target
 */
function launchRequest(input, forceRestart = input.forceRestart === true) {
  return {
    id: input.requestId,
    requestedAt: input.requestedAt,
    ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
    automatic: input.automatic === true,
    forceRestart,
    restartPreview: input.restartPreview === true,
    ...(input.replacesTerminalSessionId !== undefined
      ? { replacesTerminalSessionId: normalizeText(input.replacesTerminalSessionId) }
      : {})
  };
}

/**
 * Why a start returns the session's running run as it is, or "" when it does not. A start decided from what a view
 * showed names the run it saw, "" when it saw none; an automatic one that names none saw none. Another run starting
 * or running now means that view is out of date (`start_kept_running`). The restart after setup is deliberate. A
 * restart is satisfied by a run of what it asks for that started after it was asked for, another restart's or
 * setup's (`restart_satisfied`): two restarts close together give one run, and one asked for after a run started
 * replaces it.
 * @param {object} input the start's input
 * @param {object | null} terminal the session's latest launch terminal
 */
function keptRunReason(input, terminal) {
  if (!terminal || !launchTerminalIsRunning(terminal)) return "";
  const seenTerminalId = input.replacesTerminalSessionId ??
    (input.automatic === true && input.restartPreview !== true ? "" : undefined);
  if (seenTerminalId !== undefined) return terminal.id !== normalizeText(seenTerminalId) ? "start_kept_running" : "";
  const satisfied = (input.restartPreview === true || input.forceRestart === true) &&
    String(terminal.createdAt || "") >= input.requestedAt &&
    (!input.outputTargetId || terminal.metadata?.outputTargetId === normalizeText(input.outputTargetId)) &&
    (input.outputParameters === undefined ||
      isDeepStrictEqual(input.outputParameters, terminal.metadata?.outputParameters || {}));
  return satisfied ? "restart_satisfied" : "";
}

/**
 * The running run a restart waits for before it replaces it, "" when none. A restart never cuts a run's Prepare
 * steps (a migration, a seed) part way: it waits for them outside the launch lock, once per run. Stop stays
 * immediate.
 * @param {string} sessionId
 * @param {boolean} forceRestart whether the start replaces the running run
 * @param {Set<string>} preparesWaited the runs whose Prepare steps the start already waited for
 */
function prepareToWaitFor(sessionId, forceRestart, preparesWaited) {
  const terminal = forceRestart ? latestLaunchTerminal(sessionId) : null;
  return terminal && launchTerminalIsRunning(terminal) && launchPrepareUnfinished(terminal) &&
    !preparesWaited.has(terminal.id) ? terminal.id : "";
}

/**
 * Closes the session's running runs a start replaces, every one but `reusableTerminal`. Each closes naming the start
 * (`superseded:<its request id>`), is logged once at warn level and goes into the start's request (`replaced`), with
 * whether it was cut in its Prepare steps (a restart that waited for them as long as it may).
 * @param {object} input
 * @param {object} input.launchPreviewProxies
 * @param {RuntimeLogger} input.logger
 * @param {string} input.namespace
 * @param {string} input.outputTargetId
 * @param {ReturnType<typeof launchRequest> & { replaced?: object[] }} input.request
 * @param {object | null} input.reusableTerminal
 * @param {string} input.sessionId
 */
async function replaceRunningRuns({
  launchPreviewProxies,
  logger,
  namespace,
  outputTargetId,
  request,
  reusableTerminal,
  sessionId
}) {
  const replacedRuns = replacedLaunchTerminals(namespace, reusableTerminal).map((replaced) => ({
    prepareCut: launchPrepareUnfinished(replaced),
    terminalSessionId: replaced.id,
    startedAt: replaced.createdAt,
    workflowId: normalizeText(replaced.metadata?.resourceWorkflowId)
  }));
  for (const replaced of replacedRuns) {
    logOperationalEvent(logger, "warn", {
      component: "vibe64.preview",
      event: "vibe64.preview.run_replaced",
      outputTargetId,
      replaced,
      request,
      sessionId
    }, "A Preview start replaced the session's running output.");
  }
  if (replacedRuns.length > 0) request.replaced = replacedRuns;
  await cleanupSupersededLaunchTerminals({
    launchPreviewProxies,
    namespace,
    reason: `superseded:${request.id}`,
    reusableTerminal,
    sessionId
  });
}

/**
 * Watches a run's output, in what just arrived, for the line its last Prepare step prints once they succeeded
 * (`outputPrepareMarker`), and records it once (`launchPrepareFinished`).
 * @param {string} [marker]
 * @returns {(event: { chunk: string, output: string, updateMetadata: (metadata: object) => void }) => void}
 */
function prepareFinishedWatch(marker = "") {
  const line = String(marker || "").trim();
  let seen = !line;
  return ({ chunk, output, updateMetadata }) => {
    if (seen || !output.slice(-(chunk.length + line.length)).includes(line)) return;
    seen = true;
    updateMetadata({ launchPrepareFinished: true });
  };
}

/**
 * Starts an output target once the session's workspace is prepared. A start waits for a running preparation outside
 * the session's launch lock, so the session's other Preview requests answer meanwhile, then starts again from its
 * checks without asking for another. A Stop or a close meanwhile, or while the start holds the lock, ends it
 * unstarted at its next step. A restart whose run to replace is in its target's Prepare steps waits for them the
 * same way, once per run and at most `prepareWaitMs`, and its run then says so (`waitedForPrepare`). `stage` names
 * what it waits on: `launch-queue` (the lock), `workspace-preparation`, `prepare-step`, then `starting`.
 * @param {OutputTargetLaunchCoordination} launchCoordination
 * @param {(sessionId: string, input: object, controls: object) => Promise<any>} startOnce
 * @param {string} sessionId
 * @param {object} input
 * @param {(name: string) => void} stage
 * @param {number} prepareWaitMs
 */
async function startWhenPrepared(launchCoordination, startOnce, sessionId, input, stage, prepareWaitMs) {
  const interruptions = launchCoordination.launchInterruptions(sessionId);
  let prepared = false;
  // The runs whose Prepare steps this start waited for.
  const preparesWaited = new Set();
  for (;;) {
    stage("launch-queue");
    const attempt = await startOnce(sessionId, input, { interruptions, prepared, preparesWaited, stage });
    if (attempt?.[PREPARE_RUNNING]) {
      stage("prepare-step");
      preparesWaited.add(attempt[PREPARE_RUNNING]);
      await launchCoordination.waitForLaunchPrepare(sessionId, attempt[PREPARE_RUNNING], prepareWaitMs, interruptions);
      const interrupted = launchCoordination.launchInterruptedSince(sessionId, interruptions, "prepare-step");
      if (interrupted) return interrupted;
      continue;
    }
    if (!attempt?.[PREPARING]) {
      return preparesWaited.size > 0 && attempt?.ok !== false ? { ...attempt, waitedForPrepare: true } : attempt;
    }
    stage("workspace-preparation");
    let failure;
    try {
      failure = await attempt[PREPARING].then(() => null, error => error);
    } finally {
      attempt.admission.release();
    }
    if (failure) return vibe64Result(() => Promise.reject(failure));
    const interrupted = launchCoordination.launchInterruptedSince(sessionId, interruptions);
    if (interrupted) return interrupted;
    prepared = true;
  }
}

/**
 * The managed Preview's ensure and restart requests, each a start that names who asks (`requestedBy`).
 * @param {(sessionId: string, input: object) => Promise<any>} startTerminal
 */
function managedPreviewRequests(startTerminal) {
  /** @param {{ outputTargetId?: string, requestedBy?: string }} [input] */
  function ensurePreview(sessionId, input = {}) {
    return startTerminal(sessionId, {
      outputTargetId: input.outputTargetId,
      ensurePreview: true,
      requestedBy: input.requestedBy
    });
  }

  /** @param {{ requestedBy?: string }} [input] who asks: `agent-preview-command` for the agent's command */
  function restartPreview(sessionId, { requestedBy } = {}) {
    return startTerminal(sessionId, {
      restartPreview: true,
      requestedBy
    });
  }

  /**
   * A managed Preview whose process started before the session's workspace
   * setup finished restarts, so it runs on what that setup installed. One
   * started after it, a stopped Preview and other outputs are left alone.
   * @param {string} sessionId
   * @param {{ finishedAt: string }} setup the setup that succeeded
   */
  function restartPreviewAfterWorkspaceSetup(sessionId, { finishedAt }) {
    return startTerminal(sessionId, {
      automatic: true,
      requestedBy: "workspace-setup",
      restartIfStartedBefore: finishedAt,
      restartPreview: true
    });
  }

  return { ensurePreview, restartPreview, restartPreviewAfterWorkspaceSetup };
}

export {
  PREPARE_RUNNING,
  PREPARE_WAIT_MS,
  PREPARING,
  keptRunReason,
  launchRequest,
  managedPreviewRequests,
  prepareFinishedWatch,
  prepareToWaitFor,
  replaceRunningRuns,
  startWhenPrepared
};
