import { computed, ref, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";

const SHORT_ACTION_DISMISSALS_STORAGE_PREFIX = "vibe64:short-action-dismissals:v1";

// Per session, the Save/Update, workspace setup and checkpoint activities the
// person dismissed, kept in browser storage.
function useVibe64ShortActionDismissals(projectSlug, sessionId) {
  const state = ref({
    saveWork: "",
    workspaceSetup: "",
    checkpoint: ""
  });
  const storageKey = computed(() => {
    const slug = normalizeText(projectSlug.value);
    const selectedSessionId = sessionId.value;
    return slug && selectedSessionId
      ? `${SHORT_ACTION_DISMISSALS_STORAGE_PREFIX}:${encodeURIComponent(slug)}:${encodeURIComponent(selectedSessionId)}`
      : "";
  });

  watch(storageKey, (key) => {
    const stored = readLocalStorageJson(key, {});
    state.value = {
      ...stored,
      saveWork: normalizeText(stored?.saveWork),
      workspaceSetup: normalizeText(stored?.workspaceSetup),
      checkpoint: normalizeText(stored?.checkpoint)
    };
  }, { flush: "sync", immediate: true });

  function dismiss(name, activityKey = "") {
    const key = normalizeText(activityKey);
    if (!key || !storageKey.value) {
      return false;
    }
    state.value = {
      ...readLocalStorageJson(storageKey.value, {}),
      ...state.value,
      // Save and Update can alternate; neither may forget a dismissed operation.
      ...(name === "saveWork" ? { [key]: true } : { [name]: key })
    };
    writeLocalStorageJson(storageKey.value, state.value);
    return true;
  }

  function clear(name) {
    state.value = { ...state.value, [name]: "" };
    if (storageKey.value) {
      writeLocalStorageJson(storageKey.value, state.value);
    }
  }

  // Shows one dismissed notice again, for the person who asks to see it.
  function restore(name, activityKey = "") {
    const key = normalizeText(activityKey);
    if (!key || !storageKey.value) {
      return false;
    }
    const { [key]: _dismissed, ...kept } = { ...readLocalStorageJson(storageKey.value, {}), ...state.value };
    state.value = { ...kept, ...(kept[name] === key ? { [name]: "" } : {}) };
    writeLocalStorageJson(storageKey.value, state.value);
    return true;
  }

  return { clear, dismiss, restore, state };
}

export { useVibe64ShortActionDismissals };
