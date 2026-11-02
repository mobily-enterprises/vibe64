import { computed, onScopeDispose, ref } from "vue";
import { useVibe64FileUploads } from "@/composables/useVibe64FileUploads.js";
import { vibe64DroppedFiles } from "@/lib/vibe64FileAreas.js";

/**
 * Uploads into a Files area's open folder, from dropped or chosen files. A
 * burst of uploads reloads the listing once.
 * @param {object} options
 * @param {ReturnType<typeof import("@/composables/useVibe64FileAreaBrowser.js").useVibe64FileAreaBrowser>} options.browser
 * @param {import("vue").ComputedRef<boolean>} options.canWrite
 * @param {{ error: (error: unknown, fallback?: string) => void }} options.feedback
 * @param {ReturnType<typeof import("@/composables/useVibe64FileAreaFocus.js").useVibe64FileAreaFocus>} options.focus
 * @param {{ base: string }} options.props The area's props.
 */
function useVibe64FileAreaUploads({
  browser,
  canWrite,
  feedback,
  focus,
  props
}) {
  const dragDepth = ref(0);
  let uploadRefreshTimer = null;

  const uploads = useVibe64FileUploads({
    endpoint: computed(() => props.base),
    onAsk: () => focus.rememberFocus(),
    onUploaded: () => {
      // A burst of small uploads refreshes the listing once.
      clearTimeout(uploadRefreshTimer);
      uploadRefreshTimer = setTimeout(browser.reloadListing, 250);
    }
  });

  function dragEnter(event) {
    if (canWrite.value && event.dataTransfer?.types.includes("Files")) dragDepth.value += 1;
  }

  function dragOver(event) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = canWrite.value ? "copy" : "none";
  }

  function dragLeave() {
    dragDepth.value = Math.max(0, dragDepth.value - 1);
  }

  function dropFiles(event) {
    dragDepth.value = 0;
    if (!canWrite.value) return;
    try {
      return startUploads(vibe64DroppedFiles(event.dataTransfer));
    } catch (error) {
      feedback.error(error);
    }
  }

  async function startUploads(files) {
    try {
      await uploads.start(files, browser.directory.value);
    } catch (error) {
      feedback.error(error, "Upload failed.");
    }
  }

  onScopeDispose(() => {
    clearTimeout(uploadRefreshTimer);
  });

  return {
    dragDepth,
    dragEnter,
    dragLeave,
    dragOver,
    dropFiles,
    startUploads,
    uploads
  };
}

export { useVibe64FileAreaUploads };
