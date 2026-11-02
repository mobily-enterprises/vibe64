/**
 * An error a publishing request reports with its code; the route answers with
 * the status that code maps to. Options carry its details, the values its
 * sentence interpolates (params) and, for a code callers branch on, the
 * sentence's own messageCode.
 * @param {string} message
 * @param {string} code
 * @param {{ details?: object, params?: Record<string, unknown>, messageCode?: string }} [options]
 */
function publishingError(message, code, options = {}) {
  const { details, params, messageCode } = options;
  return Object.assign(new Error(message), {
    code,
    ...(details ? { details } : {}),
    ...(params ? { params } : {}),
    ...(messageCode ? { messageCode, messageParams: params || {} } : {})
  });
}

export { publishingError };
