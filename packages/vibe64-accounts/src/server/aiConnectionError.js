import { AppError } from "@jskit-ai/kernel/server/runtime";

/**
 * The one refusal AI connection operations throw: an AppError with its own
 * code at the HTTP status the route answers with and, for form errors,
 * per-field messages.
 */
function aiConnectionError(code, message, statusCode = 400, fieldErrors = null) {
  const error = new AppError(statusCode, message, { code });
  return fieldErrors ? Object.assign(error, { fieldErrors }) : error;
}

export { aiConnectionError };
