/**
 * A packaging refusal. Each sentence has its own code; where callers branch on a
 * code that several sentences share, each sentence also has its own messageCode.
 */
class Vibe64PublishError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {unknown} [details]
   * @param {{ messageCode?: string }} [options]
   */
  constructor(code, message, details = undefined, { messageCode } = {}) {
    super(message);
    this.name = "Vibe64PublishError";
    this.code = code;
    if (details !== undefined) this.details = details;
    if (messageCode) this.messageCode = messageCode;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [details]
 * @param {{ messageCode?: string }} [options]
 */
function publishError(code, message, details, options) {
  return new Vibe64PublishError(code, message, details, options);
}

export { Vibe64PublishError, publishError };
