import { AppError } from "@jskit-ai/kernel/server/runtime";

// Colleague's failures: a refusal with its own code and status, the one a send
// reports without a usable model, and a failed assistant result rethrown.
const COLLEAGUE_MODEL_UNAVAILABLE = "Connect an AI and choose an available Colleague model in AI setup before using Colleague.";

/**
 * A Colleague refusal, 409 unless named.
 * @param {string} message
 * @param {string} code
 * @param {number} [statusCode]
 * @param {{ params?: object, messageCode?: string, messageParams?: object }} [options]
 */
function failure(message, code, statusCode = 409, options = {}) {
  return new AppError(statusCode, message, { ...options, code });
}
function requireResult(result) {
  if (result?.ok === false) throw failure(result.error || "The assistant operation failed.", result.code || "vibe64_colleague_failed");
  return result;
}

export { COLLEAGUE_MODEL_UNAVAILABLE, failure, requireResult };
