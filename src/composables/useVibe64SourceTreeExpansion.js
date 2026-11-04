import { computed, ref, watch } from "vue";
import {
  normalizeSourceEditorDirectoryPaths,
  normalizeSourceEditorPath
} from "@/lib/vibe64SourceEditorLinks.js";
import {
  readLocalStorageJson,
  stableLocalStorageKeyPart,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";

const SOURCE_EDITOR_TREE_STATE_STORAGE_KEY = "vibe64:source-editor:tree-state";

function sourceEditorTreeStateStorageKey({
  sessionId = "",
  sessionsApiPath = ""
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedSessionsApiPath = String(sessionsApiPath || "").trim();
  if (!normalizedSessionId || !normalizedSessionsApiPath) {
    return "";
  }
  return [
    SOURCE_EDITOR_TREE_STATE_STORAGE_KEY,
    stableLocalStorageKeyPart(normalizedSessionsApiPath),
    stableLocalStorageKeyPart(normalizedSessionId)
  ].join(":");
}

function parentDirectoryPathsFor(filePath = "") {
  const parts = normalizeSourceEditorPath(filePath).split("/").filter(Boolean);
  const paths = [];
  for (let index = 1; index < parts.length; index += 1) {
    paths.push(parts.slice(0, index).join("/"));
  }
  return paths;
}

/**
 * The source tree's open folders, remembered in this browser per session. The
 * folders that reveal the selected file, or a newly created one, open too.
 * @param {object} options
 * @param {import("@/types.js").Vibe64SourceEditor} options.editor
 * @param {{ sessionId: string, sessionsApiPath: string }} options.props The source editor's props.
 */
function useVibe64SourceTreeExpansion({
  editor,
  props
}) {
  const expandedDirectoryPaths = ref([]);
  const treeStateStorageKey = computed(() => sourceEditorTreeStateStorageKey({
    sessionId: props.sessionId,
    sessionsApiPath: props.sessionsApiPath
  }));

  function addExpandedDirectoryPaths(paths = []) {
    const normalizedPaths = normalizeSourceEditorDirectoryPaths(paths);
    if (!normalizedPaths.length) {
      return;
    }
    expandedDirectoryPaths.value = normalizeSourceEditorDirectoryPaths([
      ...expandedDirectoryPaths.value,
      ...normalizedPaths
    ]);
  }

  /**
   * Opens the folders that hold a newly created file.
   * @param {string} filePath
   */
  function revealCreatedFile(filePath) {
    addExpandedDirectoryPaths(parentDirectoryPathsFor(filePath));
  }

  function handleDirectoryOpenChange({
    open = false,
    path = ""
  } = {}) {
    const normalizedPath = normalizeSourceEditorPath(path);
    if (!normalizedPath) {
      return;
    }
    const nextPaths = new Set(expandedDirectoryPaths.value);
    if (open) {
      nextPaths.add(normalizedPath);
      editor.loadDirectory(normalizedPath);
    } else {
      nextPaths.delete(normalizedPath);
    }
    expandedDirectoryPaths.value = normalizeSourceEditorDirectoryPaths([...nextPaths]);
  }

  function closeAllDirectories() {
    expandedDirectoryPaths.value = [];
  }

  watch(editor.revealedDirectoryPaths, (paths) => {
    addExpandedDirectoryPaths(paths);
  });

  watch(treeStateStorageKey, (storageKey = "") => {
    expandedDirectoryPaths.value = normalizeSourceEditorDirectoryPaths(
      readLocalStorageJson(storageKey, [])
    );
  }, {
    immediate: true
  });

  watch(expandedDirectoryPaths, (paths) => {
    if (treeStateStorageKey.value) {
      writeLocalStorageJson(treeStateStorageKey.value, normalizeSourceEditorDirectoryPaths(paths));
    }
  });

  return {
    closeAllDirectories,
    expandedDirectoryPaths,
    handleDirectoryOpenChange,
    revealCreatedFile
  };
}

export { useVibe64SourceTreeExpansion };
