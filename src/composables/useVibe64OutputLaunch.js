import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64OutputRunPath,
  vibe64OutputRunStopPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { vibe64ProjectScopedStorageKey } from "@/lib/vibe64ProjectScope.js";
import { launchStatusAgentWriteBusy } from "@/lib/vibe64LaunchStatus.js";
import { writeLaunchAutoStartAttempt } from "@/lib/vibe64LaunchAutoStart.js";
import { followLaunchStart, launchStartAnswerHeld, newLaunchStartId } from "@/lib/vibe64LaunchStart.js";
import { workAnswerLost } from "@/lib/vibe64SessionWorkOutcome.js";
import { usePlannedRestart } from "@/composables/usePlannedRestart.js";

const TERMINAL_STOP_POLL_INTERVAL_MS = 100;
const TERMINAL_STOP_POLL_ATTEMPTS = 50;

function delay(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Starting, stopping, restarting and closing the session's outputs, with the
 * parameters a target needs. A refused start keeps its error and the
 * admission it was refused by. `autoStartKey` names the automatic start that
 * is settled: a start that succeeded or one refused for a reason retrying
 * would not change. A running, ready Preview clears the last start failure.
 * @param {{
 *   busy: unknown,
 *   embeddedPreview: unknown,
 *   outputs: import("@/types.js").Vibe64OutputStatus,
 *   outputTerminal: import("@/types.js").Vibe64OutputTerminal,
 *   projectSlug: import("vue").Ref<string>
 * }} options
 */
/** Whether a start was refused because the host's planned restart is near. */
function launchRefusedForRestart(error) {
  return [error?.code, error?.response?.code, error?.response?.errors?.[0]?.code].includes("vibe64_planned_restart");
}

function useVibe64OutputLaunch({ busy, embeddedPreview, outputs, outputTerminal, projectSlug }) {
  const {
    canLoadOutputs,
    launchScopeKey,
    previewState,
    refresh,
    sessionId,
    sessionsApiPath,
    status,
    workspacePreparing
  } = outputs;
  const {
    activeOutputTarget,
    activeOutputTargetId,
    activeTerminal,
    applyLaunchTerminalSession,
    clearStaleLaunchTerminal,
    connectLaunchTerminal,
    terminal,
    terminalCanClose,
    terminalCanStop,
    terminalExpanded,
    terminalIndicatorState,
    terminalIsRunning
  } = outputTerminal;
  const { terminalMetadata, terminalSessionId } = terminal;
  const operationBusy = ref(false);
  const launchError = ref("");
  const plannedRestart = usePlannedRestart();
  // A start the host's planned restart paused says until when, and the words go when the window ends.
  const pausedByRestart = ref(false);
  const refusedAdmissionId = ref("");
  const launchStarting = ref(false);
  const launchWaiting = ref(false);
  // What a start the server holds waits for, in words, while the page follows it.
  const launchStartWaiting = ref("");
  const autoStartKey = ref("");
  let disposed = false;

  const startTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64OutputRunPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      ...vibe64RealtimeOriginPayload(),
      ...(context.automatic === true ? { automatic: true } : {}),
      ...(context.forceRestart === true ? { forceRestart: true } : {}),
      ...(context.outputParameters === undefined ? {} : { outputParameters: context.outputParameters }),
      outputTargetId: String(context.outputTargetId || ""),
      replacesTerminalSessionId: String(context.replacesTerminalSessionId || ""),
      startId: String(context.startId || "")
    }),
    fallbackRunError: "Output target could not be started.",
    messages: {
      error: "Output target could not be started."
    },
    onRunError(error) {
      // Startup failures belong to the preview, including automatic attempts.
      // Rethrow before useCommand also presents them as action-feedback toasts.
      // A lost answer is never presented: the page follows the start instead.
      if (readRefOrGetterValue(embeddedPreview) || workAnswerLost(error)) {
        throw error;
      }
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.output-target.start",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const stopTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64OutputRunStopPath(sessionsApiPath.value, context.sessionId, context.terminalSessionId)
    }),
    fallbackRunError: "Output target could not be stopped.",
    messages: {
      error: "Output target could not be stopped."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.output-target.stop",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const closeTerminalCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      path: vibe64OutputRunPath(sessionsApiPath.value, context.sessionId, context.terminalSessionId)
    }),
    fallbackRunError: "Output target terminal could not close.",
    messages: {
      error: "Output target terminal could not close."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.output-target.close",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  const resourceAdmissionId = computed(() => ["ready", "starting"].includes(previewState.value) ? ""
    : refusedAdmissionId.value || String(status.value.resourceAdmissionId || ""));
  const terminalCanRetry = computed(() => Boolean(
    !terminalIsRunning.value &&
    activeOutputTargetId.value
  ));
  const terminalCanRestart = computed(() => Boolean(
    terminalCanStop.value &&
    activeOutputTargetId.value
  ));
  const launchButtonsDisabled = computed(() => Boolean(
    workspacePreparing.value ||
    readRefOrGetterValue(busy) ||
    operationBusy.value ||
    terminalIsRunning.value
  ));

  function parameterStorageKey(target) {
    return vibe64ProjectScopedStorageKey(`vibe64.output-parameters.${target.id}`, projectSlug.value);
  }

  function parametersRemembered(target) {
    return readLocalStorageJson(parameterStorageKey(target), null) !== null;
  }

  function rememberParameters(target, values, remember) {
    writeLocalStorageJson(parameterStorageKey(target), remember ? values : null);
  }

  function parametersForTarget(target) {
    const metadata = terminalMetadata.value.outputTargetId === target.id
      ? terminalMetadata.value
      : activeTerminal.value?.metadata;
    const saved = status.value.lastOutputTarget;
    const values = (metadata?.outputTargetId === target.id ? metadata.outputParameters : null)
      || (saved?.id === target.id ? saved.outputParameters : null)
      || readLocalStorageJson(parameterStorageKey(target), {}) || {};
    return Object.fromEntries((target.parameters || []).map((parameter) => [
      parameter.id,
      typeof values[parameter.id] === "string" ? values[parameter.id] : parameter.default
    ]));
  }

  /**
   * Follows a start the server holds, or one whose answer was lost, through the outputs read until it ends, saying
   * what it waits for (`launchStartWaiting`), and returns its run, or null once the page moved on. A start that did
   * not run throws its refusal in words, with the admission it was refused by.
   */
  async function followHeldStart(held, scopeKey) {
    const following = new AbortController();
    const stopWhenMoved = watch(launchScopeKey, (key) => {
      if (key !== scopeKey) following.abort();
    });
    try {
      const outcome = await followLaunchStart(held, {
        async read() {
          await refresh({ scopeKey });
          return status.value.launchStarts;
        },
        signal: following.signal,
        waiting(label) {
          launchStartWaiting.value = label;
        }
      });
      if (!outcome || disposed) return null;
      if (!outcome.ok) {
        throw Object.assign(new Error(outcome.error), {
          code: outcome.code || "",
          details: outcome.admissionId ? { admission: { id: outcome.admissionId } } : {}
        });
      }
      const running = status.value.activeTerminal;
      return running?.id === outcome.terminalSessionId ? running : { ok: true, id: outcome.terminalSessionId };
    } finally {
      stopWhenMoved();
      launchStartWaiting.value = "";
    }
  }

  /**
   * Starts a target. The start names the run this tab shows, or none, so the server returns a run another
   * start began meanwhile instead of replacing it; `automatic` marks a start the person did not ask for. It names
   * itself (`startId`): one that waits answers as starting and the page follows it, and so does one whose answer
   * was lost on the way.
   */
  async function run(outputTarget = {}, {
    applyDefaultDisplay = true,
    autoStartAttemptKey = "",
    automatic = false,
    forceRestart = false,
    ignoreExternalBusy = false,
    outputParameters
  } = {}) {
    const externalBusy = readRefOrGetterValue(busy);
    const currentSessionId = sessionId.value;
    const startedScopeKey = launchScopeKey.value;
    if (
      !currentSessionId ||
      !canLoadOutputs.value ||
      operationBusy.value ||
      (!forceRestart && terminalIsRunning.value) ||
      (!forceRestart && !ignoreExternalBusy && externalBusy) ||
      outputTarget.available === false ||
      !outputTarget.id
    ) {
      return false;
    }
    if (applyDefaultDisplay) {
      terminalExpanded.value = false;
    }
    launchStarting.value = true;
    launchWaiting.value = false;
    launchError.value = "";
    operationBusy.value = true;
    refusedAdmissionId.value = "";
    const normalizedAutoStartAttemptKey = String(autoStartAttemptKey || "").trim();
    if (normalizedAutoStartAttemptKey) {
      writeLaunchAutoStartAttempt(normalizedAutoStartAttemptKey);
    }
    try {
      const parameters = outputTarget.parameters?.length
        ? outputParameters || parametersForTarget(outputTarget)
        : undefined;
      const missing = outputTarget.parameters?.find((parameter) => parameter.required && !parameters[parameter.id]?.trim());
      if (missing) throw new Error(`${missing.label} is required. Open Preview options to set it.`);
      const startId = newLaunchStartId();
      let terminalSession;
      try {
        terminalSession = await startTerminalCommand.run({
          automatic: automatic === true || Boolean(normalizedAutoStartAttemptKey),
          forceRestart,
          ...(parameters ? { outputParameters: parameters } : {}),
          outputTargetId: outputTarget.id,
          replacesTerminalSessionId: terminalSessionId.value || "",
          sessionId: currentSessionId,
          startId
        });
      } catch (error) {
        if (!workAnswerLost(error)) throw error;
        terminalSession = { ok: true, starting: true, startId, waitingFor: "unconfirmed" };
      }
      if (launchStartAnswerHeld(terminalSession)) {
        terminalSession = await followHeldStart(terminalSession, startedScopeKey);
        if (!terminalSession) return false;
      }
      if (
        disposed ||
        startedScopeKey !== launchScopeKey.value ||
        !canLoadOutputs.value
      ) {
        return false;
      }
      applyLaunchTerminalSession(terminalSession);
      void connectLaunchTerminal();
      void refresh({
        scopeKey: startedScopeKey
      });
      return true;
    } catch (error) {
      if (disposed || startedScopeKey !== launchScopeKey.value) {
        return false;
      }
      if (normalizedAutoStartAttemptKey) {
        if (launchStatusAgentWriteBusy(error)) {
          launchWaiting.value = previewState.value !== "ready";
          void refresh({ scopeKey: startedScopeKey }).catch(() => null);
          return false;
        }
        // Only a confirmed admission conflict is safe to retry automatically.
        autoStartKey.value = normalizedAutoStartAttemptKey;
      }
      pausedByRestart.value = plannedRestart.active.value && launchRefusedForRestart(error);
      launchError.value = pausedByRestart.value ? plannedRestart.pausedLabel.value : String(
        error?.message || startTerminalCommand.message || "Output target could not be started."
      ).trim();
      refusedAdmissionId.value = String(error?.details?.admission?.id || "");
      return false;
    } finally {
      launchStarting.value = false;
      operationBusy.value = false;
    }
  }

  async function acceptResourceRetry(result = {}) {
    if (result.ok === false) return;
    refusedAdmissionId.value = "";
    launchError.value = "";
    if (applyLaunchTerminalSession(result)) void connectLaunchTerminal();
    // A replay has no terminal payload. Read the existing start; never run it again.
    await refresh();
  }

  async function stopTerminal() {
    if (!sessionId.value || !terminalSessionId.value) {
      return false;
    }
    operationBusy.value = true;
    try {
      const stopped = await stopTerminalCommand.run({
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      applyLaunchTerminalSession(stopped);
      await refresh();
      return await waitForStoppedTerminal();
    } catch (error) {
      launchError.value = String(error?.message || "Preview could not be stopped.");
      await refresh();
      return false;
    } finally {
      operationBusy.value = false;
    }
  }

  async function waitForStoppedTerminal() {
    for (let attempt = 0; attempt < TERMINAL_STOP_POLL_ATTEMPTS; attempt += 1) {
      if (!terminalIsRunning.value) {
        return true;
      }
      await delay(TERMINAL_STOP_POLL_INTERVAL_MS);
      await refresh();
    }
    return false;
  }

  async function restartTerminal() {
    if (!terminalCanRestart.value) {
      return false;
    }
    const target = activeOutputTarget.value;
    if (!target) {
      return false;
    }
    return run(target, {
      applyDefaultDisplay: false,
      forceRestart: true
    });
  }

  async function retryTerminal() {
    if (!terminalCanRetry.value) {
      return false;
    }
    const target = activeOutputTarget.value;
    return target ? run(target, {
      applyDefaultDisplay: false
    }) : false;
  }

  async function closeTerminal() {
    if (!sessionId.value || !terminalCanClose.value) {
      return false;
    }
    operationBusy.value = true;
    try {
      await closeTerminalCommand.run({
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      clearStaleLaunchTerminal();
      terminalExpanded.value = false;
      await refresh();
      return true;
    } catch {
      return false;
    } finally {
      operationBusy.value = false;
    }
  }

  /** The project or session changed: its launch outcome no longer applies. */
  function resetLaunch() {
    autoStartKey.value = "";
    launchError.value = "";
    refusedAdmissionId.value = "";
    launchWaiting.value = false;
  }

  watch(() => plannedRestart.active.value, (active) => {
    if (active || !pausedByRestart.value) return;
    pausedByRestart.value = false;
    launchError.value = "";
  });

  watch([previewState, terminalIndicatorState, launchError], ([state, indicator]) => {
    if (state === "ready" && indicator === "running") {
      launchError.value = "";
      refusedAdmissionId.value = "";
      launchWaiting.value = false;
    }
  });

  onBeforeUnmount(() => {
    disposed = true;
  });

  return {
    acceptResourceRetry,
    autoStartKey,
    closeTerminal,
    launchButtonsDisabled,
    launchError,
    launchStartWaiting,
    launchStarting,
    launchWaiting,
    operationBusy,
    parametersForTarget,
    parametersRemembered,
    rememberParameters,
    resetLaunch,
    resourceAdmissionId,
    restartTerminal,
    retryTerminal,
    run,
    stopTerminal,
    terminalCanRestart,
    terminalCanRetry
  };
}

export {
  useVibe64OutputLaunch
};
