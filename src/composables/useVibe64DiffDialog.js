import { ref, unref } from "vue";

import {
  readVibe64SessionDiff
} from "@/lib/vibe64SessionApi.js";
import {
  resolveResponseErrorMessage
} from "@/lib/vibe64ResponseErrors.js";
import {
  readRefOrGetterBoolean
} from "@/lib/vueRefOrGetterValue.js";

function useVibe64DiffDialog({
  canOpen,
  selectedSessionId
} = {}) {
  const diffDialogOpen = ref(false);
  const diffError = ref("");
  const diffLoading = ref(false);
  const diffPayload = ref(null);

  async function loadDiff() {
    if (!unref(selectedSessionId) || !readRefOrGetterBoolean(canOpen)) {
      return false;
    }
    diffError.value = "";
    diffLoading.value = true;
    diffPayload.value = null;
    try {
      const response = await readVibe64SessionDiff(unref(selectedSessionId));
      diffPayload.value = response;
      if (response?.ok === false) {
        diffError.value = resolveResponseErrorMessage(response, "Diff inspection failed.");
        return false;
      }
      return true;
    } catch (error) {
      diffError.value = String(error?.message || error || "Diff inspection failed.");
      return false;
    } finally {
      diffLoading.value = false;
    }
  }

  async function openDiffDialog() {
    if (!unref(selectedSessionId) || !readRefOrGetterBoolean(canOpen)) {
      return false;
    }
    diffDialogOpen.value = true;
    return loadDiff();
  }

  function closeDiffDialog() {
    diffDialogOpen.value = false;
  }

  function clearDiffDialog() {
    diffDialogOpen.value = false;
    diffError.value = "";
    diffPayload.value = null;
  }

  return {
    clearDiffDialog,
    closeDiffDialog,
    diffDialogOpen,
    diffError,
    diffLoading,
    diffPayload,
    loadDiff,
    openDiffDialog
  };
}

export {
  useVibe64DiffDialog
};
