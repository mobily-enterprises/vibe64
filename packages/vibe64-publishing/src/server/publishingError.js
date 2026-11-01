/**
 * An error a publishing request reports with its code, and its details when it has any.
 */
function publishingError(message, code, details) {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

export { publishingError };
