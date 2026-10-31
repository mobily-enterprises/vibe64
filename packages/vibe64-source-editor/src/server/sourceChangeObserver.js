import { watch as watchDirectory } from "node:fs";
import path from "node:path";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

const DEFAULT_SOURCE_CHANGE_DEBOUNCE_MS = 60;

function resolveObservedFile(sourceRoot = "", relativePath = "") {
  const root = String(sourceRoot || "").trim()
    ? path.resolve(sourceRoot)
    : "";
  const requestedPath = String(relativePath || "").trim();
  if (!root) {
    throw new TypeError("Source file observation requires sourceRoot.");
  }
  if (!requestedPath || path.isAbsolute(requestedPath)) {
    throw new TypeError("Source file observation requires a relative file path.");
  }
  const absolutePath = path.resolve(root, requestedPath);
  const normalizedRelativePath = path.relative(root, absolutePath);
  if (
    !normalizedRelativePath ||
    normalizedRelativePath === "." ||
    normalizedRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(normalizedRelativePath)
  ) {
    throw new TypeError("Source file observation requires a path inside sourceRoot.");
  }
  return {
    directoryPath: path.dirname(absolutePath),
    filename: path.basename(absolutePath)
  };
}

/**
 * @param {object} dependencies
 * @param {typeof watchDirectory} [dependencies.createWatcher]
 * @param {number} [dependencies.debounceMs]
 * @param {RuntimeLogger} dependencies.logger
 */
function createSourceEditorFileObserver({
  createWatcher = watchDirectory,
  debounceMs = DEFAULT_SOURCE_CHANGE_DEBOUNCE_MS,
  logger
}) {
  const directories = new Map();
  const normalizedDebounceMs = Math.max(0, Number(debounceMs) || 0);

  function notify(listener, event) {
    try {
      listener(event);
    } catch (error) {
      logger.warn({ error }, "Source change listener failed.");
    }
  }

  function broadcast(target, event) {
    for (const listener of [...target.listeners]) {
      notify(listener, event);
    }
  }

  function scheduleChange(target) {
    clearTimeout(target.timer);
    target.timer = setTimeout(() => {
      target.timer = null;
      broadcast(target, {
        kind: "change",
        updatedAt: new Date().toISOString()
      });
    }, normalizedDebounceMs);
    target.timer.unref();
  }

  function processDirectoryChange(entry, filename) {
    const changedName = filename == null ? "" : String(filename);
    for (const target of entry.targets.values()) {
      if (!changedName || changedName === target.filename) {
        scheduleChange(target);
      }
    }
  }

  function createDirectoryEntry(directoryPath) {
    const entry = {
      targets: new Map(),
      watcher: null
    };
    const watcher = createWatcher(directoryPath, {
      persistent: false
    }, (_eventType, filename) => {
      processDirectoryChange(entry, filename);
    });
    entry.watcher = watcher;
    watcher.on("error", (error) => {
      logger.warn({ directoryPath, error }, "Source file watcher failed.");
      for (const target of [...entry.targets.values()]) {
        broadcast(target, {
          error: String(error?.message || error || "Source file watcher failed."),
          kind: "error"
        });
      }
    });
    directories.set(directoryPath, entry);
    return entry;
  }

  function subscribe({
    relativePath = "",
    sourceRoot = ""
  } = {}, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Source file observation requires a listener.");
    }
    const {
      directoryPath,
      filename
    } = resolveObservedFile(sourceRoot, relativePath);
    const entry = directories.get(directoryPath) || createDirectoryEntry(directoryPath);
    let target = entry.targets.get(filename);
    if (!target) {
      target = {
        filename,
        listeners: new Set(),
        timer: null
      };
      entry.targets.set(filename, target);
    }
    target.listeners.add(listener);
    queueMicrotask(() => {
      if (target.listeners.has(listener)) {
        notify(listener, {
          kind: "ready"
        });
      }
    });

    return function unsubscribe() {
      if (!target.listeners.delete(listener) || target.listeners.size > 0) {
        return;
      }
      clearTimeout(target.timer);
      entry.targets.delete(filename);
      if (entry.targets.size > 0 || directories.get(directoryPath) !== entry) {
        return;
      }
      directories.delete(directoryPath);
      entry.watcher.close();
    };
  }

  function close() {
    const entries = [...directories.values()];
    directories.clear();
    for (const entry of entries) {
      const targets = [...entry.targets.values()];
      entry.targets.clear();
      entry.watcher.close();
      for (const target of targets) {
        clearTimeout(target.timer);
        broadcast(target, {
          kind: "closed"
        });
      }
    }
  }

  return Object.freeze({
    close,
    subscribe
  });
}

export {
  createSourceEditorFileObserver
};
