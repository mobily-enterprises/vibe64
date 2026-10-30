// The recording contract shared by the recording service, the trace store, the
// Preview proxy, every runtime tracer and the results view. Changing a value
// here changes what tracers write and what Vibe64 reads, so keep them together.

const USAGE_RECORDING_SCHEMA = "vibe64.usage-recording.v1";
const USAGE_TRACE_SCHEMA = "vibe64.usage-trace.v1";
const USAGE_RECORDING_CHANGED_EVENT = "vibe64.usage-recording.changed";

// The Preview proxy owns request identity: it strips any client-sent value and
// assigns its own. The interaction header is accepted only while recording.
const USAGE_RECORDING_REQUEST_HEADER = "x-vibe64-recording-request";
const USAGE_RECORDING_INTERACTION_HEADER = "x-vibe64-interaction";

// Every tracer receives these three variables (set by the recording service).
const USAGE_RECORDING_ENVIRONMENT = Object.freeze({
  directory: "VIBE64_USAGE_RECORDING_DIR",
  sourceRoot: "VIBE64_USAGE_SOURCE_ROOT",
  targetKind: "VIBE64_USAGE_TARGET_KIND"
});

const USAGE_RECORDING_STATES = Object.freeze(["starting", "recording", "stopping", "stopped", "failed", "unavailable"]);
const USAGE_RECORDING_STOP_REASONS = Object.freeze([
  "person", "time-limit", "request-limit", "size-limit", "target-exited", "session-ended", "error"
]);
const USAGE_RECORDING_TARGET_KINDS = Object.freeze(["web", "terminal"]);
const USAGE_TRACER_RUNTIMES = Object.freeze(["nodejs", "python", "php"]);

const MIB = 1024 * 1024;
const USAGE_RECORDING_LIMITS = Object.freeze({
  durationMs: 10 * 60 * 1000,
  capturedRequests: 2000,
  hitsBytesPerProcess: 16 * MIB,
  hitsBytesPerRecording: 32 * MIB,
  proxyRequestLines: 20000,
  interactions: 500,
  bufferedBytesPerProcess: 64 * MIB,
  flushIntervalMs: 1000,
  flushEntries: 2000,
  traceLineBytes: 64 * 1024,
  indexBytes: 4 * MIB,
  plumbingShare: 0.8,
  plumbingMinimumRequests: 3
});

const USAGE_RECORDING_ID_PATTERN = /^rec_[a-z2-7]{20}$/u;
const USAGE_REQUEST_ID_PATTERN = /^r_[0-9]{6}$/u;
const USAGE_INTERACTION_ID_PATTERN = /^i_[0-9]{4,6}$/u;

// Scope ids and the kind each one must declare.
const USAGE_SCOPE_KINDS = Object.freeze([
  Object.freeze({ kind: "request", pattern: /^r_[0-9]{6}$/u }),
  Object.freeze({ kind: "local-request", pattern: /^l_[0-9]+_[0-9]+$/u }),
  Object.freeze({ kind: "run", pattern: /^run_[0-9]+$/u }),
  Object.freeze({ kind: "background", pattern: /^bg_[0-9]+$/u })
]);

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TRACER_LINE_STATES = Object.freeze(["ready", "idle"]);

function usageScopeKind(scope = "") {
  return USAGE_SCOPE_KINDS.find((entry) => entry.pattern.test(String(scope)))?.kind || "";
}

const isIndex = (value) => Number.isSafeInteger(value) && value >= 0;
const isText = (value) => typeof value === "string" && value.length > 0;
const isPoint = (value) => Boolean(value) && Number.isSafeInteger(value.line) && value.line > 0 &&
  Number.isSafeInteger(value.column) && value.column > 0;

// Source-root-relative POSIX path that never leaves the root or enters node_modules.
function isTraceSourcePath(value) {
  if (!isText(value) || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..") && !parts.includes("node_modules");
}

const LINE_CHECKS = Object.freeze({
  header: (line) => line.schema === USAGE_TRACE_SCHEMA && USAGE_TRACER_RUNTIMES.includes(line.runtime) &&
    isText(line.runtimeVersion) && Number.isSafeInteger(line.pid) && line.pid > 0 && isText(line.startedAt),
  tracer: (line) => TRACER_LINE_STATES.includes(line.state),
  file: (line) => isIndex(line.fileIndex) && isTraceSourcePath(line.path) && HASH_PATTERN.test(line.hash || ""),
  function: (line) => isIndex(line.functionIndex) && isIndex(line.fileIndex) && typeof line.name === "string" &&
    isPoint(line.start) && isPoint(line.end),
  scope: (line) => usageScopeKind(line.scope) === line.kind && isText(line.startedAt) &&
    (line.endedAt === undefined || isText(line.endedAt)) &&
    (line.label === undefined || (isText(line.label) && ["local-request", "run"].includes(line.kind))),
  hits: (line) => usageScopeKind(line.scope) !== "" && Array.isArray(line.counts) && line.counts.every((pair) => (
    Array.isArray(pair) && pair.length === 2 && isIndex(pair[0]) && (pair[1] === null || (Number.isSafeInteger(pair[1]) && pair[1] > 0))
  )),
  diagnostic: (line) => isText(line.code) && (line.path === undefined || isText(line.path)),
  truncated: (line) => isText(line.reason)
});

// Returns "" for a well-formed `vibe64.usage-trace.v1` line, otherwise why it
// is not. Readers skip and count malformed lines; they never evaluate them.
function usageTraceLineProblem(line) {
  if (!line || typeof line !== "object" || Array.isArray(line)) return "Trace line must be an object.";
  const check = LINE_CHECKS[line.type];
  if (!check) return `Unknown trace line type: ${String(line.type)}.`;
  return check(line) ? "" : `Invalid ${line.type} trace line.`;
}

export {
  USAGE_INTERACTION_ID_PATTERN,
  USAGE_RECORDING_CHANGED_EVENT,
  USAGE_RECORDING_ENVIRONMENT,
  USAGE_RECORDING_ID_PATTERN,
  USAGE_RECORDING_INTERACTION_HEADER,
  USAGE_RECORDING_LIMITS,
  USAGE_RECORDING_REQUEST_HEADER,
  USAGE_RECORDING_SCHEMA,
  USAGE_RECORDING_STATES,
  USAGE_RECORDING_STOP_REASONS,
  USAGE_RECORDING_TARGET_KINDS,
  USAGE_REQUEST_ID_PATTERN,
  USAGE_SCOPE_KINDS,
  USAGE_TRACER_RUNTIMES,
  USAGE_TRACE_SCHEMA,
  usageScopeKind,
  usageTraceLineProblem
};
