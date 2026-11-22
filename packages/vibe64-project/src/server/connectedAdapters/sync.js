// Keeps what a session's adapters put in effect in step with its connected copies while the session
// runs, for the types that are not live by nature (an adapter's `watch`): a saved file reaches what
// the adapter derived at once (npm: every installed copy), and a change its sync cannot follow
// alone (sync resolves to null) puts the whole connection in effect again. A watcher per session;
// the server forgets them on restart, and the next preparation or Preview start begins them again.
import path from "node:path";
import { watch } from "chokidar";
import { serializeByKey } from "@local/vibe64-core/server/atomicFile";

const SETTLE_MS = 40;
const IGNORED = /(?:^|[\\/])(?:node_modules|\.git)(?:[\\/]|$)/u;
const watchers = new Map();

/** Swaps and syncs of one session's trees, one at a time. */
const pendingByTree = new Map();

function serializeForTrees(sessionSourceRoot, operation) {
  return serializeByKey(pendingByTree, path.resolve(sessionSourceRoot), operation);
}

/**
 * Starts (or restarts) the session's watcher over the source folders its adapters watch.
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.sessionSourceRoot
 * @param {() => Promise<Map<string, string>>} input.watched each watched source folder, with its connection's repository
 * @param {(repository: string, sourceDir: string) => Promise<number | null>} input.sync follows a change; null to apply again
 * @param {(repository: string) => Promise<void>} input.reapply puts one connection in effect again
 * @param {(event: { kind: "synced" | "reapplied" | "failed", repository: string, ms: number, message?: string }) => void} [input.onEvent]
 */
async function startConnectedSync({ sessionId, sessionSourceRoot, watched, sync: follow, reapply, onEvent = () => {} }) {
  await stopConnectedSync(sessionId);
  const sources = await watched();
  if (!sources.size) return null;
  const timers = new Map();
  const watcher = watch([...sources.keys()], {
    ignored: (candidate) => IGNORED.test(candidate),
    ignoreInitial: true,
    persistent: false
  });
  const entry = { sessionSourceRoot, watcher, timers, closed: false };
  watchers.set(sessionId, entry);
  const sync = async (sourceDir, startedAt) => {
    const repository = sources.get(sourceDir);
    try {
      await serializeForTrees(sessionSourceRoot, async () => {
        if (entry.closed) return;
        const synced = await follow(repository, sourceDir);
        if (synced === null) {
          await reapply(repository);
          // The connection may put other folders in effect now.
          for (const [dir, owner] of await watched()) {
            if (!sources.has(dir)) {
              sources.set(dir, owner);
              watcher.add(dir);
            }
          }
          onEvent({ kind: "reapplied", repository, ms: Date.now() - startedAt });
        } else if (synced > 0) {
          onEvent({ kind: "synced", repository, ms: Date.now() - startedAt });
        }
      });
    } catch (error) {
      onEvent({ kind: "failed", repository, ms: Date.now() - startedAt, message: String(error?.message || error) });
    }
  };
  watcher.on("all", (_event, changed) => {
    const sourceDir = [...sources.keys()].filter(candidate => changed === candidate || changed.startsWith(`${candidate}${path.sep}`))
      .sort((a, b) => b.length - a.length)[0];
    if (!sourceDir || entry.closed) return;
    const startedAt = timers.get(sourceDir)?.startedAt ?? Date.now();
    clearTimeout(timers.get(sourceDir)?.timer);
    const timer = setTimeout(() => {
      timers.delete(sourceDir);
      void sync(sourceDir, startedAt);
    }, SETTLE_MS);
    timers.set(sourceDir, { startedAt, timer });
  });
  // A folder that goes away (a checkout replaced) is a failure to report, never one that stops the server.
  watcher.on("error", (error) => onEvent({ kind: "failed", repository: "", ms: 0, message: String(error?.message || error) }));
  await new Promise((resolve) => watcher.once("ready", resolve));
  return entry;
}

/** Stops the session's watcher, if it has one. */
async function stopConnectedSync(sessionId) {
  const entry = watchers.get(sessionId);
  if (!entry) return;
  watchers.delete(sessionId);
  entry.closed = true;
  for (const { timer } of entry.timers.values()) clearTimeout(timer);
  await entry.watcher.close();
}

function connectedSyncRunning(sessionId) {
  return watchers.has(sessionId);
}

export { connectedSyncRunning, serializeForTrees, startConnectedSync, stopConnectedSync };
