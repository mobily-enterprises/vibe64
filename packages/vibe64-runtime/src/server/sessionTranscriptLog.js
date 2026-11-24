import { open } from "node:fs/promises";
import { writeFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { isPlainObject, vibe64Error } from "@local/vibe64-core/server/core";
import { fileIdentity } from "./sessionFiles.js";
import { CONVERSATION_MESSAGE_ROLES, CONVERSATION_TURN_ID_PATTERN } from "./sessionRecordRules.js";

/**
 * A chat's transcript, `conversation-log/transcript.jsonl`: one JSON record per
 * line, each line ending in a newline.
 *
 * - The first line is a snapshot: `{"version":2,"metadata":{...},"rewound":[...],
 *   "turns":[[turnId,{messages,metadata?}],...],"summary"?:{...}}`.
 * - Every later line is what one committed transaction changed, and nothing else:
 *   `{"turns":[[turnId,{"keep"?:n,"messages"?:[...],"metadata"?:PATCH}],...],
 *   "metadata"?:PATCH,"summary"?:{...}|null}`. A turn it names that the chat
 *   lacks is added after the others; one it has keeps its first `keep` messages
 *   (all of them when `keep` is absent), then gains `messages`.
 * - A PATCH is a list of edits to an object: `[path, value]` sets the value at
 *   path (a list of keys), `[path]` removes it, and the empty path is the whole
 *   object. Only what changed is written, so a status, a red interruption
 *   entry or a native receipt costs its own bytes, not the chat's.
 * - A later snapshot line replaces everything before it.
 *
 * Writing a message therefore appends one line whose size does not depend on
 * the chat's length, and syncs it. A crash can leave only the line being
 * appended unfinished: reading ignores the bytes after the last newline, and a
 * last line that is not JSON (blocks that never reached the disk), and the next
 * append removes them before it writes. Any other unreadable line is damage,
 * and the chat is refused rather than read without it.
 *
 * A change no line can say (a turn removed or moved, rewind markers changed),
 * and the change that takes the lines after the snapshot past a thirty-second
 * of it (or past 64 KiB, for a small chat), is saved as the chat whole instead:
 * one snapshot line, published in one step over the file. Loading a chat then
 * parses its own record and at most that much more, and over many messages a
 * message still writes a bounded multiple of its own line, at 50 turns as at
 * 5,000.
 */

const TRANSCRIPT_LOG_FILE = "transcript.jsonl";
/** The previous release's whole-record transcript, which only the offline state upgrade reads. */
const LEGACY_TRANSCRIPT_FILE = "transcript.json";
const TRANSCRIPT_LOG_VERSION = 2;
const NEWLINE = 0x0a;
const SNAPSHOT_FIELDS = new Set(["version", "metadata", "rewound", "turns", "summary"]);
const CHANGE_FIELDS = new Set(["turns", "metadata", "summary"]);
// The lines a chat keeps after its snapshot before it is saved whole again: the larger of these.
const CHECKPOINT_SHARE = 32;
const CHECKPOINT_FLOOR_BYTES = 64 * 1024;
const TURN_CHANGE_FIELDS = new Set(["keep", "messages", "metadata"]);
const TURN_FIELDS = new Set(["messages", "metadata"]);
const CACHE_LIMIT = 8;

// Parsed chats, reused while the file's device, inode, size and modification time are unchanged.
const transcriptCache = new Map();

function damagedTranscript() {
  return vibe64Error(
    "Conversation storage is not valid JSON. Restore it before continuing.",
    "vibe64_invalid_conversation_storage"
  );
}

function unsupportedTranscript() {
  return vibe64Error(
    "Conversation storage has an unsupported or damaged format. Restore it before continuing.",
    "vibe64_invalid_conversation_storage_format"
  );
}

function validMessage(message) {
  return isPlainObject(message) && CONVERSATION_MESSAGE_ROLES.includes(message.role) &&
    typeof message.text === "string" && typeof message.at === "string" && Number.isFinite(Date.parse(message.at)) &&
    (message.messageId === undefined || typeof message.messageId === "string");
}

function validTurn(turnId, turn) {
  return typeof turnId === "string" && CONVERSATION_TURN_ID_PATTERN.test(turnId) && isPlainObject(turn) &&
    Object.keys(turn).every((key) => TURN_FIELDS.has(key)) && Array.isArray(turn.messages) &&
    (turn.metadata === undefined || isPlainObject(turn.metadata)) && turn.messages.every(validMessage);
}

function validSummary(summary) {
  return summary === undefined ||
    (isPlainObject(summary) && typeof summary.text === "string" && typeof summary.throughTurnId === "string");
}

/** A whole chat record: metadata, rewind markers, turns and the optional compaction summary. */
function validateTranscriptRecord(record) {
  if (!isPlainObject(record.metadata) || !Array.isArray(record.rewound) || !validSummary(record.summary) ||
      record.rewound.some((turnId) => !record.turns.has(turnId))) {
    throw unsupportedTranscript();
  }
  for (const [turnId, turn] of record.turns) {
    if (!validTurn(turnId, turn)) throw unsupportedTranscript();
  }
  return record;
}

function emptyTranscriptRecord() {
  return { turns: new Map(), metadata: {}, rewound: [] };
}

function snapshotLine(record) {
  return `${JSON.stringify({
    version: TRANSCRIPT_LOG_VERSION,
    metadata: record.metadata,
    rewound: record.rewound,
    turns: [...record.turns],
    ...(record.summary ? { summary: record.summary } : {})
  })}\n`;
}

function recordFromSnapshot(value) {
  if (!isPlainObject(value) || value.version !== TRANSCRIPT_LOG_VERSION ||
      Object.keys(value).some((key) => !SNAPSHOT_FIELDS.has(key)) || !Array.isArray(value.turns)) {
    throw unsupportedTranscript();
  }
  const turns = new Map();
  for (const entry of value.turns) {
    if (!Array.isArray(entry) || entry.length !== 2 || turns.has(entry[0])) throw unsupportedTranscript();
    turns.set(entry[0], entry[1]);
  }
  return {
    metadata: value.metadata,
    rewound: value.rewound,
    turns,
    ...(value.summary !== undefined ? { summary: value.summary } : {})
  };
}

const present = (object, key) => Object.hasOwn(object, key) && object[key] !== undefined;

/**
 * Patching keeps an object's remaining keys where they are and adds new ones
 * after them, so a patch can only reproduce `after` when its keys already have
 * that order; otherwise the object is written whole.
 */
function keepsKeyOrder(before, after) {
  const kept = Object.keys(before).filter((key) => present(before, key) && present(after, key));
  const keys = Object.keys(after).filter((key) => present(after, key));
  return kept.every((key, index) => keys[index] === key);
}

/** The edits that turn `before` into `after`, as their JSON reads: an undefined value is an absent key. */
function patchEdits(before, after, keys = [], edits = []) {
  if (before === after) return edits;
  if (isPlainObject(before) && isPlainObject(after) && keepsKeyOrder(before, after)) {
    for (const key of Object.keys(before)) {
      if (present(before, key) && !present(after, key)) edits.push([[...keys, key]]);
    }
    for (const key of Object.keys(after)) {
      if (!present(after, key)) continue;
      if (!present(before, key)) edits.push([[...keys, key], after[key]]);
      else patchEdits(before[key], after[key], [...keys, key], edits);
    }
    return edits;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) edits.push(after === undefined ? [keys] : [keys, after]);
  return edits;
}

/** Applies a PATCH to an object this read owns; returns the (possibly replaced) object. */
function applyPatch(target, edits) {
  if (!Array.isArray(edits)) throw unsupportedTranscript();
  let root = target;
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    if (!Array.isArray(edit) || edit.length < 1 || edit.length > 2 || !Array.isArray(edit[0])) throw unsupportedTranscript();
    const keys = edit[0];
    if (!keys.length) {
      root = edit[1];
      continue;
    }
    let parent = root;
    for (let depth = 0; depth < keys.length - 1; depth += 1) {
      const key = keys[depth];
      if (typeof key !== "string" || !isPlainObject(parent) || !Object.hasOwn(parent, key)) throw unsupportedTranscript();
      parent = parent[key];
    }
    const key = keys[keys.length - 1];
    if (typeof key !== "string" || !isPlainObject(parent)) throw unsupportedTranscript();
    if (edit.length === 1) delete parent[key];
    // A key named __proto__ is a key here, as in JSON; assigning it would set the object's prototype instead.
    else if (key === "__proto__") Object.defineProperty(parent, key, { value: edit[1], enumerable: true, writable: true, configurable: true });
    else parent[key] = edit[1];
  }
  return root;
}

function applyChange(record, change) {
  if (!isPlainObject(change) || !Object.keys(change).length || Object.keys(change).some((key) => !CHANGE_FIELDS.has(key)) ||
      (change.turns !== undefined && !Array.isArray(change.turns))) {
    throw unsupportedTranscript();
  }
  const turns = change.turns || [];
  for (let index = 0; index < turns.length; index += 1) {
    const entry = turns[index];
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isPlainObject(entry[1]) ||
        Object.keys(entry[1]).some((key) => !TURN_CHANGE_FIELDS.has(key))) {
      throw unsupportedTranscript();
    }
    const turnId = entry[0];
    const { keep, messages = [], metadata } = entry[1];
    let turn = record.turns.get(turnId);
    if (!turn) {
      turn = { messages: [] };
      record.turns.set(turnId, turn);
    }
    if (!Array.isArray(turn.messages) || !Array.isArray(messages) ||
        (keep !== undefined && (!Number.isSafeInteger(keep) || keep < 0 || keep > turn.messages.length))) {
      throw unsupportedTranscript();
    }
    if (keep !== undefined) turn.messages.length = keep;
    for (const message of messages) turn.messages.push(message);
    if (metadata !== undefined) {
      const next = applyPatch(turn.metadata, metadata);
      if (next === undefined) delete turn.metadata;
      else turn.metadata = next;
    }
  }
  if (change.metadata !== undefined) record.metadata = applyPatch(record.metadata, change.metadata);
  if (change.summary === null) delete record.summary;
  else if (change.summary !== undefined) record.summary = change.summary;
}

/**
 * The records of a transcript's complete lines and where each line ends.
 * Every line is parsed at once when the chat is whole; a line that is not JSON
 * is the unfinished last append only when it is the last line after the
 * snapshot, and is left out.
 */
function transcriptLines(buffer) {
  const end = buffer.lastIndexOf(NEWLINE) + 1;
  if (!end) throw damagedTranscript();
  const ends = [];
  for (let index = buffer.indexOf(NEWLINE); index >= 0 && index < end; index = buffer.indexOf(NEWLINE, index + 1)) ends.push(index + 1);
  try {
    const text = buffer.toString("utf8", 0, end - 1);
    const lines = ends.length === 1 ? [JSON.parse(text)] : JSON.parse(`[${text.replaceAll("\n", ",")}]`);
    if (lines.length === ends.length) return { lines, ends };
  } catch {
    // A line is not JSON: find it below.
  }
  const lines = [];
  for (let index = 0; index < ends.length; index += 1) {
    const start = index ? ends[index - 1] : 0;
    try {
      lines.push(JSON.parse(buffer.toString("utf8", start, ends[index] - 1)));
    } catch {
      if (index === ends.length - 1 && index) return { lines, ends: ends.slice(0, index) };
      throw damagedTranscript();
    }
  }
  return { lines, ends };
}

/**
 * The chat a transcript's bytes hold: `{ record, validBytes, snapshotBytes,
 * changeBytes }`, where validBytes is how many of the bytes it is read from
 * (the rest are an unfinished append), snapshotBytes the length of its last
 * snapshot line and changeBytes the length of the lines after that one.
 * @param {Buffer} buffer
 */
function parseTranscriptLog(buffer) {
  const { lines, ends } = transcriptLines(buffer);
  let record = recordFromSnapshot(lines[0]);
  let snapshot = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (isPlainObject(lines[index]) && Object.hasOwn(lines[index], "version")) {
      record = recordFromSnapshot(lines[index]);
      snapshot = index;
    } else {
      applyChange(record, lines[index]);
    }
  }
  const validBytes = ends.at(-1);
  const snapshotEnd = ends[snapshot];
  return {
    record: validateTranscriptRecord(record),
    validBytes,
    snapshotBytes: snapshotEnd - (snapshot ? ends[snapshot - 1] : 0),
    changeBytes: validBytes - snapshotEnd
  };
}

/**
 * The change line from the saved record to the next one; null when nothing
 * changed, undefined when no change line can say it. Only changed turns are
 * visited past a reference comparison: a transaction copies each turn it
 * changes and keeps the saved objects of every other one (and of every message
 * it keeps).
 */
function changeLine(saved, next) {
  if (next.rewound !== saved.rewound && JSON.stringify(next.rewound) !== JSON.stringify(saved.rewound)) return undefined;
  const turns = [];
  const savedOrder = saved.turns.keys();
  let added = false;
  for (const [turnId, turn] of next.turns) {
    const before = saved.turns.get(turnId);
    if (before === undefined) added = true;
    else if (added || savedOrder.next().value !== turnId) return undefined;
    if (turn === before) continue;
    if (!validTurn(turnId, turn)) throw unsupportedTranscript();
    const savedMessages = before?.messages || [];
    let keep = 0;
    while (keep < savedMessages.length && keep < turn.messages.length && savedMessages[keep] === turn.messages[keep]) keep += 1;
    const change = {
      ...(keep < savedMessages.length ? { keep } : {}),
      ...(keep < turn.messages.length ? { messages: turn.messages.slice(keep) } : {})
    };
    const metadata = patchEdits(before?.metadata, turn.metadata);
    if (metadata.length) change.metadata = metadata;
    if (before === undefined || Object.keys(change).length) turns.push([turnId, change]);
  }
  if (!savedOrder.next().done) return undefined;
  if (!isPlainObject(next.metadata) || !validSummary(next.summary)) throw unsupportedTranscript();
  const change = turns.length ? { turns } : {};
  const metadata = patchEdits(saved.metadata, next.metadata);
  if (metadata.length) change.metadata = metadata;
  if (next.summary !== saved.summary && JSON.stringify(next.summary) !== JSON.stringify(saved.summary)) {
    change.summary = next.summary ?? null;
  }
  return Object.keys(change).length ? `${JSON.stringify(change)}\n` : null;
}

/**
 * The line that records what changed from the saved record to the next one
 * (a snapshot line when no change line can say it), or null when nothing did.
 */
function transcriptChangeLine(saved, next) {
  const line = changeLine(saved, next);
  return line === undefined ? snapshotLine(validateTranscriptRecord(next)) : line;
}

function remember(filePath, entry) {
  transcriptCache.delete(filePath);
  transcriptCache.set(filePath, entry);
  if (transcriptCache.size > CACHE_LIMIT) transcriptCache.delete(transcriptCache.keys().next().value);
  return entry;
}

/**
 * The saved chat at filePath: `{ identity, record, validBytes, snapshotBytes, changeBytes }`
 * (parseTranscriptLog says what the sizes are). Rejects with
 * ENOENT when there is none. The record is shared: never change it in place.
 * @param {string} filePath
 */
async function readTranscriptLog(filePath) {
  const handle = await open(filePath, "r");
  try {
    const stats = await handle.stat({ bigint: true });
    const identity = fileIdentity(stats);
    const cached = transcriptCache.get(filePath);
    if (cached?.identity === identity) return remember(filePath, cached);
    // Exactly the bytes this identity names, even while another process appends.
    const size = Number(stats.size);
    const buffer = Buffer.allocUnsafe(size);
    let read = 0;
    while (read < size) {
      const { bytesRead } = await handle.read(buffer, read, size - read, read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    return remember(filePath, { identity, ...parseTranscriptLog(buffer.subarray(0, read)) });
  } finally {
    await handle.close();
  }
}

function changedTranscript() {
  return vibe64Error(
    "This chat changed while a message was being saved, and nothing was saved. Try again.",
    "vibe64_conversation_storage_changed"
  );
}

/** Publishes the record whole, as one snapshot line, over whatever the file held. */
async function publishSnapshot(filePath, record) {
  const line = snapshotLine(validateTranscriptRecord(record));
  const bytes = Buffer.byteLength(line);
  const stats = await writeFileAtomic(filePath, line);
  return remember(filePath, { identity: fileIdentity(stats), record, validBytes: bytes, snapshotBytes: bytes, changeBytes: 0 });
}

/**
 * Saves the next record over the saved one: a new chat's first record, a
 * change no line can say, and the change that would take the lines after the
 * snapshot past their share are the chat whole, published in one step; every
 * other one appends its change line at the end of the readable bytes and syncs
 * it. A failed append is cut off again, so the file keeps only whole records.
 * Callers hold the session's mutation lease.
 * @param {string} filePath
 * @param {{ identity: string, record: object, validBytes: number, snapshotBytes: number, changeBytes: number } | null} saved
 *   what readTranscriptLog returned; null for no file
 * @param {object} next
 */
async function writeTranscriptLog(filePath, saved, next) {
  if (!saved) return publishSnapshot(filePath, next);
  const line = changeLine(saved.record, next);
  if (line === null) return remember(filePath, { ...saved, record: next });
  const bytes = line === undefined ? null : Buffer.from(line, "utf8");
  const whole = !bytes || saved.changeBytes + bytes.length > Math.max(CHECKPOINT_FLOOR_BYTES, saved.snapshotBytes / CHECKPOINT_SHARE);
  const handle = await open(filePath, "r+");
  try {
    const current = await handle.stat({ bigint: true });
    if (fileIdentity(current) !== saved.identity) throw changedTranscript();
    if (whole) return await publishSnapshot(filePath, next);
    if (Number(current.size) > saved.validBytes) {
      // An append a crash left unfinished: it goes before this one is written.
      await handle.truncate(saved.validBytes);
      await handle.datasync();
    }
    try {
      for (let written = 0; written < bytes.length;) {
        const { bytesWritten } = await handle.write(bytes, written, bytes.length - written, saved.validBytes + written);
        if (!bytesWritten) throw new Error("The chat file accepted no more bytes.");
        written += bytesWritten;
      }
      await handle.datasync();
    } catch (error) {
      await handle.truncate(saved.validBytes).catch(() => {});
      throw error;
    }
    const stats = await handle.stat({ bigint: true });
    return remember(filePath, {
      identity: fileIdentity(stats),
      record: next,
      validBytes: saved.validBytes + bytes.length,
      snapshotBytes: saved.snapshotBytes,
      changeBytes: saved.changeBytes + bytes.length
    });
  } finally {
    await handle.close();
  }
}

/** A transcript.jsonl's whole contents for a record, as the offline upgrade writes it. */
function transcriptLogContents(record) {
  return snapshotLine(validateTranscriptRecord(record));
}

/**
 * The previous release's transcript.json record (version 1), for the offline
 * state upgrades that run before this format exists.
 */
function parseLegacyTranscript(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw damagedTranscript();
  }
  const turnIds = Array.isArray(value?.turns) ? new Set(value.turns.map((entry) => entry?.[0])) : new Set();
  if (value?.version !== 1 || !isPlainObject(value.metadata) || !Array.isArray(value.rewound) || !Array.isArray(value.turns) ||
      value.turns.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" ||
        !CONVERSATION_TURN_ID_PATTERN.test(entry[0]) || !isPlainObject(entry[1]) || !Array.isArray(entry[1].messages) ||
        (entry[1].metadata !== undefined && !isPlainObject(entry[1].metadata)) ||
        entry[1].messages.some((message) => !isPlainObject(message) || !CONVERSATION_MESSAGE_ROLES.includes(message.role) ||
          typeof message.text !== "string" || typeof message.at !== "string" || !Number.isFinite(Date.parse(message.at)) ||
          (message.messageId !== undefined && typeof message.messageId !== "string"))) ||
      turnIds.size !== value.turns.length ||
      value.rewound.some((id) => !turnIds.has(id)) ||
      (value.summary !== undefined && (!isPlainObject(value.summary) || typeof value.summary.text !== "string" ||
        typeof value.summary.throughTurnId !== "string"))) {
    throw unsupportedTranscript();
  }
  return {
    metadata: value.metadata,
    rewound: value.rewound,
    turns: new Map(value.turns),
    ...(value.summary ? { summary: value.summary } : {})
  };
}

/** A record as the previous release's transcript.json document (version 1). */
function legacyTranscriptJson(record) {
  return {
    version: 1,
    metadata: record.metadata,
    rewound: record.rewound,
    turns: [...record.turns],
    ...(record.summary ? { summary: record.summary } : {})
  };
}

export {
  LEGACY_TRANSCRIPT_FILE,
  TRANSCRIPT_LOG_FILE,
  emptyTranscriptRecord,
  legacyTranscriptJson,
  parseLegacyTranscript,
  parseTranscriptLog,
  readTranscriptLog,
  transcriptChangeLine,
  transcriptLogContents,
  validateTranscriptRecord,
  writeTranscriptLog
};
