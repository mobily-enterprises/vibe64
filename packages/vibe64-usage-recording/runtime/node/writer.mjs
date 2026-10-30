// One process's trace file. Nothing is written until the first project file is
// instrumented (or the recorder must report why it cannot run). Lines follow
// vibe64.usage-trace.v1: declarations go out before their first use, hits go
// out per flush as per-scope deltas, and a scope's line is written just before
// its first hits line. Every write is synchronous and bounded; a failure only
// stops the recording, never the application.
import {
  closeSync,
  constants,
  openSync,
  readSync,
  writeSync
} from "node:fs";
import path from "node:path";

import { USAGE_RECORDING_LIMITS, USAGE_TRACE_SCHEMA } from "../../src/shared/contract.js";

const NEW_FILE_FLAGS = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
const CONTROL_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const CONTROL_LIMIT_BYTES = 4096;
// At most ~17 bytes a pair keeps every hits line under the 64 KiB line limit.
const PAIRS_PER_LINE = 3000;
const PENDING_TEXT_FLUSH_BYTES = 1024 * 1024;
const TRUNCATED_LINE = `${JSON.stringify({ type: "truncated", reason: "size-limit" })}\n`;

// Only {"state":"stopping"} stops a recording; a missing or malformed file
// means keep recording.
function controlSaysStopping(directory) {
  let descriptor = -1;
  try {
    descriptor = openSync(path.join(directory, "control.json"), CONTROL_READ_FLAGS);
    const buffer = Buffer.alloc(CONTROL_LIMIT_BYTES);
    const length = readSync(descriptor, buffer, 0, CONTROL_LIMIT_BYTES, 0);
    return JSON.parse(buffer.subarray(0, length).toString("utf8"))?.state === "stopping";
  } catch {
    return false;
  } finally {
    if (descriptor !== -1) {
      try { closeSync(descriptor); } catch { /* already closed */ }
    }
  }
}

function createTraceWriter({
  directory,
  runtime = "nodejs",
  runtimeVersion = process.versions.node,
  pid = process.pid,
  now = () => new Date().toISOString(),
  maxFileBytes = USAGE_RECORDING_LIMITS.hitsBytesPerProcess,
  flushEntries = USAGE_RECORDING_LIMITS.flushEntries,
  onFlushNeeded = () => {}
} = {}) {
  let descriptor = -1;
  let fileName = "";
  let bytesWritten = 0;
  // writing: lines may still be written; ended: truncated, idle or failed.
  let writing = true;
  let pendingText = [];
  let pendingTextBytes = 0;
  let pendingEntries = 0;
  const dirtyScopes = new Set();

  function openFile() {
    for (let attempt = 1; attempt < 1000; attempt += 1) {
      const name = attempt === 1 ? `hits-${runtime}-${pid}.ndjson` : `hits-${runtime}-${pid}-${attempt}.ndjson`;
      try {
        descriptor = openSync(path.join(directory, name), NEW_FILE_FLAGS, 0o660);
        fileName = name;
        return true;
      } catch (error) {
        if (error?.code !== "EEXIST") break;
      }
    }
    writing = false;
    return false;
  }

  // The header line, then the given lines, written at once.
  function start(lines = []) {
    if (descriptor !== -1) return true;
    if (!writing || !openFile()) return false;
    const header = { type: "header", schema: USAGE_TRACE_SCHEMA, runtime, runtimeVersion, pid, startedAt: now() };
    return writeText([header, ...lines].map((line) => `${JSON.stringify(line)}\n`).join(""));
  }

  function writeText(text) {
    if (!writing || descriptor === -1 || !text) return writing;
    const bytes = Buffer.byteLength(text);
    if (bytesWritten + bytes + TRUNCATED_LINE.length > maxFileBytes) {
      try { writeSync(descriptor, TRUNCATED_LINE); } catch { /* the file is ending anyway */ }
      bytesWritten += TRUNCATED_LINE.length;
      writing = false;
      return false;
    }
    try {
      writeSync(descriptor, text);
      bytesWritten += bytes;
      return true;
    } catch {
      writing = false;
      return false;
    }
  }

  function queue(line) {
    if (!writing) return;
    const text = `${JSON.stringify(line)}\n`;
    pendingText.push(text);
    pendingTextBytes += text.length;
    if (pendingTextBytes >= PENDING_TEXT_FLUSH_BYTES) onFlushNeeded();
  }

  function scopeLine(scope) {
    return {
      type: "scope",
      scope: scope.id,
      kind: scope.kind,
      ...(scope.label ? { label: scope.label } : {}),
      startedAt: scope.startedAt,
      ...(scope.endedAt ? { endedAt: scope.endedAt } : {})
    };
  }

  return {
    get active() { return writing; },
    get fileName() { return fileName; },
    get bytesWritten() { return bytesWritten; },
    start,

    declareFile(fileIndex, filePath, hash) {
      queue({ type: "file", fileIndex, path: filePath, hash });
    },

    declareFunction(fileIndex, entry) {
      queue({ type: "function", functionIndex: entry.functionIndex, fileIndex, name: entry.name, start: entry.start, end: entry.end });
    },

    diagnostic(code, filePath = "") {
      queue({ type: "diagnostic", code, ...(filePath ? { path: filePath } : {}) });
    },

    // Called on every project function entry: keep it to a map update.
    hit(scope, functionIndex) {
      const count = scope.counts.get(functionIndex);
      if (count === undefined) {
        scope.counts.set(functionIndex, 1);
        dirtyScopes.add(scope);
        pendingEntries += 1;
        if (pendingEntries === flushEntries) onFlushNeeded();
      } else {
        scope.counts.set(functionIndex, count + 1);
      }
    },

    endScope(scope, endedAt = now()) {
      if (scope.endedAt) return;
      scope.endedAt = endedAt;
      if (scope.lineWritten) dirtyScopes.add(scope);
    },

    flush() {
      if (!writing || descriptor === -1) return;
      const lines = pendingText;
      pendingText = [];
      pendingTextBytes = 0;
      pendingEntries = 0;
      for (const scope of dirtyScopes) {
        const hits = scope.counts;
        if (!scope.lineWritten && hits.size === 0) continue;
        if (!scope.lineWritten || (scope.endedAt && !scope.endWritten)) {
          lines.push(`${JSON.stringify(scopeLine(scope))}\n`);
          scope.lineWritten = true;
          scope.endWritten = Boolean(scope.endedAt);
        }
        if (hits.size > 0) {
          const pairs = [...hits];
          hits.clear();
          for (let index = 0; index < pairs.length; index += PAIRS_PER_LINE) {
            lines.push(`${JSON.stringify({ type: "hits", scope: scope.id, counts: pairs.slice(index, index + PAIRS_PER_LINE) })}\n`);
          }
        }
      }
      dirtyScopes.clear();
      writeText(lines.join(""));
    },

    // Final flush, then the idle line; nothing is written afterwards.
    finish() {
      if (descriptor === -1) {
        writing = false;
        return;
      }
      this.flush();
      if (writing) writeText(`${JSON.stringify({ type: "tracer", state: "idle" })}\n`);
      writing = false;
    }
  };
}

export { controlSaysStopping, createTraceWriter };
