import { ref } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { usePageActivity } from "@/lib/vibe64PageActivity.js";
import {
  normalizeSourceEditorPath
} from "@/lib/vibe64SourceEditorLinks.js";
import {
  vibe64SourceEditorCreateFilePath,
  vibe64SourceEditorFilePath,
  vibe64SourceEditorResolvePathPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64BrowserTabOriginId,
  vibe64RealtimePayloadFromCurrentTab
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  sourceEditorRequest
} from "@/lib/vibe64SourceEditorRequest.js";

const SOURCE_EDITOR_AUTOSAVE_DELAY_MS = 700;
const SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE = "This file changed in another window. Reload it before saving.";

/**
 * Whether a source file change event, published by another browser tab, is
 * about the file this tab has selected and carries the file's new hash.
 */
function sourceEditorFileChangePayloadMatches({
  originId = vibe64BrowserTabOriginId(),
  path = "",
  payload = {},
  projectSlug = "",
  sessionId = ""
} = {}) {
  const normalizedPath = normalizeSourceEditorPath(path);
  const normalizedProjectSlug = normalizeText(projectSlug);
  const normalizedSessionId = normalizeText(sessionId);
  if (
    !normalizedPath ||
    !normalizedProjectSlug ||
    !normalizedSessionId ||
    normalizeSourceEditorPath(payload.path) !== normalizedPath ||
    normalizeText(payload.projectSlug) !== normalizedProjectSlug ||
    normalizeText(payload.sessionId) !== normalizedSessionId ||
    vibe64RealtimePayloadFromCurrentTab(payload, {
      originId
    })
  ) {
    return false;
  }
  return Boolean(normalizeText(payload.hash));
}

function normalizeResolvedSourceEditorPath(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return {
    path: normalizeSourceEditorPath(source.path || source.file?.path),
    resolved: source.resolved === true
  };
}

/**
 * A host's navigation to a referenced source file, when the host takes none
 * over: the editor opens the file itself.
 * @returns {boolean} Whether the host handled the navigation.
 */
function leaveReferencedSourceToEditor() {
  return false;
}

/**
 * The selected source file: opening and creating it, revalidating it when
 * another window or the agent changes it, and saving its edits.
 * @param {object} options
 * @param {import("vue").Ref<boolean>} options.canLoad
 * @param {import("vue").Ref<boolean>} options.currentActive
 * @param {import("vue").Ref<string>} options.currentProjectSlug
 * @param {import("vue").Ref<string>} options.currentSessionId
 * @param {import("vue").Ref<string>} options.currentSessionsApiPath
 * @param {import("vue").Ref<boolean>} options.disposed
 * @param {import("vue").Ref<{ operation: string, message: string } | null>} options.loadFailure
 * @param {(navigation: { fromPath: string, path: string, target: string }) => unknown} options.navigateReferencedSource
 *   Resolves true when the host opened the referenced file itself.
 * @param {string} options.originId
 * @param {() => string} options.readCurrentText The live text of the open file.
 * @param {import("vue").Ref<string>} options.selectedPath
 * @param {import("@/types.js").Vibe64SourceEditorTree} options.tree
 */
function useVibe64SourceEditorFile({
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
}) {
  // What the person did here, for a lesson's do beats.
  const reportActivity = usePageActivity();
  const text = ref("");
  const savedHash = ref("");
  const interpretations = ref([]);
  const interpretationWarning = ref('');
  const dirty = ref(false);
  const downloadOnlyFile = ref(null);
  const saveError = ref("");
  const createFileError = ref("");
  const creatingFile = ref(false);
  const loadingFile = ref(false);
  const loadingPath = ref("");
  const saving = ref(false);
  const loadedVersion = ref(0);
  const cursorRequest = ref(null);
  let createFileRequestId = 0;
  let fileRequestId = 0;
  let fileRevalidationRequestId = 0;
  let autosaveTimer = null;
  let pendingFileRevalidation = false;
  let savePromise = null;
  let textAtUnmount = null;

  function clearAutosave() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
  }

  function applyFileResponse(response = {}, {
    column = 0,
    fallbackPath = "",
    line = 0,
    reveal = true
  } = {}) {
    const file = response.file || {};
    const filePath = normalizeSourceEditorPath(file.path || fallbackPath);
    if (!filePath) {
      return false;
    }
    selectedPath.value = filePath;
    downloadOnlyFile.value = null;
    tree.revealSelectedFile(response.revealTree);
    text.value = String(file.text || "");
    savedHash.value = String(file.hash || "");
    applySavedInterpretations(response, filePath);
    dirty.value = false;
    if (reveal) tree.revealLoadedFilePath(filePath);
    cursorRequest.value = {
      column: Number(column || 0) || 0,
      line: Number(line || 0) || 0,
      path: filePath,
      version: loadedVersion.value + 1
    };
    loadedVersion.value += 1;
    return true;
  }

  function applySavedInterpretations(response, filePath) {
    interpretations.value = (response.interpretations?.records || []).filter(record => record.path === filePath
      && ['file', 'selection'].includes(record.scope) && ['description', 'steps'].includes(record.presentation)
      && typeof record.body === 'string' && ['current', 'stale'].includes(record.status));
    interpretationWarning.value = String(response.interpretations?.warning || '');
  }

  async function openFile(filePath = "", options = {}) {
    const normalizedPath = normalizeSourceEditorPath(filePath);
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
      reportActivity("file-opened", { projectSlug: currentProjectSlug.value, sessionId: currentSessionId.value, path: normalizedPath });
      return true;
    } catch (error) {
      if (requestId === fileRequestId) {
        const code = error?.code;
        if (code === "vibe64_source_editor_binary_file" || code === "vibe64_source_editor_file_too_large") {
          // Keep non-text files out of the editable buffer and its autosave/file-sync paths.
          selectedPath.value = "";
          tree.clearSelectedReveal();
          text.value = "";
          savedHash.value = "";
          downloadOnlyFile.value = {
            path: normalizedPath,
            message: code === "vibe64_source_editor_binary_file"
              ? "This file cannot be edited as text. Download it to open it in another application."
              : "This file is too large to edit here. You can download the complete file."
          };
          tree.revealLoadedFilePath(normalizedPath);
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
    const normalizedPath = normalizeSourceEditorPath(filePath);
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
    if (disposed.value || !pathAtRequest || !canLoad.value || !currentActive.value) {
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
      tree.revealSelectedFile(response.revealTree);
      const nextHash = String(response.file?.hash || "");
      applySavedInterpretations(response, pathAtRequest);
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
    const changedPath = normalizeSourceEditorPath(path);
    const changedHash = normalizeText(hash);
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
      normalizeText(payload.sessionId) !== currentSessionId.value ||
      normalizeSourceEditorPath(payload.path) !== selectedPath.value
    ) {
      return;
    }
    await applySelectedFileChange(payload);
  }

  async function openReferencedSourcePath({
    fromPath = selectedPath.value,
    target = ""
  } = {}) {
    const normalizedFromPath = normalizeSourceEditorPath(fromPath);
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
      await openFile(resolved.path);
      return true;
    } catch {
      return false;
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

  function updateText() {
    dirty.value = true;
    saveError.value = "";
    scheduleSave();
  }

  function currentText() {
    if (textAtUnmount !== null) {
      return textAtUnmount;
    }
    return String(readCurrentText() ?? "");
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
    const filePath = normalizeSourceEditorPath(request.path);
    if (!filePath) {
      return;
    }
    void openFile(filePath, {
      column: request.column,
      line: request.line
    });
  }

  /** Forgets the selected file and every read of it still in flight, when the session changes. */
  function resetSelectedFile() {
    fileRequestId += 1;
    loadingFile.value = false;
    loadingPath.value = "";
    fileRevalidationRequestId += 1;
    pendingFileRevalidation = false;
    selectedPath.value = "";
    downloadOnlyFile.value = null;
    tree.clearSelectedReveal();
    text.value = "";
    savedHash.value = "";
    interpretations.value = [];
    interpretationWarning.value = '';
    dirty.value = false;
  }

  /** Discards the reads still in flight and keeps the unmounting editor's text for the final save. */
  function dispose() {
    fileRequestId += 1;
    fileRevalidationRequestId += 1;
    textAtUnmount = currentText();
    clearAutosave();
  }

  return {
    applyObservedFileChange,
    applyRemoteFileChange,
    createFile,
    createFileError,
    creatingFile,
    cursorRequest,
    dirty,
    dispose,
    downloadOnlyFile,
    interpretationWarning,
    interpretations,
    loadedVersion,
    loadingFile,
    loadingPath,
    openFile,
    openReferencedSourcePath,
    openRequest,
    resetSelectedFile,
    revalidateSelectedFile,
    saveError,
    saveNow,
    savedHash,
    saving,
    text,
    updateText
  };
}

export {
  SOURCE_EDITOR_AUTOSAVE_DELAY_MS,
  SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE,
  leaveReferencedSourceToEditor,
  sourceEditorFileChangePayloadMatches,
  useVibe64SourceEditorFile
};
