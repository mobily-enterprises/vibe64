// Records, in order, what makes a replaced file durable: each fsync (of a file
// or a folder, by the path it was opened at) and each rename, through both the
// promise and the synchronous file APIs. A test proves a durable replacement
// with assertDurablyReplaced: the new file's data reached the disk before it
// was renamed over the target, and the folder after the rename.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const OPENED_THROUGH_DESCRIPTOR = /^\/proc\/self\/fd\/(\d+)(?:\/(.*))?$/u;

/**
 * Starts recording for the rest of test t, and returns the events: { op:
 * "fsync", path } and { op: "rename", from, to }, paths absolute.
 */
async function traceDurableWrites(t) {
  const events = [];
  const handlePaths = new WeakMap();
  const descriptorPaths = new Map();
  const restores = [];
  // A path through /proc/self/fd/N names what descriptor N was opened at.
  const resolved = (value) => {
    const text = path.resolve(Buffer.isBuffer(value) ? value.toString("utf8") : String(value));
    const match = OPENED_THROUGH_DESCRIPTOR.exec(text);
    const opened = match && descriptorPaths.get(Number(match[1]));
    return opened ? path.join(opened, match[2] || "") : text;
  };
  const replace = (target, name, wrap) => {
    const original = target[name];
    target[name] = wrap(original);
    restores.push(() => {
      target[name] = original;
    });
  };

  replace(fs.promises, "open", (open) => async function tracedOpen(file, ...rest) {
    const handle = await Reflect.apply(open, this, [file, ...rest]);
    handlePaths.set(handle, resolved(file));
    return handle;
  });
  const probe = await fs.promises.open(import.meta.filename, "r");
  const handlePrototype = Object.getPrototypeOf(probe);
  await probe.close();
  for (const name of ["sync", "datasync"]) {
    replace(handlePrototype, name, (sync) => async function tracedSync(...args) {
      const result = await Reflect.apply(sync, this, args);
      events.push({ op: "fsync", path: handlePaths.get(this) });
      return result;
    });
  }
  replace(fs.promises, "rename", (rename) => async function tracedRename(from, to) {
    const event = { op: "rename", from: resolved(from), to: resolved(to) };
    await Reflect.apply(rename, this, [from, to]);
    events.push(event);
  });

  replace(fs, "openSync", (openSync) => function tracedOpenSync(file, ...rest) {
    const at = resolved(file);
    const descriptor = Reflect.apply(openSync, this, [file, ...rest]);
    descriptorPaths.set(descriptor, at);
    return descriptor;
  });
  for (const name of ["fsyncSync", "fdatasyncSync"]) {
    replace(fs, name, (fsyncSync) => function tracedFsyncSync(descriptor) {
      Reflect.apply(fsyncSync, this, [descriptor]);
      events.push({ op: "fsync", path: descriptorPaths.get(descriptor) });
    });
  }
  replace(fs, "renameSync", (renameSync) => function tracedRenameSync(from, to) {
    const event = { op: "rename", from: resolved(from), to: resolved(to) };
    Reflect.apply(renameSync, this, [from, to]);
    events.push(event);
  });
  replace(fs, "closeSync", (closeSync) => function tracedCloseSync(descriptor) {
    Reflect.apply(closeSync, this, [descriptor]);
    descriptorPaths.delete(descriptor);
  });

  syncBuiltinESMExports();
  t.after(() => {
    for (const restore of restores.reverse()) restore();
    syncBuiltinESMExports();
  });
  return events;
}

/**
 * Asserts the last replacement of target was durable: a file beside it, synced
 * after it was opened and before the rename, renamed over it, and the folder
 * synced after the rename.
 */
function assertDurablyReplaced(events, target) {
  const file = path.resolve(target);
  const renamed = events.findLastIndex((event) => event.op === "rename" && event.to === file);
  assert.notEqual(renamed, -1, `${file} was not replaced by a rename`);
  const { from } = events[renamed];
  assert.equal(path.dirname(from), path.dirname(file), `${file} was replaced from another folder: ${from}`);
  assert.ok(
    events.slice(0, renamed).some((event) => event.op === "fsync" && event.path === from),
    `${file}'s new data was not synced to disk before the rename (${from})`
  );
  assert.ok(
    events.slice(renamed + 1).some((event) => event.op === "fsync" && event.path === path.dirname(file)),
    `${file}'s folder was not synced to disk after the rename`
  );
}

export { assertDurablyReplaced, traceDurableWrites };
