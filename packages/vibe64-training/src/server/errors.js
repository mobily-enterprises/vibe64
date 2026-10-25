// Training's coded refusals: an Error carrying a stable code, an optional HTTP
// status and any extra fields (cause, details) the caller names.
function trainingFailure(code, message, { statusCode, ...details } = {}) {
  return Object.assign(new Error(message), { code, ...(statusCode ? { statusCode } : {}), ...details });
}

const MAX_RESULT_BYTES = 128 * 1024;

// An action result is returned whole or refused, never silently trimmed.
function boundedTrainingResult(result, { message, statusCode } = {}) {
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
    throw trainingFailure("VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE", message, { statusCode });
  }
  return structuredClone(result);
}

export { boundedTrainingResult, trainingFailure };
