/**
 * An error a publishing request reports with its code.
 */
function publishingError(message, code) {
  return Object.assign(new Error(message), { code });
}

export { publishingError };
