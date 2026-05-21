function shellShortcutAction(event = {}) {
  const key = String(event.key || "").toLowerCase();
  const plainAlt = event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey;

  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === "t") {
    return {
      type: "new-tab"
    };
  }
  if (plainAlt && key === "n") {
    return {
      type: "new-tab"
    };
  }
  if (plainAlt && /^[1-9]$/u.test(key)) {
    return {
      tabIndex: Number(key) - 1,
      type: "select-tab"
    };
  }
  return null;
}

function consumeShellShortcutEvent(event = {}) {
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
}

export {
  consumeShellShortcutEvent,
  shellShortcutAction
};
