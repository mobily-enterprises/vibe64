import { describe, expect, it, vi } from "vitest";
import {
  consumeShellShortcutEvent,
  shellShortcutAction
} from "../../src/lib/aiStudioShellShortcuts.js";

function keyboardEvent(overrides = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: "",
    metaKey: false,
    preventDefault: vi.fn(),
    shiftKey: false,
    stopImmediatePropagation: vi.fn(),
    ...overrides
  };
}

describe("AI Studio shell shortcuts", () => {
  it("recognizes tab creation and tab selection shortcuts", () => {
    expect(shellShortcutAction(keyboardEvent({
      ctrlKey: true,
      key: "T",
      shiftKey: true
    }))).toEqual({
      type: "new-tab"
    });
    expect(shellShortcutAction(keyboardEvent({
      altKey: true,
      key: "n"
    }))).toEqual({
      type: "new-tab"
    });
    expect(shellShortcutAction(keyboardEvent({
      altKey: true,
      key: "3"
    }))).toEqual({
      tabIndex: 2,
      type: "select-tab"
    });
  });

  it("ignores unrelated or modified key presses", () => {
    expect(shellShortcutAction(keyboardEvent({
      key: "3"
    }))).toBeNull();
    expect(shellShortcutAction(keyboardEvent({
      altKey: true,
      key: "3",
      shiftKey: true
    }))).toBeNull();
    expect(shellShortcutAction(keyboardEvent({
      altKey: true,
      key: "0"
    }))).toBeNull();
  });

  it("prevents consumed shell shortcuts from reaching xterm", () => {
    const event = keyboardEvent({
      altKey: true,
      key: "1"
    });

    consumeShellShortcutEvent(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });
});
