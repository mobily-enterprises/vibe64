import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { runVibe64Command } from "@local/vibe64-execution/server";

const require = createRequire(import.meta.url);
const MAX_AGE_MS = 30_000;

function sourceEditorIndexDirectory(context) {
  const identity = createHash("sha256").update(context.sourceRoot).digest("hex");
  return path.join(context.runtime.stateRoot, "source-editor", "indexes", identity);
}

function createSourceEditorSearchIndex() {
  const entries = new Map();
  let queue = Promise.resolve();
  let closed = false;

  function entryFor(sourceRoot) {
    let entry = entries.get(sourceRoot);
    if (!entry) {
      entry = { dirty: false, pending: null, error: "", attemptedAt: 0 };
      entries.set(sourceRoot, entry);
    }
    return entry;
  }

  function trimEntries(currentRoot) {
    // Pending refreshes retain their owner until they finish.
    for (const [key, entry] of entries) {
      if (entries.size <= 8) break;
      if (key !== currentRoot && !entry.pending) entries.delete(key);
    }
  }

  async function run(context, operation, input = {}) {
    const result = await runVibe64Command({
      actor: "app",
      allowedRoots: [context.sourceRoot],
      command: "node",
      args: [require.resolve("@local/vibe64-source-editor/server/search-index-worker")],
      input: JSON.stringify({ ...input, operation, directory: sourceEditorIndexDirectory(context), sourceRoot: context.sourceRoot }),
      cwd: context.sourceRoot,
      execution: { label: operation === "refresh" ? "Index session files" : "Search session files", sessionId: context.sessionId },
      mode: "capture",
      purpose: "source-editor",
      runtimes: ["node26"],
      timeout: operation === "refresh" ? 300_000 : 6000,
      maxBuffer: 1024 * 1024
    });
    if (result.exitCode !== 0 || result.ok === false) {
      throw new Error(result.error || result.stderr || "The file index could not be updated. Use Refresh to retry.");
    }
    return JSON.parse(result.stdout);
  }

  return {
    async search(context, { query, limit }) {
      if (closed) throw new Error("The file index is closed.");
      if (!query) return { query, results: [], truncated: false, index: { state: "ready" } };
      const key = context.sourceRoot;
      const entry = entryFor(key);
      let status = null;
      try {
        status = JSON.parse(await readFile(path.join(sourceEditorIndexDirectory(context), "status.json"), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const stale = !status || status.state !== "ready" || Date.now() - status.updatedAt >= MAX_AGE_MS;
      const canRetry = !entry.error || Date.now() - entry.attemptedAt >= MAX_AGE_MS;
      if (!entry.pending && (entry.dirty || (stale && canRetry))) {
        entry.error = "";
        entry.dirty = false;
        entry.attemptedAt = Date.now();
        // One finite refresh per service at a time, shared by simultaneous
        // searches. No recursive filesystem watchers or idle polling.
        entry.pending = queue.then(async () => {
          if (!closed) await run(context, "refresh");
        }).catch((error) => {
          entry.error = String(error.message || error);
        }).finally(() => { entry.pending = null; });
        queue = entry.pending;
      }
      // Bound idle bookkeeping; durable indexes remain reusable on disk.
      trimEntries(key);
      const wasPending = Boolean(entry.pending);
      const result = status?.searchable ? await run(context, "search", { query, limit }) : { results: [], truncated: false };
      let state = "ready";
      if (entry.error) state = "error";
      else if (wasPending || entry.dirty) state = status?.updatedAt ? "refreshing" : "building";
      return {
        ...result,
        query,
        index: {
          state,
          scanned: status?.scanned || 0,
          total: status?.total || 0,
          error: entry.error
        }
      };
    },
    invalidate(sourceRoot) {
      entryFor(sourceRoot).dirty = true;
      trimEntries(sourceRoot);
    },
    close() {
      closed = true;
      return queue.finally(() => entries.clear());
    }
  };
}

export { createSourceEditorSearchIndex, sourceEditorIndexDirectory };
