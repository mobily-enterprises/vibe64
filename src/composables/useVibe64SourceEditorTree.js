import { ref } from "vue";
import {
  normalizeSourceEditorDirectoryPaths,
  normalizeSourceEditorPath
} from "@/lib/vibe64SourceEditorLinks.js";
import {
  vibe64SourceEditorTreePath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  sourceEditorRequest
} from "@/lib/vibe64SourceEditorRequest.js";
import {
  SOURCE_EDITOR_TREE_PAGE_SIZE,
  findTreeDirectory,
  loadedFileAncestorDirectoryPaths,
  loadedTreeDirectoryPaths,
  mergeDirectoryPage,
  mergeRevealTree,
  normalizeTreeNode
} from "@/lib/vibe64SourceEditorTree.js";

function normalizeSourceEditorPolicy(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}

/**
 * The session's source tree: directory pages loaded on demand, the folders that
 * reveal the selected file, and a reload that keeps every folder already loaded.
 * @param {object} options
 * @param {import("vue").Ref<boolean>} options.canLoad
 * @param {import("vue").Ref<boolean>} options.currentActive
 * @param {import("vue").Ref<string>} options.currentSessionId
 * @param {import("vue").Ref<string>} options.currentSessionsApiPath
 * @param {import("vue").Ref<boolean>} options.disposed
 * @param {import("vue").Ref<{ operation: string, message: string } | null>} options.loadFailure
 * @param {() => void} options.onRefreshInterrupted Called when a reload stops early because the editor is hidden or gone.
 * @param {import("vue").Ref<string>} options.selectedPath
 */
function useVibe64SourceEditorTree({
  canLoad,
  currentActive,
  currentSessionId,
  currentSessionsApiPath,
  disposed,
  loadFailure,
  onRefreshInterrupted,
  selectedPath
}) {
  const tree = ref(null);
  const policy = ref({});
  const treeLoadingPaths = ref([]);
  const treeLoadErrors = ref({});
  const loadingTree = ref(false);
  const revealedDirectoryPaths = ref([]);
  const selectedRevealTree = ref(null);
  let treeRequestId = 0;
  const treeDirectoryRequestIds = new Map();

  function treePathKey(value = "") {
    return normalizeSourceEditorPath(value);
  }

  function setTreePathLoading(path = "", loading = false) {
    const key = treePathKey(path);
    const current = new Set(treeLoadingPaths.value);
    if (loading) {
      current.add(key);
    } else {
      current.delete(key);
    }
    treeLoadingPaths.value = [...current].sort((left, right) => left.localeCompare(right));
  }

  function setTreePathError(path = "", message = "") {
    const key = treePathKey(path);
    const next = {
      ...treeLoadErrors.value
    };
    if (message) {
      next[key] = message;
    } else {
      delete next[key];
    }
    treeLoadErrors.value = next;
  }

  async function loadDirectoryPage(directoryPath = "", {
    applyPage = true,
    append = false,
    offset = 0
  } = {}) {
    const normalizedPath = treePathKey(directoryPath);
    if (!canLoad.value || disposed.value) {
      return null;
    }
    const treeGeneration = treeRequestId;
    const requestKey = normalizedPath;
    const requestId = (treeDirectoryRequestIds.get(requestKey) || 0) + 1;
    treeDirectoryRequestIds.set(requestKey, requestId);
    setTreePathLoading(normalizedPath, true);
    setTreePathError(normalizedPath, "");
    if (!normalizedPath && !append) {
      loadingTree.value = true;
      loadFailure.value = null;
    }
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorTreePath(
        currentSessionsApiPath.value,
        currentSessionId.value,
        {
          limit: SOURCE_EDITOR_TREE_PAGE_SIZE,
          offset,
          path: normalizedPath
        }
      ));
      if (treeGeneration !== treeRequestId || treeDirectoryRequestIds.get(requestKey) !== requestId) {
        return null;
      }
      if (!normalizedPath) {
        policy.value = normalizeSourceEditorPolicy(response.policy || {});
      }
      const page = normalizeTreeNode(response.tree);
      if (applyPage) {
        tree.value = mergeDirectoryPage(tree.value, normalizedPath, page, append);
        if (selectedRevealTree.value) {
          tree.value = mergeRevealTree(tree.value, selectedRevealTree.value);
        }
      }
      if (applyPage) revealLoadedFilePath(selectedPath.value);
      return page;
    } catch (error) {
      if (treeGeneration === treeRequestId && treeDirectoryRequestIds.get(requestKey) === requestId) {
        const message = String(error?.message || error || "Source tree could not be loaded.");
        setTreePathError(normalizedPath, message);
        if (!normalizedPath) {
          loadFailure.value = { operation: "tree", message };
        }
      }
      return null;
    } finally {
      if (treeGeneration === treeRequestId && treeDirectoryRequestIds.get(requestKey) === requestId) {
        setTreePathLoading(normalizedPath, false);
        if (!normalizedPath && applyPage) {
          loadingTree.value = false;
        }
      }
    }
  }

  function revealLoadedFilePath(filePath = "") {
    const ancestors = loadedFileAncestorDirectoryPaths(tree.value, filePath);
    if (ancestors) {
      revealedDirectoryPaths.value = normalizeSourceEditorDirectoryPaths(ancestors);
    }
  }

  async function loadTree({
    preserveLoadedDirectories = true
  } = {}) {
    const refreshingLoadedTree = preserveLoadedDirectories && Boolean(tree.value);
    const directoriesToReload = preserveLoadedDirectories
      ? loadedTreeDirectoryPaths(tree.value)
      : [];
    const loadedCounts = new Map(["", ...directoriesToReload].map((directoryPath) => [
      directoryPath, findTreeDirectory(tree.value, directoryPath)?.children?.length || 0
    ]));
    const requestId = treeRequestId + 1;
    treeRequestId = requestId;
    if (!preserveLoadedDirectories) {
      tree.value = null;
      policy.value = normalizeSourceEditorPolicy({});
      revealedDirectoryPaths.value = [];
    }
    treeDirectoryRequestIds.clear();
    treeLoadingPaths.value = [];
    treeLoadErrors.value = {};
    loadFailure.value = null;
    if (!canLoad.value) {
      return;
    }
    loadingTree.value = true;
    let refreshedTree = tree.value;
    for (const directoryPath of ["", ...directoriesToReload]) {
      if (requestId !== treeRequestId) return;
      if (directoryPath && !findTreeDirectory(refreshedTree, directoryPath)) {
        continue;
      }
      let offset = 0;
      do {
        if (disposed.value || (refreshingLoadedTree && !currentActive.value)) {
          onRefreshInterrupted();
          loadingTree.value = false;
          return;
        }
        const page = await loadDirectoryPage(directoryPath, { applyPage: false, append: offset > 0, offset });
        if (requestId !== treeRequestId) return;
        if (page) refreshedTree = mergeDirectoryPage(refreshedTree, directoryPath, page, offset > 0);
        if (!page?.hasMore || !page.nextOffset || page.nextOffset <= offset) break;
        offset = page.nextOffset;
      } while (offset < loadedCounts.get(directoryPath));
    }
    tree.value = refreshedTree;
    loadingTree.value = false;
    if (selectedRevealTree.value) {
      tree.value = mergeRevealTree(tree.value, selectedRevealTree.value);
      revealLoadedFilePath(selectedPath.value);
    }
  }

  function loadDirectory(directoryPath = "") {
    const normalizedPath = treePathKey(directoryPath);
    const directory = findTreeDirectory(tree.value, normalizedPath);
    if (directory?.loaded === true) {
      return;
    }
    void loadDirectoryPage(normalizedPath, {
      append: false,
      offset: 0
    });
  }

  function loadMoreDirectory(directoryPath = "") {
    const normalizedPath = treePathKey(directoryPath);
    const directory = findTreeDirectory(tree.value, normalizedPath);
    if (!directory?.hasMore) {
      return;
    }
    void loadDirectoryPage(normalizedPath, {
      append: true,
      offset: directory.nextOffset || directory.children?.length || 0
    });
  }

  /**
   * Keeps the selected file's ancestors, from the reveal tree its read
   * returned, in the tree through later page loads.
   * @param {unknown} revealTree
   */
  function revealSelectedFile(revealTree) {
    selectedRevealTree.value = normalizeTreeNode(revealTree);
    if (selectedRevealTree.value) {
      tree.value = mergeRevealTree(tree.value, selectedRevealTree.value);
    }
  }

  /** Stops keeping a selected file's ancestors in the tree. */
  function clearSelectedReveal() {
    selectedRevealTree.value = null;
  }

  /** Discards every tree read still in flight. */
  function dispose() {
    treeRequestId += 1;
  }

  return {
    clearSelectedReveal,
    dispose,
    loadDirectory,
    loadMoreDirectory,
    loadTree,
    loadingTree,
    policy,
    revealLoadedFilePath,
    revealSelectedFile,
    revealedDirectoryPaths,
    tree,
    treeLoadErrors,
    treeLoadingPaths
  };
}

export { useVibe64SourceEditorTree };
