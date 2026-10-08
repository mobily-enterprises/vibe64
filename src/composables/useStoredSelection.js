import { computed, ref, unref, watch } from "vue";

function browserSessionStorage() {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  return window.sessionStorage;
}

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
  return String(typeof storageKey === "function" ? storageKey() : unref(storageKey) || "").trim();
}

function readPreferredId(preferredId = "") {
  return String(typeof preferredId === "function" ? preferredId() : unref(preferredId) || "").trim();
}

function useStoredSelection({
  preferredId = "",
  storageKey = "",
  enabled = true
} = {}) {
  const selectionEnabled = computed(() => Boolean(typeof enabled === "function" ? enabled() : unref(enabled)));
  const activeStorageKey = computed(() => readStorageKey(storageKey));
  const activePreferredId = computed(() => readPreferredId(preferredId));
  const selectedId = ref(selectionEnabled.value ? activePreferredId.value || readStoredValue(activeStorageKey.value) : "");

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

    const rememberedId = readStoredValue(activeStorageKey.value);
    const nextId = itemIds.includes(rememberedId)
      ? rememberedId
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
    selectedId.value = nextEnabled ? activePreferredId.value || readStoredValue(activeStorageKey.value) : "";
  }, { flush: "sync" });

  watch(activeStorageKey, (nextStorageKey) => {
    if (selectionEnabled.value) selectedId.value = activePreferredId.value || readStoredValue(nextStorageKey);
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
