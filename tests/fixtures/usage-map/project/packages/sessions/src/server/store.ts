import type { SessionRecord } from "../../../core/src/shared/sessionShape.ts";

const records: SessionRecord[] = [];

export function listRecords(limit: number): SessionRecord[] {
  return records.slice(0, limit);
}

export function saveRecord(record: SessionRecord): void {
  records.push(record);
}
