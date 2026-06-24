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

function normalizedScrollBehavior(value = "") {
  return value === "smooth" ? "smooth" : "auto";
}

function scrollElementToBottom(targetElement, behavior = "auto") {
  if (behavior === "smooth" && typeof targetElement.scrollTo === "function") {
    targetElement.scrollTo({
      behavior,
      top: targetElement.scrollHeight
    });
    return;
  }
  targetElement.scrollTop = targetElement.scrollHeight;
}

function useScrollToBottom({
  anchor = null,
  enabled = true,
  scrollAnchorIntoView = true,
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

  function scrollNow(options = {}) {
    if (disposed || !isEnabled()) {
      return;
    }

    const targetElement = readElement(target);
    if (!targetElement) {
      return;
    }

    const behavior = normalizedScrollBehavior(options?.behavior);
    scrollElementToBottom(targetElement, behavior);
    if (scrollAnchorIntoView !== false) {
      const anchorOptions = {
        block: "end"
      };
      if (behavior === "smooth") {
        anchorOptions.behavior = behavior;
      }
      readElement(anchor)?.scrollIntoView?.(anchorOptions);
    }
    scrollElementToBottom(targetElement, behavior);
  }

  function scheduleScroll(delayMs, options = {}) {
    if (disposed || !isEnabled() || !hasWindowTimer("setTimeout")) {
      return;
    }

    const timer = window.setTimeout(() => {
      scheduledTimers.delete(timer);
      scrollNow(options);
    }, delayMs);
    scheduledTimers.add(timer);
  }

  async function scrollAfterLayout(options = {}) {
    if (disposed || !isEnabled()) {
      return;
    }

    await nextTick();
    scrollNow(options);

    await waitForLayoutFrame();
    scrollNow(options);

    clearScheduledScrolls();
    settleDelaysMs.forEach((delayMs) => {
      scheduleScroll(delayMs, options);
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
