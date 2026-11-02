import { AppError } from "@jskit-ai/kernel/server/runtime";

const CONFLICT_CODES = new Set([
  "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED",
  "VIBE64_PUBLISH_CONFIRMATION_USED",
  "VIBE64_PUBLISH_BASELINE_MOVED",
  "VIBE64_PUBLISH_TAG_CONFLICT",
  "vibe64_publishing_target_exists",
  "vibe64_publishing_keys_exist"
]);
const FORBIDDEN_CODES = new Set([
  "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON",
  "VIBE64_PUBLISH_CONFIRMATION_INVALID",
  "VIBE64_PUBLISH_CONFIRMATION_EXPIRED"
]);

/**
 * The HTTP status a publishing refusal's code answers with.
 * @param {string} code
 */
function publishingCodeStatus(code) {
  if (CONFLICT_CODES.has(code)) return 409;
  if (FORBIDDEN_CODES.has(code)) return 403;
  if (/missing$/u.test(code)) return 404;
  return 400;
}

/**
 * The status of a publishing route's response.
 * @param {{ ok?: boolean, code?: string }} response
 */
function publishingStatusCode(response) {
  if (response?.ok !== false) return 200;
  return publishingCodeStatus(response.code || "");
}

/**
 * A publishing refusal: an AppError with its code, at the status that code
 * answers with. Options carry its details, the values its sentence
 * interpolates (params) and, for a code callers branch on, the sentence's own
 * messageCode.
 * @param {string} message
 * @param {string} code
 * @param {{ details?: object, params?: Record<string, unknown>, messageCode?: string }} [options]
 */
function publishingError(message, code, options = {}) {
  const { details, params, messageCode } = options;
  return new AppError(publishingCodeStatus(code), message, {
    code,
    details,
    params,
    ...(messageCode ? { messageCode, messageParams: params } : {})
  });
}

export { publishingError, publishingStatusCode };
