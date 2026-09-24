import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import {
  vibe64RepositoryHistoryPath,
  vibe64RepositoryVersionDiffPath,
  vibe64RepositoryVersionFilesPath,
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  vibe64SessionChangeDiffPath,
  vibe64SessionCheckUpdatesPath,
  vibe64SessionChangesPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  repositoryStatusRealtimeNeedsCanonicalCheck,
  repositoryStatusRealtimeShouldRefresh,
  repositoryStatusSessionId
} from "@/lib/vibe64RepositoryRealtime.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

function message(error, fallback) {
  return error instanceof Error ? error.message : String(error || fallback);
}

async function requestJson(path, options = {}) {
  if (!path) {
    throw new Error("Repository information is not available yet.");
  }
  const result = await getHttpWebClient().request(path, {
    method: "GET",
    ...options
  });
  if (result?.ok === false) {
    const error = new Error(vibe64ApiResponseError(result, "Repository information could not be loaded."));
    error.code = String(result.code || result.errors?.[0]?.code || "").trim();
    error.response = result;
    throw error;
  }
  return result;
}

function useVibe64RepositoryWorkspace(dashboardContext, { view = "changes" } = {}) {
  const selectedCurrentPath = ref("");
  const selectedVersion = ref(null);
  const selectedVersionPath = ref("");
  const changes = reactive({ error: "", loading: false, loadingMore: false, payload: null });
  const currentDiff = reactive({ error: "", loading: false, payload: null });
  const history = reactive({
    error: "",
    loading: false,
    nextCursor: "",
    payload: null,
    versions: []
  });
  const versionFiles = reactive({ error: "", loading: false, loadingMore: false, payload: null });
  const versionDiff = reactive({ error: "", loading: false, payload: null });
  const updates = reactive({
    applying: false,
    canonicalChangePending: false,
    checking: false,
    error: "",
    errorCode: "",
    payload: null
  });
  const saving = ref(false);
  const requestRevisions = Object.create(null);
  const updateChecks = new Map();
  const forcedUpdateFollowups = new Set();
  let activeChangesRefresh = null;
  let activeSaveHistoryRefresh = null;
  let disposed = false;

  const context = computed(() => dashboardContext.value || {});
  const activeView = computed(() => String(readRefOrGetterValue(view) || "changes") === "history"
    ? "history"
    : "changes");
  const sessionId = computed(() => String(context.value.sessionId || context.value.session?.sessionId || "").trim());
  const sessionsApiPath = computed(() => String(
    readRefOrGetterValue(context.value.sessionsApiPath) || ""
  ).trim());
  const sourceOperationsSuspended = computed(() => (
    readRefOrGetterValue(context.value.sourceOperationsSuspended) === true
  ));
  let updateAccessRevision = 0;

  function requestContextKey() {
    return `${sessionsApiPath.value}\0${sessionId.value}`;
  }

  function updateCheckContextKey() {
    return `${requestContextKey()}\0${updateAccessRevision}`;
  }

  function beginRequest(name) {
    const revision = Number(requestRevisions[name] || 0) + 1;
    requestRevisions[name] = revision;
    return {
      contextKey: requestContextKey(),
      name,
      revision
    };
  }

  function requestIsCurrent(request) {
    return !disposed && request?.contextKey === requestContextKey() &&
      requestRevisions[request.name] === request.revision;
  }

  function updateRequestIsCurrent(request) {
    return requestIsCurrent(request) &&
      request?.updateAccessRevision === updateAccessRevision &&
      !sourceOperationsSuspended.value;
  }

  function invalidateRequests() {
    for (const name of [
      "applyUpdates",
      "changes",
      "currentDiff",
      "history",
      "saveHistory",
      "updates",
      "versionDiff",
      "versionFiles"
    ]) {
      requestRevisions[name] = Number(requestRevisions[name] || 0) + 1;
    }
  }

  function updateCheckIsNewer(candidate = {}, current = {}) {
    const candidateCheck = candidate && typeof candidate === "object" ? candidate : {};
    const currentCheck = current && typeof current === "object" ? current : {};
    const candidateTime = Date.parse(String(candidateCheck.checkedAt || ""));
    const currentTime = Date.parse(String(currentCheck.checkedAt || ""));
    if (!Number.isFinite(candidateTime)) {
      return !currentCheck.checkedAt;
    }
    return !Number.isFinite(currentTime) || candidateTime >= currentTime;
  }

  async function selectCurrentFile(file) {
    const path = String(file?.path || "");
    selectedCurrentPath.value = path;
    currentDiff.error = "";
    currentDiff.payload = null;
    if (!path || !sessionId.value) {
      return;
    }
    const request = beginRequest("currentDiff");
    currentDiff.loading = true;
    try {
      const result = await requestJson(vibe64SessionChangeDiffPath(
        sessionsApiPath.value,
        sessionId.value,
        path
      ));
      if (requestIsCurrent(request) && selectedCurrentPath.value === path) {
        currentDiff.payload = result;
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        currentDiff.error = message(error, "This file difference could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        currentDiff.loading = false;
      }
    }
  }

  async function loadChanges({ append = false } = {}) {
    changes.error = "";
    if (!append) {
      beginRequest("currentDiff");
      changes.payload = null;
      selectedCurrentPath.value = "";
      currentDiff.error = "";
      currentDiff.loading = false;
      currentDiff.payload = null;
    }
    if (!sessionId.value) {
      return;
    }
    const request = beginRequest("changes");
    changes.loading = !append;
    changes.loadingMore = append;
    try {
      const previousFiles = append ? changes.payload?.files || [] : [];
      const result = await requestJson(vibe64SessionChangesPath(
        sessionsApiPath.value,
        sessionId.value,
        { offset: previousFiles.length }
      ));
      if (!requestIsCurrent(request)) {
        return;
      }
      changes.payload = append
        ? { ...result, files: [...previousFiles, ...(result.files || [])] }
        : result;
      if (!append && typeof context.value.refreshSessionWork === "function") {
        const observedWork = { ...result };
        delete observedWork.initialDiff;
        await context.value.refreshSessionWork(observedWork);
      }
      const first = !append ? changes.payload?.files?.[0] : null;
      if (first) {
        const initialDiff = result.initialDiff && typeof result.initialDiff === "object"
          ? result.initialDiff
          : null;
        if (String(initialDiff?.path || "") === String(first.path || "")) {
          selectedCurrentPath.value = first.path;
          currentDiff.payload = initialDiff;
        } else {
          void selectCurrentFile(first);
        }
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        changes.error = message(error, "Current changes could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        changes.loading = false;
        changes.loadingMore = false;
      }
    }
  }

  function requestChangesRefresh() {
    const contextKey = requestContextKey();
    if (activeChangesRefresh?.contextKey === contextKey) {
      activeChangesRefresh.refreshAfterActive = true;
      return activeChangesRefresh.promise;
    }
    const refresh = {
      contextKey,
      promise: null,
      refreshAfterActive: false
    };
    refresh.promise = loadChanges().finally(() => {
      if (activeChangesRefresh !== refresh) {
        return;
      }
      activeChangesRefresh = null;
      if (
        refresh.refreshAfterActive &&
        !disposed &&
        refresh.contextKey === requestContextKey() &&
        activeView.value === "changes" &&
        !sourceOperationsSuspended.value
      ) {
        void requestChangesRefresh();
      }
    });
    activeChangesRefresh = refresh;
    return refresh.promise;
  }

  async function selectVersion(version) {
    const request = beginRequest("versionFiles");
    beginRequest("versionDiff");
    if (selectedVersion.value?.commit !== version?.commit) {
      versionFiles.error = "";
    }
    selectedVersion.value = version || null;
    selectedVersionPath.value = "";
    versionFiles.loading = false;
    versionFiles.loadingMore = false;
    versionFiles.payload = null;
    versionDiff.error = "";
    versionDiff.loading = false;
    versionDiff.payload = null;
    if (!version?.commit || !history.payload?.historySnapshotCommit) {
      return;
    }
    versionFiles.loading = true;
    try {
      const result = await requestJson(vibe64RepositoryVersionFilesPath(
        sessionsApiPath.value,
        version.commit,
        {
          historySnapshotCommit: history.payload.historySnapshotCommit,
          sessionId: sessionId.value
        }
      ));
      if (!requestIsCurrent(request) || selectedVersion.value?.commit !== version.commit) {
        return;
      }
      versionFiles.payload = result;
      versionFiles.error = "";
      versionFiles.loading = false;
      const first = versionFiles.payload?.files?.[0];
      if (first) {
        await selectVersionFile(first);
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        versionFiles.error = message(error, "This version could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        versionFiles.loading = false;
      }
    }
  }

  async function loadMoreVersionFiles() {
    if (
      versionFiles.loading ||
      versionFiles.loadingMore ||
      !versionFiles.payload?.truncated ||
      !selectedVersion.value?.commit ||
      !history.payload?.historySnapshotCommit
    ) {
      return;
    }
    versionFiles.loadingMore = true;
    versionFiles.error = "";
    const request = beginRequest("versionFiles");
    try {
      const previousFiles = versionFiles.payload.files || [];
      const result = await requestJson(vibe64RepositoryVersionFilesPath(
        sessionsApiPath.value,
        selectedVersion.value.commit,
        {
          historySnapshotCommit: history.payload.historySnapshotCommit,
          offset: previousFiles.length,
          sessionId: sessionId.value
        }
      ));
      if (!requestIsCurrent(request)) {
        return;
      }
      versionFiles.payload = {
        ...result,
        files: [...previousFiles, ...(result.files || [])]
      };
    } catch (error) {
      if (requestIsCurrent(request)) {
        versionFiles.error = message(error, "More files from this version could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        versionFiles.loadingMore = false;
      }
    }
  }

  async function selectVersionFile(file) {
    const path = String(file?.path || "");
    selectedVersionPath.value = path;
    versionDiff.error = "";
    versionDiff.payload = null;
    if (!path || !selectedVersion.value?.commit || !history.payload?.historySnapshotCommit) {
      return;
    }
    const request = beginRequest("versionDiff");
    const versionCommit = selectedVersion.value.commit;
    versionDiff.loading = true;
    try {
      const result = await requestJson(vibe64RepositoryVersionDiffPath(
        sessionsApiPath.value,
        selectedVersion.value.commit,
        path,
        {
          historySnapshotCommit: history.payload.historySnapshotCommit,
          sessionId: sessionId.value
        }
      ));
      if (
        requestIsCurrent(request) &&
        selectedVersion.value?.commit === versionCommit &&
        selectedVersionPath.value === path
      ) {
        versionDiff.payload = result;
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        versionDiff.error = message(error, "This file difference could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        versionDiff.loading = false;
      }
    }
  }

  async function loadHistory({ append = false } = {}) {
    if (!sessionId.value) {
      history.error = "";
      history.payload = null;
      history.versions = [];
      history.nextCursor = "";
      return;
    }
    const request = beginRequest("history");
    history.loading = true;
    try {
      const result = await requestJson(vibe64RepositoryHistoryPath(sessionsApiPath.value, {
        cursor: append ? history.nextCursor : "",
        sessionId: sessionId.value
      }));
      if (!requestIsCurrent(request)) {
        return;
      }
      history.error = "";
      history.payload = append && history.payload
        ? { ...result, versions: [...history.versions, ...(result.versions || [])] }
        : result;
      history.versions = history.payload.versions || [];
      history.nextCursor = result.nextCursor || "";
      if (!append && result.updateCheck && updateCheckIsNewer(result.updateCheck, updates.payload)) {
        updates.payload = {
          ...result.updateCheck,
          cached: true
        };
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        history.error = message(error, "Version history could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        history.loading = false;
      }
    }
  }

  async function checkForUpdates({ force = true } = {}) {
    if (!sessionId.value || updates.applying || sourceOperationsSuspended.value) {
      return false;
    }
    const contextKey = updateCheckContextKey();
    const active = updateChecks.get(contextKey);
    if (active) {
      if (force && active.force !== true) {
        forcedUpdateFollowups.add(contextKey);
      }
      return active.promise;
    }
    const request = {
      ...beginRequest("updates"),
      updateAccessRevision
    };
    updates.checking = true;
    updates.error = "";
    updates.errorCode = "";
    const promise = (async () => {
      try {
        const result = await requestJson(vibe64SessionCheckUpdatesPath(
        sessionsApiPath.value,
        sessionId.value
        ), {
          body: { force },
          method: "POST"
        }).finally(async () => {
          // Keep failed checks registered too, so Save does not immediately retry them.
          while (
            updateRequestIsCurrent(request) &&
            activeSaveHistoryRefresh?.contextKey === request.contextKey
          ) {
            await activeSaveHistoryRefresh.settled;
          }
        });
        if (!updateRequestIsCurrent(request)) {
          return false;
        }
        updates.payload = result;
        updates.canonicalChangePending = false;
        if (activeView.value === "changes") {
          if (
            !changes.payload ||
            String(changes.payload.canonicalCommit || "").trim() !==
              String(result.canonicalCommit || "").trim()
          ) {
            await requestChangesRefresh();
          }
        } else if (
          !history.payload ||
          String(result.canonicalCommit || "").trim() !== String(history.payload?.historySnapshotCommit || "").trim()
        ) {
          await loadHistory();
        }
        return result;
      } catch (error) {
        if (updateRequestIsCurrent(request)) {
          updates.error = message(error, "Updates could not be checked.");
          updates.errorCode = String(error?.code || "").trim();
          if (activeView.value === "changes" && !changes.payload) {
            await requestChangesRefresh();
          }
        }
        return false;
      } finally {
        if (updateRequestIsCurrent(request)) {
          updates.checking = false;
        }
        const registered = updateChecks.get(contextKey);
        if (registered?.promise === promise) {
          updateChecks.delete(contextKey);
        }
        if (!disposed && forcedUpdateFollowups.delete(contextKey) && contextKey === updateCheckContextKey()) {
          void checkForUpdates({ force: true });
        }
      }
    })();
    updateChecks.set(contextKey, { force, promise });
    return promise;
  }

  async function applyUpdates(options = {}) {
    const requestUpdateWork = context.value.requestUpdateWork;
    if (
      !sessionId.value ||
      sourceOperationsSuspended.value ||
      updates.checking ||
      updates.applying ||
      !(updates.canonicalChangePending || updates.payload?.updateAvailable === true) ||
      typeof requestUpdateWork !== "function"
    ) {
      return false;
    }
    updates.applying = true;
    updates.error = "";
    updates.errorCode = "";
    const request = beginRequest("applyUpdates");
    try {
      const result = await requestUpdateWork(options);
      if (!requestIsCurrent(request)) {
        return false;
      }
      if (result === false || result?.ok === false) {
        throw new Error("This session could not be updated.");
      }
      updates.payload = result;
      updates.canonicalChangePending = false;
      if (activeView.value === "history") {
        await loadHistory();
      } else {
        await requestChangesRefresh();
      }
      return result;
    } catch (error) {
      if (requestIsCurrent(request)) {
        updates.error = message(error, "This session could not be updated.");
        updates.errorCode = String(error?.code || "").trim();
      }
      return false;
    } finally {
      if (requestIsCurrent(request)) {
        updates.applying = false;
      }
    }
  }

  async function saveWork() {
    const requestSaveWork = context.value.requestSaveWork;
    if (
      !sessionId.value ||
      sourceOperationsSuspended.value ||
      saving.value ||
      updates.checking ||
      updates.applying ||
      updates.canonicalChangePending ||
      updates.error ||
      !updates.payload ||
      updates.payload?.updateAvailable === true ||
      changes.error ||
      changes.loading ||
      changes.payload?.unsaved !== true ||
      typeof requestSaveWork !== "function"
    ) {
      return false;
    }
    saving.value = true;
    try {
      return await requestSaveWork();
    } finally {
      saving.value = false;
    }
  }

  watch(
    [sessionsApiPath, sessionId, activeView],
    async ([apiPath]) => {
      invalidateRequests();
      activeSaveHistoryRefresh?.settle();
      activeSaveHistoryRefresh = null;
      changes.error = "";
      changes.loading = false;
      changes.loadingMore = false;
      changes.payload = null;
      currentDiff.error = "";
      currentDiff.loading = false;
      currentDiff.payload = null;
      history.error = "";
      history.loading = false;
      history.nextCursor = "";
      history.payload = null;
      history.versions = [];
      selectedCurrentPath.value = "";
      selectedVersion.value = null;
      selectedVersionPath.value = "";
      versionDiff.error = "";
      versionDiff.loading = false;
      versionDiff.payload = null;
      versionFiles.error = "";
      versionFiles.loading = false;
      versionFiles.loadingMore = false;
      versionFiles.payload = null;
      updates.applying = false;
      updates.checking = false;
      updates.error = "";
      updates.errorCode = "";
      updates.payload = null;
      updates.canonicalChangePending = false;
      if (apiPath && sessionId.value) {
        const initialContext = requestContextKey();
        if (activeView.value === "history") {
          await loadHistory();
          if (disposed || initialContext !== requestContextKey()) {
            return;
          }
        } else if (!sourceOperationsSuspended.value) {
          await requestChangesRefresh();
          if (disposed || initialContext !== requestContextKey()) {
            return;
          }
        }
        if (!sourceOperationsSuspended.value) {
          void checkForUpdates({ force: false });
        }
      }
    },
    { immediate: true }
  );

  watch(sourceOperationsSuspended, async (suspended, wasSuspended) => {
    if (suspended) {
      updateAccessRevision += 1;
      updates.checking = false;
      return;
    }
    if (wasSuspended !== true) {
      return;
    }
    updateAccessRevision += 1;
    if (sessionId.value) {
      const releasedContext = requestContextKey();
      if (activeView.value === "changes") {
        await requestChangesRefresh();
        if (
          disposed ||
          releasedContext !== requestContextKey() ||
          sourceOperationsSuspended.value
        ) {
          return;
        }
      }
      void checkForUpdates({ force: false });
    }
  }, {
    flush: "sync",
    immediate: true
  });

  useRealtimeEvent({
    enabled: computed(() => Boolean(sessionId.value)),
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => (
      repositoryStatusSessionId(payload) === sessionId.value &&
      repositoryStatusRealtimeShouldRefresh(payload)
    ),
    onEvent: async ({ payload = {} } = {}) => {
      const reason = String(payload?.reason || "").trim();
      const checkCanonical = repositoryStatusRealtimeNeedsCanonicalCheck(payload) || [
        "session-repository-checked",
        "session-save-completed",
        "session-update-completed"
      ].includes(reason);
      if (repositoryStatusRealtimeNeedsCanonicalCheck(payload)) {
        updates.canonicalChangePending = true;
      }
      if (activeView.value === "history" && reason === "session-save-completed") {
        const refresh = beginRequest("saveHistory");
        // Replacing or retiring this Save releases its waiting checks immediately.
        refresh.settled = new Promise((resolve) => {
          refresh.settle = resolve;
        });
        activeSaveHistoryRefresh?.settle();
        activeSaveHistoryRefresh = refresh;
        try {
          await loadHistory();
        } finally {
          if (activeSaveHistoryRefresh === refresh) {
            activeSaveHistoryRefresh = null;
          }
          refresh.settle();
        }
        if (!requestIsCurrent(refresh)) {
          return;
        }
      } else if (activeView.value === "changes" && !checkCanonical) {
        void requestChangesRefresh();
      }
      if (checkCanonical) {
        void checkForUpdates({ force: repositoryStatusRealtimeNeedsCanonicalCheck(payload) });
      }
    }
  });

  onScopeDispose(() => {
    disposed = true;
    invalidateRequests();
    activeChangesRefresh = null;
    activeSaveHistoryRefresh?.settle();
    activeSaveHistoryRefresh = null;
    updateChecks.clear();
    forcedUpdateFollowups.clear();
  });

  useRealtimeEvent({
    enabled: computed(() => Boolean(sessionId.value) && activeView.value === "changes"),
    event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => repositoryStatusSessionId(payload) === sessionId.value,
    onEvent: () => {
      void requestChangesRefresh();
    }
  });

  return {
    applyUpdates,
    changes,
    checkForUpdates,
    currentDiff,
    history,
    loadChanges,
    loadHistory,
    loadMoreVersionFiles,
    saveWork,
    saving,
    selectCurrentFile,
    selectedCurrentPath,
    selectedVersion,
    selectedVersionPath,
    selectVersion,
    selectVersionFile,
    sessionId,
    sourceOperationsSuspended,
    updates,
    versionDiff,
    versionFiles
  };
}

export {
  useVibe64RepositoryWorkspace
};
