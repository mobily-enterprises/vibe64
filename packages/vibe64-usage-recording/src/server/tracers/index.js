import path from "node:path";

import { USAGE_RECORDING_ENVIRONMENT } from "../../shared/contract.js";
import nodejs from "./nodejs.js";
import php from "./php.js";
import python from "./python.js";

// Each runtime tracer module default-exports:
//   { runtime, label, prepare({ recordingDirectory, sourceRoot, recordingId, targetKind }), unsetEnvironment(environment) }
// prepare is pure (no I/O beyond stats of its own runtime files and the host's runtime packs) and returns
//   { available: true, environment, prependEnvironment, nodePreload? }
// or { available: false, reason }.
// - environment values are set as given;
// - prependEnvironment values are prepended to any existing value
//   (PYTHONPATH, PHP_INI_SCAN_DIR) by mergePrependEnvironment();
// - unsetEnvironment(environment) answers the value a prepended variable
//   stands for while the launch sets none, which the merge then keeps ({} for
//   none). The recording service hands it the environment the execution
//   gateway resolved for the launch (usageRecordingEnvironment), so its PATH
//   names the programs the launch runs. It runs nothing: PHP's reads the scan
//   folder a Nix wrapper declares from the wrapper, since that folder is not
//   PHP's empty segment.
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

/**
 * A tracer's prependEnvironment value goes before any existing value: the
 * environment's, or when that is unset or empty the tracer's unsetEnvironment
 * value. Neither side is trimmed: no existing value leaves the tracer's value
 * as given, a value already ending in the separator is followed directly by
 * the existing one, and any other value is joined with one separator. So PHP's
 * "<ours>:" is followed by the scan folder its PHP reads by itself, or keeps
 * its trailing empty segment (the compiled-in folder), and a person's own
 * leading empty segment is kept too.
 */
function mergePrependEnvironment(prepend, environment, separator = path.delimiter, unset = {}) {
  const merged = {};
  for (const [name, value] of Object.entries(prepend || {})) {
    const ours = String(value);
    const existing = String(environment?.[name] || unset[name] || "");
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
  mergePrependEnvironment,
  recordingUnavailableReason,
  usageRecordingEnvironment,
  usageTracersForRuntimes
};
