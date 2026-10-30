import { ref, toValue } from "vue";
import { saveBlobAsFile } from "@/lib/vibe64AttachmentDownload.js";

// Saves an environment's .env file, whose text readContent() fetches from the
// owner-only download action; null or undefined means no file (a stale or
// refused request). A failure stays in downloadError until the next attempt.
function useRuntimeConfigDotenvDownload({ fileName, readContent } = {}) {
  if (typeof readContent !== "function") {
    throw new TypeError("useRuntimeConfigDotenvDownload requires readContent().");
  }
  const downloadBusy = ref(false);
  const downloadError = ref("");

  async function downloadDotenv() {
    if (downloadBusy.value) {
      return false;
    }
    downloadBusy.value = true;
    downloadError.value = "";
    try {
      const content = await readContent();
      if (typeof content !== "string") {
        return false;
      }
      saveBlobAsFile(new Blob([content], { type: "text/plain;charset=utf-8" }), String(toValue(fileName)));
      return true;
    } catch (error) {
      downloadError.value = String(error?.message || "The .env file could not be downloaded.");
      return false;
    } finally {
      downloadBusy.value = false;
    }
  }

  return {
    downloadBusy,
    downloadDotenv,
    downloadError
  };
}

export {
  useRuntimeConfigDotenvDownload
};
