import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Keep filename discovery out of the typing loop. Root-tree refreshes and editor
// creates invalidate immediately; the age limit also picks up external writers.
function createSourceEditorFileIndex({ load, snapshotPath = null, now = Date.now } = {}) {
  const entries = new Map();
  const maxAgeMs = 30_000;
  const maxEntries = 8;

  return {
    async read(context) {
      const key = context.sourceRoot;
      let entry = entries.get(key);
      if (entry && (entry.pending || (!entry.invalid && now() - entry.loadedAt < maxAgeMs))) {
        entries.delete(key);
        entries.set(key, entry);
        return entry.pending || entry.value;
      }
      const useSnapshot = !entry;
      entry = { loadedAt: 0, pending: null, value: null };
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      entry.pending = Promise.resolve().then(async () => {
        const target = snapshotPath?.(context);
        if (target && useSnapshot) {
          try {
            const saved = JSON.parse(await readFile(target, "utf8"));
            if (now() - saved.loadedAt < maxAgeMs) return saved.value;
          } catch (error) {
            if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
          }
        }
        const value = await load(context);
        if (target && entries.get(key) === entry) {
          if (value.truncated) {
            await rm(target, { force: true });
          } else {
            await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
            const temporary = `${target}.${randomUUID()}.tmp`;
            try {
              await writeFile(temporary, JSON.stringify({ loadedAt: now(), value }), { mode: 0o600 });
              if (entries.get(key) === entry) await rename(temporary, target);
            } finally {
              await rm(temporary, { force: true });
            }
          }
        }
        return value;
      }).then((value) => {
        entry.value = value;
        entry.loadedAt = now();
        // A timeout/partial scan must never become a complete cached index.
        if (value.truncated && entries.get(key) === entry) entries.delete(key);
        return value;
      }).catch((error) => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      }).finally(() => { entry.pending = null; });
      return entry.pending;
    },
    invalidate(sourceRoot) {
      entries.set(sourceRoot, { invalid: true });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    clear() {
      entries.clear();
    }
  };
}

export { createSourceEditorFileIndex };
