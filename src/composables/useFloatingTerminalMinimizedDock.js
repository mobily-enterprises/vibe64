import { computed, onBeforeUnmount, ref, unref, watch } from "vue";

const DOCK_GAP_PX = 8;

let dockEntrySequence = 0;
const dockEntries = ref([]);

function normalizedDockWidth(width = 0) {
  const number = Number(width);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function removeDockEntry(entryId = "") {
  dockEntries.value = dockEntries.value.filter((entry) => entry.id !== entryId);
}

function ensureDockEntry(entryId = "") {
  if (!entryId || dockEntries.value.some((entry) => entry.id === entryId)) {
    return;
  }
  dockEntries.value = [
    ...dockEntries.value,
    {
      id: entryId,
      width: 0
    }
  ];
}

function setDockEntryWidth(entryId = "", width = 0) {
  ensureDockEntry(entryId);
  const nextWidth = normalizedDockWidth(width);
  dockEntries.value = dockEntries.value.map((entry) => {
    return entry.id === entryId
      ? {
          ...entry,
          width: nextWidth
        }
      : entry;
  });
}

function dockOffsetBefore(entryId = "") {
  let offset = 0;
  for (const entry of dockEntries.value) {
    if (entry.id === entryId) {
      return offset;
    }
    offset += normalizedDockWidth(entry.width) + DOCK_GAP_PX;
  }
  return 0;
}

function useFloatingTerminalMinimizedDock(active) {
  const entryId = `floating-terminal-dock-${++dockEntrySequence}`;
  const rightOffset = computed(() => dockOffsetBefore(entryId));

  function updateWidth(width = 0) {
    if (!unref(active)) {
      return;
    }
    setDockEntryWidth(entryId, width);
  }

  watch(
    () => Boolean(unref(active)),
    (isActive) => {
      if (isActive) {
        ensureDockEntry(entryId);
        return;
      }
      removeDockEntry(entryId);
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    removeDockEntry(entryId);
  });

  return {
    rightOffset,
    updateWidth
  };
}

export {
  useFloatingTerminalMinimizedDock
};
