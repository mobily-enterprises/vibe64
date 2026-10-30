import { open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import {
  USAGE_INTERACTION_ID_PATTERN,
  USAGE_RECORDING_LIMITS,
  usageScopeKind,
  usageTraceLineProblem
} from "../shared/contract.js";

// Reads one recording directory: the tracers' hits files, the Preview proxy's
// request log and the recorded interactions. Every read is bounded, every line
// is validated, and a malformed line is skipped and counted. Trace content is
// data only: nothing in it is ever executed or evaluated.

const HITS_FILE_PATTERN = /^hits-(nodejs|python|php)-[0-9]+(?:-[0-9]+)?\.ndjson$/u;
const MAX_HITS_FILES = 256;
const READ_CHUNK_BYTES = 1024 * 1024;
const LINE_LIMIT = USAGE_RECORDING_LIMITS.traceLineBytes;
const FILE_LIMIT = USAGE_RECORDING_LIMITS.hitsBytesPerProcess + LINE_LIMIT;

async function writeJsonFile(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o660 });
  await rename(temporary, filePath);
}

async function readJsonFile(filePath, maxBytes = LINE_LIMIT) {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > maxBytes) return null;
    const value = JSON.parse(await readFile(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Bounded NDJSON objects of a Vibe64-written file; oversized or invalid lines
// are skipped.
async function readNdjson(filePath, maxLines) {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (rows.length >= maxLines) break;
    if (!line || line.length > LINE_LIMIT) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) rows.push(value);
    } catch {
      // Skipped like any malformed line.
    }
  }
  return rows;
}

const functionKey = (file, start) => `${file.path}\0${file.hash}\0${start.line}:${start.column}`;
const mergeCount = (left, right) => (left === null || right === null ? null : left + right);
const compareFunctions = (left, right) => left.path.localeCompare(right.path) ||
  left.start.line - right.start.line || left.start.column - right.start.column;

// An incremental reader of a recording's hits files. poll() reads only bytes
// added since the last poll, so a live recording is followed cheaply.
function createTraceReader(directory) {
  const files = new Map();
  const scopes = new Map();
  const functions = new Map();
  const problems = { malformedLines: 0, diagnostics: 0, skippedFiles: 0 };
  const diagnosticCodes = new Map();
  let hitsBytes = 0;
  let truncated = false;

  function applyLine(file, line) {
    if (usageTraceLineProblem(line) || (!file.header && line.type !== "header") || (file.header && line.type === "header")) {
      problems.malformedLines += 1;
      return;
    }
    if (line.type === "header") {
      file.header = { runtime: line.runtime, pid: line.pid };
    } else if (line.type === "tracer") {
      file.state = line.state;
    } else if (line.type === "file") {
      file.files.set(line.fileIndex, { path: line.path, hash: line.hash });
    } else if (line.type === "function") {
      const source = file.files.get(line.fileIndex);
      if (!source) {
        problems.malformedLines += 1;
        return;
      }
      const key = functionKey(source, line.start);
      if (!functions.has(key)) {
        functions.set(key, { path: source.path, hash: source.hash, name: line.name, start: line.start, end: line.end });
      }
      file.functions.set(line.functionIndex, key);
    } else if (line.type === "scope") {
      const scope = scopes.get(line.scope);
      if (scope) {
        scope.endedAt = line.endedAt ?? scope.endedAt;
        scope.label = line.label ?? scope.label;
        scope.startedAt = scope.startedAt || line.startedAt;
      } else {
        scopes.set(line.scope, { kind: line.kind, label: line.label ?? null, startedAt: line.startedAt, endedAt: line.endedAt ?? null, hits: new Map() });
      }
    } else if (line.type === "hits") {
      if (!scopes.has(line.scope)) {
        scopes.set(line.scope, { kind: usageScopeKind(line.scope), label: null, startedAt: null, endedAt: null, hits: new Map() });
      }
      const hits = scopes.get(line.scope).hits;
      let unknown = false;
      for (const [functionIndex, count] of line.counts) {
        const key = file.functions.get(functionIndex);
        if (!key) {
          unknown = true;
          continue;
        }
        hits.set(key, hits.has(key) ? mergeCount(hits.get(key), count) : count);
      }
      if (unknown) problems.malformedLines += 1;
    } else if (line.type === "diagnostic") {
      problems.diagnostics += 1;
      file.diagnostics.add(line.code);
      diagnosticCodes.set(line.code, (diagnosticCodes.get(line.code) || 0) + 1);
    } else if (line.type === "truncated") {
      file.truncated = true;
      truncated = true;
    }
  }

  function applyText(file, text) {
    const lines = `${file.rest}${text}`.split("\n");
    file.rest = lines.pop();
    for (const raw of lines) {
      if (file.skipping) {
        file.skipping = false;
        continue;
      }
      if (!raw) continue;
      if (raw.length > LINE_LIMIT) {
        problems.malformedLines += 1;
        continue;
      }
      let line = null;
      try {
        line = JSON.parse(raw);
      } catch {
        problems.malformedLines += 1;
        continue;
      }
      applyLine(file, line);
    }
    if (file.rest.length > LINE_LIMIT) {
      problems.malformedLines += 1;
      file.rest = "";
      file.skipping = true;
    }
  }

  async function readNewBytes(name, file) {
    const handle = await open(path.join(directory, name), "r");
    try {
      const info = await handle.stat();
      if (!info.isFile()) return;
      const end = Math.min(info.size, FILE_LIMIT, file.offset + USAGE_RECORDING_LIMITS.hitsBytesPerRecording - hitsBytes);
      while (file.offset < end) {
        const length = Math.min(READ_CHUNK_BYTES, end - file.offset);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, file.offset);
        if (bytesRead <= 0) break;
        file.offset += bytesRead;
        hitsBytes += bytesRead;
        applyText(file, file.decoder.write(buffer.subarray(0, bytesRead)));
      }
    } finally {
      await handle.close();
    }
  }

  async function poll() {
    let names = [];
    try {
      names = (await readdir(directory)).filter((name) => HITS_FILE_PATTERN.test(name)).sort();
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const name of names) {
      if (!files.has(name)) {
        if (files.size >= MAX_HITS_FILES) {
          problems.skippedFiles = names.length - files.size;
          continue;
        }
        files.set(name, {
          decoder: new StringDecoder("utf8"), diagnostics: new Set(), files: new Map(), functions: new Map(),
          header: null, offset: 0, rest: "", skipping: false, state: "", truncated: false
        });
      }
      if (hitsBytes >= USAGE_RECORDING_LIMITS.hitsBytesPerRecording) break;
      await readNewBytes(name, files.get(name));
    }
  }

  // Request-like scopes that ran project code: proxy requests, local requests
  // and terminal runs. They alone make the counts and the plumbing.
  function listedScopes() {
    return [...scopes.entries()].filter(([, scope]) => scope.kind !== "background" && scope.kind && scope.hits.size > 0);
  }

  // Each process's work outside any request, when it ran project code: its
  // start-up, timers, and every request of a server whose requests a tracer
  // cannot tell apart.
  function backgroundScopes() {
    return [...scopes.entries()].filter(([, scope]) => scope.kind === "background" && scope.hits.size > 0);
  }

  function plumbingKeys() {
    const listed = listedScopes();
    if (listed.length < USAGE_RECORDING_LIMITS.plumbingMinimumRequests) return new Set();
    const ran = new Map();
    for (const [, scope] of listed) {
      for (const key of scope.hits.keys()) ran.set(key, (ran.get(key) || 0) + 1);
    }
    return new Set([...ran].filter(([, count]) => count / listed.length >= USAGE_RECORDING_LIMITS.plumbingShare).map(([key]) => key));
  }

  function scopeFunctions(scopeId, plumbing = plumbingKeys()) {
    const scope = scopes.get(scopeId);
    if (!scope) return [];
    return [...scope.hits].map(([key, count]) => ({ ...functions.get(key), count, plumbing: plumbing.has(key) }))
      .sort(compareFunctions);
  }

  function counts() {
    const listed = listedScopes();
    return { requests: listed.length, functions: new Set(listed.flatMap(([, scope]) => [...scope.hits.keys()])).size };
  }

  // Per runtime: whether any of its processes became ready, wrote its idle
  // line, or only reported diagnostics.
  function tracerStates() {
    const states = new Map();
    for (const file of files.values()) {
      if (!file.header) continue;
      const current = states.get(file.header.runtime) || { ready: false, active: 0, idle: 0, diagnostics: new Set() };
      if (file.state) current.ready = true;
      if (file.state === "ready") current.active += 1;
      if (file.state === "idle") current.idle += 1;
      for (const code of file.diagnostics) current.diagnostics.add(code);
      states.set(file.header.runtime, current);
    }
    return states;
  }

  return {
    counts,
    diagnosticCodes: () => new Map(diagnosticCodes),
    hitsBytes: () => hitsBytes,
    backgroundScopes,
    listedScopes,
    plumbingKeys,
    poll,
    problems: () => ({ ...problems }),
    scopeFunctions,
    scopes: () => scopes,
    tracerStates,
    truncated: () => truncated
  };
}

// The Preview proxy's request log and the recorded interactions, read whole
// (both are capped when written).
async function readRequestLog(directory) {
  return (await readNdjson(path.join(directory, "requests.ndjson"), USAGE_RECORDING_LIMITS.proxyRequestLines))
    .filter((row) => /^r_[0-9]{6}$/u.test(String(row.id || "")));
}

async function readInteractions(directory) {
  return (await readNdjson(path.join(directory, "interactions.ndjson"), USAGE_RECORDING_LIMITS.interactions))
    .filter((row) => USAGE_INTERACTION_ID_PATTERN.test(String(row.id || "")));
}

function requestRow(id, fields, reader, plumbing) {
  const ran = reader.scopeFunctions(id, plumbing);
  return {
    id,
    method: fields.method ?? null,
    path: fields.path ?? null,
    status: fields.status ?? null,
    startedAt: fields.startedAt ?? null,
    durationMs: fields.durationMs ?? null,
    interaction: fields.interaction ?? null,
    functionCount: ran.length,
    fileCount: new Set(ran.map((entry) => entry.path)).size
  };
}

// Every request of a recording, in start order: the proxy's requests, local
// request scopes and terminal runs that tracers reported themselves, and each
// process's background work (kind "background", no method, path or status).
async function recordingRequestRows(directory, reader, { runLabel = null } = {}) {
  const plumbing = reader.plumbingKeys();
  const logged = await readRequestLog(directory);
  const rows = logged.map((row) => requestRow(row.id, row, reader, plumbing));
  const seen = new Set(logged.map((row) => row.id));
  for (const [id, scope] of reader.listedScopes()) {
    if (seen.has(id)) continue;
    const [method, ...rest] = scope.kind === "local-request" ? String(scope.label || "").split(" ") : [null];
    const durationMs = scope.startedAt && scope.endedAt ? Math.max(0, Date.parse(scope.endedAt) - Date.parse(scope.startedAt)) : null;
    rows.push(requestRow(id, {
      method: method || null,
      path: scope.kind === "local-request" ? rest.join(" ") || null : scope.label || runLabel,
      startedAt: scope.startedAt,
      durationMs: Number.isFinite(durationMs) ? durationMs : null
    }, reader, plumbing));
  }
  for (const [id, scope] of reader.backgroundScopes()) {
    rows.push({ ...requestRow(id, { startedAt: scope.startedAt }, reader, plumbing), kind: "background" });
  }
  return rows.sort((left, right) => String(left.startedAt || "").localeCompare(String(right.startedAt || "")) ||
    left.id.localeCompare(right.id));
}

function pageOf(items, { cursor = "", limit = 100, maxLimit = 200 } = {}) {
  const offset = /^[0-9]{1,7}$/u.test(String(cursor || "")) ? Number(cursor) : 0;
  const size = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), maxLimit);
  return { items: items.slice(offset, offset + size), more: offset + size < items.length, next: String(offset + size) };
}

export {
  HITS_FILE_PATTERN,
  createTraceReader,
  pageOf,
  readInteractions,
  readJsonFile,
  readRequestLog,
  recordingRequestRows,
  writeJsonFile
};
