import {
  codexAppServerAssistantItemText,
  codexAppServerUserMessageText
} from "@jskit-ai/assistant-core/server/codex-events";
import { canonicalNativeHistoryJson as canonicalJson, createNativeHistoryExport } from "./nativeHistoryExport.js";

function threadHistoryMetadata(thread) {
  const stored = { ...thread };
  // These describe a currently loaded process, not persisted conversation
  // content. Native deletion can unload a thread before refusing an external
  // fork, so they must not invalidate an otherwise identical preservation.
  delete stored.status;
  delete stored.canAcceptDirectInput;
  delete stored.environments;
  return stored;
}

// The caller owns a bounded, read-only connection. This exports API-visible
// content, not an importable database or a native-resume snapshot.
export async function exportCodexNativeHistory(client, threadId, onRecord, {
  signal, maxPages = 20_000, maxBytes = 2 * 1024 ** 3
} = {}) {
  if (!threadId || typeof onRecord !== "function") throw new TypeError("Native export requires a thread and record callback.");
  const output = createNativeHistoryExport(onRecord, { signal, maxBytes });
  const emit = output.emit;
  let turnCount = 0;
  let itemCount = 0;
  let pages = 0;
  const request = (method, params = {}) => {
    signal?.throwIfAborted();
    return client.request(method, { threadId, ...params }, { signal });
  };
  const { thread } = await request("thread/read", { includeTurns: false });
  if (thread?.id !== threadId || !["idle", "notLoaded"].includes(thread.status?.type)) {
    throw new Error("Codex native export requires the exact idle thread.");
  }
  if (thread.historyMode !== "paginated") {
    throw Object.assign(new Error("Codex native retirement requires paginated history. This unsupported conversation needs operator cleanup."),
      { code: "vibe64_codex_paginated_history_required" });
  }
  const goalResult = await request("thread/goal/get");
  if (!Object.hasOwn(goalResult || {}, "goal")) throw new Error("Codex did not return its native goal state.");
  const { goal } = goalResult;
  if (goal?.status === "active") throw new Error("Pause the Codex goal before native history retirement.");
  const metadata = threadHistoryMetadata(thread);
  await emit({ type: "thread", thread: metadata, text: [] });
  await emit({ type: "goal", goal: goal ?? null,
    text: typeof goal?.objective === "string" ? [{ role: "goal", text: goal.objective, branchId: threadId,
      ...(Number.isFinite(goal.createdAt) ? { createdAt: new Date(goal.createdAt * 1000).toISOString() } : {}),
      ...(Number.isFinite(goal.updatedAt) ? { updatedAt: new Date(goal.updatedAt * 1000).toISOString() } : {}) }] : [] });

  const pageAll = async (method, params, consume) => {
    let cursor;
    const cursors = new Set();
    do {
      if (++pages > maxPages) throw new Error("Codex native export exceeded its page limit; history was not retired.");
      const page = await request(method, { ...params, limit: 100, sortDirection: "asc", ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page?.data) || page.data.length > 100 ||
          (page.nextCursor != null && (typeof page.nextCursor !== "string" || !page.nextCursor))) {
        throw new Error("Codex returned an invalid native history page.");
      }
      for (const entry of page.data) await consume(entry);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error("Codex repeated a native history cursor.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
  };
  await pageAll("thread/turns/list", { itemsView: "notLoaded" }, async (turn) => {
    if (!turn?.id || turn.itemsView !== "notLoaded" || !Array.isArray(turn.items) || turn.items.length || turn.status === "inProgress") {
      throw new Error("Codex returned an invalid or active native turn.");
    }
    turnCount++;
    await emit({ type: "turn", turn, text: [] });
  });
  await pageAll("thread/items/list", {}, async ({ turnId, item } = {}) => {
    if (!turnId || !item?.id || typeof item.type !== "string") throw new Error("Codex returned an invalid native item.");
    itemCount++;
    const user = codexAppServerUserMessageText(item);
    const assistant = codexAppServerAssistantItemText(item);
    await emit({ type: "item", turnId, item,
      text: user || assistant ? [{ role: user ? "user" : "assistant", text: user || assistant,
        branchId: threadId, turnId, messageId: item.id,
        ...(item.clientId ? { clientId: item.clientId } : {}),
        ...(item.phase ? { phase: item.phase } : {}) }] : [] });
  });
  const after = await request("thread/read", { includeTurns: false });
  const afterGoal = await request("thread/goal/get");
  if (!["idle", "notLoaded"].includes(after.thread?.status?.type) ||
      canonicalJson(threadHistoryMetadata(after.thread)) !== canonicalJson(metadata) ||
      canonicalJson(afterGoal.goal ?? null) !== canonicalJson(goal ?? null)) {
    throw new Error("Codex native history changed during export; preserve it again before retirement.");
  }
  signal?.throwIfAborted();
  return output.complete({ historyMode: "paginated", turnCount, itemCount });
}
