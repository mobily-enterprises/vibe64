import { computed, ref } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizeSourceEditorPath
} from "@/lib/vibe64SourceEditorLinks.js";
import {
  vibe64SourceEditorFilesPath,
  vibe64SourceEditorSearchPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  sourceEditorRequest
} from "@/lib/vibe64SourceEditorRequest.js";

const SOURCE_EDITOR_FILE_MATCH_DELAY_MS = 120;
const SOURCE_EDITOR_SEARCH_DELAY_MS = 260;

function normalizeFileMatches(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((file = {}) => ({
      language: String(file.language || ""),
      name: String(file.name || ""),
      path: normalizeSourceEditorPath(file.path)
    }))
    .filter((file) => file.path);
}

function normalizeSearchResults(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((result = {}) => ({
      column: Math.max(1, Number(result.column || 1)),
      line: Math.max(1, Number(result.line || 1)),
      path: normalizeSourceEditorPath(result.path),
      preview: String(result.preview || "")
    }))
    .filter((result) => result.path);
}

/**
 * Finding source: the Open file name matches and the Find in files results,
 * each debounced, with the search index's progress while it builds.
 * @param {object} options
 * @param {import("vue").Ref<boolean>} options.canLoad
 * @param {import("vue").Ref<boolean>} options.currentActive
 * @param {import("vue").Ref<string>} options.currentSessionId
 * @param {import("vue").Ref<string>} options.currentSessionsApiPath
 * @param {import("vue").Ref<boolean>} options.disposed
 * @param {(filePath: string, options?: { column?: number, line?: number }) => Promise<boolean>} options.openFile
 */
function useVibe64SourceEditorDiscovery({
  canLoad,
  currentActive,
  currentSessionId,
  currentSessionsApiPath,
  disposed,
  openFile
}) {
  const fileQuery = ref("");
  const fileMatches = ref([]);
  const fileMatchesError = ref("");
  const fileMatchesLoading = ref(false);
  const fileMatchesTruncated = ref(false);
  const searchQuery = ref("");
  const searchResults = ref([]);
  const searchError = ref("");
  const searchLoading = ref(false);
  const searchTruncated = ref(false);
  const searchIndex = ref(null);
  const searchIndexPending = computed(() => ["building", "refreshing"].includes(searchIndex.value?.state));
  const searchIndexLabel = computed(() => {
    const index = searchIndex.value;
    if (index?.state === "error") return index.error || "The search index could not be updated. Use Refresh to retry.";
    if (!searchIndexPending.value) return "";
    const action = index.state === "refreshing" ? "Refreshing file index" : "Indexing files";
    return index.total ? `${action}: ${index.scanned} of ${index.total} files…` : `${action}…`;
  });
  let fileMatchesRequestId = 0;
  let searchRequestId = 0;
  let fileMatchesTimer = null;
  let searchTimer = null;

  function clearFileMatchesTimer() {
    if (fileMatchesTimer) {
      clearTimeout(fileMatchesTimer);
      fileMatchesTimer = null;
    }
  }

  function clearSearchTimer() {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  function clearFileMatches() {
    fileMatchesRequestId += 1;
    fileMatches.value = [];
    fileMatchesError.value = "";
    fileMatchesLoading.value = false;
    fileMatchesTruncated.value = false;
  }

  function clearSearchResults() {
    searchRequestId += 1;
    searchResults.value = [];
    searchError.value = "";
    searchLoading.value = false;
    searchTruncated.value = false;
    searchIndex.value = null;
  }

  function resetDiscoveryState() {
    clearFileMatchesTimer();
    clearSearchTimer();
    fileQuery.value = "";
    searchQuery.value = "";
    clearFileMatches();
    clearSearchResults();
  }

  async function loadFileMatches() {
    const query = normalizeText(fileQuery.value);
    if (!query) {
      clearFileMatches();
      return;
    }
    const requestId = fileMatchesRequestId + 1;
    fileMatchesRequestId = requestId;
    fileMatchesError.value = "";
    if (!canLoad.value) {
      return;
    }
    fileMatchesLoading.value = true;
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorFilesPath(
        currentSessionsApiPath.value,
        currentSessionId.value,
        query
      ));
      if (requestId !== fileMatchesRequestId) {
        return;
      }
      fileMatches.value = normalizeFileMatches(response.files);
      fileMatchesTruncated.value = response.truncated === true;
    } catch (error) {
      if (requestId === fileMatchesRequestId) {
        fileMatches.value = [];
        fileMatchesError.value = String(error?.message || error || "File matches could not be loaded.");
      }
    } finally {
      if (requestId === fileMatchesRequestId) {
        fileMatchesLoading.value = false;
      }
    }
  }

  function updateFileQuery(value = "") {
    fileQuery.value = String(value || "");
    clearFileMatchesTimer();
    if (!normalizeText(fileQuery.value)) {
      clearFileMatches();
      return;
    }
    fileMatchesTimer = setTimeout(() => {
      void loadFileMatches();
    }, SOURCE_EDITOR_FILE_MATCH_DELAY_MS);
  }

  async function openFileMatch(filePath = "") {
    const normalizedPath = normalizeSourceEditorPath(filePath);
    if (!normalizedPath) {
      return;
    }
    clearFileMatchesTimer();
    fileQuery.value = "";
    clearFileMatches();
    await openFile(normalizedPath);
  }

  function openFirstFileMatch() {
    const firstFile = fileMatches.value[0];
    if (firstFile?.path) {
      void openFileMatch(firstFile.path);
    }
  }

  async function loadSearchResults({ background = false } = {}) {
    clearSearchTimer();
    if (disposed.value || !currentActive.value) return;
    const query = normalizeText(searchQuery.value);
    if (!query) {
      clearSearchResults();
      return;
    }
    const requestId = searchRequestId + 1;
    searchRequestId = requestId;
    searchError.value = "";
    if (!canLoad.value) {
      return;
    }
    searchLoading.value = !background;
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorSearchPath(
        currentSessionsApiPath.value,
        currentSessionId.value,
        query
      ));
      if (requestId !== searchRequestId) {
        return;
      }
      searchResults.value = normalizeSearchResults(response.results);
      searchTruncated.value = response.truncated === true;
      searchIndex.value = response.index || null;
      if (searchIndexPending.value && currentActive.value && !disposed.value) {
        searchTimer = setTimeout(() => { void loadSearchResults({ background: true }); }, 1000);
      }
    } catch (error) {
      if (requestId === searchRequestId) {
        searchResults.value = [];
        searchIndex.value = null;
        searchError.value = String(error?.message || error || "Search results could not be loaded.");
      }
    } finally {
      if (requestId === searchRequestId) {
        searchLoading.value = false;
      }
    }
  }

  function updateSearchQuery(value = "") {
    searchQuery.value = String(value || "");
    clearSearchTimer();
    clearSearchResults();
    if (!normalizeText(searchQuery.value)) {
      return;
    }
    searchTimer = setTimeout(() => {
      void loadSearchResults();
    }, SOURCE_EDITOR_SEARCH_DELAY_MS);
  }

  function openSearchResult(result = {}) {
    const filePath = normalizeSourceEditorPath(result.path);
    if (!filePath) {
      return;
    }
    void openFile(filePath, {
      column: result.column,
      line: result.line
    });
  }

  /** Drops a running search's answer and its loading state while the editor is hidden. */
  function pauseSearch() {
    clearSearchTimer();
    searchRequestId += 1;
    searchLoading.value = false;
  }

  /** Stops the pending lookups and drops the answers still in flight. */
  function dispose() {
    clearFileMatchesTimer();
    clearSearchTimer();
    searchRequestId += 1;
  }

  return {
    dispose,
    fileMatches,
    fileMatchesError,
    fileMatchesLoading,
    fileMatchesTruncated,
    fileQuery,
    loadSearchResults,
    openFileMatch,
    openFirstFileMatch,
    openSearchResult,
    pauseSearch,
    resetDiscoveryState,
    searchError,
    searchIndex,
    searchIndexLabel,
    searchIndexPending,
    searchLoading,
    searchQuery,
    searchResults,
    searchTruncated,
    updateFileQuery,
    updateSearchQuery
  };
}

export {
  SOURCE_EDITOR_FILE_MATCH_DELAY_MS,
  SOURCE_EDITOR_SEARCH_DELAY_MS,
  useVibe64SourceEditorDiscovery
};
