// A host's part in Need help, optional: forwarding a session's raised flag to whoever can help, somewhere that is
// watched. Without one, the flag shows only in the session and its session list, where the person answers it.

const NEED_HELP_HOST_TOKEN = "vibe64.need-help.host";

/**
 * @typedef {object} NeedHelpForwardRequest
 * @property {string} sessionId
 * @property {string} projectSlug
 * @property {import("../../shared/needHelp.js").NeedHelpFlag} flag the flag as stored, the new message last
 * @property {string} message the message this raise added
 * @property {object | null} actor the person the session works for: who raised it, or whose request its AI works on
 */

/**
 * @typedef {object} NeedHelpHost
 * @property {(request: NeedHelpForwardRequest) => Promise<null | { to: string, reference?: string }>} forward sends a
 *   flag on and says where (`to`, as the person reads it) with the reference its receiver gave, or null when this
 *   host sends it nowhere; a refusal says why. It runs inside the session's project.
 */

/** @type {NeedHelpHost} */
const NO_NEED_HELP_HOST = Object.freeze({
  async forward() {
    return null;
  }
});

/** @param {unknown} host */
function assertNeedHelpHost(host) {
  // readable-check: allow method-probe - input validation: a composing host's Need help forwarder is checked once at setup
  if (host !== null && host !== undefined && typeof host?.forward !== "function") {
    throw new TypeError("A Need help host must have a forward function.");
  }
}

export { NEED_HELP_HOST_TOKEN, NO_NEED_HELP_HOST, assertNeedHelpHost };
