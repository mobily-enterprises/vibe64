import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

const lifecycleHooks = vi.hoisted(() => ({
  beforeUnmount: []
}));

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onBeforeUnmount(callback) {
      lifecycleHooks.beforeUnmount.push(callback);
    }
  };
});

describe("useScrollToBottom", () => {
  let originalWindowDescriptor;

  beforeEach(() => {
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    lifecycleHooks.beforeUnmount.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      delete globalThis.window;
    }
    vi.useRealTimers();
  });

  it("scrolls after Vue, layout, and delayed settle work", async () => {
    let frameCallback = null;
    installWindow({
      requestAnimationFrame(callback) {
        frameCallback = callback;
        return 1;
      }
    });

    const target = createScrollableElement(240);
    const anchor = {
      scrollIntoView: vi.fn()
    };
    const { useScrollToBottom } = await import("../../src/composables/useScrollToBottom.js");
    const { scrollAfterLayout } = useScrollToBottom({
      anchor: ref(anchor),
      target: ref(target)
    });

    const scrollPromise = scrollAfterLayout();

    expect(target.scrollWrites).toEqual([]);

    await nextTick();
    await Promise.resolve();

    expect(target.scrollWrites).toEqual([240, 240]);
    expect(anchor.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(anchor.scrollIntoView).toHaveBeenLastCalledWith({
      block: "end"
    });

    frameCallback();
    await scrollPromise;

    expect(target.scrollWrites).toEqual([240, 240, 240, 240]);
    expect(anchor.scrollIntoView).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(0);
    expect(target.scrollWrites).toEqual([240, 240, 240, 240, 240, 240]);
    expect(anchor.scrollIntoView).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(79);
    expect(target.scrollWrites).toEqual([240, 240, 240, 240, 240, 240]);

    vi.advanceTimersByTime(1);
    expect(target.scrollWrites).toEqual([240, 240, 240, 240, 240, 240, 240, 240]);
    expect(anchor.scrollIntoView).toHaveBeenCalledTimes(4);
  });

  it("clears delayed scroll timers on unmount", async () => {
    installWindow({
      requestAnimationFrame(callback) {
        callback();
        return 1;
      }
    });

    const target = createScrollableElement(180);
    const anchor = {
      scrollIntoView: vi.fn()
    };
    const { useScrollToBottom } = await import("../../src/composables/useScrollToBottom.js");
    const { scrollAfterLayout } = useScrollToBottom({
      anchor: ref(anchor),
      target: ref(target)
    });

    await scrollAfterLayout();

    expect(target.scrollWrites).toEqual([180, 180, 180, 180]);
    expect(lifecycleHooks.beforeUnmount).toHaveLength(1);

    lifecycleHooks.beforeUnmount[0]();
    vi.runAllTimers();

    expect(target.scrollWrites).toEqual([180, 180, 180, 180]);
    expect(anchor.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does not scroll while disabled", async () => {
    installWindow({
      requestAnimationFrame(callback) {
        callback();
        return 1;
      }
    });

    const target = createScrollableElement(120);
    const enabled = ref(false);
    const { useScrollToBottom } = await import("../../src/composables/useScrollToBottom.js");
    const { scrollAfterLayout } = useScrollToBottom({
      enabled,
      target: ref(target)
    });

    await scrollAfterLayout();
    vi.runAllTimers();

    expect(target.scrollWrites).toEqual([]);
  });

  it("uses smooth element scrolling when requested", async () => {
    const target = createScrollableElement(420, {
      scrollTo: true
    });
    const anchor = {
      scrollIntoView: vi.fn()
    };
    const { useScrollToBottom } = await import("../../src/composables/useScrollToBottom.js");
    const { scrollNow } = useScrollToBottom({
      anchor: ref(anchor),
      target: ref(target)
    });

    scrollNow({
      behavior: "smooth"
    });

    expect(target.scrollWrites).toEqual([]);
    expect(target.scrollToCalls).toEqual([
      {
        behavior: "smooth",
        top: 420
      },
      {
        behavior: "smooth",
        top: 420
      }
    ]);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "end"
    });
  });

  it("does not run delayed settle scrolls after becoming disabled", async () => {
    installWindow({
      requestAnimationFrame(callback) {
        callback();
        return 1;
      }
    });

    const target = createScrollableElement(260);
    const enabled = ref(true);
    const { useScrollToBottom } = await import("../../src/composables/useScrollToBottom.js");
    const { scrollAfterLayout } = useScrollToBottom({
      enabled,
      target: ref(target)
    });

    await scrollAfterLayout();

    expect(target.scrollWrites).toEqual([260, 260, 260, 260]);

    enabled.value = false;
    vi.runAllTimers();

    expect(target.scrollWrites).toEqual([260, 260, 260, 260]);
  });

  it("can keep scrolling confined to the target element", async () => {
    installWindow({
      requestAnimationFrame(callback) {
        callback();
        return 1;
      }
    });

    const target = createScrollableElement(320);
    const anchor = {
      scrollIntoView: vi.fn()
    };
    const { useScrollToBottom } = await import("../../src/composables/useScrollToBottom.js");
    const { scrollAfterLayout } = useScrollToBottom({
      anchor: ref(anchor),
      scrollAnchorIntoView: false,
      target: ref(target)
    });

    await scrollAfterLayout();
    vi.runAllTimers();

    expect(target.scrollWrites).toEqual([320, 320, 320, 320, 320, 320, 320, 320]);
    expect(anchor.scrollIntoView).not.toHaveBeenCalled();
  });
});

function installWindow({
  requestAnimationFrame
} = {}) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout: globalThis.clearTimeout,
      requestAnimationFrame: vi.fn(requestAnimationFrame),
      setTimeout: globalThis.setTimeout
    }
  });
}

function createScrollableElement(scrollHeight, {
  scrollTo = false
} = {}) {
  const scrollToCalls = [];
  const scrollWrites = [];
  let currentScrollTop = 0;

  const element = {
    get scrollTop() {
      return currentScrollTop;
    },
    set scrollTop(value) {
      currentScrollTop = value;
      scrollWrites.push(value);
    },
    scrollHeight,
    scrollToCalls,
    scrollWrites
  };

  if (scrollTo) {
    element.scrollTo = vi.fn((options) => {
      scrollToCalls.push(options);
    });
  }

  return element;
}
