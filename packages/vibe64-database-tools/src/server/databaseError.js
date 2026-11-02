import { vibe64Error } from "@local/vibe64-core/server/core";

/**
 * A database tools failure with its code and details, and the values or
 * per-sentence code a client translates.
 * @param {string} message
 * @param {string} code
 * @param {Record<string, unknown>} [details]
 * @param {{ params?: Record<string, unknown>, messageCode?: string, messageParams?: Record<string, unknown> }} [messageFields]
 */
function databaseError(message, code, details = {}, messageFields = {}) {
  return vibe64Error(message, code, {
    ...messageFields,
    details
  });
}

export { databaseError };
