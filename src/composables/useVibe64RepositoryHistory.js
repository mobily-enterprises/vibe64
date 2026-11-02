import { reactive, ref } from "vue";
import {
  vibe64RepositoryHistoryPath,
  vibe64RepositoryVersionDiffPath,
  vibe64RepositoryVersionFilesPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  repositoryErrorMessage,
  requestRepositoryJson
} from "@/lib/vibe64RepositoryRequest.js";

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

/**
 * The project's saved versions as the repository workspace shows them: the paged history, the files
 * of the opened version and one file's difference. All reads are pinned to the history snapshot they
 * were listed from. A history read also carries the latest update check, kept when it is newer.
 * @param {{
 *   beginRequest: (name: string) => { contextKey: string, name: string, revision: number },
 *   requestIsCurrent: (request: { contextKey: string, name: string, revision: number }) => boolean,
 *   sessionId: import("vue").ComputedRef<string>,
 *   sessionsApiPath: import("vue").ComputedRef<string>,
 *   updates: { payload: object | null }
 * }} options
 */
function useVibe64RepositoryHistory({
  beginRequest,
  requestIsCurrent,
  sessionId,
  sessionsApiPath,
  updates
}) {
  const selectedVersion = ref(null);
  const selectedVersionPath = ref("");
  const history = reactive({
    error: "",
    loading: false,
    nextCursor: "",
    payload: null,
    versions: []
  });
  const versionFiles = reactive({ error: "", loading: false, loadingMore: false, payload: null });
  const versionDiff = reactive({ error: "", loading: false, payload: null });

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
      const result = await requestRepositoryJson(vibe64RepositoryVersionFilesPath(
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
        versionFiles.error = repositoryErrorMessage(error, "This version could not be loaded.");
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
      const result = await requestRepositoryJson(vibe64RepositoryVersionFilesPath(
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
        versionFiles.error = repositoryErrorMessage(error, "More files from this version could not be loaded.");
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
      const result = await requestRepositoryJson(vibe64RepositoryVersionDiffPath(
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
        versionDiff.error = repositoryErrorMessage(error, "This file difference could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        versionDiff.loading = false;
      }
    }
  }

  async function loadHistory({ append = false } = {}) {
    const request = beginRequest("history");
    history.loading = true;
    try {
      const result = await requestRepositoryJson(vibe64RepositoryHistoryPath(sessionsApiPath.value, {
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
        history.error = repositoryErrorMessage(error, "Version history could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        history.loading = false;
      }
    }
  }

  /** Forgets the listed history and the opened version, for a new session or view. */
  function resetHistory() {
    history.error = "";
    history.loading = false;
    history.nextCursor = "";
    history.payload = null;
    history.versions = [];
    selectedVersion.value = null;
    selectedVersionPath.value = "";
    versionDiff.error = "";
    versionDiff.loading = false;
    versionDiff.payload = null;
    versionFiles.error = "";
    versionFiles.loading = false;
    versionFiles.loadingMore = false;
    versionFiles.payload = null;
  }

  return {
    history,
    loadHistory,
    loadMoreVersionFiles,
    resetHistory,
    selectVersion,
    selectVersionFile,
    selectedVersion,
    selectedVersionPath,
    versionDiff,
    versionFiles
  };
}

export {
  useVibe64RepositoryHistory
};
