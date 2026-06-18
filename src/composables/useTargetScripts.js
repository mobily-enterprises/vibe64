import { computed, onBeforeUnmount, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  TARGET_SCRIPT_TERMINAL_API_SUFFIX,
  TARGET_SCRIPTS_API_SUFFIX,
  targetScriptTerminalWebSocketUrl,
  targetScriptsQueryKey
} from "@/lib/targetScriptsRequestConfig.js";

function useTargetScripts({
  showAllScripts = true
} = {}) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
  const starBusyId = ref("");
  const runBusyId = ref("");
  const terminalVisible = ref(false);
  const currentTerminalScriptId = ref("");
  const currentTerminalScriptLabel = ref("");

  const targetScriptsApiPath = computed(() => paths.api(TARGET_SCRIPTS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const targetScriptTerminalApiPath = computed(() => paths.api(TARGET_SCRIPT_TERMINAL_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));

  const scriptListResource = useEndpointResource({
    fallbackLoadError: "Target scripts could not be loaded.",
    path: targetScriptsApiPath,
    queryKey: computed(() => targetScriptsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    )),
    requestRecoveryLabel: "Target scripts"
  });

  const terminal = useStudioTerminal({
    webSocketUrl(terminalSessionId) {
      return targetScriptTerminalWebSocketUrl(terminalSessionId);
    }
  });

  const saveStarredCommand = useCommand({
    access: "never",
    apiSuffix: TARGET_SCRIPTS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => ({
      scriptIds: Array.isArray(context?.scriptIds) ? context.scriptIds : []
    }),
    buildCommandOptions: () => ({
      method: "PUT",
      path: `${targetScriptsApiPath.value}/starred`
    }),
    fallbackRunError: "Could not update starred target scripts.",
    messages: {
      error: "Could not update starred target scripts."
    },
    onRunSuccess: refreshScripts,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.target-scripts.starred.save",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PUT"
  });

  const resetStarredCommand = useCommand({
    access: "never",
    apiSuffix: TARGET_SCRIPTS_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "DELETE",
      path: `${targetScriptsApiPath.value}/starred`
    }),
    fallbackRunError: "Could not reset starred target scripts.",
    messages: {
      error: "Could not reset starred target scripts."
    },
    onRunSuccess: refreshScripts,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.target-scripts.starred.reset",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  const startTerminalCommand = useCommand({
    access: "never",
    apiSuffix: TARGET_SCRIPT_TERMINAL_API_SUFFIX,
    buildRawPayload: (_model, { context }) => ({
      scriptId: String(context?.scriptId || "")
    }),
    buildCommandOptions: () => ({
      method: "POST",
      path: targetScriptTerminalApiPath.value
    }),
    fallbackRunError: "Target script terminal failed to start.",
    messages: {
      error: "Target script terminal failed to start."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.target-scripts.terminal.start",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const closeTerminalCommand = useCommand({
    access: "never",
    apiSuffix: TARGET_SCRIPT_TERMINAL_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      path: `${targetScriptTerminalApiPath.value}/${encodeURIComponent(String(context?.terminalSessionId || ""))}`
    }),
    fallbackRunError: "Target script terminal could not close.",
    messages: {
      error: "Target script terminal could not close."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.target-scripts.terminal.close",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  const latestScriptsPayload = computed(() => {
    const payload = scriptListResource.data.value;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  });
  const scripts = computed(() => Array.isArray(latestScriptsPayload.value?.scripts) ? latestScriptsPayload.value.scripts : []);
  const scriptById = computed(() => new Map(scripts.value.map((script) => [script.id, script])));
  const fullScriptListVisible = computed(() => unref(showAllScripts) !== false);
  const starredScriptIds = computed(() => {
    return Array.isArray(latestScriptsPayload.value?.starredScriptIds)
      ? latestScriptsPayload.value.starredScriptIds
      : [];
  });
  const starredSet = computed(() => new Set(starredScriptIds.value));
  const starredScripts = computed(() => {
    return starredScriptIds.value
      .map((scriptId) => scriptById.value.get(scriptId))
      .filter(Boolean);
  });
  const otherScripts = computed(() => {
    return scripts.value.filter((script) => !starredSet.value.has(script.id));
  });
  const scriptSections = computed(() => {
    const sections = [{
      ariaLabel: "Starred target scripts",
      id: "starred",
      label: "Starred",
      showLabel: fullScriptListVisible.value && otherScripts.value.length > 0,
      scripts: starredScripts.value
    }];

    if (fullScriptListVisible.value) {
      sections.push({
        ariaLabel: "Other target scripts",
        id: "other-scripts",
        label: "Other scripts",
        showLabel: true,
        scripts: otherScripts.value
      });
    }

    return sections.filter((section) => section.scripts.length > 0);
  });
  const visibleScripts = computed(() => {
    return fullScriptListVisible.value ? scripts.value : starredScripts.value;
  });

  const canRetry = computed(() => {
    return terminal.terminalExited.value &&
      terminal.terminalExitCode.value !== 0 &&
      Boolean(currentTerminalScriptId.value);
  });
  const loading = computed(() => Boolean(scriptListResource.isLoading.value));
  const resetBusy = computed(() => Boolean(resetStarredCommand.isRunning));
  const starBusy = computed(() => Boolean(starBusyId.value));
  const payloadError = computed(() => {
    const payload = latestScriptsPayload.value;
    return payload?.ok === false ? String(payload.error || "Target scripts are not available yet.") : "";
  });
  const loadError = computed(() => String(
    scriptListResource.loadError.value ||
    payloadError.value ||
    commandErrorMessage(saveStarredCommand) ||
    commandErrorMessage(resetStarredCommand) ||
    commandErrorMessage(startTerminalCommand) ||
    commandErrorMessage(closeTerminalCommand) ||
    ""
  ));

  function commandErrorMessage(command = {}) {
    return command.messageType === "error" ? String(command.message || "") : "";
  }

  function isStarred(scriptId) {
    return starredSet.value.has(scriptId);
  }

  function isStarBusy(scriptId) {
    return starBusyId.value === scriptId;
  }

  async function refreshScripts() {
    await scriptListResource.reload();
  }

  async function toggleStar(script) {
    const scriptId = String(script?.id || "");
    if (!scriptId || starBusyId.value) {
      return;
    }
    starBusyId.value = scriptId;
    try {
      const nextScriptIds = isStarred(scriptId)
        ? starredScriptIds.value.filter((id) => id !== scriptId)
        : [...starredScriptIds.value, scriptId];
      await saveStarredCommand.run({
        scriptIds: nextScriptIds
      });
    } catch {
      return;
    } finally {
      starBusyId.value = "";
    }
  }

  async function resetStarred() {
    if (resetBusy.value) {
      return;
    }
    try {
      await resetStarredCommand.run();
    } catch {
      return;
    }
  }

  async function closeRunningTerminalOnly() {
    const existingTerminalId = terminal.terminalSessionId.value;
    terminal.closeTerminalSocket();
    if (existingTerminalId) {
      await closeTerminalCommand.run({
        terminalSessionId: existingTerminalId
      }).catch(() => null);
    }
  }

  async function runScript(script) {
    const scriptId = String(script?.id || "");
    if (!scriptId || runBusyId.value) {
      return false;
    }
    runBusyId.value = scriptId;
    terminal.terminalStarting.value = true;
    terminalVisible.value = true;
    currentTerminalScriptId.value = scriptId;
    currentTerminalScriptLabel.value = String(script?.label || script?.name || scriptId);
    terminal.terminalError.value = "";
    try {
      await closeRunningTerminalOnly();
      terminal.resetTerminalSessionState();
      terminal.resetTerminalDisplay();
      if (!(await terminal.setupTerminalUi())) {
        throw new Error("Terminal view is not ready yet.");
      }
      const session = await startTerminalCommand.run({
        scriptId
      });
      if (!session) {
        return false;
      }
      terminal.applyTerminalSession(session, {
        fallbackStatus: "running"
      });
      await terminal.connectTerminalSocket();
      return true;
    } catch (error) {
      terminal.terminalError.value = String(error?.message || error || "Target script terminal failed to start.");
      return false;
    } finally {
      terminal.terminalStarting.value = false;
      runBusyId.value = "";
    }
  }

  async function retryTerminal() {
    const script = scriptById.value.get(currentTerminalScriptId.value);
    if (script) {
      await runScript(script);
    }
  }

  async function closeTerminal() {
    await closeRunningTerminalOnly();
    terminal.resetTerminalSessionState();
    terminal.resetTerminalDisplay();
    terminal.disposeTerminalUi();
    currentTerminalScriptId.value = "";
    currentTerminalScriptLabel.value = "";
    terminalVisible.value = false;
  }

  onBeforeUnmount(() => {
    void closeRunningTerminalOnly();
    terminal.disposeTerminalUi();
  });

  return {
    canRetry,
    closeTerminal,
    currentTerminalScriptLabel,
    isStarBusy,
    isStarred,
    loadError,
    loading,
    refreshScripts,
    resetBusy,
    resetStarred,
    retryTerminal,
    runBusyId,
    runScript,
    scriptSections,
    scripts,
    sendCtrlC: terminal.sendCtrlC,
    starBusy,
    terminalCommandPreview: terminal.terminalCommandPreview,
    terminalError: terminal.terminalError,
    terminalExited: terminal.terminalExited,
    terminalHost: terminal.terminalHost,
    terminalSessionId: terminal.terminalSessionId,
    terminalStarting: terminal.terminalStarting,
    terminalStatus: terminal.terminalStatus,
    terminalVisible,
    toggleStar,
    visibleScripts
  };
}

export { useTargetScripts };
