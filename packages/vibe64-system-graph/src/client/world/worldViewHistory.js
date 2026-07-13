function cloneWorldView(view) {
  if (!view || typeof view !== "object") {
    return null;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(view);
  }
  return JSON.parse(JSON.stringify(view));
}

function worldViewKey(view) {
  return JSON.stringify(view || null);
}

function createWorldViewHistory({ limit = 64 } = {}) {
  const maximumEntries = Math.max(1, Math.floor(Number(limit) || 64));
  const backStack = [];
  const forwardStack = [];

  function entry(view) {
    const cloned = cloneWorldView(view);
    return cloned
      ? {
          key: worldViewKey(cloned),
          view: cloned
        }
      : null;
  }

  function trim(stack) {
    if (stack.length > maximumEntries) {
      stack.splice(0, stack.length - maximumEntries);
    }
  }

  function record(view) {
    const next = entry(view);
    if (!next) {
      return false;
    }
    forwardStack.length = 0;
    if (backStack.at(-1)?.key === next.key) {
      return false;
    }
    backStack.push(next);
    trim(backStack);
    return true;
  }

  function move(currentView, source, destination) {
    const current = entry(currentView);
    if (!current) {
      return null;
    }
    while (source.length > 0) {
      const target = source.pop();
      if (target.key === current.key) {
        continue;
      }
      destination.push(current);
      trim(destination);
      return cloneWorldView(target.view);
    }
    return null;
  }

  return Object.freeze({
    back(currentView) {
      return move(currentView, backStack, forwardStack);
    },
    clear() {
      backStack.length = 0;
      forwardStack.length = 0;
    },
    forward(currentView) {
      return move(currentView, forwardStack, backStack);
    },
    get canBack() {
      return backStack.length > 0;
    },
    get canForward() {
      return forwardStack.length > 0;
    },
    get depths() {
      return {
        back: backStack.length,
        forward: forwardStack.length
      };
    },
    record
  });
}

export {
  createWorldViewHistory
};
