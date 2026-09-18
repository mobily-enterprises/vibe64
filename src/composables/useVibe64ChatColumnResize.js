import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";

const VIBE64_CHAT_COLUMN_STORAGE_KEY = "vibe64:studio-chat-column-width";
const VIBE64_CHAT_COLUMN_DEFAULT_WIDTH_PX = 512;
const VIBE64_CHAT_COLUMN_MIN_WIDTH_PX = 512;
const VIBE64_CHAT_COLUMN_MAX_WIDTH_PX = 720;
const VIBE64_PROJECT_COLUMN_MIN_WIDTH_PX = 480;
const VIBE64_PROJECT_COLUMN_GAP_PX = 12;
const VIBE64_CHAT_COLUMN_KEYBOARD_STEP_PX = 16;

const staticChatColumnBounds = Object.freeze({
  max: VIBE64_CHAT_COLUMN_MAX_WIDTH_PX,
  min: VIBE64_CHAT_COLUMN_MIN_WIDTH_PX
});

function vibe64ChatColumnBounds(containerWidth = 0) {
  const width = Number(containerWidth);
  if (!Number.isFinite(width) || width <= 0) {
    return { ...staticChatColumnBounds };
  }
  return {
    max: Math.max(
      VIBE64_CHAT_COLUMN_MIN_WIDTH_PX,
      Math.min(
        VIBE64_CHAT_COLUMN_MAX_WIDTH_PX,
        Math.floor(
          width - VIBE64_PROJECT_COLUMN_MIN_WIDTH_PX - VIBE64_PROJECT_COLUMN_GAP_PX
        )
      )
    ),
    min: VIBE64_CHAT_COLUMN_MIN_WIDTH_PX
  };
}

function constrainVibe64ChatColumnWidth(
  value,
  bounds = staticChatColumnBounds,
  fallback = VIBE64_CHAT_COLUMN_DEFAULT_WIDTH_PX
) {
  const min = Number.isFinite(bounds?.min)
    ? bounds.min
    : VIBE64_CHAT_COLUMN_MIN_WIDTH_PX;
  const max = Math.max(
    min,
    Number.isFinite(bounds?.max) ? bounds.max : VIBE64_CHAT_COLUMN_MAX_WIDTH_PX
  );
  const width = Number.isFinite(value) ? value : fallback;
  return Math.round(Math.min(max, Math.max(min, width)));
}

function vibe64ChatColumnWidthForKey(key = "", currentWidth = 0, bounds = {}) {
  if (key === "Home") {
    return constrainVibe64ChatColumnWidth(bounds.min, bounds);
  }
  if (key === "End") {
    return constrainVibe64ChatColumnWidth(bounds.max, bounds);
  }
  if (key === "ArrowLeft") {
    return constrainVibe64ChatColumnWidth(
      currentWidth - VIBE64_CHAT_COLUMN_KEYBOARD_STEP_PX,
      bounds
    );
  }
  if (key === "ArrowRight") {
    return constrainVibe64ChatColumnWidth(
      currentWidth + VIBE64_CHAT_COLUMN_KEYBOARD_STEP_PX,
      bounds
    );
  }
  return null;
}

function useVibe64ChatColumnResize() {
  const separator = ref(null);
  const resizing = ref(false);
  const preferredWidth = ref(constrainVibe64ChatColumnWidth(
    readLocalStorageJson(VIBE64_CHAT_COLUMN_STORAGE_KEY, null),
    staticChatColumnBounds
  ));
  const bounds = ref({ ...staticChatColumnBounds });
  const width = computed(() => constrainVibe64ChatColumnWidth(
    preferredWidth.value,
    bounds.value
  ));
  let drag = null;
  let pendingLayoutWidth = null;
  let resizeFrame = null;
  let resizeObserver = null;
  let windowResizeFallbackActive = false;

  function splitPane() {
    return separator.value?.parentElement || null;
  }

  function syncBounds() {
    const containerWidth = splitPane()?.clientWidth || 0;
    if (containerWidth > 0) {
      bounds.value = vibe64ChatColumnBounds(containerWidth);
    }
  }

  function save() {
    writeLocalStorageJson(VIBE64_CHAT_COLUMN_STORAGE_KEY, width.value);
  }

  function layoutTargets() {
    if (typeof document === "undefined") {
      return [];
    }
    return [
      splitPane(),
      document.querySelector(".studio-home-shell-heading")
    ].filter(Boolean);
  }

  function applyLayoutWidth(value) {
    for (const target of layoutTargets()) {
      target.style.setProperty("--studio-home-chat-column-width", `${value}px`);
    }
    separator.value?.setAttribute?.("aria-valuenow", String(value));
  }

  function flushLayoutWidth() {
    resizeFrame = null;
    if (pendingLayoutWidth === null) {
      return;
    }
    const value = pendingLayoutWidth;
    pendingLayoutWidth = null;
    applyLayoutWidth(value);
  }

  function scheduleLayoutWidth(value) {
    pendingLayoutWidth = value;
    if (
      resizeFrame !== null ||
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      if (resizeFrame === null) {
        flushLayoutWidth();
      }
      return;
    }
    resizeFrame = window.requestAnimationFrame(flushLayoutWidth);
  }

  function cancelScheduledLayout() {
    if (
      resizeFrame !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = null;
    pendingLayoutWidth = null;
  }

  function stopResize(event) {
    if (
      event?.pointerId !== undefined &&
      drag?.pointerId !== undefined &&
      event.pointerId !== drag.pointerId
    ) {
      return;
    }
    const completedDrag = drag;
    drag = null;
    resizing.value = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    }
    if (!completedDrag) {
      return;
    }
    if (completedDrag.target?.hasPointerCapture?.(completedDrag.pointerId)) {
      completedDrag.target.releasePointerCapture(completedDrag.pointerId);
    }
    cancelScheduledLayout();
    preferredWidth.value = completedDrag.width;
    applyLayoutWidth(width.value);
    save();
  }

  function moveResize(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    drag.width = constrainVibe64ChatColumnWidth(
      drag.startWidth + event.clientX - drag.startX,
      bounds.value
    );
    scheduleLayoutWidth(drag.width);
  }

  function startResize(event) {
    if (event.button !== 0 || typeof window === "undefined") {
      return;
    }
    event.preventDefault();
    syncBounds();
    drag = {
      pointerId: event.pointerId,
      startWidth: width.value,
      startX: event.clientX,
      target: event.currentTarget,
      width: width.value
    };
    resizing.value = true;
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function resizeWithKeyboard(event) {
    syncBounds();
    const nextWidth = vibe64ChatColumnWidthForKey(
      event.key,
      width.value,
      bounds.value
    );
    if (nextWidth === null) {
      return;
    }
    event.preventDefault();
    preferredWidth.value = nextWidth;
    save();
  }

  function observeSplitPane() {
    const pane = splitPane();
    if (!pane) {
      return;
    }
    if (typeof ResizeObserver === "undefined") {
      if (typeof window !== "undefined") {
        windowResizeFallbackActive = true;
        window.addEventListener("resize", syncBounds);
      }
      return;
    }
    resizeObserver = new ResizeObserver(syncBounds);
    resizeObserver.observe(pane);
  }

  watch(width, applyLayoutWidth, { immediate: true });

  onMounted(async () => {
    await nextTick();
    syncBounds();
    applyLayoutWidth(width.value);
    observeSplitPane();
  });

  onBeforeUnmount(() => {
    stopResize();
    cancelScheduledLayout();
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    if (windowResizeFallbackActive && typeof window !== "undefined") {
      window.removeEventListener("resize", syncBounds);
    }
    windowResizeFallbackActive = false;
    for (const target of layoutTargets()) {
      target.style.removeProperty("--studio-home-chat-column-width");
    }
  });

  return {
    bounds,
    resizing,
    resizeWithKeyboard,
    separator,
    startResize,
    width
  };
}

export {
  VIBE64_CHAT_COLUMN_DEFAULT_WIDTH_PX,
  VIBE64_CHAT_COLUMN_MAX_WIDTH_PX,
  VIBE64_CHAT_COLUMN_MIN_WIDTH_PX,
  VIBE64_CHAT_COLUMN_STORAGE_KEY,
  constrainVibe64ChatColumnWidth,
  useVibe64ChatColumnResize,
  vibe64ChatColumnBounds,
  vibe64ChatColumnWidthForKey
};
