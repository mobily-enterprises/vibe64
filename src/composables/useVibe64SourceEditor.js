import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";

import {
  vibe64SourceEditorExplanationFollowupsStreamPath,
  vibe64SourceEditorExplanationPath,
  vibe64SourceEditorExplanationStopPath,
  vibe64SourceEditorExplanationsStreamPath,
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
const SOURCE_EDITOR_TREE_PAGE_SIZE = 20;
let sourceExplanationClientIdCounter = 0;

function normalizeEditorPath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function normalizeEditorQuery(value = "") {
  return String(value || "").trim();
}

function normalizePolicyDirectories(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((directoryPath) => normalizeEditorPath(directoryPath).replace(/\/+$/u, ""))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeSourceEditorPolicy(value = {}) {
  const policy = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return {
    ...policy,
    preexpandedDirectories: normalizePolicyDirectories(policy.preexpandedDirectories),
    preloadDirectories: normalizePolicyDirectories(policy.preloadDirectories)
  };
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

function normalizeExplanationMessages(value = [], {
  body = "",
  followups = []
} = {}) {
  const messages = (Array.isArray(value) ? value : [])
    .map((entry) => ({
      createdAt: String(entry?.createdAt || ""),
      id: String(entry?.id || ""),
      role: String(entry?.role || ""),
      status: String(entry?.status || "complete"),
      text: String(entry?.text || "")
    }))
    .filter((entry) => entry.id && ["assistant", "user"].includes(entry.role) && (entry.text || entry.status !== "complete"));
  if (messages.length) {
    return messages;
  }
  const fallback = [];
  if (String(body || "").trim()) {
    fallback.push({
      createdAt: "",
      id: "body",
      role: "assistant",
      status: "complete",
      text: String(body || "")
    });
  }
  return [
    ...fallback,
    ...(Array.isArray(followups) ? followups : [])
      .map((entry) => ({
        createdAt: String(entry?.createdAt || ""),
        id: String(entry?.id || ""),
        role: String(entry?.role || ""),
        status: "complete",
        text: String(entry?.text || "")
      }))
      .filter((entry) => entry.id && ["assistant", "user"].includes(entry.role) && entry.text)
  ];
}

function normalizeExplanation(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const sourceRange = value.sourceRange && typeof value.sourceRange === "object" && !Array.isArray(value.sourceRange)
    ? value.sourceRange
    : {};
  const id = String(value.id || "").trim();
  if (!id) {
    return null;
  }
  const followups = (Array.isArray(value.followups) ? value.followups : [])
    .map((entry) => ({
      createdAt: String(entry?.createdAt || ""),
      id: String(entry?.id || ""),
      role: String(entry?.role || ""),
      text: String(entry?.text || "")
    }))
    .filter((entry) => entry.id && ["assistant", "user"].includes(entry.role) && entry.text);
  return {
    agentThreadId: String(value.agentThreadId || ""),
    agentTurnId: String(value.agentTurnId || ""),
    body: String(value.body || ""),
    createdAt: String(value.createdAt || ""),
    engine: String(value.engine || ""),
    followups,
    id,
    messages: normalizeExplanationMessages(value.messages, {
      body: value.body,
      followups
    }),
    model: String(value.model || ""),
    sourceRange: {
      endColumn: Math.max(1, Number(sourceRange.endColumn || 1)),
      endLine: Math.max(1, Number(sourceRange.endLine || 1)),
      language: String(sourceRange.language || ""),
      path: normalizeEditorPath(sourceRange.path),
      scope: String(sourceRange.scope || "selection"),
      startColumn: Math.max(1, Number(sourceRange.startColumn || 1)),
      startLine: Math.max(1, Number(sourceRange.startLine || 1))
    },
    stale: value.stale === true,
    staleReason: String(value.staleReason || ""),
    status: String(value.status || ""),
    summary: String(value.summary || ""),
    title: String(value.title || "")
  };
}

function normalizeTreeNode(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const type = String(value.type || "");
  const path = normalizeEditorPath(value.path);
  if (type === "file") {
    return {
      language: String(value.language || ""),
      name: String(value.name || ""),
      path,
      size: Number(value.size || 0),
      type
    };
  }
  if (type !== "directory") {
    return null;
  }
  return {
    children: (Array.isArray(value.children) ? value.children : [])
      .map((child) => normalizeTreeNode(child))
      .filter(Boolean),
    hasMore: value.hasMore === true,
    limit: Math.max(1, Number(value.limit || SOURCE_EDITOR_TREE_PAGE_SIZE)),
    loaded: value.loaded === true,
    name: String(value.name || ""),
    nextOffset: Math.max(0, Number(value.nextOffset || 0)),
    offset: Math.max(0, Number(value.offset || 0)),
    path,
    total: Math.max(0, Number(value.total || 0)),
    truncated: value.truncated === true,
    type
  };
}

function mergeDirectoryChildren(existingChildren = [], pageChildren = [], append = false) {
  if (!append) {
    return pageChildren;
  }
  const byKey = new Map((Array.isArray(existingChildren) ? existingChildren : [])
    .map((child) => [treeNodeKey(child), child]));
  for (const child of pageChildren) {
    byKey.set(treeNodeKey(child), child);
  }
  return [...byKey.values()];
}

function treeNodeKey(node = {}) {
  return normalizeEditorPath(node.path) || String(node.name || "");
}

function mergeDirectoryPage(root = null, directoryPath = "", page = null, append = false) {
  const normalizedPath = normalizeEditorPath(directoryPath);
  const normalizedPage = normalizeTreeNode(page);
  if (!normalizedPage) {
    return root;
  }
  if (!normalizedPath) {
    return {
      ...normalizedPage,
      children: mergeDirectoryChildren(root?.children, normalizedPage.children, append)
    };
  }
  function visit(node = null) {
    if (!node || node.type !== "directory") {
      return node;
    }
    if (normalizeEditorPath(node.path) === normalizedPath) {
      return {
        ...node,
        ...normalizedPage,
        children: mergeDirectoryChildren(node.children, normalizedPage.children, append)
      };
    }
    return {
      ...node,
      children: (Array.isArray(node.children) ? node.children : []).map((child) => visit(child))
    };
  }
  return visit(root);
}

function findTreeDirectory(root = null, directoryPath = "") {
  const normalizedPath = normalizeEditorPath(directoryPath);
  if (!root || root.type !== "directory") {
    return null;
  }
  if (normalizeEditorPath(root.path) === normalizedPath) {
    return root;
  }
  for (const child of Array.isArray(root.children) ? root.children : []) {
    const found = findTreeDirectory(child, normalizedPath);
    if (found) {
      return found;
    }
  }
  return null;
}

function directoryPathAncestors(directoryPath = "") {
  const parts = normalizeEditorPath(directoryPath).split("/").filter(Boolean);
  return parts.map((_part, index) => parts.slice(0, index + 1).join("/"));
}

function loadedFileAncestorDirectoryPaths(root = null, filePath = "", ancestors = []) {
  const normalizedFilePath = normalizeEditorPath(filePath);
  if (!root || !normalizedFilePath) {
    return null;
  }
  if (root.type === "file") {
    return normalizeEditorPath(root.path) === normalizedFilePath ? ancestors : null;
  }
  if (root.type !== "directory") {
    return null;
  }
  const normalizedDirectoryPath = normalizeEditorPath(root.path);
  const childAncestors = normalizedDirectoryPath
    ? [...ancestors, normalizedDirectoryPath]
    : ancestors;
  for (const child of Array.isArray(root.children) ? root.children : []) {
    const found = loadedFileAncestorDirectoryPaths(child, normalizedFilePath, childAncestors);
    if (found) {
      return found;
    }
  }
  return null;
}

function loadedDirectoryPaths(root = null, directoryPath = "") {
  const directory = findTreeDirectory(root, directoryPath);
  if (!directory) {
    return [];
  }
  const paths = [];
  function visit(node = null) {
    if (!node || node.type !== "directory") {
      return;
    }
    const normalizedPath = normalizeEditorPath(node.path);
    if (normalizedPath) {
      paths.push(normalizedPath);
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      visit(child);
    }
  }
  visit(directory);
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
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

function sourceEditorClientId(prefix = "id") {
  sourceExplanationClientIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${sourceExplanationClientIdCounter.toString(36)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sourceEditorExplanationPromptText(filePath = "", range = {}) {
  return range.scope === "file"
    ? `Explain the whole file ${filePath}.`
    : `Explain ${filePath}:${range.startLine}-${range.endLine}.`;
}

function sourceEditorExplanationTitle(filePath = "", range = {}) {
  const name = normalizeEditorPath(filePath).split("/").filter(Boolean).pop() || "Code";
  return range.scope === "file"
    ? `${name} full file`
    : `${name} lines ${range.startLine}-${range.endLine}`;
}

function localSourceExplanation({
  assistantMessageId = sourceEditorClientId("msg"),
  explanationId = sourceEditorClientId("exp"),
  filePath = "",
  range = {},
  userMessageId = sourceEditorClientId("msg")
} = {}) {
  const createdAt = nowIso();
  const sourceRange = {
    endColumn: Math.max(1, Number(range.endColumn || 1)),
    endLine: Math.max(1, Number(range.endLine || 1)),
    language: String(range.language || ""),
    path: normalizeEditorPath(filePath),
    scope: String(range.scope || "selection"),
    startColumn: Math.max(1, Number(range.startColumn || 1)),
    startLine: Math.max(1, Number(range.startLine || 1))
  };
  return normalizeExplanation({
    agentThreadId: "",
    agentTurnId: "",
    body: "",
    createdAt,
    engine: "agent-chat",
    followups: [],
    id: explanationId,
    messages: [
      {
        createdAt,
        id: userMessageId,
        role: "user",
        status: "complete",
        text: sourceEditorExplanationPromptText(filePath, sourceRange)
      },
      {
        createdAt,
        id: assistantMessageId,
        role: "assistant",
        status: "thinking",
        text: ""
      }
    ],
    model: "agent-chat",
    sourceRange,
    status: "running",
    summary: "",
    title: sourceEditorExplanationTitle(filePath, sourceRange)
  });
}

function sourceEditorExplanationWithMessage(explanation = null, messageId = "", patch = {}) {
  const normalized = normalizeExplanation(explanation);
  if (!normalized) {
    return null;
  }
  const messages = normalizeExplanationMessages(normalized.messages);
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    return normalized;
  }
  const nextMessages = [...messages];
  nextMessages[index] = {
    ...nextMessages[index],
    ...patch
  };
  return {
    ...normalized,
    messages: normalizeExplanationMessages(nextMessages)
  };
}

function appendSourceEditorExplanationMessages(explanation = null, messages = []) {
  const normalized = normalizeExplanation(explanation);
  if (!normalized) {
    return null;
  }
  return {
    ...normalized,
    messages: normalizeExplanationMessages([
      ...normalized.messages,
      ...messages
    ])
  };
}

function useVibe64SourceEditor({
  readCurrentText = null,
  sessionsApiPath,
  sessionId
} = {}) {
  const tree = ref(null);
  const policy = ref({});
  const selectedPath = ref("");
  const text = ref("");
  const savedHash = ref("");
  const dirty = ref(false);
  const treeLoadingPaths = ref([]);
  const treeLoadErrors = ref({});
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
  const activeExplanation = ref(null);
  const explanationError = ref("");
  const explanationBusy = ref(false);
  const explanationFollowup = ref("");
  const loadError = ref("");
  const saveError = ref("");
  const loadingTree = ref(false);
  const loadingFile = ref(false);
  const saving = ref(false);
  const loadedVersion = ref(0);
  const cursorRequest = ref(null);
  const preexpandedDirectoryPaths = ref([]);
  const revealedDirectoryPaths = ref([]);
  let treeRequestId = 0;
  const treeDirectoryRequestIds = new Map();
  let fileRequestId = 0;
  let fileMatchesRequestId = 0;
  let searchRequestId = 0;
  let explanationRequestId = 0;
  let explanationDeleteRequestId = 0;
  let explanationAbortController = null;
  let autosaveTimer = null;
  let fileMatchesTimer = null;
  let searchTimer = null;
  let queuedSave = false;

  const currentSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const currentSessionId = computed(() => String(readRefOrGetterValue(sessionId) || "").trim());
  const canLoad = computed(() => Boolean(currentSessionsApiPath.value && currentSessionId.value));
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

  function treePathKey(value = "") {
    return normalizeEditorPath(value);
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
    append = false,
    offset = 0,
    optional = false
  } = {}) {
    const normalizedPath = treePathKey(directoryPath);
    if (!canLoad.value) {
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
      loadError.value = "";
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
      tree.value = mergeDirectoryPage(tree.value, normalizedPath, page, append);
      revealLoadedFilePath(selectedPath.value);
      return page;
    } catch (error) {
      if (treeGeneration === treeRequestId && treeDirectoryRequestIds.get(requestKey) === requestId) {
        const message = String(error?.message || error || "Source tree could not be loaded.");
        if (!optional) {
          setTreePathError(normalizedPath, message);
          if (!normalizedPath) {
            loadError.value = message;
          }
        }
      }
      return null;
    } finally {
      if (treeGeneration === treeRequestId && treeDirectoryRequestIds.get(requestKey) === requestId) {
        setTreePathLoading(normalizedPath, false);
        if (!normalizedPath) {
          loadingTree.value = false;
        }
      }
    }
  }

  async function loadDirectoryFromPolicy(directoryPath = "", {
    complete = false,
    recursive = false,
    visited = new Set()
  } = {}) {
    const normalizedPath = treePathKey(directoryPath);
    if (!normalizedPath || visited.has(normalizedPath)) {
      return;
    }
    visited.add(normalizedPath);
    const ancestors = directoryPathAncestors(normalizedPath);
    for (const ancestorPath of ancestors.slice(0, -1)) {
      if (!findTreeDirectory(tree.value, ancestorPath)?.loaded) {
        await loadDirectoryPage(ancestorPath, {
          offset: 0,
          optional: true
        });
      }
      let ancestor = findTreeDirectory(tree.value, ancestorPath);
      while (ancestor?.hasMore) {
        await loadDirectoryPage(ancestorPath, {
          append: true,
          offset: ancestor.nextOffset || ancestor.children?.length || 0,
          optional: true
        });
        ancestor = findTreeDirectory(tree.value, ancestorPath);
      }
    }
    if (!findTreeDirectory(tree.value, normalizedPath)?.loaded) {
      await loadDirectoryPage(normalizedPath, {
        offset: 0,
        optional: true
      });
    }
    let directory = findTreeDirectory(tree.value, normalizedPath);
    if (!directory) {
      return;
    }
    while (complete && directory?.hasMore) {
      await loadDirectoryPage(normalizedPath, {
        append: true,
        offset: directory.nextOffset || directory.children?.length || 0,
        optional: true
      });
      directory = findTreeDirectory(tree.value, normalizedPath);
    }
    if (!recursive) {
      return;
    }
    for (const child of Array.isArray(directory.children) ? directory.children : []) {
      if (child?.type === "directory") {
        await loadDirectoryFromPolicy(child.path, {
          complete: true,
          recursive: true,
          visited
        });
      }
    }
  }

  async function loadPolicyDirectories(requestId = treeRequestId) {
    const preloadDirectories = policy.value.preloadDirectories || [];
    const preexpandedDirectories = policy.value.preexpandedDirectories || [];
    const preexpandedSet = new Set(preexpandedDirectories);
    for (const directoryPath of preloadDirectories) {
      if (requestId !== treeRequestId || preexpandedSet.has(directoryPath)) {
        continue;
      }
      await loadDirectoryFromPolicy(directoryPath);
    }
    const expandedPaths = [];
    const visited = new Set();
    for (const directoryPath of preexpandedDirectories) {
      if (requestId !== treeRequestId) {
        return;
      }
      await loadDirectoryFromPolicy(directoryPath, {
        complete: true,
        recursive: true,
        visited
      });
      expandedPaths.push(...loadedDirectoryPaths(tree.value, directoryPath));
    }
    if (requestId === treeRequestId) {
      preexpandedDirectoryPaths.value = normalizePolicyDirectories(expandedPaths);
      revealLoadedFilePath(selectedPath.value);
    }
  }

  function revealLoadedFilePath(filePath = "") {
    const ancestors = loadedFileAncestorDirectoryPaths(tree.value, filePath);
    if (ancestors) {
      revealedDirectoryPaths.value = normalizePolicyDirectories(ancestors);
    }
  }

  async function loadTree() {
    const requestId = treeRequestId + 1;
    treeRequestId = requestId;
    tree.value = null;
    policy.value = normalizeSourceEditorPolicy({});
    preexpandedDirectoryPaths.value = [];
    revealedDirectoryPaths.value = [];
    treeDirectoryRequestIds.clear();
    treeLoadingPaths.value = [];
    treeLoadErrors.value = {};
    loadError.value = "";
    if (!canLoad.value) {
      return;
    }
    loadingTree.value = true;
    await loadDirectoryPage("", {
      append: false,
      offset: 0
    });
    if (requestId !== treeRequestId) {
      return;
    }
    await loadPolicyDirectories(requestId);
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
      savedHash.value = String(file.hash || "");
      dirty.value = false;
      revealLoadedFilePath(selectedPath.value);
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

  function clearExplanationStream() {
    explanationRequestId += 1;
    explanationAbortController?.abort?.();
    explanationAbortController = null;
  }

  function markActiveExplanationMessage(status = "", text = "") {
    const explanation = activeExplanation.value;
    const lastAssistant = [...(explanation?.messages || [])].reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant?.id) {
      return;
    }
    activeExplanation.value = sourceEditorExplanationWithMessage(explanation, lastAssistant.id, {
      status,
      text: text || lastAssistant.text
    });
  }

  function applyExplanationStreamEvent(event = {}, requestId = explanationRequestId) {
    if (requestId !== explanationRequestId) {
      return;
    }
    if (event.type === "source-explanation.error" || event.ok === false) {
      const message = resolveResponseErrorMessage(event, "Source explanation failed.");
      explanationError.value = message;
      markActiveExplanationMessage("failed", message);
      throw new Error(message);
    }
    const eventExplanation = normalizeExplanation(event.explanation);
    if (event.type === "source-explanation.started" || event.type === "source-explanation.followup.started") {
      if (eventExplanation) {
        activeExplanation.value = eventExplanation;
      }
      return;
    }
    if (event.type === "source-explanation.thread" || event.type === "source-explanation.turn") {
      if (!activeExplanation.value) {
        return;
      }
      activeExplanation.value = {
        ...activeExplanation.value,
        agentThreadId: String(event.threadId || activeExplanation.value.agentThreadId || ""),
        agentTurnId: String(event.turnId || activeExplanation.value.agentTurnId || "")
      };
      return;
    }
    if (event.type === "source-explanation.message" && event.messageId) {
      activeExplanation.value = sourceEditorExplanationWithMessage(activeExplanation.value, String(event.messageId), {
        status: String(event.status || "thinking"),
        text: String(event.text || "")
      });
      return;
    }
    if (event.type === "source-explanation.finished" && eventExplanation) {
      activeExplanation.value = eventExplanation;
    }
  }

  async function streamSourceEditorRequest(url = "", body = {}, requestId = explanationRequestId) {
    const controller = new AbortController();
    explanationAbortController = controller;
    await getUsersWebHttpClient().requestStream(url, {
      body,
      method: "POST",
      signal: controller.signal
    }, {
      onEvent(event) {
        applyExplanationStreamEvent(event, requestId);
      }
    });
  }

  async function explainSelection(range = {}) {
    if (!selectedPath.value || !canLoad.value || explanationBusy.value) {
      return;
    }
    const requestId = explanationRequestId + 1;
    explanationRequestId = requestId;
    explanationAbortController?.abort?.();
    explanationAbortController = null;
    const explanationId = sourceEditorClientId("exp");
    const userMessageId = sourceEditorClientId("msg");
    const assistantMessageId = sourceEditorClientId("msg");
    const previousExplanation = activeExplanation.value;
    activeExplanation.value = localSourceExplanation({
      assistantMessageId,
      explanationId,
      filePath: selectedPath.value,
      range,
      userMessageId
    });
    explanationBusy.value = true;
    explanationError.value = "";
    explanationFollowup.value = "";
    if (previousExplanation?.id) {
      void disposeExplanation(previousExplanation).catch(() => null);
    }
    try {
      await streamSourceEditorRequest(vibe64SourceEditorExplanationsStreamPath(
        currentSessionsApiPath.value,
        currentSessionId.value
      ), {
        assistantMessageId,
        endColumn: range.endColumn,
        endLine: range.endLine,
        explanationId,
        force: range.force === true,
        path: selectedPath.value,
        scope: range.scope,
        startColumn: range.startColumn,
        startLine: range.startLine,
        userMessageId
      }, requestId);
    } catch (error) {
      if (String(error?.name || "") === "AbortError") {
        return;
      }
      if (requestId === explanationRequestId) {
        const message = String(error?.message || error || "Source explanation could not be created.");
        explanationError.value = message;
        markActiveExplanationMessage("failed", message);
      }
    } finally {
      if (requestId === explanationRequestId) {
        explanationBusy.value = false;
        explanationAbortController = null;
      }
    }
  }

  async function stopExplanation() {
    const explanation = activeExplanation.value;
    if (!explanation?.id) {
      return;
    }
    explanationRequestId += 1;
    const controller = explanationAbortController;
    explanationAbortController = null;
    explanationBusy.value = false;
    markActiveExplanationMessage("stopped", "Stopped.");
    controller?.abort?.();
    if (!canLoad.value) {
      return;
    }
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorExplanationStopPath(
        currentSessionsApiPath.value,
        currentSessionId.value,
        explanation.id
      ), {
        method: "POST"
      });
      const explanation = normalizeExplanation(response.explanation);
      if (explanation) {
        activeExplanation.value = explanation;
      }
    } catch (error) {
      explanationError.value = String(error?.message || error || "Source explanation could not be stopped.");
    }
  }

  async function disposeExplanation(explanation = null, {
    sessionsApiPath: apiPath = currentSessionsApiPath.value,
    sessionId: targetSessionId = currentSessionId.value
  } = {}) {
    const id = String(explanation?.id || "").trim();
    if (!id || !apiPath || !targetSessionId) {
      return true;
    }
    const requestId = explanationDeleteRequestId + 1;
    explanationDeleteRequestId = requestId;
    try {
      await sourceEditorRequest(vibe64SourceEditorExplanationPath(
        apiPath,
        targetSessionId,
        id
      ), {
        method: "DELETE"
      });
      return true;
    } catch (error) {
      if (requestId === explanationDeleteRequestId) {
        explanationError.value = String(error?.message || error || "Source explanation cleanup failed.");
      }
      return false;
    }
  }

  async function disposeActiveExplanation(options = {}) {
    const explanation = activeExplanation.value;
    if (!explanation) {
      return true;
    }
    const disposed = await disposeExplanation(explanation, options);
    if (disposed && activeExplanation.value?.id === explanation.id) {
      activeExplanation.value = null;
      explanationFollowup.value = "";
    }
    return disposed;
  }

  function closeExplanation() {
    clearExplanationStream();
    void disposeActiveExplanation();
  }

  function updateExplanationFollowup(value = "") {
    explanationFollowup.value = String(value || "");
  }

  async function sendExplanationFollowup() {
    const message = explanationFollowup.value.trim();
    const explanationId = activeExplanation.value?.id || "";
    if (!message || !explanationId || !canLoad.value || explanationBusy.value) {
      return;
    }
    const requestId = explanationRequestId + 1;
    explanationRequestId = requestId;
    explanationAbortController?.abort?.();
    explanationAbortController = null;
    const createdAt = nowIso();
    const userMessageId = sourceEditorClientId("msg");
    const assistantMessageId = sourceEditorClientId("msg");
    activeExplanation.value = appendSourceEditorExplanationMessages(activeExplanation.value, [
      {
        createdAt,
        id: userMessageId,
        role: "user",
        status: "complete",
        text: message
      },
      {
        createdAt,
        id: assistantMessageId,
        role: "assistant",
        status: "thinking",
        text: ""
      }
    ]);
    explanationBusy.value = true;
    explanationError.value = "";
    explanationFollowup.value = "";
    try {
      await streamSourceEditorRequest(vibe64SourceEditorExplanationFollowupsStreamPath(
        currentSessionsApiPath.value,
        currentSessionId.value,
        explanationId
      ), {
        assistantMessageId,
        message,
        userMessageId
      }, requestId);
    } catch (error) {
      if (String(error?.name || "") === "AbortError") {
        return;
      }
      if (requestId === explanationRequestId) {
        const errorMessage = String(error?.message || error || "Source explanation follow-up could not be sent.");
        explanationError.value = errorMessage;
        markActiveExplanationMessage("failed", errorMessage);
      }
    } finally {
      if (requestId === explanationRequestId) {
        explanationBusy.value = false;
        explanationAbortController = null;
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

  function updateText() {
    dirty.value = true;
    saveError.value = "";
    scheduleSave();
  }

  function currentText() {
    return typeof readCurrentText === "function"
      ? String(readCurrentText() ?? "")
      : text.value;
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
    const textAtSave = currentText();
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
        text.value = textAtSave;
        dirty.value = currentText() !== textAtSave;
      }
    } catch (error) {
      if (selectedPath.value === pathAtSave) {
        saveError.value = String(error?.message || error || "Source file could not be saved.");
      }
    } finally {
      saving.value = false;
      if (queuedSave || (selectedPath.value === pathAtSave && currentText() !== textAtSave)) {
        queuedSave = false;
        dirty.value = true;
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

  watch([currentSessionsApiPath, currentSessionId], (_current, previous = []) => {
    clearExplanationStream();
    if (activeExplanation.value) {
      void disposeActiveExplanation({
        sessionsApiPath: previous[0] || currentSessionsApiPath.value,
        sessionId: previous[1] || currentSessionId.value
      });
    }
    resetDiscoveryState();
    selectedPath.value = "";
    text.value = "";
    savedHash.value = "";
    dirty.value = false;
    activeExplanation.value = null;
    explanationFollowup.value = "";
    void loadTree();
  }, {
    immediate: true
  });

  onBeforeUnmount(() => {
    clearExplanationStream();
    clearAutosave();
    clearFileMatchesTimer();
    clearSearchTimer();
    void disposeActiveExplanation();
    void saveNow();
  });

  return {
    activeExplanation,
    closeExplanation,
    cursorRequest,
    dirty,
    explanationBusy,
    explanationError,
    explanationFollowup,
    explainSelection,
    fileMatches,
    fileMatchesError,
    fileMatchesLoading,
    fileMatchesTruncated,
    fileQuery,
    loadError,
    loadedVersion,
    loadDirectory,
    loadMoreDirectory,
    loadingFile,
    loadingTree,
    openFile,
    openFileMatch,
    openFirstFileMatch,
    openRequest,
    openSearchResult,
    policy,
    preexpandedDirectoryPaths,
    refresh: loadTree,
    revealedDirectoryPaths,
    saveError,
    saveNow,
    savedHash,
    searchError,
    searchLoading,
    searchQuery,
    searchResults,
    searchTruncated,
    selectedPath,
    sendExplanationFollowup,
    saving,
    stopExplanation,
    statusLabel,
    text,
    tree,
    treeLoadErrors,
    treeLoadingPaths,
    updateExplanationFollowup,
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
