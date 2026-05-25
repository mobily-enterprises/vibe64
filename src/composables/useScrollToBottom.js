import { nextTick, onBeforeUnmount, unref } from "vue";

const DEFAULT_SETTLE_DELAYS_MS = [0, 80];

function readElement(value) {
  return unref(value) || null;
}

function hasWindowTimer(name) {
  return typeof window !== "undefined" && typeof window[name] === "function";
}

function waitForLayoutFrame() {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(resolve);
  });
}

function useScrollToBottom({
  anchor = null,
  enabled = true,
  settleDelaysMs = DEFAULT_SETTLE_DELAYS_MS,
  target
} = {}) {
  const scheduledTimers = new Set();
  let disposed = false;

  function isEnabled() {
    return unref(enabled) !== false;
  }

  function clearScheduledScrolls() {
    if (hasWindowTimer("clearTimeout")) {
      scheduledTimers.forEach((timer) => {
        window.clearTimeout(timer);
      });
    }
    scheduledTimers.clear();
  }

  function scrollNow() {
    if (disposed || !isEnabled()) {
      return;
    }

    const targetElement = readElement(target);
    if (!targetElement) {
      return;
    }

    targetElement.scrollTop = targetElement.scrollHeight;
    readElement(anchor)?.scrollIntoView?.({
      block: "end"
    });
    targetElement.scrollTop = targetElement.scrollHeight;
  }

  function scheduleScroll(delayMs) {
    if (disposed || !isEnabled() || !hasWindowTimer("setTimeout")) {
      return;
    }

    const timer = window.setTimeout(() => {
      scheduledTimers.delete(timer);
      scrollNow();
    }, delayMs);
    scheduledTimers.add(timer);
  }

  async function scrollAfterLayout() {
    if (disposed || !isEnabled()) {
      return;
    }

    await nextTick();
    scrollNow();

    await waitForLayoutFrame();
    scrollNow();

    clearScheduledScrolls();
    settleDelaysMs.forEach((delayMs) => {
      scheduleScroll(delayMs);
    });
  }

  onBeforeUnmount(() => {
    disposed = true;
    clearScheduledScrolls();
  });

  return {
    clearScheduledScrolls,
    scrollAfterLayout,
    scrollNow
  };
}

export {
  useScrollToBottom
};
