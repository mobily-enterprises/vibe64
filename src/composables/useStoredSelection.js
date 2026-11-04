import { computed, ref, toValue, watch } from "vue";
import { browserSessionStorage } from "@/lib/browser.js";

function readStoredValue(storageKey = "") {
  try {
    return String(browserSessionStorage()?.getItem(storageKey) || "");
  } catch {
    return "";
  }
}

function writeStoredValue(storageKey = "", value = "") {
  try {
    const storage = browserSessionStorage();
    if (!storage) {
      return;
    }

    const normalizedValue = String(value || "").trim();
    if (normalizedValue) {
      storage.setItem(storageKey, normalizedValue);
      return;
    }
    storage.removeItem(storageKey);
  } catch {
    // Blocked storage should not break the screen that uses this selection.
  }
}

function readStorageKey(storageKey = "") {
  return String(toValue(storageKey) || "").trim();
}

function readPreferredId(preferredId = "") {
  return String(toValue(preferredId) || "").trim();
}

/**
 * The tab's selection of one item among a changing list, restored from session storage.
 * rememberedId, when given, is the caller's own remembered choice (such as a server record): it replaces this tab's
 * stored value as the choice to restore, and the stored value then only mirrors each selection for other readers.
 * @param {{
 *   preferredId?: import("vue").MaybeRefOrGetter<string>,
 *   rememberedId?: import("vue").MaybeRefOrGetter<string>,
 *   storageKey?: import("vue").MaybeRefOrGetter<string>,
 *   enabled?: import("vue").MaybeRefOrGetter<boolean>
 * }} options
 */
function useStoredSelection({
  preferredId = "",
  rememberedId,
  storageKey = "",
  enabled = true
}) {
  const selectionEnabled = computed(() => Boolean(toValue(enabled)));
  const activeStorageKey = computed(() => readStorageKey(storageKey));
  const activePreferredId = computed(() => readPreferredId(preferredId));
  const restoredId = (key = activeStorageKey.value) => (
    rememberedId === undefined ? readStoredValue(key) : readPreferredId(rememberedId)
  );
  const selectedId = ref(selectionEnabled.value ? activePreferredId.value || restoredId() : "");

  function select(id = "") {
    if (!selectionEnabled.value) return;
    selectedId.value = String(id || "").trim();
    writeStoredValue(activeStorageKey.value, selectedId.value);
  }

  function clear() {
    select("");
  }

  function selectAvailableId(items = [], {
    fallbackId = "",
    getId = (item) => item?.id
  } = {}) {
    if (!selectionEnabled.value) return "";
    if (items.length === 0) {
      clear();
      return "";
    }

    const itemIds = items.map((item) => String(getId(item) || "").trim()).filter(Boolean);
    // The route initializes selection and its watcher handles later navigation.
    // Reconciliation must preserve a newer explicit selection while it is available.
    if (itemIds.includes(selectedId.value)) {
      select(selectedId.value);
      return selectedId.value;
    }

    const preferredSelectionId = activePreferredId.value;
    if (itemIds.includes(preferredSelectionId)) {
      select(preferredSelectionId);
      return selectedId.value;
    }

    const restoredSelectionId = restoredId();
    const nextId = itemIds.includes(restoredSelectionId)
      ? restoredSelectionId
      : String(fallbackId || "").trim();
    select(nextId);
    return selectedId.value;
  }

  function capture() {
    const key = activeStorageKey.value;
    const admitted = selectionEnabled.value;
    return Object.freeze({
      select(id = "") {
        if (!admitted) return;
        const value = String(id || "").trim();
        writeStoredValue(key, value);
        if (selectionEnabled.value && activeStorageKey.value === key) selectedId.value = value;
      }
    });
  }

  watch(selectionEnabled, (nextEnabled) => {
    selectedId.value = nextEnabled ? activePreferredId.value || restoredId() : "";
  }, { flush: "sync" });

  watch(activeStorageKey, (nextStorageKey) => {
    if (selectionEnabled.value) selectedId.value = activePreferredId.value || restoredId(nextStorageKey);
  });

  watch(activePreferredId, (nextPreferredId) => {
    if (selectionEnabled.value && nextPreferredId) {
      selectedId.value = nextPreferredId;
    }
  });

  return {
    capture,
    clear,
    select,
    selectAvailableId,
    selectedId
  };
}

export {
  useStoredSelection
};
