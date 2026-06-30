import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";

import {
  vibe64SourceEditorFilePath,
  vibe64SourceEditorTreePath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  resolveResponseErrorMessage
} from "@/lib/vibe64ResponseErrors.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const SOURCE_EDITOR_AUTOSAVE_DELAY_MS = 700;

function normalizeEditorPath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\/+/u, "");
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
  const loadError = ref("");
  const saveError = ref("");
  const loadingTree = ref(false);
  const loadingFile = ref(false);
  const saving = ref(false);
  const loadedVersion = ref(0);
  const cursorRequest = ref(null);
  let treeRequestId = 0;
  let fileRequestId = 0;
  let autosaveTimer = null;
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
    void saveNow();
  });

  return {
    cursorRequest,
    dirty,
    loadError,
    loadedVersion,
    loadingFile,
    loadingTree,
    openFile,
    openRequest,
    policy,
    refresh: loadTree,
    saveError,
    saveNow,
    savedHash,
    selectedPath,
    saving,
    statusLabel,
    text,
    tree,
    updateText
  };
}

export {
  SOURCE_EDITOR_AUTOSAVE_DELAY_MS,
  useVibe64SourceEditor
};
