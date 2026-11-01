import { AppError } from "@jskit-ai/kernel/server/runtime";

// Colleague's failures: a refusal with its code and status, the one a send
// reports without a usable model, and a failed assistant result rethrown.
const COLLEAGUE_MODEL_UNAVAILABLE = "Connect an AI and choose an available Colleague model in AI setup before using Colleague.";

function failure(message, code = "vibe64_colleague_failed", statusCode = 409) {
  return new AppError(statusCode, message, { code });
}
function requireResult(result) {
  if (result?.ok === false) throw failure(result.error || "The assistant operation failed.", result.code);
  return result;
}

export { COLLEAGUE_MODEL_UNAVAILABLE, failure, requireResult };
