import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { test } from "node:test";

import {
  createSourceEditorFileObserver
} from "../../packages/vibe64-source-editor/src/server/sourceChangeObserver.js";

function nextTimer() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function fakeWatcherFactory(records) {
  return (directoryPath, options, listener) => {
    const watcher = new EventEmitter();
    watcher.closed = false;
    watcher.close = () => {
      watcher.closed = true;
    };
    records.push({
      directoryPath,
      listener,
      options,
      watcher
    });
    return watcher;
  };
}

test("source file observer watches only selected files' immediate directories", async () => {
  const watchers = [];
  const observer = createSourceEditorFileObserver({ logger: console,
    createWatcher: fakeWatcherFactory(watchers),
    debounceMs: 0
  });
  const sourceRoot = path.resolve("/workspace/session/source");
  const appEvents = [];
  const testEvents = [];

  const unsubscribeApp = observer.subscribe({
    relativePath: "src/app.js",
    sourceRoot
  }, (event) => appEvents.push(event));
  const unsubscribeTest = observer.subscribe({
    relativePath: "src/app.test.js",
    sourceRoot
  }, (event) => testEvents.push(event));
  await Promise.resolve();

  assert.equal(watchers.length, 1);
  assert.equal(watchers[0].directoryPath, path.join(sourceRoot, "src"));
  assert.deepEqual(watchers[0].options, {
    persistent: false
  });
  assert.equal("recursive" in watchers[0].options, false);
  assert.equal(appEvents[0].kind, "ready");
  assert.equal(testEvents[0].kind, "ready");

  watchers[0].listener("change", "unrelated.js");
  await nextTimer();
  assert.equal(appEvents.length, 1);
  assert.equal(testEvents.length, 1);

  watchers[0].listener("rename", "app.js");
  await nextTimer();
  assert.equal(appEvents.length, 2);
  assert.equal(appEvents[1].kind, "change");
  assert.equal(testEvents.length, 1);

  unsubscribeApp();
  assert.equal(watchers[0].watcher.closed, false);
  unsubscribeTest();
  assert.equal(watchers[0].watcher.closed, true);
});

test("source file observer rejects paths outside the source root", () => {
  const observer = createSourceEditorFileObserver({ logger: console,
    createWatcher: fakeWatcherFactory([])
  });
  const sourceRoot = path.resolve("/workspace/session/source");

  assert.throws(() => observer.subscribe({
    relativePath: "../other/file.js",
    sourceRoot
  }, () => {}), /inside sourceRoot/u);
});

test("source file observer closes active watches during service shutdown", async () => {
  const watchers = [];
  const events = [];
  const observer = createSourceEditorFileObserver({ logger: console,
    createWatcher: fakeWatcherFactory(watchers)
  });
  observer.subscribe({
    relativePath: "docs/missing.md",
    sourceRoot: path.resolve("/workspace/session/source")
  }, (event) => events.push(event));
  await Promise.resolve();

  observer.close();

  assert.equal(watchers[0].watcher.closed, true);
  assert.equal(events.at(-1).kind, "closed");
});
