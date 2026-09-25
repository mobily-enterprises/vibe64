import { createHash } from "node:crypto";

export function canonicalNativeHistoryJson(value) {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
}

// Providers own record projection; this small sink owns the common byte bound,
// callback backpressure and exact content revision used before retirement.
export function createNativeHistoryExport(onRecord, { signal, maxBytes = 2 * 1024 ** 3 } = {}) {
  if (typeof onRecord !== "function") throw new TypeError("Native export requires a record callback.");
  const digest = createHash("sha256");
  let bytes = 0;
  let recordCount = 0;
  return {
    async emit(record) {
      signal?.throwIfAborted();
      const serialized = `${canonicalNativeHistoryJson(record)}\n`;
      bytes += Buffer.byteLength(serialized);
      if (bytes > maxBytes) throw new Error("Native export exceeded its byte limit; history was not retired.");
      digest.update(serialized);
      recordCount++;
      // An admitted host callback may still publish under the archive lock.
      // Cancellation must await its completion; the host owns cancelling its IO.
      await onRecord(record);
      signal?.throwIfAborted();
    },
    complete(extra = {}) {
      signal?.throwIfAborted();
      return { revision: digest.digest("hex"), bytes, recordCount, ...extra };
    }
  };
}
