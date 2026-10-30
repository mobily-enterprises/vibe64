// Parsed Genesis snapshots are large: on Vibe64 itself the Machine City holds
// about 80 MiB of heap and the indexed call web about 25 MiB. They are kept
// only while someone reads them. Each read renews an entry; an entry nobody
// read for two minutes is released. Two minutes covers reading code between
// clicks, while re-parsing after a longer pause costs only a second or two.
const GENESIS_SNAPSHOT_IDLE_MS = 2 * 60 * 1000;

// At most `capacity` keys, least recently read first out. Each key holds one
// loaded value for one identity; another identity replaces it, and a failed
// load is not kept.
function createSnapshotCache({ capacity, idleMs = GENESIS_SNAPSHOT_IDLE_MS, now = () => Date.now() } = {}) {
  const entries = new Map();
  let timer = null;

  function sweep() {
    const current = now();
    for (const [key, entry] of entries) if (current - entry.usedAt >= idleMs) entries.delete(key);
    clearTimeout(timer);
    timer = null;
    if (entries.size) {
      const next = Math.min(...[...entries.values()].map((entry) => entry.usedAt + idleMs)) - current;
      timer = setTimeout(sweep, Math.max(1000, next));
      timer.unref?.();
    }
  }

  function read(key, identity, load) {
    sweep();
    const existing = entries.get(key);
    entries.delete(key);
    if (existing?.identity === identity) {
      existing.usedAt = now();
      entries.set(key, existing);
      return existing.promise;
    }
    const entry = { identity, usedAt: now(), promise: Promise.resolve().then(load) };
    entries.set(key, entry);
    while (entries.size > capacity) entries.delete(entries.keys().next().value);
    entry.promise.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
    sweep();
    return entry.promise;
  }

  return Object.freeze({
    read,
    sweep,
    delete(key) { entries.delete(key); },
    get size() { return entries.size; },
    clear() { entries.clear(); clearTimeout(timer); timer = null; }
  });
}

export {
  GENESIS_SNAPSHOT_IDLE_MS,
  createSnapshotCache
};
