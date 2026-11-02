import { AppError } from "@jskit-ai/kernel/server/runtime";

/**
 * Training's refusals and internal failures. A refusal is an AppError with its own code and HTTP status: its
 * message, params, details and messageCode reach the caller, and its cause stays on the error for the server's
 * logs. An internal failure is a plain Error, which the API answers as a hidden 500; its code still names it.
 */

/**
 * A Training refusal with the status the caller names.
 * @param {string} message
 * @param {string} code
 * @param {{
 *   statusCode: number,
 *   params?: object,
 *   details?: object,
 *   messageCode?: string,
 *   messageParams?: object,
 *   cause?: unknown
 * }} options
 */
function trainingFailure(message, code, options) {
  const { statusCode, cause, ...appErrorOptions } = options;
  const error = new AppError(statusCode, message, { ...appErrorOptions, code });
  if (cause) error.cause = cause;
  return error;
}

/**
 * A Training refusal, 409 unless named.
 * @param {string} message
 * @param {string} code
 * @param {number} [statusCode]
 * @param {{ params?: object, details?: object, messageCode?: string, messageParams?: object, cause?: unknown }} [options]
 */
function conflictFailure(message, code, statusCode = 409, options = {}) {
  return trainingFailure(message, code, { ...options, statusCode });
}

/**
 * A Training refusal with the status and cause the caller names.
 * @param {string} message
 * @param {string} code
 * @param {number} statusCode
 * @param {unknown} [cause]
 */
function causedFailure(message, code, statusCode, cause) {
  return trainingFailure(message, code, { statusCode, cause });
}

/**
 * An internal Training failure: a plain Error the API hides as a 500, whose code names it in the server's logs and
 * for the callers that branch on it.
 * @param {string} message
 * @param {string} code
 * @param {unknown} [cause]
 */
function trainingInternalError(message, code, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

const MAX_RESULT_BYTES = 128 * 1024;

/**
 * An action result is returned whole or refused, never silently trimmed.
 * @param {object} result
 * @param {() => Error} tooLarge the error a result over 128 KiB throws
 */
function boundedTrainingResult(result, tooLarge) {
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) throw tooLarge();
  return structuredClone(result);
}

export { boundedTrainingResult, causedFailure, conflictFailure, trainingFailure, trainingInternalError };
