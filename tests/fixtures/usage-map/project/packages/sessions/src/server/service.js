import { cleanTitle } from "../../../core/src/shared/text.js";
import { listRecords, saveRecord } from "./store.ts";

export async function listSessions({ limit = 20 } = {}) {
  return listRecords(limit).map((record) => ({ id: record.id, title: cleanTitle(record.title) }));
}

export async function createSession(input = {}) {
  const record = normalizeSession(input);
  saveRecord(record);
  return record;
}

function normalizeSession(input) {
  return { id: String(input.id), title: cleanTitle(input.title) };
}
