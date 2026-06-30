import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";

import {
  vibe64SourceEditorFilePath,
  vibe64SourceEditorFilesPath,
  vibe64SourceEditorSearchPath,
  vibe64SourceEditorTreePath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  resolveResponseErrorMessage
} from "@/lib/vibe64ResponseErrors.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const SOURCE_EDITOR_AUTOSAVE_DELAY_MS = 700;
const SOURCE_EDITOR_FILE_MATCH_DELAY_MS = 120;
const SOURCE_EDITOR_SEARCH_DELAY_MS = 260;

function normalizeEditorPath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function normalizeEditorQuery(value = "") {
  return String(value || "").trim();
}

function normalizeFileMatches(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((file = {}) => ({
      language: String(file.language || ""),
      name: String(file.name || ""),
      path: normalizeEditorPath(file.path)
    }))
    .filter((file) => file.path);
}

function normalizeSearchResults(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((result = {}) => ({
      column: Math.max(1, Number(result.column || 1)),
      line: Math.max(1, Number(result.line || 1)),
      path: normalizeEditorPath(result.path),
      preview: String(result.preview || "")
    }))
    .filter((result) => result.path);
}

function firstFileInTree(node = null) {
  if (!node) {
    return "";
  }
  if (node.type === "file") {
    return normalizeEditorPath(node.path);
  }
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const filePath = firstFileInTree(child);
    if (filePath) {
      return filePath;
    }
  }
  return "";
}

function treeHasFile(node = null, filePath = "") {
  const normalizedPath = normalizeEditorPath(filePath);
  if (!node || !normalizedPath) {
    return false;
  }
  if (node.type === "file") {
    return normalizeEditorPath(node.path) === normalizedPath;
  }
  return (Array.isArray(node.children) ? node.children : [])
    .some((child) => treeHasFile(child, normalizedPath));
}

function defaultOpenFile(tree = null, policy = {}) {
  const defaults = Array.isArray(policy.defaultOpenFiles) ? policy.defaultOpenFiles : [];
  for (const candidate of defaults) {
    if (treeHasFile(tree, candidate)) {
      return normalizeEditorPath(candidate);
    }
  }
  return firstFileInTree(tree);
}

async function sourceEditorRequest(url = "", options = {}) {
  const payload = await getUsersWebHttpClient().request(url, options);
  if (payload?.ok === false) {
    const message = resolveResponseErrorMessage(payload, "Source editor request failed.");
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function useVibe64SourceEditor({
  sessionsApiPath,
  sessionId
} = {}) {
  const tree = ref(null);
  const policy = ref({});
  const selectedPath = ref("");
  const text = ref("");
  const savedText = ref("");
  const savedHash = ref("");
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
  const loadError = ref("");
  const saveError = ref("");
  const loadingTree = ref(false);
  const loadingFile = ref(false);
  const saving = ref(false);
  const loadedVersion = ref(0);
  const cursorRequest = ref(null);
  let treeRequestId = 0;
  let fileRequestId = 0;
  let fileMatchesRequestId = 0;
  let searchRequestId = 0;
  let autosaveTimer = null;
  let fileMatchesTimer = null;
  let searchTimer = null;
  let queuedSave = false;

  const currentSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const currentSessionId = computed(() => String(readRefOrGetterValue(sessionId) || "").trim());
  const canLoad = computed(() => Boolean(currentSessionsApiPath.value && currentSessionId.value));
  const dirty = computed(() => text.value !== savedText.value);
  const statusLabel = computed(() => {
    if (saveError.value) {
      return saveError.value;
    }
    if (saving.value) {
      return "Saving...";
    }
    if (dirty.value) {
      return "Unsaved";
    }
    return selectedPath.value ? "Saved" : "";
  });

  function clearAutosave() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
  }

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
  }

  function resetDiscoveryState() {
    clearFileMatchesTimer();
    clearSearchTimer();
    fileQuery.value = "";
    searchQuery.value = "";
    clearFileMatches();
    clearSearchResults();
  }

  async function loadTree() {
    const requestId = treeRequestId + 1;
    treeRequestId = requestId;
    tree.value = null;
    policy.value = {};
    loadError.value = "";
    if (!canLoad.value) {
      return;
    }
    loadingTree.value = true;
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorTreePath(
        currentSessionsApiPath.value,
        currentSessionId.value
      ));
      if (requestId !== treeRequestId) {
        return;
      }
      tree.value = response.tree || null;
      policy.value = response.policy || {};
      if (!selectedPath.value) {
        const filePath = defaultOpenFile(tree.value, policy.value);
        if (filePath) {
          void openFile(filePath);
        }
      }
    } catch (error) {
      if (requestId === treeRequestId) {
        loadError.value = String(error?.message || error || "Source tree could not be loaded.");
      }
    } finally {
      if (requestId === treeRequestId) {
        loadingTree.value = false;
      }
    }
  }

  async function openFile(filePath = "", options = {}) {
    const normalizedPath = normalizeEditorPath(filePath);
    if (!normalizedPath || !canLoad.value) {
      return;
    }
    if (dirty.value) {
      await saveNow();
    }
    const requestId = fileRequestId + 1;
    fileRequestId = requestId;
    loadError.value = "";
    saveError.value = "";
    loadingFile.value = true;
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorFilePath(
        currentSessionsApiPath.value,
        currentSessionId.value,
        normalizedPath
      ));
      if (requestId !== fileRequestId) {
        return;
      }
      const file = response.file || {};
      selectedPath.value = normalizeEditorPath(file.path || normalizedPath);
      text.value = String(file.text || "");
      savedText.value = text.value;
      savedHash.value = String(file.hash || "");
      cursorRequest.value = {
        column: Number(options.column || 0) || 0,
        line: Number(options.line || 0) || 0,
        path: selectedPath.value,
        version: loadedVersion.value + 1
      };
      loadedVersion.value += 1;
    } catch (error) {
      if (requestId === fileRequestId) {
        loadError.value = String(error?.message || error || "Source file could not be loaded.");
      }
    } finally {
      if (requestId === fileRequestId) {
        loadingFile.value = false;
      }
    }
  }

  async function loadFileMatches() {
    const query = normalizeEditorQuery(fileQuery.value);
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
    if (!normalizeEditorQuery(fileQuery.value)) {
      clearFileMatches();
      return;
    }
    fileMatchesTimer = setTimeout(() => {
      void loadFileMatches();
    }, SOURCE_EDITOR_FILE_MATCH_DELAY_MS);
  }

  async function openFileMatch(filePath = "") {
    const normalizedPath = normalizeEditorPath(filePath);
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

  async function loadSearchResults() {
    const query = normalizeEditorQuery(searchQuery.value);
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
    searchLoading.value = true;
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
    } catch (error) {
      if (requestId === searchRequestId) {
        searchResults.value = [];
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
    if (!normalizeEditorQuery(searchQuery.value)) {
      clearSearchResults();
      return;
    }
    searchTimer = setTimeout(() => {
      void loadSearchResults();
    }, SOURCE_EDITOR_SEARCH_DELAY_MS);
  }

  function openSearchResult(result = {}) {
    const filePath = normalizeEditorPath(result.path);
    if (!filePath) {
      return;
    }
    void openFile(filePath, {
      column: result.column,
      line: result.line
    });
  }

  function scheduleSave() {
    clearAutosave();
    if (!selectedPath.value || !dirty.value) {
      return;
    }
    autosaveTimer = setTimeout(() => {
      void saveNow();
    }, SOURCE_EDITOR_AUTOSAVE_DELAY_MS);
  }

  function updateText(nextText = "") {
    text.value = String(nextText ?? "");
    saveError.value = "";
    scheduleSave();
  }

  async function saveNow() {
    clearAutosave();
    if (!selectedPath.value || !dirty.value || saving.value) {
      if (saving.value) {
        queuedSave = true;
      }
      return;
    }
    const pathAtSave = selectedPath.value;
    const textAtSave = text.value;
    const baseHashAtSave = savedHash.value;
    saving.value = true;
    saveError.value = "";
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorFilePath(
        currentSessionsApiPath.value,
        currentSessionId.value
      ), {
        body: {
          baseHash: baseHashAtSave,
          path: pathAtSave,
          text: textAtSave
        },
        method: "PUT"
      });
      if (selectedPath.value === pathAtSave) {
        savedHash.value = String(response.file?.hash || "");
        savedText.value = textAtSave;
      }
    } catch (error) {
      if (selectedPath.value === pathAtSave) {
        saveError.value = String(error?.message || error || "Source file could not be saved.");
      }
    } finally {
      saving.value = false;
      if (queuedSave || (selectedPath.value === pathAtSave && text.value !== textAtSave)) {
        queuedSave = false;
        scheduleSave();
      }
    }
  }

  function openRequest(request = {}) {
    const filePath = normalizeEditorPath(request.path);
    if (!filePath) {
      return;
    }
    void openFile(filePath, {
      column: request.column,
      line: request.line
    });
  }

  watch([currentSessionsApiPath, currentSessionId], () => {
    resetDiscoveryState();
    selectedPath.value = "";
    text.value = "";
    savedText.value = "";
    savedHash.value = "";
    void loadTree();
  }, {
    immediate: true
  });

  onBeforeUnmount(() => {
    clearAutosave();
    clearFileMatchesTimer();
    clearSearchTimer();
    void saveNow();
  });

  return {
    cursorRequest,
    dirty,
    fileMatches,
    fileMatchesError,
    fileMatchesLoading,
    fileMatchesTruncated,
    fileQuery,
    loadError,
    loadedVersion,
    loadingFile,
    loadingTree,
    openFile,
    openFileMatch,
    openFirstFileMatch,
    openRequest,
    openSearchResult,
    policy,
    refresh: loadTree,
    saveError,
    saveNow,
    savedHash,
    searchError,
    searchLoading,
    searchQuery,
    searchResults,
    searchTruncated,
    selectedPath,
    saving,
    statusLabel,
    text,
    tree,
    updateFileQuery,
    updateSearchQuery,
    updateText
  };
}

export {
  SOURCE_EDITOR_AUTOSAVE_DELAY_MS,
  SOURCE_EDITOR_FILE_MATCH_DELAY_MS,
  SOURCE_EDITOR_SEARCH_DELAY_MS,
  useVibe64SourceEditor
};
