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
  storageKey = ""
} = {}) {
  const activeStorageKey = computed(() => readStorageKey(storageKey));
  const activePreferredId = computed(() => readPreferredId(preferredId));
  const selectedId = ref(activePreferredId.value || readStoredValue(activeStorageKey.value));

  function select(id = "") {
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
    if (items.length === 0) {
      clear();
      return "";
    }

    const itemIds = items.map((item) => String(getId(item) || "").trim()).filter(Boolean);
    const preferredSelectionId = activePreferredId.value;
    if (itemIds.includes(preferredSelectionId)) {
      select(preferredSelectionId);
      return selectedId.value;
    }

    if (itemIds.includes(selectedId.value)) {
      select(selectedId.value);
      return selectedId.value;
    }

    const rememberedId = readStoredValue(activeStorageKey.value);
    const nextId = itemIds.includes(rememberedId)
      ? rememberedId
      : String(fallbackId || "").trim();
    select(nextId);
    return selectedId.value;
  }

  watch(activeStorageKey, (nextStorageKey) => {
    selectedId.value = activePreferredId.value || readStoredValue(nextStorageKey);
  });

  watch(activePreferredId, (nextPreferredId) => {
    if (nextPreferredId) {
      selectedId.value = nextPreferredId;
    }
  });

  return {
    clear,
    select,
    selectAvailableId,
    selectedId
  };
}

export {
  useStoredSelection
};
