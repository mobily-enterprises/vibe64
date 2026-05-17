import { computed, onBeforeUnmount, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";
import {
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/aiStudioRequestConfig.js";
import {
  TARGET_SCRIPT_TERMINAL_API_SUFFIX,
  TARGET_SCRIPTS_API_SUFFIX,
  targetScriptTerminalWebSocketUrl,
  targetScriptsQueryKey
} from "@/lib/targetScriptsRequestConfig.js";

function commandErrorMessage(command) {
  return command.messageType === "error" ? String(command.message || "") : "";
}

function useTargetScripts() {
  const paths = usePaths();
  const starBusyName = ref("");
  const runBusyName = ref("");
  const terminalVisible = ref(false);
  const currentTerminalScriptName = ref("");

  const targetScriptsApiPath = computed(() => paths.api(TARGET_SCRIPTS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));
  const targetScriptTerminalApiPath = computed(() => paths.api(TARGET_SCRIPT_TERMINAL_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));

  const scriptList = useList({
    access: "never",
    apiSuffix: TARGET_SCRIPTS_API_SUFFIX,
    fallbackLoadError: "Target scripts could not be loaded.",
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.target-scripts.list",
    queryKeyFactory: targetScriptsQueryKey,
    selectItems: (payload) => Array.isArray(payload?.scripts) ? payload.scripts : [],
    surfaceId: AI_STUDIO_SURFACE_ID
  });

  const saveStarredCommand = useCommand({
    access: "never",
    apiSuffix: TARGET_SCRIPTS_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "PUT",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: `${targetScriptsApiPath.value}/starred`
    }),
    buildRawPayload: (_model, { context }) => ({
      scriptNames: Array.isArray(context.scriptNames) ? context.scriptNames : []
    }),
    fallbackRunError: "Could not update starred target scripts.",
    messages: {
      error: "Could not update starred target scripts."
    },
    onRunSuccess: async () => {
      await refreshScripts();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.target-scripts.starred.save",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "PUT"
  });

  const resetStarredCommand = useCommand({
    access: "never",
    apiSuffix: TARGET_SCRIPTS_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "DELETE",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: `${targetScriptsApiPath.value}/starred`
    }),
    fallbackRunError: "Could not reset starred target scripts.",
    messages: {
      error: "Could not reset starred target scripts."
    },
    onRunSuccess: async () => {
      await refreshScripts();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.target-scripts.starred.reset",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "DELETE"
  });

  const startTerminalCommand = useCommand({
    access: "never",
    apiSuffix: TARGET_SCRIPT_TERMINAL_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: targetScriptTerminalApiPath.value
    }),
    buildRawPayload: (_model, { context }) => ({
      scriptName: String(context.scriptName || "")
    }),
    fallbackRunError: "Target script terminal failed to start.",
    messages: {
      error: "Target script terminal failed to start."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.target-scripts.terminal.start",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const closeTerminalCommand = useCommand({
    access: "never",
    apiSuffix: TARGET_SCRIPT_TERMINAL_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: `${targetScriptTerminalApiPath.value}/${encodeURIComponent(String(context.terminalSessionId || ""))}`
    }),
    fallbackRunError: "Target script terminal could not close.",
    messages: {
      error: "Target script terminal could not close."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.target-scripts.terminal.close",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "DELETE"
  });

  const terminal = useStudioTerminal({
    webSocketUrl(terminalSessionId) {
      return targetScriptTerminalWebSocketUrl(terminalSessionId);
    }
  });

  const latestScriptsPayload = computed(() => {
    return Array.isArray(scriptList.pages) && scriptList.pages.length > 0 ? scriptList.pages[0] : {};
  });
  const scripts = computed(() => Array.isArray(scriptList.items) ? scriptList.items : []);
  const scriptByName = computed(() => new Map(scripts.value.map((script) => [script.name, script])));
  const starredScriptNames = computed(() => {
    return Array.isArray(latestScriptsPayload.value?.starredScriptNames)
      ? latestScriptsPayload.value.starredScriptNames
      : [];
  });
  const starredSet = computed(() => new Set(starredScriptNames.value));
  const starredScripts = computed(() => {
    return starredScriptNames.value
      .map((scriptName) => scriptByName.value.get(scriptName))
      .filter(Boolean);
  });
  const otherScripts = computed(() => {
    return scripts.value.filter((script) => !starredSet.value.has(script.name));
  });
  const scriptSections = computed(() => [
    {
      ariaLabel: "Starred target scripts",
      id: "starred",
      label: "Starred",
      showLabel: otherScripts.value.length > 0,
      scripts: starredScripts.value
    },
    {
      ariaLabel: "Other target scripts",
      id: "other-scripts",
      label: "Other scripts",
      showLabel: true,
      scripts: otherScripts.value
    }
  ].filter((section) => section.scripts.length > 0));

  const canRetry = computed(() => {
    return terminal.terminalExited.value &&
      terminal.terminalExitCode.value !== 0 &&
      Boolean(currentTerminalScriptName.value);
  });
  const loading = computed(() => Boolean(scriptList.isLoading));
  const resetBusy = computed(() => Boolean(resetStarredCommand.isRunning));
  const loadError = computed(() => String(
    scriptList.loadError ||
    commandErrorMessage(saveStarredCommand) ||
    commandErrorMessage(resetStarredCommand) ||
    commandErrorMessage(startTerminalCommand) ||
    commandErrorMessage(closeTerminalCommand) ||
    ""
  ));

  function isStarred(scriptName) {
    return starredSet.value.has(scriptName);
  }

  function isStarBusy(scriptName) {
    return starBusyName.value === scriptName;
  }

  async function refreshScripts() {
    await scriptList.reload();
  }

  async function toggleStar(script) {
    const scriptName = String(script?.name || "");
    if (!scriptName || starBusyName.value) {
      return;
    }
    starBusyName.value = scriptName;
    try {
      const nextScriptNames = isStarred(scriptName)
        ? starredScriptNames.value.filter((name) => name !== scriptName)
        : [...starredScriptNames.value, scriptName];
      await saveStarredCommand.run({
        scriptNames: nextScriptNames
      });
    } catch {
      // useCommand owns the user-visible error message.
    } finally {
      starBusyName.value = "";
    }
  }

  async function resetStarred() {
    if (resetBusy.value) {
      return;
    }
    try {
      await resetStarredCommand.run();
    } catch {
      // useCommand owns the user-visible error message.
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
    const scriptName = String(script?.name || "");
    if (!scriptName || runBusyName.value) {
      return false;
    }
    runBusyName.value = scriptName;
    terminal.terminalStarting.value = true;
    terminalVisible.value = true;
    currentTerminalScriptName.value = scriptName;
    terminal.terminalError.value = "";
    try {
      await closeRunningTerminalOnly();
      terminal.resetTerminalSessionState();
      terminal.resetTerminalDisplay();
      if (!(await terminal.setupTerminalUi())) {
        throw new Error("Terminal view is not ready yet.");
      }
      const session = await startTerminalCommand.run({
        scriptName
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
      runBusyName.value = "";
    }
  }

  async function retryTerminal() {
    const script = scriptByName.value.get(currentTerminalScriptName.value);
    if (script) {
      await runScript(script);
    }
  }

  async function closeTerminal() {
    await closeRunningTerminalOnly();
    terminal.resetTerminalSessionState();
    terminal.resetTerminalDisplay();
    terminal.disposeTerminalUi();
    currentTerminalScriptName.value = "";
    terminalVisible.value = false;
  }

  onBeforeUnmount(() => {
    void closeRunningTerminalOnly();
    terminal.disposeTerminalUi();
  });

  return {
    canRetry,
    closeTerminal,
    currentTerminalScriptName,
    isStarBusy,
    isStarred,
    loadError,
    loading,
    refreshScripts,
    resetBusy,
    resetStarred,
    retryTerminal,
    runBusyName,
    runScript,
    scriptSections,
    scripts,
    sendCtrlC: terminal.sendCtrlC,
    terminalCommandPreview: terminal.terminalCommandPreview,
    terminalError: terminal.terminalError,
    terminalExited: terminal.terminalExited,
    terminalHost: terminal.terminalHost,
    terminalSessionId: terminal.terminalSessionId,
    terminalStarting: terminal.terminalStarting,
    terminalStatus: terminal.terminalStatus,
    terminalVisible,
    toggleStar
  };
}

export { useTargetScripts };
