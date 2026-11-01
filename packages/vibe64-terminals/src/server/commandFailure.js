/**
 * The failed result an agent command route returns: the caller's extra fields, then its code and message.
 * @param {string} message
 * @param {string} code
 * @param {Record<string, unknown>} [extra]
 */
function commandFailure(message, code, extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    ok: false
  };
}

/**
 * A command-line failure: a commandFailure with the exit code (1 unless an integer is given) and the stderr text
 * (the message unless given).
 * @param {string} message
 * @param {string} code
 * @param {Record<string, unknown> & { exitCode?: number, stderr?: string }} [extra]
 */
function commandLineFailure(message, code, extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    exitCode: Number.isInteger(extra.exitCode) ? extra.exitCode : 1,
    ok: false,
    stderr: extra.stderr || `${message}\n`
  };
}

export {
  commandFailure,
  commandLineFailure
};
