/**
 * A plain Error that carries its code. Vibe64's envelope reports its message and
 * code; any other route keeps it a hidden internal failure.
 *
 * @param {string} message
 * @param {string} code
 * @returns {Error & { code: string }}
 */
function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export { codedError };
