import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  useVibe64SourceEditorFileSync
} from "@/composables/useVibe64SourceEditorFileSync.js";
import {
  SOURCE_EDITOR_FILE_MATCH_DELAY_MS,
  SOURCE_EDITOR_SEARCH_DELAY_MS,
  useVibe64SourceEditorDiscovery
} from "@/composables/useVibe64SourceEditorDiscovery.js";
import {
  useVibe64SourceEditorExplanations
} from "@/composables/useVibe64SourceEditorExplanations.js";
import {
  SOURCE_EDITOR_AUTOSAVE_DELAY_MS,
  SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE,
  sourceEditorFileChangePayloadMatches,
  useVibe64SourceEditorFile
} from "@/composables/useVibe64SourceEditorFile.js";
import {
  useVibe64SourceEditorTree
} from "@/composables/useVibe64SourceEditorTree.js";
import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64BrowserTabOriginId
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

/**
 * A session's source editor: its tree, the selected file and its saves, Open
 * file and Find in files, and source explanations. It follows the session,
 * refreshes after the agent's work and other windows' changes, and saves the
 * selected file when it unmounts.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<boolean>} [options.active] Whether the editor is shown; true by default.
 * @param {import("vue").MaybeRefOrGetter<boolean>} [options.agentActive] Whether the agent is working.
 * @param {(navigation: { fromPath: string, path: string, target: string }) => unknown} options.navigateReferencedSource
 *   Resolves true when the host opened a referenced source file itself.
 * @param {import("vue").MaybeRefOrGetter<string>} options.projectSlug
 * @param {() => string} options.readCurrentText The live text of the open file.
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionsApiPath
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionId
 */
function useVibe64SourceEditor({
  active = true,
  agentActive = false,
  navigateReferencedSource,
  projectSlug,
  readCurrentText,
  sessionsApiPath,
  sessionId
}) {
  const originId = vibe64BrowserTabOriginId();
  const selectedPath = ref("");
  const loadFailure = ref(null);
  const loadError = computed(() => loadFailure.value?.message || "");
  const disposed = ref(false);
  let pendingTreeRefresh = false;
  let refreshPromise = null;
  const currentSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const currentSessionId = computed(() => String(readRefOrGetterValue(sessionId) || "").trim());
  const currentProjectSlug = computed(() => String(readRefOrGetterValue(projectSlug) || "").trim());
  const currentActive = computed(() => readRefOrGetterValue(active) !== false);
  const canLoad = computed(() => Boolean(currentSessionsApiPath.value && currentSessionId.value));
  const tree = useVibe64SourceEditorTree({
    canLoad,
    currentActive,
    currentSessionId,
    currentSessionsApiPath,
    disposed,
    loadFailure,
    onRefreshInterrupted: () => {
      pendingTreeRefresh = !disposed.value;
    },
    selectedPath
  });
  const file = useVibe64SourceEditorFile({
    canLoad,
    currentActive,
    currentProjectSlug,
    currentSessionId,
    currentSessionsApiPath,
    disposed,
    loadFailure,
    navigateReferencedSource,
    originId,
    readCurrentText,
    selectedPath,
    tree
  });
  const discovery = useVibe64SourceEditorDiscovery({
    canLoad,
    currentActive,
    currentSessionId,
    currentSessionsApiPath,
    disposed,
    openFile: file.openFile
  });
  const explanations = useVibe64SourceEditorExplanations({
    canLoad,
    currentSessionId,
    currentSessionsApiPath,
    file,
    originId,
    selectedPath
  });
  const statusLabel = computed(() => {
    if (file.saveError.value) {
      return file.saveError.value;
    }
    if (file.loadingFile.value) {
      return "Opening...";
    }
    if (file.saving.value) {
      return "Saving...";
    }
    if (file.dirty.value) {
      return "Unsaved";
    }
    return selectedPath.value ? "Saved" : "";
  });

  useRealtimeEvent({
    enabled: computed(() => Boolean(
      canLoad.value &&
      currentProjectSlug.value
    )),
    event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => (
      (
        payload.operation === "created" &&
        payload.originId !== originId &&
        payload.projectSlug === currentProjectSlug.value &&
        payload.sessionId === currentSessionId.value
      ) ||
      sourceEditorFileChangePayloadMatches({
        originId,
        path: selectedPath.value,
        payload,
        projectSlug: currentProjectSlug.value,
        sessionId: currentSessionId.value
      })
    ),
    onEvent: ({ payload = {} } = {}) => {
      void file.applyRemoteFileChange(payload);
      if (payload.operation === "created") {
        if (currentActive.value) {
          void tree.loadTree();
        } else {
          pendingTreeRefresh = true;
        }
      }
    }
  });

  useVibe64SourceEditorFileSync({
    active: computed(() => canLoad.value && currentActive.value),
    onChange: (payload = {}) => {
      void file.applyObservedFileChange(payload);
    },
    onError: (error = {}) => {
      vibe64SessionDebugLog("client.sourceEditor.fileSync.error", {
        error: String(error.error || "Source file observation failed."),
        path: selectedPath.value,
        sessionId: currentSessionId.value,
        transient: error.transient === true
      });
    },
    onReady: () => {
      void file.revalidateSelectedFile();
    },
    path: selectedPath,
    sessionId: currentSessionId,
    sessionsApiPath: currentSessionsApiPath
  });

  function refresh() {
    if (refreshPromise) {
      pendingTreeRefresh = true;
      return refreshPromise;
    }
    refreshPromise = (async () => {
      do {
        pendingTreeRefresh = false;
        tree.clearSelectedReveal();
        await tree.loadTree();
        await file.revalidateSelectedFile();
        if (discovery.searchQuery.value && currentActive.value) await discovery.loadSearchResults({ background: true });
      } while (pendingTreeRefresh && currentActive.value);
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  watch([currentSessionId, () => Boolean(readRefOrGetterValue(agentActive))], ([id, working], previous = []) => {
    if (id !== previous[0] || !previous[1] || working) return;
    if (currentActive.value) void refresh();
    else pendingTreeRefresh = true;
  });

  if (typeof window !== "undefined") {
    window.addEventListener("focus", file.revalidateSelectedFile);
  }

  watch([currentSessionsApiPath, currentSessionId, currentActive], async (current, previous = []) => {
    if (current[0] === previous[0] && current[1] === previous[1]) {
      if (!current[2]) {
        discovery.pauseSearch();
      } else if (discovery.searchQuery.value && !pendingTreeRefresh) {
        void discovery.loadSearchResults({ background: true });
      }
      if (current[2] && pendingTreeRefresh) {
        await refresh();
      }
      return;
    }
    pendingTreeRefresh = false;
    explanations.leaveSession({
      sessionsApiPath: previous[0] || currentSessionsApiPath.value,
      sessionId: previous[1] || currentSessionId.value
    });
    discovery.resetDiscoveryState();
    file.resetSelectedFile();
    await tree.loadTree({
      preserveLoadedDirectories: false
    });
    explanations.cleanupAbandonedExplanations();
  }, {
    immediate: true
  });

  onBeforeUnmount(() => {
    disposed.value = true;
    tree.dispose();
    file.dispose();
    explanations.dispose();
    discovery.dispose();
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", file.revalidateSelectedFile);
    }
    void file.saveNow();
  });

  return {
    activeExplanation: explanations.activeExplanation,
    closeExplanation: explanations.closeExplanation,
    createFile: file.createFile,
    createFileError: file.createFileError,
    creatingFile: file.creatingFile,
    cursorRequest: file.cursorRequest,
    dirty: file.dirty,
    downloadOnlyFile: file.downloadOnlyFile,
    explanationBusy: explanations.explanationBusy,
    explanationClosing: explanations.explanationClosing,
    explanationError: explanations.explanationError,
    explanationFollowup: explanations.explanationFollowup,
    explainSelection: explanations.explainSelection,
    fileMatches: discovery.fileMatches,
    fileMatchesError: discovery.fileMatchesError,
    fileMatchesLoading: discovery.fileMatchesLoading,
    fileMatchesTruncated: discovery.fileMatchesTruncated,
    fileQuery: discovery.fileQuery,
    loadError,
    loadedVersion: file.loadedVersion,
    loadDirectory: tree.loadDirectory,
    loadMoreDirectory: tree.loadMoreDirectory,
    loadingFile: file.loadingFile,
    loadingPath: file.loadingPath,
    loadingTree: tree.loadingTree,
    openFile: file.openFile,
    openFileMatch: discovery.openFileMatch,
    openFirstFileMatch: discovery.openFirstFileMatch,
    openReferencedSourcePath: file.openReferencedSourcePath,
    openRequest: file.openRequest,
    openSearchResult: discovery.openSearchResult,
    policy: tree.policy,
    refresh,
    retryExplanation: explanations.retryExplanation,
    revealedDirectoryPaths: tree.revealedDirectoryPaths,
    saveError: file.saveError,
    saveNow: file.saveNow,
    savedHash: file.savedHash,
    interpretations: file.interpretations,
    interpretationWarning: file.interpretationWarning,
    searchError: discovery.searchError,
    searchLoading: discovery.searchLoading,
    searchIndex: discovery.searchIndex,
    searchIndexLabel: discovery.searchIndexLabel,
    searchIndexPending: discovery.searchIndexPending,
    searchQuery: discovery.searchQuery,
    searchResults: discovery.searchResults,
    searchTruncated: discovery.searchTruncated,
    selectedPath,
    sendExplanationFollowup: explanations.sendExplanationFollowup,
    saving: file.saving,
    stopExplanation: explanations.stopExplanation,
    statusLabel,
    text: file.text,
    tree: tree.tree,
    treeLoadErrors: tree.treeLoadErrors,
    treeLoadingPaths: tree.treeLoadingPaths,
    updateExplanationFollowup: explanations.updateExplanationFollowup,
    updateFileQuery: discovery.updateFileQuery,
    updateSearchQuery: discovery.updateSearchQuery,
    updateText: file.updateText
  };
}

export {
  SOURCE_EDITOR_AUTOSAVE_DELAY_MS,
  SOURCE_EDITOR_FILE_MATCH_DELAY_MS,
  SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE,
  SOURCE_EDITOR_SEARCH_DELAY_MS,
  sourceEditorFileChangePayloadMatches,
  useVibe64SourceEditor
};
