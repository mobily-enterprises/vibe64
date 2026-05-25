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

function createScrollableElement(scrollHeight) {
  const scrollWrites = [];
  let currentScrollTop = 0;

  return {
    get scrollTop() {
      return currentScrollTop;
    },
    set scrollTop(value) {
      currentScrollTop = value;
      scrollWrites.push(value);
    },
    scrollHeight,
    scrollWrites
  };
}
