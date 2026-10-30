import path from "node:path";

import { USAGE_RECORDING_ENVIRONMENT } from "../../shared/contract.js";
import nodejs from "./nodejs.js";
import php from "./php.js";
import python from "./python.js";

// Each runtime tracer module default-exports:
//   { runtime, label, prepare({ recordingDirectory, sourceRoot, recordingId, targetKind }) }
// prepare is pure (no I/O beyond stat of its own runtime files) and returns
//   { available: true, environment, prependEnvironment, nodePreload? }
// or { available: false, reason }.
// - environment values are set as given;
// - prependEnvironment values are prepended to any existing value
//   (PYTHONPATH, PHP_INI_SCAN_DIR) by mergePrependEnvironment();
// - nodePreload is an absolute path handed to the exec helper's
//   usageRecordingPreload launch field, never an environment variable.
// The three variables from usageRecordingEnvironment() are added by the
// recording service for every tracer; prepare does not repeat them.
const USAGE_TRACERS = Object.freeze([nodejs, python, php]);

function usageTracersForRuntimes(runtimes = []) {
  const declared = new Set(runtimes);
  return USAGE_TRACERS.filter((tracer) => declared.has(tracer.runtime));
}

function recordingUnavailableReason(runtimes = []) {
  return `Recording not available for ${runtimes.map((runtime) => `\`${runtime}\``).join(", ")}`;
}

// A tracer's prependEnvironment value goes before any existing value. Neither
// side is trimmed: an unset or empty existing value leaves the tracer's value
// as given, a value already ending in the separator is followed directly by
// the existing one, and any other value is joined with one separator. So PHP's
// "<ours>:" keeps its trailing empty segment (the default scan directory), and
// a person's own leading empty segment is kept too.
function mergePrependEnvironment(prepend = {}, environment = {}, separator = path.delimiter) {
  const merged = {};
  for (const [name, value] of Object.entries(prepend || {})) {
    const ours = String(value);
    const existing = String(environment?.[name] ?? "");
    merged[name] = !existing ? ours : ours.endsWith(separator) ? `${ours}${existing}` : `${ours}${separator}${existing}`;
  }
  return merged;
}

function usageRecordingEnvironment({ recordingDirectory, sourceRoot, targetKind }) {
  return {
    [USAGE_RECORDING_ENVIRONMENT.directory]: recordingDirectory,
    [USAGE_RECORDING_ENVIRONMENT.sourceRoot]: sourceRoot,
    [USAGE_RECORDING_ENVIRONMENT.targetKind]: targetKind
  };
}

export {
  USAGE_TRACERS,
  mergePrependEnvironment,
  recordingUnavailableReason,
  usageRecordingEnvironment,
  usageTracersForRuntimes
};
