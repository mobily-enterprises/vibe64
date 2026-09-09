import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import {
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";

import {
  useVibe64SourceEditorFileSync
} from "@/composables/useVibe64SourceEditorFileSync.js";
import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  vibe64SourceEditorCreateFilePath,
  vibe64SourceEditorExplanationFollowupsStreamPath,
  vibe64SourceEditorExplanationPath,
  vibe64SourceEditorExplanationStopPath,
  vibe64SourceEditorExplanationsCleanupPath,
  vibe64SourceEditorExplanationsStreamPath,
  vibe64SourceEditorFilePath,
  vibe64SourceEditorFilesPath,
  vibe64SourceEditorResolvePathPath,
  vibe64SourceEditorSearchPath,
  vibe64SourceEditorTreePath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64ApiResponseError
} from "@/lib/vibe64ApiResponses.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64BrowserTabOriginId,
  vibe64RealtimePayloadFromCurrentTab
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const SOURCE_EDITOR_AUTOSAVE_DELAY_MS = 700;
const SOURCE_EDITOR_FILE_MATCH_DELAY_MS = 120;
const SOURCE_EDITOR_SEARCH_DELAY_MS = 260;
const SOURCE_EDITOR_TREE_PAGE_SIZE = 20;
const SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE = "This file changed in another window. Reload it before saving.";
let sourceExplanationClientIdCounter = 0;

function normalizeEditorPath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function normalizeSourceEditorSyncValue(value = "") {
  return String(value || "").trim();
}

function sourceEditorFileChangePayloadMatches({
  originId = vibe64BrowserTabOriginId(),
  path = "",
  payload = {},
  projectSlug = "",
  sessionId = ""
} = {}) {
  const normalizedPath = normalizeEditorPath(path);
  const normalizedProjectSlug = normalizeSourceEditorSyncValue(projectSlug);
  const normalizedSessionId = normalizeSourceEditorSyncValue(sessionId);
  if (
    !normalizedPath ||
    !normalizedProjectSlug ||
    !normalizedSessionId ||
    normalizeEditorPath(payload?.path) !== normalizedPath ||
    normalizeSourceEditorSyncValue(payload?.projectSlug) !== normalizedProjectSlug ||
    normalizeSourceEditorSyncValue(payload?.sessionId) !== normalizedSessionId ||
    vibe64RealtimePayloadFromCurrentTab(payload, {
      originId
    })
  ) {
    return false;
  }
  return Boolean(normalizeSourceEditorSyncValue(payload?.hash));
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

function normalizeResolvedSourceEditorPath(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return {
    path: normalizeEditorPath(source.path || source.file?.path),
    resolved: source.resolved === true
  };
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

function normalizeExplanationExecutionProfile(value = null) {
  try {
    return vibe64AgentExecutionProfileAuditSnapshot(value);
  } catch {
    return null;
  }
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
    agentSettings: null,
    agentTurnId: String(value.agentTurnId || ""),
    body: String(value.body || ""),
    createdAt: String(value.createdAt || ""),
    engine: String(value.engine || ""),
    error: String(value.error || ""),
    executionProfile: normalizeExplanationExecutionProfile(value.executionProfile),
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
  const byKey = new Map((existingChildren || []).map((child) => [treeNodeKey(child), child]));
  const mergedChildren = pageChildren.map((child) => {
    const previous = byKey.get(treeNodeKey(child));
    return child.type === "directory" && previous?.loaded && !child.loaded
      ? { ...child, ...previous, name: child.name }
      : child;
  });
  if (!append) {
    return mergedChildren;
  }
  for (const child of mergedChildren) {
    byKey.set(treeNodeKey(child), child);
  }
  return [...byKey.values()];
}

function treeNodeKey(node = {}) {
  return normalizeEditorPath(node.path) || String(node.name || "");
}

function sortTreeNodes(children = []) {
  return [...children].sort((left, right) => {
    if (left?.type !== right?.type) {
      return left?.type === "directory" ? -1 : 1;
    }
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  });
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

function mergeRevealedTreeNode(existing = null, reveal = null) {
  const normalizedReveal = normalizeTreeNode(reveal);
  if (!normalizedReveal) {
    return normalizeTreeNode(existing);
  }
  const normalizedExisting = normalizeTreeNode(existing);
  if (!normalizedExisting || treeNodeKey(normalizedExisting) !== treeNodeKey(normalizedReveal)) {
    return normalizedReveal;
  }
  if (normalizedExisting.type !== "directory" || normalizedReveal.type !== "directory") {
    return normalizedExisting;
  }
  const childrenByKey = new Map((normalizedExisting.children || [])
    .map((child) => [treeNodeKey(child), child]));
  for (const child of normalizedReveal.children || []) {
    const key = treeNodeKey(child);
    childrenByKey.set(key, mergeRevealedTreeNode(childrenByKey.get(key), child));
  }
  return {
    ...normalizedExisting,
    children: sortTreeNodes([...childrenByKey.values()])
  };
}

function mergeRevealTree(root = null, revealTree = null) {
  const normalizedReveal = normalizeTreeNode(revealTree);
  if (!normalizedReveal) {
    return root;
  }
  return mergeRevealedTreeNode(root, normalizedReveal);
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

function loadedTreeDirectoryPaths(root = null) {
  const paths = [];
  function visit(node = null) {
    if (!node || node.type !== "directory") {
      return;
    }
    const normalizedPath = normalizeEditorPath(node.path);
    if (normalizedPath && node.loaded === true) {
      paths.push(normalizedPath);
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      visit(child);
    }
  }
  visit(root);
  return [...new Set(paths)].sort((left, right) => {
    const depthDifference = left.split("/").length - right.split("/").length;
    return depthDifference || left.localeCompare(right);
  });
}

async function sourceEditorRequest(url = "", options = {}) {
  const payload = await getHttpWebClient().request(url, options);
  if (payload?.ok === false) {
    const message = vibe64ApiResponseError(payload, "Source editor request failed.");
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
    agentSettings: null,
    agentTurnId: "",
    body: "",
    createdAt,
    engine: "agent-chat",
    error: "",
    executionProfile: null,
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
    model: "",
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
  active = true,
  agentActive = false,
  navigateReferencedSource = null,
  projectSlug,
  readCurrentText = null,
  sessionsApiPath,
  sessionId
} = {}) {
  const originId = vibe64BrowserTabOriginId();
  const explanationFeedback = useUiFeedback({ source: "vibe64.source-editor.explanation.feedback" });
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
  const explanationClosing = ref(false);
  const explanationFollowup = ref("");
  const loadFailure = ref(null);
  const loadError = computed(() => loadFailure.value?.message || "");
  const downloadOnlyFile = ref(null);
  const saveError = ref("");
  const createFileError = ref("");
  const creatingFile = ref(false);
  const loadingTree = ref(false);
  const loadingFile = ref(false);
  const loadingPath = ref("");
  const saving = ref(false);
  const loadedVersion = ref(0);
  const cursorRequest = ref(null);
  const preexpandedDirectoryPaths = ref([]);
  const revealedDirectoryPaths = ref([]);
  const selectedRevealTree = ref(null);
  let treeRequestId = 0;
  const treeDirectoryRequestIds = new Map();
  let createFileRequestId = 0;
  let fileRequestId = 0;
  let fileRevalidationRequestId = 0;
  let fileMatchesRequestId = 0;
  let searchRequestId = 0;
  let explanationRequestId = 0;
  let explanationAbortController = null;
  let autosaveTimer = null;
  let fileMatchesTimer = null;
  let searchTimer = null;
  let pendingFileRevalidation = false;
  let pendingTreeRefresh = false;
  let refreshPromise = null;
  let savePromise = null;
  let textAtUnmount = null;
  let disposed = false;
  const currentSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const currentSessionId = computed(() => String(readRefOrGetterValue(sessionId) || "").trim());
  const currentProjectSlug = computed(() => String(readRefOrGetterValue(projectSlug) || "").trim());
  const currentActive = computed(() => readRefOrGetterValue(active) !== false);
  const canLoad = computed(() => Boolean(currentSessionsApiPath.value && currentSessionId.value));
  const statusLabel = computed(() => {
    if (saveError.value) {
      return saveError.value;
    }
    if (loadingFile.value) {
      return "Opening...";
    }
    if (saving.value) {
      return "Saving...";
    }
    if (dirty.value) {
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
      void applyRemoteFileChange(payload);
      if (payload.operation === "created") {
        if (currentActive.value) {
          void loadTree();
        } else {
          pendingTreeRefresh = true;
        }
      }
    }
  });

  useVibe64SourceEditorFileSync({
    active: computed(() => canLoad.value && currentActive.value),
    onChange: (payload = {}) => {
      void applyObservedFileChange(payload);
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
      void revalidateSelectedFile();
    },
    path: selectedPath,
    sessionId: currentSessionId,
    sessionsApiPath: currentSessionsApiPath
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
    applyPage = true,
    append = false,
    offset = 0
  } = {}) {
    const normalizedPath = treePathKey(directoryPath);
    if (!canLoad.value || disposed) {
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
      if (!normalizedPath) {
        preexpandedDirectoryPaths.value = normalizePolicyDirectories(
          (policy.value.preexpandedDirectories || [])
            .flatMap((directoryPath) => loadedDirectoryPaths(tree.value, directoryPath))
        );
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
      revealedDirectoryPaths.value = normalizePolicyDirectories(ancestors);
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
      preexpandedDirectoryPaths.value = [];
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
        if (disposed || (refreshingLoadedTree && !currentActive.value)) {
          pendingTreeRefresh = !disposed;
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
    preexpandedDirectoryPaths.value = normalizePolicyDirectories(
      (policy.value.preexpandedDirectories || []).flatMap((directoryPath) => loadedDirectoryPaths(tree.value, directoryPath))
    );
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

  function applyFileResponse(response = {}, {
    column = 0,
    fallbackPath = "",
    line = 0,
    reveal = true
  } = {}) {
    const file = response.file || {};
    const filePath = normalizeEditorPath(file.path || fallbackPath);
    if (!filePath) {
      return false;
    }
    selectedPath.value = filePath;
    downloadOnlyFile.value = null;
    selectedRevealTree.value = normalizeTreeNode(response.revealTree);
    if (selectedRevealTree.value) {
      tree.value = mergeRevealTree(tree.value, selectedRevealTree.value);
    }
    text.value = String(file.text || "");
    savedHash.value = String(file.hash || "");
    dirty.value = false;
    if (reveal) revealLoadedFilePath(filePath);
    cursorRequest.value = {
      column: Number(column || 0) || 0,
      line: Number(line || 0) || 0,
      path: filePath,
      version: loadedVersion.value + 1
    };
    loadedVersion.value += 1;
    return true;
  }

  async function openFile(filePath = "", options = {}) {
    const normalizedPath = normalizeEditorPath(filePath);
    if (!normalizedPath || !canLoad.value) {
      return false;
    }
    if ((dirty.value || saving.value) && !await saveNow()) {
      return false;
    }
    const requestId = fileRequestId + 1;
    fileRequestId = requestId;
    fileRevalidationRequestId += 1;
    loadFailure.value = null;
    saveError.value = "";
    loadingFile.value = true;
    loadingPath.value = normalizedPath;
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorFilePath(
        currentSessionsApiPath.value,
        currentSessionId.value,
        normalizedPath
      ));
      if (requestId !== fileRequestId) {
        return false;
      }
      if (!applyFileResponse(response, {
        column: options.column,
        fallbackPath: normalizedPath,
        line: options.line
      })) {
        return false;
      }
      return true;
    } catch (error) {
      if (requestId === fileRequestId) {
        const code = error?.code || error?.payload?.code;
        if (code === "vibe64_source_editor_binary_file" || code === "vibe64_source_editor_file_too_large") {
          // Keep non-text files out of the editable buffer and its autosave/file-sync paths.
          selectedPath.value = "";
          selectedRevealTree.value = null;
          text.value = "";
          savedHash.value = "";
          downloadOnlyFile.value = {
            path: normalizedPath,
            message: code === "vibe64_source_editor_binary_file"
              ? "This file cannot be edited as text. Download it to open it in another application."
              : "This file is too large to edit here. You can download the complete file."
          };
          revealLoadedFilePath(normalizedPath);
          return true;
        }
        loadFailure.value = {
          operation: "open-file",
          message: String(error?.message || error || "Source file could not be loaded.")
        };
      }
      return false;
    } finally {
      if (requestId === fileRequestId) {
        loadingFile.value = false;
        loadingPath.value = "";
      }
    }
  }

  async function createFile(filePath = "") {
    const normalizedPath = normalizeEditorPath(filePath);
    if (!normalizedPath || !canLoad.value || creatingFile.value) {
      return false;
    }
    if ((dirty.value || saving.value) && !await saveNow()) {
      return false;
    }
    const createRequestId = createFileRequestId + 1;
    createFileRequestId = createRequestId;
    const fileSelectionRequestId = fileRequestId + 1;
    fileRequestId = fileSelectionRequestId;
    fileRevalidationRequestId += 1;
    createFileError.value = "";
    loadFailure.value = null;
    saveError.value = "";
    creatingFile.value = true;
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorCreateFilePath(
        currentSessionsApiPath.value,
        currentSessionId.value
      ), {
        body: {
          originId,
          path: normalizedPath,
          projectSlug: currentProjectSlug.value
        },
        method: "POST"
      });
      if (fileSelectionRequestId !== fileRequestId) {
        return false;
      }
      if (!applyFileResponse(response, {
        fallbackPath: normalizedPath
      })) {
        return false;
      }
      return true;
    } catch (error) {
      if (fileSelectionRequestId === fileRequestId) {
        createFileError.value = String(error?.message || error || "Source file could not be created.");
      }
      return false;
    } finally {
      if (createRequestId === createFileRequestId) {
        creatingFile.value = false;
      }
    }
  }

  async function revalidateSelectedFile() {
    const pathAtRequest = selectedPath.value;
    const sessionIdAtRequest = currentSessionId.value;
    if (disposed || !pathAtRequest || !canLoad.value || !currentActive.value) {
      return false;
    }
    if (saving.value) {
      pendingFileRevalidation = true;
      return false;
    }
    const requestId = fileRevalidationRequestId + 1;
    fileRevalidationRequestId = requestId;
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorFilePath(
        currentSessionsApiPath.value,
        sessionIdAtRequest,
        pathAtRequest
      ));
      if (
        requestId !== fileRevalidationRequestId ||
        selectedPath.value !== pathAtRequest ||
        currentSessionId.value !== sessionIdAtRequest
      ) {
        return false;
      }
      if (loadFailure.value?.operation === "revalidation") {
        loadFailure.value = null;
      }
      selectedRevealTree.value = normalizeTreeNode(response.revealTree);
      if (selectedRevealTree.value) {
        tree.value = mergeRevealTree(tree.value, selectedRevealTree.value);
      }
      const nextHash = String(response.file?.hash || "");
      if (dirty.value || saving.value) {
        if (nextHash && nextHash !== savedHash.value) {
          saveError.value = SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE;
        } else if (saveError.value === SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE) {
          saveError.value = "";
        }
        return false;
      }
      if (!nextHash || nextHash === savedHash.value) {
        return false;
      }
      return applyFileResponse(response, {
        fallbackPath: pathAtRequest,
        reveal: false
      });
    } catch (error) {
      if (
        requestId === fileRevalidationRequestId &&
        selectedPath.value === pathAtRequest &&
        currentSessionId.value === sessionIdAtRequest
      ) {
        loadFailure.value = {
          operation: "revalidation",
          message: String(error?.message || error || "Source file could not be refreshed.")
        };
      }
      return false;
    }
  }

  async function applySelectedFileChange({
    hash = "",
    path = ""
  } = {}) {
    const changedPath = normalizeEditorPath(path);
    const changedHash = normalizeSourceEditorSyncValue(hash);
    if (!changedPath || changedPath !== selectedPath.value || (changedHash && changedHash === savedHash.value)) {
      return;
    }
    if (saving.value) {
      pendingFileRevalidation = true;
      return;
    }
    if (dirty.value && changedHash) {
      saveError.value = SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE;
      return;
    }
    await revalidateSelectedFile();
  }

  async function applyRemoteFileChange(payload = {}) {
    if (
      !sourceEditorFileChangePayloadMatches({
        originId,
        path: selectedPath.value,
        payload,
        projectSlug: currentProjectSlug.value,
        sessionId: currentSessionId.value
      })
    ) {
      return;
    }
    await applySelectedFileChange(payload);
  }

  async function applyObservedFileChange(payload = {}) {
    if (
      normalizeSourceEditorSyncValue(payload.sessionId) !== currentSessionId.value ||
      normalizeEditorPath(payload.path) !== selectedPath.value
    ) {
      return;
    }
    await applySelectedFileChange(payload);
  }

  function cleanupAbandonedExplanations() {
    if (!canLoad.value) {
      return;
    }
    const activeExplanationIds = activeExplanation.value?.id
      ? [activeExplanation.value.id]
      : [];
    void sourceEditorRequest(vibe64SourceEditorExplanationsCleanupPath(
      currentSessionsApiPath.value,
      currentSessionId.value
    ), {
      body: {
        activeExplanationIds,
        originId
      },
      method: "POST"
    }).catch((error) => {
      vibe64SessionDebugLog("client.sourceEditor.explanations.cleanup.error", {
        error: vibe64SessionDebugError(error),
        sessionId: currentSessionId.value
      });
    });
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

  async function openReferencedSourcePath({
    fromPath = selectedPath.value,
    target = ""
  } = {}) {
    const normalizedFromPath = normalizeEditorPath(fromPath);
    const normalizedTarget = String(target || "").trim();
    if (!normalizedFromPath || !normalizedTarget || !canLoad.value) {
      return false;
    }
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorResolvePathPath(
        currentSessionsApiPath.value,
        currentSessionId.value
      ), {
        body: {
          fromPath: normalizedFromPath,
          target: normalizedTarget
        },
        method: "POST"
      });
      const resolved = normalizeResolvedSourceEditorPath(response);
      if (!resolved.resolved || !resolved.path) {
        return false;
      }
      if (typeof navigateReferencedSource === "function") {
        try {
          const handled = await navigateReferencedSource({
            fromPath: normalizedFromPath,
            path: resolved.path,
            target: normalizedTarget
          });
          if (handled === true) {
            return true;
          }
        } catch {
          // Fall back to the normal in-editor file switch.
        }
      }
      await openFile(resolved.path);
      return true;
    } catch {
      return false;
    }
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
    explanationBusy.value = false;
  }

  function markActiveExplanationMessage(status = "", text = "") {
    const explanation = activeExplanation.value;
    const lastAssistant = [...(explanation?.messages || [])].reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant?.id) {
      return;
    }
    const nextExplanation = sourceEditorExplanationWithMessage(explanation, lastAssistant.id, {
      status,
      text: text || lastAssistant.text
    });
    activeExplanation.value = status === "failed"
      ? {
          ...nextExplanation,
          error: text || nextExplanation?.error || "Source explanation failed.",
          status: "failed"
        }
      : nextExplanation;
  }

  function applyExplanationStreamEvent(event = {}, requestId = explanationRequestId) {
    if (requestId !== explanationRequestId) {
      return;
    }
    if (event.type === "source-explanation.error" || event.ok === false) {
      const message = vibe64ApiResponseError(event, "Source explanation failed.");
      explanationError.value = message;
      markActiveExplanationMessage("failed", message);
      throw new Error(message);
    }
    const eventExplanation = normalizeExplanation(event.explanation);
    if (event.type === "source-explanation.failed") {
      const message = vibe64ApiResponseError(event, "Source explanation failed.");
      explanationError.value = message;
      if (eventExplanation) {
        activeExplanation.value = eventExplanation;
      } else {
        markActiveExplanationMessage("failed", message);
      }
      return;
    }
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
    if (event.type === "source-explanation.execution-profile" && eventExplanation) {
      activeExplanation.value = eventExplanation;
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
      if (eventExplanation.status !== "failed") {
        explanationError.value = "";
      }
    }
  }

  async function streamSourceEditorRequest(url = "", body = {}, requestId = explanationRequestId) {
    const controller = new AbortController();
    explanationAbortController = controller;
    await getHttpWebClient().requestStream(url, {
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
    if (!selectedPath.value || !canLoad.value || explanationBusy.value || explanationClosing.value) {
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
        originId,
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

  async function retryExplanation() {
    const explanation = activeExplanation.value;
    const range = explanation?.sourceRange || {};
    const explanationPath = normalizeEditorPath(range.path);
    if (!explanationPath || explanationBusy.value || explanationClosing.value) {
      return;
    }
    if (selectedPath.value !== explanationPath) {
      await openFile(explanationPath);
      if (selectedPath.value !== explanationPath) {
        return;
      }
    }
    await explainSelection({
      ...range,
      force: true
    });
  }

  async function stopExplanation() {
    const explanation = activeExplanation.value;
    if (!explanation?.id || explanationClosing.value) {
      return;
    }
    const requestId = explanationRequestId + 1;
    explanationRequestId = requestId;
    const controller = explanationAbortController;
    explanationAbortController = null;
    explanationBusy.value = false;
    explanationError.value = "";
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
      if (requestId !== explanationRequestId || activeExplanation.value?.id !== explanation.id) {
        return;
      }
      const stoppedExplanation = normalizeExplanation(response.explanation);
      if (stoppedExplanation) {
        activeExplanation.value = stoppedExplanation;
      }
    } catch (error) {
      if (requestId === explanationRequestId && activeExplanation.value?.id === explanation.id) {
        explanationFeedback.error(error, "Source explanation could not be stopped.");
      }
    }
  }

  async function disposeExplanation(explanation = null, {
    onError = null,
    sessionsApiPath: apiPath = currentSessionsApiPath.value,
    sessionId: targetSessionId = currentSessionId.value
  } = {}) {
    const id = String(explanation?.id || "").trim();
    if (!id || !apiPath || !targetSessionId) {
      return true;
    }
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
      vibe64SessionDebugLog("client.sourceEditor.explanations.cleanup.error", {
        error: vibe64SessionDebugError(error),
        sessionId: targetSessionId
      });
      onError?.(error);
      return false;
    }
  }

  async function disposeActiveExplanation(options = {}) {
    const explanation = activeExplanation.value;
    if (!explanation) {
      return true;
    }
    const requestId = explanationRequestId;
    const disposed = await disposeExplanation(explanation, options);
    if (disposed && requestId === explanationRequestId && activeExplanation.value?.id === explanation.id) {
      activeExplanation.value = null;
      explanationFollowup.value = "";
    }
    return disposed;
  }

  async function closeExplanation() {
    const explanation = activeExplanation.value;
    if (!explanation?.id || explanationClosing.value) {
      return false;
    }
    clearExplanationStream();
    const requestId = explanationRequestId;
    explanationClosing.value = true;
    explanationError.value = "";
    try {
      const disposed = await disposeActiveExplanation({
        onError(error) {
          if (requestId === explanationRequestId && activeExplanation.value?.id === explanation.id) {
            explanationFeedback.error(error, "Source explanation cleanup failed. Close it again to retry.");
          }
        }
      });
      return disposed && requestId === explanationRequestId;
    } finally {
      if (requestId === explanationRequestId) {
        explanationClosing.value = false;
      }
    }
  }

  function updateExplanationFollowup(value = "") {
    explanationFollowup.value = String(value || "");
  }

  async function sendExplanationFollowup() {
    const message = explanationFollowup.value.trim();
    const explanation = activeExplanation.value;
    const explanationId = explanation?.id || "";
    if (
      !message ||
      !explanationId ||
      !canLoad.value ||
      explanationBusy.value ||
      explanationClosing.value
    ) {
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
    if (textAtUnmount !== null) {
      return textAtUnmount;
    }
    return typeof readCurrentText === "function"
      ? String(readCurrentText() ?? "")
      : text.value;
  }

  async function saveDirtyBuffers() {
    while (selectedPath.value && dirty.value) {
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
            originId,
            path: pathAtSave,
            projectSlug: currentProjectSlug.value,
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
        return false;
      } finally {
        saving.value = false;
      }
    }

    if (pendingFileRevalidation) {
      pendingFileRevalidation = false;
      void revalidateSelectedFile();
    }
    return !dirty.value;
  }

  function saveNow() {
    clearAutosave();
    if (savePromise) {
      return savePromise;
    }
    savePromise = saveDirtyBuffers().finally(() => {
      savePromise = null;
    });
    return savePromise;
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

  function refresh() {
    if (refreshPromise) {
      pendingTreeRefresh = true;
      return refreshPromise;
    }
    refreshPromise = (async () => {
      do {
        pendingTreeRefresh = false;
        selectedRevealTree.value = null;
        await loadTree();
        await revalidateSelectedFile();
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
    window.addEventListener("focus", revalidateSelectedFile);
  }

  watch([currentSessionsApiPath, currentSessionId, currentActive], async (current, previous = []) => {
    if (current[0] === previous[0] && current[1] === previous[1]) {
      if (current[2] && pendingTreeRefresh) {
        await refresh();
      }
      return;
    }
    pendingTreeRefresh = false;
    const closePending = explanationClosing.value;
    clearExplanationStream();
    explanationClosing.value = false;
    if (activeExplanation.value && !closePending) {
      void disposeActiveExplanation({
        sessionsApiPath: previous[0] || currentSessionsApiPath.value,
        sessionId: previous[1] || currentSessionId.value
      });
    }
    resetDiscoveryState();
    fileRequestId += 1;
    loadingFile.value = false;
    loadingPath.value = "";
    fileRevalidationRequestId += 1;
    pendingFileRevalidation = false;
    selectedPath.value = "";
    downloadOnlyFile.value = null;
    selectedRevealTree.value = null;
    text.value = "";
    savedHash.value = "";
    dirty.value = false;
    activeExplanation.value = null;
    explanationFollowup.value = "";
    await loadTree({
      preserveLoadedDirectories: false
    });
    cleanupAbandonedExplanations();
  }, {
    immediate: true
  });

  onBeforeUnmount(() => {
    disposed = true;
    treeRequestId += 1;
    fileRequestId += 1;
    fileRevalidationRequestId += 1;
    textAtUnmount = currentText();
    const closePending = explanationClosing.value;
    clearExplanationStream();
    explanationClosing.value = false;
    clearAutosave();
    clearFileMatchesTimer();
    clearSearchTimer();
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", revalidateSelectedFile);
    }
    if (!closePending) {
      void disposeActiveExplanation();
    }
    void saveNow();
  });

  return {
    activeExplanation,
    closeExplanation,
    createFile,
    createFileError,
    creatingFile,
    cursorRequest,
    dirty,
    downloadOnlyFile,
    explanationBusy,
    explanationClosing,
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
    loadingPath,
    loadingTree,
    openFile,
    openFileMatch,
    openFirstFileMatch,
    openReferencedSourcePath,
    openRequest,
    openSearchResult,
    policy,
    preexpandedDirectoryPaths,
    refresh,
    retryExplanation,
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
  SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE,
  SOURCE_EDITOR_SEARCH_DELAY_MS,
  sourceEditorFileChangePayloadMatches,
  useVibe64SourceEditor
};
