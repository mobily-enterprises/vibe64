// Each project in use checks whether its sessions need an update every 30 s.
const REPOSITORY_UPDATE_PROBE_INTERVAL_MS = 30_000;
// After a failed probe, the slowest the product allows.
const REPOSITORY_UPDATE_PROBE_RETRY_MS = 60_000;

// One probe timer per project, kept only while the project is in use: a
// browser watches it, or the last probe found an agent turn running in it.
// `probe(slug, { memory, watched })` returns { inUse, failed }; `memory` lives
// as long as the project's record. A probe never overlaps itself: ticks that
// pass while one runs are skipped.
function createRepositoryUpdateProbe({
  clearTimer = clearTimeout,
  now = Date.now,
  onError = () => {},
  probe,
  setTimer = setTimeout
} = {}) {
  if (typeof probe !== "function") {
    throw new TypeError("The repository update probe requires probe().");
  }
  const projects = new Map();
  let closed = false;

  function interval(entry) {
    return entry.failed ? REPOSITORY_UPDATE_PROBE_RETRY_MS : REPOSITORY_UPDATE_PROBE_INTERVAL_MS;
  }

  // An idle project's record only remembers when it was last probed.
  function pruneIdle() {
    for (const [slug, entry] of projects) {
      if (!entry.viewers && !entry.timer && !entry.running &&
          now() - entry.lastStartedAt >= REPOSITORY_UPDATE_PROBE_RETRY_MS) {
        projects.delete(slug);
      }
    }
  }

  function entryFor(slug) {
    pruneIdle();
    let entry = projects.get(slug);
    if (!entry) {
      entry = {
        failed: false, memory: new Map(), lastStartedAt: -Infinity, running: false, timer: null, viewers: 0, woken: false
      };
      projects.set(slug, entry);
    }
    return entry;
  }

  function schedule(slug, entry, { afterProbe = false } = {}) {
    if (closed || entry.running || entry.timer) return;
    const period = interval(entry);
    const elapsed = Math.max(0, now() - entry.lastStartedAt);
    const delay = elapsed < period ? period - elapsed
      : afterProbe ? (period - (elapsed % period)) % period : 0;
    entry.timer = setTimer(() => {
      entry.timer = null;
      void run(slug, entry);
    }, delay);
    entry.timer?.unref?.();
  }

  async function run(slug, entry) {
    entry.running = true;
    entry.woken = false;
    entry.lastStartedAt = now();
    let result = null;
    try {
      result = await probe(slug, { memory: entry.memory, watched: entry.viewers > 0 });
    } catch (error) {
      onError(error, slug);
    } finally {
      entry.running = false;
    }
    entry.failed = result?.failed === true || !result;
    // A turn that started during the probe may not have been visible to it.
    if (entry.viewers > 0 || result?.inUse === true || entry.woken) {
      schedule(slug, entry, { afterProbe: true });
    }
  }

  return Object.freeze({
    // Returns the release for this viewer. The project's next probe stops
    // when nobody watches it and no agent turn runs in it.
    watch(slugValue) {
      const slug = String(slugValue || "").trim();
      if (closed || !slug) return () => {};
      const entry = entryFor(slug);
      entry.viewers += 1;
      schedule(slug, entry);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.viewers -= 1;
      };
    },
    // An agent turn started: probe the project if it is idle.
    wake(slugValue) {
      const slug = String(slugValue || "").trim();
      if (closed || !slug) return;
      const entry = entryFor(slug);
      if (entry.running) entry.woken = true;
      else schedule(slug, entry);
    },
    close() {
      closed = true;
      for (const entry of projects.values()) {
        if (entry.timer) clearTimer(entry.timer);
        entry.timer = null;
      }
      projects.clear();
    }
  });
}

export {
  REPOSITORY_UPDATE_PROBE_INTERVAL_MS,
  REPOSITORY_UPDATE_PROBE_RETRY_MS,
  createRepositoryUpdateProbe
};
