import { ref, watch } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { vibe64SourceEditorDownloadPath } from "@/lib/vibe64SessionRequestConfig.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { downloadAttachment } from "@/lib/vibe64AttachmentDownload.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { basename } from "@/lib/vibe64SourceFilePaths.js";

/**
 * Source file downloads, one at a time. Downloading the open file while it has
 * unsaved edits first asks whether to download the saved file or save first.
 * @param {object} options
 * @param {ReturnType<typeof import("@/composables/useVibe64SourceEditor.js").useVibe64SourceEditor>} options.editor
 * @param {{ projectSlug: string, sessionId: string, sessionsApiPath: string }} options.props The source editor's props.
 */
function useVibe64SourceEditorDownloads({
  editor,
  props
}) {
  const downloadingPath = ref("");
  const downloadDraftOpen = ref(false);
  const downloadSaving = ref(false);
  const downloadError = ref("");
  let draftDownload = null;
  const downloadFeedback = useUiFeedback({ source: "vibe64.source-editor.download" });

  function requestDownload(filePath) {
    if (!filePath || downloadingPath.value) {
      return;
    }
    const target = {
      path: filePath,
      sessionId: props.sessionId,
      sessionsApiPath: readRefOrGetterValue(props.sessionsApiPath),
      projectSlug: props.projectSlug
    };
    if (filePath === editor.selectedPath.value && (editor.dirty.value || editor.saving.value)) {
      draftDownload = target;
      downloadError.value = "";
      downloadDraftOpen.value = true;
    } else {
      void downloadFile(target);
    }
  }

  async function downloadFile(target) {
    downloadingPath.value = target.path;
    try {
      await downloadAttachment(
        scopedDevelopmentApiUrl(
          vibe64SourceEditorDownloadPath(target.sessionsApiPath, target.sessionId, target.path),
          target.projectSlug
        ),
        basename(target.path),
        "File could not download. Check your connection and access, then retry."
      );
    } catch (cause) {
      downloadFeedback.error(cause, "File could not download.");
    } finally {
      downloadingPath.value = "";
    }
  }

  function downloadSavedDraft() {
    downloadDraftOpen.value = false;
    void downloadFile(draftDownload);
  }

  async function saveAndDownload() {
    downloadSaving.value = true;
    await editor.saveNow();
    downloadSaving.value = false;
    if (editor.dirty.value || editor.saveError.value) {
      downloadError.value = editor.saveError.value || "The file still has unsaved edits.";
      return;
    }
    downloadSavedDraft();
  }

  watch(() => props.sessionId, () => {
    downloadDraftOpen.value = false;
  });

  return {
    downloadDraftOpen,
    downloadError,
    downloadSavedDraft,
    downloadSaving,
    downloadingPath,
    requestDownload,
    saveAndDownload
  };
}

export { useVibe64SourceEditorDownloads };
