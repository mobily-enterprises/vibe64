import { computed, nextTick, onBeforeUnmount, ref, unref, watch } from "vue";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";

const WINDOW_MARGIN_PX = 12;

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function useVibe64TerminalWindow({
  active,
  storageKey
} = {}) {
  const panel = ref(null);
  const position = ref({
    left: WINDOW_MARGIN_PX,
    top: WINDOW_MARGIN_PX
  });
  const dimensions = ref({
    height: 0,
    width: 0
  });
  let drag = null;
  let resizeObserver = null;
  let trackingViewport = false;

  const style = computed(() => {
    const value = {
      left: `${Math.round(position.value.left)}px`,
      top: `${Math.round(position.value.top)}px`
    };
    if (dimensions.value.width > 0) {
      value.width = `${Math.round(dimensions.value.width)}px`;
    }
    if (dimensions.value.height > 0) {
      value.height = `${Math.round(dimensions.value.height)}px`;
    }
    return value;
  });

  function viewportSize() {
    return {
      height: typeof window === "undefined" ? 768 : window.innerHeight,
      width: typeof window === "undefined" ? 1024 : window.innerWidth
    };
  }

  function panelSize() {
    const viewport = viewportSize();
    return {
      height: dimensions.value.height || panel.value?.offsetHeight || Math.min(viewport.height - 24, 704),
      width: dimensions.value.width || panel.value?.offsetWidth || Math.min(viewport.width - 24, 1152)
    };
  }

  function clamp(nextPosition = {}) {
    const viewport = viewportSize();
    const size = panelSize();
    return {
      left: Math.min(
        Math.max(WINDOW_MARGIN_PX, Number(nextPosition.left || 0)),
        Math.max(WINDOW_MARGIN_PX, viewport.width - size.width - WINDOW_MARGIN_PX)
      ),
      top: Math.min(
        Math.max(WINDOW_MARGIN_PX, Number(nextPosition.top || 0)),
        Math.max(WINDOW_MARGIN_PX, viewport.height - size.height - WINDOW_MARGIN_PX)
      )
    };
  }

  function restore() {
    const state = readLocalStorageJson(String(unref(storageKey) || ""), null);
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return false;
    }
    dimensions.value = {
      height: positiveNumber(state.height),
      width: positiveNumber(state.width)
    };
    position.value = clamp({
      left: state.left,
      top: state.top
    });
    return true;
  }

  function save() {
    const key = String(unref(storageKey) || "");
    if (!key || !unref(active)) {
      return;
    }
    const size = panelSize();
    writeLocalStorageJson(key, {
      height: Math.round(size.height),
      left: Math.round(position.value.left),
      top: Math.round(position.value.top),
      width: Math.round(size.width)
    });
  }

  function place() {
    if (!unref(active) || restore()) {
      return;
    }
    const viewport = viewportSize();
    const size = panelSize();
    position.value = clamp({
      left: (viewport.width - size.width) / 2,
      top: (viewport.height - size.height) / 2
    });
    save();
  }

  function stopDrag() {
    const moved = Boolean(drag);
    drag = null;
    if (typeof window === "undefined") {
      return;
    }
    window.removeEventListener("pointermove", moveDrag);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
    if (moved) {
      save();
    }
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    position.value = clamp({
      left: drag.left + event.clientX - drag.x,
      top: drag.top + event.clientY - drag.y
    });
  }

  function startDrag(event) {
    if (event.button !== 0 || typeof window === "undefined") {
      return;
    }
    event.preventDefault();
    drag = {
      left: position.value.left,
      pointerId: event.pointerId,
      top: position.value.top,
      x: event.clientX,
      y: event.clientY
    };
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  }

  function clampCurrent() {
    if (!unref(active)) {
      return;
    }
    position.value = clamp(position.value);
    save();
  }

  function startViewportTracking() {
    if (trackingViewport || typeof window === "undefined") {
      return;
    }
    trackingViewport = true;
    window.addEventListener("resize", clampCurrent);
  }

  function stopViewportTracking() {
    if (!trackingViewport || typeof window === "undefined") {
      return;
    }
    trackingViewport = false;
    window.removeEventListener("resize", clampCurrent);
  }

  function observePanel() {
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    if (typeof ResizeObserver === "undefined" || !panel.value) {
      return;
    }
    resizeObserver = new ResizeObserver(() => {
      if (!panel.value) {
        return;
      }
      dimensions.value = {
        height: panel.value.offsetHeight,
        width: panel.value.offsetWidth
      };
      clampCurrent();
    });
    resizeObserver.observe(panel.value);
  }

  watch(
    () => Boolean(unref(active)),
    async (isActive) => {
      stopDrag();
      if (!isActive) {
        resizeObserver?.disconnect?.();
        resizeObserver = null;
        stopViewportTracking();
        return;
      }
      startViewportTracking();
      await nextTick();
      place();
      observePanel();
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    stopDrag();
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    stopViewportTracking();
  });

  return {
    panel,
    startDrag,
    style
  };
}

export {
  useVibe64TerminalWindow
};
