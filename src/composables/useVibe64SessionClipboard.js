import { ref } from "vue";
import { writeClipboardText } from "@/lib/clipboard.js";

function useVibe64SessionClipboard() {
  const copyStatus = ref("");

  function clearCopyStatus() {
    copyStatus.value = "";
  }

  function setCopyStatus(message = "") {
    copyStatus.value = String(message || "");
  }

  async function copyText(value, label = "Value") {
    try {
      await writeClipboardText(value);
      copyStatus.value = `${label} copied.`;
    } catch (error) {
      copyStatus.value = String(error?.message || error || "Copy failed.");
    }
  }

  return {
    clearCopyStatus,
    copyStatus,
    copyText,
    setCopyStatus
  };
}

export {
  useVibe64SessionClipboard
};
