import { computed, onBeforeUnmount, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";
import {
  useVibe64WorkspaceSlug
} from "@/composables/useVibe64WorkspaceScope.js";
import {
  VIBE64_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/vibe64RequestConfig.js";
import {
  TARGET_SCRIPT_TERMINAL_API_SUFFIX,
  TARGET_SCRIPTS_API_SUFFIX,
  targetScriptTerminalWebSocketUrl,
  targetScriptsQueryKey
} from "@/lib/targetScriptsRequestConfig.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";

function useTargetScripts({
  showAllScripts = true
} = {}) {
  const paths = usePaths();
  const workspaceSlug = useVibe64WorkspaceSlug();
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
    client: studioHttpClient,
    fallbackLoadError: "Target scripts could not be loaded.",
    path: targetScriptsApiPath,
    queryKey: computed(() => targetScriptsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      workspaceSlug.value
    ))
  });

  const resetStarredRunning = ref(false);
  const saveStarredError = ref("");
  const resetStarredError = ref("");
  const startTerminalError = ref("");
  const closeTerminalError = ref("");

  const terminal = useStudioTerminal({
    webSocketUrl(terminalSessionId) {
      return targetScriptTerminalWebSocketUrl(terminalSessionId);
    }
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
  const resetBusy = computed(() => Boolean(resetStarredRunning.value));
  const starBusy = computed(() => Boolean(starBusyId.value));
  const loadError = computed(() => String(
    scriptListResource.loadError.value ||
    saveStarredError.value ||
    resetStarredError.value ||
    startTerminalError.value ||
    closeTerminalError.value ||
    ""
  ));

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
    saveStarredError.value = "";
    try {
      const nextScriptIds = isStarred(scriptId)
        ? starredScriptIds.value.filter((id) => id !== scriptId)
        : [...starredScriptIds.value, scriptId];
      await studioHttpClient.request(`${targetScriptsApiPath.value}/starred`, {
        ...LOCAL_STUDIO_COMMAND_OPTIONS,
        body: {
          scriptIds: nextScriptIds
        },
        method: "PUT"
      });
      await refreshScripts();
    } catch (error) {
      saveStarredError.value = String(error?.message || error || "Could not update starred target scripts.");
    } finally {
      starBusyId.value = "";
    }
  }

  async function resetStarred() {
    if (resetBusy.value) {
      return;
    }
    resetStarredRunning.value = true;
    resetStarredError.value = "";
    try {
      await studioHttpClient.request(`${targetScriptsApiPath.value}/starred`, {
        ...LOCAL_STUDIO_COMMAND_OPTIONS,
        method: "DELETE"
      });
      await refreshScripts();
    } catch (error) {
      resetStarredError.value = String(error?.message || error || "Could not reset starred target scripts.");
    } finally {
      resetStarredRunning.value = false;
    }
  }

  async function closeRunningTerminalOnly() {
    const existingTerminalId = terminal.terminalSessionId.value;
    terminal.closeTerminalSocket();
    if (existingTerminalId) {
      closeTerminalError.value = "";
      await studioHttpClient.request(`${targetScriptTerminalApiPath.value}/${encodeURIComponent(existingTerminalId)}`, {
        ...LOCAL_STUDIO_COMMAND_OPTIONS,
        method: "DELETE"
      }).catch((error) => {
        closeTerminalError.value = String(error?.message || error || "Target script terminal could not close.");
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
    startTerminalError.value = "";
    try {
      await closeRunningTerminalOnly();
      terminal.resetTerminalSessionState();
      terminal.resetTerminalDisplay();
      if (!(await terminal.setupTerminalUi())) {
        throw new Error("Terminal view is not ready yet.");
      }
      const session = await studioHttpClient.request(targetScriptTerminalApiPath.value, {
        ...LOCAL_STUDIO_COMMAND_OPTIONS,
        body: {
          scriptId
        },
        method: "POST"
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
      startTerminalError.value = terminal.terminalError.value;
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
